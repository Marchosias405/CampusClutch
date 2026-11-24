begin;
set local lock_timeout = '5s';
-- Keep signup/verification and deletion outside the migration's backfill window.
lock table auth.users, public.profiles, public.points_wallets in share row exclusive mode;

-- Only an opaque email fingerprint and unspent balance survive deletion.
create table points_private.returning_balances (
  email_fingerprint bytea primary key check (octet_length(email_fingerprint)=32),
  balance bigint not null check (balance>=0)
);
create table points_private.wallet_initializations (
  profile_id uuid primary key references public.profiles(id) on delete cascade
);
alter table points_private.returning_balances enable row level security;
alter table points_private.wallet_initializations enable row level security;
revoke all on points_private.returning_balances, points_private.wallet_initializations
  from public, anon, authenticated, service_role;

-- An initialized zero wallet must not mint a fresh grant by changing email.
insert into points_private.wallet_initializations(profile_id)
select w.profile_id from public.points_wallets w
where exists (select 1 from public.points_ledger l where l.profile_id=w.profile_id and l.kind='starter_grant')
or exists (select 1 from auth.users u where u.id=w.profile_id and u.email_confirmed_at is not null
  and not coalesce(u.is_anonymous,false) and u.deleted_at is null and nullif(btrim(u.email),'') is not null);

alter table public.points_ledger drop constraint points_ledger_kind_check,
  drop constraint points_ledger_check, drop constraint points_ledger_check1;
alter table public.points_ledger add constraint points_ledger_kind_check
  check(kind in ('starter_grant','balance_restored','request_sent','request_received')),
  add constraint points_ledger_check check (
    (kind='starter_grant' and amount=100 and request_id is null and offer_round is null)
    or (kind='balance_restored' and amount>=0 and request_id is null and offer_round is null)
    or (kind='request_sent' and amount<0 and offer_round>0)
    or (kind='request_received' and amount>0 and offer_round>0)),
  add constraint points_ledger_check1 check(kind in ('starter_grant','balance_restored') or offer_round is not null);

create or replace function points_private.grant_starter_points(p_profile_id uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare v_email text; v_fingerprint bytea; v_claim bytea; v_initialized boolean; v_saved bigint;
begin
  select u.email into v_email from auth.users u
  join public.profiles p on p.id=u.id and p.deleted_at is null
  where u.id=p_profile_id and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
    and u.deleted_at is null and nullif(btrim(u.email),'') is not null;
  if not found then return; end if;
  perform 1 from public.points_wallets where profile_id=p_profile_id for update;
  if not found then return; end if;
  v_fingerprint:=points_private.email_fingerprint(v_email);
  select exists(select 1 from points_private.wallet_initializations where profile_id=p_profile_id)
    into v_initialized;
  insert into points_private.starter_grant_claims(email_fingerprint) values(v_fingerprint)
    on conflict(email_fingerprint) do nothing returning email_fingerprint into v_claim;
  -- Both saving and claiming lock the wallet, then the normalized email.
  perform 1 from points_private.starter_grant_claims where email_fingerprint=v_fingerprint for update;
  delete from points_private.returning_balances where email_fingerprint=v_fingerprint returning balance into v_saved;
  if found then
    -- This is a transfer from retained funds, never a new welcome grant. A verified
    -- email change can also reclaim its saved funds without losing either balance.
    update public.points_wallets set balance=balance+v_saved,updated_at=clock_timestamp() where profile_id=p_profile_id;
    insert into public.points_ledger(profile_id,kind,amount) values(p_profile_id,'balance_restored',v_saved);
  elsif not v_initialized and v_claim is not null then
    update public.points_wallets set balance=balance+100,updated_at=clock_timestamp() where profile_id=p_profile_id;
    insert into public.points_ledger(profile_id,kind,amount) values(p_profile_id,'starter_grant',100);
  end if;
  insert into points_private.wallet_initializations(profile_id) values(p_profile_id) on conflict do nothing;
end $$;
revoke all on function points_private.grant_starter_points(uuid) from public,anon,authenticated,service_role;

-- Internal helper called only after deletion preflight, in the same transaction
-- as wallet clearing and receipt creation. Retries exit before reaching it.
create function points_private.retain_deleted_balance(p_profile_id uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare v_email text; v_fingerprint bytea; v_wallet public.points_wallets;
begin
  select email into v_email from auth.users where id=p_profile_id and email_confirmed_at is not null
    and not coalesce(is_anonymous,false) and deleted_at is null and nullif(btrim(email),'') is not null;
  if not found then
    raise exception 'Verify your email before deleting your account.' using errcode='42501';
  end if;
  select * into strict v_wallet from public.points_wallets where profile_id=p_profile_id for update;
  if v_wallet.reserved<>0 then raise exception 'Resolve reserved points before deleting.' using errcode='23514'; end if;
  v_fingerprint:=points_private.email_fingerprint(v_email);
  insert into points_private.starter_grant_claims(email_fingerprint) values(v_fingerprint) on conflict do nothing;
  perform 1 from points_private.starter_grant_claims where email_fingerprint=v_fingerprint for update;
  insert into points_private.returning_balances(email_fingerprint,balance) values(v_fingerprint,v_wallet.balance)
    on conflict(email_fingerprint) do update set balance=points_private.returning_balances.balance+excluded.balance;
end $$;
revoke all on function points_private.retain_deleted_balance(uuid) from public,anon,authenticated,service_role;

create or replace function account_private.begin_deletion(p_operation_id uuid,p_receipt_secret text,p_confirmation text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare actor uuid:=auth.uid(); readiness jsonb; existing account_private.deletions;
  claims text:=current_setting('request.jwt.claims',true);
  legacy_sub text:=current_setting('request.jwt.claim.sub',true); t record;
begin
  if actor is null or p_operation_id is null or p_receipt_secret is null
    or p_receipt_secret !~ '^[0-9a-f]{64}$' or p_confirmation is distinct from 'DELETE' then
    raise exception using errcode='22023',message='Confirm account deletion.';
  end if;
  -- Rare, short transaction. Serializing application writes makes the accepted
  -- work check atomic against acceptance/settlement and avoids a check/use gap.
  -- Lock timeout rolls back everything; ordinary reads continue throughout.
  for t in select tablename from pg_tables where schemaname='public' order by tablename loop
    execute format('lock table public.%I in share row exclusive mode',t.tablename);
  end loop;
  lock table safety_private.staff_roles,course_reviews_private.reviews,notifications_private.push_preferences in share row exclusive mode;
  select * into existing from account_private.deletions where profile_id=actor;
  if found then
    if existing.id=p_operation_id and existing.receipt_hash=extensions.digest(p_receipt_secret,'sha256') then
      return jsonb_build_object('accepted',true);
    end if;
    raise exception using errcode='42501',message='A deletion is already in progress.';
  end if;
  perform 1 from auth.users where id=actor for update;
  readiness:=account_private.deletion_preflight();
  if not (readiness->>'eligible')::boolean then
    return jsonb_build_object('accepted',false,'blockers',readiness->'blockers');
  end if;

  -- Internal cleanup still fires ordinary integrity/history triggers, but is
  -- not a student mutation. The actor was fixed and authorized above.
  perform set_config('request.jwt.claims','{}',true);
  perform set_config('request.jwt.claim.sub','',true);
  update public.requests set status='cancelled',cancelled_at=clock_timestamp()
    where owner_id=actor and status in ('open','expired');
  update public.request_offers set status='withdrawn',withdrawn_at=clock_timestamp(),decided_at=null
    where offering_user_id=actor and status='pending';
  update public.requests set title='Deleted request',description='This student deleted their account.',
    room_location='Removed',is_urgent=false,owner_archived_at=coalesce(owner_archived_at,clock_timestamp()) where owner_id=actor;
  update public.delivery_request_details set pickup_location='Removed',dropoff_location='Removed'
    where request_id in(select id from public.requests where owner_id=actor);
  update public.pickup_request_details set pickup_location='Removed',destination='Removed'
    where request_id in(select id from public.requests where owner_id=actor);
  update public.event_help_request_details set event_name='Removed',help_needed='Removed'
    where request_id in(select id from public.requests where owner_id=actor);
  update public.study_help_request_details set course_or_subject='Removed',topic='Removed'
    where request_id in(select id from public.requests where owner_id=actor);
  update public.request_offers set message=null where offering_user_id=actor;
  update public.request_offer_history set message=null where offer_id in(select id from public.request_offers where offering_user_id=actor);
  delete from public.course_memberships where profile_id=actor;
  delete from course_reviews_private.reviews where author_id=actor;
  delete from public.profile_interests where profile_id=actor;
  delete from public.profile_social_links where profile_id=actor;
  delete from notifications_private.push_preferences where profile_id=actor;
  delete from public.notifications where recipient_id=actor;
  delete from public.offer_notifications where recipient_id=actor;
  update public.notifications set actor_id=null,title='CampusClutch',body='An update is available.' where actor_id=actor;
  update public.conversations set status='closed',updated_at=clock_timestamp() where type='direct'
    and id in(select conversation_id from public.conversation_members where profile_id=actor);
  -- Group messaging is deferred, but retained historical groups must not give
  -- this identity an active membership or leave an ownerless active group.
  update public.conversations set status='closed' where type='group' and created_by=actor;
  update public.group_membership_periods p set ends_at_sequence=c.last_message_sequence,
    ended_at=clock_timestamp(),end_reason='left' from public.conversations c
    where p.conversation_id=c.id and p.profile_id=actor and p.ends_at_sequence is null;
  update public.conversation_members set membership_status='left',ended_at=clock_timestamp()
    where profile_id=actor and conversation_id in(select id from public.conversations where type='group');
  -- Retain the exact remaining balance for the same verified email. The old
  -- wallet is cleared below, so the points cannot be spent by both identities.
  perform points_private.retain_deleted_balance(actor);
  delete from public.points_ledger where profile_id=actor;
  update public.points_wallets set balance=0,updated_at=clock_timestamp() where profile_id=actor;
  update public.profiles set display_name='Deleted student',major=null,year_of_study=null,
    campus_id=null,avatar_path=null,is_discoverable=false,deleted_at=clock_timestamp() where id=actor;
  insert into account_private.deletions(id,profile_id,receipt_hash)
    values(p_operation_id,actor,extensions.digest(p_receipt_secret,'sha256'));
  delete from auth.sessions where user_id=actor;
  -- Session-linked device registrations cascade; handle any legacy registrations.
  delete from notifications_private.android_push_devices where profile_id=actor;
  perform set_config('request.jwt.claims',coalesce(claims,'{}'),true);
  perform set_config('request.jwt.claim.sub',coalesce(legacy_sub,''),true);
  return jsonb_build_object('accepted',true);
end $$;

commit;
