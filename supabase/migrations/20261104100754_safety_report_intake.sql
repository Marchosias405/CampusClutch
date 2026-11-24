-- Task 14 checkpoint 1: private report intake, without automated sanctions.
-- Evidence survives account/request deletion. A retention/anonymization policy
-- and a trusted moderation workflow must be settled before production rollout.
create schema safety_private;
revoke all on schema safety_private from public, anon, authenticated, service_role;
grant usage on schema safety_private to authenticated;

create table safety_private.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles(id) on delete set null,
  operation_id uuid not null,
  target_type text not null check (target_type in ('student', 'request')),
  reported_profile_id uuid references public.profiles(id) on delete set null,
  request_id uuid references public.requests(id) on delete set null,
  reason text not null check (reason in ('harassment', 'scam', 'unsafe', 'spam', 'other')),
  details text not null check (details = btrim(details) and char_length(details) <= 2000),
  constraint safety_reports_other_details_check check (reason <> 'other' or char_length(details) >= 10),
  -- Only this fingerprint retains the canonical original target after its FK is
  -- set null. It permits exact retries without retaining a second raw target ID.
  payload_hash bytea not null check (octet_length(payload_hash) = 32),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  unique (reporter_id, operation_id),
  check (target_type = 'request' or request_id is null)
);
create index safety_reports_reporter_created_idx on safety_private.reports (reporter_id, created_at desc);
create index safety_reports_reported_profile_idx on safety_private.reports (reported_profile_id);
create index safety_reports_request_idx on safety_private.reports (request_id);
alter table safety_private.reports enable row level security;
revoke all on safety_private.reports from public, anon, authenticated, service_role;
comment on table safety_private.reports is
  'Private safety report intake. No client reads or automatic sanctions. Retention and trusted moderation are pending production decisions.';

create function safety_private.submit_report(
  p_operation_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_reason text,
  p_details text default ''
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_details text := btrim(coalesce(p_details, ''));
  v_hash bytea;
  v_existing safety_private.reports%rowtype;
  v_target_profile uuid;
  v_request_id uuid;
  v_evidence jsonb;
  v_report_id uuid;
  v_created_at timestamptz;
begin
  -- Never trust a JWT subject without a live, eligible account behind it.
  if v_actor is null or not exists (
    select 1 from public.profiles p join auth.users a on a.id = p.id
    where p.id = v_actor and p.onboarding_completed_at is not null
      and p.display_name is not null and btrim(p.display_name) <> '' and a.deleted_at is null
      and not coalesce(a.is_anonymous, false)
      and (a.banned_until is null or a.banned_until <= now())
  ) then
    raise exception using errcode = '42501', message = 'Sign in with a completed student profile to report a concern.';
  end if;

  if p_operation_id is null or p_target_id is null
     or p_target_type is null or p_target_type not in ('student', 'request')
     or p_reason is null or p_reason not in ('harassment', 'scam', 'unsafe', 'spam', 'other')
     or char_length(v_details) > 2000
     or (p_reason = 'other' and char_length(v_details) < 10) then
    raise exception using errcode = '22023', message = 'Invalid safety report. Choose a reason, keep details within 2,000 characters, and include at least 10 characters for Other.';
  end if;

  v_hash := extensions.digest(jsonb_build_object(
    'target_type', p_target_type, 'target_id', p_target_id,
    'reason', p_reason, 'details', v_details
  )::text, 'sha256');

  -- One lock serializes both retries and the rolling quota for this reporter.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('safety-report:' || v_actor::text, 0));
  select * into v_existing from safety_private.reports
    where reporter_id = v_actor and operation_id = p_operation_id;
  if found then
    if v_existing.payload_hash <> v_hash then
      raise exception using errcode = '22023', message = 'This report attempt was already used for different details. Start a new report.';
    end if;
    return jsonb_build_object('report_id', v_existing.id, 'created_at', v_existing.created_at);
  end if;

  -- SECURITY DEFINER bypasses source RLS. These explicit predicates mirror
  -- profiles SELECT and requests_read exactly (with self-reporting disallowed).
  -- Regression tests compare report eligibility against authenticated SELECT.
  if p_target_type = 'student' then
    select p.id, jsonb_build_object('display_name', p.display_name)
      into v_target_profile, v_evidence
      from public.profiles p
      where p.id = p_target_id and p.id <> v_actor
        and p.is_discoverable = true and p.onboarding_completed_at is not null
        and p.display_name is not null
      for share;
  else
    select r.owner_id, r.id, jsonb_build_object(
      'title', r.title, 'description', r.description, 'category', r.category,
      'points', r.points, 'status', r.status
    ) into v_target_profile, v_request_id, v_evidence
      from public.requests r
      where r.id = p_target_id and r.owner_id <> v_actor
        and ((r.status = 'open' and r.deadline_at > statement_timestamp())
          or request_private.is_accepted_helper(r.id)
          or request_private.has_request_assignment(r.id))
      for share;
  end if;
  if not found then
    -- Identical response for a missing, hidden, or self-owned target.
    raise exception using errcode = '42501', message = 'This report target is not available.';
  end if;

  if (select count(*) from safety_private.reports
      where reporter_id = v_actor and created_at >= clock_timestamp() - interval '24 hours') >= 10 then
    raise exception using errcode = '54000', message = 'You can submit up to 10 reports in 24 hours. Please try again later.';
  end if;

  insert into safety_private.reports (
    reporter_id, operation_id, target_type, reported_profile_id, request_id,
    reason, details, payload_hash, evidence
  ) values (
    v_actor, p_operation_id, p_target_type, v_target_profile, v_request_id,
    p_reason, v_details, v_hash, v_evidence
  ) returning id, created_at into v_report_id, v_created_at;
  return jsonb_build_object('report_id', v_report_id, 'created_at', v_created_at);
end;
$$;
revoke all on function safety_private.submit_report(uuid, text, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function safety_private.submit_report(uuid, text, uuid, text, text) to authenticated;

create function public.submit_safety_report(
  p_operation_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_reason text,
  p_details text default ''
) returns jsonb
language sql security invoker set search_path = '' as $$
  select safety_private.submit_report(p_operation_id, p_target_type, p_target_id, p_reason, p_details);
$$;
revoke all on function public.submit_safety_report(uuid, text, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.submit_safety_report(uuid, text, uuid, text, text) to authenticated;
