-- Task 7: Persist courses, academic terms, and course memberships.
--
-- This migration adds:
--   - academic term reference data
--   - course offerings
--   - persistent profile/course memberships
--   - backend-enforced join/leave operations
--   - a privacy-aware classmate query
--
-- Course catalog and term rows are trusted reference data.
-- Normal mobile clients cannot create or modify them.

-- =========================================================
-- Academic terms
-- =========================================================

create table public.academic_terms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  display_name text not null,
  year smallint not null,
  season text not null,
  starts_on date not null,
  ends_on date not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint academic_terms_code_check
    check (
      char_length(code) between 1 and 40
      and code = lower(code)
      and code = btrim(code)
    ),

  constraint academic_terms_display_name_check
    check (
      char_length(display_name) between 1 and 80
      and display_name = btrim(display_name)
    ),

  constraint academic_terms_year_check
    check (year between 2000 and 2200),

  constraint academic_terms_season_check
    check (season in ('spring', 'summer', 'fall')),

  constraint academic_terms_code_matches_term_check
    check (code = year::text || '-' || season),

  constraint academic_terms_dates_check
    check (ends_on > starts_on),

  constraint academic_terms_status_check
    check (status in ('upcoming', 'current', 'past'))
);

comment on table public.academic_terms is
  'Trusted CampusClutch academic-term reference data.';


create or replace function public.prepare_academic_term_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.code := lower(btrim(new.code));
  new.display_name := btrim(new.display_name);
  new.season := lower(btrim(new.season));
  new.status := lower(btrim(new.status));

  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;

  return new;
end;
$$;

revoke all
on function public.prepare_academic_term_write()
from public;

revoke all
on function public.prepare_academic_term_write()
from anon;

revoke all
on function public.prepare_academic_term_write()
from authenticated;

create trigger prepare_academic_term_write
before insert or update on public.academic_terms
for each row
execute function public.prepare_academic_term_write();


-- =========================================================
-- Courses
-- =========================================================

create table public.courses (
  id uuid primary key default gen_random_uuid(),

  code text not null,
  title text not null,

  term_id uuid not null
    references public.academic_terms (id) on delete restrict,

  campus_id uuid
    references public.campuses (id) on delete restrict,

  status text not null default 'active',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint courses_code_check
    check (
      char_length(code) between 2 and 32
      and code = upper(code)
      and code = btrim(code)
      and code !~ '\s{2,}'
    ),

  constraint courses_title_check
    check (
      char_length(title) between 1 and 160
      and title = btrim(title)
    ),

  constraint courses_status_check
    check (status in ('active', 'closed', 'archived'))
);

comment on table public.courses is
  'CampusClutch course offerings. Each row belongs to one academic term.';


create or replace function public.prepare_course_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.code := upper(
    regexp_replace(
      btrim(new.code),
      '\s+',
      ' ',
      'g'
    )
  );

  new.title := btrim(new.title);
  new.status := lower(btrim(new.status));

  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;

  return new;
end;
$$;

revoke all
on function public.prepare_course_write()
from public;

revoke all
on function public.prepare_course_write()
from anon;

revoke all
on function public.prepare_course_write()
from authenticated;

create trigger prepare_course_write
before insert or update on public.courses
for each row
execute function public.prepare_course_write();


-- PostgreSQL treats NULL values as distinct in a normal unique constraint.
-- Separate indexes prevent duplicate offerings both with and without campus.

create unique index courses_code_term_without_campus_uidx
on public.courses (code, term_id)
where campus_id is null;

create unique index courses_code_term_with_campus_uidx
on public.courses (code, term_id, campus_id)
where campus_id is not null;


-- =========================================================
-- Course memberships
-- =========================================================

create table public.course_memberships (
  course_id uuid not null
    references public.courses (id) on delete cascade,

  profile_id uuid not null
    references public.profiles (id) on delete cascade,

  status text not null default 'enrolled',

  joined_at timestamptz not null default now(),
  ended_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (course_id, profile_id),

  constraint course_memberships_status_check
    check (status in ('enrolled', 'completed', 'left')),

  constraint course_memberships_end_state_check
    check (
      (
        status = 'enrolled'
        and ended_at is null
      )
      or (
        status in ('completed', 'left')
        and ended_at is not null
      )
    ),

  constraint course_memberships_timestamp_check
    check (
      ended_at is null
      or ended_at >= joined_at
    )
);

comment on table public.course_memberships is
  'Persistent many-to-many relationship between CampusClutch profiles and course offerings.';


create or replace function public.prepare_course_membership_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.course_id is distinct from old.course_id
       or new.profile_id is distinct from old.profile_id then
      raise exception 'Course membership ownership cannot be changed.';
    end if;

    new.updated_at := now();
  end if;

  if new.status = 'enrolled' then
    new.ended_at := null;
  elsif new.ended_at is null then
    new.ended_at := now();
  end if;

  return new;
end;
$$;

revoke all
on function public.prepare_course_membership_write()
from public;

revoke all
on function public.prepare_course_membership_write()
from anon;

revoke all
on function public.prepare_course_membership_write()
from authenticated;

create trigger prepare_course_membership_write
before insert or update on public.course_memberships
for each row
execute function public.prepare_course_membership_write();


-- =========================================================
-- Indexes
-- =========================================================

create index academic_terms_status_year_idx
on public.academic_terms (status, year);

create index courses_term_status_idx
on public.courses (term_id, status);

create index courses_campus_id_idx
on public.courses (campus_id)
where campus_id is not null;

create index course_memberships_profile_status_course_idx
on public.course_memberships (profile_id, status, course_id);

create index course_memberships_course_status_profile_idx
on public.course_memberships (course_id, status, profile_id);


-- =========================================================
-- Row Level Security and grants
-- =========================================================

alter table public.academic_terms enable row level security;
alter table public.courses enable row level security;
alter table public.course_memberships enable row level security;


-- Academic terms are trusted reference data.
-- Authenticated clients may read them but cannot modify them.

revoke all on table public.academic_terms from anon;
revoke all on table public.academic_terms from authenticated;

grant select
on table public.academic_terms
to authenticated;

create policy "Authenticated users can read academic terms"
on public.academic_terms
for select
to authenticated
using (true);


-- Authenticated users can read:
--   - active catalog courses
--   - closed/archived offerings already associated with themselves
--
-- Normal clients cannot administer the course catalog.

revoke all on table public.courses from anon;
revoke all on table public.courses from authenticated;

grant select
on table public.courses
to authenticated;

create policy "Authenticated users can read approved courses"
on public.courses
for select
to authenticated
using (
  status = 'active'
  or exists (
    select 1
    from public.course_memberships
    where course_memberships.course_id = courses.id
      and course_memberships.profile_id = (select auth.uid())
  )
);


-- Clients can directly read only their own membership rows.
--
-- INSERT/UPDATE/DELETE are deliberately not granted.
-- Joining and leaving happen through the narrow functions below.

revoke all on table public.course_memberships from anon;
revoke all on table public.course_memberships from authenticated;

grant select
on table public.course_memberships
to authenticated;

create policy "Users can read their own course memberships"
on public.course_memberships
for select
to authenticated
using (
  profile_id = (select auth.uid())
);


-- =========================================================
-- Join course
-- =========================================================

create or replace function public.join_my_course(
  p_course_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_profile_id uuid := auth.uid();
  course_status text;
  existing_status text;
  affected_rows integer;
begin
  if current_profile_id is null then
    raise exception 'Authentication is required.';
  end if;

  if not exists (
    select 1
    from public.profiles
    where profiles.id = current_profile_id
  ) then
    raise exception 'Profile is unavailable.';
  end if;

  select courses.status
  into course_status
  from public.courses
  where courses.id = p_course_id;

  if not found then
    raise exception 'Course not found.';
  end if;

  if course_status <> 'active' then
    raise exception 'This course is not open for membership.';
  end if;

  insert into public.course_memberships (
    course_id,
    profile_id,
    status
  )
  values (
    p_course_id,
    current_profile_id,
    'enrolled'
  )
  on conflict (course_id, profile_id) do nothing;

  get diagnostics affected_rows = row_count;

  if affected_rows = 1 then
    return 'joined';
  end if;

  select course_memberships.status
  into existing_status
  from public.course_memberships
  where course_memberships.course_id = p_course_id
    and course_memberships.profile_id = current_profile_id
  for update;

  if existing_status = 'enrolled' then
    return 'already_enrolled';
  end if;

  if existing_status = 'left' then
    update public.course_memberships
    set
      status = 'enrolled',
      joined_at = now(),
      ended_at = null
    where course_memberships.course_id = p_course_id
      and course_memberships.profile_id = current_profile_id;

    return 'rejoined';
  end if;

  if existing_status = 'completed' then
    raise exception 'A completed course membership cannot be rejoined.';
  end if;

  raise exception 'Course membership could not be created.';
end;
$$;

comment on function public.join_my_course(uuid) is
  'Joins or safely rejoins an active course as the authenticated profile.';

revoke all
on function public.join_my_course(uuid)
from public;

revoke all
on function public.join_my_course(uuid)
from anon;

revoke all
on function public.join_my_course(uuid)
from authenticated;

grant execute
on function public.join_my_course(uuid)
to authenticated;


-- =========================================================
-- Leave course
-- =========================================================

create or replace function public.leave_my_course(
  p_course_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_profile_id uuid := auth.uid();
  existing_status text;
begin
  if current_profile_id is null then
    raise exception 'Authentication is required.';
  end if;

  select course_memberships.status
  into existing_status
  from public.course_memberships
  where course_memberships.course_id = p_course_id
    and course_memberships.profile_id = current_profile_id
  for update;

  if not found then
    raise exception 'Course membership not found.';
  end if;

  if existing_status = 'left' then
    return 'already_left';
  end if;

  if existing_status = 'completed' then
    raise exception 'A completed course cannot be left.';
  end if;

  update public.course_memberships
  set
    status = 'left',
    ended_at = now()
  where course_memberships.course_id = p_course_id
    and course_memberships.profile_id = current_profile_id;

  return 'left';
end;
$$;

comment on function public.leave_my_course(uuid) is
  'Transitions the authenticated user''s enrolled course membership to left without deleting history.';

revoke all
on function public.leave_my_course(uuid)
from public;

revoke all
on function public.leave_my_course(uuid)
from anon;

revoke all
on function public.leave_my_course(uuid)
from authenticated;

grant execute
on function public.leave_my_course(uuid)
to authenticated;


-- =========================================================
-- Classmate lookup
-- =========================================================

create or replace function public.get_course_classmates(
  p_course_id uuid
)
returns table (
  profile_id uuid,
  display_name text,
  major text,
  year_of_study smallint,
  campus_id uuid,
  campus_display_name text,
  avatar_path text,
  shared_interests text[],
  shared_interest_count integer,
  same_campus boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_profile_id uuid := auth.uid();
  current_campus_id uuid;
  requested_course_status text;
  requested_term_status text;
begin
  if current_profile_id is null then
    raise exception 'Authentication is required.';
  end if;

  select
    profiles.campus_id
  into current_campus_id
  from public.profiles
  where profiles.id = current_profile_id;

  if not found then
    raise exception 'Profile is unavailable.';
  end if;

  select
    courses.status,
    academic_terms.status
  into
    requested_course_status,
    requested_term_status
  from public.courses
  join public.academic_terms
    on academic_terms.id = courses.term_id
  where courses.id = p_course_id;

  if not found then
    raise exception 'Course not found.';
  end if;

  if requested_course_status = 'archived'
     or requested_term_status <> 'current' then
    raise exception 'Classmate discovery is unavailable for this course.';
  end if;

  if not exists (
    select 1
    from public.course_memberships
    where course_memberships.course_id = p_course_id
      and course_memberships.profile_id = current_profile_id
      and course_memberships.status = 'enrolled'
  ) then
    raise exception 'You must be enrolled in this course to view classmates.';
  end if;

  return query
  select
    profiles.id as profile_id,
    profiles.display_name,
    profiles.major,
    profiles.year_of_study,
    profiles.campus_id,
    campuses.display_name as campus_display_name,
    profiles.avatar_path,

    coalesce(
      shared.shared_interests,
      array[]::text[]
    ) as shared_interests,

    coalesce(
      shared.shared_interest_count,
      0
    )::integer as shared_interest_count,

    (
      profiles.campus_id is not null
      and current_campus_id is not null
      and profiles.campus_id = current_campus_id
    ) as same_campus

  from public.course_memberships
  join public.profiles
    on profiles.id = course_memberships.profile_id

  left join public.campuses
    on campuses.id = profiles.campus_id

  left join lateral (
    select
      array_agg(
        interests.display_name
        order by interests.display_name
      ) as shared_interests,

      count(*)::integer as shared_interest_count

    from public.profile_interests as classmate_interests

    join public.profile_interests as my_interests
      on my_interests.profile_id = current_profile_id
      and my_interests.interest_id = classmate_interests.interest_id

    join public.interests
      on interests.id = classmate_interests.interest_id
      and interests.is_active = true

    where classmate_interests.profile_id = profiles.id
  ) as shared
  on true

  where course_memberships.course_id = p_course_id
    and course_memberships.status = 'enrolled'
    and profiles.id <> current_profile_id
    and profiles.is_discoverable = true
    and profiles.onboarding_completed_at is not null
    and profiles.display_name is not null

  order by
    coalesce(shared.shared_interest_count, 0) desc,
    lower(profiles.display_name),
    profiles.id;
end;
$$;

comment on function public.get_course_classmates(uuid) is
  'Returns approved discoverable classmates only when the authenticated caller is enrolled in the requested current course.';

revoke all
on function public.get_course_classmates(uuid)
from public;

revoke all
on function public.get_course_classmates(uuid)
from anon;

revoke all
on function public.get_course_classmates(uuid)
from authenticated;

grant execute
on function public.get_course_classmates(uuid)
to authenticated;
