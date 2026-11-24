begin;
select 'safety_private.erase_expired_unclaimed_requests()'::regprocedure;
create extension if not exists pg_cron;
select cron.schedule('campusclutch-expired-unclaimed-requests', '17 * * * *',
  'set statement_timeout = ''10s''; select safety_private.erase_expired_unclaimed_requests()');
commit;
