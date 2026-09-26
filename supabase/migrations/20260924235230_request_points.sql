-- Task 9: one-time starter points, acceptance reservations, poster-confirmed settlement.
-- Balances include reserved points; only balance - reserved is spendable.
create table public.points_wallets (
 profile_id uuid primary key references public.profiles(id) on delete cascade,
 balance bigint not null default 100 check (balance>=0),
 reserved bigint not null default 0 check (reserved>=0 and reserved<=balance),
 updated_at timestamptz not null default clock_timestamp()
);
create table public.points_ledger (
 id uuid primary key default gen_random_uuid(),
 profile_id uuid not null references public.profiles(id) on delete cascade,
 kind text not null check(kind in ('starter_grant','request_sent','request_received')),
 amount bigint not null,
 request_id uuid references public.requests(id) on delete set null,
 offer_round integer,
 created_at timestamptz not null default clock_timestamp(),
 check ((kind='starter_grant' and amount=100 and request_id is null and offer_round is null)
   or (kind='request_sent' and amount<0 and offer_round>0)
   or (kind='request_received' and amount>0 and offer_round>0)),
 check(kind='starter_grant' or offer_round is not null)
);
create unique index points_ledger_starter_once_idx on public.points_ledger(profile_id) where kind='starter_grant';
create unique index points_ledger_request_event_once_idx on public.points_ledger(request_id,offer_round,kind);
create index points_ledger_profile_history_idx on public.points_ledger(profile_id,created_at desc,id desc);
create table public.request_point_reservations (
 request_id uuid not null references public.requests(id) on delete cascade,
 offer_round integer not null check(offer_round>0),
 poster_id uuid not null references public.profiles(id) on delete restrict,
 helper_id uuid not null references public.profiles(id) on delete restrict,
 amount bigint not null check(amount>0),
 status text not null default 'reserved' check(status in ('reserved','released','settled')),
 created_at timestamptz not null default clock_timestamp(),
 released_at timestamptz,
 settled_at timestamptz,
 primary key(request_id,offer_round),
 check(poster_id<>helper_id),
 check((status='released')=(released_at is not null)),
 check((status='settled')=(settled_at is not null))
);
create index request_point_reservations_poster_idx on public.request_point_reservations(poster_id);
create index request_point_reservations_helper_idx on public.request_point_reservations(helper_id);
alter table public.points_wallets enable row level security;
alter table public.points_ledger enable row level security;
alter table public.request_point_reservations enable row level security;
revoke all on public.points_wallets,public.points_ledger,public.request_point_reservations from public,anon,authenticated;
grant select on public.points_wallets,public.points_ledger,public.request_point_reservations to authenticated;
create policy points_wallets_read on public.points_wallets for select to authenticated
 using (profile_id=(select auth.uid()));
create policy points_ledger_read on public.points_ledger for select to authenticated
 using (profile_id=(select auth.uid()));
create policy request_point_reservations_read on public.request_point_reservations for select to authenticated
 using (poster_id=(select auth.uid()) or helper_id=(select auth.uid()));

-- Trigger-only grants cannot be invoked by clients. Updates/sign-ins never regrant.
create function request_private.create_starter_wallet() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.points_wallets(profile_id) values(new.id);
 insert into public.points_ledger(profile_id,kind,amount) values(new.id,'starter_grant',100);
 return new;
end $$;
revoke all on function request_private.create_starter_wallet() from public,anon,authenticated;
create trigger profile_starter_wallet after insert on public.profiles
 for each row execute function request_private.create_starter_wallet();
-- The profile table lock acquired for trigger creation prevents a concurrent
-- profile insert from falling between this backfill and trigger installation.
insert into public.points_wallets(profile_id) select id from public.profiles;
insert into public.points_ledger(profile_id,kind,amount) select id,'starter_grant',100 from public.profiles;

create or replace function request_private.decide_offer_core(p_offer_id uuid,p_action text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_request_id uuid; v_request public.requests; v_offer public.request_offers;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_action is null or p_action not in ('accepted','rejected','withdrawn') then
   raise exception 'Invalid offer action' using errcode='22023'; end if;
 select request_id into v_request_id from public.request_offers where id=p_offer_id;
 -- Every mutation locks parent first, then reads offer state after waiting.
 select * into v_request from public.requests where id=v_request_id for update;
 select * into v_offer from public.request_offers where id=p_offer_id for update;
 if not found or (p_action='withdrawn' and v_offer.offering_user_id<>v_user)
   or (p_action<>'withdrawn' and v_request.owner_id<>v_user) then
   raise exception 'Offer unavailable' using errcode='42501'; end if;
 -- A repeated acceptance must not reserve twice or charge historical acceptance.
 if v_offer.status=p_action then return p_offer_id; end if;
 if v_offer.status<>'pending' or v_request.status<>'open' or v_request.deadline_at<=clock_timestamp() then
   raise exception 'Offer is no longer pending on an open request' using errcode='22023'; end if;
 if p_action='accepted' then
   if not exists(select 1 from public.profiles where id=v_offer.offering_user_id and onboarding_completed_at is not null) then
     raise exception 'Helper is not eligible' using errcode='22023'; end if;
   -- UPDATE rechecks available balance after waiting on another request's wallet
   -- lock, preventing two simultaneous acceptances from spending the same points.
   update public.points_wallets set reserved=reserved+v_request.points,updated_at=clock_timestamp()
   where profile_id=v_request.owner_id and balance-reserved>=v_request.points;
   if not found then raise exception 'Not enough available points to accept this helper' using errcode='P0002'; end if;
   insert into public.request_point_reservations(request_id,offer_round,poster_id,helper_id,amount)
   values(v_request.id,v_request.offer_round,v_request.owner_id,v_offer.offering_user_id,v_request.points);
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
revoke all on function request_private.decide_offer_core(uuid,text) from public,anon,authenticated;

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
   if v_request.offer_round=p_expected_round+1 and v_request.status='open' then return p_request_id; end if;
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

create function request_private.complete_request(p_request_id uuid,p_expected_round integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_request public.requests; v_reservation public.request_point_reservations;
 v_helper uuid; v_wallet_count integer;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into v_request from public.requests where id=p_request_id and owner_id=v_user for update;
 if not found then raise exception 'Request unavailable' using errcode='42501'; end if;
 if p_expected_round is null or p_expected_round<>v_request.offer_round then
   raise exception 'Request has changed; refresh before confirming completion' using errcode='22023'; end if;
 if v_request.status='completed' then return p_request_id; end if;
 if v_request.status<>'accepted' then raise exception 'Only accepted requests can be completed' using errcode='22023'; end if;
 select offering_user_id into v_helper from public.request_offers
 where request_id=p_request_id and offer_round=v_request.offer_round and status='accepted';
 select * into v_reservation from public.request_point_reservations
 where request_id=p_request_id and offer_round=v_request.offer_round for update;
 if not found or v_helper is null or v_reservation.status<>'reserved'
   or v_reservation.poster_id<>v_user or v_reservation.helper_id<>v_helper or v_reservation.amount<>v_request.points then
   raise exception 'No reserved points for this acceptance; reopen and accept a fresh offer first' using errcode='P0003'; end if;
 -- Parent first, then wallet IDs in a global order. Reciprocal requests can
 -- complete simultaneously without each participant locking the other's wallet.
 perform profile_id from public.points_wallets where profile_id in (v_user,v_helper) order by profile_id for update;
 get diagnostics v_wallet_count=row_count;
 if v_wallet_count<>2 then raise exception 'Points wallets are unavailable' using errcode='P0003'; end if;
 update public.points_wallets set balance=balance-v_reservation.amount,reserved=reserved-v_reservation.amount,updated_at=clock_timestamp()
 where profile_id=v_user and reserved>=v_reservation.amount;
 if not found then raise exception 'Points reservation is unavailable' using errcode='P0003'; end if;
 update public.points_wallets set balance=balance+v_reservation.amount,updated_at=clock_timestamp() where profile_id=v_helper;
 insert into public.points_ledger(profile_id,kind,amount,request_id,offer_round)
 values(v_user,'request_sent',-v_reservation.amount,p_request_id,v_request.offer_round),
       (v_helper,'request_received',v_reservation.amount,p_request_id,v_request.offer_round);
 update public.request_point_reservations set status='settled',settled_at=clock_timestamp()
 where request_id=p_request_id and offer_round=v_request.offer_round;
 update public.requests set status='completed',completed_at=clock_timestamp(),updated_at=clock_timestamp() where id=p_request_id;
 return p_request_id;
end $$;
revoke all on function request_private.complete_request(uuid,integer) from public,anon,authenticated;
grant execute on function request_private.complete_request(uuid,integer) to authenticated;
create function public.complete_my_request(p_request_id uuid,p_expected_round integer) returns uuid
language sql security invoker set search_path='' as $$ select request_private.complete_request(p_request_id,p_expected_round); $$;
revoke all on function public.complete_my_request(uuid,integer) from public,anon,authenticated;
grant execute on function public.complete_my_request(uuid,integer) to authenticated;

create function request_private.my_points() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_result jsonb;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
 -- One statement gives the balance and recent ledger the same MVCC snapshot.
 select jsonb_build_object('balance',w.balance,'reserved',w.reserved,'available',w.balance-w.reserved,
   'history',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc,h.id desc) from (
     select l.id,l.kind,l.amount,l.created_at,l.request_id from public.points_ledger l
     where l.profile_id=v_user order by l.created_at desc,l.id desc limit 20
   ) h),'[]'::jsonb)) into v_result from public.points_wallets w where w.profile_id=v_user;
 if v_result is null then raise exception 'Points wallet is unavailable' using errcode='P0003'; end if;
 return v_result;
end $$;
revoke all on function request_private.my_points() from public,anon,authenticated;
grant execute on function request_private.my_points() to authenticated;
create function public.get_my_points() returns jsonb
language sql stable security invoker set search_path='' as $$ select request_private.my_points(); $$;
revoke all on function public.get_my_points() from public,anon,authenticated;
grant execute on function public.get_my_points() to authenticated;

-- Pin the amount displayed in the acceptance confirmation while holding the
-- same parent lock used by edits, reopening, and acceptance. Never fetch a newer
-- amount in the client immediately before accepting an older confirmation.
create function request_private.decide_offer_for_round(p_offer_id uuid,p_action text,p_expected_round integer,p_expected_points integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_request public.requests; v_user uuid:=auth.uid();
begin
 if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select o.request_id into v_id from public.request_offers o join public.requests r on r.id=o.request_id
 where o.id=p_offer_id and (o.offering_user_id=v_user or r.owner_id=v_user);
 if not found then raise exception 'Offer unavailable' using errcode='42501'; end if;
 select * into v_request from public.requests where id=v_id for update;
 if p_action='accepted' and v_request.owner_id<>v_user then
   raise exception 'Offer unavailable' using errcode='42501'; end if;
 if p_expected_round is null or v_request.offer_round<>p_expected_round or not exists(
   select 1 from public.request_offers where id=p_offer_id and offer_round=p_expected_round) then
   raise exception 'Offer has changed; refresh before deciding' using errcode='22023'; end if;
 if p_action='accepted' and (p_expected_points is null or p_expected_points<>v_request.points) then
   raise exception 'Refresh and confirm the points amount before accepting' using errcode='22023'; end if;
 return request_private.decide_offer_core(p_offer_id,p_action);
end $$;
revoke all on function request_private.decide_offer_for_round(uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function request_private.decide_offer_for_round(uuid,text,integer,integer) to authenticated;
create function public.decide_request_offer_for_round(p_offer_id uuid,p_action text,p_expected_round integer,p_expected_points integer) returns uuid
language sql security invoker set search_path='' as $$
 select request_private.decide_offer_for_round(p_offer_id,p_action,p_expected_round,p_expected_points);
$$;
revoke all on function public.decide_request_offer_for_round(uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.decide_request_offer_for_round(uuid,text,integer,integer) to authenticated;

-- Older clients did not confirm a points reservation. Keep their withdrawal and
-- decline actions working, but require an updated confirmation for acceptance.
create or replace function request_private.decide_offer_for_round(p_offer_id uuid,p_action text,p_expected_round integer) returns uuid
language sql security invoker set search_path='' as $$
 select request_private.decide_offer_for_round(p_offer_id,p_action,p_expected_round,null);
$$;
revoke all on function request_private.decide_offer_for_round(uuid,text,integer) from public,anon,authenticated;
grant execute on function request_private.decide_offer_for_round(uuid,text,integer) to authenticated;
