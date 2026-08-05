-- Task 6: Add privacy-aware social links for user profiles.

create table public.profile_social_links (
  profile_id uuid not null
    references public.profiles (id) on delete cascade,

  platform text not null,
  value text not null,
  is_visible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (profile_id, platform),

  constraint profile_social_links_platform_check
    check (
      platform in ('linkedin', 'instagram')
    ),

  constraint profile_social_links_value_check
    check (
      char_length(value) between 1 and 255
      and value = btrim(value)
    ),

  constraint profile_social_links_instagram_check
    check (
      platform <> 'instagram'
      or (
        char_length(value) between 1 and 30
        and value ~ '^[A-Za-z0-9._]+$'
      )
    ),

  constraint profile_social_links_linkedin_check
    check (
      platform <> 'linkedin'
      or value ~* '^https://([a-z0-9-]+\.)?linkedin\.com/in/[^[:space:]]+$'
    )
);

comment on table public.profile_social_links is
  'Optional privacy-controlled social profile links for CampusClutch users.';


-- Normalize values and keep timestamps server-controlled.

create or replace function public.prepare_profile_social_link_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.value := btrim(new.value);

  if new.value = '' then
    raise exception 'Social profile value cannot be empty.';
  end if;

  if tg_op = 'INSERT' then
    new.created_at := now();
  end if;

  new.updated_at := now();

  return new;
end;
$$;

revoke all
on function public.prepare_profile_social_link_write()
from public;

revoke all
on function public.prepare_profile_social_link_write()
from anon;

revoke all
on function public.prepare_profile_social_link_write()
from authenticated;

create trigger prepare_profile_social_link_write
before insert or update
on public.profile_social_links
for each row
execute function public.prepare_profile_social_link_write();


-- =========================================================
-- RLS
-- =========================================================

alter table public.profile_social_links enable row level security;

revoke all
on table public.profile_social_links
from anon;

revoke all
on table public.profile_social_links
from authenticated;


-- Owners may always read their own social settings.

create policy "Users can read their own social links"
on public.profile_social_links
for select
to authenticated
using (
  profile_id = (select auth.uid())
);


-- Other authenticated users may read only explicitly visible links
-- belonging to completed discoverable profiles.

create policy "Authenticated users can read visible social links"
on public.profile_social_links
for select
to authenticated
using (
  is_visible = true
  and exists (
    select 1
    from public.profiles
    where profiles.id = profile_social_links.profile_id
      and profiles.is_discoverable = true
      and profiles.onboarding_completed_at is not null
      and profiles.display_name is not null
  )
);


-- Users may create only links belonging to their own profile.

create policy "Users can add their own social links"
on public.profile_social_links
for insert
to authenticated
with check (
  profile_id = (select auth.uid())
);


-- Users may update only their own social links.

create policy "Users can update their own social links"
on public.profile_social_links
for update
to authenticated
using (
  profile_id = (select auth.uid())
)
with check (
  profile_id = (select auth.uid())
);


-- Users may remove only their own social links.

create policy "Users can remove their own social links"
on public.profile_social_links
for delete
to authenticated
using (
  profile_id = (select auth.uid())
);


-- Client privileges.
-- profile_id/platform identify the row and cannot be changed after creation.
-- created_at/updated_at remain server-controlled.

grant select, insert, delete
on table public.profile_social_links
to authenticated;

grant update (
  value,
  is_visible
)
on table public.profile_social_links
to authenticated;