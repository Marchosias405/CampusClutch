-- Task 6: Persist user profiles, campuses, interests, and avatar storage.

-- =========================================================
-- Campuses
-- =========================================================

create table public.campuses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null unique,
  created_at timestamptz not null default now(),

  constraint campuses_slug_format_check
    check (
      char_length(slug) between 1 and 40
      and slug = lower(slug)
      and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    ),

  constraint campuses_display_name_check
    check (
      char_length(display_name) between 1 and 80
      and display_name = btrim(display_name)
    )
);

comment on table public.campuses is
  'Shared CampusClutch campus reference data.';

alter table public.campuses enable row level security;

revoke all on table public.campuses from anon;
revoke all on table public.campuses from authenticated;

grant select on table public.campuses to authenticated;

create policy "Authenticated users can read campuses"
on public.campuses
for select
to authenticated
using (true);

insert into public.campuses (slug, display_name)
values
  ('burnaby', 'Burnaby Campus'),
  ('surrey', 'Surrey Campus'),
  ('vancouver', 'Vancouver Campus')
on conflict (slug) do update
set display_name = excluded.display_name;


-- =========================================================
-- Profiles
-- =========================================================

alter table public.profiles
  add column display_name text,
  add column major text,
  add column year_of_study smallint,
  add column campus_id uuid references public.campuses (id) on delete restrict,
  add column avatar_path text,
  add column is_discoverable boolean not null default false;

comment on column public.profiles.display_name is
  'Trimmed user-facing profile name. Required after onboarding.';

comment on column public.profiles.avatar_path is
  'Current object path inside the private avatars Storage bucket.';


alter table public.profiles
  add constraint profiles_display_name_check
    check (
      display_name is null
      or (
        char_length(display_name) between 1 and 80
        and display_name = btrim(display_name)
      )
    ),

  add constraint profiles_major_check
    check (
      major is null
      or (
        char_length(major) between 1 and 120
        and major = btrim(major)
      )
    ),

  add constraint profiles_year_of_study_check
    check (
      year_of_study is null
      or year_of_study between 1 and 8
    ),

  add constraint profiles_avatar_path_check
    check (
      avatar_path is null
      or (
        char_length(avatar_path) between 1 and 512
        and split_part(avatar_path, '/', 1) = id::text
      )
    ),

  add constraint profiles_completed_profile_check
    check (
      onboarding_completed_at is null
      or display_name is not null
    );


-- Normalize editable text, automatically complete onboarding once a
-- valid display name exists, and keep updated_at server-controlled.

create or replace function public.prepare_profile_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.display_name is not null then
    new.display_name := btrim(new.display_name);

    if new.display_name = '' then
      raise exception 'Display name cannot be empty.';
    end if;
  end if;

  if new.major is not null then
    new.major := nullif(btrim(new.major), '');
  end if;

  if new.display_name is not null
     and new.onboarding_completed_at is null then
    new.onboarding_completed_at := now();
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;

  return new;
end;
$$;

revoke all on function public.prepare_profile_write() from public;
revoke all on function public.prepare_profile_write() from anon;
revoke all on function public.prepare_profile_write() from authenticated;

create trigger prepare_profile_write
before insert or update on public.profiles
for each row
execute function public.prepare_profile_write();


-- Replace the Task 5 owner-only read model with:
--   1. owner can always read own profile
--   2. authenticated users can read completed discoverable profiles

drop policy if exists "Users can read their own profile"
on public.profiles;

create policy "Users can read their own profile"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

create policy "Authenticated users can read discoverable profiles"
on public.profiles
for select
to authenticated
using (
  is_discoverable = true
  and onboarding_completed_at is not null
  and display_name is not null
);

create policy "Users can update their own profile"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);


-- Remove broad Task 5 privileges and grant only what the client needs.
-- last_active_at remains server-controlled and is deliberately not readable
-- through normal profile queries.

revoke all on table public.profiles from anon;
revoke all on table public.profiles from authenticated;

grant select on table public.profiles to authenticated;

grant update (
  display_name,
  major,
  year_of_study,
  campus_id,
  avatar_path,
  is_discoverable
)
on public.profiles
to authenticated;


-- =========================================================
-- Interests
-- =========================================================

create table public.interests (
  id uuid primary key default gen_random_uuid(),
  display_name text not null unique,
  slug text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),

  constraint interests_display_name_check
    check (
      char_length(display_name) between 1 and 60
      and display_name = btrim(display_name)
    ),

  constraint interests_slug_check
    check (
      char_length(slug) between 1 and 60
      and slug = lower(slug)
      and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    )
);

comment on table public.interests is
  'Reviewed interest catalog available for CampusClutch profiles.';

alter table public.interests enable row level security;

revoke all on table public.interests from anon;
revoke all on table public.interests from authenticated;

grant select on table public.interests to authenticated;

create policy "Authenticated users can read interests"
on public.interests
for select
to authenticated
using (true);


create table public.profile_interests (
  profile_id uuid not null
    references public.profiles (id) on delete cascade,

  interest_id uuid not null
    references public.interests (id) on delete restrict,

  created_at timestamptz not null default now(),

  primary key (profile_id, interest_id)
);

comment on table public.profile_interests is
  'Many-to-many relationship between CampusClutch profiles and interests.';

alter table public.profile_interests enable row level security;

revoke all on table public.profile_interests from anon;
revoke all on table public.profile_interests from authenticated;

grant select, insert, delete
on table public.profile_interests
to authenticated;

create policy "Users can read approved profile interests"
on public.profile_interests
for select
to authenticated
using (
  profile_id = (select auth.uid())
  or exists (
    select 1
    from public.profiles
    where profiles.id = profile_interests.profile_id
      and profiles.is_discoverable = true
      and profiles.onboarding_completed_at is not null
      and profiles.display_name is not null
  )
);

create policy "Users can add their own profile interests"
on public.profile_interests
for insert
to authenticated
with check (
  profile_id = (select auth.uid())
  and exists (
    select 1
    from public.interests
    where interests.id = profile_interests.interest_id
      and interests.is_active = true
  )
);

create policy "Users can remove their own profile interests"
on public.profile_interests
for delete
to authenticated
using (profile_id = (select auth.uid()));

create index profile_interests_interest_id_profile_id_idx
on public.profile_interests (interest_id, profile_id);


-- Initial reviewed interest catalog based on the interests already represented
-- by the current CampusClutch student-profile fixtures.

insert into public.interests (display_name, slug)
values
  ('Anime', 'anime'),
  ('Coding', 'coding'),
  ('Coffee', 'coffee'),
  ('Gym', 'gym'),
  ('Hiking', 'hiking'),
  ('Reading', 'reading'),
  ('Soccer', 'soccer'),
  ('Study Groups', 'study-groups'),
  ('UI Design', 'ui-design')
on conflict (slug) do update
set
  display_name = excluded.display_name,
  is_active = true;


-- =========================================================
-- Avatar Storage
-- =========================================================

-- 5 MiB maximum per avatar object.
-- JPEG, PNG, and WebP only.
-- The bucket remains private.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'avatars',
  'avatars',
  false,
  5242880,
  array[
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;


-- New objects must be stored under:
--
--   <authenticated-user-id>/<generated-file-name>
--
-- Example:
--
--   2c9.../2a55....webp

create policy "Users can upload avatars to their own folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);


-- Users may read:
--   - their own current avatar
--   - the current avatar of a completed discoverable profile
--
-- This keeps private Storage access aligned with profile visibility.

create policy "Authenticated users can read approved avatars"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'avatars'
  and exists (
    select 1
    from public.profiles
    where profiles.avatar_path = storage.objects.name
      and (
        profiles.id = (select auth.uid())
        or (
          profiles.is_discoverable = true
          and profiles.onboarding_completed_at is not null
          and profiles.display_name is not null
        )
      )
  )
);


-- Avatar replacement uses a new unique object rather than overwriting the
-- old object. Users may delete only files in their own user-scoped folder.

create policy "Users can delete avatars from their own folder"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and owner_id = (select auth.uid()::text)
);