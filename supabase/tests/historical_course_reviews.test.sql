begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();

create function pg_temp.uid(n integer) returns uuid language sql immutable as $$
  select ('ca1e0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.login(n integer) returns text language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.uid(n)::text, true);
$$;
create function pg_temp.save(code text, semester uuid, grade text default 'B',
  feedback text default 'Useful labs and clear feedback.') returns uuid language sql as $$
  select public.save_my_course_review(code, semester, 3, 4, true, grade, feedback, '', '', array['Useful']);
$$;
create temp table chosen (name text primary key, id uuid not null);
grant select, insert on chosen to authenticated;
create function pg_temp.item(key text) returns uuid language sql as $$
  select id from chosen where name = key;
$$;
insert into auth.users(id, email, email_confirmed_at)
select pg_temp.uid(i), 'historic-review-' || i || '@sfu.ca', now() from generate_series(1, 3) i;
update public.profiles set display_name='Review fixture', onboarding_completed_at=now()
  where id in (pg_temp.uid(1),pg_temp.uid(2),pg_temp.uid(3));
insert into course_reviews_private.catalog_history(course_code,title)
  values ('TEST X91','Archived course fixture');

set local role authenticated;
select pg_temp.login(1);
select is(public.get_course_review_summary('TEST X91')->>'title','Archived course fixture',
  'An officially archived nonstandard code has its original title');
select is(public.get_course_review_summary('  zzqa399b  ')->>'course_code','ZZQA 399B',
  'An exact retired code and compact input share one canonical page');
select is(public.get_course_review_summary('ZZQA 399B')->>'title','ZZQA 399B',
  'An unlisted course uses its code instead of inventing a title');
select throws_ok($$select public.get_course_review_summary('anything I want')$$,'22023',null,
  'A free-form course name cannot create a review page');
select is(public.get_course_review_summary('TEST X91')->'eligible_terms','[]'::jsonb,
  'Historical eligibility does not claim course membership in old clients');

insert into chosen(name,id)
select t->>'display_name', (t->>'id')::uuid
from jsonb_array_elements(public.get_course_review_summary('TEST X91')->'past_terms') t
where t->>'display_name' in ('Fall 1965','Spring 2002','Spring 2003');
select is((select count(*) from chosen),3::bigint,'A semester can predate the entire offering catalog');
select is((select t->>'display_name' from jsonb_array_elements(
  public.get_course_review_summary('TEST X91')->'past_terms') with ordinality s(t,idx)
  order by idx desc limit 1),'Fall 1965','The first semester is Fall 1965');
select is((select count(*) from public.academic_terms where code='2002-spring'),0::bigint,
  'Browsing does not add a term to the course picker');
select throws_ok($$select pg_temp.save('ZZQA 399B',pg_temp.uid(99))$$,'22023',null,'Invalid term IDs cannot be posted');
select throws_ok(format('select pg_temp.save(%L,%L)', 'ZZQA 399B', md5('campusclutch:review-term:' ||
  (extract(year from now())::integer + 1)::text || '-fall')::uuid), '22023', null,
  'A forged future semester ID cannot be self-reported');
select throws_ok(format('select pg_temp.save(%L,%L)', 'ZZQA 399B', md5('campusclutch:review-term:1965-spring')::uuid),
  '22023', null,'SFU had no Spring 1965 semester');
insert into chosen values ('review',pg_temp.save('zzqa399b',pg_temp.item('Spring 2002')));
select is(pg_temp.save('ZZQA 399B',pg_temp.item('Spring 2002')),pg_temp.item('review'),
  'A retry preserves the original review and grade contribution');
select is(pg_temp.save('ZZQA 399B',pg_temp.item('Spring 2002'),'A'),pg_temp.item('review'),
  'The owner can edit a historical review through the same API');
insert into chosen values ('oldest',pg_temp.save('TEST X91',pg_temp.item('Fall 1965')));
select is((select count(*) from public.course_memberships where profile_id=pg_temp.uid(1)),0::bigint,'Writing never enrolls the student');
select is((select count(*) from public.courses where code='ZZQA 399B'),0::bigint,'Writing never invents a catalog offering');
select is((select count(*) from public.academic_terms where id=pg_temp.item('Spring 2002')),0::bigint,
  'A saved historical review does not add an empty chip to the normal course picker');
select is((public.get_course_review_summary('ZZQA 399B')->'my_reviews'->0->>'term_name'),'Spring 2002',
  'Authors see the semester for their own historical review');

select pg_temp.login(2);
select is((select count(*) from public.list_course_reviews('ZZQA 399B')),1::bigint,'Other students can read past feedback before joining');
select ok((select not is_mine and term_name='Spring 2002' and not (to_jsonb(r) ? 'author_id')
  from public.list_course_reviews('ZZQA 399B') r),'Historical feedback is anonymous to classmates');
select is((public.get_course_review_summary('ZZQA 399B')->>'review_count')::integer,1,'A review edit contributes once');
select is((select (g->>'count')::integer from jsonb_array_elements(public.get_course_review_summary('ZZQA 399B')->'grade_counts') g
  where g->>'grade'='A'),1,'The shared grade distribution uses the updated grade');
select is(public.get_safety_report_target('course_review',pg_temp.item('review'))->>'target_label','ZZQA 399B course review',
  'A code-only historical review can be reported');
select is(public.get_safety_report_target('course_review',pg_temp.item('oldest'))->>'target_label','TEST X91 course review',
  'Archived nonstandard codes remain reportable');
select is(public.delete_my_course_review(pg_temp.item('review')),false,'A classmate cannot remove another student’s historical review');

reset role;
update course_reviews_private.reviews set removed_at=now() where id=pg_temp.item('review');
set local role authenticated;
select is((public.get_course_review_summary('ZZQA 399B')->>'review_count')::integer,0,'Hiding a review removes its ratings');
select throws_ok($$select public.get_safety_report_target('course_review',pg_temp.item('review'))$$,'42501',null,'Hidden evidence is private');
select pg_temp.login(1);
select throws_ok($$select pg_temp.save('ZZQA 399B',pg_temp.item('Spring 2002'),'A')$$,'22023',null,'A stale retry cannot republish hidden content');
insert into chosen values ('revision', pg_temp.save('ZZQA 399B',pg_temp.item('Spring 2002'),'A','Updated experience and practical examples.'));
select isnt(pg_temp.item('revision'),pg_temp.item('review'),'The author can publish a distinct revision');
select is((public.get_course_review_summary('ZZQA 399B')->>'review_count')::integer,1,'Only the visible revision contributes');
reset role;
select ok((select archived_at is not null from course_reviews_private.reviews where id=pg_temp.item('review')),
  'Prior moderation evidence stays separate from the revision');

-- A real import of a semester already used for reviews preserves the term ID.
update public.academic_terms set starts_on='2002-01-07',ends_on='2002-04-25' where code='2002-spring';
-- A form opened before the first term import still resolves to the actual ID.
insert into public.academic_terms(id,code,display_name,year,season,starts_on,ends_on,status)
values (pg_temp.uid(400),'2003-spring','Spring 2003',2003,'spring','2003-01-07','2003-04-25','past');
set local role authenticated;
select is((select id from public.academic_terms where code='2002-spring'),pg_temp.item('Spring 2002'),
  'The offering catalog sees a term only after real dates arrive');
insert into chosen values ('stale form',pg_temp.save('TEST X91',pg_temp.item('Spring 2003')));
select is((select term_id from public.list_course_reviews('TEST X91') where id=pg_temp.item('stale form')),pg_temp.uid(400),
  'A previous synthetic semester ID resolves to the subsequently imported one');
select is(pg_temp.save('TEST X91',pg_temp.uid(400)),pg_temp.item('stale form'),'Imported and pre-import semester IDs update the same review');
reset role;
update public.academic_terms set status='upcoming' where code='2002-spring';
set local role authenticated;
select is(pg_temp.save('ZZQA 399B',pg_temp.item('Spring 2002'),'A+','Updated my previous historical feedback.'),
  pg_temp.item('revision'),'A catalog status change preserves editing of an existing review');
select pg_temp.login(2);
select throws_ok($$select pg_temp.save('ZZQA 399B',pg_temp.item('Spring 2002'))$$,
  '22023', null,'Other students cannot submit a new review of the reclassified term');
select pg_temp.login(1);
select is(public.delete_my_course_review(pg_temp.item('revision')),true,'The author can delete a historical review');
select is((public.get_course_review_summary('ZZQA 399B')->>'review_count')::integer,0,'Removing the revision updates its grade distribution');
reset role;
select * from finish();
rollback;
