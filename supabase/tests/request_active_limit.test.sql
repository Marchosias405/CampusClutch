BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT no_plan();

INSERT INTO auth.users(id,email)
SELECT ('95959595-9595-4959-8959-'||lpad(i::text,12,'0'))::uuid,
 'active-limit-'||i||'@test.local' FROM generate_series(1,6) i;
CREATE FUNCTION pg_temp.uid(i integer) RETURNS uuid LANGUAGE sql AS $$
 SELECT ('95959595-9595-4959-8959-'||lpad(i::text,12,'0'))::uuid;
$$;
UPDATE public.profiles SET display_name='Active Limit Tester',major='Computing Science',year_of_study=2,
 campus_id=(SELECT id FROM public.campuses WHERE slug='burnaby')
WHERE id IN (SELECT pg_temp.uid(i) FROM generate_series(1,6) i);
CREATE FUNCTION pg_temp.login(i integer) RETURNS text LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub',pg_temp.uid(i)::text,true);
$$;
CREATE FUNCTION pg_temp.payload(category text DEFAULT 'delivery') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('category',category,'title','Active limit test','description','Please help with this request.',
 'campus_id',(SELECT id FROM public.campuses WHERE slug='burnaby'),'room_location','Library',
 'deadline_at','2099-01-01T00:00:00Z','points',10,'item_size','small','details',
 CASE category WHEN 'delivery' THEN '{"pickup_location":"Cafe","dropoff_location":"Library"}'::jsonb
 WHEN 'pickup' THEN '{"pickup_location":"Cafe","destination":"Library"}'::jsonb
 WHEN 'event_help' THEN '{"event_name":"Welcome","help_needed":"Set chairs"}'::jsonb
 WHEN 'study_help' THEN '{"course_or_subject":"CMPT 120","topic":"Loops"}'::jsonb END);
$$;
CREATE TEMP TABLE fixtures(name text PRIMARY KEY,id uuid);
GRANT ALL ON fixtures TO authenticated;
CREATE FUNCTION pg_temp.fixture(p_name text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM fixtures WHERE name=p_name; $$;
CREATE FUNCTION pg_temp.active_count(i integer) RETURNS bigint LANGUAGE sql AS $$
 SELECT count(*) FROM public.requests WHERE owner_id=pg_temp.uid(i)
 AND (status='accepted' OR (status='open' AND deadline_at>clock_timestamp()));
$$;
CREATE FUNCTION pg_temp.limit_message() RETURNS text LANGUAGE sql AS $$
 SELECT 'You can have at most 3 active requests. Complete or cancel an active request before posting another.'::text;
$$;

SELECT ok(NOT (SELECT prosecdef FROM pg_proc WHERE oid='request_private.enforce_active_request_limit()'::regprocedure),
 'Active limit trigger uses invoker privileges');
SELECT ok(EXISTS(SELECT 1 FROM pg_proc p,unnest(p.proconfig) c
 WHERE p.oid='request_private.enforce_active_request_limit()'::regprocedure AND c LIKE 'search_path=%'),
 'Active limit trigger fixes its search path');
SELECT ok(NOT has_function_privilege('anon','request_private.enforce_active_request_limit()','EXECUTE')
 AND NOT has_function_privilege('authenticated','request_private.enforce_active_request_limit()','EXECUTE'),
 'Clients have no direct execution grant on the trigger');
SELECT ok(EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.requests'::regclass
 AND tgname='requests_active_limit_guard' AND tgenabled='O' AND NOT tgisinternal),
 'Active limit guard is enabled on requests');

SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT lives_ok($$INSERT INTO fixtures VALUES('first',public.save_my_request(pg_temp.payload()))$$,'First active request succeeds');
SELECT lives_ok($$INSERT INTO fixtures VALUES('second',public.save_my_request(pg_temp.payload('pickup')))$$,'Second active request succeeds');
SELECT lives_ok($$INSERT INTO fixtures VALUES('third',public.save_my_request(pg_temp.payload('event_help')))$$,'Third active request succeeds');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload('study_help'))$$,'P0004',pg_temp.limit_message(),
 'All four categories share one three-request cap');
SELECT is((SELECT count(*) FROM public.requests WHERE owner_id=pg_temp.uid(1)),3::bigint,'Rejected fourth post leaves no parent');
SELECT is((SELECT count(*) FROM (
 SELECT request_id FROM public.delivery_request_details UNION ALL SELECT request_id FROM public.pickup_request_details
 UNION ALL SELECT request_id FROM public.event_help_request_details UNION ALL SELECT request_id FROM public.study_help_request_details
 ) d JOIN public.requests r ON r.id=d.request_id WHERE r.owner_id=pg_temp.uid(1)),3::bigint,
 'Rejected fourth post leaves exactly the original category details');
SELECT lives_ok($$SELECT public.save_my_request(pg_temp.payload()||'{"title":"Edited at the cap"}',pg_temp.fixture('first'))$$,
 'Existing active request remains editable at the cap');
SELECT is((SELECT title FROM public.requests WHERE id=pg_temp.fixture('first')),'Edited at the cap','The edit is persisted');

SELECT pg_temp.login(2);
INSERT INTO fixtures SELECT 'other-'||i,public.save_my_request(pg_temp.payload()) FROM generate_series(1,3) i;
SELECT is(pg_temp.active_count(2),3::bigint,'Another account has an independent three-request allowance');
SELECT lives_ok($$INSERT INTO fixtures VALUES('first-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('first'),1,10))$$,
 'A helper at their own posting cap can still offer on someone else''s request');
SELECT is(pg_temp.active_count(2),3::bigint,'Offering help does not consume another posting slot');
SELECT pg_temp.login(1);
SELECT lives_ok($$SELECT public.decide_request_offer_for_round(pg_temp.fixture('first-offer'),'accepted',1,10)$$,
 'Acceptance keeps the existing active slot at the cap');
RESET ROLE;
UPDATE public.requests SET deadline_at=clock_timestamp()-interval '1 second' WHERE id=pg_temp.fixture('first');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT is(pg_temp.active_count(1),3::bigint,'Accepted work still occupies a slot after its deadline');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload())$$,'P0004',pg_temp.limit_message(),'Past-deadline accepted work prevents a fourth post');
SELECT lives_ok($$SELECT public.reopen_my_request(pg_temp.fixture('first'),1,'2099-02-01T00:00:00Z')$$,
 'Reopening accepted work reuses its slot');
SELECT is(pg_temp.active_count(1),3::bigint,'Accepted-to-open reopening preserves the active total');
SELECT pg_temp.login(3);
INSERT INTO fixtures VALUES('fresh-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('first'),2,10));
SELECT pg_temp.login(1);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('fresh-offer'),'accepted',2,10);
SELECT public.complete_my_request(pg_temp.fixture('first'),2);
SELECT lives_ok($$INSERT INTO fixtures VALUES('after-complete',public.save_my_request(pg_temp.payload('study_help')))$$,
 'Completion releases one slot');
SELECT public.cancel_my_request(pg_temp.fixture('second'));
SELECT lives_ok($$INSERT INTO fixtures VALUES('after-cancel',public.save_my_request(pg_temp.payload('pickup')))$$,
 'Cancellation releases one slot');
RESET ROLE;
UPDATE public.requests SET deadline_at=clock_timestamp()-interval '1 second' WHERE id=pg_temp.fixture('third');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT lives_ok($$INSERT INTO fixtures VALUES('after-expiry',public.save_my_request(pg_temp.payload('event_help')))$$,
 'Elapsed open deadline releases a slot before lazy expiry changes status');
SELECT is((SELECT status FROM public.requests WHERE id=pg_temp.fixture('third')),'open','Expiry counting does not rewrite historical records');
SELECT is(pg_temp.active_count(1),3::bigint,'Completed, cancelled, and elapsed open requests consume no slots');

-- Check reactivation and ownership transfer at the storage boundary as a trusted
-- writer. Clients cannot perform these updates directly (asserted below).
RESET ROLE;
SELECT throws_ok($$UPDATE public.requests SET deadline_at='2099-01-01T00:00:00Z' WHERE id=pg_temp.fixture('third')$$,
 'P0004',pg_temp.limit_message(),'Extending an elapsed open request cannot revive a fourth active request');
SELECT throws_ok($$UPDATE public.requests SET status='accepted',accepted_at=clock_timestamp() WHERE id=pg_temp.fixture('third')$$,
 'P0004',pg_temp.limit_message(),'Accepting an elapsed open request cannot revive a fourth active request');
UPDATE public.requests SET status='expired' WHERE id=pg_temp.fixture('third');
SELECT throws_ok($$UPDATE public.requests SET status='open',deadline_at='2099-01-01T00:00:00Z' WHERE id=pg_temp.fixture('third')$$,
 'P0004',pg_temp.limit_message(),'Terminal-to-active transitions also enforce the cap');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(6);
INSERT INTO fixtures VALUES('transfer',public.save_my_request(pg_temp.payload()));
RESET ROLE;
SELECT throws_ok($$UPDATE public.requests SET owner_id=pg_temp.uid(1) WHERE id=pg_temp.fixture('transfer')$$,
 'P0004',pg_temp.limit_message(),'Changing owner cannot bypass the destination account cap');
SELECT is((SELECT owner_id FROM public.requests WHERE id=pg_temp.fixture('transfer')),pg_temp.uid(6),'Rejected ownership transfer preserves its owner');

-- Fail after the parent INSERT: a details constraint error must roll back both
-- the request and its slot, not merely reject malformed payloads before INSERT.
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(5);
INSERT INTO fixtures SELECT 'rollback-'||i,public.save_my_request(pg_temp.payload()) FROM generate_series(1,2) i;
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload()||'{"details":{"pickup_location":"   ","dropoff_location":"Library"}}')$$,
 '23514',NULL,'A category detail failure rolls back a partially saved request');
SELECT is((SELECT count(*) FROM public.requests WHERE owner_id=pg_temp.uid(5)),2::bigint,'Failed detail save leaves no parent request');
SELECT lives_ok($$INSERT INTO fixtures VALUES('rollback-third',public.save_my_request(pg_temp.payload()))$$,
 'Failed detail save does not consume the last slot');
SELECT is((SELECT count(*) FROM public.delivery_request_details d JOIN public.requests r ON r.id=d.request_id WHERE r.owner_id=pg_temp.uid(5)),
 3::bigint,'Each successful request has exactly one detail row');

-- Only grandfather fixture insertion bypasses the new guard. Every assertion
-- below runs after re-enabling it; no production rows or other guards change.
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
ALTER TABLE public.requests DISABLE TRIGGER requests_active_limit_guard;
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(4);
INSERT INTO fixtures SELECT 'legacy-'||i,public.save_my_request(pg_temp.payload()) FROM generate_series(1,4) i;
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
ALTER TABLE public.requests ENABLE TRIGGER requests_active_limit_guard;
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(4);
SELECT is(pg_temp.active_count(4),4::bigint,'Legacy accounts above three retain all existing active requests');
SELECT lives_ok($$SELECT public.save_my_request(pg_temp.payload()||'{"title":"Legacy request edited"}',pg_temp.fixture('legacy-1'))$$,
 'Legacy active requests can still be edited above the cap');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload())$$,'P0004',pg_temp.limit_message(),'Legacy account cannot add another active request');
SELECT pg_temp.login(3);
INSERT INTO fixtures VALUES('legacy-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('legacy-1'),1,10));
SELECT pg_temp.login(4);
SELECT lives_ok($$SELECT public.decide_request_offer_for_round(pg_temp.fixture('legacy-offer'),'accepted',1,10)$$,
 'Legacy work can be accepted above the cap');
SELECT lives_ok($$SELECT public.reopen_my_request(pg_temp.fixture('legacy-1'),1,'2099-02-01T00:00:00Z')$$,
 'Legacy accepted work can reopen without adding a slot');
SELECT lives_ok($$SELECT public.cancel_my_request(pg_temp.fixture('legacy-2'))$$,'Legacy work can be closed above the cap');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload())$$,'P0004',pg_temp.limit_message(),'Closing from four to three still leaves no free slot');
SELECT public.cancel_my_request(pg_temp.fixture('legacy-3'));
SELECT lives_ok($$SELECT public.save_my_request(pg_temp.payload())$$,'Legacy account can post once fewer than three active requests remain');
SELECT is((SELECT count(*) FROM public.requests WHERE owner_id=pg_temp.uid(4)),5::bigint,'Legacy history is retained when closing and posting');

SELECT pg_temp.login(1);
SELECT throws_ok($$INSERT INTO public.requests(owner_id,category,title,description,campus_id,room_location,deadline_at,points,item_size)
 VALUES(pg_temp.uid(1),'delivery','Direct post','Bypass attempt request',(SELECT id FROM public.campuses WHERE slug='burnaby'),'Library','2099-01-01',10,'small')$$,
 '42501',NULL,'Authenticated clients cannot bypass the RPC with a direct insert');
SELECT throws_ok($$UPDATE public.requests SET status='open',deadline_at='2099-01-01' WHERE id=pg_temp.fixture('third')$$,
 '42501',NULL,'Authenticated clients cannot bypass the RPC with direct reactivation');
SELECT throws_ok($$SELECT request_private.enforce_active_request_limit()$$,'42501',NULL,'Authenticated clients cannot execute the trigger directly');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload())$$,'42501',NULL,'Unauthenticated posting is still rejected');
SELECT * FROM finish();
ROLLBACK;
