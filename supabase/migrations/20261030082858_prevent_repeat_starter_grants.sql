begin;

-- Match the lock order of signup: auth user -> profile -> wallet.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table auth.users in share row exclusive mode;
lock table public.profiles in share row exclusive mode;

create schema points_private;
revoke all on schema points_private from public, anon, authenticated, service_role;

create table points_private.email_key (
  singleton boolean primary key default true check (singleton),
  secret bytea not null check (octet_length(secret) = 32)
);
create table points_private.starter_grant_claims (
  email_fingerprint bytea primary key check (octet_length(email_fingerprint) = 32),
  claimed_at timestamptz not null default clock_timestamp()
);
comment on table points_private.starter_grant_claims is
  'Private welcome-points abuse-prevention receipts. Intentionally survive account deletion; no email text or account identifier is retained.';
comment on table points_private.email_key is
  'Persistent HMAC key for welcome-point receipts. Never rotate or recreate without migrating existing fingerprints.';
alter table points_private.email_key enable row level security;
alter table points_private.starter_grant_claims enable row level security;
revoke all on points_private.email_key, points_private.starter_grant_claims
  from public, anon, authenticated, service_role;
insert into points_private.email_key(singleton, secret)
values (true, extensions.gen_random_bytes(32));

create function points_private.email_fingerprint(p_email text) returns bytea
language plpgsql stable strict security invoker set search_path = '' as $$
declare v_secret bytea;
begin
  select secret into strict v_secret from points_private.email_key where singleton;
  return extensions.hmac(convert_to(lower(btrim(p_email)), 'UTF8'), v_secret, 'sha256');
end;
$$;
revoke all on function points_private.email_fingerprint(text)
  from public, anon, authenticated, service_role;

-- Existing accounts already received their credit. Record eligibility usage only:
-- do not change any balances, reservations, ledger events or existing accounts.
insert into points_private.starter_grant_claims(email_fingerprint, claimed_at)
select points_private.email_fingerprint(account.email), min(ledger.created_at)
from auth.users account
join public.points_ledger ledger on ledger.profile_id = account.id and ledger.kind = 'starter_grant'
where nullif(btrim(account.email), '') is not null
group by points_private.email_fingerprint(account.email)
on conflict (email_fingerprint) do nothing;

alter table public.points_wallets alter column balance set default 0;

-- Internal helper: only trigger owners can invoke it. Never expose an email
-- lookup or grant RPC. The current Auth record, not user metadata, is authoritative.
create function points_private.grant_starter_points(p_profile_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare v_email text; v_fingerprint bytea; v_claim bytea;
begin
  select account.email into v_email from auth.users account
  where account.id = p_profile_id and account.email_confirmed_at is not null
    and not coalesce(account.is_anonymous, false) and account.deleted_at is null
    and nullif(btrim(account.email), '') is not null;
  if not found then return; end if;

  -- Serialize confirmation/profile-trigger retries against this account.
  perform 1 from public.points_wallets where profile_id = p_profile_id for update;
  if not found then return; end if;
  v_fingerprint := points_private.email_fingerprint(v_email);

  if exists (select 1 from public.points_ledger
             where profile_id = p_profile_id and kind = 'starter_grant') then
    -- Changing a confirmed email cannot reset either address's entitlement.
    insert into points_private.starter_grant_claims(email_fingerprint)
    values (v_fingerprint) on conflict (email_fingerprint) do nothing;
    return;
  end if;

  -- Uniqueness arbitrates simultaneous grants for the same normalized address.
  insert into points_private.starter_grant_claims(email_fingerprint)
  values (v_fingerprint) on conflict (email_fingerprint) do nothing
  returning email_fingerprint into v_claim;
  if v_claim is null then return; end if;

  update public.points_wallets set balance = balance + 100, updated_at = clock_timestamp()
  where profile_id = p_profile_id;
  insert into public.points_ledger(profile_id, kind, amount)
  values (p_profile_id, 'starter_grant', 100);
end;
$$;
revoke all on function points_private.grant_starter_points(uuid)
  from public, anon, authenticated, service_role;

create or replace function request_private.create_starter_wallet() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.points_wallets(profile_id, balance) values (new.id, 0);
  perform points_private.grant_starter_points(new.id);
  return new;
end;
$$;
revoke all on function request_private.create_starter_wallet()
  from public, anon, authenticated, service_role;

create function points_private.on_auth_email_verified() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform points_private.grant_starter_points(new.id);
  return new;
end;
$$;
revoke all on function points_private.on_auth_email_verified()
  from public, anon, authenticated, service_role;
create trigger auth_email_starter_points
after update of email, email_confirmed_at, is_anonymous, deleted_at on auth.users
for each row when (old.email is distinct from new.email
  or old.email_confirmed_at is distinct from new.email_confirmed_at
  or old.is_anonymous is distinct from new.is_anonymous
  or old.deleted_at is distinct from new.deleted_at)
execute function points_private.on_auth_email_verified();

commit;
