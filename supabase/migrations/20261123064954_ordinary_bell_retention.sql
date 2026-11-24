begin;
set local lock_timeout = '5s';

-- The source event can predate insertion into the bell (e.g. an imported offer).
-- Legacy messages and completions were inserted in the same transaction as their
-- events. Historical offers imported at initial rollout have no delivery stamp.
alter table public.notifications add column delivered_at timestamptz check (isfinite(delivered_at));
alter table public.notifications alter column delivered_at set default clock_timestamp();
with first_live as (
  select coalesce(least(min(read_at), min(created_at) filter
    (where event_type in ('message_received', 'request_completed'))), statement_timestamp()) as observed_at
  from public.notifications
)
update public.notifications n set delivered_at = f.observed_at from first_live f
where n.read_at is null and n.created_at < f.observed_at and n.event_type in (
  'offer_created','offer_accepted','offer_rejected','offer_withdrawn',
  'another_helper_selected','request_cancelled','request_expired','request_reopened'
);
comment on column public.notifications.delivered_at is
  'Insertion into the bell, independent of Android delivery. Legacy rows without this stamp use created_at.';

create function safety_private.ordinary_bell_deadline(kind text, delivered timestamptz, first_read timestamptz)
returns timestamptz language sql immutable security invoker set search_path=''
return case when kind in (
  'offer_created','offer_accepted','offer_rejected','offer_withdrawn','another_helper_selected',
  'request_cancelled','request_expired','request_reopened','request_completed','message_received'
) then coalesce((first_read at time zone 'UTC') + interval '90 days',
                (delivered at time zone 'UTC') + interval '180 days') at time zone 'UTC' end;

create index notifications_bell_expiry_idx on public.notifications
  (safety_private.ordinary_bell_deadline(event_type,coalesce(delivered_at,created_at),read_at), id)
  where safety_private.ordinary_bell_deadline(event_type,coalesce(delivered_at,created_at),read_at) is not null;

-- This view lets both inventory and cleanup push their date filter down to the index.
create view safety_private.bell_windows with (security_invoker=true) as
  select n.id, n.read_at,
    safety_private.ordinary_bell_deadline(n.event_type,coalesce(n.delivered_at,n.created_at),n.read_at) as window_end,
    case when exists (select from notifications_private.push_jobs j where j.notification_id=n.id)
      then 'infinity'::date else coalesce((
      select max(case when r.hold_id is null then 'infinity'::date else d.through_date end)
      from safety_private.retention_holds h
      left join safety_private.retention_hold_releases r on r.hold_id=h.id
      left join safety_private.retention_deadlines d on d.hold_id=h.id
      where h.target_kind='notice' and h.target_id=n.id
    ), '-infinity'::date) end as protected_through
  from public.notifications n;
revoke all on safety_private.bell_windows from public,anon,authenticated,service_role;

create function safety_private.erase_expired_bell_notices() returns integer
language plpgsql volatile security invoker set search_path='' set lock_timeout='2s' as $$
declare
  cutoff constant timestamptz := statement_timestamp();
  utc_day constant date := (cutoff at time zone 'UTC')::date;
  candidates uuid[];
  removed integer;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Bell cleanup requires a fresh read-committed snapshot.';
  end if;
  if not exists (select from safety_private.bell_windows w
                 where w.window_end <= cutoff and w.protected_through < utc_day) then return 0; end if;
  perform 1 from account_private.retention_write_gate where singleton for update skip locked;
  if not found then return 0; end if;

  -- Lock the same row that a first read updates and a new push job references.
  select array_agg(batch.id) into candidates from (
    select n.id from safety_private.bell_windows w join public.notifications n on n.id=w.id
    where w.window_end <= cutoff and w.protected_through < utc_day
    order by w.window_end,n.id limit 50 for update of n skip locked
  ) batch;
  if candidates is null then return 0; end if;
  -- This second statement sees any read or delivery job committed during selection.
  delete from public.notifications n using safety_private.bell_windows w
  where n.id=any(candidates) and n.id=w.id and w.window_end <= cutoff and w.protected_through < utc_day;
  get diagnostics removed = row_count;
  return removed;
end $$;

revoke all on function safety_private.ordinary_bell_deadline(text,timestamptz,timestamptz),
  safety_private.erase_expired_bell_notices()
  from public,anon,authenticated,service_role;

-- Refresh an open inbox and badge once per affected recipient, with no push alert.
create or replace trigger notifications_broadcast_delete after delete on public.notifications
referencing old table as changed_notifications for each statement
execute function notifications_private.broadcast_changes();
commit;
