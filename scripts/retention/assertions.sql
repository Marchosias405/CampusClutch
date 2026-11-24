CREATE TEMP TABLE expected (
  category text PRIMARY KEY, protected int, within_window int, due_for_review int, oldest timestamptz, aged_receipts int
);
INSERT INTO expected VALUES
  ('direct_threads',4,1,2,pg_temp.as_of()-interval '2 years'+interval '30 days',0),
  ('jobs',6,2,2,pg_temp.as_of()-interval '1 year',0),
  ('unclaimed_requests',1,1,1,pg_temp.as_of(),0),
  ('moderation_cases',8,1,2,pg_temp.as_of()-interval '1 year',0),
  ('read_notices',1,1,1,pg_temp.as_of(),0),
  ('unread_notices',2,1,1,pg_temp.as_of(),0),
  ('push_jobs',0,1,2,pg_temp.as_of()-interval '2 years'+interval '24 hours 1 microsecond',0),
  ('receipt_rows',5,0,0,NULL,2),
  ('deletion_receipts',1,2,1,pg_temp.as_of()-interval '2 years'+interval '90 days',0),
  ('other_notices',3,0,0,NULL,0),
  ('profiles_and_tombstones',6,0,0,NULL,0),
  ('group_threads',1,0,0,NULL,0),
  ('account_standing',1,0,0,NULL,0),
  ('course_memberships',1,0,0,NULL,0),
  ('source_course_reviews',1,0,0,NULL,0),
  ('registered_devices',1,0,0,NULL,0),
  ('welcome_grant_claims',1,0,0,NULL,0),
  ('held_evidence_copies',0,0,0,NULL,0),
  ('released_evidence_copies',0,0,0,NULL,0),
  ('saved_balances',1,0,0,NULL,0);

CREATE FUNCTION pg_temp.check_report(scenario text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE differences text;
BEGIN
  SELECT string_agg(coalesce(e.category,r.category),', ' ORDER BY coalesce(e.category,r.category)) INTO differences
  FROM expected e FULL JOIN pg_temp.retention_report r USING (category)
  WHERE e.category IS NULL OR r.category IS NULL OR
    ROW(e.protected+e.within_window+e.due_for_review,e.protected,e.within_window,e.due_for_review,e.oldest,e.aged_receipts)
      IS DISTINCT FROM ROW(r.total,r.protected,r.within_window,r.due_for_review,r.oldest_review_at,r.aged_receipts_still_protected);
  IF differences IS NOT NULL THEN RAISE EXCEPTION '%: unexpected output for %', scenario, differences; END IF;
  RETURN 'PASS ' || scenario;
END $$;
SELECT pg_temp.check_report('all 20 categories, cutoff boundaries, counts and oldest dates');
SELECT pg_temp.check_report('same snapshot produces identical aggregates');

SAVEPOINT holds;
INSERT INTO safety_private.retention_holds(id,target_kind,target_id)
SELECT pg_temp.key(n),kind,pg_temp.key(target)
FROM (VALUES (801,'thread',10),(802,'job',20),(803,'case',50),(804,'notice',70),
             (805,'notice',70),(806,'notice',73),(807,'job',21)) x(n,kind,target);
UPDATE expected SET protected=protected+1,due_for_review=due_for_review-1,oldest=pg_temp.as_of()
WHERE category IN ('direct_threads','jobs','moderation_cases');
UPDATE expected SET protected=protected+1,due_for_review=0,oldest=NULL WHERE category IN ('read_notices','unread_notices');
SELECT pg_temp.check_report('active holds protect each target type without double-counting records');
INSERT INTO safety_private.deletion_evidence_batches(id,target_kind,target_id,notice_classified,notice_until) VALUES (pg_temp.key(900),'notice',pg_temp.key(70),true,pg_temp.as_of());
INSERT INTO safety_private.deletion_evidence_coverage(batch_id,hold_id) VALUES (pg_temp.key(900),pg_temp.key(804)),(pg_temp.key(900),pg_temp.key(805));
UPDATE expected SET protected=1 WHERE category='held_evidence_copies';
INSERT INTO safety_private.retention_hold_releases(hold_id) VALUES (pg_temp.key(804)),(pg_temp.key(807));
SELECT pg_temp.check_report('releasing one hold preserves independent holds and existing protections');
INSERT INTO safety_private.retention_hold_releases(hold_id) VALUES (pg_temp.key(805));
UPDATE expected SET protected=0 WHERE category='held_evidence_copies';
UPDATE expected SET due_for_review=1,oldest=pg_temp.as_of() WHERE category='released_evidence_copies';
UPDATE expected SET protected=protected-1,due_for_review=1,oldest=pg_temp.as_of() WHERE category='read_notices';
SELECT pg_temp.check_report('final release returns only that notice to normal age review');
ROLLBACK TO holds;

-- Removing a membership must protect even a previously aged-out conversation.
DELETE FROM public.conversation_members WHERE conversation_id=pg_temp.key(13) AND profile_id=pg_temp.key(5);
UPDATE expected SET protected=5, due_for_review=1 WHERE category='direct_threads';
SELECT pg_temp.check_report('incomplete direct pair is protected');

-- Reopening a case overrides its age, and a later appeal restarts the last-use clock.
UPDATE safety_private.reports SET triage_status='reviewing' WHERE id=pg_temp.key(50);
UPDATE expected SET protected=9,due_for_review=1,oldest=pg_temp.as_of() WHERE category='moderation_cases';
SELECT pg_temp.check_report('reopened case leaves the review count');
INSERT INTO safety_private.enforcement_actions(id,report_id,kind,created_at)
VALUES (pg_temp.key(153),pg_temp.key(53),'remove_review',pg_temp.as_of()-interval '2 years');
INSERT INTO safety_private.appeals(id,action_id,status,created_at)
VALUES (pg_temp.key(253),pg_temp.key(153),'pending',pg_temp.as_of()-interval '1 day');
UPDATE expected SET protected=10,due_for_review=0,oldest=NULL WHERE category='moderation_cases';
SELECT pg_temp.check_report('new appeal immediately protects aged evidence');
UPDATE safety_private.appeals SET status='overturned' WHERE id=pg_temp.key(253);
INSERT INTO safety_private.appeal_decisions(appeal_id,outcome,created_at)
VALUES (pg_temp.key(253),'overturned',pg_temp.as_of());
UPDATE expected SET protected=9,within_window=2 WHERE category='moderation_cases';
SELECT pg_temp.check_report('late appeal decision restarts the calendar year');

-- Old notices still backing queued pushes are protected until delivery finishes.
DELETE FROM notifications_private.push_jobs WHERE notification_id=pg_temp.key(72);
UPDATE expected SET protected=0,due_for_review=2,oldest=pg_temp.as_of()-interval '6 months'+interval '90 days'
WHERE category='read_notices';
UPDATE expected SET due_for_review=1,oldest=pg_temp.as_of() WHERE category='push_jobs';
SELECT pg_temp.check_report('delivery completion releases only its notice');

UPDATE account_private.deletions SET completed_at=pg_temp.as_of()-interval '90 days'
WHERE profile_id=pg_temp.key(4);
UPDATE expected SET aged_receipts=3 WHERE category='receipt_rows';
UPDATE expected SET protected=0,due_for_review=2 WHERE category='deletion_receipts';
UPDATE expected SET protected=4,due_for_review=2 WHERE category='direct_threads';
SELECT pg_temp.check_report('at 90 days the receipt hash is due and the completion record still anchors the DM clock');
UPDATE account_private.deletions SET receipt_hash=NULL WHERE profile_id IN (pg_temp.key(1),pg_temp.key(4));
UPDATE expected SET due_for_review=0,oldest=NULL WHERE category='deletion_receipts';
SELECT pg_temp.check_report('erasing expired receipt hashes preserves deletion rows and shared retention clocks');

INSERT INTO public.request_point_reservations(request_id,poster_id,helper_id,status)
VALUES (pg_temp.key(20),pg_temp.key(1),pg_temp.key(3),'settled');
UPDATE expected SET protected=7,due_for_review=1,oldest=pg_temp.as_of() WHERE category='jobs';
SELECT pg_temp.check_report('active helper visible only in the settlement protects old work');

UPDATE safety_private.reports SET reported_profile_id=pg_temp.key(3) WHERE id=pg_temp.key(57);
UPDATE safety_private.account_standing SET profile_id=pg_temp.key(3),suspended_until=pg_temp.as_of()+interval '1 day';
UPDATE expected SET protected=10,within_window=1 WHERE category='moderation_cases';
SELECT pg_temp.check_report('active account suspension protects otherwise closed related case');

DO $$ BEGIN
  IF (SELECT balance FROM points_private.returning_balances) IS DISTINCT FROM 47
     OR (SELECT count(*) FROM points_private.starter_grant_claims) <> 1
     OR (SELECT warning_count FROM safety_private.account_standing) IS DISTINCT FROM 3
  THEN RAISE EXCEPTION 'retention inventory changed wallet or standing data'; END IF;
END $$;
