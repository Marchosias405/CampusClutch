-- CampusClutch local development seed data.
--
-- Schema changes belong in version-controlled migration files.
-- These records are development fixtures only.
-- Never add production credentials, real student accounts, or private data.

-- =========================================================
-- Academic terms
-- =========================================================
--
-- 2026 date boundaries use SFU's published academic calendar:
--   Spring: classes Jan 5; exams end Apr 25
--   Summer: classes May 11; exams end Aug 23
--   Fall:   classes Sep 9; exams end Dec 20

insert into public.academic_terms (
  id,
  code,
  display_name,
  year,
  season,
  starts_on,
  ends_on,
  status
)
values
  (
    '10000000-0000-4000-8000-000000000001',
    '2026-spring',
    'Spring 2026',
    2026,
    'spring',
    '2026-01-05',
    '2026-04-25',
    'past'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    '2026-summer',
    'Summer 2026',
    2026,
    'summer',
    '2026-05-11',
    '2026-08-23',
    'current'
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    '2026-fall',
    'Fall 2026',
    2026,
    'fall',
    '2026-09-09',
    '2026-12-20',
    'upcoming'
  )
on conflict (code) do update
set
  display_name = excluded.display_name,
  year = excluded.year,
  season = excluded.season,
  starts_on = excluded.starts_on,
  ends_on = excluded.ends_on,
  status = excluded.status;


-- =========================================================
-- Development course catalog
-- =========================================================
--
-- These are safe development fixtures based on the course records already
-- represented in the CampusClutch mock UI. They are not production enrolment
-- or official university-registration records.

insert into public.courses (
  id,
  code,
  title,
  term_id,
  campus_id,
  status
)
values
  (
    '20000000-0000-4000-8000-000000000001',
    'CMPT 361',
    'Computer Graphics',
    '10000000-0000-4000-8000-000000000002',
    (
      select id
      from public.campuses
      where slug = 'burnaby'
    ),
    'active'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    'CMPT 276',
    'Intro to Software Engineering',
    '10000000-0000-4000-8000-000000000002',
    (
      select id
      from public.campuses
      where slug = 'burnaby'
    ),
    'active'
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    'CMPT 371',
    'Data Communications',
    '10000000-0000-4000-8000-000000000002',
    (
      select id
      from public.campuses
      where slug = 'burnaby'
    ),
    'active'
  ),
  (
    '20000000-0000-4000-8000-000000000004',
    'BUS 237',
    'Information Systems',
    '10000000-0000-4000-8000-000000000002',
    (
      select id
      from public.campuses
      where slug = 'burnaby'
    ),
    'active'
  ),

  -- Past-term fixtures let Task 7 exercise Previous Courses without allowing
  -- the client to forge a completed membership status.

  (
    '20000000-0000-4000-8000-000000000005',
    'CMPT 225',
    'Data Structures',
    '10000000-0000-4000-8000-000000000001',
    (
      select id
      from public.campuses
      where slug = 'burnaby'
    ),
    'active'
  ),
  (
    '20000000-0000-4000-8000-000000000006',
    'MACM 101',
    'Discrete Math',
    '10000000-0000-4000-8000-000000000001',
    (
      select id
      from public.campuses
      where slug = 'burnaby'
    ),
    'active'
  )
on conflict do nothing;
