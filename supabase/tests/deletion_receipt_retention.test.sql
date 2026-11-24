begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='America/Vancouver';
select no_plan();
create function pg_temp.k(n int) returns uuid language sql immutable as $$
  select ('de1e9000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
select ok(not has_function_privilege(r,'account_private.erase_expired_deletion_receipts()','execute')
  and not has_table_privilege(r,'account_private.deletions','select'), r||' cannot sweep or inspect receipt hashes')
from unnest(array['anon','authenticated','service_role']) r;
select is(account_private.deletion_receipt_expires_at(null),null::timestamptz,'Pending cleanup has no deadline');
select is(account_private.deletion_receipt_expires_at('2026-03-01 12:00Z'),'2026-05-30 12:00Z'::timestamptz,
  'Deadline is exactly 2160 elapsed hours across a DST change');
select ok(t < account_private.deletion_receipt_expires_at(t-interval '2160 hours'+interval '1 microsecond')
  and t = account_private.deletion_receipt_expires_at(t-interval '2160 hours')
  and t > account_private.deletion_receipt_expires_at(t-interval '2160 hours'-interval '1 microsecond'),
  'The last microsecond is valid and the 90-day endpoint is exclusive') from (select now() t) clock;
insert into auth.users(id,email,email_confirmed_at)
select pg_temp.k(n),'receipt-retention-'||n||'@test.local',now() from generate_series(1,58) n;
insert into account_private.deletions(id,profile_id,receipt_hash,requested_at,completed_at)
select pg_temp.k(100+n),pg_temp.k(n),digest(repeat('a',64),'sha256'),now()-interval '4 years',
  case n when 1 then null when 2 then now()-interval '2159 hours' else now()-interval '2160 hours' end
from generate_series(1,3) n;
select throws_ok($$update account_private.deletions set receipt_hash=null where id=pg_temp.k(101)$$,'23514',null,
  'A pending deletion must retain a working credential');
set local role service_role;
select is(public.claim_account_deletion(pg_temp.k(101),repeat('a',64))->>'status','claimed','Even a four-year-old pending receipt can resume cleanup');
select is(public.claim_account_deletion(pg_temp.k(101),repeat('a',64))->>'status','pending','Pending lease is visible while the worker finishes');
select is(public.claim_account_deletion(pg_temp.k(102),repeat('a',64)),'{"status":"complete"}'::jsonb,'Recent completion remains confirmable');
select is(public.claim_account_deletion(pg_temp.k(103),repeat('a',64)),'{"status":"unconfirmed"}'::jsonb,'Already expired before the first sweep runs');
select is(public.claim_account_deletion(pg_temp.k(103),repeat('a',64)),public.claim_account_deletion(pg_temp.k(180),repeat('a',64)),
  'An expired receipt returns the same public result as a missing one');
select is(public.claim_account_deletion(pg_temp.k(102),repeat('b',64)),'{"status":"unconfirmed"}'::jsonb,'Wrong secret discloses no completion');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.k(3)::text,true);
set local role authenticated;
select throws_ok($$select public.begin_my_account_deletion(pg_temp.k(103),repeat('a',64),'DELETE')$$,'42501',null,
  'Replaying signed-in confirmation cannot revive an expired receipt');
reset role;
select set_config('request.jwt.claim.sub','',true);
select is(account_private.erase_expired_deletion_receipts(),1,'Sweep erases only the expired credential');
select ok((select receipt_hash is null and completed_at=now()-interval '2160 hours' and profile_id=pg_temp.k(3)
  from account_private.deletions where id=pg_temp.k(103)), 'Completion timestamp and deleted-account identity survive');
select set_config('request.jwt.claim.sub',pg_temp.k(3)::text,true);
select is(safety_private.account_allowed(),false,'Erasing the receipt leaves the old account blocked');
select set_config('request.jwt.claim.sub','',true);
select is(public.claim_account_deletion(pg_temp.k(103),repeat('a',64)),'{"status":"unconfirmed"}'::jsonb,'Erased hashes cannot verify');
select is(account_private.erase_expired_deletion_receipts(),0,'Repeated cleanup is idempotent');
select ok((select bool_and(receipt_hash is not null) from account_private.deletions where id in (pg_temp.k(101),pg_temp.k(102))),
  'Pending and recent receipts keep their hashes');
-- The actual completion path starts the timer only after Storage and Auth cleanup.
update auth.users set deleted_at=now() where id=pg_temp.k(1);
select ok(public.finish_account_deletion(id,lease_id),'Finishing an old pending job starts a new 90-day window')
from account_private.deletions where id=pg_temp.k(101);
select is(public.claim_account_deletion(pg_temp.k(101),repeat('a',64)),'{"status":"complete"}'::jsonb,
  'A receipt can confirm the newly finished cleanup');
create temp table first_completion as select id,completed_at,lease_id from account_private.deletions where id=pg_temp.k(101);
select ok(public.finish_account_deletion(id,lease_id),'Finishing the same lease again is harmless') from first_completion;
select is(d.completed_at,f.completed_at,'A completion retry cannot extend the deadline') from account_private.deletions d join first_completion f using(id);
insert into account_private.deletions(id,profile_id,receipt_hash,completed_at)
select pg_temp.k(100+n),pg_temp.k(n),digest(repeat('a',64),'sha256'),now()-interval '1 year' from generate_series(4,58) n;
select is(account_private.erase_expired_deletion_receipts(),50,'At most 50 hashes per sweep');
select is(account_private.erase_expired_deletion_receipts(),5,'Next sweep finishes the backlog');
select is(account_private.erase_expired_deletion_receipts(),0,'An empty sweep changes nothing');
select is((select count(*) from account_private.deletions where profile_id between pg_temp.k(1) and pg_temp.k(58)),58::bigint,
  'Every deletion record remains available for access control and other retention rules');
select * from finish();
rollback;
