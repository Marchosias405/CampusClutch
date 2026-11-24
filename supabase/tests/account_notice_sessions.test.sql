begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();

create function pg_temp.notice_id(i integer) returns uuid language sql immutable as $$
  select ('ac140000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid;
$$;
create function pg_temp.sign_in(student integer, session_number integer) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.notice_id(student)::text, true);
  perform set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object(
    'sub', pg_temp.notice_id(student), 'role', 'authenticated', 'session_id', pg_temp.notice_id(session_number)
  ))::text, true);
end;
$$;
insert into auth.users(id,email,email_confirmed_at)
select pg_temp.notice_id(i), 'notice-session-check-' || i || '@sfu.ca', now() from generate_series(1,2) i;
insert into auth.sessions(id,user_id,created_at,not_after) values
  (pg_temp.notice_id(11),pg_temp.notice_id(1),now(),null),
  (pg_temp.notice_id(12),pg_temp.notice_id(1),now(),now()+interval '1 day'),
  (pg_temp.notice_id(13),pg_temp.notice_id(1),now()-interval '2 days',now()-interval '1 day'),
  (pg_temp.notice_id(21),pg_temp.notice_id(2),now(),null);

select ok(not has_function_privilege('authenticated','safety_private.require_decision_actor()','execute'),
  'Student role has no direct grant to the internal guard');
select ok(not has_function_privilege('anon','public.get_my_account_standing()','execute')
  and not has_function_privilege('anon','public.acknowledge_account_notice(timestamptz)','execute'),
  'Signed-out clients have no notice RPC access');
set local role authenticated;
select pg_temp.sign_in(1,11);
select is(public.get_my_account_standing(),jsonb_build_object('warning_count',0,'suspended_until',null,
  'suspended',false,'notices','[]'::jsonb),'Verified student can open the app during onboarding');
reset role;
insert into safety_private.account_standing(profile_id,warning_count,suspended_until) values
  (pg_temp.notice_id(1),2,now()+interval '7 days'), (pg_temp.notice_id(2),1,null);

set local role authenticated;
select pg_temp.sign_in(1,11);
select is(public.get_my_account_standing()->>'suspended','true','Active session reads its own suspension');
select is(public.get_my_account_standing()->>'warning_count','2','Student sees their own warning count');
select lives_ok($$select public.get_my_moderation_actions()$$,'Appeals remain available while suspended');
select lives_ok($$select public.acknowledge_account_notice(now()-interval '1 minute')$$,'Suspended student may acknowledge');
select lives_ok($$select public.acknowledge_account_notice(now()-interval '2 minutes')$$,'An older acknowledgement is harmless');
select throws_ok($$select public.acknowledge_account_notice(now()+interval '1 day')$$,'22023','Invalid acknowledgement.',
  'Future acknowledgements remain invalid');
reset role;
select is((select acknowledged_at from safety_private.account_standing where profile_id=pg_temp.notice_id(1)),
  now()-interval '1 minute','Acknowledgement moves forward only');
select is((select acknowledged_at from safety_private.account_standing where profile_id=pg_temp.notice_id(2)),
  '-infinity'::timestamptz,'Acknowledgement leaves the other student unchanged');
delete from auth.sessions where id=pg_temp.notice_id(11);

set local role authenticated;
select pg_temp.sign_in(1,11);
select throws_ok($$select public.get_my_account_standing()$$,'42501','Sign in to view your account decisions.',
  'Ended session cannot read notices despite another session for the same student');
select throws_ok($$select public.acknowledge_account_notice(now())$$,'42501','Sign in to view your account decisions.',
  'Ended session cannot acknowledge notices');
select pg_temp.sign_in(1,13);
select throws_ok($$select public.get_my_account_standing()$$,'42501',null,'Expired session cannot read');
select throws_ok($$select public.acknowledge_account_notice(now())$$,'42501',null,'Expired session cannot acknowledge');
select pg_temp.sign_in(1,21);
select throws_ok($$select public.get_my_account_standing()$$,'42501',null,'Session must belong to the current student to read');
select throws_ok($$select public.acknowledge_account_notice(now())$$,'42501',null,'Session must belong to the current student to acknowledge');
select pg_temp.sign_in(1,null);
select throws_ok($$select public.get_my_account_standing()$$,'42501',null,'Missing session cannot read');
select throws_ok($$select public.acknowledge_account_notice(now())$$,'42501',null,'Missing session cannot acknowledge');
reset role;
select is((select acknowledged_at from safety_private.account_standing where profile_id=pg_temp.notice_id(1)),
  now()-interval '1 minute','Denied attempts left the saved acknowledgement intact');

set local role authenticated;
select pg_temp.sign_in(2,21);
select is(public.get_my_account_standing()->>'warning_count','1','The second student sees only their own standing');
select pg_temp.sign_in(1,12);
select is(public.get_my_account_standing()->>'suspended','true','The remaining live session reads normally');
select lives_ok($$select public.acknowledge_account_notice(now())$$,'The remaining live session acknowledges normally');
reset role;
select is((select acknowledged_at from safety_private.account_standing where profile_id=pg_temp.notice_id(1)),
  now(),'Live acknowledgement was saved');
update auth.users set banned_until=now()+interval '1 day' where id=pg_temp.notice_id(1);
set local role authenticated;
select throws_ok($$select public.get_my_account_standing()$$,'42501',null,'An Auth ban overrides a live session');
select throws_ok($$select public.acknowledge_account_notice(now())$$,'42501',null,'A banned account cannot acknowledge');
reset role;
select * from finish();
rollback;
