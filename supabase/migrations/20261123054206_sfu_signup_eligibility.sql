-- New projects default to SFU email. The operator opts a test project in separately.
create function account_private.enforce_signup_email() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  check_email boolean := true;
  check_pending boolean := true;
  sfu_pattern constant text := '^[^@[:space:]]+@sfu[.]ca$';
begin
  if tg_op = 'UPDATE' then
    -- Auth anonymizes the email during soft deletion. Recheck the address on restoration.
    if new.deleted_at is not null then return new; end if;
    check_email := old.deleted_at is not null or new.email is distinct from old.email;
    check_pending := old.deleted_at is not null or new.email_change is distinct from old.email_change;
  end if;
  if not (check_email or check_pending) then return new; end if;

  -- Test provisioning creates this NOLOGIN role outside the migrations and seed data.
  if exists (select 1 from pg_catalog.pg_roles
             where rolname = 'campusclutch_test_email_signup' and not rolcanlogin) then
    return new;
  end if;

  if (check_email and (new.email is null or new.email collate "C" !~* sfu_pattern))
     or (check_pending and nullif(new.email_change, '') is not null
         and new.email_change collate "C" !~* sfu_pattern) then
    raise exception using errcode = '23514', message = 'Use your SFU email address ending in @sfu.ca.';
  end if;
  return new;
end;
$$;

revoke all on function account_private.enforce_signup_email() from public, anon, authenticated, service_role;
create trigger enforce_signup_email
before insert or update of email, email_change, deleted_at on auth.users
for each row execute function account_private.enforce_signup_email();
