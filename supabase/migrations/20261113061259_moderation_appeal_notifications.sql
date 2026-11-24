-- One private bell notice per appeal decision; retain compatibility with older APKs.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
alter table public.notifications drop constraint notifications_event_type_check;
alter table public.notifications add constraint notifications_event_type_check check(event_type in (
  'offer_created','offer_accepted','offer_rejected','offer_withdrawn','another_helper_selected',
  'request_cancelled','request_expired','request_reopened','request_completed','message_received','account_warning','appeal_decided'));
alter table public.notifications drop constraint notifications_destination_check;
alter table public.notifications add constraint notifications_destination_check check (
  navigation_key = case when event_type='message_received' then 'conversation'
    when event_type in ('account_warning','appeal_decided') then 'account_notice' else 'request_details' end);
alter table public.notifications drop constraint notifications_warning_privacy_check;
alter table public.notifications add constraint notifications_warning_privacy_check check (
  event_type not in ('account_warning','appeal_decided') or (actor_id is null and request_id is null and offer_id is null
    and conversation_id is null and message_id is null));

create function notifications_private.copy_appeal_decision(p_decision safety_private.appeal_decisions)
returns void language plpgsql security definer set search_path='' as $$
declare recipient uuid;
begin
  select appellant_id into recipient from safety_private.appeals where id=p_decision.appeal_id;
  if recipient is null then return; end if;
  insert into public.notifications(recipient_id,event_type,title,body,navigation_key,source_event_key,created_at)
  values(recipient,'appeal_decided',
    case when p_decision.outcome='overturned' then 'Appeal decided: decision overturned' else 'Appeal decided: decision upheld' end,
    case when p_decision.outcome='overturned' then 'The original decision was overturned.' else 'The original decision was upheld.' end
      ||' Open Account decisions & appeals to see the admin response and your current warning count.',
    'account_notice','moderation-appeal:'||p_decision.id::text,p_decision.created_at)
  on conflict(recipient_id,source_event_key) do nothing;
end $$;
revoke all on function notifications_private.copy_appeal_decision(safety_private.appeal_decisions)
  from public,anon,authenticated,service_role;
create function notifications_private.appeal_decision_event() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform notifications_private.copy_appeal_decision(new);
  return new;
end $$;
revoke all on function notifications_private.appeal_decision_event() from public,anon,authenticated,service_role;
create trigger moderation_appeal_decision_notification after insert on safety_private.appeal_decisions
for each row execute function notifications_private.appeal_decision_event();

-- Older decisions also receive their missing notice. Existing read states remain unchanged.
-- These account notices are bell-only: they do not map to a push delivery category.
select notifications_private.copy_appeal_decision(d) from safety_private.appeal_decisions d;
create or replace function public.get_my_notifications(p_limit integer default 20,
  p_before_created_at timestamptz default null,p_before_id uuid default null)
returns table(id uuid,recipient_id uuid,actor_id uuid,event_type text,title text,body text,
  request_id uuid,offer_id uuid,conversation_id uuid,message_id uuid,navigation_key text,read_at timestamptz,created_at timestamptz)
language plpgsql stable security invoker set search_path='' as $$
declare v_user uuid;
begin
  perform safety_private.check_account_access();
  v_user:=notifications_private.require_actor();
  if p_limit is null or p_limit<1 or p_limit>50
    or ((p_before_created_at is null)<>(p_before_id is null))
    or (p_before_created_at is not null and not isfinite(p_before_created_at)) then
    raise exception 'Invalid notification page' using errcode='22023';
  end if;
  return query select n.id,n.recipient_id,n.actor_id,n.event_type,n.title,n.body,
    n.request_id,n.offer_id,n.conversation_id,n.message_id,n.navigation_key,n.read_at,n.created_at
  from public.notifications n where n.recipient_id=v_user and n.event_type not in ('account_warning','appeal_decided')
    and (p_before_created_at is null or (n.created_at,n.id)<(p_before_created_at,p_before_id))
  order by n.created_at desc,n.id desc limit p_limit;
end $$;
create or replace function public.get_my_notification_unread_count() returns integer
language plpgsql stable security invoker set search_path='' as $$
declare v_user uuid; v_count integer;
begin
  perform safety_private.check_account_access();
  v_user:=notifications_private.require_actor();
  select count(*)::integer into v_count from public.notifications notice
    where notice.recipient_id=v_user and notice.read_at is null and notice.event_type not in ('account_warning','appeal_decided');
  return v_count;
end $$;
create or replace function notifications_private.mark_all_read() returns integer
language plpgsql security definer set search_path='' as $$
declare v_user uuid; v_count integer;
begin
  perform safety_private.check_account_access();
  v_user:=notifications_private.require_actor();
  update public.notifications notice set read_at=clock_timestamp()
    where notice.recipient_id=v_user and notice.read_at is null and notice.event_type not in ('account_warning','appeal_decided');
  get diagnostics v_count=row_count;
  return v_count;
end $$;
create or replace function public.mark_all_my_notifications_read() returns integer
language plpgsql security invoker set search_path='' as $$
begin
  perform safety_private.check_account_access();
  return notifications_private.mark_all_read();
end $$;
revoke all on function public.get_my_notifications(integer,timestamptz,uuid),
  public.get_my_notification_unread_count(),public.mark_all_my_notifications_read(),
  notifications_private.mark_all_read() from public,anon,authenticated,service_role;
grant execute on function public.get_my_notifications(integer,timestamptz,uuid),
  public.get_my_notification_unread_count(),public.mark_all_my_notifications_read(),
  notifications_private.mark_all_read() to authenticated;

create or replace function public.get_my_notifications_v2(p_limit integer default 20,
  p_before_created_at timestamptz default null,p_before_id uuid default null)
returns table(id uuid,recipient_id uuid,actor_id uuid,event_type text,title text,body text,
  request_id uuid,offer_id uuid,conversation_id uuid,message_id uuid,navigation_key text,read_at timestamptz,created_at timestamptz)
language plpgsql stable security invoker set search_path='' as $$
declare v_user uuid;
begin
  perform safety_private.check_account_access();
  v_user:=notifications_private.require_actor();
  if p_limit is null or p_limit<1 or p_limit>50
    or ((p_before_created_at is null)<>(p_before_id is null))
    or (p_before_created_at is not null and not isfinite(p_before_created_at)) then
    raise exception 'Invalid notification page' using errcode='22023';
  end if;
  return query select n.id,n.recipient_id,n.actor_id,n.event_type,n.title,n.body,
    n.request_id,n.offer_id,n.conversation_id,n.message_id,n.navigation_key,n.read_at,n.created_at
  from public.notifications n where n.recipient_id=v_user and n.event_type<>'appeal_decided'
    and (p_before_created_at is null or (n.created_at,n.id)<(p_before_created_at,p_before_id))
  order by n.created_at desc,n.id desc limit p_limit;
end $$;
create or replace function public.get_my_notification_unread_count_v2() returns integer
language plpgsql stable security invoker set search_path='' as $$
declare v_user uuid; v_count integer;
begin
  perform safety_private.check_account_access();
  v_user:=notifications_private.require_actor();
  select count(*)::integer into v_count from public.notifications notice
    where notice.recipient_id=v_user and notice.read_at is null and notice.event_type<>'appeal_decided';
  return v_count;
end $$;
create or replace function notifications_private.mark_all_read_v2() returns integer
language plpgsql security definer set search_path='' as $$
declare v_user uuid; v_count integer;
begin
  perform safety_private.check_account_access();
  v_user:=notifications_private.require_actor();
  update public.notifications notice set read_at=clock_timestamp()
    where notice.recipient_id=v_user and notice.read_at is null and notice.event_type<>'appeal_decided';
  get diagnostics v_count=row_count;
  return v_count;
end $$;
create or replace function public.mark_all_my_notifications_read_v2() returns integer
language plpgsql security invoker set search_path='' as $$
begin
  perform safety_private.check_account_access();
  return notifications_private.mark_all_read_v2();
end $$;
revoke all on function public.get_my_notifications_v2(integer,timestamptz,uuid),
  public.get_my_notification_unread_count_v2(),public.mark_all_my_notifications_read_v2(),
  notifications_private.mark_all_read_v2() from public,anon,authenticated,service_role;
grant execute on function public.get_my_notifications_v2(integer,timestamptz,uuid),
  public.get_my_notification_unread_count_v2(),public.mark_all_my_notifications_read_v2(),
  notifications_private.mark_all_read_v2() to authenticated;

create function notifications_private.require_current_actor() returns uuid
language plpgsql security definer set search_path='' as $$
begin
  perform safety_private.require_appeal_actor();
  return notifications_private.require_actor();
end $$;
revoke all on function notifications_private.require_current_actor() from public,anon,authenticated,service_role;
grant execute on function notifications_private.require_current_actor() to authenticated;
create or replace function public.get_my_notifications_v3(p_limit integer default 20,
  p_before_created_at timestamptz default null,p_before_id uuid default null)
returns table(id uuid,recipient_id uuid,actor_id uuid,event_type text,title text,body text,
  request_id uuid,offer_id uuid,conversation_id uuid,message_id uuid,navigation_key text,read_at timestamptz,created_at timestamptz)
language plpgsql security invoker set search_path='' as $$
declare v_user uuid;
begin
  perform safety_private.check_account_access();
  v_user:=notifications_private.require_current_actor();
  if p_limit is null or p_limit<1 or p_limit>50
    or ((p_before_created_at is null)<>(p_before_id is null))
    or (p_before_created_at is not null and not isfinite(p_before_created_at)) then
    raise exception 'Invalid notification page' using errcode='22023';
  end if;
  return query select n.id,n.recipient_id,n.actor_id,n.event_type,n.title,n.body,
    n.request_id,n.offer_id,n.conversation_id,n.message_id,n.navigation_key,n.read_at,n.created_at
  from public.notifications n where n.recipient_id=v_user
    and (p_before_created_at is null or (n.created_at,n.id)<(p_before_created_at,p_before_id))
  order by n.created_at desc,n.id desc limit p_limit;
end $$;
create or replace function public.get_my_notification_unread_count_v3() returns integer
language plpgsql security invoker set search_path='' as $$
declare v_user uuid; v_count integer;
begin
  perform safety_private.check_account_access();
  v_user:=notifications_private.require_current_actor();
  select count(*)::integer into v_count from public.notifications notice
    where notice.recipient_id=v_user and notice.read_at is null;
  return v_count;
end $$;
create or replace function notifications_private.mark_all_read_v3() returns integer
language plpgsql security definer set search_path='' as $$
declare v_user uuid; v_count integer;
begin
  perform safety_private.check_account_access();
  v_user:=notifications_private.require_current_actor();
  update public.notifications notice set read_at=clock_timestamp()
    where notice.recipient_id=v_user and notice.read_at is null;
  get diagnostics v_count=row_count;
  return v_count;
end $$;
create or replace function public.mark_all_my_notifications_read_v3() returns integer
language plpgsql security invoker set search_path='' as $$
begin
  perform safety_private.check_account_access();
  return notifications_private.mark_all_read_v3();
end $$;
revoke all on function public.get_my_notifications_v3(integer,timestamptz,uuid),
  public.get_my_notification_unread_count_v3(),public.mark_all_my_notifications_read_v3(),
  notifications_private.mark_all_read_v3() from public,anon,authenticated,service_role;
grant execute on function public.get_my_notifications_v3(integer,timestamptz,uuid),
  public.get_my_notification_unread_count_v3(),public.mark_all_my_notifications_read_v3(),
  notifications_private.mark_all_read_v3() to authenticated;

notify pgrst, 'reload schema';
commit;
