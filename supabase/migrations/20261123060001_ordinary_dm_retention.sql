begin;
set local lock_timeout = '5s';

create index deletion_evidence_notice_thread_idx on safety_private.deletion_evidence_batches(notice_thread_id)
  where notice_thread_id is not null;

-- Separate the source dependencies from the conditions on a private evidence copy.
-- A remaining copy can protect the source without blocking its own eventual erasure.
create view safety_private.direct_thread_windows with (security_invoker=true) as
select c.id,
  state.copy_blocked
    or exists (select from public.request_conversations j where j.conversation_id=c.id)
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
revoke all on safety_private.direct_thread_windows from public, anon, authenticated, service_role;

create or replace function safety_private.retention_source_windows(p_at timestamptz)
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
select 'thread',w.id,w.protected,w.copy_blocked,w.window_end from safety_private.direct_thread_windows w
union all select 'job',id,(copy_blocked or protected),copy_blocked,window_end from jobs
union all select 'case',id,protected,protected,window_end from cases;
$$;

-- No input IDs or client-supplied clock. Sweep only after an operator enables the schedule.
create function safety_private.erase_expired_direct_threads() returns integer
language plpgsql volatile security invoker set search_path='' set lock_timeout='2s' as $$
declare
  thread_id uuid;
  removed integer := 0;
  cutoff constant timestamptz := statement_timestamp();
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'DM cleanup requires a fresh read-committed snapshot.';
  end if;
  if not exists (select from safety_private.direct_thread_windows where not protected and window_end <= cutoff) then
    return 0;
  end if;

  -- Hold placement/release, evidence capture and account deletion take this same lock.
  perform 1 from account_private.retention_write_gate where singleton for update skip locked;
  if not found then return 0; end if;

  for thread_id in
    select w.id from safety_private.direct_thread_windows w
    join public.conversations c on c.id=w.id
    where not w.protected and w.window_end <= cutoff
    order by w.window_end,w.id limit 50 for update of c skip locked
  loop
    begin
      -- Lock both FK targets before the fresh eligibility check. A concurrent report
      -- or notice can reference an individual message even without a thread foreign key.
      perform 1 from public.messages where conversation_id=thread_id for update nowait;
      perform 1 from public.direct_conversation_pairs where conversation_id=thread_id for update nowait;
      perform 1 from public.conversation_members where conversation_id=thread_id for update nowait;
      perform 1 from public.conversation_members m
        join public.profiles p on p.id=m.profile_id
        join account_private.deletions d on d.profile_id=m.profile_id
        where m.conversation_id=thread_id for share of p,d nowait;
      if exists (select from safety_private.direct_thread_windows
                 where id=thread_id and not protected and window_end <= cutoff) then
        -- Per-message read receipts cascade. All other owned rows use restrictive FKs.
        delete from public.messages where conversation_id=thread_id;
        delete from public.group_membership_periods where conversation_id=thread_id;
        delete from public.conversation_members where conversation_id=thread_id;
        delete from public.direct_conversation_pairs where conversation_id=thread_id;
        delete from public.conversations where id=thread_id;
        removed := removed + 1;
      end if;
    exception when lock_not_available then
      -- Roll back this thread's work and retry on a subsequent sweep.
      continue;
    end;
  end loop;
  return removed;
end $$;
revoke all on function safety_private.erase_expired_direct_threads() from public, anon, authenticated, service_role;
commit;
