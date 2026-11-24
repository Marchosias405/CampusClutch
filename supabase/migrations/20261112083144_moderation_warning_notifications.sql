-- Formal warnings are private bell-inbox notices, not acknowledgement gates.
-- Keep the original notification RPCs compatible with older installed APKs.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
alter table public.notifications drop constraint notifications_event_type_check;
alter table public.notifications add constraint notifications_event_type_check check(event_type in (
  'offer_created','offer_accepted','offer_rejected','offer_withdrawn','another_helper_selected',
  'request_cancelled','request_expired','request_reopened','request_completed','message_received','account_warning'));
alter table public.notifications drop constraint notifications_navigation_key_check;
alter table public.notifications add constraint notifications_navigation_key_check
  check(navigation_key in ('request_details','conversation','account_notice'));
alter table public.notifications drop constraint notifications_check1;
alter table public.notifications add constraint notifications_destination_check check (
  navigation_key = case event_type when 'message_received' then 'conversation'
    when 'account_warning' then 'account_notice' else 'request_details' end);
alter table public.notifications drop constraint notifications_body_check;
alter table public.notifications add constraint notifications_body_check
  check(char_length(body) between 1 and case when event_type='account_warning' then 2200 else 500 end);
alter table public.notifications add constraint notifications_warning_privacy_check check (
  event_type<>'account_warning' or (actor_id is null and request_id is null and offer_id is null
    and conversation_id is null and message_id is null));

create function notifications_private.copy_warning(p_action safety_private.enforcement_actions, p_read_at timestamptz default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_action.kind<>'warn' or p_action.subject_id is null then return; end if;
  insert into public.notifications(recipient_id,event_type,title,body,navigation_key,source_event_key,created_at,read_at)
  values(p_action.subject_id,'account_warning','Formal warning',
    'Warning '||p_action.warning_count::text||E'\n\n'||p_action.reason||E'\n\n'||
    case when p_action.automatic_suspension then 'This warning triggered a 7-day suspension.'
      else (p_action.warning_count%3)::text||'/3 warnings in this cycle. Every third warning triggers a 7-day suspension.' end,
    'account_notice','moderation-warning:'||p_action.id::text,p_action.created_at,p_read_at)
  on conflict(recipient_id,source_event_key) do nothing;
end $$;
revoke all on function notifications_private.copy_warning(safety_private.enforcement_actions,timestamptz)
  from public,anon,authenticated,service_role;
create function notifications_private.warning_event() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform notifications_private.copy_warning(new);
  return new;
end $$;
revoke all on function notifications_private.warning_event() from public,anon,authenticated,service_role;
create trigger moderation_warning_notification after insert on safety_private.enforcement_actions
for each row when (new.kind='warn') execute function notifications_private.warning_event();

-- Retain previously issued warnings, and preserve an earlier acknowledgement as read.
-- The source lock taken by CREATE TRIGGER prevents a gap between backfill and new actions.
select notifications_private.copy_warning(a,case when a.created_at<=s.acknowledged_at then s.acknowledged_at end)
from safety_private.enforcement_actions a left join safety_private.account_standing s on s.profile_id=a.subject_id
where a.kind='warn' and a.subject_id is not null;

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
  from public.notifications n where n.recipient_id=v_user and n.event_type<>'account_warning'
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
    where notice.recipient_id=v_user and notice.read_at is null and notice.event_type<>'account_warning';
  return v_count;
end $$;
create or replace function notifications_private.mark_all_read() returns integer
language plpgsql security definer set search_path='' as $$
declare v_user uuid; v_count integer;
begin
  perform safety_private.check_account_access();
  v_user:=notifications_private.require_actor();
  update public.notifications notice set read_at=clock_timestamp()
    where notice.recipient_id=v_user and notice.read_at is null and notice.event_type<>'account_warning';
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
  from public.notifications n where n.recipient_id=v_user
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
    where notice.recipient_id=v_user and notice.read_at is null;
  return v_count;
end $$;
create or replace function notifications_private.mark_all_read_v2() returns integer
language plpgsql security definer set search_path='' as $$
declare v_user uuid; v_count integer;
begin
  perform safety_private.check_account_access();
  v_user:=notifications_private.require_actor();
  update public.notifications notice set read_at=clock_timestamp()
    where notice.recipient_id=v_user and notice.read_at is null;
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

create or replace function safety_private.my_account_standing() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); standing safety_private.account_standing; notices jsonb;
begin
  if actor is null or not exists(select 1 from auth.users where id=actor and deleted_at is null) then
    raise exception using errcode='42501',message='Sign in to view your account status.';
  end if;
  select * into standing from safety_private.account_standing where profile_id=actor;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'reason',reason,'created_at',created_at,
    'automatic_suspension',automatic_suspension) order by created_at desc),'[]'::jsonb) into notices
    from (select * from safety_private.enforcement_actions where subject_id=actor
      and (kind<>'warn' or standing.suspended_until>now())
      and created_at>coalesce(standing.acknowledged_at,'-infinity') order by created_at desc limit 20) n;
  return jsonb_build_object('warning_count',coalesce(standing.warning_count,0),
    'suspended_until',standing.suspended_until,'suspended',coalesce(standing.suspended_until>now(),false),
    'notices',notices);
end;
$$;

notify pgrst, 'reload schema';
commit;
