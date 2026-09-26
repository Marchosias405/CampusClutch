"""Local-only Task 10 direct-message races with deterministic database locks.

Run: python scripts/test-messages-concurrency.py
The coordinator observes both operations waiting on their actual pair or parent
lock before releasing them. Only isolated temporary fixture rows are removed.
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
users = [str(uuid.uuid4()) for _ in range(4)]


def sql(query, *, check=True, app='messaging-fixtures'):
    result = subprocess.run(ARGS + ['-c', query], env=dict(ENV, PGAPPNAME=app),
                            capture_output=True, text=True, timeout=30)
    if check and result.returncode:
        raise AssertionError(result.stderr)
    return result


def value(query):
    return sql(query).stdout.strip().splitlines()[-1]


def as_user(user, query):
    return f"begin; set local role authenticated; select set_config('request.jwt.claim.sub','{user}',true); {query}; commit;"


def returned(result):
    assert result.returncode == 0, result.stderr
    return result.stdout.strip().splitlines()[-1]


def conversation(first, second):
    return value(as_user(first, f"select public.start_direct_conversation('{second}')"))


def send(user, conv, key, body):
    escaped = body.replace("'", "''")
    return as_user(user, f"select public.send_conversation_message('{conv}','{key}','{escaped}')")


def summary(user, conv):
    return json.loads(value(as_user(user, f"select public.get_conversation_summary('{conv}')")))


def messages(conv):
    return json.loads(value(f"select coalesce(jsonb_agg(to_jsonb(m) order by sequence),'[]') from public.messages m where conversation_id='{conv}'"))


def sequence(conv):
    return int(value(f"select last_message_sequence from public.conversations where id='{conv}'"))


def conversation_lock(*ids):
    literals = ','.join(f"'{conv}'" for conv in ids)
    return f"do $lock$ begin perform 1 from public.conversations where id in ({literals}) order by id for update; end $lock$;"


def pair_lock(first, second):
    low, high = sorted((first, second))
    return ("do $lock$ begin perform pg_advisory_xact_lock(hashtextextended("
            f"'campusclutch:direct:{low}:{high}',0)); end $lock$;")


def race(lock_query, calls):
    marker = 'messages-' + uuid.uuid4().hex
    blocker = subprocess.Popen(ARGS, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True, env=dict(ENV, PGAPPNAME=marker+'-blocker'))
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=2)
    try:
        blocker.stdin.write(f"begin; {lock_query} select 'locked';\n")
        blocker.stdin.flush()
        assert blocker.stdout.readline().strip() == 'locked', 'Coordinator lock failed'
        futures = [pool.submit(sql, call, check=False, app=marker+f'-{i}') for i, call in enumerate(calls)]
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            waiting = value(f"select count(*) from pg_stat_activity where application_name in ('{marker}-0','{marker}-1') and wait_event_type='Lock'")
            if waiting == '2':
                break
            time.sleep(.05)
        else:
            raise AssertionError('Both contenders did not reach their database lock')
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
        sql(f"insert into auth.users(id,email) values('{user}','{user}@messaging-race.local'); "
            f"update public.profiles set display_name='Messaging Race Tester',major='Testing',year_of_study=2,"
            f"is_discoverable=true,campus_id=(select id from public.campuses where slug='burnaby') where id='{user}';")

    results = race(pair_lock(users[0], users[1]), [
        as_user(users[0], f"select public.start_direct_conversation('{users[1]}')"),
        as_user(users[1], f"select public.start_direct_conversation('{users[0]}')")])
    first, second = map(returned, results)
    assert first == second
    ab = first
    assert value(f"select count(*) from public.direct_conversation_pairs where conversation_id='{ab}'") == '1'
    assert value(f"select count(*) from public.conversation_members where conversation_id='{ab}'") == '2'
    assert sequence(ab) == 0 and messages(ab) == []
    print('PASS reversed simultaneous pair creation returns one conversation and exactly two memberships', flush=True)

    key = str(uuid.uuid4())
    results = race(conversation_lock(ab), [send(users[0], ab, key, 'One retry-safe message'),
                                         send(users[0], ab, key, 'One retry-safe message')])
    first, second = [json.loads(returned(result)) for result in results]
    assert first == second and first['sequence'] == '1'
    assert sequence(ab) == 1 and len(messages(ab)) == 1
    assert summary(users[0], ab)['unread_count'] == 0
    assert summary(users[1], ab)['unread_count'] == 1
    print('PASS identical overlapping sends persist one message, one sequence and one unread item', flush=True)

    key = str(uuid.uuid4())
    results = race(conversation_lock(ab), [send(users[0], ab, key, 'First proposed body'),
                                         send(users[0], ab, key, 'Conflicting proposed body')])
    assert sum(result.returncode == 0 for result in results) == 1, [r.stderr for r in results]
    winner = next(json.loads(returned(result)) for result in results if result.returncode == 0)
    assert winner['sequence'] == '2' and sequence(ab) == 2 and len(messages(ab)) == 2
    assert messages(ab)[-1]['body'] == winner['body']
    print('PASS conflicting overlapping retry bodies preserve only the winning original message', flush=True)

    results = race(conversation_lock(ab), [send(users[0], ab, str(uuid.uuid4()), 'From A'),
                                         send(users[1], ab, str(uuid.uuid4()), 'From B')])
    sent = [json.loads(returned(result)) for result in results]
    assert sorted(message['sequence'] for message in sent) == ['3', '4']
    rows = messages(ab)
    assert [message['sequence'] for message in rows] == [1, 2, 3, 4]
    assert rows[-2]['created_at'] <= rows[-1]['created_at']
    assert sequence(ab) == 4 and summary(users[0], ab)['last_message_body'] == rows[-1]['body']
    print('PASS simultaneous distinct senders receive unique ordered sequences and a consistent latest preview', flush=True)

    ac = conversation(users[0], users[2])
    ad = conversation(users[0], users[3])
    key = str(uuid.uuid4())
    results = race(conversation_lock(ac, ad), [send(users[0], ac, key, 'Same key across threads'),
                                             send(users[0], ad, key, 'Same key across threads')])
    assert sum(result.returncode == 0 for result in results) == 1, [r.stderr for r in results]
    winner_index = next(index for index, result in enumerate(results) if result.returncode == 0)
    winner, loser = (ac, ad) if winner_index == 0 else (ad, ac)
    assert sequence(winner) == 1 and len(messages(winner)) == 1
    assert sequence(loser) == 0 and messages(loser) == []
    assert value(f"select count(*) from public.messages where sender_id='{users[0]}' and client_message_id='{key}'") == '1'
    print('PASS one sender UUID raced across two conversations commits once without changing the losing summary', flush=True)

    # The next tests use a fresh pair so exact unread counts are independent.
    bc = conversation(users[1], users[2])
    sql(send(users[1], bc, str(uuid.uuid4()), 'Already loaded'))
    results = race(conversation_lock(bc), [
        as_user(users[2], f"select public.mark_conversation_read('{bc}',1)"),
        send(users[1], bc, str(uuid.uuid4()), 'Arrived during read')])
    assert all(result.returncode == 0 for result in results), [r.stderr for r in results]
    receiver = summary(users[2], bc)
    assert receiver['last_read_sequence'] == '1' and receiver['last_message_sequence'] == '2'
    assert receiver['unread_count'] == 1 and summary(users[1], bc)['unread_count'] == 0
    print('PASS read/send overlap cannot mark the concurrently arriving message read accidentally', flush=True)

    results = race(conversation_lock(bc), [
        as_user(users[2], f"select public.mark_conversation_read('{bc}',3)"),
        send(users[1], bc, str(uuid.uuid4()), 'Next actual message')])
    assert results[1].returncode == 0, results[1].stderr
    receiver = summary(users[2], bc)
    if results[0].returncode == 0:
        assert receiver['last_read_sequence'] == '3' and receiver['unread_count'] == 0
    else:
        assert receiver['last_read_sequence'] == '1' and receiver['unread_count'] == 2
    assert sequence(bc) == 3
    print('PASS future-cursor race advances only if that message has actually committed first', flush=True)

    results = race(conversation_lock(bc), [
        as_user(users[2], f"select public.mark_conversation_read('{bc}',2)"),
        as_user(users[2], f"select public.mark_conversation_read('{bc}',3)")])
    assert all(result.returncode == 0 for result in results), [r.stderr for r in results]
    assert summary(users[2], bc)['last_read_sequence'] == '3'
    assert summary(users[2], bc)['unread_count'] == 0
    print('PASS concurrent out-of-order read acknowledgements preserve the highest observed cursor', flush=True)

    # Historical request access and cancellation share the same request lock.
    campus = value("select id from public.campuses where slug='burnaby'")
    payload = json.dumps(dict(category='delivery', title='Messaging assignment race',
        description='Temporary request conversation concurrency fixture.', campus_id=campus,
        room_location='Library', deadline_at='2099-01-01T00:00:00Z', points=10,
        item_size='small', details=dict(pickup_location='Cafe', dropoff_location='Library')))
    request = value(as_user(users[0], f"select public.save_my_request('{payload}'::jsonb)"))
    offer = value(as_user(users[1], f"select public.create_my_request_offer_for_terms('{request}',1,10)"))
    sql(as_user(users[0], f"select public.decide_request_offer_for_round('{offer}','accepted',1,10)"))
    request_lock = f"do $lock$ begin perform 1 from public.requests where id='{request}' for update; end $lock$;"
    results = race(request_lock, [
        as_user(users[0], f"select public.open_request_conversation('{request}',1)"),
        as_user(users[1], f"select public.open_request_conversation('{request}',1)")])
    assert all(returned(result) == ab for result in results)
    assert value(f"select count(*) from public.request_conversations where request_id='{request}' and offer_round=1") == '1'
    print('PASS simultaneous assignment participants create one round link to their existing direct pair', flush=True)

    results = race(request_lock, [
        as_user(users[1], f"select public.cancel_my_accepted_help('{request}',1)"),
        as_user(users[0], f"select public.open_request_conversation('{request}',1)")])
    assert all(result.returncode == 0 for result in results), [r.stderr for r in results]
    assert returned(results[1]) == ab
    assert value(f"select status||'/'||offer_round from public.requests where id='{request}'") == 'open/2'
    assert value(f"select status from public.request_point_reservations where request_id='{request}' and offer_round=1") == 'released'
    assert value(f"select count(*) from public.request_conversations where request_id='{request}'") == '1'
    assert value(f"select count(*) from public.points_ledger where request_id='{request}'") == '0'
    print('PASS cancellation versus request-chat opening preserves the original participants and released assignment', flush=True)
finally:
    # Restrictive foreign keys retain normal history; only this script's fixture
    # graph is deleted here, child-first, before removing its temporary accounts.
    user_list = ','.join(f"'{user}'" for user in users)
    owned = f"select id from public.conversations where created_by in ({user_list})"
    sql(f"delete from public.request_conversations where conversation_id in ({owned}); "
        f"delete from public.messages where conversation_id in ({owned}); "
        f"delete from public.direct_conversation_pairs where conversation_id in ({owned}); "
        f"delete from public.conversation_members where conversation_id in ({owned}); "
        f"delete from public.conversations where created_by in ({user_list}); "
        f"delete from public.requests where owner_id in ({user_list});")
    for user in users:
        sql(f"delete from auth.users where id='{user}'")
    print('Temporary messaging concurrency fixtures removed.', flush=True)
