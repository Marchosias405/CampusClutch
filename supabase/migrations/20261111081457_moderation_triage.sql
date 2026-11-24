-- Task 14: privileged report triage foundation. No real users are assigned roles.
-- These roles never come from user_metadata or stale JWT role claims.
create table safety_private.staff_roles (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null check (role in ('admin', 'moderator')),
  enabled boolean not null default true,
  updated_at timestamptz not null default clock_timestamp()
);
create table safety_private.staff_role_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  role text not null check (role in ('admin', 'moderator')),
  enabled boolean not null,
  reason text not null check (char_length(reason) between 10 and 2000),
  database_actor text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index staff_role_events_profile_idx on safety_private.staff_role_events(profile_id);
alter table safety_private.reports
  add column triage_status text not null default 'new'
    check (triage_status in ('new', 'reviewing', 'dismissed', 'escalated')),
  add column triage_version integer not null default 0 check (triage_version >= 0);
create index safety_reports_triage_idx on safety_private.reports(triage_status, created_at desc, id desc);
create table safety_private.report_decisions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references safety_private.reports(id),
  moderator_id uuid references public.profiles(id) on delete set null,
  operation_id uuid not null,
  payload_hash bytea not null check (octet_length(payload_hash) = 32),
  from_status text not null,
  to_status text not null check (to_status in ('new', 'reviewing', 'dismissed', 'escalated')),
  version integer not null check (version > 0),
  note text not null check (note = btrim(note) and char_length(note) between 10 and 2000),
  created_at timestamptz not null default clock_timestamp(),
  unique(moderator_id, operation_id),
  unique(report_id, version)
);
create table safety_private.report_views (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references safety_private.reports(id),
  moderator_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp()
);
create index report_views_report_idx on safety_private.report_views(report_id);
create index report_views_moderator_idx on safety_private.report_views(moderator_id);
alter table safety_private.staff_roles enable row level security;
alter table safety_private.staff_role_events enable row level security;
alter table safety_private.report_decisions enable row level security;
alter table safety_private.report_views enable row level security;
revoke all on safety_private.staff_roles, safety_private.staff_role_events,
  safety_private.report_decisions, safety_private.report_views from public, anon, authenticated, service_role;

-- Database-owner-only provisioning; the client cannot assign even its own role.
create function safety_private.assign_staff_role(p_profile_id uuid, p_role text, p_enabled boolean, p_reason text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_profile_id is null or p_role is null or p_role not in ('admin','moderator') or p_enabled is null
    or p_reason is null or char_length(btrim(p_reason)) not between 10 and 2000 then
    raise exception using errcode='22023', message='Invalid staff role assignment.';
  end if;
  insert into safety_private.staff_roles(profile_id, role, enabled)
    values(p_profile_id,p_role,p_enabled)
    on conflict(profile_id) do update set role=excluded.role, enabled=excluded.enabled, updated_at=clock_timestamp();
  insert into safety_private.staff_role_events(profile_id,role,enabled,reason,database_actor)
    values(p_profile_id,p_role,p_enabled,btrim(p_reason),current_user);
end;
$$;
revoke all on function safety_private.assign_staff_role(uuid,text,boolean,text) from public,anon,authenticated,service_role;

create function safety_private.require_staff() returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := safety_private.require_actor();
begin
  -- A deleted/revoked session must not retain privileged access until JWT expiry.
  perform 1 from auth.sessions s where s.user_id=v_actor
    and s.id::text=auth.jwt()->>'session_id'
    and (s.not_after is null or s.not_after>clock_timestamp()) for share;
  if not found then
    raise exception using errcode='42501',message='Moderation access is unavailable.';
  end if;
  -- Lock the live role until this request commits; revocation serializes with it.
  perform 1 from safety_private.staff_roles where profile_id=v_actor and enabled for share;
  if not found then
    raise exception using errcode='42501',message='Moderation access is unavailable.';
  end if;
  return v_actor;
end;
$$;
revoke all on function safety_private.require_staff() from public,anon,authenticated,service_role;

create function safety_private.moderation_access() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;
begin
  v_actor:=safety_private.require_staff();
  return jsonb_build_object('role',(select role from safety_private.staff_roles where profile_id=v_actor));
exception when insufficient_privilege then return jsonb_build_object('role',null);
end;
$$;

create function safety_private.moderation_queue(p_status text, p_before_created_at timestamptz, p_before_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=safety_private.require_staff(); v_result jsonb;
begin
  if p_status is null or p_status not in ('new','reviewing','dismissed','escalated')
    or ((p_before_created_at is null) <> (p_before_id is null)) then
    raise exception using errcode='22023',message='Invalid report queue filter.';
  end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by created_at desc,report_id desc),'[]'::jsonb) into v_result from (
    select id as report_id,target_type,reason,created_at,triage_status,triage_version
    from safety_private.reports
    where triage_status=p_status and reporter_id is distinct from v_actor and reported_profile_id is distinct from v_actor
      and (p_before_id is null or (created_at,id)<(p_before_created_at,p_before_id))
    order by created_at desc,id desc limit 20
  ) q;
  return v_result;
end;
$$;

create function safety_private.moderation_detail(p_report_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=safety_private.require_staff(); v_report safety_private.reports%rowtype; v_history jsonb;
begin
  select * into v_report from safety_private.reports where id=p_report_id
    and reporter_id is distinct from v_actor and reported_profile_id is distinct from v_actor for share;
  if not found then raise exception using errcode='42501',message='This report is unavailable for moderation.'; end if;
  insert into safety_private.report_views(report_id,moderator_id) values(p_report_id,v_actor);
  select coalesce(jsonb_agg(jsonb_build_object('decision_id',id,'from_status',from_status,'to_status',to_status,
    'version',version,'note',note,'created_at',created_at,'is_mine',coalesce(moderator_id=v_actor,false)) order by version),'[]'::jsonb)
    into v_history from safety_private.report_decisions where report_id=p_report_id;
  return jsonb_build_object('report_id',v_report.id,'target_type',v_report.target_type,'reason',v_report.reason,
    'created_at',v_report.created_at,'details',v_report.details,'evidence',v_report.evidence,
    'triage_status',v_report.triage_status,'triage_version',v_report.triage_version,'history',v_history);
end;
$$;

create function safety_private.moderation_decide(p_report_id uuid,p_operation_id uuid,p_expected_version integer,p_status text,p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=safety_private.require_staff(); v_hash bytea; v_report safety_private.reports%rowtype;
  v_prior safety_private.report_decisions%rowtype; v_note text:=btrim(p_note);
begin
  if p_report_id is null or p_operation_id is null or p_expected_version is null or p_expected_version<0
    or p_status is null or p_status not in ('new','reviewing','dismissed','escalated')
    or v_note is null or char_length(v_note) not between 10 and 2000 then
    raise exception using errcode='22023',message='Choose a status and add a note between 10 and 2,000 characters.';
  end if;
  v_hash:=extensions.digest(jsonb_build_array(p_report_id,p_expected_version,p_status,v_note)::text,'sha256');
  perform pg_advisory_xact_lock(hashtextextended('moderation-decision:'||v_actor::text,0));
  select * into v_prior from safety_private.report_decisions where moderator_id=v_actor and operation_id=p_operation_id;
  if found then
    if v_prior.payload_hash<>v_hash then raise exception using errcode='22023',message='This saved decision has different details.'; end if;
    return jsonb_build_object('decision_id',v_prior.id,'report_id',v_prior.report_id,'triage_status',v_prior.to_status,
      'triage_version',v_prior.version,'created_at',v_prior.created_at);
  end if;
  select * into v_report from safety_private.reports where id=p_report_id
    and reporter_id is distinct from v_actor and reported_profile_id is distinct from v_actor for update;
  if not found then raise exception using errcode='42501',message='This report is unavailable for moderation.'; end if;
  if v_report.triage_version<>p_expected_version then
    raise exception using errcode='PT409',message='This report changed. Reload it before recording a new decision.';
  end if;
  if v_report.triage_status=p_status then raise exception using errcode='22023',message='Choose a different status.'; end if;
  insert into safety_private.report_decisions(report_id,moderator_id,operation_id,payload_hash,from_status,to_status,version,note)
    values(p_report_id,v_actor,p_operation_id,v_hash,v_report.triage_status,p_status,v_report.triage_version+1,v_note)
    returning * into v_prior;
  update safety_private.reports set triage_status=p_status,triage_version=v_prior.version where id=p_report_id;
  return jsonb_build_object('decision_id',v_prior.id,'report_id',v_prior.report_id,'triage_status',v_prior.to_status,
    'triage_version',v_prior.version,'created_at',v_prior.created_at);
end;
$$;

revoke all on function safety_private.moderation_access(),safety_private.moderation_queue(text,timestamptz,uuid),
  safety_private.moderation_detail(uuid),safety_private.moderation_decide(uuid,uuid,integer,text,text)
  from public,anon,authenticated,service_role;
grant execute on function safety_private.moderation_access(),safety_private.moderation_queue(text,timestamptz,uuid),
  safety_private.moderation_detail(uuid),safety_private.moderation_decide(uuid,uuid,integer,text,text) to authenticated;

create function public.get_my_moderation_access() returns jsonb
language sql security invoker set search_path='' as $$ select safety_private.moderation_access(); $$;
create function public.list_moderation_reports(p_status text default 'new', p_before_created_at timestamptz default null,p_before_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$ select safety_private.moderation_queue(p_status,p_before_created_at,p_before_id); $$;
create function public.get_moderation_report(p_report_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select safety_private.moderation_detail(p_report_id); $$;
create function public.record_moderation_decision(p_report_id uuid,p_operation_id uuid,p_expected_version integer,p_status text,p_note text)
returns jsonb language sql security invoker set search_path='' as $$ select safety_private.moderation_decide(p_report_id,p_operation_id,p_expected_version,p_status,p_note); $$;
revoke all on function public.get_my_moderation_access(),public.list_moderation_reports(text,timestamptz,uuid),
  public.get_moderation_report(uuid),public.record_moderation_decision(uuid,uuid,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_my_moderation_access(),public.list_moderation_reports(text,timestamptz,uuid),
  public.get_moderation_report(uuid),public.record_moderation_decision(uuid,uuid,integer,text,text) to authenticated;
comment on table safety_private.report_decisions is 'Append-only to app roles. Triage history only: no content removal, notifications, points changes or suspension. Owner-managed retention remains separate.';
