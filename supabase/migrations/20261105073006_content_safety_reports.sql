-- Task 14 checkpoint 3: report one readable direct message or course review.
-- Private source links are nullable so deletion cannot erase submitted evidence.
alter table safety_private.reports
  drop constraint reports_target_type_check,
  add constraint reports_target_type_check check (target_type in ('student', 'request', 'message', 'course_review')),
  add column message_id uuid references public.messages(id) on delete set null,
  add column course_review_id uuid references course_reviews_private.reviews(id) on delete set null,
  add constraint safety_reports_message_type_check check (target_type = 'message' or message_id is null),
  add constraint safety_reports_course_review_type_check check (target_type = 'course_review' or course_review_id is null);
create index safety_reports_message_idx on safety_private.reports(message_id);
create index safety_reports_course_review_idx on safety_private.reports(course_review_id);

-- Internal projection shared by context and intake. It is not callable by API
-- roles and must never be exposed: reported_profile_id includes review authors.
-- Its callers validate the actor; source locks keep snapshots and FKs coherent.
create function safety_private.content_report_target(p_target_type text, p_target_id uuid, p_actor uuid)
returns table (reported_profile_id uuid, evidence jsonb, target_label text)
language plpgsql security invoker set search_path = '' as $$
begin
  if p_target_type = 'message' then
    return query
      select m.sender_id, jsonb_build_object('body', m.body, 'created_at', m.created_at),
        'Direct message'::text
      from public.messages m
      where m.id = p_target_id and m.sender_id <> p_actor
        and messaging_private.can_read_message(m.conversation_id, m.sequence)
        -- Match get_conversation_messages history bounds, including retained
        -- direct membership periods. Blocks do not revoke readable history.
        and exists (
          select 1 from public.group_membership_periods visible_period
          where visible_period.conversation_id = m.conversation_id
            and visible_period.profile_id = p_actor
            and m.sequence > visible_period.starts_after_sequence
            and (visible_period.ends_at_sequence is null or m.sequence <= visible_period.ends_at_sequence)
        )
      for share of m;
  elsif p_target_type = 'course_review' then
    return query
      select r.author_id, jsonb_build_object(
        'course_code', r.course_code, 'term_name', t.display_name,
        'comment', r.comment, 'tips', r.tips, 'instructor', r.instructor,
        'created_at', r.created_at
      ), r.course_code || ' course review'
      from course_reviews_private.reviews r
      join public.academic_terms t on t.id = r.term_id
      where r.id = p_target_id and r.author_id <> p_actor
        -- list_course_reviews is available to eligible students for every
        -- catalogued course code; enrollment is only needed to write a review.
        and exists (select 1 from public.courses c where c.code = r.course_code)
      for share of r;
  end if;
end;
$$;
revoke all on function safety_private.content_report_target(text, uuid, uuid)
  from public, anon, authenticated, service_role;

create function safety_private.report_target(p_target_type text, p_target_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := safety_private.require_actor();
  v_label text;
begin
  if p_target_id is null or p_target_type is null or p_target_type not in ('message', 'course_review') then
    raise exception using errcode = '22023', message = 'Invalid safety report target.';
  end if;
  select target.target_label into v_label
    from safety_private.content_report_target(p_target_type, p_target_id, v_actor) target;
  if not found then
    raise exception using errcode = '42501', message = 'This report target is not available.';
  end if;
  -- No author id/name, raw evidence, conversation id, or source content escapes.
  return jsonb_build_object('target_type', p_target_type, 'target_id', p_target_id, 'target_label', v_label);
end;
$$;
revoke all on function safety_private.report_target(text, uuid) from public, anon, authenticated, service_role;
grant execute on function safety_private.report_target(text, uuid) to authenticated;

create function public.get_safety_report_target(p_target_type text, p_target_id uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  select safety_private.report_target(p_target_type, p_target_id);
$$;
revoke all on function public.get_safety_report_target(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_safety_report_target(text, uuid) to authenticated;
comment on function public.get_safety_report_target(text, uuid) is
  'Caller-authorized context for direct-message and anonymous course-review reports. Returns only target type, target id and a safe label.';

create or replace function safety_private.submit_report(
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
  v_message_id uuid;
  v_course_review_id uuid;
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
     or p_target_type is null or p_target_type not in ('student', 'request', 'message', 'course_review')
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
  -- source visibility plus previously established safety/contact relationships.
  -- Blocking must not prevent reporting a previously reachable student.
  if p_target_type = 'student' then
    select p.id, jsonb_build_object('display_name', p.display_name)
      into v_target_profile, v_evidence
      from public.profiles p
      where p.id = p_target_id and p.id <> v_actor
        and (p.is_discoverable = true or safety_private.prior_contact(v_actor,p.id)
          or exists(select 1 from safety_private.student_blocks b
            where b.blocker_id=v_actor and b.blocked_id=p.id))
        and p.onboarding_completed_at is not null
        and p.display_name is not null
      for share;
  elsif p_target_type = 'request' then
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
  else
    select target.reported_profile_id, target.evidence into v_target_profile, v_evidence
      from safety_private.content_report_target(p_target_type, p_target_id, v_actor) target;
    -- Assignments preserve FOUND from the source lookup above.
    v_message_id := case when p_target_type = 'message' then p_target_id end;
    v_course_review_id := case when p_target_type = 'course_review' then p_target_id end;
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
    reporter_id, operation_id, target_type, reported_profile_id, request_id, message_id, course_review_id,
    reason, details, payload_hash, evidence
  ) values (
    v_actor, p_operation_id, p_target_type, v_target_profile, v_request_id, v_message_id, v_course_review_id,
    p_reason, v_details, v_hash, v_evidence
  ) returning id, created_at into v_report_id, v_created_at;
  return jsonb_build_object('report_id', v_report_id, 'created_at', v_created_at);
end;
$$;
