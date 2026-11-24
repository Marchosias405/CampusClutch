"""Local-only retained-balance races and atomic rollback.

Run: python scripts/test-returning-balances-concurrency.py
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


# Retained funds must transfer to one wallet, including after rollback.
try:
    for index in range(4):
        create_user(index)
    for email in base_emails[:2]:
        sql('insert into points_private.starter_grant_claims(email_fingerprint) values '
            f'(points_private.email_fingerprint({quote(email)})); '
            'insert into points_private.returning_balances(email_fingerprint,balance) values '
            f'(points_private.email_fingerprint({quote(email)}),175);')
    results = wallet_race(users[:2], [confirm(0), confirm(1)])
    assert all(result.returncode == 0 for result in results), [r.stderr for r in results]
    balances = [wallet(u)[0] for u in users[:2]]
    assert sorted(balances) == [0,175], balances
    assert sum(ledger_count(u) for u in users[:2]) == 0
    winner = users[balances.index(175)]
    count = lambda u: int(value('select count(*) from public.points_ledger '
                              f"where profile_id={quote(u)} and kind='balance_restored'"))
    assert sum(count(u) for u in users[:2]) == 1
    print('PASS simultaneous verified accounts: saved balance restored exactly once', flush=True)
    call = f'select points_private.grant_starter_points({quote(winner)});'
    results = wallet_race([winner], [call,call])
    assert all(result.returncode == 0 for result in results)
    assert wallet(winner) == (175,0) and count(winner) == 1
    print('PASS repeated concurrent restoration leaves balance/history unchanged', flush=True)
    rollback_claim_race()
    assert wallet(users[2]) == (0,0) and count(users[2]) == 0
    assert wallet(users[3]) == (175,0) and count(users[3]) == 1
    sql(confirm(2))
    assert wallet(users[2]) == (0,0)
    assert value('select count(*) from points_private.returning_balances '
                 'where email_fingerprint in (' + ','.join(
                     f'points_private.email_fingerprint({quote(e)})' for e in base_emails[:2]) + ')') == '0'
    print('PASS rolled-back restoration leaves funds for the waiting verified account', flush=True)
finally:
    fingerprints = ','.join('points_private.email_fingerprint(' + quote(email) + ')'
                            for email in base_emails)
    ids = ','.join(quote(user) for user in users)
    sql('begin; delete from points_private.returning_balances '
        f'where email_fingerprint in ({fingerprints}); '
        'delete from points_private.starter_grant_claims '
        f'where email_fingerprint in ({fingerprints}); '
        f'delete from auth.users where id in ({ids}); commit;')
    assert value(f'select count(*) from auth.users where id in ({ids})') == '0'
    print('Exact temporary restoration fixtures removed.', flush=True)
