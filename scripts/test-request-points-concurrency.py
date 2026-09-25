"""Local-only points races. Requires psql on PATH; isolated fixtures are removed.

Run: python scripts/test-request-points-concurrency.py
The coordinator blocks both calls on the same request or wallet and observes
their database lock waits before releasing them. No hosted database is used.
"""
import concurrent.futures
import json
import os
import shutil
import subprocess
import time
import uuid

PSQL = shutil.which('psql')
if not PSQL:
    raise SystemExit('Install PostgreSQL client tools (psql) first.')
ENV = dict(os.environ, PGPASSWORD='postgres', PGCONNECT_TIMEOUT='5')
ARGS = [PSQL, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1',
        '-p', '54322', '-U', 'postgres', '-d', 'postgres']
users = [str(uuid.uuid4()) for _ in range(5)]
requests = []


def sql(query, *, check=True, app='points-fixtures'):
    result = subprocess.run(ARGS + ['-c', query], env=dict(ENV, PGAPPNAME=app),
                            capture_output=True, text=True, timeout=30)
    if check and result.returncode:
        raise AssertionError(result.stderr)
    return result


def as_user(user, query):
    return f"begin; set local role authenticated; select set_config('request.jwt.claim.sub','{user}',true); {query}; commit;"


def value(query):
    return sql(query).stdout.strip().splitlines()[-1]


def request_payload(points):
    campus = value("select id from public.campuses where slug='burnaby'")
    return json.dumps(dict(category='delivery', title='Points concurrency',
        description='Temporary points concurrency test request.', campus_id=campus,
        room_location='Library', points=points, item_size='small',
        deadline_at='2099-01-01T00:00:00Z',
        details=dict(pickup_location='Cafe', dropoff_location='Library')))

def create_request(owner, points):
    payload = request_payload(points)
    request = value(as_user(owner, f"select public.save_my_request('{payload}'::jsonb)"))
    requests.append(request)
    return request


def offer(request, helper):
    return value(as_user(helper, f"select public.create_my_request_offer('{request}')"))


def accept(offer_id, owner, points):
    return as_user(owner, f"select public.decide_request_offer_for_round('{offer_id}','accepted',1,{points})")


def complete(request, owner):
    return as_user(owner, f"select public.complete_my_request('{request}',1)")


def reopen(request, owner):
    return as_user(owner, f"select public.reopen_my_request('{request}',1,'2099-01-02T00:00:00Z')")


def wallet(user):
    return tuple(map(int, value(f"select balance||'/'||reserved from public.points_wallets where profile_id='{user}'").split('/')))


def race(lock_query, lock_value, calls, before_release=''):
    marker = 'points-' + uuid.uuid4().hex
    blocker = subprocess.Popen(ARGS, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True, env=dict(ENV, PGAPPNAME=marker+'-blocker'))
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=2)
    try:
        blocker.stdin.write(f'begin; {lock_query};\n')
        blocker.stdin.flush()
        assert blocker.stdout.readline().strip() == lock_value, 'Coordinator lock failed'
        futures = [pool.submit(sql, call, check=False, app=marker+f'-{i}') for i, call in enumerate(calls)]
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            waiting = value(f"select count(*) from pg_stat_activity where application_name in ('{marker}-0','{marker}-1') and wait_event_type='Lock'")
            if waiting == '2':
                break
            time.sleep(.05)
        else:
            raise AssertionError('Both contenders did not reach the database lock')
        blocker.stdin.write(before_release + '; commit;\n\\q\n')
        blocker.stdin.flush()
        blocker.communicate(timeout=10)
        return [future.result(timeout=30) for future in futures]
    finally:
        if blocker.poll() is None:
            blocker.kill()
            blocker.communicate()
        pool.shutdown(wait=True)


def request_race(request, calls):
    return race(f"select id from public.requests where id='{request}' for update", request, calls)


def wallet_race(user, calls):
    return race(f"select profile_id from public.points_wallets where profile_id='{user}' for update", user, calls)


try:
    for user in users:
        sql(f"insert into auth.users(id,email) values('{user}','{user}@points-test.local'); "
            f"update public.profiles set display_name='Points Race Tester',major='Computing Science',year_of_study=2,"
            f"campus_id=(select id from public.campuses where slug='burnaby') where id='{user}';")
        assert wallet(user) == (100, 0)

    # Different parent request locks must still serialize spending of one wallet.
    first_request = create_request(users[0], 80)
    second_request = create_request(users[0], 80)
    first = offer(first_request, users[1])
    second = offer(second_request, users[2])
    results = wallet_race(users[0], [accept(first, users[0], 80), accept(second, users[0], 80)])
    assert sum(r.returncode == 0 for r in results) == 1, [r.stderr for r in results]
    assert 'Not enough available points' in next(r.stderr for r in results if r.returncode)
    assert wallet(users[0]) == (100, 80)
    ids = f"'{first_request}','{second_request}'"
    assert value(f"select count(*) from public.request_point_reservations where request_id in ({ids}) and status='reserved'") == '1'
    assert value(f"select count(*) from public.requests where id in ({ids}) and status='accepted'") == '1'
    loser = second_request if results[0].returncode == 0 else first_request
    assert value(f"select status from public.requests where id='{loser}'") == 'open'
    assert value(f"select status from public.request_offers where request_id='{loser}'") == 'pending'
    winner = first_request if results[0].returncode == 0 else second_request
    sql(reopen(winner, users[0]))
    assert wallet(users[0]) == (100, 0)
    print('PASS concurrent 80-point acceptances on a 100-point wallet: one funded winner', flush=True)

    request = create_request(users[0], 30)
    accepted = offer(request, users[1])
    sql(accept(accepted, users[0], 30))
    call = complete(request, users[0])
    results = request_race(request, [call, call])
    assert all(r.returncode == 0 for r in results), [r.stderr for r in results]
    assert wallet(users[0]) == (70, 0) and wallet(users[1]) == (130, 0)
    assert value(f"select count(*) from public.points_ledger where request_id='{request}'") == '2'
    assert value(f"select sum(amount) from public.points_ledger where request_id='{request}'") == '0'
    assert value(f"select status from public.request_point_reservations where request_id='{request}'") == 'settled'
    print('PASS concurrent completion retries: exactly one debit and credit', flush=True)

    request = create_request(users[0], 20)
    accepted = offer(request, users[1])
    sql(accept(accepted, users[0], 20))
    results = request_race(request, [complete(request, users[0]), reopen(request, users[0])])
    assert sum(r.returncode == 0 for r in results) == 1, [r.stderr for r in results]
    state = value(f"select status from public.requests where id='{request}'")
    if state == 'completed':
        assert wallet(users[0]) == (50, 0) and wallet(users[1]) == (150, 0)
        assert value(f"select status from public.request_point_reservations where request_id='{request}'") == 'settled'
        assert value(f"select count(*) from public.points_ledger where request_id='{request}'") == '2'
    else:
        assert state == 'open'
        assert wallet(users[0]) == (70, 0) and wallet(users[1]) == (130, 0)
        assert value(f"select offer_round from public.requests where id='{request}'") == '2'
        assert value(f"select status from public.request_point_reservations where request_id='{request}'") == 'released'
        assert value(f"select count(*) from public.points_ledger where request_id='{request}'") == '0'
    print('PASS completion versus reopening: payment or release, never both', flush=True)

    # Reciprocal settlements must acquire both wallets in the same global order.
    outgoing = create_request(users[2], 25)
    incoming = create_request(users[3], 40)
    sql(accept(offer(outgoing, users[3]), users[2], 25))
    sql(accept(offer(incoming, users[2]), users[3], 40))
    results = wallet_race(min(users[2:4]), [complete(outgoing, users[2]), complete(incoming, users[3])])
    assert all(r.returncode == 0 for r in results), [r.stderr for r in results]
    assert wallet(users[2]) == (115, 0) and wallet(users[3]) == (85, 0)
    ids = f"'{outgoing}','{incoming}'"
    assert value(f"select count(*) from public.request_point_reservations where request_id in ({ids}) and status='settled'") == '2'
    assert value(f"select count(*) from public.points_ledger where request_id in ({ids})") == '4'
    assert value(f"select sum(amount) from public.points_ledger where request_id in ({ids})") == '0'
    print('PASS reciprocal simultaneous payments: no deadlock and conserved balances', flush=True)

    # A create and an edit start before acceptance commits while waiting for the
    # same poster's wallet. Both must validate the new spendable amount.
    pending = create_request(users[4], 30)
    chosen = offer(pending, users[1])
    create_call = as_user(users[4], f"select public.save_my_request('{request_payload(80)}'::jsonb)")
    edit_target = create_request(users[4], 10)
    edit_call = as_user(users[4], f"select public.save_my_request('{request_payload(80)}'::jsonb,'{edit_target}')")
    before_release = (f"set local role authenticated; select set_config('request.jwt.claim.sub','{users[4]}',true); "
        f"select public.decide_request_offer_for_round('{chosen}','accepted',1,30)")
    results = race(f"select profile_id from public.points_wallets where profile_id='{users[4]}' for update",
                   users[4], [create_call, edit_call], before_release)
    assert all(r.returncode != 0 and 'You have 70 available points' in r.stderr for r in results), [r.stderr for r in results]
    assert wallet(users[4]) == (100, 30)
    assert value(f"select points from public.requests where id='{edit_target}'") == '10'
    assert value(f"select count(*) from public.requests where owner_id='{users[4]}'") == '2'
    print('PASS posting and editing waiting on acceptance recheck the reduced available balance', flush=True)
finally:
    # Include a post unexpectedly created by a failed race assertion in cleanup.
    sql('delete from public.requests where owner_id in (' + ','.join(f"'{u}'" for u in users) + ')')
    for user in users:
        sql(f"delete from auth.users where id='{user}'")
    print('Temporary points concurrency fixtures removed.', flush=True)
