begin;
select 'account_private.erase_expired_deletion_receipts()'::regprocedure;
create extension if not exists pg_cron;
select cron.schedule('campusclutch-expired-deletion-receipts', '* * * * *',
  'set statement_timeout = ''5s''; select account_private.erase_expired_deletion_receipts()');
commit;
