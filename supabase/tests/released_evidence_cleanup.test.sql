begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create function pg_temp.u(n integer) returns uuid language sql immutable as $$
  select ('cec10000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.login(n integer) returns void language plpgsql as $$begin
  perform set_config('request.jwt.claim.sub',pg_temp.u(n)::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(n),'role','authenticated','session_id',pg_temp.u(n+1000))::text,true);
end$$;
create function pg_temp.change(action text,n int,h int) returns uuid language sql as $$
  select public.change_retention_hold(action,'notice',pg_temp.u(n),pg_temp.u(h),'Separate disposable access request')
$$;
create function pg_temp.dated(h int,d date) returns uuid language sql as $$
  select public.place_dated_retention_hold('notice',pg_temp.u(10),pg_temp.u(h),'Verified retention deadline',d)
$$;
create function pg_temp.has_batch(n int) returns boolean language sql as $$
  select exists(select from safety_private.deletion_evidence_batches where target_id=pg_temp.u(n))
$$;
create function pg_temp.blocked(n int) returns boolean language sql as $$
  select w.protected or w.eligible_at>statement_timestamp() from safety_private.evidence_cleanup_windows(statement_timestamp()) w
  join safety_private.deletion_evidence_batches b on b.id=w.batch_id where b.target_id=pg_temp.u(n)
$$;
insert into auth.users(id,email,email_confirmed_at)
select pg_temp.u(n),'disposition-'||n||'@tests.local',now() from generate_series(1,3)n;
update public.profiles set display_name='Cleanup test',onboarding_completed_at=now()
where id in(select pg_temp.u(n) from generate_series(1,3)n);
insert into auth.sessions(id,user_id,created_at,updated_at)
select pg_temp.u(n+1000),pg_temp.u(n),now(),now() from generate_series(1,3)n;
select safety_private.assign_staff_role(pg_temp.u(2),'admin',true,'Rollback cleanup test');

insert into safety_private.reports(id,operation_id,target_type,reason,details,payload_hash,evidence,triage_status,created_at)
values(pg_temp.u(40),pg_temp.u(41),'student','spam','',digest('test','sha256'),'{}','dismissed',now()-interval '3 years');
insert into safety_private.report_decisions(report_id,operation_id,payload_hash,from_status,to_status,version,note,created_at)
values(pg_temp.u(40),pg_temp.u(42),digest('test','sha256'),'reviewing','dismissed',1,'Test closure decision',now()-interval '2 years');
insert into safety_private.enforcement_actions(id,report_id,operation_id,payload_hash,kind,incident_key,reason,warning_count,created_at)
values(pg_temp.u(43),pg_temp.u(40),pg_temp.u(44),digest('test','sha256'),'remove_review','disposition','Test action evidence',0,now()-interval '2 years');
insert into safety_private.appeals(id,action_id,operation_id,payload_hash,explanation,created_at)
values(pg_temp.u(45),pg_temp.u(43),pg_temp.u(46),digest('test','sha256'),'Test pending appeal',now()-interval '2 years');
insert into public.notifications(id,recipient_id,event_type,title,body,navigation_key,source_event_key,created_at,read_at)
select pg_temp.u(n),pg_temp.u(1),'message_received','Fixture','Private copy '||n,'conversation','test-disposition-'||n,
  now()-interval '2 years',case when n=11 then now() else now()-interval '4 months' end from generate_series(10,13)n;
insert into public.notifications(id,recipient_id,event_type,title,body,navigation_key,source_event_key,created_at)
values(pg_temp.u(14),pg_temp.u(1),'account_warning','Fixture','Appealable decision','account_notice','moderation-action:'||pg_temp.u(43),now()-interval '2 years');
insert into public.notifications(id,recipient_id,actor_id,event_type,title,body,navigation_key,source_event_key,created_at)
values(pg_temp.u(15),pg_temp.u(3),pg_temp.u(1),'message_received','Fixture','Other recipient','conversation','test-disposition-surviving',now()-interval '2 years');

select ok(not has_function_privilege(role,'safety_private.erase_released_evidence()','execute'),role||' cannot invoke worker')
from unnest(array['anon','authenticated','service_role']) role;
select ok(not has_table_privilege('authenticated','safety_private.retention_deadlines','UPDATE,DELETE,INSERT'),'Client cannot rewrite a retention date');
set local role authenticated;
select pg_temp.login(3);
select throws_ok($$select pg_temp.dated(30,current_date+5)$$,'42501',null,'Student cannot register a dated hold');
select pg_temp.login(2);
select pg_temp.change('place',n,n+20) from generate_series(11,15)n;
select is(pg_temp.dated(30,current_date+5),pg_temp.u(30),'Assigned admin places a dated hold');
select is(pg_temp.dated(30,current_date+5),pg_temp.u(30),'Lost-response retry is idempotent');
select throws_ok($$select pg_temp.dated(30,current_date+4)$$,'PT409',null,'Retry cannot shorten the date');
select is(public.get_retention_holds('notice',pg_temp.u(10))->0->>'through_date',(current_date+5)::text,'Audit history shows through date');
select pg_temp.change('place',12,55);
select pg_temp.login(1);
select is(public.begin_my_account_deletion(pg_temp.u(50),repeat('c',64),'DELETE')->>'accepted','true','Actual account deletion captures held notices');
reset role;
select ok(pg_temp.blocked(12),'Active original hold protects the copy');
set local role authenticated;
select pg_temp.login(2);
select pg_temp.change('release',n,n+20) from generate_series(10,14)n;
-- An independent access request is received after the notice and its original hold have gone.
select is(pg_temp.change('place',13,56),pg_temp.u(56),'New access hold can target retained evidence after source deletion');
select is(public.get_held_deletion_evidence('notice',pg_temp.u(13)),'[]'::jsonb,'Later access hold cannot grant access to old private text');
reset role;
select ok(pg_temp.blocked(13),'Later access request blocks physical erasure');
select ok(pg_temp.blocked(10),'Recorded deadline continues after final release');
select ok(pg_temp.blocked(11),'Recently read notice keeps its 90-day period');
select ok(pg_temp.blocked(14),'Pending appeal protects the linked notice after source deletion');
select safety_private.erase_released_evidence();
select ok(pg_temp.has_batch(12),'Second original hold still protects the actual stored copy');
set local role authenticated;
select pg_temp.login(2);
select pg_temp.change('release',12,55);
select pg_temp.change('release',13,56);
reset role;
select safety_private.erase_released_evidence();
select ok(not pg_temp.has_batch(12) and not pg_temp.has_batch(13),'Final release erases eligible copies on the next sweep');
select ok(not exists(select from safety_private.deletion_evidence_items where fields->>'Text' in ('Private copy 12','Private copy 13')),'Private payload rows are physically removed');
select ok(not exists(select from safety_private.deletion_evidence_coverage where hold_id in(pg_temp.u(32),pg_temp.u(33),pg_temp.u(55),pg_temp.u(56))),'Per-copy coverage is removed');
select is((select count(*) from safety_private.retention_hold_releases x join safety_private.retention_holds h on h.id=x.hold_id
 where h.target_id in(pg_temp.u(12),pg_temp.u(13)) and h.placed_by=pg_temp.u(2) and x.released_by=pg_temp.u(2)
 and h.placed_at<=x.released_at and length(h.reason)>0 and length(x.reason)>0),4::bigint,'Actors, reasons and timestamps survive for all original and later holds');
select ok(pg_temp.has_batch(10) and pg_temp.has_batch(11) and pg_temp.has_batch(14),'Unrelated protected copies survive a sweep');
select is(safety_private.erase_released_evidence(),0,'Repeat sweep makes no duplicate changes');
update public.notifications set read_at=now() where id=pg_temp.u(15);
delete from public.notifications where id=pg_temp.u(15);
set local role authenticated;
select pg_temp.login(2);
select pg_temp.change('release',15,35);
reset role;
select ok(pg_temp.blocked(15),'Later read deadline survives removal of the recipient notice');
select ok((select w.eligible_at=((current_date+6)::timestamp at time zone 'UTC')
 from safety_private.evidence_cleanup_windows(now()) w join safety_private.deletion_evidence_batches b on b.id=w.batch_id
 where b.target_id=pg_temp.u(10)),'Explicit deadline covers the entire UTC date');
update safety_private.retention_deadlines set through_date=current_date-1 where hold_id=pg_temp.u(30);
select safety_private.erase_released_evidence();
select ok(not pg_temp.has_batch(10),'Elapsed date permits cleanup');
update safety_private.appeals set status='upheld',version=1 where id=pg_temp.u(45);
select ok(pg_temp.blocked(14),'Appeal status alone is insufficient without its recorded decision');
insert into safety_private.appeal_decisions(appeal_id,operation_id,payload_hash,outcome,reason,effect)
values(pg_temp.u(45),pg_temp.u(48),digest('test','sha256'),'upheld','Test appeal resolution','unchanged');
select ok(pg_temp.blocked(14),'Final decision starts the test one-year period');
update safety_private.appeal_decisions set created_at=now()-interval '2 years' where appeal_id=pg_temp.u(45);
select safety_private.erase_released_evidence();
select ok(not pg_temp.has_batch(14),'Resolved, aged appeal permits deletion');
select ok(exists(select from safety_private.appeal_decisions where appeal_id=pg_temp.u(45)),'Private-copy erasure preserves the appeal decision');
-- A legacy copy with a missing source cannot prove which case or clock applies.
insert into safety_private.deletion_evidence_batches(id,target_kind,target_id) values(pg_temp.u(90),'notice',pg_temp.u(91));
insert into safety_private.retention_holds(id,target_kind,target_id,placed_by,reason)
values(pg_temp.u(92),'notice',pg_temp.u(91),pg_temp.u(2),'Legacy fixture protection');
insert into safety_private.deletion_evidence_coverage values(pg_temp.u(90),pg_temp.u(92));
insert into safety_private.retention_hold_releases(hold_id,released_by,reason) values(pg_temp.u(92),pg_temp.u(2),'Legacy fixture release');
select ok(pg_temp.blocked(91),'Unclassified legacy evidence stays protected after final release');
-- A backlog is drained in bounded batches without holding application writes for the entire queue.
insert into public.notifications(id,recipient_id,event_type,title,body,navigation_key,source_event_key,created_at)
select pg_temp.u(n),pg_temp.u(3),'message_received','Fixture','Backlog','conversation','fixture-backlog-'||n,now()-interval '2 years'
from generate_series(201,251)n;
insert into safety_private.deletion_evidence_batches(id,target_kind,target_id)
select pg_temp.u(n+1000),'notice',pg_temp.u(n) from generate_series(201,251)n;
insert into safety_private.retention_holds(id,target_kind,target_id,placed_by,reason)
select pg_temp.u(n+2000),'notice',pg_temp.u(n),pg_temp.u(2),'Backlog hold fixture' from generate_series(201,251)n;
insert into safety_private.deletion_evidence_coverage
select pg_temp.u(n+1000),pg_temp.u(n+2000) from generate_series(201,251)n;
insert into safety_private.retention_hold_releases(hold_id,released_by,reason)
select pg_temp.u(n+2000),pg_temp.u(2),'Backlog final release' from generate_series(201,251)n;
select is(safety_private.erase_released_evidence(),50,'Worker limits one transaction to 50 copies');
select is(safety_private.erase_released_evidence(),1,'Next sweep completes the backlog');
select ok(pg_temp.has_batch(91) and pg_temp.has_batch(15),'Unknown history and unelapsed periods survive backlog cleanup');
select * from finish();
rollback;
