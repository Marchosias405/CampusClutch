BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT no_plan();
INSERT INTO auth.users(id,email) SELECT ('77777777-7777-4777-8777-'||lpad(i::text,12,'0'))::uuid,'page-'||i||'@test.local' FROM generate_series(1,4) i;
UPDATE public.profiles SET display_name='Private Offer Helper',major='Computing Science',year_of_study=2,is_discoverable=false,
 campus_id=(SELECT id FROM public.campuses WHERE slug='burnaby')
 WHERE id IN (SELECT ('77777777-7777-4777-8777-'||lpad(i::text,12,'0'))::uuid FROM generate_series(1,4) i);
CREATE FUNCTION pg_temp.login(i integer) RETURNS text LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub','77777777-7777-4777-8777-'||lpad(i::text,12,'0'),true);
$$;
CREATE FUNCTION pg_temp.payload() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('category','delivery','title','Page test','description','Please help with this request.',
 'campus_id',(SELECT id FROM public.campuses WHERE slug='burnaby'),'room_location','Library',
 'deadline_at',clock_timestamp()+interval '1 day','points',10,'item_size','small',
 'details','{"pickup_location":"Cafe","dropoff_location":"Library"}'::jsonb);
$$;
CREATE TEMP TABLE fixtures(name text primary key,id uuid);
GRANT ALL ON fixtures TO authenticated;
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
INSERT INTO fixtures SELECT n,public.save_my_request(pg_temp.payload()) FROM unnest(ARRAY['first','second','expire','empty-expire']) n;
SELECT pg_temp.login(2);
INSERT INTO fixtures SELECT 'offer-'||name,public.create_my_request_offer(id) FROM fixtures WHERE name IN ('first','second','expire');
SELECT pg_temp.login(3);
INSERT INTO fixtures VALUES('other-offer',public.create_my_request_offer((SELECT id FROM fixtures WHERE name='first')));
SELECT is((SELECT count(*) FROM public.get_request_offer_page((SELECT id FROM fixtures WHERE name='first'))),1::bigint,'Helper sees only own offer in request page');
SELECT pg_temp.login(1);
SELECT is((SELECT count(*) FROM public.get_request_offer_page((SELECT id FROM fixtures WHERE name='first'))),2::bigint,'Owner sees both helpers');
SELECT is((SELECT count(*) FROM public.profiles WHERE id='77777777-7777-4777-8777-000000000002'),0::bigint,'Private profile remains hidden from general queries');
SELECT ok((SELECT bool_and(helper_display_name='Private Offer Helper' AND helper_major='Computing Science' AND helper_year=2 AND helper_campus IS NOT NULL) FROM public.get_request_offer_page((SELECT id FROM fixtures WHERE name='first'))),'Owner receives approved summary despite disabled discovery');
SELECT is((SELECT to_jsonb(p) ?| array['email','avatar_path','social_links','interests','onboarding_completed_at'] FROM public.get_request_offer_page((SELECT id FROM fixtures WHERE name='first'),1,0) p),false,'Summary omits private/contact/profile fields');
SELECT is((SELECT count(*) FROM public.get_request_offer_page((SELECT id FROM fixtures WHERE name='first'),1,0)),1::bigint,'Page size enforced');
SELECT isnt((SELECT id FROM public.get_request_offer_page((SELECT id FROM fixtures WHERE name='first'),1,0)),(SELECT id FROM public.get_request_offer_page((SELECT id FROM fixtures WHERE name='first'),1,1)),'Next page returns different offer');
SELECT is((SELECT count(*) FROM public.get_request_offer_page((SELECT id FROM fixtures WHERE name='first'),1,2)),0::bigint,'End of page is empty');
SELECT throws_ok($$SELECT * FROM public.get_request_offer_page(NULL,51,0)$$,'22023',NULL,'Oversized page rejected');
SELECT throws_ok($$SELECT * FROM public.get_request_offer_page(NULL,0,0)$$,'22023',NULL,'Zero page rejected');
SELECT throws_ok($$SELECT * FROM public.get_request_offer_page(NULL,20,-1)$$,'22023',NULL,'Negative offset rejected');
SELECT throws_ok($$SELECT * FROM public.get_request_offer_page(NULL,NULL,0)$$,'22023',NULL,'Null page size rejected');
SELECT public.decide_request_offer((SELECT id FROM fixtures WHERE name='offer-first'),'accepted');
SELECT public.cancel_my_request((SELECT id FROM fixtures WHERE name='second'));
SELECT pg_temp.login(2);
SELECT is((SELECT count(*) FROM public.get_request_offer_page() WHERE id IN (SELECT id FROM fixtures)),3::bigint,'My offers includes open, accepted and cancelled history');
SELECT is((SELECT request_status FROM public.get_request_offer_page() WHERE id=(SELECT id FROM fixtures WHERE name='offer-first')),'accepted','History exposes accepted request state');
SELECT is((SELECT request_title FROM public.get_request_offer_page() WHERE id=(SELECT id FROM fixtures WHERE name='offer-second')),'Page test','Closed request has a history label');
SELECT pg_temp.login(3);
SELECT is((SELECT count(*) FROM public.get_request_offer_page((SELECT id FROM fixtures WHERE name='first'))),1::bigint,'Rejected helper retains only own history on accepted request');
SELECT pg_temp.login(4);
SELECT is((SELECT count(*) FROM public.get_request_offer_page((SELECT id FROM fixtures WHERE name='first'))),0::bigint,'Unrelated user cannot read closed summaries');
SELECT is((SELECT count(*) FROM public.get_request_offer_page()),0::bigint,'Unrelated history is empty');
RESET ROLE;
UPDATE public.requests SET deadline_at=clock_timestamp()-interval '1 minute' WHERE id IN (SELECT id FROM fixtures WHERE name IN ('expire','empty-expire'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(4);
SELECT is((SELECT count(*) FROM public.get_request_offer_page((SELECT id FROM fixtures WHERE name='expire'))),0::bigint,'Unrelated expiry read reveals nothing');
RESET ROLE;
SELECT is((SELECT status FROM public.requests WHERE id=(SELECT id FROM fixtures WHERE name='expire')),'open','Unrelated reader cannot settle arbitrary requests');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(2);
SELECT is((SELECT request_status FROM public.get_request_offer_page() WHERE id=(SELECT id FROM fixtures WHERE name='offer-expire')),'expired','Helper history refresh settles expiry');
SELECT is((SELECT status FROM public.request_offers WHERE id=(SELECT id FROM fixtures WHERE name='offer-expire')),'rejected','Helper history expiry settles offer');
SELECT pg_temp.login(1);
SELECT lives_ok($$SELECT * FROM public.get_request_offer_page((SELECT id FROM fixtures WHERE name='empty-expire'))$$,'Owner can settle expiry without offers');
SELECT is((SELECT status FROM public.requests WHERE id=(SELECT id FROM fixtures WHERE name='empty-expire')),'expired','Empty owned request expired');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.get_request_offer_page()$$,'42501',NULL,'Anonymous page RPC blocked');
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT * FROM finish();
ROLLBACK;
