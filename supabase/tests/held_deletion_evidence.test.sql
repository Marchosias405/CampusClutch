begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create function pg_temp.u(n int) returns uuid language sql immutable as $$
 select ('dedeab00-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.login(n int) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',pg_temp.u(n)::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(n),'role','authenticated','session_id',pg_temp.u(n+1000))::text,true);
end$$;
create function pg_temp.hold(a text,k text,ref int,h int) returns uuid language sql as $$
 select public.change_retention_hold(a,k,pg_temp.u(ref),pg_temp.u(h),'Disposable evidence check');
$$;
create function pg_temp.read_copy(k text,ref int) returns jsonb language sql as $$
 select public.get_held_deletion_evidence(k,pg_temp.u(ref));
$$;
create temporary view fixture_batches as
 select * from safety_private.deletion_evidence_batches where target_id in
 (select pg_temp.u(n) from unnest(array[20,21,22,23,30,31,32,40,50]) n);
create function pg_temp.erase() returns jsonb language sql as $$
 select public.begin_my_account_deletion(pg_temp.u(900),repeat('a',64),'DELETE');
$$;
insert into auth.users(id,email,email_confirmed_at)
select pg_temp.u(n),'held-evidence-'||n||'@tests.local',now() from generate_series(1,5)n;
update public.profiles set display_name='Personal profile fixture',onboarding_completed_at=now()
where id in (select pg_temp.u(n) from generate_series(1,5)n);
insert into auth.sessions(id,user_id,created_at,updated_at)
select pg_temp.u(n+1000),pg_temp.u(n),now(),now() from generate_series(1,5)n;
select safety_private.assign_staff_role(pg_temp.u(4),'admin',true,'Rollback evidence fixture');
select safety_private.assign_staff_role(pg_temp.u(5),'admin',true,'Rollback evidence fixture');
select safety_private.assign_staff_role(pg_temp.u(3),'moderator',true,'Rollback evidence fixture');
select safety_private.assign_staff_role(pg_temp.u(1),'moderator',true,'Preflight blocker fixture');

insert into public.requests(id,owner_id,category,title,description,campus_id,room_location,deadline_at,points,item_size)
select pg_temp.u(n),pg_temp.u(case when n=21 then 2 else 1 end),'delivery','Fixture '||n,'Job description '||n,
 (select id from public.campuses limit 1),'Room '||n,now()+interval '1 day',5,'small' from generate_series(20,23)n;
insert into public.delivery_request_details(request_id,pickup_location,dropoff_location)
select pg_temp.u(n),'Pickup '||n,'Destination '||n from generate_series(20,23)n;
insert into public.request_offers(id,request_id,offering_user_id,message) values
 (pg_temp.u(24),pg_temp.u(21),pg_temp.u(1),'Held helper message'),(pg_temp.u(25),pg_temp.u(21),pg_temp.u(3),'Other helper untouched'),
 (pg_temp.u(26),pg_temp.u(20),pg_temp.u(3),'Other helper untouched');
insert into public.points_ledger(profile_id,kind,amount,request_id,offer_round)
values(pg_temp.u(1),'request_sent',-5,pg_temp.u(20),1);
insert into public.notifications(id,recipient_id,actor_id,title,body,event_type,navigation_key,source_event_key)
select pg_temp.u(n),pg_temp.u(case when n=31 then 2 else 1 end),pg_temp.u(case when n=31 then 1 else 2 end),
 'Notice '||n,'Private bell text '||n,'message_received','conversation','secret-event-key-'||n from generate_series(30,32)n;
insert into public.conversations(id,created_by,type) values(pg_temp.u(40),pg_temp.u(1),'direct');
insert into public.conversation_members(conversation_id,profile_id) select pg_temp.u(40),pg_temp.u(n) from generate_series(1,2)n;
insert into public.messages(conversation_id,sender_id,client_message_id,sequence,body)
values(pg_temp.u(40),pg_temp.u(1),pg_temp.u(41),1,'Shared chat body remains');
insert into course_reviews_private.reviews(id,course_code,term_id,author_id,difficulty,workload,recommend,comment)
values(pg_temp.u(49),'TEST 100',(select id from public.academic_terms limit 1),pg_temp.u(1),3,4,true,'A separate source review');
insert into safety_private.reports(id,reporter_id,operation_id,target_type,reported_profile_id,course_review_id,reason,details,payload_hash,evidence)
values(pg_temp.u(50),pg_temp.u(5),pg_temp.u(51),'course_review',pg_temp.u(1),pg_temp.u(49),'spam','',decode(repeat('00',32),'hex'),'{"comment":"Existing evidence"}');

select ok(not has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),r||' has no direct access to '||t)
from unnest(array['anon','authenticated','service_role'])r cross join unnest(array['safety_private.deletion_evidence_items','safety_private.deletion_evidence_batches','safety_private.deletion_evidence_coverage'])t;
select ok(not has_function_privilege(r,'account_private.capture_held_deletion_evidence(uuid)','execute'),r||' cannot call capture')
from unnest(array['anon','authenticated','service_role'])r;
select ok(not has_function_privilege(r,'public.get_held_deletion_evidence(text,uuid,bigint)','execute'),r||' cannot call evidence reader')
from unnest(array['anon','service_role'])r;
set local role authenticated;
select pg_temp.login(4);
select pg_temp.hold('place',kind,n,h) from (values ('job',20,70),('job',20,71),('job',21,72),('job',22,73),
 ('notice',30,74),('notice',31,75),('thread',40,76),('case',50,77))f(kind,n,h);
select pg_temp.hold('release','job',22,73);
select pg_temp.login(1);
select is(pg_temp.erase()->>'accepted','false','Existing job/account deletion preflight still applies');
reset role;
select is((select count(*) from fixture_batches),0::bigint,'Blocked attempt takes no copies');
select safety_private.assign_staff_role(pg_temp.u(1),'moderator',false,'Allow eligible deletion fixture');
set local role authenticated;
select pg_temp.login(1);
select is(pg_temp.erase()->>'accepted','true','Holds allow account deletion to proceed');
select is(pg_temp.erase()->>'accepted','true','Retry with the original receipt is accepted');
select throws_ok($$select pg_temp.read_copy('job',20)$$,'PT403',null,'Deleted identity cannot open evidence');
reset role;
select ok(exists(select from account_private.deletions where profile_id=pg_temp.u(1)) and not exists(select from auth.sessions where user_id=pg_temp.u(1)),'Deletion proceeds to worker and revokes sessions');
select is((select title from public.requests where id=pg_temp.u(20)),'Deleted request','Held request is scrubbed normally');
select ok((select status='rejected' and message='Other helper untouched' from public.request_offers where id=pg_temp.u(26)),
 'Request cancellation settles the other helper’s offer and preserves its original message');
select ok(not exists(select from public.notifications where id=pg_temp.u(30)),'Held recipient notice removed');
select ok((select actor_id is null and body='An update is available.' from public.notifications where id=pg_temp.u(31)),'Other student sees sanitized notice');
select is((select count(*) from fixture_batches),6::bigint,'Only affected, actively held records are captured once');
select is((select count(*) from safety_private.deletion_evidence_coverage where batch_id in (select id from fixture_batches)),7::bigint,'Two holds share one copy of a request');
select ok(not exists(select from safety_private.deletion_evidence_items where batch_id in (select id from fixture_batches)
 and fields::text ~ 'held-evidence-|secret-event-key-|Personal profile fixture|Shared chat body remains|Other helper untouched|Job description 2[123]|Private bell text 32|A separate source review'),
 'Evidence excludes profile data, operational keys, unrelated content and surviving shared bodies');
select ok((select evidence->>'comment'='Existing evidence' and course_review_id is null from safety_private.reports where id=pg_temp.u(50))
 and exists(select from public.messages where body='Shared chat body remains'),'Existing case evidence and shared DM remain on their original paths');
set local role authenticated;
select pg_temp.login(2);
select throws_ok($$select pg_temp.read_copy('notice',31)$$,'42501',null,'Notice recipient cannot access the private copy');
select pg_temp.login(3);
select throws_ok($$select pg_temp.read_copy('case',50)$$,'42501',null,'Moderator cannot access the private copy');
select pg_temp.login(5);
select throws_ok($$select pg_temp.read_copy('case',50)$$,'PT404',null,'Admin involved in case cannot inspect its copy');
select pg_temp.login(4);
select ok(pg_temp.read_copy('job',20)::text like '%Pickup 20%' and pg_temp.read_copy('job',20)::text like '%Destination 20%'
 and pg_temp.read_copy('job',20)::text like '%Job description 20%' and pg_temp.read_copy('job',20)::text like '%Points transfer%', 'Admin sees request, category fields and affected transfer');
select ok(pg_temp.read_copy('job',21)::text like '%Held helper message%' and pg_temp.read_copy('job',21)::text like '%Offer history%', 'Helper deletion preserves affected offer and history');
select ok(exists(select from jsonb_array_elements(pg_temp.read_copy('job',20)) e
 where e->>'label'='Offer before cancellation' and e->'fields'->>'Offer'=pg_temp.u(26)::text and e->'fields'->>'Status'='pending'
 and not ((e->'fields') ? 'Message')),
 'Automatic rejection preserves the prior offer state and leaves the surviving helper message out of the copy');
select ok(pg_temp.read_copy('notice',30)::text like '%Private bell text 30%' and pg_temp.read_copy('notice',31)::text like '%Private bell text 31%', 'Admin sees original deleted and redacted bell text');
select ok(pg_temp.read_copy('thread',40)::text like '%Conversation before closure%' and pg_temp.read_copy('case',50)::text like '%'||pg_temp.u(49)::text||'%', 'Changed thread state and reported review reference retained');
select pg_temp.hold('release','job',20,70);
select ok(jsonb_array_length(pg_temp.read_copy('job',20))>0,'One original hold keeps the shared copy readable');
select pg_temp.hold('release','job',20,71);
select is(pg_temp.read_copy('job',20),'[]'::jsonb,'Last release closes access to the copy');
select pg_temp.hold('place','job',20,78);
select is(pg_temp.read_copy('job',20),'[]'::jsonb,'New hold cannot reopen evidence from a prior hold');
reset role;
select safety_private.assign_staff_role(pg_temp.u(4),'admin',false,'Verify live admin role');
set local role authenticated;
select pg_temp.login(4);
select throws_ok($$select pg_temp.read_copy('notice',30)$$,'42501',null,'Revoked admin cannot obtain evidence');
select * from finish();
rollback;
