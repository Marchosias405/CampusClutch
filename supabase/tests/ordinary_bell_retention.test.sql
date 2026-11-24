begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='America/Vancouver';
select no_plan();

create function pg_temp.k(n int) returns uuid language sql immutable as $$
  select ('be110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.notice(n int, kind text, delivered timestamptz, first_read timestamptz default null)
returns void language sql as $$
  insert into public.notifications(id,recipient_id,event_type,title,body,source_event_key,navigation_key,created_at,delivered_at,read_at)
  values(pg_temp.k(n),pg_temp.k(1),kind,'Test','Test', 'bell-test-'||n,
    case when kind='message_received' then 'conversation' when kind in ('account_warning','appeal_decided') then 'account_notice'
         else 'request_details' end, now()-interval '3 years',delivered,first_read)
$$;
create function pg_temp.remains(n int) returns boolean language sql as $$
  select exists(select from public.notifications where id=pg_temp.k(n))
$$;
select ok(not has_function_privilege(r,'safety_private.erase_expired_bell_notices()','execute')
  and not has_table_privilege(r,'safety_private.bell_windows','select'),
  r||' cannot read the inventory or run cleanup') from unnest(array['anon','authenticated','service_role']) r;
select is(safety_private.ordinary_bell_deadline('future_type',now(),now()),null::timestamptz,
  'New event kinds need an explicit retention policy');
select is(safety_private.ordinary_bell_deadline(kind,'2026-01-01 12:00Z',null),
  '2026-06-30 12:00Z'::timestamptz,kind||' uses 180 elapsed days across DST')
from unnest(array['offer_created','offer_accepted','offer_rejected','offer_withdrawn','another_helper_selected',
  'request_cancelled','request_expired','request_reopened','request_completed','message_received']) kind;
select is(safety_private.ordinary_bell_deadline('offer_created','2025-09-05 12:00Z','2026-03-01 12:00Z'),
  '2026-05-30 12:00Z'::timestamptz,'A late first read gets its full 90 days');
insert into auth.users(id,email,email_confirmed_at)
select pg_temp.k(n),'bell-retention-'||n||'@test.local',now() from generate_series(1,2) n;
update public.profiles set display_name='Bell fixture',onboarding_completed_at=now() where id in (pg_temp.k(1),pg_temp.k(2));
insert into auth.sessions(id,user_id,created_at)
select pg_temp.k(10+n),pg_temp.k(n),now() from generate_series(1,2) n;
insert into notifications_private.android_push_devices(session_id,profile_id,expo_token)
values(pg_temp.k(11),pg_temp.k(1),'ExpoPushToken[retention]');
select pg_temp.notice(20,'offer_created',now()-interval '4320 hours');
select pg_temp.notice(21,'request_completed',now()-interval '4320 hours'+interval '1 microsecond');
select pg_temp.notice(22,'message_received',now()-interval '6000 hours',now()-interval '2160 hours');
select pg_temp.notice(23,'message_received',now()-interval '6000 hours',now()-interval '2160 hours'+interval '1 microsecond');
select results_eq($$select id from safety_private.bell_windows where window_end<=now()
    and protected_through < (now() at time zone 'UTC')::date order by id$$,
  $$select pg_temp.k(n) from unnest(array[20,22]) n order by n$$,'Exact read and unread boundaries are inclusive down to the microsecond');
-- Keep the still-young fixtures away from the moving wall clock during the remainder of this test.
update public.notifications set delivered_at=now() where id=pg_temp.k(21);
update public.notifications set read_at=now() where id=pg_temp.k(23);
select pg_temp.notice(24,'account_warning',now()-interval '2 years');
select pg_temp.notice(25,'appeal_decided',now()-interval '2 years',now()-interval '1 year');
select pg_temp.notice(26,'message_received',now()-interval '2 years');
select pg_temp.notice(27,'offer_accepted',now()-interval '2 years');
select pg_temp.notice(28,'message_received',now()-interval '2 years');
insert into safety_private.retention_holds(id,target_kind,target_id,placed_by,reason) values
  (pg_temp.k(60),'notice',pg_temp.k(26),pg_temp.k(2),'First access request'),
  (pg_temp.k(61),'notice',pg_temp.k(26),pg_temp.k(2),'Second access request'),
  (pg_temp.k(62),'notice',pg_temp.k(27),pg_temp.k(2),'Keep through the UTC day');
insert into safety_private.retention_hold_releases(hold_id,released_by,reason)
select pg_temp.k(n),pg_temp.k(2),'Access request completed' from unnest(array[60,62]) n;
insert into safety_private.retention_deadlines values(pg_temp.k(62),(now() at time zone 'UTC')::date);
select is((select protected_through >= (now() at time zone 'UTC')::date + 1
  from safety_private.bell_windows where id=pg_temp.k(27)),false,
  'A released keep-through date ends at the next UTC midnight');
insert into notifications_private.push_jobs(notification_id,session_id,ticket)
values(pg_temp.k(28),pg_temp.k(11),'pending-push-receipt');
-- Actual source rows produce their own notifications through the normal insert triggers.
insert into public.conversations(id,type,created_by) values(pg_temp.k(40),'direct',pg_temp.k(2));
insert into public.direct_conversation_pairs values(pg_temp.k(40),pg_temp.k(1),pg_temp.k(2));
insert into public.conversation_members(conversation_id,profile_id) values(pg_temp.k(40),pg_temp.k(1)),(pg_temp.k(40),pg_temp.k(2));
insert into public.messages(id,conversation_id,sender_id,client_message_id,sequence,body)
values(pg_temp.k(41),pg_temp.k(40),pg_temp.k(2),pg_temp.k(42),1,'Still in the conversation');
insert into messaging_private.direct_message_reads values(pg_temp.k(41),now());
insert into public.requests(id,owner_id,category,title,description,campus_id,room_location,deadline_at,points,item_size)
values(pg_temp.k(43),pg_temp.k(1),'delivery','Bell test','Source job',(select id from public.campuses limit 1),
       'Test room',now()+interval '1 day',10,'small');
insert into public.request_offers(id,request_id,offering_user_id) values(pg_temp.k(44),pg_temp.k(43),pg_temp.k(2));
insert into public.offer_notifications(recipient_id,actor_id,request_id,offer_id,event_type)
values(pg_temp.k(1),pg_temp.k(2),pg_temp.k(43),pg_temp.k(44),'created') on conflict do nothing;
update public.notifications set delivered_at=now()-interval '2 years' where message_id=pg_temp.k(41) or offer_id=pg_temp.k(44);
select is((select count(*) from public.notifications where message_id=pg_temp.k(41) or offer_id=pg_temp.k(44)),2::bigint,
  'The DM and offer each produced a bell entry');
select set_config('request.jwt.claim.sub',pg_temp.k(1)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.k(1),'role','authenticated','session_id',pg_temp.k(11))::text,true);
set local role authenticated;
select is(public.get_my_notification_unread_count_v3(),8,'The normal inbox badge includes the old unread entries');
reset role;
-- A failed batch rolls back atomically before it can be retried.
create function pg_temp.interrupt_bell() returns trigger language plpgsql as $$
begin raise exception 'fixture interruption'; end $$;
create trigger interrupt_bell before delete on public.notifications for each row execute function pg_temp.interrupt_bell();
select throws_ok($$select safety_private.erase_expired_bell_notices()$$,'P0001','fixture interruption','Failure rolls back the batch');
drop trigger interrupt_bell on public.notifications;
select is(safety_private.erase_expired_bell_notices(),4,'Retry removes exactly four due entries');
select ok(not pg_temp.remains(20) and not pg_temp.remains(22) and pg_temp.remains(21) and pg_temp.remains(23),
  'Read and unread clocks apply independently of the source event date');
select ok(pg_temp.remains(24) and pg_temp.remains(25),'Warning and appeal notices stay in the bell');
select ok(pg_temp.remains(26) and pg_temp.remains(27) and pg_temp.remains(28),
  'A second hold, released dated hold and pending push each protect their entry');
select ok(exists(select from public.messages where id=pg_temp.k(41) and body='Still in the conversation')
  and exists(select from messaging_private.direct_message_reads where message_id=pg_temp.k(41))
  and exists(select from public.conversation_members where conversation_id=pg_temp.k(40) and profile_id=pg_temp.k(1) and last_read_sequence=0),
  'The message, its read receipt and the conversation cursor survive bell cleanup');
select ok(exists(select from public.requests where id=pg_temp.k(43) and points=10)
  and exists(select from public.request_offers where id=pg_temp.k(44))
  and exists(select from public.offer_notifications where offer_id=pg_temp.k(44)),
  'The request, points offered, offer and original offer event survive');
set local role authenticated;
select is(public.get_my_notification_unread_count_v3(),5,'Only the three expired unread entries leave the badge');
select set_config('request.jwt.claim.sub',pg_temp.k(2)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.k(2),'role','authenticated','session_id',pg_temp.k(12))::text,true);
select is(public.send_conversation_message(pg_temp.k(40),pg_temp.k(42),'Still in the conversation')->>'id',
  pg_temp.k(41)::text,'Retrying the original send returns the existing message');
reset role;
select ok(not exists(select from public.notifications where message_id=pg_temp.k(41)),
  'Retrying the send cannot resurrect the expired bell entry');
select is(safety_private.erase_expired_bell_notices(),0,'An immediate retry is idempotent');
delete from notifications_private.push_jobs where notification_id=pg_temp.k(28);
insert into safety_private.retention_hold_releases(hold_id,released_by,reason) values(pg_temp.k(61),pg_temp.k(2),'Second request completed');
select is(safety_private.erase_expired_bell_notices(),2,'Completion of delivery and release of the last hold allow expiry');
select ok(pg_temp.remains(27) and (select count(*) from safety_private.retention_hold_releases where hold_id in
  (pg_temp.k(60),pg_temp.k(61),pg_temp.k(62)))=3,'Dated protection and hold audit survive');
select pg_temp.notice(n,'offer_accepted',now()-interval '2 years') from generate_series(100,154) n;
select is(safety_private.erase_expired_bell_notices(),50,'A batch removes at most 50 entries');
select is(safety_private.erase_expired_bell_notices(),5,'The next batch completes the backlog');
select is(safety_private.erase_expired_bell_notices(),0,'The empty queue is safe to poll');
select * from finish();
rollback;
