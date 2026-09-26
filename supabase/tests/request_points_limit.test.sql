BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT no_plan();

INSERT INTO auth.users(id,email)
SELECT ('93939393-9393-4939-8939-'||lpad(i::text,12,'0'))::uuid,
  'points-limit-'||i||'@test.local' FROM generate_series(1,3) i;
CREATE FUNCTION pg_temp.uid(i integer) RETURNS uuid LANGUAGE sql AS $$
 SELECT ('93939393-9393-4939-8939-'||lpad(i::text,12,'0'))::uuid;
$$;
UPDATE public.profiles SET display_name='Points Limit Tester',major='Computing Science',year_of_study=2,
 campus_id=(SELECT id FROM public.campuses WHERE slug='burnaby')
WHERE id IN (SELECT pg_temp.uid(i) FROM generate_series(1,3) i);
CREATE FUNCTION pg_temp.login(i integer) RETURNS text LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub',pg_temp.uid(i)::text,true);
$$;
CREATE FUNCTION pg_temp.payload(points integer,category text DEFAULT 'delivery') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('category',category,'title','Points limit test','description','Please help with this request.',
 'campus_id',(SELECT id FROM public.campuses WHERE slug='burnaby'),'room_location','Library',
 'deadline_at',clock_timestamp()+interval '1 day','points',points,'item_size','small','details',
 CASE category WHEN 'delivery' THEN '{"pickup_location":"Cafe","dropoff_location":"Library"}'::jsonb
 WHEN 'pickup' THEN '{"pickup_location":"Cafe","destination":"Library"}'::jsonb
 WHEN 'event_help' THEN '{"event_name":"Welcome","help_needed":"Set chairs"}'::jsonb
 WHEN 'study_help' THEN '{"course_or_subject":"CMPT 120","topic":"Loops"}'::jsonb END);
$$;
CREATE TEMP TABLE fixtures(name text PRIMARY KEY,id uuid);
GRANT ALL ON fixtures TO authenticated;
CREATE FUNCTION pg_temp.fixture(p_name text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM fixtures WHERE name=p_name; $$;

-- Earn the exact reported 110 balance through a real transfer, not a balance reset.
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(2);
INSERT INTO fixtures VALUES('earning',public.save_my_request(pg_temp.payload(10)));
SELECT pg_temp.login(1);
INSERT INTO fixtures VALUES('earning-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('earning'),1,10));
SELECT pg_temp.login(2);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('earning-offer'),'accepted',1,10);
SELECT public.complete_my_request(pg_temp.fixture('earning'),1);
SELECT pg_temp.login(1);
SELECT is((public.get_my_points()->>'available')::integer,110,'Reporter scenario starts with 110 earned available points');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload(111))$$,'P0002','You have 110 available points. Offer no more than this amount.','111-point delivery is rejected with the real available balance');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload(111,'pickup'))$$,'P0002',NULL,'Pickup cannot exceed available points');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload(111,'event_help'))$$,'P0002',NULL,'Event help cannot exceed available points');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload(111,'study_help'))$$,'P0002',NULL,'Study help cannot exceed available points');
SELECT is((SELECT count(*) FROM public.requests WHERE owner_id=pg_temp.uid(1)),0::bigint,'Rejected posts leave no parent requests');
INSERT INTO fixtures VALUES('exact',public.save_my_request(pg_temp.payload(110))),
 ('editable',public.save_my_request(pg_temp.payload(10))),
 ('reservation',public.save_my_request(pg_temp.payload(30)));
SELECT is((SELECT points FROM public.requests WHERE id=pg_temp.fixture('exact')),110,'Exactly available points can be posted');
SELECT is((public.get_my_points()->>'reserved')::integer,0,'Creating requests does not reserve points');
SELECT is((public.get_my_points()->>'balance')::integer,110,'Creating requests does not debit the balance');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload(111)||'{"title":"Rejected edit","details":{"pickup_location":"Changed","dropoff_location":"Elsewhere"}}',pg_temp.fixture('editable'))$$,'P0002',NULL,'Editing cannot exceed available points');
SELECT is((SELECT points FROM public.requests WHERE id=pg_temp.fixture('editable')),10,'Rejected edit preserves the old points');
SELECT is((SELECT title FROM public.requests WHERE id=pg_temp.fixture('editable')),'Points limit test','Rejected edit preserves the old title');
SELECT is((SELECT pickup_location FROM public.delivery_request_details WHERE request_id=pg_temp.fixture('editable')),'Cafe','Rejected edit preserves detail fields');
SELECT lives_ok($$SELECT public.save_my_request(pg_temp.payload(110),pg_temp.fixture('editable'))$$,'Editing to exactly the available amount succeeds');
SELECT pg_temp.login(2);
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload(91))$$,'P0002',NULL,'Each poster uses their own wallet rather than another richer account');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload(999),pg_temp.fixture('editable'))$$,'42501',NULL,'Ownership is checked before exposing edit balance validation');
INSERT INTO fixtures VALUES('reserve-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('reservation'),1,30)),
 ('exact-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('exact'),1,110));
SELECT pg_temp.login(1);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('reserve-offer'),'accepted',1,30);
SELECT is((public.get_my_points()->>'available')::integer,80,'An accepted request reduces available points without reducing total');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload(81))$$,'P0002','You have 80 available points. Offer no more than this amount.','Reserved points cannot fund a new post');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload(81),pg_temp.fixture('editable'))$$,'P0002',NULL,'Reserved points cannot fund an edit');
SELECT lives_ok($$SELECT public.save_my_request(pg_temp.payload(80),pg_temp.fixture('editable'))$$,'Existing unaffordable request can be edited down to the available balance');
SELECT throws_ok($$SELECT public.decide_request_offer_for_round(pg_temp.fixture('exact-offer'),'accepted',1,110)$$,'P0002',NULL,'Acceptance still rechecks when funds changed after posting');
SELECT is((SELECT status FROM public.requests WHERE id=pg_temp.fixture('exact')),'open','Failed acceptance leaves the earlier request open');
SELECT is((SELECT status FROM public.request_offers WHERE id=pg_temp.fixture('exact-offer')),'pending','Failed acceptance preserves the pending offer');
SELECT public.reopen_my_request(pg_temp.fixture('reservation'),1,clock_timestamp()+interval '2 days');
SELECT lives_ok($$SELECT public.save_my_request(pg_temp.payload(110),pg_temp.fixture('editable'))$$,'Released reservations immediately become available for editing');
SELECT public.decide_request_offer_for_round(pg_temp.fixture('exact-offer'),'accepted',1,110);
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload(1))$$,'P0002','You have 0 available points. Offer no more than this amount.','Fully reserved wallet cannot post even one point');
SELECT public.complete_my_request(pg_temp.fixture('exact'),1);
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload(1))$$,'P0002',NULL,'Spent wallet cannot post even one point');
SELECT is((SELECT count(*) FROM public.requests WHERE owner_id=pg_temp.uid(1)),3::bigint,'Failed posts never leave extra requests');
SELECT is((SELECT count(*) FROM public.delivery_request_details d JOIN public.requests r ON r.id=d.request_id WHERE r.owner_id=pg_temp.uid(1)),3::bigint,'Failed posts never leave orphan details');

SELECT set_config('request.jwt.claim.sub','',true);
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload(1))$$,'42501',NULL,'Signed-out posting remains forbidden');
SELECT * FROM finish();
ROLLBACK;
