-- Task 8, stage 1: request persistence and owner-only mutations.
-- Offers, acceptance, completion, moderation and retention are later workflows.
create schema request_private;
revoke all on schema request_private from public, anon, authenticated;
grant usage on schema request_private to authenticated;

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  category text not null check (category in ('delivery','pickup','event_help','study_help')),
  title text not null check (char_length(title) between 1 and 120 and title = btrim(title)),
  description text not null check (char_length(description) between 10 and 4000 and description = btrim(description)),
  campus_id uuid not null references public.campuses(id),
  room_location text not null check (char_length(room_location) between 1 and 240 and room_location = btrim(room_location)),
  deadline_at timestamptz not null check (isfinite(deadline_at)),
  points integer not null check (points > 0),
  item_size text not null check (item_size in ('small','medium','large')),
  status text not null default 'open' check (status in ('open','accepted','completed','cancelled','expired')),
  is_urgent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  unique (id, category),
  check ((status = 'cancelled') = (cancelled_at is not null))
);
create index requests_owner_history_idx on public.requests(owner_id, created_at desc, id desc);
create index requests_campus_idx on public.requests(campus_id);
create index requests_feed_idx on public.requests(is_urgent desc, created_at desc, id desc) where status = 'open';
create index requests_category_feed_idx on public.requests(category, is_urgent desc, created_at desc, id desc) where status = 'open';
create index requests_deadline_idx on public.requests(deadline_at) where status = 'open';
alter table public.requests enable row level security;
revoke all on public.requests from public, anon, authenticated;
grant select on public.requests to authenticated;
create policy requests_read on public.requests for select to authenticated
using (owner_id = (select auth.uid()) or (status = 'open' and deadline_at > statement_timestamp()));

create table public.delivery_request_details (
  request_id uuid primary key,
  category text not null default 'delivery' check (category = 'delivery'),
  pickup_location text not null check (char_length(pickup_location) between 1 and 240 and pickup_location = btrim(pickup_location)),
  dropoff_location text not null check (char_length(dropoff_location) between 1 and 240 and dropoff_location = btrim(dropoff_location)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (request_id, category) references public.requests(id, category) on delete cascade
);
alter table public.delivery_request_details enable row level security;
revoke all on public.delivery_request_details from public, anon, authenticated;
grant select on public.delivery_request_details to authenticated;
create policy delivery_request_details_read on public.delivery_request_details for select to authenticated
using (exists (select 1 from public.requests r where r.id = request_id));

create table public.pickup_request_details (
  request_id uuid primary key,
  category text not null default 'pickup' check (category = 'pickup'),
  pickup_location text not null check (char_length(pickup_location) between 1 and 240 and pickup_location = btrim(pickup_location)),
  destination text not null check (char_length(destination) between 1 and 240 and destination = btrim(destination)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (request_id, category) references public.requests(id, category) on delete cascade
);
alter table public.pickup_request_details enable row level security;
revoke all on public.pickup_request_details from public, anon, authenticated;
grant select on public.pickup_request_details to authenticated;
create policy pickup_request_details_read on public.pickup_request_details for select to authenticated
using (exists (select 1 from public.requests r where r.id = request_id));

create table public.event_help_request_details (
  request_id uuid primary key,
  category text not null default 'event_help' check (category = 'event_help'),
  event_name text not null check (char_length(event_name) between 1 and 240 and event_name = btrim(event_name)),
  help_needed text not null check (char_length(help_needed) between 1 and 2000 and help_needed = btrim(help_needed)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (request_id, category) references public.requests(id, category) on delete cascade
);
alter table public.event_help_request_details enable row level security;
revoke all on public.event_help_request_details from public, anon, authenticated;
grant select on public.event_help_request_details to authenticated;
create policy event_help_request_details_read on public.event_help_request_details for select to authenticated
using (exists (select 1 from public.requests r where r.id = request_id));

create table public.study_help_request_details (
  request_id uuid primary key,
  category text not null default 'study_help' check (category = 'study_help'),
  course_or_subject text not null check (char_length(course_or_subject) between 1 and 240 and course_or_subject = btrim(course_or_subject)),
  topic text not null check (char_length(topic) between 1 and 2000 and topic = btrim(topic)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (request_id, category) references public.requests(id, category) on delete cascade
);
alter table public.study_help_request_details enable row level security;
revoke all on public.study_help_request_details from public, anon, authenticated;
grant select on public.study_help_request_details to authenticated;
create policy study_help_request_details_read on public.study_help_request_details for select to authenticated
using (exists (select 1 from public.requests r where r.id = request_id));

-- Deferred checks allow atomic parent/detail insertion but reject incomplete
-- records even when a trusted SQL writer bypasses the RPCs.
create function request_private.check_details() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_ids uuid[]; v_count integer;
begin
  if tg_table_name = 'requests' then v_ids := array[new.id];
  elsif tg_op = 'DELETE' then v_ids := array[old.request_id];
  elsif tg_op = 'UPDATE' then v_ids := array[old.request_id,new.request_id];
  else v_ids := array[new.request_id]; end if;
  foreach v_id in array v_ids loop
  if not exists (select 1 from public.requests where id = v_id) then continue; end if;
  select (select count(*) from public.delivery_request_details where request_id=v_id)
       + (select count(*) from public.pickup_request_details where request_id=v_id)
       + (select count(*) from public.event_help_request_details where request_id=v_id)
       + (select count(*) from public.study_help_request_details where request_id=v_id) into v_count;
  if v_count <> 1 then raise exception 'Request requires exactly one matching detail row' using errcode='23514'; end if;
  end loop;
  return null;
end $$;
revoke all on function request_private.check_details() from public, anon, authenticated;
create constraint trigger requests_complete after insert or update on public.requests
deferrable initially deferred for each row execute function request_private.check_details();
create constraint trigger delivery_request_details_complete after insert or update or delete on public.delivery_request_details
deferrable initially deferred for each row execute function request_private.check_details();
create constraint trigger pickup_request_details_complete after insert or update or delete on public.pickup_request_details
deferrable initially deferred for each row execute function request_private.check_details();
create constraint trigger event_help_request_details_complete after insert or update or delete on public.event_help_request_details
deferrable initially deferred for each row execute function request_private.check_details();
create constraint trigger study_help_request_details_complete after insert or update or delete on public.study_help_request_details
deferrable initially deferred for each row execute function request_private.check_details();

-- This private SECURITY DEFINER function is deliberately the only write path:
-- it derives ownership from auth.uid(), locks edits, rejects server-owned keys,
-- validates typed JSON and creates/edits common and detail rows atomically.
create function request_private.save_request(p_payload jsonb, p_request_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_id uuid; v_old public.requests;
  v_category text; v_details jsonb; v_keys text[]; v_deadline timestamptz;
  v_points numeric; v_key text;
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
create function public.save_my_request(p_payload jsonb, p_request_id uuid default null)
returns uuid language sql security invoker set search_path='' as $$
  select request_private.save_request(p_payload,p_request_id);
$$;
revoke all on function public.save_my_request(jsonb,uuid) from public, anon;
grant execute on function public.save_my_request(jsonb,uuid) to authenticated;

create function request_private.cancel_request(p_request_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_row public.requests; v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into v_row from public.requests where id=p_request_id and owner_id=v_user for update;
  if not found then raise exception 'Request unavailable' using errcode='42501'; end if;
  if v_row.status='cancelled' then return; end if;
  if v_row.status <> 'open' then raise exception 'Request cannot be cancelled' using errcode='22023'; end if;
  update public.requests set status='cancelled',cancelled_at=statement_timestamp(),updated_at=statement_timestamp() where id=p_request_id;
end $$;
revoke all on function request_private.cancel_request(uuid) from public, anon;
grant execute on function request_private.cancel_request(uuid) to authenticated;
create function public.cancel_my_request(p_request_id uuid)
returns void language sql security invoker set search_path='' as $$ select request_private.cancel_request(p_request_id); $$;
revoke all on function public.cancel_my_request(uuid) from public, anon;
grant execute on function public.cancel_my_request(uuid) to authenticated;

-- UI must query status=open AND deadline_at>server time for the normal feed.
-- Owner history intentionally remains readable after expiration/cancellation.
create function public.get_request_feed(p_category text default null, p_campus_id uuid default null,
  p_limit integer default 20, p_offset integer default 0)
returns setof public.requests language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 or p_offset is null or p_offset < 0 then
    raise exception 'Invalid pagination' using errcode='22023'; end if;
  if p_category is not null and p_category not in ('delivery','pickup','event_help','study_help') then
    raise exception 'Invalid category' using errcode='22023'; end if;
  return query select r.* from public.requests r where r.status='open' and r.deadline_at > statement_timestamp()
    and (p_category is null or r.category=p_category) and (p_campus_id is null or r.campus_id=p_campus_id)
    order by r.is_urgent desc,r.created_at desc,r.id desc limit p_limit offset p_offset;
end $$;
revoke all on function public.get_request_feed(text,uuid,integer,integer) from public, anon;
grant execute on function public.get_request_feed(text,uuid,integer,integer) to authenticated;
