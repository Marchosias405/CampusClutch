begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();

create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('d030da00-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.login(n int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub',pg_temp.uid(n)::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(n),'role','authenticated',
    'session_id',pg_temp.uid(n+1000))::text,true);
end $$;
create function pg_temp.thread_exists(n int) returns boolean language sql as $$
  select exists(select from public.conversations where id=pg_temp.uid(100+n))
$$;

select ok(not has_function_privilege(r,'safety_private.erase_expired_direct_threads()','execute'),
  r||' cannot run DM cleanup') from unnest(array['anon','authenticated','service_role']) r;
select ok(not has_table_privilege('authenticated','safety_private.direct_thread_windows','select'),
  'Students cannot inspect retention eligibility');
insert into auth.users(id,email,email_confirmed_at)
select pg_temp.uid(n),'dm-retention-'||n||'@test.local',now() from generate_series(1,18) n;
update public.profiles set display_name='DM fixture',onboarding_completed_at=now()
where id in(select pg_temp.uid(n) from generate_series(1,18) n);
insert into auth.sessions(id,user_id,created_at,updated_at)
select pg_temp.uid(n+1000),pg_temp.uid(n),now(),now() from generate_series(1,2) n;
insert into public.conversations(id,type,created_by)
select pg_temp.uid(n+100),case when n=15 then 'group' else 'direct' end,pg_temp.uid(1) from generate_series(2,17) n;
insert into public.direct_conversation_pairs(conversation_id,user_low_id,user_high_id)
select pg_temp.uid(n+100),pg_temp.uid(1),pg_temp.uid(n) from generate_series(2,17) n where n not in (14,15);
insert into public.conversation_members(conversation_id,profile_id)
select pg_temp.uid(n+100),pg_temp.uid(member) from generate_series(2,17) n
cross join lateral (values (1),(n)) parties(member) where n<>15 and (n,member)<>(17,17);
insert into public.messages(id,conversation_id,sender_id,client_message_id,sequence,body)
select pg_temp.uid(n+200),pg_temp.uid(n+100),pg_temp.uid(1),pg_temp.uid(n+300),1,'Fixture message'
from generate_series(2,17) n where n<>15;
insert into messaging_private.direct_message_reads values(pg_temp.uid(202),now());

-- One real deletion leaves the other participant's history intact.
set local role authenticated;
select pg_temp.login(1);
select is(public.begin_my_account_deletion(pg_temp.uid(901),repeat('a',64),'DELETE')->>'accepted','true','First account enters normal deletion');
reset role;
set local request.jwt.claim.sub='';
set local request.jwt.claims='{}';
update public.profiles set deleted_at=now()-interval '80 days' where id=pg_temp.uid(1);
update account_private.deletions set completed_at=now()-interval '79 days' where profile_id=pg_temp.uid(1);
select is(safety_private.erase_expired_direct_threads(),0,'A surviving participant keeps the conversation');
select ok(exists(select from public.messages where id=pg_temp.uid(202)),'Original message survives the first deletion');
set local role authenticated;
select pg_temp.login(2);
select is(public.begin_my_account_deletion(pg_temp.uid(902),repeat('b',64),'DELETE')->>'accepted','true','Second account enters normal deletion');
reset role;
set local request.jwt.claim.sub='';
set local request.jwt.claims='{}';
select is(safety_private.erase_expired_direct_threads(),0,'A pending second cleanup does not start the clock');
update public.profiles set deleted_at=now()-interval '45 days' where id=pg_temp.uid(2);
update account_private.deletions set completed_at=now()-interval '29 days' where profile_id=pg_temp.uid(2);
select is(safety_private.erase_expired_direct_threads(),0,'Two deletions remain protected before day 30');

-- Seed the other outcomes around the same confirmed deletion. Test unrelated survivors too.
insert into account_private.deletions(id,profile_id,receipt_hash,completed_at)
select pg_temp.uid(n+800),pg_temp.uid(n),decode(repeat('cc',32),'hex'),
  case when n=4 then null when n=5 then now()-interval '29 days' else now()-interval '40 days' end
from generate_series(4,17) n;
update public.profiles set deleted_at=now()-interval '45 days'
where id in(select pg_temp.uid(n) from generate_series(4,17) n);
update public.conversations set status='active' where id=pg_temp.uid(116);
delete from public.notifications where conversation_id in(select pg_temp.uid(n+100) from generate_series(2,17) n);
insert into safety_private.reports(id,operation_id,target_type,message_id,reason,details,payload_hash,evidence)
values(pg_temp.uid(406),pg_temp.uid(506),'message',pg_temp.uid(206),'spam','',digest('dm fixture','sha256'),'{}');
insert into public.requests(id,owner_id,category,title,description,campus_id,room_location,deadline_at,points,item_size)
values(pg_temp.uid(407),pg_temp.uid(18),'delivery','DM fixture','Retention fixture job',(select id from public.campuses limit 1),
       'Fixture room',now()+interval '1 day',5,'small');
insert into public.delivery_request_details(request_id,pickup_location,dropoff_location) values(pg_temp.uid(407),'A','B');
insert into public.request_point_reservations(request_id,offer_round,poster_id,helper_id,amount,status,released_at)
values(pg_temp.uid(407),1,pg_temp.uid(1),pg_temp.uid(7),5,'released',now());
insert into public.request_conversations(request_id,offer_round,conversation_id,poster_id,helper_id)
values(pg_temp.uid(407),1,pg_temp.uid(107),pg_temp.uid(1),pg_temp.uid(7));
insert into safety_private.retention_holds(id,target_kind,target_id,placed_by,reason)
values(pg_temp.uid(408),'thread',pg_temp.uid(108),pg_temp.uid(18),'Evidence is requested'),
      (pg_temp.uid(508),'thread',pg_temp.uid(108),pg_temp.uid(18),'Another open request'),
      (pg_temp.uid(409),'thread',pg_temp.uid(109),pg_temp.uid(18),'Keep through today');
insert into safety_private.retention_deadlines values(pg_temp.uid(409),current_date);
insert into safety_private.retention_hold_releases(hold_id,released_by,reason)
select pg_temp.uid(n),pg_temp.uid(18),'Completed first request' from unnest(array[408,409]) n;
insert into public.notifications(id,recipient_id,event_type,title,body,navigation_key,source_event_key,conversation_id,message_id)
values(pg_temp.uid(410),pg_temp.uid(18),'message_received','Fixture','Linked thread','conversation','dm-retention-thread',pg_temp.uid(110),null),
      (pg_temp.uid(411),pg_temp.uid(18),'message_received','Fixture','Linked message','conversation','dm-retention-message',null,pg_temp.uid(211));
insert into safety_private.deletion_evidence_batches(target_kind,target_id) values('thread',pg_temp.uid(112));
insert into safety_private.deletion_evidence_batches(target_kind,target_id,notice_thread_id) values('notice',pg_temp.uid(413),pg_temp.uid(113));
update account_private.deletions set completed_at=now()-interval '30 days' where profile_id=pg_temp.uid(2);
select is((select window_end from safety_private.direct_thread_windows where id=pg_temp.uid(102)),now(),'Window ends exactly 720 hours after second cleanup');
create function pg_temp.fail_pair_delete() returns trigger language plpgsql as $$
begin raise exception 'fixture interruption'; end $$;
create trigger interrupted_cleanup before delete on public.direct_conversation_pairs
for each row when (old.conversation_id='d030da00-0000-4000-8000-000000000102') execute function pg_temp.fail_pair_delete();
select throws_ok($$select safety_private.erase_expired_direct_threads()$$,'P0001','fixture interruption','Unexpected write failure aborts cleanup');
select ok(exists(select from public.messages where id=pg_temp.uid(202))
          and exists(select from messaging_private.direct_message_reads where message_id=pg_temp.uid(202))
          and exists(select from public.conversation_members where conversation_id=pg_temp.uid(102)),
          'Partial cleanup rolls back messages, receipts and membership');
drop trigger interrupted_cleanup on public.direct_conversation_pairs;
select is(safety_private.erase_expired_direct_threads(),1,'Only the eligible ordinary thread is erased');
select ok(not pg_temp.thread_exists(2),'Expired conversation is gone');
select ok(not exists(select from public.messages where id=pg_temp.uid(202)) and
          not exists(select from messaging_private.direct_message_reads where message_id=pg_temp.uid(202)),'Message and read receipt are gone');
select ok(not exists(select from public.group_membership_periods where conversation_id=pg_temp.uid(102)) and
          not exists(select from public.conversation_members where conversation_id=pg_temp.uid(102)) and
          not exists(select from public.direct_conversation_pairs where conversation_id=pg_temp.uid(102)),'Pair, memberships and history periods are gone');
select ok(pg_temp.thread_exists(n),label) from (values (3,'Keep active participant'),(4,'Keep incomplete cleanup'),
  (5,'Keep younger conversation'),(6,'Keep reported message'),(7,'Keep job conversation'),(8,'Keep independent active hold'),
  (9,'Honor released hold through end of UTC day'),(10,'Keep surviving notice'),(11,'Keep message-only notice'),
  (12,'Keep source of private thread evidence'),(13,'Keep context for preserved notice evidence'),(14,'Skip absent pair'),
  (15,'Skip group'),(16,'Skip open thread'),(17,'Skip missing member')) fixtures(n,label);
select is((select message_id from safety_private.reports where id=pg_temp.uid(406)),pg_temp.uid(206),'Report still references its message');
select is(safety_private.erase_expired_direct_threads(),0,'Repeat sweep is idempotent');
insert into safety_private.retention_hold_releases(hold_id,released_by,reason)
values(pg_temp.uid(508),pg_temp.uid(18),'Second request finished');
select is(safety_private.erase_expired_direct_threads(),1,'Final release allows an already old conversation to expire');
select ok(not pg_temp.thread_exists(8) and exists(select from safety_private.retention_hold_releases where hold_id=pg_temp.uid(508)),
  'Thread is removed and hold audit survives');
select ok(exists(select from account_private.deletions where profile_id=pg_temp.uid(2))
          and exists(select from public.profiles where id=pg_temp.uid(2)),'Receipt and identity tombstone survive');
insert into safety_private.retention_holds(id,target_kind,target_id,placed_by,reason)
values(pg_temp.uid(512),'thread',pg_temp.uid(112),pg_temp.uid(18),'Match original evidence');
insert into safety_private.deletion_evidence_coverage(batch_id,hold_id)
select id,pg_temp.uid(512) from safety_private.deletion_evidence_batches where target_id=pg_temp.uid(112);
insert into safety_private.retention_hold_releases(hold_id,released_by,reason)
values(pg_temp.uid(512),pg_temp.uid(18),'Original request finished');
select is(safety_private.erase_released_evidence(),1,'The source dependency permits the released copy to expire');
select is(safety_private.erase_expired_direct_threads(),1,'Source is removed after the independent evidence cleanup finishes');
select ok(not pg_temp.thread_exists(12),'A previously held thread is not stranded');

-- A backlog drains in bounded batches. Empty direct conversations use the same clock.
insert into auth.users(id,email) select pg_temp.uid(n),'dm-batch-'||n||'@test.local' from generate_series(2000,2050) n;
update public.profiles set deleted_at=now()-interval '40 days'
where id in(select pg_temp.uid(n) from generate_series(2000,2050) n);
insert into account_private.deletions(id,profile_id,receipt_hash,completed_at)
select pg_temp.uid(n+3000),pg_temp.uid(n),decode(repeat('dd',32),'hex'),now()-interval '40 days' from generate_series(2000,2050) n;
insert into public.conversations(id,created_by,status)
select pg_temp.uid(n+1000),pg_temp.uid(1),'closed' from generate_series(2000,2050) n;
insert into public.direct_conversation_pairs(conversation_id,user_low_id,user_high_id)
select pg_temp.uid(n+1000),pg_temp.uid(1),pg_temp.uid(n) from generate_series(2000,2050) n;
insert into public.conversation_members(conversation_id,profile_id)
select pg_temp.uid(n+1000),pg_temp.uid(member) from generate_series(2000,2050) n cross join lateral (values (1),(n)) p(member);
select is(safety_private.erase_expired_direct_threads(),50,'First batch is capped at 50 threads');
select is(safety_private.erase_expired_direct_threads(),1,'Next batch finishes the backlog');
select is(safety_private.erase_expired_direct_threads(),0,'Idle sweep does no work');
select * from finish();
rollback;
