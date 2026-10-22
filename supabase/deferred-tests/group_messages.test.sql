BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT no_plan();

-- Task 10 group-message fixtures. Everything is rolled back.
INSERT INTO auth.users(id,email)
SELECT ('c010c010-c010-4010-8010-'||lpad(i::text,12,'0'))::uuid,
  'group-messages-'||i||'@test.local'
FROM generate_series(1,25) i;

CREATE FUNCTION pg_temp.uid(i integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('c010c010-c010-4010-8010-'||lpad(i::text,12,'0'))::uuid;
$$;
CREATE FUNCTION pg_temp.client_id(i integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('d010d010-d010-4010-8010-'||lpad(i::text,12,'0'))::uuid;
$$;
CREATE FUNCTION pg_temp.login(i integer) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub',pg_temp.uid(i)::text,true);
$$;

UPDATE public.profiles
SET display_name='Group Tester '||right(id::text,2),
  major='Computing Science', year_of_study=2,
  campus_id=(SELECT id FROM public.campuses WHERE slug='burnaby'),
  is_discoverable=true, onboarding_completed_at=clock_timestamp()
WHERE id IN (SELECT pg_temp.uid(i) FROM generate_series(1,25) i);

INSERT INTO public.academic_terms(
  id,code,display_name,year,season,starts_on,ends_on,status
) VALUES (
  'c020c020-c020-4020-8020-000000000001','2101-fall','Fall 2101',2101,
  'fall','2101-09-01','2101-12-31','current'
);
INSERT INTO public.courses(id,code,title,term_id,campus_id,status)
VALUES (
  'c030c030-c030-4030-8030-000000000001','CMPT 410','Group Systems',
  'c020c020-c020-4020-8020-000000000001',
  (SELECT id FROM public.campuses WHERE slug='burnaby'),'active'
);
INSERT INTO public.course_memberships(course_id,profile_id,status)
SELECT 'c030c030-c030-4030-8030-000000000001',pg_temp.uid(i),'enrolled'
FROM generate_series(1,25) i WHERE i<>6;

CREATE TEMP TABLE fixtures(name text PRIMARY KEY,id uuid);
GRANT ALL ON fixtures TO authenticated;
CREATE TEMP TABLE revisions(name text PRIMARY KEY,revision bigint NOT NULL);
GRANT ALL ON revisions TO authenticated;
CREATE FUNCTION pg_temp.fixture(p_name text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM fixtures WHERE name=p_name;
$$;
CREATE FUNCTION pg_temp.saved_revision(p_name text) RETURNS bigint LANGUAGE sql AS $$
  SELECT revision FROM revisions WHERE name=p_name;
$$;
CREATE FUNCTION pg_temp.management_revision(p_conversation_id uuid)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT management_revision FROM public.group_conversations
  WHERE conversation_id=p_conversation_id;
$$;

-- Schema and privilege boundary.
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN (
  'public.group_conversations'::regclass,
  'public.group_membership_periods'::regclass,
  'public.group_conversation_invitations'::regclass
)),'All group tables enforce RLS');
SELECT ok(
  NOT has_table_privilege('authenticated','public.group_conversations','SELECT')
  AND NOT has_table_privilege('authenticated','public.group_membership_periods','SELECT')
  AND NOT has_table_privilege('authenticated','public.group_conversation_invitations','SELECT'),
  'Group implementation tables are RPC-only'
);
SELECT ok(NOT has_function_privilege('anon',p.oid,'EXECUTE'),
  'Anonymous role cannot call '||p.proname)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN (
  'create_group_conversation','get_my_group_invitations',
  'respond_to_group_invitation','invite_group_member',
  'revoke_group_invitation','get_group_members',
  'get_group_pending_invitations','get_group_management_snapshot',
  'leave_group_conversation',
  'remove_group_member','set_group_member_role',
  'transfer_group_ownership','rename_group_conversation'
);
SELECT is(
  (SELECT proargnames FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='create_group_conversation'),
  ARRAY['p_client_creation_id','p_course_id','p_title','p_invitee_ids']::text[],
  'Create RPC exposes the stable named-argument contract'
);
SELECT is(
  (SELECT proargnames FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='respond_to_group_invitation'),
  ARRAY['p_invitation_id','p_response']::text[],
  'Invitation response RPC exposes the stable named-argument contract'
);
SELECT is(
  (SELECT proargnames FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='invite_group_member'),
  ARRAY['p_conversation_id','p_client_invitation_id','p_invitee_id',
    'p_expected_management_revision']::text[],
  'Invite RPC exposes the stable named-argument contract'
);
SELECT is(
  (SELECT proargnames FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='transfer_group_ownership'),
  ARRAY['p_conversation_id','p_new_owner_id','p_expected_membership_period',
    'p_expected_management_revision']::text[],
  'Ownership-transfer RPC exposes the stable named-argument contract'
);
SELECT is(
  (SELECT proargnames FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='leave_group_conversation'),
  ARRAY['p_conversation_id','p_expected_membership_period']::text[],
  'Leave RPC requires the membership epoch being closed'
);
SELECT is(
  (SELECT proargnames FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='remove_group_member'),
  ARRAY['p_conversation_id','p_profile_id','p_expected_membership_period',
    'p_expected_management_revision']::text[],
  'Removal RPC requires the target membership epoch'
);
SELECT is(
  (SELECT proargnames FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='set_group_member_role'),
  ARRAY['p_conversation_id','p_profile_id','p_expected_membership_period','p_role',
    'p_expected_management_revision']::text[],
  'Role RPC requires the target epoch and management revision'
);
SELECT is(
  (SELECT proargnames FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='rename_group_conversation'),
  ARRAY['p_conversation_id','p_title','p_expected_management_revision']::text[],
  'Rename RPC requires the management revision'
);
SELECT is(
  pg_get_function_result('public.get_group_members(uuid)'::regprocedure),
  'TABLE(profile_id uuid, display_name text, role text, joined_at timestamp with time zone)',
  'Ordinary roster RPC exposes no peer membership epoch'
);
SELECT ok(
  has_function_privilege('authenticated','public.get_group_members(uuid)','EXECUTE')
    AND NOT has_function_privilege('anon','public.get_group_members(uuid)','EXECUTE'),
  'Roster RPC is available only to authenticated callers'
);
SELECT ok(
  to_regprocedure('public.invite_group_member(uuid,uuid,uuid)') IS NULL
  AND to_regprocedure('public.revoke_group_invitation(uuid)') IS NULL
  AND to_regprocedure('public.remove_group_member(uuid,uuid,integer)') IS NULL
  AND to_regprocedure('public.set_group_member_role(uuid,uuid,integer,text)') IS NULL
  AND to_regprocedure('public.transfer_group_ownership(uuid,uuid,integer)') IS NULL
  AND to_regprocedure('public.rename_group_conversation(uuid,text)') IS NULL,
  'Obsolete mutation overloads are absent'
);

-- Privileged writes cannot create ownerless group metadata or attach it to a
-- non-group parent even though client table writes are already revoked.
SELECT throws_ok($test$
  INSERT INTO public.conversations(id,type,created_by)
  VALUES ('c040c040-c040-4040-8040-000000000001','group',pg_temp.uid(1));
  INSERT INTO public.group_conversations(
    conversation_id,course_id,creator_id,client_creation_id,title,initial_title
  ) VALUES (
    'c040c040-c040-4040-8040-000000000001',
    'c030c030-c030-4030-8030-000000000001',pg_temp.uid(1),pg_temp.client_id(901),
    'Ownerless','Ownerless'
  );
  SET CONSTRAINTS enforce_group_integrity_on_metadata IMMEDIATE;
$test$,'23514',NULL,'Group metadata cannot commit without exactly one active owner');
SELECT throws_ok($test$
  INSERT INTO public.conversations(id,type,created_by)
  VALUES ('c040c040-c040-4040-8040-000000000002','direct',pg_temp.uid(1));
  INSERT INTO public.conversation_members(conversation_id,profile_id,role)
  VALUES ('c040c040-c040-4040-8040-000000000002',pg_temp.uid(1),'owner');
  INSERT INTO public.group_conversations(
    conversation_id,course_id,creator_id,client_creation_id,title,initial_title
  ) VALUES (
    'c040c040-c040-4040-8040-000000000002',
    'c030c030-c030-4030-8030-000000000001',pg_temp.uid(1),pg_temp.client_id(902),
    'Wrong parent','Wrong parent'
  );
  SET CONSTRAINTS enforce_group_integrity_on_metadata IMMEDIATE;
$test$,'23514',NULL,'Group metadata requires a parent conversation of type group');

-- A direct pair created after this migration receives permanent visibility
-- periods and keeps the established direct-message behavior.
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(24);
INSERT INTO fixtures VALUES('fresh-direct',public.start_direct_conversation(pg_temp.uid(25)));
SELECT is(
  public.send_conversation_message(pg_temp.fixture('fresh-direct'),pg_temp.client_id(900),'Fresh direct')->>'sequence',
  '1','A fresh post-migration direct member can send'
);
SELECT pg_temp.login(25);
SELECT is((SELECT count(*) FROM public.get_conversation_messages(pg_temp.fixture('fresh-direct'))),
  1::bigint,'The other fresh direct member can read history');
SELECT is((SELECT sender_display_name FROM public.get_conversation_messages(pg_temp.fixture('fresh-direct')) LIMIT 1),
  'Group Tester 24','Direct messages also expose sender_display_name');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.group_membership_periods
  WHERE conversation_id=pg_temp.fixture('fresh-direct')),2::bigint,
  'Direct-member insert trigger created both permanent periods');
SELECT ok((SELECT bool_and(starts_after_sequence=0 AND ends_at_sequence IS NULL)
  FROM public.group_membership_periods WHERE conversation_id=pg_temp.fixture('fresh-direct')),
  'Fresh direct periods preserve full-history visibility');

-- Input validation, course scoping and idempotent creation.
UPDATE public.profiles SET is_discoverable=false WHERE id=pg_temp.uid(4);
UPDATE public.profiles SET display_name=NULL,onboarding_completed_at=NULL WHERE id=pg_temp.uid(5);
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT throws_ok($$SELECT public.create_group_conversation(
  pg_temp.client_id(1),'c030c030-c030-4030-8030-000000000001','',ARRAY[pg_temp.uid(2)])$$,
  '22023',NULL,'Blank group title is rejected');
SELECT throws_ok($$SELECT public.create_group_conversation(
  pg_temp.client_id(2),'c030c030-c030-4030-8030-000000000001',repeat('x',81),ARRAY[pg_temp.uid(2)])$$,
  '22023',NULL,'Group title is limited to 80 characters');
SELECT throws_ok($$SELECT public.create_group_conversation(
  pg_temp.client_id(3),'c030c030-c030-4030-8030-000000000001','Empty','{}'::uuid[])$$,
  '22023',NULL,'A group requires at least one invitee');
SELECT throws_ok($$SELECT public.create_group_conversation(
  pg_temp.client_id(4),'c030c030-c030-4030-8030-000000000001','Duplicate',ARRAY[pg_temp.uid(2),pg_temp.uid(2)])$$,
  '22023',NULL,'Duplicate invitee IDs are rejected rather than deduplicated');
SELECT throws_ok($$SELECT public.create_group_conversation(
  pg_temp.client_id(5),'c030c030-c030-4030-8030-000000000001','Self',ARRAY[pg_temp.uid(1)])$$,
  '22023',NULL,'Creator cannot invite themself');
SELECT throws_ok($$SELECT public.create_group_conversation(
  pg_temp.client_id(6),'c030c030-c030-4030-8030-000000000001','Private',ARRAY[pg_temp.uid(4)])$$,
  '42501',NULL,'A hidden classmate cannot be invited');
SELECT throws_ok($$SELECT public.create_group_conversation(
  pg_temp.client_id(7),'c030c030-c030-4030-8030-000000000001','Incomplete',ARRAY[pg_temp.uid(5)])$$,
  '42501',NULL,'An incomplete profile cannot be invited');
SELECT throws_ok($$SELECT public.create_group_conversation(
  pg_temp.client_id(8),'c030c030-c030-4030-8030-000000000001','Other course',ARRAY[pg_temp.uid(6)])$$,
  '42501',NULL,'A non-classmate cannot be invited');
SELECT throws_ok($$SELECT public.create_group_conversation(
  pg_temp.client_id(9),'c030c030-c030-4030-8030-000000000001','Too many',
  ARRAY(SELECT pg_temp.uid(i) FROM generate_series(2,21) i))$$,
  '22023',NULL,'Creation accepts at most 19 invitees');

INSERT INTO fixtures VALUES('group',public.create_group_conversation(
  pg_temp.client_id(10),'c030c030-c030-4030-8030-000000000001',
  '  Study Crew  ',ARRAY[pg_temp.uid(2),pg_temp.uid(3)]));
SELECT is(public.create_group_conversation(
  pg_temp.client_id(10),'c030c030-c030-4030-8030-000000000001',
  'Study Crew',ARRAY[pg_temp.uid(3),pg_temp.uid(2)]),
  pg_temp.fixture('group'),'An exact creation retry returns the same group');
SELECT throws_ok($$SELECT public.create_group_conversation(
  pg_temp.client_id(10),'c030c030-c030-4030-8030-000000000001',
  'Different title',ARRAY[pg_temp.uid(2),pg_temp.uid(3)])$$,
  '22023',NULL,'A creation retry cannot change original content');
SELECT is(public.get_conversation_summary(pg_temp.fixture('group'))->>'group_title',
  'Study Crew','Title is normalized on creation');
SELECT is(public.get_conversation_summary(pg_temp.fixture('group'))->>'my_role',
  'owner','Creator is the sole owner');
SELECT is((public.get_conversation_summary(pg_temp.fixture('group'))->>'my_membership_period')::integer,
  1,'Creator summary exposes the active membership epoch');
SELECT is(public.get_conversation_summary(pg_temp.fixture('group'))->>'management_revision',
  '0','Creator summary exposes the exact initial management revision');
SELECT is((public.get_conversation_summary(pg_temp.fixture('group'))->>'active_member_count')::integer,
  1,'Pending invitees are not counted as active members');
SELECT is((SELECT count(*) FROM public.get_group_members(pg_temp.fixture('group'))),
  1::bigint,'Pending invitees are absent from the active roster');
SELECT ok(NOT ((SELECT to_jsonb(member_row) FROM public.get_group_members(
  pg_temp.fixture('group')) member_row WHERE profile_id=pg_temp.uid(1)) ? 'membership_period'),
  'Ordinary roster omits peer membership epochs');
SELECT is((SELECT count(*) FROM public.get_group_pending_invitations(pg_temp.fixture('group'))),
  2::bigint,'Owner sees pending invitation projections');
SELECT is(public.get_group_management_snapshot(pg_temp.fixture('group'))->>'management_revision',
  '0','Manager snapshot exposes the same exact revision');
SELECT is(jsonb_array_length(public.get_group_management_snapshot(
  pg_temp.fixture('group'))->'members'),1,'Manager snapshot atomically includes active members');
SELECT is((public.get_group_management_snapshot(pg_temp.fixture('group'))
  ->'members'->0->>'membership_period')::integer,1,
  'Manager-only snapshot retains target membership epochs');
SELECT is(jsonb_array_length(public.get_group_management_snapshot(
  pg_temp.fixture('group'))->'pending_invitations'),2,
  'Manager snapshot atomically includes pending invitations');
SELECT is((SELECT count(*) FROM public.conversations WHERE id=pg_temp.fixture('group')),
  0::bigint,'Even an owner cannot read raw group conversation metadata');
SELECT throws_ok($$SELECT count(*) FROM public.group_conversations$$,'42501',NULL,
  'Authenticated clients cannot query raw group metadata');

-- Capture server-generated initial invitation IDs and make one deliberately old.
RESET ROLE;
INSERT INTO fixtures
SELECT 'invite-2',id FROM public.group_conversation_invitations
WHERE conversation_id=pg_temp.fixture('group') AND invitee_profile_id=pg_temp.uid(2);
INSERT INTO fixtures
SELECT 'invite-3',id FROM public.group_conversation_invitations
WHERE conversation_id=pg_temp.fixture('group') AND invitee_profile_id=pg_temp.uid(3);
UPDATE public.group_conversation_invitations SET created_at='2000-01-01T00:00:00Z'
WHERE id=pg_temp.fixture('invite-3');

-- Pending users get only their narrow invitation preview and zero room access.
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(2);
SELECT is((SELECT count(*) FROM public.get_my_group_invitations(20)),1::bigint,
  'Invitee sees their own pending invitation');
SELECT is((SELECT status FROM public.get_my_group_invitations(20) LIMIT 1),'pending',
  'Invitation preview exposes pending status');
SELECT ok((SELECT NOT (to_jsonb(invitation) ? 'expires_at')
  FROM public.get_my_group_invitations(20) invitation LIMIT 1),
  'Invitation preview has no automatic-expiry field');
SELECT throws_ok($$SELECT public.get_conversation_summary(pg_temp.fixture('group'))$$,
  '42501',NULL,'Pending invitee cannot open group summary');
SELECT throws_ok($$SELECT * FROM public.get_group_members(pg_temp.fixture('group'))$$,
  '42501',NULL,'Pending invitee cannot see the roster');
SELECT throws_ok($$SELECT public.get_group_management_snapshot(pg_temp.fixture('group'))$$,
  '42501',NULL,'Pending invitee cannot inspect manager state');
SELECT throws_ok($$SELECT public.send_conversation_message(
  pg_temp.fixture('group'),pg_temp.client_id(20),'Pending intrusion')$$,
  '42501',NULL,'Pending invitee cannot send');

SELECT pg_temp.login(1);
SELECT is(public.send_conversation_message(
  pg_temp.fixture('group'),pg_temp.client_id(21),'Before acceptance')->>'sequence',
  '1','Owner can message before invitations are accepted');
SELECT pg_temp.login(2);
SELECT throws_ok($$SELECT public.respond_to_group_invitation(
  pg_temp.fixture('invite-2'),NULL)$$,'22023',NULL,
  'NULL invitation response is rejected');
SELECT is((SELECT count(*) FROM public.get_my_group_invitations(20)),1::bigint,
  'NULL response leaves the invitation pending');
SELECT is(public.respond_to_group_invitation(pg_temp.fixture('invite-2'),'accepted'),
  pg_temp.fixture('group'),'Invitee explicitly accepts');
SELECT is(public.respond_to_group_invitation(pg_temp.fixture('invite-2'),'accepted'),
  pg_temp.fixture('group'),'Exact acceptance retry is idempotent');
SELECT is(public.get_conversation_summary(pg_temp.fixture('group'))->>'management_revision',
  '1','Acceptance advances management revision once');
SELECT is((SELECT count(*) FROM public.get_conversation_messages(pg_temp.fixture('group'))),
  0::bigint,'Acceptance does not reveal messages from before membership');
SELECT is(public.get_conversation_summary(pg_temp.fixture('group'))->>'my_membership_status',
  'active','Accepted invitee becomes active');
SELECT is(public.get_conversation_summary(pg_temp.fixture('group'))->>'last_read_sequence',
  '1','Acceptance advances the read cursor past hidden history');
SELECT is((public.get_conversation_summary(pg_temp.fixture('group'))->>'active_member_count')::integer,
  2,'Active member count includes the accepted invitee');
SELECT ok((public.get_conversation_summary(pg_temp.fixture('group'))->>'can_send')::boolean,
  'Accepted member can send');

SELECT pg_temp.login(1);
SELECT is(public.send_conversation_message(
  pg_temp.fixture('group'),pg_temp.client_id(22),'After acceptance')->>'sequence',
  '2','First post-acceptance message advances the shared sequence');
SELECT pg_temp.login(2);
SELECT is((SELECT array_agg(sequence) FROM public.get_conversation_messages(pg_temp.fixture('group'))),
  ARRAY['2']::text[],'New member sees only messages in their first period');
SELECT is((SELECT sender_display_name FROM public.get_conversation_messages(pg_temp.fixture('group')) LIMIT 1),
  'Group Tester 01','Group history includes sender display name');
SELECT is(public.get_my_unread_message_count(),'1'::bigint,
  'Only visible incoming messages count as unread');
SELECT throws_ok($$SELECT public.mark_conversation_read(pg_temp.fixture('group'),1)$$,
  '22023',NULL,'Read cursor cannot point into hidden pre-membership history');
SELECT is(public.mark_conversation_read(pg_temp.fixture('group'),2),'2',
  'Member can mark a visible group message read');
SELECT is(public.get_my_unread_message_count(),'0'::bigint,
  'Group read cursor clears visible unread messages');
SELECT is(public.send_conversation_message(
  pg_temp.fixture('group'),pg_temp.client_id(23),'Member reply')->>'sequence',
  '3','Accepted member can reply');

-- Old invitations do not expire automatically; decline is explicit.
SELECT pg_temp.login(3);
SELECT is((SELECT count(*) FROM public.get_my_group_invitations(20)),1::bigint,
  'An old unresolved invitation remains actionable');
SELECT is(public.respond_to_group_invitation(pg_temp.fixture('invite-3'),'declined'),
  pg_temp.fixture('group'),'Invitee can explicitly decline');
SELECT is(public.respond_to_group_invitation(pg_temp.fixture('invite-3'),'declined'),
  pg_temp.fixture('group'),'Exact decline retry is idempotent');
SELECT is(pg_temp.management_revision(pg_temp.fixture('group')),2::bigint,
  'Decline advances management revision once');
SELECT is((SELECT count(*) FROM public.get_my_group_invitations(20)),0::bigint,
  'Declined invitation leaves the pending inbox');
SELECT throws_ok($$SELECT public.respond_to_group_invitation(
  pg_temp.fixture('invite-3'),'accepted')$$,'55000',NULL,
  'A declined invitation cannot later be accepted');

-- Acceptance rechecks current eligibility, but not discoverability.
RESET ROLE;
UPDATE public.profiles SET is_discoverable=true WHERE id=pg_temp.uid(4);
UPDATE public.profiles SET display_name='Group Tester 05',onboarding_completed_at=clock_timestamp()
WHERE id=pg_temp.uid(5);
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
INSERT INTO fixtures VALUES('privacy-group',public.create_group_conversation(
  pg_temp.client_id(30),'c030c030-c030-4030-8030-000000000001',
  'Privacy Group',ARRAY[pg_temp.uid(4)]));
RESET ROLE;
INSERT INTO fixtures SELECT 'invite-4',id FROM public.group_conversation_invitations
WHERE conversation_id=pg_temp.fixture('privacy-group') AND invitee_profile_id=pg_temp.uid(4);
UPDATE public.profiles SET is_discoverable=false WHERE id=pg_temp.uid(4);
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(4);
SELECT is(public.respond_to_group_invitation(pg_temp.fixture('invite-4'),'accepted'),
  pg_temp.fixture('privacy-group'),'Privacy change does not invalidate an issued invitation');

SELECT pg_temp.login(1);
INSERT INTO fixtures VALUES('invite-5',public.invite_group_member(
  pg_temp.fixture('group'),pg_temp.client_id(31),pg_temp.uid(5),
  pg_temp.management_revision(pg_temp.fixture('group'))));
RESET ROLE;
UPDATE public.profiles SET display_name=NULL,onboarding_completed_at=NULL WHERE id=pg_temp.uid(5);
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(5);
SELECT throws_ok($$SELECT public.respond_to_group_invitation(
  pg_temp.fixture('invite-5'),'accepted')$$,'42501',NULL,
  'Acceptance rechecks course/profile eligibility');
SELECT is((SELECT count(*) FROM public.get_my_group_invitations(20)),1::bigint,
  'Failed eligibility check leaves consent pending');
RESET ROLE;
UPDATE public.profiles SET display_name='Group Tester 05',onboarding_completed_at=clock_timestamp()
WHERE id=pg_temp.uid(5);

-- Owner/admin management, deterministic invitations, removal, and bounded history.
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT throws_ok($$SELECT public.set_group_member_role(
  pg_temp.fixture('group'),pg_temp.uid(2),1,NULL,
  pg_temp.management_revision(pg_temp.fixture('group')))$$,'22023',NULL,
  'NULL role is rejected explicitly');
SELECT is(public.get_conversation_summary(pg_temp.fixture('group'))->>'my_role',
  'owner','Invalid role update leaves ownership unchanged');
INSERT INTO revisions VALUES('before-promote',pg_temp.management_revision(pg_temp.fixture('group')));
SELECT is(public.set_group_member_role(pg_temp.fixture('group'),pg_temp.uid(2),1,'administrator',
  pg_temp.saved_revision('before-promote')),
  'administrator','Owner can promote an active member');
SELECT pg_temp.login(2);
INSERT INTO revisions VALUES('before-first-rename',pg_temp.management_revision(pg_temp.fixture('group')));
SELECT is(public.rename_group_conversation(pg_temp.fixture('group'),'  Systems Crew  ',
  pg_temp.saved_revision('before-first-rename')),
  'Systems Crew','Administrator can rename the group');
SELECT pg_temp.login(1);
SELECT is(public.create_group_conversation(
  pg_temp.client_id(10),'c030c030-c030-4030-8030-000000000001',
  'Study Crew',ARRAY[pg_temp.uid(3),pg_temp.uid(2)]),
  pg_temp.fixture('group'),'Creation retry remains stable after a later rename');
SELECT throws_ok($$SELECT public.create_group_conversation(
  pg_temp.client_id(10),'c030c030-c030-4030-8030-000000000001',
  'Systems Crew',ARRAY[pg_temp.uid(2),pg_temp.uid(3)])$$,
  '22023',NULL,'Renamed display state is not accepted as the original creation payload');
SELECT pg_temp.login(2);
INSERT INTO fixtures VALUES('invite-7',public.invite_group_member(
  pg_temp.fixture('group'),pg_temp.client_id(32),pg_temp.uid(7),
  pg_temp.management_revision(pg_temp.fixture('group'))));
SELECT is(public.invite_group_member(
  pg_temp.fixture('group'),pg_temp.client_id(32),pg_temp.uid(7),0),
  pg_temp.fixture('invite-7'),'Exact invitation retry returns its client ID');
SELECT throws_ok($$SELECT public.invite_group_member(
  pg_temp.fixture('group'),pg_temp.client_id(32),pg_temp.uid(8),0)$$,
  '22023',NULL,'Invitation retry cannot change invitee');
SELECT is((SELECT count(*) FROM public.get_group_pending_invitations(pg_temp.fixture('group'))),
  2::bigint,'Administrator sees all pending invitations');
SELECT throws_ok($$SELECT public.remove_group_member(
  pg_temp.fixture('group'),pg_temp.uid(1),1,
  pg_temp.management_revision(pg_temp.fixture('group')))$$,'42501',NULL,
  'Administrator cannot remove the owner');

SELECT pg_temp.login(1);
SELECT is(public.send_conversation_message(
  pg_temp.fixture('group'),pg_temp.client_id(33),'Before late join')->>'sequence',
  '4','Message before a later join is stored');
SELECT pg_temp.login(7);
SELECT is(public.respond_to_group_invitation(pg_temp.fixture('invite-7'),'accepted'),
  pg_temp.fixture('group'),'Later invitee accepts');
SELECT is((SELECT count(*) FROM public.get_conversation_messages(pg_temp.fixture('group'))),
  0::bigint,'Later invitee cannot see the earlier membership gap');
SELECT throws_ok($$SELECT public.rename_group_conversation(
  pg_temp.fixture('group'),'Member rename',
  pg_temp.management_revision(pg_temp.fixture('group')))$$,'42501',NULL,
  'Ordinary member cannot rename group');
SELECT pg_temp.login(1);
SELECT is(public.send_conversation_message(
  pg_temp.fixture('group'),pg_temp.client_id(34),'Visible late message')->>'sequence',
  '5','Message in late member period is stored');
SELECT pg_temp.login(7);
SELECT is(public.send_conversation_message(
  pg_temp.fixture('group'),pg_temp.client_id(35),'Late member reply')->>'sequence',
  '6','Late member can send inside active period');
SELECT pg_temp.login(2);
INSERT INTO revisions VALUES('before-remove-7-period-1',
  pg_temp.management_revision(pg_temp.fixture('group')));
SELECT is(public.remove_group_member(pg_temp.fixture('group'),pg_temp.uid(7),1,
  pg_temp.saved_revision('before-remove-7-period-1')),
  'removed','Administrator can remove an ordinary member');
SELECT is(public.remove_group_member(pg_temp.fixture('group'),pg_temp.uid(7),1,
  pg_temp.saved_revision('before-remove-7-period-1')),
  'removed','Removal retry is idempotent');
SELECT pg_temp.login(1);
SELECT is(public.send_conversation_message(
  pg_temp.fixture('group'),pg_temp.client_id(36),'Hidden after removal')->>'sequence',
  '7','Messages continue after removal');
INSERT INTO revisions VALUES('before-former-privacy-rename',
  pg_temp.management_revision(pg_temp.fixture('group')));
SELECT is(public.rename_group_conversation(
  pg_temp.fixture('group'),'Active Members Only',
  pg_temp.saved_revision('before-former-privacy-rename')),
  'Active Members Only','Active manager can rename after another member is removed');
SELECT is(public.get_conversation_summary(pg_temp.fixture('group'))->>'group_title',
  'Active Members Only','Active member sees the later group title');
SELECT is(public.get_conversation_summary(pg_temp.fixture('group'))->>'management_revision',
  (pg_temp.saved_revision('before-former-privacy-rename') + 1)::text,
  'Active member sees the exact later management revision');

SELECT pg_temp.login(7);
SELECT is((SELECT array_agg(sequence ORDER BY sequence::bigint DESC)
  FROM public.get_conversation_messages(pg_temp.fixture('group'))),
  ARRAY['6','5']::text[],'Removed member retains only their completed period');
SELECT is(public.get_conversation_summary(pg_temp.fixture('group'))->>'my_membership_status',
  'removed','Former member summary exposes removed state');
SELECT is((public.get_conversation_summary(pg_temp.fixture('group'))->>'active_member_count')::integer,
  0,'Former member summary does not expose current roster size');
SELECT ok(NOT (public.get_conversation_summary(pg_temp.fixture('group'))->>'can_send')::boolean,
  'Removed member summary is read-only');
SELECT is(public.get_conversation_summary(pg_temp.fixture('group'))->>'group_title',
  'Systems Crew','Former member keeps the title last visible during their membership');
SELECT is(public.get_conversation_summary(pg_temp.fixture('group'))->>'management_revision',
  '0','Former member cannot poll later management activity');
SELECT throws_ok($$SELECT * FROM public.get_group_members(pg_temp.fixture('group'))$$,
  '42501',NULL,'Removed member cannot inspect current roster');
SELECT throws_ok($$SELECT public.send_conversation_message(
  pg_temp.fixture('group'),pg_temp.client_id(37),'Removed send')$$,
  '55000',NULL,'Removed member cannot send a new message');
SELECT is(public.send_conversation_message(
  pg_temp.fixture('group'),pg_temp.client_id(35),'Late member reply')->>'sequence',
  '6','Removed member can safely reconcile an exact prior send');
SELECT is((SELECT count(*) FROM public.get_my_conversations()
  WHERE id=pg_temp.fixture('group')),0::bigint,
  'Removed group is absent from former member inbox');
SELECT is(public.get_my_unread_message_count(),'0'::bigint,
  'Removed member accumulates no unread group messages');

-- Fresh invitation creates a second period without revealing the gap.
SELECT pg_temp.login(1);
INSERT INTO fixtures VALUES('reinvite-7',public.invite_group_member(
  pg_temp.fixture('group'),pg_temp.client_id(38),pg_temp.uid(7),
  pg_temp.management_revision(pg_temp.fixture('group'))));
SELECT pg_temp.login(7);
SELECT is(public.respond_to_group_invitation(pg_temp.fixture('reinvite-7'),'accepted'),
  pg_temp.fixture('group'),'Removed member can rejoin only by fresh consent');
SELECT pg_temp.login(2);
SELECT throws_ok($$SELECT public.remove_group_member(
  pg_temp.fixture('group'),pg_temp.uid(7),1,
  pg_temp.saved_revision('before-remove-7-period-1'))$$,
  '55000',NULL,'A delayed removal retry is stale after rejoin');
SELECT pg_temp.login(7);
SELECT is(public.get_conversation_summary(pg_temp.fixture('group'))->>'my_membership_status',
  'active','Old-epoch removal retry leaves the current membership active');
SELECT is((public.get_conversation_summary(pg_temp.fixture('group'))->>'my_membership_period')::integer,
  2,'Rejoined summary exposes the new membership epoch');
SELECT is(public.get_conversation_summary(pg_temp.fixture('group'))->>'group_title',
  'Active Members Only','A newly rejoined member receives the current group title');
SELECT is(public.get_conversation_summary(pg_temp.fixture('group'))->>'management_revision',
  pg_temp.management_revision(pg_temp.fixture('group'))::text,
  'A newly rejoined member receives the current management revision');
SELECT pg_temp.login(1);
SELECT throws_ok($$SELECT public.set_group_member_role(
  pg_temp.fixture('group'),pg_temp.uid(7),1,'administrator',
  pg_temp.management_revision(pg_temp.fixture('group')))$$,
  '55000',NULL,'A role mutation cannot target an earlier membership epoch');
SELECT throws_ok($$SELECT public.transfer_group_ownership(
  pg_temp.fixture('group'),pg_temp.uid(7),1,
  pg_temp.management_revision(pg_temp.fixture('group')))$$,
  '55000',NULL,'Ownership cannot transfer to an earlier membership epoch');
SELECT pg_temp.login(7);
SELECT ok(
  (public.get_conversation_summary(pg_temp.fixture('group'))->>'last_activity_at')::timestamptz
    > (public.get_conversation_summary(pg_temp.fixture('group'))->>'last_message_at')::timestamptz,
  'Rejoin without a new visible message sorts by the new membership activity'
);
SELECT pg_temp.login(1);
SELECT is(public.send_conversation_message(
  pg_temp.fixture('group'),pg_temp.client_id(39),'Visible after rejoin')->>'sequence',
  '8','Message after rejoin is stored');
SELECT pg_temp.login(7);
SELECT is((SELECT array_agg(sequence ORDER BY sequence::bigint DESC)
  FROM public.get_conversation_messages(pg_temp.fixture('group'))),
  ARRAY['8','6','5']::text[],'Rejoined member sees both periods but not the gap');
SELECT is(public.get_conversation_summary(pg_temp.fixture('group'))->>'last_read_sequence',
  '7','Rejoin cursor skips the hidden gap');
SELECT is(public.get_my_unread_message_count(),'1'::bigint,
  'Only post-rejoin incoming message is unread');
SELECT is(public.leave_group_conversation(pg_temp.fixture('group'),2),'left',
  'Non-owner can leave');
SELECT is(public.leave_group_conversation(pg_temp.fixture('group'),2),'left',
  'Leave retry is idempotent');
SELECT pg_temp.login(1);
SELECT is(public.send_conversation_message(
  pg_temp.fixture('group'),pg_temp.client_id(40),'Hidden after leave')->>'sequence',
  '9','Messages continue after member leaves');
SELECT pg_temp.login(7);
SELECT is((SELECT array_agg(sequence ORDER BY sequence::bigint DESC)
  FROM public.get_conversation_messages(pg_temp.fixture('group'))),
  ARRAY['8','6','5']::text[],'Left member retains bounded read-only history');
SELECT throws_ok($$SELECT * FROM public.get_group_members(pg_temp.fixture('group'))$$,
  '42501',NULL,'Left member cannot inspect current roster');

RESET ROLE;
SELECT is((SELECT count(*) FROM public.group_membership_periods
  WHERE conversation_id=pg_temp.fixture('group') AND profile_id=pg_temp.uid(7)),
  2::bigint,'Rejoin created a second immutable membership period');
SELECT is((SELECT array_agg(starts_after_sequence ORDER BY period_number)
  FROM public.group_membership_periods
  WHERE conversation_id=pg_temp.fixture('group') AND profile_id=pg_temp.uid(7)),
  ARRAY[4::bigint,7::bigint],'Period starts exclude pre-join and gap sequences');
SELECT is((SELECT array_agg(ends_at_sequence ORDER BY period_number)
  FROM public.group_membership_periods
  WHERE conversation_id=pg_temp.fixture('group') AND profile_id=pg_temp.uid(7)),
  ARRAY[6::bigint,8::bigint],'Period ends include the last visible sequence');
SELECT is((SELECT array_agg(end_reason ORDER BY period_number)
  FROM public.group_membership_periods
  WHERE conversation_id=pg_temp.fixture('group') AND profile_id=pg_temp.uid(7)),
  ARRAY['removed','left']::text[],'Each closed period records the action that ended it');

-- A self-leave retry can reconcile its exact old epoch indefinitely without
-- closing a later membership period or changing the management revision.
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
INSERT INTO fixtures VALUES('reinvite-7-third',public.invite_group_member(
  pg_temp.fixture('group'),pg_temp.client_id(41),pg_temp.uid(7),
  pg_temp.management_revision(pg_temp.fixture('group'))));
SELECT pg_temp.login(7);
SELECT is(public.respond_to_group_invitation(pg_temp.fixture('reinvite-7-third'),'accepted'),
  pg_temp.fixture('group'),'Former member can consent to a third membership period');
INSERT INTO revisions VALUES('before-old-leave-retry',
  pg_temp.management_revision(pg_temp.fixture('group')));
SELECT is(public.leave_group_conversation(pg_temp.fixture('group'),2),'left',
  'Old self-leave retry reconciles its own prior epoch');
SELECT is(public.get_conversation_summary(pg_temp.fixture('group'))->>'my_membership_status',
  'active','Old self-leave retry does not close the later epoch');
SELECT is((public.get_conversation_summary(pg_temp.fixture('group'))->>'my_membership_period')::integer,
  3,'Summary retains the current third membership epoch');
SELECT is(pg_temp.management_revision(pg_temp.fixture('group')),
  pg_temp.saved_revision('before-old-leave-retry'),
  'Old self-leave reconciliation does not advance management revision');

-- Revocation and owner-only role/ownership lifecycle.
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
INSERT INTO revisions VALUES('before-revoke-5',
  pg_temp.management_revision(pg_temp.fixture('group')));
SELECT is(public.revoke_group_invitation(pg_temp.fixture('invite-5'),
  pg_temp.saved_revision('before-revoke-5')),'revoked',
  'Manager can revoke a pending invitation');
SELECT is(public.revoke_group_invitation(pg_temp.fixture('invite-5'),
  pg_temp.saved_revision('before-revoke-5')),'revoked',
  'Revocation retry is idempotent');
SELECT pg_temp.login(5);
SELECT is((SELECT count(*) FROM public.get_my_group_invitations(20)),0::bigint,
  'Revoked invitation disappears from invitee inbox');
SELECT throws_ok($$SELECT public.respond_to_group_invitation(
  pg_temp.fixture('invite-5'),'accepted')$$,'55000',NULL,
  'Revoked invitation cannot be accepted');

SELECT pg_temp.login(1);
-- Changing a target role advances the revision, so a queued removal based on
-- the former role cannot remove that same membership period.
INSERT INTO revisions VALUES('before-promote-7-period-3',
  pg_temp.management_revision(pg_temp.fixture('group')));
SELECT is(public.set_group_member_role(pg_temp.fixture('group'),pg_temp.uid(7),3,
  'administrator',pg_temp.saved_revision('before-promote-7-period-3')),
  'administrator','Owner can promote the current membership epoch');
SELECT throws_ok($$SELECT public.remove_group_member(
  pg_temp.fixture('group'),pg_temp.uid(7),3,
  pg_temp.saved_revision('before-promote-7-period-3'))$$,
  '55000',NULL,'A queued removal fails after the target role changes');
SELECT is(public.set_group_member_role(pg_temp.fixture('group'),pg_temp.uid(7),3,
  'member',pg_temp.management_revision(pg_temp.fixture('group'))),
  'member','Owner can restore the target member role');
SELECT throws_ok($$SELECT public.set_group_member_role(
  pg_temp.fixture('group'),pg_temp.uid(7),3,'administrator',
  pg_temp.saved_revision('before-promote-7-period-3'))$$,
  '55000',NULL,'A delayed role replay cannot revive a cycled role');

-- A title cycle and another roster command invalidate queued mutations, while
-- the immediate lost-response rename retry remains safe.
INSERT INTO revisions VALUES('before-final-rename',
  pg_temp.management_revision(pg_temp.fixture('group')));
SELECT is(public.rename_group_conversation(pg_temp.fixture('group'),'Final Crew',
  pg_temp.saved_revision('before-final-rename')),
  'Final Crew','Owner can rename from one management snapshot');
SELECT is(public.rename_group_conversation(pg_temp.fixture('group'),'Final Crew',
  pg_temp.saved_revision('before-final-rename')),
  'Final Crew','Immediate rename retry reconciles at expected revision plus one');
SELECT throws_ok($$SELECT public.rename_group_conversation(
  pg_temp.fixture('group'),'Systems Crew',
  pg_temp.saved_revision('before-first-rename'))$$,
  '55000',NULL,'A delayed old rename cannot overwrite a later title');
SELECT throws_ok($$SELECT public.invite_group_member(
  pg_temp.fixture('group'),pg_temp.client_id(42),pg_temp.uid(8),
  pg_temp.saved_revision('before-final-rename'))$$,
  '55000',NULL,'A delayed new invitation cannot resurrect stale manager state');

SELECT is(public.set_group_member_role(pg_temp.fixture('group'),pg_temp.uid(2),1,'member',
  pg_temp.management_revision(pg_temp.fixture('group'))),
  'member','Owner can demote an administrator');
SELECT throws_ok($$SELECT public.set_group_member_role(
  pg_temp.fixture('group'),pg_temp.uid(2),1,'administrator',
  pg_temp.saved_revision('before-promote'))$$,
  '55000',NULL,'A delayed promotion cannot revive a cycled role');
SELECT pg_temp.login(2);
SELECT throws_ok($$SELECT public.rename_group_conversation(
  pg_temp.fixture('group'),'No longer manager',
  pg_temp.management_revision(pg_temp.fixture('group')))$$,'42501',NULL,
  'Demoted member loses management access');
SELECT is(public.invite_group_member(
  pg_temp.fixture('group'),pg_temp.client_id(32),pg_temp.uid(7),0),
  pg_temp.fixture('invite-7'),
  'A committed invitation retry reconciles after the inviter is demoted');
SELECT pg_temp.login(1);
INSERT INTO revisions VALUES('before-first-transfer',
  pg_temp.management_revision(pg_temp.fixture('group')));
SELECT is(public.transfer_group_ownership(pg_temp.fixture('group'),pg_temp.uid(2),1,
  pg_temp.saved_revision('before-first-transfer')),
  'transferred','Owner can transfer ownership to an active member');
SELECT is(public.transfer_group_ownership(pg_temp.fixture('group'),pg_temp.uid(2),1,
  pg_temp.saved_revision('before-first-transfer')),
  'transferred','Former owner can reconcile the immediate ownership-transfer retry');
SELECT pg_temp.login(2);
SELECT is(public.transfer_group_ownership(pg_temp.fixture('group'),pg_temp.uid(1),1,
  pg_temp.management_revision(pg_temp.fixture('group'))),
  'transferred','Current owner can transfer ownership back');
SELECT pg_temp.login(1);
SELECT throws_ok($$SELECT public.transfer_group_ownership(
  pg_temp.fixture('group'),pg_temp.uid(2),1,
  pg_temp.saved_revision('before-first-transfer'))$$,
  '55000',NULL,'A delayed transfer cannot replay after ownership cycles back');
SELECT is(public.transfer_group_ownership(pg_temp.fixture('group'),pg_temp.uid(2),1,
  pg_temp.management_revision(pg_temp.fixture('group'))),
  'transferred','Owner can issue a fresh transfer from current revision');
SELECT is(public.get_conversation_summary(pg_temp.fixture('group'))->>'my_role',
  'administrator','Former owner becomes administrator');
SELECT is(public.leave_group_conversation(pg_temp.fixture('group'),1),'left',
  'Former owner may leave after transfer');
SELECT pg_temp.login(2);
SELECT is(public.get_conversation_summary(pg_temp.fixture('group'))->>'my_role',
  'owner','Recipient becomes owner');
SELECT throws_ok($$SELECT public.leave_group_conversation(pg_temp.fixture('group'),1)$$,
  '55000',NULL,'Sole active owner must transfer before leaving');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.conversation_members
  WHERE conversation_id=pg_temp.fixture('group')
    AND membership_status='active' AND role='owner'),1::bigint,
  'Group keeps exactly one active owner');

-- Capacity counts active plus pending members under the parent lock.
UPDATE public.profiles SET is_discoverable=true,onboarding_completed_at=clock_timestamp()
WHERE id IN (pg_temp.uid(4),pg_temp.uid(5));
INSERT INTO public.course_memberships(course_id,profile_id,status)
VALUES ('c030c030-c030-4030-8030-000000000001',pg_temp.uid(6),'enrolled');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(10);
INSERT INTO fixtures VALUES('full-group',public.create_group_conversation(
  pg_temp.client_id(50),'c030c030-c030-4030-8030-000000000001','Full Group',
  ARRAY(SELECT pg_temp.uid(i) FROM generate_series(1,9) i
        UNION ALL SELECT pg_temp.uid(i) FROM generate_series(11,20) i)));
SELECT is((SELECT active_member_count FROM public.get_my_conversations()
  WHERE id=pg_temp.fixture('full-group')),1,
  'Pending capacity does not inflate active count');
SELECT is((SELECT count(*) FROM public.get_group_pending_invitations(pg_temp.fixture('full-group'))),
  19::bigint,'A group may hold owner plus nineteen pending invitees');
SELECT throws_ok($$SELECT public.invite_group_member(
  pg_temp.fixture('full-group'),pg_temp.client_id(51),pg_temp.uid(21),
  pg_temp.management_revision(pg_temp.fixture('full-group')))$$,
  '55000',NULL,'Twentieth pending invite is rejected at total cap twenty');

-- Outsiders cannot discover or operate on the invite-only room.
SELECT pg_temp.login(21);
SELECT is((SELECT count(*) FROM public.get_my_conversations()
  WHERE id=pg_temp.fixture('group')),0::bigint,
  'Outsider inbox has no group metadata');
SELECT throws_ok($$SELECT public.get_conversation_summary(pg_temp.fixture('group'))$$,
  '42501',NULL,'Known group UUID does not authorize an outsider summary');
SELECT throws_ok($$SELECT * FROM public.get_conversation_messages(pg_temp.fixture('group'))$$,
  '42501',NULL,'Known group UUID does not authorize history');
SELECT throws_ok($$SELECT * FROM public.get_group_members(pg_temp.fixture('group'))$$,
  '42501',NULL,'Known group UUID does not authorize roster');
SELECT throws_ok($$SELECT public.get_group_management_snapshot(pg_temp.fixture('group'))$$,
  '42501',NULL,'Known group UUID does not authorize manager snapshot');
SELECT throws_ok($$SELECT public.send_conversation_message(
  pg_temp.fixture('group'),pg_temp.client_id(52),'Outsider')$$,
  '42501',NULL,'Outsider cannot send to known group');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
