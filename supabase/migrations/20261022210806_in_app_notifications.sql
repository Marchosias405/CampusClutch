-- Task 11 checkpoint 1: durable recipient-owned in-app notices. No push delivery.
create schema notifications_private;
revoke all on schema notifications_private from public, anon, authenticated;
grant usage on schema notifications_private to authenticated;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in (
    'offer_created','offer_accepted','offer_rejected','offer_withdrawn',
    'another_helper_selected','request_cancelled','request_expired','request_reopened',
    'request_completed','message_received')),
  title text not null check (char_length(title) between 1 and 160),
  body text not null check (char_length(body) between 1 and 500),
  request_id uuid references public.requests(id) on delete set null,
  offer_id uuid references public.request_offers(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  navigation_key text not null check (navigation_key in ('request_details','conversation')),
  source_event_key text not null check (char_length(source_event_key) between 1 and 200),
  read_at timestamptz check (read_at is null or isfinite(read_at)),
  created_at timestamptz not null default clock_timestamp() check (isfinite(created_at)),
  unique (recipient_id, source_event_key),
  check (actor_id is null or actor_id <> recipient_id),
  check ((event_type = 'message_received') = (navigation_key = 'conversation'))
);
create index notifications_recipient_history_idx on public.notifications(recipient_id, created_at desc, id desc);
create index notifications_recipient_unread_idx on public.notifications(recipient_id) where read_at is null;
create index notifications_actor_idx on public.notifications(actor_id);
create index notifications_request_idx on public.notifications(request_id);
create index notifications_offer_idx on public.notifications(offer_id);
create index notifications_conversation_idx on public.notifications(conversation_id);
create index notifications_message_idx on public.notifications(message_id);
alter table public.notifications enable row level security;
revoke all on public.notifications from public, anon, authenticated;
grant select on public.notifications to authenticated;
create policy notifications_read_own on public.notifications for select to authenticated
using (recipient_id = (select messaging_private.realtime_actor()));

comment on table public.notifications is
  'Server-authored, generic in-app notices; ownership does not grant access to linked resources. Sources and retries are deduplicated. Not a push queue.';

create function notifications_private.require_actor() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := messaging_private.realtime_actor();
begin
  if v_user is null then
    raise exception 'An eligible signed-in profile is required' using errcode = '42501';
  end if;
  return v_user;
end;
$$;
revoke all on function notifications_private.require_actor() from public, anon, authenticated;
grant execute on function notifications_private.require_actor() to authenticated;

-- The authoritative offer event already carries the round-specific identity.
-- Neither helper text, request text, profile names nor message bodies are copied.
create function notifications_private.copy_offer_event(p_event public.offer_notifications)
returns void language plpgsql security definer set search_path = '' as $$
declare v_kind text; v_title text; v_body text;
begin
  if p_event.recipient_id = p_event.actor_id then return; end if;
  v_kind := case p_event.event_type
    when 'created' then 'offer_created' when 'accepted' then 'offer_accepted'
    when 'rejected' then 'offer_rejected' when 'withdrawn' then 'offer_withdrawn'
    when 'another_accepted' then 'another_helper_selected' else p_event.event_type end;
  v_title := case p_event.event_type
    when 'created' then 'New offer to help'
    when 'accepted' then 'Your offer was accepted'
    when 'rejected' then 'Offer update'
    when 'withdrawn' then 'A helper withdrew'
    when 'another_accepted' then 'Another helper was selected'
    when 'request_cancelled' then 'Request cancelled'
    when 'request_expired' then 'Request expired'
    when 'request_reopened' then 'Request reopened' end;
  v_body := case p_event.event_type
    when 'created' then 'Someone offered to help with your request. Open it to review the offer.'
    when 'accepted' then 'The poster accepted your offer. Open the request to see the arrangement.'
    when 'rejected' then 'The poster did not select your offer. Open the request for its latest status.'
    when 'withdrawn' then 'A helper withdrew from your request. Open it to review the latest status.'
    when 'another_accepted' then 'The poster selected another helper for this request.'
    when 'request_cancelled' then 'A request you offered to help with was cancelled.'
    when 'request_expired' then 'A request you offered to help with has expired.'
    when 'request_reopened' then 'The poster reopened this request. Review its current details and points before offering again.' end;
  insert into public.notifications(recipient_id,actor_id,event_type,title,body,
    request_id,offer_id,navigation_key,source_event_key,created_at)
  values(p_event.recipient_id,p_event.actor_id,v_kind,v_title,v_body,
    p_event.request_id,p_event.offer_id,'request_details','offer:' || p_event.id::text,p_event.created_at)
  on conflict(recipient_id,source_event_key) do nothing;
end;
$$;
revoke all on function notifications_private.copy_offer_event(public.offer_notifications) from public, anon, authenticated;

create function notifications_private.bridge_offer_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform notifications_private.copy_offer_event(new);
  return new;
end;
$$;
revoke all on function notifications_private.bridge_offer_event() from public, anon, authenticated;
create trigger notifications_offer_insert after insert on public.offer_notifications
for each row execute function notifications_private.bridge_offer_event();

-- Creating the trigger holds the source table lock through the migration, so a
-- concurrent source event cannot fall between the bridge and historical copy.
-- Old offer history is preserved once; old messages/completions are not flooded
-- into the bell. Install broadcasts after backfill to avoid a historical storm.
select notifications_private.copy_offer_event(event) from public.offer_notifications event;

create function notifications_private.message_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications(recipient_id,actor_id,event_type,title,body,
    conversation_id,message_id,navigation_key,source_event_key,created_at)
  select member.profile_id,new.sender_id,'message_received','New message',
    'You have a new direct message. Open the conversation to read it.',
    new.conversation_id,new.id,'conversation','message:' || new.id::text,new.created_at
  from public.conversation_members member
  join public.conversations conversation on conversation.id = member.conversation_id
  join public.profiles profile on profile.id = member.profile_id
  join auth.users account on account.id = profile.id
  where member.conversation_id = new.conversation_id and member.profile_id <> new.sender_id
    and member.membership_status = 'active' and member.last_read_sequence < new.sequence
    and conversation.type = 'direct' and conversation.status <> 'removed'
    and profile.onboarding_completed_at is not null and profile.display_name is not null
    and account.deleted_at is null and (account.banned_until is null or account.banned_until <= now())
  on conflict(recipient_id,source_event_key) do nothing;
  return new;
end;
$$;
revoke all on function notifications_private.message_event() from public, anon, authenticated;
create trigger notifications_message_insert after insert on public.messages
for each row execute function notifications_private.message_event();

create function notifications_private.request_completed_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'completed' or old.status = 'completed' then return new; end if;
  insert into public.notifications(recipient_id,actor_id,event_type,title,body,
    request_id,offer_id,navigation_key,source_event_key,created_at)
  select reservation.helper_id,new.owner_id,'request_completed','Request completed',
    'The poster confirmed completion and transferred your points. You can now rate this assignment.',
    new.id,offer.id,'request_details','completed:' || new.id::text || ':' || new.offer_round::text,
    coalesce(new.completed_at,clock_timestamp())
  from public.request_point_reservations reservation
  join public.request_offers offer on offer.request_id = reservation.request_id
    and offer.offer_round = reservation.offer_round and offer.offering_user_id = reservation.helper_id
    and offer.status = 'accepted'
  where reservation.request_id = new.id and reservation.offer_round = new.offer_round
    and reservation.status = 'settled' and reservation.poster_id = new.owner_id
  on conflict(recipient_id,source_event_key) do nothing;
  return new;
end;
$$;
revoke all on function notifications_private.request_completed_event() from public, anon, authenticated;
create trigger notifications_request_completed after update of status on public.requests
for each row execute function notifications_private.request_completed_event();

-- The chat cursor is authoritative. A bell acknowledgment never changes it.
create function notifications_private.read_message_notices() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.last_read_sequence <= old.last_read_sequence then return new; end if;
  update public.notifications notice set read_at = clock_timestamp()
  from public.messages message
  where notice.recipient_id = new.profile_id and notice.conversation_id = new.conversation_id
    and notice.event_type = 'message_received' and notice.read_at is null
    and message.id = notice.message_id and message.sequence <= new.last_read_sequence;
  return new;
end;
$$;
revoke all on function notifications_private.read_message_notices() from public, anon, authenticated;
create trigger notifications_message_read_cursor after update of last_read_sequence on public.conversation_members
for each row execute function notifications_private.read_message_notices();

create function public.get_my_notifications(p_limit integer default 20,
  p_before_created_at timestamptz default null,p_before_id uuid default null)
returns table(id uuid,recipient_id uuid,actor_id uuid,event_type text,title text,body text,
  request_id uuid,offer_id uuid,conversation_id uuid,message_id uuid,navigation_key text,
  read_at timestamptz,created_at timestamptz)
language plpgsql stable security invoker set search_path = '' as $$
declare v_user uuid := notifications_private.require_actor();
begin
  if p_limit is null or p_limit < 1 or p_limit > 50
    or ((p_before_created_at is null) <> (p_before_id is null))
    or (p_before_created_at is not null and not isfinite(p_before_created_at)) then
    raise exception 'Invalid notification page' using errcode = '22023';
  end if;
  return query select notice.id,notice.recipient_id,notice.actor_id,notice.event_type,
    notice.title,notice.body,notice.request_id,notice.offer_id,notice.conversation_id,
    notice.message_id,notice.navigation_key,notice.read_at,notice.created_at
  from public.notifications notice where notice.recipient_id = v_user
    and (p_before_created_at is null or (notice.created_at,notice.id) < (p_before_created_at,p_before_id))
  order by notice.created_at desc,notice.id desc limit p_limit;
end;
$$;
create function public.get_my_notification_unread_count() returns integer
language plpgsql stable security invoker set search_path = '' as $$
declare v_user uuid := notifications_private.require_actor(); v_count integer;
begin
  select count(*)::integer into v_count from public.notifications notice
  where notice.recipient_id = v_user and notice.read_at is null;
  return v_count;
end;
$$;

create function notifications_private.mark_read(p_notification_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := notifications_private.require_actor(); v_id uuid;
begin
  -- Lock the caller-owned row, then preserve the first acknowledgment timestamp.
  select id into v_id from public.notifications where id = p_notification_id and recipient_id = v_user for update;
  if not found then raise exception 'Notification unavailable' using errcode = '42501'; end if;
  update public.notifications set read_at = clock_timestamp() where id = v_id and read_at is null;
  return v_id;
end;
$$;
create function notifications_private.mark_all_read() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := notifications_private.require_actor(); v_count integer; v_read_at timestamptz := clock_timestamp();
begin
  -- One statement marks the notices visible in this snapshot. A later insert
  -- remains unread, and retries cannot resurrect an earlier unread state.
  update public.notifications set read_at = v_read_at where recipient_id = v_user and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function notifications_private.mark_read(uuid),notifications_private.mark_all_read() from public, anon, authenticated;
grant execute on function notifications_private.mark_read(uuid),notifications_private.mark_all_read() to authenticated;
create function public.mark_my_notification_read(p_notification_id uuid) returns uuid
language sql security invoker set search_path = '' as $$ select notifications_private.mark_read(p_notification_id); $$;
create function public.mark_all_my_notifications_read() returns integer
language sql security invoker set search_path = '' as $$ select notifications_private.mark_all_read(); $$;
revoke all on function public.get_my_notifications(integer,timestamptz,uuid),public.get_my_notification_unread_count(),
  public.mark_my_notification_read(uuid),public.mark_all_my_notifications_read() from public, anon, authenticated;
grant execute on function public.get_my_notifications(integer,timestamptz,uuid),public.get_my_notification_unread_count(),
  public.mark_my_notification_read(uuid),public.mark_all_my_notifications_read() to authenticated;

create policy notifications_receive_own_invalidations on realtime.messages
for select to authenticated using (
  extension = 'broadcast' and topic = (select realtime.topic())
  and topic = 'notifications:' || (select messaging_private.realtime_actor())::text
);
-- Existing restrictive policies forbid all client writes to realtime.messages.
-- Transition tables coalesce mark-all/cursor updates to one event per recipient.
create function notifications_private.broadcast_changes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_recipient uuid;
begin
  for v_recipient in
    select distinct notice.recipient_id from changed_notifications notice
    join public.profiles profile on profile.id = notice.recipient_id
    join auth.users account on account.id = profile.id
    where profile.onboarding_completed_at is not null and profile.display_name is not null
      and account.deleted_at is null and (account.banned_until is null or account.banned_until <= now())
  loop
    perform realtime.send('{}'::jsonb,'notifications_changed','notifications:' || v_recipient::text,true);
  end loop;
  return null;
end;
$$;
revoke all on function notifications_private.broadcast_changes() from public, anon, authenticated;
create trigger notifications_broadcast_insert after insert on public.notifications
referencing new table as changed_notifications for each statement
execute function notifications_private.broadcast_changes();
create trigger notifications_broadcast_update after update on public.notifications
referencing new table as changed_notifications for each statement
execute function notifications_private.broadcast_changes();

notify pgrst, 'reload schema';
