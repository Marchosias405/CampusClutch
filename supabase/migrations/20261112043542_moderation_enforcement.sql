-- Task 14: audited admin enforcement and complete review-report snapshots.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
alter table course_reviews_private.reviews add column removed_at timestamptz;
create table safety_private.account_standing (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  warning_count integer not null default 0 check(warning_count>=0),
  suspended_until timestamptz,
  acknowledged_at timestamptz not null default '-infinity'
);
create table safety_private.enforcement_actions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references safety_private.reports(id),
  actor_id uuid references public.profiles(id) on delete set null,
  subject_id uuid references public.profiles(id) on delete set null,
  operation_id uuid not null,
  payload_hash bytea not null check(octet_length(payload_hash)=32),
  kind text not null check(kind in ('warn','suspend_7_days','remove_review')),
  incident_key text not null,
  reason text not null check(char_length(reason) between 10 and 2000 and reason=btrim(reason)),
  warning_count integer not null,
  suspended_until timestamptz,
  automatic_suspension boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  unique(actor_id,operation_id), unique(report_id,kind), unique(subject_id,kind,incident_key)
);
create index enforcement_actions_subject_idx on safety_private.enforcement_actions(subject_id,created_at desc);
create index enforcement_actions_report_idx on safety_private.enforcement_actions(report_id,created_at desc);
alter table safety_private.account_standing enable row level security;
alter table safety_private.enforcement_actions enable row level security;
revoke all on safety_private.account_standing,safety_private.enforcement_actions from public,anon,authenticated,service_role;

-- Authentication remains available so a suspended student can read the reason
-- and expiry. Access to app data and actions is denied against live DB state,
-- including previously issued JWTs. No points or accepted jobs are changed.
create function safety_private.account_allowed() returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(select 1 from safety_private.account_standing
    where profile_id=auth.uid() and suspended_until>now());
$$;
create function safety_private.check_account_access() returns void
language plpgsql stable security invoker set search_path='' as $$
begin
  if not safety_private.account_allowed() then
    raise exception using errcode='PT403',message='Your CampusClutch account is temporarily suspended.';
  end if;
end;
$$;
revoke all on function safety_private.account_allowed(),safety_private.check_account_access() from public,anon,authenticated,service_role;
grant execute on function safety_private.account_allowed(),safety_private.check_account_access() to anon,authenticated,service_role;

create function safety_private.enforcement_context(p_report_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=safety_private.require_staff(); report safety_private.reports; standing safety_private.account_standing;
  review course_reviews_private.reviews; actions jsonb; admin boolean;
begin
  select * into report from safety_private.reports where id=p_report_id
    and reporter_id is distinct from actor and reported_profile_id is distinct from actor;
  if not found then raise exception using errcode='42501',message='Report unavailable.'; end if;
  insert into safety_private.report_views(report_id,moderator_id) values(p_report_id,actor);
  select role='admin' into admin from safety_private.staff_roles where profile_id=actor and enabled;
  select * into standing from safety_private.account_standing where profile_id=report.reported_profile_id;
  select * into review from course_reviews_private.reviews where id=report.course_review_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'reason',reason,'created_at',created_at,
    'automatic_suspension',automatic_suspension,'suspended_until',suspended_until) order by created_at),'[]'::jsonb)
    into actions from safety_private.enforcement_actions where report_id=p_report_id;
  return jsonb_build_object('version',report.triage_version,'is_admin',admin,
    'can_act',admin and report.triage_status='escalated' and report.reported_profile_id is not null
      and not exists(select 1 from safety_private.staff_roles where profile_id=report.reported_profile_id and enabled),
    'warning_count',coalesce(standing.warning_count,0),'suspended_until',standing.suspended_until,
    'review_removed',review.removed_at is not null,'review_updated_at',review.updated_at,
    'current_review',case when review.id is not null then jsonb_build_object('comment',review.comment,
      'difficulty',review.difficulty,'workload',review.workload,'grade',review.grade,'tips',review.tips,'instructor',review.instructor) end,
    'actions',actions);
end;
$$;

create function safety_private.enforce_report(p_report_id uuid,p_operation_id uuid,p_expected_version integer,
  p_kind text,p_reason text,p_review_updated_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=safety_private.require_staff(); report safety_private.reports; standing safety_private.account_standing;
  prior safety_private.enforcement_actions; review course_reviews_private.reviews; fingerprint bytea; incident text;
  automatic boolean:=false; written timestamptz; result jsonb;
begin
  if not exists(select 1 from safety_private.staff_roles where profile_id=actor and enabled and role='admin') then
    raise exception using errcode='42501',message='An admin account is required for enforcement.';
  end if;
  if p_operation_id is null or p_report_id is null or p_expected_version is null or p_expected_version<0
    or p_kind is null or p_kind not in ('warn','suspend_7_days','remove_review')
    or p_reason is null or char_length(btrim(p_reason)) not between 10 and 2000
    or (p_review_updated_at is not null and not isfinite(p_review_updated_at)) then
    raise exception using errcode='22023',message='Invalid moderation action.';
  end if;
  fingerprint:=extensions.digest(convert_to(jsonb_build_array(p_report_id,p_expected_version,p_kind,btrim(p_reason),p_review_updated_at)::text,'UTF8'),'sha256');
  -- Serialize operation IDs even when a caller reuses one for another report.
  perform pg_advisory_xact_lock(hashtextextended(actor::text||p_operation_id::text,1451));
  select * into prior from safety_private.enforcement_actions where actor_id=actor and operation_id=p_operation_id;
  if found then
    if prior.payload_hash<>fingerprint then raise exception using errcode='22023',message='Action retry does not match.'; end if;
    return jsonb_build_object('action_id',prior.id,'kind',prior.kind,'automatic_suspension',prior.automatic_suspension,
      'suspended_until',prior.suspended_until,'warning_count',prior.warning_count);
  end if;
  select * into report from safety_private.reports where id=p_report_id
    and reporter_id is distinct from actor and reported_profile_id is distinct from actor for update;
  if not found then raise exception using errcode='42501',message='Report unavailable.'; end if;
  if report.triage_version<>p_expected_version or report.triage_status<>'escalated' then
    raise exception using errcode='PT409',message='Reload the escalated report before acting.';
  end if;
  if report.reported_profile_id is null then raise exception using errcode='PT409',message='Account no longer available.'; end if;
  -- Role assignment and enforcement serialize on the profile; do not allow
  -- one staff account to sanction another through this student-report flow.
  perform 1 from public.profiles where id=report.reported_profile_id for update;
  if exists(select 1 from safety_private.staff_roles where profile_id=report.reported_profile_id and enabled) then
    raise exception using errcode='42501',message='Staff accounts require owner review.';
  end if;
  incident:=report.target_type||':'||coalesce(report.message_id,report.course_review_id,report.request_id,report.id)::text;
  if exists(select 1 from safety_private.enforcement_actions where kind=p_kind and
    (report_id=p_report_id or (subject_id=report.reported_profile_id and incident_key=incident))) then
    raise exception using errcode='PT409',message='This action was already recorded for this incident.';
  end if;
  insert into safety_private.account_standing(profile_id) values(report.reported_profile_id) on conflict do nothing;
  select * into standing from safety_private.account_standing where profile_id=report.reported_profile_id for update;
  written:=clock_timestamp();
  if p_kind='warn' then
    standing.warning_count:=standing.warning_count+1;
    automatic:=standing.warning_count%3=0;
  elsif p_kind='remove_review' then
    select * into review from course_reviews_private.reviews where id=report.course_review_id for update;
    if not found or review.removed_at is not null or p_review_updated_at is null or review.updated_at<>p_review_updated_at then
      raise exception using errcode='PT409',message='The review changed or was removed. Reload before acting.';
    end if;
    update course_reviews_private.reviews set removed_at=written where id=review.id;
  end if;
  if p_kind='suspend_7_days' or automatic then
    standing.suspended_until:=greatest(coalesce(standing.suspended_until,written),written+interval '7 days');
  end if;
  update safety_private.account_standing set warning_count=standing.warning_count,suspended_until=standing.suspended_until
    where profile_id=standing.profile_id;
  insert into safety_private.enforcement_actions(report_id,actor_id,subject_id,operation_id,payload_hash,kind,incident_key,
    reason,warning_count,suspended_until,automatic_suspension,created_at)
    values(report.id,actor,standing.profile_id,p_operation_id,fingerprint,p_kind,incident,btrim(p_reason),standing.warning_count,
      standing.suspended_until,automatic,written) returning * into prior;
  update safety_private.reports set triage_version=triage_version+1 where id=report.id;
  return jsonb_build_object('action_id',prior.id,'kind',prior.kind,'automatic_suspension',prior.automatic_suspension,
    'suspended_until',prior.suspended_until,'warning_count',prior.warning_count);
end;
$$;

create function safety_private.my_account_standing() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); standing safety_private.account_standing; notices jsonb;
begin
  if actor is null or not exists(select 1 from auth.users where id=actor and deleted_at is null) then
    raise exception using errcode='42501',message='Sign in to view your account status.';
  end if;
  select * into standing from safety_private.account_standing where profile_id=actor;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'reason',reason,'created_at',created_at,
    'automatic_suspension',automatic_suspension) order by created_at desc),'[]'::jsonb) into notices
    from (select * from safety_private.enforcement_actions where subject_id=actor
      and created_at>coalesce(standing.acknowledged_at,'-infinity') order by created_at desc limit 20) n;
  return jsonb_build_object('warning_count',coalesce(standing.warning_count,0),
    'suspended_until',standing.suspended_until,'suspended',coalesce(standing.suspended_until>now(),false),
    'notices',notices);
end;
$$;
create function safety_private.acknowledge_account_notice(p_through timestamptz) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or p_through is null or not isfinite(p_through) or p_through>clock_timestamp() then
    raise exception using errcode='22023',message='Invalid acknowledgement.'; end if;
  update safety_private.account_standing set acknowledged_at=greatest(acknowledged_at,p_through) where profile_id=auth.uid();
end;
$$;

create function public.get_moderation_enforcement(p_report_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select safety_private.enforcement_context(p_report_id); $$;
create function public.enforce_moderation_report(p_report_id uuid,p_operation_id uuid,p_expected_version integer,
  p_kind text,p_reason text,p_review_updated_at timestamptz default null) returns jsonb
language sql security invoker set search_path='' as $$
  select safety_private.enforce_report(p_report_id,p_operation_id,p_expected_version,p_kind,p_reason,p_review_updated_at);
$$;
create function public.get_my_account_standing() returns jsonb
language sql stable security invoker set search_path='' as $$ select safety_private.my_account_standing(); $$;
create function public.acknowledge_account_notice(p_through timestamptz) returns void
language sql security invoker set search_path='' as $$ select safety_private.acknowledge_account_notice(p_through); $$;

revoke all on function safety_private.enforcement_context(uuid),safety_private.enforce_report(uuid,uuid,integer,text,text,timestamptz),
  safety_private.my_account_standing(),safety_private.acknowledge_account_notice(timestamptz),
  public.get_moderation_enforcement(uuid),public.enforce_moderation_report(uuid,uuid,integer,text,text,timestamptz),
  public.get_my_account_standing(),public.acknowledge_account_notice(timestamptz) from public,anon,authenticated,service_role;
grant execute on function safety_private.enforcement_context(uuid),safety_private.enforce_report(uuid,uuid,integer,text,text,timestamptz),
  safety_private.my_account_standing(),safety_private.acknowledge_account_notice(timestamptz),
  public.get_moderation_enforcement(uuid),public.enforce_moderation_report(uuid,uuid,integer,text,text,timestamptz),
  public.get_my_account_standing(),public.acknowledge_account_notice(timestamptz) to authenticated;

create or replace function safety_private.assign_staff_role(p_profile_id uuid, p_role text, p_enabled boolean, p_reason text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_profile_id is null or p_role is null or p_role not in ('admin','moderator') or p_enabled is null
    or p_reason is null or char_length(btrim(p_reason)) not between 10 and 2000 then
    raise exception using errcode='22023', message='Invalid staff role assignment.';
  end if;
  perform 1 from public.profiles where id=p_profile_id for update;
  insert into safety_private.staff_roles(profile_id, role, enabled)
    values(p_profile_id,p_role,p_enabled)
    on conflict(profile_id) do update set role=excluded.role, enabled=excluded.enabled, updated_at=clock_timestamp();
  insert into safety_private.staff_role_events(profile_id,role,enabled,reason,database_actor)
    values(p_profile_id,p_role,p_enabled,btrim(p_reason),current_user);
end;
$$;

create or replace view notifications_private.push_targets with (security_invoker=true) as
select n.id as notification_id,d.session_id,d.expo_token,notifications_private.push_category(n.event_type) as category
from public.notifications n
join notifications_private.push_preferences p on p.profile_id=n.recipient_id and p.push_enabled
join notifications_private.android_push_devices d on d.profile_id=n.recipient_id
join auth.sessions s on s.id=d.session_id and s.user_id=d.profile_id
join auth.users u on u.id=d.profile_id
where not exists(select 1 from safety_private.account_standing a where a.profile_id=n.recipient_id and a.suspended_until>now())
  and n.read_at is null and (s.not_after is null or s.not_after>now())
  and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
  and safety_private.notice_allowed(n.recipient_id,n.actor_id,n.event_type,n.request_id)
  and case notifications_private.push_category(n.event_type) when 'messages' then p.messages
    when 'offers' then p.offers when 'request_updates' then p.request_updates else false end;
create or replace function safety_private.content_report_target(p_target_type text, p_target_id uuid, p_actor uuid)
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
        'difficulty', r.difficulty, 'workload', r.workload, 'grade', r.grade,
        'comment', r.comment, 'tips', r.tips, 'instructor', r.instructor,
        'created_at', r.created_at
      ), r.course_code || ' course review'
      from course_reviews_private.reviews r
      join public.academic_terms t on t.id = r.term_id
      where r.id = p_target_id and r.author_id <> p_actor and r.removed_at is null
        -- list_course_reviews is available to eligible students for every
        -- catalogued course code; enrollment is only needed to write a review.
        and exists (select 1 from public.courses c where c.code = r.course_code)
      for share of r;
  end if;
end;
$$;

create or replace function course_reviews_private.summary(p_course_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := course_reviews_private.require_actor();
  v_code text := course_reviews_private.normalize_code(p_course_code);
  v_title text;
  v_result jsonb;
begin
  -- Latest catalog title is presentation only; the stable code groups all terms.
  select c.title into v_title from public.courses c
  join public.academic_terms t on t.id = c.term_id
  where c.code = v_code order by t.starts_on desc, c.id limit 1;
  if not found then raise exception 'Course not found.' using errcode = '22023'; end if;

  with course_reviews as materialized (
    -- Aggregate only the compact scoring fields, not every review's free text.
    select r.id, r.grade, r.difficulty, r.workload, r.recommend, r.tags
    from course_reviews_private.reviews r where r.course_code = v_code and r.removed_at is null
  ), totals as (
    select count(*) as review_count, round(avg(difficulty), 1) as average_difficulty,
      round(avg(workload), 1) as average_workload,
      round(100.0 * count(*) filter (where recommend) / nullif(count(*), 0), 0) as recommend_percent
    from course_reviews
  ), grade_bins as (
    select g.grade, g.ordinality, count(r.id) as count
    from unnest(array['F','D','C-','C','C+','B-','B','B+','A-','A','A+']::text[])
      with ordinality as g(grade, ordinality)
    left join course_reviews r on r.grade = g.grade
    group by g.grade, g.ordinality
  ), tag_counts as (
    select tag, count(*) as count from course_reviews r
    cross join lateral unnest(r.tags) as tags(tag) group by tag
  ), eligible as (
    select distinct t.id, t.display_name, t.starts_on from public.course_memberships m
    join public.courses c on c.id = m.course_id
    join public.academic_terms t on t.id = c.term_id
    where m.profile_id = v_user and m.status in ('enrolled','completed')
      and c.code = v_code and t.status in ('current','past')
      and not exists(select 1 from course_reviews_private.reviews hidden where hidden.author_id=v_user
        and hidden.course_code=v_code and hidden.term_id=t.id and hidden.removed_at is not null)
  ), own_reviews as (
    select r.id, r.term_id, t.display_name as term_name, r.difficulty, r.workload,
      r.recommend, r.grade, r.comment, r.tips, r.instructor, r.tags,
      r.created_at, r.updated_at, true as is_mine
    from course_reviews_private.reviews r join public.academic_terms t on t.id = r.term_id
    where r.author_id = v_user and r.course_code = v_code and r.removed_at is null
  )
  select jsonb_build_object(
    'course_code', v_code, 'title', v_title, 'review_count', totals.review_count,
    'average_difficulty', totals.average_difficulty, 'average_workload', totals.average_workload,
    'recommend_percent', totals.recommend_percent,
    'grade_counts', (select jsonb_agg(jsonb_build_object('grade', grade, 'count', count) order by ordinality) from grade_bins),
    'top_tags', coalesce((select jsonb_agg(jsonb_build_object('tag', tag, 'count', count) order by count desc, tag) from tag_counts), '[]'::jsonb),
    'eligible_terms', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'display_name', display_name) order by starts_on desc, id) from eligible), '[]'::jsonb),
    'my_reviews', coalesce((select jsonb_agg(to_jsonb(own_reviews) order by created_at desc, id desc) from own_reviews), '[]'::jsonb)
  ) into v_result from totals;
  return v_result;
end;
$$;

create or replace function course_reviews_private.list_reviews(
  p_course_code text, p_before_created_at timestamptz default null,
  p_before_id uuid default null, p_limit integer default 20
) returns table (
  id uuid, term_id uuid, term_name text, difficulty integer, workload integer,
  recommend boolean, grade text, comment text, tips text, instructor text, tags text[],
  created_at timestamptz, updated_at timestamptz, is_mine boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := course_reviews_private.require_actor();
  v_code text := course_reviews_private.normalize_code(p_course_code);
begin
  if not exists (select 1 from public.courses c where c.code = v_code) then
    raise exception 'Course not found.' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'Page size must be between 1 and 50.' using errcode = '22023';
  end if;
  if (p_before_created_at is null) <> (p_before_id is null)
    or (p_before_created_at is not null and not isfinite(p_before_created_at)) then
    raise exception 'A complete, valid review cursor is required.' using errcode = '22023';
  end if;
  return query
    select r.id, r.term_id, t.display_name, r.difficulty, r.workload, r.recommend,
      r.grade, r.comment, r.tips, r.instructor, r.tags, r.created_at, r.updated_at, r.author_id = v_user
    from course_reviews_private.reviews r
    join public.academic_terms t on t.id = r.term_id
    where r.course_code = v_code and r.removed_at is null
      and (p_before_created_at is null or (r.created_at, r.id) < (p_before_created_at, p_before_id))
    order by r.created_at desc, r.id desc limit p_limit;
end;
$$;

create or replace function course_reviews_private.save_review(
  p_course_code text, p_term_id uuid, p_difficulty integer, p_workload integer,
  p_recommend boolean, p_grade text, p_comment text, p_tips text,
  p_instructor text, p_tags text[]
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := course_reviews_private.require_actor();
  v_code text := course_reviews_private.normalize_code(p_course_code);
  v_grade text := nullif(upper(btrim(p_grade)), '');
  v_comment text := btrim(p_comment);
  v_tips text := btrim(coalesce(p_tips, ''));
  v_instructor text := btrim(coalesce(p_instructor, ''));
  v_tags text[] := coalesce(p_tags, '{}'::text[]);
  v_id uuid;
  v_membership uuid;
  v_write_time timestamptz;
begin
  if p_term_id is null or not exists (
    select 1 from public.courses c where c.code = v_code and c.term_id = p_term_id
  ) then raise exception 'Course and academic term were not found.' using errcode = '22023'; end if;
  if p_difficulty is null or p_difficulty not between 1 and 5
    or p_workload is null or p_workload not between 1 and 5 or p_recommend is null then
    raise exception 'Choose difficulty, workload and whether you recommend the course.' using errcode = '22023';
  end if;
  if v_grade is not null and v_grade not in ('F','D','C-','C','C+','B-','B','B+','A-','A','A+') then
    raise exception 'Choose a valid letter grade or leave it blank.' using errcode = '22023';
  end if;
  if v_comment is null or char_length(v_comment) not between 10 and 2000 then
    raise exception 'Your review must contain between 10 and 2000 characters.' using errcode = '22023';
  end if;
  if char_length(v_tips) > 1000 or char_length(v_instructor) > 120 then
    raise exception 'Study tips must be at most 1000 characters and instructor at most 120.' using errcode = '22023';
  end if;
  if coalesce(array_ndims(v_tags), 1) <> 1 then
    raise exception 'Choose up to three different course tags.' using errcode = '22023';
  end if;
  if cardinality(v_tags) > 3
    or array_position(v_tags, null) is not null
    or not (v_tags <@ array['Useful','Interesting','Practical skills','Lots of reading',
      'Group work','Exam heavy','Project based','Participation matters']::text[])
    or cardinality(v_tags) <> (select count(distinct tag) from unnest(v_tags) as tags(tag)) then
    raise exception 'Choose up to three different course tags.' using errcode = '22023';
  end if;
  -- Normalize unusual SQL array lower bounds as well as ordinary REST arrays.
  select coalesce(array_agg(tag), '{}'::text[]) into v_tags from unnest(v_tags) as tags(tag);

  -- An existing author retains control of their feedback after leaving a course.
  select r.id into v_id from course_reviews_private.reviews r
  where r.author_id = v_user and r.course_code = v_code and r.term_id = p_term_id for update;
  if v_id is null then
    -- Hold the qualifying membership against a concurrent leave until commit.
    select m.course_id into v_membership from public.course_memberships m
    join public.courses c on c.id = m.course_id
    join public.academic_terms t on t.id = c.term_id
    where m.profile_id = v_user and m.status in ('enrolled','completed')
      and c.code = v_code and c.term_id = p_term_id and t.status in ('current','past')
    order by m.course_id limit 1 for share of m, t;
    if v_membership is null then
      raise exception 'Add this course for a current or past term before reviewing it.' using errcode = '42501';
    end if;
  end if;

  -- The unique key also makes retrying an uncertain save safe: one review, one
  -- histogram contribution, even when two devices submit simultaneously.
  if exists(select 1 from course_reviews_private.reviews r where r.author_id=v_user and r.course_code=v_code
    and r.term_id=p_term_id and r.removed_at is not null) then
    raise exception using errcode='PT403',message='This review was removed by moderation and cannot be reposted.';
  end if;
  v_write_time := clock_timestamp();
  insert into course_reviews_private.reviews as r (
    course_code, term_id, author_id, difficulty, workload, recommend, grade, comment, tips, instructor, tags,
    created_at, updated_at
  ) values (
    v_code, p_term_id, v_user, p_difficulty, p_workload, p_recommend, v_grade, v_comment, v_tips, v_instructor, v_tags,
    v_write_time, v_write_time
  ) on conflict (author_id, course_code, term_id) do update set
    difficulty = excluded.difficulty, workload = excluded.workload, recommend = excluded.recommend,
    grade = excluded.grade, comment = excluded.comment, tips = excluded.tips,
    instructor = excluded.instructor, tags = excluded.tags, updated_at = clock_timestamp()
  where r.removed_at is null
  returning r.id into v_id;
  if v_id is null then raise exception using errcode='PT403',message='This review was removed by moderation.'; end if;
  return v_id;
end;
$$;

create or replace function course_reviews_private.delete_review(p_review_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := course_reviews_private.require_actor(); v_deleted uuid;
begin
  delete from course_reviews_private.reviews r where r.id = p_review_id and r.author_id = v_user and r.removed_at is null
  returning r.id into v_deleted;
  return v_deleted is not null;
end;
$$;


-- Deny direct table access, including Realtime and Storage, using live state.
do $policies$ declare t record; begin
  for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and c.relrowsecurity and (n.nspname='public' or (n.nspname='storage' and c.relname='objects'))
  loop
    execute format('create policy moderation_account_access on %I.%I as restrictive for all to authenticated using ((select safety_private.account_allowed())) with check ((select safety_private.account_allowed()))',t.nspname,t.relname);
  end loop;
end $policies$;

-- Guard every existing application RPC, including security definers that bypass
-- RLS. Preserve its signature, grants, search_path and security mode. Extensions
-- and trigger functions are excluded. New RPCs must include this guard too.
-- Wrapping the whole PL/pgSQL block checks BEFORE declaration initializers.
do $guards$ declare f record; body text; definition text; begin
  for f in select p.*,l.lanname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    join pg_language l on l.oid=p.prolang
    where n.nspname='public' and p.prokind='f' and p.prorettype<>'trigger'::regtype
      and has_function_privilege('authenticated',p.oid,'execute') and l.lanname in ('sql','plpgsql')
      and p.proname not in ('get_my_account_standing','acknowledge_account_notice')
      and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
  loop
    body:=case when f.lanname='sql' then 'select safety_private.check_account_access(); '||f.prosrc
      else 'begin perform safety_private.check_account_access(); '||rtrim(f.prosrc,E' \n\r\t;')||E';\n end;' end;
    definition:=pg_get_functiondef(f.oid);
    definition:=replace(definition, '$function$'||f.prosrc||'$function$', '$function$'||body||'$function$');
    if definition=pg_get_functiondef(f.oid) then raise exception 'Unable to guard RPC %',f.proname; end if;
    execute definition;
    if f.provolatile='i' then execute format('alter function %s stable',f.oid::regprocedure); end if;
  end loop;
end $guards$;
commit;
