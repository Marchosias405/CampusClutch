begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create function pg_temp.uid(i int) returns uuid language sql immutable as $$
  select ('deca1100-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid
$$;
create function pg_temp.login(i int) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub',pg_temp.uid(i)::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(i),'role','authenticated','session_id',pg_temp.uid(i+100))::text,true);
end $$;
insert into auth.users(id,email,email_confirmed_at)
select pg_temp.uid(i),'hold-'||i||'@tests.local',now() from generate_series(1,4) i;
update public.profiles set display_name='Retention fixture',onboarding_completed_at=now()
where id in (select pg_temp.uid(i) from generate_series(1,4) i);
insert into auth.sessions(id,user_id,created_at,updated_at)
select pg_temp.uid(i+100),pg_temp.uid(i),now(),now() from generate_series(1,4) i;
select safety_private.assign_staff_role(pg_temp.uid(2),'moderator',true,'Disposable moderator assignment');
select safety_private.assign_staff_role(pg_temp.uid(3),'admin',true,'Disposable admin assignment');
select safety_private.assign_staff_role(pg_temp.uid(4),'admin',true,'Second fixture admin');
insert into public.conversations(id,created_by,type) values(pg_temp.uid(20),pg_temp.uid(1),'direct');
insert into safety_private.reports(id,reporter_id,operation_id,target_type,reported_profile_id,reason,details,payload_hash,evidence)
values(pg_temp.uid(21),pg_temp.uid(1),pg_temp.uid(210),'student',pg_temp.uid(4),'spam','',decode(repeat('00',32),'hex'),'{}');
create function pg_temp.change(a text,op int,why text default 'Checking the open dispute') returns uuid language sql as $$
  select public.change_retention_hold(a,'thread',pg_temp.uid(20),pg_temp.uid(op),why)
$$;
select ok(not has_table_privilege(role,tbl,'SELECT, INSERT, UPDATE, DELETE, TRUNCATE'),role||' has no direct access to '||tbl)
from unnest(array['anon','authenticated','service_role']) role
cross join unnest(array['safety_private.retention_holds','safety_private.retention_hold_releases']) tbl;
select ok(not has_function_privilege(role,func,'execute'),role||' cannot call '||func)
from unnest(array['anon','service_role']) role cross join unnest(array[
 'public.change_retention_hold(text,text,uuid,uuid,text)','public.get_retention_holds(text,uuid)',
 'safety_private.change_retention_hold(text,text,uuid,uuid,text)','safety_private.retention_hold_history(text,uuid)']) func;
set local role authenticated;
select pg_temp.login(1);
select throws_ok($$select pg_temp.change('place',31)$$,'42501',null,'Student cannot place a hold');
select throws_ok($$select pg_temp.change('release',31)$$,'42501',null,'Student cannot release a hold');
select throws_ok($$select public.get_retention_holds('thread',pg_temp.uid(20))$$,'42501',null,'Cannot read audit as student');
select pg_temp.login(2);
select throws_ok($$select pg_temp.change('place',31)$$,'42501',null,'Moderator cannot place a hold');
select throws_ok($$select pg_temp.change('release',31)$$,'42501',null,'Moderator cannot release a hold');
select throws_ok($$select public.get_retention_holds('thread',pg_temp.uid(20))$$,'42501',null,'Moderator cannot read reasons');
select pg_temp.login(3);
select is(public.change_retention_hold('place','case',pg_temp.uid(21),pg_temp.uid(33),'Retain case for review'),pg_temp.uid(33),'Admin can hold a case');
select throws_ok($$select pg_temp.change('place',31,E'   \n\t         ')$$,'22023',null,'A blank reason is rejected');
select throws_ok($$select public.change_retention_hold('place','case',pg_temp.uid(70),pg_temp.uid(31),'No such target exists')$$,'PT404',null,'Missing record rejected');
select throws_ok($$select public.change_retention_hold('place','unknown',pg_temp.uid(20),pg_temp.uid(31),'Choose a real record')$$,'22023',null,'Unsupported target rejected');
select is(pg_temp.change('place',31),pg_temp.uid(31),'Assigned admin places hold');
select is(pg_temp.change('place',31),pg_temp.uid(31),'A retry returns the same placement');
select throws_ok($$select pg_temp.change('place',31,'Changed placement explanation')$$,'PT409',null,'Cannot rewrite original placement');
select is(pg_temp.change('place',32,'Separate open access request'),pg_temp.uid(32),'Independent second hold allowed');
select pg_temp.login(4);
select throws_ok($$select public.get_retention_holds('case',pg_temp.uid(21))$$,'PT404',null,'Case conflict protects hold history');
select throws_ok($$select public.change_retention_hold('release','case',pg_temp.uid(21),pg_temp.uid(33),'Release the case hold')$$,'PT404',null,'Conflicted admin cannot change case hold');
select throws_ok($$select pg_temp.change('release',31,'  ')$$,'22023',null,'Release requires an explanation');
select throws_ok($$select public.change_retention_hold('release','job',pg_temp.uid(20),pg_temp.uid(31),'Dispute is resolved')$$,'PT404',null,'Release checks target type');
select is(pg_temp.change('release',31,'Dispute is resolved'),pg_temp.uid(31),'Another assigned admin can release one hold');
select is(pg_temp.change('release',31,'Dispute is resolved'),pg_temp.uid(31),'Release retry is idempotent');
select throws_ok($$select pg_temp.change('release',31,'A different explanation')$$,'PT409',null,'Cannot replace a recorded release');
select pg_temp.login(3);
select is(pg_temp.change('place',31),pg_temp.uid(31),'Delayed retry of placement does not reopen hold');
select is(jsonb_array_length(public.get_retention_holds('thread',pg_temp.uid(20))),2,'History contains exactly two holds');
select is(public.get_retention_holds('thread',pg_temp.uid(20))#>>'{0,id}',pg_temp.uid(32)::text,'Independent hold stays active');
select ok(exists(select from jsonb_array_elements(public.get_retention_holds('thread',pg_temp.uid(20))) a
 where a->>'placed_by'=pg_temp.uid(3)::text and a->>'released_by'=pg_temp.uid(4)::text
 and a->>'reason'='Checking the open dispute' and a->>'release_reason'='Dispute is resolved'
 and (a->>'placed_at')::timestamptz between transaction_timestamp() and clock_timestamp()
 and (a->>'released_at')::timestamptz between (a->>'placed_at')::timestamptz and clock_timestamp()),'Audit records both actors, server times and reasons');
reset role;
select safety_private.assign_staff_role(pg_temp.uid(3),'admin',false,'Hold fixture role revocation');
delete from auth.sessions where id=pg_temp.uid(104);
set local role authenticated;
select pg_temp.login(3);
select throws_ok($$select pg_temp.change('release',32)$$,'42501',null,'Revoked admin cannot release');
select pg_temp.login(4);
select throws_ok($$select public.get_retention_holds('thread',pg_temp.uid(20))$$,'42501',null,'Expired admin session cannot inspect history');
select * from finish();
rollback;
