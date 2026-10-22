"""Local-only group-message races coordinated at the real database locks.

Run: python scripts/test-group-messages-concurrency.py
The script refuses hosted access, creates isolated accounts/course/groups, waits
until both contenders block on the reviewed advisory/conversation lock, and
removes only its own fixtures in ``finally``.
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
users = [str(uuid.uuid4()) for _ in range(23)]
course_id = str(uuid.uuid4())


def sql(query, *, check=True, app='group-message-fixtures'):
    result = subprocess.run(ARGS + ['-c', query], env=dict(ENV, PGAPPNAME=app),
                            capture_output=True, text=True, timeout=40)
    if check and result.returncode:
        raise AssertionError(result.stderr)
    return result


def value(query):
    output = sql(query).stdout.strip().splitlines()
    return output[-1] if output else ''


def as_user(user, query):
    return ("begin; set local role authenticated; "
            f"select set_config('request.jwt.claim.sub','{user}',true); {query}; commit;")


def returned(result):
    assert result.returncode == 0, result.stderr
    return result.stdout.strip().splitlines()[-1]


def uuid_array(values):
    return 'array[' + ','.join(f"'{item}'::uuid" for item in values) + ']'


def create_group(actor, key, title, invitees):
    escaped = title.replace("'", "''")
    return as_user(actor, "select public.create_group_conversation("
                   f"'{key}','{course_id}','{escaped}',{uuid_array(invitees)})")


def invite(actor, conversation, key, target, expected_revision):
    return as_user(actor, "select public.invite_group_member("
                   f"'{conversation}','{key}','{target}',{expected_revision})")


def respond(actor, invitation, decision='accepted'):
    return as_user(actor, "select public.respond_to_group_invitation("
                   f"'{invitation}','{decision}')")


def send(actor, conversation, key, body):
    escaped = body.replace("'", "''")
    return as_user(actor, "select public.send_conversation_message("
                   f"'{conversation}','{key}','{escaped}')")


def group_create_lock(actor, key):
    return ("do $lock$ begin perform pg_advisory_xact_lock(hashtextextended("
            f"'campusclutch:group:{actor}:{key}',0)); end $lock$;")


def conversation_lock(conversation):
    return ("do $lock$ begin perform 1 from public.conversations "
            f"where id='{conversation}' for update; end $lock$;")


def race(lock_query, calls):
    marker = 'group-messages-' + uuid.uuid4().hex
    blocker = subprocess.Popen(ARGS, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True, env=dict(ENV, PGAPPNAME=marker + '-blocker'))
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=len(calls))
    try:
        blocker.stdin.write(f"begin; {lock_query} select 'locked';\n")
        blocker.stdin.flush()
        assert blocker.stdout.readline().strip() == 'locked', 'Coordinator lock failed'
        futures = [pool.submit(sql, call, check=False, app=marker + f'-{index}')
                   for index, call in enumerate(calls)]
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            names = ','.join(f"'{marker}-{index}'" for index in range(len(calls)))
            waiting = value("select count(*) from pg_stat_activity where "
                            f"application_name in ({names}) and wait_event_type='Lock'")
            if waiting == str(len(calls)):
                break
            time.sleep(.05)
        else:
            raise AssertionError('All contenders did not reach their database lock')
        blocker.stdin.write('commit;\n\\q\n')
        blocker.stdin.flush()
        blocker.communicate(timeout=10)
        return [future.result(timeout=40) for future in futures]
    finally:
        if blocker.poll() is None:
            blocker.kill()
            blocker.communicate()
        pool.shutdown(wait=True)


def invitation(conversation, invitee, status='pending'):
    return value("select id from public.group_conversation_invitations "
                 f"where conversation_id='{conversation}' and invitee_profile_id='{invitee}' "
                 f"and status='{status}' order by created_at desc,id desc limit 1")


def member_state(conversation, profile):
    return value("select role||'/'||membership_status from public.conversation_members "
                 f"where conversation_id='{conversation}' and profile_id='{profile}'")


def management_revision(conversation):
    return int(value("select management_revision from public.group_conversations "
                     f"where conversation_id='{conversation}'"))


def membership_period(conversation, profile):
    return int(value("select period_number from public.group_membership_periods "
                     f"where conversation_id='{conversation}' and profile_id='{profile}' "
                     "and ends_at_sequence is null"))


try:
    term = value("select id from public.academic_terms where status='current' order by id limit 1")
    if not term:
        raise AssertionError('A current local academic term is required.')
    code = 'RACE ' + uuid.uuid4().hex[:8].upper()
    sql(f"insert into public.courses(id,code,title,term_id,status) values("
        f"'{course_id}','{code}','Group Concurrency Fixture','{term}','active')")
    for index, user in enumerate(users):
        sql(f"insert into auth.users(id,email) values('{user}','{user}@group-race.local'); "
            "update public.profiles set "
            f"display_name='Group Race {index:02d}',major='Testing',year_of_study=2,"
            "is_discoverable=true,onboarding_completed_at=now(),"
            "campus_id=(select id from public.campuses where slug='burnaby') "
            f"where id='{user}'; insert into public.course_memberships(course_id,profile_id,status) "
            f"values('{course_id}','{user}','enrolled');")

    creation_key = str(uuid.uuid4())
    results = race(group_create_lock(users[0], creation_key), [
        create_group(users[0], creation_key, 'One retry-safe group', [users[1], users[2]]),
        create_group(users[0], creation_key, 'One retry-safe group', [users[2], users[1]])])
    first, second = map(returned, results)
    assert first == second
    group = first
    assert value(f"select count(*) from public.group_conversations where conversation_id='{group}'") == '1'
    assert value(f"select count(*) from public.conversation_members where conversation_id='{group}'") == '1'
    assert value(f"select count(*) from public.group_conversation_invitations where conversation_id='{group}' and status='pending'") == '2'
    print('PASS simultaneous unchanged creation retries return one group, owner and invite set', flush=True)

    conflict_key = str(uuid.uuid4())
    results = race(group_create_lock(users[0], conflict_key), [
        create_group(users[0], conflict_key, 'First proposed title', [users[3]]),
        create_group(users[0], conflict_key, 'Conflicting proposed title', [users[3]])])
    assert sum(result.returncode == 0 for result in results) == 1, [result.stderr for result in results]
    conflict_group = next(returned(result) for result in results if result.returncode == 0)
    assert value(f"select count(*) from public.group_conversations where creator_id='{users[0]}' and client_creation_id='{conflict_key}'") == '1'
    assert value(f"select count(*) from public.group_conversation_invitations where conversation_id='{conflict_group}'") == '1'
    print('PASS conflicting simultaneous creation retries keep exactly the winning original payload', flush=True)

    # Accept B first so role and manager races use two active members.
    b_invitation = invitation(group, users[1])
    assert returned(sql(respond(users[1], b_invitation))) == group
    assert returned(sql(as_user(users[0],
        f"select public.set_group_member_role('{group}','{users[1]}',"
        f"{membership_period(group, users[1])},'administrator',{management_revision(group)})"))) == 'administrator'

    retry_key = str(uuid.uuid4())
    before_retry_invite = management_revision(group)
    results = race(conversation_lock(group), [
        invite(users[1], group, retry_key, users[4], before_retry_invite),
        invite(users[1], group, retry_key, users[4], before_retry_invite)])
    assert [returned(result) for result in results] == [retry_key, retry_key]
    assert value("select count(*) from public.group_conversation_invitations "
                 f"where id='{retry_key}' and conversation_id='{group}'") == '1'
    assert management_revision(group) == before_retry_invite + 1
    print('PASS concurrent exact invitation retries insert once and both reconcile', flush=True)

    c_invitation = invitation(group, users[2])
    before_c_resolution = management_revision(group)
    results = race(conversation_lock(group), [
        respond(users[2], c_invitation),
        as_user(users[0], f"select public.revoke_group_invitation('{c_invitation}',"
                f"{before_c_resolution})")])
    assert sum(result.returncode == 0 for result in results) == 1, [result.stderr for result in results]
    status = value(f"select status from public.group_conversation_invitations where id='{c_invitation}'")
    assert status in ('accepted', 'revoked')
    if status == 'accepted':
        assert member_state(group, users[2]) == 'member/active'
    else:
        assert member_state(group, users[2]) == ''
    print('PASS acceptance versus revocation has one winner and matching membership state', flush=True)

    # Two managers target D with different retry IDs. The group lock and pending
    # uniqueness permit exactly one invitation.
    invite_keys = [str(uuid.uuid4()), str(uuid.uuid4())]
    before_d_invite = management_revision(group)
    results = race(conversation_lock(group), [
        invite(users[0], group, invite_keys[0], users[3], before_d_invite),
        invite(users[1], group, invite_keys[1], users[3], before_d_invite)])
    assert sum(result.returncode == 0 for result in results) == 1, [result.stderr for result in results]
    d_invitation = invitation(group, users[3])
    assert d_invitation in invite_keys
    assert value("select count(*) from public.group_conversation_invitations "
                 f"where conversation_id='{group}' and invitee_profile_id='{users[3]}' and status='pending'") == '1'
    print('PASS simultaneous managers cannot create duplicate pending invitations', flush=True)

    assert returned(sql(respond(users[3], d_invitation))) == group
    before_d_remove = management_revision(group)
    d_period = membership_period(group, users[3])
    results = race(conversation_lock(group), [
        send(users[3], group, str(uuid.uuid4()), 'Message racing removal'),
        as_user(users[0], f"select public.remove_group_member('{group}','{users[3]}',"
                f"{d_period},{before_d_remove})")])
    assert results[1].returncode == 0, results[1].stderr
    committed = results[0].returncode == 0
    period_end = int(value("select ends_at_sequence from public.group_membership_periods "
                           f"where conversation_id='{group}' and profile_id='{users[3]}' order by period_number desc limit 1"))
    sent_count = int(value("select count(*) from public.messages "
                           f"where conversation_id='{group}' and sender_id='{users[3]}'"))
    assert sent_count == (1 if committed else 0)
    assert period_end == int(value(f"select last_message_sequence from public.conversations where id='{group}'"))
    assert member_state(group, users[3]) == 'member/removed'
    denied_send = sql(send(users[3], group, str(uuid.uuid4()), 'Post-removal send'), check=False)
    assert denied_send.returncode != 0
    print('PASS send versus removal either commits inside the visibility period or is rejected', flush=True)

    # Fill a separate group to 19 active users, then race two distinct new
    # invitations for its one remaining active-or-pending slot.
    cap_invitees = users[4:22]
    cap_group = returned(sql(create_group(users[0], str(uuid.uuid4()), 'Capacity race group', cap_invitees)))
    for target in cap_invitees:
        assert returned(sql(respond(target, invitation(cap_group, target)))) == cap_group
    assert value("select count(*) from public.conversation_members "
                 f"where conversation_id='{cap_group}' and membership_status='active'") == '19'
    capacity_targets = [users[2], users[3]]
    before_capacity_invite = management_revision(cap_group)
    results = race(conversation_lock(cap_group), [
        invite(users[0], cap_group, str(uuid.uuid4()), capacity_targets[0], before_capacity_invite),
        invite(users[0], cap_group, str(uuid.uuid4()), capacity_targets[1], before_capacity_invite)])
    assert sum(result.returncode == 0 for result in results) == 1, [result.stderr for result in results]
    assert value("select count(*) from public.conversation_members member "
                 f"where member.conversation_id='{cap_group}' and member.membership_status='active'") == '19'
    assert value("select count(*) from public.group_conversation_invitations invitation "
                 f"where invitation.conversation_id='{cap_group}' and invitation.status='pending'") == '1'
    print('PASS simultaneous invitations cannot exceed the 20 active-or-pending capacity', flush=True)

    # Ownership transfer and owner leave share the group lock. Transfer always
    # succeeds; leave succeeds only if it observes B as the new owner first.
    before_transfer = management_revision(group)
    owner_period = membership_period(group, users[0])
    target_period = membership_period(group, users[1])
    results = race(conversation_lock(group), [
        as_user(users[0], f"select public.transfer_group_ownership('{group}','{users[1]}',"
                f"{target_period},{before_transfer})"),
        as_user(users[0], f"select public.leave_group_conversation('{group}',{owner_period})")])
    assert results[0].returncode == 0, results[0].stderr
    assert value("select count(*) from public.conversation_members where "
                 f"conversation_id='{group}' and membership_status='active' and role='owner'") == '1'
    assert member_state(group, users[1]) == 'owner/active'
    assert member_state(group, users[0]) in ('administrator/active', 'administrator/left')
    if results[1].returncode == 0:
        assert member_state(group, users[0]) == 'administrator/left'
    print('PASS ownership transfer versus leave never removes or duplicates the final owner', flush=True)
finally:
    user_list = ','.join(f"'{user}'" for user in users)
    owned = f"select id from public.conversations where created_by in ({user_list})"
    sql(f"begin; "
        f"delete from public.group_conversation_invitations where conversation_id in ({owned}); "
        f"delete from public.request_conversations where conversation_id in ({owned}); "
        f"delete from public.messages where conversation_id in ({owned}); "
        f"delete from public.group_membership_periods where conversation_id in ({owned}); "
        f"delete from public.group_conversations where conversation_id in ({owned}); "
        f"delete from public.direct_conversation_pairs where conversation_id in ({owned}); "
        f"delete from public.conversation_members where conversation_id in ({owned}); "
        f"delete from public.conversations where created_by in ({user_list}); "
        f"delete from public.course_memberships where profile_id in ({user_list}); "
        f"delete from public.courses where id='{course_id}'; "
        f"delete from auth.users where id in ({user_list}); commit;")
    print('Temporary group messaging concurrency fixtures removed.', flush=True)
