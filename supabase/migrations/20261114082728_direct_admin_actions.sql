begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table public.requests add column moderation_removed_at timestamptz;
create policy requests_removed_visibility on public.requests as restrictive for select to authenticated
  using(moderation_removed_at is null or owner_id=(select auth.uid()));
alter table safety_private.enforcement_actions drop constraint enforcement_actions_kind_check;
alter table safety_private.enforcement_actions add constraint enforcement_actions_kind_check
  check(kind in ('warn','suspend_7_days','remove_review','remove_request'));
alter table safety_private.reports add column origin text not null default 'student_report'
  check(origin in ('student_report','admin_direct'));
create table safety_private.direct_action_receipts(
  actor_id uuid references public.profiles(id) on delete set null,
  operation_id uuid not null,
  payload_hash bytea not null check(octet_length(payload_hash)=32),
  action_id uuid not null references safety_private.enforcement_actions(id),
  created_at timestamptz not null default clock_timestamp(),
  unique(actor_id,operation_id)
);
create index direct_action_receipts_action_idx on safety_private.direct_action_receipts(action_id);
alter table safety_private.direct_action_receipts enable row level security;
revoke all on safety_private.direct_action_receipts from public,anon,authenticated,service_role;

-- Never return the author identity for an anonymous course review.
create function safety_private.direct_target(p_target_type text,p_target_id uuid)
returns table(subject_id uuid,label text,updated_at timestamptz,evidence jsonb)
language plpgsql security invoker set search_path='' as $$
begin
  if p_target_type='student' then
    return query select p.id,p.display_name,p.updated_at,jsonb_build_object('display_name',p.display_name)
    from public.profiles p where p.id=p_target_id and p.deleted_at is null;
  elsif p_target_type='request' then
    return query select r.owner_id,r.title,r.updated_at,jsonb_build_object('title',r.title,'description',r.description,
      'category',r.category,'points',r.points,'status',r.status)
    from public.requests r where r.id=p_target_id and r.moderation_removed_at is null;
  elsif p_target_type='course_review' then
    return query select r.author_id,r.course_code||' · '||t.display_name,r.updated_at,
      jsonb_build_object('course_code',r.course_code,'term_name',t.display_name,'difficulty',r.difficulty,
        'workload',r.workload,'grade',r.grade,'comment',r.comment,'tips',r.tips,'instructor',r.instructor,'created_at',r.created_at)
    from course_reviews_private.reviews r join public.academic_terms t on t.id=r.term_id
    where r.id=p_target_id and r.removed_at is null and r.archived_at is null;
  else raise exception using errcode='22023',message='Invalid admin target.';
  end if;
end $$;
revoke all on function safety_private.direct_target(text,uuid) from public,anon,authenticated,service_role;

create function safety_private.direct_context(p_target_type text,p_target_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=safety_private.require_appeal_admin(); target record; standing safety_private.account_standing;
begin
  select * into target from safety_private.direct_target(p_target_type,p_target_id);
  if not found or target.subject_id=actor or not exists(select 1 from public.profiles where id=target.subject_id and deleted_at is null)
    or exists(select 1 from safety_private.staff_roles where profile_id=target.subject_id and enabled) then
    raise exception using errcode='42501',message='Admin target unavailable. Staff accounts require owner review.';
  end if;
  select * into standing from safety_private.account_standing where profile_id=target.subject_id;
  return jsonb_build_object('label',target.label,'updated_at',target.updated_at,'evidence',target.evidence,
    'warning_count',coalesce(standing.warning_count,0),'suspended_until',standing.suspended_until);
end $$;

-- Called only by the checked admin transaction. Lock parent -> hold -> wallet,
-- as in ordinary cancellation. Never reverse a completed job's settlement.
create function safety_private.remove_request(p_request_id uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare req public.requests; hold public.request_point_reservations; helper uuid;
begin
  select * into req from public.requests where id=p_request_id for update;
  if not found or req.moderation_removed_at is not null then
    raise exception using errcode='PT409',message='Request already removed.';
  end if;
  if req.status='accepted' then
    select * into hold from public.request_point_reservations
      where request_id=req.id and offer_round=req.offer_round for update;
    if found then
      select offering_user_id into helper from public.request_offers
        where request_id=req.id and offer_round=req.offer_round and status='accepted';
      if hold.status<>'reserved' or hold.poster_id<>req.owner_id or hold.amount<>req.points
        or helper is null or hold.helper_id<>helper then
        raise exception using errcode='PT409',message='Request settlement changed. Reload before acting.';
      end if;
      update public.points_wallets set reserved=reserved-hold.amount,updated_at=clock_timestamp()
        where profile_id=req.owner_id and reserved>=hold.amount;
      if not found then raise exception using errcode='PT409',message='Points reservation unavailable.'; end if;
      update public.request_point_reservations set status='released',released_at=clock_timestamp()
        where request_id=req.id and offer_round=req.offer_round;
    end if;
  end if;
  update public.requests set moderation_removed_at=clock_timestamp(),
    status=case when status='completed' then status else 'cancelled' end,
    cancelled_at=case when status='completed' then cancelled_at else clock_timestamp() end,updated_at=clock_timestamp()
    where id=req.id;
  update public.request_offers set status='rejected',decided_at=clock_timestamp(),updated_at=clock_timestamp()
    where request_id=req.id and req.status<>'completed' and status in ('pending','accepted');
end $$;
revoke all on function safety_private.remove_request(uuid) from public,anon,authenticated,service_role;

create function safety_private.direct_action(p_target_type text,p_target_id uuid,p_operation_id uuid,
  p_kind text,p_reason text,p_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=safety_private.require_appeal_admin(); target record; fingerprint bytea;
  prior safety_private.direct_action_receipts; action safety_private.enforcement_actions;
  report_id uuid; result jsonb; standing safety_private.account_standing;
begin
  if p_target_type is null or p_target_type not in ('student','request','course_review') or p_target_id is null
    or p_operation_id is null or p_kind is null or p_kind not in ('warn','suspend_7_days','remove_review','remove_request')
    or (p_kind='remove_review' and p_target_type<>'course_review') or (p_kind='remove_request' and p_target_type<>'request')
    or p_reason is null or char_length(btrim(p_reason)) not between 10 and 2000
    or p_updated_at is null or not isfinite(p_updated_at) then
    raise exception using errcode='22023',message='Invalid direct admin action.';
  end if;
  fingerprint:=extensions.digest(convert_to(jsonb_build_array(p_target_type,p_target_id,p_kind,btrim(p_reason),p_updated_at)::text,'UTF8'),'sha256');
  perform pg_advisory_xact_lock(hashtextextended(actor::text||p_operation_id::text,1458));
  select * into prior from safety_private.direct_action_receipts where actor_id=actor and operation_id=p_operation_id;
  if found then
    if prior.payload_hash<>fingerprint then raise exception using errcode='22023',message='Action retry does not match.'; end if;
    select * into action from safety_private.enforcement_actions where id=prior.action_id;
    return jsonb_build_object('action_id',action.id,'kind',action.kind,'warning_count',action.warning_count,
      'suspended_until',action.suspended_until,'automatic_suspension',action.automatic_suspension);
  end if;
  -- Parent lock prevents acceptance/completion/editing racing request removal.
  if p_target_type='request' then perform 1 from public.requests where id=p_target_id for update; end if;
  select * into target from safety_private.direct_target(p_target_type,p_target_id);
  if not found or target.subject_id=actor then raise exception using errcode='42501',message='Admin target unavailable.'; end if;
  perform 1 from public.profiles where id=target.subject_id and deleted_at is null for update;
  if not found or exists(select 1 from safety_private.staff_roles where profile_id=target.subject_id and enabled) then
    raise exception using errcode='42501',message='Admin target unavailable. Staff accounts require owner review.';
  end if;
  if p_target_type='course_review' then perform 1 from course_reviews_private.reviews where id=p_target_id for update; end if;
  select * into target from safety_private.direct_target(p_target_type,p_target_id);
  if not found or target.updated_at<>p_updated_at then
    raise exception using errcode='PT409',message='This content changed. Reload before acting.';
  end if;
  -- Staff-origin evidence is not represented as a student complaint. Each
  -- action has its own case so it can use existing audit, standing and appeals.
  insert into safety_private.reports(reporter_id,operation_id,target_type,reported_profile_id,request_id,course_review_id,
    reason,details,payload_hash,evidence,triage_status,origin)
  values(null,p_operation_id,p_target_type,target.subject_id,
    case when p_target_type='request' then p_target_id end,case when p_target_type='course_review' then p_target_id end,
    'other',btrim(p_reason),fingerprint,target.evidence,'escalated','admin_direct') returning id into report_id;
  if p_kind='remove_request' then
    perform safety_private.remove_request(p_target_id);
    insert into safety_private.account_standing(profile_id) values(target.subject_id) on conflict do nothing;
    select * into standing from safety_private.account_standing where profile_id=target.subject_id for update;
    insert into safety_private.enforcement_actions(report_id,actor_id,subject_id,operation_id,payload_hash,kind,incident_key,
      reason,warning_count,suspended_until)
    values(report_id,actor,target.subject_id,p_operation_id,fingerprint,p_kind,'request:'||p_target_id::text,
      btrim(p_reason),standing.warning_count,standing.suspended_until) returning * into action;
    update safety_private.reports set triage_version=1 where id=report_id;
    result:=jsonb_build_object('action_id',action.id,'kind',action.kind,'warning_count',action.warning_count,
      'suspended_until',action.suspended_until,'automatic_suspension',false);
  else
    result:=safety_private.enforce_report(report_id,p_operation_id,0,p_kind,p_reason,
      case when p_kind='remove_review' then p_updated_at end);
  end if;
  insert into safety_private.direct_action_receipts(actor_id,operation_id,payload_hash,action_id)
    values(actor,p_operation_id,fingerprint,(result->>'action_id')::uuid);
  return result;
end $$;

create function public.get_direct_moderation_context(p_target_type text,p_target_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select safety_private.check_account_access(); select safety_private.direct_context(p_target_type,p_target_id); $$;
create function public.take_direct_moderation_action(p_target_type text,p_target_id uuid,p_operation_id uuid,
  p_kind text,p_reason text,p_updated_at timestamptz) returns jsonb
language sql security invoker set search_path='' as $$
  select safety_private.check_account_access();
  select safety_private.direct_action(p_target_type,p_target_id,p_operation_id,p_kind,p_reason,p_updated_at);
$$;
revoke all on function safety_private.direct_context(text,uuid),safety_private.direct_action(text,uuid,uuid,text,text,timestamptz),
  public.get_direct_moderation_context(text,uuid),public.take_direct_moderation_action(text,uuid,uuid,text,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function safety_private.direct_context(text,uuid),safety_private.direct_action(text,uuid,uuid,text,text,timestamptz),
  public.get_direct_moderation_context(text,uuid),public.take_direct_moderation_action(text,uuid,uuid,text,text,timestamptz) to authenticated;

-- Reuse the existing private account-notice envelope, which older notification
-- inbox clients already understand. Reasons are never public or pushed in full.
create function notifications_private.copy_admin_action() returns trigger
language plpgsql security definer set search_path='' as $$
declare label text; item_label text;
begin
  if new.subject_id is null or new.kind='warn' then return new; end if;
  label:=case new.kind when 'remove_request' then 'Request removed' when 'remove_review' then 'Course review removed'
    when 'suspend_7_days' then 'Account suspended for 7 days' end;
  select left(coalesce(evidence->>'title',evidence->>'course_code',''),120) into item_label
    from safety_private.reports where id=new.report_id;
  insert into public.notifications(recipient_id,event_type,title,body,navigation_key,source_event_key,created_at)
    values(new.subject_id,'account_warning',label,case when coalesce(item_label,'')<>'' then item_label||E'\n' else '' end
      ||new.reason||E'\n\nSee Account decisions & appeals for details.',
      'account_notice','moderation-action:'||new.id::text,new.created_at)
    on conflict(recipient_id,source_event_key) do nothing;
  return new;
end $$;
revoke all on function notifications_private.copy_admin_action() from public,anon,authenticated,service_role;
create trigger moderation_action_notification after insert on safety_private.enforcement_actions
  for each row when(new.kind<>'warn') execute function notifications_private.copy_admin_action();

-- A request appeal restores visibility, never a cancelled assignment or funds.
do $$ declare def text; begin
  def:=pg_get_functiondef('safety_private.resolve_appeal(uuid,uuid,integer,text,text)'::regprocedure);
  if position('if action.kind=''remove_review'' then' in def)=0 then raise exception 'Appeal function changed'; end if;
  def:=replace(def,'if action.kind=''remove_review'' then',
    'if action.kind=''remove_request'' then
      update public.requests set moderation_removed_at=null where id=report.request_id;
      effect:=''Request removal overturned. The request stays closed; you can post a new one. Completed payments stay unchanged.'';
    elsif action.kind=''remove_review'' then');
  execute def;
end $$;
notify pgrst,'reload schema';
commit;
