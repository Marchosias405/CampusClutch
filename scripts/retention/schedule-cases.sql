begin;
select 'safety_private.erase_expired_cases()'::regprocedure;
create extension if not exists pg_cron;
select cron.schedule('campusclutch-expired-cases', '* * * * *',
  'set statement_timeout = ''20s''; select safety_private.erase_expired_cases()');
commit;
