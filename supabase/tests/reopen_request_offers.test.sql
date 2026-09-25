BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT no_plan();

-- Everything, including profiles, events and audit history, rolls back at EOF.
INSERT INTO auth.users(id,email)
SELECT ('91919191-9191-4919-8919-'||lpad(i::text,12,'0'))::uuid,
  'reopen-'||i||'@test.local' FROM generate_series(1,6) i;
UPDATE public.profiles SET display_name='Reopen Tester',major='Computing Science',year_of_study=2,
  campus_id=(SELECT id FROM public.campuses WHERE slug='burnaby')
WHERE id IN (SELECT ('91919191-9191-4919-8919-'||lpad(i::text,12,'0'))::uuid FROM generate_series(1,5) i);
CREATE FUNCTION pg_temp.login(i integer) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub','91919191-9191-4919-8919-'||lpad(i::text,12,'0'),true);
$$;
CREATE FUNCTION pg_temp.payload() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('category','delivery','title','Reopen test','description','Please help with this request.',
    'campus_id',(SELECT id FROM public.campuses WHERE slug='burnaby'),'room_location','Library',
    'deadline_at',clock_timestamp()+interval '1 day','points',10,'item_size','small',
    'details','{"pickup_location":"Cafe","dropoff_location":"Library"}'::jsonb);
$$;
CREATE TEMP TABLE fixtures(name text PRIMARY KEY,id uuid);
GRANT ALL ON fixtures TO authenticated;
CREATE FUNCTION pg_temp.fixture(p_name text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM fixtures WHERE name=p_name;
$$;
CREATE TEMP TABLE saved_deadline(value timestamptz);
GRANT ALL ON saved_deadline TO authenticated;

SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
INSERT INTO fixtures SELECT n,public.save_my_request(pg_temp.payload())
FROM unnest(ARRAY['accepted','open','cancelled','completed','expired','deadline','renew-late','accepted-late','rollback']) n;
SELECT is((SELECT offer_round FROM public.requests WHERE id=pg_temp.fixture('accepted')),1,'Requests start in offer round one');
SELECT pg_temp.login(2);
INSERT INTO fixtures SELECT 'selected',public.create_my_request_offer_for_terms(pg_temp.fixture('accepted'),1,10,'First consent');
INSERT INTO fixtures SELECT 'open-first',public.create_my_request_offer_for_terms(pg_temp.fixture('open'),1,10,'Open offer');
INSERT INTO fixtures SELECT 'deadline-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('deadline'),1,10);
INSERT INTO fixtures SELECT 'renew-late-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('renew-late'),1,10);
INSERT INTO fixtures SELECT 'accepted-late-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('accepted-late'),1,10);
INSERT INTO fixtures SELECT 'rollback-offer',public.create_my_request_offer_for_terms(pg_temp.fixture('rollback'),1,10);
SELECT pg_temp.login(3);
INSERT INTO fixtures SELECT 'declined',public.create_my_request_offer_for_terms(pg_temp.fixture('accepted'),1,10,'Original declined message');
INSERT INTO fixtures SELECT 'open-second',public.create_my_request_offer_for_terms(pg_temp.fixture('open'),1,10);
SELECT pg_temp.login(4);
INSERT INTO fixtures SELECT 'withdrawn',public.create_my_request_offer_for_terms(pg_temp.fixture('accepted'),1,10,'Original withdrawn message');
SELECT public.decide_request_offer_for_round(pg_temp.fixture('withdrawn'),'withdrawn',1);
SELECT is(public.renew_my_request_offer_for_terms(pg_temp.fixture('withdrawn'),1,10,'Unapproved return'),pg_temp.fixture('withdrawn'),'Same-round renewal retry returns the existing offer');
SELECT is((SELECT status FROM public.request_offers WHERE id=pg_temp.fixture('withdrawn')),'withdrawn','Same-round renewal never reactivates withdrawn consent');
SELECT is((SELECT message FROM public.request_offers WHERE id=pg_temp.fixture('withdrawn')),'Original withdrawn message','Same-round renewal never replaces a terminal offer message');
SELECT pg_temp.login(1);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('declined'),'rejected',1);
SELECT pg_temp.login(3);
SELECT public.renew_my_request_offer_for_terms(pg_temp.fixture('declined'),1,10,'Unapproved retry');
SELECT is((SELECT status FROM public.request_offers WHERE id=pg_temp.fixture('declined')),'rejected','Declined helper cannot reactivate before the owner reopens');
SELECT pg_temp.login(1);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('selected'),'accepted',1,10);
SELECT ok((SELECT status='accepted' AND accepted_at IS NOT NULL FROM public.requests WHERE id=pg_temp.fixture('accepted')),'Acceptance is recorded before reopening');

-- Authorization and validation must precede changes to selection or rounds.
SELECT pg_temp.login(2);
SELECT throws_ok($$SELECT public.reopen_my_request(pg_temp.fixture('accepted'),1,clock_timestamp()+interval '2 days')$$,'42501',NULL,'Selected helper cannot reopen the owner request');
SELECT pg_temp.login(5);
SELECT throws_ok($$SELECT public.reopen_my_request(pg_temp.fixture('accepted'),1,clock_timestamp()+interval '2 days')$$,'42501',NULL,'Unrelated account cannot reopen');
SELECT throws_ok($$SELECT public.renew_my_request_offer_for_terms(pg_temp.fixture('declined'),1,10)$$,'42501',NULL,'Unrelated account cannot renew another helper offer');
SELECT pg_temp.login(1);
SELECT throws_ok($$SELECT public.renew_my_request_offer_for_terms(pg_temp.fixture('declined'),1,10)$$,'42501',NULL,'Owner cannot give renewed consent on behalf of a helper');
SELECT throws_ok($$SELECT public.reopen_my_request(pg_temp.fixture('accepted'),0,clock_timestamp()+interval '2 days')$$,'22023',NULL,'Zero expected round is invalid');
SELECT throws_ok($$SELECT public.reopen_my_request(pg_temp.fixture('accepted'),NULL,clock_timestamp()+interval '2 days')$$,'22023',NULL,'Missing expected round is invalid');
SELECT throws_ok($$SELECT public.reopen_my_request(pg_temp.fixture('accepted'),2,clock_timestamp()+interval '2 days')$$,'22023',NULL,'Future expected round is rejected');
SELECT throws_ok($$SELECT public.reopen_my_request(pg_temp.fixture('accepted'),1,NULL)$$,'22023',NULL,'Missing new deadline is rejected');
SELECT throws_ok($$SELECT public.reopen_my_request(pg_temp.fixture('accepted'),1,clock_timestamp()-interval '1 minute')$$,'22023',NULL,'Past new deadline is rejected');
SELECT throws_ok($$SELECT public.reopen_my_request(pg_temp.fixture('accepted'),1,'infinity'::timestamptz)$$,'22023',NULL,'Infinite new deadline is rejected');
SELECT ok((SELECT status='accepted' AND offer_round=1 AND accepted_at IS NOT NULL FROM public.requests WHERE id=pg_temp.fixture('accepted')),'Invalid reopen leaves the original acceptance intact');

-- Reopening retires consent but preserves the permanent offer and its history.
INSERT INTO saved_deadline VALUES(clock_timestamp()+interval '2 days');
SELECT is(public.reopen_my_request(pg_temp.fixture('accepted'),1,(SELECT value FROM saved_deadline)),pg_temp.fixture('accepted'),'Owner reopens an accepted request');
SELECT ok((SELECT status='open' AND offer_round=2 AND accepted_at IS NULL AND deadline_at=(SELECT value FROM saved_deadline)
  FROM public.requests WHERE id=pg_temp.fixture('accepted')),'Reopen clears acceptance, increments round, and saves the new deadline');
SELECT is((SELECT count(*) FROM public.request_offers WHERE request_id=pg_temp.fixture('accepted') AND status IN ('pending','accepted')),0::bigint,'No old acceptance or pending consent survives reopen');
SELECT is((SELECT status FROM public.request_offers WHERE id=pg_temp.fixture('selected')),'rejected','Previously selected helper is no longer assigned');
SELECT is((SELECT offer_round FROM public.request_offers WHERE id=pg_temp.fixture('selected')),1,'Retired offer remains associated with its original round');
SELECT is((SELECT status FROM public.request_offers WHERE id=pg_temp.fixture('withdrawn')),'withdrawn','Reopen preserves a helper withdrawal');
SELECT is((SELECT count(*) FROM public.request_offer_history WHERE offer_id=pg_temp.fixture('selected') AND status='accepted' AND offer_round=1),1::bigint,'Original acceptance remains in audit history');
SELECT is((SELECT count(*) FROM public.get_request_feed() WHERE id=pg_temp.fixture('accepted')),1::bigint,'Reopened request returns to the campus feed');
SELECT is((SELECT count(*) FROM public.get_request_offer_page_v3(pg_temp.fixture('accepted')) WHERE offer_round=1 AND request_offer_round=2),3::bigint,'Owner review page distinguishes prior offer rounds from the current round');
SELECT throws_ok($$SELECT public.decide_request_offer_for_round(pg_temp.fixture('selected'),'accepted',2,10)$$,'22023',NULL,'Owner cannot accept retired consent even with the current request round');
SELECT throws_ok($$SELECT public.reopen_my_request(pg_temp.fixture('accepted'),1,clock_timestamp()+interval '7 days')$$,'22023',NULL,'Changed-deadline stale reopen is not an idempotent retry');
SELECT is(public.reopen_my_request(pg_temp.fixture('accepted'),1,(SELECT value FROM saved_deadline)),pg_temp.fixture('accepted'),'Exact reopen retry is harmless while still open');
SELECT ok((SELECT offer_round=2 AND deadline_at=(SELECT value FROM saved_deadline) FROM public.requests WHERE id=pg_temp.fixture('accepted')),'Reopen retry neither increments again nor changes the saved deadline');

SELECT pg_temp.login(2);
SELECT is((SELECT count(*) FROM public.offer_notifications WHERE offer_id=pg_temp.fixture('selected') AND event_type='request_reopened' AND offer_round=1),1::bigint,'Former selected helper gets one reopen event for the retired round');
SELECT is(public.create_my_request_offer_for_terms(pg_temp.fixture('accepted'),2,10,'Guarded retry'),pg_temp.fixture('selected'),'Guarded create retry returns the old offer');
SELECT is((SELECT status FROM public.request_offers WHERE id=pg_temp.fixture('selected')),'rejected','Guarded create retry does not silently renew old consent');
SELECT throws_ok($$SELECT public.renew_my_request_offer_for_terms(pg_temp.fixture('selected'),1,10,'Stale consent')$$,'22023',NULL,'Stale renewal round is rejected');
SELECT is(public.renew_my_request_offer_for_terms(pg_temp.fixture('selected'),2,10,'  Fresh consent  '),pg_temp.fixture('selected'),'Former selected helper can explicitly offer in the new round');
SELECT ok((SELECT status='pending' AND offer_round=2 AND message='Fresh consent' AND decided_at IS NULL AND withdrawn_at IS NULL
  FROM public.request_offers WHERE id=pg_temp.fixture('selected')),'Renewal clears old decision timestamps and trims the new message');
SELECT public.renew_my_request_offer_for_terms(pg_temp.fixture('selected'),2,10,'Retry must not change message');
SELECT is((SELECT message FROM public.request_offers WHERE id=pg_temp.fixture('selected')),'Fresh consent','Renewal retry preserves the original new-round consent');
SELECT is((SELECT count(*) FROM public.request_offer_history WHERE offer_id=pg_temp.fixture('selected') AND offer_round=2 AND status='pending'),1::bigint,'Renewal retry does not duplicate audit entries');
SELECT is((SELECT count(*) FROM public.request_offer_history WHERE offer_id=pg_temp.fixture('selected') AND offer_round=1 AND message='First consent'),3::bigint,'History preserves the previous message through pending, accepted, and retired states');
SELECT pg_temp.login(3);
SELECT is(public.renew_my_request_offer_for_terms(pg_temp.fixture('declined'),2,10,'New declined-helper consent'),pg_temp.fixture('declined'),'Previously declined helper may consent again after reopen');
SELECT pg_temp.login(4);
SELECT is(public.renew_my_request_offer_for_terms(pg_temp.fixture('withdrawn'),2,10,'   '),pg_temp.fixture('withdrawn'),'Previously withdrawn helper may consent again after reopen');
SELECT ok((SELECT status='pending' AND offer_round=2 AND withdrawn_at IS NULL AND decided_at IS NULL AND message IS NULL
  FROM public.request_offers WHERE id=pg_temp.fixture('withdrawn')),'Withdrawn renewal resets timestamps and normalizes a blank message');
SELECT pg_temp.login(1);
SELECT is((SELECT count(*) FROM public.offer_notifications WHERE offer_id=pg_temp.fixture('selected') AND event_type='created'),2::bigint,'Owner receives one created event in each offered round');
SELECT is((SELECT count(*) FROM public.offer_notifications WHERE offer_id=pg_temp.fixture('selected') AND event_type='created' AND offer_round=2),1::bigint,'Renewal retry does not duplicate the current-round event');
SELECT throws_ok($$SELECT public.decide_request_offer_for_round(pg_temp.fixture('declined'),'accepted',1,10)$$,'22023',NULL,'Old acceptance dialog cannot select a renewed offer');
SELECT throws_ok($$SELECT public.decide_request_offer(pg_temp.fixture('declined'),'accepted')$$,'22023',NULL,'Legacy public acceptance cannot decide a renewed offer');
SELECT throws_ok($$SELECT request_private.decide_offer(pg_temp.fixture('declined'),'accepted')$$,'22023',NULL,'Legacy private acceptance cannot decide a renewed offer');
SELECT is((SELECT status FROM public.request_offers WHERE id=pg_temp.fixture('declined')),'pending','Stale decision leaves current consent pending');
SELECT public.reopen_my_request(pg_temp.fixture('accepted'),1,(SELECT value FROM saved_deadline));
SELECT is((SELECT count(*) FROM public.request_offers WHERE request_id=pg_temp.fixture('accepted') AND status='pending'),3::bigint,'Original reopen retry does not retire new-round pending offers');
SELECT public.decide_request_offer_for_round(pg_temp.fixture('declined'),'accepted',2,10);
SELECT throws_ok($$SELECT public.reopen_my_request(pg_temp.fixture('accepted'),1,clock_timestamp()+interval '3 days')$$,'22023',NULL,'Old reopen retry cannot undo a newer acceptance');
SELECT ok((SELECT status='accepted' AND offer_round=2 AND accepted_at IS NOT NULL FROM public.requests WHERE id=pg_temp.fixture('accepted')),'Newer acceptance survives stale reopen');
SELECT is((SELECT status FROM public.request_offers WHERE id=pg_temp.fixture('declined')),'accepted','Newly chosen helper stays selected');
SELECT is((SELECT count(*) FROM public.get_request_feed() WHERE id=pg_temp.fixture('accepted')),0::bigint,'Accepted request leaves the open campus feed');
SELECT is((SELECT count(*) FROM public.requests WHERE id=pg_temp.fixture('accepted') AND owner_id=auth.uid()),1::bigint,'Accepted request remains readable in owner history');

-- Multiple reopening cycles must not collide with earlier notification keys.
SELECT public.reopen_my_request(pg_temp.fixture('accepted'),2,clock_timestamp()+interval '3 days');
SELECT pg_temp.login(3);
SELECT public.renew_my_request_offer_for_terms(pg_temp.fixture('declined'),3,10,'Third round consent');
SELECT pg_temp.login(1);
SELECT public.decide_request_offer_for_round(pg_temp.fixture('declined'),'accepted',3,10);
SELECT is((SELECT count(*) FROM public.offer_notifications WHERE offer_id=pg_temp.fixture('declined') AND event_type='created'),3::bigint,'Created events remain distinct through three offer rounds');
SELECT pg_temp.login(3);
SELECT is((SELECT count(*) FROM public.offer_notifications WHERE offer_id=pg_temp.fixture('declined') AND event_type='accepted'),2::bigint,'Acceptance notifications are delivered once for each accepted round');
SELECT is((SELECT count(*) FROM public.requests WHERE id=pg_temp.fixture('accepted')),1::bigint,'Currently accepted helper retains request details access');
SELECT is((SELECT offer_round FROM public.get_request_offer_page_v3(NULL) WHERE id=pg_temp.fixture('declined')),3,'My offers reports the renewed offer round');
SELECT is((SELECT count(*) FROM public.request_offer_history WHERE offer_id=pg_temp.fixture('selected')),0::bigint,'Helper cannot read another helper audit history');
SELECT ok((SELECT count(*)>0 FROM public.request_offer_history WHERE offer_id=pg_temp.fixture('declined')),'Helper can read their own earlier audit history');
SELECT pg_temp.login(2);
SELECT is((SELECT count(*) FROM public.requests WHERE id=pg_temp.fixture('accepted')),0::bigint,'Former helper loses selected-helper access after another helper is accepted');
SELECT is((SELECT count(*) FROM public.get_request_offer_page_v3(NULL) WHERE id=pg_temp.fixture('selected')),1::bigint,'Former helper retains their offer summary after losing detail access');
SELECT pg_temp.login(5);
SELECT is((SELECT count(*) FROM public.request_offer_history WHERE offer_id IN (SELECT id FROM fixtures)),0::bigint,'Unrelated accounts cannot read fixture offer histories');
SELECT is((SELECT count(*) FROM public.get_request_offer_page_v3(pg_temp.fixture('accepted'))),0::bigint,'Unrelated account cannot list reopened-request offers');

-- Open requests can also restart selection after a decline or withdrawal.
SELECT pg_temp.login(1);
SELECT public.reopen_my_request(pg_temp.fixture('open'),1,clock_timestamp()+interval '2 days');
SELECT is((SELECT count(*) FROM public.request_offers WHERE request_id=pg_temp.fixture('open') AND status='rejected'),2::bigint,'Reopening an open request retires every pending offer');
SELECT is((SELECT count(*) FROM public.request_offers WHERE request_id=pg_temp.fixture('open') AND offer_round=1),2::bigint,'Retired pending offers keep their old round');
SELECT pg_temp.login(2);
SELECT is((SELECT count(*) FROM public.offer_notifications WHERE offer_id=pg_temp.fixture('open-first') AND event_type='request_reopened'),1::bigint,'Pending helper receives its reopen event');
SELECT pg_temp.login(1);
SELECT public.cancel_my_request(pg_temp.fixture('cancelled'));
SELECT throws_ok($$SELECT public.reopen_my_request(pg_temp.fixture('cancelled'),1,clock_timestamp()+interval '1 day')$$,'22023',NULL,'Cancelled request cannot be reopened through this workflow');
SELECT public.reopen_my_request(pg_temp.fixture('renew-late'),1,clock_timestamp()+interval '1 day');
SELECT public.decide_request_offer_for_round(pg_temp.fixture('accepted-late-offer'),'accepted',1,10);
RESET ROLE;
UPDATE public.requests SET status='completed',completed_at=clock_timestamp() WHERE id=pg_temp.fixture('completed');
UPDATE public.requests SET status='expired',deadline_at=clock_timestamp()-interval '1 minute' WHERE id=pg_temp.fixture('expired');
UPDATE public.requests SET deadline_at=clock_timestamp()-interval '1 minute' WHERE id=pg_temp.fixture('deadline');
UPDATE public.requests SET deadline_at=clock_timestamp()-interval '1 minute' WHERE id=pg_temp.fixture('accepted-late');
UPDATE public.requests SET deadline_at=clock_timestamp()-interval '1 minute' WHERE id=pg_temp.fixture('renew-late');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT throws_ok($$SELECT public.reopen_my_request(pg_temp.fixture('completed'),1,clock_timestamp()+interval '1 day')$$,'22023',NULL,'Completed request cannot be reopened');
SELECT throws_ok($$SELECT public.reopen_my_request(pg_temp.fixture('expired'),1,clock_timestamp()+interval '1 day')$$,'22023',NULL,'Settled expired request cannot be reopened');
SELECT throws_ok($$SELECT public.reopen_my_request(pg_temp.fixture('deadline'),1,clock_timestamp()+interval '1 day')$$,'22023',NULL,'Overdue stored-open request cannot bypass expiry by reopening');
SELECT public.get_request_offer_page_v3(pg_temp.fixture('deadline'));
SELECT is((SELECT status FROM public.requests WHERE id=pg_temp.fixture('deadline')),'expired','Offer refresh settles the overdue request');
SELECT throws_ok($$SELECT public.reopen_my_request(pg_temp.fixture('deadline'),1,clock_timestamp()+interval '1 day')$$,'22023',NULL,'The same overdue request is still denied after expiry settlement');
SELECT lives_ok($$SELECT public.reopen_my_request(pg_temp.fixture('accepted-late'),1,clock_timestamp()+interval '1 day')$$,'Accepted request can reopen with a new future deadline after its old deadline passes');
SELECT ok((SELECT status='open' AND offer_round=2 AND accepted_at IS NULL FROM public.requests WHERE id=pg_temp.fixture('accepted-late')),'Accepted-past-deadline reopening starts a fresh round without old acceptance');
SELECT pg_temp.login(2);
SELECT throws_ok($$SELECT public.renew_my_request_offer_for_terms(pg_temp.fixture('renew-late-offer'),2,10)$$,'22023',NULL,'Server deadline blocks renewal even before expiry is settled');
SELECT is((SELECT status FROM public.request_offers WHERE id=pg_temp.fixture('renew-late-offer')),'rejected','Failed late renewal preserves retired status');
SELECT pg_temp.login(6);
SELECT throws_ok($$SELECT public.renew_my_request_offer_for_terms(pg_temp.fixture('renew-late-offer'),2,10)$$,'42501',NULL,'Incomplete profile cannot use renewal');

-- Client privileges protect both current state and the audit trail.
SELECT pg_temp.login(1);
SELECT throws_ok($$UPDATE public.requests SET offer_round=99 WHERE id=pg_temp.fixture('accepted')$$,'42501',NULL,'Client cannot directly advance request rounds');
SELECT throws_ok($$UPDATE public.request_offers SET offer_round=99 WHERE id=pg_temp.fixture('selected')$$,'42501',NULL,'Client cannot directly replace an offer round');
SELECT throws_ok($$INSERT INTO public.request_offer_history(offer_id,offer_round,status) VALUES(pg_temp.fixture('selected'),99,'accepted')$$,'42501',NULL,'Client cannot fabricate offer history');
SELECT throws_ok($$UPDATE public.request_offer_history SET status='accepted' WHERE offer_id=pg_temp.fixture('selected')$$,'42501',NULL,'Client cannot rewrite offer history');
SELECT throws_ok($$DELETE FROM public.request_offer_history WHERE offer_id=pg_temp.fixture('selected')$$,'42501',NULL,'Client cannot erase offer history');
SELECT throws_ok($$UPDATE public.offer_notifications SET offer_round=99 WHERE offer_id=pg_temp.fixture('selected')$$,'42501',NULL,'Client cannot alter notification rounds');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT throws_ok($$SELECT public.reopen_my_request(pg_temp.fixture('open'),2,clock_timestamp()+interval '2 days')$$,'42501',NULL,'Missing authenticated identity cannot reopen');
SELECT throws_ok($$SELECT public.renew_my_request_offer_for_terms(pg_temp.fixture('selected'),3,10)$$,'42501',NULL,'Missing authenticated identity cannot renew');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.reopen_my_request(NULL,1,clock_timestamp()+interval '1 day')$$,'42501',NULL,'Anonymous reopen is denied');
SELECT throws_ok($$SELECT public.renew_my_request_offer_for_terms(NULL,1,10)$$,'42501',NULL,'Anonymous renewal is denied');
SELECT throws_ok($$SELECT * FROM public.request_offer_history$$,'42501',NULL,'Anonymous history reads are denied');
SELECT throws_ok($$SELECT * FROM public.get_request_offer_page_v3(NULL)$$,'42501',NULL,'Anonymous offer review is denied');

-- A failed event write must roll back reopening and its consent/history changes.
RESET ROLE;
CREATE FUNCTION pg_temp.fail_reopen_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF new.event_type='request_reopened' THEN RAISE EXCEPTION 'test reopen event failure' USING errcode='P0001'; END IF;
  RETURN new;
END $$;
CREATE TRIGGER test_reopen_event_failure BEFORE INSERT ON public.offer_notifications
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_reopen_event();
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(1);
SELECT throws_ok($$SELECT public.reopen_my_request(pg_temp.fixture('rollback'),1,clock_timestamp()+interval '2 days')$$,'P0001','test reopen event failure','Notification failure rolls back the entire reopen');
SELECT ok((SELECT status='open' AND offer_round=1 FROM public.requests WHERE id=pg_temp.fixture('rollback')),'Failed reopen leaves request and round unchanged');
SELECT is((SELECT status FROM public.request_offers WHERE id=pg_temp.fixture('rollback-offer')),'pending','Failed reopen preserves pending consent');
SELECT is((SELECT count(*) FROM public.request_offer_history WHERE offer_id=pg_temp.fixture('rollback-offer')),1::bigint,'Failed reopen leaves no false audit entry');
RESET ROLE;
DROP TRIGGER test_reopen_event_failure ON public.offer_notifications;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT * FROM finish();
ROLLBACK;
