-- Owner-operated staff recovery. No app role or API key can invoke these helpers.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table safety_private.staff_recovery_events (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  profile_id uuid references public.profiles(id) on delete set null,
  subject_id uuid not null,
  kind text not null check(kind in ('restore_access','review_appeal')),
  reason text not null check(reason=btrim(reason) and char_length(reason) between 10 and 2000),
  database_actor text not null,
  payload_hash bytea not null check(octet_length(payload_hash)=32),
  before_state jsonb not null,
  after_state jsonb not null,
  receipt jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index staff_recovery_events_profile_idx on safety_private.staff_recovery_events(profile_id);
alter table safety_private.staff_recovery_events enable row level security;
revoke all on safety_private.staff_recovery_events from public,anon,authenticated,service_role;

-- Distinguish a database-owner decision from a decision whose admin was deleted.
alter table safety_private.appeal_decisions add column database_actor text;

create function safety_private.staff_recovery_snapshot(p_profile_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('role',(select to_jsonb(r) from safety_private.staff_roles r where r.profile_id=p_profile_id),
    'standing',(select to_jsonb(s) from safety_private.account_standing s where s.profile_id=p_profile_id));
$$;
revoke all on function safety_private.staff_recovery_snapshot(uuid) from public,anon,authenticated,service_role;

create function safety_private.owner_restore_staff_access(p_profile_id uuid,p_operation_id uuid,
  p_expected_role_updated_at timestamptz,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare prior safety_private.staff_recovery_events; staff safety_private.staff_roles;
  fingerprint bytea; before_state jsonb; result jsonb; removed_sessions integer;
begin
  if p_profile_id is null or p_operation_id is null or p_expected_role_updated_at is null
    or not isfinite(p_expected_role_updated_at) or p_reason is null or char_length(btrim(p_reason)) not between 10 and 2000 then
    raise exception using errcode='22023',message='Invalid staff recovery.';
  end if;
  fingerprint:=extensions.digest(convert_to(jsonb_build_array('restore_access',p_profile_id,
    extract(epoch from p_expected_role_updated_at),btrim(p_reason))::text,'UTF8'),'sha256');
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,1458));
  select * into prior from safety_private.staff_recovery_events where operation_id=p_operation_id;
  if found then
    if prior.payload_hash<>fingerprint then raise exception using errcode='22023',message='Recovery retry does not match.'; end if;
    return prior.receipt;
  end if;

  -- Lock Auth before sessions, then profile and role. Staff requests lock their
  -- session before their role. Do not invert that order during recovery.
  perform 1 from auth.users where id=p_profile_id and deleted_at is null and email_confirmed_at is not null
    and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=clock_timestamp()) for update;
  if not found then raise exception using errcode='42501',message='A verified, eligible account is required.'; end if;
  delete from auth.sessions where user_id=p_profile_id;
  get diagnostics removed_sessions=row_count;
  perform 1 from public.profiles where id=p_profile_id and onboarding_completed_at is not null
    and nullif(btrim(display_name),'') is not null for no key update;
  if not found then raise exception using errcode='42501',message='Complete the staff profile before recovery.'; end if;
  select * into staff from safety_private.staff_roles where profile_id=p_profile_id for update;
  if not found then raise exception using errcode='42501',message='Recovery requires a previously assigned staff role.'; end if;
  if staff.updated_at<>p_expected_role_updated_at then
    raise exception using errcode='PT409',message='The staff role changed. Inspect it again before recovery.';
  end if;
  if exists(select 1 from safety_private.account_standing where profile_id=p_profile_id and suspended_until>clock_timestamp()) then
    raise exception using errcode='42501',message='Resolve the staff suspension before restoring access.';
  end if;
  before_state:=safety_private.staff_recovery_snapshot(p_profile_id);
  -- No role parameter: a moderator cannot become an admin through recovery.
  perform safety_private.assign_staff_role(p_profile_id,staff.role,true,btrim(p_reason));
  result:=jsonb_build_object('operation_id',p_operation_id,'role',staff.role,'sessions_revoked',removed_sessions,
    'requires_sign_in',true);
  insert into safety_private.staff_recovery_events(operation_id,profile_id,subject_id,kind,reason,database_actor,
    payload_hash,before_state,after_state,receipt)
  values(p_operation_id,p_profile_id,p_profile_id,'restore_access',btrim(p_reason),current_user,fingerprint,
    before_state,safety_private.staff_recovery_snapshot(p_profile_id),result);
  return result;
end $$;
revoke all on function safety_private.owner_restore_staff_access(uuid,uuid,timestamptz,text)
  from public,anon,authenticated,service_role;

create function safety_private.owner_review_staff_appeal(p_appeal_id uuid,p_operation_id uuid,
  p_expected_version integer,p_expected_role_updated_at timestamptz,p_outcome text,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare prior safety_private.staff_recovery_events; ap safety_private.appeals; action safety_private.enforcement_actions;
  report safety_private.reports; staff safety_private.staff_roles; decision safety_private.appeal_decisions;
  fingerprint bytea; before_state jsonb; result jsonb; expiry timestamptz;
  effect text:='The original decision remains in effect.';
begin
  if p_appeal_id is null or p_operation_id is null or p_expected_version is null or p_expected_version<0
    or p_expected_role_updated_at is null or not isfinite(p_expected_role_updated_at)
    or p_outcome is null or p_outcome not in ('upheld','overturned')
    or p_reason is null or char_length(btrim(p_reason)) not between 10 and 2000 then
    raise exception using errcode='22023',message='Invalid owner appeal decision.';
  end if;
  fingerprint:=extensions.digest(convert_to(jsonb_build_array('review_appeal',p_appeal_id,p_expected_version,
    extract(epoch from p_expected_role_updated_at),p_outcome,btrim(p_reason))::text,'UTF8'),'sha256');
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,1458));
  select * into prior from safety_private.staff_recovery_events where operation_id=p_operation_id;
  if found then
    if prior.payload_hash<>fingerprint then raise exception using errcode='22023',message='Recovery retry does not match.'; end if;
    return prior.receipt;
  end if;
  select * into ap from safety_private.appeals where id=p_appeal_id;
  select * into action from safety_private.enforcement_actions where id=ap.action_id;
  select * into report from safety_private.reports where id=action.report_id for update;
  if not found or action.subject_id is null or ap.appellant_id is distinct from action.subject_id then
    raise exception using errcode='42501',message='Staff appeal unavailable.';
  end if;
  -- Match the existing enforcement/appeal lock order. This also serializes role
  -- changes and different appeals for one account without locking FK readers.
  perform 1 from public.profiles where id=action.subject_id for no key update;
  select * into staff from safety_private.staff_roles where profile_id=action.subject_id for update;
  if not found then raise exception using errcode='42501',message='This account has no assigned staff role.'; end if;
  if staff.updated_at<>p_expected_role_updated_at then
    raise exception using errcode='PT409',message='The staff role changed. Inspect it again before deciding.';
  end if;
  select * into ap from safety_private.appeals where id=p_appeal_id for update;
  if ap.status<>'pending' or ap.version<>p_expected_version then
    raise exception using errcode='PT409',message='This appeal changed. Reload before deciding.';
  end if;
  select * into action from safety_private.enforcement_actions where id=ap.action_id for update;
  if action.kind not in ('warn','suspend_7_days') or action.revoked_at is not null then
    raise exception using errcode='22023',message='Recovery reviews only active warning or suspension decisions.';
  end if;
  before_state:=safety_private.staff_recovery_snapshot(action.subject_id);
  if p_outcome='overturned' then
    update safety_private.enforcement_actions set revoked_at=clock_timestamp() where id=action.id;
    -- Same accounting as normal appeals: remove only this decision and any
    -- automatic suspension based on it. Other sanctions keep their own expiry.
    select max(a.created_at+interval '7 days') into expiry from safety_private.enforcement_actions a
      where a.subject_id=action.subject_id and a.revoked_at is null and (a.kind='suspend_7_days' or
        (a.automatic_suspension and cardinality(a.warning_basis)=3 and not exists(
          select 1 from unnest(a.warning_basis) b(id) left join safety_private.enforcement_actions w on w.id=b.id
          where w.id is null or w.revoked_at is not null)));
    update safety_private.account_standing s set warning_count=(select count(*) from safety_private.enforcement_actions
      where subject_id=s.profile_id and kind='warn' and revoked_at is null),suspended_until=expiry
      where s.profile_id=action.subject_id;
    effect:=case when action.kind='warn' then 'This warning no longer counts. Any suspension caused by its three-warning cycle is removed.'
      else 'This seven-day suspension is removed.' end||' Other valid actions remain in effect.';
  end if;
  insert into safety_private.appeal_decisions(appeal_id,admin_id,operation_id,payload_hash,outcome,reason,effect,database_actor)
    values(ap.id,null,p_operation_id,fingerprint,p_outcome,btrim(p_reason),effect,current_user) returning * into decision;
  update safety_private.appeals set status=p_outcome,version=version+1 where id=ap.id;
  update safety_private.reports set triage_version=triage_version+1 where id=report.id;
  if p_outcome='overturned' and action.kind='warn' then
    update public.notifications set title='Warning overturned',
      body=E'This warning was overturned on appeal. It no longer counts.\n\nOriginal reason: '||action.reason,
      read_at=null where recipient_id=action.subject_id and source_event_key='moderation-warning:'||action.id::text;
  end if;
  result:=jsonb_build_object('id',decision.id,'outcome',decision.outcome,'effect',decision.effect);
  insert into safety_private.staff_recovery_events(operation_id,profile_id,subject_id,kind,reason,database_actor,
    payload_hash,before_state,after_state,receipt)
  values(p_operation_id,action.subject_id,action.subject_id,'review_appeal',btrim(p_reason),current_user,fingerprint,
    before_state,safety_private.staff_recovery_snapshot(action.subject_id),result);
  return result;
end $$;
revoke all on function safety_private.owner_review_staff_appeal(uuid,uuid,integer,timestamptz,text,text)
  from public,anon,authenticated,service_role;
commit;
