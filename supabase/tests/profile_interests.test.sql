BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(16);

SELECT ok((SELECT count(*) >= 96 FROM public.interests WHERE is_active), 'Expanded active catalog is available');
SELECT is((SELECT count(*)::integer FROM public.interests WHERE slug IN
  ('anime','coding','coffee','gym','hiking','reading','soccer','study-groups','ui-design')), 9, 'Original interests remain');
SELECT ok(NOT has_table_privilege('anon', 'public.interests', 'SELECT'), 'Anonymous catalog access remains denied');

INSERT INTO auth.users(id,email) VALUES
  ('73000000-0000-4000-8000-000000000001','profile-interest-a@test.local'),
  ('73000000-0000-4000-8000-000000000002','profile-interest-b@test.local'),
  ('73000000-0000-4000-8000-000000000003','profile-interest-private@test.local');
UPDATE public.profiles SET display_name='Interest Test', is_discoverable=(id <> '73000000-0000-4000-8000-000000000003')
WHERE id IN ('73000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000002','73000000-0000-4000-8000-000000000003');
SELECT ok((SELECT bool_and(campus_id IS NULL AND onboarding_completed_at IS NOT NULL) FROM public.profiles
  WHERE id IN ('73000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000002')), 'Profiles complete without a personal campus');
INSERT INTO public.profile_interests(profile_id,interest_id)
SELECT p.id,i.id FROM public.profiles p CROSS JOIN public.interests i
WHERE p.id IN ('73000000-0000-4000-8000-000000000002','73000000-0000-4000-8000-000000000003') AND i.slug IN ('coding','badminton');
INSERT INTO public.course_memberships(profile_id,course_id,status)
SELECT p.id,c.id,'enrolled' FROM public.profiles p CROSS JOIN (
 SELECT courses.id FROM public.courses JOIN public.academic_terms ON academic_terms.id=courses.term_id
 WHERE academic_terms.status='current' AND courses.status='active' LIMIT 1
) c WHERE p.id IN ('73000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000002','73000000-0000-4000-8000-000000000003');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','73000000-0000-4000-8000-000000000001',true);
SELECT ok((SELECT count(*) >= 96 FROM public.interests WHERE is_active), 'Authenticated clients can read expanded choices');
SELECT lives_ok($$SELECT public.replace_my_profile_interests(ARRAY(SELECT id FROM public.interests WHERE slug IN ('coding','badminton','bubble-tea')))$$,
 'Old and new interests save through the existing RPC');
SELECT is((SELECT count(*)::integer FROM public.profile_interests WHERE profile_id=auth.uid()),3,'Three chosen interests persist');
SELECT lives_ok($$SELECT public.replace_my_profile_interests(ARRAY[(SELECT id FROM public.interests WHERE slug='coding'),(SELECT id FROM public.interests WHERE slug='coding'),(SELECT id FROM public.interests WHERE slug='badminton')])$$,
 'Duplicate selection IDs are safely deduplicated');
SELECT is((SELECT count(*)::integer FROM public.profile_interests WHERE profile_id=auth.uid()),2,'Repeated selection saves exactly once');
SELECT throws_ok($$SELECT public.replace_my_profile_interests(ARRAY['73999999-0000-4000-8000-000000000001'::uuid])$$,
 'P0001','One or more selected interests are invalid or inactive.','Invalid interests are rejected');
SELECT is((SELECT count(*)::integer FROM public.profile_interests WHERE profile_id=auth.uid()),2,'Invalid replacement preserves saved interests');
SELECT is((SELECT count(*)::integer FROM public.profile_interests WHERE profile_id='73000000-0000-4000-8000-000000000003'),0,'Private interests stay private');
SELECT is((SELECT count(*)::integer FROM public.profile_interests WHERE profile_id='73000000-0000-4000-8000-000000000002'),2,'Discoverable profile interests are visible');
SELECT is((SELECT shared_interest_count FROM public.get_course_classmates((SELECT course_id FROM public.course_memberships WHERE profile_id=auth.uid() LIMIT 1))
  WHERE profile_id='73000000-0000-4000-8000-000000000002'),2,'New interests match classmates without personal campuses');
SELECT lives_ok($$SELECT public.replace_my_profile_interests('{}'::uuid[])$$,'Interests remain optional');
SELECT is((SELECT count(*)::integer FROM public.profile_interests WHERE profile_id=auth.uid()),0,'All choices can be removed');
SELECT * FROM finish();
ROLLBACK;
