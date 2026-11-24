begin;
select 'safety_private.erase_expired_direct_threads()'::regprocedure;
create extension if not exists pg_cron;
select cron.schedule('campusclutch-expired-direct-threads', '* * * * *',
  'set statement_timeout = ''20s''; select safety_private.erase_expired_direct_threads()');
commit;
