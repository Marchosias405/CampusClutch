-- Hidden reviews can be revised or replaced without destroying moderation evidence.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
alter table course_reviews_private.reviews add column archived_at timestamptz
  check (archived_at is null or (isfinite(archived_at) and removed_at is not null));
alter table course_reviews_private.reviews drop constraint reviews_author_id_course_code_term_id_key;
create unique index reviews_current_author_course_term_idx
  on course_reviews_private.reviews(author_id,course_code,term_id) where archived_at is null;
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
    'my_reviews', coalesce((select jsonb_agg(to_jsonb(own_reviews) order by created_at desc, id desc) from own_reviews), '[]'::jsonb)
  ) into v_result from totals;
  return v_result;
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
  v_previous course_reviews_private.reviews;
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

  -- One current review slot per author/course/term, including when hidden.
  -- Lock the slot before looking up a row so concurrent first saves and
  -- replacements cannot both archive or publish a different current row.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text||':'||v_code||':'||p_term_id::text,1452));
  select * into v_previous from course_reviews_private.reviews r
  where r.author_id = v_user and r.course_code = v_code and r.term_id = p_term_id
    and r.archived_at is null for update;
  v_id:=v_previous.id;
  -- Existing authors retain the ability to revise after leaving a course.
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
    v_code, p_term_id, v_user, p_difficulty, p_workload, p_recommend, v_grade, v_comment, v_tips, v_instructor, v_tags,
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

create or replace function course_reviews_private.delete_review(p_review_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=course_reviews_private.require_actor(); previous course_reviews_private.reviews;
begin
  select * into previous from course_reviews_private.reviews where id=p_review_id and author_id=v_user;
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text||':'||previous.course_code||':'||previous.term_id::text,1452));
  select * into previous from course_reviews_private.reviews
    where id=p_review_id and author_id=v_user and archived_at is null for update;
  if not found then return false; end if;
  if previous.removed_at is not null then
    -- Remove from the author's editor, retaining hidden content and report links.
    update course_reviews_private.reviews set archived_at=clock_timestamp() where id=p_review_id;
  else
    delete from course_reviews_private.reviews where id=p_review_id;
  end if;
  return true;
end;
$$;
-- Replaced functions keep their existing restricted privileges. No new API or grants.
notify pgrst, 'reload schema';
commit;
