begin;
set local lock_timeout = '5s';

-- The job link itself may expire. All other reasons for preserving the chat
-- are shared with the ordinary DM worker.
create view safety_private.independent_thread_windows with (security_invoker=true) as
select c.id,
  state.copy_blocked
    or exists (select from public.notifications n where n.conversation_id=c.id)
    or exists (select from public.messages m join public.notifications n on n.message_id=m.id where m.conversation_id=c.id)
    or exists (select from public.messages m join safety_private.reports r on r.message_id=m.id where m.conversation_id=c.id)
    or exists (select from safety_private.deletion_evidence_batches b where b.target_kind='thread' and b.target_id=c.id)
    or exists (select from safety_private.deletion_evidence_batches b where b.notice_thread_id=c.id)
    as protected,
  state.copy_blocked,
  greatest(greatest(lo.completed_at, hi.completed_at, lp.deleted_at, hp.deleted_at) + interval '720 hours',
           (holds.keep_through + 1)::timestamp at time zone 'UTC') as window_end
from public.conversations c
left join public.direct_conversation_pairs pair on pair.conversation_id=c.id
left join public.profiles lp on lp.id=pair.user_low_id
left join public.profiles hp on hp.id=pair.user_high_id
left join account_private.deletions lo on lo.profile_id=pair.user_low_id
left join account_private.deletions hi on hi.profile_id=pair.user_high_id
cross join lateral (
  select count(*) as total, count(*) filter (where m.profile_id in (pair.user_low_id,pair.user_high_id)) as matched
  from public.conversation_members m where m.conversation_id=c.id
) members
cross join lateral (
  select bool_or(r.hold_id is null) as active, max(d.through_date) as keep_through
  from safety_private.retention_holds h
  left join safety_private.retention_hold_releases r on r.hold_id=h.id
  left join safety_private.retention_deadlines d on d.hold_id=h.id
  where h.target_kind='thread' and h.target_id=c.id
) holds
cross join lateral (
  select c.status <> 'closed' or pair.conversation_id is null
    or lp.deleted_at is null or hp.deleted_at is null or lo.completed_at is null or hi.completed_at is null
    or members.total <> 2 or members.matched <> 2 or coalesce(holds.active,false)
    or exists (select from public.group_conversations g where g.conversation_id=c.id) as copy_blocked
) state
where c.type='direct';
revoke all on safety_private.independent_thread_windows from public, anon, authenticated, service_role;


create or replace view safety_private.direct_thread_windows with (security_invoker=true) as
select w.id, w.protected or exists (select from public.request_conversations j where j.conversation_id=w.id) as protected,
       w.copy_blocked, w.window_end
from safety_private.independent_thread_windows w;

create view safety_private.job_report_links with (security_invoker=true) as
select r.id as report_id, r.request_id from safety_private.reports r where r.request_id is not null
union
select r.id, j.request_id from safety_private.reports r
join public.messages m on m.id=r.message_id
join public.request_conversations j on j.conversation_id=m.conversation_id;

create view safety_private.report_resolutions with (security_invoker=true) as
select d.report_id,d.created_at as resolved_at from safety_private.report_decisions d where d.to_status='dismissed'
union all select a.report_id,greatest(a.created_at,a.revoked_at) from safety_private.enforcement_actions a
union all select a.report_id,d.created_at from safety_private.appeal_decisions d
join safety_private.appeals p on p.id=d.appeal_id
join safety_private.enforcement_actions a on a.id=p.action_id;

-- Keep just the latest date when case cleanup removes the source of a clock.
-- Live decisions (including pre-migration records) are read directly.
create table safety_private.job_dispute_clocks (
  request_id uuid primary key references public.requests(id) on delete cascade,
  resolved_at timestamptz not null
);
alter table safety_private.job_dispute_clocks enable row level security;
create function safety_private.keep_job_resolution_date() returns trigger
language plpgsql security invoker set search_path='' as $$
declare case_id uuid;
begin
  if tg_table_name='reports' then
    case_id := old.id;
  elsif tg_table_name='appeal_decisions' then
    select a.report_id into case_id from safety_private.appeals p
    join safety_private.enforcement_actions a on a.id=p.action_id where p.id=old.appeal_id;
  else
    case_id := old.report_id;
  end if;
  insert into safety_private.job_dispute_clocks as saved(request_id,resolved_at)
  select l.request_id,max(d.resolved_at) from safety_private.job_report_links l
  join safety_private.report_resolutions d on d.report_id=l.report_id
  where l.report_id=case_id group by l.request_id order by l.request_id
  on conflict(request_id) do update set resolved_at=greatest(saved.resolved_at,excluded.resolved_at);
  if tg_op='UPDATE' then return new; end if;
  return old;
end $$;
create trigger keep_job_resolution before delete on safety_private.report_decisions
  for each row when (old.to_status='dismissed') execute function safety_private.keep_job_resolution_date();
create trigger keep_job_resolution before delete on safety_private.appeal_decisions
  for each row execute function safety_private.keep_job_resolution_date();
create trigger keep_job_resolution before delete on safety_private.enforcement_actions
  for each row execute function safety_private.keep_job_resolution_date();
create trigger keep_job_resolution before update of request_id,message_id on safety_private.reports
  for each row when (old.request_id is distinct from new.request_id or old.message_id is distinct from new.message_id)
  execute function safety_private.keep_job_resolution_date();
revoke all on function safety_private.keep_job_resolution_date() from public,anon,authenticated,service_role;

create index deletion_evidence_notice_request_idx on safety_private.deletion_evidence_batches(notice_request_id)
  where notice_request_id is not null;

-- A held notice can point to an offer or a message without a parent reference.
create or replace function safety_private.classify_evidence_notice() returns trigger
language plpgsql security invoker set search_path='' set timezone='UTC' as $$
declare n public.notifications;
begin
  if new.target_kind <> 'notice' then return new; end if;
  select * into n from public.notifications where id=new.target_id;
  if not found then return new; end if;
  new.notice_request_id := coalesce(n.request_id,
    (select o.request_id from public.request_offers o where o.id=n.offer_id));
  new.notice_thread_id := coalesce(n.conversation_id,
    (select m.conversation_id from public.messages m where m.id=n.message_id));
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

update safety_private.deletion_evidence_batches b
set notice_request_id=coalesce(b.notice_request_id,o.request_id),
    notice_thread_id=coalesce(b.notice_thread_id,m.conversation_id)
from public.notifications n left join public.request_offers o on o.id=n.offer_id
left join public.messages m on m.id=n.message_id
where b.target_kind='notice' and b.target_id=n.id
  and ((b.notice_request_id is null and o.request_id is not null) or (b.notice_thread_id is null and m.conversation_id is not null));

create view safety_private.job_activity with (security_invoker=true) as
select request_id,participant,used_at from (
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
  UNION ALL SELECT j.request_id, party.id, c.last_message_at FROM public.request_conversations j
    JOIN public.conversations c ON c.id=j.conversation_id
    CROSS JOIN LATERAL (VALUES (j.poster_id),(j.helper_id)) party(id)
) activity(request_id,participant,used_at);
revoke all on safety_private.job_activity,safety_private.job_report_links,safety_private.report_resolutions,
  safety_private.job_dispute_clocks from public,anon,authenticated,service_role;

-- A private copy may hold its source without blocking the expiry of the copy itself.
create function safety_private.shared_job_windows(p_at timestamptz, p_request_id uuid default null)
returns table(id uuid,protected boolean,copy_blocked boolean,window_end timestamptz)
language sql stable security invoker set search_path='' set timezone='UTC' as $$
select r.id,
  state.copy_blocked
    or exists (select from public.points_ledger l where l.request_id=r.id)
    or exists (select from public.notifications n where n.request_id=r.id)
    or exists (select from public.request_offers o join public.notifications n on n.offer_id=o.id where o.request_id=r.id)
    or exists (select from safety_private.job_report_links l where l.request_id=r.id)
    or exists (select from safety_private.deletion_evidence_batches b where b.target_kind='job' and b.target_id=r.id)
    or exists (select from safety_private.deletion_evidence_batches b where b.notice_request_id=r.id)
    or exists (select from public.request_conversations j
      left join safety_private.independent_thread_windows t on t.id=j.conversation_id
      where j.request_id=r.id and (t.protected is not false or t.window_end is null or t.window_end>p_at)),
  state.copy_blocked,
  greatest(greatest(parties.last_use,dispute.last_resolved,saved.resolved_at) + interval '1 year',
           (holds.keep_through+1)::timestamp at time zone 'UTC')
from public.requests r
cross join lateral (
  select bool_or(p.deleted_at is null or d.completed_at is null) as incomplete,
         greatest(max(j.used_at),max(p.deleted_at),max(d.completed_at)) as last_use
  from safety_private.job_activity j left join public.profiles p on p.id=j.participant
  left join account_private.deletions d on d.profile_id=j.participant where j.request_id=r.id
) parties
cross join lateral (
  select max(d.resolved_at) as last_resolved from safety_private.job_report_links l
  join safety_private.report_resolutions d on d.report_id=l.report_id where l.request_id=r.id
) dispute
left join safety_private.job_dispute_clocks saved on saved.request_id=r.id
cross join lateral (
  select bool_or(x.hold_id is null) as active,max(d.through_date) as keep_through
  from safety_private.retention_holds h left join safety_private.retention_hold_releases x on x.hold_id=h.id
  left join safety_private.retention_deadlines d on d.hold_id=h.id where h.target_kind='job' and h.target_id=r.id
) holds
cross join lateral (
  select parties.incomplete is not false or r.status not in ('completed','cancelled','expired')
    or coalesce(holds.active,false)
    or exists (select from public.request_offers o where o.request_id=r.id and o.status='pending')
    or exists (select from public.request_point_reservations z where z.request_id=r.id and z.status='reserved') as copy_blocked
) state
where p_request_id is null or r.id=p_request_id;
$$;
revoke all on function safety_private.shared_job_windows(timestamptz,uuid) from public,anon,authenticated,service_role;

create or replace function safety_private.retention_source_windows(p_at timestamptz)
returns table(kind text,id uuid,protected boolean,copy_blocked boolean,window_end timestamptz)
language sql stable security invoker set search_path='' set timezone='UTC' as $$
WITH active_holds AS (
  SELECT DISTINCT h.target_kind, h.target_id
  FROM safety_private.retention_holds h
  LEFT JOIN safety_private.retention_hold_releases r ON r.hold_id = h.id
  WHERE r.hold_id IS NULL
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
select 'thread',w.id,w.protected,w.copy_blocked,w.window_end from safety_private.direct_thread_windows w
union all select 'job',j.id,j.protected,j.copy_blocked,j.window_end from safety_private.shared_job_windows(p_at) j
union all select 'case',id,protected,protected,window_end from cases;
$$;

create function safety_private.erase_expired_jobs() returns integer
language plpgsql volatile security invoker set search_path='' set lock_timeout='2s' set timezone='UTC' as $$
declare
  job_id uuid;
  removed integer := 0;
  cutoff constant timestamptz := statement_timestamp();
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Job cleanup requires a fresh read-committed snapshot.';
  end if;
  for job_id in
    -- Start with completed deletions and their jobs. Active and recent accounts
    -- do not need an expensive traversal of offers, evidence and chat history.
    select r.id from account_private.deletions d join public.requests r on r.owner_id=d.profile_id
    cross join lateral safety_private.shared_job_windows(cutoff,r.id) j
    where d.completed_at+interval '1 year'<=cutoff and r.status in ('completed','cancelled','expired')
      and not j.protected and j.window_end<=cutoff
    order by j.window_end,r.id limit 50 for update of r skip locked
  loop
    perform 1 from account_private.retention_write_gate where singleton for update skip locked;
    if not found then return removed; end if;
    begin
      -- Lock the roots of every indirect reference before taking a fresh snapshot.
      perform 1 from public.request_offers where request_id=job_id for update nowait;
      perform 1 from public.request_point_reservations where request_id=job_id for update nowait;
      perform 1 from public.request_offer_history h join public.request_offers o on o.id=h.offer_id
        where o.request_id=job_id for update of h nowait;
      perform 1 from public.request_ratings where request_id=job_id for update nowait;
      perform 1 from public.offer_notifications where request_id=job_id for update nowait;
      perform 1 from public.request_conversations j join public.conversations c on c.id=j.conversation_id
        where j.request_id=job_id for update of j,c nowait;
      perform 1 from public.request_conversations j join public.messages m on m.conversation_id=j.conversation_id
        where j.request_id=job_id for update of m nowait;
      perform 1 from public.request_conversations j join public.direct_conversation_pairs p on p.conversation_id=j.conversation_id
        where j.request_id=job_id for update of p nowait;
      perform 1 from public.request_conversations j join public.conversation_members m on m.conversation_id=j.conversation_id
        where j.request_id=job_id for update of m nowait;
      perform 1 from safety_private.job_activity j join public.profiles p on p.id=j.participant
        join account_private.deletions d on d.profile_id=j.participant where j.request_id=job_id for share of p,d nowait;
      if exists (select from safety_private.shared_job_windows(cutoff,job_id) j
                 where not j.protected and j.window_end<=cutoff) then
        -- Only the association belongs to this job. The DM worker owns the thread.
        delete from public.request_conversations where request_id=job_id;
        delete from public.requests where id=job_id;
        removed := removed+1;
      end if;
    exception when lock_not_available then
      continue;
    end;
  end loop;
  return removed;
end $$;
revoke all on function safety_private.erase_expired_jobs() from public,anon,authenticated,service_role;
commit;
