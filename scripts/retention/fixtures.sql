-- Synthetic keys make relationships readable; no application data is copied.
\set retention_as_of '2028-03-01 12:00:00+00'
CREATE TEMP VIEW fixture_clock AS SELECT :'retention_as_of'::timestamptz AS at;
CREATE FUNCTION pg_temp.as_of() RETURNS timestamptz LANGUAGE sql STABLE
AS $$ SELECT at FROM pg_temp.fixture_clock $$;
CREATE FUNCTION pg_temp.key(n int) RETURNS uuid LANGUAGE sql IMMUTABLE
AS $$ SELECT lpad(to_hex(n), 32, '0')::uuid $$;

-- 1 and 2 completed cleanup 2 years ago; 3 is active; 4 is pending;
-- 5 completed 30 days ago and 6 just inside the window.
INSERT INTO public.profiles(id,deleted_at)
SELECT pg_temp.key(n), CASE WHEN n <> 3 THEN pg_temp.as_of() - interval '2 years' END FROM generate_series(1,6) n;
INSERT INTO account_private.deletions(profile_id,completed_at) VALUES
  (pg_temp.key(1),pg_temp.as_of()-interval '2 years'),(pg_temp.key(2),pg_temp.as_of()-interval '2 years'),
  (pg_temp.key(4),NULL),(pg_temp.key(5),pg_temp.as_of()-interval '30 days'),
  (pg_temp.key(6),pg_temp.as_of()-interval '30 days'+interval '1 microsecond');
-- Account 2 already lost its receipt. Its completed deletion still anchors shared history.
UPDATE account_private.deletions SET receipt_hash=decode(repeat('aa',32),'hex') WHERE profile_id<>pg_temp.key(2);

INSERT INTO public.conversations(id,type,status) SELECT pg_temp.key(n),'direct','closed' FROM generate_series(10,16) n;
INSERT INTO public.conversations(id,type,status) VALUES (pg_temp.key(17),'group','closed');
INSERT INTO public.direct_conversation_pairs(conversation_id,user_low_id,user_high_id)
SELECT pg_temp.key(n),pg_temp.key(lo),pg_temp.key(hi)
FROM (VALUES (10,1,2),(11,1,3),(12,1,4),(13,1,5),(14,1,6),(15,2,5),(16,2,6)) p(n,lo,hi);
INSERT INTO public.conversation_members(conversation_id,profile_id)
SELECT conversation_id,party.id FROM public.direct_conversation_pairs
CROSS JOIN LATERAL (VALUES (user_low_id),(user_high_id)) party(id);
INSERT INTO public.messages(id,conversation_id) VALUES (pg_temp.key(40),pg_temp.key(15));
INSERT INTO public.request_conversations(request_id,conversation_id,poster_id,helper_id)
VALUES (pg_temp.key(28),pg_temp.key(16),pg_temp.key(2),pg_temp.key(6));

INSERT INTO public.requests(id,owner_id,status,created_at,updated_at)
SELECT pg_temp.key(n),pg_temp.key(1),CASE WHEN n=27 THEN 'accepted' ELSE 'completed' END,
  pg_temp.as_of()-interval '3 years',pg_temp.as_of()-interval '2 years' FROM generate_series(20,29) n;
INSERT INTO public.request_offers(id,request_id,offering_user_id,status,updated_at)
VALUES (pg_temp.key(100),pg_temp.key(20),pg_temp.key(2),'accepted',pg_temp.as_of()-interval '2 years'),
 (pg_temp.key(101),pg_temp.key(21),pg_temp.key(3),'withdrawn',pg_temp.as_of()-interval '2 years'),
 (pg_temp.key(102),pg_temp.key(22),pg_temp.key(2),'accepted',pg_temp.as_of()-interval '2 years'),
 (pg_temp.key(103),pg_temp.key(23),pg_temp.key(2),'accepted',pg_temp.as_of()-interval '2 years');
INSERT INTO public.request_offer_history(offer_id,recorded_at) VALUES
 (pg_temp.key(102),pg_temp.as_of()-interval '1 year'),(pg_temp.key(103),pg_temp.as_of()-interval '1 year'+interval '1 microsecond');
INSERT INTO public.request_ratings(request_id,rater_id,ratee_id,published_at)
VALUES (pg_temp.key(24),pg_temp.key(2),pg_temp.key(1),pg_temp.as_of()-interval '3 days');
INSERT INTO public.request_point_reservations(request_id,poster_id,helper_id,status)
VALUES (pg_temp.key(25),pg_temp.key(1),pg_temp.key(2),'reserved');
INSERT INTO public.points_ledger(request_id,profile_id,created_at)
VALUES (pg_temp.key(26),pg_temp.key(2),pg_temp.as_of()-interval '2 years');

-- Cases 50 through 60 include missing and inconsistent audit history.
INSERT INTO safety_private.reports(id,triage_status,created_at,message_id,request_id)
SELECT pg_temp.key(n),CASE WHEN n=51 THEN 'escalated' WHEN n=52 THEN 'new' ELSE 'dismissed' END,
  pg_temp.as_of()-interval '2 years',CASE WHEN n=52 THEN pg_temp.key(40) END,CASE WHEN n=52 THEN pg_temp.key(29) END
FROM generate_series(50,60) n;
INSERT INTO safety_private.report_decisions(report_id,to_status,version,created_at)
SELECT id,triage_status,1,pg_temp.as_of()-interval '2 years' FROM safety_private.reports WHERE id <> pg_temp.key(59);
INSERT INTO safety_private.report_decisions(report_id,to_status,version,created_at)
VALUES (pg_temp.key(60),'reviewing',2,pg_temp.as_of()-interval '2 years');
UPDATE safety_private.report_decisions SET created_at=pg_temp.as_of()-interval '1 year' WHERE report_id=pg_temp.key(53);
INSERT INTO safety_private.enforcement_actions(id,report_id,kind,created_at,suspended_until)
SELECT pg_temp.key(n+100),pg_temp.key(n),
  CASE n WHEN 54 THEN 'warn' WHEN 55 THEN 'suspend_7_days' ELSE 'remove_review' END,
  pg_temp.as_of()-interval '2 years', CASE WHEN n=55 THEN pg_temp.as_of()+interval '1 day' END FROM generate_series(54,58) n;
INSERT INTO safety_private.appeals(id,action_id,status,created_at)
VALUES (pg_temp.key(256),pg_temp.key(156),'pending',pg_temp.as_of()-interval '2 years'),
 (pg_temp.key(257),pg_temp.key(157),'upheld',pg_temp.as_of()-interval '2 years'),
 (pg_temp.key(258),pg_temp.key(158),'upheld',pg_temp.as_of()-interval '2 years');
INSERT INTO safety_private.appeal_decisions(appeal_id,outcome,created_at)
VALUES (pg_temp.key(257),'upheld',pg_temp.as_of()-interval '4 days');

-- Read age starts at read_at. Moderation notices and unknown future kinds stay protected.
INSERT INTO public.notifications(id,event_type,created_at,read_at)
SELECT pg_temp.key(n),
  CASE n WHEN 77 THEN 'account_warning' WHEN 78 THEN 'appeal_decided' WHEN 79 THEN 'future_type' ELSE 'message_received' END,
  CASE n WHEN 73 THEN pg_temp.as_of()-interval '180 days' WHEN 74 THEN pg_temp.as_of()-interval '180 days'+interval '1 microsecond'
         WHEN 75 THEN pg_temp.as_of()-interval '24 hours' WHEN 76 THEN pg_temp.as_of()-interval '24 hours'-interval '1 microsecond'
         ELSE pg_temp.as_of()-interval '2 years' END,
  CASE n WHEN 70 THEN pg_temp.as_of()-interval '90 days' WHEN 71 THEN pg_temp.as_of()-interval '90 days'+interval '1 microsecond'
         WHEN 72 THEN pg_temp.as_of()-interval '6 months' END
FROM generate_series(70,79) n;
-- A recently delivered import keeps its full window despite the older offer date.
UPDATE public.notifications SET event_type='offer_created',delivered_at=created_at,
  created_at=pg_temp.as_of()-interval '2 years' WHERE id=pg_temp.key(74);
INSERT INTO notifications_private.push_jobs(notification_id) VALUES (pg_temp.key(72)),(pg_temp.key(75)),(pg_temp.key(76));

INSERT INTO public.course_memberships DEFAULT VALUES;
INSERT INTO course_reviews_private.reviews DEFAULT VALUES;
INSERT INTO safety_private.account_standing(warning_count) VALUES (3);
INSERT INTO points_private.returning_balances(balance) VALUES (47);

-- Plain postings owned by a current student, including a physically open stale row.
INSERT INTO public.requests(id,owner_id,status,offer_round,created_at,updated_at,deadline_at)
SELECT pg_temp.key(n),pg_temp.key(3),CASE WHEN n=1031 THEN 'open' ELSE 'expired' END,1,
  pg_temp.as_of()-interval '150 days',pg_temp.as_of()-interval '100 days',
  pg_temp.as_of()-interval '90 days'+CASE WHEN n=1032 THEN interval '1 microsecond' ELSE interval '0' END
FROM generate_series(1031,1033) n;
INSERT INTO safety_private.retention_holds(id,target_kind,target_id) VALUES (pg_temp.key(1034),'job',pg_temp.key(1033));
INSERT INTO points_private.starter_grant_claims(claimed_at) VALUES (pg_temp.as_of()-interval '5 years');
INSERT INTO notifications_private.android_push_devices DEFAULT VALUES;
