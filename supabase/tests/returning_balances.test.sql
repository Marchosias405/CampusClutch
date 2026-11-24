begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.uid(i integer) returns uuid language sql immutable as $$
 select ('ba1a0000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
$$;
create function pg_temp.balance(i integer) returns bigint language sql as $$
 select balance from public.points_wallets where profile_id=pg_temp.uid(i);
$$;
create function pg_temp.retained(email text) returns bigint language sql as $$
 select balance from points_private.returning_balances where email_fingerprint=points_private.email_fingerprint(email);
$$;
create function pg_temp.make_user(i integer,email text,confirmed boolean default true) returns void language plpgsql as $$
begin
 insert into auth.users(id,email,email_confirmed_at) values(pg_temp.uid(i),email,case when confirmed then now() end);
 update public.profiles set display_name='Returning fixture',onboarding_completed_at=now() where id=pg_temp.uid(i);
end $$;
create function pg_temp.login(i integer) returns void language plpgsql as $$
begin
 insert into auth.sessions(id,user_id,created_at,updated_at) values(pg_temp.uid(i+100),pg_temp.uid(i),now(),now()) on conflict do nothing;
 perform set_config('request.jwt.claim.sub',pg_temp.uid(i)::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(i),'role','authenticated','session_id',pg_temp.uid(i+100))::text,true);
end $$;
create function pg_temp.logout() returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
end $$;
create function pg_temp.remove(i integer) returns void language plpgsql as $$
declare result jsonb;
begin
 perform pg_temp.login(i);
 result:=public.begin_my_account_deletion(pg_temp.uid(i+200),repeat('a',64),'DELETE');
 if result->>'accepted'<>'true' then raise exception 'Deletion blocked: %',result; end if;
 perform pg_temp.logout();
 -- Auth soft-deletion is exercised through its real worker in the API suite.
 update auth.users set email=null,deleted_at=now() where id=pg_temp.uid(i);
end $$;

select pg_temp.make_user(1,'return-remaining@tests.local');
update public.points_wallets set balance=37 where profile_id=pg_temp.uid(1);
select pg_temp.login(1);
set local role authenticated;
select is(public.begin_my_account_deletion(pg_temp.uid(201),repeat('a',64),'DELETE')->>'accepted','true','Deletion accepts a wallet with unspent funds');
select is(public.begin_my_account_deletion(pg_temp.uid(201),repeat('a',64),'DELETE')->>'accepted','true','Duplicate deletion confirmation remains idempotent');
reset role;
select pg_temp.logout();
select is(pg_temp.balance(1),0::bigint,'Old identity cannot retain spendable funds');
select is(pg_temp.retained('return-remaining@tests.local'),37::bigint,'Only 37 remaining points are saved, exactly once');
select is((select count(*) from public.points_ledger where profile_id=pg_temp.uid(1)),0::bigint,'Deletion still removes old personal ledger');
update auth.users set email=null,deleted_at=now() where id=pg_temp.uid(1);

select pg_temp.make_user(2,'return-remaining@tests.local',false);
update auth.users set raw_user_meta_data='{"email_verified":true}' where id=pg_temp.uid(2);
select is(pg_temp.balance(2),0::bigint,'Unverified recreated account cannot claim funds via metadata');
select is(pg_temp.retained('return-remaining@tests.local'),37::bigint,'Funds stay saved until real verification');
update auth.users set email_confirmed_at=now() where id=pg_temp.uid(2);
select is(pg_temp.balance(2),37::bigint,'Verification restores the remaining balance, without topping up to 100');
select is(pg_temp.retained('return-remaining@tests.local'),null::bigint,'Claimed retained balance is consumed');
select is((select count(*) from public.points_ledger where profile_id=pg_temp.uid(2) and kind='starter_grant'),0::bigint,'Returning account gets no new welcome grant');
select is((select amount from public.points_ledger where profile_id=pg_temp.uid(2) and kind='balance_restored'),37::bigint,'Ledger describes a balance restoration');
select pg_temp.login(2);
set local role authenticated;
select is((public.get_my_points()->>'available')::integer,37,'Wallet API exposes the restored spendable balance');
select is(public.get_my_points()->'history'->0->>'kind','balance_restored','Wallet API exposes restoration activity');
reset role;
select pg_temp.logout();
update auth.users set email_confirmed_at=clock_timestamp() where id=pg_temp.uid(2);
select points_private.grant_starter_points(pg_temp.uid(2));
select is(pg_temp.balance(2),37::bigint,'Repeated confirmation/trigger calls cannot double restore');
select is((select count(*) from public.points_ledger where profile_id=pg_temp.uid(2)),1::bigint,'Retries keep a single restoration entry');
update public.points_wallets set balance=22 where profile_id=pg_temp.uid(2);
select pg_temp.remove(2);
select is(pg_temp.retained('return-remaining@tests.local'),22::bigint,'Second deletion saves the latest balance, not the original grant');
select pg_temp.make_user(3,'  RETURN-REMAINING@tests.local  ');
select is(pg_temp.balance(3),22::bigint,'Case and whitespace variants restore the same balance');
update auth.users set email='return-changed@tests.local',email_confirmed_at=now() where id=pg_temp.uid(3);
select is(pg_temp.balance(3),22::bigint,'Changing email after restoration cannot mint welcome points');
select pg_temp.remove(3);
select pg_temp.make_user(4,'return-remaining@tests.local');
select pg_temp.make_user(5,'return-changed@tests.local');
select is(pg_temp.balance(4),0::bigint,'Old email cannot recover funds already moved to a confirmed new email');
select is(pg_temp.balance(5),22::bigint,'Current verified email recovers the latest retained funds');
update auth.users set email='return-zero-changed@tests.local',email_confirmed_at=now() where id=pg_temp.uid(4);
select is(pg_temp.balance(4),0::bigint,'A returning zero wallet cannot mint a welcome grant through email change');

select pg_temp.make_user(6,'return-earned@tests.local');
update public.points_wallets set balance=175 where profile_id=pg_temp.uid(6);
select pg_temp.remove(6);
select pg_temp.make_user(7,'return-earned@tests.local');
select is(pg_temp.balance(7),175::bigint,'Earned balance above 100 is preserved in full');
select pg_temp.make_user(8,'return-empty@tests.local');
update public.points_wallets set balance=0 where profile_id=pg_temp.uid(8);
select pg_temp.remove(8);
select pg_temp.make_user(9,'return-empty@tests.local');
select is(pg_temp.balance(9),0::bigint,'Spent-out account stays at zero after recreation');
select is((select amount from public.points_ledger where profile_id=pg_temp.uid(9) and kind='balance_restored'),0::bigint,'Zero restoration records completion without minting');
select pg_temp.make_user(10,'return-brand-new@tests.local');
select is(pg_temp.balance(10),100::bigint,'A genuinely new verified email still gets its first 100 points');

-- Existing wallets can reclaim saved funds on a verified email change. Both
-- balances must be conserved, and changing away/back cannot claim twice.
select pg_temp.remove(7);
update auth.users set email='return-earned@tests.local',email_confirmed_at=now() where id=pg_temp.uid(10);
select is(pg_temp.balance(10),275::bigint,'Verified email change transfers retained funds without overwriting an existing balance');
select is(pg_temp.retained('return-earned@tests.local'),null::bigint,'Email-change restoration consumes the saved balance');
update auth.users set email='return-brand-new@tests.local',email_confirmed_at=clock_timestamp() where id=pg_temp.uid(10);
update auth.users set email='return-earned@tests.local',email_confirmed_at=clock_timestamp() where id=pg_temp.uid(10);
select is(pg_temp.balance(10),275::bigint,'Switching emails back and forth cannot repeat either credit');

-- Any failure rolls back both retention/consumption and account/wallet changes.
select pg_temp.make_user(11,'return-atomic@tests.local');
create function pg_temp.fail_cleanup() returns trigger language plpgsql as $$
begin if new.id=pg_temp.uid(11) and new.deleted_at is not null then raise exception 'Injected cleanup failure'; end if; return new; end $$;
create trigger returning_test_cleanup before update on public.profiles for each row execute function pg_temp.fail_cleanup();
select throws_ok($$select pg_temp.remove(11)$$,'P0001','Injected cleanup failure','Failure after saving balance rolls back deletion');
select is(pg_temp.retained('return-atomic@tests.local'),null::bigint,'Failed deletion leaves no retained copy');
select is(pg_temp.balance(11),100::bigint,'Failed deletion leaves the original balance intact');
select ok(not exists(select 1 from account_private.deletions where profile_id=pg_temp.uid(11)),'Failed deletion leaves no accepted receipt');
drop trigger returning_test_cleanup on public.profiles;
select pg_temp.remove(11);
create function pg_temp.fail_restore() returns trigger language plpgsql as $$
begin if new.profile_id=pg_temp.uid(12) and new.kind='balance_restored' then raise exception 'Injected restoration failure'; end if; return new; end $$;
create trigger returning_test_restore before insert on public.points_ledger for each row execute function pg_temp.fail_restore();
select throws_ok($$select pg_temp.make_user(12,'return-atomic@tests.local')$$,'P0001','Injected restoration failure','Ledger failure aborts restoration/signup atomically');
select is(pg_temp.retained('return-atomic@tests.local'),100::bigint,'Failed restoration preserves the saved funds');
select ok(not exists(select 1 from auth.users where id=pg_temp.uid(12)),'Failed signup leaves no partially funded account');
drop trigger returning_test_restore on public.points_ledger;
select pg_temp.make_user(12,'return-atomic@tests.local');
select is(pg_temp.balance(12),100::bigint,'Clean retry can restore after rollback');

select ok(relrowsecurity,'Private retention/initialization tables enable RLS') from pg_class
where oid in ('points_private.returning_balances'::regclass,'points_private.wallet_initializations'::regclass);
select ok(not has_table_privilege(r,t,'select,insert,update,delete'),r||' cannot access '||t)
from unnest(array['anon','authenticated','service_role']) r cross join
unnest(array['points_private.returning_balances','points_private.wallet_initializations']) t;
select ok(not has_function_privilege(r,'points_private.retain_deleted_balance(uuid)','execute'),r||' cannot directly retain/duplicate balances')
from unnest(array['anon','authenticated','service_role']) r;
select is((select count(*) from pg_constraint where conrelid='points_private.returning_balances'::regclass and contype='f'),0::bigint,'Retained funds cannot cascade away with the old profile');
select is((select count(*) from information_schema.columns where table_schema='points_private' and table_name='returning_balances'),2::bigint,'Retention stores only fingerprint and balance');
select * from finish();
rollback;
