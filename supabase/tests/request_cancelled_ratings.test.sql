BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT no_plan();

-- All fixtures, injected failures, wallet events and ratings roll back at EOF.
INSERT INTO auth.users(id,email)
SELECT ('98989898-9898-4989-8989-'||lpad(i::text,12,'0'))::uuid,
 'cancelled-ratings-'||i||'@test.local' FROM generate_series(1,8) i;
CREATE FUNCTION pg_temp.uid(i integer) RETURNS uuid LANGUAGE sql AS $$
 SELECT ('98989898-9898-4989-8989-'||lpad(i::text,12,'0'))::uuid;
$$;
UPDATE public.profiles SET display_name='Cancelled Ratings Tester',major='Computing Science',year_of_study=2,
 campus_id=(SELECT id FROM public.campuses WHERE slug='burnaby'),is_discoverable=false,
 onboarding_completed_at=clock_timestamp()
WHERE id IN (SELECT pg_temp.uid(i) FROM generate_series(1,8) i);
CREATE FUNCTION pg_temp.login(i integer) RETURNS text LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub',pg_temp.uid(i)::text,true);
$$;
CREATE FUNCTION pg_temp.payload(points integer DEFAULT 10) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('category','delivery','title','Cancelled assignment rating test',
 'description','Please help with this request.',
 'campus_id',(SELECT id FROM public.campuses WHERE slug='burnaby'),'room_location','Library',
 'deadline_at','2099-01-01T00:00:00Z','points',points,'item_size','small',
 'details','{"pickup_location":"Cafe","dropoff_location":"Library"}'::jsonb);
$$;
CREATE TEMP TABLE fixtures(name text PRIMARY KEY,id uuid);
CREATE TEMP TABLE financial_snapshot(wallets jsonb,ledger jsonb);
GRANT ALL ON fixtures TO authenticated;
CREATE FUNCTION pg_temp.fixture(p_name text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM fixtures WHERE name=p_name; $$;
CREATE FUNCTION pg_temp.context(p_name text,p_round integer) RETURNS jsonb LANGUAGE sql AS $$
 SELECT c FROM public.get_my_request_rating_contexts(pg_temp.fixture(p_name)) c WHERE (c->>'offer_round')::integer=p_round;
$$;

SELECT ok(NOT has_function_privilege('anon','public.cancel_my_accepted_help(uuid,integer)','EXECUTE'),'Anonymous clients cannot cancel an accepted assignment');
SELECT ok(NOT has_function_privilege('anon','public.get_my_request_rating_contexts(uuid,integer,integer)','EXECUTE'),'Anonymous clients cannot list rating relationships');
SELECT ok(has_function_privilege('authenticated','public.cancel_my_accepted_help(uuid,integer)','EXECUTE'),'Signed-in helpers can call cancellation');
SELECT ok(has_function_privilege('authenticated','public.get_my_request_rating_contexts(uuid,integer,integer)','EXECUTE'),'Signed-in participants can list their rating contexts');

SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
INSERT INTO fixtures VALUES('main',public.save_my_request(pg_temp.payload(30))),('side',public.save_my_request(pg_temp.payload(20)));
SELECT pg_temp.login(2);
INSERT INTO fixtures VALUES('main-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('main'),1,30));
SELECT pg_temp.login(3);
INSERT INTO fixtures VALUES('other-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('main'),1,30)),
 ('side-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('side'),1,20));
SELECT pg_temp.login(1);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('main-offer'),'accepted',1,30);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('side-offer'),'accepted',1,20);
SELECT is((SELECT count(*) FROM public.get_my_request_rating_contexts(pg_temp.fixture('main'))),0::bigint,'Active accepted assignment has no premature rating context');
SELECT throws_ok($$SELECT public.cancel_my_accepted_help(pg_temp.fixture('main'),1)$$,'42501',NULL,'Poster cannot impersonate an accepted helper cancellation');
SELECT pg_temp.login(3);
SELECT throws_ok($$SELECT public.cancel_my_accepted_help(pg_temp.fixture('main'),1)$$,'42501',NULL,'Unselected helper cannot cancel the assignment');
SELECT pg_temp.login(4);
SELECT throws_ok($$SELECT public.cancel_my_accepted_help(pg_temp.fixture('main'),1)$$,'42501',NULL,'Unrelated user cannot cancel the assignment');
SELECT pg_temp.login(2);
SELECT throws_ok($$SELECT public.cancel_my_accepted_help(pg_temp.fixture('main'),NULL)$$,'22023',NULL,'Cancellation requires the reviewed round');
SELECT throws_ok($$SELECT public.cancel_my_accepted_help(pg_temp.fixture('main'),0)$$,'22023',NULL,'Cancellation rejects a nonpositive round');
SELECT throws_ok($$SELECT public.cancel_my_accepted_help(pg_temp.fixture('main'),2)$$,'42501',NULL,'Helper cannot cancel a future round they have never been assigned');
SELECT throws_ok($$SELECT public.submit_request_rating(pg_temp.fixture('main'),1,5)$$,'22023',NULL,'Active accepted work cannot be rated');

-- Fail after touching the hold: every part of cancellation must roll back.
RESET ROLE;
CREATE FUNCTION pg_temp.fail_helper_cancel_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.offer_id=pg_temp.fixture('main-offer') AND NEW.status='withdrawn' THEN
  RAISE EXCEPTION 'test helper cancellation history failure' USING errcode='P0001';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER test_helper_cancel_history BEFORE INSERT ON public.request_offer_history
 FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_helper_cancel_history();
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(2);
SELECT throws_ok($$SELECT public.cancel_my_accepted_help(pg_temp.fixture('main'),1)$$,'P0001','test helper cancellation history failure','Audit failure rolls back helper cancellation');
SELECT ok((SELECT status='accepted' AND offer_round=1 AND accepted_at IS NOT NULL FROM public.requests WHERE id=pg_temp.fixture('main')),'Failed cancellation preserves accepted request and round');
SELECT is((SELECT status FROM public.request_offers WHERE id=pg_temp.fixture('main-offer')),'accepted','Failed cancellation preserves selected offer');
SELECT is((SELECT status FROM public.request_point_reservations WHERE request_id=pg_temp.fixture('main')),'reserved','Failed cancellation preserves reservation');
SELECT is((SELECT count(*) FROM public.get_my_request_rating_contexts(pg_temp.fixture('main'))),0::bigint,'Failed cancellation does not make the active assignment rateable');
RESET ROLE;
SELECT is((SELECT reserved::integer FROM public.points_wallets WHERE profile_id=pg_temp.uid(1)),50,'Failed cancellation restores all held points');
SELECT ok((SELECT helper_cancelled_at IS NULL FROM public.request_point_reservations WHERE request_id=pg_temp.fixture('main')),'Failed cancellation leaves no false retry marker');
DROP TRIGGER test_helper_cancel_history ON public.request_offer_history;
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(2);
SELECT is(public.cancel_my_accepted_help(pg_temp.fixture('main'),1),pg_temp.fixture('main'),'Accepted helper can cancel their assignment');
SELECT ok((SELECT status='open' AND offer_round=2 AND accepted_at IS NULL FROM public.requests WHERE id=pg_temp.fixture('main')),'Helper cancellation reopens the request in a fresh offer round');
SELECT is((SELECT deadline_at FROM public.requests WHERE id=pg_temp.fixture('main')),'2099-01-01T00:00:00Z'::timestamptz,'Helper cancellation preserves the owner deadline');
SELECT is((SELECT status FROM public.request_offers WHERE id=pg_temp.fixture('main-offer')),'withdrawn','Selected offer records helper withdrawal');
SELECT ok((SELECT status='released' AND helper_cancelled_at IS NOT NULL AND released_at IS NOT NULL FROM public.request_point_reservations WHERE request_id=pg_temp.fixture('main') AND offer_round=1),'Cancelled assignment retains its released reservation and retry marker');
SELECT is((SELECT count(*) FROM public.request_offer_history WHERE offer_id=pg_temp.fixture('main-offer') AND status='withdrawn'),1::bigint,'Cancellation records one withdrawal event');
SELECT is(public.cancel_my_accepted_help(pg_temp.fixture('main'),1),pg_temp.fixture('main'),'Exact helper cancellation retry is idempotent');
SELECT is((SELECT count(*) FROM public.request_offer_history WHERE offer_id=pg_temp.fixture('main-offer') AND status='withdrawn'),1::bigint,'Exact retry records no duplicate event');
SELECT ok(public.get_request_rating_context(pg_temp.fixture('main')) IS NULL,'Compatibility context does not label an old assignment as the open current round');
SELECT is(pg_temp.context('main',1)->>'outcome','cancelled','Historical helper context identifies cancelled outcome');
SELECT is(pg_temp.context('main',1)->>'counterparty_id',pg_temp.uid(1)::text,'Helper can only rate their original poster');
SELECT is((public.get_my_points()->>'balance')::integer,100,'Helper cancellation awards no points');
SELECT pg_temp.login(1);
SELECT is((public.get_my_points()->>'balance')::integer,100,'Helper cancellation does not debit poster balance');
SELECT is((public.get_my_points()->>'reserved')::integer,20,'Cancellation releases only its own hold');
SELECT is((SELECT status FROM public.request_point_reservations WHERE request_id=pg_temp.fixture('side')),'reserved','Unrelated accepted assignment remains funded');
SELECT is(pg_temp.context('main',1)->>'counterparty_id',pg_temp.uid(2)::text,'Poster context preserves the cancelled helper');
SELECT pg_temp.login(3);
SELECT is((SELECT count(*) FROM public.get_my_request_rating_contexts(pg_temp.fixture('main'))),0::bigint,'Unselected helper cannot see another assignment rating context');
SELECT throws_ok($$SELECT public.submit_request_rating(pg_temp.fixture('main'),1,5)$$,'42501',NULL,'Unselected helper cannot rate cancelled accepted work');

-- Cancelled ratings remain blind, immutable and financially inert.
RESET ROLE;
INSERT INTO financial_snapshot SELECT
 (SELECT jsonb_agg(to_jsonb(w) ORDER BY profile_id) FROM public.points_wallets w WHERE profile_id IN (SELECT pg_temp.uid(i) FROM generate_series(1,8) i)),
 (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.points_ledger l WHERE profile_id IN (SELECT pg_temp.uid(i) FROM generate_series(1,8) i));
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT is(public.submit_request_rating(pg_temp.fixture('main'),1,2),pg_temp.fixture('main'),'Poster can rate the cancelled historical assignment');
SELECT is((pg_temp.context('main',1)->>'my_score')::integer,2,'Poster reloads their pending historical score');
SELECT ok(NOT (pg_temp.context('main',1)->>'published')::boolean,'First cancelled score remains private');
SELECT is(public.submit_request_rating(pg_temp.fixture('main'),1,2),pg_temp.fixture('main'),'Exact cancelled score retry succeeds');
SELECT throws_ok($$SELECT public.submit_request_rating(pg_temp.fixture('main'),1,3)$$,'23505',NULL,'Cancelled score cannot be revised');
SELECT pg_temp.login(2);
SELECT ok(pg_temp.context('main',1)->>'received_score' IS NULL,'Cancelled helper cannot preview incoming stars');
SELECT is((SELECT count(*) FROM public.request_ratings WHERE request_id=pg_temp.fixture('main')),0::bigint,'Direct reads also hide the other pending cancelled score');
SELECT is((public.get_profile_rating_summary(pg_temp.uid(2))->>'rating_count')::integer,0,'Pending cancelled score is absent from reliability');
SELECT public.submit_request_rating(pg_temp.fixture('main'),1,4);
SELECT ok((pg_temp.context('main',1)->>'published')::boolean,'Cancelled scores publish after both participants submit');
SELECT is((pg_temp.context('main',1)->>'received_score')::integer,2,'Helper sees incoming cancelled score after publication');
SELECT is((public.get_profile_rating_summary(pg_temp.uid(2))->>'average_score')::numeric,2::numeric,'Published cancelled assignment contributes received reliability');
SELECT pg_temp.login(1);
SELECT is((pg_temp.context('main',1)->>'received_score')::integer,4,'Poster sees incoming score after mutual publication');
SELECT is((public.get_profile_rating_summary(pg_temp.uid(1))->>'average_score')::numeric,4::numeric,'Poster reliability includes cancelled mutual exchange');
SELECT pg_temp.login(4);
SELECT is((SELECT count(*) FROM public.request_ratings WHERE request_id=pg_temp.fixture('main')),0::bigint,'Outsider cannot enumerate published cancelled rating rows');
SELECT is((SELECT count(*) FROM public.get_my_request_rating_contexts(pg_temp.fixture('main'))),0::bigint,'Outsider cannot enumerate rating contexts');
SELECT throws_ok($$SELECT public.get_profile_rating_summary(pg_temp.uid(2),pg_temp.fixture('main'))$$,'42501',NULL,'Cancelled ratings do not expose private profile aggregates to outsiders');
RESET ROLE;
SELECT is((SELECT count(DISTINCT published_at) FROM public.request_ratings WHERE request_id=pg_temp.fixture('main')),1::bigint,'Cancelled mutual publication has one atomic timestamp');
SELECT is((SELECT jsonb_agg(to_jsonb(w) ORDER BY profile_id) FROM public.points_wallets w WHERE profile_id IN (SELECT pg_temp.uid(i) FROM generate_series(1,8) i)),(SELECT wallets FROM financial_snapshot),'Rating and retry do not touch any wallet field');
SELECT is((SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.points_ledger l WHERE profile_id IN (SELECT pg_temp.uid(i) FROM generate_series(1,8) i)),(SELECT ledger FROM financial_snapshot),'Rating and retry do not touch any ledger entry');

-- Re-offering and being selected again must preserve the previous assignment.
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(2);
SELECT public.renew_my_request_offer_for_terms(pg_temp.fixture('main-offer'),2,30);
SELECT pg_temp.login(1);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('main-offer'),'accepted',2,30);
SELECT pg_temp.login(2);
SELECT is(public.cancel_my_accepted_help(pg_temp.fixture('main'),1),pg_temp.fixture('main'),'Delayed retry for round one remains harmless after renewed acceptance');
SELECT ok((SELECT status='accepted' AND offer_round=2 FROM public.requests WHERE id=pg_temp.fixture('main')),'Old retry cannot cancel a newly accepted assignment');
SELECT is((SELECT status FROM public.request_point_reservations WHERE request_id=pg_temp.fixture('main') AND offer_round=2),'reserved','Old retry cannot release the new hold');
SELECT is((pg_temp.context('main',1)->>'received_score')::integer,2,'Renewing the offer preserves old reliability');
SELECT public.cancel_my_accepted_help(pg_temp.fixture('main'),2);
SELECT is((SELECT count(*) FROM public.get_my_request_rating_contexts(pg_temp.fixture('main'))),2::bigint,'Same helper retains both separately cancelled assignments');
SELECT is((SELECT (c->>'offer_round')::integer FROM public.get_my_request_rating_contexts(pg_temp.fixture('main'),1,0) c),2,'Rating contexts page newest assignment first');
SELECT is((SELECT (c->>'offer_round')::integer FROM public.get_my_request_rating_contexts(pg_temp.fixture('main'),1,1) c),1,'Offset retrieves older assignment without duplicates');
SELECT is((SELECT count(*) FROM public.get_my_request_rating_contexts(pg_temp.fixture('main'),1,2)),0::bigint,'Offset past history returns an empty page');
SELECT throws_ok($$SELECT public.get_my_request_rating_contexts(pg_temp.fixture('main'),0,0)$$,'22023',NULL,'Zero page size is rejected');
SELECT throws_ok($$SELECT public.get_my_request_rating_contexts(pg_temp.fixture('main'),51,0)$$,'22023',NULL,'Unbounded page size is rejected');
SELECT throws_ok($$SELECT public.get_my_request_rating_contexts(pg_temp.fixture('main'),20,-1)$$,'22023',NULL,'Negative page offset is rejected');
SELECT throws_ok($$SELECT public.get_my_request_rating_contexts(pg_temp.fixture('main'),NULL,0)$$,'22023',NULL,'Null page size is rejected');
SELECT throws_ok($$SELECT public.get_my_request_rating_contexts(pg_temp.fixture('main'),20,NULL)$$,'22023',NULL,'Null page offset is rejected');
SELECT pg_temp.login(1);
SELECT public.submit_request_rating(pg_temp.fixture('main'),2,3);
SELECT pg_temp.login(3);
SELECT public.renew_my_request_offer_for_terms(pg_temp.fixture('other-offer'),3,30);
SELECT pg_temp.login(1);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('other-offer'),'accepted',3,30);
SELECT pg_temp.login(2);
SELECT public.submit_request_rating(pg_temp.fixture('main'),2,5);
SELECT is((pg_temp.context('main',2)->>'received_score')::integer,3,'Old helper can finish mutual rating while replacement is active');
SELECT is(public.cancel_my_accepted_help(pg_temp.fixture('main'),2),pg_temp.fixture('main'),'Historical cancellation retry cannot cancel a different helper assignment');
SELECT ok((SELECT status='accepted' AND offer_round=3 FROM public.requests WHERE id=pg_temp.fixture('main')),'New helper assignment survives old helper retry');
SELECT throws_ok($$SELECT public.submit_request_rating(pg_temp.fixture('main'),3,5)$$,'42501',NULL,'Old helper cannot rate the new assignment');
SELECT pg_temp.login(1);
SELECT public.complete_my_request(pg_temp.fixture('main'),3);
SELECT ok((public.get_request_rating_context(pg_temp.fixture('main'))->>'eligible')::boolean,'Compatibility context exposes the current completed assignment');
SELECT is(pg_temp.context('main',3)->>'outcome','completed','History context identifies the current completed assignment');
SELECT is((SELECT count(*) FROM public.get_my_request_rating_contexts(pg_temp.fixture('main'))),3::bigint,'Poster sees cancelled and completed assignments separately');
SELECT public.submit_request_rating(pg_temp.fixture('main'),3,5);
SELECT public.set_my_request_archived(pg_temp.fixture('main'),true);
SELECT pg_temp.login(3);
SELECT is((SELECT count(*) FROM public.get_my_request_rating_contexts(pg_temp.fixture('main'))),1::bigint,'Replacement helper sees only their own completed assignment');
SELECT ok(public.get_request_rating_context(pg_temp.fixture('main'))->>'received_score' IS NULL,'Historical mutual ratings never reveal the new pending score');
SELECT public.submit_request_rating(pg_temp.fixture('main'),3,4);
SELECT is((public.get_request_rating_context(pg_temp.fixture('main'))->>'received_score')::integer,5,'Replacement mutual score publishes normally after archive');
SELECT throws_ok($$SELECT public.cancel_my_accepted_help(pg_temp.fixture('main'),3)$$,'22023',NULL,'Completed helper assignment cannot be cancelled');
SELECT pg_temp.login(2);
SELECT ok(public.get_request_rating_context(pg_temp.fixture('main')) IS NULL,'Old helper does not inherit completed current context');
SELECT is((SELECT count(*) FROM public.get_my_request_rating_contexts(pg_temp.fixture('main'))),2::bigint,'Archive preserves historical contexts for old helper');
SELECT is((SELECT count(*) FROM public.requests WHERE id=pg_temp.fixture('main')),1::bigint,'Old accepted helper retains closed request detail access after renewal and archive');
SELECT ok((SELECT has_assignment_history FROM public.get_request_offer_page_v4(NULL) WHERE id=pg_temp.fixture('main-offer')),'Historical offer summary allows the former accepted helper to find their rating history');
SELECT is((public.get_profile_rating_summary(pg_temp.uid(2))->>'rating_count')::integer,2,'Two cancelled assignments remain two received reliability ratings');
SELECT is((public.get_profile_rating_summary(pg_temp.uid(2))->>'average_score')::numeric,2.5::numeric,'Historical reliability survives renewal, replacement, completion and archive');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.points_ledger WHERE request_id=pg_temp.fixture('main')),2::bigint,'Only final completion creates the two transfer entries');
SELECT is((SELECT balance::integer FROM public.points_wallets WHERE profile_id=pg_temp.uid(1)),70,'Poster pays only final completed reward');
SELECT is((SELECT balance::integer FROM public.points_wallets WHERE profile_id=pg_temp.uid(2)),100,'Cancelled helper receives no transfer across either round');
SELECT is((SELECT balance::integer FROM public.points_wallets WHERE profile_id=pg_temp.uid(3)),130,'Only final completing helper earns points');

-- Poster cancellation and poster replacement create the same rating obligation.
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT public.cancel_my_request_for_round(pg_temp.fixture('side'),1,'accepted');
SELECT ok((public.get_request_rating_context(pg_temp.fixture('side'))->>'eligible')::boolean,'Owner-cancelled accepted current round is rateable');
SELECT is(pg_temp.context('side',1)->>'outcome','cancelled','History context identifies owner-cancelled assignment');
SELECT public.submit_request_rating(pg_temp.fixture('side'),1,4);
SELECT pg_temp.login(3);
SELECT public.submit_request_rating(pg_temp.fixture('side'),1,3);
SELECT is((public.get_request_rating_context(pg_temp.fixture('side'))->>'received_score')::integer,4,'Both participants can rate owner cancellation');
SELECT pg_temp.login(5);
INSERT INTO fixtures VALUES('owner-reopen',public.save_my_request(pg_temp.payload())),('never-accepted',public.save_my_request(pg_temp.payload()));
SELECT pg_temp.login(6);
INSERT INTO fixtures VALUES('owner-reopen-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('owner-reopen'),1,10)),
 ('never-accepted-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('never-accepted'),1,10));
SELECT pg_temp.login(5);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('owner-reopen-offer'),'accepted',1,10);
SELECT public.reopen_my_request(pg_temp.fixture('owner-reopen'),1,'2099-02-01T00:00:00Z');
SELECT is(pg_temp.context('owner-reopen',1)->>'outcome','cancelled','Poster reopening preserves a cancelled accepted rating relationship');
SELECT public.submit_request_rating(pg_temp.fixture('owner-reopen'),1,3);
SELECT public.cancel_my_request_for_round(pg_temp.fixture('never-accepted'),1,'open');
SELECT is((SELECT count(*) FROM public.get_my_request_rating_contexts(pg_temp.fixture('never-accepted'))),0::bigint,'Cancelled unaccepted request creates no rating context');
SELECT throws_ok($$SELECT public.submit_request_rating(pg_temp.fixture('never-accepted'),1,1)$$,'22023',NULL,'Poster cannot rate an offer they never accepted');
SELECT pg_temp.login(6);
SELECT public.submit_request_rating(pg_temp.fixture('owner-reopen'),1,2);
SELECT is((pg_temp.context('owner-reopen',1)->>'received_score')::integer,3,'Replaced helper can mutually rate the original poster');
SELECT is((SELECT count(*) FROM public.get_my_request_rating_contexts(pg_temp.fixture('never-accepted'))),0::bigint,'Unaccepted helper has no cancelled rating context');
SELECT is((SELECT count(*) FROM public.requests WHERE id=pg_temp.fixture('never-accepted')),0::bigint,'Never-accepted helper cannot open the closed request');
SELECT ok(NOT (SELECT has_assignment_history FROM public.get_request_offer_page_v4(NULL) WHERE id=pg_temp.fixture('never-accepted-offer')),'Pending-only offer does not claim accepted assignment history');
SELECT throws_ok($$SELECT public.cancel_my_accepted_help(pg_temp.fixture('owner-reopen'),1)$$,'22023',NULL,'A poster-initiated reopen is not a successful helper cancellation retry');

-- A helper must not invent a new deadline after the original one has elapsed.
SELECT pg_temp.login(7);
INSERT INTO fixtures VALUES('elapsed',public.save_my_request(pg_temp.payload()));
SELECT pg_temp.login(8);
INSERT INTO fixtures VALUES('elapsed-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('elapsed'),1,10));
SELECT pg_temp.login(7);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('elapsed-offer'),'accepted',1,10);
RESET ROLE;
UPDATE public.requests SET deadline_at='2000-01-01T00:00:00Z' WHERE id=pg_temp.fixture('elapsed');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(8);
SELECT lives_ok($$SELECT public.cancel_my_accepted_help(pg_temp.fixture('elapsed'),1)$$,'Helper can back out even after accepted work deadline elapsed');
SELECT ok((SELECT status='expired' AND offer_round=2 AND accepted_at IS NULL FROM public.requests WHERE id=pg_temp.fixture('elapsed')),'Elapsed helper cancellation produces an expired next round');
SELECT is((SELECT deadline_at FROM public.requests WHERE id=pg_temp.fixture('elapsed')),'2000-01-01T00:00:00Z'::timestamptz,'Expired cancellation does not extend the owner deadline');
SELECT is(pg_temp.context('elapsed',1)->>'outcome','cancelled','Expired request retains the cancelled accepted assignment rating');
SELECT public.submit_request_rating(pg_temp.fixture('elapsed'),1,2);
SELECT pg_temp.login(7);
SELECT is((public.get_my_points()->>'reserved')::integer,0,'Expired cancellation releases the hold');
SELECT public.set_my_request_archived(pg_temp.fixture('elapsed'),true);
SELECT public.submit_request_rating(pg_temp.fixture('elapsed'),1,3);
SELECT is((pg_temp.context('elapsed',1)->>'received_score')::integer,2,'Archived expired request still permits mutual cancelled rating');

SELECT set_config('request.jwt.claim.sub','',true);
SELECT throws_ok($$SELECT public.cancel_my_accepted_help(pg_temp.fixture('main'),1)$$,'42501',NULL,'Missing identity cannot invoke helper cancellation');
SELECT throws_ok($$SELECT public.get_my_request_rating_contexts(pg_temp.fixture('main'))$$,'42501',NULL,'Missing identity cannot read historical rating context');
SELECT throws_ok($$SELECT public.submit_request_rating(pg_temp.fixture('main'),1,5)$$,'42501',NULL,'Missing identity cannot rate a historical assignment');
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.cancel_my_accepted_help(NULL,1)$$,'42501',NULL,'Anonymous helper cancellation API is denied');
SELECT throws_ok($$SELECT public.get_my_request_rating_contexts(NULL)$$,'42501',NULL,'Anonymous historical rating API is denied');
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT * FROM finish();
ROLLBACK;
