begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table safety_private.enforcement_actions add column revoked_at timestamptz;
alter table safety_private.enforcement_actions add column warning_basis uuid[] not null default '{}';
-- A suspension belongs to its own action, rather than the inherited maximum
-- expiry in an action receipt. Remember the three warnings that caused it.
update safety_private.enforcement_actions a set warning_basis=(
  select coalesce(array_agg(w.id order by w.created_at,w.id),'{}'::uuid[]) from (
    select b.id,b.created_at from safety_private.enforcement_actions b
    where b.subject_id=a.subject_id and b.kind='warn' and b.warning_count between a.warning_count-2 and a.warning_count
      and b.created_at<=a.created_at order by b.created_at desc,b.id desc limit 3
  ) w
) where a.automatic_suspension;
create function safety_private.capture_warning_basis() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.automatic_suspension then
    select coalesce(array_agg(id),'{}'::uuid[])||new.id into new.warning_basis from (
      select id from safety_private.enforcement_actions where subject_id=new.subject_id and kind='warn' and revoked_at is null
      order by created_at desc,id desc limit 2
    ) w;
  end if;
  return new;
end $$;
revoke all on function safety_private.capture_warning_basis() from public,anon,authenticated,service_role;
create trigger enforcement_warning_basis before insert on safety_private.enforcement_actions
for each row execute function safety_private.capture_warning_basis();

create table safety_private.appeals (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null unique references safety_private.enforcement_actions(id),
  appellant_id uuid references public.profiles(id) on delete set null,
  operation_id uuid not null,
  payload_hash bytea not null check(octet_length(payload_hash)=32),
  explanation text not null check(explanation=btrim(explanation) and char_length(explanation) between 10 and 2000),
  status text not null default 'pending' check(status in ('pending','upheld','overturned')),
  version integer not null default 0 check(version in (0,1)),
  created_at timestamptz not null default clock_timestamp(),
  unique(appellant_id,operation_id)
);
create index appeals_queue_idx on safety_private.appeals(status,created_at desc,id desc);
create index appeals_appellant_idx on safety_private.appeals(appellant_id);
create table safety_private.appeal_decisions (
  id uuid primary key default gen_random_uuid(),
  appeal_id uuid not null unique references safety_private.appeals(id),
  admin_id uuid references public.profiles(id) on delete set null,
  operation_id uuid not null,
  payload_hash bytea not null check(octet_length(payload_hash)=32),
  outcome text not null check(outcome in ('upheld','overturned')),
  reason text not null check(reason=btrim(reason) and char_length(reason) between 10 and 2000),
  effect text not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(admin_id,operation_id)
);
create index appeal_decisions_admin_idx on safety_private.appeal_decisions(admin_id);
create table safety_private.appeal_views (
  id uuid primary key default gen_random_uuid(),
  appeal_id uuid not null references safety_private.appeals(id),
  admin_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp()
);
create index appeal_views_appeal_idx on safety_private.appeal_views(appeal_id);
create index appeal_views_admin_idx on safety_private.appeal_views(admin_id);
alter table safety_private.appeals enable row level security;
alter table safety_private.appeal_decisions enable row level security;
alter table safety_private.appeal_views enable row level security;
revoke all on safety_private.appeals,safety_private.appeal_decisions,safety_private.appeal_views from public,anon,authenticated,service_role;

-- A narrow recovery exception: a live, verified student may see and appeal
-- their own actions while suspended. It grants no access to normal app data.
create function safety_private.require_appeal_actor() returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
  if actor is null or not exists(select 1 from auth.users u join public.profiles p on p.id=u.id
    where u.id=actor and u.deleted_at is null and u.email_confirmed_at is not null
      and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=clock_timestamp())) then
    raise exception using errcode='42501',message='Sign in to view your account decisions.';
  end if;
  perform 1 from auth.sessions where user_id=actor and id::text=auth.jwt()->>'session_id'
    and (not_after is null or not_after>clock_timestamp()) for share;
  if not found then raise exception using errcode='42501',message='Sign in to view your account decisions.'; end if;
  return actor;
end $$;
create function safety_private.require_appeal_admin() returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=safety_private.require_staff();
begin
  if not exists(select 1 from safety_private.staff_roles where profile_id=actor and enabled and role='admin') then
    raise exception using errcode='42501',message='An admin account is required to review appeals.';
  end if;
  return actor;
end $$;
revoke all on function safety_private.require_appeal_actor(),safety_private.require_appeal_admin() from public,anon,authenticated,service_role;

create function safety_private.my_moderation_actions(p_before_created_at timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=safety_private.require_appeal_actor(); result jsonb;
begin
  if (p_before_created_at is null)<>(p_before_id is null) or (p_before_created_at is not null and not isfinite(p_before_created_at)) then
    raise exception using errcode='22023',message='Invalid page.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'kind',a.kind,'reason',a.reason,'created_at',a.created_at,
    'revoked_at',a.revoked_at,'automatic_suspension',a.automatic_suspension,
    'appeal',case when ap.id is not null then jsonb_build_object('id',ap.id,'explanation',ap.explanation,'status',ap.status,
      'created_at',ap.created_at,'decision_reason',d.reason,'effect',d.effect) end) order by a.created_at desc,a.id desc),'[]'::jsonb)
    into result from (
      select * from safety_private.enforcement_actions where subject_id=actor
      and (p_before_id is null or (created_at,id)<(p_before_created_at,p_before_id))
      order by created_at desc,id desc limit 20
    ) a left join safety_private.appeals ap on ap.action_id=a.id
      left join safety_private.appeal_decisions d on d.appeal_id=ap.id;
  return result;
end $$;

create function safety_private.submit_appeal(p_action_id uuid,p_operation_id uuid,p_explanation text) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=safety_private.require_appeal_actor(); prior safety_private.appeals; fingerprint bytea;
begin
  if p_action_id is null or p_operation_id is null or p_explanation is null or char_length(btrim(p_explanation)) not between 10 and 2000 then
    raise exception using errcode='22023',message='Explain your appeal in 10–2,000 characters.'; end if;
  fingerprint:=extensions.digest(convert_to(jsonb_build_array(p_action_id,btrim(p_explanation))::text,'UTF8'),'sha256');
  perform pg_advisory_xact_lock(hashtextextended(actor::text||p_operation_id::text,1453));
  select * into prior from safety_private.appeals where appellant_id=actor and operation_id=p_operation_id;
  if found then
    if prior.payload_hash<>fingerprint then raise exception using errcode='22023',message='Appeal retry does not match.'; end if;
    return prior.id;
  end if;
  perform 1 from safety_private.enforcement_actions where id=p_action_id and subject_id=actor and revoked_at is null for update;
  if not found then raise exception using errcode='42501',message='Account decision unavailable.'; end if;
  if exists(select 1 from safety_private.appeals where action_id=p_action_id) then
    raise exception using errcode='PT409',message='An appeal already exists for this decision. Refresh to view it.'; end if;
  insert into safety_private.appeals(action_id,appellant_id,operation_id,payload_hash,explanation)
    values(p_action_id,actor,p_operation_id,fingerprint,btrim(p_explanation)) returning * into prior;
  return prior.id;
end $$;

create function safety_private.list_appeals(p_status text default 'pending',p_before_created_at timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=safety_private.require_appeal_admin(); result jsonb;
begin
  if p_status is null or p_status not in ('pending','upheld','overturned')
    or (p_before_created_at is null)<>(p_before_id is null) or (p_before_created_at is not null and not isfinite(p_before_created_at)) then
    raise exception using errcode='22023',message='Invalid appeal page.'; end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by created_at desc,id desc),'[]'::jsonb) into result from (
    select ap.id,ap.status,ap.created_at,a.kind from safety_private.appeals ap
    join safety_private.enforcement_actions a on a.id=ap.action_id join safety_private.reports r on r.id=a.report_id
    where ap.status=p_status and r.reporter_id is distinct from actor and r.reported_profile_id is distinct from actor
      and ap.appellant_id is distinct from actor
      and (p_before_id is null or (ap.created_at,ap.id)<(p_before_created_at,p_before_id))
    order by ap.created_at desc,ap.id desc limit 20
  ) q;
  return result;
end $$;

create function safety_private.get_appeal(p_appeal_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=safety_private.require_appeal_admin(); result jsonb;
begin
  select jsonb_build_object('id',ap.id,'version',ap.version,'status',ap.status,'explanation',ap.explanation,'created_at',ap.created_at,
    'action_id',a.id,'kind',a.kind,'action_reason',a.reason,'action_created_at',a.created_at,'report_id',r.id,
    'original_admin',coalesce(a.actor_id=actor,false),'revoked_at',a.revoked_at,'decision_reason',d.reason,'effect',d.effect)
    into result from safety_private.appeals ap join safety_private.enforcement_actions a on a.id=ap.action_id
      join safety_private.reports r on r.id=a.report_id left join safety_private.appeal_decisions d on d.appeal_id=ap.id
    where ap.id=p_appeal_id and ap.appellant_id is distinct from actor and r.reporter_id is distinct from actor and r.reported_profile_id is distinct from actor;
  if result is null then raise exception using errcode='42501',message='Appeal unavailable.'; end if;
  insert into safety_private.appeal_views(appeal_id,admin_id) values(p_appeal_id,actor);
  return result;
end $$;

create function safety_private.resolve_appeal(p_appeal_id uuid,p_operation_id uuid,p_expected_version integer,p_outcome text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=safety_private.require_appeal_admin(); ap safety_private.appeals; action safety_private.enforcement_actions;
  report safety_private.reports; prior safety_private.appeal_decisions; fingerprint bytea;
  review course_reviews_private.reviews; effect text:='The original decision remains in effect.'; expiry timestamptz;
begin
  if p_appeal_id is null or p_operation_id is null or p_expected_version is null or p_expected_version<0
    or p_outcome is null or p_outcome not in ('upheld','overturned') or p_reason is null or char_length(btrim(p_reason)) not between 10 and 2000 then
    raise exception using errcode='22023',message='Invalid appeal decision.'; end if;
  fingerprint:=extensions.digest(convert_to(jsonb_build_array(p_appeal_id,p_expected_version,p_outcome,btrim(p_reason))::text,'UTF8'),'sha256');
  perform pg_advisory_xact_lock(hashtextextended(actor::text||p_operation_id::text,1454));
  select * into prior from safety_private.appeal_decisions where admin_id=actor and operation_id=p_operation_id;
  if found then
    if prior.payload_hash<>fingerprint then raise exception using errcode='22023',message='Decision retry does not match.'; end if;
    return jsonb_build_object('id',prior.id,'outcome',prior.outcome,'effect',prior.effect);
  end if;
  select * into ap from safety_private.appeals where id=p_appeal_id;
  select * into action from safety_private.enforcement_actions where id=ap.action_id;
  select * into report from safety_private.reports where id=action.report_id
    and reporter_id is distinct from actor and reported_profile_id is distinct from actor for update;
  if not found or ap.appellant_id=actor then raise exception using errcode='42501',message='Appeal unavailable.'; end if;
  -- Same report -> profile lock order as enforcement. The profile lock also
  -- serializes two different appeals and a new warning for the same student.
  perform 1 from public.profiles where id=action.subject_id for update;
  if exists(select 1 from safety_private.staff_roles where profile_id=action.subject_id and enabled) then
    raise exception using errcode='42501',message='Staff accounts require owner review.'; end if;
  select * into ap from safety_private.appeals where id=p_appeal_id for update;
  if ap.status<>'pending' or ap.version<>p_expected_version then
    raise exception using errcode='PT409',message='This appeal changed. Reload before deciding.'; end if;
  select * into action from safety_private.enforcement_actions where id=ap.action_id for update;
  if p_outcome='overturned' then
    update safety_private.enforcement_actions set revoked_at=clock_timestamp() where id=action.id;
    if action.kind='remove_review' then
      select * into review from course_reviews_private.reviews where id=report.course_review_id;
      if review.id is not null then
        perform pg_advisory_xact_lock(hashtextextended(review.author_id::text||':'||review.course_code||':'||review.term_id::text,1452));
        select * into review from course_reviews_private.reviews where id=report.course_review_id for update;
      end if;
      if review.id is not null and review.archived_at is null then
        update course_reviews_private.reviews set removed_at=null where id=review.id;
        effect:='The hidden review is visible again and included in course statistics.';
      else
        effect:='The hide decision was overturned. Your deleted or replaced version stays archived; your current review is unchanged.';
      end if;
    else
      -- Recompute only from unrevoked grants. An automatic grant is invalid
      -- when any warning that caused it was overturned. Never extend expiry.
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
  end if;
  insert into safety_private.appeal_decisions(appeal_id,admin_id,operation_id,payload_hash,outcome,reason,effect)
    values(ap.id,actor,p_operation_id,fingerprint,p_outcome,btrim(p_reason),effect) returning * into prior;
  update safety_private.appeals set status=p_outcome,version=version+1 where id=ap.id;
  update safety_private.reports set triage_version=triage_version+1 where id=report.id;
  if p_outcome='overturned' and action.kind='warn' then
    update public.notifications set title='Warning overturned',
      body=E'This warning was overturned on appeal. It no longer counts.\n\nOriginal reason: '||action.reason,
      read_at=null where recipient_id=action.subject_id and source_event_key='moderation-warning:'||action.id::text;
  end if;
  return jsonb_build_object('id',prior.id,'outcome',prior.outcome,'effect',prior.effect);
end $$;

-- A reversed removal must no longer keep an acknowledgement gate open.
do $$ declare definition text; begin
  select pg_get_functiondef('safety_private.my_account_standing()'::regprocedure) into definition;
  if position('where subject_id=actor' in definition)=0 then raise exception 'Standing function changed'; end if;
  execute replace(definition,'where subject_id=actor','where subject_id=actor and revoked_at is null');
end $$;

do $$ declare definition text; begin
  select pg_get_functiondef('safety_private.enforcement_context(uuid)'::regprocedure) into definition;
  if position('''id'',id,''kind'',kind' in definition)=0 then raise exception 'Enforcement context changed'; end if;
  execute replace(definition,'''id'',id,''kind'',kind','''id'',id,''revoked_at'',revoked_at,''kind'',kind');
end $$;

create function public.get_my_moderation_actions(p_before_created_at timestamptz default null,p_before_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$ select safety_private.my_moderation_actions(p_before_created_at,p_before_id); $$;
create function public.submit_moderation_appeal(p_action_id uuid,p_operation_id uuid,p_explanation text)
returns uuid language sql security invoker set search_path='' as $$ select safety_private.submit_appeal(p_action_id,p_operation_id,p_explanation); $$;
create function public.list_moderation_appeals(p_status text default 'pending',p_before_created_at timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$ begin
  perform safety_private.check_account_access(); return safety_private.list_appeals(p_status,p_before_created_at,p_before_id); end $$;
create function public.get_moderation_appeal(p_appeal_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$ begin
  perform safety_private.check_account_access(); return safety_private.get_appeal(p_appeal_id); end $$;
create function public.resolve_moderation_appeal(p_appeal_id uuid,p_operation_id uuid,p_expected_version integer,p_outcome text,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$ begin
  perform safety_private.check_account_access(); return safety_private.resolve_appeal(p_appeal_id,p_operation_id,p_expected_version,p_outcome,p_reason); end $$;

revoke all on function safety_private.my_moderation_actions(timestamptz,uuid),safety_private.submit_appeal(uuid,uuid,text),
 safety_private.list_appeals(text,timestamptz,uuid),safety_private.get_appeal(uuid),safety_private.resolve_appeal(uuid,uuid,integer,text,text),
 public.get_my_moderation_actions(timestamptz,uuid),public.submit_moderation_appeal(uuid,uuid,text),public.list_moderation_appeals(text,timestamptz,uuid),
 public.get_moderation_appeal(uuid),public.resolve_moderation_appeal(uuid,uuid,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function safety_private.my_moderation_actions(timestamptz,uuid),safety_private.submit_appeal(uuid,uuid,text),
 safety_private.list_appeals(text,timestamptz,uuid),safety_private.get_appeal(uuid),safety_private.resolve_appeal(uuid,uuid,integer,text,text),
 public.get_my_moderation_actions(timestamptz,uuid),public.submit_moderation_appeal(uuid,uuid,text),public.list_moderation_appeals(text,timestamptz,uuid),
 public.get_moderation_appeal(uuid),public.resolve_moderation_appeal(uuid,uuid,integer,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
