begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- One review page per course code across terms and campuses. Author identities
-- are stored only in an unexposed schema; RPCs return anonymous projections.
create schema course_reviews_private;
revoke all on schema course_reviews_private from public, anon, authenticated, service_role;
grant usage on schema course_reviews_private to authenticated;

create table course_reviews_private.reviews (
  id uuid primary key default gen_random_uuid(),
  course_code text not null check (
    char_length(course_code) between 2 and 32
    and course_code = upper(btrim(course_code)) and course_code !~ '\s{2,}'
  ),
  term_id uuid not null references public.academic_terms(id) on delete restrict,
  author_id uuid not null references public.profiles(id) on delete cascade,
  difficulty integer not null check (difficulty between 1 and 5),
  workload integer not null check (workload between 1 and 5),
  recommend boolean not null,
  grade text check (grade in ('F','D','C-','C','C+','B-','B','B+','A-','A','A+')),
  comment text not null check (char_length(comment) between 10 and 2000 and comment = btrim(comment)),
  tips text not null default '' check (char_length(tips) <= 1000 and tips = btrim(tips)),
  instructor text not null default '' check (char_length(instructor) <= 120 and instructor = btrim(instructor)),
  tags text[] not null default '{}' check (
    cardinality(tags) <= 3 and coalesce(array_ndims(tags), 1) = 1
    and (cardinality(tags) = 0 or array_lower(tags, 1) = 1)
    and array_position(tags, null) is null
    and tags <@ array['Useful','Interesting','Practical skills','Lots of reading',
      'Group work','Exam heavy','Project based','Participation matters']::text[]
    and (cardinality(tags) < 2 or tags[1] <> tags[2])
    and (cardinality(tags) < 3 or (tags[1] <> tags[3] and tags[2] <> tags[3]))
  ),
  created_at timestamptz not null default clock_timestamp() check (isfinite(created_at)),
  updated_at timestamptz not null default clock_timestamp() check (isfinite(updated_at)),
  unique (author_id, course_code, term_id)
);
create index course_reviews_history_idx on course_reviews_private.reviews(course_code, created_at desc, id desc);
create index course_reviews_term_idx on course_reviews_private.reviews(term_id);
alter table course_reviews_private.reviews enable row level security;
revoke all on course_reviews_private.reviews from public, anon, authenticated, service_role;
comment on table course_reviews_private.reviews is
  'Anonymous-to-students course feedback. One author/course-code/term entry; grades are optional student reports, not official SFU results.';

create function course_reviews_private.require_actor() returns uuid
language plpgsql stable security invoker set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not exists (
    select 1 from public.profiles p join auth.users a on a.id = p.id
    where p.id = v_user and p.onboarding_completed_at is not null and p.display_name is not null
      and a.deleted_at is null and not coalesce(a.is_anonymous, false)
      and (a.banned_until is null or a.banned_until <= now())
  ) then
    raise exception 'An eligible signed-in profile is required.' using errcode = '42501';
  end if;
  return v_user;
end;
$$;

create function course_reviews_private.normalize_code(p_course_code text) returns text
language plpgsql immutable security invoker set search_path = '' as $$
declare v_code text := upper(btrim(regexp_replace(p_course_code, '\s+', ' ', 'g')));
begin
  if v_code is null or char_length(v_code) not between 2 and 32 then
    raise exception 'A valid course code is required.' using errcode = '22023';
  end if;
  return v_code;
end;
$$;
revoke all on function course_reviews_private.require_actor(), course_reviews_private.normalize_code(text)
  from public, anon, authenticated, service_role;

create function course_reviews_private.summary(p_course_code text) returns jsonb
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
    from course_reviews_private.reviews r where r.course_code = v_code
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
      r.created_at, r.updated_at, true as is_mine
    from course_reviews_private.reviews r join public.academic_terms t on t.id = r.term_id
    where r.author_id = v_user and r.course_code = v_code
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

create function course_reviews_private.list_reviews(
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
    where r.course_code = v_code
      and (p_before_created_at is null or (r.created_at, r.id) < (p_before_created_at, p_before_id))
    order by r.created_at desc, r.id desc limit p_limit;
end;
$$;

create function course_reviews_private.save_review(
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
  returning r.id into v_id;
  return v_id;
end;
$$;

create function course_reviews_private.delete_review(p_review_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := course_reviews_private.require_actor(); v_deleted uuid;
begin
  delete from course_reviews_private.reviews r where r.id = p_review_id and r.author_id = v_user
  returning r.id into v_deleted;
  return v_deleted is not null;
end;
$$;

revoke all on function course_reviews_private.summary(text),
  course_reviews_private.list_reviews(text, timestamptz, uuid, integer),
  course_reviews_private.save_review(text, uuid, integer, integer, boolean, text, text, text, text, text[]),
  course_reviews_private.delete_review(uuid) from public, anon, authenticated, service_role;
grant execute on function course_reviews_private.summary(text),
  course_reviews_private.list_reviews(text, timestamptz, uuid, integer),
  course_reviews_private.save_review(text, uuid, integer, integer, boolean, text, text, text, text, text[]),
  course_reviews_private.delete_review(uuid) to authenticated;

-- Invoker wrappers expose only the checked, anonymous projection API.
create function public.get_course_review_summary(p_course_code text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select course_reviews_private.summary(p_course_code);
$$;
create function public.list_course_reviews(
  p_course_code text, p_before_created_at timestamptz default null,
  p_before_id uuid default null, p_limit integer default 20
) returns table (
  id uuid, term_id uuid, term_name text, difficulty integer, workload integer,
  recommend boolean, grade text, comment text, tips text, instructor text, tags text[],
  created_at timestamptz, updated_at timestamptz, is_mine boolean
)
language sql stable security invoker set search_path = '' as $$
  select * from course_reviews_private.list_reviews(p_course_code, p_before_created_at, p_before_id, p_limit);
$$;
create function public.save_my_course_review(
  p_course_code text, p_term_id uuid, p_difficulty integer, p_workload integer,
  p_recommend boolean, p_grade text, p_comment text, p_tips text, p_instructor text, p_tags text[]
) returns uuid language sql security invoker set search_path = '' as $$
  select course_reviews_private.save_review(p_course_code, p_term_id, p_difficulty,
    p_workload, p_recommend, p_grade, p_comment, p_tips, p_instructor, p_tags);
$$;
create function public.delete_my_course_review(p_review_id uuid) returns boolean
language sql security invoker set search_path = '' as $$
  select course_reviews_private.delete_review(p_review_id);
$$;
revoke all on function public.get_course_review_summary(text),
  public.list_course_reviews(text, timestamptz, uuid, integer),
  public.save_my_course_review(text, uuid, integer, integer, boolean, text, text, text, text, text[]),
  public.delete_my_course_review(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_course_review_summary(text),
  public.list_course_reviews(text, timestamptz, uuid, integer),
  public.save_my_course_review(text, uuid, integer, integer, boolean, text, text, text, text, text[]),
  public.delete_my_course_review(uuid) to authenticated;

commit;
