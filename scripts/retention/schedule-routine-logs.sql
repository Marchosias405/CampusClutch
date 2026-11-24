begin;
select 'safety_private.erase_expired_routine_logs()'::regprocedure;
create extension if not exists pg_cron;
select cron.schedule('campusclutch-expired-routine-logs', '8,23,38,53 * * * *',
  'set statement_timeout = ''20s''; select safety_private.erase_expired_routine_logs()');
commit;
