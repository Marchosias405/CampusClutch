BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT no_plan();

-- No real staff grants or report decisions survive this transaction.
CREATE FUNCTION pg_temp.uid(i integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('c04afe00-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
$$;
CREATE FUNCTION pg_temp.login(i integer) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub',pg_temp.uid(i)::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(i),
    'role','authenticated','session_id',pg_temp.uid(100+i),'user_metadata',jsonb_build_object('role','admin'))::text,true);
END;
$$;
CREATE FUNCTION pg_temp.access_for(i integer) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.login(i);
  RETURN public.get_my_moderation_access();
END;
$$;
CREATE TEMP TABLE results(name text PRIMARY KEY,value jsonb);
GRANT ALL ON results TO authenticated;
INSERT INTO auth.users(id,email,email_confirmed_at)
SELECT pg_temp.uid(n),'moderation-'||n||'@tests.local',now() FROM generate_series(1,12) n;
UPDATE public.profiles SET display_name='Moderation fixture',onboarding_completed_at=now(),is_discoverable=true
WHERE id IN (SELECT pg_temp.uid(n) FROM generate_series(1,12) n);
INSERT INTO auth.sessions(id,user_id,created_at,updated_at)
SELECT pg_temp.uid(n+100),pg_temp.uid(n),now(),now() FROM generate_series(1,12) n;
SELECT safety_private.assign_staff_role(pg_temp.uid(n),CASE WHEN n=4 THEN 'admin' ELSE 'moderator' END,n<>6,'Local rollback-only fixture')
FROM generate_series(3,12) n;
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=pg_temp.uid(7);
UPDATE auth.users SET is_anonymous=true WHERE id=pg_temp.uid(8);
UPDATE auth.users SET deleted_at=now() WHERE id=pg_temp.uid(9);
UPDATE public.profiles SET display_name=NULL,onboarding_completed_at=NULL WHERE id=pg_temp.uid(10);
UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id=pg_temp.uid(111);
DELETE FROM auth.sessions WHERE id=pg_temp.uid(112);
UPDATE auth.users SET raw_user_meta_data='{"role":"admin","is_admin":true}' WHERE id=pg_temp.uid(1);

-- Controlled future timestamps isolate pagination from any existing local data.
INSERT INTO safety_private.reports(id,reporter_id,reported_profile_id,operation_id,target_type,reason,details,payload_hash,evidence,created_at)
SELECT pg_temp.uid(1000+n),pg_temp.uid(1),pg_temp.uid(2),pg_temp.uid(2000+n),
  (ARRAY['student','request','message','course_review'])[1+(n%4)],'spam','Private fixture context',
  digest(n::text,'sha256'),'{"body":"Only the submitted snapshot"}', '2090-01-01'::timestamptz
FROM generate_series(1,45) n;
INSERT INTO safety_private.reports(id,reporter_id,reported_profile_id,operation_id,target_type,reason,details,payload_hash,evidence,created_at)
VALUES(pg_temp.uid(1100),pg_temp.uid(3),pg_temp.uid(2),pg_temp.uid(2100),'student','spam','',digest('self','sha256'),'{}','2091-01-01'),
      (pg_temp.uid(1101),pg_temp.uid(1),pg_temp.uid(3),pg_temp.uid(2101),'student','spam','',digest('target','sha256'),'{}','2091-01-01');
CREATE TEMP TABLE effects AS SELECT
 (SELECT jsonb_agg(to_jsonb(w) ORDER BY profile_id) FROM public.points_wallets w) wallets,
 (SELECT count(*) FROM public.points_ledger) ledger,
 (SELECT count(*) FROM public.notifications) notifications,
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.requests r) requests,
 (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.messages m) messages,
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM course_reviews_private.reviews r) reviews;

SELECT ok(c.relrowsecurity,c.relname||' has RLS') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='safety_private' AND c.relname IN ('staff_roles','staff_role_events','report_decisions','report_views');
SELECT ok(NOT has_table_privilege(r,'safety_private.'||t,'SELECT,INSERT,UPDATE,DELETE'),r||' cannot access '||t)
FROM unnest(ARRAY['anon','authenticated','service_role']) r CROSS JOIN unnest(ARRAY['staff_roles','staff_role_events','report_decisions','report_views']) t;
SELECT ok(NOT has_function_privilege(r,'safety_private.assign_staff_role(uuid,text,boolean,text)','EXECUTE'),r||' cannot assign staff roles')
FROM unnest(ARRAY['anon','authenticated','service_role']) r;
SELECT ok(NOT has_function_privilege(r,'safety_private.require_staff()','EXECUTE'),r||' cannot call internal guard')
FROM unnest(ARRAY['anon','authenticated','service_role']) r;
SELECT ok(NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=""'],p.proname||' is fixed-path invoker') FROM pg_proc p
WHERE p.oid IN ('public.get_my_moderation_access()'::regprocedure,'public.list_moderation_reports(text,timestamptz,uuid)'::regprocedure,
'public.get_moderation_report(uuid)'::regprocedure,'public.record_moderation_decision(uuid,uuid,integer,text,text)'::regprocedure);
SELECT ok(NOT has_function_privilege(r,f,'EXECUTE'),r||' denied '||f)
FROM unnest(ARRAY['anon','service_role']) r CROSS JOIN unnest(ARRAY['public.get_my_moderation_access()',
 'public.list_moderation_reports(text,timestamptz,uuid)','public.get_moderation_report(uuid)',
 'public.record_moderation_decision(uuid,uuid,integer,text,text)']) f;
SELECT ok(p.prosecdef AND p.proconfig @> ARRAY['search_path=""'],p.proname||' is fixed-path definer')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='safety_private'
AND p.proname IN ('require_staff','moderation_access','moderation_queue','moderation_detail','moderation_decide');
SELECT is((SELECT count(*) FROM safety_private.staff_role_events WHERE profile_id=pg_temp.uid(3)),1::bigint,'Provisioning is audited');
SELECT throws_ok($$SELECT safety_private.assign_staff_role(pg_temp.uid(1),'superuser',true,'A valid fixture reason')$$,'22023',NULL,'Unknown role is denied');
SELECT throws_ok($$SELECT safety_private.assign_staff_role(pg_temp.uid(1),'admin',true,'short')$$,'22023',NULL,'Provisioning needs a reason');

SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT is(public.get_my_moderation_access(),' {"role":null}'::jsonb,'Student metadata and JWT role claims grant no staff access');
SELECT throws_ok($$SELECT public.list_moderation_reports()$$,'42501',NULL,'Student cannot enumerate reports');
SELECT throws_ok($$SELECT public.get_moderation_report(pg_temp.uid(1001))$$,'42501',NULL,'Reporter cannot read private review evidence');
SELECT throws_ok($$SELECT public.record_moderation_decision(pg_temp.uid(1001),pg_temp.uid(3001),0,'dismissed','A valid fixture note')$$,'42501',NULL,'Student cannot decide');
SELECT throws_ok($$SELECT safety_private.assign_staff_role(pg_temp.uid(1),'admin',true,'A valid fixture reason')$$,'42501',NULL,'Student cannot self-promote');
SELECT pg_temp.login(2);
SELECT throws_ok($$SELECT public.get_moderation_report(pg_temp.uid(1001))$$,'42501',NULL,'Reported student cannot read evidence');
SELECT is(pg_temp.access_for(n),'{"role":null}'::jsonb,'Ineligible staff blocked: '||n) FROM generate_series(6,12) n;

SELECT pg_temp.login(3);
SELECT is(public.get_my_moderation_access(),'{"role":"moderator"}'::jsonb,'Enabled moderator can access triage');
INSERT INTO results VALUES('page1',public.list_moderation_reports());
SELECT is(jsonb_array_length((SELECT value FROM results WHERE name='page1')),20,'Queue has bounded page size');
SELECT is((SELECT value->0->>'report_id' FROM results WHERE name='page1'),pg_temp.uid(1045)::text,'Equal timestamps sort by report ID');
SELECT is((SELECT value->19->>'report_id' FROM results WHERE name='page1'),pg_temp.uid(1026)::text,'First page ends at correct boundary');
SELECT ok(NOT ((SELECT value->0 FROM results WHERE name='page1') ?| ARRAY['details','evidence','reporter_id','reported_profile_id']),'Queue excludes private evidence and account IDs');
INSERT INTO results VALUES('page2',public.list_moderation_reports('new','2090-01-01',pg_temp.uid(1026)));
SELECT is((SELECT value->0->>'report_id' FROM results WHERE name='page2'),pg_temp.uid(1025)::text,'Cursor starts after previous page');
SELECT is((SELECT value->19->>'report_id' FROM results WHERE name='page2'),pg_temp.uid(1006)::text,'Second page ends correctly');
SELECT throws_ok($$SELECT public.list_moderation_reports('unknown')$$,'22023',NULL,'Invalid queue status rejected');
SELECT throws_ok($$SELECT public.list_moderation_reports('new',now(),NULL)$$,'22023',NULL,'Incomplete cursor rejected');
SELECT throws_ok($$SELECT public.get_moderation_report(pg_temp.uid(1100))$$,'42501',NULL,'Staff cannot review own submitted report');
SELECT throws_ok($$SELECT public.get_moderation_report(pg_temp.uid(1101))$$,'42501',NULL,'Staff cannot review a report about themselves');
SELECT throws_ok($$SELECT public.get_moderation_report(pg_temp.uid(9999))$$,'42501',NULL,'Missing case gets same unavailable error');
SELECT throws_ok($$SELECT public.record_moderation_decision(pg_temp.uid(1101),pg_temp.uid(3001),0,'dismissed','A valid fixture note')$$,'42501',NULL,'Conflict also prevents decisions');
INSERT INTO results VALUES('detail',public.get_moderation_report(pg_temp.uid(1001)));
SELECT is((SELECT value->'evidence' FROM results WHERE name='detail'),'{"body":"Only the submitted snapshot"}'::jsonb,'Authorized evidence comes from retained snapshot');
SELECT ok(NOT ((SELECT value FROM results WHERE name='detail') ?| ARRAY['reporter_id','reported_profile_id','email','moderator_id']),'Detail excludes account identifiers');
SELECT is((SELECT value->'history' FROM results WHERE name='detail'),'[]'::jsonb,'Fresh case has no decisions');
RESET ROLE;
SELECT is((SELECT count(*) FROM safety_private.report_views WHERE report_id=pg_temp.uid(1001)),1::bigint,'Evidence read is audited');
SELECT is((SELECT count(*) FROM safety_private.report_views WHERE report_id IN (pg_temp.uid(1100),pg_temp.uid(1101))),0::bigint,'Denied evidence reads leave no successful-read events');

SET LOCAL ROLE authenticated;
SELECT pg_temp.login(4);
SELECT is(public.get_my_moderation_access(),'{"role":"admin"}'::jsonb,'Admin uses the same explicit triage API');
INSERT INTO results VALUES('first',public.record_moderation_decision(pg_temp.uid(1001),pg_temp.uid(3001),0,'reviewing','Checking the submitted evidence.'));
SELECT is((SELECT value->>'triage_version' FROM results WHERE name='first'),'1','First decision increments version');
SELECT is(public.record_moderation_decision(pg_temp.uid(1001),pg_temp.uid(3001),0,'reviewing','Checking the submitted evidence.'),
 (SELECT value FROM results WHERE name='first'),'Exact retry returns original decision');
SELECT throws_ok($$SELECT public.record_moderation_decision(pg_temp.uid(1001),pg_temp.uid(3001),0,'dismissed','Different submitted decision.')$$,'22023',NULL,'Operation ID cannot be reused for another payload');
SELECT pg_temp.login(5);
SELECT throws_ok($$SELECT public.record_moderation_decision(pg_temp.uid(1001),pg_temp.uid(3002),0,'dismissed','A stale decision must fail.')$$,'PT409',NULL,'Stale version cannot overwrite another moderator');
SELECT throws_ok($$SELECT public.record_moderation_decision(pg_temp.uid(1001),pg_temp.uid(3002),1,'reviewing','An unchanged status must fail.')$$,'22023',NULL,'No-op decisions are rejected');
SELECT throws_ok($$SELECT public.record_moderation_decision(pg_temp.uid(1001),pg_temp.uid(3002),1,'escalated','short')$$,'22023',NULL,'Decision needs an explanatory note');
SELECT throws_ok($$SELECT public.record_moderation_decision(pg_temp.uid(1001),pg_temp.uid(3002),1,'banned','No automatic enforcement.')$$,'22023',NULL,'Enforcement is not a triage state');
SELECT throws_ok($$SELECT public.record_moderation_decision(pg_temp.uid(1001),pg_temp.uid(3002),1,'escalated',repeat('x',2001))$$,'22023',NULL,'Oversized note rejected');
INSERT INTO results VALUES('second',public.record_moderation_decision(pg_temp.uid(1001),pg_temp.uid(3002),1,'escalated','Requires follow-up by the team.'));
SELECT is((SELECT value->>'triage_version' FROM results WHERE name='second'),'2','Second moderator can record current-version decision');
SELECT is(jsonb_array_length(public.get_moderation_report(pg_temp.uid(1001))->'history'),2,'History includes both decisions');
SELECT is(public.get_moderation_report(pg_temp.uid(1001))->'history'->0->'is_mine','false'::jsonb,'Other moderator is not identified');
SELECT is(public.get_moderation_report(pg_temp.uid(1001))->'history'->1->'is_mine','true'::jsonb,'Own decision identified without raw IDs');
SELECT pg_temp.login(4);
SELECT is(public.record_moderation_decision(pg_temp.uid(1001),pg_temp.uid(3001),0,'reviewing','Checking the submitted evidence.'),
 (SELECT value FROM results WHERE name='first'),'Retry after a later decision returns old receipt without reverting state');
RESET ROLE;
SELECT is((SELECT triage_status FROM safety_private.reports WHERE id=pg_temp.uid(1001)),'escalated','Later state is retained');
SELECT is((SELECT count(*) FROM safety_private.report_decisions WHERE report_id=pg_temp.uid(1001)),2::bigint,'Retries create no extra audit entries');
SELECT safety_private.assign_staff_role(pg_temp.uid(4),'admin',false,'Immediate access revocation fixture');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.record_moderation_decision(pg_temp.uid(1001),pg_temp.uid(3001),0,'reviewing','Checking the submitted evidence.')$$,'42501',NULL,'Revocation denies even exact historical retries');
SELECT is(public.get_my_moderation_access(),'{"role":null}'::jsonb,'Revocation takes effect without token refresh');
SELECT pg_temp.login(5);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(5),'session_id',pg_temp.uid(103))::text,true);
SELECT is(public.get_my_moderation_access(),'{"role":null}'::jsonb,'Another users session cannot authorize staff');
SELECT pg_temp.login(5);
RESET ROLE;
DELETE FROM auth.sessions WHERE id=pg_temp.uid(105);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.list_moderation_reports()$$,'42501',NULL,'Deleted session is denied with still-valid claims');
RESET ROLE;

-- Account erasure does not erase the recorded decision or submitted evidence.
SELECT is((SELECT count(*) FROM public.points_ledger),(SELECT ledger FROM effects),'Triage creates no points ledger entries');
SELECT is((SELECT jsonb_agg(to_jsonb(w) ORDER BY profile_id) FROM public.points_wallets w),(SELECT wallets FROM effects),'Triage leaves balances unchanged');
DELETE FROM auth.users WHERE id=pg_temp.uid(4);
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(3);
SELECT is(public.get_moderation_report(pg_temp.uid(1001))->'history'->0->'is_mine','false'::jsonb,'Deleted moderator has a boolean own-marker');
SELECT is(jsonb_array_length(public.get_moderation_report(pg_temp.uid(1001))->'history'),2,'Audit survives moderator deletion');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.notifications),(SELECT notifications FROM effects),'Triage creates no notifications');
-- Compare unaffected content exactly; deleted staff was never a content owner.
SELECT is((SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.requests r),(SELECT requests FROM effects),'Requests unchanged');
SELECT is((SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.messages m),(SELECT messages FROM effects),'Messages unchanged');
SELECT is((SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM course_reviews_private.reviews r),(SELECT reviews FROM effects),'Course reviews unchanged');
SELECT * FROM finish();
ROLLBACK;
