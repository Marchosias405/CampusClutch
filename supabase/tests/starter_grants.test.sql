BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT no_plan();

-- All accounts, grants, private claims and injected failures roll back.
CREATE FUNCTION pg_temp.uid(i integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('b130b130-b130-4130-8130-'||lpad(i::text,12,'0'))::uuid;
$$;
CREATE FUNCTION pg_temp.login(i integer) RETURNS text LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub',pg_temp.uid(i)::text,true);
$$;
CREATE FUNCTION pg_temp.balance(i integer) RETURNS bigint LANGUAGE sql AS $$
 SELECT balance FROM public.points_wallets WHERE profile_id=pg_temp.uid(i);
$$;
CREATE FUNCTION pg_temp.grants(i integer) RETURNS bigint LANGUAGE sql AS $$
 SELECT count(*) FROM public.points_ledger WHERE profile_id=pg_temp.uid(i) AND kind='starter_grant';
$$;
CREATE FUNCTION pg_temp.claimed(email text) RETURNS boolean LANGUAGE sql AS $$
 SELECT EXISTS(SELECT 1 FROM points_private.starter_grant_claims
   WHERE email_fingerprint=points_private.email_fingerprint(email));
$$;

SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class
 WHERE oid IN ('points_private.email_key'::regclass,'points_private.starter_grant_claims'::regclass)),
 'Both private tables enable RLS as defense in depth');
SELECT is((SELECT count(*) FROM pg_constraint
 WHERE conrelid='points_private.starter_grant_claims'::regclass AND contype='f'),0::bigint,
 'Grant claims have no foreign key that could cascade away on account deletion');
SELECT is(octet_length(points_private.email_fingerprint('starter-hash@test.local')),32,
 'Email fingerprint uses a fixed 32-byte keyed digest');
SELECT is(points_private.email_fingerprint('  Starter-Hash@Test.Local  '),
 points_private.email_fingerprint('starter-hash@test.local'),'Email case and surrounding whitespace share one fingerprint');
SELECT isnt(points_private.email_fingerprint('starter-hash@test.local'),
 digest('starter-hash@test.local','sha256'),'Fingerprint is not an unkeyed email digest');

INSERT INTO auth.users(id,email,email_confirmed_at)
VALUES(pg_temp.uid(1),'starter-once-1@test.local',now());
SELECT is(pg_temp.balance(1),100::bigint,'A first verified email receives 100 welcome points');
SELECT is(pg_temp.grants(1),1::bigint,'The first verified email has exactly one starter ledger entry');
SELECT ok(pg_temp.claimed('starter-once-1@test.local'),'The first grant records a persistent email claim');
SELECT points_private.grant_starter_points(pg_temp.uid(1));
UPDATE auth.users SET email_confirmed_at=now() WHERE id=pg_temp.uid(1);
UPDATE public.profiles SET display_name='Starter Tester' WHERE id=pg_temp.uid(1);
SELECT is(pg_temp.balance(1),100::bigint,'Repeated grant attempts, confirmation and profile edits do not mint points');
SELECT is(pg_temp.grants(1),1::bigint,'Repeated attempts do not create another ledger entry');

INSERT INTO auth.users(id,email,raw_user_meta_data)
VALUES(pg_temp.uid(2),'starter-pending@test.local','{"email_verified":true}');
SELECT is(pg_temp.balance(2),0::bigint,'Unverified signup creates a zero-balance wallet despite user-controlled metadata');
SELECT is(pg_temp.grants(2),0::bigint,'Unverified signup has no starter ledger entry');
SELECT ok(NOT pg_temp.claimed('starter-pending@test.local'),'Unverified signup does not consume the email entitlement');
UPDATE auth.users SET email_confirmed_at=now() WHERE id=pg_temp.uid(2);
SELECT is(pg_temp.balance(2),100::bigint,'First email verification awards the welcome points');
SELECT is(pg_temp.grants(2),1::bigint,'Confirmation creates exactly one starter ledger entry');

-- Reproduce the reported exploit using the real posting/offer/settlement RPCs.
UPDATE public.profiles SET display_name='Starter Transfer Tester',onboarding_completed_at=now()
WHERE id IN (pg_temp.uid(1),pg_temp.uid(2));
CREATE TEMP TABLE starter_fixtures(name text PRIMARY KEY,id uuid);
GRANT ALL ON starter_fixtures TO authenticated;
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
INSERT INTO starter_fixtures VALUES('request',public.save_my_request(jsonb_build_object(
 'category','delivery','title','Starter points test','description','Temporary point transfer test.',
 'campus_id',(SELECT id FROM public.campuses WHERE slug='burnaby'),'room_location','Library',
 'deadline_at',clock_timestamp()+interval '1 day','points',100,'item_size','small',
 'details','{"pickup_location":"Cafe","dropoff_location":"Library"}'::jsonb)));
SELECT pg_temp.login(2);
INSERT INTO starter_fixtures VALUES('offer',public.create_my_request_offer_for_terms(
 (SELECT id FROM starter_fixtures WHERE name='request'),1,100));
SELECT pg_temp.login(1);
SELECT public.decide_request_offer_for_round((SELECT id FROM starter_fixtures WHERE name='offer'),'accepted',1,100);
SELECT is((public.get_my_points()->>'reserved')::integer,100,'Acceptance reserves the original welcome points');
SELECT public.complete_my_request((SELECT id FROM starter_fixtures WHERE name='request'),1);
SELECT is((public.get_my_points()->>'balance')::integer,0,'Poster completion spends the original welcome points');
RESET ROLE;
SELECT is(pg_temp.balance(2),200::bigint,'Helper receives the real transfer once');
-- Admin cleanup of only this transactional fixture removes restrictive history.
-- Remove dependent bell notices before the offer/request cascade, matching the
-- notification integration harness's child-first cleanup order.
DELETE FROM public.notifications
WHERE request_id=(SELECT id FROM starter_fixtures WHERE name='request');
DELETE FROM public.requests WHERE id=(SELECT id FROM starter_fixtures WHERE name='request');
DELETE FROM auth.users WHERE id=pg_temp.uid(1);
SELECT ok(pg_temp.claimed('starter-once-1@test.local'),'Deleting the paid-out account preserves its email claim');
INSERT INTO auth.users(id,email,email_confirmed_at)
VALUES(pg_temp.uid(3),'starter-once-1@test.local',now());
SELECT is(pg_temp.balance(3),0::bigint,'Recreating the paid-out email under a new account ID grants zero welcome points');
SELECT is(pg_temp.grants(3),0::bigint,'Recreated account receives no new starter ledger entry');
SELECT is(pg_temp.balance(2),200::bigint,'Deleting and recreating the poster does not change the helper payment');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(3);
SELECT is((public.get_my_points()->>'available')::integer,0,'Existing wallet API supports a recreated account with zero available points');
SELECT is(jsonb_array_length(public.get_my_points()->'history'),0,'Recreated wallet exposes empty history, not an invented grant');
RESET ROLE;
DELETE FROM auth.users WHERE id=pg_temp.uid(3);
INSERT INTO auth.users(id,email,email_confirmed_at)
VALUES(pg_temp.uid(4),'  STARTER-ONCE-1@Test.Local  ',now());
SELECT is(pg_temp.balance(4),0::bigint,'Email case and whitespace cannot bypass a consumed grant');

-- An unverified signup cannot deny the real address owner their first grant.
INSERT INTO auth.users(id,email) VALUES(pg_temp.uid(5),'starter-unverified-delete@test.local');
DELETE FROM auth.users WHERE id=pg_temp.uid(5);
INSERT INTO auth.users(id,email,email_confirmed_at)
VALUES(pg_temp.uid(6),'starter-unverified-delete@test.local',now());
SELECT is(pg_temp.balance(6),100::bigint,'Deleting an unverified account does not burn the legitimate first grant');

INSERT INTO auth.users(id,email,email_confirmed_at)
VALUES(pg_temp.uid(7),'starter-old-address@test.local',now());
UPDATE auth.users SET email_change='starter-pending-address@test.local' WHERE id=pg_temp.uid(7);
SELECT ok(NOT pg_temp.claimed('starter-pending-address@test.local'),'A pending email change does not claim the unverified destination');
UPDATE auth.users SET email='starter-new-address@test.local',email_confirmed_at=now() WHERE id=pg_temp.uid(7);
SELECT is(pg_temp.balance(7),100::bigint,'Changing a verified email never grants an already-credited account another 100');
SELECT is(pg_temp.grants(7),1::bigint,'Email change preserves the single starter ledger event');
SELECT ok(pg_temp.claimed('starter-old-address@test.local'),'Email change preserves the old email claim');
SELECT ok(pg_temp.claimed('starter-new-address@test.local'),'New confirmed email is bound to the existing starter grant');
DELETE FROM auth.users WHERE id=pg_temp.uid(7);
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 (pg_temp.uid(8),'starter-old-address@test.local',now()),
 (pg_temp.uid(9),'starter-new-address@test.local',now());
SELECT is(pg_temp.balance(8),0::bigint,'Recreating the previous email cannot regrant');
SELECT is(pg_temp.balance(9),0::bigint,'Recreating the changed-to email cannot regrant');

INSERT INTO auth.users(id,email,email_confirmed_at,is_anonymous) VALUES
 (pg_temp.uid(10),'starter-anonymous@test.local',now(),true);
SELECT is(pg_temp.balance(10),0::bigint,'Anonymous identities cannot receive welcome points');
SELECT ok(NOT pg_temp.claimed('starter-anonymous@test.local'),'Anonymous identity does not consume an email claim');
UPDATE auth.users SET is_anonymous=false WHERE id=pg_temp.uid(10);
SELECT is(pg_temp.balance(10),100::bigint,'A verified conversion from anonymous can receive its first grant');
INSERT INTO auth.users(id,email,email_confirmed_at,deleted_at)
VALUES(pg_temp.uid(11),'starter-deleted@test.local',now(),now());
SELECT is(pg_temp.balance(11),0::bigint,'Soft-deleted identities do not receive a grant');
SELECT ok(NOT pg_temp.claimed('starter-deleted@test.local'),'Soft deletion cannot claim a rewritten email');
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 (pg_temp.uid(12),NULL,now()),(pg_temp.uid(13),'   ',now());
SELECT is(pg_temp.balance(12),0::bigint,'A missing email cannot receive welcome points');
SELECT is(pg_temp.balance(13),0::bigint,'A blank email cannot receive welcome points');
UPDATE auth.users SET email='starter-later-email@test.local',email_confirmed_at=now() WHERE id=pg_temp.uid(12);
SELECT is(pg_temp.balance(12),100::bigint,'First confirmed email can fund an existing zero wallet');

-- The claim, wallet credit and ledger event must be one atomic transaction.
CREATE FUNCTION pg_temp.fail_starter_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.profile_id=pg_temp.uid(14) AND NEW.kind='starter_grant' THEN
   RAISE EXCEPTION 'Injected starter ledger failure';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER starter_test_failure BEFORE INSERT ON public.points_ledger
 FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_starter_entry();
SELECT throws_ok($$INSERT INTO auth.users(id,email,email_confirmed_at)
 VALUES(pg_temp.uid(14),'starter-atomic@test.local',now())$$,'P0001','Injected starter ledger failure',
 'A ledger failure aborts signup instead of partially granting points');
SELECT ok(NOT EXISTS(SELECT 1 FROM auth.users WHERE id=pg_temp.uid(14)),'Failed grant rolls back the Auth account');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.points_wallets WHERE profile_id=pg_temp.uid(14)),'Failed grant rolls back the wallet');
SELECT ok(NOT pg_temp.claimed('starter-atomic@test.local'),'Failed grant rolls back the email claim');
DROP TRIGGER starter_test_failure ON public.points_ledger;
INSERT INTO auth.users(id,email,email_confirmed_at)
VALUES(pg_temp.uid(14),'starter-atomic@test.local',now());
SELECT is(pg_temp.balance(14),100::bigint,'A clean retry after rollback can still receive the first grant');

SELECT ok(NOT has_schema_privilege(role,'points_private','USAGE'),role||' has no private schema access')
FROM unnest(ARRAY['anon','authenticated','service_role']) role;
SELECT ok(NOT has_table_privilege(role,'points_private.email_key','SELECT,INSERT,UPDATE,DELETE'),role||' cannot access the fingerprint key')
FROM unnest(ARRAY['anon','authenticated','service_role']) role;
SELECT ok(NOT has_table_privilege(role,'points_private.starter_grant_claims','SELECT,INSERT,UPDATE,DELETE'),role||' cannot read or reset email claims')
FROM unnest(ARRAY['anon','authenticated','service_role']) role;
SELECT ok(NOT has_function_privilege(role,'points_private.email_fingerprint(text)','EXECUTE'),role||' cannot probe email fingerprints')
FROM unnest(ARRAY['anon','authenticated','service_role']) role;
SELECT ok(NOT has_function_privilege(role,'points_private.grant_starter_points(uuid)','EXECUTE'),role||' cannot invoke the grant helper')
FROM unnest(ARRAY['anon','authenticated','service_role']) role;
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(4);
SELECT throws_ok($$SELECT * FROM points_private.starter_grant_claims$$,'42501',NULL,'Client SQL cannot read claim history');
SELECT throws_ok($$DELETE FROM points_private.starter_grant_claims$$,'42501',NULL,'Client SQL cannot remove consumed claims');
SELECT throws_ok($$SELECT points_private.grant_starter_points(pg_temp.uid(4))$$,'42501',NULL,'Client SQL cannot mint a welcome grant');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
