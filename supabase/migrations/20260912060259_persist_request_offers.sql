-- Task 9 checkpoint 1: offers and atomic decisions. No messaging or points transfer.
create table public.request_offers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  offering_user_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','accepted','rejected','withdrawn')),
  message text check (message is null or (char_length(message) between 1 and 1000 and message=btrim(message))),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  withdrawn_at timestamptz,
  unique (request_id,offering_user_id),
  check ((status in ('accepted','rejected')) = (decided_at is not null)),
  check ((status='withdrawn') = (withdrawn_at is not null))
);
create unique index request_offers_one_accepted_idx on public.request_offers(request_id) where status='accepted';
create index request_offers_helper_history_idx on public.request_offers(offering_user_id,created_at desc,id);
create index request_offers_request_history_idx on public.request_offers(request_id,created_at,id);
alter table public.request_offers enable row level security;
revoke all on public.request_offers from public,anon,authenticated;
grant select on public.request_offers to authenticated;

-- Caller-scoped helper avoids requests -> offers -> requests policy recursion.
create function request_private.is_accepted_helper(p_request_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists (select 1 from public.request_offers
 where request_id=p_request_id and offering_user_id=(select auth.uid()) and status='accepted');
$$;
revoke all on function request_private.is_accepted_helper(uuid) from public,anon,authenticated;
grant execute on function request_private.is_accepted_helper(uuid) to authenticated;
drop policy requests_read on public.requests;
create policy requests_read on public.requests for select to authenticated using (
 owner_id=(select auth.uid()) or (status='open' and deadline_at>statement_timestamp())
 or request_private.is_accepted_helper(id));
create policy request_offers_read on public.request_offers for select to authenticated using (
 offering_user_id=(select auth.uid()) or exists (select 1 from public.requests r
 where r.id=request_id and r.owner_id=(select auth.uid())));

-- Minimal durable event records for Task 9. Task 11 will add the notification UI
-- and read-state operations; conversations/push destinations are not invented here.
create table public.offer_notifications (
 id uuid primary key default gen_random_uuid(),
 recipient_id uuid not null references public.profiles(id) on delete cascade,
 actor_id uuid references public.profiles(id) on delete set null,
 request_id uuid not null references public.requests(id) on delete cascade,
 offer_id uuid not null references public.request_offers(id) on delete cascade,
 event_type text not null check (event_type in ('created','accepted','rejected','withdrawn','another_accepted','request_cancelled','request_expired')),
 created_at timestamptz not null default now(),
 unique (offer_id,event_type,recipient_id)
);
create index offer_notifications_recipient_idx on public.offer_notifications(recipient_id,created_at desc,id);
create index offer_notifications_request_idx on public.offer_notifications(request_id);
create index offer_notifications_actor_idx on public.offer_notifications(actor_id);
alter table public.offer_notifications enable row level security;
revoke all on public.offer_notifications from public,anon,authenticated;
grant select on public.offer_notifications to authenticated;
create policy offer_notifications_read on public.offer_notifications for select to authenticated
 using (recipient_id=(select auth.uid()));

-- Trigger-generated recipients and event uniqueness make retries notification-safe.
create function request_private.offer_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_owner uuid; v_request_status text; v_kind text; v_recipient uuid;
begin
 select owner_id,status into v_owner,v_request_status from public.requests where id=new.request_id;
 if tg_op='INSERT' then v_kind:='created'; v_recipient:=v_owner;
 elsif new.status is not distinct from old.status then return new;
 elsif new.status='withdrawn' then v_kind:='withdrawn'; v_recipient:=v_owner;
 else
   v_recipient:=new.offering_user_id;
   v_kind:=case when new.status='rejected' and v_request_status='cancelled' then 'request_cancelled'
     when new.status='rejected' and v_request_status='expired' then 'request_expired'
     when new.status='rejected' and v_request_status='accepted' then 'another_accepted'
     else new.status end;
 end if;
 insert into public.offer_notifications(recipient_id,actor_id,request_id,offer_id,event_type)
 values(v_recipient,case when v_request_status='expired' then null else auth.uid() end,new.request_id,new.id,v_kind)
 on conflict(offer_id,event_type,recipient_id) do nothing;
 return new;
end $$;
revoke all on function request_private.offer_event() from public,anon,authenticated;
create trigger request_offer_events after insert or update of status on public.request_offers
for each row execute function request_private.offer_event();

-- Request mutations already lock the parent. Closing it settles all pending
-- offers in that same transaction, including the existing Task 8 cancellation RPC.
create function request_private.settle_offers() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status in ('cancelled','expired') then
   update public.request_offers set status='rejected',decided_at=clock_timestamp(),updated_at=clock_timestamp()
   where request_id=new.id and status='pending';
 end if;
 return new;
end $$;
revoke all on function request_private.settle_offers() from public,anon,authenticated;
create trigger requests_settle_offers after update of status on public.requests
for each row when (old.status is distinct from new.status) execute function request_private.settle_offers();

create function request_private.create_offer(p_request_id uuid,p_message text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_request public.requests; v_id uuid;
begin
 if v_user is null or not exists(select 1 from public.profiles where id=v_user and onboarding_completed_at is not null) then
   raise exception 'Complete your profile first' using errcode='42501'; end if;
 select * into v_request from public.requests where id=p_request_id for update;
 if not found or v_request.owner_id=v_user then raise exception 'Request unavailable for offering' using errcode='42501'; end if;
 -- Retrying an existing offer never creates or reactivates a row, even after closure.
 select id into v_id from public.request_offers where request_id=p_request_id and offering_user_id=v_user;
 if found then return v_id; end if;
 if v_request.status<>'open' or v_request.deadline_at<=clock_timestamp() then
   raise exception 'Request is no longer open' using errcode='22023'; end if;
 insert into public.request_offers(request_id,offering_user_id,message)
 values(p_request_id,v_user,nullif(btrim(p_message),'')) returning id into v_id;
 return v_id;
end $$;

create function request_private.decide_offer(p_offer_id uuid,p_action text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_request_id uuid; v_request public.requests; v_offer public.request_offers;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_action is null or p_action not in ('accepted','rejected','withdrawn') then
   raise exception 'Invalid offer action' using errcode='22023'; end if;
 select request_id into v_request_id from public.request_offers where id=p_offer_id;
 -- Every mutation locks parent first, then reads current offer state after waiting.
 select * into v_request from public.requests where id=v_request_id for update;
 select * into v_offer from public.request_offers where id=p_offer_id for update;
 if not found or (p_action='withdrawn' and v_offer.offering_user_id<>v_user)
   or (p_action<>'withdrawn' and v_request.owner_id<>v_user) then
   raise exception 'Offer unavailable' using errcode='42501'; end if;
 if v_offer.status=p_action then return p_offer_id; end if;
 if v_offer.status<>'pending' or v_request.status<>'open' or v_request.deadline_at<=clock_timestamp() then
   raise exception 'Offer is no longer pending on an open request' using errcode='22023'; end if;
 if p_action='accepted' then
   if not exists(select 1 from public.profiles where id=v_offer.offering_user_id and onboarding_completed_at is not null) then
     raise exception 'Helper is not eligible' using errcode='22023'; end if;
   update public.requests set status='accepted',accepted_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_request.id;
 end if;
 update public.request_offers set status=p_action,updated_at=clock_timestamp(),
 decided_at=case when p_action<>'withdrawn' then clock_timestamp() end,
 withdrawn_at=case when p_action='withdrawn' then clock_timestamp() end where id=p_offer_id;
 if p_action='accepted' then
   update public.request_offers set status='rejected',updated_at=clock_timestamp(),decided_at=clock_timestamp()
   where request_id=v_request.id and status='pending';
 end if;
 return p_offer_id;
end $$;

-- Transactional read strategy: owner/helper refresh settles a passed deadline.
-- Inactive expired requests remain physically open until read, but all mutations
-- and the existing feed enforce the server deadline immediately.
create function request_private.list_offers(p_request_id uuid) returns setof public.request_offers
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_request public.requests;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into v_request from public.requests where id=p_request_id for update;
 if not found then return; end if;
 if v_request.owner_id<>v_user and not exists(select 1 from public.request_offers where request_id=p_request_id and offering_user_id=v_user) then
   return; end if;
 if v_request.status='open' and v_request.deadline_at<=clock_timestamp() then
   update public.requests set status='expired',updated_at=clock_timestamp() where id=p_request_id;
 end if;
 return query select o.* from public.request_offers o where o.request_id=p_request_id
 and (v_request.owner_id=v_user or o.offering_user_id=v_user) order by o.created_at,o.id;
end $$;

revoke all on function request_private.create_offer(uuid,text),request_private.decide_offer(uuid,text),request_private.list_offers(uuid) from public,anon,authenticated;
grant execute on function request_private.create_offer(uuid,text),request_private.decide_offer(uuid,text),request_private.list_offers(uuid) to authenticated;
create function public.create_my_request_offer(p_request_id uuid,p_message text default null) returns uuid
language sql security invoker set search_path='' as $$ select request_private.create_offer(p_request_id,p_message); $$;
create function public.decide_request_offer(p_offer_id uuid,p_action text) returns uuid
language sql security invoker set search_path='' as $$ select request_private.decide_offer(p_offer_id,p_action); $$;
create function public.get_request_offers(p_request_id uuid) returns setof public.request_offers
language sql security invoker set search_path='' as $$ select * from request_private.list_offers(p_request_id); $$;
revoke all on function public.create_my_request_offer(uuid,text),public.decide_request_offer(uuid,text),public.get_request_offers(uuid) from public,anon,authenticated;
grant execute on function public.create_my_request_offer(uuid,text),public.decide_request_offer(uuid,text),public.get_request_offers(uuid) to authenticated;
