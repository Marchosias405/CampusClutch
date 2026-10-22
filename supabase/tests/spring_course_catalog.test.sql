BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- Every fixture and the restrictive policy below are rolled back. The generated
-- catalog exceeds PostgREST's normal row cap, but every RPC page stays <= 100.
INSERT INTO auth.users (id, email)
VALUES ('ca270000-0000-4270-8270-000000000001', 'spring-catalog@test.local');

INSERT INTO public.academic_terms
  (id, code, display_name, year, season, starts_on, ends_on, status)
VALUES
  ('ca270000-0000-4270-8270-000000000010', '2097-spring', 'Spring 2097',
    2097, 'spring', '2097-01-01', '2097-04-30', 'upcoming'),
  ('ca270000-0000-4270-8270-000000000011', '2097-summer', 'Summer 2097',
    2097, 'summer', '2097-05-01', '2097-08-31', 'current');

INSERT INTO public.courses
  (id, code, title, term_id, campus_id, status, units, degree_level, delivery_mode)
SELECT
  ('ca270001-0000-4270-8270-' || lpad((n * 2 + campus_number)::text, 12, '0'))::uuid,
  'PAGE ' || lpad(n::text, 4, '0'), 'Catalog pagination fixture ' || n,
  'ca270000-0000-4270-8270-000000000010', campus.id, 'active', 3,
  'undergraduate', 'in_person'
FROM generate_series(1, 625) AS n
CROSS JOIN (VALUES (0, 'burnaby'), (1, 'surrey')) AS chosen(campus_number, slug)
JOIN public.campuses AS campus ON campus.slug = chosen.slug;

INSERT INTO public.courses
  (id, code, title, term_id, campus_id, status, units, degree_level, delivery_mode)
VALUES
  ('ca270002-0000-4270-8270-000000000001', 'CMPT 125', 'Introduction to Computing',
    'ca270000-0000-4270-8270-000000000010',
    (SELECT id FROM public.campuses WHERE slug = 'burnaby'), 'active', 3,
    'undergraduate', 'in_person'),
  ('ca270002-0000-4270-8270-000000000002', 'CMPT 125', 'Different term computing',
    'ca270000-0000-4270-8270-000000000011',
    (SELECT id FROM public.campuses WHERE slug = 'burnaby'), 'active', 4,
    'undergraduate', 'in_person'),
  ('ca270002-0000-4270-8270-000000000003', 'LIT 101', '100% practical',
    'ca270000-0000-4270-8270-000000000010', NULL, 'active', 3,
    'undergraduate', 'online'),
  ('ca270002-0000-4270-8270-000000000004', 'LIT 102', 'An under_score example',
    'ca270000-0000-4270-8270-000000000010', NULL, 'active', 4,
    'undergraduate', 'online'),
  ('ca270002-0000-4270-8270-000000000005', 'LIT 103', E'A back\\slash example',
    'ca270000-0000-4270-8270-000000000010', NULL, 'active', 5,
    'undergraduate', 'mixed'),
  ('ca270002-0000-4270-8270-000000000006', 'HIST 101', 'Closed catalog fixture',
    'ca270000-0000-4270-8270-000000000010', NULL, 'closed', 3,
    'undergraduate', 'online'),
  ('ca270002-0000-4270-8270-000000000007', 'HIST 102', 'Archived catalog fixture',
    'ca270000-0000-4270-8270-000000000010', NULL, 'archived', 3,
    'undergraduate', 'online'),
  ('ca270002-0000-4270-8270-000000000008', 'LEGACY 100', 'Legacy metadata unknown',
    'ca270000-0000-4270-8270-000000000010', NULL, 'active', NULL, NULL, NULL);

-- These rows are visible through the existing membership RLS exception, but
-- discovery must still exclude closed and archived offerings.
INSERT INTO public.course_memberships (course_id, profile_id, status)
VALUES
  ('ca270002-0000-4270-8270-000000000006', 'ca270000-0000-4270-8270-000000000001', 'enrolled'),
  ('ca270002-0000-4270-8270-000000000007', 'ca270000-0000-4270-8270-000000000001', 'enrolled');

SELECT ok(NOT (SELECT prosecdef FROM pg_proc
  WHERE oid = 'public.search_course_catalog(uuid,text,text,uuid,integer)'::regprocedure),
  'Catalog search uses caller privileges');
SELECT ok(has_function_privilege('authenticated',
  'public.search_course_catalog(uuid,text,text,uuid,integer)', 'EXECUTE'),
  'Authenticated clients can search the catalog');
SELECT ok(NOT has_function_privilege('anon',
  'public.search_course_catalog(uuid,text,text,uuid,integer)', 'EXECUTE'),
  'Anonymous clients cannot call catalog search');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.courses'::regclass),
  'Course row security remains enabled');

-- Validate metadata as the trusted owner, so failures cannot be masked by RLS.
SELECT throws_ok($$UPDATE public.courses SET units = -1
  WHERE id = 'ca270002-0000-4270-8270-000000000001'$$, '23514', NULL,
  'Negative units are rejected');
SELECT throws_ok($$UPDATE public.courses SET units = 0
  WHERE id = 'ca270002-0000-4270-8270-000000000001'$$, '23514', NULL,
  'Zero units are rejected');
SELECT throws_ok($$UPDATE public.courses SET units = 100.01
  WHERE id = 'ca270002-0000-4270-8270-000000000001'$$, '23514', NULL,
  'Units above the supported range are rejected');
SELECT throws_ok($$UPDATE public.courses SET degree_level = 'unknown'
  WHERE id = 'ca270002-0000-4270-8270-000000000001'$$, '23514', NULL,
  'Unrecognized degree level is rejected');
SELECT throws_ok($$UPDATE public.courses SET delivery_mode = 'unknown'
  WHERE id = 'ca270002-0000-4270-8270-000000000001'$$, '23514', NULL,
  'Unrecognized delivery mode is rejected');
SELECT lives_ok($$UPDATE public.courses SET units = 3.5
  WHERE id = 'ca270002-0000-4270-8270-000000000005'$$,
  'Fractional positive units remain supported');
SELECT lives_ok($$UPDATE public.courses SET degree_level = 'graduate', units = 100
  WHERE id = 'ca270002-0000-4270-8270-000000000002'$$,
  'General catalog metadata accepts a valid graduate level and upper unit boundary');
SELECT throws_ok($$UPDATE public.courses SET source_sections = '{}'::jsonb
  WHERE id = 'ca270002-0000-4270-8270-000000000003'$$, '23514', NULL,
  'Source sections must be an array');
SELECT throws_ok($$UPDATE public.courses SET catalog_source = 'unapproved-source'
  WHERE id = 'ca270002-0000-4270-8270-000000000003'$$, '23514', NULL,
  'Unrecognized catalog provenance is rejected');
SELECT throws_ok($$UPDATE public.courses SET catalog_source = 'sfu-course-outlines'
  WHERE id = 'ca270002-0000-4270-8270-000000000003'$$, '23514', NULL,
  'SFU provenance requires a fetched timestamp and source sections');
SELECT lives_ok($$UPDATE public.courses
  SET catalog_source = 'sfu-course-outlines', source_fetched_at = clock_timestamp(),
      source_sections = '[{"section":"D100","url":"https://www.sfu.ca/outlines.html?2027/spring/cmpt/125/d100"}]'::jsonb
  WHERE id = 'ca270002-0000-4270-8270-000000000003'$$,
  'A documented undergraduate offering of at least three units is accepted');
SELECT throws_ok($$UPDATE public.courses SET units = 2.99
  WHERE id = 'ca270002-0000-4270-8270-000000000003'$$, '23514', NULL,
  'SFU catalog cannot include an offering below three units');
SELECT throws_ok($$UPDATE public.courses SET degree_level = 'graduate'
  WHERE id = 'ca270002-0000-4270-8270-000000000003'$$, '23514', NULL,
  'SFU catalog cannot include a graduate offering');
SELECT throws_ok($$UPDATE public.courses SET units = NULL
  WHERE id = 'ca270002-0000-4270-8270-000000000003'$$, '23514', NULL,
  'Missing units cannot bypass SFU catalog eligibility');
SELECT throws_ok($$UPDATE public.courses SET degree_level = NULL
  WHERE id = 'ca270002-0000-4270-8270-000000000003'$$, '23514', NULL,
  'Missing degree level cannot bypass SFU catalog eligibility');
SELECT throws_ok($$UPDATE public.courses SET source_sections = '[]'::jsonb
  WHERE id = 'ca270002-0000-4270-8270-000000000003'$$, '23514', NULL,
  'An imported offering must retain at least one source section');

-- Capture the complete expected order with owner access. Walking the pages is
-- done as authenticated below; this is independent of the RPC's own ordering.
CREATE TEMP TABLE expected_pages AS
SELECT row_number() OVER (ORDER BY code COLLATE "C", id) AS position, id, code
FROM public.courses
WHERE term_id = 'ca270000-0000-4270-8270-000000000010'
  AND code LIKE 'PAGE %' AND status = 'active';
CREATE TEMP TABLE actual_pages (position bigint, id uuid, code text, page_number integer);
CREATE TEMP TABLE page_sizes (page_number integer, page_size integer);
GRANT SELECT ON expected_pages TO authenticated;
GRANT ALL ON actual_pages, page_sizes TO authenticated;

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.search_course_catalog(
  'ca270000-0000-4270-8270-000000000010')$$, '42501', NULL,
  'Anonymous API execution is denied');
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '';
SELECT throws_ok($$SELECT * FROM public.search_course_catalog(
  'ca270000-0000-4270-8270-000000000010')$$, '42501', 'Authentication is required.',
  'An authenticated role without a user identity is denied');
SET LOCAL request.jwt.claim.sub = 'ca270000-0000-4270-8270-000000000001';

SELECT is((SELECT count(*) FROM public.search_course_catalog(
  'ca270000-0000-4270-8270-000000000010', 'PAGE')), 30::bigint,
  'Default catalog page contains 30 rows');
SELECT is((SELECT count(*) FROM public.search_course_catalog(
  'ca270000-0000-4270-8270-000000000010', 'PAGE', NULL, NULL, 1)), 1::bigint,
  'Minimum page size is honored');
SELECT is((SELECT count(*) FROM public.search_course_catalog(
  'ca270000-0000-4270-8270-000000000010', 'PAGE', NULL, NULL, 100)), 100::bigint,
  'Maximum page size is honored');

DO $walk$
DECLARE
  last_code text;
  last_id uuid;
  page_number integer := 0;
  page_size integer;
  seen_count bigint := 0;
  item record;
BEGIN
  LOOP
    page_number := page_number + 1;
    page_size := 0;
    FOR item IN SELECT * FROM public.search_course_catalog(
      'ca270000-0000-4270-8270-000000000010', 'PAGE', last_code, last_id, 100)
    LOOP
      seen_count := seen_count + 1;
      page_size := page_size + 1;
      INSERT INTO actual_pages VALUES (seen_count, item.id, item.code, page_number);
      last_code := item.code;
      last_id := item.id;
    END LOOP;
    INSERT INTO page_sizes VALUES (page_number, page_size);
    EXIT WHEN page_size = 0;
    IF page_number > 20 THEN
      RAISE EXCEPTION 'Catalog pagination did not terminate';
    END IF;
  END LOOP;
END;
$walk$;

SELECT is((SELECT count(*) FROM actual_pages), 1250::bigint,
  'Pagination retrieves more than 1000 matching offerings');
SELECT is((SELECT count(DISTINCT id) FROM actual_pages), 1250::bigint,
  'No offering is duplicated across pages');
SELECT results_eq($$SELECT id FROM actual_pages ORDER BY position$$,
  $$SELECT id FROM expected_pages ORDER BY position$$,
  'All pages match stable C-collation code and UUID order');
SELECT ok((SELECT bool_and(page_size <= 100) FROM page_sizes),
  'Every page remains within the configured API cap');
SELECT is((SELECT page_size FROM page_sizes ORDER BY page_number DESC LIMIT 1), 0,
  'The page after the final offering is empty');
SELECT is((SELECT count(*) FROM public.search_course_catalog(
  'ca270000-0000-4270-8270-000000000010', 'PAGE 0001')), 2::bigint,
  'The same course code at two campuses keeps both offerings');
SELECT results_eq($$SELECT id FROM public.search_course_catalog(
  'ca270000-0000-4270-8270-000000000010', 'PAGE 0001', 'PAGE 0001',
  'ca270001-0000-4270-8270-000000000002', 1)$$,
  ARRAY['ca270001-0000-4270-8270-000000000003'::uuid],
  'The UUID cursor includes the next campus with the same course code');

SELECT results_eq($$SELECT id FROM public.search_course_catalog(
  'ca270000-0000-4270-8270-000000000010', 'cmpt 125')$$,
  ARRAY['ca270002-0000-4270-8270-000000000001'::uuid],
  'Course-code search is case insensitive and isolated to the selected term');
SELECT results_eq($$SELECT id FROM public.search_course_catalog(
  'ca270000-0000-4270-8270-000000000010', E'  cmpt\t  125\n ')$$,
  ARRAY['ca270002-0000-4270-8270-000000000001'::uuid],
  'Search trims surrounding whitespace and collapses internal whitespace');
SELECT results_eq($$SELECT id FROM public.search_course_catalog(
  'ca270000-0000-4270-8270-000000000010', 'INTRODUCTION TO')$$,
  ARRAY['ca270002-0000-4270-8270-000000000001'::uuid],
  'Title substring search is case insensitive');
SELECT results_eq($$SELECT id FROM public.search_course_catalog(
  'ca270000-0000-4270-8270-000000000011', 'cmpt 125')$$,
  ARRAY['ca270002-0000-4270-8270-000000000002'::uuid],
  'Switching the term returns only that term offering');
SELECT is((SELECT count(*) FROM public.search_course_catalog(
  'ca270000-0000-4270-8270-000000000099')), 0::bigint,
  'An unknown term cannot broaden the search');
SELECT is((SELECT count(*) FROM public.search_course_catalog(
  'ca270000-0000-4270-8270-000000000010', 'does not exist')), 0::bigint,
  'No match returns an empty page');
SELECT results_eq($$SELECT id FROM public.search_course_catalog(
  'ca270000-0000-4270-8270-000000000010', '%')$$,
  ARRAY['ca270002-0000-4270-8270-000000000003'::uuid],
  'Percent is treated as literal search text');
SELECT results_eq($$SELECT id FROM public.search_course_catalog(
  'ca270000-0000-4270-8270-000000000010', '_')$$,
  ARRAY['ca270002-0000-4270-8270-000000000004'::uuid],
  'Underscore is treated as literal search text');
SELECT results_eq($$SELECT id FROM public.search_course_catalog(
  'ca270000-0000-4270-8270-000000000010', E'\\')$$,
  ARRAY['ca270002-0000-4270-8270-000000000005'::uuid],
  'Backslash is treated as literal search text');
SELECT results_eq($$SELECT id FROM public.search_course_catalog(
  'ca270000-0000-4270-8270-000000000010', '100%')$$,
  ARRAY['ca270002-0000-4270-8270-000000000003'::uuid],
  'Literal punctuation also works inside a longer query');
SELECT is((SELECT count(*) FROM public.courses WHERE id IN (
  'ca270002-0000-4270-8270-000000000006', 'ca270002-0000-4270-8270-000000000007')),
  2::bigint, 'Existing memberships still make closed and archived rows readable');
SELECT is((SELECT count(*) FROM public.search_course_catalog(
  'ca270000-0000-4270-8270-000000000010', 'HIST')), 0::bigint,
  'Catalog search excludes closed and archived offerings even for members');
SELECT results_eq($$SELECT units, degree_level, delivery_mode, campus_display_name
  FROM public.search_course_catalog('ca270000-0000-4270-8270-000000000010', 'CMPT 125')$$,
  $$SELECT 3::numeric, 'undergraduate'::text, 'in_person'::text,
    display_name FROM public.campuses WHERE slug = 'burnaby'$$,
  'Search returns units, level, delivery mode and the correct campus label');
SELECT ok((SELECT campus_id IS NULL AND campus_display_name IS NULL
  FROM public.search_course_catalog('ca270000-0000-4270-8270-000000000010', 'LIT 101')),
  'Online offering remains visible without a campus');
SELECT ok((SELECT units IS NULL AND degree_level IS NULL AND delivery_mode IS NULL
  FROM public.search_course_catalog('ca270000-0000-4270-8270-000000000010', 'LEGACY')),
  'Existing catalog rows with unknown metadata remain usable');

SELECT throws_ok($$SELECT * FROM public.search_course_catalog(NULL)$$,
  '22023', 'Academic term is required.', 'Term is mandatory');
SELECT throws_ok($$SELECT * FROM public.search_course_catalog(
  'ca270000-0000-4270-8270-000000000010', repeat('x', 101))$$,
  '22023', 'Search query must be at most 100 characters.', 'Oversized query is rejected');
SELECT lives_ok($$SELECT * FROM public.search_course_catalog(
  'ca270000-0000-4270-8270-000000000010', repeat('x', 100))$$,
  'A query at the length boundary is accepted');
SELECT throws_ok(format('SELECT * FROM public.search_course_catalog(%L, %L, NULL, NULL, %s)',
  'ca270000-0000-4270-8270-000000000010', '', invalid_limit),
  '22023', 'Page size must be between 1 and 100.', 'Invalid page limit rejected: ' || invalid_limit)
FROM unnest(ARRAY['0', '-1', '101', 'NULL']) AS invalid_limit;
SELECT throws_ok($$SELECT * FROM public.search_course_catalog(
  'ca270000-0000-4270-8270-000000000010', '', 'PAGE 0001', NULL)$$,
  '22023', 'Both cursor values are required.', 'Code-only cursor is rejected');
SELECT throws_ok($$SELECT * FROM public.search_course_catalog(
  'ca270000-0000-4270-8270-000000000010', '', NULL,
  'ca270001-0000-4270-8270-000000000002')$$,
  '22023', 'Both cursor values are required.', 'ID-only cursor is rejected');
SELECT throws_ok($$SELECT * FROM public.search_course_catalog(
  'ca270000-0000-4270-8270-000000000010', '', '',
  'ca270001-0000-4270-8270-000000000002')$$,
  '22023', 'Invalid course cursor.', 'Empty course cursor is rejected');
SELECT throws_ok($$SELECT * FROM public.search_course_catalog(
  'ca270000-0000-4270-8270-000000000010', '', repeat('X', 33),
  'ca270001-0000-4270-8270-000000000002')$$,
  '22023', 'Invalid course cursor.', 'Oversized course cursor is rejected');

SELECT throws_ok($$INSERT INTO public.courses (code, title, term_id)
  VALUES ('BAD 100', 'Unauthorized insert', 'ca270000-0000-4270-8270-000000000010')$$,
  '42501', NULL, 'A client cannot insert catalog rows');
SELECT throws_ok($$UPDATE public.courses SET units = 9
  WHERE id = 'ca270002-0000-4270-8270-000000000001'$$,
  '42501', NULL, 'A client cannot change catalog metadata');
SELECT throws_ok($$DELETE FROM public.courses
  WHERE id = 'ca270002-0000-4270-8270-000000000001'$$,
  '42501', NULL, 'A client cannot delete catalog rows');

SELECT is(public.join_my_course('ca270002-0000-4270-8270-000000000001'), 'joined',
  'An active upcoming offering can still be joined');
SELECT is((SELECT status FROM public.course_memberships
  WHERE course_id = 'ca270002-0000-4270-8270-000000000001'), 'enrolled',
  'Joining upcoming catalog offering persists the membership');
SELECT throws_ok($$SELECT * FROM public.get_course_classmates(
  'ca270002-0000-4270-8270-000000000001')$$,
  'P0001', 'Classmate discovery is unavailable for this course.',
  'Upcoming membership does not bypass existing current-term classmate privacy');

-- Prove invoker behavior against a real additional RLS restriction, instead of
-- trusting only the function declaration. Transaction rollback removes it.
RESET ROLE;
CREATE POLICY spring_catalog_test_visibility ON public.courses
AS RESTRICTIVE FOR SELECT TO authenticated
USING (id <> 'ca270002-0000-4270-8270-000000000001'::uuid);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.search_course_catalog(
  'ca270000-0000-4270-8270-000000000010', 'CMPT 125')), 0::bigint,
  'Catalog search honors an additional course RLS visibility restriction');
SELECT is((SELECT count(*) FROM public.search_course_catalog(
  'ca270000-0000-4270-8270-000000000010', 'LIT')), 3::bigint,
  'RLS restriction does not hide other approved offerings');

RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT * FROM finish();
ROLLBACK;
