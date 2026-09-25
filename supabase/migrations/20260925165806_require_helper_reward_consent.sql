-- Reward changes retire helper consent atomically with the edited request.
create or replace function request_private.save_request(p_payload jsonb, p_request_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_id uuid; v_old public.requests;
  v_category text; v_details jsonb; v_keys text[]; v_deadline timestamptz;
  v_points numeric; v_key text; v_available bigint;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not exists (select 1 from public.profiles where id=v_user and onboarding_completed_at is not null) then
    raise exception 'Complete your profile first' using errcode='42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Request must be an object' using errcode='22023'; end if;
  if exists (select 1 from jsonb_object_keys(p_payload) k where k not in
    ('category','title','description','campus_id','room_location','deadline_at','points','item_size','is_urgent','details')) then
    raise exception 'Unknown or server-controlled request field' using errcode='22023'; end if;
  foreach v_key in array array['category','title','description','campus_id','room_location','deadline_at','item_size'] loop
    if jsonb_typeof(p_payload->v_key) is distinct from 'string' then
      raise exception 'Missing or invalid text field: %', v_key using errcode='22023'; end if;
  end loop;
  if jsonb_typeof(p_payload->'points') is distinct from 'number' then
    raise exception 'Points must be a positive integer' using errcode='22023'; end if;
  v_points := (p_payload->>'points')::numeric;
  if v_points <= 0 or v_points <> trunc(v_points) or v_points > 2147483647 then
    raise exception 'Points must be a positive integer' using errcode='22023'; end if;
  if p_payload ? 'is_urgent' and jsonb_typeof(p_payload->'is_urgent') is distinct from 'boolean' then
    raise exception 'Urgency must be boolean' using errcode='22023'; end if;
  v_deadline := (p_payload->>'deadline_at')::timestamptz;
  if not isfinite(v_deadline) or v_deadline <= statement_timestamp() then
    raise exception 'Deadline must be in the future' using errcode='22023'; end if;
  v_category := p_payload->>'category'; v_details := p_payload->'details';
  v_keys := case v_category
    when 'delivery' then array['pickup_location','dropoff_location']
    when 'pickup' then array['pickup_location','destination']
    when 'event_help' then array['event_name','help_needed']
    when 'study_help' then array['course_or_subject','topic'] end;
  if v_keys is null or jsonb_typeof(v_details) is distinct from 'object' then
    raise exception 'Invalid category or details' using errcode='22023'; end if;
  if exists (select 1 from jsonb_object_keys(v_details) k where not (k = any(v_keys))) then
    raise exception 'Details do not match category' using errcode='22023'; end if;
  foreach v_key in array v_keys loop
    if jsonb_typeof(v_details->v_key) is distinct from 'string' then
      raise exception 'Missing detail: %', v_key using errcode='22023'; end if;
  end loop;
  if p_request_id is not null then
    select * into v_old from public.requests where id=p_request_id and owner_id=v_user for update;
    if not found then raise exception 'Request unavailable' using errcode='42501'; end if;
    if v_old.status <> 'open' or v_old.deadline_at <= statement_timestamp() then
      raise exception 'Request is no longer editable' using errcode='22023'; end if;
    if v_old.category <> v_category then raise exception 'Category cannot change' using errcode='22023'; end if;
    v_id := v_old.id;
  end if;
  -- Edits lock the request first, matching acceptance/completion lock order.
  -- Lock the caller's wallet so a concurrent reservation/payment is reflected
  -- before saving. Posting checks affordability but does not reserve funds.
  select balance-reserved into v_available from public.points_wallets
  where profile_id=v_user for update;
  if not found then raise exception 'Points wallet is unavailable. Refresh and try again.' using errcode='P0003'; end if;
  if v_points>v_available then
    raise exception 'You have % available points. Offer no more than this amount.',v_available using errcode='P0002';
  end if;
  if p_request_id is not null then
    update public.requests set title=btrim(p_payload->>'title'), description=btrim(p_payload->>'description'),
      campus_id=(p_payload->>'campus_id')::uuid, room_location=btrim(p_payload->>'room_location'),
      offer_round=offer_round+case when points<>v_points::integer then 1 else 0 end,
      deadline_at=v_deadline, points=v_points::integer, item_size=p_payload->>'item_size',
      is_urgent=coalesce((p_payload->>'is_urgent')::boolean,false), updated_at=statement_timestamp()
    where id=v_id;
  else
    insert into public.requests(owner_id,category,title,description,campus_id,room_location,deadline_at,points,item_size,is_urgent)
    values(v_user,v_category,btrim(p_payload->>'title'),btrim(p_payload->>'description'),
      (p_payload->>'campus_id')::uuid,btrim(p_payload->>'room_location'),v_deadline,v_points::integer,
      p_payload->>'item_size',coalesce((p_payload->>'is_urgent')::boolean,false)) returning id into v_id;
  end if;
  case v_category
  when 'delivery' then
    insert into public.delivery_request_details(request_id,pickup_location,dropoff_location)
    values(v_id,btrim(v_details->>'pickup_location'),btrim(v_details->>'dropoff_location'))
    on conflict(request_id) do update set pickup_location=excluded.pickup_location, dropoff_location=excluded.dropoff_location, updated_at=statement_timestamp();
  when 'pickup' then
    insert into public.pickup_request_details(request_id,pickup_location,destination)
    values(v_id,btrim(v_details->>'pickup_location'),btrim(v_details->>'destination'))
    on conflict(request_id) do update set pickup_location=excluded.pickup_location, destination=excluded.destination, updated_at=statement_timestamp();
  when 'event_help' then
    insert into public.event_help_request_details(request_id,event_name,help_needed)
    values(v_id,btrim(v_details->>'event_name'),btrim(v_details->>'help_needed'))
    on conflict(request_id) do update set event_name=excluded.event_name, help_needed=excluded.help_needed, updated_at=statement_timestamp();
  when 'study_help' then
    insert into public.study_help_request_details(request_id,course_or_subject,topic)
    values(v_id,btrim(v_details->>'course_or_subject'),btrim(v_details->>'topic'))
    on conflict(request_id) do update set course_or_subject=excluded.course_or_subject, topic=excluded.topic, updated_at=statement_timestamp();
  end case;
  if p_request_id is not null and v_old.points<>v_points::integer then
    -- Advance the parent round first so the existing history/event triggers
    -- record earlier offers as closed, without deleting the helper's history.
    update public.request_offers set status='rejected',decided_at=clock_timestamp(),updated_at=clock_timestamp()
    where request_id=v_id and status='pending';
  end if;
  return v_id;
end $$;
revoke all on function request_private.save_request(jsonb,uuid) from public, anon;
grant execute on function request_private.save_request(jsonb,uuid) to authenticated;

create or replace function request_private.reopen_request(p_request_id uuid,p_expected_round integer,p_deadline timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_request public.requests; v_user uuid:=auth.uid(); v_reservation public.request_point_reservations;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into v_request from public.requests where id=p_request_id and owner_id=v_user for update;
 if not found then raise exception 'Request unavailable' using errcode='42501'; end if;
 if p_expected_round is null or p_expected_round<1 then raise exception 'Invalid offer round' using errcode='22023'; end if;
 if v_request.status='open' and v_request.deadline_at<=clock_timestamp() then
   raise exception 'Expired requests cannot be reopened' using errcode='22023'; end if;
 if v_request.offer_round<>p_expected_round then
   if v_request.offer_round=p_expected_round+1 and v_request.status='open' and v_request.deadline_at=p_deadline then return p_request_id; end if;
   raise exception 'Request has changed; refresh before reopening' using errcode='22023';
 end if;
 if v_request.status not in ('open','accepted') then raise exception 'Only open or accepted requests can be reopened' using errcode='22023'; end if;
 if p_deadline is null or not isfinite(p_deadline) or p_deadline<=clock_timestamp() then
   raise exception 'Choose a future deadline' using errcode='22023'; end if;
 select * into v_reservation from public.request_point_reservations
 where request_id=p_request_id and offer_round=v_request.offer_round for update;
 if found then
   if v_request.status<>'accepted' or v_reservation.status<>'reserved' or v_reservation.poster_id<>v_user then
     raise exception 'Points reservation is unavailable' using errcode='P0003'; end if;
   update public.points_wallets set reserved=reserved-v_reservation.amount,updated_at=clock_timestamp()
   where profile_id=v_user and reserved>=v_reservation.amount;
   if not found then raise exception 'Points reservation is unavailable' using errcode='P0003'; end if;
   update public.request_point_reservations set status='released',released_at=clock_timestamp()
   where request_id=p_request_id and offer_round=v_request.offer_round;
 end if;
 -- Existing accepted work without a reservation may reopen safely. No retroactive
 -- charge is created; its next acceptance must reserve available points normally.
 update public.requests set status='open',offer_round=offer_round+1,accepted_at=null,deadline_at=p_deadline,updated_at=clock_timestamp()
 where id=p_request_id;
 update public.request_offers set status='rejected',decided_at=clock_timestamp(),updated_at=clock_timestamp()
 where request_id=p_request_id and status in ('pending','accepted');
 return p_request_id;
end $$;
revoke all on function request_private.reopen_request(uuid,integer,timestamptz) from public,anon,authenticated;
grant execute on function request_private.reopen_request(uuid,integer,timestamptz) to authenticated;


create function request_private.offer_page_v3(p_request_id uuid,p_limit integer,p_offset integer)
returns table(id uuid,request_id uuid,offering_user_id uuid,status text,message text,created_at timestamptz,
 request_title text,request_status text,request_deadline_at timestamptz,
 helper_display_name text,helper_major text,helper_year smallint,helper_campus text,offer_round integer,request_offer_round integer,request_points integer)
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_ids uuid[]; v_request public.requests;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_limit is null or p_limit<1 or p_limit>50 or p_offset is null or p_offset<0 then
   raise exception 'Invalid offer page' using errcode='22023'; end if;
 select array_agg(page.id) into v_ids from (
   select o.id from public.request_offers o join public.requests r on r.id=o.request_id
   where (p_request_id is null and o.offering_user_id=v_user)
      or (r.id=p_request_id and (r.owner_id=v_user or o.offering_user_id=v_user))
   order by o.created_at desc,o.id desc limit p_limit offset p_offset
 ) page;
 -- Preserve the original authorized, parent-first expiration settlement.
 for v_request in select r.* from public.requests r
   where r.status='open' and r.deadline_at<=clock_timestamp()
   and ((r.id=p_request_id and r.owner_id=v_user) or exists (
     select 1 from public.request_offers o where o.id=any(v_ids) and o.request_id=r.id))
   order by r.id for update
 loop
   update public.requests set status='expired',updated_at=clock_timestamp() where public.requests.id=v_request.id;
 end loop;
 -- Project state and rounds in one final query. Joining rounds outside a
 -- volatile page function could mix its newer state with an older outer snapshot.
 return query select o.id,o.request_id,o.offering_user_id,o.status,o.message,o.created_at,
   r.title,r.status,r.deadline_at,p.display_name,p.major,p.year_of_study,c.display_name,
   o.offer_round,r.offer_round,r.points
 from public.request_offers o join public.requests r on r.id=o.request_id
 join public.profiles p on p.id=o.offering_user_id left join public.campuses c on c.id=p.campus_id
 where o.id=any(v_ids) order by o.created_at desc,o.id desc;
end $$;


-- Check exactly the reward and round the helper saw, before any core's
-- duplicate/retry return. All offer changes use the same parent-first lock.
create function request_private.create_offer_for_terms(p_request_id uuid,p_expected_round integer,p_expected_points integer,p_message text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_request public.requests;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into v_request from public.requests where id=p_request_id for update;
 if not found or v_request.owner_id=v_user then raise exception 'Request unavailable for offering' using errcode='42501'; end if;
 if p_expected_round is null or p_expected_round<>v_request.offer_round
    or p_expected_points is null or p_expected_points<>v_request.points then
   raise exception 'Request reward has changed; refresh and confirm the current points' using errcode='22023'; end if;
 return request_private.create_offer(p_request_id,p_message);
end $$;

create function request_private.renew_offer_for_terms(p_offer_id uuid,p_expected_round integer,p_expected_points integer,p_message text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_request_id uuid; v_request public.requests;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select request_id into v_request_id from public.request_offers where id=p_offer_id and offering_user_id=v_user;
 if not found then raise exception 'Offer unavailable' using errcode='42501'; end if;
 select * into v_request from public.requests where id=v_request_id for update;
 if not found then raise exception 'Request unavailable' using errcode='42501'; end if;
 if p_expected_round is null or p_expected_round<>v_request.offer_round
    or p_expected_points is null or p_expected_points<>v_request.points then
   raise exception 'Request reward has changed; refresh and confirm the current points' using errcode='22023'; end if;
 return request_private.renew_offer(p_offer_id,p_expected_round,p_message);
end $$;

-- Legacy public invoker wrappers cannot bypass helper consent. Only the
-- guarded definer functions above can call these unchecked private cores.
revoke all on function request_private.create_offer(uuid,text),request_private.renew_offer(uuid,integer,text) from public,anon,authenticated;
revoke all on function request_private.create_offer_for_terms(uuid,integer,integer,text),request_private.renew_offer_for_terms(uuid,integer,integer,text),request_private.offer_page_v3(uuid,integer,integer) from public,anon,authenticated;
grant execute on function request_private.create_offer_for_terms(uuid,integer,integer,text),request_private.renew_offer_for_terms(uuid,integer,integer,text),request_private.offer_page_v3(uuid,integer,integer) to authenticated;

create function public.create_my_request_offer_for_terms(p_request_id uuid,p_expected_round integer,p_expected_points integer,p_message text default null) returns uuid
language sql security invoker set search_path='' as $$ select request_private.create_offer_for_terms(p_request_id,p_expected_round,p_expected_points,p_message); $$;
create function public.renew_my_request_offer_for_terms(p_offer_id uuid,p_expected_round integer,p_expected_points integer,p_message text default null) returns uuid
language sql security invoker set search_path='' as $$ select request_private.renew_offer_for_terms(p_offer_id,p_expected_round,p_expected_points,p_message); $$;
create function public.get_request_offer_page_v3(p_request_id uuid default null,p_limit integer default 20,p_offset integer default 0)
returns table(id uuid,request_id uuid,offering_user_id uuid,status text,message text,created_at timestamptz,
 request_title text,request_status text,request_deadline_at timestamptz,
 helper_display_name text,helper_major text,helper_year smallint,helper_campus text,offer_round integer,request_offer_round integer,request_points integer)
language sql security invoker set search_path='' as $$ select * from request_private.offer_page_v3(p_request_id,p_limit,p_offset); $$;
revoke all on function public.create_my_request_offer_for_terms(uuid,integer,integer,text),public.renew_my_request_offer_for_terms(uuid,integer,integer,text),public.get_request_offer_page_v3(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.create_my_request_offer_for_terms(uuid,integer,integer,text),public.renew_my_request_offer_for_terms(uuid,integer,integer,text),public.get_request_offer_page_v3(uuid,integer,integer) to authenticated;

-- Existing open pending offers predate explicit helper reward confirmation;
-- their original agreed amount is unknown. Require confirmation once. Lock
-- and recheck each request so a concurrent acceptance is never reopened.
do $$
declare v_id uuid; v_request public.requests;
begin
 for v_id in select r.id from public.requests r where r.status='open'
   and exists(select 1 from public.request_offers o where o.request_id=r.id and o.status='pending')
   order by r.id
 loop
   select * into v_request from public.requests where id=v_id for update;
   if found and v_request.status='open' and exists(select 1 from public.request_offers where request_id=v_id and status='pending') then
     update public.requests set offer_round=offer_round+1,updated_at=clock_timestamp() where id=v_id;
     update public.request_offers set status='rejected',decided_at=clock_timestamp(),updated_at=clock_timestamp()
       where request_id=v_id and status='pending';
   end if;
 end loop;
end $$;
notify pgrst, 'reload schema';
