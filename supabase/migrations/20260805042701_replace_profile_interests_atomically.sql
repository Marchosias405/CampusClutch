-- Task 6: Replace the signed-in user's profile interests atomically.
--
-- This prevents a partial update where existing interests are
-- deleted successfully but inserting the replacement set fails afterward.

create or replace function public.replace_my_profile_interests(
  p_interest_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_profile_id uuid := auth.uid();
begin
  if current_profile_id is null then
    raise exception 'Authentication is required.';
  end if;

  -- Reject unknown or inactive interests before changing anything.
  if exists (
    select 1
    from unnest(coalesce(p_interest_ids, '{}'::uuid[]))
      as selected(interest_id)
    left join public.interests
      on interests.id = selected.interest_id
    where interests.id is null
       or interests.is_active = false
  ) then
    raise exception 'One or more selected interests are invalid or inactive.';
  end if;

  delete from public.profile_interests
  where profile_id = current_profile_id;

  insert into public.profile_interests (
    profile_id,
    interest_id
  )
  select
    current_profile_id,
    selected.interest_id
  from (
    select distinct interest_id
    from unnest(coalesce(p_interest_ids, '{}'::uuid[]))
      as requested(interest_id)
  ) as selected;
end;
$$;

comment on function public.replace_my_profile_interests(uuid[]) is
  'Atomically replaces the authenticated user''s selected profile interests.';

revoke all
on function public.replace_my_profile_interests(uuid[])
from public;

revoke all
on function public.replace_my_profile_interests(uuid[])
from anon;

revoke all
on function public.replace_my_profile_interests(uuid[])
from authenticated;

grant execute
on function public.replace_my_profile_interests(uuid[])
to authenticated;