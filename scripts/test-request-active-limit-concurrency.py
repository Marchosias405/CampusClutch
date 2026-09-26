"""Local-only active-request limit races; all isolated fixtures are removed.

Run: python scripts/test-request-active-limit-concurrency.py
Requires psql on PATH and the local Supabase database at 127.0.0.1:54322.
Contenders are observed waiting on a held wallet before it is released, so
these checks exercise overlapping transactions, including elapsed deadlines.
"""
import concurrent.futures
import contextlib
import json
import os
import shutil
import subprocess
import time
import uuid

PSQL = shutil.which('psql')
if not PSQL:
    raise SystemExit('Install PostgreSQL client tools (psql) first.')
ENV = dict(os.environ, PGPASSWORD='postgres', PGCONNECT_TIMEOUT='5',
           PGOPTIONS='-c statement_timeout=15000 -c idle_in_transaction_session_timeout=20000')
ARGS = [PSQL, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
        '-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', 'postgres']
LIMIT_MESSAGE = ('You can have at most 3 active requests. Complete or cancel an '
                 'active request before posting another.')
users = [str(uuid.uuid4()) for _ in range(8)]


def sql(query, *, check=True, app='active-limit-fixtures'):
    result = subprocess.run(ARGS + ['-c', query], env=dict(ENV, PGAPPNAME=app),
                            capture_output=True, text=True, timeout=25)
    if check and result.returncode:
        raise AssertionError(result.stderr)
    return result


def value(query):
    return sql(query).stdout.strip().splitlines()[-1]


def user_query(user, query):
    return (f"set local role authenticated; "
            f"select set_config('request.jwt.claim.sub','{user}',true); {query};")


def as_user(user, query):
    return f'begin; {user_query(user, query)} commit;'


def payload():
    return json.dumps(dict(category='delivery', title='Active limit race',
        description='Temporary active limit concurrency request.', campus_id=campus,
        room_location='Library', points=10, item_size='small',
        deadline_at='2099-01-01T00:00:00Z',
        details=dict(pickup_location='Cafe', dropoff_location='Library')))


def save_call(owner, request=None):
    target = f",'{request}'" if request else ''
    return as_user(owner, f"select public.save_my_request('{payload()}'::jsonb{target})")


def create_request(owner):
    return value(save_call(owner))


def offer(request, helper):
    return value(as_user(helper,
        f"select public.create_my_request_offer_for_terms('{request}',1,10)"))


def count_active(owner):
    return int(value(f"select count(*) from public.requests where owner_id='{owner}' "
                     "and (status='accepted' or (status='open' and deadline_at>clock_timestamp()))"))


def assert_limit(result):
    assert result.returncode != 0, result.stdout
    assert 'P0004' in result.stderr and LIMIT_MESSAGE in result.stderr, result.stderr


@contextlib.contextmanager
def locked_wallets(owners):
    """Hold known fixture wallets without relying on a timing-only barrier."""
    marker = 'active-limit-' + uuid.uuid4().hex
    blocker = subprocess.Popen(ARGS, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True, env=dict(ENV, PGAPPNAME=marker+'-blocker'))
    try:
        ids = ','.join(f"'{owner}'" for owner in owners)
        blocker.stdin.write('begin; select profile_id from public.points_wallets '
                            f'where profile_id in ({ids}) order by profile_id for update;\n')
        blocker.stdin.flush()
        observed = [blocker.stdout.readline().strip() for _ in owners]
        assert observed == sorted(owners), f'Coordinator locks failed: {observed}'
        yield blocker, marker
    finally:
        if blocker.poll() is None:
            blocker.kill()
        blocker.communicate(timeout=5)


def wallet_race(owner, calls, before_release=''):
    with locked_wallets([owner]) as (blocker, marker):
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(calls)) as pool:
            futures = [pool.submit(sql, call, check=False, app=marker+f'-{i}')
                       for i, call in enumerate(calls)]
            names = ','.join(f"'{marker}-{i}'" for i in range(len(calls)))
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                waiting = int(value('select count(*) from pg_stat_activity '
                    f"where application_name in ({names}) and wait_event_type='Lock'"))
                if waiting == len(calls):
                    break
                assert not any(f.done() for f in futures), 'A contender finished before reaching the lock'
                time.sleep(.04)
            else:
                raise AssertionError('Contenders did not reach the held wallet')
            blocker.stdin.write(before_release + '; commit;\n\\q\n')
            blocker.stdin.flush()
            _, error = blocker.communicate(timeout=12)
            assert blocker.returncode == 0, error
            return [future.result(timeout=25) for future in futures]


try:
    campus = value("select id from public.campuses where slug='burnaby'")
    for user in users:
        sql(f"insert into auth.users(id,email) values('{user}','{user}@active-limit-test.local'); "
            "update public.profiles set display_name='Active Limit Race Tester',"
            "major='Computing Science',year_of_study=2,"
            f"campus_id='{campus}' where id='{user}';")

    # A fresh account has no request rows to lock. Four parallel first posts
    # must still serialize on the already-created owner wallet.
    results = wallet_race(users[0], [save_call(users[0]) for _ in range(4)])
    assert sum(r.returncode == 0 for r in results) == 3, [r.stderr for r in results]
    assert_limit(next(r for r in results if r.returncode))
    assert count_active(users[0]) == 3
    assert value(f"select count(*) from public.delivery_request_details d join public.requests r "
                 f"on r.id=d.request_id where r.owner_id='{users[0]}'") == '3'
    print('PASS four simultaneous first posts: three successes, one rejection, no orphan details', flush=True)

    create_request(users[1])
    create_request(users[1])
    results = wallet_race(users[1], [save_call(users[1]), save_call(users[1])])
    assert sum(r.returncode == 0 for r in results) == 1, [r.stderr for r in results]
    assert_limit(next(r for r in results if r.returncode))
    assert count_active(users[1]) == 3
    print('PASS competing new posts for the last slot: exactly one winner', flush=True)

    # The contender reads a future deadline, then blocks on the wallet. While
    # blocked, that deadline passes and the coordinator takes the freed slot.
    # The stale operation must recheck active membership after obtaining the
    # wallet, instead of treating its earlier open snapshot as a reserved slot.
    for owner, operation in zip(users[2:5], ('edit', 'reopen', 'accept')):
        create_request(owner)
        create_request(owner)
        expiring = create_request(owner)
        pending = offer(expiring, users[7])
        sql(f"update public.requests set deadline_at=clock_timestamp()+interval '4 seconds' "
            f"where id='{expiring}'")
        if operation == 'edit':
            contender = save_call(owner, expiring)
        elif operation == 'reopen':
            contender = as_user(owner,
                f"select public.reopen_my_request('{expiring}',1,'2099-02-01T00:00:00Z')")
        else:
            contender = as_user(owner,
                f"select public.decide_request_offer_for_round('{pending}','accepted',1,10)")
        before_release = (
            "select pg_sleep(greatest(0,extract(epoch from (deadline_at-clock_timestamp())))+.05) "
            f"from public.requests where id='{expiring}'; "
            + user_query(owner, f"select public.save_my_request('{payload()}'::jsonb)"))
        result = wallet_race(owner, [contender], before_release)[0]
        assert_limit(result)
        assert count_active(owner) == 3
        assert value(f"select status||'/'||offer_round from public.requests where id='{expiring}'") == 'open/1'
        assert value(f"select status from public.request_offers where id='{pending}'") == 'pending'
        assert value(f"select count(*) from public.request_point_reservations where request_id='{expiring}'") == '0'
        assert value(f"select reserved from public.points_wallets where profile_id='{owner}'") == '0'
        assert value(f"select count(*) from public.requests where owner_id='{owner}'") == '4'
        print(f'PASS stale {operation} after expiry and replacement: no fourth slot or partial side effects', flush=True)

    # Lazy expiry may touch requests owned by different people in one page.
    # It must complete even while both wallets are locked, avoiding a new
    # wallet dependency (and opposite-owner wallet lock order) for closure.
    expiring = []
    for owner in users[5:7]:
        request = create_request(owner)
        offer(request, users[7])
        expiring.append(request)
        sql(f"update public.requests set deadline_at=clock_timestamp()-interval '1 second' where id='{request}'")
    with locked_wallets(users[5:7]):
        sql(as_user(users[7], "set local statement_timeout='2s'; "
                    "select count(*) from public.get_request_offer_page_v3(NULL,20,0)"))
    ids = ','.join(f"'{request}'" for request in expiring)
    assert value(f"select count(*) from public.requests where id in ({ids}) and status='expired'") == '2'
    assert value(f"select count(*) from public.request_offers where request_id in ({ids}) and status='rejected'") == '2'
    print('PASS expiry across two owners completes while both wallets are locked', flush=True)
finally:
    # Include any unexpected successful post in cleanup, not just known IDs.
    ids = ','.join(f"'{user}'" for user in users)
    sql(f'delete from public.requests where owner_id in ({ids})')
    sql(f'delete from auth.users where id in ({ids})')
