-- Require affordable points when creating or editing, as well as accepting.
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
  return v_id;
end $$;
revoke all on function request_private.save_request(jsonb,uuid) from public, anon;
grant execute on function request_private.save_request(jsonb,uuid) to authenticated;
