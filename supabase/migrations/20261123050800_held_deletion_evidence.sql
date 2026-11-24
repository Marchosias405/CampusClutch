begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- A batch belongs to one record at one deletion. Several holds share the
-- same pieces of evidence, but a later hold never inherits an earlier copy.
create table safety_private.deletion_evidence_batches (
  id uuid primary key default gen_random_uuid(),
  target_kind text not null check (target_kind in ('case','job','thread','notice')),
  target_id uuid not null,
  captured_at timestamptz not null default clock_timestamp()
);
create index deletion_evidence_record_idx on safety_private.deletion_evidence_batches(target_kind,target_id);
create table safety_private.deletion_evidence_coverage (
  batch_id uuid not null references safety_private.deletion_evidence_batches(id) on delete cascade,
  hold_id uuid not null references safety_private.retention_holds(id) on delete restrict,
  primary key (batch_id,hold_id)
);
create index deletion_evidence_hold_idx on safety_private.deletion_evidence_coverage(hold_id);
create table safety_private.deletion_evidence_items (
  id bigint generated always as identity primary key,
  batch_id uuid not null references safety_private.deletion_evidence_batches(id) on delete cascade,
  label text not null,
  fields jsonb not null check (jsonb_typeof(fields)='object')
);
create index deletion_evidence_items_batch_idx on safety_private.deletion_evidence_items(batch_id,id);
alter table safety_private.deletion_evidence_batches enable row level security;
alter table safety_private.deletion_evidence_coverage enable row level security;
alter table safety_private.deletion_evidence_items enable row level security;
revoke all on safety_private.deletion_evidence_batches,safety_private.deletion_evidence_coverage,
  safety_private.deletion_evidence_items from public,anon,authenticated,service_role;
revoke all on sequence safety_private.deletion_evidence_items_id_seq from public,anon,authenticated,service_role;

-- Invoked only by the authorized deletion transaction after its preflight.
-- Explicit fields keep new columns out of evidence until deliberately reviewed.
create or replace function account_private.capture_held_deletion_evidence(p_actor uuid) returns void
language sql volatile security invoker set search_path='' as $$
  with active as materialized (
    select h.id,h.target_kind,h.target_id from safety_private.retention_holds h
    where not exists (select from safety_private.retention_hold_releases x where x.hold_id=h.id)
  ), targets as (
    select distinct target_kind,target_id from active
  ), pieces(kind,target_id,label,fields) as materialized (
    select 'job',r.id,'Request',jsonb_strip_nulls(jsonb_build_object(
      'Title',r.title,'Description',r.description,'Location',r.room_location,'Status',r.status,'Urgent',r.is_urgent,
      'Pickup',coalesce(d.pickup_location,p.pickup_location),'Drop-off',d.dropoff_location,'Destination',p.destination,
      'Event',e.event_name,'Help needed',e.help_needed,'Course or subject',s.course_or_subject,'Topic',s.topic))
    from targets t join public.requests r on t.target_kind='job' and t.target_id=r.id
    left join public.delivery_request_details d on d.request_id=r.id
    left join public.pickup_request_details p on p.request_id=r.id
    left join public.event_help_request_details e on e.request_id=r.id
    left join public.study_help_request_details s on s.request_id=r.id
    where r.owner_id=p_actor
    union all
    select 'job',o.request_id,'Offer',jsonb_strip_nulls(jsonb_build_object(
      'Offer',o.id,'Round',o.offer_round,'Status',o.status,'Message',o.message))
    from targets t join public.request_offers o on t.target_kind='job' and t.target_id=o.request_id
    where o.offering_user_id=p_actor and (o.message is not null or o.status='pending')
    union all
    -- Cancelling the owner's request also rejects other students' pending
    -- offers. Their text survives, so keep only the affected offer state.
    select 'job',r.id,'Offer before cancellation',jsonb_build_object('Offer',o.id,'Round',o.offer_round,'Status',o.status)
    from targets t join public.requests r on t.target_kind='job' and t.target_id=r.id
    join public.request_offers o on o.request_id=r.id
    where r.owner_id=p_actor and r.status in ('open','expired') and o.status='pending' and o.offering_user_id<>p_actor
    union all
    select 'job',o.request_id,'Offer history',jsonb_build_object('Offer',o.id,'Round',v.offer_round,
      'Status',v.status,'Recorded',v.recorded_at,'Message',v.message)
    from targets t join public.request_offers o on t.target_kind='job' and t.target_id=o.request_id
    join public.request_offer_history v on v.offer_id=o.id
    where o.offering_user_id=p_actor and v.message is not null
    union all
    select 'job',l.request_id,'Points transfer',jsonb_build_object('Entry',l.kind,'Amount',l.amount,'Round',l.offer_round,'Recorded',l.created_at)
    from targets t join public.points_ledger l on t.target_kind='job' and t.target_id=l.request_id
    where l.profile_id=p_actor
    union all
    select 'job',n.request_id,'Offer event',jsonb_build_object('Event',n.event_type,'Offer',n.offer_id,'Round',n.offer_round,'Recorded',n.created_at)
    from targets t join public.offer_notifications n on t.target_kind='job' and t.target_id=n.request_id
    where n.recipient_id=p_actor
    union all
    select 'notice',n.id,'Bell notice',jsonb_strip_nulls(jsonb_build_object('Title',n.title,'Text',n.body,
      'Event',n.event_type,'Created',n.created_at,'Read',n.read_at,'Sender',n.actor_id))
    from targets t join public.notifications n on t.target_kind='notice' and t.target_id=n.id
    where n.recipient_id=p_actor or n.actor_id=p_actor
    union all
    select 'thread',c.id,'Conversation before closure',jsonb_build_object('Status',c.status,'Last updated',c.updated_at)
    from targets t join public.conversations c on t.target_kind='thread' and t.target_id=c.id
    where c.type='direct' and exists (select from public.conversation_members m where m.conversation_id=c.id and m.profile_id=p_actor)
    union all
    select 'case',r.id,'Reported review reference',jsonb_build_object('Review ID',r.course_review_id)
    from targets t join safety_private.reports r on t.target_kind='case' and t.target_id=r.id
    join course_reviews_private.reviews v on v.id=r.course_review_id where v.author_id=p_actor
  ), batches as (
    insert into safety_private.deletion_evidence_batches(target_kind,target_id)
    select distinct kind,target_id from pieces returning id,target_kind,target_id
  ), coverage as (
    insert into safety_private.deletion_evidence_coverage(batch_id,hold_id)
    select b.id,a.id from batches b join active a using (target_kind,target_id)
  )
  insert into safety_private.deletion_evidence_items(batch_id,label,fields)
  select b.id,p.label,p.fields from batches b join pieces p on p.kind=b.target_kind and p.target_id=b.target_id;
$$;
revoke all on function account_private.capture_held_deletion_evidence(uuid) from public,anon,authenticated,service_role;

create function safety_private.read_held_deletion_evidence(p_kind text,p_id uuid,p_before bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform safety_private.require_retention_admin(p_kind,p_id);
  if p_id is null or p_kind is null or p_kind not in ('job','case','notice','thread') or p_before<=0 then
    raise exception using errcode='22023',message='Invalid evidence record.';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',q.id::text,'label',q.label,
      'captured_at',q.captured_at,'fields',q.fields) order by q.id desc),'[]'::jsonb)
    from (select i.id,i.label,i.fields,b.captured_at
      from safety_private.deletion_evidence_batches b join safety_private.deletion_evidence_items i on i.batch_id=b.id
      where b.target_kind=p_kind and b.target_id=p_id and (p_before is null or i.id<p_before)
      and exists(select from safety_private.deletion_evidence_coverage c where c.batch_id=b.id
        and not exists(select from safety_private.retention_hold_releases x where x.hold_id=c.hold_id))
      order by i.id desc limit 20) q);
end $$;
create function public.get_held_deletion_evidence(p_kind text,p_id uuid,p_before bigint default null)
returns jsonb language sql security invoker set search_path='' as $$
  select safety_private.read_held_deletion_evidence(p_kind,p_id,p_before)
$$;
revoke all on function safety_private.read_held_deletion_evidence(text,uuid,bigint),
  public.get_held_deletion_evidence(text,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function safety_private.read_held_deletion_evidence(text,uuid,bigint),
  public.get_held_deletion_evidence(text,uuid,bigint) to authenticated;

-- Hold mutations and confirmed deletions take this lock before locking sessions,
-- source records or staff roles. A row version also makes an outdated
-- repeatable-read transaction retry rather than silently missing a new hold.
create table account_private.retention_write_gate (
  singleton boolean primary key check(singleton),
  version bigint not null
);
insert into account_private.retention_write_gate values(true,0);
alter table account_private.retention_write_gate enable row level security;
revoke all on account_private.retention_write_gate from public,anon,authenticated,service_role;

create or replace function safety_private.change_retention_hold(p_action text,p_kind text,p_id uuid,p_hold_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  explanation text := regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
  placement safety_private.retention_holds;
  prior_release safety_private.retention_hold_releases;
begin
  update account_private.retention_write_gate set version=version+1 where singleton;
  actor := safety_private.require_retention_admin(p_kind,p_id);
  if p_action is null or p_action not in ('place','release') or p_id is null or p_hold_id is null
    or p_kind is null or p_kind not in ('case','job','thread','notice')
    or explanation is null or char_length(explanation) not between 10 and 2000 then
    raise exception using errcode='22023',message='Choose a record and give a reason of 10 to 2,000 characters.';
  end if;
  -- Serializes retries, including an overlapping release before a placement commits.
  perform pg_advisory_xact_lock(hashtextextended(p_hold_id::text, 1472));
  select * into placement from safety_private.retention_holds where id=p_hold_id;
  if p_action='place' then
    if found then
      if (placement.target_kind,placement.target_id,placement.placed_by,placement.reason)
          is distinct from (p_kind,p_id,actor,explanation) then
        raise exception using errcode='PT409',message='This hold reference has already been used.';
      end if;
    else
      perform safety_private.check_retention_target(p_kind,p_id);
      insert into safety_private.retention_holds(id,target_kind,target_id,placed_by,reason)
        values(p_hold_id,p_kind,p_id,actor,explanation);
    end if;
  else
    if not found or (placement.target_kind,placement.target_id) is distinct from (p_kind,p_id) then
      raise exception using errcode='PT404',message='Hold unavailable for this record.';
    end if;
    select * into prior_release from safety_private.retention_hold_releases where hold_id=p_hold_id;
    if not found then
      insert into safety_private.retention_hold_releases(hold_id,released_by,reason) values(p_hold_id,actor,explanation);
    elsif (prior_release.released_by,prior_release.reason) is distinct from (actor,explanation) then
      raise exception using errcode='PT409',message='Another release is already recorded.';
    end if;
  end if;
  return p_hold_id;
end $$;

create or replace function account_private.begin_deletion(p_operation_id uuid,p_receipt_secret text,p_confirmation text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare actor uuid:=auth.uid(); readiness jsonb; existing account_private.deletions;
  claims text:=current_setting('request.jwt.claims',true);
  legacy_sub text:=current_setting('request.jwt.claim.sub',true); t record;
begin
  if actor is null or p_operation_id is null or p_receipt_secret is null
    or p_receipt_secret !~ '^[0-9a-f]{64}$' or p_confirmation is distinct from 'DELETE' then
    raise exception using errcode='22023',message='Confirm account deletion.';
  end if;
  update account_private.retention_write_gate set version=version+1 where singleton;
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

  perform account_private.capture_held_deletion_evidence(actor);

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
  -- Retain the exact remaining balance for the same verified email. The old
  -- wallet is cleared below, so the points cannot be spent by both identities.
  perform points_private.retain_deleted_balance(actor);
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

commit;
