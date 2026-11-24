-- Aggregate inventory only. Each conversation, request and report counts once.
-- Run through dry-run.sql for a consistent read-only UTC snapshot.
WITH unclaimed AS (
  SELECT id, protected, window_end FROM safety_private.unclaimed_request_windows
),
records(category, protected, window_end) AS (
  SELECT CASE w.kind WHEN 'case' THEN 'moderation_cases' WHEN 'job' THEN 'jobs' ELSE 'direct_threads' END,
    w.protected, w.window_end FROM safety_private.retention_source_windows(:'retention_as_of'::timestamptz) w
    WHERE w.kind <> 'job' OR NOT EXISTS (SELECT FROM unclaimed p WHERE p.id=w.id)
  UNION ALL SELECT 'unclaimed_requests', protected, window_end FROM unclaimed
  UNION ALL SELECT CASE WHEN w.window_end IS NULL THEN 'other_notices'
      WHEN w.read_at IS NULL THEN 'unread_notices' ELSE 'read_notices' END,
    w.window_end IS NULL OR w.protected_through >= (:'retention_as_of'::timestamptz AT TIME ZONE 'UTC')::date, w.window_end
    FROM safety_private.bell_windows w
  -- The delivery worker uses a strict "older than 24 hours" comparison.
  UNION ALL SELECT 'push_jobs', false, n.created_at + interval '24 hours' + interval '1 microsecond'
    FROM notifications_private.push_jobs j JOIN public.notifications n ON n.id = j.notification_id
  -- The receipt row is still an access-control dependency even after its secret ages out.
  UNION ALL SELECT 'receipt_rows', true, account_private.deletion_receipt_expires_at(completed_at) FROM account_private.deletions
  UNION ALL SELECT 'deletion_receipts', completed_at IS NULL, account_private.deletion_receipt_expires_at(completed_at)
    FROM account_private.deletions WHERE receipt_hash IS NOT NULL
  UNION ALL SELECT 'profiles_and_tombstones', true, NULL FROM public.profiles
  UNION ALL SELECT 'course_memberships', true, NULL FROM public.course_memberships
  UNION ALL SELECT 'source_course_reviews', true, NULL FROM course_reviews_private.reviews
  UNION ALL SELECT 'group_threads', true, NULL FROM public.conversations WHERE type <> 'direct'
  UNION ALL SELECT 'account_standing', true, NULL FROM safety_private.account_standing
  UNION ALL SELECT 'registered_devices', true, NULL FROM notifications_private.android_push_devices
  UNION ALL SELECT 'welcome_grant_claims', true, NULL FROM points_private.starter_grant_claims
  UNION ALL SELECT 'saved_balances', true, NULL FROM points_private.returning_balances
  UNION ALL SELECT CASE WHEN original_hold THEN 'held_evidence_copies' ELSE 'released_evidence_copies' END,
    protected, eligible_at FROM safety_private.evidence_cleanup_windows(:'retention_as_of'::timestamptz)
),
categories(name) AS (VALUES ('direct_threads'),('jobs'),('unclaimed_requests'),('moderation_cases'),('read_notices'),('unread_notices'),
  ('other_notices'),('push_jobs'),('receipt_rows'),('deletion_receipts'),('profiles_and_tombstones'),('course_memberships'),
  ('source_course_reviews'),('group_threads'),('account_standing'),('registered_devices'),('welcome_grant_claims'),('saved_balances'),
  ('held_evidence_copies'),('released_evidence_copies'))
SELECT c.name AS category, count(r.category) AS total,
  count(*) FILTER (WHERE r.protected) AS protected,
  count(*) FILTER (WHERE NOT r.protected AND r.window_end > :'retention_as_of'::timestamptz) AS within_window,
  count(*) FILTER (WHERE NOT r.protected AND r.window_end <= :'retention_as_of'::timestamptz) AS due_for_review,
  min(r.window_end) FILTER (WHERE NOT r.protected AND r.window_end <= :'retention_as_of'::timestamptz) AS oldest_review_at,
  count(*) FILTER (WHERE r.protected AND r.window_end <= :'retention_as_of'::timestamptz AND c.name = 'receipt_rows') AS aged_receipts_still_protected
FROM categories c LEFT JOIN records r ON r.category = c.name
GROUP BY c.name
ORDER BY c.name;
