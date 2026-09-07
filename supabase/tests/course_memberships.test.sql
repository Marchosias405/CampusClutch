BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(13);

-- =========================================================
-- Test identities
-- =========================================================

-- User A: enrolled caller
-- User B: discoverable classmate
-- User C: hidden classmate
-- User D: authenticated non-member

INSERT INTO auth.users (id, email)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'course-user-a@test.local'),
  ('22222222-2222-4222-8222-222222222222', 'course-user-b@test.local'),
  ('33333333-3333-4333-8333-333333333333', 'course-user-c@test.local'),
  ('44444444-4444-4444-8444-444444444444', 'course-user-d@test.local');

-- The existing Auth trigger creates the matching profile rows.

UPDATE public.profiles
SET
  display_name = 'Course User A',
  major = 'Computing Science',
  year_of_study = 2,
  campus_id = (
    SELECT id
    FROM public.campuses
    WHERE slug = 'burnaby'
  ),
  is_discoverable = true
WHERE id = '11111111-1111-4111-8111-111111111111';

UPDATE public.profiles
SET
  display_name = 'Course User B',
  major = 'Computing Science',
  year_of_study = 3,
  campus_id = (
    SELECT id
    FROM public.campuses
    WHERE slug = 'burnaby'
  ),
  is_discoverable = true
WHERE id = '22222222-2222-4222-8222-222222222222';

UPDATE public.profiles
SET
  display_name = 'Course User C',
  major = 'Interactive Arts',
  year_of_study = 2,
  campus_id = (
    SELECT id
    FROM public.campuses
    WHERE slug = 'burnaby'
  ),
  is_discoverable = false
WHERE id = '33333333-3333-4333-8333-333333333333';

UPDATE public.profiles
SET
  display_name = 'Course User D',
  major = 'Business',
  year_of_study = 1,
  campus_id = (
    SELECT id
    FROM public.campuses
    WHERE slug = 'surrey'
  ),
  is_discoverable = true
WHERE id = '44444444-4444-4444-8444-444444444444';


-- =========================================================
-- Shared interests
-- =========================================================

INSERT INTO public.profile_interests (
  profile_id,
  interest_id
)
SELECT
  '11111111-1111-4111-8111-111111111111'::uuid,
  id
FROM public.interests
WHERE slug = 'coding';

INSERT INTO public.profile_interests (
  profile_id,
  interest_id
)
SELECT
  '22222222-2222-4222-8222-222222222222'::uuid,
  id
FROM public.interests
WHERE slug = 'coding';


-- =========================================================
-- Academic term and courses
-- =========================================================

INSERT INTO public.academic_terms (
  id,
  code,
  display_name,
  year,
  season,
  starts_on,
  ends_on,
  status
)
VALUES (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '2099-summer',
  'Summer 2099',
  2099,
  'summer',
  '2099-05-01',
  '2099-08-31',
  'current'
);

INSERT INTO public.courses (
  id,
  code,
  title,
  term_id,
  campus_id,
  status
)
VALUES
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    'CMPT 295',
    'Introduction to Computer Systems',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (
      SELECT id
      FROM public.campuses
      WHERE slug = 'burnaby'
    ),
    'active'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'CMPT 276',
    'Introduction to Software Engineering',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (
      SELECT id
      FROM public.campuses
      WHERE slug = 'burnaby'
    ),
    'active'
  );


-- User B is a visible classmate.
-- User C shares the course but is hidden.

INSERT INTO public.course_memberships (
  course_id,
  profile_id,
  status
)
VALUES
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    '22222222-2222-4222-8222-222222222222',
    'enrolled'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    '33333333-3333-4333-8333-333333333333',
    'enrolled'
  );


-- =========================================================
-- Authenticate as User A
-- =========================================================

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub =
  '11111111-1111-4111-8111-111111111111';


-- 1. Joining an active course works.

SELECT results_eq(
  $$
    SELECT public.join_my_course(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'::uuid
    )
  $$,
  ARRAY['joined'::text],
  'User can join an active course'
);


-- 2. Repeating the join is idempotent.

SELECT results_eq(
  $$
    SELECT public.join_my_course(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'::uuid
    )
  $$,
  ARRAY['already_enrolled'::text],
  'Duplicate join returns already_enrolled'
);


-- 3. Duplicate join did not create another row.

SELECT results_eq(
  $$
    SELECT count(*)
    FROM public.course_memberships
    WHERE course_id =
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'::uuid
      AND profile_id =
      '11111111-1111-4111-8111-111111111111'::uuid
  $$,
  ARRAY[1::bigint],
  'Duplicate join does not create duplicate membership'
);


-- 4. Direct membership creation is not available to the client.

SELECT throws_like(
  $$
    INSERT INTO public.course_memberships (
      course_id,
      profile_id,
      status
    )
    VALUES (
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
      '11111111-1111-4111-8111-111111111111',
      'enrolled'
    )
  $$,
  '%permission denied%',
  'Authenticated client cannot directly insert memberships'
);


-- 5. User A can read their own membership.

SELECT results_eq(
  $$
    SELECT count(*)
    FROM public.course_memberships
    WHERE profile_id =
      '11111111-1111-4111-8111-111111111111'::uuid
  $$,
  ARRAY[1::bigint],
  'User can read their own membership'
);


-- 6. User A cannot directly read User B membership rows.

SELECT results_eq(
  $$
    SELECT count(*)
    FROM public.course_memberships
    WHERE profile_id =
      '22222222-2222-4222-8222-222222222222'::uuid
  $$,
  ARRAY[0::bigint],
  'User cannot directly read another profile membership'
);


-- 7. Leaving transitions the membership instead of deleting it.

SELECT results_eq(
  $$
    SELECT public.leave_my_course(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'::uuid
    )
  $$,
  ARRAY['left'::text],
  'User can leave their own enrolled course'
);


-- 8. Left membership is retained with an end timestamp.

SELECT results_eq(
  $$
    SELECT
      status,
      ended_at IS NOT NULL
    FROM public.course_memberships
    WHERE course_id =
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'::uuid
      AND profile_id =
      '11111111-1111-4111-8111-111111111111'::uuid
  $$,
  $$
    VALUES ('left'::text, true)
  $$,
  'Leaving retains membership history and sets ended_at'
);


-- 9. A left membership can safely rejoin.

SELECT results_eq(
  $$
    SELECT public.join_my_course(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'::uuid
    )
  $$,
  ARRAY['rejoined'::text],
  'Left membership can rejoin an active course'
);


-- 10. Rejoin restores enrolled state and clears ended_at.

SELECT results_eq(
  $$
    SELECT
      status,
      ended_at IS NULL
    FROM public.course_memberships
    WHERE course_id =
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'::uuid
      AND profile_id =
      '11111111-1111-4111-8111-111111111111'::uuid
  $$,
  $$
    VALUES ('enrolled'::text, true)
  $$,
  'Rejoin restores enrolled membership state'
);


-- =========================================================
-- Authenticate as non-member User D
-- =========================================================

SET LOCAL request.jwt.claim.sub =
  '44444444-4444-4444-8444-444444444444';


-- 11. A non-member cannot query classmates.

SELECT throws_like(
  $$
    SELECT *
    FROM public.get_course_classmates(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'::uuid
    )
  $$,
  '%must be enrolled%',
  'Non-member cannot access classmate discovery'
);


-- =========================================================
-- Authenticate as enrolled User A again
-- =========================================================

SET LOCAL request.jwt.claim.sub =
  '11111111-1111-4111-8111-111111111111';


-- 12. Classmate lookup returns only the discoverable enrolled peer.
-- Hidden User C must not appear.

SELECT results_eq(
  $$
    SELECT profile_id
    FROM public.get_course_classmates(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'::uuid
    )
    ORDER BY profile_id
  $$,
  ARRAY[
    '22222222-2222-4222-8222-222222222222'::uuid
  ],
  'Classmate lookup excludes hidden profiles and the caller'
);


-- 13. Shared interests are derived correctly.

SELECT results_eq(
  $$
    SELECT shared_interest_count
    FROM public.get_course_classmates(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'::uuid
    )
    WHERE profile_id =
      '22222222-2222-4222-8222-222222222222'::uuid
  $$,
  ARRAY[1::integer],
  'Classmate lookup derives shared interest count'
);


SELECT * FROM finish();

ROLLBACK;
