-- Task 6: Replace the signed-in user's social profile settings atomically.
--
-- Blank values remove that platform row.
-- If either supplied value is invalid, the entire transaction rolls back.

create or replace function public.replace_my_profile_social_links(
  p_linkedin_value text,
  p_linkedin_visible boolean,
  p_instagram_value text,
  p_instagram_visible boolean
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_profile_id uuid := auth.uid();
  normalized_linkedin text := nullif(btrim(p_linkedin_value), '');
  normalized_instagram text := nullif(btrim(p_instagram_value), '');
begin
  if current_profile_id is null then
    raise exception 'Authentication is required.';
  end if;

  -- LinkedIn
  if normalized_linkedin is null then
    delete from public.profile_social_links
    where profile_id = current_profile_id
      and platform = 'linkedin';
  else
    insert into public.profile_social_links (
      profile_id,
      platform,
      value,
      is_visible
    )
    values (
      current_profile_id,
      'linkedin',
      normalized_linkedin,
      coalesce(p_linkedin_visible, false)
    )
    on conflict (profile_id, platform)
    do update
    set
      value = excluded.value,
      is_visible = excluded.is_visible;
  end if;

  -- Instagram
  if normalized_instagram is null then
    delete from public.profile_social_links
    where profile_id = current_profile_id
      and platform = 'instagram';
  else
    insert into public.profile_social_links (
      profile_id,
      platform,
      value,
      is_visible
    )
    values (
      current_profile_id,
      'instagram',
      normalized_instagram,
      coalesce(p_instagram_visible, false)
    )
    on conflict (profile_id, platform)
    do update
    set
      value = excluded.value,
      is_visible = excluded.is_visible;
  end if;
end;
$$;

comment on function public.replace_my_profile_social_links(
  text,
  boolean,
  text,
  boolean
) is
  'Atomically replaces the authenticated user''s LinkedIn and Instagram profile settings.';

revoke all
on function public.replace_my_profile_social_links(
  text,
  boolean,
  text,
  boolean
)
from public;

revoke all
on function public.replace_my_profile_social_links(
  text,
  boolean,
  text,
  boolean
)
from anon;

revoke all
on function public.replace_my_profile_social_links(
  text,
  boolean,
  text,
  boolean
)
from authenticated;

grant execute
on function public.replace_my_profile_social_links(
  text,
  boolean,
  text,
  boolean
)
to authenticated;