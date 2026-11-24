begin;
set local lock_timeout='5s';

-- One source of relationships for private-copy and original-case cleanup.
create view safety_private.evidence_scopes with (security_invoker=true) as
with jobs(batch_id,id) as (
    select id,target_id from safety_private.deletion_evidence_batches where target_kind='job'
    union select id,notice_request_id from safety_private.deletion_evidence_batches where notice_request_id is not null
    union select b.id,rc.request_id from safety_private.deletion_evidence_batches b join public.request_conversations rc
      on rc.conversation_id=coalesce(b.notice_thread_id,case when b.target_kind='thread' then b.target_id end)
  ), threads(batch_id,id) as (
    select id,target_id from safety_private.deletion_evidence_batches where target_kind='thread'
    union select id,notice_thread_id from safety_private.deletion_evidence_batches where notice_thread_id is not null
    union select j.batch_id,rc.conversation_id from jobs j join public.request_conversations rc on rc.request_id=j.id
  ), direct_cases(batch_id,report_id) as (
    select id, target_id from safety_private.deletion_evidence_batches where target_kind='case'
    union
    select id, notice_report_id from safety_private.deletion_evidence_batches where notice_report_id is not null
    union
    select j.batch_id,r.id from jobs j join safety_private.reports r on r.request_id=j.id
    union
    select t.batch_id,r.id from threads t join public.messages m on m.conversation_id=t.id
      join safety_private.reports r on r.message_id=m.id
  ), related_cases(batch_id,report_id) as (
    select batch_id,report_id from direct_cases
    union select c.batch_id,s.report_id from direct_cases c join safety_private.enforcement_actions w on w.report_id=c.report_id
      join safety_private.enforcement_actions s on w.id=any(s.warning_basis)
    union select c.batch_id,w.report_id from direct_cases c join safety_private.enforcement_actions s on s.report_id=c.report_id
      join safety_private.enforcement_actions w on w.id=any(s.warning_basis)
  ), scopes(batch_id,kind,id) as (
    select id,target_kind,target_id from safety_private.deletion_evidence_batches
    union select batch_id,'case',report_id from related_cases
    union select batch_id,'job',id from jobs
    union select batch_id,'thread',id from threads
  )
select batch_id,kind,id from scopes;

create view safety_private.case_dependencies with (security_invoker=true) as
with basis as (
  select distinct w.report_id as warning_case, a.report_id as sanction_case
  from safety_private.enforcement_actions a cross join lateral unnest(a.warning_basis) b(id)
  join safety_private.enforcement_actions w on w.id=b.id
)
select id as report_id,id as needed_by from safety_private.reports
union select warning_case,sanction_case from basis
union select sanction_case,warning_case from basis;

-- Moderation notices contain the action reason and link to its case history.
create view safety_private.case_notices with (security_invoker=true) as
select a.report_id,n.id from safety_private.enforcement_actions a join public.notifications n
  on n.source_event_key in ('moderation-warning:'||a.id,'moderation-action:'||a.id)
  and n.event_type='account_warning' and n.recipient_id=a.subject_id
union all
select a.report_id,n.id from safety_private.enforcement_actions a join safety_private.appeals p on p.action_id=a.id
join safety_private.appeal_decisions d on d.appeal_id=p.id join public.notifications n
  on n.source_event_key='moderation-appeal:'||d.id and n.event_type='appeal_decided' and n.recipient_id=p.appellant_id;

create view safety_private.case_hold_targets with (security_invoker=true) as
select id as report_id,'case'::text as kind,id from safety_private.reports
union all select l.report_id,'job',l.request_id from safety_private.job_report_links l
union all select l.report_id,'thread',j.conversation_id from safety_private.job_report_links l
  join public.request_conversations j on j.request_id=l.request_id
union all select r.id,'thread',m.conversation_id from safety_private.reports r join public.messages m on m.id=r.message_id
union all select n.report_id,'notice',n.id from safety_private.case_notices n;

revoke all on safety_private.case_dependencies,safety_private.case_notices,safety_private.case_hold_targets,
  safety_private.evidence_scopes from public,anon,authenticated,service_role;

create function safety_private.case_windows(p_at timestamptz, p_report_id uuid default null)
returns table(id uuid,protected boolean,copy_blocked boolean,window_end timestamptz)
language sql stable security invoker set search_path='' set timezone='UTC' as $$
  with needed as materialized (
    select * from safety_private.case_dependencies l where p_report_id is null or l.report_id=p_report_id
  ), standing_decisions(subject_id,used_at,recalculate_suspension) as (
    select a.subject_id,a.created_at,false from safety_private.enforcement_actions a where a.kind='warn'
    union all select a.subject_id,d.created_at,true from safety_private.appeal_decisions d
      join safety_private.appeals p on p.id=d.appeal_id join safety_private.enforcement_actions a on a.id=p.action_id
      where d.outcome='overturned' and a.kind in ('warn','suspend_7_days')
  ), uses(report_id,used_at) as (
    select d.report_id,d.created_at from safety_private.report_decisions d
    union all select report_id,resolved_at from safety_private.report_resolutions
    -- Earlier effective warnings contribute to the next count. A reversal also
    -- recomputes standing from the unrevoked suspension grants for this student.
    union all select a.report_id,d.used_at from standing_decisions d
      join safety_private.enforcement_actions a on a.subject_id=d.subject_id
      where a.created_at<=d.used_at and (a.revoked_at is null or a.revoked_at>=d.used_at)
        and (a.kind='warn' or (d.recalculate_suspension and a.kind='suspend_7_days'))
  ), requirements as (
    select n.report_id, bool_or(h.id is not null and x.hold_id is null) as held,
           max((d.through_date+1)::timestamp at time zone 'UTC') as until_date
    from needed n join safety_private.case_hold_targets t on t.report_id=n.needed_by
    left join safety_private.retention_holds h on h.target_kind=t.kind and h.target_id=t.id
    left join safety_private.retention_hold_releases x on x.hold_id=h.id
    left join safety_private.retention_deadlines d on d.hold_id=h.id group by n.report_id
  ), cases as (
    select n.report_id,bool_or(
      r.triage_status is distinct from 'dismissed' or (select d.to_status from safety_private.report_decisions d
        where d.report_id=r.id order by d.version desc limit 1) is distinct from 'dismissed'
      or exists (select from safety_private.enforcement_actions a join safety_private.appeals p on p.action_id=a.id
        where a.report_id=r.id and (p.status='pending' or not exists (
          select from safety_private.appeal_decisions d where d.appeal_id=p.id and d.outcome=p.status)))
      or exists (select from safety_private.enforcement_actions a where a.report_id=r.id and a.revoked_at is null
        and (a.suspended_until>p_at or (a.kind='warn' and not exists (
          select from public.profiles p join account_private.deletions d on d.profile_id=p.id
          where p.id=a.subject_id and p.deleted_at is not null and d.completed_at is not null))))
      -- For an older standing record without a matching grant, retain its provenance conservatively.
      or exists (select from safety_private.account_standing s where s.profile_id=r.reported_profile_id and s.suspended_until>p_at
        and not exists (select from safety_private.enforcement_actions a where a.subject_id=s.profile_id and a.revoked_at is null
          and (a.kind='suspend_7_days' or a.automatic_suspension) and a.suspended_until=s.suspended_until))
    ) as pending, max(greatest(r.created_at,(select max(u.used_at) from uses u where u.report_id=r.id))) as last_use
    from needed n join safety_private.reports r on r.id=n.needed_by group by n.report_id
  )
  select c.report_id,c.pending or h.held
      or exists (select from safety_private.evidence_scopes s where s.kind='case' and s.id=c.report_id)
      or exists (select from safety_private.case_notices n join safety_private.deletion_evidence_batches b
                 on b.target_kind='notice' and b.target_id=n.id where n.report_id=c.report_id)
      or exists (select from safety_private.case_notices n join notifications_private.push_jobs j on j.notification_id=n.id
                 where n.report_id=c.report_id),
    c.pending or h.held,greatest(c.last_use+interval '1 year',h.until_date)
  from cases c join requirements h on h.report_id=c.report_id;
$$;
revoke all on function safety_private.case_windows(timestamptz,uuid) from public,anon,authenticated,service_role;

create or replace function safety_private.retention_source_windows(p_at timestamptz)
returns table(kind text,id uuid,protected boolean,copy_blocked boolean,window_end timestamptz)
language sql stable security invoker set search_path='' set timezone='UTC' as $$
  select 'thread',w.id,w.protected,w.copy_blocked,w.window_end from safety_private.direct_thread_windows w
  union all select 'job',w.id,w.protected,w.copy_blocked,w.window_end from safety_private.shared_job_windows(p_at) w
  union all select 'case',w.id,w.protected,w.copy_blocked,w.window_end from safety_private.case_windows(p_at) w;
$$;

create or replace function safety_private.evidence_cleanup_windows(p_at timestamptz)
returns table(batch_id uuid,original_hold boolean,protected boolean,eligible_at timestamptz)
language sql stable security invoker set search_path='' set timezone='UTC' as $$
  with windows as materialized (select * from safety_private.retention_source_windows(p_at)),
  scopes as (select * from safety_private.evidence_scopes),
  related_cases as (select batch_id,id as report_id from scopes where kind='case'), requirements as (
    select s.batch_id,bool_or(h.id is not null and x.hold_id is null) open_hold,
      max((d.through_date+1)::timestamp at time zone 'UTC') until_date
    from scopes s left join safety_private.retention_holds h on h.target_kind=s.kind and h.target_id=s.id
    left join safety_private.retention_hold_releases x on x.hold_id=h.id
    left join safety_private.retention_deadlines d on d.hold_id=h.id group by s.batch_id
  ), cases as (
    select c.batch_id,bool_or(coalesce(w.copy_blocked,true)) blocked,max(w.window_end) until_date
    from related_cases c left join windows w on w.kind='case' and w.id=c.report_id group by c.batch_id
  ), coverage as (
    select c.batch_id,bool_or(x.hold_id is null) original_hold,max(x.released_at) last_release
    from safety_private.deletion_evidence_coverage c left join safety_private.retention_hold_releases x on x.hold_id=c.hold_id
    group by c.batch_id
  )
  select b.id,coalesce(c.original_hold,false),
    c.batch_id is null or c.original_hold or r.open_hold or coalesce(k.blocked,false)
      or case when b.target_kind='notice' then not b.notice_classified
              else coalesce(w.copy_blocked,true) end,
    greatest(c.last_release,b.notice_until,w.window_end,k.until_date,r.until_date,
      case when b.notice_until is not null then n.read_at+interval '90 days' end,
      case when b.target_kind='job' then b.last_evidence_view_at+interval '1 year' end)
  from safety_private.deletion_evidence_batches b left join coverage c on c.batch_id=b.id
  join requirements r on r.batch_id=b.id left join cases k on k.batch_id=b.id
  left join windows w on w.kind=b.target_kind and w.id=b.target_id
  left join public.notifications n on b.target_kind='notice' and n.id=b.target_id;
$$;


-- Keep opaque direct-action retry keys. Replaying an expired request cannot sanction a student twice.
alter table safety_private.direct_action_receipts alter column action_id drop not null,
  alter column payload_hash drop not null,
  add constraint direct_receipt_expiry_pair check ((action_id is null)=(payload_hash is null));
do $$ declare
  def text:=pg_get_functiondef('safety_private.direct_action(text,uuid,uuid,text,text,timestamptz)'::regprocedure);
  anchor text:='    if prior.payload_hash<>fingerprint then';
begin
  if strpos(def,anchor)=0 then raise exception 'Inspect the direct action retry path before migrating'; end if;
  execute replace(def,anchor,
    '    if prior.action_id is null then raise exception using errcode=''PT410'',message=''This decision has expired.''; end if;'
    ||chr(10)||anchor);
end $$;
create index staff_recovery_appeal_receipt_idx on safety_private.staff_recovery_events ((receipt->>'id')) where kind='review_appeal';

create function safety_private.erase_expired_cases() returns integer
language plpgsql volatile security invoker set search_path='' set lock_timeout='2s' set timezone='UTC' as $$
declare
  case_id uuid;
  cutoff constant timestamptz:=statement_timestamp();
  removed integer:=0;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Case cleanup requires a fresh read-committed snapshot.';
  end if;
  if not exists (select from safety_private.case_windows(cutoff) w where not w.protected and w.window_end<=cutoff) then return 0; end if;
  perform 1 from account_private.retention_write_gate where singleton for update skip locked;
  if not found then return 0; end if;
  -- Warning-basis arrays and recovery receipts have no foreign key. Serialize their
  -- writers here, including appeals against other cases in the same warning cycle.
  begin
    lock table safety_private.reports,safety_private.report_decisions,safety_private.enforcement_actions,
      safety_private.appeals,safety_private.appeal_decisions,safety_private.account_standing,
      safety_private.staff_recovery_events in share row exclusive mode nowait;
    lock table public.request_conversations in share mode nowait;
  exception when lock_not_available then return 0;
  end;
  for case_id in
    select r.id from safety_private.case_windows(cutoff) w join safety_private.reports r on r.id=w.id
    where not w.protected and w.window_end<=cutoff order by w.window_end,r.id limit 50 for update of r skip locked
  loop
    begin
      perform 1 from safety_private.enforcement_actions where report_id=case_id for update nowait;
      perform 1 from safety_private.appeals p join safety_private.enforcement_actions a on a.id=p.action_id
        where a.report_id=case_id for update of p nowait;
      perform 1 from public.notifications n join safety_private.case_notices l on l.id=n.id
        where l.report_id=case_id for update of n nowait;
      if not exists(select from safety_private.case_windows(cutoff,case_id) w
                    where not w.protected and w.window_end<=cutoff) then continue; end if;
      delete from public.notifications n using safety_private.case_notices l where l.report_id=case_id and n.id=l.id;
      delete from safety_private.staff_recovery_events e using safety_private.appeal_decisions d,
        safety_private.appeals p,safety_private.enforcement_actions a
        where e.kind='review_appeal' and e.receipt->>'id'=d.id::text and d.appeal_id=p.id and p.action_id=a.id and a.report_id=case_id;
      delete from safety_private.appeal_views v using safety_private.appeals p,safety_private.enforcement_actions a
        where v.appeal_id=p.id and p.action_id=a.id and a.report_id=case_id;
      delete from safety_private.appeal_decisions d using safety_private.appeals p,safety_private.enforcement_actions a
        where d.appeal_id=p.id and p.action_id=a.id and a.report_id=case_id;
      delete from safety_private.appeals p using safety_private.enforcement_actions a where p.action_id=a.id and a.report_id=case_id;
      update safety_private.direct_action_receipts t set action_id=null,payload_hash=null
        from safety_private.enforcement_actions a where a.report_id=case_id and a.id=t.action_id;
      delete from safety_private.enforcement_actions where report_id=case_id;
      delete from safety_private.report_decisions where report_id=case_id;
      delete from safety_private.report_views where report_id=case_id;
      delete from safety_private.reports where id=case_id;
      removed:=removed+1;
    exception when lock_not_available then continue;
    end;
  end loop;
  return removed;
end $$;
revoke all on function safety_private.erase_expired_cases() from public,anon,authenticated,service_role;
commit;
