-- Account preferences control external delivery only. The inbox always records its events.
create table notifications_private.push_preferences (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  push_enabled boolean not null default false,
  messages boolean not null default true,
  offers boolean not null default true,
  request_updates boolean not null default true
);
create table notifications_private.android_push_devices (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  expo_token text not null unique check (length(expo_token) <= 200 and expo_token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$')
);
create index android_push_devices_profile on notifications_private.android_push_devices(profile_id);
alter table notifications_private.push_preferences enable row level security;
alter table notifications_private.android_push_devices enable row level security;
revoke all on notifications_private.push_preferences, notifications_private.android_push_devices from public, anon, authenticated;

create function notifications_private.push_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := notifications_private.require_actor();
begin
  return (select jsonb_build_object(
    'push_enabled', coalesce(p.push_enabled,false), 'messages', coalesce(p.messages,true),
    'offers', coalesce(p.offers,true), 'request_updates', coalesce(p.request_updates,true),
    'registered', exists(select 1 from notifications_private.android_push_devices d
      where d.profile_id = actor and d.session_id = (auth.jwt()->>'session_id')::uuid))
    from (values (actor)) as a(id) left join notifications_private.push_preferences p on p.profile_id = a.id);
end $$;

create function notifications_private.set_push_preference(p_name text, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := notifications_private.require_actor();
begin
  if p_name is null or p_name not in ('push_enabled','messages','offers','request_updates') or p_enabled is null then
    raise exception 'Invalid preference' using errcode='22023';
  end if;
  insert into notifications_private.push_preferences(profile_id) values(actor) on conflict do nothing;
  update notifications_private.push_preferences set
    push_enabled = case when p_name='push_enabled' then p_enabled else push_enabled end,
    messages = case when p_name='messages' then p_enabled else messages end,
    offers = case when p_name='offers' then p_enabled else offers end,
    request_updates = case when p_name='request_updates' then p_enabled else request_updates end
  where profile_id=actor;
  return notifications_private.push_settings();
end $$;

create function notifications_private.set_android_push_device(p_token text, p_existing_only boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := notifications_private.require_actor();
  sid uuid := (auth.jwt()->>'session_id')::uuid;
begin
  if not exists(select 1 from auth.sessions s where s.id=sid and s.user_id=actor
    and (s.not_after is null or s.not_after>now())) then
    raise exception 'Sign in again' using errcode='42501';
  end if;
  if p_token is null then
    delete from notifications_private.android_push_devices where session_id=sid and profile_id=actor;
  else
    -- The same installation can sign into a new account. Serialize competing claims for its token.
    perform pg_advisory_xact_lock(hashtextextended(p_token, 0));
    if p_existing_only then
      perform 1 from notifications_private.android_push_devices where session_id=sid and profile_id=actor for update;
      if not found then return notifications_private.push_settings(); end if;
    end if;
    if exists (select 1 from notifications_private.android_push_devices d
      join auth.sessions old_session on old_session.id=d.session_id
      join auth.sessions current_session on current_session.id=sid
      where d.expo_token=p_token and d.session_id<>sid and old_session.created_at>current_session.created_at) then
      raise exception 'A newer session registered this device' using errcode='42501';
    end if;
    delete from notifications_private.android_push_devices where expo_token=p_token and session_id<>sid;
    insert into notifications_private.android_push_devices(session_id,profile_id,expo_token)
    values(sid,actor,p_token) on conflict(session_id) do update set expo_token=excluded.expo_token;
  end if;
  return notifications_private.push_settings();
end $$;

create function public.get_my_push_settings() returns jsonb
language sql stable security invoker set search_path='' as $$ select notifications_private.push_settings() $$;
create function public.set_my_push_preference(p_name text,p_enabled boolean) returns jsonb
language sql security invoker set search_path='' as $$ select notifications_private.set_push_preference(p_name,p_enabled) $$;
create function public.set_my_android_push_device(p_token text) returns jsonb
language sql security invoker set search_path='' as $$ select notifications_private.set_android_push_device(p_token) $$;

create function public.refresh_my_android_push_device(p_token text) returns jsonb
language sql security invoker set search_path='' as $$ select notifications_private.set_android_push_device(p_token,true) $$;
revoke all on function notifications_private.push_settings(),notifications_private.set_push_preference(text,boolean),
  notifications_private.set_android_push_device(text,boolean),public.get_my_push_settings(),
  public.set_my_push_preference(text,boolean),public.set_my_android_push_device(text),public.refresh_my_android_push_device(text) from public,anon,authenticated;
grant execute on function notifications_private.push_settings(),notifications_private.set_push_preference(text,boolean),
  notifications_private.set_android_push_device(text,boolean),public.get_my_push_settings(),
  public.set_my_push_preference(text,boolean),public.set_my_android_push_device(text),public.refresh_my_android_push_device(text) to authenticated;

-- One delivery per installation and notification. Only the trusted worker can claim deliveries.
create function notifications_private.push_category(p_event text) returns text
language sql immutable set search_path='' as $$
  select case when p_event='message_received' then 'messages'
    when p_event in ('offer_created','offer_accepted','offer_rejected','offer_withdrawn','another_helper_selected') then 'offers'
    when p_event in ('request_cancelled','request_expired','request_reopened','request_completed') then 'request_updates' end
$$;
revoke all on function notifications_private.push_category(text) from public,anon,authenticated;
create table notifications_private.push_jobs (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  session_id uuid not null references notifications_private.android_push_devices(session_id) on delete cascade,
  ticket text,
  ticket_token text,
  attempts integer not null default 0,
  due_at timestamptz not null default now(),
  lease uuid,
  unique(notification_id,session_id)
);
create index push_jobs_due on notifications_private.push_jobs(due_at);
create index push_jobs_session on notifications_private.push_jobs(session_id);
alter table notifications_private.push_jobs enable row level security;
revoke all on notifications_private.push_jobs from public,anon,authenticated;

create view notifications_private.push_targets with (security_invoker=true) as
select n.id as notification_id, d.session_id, d.expo_token, notifications_private.push_category(n.event_type) as category
from public.notifications n
join notifications_private.push_preferences p on p.profile_id=n.recipient_id and p.push_enabled
join notifications_private.android_push_devices d on d.profile_id=n.recipient_id
join auth.sessions s on s.id=d.session_id and s.user_id=d.profile_id
join auth.users u on u.id=d.profile_id
where n.read_at is null and (s.not_after is null or s.not_after>now())
  and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
  and case notifications_private.push_category(n.event_type) when 'messages' then p.messages
    when 'offers' then p.offers when 'request_updates' then p.request_updates else false end;
revoke all on notifications_private.push_targets from public,anon,authenticated;
create function notifications_private.enqueue_push() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into notifications_private.push_jobs(notification_id,session_id)
  select new.id,t.session_id from notifications_private.push_targets t where t.notification_id=new.id
  on conflict do nothing;
  return new;
end $$;
revoke all on function notifications_private.enqueue_push() from public,anon,authenticated;
create trigger enqueue_android_push after insert on public.notifications for each row execute function notifications_private.enqueue_push();

create function public.claim_android_push_jobs()
returns table(job_id uuid, lease_id uuid, notification_id uuid, expo_token text, category text, ticket text)
language plpgsql security definer set search_path='' as $$
begin
  -- Bound job lifetime even if a provider, token or recipient stops being available.
  delete from notifications_private.push_jobs j using public.notifications n
  where n.id=j.notification_id and (n.created_at<now()-interval '24 hours'
    or (j.due_at<=now() and (j.attempts>=8 or not exists(
      select 1 from notifications_private.push_targets t where t.notification_id=j.notification_id and t.session_id=j.session_id))));
  return query with batch as (
    select j.id from notifications_private.push_jobs j where j.due_at<=now()
    order by j.due_at,j.id limit 20 for update skip locked
  ), claimed as (
    update notifications_private.push_jobs j set lease=gen_random_uuid(), attempts=j.attempts+1,
      due_at=now()+interval '3 minutes' from batch where j.id=batch.id returning j.*
  ) select j.id,j.lease,j.notification_id,coalesce(j.ticket_token,t.expo_token),t.category,j.ticket from claimed j
    join notifications_private.push_targets t on t.notification_id=j.notification_id and t.session_id=j.session_id;
end $$;

create function public.finish_android_push_job(p_id uuid,p_lease uuid,p_result text,p_ticket text,p_token text)
returns void language plpgsql security definer set search_path='' as $$
declare job notifications_private.push_jobs;
begin
  select * into job from notifications_private.push_jobs where id=p_id and lease=p_lease for update;
  if not found then return; end if;
  if p_result='ticket' and length(p_ticket) between 1 and 200 then
    update notifications_private.push_jobs set ticket=p_ticket,ticket_token=p_token,attempts=0,due_at=now()+interval '15 minutes',lease=null where id=p_id;
  elsif p_result='retry' then
    update notifications_private.push_jobs set due_at=now()+interval '1 minute'*least(30,power(2,attempts)),lease=null where id=p_id;
  elsif p_result in ('done','invalid_device','drop') then
    if p_result='invalid_device' then
      delete from notifications_private.android_push_devices where session_id=job.session_id and expo_token=p_token;
    end if;
    delete from notifications_private.push_jobs where id=p_id;
  else raise exception 'Invalid push result' using errcode='22023';
  end if;
end $$;
revoke all on function public.claim_android_push_jobs(),public.finish_android_push_job(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_android_push_jobs(),public.finish_android_push_job(uuid,uuid,text,text,text) to service_role;

-- Route a tap using only a notice visible to this account, never a route from the OS payload.
create function public.open_my_push_notification(p_notification_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  perform public.mark_my_notification_read(p_notification_id);
  select to_jsonb(n) into result from public.notifications n where n.id=p_notification_id;
  return result - 'source_event_key';
end $$;
revoke all on function public.open_my_push_notification(uuid) from public,anon,authenticated;
grant execute on function public.open_my_push_notification(uuid) to authenticated;
