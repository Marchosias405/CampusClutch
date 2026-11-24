begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- A review of an unimported semester needs a stable reference for grades,
-- reporting and appeals. It supplies a year and season, never official dates.
alter table public.academic_terms
  add column review_only boolean not null default false,
  alter column starts_on drop not null,
  alter column ends_on drop not null,
  drop constraint academic_terms_year_check,
  add constraint academic_terms_year_check check (
    year between 2000 and 2200 or (review_only and year between 1965 and 1999)
  ),
  add constraint academic_terms_review_only_check check (
    (review_only and status = 'past' and starts_on is null and ends_on is null
      and (year > 1965 or season = 'fall'))
    or (not review_only and starts_on is not null and ends_on is not null)
  );

-- Preserve the term filters in both old and new mobile clients. An official
-- import upserting this same semester supplies the real dates and reuses its ID.
alter policy "Authenticated users can read academic terms" on public.academic_terms
  using (not review_only);
create function course_reviews_private.promote_catalog_term() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.review_only := false;
  return new;
end;
$$;
revoke all on function course_reviews_private.promote_catalog_term()
  from public, anon, authenticated, service_role;
create trigger promote_review_only_term before update of starts_on, ends_on on public.academic_terms
for each row when (old.review_only and new.starts_on is not null and new.ends_on is not null)
execute function course_reviews_private.promote_catalog_term();

create or replace function course_reviews_private.normalize_code(p_course_code text) returns text
language plpgsql immutable security invoker set search_path = '' as $$
declare v_code text := upper(btrim(regexp_replace(p_course_code, '\s+', ' ', 'g')));
begin
  if v_code is null or char_length(v_code) not between 2 and 32 then
    raise exception 'A valid course code is required.' using errcode = '22023';
  end if;
  return regexp_replace(v_code collate "C", '^([A-Z]{2,5})([0-9]{3}[A-Z]?)$', '\1 \2');
end;
$$;

create function course_reviews_private.review_title(p_code text) returns text
language plpgsql stable security invoker set search_path = '' as $$
declare v_title text;
begin
  select c.title into v_title from public.courses c
  join public.academic_terms t on t.id = c.term_id
  where c.code = p_code order by t.starts_on desc nulls last, c.id limit 1;
  if v_title is null then
    select h.title into v_title from course_reviews_private.catalog_history h
      where h.course_code = p_code;
  end if;
  if v_title is null and p_code collate "C" ~ '^[A-Z]{2,5} [0-9]{3}[A-Z]?$' then
    v_title := p_code;
  end if;
  return v_title;
end;
$$;

-- The four-month boundary only determines which unlisted semesters may be
-- self-reported. Where actual catalog dates exist, respect the recorded status
-- and end date. The generated UUID also resolves a form opened before an import.
create function course_reviews_private.past_terms()
returns table (id uuid, generated_id uuid, catalog_id uuid, code text, display_name text,
               year integer, season text, semester_start date)
language sql stable security invoker set search_path = '' as $$
  with today as (
    select (statement_timestamp() at time zone 'America/Vancouver')::date as day
  ), periods as (
    select y as yr, s.name, make_date(y, s.month, 1) as starts,
           y::text || '-' || s.name as code, today.day
    from today, generate_series(1965, least(2200, extract(year from today.day)::integer)) y
    cross join (values ('spring',1), ('summer',5), ('fall',9)) s(name,month)
    where y > 1965 or s.name = 'fall'
  ), terms as (
    select p.*, md5('campusclutch:review-term:' || p.code)::uuid as generated_id,
           t.id as catalog_id, t.display_name as catalog_name
    from periods p left join public.academic_terms t on t.code = p.code
    where case when t.id is null or t.review_only then
        (p.starts + interval '4 months')::date <= p.day
      else t.status = 'past' and t.ends_on < p.day and p.starts <= p.day end
  )
  select coalesce(t.catalog_id, t.generated_id), t.generated_id, t.catalog_id, t.code,
         coalesce(t.catalog_name, initcap(t.name) || ' ' || t.yr::text), t.yr, t.name, t.starts
  from terms t;
$$;
revoke all on function course_reviews_private.review_title(text), course_reviews_private.past_terms()
  from public, anon, authenticated, service_role;

create or replace function course_reviews_private.summary(p_course_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := course_reviews_private.require_actor();
  v_code text := course_reviews_private.normalize_code(p_course_code);
  v_title text;
  v_result jsonb;
begin
  v_title := course_reviews_private.review_title(v_code);
  if v_title is null then raise exception 'Course not found.' using errcode = '22023'; end if;

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
  ), own_reviews as (
    select r.id, r.term_id, t.display_name as term_name, r.difficulty, r.workload,
      r.recommend, r.grade, r.comment, r.tips, r.instructor, r.tags,
      r.created_at, r.updated_at, true as is_mine, r.removed_at is not null as is_hidden
    from course_reviews_private.reviews r join public.academic_terms t on t.id = r.term_id
    where r.author_id = v_user and r.course_code = v_code and r.archived_at is null
  )
  select jsonb_build_object(
    'course_code', v_code, 'title', v_title, 'review_count', totals.review_count,
    'average_difficulty', totals.average_difficulty, 'average_workload', totals.average_workload,
    'recommend_percent', totals.recommend_percent,
    'grade_counts', (select jsonb_agg(jsonb_build_object('grade', grade, 'count', count) order by ordinality) from grade_bins),
    'top_tags', coalesce((select jsonb_agg(jsonb_build_object('tag', tag, 'count', count) order by count desc, tag) from tag_counts), '[]'::jsonb),
    'eligible_terms', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'display_name', display_name) order by starts_on desc, id) from eligible), '[]'::jsonb),
    'past_terms', (select jsonb_agg(jsonb_build_object('id', h.id, 'display_name', h.display_name,
      'year', h.year, 'season', h.season) order by h.semester_start desc)
      from course_reviews_private.past_terms() h),
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
  if course_reviews_private.review_title(v_code) is null then
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
  v_past record;
  v_term uuid := p_term_id;
  v_can_self_report boolean;
  v_today date := (statement_timestamp() at time zone 'America/Vancouver')::date;
  v_write_time timestamptz;
  v_previous course_reviews_private.reviews;
begin
  if course_reviews_private.review_title(v_code) is null then
    raise exception 'Course not found.' using errcode = '22023';
  end if;
  if v_term is null then raise exception 'Choose the term you took this course.' using errcode = '22023'; end if;
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

  select * into v_past from course_reviews_private.past_terms() h
    where h.id = v_term or h.generated_id = v_term;
  v_can_self_report := found;
  if v_can_self_report then
    if v_past.catalog_id is null then
      insert into public.academic_terms(id, code, display_name, year, season, status, review_only)
      values (v_past.generated_id, v_past.code, v_past.display_name, v_past.year, v_past.season, 'past', true)
      on conflict (code) do nothing;
    end if;
    -- An import may have created this semester since the user opened the form.
    -- Serialize with it and recheck eligibility before using its canonical ID.
    select t.id into v_term from public.academic_terms t
    where t.code = v_past.code and t.status = 'past'
      and (t.review_only or t.ends_on < v_today) for share;
    if not found then
      raise exception 'This term changed. Reopen the review and choose the term again.' using errcode = '22023';
    end if;
  end if;

  -- One current review slot per author/course/term, including when hidden.
  -- Lock the slot before looking up a row so concurrent first saves and
  -- replacements cannot both archive or publish a different current row.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text||':'||v_code||':'||v_term::text,1452));
  select * into v_previous from course_reviews_private.reviews r
  where r.author_id = v_user and r.course_code = v_code and r.term_id = v_term
    and r.archived_at is null for update;
  v_id:=v_previous.id;
  -- Existing authors retain the ability to revise after leaving a course.
  if v_id is null and not v_can_self_report then
    if not exists (select 1 from public.courses c where c.code = v_code and c.term_id = v_term) then
      raise exception 'Course and academic term were not found.' using errcode = '22023';
    end if;
    -- Hold the qualifying membership against a concurrent leave until commit.
    select m.course_id into v_membership from public.course_memberships m
    join public.courses c on c.id = m.course_id
    join public.academic_terms t on t.id = c.term_id
    where m.profile_id = v_user and m.status in ('enrolled','completed')
      and c.code = v_code and c.term_id = v_term and t.status in ('current','past')
    order by m.course_id limit 1 for share of m, t;
    if v_membership is null then
      raise exception 'Add this course for a current or past term before reviewing it.' using errcode = '42501';
    end if;
  end if;

  -- A hidden version remains immutable for moderation. Publishing changes
  -- creates a new review ID, hence a separately reportable incident. A stale
  -- retry of the exact hidden payload must not undo an admin's hide action.
  if v_previous.id is not null and v_previous.removed_at is not null then
    if row(v_previous.difficulty,v_previous.workload,v_previous.recommend,v_previous.grade,
      v_previous.comment,v_previous.tips,v_previous.instructor,v_previous.tags)
      is not distinct from row(p_difficulty,p_workload,p_recommend,v_grade,v_comment,v_tips,v_instructor,v_tags) then
      raise exception using errcode='22023',message='Update your hidden review before publishing it again.';
    end if;
    update course_reviews_private.reviews set archived_at=clock_timestamp() where id=v_previous.id;
  end if;
  v_write_time := clock_timestamp();
  insert into course_reviews_private.reviews as r (
    course_code, term_id, author_id, difficulty, workload, recommend, grade, comment, tips, instructor, tags,
    created_at, updated_at
  ) values (
    v_code, v_term, v_user, p_difficulty, p_workload, p_recommend, v_grade, v_comment, v_tips, v_instructor, v_tags,
    v_write_time, v_write_time
  ) on conflict (author_id, course_code, term_id) where archived_at is null do update set
    difficulty = excluded.difficulty, workload = excluded.workload, recommend = excluded.recommend,
    grade = excluded.grade, comment = excluded.comment, tips = excluded.tips,
    instructor = excluded.instructor, tags = excluded.tags, updated_at = clock_timestamp()
  where r.removed_at is null
  returning r.id into v_id;
  if v_id is null then raise exception using errcode='PT403',message='This review was removed by moderation.'; end if;
  return v_id;
end;
$$;

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
        and r.archived_at is null
        and course_reviews_private.review_title(r.course_code) is not null
      for share of r;
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
