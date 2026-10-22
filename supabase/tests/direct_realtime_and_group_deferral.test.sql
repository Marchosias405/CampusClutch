BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT no_plan();

INSERT INTO auth.users(id,email)
SELECT ('e110e110-e110-4110-8110-'||lpad(i::text,12,'0'))::uuid,
  'direct-realtime-'||i||'@test.local' FROM generate_series(1,6) i;
CREATE FUNCTION pg_temp.uid(i integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('e110e110-e110-4110-8110-'||lpad(i::text,12,'0'))::uuid;
$$;
CREATE FUNCTION pg_temp.login(i integer) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub',pg_temp.uid(i)::text,true);
$$;
UPDATE public.profiles SET display_name='Realtime Tester',major='Testing',year_of_study=2,
  campus_id=(SELECT id FROM public.campuses WHERE slug='burnaby'),is_discoverable=true,
  onboarding_completed_at=clock_timestamp()
WHERE id IN (SELECT pg_temp.uid(i) FROM generate_series(1,5) i);
UPDATE auth.users SET deleted_at=now() WHERE id=pg_temp.uid(4);
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=pg_temp.uid(5);

CREATE TEMP TABLE fixtures(name text PRIMARY KEY,id uuid);
GRANT ALL ON fixtures TO authenticated;
CREATE FUNCTION pg_temp.fixture(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM fixtures WHERE name=n; $$;

-- Persisted pre-deferral group data is deliberately retained. Seed via owner
-- SQL rather than re-enabling a revoked API for an application caller.
INSERT INTO public.academic_terms(id,code,display_name,year,season,starts_on,ends_on,status)
VALUES ('e120e120-e120-4120-8120-000000000001','2102-fall','Fall 2102',2102,'fall','2102-09-01','2102-12-31','current');
INSERT INTO public.courses(id,code,title,term_id,campus_id,status)
VALUES ('e130e130-e130-4130-8130-000000000001','CMPT 411','Deferred Group',
  'e120e120-e120-4120-8120-000000000001',(SELECT id FROM public.campuses WHERE slug='burnaby'),'active');
INSERT INTO public.course_memberships(course_id,profile_id,status)
SELECT 'e130e130-e130-4130-8130-000000000001',pg_temp.uid(i),'enrolled' FROM generate_series(1,2) i;
SELECT pg_temp.login(1);
INSERT INTO fixtures VALUES ('group',messaging_private.create_group(
  gen_random_uuid(),'e130e130-e130-4130-8130-000000000001','Preserved group',ARRAY[pg_temp.uid(2)]));
SELECT pg_temp.login(2);
SELECT messaging_private.respond_group_invitation(
  (SELECT id FROM public.group_conversation_invitations WHERE conversation_id=pg_temp.fixture('group')),'accepted');
INSERT INTO public.messages(conversation_id,sender_id,client_message_id,sequence,body)
VALUES(pg_temp.fixture('group'),pg_temp.uid(1),gen_random_uuid(),1,'Preserved group history');
UPDATE public.conversations SET last_message_sequence=1,last_message_at=clock_timestamp()
WHERE id=pg_temp.fixture('group');

SELECT ok(NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
  AND NOT has_function_privilege('anon',p.oid,'EXECUTE'),
  'Deferred group entry point is inaccessible: '||n.nspname||'.'||p.proname)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE (n.nspname='public' AND p.proname IN (
  'create_group_conversation','get_my_group_invitations','get_my_group_invitations_page',
  'get_my_former_group_conversations','respond_to_group_invitation','invite_group_member',
  'revoke_group_invitation','get_group_members','get_group_pending_invitations',
  'get_group_management_snapshot','leave_group_conversation','remove_group_member',
  'set_group_member_role','transfer_group_ownership','rename_group_conversation'))
OR (n.nspname='messaging_private' AND p.proname IN (
  'create_group','my_group_invitations','group_invitation_page','former_group_inbox',
  'respond_group_invitation','invite_group_member','revoke_group_invitation','group_members',
  'group_pending_invitations','group_management_snapshot','leave_group','remove_group_member',
  'set_group_role','transfer_group_owner','rename_group','is_active_group_manager'));

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='realtime.messages'::regclass),'Realtime message table retains RLS');
SELECT is((SELECT count(*) FROM pg_policies
  WHERE schemaname='realtime' AND tablename='messages' AND permissive='RESTRICTIVE'
    AND roles=ARRAY['anon','authenticated']::name[]
    AND ((policyname='direct_messages_deny_client_insert' AND cmd='INSERT' AND qual IS NULL AND with_check='false')
      OR (policyname='direct_messages_deny_client_update' AND cmd='UPDATE' AND qual='false' AND with_check='false')
      OR (policyname='direct_messages_deny_client_delete' AND cmd='DELETE' AND qual='false' AND with_check IS NULL))),
  3::bigint,'Restrictive policies deny every client write despite managed table grants');
SELECT is((SELECT count(*) FROM pg_policy WHERE polrelid='realtime.messages'::regclass
  AND polpermissive AND polcmd IN ('a','w','d','*')),0::bigint,
  'No permissive policy allows client broadcast or presence writes');
SELECT ok(NOT has_function_privilege('authenticated','messaging_private.broadcast_direct_invalidation()','EXECUTE'),
  'Clients cannot invoke the broadcast trigger helper');
SELECT is((SELECT count(*) FROM pg_trigger WHERE tgname IN
  ('broadcast_direct_message_insert','broadcast_direct_membership_insert','broadcast_direct_read_cursor')),3::bigint,
  'Direct insert, membership and read cursor invalidation triggers are installed');

SET LOCAL ROLE authenticated;
SELECT pg_temp.login(2);
SELECT is(messaging_private.realtime_actor(),pg_temp.uid(2),'Completed eligible profile resolves to its own subscription actor');
SELECT is((SELECT count(*) FROM public.get_my_conversations()),0::bigint,'An existing group is absent from the active inbox');
SELECT is(public.get_my_unread_message_count(),0::bigint,'Preserved group messages do not inflate the unread badge');
SELECT ok(NOT messaging_private.can_read_conversation(pg_temp.fixture('group')),'Central conversation guard rejects a known group');
SELECT ok(NOT messaging_private.can_read_message(pg_temp.fixture('group'),1),'Central message guard rejects preserved group history');
SELECT throws_ok($$SELECT public.get_conversation_summary(pg_temp.fixture('group'))$$,'42501',NULL,'Generic summary RPC cannot bypass group deferral');
SELECT throws_ok($$SELECT public.get_conversation_messages(pg_temp.fixture('group'))$$,'42501',NULL,'Generic history RPC cannot bypass group deferral');
SELECT throws_ok($$SELECT public.send_conversation_message(pg_temp.fixture('group'),gen_random_uuid(),'No bypass')$$,'42501',NULL,'Generic send RPC cannot bypass group deferral');
SELECT throws_ok($$SELECT public.mark_conversation_read(pg_temp.fixture('group'),1)$$,'42501',NULL,'Generic read-cursor RPC cannot bypass group deferral');
SELECT is((SELECT count(*) FROM public.messages WHERE conversation_id=pg_temp.fixture('group')),0::bigint,'Raw REST message access cannot bypass group deferral');
SELECT is((SELECT count(*) FROM public.conversation_members WHERE conversation_id=pg_temp.fixture('group')),0::bigint,'Raw membership access cannot reveal deferred groups');
SELECT throws_ok($$SELECT public.get_my_group_invitations()$$,'42501',NULL,'Dedicated invitation RPC is disabled');
SELECT throws_ok($$SELECT messaging_private.group_members(pg_temp.fixture('group'))$$,'42501',NULL,'Private-schema roster helper is disabled');

INSERT INTO fixtures VALUES('direct',public.start_direct_conversation(pg_temp.uid(1)));
SELECT is((SELECT count(*) FROM public.get_my_conversations()),1::bigint,'Direct conversation remains available in mixed persisted data');
SELECT is(public.get_conversation_summary(pg_temp.fixture('direct'))->>'type','direct','Direct summary still works');
SELECT lives_ok($$SELECT public.send_conversation_message(pg_temp.fixture('direct'),gen_random_uuid(),'Direct messaging remains enabled')$$,
  'Direct send still works after group deferral');
SELECT pg_temp.login(1);
SELECT is(public.get_my_unread_message_count(),1::bigint,'Unread count includes incoming direct messages');
SELECT is((SELECT count(*) FROM public.get_conversation_messages(pg_temp.fixture('direct'))),1::bigint,'Direct message history remains readable');
SELECT is(public.mark_conversation_read(pg_temp.fixture('direct'),1),'1','Direct read cursor still advances');
SELECT is(public.get_my_unread_message_count(),0::bigint,'Direct read cursor clears unread total');
SELECT pg_temp.login(3);
SELECT ok(NOT messaging_private.can_read_conversation(pg_temp.fixture('direct')),'Outsider still cannot read a direct conversation');
SELECT pg_temp.login(4);
SELECT ok(messaging_private.realtime_actor() IS NULL,'Soft-deleted account with stale JWT cannot authorize a subscription');
SELECT pg_temp.login(5);
SELECT ok(messaging_private.realtime_actor() IS NULL,'Banned account with stale JWT cannot authorize a subscription');
SELECT pg_temp.login(6);
SELECT ok(messaging_private.realtime_actor() IS NULL,'Incomplete profile cannot authorize a subscription');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT ok(messaging_private.realtime_actor() IS NULL,'Missing auth identity cannot authorize a subscription');
RESET ROLE;
SELECT pg_temp.login(3);
DELETE FROM auth.users WHERE id=pg_temp.uid(3);
SET LOCAL ROLE authenticated;
SELECT ok(messaging_private.realtime_actor() IS NULL,'Hard-deleted account with stale JWT cannot authorize a subscription');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.group_conversations WHERE conversation_id=pg_temp.fixture('group')),1::bigint,'Deferred group metadata is preserved');
SELECT is((SELECT body FROM public.messages WHERE conversation_id=pg_temp.fixture('group')),'Preserved group history','Deferred group message content is preserved');
SELECT is((SELECT count(*) FROM public.group_membership_periods WHERE conversation_id=pg_temp.fixture('group')),2::bigint,'Deferred membership history is preserved');

-- Hosted Supabase owns this table and can retain client DML grants. Locally,
-- restore those grants only inside this rollback transaction. A temporary
-- permissive policy proves that the restrictive policies remain decisive.
-- Hosted grant-option restrictions may make GRANT a no-op; the checks below
-- accept table-level denial too, while always verifying the restrictive rules.
GRANT SELECT, INSERT, UPDATE, DELETE ON realtime.messages TO anon, authenticated;
CREATE POLICY test_realtime_client_write_allow ON realtime.messages
FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
INSERT INTO fixtures VALUES('broadcast',gen_random_uuid());
INSERT INTO realtime.messages(id,payload,event,topic,private,extension)
VALUES(pg_temp.fixture('broadcast'),'{}','original','messages:'||pg_temp.uid(2)::text,true,'broadcast');

SET LOCAL ROLE authenticated;
SELECT pg_temp.login(2);
SELECT throws_ok($$INSERT INTO realtime.messages(payload,event,topic,private,extension)
  VALUES('{}','forged','messages:'||pg_temp.uid(2)::text,true,'broadcast')$$,
  '42501',NULL,'Authenticated broadcast insertion is denied with a permissive write policy present');
SELECT CASE WHEN has_table_privilege(current_user,'realtime.messages','UPDATE') THEN
  results_eq($$UPDATE realtime.messages SET event='tampered' WHERE id=pg_temp.fixture('broadcast') RETURNING id$$,
    ARRAY[]::uuid[],'Authenticated update cannot affect a broadcast row')
  ELSE throws_ok($$UPDATE realtime.messages SET event='tampered' WHERE id=pg_temp.fixture('broadcast')$$,
    '42501',NULL,'Authenticated update is denied by managed table privileges') END;
SELECT CASE WHEN has_table_privilege(current_user,'realtime.messages','DELETE') THEN
  results_eq($$DELETE FROM realtime.messages WHERE id=pg_temp.fixture('broadcast') RETURNING id$$,
    ARRAY[]::uuid[],'Authenticated delete cannot remove a broadcast row')
  ELSE throws_ok($$DELETE FROM realtime.messages WHERE id=pg_temp.fixture('broadcast')$$,
    '42501',NULL,'Authenticated delete is denied by managed table privileges') END;
RESET ROLE;
GRANT SELECT ON fixtures TO anon;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT throws_ok($$INSERT INTO realtime.messages(payload,event,topic,private,extension)
  VALUES('{}','forged','messages:'||pg_temp.uid(2)::text,true,'broadcast')$$,
  '42501',NULL,'Anonymous broadcast insertion is denied with a permissive write policy present');
SELECT CASE WHEN has_table_privilege(current_user,'realtime.messages','UPDATE') THEN
  results_eq($$UPDATE realtime.messages SET event='tampered' WHERE id=pg_temp.fixture('broadcast') RETURNING id$$,
    ARRAY[]::uuid[],'Anonymous update cannot affect a broadcast row')
  ELSE throws_ok($$UPDATE realtime.messages SET event='tampered' WHERE id=pg_temp.fixture('broadcast')$$,
    '42501',NULL,'Anonymous update is denied by managed table privileges') END;
SELECT CASE WHEN has_table_privilege(current_user,'realtime.messages','DELETE') THEN
  results_eq($$DELETE FROM realtime.messages WHERE id=pg_temp.fixture('broadcast') RETURNING id$$,
    ARRAY[]::uuid[],'Anonymous delete cannot remove a broadcast row')
  ELSE throws_ok($$DELETE FROM realtime.messages WHERE id=pg_temp.fixture('broadcast')$$,
    '42501',NULL,'Anonymous delete is denied by managed table privileges') END;
RESET ROLE;
SELECT is((SELECT event FROM realtime.messages WHERE id=pg_temp.fixture('broadcast')),'original',
  'Denied client writes preserve the original broadcast row');
SELECT * FROM finish();
ROLLBACK;
