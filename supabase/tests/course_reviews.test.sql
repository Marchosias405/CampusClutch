BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- Every account, membership, review and welcome-point claim is rolled back.
CREATE FUNCTION pg_temp.uid(i integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('c0a5e000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
$$;
CREATE FUNCTION pg_temp.login(i integer) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', pg_temp.uid(i)::text, true);
$$;
CREATE FUNCTION pg_temp.save_review(
  term_number integer DEFAULT 301, code text DEFAULT 'REVIEW 101',
  difficulty integer DEFAULT 2, workload integer DEFAULT 4,
  recommend boolean DEFAULT true, grade text DEFAULT 'A',
  comment text DEFAULT 'A useful course with plenty of practical examples.',
  tips text DEFAULT '', instructor text DEFAULT '', tags text[] DEFAULT ARRAY['Useful']::text[]
) RETURNS uuid LANGUAGE sql AS $$
  SELECT public.save_my_course_review(code, pg_temp.uid(term_number), difficulty,
    workload, recommend, grade, comment, tips, instructor, tags);
$$;
CREATE FUNCTION pg_temp.summary(code text DEFAULT 'REVIEW 101') RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.get_course_review_summary(code);
$$;
CREATE FUNCTION pg_temp.grade_count(grade text) RETURNS integer LANGUAGE sql AS $$
  SELECT (item->>'count')::integer FROM jsonb_array_elements(pg_temp.summary()->'grade_counts') item
  WHERE item->>'grade' = grade;
$$;

INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT pg_temp.uid(n), 'course-review-' || n || '@tests.local', now()
FROM generate_series(1, 9) n;
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT pg_temp.uid(n), 'course-review-page-' || n || '@tests.local', now()
FROM generate_series(100, 154) n;
UPDATE public.profiles SET display_name = 'Review Fixture Student', onboarding_completed_at = now()
WHERE id IN (SELECT pg_temp.uid(n) FROM generate_series(1, 9) n)
   OR id IN (SELECT pg_temp.uid(n) FROM generate_series(100, 154) n);
-- Existing profile trigger auto-completes any profile with a display name.
UPDATE public.profiles SET display_name = NULL, onboarding_completed_at = NULL WHERE id = pg_temp.uid(7);
UPDATE auth.users SET banned_until = now() + interval '1 day' WHERE id = pg_temp.uid(8);
UPDATE auth.users SET is_anonymous = true WHERE id = pg_temp.uid(9);

INSERT INTO public.academic_terms (id, code, display_name, year, season, starts_on, ends_on, status)
VALUES
  (pg_temp.uid(301), '2088-spring', 'Review current term', 2088, 'spring', current_date - 30, current_date + 30, 'current'),
  (pg_temp.uid(302), '2087-fall', 'Review past term', 2087, 'fall', current_date - 180, current_date - 90, 'past'),
  (pg_temp.uid(303), '2088-summer', 'Review upcoming term', 2088, 'summer', current_date + 90, current_date + 180, 'upcoming');
INSERT INTO public.courses (id, code, title, term_id, campus_id, status)
VALUES
  (pg_temp.uid(201), 'REVIEW 101', 'Review fixture current', pg_temp.uid(301), (SELECT id FROM public.campuses WHERE slug='burnaby'), 'active'),
  (pg_temp.uid(202), 'REVIEW 101', 'Review fixture other campus', pg_temp.uid(301), (SELECT id FROM public.campuses WHERE slug='surrey'), 'active'),
  (pg_temp.uid(203), 'REVIEW 101', 'Review fixture past', pg_temp.uid(302), NULL, 'archived'),
  (pg_temp.uid(204), 'REVIEW 101', 'Review fixture upcoming', pg_temp.uid(303), NULL, 'active'),
  (pg_temp.uid(205), 'REVIEW 202', 'Independent pagination course', pg_temp.uid(301), NULL, 'active');
INSERT INTO public.course_memberships (profile_id, course_id, status)
VALUES
  (pg_temp.uid(1), pg_temp.uid(201), 'enrolled'),
  (pg_temp.uid(1), pg_temp.uid(202), 'enrolled'),
  (pg_temp.uid(1), pg_temp.uid(203), 'completed'),
  (pg_temp.uid(2), pg_temp.uid(202), 'enrolled'),
  (pg_temp.uid(4), pg_temp.uid(204), 'enrolled'),
  (pg_temp.uid(5), pg_temp.uid(201), 'left'),
  (pg_temp.uid(6), pg_temp.uid(203), 'completed'),
  (pg_temp.uid(7), pg_temp.uid(201), 'enrolled'),
  (pg_temp.uid(8), pg_temp.uid(201), 'enrolled'),
  (pg_temp.uid(9), pg_temp.uid(201), 'enrolled');
INSERT INTO public.course_memberships (profile_id, course_id, status)
SELECT pg_temp.uid(n), pg_temp.uid(205), 'enrolled' FROM generate_series(100,154) n;

CREATE TEMP TABLE review_ids (name text PRIMARY KEY, id uuid, created_at timestamptz);
GRANT ALL ON review_ids TO authenticated;

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='course_reviews_private.reviews'::regclass),
  'Private review rows retain RLS as defense in depth');
SELECT ok(NOT has_table_privilege(role_name, 'course_reviews_private.reviews', 'SELECT,INSERT,UPDATE,DELETE'),
  role_name || ' cannot directly access review authors or mutate raw rows')
FROM unnest(ARRAY['anon','authenticated','service_role']) role_name;
SELECT ok(NOT p.prosecdef, 'Public review API is an invoker wrapper: ' || p.proname)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN
  ('get_course_review_summary','list_course_reviews','save_my_course_review','delete_my_course_review');
SELECT ok(NOT has_function_privilege('anon', p.oid, 'EXECUTE'), 'Anonymous execution denied for ' || p.proname)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN
  ('get_course_review_summary','list_course_reviews','save_my_course_review','delete_my_course_review');

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.get_course_review_summary('REVIEW 101')$$,'42501',NULL,'Signed-out clients cannot read reviews');
SELECT throws_ok($$SELECT * FROM public.list_course_reviews('REVIEW 101')$$,'42501',NULL,'Signed-out clients cannot list reviews');
SELECT throws_ok($$SELECT pg_temp.save_review()$$,'42501',NULL,'Signed-out clients cannot submit reviews');
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='';
SELECT throws_ok($$SELECT public.get_course_review_summary('REVIEW 101')$$,'42501',NULL,'Authenticated role without identity is denied');
SELECT pg_temp.login(99);
SELECT throws_ok($$SELECT public.get_course_review_summary('REVIEW 101')$$,'42501',NULL,'A stale identity without an account is denied');
SELECT pg_temp.login(7);
SELECT throws_ok($$SELECT pg_temp.save_review()$$,'42501',NULL,'Incomplete profiles cannot write reviews');
SELECT pg_temp.login(8);
SELECT throws_ok($$SELECT pg_temp.save_review()$$,'42501',NULL,'Currently banned identities cannot write reviews');
SELECT pg_temp.login(9);
SELECT throws_ok($$SELECT pg_temp.save_review()$$,'42501',NULL,'Anonymous Auth identities cannot write reviews');

SELECT pg_temp.login(3);
SELECT is((pg_temp.summary()->>'review_count')::integer,0,'Valid course without reviews has zero count');
SELECT is(jsonb_array_length(pg_temp.summary()->'grade_counts'),11,'Empty distribution contains every grade bin');
SELECT is((SELECT sum((item->>'count')::integer) FROM jsonb_array_elements(pg_temp.summary()->'grade_counts') item),0::bigint,'Empty distribution has no invented grades');
SELECT ok(pg_temp.summary()->'average_difficulty'='null'::jsonb AND pg_temp.summary()->'average_workload'='null'::jsonb
  AND pg_temp.summary()->'recommend_percent'='null'::jsonb,'Empty summary does not invent ratings or recommendation percentages');
SELECT is(pg_temp.summary()->'top_tags','[]'::jsonb,'Empty summary has no invented tags');
SELECT is(pg_temp.summary()->'eligible_terms','[]'::jsonb,'Nonmembers receive no eligible terms');
SELECT is(pg_temp.summary()->'my_reviews','[]'::jsonb,'New account has no own reviews');
SELECT throws_ok($$SELECT pg_temp.save_review()$$,'42501',NULL,'A nonmember cannot submit a course review');
SELECT pg_temp.login(4);
SELECT throws_ok($$SELECT pg_temp.save_review(303)$$,'42501',NULL,'An upcoming membership does not permit a review');
SELECT pg_temp.login(5);
SELECT throws_ok($$SELECT pg_temp.save_review()$$,'42501',NULL,'A left membership cannot create a new review');

SELECT pg_temp.login(1);
SELECT is(jsonb_array_length(pg_temp.summary()->'eligible_terms'),2,'Two campuses in one term produce one eligible term, alongside the past term');
SELECT is((pg_temp.summary(E'  review\t 101  ')->>'course_code'),'REVIEW 101','Course identity normalizes whitespace and case');
INSERT INTO review_ids(name,id) VALUES ('alice-current',pg_temp.save_review(tags=>ARRAY['Useful','Interesting']));
UPDATE review_ids SET created_at=(SELECT created_at FROM public.list_course_reviews('REVIEW 101') LIMIT 1) WHERE name='alice-current';
INSERT INTO review_ids(name,id) VALUES ('alice-past',pg_temp.save_review(302,difficulty=>4,workload=>2,recommend=>false,grade=>'B-',tags=>ARRAY['Useful','Lots of reading']));
SELECT is(jsonb_array_length(pg_temp.summary()->'my_reviews'),2,'An author sees their reviews across semesters together');
SELECT is((SELECT count(*) FROM public.list_course_reviews('REVIEW 101') WHERE is_mine),2::bigint,'Own reviews are marked without returning a profile ID');

SELECT pg_temp.login(2);
INSERT INTO review_ids(name,id) VALUES ('bob-current',pg_temp.save_review(difficulty=>3,workload=>3,grade=>NULL,tags=>ARRAY['Practical skills']));
SELECT is((pg_temp.summary()->>'review_count')::integer,3,'Reviews from different terms and campuses share one course total');
SELECT is((pg_temp.summary()->>'average_difficulty')::numeric,3::numeric,'Difficulty average includes all semester reviews');
SELECT is((pg_temp.summary()->>'average_workload')::numeric,3::numeric,'Workload average includes all semester reviews');
SELECT ok((pg_temp.summary()->>'recommend_percent')::numeric BETWEEN 66 AND 67,'Recommendation percentage uses all three reviews');
SELECT is(pg_temp.grade_count('A'),1,'A grade contributes exactly one histogram count');
SELECT is(pg_temp.grade_count('B-'),1,'A past-term grade contributes to the same histogram');
SELECT is((SELECT sum((item->>'count')::integer) FROM jsonb_array_elements(pg_temp.summary()->'grade_counts') item),2::bigint,'Not-yet-graded review is excluded from the grade distribution');
SELECT is((SELECT (item->>'count')::integer FROM jsonb_array_elements(pg_temp.summary()->'top_tags') item WHERE item->>'tag'='Useful'),2,'Tags aggregate across semesters');
SELECT is(jsonb_array_length(pg_temp.summary()->'my_reviews'),1,'Summary exposes only the caller own-review collection');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.list_course_reviews('REVIEW 101') r
  WHERE to_jsonb(r) ?| ARRAY['author_id','profile_id','email','display_name']), 'Review feed never returns author identifiers');
SELECT ok(position(pg_temp.uid(1)::text IN pg_temp.summary()::text)=0
  AND position('Review Fixture Student' IN pg_temp.summary()::text)=0,'Summary does not leak another reviewer ID or display name');
SELECT is(public.delete_my_course_review((SELECT id FROM review_ids WHERE name='alice-current')),false,'Another student cannot delete an anonymous review by its ID');
SELECT throws_ok($$SELECT * FROM course_reviews_private.reviews$$,'42501',NULL,'Direct reads cannot reveal anonymous authors');
SELECT throws_ok($$UPDATE course_reviews_private.reviews SET author_id=pg_temp.uid(2)$$,'42501',NULL,'Direct writes cannot take ownership of a review');
SELECT throws_ok($$DELETE FROM course_reviews_private.reviews$$,'42501',NULL,'Direct deletes cannot bypass ownership');

SELECT pg_temp.login(1);
SELECT is(pg_temp.save_review(code=>E'  review\t 101  ',difficulty=>5,workload=>5,recommend=>false,grade=>'C',tags=>ARRAY['Exam heavy']),
  (SELECT id FROM review_ids WHERE name='alice-current'),'A repeated save edits the same review instead of duplicating it');
SELECT is((pg_temp.summary()->>'review_count')::integer,3,'Editing a review does not inflate the course count');
SELECT is((pg_temp.summary()->>'average_difficulty')::numeric,4::numeric,'Difficulty recomputes after editing');
SELECT ok((pg_temp.summary()->>'recommend_percent')::numeric BETWEEN 33 AND 34,'Recommendation percentage recomputes after editing');
SELECT is(pg_temp.grade_count('A'),0,'Editing removes the previous grade from the graph');
SELECT is(pg_temp.grade_count('C'),1,'Editing adds the replacement grade exactly once');
SELECT is((SELECT created_at FROM public.list_course_reviews('REVIEW 101') WHERE id=(SELECT id FROM review_ids WHERE name='alice-current')),
  (SELECT created_at FROM review_ids WHERE name='alice-current'),'Editing preserves the creation cursor');
SELECT ok(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(pg_temp.summary()->'top_tags') item WHERE item->>'tag'='Interesting'),'Removed tags no longer contribute to the summary');

-- Invalid writes must preserve the existing review and its aggregates.
SELECT throws_ok($$SELECT pg_temp.save_review(difficulty=>0)$$,'22023',NULL,'Difficulty below one is rejected');
SELECT throws_ok($$SELECT pg_temp.save_review(difficulty=>6)$$,'22023',NULL,'Difficulty above five is rejected');
SELECT throws_ok($$SELECT pg_temp.save_review(difficulty=>NULL)$$,'22023',NULL,'Difficulty is required');
SELECT throws_ok($$SELECT pg_temp.save_review(workload=>0)$$,'22023',NULL,'Workload below one is rejected');
SELECT throws_ok($$SELECT pg_temp.save_review(workload=>6)$$,'22023',NULL,'Workload above five is rejected');
SELECT throws_ok($$SELECT pg_temp.save_review(workload=>NULL)$$,'22023',NULL,'Workload is required');
SELECT throws_ok($$SELECT pg_temp.save_review(recommend=>NULL)$$,'22023',NULL,'Recommendation is required');
SELECT throws_ok($$SELECT pg_temp.save_review(grade=>'G')$$,'22023',NULL,'Unknown grades are rejected');
SELECT throws_ok($$SELECT pg_temp.save_review(comment=>'short')$$,'22023',NULL,'Comments require at least ten characters');
SELECT throws_ok($$SELECT pg_temp.save_review(comment=>repeat(' ',10))$$,'22023',NULL,'Whitespace does not satisfy the comment minimum');
SELECT throws_ok($$SELECT pg_temp.save_review(comment=>NULL)$$,'22023',NULL,'Comment is required');
SELECT throws_ok($$SELECT pg_temp.save_review(comment=>repeat('x',2001))$$,'22023',NULL,'Oversized comments are rejected');
SELECT throws_ok($$SELECT pg_temp.save_review(tips=>repeat('x',1001))$$,'22023',NULL,'Oversized study tips are rejected');
SELECT throws_ok($$SELECT pg_temp.save_review(instructor=>repeat('x',121))$$,'22023',NULL,'Oversized instructor names are rejected');
SELECT throws_ok($$SELECT pg_temp.save_review(tags=>ARRAY['Useful','Interesting','Group work','Exam heavy'])$$,'22023',NULL,'More than three tags are rejected');
SELECT throws_ok($$SELECT pg_temp.save_review(tags=>ARRAY['Useful','Useful'])$$,'22023',NULL,'Duplicate tags cannot amplify their count');
SELECT throws_ok($$SELECT pg_temp.save_review(tags=>ARRAY['Not an allowed tag'])$$,'22023',NULL,'Unknown tags are rejected');
SELECT throws_ok($$SELECT pg_temp.save_review(tags=>ARRAY[NULL]::text[])$$,'22023',NULL,'Null tag entries are rejected');
SELECT throws_ok($$SELECT pg_temp.save_review(tags=>ARRAY[['Useful','Interesting']])$$,'22023',NULL,'Multidimensional tags cannot bypass tag validation');
SELECT throws_ok($$SELECT pg_temp.save_review(term_number=>NULL)$$,'22023',NULL,'Review term is required');
SELECT throws_ok($$SELECT public.get_course_review_summary(NULL)$$,'22023',NULL,'Missing course identity is rejected');
SELECT throws_ok($$SELECT public.get_course_review_summary('')$$,'22023',NULL,'Blank course identity is rejected');
SELECT throws_ok($$SELECT public.get_course_review_summary(repeat('X',33))$$,'22023',NULL,'Oversized course identity is rejected');
SELECT throws_ok($$SELECT public.get_course_review_summary('MISSING 999')$$,'22023',NULL,'Unknown course identity is rejected');
SELECT throws_ok($$SELECT pg_temp.save_review(code=>'REVIEW 202')$$,'42501',NULL,'Enrollment in one course cannot authorize another course');
SELECT is((pg_temp.summary()->>'review_count')::integer,3,'Rejected writes do not create or remove reviews');
SELECT is(pg_temp.grade_count('C'),1,'Rejected writes preserve the saved grade');
SELECT lives_ok($$SELECT pg_temp.save_review(comment=>repeat('x',2000),tips=>repeat('x',1000),instructor=>repeat('x',120),grade=>'C')$$,
  'Maximum valid text lengths are accepted');

SELECT pg_temp.login(2);
SELECT is(public.delete_my_course_review((SELECT id FROM review_ids WHERE name='bob-current')),true,'An author can delete their own review');
SELECT is(public.delete_my_course_review((SELECT id FROM review_ids WHERE name='bob-current')),false,'A repeated delete is harmless');
SELECT is((pg_temp.summary()->>'review_count')::integer,2,'Delete updates the review total immediately');
SELECT is(pg_temp.summary()->'my_reviews','[]'::jsonb,'Deleted review disappears from the own-review collection');

RESET ROLE;
UPDATE public.course_memberships SET status='left' WHERE profile_id=pg_temp.uid(1) AND course_id IN(pg_temp.uid(201),pg_temp.uid(202));
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT is(jsonb_array_length(pg_temp.summary()->'eligible_terms'),1,'Removing both campus memberships removes that term from new-review eligibility');
SELECT lives_ok($$SELECT pg_temp.save_review(difficulty=>1,workload=>2,grade=>'F')$$,'Existing review remains editable after removing the course');
SELECT is(pg_temp.grade_count('C'),0,'Edit after course removal removes the old histogram bin');
SELECT is(pg_temp.grade_count('F'),1,'Edit after course removal updates the new histogram bin');
SELECT is(public.delete_my_course_review((SELECT id FROM review_ids WHERE name='alice-current')),true,'Existing review remains deletable after removing the course');
SELECT throws_ok($$SELECT pg_temp.save_review()$$,'42501',NULL,'After deleting a review, removed membership cannot create it anew');
SELECT is(pg_temp.grade_count('F'),0,'Deleting a graded review removes its histogram contribution');
SELECT is((pg_temp.summary()->>'review_count')::integer,1,'Only the past-term review remains');

SELECT pg_temp.login(6);
SELECT lives_ok($$SELECT pg_temp.save_review(302,grade=>NULL)$$,'A completed past membership may review an archived offering');
SELECT is((pg_temp.summary()->>'review_count')::integer,2,'Another past-term member contributes to the same course page');
SELECT pg_temp.login(3);
SELECT is(pg_temp.summary()->'my_reviews','[]'::jsonb,'Account switching never exposes another account editable reviews');
SELECT is((SELECT count(*) FROM public.list_course_reviews('REVIEW 101') WHERE is_mine),0::bigint,'Account switching clears all ownership markers');
SELECT is((pg_temp.summary('REVIEW 202')->>'review_count')::integer,0,'A different course has an independent aggregate');

-- More rows than the page cap, with equal creation timestamps, exercise the
-- UUID tie-breaker. Fixtures are submitted through the real authenticated API.
DO $fill$
DECLARE n integer;
BEGIN
  FOR n IN 100..154 LOOP
    PERFORM pg_temp.login(n);
    PERFORM pg_temp.save_review(code=>'REVIEW 202',difficulty=>(n % 5)+1,grade=>NULL);
  END LOOP;
END;
$fill$;
RESET ROLE;
UPDATE course_reviews_private.reviews SET created_at='2026-01-01T00:00:00Z'
WHERE course_code='REVIEW 202' AND author_id IN (SELECT pg_temp.uid(n) FROM generate_series(100,154) n);
CREATE TEMP TABLE expected_review_pages AS
SELECT row_number() OVER (ORDER BY created_at DESC,id DESC) position,id
FROM course_reviews_private.reviews WHERE course_code='REVIEW 202';
CREATE TEMP TABLE actual_review_pages(position bigint,id uuid,page_number integer);
GRANT SELECT ON expected_review_pages TO authenticated;
GRANT ALL ON actual_review_pages TO authenticated;
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(3);
SELECT is((SELECT count(*) FROM public.list_course_reviews('REVIEW 202')),20::bigint,'Default review page is bounded to twenty rows');
SELECT is((SELECT count(*) FROM public.list_course_reviews('REVIEW 202',NULL,NULL,50)),50::bigint,'Maximum review page is bounded to fifty rows');
SELECT is((pg_temp.summary('REVIEW 202')->>'review_count')::integer,55,'Course aggregate includes reviews beyond the first page');
SELECT throws_ok(format('SELECT * FROM public.list_course_reviews(%L,NULL,NULL,%s)','REVIEW 202',bad_limit),
  '22023',NULL,'Invalid pagination limit is rejected: ' || bad_limit)
FROM unnest(ARRAY['0','-1','51','NULL']) bad_limit;
SELECT throws_ok($$SELECT * FROM public.list_course_reviews('REVIEW 202',now(),NULL,20)$$,'22023',NULL,'Half timestamp cursor is rejected');
SELECT throws_ok($$SELECT * FROM public.list_course_reviews('REVIEW 202',NULL,pg_temp.uid(1),20)$$,'22023',NULL,'Half ID cursor is rejected');
SELECT throws_ok($$SELECT * FROM public.list_course_reviews('REVIEW 202','infinity',pg_temp.uid(1),20)$$,'22023',NULL,'Nonfinite cursor is rejected');

DO $walk$
DECLARE item record; cursor_time timestamptz; cursor_id uuid; page_number integer:=0; position bigint:=0; page_size integer;
BEGIN
  LOOP
    page_number:=page_number+1; page_size:=0;
    FOR item IN SELECT * FROM public.list_course_reviews('REVIEW 202',cursor_time,cursor_id,7) LOOP
      position:=position+1; page_size:=page_size+1;
      INSERT INTO actual_review_pages VALUES(position,item.id,page_number);
      cursor_time:=item.created_at; cursor_id:=item.id;
    END LOOP;
    EXIT WHEN page_size=0;
    IF page_number>10 THEN RAISE EXCEPTION 'Review pagination failed to terminate'; END IF;
  END LOOP;
END;
$walk$;
SELECT is((SELECT count(*) FROM actual_review_pages),55::bigint,'All pages contain every review exactly once');
SELECT is((SELECT count(DISTINCT id) FROM actual_review_pages),55::bigint,'Equal timestamps never duplicate reviews across pages');
SELECT results_eq($$SELECT id FROM actual_review_pages ORDER BY position$$,$$SELECT id FROM expected_review_pages ORDER BY position$$,
  'Paginated ordering matches descending timestamp and ID ordering');
SELECT is((SELECT count(*) FROM public.list_course_reviews('REVIEW 202','1900-01-01T00:00:00Z',pg_temp.uid(1),20)),0::bigint,
  'A cursor beyond the final review returns an empty page');
SELECT is((SELECT count(*) FROM public.list_course_reviews('REVIEW 101')),2::bigint,'Pagination fixtures cannot contaminate another course');

RESET ROLE;
UPDATE auth.users SET deleted_at=now() WHERE id=pg_temp.uid(6);
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(6);
SELECT throws_ok($$SELECT public.get_course_review_summary('REVIEW 101')$$,'42501',NULL,'A soft-deleted identity cannot reuse a still-valid access token to read reviews');
SELECT throws_ok($$SELECT pg_temp.save_review(302)$$,'42501',NULL,'A soft-deleted identity cannot edit its existing review');
RESET ROLE;
DELETE FROM auth.users WHERE id=pg_temp.uid(6);
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(3);
SELECT is((pg_temp.summary()->>'review_count')::integer,1,'Account deletion removes its review from the anonymous aggregate');
SELECT is((SELECT count(*) FROM public.list_course_reviews('REVIEW 101')),1::bigint,'Account deletion also removes its anonymous feed entry');
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT * FROM finish();
ROLLBACK;
