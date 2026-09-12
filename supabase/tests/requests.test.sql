BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

INSERT INTO auth.users (id,email) VALUES
 ('88888888-8888-4888-8888-888888888881','request-owner@test.local'),
 ('88888888-8888-4888-8888-888888888882','request-reader@test.local'),
 ('88888888-8888-4888-8888-888888888883','request-incomplete@test.local');
UPDATE public.profiles SET display_name='Request Tester',major='Computing Science',
 year_of_study=2,campus_id=(SELECT id FROM public.campuses WHERE slug='burnaby')
WHERE id IN ('88888888-8888-4888-8888-888888888881','88888888-8888-4888-8888-888888888882');

CREATE FUNCTION pg_temp.payload(category text DEFAULT 'delivery') RETURNS jsonb
LANGUAGE sql AS $$
 SELECT jsonb_build_object('category',category,'title','Test request','description','Please help with this request.',
 'campus_id',(SELECT id FROM public.campuses WHERE slug='burnaby'),'room_location','Library',
 'deadline_at',statement_timestamp()+interval '1 day','points',10,'item_size','small','details',
 CASE category WHEN 'delivery' THEN '{"pickup_location":"Cafe","dropoff_location":"Library"}'::jsonb
 WHEN 'pickup' THEN '{"pickup_location":"Shop","destination":"Library"}'::jsonb
 WHEN 'event_help' THEN '{"event_name":"Welcome","help_needed":"Set up chairs"}'::jsonb
 WHEN 'study_help' THEN '{"course_or_subject":"CMPT 120","topic":"Loops"}'::jsonb END);
$$;
CREATE TEMP TABLE fixtures(category text PRIMARY KEY,id uuid);
GRANT ALL ON fixtures TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','88888888-8888-4888-8888-888888888883',true);
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload())$$,'42501',NULL,'Incomplete profiles cannot create requests');
SELECT set_config('request.jwt.claim.sub','88888888-8888-4888-8888-888888888881',true);
INSERT INTO fixtures SELECT c,public.save_my_request(pg_temp.payload(c))
 FROM unnest(ARRAY['delivery','pickup','event_help','study_help']) c;
SELECT is((SELECT count(*) FROM public.requests WHERE id IN (SELECT id FROM fixtures)),4::bigint,'All four categories persist');
SELECT ok((SELECT bool_and(owner_id=auth.uid() AND status='open') FROM public.requests WHERE id IN (SELECT id FROM fixtures)),'Owner and initial status are server controlled');
SELECT is((SELECT count(*) FROM public.delivery_request_details WHERE request_id IN (SELECT id FROM fixtures)),1::bigint,'Delivery details persist');
SELECT is((SELECT count(*) FROM public.pickup_request_details WHERE request_id IN (SELECT id FROM fixtures)),1::bigint,'Pickup details persist');
SELECT is((SELECT count(*) FROM public.event_help_request_details WHERE request_id IN (SELECT id FROM fixtures)),1::bigint,'Event details persist');
SELECT is((SELECT count(*) FROM public.study_help_request_details WHERE request_id IN (SELECT id FROM fixtures)),1::bigint,'Study details persist');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload()-'details')$$,'22023',NULL,'Missing details rejected');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload() || '{"details":{"destination":"Elsewhere"}}')$$,'22023',NULL,'Mismatched details rejected');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload() || '{"owner_id":"88888888-8888-4888-8888-888888888882"}')$$,'22023',NULL,'Owner spoofing rejected');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload() || '{"status":"accepted"}')$$,'22023',NULL,'Status spoofing rejected');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload() || '{"points":0}')$$,'22023',NULL,'Zero points rejected');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload() || '{"points":-1}')$$,'22023',NULL,'Negative points rejected');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload() || '{"points":1.5}')$$,'22023',NULL,'Fractional points rejected');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload() || '{"points":"10"}')$$,'22023',NULL,'String points rejected');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload() || '{"is_urgent":"true"}')$$,'22023',NULL,'String urgency rejected');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload() || '{"campus_id":"00000000-0000-0000-0000-000000000000"}')$$,'23503',NULL,'Unknown campus rejected');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload() || '{"title":"  "}')$$,'23514',NULL,'Blank title rejected');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload() || '{"item_size":"huge"}')$$,'23514',NULL,'Unknown item size rejected');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload() || '{"deadline_at":"2000-01-01T00:00:00Z"}')$$,'22023',NULL,'Past deadline rejected');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload() || '{"deadline_at":"infinity"}')$$,'22023',NULL,'Infinite deadline rejected');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload() || '{"details":{"pickup_location":"  ","dropoff_location":"Library"}}')$$,'23514',NULL,'Invalid detail fails after parent insert');
SELECT is((SELECT count(*) FROM public.requests WHERE owner_id=auth.uid()),4::bigint,'Failed creates leave no partial requests');
SELECT throws_ok($$UPDATE public.requests SET points=100 WHERE id=(SELECT id FROM fixtures LIMIT 1)$$,'42501',NULL,'Direct updates denied');
SELECT throws_ok($$DELETE FROM public.requests WHERE id=(SELECT id FROM fixtures LIMIT 1)$$,'42501',NULL,'Direct deletes denied');
SELECT throws_ok($$INSERT INTO public.requests DEFAULT VALUES$$,'42501',NULL,'Direct inserts denied');
SELECT throws_ok($$UPDATE public.delivery_request_details SET pickup_location='Tampered'$$,'42501',NULL,'Direct detail writes denied');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload('pickup'),(SELECT id FROM fixtures WHERE category='delivery'))$$,'22023',NULL,'Category cannot change');
SELECT lives_ok($$SELECT public.save_my_request(pg_temp.payload() || '{"title":"Updated","is_urgent":true,"details":{"pickup_location":"New Cafe","dropoff_location":"Library"}}',(SELECT id FROM fixtures WHERE category='delivery'))$$,'Owner can edit an open request');
SELECT is((SELECT pickup_location FROM public.delivery_request_details WHERE request_id=(SELECT id FROM fixtures WHERE category='delivery')),'New Cafe','Edit updates category details');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload() || '{"title":"Should roll back","details":{"pickup_location":"","dropoff_location":"Library"}}',(SELECT id FROM fixtures WHERE category='delivery'))$$,'23514',NULL,'Invalid detail rejects edit');
SELECT is((SELECT title FROM public.requests WHERE id=(SELECT id FROM fixtures WHERE category='delivery')),'Updated','Failed edit rolls back common fields too');
SELECT is((SELECT id FROM public.get_request_feed() WHERE id IN (SELECT id FROM fixtures) LIMIT 1),(SELECT id FROM fixtures WHERE category='delivery'),'Urgent request sorts first');
SELECT is((SELECT count(*) FROM public.get_request_feed('study_help') WHERE id IN (SELECT id FROM fixtures)),1::bigint,'Category filter works');
SELECT is((SELECT count(*) FROM public.get_request_feed(NULL,'00000000-0000-0000-0000-000000000000')),0::bigint,'Campus filter works');
SELECT throws_ok($$SELECT public.get_request_feed('ALL')$$,'22023',NULL,'Invalid category rejected');
SELECT throws_ok($$SELECT public.get_request_feed(p_limit=>51)$$,'22023',NULL,'Page size bounded');
SELECT throws_ok($$SELECT public.get_request_feed(p_offset=>-1)$$,'22023',NULL,'Negative offset rejected');

SELECT set_config('request.jwt.claim.sub','88888888-8888-4888-8888-888888888882',true);
SELECT is((SELECT count(*) FROM public.requests WHERE id IN (SELECT id FROM fixtures)),4::bigint,'Another user sees open requests');
SELECT is((SELECT count(*) FROM public.delivery_request_details WHERE request_id IN (SELECT id FROM fixtures)),1::bigint,'Another user sees open request details');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload(),(SELECT id FROM fixtures WHERE category='delivery'))$$,'42501',NULL,'Another user cannot edit');
SELECT throws_ok($$SELECT public.cancel_my_request((SELECT id FROM fixtures WHERE category='delivery'))$$,'42501',NULL,'Another user cannot cancel');

RESET ROLE;
UPDATE public.requests SET deadline_at=statement_timestamp()-interval '1 hour' WHERE id=(SELECT id FROM fixtures WHERE category='pickup');
UPDATE public.requests SET status='accepted',accepted_at=now() WHERE id=(SELECT id FROM fixtures WHERE category='event_help');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.requests WHERE id IN (SELECT id FROM fixtures)),2::bigint,'Other users cannot read expired or accepted requests');
SELECT is((SELECT count(*) FROM public.pickup_request_details WHERE request_id IN (SELECT id FROM fixtures)),0::bigint,'Expired details follow parent visibility');
SELECT set_config('request.jwt.claim.sub','88888888-8888-4888-8888-888888888881',true);
SELECT is((SELECT count(*) FROM public.requests WHERE id IN (SELECT id FROM fixtures)),4::bigint,'Owner retains history');
SELECT is((SELECT count(*) FROM public.get_request_feed() WHERE id IN (SELECT id FROM fixtures)),2::bigint,'Owner feed also excludes expired and accepted rows');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload('pickup'),(SELECT id FROM fixtures WHERE category='pickup'))$$,'22023',NULL,'Expired request cannot be edited');
SELECT throws_ok($$SELECT public.save_my_request(pg_temp.payload('event_help'),(SELECT id FROM fixtures WHERE category='event_help'))$$,'22023',NULL,'Accepted request cannot be edited');
SELECT throws_ok($$SELECT public.cancel_my_request((SELECT id FROM fixtures WHERE category='event_help'))$$,'22023',NULL,'Accepted request cannot be cancelled through open-request workflow');
SELECT lives_ok($$SELECT public.cancel_my_request((SELECT id FROM fixtures WHERE category='delivery'))$$,'Owner can cancel');
SELECT lives_ok($$SELECT public.cancel_my_request((SELECT id FROM fixtures WHERE category='delivery'))$$,'Cancellation retry is harmless');
SELECT ok((SELECT status='cancelled' AND cancelled_at IS NOT NULL FROM public.requests WHERE id=(SELECT id FROM fixtures WHERE category='delivery')),'Cancellation preserves timestamped history');
SELECT is((SELECT count(*) FROM public.get_request_feed() WHERE id IN (SELECT id FROM fixtures)),1::bigint,'Cancelled request removed from feed');
SELECT set_config('request.jwt.claim.sub','88888888-8888-4888-8888-888888888882',true);
SELECT is((SELECT count(*) FROM public.delivery_request_details WHERE request_id IN (SELECT id FROM fixtures)),0::bigint,'Cancelled details hidden from other users');

RESET ROLE;
-- Validate deferred completeness, including writes made by trusted SQL callers.
SET CONSTRAINTS ALL IMMEDIATE;
SELECT throws_ok($$DELETE FROM public.study_help_request_details WHERE request_id=(SELECT id FROM fixtures WHERE category='study_help')$$,'23514',NULL,'A request cannot lose its detail row');
SELECT throws_ok($$INSERT INTO public.pickup_request_details(request_id,pickup_location,destination) SELECT id,'Shop','Home' FROM fixtures WHERE category='study_help'$$,'23503',NULL,'A second category cannot attach to the same request');

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.requests$$,'42501',NULL,'Signed-out callers cannot read requests');
SELECT throws_ok($$SELECT * FROM public.delivery_request_details$$,'42501',NULL,'Signed-out callers cannot read details');
SELECT throws_ok($$SELECT public.save_my_request('{}')$$,'42501',NULL,'Signed-out callers cannot create');
SELECT throws_ok($$SELECT public.cancel_my_request(gen_random_uuid())$$,'42501',NULL,'Signed-out callers cannot cancel');
SELECT throws_ok($$SELECT public.get_request_feed()$$,'42501',NULL,'Signed-out callers cannot query feed');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
