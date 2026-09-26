-- Task 10 checkpoint 1: direct text messaging foundation.
-- Captured locally with Supabase CLI; scoped to reviewed messaging DDL and grants.
-- Request chats require an immutable points reservation; legacy acceptances
-- without one must be reopened and freshly accepted before linking a chat.

create schema messaging_private;
revoke all on schema messaging_private from public, anon, authenticated;
grant usage on schema messaging_private to authenticated;

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'direct' check (type = 'direct'),
  created_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'closed', 'removed')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  last_message_at timestamptz,
  last_message_sequence bigint not null default 0 check (last_message_sequence >= 0),
  check ((last_message_sequence = 0) = (last_message_at is null))
);
create index conversations_created_by_idx on public.conversations(created_by);
create index conversations_activity_idx
  on public.conversations((coalesce(last_message_at, created_at)) desc, id desc);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  joined_at timestamptz not null default clock_timestamp(),
  last_read_sequence bigint not null default 0 check (last_read_sequence >= 0),
  last_read_at timestamptz,
  primary key (conversation_id, profile_id)
);
create index conversation_members_profile_idx
  on public.conversation_members(profile_id, conversation_id);

create table public.direct_conversation_pairs (
  conversation_id uuid primary key references public.conversations(id) on delete restrict,
  user_low_id uuid not null references public.profiles(id) on delete restrict,
  user_high_id uuid not null references public.profiles(id) on delete restrict,
  check (user_low_id < user_high_id),
  unique (user_low_id, user_high_id)
);
create index direct_conversation_pairs_high_idx on public.direct_conversation_pairs(user_high_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete restrict,
  sender_id uuid not null references public.profiles(id) on delete restrict,
  client_message_id uuid not null,
  sequence bigint not null check (sequence > 0),
  body text not null check (
    char_length(body) between 1 and 4000
    and body = regexp_replace(body, '^[[:space:]]+|[[:space:]]+$', '', 'g')
  ),
  created_at timestamptz not null default clock_timestamp(),
  unique (conversation_id, sequence),
  unique (sender_id, client_message_id),
  foreign key (conversation_id, sender_id)
    references public.conversation_members(conversation_id, profile_id) on delete restrict
);

create table public.request_conversations (
  request_id uuid not null,
  offer_round integer not null check (offer_round > 0),
  conversation_id uuid not null references public.conversations(id) on delete restrict,
  poster_id uuid not null references public.profiles(id) on delete restrict,
  helper_id uuid not null references public.profiles(id) on delete restrict,
  primary key (request_id, offer_round),
  foreign key (request_id, offer_round)
    references public.request_point_reservations(request_id, offer_round) on delete restrict,
  check (poster_id <> helper_id)
);
create index request_conversations_conversation_idx on public.request_conversations(conversation_id);
create index request_conversations_poster_idx on public.request_conversations(poster_id);
create index request_conversations_helper_idx on public.request_conversations(helper_id);

comment on table public.conversation_members is
  'Direct memberships are immutable through client APIs. Read cursors are visible only to their owner.';
comment on table public.request_conversations is
  'Immutable chat links for original reserved assignment participants, one link per request round.';
comment on column public.messages.sequence is
  'Allocated under the conversation lock; RPCs return this bigint as text to preserve client precision.';

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.direct_conversation_pairs enable row level security;
alter table public.messages enable row level security;
alter table public.request_conversations enable row level security;
revoke all on public.conversations, public.conversation_members,
  public.direct_conversation_pairs, public.messages, public.request_conversations
  from public, anon, authenticated;
grant select on public.conversations, public.conversation_members,
  public.direct_conversation_pairs, public.messages, public.request_conversations
  to authenticated;

create function messaging_private.require_actor(p_completed boolean default false)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not exists (
    select 1 from public.profiles p where p.id = v_user
      and (not p_completed or (p.onboarding_completed_at is not null and p.display_name is not null))
  ) then
    raise exception 'An eligible signed-in profile is required' using errcode = '42501';
  end if;
  return v_user;
end;
$$;
revoke all on function messaging_private.require_actor(boolean) from public, anon, authenticated;

create function messaging_private.can_read_conversation(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.conversation_members m
    join public.conversations c on c.id = m.conversation_id
    join public.profiles p on p.id = m.profile_id
    where m.conversation_id = p_conversation_id
      and m.profile_id = (select auth.uid()) and c.status <> 'removed'
  );
$$;
revoke all on function messaging_private.can_read_conversation(uuid) from public, anon, authenticated;
grant execute on function messaging_private.can_read_conversation(uuid) to authenticated;

create policy conversations_read on public.conversations for select to authenticated
  using (messaging_private.can_read_conversation(id));
create policy conversation_members_read_own on public.conversation_members for select to authenticated
  using (profile_id = (select auth.uid()) and messaging_private.can_read_conversation(conversation_id));
create policy direct_conversation_pairs_read on public.direct_conversation_pairs for select to authenticated
  using (((select auth.uid()) = user_low_id or (select auth.uid()) = user_high_id)
    and messaging_private.can_read_conversation(conversation_id));
create policy messages_read on public.messages for select to authenticated
  using (messaging_private.can_read_conversation(conversation_id));
create policy request_conversations_read on public.request_conversations for select to authenticated
  using (((select auth.uid()) = poster_id or (select auth.uid()) = helper_id)
    and messaging_private.can_read_conversation(conversation_id));

-- Internal helper only. Public callers cannot bypass target discoverability.
-- Lock order: optional request parent -> normalized pair advisory lock -> conversation.
create function messaging_private.ensure_direct_pair(p_other_profile_id uuid, p_require_discoverable boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := messaging_private.require_actor(true);
  v_low uuid; v_high uuid; v_conversation_id uuid; v_status text;
begin
  if p_other_profile_id is null or p_other_profile_id = v_user then
    raise exception 'Choose another profile' using errcode = '22023';
  end if;
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
$$;
revoke all on function messaging_private.ensure_direct_pair(uuid, boolean) from public, anon, authenticated;

create function messaging_private.start_direct(p_other_profile_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform messaging_private.require_actor(true);
  return messaging_private.ensure_direct_pair(p_other_profile_id, true);
end;
$$;
revoke all on function messaging_private.start_direct(uuid) from public, anon, authenticated;
grant execute on function messaging_private.start_direct(uuid) to authenticated;

create function messaging_private.open_request(p_request_id uuid, p_offer_round integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := messaging_private.require_actor(true);
  v_reservation public.request_point_reservations;
  v_conversation_id uuid; v_existing uuid; v_owner uuid;
begin
  if p_request_id is null or p_offer_round is null or p_offer_round < 1 then
    raise exception 'Invalid request assignment' using errcode = '22023';
  end if;
  -- Match the existing request lifecycle parent-first lock order.
  select r.owner_id into v_owner from public.requests r
  where r.id = p_request_id and exists (
    select 1 from public.request_point_reservations pr
    where pr.request_id = r.id and pr.offer_round = p_offer_round
      and (pr.poster_id = v_user or pr.helper_id = v_user)
  ) for update;
  if not found then
    raise exception 'Request assignment unavailable' using errcode = '42501';
  end if;
  select pr.* into v_reservation from public.request_point_reservations pr
  where pr.request_id = p_request_id and pr.offer_round = p_offer_round;
  if not found or v_reservation.poster_id <> v_owner
    or (v_reservation.poster_id <> v_user and v_reservation.helper_id <> v_user) then
    raise exception 'Request assignment unavailable' using errcode = '42501';
  end if;
  v_conversation_id := messaging_private.ensure_direct_pair(
    case when v_reservation.poster_id = v_user then v_reservation.helper_id else v_reservation.poster_id end,
    false);
  select rc.conversation_id into v_existing from public.request_conversations rc
  where rc.request_id = p_request_id and rc.offer_round = p_offer_round;
  if found then
    if v_existing <> v_conversation_id then
      raise exception 'Request conversation is inconsistent' using errcode = '55000';
    end if;
    return v_existing;
  end if;
  insert into public.request_conversations(request_id, offer_round, conversation_id, poster_id, helper_id)
  values (p_request_id, p_offer_round, v_conversation_id, v_reservation.poster_id, v_reservation.helper_id);
  return v_conversation_id;
end;
$$;
revoke all on function messaging_private.open_request(uuid, integer) from public, anon, authenticated;
grant execute on function messaging_private.open_request(uuid, integer) to authenticated;

create function messaging_private.summary(p_conversation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := messaging_private.require_actor(); v_result jsonb;
begin
  if p_conversation_id is null then raise exception 'Invalid conversation' using errcode = '22023'; end if;
  if not messaging_private.can_read_conversation(p_conversation_id) then
    raise exception 'Conversation unavailable' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'id', c.id, 'type', c.type, 'status', c.status,
    'other_profile_id', p.id, 'other_display_name', p.display_name,
    'last_message_body', latest.body, 'last_message_at', c.last_message_at,
    'last_activity_at', coalesce(c.last_message_at, c.created_at),
    'last_message_sequence', c.last_message_sequence::text,
    'last_read_sequence', m.last_read_sequence::text,
    'unread_count', (select count(*)::integer from public.messages msg
      where msg.conversation_id = c.id and msg.sequence > m.last_read_sequence and msg.sender_id <> v_user),
    'created_at', c.created_at
  ) into v_result
  from public.conversations c
  join public.conversation_members m on m.conversation_id = c.id and m.profile_id = v_user
  join public.direct_conversation_pairs d on d.conversation_id = c.id
  join public.profiles p on p.id = case when d.user_low_id = v_user then d.user_high_id else d.user_low_id end
  left join public.messages latest on latest.conversation_id = c.id and latest.sequence = c.last_message_sequence
  where c.id = p_conversation_id and c.status <> 'removed';
  if v_result is null then raise exception 'Conversation unavailable' using errcode = '42501'; end if;
  return v_result;
end;
$$;
revoke all on function messaging_private.summary(uuid) from public, anon, authenticated;
grant execute on function messaging_private.summary(uuid) to authenticated;

create function messaging_private.inbox(p_limit integer, p_before_activity_at timestamptz, p_before_id uuid)
returns table (
  id uuid, type text, status text, other_profile_id uuid, other_display_name text,
  last_message_body text, last_message_at timestamptz, last_activity_at timestamptz,
  last_message_sequence text, last_read_sequence text, unread_count integer, created_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := messaging_private.require_actor();
begin
  if p_limit is null or p_limit < 1 or p_limit > 50
    or ((p_before_activity_at is null) <> (p_before_id is null))
    or (p_before_activity_at is not null and not isfinite(p_before_activity_at)) then
    raise exception 'Invalid conversation page' using errcode = '22023';
  end if;
  return query
    select s.*
    from (
      select c.id, coalesce(c.last_message_at, c.created_at) as activity_at
      from public.conversation_members m join public.conversations c on c.id = m.conversation_id
      where m.profile_id = v_user and c.status <> 'removed'
        and (p_before_activity_at is null or
          (coalesce(c.last_message_at, c.created_at), c.id) < (p_before_activity_at, p_before_id))
      order by coalesce(c.last_message_at, c.created_at) desc, c.id desc limit p_limit
    ) page
    cross join lateral jsonb_to_record(messaging_private.summary(page.id)) as s(
      id uuid, type text, status text, other_profile_id uuid, other_display_name text,
      last_message_body text, last_message_at timestamptz, last_activity_at timestamptz,
      last_message_sequence text, last_read_sequence text, unread_count integer, created_at timestamptz
    )
    order by page.activity_at desc, page.id desc;
end;
$$;
revoke all on function messaging_private.inbox(integer, timestamptz, uuid) from public, anon, authenticated;
grant execute on function messaging_private.inbox(integer, timestamptz, uuid) to authenticated;

create function messaging_private.message_page(p_conversation_id uuid, p_before_sequence bigint, p_limit integer)
returns table (id uuid, conversation_id uuid, sender_id uuid, client_message_id uuid, sequence text, body text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform messaging_private.require_actor();
  if p_conversation_id is null or p_limit is null or p_limit < 1 or p_limit > 50
    or (p_before_sequence is not null and p_before_sequence < 1) then
    raise exception 'Invalid message page' using errcode = '22023';
  end if;
  if not messaging_private.can_read_conversation(p_conversation_id) then
    raise exception 'Conversation unavailable' using errcode = '42501';
  end if;
  return query select msg.id, msg.conversation_id, msg.sender_id, msg.client_message_id,
    msg.sequence::text, msg.body, msg.created_at
  from public.messages msg where msg.conversation_id = p_conversation_id
    and (p_before_sequence is null or msg.sequence < p_before_sequence)
  order by msg.sequence desc limit p_limit;
end;
$$;
revoke all on function messaging_private.message_page(uuid, bigint, integer) from public, anon, authenticated;
grant execute on function messaging_private.message_page(uuid, bigint, integer) to authenticated;

-- Pure projection helper, not externally callable. Never serialize bigint as a JSON number.
create function messaging_private.message_json(p_message public.messages)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', (p_message).id, 'conversation_id', (p_message).conversation_id,
    'sender_id', (p_message).sender_id, 'client_message_id', (p_message).client_message_id,
    'sequence', (p_message).sequence::text, 'body', (p_message).body, 'created_at', (p_message).created_at);
$$;
revoke all on function messaging_private.message_json(public.messages) from public, anon, authenticated;

create function messaging_private.send_message(p_conversation_id uuid, p_client_message_id uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := messaging_private.require_actor(); v_conversation public.conversations;
  v_message public.messages; v_body text; v_now timestamptz;
begin
  v_body := regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if p_conversation_id is null or p_client_message_id is null or v_body is null
    or char_length(v_body) < 1 or char_length(v_body) > 4000 then
    raise exception 'A message must contain 1 to 4000 characters' using errcode = '22023';
  end if;
  select c.* into v_conversation from public.conversations c
  where c.id = p_conversation_id and c.status <> 'removed'
    and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.profile_id = v_user)
  for update;
  if not found then raise exception 'Conversation unavailable' using errcode = '42501'; end if;

  select msg.* into v_message from public.messages msg
  where msg.sender_id = v_user and msg.client_message_id = p_client_message_id;
  if found then
    if v_message.conversation_id <> p_conversation_id or v_message.body <> v_body then
      raise exception 'Message retry does not match its original content' using errcode = '22023';
    end if;
    return messaging_private.message_json(v_message);
  end if;
  if v_conversation.status <> 'active' then
    raise exception 'This conversation is closed to new messages' using errcode = '55000';
  end if;
  v_now := clock_timestamp();
  insert into public.messages(conversation_id, sender_id, client_message_id, sequence, body, created_at)
  values (p_conversation_id, v_user, p_client_message_id, v_conversation.last_message_sequence + 1, v_body, v_now)
  on conflict (sender_id, client_message_id) do nothing returning * into v_message;
  if not found then
    -- A simultaneous retry in a different conversation may have won the global
    -- key. That statement has now committed; do not lock its conversation.
    select msg.* into v_message from public.messages msg
    where msg.sender_id = v_user and msg.client_message_id = p_client_message_id;
    if not found or v_message.conversation_id <> p_conversation_id or v_message.body <> v_body then
      raise exception 'Message retry does not match its original content' using errcode = '22023';
    end if;
    return messaging_private.message_json(v_message);
  end if;
  update public.conversations set last_message_sequence = v_message.sequence,
    last_message_at = v_now, updated_at = v_now where public.conversations.id = p_conversation_id;
  return messaging_private.message_json(v_message);
end;
$$;
revoke all on function messaging_private.send_message(uuid, uuid, text) from public, anon, authenticated;
grant execute on function messaging_private.send_message(uuid, uuid, text) to authenticated;

create function messaging_private.mark_read(p_conversation_id uuid, p_through_sequence bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := messaging_private.require_actor(); v_conversation public.conversations; v_cursor bigint;
begin
  if p_conversation_id is null or p_through_sequence is null or p_through_sequence < 0 then
    raise exception 'Invalid read cursor' using errcode = '22023';
  end if;
  select c.* into v_conversation from public.conversations c
  where c.id = p_conversation_id and c.status <> 'removed'
    and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.profile_id = v_user)
  for update;
  if not found then raise exception 'Conversation unavailable' using errcode = '42501'; end if;
  if p_through_sequence > v_conversation.last_message_sequence or (p_through_sequence > 0 and not exists (
    select 1 from public.messages msg where msg.conversation_id = p_conversation_id and msg.sequence = p_through_sequence
  )) then
    raise exception 'Read cursor must identify a message in this conversation' using errcode = '22023';
  end if;
  update public.conversation_members m set
    last_read_at = case when p_through_sequence > m.last_read_sequence then clock_timestamp() else m.last_read_at end,
    last_read_sequence = greatest(m.last_read_sequence, p_through_sequence)
  where m.conversation_id = p_conversation_id and m.profile_id = v_user
  returning m.last_read_sequence into v_cursor;
  return v_cursor::text;
end;
$$;
revoke all on function messaging_private.mark_read(uuid, bigint) from public, anon, authenticated;
grant execute on function messaging_private.mark_read(uuid, bigint) to authenticated;

create function public.start_direct_conversation(p_other_profile_id uuid)
returns uuid language sql security invoker set search_path = '' as $$
  select messaging_private.start_direct(p_other_profile_id);
$$;
create function public.open_request_conversation(p_request_id uuid, p_offer_round integer)
returns uuid language sql security invoker set search_path = '' as $$
  select messaging_private.open_request(p_request_id, p_offer_round);
$$;
create function public.get_conversation_summary(p_conversation_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select messaging_private.summary(p_conversation_id);
$$;
create function public.get_my_conversations(
  p_limit integer default 20, p_before_activity_at timestamptz default null, p_before_id uuid default null
) returns table (
  id uuid, type text, status text, other_profile_id uuid, other_display_name text,
  last_message_body text, last_message_at timestamptz, last_activity_at timestamptz,
  last_message_sequence text, last_read_sequence text, unread_count integer, created_at timestamptz
) language sql stable security invoker set search_path = '' as $$
  select * from messaging_private.inbox(p_limit, p_before_activity_at, p_before_id);
$$;
create function public.get_conversation_messages(
  p_conversation_id uuid, p_before_sequence bigint default null, p_limit integer default 30
) returns table (id uuid, conversation_id uuid, sender_id uuid, client_message_id uuid, sequence text, body text, created_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select * from messaging_private.message_page(p_conversation_id, p_before_sequence, p_limit);
$$;
create function public.send_conversation_message(p_conversation_id uuid, p_client_message_id uuid, p_body text)
returns jsonb language sql security invoker set search_path = '' as $$
  select messaging_private.send_message(p_conversation_id, p_client_message_id, p_body);
$$;
create function public.mark_conversation_read(p_conversation_id uuid, p_through_sequence bigint)
returns text language sql security invoker set search_path = '' as $$
  select messaging_private.mark_read(p_conversation_id, p_through_sequence);
$$;

revoke all on function public.start_direct_conversation(uuid), public.open_request_conversation(uuid, integer),
  public.get_conversation_summary(uuid), public.get_my_conversations(integer, timestamptz, uuid),
  public.get_conversation_messages(uuid, bigint, integer), public.send_conversation_message(uuid, uuid, text),
  public.mark_conversation_read(uuid, bigint) from public, anon, authenticated;
grant execute on function public.start_direct_conversation(uuid), public.open_request_conversation(uuid, integer),
  public.get_conversation_summary(uuid), public.get_my_conversations(integer, timestamptz, uuid),
  public.get_conversation_messages(uuid, bigint, integer), public.send_conversation_message(uuid, uuid, text),
  public.mark_conversation_read(uuid, bigint) to authenticated;
