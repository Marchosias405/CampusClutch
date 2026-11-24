BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- All users, starter receipts, requests and reports roll back with this suite.
CREATE FUNCTION pg_temp.uid(i integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('5afe0000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
$$;
CREATE FUNCTION pg_temp.login(i integer) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', coalesce(pg_temp.uid(i)::text, ''), true);
$$;
CREATE FUNCTION pg_temp.report(
  operation integer, target_kind text DEFAULT 'student', target integer DEFAULT 2,
  reason text DEFAULT 'harassment', details text DEFAULT ''
) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.submit_safety_report(pg_temp.uid(operation), target_kind, pg_temp.uid(target), reason, details);
$$;
CREATE FUNCTION pg_temp.report_result(operation integer, target_kind text, target integer)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.report(operation, target_kind, target);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END;
$$;

INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT pg_temp.uid(n), 'safety-report-' || n || '@tests.local', now()
FROM generate_series(1, 20) n;
UPDATE public.profiles SET display_name = 'Safety Fixture Student', onboarding_completed_at = now(), is_discoverable = true
WHERE id IN (SELECT pg_temp.uid(n) FROM generate_series(1,20) n);
UPDATE public.profiles SET is_discoverable = false WHERE id = pg_temp.uid(3);
UPDATE public.profiles SET display_name = NULL, onboarding_completed_at = NULL WHERE id = pg_temp.uid(9);
UPDATE auth.users SET banned_until = now() + interval '1 day' WHERE id = pg_temp.uid(6);
UPDATE auth.users SET is_anonymous = true WHERE id = pg_temp.uid(7);
UPDATE auth.users SET deleted_at = now() WHERE id = pg_temp.uid(8);

INSERT INTO public.requests (id, owner_id, category, title, description, campus_id, room_location, deadline_at, points, item_size, status, cancelled_at)
SELECT pg_temp.uid(n), pg_temp.uid(CASE WHEN n=107 THEN 1 WHEN n=109 THEN 3 ELSE 2 END),
  'delivery', 'Report fixture ' || n, 'A visible request description.',
  (SELECT id FROM public.campuses WHERE slug='burnaby'), 'Private pickup room',
  now() + CASE WHEN n=102 THEN interval '-1 day' ELSE interval '1 day' END,
  5, 'medium', state, CASE WHEN state='cancelled' THEN now() END
FROM (VALUES (101,'open'),(102,'open'),(103,'accepted'),(104,'cancelled'),(105,'expired'),(106,'completed'),(107,'open'),(108,'open'),(109,'cancelled')) s(n,state);
INSERT INTO public.delivery_request_details (request_id, pickup_location, dropoff_location)
SELECT pg_temp.uid(n), 'Private pickup', 'Private dropoff' FROM generate_series(101,109) n;
INSERT INTO public.request_offers (request_id, offering_user_id, status, decided_at)
VALUES (pg_temp.uid(103),pg_temp.uid(4),'accepted',now()),
       (pg_temp.uid(104),pg_temp.uid(5),'rejected',now());
INSERT INTO public.request_point_reservations (request_id,offer_round,poster_id,helper_id,amount,status,released_at)
VALUES (pg_temp.uid(104),1,pg_temp.uid(2),pg_temp.uid(5),5,'released',now());
SET CONSTRAINTS ALL IMMEDIATE;

CREATE TEMP TABLE receipts (name text PRIMARY KEY, receipt jsonb);
GRANT ALL ON receipts TO authenticated;
CREATE TEMP TABLE before_side_effects AS
SELECT (SELECT count(*) FROM public.notifications) AS notifications,
       (SELECT count(*) FROM public.points_ledger) AS ledger,
       (SELECT jsonb_agg(to_jsonb(w) ORDER BY w.profile_id) FROM public.points_wallets w) AS wallets,
       (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.requests r) AS requests;

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='safety_private.reports'::regclass), 'Private report table has RLS enabled');
SELECT ok(NOT has_table_privilege(role_name, 'safety_private.reports', 'SELECT,INSERT,UPDATE,DELETE'), role_name || ' has no raw report privileges')
FROM unnest(ARRAY['anon','authenticated','service_role']) role_name;
SELECT is((SELECT count(*) FROM pg_policies WHERE schemaname='safety_private'), 0::bigint, 'No client report-read or write policies exist');
SELECT ok(NOT p.prosecdef, 'Public report API is SECURITY INVOKER') FROM pg_proc p
WHERE p.oid='public.submit_safety_report(uuid,text,uuid,text,text)'::regprocedure;
SELECT ok(p.prosecdef AND p.proconfig @> ARRAY['search_path=""'], 'Private submitter is a definer with empty search path') FROM pg_proc p
WHERE p.oid='safety_private.submit_report(uuid,text,uuid,text,text)'::regprocedure;
SELECT ok(NOT has_function_privilege(role_name,'public.submit_safety_report(uuid,text,uuid,text,text)','EXECUTE'), role_name || ' cannot call report API')
FROM unnest(ARRAY['anon','service_role']) role_name;

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT pg_temp.report(201)$$,'42501',NULL,'Signed-out role cannot submit reports');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(NULL);
SELECT throws_ok($$SELECT pg_temp.report(201)$$,'42501',NULL,'Missing JWT subject is rejected');
SELECT pg_temp.login(90);
SELECT throws_ok($$SELECT pg_temp.report(201)$$,'42501',NULL,'Nonexistent JWT subject is rejected');
SELECT pg_temp.login(9);
SELECT throws_ok($$SELECT pg_temp.report(201)$$,'42501',NULL,'Incomplete actor cannot report');
SELECT pg_temp.login(8);
SELECT throws_ok($$SELECT pg_temp.report(201)$$,'42501',NULL,'Deleted actor cannot report');
SELECT pg_temp.login(7);
SELECT throws_ok($$SELECT pg_temp.report(201)$$,'42501',NULL,'Anonymous Auth actor cannot report');
SELECT pg_temp.login(6);
SELECT throws_ok($$SELECT pg_temp.report(201)$$,'42501',NULL,'Banned actor cannot report');
SELECT pg_temp.login(1);
SELECT throws_ok($$SELECT public.submit_safety_report(NULL,'student',pg_temp.uid(2),'spam')$$,'22023',NULL,'Operation id is required');
SELECT throws_ok($$SELECT public.submit_safety_report(pg_temp.uid(201),'student',NULL,'spam')$$,'22023',NULL,'Target id is required');
SELECT throws_ok($$SELECT pg_temp.report(201,NULL)$$,'22023',NULL,'Target type cannot be null');
SELECT throws_ok($$SELECT pg_temp.report(201,'unsupported')$$,'22023',NULL,'Unsupported target type is rejected');
SELECT throws_ok($$SELECT pg_temp.report(201,'student',2,NULL)$$,'22023',NULL,'Reason cannot be null');
SELECT throws_ok($$SELECT pg_temp.report(201,'student',2,'made_up')$$,'22023',NULL,'Reason must come from the server allowlist');
SELECT throws_ok($$SELECT pg_temp.report(201,'student',2,'spam',repeat('x',2001))$$,'22023',NULL,'Details over 2,000 characters are rejected');
SELECT throws_ok($$SELECT pg_temp.report(201,'student',2,'spam',repeat('😀',2001))$$,'22023',NULL,'Unicode codepoints determine the details limit');
SELECT throws_ok($$SELECT pg_temp.report(201,'student',2,'other','          ')$$,'22023',NULL,'Other requires ten characters after trimming spaces');
SELECT throws_ok($$SELECT pg_temp.report(201,'student',2,'other',repeat('😀',9))$$,'22023',NULL,'Nine Unicode codepoints are insufficient for Other');

-- Parity with actual SELECT RLS: self is the single deliberate exception.
SELECT ok(EXISTS(SELECT 1 FROM public.profiles WHERE id=pg_temp.uid(1)), 'Owner can SELECT their own profile');
SELECT is(pg_temp.report_result(201,'student',1),'42501','Self profile cannot be reported');
SELECT ok(EXISTS(SELECT 1 FROM public.profiles WHERE id=pg_temp.uid(2)), 'Discoverable complete profile is SELECT-visible');
INSERT INTO receipts VALUES ('student',pg_temp.report(201,'student',2,'harassment','  Test details  '));
SELECT is((SELECT array_agg(k ORDER BY k) FROM receipts,jsonb_object_keys(receipt) k WHERE name='student'), ARRAY['created_at','report_id'], 'Receipt exposes only id and timestamp');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=pg_temp.uid(3)), 'Hidden profile is not SELECT-visible');
SELECT is(pg_temp.report_result(202,'student',3),'42501','Hidden profile cannot be reported by guessed id');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=pg_temp.uid(9)), 'Incomplete target profile is not SELECT-visible');
SELECT is(pg_temp.report_result(202,'student',9),'42501','Incomplete target profile cannot be reported');
SELECT throws_ok($$SELECT pg_temp.report(202,'student',90)$$,'42501','This report target is not available.','Missing target uses the same unavailable error');
SELECT throws_ok($$SELECT pg_temp.report(202,'student',3)$$,'42501','This report target is not available.','Hidden target uses the same unavailable error');

SELECT ok(EXISTS(SELECT 1 FROM public.requests WHERE id=pg_temp.uid(101)), 'Open unexpired request is SELECT-visible');
INSERT INTO receipts VALUES ('request',pg_temp.report(202,'request',101,'unsafe','Please review this request.'));
SELECT ok(NOT EXISTS(SELECT 1 FROM public.requests WHERE id=pg_temp.uid(102)), 'Expired open request is not SELECT-visible to outsider');
SELECT is(pg_temp.report_result(203,'request',102),'42501','Expired open request cannot be reported by outsider');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.requests WHERE id=pg_temp.uid(103)), 'Accepted request is hidden from outsider');
SELECT is(pg_temp.report_result(203,'request',103),'42501','Accepted request cannot be reported by outsider');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.requests WHERE id=pg_temp.uid(104)), 'Cancelled request is hidden from outsider');
SELECT is(pg_temp.report_result(203,'request',104),'42501','Cancelled request cannot be reported by outsider');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.requests WHERE id=pg_temp.uid(105)), 'Expired request is hidden from outsider');
SELECT is(pg_temp.report_result(203,'request',105),'42501','Expired request cannot be reported by outsider');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.requests WHERE id=pg_temp.uid(106)), 'Completed request is hidden from outsider');
SELECT is(pg_temp.report_result(203,'request',106),'42501','Completed request cannot be reported by outsider');
SELECT ok(EXISTS(SELECT 1 FROM public.requests WHERE id=pg_temp.uid(107)), 'Own request is SELECT-visible');
SELECT is(pg_temp.report_result(203,'request',107),'42501','Own request cannot be reported');
SELECT is(pg_temp.report_result(203,'request',190),'42501','Missing request uses unavailable error');

SELECT pg_temp.login(4);
SELECT ok(EXISTS(SELECT 1 FROM public.requests WHERE id=pg_temp.uid(103)), 'Accepted helper can SELECT accepted request');
SELECT is(pg_temp.report_result(203,'request',103),'ok','Accepted helper can report request');
SELECT pg_temp.login(5);
SELECT ok(EXISTS(SELECT 1 FROM public.requests WHERE id=pg_temp.uid(104)), 'Historical assigned helper can SELECT cancelled request');
SELECT is(pg_temp.report_result(204,'request',104),'ok','Historical assigned helper can report cancelled assignment');
SELECT pg_temp.login(3);
SELECT is(pg_temp.report_result(205,'student',2),'ok','Hidden but complete actor can still report a visible student');
SELECT pg_temp.login(1);

SELECT is(pg_temp.report(201,'student',2,'harassment','Test details'), (SELECT receipt FROM receipts WHERE name='student'), 'Canonical retry returns exactly the original receipt');
SELECT throws_ok($$SELECT pg_temp.report(201,'student',2,'harassment','Different')$$,'22023',NULL,'Same operation cannot change details');
SELECT throws_ok($$SELECT pg_temp.report(201,'student',2,'scam','Test details')$$,'22023',NULL,'Same operation cannot change reason');
SELECT throws_ok($$SELECT pg_temp.report(201,'student',4,'harassment','Test details')$$,'22023',NULL,'Same operation cannot change target');
SELECT throws_ok($$SELECT pg_temp.report(201,'request',101,'harassment','Test details')$$,'22023',NULL,'Same operation cannot change target type');
SELECT throws_ok($$SELECT * FROM safety_private.reports$$,'42501',NULL,'Authenticated actor cannot read reports even in private schema');
SELECT throws_ok($$DELETE FROM safety_private.reports$$,'42501',NULL,'Authenticated actor cannot delete report evidence');
RESET ROLE;

SELECT is((SELECT details FROM safety_private.reports WHERE reporter_id=pg_temp.uid(1) AND operation_id=pg_temp.uid(201)), 'Test details', 'Canonical details are stored without outer spaces');
SELECT is((SELECT evidence FROM safety_private.reports WHERE reporter_id=pg_temp.uid(1) AND operation_id=pg_temp.uid(201)), '{"display_name":"Safety Fixture Student"}'::jsonb, 'Student evidence contains only public display name');
SELECT is((SELECT evidence FROM safety_private.reports WHERE reporter_id=pg_temp.uid(1) AND operation_id=pg_temp.uid(202)),
  '{"title":"Report fixture 101","description":"A visible request description.","category":"delivery","points":5,"status":"open"}'::jsonb,
  'Request evidence contains only allowed base fields, excluding room and private request details');
SELECT is((SELECT reporter_id FROM safety_private.reports WHERE operation_id=pg_temp.uid(201)), pg_temp.uid(1), 'Reporter comes from verified JWT subject');
SELECT is((SELECT reported_profile_id FROM safety_private.reports WHERE operation_id=pg_temp.uid(202)), pg_temp.uid(2), 'Request reported owner comes from server lookup');
SELECT is((SELECT count(*) FROM safety_private.reports WHERE reporter_id=pg_temp.uid(1) AND operation_id=pg_temp.uid(201)), 1::bigint, 'Retries store one row');
SELECT is((SELECT count(*) FROM public.notifications), (SELECT notifications FROM before_side_effects), 'Report intake never notifies the reported person');
SELECT is((SELECT count(*) FROM public.points_ledger), (SELECT ledger FROM before_side_effects), 'Reporting does not create points transactions');
SELECT is((SELECT jsonb_agg(to_jsonb(w) ORDER BY w.profile_id) FROM public.points_wallets w), (SELECT wallets FROM before_side_effects), 'Reporting does not alter point balances');
SELECT is((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.requests r), (SELECT requests FROM before_side_effects), 'Reporting does not automatically change request status');

-- Snapshot and receipt survive source edits/visibility changes; new attempts do not bypass authorization.
UPDATE public.profiles SET display_name='Changed name',is_discoverable=false WHERE id=pg_temp.uid(2);
UPDATE public.requests SET title='Changed request',status='cancelled',cancelled_at=now() WHERE id=pg_temp.uid(101);
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT is(pg_temp.report(201,'student',2,'harassment','Test details'), (SELECT receipt FROM receipts WHERE name='student'), 'Exact retry survives target becoming hidden');
SELECT is(pg_temp.report(202,'request',101,'unsafe','Please review this request.'), (SELECT receipt FROM receipts WHERE name='request'), 'Exact retry survives request closing');
SELECT is(pg_temp.report_result(206,'student',2),'42501','New operation still rejects now-hidden profile');
SELECT is(pg_temp.report_result(206,'request',101),'42501','New operation still rejects now-closed request');
RESET ROLE;
SELECT is((SELECT evidence->>'display_name' FROM safety_private.reports WHERE operation_id=pg_temp.uid(201)), 'Safety Fixture Student', 'Profile evidence remains the submitted snapshot');
SELECT is((SELECT evidence->>'title' FROM safety_private.reports WHERE operation_id=pg_temp.uid(202)), 'Report fixture 101', 'Request evidence remains the submitted snapshot');

-- Rolling 24-hour quota is shared across both target types and reasons.
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(10);
SELECT lives_ok($$SELECT pg_temp.report(300+n::integer,'student',4,reason,'Quota fixture') FROM unnest(ARRAY['harassment','scam','unsafe','spam','other','harassment','scam','unsafe','spam']) WITH ORDINALITY AS r(reason,n)$$, 'First nine reports accept every supported reason');
INSERT INTO receipts VALUES ('quota',pg_temp.report(310,'request',108,'other','Tenth report'));
SELECT throws_ok($$SELECT pg_temp.report(311,'student',4,'spam')$$,'54000',NULL,'Eleventh new report in 24 hours is rejected');
SELECT is(pg_temp.report(310,'request',108,'other','Tenth report'), (SELECT receipt FROM receipts WHERE name='quota'), 'Exact retry still works at the quota');
SELECT throws_ok($$SELECT pg_temp.report(310,'request',108,'other','Changed')$$,'22023',NULL,'Quota does not weaken idempotency checks');
SELECT pg_temp.login(11);
SELECT lives_ok($$SELECT pg_temp.report(310,'student',4,'spam')$$,'Different reporter has an independent quota and operation-id namespace');
RESET ROLE;
UPDATE safety_private.reports SET created_at=clock_timestamp()-interval '25 hours' WHERE reporter_id=pg_temp.uid(10) AND operation_id=pg_temp.uid(301);
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(10);
SELECT lives_ok($$SELECT pg_temp.report(311,'student',4,'spam')$$,'A report outside the rolling 24-hour window frees one slot');
SELECT throws_ok($$SELECT pg_temp.report(312,'student',4,'spam')$$,'54000',NULL,'Freed slot cannot be used twice');
SELECT pg_temp.login(12);
SELECT lives_ok($$SELECT pg_temp.report(320,'student',11,'spam',repeat('😀',2000))$$,'Exactly 2,000 Unicode codepoints are accepted');
INSERT INTO receipts VALUES ('delete-target',pg_temp.report(321,'student',11,'spam',NULL));
SELECT is(pg_temp.report(321,'student',11,'spam',''), (SELECT receipt FROM receipts WHERE name='delete-target'), 'Null optional details canonicalize to empty text');
SELECT lives_ok($$SELECT pg_temp.report(322,'student',11,'other',repeat('😀',10))$$,'Exactly ten Unicode codepoints satisfy Other details minimum');
RESET ROLE;

-- Report FKs must never prevent deletion or cascade away evidence.
DELETE FROM public.requests WHERE id=pg_temp.uid(101);
SELECT is((SELECT request_id FROM safety_private.reports WHERE operation_id=pg_temp.uid(202)), NULL::uuid, 'Deleting request nulls its FK and retains evidence');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT is(pg_temp.report(202,'request',101,'unsafe','Please review this request.'), (SELECT receipt FROM receipts WHERE name='request'), 'Exact receipt retry works after request deletion');
RESET ROLE;
DELETE FROM auth.users WHERE id=pg_temp.uid(11);
SELECT is((SELECT reported_profile_id FROM safety_private.reports WHERE operation_id=pg_temp.uid(321)), NULL::uuid, 'Deleting target account nulls profile FK without deleting the report');
SELECT is((SELECT evidence->>'display_name' FROM safety_private.reports WHERE operation_id=pg_temp.uid(321)), 'Safety Fixture Student', 'Minimal submitted evidence survives target deletion');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(12);
SELECT is(pg_temp.report(321,'student',11,'spam',''), (SELECT receipt FROM receipts WHERE name='delete-target'), 'Exact receipt retry works after target account deletion');
RESET ROLE;
DELETE FROM auth.users WHERE id=pg_temp.uid(12);
SELECT is((SELECT reporter_id FROM safety_private.reports WHERE operation_id=pg_temp.uid(321)), NULL::uuid, 'Deleting reporter account nulls reporter FK without removing evidence');
SELECT is((SELECT count(*) FROM safety_private.reports WHERE operation_id=pg_temp.uid(321)), 1::bigint, 'Report survives both participant account deletions');

SELECT * FROM finish();
ROLLBACK;
