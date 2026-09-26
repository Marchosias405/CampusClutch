-- Owners can cancel accepted work without settling payment, and hide closed
-- requests from their own default history without deleting either user's audit.
alter table public.requests add column owner_archived_at timestamptz;
alter table public.requests add constraint requests_archive_closed_check
check (owner_archived_at is null or status in ('expired','cancelled','completed'));

-- The private definer owns these coordinated writes; the public wrapper remains
-- an invoker and clients retain read-only table access. Both status and round are
-- pinned so a stale open-request confirmation cannot cancel newly accepted work.
create function request_private.cancel_request_for_round(
  p_request_id uuid, p_expected_round integer, p_expected_status text
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_user uuid:=auth.uid(); v_request public.requests;
  v_reservation public.request_point_reservations; v_helper uuid;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into v_request from public.requests
  where id=p_request_id and owner_id=v_user for update;
  if not found then raise exception 'Request unavailable' using errcode='42501'; end if;
  if p_expected_round is null or p_expected_round<>v_request.offer_round
    or p_expected_status is null or p_expected_status not in ('open','accepted') then
    raise exception 'Request has changed; refresh before cancelling' using errcode='22023';
  end if;
  -- A retry after successful cancellation must not release or notify twice.
  if v_request.status='cancelled' then return p_request_id; end if;
  if v_request.status<>p_expected_status then
    raise exception 'Request has changed; refresh before cancelling' using errcode='22023';
  end if;
  if v_request.status='open' and v_request.deadline_at<=clock_timestamp() then
    raise exception 'This request has expired; archive it instead' using errcode='22023';
  end if;

  -- All lifecycle mutations lock the parent before reservation and wallet rows.
  -- Cancelling accepted work releases the hold; neither balance nor ledger moves.
  select * into v_reservation from public.request_point_reservations
  where request_id=p_request_id and offer_round=v_request.offer_round for update;
  if found then
    select offering_user_id into v_helper from public.request_offers
    where request_id=p_request_id and offer_round=v_request.offer_round and status='accepted';
    if v_request.status<>'accepted' or v_reservation.status<>'reserved'
      or v_reservation.poster_id<>v_user or v_reservation.amount<>v_request.points
      or v_helper is null or v_reservation.helper_id<>v_helper then
      raise exception 'Points reservation is unavailable' using errcode='P0003';
    end if;
    update public.points_wallets
    set reserved=reserved-v_reservation.amount,updated_at=clock_timestamp()
    where profile_id=v_user and reserved>=v_reservation.amount;
    if not found then raise exception 'Points reservation is unavailable' using errcode='P0003'; end if;
    update public.request_point_reservations
    set status='released',released_at=clock_timestamp()
    where request_id=p_request_id and offer_round=v_request.offer_round;
  end if;
  -- Accepted requests from before reservations existed may close without a
  -- reservation, matching reopening. Never invent a historical charge/refund.
  update public.requests
  set status='cancelled',cancelled_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=p_request_id;
  -- The existing parent trigger settles pending offers; this also closes the
  -- accepted helper, preserving state history and its cancellation notification.
  update public.request_offers
  set status='rejected',decided_at=clock_timestamp(),updated_at=clock_timestamp()
  where request_id=p_request_id and offer_round=v_request.offer_round
    and status in ('pending','accepted');
  return p_request_id;
end $$;
revoke all on function request_private.cancel_request_for_round(uuid,integer,text) from public,anon,authenticated;
grant execute on function request_private.cancel_request_for_round(uuid,integer,text) to authenticated;
create function public.cancel_my_request_for_round(
  p_request_id uuid, p_expected_round integer, p_expected_status text
) returns uuid language sql security invoker set search_path='' as $$
  select request_private.cancel_request_for_round(p_request_id,p_expected_round,p_expected_status);
$$;
revoke all on function public.cancel_my_request_for_round(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.cancel_my_request_for_round(uuid,integer,text) to authenticated;

create function request_private.set_request_archived(p_request_id uuid,p_archived boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_request public.requests;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into v_request from public.requests
  where id=p_request_id and owner_id=v_user for update;
  if not found then raise exception 'Request unavailable' using errcode='42501'; end if;
  if p_archived is null then raise exception 'Choose whether to archive this request' using errcode='22023'; end if;
  if p_archived then
    if v_request.status='accepted'
      or (v_request.status='open' and v_request.deadline_at>clock_timestamp()) then
      raise exception 'Complete or cancel an active request before archiving it' using errcode='22023';
    end if;
    -- Expiration is effective at its deadline even before an offers read has
    -- settled it. Settle it here to close pending offers in the same transaction.
    if v_request.status='open' then
      update public.requests set status='expired',updated_at=clock_timestamp()
      where id=p_request_id;
    end if;
    update public.requests set owner_archived_at=clock_timestamp()
    where id=p_request_id and owner_archived_at is null;
  else
    -- Restoring history never reopens work, reserves points, or uses a slot.
    update public.requests set owner_archived_at=null
    where id=p_request_id and owner_archived_at is not null;
  end if;
  return p_request_id;
end $$;
revoke all on function request_private.set_request_archived(uuid,boolean) from public,anon,authenticated;
grant execute on function request_private.set_request_archived(uuid,boolean) to authenticated;
create function public.set_my_request_archived(p_request_id uuid,p_archived boolean)
returns uuid language sql security invoker set search_path='' as $$
  select request_private.set_request_archived(p_request_id,p_archived);
$$;
revoke all on function public.set_my_request_archived(uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_my_request_archived(uuid,boolean) to authenticated;

notify pgrst, 'reload schema';
