BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT no_plan();

-- Authentication fixtures and every message, assignment and injected failure
-- are rolled back. Public workflows establish all ordinary authorization.
INSERT INTO auth.users(id,email)
SELECT ('a010a010-a010-4010-8010-'||lpad(i::text,12,'0'))::uuid,
 'messages-'||i||'@test.local' FROM generate_series(1,10) i;
CREATE FUNCTION pg_temp.uid(i integer) RETURNS uuid LANGUAGE sql AS $$
 SELECT ('a010a010-a010-4010-8010-'||lpad(i::text,12,'0'))::uuid;
$$;
CREATE FUNCTION pg_temp.client_id(i integer) RETURNS uuid LANGUAGE sql AS $$
 SELECT ('b010b010-b010-4010-8010-'||lpad(i::text,12,'0'))::uuid;
$$;
UPDATE public.profiles SET display_name='Message Tester '||right(id::text,1),major='Computing Science',year_of_study=2,
 campus_id=(SELECT id FROM public.campuses WHERE slug='burnaby'),is_discoverable=true,
 onboarding_completed_at=clock_timestamp()
WHERE id IN (SELECT pg_temp.uid(i) FROM generate_series(1,9) i WHERE i<>8);
UPDATE public.profiles SET is_discoverable=false WHERE id=pg_temp.uid(4);
DELETE FROM auth.users WHERE id=pg_temp.uid(9);
CREATE FUNCTION pg_temp.login(i integer) RETURNS text LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub',pg_temp.uid(i)::text,true);
$$;
CREATE TEMP TABLE fixtures(name text PRIMARY KEY,id uuid);
CREATE TEMP TABLE sent(name text PRIMARY KEY,value jsonb);
CREATE TEMP TABLE snapshots(name text PRIMARY KEY,value jsonb);
GRANT ALL ON fixtures,sent TO authenticated;
CREATE FUNCTION pg_temp.fixture(p_name text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM fixtures WHERE name=p_name; $$;
CREATE FUNCTION pg_temp.payload() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('category','delivery','title','Request messaging test','description','Please help with this request.',
 'campus_id',(SELECT id FROM public.campuses WHERE slug='burnaby'),'room_location','Library',
 'deadline_at','2099-01-01T00:00:00Z','points',10,'item_size','small',
 'details','{"pickup_location":"Cafe","dropoff_location":"Library"}'::jsonb);
$$;

SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN
 ('public.conversations'::regclass,'public.conversation_members'::regclass,'public.direct_conversation_pairs'::regclass,
  'public.messages'::regclass,'public.request_conversations'::regclass)),'Every messaging table enforces RLS');
SELECT ok(NOT has_function_privilege('anon',p.oid,'EXECUTE'),'Anonymous role cannot call '||p.proname)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('start_direct_conversation','open_request_conversation','get_conversation_summary',
 'get_my_conversations','get_conversation_messages','send_conversation_message','mark_conversation_read');
SELECT ok(NOT has_table_privilege('authenticated',t,'INSERT') AND NOT has_table_privilege('authenticated',t,'UPDATE')
 AND NOT has_table_privilege('authenticated',t,'DELETE'),'Clients cannot directly mutate '||t)
FROM unnest(ARRAY['public.conversations','public.conversation_members','public.direct_conversation_pairs','public.messages','public.request_conversations']) t;

SET LOCAL ROLE authenticated;
SELECT pg_temp.login(8);
SELECT throws_ok($$SELECT public.start_direct_conversation(pg_temp.uid(2))$$,'42501',NULL,'Incomplete caller cannot start a conversation');
SELECT pg_temp.login(9);
SELECT throws_ok($$SELECT public.start_direct_conversation(pg_temp.uid(2))$$,'42501',NULL,'Deleted caller with a stale identity cannot start a conversation');
SELECT pg_temp.login(1);
SELECT throws_ok($$SELECT messaging_private.ensure_direct_pair(pg_temp.uid(4),false)$$,'42501',NULL,'Client cannot call the internal helper to bypass target privacy');
SELECT throws_ok($$SELECT messaging_private.require_actor(true)$$,'42501',NULL,'Actor-validation helper is not a public entry point');
SELECT throws_ok($$SELECT messaging_private.message_json(NULL::public.messages)$$,'42501',NULL,'Internal row projection is not externally callable');
SELECT throws_ok($$SELECT public.start_direct_conversation(pg_temp.uid(1))$$,'22023',NULL,'Self conversation is rejected');
SELECT throws_ok($$SELECT public.start_direct_conversation(NULL)$$,'22023',NULL,'Direct conversation requires a target');
SELECT throws_ok($$SELECT public.start_direct_conversation(pg_temp.uid(4))$$,'42501',NULL,'Private stranger cannot be contacted directly');
SELECT throws_ok($$SELECT public.start_direct_conversation(pg_temp.uid(10))$$,'42501',NULL,'Incomplete target cannot be contacted directly');
SELECT throws_ok($$SELECT public.start_direct_conversation(pg_temp.uid(9))$$,'42501',NULL,'Deleted target cannot be contacted directly');
INSERT INTO fixtures VALUES('ab',public.start_direct_conversation(pg_temp.uid(2)));
SELECT is(public.start_direct_conversation(pg_temp.uid(2)),pg_temp.fixture('ab'),'Repeated direct creation returns the same conversation');
SELECT is((SELECT count(*) FROM public.conversation_members WHERE conversation_id=pg_temp.fixture('ab')),1::bigint,'Caller reads only their own membership state');
SELECT is((SELECT profile_id FROM public.conversation_members WHERE conversation_id=pg_temp.fixture('ab')),pg_temp.uid(1),'Peer read cursor is not visible in raw membership rows');
SELECT is(public.get_conversation_summary(pg_temp.fixture('ab'))->>'other_profile_id',pg_temp.uid(2)::text,'Summary identifies the authorized other participant');
SELECT is(public.get_conversation_summary(pg_temp.fixture('ab'))->>'other_display_name','Message Tester 2','Summary exposes counterpart display name');
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(public.get_conversation_summary(pg_temp.fixture('ab'))) k),
 ARRAY['created_at','id','last_activity_at','last_message_at','last_message_body','last_message_sequence','last_read_sequence','other_display_name','other_profile_id','status','type','unread_count']::text[],
 'Summary exposes the approved fields without peer read cursor, email or account metadata');
SELECT is(public.get_conversation_summary(pg_temp.fixture('ab'))->>'type','direct','New conversation is direct');
SELECT is(public.get_conversation_summary(pg_temp.fixture('ab'))->>'status','active','New conversation is active');
SELECT is(public.get_conversation_summary(pg_temp.fixture('ab'))->>'last_message_sequence','0','Empty history starts with a text zero sequence');
SELECT is(public.get_conversation_summary(pg_temp.fixture('ab'))->>'last_read_sequence','0','New member starts with a text zero read cursor');
SELECT is((public.get_conversation_summary(pg_temp.fixture('ab'))->>'unread_count')::integer,0,'Empty conversation has no unread messages');
SELECT ok(public.get_conversation_summary(pg_temp.fixture('ab'))->>'last_message_body' IS NULL,'Empty conversation does not invent preview text');
SELECT is((SELECT count(*) FROM public.get_conversation_messages(pg_temp.fixture('ab'))),0::bigint,'Empty history returns an empty page');
SELECT is((SELECT count(*) FROM public.get_my_conversations()),1::bigint,'New conversation appears once in caller inbox');
SELECT pg_temp.login(2);
SELECT is(public.start_direct_conversation(pg_temp.uid(1)),pg_temp.fixture('ab'),'Reversed user pair reuses the same conversation');
SELECT is(public.get_conversation_summary(pg_temp.fixture('ab'))->>'other_profile_id',pg_temp.uid(1)::text,'Other participant receives their own counterpart summary');
SELECT pg_temp.login(3);
SELECT is((SELECT count(*) FROM public.conversations WHERE id=pg_temp.fixture('ab')),0::bigint,'Outsider cannot read raw conversation metadata');
SELECT is((SELECT count(*) FROM public.conversation_members WHERE conversation_id=pg_temp.fixture('ab')),0::bigint,'Outsider cannot enumerate members');
SELECT is((SELECT count(*) FROM public.direct_conversation_pairs WHERE conversation_id=pg_temp.fixture('ab')),0::bigint,'Outsider cannot enumerate direct pairs');
SELECT is((SELECT count(*) FROM public.get_my_conversations()),0::bigint,'Outsider inbox contains no unrelated conversations');
SELECT throws_ok($$SELECT public.get_conversation_summary(pg_temp.fixture('ab'))$$,'42501',NULL,'Knowing conversation ID does not authorize its summary');
SELECT throws_ok($$SELECT public.get_conversation_messages(pg_temp.fixture('ab'))$$,'42501',NULL,'Knowing conversation ID does not authorize history');
SELECT throws_ok($$SELECT public.send_conversation_message(pg_temp.fixture('ab'),pg_temp.client_id(1),'Intrusion')$$,'42501',NULL,'Outsider cannot send to a known conversation');
SELECT throws_ok($$SELECT public.mark_conversation_read(pg_temp.fixture('ab'),0)$$,'42501',NULL,'Outsider cannot modify a read cursor');

-- Membership, not current discoverability, controls an existing relationship.
RESET ROLE;
UPDATE public.profiles SET is_discoverable=false WHERE id IN (pg_temp.uid(1),pg_temp.uid(2));
SELECT is((SELECT count(*) FROM public.conversations WHERE id=pg_temp.fixture('ab')),1::bigint,'Reversed/repeated creation leaves one parent');
SELECT is((SELECT count(*) FROM public.conversation_members WHERE conversation_id=pg_temp.fixture('ab')),2::bigint,'Direct conversation has exactly two members');
SELECT ok((SELECT user_low_id<user_high_id FROM public.direct_conversation_pairs WHERE conversation_id=pg_temp.fixture('ab')),'Stored direct pair is normalized');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT is(public.start_direct_conversation(pg_temp.uid(2)),pg_temp.fixture('ab'),'Existing direct relationship remains accessible after target becomes private');
SELECT is(public.get_conversation_summary(pg_temp.fixture('ab'))->>'other_display_name','Message Tester 2','Private counterpart still has an authorized conversation display name');
INSERT INTO fixtures VALUES('ac',public.start_direct_conversation(pg_temp.uid(3)));

-- Retry keys belong to the sender across conversations and compare normalized text.
INSERT INTO sent VALUES('first',public.send_conversation_message(pg_temp.fixture('ab'),pg_temp.client_id(1),'  Hello campus  '));
SELECT is((SELECT value->>'body' FROM sent WHERE name='first'),'Hello campus','Message body is normalized before storage');
SELECT is((SELECT value->>'sender_id' FROM sent WHERE name='first'),pg_temp.uid(1)::text,'Server binds the message to the caller');
SELECT is((SELECT value->>'conversation_id' FROM sent WHERE name='first'),pg_temp.fixture('ab')::text,'Server binds the message to the authorized conversation');
SELECT is((SELECT value->>'sequence' FROM sent WHERE name='first'),'1','First message receives sequence one');
SELECT is((SELECT jsonb_typeof(value->'sequence') FROM sent WHERE name='first'),'string','Send returns bigint sequence as JSON text');
SELECT is(public.send_conversation_message(pg_temp.fixture('ab'),pg_temp.client_id(1),'Hello campus'),(SELECT value FROM sent WHERE name='first'),'Exact retry returns the original immutable message');
SELECT throws_ok($$SELECT public.send_conversation_message(pg_temp.fixture('ab'),pg_temp.client_id(1),'Changed body')$$,'22023',NULL,'Retry key cannot replace the original text');
SELECT throws_ok($$SELECT public.send_conversation_message(pg_temp.fixture('ac'),pg_temp.client_id(1),'Hello campus')$$,'22023',NULL,'Sender retry key cannot create a copy in a different conversation');
SELECT is(public.get_conversation_summary(pg_temp.fixture('ac'))->>'last_message_sequence','0','Conflicting conversation retry leaves its sequence unchanged');
SELECT is((SELECT count(*) FROM public.messages WHERE conversation_id=pg_temp.fixture('ab')),1::bigint,'Retries and conflicts leave one message');
SELECT is((public.get_conversation_summary(pg_temp.fixture('ab'))->>'unread_count')::integer,0,'Own send never counts as unread');
SELECT pg_temp.login(2);
SELECT is((public.get_conversation_summary(pg_temp.fixture('ab'))->>'unread_count')::integer,1,'Incoming message increments only receiver unread count');
SELECT is(public.get_conversation_summary(pg_temp.fixture('ab'))->>'last_message_body','Hello campus','Summary preview follows persisted latest message');
INSERT INTO sent VALUES('reply',public.send_conversation_message(pg_temp.fixture('ab'),pg_temp.client_id(1),'Hello back'));
SELECT is((SELECT value->>'sequence' FROM sent WHERE name='reply'),'2','Second participant send advances the same conversation sequence');
SELECT is((SELECT value->>'sender_id' FROM sent WHERE name='reply'),pg_temp.uid(2)::text,'Two senders may reuse the same client UUID independently');
SELECT is((public.get_conversation_summary(pg_temp.fixture('ab'))->>'unread_count')::integer,1,'Sending a reply does not count the reply as incoming unread');
SELECT pg_temp.login(1);
SELECT is((public.get_conversation_summary(pg_temp.fixture('ab'))->>'unread_count')::integer,1,'Original sender sees the incoming reply as unread');
SELECT throws_ok($$SELECT public.send_conversation_message(pg_temp.fixture('ab'),NULL,'Missing key')$$,'22023',NULL,'Send requires a client idempotency UUID');
SELECT throws_ok($$SELECT public.send_conversation_message(pg_temp.fixture('ab'),pg_temp.client_id(3),NULL)$$,'22023',NULL,'Null message text is rejected');
SELECT throws_ok($$SELECT public.send_conversation_message(pg_temp.fixture('ab'),pg_temp.client_id(3),'')$$,'22023',NULL,'Empty message text is rejected');
SELECT throws_ok($$SELECT public.send_conversation_message(pg_temp.fixture('ab'),pg_temp.client_id(3),'   ')$$,'22023',NULL,'Space-only text is rejected');
SELECT throws_ok($$SELECT public.send_conversation_message(pg_temp.fixture('ab'),pg_temp.client_id(3),E'\n\t\r')$$,'22023',NULL,'Whitespace-only text is rejected');
SELECT throws_ok($$SELECT public.send_conversation_message(pg_temp.fixture('ab'),pg_temp.client_id(3),repeat('x',4001))$$,'22023',NULL,'Messages over 4000 characters are rejected');
INSERT INTO sent VALUES('boundary',public.send_conversation_message(pg_temp.fixture('ab'),pg_temp.client_id(3),repeat('x',4000)));
SELECT is((SELECT char_length(value->>'body') FROM sent WHERE name='boundary'),4000,'Exactly 4000 characters are allowed');
INSERT INTO sent VALUES('unicode',public.send_conversation_message(pg_temp.fixture('ab'),pg_temp.client_id(4),repeat('é',4000)));
SELECT is((SELECT char_length(value->>'body') FROM sent WHERE name='unicode'),4000,'Character limit does not mistake multibyte characters for multiple characters');
SELECT is(public.get_conversation_summary(pg_temp.fixture('ab'))->>'last_message_sequence','4','Invalid messages do not consume sequences');
SELECT is((SELECT array_agg(sequence) FROM public.get_conversation_messages(pg_temp.fixture('ab'),NULL,2)),ARRAY['4','3']::text[],'History starts with newest messages in descending sequence order');
SELECT is((SELECT array_agg(sequence) FROM public.get_conversation_messages(pg_temp.fixture('ab'),3,2)),ARRAY['2','1']::text[],'Older-history cursor is exclusive and preserves stable order');
SELECT is((SELECT count(*) FROM public.get_conversation_messages(pg_temp.fixture('ab'),1,2)),0::bigint,'Cursor before the oldest sequence returns no messages');
SELECT throws_ok($$SELECT public.get_conversation_messages(pg_temp.fixture('ab'),NULL,0)$$,'22023',NULL,'History page size must be positive');
SELECT throws_ok($$SELECT public.get_conversation_messages(pg_temp.fixture('ab'),NULL,51)$$,'22023',NULL,'History page size is bounded');
SELECT throws_ok($$SELECT public.get_conversation_messages(pg_temp.fixture('ab'),NULL,NULL)$$,'22023',NULL,'Null history page size is rejected');
SELECT throws_ok($$SELECT public.get_conversation_messages(pg_temp.fixture('ab'),-1,30)$$,'22023',NULL,'Negative history cursor is rejected');

-- Read cursors are own-only, monotonic, bounded by real observed messages.
SELECT is(public.mark_conversation_read(pg_temp.fixture('ab'),0),'0','Initial zero read cursor is a safe no-op');
SELECT is(public.mark_conversation_read(pg_temp.fixture('ab'),2),'2','Caller can mark through an existing message');
SELECT is((public.get_conversation_summary(pg_temp.fixture('ab'))->>'unread_count')::integer,0,'Reading the incoming reply clears unread despite later own messages');
SELECT is(public.mark_conversation_read(pg_temp.fixture('ab'),1),'2','Delayed older read cannot regress the cursor');
SELECT is(public.mark_conversation_read(pg_temp.fixture('ab'),2),'2','Exact read retry is idempotent');
SELECT throws_ok($$SELECT public.mark_conversation_read(pg_temp.fixture('ab'),5)$$,'22023',NULL,'Future cursor cannot mark future incoming messages read');
SELECT throws_ok($$SELECT public.mark_conversation_read(pg_temp.fixture('ac'),1)$$,'22023',NULL,'Another conversation sequence is not a valid read cursor');
SELECT throws_ok($$SELECT public.mark_conversation_read(pg_temp.fixture('ab'),-1)$$,'22023',NULL,'Negative read cursor is rejected');
SELECT throws_ok($$SELECT public.mark_conversation_read(pg_temp.fixture('ab'),NULL)$$,'22023',NULL,'Null read cursor is rejected');
SELECT pg_temp.login(2);
SELECT is(public.get_conversation_summary(pg_temp.fixture('ab'))->>'last_read_sequence','0','Peer marking read does not change this member cursor');
SELECT is((public.get_conversation_summary(pg_temp.fixture('ab'))->>'unread_count')::integer,3,'Unread counts incoming messages rather than sequence difference');
SELECT is(public.mark_conversation_read(pg_temp.fixture('ab'),3),'3','Receiver can acknowledge a partial loaded page');
SELECT is((public.get_conversation_summary(pg_temp.fixture('ab'))->>'unread_count')::integer,1,'One newer incoming message remains unread after partial read');
SELECT is(public.mark_conversation_read(pg_temp.fixture('ab'),4),'4','Receiver can acknowledge the latest loaded message');
SELECT is((public.get_conversation_summary(pg_temp.fixture('ab'))->>'unread_count')::integer,0,'All incoming messages have now been read');
SELECT pg_temp.login(3);
SELECT is((SELECT count(*) FROM public.messages WHERE conversation_id=pg_temp.fixture('ab')),0::bigint,'Raw message reads do not leak another conversation');

-- Public clients cannot fabricate membership, message identity, sequence, or read state.
SELECT pg_temp.login(1);
SELECT throws_ok($$INSERT INTO public.conversation_members(conversation_id,profile_id) VALUES(pg_temp.fixture('ab'),pg_temp.uid(3))$$,'42501',NULL,'Member cannot add a third person through table writes');
SELECT throws_ok($$UPDATE public.conversation_members SET last_read_sequence=999 WHERE conversation_id=pg_temp.fixture('ab')$$,'42501',NULL,'Member cannot bypass read validation with direct updates');
SELECT throws_ok($$DELETE FROM public.conversation_members WHERE conversation_id=pg_temp.fixture('ab')$$,'42501',NULL,'Member cannot remove the peer or themselves through raw writes');
SELECT throws_ok($$INSERT INTO public.messages(conversation_id,sender_id,client_message_id,sequence,body) VALUES(pg_temp.fixture('ab'),pg_temp.uid(2),pg_temp.client_id(5),500,'Impersonated')$$,'42501',NULL,'Direct write cannot impersonate sender or choose sequence');
SELECT throws_ok($$UPDATE public.messages SET body='Edited' WHERE conversation_id=pg_temp.fixture('ab')$$,'42501',NULL,'Sent message text is immutable to clients');
SELECT throws_ok($$DELETE FROM public.messages WHERE conversation_id=pg_temp.fixture('ab')$$,'42501',NULL,'Clients cannot delete history');
SELECT throws_ok($$UPDATE public.conversations SET status='removed' WHERE id=pg_temp.fixture('ab')$$,'42501',NULL,'Members cannot directly alter conversation lifecycle');

-- Roll back a failure after sequence reservation, including summary/cursor state.
RESET ROLE;
INSERT INTO snapshots VALUES('ab-before-failure',(SELECT to_jsonb(c) FROM public.conversations c WHERE id=pg_temp.fixture('ab')));
CREATE FUNCTION pg_temp.fail_message_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.client_message_id=pg_temp.client_id(99) THEN RAISE EXCEPTION 'test message persistence failure' USING errcode='P0001'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER test_message_failure BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_message_insert();
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT throws_ok($$SELECT public.send_conversation_message(pg_temp.fixture('ab'),pg_temp.client_id(99),'Will retry')$$,'P0001','test message persistence failure','Message failure rolls back the complete send operation');
SELECT is(public.get_conversation_summary(pg_temp.fixture('ab'))->>'last_message_sequence','4','Failed insert does not consume a conversation sequence');
SELECT is((SELECT count(*) FROM public.messages WHERE conversation_id=pg_temp.fixture('ab')),4::bigint,'Failed send leaves no partial history row');
RESET ROLE;
SELECT is((SELECT to_jsonb(c) FROM public.conversations c WHERE id=pg_temp.fixture('ab')),(SELECT value FROM snapshots WHERE name='ab-before-failure'),'Failed send restores all conversation metadata');
DROP TRIGGER test_message_failure ON public.messages;
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT is(public.send_conversation_message(pg_temp.fixture('ab'),pg_temp.client_id(99),'Will retry')->>'sequence','5','Failed client UUID may retry successfully without a sequence gap');

-- Parent/pair/members are atomic: an injected second-member failure leaves none.
RESET ROLE;
INSERT INTO snapshots VALUES('conversation-count',to_jsonb((SELECT count(*) FROM public.conversations WHERE created_by IN (SELECT pg_temp.uid(i) FROM generate_series(1,10) i))));
CREATE FUNCTION pg_temp.fail_message_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.profile_id=pg_temp.uid(7) THEN RAISE EXCEPTION 'test membership persistence failure' USING errcode='P0001'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER test_member_failure BEFORE INSERT ON public.conversation_members FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_message_membership();
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT throws_ok($$SELECT public.start_direct_conversation(pg_temp.uid(7))$$,'P0001','test membership persistence failure','Membership failure rolls back direct conversation creation');
RESET ROLE;
SELECT is(to_jsonb((SELECT count(*) FROM public.conversations WHERE created_by IN (SELECT pg_temp.uid(i) FROM generate_series(1,10) i))),(SELECT value FROM snapshots WHERE name='conversation-count'),'Failed membership creates no orphan conversation');
SELECT is((SELECT count(*) FROM public.direct_conversation_pairs WHERE user_low_id=least(pg_temp.uid(1),pg_temp.uid(7)) AND user_high_id=greatest(pg_temp.uid(1),pg_temp.uid(7))),0::bigint,'Failed membership creates no orphan pair');
DROP TRIGGER test_member_failure ON public.conversation_members;
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
INSERT INTO fixtures VALUES('ag',public.start_direct_conversation(pg_temp.uid(7))),('af',public.start_direct_conversation(pg_temp.uid(6)));

-- Inbox uses both activity timestamp and UUID for deterministic keyset paging.
RESET ROLE;
UPDATE public.conversations SET created_at='2026-01-01T00:00:00Z',last_message_at=CASE WHEN last_message_sequence>0 THEN '2026-01-01T00:00:00Z'::timestamptz ELSE NULL END
WHERE id IN (SELECT id FROM fixtures WHERE name IN ('ab','ac','ag','af'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT is((SELECT array_agg(id) FROM public.get_my_conversations(2)),
 (SELECT array_agg(id ORDER BY id DESC) FROM (SELECT id FROM fixtures WHERE name IN ('ab','ac','ag','af') ORDER BY id DESC LIMIT 2) page),'Inbox tie-breaker returns the first two UUIDs descending');
SELECT is((SELECT array_agg(id) FROM public.get_my_conversations(2,'2026-01-01T00:00:00Z',(SELECT id FROM fixtures WHERE name IN ('ab','ac','ag','af') ORDER BY id DESC OFFSET 1 LIMIT 1))),
 (SELECT array_agg(id ORDER BY id DESC) FROM (SELECT id FROM fixtures WHERE name IN ('ab','ac','ag','af') ORDER BY id DESC OFFSET 2 LIMIT 2) page),'Inbox cursor retrieves the remaining tied conversations without duplicates');
SELECT throws_ok($$SELECT public.get_my_conversations(0)$$,'22023',NULL,'Inbox page size must be positive');
SELECT throws_ok($$SELECT public.get_my_conversations(51)$$,'22023',NULL,'Inbox page size is bounded');
SELECT throws_ok($$SELECT public.get_my_conversations(NULL)$$,'22023',NULL,'Null inbox page size is rejected');
SELECT throws_ok($$SELECT public.get_my_conversations(20,clock_timestamp(),NULL)$$,'22023',NULL,'Inbox cursor timestamp requires its tie-breaker ID');
SELECT throws_ok($$SELECT public.get_my_conversations(20,NULL,pg_temp.fixture('ab'))$$,'22023',NULL,'Inbox cursor ID requires its activity timestamp');
SELECT throws_ok($$SELECT public.get_my_conversations(20,'infinity',pg_temp.fixture('ab'))$$,'22023',NULL,'Inbox rejects non-finite activity cursors');

-- Exercise bigint values beyond JavaScript's safe integer range without a huge fixture.
RESET ROLE;
UPDATE public.conversations SET last_message_sequence=9007199254740991,last_message_at=clock_timestamp() WHERE id=pg_temp.fixture('ag');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT is(public.send_conversation_message(pg_temp.fixture('ag'),pg_temp.client_id(20),'High sequence one')->>'sequence','9007199254740992','Send preserves sequence at the JavaScript precision boundary as text');
SELECT is(public.send_conversation_message(pg_temp.fixture('ag'),pg_temp.client_id(21),'High sequence two')->>'sequence','9007199254740993','Next bigint sequence remains distinct beyond JavaScript integer precision');
SELECT is((SELECT array_agg(sequence) FROM public.get_conversation_messages(pg_temp.fixture('ag'))),ARRAY['9007199254740993','9007199254740992']::text[],'History preserves both large sequence strings exactly');
SELECT is((SELECT last_message_sequence FROM public.get_my_conversations() WHERE id=pg_temp.fixture('ag')),'9007199254740993','Inbox preserves the exact large sequence');
SELECT pg_temp.login(7);
SELECT throws_ok($$SELECT public.mark_conversation_read(pg_temp.fixture('ag'),9007199254740991)$$,'22023',NULL,'Cursor cannot target a nonexistent sequence even below the current maximum');
SELECT is(public.mark_conversation_read(pg_temp.fixture('ag'),9007199254740992),'9007199254740992','Read acknowledgement preserves the exact bigint cursor');
SELECT is((public.get_conversation_summary(pg_temp.fixture('ag'))->>'unread_count')::integer,1,'Reading a large sequence does not silently swallow its adjacent incoming message');

-- Request conversations use the verified assignment round, never pending offers.
SELECT pg_temp.login(5);
INSERT INTO fixtures VALUES('request',public.save_my_request(pg_temp.payload()));
SELECT pg_temp.login(4);
INSERT INTO fixtures VALUES('old-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('request'),1,10));
SELECT throws_ok($$SELECT public.open_request_conversation(pg_temp.fixture('request'),1)$$,'42501',NULL,'Pending helper cannot open a request conversation');
SELECT pg_temp.login(6);
INSERT INTO fixtures VALUES('replacement-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('request'),1,10));
SELECT pg_temp.login(5);
SELECT throws_ok($$SELECT public.open_request_conversation(pg_temp.fixture('request'),1)$$,'42501',NULL,'Poster cannot create a participant relationship before acceptance');
SELECT public.decide_request_offer_for_round(pg_temp.fixture('old-offer'),'accepted',1,10);
RESET ROLE;
UPDATE public.profiles SET is_discoverable=false WHERE id IN (pg_temp.uid(5),pg_temp.uid(6));
INSERT INTO snapshots VALUES('assignment-before-message',jsonb_build_object(
 'request',(SELECT to_jsonb(r) FROM public.requests r WHERE id=pg_temp.fixture('request')),
 'reservations',(SELECT jsonb_agg(to_jsonb(r)) FROM public.request_point_reservations r WHERE request_id=pg_temp.fixture('request')),
 'wallets',(SELECT jsonb_agg(to_jsonb(w) ORDER BY profile_id) FROM public.points_wallets w WHERE profile_id IN (pg_temp.uid(4),pg_temp.uid(5),pg_temp.uid(6))),
 'ledger',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.points_ledger l WHERE profile_id IN (pg_temp.uid(4),pg_temp.uid(5),pg_temp.uid(6)))));
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(5);
INSERT INTO fixtures VALUES('request-round1',public.open_request_conversation(pg_temp.fixture('request'),1));
SELECT pg_temp.login(4);
SELECT is(public.open_request_conversation(pg_temp.fixture('request'),1),pg_temp.fixture('request-round1'),'Both assignment participants reuse one authorized request conversation');
SELECT is(public.get_conversation_summary(pg_temp.fixture('request-round1'))->>'other_profile_id',pg_temp.uid(5)::text,'Accepted assignment permits private counterpart summary');
SELECT lives_ok($$SELECT public.send_conversation_message(pg_temp.fixture('request-round1'),pg_temp.client_id(10),'About our assignment')$$,'Private assignment participants can exchange messages');
SELECT is(public.start_direct_conversation(pg_temp.uid(5)),pg_temp.fixture('request-round1'),'An assignment-created pair is reused by normal direct lookup');
SELECT pg_temp.login(6);
SELECT throws_ok($$SELECT public.open_request_conversation(pg_temp.fixture('request'),1)$$,'42501',NULL,'Rejected helper cannot use selected assignment conversation');
SELECT throws_ok($$SELECT public.get_conversation_messages(pg_temp.fixture('request-round1'))$$,'42501',NULL,'Rejected helper cannot read selected assignment messages');
SELECT is((SELECT count(*) FROM public.request_conversations WHERE request_id=pg_temp.fixture('request')),0::bigint,'Raw association rows do not leak another helper relationship');
RESET ROLE;
SELECT is(jsonb_build_object(
 'request',(SELECT to_jsonb(r) FROM public.requests r WHERE id=pg_temp.fixture('request')),
 'reservations',(SELECT jsonb_agg(to_jsonb(r)) FROM public.request_point_reservations r WHERE request_id=pg_temp.fixture('request')),
 'wallets',(SELECT jsonb_agg(to_jsonb(w) ORDER BY profile_id) FROM public.points_wallets w WHERE profile_id IN (pg_temp.uid(4),pg_temp.uid(5),pg_temp.uid(6))),
 'ledger',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.points_ledger l WHERE profile_id IN (pg_temp.uid(4),pg_temp.uid(5),pg_temp.uid(6)))),
 (SELECT value FROM snapshots WHERE name='assignment-before-message'),'Opening and sending request messages do not alter existing assignment, points or ledger state');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(4);
SELECT public.cancel_my_accepted_help(pg_temp.fixture('request'),1);
SELECT is(public.open_request_conversation(pg_temp.fixture('request'),1),pg_temp.fixture('request-round1'),'Released historical assignment retains conversation access');
SELECT pg_temp.login(6);
SELECT public.renew_my_request_offer_for_terms(pg_temp.fixture('replacement-offer'),2,10);
SELECT pg_temp.login(5);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('replacement-offer'),'accepted',2,10);
INSERT INTO fixtures VALUES('request-round2',public.open_request_conversation(pg_temp.fixture('request'),2));
SELECT isnt(pg_temp.fixture('request-round2'),pg_temp.fixture('request-round1'),'Replacement helper receives a different direct conversation');
SELECT public.reopen_my_request(pg_temp.fixture('request'),2,'2099-02-01T00:00:00Z');
SELECT pg_temp.login(4);
SELECT public.renew_my_request_offer_for_terms(pg_temp.fixture('old-offer'),3,10);
SELECT throws_ok($$SELECT public.open_request_conversation(pg_temp.fixture('request'),2)$$,'42501',NULL,'Original helper cannot access replacement assignment history');
SELECT pg_temp.login(5);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('old-offer'),'accepted',3,10);
SELECT is(public.open_request_conversation(pg_temp.fixture('request'),3),pg_temp.fixture('request-round1'),'Returning helper reuses their existing private direct conversation');
SELECT public.complete_my_request(pg_temp.fixture('request'),3);
SELECT public.set_my_request_archived(pg_temp.fixture('request'),true);
SELECT pg_temp.login(4);
SELECT is(public.open_request_conversation(pg_temp.fixture('request'),3),pg_temp.fixture('request-round1'),'Completed archived assignment remains linked');
SELECT is((SELECT count(*) FROM public.get_conversation_messages(pg_temp.fixture('request-round1'))),1::bigint,'Old message history survives replacement, completion and archive');
SELECT lives_ok($$SELECT public.send_conversation_message(pg_temp.fixture('request-round1'),pg_temp.client_id(11),'After the task')$$,'Existing direct relationship can continue after request completion');
SELECT pg_temp.login(6);
SELECT is(public.open_request_conversation(pg_temp.fixture('request'),2),pg_temp.fixture('request-round2'),'Replacement helper retains their own released round');
SELECT throws_ok($$SELECT public.open_request_conversation(pg_temp.fixture('request'),3)$$,'42501',NULL,'Replacement helper cannot access returning helper completed round');
SELECT throws_ok($$SELECT public.get_conversation_summary(pg_temp.fixture('request-round1'))$$,'42501',NULL,'Replacement helper cannot access the old pair summary');
SELECT pg_temp.login(5);
SELECT throws_ok($$SELECT public.open_request_conversation(pg_temp.fixture('request'),0)$$,'22023',NULL,'Request conversation requires a positive reviewed round');
SELECT throws_ok($$SELECT public.open_request_conversation(pg_temp.fixture('request'),NULL)$$,'22023',NULL,'Request conversation requires an explicit reviewed round');
SELECT throws_ok($$SELECT public.open_request_conversation(pg_temp.fixture('request'),4)$$,'42501',NULL,'Unassigned future round cannot create a conversation');
SELECT throws_ok($$INSERT INTO public.request_conversations(request_id,offer_round,conversation_id,poster_id,helper_id) VALUES(pg_temp.fixture('request'),4,pg_temp.fixture('ab'),pg_temp.uid(5),pg_temp.uid(1))$$,'42501',NULL,'Client cannot forge a request-to-conversation association');

-- Closed history is readable and supports exact retries; removed threads do not.
RESET ROLE;
UPDATE public.conversations SET status='closed' WHERE id=pg_temp.fixture('ab');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT is((SELECT count(*) FROM public.get_conversation_messages(pg_temp.fixture('ab'))),5::bigint,'Closed conversation retains readable history');
SELECT is(public.send_conversation_message(pg_temp.fixture('ab'),pg_temp.client_id(1),'Hello campus'),(SELECT value FROM sent WHERE name='first'),'Closed conversation still resolves a successful exact retry');
SELECT throws_ok($$SELECT public.send_conversation_message(pg_temp.fixture('ab'),pg_temp.client_id(6),'New after closure')$$,'55000',NULL,'Closed conversation rejects new sends');
SELECT is(public.mark_conversation_read(pg_temp.fixture('ab'),5),'5','Closed readable history still allows own read acknowledgements');
RESET ROLE;
UPDATE public.conversations SET status='removed' WHERE id=pg_temp.fixture('ab');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT throws_ok($$SELECT public.get_conversation_summary(pg_temp.fixture('ab'))$$,'42501',NULL,'Removed conversation summary is unavailable');
SELECT throws_ok($$SELECT public.get_conversation_messages(pg_temp.fixture('ab'))$$,'42501',NULL,'Removed conversation history is unavailable');
SELECT throws_ok($$SELECT public.send_conversation_message(pg_temp.fixture('ab'),pg_temp.client_id(1),'Hello campus')$$,'42501',NULL,'Removed conversation does not bypass access checks through idempotency');
SELECT throws_ok($$SELECT public.mark_conversation_read(pg_temp.fixture('ab'),5)$$,'42501',NULL,'Removed conversation read state cannot be changed');
SELECT is((SELECT count(*) FROM public.get_my_conversations() WHERE id=pg_temp.fixture('ab')),0::bigint,'Removed conversation is excluded from inbox');
SELECT pg_temp.login(9);
SELECT throws_ok($$SELECT public.get_my_conversations()$$,'42501',NULL,'Deleted caller cannot list conversations with a stale token identity');
SELECT throws_ok($$SELECT public.get_conversation_messages(pg_temp.fixture('ac'))$$,'42501',NULL,'Deleted caller cannot fetch history');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT throws_ok($$SELECT public.get_my_conversations()$$,'42501',NULL,'Missing identity cannot list inbox');
SELECT throws_ok($$SELECT public.start_direct_conversation(pg_temp.uid(2))$$,'42501',NULL,'Missing identity cannot create a direct pair');
SELECT throws_ok($$SELECT public.open_request_conversation(pg_temp.fixture('request'),1)$$,'42501',NULL,'Missing identity cannot open assignment conversation');
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.get_my_conversations()$$,'42501',NULL,'Anonymous inbox API is denied');
SELECT throws_ok($$SELECT public.send_conversation_message(pg_temp.fixture('ac'),pg_temp.client_id(1),'Anon')$$,'42501',NULL,'Anonymous send API is denied');
SELECT throws_ok($$SELECT * FROM public.messages$$,'42501',NULL,'Anonymous raw message table is denied');
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT * FROM finish();
ROLLBACK;
