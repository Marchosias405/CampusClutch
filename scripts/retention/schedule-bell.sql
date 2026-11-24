begin;
select 'safety_private.erase_expired_bell_notices()'::regprocedure;
create extension if not exists pg_cron;
select cron.schedule('campusclutch-expired-bell', '* * * * *',
  'set statement_timeout = ''10s''; select safety_private.erase_expired_bell_notices()');
commit;
