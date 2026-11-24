begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.uid(i integer) returns uuid language sql immutable as $$
 select ('ea14ae00-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid; $$;
create function pg_temp.login(i integer) returns void language plpgsql as $$ begin
 perform set_config('request.jwt.claim.sub',pg_temp.uid(i)::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(i),'role','authenticated','session_id',pg_temp.uid(i+100))::text,true);
end $$;
create temp table results(name text primary key,value jsonb);
grant all on results to authenticated;
insert into auth.users(id,email,email_confirmed_at)
select pg_temp.uid(n),'appeals-'||n||'@tests.local',now() from generate_series(1,7) n;
update public.profiles set display_name='Appeal fixture',onboarding_completed_at=now(),is_discoverable=true
 where id in(select pg_temp.uid(n) from generate_series(1,7) n);
insert into auth.sessions(id,user_id,created_at,updated_at)
select pg_temp.uid(n+100),pg_temp.uid(n),now(),now() from generate_series(1,7) n;
select safety_private.assign_staff_role(pg_temp.uid(4),'admin',true,'Rollback only appeals admin');
select safety_private.assign_staff_role(pg_temp.uid(5),'admin',true,'Rollback only appeals colleague');
select safety_private.assign_staff_role(pg_temp.uid(3),'moderator',true,'Rollback only triage role');
insert into public.academic_terms(id,code,display_name,year,season,starts_on,ends_on,status)
values(pg_temp.uid(301),'2088-fall','Appeal fixture term',2088,'fall',current_date-30,current_date+30,'current');
insert into public.courses(id,code,title,term_id,status)
values(pg_temp.uid(201),'APPEAL 991','Appeal fixture course',pg_temp.uid(301),'active');
insert into public.course_memberships(profile_id,course_id,status) values(pg_temp.uid(2),pg_temp.uid(201),'enrolled');
insert into course_reviews_private.reviews(id,course_code,term_id,author_id,difficulty,workload,recommend,comment)
values(pg_temp.uid(200),'APPEAL 991',pg_temp.uid(301),pg_temp.uid(2),4,5,true,'Original review for an appeal test.');
insert into safety_private.reports(id,reporter_id,reported_profile_id,operation_id,target_type,reason,details,payload_hash,evidence,triage_status)
select pg_temp.uid(1000+n),pg_temp.uid(1),pg_temp.uid(2),pg_temp.uid(2000+n),'student','spam','',digest(n::text,'sha256'),'{}','escalated'
from generate_series(1,30) n;
update safety_private.reports set target_type='course_review',course_review_id=pg_temp.uid(200) where id=pg_temp.uid(1010);
create function pg_temp.act(r integer,k text default 'warn',rv timestamptz default null) returns jsonb language sql as $$
 select public.enforce_moderation_report(pg_temp.uid(1000+r),pg_temp.uid(3000+r),0,k,'Original reason for this action.',rv); $$;
create function pg_temp.aid(n text) returns uuid language sql as $$ select (value->>'action_id')::uuid from results where name=n; $$;
create function pg_temp.apid(n text) returns uuid language sql as $$ select (value#>>'{}')::uuid from results where name=n; $$;
create function pg_temp.appeal(n text,op integer) returns uuid language sql as $$
 select public.submit_moderation_appeal(pg_temp.aid(n),pg_temp.uid(op),'Please reconsider this decision with this explanation.'); $$;
create function pg_temp.resolve(n text,op integer,outcome text default 'overturned') returns jsonb language sql as $$
 select public.resolve_moderation_appeal(pg_temp.apid(n),pg_temp.uid(op),0,outcome,'We reviewed the evidence and explanation carefully.'); $$;
create temp table preserved as select
 (select jsonb_agg(to_jsonb(w) order by profile_id) from public.points_wallets w) wallets,
 (select count(*) from public.points_ledger) ledger,
 (select jsonb_agg(to_jsonb(r) order by id) from public.requests r) requests;

select ok(c.relrowsecurity,c.relname||' has RLS') from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='safety_private' and c.relname in('appeals','appeal_decisions','appeal_views');
select ok(not has_table_privilege(role,'safety_private.'||tab,'SELECT,INSERT,UPDATE,DELETE'),role||' denied direct '||tab)
from unnest(array['anon','authenticated','service_role']) role cross join unnest(array['appeals','appeal_decisions','appeal_views']) tab;
select ok(not has_function_privilege(role,p.oid,'execute'),role||' denied '||p.proname)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join unnest(array['anon','service_role']) role
where n.nspname='public' and p.proname in('get_my_moderation_actions','submit_moderation_appeal','list_moderation_appeals','get_moderation_appeal','resolve_moderation_appeal');
select ok(not p.prosecdef,'Invoker wrapper: '||p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in('get_my_moderation_actions','submit_moderation_appeal','list_moderation_appeals','get_moderation_appeal','resolve_moderation_appeal');

set local role authenticated;
select pg_temp.login(4);
insert into results values('w1',pg_temp.act(1)),('w2',pg_temp.act(2)),('w3',pg_temp.act(3));
select pg_temp.login(2);
select is(public.get_my_account_standing()->>'suspended','true','Three warnings suspend');
select is(jsonb_array_length(public.get_my_moderation_actions()),3,'Suspended author can view all own actions');
select ok(not(public.get_my_moderation_actions()::text ~ '(actor_id|subject_id|reporter_id|report_id)'),'Own history excludes private identities/report pointers');
insert into results values('a1',to_jsonb(pg_temp.appeal('w1',5001)));
select is(pg_temp.appeal('w1',5001),pg_temp.apid('a1'),'Exact suspended submission retry returns same appeal');
select throws_ok($$select public.submit_moderation_appeal(pg_temp.aid('w2'),pg_temp.uid(5001),'A different valid explanation.')$$,'22023',null,'Retry ID cannot be reused for different action');
select throws_ok($$select pg_temp.appeal('w1',5002)$$,'PT409',null,'One appeal per action');
select throws_ok($$select public.submit_moderation_appeal(pg_temp.aid('w2'),pg_temp.uid(5003),'tiny')$$,'22023',null,'Short appeals rejected');
select throws_ok($$select public.submit_moderation_appeal(pg_temp.uid(99999),pg_temp.uid(5004),'Unknown action explanation.')$$,'42501',null,'Unknown action denied');
select throws_ok($$select * from public.get_request_feed()$$,'PT403',null,'Appeal access does not restore app access');
select throws_ok($$select public.list_moderation_appeals()$$,'PT403',null,'Suspended students cannot access staff appeals');
select pg_temp.login(6);
select is(public.get_my_moderation_actions(),'[]'::jsonb,'Other student has no appeal history');
select throws_ok($$select pg_temp.appeal('w2',5005)$$,'42501',null,'Cannot appeal someone else action');
select throws_ok($$select public.get_moderation_appeal(pg_temp.apid('a1'))$$,'42501',null,'Other student cannot read appeal');
select pg_temp.login(3);
select throws_ok($$select public.list_moderation_appeals()$$,'42501',null,'Moderator cannot read appeals');
select throws_ok($$select pg_temp.resolve('a1',6001)$$,'42501',null,'Moderator cannot reverse');
select pg_temp.login(4);
select is(jsonb_array_length(public.list_moderation_appeals()),1,'Original admin may review pending appeal');
select is(public.get_moderation_appeal(pg_temp.apid('a1'))->>'original_admin','true','Original-admin relationship shown without identity');
insert into results values('d1',pg_temp.resolve('a1',6001));
select is(pg_temp.resolve('a1',6001),(select value from results where name='d1'),'Exact resolution retry returns same decision');
select throws_ok($$select pg_temp.resolve('a1',6001,'upheld')$$,'22023',null,'Decision retry cannot change result');
select pg_temp.login(5);
select throws_ok($$select pg_temp.resolve('a1',6002)$$,'PT409',null,'Second admin cannot decide resolved appeal');
select pg_temp.login(2);
select is(public.get_my_account_standing()->>'warning_count','2','Overturned warning removed from effective count');
select is(public.get_my_account_standing()->>'suspended','false','Overturn earlier warning invalidates its third-warning suspension');
select lives_ok($$select * from public.get_request_feed()$$,'Existing session recovers after reversal');
select is((select x->'appeal'->>'status' from jsonb_array_elements(public.get_my_moderation_actions()) x where x->>'id'=pg_temp.aid('w1')::text),'overturned','Author sees decision after refresh');
select is(jsonb_array_length(public.get_my_moderation_actions()),3,'Original action history retained');
select pg_temp.login(4);
insert into results values('manual',pg_temp.act(4,'suspend_7_days')),('w4',pg_temp.act(5));
select pg_temp.login(2);
insert into results values('a4',to_jsonb(pg_temp.appeal('w4',5006))),('am',to_jsonb(pg_temp.appeal('manual',5007)));
select pg_temp.login(4);
select pg_temp.resolve('a4',6003);
select pg_temp.login(2);
select is(public.get_my_account_standing()->>'suspended','true','Reversing another third warning does not lift manual suspension');
select is(public.get_my_account_standing()->>'suspended_until',(select value->>'suspended_until' from results where name='manual'),'Independent manual suspension expiry is preserved exactly');
select pg_temp.login(4);
select pg_temp.resolve('am',6004);
select pg_temp.login(2);
select is(public.get_my_account_standing()->>'suspended','false','Reversing last independent suspension restores access');
insert into results values('a2',to_jsonb(pg_temp.appeal('w2',5008)));
select pg_temp.login(4);
select pg_temp.resolve('a2',6005,'upheld');
select pg_temp.login(2);
select is(public.get_my_account_standing()->>'warning_count','2','Upholding leaves warning count unchanged');
select throws_ok($$select pg_temp.appeal('w2',5009)$$,'PT409',null,'Cannot endlessly reopen decided appeal');

reset role;
insert into results values('reviewtime',to_jsonb((select updated_at from course_reviews_private.reviews where id=pg_temp.uid(200))));
set local role authenticated;
select pg_temp.login(4);
insert into results values('hide',pg_temp.act(10,'remove_review',(select (value#>>'{}')::timestamptz from results where name='reviewtime')));
select pg_temp.login(2);
insert into results values('ah',to_jsonb(pg_temp.appeal('hide',5010)));
select is((public.get_course_review_summary('APPEAL 991')->>'review_count'),'0','Hidden review excluded from statistics');
select pg_temp.login(4);
select pg_temp.resolve('ah',6006);
select pg_temp.login(2);
select is((public.get_course_review_summary('APPEAL 991')->>'review_count'),'1','Overturn hide restores current review statistics');
select is(jsonb_array_length(public.get_my_account_standing()->'notices'),0,'Revoked hide does not require acknowledgement');

-- Repeat with a hidden version that the author has replaced before appeal resolution.
reset role;
update safety_private.reports set target_type='course_review',course_review_id=pg_temp.uid(200) where id=pg_temp.uid(1011);
-- Separate fixture action: real enforcement correctly deduplicates the same incident.
insert into safety_private.enforcement_actions(id,report_id,actor_id,subject_id,operation_id,payload_hash,kind,incident_key,reason,warning_count)
 values(pg_temp.uid(7001),pg_temp.uid(1011),pg_temp.uid(4),pg_temp.uid(2),pg_temp.uid(7002),digest('hidden archived fixture','sha256'),
 'remove_review','archived-test','Original hidden archived fixture.',2);
update course_reviews_private.reviews set removed_at=now(),archived_at=now() where id=pg_temp.uid(200);
insert into course_reviews_private.reviews(id,course_code,term_id,author_id,difficulty,workload,recommend,comment)
values(pg_temp.uid(202),'APPEAL 991',pg_temp.uid(301),pg_temp.uid(2),2,3,true,'Newer replacement must not be overwritten.');
insert into results values('archived',jsonb_build_object('action_id',pg_temp.uid(7001)));
set local role authenticated;
select pg_temp.login(2);
insert into results values('aa',to_jsonb(pg_temp.appeal('archived',5011)));
select pg_temp.login(5);
select pg_temp.resolve('aa',6007);
select pg_temp.login(2);
select is((public.get_course_review_summary('APPEAL 991')->>'review_count'),'1','Archived original not republished alongside replacement');
select is((public.get_course_review_summary('APPEAL 991')->'my_reviews'->0->>'comment'),'Newer replacement must not be overwritten.','Replacement text preserved');
select throws_ok($$select public.get_my_moderation_actions(now(),null)$$,'22023',null,'Partial pagination cursor rejected');
reset role;
select is((select count(*)::int from public.notifications where recipient_id=pg_temp.uid(2) and event_type='appeal_decided'),6,'Every appeal outcome has exactly one private notice, including exact retries');
select is((select count(*)::int from public.notifications where recipient_id=pg_temp.uid(2) and title='Appeal decided: decision upheld'),1,'Upheld decision creates its own notice');
select is((select count(*)::int from public.notifications where recipient_id=pg_temp.uid(2) and title='Appeal decided: decision overturned'),5,'Warning, suspension and review reversals all notify');
select ok((select bool_and(n.actor_id is null and n.request_id is null and n.offer_id is null and n.conversation_id is null and n.message_id is null and n.navigation_key='account_notice') from public.notifications n where recipient_id=pg_temp.uid(2) and event_type='appeal_decided'),'Appeal notices contain no private staff or report pointers');
select ok((select bool_and(n.created_at=d.created_at and n.read_at is null) from public.notifications n join safety_private.appeal_decisions d on n.source_event_key='moderation-appeal:'||d.id::text where n.recipient_id=pg_temp.uid(2)),'Decision timestamp preserved and new notices unread');
select notifications_private.copy_appeal_decision(d) from safety_private.appeal_decisions d where d.appeal_id in(select id from safety_private.appeals where appellant_id=pg_temp.uid(2));
select is((select count(*)::int from public.notifications where recipient_id=pg_temp.uid(2) and event_type='appeal_decided'),6,'Historical backfill is idempotent');
select is(notifications_private.push_category('appeal_decided'),null::text,'Appeal results remain bell-only');
select is((select count(*)::int from notifications_private.push_jobs j join public.notifications n on n.id=j.notification_id where n.recipient_id=pg_temp.uid(2) and n.event_type='appeal_decided'),0,'No appeal result OS push jobs are enqueued');
select ok(not has_function_privilege(role,'notifications_private.copy_appeal_decision(safety_private.appeal_decisions)','execute'),role||' cannot manufacture an appeal notice') from unnest(array['anon','authenticated','service_role']) role;
select ok(not has_function_privilege(role,func,'execute'),role||' cannot call '||func) from unnest(array['anon','service_role']) role cross join unnest(array['public.get_my_notifications_v3(integer,timestamptz,uuid)','public.get_my_notification_unread_count_v3()','public.mark_all_my_notifications_read_v3()']) func;
set local role authenticated;
select pg_temp.login(2);
select is((select count(*)::int from public.get_my_notifications_v3() where event_type='appeal_decided'),6,'New app receives all own appeal outcomes');
select is(public.get_my_notification_unread_count_v3()-public.get_my_notification_unread_count_v2(),6,'New badge includes appeal results');
select is((select count(*)::int from public.get_my_notifications_v2() where event_type='appeal_decided'),0,'Older v2 app never receives unknown event type');
select is((select count(*)::int from public.get_my_notifications() where event_type in('account_warning','appeal_decided')),0,'Original app receives only supported types');
select public.mark_all_my_notifications_read();
select public.mark_all_my_notifications_read_v2();
select is(public.get_my_notification_unread_count_v3(),6,'Old mark-all cannot consume invisible appeal notices');
select public.mark_my_notification_read((select id from public.get_my_notifications_v3() where event_type='appeal_decided' limit 1));
select is(public.get_my_notification_unread_count_v3(),5,'Reading one appeal notice decrements the badge');
select is(public.mark_all_my_notifications_read_v3(),5,'New mark-all includes appeal notices');
select is(public.mark_all_my_notifications_read_v3(),0,'Repeated new mark-all is idempotent');
select pg_temp.login(6);
select is((select count(*)::int from public.get_my_notifications_v3()),0,'Another student cannot see appeal notices');
select is(public.get_my_notification_unread_count_v3(),0,'Another student cannot count appeal notices');
reset role;
select notifications_private.copy_appeal_decision(d) from safety_private.appeal_decisions d where d.appeal_id in(select id from safety_private.appeals where appellant_id=pg_temp.uid(2));
select ok((select bool_and(read_at is not null) from public.notifications where recipient_id=pg_temp.uid(2) and event_type='appeal_decided'),'Backfill retry preserves read state');
delete from auth.sessions where user_id=pg_temp.uid(2);
set local role authenticated;
select pg_temp.login(2);
select throws_ok($$select public.get_my_moderation_actions()$$,'42501',null,'Revoked JWT session cannot read private own history');
select throws_ok($$select pg_temp.appeal('w3',5012)$$,'42501',null,'Revoked JWT session cannot submit');
select throws_ok($$select * from public.get_my_notifications_v3()$$,'42501',null,'Revoked session cannot read new notification feed');
select throws_ok($$select public.get_my_notification_unread_count_v3()$$,'42501',null,'Revoked session cannot read new badge');
select throws_ok($$select public.mark_all_my_notifications_read_v3()$$,'42501',null,'Revoked session cannot mark new notices read');
reset role;
select is((select count(*)::int from safety_private.appeal_views where admin_id in(pg_temp.uid(4),pg_temp.uid(5))),1,'Private detail reads audited');
select is((select count(*)::int from safety_private.appeal_decisions where admin_id in(pg_temp.uid(4),pg_temp.uid(5))),6,'Each finalized appeal has exactly one audit decision');
select is((select count(*)::int from public.notifications where recipient_id=pg_temp.uid(2) and title='Warning overturned'),2,'Overturned warnings update their existing bell notices');
update safety_private.enforcement_actions set actor_id=null where id=pg_temp.aid('w1');
set local role authenticated;
select pg_temp.login(5);
select is(public.get_moderation_appeal(pg_temp.apid('a1'))->>'original_admin','false','Deleted original issuer still leaves an accessible audited appeal');
select ok((public.get_moderation_enforcement(pg_temp.uid(1001))->'actions'->0->>'revoked_at') is not null,'Original report history identifies the overturned action');
reset role;
select is((select wallets from preserved),(select jsonb_agg(to_jsonb(w) order by profile_id) from public.points_wallets w),'Wallets unchanged');
select is((select ledger from preserved),(select count(*) from public.points_ledger),'Ledger unchanged');
select is((select requests from preserved),(select jsonb_agg(to_jsonb(r) order by id) from public.requests r),'Requests unchanged');
select * from finish();
rollback;
