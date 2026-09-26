-- Task 9: verified participants may rate each other after confirmed completion.
-- Scores are immutable and stay private until both participants submit. There is
-- no automatic publication deadline: only a pair contributes to reliability.
create table public.request_ratings (
  request_id uuid not null,
  offer_round integer not null check (offer_round > 0),
  rater_id uuid not null references public.profiles(id) on delete restrict,
  ratee_id uuid not null references public.profiles(id) on delete restrict,
  score smallint not null check (score between 1 and 5),
  created_at timestamptz not null default clock_timestamp(),
  published_at timestamptz,
  primary key (request_id, offer_round, rater_id),
  unique (request_id, offer_round, ratee_id),
  foreign key (request_id, offer_round)
    references public.request_point_reservations(request_id, offer_round) on delete cascade,
  check (rater_id <> ratee_id),
  check (published_at is null or published_at >= created_at)
);
create index request_ratings_rater_idx on public.request_ratings(rater_id);
create index request_ratings_ratee_idx on public.request_ratings(ratee_id);
create index request_ratings_published_summary_idx
  on public.request_ratings(ratee_id) include (score) where published_at is not null;

alter table public.request_ratings enable row level security;
revoke all on public.request_ratings from public, anon, authenticated;
grant select on public.request_ratings to authenticated;
create policy request_ratings_participant_read on public.request_ratings
for select to authenticated using (
  rater_id = (select auth.uid())
  or (ratee_id = (select auth.uid()) and published_at is not null)
);
comment on table public.request_ratings is
  'Immutable participant reliability scores for settled completed requests; both scores publish together.';

create function request_private.submit_rating(
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

  -- Match lifecycle operations: parent first. Concurrent submissions serialize
  -- here, including exact retries, different-score retries and the second vote.
  select r.* into v_request from public.requests r
  where r.id = p_request_id and (
    r.owner_id = v_user or exists (
      select 1 from public.request_point_reservations pr
      where pr.request_id = r.id and pr.offer_round = r.offer_round
        and pr.helper_id = v_user
    )
  ) for update;
  if not found then
    raise exception 'Request unavailable for rating' using errcode = '42501';
  end if;
  if p_expected_round is null or p_expected_round <> v_request.offer_round then
    raise exception 'Request has changed; refresh before rating' using errcode = '22023';
  end if;
  if p_score is null or p_score not between 1 and 5 then
    raise exception 'Choose a rating from 1 to 5 stars' using errcode = '22023';
  end if;
  if v_request.status <> 'completed' then
    raise exception 'Only completed requests can be rated' using errcode = '22023';
  end if;

  -- The settled reservation records the verified final helper and poster.
  -- Earlier helpers, rejected offers and legacy unreserved completions do not
  -- establish a rating relationship. The client never supplies the recipient.
  select * into v_reservation from public.request_point_reservations
  where request_id = p_request_id and offer_round = v_request.offer_round;
  if not found or v_reservation.status <> 'settled'
    or v_reservation.poster_id <> v_request.owner_id
    or v_user not in (v_reservation.poster_id, v_reservation.helper_id) then
    raise exception 'A confirmed points settlement is required before rating' using errcode = '22023';
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

create function public.submit_request_rating(
  p_request_id uuid, p_expected_round integer, p_score integer
) returns uuid language sql security invoker set search_path = '' as $$
  select request_private.submit_rating(p_request_id, p_expected_round, p_score);
$$;
revoke all on function public.submit_request_rating(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.submit_request_rating(uuid, integer, integer) to authenticated;

create function request_private.rating_context(p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_result jsonb;
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  -- One snapshot prevents a concurrent second rating from mixing unpublished
  -- state with its score. Null hides the panel for every ineligible viewer.
  select jsonb_build_object(
    'eligible', true,
    'request_id', r.id,
    'offer_round', r.offer_round,
    'counterparty_id', p.id,
    'counterparty_display_name', p.display_name,
    'counterparty_role', case when v_user = pr.poster_id then 'helper' else 'poster' end,
    'my_score', mine.score,
    'published', mine.published_at is not null and theirs.published_at is not null,
    'received_score', case when mine.published_at is not null and theirs.published_at is not null
      then theirs.score else null end
  ) into v_result
  from public.requests r
  join public.request_point_reservations pr
    on pr.request_id = r.id and pr.offer_round = r.offer_round
    and pr.status = 'settled' and pr.poster_id = r.owner_id
  join public.profiles p on p.id = case when v_user = pr.poster_id
    then pr.helper_id else pr.poster_id end
  left join public.request_ratings mine
    on mine.request_id = r.id and mine.offer_round = r.offer_round and mine.rater_id = v_user
  left join public.request_ratings theirs
    on theirs.request_id = r.id and theirs.offer_round = r.offer_round
      and theirs.rater_id = p.id and theirs.ratee_id = v_user
  where r.id = p_request_id and r.status = 'completed'
    and v_user in (pr.poster_id, pr.helper_id);
  return v_result;
end $$;
revoke all on function request_private.rating_context(uuid) from public, anon, authenticated;
grant execute on function request_private.rating_context(uuid) to authenticated;

create function public.get_request_rating_context(p_request_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select request_private.rating_context(p_request_id);
$$;
revoke all on function public.get_request_rating_context(uuid) from public, anon, authenticated;
grant execute on function public.get_request_rating_context(uuid) to authenticated;

create function request_private.profile_rating_summary(p_profile_id uuid, p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_result jsonb;
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  -- Private profiles remain private. An explicit request grants only the same
  -- helper/poster relationship already available through authorized offers.
  -- No private-profile enumeration is enabled by knowing a profile UUID.
  select jsonb_build_object(
    'profile_id', p.id,
    'average_score', scores.average_score,
    'rating_count', scores.rating_count
  ) into v_result
  from public.profiles p
  cross join lateral (
    select round(avg(rr.score), 2) as average_score, count(*) as rating_count
    from public.request_ratings rr
    where rr.ratee_id = p.id and rr.published_at is not null
  ) scores
  where p.id = p_profile_id and (
    p.id = v_user
    or (p.is_discoverable and p.onboarding_completed_at is not null and p.display_name is not null)
    or exists (
      select 1 from public.requests r
      join public.request_offers o on o.request_id = r.id
      where r.id = p_request_id and (
        (r.owner_id = v_user and o.offering_user_id = p.id)
        or (o.offering_user_id = v_user and r.owner_id = p.id)
      )
    )
  );
  if v_result is null then
    raise exception 'Profile rating unavailable' using errcode = '42501';
  end if;
  return v_result;
end $$;
revoke all on function request_private.profile_rating_summary(uuid, uuid) from public, anon, authenticated;
grant execute on function request_private.profile_rating_summary(uuid, uuid) to authenticated;

create function public.get_profile_rating_summary(p_profile_id uuid, p_request_id uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select request_private.profile_rating_summary(p_profile_id, p_request_id);
$$;
revoke all on function public.get_profile_rating_summary(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_profile_rating_summary(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
