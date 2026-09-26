BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT no_plan();

-- Fixtures, injected publication failures and financial state all roll back.
INSERT INTO auth.users(id,email)
SELECT ('97979797-9797-4979-8979-'||lpad(i::text,12,'0'))::uuid,
 'ratings-'||i||'@test.local' FROM generate_series(1,7) i;
CREATE FUNCTION pg_temp.uid(i integer) RETURNS uuid LANGUAGE sql AS $$
 SELECT ('97979797-9797-4979-8979-'||lpad(i::text,12,'0'))::uuid;
$$;
UPDATE public.profiles SET display_name='Ratings Tester',major='Computing Science',year_of_study=2,
 campus_id=(SELECT id FROM public.campuses WHERE slug='burnaby'),is_discoverable=false,
 onboarding_completed_at=clock_timestamp()
WHERE id IN (SELECT pg_temp.uid(i) FROM generate_series(1,7) i);
CREATE FUNCTION pg_temp.login(i integer) RETURNS text LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub',pg_temp.uid(i)::text,true);
$$;
CREATE FUNCTION pg_temp.payload(points integer DEFAULT 10) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('category','delivery','title','Mutual rating test','description','Please help with this request.',
 'campus_id',(SELECT id FROM public.campuses WHERE slug='burnaby'),'room_location','Library',
 'deadline_at','2099-01-01T00:00:00Z','points',points,'item_size','small',
 'details','{"pickup_location":"Cafe","dropoff_location":"Library"}'::jsonb);
$$;
CREATE TEMP TABLE fixtures(name text PRIMARY KEY,id uuid);
GRANT ALL ON fixtures TO authenticated;
CREATE FUNCTION pg_temp.fixture(p_name text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM fixtures WHERE name=p_name; $$;

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.request_ratings'::regclass),'Ratings table enforces RLS');
SELECT ok(NOT has_function_privilege('anon','public.submit_request_rating(uuid,integer,integer)','EXECUTE'),'Anonymous clients cannot submit ratings');
SELECT ok(NOT has_function_privilege('anon','public.get_request_rating_context(uuid)','EXECUTE'),'Anonymous clients cannot read request rating context');
SELECT ok(NOT has_function_privilege('anon','public.get_profile_rating_summary(uuid,uuid)','EXECUTE'),'Anonymous clients cannot read reliability summaries');

SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
INSERT INTO fixtures VALUES('main',public.save_my_request(pg_temp.payload(30))),
 ('cancelled',public.save_my_request(pg_temp.payload())),('expired',public.save_my_request(pg_temp.payload()));
SELECT ok(public.get_request_rating_context(pg_temp.fixture('main')) IS NULL,'Open work has no rating action');
SELECT throws_ok($$SELECT public.submit_request_rating(pg_temp.fixture('main'),1,5)$$,'22023',NULL,'Open work cannot be rated');
SELECT pg_temp.login(2);
INSERT INTO fixtures VALUES('main-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('main'),1,30));
SELECT pg_temp.login(3);
INSERT INTO fixtures VALUES('other-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('main'),1,30));
SELECT pg_temp.login(1);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('main-offer'),'accepted',1,30);
SELECT ok(public.get_request_rating_context(pg_temp.fixture('main')) IS NULL,'Accepted work cannot expose a premature rating form');
SELECT throws_ok($$SELECT public.submit_request_rating(pg_temp.fixture('main'),1,5)$$,'22023',NULL,'Accepted work cannot be rated before payment settles');
SELECT public.cancel_my_request_for_round(pg_temp.fixture('cancelled'),1,'open');
SELECT throws_ok($$SELECT public.submit_request_rating(pg_temp.fixture('cancelled'),1,5)$$,'22023',NULL,'Cancelled work cannot be rated');
RESET ROLE;
UPDATE public.requests SET deadline_at=clock_timestamp()-interval '1 minute' WHERE id=pg_temp.fixture('expired');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT public.set_my_request_archived(pg_temp.fixture('expired'),true);
SELECT throws_ok($$SELECT public.submit_request_rating(pg_temp.fixture('expired'),1,5)$$,'22023',NULL,'Expired archived work cannot be rated');
SELECT public.complete_my_request(pg_temp.fixture('main'),1);
SELECT ok((public.get_request_rating_context(pg_temp.fixture('main'))->>'eligible')::boolean,'Completed settled work enables the poster rating');
SELECT is(public.get_request_rating_context(pg_temp.fixture('main'))->>'counterparty_id',pg_temp.uid(2)::text,'Poster can only rate the selected helper');
SELECT is(public.get_request_rating_context(pg_temp.fixture('main'))->>'counterparty_role','helper','Poster sees the helper role');
SELECT ok(public.get_request_rating_context(pg_temp.fixture('main'))->>'my_score' IS NULL,'New rating starts unselected');
SELECT is((public.get_profile_rating_summary(pg_temp.uid(1))->>'rating_count')::integer,0,'Unrated self profile has zero published ratings');
SELECT ok(public.get_profile_rating_summary(pg_temp.uid(1))->>'average_score' IS NULL,'Unrated profile has no fabricated average');
SELECT throws_ok($$SELECT public.submit_request_rating(pg_temp.fixture('main'),NULL,5)$$,'22023',NULL,'Rating requires a reviewed round');
SELECT throws_ok($$SELECT public.submit_request_rating(pg_temp.fixture('main'),2,5)$$,'22023',NULL,'Wrong rating round is rejected');
SELECT throws_ok($$SELECT public.submit_request_rating(pg_temp.fixture('main'),1,NULL)$$,'22023',NULL,'Missing score is rejected');
SELECT throws_ok($$SELECT public.submit_request_rating(pg_temp.fixture('main'),1,0)$$,'22023',NULL,'Zero stars is rejected');
SELECT throws_ok($$SELECT public.submit_request_rating(pg_temp.fixture('main'),1,6)$$,'22023',NULL,'More than five stars is rejected');
SELECT pg_temp.login(3);
SELECT ok(public.get_request_rating_context(pg_temp.fixture('main')) IS NULL,'Unselected helper has no rating context');
SELECT throws_ok($$SELECT public.submit_request_rating(pg_temp.fixture('main'),1,5)$$,'42501',NULL,'Unselected helper cannot rate either participant');
SELECT pg_temp.login(7);
SELECT ok(public.get_request_rating_context(pg_temp.fixture('main')) IS NULL,'Unrelated user has no rating context');
SELECT throws_ok($$SELECT public.submit_request_rating(pg_temp.fixture('main'),1,5)$$,'42501',NULL,'Unrelated user cannot rate');
SELECT throws_ok($$SELECT public.get_profile_rating_summary(pg_temp.uid(2))$$,'42501',NULL,'A private profile summary is not globally discoverable');
SELECT throws_ok($$SELECT public.get_profile_rating_summary(pg_temp.uid(2),pg_temp.fixture('main'))$$,'42501',NULL,'An arbitrary request ID cannot bypass profile privacy');

SELECT pg_temp.login(1);
SELECT is(public.submit_request_rating(pg_temp.fixture('main'),1,5),pg_temp.fixture('main'),'Poster submits five stars for the settled helper');
SELECT is((public.get_request_rating_context(pg_temp.fixture('main'))->>'my_score')::integer,5,'Poster can reload their submitted score while waiting');
SELECT ok(NOT (public.get_request_rating_context(pg_temp.fixture('main'))->>'published')::boolean,'First score is not published');
SELECT is((SELECT count(*) FROM public.request_ratings WHERE request_id=pg_temp.fixture('main')),1::bigint,'Poster can read their own pending rating');
SELECT is((public.get_profile_rating_summary(pg_temp.uid(2),pg_temp.fixture('main'))->>'rating_count')::integer,0,'Pending rating is excluded from authorized helper summary');
SELECT is(public.submit_request_rating(pg_temp.fixture('main'),1,5),pg_temp.fixture('main'),'Exact submission retry is idempotent');
SELECT throws_ok($$SELECT public.submit_request_rating(pg_temp.fixture('main'),1,4)$$,'23505',NULL,'A submitted rating cannot be changed');
SELECT is((SELECT count(*) FROM public.request_ratings WHERE request_id=pg_temp.fixture('main')),1::bigint,'Retries never create another rating');
SELECT throws_ok($$UPDATE public.request_ratings SET score=1 WHERE request_id=pg_temp.fixture('main')$$,'42501',NULL,'Direct updates cannot bypass immutable ratings');
SELECT throws_ok($$DELETE FROM public.request_ratings WHERE request_id=pg_temp.fixture('main')$$,'42501',NULL,'Direct deletes cannot erase ratings');
SELECT throws_ok($$INSERT INTO public.request_ratings(request_id,offer_round,rater_id,ratee_id,score) VALUES(pg_temp.fixture('main'),1,pg_temp.uid(2),pg_temp.uid(1),5)$$,'42501',NULL,'Clients cannot impersonate the other rater with direct writes');

SELECT pg_temp.login(2);
SELECT is(public.get_request_rating_context(pg_temp.fixture('main'))->>'counterparty_role','poster','Helper sees the poster role');
SELECT ok(public.get_request_rating_context(pg_temp.fixture('main'))->>'received_score' IS NULL,'Helper cannot preview the score received before rating');
SELECT ok(public.get_request_rating_context(pg_temp.fixture('main'))->>'my_score' IS NULL,'Switching participant does not expose the poster score as their own');
SELECT is((SELECT count(*) FROM public.request_ratings WHERE request_id=pg_temp.fixture('main')),0::bigint,'Direct table reads cannot reveal the pending counterpart score');
SELECT is((public.get_profile_rating_summary(pg_temp.uid(2))->>'rating_count')::integer,0,'Own aggregate cannot reveal an incoming pending rating');

-- A failure midway through publication must not save only one public side.
RESET ROLE;
CREATE FUNCTION pg_temp.fail_rating_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.request_id=pg_temp.fixture('main') AND NEW.published_at IS NOT NULL THEN
  RAISE EXCEPTION 'test rating publication failure' USING errcode='P0001';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER test_rating_publication_failure BEFORE UPDATE ON public.request_ratings FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_rating_publication();
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(2);
SELECT throws_ok($$SELECT public.submit_request_rating(pg_temp.fixture('main'),1,4)$$,'P0001','test rating publication failure','Publication failure rolls back the second rating too');
SELECT ok(public.get_request_rating_context(pg_temp.fixture('main'))->>'my_score' IS NULL,'Failed second submission remains retryable');
SELECT ok(public.get_request_rating_context(pg_temp.fixture('main'))->>'received_score' IS NULL,'Failed publication never reveals the first score');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.request_ratings WHERE request_id=pg_temp.fixture('main')),1::bigint,'Failed transaction leaves only the original private rating');
DROP TRIGGER test_rating_publication_failure ON public.request_ratings;
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(2);
SELECT is(public.submit_request_rating(pg_temp.fixture('main'),1,4),pg_temp.fixture('main'),'Helper can retry after publication failure');
SELECT ok((public.get_request_rating_context(pg_temp.fixture('main'))->>'published')::boolean,'Both scores publish after both participants rate');
SELECT is((public.get_request_rating_context(pg_temp.fixture('main'))->>'received_score')::integer,5,'Helper sees five received stars after publication');
SELECT is((public.get_request_rating_context(pg_temp.fixture('main'))->>'my_score')::integer,4,'Helper retains four stars they submitted');
SELECT is((SELECT count(*) FROM public.request_ratings WHERE request_id=pg_temp.fixture('main')),2::bigint,'Participant can read both published directions');
SELECT is((public.get_profile_rating_summary(pg_temp.uid(2))->>'average_score')::numeric,5::numeric,'Helper average uses stars received, not stars given');
SELECT is((public.get_profile_rating_summary(pg_temp.uid(1),pg_temp.fixture('main'))->>'average_score')::numeric,4::numeric,'Authorized participant sees poster reliability');
SELECT pg_temp.login(1);
SELECT is((public.get_request_rating_context(pg_temp.fixture('main'))->>'received_score')::integer,4,'Poster sees the helper submitted score after publication');
SELECT lives_ok($$SELECT public.submit_request_rating(pg_temp.fixture('main'),1,5)$$,'Published exact retry remains idempotent');
SELECT throws_ok($$SELECT public.submit_request_rating(pg_temp.fixture('main'),1,1)$$,'23505',NULL,'Published scores remain immutable');
SELECT public.set_my_request_archived(pg_temp.fixture('main'),true);
SELECT is((public.get_profile_rating_summary(pg_temp.uid(1))->>'rating_count')::integer,1,'Archiving completed work preserves published reliability');
SELECT pg_temp.login(2);
SELECT is((public.get_request_rating_context(pg_temp.fixture('main'))->>'received_score')::integer,5,'Poster archive preserves helper access to published rating context');
SELECT pg_temp.login(7);
SELECT is((SELECT count(*) FROM public.request_ratings WHERE request_id=pg_temp.fixture('main')),0::bigint,'Unrelated users cannot enumerate individual published ratings');
SELECT throws_ok($$SELECT public.get_profile_rating_summary(pg_temp.uid(2))$$,'42501',NULL,'Publication does not make private profiles discoverable');
RESET ROLE;
SELECT is((SELECT count(DISTINCT published_at) FROM public.request_ratings WHERE request_id=pg_temp.fixture('main')),1::bigint,'Both rating directions share the atomic publication timestamp');
SELECT is((SELECT balance::bigint FROM public.points_wallets WHERE profile_id=pg_temp.uid(1)),70::bigint,'Rating and archive leave poster payment unchanged');
SELECT is((SELECT balance::bigint FROM public.points_wallets WHERE profile_id=pg_temp.uid(2)),130::bigint,'Rating and archive leave helper payment unchanged');
SELECT is((SELECT count(*) FROM public.points_ledger WHERE request_id=pg_temp.fixture('main')),2::bigint,'Ratings create no additional payment ledger entries');
UPDATE public.profiles SET is_discoverable=true WHERE id=pg_temp.uid(2);
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(7);
SELECT is((public.get_profile_rating_summary(pg_temp.uid(2))->>'rating_count')::integer,1,'Completed discoverable profile exposes only the aggregate');
SELECT is((public.get_profile_rating_summary(pg_temp.uid(2))->>'average_score')::numeric,5::numeric,'Discoverable summary reports the published average');
SELECT is((SELECT count(*) FROM public.request_ratings WHERE request_id=pg_temp.fixture('main')),0::bigint,'Profile discovery does not expose raw request rating rows');

-- A second completed request contributes one received score per user.
SELECT pg_temp.login(1);
INSERT INTO fixtures VALUES('second',public.save_my_request(pg_temp.payload()));
SELECT pg_temp.login(2);
INSERT INTO fixtures VALUES('second-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('second'),1,10));
SELECT pg_temp.login(1);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('second-offer'),'accepted',1,10);
SELECT public.complete_my_request(pg_temp.fixture('second'),1);
SELECT public.submit_request_rating(pg_temp.fixture('second'),1,1);
SELECT is((public.get_profile_rating_summary(pg_temp.uid(2),pg_temp.fixture('second'))->>'average_score')::numeric,5::numeric,'Pending second score cannot shift the existing public average');
SELECT pg_temp.login(2);
SELECT public.submit_request_rating(pg_temp.fixture('second'),1,2);
SELECT is((public.get_profile_rating_summary(pg_temp.uid(2))->>'rating_count')::integer,2,'Each completed mutual exchange adds exactly one received rating');
SELECT is((public.get_profile_rating_summary(pg_temp.uid(2))->>'average_score')::numeric,3::numeric,'Multiple published received scores are averaged correctly');
SELECT pg_temp.login(1);
SELECT is((public.get_profile_rating_summary(pg_temp.uid(1))->>'average_score')::numeric,3::numeric,'Poster average combines only the helper scores');

-- A replaced helper never gains rating permission from their old accepted round.
SELECT pg_temp.login(4);
INSERT INTO fixtures VALUES('reassigned',public.save_my_request(pg_temp.payload()));
SELECT pg_temp.login(5);
INSERT INTO fixtures VALUES('old-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('reassigned'),1,10));
SELECT pg_temp.login(4);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('old-offer'),'accepted',1,10);
SELECT public.reopen_my_request(pg_temp.fixture('reassigned'),1,'2099-02-01T00:00:00Z');
SELECT pg_temp.login(6);
INSERT INTO fixtures VALUES('new-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('reassigned'),2,10));
SELECT pg_temp.login(4);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('new-offer'),'accepted',2,10);
SELECT public.complete_my_request(pg_temp.fixture('reassigned'),2);
SELECT throws_ok($$SELECT public.submit_request_rating(pg_temp.fixture('reassigned'),1,5)$$,'22023',NULL,'Poster cannot rate a released historical round');
SELECT pg_temp.login(5);
SELECT ok(public.get_request_rating_context(pg_temp.fixture('reassigned')) IS NULL,'Replaced helper has no rating context');
SELECT throws_ok($$SELECT public.submit_request_rating(pg_temp.fixture('reassigned'),2,5)$$,'42501',NULL,'Replaced helper cannot rate the new settled assignment');
SELECT pg_temp.login(6);
SELECT is((public.get_request_rating_context(pg_temp.fixture('reassigned'))->>'offer_round')::integer,2,'Only the final settled helper has the current rating round');
SELECT lives_ok($$SELECT public.submit_request_rating(pg_temp.fixture('reassigned'),2,5)$$,'Final settled helper can submit their rating');

-- Legacy completed rows without a payment agreement are ineligible.
SELECT pg_temp.login(4);
INSERT INTO fixtures VALUES('legacy',public.save_my_request(pg_temp.payload()));
RESET ROLE;
UPDATE public.requests SET status='completed',completed_at=clock_timestamp() WHERE id=pg_temp.fixture('legacy');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(4);
SELECT ok(public.get_request_rating_context(pg_temp.fixture('legacy')) IS NULL,'Unsettled legacy completion has no rating action');
SELECT throws_ok($$SELECT public.submit_request_rating(pg_temp.fixture('legacy'),1,5)$$,'22023',NULL,'Unsettled legacy completion cannot mint reliability');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT throws_ok($$SELECT public.submit_request_rating(pg_temp.fixture('main'),1,5)$$,'42501',NULL,'Missing authentication identity cannot submit');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
