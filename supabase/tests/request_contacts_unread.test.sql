BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT no_plan();
-- All users, lifecycle transitions, messages, and administrative fixtures roll back.
CREATE FUNCTION pg_temp.uid(i integer) RETURNS uuid LANGUAGE sql AS $$
 SELECT ('a011a011-a011-4011-8011-'||lpad(i::text,12,'0'))::uuid;
$$;
INSERT INTO auth.users(id,email) SELECT pg_temp.uid(i),'request-contact-'||i||'@test.local' FROM generate_series(1,30) i;
UPDATE public.profiles SET display_name='Contact Tester',major='Computing Science',year_of_study=2,
 campus_id=(SELECT id FROM public.campuses WHERE slug='burnaby'),is_discoverable=true,onboarding_completed_at=now()
WHERE id IN (SELECT pg_temp.uid(i) FROM generate_series(1,30) i WHERE i<>5);
UPDATE public.profiles SET is_discoverable=false WHERE id IN(pg_temp.uid(1),pg_temp.uid(2));
CREATE FUNCTION pg_temp.login(i integer) RETURNS text LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub',pg_temp.uid(i)::text,true);
$$;
CREATE TEMP TABLE fixture(name text PRIMARY KEY,id uuid);
GRANT ALL ON fixture TO authenticated;
CREATE FUNCTION pg_temp.fixture(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM fixture WHERE name=n; $$;
CREATE FUNCTION pg_temp.payload() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('category','delivery','title','Request contact test','description','Please help with this request.',
 'campus_id',(SELECT id FROM public.campuses WHERE slug='burnaby'),'room_location','Library',
 'deadline_at','2099-01-01T00:00:00Z','points',10,'item_size','small',
 'details','{"pickup_location":"Cafe","dropoff_location":"Library"}'::jsonb);
$$;
SELECT ok(NOT has_function_privilege('anon',p.oid,'EXECUTE'),'Anonymous cannot call '||p.proname)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','messaging_private')
 AND p.proname IN('get_request_contact','start_request_contact_conversation','get_my_unread_message_count','request_contact','start_request_contact','unread_total');
SELECT ok(NOT p.prosecdef,'Public wrapper is invoker: '||p.proname)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 AND p.proname IN('get_request_contact','start_request_contact_conversation','get_my_unread_message_count');

SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
INSERT INTO fixture VALUES('request',public.save_my_request(pg_temp.payload()));
SELECT is(public.get_my_unread_message_count(),0::bigint,'Empty account badge is zero');
SELECT throws_ok($$SELECT public.get_request_contact(pg_temp.fixture('request'),pg_temp.uid(2))$$,'42501',NULL,'Poster cannot enumerate an arbitrary hidden helper before contact');
SELECT pg_temp.login(2);
SELECT is((SELECT count(*) FROM public.profiles WHERE id=pg_temp.uid(1)),0::bigint,'Hidden poster full profile remains private');
SELECT is(public.get_request_contact(pg_temp.fixture('request'),pg_temp.uid(1))->>'display_name','Contact Tester','Helper sees poster identity before any offer');
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(public.get_request_contact(pg_temp.fixture('request'),pg_temp.uid(1))) k),
 ARRAY['campus_display_name','display_name','major','profile_id','year_of_study']::text[],'Contact excludes emails, settings and social links');
SELECT is((SELECT count(*) FROM public.conversations),0::bigint,'Reading identity never creates a conversation');
SELECT throws_ok($$SELECT public.start_direct_conversation(pg_temp.uid(1))$$,'42501',NULL,'Global discovery still rejects hidden stranger');
SELECT throws_ok($$SELECT public.get_request_contact(pg_temp.fixture('request'),pg_temp.uid(3))$$,'42501',NULL,'Live request cannot authorize a third-party profile');
SELECT throws_ok($$SELECT public.start_request_contact_conversation(pg_temp.fixture('request'),pg_temp.uid(3))$$,'42501',NULL,'Live request cannot authorize a third-party conversation');
SELECT throws_ok($$SELECT public.get_request_contact(pg_temp.fixture('request'),pg_temp.uid(2))$$,'22023',NULL,'Self contact rejected');
SELECT throws_ok($$SELECT public.get_request_contact(NULL,pg_temp.uid(1))$$,'22023',NULL,'Missing request rejected');
SELECT throws_ok($$SELECT public.get_request_contact(pg_temp.uid(30),pg_temp.uid(1))$$,'42501',NULL,'Unknown request rejected');
INSERT INTO fixture VALUES('ab',public.start_request_contact_conversation(pg_temp.fixture('request'),pg_temp.uid(1)));
SELECT is(public.start_request_contact_conversation(pg_temp.fixture('request'),pg_temp.uid(1)),pg_temp.fixture('ab'),'Repeated preoffer chat uses one pair');
SELECT is((SELECT count(*) FROM public.request_conversations),0::bigint,'Preoffer introduction never creates an accepted assignment link');
SELECT lives_ok($$SELECT public.send_conversation_message(pg_temp.fixture('ab'),gen_random_uuid(),'Can you clarify the pickup?')$$,'Prospective helper can send before offering');
SELECT is(public.get_my_unread_message_count(),0::bigint,'Own send does not increase total unread');
SELECT pg_temp.login(1);
SELECT is(public.get_my_unread_message_count(),1::bigint,'Poster sees preoffer incoming message in total');
SELECT lives_ok($$SELECT public.send_conversation_message(pg_temp.fixture('ab'),gen_random_uuid(),'Yes, the library entrance.')$$,'Poster can reply before receiving an offer');
SELECT pg_temp.login(2);
INSERT INTO fixture VALUES('offer',public.create_my_request_offer_for_terms(pg_temp.fixture('request'),1,10));
SELECT is(public.get_my_unread_message_count(),1::bigint,'Helper sees only the incoming reply');
SELECT pg_temp.login(1);
SELECT is(public.get_request_contact(pg_temp.fixture('request'),pg_temp.uid(2))->>'profile_id',pg_temp.uid(2)::text,'Poster sees hidden pending helper identity before acceptance');
SELECT is(public.start_request_contact_conversation(pg_temp.fixture('request'),pg_temp.uid(2)),pg_temp.fixture('ab'),'Poster contact reuses preoffer conversation');
SELECT public.decide_request_offer_for_round(pg_temp.fixture('offer'),'accepted',1,10);
SELECT is(public.open_request_conversation(pg_temp.fixture('request'),1),pg_temp.fixture('ab'),'Acceptance links the same existing pair');
SELECT pg_temp.login(3);
SELECT throws_ok($$SELECT public.get_request_contact(pg_temp.fixture('request'),pg_temp.uid(1))$$,'42501',NULL,'Unselected outsider cannot inspect closed-to-feed request contact');
SELECT throws_ok($$SELECT public.get_conversation_summary(pg_temp.fixture('ab'))$$,'42501',NULL,'Known request does not reveal original pair conversation');
SELECT pg_temp.login(2);
SELECT public.cancel_my_accepted_help(pg_temp.fixture('request'),1);
SELECT pg_temp.login(3);
INSERT INTO fixture VALUES('replacement',public.create_my_request_offer_for_terms(pg_temp.fixture('request'),2,10));
SELECT pg_temp.login(1);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('replacement'),'accepted',2,10);
INSERT INTO fixture VALUES('ac',public.start_request_contact_conversation(pg_temp.fixture('request'),pg_temp.uid(3)));
SELECT isnt(pg_temp.fixture('ac'),pg_temp.fixture('ab'),'Replacement helper has a separate private pair');
SELECT pg_temp.login(2);
SELECT is(public.get_request_contact(pg_temp.fixture('request'),pg_temp.uid(1))->>'profile_id',pg_temp.uid(1)::text,'Original helper retains poster identity via assignment history');
SELECT is(public.start_request_contact_conversation(pg_temp.fixture('request'),pg_temp.uid(1)),pg_temp.fixture('ab'),'Historical helper returns to original pair');
SELECT throws_ok($$SELECT public.get_conversation_summary(pg_temp.fixture('ac'))$$,'42501',NULL,'Former helper cannot read replacement chat');
SELECT pg_temp.login(3);
SELECT is((SELECT count(*) FROM public.get_conversation_messages(pg_temp.fixture('ac'))),0::bigint,'Replacement helper never inherits original messages');
SELECT throws_ok($$SELECT public.get_conversation_summary(pg_temp.fixture('ab'))$$,'42501',NULL,'Replacement helper cannot read original chat');
SELECT pg_temp.login(5);
SELECT throws_ok($$SELECT public.get_request_contact(pg_temp.fixture('request'),pg_temp.uid(1))$$,'42501',NULL,'Incomplete actor cannot read request contacts');
SELECT throws_ok($$SELECT public.start_request_contact_conversation(pg_temp.fixture('request'),pg_temp.uid(1))$$,'42501',NULL,'Incomplete actor cannot initiate contacts');
RESET ROLE;
UPDATE public.profiles SET display_name=NULL,onboarding_completed_at=NULL WHERE id=pg_temp.uid(2);
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT throws_ok($$SELECT public.get_request_contact(pg_temp.fixture('request'),pg_temp.uid(2))$$,'42501',NULL,'Incomplete target cannot expose contact identity');
SELECT throws_ok($$SELECT public.start_request_contact_conversation(pg_temp.fixture('request'),pg_temp.uid(2))$$,'42501',NULL,'Incomplete target rejected even when pair already exists');
RESET ROLE;
UPDATE public.profiles SET display_name='Contact Tester',onboarding_completed_at=now() WHERE id=pg_temp.uid(2);
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT public.mark_conversation_read(pg_temp.fixture('ab'),2);
SELECT is(public.get_my_unread_message_count(),0::bigint,'Reading removes only observed incoming unread');
INSERT INTO fixture VALUES('expired',public.save_my_request(pg_temp.payload()));
RESET ROLE;
UPDATE public.requests SET status='expired',deadline_at=now()-interval '1 day' WHERE id=pg_temp.fixture('expired');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(3);
SELECT throws_ok($$SELECT public.get_request_contact(pg_temp.fixture('expired'),pg_temp.uid(1))$$,'42501',NULL,'Expired request does not expose a hidden poster to a stranger');
SELECT throws_ok($$SELECT public.start_request_contact_conversation(pg_temp.fixture('expired'),pg_temp.uid(1))$$,'42501',NULL,'Expired request cannot introduce a new helper');

-- More than one default inbox page: all incoming messages contribute, including closed chats.
SELECT pg_temp.login(4);
INSERT INTO fixture SELECT 'bulk-'||i,public.start_direct_conversation(pg_temp.uid(i)) FROM generate_series(6,30) i;
RESET ROLE;
INSERT INTO public.messages(conversation_id,sender_id,client_message_id,sequence,body)
 SELECT pg_temp.fixture('bulk-'||i),pg_temp.uid(i),gen_random_uuid(),1,'Incoming '||i FROM generate_series(6,30) i;
UPDATE public.conversations SET last_message_at=now(),last_message_sequence=1
 WHERE id IN(SELECT id FROM fixture WHERE name LIKE 'bulk-%');
UPDATE public.conversations SET status='closed' WHERE id=pg_temp.fixture('bulk-6');
UPDATE public.conversations SET status='removed' WHERE id=pg_temp.fixture('bulk-7');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(4);
SELECT is((SELECT count(*) FROM public.get_my_conversations()),20::bigint,'Inbox remains paginated');
SELECT is(public.get_my_unread_message_count(),24::bigint,'Total includes all pages and closed chats, excluding removed');
SELECT public.mark_conversation_read(pg_temp.fixture('bulk-6'),1);
SELECT is(public.get_my_unread_message_count(),23::bigint,'Reading a closed chat updates exact total');
SELECT pg_temp.login(6);
SELECT is(public.get_my_unread_message_count(),0::bigint,'Other account never inherits recipient badge count');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT throws_ok($$SELECT public.get_my_unread_message_count()$$,'42501',NULL,'Missing identity cannot read any badge count');
SELECT throws_ok($$SELECT public.get_request_contact(pg_temp.fixture('request'),pg_temp.uid(1))$$,'42501',NULL,'Missing identity cannot inspect contact');
SELECT * FROM finish();
ROLLBACK;
