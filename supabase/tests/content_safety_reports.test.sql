BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- All users, chats, reviews, reports and their side effects roll back.
CREATE FUNCTION pg_temp.uid(i integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('c05afe00-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
$$;
CREATE FUNCTION pg_temp.login(i integer) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', coalesce(pg_temp.uid(i)::text, ''), true);
$$;
CREATE TEMP TABLE fixtures(name text PRIMARY KEY, id uuid);
CREATE TEMP TABLE receipts(name text PRIMARY KEY, value jsonb);
GRANT ALL ON fixtures, receipts TO authenticated;
CREATE FUNCTION pg_temp.fixture(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM fixtures WHERE name=n; $$;
CREATE FUNCTION pg_temp.report(op integer, kind text, target uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.submit_safety_report(pg_temp.uid(op), kind, target, 'harassment', 'Please review this content.');
$$;

INSERT INTO auth.users(id, email, email_confirmed_at)
SELECT pg_temp.uid(n), 'content-safety-' || n || '@tests.local', now() FROM generate_series(1,10) n;
UPDATE public.profiles SET display_name='Private report fixture', onboarding_completed_at=now(), is_discoverable=true
WHERE id IN (SELECT pg_temp.uid(n) FROM generate_series(1,10) n);
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=pg_temp.uid(6);
UPDATE auth.users SET is_anonymous=true WHERE id=pg_temp.uid(7);
UPDATE auth.users SET deleted_at=now() WHERE id=pg_temp.uid(8);
UPDATE public.profiles SET display_name=NULL,onboarding_completed_at=NULL WHERE id=pg_temp.uid(9);
INSERT INTO public.academic_terms(id,code,display_name,year,season,starts_on,ends_on,status)
VALUES(pg_temp.uid(301),'2086-fall','Safety review term',2086,'fall',current_date-30,current_date+30,'current');
INSERT INTO public.courses(id,code,title,term_id,campus_id,status)
VALUES(pg_temp.uid(302),'SAFETY 101','Safety review course',pg_temp.uid(301),
  (SELECT id FROM public.campuses WHERE slug='burnaby'),'active');
INSERT INTO public.course_memberships(course_id,profile_id,status)
SELECT pg_temp.uid(302),pg_temp.uid(n),'enrolled' FROM generate_series(1,2) n;
INSERT INTO course_reviews_private.reviews(id,course_code,term_id,author_id,difficulty,workload,recommend,comment,tips,instructor)
VALUES (pg_temp.uid(303),'SAFETY 101',pg_temp.uid(301),pg_temp.uid(4),2,3,true,'A review comment to report.','Original review tips.','Instructor label'),
       (pg_temp.uid(304),'SAFETY 101',pg_temp.uid(301),pg_temp.uid(1),2,3,true,'My own review comment.','',''),
       (pg_temp.uid(305),'MISSING 101',pg_temp.uid(301),pg_temp.uid(3),2,3,true,'A review without a catalog code.','','');
-- Keep the shared-quota request visible after students 1 and 2 block each other.
INSERT INTO public.requests(id,owner_id,category,title,description,campus_id,room_location,deadline_at,points,item_size,status)
VALUES(pg_temp.uid(306),pg_temp.uid(3),'delivery','Quota report fixture','Please deliver this item.',
  (SELECT id FROM public.campuses WHERE slug='burnaby'),'Library',now()+interval '1 day',5,'small','open');
INSERT INTO public.delivery_request_details(request_id,pickup_location,dropoff_location)
VALUES(pg_temp.uid(306),'Cafe','Library');

-- Only owner SQL can create a retained group fixture while group UI is deferred.
SELECT pg_temp.login(1);
INSERT INTO fixtures VALUES('group',messaging_private.create_group(pg_temp.uid(320),pg_temp.uid(302),'Retained group',ARRAY[pg_temp.uid(2)]));
SELECT pg_temp.login(2);
SELECT messaging_private.respond_group_invitation(
  (SELECT id FROM public.group_conversation_invitations WHERE conversation_id=pg_temp.fixture('group')),'accepted');
INSERT INTO public.messages(id,conversation_id,sender_id,client_message_id,sequence,body)
VALUES(pg_temp.uid(321),pg_temp.fixture('group'),pg_temp.uid(2),pg_temp.uid(322),1,'Group history cannot be reported here.');
UPDATE public.conversations SET last_message_sequence=1,last_message_at=clock_timestamp() WHERE id=pg_temp.fixture('group');

SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
INSERT INTO fixtures VALUES('direct',public.start_direct_conversation(pg_temp.uid(2)));
INSERT INTO fixtures VALUES('own',(public.send_conversation_message(pg_temp.fixture('direct'),pg_temp.uid(330),'My own message.')->>'id')::uuid);
SELECT pg_temp.login(2);
INSERT INTO fixtures VALUES('message',(public.send_conversation_message(pg_temp.fixture('direct'),pg_temp.uid(331),'Only this message is evidence.')->>'id')::uuid);
SELECT pg_temp.login(3);
INSERT INTO fixtures VALUES('unrelated',public.start_direct_conversation(pg_temp.uid(2)));
INSERT INTO fixtures VALUES('unrelated-message',(public.send_conversation_message(pg_temp.fixture('unrelated'),pg_temp.uid(332),'Unrelated private message.')->>'id')::uuid);
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;

CREATE TEMP TABLE before_effects AS SELECT
  (SELECT count(*) FROM public.notifications) notifications,
  (SELECT count(*) FROM public.points_ledger) ledger,
  (SELECT jsonb_agg(to_jsonb(w) ORDER BY w.profile_id) FROM public.points_wallets w) wallets,
  (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.messages m) messages,
  (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM course_reviews_private.reviews r) reviews;

SELECT ok(NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=""'],'Context wrapper is a fixed-search-path invoker')
FROM pg_proc p WHERE p.oid='public.get_safety_report_target(text,uuid)'::regprocedure;
SELECT ok(p.prosecdef AND p.proconfig @> ARRAY['search_path=""'],'Private context validates the caller as fixed-search-path definer')
FROM pg_proc p WHERE p.oid='safety_private.report_target(text,uuid)'::regprocedure;
SELECT ok(NOT has_function_privilege(role_name,'safety_private.content_report_target(text,uuid,uuid)','EXECUTE'),role_name || ' cannot call identity-bearing internal projection')
FROM unnest(ARRAY['anon','authenticated','service_role']) role_name;
SELECT ok(NOT has_function_privilege(role_name,'public.get_safety_report_target(text,uuid)','EXECUTE'),role_name || ' cannot call context API')
FROM unnest(ARRAY['anon','service_role']) role_name;
SELECT ok(NOT has_table_privilege(role_name,'safety_private.reports','SELECT,INSERT,UPDATE,DELETE'),role_name || ' still has no report-table access')
FROM unnest(ARRAY['anon','authenticated','service_role']) role_name;
SELECT is((SELECT count(*) FROM pg_constraint WHERE conrelid='safety_private.reports'::regclass
  AND confrelid IN ('public.messages'::regclass,'course_reviews_private.reviews'::regclass) AND confdeltype='n'),2::bigint,'Both content references use ON DELETE SET NULL');

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.get_safety_report_target('message',pg_temp.fixture('message'))$$,'42501',NULL,'Signed-out context is denied');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(NULL);
SELECT throws_ok($$SELECT public.get_safety_report_target('message',pg_temp.fixture('message'))$$,'42501',NULL,'Context requires a JWT subject');
SELECT pg_temp.login(6);
SELECT throws_ok($$SELECT public.get_safety_report_target('course_review',pg_temp.uid(303))$$,'42501',NULL,'Banned actor cannot inspect review context');
SELECT pg_temp.login(7);
SELECT throws_ok($$SELECT public.get_safety_report_target('course_review',pg_temp.uid(303))$$,'42501',NULL,'Anonymous Auth actor cannot inspect review context');
SELECT pg_temp.login(8);
SELECT throws_ok($$SELECT public.get_safety_report_target('course_review',pg_temp.uid(303))$$,'42501',NULL,'Deleted actor cannot inspect review context');
SELECT pg_temp.login(9);
SELECT throws_ok($$SELECT public.get_safety_report_target('course_review',pg_temp.uid(303))$$,'42501',NULL,'Incomplete actor cannot inspect review context');
SELECT pg_temp.login(1);
SELECT throws_ok($$SELECT public.get_safety_report_target(NULL,pg_temp.uid(303))$$,'22023',NULL,'Context requires target type');
SELECT throws_ok($$SELECT public.get_safety_report_target('course_review',NULL)$$,'22023',NULL,'Context requires target id');
SELECT throws_ok($$SELECT public.get_safety_report_target('student',pg_temp.uid(2))$$,'22023',NULL,'Content context does not invent student context');
SELECT throws_ok($$SELECT public.get_safety_report_target('message',pg_temp.fixture('own'))$$,'42501','This report target is not available.','Own message context is unavailable');
SELECT throws_ok($$SELECT pg_temp.report(401,'message',pg_temp.fixture('own'))$$,'42501','This report target is not available.','Own messages cannot be reported');
SELECT throws_ok($$SELECT pg_temp.report(401,'message',pg_temp.fixture('unrelated-message'))$$,'42501','This report target is not available.','Unrelated private message cannot be reported by guessed id');
SELECT throws_ok($$SELECT public.get_safety_report_target('message',pg_temp.fixture('unrelated-message'))$$,'42501','This report target is not available.','Context cannot enumerate unrelated messages');
SELECT throws_ok($$SELECT pg_temp.report(401,'message',pg_temp.uid(321))$$,'42501','This report target is not available.','Retained group message remains outside reporting scope');
SELECT throws_ok($$SELECT pg_temp.report(401,'message',pg_temp.uid(399))$$,'42501','This report target is not available.','Missing message uses generic unavailable error');
SELECT ok(EXISTS(SELECT 1 FROM public.get_conversation_messages(pg_temp.fixture('direct')) WHERE id=pg_temp.fixture('message')),'Peer message is readable through message API');
SELECT is(public.get_safety_report_target('message',pg_temp.fixture('message')),
  jsonb_build_object('target_type','message','target_id',pg_temp.fixture('message'),'target_label','Direct message'),'Message context is exactly the safe allowlist');
INSERT INTO receipts VALUES('message',pg_temp.report(401,'message',pg_temp.fixture('message')));
SELECT throws_ok($$SELECT pg_temp.report(402,'course_review',pg_temp.uid(304))$$,'42501','This report target is not available.','Own anonymous review cannot be reported');
SELECT throws_ok($$SELECT public.get_safety_report_target('course_review',pg_temp.uid(304))$$,'42501','This report target is not available.','Own review context uses same generic response');
SELECT throws_ok($$SELECT pg_temp.report(402,'course_review',pg_temp.uid(305))$$,'42501','This report target is not available.','Review whose catalog code is unavailable cannot be reported');
SELECT throws_ok($$SELECT pg_temp.report(402,'course_review',pg_temp.uid(399))$$,'42501','This report target is not available.','Missing review uses same generic response');
SELECT ok(EXISTS(SELECT 1 FROM public.list_course_reviews('SAFETY 101') WHERE id=pg_temp.uid(303)),'Review is visible in anonymous review list');
SELECT is(public.get_safety_report_target('course_review',pg_temp.uid(303)),
  jsonb_build_object('target_type','course_review','target_id',pg_temp.uid(303),'target_label','SAFETY 101 course review'),'Review context exposes no author, display name or source content');
INSERT INTO receipts VALUES('review',pg_temp.report(402,'course_review',pg_temp.uid(303)));
SELECT is((SELECT array_agg(k ORDER BY k) FROM receipts,jsonb_object_keys(value) k WHERE name='review'),ARRAY['created_at','report_id'],'Anonymous review receipt has only report id and creation time');
SELECT is((SELECT array_agg(k ORDER BY k) FROM receipts,jsonb_object_keys(value) k WHERE name='message'),ARRAY['created_at','report_id'],'Message receipt has only report id and creation time');
SELECT throws_ok($$SELECT pg_temp.report(401,'course_review',pg_temp.fixture('message'))$$,'22023',NULL,'Operation identity binds target type even with the same UUID');
SELECT throws_ok($$SELECT pg_temp.report(402,'message',pg_temp.uid(303))$$,'22023',NULL,'Review operation cannot be rebound to a message');
SELECT throws_ok($$SELECT public.submit_safety_report(pg_temp.uid(401),'message',pg_temp.fixture('message'),'spam','Please review this content.')$$,'22023',NULL,'Message retry binds reason');
SELECT throws_ok($$SELECT public.submit_safety_report(pg_temp.uid(402),'course_review',pg_temp.uid(303),'harassment','Different details')$$,'22023',NULL,'Review retry binds details');
SELECT pg_temp.login(5);
SELECT is(public.get_safety_report_target('course_review',pg_temp.uid(303))->>'target_label','SAFETY 101 course review','Reading and reporting a review does not require course enrollment');
SELECT pg_temp.login(1);
RESET ROLE;

-- Verify private evidence and attribution without widening any public projection.
SELECT is((SELECT reported_profile_id FROM safety_private.reports WHERE operation_id=pg_temp.uid(401)),pg_temp.uid(2),'Message sender is resolved on the server');
SELECT is((SELECT reported_profile_id FROM safety_private.reports WHERE operation_id=pg_temp.uid(402)),pg_temp.uid(4),'Review author is attributed only inside private reports');
SELECT is((SELECT evidence FROM safety_private.reports WHERE operation_id=pg_temp.uid(401)),
  (SELECT jsonb_build_object('body',body,'created_at',created_at) FROM public.messages WHERE id=pg_temp.fixture('message')),'Message snapshot holds only that message body and time');
SELECT is((SELECT array_agg(k ORDER BY k) FROM safety_private.reports,jsonb_object_keys(evidence) k WHERE operation_id=pg_temp.uid(402)),
  ARRAY['comment','course_code','created_at','difficulty','grade','instructor','term_name','tips','workload'],'Review evidence is limited to content, scores and course/term context');
SELECT is((SELECT message_id FROM safety_private.reports WHERE operation_id=pg_temp.uid(401)),pg_temp.fixture('message'),'Message source FK is retained privately');
SELECT is((SELECT course_review_id FROM safety_private.reports WHERE operation_id=pg_temp.uid(402)),pg_temp.uid(303),'Review source FK is retained privately');
SELECT is((SELECT count(*) FROM public.notifications),(SELECT notifications FROM before_effects),'Reporting creates no notifications');
SELECT is((SELECT count(*) FROM public.points_ledger),(SELECT ledger FROM before_effects),'Reporting creates no points entries');
SELECT is((SELECT jsonb_agg(to_jsonb(w) ORDER BY w.profile_id) FROM public.points_wallets w),(SELECT wallets FROM before_effects),'Reporting changes no wallet balances');
SELECT is((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.messages m),(SELECT messages FROM before_effects),'Reporting does not moderate or change messages');
SELECT is((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM course_reviews_private.reviews r),(SELECT reviews FROM before_effects),'Reporting does not moderate or change reviews');

-- The same history bounds gate both the safe context and new report writes.
UPDATE public.group_membership_periods SET starts_after_sequence=2 WHERE conversation_id=pg_temp.fixture('direct') AND profile_id=pg_temp.uid(1);
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT ok(NOT EXISTS(SELECT 1 FROM public.get_conversation_messages(pg_temp.fixture('direct')) WHERE id=pg_temp.fixture('message')),'Message before membership history boundary is unreadable');
SELECT throws_ok($$SELECT pg_temp.report(403,'message',pg_temp.fixture('message'))$$,'42501',NULL,'Unreadable history cannot be newly reported');
SELECT throws_ok($$SELECT public.get_safety_report_target('message',pg_temp.fixture('message'))$$,'42501',NULL,'Unreadable history has no context');
SELECT is(pg_temp.report(401,'message',pg_temp.fixture('message')),(SELECT value FROM receipts WHERE name='message'),'Existing exact receipt survives changed history access');
RESET ROLE;
UPDATE public.group_membership_periods SET starts_after_sequence=0 WHERE conversation_id=pg_temp.fixture('direct') AND profile_id=pg_temp.uid(1);
UPDATE public.conversations SET status='removed' WHERE id=pg_temp.fixture('direct');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT pg_temp.report(403,'message',pg_temp.fixture('message'))$$,'42501',NULL,'Removed conversation cannot be newly reported');
RESET ROLE;
UPDATE public.conversations SET status='closed' WHERE id=pg_temp.fixture('direct');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.get_safety_report_target('message',pg_temp.fixture('message'))$$,'Closed direct history remains reportable');
SELECT public.set_student_block(pg_temp.uid(2),true,0);
INSERT INTO receipts VALUES('blocked-message',pg_temp.report(403,'message',pg_temp.fixture('message')));
SELECT pg_temp.login(2);
SELECT public.set_student_block(pg_temp.uid(1),true,0);
SELECT pg_temp.login(1);
SELECT lives_ok($$SELECT public.get_safety_report_target('message',pg_temp.fixture('message'))$$,'Blocking in both directions retains context for readable history');
INSERT INTO receipts VALUES('mutual-block-message',pg_temp.report(404,'message',pg_temp.fixture('message')));

-- Four reports above + three students + three requests use one shared quota.
SELECT lives_ok($$SELECT pg_temp.report(410+n,'student',pg_temp.uid(5)) FROM generate_series(1,3) n$$,'Existing student target shares the content-report quota');
SELECT lives_ok($$SELECT pg_temp.report(420+n,'request',pg_temp.uid(306)) FROM generate_series(1,3) n$$,'Existing request target uses the same quota');
SELECT throws_ok($$SELECT pg_temp.report(430,'message',pg_temp.fixture('message'))$$,'54000',NULL,'Eleventh report cannot bypass quota through message type');
SELECT throws_ok($$SELECT pg_temp.report(431,'course_review',pg_temp.uid(303))$$,'54000',NULL,'Eleventh report cannot bypass quota through review type');
SELECT is(pg_temp.report(402,'course_review',pg_temp.uid(303)),(SELECT value FROM receipts WHERE name='review'),'Exact review retry works at shared quota');
SELECT is(pg_temp.report(401,'message',pg_temp.fixture('message')),(SELECT value FROM receipts WHERE name='message'),'Exact message retry works at shared quota');
RESET ROLE;

UPDATE course_reviews_private.reviews SET comment='Changed after the report.',tips='Changed tips.' WHERE id=pg_temp.uid(303);
SELECT is((SELECT evidence->>'comment' FROM safety_private.reports WHERE operation_id=pg_temp.uid(402)),'A review comment to report.','Later review edit cannot rewrite submitted evidence');
DELETE FROM public.messages WHERE id=pg_temp.fixture('message');
DELETE FROM auth.users WHERE id=pg_temp.uid(4);
SELECT is((SELECT message_id FROM safety_private.reports WHERE operation_id=pg_temp.uid(401)),NULL::uuid,'Message deletion nulls private source link');
SELECT ok(NOT EXISTS(SELECT 1 FROM course_reviews_private.reviews WHERE id=pg_temp.uid(303)),'Author account deletion cascades the source review');
SELECT is((SELECT course_review_id FROM safety_private.reports WHERE operation_id=pg_temp.uid(402)),NULL::uuid,'Author deletion nulls review source link without deleting report');
SELECT is((SELECT reported_profile_id FROM safety_private.reports WHERE operation_id=pg_temp.uid(402)),NULL::uuid,'Author deletion nulls private attribution');
SELECT is((SELECT evidence->>'comment' FROM safety_private.reports WHERE operation_id=pg_temp.uid(402)),'A review comment to report.','Minimal review evidence survives author and source deletion');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT is(pg_temp.report(401,'message',pg_temp.fixture('message')),(SELECT value FROM receipts WHERE name='message'),'Exact message replay survives source deletion');
SELECT is(pg_temp.report(402,'course_review',pg_temp.uid(303)),(SELECT value FROM receipts WHERE name='review'),'Exact review replay survives source and author deletion');
SELECT throws_ok($$SELECT public.get_safety_report_target('message',pg_temp.fixture('message'))$$,'42501',NULL,'Deleted message exposes no stale context');
SELECT throws_ok($$SELECT public.get_safety_report_target('course_review',pg_temp.uid(303))$$,'42501',NULL,'Deleted review exposes no stale context');
SELECT throws_ok($$SELECT pg_temp.report(440,'message',pg_temp.fixture('message'))$$,'42501',NULL,'New operation cannot report deleted message');
SELECT throws_ok($$SELECT pg_temp.report(441,'course_review',pg_temp.uid(303))$$,'42501',NULL,'New operation cannot report deleted review');
SELECT throws_ok($$SELECT pg_temp.report(402,'student',pg_temp.uid(303))$$,'22023',NULL,'Deletion does not loosen cross-type operation binding');
RESET ROLE;
SELECT is((SELECT count(*) FROM safety_private.reports WHERE reporter_id=pg_temp.uid(1)),10::bigint,'Failed requests and exact retries create no extra reports');
SELECT * FROM finish();
ROLLBACK;
