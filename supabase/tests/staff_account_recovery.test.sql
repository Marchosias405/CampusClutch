begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.uid(i integer) returns uuid language sql immutable as $$
 select ('ec14ac00-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid; $$;
create function pg_temp.login(i integer) returns void language plpgsql as $$ begin
 perform set_config('request.jwt.claim.sub',pg_temp.uid(i)::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(i),'role','authenticated','session_id',pg_temp.uid(i+100))::text,true);
end $$;
create temp table results(name text primary key,value jsonb);
grant all on results to authenticated;
insert into auth.users(id,email,email_confirmed_at)
 select pg_temp.uid(n),'recovery-'||n||'@tests.local',now() from generate_series(1,9) n;
update public.profiles set display_name='Recovery fixture',onboarding_completed_at=now(),is_discoverable=true
 where id in(select pg_temp.uid(n) from generate_series(1,9) n);
insert into auth.sessions(id,user_id,created_at,updated_at)
 select pg_temp.uid(n+100),pg_temp.uid(n),now(),now() from generate_series(1,9) n;
select safety_private.assign_staff_role(pg_temp.uid(3),'admin',true,'Rollback only issuing admin');
select safety_private.assign_staff_role(pg_temp.uid(4),'moderator',false,'Rollback only disabled moderator');
insert into results values('stamp4',to_jsonb((select updated_at from safety_private.staff_roles where profile_id=pg_temp.uid(4))));
create function pg_temp.stamp(n integer) returns timestamptz language sql as $$
 select (value#>>'{}')::timestamptz from results where name='stamp'||n::text; $$;
create function pg_temp.restore(n integer,op integer) returns jsonb language sql as $$
 select safety_private.owner_restore_staff_access(pg_temp.uid(n),pg_temp.uid(op),pg_temp.stamp(n),'Owner verified identity and recovered access.'); $$;
create function pg_temp.action(n text) returns uuid language sql as $$ select (value->>'action_id')::uuid from results where name=n; $$;
create function pg_temp.appeal(n text) returns uuid language sql as $$ select (value#>>'{}')::uuid from results where name=n; $$;
create function pg_temp.decide(n text,op integer,outcome text default 'overturned') returns jsonb language sql as $$
 select safety_private.owner_review_staff_appeal(pg_temp.appeal(n),pg_temp.uid(op),0,pg_temp.stamp(2),outcome,'The owner reviewed the evidence and explanation.'); $$;
create temp table preserved as select
 (select jsonb_agg(to_jsonb(w) order by profile_id) from public.points_wallets w) wallets,
 (select jsonb_agg(to_jsonb(l) order by id) from public.points_ledger l) ledger,
 (select jsonb_agg(to_jsonb(r) order by id) from public.requests r) requests,
 (select jsonb_agg(to_jsonb(r) order by id) from course_reviews_private.reviews r) reviews;

select ok((select relrowsecurity from pg_class where oid='safety_private.staff_recovery_events'::regclass),'Recovery audit has RLS');
select ok(not has_table_privilege(role,'safety_private.staff_recovery_events','SELECT,INSERT,UPDATE,DELETE'),role||' cannot read or change recovery audit')
 from unnest(array['anon','authenticated','service_role']) role;
select ok(not has_function_privilege(role,p.oid,'execute'),role||' cannot execute '||p.proname)
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join unnest(array['anon','authenticated','service_role']) role
 where n.nspname='safety_private' and p.proname in('staff_recovery_snapshot','owner_restore_staff_access','owner_review_staff_appeal');
select ok(not p.prosecdef and p.proconfig @> array['search_path=""'],'Owner helper is invoker with empty search path: '||p.proname)
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='safety_private' and p.proname in('staff_recovery_snapshot','owner_restore_staff_access','owner_review_staff_appeal');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'owner_%'),0,'No public recovery RPC');
set local role authenticated;
select pg_temp.login(3);
select throws_ok($$select pg_temp.restore(4,401)$$,'42501',null,'Even an assigned admin cannot call owner recovery');
select throws_ok($$select safety_private.owner_review_staff_appeal(pg_temp.uid(1),pg_temp.uid(2),0,now(),'overturned','A forged owner action here.')$$,'42501',null,'Admin cannot call owner review');
select throws_ok($$select * from safety_private.staff_recovery_events$$,'42501',null,'Recovery details are not student-readable');
reset role;
insert into results values('restore4',pg_temp.restore(4,401));
select is((select value->>'role' from results where name='restore4'),'moderator','Recovery preserves the assigned moderator role');
select is((select value->>'sessions_revoked' from results where name='restore4'),'1','Old sessions revoked');
select is((select count(*)::int from auth.sessions where user_id=pg_temp.uid(4)),0,'No old session remains');
select is(pg_temp.restore(4,401),(select value from results where name='restore4'),'Exact retry returns same receipt');
set local timezone='America/Vancouver';
select is(pg_temp.restore(4,401),(select value from results where name='restore4'),'Exact retry survives a database timezone change');
set local timezone='UTC';
select is((select count(*)::int from safety_private.staff_recovery_events where operation_id=pg_temp.uid(401)),1,'One recovery audit for retry');
select ok((select database_actor=current_user and before_state#>>'{role,enabled}'='false'
 and after_state#>>'{role,enabled}'='true' from safety_private.staff_recovery_events where operation_id=pg_temp.uid(401)),'Owner and before/after role recorded');
select throws_ok($$select safety_private.owner_restore_staff_access(pg_temp.uid(4),pg_temp.uid(401),pg_temp.stamp(4),'Different recovery reason here.')$$,'22023',null,'Retry payload cannot change');
select throws_ok($$select pg_temp.restore(4,402)$$,'PT409',null,'Stale role version rejected');
set local role authenticated;
select pg_temp.login(4);
select is(public.get_my_moderation_access()->'role','null'::jsonb,'Old JWT cannot reuse restored moderation access');
reset role;
insert into auth.sessions(id,user_id,created_at,updated_at) values(pg_temp.uid(104),pg_temp.uid(4),now(),now());
set local role authenticated;
select is(public.get_my_moderation_access()->>'role','moderator','Fresh session restores only the original role');
reset role;
select safety_private.assign_staff_role(pg_temp.uid(4),'moderator',false,'Owner revoked access after recovery');
select is(pg_temp.restore(4,401),(select value from results where name='restore4'),'Old successful retry cannot undo later revocation');
select is((select enabled from safety_private.staff_roles where profile_id=pg_temp.uid(4)),false,'Later role revocation preserved');
select is((select count(*)::int from auth.sessions where user_id=pg_temp.uid(4)),1,'Retry does not log out a fresh session');
select throws_ok($$select safety_private.owner_restore_staff_access(pg_temp.uid(5),pg_temp.uid(501),now(),'An ordinary account must stay ordinary.')$$,'42501',null,'No staff creation through recovery');
select is((select count(*)::int from auth.sessions where user_id=pg_temp.uid(5)),1,'Failed recovery rolls session deletion back');
select throws_ok($$select safety_private.owner_restore_staff_access(null,pg_temp.uid(502),now(),'Valid reason but missing identity.')$$,'22023',null,'Missing identity rejected');
select throws_ok($$select safety_private.owner_restore_staff_access(pg_temp.uid(4),pg_temp.uid(502),now(),'short')$$,'22023',null,'Reason required');
select throws_ok($$select safety_private.owner_restore_staff_access(pg_temp.uid(4),pg_temp.uid(502),'infinity','Invalid timestamp must be rejected.')$$,'22023',null,'Infinite version rejected');
update auth.users set email_confirmed_at=null where id=pg_temp.uid(6);
update public.profiles set onboarding_completed_at=null where id=pg_temp.uid(7);
update auth.users set banned_until=now()+interval '1 day' where id=pg_temp.uid(8);
update auth.users set deleted_at=now() where id=pg_temp.uid(9);
select throws_ok(format('select safety_private.owner_restore_staff_access(%L,%L,now(),%L)',pg_temp.uid(n),pg_temp.uid(600+n),'Recovery requires an eligible account.'),'42501',null,'Ineligible account denied: '||n)
 from generate_series(6,9) n;

insert into safety_private.reports(id,reporter_id,reported_profile_id,operation_id,target_type,reason,details,payload_hash,evidence,triage_status)
 select pg_temp.uid(1000+n),pg_temp.uid(1),pg_temp.uid(2),gen_random_uuid(),'student','spam','',digest(n::text,'sha256'),'{}','escalated' from generate_series(1,4) n;
set local role authenticated;
select pg_temp.login(3);
insert into results select 'w'||n,public.enforce_moderation_report(pg_temp.uid(1000+n),pg_temp.uid(2000+n),0,'warn','Original warning reason for this incident.',null) from generate_series(1,3) n;
insert into results values('s1',public.enforce_moderation_report(pg_temp.uid(1004),pg_temp.uid(2004),0,'suspend_7_days','Independent manual suspension for this incident.',null));
select pg_temp.login(2);
insert into results select 'a'||n,to_jsonb(public.submit_moderation_appeal(pg_temp.action('w'||n),pg_temp.uid(3000+n),'Please reconsider the warning with this context.')) from generate_series(1,2) n;
insert into results values('as1',to_jsonb(public.submit_moderation_appeal(pg_temp.action('s1'),pg_temp.uid(3004),'Please reconsider the manual suspension.')));
reset role;
select safety_private.assign_staff_role(pg_temp.uid(2),'admin',true,'Historic staff assignment requiring owner review');
insert into results values('stamp2',to_jsonb((select updated_at from safety_private.staff_roles where profile_id=pg_temp.uid(2))));
select throws_ok($$select safety_private.owner_review_staff_appeal(pg_temp.uid(9999),pg_temp.uid(409),0,pg_temp.stamp(2),'overturned','Unknown appeals cannot be recovered.')$$,'42501',null,'Unknown appeal denied');
select throws_ok($$select safety_private.owner_review_staff_appeal(pg_temp.appeal('a1'),pg_temp.uid(409),0,pg_temp.stamp(2)-interval '1 second','overturned','Stale owner review must be rejected.')$$,'PT409',null,'Owner review requires the inspected staff version');
select throws_ok($$select safety_private.owner_review_staff_appeal(pg_temp.appeal('a1'),pg_temp.uid(409),1,pg_temp.stamp(2),'overturned','Stale appeal must be rejected.')$$,'PT409',null,'Owner review requires the inspected appeal version');
select throws_ok($$select safety_private.owner_review_staff_appeal(pg_temp.appeal('a1'),pg_temp.uid(409),0,pg_temp.stamp(2),'erase','Unsupported decision must be rejected.')$$,'22023',null,'Unsupported decision denied');
select throws_ok($$select pg_temp.restore(2,410)$$,'42501',null,'Restoring role cannot bypass active suspension');
select is((select count(*)::int from auth.sessions where user_id=pg_temp.uid(2)),1,'Suspended staff can still sign in and appeal after denied restore');
set local role authenticated;
select pg_temp.login(3);
select throws_ok($$select public.resolve_moderation_appeal(pg_temp.appeal('a1'),pg_temp.uid(411),0,'overturned','An admin cannot decide a staff sanction.')$$,'42501',null,'Ordinary admin still excluded from staff recovery');
reset role;
insert into results values('d1',pg_temp.decide('a1',412));
select is(pg_temp.decide('a1',412),(select value from results where name='d1'),'Owner appeal exact retry returns original decision');
select throws_ok($$select pg_temp.decide('a1',412,'upheld')$$,'22023',null,'Owner appeal retry cannot change outcome');
select throws_ok($$select pg_temp.decide('a1',413)$$,'PT409',null,'Final appeal cannot be decided again');
select is((select warning_count from safety_private.account_standing where profile_id=pg_temp.uid(2)),2,'Only the overturned warning stops counting');
select ok((select suspended_until>now() from safety_private.account_standing where profile_id=pg_temp.uid(2)),'Independent suspension stays in effect');
select is((select count(*)::int from public.notifications where recipient_id=pg_temp.uid(2) and event_type='appeal_decided'),1,'One bell notice for owner appeal decision');
select ok((select admin_id is null and database_actor=current_user from safety_private.appeal_decisions where operation_id=pg_temp.uid(412)),'Owner decision records database actor without fabricating app admin');
select is(pg_temp.decide('a2',414,'upheld')->>'outcome','upheld','Owner may uphold a staff appeal');
select ok((select revoked_at is null from safety_private.enforcement_actions where id=pg_temp.action('w2')),'Upheld warning unchanged');
select is(pg_temp.decide('as1',415)->>'outcome','overturned','Owner may overturn the specific manual suspension');
select ok((select suspended_until is null from safety_private.account_standing where profile_id=pg_temp.uid(2)),'Invalidated automatic suspension does not reappear');
select lives_ok($$select pg_temp.restore(2,416)$$,'Eligible staff access restored after explicit appeal resolution');
select is((select count(*)::int from auth.sessions where user_id=pg_temp.uid(2)),0,'Recovered admin must sign in again');
insert into auth.sessions(id,user_id,created_at,updated_at) values(pg_temp.uid(102),pg_temp.uid(2),now(),now());
set local role authenticated;
select pg_temp.login(2);
select is(public.get_my_moderation_access()->>'role','admin','Recovered admin can access moderation with fresh session');
select is(public.get_my_account_standing()->>'warning_count','2','App sees the correct remaining warning count');
select ok(public.get_my_moderation_actions()::text like '%The owner reviewed the evidence%','App sees owner decision explanation');
select ok(public.get_my_moderation_actions()::text not like '%database_actor%','Database actor stays private');
reset role;
select is((select wallets from preserved),(select jsonb_agg(to_jsonb(w) order by profile_id) from public.points_wallets w),'Wallets unchanged');
select is((select ledger from preserved),(select jsonb_agg(to_jsonb(l) order by id) from public.points_ledger l),'Ledger unchanged');
select is((select requests from preserved),(select jsonb_agg(to_jsonb(r) order by id) from public.requests r),'Requests unchanged');
select is((select reviews from preserved),(select jsonb_agg(to_jsonb(r) order by id) from course_reviews_private.reviews r),'Review history unchanged');
select * from finish();
rollback;
