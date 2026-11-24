begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();

create function pg_temp.uid(i integer) returns uuid language sql immutable as $$
  select ('c14c0000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
$$;
create function pg_temp.login(i integer) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.uid(i)::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', pg_temp.uid(i), 'role', 'authenticated', 'session_id', pg_temp.uid(100 + i))::text, true);
end $$;
create temp table fixtures(name text primary key, id uuid);
grant select, insert on fixtures to authenticated;
create function pg_temp.fixture(k text) returns uuid language sql stable as $$
  select id from fixtures where name = k;
$$;
create function pg_temp.report(i integer) returns jsonb language sql as $$
  select public.submit_safety_report(pg_temp.uid(i), 'request', pg_temp.fixture('job'), 'spam', '');
$$;
create function pg_temp.accept_offer() returns uuid language sql as $$
  select public.decide_request_offer_for_round(pg_temp.fixture('offer'), 'accepted', 1, 10);
$$;
create function pg_temp.can_read_topic(channel text) returns boolean language plpgsql as $$
declare own_topic text := channel || ':' || auth.uid()::text;
begin
  perform set_config('realtime.topic', own_topic, true);
  return exists(select 1 from realtime.messages where topic=own_topic and extension='broadcast');
end $$;

-- Count actual private broadcast rows, including deliveries to a topic whose
-- subscription predated the suspension. All fixtures roll back with this test.
create function pg_temp.hints(channel text, i integer) returns bigint language sql stable as $$
  select count(*) from realtime.messages where private and topic=channel || ':' || pg_temp.uid(i)::text;
$$;
create temp table hint_counts as select channel,i,pg_temp.hints(channel,i) as n
  from unnest(array['messages','notifications']) channel cross join generate_series(1,2) i;
create function pg_temp.delta(channel text, i integer) returns bigint language sql stable as $$
  select pg_temp.hints($1,$2)-h.n from hint_counts h where h.channel=$1 and h.i=$2;
$$;
create function pg_temp.baseline() returns void language sql as $$
  update hint_counts h set n=pg_temp.hints(h.channel,h.i);
$$;

insert into auth.users(id,email,email_confirmed_at)
select pg_temp.uid(i), 'policy-check-' || i || '@sfu.ca', now() from generate_series(1,3) i;
insert into auth.sessions(id,user_id,created_at)
select pg_temp.uid(100 + i), pg_temp.uid(i), now() from generate_series(1,3) i;
update public.profiles set display_name='Policy tester', onboarding_completed_at=now(), is_discoverable=true
where id in (pg_temp.uid(1), pg_temp.uid(2), pg_temp.uid(3));

set local role authenticated;
select pg_temp.login(1);
insert into fixtures values ('job', public.save_my_request(jsonb_build_object(
  'category','delivery', 'title','Fixture delivery', 'description','Help deliver a parcel to the library.',
  'campus_id',(select id from public.campuses where slug='burnaby'), 'room_location','Library',
  'deadline_at',now()+interval '1 day', 'points',10, 'item_size','small',
  'details',jsonb_build_object('pickup_location','Cafe','dropoff_location','Library'))));
insert into fixtures values ('chat', public.start_direct_conversation(pg_temp.uid(2)));
select pg_temp.login(2);
insert into fixtures values ('offer', public.create_my_request_offer_for_terms(pg_temp.fixture('job'),1,10));
insert into fixtures values ('before', (public.send_conversation_message(pg_temp.fixture('chat'), pg_temp.uid(40), 'Before') ->> 'id')::uuid);
select is(messaging_private.realtime_actor(), pg_temp.uid(2), 'Eligible subscriber resolves to their own identity');

-- A new report must agree with the permissions on the request row. A retry
-- returns the original receipt without capturing evidence a second time.
select pg_temp.login(3);
select is((select count(*) from public.requests where id=pg_temp.fixture('job')),1::bigint,'Open request is visible');
create temp table original_receipt as select pg_temp.report(10) as receipt;
select ok((select receipt ? 'report_id' from original_receipt),'Visible request has a report receipt');
select public.set_student_block(pg_temp.uid(1),true,0);
select is((select count(*) from public.requests where id=pg_temp.fixture('job')),0::bigint,'Blocker cannot read the open request');
select throws_ok($$select pg_temp.report(11)$$,'42501','This report target is not available.','Blocker cannot submit new request evidence');
select is(pg_temp.report(10),(select receipt from original_receipt),'Exact retry after blocking returns the original receipt');
select public.set_student_block(pg_temp.uid(1),false,1);
select pg_temp.login(1);
select public.set_student_block(pg_temp.uid(3),true,0);
select throws_ok($$select pg_temp.report(12)$$,'42501','This report target is not available.','Owner cannot report their own request');
select pg_temp.login(3);
select is((select count(*) from public.requests where id=pg_temp.fixture('job')),0::bigint,'Blocked student cannot read the open request');
select throws_ok($$select pg_temp.report(13)$$,'42501','This report target is not available.','Blocked student cannot submit new request evidence');
reset role;
select is((select count(*) from safety_private.reports where request_id=pg_temp.fixture('job')),1::bigint,'Denied attempts and retries create no extra evidence');

-- A submitted offer is still pending when its helper becomes suspended.
insert into safety_private.account_standing(profile_id,suspended_until) values(pg_temp.uid(2), now()+interval '7 days');
set local role authenticated;
select pg_temp.login(1);
select throws_ok($$select pg_temp.accept_offer()$$,'22023','Helper is not eligible','Suspension before acceptance prevents reservation');
select is((public.get_my_points()->>'reserved')::integer,0,'Poster retains all available points');
reset role;
select is((select count(*) from public.request_point_reservations where request_id=pg_temp.fixture('job')),0::bigint,'No reservation was written');
select is((select status from public.requests where id=pg_temp.fixture('job')),'open','Job stays open');
select is((select status from public.request_offers where id=pg_temp.fixture('offer')),'pending','Offer stays pending');
update safety_private.account_standing set suspended_until=now()-interval '1 second', warning_count=1 where profile_id=pg_temp.uid(2);
set local role authenticated;
select is(pg_temp.accept_offer(),pg_temp.fixture('offer'),'A helper with an expired suspension and a warning is eligible');
select is((public.get_my_points()->>'reserved')::integer,10,'Exactly the offered points are reserved');
reset role;
update safety_private.account_standing set suspended_until=now()+interval '7 days' where profile_id=pg_temp.uid(2);
set local role authenticated;
select is(pg_temp.accept_offer(),pg_temp.fixture('offer'),'An exact retry after suspension acknowledges the existing acceptance');
select is((public.get_my_points()->>'reserved')::integer,10,'Retry did not reserve points twice');
select pg_temp.login(2);
select is(messaging_private.realtime_actor(),null::uuid,'Suspended student cannot subscribe to activity topics');
select ok(not pg_temp.can_read_topic('messages'),'Message subscription policy denies suspended student');
select ok(not pg_temp.can_read_topic('notifications'),'Bell subscription policy denies suspended student');
select is(public.get_my_account_standing()->>'suspended','true','Suspended student can still read their own decision');
reset role;
select ok(not has_function_privilege('authenticated','safety_private.active_student(uuid)','execute')
  and not has_function_privilege('authenticated','safety_private.account_allowed_for(uuid)','execute')
  and not has_function_privilege('authenticated','messaging_private.send_activity(uuid,uuid)','execute'),
  'Internal recipient checks and the sender are private');

select pg_temp.baseline();
set local role authenticated;
select pg_temp.login(1);
select public.mark_conversation_read(pg_temp.fixture('chat'),1);
reset role;
select ok(pg_temp.delta('messages',1)>0,'Eligible reader gets a cursor update');
select is(pg_temp.delta('messages',2),0::bigint,'Suspended sender gets no peer read-receipt alert');
select ok(exists(select 1 from messaging_private.direct_message_reads where message_id=pg_temp.fixture('before')),
  'Read receipt was still recorded');
select pg_temp.baseline();
set local role authenticated;
insert into fixtures values ('during', (public.send_conversation_message(pg_temp.fixture('chat'), pg_temp.uid(41), 'During') ->> 'id')::uuid);
reset role;
select ok(pg_temp.delta('messages',1)>0,'Eligible participant receives a new-message alert');
select is(pg_temp.delta('messages',2),0::bigint,'Suspended participant gets no new-message alert');
select is(pg_temp.delta('notifications',2),0::bigint,'Bell insert emits no alert to the suspended recipient');
select is((select count(*) from public.notifications where recipient_id=pg_temp.uid(2) and message_id=pg_temp.fixture('during')),
  1::bigint,'Bell entry is stored for the recipient');
select pg_temp.baseline();
update public.conversation_members set last_read_sequence=2, last_read_at=now()
  where conversation_id=pg_temp.fixture('chat') and profile_id=pg_temp.uid(2);
select is(pg_temp.delta('messages',2),0::bigint,'Suspended reader gets no own cursor alert');
select ok(pg_temp.delta('messages',1)>0,'Eligible sender receives a peer receipt alert');
select pg_temp.baseline();
set local role authenticated;
select public.set_student_block(pg_temp.uid(2),true,0);
reset role;
select is(pg_temp.delta('messages',1),1::bigint,'Eligible student gets one block-change alert');
select is(pg_temp.delta('messages',2),0::bigint,'Block change emits no alert to the suspended peer');
select pg_temp.baseline();
-- The same statement-level trigger handles inserts, updates and retention deletes.
insert into public.notifications(recipient_id,event_type,title,body,navigation_key,source_event_key)
  select pg_temp.uid(i),'request_expired','Request expired','Fixture notice','request_details','policy-bell-' || j
  from generate_series(1,2) i cross join generate_series(1,2) j;
select is(pg_temp.delta('notifications',1),1::bigint,'Multi-row insert sends one bell alert per eligible recipient');
select is(pg_temp.delta('notifications',2),0::bigint,'Multi-row insert skips a suspended recipient');
select pg_temp.baseline();
update public.notifications set read_at=now() where source_event_key in ('policy-bell-1','policy-bell-2');
select is(pg_temp.delta('notifications',1),1::bigint,'Bell update alerts eligible recipient');
select is(pg_temp.delta('notifications',2),0::bigint,'Bell update skips suspended recipient');
select pg_temp.baseline();
delete from public.notifications where source_event_key in ('policy-bell-1','policy-bell-2');
select is(pg_temp.delta('notifications',1),1::bigint,'Bell deletion alerts eligible recipient');
select is(pg_temp.delta('notifications',2),0::bigint,'Bell deletion skips suspended recipient');

update safety_private.account_standing set suspended_until=null where profile_id=pg_temp.uid(2);
set local role authenticated;
select pg_temp.login(2);
select is(messaging_private.realtime_actor(),pg_temp.uid(2),'Lifted suspension restores subscription eligibility');
select ok(pg_temp.can_read_topic('messages'),'Message subscription policy admits the reinstated student');
select ok(pg_temp.can_read_topic('notifications'),'Bell subscription policy admits the reinstated student');
select is((select count(*) from public.requests where id=pg_temp.fixture('job')),1::bigint,'Blocked accepted helper can still see the job');
select lives_ok($$select pg_temp.report(14)$$,'Accepted helper can still report the visible job');
select public.cancel_my_accepted_help(pg_temp.fixture('job'),1);
select is((select count(*) from public.requests where id=pg_temp.fixture('job')),1::bigint,'Historical assignment preserves job visibility');
select lives_ok($$select pg_temp.report(15)$$,'Historical helper can report a visible job after cancellation');
reset role;
select safety_private.remove_request(pg_temp.fixture('job'));
set local role authenticated;
select is((select count(*) from public.requests where id=pg_temp.fixture('job')),0::bigint,'Removal hides the request even from a former helper');
select throws_ok($$select pg_temp.report(16)$$,'42501','This report target is not available.','Removed request cannot produce new evidence');
select lives_ok($$select pg_temp.report(15)$$,'A previous receipt is still available after removal');
reset role;
select is((select count(*) from safety_private.reports where request_id=pg_temp.fixture('job')),3::bigint,'Only eligible, distinct reports were saved');
select * from finish();
rollback;
