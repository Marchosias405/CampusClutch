begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- First submissions can contend on either the generated semester ID or the code.
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
      on conflict do nothing;
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

commit;
