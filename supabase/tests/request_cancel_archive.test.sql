BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT no_plan();

-- All accounts, wallet events, injected faults and request history roll back.
INSERT INTO auth.users(id,email)
SELECT ('96969696-9696-4969-8969-'||lpad(i::text,12,'0'))::uuid,
 'cancel-archive-'||i||'@test.local' FROM generate_series(1,6) i;
CREATE FUNCTION pg_temp.uid(i integer) RETURNS uuid LANGUAGE sql AS $$
 SELECT ('96969696-9696-4969-8969-'||lpad(i::text,12,'0'))::uuid;
$$;
UPDATE public.profiles SET display_name='Cancel Archive Tester',major='Computing Science',year_of_study=2,
 campus_id=(SELECT id FROM public.campuses WHERE slug='burnaby')
WHERE id IN (SELECT pg_temp.uid(i) FROM generate_series(1,6) i);
CREATE FUNCTION pg_temp.login(i integer) RETURNS text LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub',pg_temp.uid(i)::text,true);
$$;
CREATE FUNCTION pg_temp.payload(points integer DEFAULT 10) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('category','delivery','title','Cancel archive test','description','Please help with this request.',
 'campus_id',(SELECT id FROM public.campuses WHERE slug='burnaby'),'room_location','Library',
 'deadline_at','2099-01-01T00:00:00Z','points',points,'item_size','small',
 'details','{"pickup_location":"Cafe","dropoff_location":"Library"}'::jsonb);
$$;
CREATE TEMP TABLE fixtures(name text PRIMARY KEY,id uuid);
GRANT ALL ON fixtures TO authenticated;
CREATE FUNCTION pg_temp.fixture(p_name text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM fixtures WHERE name=p_name; $$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
INSERT INTO fixtures VALUES('main',public.save_my_request(pg_temp.payload(40))),
 ('side',public.save_my_request(pg_temp.payload(20))),('stale',public.save_my_request(pg_temp.payload(10)));
SELECT pg_temp.login(2);
INSERT INTO fixtures VALUES('main-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('main'),1,40)),
 ('side-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('side'),1,20)),
 ('stale-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('stale'),1,10));
SELECT pg_temp.login(3);
INSERT INTO fixtures VALUES('main-other',public.create_my_request_offer_for_terms(pg_temp.fixture('main'),1,40));
SELECT pg_temp.login(1);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('main-offer'),'accepted',1,40);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('side-offer'),'accepted',1,20);
SELECT is((public.get_my_points()->>'reserved')::integer,60,'Two accepted requests have distinct holds');
SELECT throws_ok($$SELECT public.set_my_request_archived(pg_temp.fixture('main'),true)$$,'22023',NULL,'Accepted work cannot be hidden as archived');
SELECT throws_ok($$SELECT public.set_my_request_archived(pg_temp.fixture('stale'),true)$$,'22023',NULL,'Unexpired open work cannot be archived');
SELECT throws_ok($$SELECT public.cancel_my_request_for_round(pg_temp.fixture('main'),1,'open')$$,'22023',NULL,'A stale open-request dialog cannot cancel newly accepted work in the same round');
SELECT throws_ok($$SELECT public.cancel_my_request_for_round(pg_temp.fixture('main'),NULL,'accepted')$$,'22023',NULL,'Cancellation needs a reviewed round');
SELECT throws_ok($$SELECT public.cancel_my_request_for_round(pg_temp.fixture('main'),0,'accepted')$$,'22023',NULL,'Cancellation rejects round zero');
SELECT throws_ok($$SELECT public.cancel_my_request_for_round(pg_temp.fixture('main'),2,'accepted')$$,'22023',NULL,'Cancellation rejects a different round');
SELECT throws_ok($$SELECT public.cancel_my_request_for_round(pg_temp.fixture('main'),1,NULL)$$,'22023',NULL,'Cancellation needs a reviewed status');
SELECT throws_ok($$SELECT public.cancel_my_request_for_round(pg_temp.fixture('main'),1,'completed')$$,'22023',NULL,'Cancellation rejects unsupported expected status');
SELECT is((public.get_my_points()->>'reserved')::integer,60,'Invalid cancellation leaves both holds intact');
SELECT pg_temp.login(2);
SELECT throws_ok($$SELECT public.cancel_my_request_for_round(pg_temp.fixture('main'),1,'accepted')$$,'42501',NULL,'Selected helper cannot cancel the poster request');
SELECT throws_ok($$SELECT public.set_my_request_archived(pg_temp.fixture('main'),true)$$,'42501',NULL,'Selected helper cannot archive the poster request');
SELECT pg_temp.login(3);
SELECT throws_ok($$SELECT public.cancel_my_request_for_round(pg_temp.fixture('main'),1,'accepted')$$,'42501',NULL,'Rejected helper cannot cancel');
SELECT pg_temp.login(4);
SELECT throws_ok($$SELECT public.cancel_my_request_for_round(pg_temp.fixture('main'),1,'accepted')$$,'42501',NULL,'Unrelated user cannot cancel');
SELECT throws_ok($$SELECT public.set_my_request_archived(pg_temp.fixture('main'),false)$$,'42501',NULL,'Unrelated user cannot alter archive state');

-- Accepted work remains active after its deadline and must still be cancellable.
RESET ROLE;
UPDATE public.requests SET deadline_at=clock_timestamp()-interval '1 minute' WHERE id=pg_temp.fixture('main');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT is(public.cancel_my_request_for_round(pg_temp.fixture('main'),1,'accepted'),pg_temp.fixture('main'),'Owner cancels accepted work even after its deadline');
SELECT is((SELECT status FROM public.requests WHERE id=pg_temp.fixture('main')),'cancelled','Cancellation persists a terminal request state');
SELECT is((public.get_my_points()->>'balance')::integer,100,'Cancellation does not debit the poster');
SELECT is((public.get_my_points()->>'reserved')::integer,20,'Cancellation releases only the cancelled request hold');
SELECT is((SELECT status FROM public.request_point_reservations WHERE request_id=pg_temp.fixture('main')),'released','Released reservation remains in history');
SELECT is((SELECT status FROM public.request_point_reservations WHERE request_id=pg_temp.fixture('side')),'reserved','Unrelated accepted work remains funded');
RESET ROLE;
UPDATE public.request_point_reservations SET amount=21 WHERE request_id=pg_temp.fixture('side');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT throws_ok($$SELECT public.cancel_my_request_for_round(pg_temp.fixture('side'),1,'accepted')$$,'P0003',NULL,'Cancellation refuses a reservation that does not match the agreed reward');
SELECT is((public.get_my_points()->>'reserved')::integer,20,'Rejected reservation mismatch does not alter held points');
SELECT is((SELECT status FROM public.requests WHERE id=pg_temp.fixture('side')),'accepted','Rejected reservation mismatch leaves work accepted');
RESET ROLE;
UPDATE public.request_point_reservations SET amount=20 WHERE request_id=pg_temp.fixture('side');
UPDATE public.points_wallets SET reserved=19 WHERE profile_id=pg_temp.uid(1);
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT throws_ok($$SELECT public.cancel_my_request_for_round(pg_temp.fixture('side'),1,'accepted')$$,'P0003',NULL,'Cancellation refuses a wallet missing its promised hold');
SELECT is((SELECT status FROM public.request_point_reservations WHERE request_id=pg_temp.fixture('side')),'reserved','Insufficient hold does not falsely mark the reservation released');
RESET ROLE;
UPDATE public.points_wallets SET reserved=20 WHERE profile_id=pg_temp.uid(1);
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT is((SELECT count(*) FROM public.request_offers WHERE request_id=pg_temp.fixture('main') AND status IN ('pending','accepted')),0::bigint,'Cancelled request has no live offers');
SELECT is((SELECT count(*) FROM public.request_offer_history WHERE offer_id=pg_temp.fixture('main-offer') AND status='accepted'),1::bigint,'The original selection remains in history');
SELECT is((SELECT count(*) FROM public.request_offer_history WHERE offer_id=pg_temp.fixture('main-offer') AND status='rejected'),1::bigint,'Cancellation records the selected offer closure once');
SELECT is(public.cancel_my_request_for_round(pg_temp.fixture('main'),1,'accepted'),pg_temp.fixture('main'),'Accepted cancellation retry is idempotent');
SELECT is((public.get_my_points()->>'reserved')::integer,20,'Retry cannot release a different request hold');
SELECT is((SELECT count(*) FROM public.request_offer_history WHERE offer_id=pg_temp.fixture('main-offer') AND status='rejected'),1::bigint,'Retry creates no duplicate closure history');
SELECT throws_ok($$SELECT public.complete_my_request(pg_temp.fixture('main'),1)$$,'22023',NULL,'Cancelled work cannot later pay a helper');
SELECT lives_ok($$INSERT INTO fixtures VALUES('freed-slot',public.save_my_request(pg_temp.payload()))$$,'Accepted cancellation frees a posting slot');
SELECT pg_temp.login(2);
SELECT is((public.get_my_points()->>'balance')::integer,100,'Cancellation never pays the helper');
SELECT ok((SELECT status='rejected' AND request_status='cancelled' FROM public.get_request_offer_page_v3(NULL) WHERE id=pg_temp.fixture('main-offer')),'Helper offer history explains that the request was cancelled');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.points_ledger WHERE request_id=pg_temp.fixture('main')),0::bigint,'No transfer ledger entries are created for cancellation');

-- A price edit retires pending offers. An old cancellation must not act on its new round.
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT public.save_my_request(pg_temp.payload(15),pg_temp.fixture('stale'));
SELECT throws_ok($$SELECT public.cancel_my_request_for_round(pg_temp.fixture('stale'),1,'open')$$,'22023',NULL,'Old-round cancellation cannot cancel edited reward terms');
SELECT throws_ok($$SELECT public.cancel_my_request_for_round(pg_temp.fixture('stale'),2,'accepted')$$,'22023',NULL,'Expected accepted status cannot cancel an open request');
SELECT pg_temp.login(2);
SELECT public.renew_my_request_offer_for_terms(pg_temp.fixture('stale-offer'),2,15);
SELECT pg_temp.login(1);
SELECT lives_ok($$SELECT public.cancel_my_request_for_round(pg_temp.fixture('stale'),2,'open')$$,'Current open request can be cancelled');
SELECT is((SELECT status FROM public.request_offers WHERE id=pg_temp.fixture('stale-offer')),'rejected','Open cancellation closes the pending helper offer');
SELECT throws_ok($$SELECT public.cancel_my_request_for_round(pg_temp.fixture('stale'),1,'open')$$,'22023',NULL,'Cancelled idempotency does not accept stale rounds');

SELECT lives_ok($$SELECT public.set_my_request_archived(pg_temp.fixture('main'),true)$$,'Owner archives a cancelled request');
SELECT ok((SELECT owner_archived_at IS NOT NULL FROM public.requests WHERE id=pg_temp.fixture('main')),'Owner archive marker is persisted');
SELECT lives_ok($$SELECT public.set_my_request_archived(pg_temp.fixture('main'),true)$$,'Archive retry is harmless');
SELECT is((SELECT count(*) FROM public.delivery_request_details WHERE request_id=pg_temp.fixture('main')),1::bigint,'Archiving retains category details');
SELECT is((SELECT count(*) FROM public.request_offers WHERE request_id=pg_temp.fixture('main')),2::bigint,'Archiving retains both helper offers');
SELECT is((SELECT status FROM public.request_point_reservations WHERE request_id=pg_temp.fixture('main')),'released','Archiving retains the released reservation');
SELECT pg_temp.login(2);
SELECT is((SELECT count(*) FROM public.get_request_offer_page_v3(NULL) WHERE id=pg_temp.fixture('main-offer')),1::bigint,'Owner archive does not remove helper offer history');
SELECT throws_ok($$SELECT public.set_my_request_archived(pg_temp.fixture('main'),false)$$,'42501',NULL,'Helper cannot restore the owner archive');
SELECT pg_temp.login(1);
SELECT lives_ok($$SELECT public.set_my_request_archived(pg_temp.fixture('main'),false)$$,'Owner restores archived history');
SELECT ok((SELECT owner_archived_at IS NULL AND status='cancelled' FROM public.requests WHERE id=pg_temp.fixture('main')),'Restore changes visibility without reopening cancelled work');
SELECT is((public.get_my_points()->>'reserved')::integer,20,'Archive and restore never change reserved points');
SELECT throws_ok($$SELECT public.set_my_request_archived(pg_temp.fixture('main'),NULL)$$,'22023',NULL,'Archive operation requires an explicit desired state');
SELECT throws_ok($$UPDATE public.requests SET owner_archived_at=clock_timestamp() WHERE id=pg_temp.fixture('main')$$,'42501',NULL,'Clients cannot bypass archive validation with a direct update');
SELECT throws_ok($$DELETE FROM public.requests WHERE id=pg_temp.fixture('main')$$,'42501',NULL,'Clients cannot erase request and points history');

-- Elapsed open requests are hidden as expired, never accidentally reactivated.
INSERT INTO fixtures VALUES('elapsed',public.save_my_request(pg_temp.payload()));
SELECT pg_temp.login(2);
INSERT INTO fixtures VALUES('elapsed-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('elapsed'),1,10));
RESET ROLE;
UPDATE public.requests SET deadline_at=clock_timestamp()-interval '1 minute' WHERE id=pg_temp.fixture('elapsed');
CREATE FUNCTION pg_temp.fail_archive_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.offer_id=pg_temp.fixture('elapsed-offer') AND NEW.status='rejected' THEN
  RAISE EXCEPTION 'test archive history failure' USING errcode='P0001';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER test_archive_history_failure BEFORE INSERT ON public.request_offer_history FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_archive_history();
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT throws_ok($$SELECT public.set_my_request_archived(pg_temp.fixture('elapsed'),true)$$,'P0001','test archive history failure','Expiry audit failure rolls back archiving');
SELECT ok((SELECT status='open' AND owner_archived_at IS NULL FROM public.requests WHERE id=pg_temp.fixture('elapsed')),'Failed archive preserves the pre-operation request state');
SELECT is((SELECT status FROM public.request_offers WHERE id=pg_temp.fixture('elapsed-offer')),'pending','Failed archive preserves pending consent');
SELECT is((SELECT count(*) FROM public.request_offer_history WHERE offer_id=pg_temp.fixture('elapsed-offer')),1::bigint,'Failed archive leaves no false closed history');
RESET ROLE;
DROP TRIGGER test_archive_history_failure ON public.request_offer_history;
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT throws_ok($$SELECT public.cancel_my_request_for_round(pg_temp.fixture('elapsed'),1,'open')$$,'22023',NULL,'Elapsed open requests direct owners to archive instead of changing expiry to cancellation');
SELECT lives_ok($$SELECT public.set_my_request_archived(pg_temp.fixture('elapsed'),true)$$,'Owner archives a request whose open deadline has elapsed');
SELECT ok((SELECT status='expired' AND owner_archived_at IS NOT NULL FROM public.requests WHERE id=pg_temp.fixture('elapsed')),'Lazy expiry is settled before archive');
SELECT is((SELECT status FROM public.request_offers WHERE id=pg_temp.fixture('elapsed-offer')),'rejected','Archiving elapsed work closes pending consent');
SELECT public.set_my_request_archived(pg_temp.fixture('elapsed'),false);
SELECT ok((SELECT status='expired' AND owner_archived_at IS NULL FROM public.requests WHERE id=pg_temp.fixture('elapsed')),'Restoring elapsed work preserves its expired status');
SELECT lives_ok($$SELECT public.set_my_request_archived(pg_temp.fixture('elapsed'),true)$$,'Already-expired work can be archived again');
SELECT is((SELECT count(*) FROM public.request_offer_history WHERE offer_id=pg_temp.fixture('elapsed-offer') AND status='rejected'),1::bigint,'Repeated archive/restore does not duplicate expired offer closure');

-- A late failure during closure must roll back the status, wallet and audit.
SELECT pg_temp.login(4);
INSERT INTO fixtures VALUES('rollback',public.save_my_request(pg_temp.payload(30)));
SELECT pg_temp.login(2);
INSERT INTO fixtures VALUES('rollback-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('rollback'),1,30));
SELECT pg_temp.login(4);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('rollback-offer'),'accepted',1,30);
RESET ROLE;
CREATE FUNCTION pg_temp.fail_cancel_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.offer_id=pg_temp.fixture('rollback-offer') AND NEW.status='rejected' THEN
  RAISE EXCEPTION 'test cancel history failure' USING errcode='P0001';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER test_cancel_history_failure BEFORE INSERT ON public.request_offer_history FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_cancel_history();
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(4);
SELECT throws_ok($$SELECT public.cancel_my_request_for_round(pg_temp.fixture('rollback'),1,'accepted')$$,'P0001','test cancel history failure','Offer audit failure rolls back the entire cancellation');
SELECT ok((SELECT status='accepted' AND offer_round=1 FROM public.requests WHERE id=pg_temp.fixture('rollback')),'Failed cancellation leaves the request accepted');
SELECT is((public.get_my_points()->>'reserved')::integer,30,'Failed cancellation restores the original wallet hold');
SELECT is((SELECT status FROM public.request_point_reservations WHERE request_id=pg_temp.fixture('rollback')),'reserved','Failed cancellation restores reservation status');
SELECT is((SELECT status FROM public.request_offers WHERE id=pg_temp.fixture('rollback-offer')),'accepted','Failed cancellation restores selected helper');
SELECT is((SELECT count(*) FROM public.request_offer_history WHERE offer_id=pg_temp.fixture('rollback-offer')),2::bigint,'Failed cancellation leaves only real pending and accepted history');
RESET ROLE;
DROP TRIGGER test_cancel_history_failure ON public.request_offer_history;
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(4);
SELECT lives_ok($$SELECT public.cancel_my_request_for_round(pg_temp.fixture('rollback'),1,'accepted')$$,'Cancellation succeeds after the injected fault is removed');

-- Old accepted rows have no reservation; cancellation releases their slot without minting points.
SELECT pg_temp.login(5);
INSERT INTO fixtures VALUES('legacy',public.save_my_request(pg_temp.payload(20)));
SELECT pg_temp.login(2);
INSERT INTO fixtures VALUES('legacy-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('legacy'),1,20));
RESET ROLE;
UPDATE public.requests SET status='accepted',accepted_at=clock_timestamp() WHERE id=pg_temp.fixture('legacy');
UPDATE public.request_offers SET status='accepted',decided_at=clock_timestamp() WHERE id=pg_temp.fixture('legacy-offer');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(5);
SELECT lives_ok($$SELECT public.cancel_my_request_for_round(pg_temp.fixture('legacy'),1,'accepted')$$,'Legacy accepted work without a reservation can be cancelled');
SELECT ok((public.get_my_points()->>'balance')::integer=100 AND (public.get_my_points()->>'reserved')::integer=0,'Legacy cancellation neither adds points nor subtracts holds');
SELECT is((SELECT count(*) FROM public.request_point_reservations WHERE request_id=pg_temp.fixture('legacy')),0::bigint,'Legacy cancellation does not invent a reservation');

-- Completed paid history is archivable without reversing its transfer.
SELECT pg_temp.login(6);
INSERT INTO fixtures VALUES('paid',public.save_my_request(pg_temp.payload(10)));
SELECT pg_temp.login(2);
INSERT INTO fixtures VALUES('paid-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('paid'),1,10));
SELECT pg_temp.login(6);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('paid-offer'),'accepted',1,10);
SELECT public.complete_my_request(pg_temp.fixture('paid'),1);
SELECT throws_ok($$SELECT public.cancel_my_request_for_round(pg_temp.fixture('paid'),1,'accepted')$$,'22023',NULL,'Completed request cannot be cancelled');
SELECT lives_ok($$SELECT public.set_my_request_archived(pg_temp.fixture('paid'),true)$$,'Completed request can be archived');
SELECT public.set_my_request_archived(pg_temp.fixture('paid'),false);
SELECT ok((SELECT status='completed' AND owner_archived_at IS NULL FROM public.requests WHERE id=pg_temp.fixture('paid')),'Restore preserves completion');
SELECT is((public.get_my_points()->>'balance')::integer,90,'Archive/restore does not refund a completed payment');
SELECT pg_temp.login(2);
SELECT is((public.get_my_points()->>'balance')::integer,110,'Helper retains the completed payment');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.points_ledger WHERE request_id=pg_temp.fixture('paid')),2::bigint,'Completed ledger remains intact after archive/restore');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT throws_ok($$SELECT public.cancel_my_request_for_round(pg_temp.fixture('side'),1,'accepted')$$,'42501',NULL,'Missing identity cannot cancel');
SELECT throws_ok($$SELECT public.set_my_request_archived(pg_temp.fixture('main'),true)$$,'42501',NULL,'Missing identity cannot archive');
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.cancel_my_request_for_round(NULL,1,'open')$$,'42501',NULL,'Anonymous cancellation API denied');
SELECT throws_ok($$SELECT public.set_my_request_archived(NULL,true)$$,'42501',NULL,'Anonymous archive API denied');
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT * FROM finish();
ROLLBACK;
