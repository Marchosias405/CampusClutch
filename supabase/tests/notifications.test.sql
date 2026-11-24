BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT no_plan();

INSERT INTO auth.users(id,email,email_confirmed_at)
SELECT ('e211e211-e211-4211-8211-'||lpad(i::text,12,'0'))::uuid,
  'notifications-'||i||'@test.local',now() FROM generate_series(1,6) i;
CREATE FUNCTION pg_temp.uid(i integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('e211e211-e211-4211-8211-'||lpad(i::text,12,'0'))::uuid;
$$;
CREATE FUNCTION pg_temp.login(i integer) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub',pg_temp.uid(i)::text,true);
$$;
UPDATE public.profiles SET display_name='Notification Tester',major='Testing',year_of_study=2,
  campus_id=(SELECT id FROM public.campuses WHERE slug='burnaby'),is_discoverable=true,
  onboarding_completed_at=clock_timestamp()
WHERE id IN (SELECT pg_temp.uid(i) FROM generate_series(1,5) i);
UPDATE auth.users SET deleted_at=now() WHERE id=pg_temp.uid(4);
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=pg_temp.uid(5);
CREATE TEMP TABLE fixtures(name text PRIMARY KEY,id uuid);
GRANT ALL ON fixtures TO authenticated;
CREATE FUNCTION pg_temp.fixture(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM fixtures WHERE name=n; $$;
CREATE FUNCTION pg_temp.payload() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('category','delivery','title','Secret request title','description','Secret request description',
    'campus_id',(SELECT id FROM public.campuses WHERE slug='burnaby'),'room_location','Library',
    'deadline_at',clock_timestamp()+interval '1 day','points',10,'item_size','small',
    'details','{"pickup_location":"Cafe","dropoff_location":"Library"}'::jsonb);
$$;

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.notifications'::regclass),'Notification table has RLS');
SELECT ok(NOT has_table_privilege('authenticated','public.notifications','INSERT'),'Clients cannot insert notices');
SELECT ok(NOT has_table_privilege('authenticated','public.notifications','UPDATE'),'Clients cannot update notices directly');
SELECT ok(NOT has_table_privilege('authenticated','public.notifications','DELETE'),'Clients cannot delete notices');
SELECT ok(NOT has_table_privilege('anon','public.notifications','SELECT'),'Anonymous table reads denied');
SELECT is((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('get_my_notifications','get_my_notification_unread_count',
    'mark_my_notification_read','mark_all_my_notifications_read') AND p.prosecdef),0::bigint,'Public RPCs are security invokers');
SELECT ok(NOT has_function_privilege('authenticated',p.oid,'EXECUTE'),
  'Trigger-only/private writer cannot be invoked: '||p.proname)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='notifications_private'
AND p.proname IN ('copy_offer_event','bridge_offer_event','message_event','request_completed_event','read_message_notices','broadcast_changes');

SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT is(public.get_my_notification_unread_count(),0,'New profile has zero unread notices');
SELECT is((SELECT count(*) FROM public.get_my_notifications()),0::bigint,'New profile history is empty');
INSERT INTO fixtures VALUES('request',public.save_my_request(pg_temp.payload()));
SELECT is(public.get_my_notification_unread_count(),0,'Posting does not self-notify');
SELECT pg_temp.login(2);
INSERT INTO fixtures VALUES('offer',public.create_my_request_offer_for_terms(pg_temp.fixture('request'),1,10,'Secret helper text'));
SELECT is(public.get_my_notification_unread_count(),0,'Offering does not self-notify');
SELECT pg_temp.login(1);
SELECT is(public.get_my_notification_unread_count(),1,'Poster receives one offer notice');
SELECT is((SELECT event_type FROM public.get_my_notifications()),'offer_created','Offer event type is stable');
SELECT is((SELECT actor_id FROM public.get_my_notifications()),pg_temp.uid(2),'Offer notice identifies helper');
SELECT is((SELECT request_id FROM public.get_my_notifications()),pg_temp.fixture('request'),'Request navigation points to correct request');
SELECT is((SELECT offer_id FROM public.get_my_notifications()),pg_temp.fixture('offer'),'Offer navigation retains source offer');
SELECT is((SELECT navigation_key FROM public.get_my_notifications()),'request_details','Offer event navigation is request details');
SELECT ok((SELECT title||body NOT LIKE '%Secret%' FROM public.get_my_notifications()),'Notice does not copy request/helper private text');
INSERT INTO fixtures SELECT 'offer-notice',id FROM public.get_my_notifications();
SELECT throws_ok($$INSERT INTO public.notifications(recipient_id,event_type,title,body,navigation_key,source_event_key)
  VALUES(pg_temp.uid(1),'offer_created','Fake','Fake','request_details','fake')$$,'42501',NULL,'Direct client notice fabrication denied');
SELECT throws_ok($$UPDATE public.notifications SET read_at=now()$$,'42501',NULL,'Direct read-state mutation denied');
SELECT throws_ok($$DELETE FROM public.notifications$$,'42501',NULL,'Direct client deletion denied');
SELECT pg_temp.login(3);
SELECT is((SELECT count(*) FROM public.notifications),0::bigint,'Outsider cannot select another recipient notices');
SELECT throws_ok($$SELECT public.mark_my_notification_read(pg_temp.fixture('offer-notice'))$$,'42501',NULL,'Outsider cannot mark another recipient notice');
SELECT is(public.mark_all_my_notifications_read(),0,'Outsider mark-all does not affect another recipient');
SELECT pg_temp.login(2);
SELECT public.create_my_request_offer_for_terms(pg_temp.fixture('request'),1,10,'Secret helper text');
SELECT pg_temp.login(1);
SELECT is(public.get_my_notification_unread_count(),1,'Offer retry cannot duplicate a notice');
SELECT is(public.mark_my_notification_read(pg_temp.fixture('offer-notice')),pg_temp.fixture('offer-notice'),'Owner can mark one notice');
SELECT is(public.get_my_notification_unread_count(),0,'Single acknowledgment clears unread');
CREATE TEMP TABLE read_timestamp AS SELECT read_at FROM public.notifications WHERE id=pg_temp.fixture('offer-notice');
SELECT public.mark_my_notification_read(pg_temp.fixture('offer-notice'));
SELECT is((SELECT read_at FROM public.notifications WHERE id=pg_temp.fixture('offer-notice')),
  (SELECT read_at FROM read_timestamp),'Read retry preserves first acknowledgment');
SELECT is((SELECT count(*) FROM public.get_my_notifications()),1::bigint,'Read notices remain in history');
SELECT public.decide_request_offer_for_round(pg_temp.fixture('offer'),'accepted',1,10);
SELECT pg_temp.login(2);
SELECT is((SELECT event_type FROM public.get_my_notifications()),'offer_accepted','Selected helper receives acceptance');
SELECT public.mark_all_my_notifications_read();
SELECT pg_temp.login(1);
SELECT public.complete_my_request(pg_temp.fixture('request'),1);
SELECT public.complete_my_request(pg_temp.fixture('request'),1);
SELECT is(public.get_my_notification_unread_count(),0,'Poster confirming completion does not self-notify');
SELECT pg_temp.login(2);
SELECT is(public.get_my_notification_unread_count(),1,'Helper receives completion once despite retry');
SELECT is((SELECT event_type FROM public.get_my_notifications() WHERE read_at IS NULL),'request_completed','Completion event has correct type');
SELECT is((SELECT request_id FROM public.get_my_notifications() WHERE event_type='request_completed'),pg_temp.fixture('request'),'Completion points to completed request');

-- Existing source rows can be copied again safely without resetting read state.
RESET ROLE;
SELECT notifications_private.copy_offer_event(event) FROM public.offer_notifications event
WHERE event.request_id=pg_temp.fixture('request');
SELECT is((SELECT count(*) FROM public.notifications WHERE request_id=pg_temp.fixture('request')),3::bigint,'Historical bridge replay is deduplicated');
SELECT is((SELECT read_at FROM public.notifications WHERE id=pg_temp.fixture('offer-notice')),
  (SELECT read_at FROM read_timestamp),'Backfill replay cannot reset acknowledgment');
SELECT is((SELECT count(*) FROM public.offer_notifications source LEFT JOIN public.notifications notice
  ON notice.source_event_key='offer:'||source.id::text AND notice.recipient_id=source.recipient_id
  WHERE source.recipient_id IS DISTINCT FROM source.actor_id AND notice.id IS NULL),0::bigint,'Every historical offer source is backfilled exactly once');

-- Offer renewal/cancellation stays round-specific and preserves source history.
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
INSERT INTO fixtures VALUES('reopen',public.save_my_request(pg_temp.payload()));
SELECT pg_temp.login(2);
INSERT INTO fixtures VALUES('reopen-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('reopen'),1,10));
SELECT pg_temp.login(1);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('reopen-offer'),'accepted',1,10);
SELECT pg_temp.login(2);
SELECT public.cancel_my_accepted_help(pg_temp.fixture('reopen'),1);
SELECT public.cancel_my_accepted_help(pg_temp.fixture('reopen'),1);
SELECT pg_temp.login(1);
SELECT is((SELECT count(*) FROM public.get_my_notifications(50) WHERE request_id=pg_temp.fixture('reopen') AND event_type='offer_withdrawn'),1::bigint,'Accepted-helper cancellation notifies poster once');
SELECT pg_temp.login(2);
SELECT public.renew_my_request_offer_for_terms(pg_temp.fixture('reopen-offer'),2,10);
SELECT pg_temp.login(1);
SELECT is((SELECT count(*) FROM public.get_my_notifications(50) WHERE request_id=pg_temp.fixture('reopen') AND event_type='offer_created'),2::bigint,'New-round fresh offer creates a new notice');
SELECT public.cancel_my_request(pg_temp.fixture('reopen'));
SELECT pg_temp.login(2);
SELECT is((SELECT count(*) FROM public.get_my_notifications(50) WHERE request_id=pg_temp.fixture('reopen') AND event_type='request_cancelled'),1::bigint,'Poster cancellation reaches pending helper');

SELECT pg_temp.login(1);
INSERT INTO fixtures VALUES('multi',public.save_my_request(pg_temp.payload()));
SELECT pg_temp.login(2);
INSERT INTO fixtures VALUES('multi-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('multi'),1,10));
SELECT pg_temp.login(3);
INSERT INTO fixtures VALUES('other-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('multi'),1,10));
SELECT pg_temp.login(1);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('multi-offer'),'accepted',1,10);
SELECT pg_temp.login(3);
SELECT is((SELECT event_type FROM public.get_my_notifications(50) WHERE request_id=pg_temp.fixture('multi')),'another_helper_selected','Nonselected helper receives a selection update');
SELECT pg_temp.login(1);
SELECT public.reopen_my_request(pg_temp.fixture('multi'),1,clock_timestamp()+interval '2 days');
SELECT pg_temp.login(2);
SELECT is((SELECT count(*) FROM public.get_my_notifications(50) WHERE request_id=pg_temp.fixture('multi') AND event_type='request_reopened'),1::bigint,'Poster reopening notifies the former accepted helper');
SELECT public.renew_my_request_offer_for_terms(pg_temp.fixture('multi-offer'),2,10);
SELECT pg_temp.login(1);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('multi-offer'),'rejected',2);
SELECT pg_temp.login(2);
SELECT is((SELECT count(*) FROM public.get_my_notifications(50) WHERE request_id=pg_temp.fixture('multi') AND event_type='offer_rejected'),1::bigint,'Explicit rejection reaches the correct helper');
SELECT pg_temp.login(3);
SELECT public.renew_my_request_offer_for_terms(pg_temp.fixture('other-offer'),2,10);
RESET ROLE;
UPDATE public.requests SET status='expired',deadline_at=clock_timestamp()-interval '1 second'
WHERE id=pg_temp.fixture('multi');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(3);
SELECT is((SELECT count(*) FROM public.get_my_notifications(50) WHERE request_id=pg_temp.fixture('multi') AND event_type='request_expired'),1::bigint,'Expiration reaches the remaining pending helper');
SELECT ok((SELECT actor_id IS NULL FROM public.get_my_notifications(50) WHERE request_id=pg_temp.fixture('multi') AND event_type='request_expired'),'Automatic expiry does not blame the current caller');

-- Direct messages use message identity, not caller-supplied notification data.
SELECT pg_temp.login(1);
INSERT INTO fixtures VALUES('direct',public.start_direct_conversation(pg_temp.uid(2))),('client-id',gen_random_uuid());
SELECT public.mark_all_my_notifications_read();
SELECT public.send_conversation_message(pg_temp.fixture('direct'),pg_temp.fixture('client-id'),'Private message text never copied');
SELECT public.send_conversation_message(pg_temp.fixture('direct'),pg_temp.fixture('client-id'),'Private message text never copied');
SELECT is(public.get_my_notification_unread_count(),0,'Sender receives no own-message notice');
SELECT pg_temp.login(2);
SELECT is((SELECT count(*) FROM public.get_my_notifications(50) WHERE event_type='message_received'),1::bigint,'Message retry creates exactly one recipient notice');
SELECT is((SELECT conversation_id FROM public.get_my_notifications(50) WHERE event_type='message_received'),pg_temp.fixture('direct'),'Message navigation points to correct conversation');
SELECT is((SELECT navigation_key FROM public.get_my_notifications(50) WHERE event_type='message_received'),'conversation','Message navigation uses conversation destination');
SELECT ok((SELECT body NOT LIKE '%Private message%' FROM public.get_my_notifications(50) WHERE event_type='message_received'),'Message body remains out of notification text');
INSERT INTO fixtures SELECT 'message-notice',id FROM public.get_my_notifications(50) WHERE event_type='message_received';
SELECT public.mark_my_notification_read(pg_temp.fixture('message-notice'));
SELECT is(public.get_my_unread_message_count(),1::bigint,'Bell read does not change message unread count');
SELECT pg_temp.login(1);
SELECT public.send_conversation_message(pg_temp.fixture('direct'),gen_random_uuid(),'Second private message');
SELECT public.send_conversation_message(pg_temp.fixture('direct'),gen_random_uuid(),'Third private message');
SELECT pg_temp.login(2);
SELECT public.mark_conversation_read(pg_temp.fixture('direct'),2);
SELECT is((SELECT count(*) FROM public.get_my_notifications(50) WHERE event_type='message_received' AND read_at IS NULL),1::bigint,'Chat cursor clears only notices through the acknowledged message');
SELECT is(public.get_my_unread_message_count(),1::bigint,'Later chat message stays unread');
SELECT public.mark_conversation_read(pg_temp.fixture('direct'),3);
SELECT is((SELECT count(*) FROM public.get_my_notifications(50) WHERE event_type='message_received' AND read_at IS NULL),0::bigint,'Reading latest chat clears all its message notices');
SELECT public.mark_conversation_read(pg_temp.fixture('direct'),3);
SELECT is(public.get_my_unread_message_count(),0::bigint,'Repeated chat cursor acknowledgment remains safe');
SELECT ok(public.mark_all_my_notifications_read()>0,'Mark-all affects current recipient pending request notices');
SELECT is(public.mark_all_my_notifications_read(),0,'Mark-all retry reports zero additional rows');
SELECT is(public.get_my_notification_unread_count(),0,'Mark-all clears recipient unread total');
SELECT pg_temp.login(1);
SELECT public.send_conversation_message(pg_temp.fixture('direct'),gen_random_uuid(),'Arrived after mark all');
SELECT pg_temp.login(2);
SELECT is(public.get_my_notification_unread_count(),1,'New arrivals after mark-all remain unread');

-- Stable tuple cursor, equal timestamps, exact page limits, no raw source key.
RESET ROLE;
UPDATE public.notifications SET created_at='2026-01-01T00:00:00Z' WHERE recipient_id=pg_temp.uid(2);
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(2);
CREATE TEMP TABLE first_page AS SELECT * FROM public.get_my_notifications(2);
CREATE TEMP TABLE next_page AS SELECT * FROM public.get_my_notifications(50,
  (SELECT created_at FROM first_page ORDER BY created_at,id LIMIT 1),
  (SELECT id FROM first_page ORDER BY created_at,id LIMIT 1));
SELECT is((SELECT count(*) FROM first_page),2::bigint,'Requested first-page limit is honored');
SELECT is((SELECT count(*) FROM first_page a JOIN next_page b USING(id)),0::bigint,'Equal-time cursor pages never overlap');
SELECT is((SELECT count(*) FROM first_page)+(SELECT count(*) FROM next_page),
  (SELECT count(*) FROM public.notifications),'Equal-time cursor covers history without omissions');
SELECT ok(NOT (SELECT to_jsonb(notice) ? 'source_event_key' FROM public.get_my_notifications(1) notice),'API does not expose internal dedup key');
SELECT throws_ok($$SELECT public.get_my_notifications(0)$$,'22023',NULL,'Zero page size rejected');
SELECT throws_ok($$SELECT public.get_my_notifications(51)$$,'22023',NULL,'Oversized page rejected');
SELECT throws_ok($$SELECT public.get_my_notifications(NULL)$$,'22023',NULL,'Null page size rejected');
SELECT throws_ok($$SELECT public.get_my_notifications(20,now(),NULL)$$,'22023',NULL,'Partial time cursor rejected');
SELECT throws_ok($$SELECT public.get_my_notifications(20,NULL,gen_random_uuid())$$,'22023',NULL,'Partial ID cursor rejected');
SELECT throws_ok($$SELECT public.get_my_notifications(20,'infinity',gen_random_uuid())$$,'22023',NULL,'Nonfinite cursor rejected');
SELECT throws_ok($$SELECT public.mark_my_notification_read(NULL)$$,'42501',NULL,'Null notice cannot be marked');
SELECT throws_ok($$SELECT public.mark_my_notification_read(gen_random_uuid())$$,'42501',NULL,'Unknown notice cannot be marked');

SELECT pg_temp.login(4);
SELECT throws_ok($$SELECT public.get_my_notifications()$$,'42501',NULL,'Soft-deleted account denied with stale JWT');
SELECT is((SELECT count(*) FROM public.notifications),0::bigint,'Soft-deleted account cannot bypass RPC through raw table');
SELECT pg_temp.login(5);
SELECT throws_ok($$SELECT public.get_my_notification_unread_count()$$,'42501',NULL,'Banned account denied');
SELECT pg_temp.login(6);
SELECT throws_ok($$SELECT public.mark_all_my_notifications_read()$$,'42501',NULL,'Incomplete account denied');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT throws_ok($$SELECT public.get_my_notifications()$$,'42501',NULL,'Missing identity denied');
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.get_my_notifications()$$,'42501',NULL,'Anonymous history RPC denied');
SELECT throws_ok($$SELECT public.get_my_notification_unread_count()$$,'42501',NULL,'Anonymous unread RPC denied');
SELECT throws_ok($$SELECT public.mark_my_notification_read(NULL)$$,'42501',NULL,'Anonymous mark-one RPC denied');
SELECT throws_ok($$SELECT public.mark_all_my_notifications_read()$$,'42501',NULL,'Anonymous mark-all RPC denied');
RESET ROLE;

-- Verify the server broadcast surface and own-topic authorization predicate.
SELECT is((SELECT count(*) FROM pg_policies WHERE schemaname='realtime' AND tablename='messages'
  AND policyname='notifications_receive_own_invalidations' AND cmd='SELECT'),1::bigint,'Recipient-only private broadcast policy installed');
SELECT is((SELECT count(*) FROM pg_policies WHERE schemaname='realtime' AND tablename='messages'
  AND permissive='RESTRICTIVE' AND cmd IN ('INSERT','UPDATE','DELETE')),3::bigint,'Existing restrictive policies keep client publishing disabled');
SELECT is((SELECT count(*) FROM public.notifications WHERE recipient_id IN (pg_temp.uid(1),pg_temp.uid(2))
  AND actor_id=recipient_id),0::bigint,'No generated event notifies its actor');
SELECT is((SELECT count(*) FROM realtime.messages WHERE event='notifications_changed'
  AND topic IN ('notifications:'||pg_temp.uid(1)::text,'notifications:'||pg_temp.uid(2)::text)
  AND (NOT private OR (payload - 'id') <> '{}'::jsonb)),0::bigint,'Broadcasts are private and contain no content beyond the generated transport ID');

-- Foreign-key cleanup preserves safe history while exposing no forged route.
DELETE FROM public.messages WHERE conversation_id=pg_temp.fixture('direct');
SELECT is((SELECT count(*) FROM public.notifications WHERE conversation_id=pg_temp.fixture('direct') AND message_id IS NOT NULL),0::bigint,'Deleted source messages clear optional message targets safely');
SET CONSTRAINTS ALL IMMEDIATE;
SELECT * FROM finish();
ROLLBACK;
