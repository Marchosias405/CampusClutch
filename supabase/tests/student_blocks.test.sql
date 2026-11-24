BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT no_plan();

-- These fixtures exercise public workflows and roll back with every assertion.
CREATE FUNCTION pg_temp.uid(i integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('b10c0000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
$$;
CREATE FUNCTION pg_temp.login(i integer) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub',coalesce(pg_temp.uid(i)::text,''),true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(i),'session_id',pg_temp.uid(i+100))::text,true);
END $$;
CREATE FUNCTION pg_temp.payload(points integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('category','delivery','title','Blocking workflow fixture',
    'description','Please help with this disposable request.',
    'campus_id',(SELECT id FROM public.campuses WHERE slug='burnaby'),'room_location','Library',
    'deadline_at',clock_timestamp()+interval '1 day','points',points,'item_size','medium',
    'details','{"pickup_location":"Cafe","dropoff_location":"Library"}'::jsonb);
$$;
CREATE TEMP TABLE fixtures(name text PRIMARY KEY,id uuid);
CREATE TEMP TABLE snapshots(name text PRIMARY KEY,value jsonb);
GRANT ALL ON fixtures,snapshots TO authenticated;
CREATE FUNCTION pg_temp.fixture(name text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM fixtures WHERE fixtures.name=$1 $$;
CREATE FUNCTION pg_temp.block(peer integer,desired boolean,revision bigint) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.set_student_block(pg_temp.uid(peer),desired,revision);
$$;
INSERT INTO auth.users(id,email,email_confirmed_at)
SELECT pg_temp.uid(i),'student-block-'||i||'@test.local',now() FROM generate_series(1,12)i;
UPDATE public.profiles SET display_name='Block Tester',is_discoverable=true,onboarding_completed_at=now()
WHERE id IN (SELECT pg_temp.uid(i) FROM generate_series(1,12)i);
UPDATE public.profiles SET is_discoverable=false WHERE id=pg_temp.uid(4);
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=pg_temp.uid(7);
UPDATE auth.users SET is_anonymous=true WHERE id=pg_temp.uid(8);
UPDATE auth.users SET deleted_at=now() WHERE id=pg_temp.uid(9);
UPDATE public.profiles SET display_name=NULL,onboarding_completed_at=NULL WHERE id=pg_temp.uid(10);
INSERT INTO auth.sessions(id,user_id,created_at) SELECT pg_temp.uid(i+100),pg_temp.uid(i),now() FROM generate_series(1,3)i;
INSERT INTO public.academic_terms(id,code,display_name,year,season,starts_on,ends_on,status)
VALUES(pg_temp.uid(200),'2098-fall','Fall 2098',2098,'fall','2098-09-01','2098-12-31','current');
INSERT INTO public.courses(id,code,title,term_id,campus_id,status)
VALUES(pg_temp.uid(201),'BLOCK 101','Disposable classmates',pg_temp.uid(200),(SELECT id FROM public.campuses WHERE slug='burnaby'),'active');
INSERT INTO public.course_memberships(course_id,profile_id,status)
SELECT pg_temp.uid(201),pg_temp.uid(i),'enrolled' FROM generate_series(1,3)i;

SELECT ok(NOT p.prosecdef,'Public block API is SECURITY INVOKER: '||p.proname)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('get_student_block_state','set_student_block','get_my_blocked_students');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='safety_private.student_blocks'::regclass),'Private directional block table has RLS');
SELECT ok(NOT has_table_privilege(role_name,'safety_private.student_blocks','SELECT,INSERT,UPDATE,DELETE'),role_name||' has no raw block privileges')
FROM unnest(ARRAY['anon','authenticated','service_role']) role_name;
SELECT ok(NOT has_function_privilege('anon',p.oid,'EXECUTE'),'Anonymous callers cannot execute '||p.proname)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('get_student_block_state','set_student_block','get_my_blocked_students');
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT pg_temp.block(2,true,0)$$,'42501',NULL,'Anonymous block mutation denied');
SELECT throws_ok($$SELECT public.get_student_block_state(pg_temp.uid(2))$$,'42501',NULL,'Anonymous state lookup denied');
SELECT throws_ok($$SELECT * FROM public.get_my_blocked_students()$$,'42501',NULL,'Anonymous blocked list denied');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(NULL);
SELECT throws_ok($$SELECT pg_temp.block(2,true,0)$$,'42501',NULL,'Missing caller denied');
SELECT pg_temp.login(99);
SELECT throws_ok($$SELECT pg_temp.block(2,true,0)$$,'42501',NULL,'Nonexistent caller denied');
SELECT pg_temp.login(7);
SELECT throws_ok($$SELECT pg_temp.block(2,true,0)$$,'42501',NULL,'Banned caller denied');
SELECT pg_temp.login(8);
SELECT throws_ok($$SELECT pg_temp.block(2,true,0)$$,'42501',NULL,'Anonymous Auth user denied');
SELECT pg_temp.login(9);
SELECT throws_ok($$SELECT pg_temp.block(2,true,0)$$,'42501',NULL,'Deleted caller denied');
SELECT pg_temp.login(10);
SELECT throws_ok($$SELECT pg_temp.block(2,true,0)$$,'42501',NULL,'Incomplete caller denied');
SELECT pg_temp.login(1);
SELECT throws_ok($$SELECT pg_temp.block(1,true,0)$$,'22023',NULL,'Self block denied');
SELECT throws_ok($$SELECT pg_temp.block(NULL,true,0)$$,'22023',NULL,'Null peer denied');
SELECT throws_ok($$SELECT pg_temp.block(2,NULL,0)$$,'22023',NULL,'Null desired state denied');
SELECT throws_ok($$SELECT pg_temp.block(2,true,NULL)$$,'22023',NULL,'Missing reviewed version denied');
SELECT throws_ok($$SELECT pg_temp.block(2,true,-1)$$,'22023',NULL,'Negative version denied');
SELECT throws_ok($$SELECT pg_temp.block(4,true,0)$$,'42501',NULL,'Hidden stranger cannot be targeted by guessed id');
SELECT throws_ok($$SELECT pg_temp.block(99,true,0)$$,'42501',NULL,'Random peer cannot be targeted');
SELECT throws_ok($$SELECT pg_temp.block(10,true,0)$$,'42501',NULL,'Incomplete stranger cannot be targeted');
SELECT is(public.get_student_block_state(pg_temp.uid(2)),jsonb_build_object('profile_id',pg_temp.uid(2),'blocked_by_me',false,'interaction_blocked',false,'revision','0'),'Fresh pair starts with exact public projection and string revision');
SELECT is((SELECT count(*) FROM public.get_my_blocked_students()),0::bigint,'Fresh blocked list empty');
SELECT throws_ok($$SELECT * FROM public.get_my_blocked_students(0,0)$$,'22023',NULL,'Zero page length rejected');
SELECT throws_ok($$SELECT * FROM public.get_my_blocked_students(51,0)$$,'22023',NULL,'Oversize page rejected');
SELECT throws_ok($$SELECT * FROM public.get_my_blocked_students(20,-1)$$,'22023',NULL,'Negative offset rejected');

-- Prepare one private relationship, unselected offers and accepted paid work.
INSERT INTO fixtures VALUES('ab',public.start_direct_conversation(pg_temp.uid(2))),('ac',public.start_direct_conversation(pg_temp.uid(3)));
SELECT public.set_my_android_push_device('ExpoPushToken[student-block-a]');
SELECT public.set_my_push_preference('push_enabled',true);
INSERT INTO fixtures VALUES('pending',public.save_my_request(pg_temp.payload(10))),
 ('complete',public.save_my_request(pg_temp.payload(20))),('cancel',public.save_my_request(pg_temp.payload(30)));
SELECT pg_temp.login(2);
INSERT INTO fixtures VALUES('pending-b',public.create_my_request_offer_for_terms(pg_temp.fixture('pending'),1,10)),
 ('complete-b',public.create_my_request_offer_for_terms(pg_temp.fixture('complete'),1,20)),
 ('cancel-b',public.create_my_request_offer_for_terms(pg_temp.fixture('cancel'),1,30));
INSERT INTO fixtures VALUES('renew',public.save_my_request(pg_temp.payload(10))),('b-open',public.save_my_request(pg_temp.payload(10)));
INSERT INTO snapshots VALUES('old-message',public.send_conversation_message(pg_temp.fixture('ab'),pg_temp.uid(301),'Before blocking'));
SELECT pg_temp.login(1);
INSERT INTO fixtures VALUES('renew-a',public.create_my_request_offer_for_terms(pg_temp.fixture('renew'),1,10));
SELECT public.decide_request_offer_for_round(pg_temp.fixture('complete-b'),'accepted',1,20);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('cancel-b'),'accepted',1,30);
SELECT pg_temp.login(2);
SELECT public.save_my_request(pg_temp.payload(11),pg_temp.fixture('renew'));
SELECT pg_temp.login(3);
INSERT INTO fixtures VALUES('pending-c',public.create_my_request_offer_for_terms(pg_temp.fixture('pending'),1,10));
SELECT pg_temp.login(1);
INSERT INTO snapshots VALUES('points-before',public.get_my_points());
SELECT is((public.get_my_points()->>'reserved')::integer,50,'Accepted fixture work reserves fifty points');
SELECT is((SELECT count(*) FROM public.get_course_classmates(pg_temp.uid(201))),2::bigint,'Both peers discoverable before blocking');
RESET ROLE;
SELECT ok(EXISTS(SELECT 1 FROM notifications_private.push_jobs j JOIN public.notifications n ON n.id=j.notification_id WHERE n.message_id=((SELECT value->>'id' FROM snapshots WHERE name='old-message'))::uuid),'Incoming message was queued before the block');
CREATE TEMP TABLE balances_before AS SELECT profile_id,balance,reserved FROM public.points_wallets
WHERE profile_id IN(SELECT pg_temp.uid(i) FROM generate_series(1,12)i);
CREATE TEMP TABLE jobs_before AS SELECT id,status,offer_round FROM public.requests
WHERE owner_id IN(pg_temp.uid(1),pg_temp.uid(2),pg_temp.uid(3));
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
INSERT INTO snapshots VALUES('blocked',pg_temp.block(2,true,0));
RESET ROLE;
SELECT ok(EXISTS(SELECT 1 FROM public.notifications WHERE message_id=((SELECT value->>'id' FROM snapshots WHERE name='old-message'))::uuid AND read_at IS NULL),'Queued-message regression uses an unread notice');
SELECT ok(NOT EXISTS(SELECT 1 FROM notifications_private.push_targets t JOIN public.notifications n ON n.id=t.notification_id WHERE n.message_id=((SELECT value->>'id' FROM snapshots WHERE name='old-message'))::uuid),'Block removes an unread queued contact from push targets before any read receipt');
INSERT INTO public.notifications(id,recipient_id,actor_id,event_type,title,body,conversation_id,navigation_key,source_event_key)
VALUES(pg_temp.uid(501),pg_temp.uid(1),pg_temp.uid(2),'message_received','Test','Test',pg_temp.fixture('ab'),'conversation','block-synthetic-dm');
INSERT INTO public.notifications(id,recipient_id,actor_id,event_type,title,body,request_id,offer_id,navigation_key,source_event_key)
VALUES(pg_temp.uid(502),pg_temp.uid(1),pg_temp.uid(2),'offer_created','Test','Test',pg_temp.fixture('pending'),pg_temp.fixture('pending-b'),'request_details','block-synthetic-offer'),
 (pg_temp.uid(503),pg_temp.uid(1),NULL,'request_expired','Test','Test',pg_temp.fixture('renew'),pg_temp.fixture('renew-a'),'request_details','block-synthetic-expired');
SELECT is((SELECT count(*) FROM public.notifications WHERE id IN(pg_temp.uid(501),pg_temp.uid(502),pg_temp.uid(503))),0::bigint,'Server insertion guard suppresses new DM, pending offer and owner-inferred expiry contact notices');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT is((SELECT value FROM snapshots WHERE name='blocked'),jsonb_build_object('profile_id',pg_temp.uid(2),'blocked_by_me',true,'interaction_blocked',true,'revision','1'),'First block increments own revision and exposes no peer block owner');
SELECT is(pg_temp.block(2,true,0),(SELECT value FROM snapshots WHERE name='blocked'),'Ambiguous exact mutation retry returns existing state');
SELECT is(pg_temp.block(2,true,1),(SELECT value FROM snapshots WHERE name='blocked'),'Already blocked no-op does not advance revision');
SELECT is(public.get_my_points(),(SELECT value FROM snapshots WHERE name='points-before'),'Block never transfers or releases points');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=pg_temp.uid(2)),'Blocker cannot discover peer profile');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.get_course_classmates(pg_temp.uid(201)) WHERE profile_id=pg_temp.uid(2)),'Blocker classmates omit blocked peer');
SELECT ok(EXISTS(SELECT 1 FROM public.get_course_classmates(pg_temp.uid(201)) WHERE profile_id=pg_temp.uid(3)),'Unrelated classmate stays discoverable');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.get_request_feed() WHERE owner_id=pg_temp.uid(2)),'Blocker request feed omits peer requests');
SELECT is((SELECT count(*) FROM public.get_my_blocked_students()),1::bigint,'Blocker sees one owned block');
SELECT is((SELECT profile_id FROM public.get_my_blocked_students(1,0)),pg_temp.uid(2),'List identifies only the user-owned blocked peer');
SELECT is((SELECT revision FROM public.get_my_blocked_students(1,0)),'1','List revision remains text');
SELECT is((SELECT count(*) FROM public.get_my_blocked_students(1,1)),0::bigint,'List supports exclusive offset pagination');
SELECT is((SELECT count(*) FROM public.get_conversation_messages(pg_temp.fixture('ab'))),1::bigint,'Existing history is readable after blocking');
SELECT lives_ok($$SELECT public.submit_safety_report(pg_temp.uid(401),'student',pg_temp.uid(2),'harassment','Reporting an existing DM peer after blocking.')$$,'Blocker can still report an existing DM peer after profile discovery hides them');
SELECT lives_ok($$SELECT public.mark_conversation_read(pg_temp.fixture('ab'),1)$$,'Read receipts remain available for preserved history');
SELECT throws_ok($$SELECT public.send_conversation_message(pg_temp.fixture('ab'),pg_temp.uid(302),'After block')$$,'42501',NULL,'Blocker cannot send new messages through existing conversation');
SELECT throws_ok($$SELECT public.start_direct_conversation(pg_temp.uid(2))$$,'42501',NULL,'Blocker cannot restart existing direct conversation');
SELECT throws_ok($$SELECT public.start_request_contact_conversation(pg_temp.fixture('pending'),pg_temp.uid(2))$$,'42501',NULL,'Request contact cannot bypass block');
SELECT throws_ok($$SELECT public.create_my_request_offer_for_terms(pg_temp.fixture('b-open'),1,10)$$,'42501',NULL,'Blocker cannot offer on peer request');
SELECT throws_ok($$SELECT public.renew_my_request_offer_for_terms(pg_temp.fixture('renew-a'),2,11)$$,'42501',NULL,'Blocker cannot renew previously retired consent');
SELECT throws_ok($$SELECT public.decide_request_offer_for_round(pg_temp.fixture('pending-b'),'accepted',1,10)$$,'42501',NULL,'Owner cannot accept blocked pending helper');
SELECT throws_ok($$SELECT request_private.decide_offer_core(pg_temp.fixture('pending-b'),'accepted')$$,'42501',NULL,'Internal legacy entry cannot bypass block');
SELECT lives_ok($$SELECT public.send_conversation_message(pg_temp.fixture('ac'),pg_temp.uid(303),'Unrelated still works')$$,'Unrelated conversation still sends');
SELECT pg_temp.login(2);
SELECT is(public.get_student_block_state(pg_temp.uid(1)),jsonb_build_object('profile_id',pg_temp.uid(1),'blocked_by_me',false,'interaction_blocked',true,'revision','0'),'Counterparty sees unavailable interaction without owning the block');
SELECT is((SELECT count(*) FROM public.get_my_blocked_students()),0::bigint,'Counterparty cannot enumerate another person blocks');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=pg_temp.uid(1)),'Counterparty cannot discover blocker profile');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.get_course_classmates(pg_temp.uid(201)) WHERE profile_id=pg_temp.uid(1)),'Classmate blocking works in both directions');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.get_request_feed() WHERE owner_id=pg_temp.uid(1)),'Counterparty feed hides blocker even with a prior pending offer');
SELECT throws_ok($$SELECT public.send_conversation_message(pg_temp.fixture('ab'),pg_temp.uid(304),'Reverse contact')$$,'42501',NULL,'Counterparty cannot send new messages');
SELECT lives_ok($$SELECT public.submit_safety_report(pg_temp.uid(402),'student',pg_temp.uid(1),'harassment','Reporting the existing DM relationship.')$$,'Counterparty can also report existing DM relationship without new contact');
SELECT is(public.send_conversation_message(pg_temp.fixture('ab'),pg_temp.uid(301),'Before blocking'),(SELECT value FROM snapshots WHERE name='old-message'),'Already committed exact message retry preserves its original receipt');
SELECT throws_ok($$SELECT public.create_my_request_offer_for_terms(pg_temp.fixture('pending'),1,10)$$,'42501',NULL,'Old offer API path cannot reactivate blocked contact');
SELECT ok(EXISTS(SELECT 1 FROM public.requests WHERE id=pg_temp.fixture('complete')),'Accepted helper retains assignment details');
SELECT is(pg_temp.block(1,false,0)->>'interaction_blocked','true','Unblocking oneself cannot remove peer-owned block');
SELECT is(pg_temp.block(1,true,0)->>'revision','1','Counterparty can independently block existing relationship');
SELECT pg_temp.login(1);
SELECT is(pg_temp.block(2,false,1)->>'interaction_blocked','true','Removing first direction leaves mutual block effective');
SELECT is(pg_temp.block(2,false,1)->>'revision','2','Retry of unblock preserves version');
SELECT throws_ok($$SELECT pg_temp.block(2,true,0)$$,'PT409',NULL,'Delayed old block cannot undo a newer unblock');
SELECT is((SELECT count(*) FROM public.get_my_blocked_students()),0::bigint,'Unblocked tombstone is not in owned blocked list');
SELECT pg_temp.login(2);
SELECT is(pg_temp.block(1,false,1)->>'interaction_blocked','false','Both directions removed restores interaction');
SELECT lives_ok($$SELECT public.send_conversation_message(pg_temp.fixture('ab'),pg_temp.uid(305),'Restored contact')$$,'Mutual unblock restores messaging');
SELECT pg_temp.login(1);
SELECT is(pg_temp.block(2,true,2)->>'revision','3','Reblock advances retained tombstone version');
SELECT throws_ok($$SELECT pg_temp.block(2,false,1)$$,'PT409',NULL,'Delayed old unblock cannot override a later block');
RESET ROLE;
SELECT results_eq($$SELECT profile_id,balance,reserved FROM public.points_wallets WHERE profile_id IN(SELECT pg_temp.uid(i) FROM generate_series(1,12)i) ORDER BY profile_id$$,$$SELECT profile_id,balance,reserved FROM balances_before ORDER BY profile_id$$,'Repeated blocks and stale retries move no wallet balance or reservation');
SELECT results_eq($$SELECT id,status,offer_round FROM public.requests WHERE owner_id IN(pg_temp.uid(1),pg_temp.uid(2),pg_temp.uid(3)) ORDER BY id$$,$$SELECT id,status,offer_round FROM jobs_before ORDER BY id$$,'Repeated blocks never cancel, complete or reassign jobs');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.claim_android_push_jobs() j JOIN public.notifications n ON n.id=j.notification_id WHERE n.event_type='message_received' AND n.actor_id=pg_temp.uid(2) AND n.recipient_id=pg_temp.uid(1)),'Queued contact push is suppressed at dispatch after block');

-- Existing accepted work must remain resolvable, with one transfer/release only.
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT is(public.complete_my_request(pg_temp.fixture('complete'),1),pg_temp.fixture('complete'),'Poster can complete accepted work after blocking');
SELECT is(public.complete_my_request(pg_temp.fixture('complete'),1),pg_temp.fixture('complete'),'Blocked completion retry remains idempotent');
SELECT is((public.get_my_points()->>'balance')::integer,80,'Completion transfers exactly twenty poster points');
SELECT is((public.get_my_points()->>'reserved')::integer,30,'Unrelated accepted hold remains reserved');
SELECT is(public.cancel_my_request_for_round(pg_temp.fixture('cancel'),1,'accepted'),pg_temp.fixture('cancel'),'Poster can cancel accepted blocked assignment');
SELECT is(public.cancel_my_request_for_round(pg_temp.fixture('cancel'),1,'accepted'),pg_temp.fixture('cancel'),'Blocked cancellation retry remains idempotent');
SELECT is((public.get_my_points()->>'balance')::integer,80,'Cancelled assignment does not pay the helper');
SELECT is((public.get_my_points()->>'reserved')::integer,0,'Cancellation releases remaining hold exactly once');
SELECT is(public.submit_request_rating(pg_temp.fixture('complete'),1,4),pg_temp.fixture('complete'),'Poster can rate completed blocked assignment');
SELECT is(public.submit_request_rating(pg_temp.fixture('cancel'),1,3),pg_temp.fixture('cancel'),'Poster can rate cancelled blocked assignment');
SELECT lives_ok($$SELECT public.decide_request_offer_for_round(pg_temp.fixture('pending-c'),'accepted',1,10)$$,'Unrelated helper can still accept the original pending request');
SELECT pg_temp.login(2);
SELECT is((public.get_my_points()->>'balance')::integer,120,'Helper receives only the completed assignment points');
SELECT ok(EXISTS(SELECT 1 FROM public.notifications WHERE event_type='request_completed' AND request_id=pg_temp.fixture('complete')),'Necessary accepted-work completion notice survives blocking');
SELECT ok(EXISTS(SELECT 1 FROM public.notifications WHERE event_type='request_cancelled' AND request_id=pg_temp.fixture('cancel')),'Necessary accepted-work cancellation notice survives blocking');
SELECT ok(EXISTS(SELECT 1 FROM public.requests WHERE id=pg_temp.fixture('cancel')),'Former helper retains cancelled assignment history');
SELECT is(public.submit_request_rating(pg_temp.fixture('complete'),1,5),pg_temp.fixture('complete'),'Helper can rate completed blocked assignment');
SELECT is(public.submit_request_rating(pg_temp.fixture('cancel'),1,2),pg_temp.fixture('cancel'),'Helper can rate cancelled blocked assignment');
SELECT pg_temp.login(3);
SELECT throws_ok($$SELECT public.submit_request_rating(pg_temp.fixture('complete'),1,1)$$,'42501',NULL,'Block does not authorize unrelated person to rate assignment');
SELECT ok(EXISTS(SELECT 1 FROM public.profiles WHERE id=pg_temp.uid(1)) AND EXISTS(SELECT 1 FROM public.profiles WHERE id=pg_temp.uid(2)),'Third party discovery unaffected by another pair block');

-- Hidden existing peers remain manageable without making strangers enumerable.
RESET ROLE;
UPDATE public.profiles SET is_discoverable=false WHERE id=pg_temp.uid(2);
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT is(pg_temp.block(2,false,3)->>'blocked_by_me','false','Own block can be removed after peer hides their profile');
INSERT INTO fixtures VALUES('helper-withdraw',public.save_my_request(pg_temp.payload(20)));
SELECT pg_temp.login(2);
INSERT INTO fixtures VALUES('helper-withdraw-b',public.create_my_request_offer_for_terms(pg_temp.fixture('helper-withdraw'),1,20));
SELECT pg_temp.login(1);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('helper-withdraw-b'),'accepted',1,20);
SELECT is(pg_temp.block(2,true,4)->>'blocked_by_me','true','Existing private DM peer can still be blocked');
SELECT pg_temp.login(2);
SELECT is(public.cancel_my_accepted_help(pg_temp.fixture('helper-withdraw'),1),pg_temp.fixture('helper-withdraw'),'Blocked accepted helper can withdraw normally');
SELECT is(public.cancel_my_accepted_help(pg_temp.fixture('helper-withdraw'),1),pg_temp.fixture('helper-withdraw'),'Blocked helper withdrawal retry stays idempotent');
SELECT pg_temp.login(1);
SELECT ok((SELECT status='open' AND offer_round=2 FROM public.requests WHERE id=pg_temp.fixture('helper-withdraw')),'Blocked helper withdrawal reopens selection in a fresh round');
SELECT is((public.get_my_points()->>'reserved')::integer,10,'Helper withdrawal releases its own hold and preserves third-party hold');
SELECT is((public.get_my_points()->>'balance')::integer,80,'Helper withdrawal after block transfers no points');
SELECT public.cancel_my_request_for_round(pg_temp.fixture('helper-withdraw'),2,'open');
SELECT pg_temp.block(2,false,5);
INSERT INTO fixtures VALUES('owner-reopen',public.save_my_request(pg_temp.payload(20)));
SELECT pg_temp.login(2);
INSERT INTO fixtures VALUES('owner-reopen-b',public.create_my_request_offer_for_terms(pg_temp.fixture('owner-reopen'),1,20));
SELECT pg_temp.login(1);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('owner-reopen-b'),'accepted',1,20);
SELECT pg_temp.block(2,true,6);
SELECT lives_ok($$SELECT public.reopen_my_request(pg_temp.fixture('owner-reopen'),1,'2099-01-01T00:00:00Z')$$,'Poster can reopen blocked accepted work');
SELECT lives_ok($$SELECT public.reopen_my_request(pg_temp.fixture('owner-reopen'),1,'2099-01-01T00:00:00Z')$$,'Blocked poster reopen exact retry remains safe');
SELECT is((public.get_my_points()->>'reserved')::integer,10,'Poster reopen releases its hold exactly once');
SELECT pg_temp.login(2);
SELECT throws_ok($$SELECT public.renew_my_request_offer_for_terms(pg_temp.fixture('owner-reopen-b'),2,20)$$,'42501',NULL,'Previously selected blocked helper cannot reoffer after reopening');
SELECT pg_temp.login(1);
SELECT is(pg_temp.block(5,true,0)->>'blocked_by_me','true','Second visible student can be blocked independently');
SELECT is((SELECT count(*) FROM public.get_my_blocked_students(1,0)),1::bigint,'First owned block page bounded');
SELECT is((SELECT count(*) FROM public.get_my_blocked_students(1,1)),1::bigint,'Second owned block page bounded');
SELECT isnt((SELECT profile_id FROM public.get_my_blocked_students(1,0)),(SELECT profile_id FROM public.get_my_blocked_students(1,1)),'Stable pagination does not duplicate peers');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
