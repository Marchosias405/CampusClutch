begin;
set local lock_timeout='5s';

-- The row and completion time protect the deleted account and anchor other
-- retention clocks. Only the credential used to check status ages out.
alter table account_private.deletions alter column receipt_hash drop not null,
  add constraint pending_deletion_requires_receipt check (completed_at is not null or receipt_hash is not null);

create function account_private.deletion_receipt_expires_at(completed timestamptz)
returns timestamptz language sql immutable strict security invoker set search_path=''
return ((completed at time zone 'UTC') + interval '90 days') at time zone 'UTC';
revoke all on function account_private.deletion_receipt_expires_at(timestamptz) from public,anon,authenticated,service_role;
create index deletion_receipts_expiry_idx on account_private.deletions
  (account_private.deletion_receipt_expires_at(completed_at),id)
  where receipt_hash is not null and completed_at is not null;

create or replace function account_private.claim_deletion(p_id uuid,p_secret text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job account_private.deletions; lease uuid:=gen_random_uuid();
begin
  if p_id is not null then
    select * into job from account_private.deletions where id=p_id
      and receipt_hash=extensions.digest(p_secret,'sha256') for update;
  else
    select * into job from account_private.deletions where completed_at is null and due_at<=clock_timestamp()
      and (lease_until is null or lease_until<clock_timestamp()) order by due_at for update skip locked limit 1;
  end if;
  -- Check after the lock, even if a scheduled hash cleanup is delayed.
  if not found or account_private.deletion_receipt_expires_at(job.completed_at)<=clock_timestamp() then
    return jsonb_build_object('status','unconfirmed');
  end if;
  if job.completed_at is not null then return jsonb_build_object('status','complete'); end if;
  if job.lease_until>clock_timestamp() then return jsonb_build_object('status','pending'); end if;
  update account_private.deletions set lease_id=lease,lease_until=clock_timestamp()+interval '2 minutes',
    attempts=attempts+1,due_at=clock_timestamp()+interval '5 minutes' where id=job.id;
  return jsonb_build_object('status','claimed','id',job.id,'profile_id',job.profile_id,'lease',lease);
end $$;

-- Apply the same cutoff to the signed-in retry of an already accepted request.
do $$ declare
  def text:=pg_get_functiondef('account_private.begin_deletion(uuid,text,text)'::regprocedure);
  previous text:='if existing.id=p_operation_id and existing.receipt_hash=extensions.digest(p_receipt_secret,''sha256'') then';
begin
  if strpos(def,previous)=0 then raise exception 'Inspect the deletion confirmation retry before migrating'; end if;
  execute replace(def,previous,
    'if existing.id=p_operation_id and existing.receipt_hash=extensions.digest(p_receipt_secret,''sha256'')'
    ||chr(10)||'      and (existing.completed_at is null or clock_timestamp()<account_private.deletion_receipt_expires_at(existing.completed_at)) then');
end $$;

create function account_private.erase_expired_deletion_receipts() returns integer
language plpgsql volatile security invoker set search_path='' as $$
declare removed integer;
begin
  with due as (
    select d.id from account_private.deletions d
    where d.receipt_hash is not null and d.completed_at is not null
      and account_private.deletion_receipt_expires_at(d.completed_at)<=statement_timestamp()
    order by account_private.deletion_receipt_expires_at(d.completed_at),d.id
    limit 50 for update skip locked
  )
  update account_private.deletions d set receipt_hash=null from due where d.id=due.id;
  get diagnostics removed=row_count;
  return removed;
end $$;
revoke all on function account_private.erase_expired_deletion_receipts() from public,anon,authenticated,service_role;
commit;
