begin;
set local lock_timeout = '5s';

-- pg_cron keeps run history after unscheduling a job and drops its name from
-- the catalog. Remember which job IDs and SQL versions this owner observed.
-- Store the fingerprint only. A job may reference Vault or another secret store.
create table safety_private.routine_log_job_identities (
  database_name name not null,
  run_as name not null,
  jobid bigint not null,
  job_name text not null,
  command_hash bytea not null check (octet_length(command_hash) = 32),
  primary key (database_name, run_as, jobid, job_name, command_hash)
);
alter table safety_private.routine_log_job_identities enable row level security;
revoke all on safety_private.routine_log_job_identities from public, anon, authenticated, service_role;

-- Reference the optional extension only when installed. Deactivated schedules
-- also have identifiable history; active is a scheduling switch, not ownership.
create function safety_private.routine_log_jobs()
returns table (jobid bigint, job_name text, command text)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if to_regclass('cron.job') is null then return; end if;
  return query
    select j.jobid, j.jobname::text, j.command
    from cron.job j
    where j.username = current_user and j.database = current_database()
      and j.jobname in (
        'campusclutch-android-push', 'campusclutch-account-deletion',
        'campusclutch-released-evidence', 'campusclutch-expired-direct-threads',
        'campusclutch-expired-jobs', 'campusclutch-expired-cases',
        'campusclutch-expired-bell', 'campusclutch-expired-deletion-receipts',
        'campusclutch-expired-unclaimed-requests', 'campusclutch-expired-routine-logs'
      );
end $$;

create function safety_private.routine_log_candidates(p_limit integer)
returns table (runid bigint, completed_at timestamptz)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if to_regclass('cron.job') is null or to_regclass('cron.job_run_details') is null then return; end if;
  return query
    with known as materialized (
      select j.jobid, j.command, null::bytea as command_hash
      from safety_private.routine_log_jobs() j
      union all
      select h.jobid, null::text, h.command_hash
      from safety_private.routine_log_job_identities h
      left join cron.job j on j.jobid = h.jobid
      where h.database_name = current_database() and h.run_as = current_user
        and (j.jobid is null or (
          j.jobname = h.job_name and j.username = h.run_as and j.database = h.database_name
          and sha256(convert_to(j.command, 'UTF8')) <> h.command_hash
        ))
    )
    select r.runid, r.end_time
    from cron.job_run_details r
    where r.database = current_database() and r.username = current_user
      and r.status in ('succeeded', 'failed') and isfinite(r.start_time) and isfinite(r.end_time)
      and r.start_time <= r.end_time and r.end_time <= statement_timestamp() - interval '720 hours'
      and exists (
        select from known k where k.jobid = r.jobid and
          case when k.command is not null then r.command = k.command
               else sha256(convert_to(r.command, 'UTF8')) = k.command_hash end
      )
    order by r.runid
    limit p_limit;
end $$;

create function safety_private.routine_log_inventory()
returns table (eligible bigint, oldest_completed_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select count(*), min(completed_at) from safety_private.routine_log_candidates(null);
$$;

create function safety_private.erase_expired_routine_logs() returns integer
language plpgsql volatile security invoker set search_path = '' set lock_timeout = '2s' as $$
declare
  removed integer;
begin
  if to_regclass('cron.job') is null or to_regclass('cron.job_run_details') is null then return 0; end if;
  if not pg_try_advisory_xact_lock(94837265, 30) then return 0; end if;

  insert into safety_private.routine_log_job_identities (database_name, run_as, jobid, job_name, command_hash)
  select current_database(), current_user, j.jobid, j.job_name, sha256(convert_to(j.command, 'UTF8'))
  from safety_private.routine_log_jobs() j
  on conflict do nothing;

  -- Managed Supabase grants SELECT and DELETE on the extension's history.
  -- Plain DELETE avoids requiring an UPDATE grant for SELECT FOR UPDATE.
  delete from cron.job_run_details r using safety_private.routine_log_candidates(1000) c
  where r.runid = c.runid and r.end_time = c.completed_at and r.status in ('succeeded', 'failed')
    and r.database = current_database() and r.username = current_user;
  get diagnostics removed = row_count;
  return removed;
end $$;

revoke all on function safety_private.routine_log_jobs(),
  safety_private.routine_log_candidates(integer), safety_private.routine_log_inventory(),
  safety_private.erase_expired_routine_logs() from public, anon, authenticated, service_role;
commit;
