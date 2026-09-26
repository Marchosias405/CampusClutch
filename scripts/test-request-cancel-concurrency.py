"""Local-only cancellation races; temporary accounts and all their rows are removed.

Run: python scripts/test-request-cancel-concurrency.py
The coordinator observes both calls blocked on the request row before releasing
them, so each case checks a real overlapping transition rather than timing luck.
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


def sql(query, *, check=True, app='cancel-fixtures'):
    result = subprocess.run(ARGS + ['-c', query], env=dict(ENV, PGAPPNAME=app),
                            capture_output=True, text=True, timeout=30)
    if check and result.returncode:
        raise AssertionError(result.stderr)
    return result


def value(query):
    return sql(query).stdout.strip().splitlines()[-1]


def as_owner(query):
    return as_user(users[0], query)


def as_user(user, query):
    return f"begin; set local role authenticated; select set_config('request.jwt.claim.sub','{user}',true); {query}; commit;"


def fixture(accepted=True):
    campus = value("select id from public.campuses where slug='burnaby'")
    payload = json.dumps(dict(category='delivery', title='Cancellation race',
        description='Temporary cancellation concurrency fixture.', campus_id=campus,
        room_location='Library', deadline_at='2099-01-01T00:00:00Z', points=10,
        item_size='small', details=dict(pickup_location='Cafe', dropoff_location='Library')))
    request = value(as_owner(f"select public.save_my_request('{payload}'::jsonb)"))
    offer = value(as_user(users[1], f"select public.create_my_request_offer_for_terms('{request}',1,10)"))
    if accepted:
        sql(as_owner(f"select public.decide_request_offer_for_round('{offer}','accepted',1,10)"))
    return request, offer


def cancel(request, status='accepted'):
    return as_owner(f"select public.cancel_my_request_for_round('{request}',1,'{status}')")


def wallet(user):
    return tuple(map(int, value(f"select balance||'/'||reserved from public.points_wallets where profile_id='{user}'").split('/')))


def race(request, calls):
    marker = 'cancel-' + uuid.uuid4().hex
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


def reservation_state(request):
    return value(f"select status from public.request_point_reservations where request_id='{request}'")


def ledger_count(request):
    return int(value(f"select count(*) from public.points_ledger where request_id='{request}'"))


try:
    for user in users:
        sql(f"insert into auth.users(id,email) values('{user}','{user}@cancel-test.local'); "
            f"update public.profiles set display_name='Cancel Race Tester',major='Testing',year_of_study=2,"
            f"campus_id=(select id from public.campuses where slug='burnaby') where id='{user}';")

    request, offer = fixture()
    results = race(request, [cancel(request), cancel(request)])
    assert all(r.returncode == 0 for r in results), [r.stderr for r in results]
    assert wallet(users[0]) == (100, 0) and wallet(users[1]) == (100, 0)
    assert reservation_state(request) == 'released' and ledger_count(request) == 0
    assert value(f"select count(*) from public.request_offer_history where offer_id='{offer}' and status='rejected'") == '1'
    print('PASS overlapping cancellation retries release one hold and record one closure', flush=True)

    request, offer = fixture()
    owner_before, helper_before = wallet(users[0])[0], wallet(users[1])[0]
    results = race(request, [cancel(request), as_owner(f"select public.complete_my_request('{request}',1)")])
    assert sum(r.returncode == 0 for r in results) == 1, [r.stderr for r in results]
    state = value(f"select status from public.requests where id='{request}'")
    if state == 'completed':
        assert wallet(users[0]) == (owner_before-10, 0) and wallet(users[1]) == (helper_before+10, 0)
        assert reservation_state(request) == 'settled' and ledger_count(request) == 2
    else:
        assert state == 'cancelled'
        assert wallet(users[0]) == (owner_before, 0) and wallet(users[1]) == (helper_before, 0)
        assert reservation_state(request) == 'released' and ledger_count(request) == 0
    print('PASS cancellation versus completion has one winner: release or payment, never both', flush=True)

    request, offer = fixture()
    owner_before, helper_before = wallet(users[0])[0], wallet(users[1])[0]
    results = race(request, [cancel(request), as_owner(f"select public.reopen_my_request('{request}',1,'2099-02-01T00:00:00Z')")])
    assert sum(r.returncode == 0 for r in results) == 1, [r.stderr for r in results]
    state = value(f"select status||'/'||offer_round from public.requests where id='{request}'")
    assert state in ('cancelled/1', 'open/2'), state
    assert wallet(users[0]) == (owner_before, 0) and wallet(users[1]) == (helper_before, 0)
    assert reservation_state(request) == 'released' and ledger_count(request) == 0
    assert value(f"select status from public.request_offers where id='{offer}'") == 'rejected'
    print('PASS cancellation versus reopening cannot cancel a fresh round or release twice', flush=True)

    request, offer = fixture(accepted=False)
    owner_before, helper_before = wallet(users[0])[0], wallet(users[1])[0]
    results = race(request, [cancel(request, 'open'), as_owner(f"select public.decide_request_offer_for_round('{offer}','accepted',1,10)")])
    assert sum(r.returncode == 0 for r in results) == 1, [r.stderr for r in results]
    state = value(f"select status from public.requests where id='{request}'")
    assert ledger_count(request) == 0 and wallet(users[1]) == (helper_before, 0)
    if state == 'accepted':
        assert wallet(users[0]) == (owner_before, 10) and reservation_state(request) == 'reserved'
        assert value(f"select status from public.request_offers where id='{offer}'") == 'accepted'
    else:
        assert state == 'cancelled' and wallet(users[0]) == (owner_before, 0)
        assert value(f"select count(*) from public.request_point_reservations where request_id='{request}'") == '0'
        assert value(f"select status from public.request_offers where id='{offer}'") == 'rejected'
    print('PASS open cancellation versus acceptance cannot silently cancel newly accepted work', flush=True)
finally:
    sql('delete from public.requests where owner_id in (' + ','.join(f"'{u}'" for u in users) + ')')
    for user in users:
        sql(f"delete from auth.users where id='{user}'")
    print('Temporary cancellation concurrency fixtures removed.', flush=True)
