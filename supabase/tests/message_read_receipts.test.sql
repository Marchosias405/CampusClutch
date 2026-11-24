BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT no_plan();
INSERT INTO auth.users(id,email)
SELECT ('e311e311-e311-4311-8311-'||lpad(i::text,12,'0'))::uuid,
  'receipts-'||i||'@test.local' FROM generate_series(1,3) i;
CREATE FUNCTION pg_temp.uid(i integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('e311e311-e311-4311-8311-'||lpad(i::text,12,'0'))::uuid;
$$;
CREATE FUNCTION pg_temp.login(i integer) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub',pg_temp.uid(i)::text,true);
$$;
UPDATE public.profiles SET display_name='Receipt Tester',major='Testing',year_of_study=2,
  campus_id=(SELECT id FROM public.campuses WHERE slug='burnaby'),is_discoverable=true,
  onboarding_completed_at=clock_timestamp()
WHERE id IN (SELECT pg_temp.uid(i) FROM generate_series(1,3) i);
CREATE TEMP TABLE fixtures(name text PRIMARY KEY,id uuid);
GRANT ALL ON fixtures TO authenticated;
CREATE FUNCTION pg_temp.fixture(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM fixtures WHERE name=n; $$;
CREATE FUNCTION pg_temp.receipt(n text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT to_jsonb(r) FROM public.get_message_read_receipts(pg_temp.fixture('chat'),ARRAY[pg_temp.fixture(n)]) r;
$$;

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='messaging_private.direct_message_reads'::regclass),'Receipt storage has RLS');
SELECT ok(NOT has_table_privilege('authenticated','messaging_private.direct_message_reads','SELECT'),'No direct client receipt reads');
SELECT ok(NOT has_table_privilege('authenticated','messaging_private.direct_message_reads','INSERT,UPDATE,DELETE'),'No direct client receipt writes');
SELECT ok(NOT has_function_privilege('anon','public.get_message_read_receipts(uuid,uuid[])','EXECUTE'),'Anonymous receipt RPC denied');
SELECT ok(NOT has_function_privilege('authenticated','messaging_private.record_direct_message_reads()','EXECUTE'),'Client cannot call receipt writer');
SELECT ok(NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.get_message_read_receipts(uuid,uuid[])'::regprocedure),'Public wrapper is an invoker');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
INSERT INTO fixtures VALUES('chat',public.start_direct_conversation(pg_temp.uid(2)));
INSERT INTO fixtures VALUES('first',(public.send_conversation_message(pg_temp.fixture('chat'),gen_random_uuid(),'First')->>'id')::uuid);
INSERT INTO fixtures VALUES('second',(public.send_conversation_message(pg_temp.fixture('chat'),gen_random_uuid(),'Second')->>'id')::uuid);
SELECT is(pg_temp.receipt('first')->>'is_read','false','Newly sent message is not read');
SELECT is(pg_temp.receipt('first')->>'read_at',NULL::text,'Unread message has no read time');
SELECT public.mark_conversation_read(pg_temp.fixture('chat'),2);
SELECT is(pg_temp.receipt('first')->>'is_read','false','Sender reading their own thread is not a peer receipt');
SELECT pg_temp.login(2);
SELECT public.mark_all_my_notifications_read();
SELECT pg_temp.login(1);
SELECT is(pg_temp.receipt('first')->>'is_read','false','Mark-all bell notices does not mark a chat read');
SELECT pg_temp.login(2);
SELECT public.mark_conversation_read(pg_temp.fixture('chat'),1);
SELECT pg_temp.login(1);
SELECT is(pg_temp.receipt('first')->>'is_read','true','Peer acknowledging first message sets read state');
SELECT ok((pg_temp.receipt('first')->>'read_at')::timestamptz >= (SELECT created_at FROM public.messages WHERE id=pg_temp.fixture('first')),'Read time is recorded by the server after send');
SELECT is(pg_temp.receipt('second')->>'is_read','false','Later message stays unread');
CREATE TEMP TABLE first_read AS SELECT pg_temp.receipt('first')->>'read_at' AS value;
SELECT pg_temp.login(2);
SELECT public.mark_conversation_read(pg_temp.fixture('chat'),1);
SELECT public.mark_conversation_read(pg_temp.fixture('chat'),0);
SELECT public.mark_conversation_read(pg_temp.fixture('chat'),2);
SELECT pg_temp.login(1);
SELECT is(pg_temp.receipt('first')->>'read_at',(SELECT value FROM first_read),'Retry, rewind and later reads preserve first read time');
SELECT is(pg_temp.receipt('second')->>'is_read','true','Second message receives a receipt after advancing');
SELECT ok((pg_temp.receipt('second')->>'read_at')::timestamptz >= (SELECT value::timestamptz FROM first_read),'Later read time is not earlier than first');
SELECT throws_ok($$SELECT public.get_message_read_receipts(pg_temp.fixture('chat'),'{}'::uuid[])$$,'22023',NULL,'Empty batches rejected');
SELECT throws_ok($$SELECT public.get_message_read_receipts(pg_temp.fixture('chat'),NULL)$$,'22023',NULL,'Null batches rejected');
SELECT throws_ok($$SELECT public.get_message_read_receipts(pg_temp.fixture('chat'),ARRAY[NULL::uuid])$$,'22023',NULL,'Null message IDs rejected');
SELECT throws_ok($$SELECT public.get_message_read_receipts(pg_temp.fixture('chat'),ARRAY[pg_temp.fixture('first'),pg_temp.fixture('first')])$$,'22023',NULL,'Duplicate IDs rejected');
SELECT throws_ok($$SELECT public.get_message_read_receipts(pg_temp.fixture('chat'),ARRAY(SELECT gen_random_uuid() FROM generate_series(1,51)))$$,'22023',NULL,'Oversized batches rejected');
SELECT throws_ok($$SELECT public.get_message_read_receipts(pg_temp.fixture('chat'),ARRAY[gen_random_uuid()])$$,'42501',NULL,'Unknown messages rejected');
SELECT pg_temp.login(2);
SELECT throws_ok($$SELECT pg_temp.receipt('first')$$,'42501',NULL,'Receipts are queried by the original sender only');
INSERT INTO fixtures VALUES('reply',(public.send_conversation_message(pg_temp.fixture('chat'),gen_random_uuid(),'Reply')->>'id')::uuid);
SELECT is(pg_temp.receipt('reply')->>'is_read','false','Reverse-direction message starts unread');
SELECT pg_temp.login(1);
SELECT public.mark_conversation_read(pg_temp.fixture('chat'),3);
SELECT pg_temp.login(2);
SELECT is(pg_temp.receipt('reply')->>'is_read','true','Receipts work in both directions');
SELECT pg_temp.login(3);
SELECT throws_ok($$SELECT pg_temp.receipt('first')$$,'42501',NULL,'Outsider with known IDs denied');
INSERT INTO fixtures VALUES('other-chat',public.start_direct_conversation(pg_temp.uid(1)));
SELECT pg_temp.login(1);
SELECT throws_ok($$SELECT public.get_message_read_receipts(pg_temp.fixture('other-chat'),ARRAY[pg_temp.fixture('first')])$$,'42501',NULL,'Known own message from another conversation denied');
RESET ROLE;
-- Simulate an already-read pre-feature message: keep its cursor but remove the
-- timestamp fixture. No backfill may invent a first-read time.
DELETE FROM messaging_private.direct_message_reads WHERE message_id=pg_temp.fixture('first');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT is(pg_temp.receipt('first')->>'is_read','true','Legacy cursor still reports Read');
SELECT is(pg_temp.receipt('first')->>'read_at',NULL::text,'Legacy read has no fabricated time');
RESET ROLE;
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=pg_temp.uid(1);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT pg_temp.receipt('first')$$,'42501',NULL,'Banned actor with stale JWT denied');
RESET ROLE;
UPDATE auth.users SET banned_until=NULL,deleted_at=now() WHERE id=pg_temp.uid(1);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT pg_temp.receipt('first')$$,'42501',NULL,'Deleted actor with stale JWT denied');
RESET ROLE;
UPDATE auth.users SET deleted_at=NULL WHERE id=pg_temp.uid(1);
UPDATE public.conversations SET status='closed' WHERE id=pg_temp.fixture('chat');
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.receipt('first')->>'is_read','true','Closed direct history retains receipts');
RESET ROLE;
UPDATE public.conversations SET status='removed' WHERE id=pg_temp.fixture('chat');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT pg_temp.receipt('first')$$,'42501',NULL,'Removed conversation receipts denied');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
