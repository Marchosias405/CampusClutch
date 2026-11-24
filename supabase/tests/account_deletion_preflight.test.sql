begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.uid(i integer) returns uuid language sql immutable as $$
 select ('de1e7100-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid; $$;
create function pg_temp.login(i integer,s integer default null) returns void language plpgsql as $$ begin
 perform set_config('request.jwt.claim.sub',pg_temp.uid(i)::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(i),'role','authenticated','session_id',pg_temp.uid(coalesce(s,i+100)))::text,true);
end $$;
insert into auth.users(id,email,email_confirmed_at)
 select pg_temp.uid(i),'deletion-check-'||i||'@tests.local',now() from generate_series(1,7) i;
update public.profiles set display_name='Deletion readiness fixture',onboarding_completed_at=now(),is_discoverable=true
 where id in(select pg_temp.uid(i) from generate_series(1,7) i);
insert into auth.sessions(id,user_id,created_at,updated_at)
 select pg_temp.uid(i+100),pg_temp.uid(i),now(),now() from generate_series(1,7) i;
select safety_private.assign_staff_role(pg_temp.uid(3),'admin',true,'Disposable readiness admin');
select safety_private.assign_staff_role(pg_temp.uid(4),'moderator',true,'Disposable readiness moderator');
create temp table snapshots(label text primary key, data jsonb);
grant all on snapshots to authenticated;

select ok(not has_schema_privilege('anon','account_private','usage'),'Anonymous cannot access private schema');
select ok(not has_function_privilege('service_role','account_private.deletion_preflight()','execute'),'Service worker has no student readiness access');
select ok(not has_function_privilege(role,'public.get_my_account_deletion_preflight()','execute'),role||' has no readiness RPC')
 from unnest(array['anon','service_role']) role;
select ok(not has_function_privilege(role,'account_private.deletion_preflight()','execute'),role||' has no private entry')
 from unnest(array['anon','service_role']) role;
select ok(not prosecdef and provolatile='s' and proconfig @> array['search_path=""'],'Public wrapper is stable invoker with empty search path')
 from pg_proc where oid='public.get_my_account_deletion_preflight()'::regprocedure;
select is(pronargs::integer,0,'Caller cannot choose another account') from pg_proc where oid='public.get_my_account_deletion_preflight()'::regprocedure;
select ok(prosecdef and provolatile='s' and proconfig @> array['search_path=""'],'Private implementation restricts identity and search path')
 from pg_proc where oid='account_private.deletion_preflight()'::regprocedure;
set local role anon;
select throws_ok('select public.get_my_account_deletion_preflight()','42501',null,'Signed-out role cannot execute the endpoint');
reset role;

set local role authenticated;
select pg_temp.login(1);
insert into snapshots values('eligible',public.get_my_account_deletion_preflight());
select is((select data->>'eligible' from snapshots where label='eligible'),'true','Ordinary verified recent account is eligible');
select is((select data->'blockers' from snapshots where label='eligible'),'[]'::jsonb,'No invented blockers');
select is((select data->>'points_balance' from snapshots where label='eligible'),'100','Current balance is reported as precision-safe text');
select is((select data->>'points_reserved' from snapshots where label='eligible'),'0','No reservation for a new account');
select is(public.get_my_account_deletion_preflight()->>'policy_version','1','Policy contract is versioned');
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_my_account_deletion_preflight()) k),
 array['accepted_jobs','blockers','checked_at','course_memberships','course_reviews','eligible','open_requests','pending_offers','point_reservations','points_balance','points_reserved','policy_version']::text[],
 'Readiness exposes only counts and own balance, not identities or private evidence');
select pg_temp.login(3);
select is(public.get_my_account_deletion_preflight()->'blockers','["staff_access"]'::jsonb,'Enabled admin must arrange staff handover first');
select pg_temp.login(4);
select is(public.get_my_account_deletion_preflight()->'blockers','["staff_access"]'::jsonb,'Enabled moderator also blocked');
reset role;
select safety_private.assign_staff_role(pg_temp.uid(4),'moderator',false,'Role explicitly revoked before deletion');
set local role authenticated;
select is(public.get_my_account_deletion_preflight()->>'eligible','true','Disabled role does not impersonate an active assignment');
reset role;

-- One accepted job is counted once for each party, even with all three links.
insert into public.requests(id,owner_id,category,title,description,campus_id,room_location,deadline_at,points,item_size,status)
 values(pg_temp.uid(501),pg_temp.uid(1),'delivery','Deletion fixture','Disposable readiness request',(select id from public.campuses limit 1),'Test room',now()+interval '1 day',20,'medium','accepted');
insert into public.delivery_request_details(request_id,pickup_location,dropoff_location) values(pg_temp.uid(501),'Library','Student centre');
insert into public.request_offers(id,request_id,offering_user_id,status,decided_at)
 values(pg_temp.uid(601),pg_temp.uid(501),pg_temp.uid(2),'accepted',now());
insert into public.request_point_reservations(request_id,offer_round,poster_id,helper_id,amount)
 values(pg_temp.uid(501),1,pg_temp.uid(1),pg_temp.uid(2),20);
update public.points_wallets set reserved=20 where profile_id=pg_temp.uid(1);
set local role authenticated;
select pg_temp.login(1);
select is(public.get_my_account_deletion_preflight()->>'accepted_jobs','1','Poster assignment counted once');
select is(public.get_my_account_deletion_preflight()->'blockers','["accepted_jobs","reserved_points"]'::jsonb,'Unresolved assignment and points hold block deletion');
select is(public.get_my_account_deletion_preflight()->>'points_reserved','20','Poster sees reserved amount');
select pg_temp.login(2);
select is(public.get_my_account_deletion_preflight()->>'accepted_jobs','1','Accepted helper also cannot delete');
select is(public.get_my_account_deletion_preflight()->>'points_reserved','0','Helper does not see poster wallet');
select is(public.get_my_account_deletion_preflight()->>'point_reservations','1','Helper obligation retains payment hold');
reset role;
update public.requests set deadline_at=now()-interval '1 day' where id=pg_temp.uid(501);
set local role authenticated;
select is(public.get_my_account_deletion_preflight()->>'eligible','false','Expired deadline does not clear accepted work');
reset role;
update public.request_point_reservations set status='released',released_at=now() where request_id=pg_temp.uid(501);
update public.points_wallets set reserved=0 where profile_id=pg_temp.uid(1);
set local role authenticated;
select is(public.get_my_account_deletion_preflight()->>'accepted_jobs','1','Legacy accepted work blocks even without a hold');
reset role;
update public.requests set status='cancelled',cancelled_at=now() where id=pg_temp.uid(501);
set local role authenticated;
select is(public.get_my_account_deletion_preflight()->>'eligible','true','Resolved accepted assignment releases helper blocker');
select pg_temp.login(1);
select is(public.get_my_account_deletion_preflight()->>'eligible','true','Cancelled job does not permanently prevent deletion');
reset role;
update public.points_wallets set reserved=10 where profile_id=pg_temp.uid(1);
set local role authenticated;
select is(public.get_my_account_deletion_preflight()->'blockers','["reserved_points"]'::jsonb,'Stranded wallet hold fails closed');
reset role;
update public.points_wallets set reserved=0 where profile_id=pg_temp.uid(1);
update public.request_point_reservations set status='reserved',released_at=null where request_id=pg_temp.uid(501);
set local role authenticated;
select is(public.get_my_account_deletion_preflight()->>'eligible','false','Stranded reservation also fails closed');
reset role;
update public.request_point_reservations set status='released',released_at=now() where request_id=pg_temp.uid(501);

insert into public.requests(id,owner_id,category,title,description,campus_id,room_location,deadline_at,points,item_size)
 values(pg_temp.uid(502),pg_temp.uid(1),'delivery','Open fixture','Disposable open request',(select id from public.campuses limit 1),'Test room',now()+interval '1 day',20,'medium');
insert into public.delivery_request_details(request_id,pickup_location,dropoff_location) values(pg_temp.uid(502),'Library','Student centre');
insert into public.request_offers(request_id,offering_user_id) values(pg_temp.uid(502),pg_temp.uid(2));
insert into public.course_memberships(course_id,profile_id) values((select id from public.courses limit 1),pg_temp.uid(1));
insert into course_reviews_private.reviews(course_code,term_id,author_id,difficulty,workload,recommend,comment)
 values('TEST 101',(select id from public.academic_terms limit 1),pg_temp.uid(1),3,3,true,'Disposable review for readiness');
set local role authenticated;
select pg_temp.login(1);
select is(public.get_my_account_deletion_preflight()->>'open_requests','1','Open listings counted for future cancellation');
select is(public.get_my_account_deletion_preflight()->>'eligible','true','Open listings alone do not block readiness');
select is(public.get_my_account_deletion_preflight()->>'course_memberships','1','Own memberships counted');
select is(public.get_my_account_deletion_preflight()->>'course_reviews','1','Own course reviews counted for future removal');
select pg_temp.login(2);
select is(public.get_my_account_deletion_preflight()->>'pending_offers','1','Unaccepted offer counted for future withdrawal');
select is(public.get_my_account_deletion_preflight()->>'eligible','true','Pending offer does not block deletion');
select is(public.get_my_account_deletion_preflight()->>'open_requests','0','Another owner listings are not leaked');
select is(public.get_my_account_deletion_preflight()->>'course_memberships','0','Another student memberships are not leaked');
select is(public.get_my_account_deletion_preflight()->>'course_reviews','0','Another student review count is not exposed');
reset role;
update public.requests set deadline_at=now()-interval '1 day' where id=pg_temp.uid(502);
set local role authenticated;
select is(public.get_my_account_deletion_preflight()->>'pending_offers','0','Expired offers excluded from live pending count');
reset role;

insert into safety_private.account_standing(profile_id,warning_count,suspended_until) values(pg_temp.uid(5),3,now()+interval '7 days');
update public.profiles set onboarding_completed_at=null,display_name=null where id=pg_temp.uid(6);
set local role authenticated;
select pg_temp.login(5);
select is(public.get_my_account_deletion_preflight()->>'eligible','true','App suspension does not hide deletion guidance');
select pg_temp.login(6);
select is(public.get_my_account_deletion_preflight()->>'eligible','true','Incomplete registration can review deletion too');
reset role;
update auth.sessions set created_at=now()-interval '11 minutes' where user_id=pg_temp.uid(6);
set local role authenticated;
select is(public.get_my_account_deletion_preflight()->'blockers','["recent_sign_in"]'::jsonb,'Old session needs a fresh sign-in, not just token refresh');
reset role;
update auth.sessions set created_at=now()+interval '1 minute' where user_id=pg_temp.uid(6);
set local role authenticated;
select is(public.get_my_account_deletion_preflight()->'blockers','["recent_sign_in"]'::jsonb,'Future session timestamps are not accepted as fresh');
reset role;
update auth.sessions set created_at=null where user_id=pg_temp.uid(6);
set local role authenticated;
select is(public.get_my_account_deletion_preflight()->'blockers','["recent_sign_in"]'::jsonb,'Unknown sign-in time does not authorize deletion');
select pg_temp.login(1,102);
select throws_ok('select public.get_my_account_deletion_preflight()','42501',null,'Other account session cannot be substituted');
select pg_temp.login(1,999);
select throws_ok('select public.get_my_account_deletion_preflight()','42501',null,'Missing/revoked session denied');
select set_config('request.jwt.claims','{"session_id":"invalid"}',true);
select throws_ok('select public.get_my_account_deletion_preflight()','42501',null,'Malformed session gives controlled denial');
select pg_temp.login(7);
reset role;
update auth.users set email_confirmed_at=null where id=pg_temp.uid(7);
set local role authenticated;
select throws_ok('select public.get_my_account_deletion_preflight()','42501',null,'Unverified user denied');
reset role;
update auth.users set email_confirmed_at=now(),is_anonymous=true where id=pg_temp.uid(7);
set local role authenticated;
select throws_ok('select public.get_my_account_deletion_preflight()','42501',null,'Anonymous identity denied');
reset role;
update auth.users set is_anonymous=false,banned_until=now()+interval '1 day' where id=pg_temp.uid(7);
set local role authenticated;
select throws_ok('select public.get_my_account_deletion_preflight()','42501',null,'Auth-banned identity denied');
reset role;
update auth.users set banned_until=null,deleted_at=now() where id=pg_temp.uid(7);
set local role authenticated;
select throws_ok('select public.get_my_account_deletion_preflight()','42501',null,'Deleted identity denied');
reset role;
update auth.users set deleted_at=null where id=pg_temp.uid(7);
update auth.sessions set not_after=now()-interval '1 minute' where user_id=pg_temp.uid(7);
set local role authenticated;
select throws_ok('select public.get_my_account_deletion_preflight()','42501',null,'Expired session denied');
reset role;

-- The eligibility endpoint must have no side effects, including welcome points,
-- reservations, jobs, staff access, reports, notifications or session revocation.
create function pg_temp.fingerprint() returns jsonb language plpgsql as $$
declare t record; result jsonb:='{}'; digest text; begin
 for t in select schemaname,tablename from pg_tables where schemaname='public' or right(schemaname,8)='_private'
   or (schemaname='auth' and tablename in ('users','sessions')) order by schemaname,tablename loop
  execute format('select md5(coalesce(string_agg(to_jsonb(r)::text,'','' order by to_jsonb(r)::text),'''')) from %I.%I r',t.schemaname,t.tablename) into digest;
  result:=result||jsonb_build_object(t.schemaname||'.'||t.tablename,digest);
 end loop; return result; end $$;
insert into snapshots values('before',pg_temp.fingerprint());
set local role authenticated;
select pg_temp.login(1);
select public.get_my_account_deletion_preflight() from generate_series(1,3);
reset role;
select is(pg_temp.fingerprint(),(select data from snapshots where label='before'),'Repeated preflight leaves all application/private/auth data unchanged');
set constraints all immediate;
select * from finish();
rollback;
