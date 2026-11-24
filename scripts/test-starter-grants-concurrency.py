"""Local-only welcome-grant races and deletion persistence.

Run: python scripts/test-starter-grants-concurrency.py
Requires psql on PATH and the starter-grant migration in local Supabase.
Uses only 127.0.0.1:54322; random test users and their exact claim hashes are
removed in finally. No hosted connection or real account is accepted.
"""
import concurrent.futures
import os
import shutil
import subprocess
import time
import uuid

PSQL = shutil.which('psql')
if not PSQL:
    raise SystemExit('Install PostgreSQL client tools (psql) first.')

ENV = {key: value for key, value in os.environ.items()
       if key not in ('PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE')}
ENV.update(PGPASSWORD='postgres', PGCONNECT_TIMEOUT='5',
           PGOPTIONS='-c statement_timeout=20000')
PORT = os.environ.get('CAMPUSCLUTCH_TEST_DB_PORT', '54322')
assert PORT in ('54322', '54422'), 'Only disposable local test ports accepted'
ARGS = [PSQL, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1',
        '-p', PORT, '-U', 'postgres', '-d', 'postgres']
users = [str(uuid.uuid4()) for _ in range(6)]
base_emails = [uuid.uuid4().hex + '@starter-race.test' for _ in range(3)]
# Raw emails differ even if Auth has a lower(email) index. Our policy deliberately
# normalizes both surrounding spaces and case, so these share one entitlement.
emails = [base_emails[0], ' ' + base_emails[0].upper() + ' ',
          base_emails[1], ' ' + base_emails[1].upper() + ' ',
          base_emails[2], base_emails[2]]


def quote(value):
    return "'" + value.replace("'", "''") + "'"


def sql(query, *, check=True, app='starter-grant-fixtures'):
    result = subprocess.run(ARGS + ['-c', query],
                            env=dict(ENV, PGAPPNAME=app),
                            capture_output=True, text=True, timeout=30)
    if check and result.returncode:
        raise AssertionError(result.stderr)
    return result


def value(query):
    output = sql(query).stdout.strip().splitlines()
    assert output, 'Query returned no scalar result'
    return output[-1]


def wallet(user):
    return tuple(map(int, value(
        'select balance || \'/\' || reserved from public.points_wallets '
        f'where profile_id={quote(user)}').split('/')))


def ledger_count(user):
    return int(value('select count(*) from public.points_ledger '
                     f'where profile_id={quote(user)} and kind=\'starter_grant\''))


def claim_count(email):
    return int(value('select count(*) from points_private.starter_grant_claims '
                     'where email_fingerprint='
                     f'points_private.email_fingerprint({quote(email)})'))


def create_user(index, confirmed=False):
    sql('insert into auth.users(id,email,email_confirmed_at) values '
        f'({quote(users[index])},{quote(emails[index])},'
        + ('clock_timestamp()' if confirmed else 'null') + ')')


def confirm(index):
    return ('update auth.users set email_confirmed_at=clock_timestamp() '
            f'where id={quote(users[index])};')


def start_coordinator(marker):
    return subprocess.Popen(ARGS, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, bufsize=1,
                            env=dict(ENV, PGAPPNAME=marker))


def finish_process(process):
    if process.poll() is None:
        process.kill()
        process.communicate(timeout=5)


def wait_for_locks(names):
    wanted = ','.join(quote(name) for name in names)
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        waiting = value('select count(*) from pg_stat_activity '
                        f'where application_name in ({wanted}) '
                        "and wait_event_type='Lock'")
        if int(waiting) == len(names):
            return
        time.sleep(0.05)
    raise AssertionError('Contenders did not reach their expected database locks')


def wallet_race(locked_users, calls):
    marker = 'starter-' + uuid.uuid4().hex
    coordinator = start_coordinator(marker + '-coordinator')
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=len(calls))
    try:
        ids = ','.join(quote(user) for user in locked_users)
        coordinator.stdin.write('begin; select count(*) from '
                                '(select profile_id from public.points_wallets '
                                f'where profile_id in ({ids}) '
                                'order by profile_id for update) locked;\n')
        coordinator.stdin.flush()
        assert coordinator.stdout.readline().strip() == str(len(locked_users)), \
            'Coordinator did not lock all fixture wallets'
        names = [marker + f'-{i}' for i in range(len(calls))]
        futures = [pool.submit(sql, call, check=False, app=name)
                   for call, name in zip(calls, names)]
        wait_for_locks(names)
        coordinator.stdin.write('commit;\n\\q\n')
        coordinator.stdin.flush()
        _, errors = coordinator.communicate(timeout=10)
        assert coordinator.returncode == 0, errors
        return [future.result(timeout=30) for future in futures]
    finally:
        finish_process(coordinator)
        pool.shutdown(wait=True)


def rollback_claim_race():
    marker = 'starter-rollback-' + uuid.uuid4().hex
    winner = start_coordinator(marker + '-winner')
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    try:
        # The first transaction claims the email and credits its wallet, but
        # keeps both writes uncommitted. The second must wait on that claim.
        winner.stdin.write('begin; ' + confirm(2) + " select 'claimed';\n")
        winner.stdin.flush()
        assert winner.stdout.readline().strip() == 'claimed', \
            'First transaction did not reach its uncommitted claim'
        contender_name = marker + '-contender'
        future = pool.submit(sql, confirm(3), check=False, app=contender_name)
        wait_for_locks([contender_name])
        winner.stdin.write('rollback;\n\\q\n')
        winner.stdin.flush()
        _, errors = winner.communicate(timeout=10)
        assert winner.returncode == 0, errors
        result = future.result(timeout=30)
        assert result.returncode == 0, result.stderr
    finally:
        finish_process(winner)
        pool.shutdown(wait=True)


# Fail before creating fixtures if the migration is absent.
assert value("select to_regprocedure('points_private.grant_starter_points(uuid)') "
             'is not null') == 't', 'Apply the starter-grant migration locally first'

try:
    for index in range(5):
        create_user(index)
        assert wallet(users[index]) == (0, 0)
    assert all(claim_count(email) == 0 for email in base_emails)

    results = wallet_race(users[:2], [confirm(0), confirm(1)])
    assert all(result.returncode == 0 for result in results), \
        [result.stderr for result in results]
    balances = [wallet(user)[0] for user in users[:2]]
    assert sorted(balances) == [0, 100], balances
    assert sum(ledger_count(user) for user in users[:2]) == 1
    assert claim_count(emails[0]) == claim_count(emails[1]) == 1
    print('PASS concurrent confirmation of one normalized email: one 100-point grant', flush=True)

    winner_id = users[balances.index(100)]
    call = f'select points_private.grant_starter_points({quote(winner_id)});'
    results = wallet_race([winner_id], [call, call])
    assert all(result.returncode == 0 for result in results), \
        [result.stderr for result in results]
    assert wallet(winner_id) == (100, 0)
    assert ledger_count(winner_id) == 1
    assert claim_count(emails[0]) == 1
    print('PASS concurrent repeated grants on one wallet remain idempotent', flush=True)

    rollback_claim_race()
    assert wallet(users[2]) == (0, 0) and ledger_count(users[2]) == 0
    assert wallet(users[3]) == (100, 0) and ledger_count(users[3]) == 1
    assert claim_count(emails[2]) == 1
    # Retrying the rolled-back confirmation now sees the committed winner.
    sql(confirm(2))
    assert wallet(users[2]) == (0, 0) and ledger_count(users[2]) == 0
    print('PASS rolled-back claim releases entitlement to the waiting transaction', flush=True)

    sql(confirm(4))
    assert wallet(users[4]) == (100, 0) and ledger_count(users[4]) == 1
    # Make this fixture's welcome credit exhausted; actual request transfer
    # accounting is covered by the request-points SQL/concurrency regressions.
    sql(f'update public.points_wallets set balance=0 where profile_id={quote(users[4])}; '
        f'delete from auth.users where id={quote(users[4])};')
    assert claim_count(emails[4]) == 1, 'Deleting Auth must not delete the claim'
    create_user(5, confirmed=True)
    assert wallet(users[5]) == (0, 0) and ledger_count(users[5]) == 0
    sql(confirm(5))
    assert wallet(users[5]) == (0, 0) and claim_count(emails[5]) == 1
    print('PASS exhausted, deleted and recreated account cannot receive a second grant', flush=True)
finally:
    # Privileged local-only test cleanup deliberately removes ONLY this run's
    # random test receipts. Product deletion must never perform this operation.
    fingerprints = ','.join('points_private.email_fingerprint(' + quote(email) + ')'
                            for email in base_emails)
    ids = ','.join(quote(user) for user in users)
    sql('begin; delete from points_private.starter_grant_claims '
        f'where email_fingerprint in ({fingerprints}); '
        f'delete from auth.users where id in ({ids}); commit;')
    assert value('select count(*) from points_private.starter_grant_claims '
                 f'where email_fingerprint in ({fingerprints})') == '0'
    assert value(f'select count(*) from auth.users where id in ({ids})') == '0'
    print('Exact temporary starter-grant users and receipts removed.', flush=True)
