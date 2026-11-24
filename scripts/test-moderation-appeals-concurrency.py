"""Local-only, coordinated hidden-review revision versus appeal restoration race."""
import concurrent.futures
import json
import os
import shutil
import subprocess
import time
import uuid

PSQL = shutil.which('psql')
if not PSQL:
    raise SystemExit('Install PostgreSQL client tools first.')
PORT = os.environ.get('CAMPUSCLUTCH_TEST_DB_PORT', '54322')
if not PORT.isdigit() or not 1024 <= int(PORT) <= 65535:
    raise SystemExit('Invalid local database port.')
ENV = dict(os.environ, PGPASSWORD='postgres', PGCONNECT_TIMEOUT='5')
ARGS = [PSQL, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', PORT, '-U', 'postgres', '-d', 'postgres']
author, reporter, admin, term, course, report = [str(uuid.uuid4()) for _ in range(6)]
users = [author, reporter, admin]
sessions = {user: str(uuid.uuid4()) for user in users}
code = 'AP ' + uuid.uuid4().hex[:10].upper()


def sql(query, app='appeal-race-fixtures', check=True):
    r = subprocess.run(ARGS + ['-c', query], env=dict(ENV, PGAPPNAME=app), capture_output=True, text=True, timeout=30)
    if check and r.returncode:
        raise AssertionError(r.stderr)
    return r


def value(query):
    return sql(query).stdout.strip().splitlines()[-1]


def claims(user):
    token = json.dumps({'sub': user, 'role': 'authenticated', 'session_id': sessions[user]})
    return f"set local role authenticated; select set_config('request.jwt.claim.sub','{user}',true); select set_config('request.jwt.claims','{token}',true);"


def as_user(user, query):
    return f"begin; set local statement_timeout='20s'; {claims(user)} {query}; commit;"


def fingerprint():
    tables = sql("select schemaname||'.'||tablename from pg_tables where schemaname='public' or right(schemaname,8)='_private' or (schemaname='auth' and tablename in ('users','identities'))").stdout.splitlines()
    query = ' union all '.join(f"select '{t}:'||count(*)::text||':'||md5(coalesce(string_agg(to_jsonb(r)::text,',' order by to_jsonb(r)::text),'')) from {t} r" for t in tables)
    return sorted(sql(query).stdout.splitlines())


before = fingerprint()
writer = None
pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
try:
    for user in users:
        sql(f"insert into auth.users(id,email,email_confirmed_at) values('{user}','{user}@appeal-race.test',now()); update public.profiles set display_name='Appeal race fixture',onboarding_completed_at=now() where id='{user}'; insert into auth.sessions(id,user_id,created_at,updated_at) values('{sessions[user]}','{user}',now(),now());")
    year = value("select y from generate_series(2100,2199) y where not exists(select 1 from public.academic_terms where code=y::text||'-spring') limit 1")
    sql(f"insert into public.academic_terms(id,code,display_name,year,season,starts_on,ends_on,status) values('{term}','{year}-spring','Appeal race term',{year},'spring',current_date-30,current_date+30,'current'); insert into public.courses(id,code,title,term_id,status) values('{course}','{code}','Appeal race fixture','{term}','active'); insert into public.course_memberships(course_id,profile_id,status) values('{course}','{author}','enrolled'); select safety_private.assign_staff_role('{admin}','admin',true,'Disposable appeal concurrency fixture');")
    def save(comment):
        return f"select public.save_my_course_review('{code}','{term}',3,4,true,'B','{comment}','','',array['Useful'])"
    review = value(as_user(author, save('Original hidden review feedback.')))
    stamp = value(f"select updated_at from course_reviews_private.reviews where id='{review}'")
    sql(f"insert into safety_private.reports(id,reporter_id,reported_profile_id,operation_id,target_type,course_review_id,reason,details,payload_hash,evidence,triage_status) values('{report}','{reporter}','{author}',gen_random_uuid(),'course_review','{review}','spam','',extensions.digest('appeal race','sha256'),'{{}}','escalated')")
    action = json.loads(value(as_user(admin, f"select public.enforce_moderation_report('{report}','{uuid.uuid4()}',0,'remove_review','Hidden for a disposable race test.','{stamp}')")))['action_id']
    appeal = value(as_user(author, f"select public.submit_moderation_appeal('{action}','{uuid.uuid4()}','Please reconsider this hidden review.')"))
    marker = 'appeal-race-' + uuid.uuid4().hex
    writer = subprocess.Popen(ARGS, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=dict(ENV, PGAPPNAME=marker+'-writer'))
    writer.stdin.write(f"begin; set local statement_timeout='20s'; {claims(author)} select pg_advisory_xact_lock(hashtextextended('{author}:{code}:{term}',1452)); select 'READY';\n")
    writer.stdin.flush()
    while writer.stdout.readline().strip() != 'READY':
        if writer.poll() is not None:
            raise AssertionError('Writer did not acquire review lock')
    result = pool.submit(sql, as_user(admin, f"select public.resolve_moderation_appeal('{appeal}','{uuid.uuid4()}',0,'overturned','The original review may be restored.')"), marker+'-resolver', False)
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if value(f"select count(*) from pg_stat_activity where application_name='{marker}-resolver' and wait_event='advisory'") == '1':
            break
        time.sleep(.05)
    else:
        raise AssertionError('Resolver did not reach the held review lock')
    writer.stdin.write(save('Revised feedback published while the appeal is decided.') + '; commit;\n\\q\n')
    writer.stdin.flush()
    _, error = writer.communicate(timeout=30)
    resolved = result.result(timeout=30)
    assert writer.returncode == 0 and resolved.returncode == 0, error + resolved.stderr
    assert value(f"select count(*) from course_reviews_private.reviews where author_id='{author}' and archived_at is null and removed_at is null") == '1'
    assert value(f"select (archived_at is not null)::text from course_reviews_private.reviews where id='{review}'") == 'true'
    assert value(f"select comment from course_reviews_private.reviews where author_id='{author}' and archived_at is null") == 'Revised feedback published while the appeal is decided.'
    assert value(f"select count(*) from safety_private.appeal_decisions where appeal_id='{appeal}'") == '1'
    print('PASS coordinated review revision and appeal reversal both commit without deadlock; replacement and one final decision survive', flush=True)
finally:
    if writer is not None and writer.poll() is None:
        writer.kill()
        writer.communicate()
    pool.shutdown(wait=True)
    selected = ','.join(f"'{u}'" for u in users)
    sql(f"begin; delete from safety_private.appeal_views where appeal_id in(select id from safety_private.appeals where appellant_id='{author}'); delete from safety_private.appeal_decisions where appeal_id in(select id from safety_private.appeals where appellant_id='{author}'); delete from safety_private.appeals where appellant_id='{author}'; delete from safety_private.enforcement_actions where report_id='{report}'; delete from safety_private.report_views where report_id='{report}'; delete from safety_private.report_decisions where report_id='{report}'; delete from safety_private.reports where id='{report}'; delete from safety_private.staff_role_events where profile_id in({selected}); delete from auth.users where id in({selected}); delete from public.courses where id='{course}'; delete from public.academic_terms where id='{term}'; delete from points_private.starter_grant_claims where email_fingerprint in(" + ','.join(f"points_private.email_fingerprint('{u}@appeal-race.test')" for u in users) + '); commit;')
    assert fingerprint() == before, 'Original database fingerprints changed'
    print('PASS concurrency fixtures and private audits removed; original data preserved', flush=True)
