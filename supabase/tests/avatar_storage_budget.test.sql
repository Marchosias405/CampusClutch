begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

select ok(not has_function_privilege('anon','public.claim_unused_avatars()','execute')
  and not has_function_privilege('authenticated','public.claim_unused_avatars()','execute'),
  'Only server-side maintenance can claim photos');
select ok(has_function_privilege('service_role','public.claim_unused_avatars()','execute'),
  'The cleanup worker can claim due photos');
select ok(not has_table_privilege('authenticated','account_private.avatar_files','select,insert,update,delete'),
  'Students cannot read or edit the private inventory');
select ok(exists(select 1 from pg_trigger where tgrelid='storage.objects'::regclass
  and tgname='campusclutch_avatar_inventory' and tgenabled='O'), 'Actual Storage writes enforce admission');
select ok(exists(select 1 from pg_trigger where tgrelid='public.profiles'::regclass
  and tgname='campusclutch_profile_photo' and tgenabled='O'), 'Profile changes protect the selected file');
select is((select file_size_limit from storage.buckets where id='avatars'),5242880::bigint,'Per-object limit remains 5 MiB');

-- Exercise the metadata callback on disposable rows. The companion local API
-- test covers real uploaded bytes, concurrent replacements and failed cleanup.
create temporary table fixture_objects(bucket_id text, name text);
create trigger fixture_avatar after insert or update of bucket_id,name or delete on fixture_objects
  for each row execute function account_private.track_avatar_file();
create function pg_temp.a(n int) returns uuid language sql immutable as $$
 select ('a62f1100-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.file(n int, leaf text) returns text language sql immutable as $$
 select pg_temp.a(n)::text||'/'||leaf $$;
insert into auth.users(id,email,email_confirmed_at) select pg_temp.a(n),'avatar-fixture-'||n||'@sfu.ca',now() from generate_series(1,2)n;
insert into fixture_objects values ('avatars',pg_temp.file(1,'a')),('avatars',pg_temp.file(1,'b')),('avatars',pg_temp.file(2,'a'));
select throws_ok($$insert into fixture_objects values('avatars',pg_temp.file(1,'c'))$$,'23514',
  'Your previous photo is being cleaned up. Try again shortly.','A third file is refused before commit');
select lives_ok($$insert into fixture_objects values('avatars',pg_temp.file(2,'b'))$$,'The second account has a separate budget');
select lives_ok($$insert into fixture_objects values('elsewhere',pg_temp.file(1,'c'))$$,'Other buckets are outside the avatar budget');
select is((select count(*) from account_private.avatar_files where profile_id=pg_temp.a(1) and cleanup_after>now()),2::bigint,
  'Fresh uploads have time to attach');
update public.profiles set avatar_path=pg_temp.file(1,'a') where id=pg_temp.a(1);
select throws_ok($$delete from fixture_objects where name=pg_temp.file(1,'a')$$,'23514',
  'This profile photo is still in use.','The active photo survives a stale delete');
update public.profiles set avatar_path=pg_temp.file(1,'b') where id=pg_temp.a(1);
select ok((select cleanup_after<=clock_timestamp() from account_private.avatar_files where name=pg_temp.file(1,'a')),
  'A superseded file is eligible immediately');
update public.profiles set avatar_path=pg_temp.file(1,'a') where id=pg_temp.a(1);
select ok((select cleanup_after is null from account_private.avatar_files where name=pg_temp.file(1,'a')),
  'Reselecting the photo before cleanup keeps it');
do $$ begin
  if exists(select 1 from account_private.avatar_files where profile_id not in (pg_temp.a(1),pg_temp.a(2))
    and cleanup_after <= clock_timestamp()) then raise exception 'Run the claim tests with an idle cleanup queue.'; end if;
end $$;
select results_eq($$select name from public.claim_unused_avatars()$$,$$select pg_temp.file(1,'b')$$,
  'Only the unused file is claimed');
select throws_ok($$update public.profiles set avatar_path=pg_temp.file(1,'b') where id=pg_temp.a(1)$$,'23514',
  'Choose and upload the profile photo again.','A claimed file cannot become current during a deletion');
select is((select count(*) from public.claim_unused_avatars()),0::bigint,'A second worker observes the retry delay');
update account_private.avatar_files set cleanup_after=now() where name=pg_temp.file(1,'b');
select results_eq($$select name from public.claim_unused_avatars()$$,$$select pg_temp.file(1,'b')$$,'A failed removal becomes eligible again');
delete from fixture_objects where name=pg_temp.file(1,'b');
select lives_ok($$insert into fixture_objects values('avatars',pg_temp.file(1,'c'))$$,'Successful cleanup frees a slot');
select is((select avatar_path from public.profiles where id=pg_temp.a(1)),pg_temp.file(1,'a'),'The current photo is preserved');
update public.profiles set avatar_path=null where id=pg_temp.a(1);
select lives_ok($$delete from fixture_objects where name=pg_temp.file(1,'a')$$,'Account deletion can remove a detached photo');
select * from finish();
rollback;
