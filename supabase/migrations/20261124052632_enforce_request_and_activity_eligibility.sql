-- Account standing is private. Only self-bound entry points and server workflows
-- may use the arbitrary-recipient predicates.
begin;

create function safety_private.account_allowed_for(p_profile_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select not exists (select 1 from account_private.deletions where profile_id = p_profile_id)
     and not exists (select 1 from safety_private.account_standing
                     where profile_id = p_profile_id and suspended_until > now());
$$;
revoke all on function safety_private.account_allowed_for(uuid) from public, anon, authenticated, service_role;

create or replace function safety_private.account_allowed()
returns boolean language sql stable security definer set search_path = '' as $$
  select safety_private.account_allowed_for(auth.uid());
$$;

create function safety_private.active_student(p_profile_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.profiles p join auth.users u on u.id = p.id
    where p.id = p_profile_id and p.onboarding_completed_at is not null
      and nullif(btrim(p.display_name), '') is not null and p.deleted_at is null
      and u.deleted_at is null and not coalesce(u.is_anonymous, false)
      and (u.banned_until is null or u.banned_until <= now())
      and safety_private.account_allowed_for(p.id)
  );
$$;
revoke all on function safety_private.active_student(uuid) from public, anon, authenticated, service_role;

create or replace function safety_private.submit_report(
  p_operation_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_reason text,
  p_details text default ''
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_details text := btrim(coalesce(p_details, ''));
  v_hash bytea;
  v_existing safety_private.reports%rowtype;
  v_target_profile uuid;
  v_request_id uuid;
  v_message_id uuid;
  v_course_review_id uuid;
  v_evidence jsonb;
  v_report_id uuid;
  v_created_at timestamptz;
begin
  -- Never trust a JWT subject without a live, eligible account behind it.
  if not safety_private.active_student(v_actor) then
    raise exception using errcode = '42501', message = 'Sign in with a completed student profile to report a concern.';
  end if;

  if p_operation_id is null or p_target_id is null
     or p_target_type is null or p_target_type not in ('student', 'request', 'message', 'course_review')
     or p_reason is null or p_reason not in ('harassment', 'scam', 'unsafe', 'spam', 'other')
     or char_length(v_details) > 2000
     or (p_reason = 'other' and char_length(v_details) < 10) then
    raise exception using errcode = '22023', message = 'Invalid safety report. Choose a reason, keep details within 2,000 characters, and include at least 10 characters for Other.';
  end if;

  v_hash := extensions.digest(jsonb_build_object(
    'target_type', p_target_type, 'target_id', p_target_id,
    'reason', p_reason, 'details', v_details
  )::text, 'sha256');

  -- One lock serializes both retries and the rolling quota for this reporter.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('safety-report:' || v_actor::text, 0));
  select * into v_existing from safety_private.reports
    where reporter_id = v_actor and operation_id = p_operation_id;
  if found then
    if v_existing.payload_hash <> v_hash then
      raise exception using errcode = '22023', message = 'This report attempt was already used for different details. Start a new report.';
    end if;
    return jsonb_build_object('report_id', v_existing.id, 'created_at', v_existing.created_at);
  end if;

  -- SECURITY DEFINER bypasses source RLS. These explicit predicates mirror
  -- source visibility plus previously established safety/contact relationships.
  -- Blocking must not prevent reporting a previously reachable student.
  if p_target_type = 'student' then
    select p.id, jsonb_build_object('display_name', p.display_name)
      into v_target_profile, v_evidence
      from public.profiles p
      where p.id = p_target_id and p.id <> v_actor
        and (p.is_discoverable = true or safety_private.prior_contact(v_actor,p.id)
          or exists(select 1 from safety_private.student_blocks b
            where b.blocker_id=v_actor and b.blocked_id=p.id))
        and p.onboarding_completed_at is not null
        and p.display_name is not null
      for share;
  elsif p_target_type = 'request' then
    -- Serialize with block changes, then read visibility and evidence together.
    -- Exact receipt retries returned above do not recapture hidden evidence.
    -- Match offer acceptance's lock order: request first, student pair second.
    select r.owner_id into v_target_profile from public.requests r
      where r.id = p_target_id and r.owner_id <> v_actor for share;
    if found then
      perform safety_private.lock_pair(v_actor, v_target_profile);
    end if;
    select r.owner_id, r.id, jsonb_build_object(
      'title', r.title, 'description', r.description, 'category', r.category,
      'points', r.points, 'status', r.status
    ) into v_target_profile, v_request_id, v_evidence
      from public.requests r
      where r.id = p_target_id and r.owner_id <> v_actor
        and r.moderation_removed_at is null
        and ((r.status = 'open' and r.deadline_at > statement_timestamp()
              and not safety_private.student_blocked(r.owner_id))
          or request_private.is_accepted_helper(r.id)
          or request_private.has_request_assignment(r.id))
      for share;
  else
    select target.reported_profile_id, target.evidence into v_target_profile, v_evidence
      from safety_private.content_report_target(p_target_type, p_target_id, v_actor) target;
    -- Assignments preserve FOUND from the source lookup above.
    v_message_id := case when p_target_type = 'message' then p_target_id end;
    v_course_review_id := case when p_target_type = 'course_review' then p_target_id end;
  end if;
  if not found then
    -- Identical response for a missing, hidden, or self-owned target.
    raise exception using errcode = '42501', message = 'This report target is not available.';
  end if;

  if (select count(*) from safety_private.reports
      where reporter_id = v_actor and created_at >= clock_timestamp() - interval '24 hours') >= 10 then
    raise exception using errcode = '54000', message = 'You can submit up to 10 reports in 24 hours. Please try again later.';
  end if;

  insert into safety_private.reports (
    reporter_id, operation_id, target_type, reported_profile_id, request_id, message_id, course_review_id,
    reason, details, payload_hash, evidence
  ) values (
    v_actor, p_operation_id, p_target_type, v_target_profile, v_request_id, v_message_id, v_course_review_id,
    p_reason, v_details, v_hash, v_evidence
  ) returning id, created_at into v_report_id, v_created_at;
  return jsonb_build_object('report_id', v_report_id, 'created_at', v_created_at);
end;
$$;

create or replace function request_private.decide_offer_core(p_offer_id uuid, p_action text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid:=auth.uid(); v_request_id uuid; v_request public.requests; v_offer public.request_offers;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_action is null or p_action not in ('accepted','rejected','withdrawn') then
   raise exception 'Invalid offer action' using errcode='22023'; end if;
 select request_id into v_request_id from public.request_offers where id=p_offer_id;
 -- Every mutation locks parent first, then reads offer state after waiting.
 select * into v_request from public.requests where id=v_request_id for update;
 select * into v_offer from public.request_offers where id=p_offer_id for update;
 if not found or (p_action='withdrawn' and v_offer.offering_user_id<>v_user)
   or (p_action<>'withdrawn' and v_request.owner_id<>v_user) then
   raise exception 'Offer unavailable' using errcode='42501'; end if;
 -- A repeated acceptance must not reserve twice or charge historical acceptance.
 if v_offer.status=p_action then return p_offer_id; end if;
 if v_offer.status<>'pending' or v_request.status<>'open' or v_request.deadline_at<=clock_timestamp() then
   raise exception 'Offer is no longer pending on an open request' using errcode='22023'; end if;
 if p_action='accepted' then
   perform safety_private.require_unblocked_peer(v_offer.offering_user_id);
   -- Enforcement and appeals lock this same profile before changing standing.
   -- Recheck in a fresh statement after waiting, before taking the wallet lock.
   perform 1 from public.profiles where id = v_offer.offering_user_id for share;
   if not safety_private.active_student(v_offer.offering_user_id) then
     raise exception 'Helper is not eligible' using errcode='22023'; end if;
   -- UPDATE rechecks available balance after waiting on another request's wallet
   -- lock, preventing two simultaneous acceptances from spending the same points.
   update public.points_wallets set reserved=reserved+v_request.points,updated_at=clock_timestamp()
   where profile_id=v_request.owner_id and balance-reserved>=v_request.points;
   if not found then raise exception 'Not enough available points to accept this helper' using errcode='P0002'; end if;
   insert into public.request_point_reservations(request_id,offer_round,poster_id,helper_id,amount)
   values(v_request.id,v_request.offer_round,v_request.owner_id,v_offer.offering_user_id,v_request.points);
   update public.requests set status='accepted',accepted_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_request.id;
 end if;
 update public.request_offers set status=p_action,updated_at=clock_timestamp(),
 decided_at=case when p_action<>'withdrawn' then clock_timestamp() end,
 withdrawn_at=case when p_action='withdrawn' then clock_timestamp() end where id=p_offer_id;
 if p_action='accepted' then
   update public.request_offers set status='rejected',updated_at=clock_timestamp(),decided_at=clock_timestamp()
   where request_id=v_request.id and status='pending';
 end if;
 return p_offer_id;
end $function$;

create or replace function messaging_private.realtime_actor()
returns uuid language sql stable security definer set search_path = '' as $$
  select auth.uid() where safety_private.active_student(auth.uid());
$$;

-- Subscription authorization is cached. Check the recipient again whenever
-- sending to an existing connection, including block and peer receipt changes.
create function messaging_private.send_activity(p_recipient uuid, p_conversation uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if safety_private.active_student(p_recipient) then
    perform realtime.send(jsonb_build_object('conversation_id', p_conversation),
      'messages_changed', 'messages:' || p_recipient::text, true);
  end if;
end;
$$;
revoke all on function messaging_private.send_activity(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function messaging_private.broadcast_direct_invalidation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_profile uuid;
begin
  if not exists (select 1 from public.conversations conversation
    where conversation.id = new.conversation_id
      and conversation.type = 'direct' and conversation.status <> 'removed') then
    return new;
  end if;

  if tg_table_name = 'conversation_members' then
    -- Only a changed cursor needs a refetch.
    if tg_op = 'UPDATE' and new.last_read_sequence = old.last_read_sequence then
      return new;
    end if;
    perform messaging_private.send_activity(new.profile_id, new.conversation_id);
  else
    for v_profile in
      select member.profile_id from public.conversation_members member
      where member.conversation_id = new.conversation_id and member.membership_status = 'active'
    loop
      perform messaging_private.send_activity(v_profile, new.conversation_id);
    end loop;
  end if;
  return new;
end;
$$;

create or replace function messaging_private.record_direct_message_reads()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_peer uuid;
begin
  if new.last_read_sequence <= old.last_read_sequence
    or not exists (select 1 from public.conversations c
      where c.id = new.conversation_id and c.type = 'direct' and c.status <> 'removed') then
    return new;
  end if;
  insert into messaging_private.direct_message_reads(message_id, read_at)
  select message.id, coalesce(new.last_read_at, clock_timestamp())
  from public.messages message
  where message.conversation_id = new.conversation_id
    and message.sender_id <> new.profile_id
    and message.sequence > old.last_read_sequence and message.sequence <= new.last_read_sequence
  on conflict (message_id) do nothing;

  -- The existing cursor trigger notifies the reader. Tell only eligible peers
  -- to refetch their own receipts; no message text or read time is broadcast.
  for v_peer in
    select member.profile_id from public.conversation_members member
    where member.conversation_id = new.conversation_id and member.profile_id <> new.profile_id
      and member.membership_status = 'active'
  loop
    perform messaging_private.send_activity(v_peer, new.conversation_id);
  end loop;
  return new;
end;
$$;

create or replace function safety_private.set_block(p_profile_id uuid,p_blocked boolean,p_expected_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=safety_private.require_actor(); own_state safety_private.student_blocks;
  current_revision bigint; current_blocked boolean; chat uuid; peer uuid;
begin
  if p_profile_id is null or p_profile_id=actor or p_blocked is null
    or p_expected_revision is null or p_expected_revision<0 then
    raise exception 'Invalid block change' using errcode='22023'; end if;
  perform safety_private.lock_pair(actor,p_profile_id);
  -- A fresh statement after the lock sees any previously committed transition.
  perform safety_private.require_actor();
  if not safety_private.block_target_available(actor,p_profile_id) then
    raise exception 'Student unavailable' using errcode='42501'; end if;
  select * into own_state from safety_private.student_blocks where blocker_id=actor and blocked_id=p_profile_id;
  current_revision:=coalesce(own_state.revision,0);
  current_blocked:=coalesce(own_state.is_blocked,false);
  if current_revision<>p_expected_revision then
    if current_revision>0 and current_revision-1=p_expected_revision
      and current_blocked=p_blocked then return safety_private.block_state(p_profile_id); end if;
    -- This is an application conflict, not PostgreSQL serialization failure.
    -- PT409 avoids PostgREST transparently retrying a permanently stale intent.
    raise exception 'Block settings changed. Refresh and try again.' using errcode='PT409';
  end if;
  if current_blocked=p_blocked then return safety_private.block_state(p_profile_id); end if;
  if current_revision=9223372036854775807 then
    raise exception 'Block settings cannot be updated' using errcode='54000'; end if;
  insert into safety_private.student_blocks(blocker_id,blocked_id,is_blocked,revision,blocked_at)
    values(actor,p_profile_id,p_blocked,current_revision+1,case when p_blocked then clock_timestamp() end)
  on conflict(blocker_id,blocked_id) do update set is_blocked=excluded.is_blocked,
    revision=excluded.revision,blocked_at=excluded.blocked_at,updated_at=clock_timestamp();
  -- Payload reveals no block choice or direction. Clients refetch their own
  -- authorized summary, including an already-open conversation.
  select conversation_id into chat from public.direct_conversation_pairs
    where user_low_id=least(actor,p_profile_id) and user_high_id=greatest(actor,p_profile_id);
  if chat is not null then
    foreach peer in array array[actor,p_profile_id] loop
      perform messaging_private.send_activity(peer, chat);
    end loop;
  end if;
  return safety_private.block_state(p_profile_id);
end $$;

create or replace function notifications_private.broadcast_changes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_recipient uuid;
begin
  for v_recipient in
    select distinct notice.recipient_id from changed_notifications notice
  loop
    if safety_private.active_student(v_recipient) then
      perform realtime.send('{}'::jsonb, 'notifications_changed', 'notifications:' || v_recipient::text, true);
    end if;
  end loop;
  return null;
end;
$$;

commit;
