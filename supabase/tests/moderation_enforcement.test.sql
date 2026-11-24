begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.uid(i integer) returns uuid language sql immutable as $$
  select ('e14afe00-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
$$;
create function pg_temp.login(i integer) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub',pg_temp.uid(i)::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(i),'role','authenticated','session_id',pg_temp.uid(i+100))::text,true);
end;
$$;
create function pg_temp.act(r integer,k text,op integer,v integer default 0,rv timestamptz default null) returns jsonb language sql as $$
  select public.enforce_moderation_report(pg_temp.uid(r),pg_temp.uid(op),v,k,'Please follow the community rules.',rv);
$$;
create temp table results(name text primary key,value jsonb);
grant all on results to authenticated;
insert into auth.users(id,email,email_confirmed_at)
select pg_temp.uid(n),'enforcement-'||n||'@tests.local',now() from generate_series(1,6) n;
update public.profiles set display_name='Enforcement fixture',onboarding_completed_at=now(),is_discoverable=true
where id in (select pg_temp.uid(n) from generate_series(1,6) n);
insert into auth.sessions(id,user_id,created_at,updated_at)
select pg_temp.uid(n+100),pg_temp.uid(n),now(),now() from generate_series(1,6) n;
select safety_private.assign_staff_role(pg_temp.uid(4),'admin',true,'Rollback only admin fixture');
select safety_private.assign_staff_role(pg_temp.uid(3),'moderator',true,'Rollback only moderator fixture');
insert into public.academic_terms(id,code,display_name,year,season,starts_on,ends_on,status)
values(pg_temp.uid(301),'2089-fall','Enforcement fixture term',2089,'fall',current_date-30,current_date+30,'current');
insert into public.courses(id,code,title,term_id,status)
values(pg_temp.uid(201),'ENFORCE 991','Enforcement fixture course',pg_temp.uid(301),'active');
insert into public.course_memberships(profile_id,course_id,status) values(pg_temp.uid(2),pg_temp.uid(201),'enrolled');
create temp table course as select code,id,term_id term from public.courses where id=pg_temp.uid(201);
grant select on course to authenticated;
insert into course_reviews_private.reviews(id,course_code,term_id,author_id,difficulty,workload,recommend,grade,comment)
select pg_temp.uid(200),code,term,pg_temp.uid(2),4,5,true,'B','Fixture review with useful feedback.' from course;
insert into safety_private.reports(id,reporter_id,reported_profile_id,operation_id,target_type,reason,details,payload_hash,evidence,triage_status)
select pg_temp.uid(1000+n),pg_temp.uid(1),pg_temp.uid(2),pg_temp.uid(2000+n),'student','spam','',digest(n::text,'sha256'),'{}','escalated'
from generate_series(1,12) n;
update safety_private.reports set target_type='course_review',course_review_id=pg_temp.uid(200) where id in (pg_temp.uid(1010),pg_temp.uid(1011));
select pg_temp.login(1);
update safety_private.reports set evidence=(select evidence from safety_private.content_report_target('course_review',pg_temp.uid(200),pg_temp.uid(1)))
  where id=pg_temp.uid(1010);
select is((select evidence->>'difficulty' from safety_private.reports where id=pg_temp.uid(1010)),'4','Report captures difficulty');
select is((select evidence->>'workload' from safety_private.reports where id=pg_temp.uid(1010)),'5','Report captures workload');
update course_reviews_private.reviews set difficulty=2,updated_at=clock_timestamp() where id=pg_temp.uid(200);
select is((select evidence->>'difficulty' from safety_private.reports where id=pg_temp.uid(1010)),'4','Later edits do not alter evidence');
create temp table preserved as select
  (select jsonb_agg(to_jsonb(w) order by profile_id) from public.points_wallets w) wallets,
  (select count(*) from public.points_ledger) ledger,
  (select jsonb_agg(to_jsonb(r) order by id) from public.requests r) requests;

select ok(c.relrowsecurity,c.relname||' enables RLS') from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='safety_private' and c.relname in ('account_standing','enforcement_actions');
select ok(not has_table_privilege(role,'safety_private.'||tab,'SELECT,INSERT,UPDATE,DELETE'),role||' cannot directly access '||tab)
from unnest(array['anon','authenticated','service_role']) role cross join unnest(array['account_standing','enforcement_actions']) tab;
select ok(not has_function_privilege(role,'public.enforce_moderation_report(uuid,uuid,integer,text,text,timestamptz)','execute'),role||' cannot enforce')
from unnest(array['anon','service_role']) role;
select ok(not p.prosecdef,'Public enforcement wrapper uses invoker rights') from pg_proc p where p.oid='public.enforce_moderation_report(uuid,uuid,integer,text,text,timestamptz)'::regprocedure;

set local role authenticated;
select pg_temp.login(1);
select throws_ok($$select pg_temp.act(1001,'warn',3001)$$,'42501',null,'Ordinary student cannot warn');
select pg_temp.login(3);
select throws_ok($$select pg_temp.act(1001,'warn',3001)$$,'42501',null,'Moderator triage does not confer enforcement');
select pg_temp.login(4);
select throws_ok($$select pg_temp.act(1001,'invalid',3001)$$,'22023',null,'Unknown action denied');
select throws_ok($$select pg_temp.act(9999,'warn',3001)$$,'42501',null,'Unknown report denied');
insert into results values('warning',pg_temp.act(1001,'warn',3001));
select is((select value->>'warning_count' from results where name='warning'),'1','First warning counted');
select is(pg_temp.act(1001,'warn',3001),(select value from results where name='warning'),'Exact retry returns original receipt');
select throws_ok($$select pg_temp.act(1001,'suspend_7_days',3001)$$,'22023',null,'Operation ID cannot change action');
select throws_ok($$select pg_temp.act(1001,'warn',3002,1)$$,'PT409',null,'Second operation cannot double-warn same report');
select is((public.get_moderation_enforcement(pg_temp.uid(1001))->>'warning_count'),'1','Duplicate attempts do not count');
select pg_temp.login(2);
select is(jsonb_array_length(public.get_my_account_standing()->'notices'),0,'Warning alone no longer requires acknowledgement');
select lives_ok($$select * from public.get_request_feed()$$,'Warned account retains normal app access');
select is(public.get_my_notification_unread_count_v2(),1,'Warning increments recipient bell count exactly once');
select is((select count(*)::integer from public.get_my_notifications_v2() where event_type='account_warning'),1,'Warning is present in recipient inbox');
select ok((select body like '%Please follow the community rules.%' and body like '%1/3%' from public.get_my_notifications_v2()),'Warning includes full reason and cycle');
select ok((select actor_id is null and request_id is null and offer_id is null and conversation_id is null and message_id is null and navigation_key='account_notice' from public.get_my_notifications_v2()),'Warning exposes no staff identity or report target');
select is((select count(*)::integer from public.get_my_notifications()),0,'Older APKs receive only supported event types');
select is(public.get_my_notification_unread_count(),0,'Older APK badge excludes unsupported warnings');
select is(public.mark_all_my_notifications_read(),0,'Older APK mark-all cannot silently clear warnings');
select is(public.get_my_notification_unread_count_v2(),1,'Warning remains unread after legacy mark-all');
select lives_ok($$select public.mark_my_notification_read((select id from public.get_my_notifications_v2() limit 1))$$,'Warning can be marked read');
select is(public.get_my_notification_unread_count_v2(),0,'Reading warning clears its bell count');
select is((select count(*)::integer from public.get_my_notifications_v2()),1,'Read warning remains in history');
select pg_temp.login(1);
select is((select count(*)::integer from public.get_my_notifications_v2()),0,'Reporter cannot see recipient warning');
select throws_ok($$select notifications_private.copy_warning(null,null)$$,'42501',null,'Student cannot author warning notifications');
select pg_temp.login(4);
select public.enforce_moderation_report(pg_temp.uid(1002),pg_temp.uid(3002),0,'warn',repeat('x',2000),null);
select pg_temp.login(2);
select ok((select char_length(body)>2000 and position(repeat('x',2000) in body)>0 from public.get_my_notifications_v2() where read_at is null),'Maximum reason remains intact in bell notification');
select is(public.mark_all_my_notifications_read_v2(),1,'New mark-all includes warning');
select is(public.mark_all_my_notifications_read_v2(),0,'Warning mark-all retry is idempotent');
select pg_temp.login(4);
insert into results values('third',pg_temp.act(1003,'warn',3003));
select is((select value->>'warning_count' from results where name='third'),'3','Third warning counted');
select is((select value->>'automatic_suspension' from results where name='third'),'true','Third warning suspends');
select ok((select (value->>'suspended_until')::timestamptz between now()+interval '7 days' and now()+interval '7 days 1 minute' from results where name='third'),'Seven-day expiry is server-calculated');
select pg_temp.login(2);
select is((public.get_my_account_standing()->>'suspended'),'true','Affected student can see suspension');
select throws_ok($$select * from public.get_my_notifications_v2()$$,'PT403',null,'Third-warning suspension still blocks inbox');
select throws_ok($$select public.get_my_notification_unread_count_v2()$$,'PT403',null,'Suspended badge RPC is guarded');
select throws_ok($$select public.mark_all_my_notifications_read_v2()$$,'PT403',null,'Suspended mark-all RPC is guarded');
select is(jsonb_array_length(public.get_my_account_standing()->'notices'),3,'Student sees three reasons');
select ok(not (public.get_my_account_standing()::text like '%subject_id%'),'Own notices contain no report identities');
select throws_ok($$select * from public.get_request_feed()$$,'PT403',null,'Existing signed-in session cannot read feed RPC');
select throws_ok($$select public.get_my_moderation_access()$$,'PT403',null,'Existing signed-in session cannot call guarded RPC');
select throws_ok($$select public.start_direct_conversation(pg_temp.uid(1))$$,'PT403',null,'Suspended session cannot start DMs');
select is((select count(*)::integer from public.profiles),0,'RLS blocks direct profile reads');
select is((select count(*)::integer from public.courses),0,'RLS blocks direct course reads');
select lives_ok($$select public.acknowledge_account_notice(clock_timestamp())$$,'Suspended student can acknowledge notice');
select is(jsonb_array_length(public.get_my_account_standing()->'notices'),0,'Acknowledgement hides only own notices');
reset role;
update safety_private.account_standing set suspended_until=now()-interval '1 second' where profile_id=pg_temp.uid(2);
set local role authenticated;
select is((public.get_my_account_standing()->>'suspended'),'false','Expiry restores access automatically');
select lives_ok($$select * from public.get_request_feed()$$,'RPC available after expiry');
select is((select count(*)::integer from public.get_my_notifications_v2()),3,'All warnings remain readable after suspension expires');
select pg_temp.login(4);
select is((pg_temp.act(1004,'warn',3004)->>'automatic_suspension'),'false','Fourth warning starts new cycle');
select is((pg_temp.act(1005,'warn',3005)->>'automatic_suspension'),'false','Fifth warning does not suspend');
select is((pg_temp.act(1006,'warn',3006)->>'automatic_suspension'),'true','Sixth warning starts next seven-day suspension');
select is((pg_temp.act(1007,'suspend_7_days',3007)->>'warning_count'),'6','Manual suspension does not add warning');
select throws_ok($$select pg_temp.act(1010,'remove_review',3010,0,'2000-01-01')$$,'PT409',null,'Cannot remove a review edited since admin loaded it');
insert into results values('before_summary',public.get_course_review_summary((select code from course)));
select is((select value->>'average_difficulty' from results where name='before_summary'),'2.0','Summary uses current difficulty before removal');
select is((select value->>'average_workload' from results where name='before_summary'),'5.0','Summary uses current workload before removal');
insert into results values('removed',pg_temp.act(1010,'remove_review',3010,0,(public.get_moderation_enforcement(pg_temp.uid(1010))->>'review_updated_at')::timestamptz));
select is((select value->>'kind' from results where name='removed'),'remove_review','Admin can remove current review');
select is((public.get_course_review_summary((select code from course))->>'review_count')::integer,
  (select (value->>'review_count')::integer-1 from results where name='before_summary'),'Removed review excluded from aggregate count');
select is(public.get_course_review_summary((select code from course))->>'average_difficulty',null::text,'Removed review excluded from difficulty average');
select is(public.get_course_review_summary((select code from course))->>'average_workload',null::text,'Removed review excluded from workload average');
select is((select sum((bin->>'count')::integer)::integer from jsonb_array_elements(public.get_course_review_summary((select code from course))->'grade_counts') bin),0,'Removed review excluded from grade histogram');
select is((select count(*)::integer from public.list_course_reviews((select code from course)) where id=pg_temp.uid(200)),0,'Removed review absent from public list');
select is((public.get_moderation_report(pg_temp.uid(1010))->'evidence'->>'difficulty'),'4','Evidence survives removal');
select is((public.get_moderation_enforcement(pg_temp.uid(1010))->>'review_removed'),'true','Admin sees removal state');
reset role;
update safety_private.account_standing set suspended_until=now()-interval '1 second' where profile_id=pg_temp.uid(2);
set local role authenticated;
select pg_temp.login(2);
select is((public.get_course_review_summary((select code from course))->'my_reviews'->0->>'is_hidden'),'true','Author sees their hidden review in editable history');
select is(jsonb_array_length(public.get_course_review_summary((select code from course))->'eligible_terms'),1,'Hidden review does not remove course eligibility');
select throws_ok($$select public.save_my_course_review((select code from course),(select term from course),2,5,true,'B','Fixture review with useful feedback.','','','{}')$$,'22023',null,'Stale exact save cannot silently restore a hidden review');
insert into results values('revision',to_jsonb(public.save_my_course_review((select code from course),(select term from course),3,3,true,'A','Revised review with constructive feedback.','','','{}')));
select isnt((select value#>>'{}' from results where name='revision'),pg_temp.uid(200)::text,'Revising a hidden review creates a new reportable identity');
select is(to_jsonb(public.save_my_course_review((select code from course),(select term from course),3,3,true,'A','Revised review with constructive feedback.','','','{}')),(select value from results where name='revision'),'Retry publishes the same replacement exactly once');
select is((public.get_course_review_summary((select code from course))->>'review_count'),'1','Only published replacement contributes to summary');
select is((public.get_course_review_summary((select code from course))->>'average_difficulty'),'3.0','Replacement difficulty contributes once');
select is((public.get_course_review_summary((select code from course))->>'average_workload'),'3.0','Replacement workload contributes once');
select is((select count(*)::integer from public.list_course_reviews((select code from course))),1,'Public list contains one replacement');
select is(jsonb_array_length(public.get_course_review_summary((select code from course))->'my_reviews'),1,'Author editor contains only current version');
select is((public.get_course_review_summary((select code from course))->'my_reviews'->0->>'is_hidden'),'false','Published replacement is not labelled hidden');
select pg_temp.login(1);
select is(jsonb_array_length(public.get_course_review_summary((select code from course))->'my_reviews'),0,'Hidden draft and original are never exposed to another student');
select is(public.delete_my_course_review((select (value#>>'{}')::uuid from results where name='revision')),false,'Other student cannot remove a replacement');
reset role;
select ok((select archived_at is not null and removed_at is not null and comment='Fixture review with useful feedback.' from course_reviews_private.reviews where id=pg_temp.uid(200)),'Hidden source is retained unchanged for evidence');
select is((select evidence->>'difficulty' from safety_private.reports where id=pg_temp.uid(1010)),'4','Original report evidence survives republication');
select is((select course_review_id from safety_private.reports where id=pg_temp.uid(1010)),pg_temp.uid(200),'Original report stays attached to hidden version');
insert into safety_private.reports(id,reporter_id,reported_profile_id,operation_id,target_type,course_review_id,reason,details,payload_hash,evidence,triage_status)
values(pg_temp.uid(1020),pg_temp.uid(1),pg_temp.uid(2),pg_temp.uid(2020),'course_review',(select (value#>>'{}')::uuid from results where name='revision'),'spam','',digest('revision','sha256'),'{}','escalated');
set local role authenticated;
select pg_temp.login(4);
select is((public.get_moderation_enforcement(pg_temp.uid(1010))->>'review_removed'),'true','Old admin report continues to show original as hidden');
select is((public.get_moderation_enforcement(pg_temp.uid(1010))->'current_review'->>'comment'),'Fixture review with useful feedback.','Admin original content is immutable');
select lives_ok($$select pg_temp.act(1020,'remove_review',3020,0,(public.get_moderation_enforcement(pg_temp.uid(1020))->>'review_updated_at')::timestamptz)$$,'Admin can hide a reported replacement separately');
select pg_temp.login(2);
select is((public.get_course_review_summary((select code from course))->>'review_count'),'0','Hiding replacement removes all public contributions again');
select is(public.delete_my_course_review((select (value#>>'{}')::uuid from results where name='revision')),true,'Author can discard a hidden replacement');
select is(public.delete_my_course_review((select (value#>>'{}')::uuid from results where name='revision')),false,'Discard retry is idempotent');
select is(jsonb_array_length(public.get_course_review_summary((select code from course))->'my_reviews'),0,'Discard frees author editor');
insert into results values('fresh',to_jsonb(public.save_my_course_review((select code from course),(select term from course),1,2,false,'C','New review written after discarding hidden version.','','','{}')));
select isnt((select value from results where name='fresh'),(select value from results where name='revision'),'Author can write a fresh review for same course and term');
select is(public.delete_my_course_review(pg_temp.uid(200)),false,'Retry on historical ID cannot delete the fresh review');
select is((public.get_course_review_summary((select code from course))->>'review_count'),'1','Fresh review counted exactly once');
reset role;
select is((select count(*)::integer from course_reviews_private.reviews where author_id=pg_temp.uid(2) and archived_at is not null),2,'Both hidden versions remain private evidence');
select is((select count(*)::integer from course_reviews_private.reviews where author_id=pg_temp.uid(2) and archived_at is null),1,'One current review slot survives replacement and deletion');
set local role authenticated;
select pg_temp.login(4);
reset role;
update safety_private.reports set triage_status='new' where id=pg_temp.uid(1008);
set local role authenticated;
select throws_ok($$select pg_temp.act(1008,'warn',3008)$$,'PT409',null,'Report must be escalated first');
reset role;
update safety_private.reports set reporter_id=pg_temp.uid(4) where id=pg_temp.uid(1009);
set local role authenticated;
select throws_ok($$select pg_temp.act(1009,'warn',3009)$$,'42501',null,'Admin cannot act on own report');
reset role;
update safety_private.reports set reported_profile_id=pg_temp.uid(3) where id=pg_temp.uid(1012);
set local role authenticated;
select throws_ok($$select pg_temp.act(1012,'suspend_7_days',3012)$$,'42501',null,'Staff sanctions require owner review');
reset role;
select is((select jsonb_agg(to_jsonb(w) order by profile_id) from public.points_wallets w),(select wallets from preserved),'Enforcement preserves wallets');
select is((select count(*) from public.points_ledger),(select ledger from preserved),'Enforcement preserves ledger');
select is((select jsonb_agg(to_jsonb(r) order by id) from public.requests r),(select requests from preserved),'Enforcement preserves requests');
select is((select count(*)::integer from public.notifications where recipient_id=pg_temp.uid(2) and source_event_key like 'moderation-warning:%'),6,'Formal warning notices remain separate from removal and suspension notices');
select is((select count(*)::integer from notifications_private.push_jobs where notification_id in (select id from public.notifications where recipient_id=pg_temp.uid(2) and event_type='account_warning')),0,'Warnings are bell-only and never queue OS pushes');
delete from public.notifications where recipient_id=pg_temp.uid(2) and source_event_key='moderation-warning:'||(select value->>'action_id' from results where name='warning');
select notifications_private.copy_warning(a,clock_timestamp()) from safety_private.enforcement_actions a where id=(select (value->>'action_id')::uuid from results where name='warning');
select notifications_private.copy_warning(a,null) from safety_private.enforcement_actions a where id=(select (value->>'action_id')::uuid from results where name='warning');
select is((select count(*)::integer from public.notifications where recipient_id=pg_temp.uid(2) and source_event_key like 'moderation-warning:%'),6,'Historical copy cannot duplicate an existing warning');
select ok((select read_at is not null from public.notifications where recipient_id=pg_temp.uid(2) and source_event_key='moderation-warning:'||(select value->>'action_id' from results where name='warning')),'Historical copy preserves earlier acknowledgement');
select lives_ok($$select notifications_private.copy_warning(jsonb_populate_record(null::safety_private.enforcement_actions,to_jsonb(a)||'{"subject_id":null}'::jsonb))
  from safety_private.enforcement_actions a where id=(select (value->>'action_id')::uuid from results where name='warning')$$,'Historical warning for a deleted account is skipped safely');
select ok(not has_function_privilege('anon',f,'execute'),'Anonymous access denied: '||f)
from unnest(array['public.get_my_notifications_v2(integer,timestamptz,uuid)','public.get_my_notification_unread_count_v2()','public.mark_all_my_notifications_read_v2()']) f;
-- Retention wrappers delegate their account check to the shared private admin guard.
-- Exercise those exact signatures as an assigned admin with a suspended account.
create temp table delegated_guard_calls(routine regprocedure primary key, args text);
insert into delegated_guard_calls values
 ('public.change_retention_hold(text,text,uuid,uuid,text)', $$'place','case',pg_temp.uid(1010),pg_temp.uid(5001),'Pending appeal evidence'$$),
 ('public.get_retention_holds(text,uuid)', $$'case',pg_temp.uid(1010)$$),
 ('public.get_held_deletion_evidence(text,uuid,bigint)', $$'case',pg_temp.uid(1010),null$$),
 ('public.place_dated_retention_hold(text,uuid,uuid,text,date)', $$'case',pg_temp.uid(1010),pg_temp.uid(5002),'Pending appeal evidence',current_date+7$$);
grant select on delegated_guard_calls to authenticated;
insert into safety_private.account_standing(profile_id,suspended_until) values(pg_temp.uid(4),now()+interval '1 day')
on conflict(profile_id) do update set suspended_until=excluded.suspended_until;
set local role authenticated;
select pg_temp.login(4);
select throws_ok(format('select public.%I(%s)',p.proname,c.args),'PT403',
 'Your CampusClutch account is temporarily suspended.','Suspended admin is refused: '||p.proname)
from delegated_guard_calls c join pg_proc p on p.oid=c.routine;
reset role;
select ok(p.prosrc like '%safety_private.check_account_access()%','Guarded RPC: '||p.proname)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
where n.nspname='public' and p.prokind='f' and p.prorettype<>'trigger'::regtype
  and has_function_privilege('authenticated',p.oid,'execute') and l.lanname in ('sql','plpgsql')
  -- Recovery and read-only deletion guidance remain available during suspension.
  -- Their live-session/ownership checks are covered by moderation_appeals.test.sql
  -- and account_deletion_preflight.test.sql; this is not a general RPC exemption.
  and p.proname not in ('get_my_account_standing','acknowledge_account_notice','get_my_moderation_actions','submit_moderation_appeal','get_my_account_deletion_preflight','begin_my_account_deletion')
  and not exists(select 1 from delegated_guard_calls c where c.routine=p.oid)
  and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e');
select * from finish();
rollback;
