"""Local-only mutual-rating races with temporary fixtures and deterministic locks.

Run: python scripts/test-request-ratings-concurrency.py
Both contenders must reach the request lock before the coordinator releases it.
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
users = [str(uuid.uuid4()) for _ in range(2)]


def sql(query, *, check=True, app='ratings-fixtures'):
    result = subprocess.run(ARGS + ['-c', query], env=dict(ENV, PGAPPNAME=app),
                            capture_output=True, text=True, timeout=30)
    if check and result.returncode:
        raise AssertionError(result.stderr)
    return result


def value(query):
    return sql(query).stdout.strip().splitlines()[-1]


def as_user(user, query):
    return f"begin; set local role authenticated; select set_config('request.jwt.claim.sub','{user}',true); {query}; commit;"


def fixture(completed=True):
    campus = value("select id from public.campuses where slug='burnaby'")
    payload = json.dumps(dict(category='delivery', title='Mutual rating race',
        description='Temporary ratings concurrency fixture.', campus_id=campus,
        room_location='Library', deadline_at='2099-01-01T00:00:00Z', points=10,
        item_size='small', details=dict(pickup_location='Cafe', dropoff_location='Library')))
    request = value(as_user(users[0], f"select public.save_my_request('{payload}'::jsonb)"))
    offer = value(as_user(users[1], f"select public.create_my_request_offer_for_terms('{request}',1,10)"))
    sql(as_user(users[0], f"select public.decide_request_offer_for_round('{offer}','accepted',1,10)"))
    if completed:
        sql(as_user(users[0], f"select public.complete_my_request('{request}',1)"))
    return request


def rate(user, request, score):
    return as_user(user, f"select public.submit_request_rating('{request}',1,{score})")


def context(user, request):
    return json.loads(value(as_user(user, f"select public.get_request_rating_context('{request}')")))


def race(request, calls):
    marker = 'ratings-' + uuid.uuid4().hex
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


def ratings(request):
    return json.loads(value(f"select coalesce(jsonb_agg(to_jsonb(r) order by rater_id),'[]') from public.request_ratings r where request_id='{request}'"))


def financial_snapshot():
    ids = ','.join(f"'{user}'" for user in users)
    return value("select jsonb_build_object("
        "'wallets',(select jsonb_agg(to_jsonb(w) order by profile_id) "
        f"from public.points_wallets w where profile_id in ({ids})),"
        "'ledger',(select jsonb_agg(to_jsonb(l) order by id) "
        f"from public.points_ledger l where profile_id in ({ids})))")


try:
    for user in users:
        sql(f"insert into auth.users(id,email) values('{user}','{user}@ratings-race.local'); "
            f"update public.profiles set display_name='Ratings Race Tester',major='Testing',year_of_study=2,"
            f"campus_id=(select id from public.campuses where slug='burnaby') where id='{user}';")

    request = fixture()
    before = financial_snapshot()
    results = race(request, [rate(users[0], request, 4), rate(users[0], request, 4)])
    assert all(r.returncode == 0 for r in results), [r.stderr for r in results]
    rows = ratings(request)
    assert len(rows) == 1 and rows[0]['score'] == 4 and rows[0]['published_at'] is None
    assert context(users[1], request)['received_score'] is None
    assert financial_snapshot() == before
    print('PASS overlapping exact retries create one private rating and no financial changes', flush=True)

    request = fixture()
    before = financial_snapshot()
    results = race(request, [rate(users[0], request, 1), rate(users[0], request, 5)])
    assert sum(r.returncode == 0 for r in results) == 1, [r.stderr for r in results]
    rows = ratings(request)
    assert len(rows) == 1 and rows[0]['score'] in (1, 5) and rows[0]['published_at'] is None
    winning_score = 1 if results[0].returncode == 0 else 5
    assert rows[0]['score'] == winning_score
    assert financial_snapshot() == before
    print('PASS conflicting overlapping scores preserve only the first committed choice', flush=True)

    request = fixture()
    before = financial_snapshot()
    results = race(request, [rate(users[0], request, 5), rate(users[1], request, 3)])
    assert all(r.returncode == 0 for r in results), [r.stderr for r in results]
    rows = ratings(request)
    assert len(rows) == 2 and rows[0]['published_at'] is not None
    assert rows[0]['published_at'] == rows[1]['published_at']
    assert context(users[0], request)['received_score'] == 3
    assert context(users[1], request)['received_score'] == 5
    assert financial_snapshot() == before
    print('PASS simultaneous mutual submissions publish both directions atomically', flush=True)

    request = fixture()
    sql(rate(users[0], request, 2))
    before = financial_snapshot()
    results = race(request, [rate(users[1], request, 4),
        as_user(users[0], f"select public.set_my_request_archived('{request}',true)")])
    assert all(r.returncode == 0 for r in results), [r.stderr for r in results]
    assert len(ratings(request)) == 2
    assert context(users[1], request)['published']
    assert value(f"select owner_archived_at is not null from public.requests where id='{request}'") == 't'
    assert financial_snapshot() == before
    print('PASS archive versus final rating preserves published history without changing payment', flush=True)

    request = fixture(completed=False)
    results = race(request, [rate(users[1], request, 5),
        as_user(users[0], f"select public.complete_my_request('{request}',1)")])
    assert results[1].returncode == 0, results[1].stderr
    rows = ratings(request)
    assert len(rows) == (1 if results[0].returncode == 0 else 0)
    assert value(f"select status from public.request_point_reservations where request_id='{request}'") == 'settled'
    assert value(f"select count(*) from public.points_ledger where request_id='{request}'") == '2'
    sql(rate(users[1], request, 5))
    assert len(ratings(request)) == 1 and not context(users[1], request)['published']
    print('PASS completion versus rating allows a score only after settlement and supports retry', flush=True)
finally:
    sql('delete from public.requests where owner_id in (' + ','.join(f"'{u}'" for u in users) + ')')
    for user in users:
        sql(f"delete from auth.users where id='{user}'")
    print('Temporary ratings concurrency fixtures removed.', flush=True)
