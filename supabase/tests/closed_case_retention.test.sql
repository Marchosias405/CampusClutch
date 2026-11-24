begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();
create function pg_temp.k(n int) returns uuid language sql immutable as $$
  select ('ca5e0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.add_case(n int) returns void language plpgsql as $$
begin
  insert into safety_private.reports(id,operation_id,target_type,reason,details,payload_hash,evidence,triage_status,created_at)
  values(pg_temp.k(n),pg_temp.k(n+1000),'student','spam','Private report text',digest('case','sha256'),
    '{"comment":"private evidence"}','dismissed',now()-interval '4 years');
  insert into safety_private.report_decisions(report_id,operation_id,payload_hash,from_status,to_status,version,note,created_at)
  values(pg_temp.k(n),pg_temp.k(n+2000),digest('dismiss','sha256'),'reviewing','dismissed',1,'Resolved fixture',now()-interval '2 years');
end $$;
create function pg_temp.act(n int,kind text,person int) returns void language sql as $$
  insert into safety_private.enforcement_actions(id,report_id,subject_id,operation_id,payload_hash,kind,incident_key,reason,warning_count,created_at)
  values(pg_temp.k(n+3000),pg_temp.k(n),pg_temp.k(person),pg_temp.k(n+3100),digest('action','sha256'),kind,'retention-'||n,
    'Private action reason',1,now()-interval '2 years')
$$;
create function pg_temp.appeal(n int, state text) returns void language sql as $$
  insert into safety_private.appeals(id,action_id,appellant_id,operation_id,payload_hash,explanation,status,version,created_at)
  values(pg_temp.k(n+4000),pg_temp.k(n+3000),pg_temp.k(2),pg_temp.k(n+4100),digest('appeal','sha256'),'Private appeal text',
         state,case when state='pending' then 0 else 1 end,now()-interval '2 years')
$$;
create function pg_temp.outcome(n int, decided timestamptz) returns void language sql as $$
  insert into safety_private.appeal_decisions(id,appeal_id,operation_id,payload_hash,outcome,reason,effect,created_at)
  values(pg_temp.k(n+5000),pg_temp.k(n+4000),pg_temp.k(n+5100),digest('outcome','sha256'),'upheld','Private response','unchanged',decided)
$$;
create function pg_temp.remains(n int) returns boolean language sql as $$
 select exists(select from safety_private.reports where id=pg_temp.k(n))
$$;
create function pg_temp.due(n int) returns timestamptz language sql as $$
 select window_end from safety_private.case_windows(now(),pg_temp.k(n))
$$;
select ok(not has_function_privilege(r,'safety_private.erase_expired_cases()','execute')
  and not has_function_privilege(r,'safety_private.case_windows(timestamptz,uuid)','execute')
  and not has_table_privilege(r,'safety_private.evidence_scopes','select'),r||' has no case retention access')
from unnest(array['anon','authenticated','service_role']) r;
insert into auth.users(id,email,email_confirmed_at)
select pg_temp.k(n),'case-retention-'||n||'@test.local',now() from generate_series(1,5) n;
update public.profiles set display_name='Case fixture',onboarding_completed_at=now()
where id in(select pg_temp.k(n) from generate_series(1,5)n);
insert into auth.sessions(id,user_id,created_at,updated_at) values(pg_temp.k(201),pg_temp.k(1),now(),now());
select safety_private.assign_staff_role(pg_temp.k(1),'admin',true,'Case retention tests');
select pg_temp.add_case(n) from generate_series(100,119)n;
update safety_private.report_decisions set created_at=now()-interval '1 year' where report_id=pg_temp.k(101);
update safety_private.report_decisions set created_at=now()-interval '1 year'+interval '1 day' where report_id=pg_temp.k(102);
update safety_private.reports set triage_status='reviewing' where id=pg_temp.k(103);
update safety_private.reports set triage_status='escalated' where id=pg_temp.k(104);
delete from safety_private.report_decisions where report_id=pg_temp.k(105);
insert into safety_private.report_decisions(report_id,operation_id,payload_hash,from_status,to_status,version,note,created_at)
values(pg_temp.k(106),pg_temp.k(8800),digest('bad closure','sha256'),'dismissed','new',2,'Reopened fixture',now()-interval '2 years');
select pg_temp.act(n,'remove_review',2) from unnest(array[100,107,108,109,110,116]) n;
select pg_temp.appeal(100,'upheld'),pg_temp.appeal(107,'pending'),pg_temp.appeal(108,'upheld'),
       pg_temp.appeal(109,'overturned'),pg_temp.appeal(110,'upheld');
select pg_temp.outcome(100,now()-interval '2 years'),pg_temp.outcome(109,now()-interval '2 years'),pg_temp.outcome(110,now()-interval '3 days');
insert into safety_private.report_views(report_id,created_at) values(pg_temp.k(100),now());
insert into safety_private.appeal_views(appeal_id,created_at) values(pg_temp.k(4100),now());
select pg_temp.act(111,'warn',2),pg_temp.act(112,'suspend_7_days',3);
update safety_private.enforcement_actions set suspended_until=now()+interval '1 day' where id=pg_temp.k(3112);
insert into safety_private.account_standing(profile_id,warning_count) values(pg_temp.k(2),1);
insert into safety_private.retention_holds(id,target_kind,target_id,placed_by,reason)
values(pg_temp.k(701),'case',pg_temp.k(113),pg_temp.k(1),'First access request'),
      (pg_temp.k(702),'case',pg_temp.k(113),pg_temp.k(1),'Second access request'),
      (pg_temp.k(703),'case',pg_temp.k(114),pg_temp.k(1),'Keep through today'),
      (pg_temp.k(704),'case',pg_temp.k(115),pg_temp.k(1),'Private copy coverage');
insert into safety_private.retention_deadlines values(pg_temp.k(703),current_date);
insert into safety_private.retention_hold_releases(hold_id,released_by,reason)
select pg_temp.k(n),pg_temp.k(1),'Access request complete' from unnest(array[701,703,704])n;
insert into safety_private.deletion_evidence_batches(id,target_kind,target_id,last_evidence_view_at)
values(pg_temp.k(800),'case',pg_temp.k(115),now());
insert into safety_private.deletion_evidence_coverage values(pg_temp.k(800),pg_temp.k(704));
insert into safety_private.deletion_evidence_items(batch_id,label,fields) values(pg_temp.k(800),'Fixture','{"detail":"held"}');
insert into safety_private.retention_holds(id,target_kind,target_id,placed_by,reason)
select pg_temp.k(705),'notice',n.id,pg_temp.k(1),'Notification access request'
from safety_private.case_notices n where report_id=pg_temp.k(116);
select pg_temp.act(117,'warn',4),pg_temp.act(118,'warn',5);
update public.profiles set deleted_at=now()-interval '2 years' where id in(pg_temp.k(4),pg_temp.k(5));
insert into account_private.deletions(id,profile_id,receipt_hash,completed_at)
values(pg_temp.k(804),pg_temp.k(4),decode(repeat('ab',32),'hex'),now()-interval '2 years'),
      (pg_temp.k(805),pg_temp.k(5),decode(repeat('ac',32),'hex'),null);
insert into safety_private.direct_action_receipts(actor_id,operation_id,payload_hash,action_id)
values(pg_temp.k(1),pg_temp.k(900),digest('fixture receipt','sha256'),pg_temp.k(3100));
insert into safety_private.staff_recovery_events(operation_id,profile_id,subject_id,kind,reason,database_actor,payload_hash,before_state,after_state,receipt)
values(pg_temp.k(901),pg_temp.k(2),pg_temp.k(2),'review_appeal','Private owner response','postgres',digest('owner','sha256'),
  '{}','{}',jsonb_build_object('id',pg_temp.k(5100))), (pg_temp.k(902),pg_temp.k(2),pg_temp.k(2),'restore_access','Access restored',
  'postgres',digest('restore','sha256'),'{}','{}','{}');
insert into public.notifications(recipient_id,event_type,title,body,navigation_key,source_event_key)
values(pg_temp.k(2),'message_received','Unrelated','A direct message','conversation','case-retention-unrelated');
select is(pg_temp.due(100),now()-interval '1 year','Reading the closed case and appeal does not restart the year');
select is(pg_temp.due(101),now(),'Exact calendar anniversary included');
select is(pg_temp.due(110),now()-interval '3 days'+interval '1 year','Later appeal decision resets the deadline');
select is(pg_temp.due(114),(current_date+1)::timestamp at time zone 'UTC','Released deadline covers the full UTC date');
-- An interruption late in the transaction must also restore earlier child deletes.
create function pg_temp.interrupt() returns trigger language plpgsql as $$begin raise exception 'fixture interruption'; end$$;
create trigger simulate_interrupt before delete on safety_private.reports for each row
  when (old.id='ca5e0000-0000-4000-8000-000000000100') execute function pg_temp.interrupt();
select throws_ok('select safety_private.erase_expired_cases()','P0001','fixture interruption','Unexpected failure rolls back cleanup');
select ok(exists(select from safety_private.appeal_decisions where id=pg_temp.k(5100)) and
  exists(select from safety_private.case_notices where report_id=pg_temp.k(100)),'Decision and bell evidence survive a failed transaction');
drop trigger simulate_interrupt on safety_private.reports;
select is(safety_private.erase_expired_cases(),4,'Only eligible cases expire');
select ok(not pg_temp.remains(n),label) from (values(100,'Closed report and resolved appeal expire'),(101,'Anniversary is eligible'),
  (117,'Warning on a fully deleted account can expire'),(119,'Ordinary closed report expires')) c(n,label);
select ok(pg_temp.remains(n),label) from (values(102,'Before the anniversary'),(103,'Open report'),(104,'Escalated report'),
  (105,'Missing closure audit'),(106,'Conflicting latest decision'),(107,'Pending appeal'),(108,'Missing appeal outcome'),
  (109,'Inconsistent appeal decision'),(110,'Recent appeal outcome'),(111,'Effective warning'),(112,'Active suspension'),
  (113,'Second access request'),(114,'Dated hold'),(115,'Remaining evidence copy'),(116,'Hold on case notice'),
  (118,'Account cleanup still pending')) c(n,label);
select ok(not exists(select from safety_private.enforcement_actions where report_id=pg_temp.k(100))
  and not exists(select from safety_private.appeal_decisions where appeal_id=pg_temp.k(4100))
  and not exists(select from safety_private.appeals where action_id=pg_temp.k(3100))
  and not exists(select from safety_private.appeal_views where appeal_id=pg_temp.k(4100))
  and not exists(select from safety_private.report_views where report_id=pg_temp.k(100))
  and not exists(select from safety_private.report_decisions where report_id=pg_temp.k(100)),'Appeal, decisions and evidence access logs expire together');
select ok(not exists(select from public.notifications where source_event_key in ('moderation-action:'||pg_temp.k(3100),'moderation-appeal:'||pg_temp.k(5100)))
  and exists(select from public.notifications where source_event_key='case-retention-unrelated'),'Only case-derived bell copies expire');
select ok(not exists(select from safety_private.staff_recovery_events where operation_id=pg_temp.k(901))
  and exists(select from safety_private.staff_recovery_events where operation_id=pg_temp.k(902)),'Only the case-specific owner appeal copy expires');
select ok(exists(select from safety_private.direct_action_receipts where operation_id=pg_temp.k(900) and action_id is null and payload_hash is null),
  'Direct action keeps an opaque retry key');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.k(1)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.k(1),'role','authenticated','session_id',pg_temp.k(201))::text,true);
select throws_ok($$select public.take_direct_moderation_action('student',pg_temp.k(2),pg_temp.k(900),'warn','Resubmit expired decision',now())$$,
  'PT410','This decision has expired.','Admin retry cannot recreate an expired sanction');
reset role;
select is((select warning_count from safety_private.account_standing where profile_id=pg_temp.k(2)),1,'Surviving account keeps its warning count');
select is(safety_private.erase_expired_cases(),0,'Immediate retry is idempotent');
select is(safety_private.erase_released_evidence(),1,'Reading a released case copy did not extend its decision clock');
select is(safety_private.erase_expired_cases(),1,'Case can expire after its last private copy is erased');
select ok(exists(select from safety_private.retention_holds h join safety_private.retention_hold_releases x on x.hold_id=h.id
  where h.id=pg_temp.k(704)),'Placement and release audit survive erasure');
-- A later automatic suspension uses prior warnings, including those from other cases.
select pg_temp.add_case(n) from generate_series(140,142)n;
select pg_temp.act(n,'warn',2) from generate_series(140,142)n;
update safety_private.enforcement_actions set automatic_suspension=true,warning_basis=array[pg_temp.k(3140),pg_temp.k(3141),pg_temp.k(3142)],
  created_at=now()-interval '8 days' where id=pg_temp.k(3142);
select is(pg_temp.due(140),now()-interval '8 days'+interval '1 year','Use of a warning in a later sanction extends the source case');
select is(pg_temp.due(111),now()-interval '8 days'+interval '1 year','Earlier warning that contributes to the count also gets the new decision clock');
select pg_temp.appeal(142,'upheld'),pg_temp.outcome(142,now()-interval '1 day');
select is(pg_temp.due(140),now()-interval '1 day'+interval '1 year','Later appeal of that sanction extends its warning evidence');
select pg_temp.add_case(143);
insert into public.requests(id,owner_id,category,title,description,campus_id,room_location,deadline_at,points,item_size)
values(pg_temp.k(8143),pg_temp.k(2),'delivery','Case fixture','Linked case fixture',(select id from public.campuses limit 1),
  'A',now()+interval '1 day',5,'small');
insert into public.delivery_request_details(request_id,pickup_location,dropoff_location) values(pg_temp.k(8143),'A','B');
update safety_private.reports set target_type='request',request_id=pg_temp.k(8143) where id=pg_temp.k(143);
insert into safety_private.retention_holds(id,target_kind,target_id,placed_by,reason)
values(pg_temp.k(7143),'job',pg_temp.k(8143),pg_temp.k(1),'Access to job evidence');
select is(safety_private.erase_expired_cases(),0,'Hold on underlying job protects its report');
insert into safety_private.retention_hold_releases(hold_id,released_by,reason)
values(pg_temp.k(7143),pg_temp.k(1),'Access request completed');
select is(safety_private.erase_expired_cases(),1,'Release permits expiry when case and source requirements are satisfied');
select is((select resolved_at from safety_private.job_dispute_clocks where request_id=pg_temp.k(8143)),now()-interval '2 years',
  'Case cleanup preserves the latest dispute date for surviving shared job history');
select pg_temp.add_case(n) from generate_series(6000,6050)n;
select is(safety_private.erase_expired_cases(),50,'Each sweep is bounded');
select is(safety_private.erase_expired_cases(),1,'Next sweep completes the remaining batch');
select * from finish();
rollback;
