begin;
set local lock_timeout = '5s';

-- Offer and request-history reads can settle an overdue open row later. Its
-- status may therefore still be open when its entire retention window elapses.
create index requests_unclaimed_age_idx
  on public.requests (greatest(deadline_at, updated_at), id)
  where status in ('open', 'expired') and offer_round = 1 and owner_archived_at is null;

create view safety_private.unclaimed_request_windows with (security_invoker=true) as
select r.id,
       greatest(greatest(r.deadline_at, r.updated_at) + interval '2160 hours',
                (holds.keep_through + 1)::timestamp at time zone 'UTC') as window_end,
       coalesce(holds.active, false) as protected
from public.requests r
cross join lateral (
  select bool_or(x.hold_id is null) as active, max(d.through_date) as keep_through
  from safety_private.retention_holds h
  left join safety_private.retention_hold_releases x on x.hold_id = h.id
  left join safety_private.retention_deadlines d on d.hold_id = h.id
  where h.target_kind = 'job' and h.target_id = r.id
) holds
where r.status in ('open', 'expired') and r.offer_round = 1 and r.owner_archived_at is null
  and r.accepted_at is null and r.completed_at is null and r.cancelled_at is null
  and r.moderation_removed_at is null
  and exists (select from public.profiles p where p.id = r.owner_id and p.deleted_at is null)
  and not exists (select from account_private.deletions d where d.profile_id = r.owner_id)
  and not exists (select from public.request_offers o where o.request_id = r.id)
  and not exists (select from public.offer_notifications n where n.request_id = r.id)
  and not exists (select from public.request_point_reservations z where z.request_id = r.id)
  and not exists (select from public.points_ledger l where l.request_id = r.id)
  and not exists (select from public.request_ratings s where s.request_id = r.id)
  and not exists (select from public.request_conversations c where c.request_id = r.id)
  and not exists (select from public.notifications n where n.request_id = r.id)
  and not exists (select from safety_private.reports p where p.request_id = r.id)
  and not exists (select from safety_private.enforcement_actions a where a.incident_key = 'request:' || r.id::text)
  and not exists (select from safety_private.job_dispute_clocks c where c.request_id = r.id)
  and not exists (select from safety_private.deletion_evidence_batches b where b.target_kind = 'job' and b.target_id = r.id)
  and not exists (select from safety_private.deletion_evidence_batches b where b.notice_request_id = r.id);
revoke all on safety_private.unclaimed_request_windows from public, anon, authenticated, service_role;

-- Give a restored, never-offered post a fresh window even if a temporary
-- reference such as a bell entry currently delays the start of cleanup.
do $$
declare
  def text := pg_get_functiondef('request_private.set_request_archived(uuid,boolean)'::regprocedure);
  anchor text := 'where id=p_request_id and owner_archived_at is not null;';
begin
  if strpos(def, anchor) = 0 then raise exception 'Inspect the changed archive function before applying'; end if;
  execute replace(def, anchor, anchor || $restore$
    if found and v_request.status in ('open', 'expired') and v_request.offer_round = 1
      and v_request.accepted_at is null and v_request.completed_at is null and v_request.cancelled_at is null
      and v_request.moderation_removed_at is null
      and not exists (select from public.request_offers o where o.request_id = p_request_id) then
      update public.requests set updated_at = clock_timestamp() where id = p_request_id;
    end if;$restore$);
end $$;

create function safety_private.erase_expired_unclaimed_requests() returns integer
language plpgsql volatile security invoker set search_path='' set timezone='UTC' set lock_timeout='2s' as $$
declare
  cutoff constant timestamptz := statement_timestamp();
  candidates uuid[];
  removed integer;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Unclaimed request cleanup requires a fresh read-committed snapshot.';
  end if;

  select array_agg(batch.id) into candidates from (
    select r.id
    from public.requests r
    join safety_private.unclaimed_request_windows w on w.id = r.id
    where r.status in ('open', 'expired') and r.offer_round = 1 and r.owner_archived_at is null
      and greatest(r.deadline_at, r.updated_at) <= cutoff - interval '2160 hours'
      and not w.protected and w.window_end <= cutoff
    order by greatest(r.deadline_at, r.updated_at), r.id
    limit 50 for update of r skip locked
  ) batch;
  if candidates is null then return 0; end if;

  -- FK-backed writers acquire key-share locks on the post. Hold, access request
  -- and account deletion writers serialize using this same gate.
  perform 1 from account_private.retention_write_gate where singleton for update skip locked;
  if not found then return 0; end if;

  -- Evidence copies and incident keys can outlive the source and lack a request
  -- FK. Yield a batch to active writers and recheck committed changes below.
  begin
    lock table safety_private.deletion_evidence_batches, safety_private.enforcement_actions in share mode nowait;
  exception when lock_not_available then return 0;
  end;
  delete from public.requests r using safety_private.unclaimed_request_windows w
  where r.id = any(candidates) and w.id = r.id and not w.protected and w.window_end <= cutoff;
  get diagnostics removed = row_count;
  return removed;
end $$;
revoke all on function safety_private.erase_expired_unclaimed_requests() from public, anon, authenticated, service_role;
commit;
