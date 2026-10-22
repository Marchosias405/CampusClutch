-- Captured with Supabase db pull --local; scoped to reviewed DDL and explicit grants.
-- Request-scoped introductions before an offer/acceptance, and an exact badge total.
-- Existing profile discovery policies and immutable assignment chat links stay intact.
create function messaging_private.request_contact(p_request_id uuid, p_other_profile_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := messaging_private.require_actor(true);
  v_request public.requests;
  v_result jsonb;
begin
  if p_request_id is null or p_other_profile_id is null or p_other_profile_id = v_actor then
    raise exception 'Choose another request participant' using errcode = '22023';
  end if;
  select r.* into v_request from public.requests r where r.id = p_request_id;
  if not found then
    raise exception 'Request contact unavailable' using errcode = '42501';
  end if;
  if v_request.owner_id = v_actor then
    -- The poster can review every actual offer and original assignment counterpart.
    if not exists (select 1 from public.request_offers o where o.request_id = p_request_id
        and o.offering_user_id = p_other_profile_id)
      and not exists (select 1 from public.request_point_reservations pr
        where pr.request_id = p_request_id and pr.poster_id = v_actor and pr.helper_id = p_other_profile_id) then
      raise exception 'Request contact unavailable' using errcode = '42501';
    end if;
  elsif p_other_profile_id <> v_request.owner_id or not (
    -- Match requests_read: the live campus feed, accepted helper, or original assignment.
    (v_request.status = 'open' and v_request.deadline_at > statement_timestamp())
    or request_private.is_accepted_helper(p_request_id)
    or request_private.has_request_assignment(p_request_id)
  ) then
    raise exception 'Request contact unavailable' using errcode = '42501';
  end if;
  select jsonb_build_object('profile_id', p.id, 'display_name', p.display_name,
    'major', p.major, 'year_of_study', p.year_of_study, 'campus_display_name', c.display_name)
  into v_result from public.profiles p left join public.campuses c on c.id = p.campus_id
  where p.id = p_other_profile_id and p.onboarding_completed_at is not null and p.display_name is not null;
  if v_result is null then
    raise exception 'Request contact unavailable' using errcode = '42501';
  end if;
  return v_result;
end;
$$;
revoke all on function messaging_private.request_contact(uuid, uuid) from public, anon, authenticated;
grant execute on function messaging_private.request_contact(uuid, uuid) to authenticated;

create function messaging_private.start_request_contact(p_request_id uuid, p_other_profile_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform messaging_private.require_actor(true);
  -- Serialize with request cancellation/acceptance before authorizing a new introduction.
  perform 1 from public.requests r where r.id = p_request_id for share;
  perform messaging_private.request_contact(p_request_id, p_other_profile_id);
  return messaging_private.ensure_direct_pair(p_other_profile_id, false);
end;
$$;
revoke all on function messaging_private.start_request_contact(uuid, uuid) from public, anon, authenticated;
grant execute on function messaging_private.start_request_contact(uuid, uuid) to authenticated;

create function messaging_private.unread_total()
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := messaging_private.require_actor(); v_count bigint;
begin
  select count(*) into v_count from public.conversation_members member
  join public.conversations c on c.id = member.conversation_id and c.status <> 'removed'
  join public.messages msg on msg.conversation_id = member.conversation_id
    and msg.sequence > member.last_read_sequence and msg.sender_id <> v_actor
  where member.profile_id = v_actor;
  return v_count;
end;
$$;
revoke all on function messaging_private.unread_total() from public, anon, authenticated;
grant execute on function messaging_private.unread_total() to authenticated;

create function public.get_request_contact(p_request_id uuid, p_other_profile_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select messaging_private.request_contact(p_request_id, p_other_profile_id);
$$;
create function public.start_request_contact_conversation(p_request_id uuid, p_other_profile_id uuid)
returns uuid language sql security invoker set search_path = '' as $$
  select messaging_private.start_request_contact(p_request_id, p_other_profile_id);
$$;
create function public.get_my_unread_message_count()
returns bigint language sql stable security invoker set search_path = '' as $$
  select messaging_private.unread_total();
$$;
revoke all on function public.get_request_contact(uuid, uuid),
  public.start_request_contact_conversation(uuid, uuid), public.get_my_unread_message_count()
  from public, anon, authenticated;
grant execute on function public.get_request_contact(uuid, uuid),
  public.start_request_contact_conversation(uuid, uuid), public.get_my_unread_message_count()
  to authenticated;
