-- Task 9 checkpoint 3: poster-approved reopening and fresh helper consent.
alter table public.requests add column offer_round integer not null default 1 check (offer_round>0);
alter table public.request_offers add column offer_round integer not null default 1 check (offer_round>0);
alter table public.offer_notifications add column offer_round integer not null default 1 check (offer_round>0);
alter table public.offer_notifications drop constraint offer_notifications_offer_id_event_type_recipient_id_key;
alter table public.offer_notifications add constraint offer_notifications_round_event_key unique(offer_id,offer_round,event_type,recipient_id);
alter table public.offer_notifications drop constraint offer_notifications_event_type_check;
alter table public.offer_notifications add constraint offer_notifications_event_type_check check (
 event_type in ('created','accepted','rejected','withdrawn','another_accepted','request_cancelled','request_expired','request_reopened'));

-- Preserve prior offers and decisions when the same helper renews an offer.
create table public.request_offer_history (
 id bigint generated always as identity primary key,
 offer_id uuid not null references public.request_offers(id) on delete cascade,
 offer_round integer not null check(offer_round>0),
 status text not null check(status in ('pending','accepted','rejected','withdrawn')),
 message text,
 recorded_at timestamptz not null default clock_timestamp()
);
create index request_offer_history_offer_idx on public.request_offer_history(offer_id,id);
alter table public.request_offer_history enable row level security;
revoke all on public.request_offer_history from public,anon,authenticated;
grant select on public.request_offer_history to authenticated;
create policy request_offer_history_read on public.request_offer_history for select to authenticated using (
 exists(select 1 from public.request_offers o where o.id=offer_id));
insert into public.request_offer_history(offer_id,offer_round,status,message,recorded_at)
 select id,offer_round,status,message,updated_at from public.request_offers;
create function request_private.record_offer_state() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and (new.status,new.offer_round,new.message) is not distinct from (old.status,old.offer_round,old.message) then return new; end if;
 insert into public.request_offer_history(offer_id,offer_round,status,message)
 values(new.id,new.offer_round,new.status,new.message);
 return new;
end $$;
revoke all on function request_private.record_offer_state() from public,anon,authenticated;
create trigger record_request_offer_state after insert or update of status,offer_round,message on public.request_offers
for each row execute function request_private.record_offer_state();

create or replace function request_private.offer_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_owner uuid; v_request_status text; v_round integer; v_kind text; v_recipient uuid;
begin
 select owner_id,status,offer_round into v_owner,v_request_status,v_round from public.requests where id=new.request_id;
 if tg_op='INSERT' then v_kind:='created'; v_recipient:=v_owner;
 elsif new.status is not distinct from old.status then return new;
 elsif new.status='pending' then v_kind:='created'; v_recipient:=v_owner;
 elsif new.status='withdrawn' then v_kind:='withdrawn'; v_recipient:=v_owner;
 else
   v_recipient:=new.offering_user_id;
   v_kind:=case when new.status='rejected' and v_request_status='cancelled' then 'request_cancelled'
     when new.status='rejected' and v_request_status='expired' then 'request_expired'
     when new.status='rejected' and v_request_status='open' and v_round>new.offer_round then 'request_reopened'
     when new.status='rejected' and v_request_status='accepted' then 'another_accepted'
     else new.status end;
 end if;
 insert into public.offer_notifications(recipient_id,actor_id,request_id,offer_id,event_type,offer_round)
 values(v_recipient,case when v_request_status='expired' then null else auth.uid() end,new.request_id,new.id,v_kind,new.offer_round)
 on conflict(offer_id,offer_round,event_type,recipient_id) do nothing;
 return new;
end $$;

create or replace function request_private.create_offer(p_request_id uuid,p_message text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_request public.requests; v_id uuid;
begin
 if v_user is null or not exists(select 1 from public.profiles where id=v_user and onboarding_completed_at is not null) then
   raise exception 'Complete your profile first' using errcode='42501'; end if;
 select * into v_request from public.requests where id=p_request_id for update;
 if not found or v_request.owner_id=v_user then raise exception 'Request unavailable for offering' using errcode='42501'; end if;
 select id into v_id from public.request_offers where request_id=p_request_id and offering_user_id=v_user;
 if found then return v_id; end if;
 if v_request.status<>'open' or v_request.deadline_at<=clock_timestamp() then
   raise exception 'Request is no longer open' using errcode='22023'; end if;
 insert into public.request_offers(request_id,offering_user_id,message,offer_round)
 values(p_request_id,v_user,nullif(btrim(p_message),''),v_request.offer_round) returning id into v_id;
 return v_id;
end $$;

create function request_private.reopen_request(p_request_id uuid,p_expected_round integer,p_deadline timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_request public.requests; v_user uuid:=auth.uid();
begin
 if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into v_request from public.requests where id=p_request_id and owner_id=v_user for update;
 if not found then raise exception 'Request unavailable' using errcode='42501'; end if;
 if p_expected_round is null or p_expected_round<1 then raise exception 'Invalid offer round' using errcode='22023'; end if;
 -- Expiration must not depend on whether a prior read settled the stored status.
 -- Accepted work may have passed its old deadline, but reopening still requires
 -- the new future deadline checked below.
 if v_request.status='open' and v_request.deadline_at<=clock_timestamp() then
   raise exception 'Expired requests cannot be reopened' using errcode='22023'; end if;
 if v_request.offer_round<>p_expected_round then
   if v_request.offer_round=p_expected_round+1 and v_request.status='open' then return p_request_id; end if;
   raise exception 'Request has changed; refresh before reopening' using errcode='22023';
 end if;
 if v_request.status not in ('open','accepted') then raise exception 'Only open or accepted requests can be reopened' using errcode='22023'; end if;
 if p_deadline is null or not isfinite(p_deadline) or p_deadline<=clock_timestamp() then
   raise exception 'Choose a future deadline' using errcode='22023'; end if;
 update public.requests set status='open',offer_round=offer_round+1,accepted_at=null,deadline_at=p_deadline,updated_at=clock_timestamp()
 where id=p_request_id;
 -- Retire existing consent. Never silently assign or reactivate a former helper.
 update public.request_offers set status='rejected',decided_at=clock_timestamp(),updated_at=clock_timestamp()
 where request_id=p_request_id and status in ('pending','accepted');
 return p_request_id;
end $$;

create function request_private.renew_offer(p_offer_id uuid,p_expected_round integer,p_message text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_id uuid; v_request public.requests; v_offer public.request_offers;
begin
 if v_user is null or not exists(select 1 from public.profiles where id=v_user and onboarding_completed_at is not null) then
   raise exception 'Complete your profile first' using errcode='42501'; end if;
 select request_id into v_id from public.request_offers where id=p_offer_id and offering_user_id=v_user;
 if not found then raise exception 'Offer unavailable' using errcode='42501'; end if;
 select * into v_request from public.requests where id=v_id for update;
 select * into v_offer from public.request_offers where id=p_offer_id for update;
 if p_expected_round is null or p_expected_round<>v_request.offer_round then
   raise exception 'Request has changed; refresh before offering again' using errcode='22023'; end if;
 if v_offer.offer_round=v_request.offer_round then return p_offer_id; end if;
 if v_request.status<>'open' or v_request.deadline_at<=clock_timestamp() or v_offer.status not in ('rejected','withdrawn') then
   raise exception 'Request is not accepting a new offer' using errcode='22023'; end if;
 update public.request_offers set offer_round=v_request.offer_round,status='pending',message=nullif(btrim(p_message),''),
 decided_at=null,withdrawn_at=null,updated_at=clock_timestamp() where id=p_offer_id;
 return p_offer_id;
end $$;

-- Only the checked entry points may run the shared decision implementation.
-- Renaming retains the old grants, so revoke them explicitly to prevent a caller
-- from bypassing the round check through the private function's SQL privileges.
alter function request_private.decide_offer(uuid,text) rename to decide_offer_core;
revoke all on function request_private.decide_offer_core(uuid,text) from public,anon,authenticated;

-- The new UI sends the round it reviewed, so an old dialog cannot decide on
-- an offer renewed in a later round. The parent lock is held through the core
-- operation, preventing reopening or renewal between validation and mutation.
create function request_private.decide_offer_for_round(p_offer_id uuid,p_action text,p_expected_round integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_round integer; v_user uuid:=auth.uid();
begin
 if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select o.request_id into v_id from public.request_offers o join public.requests r on r.id=o.request_id
 where o.id=p_offer_id and (o.offering_user_id=v_user or r.owner_id=v_user);
 if not found then raise exception 'Offer unavailable' using errcode='42501'; end if;
 select offer_round into v_round from public.requests where id=v_id for update;
 if p_expected_round is null or v_round<>p_expected_round or not exists(
   select 1 from public.request_offers where id=p_offer_id and offer_round=p_expected_round) then
   raise exception 'Offer has changed; refresh before deciding' using errcode='22023'; end if;
 return request_private.decide_offer_core(p_offer_id,p_action);
end $$;

-- The legacy call has no expected-round argument. Treat it as round 1 rather
-- than letting an old app or delayed retry act on renewed consent. Rebind the
-- public wrapper explicitly so it cannot retain a dependency on the renamed core.
create function request_private.decide_offer(p_offer_id uuid,p_action text) returns uuid
language sql security invoker set search_path='' as $$
 select request_private.decide_offer_for_round(p_offer_id,p_action,1);
$$;
revoke all on function request_private.decide_offer(uuid,text) from public,anon,authenticated;
grant execute on function request_private.decide_offer(uuid,text) to authenticated;
create or replace function public.decide_request_offer(p_offer_id uuid,p_action text) returns uuid
language sql security invoker set search_path='' as $$ select request_private.decide_offer(p_offer_id,p_action); $$;
revoke all on function public.decide_request_offer(uuid,text) from public,anon,authenticated;
grant execute on function public.decide_request_offer(uuid,text) to authenticated;

create function request_private.offer_page_v2(p_request_id uuid,p_limit integer,p_offset integer)
returns table(id uuid,request_id uuid,offering_user_id uuid,status text,message text,created_at timestamptz,
 request_title text,request_status text,request_deadline_at timestamptz,
 helper_display_name text,helper_major text,helper_year smallint,helper_campus text,offer_round integer,request_offer_round integer)
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
   o.offer_round,r.offer_round
 from public.request_offers o join public.requests r on r.id=o.request_id
 join public.profiles p on p.id=o.offering_user_id left join public.campuses c on c.id=p.campus_id
 where o.id=any(v_ids) order by o.created_at desc,o.id desc;
end $$;
revoke all on function request_private.reopen_request(uuid,integer,timestamptz),request_private.renew_offer(uuid,integer,text),
 request_private.decide_offer_for_round(uuid,text,integer),request_private.offer_page_v2(uuid,integer,integer) from public,anon,authenticated;
grant execute on function request_private.reopen_request(uuid,integer,timestamptz),request_private.renew_offer(uuid,integer,text),
 request_private.decide_offer_for_round(uuid,text,integer),request_private.offer_page_v2(uuid,integer,integer) to authenticated;

create function public.reopen_my_request(p_request_id uuid,p_expected_round integer,p_deadline timestamptz) returns uuid
language sql security invoker set search_path='' as $$ select request_private.reopen_request(p_request_id,p_expected_round,p_deadline); $$;
create function public.renew_my_request_offer(p_offer_id uuid,p_expected_round integer,p_message text default null) returns uuid
language sql security invoker set search_path='' as $$ select request_private.renew_offer(p_offer_id,p_expected_round,p_message); $$;
create function public.decide_request_offer_for_round(p_offer_id uuid,p_action text,p_expected_round integer) returns uuid
language sql security invoker set search_path='' as $$ select request_private.decide_offer_for_round(p_offer_id,p_action,p_expected_round); $$;
create function public.get_request_offer_page_v2(p_request_id uuid default null,p_limit integer default 20,p_offset integer default 0)
returns table(id uuid,request_id uuid,offering_user_id uuid,status text,message text,created_at timestamptz,
 request_title text,request_status text,request_deadline_at timestamptz,
 helper_display_name text,helper_major text,helper_year smallint,helper_campus text,offer_round integer,request_offer_round integer)
language sql security invoker set search_path='' as $$ select * from request_private.offer_page_v2(p_request_id,p_limit,p_offset); $$;
revoke all on function public.reopen_my_request(uuid,integer,timestamptz),public.renew_my_request_offer(uuid,integer,text),
 public.decide_request_offer_for_round(uuid,text,integer),public.get_request_offer_page_v2(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.reopen_my_request(uuid,integer,timestamptz),public.renew_my_request_offer(uuid,integer,text),
 public.decide_request_offer_for_round(uuid,text,integer),public.get_request_offer_page_v2(uuid,integer,integer) to authenticated;
