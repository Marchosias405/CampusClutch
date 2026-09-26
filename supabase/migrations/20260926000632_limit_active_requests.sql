-- Limit posted work across all categories without cancelling existing requests.
-- Accepted work still consumes a slot after its original deadline; an elapsed
-- open request no longer does, even before lazy expiration updates its status.
create index requests_owner_active_idx on public.requests(owner_id,status,deadline_at)
where status in ('open','accepted');

create function request_private.enforce_active_request_limit() returns trigger
language plpgsql volatile security invoker set search_path='' as $$
declare v_now timestamptz; v_count integer;
begin
  -- Removing a slot requires no lock. In particular, the batch expiry reader
  -- must not retain a wallet lock before moving on to its next parent row.
  if new.status not in ('open','accepted') then return new; end if;
  if new.status='open' and new.deadline_at<=clock_timestamp() then return new; end if;

  -- Existing mutations lock the parent before its wallet. New posts already
  -- hold this wallet in save_request. Never lock other requests while counting.
  perform 1 from public.points_wallets where profile_id=new.owner_id for update;
  if not found then
    raise exception 'Points wallet is unavailable. Refresh and try again.' using errcode='P0003';
  end if;
  v_now:=clock_timestamp();
  if new.status='open' and new.deadline_at<=v_now then return new; end if;

  -- Ordinary edits/reopening accepted work keep the same slot. Preserve any
  -- pre-existing over-limit requests; they can be finished, edited, or closed.
  if tg_op='UPDATE' and new.owner_id=old.owner_id
    and (old.status='accepted' or (old.status='open' and old.deadline_at>v_now)) then
    return new;
  end if;

  -- A separate query after the lock sees prior concurrent posts that committed
  -- while this transaction waited. Stop at three rather than count all history.
  select count(*) into v_count from (
    select 1 from public.requests r where r.owner_id=new.owner_id and r.id<>new.id
      and r.status in ('open','accepted')
      and (r.status='accepted' or r.deadline_at>v_now)
    limit 3
  ) active_requests;
  if v_count>=3 then
    raise exception 'You can have at most 3 active requests. Complete or cancel an active request before posting another.' using errcode='P0004';
  end if;
  return new;
end $$;
revoke all on function request_private.enforce_active_request_limit() from public,anon,authenticated;
create trigger requests_active_limit_guard
before insert or update of owner_id,status,deadline_at on public.requests
for each row execute function request_private.enforce_active_request_limit();
