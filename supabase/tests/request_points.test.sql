BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT no_plan();

-- Isolated fixtures, balances, ledger events, triggers and requests all roll back.
INSERT INTO auth.users(id,email)
SELECT ('92929292-9292-4929-8929-'||lpad(i::text,12,'0'))::uuid,
  'points-'||i||'@test.local' FROM generate_series(1,6) i;
UPDATE public.profiles SET display_name='Points Tester',major='Computing Science',year_of_study=2,
  campus_id=(SELECT id FROM public.campuses WHERE slug='burnaby')
WHERE id IN (SELECT ('92929292-9292-4929-8929-'||lpad(i::text,12,'0'))::uuid FROM generate_series(1,6) i);
CREATE FUNCTION pg_temp.uid(i integer) RETURNS uuid LANGUAGE sql AS $$
  SELECT ('92929292-9292-4929-8929-'||lpad(i::text,12,'0'))::uuid;
$$;
CREATE FUNCTION pg_temp.login(i integer) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub',pg_temp.uid(i)::text,true);
$$;
CREATE FUNCTION pg_temp.payload(points integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('category','delivery','title','Points test','description','Please help with this request.',
    'campus_id',(SELECT id FROM public.campuses WHERE slug='burnaby'),'room_location','Library',
    'deadline_at',clock_timestamp()+interval '1 day','points',points,'item_size','small',
    'details','{"pickup_location":"Cafe","dropoff_location":"Library"}'::jsonb);
$$;
CREATE TEMP TABLE fixtures(name text PRIMARY KEY,id uuid);
GRANT ALL ON fixtures TO authenticated;
CREATE FUNCTION pg_temp.fixture(p_name text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM fixtures WHERE name=p_name; $$;

SELECT is((SELECT count(*) FROM public.points_wallets WHERE profile_id IN (SELECT pg_temp.uid(i) FROM generate_series(1,6) i) AND balance=100 AND reserved=0),6::bigint,'Every new account starts with 100 unreserved points');
SELECT is((SELECT count(*) FROM public.points_ledger WHERE profile_id IN (SELECT pg_temp.uid(i) FROM generate_series(1,6) i) AND kind='starter_grant' AND amount=100),6::bigint,'Every account gets exactly one starter ledger entry');
UPDATE public.profiles SET display_name='Updated Points Tester' WHERE id=pg_temp.uid(1);
SELECT is((SELECT balance::bigint FROM public.points_wallets WHERE profile_id=pg_temp.uid(1)),100::bigint,'Editing a profile does not grant more points');
SELECT is((SELECT count(*) FROM public.points_ledger WHERE profile_id=pg_temp.uid(1) AND kind='starter_grant'),1::bigint,'Profile updates cannot duplicate the starter grant');
SELECT throws_ok($$INSERT INTO public.points_ledger(profile_id,kind,amount) VALUES(pg_temp.uid(1),'starter_grant',100)$$,'23505',NULL,'A unique constraint prevents duplicate starter credits');
SELECT throws_ok($$UPDATE public.points_wallets SET reserved=101 WHERE profile_id=pg_temp.uid(1)$$,'23514',NULL,'Wallet constraint prevents holds above the balance');
SELECT throws_ok($$UPDATE public.points_wallets SET balance=-1 WHERE profile_id=pg_temp.uid(1)$$,'23514',NULL,'Wallet constraint prevents a negative balance');

SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT is((SELECT count(*) FROM public.points_wallets),1::bigint,'Client can only read their own wallet');
SELECT is((SELECT count(*) FROM public.points_ledger),1::bigint,'Client can only read their own ledger');
SELECT is((public.get_my_points()->>'balance')::integer,100,'Snapshot reports the caller balance');
SELECT is((public.get_my_points()->>'reserved')::integer,0,'Snapshot starts without holds');
SELECT is((public.get_my_points()->>'available')::integer,100,'Snapshot reports spendable points');
SELECT is(jsonb_array_length((public.get_my_points()->'history')::jsonb),1,'Snapshot includes the starter grant');
SELECT throws_ok($$INSERT INTO public.points_wallets DEFAULT VALUES$$,'42501',NULL,'Clients cannot insert wallets');
SELECT throws_ok($$UPDATE public.points_wallets SET balance=99999$$,'42501',NULL,'Clients cannot edit balances');
SELECT throws_ok($$DELETE FROM public.points_wallets$$,'42501',NULL,'Clients cannot delete wallets');
SELECT throws_ok($$INSERT INTO public.points_ledger DEFAULT VALUES$$,'42501',NULL,'Clients cannot mint ledger entries');
SELECT throws_ok($$UPDATE public.points_ledger SET amount=99999$$,'42501',NULL,'Clients cannot edit ledger amounts');
SELECT throws_ok($$DELETE FROM public.points_ledger$$,'42501',NULL,'Clients cannot delete ledger history');
SELECT throws_ok($$INSERT INTO public.request_point_reservations DEFAULT VALUES$$,'42501',NULL,'Clients cannot insert reservations');
SELECT throws_ok($$UPDATE public.request_point_reservations SET amount=1$$,'42501',NULL,'Clients cannot edit reservations');
SELECT throws_ok($$DELETE FROM public.request_point_reservations$$,'42501',NULL,'Clients cannot delete reservations');

INSERT INTO fixtures VALUES('main',public.save_my_request(pg_temp.payload(10))),
  ('too-expensive',public.save_my_request(pg_temp.payload(80))),
  ('second',public.save_my_request(pg_temp.payload(70))),
  ('cancelled',public.save_my_request(pg_temp.payload(10)));
SELECT public.cancel_my_request(pg_temp.fixture('cancelled'));
SELECT is((public.get_my_points()->>'available')::integer,100,'Posting and cancelling an unaccepted request do not reserve or spend points');
SELECT throws_ok($$SELECT public.complete_my_request(pg_temp.fixture('main'),1)$$,'22023',NULL,'Open request cannot be completed');
SELECT throws_ok($$SELECT public.complete_my_request(pg_temp.fixture('cancelled'),1)$$,'22023',NULL,'Cancelled request cannot be completed');
SELECT pg_temp.login(2);
INSERT INTO fixtures VALUES('main-offer',public.create_my_request_offer(pg_temp.fixture('main'))),
  ('expensive-offer',public.create_my_request_offer(pg_temp.fixture('too-expensive')));
SELECT pg_temp.login(3);
INSERT INTO fixtures VALUES('main-other',public.create_my_request_offer(pg_temp.fixture('main'))),
  ('second-offer',public.create_my_request_offer(pg_temp.fixture('second')));
SELECT pg_temp.login(1);
-- Another poster session edits the reward while an old 10-point dialog is open.
SELECT public.save_my_request(pg_temp.payload(30),pg_temp.fixture('main'));
SELECT throws_ok($$SELECT public.decide_request_offer_for_round(pg_temp.fixture('main-offer'),'accepted',1,10)$$,'22023',NULL,'Stale reward confirmation cannot reserve the edited reward');
SELECT throws_ok($$SELECT public.decide_request_offer_for_round(pg_temp.fixture('main-offer'),'accepted',1,NULL)$$,'22023',NULL,'Acceptance requires an explicit reviewed points amount');
SELECT throws_ok($$SELECT public.decide_request_offer_for_round(pg_temp.fixture('main-offer'),'accepted',1)$$,'22023',NULL,'Old public round-only acceptance cannot bypass amount confirmation');
SELECT throws_ok($$SELECT request_private.decide_offer_for_round(pg_temp.fixture('main-offer'),'accepted',1)$$,'22023',NULL,'Old private round-only acceptance cannot bypass amount confirmation');
SELECT throws_ok($$SELECT public.decide_request_offer(pg_temp.fixture('main-offer'),'accepted')$$,'22023',NULL,'Old public two-argument acceptance cannot bypass amount confirmation');
SELECT throws_ok($$SELECT request_private.decide_offer(pg_temp.fixture('main-offer'),'accepted')$$,'22023',NULL,'Old private two-argument acceptance cannot bypass amount confirmation');
SELECT throws_ok($$SELECT request_private.decide_offer_core(pg_temp.fixture('main-offer'),'accepted')$$,'42501',NULL,'Client cannot bypass checks through the decision core');
SELECT is((public.get_my_points()->>'reserved')::integer,0,'Rejected stale and legacy confirmations reserve no points');
SELECT is((SELECT status FROM public.requests WHERE id=pg_temp.fixture('main')),'open','Rejected reward confirmation leaves the request open');
SELECT is((SELECT offer_round FROM public.requests WHERE id=pg_temp.fixture('main')),1,'Reward editing does not change the offer round');
SELECT is((SELECT status FROM public.request_offers WHERE id=pg_temp.fixture('main-offer')),'pending','Rejected reward confirmation preserves pending helper consent');
SELECT is((SELECT count(*) FROM public.request_point_reservations WHERE request_id=pg_temp.fixture('main')),0::bigint,'Rejected reward confirmation creates no reservation');
SELECT public.decide_request_offer_for_round(pg_temp.fixture('main-offer'),'accepted',1,30);
SELECT is((public.get_my_points()->>'balance')::integer,100,'Acceptance keeps total poster balance until completion');
SELECT is((public.get_my_points()->>'reserved')::integer,30,'Acceptance reserves the agreed reward');
SELECT is((public.get_my_points()->>'available')::integer,70,'Reserved reward is not spendable again');
SELECT ok((SELECT status='reserved' AND amount=30 AND poster_id=pg_temp.uid(1) AND helper_id=pg_temp.uid(2) FROM public.request_point_reservations WHERE request_id=pg_temp.fixture('main') AND offer_round=1),'Reservation binds the round, poster, helper and amount');
SELECT public.decide_request_offer_for_round(pg_temp.fixture('main-offer'),'accepted',1,30);
SELECT is((public.get_my_points()->>'reserved')::integer,30,'Acceptance retry does not double reserve');
SELECT throws_ok($$SELECT public.decide_request_offer_for_round(pg_temp.fixture('expensive-offer'),'accepted',1,80)$$,'P0002',NULL,'Insufficient available points block another acceptance');
SELECT is((SELECT status FROM public.requests WHERE id=pg_temp.fixture('too-expensive')),'open','Failed acceptance leaves the request open');
SELECT is((SELECT status FROM public.request_offers WHERE id=pg_temp.fixture('expensive-offer')),'pending','Failed acceptance preserves helper consent');
SELECT is((SELECT count(*) FROM public.request_point_reservations WHERE request_id=pg_temp.fixture('too-expensive')),0::bigint,'Failed acceptance creates no reservation');
SELECT public.decide_request_offer_for_round(pg_temp.fixture('second-offer'),'accepted',1,70);
SELECT is((public.get_my_points()->>'reserved')::integer,100,'Different requests can reserve the entire balance');
SELECT is((public.get_my_points()->>'available')::integer,0,'Available points cannot go negative');
SELECT throws_ok($$SELECT public.cancel_my_request(pg_temp.fixture('second'))$$,'22023',NULL,'Accepted request must be reopened before cancellation');
SELECT public.reopen_my_request(pg_temp.fixture('second'),1,clock_timestamp()+interval '2 days');
SELECT is((public.get_my_points()->>'reserved')::integer,30,'Reopening releases only that request hold');
SELECT is((SELECT status FROM public.request_point_reservations WHERE request_id=pg_temp.fixture('second') AND offer_round=1),'released','Released reservation remains auditable');
SELECT public.reopen_my_request(pg_temp.fixture('second'),1,clock_timestamp()+interval '2 days');
SELECT is((public.get_my_points()->>'reserved')::integer,30,'Repeated reopening cannot release another request hold');

SELECT pg_temp.login(2);
SELECT is((public.get_my_points()->>'balance')::integer,100,'Helper is not paid at acceptance');
SELECT is((SELECT count(*) FROM public.request_point_reservations WHERE request_id=pg_temp.fixture('main')),1::bigint,'Selected helper can see their reservation');
SELECT throws_ok($$SELECT public.complete_my_request(pg_temp.fixture('main'),1)$$,'42501',NULL,'Helper cannot confirm completion or pay themselves');
SELECT pg_temp.login(3);
SELECT is((SELECT count(*) FROM public.request_point_reservations WHERE request_id=pg_temp.fixture('main')),0::bigint,'Rejected helper cannot inspect another helper reservation');
SELECT throws_ok($$SELECT public.complete_my_request(pg_temp.fixture('main'),1)$$,'42501',NULL,'Rejected helper cannot complete');
SELECT pg_temp.login(4);
SELECT is((SELECT count(*) FROM public.request_point_reservations WHERE request_id=pg_temp.fixture('main')),0::bigint,'Outsider cannot inspect reservation');
SELECT throws_ok($$SELECT public.complete_my_request(pg_temp.fixture('main'),1)$$,'42501',NULL,'Outsider cannot complete');
SELECT pg_temp.login(1);
SELECT throws_ok($$SELECT public.complete_my_request(pg_temp.fixture('main'),NULL)$$,'22023',NULL,'Missing completion round is invalid');
SELECT throws_ok($$SELECT public.complete_my_request(pg_temp.fixture('main'),0)$$,'22023',NULL,'Zero completion round is invalid');
SELECT throws_ok($$SELECT public.complete_my_request(pg_temp.fixture('main'),2)$$,'22023',NULL,'Wrong completion round is rejected');
SELECT is(public.complete_my_request(pg_temp.fixture('main'),1),pg_temp.fixture('main'),'Poster confirms completion');
SELECT ok((SELECT status='completed' AND completed_at IS NOT NULL FROM public.requests WHERE id=pg_temp.fixture('main')),'Completion is persisted with a timestamp');
SELECT is((public.get_my_points()->>'balance')::integer,70,'Completion debits the poster once');
SELECT is((public.get_my_points()->>'reserved')::integer,0,'Completion consumes the held points');
SELECT is((SELECT status FROM public.request_point_reservations WHERE request_id=pg_temp.fixture('main')),'settled','Settled reservation remains auditable');
SELECT is((SELECT amount::bigint FROM public.points_ledger WHERE request_id=pg_temp.fixture('main') AND kind='request_sent'),(-30)::bigint,'Poster ledger records a negative transfer');
SELECT is((SELECT count(*) FROM public.points_ledger WHERE request_id=pg_temp.fixture('main')),1::bigint,'Poster cannot inspect the helper ledger entry');
SELECT is(public.complete_my_request(pg_temp.fixture('main'),1),pg_temp.fixture('main'),'Completion retry is idempotent');
SELECT is((public.get_my_points()->>'balance')::integer,70,'Completion retry cannot debit twice');
SELECT throws_ok($$SELECT public.reopen_my_request(pg_temp.fixture('main'),1,clock_timestamp()+interval '2 days')$$,'22023',NULL,'Completed request cannot be reopened');
SELECT throws_ok($$SELECT public.cancel_my_request(pg_temp.fixture('main'))$$,'22023',NULL,'Completed request cannot be cancelled');
SELECT pg_temp.login(2);
SELECT is((public.get_my_points()->>'balance')::integer,130,'Selected helper earns the agreed reward exactly once');
SELECT is((SELECT amount::bigint FROM public.points_ledger WHERE request_id=pg_temp.fixture('main') AND kind='request_received'),30::bigint,'Helper ledger records a positive transfer');
SELECT is((SELECT count(*) FROM public.requests WHERE id=pg_temp.fixture('main')),1::bigint,'Helper retains completed request access');
SELECT pg_temp.login(3);
SELECT public.renew_my_request_offer(pg_temp.fixture('second-offer'),2);
SELECT pg_temp.login(1);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('second-offer'),'accepted',2,70);
SELECT is((public.get_my_points()->>'reserved')::integer,70,'Renewed acceptance creates a new hold for the new round');
SELECT throws_ok($$SELECT public.complete_my_request(pg_temp.fixture('second'),1)$$,'22023',NULL,'Old completion dialog cannot pay a new round');
SELECT public.complete_my_request(pg_temp.fixture('second'),2);
SELECT is((public.get_my_points()->>'balance')::integer,0,'Spending the last available points is allowed');
SELECT is((SELECT count(*) FROM public.request_point_reservations WHERE request_id=pg_temp.fixture('second')),2::bigint,'Released and settled rounds both remain in history');
RESET ROLE;
SELECT is((SELECT sum(balance)::bigint FROM public.points_wallets WHERE profile_id IN (pg_temp.uid(1),pg_temp.uid(2),pg_temp.uid(3))),300::bigint,'Transfers conserve the three participants total points');
SELECT is((SELECT sum(amount)::bigint FROM public.points_ledger WHERE request_id IN (pg_temp.fixture('main'),pg_temp.fixture('second'))),0::bigint,'Each completed transfer has balanced ledger entries');
SELECT is((SELECT count(*) FROM public.points_ledger WHERE request_id IN (pg_temp.fixture('main'),pg_temp.fixture('second'))),4::bigint,'Two completions create exactly four transfer entries');

-- Inject failures after wallet changes; the entire transition must roll back.
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(4);
INSERT INTO fixtures VALUES('rollback',public.save_my_request(pg_temp.payload(40)));
SELECT pg_temp.login(2);
INSERT INTO fixtures VALUES('rollback-offer',public.create_my_request_offer(pg_temp.fixture('rollback')));
RESET ROLE;
CREATE FUNCTION pg_temp.fail_points_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test points event failure' USING errcode='P0001'; END $$;
CREATE TRIGGER test_points_event_failure BEFORE INSERT ON public.offer_notifications FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_points_event();
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(4);
SELECT throws_ok($$SELECT public.decide_request_offer_for_round(pg_temp.fixture('rollback-offer'),'accepted',1,40)$$,'P0001','test points event failure','Notification failure rolls back acceptance and points hold');
SELECT is((public.get_my_points()->>'reserved')::integer,0,'Failed acceptance leaves no wallet hold');
SELECT is((SELECT count(*) FROM public.request_point_reservations WHERE request_id=pg_temp.fixture('rollback')),0::bigint,'Failed acceptance leaves no reservation');
RESET ROLE;
DROP TRIGGER test_points_event_failure ON public.offer_notifications;
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(4);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('rollback-offer'),'accepted',1,40);
RESET ROLE;
CREATE TRIGGER test_points_event_failure BEFORE INSERT ON public.offer_notifications FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_points_event();
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(4);
SELECT throws_ok($$SELECT public.reopen_my_request(pg_temp.fixture('rollback'),1,clock_timestamp()+interval '2 days')$$,'P0001','test points event failure','Notification failure rolls back reopening and release');
SELECT is((public.get_my_points()->>'reserved')::integer,40,'Failed reopening retains the original hold');
SELECT is((SELECT status FROM public.requests WHERE id=pg_temp.fixture('rollback')),'accepted','Failed reopening preserves selection');
RESET ROLE;
DROP TRIGGER test_points_event_failure ON public.offer_notifications;
CREATE FUNCTION pg_temp.fail_points_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='request_received' THEN RAISE EXCEPTION 'test points ledger failure' USING errcode='P0001'; END IF; RETURN NEW; END $$;
CREATE TRIGGER test_points_ledger_failure BEFORE INSERT ON public.points_ledger FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_points_ledger();
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(4);
SELECT throws_ok($$SELECT public.complete_my_request(pg_temp.fixture('rollback'),1)$$,'P0001','test points ledger failure','Second ledger write failure rolls back all settlement changes');
SELECT is((public.get_my_points()->>'balance')::integer,100,'Failed settlement restores the poster balance');
SELECT is((public.get_my_points()->>'reserved')::integer,40,'Failed settlement restores the held reward');
SELECT is((SELECT status FROM public.requests WHERE id=pg_temp.fixture('rollback')),'accepted','Failed settlement leaves request accepted');
SELECT is((SELECT status FROM public.request_point_reservations WHERE request_id=pg_temp.fixture('rollback')),'reserved','Failed settlement leaves reservation reserved');
SELECT is((SELECT count(*) FROM public.points_ledger WHERE request_id=pg_temp.fixture('rollback')),0::bigint,'Failed settlement leaves no half transfer');
SELECT pg_temp.login(2);
SELECT is((public.get_my_points()->>'balance')::integer,130,'Failed settlement restores helper balance too');
RESET ROLE;
DROP TRIGGER test_points_ledger_failure ON public.points_ledger;
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(4);
SELECT public.complete_my_request(pg_temp.fixture('rollback'),1);
SELECT is((public.get_my_points()->>'balance')::integer,60,'Settlement succeeds after the fault is removed');

-- Simulate an accepted request migrated from the pre-points checkpoint.
SELECT pg_temp.login(6);
INSERT INTO fixtures VALUES('legacy',public.save_my_request(pg_temp.payload(20)));
SELECT pg_temp.login(5);
INSERT INTO fixtures VALUES('legacy-offer',public.create_my_request_offer(pg_temp.fixture('legacy')));
RESET ROLE;
UPDATE public.requests SET status='accepted',accepted_at=clock_timestamp() WHERE id=pg_temp.fixture('legacy');
UPDATE public.request_offers SET status='accepted',decided_at=clock_timestamp() WHERE id=pg_temp.fixture('legacy-offer');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(6);
SELECT throws_ok($$SELECT public.complete_my_request(pg_temp.fixture('legacy'),1)$$,'P0003',NULL,'Legacy acceptance cannot spend an unreserved reward');
SELECT is((public.get_my_points()->>'balance')::integer,100,'Legacy acceptance does not invent a debit');
SELECT public.reopen_my_request(pg_temp.fixture('legacy'),1,clock_timestamp()+interval '2 days');
SELECT pg_temp.login(5);
SELECT public.renew_my_request_offer(pg_temp.fixture('legacy-offer'),2);
SELECT pg_temp.login(6);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('legacy-offer'),'accepted',2,20);
SELECT public.complete_my_request(pg_temp.fixture('legacy'),2);
SELECT is((public.get_my_points()->>'balance')::integer,80,'Legacy request can be settled after reopening and fresh acceptance');

-- Fill history with actual completed transfers, then verify the bounded snapshot.
DO $$
DECLARE v_request uuid; v_offer uuid;
BEGIN
  FOR i IN 1..21 LOOP
    PERFORM pg_temp.login(2);
    v_request:=public.save_my_request(pg_temp.payload(1));
    PERFORM pg_temp.login(1);
    v_offer:=public.create_my_request_offer(v_request);
    PERFORM pg_temp.login(2);
    PERFORM public.decide_request_offer_for_round(v_offer,'accepted',1,1);
    PERFORM public.complete_my_request(v_request,1);
  END LOOP;
END $$;
SELECT is((public.get_my_points()->>'balance')::integer,149,'Twenty-one completed transfers subtract exactly twenty-one points');
SELECT is(jsonb_array_length((public.get_my_points()->'history')::jsonb),20,'Snapshot caps history at the most recent twenty entries');
SELECT is((SELECT count(*) FROM jsonb_array_elements((public.get_my_points()->'history')::jsonb) e WHERE e->>'kind'='request_sent' AND (e->>'amount')::integer=-1),20::bigint,'Snapshot returns recent transfer events rather than old grants');
SELECT is((SELECT jsonb_agg(e->>'id') FROM jsonb_array_elements((public.get_my_points()->'history')::jsonb) e),
  (SELECT jsonb_agg(id::text) FROM (SELECT id FROM public.points_ledger ORDER BY created_at DESC,id DESC LIMIT 20) recent),'Snapshot history is newest first with stable ordering');
SELECT is((SELECT count(*) FROM public.points_ledger WHERE profile_id=pg_temp.uid(2) AND kind='starter_grant'),1::bigint,'History cap does not remove the original grant record');
SELECT pg_temp.login(1);
SELECT is((public.get_my_points()->>'balance')::integer,21,'Twenty-one completed transfers credit the helper once each');
SELECT is(jsonb_array_length((public.get_my_points()->'history')::jsonb),20,'Helper snapshot history is bounded too');

-- Anonymous or stale unauthenticated contexts cannot read/mutate points.
SELECT set_config('request.jwt.claim.sub','',true);
SELECT throws_ok($$SELECT public.get_my_points()$$,'42501',NULL,'Missing caller identity cannot read a wallet');
SELECT throws_ok($$SELECT public.complete_my_request(pg_temp.fixture('legacy'),2)$$,'42501',NULL,'Missing caller identity cannot confirm completion');
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.get_my_points()$$,'42501',NULL,'Anonymous wallet API denied');
SELECT throws_ok($$SELECT public.complete_my_request(NULL,1)$$,'42501',NULL,'Anonymous completion API denied');
SELECT throws_ok($$SELECT * FROM public.points_wallets$$,'42501',NULL,'Anonymous wallet table denied');
SELECT throws_ok($$SELECT * FROM public.points_ledger$$,'42501',NULL,'Anonymous ledger table denied');
SELECT throws_ok($$SELECT * FROM public.request_point_reservations$$,'42501',NULL,'Anonymous reservation table denied');
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT * FROM finish();
ROLLBACK;
