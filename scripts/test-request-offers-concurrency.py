"""Local-only Task 9 races. Requires psql on PATH; creates/removes isolated fixtures.

Run: python scripts/test-request-offers-concurrency.py
The coordinator holds the request row until both API-equivalent calls are
observed waiting on a database lock, so these are real overlapping transactions.
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
users = [str(uuid.uuid4()) for _ in range(3)]
requests = []


def sql(query, *, check=True, app='task9-fixtures'):
    result = subprocess.run(ARGS + ['-c', query], env=dict(ENV, PGAPPNAME=app),
                            capture_output=True, text=True, timeout=30)
    if check and result.returncode:
        raise AssertionError(result.stderr)
    return result


def as_user(user, query):
    return f"begin; set local role authenticated; select set_config('request.jwt.claim.sub','{user}',true); {query}; commit;"


def value(query):
    return sql(query).stdout.strip().splitlines()[-1]


def request_payload(points=10):
    campus = value("select id from public.campuses where slug='burnaby'")
    return json.dumps(dict(category='delivery', title='Task 9 concurrency',
        description='Temporary concurrency test request.', campus_id=campus,
        room_location='Library', points=points, item_size='small',
        deadline_at='2099-01-01T00:00:00Z',
        details=dict(pickup_location='Cafe', dropoff_location='Library')))


def create_request(points=10):
    # Each scenario is independent. Close earlier work through normal RPCs so
    # the poster stays within the active-request cap without bypassing it.
    for previous in requests:
        status = value(f"select status from public.requests where id='{previous}'")
        if status == 'accepted':
            round_number = int(value(f"select offer_round from public.requests where id='{previous}'"))
            sql(reopen(previous, round_number))
            status = 'open'
        if status == 'open':
            sql(as_user(users[0], f"select public.cancel_my_request('{previous}')"))
    payload = request_payload(points)
    request = value(as_user(users[0], f"select public.save_my_request('{payload}'::jsonb)"))
    requests.append(request)
    return request


def offer(request, user, points=10):
    return value(as_user(user, f"select public.create_my_request_offer_for_terms('{request}',1,{points})"))


def race(request, calls, before_release=None):
    marker = 'task9-' + uuid.uuid4().hex
    blocker = subprocess.Popen(ARGS, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True, env=dict(ENV, PGAPPNAME=marker+'-blocker'))
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=2)
    try:
        blocker.stdin.write(f"begin; select id from public.requests where id='{request}' for update;\n")
        blocker.stdin.flush()
        assert blocker.stdout.readline().strip() == request, 'Coordinator lock failed'
        futures = [pool.submit(sql, call, check=False, app=marker+f'-{i}') for i, call in enumerate(calls)]
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            waiting = value(f"select count(*) from pg_stat_activity where application_name in ('{marker}-0','{marker}-1') and wait_event_type='Lock'")
            if waiting == '2':
                break
            time.sleep(.05)
        else:
            raise AssertionError('Both contenders did not reach the request lock')
        if before_release:
            before_release(blocker)
        blocker.stdin.write('commit;\n\\q\n')
        blocker.stdin.flush()
        blocker.communicate(timeout=10)
        return [future.result(timeout=30) for future in futures]
    finally:
        if blocker.poll() is None:
            blocker.kill()
            blocker.communicate()
        pool.shutdown(wait=True)


def decision(offer_id, action, user=None):
    if action == 'accepted':
        return round_decision(offer_id, action, 1, user)
    return as_user(user or users[0], f"select public.decide_request_offer('{offer_id}','{action}')")


def round_decision(offer_id, action, expected_round, user=None, points=10):
    amount = f',{points}' if action == 'accepted' else ''
    return as_user(user or users[0],
        f"select public.decide_request_offer_for_round('{offer_id}','{action}',{expected_round}{amount})")


def reopen(request, expected_round):
    return as_user(users[0],
        f"select public.reopen_my_request('{request}',{expected_round},'2099-01-02T00:00:00Z')")


def renew(offer_id, expected_round, user, points=10):
    return as_user(user,
        f"select public.renew_my_request_offer_for_terms('{offer_id}',{expected_round},{points},'Renewed helper consent')")


def edit_reward(request, points):
    return as_user(users[0],
        f"select public.save_my_request('{request_payload(points)}'::jsonb,'{request}')")


try:
    for user in users:
        sql(f"insert into auth.users(id,email) values('{user}','{user}@offer-test.local'); "
            f"update public.profiles set display_name='Race Tester',major='Computing Science',year_of_study=2,"
            f"campus_id=(select id from public.campuses where slug='burnaby') where id='{user}';")

    request = create_request()
    call = as_user(users[1], f"select public.create_my_request_offer_for_terms('{request}',1,10)")
    results = race(request, [call, call])
    assert all(r.returncode == 0 for r in results)
    assert results[0].stdout.strip().splitlines()[-1] == results[1].stdout.strip().splitlines()[-1]
    assert value(f"select count(*) from public.request_offers where request_id='{request}'") == '1'
    assert value(f"select count(*) from public.offer_notifications where request_id='{request}'") == '1'
    print('PASS concurrent duplicate create: one offer and one event', flush=True)

    request = create_request()
    first, second = offer(request, users[1]), offer(request, users[2])
    results = race(request, [decision(first, 'accepted'), decision(second, 'accepted')])
    assert sum(r.returncode == 0 for r in results) == 1
    assert value(f"select count(*) from public.request_offers where request_id='{request}' and status='accepted'") == '1'
    assert value(f"select count(*) from public.request_offers where request_id='{request}' and status='rejected'") == '1'
    assert value(f"select status from public.requests where id='{request}'") == 'accepted'
    print('PASS simultaneous acceptance: exactly one winner', flush=True)

    request = create_request()
    first = offer(request, users[1])
    results = race(request, [decision(first, 'accepted'), decision(first, 'withdrawn', users[1])])
    assert sum(r.returncode == 0 for r in results) == 1
    state = value(f"select r.status||'/'||o.status from public.requests r join public.request_offers o on o.request_id=r.id where r.id='{request}'")
    assert state in ('accepted/accepted', 'open/withdrawn'), state
    print('PASS withdrawal versus acceptance: consistent final state', flush=True)

    request = create_request()
    first = offer(request, users[1])
    results = race(request, [decision(first, 'accepted'), as_user(users[0], f"select public.cancel_my_request('{request}')")])
    assert sum(r.returncode == 0 for r in results) == 1
    state = value(f"select r.status||'/'||o.status from public.requests r join public.request_offers o on o.request_id=r.id where r.id='{request}'")
    assert state in ('accepted/accepted', 'cancelled/rejected'), state
    print('PASS cancellation versus acceptance: consistent final state', flush=True)

    request = create_request()
    first, second = offer(request, users[1]), offer(request, users[2])

    def expire_while_locked(blocker):
        # Contenders already began their statements. Change deadline before releasing
        # the lock to exercise the post-lock row and clock recheck.
        blocker.stdin.write(f"update public.requests set deadline_at=clock_timestamp()-interval '1 second' where id='{request}';\n")
        blocker.stdin.flush()

    results = race(request, [decision(first, 'accepted'), decision(second, 'accepted')], expire_while_locked)
    assert all(r.returncode != 0 for r in results)
    sql(as_user(users[0], f"select * from public.get_request_offers('{request}')"))
    assert value(f"select status from public.requests where id='{request}'") == 'expired'
    assert value(f"select count(*) from public.request_offers where request_id='{request}' and status='pending'") == '0'
    print('PASS expiry while acceptance waits: neither offer accepted', flush=True)

    request = create_request()
    first = offer(request, users[1])
    sql(round_decision(first, 'accepted', 1))
    call = reopen(request, 1)
    results = race(request, [call, call])
    assert all(r.returncode == 0 for r in results), [r.stderr for r in results]
    assert all(r.stdout.strip().splitlines()[-1] == request for r in results)
    assert value(f"select status||'/'||offer_round from public.requests where id='{request}'") == 'open/2'
    assert value(f"select status||'/'||offer_round from public.request_offers where id='{first}'") == 'rejected/1'
    assert value(f"select count(*) from public.request_offer_history where offer_id='{first}' and status='rejected' and offer_round=1") == '1'
    assert value(f"select count(*) from public.offer_notifications where offer_id='{first}' and event_type='request_reopened' and offer_round=1") == '1'
    print('PASS concurrent duplicate reopen: exactly one new round and one retirement event', flush=True)

    request = create_request()
    first = offer(request, users[1])
    sql(reopen(request, 1))
    call = renew(first, 2, users[1])
    results = race(request, [call, call])
    assert all(r.returncode == 0 for r in results), [r.stderr for r in results]
    assert all(r.stdout.strip().splitlines()[-1] == first for r in results)
    assert value(f"select status||'/'||offer_round from public.request_offers where id='{first}'") == 'pending/2'
    assert value(f"select count(*) from public.request_offers where request_id='{request}'") == '1'
    assert value(f"select count(*) from public.request_offer_history where offer_id='{first}' and status='pending' and offer_round=2") == '1'
    assert value(f"select count(*) from public.request_offer_history where offer_id='{first}'") == '3'
    assert value(f"select count(*) from public.offer_notifications where offer_id='{first}' and event_type='created' and offer_round=2") == '1'
    print('PASS concurrent duplicate renewal: one pending history row and one created event', flush=True)

    request = create_request()
    first = offer(request, users[1])
    results = race(request, [reopen(request, 1), round_decision(first, 'accepted', 1)])
    assert results[0].returncode == 0, results[0].stderr
    if results[1].returncode != 0:
        assert 'Offer has changed' in results[1].stderr, results[1].stderr
    assert value(f"select status||'/'||offer_round from public.requests where id='{request}'") == 'open/2'
    assert value(f"select accepted_at is null from public.requests where id='{request}'") == 't'
    assert value(f"select status||'/'||offer_round from public.request_offers where id='{first}'") == 'rejected/1'
    assert value(f"select count(*) from public.request_offers where request_id='{request}' and status='accepted'") == '0'
    print('PASS reopening versus old-round acceptance: open round two without an accepted helper', flush=True)

    request = create_request()
    first = offer(request, users[1])
    sql(reopen(request, 1))
    results = race(request, [round_decision(first, 'accepted', 1), renew(first, 2, users[1])])
    assert results[0].returncode != 0 and 'Offer has changed' in results[0].stderr, results[0].stderr
    assert results[1].returncode == 0, results[1].stderr
    assert value(f"select status||'/'||offer_round from public.requests where id='{request}'") == 'open/2'
    assert value(f"select status||'/'||offer_round from public.request_offers where id='{first}'") == 'pending/2'
    assert value(f"select count(*) from public.request_offer_history where offer_id='{first}' and offer_round=2") == '1'
    assert value(f"select count(*) from public.offer_notifications where offer_id='{first}' and event_type='created' and offer_round=2") == '1'
    assert value(f"select count(*) from public.offer_notifications where offer_id='{first}' and event_type='accepted'") == '0'
    print('PASS stale round-one decision versus renewal: new pending consent remains untouched', flush=True)

    request = create_request()
    submit = as_user(users[1], f"select public.create_my_request_offer_for_terms('{request}',1,10)")
    results = race(request, [edit_reward(request, 20), submit])
    assert results[0].returncode == 0, results[0].stderr
    assert value(f"select status||'/'||offer_round||'/'||points from public.requests where id='{request}'") == 'open/2/20'
    if results[1].returncode == 0:
        # Submission won the lock, so the following edit must retire that consent.
        assert value(f"select status||'/'||offer_round from public.request_offers where request_id='{request}'") == 'rejected/1'
    else:
        assert 'Request reward has changed' in results[1].stderr, results[1].stderr
        assert value(f"select count(*) from public.request_offers where request_id='{request}'") == '0'
    assert value(f"select count(*) from public.request_offers where request_id='{request}' and status in ('pending','accepted')") == '0'
    assert value(f"select count(*) from public.request_point_reservations where request_id='{request}'") == '0'
    print('PASS reward edit versus initial submission: stale consent rejected or retired', flush=True)

    request = create_request()
    first = offer(request, users[1])
    results = race(request, [edit_reward(request, 20), round_decision(first, 'accepted', 1, points=10)])
    assert sum(r.returncode == 0 for r in results) == 1, [r.stderr for r in results]
    if results[0].returncode == 0:
        assert 'Offer has changed' in results[1].stderr, results[1].stderr
        assert value(f"select status||'/'||offer_round||'/'||points from public.requests where id='{request}'") == 'open/2/20'
        assert value(f"select status||'/'||offer_round from public.request_offers where id='{first}'") == 'rejected/1'
        assert value(f"select count(*) from public.request_point_reservations where request_id='{request}'") == '0'
        assert value(f"select count(*) from public.offer_notifications where offer_id='{first}' and event_type='accepted'") == '0'
    else:
        assert 'Request is no longer editable' in results[0].stderr, results[0].stderr
        assert value(f"select status||'/'||offer_round||'/'||points from public.requests where id='{request}'") == 'accepted/1/10'
        assert value(f"select status||'/'||offer_round from public.request_offers where id='{first}'") == 'accepted/1'
        assert value(f"select status||'/'||offer_round||'/'||amount from public.request_point_reservations where request_id='{request}'") == 'reserved/1/10'
        # Release the accepted fixture so later checks retain sufficient funds.
        sql(reopen(request, 1))
    print('PASS reward edit versus stale acceptance: changed reward never accepted on old consent', flush=True)

    request = create_request()
    first = offer(request, users[1])
    sql(reopen(request, 1))
    results = race(request, [edit_reward(request, 20), renew(first, 2, users[1], points=10)])
    assert results[0].returncode == 0, results[0].stderr
    assert value(f"select status||'/'||offer_round||'/'||points from public.requests where id='{request}'") == 'open/3/20'
    if results[1].returncode == 0:
        # Renewal won the lock, but its old reward confirmation is then retired.
        assert value(f"select status||'/'||offer_round from public.request_offers where id='{first}'") == 'rejected/2'
        assert value(f"select count(*) from public.request_offer_history where offer_id='{first}' and offer_round=2 and status='pending'") == '1'
        assert value(f"select count(*) from public.request_offer_history where offer_id='{first}' and offer_round=2 and status='rejected'") == '1'
    else:
        assert 'Request reward has changed' in results[1].stderr, results[1].stderr
        assert value(f"select status||'/'||offer_round from public.request_offers where id='{first}'") == 'rejected/1'
        assert value(f"select count(*) from public.request_offer_history where offer_id='{first}' and offer_round=2") == '0'
    assert value(f"select count(*) from public.request_offers where request_id='{request}' and status in ('pending','accepted')") == '0'
    assert value(f"select count(*) from public.request_point_reservations where request_id='{request}'") == '0'
    print('PASS reward edit versus renewal: refreshed round requires fresh reward confirmation', flush=True)
finally:
    if requests:
        sql('delete from public.requests where id in (' + ','.join(f"'{r}'" for r in requests) + ')')
    for user in users:
        sql(f"delete from auth.users where id='{user}'")
    print('Temporary concurrency fixtures removed.', flush=True)
