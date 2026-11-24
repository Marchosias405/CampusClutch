begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();

create function pg_temp.fixture_id(n integer) returns uuid language sql immutable as $$
  select ('d711dddd-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
insert into auth.users(id, email, email_confirmed_at)
values (pg_temp.fixture_id(1), 'review-directory-fixture@sfu.ca', now());
update public.profiles set display_name = 'Directory tester', onboarding_completed_at = now()
where id = pg_temp.fixture_id(1);
insert into public.academic_terms(id, code, display_name, year, season, starts_on, ends_on, status) values
  (pg_temp.fixture_id(10), '2079-spring', 'Directory earlier term', 2079, 'spring', current_date-300, current_date-190, 'past'),
  (pg_temp.fixture_id(11), '2079-fall', 'Directory later term', 2079, 'fall', current_date-180, current_date-90, 'past');
insert into public.courses(code,title,term_id,status) values
  ('ZZDIR 101', 'Earlier offering name', pg_temp.fixture_id(10), 'closed'),
  ('ZZDIR 101', 'Latest offering name', pg_temp.fixture_id(11), 'active');
insert into course_reviews_private.catalog_history(course_code, title) values
  ('ZZDIR 101','Archived semester name'), ('ZZDIR 102','Introduction to test data');
insert into course_reviews_private.reviews(course_code, term_id, author_id, difficulty, workload, recommend, comment, removed_at)
values ('ZZDIR 103', pg_temp.fixture_id(10), pg_temp.fixture_id(1), 3, 2, true, 'Visible review for an unlisted course.', null),
       ('ZZDIR 104', pg_temp.fixture_id(10), pg_temp.fixture_id(1), 2, 2, true, 'Hidden review for an unlisted course.', now());

select ok(not has_function_privilege('anon','public.search_review_courses(text,text,integer)','EXECUTE'), 'Guest cannot browse');
select ok(not has_function_privilege('anon','course_reviews_private.search_courses(text,text,integer)','EXECUTE'), 'Guest cannot call private search');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.fixture_id(1)::text,true);
select is((select string_agg(course_code, ',' order by course_code) from public.search_review_courses('zzdir')),
          'ZZDIR 101,ZZDIR 102,ZZDIR 103', 'One result per code across terms and archive; only visible unlisted codes');
select is((select title from public.search_review_courses(' ZzDiR101 ')), 'Latest offering name', 'Compact case-insensitive code uses latest title');
select is((select title from public.search_review_courses('Archived semester name')), 'Latest offering name', 'Earlier title finds canonical course');
select is((select course_code from public.search_review_courses('Introduction to test data')), 'ZZDIR 102', 'Find archived-only course by title');
select is((select course_code from public.search_review_courses('zzdir','ZZDIR 101',1)), 'ZZDIR 102', 'Stable exclusive cursor and bounded page');
select is((select count(*) from public.search_review_courses('ZZDIR%')), 0::bigint, 'Search punctuation is literal');
select throws_ok($$select * from public.search_review_courses(repeat('x',81))$$,'22023','Use a shorter course search.','Reject overlong searches');
reset role;
update auth.users set banned_until = now() + interval '1 day' where id = pg_temp.fixture_id(1);
set local role authenticated;
select throws_ok($$select * from public.search_review_courses('ZZDIR')$$,'42501',null,'Banned accounts cannot browse');
select * from finish();
rollback;
