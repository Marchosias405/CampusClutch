begin;

-- Keep quota and cleanup state in the application schema. Storage owns the
-- objects and bytes. All removals go through its API.
create table account_private.avatar_files (
  name text primary key,
  profile_id uuid not null,
  slot bigint not null check (slot > 0),
  cleanup_after timestamptz,
  retiring boolean not null default false,
  unique (profile_id, slot),
  check (not retiring or cleanup_after is not null)
);
alter table account_private.avatar_files enable row level security;
revoke all on account_private.avatar_files from public, anon, authenticated, service_role;
create index avatar_files_due on account_private.avatar_files(cleanup_after, name)
  where cleanup_after is not null;

create function account_private.avatar_folder(path text) returns uuid
language sql immutable strict security invoker set search_path = '' as $$
  select case when path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    then split_part(path,'/',1)::uuid end
$$;

create function account_private.track_avatar_file() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  folder uuid;
  used bigint;
  first_taken boolean;
begin
  if tg_op = 'UPDATE' then
    if (old.bucket_id,old.name) is not distinct from (new.bucket_id,new.name) then return null; end if;
  end if;
  if tg_op <> 'INSERT' then
    if old.bucket_id = 'avatars' and account_private.avatar_folder(old.name) is not null then
      -- The profile trigger locks this same row when attaching a photo.
      -- An ambiguous update response or a stale cleanup cannot erase a current photo.
      delete from account_private.avatar_files where name=old.name and cleanup_after is not null;
      if not found then
        raise exception using errcode='23514', message='This profile photo is still in use.';
      end if;
    end if;
  end if;
  if tg_op <> 'DELETE' then
    folder := account_private.avatar_folder(new.name);
    if new.bucket_id = 'avatars' and folder is not null then
      perform pg_advisory_xact_lock(hashtextextended('campusclutch-avatar:' || folder::text,0));
      select count(*), coalesce(bool_or(slot=1),false) into used, first_taken
        from account_private.avatar_files where profile_id=folder;
      if used >= 2 then
        raise exception using errcode='23514', message='Your previous photo is being cleaned up. Try again shortly.';
      end if;
      insert into account_private.avatar_files(name,profile_id,slot,cleanup_after)
        values(new.name,folder,case when first_taken then 2 else 1 end,
          case when exists(select 1 from public.profiles p where p.id=folder and p.avatar_path=new.name)
               then null else clock_timestamp()+interval '1 hour' end);
    end if;
  end if;
  return null;
end
$$;

create function account_private.track_profile_photo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.avatar_path is not distinct from old.avatar_path then return new; end if;
  end if;
  if tg_op <> 'DELETE' then
    if new.avatar_path is not null then
      update account_private.avatar_files set cleanup_after=null
        where name=new.avatar_path and profile_id=new.id and not retiring;
      if not found then
        raise exception using errcode='23514', message='Choose and upload the profile photo again.';
      end if;
    end if;
  end if;
  if tg_op <> 'INSERT' then
    if old.avatar_path is not null then
      update account_private.avatar_files set cleanup_after=clock_timestamp()
        where name=old.avatar_path and profile_id=old.id;
    end if;
  end if;
  return null;
end
$$;

-- Trigger creation takes the write locks needed for a consistent backfill.
create trigger campusclutch_avatar_inventory after insert or update of bucket_id,name or delete on storage.objects
  for each row execute function account_private.track_avatar_file();
create trigger campusclutch_profile_photo after insert or update of avatar_path or delete on public.profiles
  for each row execute function account_private.track_profile_photo();

-- Grandfather existing objects, including accounts already above budget.
-- An older unreferenced upload gets the same grace as a fresh upload.
with files as (
  select o.name, account_private.avatar_folder(o.name) as folder
  from storage.objects o where o.bucket_id='avatars'
)
insert into account_private.avatar_files(name,profile_id,slot,cleanup_after)
select f.name, f.folder, row_number() over(partition by f.folder order by (p.avatar_path=f.name) desc nulls last,f.name),
  case when p.avatar_path=f.name then null else now()+interval '1 hour' end
from files f left join public.profiles p on p.id=f.folder where f.folder is not null;

create function account_private.claim_unused_avatars() returns table(name text)
language sql volatile security definer set search_path = '' as $$
  with due as (
    select f.name from account_private.avatar_files f
    join public.profiles p on p.id=f.profile_id
    where f.cleanup_after <= statement_timestamp() and p.avatar_path is distinct from f.name
      and p.deleted_at is null
    order by f.cleanup_after,f.name limit 12 for update of f skip locked
  )
  update account_private.avatar_files f set retiring=true, cleanup_after=clock_timestamp()+interval '5 minutes'
  from due where f.name=due.name returning f.name
$$;
create function public.claim_unused_avatars() returns table(name text)
language sql volatile security invoker set search_path = '' as $$
  select * from account_private.claim_unused_avatars()
$$;
revoke all on function account_private.avatar_folder(text),account_private.track_avatar_file(),
  account_private.track_profile_photo(),account_private.claim_unused_avatars(),public.claim_unused_avatars()
  from public, anon, authenticated, service_role;
grant execute on function account_private.claim_unused_avatars(),public.claim_unused_avatars() to service_role;
commit;
