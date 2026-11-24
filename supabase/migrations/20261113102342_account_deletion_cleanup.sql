begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- The minimal profile/Auth tombstone preserves shared messages and settled-job
-- foreign keys. It is not a discoverable student profile.
alter table public.profiles add column deleted_at timestamptz;
create table account_private.deletions (
  id uuid primary key,
  profile_id uuid not null unique references public.profiles(id),
  receipt_hash bytea not null check(octet_length(receipt_hash)=32),
  requested_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  lease_id uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  due_at timestamptz not null default clock_timestamp()
);
alter table account_private.deletions enable row level security;
revoke all on account_private.deletions from public,anon,authenticated,service_role;
create index deletions_pending_idx on account_private.deletions(due_at) where completed_at is null;

create or replace function safety_private.account_allowed() returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(select 1 from account_private.deletions where profile_id=auth.uid())
    and not exists(select 1 from safety_private.account_standing
      where profile_id=auth.uid() and suspended_until>now());
$$;

-- Covers writes that passed their initial RPC permission check just before a
-- deletion. A fresh trigger query runs after the deletion's table locks release.
create function account_private.reject_deleted_writer() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is not null and exists(select 1 from account_private.deletions where profile_id=auth.uid()) then
    raise exception using errcode='42501',message='This account has been deleted.';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function account_private.reject_deleted_writer() from public,anon,authenticated,service_role;
do $$ declare t record; begin
  for t in select schemaname,tablename from pg_tables where schemaname='public'
    or schemaname in ('safety_private','course_reviews_private','messaging_private','notifications_private') loop
    execute format('create trigger account_deletion_writer_guard before insert or update or delete on %I.%I for each row execute function account_private.reject_deleted_writer()',t.schemaname,t.tablename);
  end loop;
end $$;

-- A client cannot assign staff privileges, but owner tooling must also refuse
-- to enable a deleted identity after the deletion's staff-role lock releases.
create function account_private.reject_deleted_staff() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.enabled and exists(select 1 from account_private.deletions where profile_id=new.profile_id) then
    raise exception using errcode='23514',message='Deleted accounts cannot receive staff access.';
  end if;
  return new;
end $$;
revoke all on function account_private.reject_deleted_staff() from public,anon,authenticated,service_role;
create trigger account_deletion_staff_guard before insert or update on safety_private.staff_roles
for each row execute function account_private.reject_deleted_staff();

create function account_private.begin_deletion(p_operation_id uuid,p_receipt_secret text,p_confirmation text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare actor uuid:=auth.uid(); readiness jsonb; existing account_private.deletions;
  claims text:=current_setting('request.jwt.claims',true);
  legacy_sub text:=current_setting('request.jwt.claim.sub',true); t record;
begin
  if actor is null or p_operation_id is null or p_receipt_secret is null
    or p_receipt_secret !~ '^[0-9a-f]{64}$' or p_confirmation is distinct from 'DELETE' then
    raise exception using errcode='22023',message='Confirm account deletion.';
  end if;
  -- Rare, short transaction. Serializing application writes makes the accepted
  -- work check atomic against acceptance/settlement and avoids a check/use gap.
  -- Lock timeout rolls back everything; ordinary reads continue throughout.
  for t in select tablename from pg_tables where schemaname='public' order by tablename loop
    execute format('lock table public.%I in share row exclusive mode',t.tablename);
  end loop;
  lock table safety_private.staff_roles,course_reviews_private.reviews,notifications_private.push_preferences in share row exclusive mode;
  select * into existing from account_private.deletions where profile_id=actor;
  if found then
    if existing.id=p_operation_id and existing.receipt_hash=extensions.digest(p_receipt_secret,'sha256') then
      return jsonb_build_object('accepted',true);
    end if;
    raise exception using errcode='42501',message='A deletion is already in progress.';
  end if;
  perform 1 from auth.users where id=actor for update;
  readiness:=account_private.deletion_preflight();
  if not (readiness->>'eligible')::boolean then
    return jsonb_build_object('accepted',false,'blockers',readiness->'blockers');
  end if;

  -- Internal cleanup still fires ordinary integrity/history triggers, but is
  -- not a student mutation. The actor was fixed and authorized above.
  perform set_config('request.jwt.claims','{}',true);
  perform set_config('request.jwt.claim.sub','',true);
  update public.requests set status='cancelled',cancelled_at=clock_timestamp()
    where owner_id=actor and status in ('open','expired');
  update public.request_offers set status='withdrawn',withdrawn_at=clock_timestamp(),decided_at=null
    where offering_user_id=actor and status='pending';
  update public.requests set title='Deleted request',description='This student deleted their account.',
    room_location='Removed',is_urgent=false,owner_archived_at=coalesce(owner_archived_at,clock_timestamp()) where owner_id=actor;
  update public.delivery_request_details set pickup_location='Removed',dropoff_location='Removed'
    where request_id in(select id from public.requests where owner_id=actor);
  update public.pickup_request_details set pickup_location='Removed',destination='Removed'
    where request_id in(select id from public.requests where owner_id=actor);
  update public.event_help_request_details set event_name='Removed',help_needed='Removed'
    where request_id in(select id from public.requests where owner_id=actor);
  update public.study_help_request_details set course_or_subject='Removed',topic='Removed'
    where request_id in(select id from public.requests where owner_id=actor);
  update public.request_offers set message=null where offering_user_id=actor;
  update public.request_offer_history set message=null where offer_id in(select id from public.request_offers where offering_user_id=actor);
  delete from public.course_memberships where profile_id=actor;
  delete from course_reviews_private.reviews where author_id=actor;
  delete from public.profile_interests where profile_id=actor;
  delete from public.profile_social_links where profile_id=actor;
  delete from notifications_private.push_preferences where profile_id=actor;
  delete from public.notifications where recipient_id=actor;
  delete from public.offer_notifications where recipient_id=actor;
  update public.notifications set actor_id=null,title='CampusClutch',body='An update is available.' where actor_id=actor;
  update public.conversations set status='closed',updated_at=clock_timestamp() where type='direct'
    and id in(select conversation_id from public.conversation_members where profile_id=actor);
  -- Group messaging is deferred, but retained historical groups must not give
  -- this identity an active membership or leave an ownerless active group.
  update public.conversations set status='closed' where type='group' and created_by=actor;
  update public.group_membership_periods p set ends_at_sequence=c.last_message_sequence,
    ended_at=clock_timestamp(),end_reason='left' from public.conversations c
    where p.conversation_id=c.id and p.profile_id=actor and p.ends_at_sequence is null;
  update public.conversation_members set membership_status='left',ended_at=clock_timestamp()
    where profile_id=actor and conversation_id in(select id from public.conversations where type='group');
  -- Counterparties retain their ledger and settled reservations. The deleted
  -- student's wallet/history are cleared; no points are sent to another user.
  -- The email fingerprint welcome-grant ledger is intentionally untouched.
  delete from public.points_ledger where profile_id=actor;
  update public.points_wallets set balance=0,updated_at=clock_timestamp() where profile_id=actor;
  update public.profiles set display_name='Deleted student',major=null,year_of_study=null,
    campus_id=null,avatar_path=null,is_discoverable=false,deleted_at=clock_timestamp() where id=actor;
  insert into account_private.deletions(id,profile_id,receipt_hash)
    values(p_operation_id,actor,extensions.digest(p_receipt_secret,'sha256'));
  delete from auth.sessions where user_id=actor;
  -- Session-linked device registrations cascade; handle any legacy registrations.
  delete from notifications_private.android_push_devices where profile_id=actor;
  perform set_config('request.jwt.claims',coalesce(claims,'{}'),true);
  perform set_config('request.jwt.claim.sub',coalesce(legacy_sub,''),true);
  return jsonb_build_object('accepted',true);
end $$;
create function public.begin_my_account_deletion(p_operation_id uuid,p_receipt_secret text,p_confirmation text)
returns jsonb language sql security invoker set search_path='' as $$
  select account_private.begin_deletion(p_operation_id,p_receipt_secret,p_confirmation);
$$;
revoke all on function account_private.begin_deletion(uuid,text,text),public.begin_my_account_deletion(uuid,text,text)
from public,anon,authenticated,service_role;
grant execute on function account_private.begin_deletion(uuid,text,text),public.begin_my_account_deletion(uuid,text,text) to authenticated;

-- These worker endpoints are service-only. A student-facing Edge request must
-- supply the exact random receipt; the server's scheduled mode supplies NULLs.
create function account_private.claim_deletion(p_id uuid,p_secret text) returns jsonb
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
  if not found then return jsonb_build_object('status','unconfirmed'); end if;
  if job.completed_at is not null then return jsonb_build_object('status','complete'); end if;
  if job.lease_until>clock_timestamp() then return jsonb_build_object('status','pending'); end if;
  update account_private.deletions set lease_id=lease,lease_until=clock_timestamp()+interval '2 minutes',
    attempts=attempts+1,due_at=clock_timestamp()+interval '5 minutes' where id=job.id;
  return jsonb_build_object('status','claimed','id',job.id,'profile_id',job.profile_id,'lease',lease);
end $$;
create function public.claim_account_deletion(p_id uuid,p_secret text) returns jsonb
language sql security invoker set search_path='' as $$select account_private.claim_deletion(p_id,p_secret)$$;

create function account_private.deletion_assets(p_id uuid,p_lease uuid) returns jsonb
language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('bucket',o.bucket_id,'name',o.name)),'[]'::jsonb)
 from (select s.bucket_id,s.name from storage.objects s join account_private.deletions d
   on d.id=p_id and d.lease_id=p_lease and d.completed_at is null
   where s.owner_id=d.profile_id::text or (s.bucket_id='avatars' and split_part(s.name,'/',1)=d.profile_id::text)
   order by s.bucket_id,s.name limit 100) o;
$$;
create function public.account_deletion_assets(p_id uuid,p_lease uuid) returns jsonb
language sql security invoker set search_path='' as $$select account_private.deletion_assets(p_id,p_lease)$$;
create function account_private.finish_deletion(p_id uuid,p_lease uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare job account_private.deletions;
begin
 select * into job from account_private.deletions where id=p_id and lease_id=p_lease for update;
 if not found then return false; end if;
 if not exists(select 1 from auth.users where id=job.profile_id and deleted_at is not null)
   or exists(select 1 from storage.objects where owner_id=job.profile_id::text
     or (bucket_id='avatars' and split_part(name,'/',1)=job.profile_id::text)) then
   raise exception using errcode='55000',message='Account cleanup is not complete.';
 end if;
 update account_private.deletions set completed_at=coalesce(completed_at,clock_timestamp()),lease_until=null where id=p_id;
 return true;
end $$;
create function public.finish_account_deletion(p_id uuid,p_lease uuid) returns boolean
language sql security invoker set search_path='' as $$select account_private.finish_deletion(p_id,p_lease)$$;
grant usage on schema account_private to service_role;
revoke all on function account_private.claim_deletion(uuid,text),public.claim_account_deletion(uuid,text),
account_private.deletion_assets(uuid,uuid),public.account_deletion_assets(uuid,uuid),
account_private.finish_deletion(uuid,uuid),public.finish_account_deletion(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function account_private.claim_deletion(uuid,text),public.claim_account_deletion(uuid,text),
account_private.deletion_assets(uuid,uuid),public.account_deletion_assets(uuid,uuid),
account_private.finish_deletion(uuid,uuid),public.finish_account_deletion(uuid,uuid) to service_role;

-- Keep tombstones out of public/student discovery and all future direct contact.
create policy deleted_profile_hidden on public.profiles as restrictive for select to authenticated using(deleted_at is null);
-- Existing profile APIs require completed onboarding; prevent the automatic
-- profile trigger from completing tombstones while keeping their display label.
create function account_private.tombstone_profile() returns trigger
language plpgsql set search_path='' as $$begin
 if new.deleted_at is not null then new.onboarding_completed_at:=null; end if; return new;
end $$;
revoke all on function account_private.tombstone_profile() from public,anon,authenticated,service_role;
create trigger zz_tombstone_profile before insert or update on public.profiles for each row execute function account_private.tombstone_profile();
-- Preserve the existing summary/read-receipt contract and expose only a
-- boolean tombstone marker, so older read-only chats still allow profile taps.
do $$ declare definition text; needle text:='''other_profile_id'', counterpart.id,'; begin
 select pg_get_functiondef('messaging_private.summary(uuid)'::regprocedure) into definition;
 if strpos(definition,needle)=0 then raise exception 'Unexpected conversation summary definition'; end if;
 execute replace(definition,needle,needle||' ''other_profile_deleted'', coalesce(counterpart.deleted_at is not null,false),');
end $$;
notify pgrst,'reload schema';
commit;
