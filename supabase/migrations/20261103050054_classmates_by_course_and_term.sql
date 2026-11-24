BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

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
  requested_course_code text;
  requested_term_id uuid;
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
    academic_terms.status,
    courses.code,
    courses.term_id
  into
    requested_course_status,
    requested_term_status,
    requested_course_code,
    requested_term_id
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

  from public.profiles

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

  where profiles.id <> current_profile_id
    and exists (
      select 1
      from public.courses as offering
      join public.course_memberships as membership
        on membership.course_id = offering.id
      where offering.code = requested_course_code
        and offering.term_id = requested_term_id
        and offering.status <> 'archived'
        and membership.status = 'enrolled'
        and membership.profile_id = profiles.id
    )
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
  'Returns discoverable classmates enrolled in the same course code and current term across campuses. The caller must be enrolled in the selected offering.';

COMMIT;
