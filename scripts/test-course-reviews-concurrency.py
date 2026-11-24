"""Local-only review races; exact temporary fixtures are removed in finally.

Requires psql on PATH and local Supabase on 127.0.0.1:54322. A coordinator
observes real database lock waits before releasing simultaneous callers.
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
DB_PORT = os.environ.get('CAMPUSCLUTCH_TEST_DB_PORT', '54322')
if not DB_PORT.isdigit() or not 1024 <= int(DB_PORT) <= 65535:
    raise SystemExit('Invalid local test database port.')
ARGS = [PSQL, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1',
        '-p', DB_PORT, '-U', 'postgres', '-d', 'postgres']
users = [str(uuid.uuid4()) for _ in range(4)]
term_id = str(uuid.uuid4())
course_id = str(uuid.uuid4())
course_code = 'RV ' + uuid.uuid4().hex[:12].upper()
historical_term_id = None


def sql(query, *, check=True, app='course-review-fixtures'):
    result = subprocess.run(ARGS + ['-c', query], env=dict(ENV, PGAPPNAME=app),
                            capture_output=True, text=True, timeout=30)
    if check and result.returncode:
        raise AssertionError(result.stderr)
    return result


def value(query):
    return sql(query).stdout.strip().splitlines()[-1]


def as_user(user, query):
    return ("begin; set local statement_timeout='20s'; set local role authenticated; "
            f"select set_config('request.jwt.claim.sub','{user}',true); {query}; commit;")


def save(user, grade='A', semester=term_id):
    return as_user(user, f"select public.save_my_course_review('{course_code}','{semester}',"
                   f"3,4,true,'{grade}','Temporary concurrency review.','','',array['Useful'])")


def summary():
    return json.loads(value(as_user(users[0],
        f"select public.get_course_review_summary('{course_code}')")))


def race(lock_query, lock_value, calls, before_release=''):
    marker = 'reviews-' + uuid.uuid4().hex
    blocker = subprocess.Popen(ARGS, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True, env=dict(ENV, PGAPPNAME=marker+'-blocker'))
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=len(calls))
    try:
        blocker.stdin.write(f'begin; {lock_query};\n')
        blocker.stdin.flush()
        assert blocker.stdout.readline().strip() == lock_value, 'Coordinator lock failed'
        futures = [pool.submit(sql, call, check=False, app=marker+f'-{i}')
                   for i, call in enumerate(calls)]
        names = ','.join(f"'{marker}-{i}'" for i in range(len(calls)))
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            waiting = value(f"select count(*) from pg_stat_activity where application_name in ({names}) "
                            "and wait_event_type='Lock'")
            if waiting == str(len(calls)):
                break
            time.sleep(.05)
        else:
            raise AssertionError('Contenders did not reach the expected database locks')
        blocker.stdin.write(before_release + '; commit;\n\\q\n')
        blocker.stdin.flush()
        blocker.communicate(timeout=10)
        return [future.result(timeout=30) for future in futures]
    finally:
        if blocker.poll() is None:
            blocker.kill()
            blocker.communicate()
        pool.shutdown(wait=True)


try:
    # Select an unused synthetic reference year instead of changing app terms.
    year = value("select y from generate_series(2100,2199) y where not exists "
                 "(select 1 from public.academic_terms where code=y::text||'-spring') limit 1")
    for user in users:
        sql(f"insert into auth.users(id,email,email_confirmed_at) values('{user}',"
            f"'{user}@course-reviews-race.test',now()); update public.profiles set "
            f"display_name='Review Race Fixture',onboarding_completed_at=now() where id='{user}';")
    sql(f"insert into public.academic_terms(id,code,display_name,year,season,starts_on,ends_on,status) "
        f"values('{term_id}','{year}-spring','Review race term',{year},'spring',current_date-30,current_date+30,'current'); "
        f"insert into public.courses(id,code,title,term_id,status) values('{course_id}',"
        f"'{course_code}','Review race fixture','{term_id}','active');")
    for user in users:
        sql(f"insert into public.course_memberships(course_id,profile_id,status) "
            f"values('{course_id}','{user}','enrolled')")

    member_lock = (f"select profile_id from public.course_memberships where course_id='{course_id}' "
                   f"and profile_id='{users[0]}' for update")
    results = race(member_lock, users[0], [save(users[0]), save(users[0])])
    assert all(r.returncode == 0 for r in results), [r.stderr for r in results]
    review_ids = [r.stdout.strip().splitlines()[-1] for r in results]
    assert review_ids[0] == review_ids[1], 'Duplicate initial saves created distinct IDs'
    first_id = review_ids[0]
    data = summary()
    assert data['review_count'] == 1
    assert {g['grade']: g['count'] for g in data['grade_counts']}['A'] == 1
    print('PASS concurrent initial retries: one review and one grade contribution', flush=True)

    results = race(f"select id from course_reviews_private.reviews where id='{first_id}' for update",
                   first_id, [save(users[0], 'B'), save(users[0], 'C')])
    assert all(r.returncode == 0 for r in results), [r.stderr for r in results]
    data = summary()
    counts = {g['grade']: g['count'] for g in data['grade_counts']}
    assert data['review_count'] == 1 and counts['A'] == 0
    assert counts['B'] + counts['C'] == 1
    assert sum(counts.values()) == 1
    print('PASS concurrent edits: final grade counted once and previous grade removed', flush=True)

    term_lock = f"select id from public.academic_terms where id='{term_id}' for update"
    results = race(term_lock, term_id, [save(users[1], 'F'), save(users[2], 'A+')])
    assert all(r.returncode == 0 for r in results), [r.stderr for r in results]
    data = summary()
    counts = {g['grade']: g['count'] for g in data['grade_counts']}
    assert data['review_count'] == 3 and counts['F'] == 1 and counts['A+'] == 1
    assert sum(counts.values()) == 3
    print('PASS independent authors: concurrent submissions both appear in aggregate', flush=True)

    leave_lock = (f"select profile_id from public.course_memberships where course_id='{course_id}' "
                  f"and profile_id='{users[3]}' for update")
    results = race(leave_lock, users[3], [save(users[3])], before_release=
        f"update public.course_memberships set status='left' where course_id='{course_id}' and profile_id='{users[3]}'")
    assert results[0].returncode != 0 and 'Add this course' in results[0].stderr, results[0].stderr
    assert summary()['review_count'] == 3
    assert value(f"select count(*) from course_reviews_private.reviews where author_id='{users[3]}'") == '0'
    print('PASS leave wins before first save: membership is rechecked and review denied', flush=True)

    sql(f"update public.course_memberships set status='enrolled' where course_id='{course_id}' and profile_id='{users[3]}'")
    results = race(term_lock, term_id, [save(users[3])], before_release=
        f"update public.academic_terms set status='upcoming' where id='{term_id}'")
    assert results[0].returncode != 0 and 'Add this course' in results[0].stderr, results[0].stderr
    assert summary()['review_count'] == 3
    print('PASS term becomes upcoming before first save: eligibility is rechecked', flush=True)

    original_grade = value(f"select grade from course_reviews_private.reviews where id='{first_id}'")
    results = race(f"select id from course_reviews_private.reviews where id='{first_id}' for update",
        first_id, [save(users[0], original_grade)], before_release=
        f"update course_reviews_private.reviews set removed_at=clock_timestamp() where id='{first_id}'")
    assert results[0].returncode != 0 and 'Update your hidden review' in results[0].stderr
    assert summary()['review_count'] == 2
    print('PASS hide wins before stale save: original stays hidden', flush=True)

    results = race(f"select id from course_reviews_private.reviews where id='{first_id}' for update",
        first_id, [save(users[0], 'A+'), save(users[0], 'A+')])
    assert all(r.returncode == 0 for r in results), [r.stderr for r in results]
    replacements = [r.stdout.strip().splitlines()[-1] for r in results]
    assert replacements[0] == replacements[1] and replacements[0] != first_id
    assert summary()['review_count'] == 3
    assert value(f"select grade from course_reviews_private.reviews where id='{first_id}'") == original_grade
    assert value(f"select count(*) from course_reviews_private.reviews where author_id='{users[0]}' and archived_at is null") == '1'
    print('PASS simultaneous hidden-review revisions publish once and retain original evidence', flush=True)

    replacement_id = replacements[0]
    sql(f"update public.academic_terms set status='current' where id='{term_id}'; "
        f"update course_reviews_private.reviews set removed_at=clock_timestamp() where id='{replacement_id}'")
    results = race(f"select id from course_reviews_private.reviews where id='{replacement_id}' for update",
        replacement_id, [save(users[0], 'B+'), as_user(users[0], f"select public.delete_my_course_review('{replacement_id}')")])
    assert all(r.returncode == 0 for r in results), [r.stderr for r in results]
    assert summary()['review_count'] == 3
    assert value(f"select count(*) from course_reviews_private.reviews where author_id='{users[0]}' and archived_at is null") == '1'
    assert value(f"select count(*) from course_reviews_private.reviews where author_id='{users[0]}' and archived_at is not null") == '2'
    print('PASS concurrent hidden discard and revised save preserve the new review and both historical versions', flush=True)

    # Block first-time inserts until all three callers reach the missing term.
    historical_term_id = value(
        "select id from course_reviews_private.past_terms() where catalog_id is null "
        "order by semester_start limit 1")
    lock = f"lock table public.academic_terms in share mode; select '{historical_term_id}'"
    results = race(lock, historical_term_id, [
        save(users[0], semester=historical_term_id), save(users[0], semester=historical_term_id),
        save(users[1], semester=historical_term_id)])
    assert all(r.returncode == 0 for r in results), [r.stderr for r in results]
    ids = [r.stdout.strip().splitlines()[-1] for r in results]
    assert ids[0] == ids[1] and ids[1] != ids[2]
    assert value(f"select count(*) from public.academic_terms where id='{historical_term_id}' and review_only") == '1'
    assert value(f"select count(*) from course_reviews_private.reviews where term_id='{historical_term_id}' "
                 f"and course_code='{course_code}'") == '2'
    print('PASS concurrent historical first saves share one semester and count each author once', flush=True)
finally:
    # These UUIDs and email fingerprints were generated exclusively for this run.
    selected = ','.join(f"'{user}'" for user in users)
    sql(f"delete from auth.users where id in ({selected}); "
        f"delete from public.courses where id='{course_id}'; "
        f"delete from public.academic_terms where id='{term_id}'; "
        "delete from points_private.starter_grant_claims where email_fingerprint in ("
        + ','.join(f"points_private.email_fingerprint('{user}@course-reviews-race.test')" for user in users)
        + ');')
    if historical_term_id:
        sql(f"delete from public.academic_terms t where t.id='{historical_term_id}' and t.review_only "
            "and not exists (select 1 from course_reviews_private.reviews r where r.term_id=t.id)")
