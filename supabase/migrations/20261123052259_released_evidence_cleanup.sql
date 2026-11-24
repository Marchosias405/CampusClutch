begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- The live notice may disappear in the same transaction that takes the copy.
-- Save only the timing and references needed to find requirements and appeals.
alter table safety_private.deletion_evidence_batches
  add column notice_classified boolean not null default false,
  add column notice_until timestamptz,
  add column notice_report_id uuid,
  add column notice_request_id uuid,
  add column notice_thread_id uuid,
  add column last_evidence_view_at timestamptz;

create function safety_private.classify_evidence_notice() returns trigger
language plpgsql security invoker set search_path='' set timezone='UTC' as $$
declare n public.notifications;
begin
  if new.target_kind <> 'notice' then return new; end if;
  select * into n from public.notifications where id=new.target_id;
  if not found then return new; end if;
  new.notice_request_id := n.request_id;
  new.notice_thread_id := n.conversation_id;
  if n.event_type in ('offer_created','offer_accepted','offer_rejected','offer_withdrawn','another_helper_selected',
      'request_cancelled','request_expired','request_reopened','request_completed','message_received') then
    new.notice_classified := true;
    new.notice_until := coalesce(n.read_at + interval '90 days', n.created_at + interval '1 year');
  elsif n.event_type='account_warning' then
    select a.report_id into new.notice_report_id from safety_private.enforcement_actions a
    where n.source_event_key in ('moderation-warning:'||a.id,'moderation-action:'||a.id);
    new.notice_classified := new.notice_report_id is not null;
  elsif n.event_type='appeal_decided' then
    select a.report_id into new.notice_report_id from safety_private.appeal_decisions d
    join safety_private.appeals p on p.id=d.appeal_id join safety_private.enforcement_actions a on a.id=p.action_id
    where n.source_event_key='moderation-appeal:'||d.id;
    new.notice_classified := new.notice_report_id is not null;
  end if;
  return new;
end $$;
revoke all on function safety_private.classify_evidence_notice() from public,anon,authenticated,service_role;
create trigger classify_evidence_notice before insert or update of target_id on safety_private.deletion_evidence_batches
for each row when (new.target_kind='notice') execute function safety_private.classify_evidence_notice();
update safety_private.deletion_evidence_batches b set target_id=b.target_id
where b.target_kind='notice' and exists(select from public.notifications n where n.id=b.target_id);

-- A recipient can read a surviving notice after the sender's deletion.
-- Keep the later clock if the recipient subsequently deletes their account.
create function safety_private.keep_notice_read_deadline() returns trigger
language plpgsql security definer set search_path='' set timezone='UTC' as $$
begin
  update safety_private.deletion_evidence_batches
  set notice_until=old.read_at+interval '90 days'
  where target_kind='notice' and target_id=old.id and notice_until<old.read_at+interval '90 days';
  return old;
end $$;
revoke all on function safety_private.keep_notice_read_deadline() from public,anon,authenticated,service_role;
create trigger keep_notice_read_deadline before delete on public.notifications for each row
when (old.read_at is not null) execute function safety_private.keep_notice_read_deadline();

-- A later access request can protect a private copy even after the original
-- was deleted. Its placement never adds it to the copy's read permissions.
create or replace function safety_private.check_retention_target(p_kind text, p_id uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
  case p_kind
    when 'case' then perform 1 from safety_private.reports where id=p_id for key share;
    when 'job' then perform 1 from public.requests where id=p_id for key share;
    when 'thread' then perform 1 from public.conversations where id=p_id and type='direct' for key share;
    when 'notice' then perform 1 from public.notifications where id=p_id for key share;
    else raise exception using errcode='22023',message='Choose a retention record type.';
  end case;
  if not found and not exists(select from safety_private.deletion_evidence_batches
    where target_kind=p_kind and target_id=p_id) then raise exception using errcode='PT404',message='Record unavailable.'; end if;
end $$;

create table safety_private.retention_deadlines (
  hold_id uuid primary key references safety_private.retention_holds(id) on delete restrict,
  through_date date not null check(through_date between date '0001-01-01' and date '9999-12-31')
);
alter table safety_private.retention_deadlines enable row level security;
revoke all on safety_private.retention_deadlines from public,anon,authenticated,service_role;

create function safety_private.place_dated_hold(p_kind text,p_id uuid,p_hold_id uuid,p_reason text,p_through date)
returns uuid language plpgsql security definer set search_path='' as $$
declare existed boolean;
begin
  if p_through is null or p_through not between date '0001-01-01' and date '9999-12-31' then
    raise exception using errcode='22023',message='Enter a valid retention date.';
  end if;
  update account_private.retention_write_gate set version=version+1 where singleton;
  select exists(select from safety_private.retention_holds where id=p_hold_id) into existed;
  perform safety_private.change_retention_hold('place',p_kind,p_id,p_hold_id,p_reason);
  if not existed then
    insert into safety_private.retention_deadlines values(p_hold_id,p_through);
  elsif not exists(select from safety_private.retention_deadlines where hold_id=p_hold_id and through_date=p_through) then
    raise exception using errcode='PT409',message='This hold already has different terms.';
  end if;
  return p_hold_id;
end $$;
create function public.place_dated_retention_hold(p_kind text,p_id uuid,p_hold_id uuid,p_reason text,p_through date)
returns uuid language sql security invoker set search_path='' as $$
  select safety_private.place_dated_hold(p_kind,p_id,p_hold_id,p_reason,p_through)
$$;
revoke all on function safety_private.place_dated_hold(text,uuid,uuid,text,date), public.place_dated_retention_hold(text,uuid,uuid,text,date)
  from public,anon,authenticated,service_role;
grant execute on function safety_private.place_dated_hold(text,uuid,uuid,text,date), public.place_dated_retention_hold(text,uuid,uuid,text,date)
  to authenticated;
create or replace function safety_private.retention_hold_history(p_kind text,p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform safety_private.require_retention_admin(p_kind,p_id);
  -- A target may have disappeared through normal account deletion. Its audit
  -- remains discoverable to an admin and any outstanding hold can be released.
  if not exists(select from safety_private.retention_holds where target_kind=p_kind and target_id=p_id) then
    perform safety_private.check_retention_target(p_kind,p_id);
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'through_date',d.through_date,'id',h.id,'placed_by',h.placed_by,'placed_at',h.placed_at,'reason',h.reason,
    'released_by',r.released_by,'released_at',r.released_at,'release_reason',r.reason)
    order by (r.hold_id is null) desc,h.placed_at desc,h.id),'[]'::jsonb)
    from safety_private.retention_holds h left join safety_private.retention_deadlines d on d.hold_id=h.id left join safety_private.retention_hold_releases r on r.hold_id=h.id
    where h.target_kind=p_kind and h.target_id=p_id);
end $$;
create or replace function safety_private.read_held_deletion_evidence(p_kind text,p_id uuid,p_before bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform safety_private.require_retention_admin(p_kind,p_id);
  if p_id is null or p_kind is null or p_kind not in ('job','case','notice','thread') or p_before<=0 then
    raise exception using errcode='22023',message='Invalid evidence record.';
  end if;
  with page as materialized (select b.id batch_id,i.id,i.label,i.fields,b.captured_at
      from safety_private.deletion_evidence_batches b join safety_private.deletion_evidence_items i on i.batch_id=b.id
      where b.target_kind=p_kind and b.target_id=p_id and (p_before is null or i.id<p_before)
      and exists(select from safety_private.deletion_evidence_coverage c where c.batch_id=b.id
        and not exists(select from safety_private.retention_hold_releases x where x.hold_id=c.hold_id))
      order by i.id desc limit 20), recorded as (
    update safety_private.deletion_evidence_batches set last_evidence_view_at=clock_timestamp()
    where id in (select batch_id from page)
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',q.id::text,'label',q.label,
      'captured_at',q.captured_at,'fields',q.fields) order by q.id desc),'[]'::jsonb) into result from page q;
  return result;
end $$;

create function safety_private.retention_source_windows(p_at timestamptz)
returns table(kind text,id uuid,protected boolean,copy_blocked boolean,window_end timestamptz)
language sql stable security invoker set search_path='' set timezone='UTC' as $$
WITH active_holds AS (
  SELECT DISTINCT h.target_kind, h.target_id
  FROM safety_private.retention_holds h
  LEFT JOIN safety_private.retention_hold_releases r ON r.hold_id = h.id
  WHERE r.hold_id IS NULL
),
cleaned_accounts AS (
  SELECT p.id, greatest(p.deleted_at, d.completed_at) AS finished_at
  FROM public.profiles p
  JOIN account_private.deletions d ON d.profile_id = p.id
  WHERE p.deleted_at IS NOT NULL AND d.completed_at IS NOT NULL
),
direct_threads AS (
  SELECT c.id,
    greatest(lo.finished_at, hi.finished_at) + interval '30 days' AS window_end,
    pair.conversation_id IS NULL OR c.status <> 'closed'
      OR EXISTS (SELECT FROM active_holds h WHERE h.target_kind='thread' AND h.target_id=c.id)
      OR lo.id IS NULL OR hi.id IS NULL
      OR (SELECT count(*) FROM public.conversation_members cm
          WHERE cm.conversation_id = c.id) <> 2
      OR (SELECT count(*) FROM public.conversation_members cm
          WHERE cm.conversation_id = c.id AND cm.profile_id IN (pair.user_low_id, pair.user_high_id)) <> 2 AS copy_blocked,
    EXISTS (SELECT FROM public.request_conversations rc WHERE rc.conversation_id = c.id)
      OR EXISTS (SELECT FROM public.notifications n WHERE n.conversation_id = c.id)
      OR EXISTS (SELECT FROM public.messages m JOIN safety_private.reports s ON s.message_id = m.id
                 WHERE m.conversation_id = c.id) AS protected
  FROM public.conversations c
  LEFT JOIN public.direct_conversation_pairs pair ON pair.conversation_id = c.id
  LEFT JOIN cleaned_accounts lo ON lo.id = pair.user_low_id
  LEFT JOIN cleaned_accounts hi ON hi.id = pair.user_high_id
  WHERE c.type = 'direct'
),
-- One timeline from all parties and recorded activity on the job, across offer rounds.
job_activity(request_id, participant, used_at) AS (
  SELECT id, owner_id, greatest(created_at, updated_at, accepted_at, completed_at, cancelled_at, owner_archived_at, moderation_removed_at) FROM public.requests
  UNION ALL SELECT request_id, offering_user_id, greatest(created_at, updated_at, decided_at, withdrawn_at) FROM public.request_offers
  UNION ALL SELECT o.request_id, o.offering_user_id, h.recorded_at FROM public.request_offer_history h JOIN public.request_offers o ON o.id = h.offer_id
  UNION ALL SELECT r.request_id, party.id, greatest(r.created_at,r.released_at,r.settled_at,r.helper_cancelled_at)
    FROM public.request_point_reservations r CROSS JOIN LATERAL (VALUES (r.poster_id),(r.helper_id)) party(id)
  UNION ALL SELECT r.request_id, party.id, greatest(r.created_at,r.published_at)
    FROM public.request_ratings r CROSS JOIN LATERAL (VALUES (r.rater_id),(r.ratee_id)) party(id)
  UNION ALL SELECT request_id, profile_id, created_at FROM public.points_ledger WHERE request_id IS NOT NULL
  UNION ALL SELECT request_id, party.id, n.created_at FROM public.offer_notifications n
    CROSS JOIN LATERAL (VALUES (n.recipient_id),(n.actor_id)) party(id) WHERE party.id IS NOT NULL
),
job_clocks AS (
  SELECT j.request_id, bool_or(c.id IS NULL) AS participant_unresolved,
    greatest(max(j.used_at),max(c.finished_at)) + interval '1 year' AS window_end
  FROM job_activity j LEFT JOIN cleaned_accounts c ON c.id = j.participant
  GROUP BY j.request_id
),
jobs AS (
  SELECT r.id, c.window_end, c.participant_unresolved OR r.status NOT IN ('completed','cancelled','expired')
    OR EXISTS (SELECT FROM active_holds h WHERE h.target_kind='job' AND h.target_id=r.id)
    OR EXISTS (SELECT FROM public.request_point_reservations z WHERE z.request_id = r.id AND z.status = 'reserved')
    OR EXISTS (SELECT FROM public.request_offers o WHERE o.request_id = r.id AND o.status = 'pending') AS copy_blocked,
    EXISTS (SELECT FROM public.request_conversations rc WHERE rc.request_id = r.id)
    OR EXISTS (SELECT FROM public.points_ledger l WHERE l.request_id = r.id)
    OR EXISTS (SELECT FROM public.notifications n WHERE n.request_id = r.id)
    OR EXISTS (SELECT FROM safety_private.reports s WHERE s.request_id = r.id) AS protected
  FROM public.requests r JOIN job_clocks c ON c.request_id = r.id
),
case_activity(report_id, used_at) AS (
  SELECT report_id, created_at FROM safety_private.report_decisions
  UNION ALL SELECT report_id, created_at FROM safety_private.report_views
  UNION ALL SELECT report_id, greatest(created_at,revoked_at,suspended_until) FROM safety_private.enforcement_actions
  UNION ALL SELECT a.report_id, p.created_at FROM safety_private.enforcement_actions a JOIN safety_private.appeals p ON p.action_id = a.id
  UNION ALL SELECT a.report_id, d.created_at FROM safety_private.enforcement_actions a
    JOIN safety_private.appeals p ON p.action_id = a.id JOIN safety_private.appeal_decisions d ON d.appeal_id = p.id
  UNION ALL SELECT a.report_id, v.created_at FROM safety_private.enforcement_actions a
    JOIN safety_private.appeals p ON p.action_id = a.id JOIN safety_private.appeal_views v ON v.appeal_id = p.id
),
case_clocks AS (
  SELECT report_id, max(used_at) AS last_use FROM case_activity GROUP BY report_id
),
cases AS (
  SELECT r.id, greatest(r.created_at, t.last_use) + interval '1 year' AS window_end,
    r.triage_status <> 'dismissed'
    OR EXISTS (SELECT FROM active_holds h WHERE h.target_kind='case' AND h.target_id=r.id)
    OR (SELECT d.to_status FROM safety_private.report_decisions d WHERE d.report_id = r.id ORDER BY d.version DESC LIMIT 1) IS DISTINCT FROM 'dismissed'
    OR EXISTS (SELECT FROM safety_private.enforcement_actions a WHERE a.report_id = r.id AND a.revoked_at IS NULL
               AND (a.kind = 'warn' OR a.suspended_until > p_at))
    OR EXISTS (SELECT FROM safety_private.account_standing s WHERE s.profile_id = r.reported_profile_id
               AND s.suspended_until > p_at)
    OR EXISTS (SELECT FROM safety_private.enforcement_actions a JOIN safety_private.enforcement_actions basis
               ON a.id = ANY(basis.warning_basis) WHERE a.report_id = r.id AND basis.revoked_at IS NULL
               AND basis.suspended_until > p_at)
    OR EXISTS (SELECT FROM safety_private.enforcement_actions a JOIN safety_private.appeals p ON p.action_id = a.id
               WHERE a.report_id = r.id AND (p.status = 'pending' OR NOT EXISTS (
                 SELECT FROM safety_private.appeal_decisions d WHERE d.appeal_id = p.id AND d.outcome = p.status))) AS protected
  FROM safety_private.reports r LEFT JOIN case_clocks t ON t.report_id = r.id
)
select 'thread',id,(copy_blocked or protected),copy_blocked,window_end from direct_threads
union all select 'job',id,(copy_blocked or protected),copy_blocked,window_end from jobs
union all select 'case',id,protected,protected,window_end from cases;
$$;
revoke all on function safety_private.retention_source_windows(timestamptz) from public,anon,authenticated,service_role;


create function safety_private.evidence_cleanup_windows(p_at timestamptz)
returns table(batch_id uuid,original_hold boolean,protected boolean,eligible_at timestamptz)
language sql stable security invoker set search_path='' set timezone='UTC' as $$
  with windows as materialized (select * from safety_private.retention_source_windows(p_at)),
  jobs(batch_id,id) as (
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
  ), requirements as (
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
      case when k.batch_id is not null or b.target_kind='job' then b.last_evidence_view_at+interval '1 year' end)
  from safety_private.deletion_evidence_batches b left join coverage c on c.batch_id=b.id
  join requirements r on r.batch_id=b.id left join cases k on k.batch_id=b.id
  left join windows w on w.kind=b.target_kind and w.id=b.target_id
  left join public.notifications n on b.target_kind='notice' and n.id=b.target_id;
$$;
revoke all on function safety_private.evidence_cleanup_windows(timestamptz) from public,anon,authenticated,service_role;

-- Only the scheduled database worker can erase copies. No caller-supplied
-- clock or IDs. The check and cascade happen in the same short transaction.
create function safety_private.erase_released_evidence() returns integer
language plpgsql volatile security invoker set search_path='' set lock_timeout='2s' as $$
declare removed integer;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Evidence cleanup requires a fresh read-committed snapshot.';
  end if;
  if not exists(select from safety_private.deletion_evidence_batches) then return 0; end if;
  if not exists(select from safety_private.evidence_cleanup_windows(statement_timestamp())
    where not protected and eligible_at<=statement_timestamp()) then return 0; end if;
  update account_private.retention_write_gate set version=version+1 where singleton;
  -- The hold/deletion gate serializes capture, access requests and dated holds.
  -- Appeals and their source records have independent writers. If any is busy
  -- release all locks and retry on the next sweep, without losing the copy.
  begin
    lock table public.profiles,account_private.deletions,public.conversations,public.conversation_members,
      public.direct_conversation_pairs,public.requests,public.request_offers,public.request_offer_history,
      public.request_point_reservations,public.request_ratings,public.points_ledger,public.offer_notifications,
      public.messages,public.notifications,public.request_conversations,safety_private.deletion_evidence_batches,safety_private.reports,safety_private.report_views,safety_private.report_decisions,
      safety_private.enforcement_actions,safety_private.appeals,safety_private.appeal_views,
      safety_private.appeal_decisions,safety_private.account_standing in share mode nowait;
    with due as (
      select batch_id from safety_private.evidence_cleanup_windows(statement_timestamp())
      where not protected and eligible_at<=statement_timestamp() order by eligible_at,batch_id limit 50
    )
    delete from safety_private.deletion_evidence_batches b using due where b.id=due.batch_id;
    get diagnostics removed=row_count;
  exception when lock_not_available then return 0;
  end;
  return removed;
end $$;
revoke all on function safety_private.erase_released_evidence() from public,anon,authenticated,service_role;
commit;
