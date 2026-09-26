-- Accepted assignments remain a verified rating relationship when cancelled.
-- Keep the reservation as the immutable round/participant record, even when an
-- offer is renewed in a later round. Pending-only offers never establish it.
alter table public.request_point_reservations
  add column helper_cancelled_at timestamptz;
alter table public.request_point_reservations
  add constraint request_reservations_helper_cancelled_check check (
    helper_cancelled_at is null
    or (status = 'released' and helper_cancelled_at >= created_at)
  );
comment on column public.request_point_reservations.helper_cancelled_at is
  'Durable idempotency marker for an accepted helper backing out of this round.';
comment on table public.request_ratings is
  'Immutable reliability scores for settled completed or released cancelled assignments; both scores publish together.';

-- Historical helpers retain access to request details after renewal/closure,
-- without giving rejected or pending-only helpers access to closed requests.
create function request_private.has_request_assignment(p_request_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.request_point_reservations pr
    where pr.request_id = p_request_id and pr.helper_id = (select auth.uid())
  );
$$;
revoke all on function request_private.has_request_assignment(uuid) from public, anon, authenticated;
grant execute on function request_private.has_request_assignment(uuid) to authenticated;
alter policy requests_read on public.requests using (
  owner_id = (select auth.uid()) or (status = 'open' and deadline_at > statement_timestamp())
  or request_private.is_accepted_helper(id)
  or request_private.has_request_assignment(id)
);

create function request_private.cancel_accepted_help(
  p_request_id uuid, p_expected_round integer
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_request public.requests;
  v_reservation public.request_point_reservations;
  v_offer_id uuid;
  v_now timestamptz;
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_expected_round is null or p_expected_round < 1 then
    raise exception 'Invalid offer round' using errcode = '22023';
  end if;
  -- Parent first, then reservation, then the poster wallet. Completion,
  -- reopening, cancellation and the active-request guard use this same order.
  select r.* into v_request from public.requests r
  where r.id = p_request_id and exists (
    select 1 from public.request_point_reservations pr
    where pr.request_id = r.id and pr.offer_round = p_expected_round
      and pr.helper_id = v_user
  ) for update;
  if not found then
    raise exception 'Accepted help unavailable' using errcode = '42501';
  end if;
  select * into v_reservation from public.request_point_reservations
  where request_id = p_request_id and offer_round = p_expected_round for update;
  if not found or v_reservation.helper_id <> v_user
    or v_reservation.poster_id <> v_request.owner_id then
    raise exception 'Points reservation is unavailable' using errcode = 'P0003';
  end if;
  -- A lost-response retry identifies this exact cancelled assignment, not the
  -- mutable offer row or a later round which might already have a new helper.
  if v_reservation.helper_cancelled_at is not null then return p_request_id; end if;
  if v_request.offer_round <> p_expected_round or v_request.status <> 'accepted' then
    raise exception 'Request has changed; refresh before cancelling help' using errcode = '22023';
  end if;
  select id into v_offer_id from public.request_offers
  where request_id = p_request_id and offer_round = p_expected_round
    and offering_user_id = v_user and status = 'accepted';
  if v_offer_id is null or v_reservation.status <> 'reserved'
    or v_reservation.amount <> v_request.points then
    raise exception 'Points reservation is unavailable' using errcode = 'P0003';
  end if;
  update public.points_wallets
  set reserved = reserved - v_reservation.amount, updated_at = clock_timestamp()
  where profile_id = v_reservation.poster_id and reserved >= v_reservation.amount;
  if not found then
    raise exception 'Points reservation is unavailable' using errcode = 'P0003';
  end if;
  v_now := clock_timestamp();
  update public.request_point_reservations
  set status = 'released', released_at = v_now, helper_cancelled_at = v_now
  where request_id = p_request_id and offer_round = p_expected_round;
  -- Preserve the poster's deadline. An elapsed deadline closes the request
  -- instead of inventing a new commitment on the poster's behalf.
  update public.requests
  set status = case when deadline_at > v_now then 'open' else 'expired' end,
    offer_round = offer_round + 1, accepted_at = null, updated_at = v_now
  where id = p_request_id;
  update public.request_offers
  set status = 'withdrawn', decided_at = null, withdrawn_at = v_now, updated_at = v_now
  where id = v_offer_id;
  update public.request_offers
  set status = 'rejected', decided_at = v_now, updated_at = v_now
  where request_id = p_request_id and status = 'pending';
  -- No balance or ledger transfer occurs for cancelled work.
  return p_request_id;
end $$;
revoke all on function request_private.cancel_accepted_help(uuid, integer) from public, anon, authenticated;
grant execute on function request_private.cancel_accepted_help(uuid, integer) to authenticated;
create function public.cancel_my_accepted_help(p_request_id uuid, p_expected_round integer)
returns uuid language sql security invoker set search_path = '' as $$
  select request_private.cancel_accepted_help(p_request_id, p_expected_round);
$$;
revoke all on function public.cancel_my_accepted_help(uuid, integer) from public, anon, authenticated;
grant execute on function public.cancel_my_accepted_help(uuid, integer) to authenticated;

create or replace function request_private.submit_rating(
  p_request_id uuid, p_expected_round integer, p_score integer
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_request public.requests;
  v_reservation public.request_point_reservations;
  v_ratee uuid;
  v_existing_score smallint;
  v_published_at timestamptz;
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  -- Serialize lifecycle changes and both votes through the parent. The helper
  -- must belong to the requested round; a later offer does not grant that role.
  select r.* into v_request from public.requests r
  where r.id = p_request_id and (
    r.owner_id = v_user or exists (
      select 1 from public.request_point_reservations pr
      where pr.request_id = r.id and pr.offer_round = p_expected_round
        and pr.helper_id = v_user
    )
  ) for update;
  if not found then
    raise exception 'Request unavailable for rating' using errcode = '42501';
  end if;
  select * into v_reservation from public.request_point_reservations
  where request_id = p_request_id and offer_round = p_expected_round;
  -- Historical rounds are eligible only through their released reservation.
  -- Current completed/settled assignments preserve the original eligibility.
  if p_expected_round is null or p_expected_round < 1
    or (p_expected_round <> v_request.offer_round and (
      v_reservation.request_id is null or v_reservation.status <> 'released'
    )) then
    raise exception 'Request has changed; refresh before rating' using errcode = '22023';
  end if;
  if p_score is null or p_score not between 1 and 5 then
    raise exception 'Choose a rating from 1 to 5 stars' using errcode = '22023';
  end if;
  if v_reservation.status is distinct from 'released' and v_request.status <> 'completed' then
    raise exception 'Only completed or cancelled accepted assignments can be rated' using errcode = '22023';
  end if;
  if v_reservation.request_id is null
    or v_reservation.poster_id <> v_request.owner_id
    or v_user not in (v_reservation.poster_id, v_reservation.helper_id)
    or not (v_reservation.status = 'released' or (
      v_reservation.status = 'settled' and v_request.status = 'completed'
      and v_reservation.offer_round = v_request.offer_round
    )) then
    raise exception 'A settled or released points reservation is required before rating' using errcode = '22023';
  end if;
  v_ratee := case when v_user = v_reservation.poster_id
    then v_reservation.helper_id else v_reservation.poster_id end;
  select score into v_existing_score from public.request_ratings
  where request_id = p_request_id and offer_round = p_expected_round and rater_id = v_user;
  if found then
    if v_existing_score = p_score then return p_request_id; end if;
    raise exception 'Your rating has already been submitted and cannot be changed' using errcode = '23505';
  end if;
  insert into public.request_ratings(request_id, offer_round, rater_id, ratee_id, score)
  values (p_request_id, p_expected_round, v_user, v_ratee, p_score);
  if exists (
    select 1 from public.request_ratings
    where request_id = p_request_id and offer_round = p_expected_round
      and rater_id = v_ratee and ratee_id = v_user
  ) then
    v_published_at := clock_timestamp();
    update public.request_ratings set published_at = v_published_at
    where request_id = p_request_id and offer_round = p_expected_round
      and published_at is null;
  end if;
  return p_request_id;
end $$;
revoke all on function request_private.submit_rating(uuid, integer, integer) from public, anon, authenticated;
grant execute on function request_private.submit_rating(uuid, integer, integer) to authenticated;

create function request_private.my_rating_contexts(
  p_request_id uuid, p_limit integer, p_offset integer
) returns setof jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 or p_offset is null or p_offset < 0 then
    raise exception 'Invalid rating page' using errcode = '22023';
  end if;
  -- One snapshot gates the received score and its published flag together.
  -- The reservation, not a mutable offer, identifies each counterparty.
  return query select jsonb_build_object(
    'eligible', true,
    'request_id', r.id,
    'offer_round', pr.offer_round,
    'outcome', case when pr.status = 'released' then 'cancelled' else 'completed' end,
    'counterparty_id', p.id,
    'counterparty_display_name', p.display_name,
    'counterparty_role', case when v_user = pr.poster_id then 'helper' else 'poster' end,
    'my_score', mine.score,
    'published', mine.published_at is not null and theirs.published_at is not null,
    'received_score', case when mine.published_at is not null and theirs.published_at is not null
      then theirs.score else null end
  )
  from public.requests r
  join public.request_point_reservations pr on pr.request_id = r.id and pr.poster_id = r.owner_id
  join public.profiles p on p.id = case when v_user = pr.poster_id
    then pr.helper_id else pr.poster_id end
  left join public.request_ratings mine
    on mine.request_id = r.id and mine.offer_round = pr.offer_round and mine.rater_id = v_user
  left join public.request_ratings theirs
    on theirs.request_id = r.id and theirs.offer_round = pr.offer_round
      and theirs.rater_id = p.id and theirs.ratee_id = v_user
  where r.id = p_request_id and v_user in (pr.poster_id, pr.helper_id)
    and (pr.status = 'released' or (pr.status = 'settled'
      and r.status = 'completed' and pr.offer_round = r.offer_round))
  order by pr.offer_round desc limit p_limit offset p_offset;
end $$;
revoke all on function request_private.my_rating_contexts(uuid, integer, integer) from public, anon, authenticated;
grant execute on function request_private.my_rating_contexts(uuid, integer, integer) to authenticated;
create function public.get_my_request_rating_contexts(
  p_request_id uuid, p_limit integer default 20, p_offset integer default 0
) returns setof jsonb language sql stable security invoker set search_path = '' as $$
  select * from request_private.my_rating_contexts(p_request_id, p_limit, p_offset);
$$;
revoke all on function public.get_my_request_rating_contexts(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.get_my_request_rating_contexts(uuid, integer, integer) to authenticated;

-- Older clients expect a single context for the current round. Never place a
-- historical helper in that panel, even if that is the only eligible round.
create or replace function request_private.rating_context(p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_result jsonb;
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select context.value - 'outcome' into v_result
  from request_private.my_rating_contexts(p_request_id, 1, 0) context(value)
  join public.requests r on r.id = p_request_id
    and r.offer_round = (context.value ->> 'offer_round')::integer;
  return v_result;
end $$;
revoke all on function request_private.rating_context(uuid) from public, anon, authenticated;
grant execute on function request_private.rating_context(uuid) to authenticated;

-- Extend the paged offer summary without changing the v3 return signature.
-- The UI can link former accepted helpers to their assignment/rating history
-- while pending-only helpers still cannot open closed request details.
create function request_private.offer_page_v4(p_request_id uuid, p_limit integer, p_offset integer)
returns table(id uuid, request_id uuid, offering_user_id uuid, status text, message text, created_at timestamptz,
  request_title text, request_status text, request_deadline_at timestamptz,
  helper_display_name text, helper_major text, helper_year smallint, helper_campus text,
  offer_round integer, request_offer_round integer, request_points integer, has_assignment_history boolean)
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_ids uuid[]; v_request public.requests;
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 or p_offset is null or p_offset < 0 then
    raise exception 'Invalid offer page' using errcode = '22023';
  end if;
  select array_agg(page.id) into v_ids from (
    select o.id from public.request_offers o join public.requests r on r.id = o.request_id
    where (p_request_id is null and o.offering_user_id = v_user)
      or (r.id = p_request_id and (r.owner_id = v_user or o.offering_user_id = v_user))
    order by o.created_at desc, o.id desc limit p_limit offset p_offset
  ) page;
  for v_request in select r.* from public.requests r
    where r.status = 'open' and r.deadline_at <= clock_timestamp()
      and ((r.id = p_request_id and r.owner_id = v_user) or exists (
        select 1 from public.request_offers o where o.id = any(v_ids) and o.request_id = r.id))
    order by r.id for update
  loop
    update public.requests set status = 'expired', updated_at = clock_timestamp()
    where public.requests.id = v_request.id;
  end loop;
  return query select o.id, o.request_id, o.offering_user_id, o.status, o.message, o.created_at,
    r.title, r.status, r.deadline_at, p.display_name, p.major, p.year_of_study, c.display_name,
    o.offer_round, r.offer_round, r.points,
    exists (select 1 from public.request_point_reservations pr
      where pr.request_id = r.id and pr.helper_id = o.offering_user_id)
  from public.request_offers o join public.requests r on r.id = o.request_id
  join public.profiles p on p.id = o.offering_user_id left join public.campuses c on c.id = p.campus_id
  where o.id = any(v_ids) order by o.created_at desc, o.id desc;
end $$;
revoke all on function request_private.offer_page_v4(uuid, integer, integer) from public, anon, authenticated;
grant execute on function request_private.offer_page_v4(uuid, integer, integer) to authenticated;
create function public.get_request_offer_page_v4(
  p_request_id uuid default null, p_limit integer default 20, p_offset integer default 0
) returns table(id uuid, request_id uuid, offering_user_id uuid, status text, message text, created_at timestamptz,
  request_title text, request_status text, request_deadline_at timestamptz,
  helper_display_name text, helper_major text, helper_year smallint, helper_campus text,
  offer_round integer, request_offer_round integer, request_points integer, has_assignment_history boolean)
language sql security invoker set search_path = '' as $$
  select * from request_private.offer_page_v4(p_request_id, p_limit, p_offset);
$$;
revoke all on function public.get_request_offer_page_v4(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.get_request_offer_page_v4(uuid, integer, integer) to authenticated;

notify pgrst, 'reload schema';
