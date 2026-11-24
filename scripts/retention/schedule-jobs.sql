begin;
select 'safety_private.erase_expired_jobs()'::regprocedure;
create extension if not exists pg_cron;
select cron.schedule('campusclutch-expired-jobs', '* * * * *',
  'set statement_timeout = ''20s''; select safety_private.erase_expired_jobs()');
commit;
