-- Task 14: directional private blocks; both directions stop new contact.
-- Existing conversation history, read receipts, assignments, points and ratings
-- remain intact. A block never cancels work or changes anyone's balance.
-- False rows are retained as revision tombstones, so delayed retries cannot
-- accidentally re-block a student after a later unblock.
create table safety_private.student_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  is_blocked boolean not null,
  revision bigint not null check (revision > 0),
  blocked_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id),
  check ((is_blocked and blocked_at is not null) or (not is_blocked and blocked_at is null))
);
create index student_blocks_target_idx on safety_private.student_blocks(blocked_id, blocker_id);
create index student_blocks_list_idx on safety_private.student_blocks(blocker_id, blocked_at desc, blocked_id)
  where is_blocked;
alter table safety_private.student_blocks enable row level security;
revoke all on safety_private.student_blocks from public, anon, authenticated, service_role;
comment on table safety_private.student_blocks is
  'Private directional block choices with persistent revision tombstones. No client table access; deleted profiles cascade their choices.';

create function safety_private.require_actor() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare actor uuid := auth.uid();
begin
  if actor is null or not exists (
    select 1 from public.profiles p join auth.users u on u.id=p.id
    where p.id=actor and p.onboarding_completed_at is not null
      and nullif(btrim(p.display_name),'') is not null and u.deleted_at is null
      and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<=now())
  ) then raise exception 'An eligible signed-in student profile is required' using errcode='42501'; end if;
  return actor;
end $$;

-- This key is also used by the existing direct-conversation creation path.
-- Every new DM takes it BEFORE the conversation lock; offers take their parent
-- request lock first. Block changes never lock requests/conversations/wallets.
create function safety_private.lock_pair(p_first uuid,p_second uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_first is null or p_second is null or p_first=p_second then
    raise exception 'Choose another student' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'campusclutch:direct:'||least(p_first,p_second)::text||':'||greatest(p_first,p_second)::text,0));
end $$;

create function safety_private.pair_blocked(p_first uuid,p_second uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from safety_private.student_blocks b where b.is_blocked
    and ((b.blocker_id=p_first and b.blocked_id=p_second)
      or (b.blocker_id=p_second and b.blocked_id=p_first)));
$$;
-- This is the only block predicate exposed to RLS callers; the caller's own
-- identity is fixed, preventing arbitrary third-party relationship queries.
create function safety_private.student_blocked(p_profile_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and safety_private.pair_blocked(auth.uid(),p_profile_id);
$$;

create function safety_private.assignment_pair(p_request_id uuid,p_first uuid,p_second uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.request_point_reservations r
    where r.request_id=p_request_id and
      ((r.poster_id=p_first and r.helper_id=p_second) or (r.poster_id=p_second and r.helper_id=p_first)));
$$;
create function safety_private.prior_contact(p_actor uuid,p_peer uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.direct_conversation_pairs p
    where p.user_low_id=least(p_actor,p_peer) and p.user_high_id=greatest(p_actor,p_peer))
  or exists(select 1 from public.request_offers o join public.requests r on r.id=o.request_id
    where (r.owner_id=p_actor and o.offering_user_id=p_peer)
      or (r.owner_id=p_peer and o.offering_user_id=p_actor))
  or exists(select 1 from public.request_point_reservations r
    where (r.poster_id=p_actor and r.helper_id=p_peer) or (r.poster_id=p_peer and r.helper_id=p_actor));
$$;
create function safety_private.block_target_available(p_actor uuid,p_peer uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select p_peer<>p_actor and exists(select 1 from public.profiles p join auth.users u on u.id=p.id
    where p.id=p_peer and p.onboarding_completed_at is not null
      and nullif(btrim(p.display_name),'') is not null and u.deleted_at is null
      and not coalesce(u.is_anonymous,false)
      and (p.is_discoverable or safety_private.prior_contact(p_actor,p_peer)))
  or exists(select 1 from safety_private.student_blocks b where b.blocker_id=p_actor and b.blocked_id=p_peer);
$$;
create function safety_private.block_state(p_profile_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=safety_private.require_actor(); own_state safety_private.student_blocks;
begin
  if p_profile_id is null or p_profile_id=actor then
    raise exception 'Choose another student' using errcode='22023'; end if;
  if not safety_private.block_target_available(actor,p_profile_id) then
    raise exception 'Student unavailable' using errcode='42501'; end if;
  select * into own_state from safety_private.student_blocks where blocker_id=actor and blocked_id=p_profile_id;
  return jsonb_build_object('profile_id',p_profile_id,'blocked_by_me',coalesce(own_state.is_blocked,false),
    'interaction_blocked',safety_private.pair_blocked(actor,p_profile_id),'revision',coalesce(own_state.revision,0)::text);
end $$;

create function safety_private.set_block(p_profile_id uuid,p_blocked boolean,p_expected_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=safety_private.require_actor(); own_state safety_private.student_blocks;
  current_revision bigint; current_blocked boolean; chat uuid; peer uuid;
begin
  if p_profile_id is null or p_profile_id=actor or p_blocked is null
    or p_expected_revision is null or p_expected_revision<0 then
    raise exception 'Invalid block change' using errcode='22023'; end if;
  perform safety_private.lock_pair(actor,p_profile_id);
  -- A fresh statement after the lock sees any previously committed transition.
  perform safety_private.require_actor();
  if not safety_private.block_target_available(actor,p_profile_id) then
    raise exception 'Student unavailable' using errcode='42501'; end if;
  select * into own_state from safety_private.student_blocks where blocker_id=actor and blocked_id=p_profile_id;
  current_revision:=coalesce(own_state.revision,0);
  current_blocked:=coalesce(own_state.is_blocked,false);
  if current_revision<>p_expected_revision then
    if current_revision>0 and current_revision-1=p_expected_revision
      and current_blocked=p_blocked then return safety_private.block_state(p_profile_id); end if;
    -- This is an application conflict, not PostgreSQL serialization failure.
    -- PT409 avoids PostgREST transparently retrying a permanently stale intent.
    raise exception 'Block settings changed. Refresh and try again.' using errcode='PT409';
  end if;
  if current_blocked=p_blocked then return safety_private.block_state(p_profile_id); end if;
  if current_revision=9223372036854775807 then
    raise exception 'Block settings cannot be updated' using errcode='54000'; end if;
  insert into safety_private.student_blocks(blocker_id,blocked_id,is_blocked,revision,blocked_at)
    values(actor,p_profile_id,p_blocked,current_revision+1,case when p_blocked then clock_timestamp() end)
  on conflict(blocker_id,blocked_id) do update set is_blocked=excluded.is_blocked,
    revision=excluded.revision,blocked_at=excluded.blocked_at,updated_at=clock_timestamp();
  -- Payload reveals no block choice or direction. Clients refetch their own
  -- authorized summary, including an already-open conversation.
  select conversation_id into chat from public.direct_conversation_pairs
    where user_low_id=least(actor,p_profile_id) and user_high_id=greatest(actor,p_profile_id);
  if chat is not null then
    foreach peer in array array[actor,p_profile_id] loop
      perform realtime.send(jsonb_build_object('conversation_id',chat),
        'messages_changed','messages:'||peer::text,true);
    end loop;
  end if;
  return safety_private.block_state(p_profile_id);
end $$;

create function safety_private.blocked_students(p_limit integer,p_offset integer)
returns table(profile_id uuid,display_name text,blocked_at timestamptz,revision text)
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=safety_private.require_actor();
begin
  if p_limit is null or p_limit<1 or p_limit>50 or p_offset is null or p_offset<0 or p_offset>10000 then
    raise exception 'Invalid blocked students page' using errcode='22023'; end if;
  return query select b.blocked_id,coalesce(nullif(btrim(p.display_name),''),'Student'),b.blocked_at,b.revision::text
    from safety_private.student_blocks b join public.profiles p on p.id=b.blocked_id
    where b.blocker_id=actor and b.is_blocked order by b.blocked_at desc,b.blocked_id
    limit p_limit offset p_offset;
end $$;

create function public.get_student_block_state(p_profile_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select safety_private.block_state(p_profile_id) $$;
create function public.set_student_block(p_profile_id uuid,p_blocked boolean,p_expected_revision bigint) returns jsonb
language sql security invoker set search_path='' as $$ select safety_private.set_block(p_profile_id,p_blocked,p_expected_revision) $$;
create function public.get_my_blocked_students(p_limit integer default 20,p_offset integer default 0)
returns table(profile_id uuid,display_name text,blocked_at timestamptz,revision text)
language sql stable security invoker set search_path='' as $$ select * from safety_private.blocked_students(p_limit,p_offset) $$;

-- Fail closed for new contact. The volatile function's SELECT after waiting
-- uses a fresh snapshot, so concurrent block/send/accept transactions serialize.
create function safety_private.require_unblocked_peer(p_peer uuid) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=safety_private.require_actor();
begin
  perform safety_private.lock_pair(actor,p_peer);
  if safety_private.pair_blocked(actor,p_peer) or not exists (
    select 1 from public.profiles p join auth.users u on u.id=p.id
    where p.id=p_peer and p.onboarding_completed_at is not null and nullif(btrim(p.display_name),'') is not null
      and u.deleted_at is null and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<=now())
  ) then raise exception 'Interaction unavailable' using errcode='42501'; end if;
end $$;

-- Existing permissive policies still determine whether a row is otherwise
-- accessible; these restrictive policies cannot accidentally grant access.
create policy profiles_block_visibility on public.profiles as restrictive for select to authenticated
using (id=(select auth.uid()) or not safety_private.student_blocked(id));
create policy requests_block_visibility on public.requests as restrictive for select to authenticated
using (owner_id=(select auth.uid()) or not safety_private.student_blocked(owner_id)
  or request_private.has_request_assignment(id) or request_private.is_accepted_helper(id));


CREATE OR REPLACE FUNCTION messaging_private.require_actor(p_completed boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not exists (
    select 1 from public.profiles p join auth.users u on u.id=p.id where p.id = v_user
      and u.deleted_at is null and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<=now())
      and (not p_completed or (p.onboarding_completed_at is not null and p.display_name is not null))
  ) then
    raise exception 'An eligible signed-in profile is required' using errcode = '42501';
  end if;
  return v_user;
end;
$function$;


CREATE OR REPLACE FUNCTION messaging_private.ensure_direct_pair(p_other_profile_id uuid, p_require_discoverable boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := messaging_private.require_actor(true);
  v_low uuid; v_high uuid; v_conversation_id uuid; v_status text;
begin
  if p_other_profile_id is null or p_other_profile_id = v_user then
    raise exception 'Choose another profile' using errcode = '22023';
  end if;
  perform safety_private.require_unblocked_peer(p_other_profile_id);
  v_low := least(v_user, p_other_profile_id);
  v_high := greatest(v_user, p_other_profile_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'campusclutch:direct:' || v_low::text || ':' || v_high::text, 0));

  select d.conversation_id into v_conversation_id
  from public.direct_conversation_pairs d
  where d.user_low_id = v_low and d.user_high_id = v_high;
  if found then
    select c.status into v_status from public.conversations c
    where c.id = v_conversation_id for update;
    if v_status = 'removed' or not messaging_private.can_read_conversation(v_conversation_id) then
      raise exception 'Conversation unavailable' using errcode = '42501';
    end if;
    return v_conversation_id;
  end if;

  -- SHARE prevents a concurrent privacy change from racing initial eligibility.
  perform 1 from public.profiles p where p.id = p_other_profile_id
    and p.onboarding_completed_at is not null and p.display_name is not null
    and (not p_require_discoverable or p.is_discoverable) for share;
  if not found then
    raise exception 'Profile unavailable for a new conversation' using errcode = '42501';
  end if;
  insert into public.conversations(created_by) values (v_user) returning id into v_conversation_id;
  insert into public.conversation_members(conversation_id, profile_id)
    values (v_conversation_id, v_low), (v_conversation_id, v_high);
  insert into public.direct_conversation_pairs(conversation_id, user_low_id, user_high_id)
    values (v_conversation_id, v_low, v_high);
  return v_conversation_id;
end;
$function$;


CREATE OR REPLACE FUNCTION messaging_private.send_message(p_conversation_id uuid, p_client_message_id uuid, p_body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := messaging_private.require_actor();
  v_conversation public.conversations;
  v_member public.conversation_members;
  v_message public.messages;
  v_body text;
  v_now timestamptz;
  v_peer uuid;
begin
  v_body := regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if p_conversation_id is null or p_client_message_id is null or v_body is null
    or char_length(v_body) < 1 or char_length(v_body) > 4000 then
    raise exception 'A message must contain 1 to 4000 characters' using errcode = '22023';
  end if;
  -- Pair before conversation: the same order used by direct creation.
  select case when d.user_low_id=v_user then d.user_high_id else d.user_low_id end into v_peer
  from public.direct_conversation_pairs d where d.conversation_id=p_conversation_id
    and v_user in (d.user_low_id,d.user_high_id);
  if v_peer is not null then perform safety_private.lock_pair(v_user,v_peer); end if;
  select c.* into v_conversation from public.conversations c
  where c.id = p_conversation_id and c.status <> 'removed'
    and exists (select 1 from public.conversation_members member
      where member.conversation_id = c.id and member.profile_id = v_user)
  for update;
  if not found or not messaging_private.can_read_conversation(p_conversation_id) then
    raise exception 'Conversation unavailable' using errcode = '42501';
  end if;

  -- Resolve an exact earlier send even if the member has since left or was removed.
  select message.* into v_message from public.messages message
  where message.sender_id = v_user and message.client_message_id = p_client_message_id;
  if found then
    if v_message.conversation_id <> p_conversation_id or v_message.body <> v_body then
      raise exception 'Message retry does not match its original content' using errcode = '22023';
    end if;
    return messaging_private.message_json(v_message);
  end if;

  -- Resolve an exact committed retry above before rejecting new contact.
  perform safety_private.require_unblocked_peer(v_peer);

  select member.* into v_member from public.conversation_members member
  where member.conversation_id = p_conversation_id and member.profile_id = v_user;
  if v_conversation.status <> 'active' then
    raise exception 'This conversation is closed to new messages' using errcode = '55000';
  end if;
  if v_member.membership_status <> 'active' or not exists (
    select 1 from public.group_membership_periods period
    where period.conversation_id = p_conversation_id and period.profile_id = v_user
      and period.ends_at_sequence is null
  ) then
    raise exception 'Active conversation membership is required' using errcode = '55000';
  end if;

  v_now := clock_timestamp();
  insert into public.messages(
    conversation_id, sender_id, client_message_id, sequence, body, created_at
  ) values (
    p_conversation_id, v_user, p_client_message_id,
    v_conversation.last_message_sequence + 1, v_body, v_now
  ) on conflict (sender_id, client_message_id) do nothing returning * into v_message;
  if not found then
    select message.* into v_message from public.messages message
    where message.sender_id = v_user and message.client_message_id = p_client_message_id;
    if not found or v_message.conversation_id <> p_conversation_id or v_message.body <> v_body then
      raise exception 'Message retry does not match its original content' using errcode = '22023';
    end if;
    return messaging_private.message_json(v_message);
  end if;
  update public.conversations c
    set last_message_sequence = v_message.sequence,
      last_message_at = v_now,
      updated_at = v_now
    where c.id = p_conversation_id;
  return messaging_private.message_json(v_message);
end;
$function$;


CREATE OR REPLACE FUNCTION messaging_private.summary(p_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := messaging_private.require_actor(); v_result jsonb;
begin
  if p_conversation_id is null then
    raise exception 'Invalid conversation' using errcode = '22023';
  end if;
  if not messaging_private.can_read_conversation(p_conversation_id) then
    raise exception 'Conversation unavailable' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'id', c.id,
    'type', c.type,
    'status', c.status,
    'other_profile_id', counterpart.id,
    'other_display_name', counterpart.display_name,
    'interaction_blocked', safety_private.pair_blocked(v_user,counterpart.id),
    'blocked_by_me', exists(select 1 from safety_private.student_blocks b
      where b.blocker_id=v_user and b.blocked_id=counterpart.id and b.is_blocked),
    'last_message_body', latest.body,
    'last_message_at', case when c.type = 'direct' then c.last_message_at else latest.created_at end,
    'last_activity_at', case when c.type = 'direct'
      then coalesce(c.last_message_at, c.created_at)
      else greatest(coalesce(latest.created_at, member.joined_at), member.joined_at) end,
    'last_message_sequence', case when c.type = 'direct'
      then c.last_message_sequence else coalesce(latest.sequence, 0) end::text,
    'last_read_sequence', member.last_read_sequence::text,
    'unread_count', (
      select count(*)::integer
      from public.messages unread
      where unread.conversation_id = c.id
        and unread.sequence > member.last_read_sequence
        and unread.sender_id <> v_user
        and exists (
          select 1 from public.group_membership_periods visible_period
          where visible_period.conversation_id = unread.conversation_id
            and visible_period.profile_id = v_user
            and unread.sequence > visible_period.starts_after_sequence
            and (visible_period.ends_at_sequence is null
              or unread.sequence <= visible_period.ends_at_sequence)
        )
    ),
    'created_at', c.created_at
  ) || case when c.type = 'group' then jsonb_build_object(
    'group_title', case when member.membership_status = 'active' then g.title
      else (select period.visible_group_title
        from public.group_membership_periods period
        where period.conversation_id = c.id and period.profile_id = v_user
        order by period.period_number desc limit 1) end,
    'group_course_id', g.course_id,
    'group_course_code', course.code,
    'management_revision', case when member.membership_status = 'active'
      then g.management_revision::text else '0' end,
    'active_member_count', case when member.membership_status = 'active'
      then (select count(*)::integer from public.conversation_members active_member
        where active_member.conversation_id = c.id
          and active_member.membership_status = 'active') else 0 end,
    'my_role', member.role,
    'my_membership_status', member.membership_status,
    'my_membership_period', (select max(period.period_number)
      from public.group_membership_periods period
      where period.conversation_id = c.id and period.profile_id = v_user),
    'can_send', c.status = 'active' and member.membership_status = 'active'
      and exists (select 1 from public.group_membership_periods open_period
        where open_period.conversation_id = c.id and open_period.profile_id = v_user
          and open_period.ends_at_sequence is null)
  ) else '{}'::jsonb end
  into v_result
  from public.conversations c
  join public.conversation_members member
    on member.conversation_id = c.id and member.profile_id = v_user
  left join public.direct_conversation_pairs pair on pair.conversation_id = c.id
  left join public.profiles counterpart on counterpart.id = case
    when pair.user_low_id = v_user then pair.user_high_id else pair.user_low_id end
  left join public.group_conversations g on g.conversation_id = c.id
  left join public.courses course on course.id = g.course_id
  left join lateral (
    select message.* from public.messages message
    where message.conversation_id = c.id
      and exists (
        select 1 from public.group_membership_periods visible_period
        where visible_period.conversation_id = message.conversation_id
          and visible_period.profile_id = v_user
          and message.sequence > visible_period.starts_after_sequence
          and (visible_period.ends_at_sequence is null
            or message.sequence <= visible_period.ends_at_sequence)
      )
    order by message.sequence desc limit 1
  ) latest on true
  where c.id = p_conversation_id and c.status <> 'removed';
  if v_result is null then
    raise exception 'Conversation unavailable' using errcode = '42501';
  end if;
  return v_result;
end;
$function$;


CREATE OR REPLACE FUNCTION request_private.create_offer(p_request_id uuid, p_message text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid:=auth.uid(); v_request public.requests; v_id uuid;
begin
 if v_user is null or not exists(select 1 from public.profiles where id=v_user and onboarding_completed_at is not null) then
   raise exception 'Complete your profile first' using errcode='42501'; end if;
 select * into v_request from public.requests where id=p_request_id for update;
 if not found or v_request.owner_id=v_user then raise exception 'Request unavailable for offering' using errcode='42501'; end if;
 perform safety_private.require_unblocked_peer(v_request.owner_id);
 select id into v_id from public.request_offers where request_id=p_request_id and offering_user_id=v_user;
 if found then return v_id; end if;
 if v_request.status<>'open' or v_request.deadline_at<=clock_timestamp() then
   raise exception 'Request is no longer open' using errcode='22023'; end if;
 insert into public.request_offers(request_id,offering_user_id,message,offer_round)
 values(p_request_id,v_user,nullif(btrim(p_message),''),v_request.offer_round) returning id into v_id;
 return v_id;
end $function$;


CREATE OR REPLACE FUNCTION request_private.renew_offer(p_offer_id uuid, p_expected_round integer, p_message text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid:=auth.uid(); v_id uuid; v_request public.requests; v_offer public.request_offers;
begin
 if v_user is null or not exists(select 1 from public.profiles where id=v_user and onboarding_completed_at is not null) then
   raise exception 'Complete your profile first' using errcode='42501'; end if;
 select request_id into v_id from public.request_offers where id=p_offer_id and offering_user_id=v_user;
 if not found then raise exception 'Offer unavailable' using errcode='42501'; end if;
 select * into v_request from public.requests where id=v_id for update;
 select * into v_offer from public.request_offers where id=p_offer_id for update;
 if p_expected_round is null or p_expected_round<>v_request.offer_round then
   raise exception 'Request has changed; refresh before offering again' using errcode='22023'; end if;
 perform safety_private.require_unblocked_peer(v_request.owner_id);
 if v_offer.offer_round=v_request.offer_round then return p_offer_id; end if;
 if v_request.status<>'open' or v_request.deadline_at<=clock_timestamp() or v_offer.status not in ('rejected','withdrawn') then
   raise exception 'Request is not accepting a new offer' using errcode='22023'; end if;
 update public.request_offers set offer_round=v_request.offer_round,status='pending',message=nullif(btrim(p_message),''),
 decided_at=null,withdrawn_at=null,updated_at=clock_timestamp() where id=p_offer_id;
 return p_offer_id;
end $function$;


CREATE OR REPLACE FUNCTION request_private.decide_offer_core(p_offer_id uuid, p_action text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid:=auth.uid(); v_request_id uuid; v_request public.requests; v_offer public.request_offers;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_action is null or p_action not in ('accepted','rejected','withdrawn') then
   raise exception 'Invalid offer action' using errcode='22023'; end if;
 select request_id into v_request_id from public.request_offers where id=p_offer_id;
 -- Every mutation locks parent first, then reads offer state after waiting.
 select * into v_request from public.requests where id=v_request_id for update;
 select * into v_offer from public.request_offers where id=p_offer_id for update;
 if not found or (p_action='withdrawn' and v_offer.offering_user_id<>v_user)
   or (p_action<>'withdrawn' and v_request.owner_id<>v_user) then
   raise exception 'Offer unavailable' using errcode='42501'; end if;
 -- A repeated acceptance must not reserve twice or charge historical acceptance.
 if v_offer.status=p_action then return p_offer_id; end if;
 if v_offer.status<>'pending' or v_request.status<>'open' or v_request.deadline_at<=clock_timestamp() then
   raise exception 'Offer is no longer pending on an open request' using errcode='22023'; end if;
 if p_action='accepted' then
   perform safety_private.require_unblocked_peer(v_offer.offering_user_id);
   if not exists(select 1 from public.profiles where id=v_offer.offering_user_id and onboarding_completed_at is not null) then
     raise exception 'Helper is not eligible' using errcode='22023'; end if;
   -- UPDATE rechecks available balance after waiting on another request's wallet
   -- lock, preventing two simultaneous acceptances from spending the same points.
   update public.points_wallets set reserved=reserved+v_request.points,updated_at=clock_timestamp()
   where profile_id=v_request.owner_id and balance-reserved>=v_request.points;
   if not found then raise exception 'Not enough available points to accept this helper' using errcode='P0002'; end if;
   insert into public.request_point_reservations(request_id,offer_round,poster_id,helper_id,amount)
   values(v_request.id,v_request.offer_round,v_request.owner_id,v_offer.offering_user_id,v_request.points);
   update public.requests set status='accepted',accepted_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_request.id;
 end if;
 update public.request_offers set status=p_action,updated_at=clock_timestamp(),
 decided_at=case when p_action<>'withdrawn' then clock_timestamp() end,
 withdrawn_at=case when p_action='withdrawn' then clock_timestamp() end where id=p_offer_id;
 if p_action='accepted' then
   update public.request_offers set status='rejected',updated_at=clock_timestamp(),decided_at=clock_timestamp()
   where request_id=v_request.id and status='pending';
 end if;
 return p_offer_id;
end $function$;


CREATE OR REPLACE FUNCTION messaging_private.request_contact(p_request_id uuid, p_other_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if safety_private.pair_blocked(v_actor,p_other_profile_id)
    and not safety_private.assignment_pair(p_request_id,v_actor,p_other_profile_id) then
    raise exception 'Request contact unavailable' using errcode='42501';
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
$function$;


CREATE OR REPLACE FUNCTION request_private.profile_rating_summary(p_profile_id uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_result jsonb;
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  -- Private profiles remain private. An explicit request grants only the same
  -- helper/poster relationship already available through authorized offers.
  -- No private-profile enumeration is enabled by knowing a profile UUID.
  select jsonb_build_object(
    'profile_id', p.id,
    'average_score', scores.average_score,
    'rating_count', scores.rating_count
  ) into v_result
  from public.profiles p
  cross join lateral (
    select round(avg(rr.score), 2) as average_score, count(*) as rating_count
    from public.request_ratings rr
    where rr.ratee_id = p.id and rr.published_at is not null
  ) scores
  where p.id = p_profile_id
    and (not safety_private.pair_blocked(v_user,p.id)
      or safety_private.assignment_pair(p_request_id,v_user,p.id)) and (
    p.id = v_user
    or (p.is_discoverable and p.onboarding_completed_at is not null and p.display_name is not null)
    or exists (
      select 1 from public.requests r
      join public.request_offers o on o.request_id = r.id
      where r.id = p_request_id and (
        (r.owner_id = v_user and o.offering_user_id = p.id)
        or (o.offering_user_id = v_user and r.owner_id = p.id)
      )
    )
  );
  if v_result is null then
    raise exception 'Profile rating unavailable' using errcode = '42501';
  end if;
  return v_result;
end $function$;


CREATE OR REPLACE FUNCTION public.get_course_classmates(p_course_id uuid)
 RETURNS TABLE(profile_id uuid, display_name text, major text, year_of_study smallint, campus_id uuid, campus_display_name text, avatar_path text, shared_interests text[], shared_interest_count integer, same_campus boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    and not safety_private.pair_blocked(current_profile_id,profiles.id)
    and profiles.is_discoverable = true
    and profiles.onboarding_completed_at is not null
    and profiles.display_name is not null

  order by
    coalesce(shared.shared_interest_count, 0) desc,
    lower(profiles.display_name),
    profiles.id;
end;
$function$;


create function safety_private.offer_visible(p_request_id uuid,p_helper uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.requests r where r.id=p_request_id
    and ((r.owner_id=auth.uid() or p_helper=auth.uid()) and
      (not safety_private.pair_blocked(r.owner_id,p_helper)
        or safety_private.assignment_pair(r.id,r.owner_id,p_helper))));
$$;
create policy request_offers_block_visibility on public.request_offers as restrictive for select to authenticated
using (safety_private.offer_visible(request_id,offering_user_id));


CREATE OR REPLACE FUNCTION request_private.offer_page(p_request_id uuid, p_limit integer, p_offset integer)
 RETURNS TABLE(id uuid, request_id uuid, offering_user_id uuid, status text, message text, created_at timestamp with time zone, request_title text, request_status text, request_deadline_at timestamp with time zone, helper_display_name text, helper_major text, helper_year smallint, helper_campus text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid:=auth.uid(); v_ids uuid[]; v_request public.requests;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_limit is null or p_limit<1 or p_limit>50 or p_offset is null or p_offset<0 then
   raise exception 'Invalid offer page' using errcode='22023'; end if;
 select array_agg(page.id) into v_ids from (
   select o.id from public.request_offers o join public.requests r on r.id=o.request_id
   where ((p_request_id is null and o.offering_user_id=v_user)
      or (r.id=p_request_id and (r.owner_id=v_user or o.offering_user_id=v_user)))
      and safety_private.offer_visible(o.request_id,o.offering_user_id)
   order by o.created_at desc,o.id desc limit p_limit offset p_offset
 ) page;
 -- Lock parents in a stable order. Only authorized requests in this page (or an
 -- explicitly requested owned request without offers) can be settled by a read.
 for v_request in select r.* from public.requests r
   where r.status='open' and r.deadline_at<=clock_timestamp()
   and ((r.id=p_request_id and r.owner_id=v_user) or exists (
     select 1 from public.request_offers o where o.id=any(v_ids) and o.request_id=r.id))
   order by r.id for update
 loop
   update public.requests set status='expired',updated_at=clock_timestamp() where public.requests.id=v_request.id;
 end loop;
 return query select o.id,o.request_id,o.offering_user_id,o.status,o.message,o.created_at,
   r.title,r.status,r.deadline_at,p.display_name,p.major,p.year_of_study,c.display_name
 from public.request_offers o join public.requests r on r.id=o.request_id
 join public.profiles p on p.id=o.offering_user_id left join public.campuses c on c.id=p.campus_id
 where o.id=any(v_ids) and safety_private.offer_visible(o.request_id,o.offering_user_id) order by o.created_at desc,o.id desc;
end $function$;


CREATE OR REPLACE FUNCTION request_private.offer_page_v2(p_request_id uuid, p_limit integer, p_offset integer)
 RETURNS TABLE(id uuid, request_id uuid, offering_user_id uuid, status text, message text, created_at timestamp with time zone, request_title text, request_status text, request_deadline_at timestamp with time zone, helper_display_name text, helper_major text, helper_year smallint, helper_campus text, offer_round integer, request_offer_round integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid:=auth.uid(); v_ids uuid[]; v_request public.requests;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_limit is null or p_limit<1 or p_limit>50 or p_offset is null or p_offset<0 then
   raise exception 'Invalid offer page' using errcode='22023'; end if;
 select array_agg(page.id) into v_ids from (
   select o.id from public.request_offers o join public.requests r on r.id=o.request_id
   where ((p_request_id is null and o.offering_user_id=v_user)
      or (r.id=p_request_id and (r.owner_id=v_user or o.offering_user_id=v_user)))
      and safety_private.offer_visible(o.request_id,o.offering_user_id)
   order by o.created_at desc,o.id desc limit p_limit offset p_offset
 ) page;
 -- Preserve the original authorized, parent-first expiration settlement.
 for v_request in select r.* from public.requests r
   where r.status='open' and r.deadline_at<=clock_timestamp()
   and ((r.id=p_request_id and r.owner_id=v_user) or exists (
     select 1 from public.request_offers o where o.id=any(v_ids) and o.request_id=r.id))
   order by r.id for update
 loop
   update public.requests set status='expired',updated_at=clock_timestamp() where public.requests.id=v_request.id;
 end loop;
 -- Project state and rounds in one final query. Joining rounds outside a
 -- volatile page function could mix its newer state with an older outer snapshot.
 return query select o.id,o.request_id,o.offering_user_id,o.status,o.message,o.created_at,
   r.title,r.status,r.deadline_at,p.display_name,p.major,p.year_of_study,c.display_name,
   o.offer_round,r.offer_round
 from public.request_offers o join public.requests r on r.id=o.request_id
 join public.profiles p on p.id=o.offering_user_id left join public.campuses c on c.id=p.campus_id
 where o.id=any(v_ids) and safety_private.offer_visible(o.request_id,o.offering_user_id) order by o.created_at desc,o.id desc;
end $function$;


CREATE OR REPLACE FUNCTION request_private.offer_page_v3(p_request_id uuid, p_limit integer, p_offset integer)
 RETURNS TABLE(id uuid, request_id uuid, offering_user_id uuid, status text, message text, created_at timestamp with time zone, request_title text, request_status text, request_deadline_at timestamp with time zone, helper_display_name text, helper_major text, helper_year smallint, helper_campus text, offer_round integer, request_offer_round integer, request_points integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid:=auth.uid(); v_ids uuid[]; v_request public.requests;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_limit is null or p_limit<1 or p_limit>50 or p_offset is null or p_offset<0 then
   raise exception 'Invalid offer page' using errcode='22023'; end if;
 select array_agg(page.id) into v_ids from (
   select o.id from public.request_offers o join public.requests r on r.id=o.request_id
   where ((p_request_id is null and o.offering_user_id=v_user)
      or (r.id=p_request_id and (r.owner_id=v_user or o.offering_user_id=v_user)))
      and safety_private.offer_visible(o.request_id,o.offering_user_id)
   order by o.created_at desc,o.id desc limit p_limit offset p_offset
 ) page;
 -- Preserve the original authorized, parent-first expiration settlement.
 for v_request in select r.* from public.requests r
   where r.status='open' and r.deadline_at<=clock_timestamp()
   and ((r.id=p_request_id and r.owner_id=v_user) or exists (
     select 1 from public.request_offers o where o.id=any(v_ids) and o.request_id=r.id))
   order by r.id for update
 loop
   update public.requests set status='expired',updated_at=clock_timestamp() where public.requests.id=v_request.id;
 end loop;
 -- Project state and rounds in one final query. Joining rounds outside a
 -- volatile page function could mix its newer state with an older outer snapshot.
 return query select o.id,o.request_id,o.offering_user_id,o.status,o.message,o.created_at,
   r.title,r.status,r.deadline_at,p.display_name,p.major,p.year_of_study,c.display_name,
   o.offer_round,r.offer_round,r.points
 from public.request_offers o join public.requests r on r.id=o.request_id
 join public.profiles p on p.id=o.offering_user_id left join public.campuses c on c.id=p.campus_id
 where o.id=any(v_ids) and safety_private.offer_visible(o.request_id,o.offering_user_id) order by o.created_at desc,o.id desc;
end $function$;


CREATE OR REPLACE FUNCTION request_private.offer_page_v4(p_request_id uuid, p_limit integer, p_offset integer)
 RETURNS TABLE(id uuid, request_id uuid, offering_user_id uuid, status text, message text, created_at timestamp with time zone, request_title text, request_status text, request_deadline_at timestamp with time zone, helper_display_name text, helper_major text, helper_year smallint, helper_campus text, offer_round integer, request_offer_round integer, request_points integer, has_assignment_history boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_ids uuid[]; v_request public.requests;
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 or p_offset is null or p_offset < 0 then
    raise exception 'Invalid offer page' using errcode = '22023';
  end if;
  select array_agg(page.id) into v_ids from (
    select o.id from public.request_offers o join public.requests r on r.id = o.request_id
    where ((p_request_id is null and o.offering_user_id = v_user)
      or (r.id = p_request_id and (r.owner_id = v_user or o.offering_user_id = v_user)))
      and safety_private.offer_visible(o.request_id,o.offering_user_id)
    order by o.created_at desc, o.id desc limit p_limit offset p_offset
  ) page;
  for v_request in select r.* from public.requests r
    where r.status = 'open' and r.deadline_at <= clock_timestamp()
      and ((r.id = p_request_id and r.owner_id = v_user) or exists (
        select 1 from public.request_offers o where o.id = any(v_ids) and o.request_id = r.id))
    order by r.id for update
  loop
    update public.requests set status = 'expired', updated_at = clock_timestamp()
    where public.requests.id = v_request.id;
  end loop;
  return query select o.id, o.request_id, o.offering_user_id, o.status, o.message, o.created_at,
    r.title, r.status, r.deadline_at, p.display_name, p.major, p.year_of_study, c.display_name,
    o.offer_round, r.offer_round, r.points,
    exists (select 1 from public.request_point_reservations pr
      where pr.request_id = r.id and pr.helper_id = o.offering_user_id)
  from public.request_offers o join public.requests r on r.id = o.request_id
  join public.profiles p on p.id = o.offering_user_id left join public.campuses c on c.id = p.campus_id
  where o.id = any(v_ids) and safety_private.offer_visible(o.request_id,o.offering_user_id) order by o.created_at desc, o.id desc;
end $function$;


CREATE OR REPLACE FUNCTION request_private.list_offers(p_request_id uuid)
 RETURNS SETOF request_offers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid:=auth.uid(); v_request public.requests;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into v_request from public.requests where id=p_request_id for update;
 if not found then return; end if;
 if v_request.owner_id<>v_user and not exists(select 1 from public.request_offers where request_id=p_request_id and offering_user_id=v_user) then
   return; end if;
 if v_request.status='open' and v_request.deadline_at<=clock_timestamp() then
   update public.requests set status='expired',updated_at=clock_timestamp() where id=p_request_id;
 end if;
 return query select o.* from public.request_offers o where o.request_id=p_request_id
 and (v_request.owner_id=v_user or o.offering_user_id=v_user)
 and safety_private.offer_visible(o.request_id,o.offering_user_id) order by o.created_at,o.id;
end $function$;


CREATE OR REPLACE FUNCTION public.get_request_feed(p_category text DEFAULT NULL::text, p_campus_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS SETOF requests
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$

begin

  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;

  if p_limit is null or p_limit < 1 or p_limit > 50 or p_offset is null or p_offset < 0 then

    raise exception 'Invalid pagination' using errcode='22023'; end if;

  if p_category is not null and p_category not in ('delivery','pickup','event_help','study_help') then

    raise exception 'Invalid category' using errcode='22023'; end if;

  return query select r.* from public.requests r where r.status='open' and r.deadline_at > statement_timestamp()
    and not safety_private.student_blocked(r.owner_id)

    and (p_category is null or r.category=p_category) and (p_campus_id is null or r.campus_id=p_campus_id)

    order by r.is_urgent desc,r.created_at desc,r.id desc limit p_limit offset p_offset;

end $function$;


-- Blocked participants still need cancellation/completion/reopening notices
-- for work they actually accepted. Pending-only offers never gain this exception.
create function safety_private.notice_allowed(p_recipient uuid,p_actor uuid,p_event text,p_request uuid) returns boolean
language sql stable security definer set search_path='' as $$
  -- Expiry is authored by the system (actor NULL); its owner is still the
  -- counterpart for suppression. No new identity is exposed to the client.
  select not safety_private.pair_blocked(p_recipient,peer.id)
    or (p_event in ('offer_accepted','offer_withdrawn','request_cancelled','request_expired','request_reopened','request_completed')
      and safety_private.assignment_pair(p_request,p_recipient,peer.id))
  from (select coalesce(p_actor,(select r.owner_id from public.requests r
    where r.id=p_request and r.owner_id<>p_recipient)) as id) peer;
$$;
create function safety_private.filter_contact_notification() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if not safety_private.notice_allowed(new.recipient_id,new.actor_id,new.event_type,new.request_id) then return null; end if;
  return new;
end $$;
revoke all on function safety_private.filter_contact_notification() from public,anon,authenticated,service_role;
create trigger suppress_blocked_contact_notification before insert on public.notifications
for each row execute function safety_private.filter_contact_notification();

create function safety_private.filter_offer_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare kind text;
begin
  kind:=case new.event_type when 'created' then 'offer_created'
    when 'accepted' then 'offer_accepted' when 'withdrawn' then 'offer_withdrawn'
    when 'rejected' then 'offer_rejected' when 'another_accepted' then 'another_helper_selected'
    else new.event_type end;
  if not safety_private.notice_allowed(new.recipient_id,new.actor_id,kind,new.request_id) then return null; end if;
  return new;
end $$;
revoke all on function safety_private.filter_offer_notification() from public,anon,authenticated,service_role;
create trigger suppress_blocked_offer_notification before insert on public.offer_notifications
for each row execute function safety_private.filter_offer_notification();

-- Recheck at worker claim time, not only enqueue time. This drops unclaimed
-- queued contact alerts after blocking. Already delivered/in-flight OS pushes
-- cannot be recalled; notifications remain historical records in the app.
create or replace view notifications_private.push_targets with (security_invoker=true) as
select n.id as notification_id,d.session_id,d.expo_token,notifications_private.push_category(n.event_type) as category
from public.notifications n
join notifications_private.push_preferences p on p.profile_id=n.recipient_id and p.push_enabled
join notifications_private.android_push_devices d on d.profile_id=n.recipient_id
join auth.sessions s on s.id=d.session_id and s.user_id=d.profile_id
join auth.users u on u.id=d.profile_id
where n.read_at is null and (s.not_after is null or s.not_after>now())
  and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
  and safety_private.notice_allowed(n.recipient_id,n.actor_id,n.event_type,n.request_id)
  and case notifications_private.push_category(n.event_type) when 'messages' then p.messages
    when 'offers' then p.offers when 'request_updates' then p.request_updates else false end;
revoke all on notifications_private.push_targets from public,anon,authenticated;


-- A previously blocked student/prior contact can still be reported.
create or replace function safety_private.submit_report(
  p_operation_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_reason text,
  p_details text default ''
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_details text := btrim(coalesce(p_details, ''));
  v_hash bytea;
  v_existing safety_private.reports%rowtype;
  v_target_profile uuid;
  v_request_id uuid;
  v_evidence jsonb;
  v_report_id uuid;
  v_created_at timestamptz;
begin
  -- Never trust a JWT subject without a live, eligible account behind it.
  if v_actor is null or not exists (
    select 1 from public.profiles p join auth.users a on a.id = p.id
    where p.id = v_actor and p.onboarding_completed_at is not null
      and p.display_name is not null and btrim(p.display_name) <> '' and a.deleted_at is null
      and not coalesce(a.is_anonymous, false)
      and (a.banned_until is null or a.banned_until <= now())
  ) then
    raise exception using errcode = '42501', message = 'Sign in with a completed student profile to report a concern.';
  end if;

  if p_operation_id is null or p_target_id is null
     or p_target_type is null or p_target_type not in ('student', 'request')
     or p_reason is null or p_reason not in ('harassment', 'scam', 'unsafe', 'spam', 'other')
     or char_length(v_details) > 2000
     or (p_reason = 'other' and char_length(v_details) < 10) then
    raise exception using errcode = '22023', message = 'Invalid safety report. Choose a reason, keep details within 2,000 characters, and include at least 10 characters for Other.';
  end if;

  v_hash := extensions.digest(jsonb_build_object(
    'target_type', p_target_type, 'target_id', p_target_id,
    'reason', p_reason, 'details', v_details
  )::text, 'sha256');

  -- One lock serializes both retries and the rolling quota for this reporter.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('safety-report:' || v_actor::text, 0));
  select * into v_existing from safety_private.reports
    where reporter_id = v_actor and operation_id = p_operation_id;
  if found then
    if v_existing.payload_hash <> v_hash then
      raise exception using errcode = '22023', message = 'This report attempt was already used for different details. Start a new report.';
    end if;
    return jsonb_build_object('report_id', v_existing.id, 'created_at', v_existing.created_at);
  end if;

  -- SECURITY DEFINER bypasses source RLS. These explicit predicates mirror
  -- source visibility plus previously established safety/contact relationships.
  -- Blocking must not prevent reporting a previously reachable student.
  if p_target_type = 'student' then
    select p.id, jsonb_build_object('display_name', p.display_name)
      into v_target_profile, v_evidence
      from public.profiles p
      where p.id = p_target_id and p.id <> v_actor
        and (p.is_discoverable = true or safety_private.prior_contact(v_actor,p.id)
          or exists(select 1 from safety_private.student_blocks b
            where b.blocker_id=v_actor and b.blocked_id=p.id))
        and p.onboarding_completed_at is not null
        and p.display_name is not null
      for share;
  else
    select r.owner_id, r.id, jsonb_build_object(
      'title', r.title, 'description', r.description, 'category', r.category,
      'points', r.points, 'status', r.status
    ) into v_target_profile, v_request_id, v_evidence
      from public.requests r
      where r.id = p_target_id and r.owner_id <> v_actor
        and ((r.status = 'open' and r.deadline_at > statement_timestamp())
          or request_private.is_accepted_helper(r.id)
          or request_private.has_request_assignment(r.id))
      for share;
  end if;
  if not found then
    -- Identical response for a missing, hidden, or self-owned target.
    raise exception using errcode = '42501', message = 'This report target is not available.';
  end if;

  if (select count(*) from safety_private.reports
      where reporter_id = v_actor and created_at >= clock_timestamp() - interval '24 hours') >= 10 then
    raise exception using errcode = '54000', message = 'You can submit up to 10 reports in 24 hours. Please try again later.';
  end if;

  insert into safety_private.reports (
    reporter_id, operation_id, target_type, reported_profile_id, request_id,
    reason, details, payload_hash, evidence
  ) values (
    v_actor, p_operation_id, p_target_type, v_target_profile, v_request_id,
    p_reason, v_details, v_hash, v_evidence
  ) returning id, created_at into v_report_id, v_created_at;
  return jsonb_build_object('report_id', v_report_id, 'created_at', v_created_at);
end;
$$;


drop function public.get_my_conversations(integer,timestamptz,uuid);
drop function messaging_private.inbox(integer,timestamptz,uuid);
create or replace function messaging_private.inbox(
  p_limit integer, p_before_activity_at timestamptz, p_before_id uuid
)
returns table (
  id uuid, type text, status text,
  other_profile_id uuid, other_display_name text,
  group_title text, group_course_id uuid, group_course_code text,
  active_member_count integer, my_role text, my_membership_status text,
  my_membership_period integer, management_revision text, can_send boolean,
  last_message_body text, last_message_at timestamptz, last_activity_at timestamptz,
  last_message_sequence text, last_read_sequence text, unread_count integer,
  created_at timestamptz, interaction_blocked boolean, blocked_by_me boolean
) language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := messaging_private.require_actor();
begin
  if p_limit is null or p_limit < 1 or p_limit > 50
    or ((p_before_activity_at is null) <> (p_before_id is null))
    or (p_before_activity_at is not null and not isfinite(p_before_activity_at)) then
    raise exception 'Invalid conversation page' using errcode = '22023';
  end if;
  return query
    select summary_row.*
    from (
      select conversation.id, coalesce(conversation.last_message_at, conversation.created_at) as activity_at
      from public.conversation_members member
      join public.conversations conversation on conversation.id = member.conversation_id
      where member.profile_id = v_user and member.membership_status = 'active'
        and conversation.type = 'direct' and conversation.status <> 'removed'
        and (p_before_activity_at is null or
          (coalesce(conversation.last_message_at, conversation.created_at), conversation.id)
            < (p_before_activity_at, p_before_id))
      order by coalesce(conversation.last_message_at, conversation.created_at) desc, conversation.id desc
      limit p_limit
    ) page
    cross join lateral jsonb_to_record(messaging_private.summary(page.id)) as summary_row(
      id uuid, type text, status text,
      other_profile_id uuid, other_display_name text,
      group_title text, group_course_id uuid, group_course_code text,
      active_member_count integer, my_role text, my_membership_status text,
      my_membership_period integer, management_revision text, can_send boolean,
      last_message_body text, last_message_at timestamptz, last_activity_at timestamptz,
      last_message_sequence text, last_read_sequence text, unread_count integer,
      created_at timestamptz, interaction_blocked boolean, blocked_by_me boolean
    )
    order by page.activity_at desc, page.id desc;
end;
$$;



create function public.get_my_conversations(
  p_limit integer default 20,
  p_before_activity_at timestamptz default null,
  p_before_id uuid default null
) returns table (
  id uuid, type text, status text,
  other_profile_id uuid, other_display_name text,
  group_title text, group_course_id uuid, group_course_code text,
  active_member_count integer, my_role text, my_membership_status text,
  my_membership_period integer, management_revision text, can_send boolean,
  last_message_body text, last_message_at timestamptz, last_activity_at timestamptz,
  last_message_sequence text, last_read_sequence text, unread_count integer,
  created_at timestamptz, interaction_blocked boolean, blocked_by_me boolean
) language sql stable security invoker set search_path = '' as $$
  select * from messaging_private.inbox(p_limit, p_before_activity_at, p_before_id);
$$;


revoke all on function messaging_private.inbox(integer,timestamptz,uuid),
  public.get_my_conversations(integer,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function messaging_private.inbox(integer,timestamptz,uuid),
  public.get_my_conversations(integer,timestamptz,uuid) to authenticated;

-- Newly introduced helpers are not callable directly, except caller-bound RLS
-- predicates and the three authorized API implementations. Existing report ACLs
-- and existing replaced-function ACLs are preserved by CREATE OR REPLACE.
revoke all on function safety_private.require_actor(),safety_private.lock_pair(uuid,uuid),
  safety_private.pair_blocked(uuid,uuid),safety_private.student_blocked(uuid),
  safety_private.assignment_pair(uuid,uuid,uuid),safety_private.prior_contact(uuid,uuid),
  safety_private.block_target_available(uuid,uuid),safety_private.block_state(uuid),
  safety_private.set_block(uuid,boolean,bigint),safety_private.blocked_students(integer,integer),
  safety_private.require_unblocked_peer(uuid),safety_private.offer_visible(uuid,uuid),
  safety_private.notice_allowed(uuid,uuid,text,uuid),
  public.get_student_block_state(uuid),public.set_student_block(uuid,boolean,bigint),
  public.get_my_blocked_students(integer,integer) from public,anon,authenticated,service_role;
grant execute on function safety_private.student_blocked(uuid),safety_private.offer_visible(uuid,uuid),
  safety_private.block_state(uuid),safety_private.set_block(uuid,boolean,bigint),
  safety_private.blocked_students(integer,integer),public.get_student_block_state(uuid),
  public.set_student_block(uuid,boolean,bigint),public.get_my_blocked_students(integer,integer) to authenticated;
notify pgrst,'reload schema';
