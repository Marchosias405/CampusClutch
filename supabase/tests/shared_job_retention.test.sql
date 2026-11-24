begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();
create function pg_temp.k(n int) returns uuid language sql immutable as $$
  select ('bab00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.make_job(n int, owner_no int default 1, state text default 'completed') returns void language plpgsql as $$
begin
  insert into public.requests(id,owner_id,category,title,description,campus_id,room_location,deadline_at,
    points,item_size,status,created_at,updated_at,completed_at)
  values(pg_temp.k(n),pg_temp.k(owner_no),'delivery','Fixture job','Synthetic expired job',(select id from public.campuses limit 1),
    'Fixture',now()-interval '3 years',5,'small',state,now()-interval '4 years',now()-interval '3 years',
    case when state='completed' then now()-interval '3 years' end);
  insert into public.delivery_request_details(request_id,pickup_location,dropoff_location) values(pg_temp.k(n),'A','B');
end $$;
create function pg_temp.remains(n int) returns boolean language sql as $$
  select exists(select from public.requests where id=pg_temp.k(n))
$$;
create function pg_temp.deadline(n int) returns timestamptz language sql as $$
  select window_end from safety_private.shared_job_windows(now(),pg_temp.k(n))
$$;
select ok(not has_function_privilege(r,'safety_private.erase_expired_jobs()','execute')
  and not has_table_privilege(r,'safety_private.job_dispute_clocks','select'),r||' cannot run cleanup or read dispute clocks')
  from unnest(array['anon','authenticated','service_role']) r;
insert into auth.users(id,email,email_confirmed_at)
select pg_temp.k(n),'job-retention-'||n||'@test.local',now() from generate_series(1,7) n;
insert into account_private.deletions(id,profile_id,receipt_hash,completed_at)
select pg_temp.k(50+n),pg_temp.k(n),decode(repeat('ab',32),'hex'),
  case when n=5 then null when n=6 then now()-interval '1 year'+interval '1 day'
       when n=7 then now()-interval '1 year' else now()-interval '2 years' end
from unnest(array[1,2,3,5,6,7]) n;
update public.profiles set deleted_at=now()-interval '3 years' where id in
  (select pg_temp.k(n) from unnest(array[1,2,3,5,6,7]) n);
select pg_temp.make_job(n,case n when 103 then 5 when 104 then 6 when 105 then 7 else 1 end,
  case when n=106 then 'open' else 'completed' end) from generate_series(100,119) n;
-- A withdrawn offer from an earlier round still makes its author a participant.
insert into public.request_offers(id,request_id,offering_user_id,status,withdrawn_at,created_at,updated_at)
select pg_temp.k(n+1000),pg_temp.k(n),pg_temp.k(case when n=102 then 4 else 2 end),'withdrawn',
  now()-interval '3 years',now()-interval '3 years',now()-interval '3 years' from unnest(array[101,102,108,117]) n;
insert into public.request_offers(request_id,offering_user_id,status)
values(pg_temp.k(107),pg_temp.k(2),'pending');
update public.offer_notifications set created_at=now()-interval '3 years' where request_id in
  (select pg_temp.k(n) from unnest(array[101,102,108,117]) n);
update public.request_offer_history set recorded_at=now()-interval '3 years' where offer_id in
  (select pg_temp.k(n+1000) from unnest(array[101,102,108,117]) n);
insert into public.request_offer_history(offer_id,offer_round,status,recorded_at)
values(pg_temp.k(1108),1,'rejected',now()-interval '3 days');
insert into public.request_point_reservations(request_id,offer_round,poster_id,helper_id,amount,status,created_at,settled_at)
select pg_temp.k(n),1,pg_temp.k(1),pg_temp.k(2),5,case when n=109 then 'reserved' else 'settled' end,
  now()-interval '3 years',case when n<>109 then now()-interval '2 years' end
from unnest(array[101,109,114,115,119]) n;
insert into public.request_ratings(request_id,offer_round,rater_id,ratee_id,score,created_at,published_at)
select pg_temp.k(n),1,pg_temp.k(1),pg_temp.k(2),5,now()-interval '2 years',
       case when n=119 then now()-interval '2 days' else now()-interval '2 years' end from unnest(array[101,119]) n;
insert into public.points_ledger(profile_id,kind,amount,request_id,offer_round,created_at)
values(pg_temp.k(1),'request_sent',-5,pg_temp.k(110),1,now()-interval '2 years');
delete from public.notifications where request_id in(select pg_temp.k(n) from generate_series(100,119) n);
insert into public.notifications(recipient_id,event_type,title,body,navigation_key,source_event_key,offer_id)
values(pg_temp.k(4),'offer_created','Offer','Fixture offer','request_details','job-retention-notice',pg_temp.k(1117));
insert into safety_private.retention_holds(id,target_kind,target_id,placed_by,reason)
select pg_temp.k(800+n),'job',pg_temp.k(n),pg_temp.k(4),'Test access request' from unnest(array[111,112]) n;
insert into safety_private.retention_deadlines(hold_id,through_date) values(pg_temp.k(912),current_date);
insert into safety_private.retention_hold_releases(hold_id,released_by,reason)
values(pg_temp.k(912),pg_temp.k(4),'Completed access request');
insert into safety_private.deletion_evidence_batches(target_kind,target_id,notice_request_id)
values('job',pg_temp.k(113),null),('notice',pg_temp.k(9000),pg_temp.k(118));

insert into public.conversations(id,type,status,created_by)
select pg_temp.k(500+n),'direct','closed',pg_temp.k(1) from unnest(array[114,115]) n;
insert into public.direct_conversation_pairs(conversation_id,user_low_id,user_high_id)
select pg_temp.k(500+n),pg_temp.k(1),pg_temp.k(case n when 114 then 2 else 3 end) from unnest(array[114,115]) n;
insert into public.conversation_members(conversation_id,profile_id)
select pg_temp.k(500+n),pg_temp.k(u) from (values(114,1),(114,2),(115,1),(115,3)) p(n,u);
insert into public.messages(id,conversation_id,sender_id,client_message_id,sequence,body,created_at)
select pg_temp.k(600+n),pg_temp.k(500+n),pg_temp.k(1),pg_temp.k(700+n),1,'Fixture',now()-interval '2 years'
from unnest(array[114,115]) n;
insert into public.request_conversations(request_id,offer_round,conversation_id,poster_id,helper_id)
select pg_temp.k(n),1,pg_temp.k(500+n),pg_temp.k(1),pg_temp.k(case n when 114 then 2 else 3 end) from unnest(array[114,115]) n;
delete from public.notifications where conversation_id in(pg_temp.k(614),pg_temp.k(615));
insert into safety_private.reports(id,operation_id,target_type,request_id,message_id,reason,details,payload_hash,evidence,triage_status)
values(pg_temp.k(2115),pg_temp.k(3115),'message',null,pg_temp.k(715),'spam','',digest('fixture','sha256'),'{}','dismissed'),
      (pg_temp.k(2116),pg_temp.k(3116),'request',pg_temp.k(116),null,'spam','',digest('fixture','sha256'),'{}','dismissed');
insert into safety_private.report_decisions(report_id,operation_id,payload_hash,from_status,to_status,version,note,created_at)
select pg_temp.k(2000+n),pg_temp.k(4000+n),digest('fixture','sha256'),'reviewing','dismissed',1,'Fixture decision',
  now()-interval '7 days' from unnest(array[115,116]) n;
insert into safety_private.enforcement_actions(id,report_id,operation_id,payload_hash,kind,incident_key,reason,warning_count,created_at)
values(pg_temp.k(400),pg_temp.k(2116),pg_temp.k(401),digest('action','sha256'),'warn','test-job','Fixture warning',1,now()-interval '2 years');
insert into safety_private.appeals(id,action_id,operation_id,payload_hash,explanation,status,version)
values(pg_temp.k(402),pg_temp.k(400),pg_temp.k(403),digest('appeal','sha256'),'Fixture appeal','upheld',1);
insert into safety_private.appeal_decisions(appeal_id,operation_id,payload_hash,outcome,reason,effect,created_at)
values(pg_temp.k(402),pg_temp.k(404),digest('outcome','sha256'),'upheld','Fixture outcome','unchanged',now()-interval '1 day');
select is(pg_temp.deadline(105),now(),'The last completed deletion starts the calendar year, including equality');
select is(pg_temp.deadline(108),now()-interval '3 days'+interval '1 year','A later offer round extends the clock');
select is(pg_temp.deadline(119),now()-interval '2 days'+interval '1 year','Later rating publication extends the clock');
select is(pg_temp.deadline(115),now()-interval '7 days'+interval '1 year','Reported job message contributes its dispute outcome');
select is(pg_temp.deadline(116),now()-interval '1 day'+interval '1 year','Final appeal supersedes earlier case and job dates');
select is(pg_temp.deadline(112),(current_date+1)::timestamp at time zone 'UTC','Released keep-through covers the entire UTC day');
-- Exercise the same child-first order a case cleanup must use. Keep the date without retaining the case.
delete from safety_private.appeal_decisions where appeal_id=pg_temp.k(402);
delete from safety_private.appeals where id=pg_temp.k(402);
delete from safety_private.enforcement_actions where id=pg_temp.k(400);
delete from safety_private.report_decisions where report_id=pg_temp.k(2116);
delete from safety_private.reports where id=pg_temp.k(2116);
select is(pg_temp.deadline(116),now()-interval '1 day'+interval '1 year','Removing the case cannot shorten the final dispute clock');

insert into points_private.returning_balances(email_fingerprint,balance) values(digest('saved job balance','sha256'),47);
create function pg_temp.interrupt_job() returns trigger language plpgsql as $$
begin raise exception 'fixture interruption'; end $$;
create trigger interrupted_cleanup before delete on public.requests for each row
  when (old.id='bab00000-0000-4000-8000-000000000114') execute function pg_temp.interrupt_job();
select throws_ok('select safety_private.erase_expired_jobs()','P0001','fixture interruption','Unexpected error rolls back the sweep');
select ok(exists(select from public.request_conversations where request_id=pg_temp.k(114)) and pg_temp.remains(101),
  'Interrupted cleanup restores both the chat association and earlier jobs in the transaction');
drop trigger interrupted_cleanup on public.requests;
select is(safety_private.erase_expired_jobs(),4,'Only the four eligible jobs expire');
select ok(not pg_temp.remains(n),label) from (values(100,'Old job expires'),(101,'Old job with settled history expires'),
  (105,'Exact anniversary expires'),(114,'Ordinary job chat releases its job link')) v(n,label);
select ok(pg_temp.remains(n),label) from (values(102,'A surviving earlier helper keeps the job'),(103,'Incomplete cleanup keeps the job'),
  (104,'Less than one year elapsed'),(106,'Open job remains'),(107,'Pending offer remains'),(108,'Recent offer activity remains'),
  (109,'Reserved points remain'),(110,'Ledger-backed job remains'),(111,'Open access hold remains'),(112,'Dated hold remains'),
  (113,'Job evidence keeps its source'),(115,'Retained message report keeps the chat and job'),
  (116,'Later appeal date still governs after case removal'),(117,'Offer-only notice keeps its job'),
  (118,'Retained notice evidence keeps the job'),(119,'Recent rating remains')) v(n,label);
select ok(not exists(select from public.request_offer_history where offer_id=pg_temp.k(1101))
  and not exists(select from public.request_offers where request_id=pg_temp.k(101))
  and not exists(select from public.request_point_reservations where request_id=pg_temp.k(101))
  and not exists(select from public.request_ratings where request_id=pg_temp.k(101))
  and not exists(select from public.delivery_request_details where request_id=pg_temp.k(101)),'Job-owned detail and history expire together');
select is((select amount from public.points_ledger where request_id=pg_temp.k(110)),-5::bigint,'Ledger keeps the original amount and job reference');
select ok(exists(select from public.messages where id=pg_temp.k(714)),'Job cleanup leaves chat erasure to the DM worker');
select is(safety_private.erase_expired_direct_threads(),1,'DM worker can now remove just the eligible chat');
select ok(exists(select from public.messages where id=pg_temp.k(715)),'Reported chat survives both workers');
select is(safety_private.erase_expired_jobs(),0,'Repeat sweep is idempotent');
select ok(exists(select from safety_private.retention_hold_releases where hold_id=pg_temp.k(912)),'Hold audit remains intact');
select is((select balance from points_private.returning_balances where email_fingerprint=digest('saved job balance','sha256')),
  47::bigint,'Saved balance survives job and DM expiration');
insert into safety_private.deletion_evidence_batches(target_kind,target_id)
select 'notice',id from public.notifications where source_event_key='job-retention-notice';
delete from public.notifications where source_event_key='job-retention-notice';
select ok(exists(select from safety_private.deletion_evidence_batches where notice_request_id=pg_temp.k(117))
  and (select protected from safety_private.shared_job_windows(now(),pg_temp.k(117))),
  'Private evidence from an offer-only notice protects the job even after the notice is gone');
insert into safety_private.retention_hold_releases(hold_id,released_by,reason)
values(pg_temp.k(911),pg_temp.k(4),'Access request finished');
select is(safety_private.erase_expired_jobs(),1,'Release permits only the job whose other requirements ended');
select ok(not pg_temp.remains(111) and exists(select from safety_private.retention_holds where id=pg_temp.k(911))
  and exists(select from safety_private.retention_hold_releases where hold_id=pg_temp.k(911)),
  'Hold placement and release history survive deletion of their job');
select pg_temp.make_job(n) from generate_series(5010,5060) n;
select is(safety_private.erase_expired_jobs(),50,'Cleanup is bounded');
select is(safety_private.erase_expired_jobs(),1,'Next batch catches the remainder');
select * from finish();
rollback;
