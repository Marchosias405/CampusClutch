"""Local-only cancellation/rating races with deterministic parent-row contention.

Run: python scripts/test-request-cancelled-ratings-concurrency.py
Temporary accounts and their requests are removed even if an assertion fails.
Both calls must block on the request before the coordinator releases the lock.
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


def sql(query, *, check=True, app='cancelled-rating-fixtures'):
    result = subprocess.run(ARGS + ['-c', query], env=dict(ENV, PGAPPNAME=app),
                            capture_output=True, text=True, timeout=30)
    if check and result.returncode:
        raise AssertionError(result.stderr)
    return result


def value(query):
    return sql(query).stdout.strip().splitlines()[-1]


def as_user(user, query):
    return f"begin; set local role authenticated; select set_config('request.jwt.claim.sub','{user}',true); {query}; commit;"


def fixture():
    campus = value("select id from public.campuses where slug='burnaby'")
    payload = json.dumps(dict(category='delivery', title='Cancelled rating race',
        description='Temporary cancellation and rating concurrency fixture.', campus_id=campus,
        room_location='Library', deadline_at='2099-01-01T00:00:00Z', points=10,
        item_size='small', details=dict(pickup_location='Cafe', dropoff_location='Library')))
    request = value(as_user(users[0], f"select public.save_my_request('{payload}'::jsonb)"))
    offer = value(as_user(users[1], f"select public.create_my_request_offer_for_terms('{request}',1,10)"))
    sql(as_user(users[0], f"select public.decide_request_offer_for_round('{offer}','accepted',1,10)"))
    return request, offer


def remove_request(request):
    sql(f"delete from public.requests where id='{request}' and owner_id='{users[0]}'")


def cancel(request):
    return as_user(users[1], f"select public.cancel_my_accepted_help('{request}',1)")


def owner_cancel(request, round_number=1, status='accepted'):
    return as_user(users[0], f"select public.cancel_my_request_for_round('{request}',{round_number},'{status}')")


def rate(user, request, score):
    return as_user(user, f"select public.submit_request_rating('{request}',1,{score})")


def wallet(user):
    return tuple(map(int, value(f"select balance||'/'||reserved from public.points_wallets where profile_id='{user}'").split('/')))


def context(user, request):
    return json.loads(value(as_user(user,
        f"select c from public.get_my_request_rating_contexts('{request}') c where (c->>'offer_round')::integer=1")))


def state(request):
    return value(f"select status||'/'||offer_round from public.requests where id='{request}'")


def reservation(request):
    return value(f"select status from public.request_point_reservations where request_id='{request}' and offer_round=1")


def ledger_count(request):
    return int(value(f"select count(*) from public.points_ledger where request_id='{request}'"))


def ratings(request):
    return json.loads(value(f"select coalesce(jsonb_agg(to_jsonb(r) order by rater_id),'[]') from public.request_ratings r where request_id='{request}' and offer_round=1"))


def race(request, calls):
    marker = 'cancel-rate-' + uuid.uuid4().hex
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
            raise AssertionError('Both contenders did not reach the database lock')
        blocker.stdin.write('commit;\n\\q\n')
        blocker.stdin.flush()
        blocker.communicate(timeout=10)
        return [future.result(timeout=30) for future in futures]
    finally:
        if blocker.poll() is None:
            blocker.kill()
            blocker.communicate()
        pool.shutdown(wait=True)


try:
    for user in users:
        sql(f"insert into auth.users(id,email) values('{user}','{user}@cancelled-rating-race.local'); "
            f"update public.profiles set display_name='Cancelled Rating Race Tester',major='Testing',year_of_study=2,"
            f"campus_id=(select id from public.campuses where slug='burnaby') where id='{user}';")

    request, offer = fixture()
    results = race(request, [cancel(request), cancel(request)])
    assert all(r.returncode == 0 for r in results), [r.stderr for r in results]
    assert state(request) == 'open/2' and reservation(request) == 'released'
    assert wallet(users[0]) == (100, 0) and wallet(users[1]) == (100, 0)
    assert ledger_count(request) == 0
    assert value(f"select count(*) from public.request_offer_history where offer_id='{offer}' and status='withdrawn'") == '1'
    assert context(users[0], request)['outcome'] == 'cancelled'
    print('PASS overlapping helper cancellation retries reopen once and release one hold', flush=True)
    remove_request(request)

    request, offer = fixture()
    owner_before, helper_before = wallet(users[0])[0], wallet(users[1])[0]
    results = race(request, [cancel(request),
        as_user(users[0], f"select public.complete_my_request('{request}',1)")])
    assert sum(r.returncode == 0 for r in results) == 1, [r.stderr for r in results]
    if state(request) == 'completed/1':
        assert reservation(request) == 'settled' and ledger_count(request) == 2
        assert wallet(users[0]) == (owner_before-10, 0) and wallet(users[1]) == (helper_before+10, 0)
        assert context(users[1], request)['outcome'] == 'completed'
    else:
        assert state(request) == 'open/2' and reservation(request) == 'released'
        assert ledger_count(request) == 0
        assert wallet(users[0]) == (owner_before, 0) and wallet(users[1]) == (helper_before, 0)
        assert context(users[1], request)['outcome'] == 'cancelled'
    print('PASS helper cancellation versus completion produces release or payment, never both', flush=True)
    remove_request(request)

    request, offer = fixture()
    before = [wallet(user)[0] for user in users]
    results = race(request, [cancel(request), owner_cancel(request)])
    assert sum(r.returncode == 0 for r in results) == 1, [r.stderr for r in results]
    assert state(request) in ('open/2', 'cancelled/1')
    assert reservation(request) == 'released' and ledger_count(request) == 0
    assert [wallet(user) for user in users] == [(balance, 0) for balance in before]
    assert context(users[1], request)['outcome'] == 'cancelled'
    assert value(f"select count(*) from public.request_offer_history where offer_id='{offer}' and status in ('withdrawn','rejected')") == '1'
    print('PASS helper versus owner cancellation closes the accepted assignment only once', flush=True)
    remove_request(request)

    request, offer = fixture()
    before = [wallet(user)[0] for user in users]
    results = race(request, [cancel(request),
        as_user(users[0], f"select public.reopen_my_request('{request}',1,'2099-02-01T00:00:00Z')")])
    assert sum(r.returncode == 0 for r in results) == 1, [r.stderr for r in results]
    assert state(request) == 'open/2' and reservation(request) == 'released' and ledger_count(request) == 0
    assert [wallet(user) for user in users] == [(balance, 0) for balance in before]
    expected_deadline = '2099-01-01' if results[0].returncode == 0 else '2099-02-01'
    assert value(f"select deadline_at::date from public.requests where id='{request}'") == expected_deadline
    assert context(users[1], request)['outcome'] == 'cancelled'
    print('PASS helper cancellation versus owner reopening respects the winning deadline and one round increment', flush=True)
    remove_request(request)

    request, offer = fixture()
    results = race(request, [cancel(request), rate(users[0], request, 2)])
    assert results[0].returncode == 0, results[0].stderr
    assert state(request) == 'open/2' and reservation(request) == 'released' and ledger_count(request) == 0
    assert len(ratings(request)) == (1 if results[1].returncode == 0 else 0)
    sql(rate(users[0], request, 2))
    assert len(ratings(request)) == 1 and not context(users[0], request)['published']
    print('PASS cancellation versus first rating allows stars only after release and supports retry', flush=True)
    remove_request(request)

    request, offer = fixture()
    sql(cancel(request))
    sql(rate(users[0], request, 3))
    next_offer = value(as_user(users[2], f"select public.create_my_request_offer_for_terms('{request}',2,10)"))
    before = [wallet(user)[0] for user in users]
    results = race(request, [rate(users[1], request, 4),
        as_user(users[0], f"select public.decide_request_offer_for_round('{next_offer}','accepted',2,10)")])
    assert all(r.returncode == 0 for r in results), [r.stderr for r in results]
    assert state(request) == 'accepted/2' and reservation(request) == 'released' and ledger_count(request) == 0
    assert value(f"select status from public.request_point_reservations where request_id='{request}' and offer_round=2") == 'reserved'
    assert wallet(users[0]) == (before[0], 10)
    assert [wallet(user) for user in users[1:]] == [(balance, 0) for balance in before[1:]]
    rows = ratings(request)
    assert len(rows) == 2 and rows[0]['published_at'] == rows[1]['published_at'] and rows[0]['published_at'] is not None
    assert context(users[1], request)['received_score'] == 3
    # A delayed old cancellation may not release the new helper's hold.
    sql(cancel(request))
    assert state(request) == 'accepted/2' and wallet(users[0]) == (before[0], 10)
    sql(owner_cancel(request, 2))
    print('PASS historical rating versus new acceptance serializes on the parent without crossing assignments', flush=True)
    remove_request(request)

    request, offer = fixture()
    sql(cancel(request))
    sql(owner_cancel(request, 2, 'open'))
    sql(rate(users[0], request, 2))
    before = [wallet(user) for user in users]
    results = race(request, [rate(users[1], request, 5),
        as_user(users[0], f"select public.set_my_request_archived('{request}',true)")])
    assert all(r.returncode == 0 for r in results), [r.stderr for r in results]
    assert value(f"select owner_archived_at is not null from public.requests where id='{request}'") == 't'
    assert context(users[1], request)['published'] and context(users[1], request)['received_score'] == 2
    assert [wallet(user) for user in users] == before and ledger_count(request) == 0
    print('PASS archive versus final historical cancelled rating preserves blind publication and all balances', flush=True)
    remove_request(request)

    request, offer = fixture()
    sql(cancel(request))
    before = [wallet(user) for user in users]
    results = race(request, [rate(users[0], request, 1), rate(users[0], request, 5)])
    assert sum(r.returncode == 0 for r in results) == 1, [r.stderr for r in results]
    rows = ratings(request)
    assert len(rows) == 1 and rows[0]['score'] == (1 if results[0].returncode == 0 else 5)
    assert rows[0]['published_at'] is None and context(users[1], request)['received_score'] is None
    assert [wallet(user) for user in users] == before and ledger_count(request) == 0
    print('PASS conflicting historical cancelled scores preserve the first committed choice privately', flush=True)
    remove_request(request)
finally:
    sql('delete from public.requests where owner_id in (' + ','.join(f"'{u}'" for u in users) + ')')
    for user in users:
        sql(f"delete from auth.users where id='{user}'")
    print('Temporary cancelled-rating concurrency fixtures removed.', flush=True)
