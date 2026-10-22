BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT no_plan();

INSERT INTO auth.users(id,email)
SELECT ('c110c110-c110-4110-8110-'||lpad(i::text,12,'0'))::uuid,
  'group-pages-'||i||'@test.local'
FROM generate_series(1,7) i;

CREATE FUNCTION pg_temp.uid(i integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('c110c110-c110-4110-8110-'||lpad(i::text,12,'0'))::uuid;
$$;
CREATE FUNCTION pg_temp.client_id(i integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('d110d110-d110-4110-8110-'||lpad(i::text,12,'0'))::uuid;
$$;
CREATE FUNCTION pg_temp.login(i integer) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub',pg_temp.uid(i)::text,true);
$$;

UPDATE public.profiles
SET display_name='Group Page Tester '||right(id::text,2),
  major='Computing Science', year_of_study=2,
  campus_id=(SELECT id FROM public.campuses WHERE slug='burnaby'),
  is_discoverable=true, onboarding_completed_at=clock_timestamp()
WHERE id IN (SELECT pg_temp.uid(i) FROM generate_series(1,7) i);

INSERT INTO public.academic_terms(
  id,code,display_name,year,season,starts_on,ends_on,status
) VALUES (
  'c120c120-c120-4120-8120-000000000001','2102-fall','Fall 2102',2102,
  'fall','2102-09-01','2102-12-31','current'
);
INSERT INTO public.courses(id,code,title,term_id,campus_id,status)
VALUES (
  'c130c130-c130-4130-8130-000000000001','CMPT 420','Paged Groups',
  'c120c120-c120-4120-8120-000000000001',
  (SELECT id FROM public.campuses WHERE slug='burnaby'),'active'
);
INSERT INTO public.course_memberships(course_id,profile_id,status)
SELECT 'c130c130-c130-4130-8130-000000000001',pg_temp.uid(i),'enrolled'
FROM generate_series(1,7) i;

CREATE TEMP TABLE fixtures(name text PRIMARY KEY,id uuid);
GRANT ALL ON fixtures TO authenticated;
CREATE FUNCTION pg_temp.fixture(p_name text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM fixtures WHERE name=p_name;
$$;
CREATE FUNCTION pg_temp.management_revision(p_conversation_id uuid)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT management_revision FROM public.group_conversations
  WHERE conversation_id=p_conversation_id;
$$;

SELECT ok(
  NOT has_function_privilege(
    'anon','public.get_my_group_invitations_page(integer,timestamp with time zone,uuid)','EXECUTE')
  AND NOT has_function_privilege(
    'anon','public.get_my_former_group_conversations(integer,timestamp with time zone,uuid)','EXECUTE'),
  'Anonymous callers cannot page group invitations or former groups'
);
SELECT ok(
  has_function_privilege(
    'authenticated','public.get_my_group_invitations_page(integer,timestamp with time zone,uuid)','EXECUTE')
  AND has_function_privilege(
    'authenticated','public.get_my_former_group_conversations(integer,timestamp with time zone,uuid)','EXECUTE'),
  'Authenticated callers can use both narrow discovery RPCs'
);
SELECT is(
  (SELECT p.proargnames[1:p.pronargs] FROM pg_proc p
   JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='get_my_group_invitations_page'),
  ARRAY['p_limit','p_before_created_at','p_before_id']::text[],
  'Invitation page exposes the stable named cursor contract'
);
SELECT is(
  (SELECT p.proargnames[1:p.pronargs] FROM pg_proc p
   JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='get_my_former_group_conversations'),
  ARRAY['p_limit','p_before_activity_at','p_before_id']::text[],
  'Former group page exposes the shared conversation cursor contract'
);

SET LOCAL ROLE authenticated;

-- Group A: user 2 is removed after seeing one message.
SELECT pg_temp.login(1);
INSERT INTO fixtures VALUES('former-removed',public.create_group_conversation(
  pg_temp.client_id(1),'c130c130-c130-4130-8130-000000000001',
  'Former Removed',ARRAY[pg_temp.uid(2)]));
RESET ROLE;
INSERT INTO fixtures
SELECT 'invite-former-removed',id FROM public.group_conversation_invitations
WHERE conversation_id=pg_temp.fixture('former-removed') AND invitee_profile_id=pg_temp.uid(2);
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(2);
SELECT is(public.respond_to_group_invitation(
  pg_temp.fixture('invite-former-removed'),'accepted'),
  pg_temp.fixture('former-removed'),'User 2 accepts the first former-group fixture');
SELECT pg_temp.login(1);
SELECT is(public.send_conversation_message(
  pg_temp.fixture('former-removed'),pg_temp.client_id(2),'Visible removed history')->>'body',
  'Visible removed history','First former group stores one visible message');
SELECT is(public.remove_group_member(
  pg_temp.fixture('former-removed'),pg_temp.uid(2),1,
  pg_temp.management_revision(pg_temp.fixture('former-removed'))),
  'removed','Owner removes user 2 from the first former group');

-- Group B: user 2 leaves after seeing a later message.
SELECT pg_temp.login(3);
INSERT INTO fixtures VALUES('former-left',public.create_group_conversation(
  pg_temp.client_id(3),'c130c130-c130-4130-8130-000000000001',
  'Former Left',ARRAY[pg_temp.uid(2)]));
RESET ROLE;
INSERT INTO fixtures
SELECT 'invite-former-left',id FROM public.group_conversation_invitations
WHERE conversation_id=pg_temp.fixture('former-left') AND invitee_profile_id=pg_temp.uid(2);
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(2);
SELECT is(public.respond_to_group_invitation(
  pg_temp.fixture('invite-former-left'),'accepted'),
  pg_temp.fixture('former-left'),'User 2 accepts the second former-group fixture');
SELECT pg_temp.login(3);
SELECT is(public.send_conversation_message(
  pg_temp.fixture('former-left'),pg_temp.client_id(4),'Visible left history')->>'body',
  'Visible left history','Second former group stores one visible message');
SELECT pg_temp.login(2);
SELECT is(public.leave_group_conversation(pg_temp.fixture('former-left'),1),
  'left','User 2 leaves the second former group');

-- Group C remains active for user 2 and must stay in the ordinary inbox only.
SELECT pg_temp.login(6);
INSERT INTO fixtures VALUES('active',public.create_group_conversation(
  pg_temp.client_id(5),'c130c130-c130-4130-8130-000000000001',
  'Still Active',ARRAY[pg_temp.uid(2)]));
RESET ROLE;
INSERT INTO fixtures
SELECT 'invite-active',id FROM public.group_conversation_invitations
WHERE conversation_id=pg_temp.fixture('active') AND invitee_profile_id=pg_temp.uid(2);
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(2);
SELECT is(public.respond_to_group_invitation(
  pg_temp.fixture('invite-active'),'accepted'),
  pg_temp.fixture('active'),'User 2 accepts the active-group fixture');

-- Groups D/E remain pending for user 2 and share a timestamp to exercise UUID tie-breaking.
SELECT pg_temp.login(4);
INSERT INTO fixtures VALUES('pending-one',public.create_group_conversation(
  pg_temp.client_id(6),'c130c130-c130-4130-8130-000000000001',
  'Pending One',ARRAY[pg_temp.uid(2)]));
SELECT pg_temp.login(5);
INSERT INTO fixtures VALUES('pending-two',public.create_group_conversation(
  pg_temp.client_id(7),'c130c130-c130-4130-8130-000000000001',
  'Pending Two',ARRAY[pg_temp.uid(2)]));
RESET ROLE;
INSERT INTO fixtures
SELECT 'invite-pending-one',id FROM public.group_conversation_invitations
WHERE conversation_id=pg_temp.fixture('pending-one') AND invitee_profile_id=pg_temp.uid(2);
INSERT INTO fixtures
SELECT 'invite-pending-two',id FROM public.group_conversation_invitations
WHERE conversation_id=pg_temp.fixture('pending-two') AND invitee_profile_id=pg_temp.uid(2);
UPDATE public.group_conversation_invitations
SET created_at='2200-01-01T00:00:00Z'
WHERE id IN (pg_temp.fixture('invite-pending-one'),pg_temp.fixture('invite-pending-two'));
UPDATE public.messages SET created_at='2199-01-02T00:00:00Z'
WHERE conversation_id=pg_temp.fixture('former-removed');
UPDATE public.messages SET created_at='2199-01-02T00:00:00Z'
WHERE conversation_id=pg_temp.fixture('former-left');

SET LOCAL ROLE authenticated;
SELECT pg_temp.login(2);

SELECT is((SELECT count(*) FROM public.get_my_group_invitations(20)),2::bigint,
  'Legacy invitation RPC remains compatible and returns both pending rows');
SELECT is((SELECT count(*) FROM public.get_my_group_invitations_page(20,NULL,NULL)),2::bigint,
  'Paged invitation RPC returns all pending rows on an unbounded first page');
SELECT ok((
  WITH first_page AS (
    SELECT * FROM public.get_my_group_invitations_page(1,NULL,NULL)
  ), second_page AS (
    SELECT next_page.*
    FROM first_page
    CROSS JOIN LATERAL public.get_my_group_invitations_page(
      1,first_page.created_at,first_page.id
    ) next_page
  ), both_pages AS (
    SELECT id FROM first_page UNION ALL SELECT id FROM second_page
  )
  SELECT count(*)=2 AND count(DISTINCT id)=2
    AND bool_and(id IN (
      pg_temp.fixture('invite-pending-one'),pg_temp.fixture('invite-pending-two')
    ))
  FROM both_pages
), 'Invitation keyset cursor reaches both equal-time rows exactly once');
SELECT throws_ok(
  $$SELECT * FROM public.get_my_group_invitations_page(20,clock_timestamp(),NULL)$$,
  '22023',NULL,'Invitation cursor requires both timestamp and UUID');
SELECT throws_ok(
  $$SELECT * FROM public.get_my_group_invitations_page(51,NULL,NULL)$$,
  '22023',NULL,'Invitation page size stays bounded');

SELECT is((SELECT count(*) FROM public.get_my_former_group_conversations(20,NULL,NULL)),
  2::bigint,'Former group page rediscovers both bounded histories');
SELECT ok((
  WITH first_page AS (
    SELECT * FROM public.get_my_former_group_conversations(1,NULL,NULL)
  ), second_page AS (
    SELECT next_page.*
    FROM first_page
    CROSS JOIN LATERAL public.get_my_former_group_conversations(
      1,first_page.last_activity_at,first_page.id
    ) next_page
  ), both_pages AS (
    SELECT * FROM first_page UNION ALL SELECT * FROM second_page
  )
  SELECT count(*)=2 AND count(DISTINCT id)=2
    AND bool_and(id IN (
      pg_temp.fixture('former-removed'),pg_temp.fixture('former-left')
    ))
    AND bool_and(type='group')
    AND bool_and(my_membership_status IN ('left','removed'))
    AND bool_and(active_member_count=0)
    AND bool_and(management_revision='0')
    AND bool_and(NOT can_send)
  FROM both_pages
), 'Former-group keyset pages traverse equal-time UUID ties once and stay privacy masked');
SELECT is((SELECT count(*) FROM public.get_my_former_group_conversations(20,NULL,NULL)
  WHERE id=pg_temp.fixture('active')),0::bigint,
  'Active groups never appear in former history discovery');
SELECT is((SELECT count(*) FROM public.get_my_conversations()
  WHERE id=pg_temp.fixture('active')),1::bigint,
  'Active group remains in the ordinary mixed inbox');
SELECT is((SELECT count(*) FROM public.get_my_conversations()
  WHERE id IN (pg_temp.fixture('former-removed'),pg_temp.fixture('former-left'))),
  0::bigint,'Former groups remain absent from the active mixed inbox');
SELECT is((SELECT count(*) FROM public.get_conversation_messages(
  pg_temp.fixture('former-removed'),NULL,30)),1::bigint,
  'Rediscovered removed membership retains its bounded message history');
SELECT is((SELECT count(*) FROM public.get_conversation_messages(
  pg_temp.fixture('former-left'),NULL,30)),1::bigint,
  'Rediscovered left membership retains its bounded message history');
SELECT throws_ok(
  $$SELECT * FROM public.get_my_former_group_conversations(20,'infinity',gen_random_uuid())$$,
  '22023',NULL,'Former-group cursor rejects non-finite timestamps');
SELECT throws_ok(
  $$SELECT * FROM public.get_my_former_group_conversations(20,NULL,gen_random_uuid())$$,
  '22023',NULL,'Former-group cursor requires both activity and UUID');
SELECT throws_ok(
  $$SELECT * FROM public.get_my_former_group_conversations(0,NULL,NULL)$$,
  '22023',NULL,'Former-group page size stays bounded');

SELECT pg_temp.login(7);
SELECT is((SELECT count(*) FROM public.get_my_group_invitations_page(20,NULL,NULL)),
  0::bigint,'Uninvited account sees no invitation previews');
SELECT is((SELECT count(*) FROM public.get_my_former_group_conversations(20,NULL,NULL)),
  0::bigint,'Outsider sees no former group metadata');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
