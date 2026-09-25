BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT no_plan();
INSERT INTO auth.users(id,email)
SELECT ('94949494-9494-4949-8949-'||lpad(i::text,12,'0'))::uuid,
 'consent-'||i||'@test.local' FROM generate_series(1,4) i;
CREATE FUNCTION pg_temp.uid(i integer) RETURNS uuid LANGUAGE sql AS $$
 SELECT ('94949494-9494-4949-8949-'||lpad(i::text,12,'0'))::uuid;
$$;
UPDATE public.profiles SET display_name='Consent Tester',major='Computing Science',year_of_study=2,
 campus_id=(SELECT id FROM public.campuses WHERE slug='burnaby')
WHERE id IN (SELECT pg_temp.uid(i) FROM generate_series(1,4) i);
CREATE FUNCTION pg_temp.login(i integer) RETURNS text LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub',pg_temp.uid(i)::text,true);
$$;
CREATE FUNCTION pg_temp.payload(points integer) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('category','delivery','title','Reward consent test','description','Please help with this request.',
 'campus_id',(SELECT id FROM public.campuses WHERE slug='burnaby'),'room_location','Library',
 'deadline_at','2099-01-01T00:00:00Z','points',points,'item_size','small',
 'details','{"pickup_location":"Cafe","dropoff_location":"Library"}'::jsonb);
$$;
CREATE TEMP TABLE fixtures(name text PRIMARY KEY,id uuid);
GRANT ALL ON fixtures TO authenticated;
CREATE FUNCTION pg_temp.fixture(p_name text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM fixtures WHERE name=p_name; $$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
INSERT INTO fixtures SELECT n,public.save_my_request(pg_temp.payload(30))
FROM unnest(ARRAY['paid','cycles','unchanged','rollback']) n;
SELECT pg_temp.login(2);
INSERT INTO fixtures SELECT name||'-a',public.create_my_request_offer_for_terms(id,1,30,'Agreed to 30')
FROM fixtures WHERE name IN ('paid','cycles','unchanged','rollback');
SELECT pg_temp.login(3);
INSERT INTO fixtures SELECT name||'-b',public.create_my_request_offer_for_terms(id,1,30)
FROM fixtures WHERE name IN ('paid','cycles');
SELECT pg_temp.login(1);
SELECT public.save_my_request(pg_temp.payload(20),pg_temp.fixture('paid'));
SELECT ok((SELECT points=20 AND offer_round=2 AND status='open' FROM public.requests WHERE id=pg_temp.fixture('paid')),'30 to 20 starts one new round');
SELECT is((SELECT count(*) FROM public.request_offers WHERE request_id=pg_temp.fixture('paid') AND status='rejected' AND offer_round=1),2::bigint,'All old pending helpers retire with their original round');
SELECT is((SELECT count(*) FROM public.request_offer_history WHERE offer_id=pg_temp.fixture('paid-a') AND offer_round=1),2::bigint,'Original consent and retirement remain in history');
SELECT throws_ok($$SELECT public.decide_request_offer_for_round(pg_temp.fixture('paid-a'),'accepted',1,30)$$,'22023',NULL,'Old owner dialog cannot accept old consent');
SELECT throws_ok($$SELECT public.decide_request_offer_for_round(pg_temp.fixture('paid-a'),'accepted',2,20)$$,'22023',NULL,'Owner knowing new reward and round cannot accept helper A');
SELECT throws_ok($$SELECT public.reopen_my_request(pg_temp.fixture('paid'),1,'2099-02-01T00:00:00Z')$$,'22023',NULL,'Reward edit does not make a stale different-deadline reopen an idempotent retry');
SELECT is((public.get_my_points()->>'reserved')::integer,0,'Invalid acceptance leaves wallet unreserved');
SELECT pg_temp.login(4);
SELECT throws_ok($$SELECT public.create_my_request_offer_for_terms(pg_temp.fixture('paid'),1,30)$$,'22023',NULL,'Stale first submission cannot agree to changed reward');
SELECT throws_ok($$SELECT public.create_my_request_offer_for_terms(pg_temp.fixture('paid'),2,30)$$,'22023',NULL,'First submission validates amount separately from round');
SELECT throws_ok($$SELECT public.create_my_request_offer_for_terms(pg_temp.fixture('paid'),NULL,20)$$,'22023',NULL,'First submission needs a reviewed round');
SELECT throws_ok($$SELECT public.create_my_request_offer_for_terms(pg_temp.fixture('paid'),2,NULL)$$,'22023',NULL,'First submission needs a reviewed amount');
SELECT is((SELECT count(*) FROM public.request_offers WHERE request_id=pg_temp.fixture('paid')),0::bigint,'Failed first submissions create no helper row');
SELECT pg_temp.login(2);
SELECT throws_ok($$SELECT public.renew_my_request_offer_for_terms(pg_temp.fixture('paid-a'),1,30)$$,'22023',NULL,'Old renewal dialog cannot consent to new terms');
SELECT throws_ok($$SELECT public.renew_my_request_offer_for_terms(pg_temp.fixture('paid-a'),2,30)$$,'22023',NULL,'Renewal validates amount separately from round');
SELECT throws_ok($$SELECT public.create_my_request_offer(pg_temp.fixture('paid'))$$,'42501',NULL,'Legacy creation cannot bypass reward confirmation');
SELECT throws_ok($$SELECT public.renew_my_request_offer(pg_temp.fixture('paid-a'),2)$$,'42501',NULL,'Legacy renewal cannot bypass reward confirmation');
SELECT throws_ok($$SELECT request_private.create_offer(pg_temp.fixture('paid'),NULL)$$,'42501',NULL,'Private creation core is blocked');
SELECT throws_ok($$SELECT request_private.renew_offer(pg_temp.fixture('paid-a'),2,NULL)$$,'42501',NULL,'Private renewal core is blocked');
SELECT ok((SELECT request_points=20 AND request_offer_round=2 AND offer_round=1 FROM public.get_request_offer_page_v3(NULL) WHERE id=pg_temp.fixture('paid-a')),'My Offers exposes current reward and retired consent round');
SELECT pg_temp.login(3);
SELECT public.renew_my_request_offer_for_terms(pg_temp.fixture('paid-b'),2,20,'I agree to 20');
SELECT public.renew_my_request_offer_for_terms(pg_temp.fixture('paid-b'),2,20,'Retry');
SELECT is((SELECT count(*) FROM public.request_offer_history WHERE offer_id=pg_temp.fixture('paid-b') AND offer_round=2 AND status='pending'),1::bigint,'Fresh consent retry records one pending state');
SELECT pg_temp.login(1);
SELECT throws_ok($$SELECT public.renew_my_request_offer_for_terms(pg_temp.fixture('paid-a'),2,20)$$,'42501',NULL,'Owner cannot reconfirm for helper A');
SELECT throws_ok($$SELECT public.decide_request_offer_for_round(pg_temp.fixture('paid-a'),'accepted',2,20)$$,'22023',NULL,'Helper B renewal does not reactivate helper A');
SELECT public.decide_request_offer_for_round(pg_temp.fixture('paid-b'),'accepted',2,20);
SELECT is((SELECT amount FROM public.request_point_reservations WHERE request_id=pg_temp.fixture('paid')),20::bigint,'Fresh helper B consent reserves exactly 20');
SELECT public.complete_my_request(pg_temp.fixture('paid'),2);
SELECT is((public.get_my_points()->>'balance')::integer,80,'Completion pays the newly agreed 20');
SELECT pg_temp.login(2);
SELECT is((public.get_my_points()->>'balance')::integer,100,'Helper A receives no payment');
SELECT pg_temp.login(3);
SELECT is((public.get_my_points()->>'balance')::integer,120,'Helper B receives exactly 20');
-- A round trip through 30 -> 20 -> 10 -> 30 cannot revive old consent.
SELECT pg_temp.login(1);
SELECT public.save_my_request(pg_temp.payload(20),pg_temp.fixture('cycles'));
SELECT pg_temp.login(3);
SELECT public.renew_my_request_offer_for_terms(pg_temp.fixture('cycles-b'),2,20);
SELECT pg_temp.login(1);
SELECT public.save_my_request(pg_temp.payload(10),pg_temp.fixture('cycles'));
SELECT public.save_my_request(pg_temp.payload(30),pg_temp.fixture('cycles'));
SELECT is((SELECT offer_round FROM public.requests WHERE id=pg_temp.fixture('cycles')),4,'Every actual reward change advances the round');
SELECT is((SELECT offer_round FROM public.request_offers WHERE id=pg_temp.fixture('cycles-a')),1,'Helper A keeps their original round');
SELECT is((SELECT offer_round FROM public.request_offers WHERE id=pg_temp.fixture('cycles-b')),2,'Helper B keeps their last confirmed round');
SELECT throws_ok($$SELECT public.decide_request_offer_for_round(pg_temp.fixture('cycles-a'),'accepted',4,30)$$,'22023',NULL,'Returning to 30 does not revive helper A');
SELECT throws_ok($$SELECT public.decide_request_offer_for_round(pg_temp.fixture('cycles-b'),'accepted',4,30)$$,'22023',NULL,'Intervening change retires helper B too');
SELECT pg_temp.login(2);
SELECT throws_ok($$SELECT public.renew_my_request_offer_for_terms(pg_temp.fixture('cycles-a'),1,30)$$,'22023',NULL,'Same amount with stale round cannot renew');
SELECT public.renew_my_request_offer_for_terms(pg_temp.fixture('cycles-a'),4,30);
SELECT pg_temp.login(1);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('cycles-a'),'accepted',4,30);
SELECT is((SELECT amount FROM public.request_point_reservations WHERE request_id=pg_temp.fixture('cycles')),30::bigint,'Fresh consent after the round trip funds 30');
SELECT public.save_my_request(pg_temp.payload(30)||'{"title":"Updated title","room_location":"Atrium","details":{"pickup_location":"Cafe","dropoff_location":"Atrium"}}'::jsonb,pg_temp.fixture('unchanged'));
SELECT ok((SELECT offer_round=1 AND title='Updated title' FROM public.requests WHERE id=pg_temp.fixture('unchanged')),'Non-reward edit preserves the round');
SELECT ok((SELECT status='pending' AND offer_round=1 FROM public.request_offers WHERE id=pg_temp.fixture('unchanged-a')),'Non-reward edit preserves pending consent');
SELECT is((SELECT count(*) FROM public.request_offer_history WHERE offer_id=pg_temp.fixture('unchanged-a')),1::bigint,'Non-reward edit adds no consent history');
SELECT public.decide_request_offer_for_round(pg_temp.fixture('unchanged-a'),'accepted',1,30);
SELECT is((SELECT amount FROM public.request_point_reservations WHERE request_id=pg_temp.fixture('unchanged')),30::bigint,'Unchanged reward needs no fresh consent');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload(21),pg_temp.fixture('rollback'))$$,'P0002',NULL,'Unaffordable edit is rejected');
SELECT ok((SELECT points=30 AND offer_round=1 FROM public.requests WHERE id=pg_temp.fixture('rollback')),'Failed edit validation preserves reward and round');
SELECT ok((SELECT status='pending' AND offer_round=1 FROM public.request_offers WHERE id=pg_temp.fixture('rollback-a')),'Failed validation preserves pending consent');
RESET ROLE;
CREATE FUNCTION pg_temp.fail_consent_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.offer_id=pg_temp.fixture('rollback-a') AND NEW.status='rejected' THEN
  RAISE EXCEPTION 'test consent history failure' USING errcode='P0001';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER test_consent_history_failure BEFORE INSERT ON public.request_offer_history FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_consent_history();
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload(10),pg_temp.fixture('rollback'))$$,'P0001','test consent history failure','Retirement failure rolls back the whole reward edit');
SELECT ok((SELECT points=30 AND offer_round=1 FROM public.requests WHERE id=pg_temp.fixture('rollback')),'Failed retirement restores reward and round');
SELECT ok((SELECT status='pending' AND offer_round=1 FROM public.request_offers WHERE id=pg_temp.fixture('rollback-a')),'Failed retirement restores pending consent');
SELECT is((SELECT count(*) FROM public.request_offer_history WHERE offer_id=pg_temp.fixture('rollback-a')),1::bigint,'Failed retirement leaves no false history');
RESET ROLE;
DROP TRIGGER test_consent_history_failure ON public.request_offer_history;
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(4);
SELECT throws_ok($$SELECT public.renew_my_request_offer_for_terms(pg_temp.fixture('rollback-a'),1,30)$$,'42501',NULL,'Unrelated helper cannot renew another offer');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT throws_ok($$SELECT public.create_my_request_offer_for_terms(pg_temp.fixture('rollback'),1,30)$$,'42501',NULL,'Missing identity cannot submit');
SELECT throws_ok($$SELECT public.renew_my_request_offer_for_terms(pg_temp.fixture('rollback-a'),1,30)$$,'42501',NULL,'Missing identity cannot renew');
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.create_my_request_offer_for_terms(NULL,1,30)$$,'42501',NULL,'Anonymous guarded creation denied');
SELECT throws_ok($$SELECT public.renew_my_request_offer_for_terms(NULL,1,30)$$,'42501',NULL,'Anonymous guarded renewal denied');
SELECT throws_ok($$SELECT * FROM public.get_request_offer_page_v3()$$,'42501',NULL,'Anonymous terms page denied');
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT * FROM finish();
ROLLBACK;
