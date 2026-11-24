begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists pg_cron;
set local search_path = public, extensions;
set local timezone = 'America/Vancouver';
select no_plan();

-- The transaction keeps these synthetic schedules invisible to the launcher.
create function pg_temp.dm_command() returns text immutable language sql as $$
  select 'set statement_timeout = ''20s''; select safety_private.erase_expired_direct_threads()'::text
$$;
create temp table log_test_jobs (label text primary key, id bigint not null);
insert into log_test_jobs values
  ('app', cron.schedule('campusclutch-expired-direct-threads','0 0 1 1 *',pg_temp.dm_command())),
  ('other', cron.schedule('campusclutch-unrecognized-pgtap-job','0 0 1 1 *',pg_temp.dm_command())),
  ('orphan', -817000000000);

create function pg_temp.log_run(
  n integer, job text, state text, started timestamptz, ended timestamptz,
  db text default current_database(), account text default current_user, cmd text default null
) returns void language sql as $$
  insert into cron.job_run_details(jobid, runid, database, username, command, status, start_time, end_time)
  select id, -817000000000::bigint - n, db, account, coalesce(cmd,pg_temp.dm_command()), state, started, ended
  from pg_temp.log_test_jobs where label = job
$$;
create function pg_temp.has_run(n integer) returns boolean language sql stable as $$
  select exists(select from cron.job_run_details where runid = -817000000000::bigint - n)
$$;

select ok(not has_function_privilege(role_name, 'safety_private.erase_expired_routine_logs()', 'execute')
  and not has_function_privilege(role_name, 'safety_private.routine_log_inventory()', 'execute'),
  role_name || ' cannot list or erase scheduler history')
from unnest(array['anon','authenticated','service_role']) as role_name;
select is((select count(*) from safety_private.routine_log_inventory()),1::bigint,
  'Inventory returns a single aggregate');
select is((select eligible from safety_private.routine_log_inventory()),0::bigint,
  'History starts with no due routine runs in the test database');
select is((select oldest_completed_at from safety_private.routine_log_inventory()),null::timestamptz,
  'No due run has no oldest completion time');

insert into safety_private.retention_holds(id,target_kind,target_id,placed_by,reason,placed_at)
values('eb710000-0000-4000-8000-000000000001','job','eb710000-0000-4000-8000-000000000002',
  'eb710000-0000-4000-8000-000000000003','Keep this audit record',now()-interval '3 years');
insert into safety_private.retention_hold_releases(hold_id,released_by,reason,released_at)
values('eb710000-0000-4000-8000-000000000001','eb710000-0000-4000-8000-000000000003',
  'Case resolved years ago',now()-interval '2 years');

do $$
declare old timestamptz := transaction_timestamp()-interval '35 days';
begin
  perform pg_temp.log_run(1,'app','succeeded',old-interval '1 minute',old);
  perform pg_temp.log_run(2,'app','failed',old-interval '2 days',old-interval '1 day');
  perform pg_temp.log_run(3,'app','succeeded',old,now()-interval '1 day');
  perform pg_temp.log_run(4,'app','running',old,null);
  perform pg_temp.log_run(5,'app','failed',old,null);
  perform pg_temp.log_run(6,'app','unexpected-status',old,old);
  perform pg_temp.log_run(7,'app','failed',old+interval '1 minute',old);
  perform pg_temp.log_run(8,'app','failed',null,old);
  perform pg_temp.log_run(9,'app','failed',old,old,'foreign_database');
  perform pg_temp.log_run(10,'app','failed',old,old,current_database(),'some_other_owner');
  perform pg_temp.log_run(11,'app','failed',old,old,current_database(),current_user,'select 1 /* unrelated */');
  perform pg_temp.log_run(12,'other','succeeded',old,old);
  perform pg_temp.log_run(13,'orphan','succeeded',old,old);
  perform pg_temp.log_run(14,'app','succeeded','-infinity',old);
  perform pg_temp.log_run(15,'app','succeeded',old,'infinity');
  perform pg_temp.log_run(16,'app','running',old,old);
end $$;
select is((select eligible from safety_private.routine_log_inventory()),2::bigint,
  'Only the two finished, due runs of the owned schedule are eligible');
select is((select oldest_completed_at from safety_private.routine_log_inventory()),
  transaction_timestamp()-interval '36 days', 'Inventory uses the completion time');
select is((select count(*) from cron.job_run_details where runid between -817000000016 and -817000000001),
  16::bigint, 'Inventory leaves the source history intact');
select is(safety_private.erase_expired_routine_logs(),2,'Sweep removes a completed success and failure');
select ok(not pg_temp.has_run(1) and not pg_temp.has_run(2),'Both expired runs are gone');
select ok(pg_temp.has_run(n),description) from (values
  (3,'A recently finished long job retains a full diagnostic window'),
  (4,'A running job with no end time survives'), (5,'An incomplete failed run survives'),
  (6,'Unrecognized states survive'), (7,'Inverted timestamps survive'), (8,'Missing start time survives'),
  (9,'Same job ID in a different database survives'), (10,'Same job ID under another role survives'),
  (11,'Older command without a captured signature survives'),
  (12,'Similar job name with the identical command survives'), (13,'Never-enrolled retired job survives'),
  (14,'An infinite start time survives'), (15,'An infinite end time survives'),
  (16,'A running state with an end timestamp survives')
) v(n,description);
select is(safety_private.erase_expired_routine_logs(),0,'Repeating a sweep with no new eligible runs is safe');

-- Inventory and eraser run under the same statement clock so one microsecond
-- before the cutoff really is tested, regardless of machine speed or DST.
create function pg_temp.check_cutoff() returns boolean language plpgsql as $$
declare cutoff timestamptz := statement_timestamp()-interval '720 hours';
  counted bigint;
  cleared integer;
begin
  perform pg_temp.log_run(21,'app','succeeded',cutoff-interval '1 hour',cutoff);
  perform pg_temp.log_run(22,'app','succeeded',cutoff-interval '1 hour',cutoff+interval '1 microsecond');
  select eligible into counted from safety_private.routine_log_inventory();
  cleared := safety_private.erase_expired_routine_logs();
  return counted=1 and cleared=1 and not pg_temp.has_run(21) and pg_temp.has_run(22);
end $$;
select ok(pg_temp.check_cutoff(),'The exact 720-hour endpoint is due, and one microsecond younger survives');
-- The boundary row matures before the next independent statement.
select is(safety_private.erase_expired_routine_logs(),1,'A later sweep picks up the boundary neighbor');

-- Remember only a verified job identity after its schedule goes away.
select ok(cron.unschedule((select id from log_test_jobs where label='app')),'Retire the verified job ID');
select pg_temp.log_run(31,'app','failed',now()-interval '43 days',now()-interval '42 days');
select pg_temp.log_run(32,'app','failed',now()-interval '43 days',now()-interval '42 days',
  current_database(),current_user,'select 2 /* previously unverified */');
select is((select eligible from safety_private.routine_log_inventory()),1::bigint,
  'Retired owned schedule remains identifiable through the captured command');
select is(safety_private.erase_expired_routine_logs(),1,'Only the verified retired signature expires');
select ok(not pg_temp.has_run(31) and pg_temp.has_run(32),'Unknown command on a retired ID survives');

-- Model an ID reuse after an extension restore by recording an earlier
-- CampusClutch signature for the existing foreign schedule's numeric ID.
-- Application owners cannot insert records directly into the managed cron.job.
insert into safety_private.routine_log_job_identities(database_name,run_as,jobid,job_name,command_hash)
  select h.database_name,h.run_as,j.id,h.job_name,h.command_hash
  from safety_private.routine_log_job_identities h
  join log_test_jobs original on original.label='app' and original.id=h.jobid
  cross join log_test_jobs j
  where j.label='other';
select pg_temp.log_run(33,'other','succeeded',now()-interval '43 days',now()-interval '42 days');
select is(safety_private.erase_expired_routine_logs(),0,
  'An ID that now belongs to a different live schedule is protected');
select ok(pg_temp.has_run(33),'Conflicting job ID history survives even when the command text matches');

insert into log_test_jobs values
  ('batch',cron.schedule('campusclutch-expired-direct-threads','0 0 1 1 *',pg_temp.dm_command()));
do $$ begin
  perform pg_temp.log_run(n,'batch','succeeded',now()-interval '46 days',now()-interval '45 days')
  from generate_series(1001,2003) n;
end $$;
select is((select eligible from safety_private.routine_log_inventory()),1003::bigint,'Inventory sees a full backlog');
select is(safety_private.erase_expired_routine_logs(),1000,'One sweep is bounded to 1,000 rows');
select is((select eligible from safety_private.routine_log_inventory()),3::bigint,'Three rows remain for retry');
select is(safety_private.erase_expired_routine_logs(),3,'The next sweep completes the backlog');
select is(safety_private.erase_expired_routine_logs(),0,'An empty retry removes nothing');
select ok(exists(select from safety_private.retention_holds h
  join safety_private.retention_hold_releases r on r.hold_id=h.id
  where h.id='eb710000-0000-4000-8000-000000000001' and h.reason='Keep this audit record'
    and r.reason='Case resolved years ago'),
  'Old retention-hold placement and release evidence survive all sweeps');
select * from finish();
rollback;
