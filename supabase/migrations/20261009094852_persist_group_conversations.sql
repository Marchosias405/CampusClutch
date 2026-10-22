-- Task 10 checkpoint 3: course-scoped, invite-only group conversations.
-- Direct-message rows and request links keep their existing behavior. Group
-- members receive message access only for immutable active-membership periods.

alter table public.conversations
  drop constraint conversations_type_check;
alter table public.conversations
  add constraint conversations_type_check check (type in ('direct', 'group'));

alter table public.conversation_members
  add column role text not null default 'member',
  add column membership_status text not null default 'active',
  add column ended_at timestamptz,
  add constraint conversation_members_role_check
    check (role in ('owner', 'administrator', 'member')),
  add constraint conversation_members_status_check
    check (membership_status in ('active', 'left', 'removed')),
  add constraint conversation_members_end_state_check
    check ((membership_status = 'active' and ended_at is null)
      or (membership_status in ('left', 'removed') and ended_at is not null)),
  add constraint conversation_members_timestamp_check
    check (ended_at is null or ended_at >= joined_at);

create index conversation_members_conversation_status_role_idx
  on public.conversation_members(conversation_id, membership_status, role, profile_id);
create index conversation_members_profile_status_activity_idx
  on public.conversation_members(profile_id, membership_status, conversation_id);

create table public.group_conversations (
  conversation_id uuid primary key references public.conversations(id) on delete restrict,
  course_id uuid not null references public.courses(id) on delete restrict,
  creator_id uuid not null references public.profiles(id) on delete restrict,
  client_creation_id uuid not null,
  title text not null check (char_length(title) between 1 and 80 and title = btrim(title)),
  initial_title text not null
    check (char_length(initial_title) between 1 and 80 and initial_title = btrim(initial_title)),
  management_revision bigint not null default 0 check (management_revision >= 0),
  created_at timestamptz not null default clock_timestamp(),
  unique (creator_id, client_creation_id)
);
create index group_conversations_course_idx on public.group_conversations(course_id, conversation_id);

create table public.group_membership_periods (
  conversation_id uuid not null,
  profile_id uuid not null,
  period_number integer not null check (period_number > 0),
  starts_after_sequence bigint not null check (starts_after_sequence >= 0),
  ends_at_sequence bigint check (ends_at_sequence is null or ends_at_sequence >= starts_after_sequence),
  end_reason text check (end_reason in ('left', 'removed')),
  visible_group_title text
    check (visible_group_title is null or (
      char_length(visible_group_title) between 1 and 80
      and visible_group_title = btrim(visible_group_title)
    )),
  started_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  primary key (conversation_id, profile_id, period_number),
  foreign key (conversation_id, profile_id)
    references public.conversation_members(conversation_id, profile_id) on delete restrict,
  check ((ends_at_sequence is null and ended_at is null and end_reason is null)
    or (ends_at_sequence is not null and ended_at is not null and end_reason is not null)),
  check (ended_at is null or ended_at >= started_at)
);
create unique index group_membership_periods_open_uidx
  on public.group_membership_periods(conversation_id, profile_id)
  where ends_at_sequence is null;
create index group_membership_periods_visibility_idx
  on public.group_membership_periods(conversation_id, profile_id,
    starts_after_sequence, ends_at_sequence);

-- Existing direct members have always had access to the full direct history.
insert into public.group_membership_periods(
  conversation_id, profile_id, period_number, starts_after_sequence, started_at
)
select conversation_id, profile_id, 1, 0, joined_at
from public.conversation_members;

-- The existing direct-pair function inserts conversation_members after this
-- migration. Give each future direct member the same permanent visibility
-- period as the legacy rows without changing the direct RPC.
create function messaging_private.initialize_direct_membership_period()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.conversations c
    where c.id = new.conversation_id and c.type = 'direct') then
    insert into public.group_membership_periods(
      conversation_id, profile_id, period_number, starts_after_sequence, started_at
    ) values (new.conversation_id, new.profile_id, 1, 0, new.joined_at)
    on conflict (conversation_id, profile_id, period_number) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function messaging_private.initialize_direct_membership_period()
  from public, anon, authenticated;
create trigger initialize_direct_membership_period
after insert on public.conversation_members for each row
execute function messaging_private.initialize_direct_membership_period();

create table public.group_conversation_invitations (
  id uuid primary key,
  conversation_id uuid not null references public.group_conversations(conversation_id) on delete restrict,
  invited_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  invitee_profile_id uuid not null references public.profiles(id) on delete restrict,
  is_initial boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'revoked')),
  created_at timestamptz not null default clock_timestamp(),
  responded_at timestamptz,
  check (invited_by_profile_id <> invitee_profile_id),
  check ((status = 'pending' and responded_at is null)
    or (status <> 'pending' and responded_at is not null))
);
create unique index group_conversation_invitations_pending_uidx
  on public.group_conversation_invitations(conversation_id, invitee_profile_id)
  where status = 'pending';
create index group_conversation_invitations_invitee_idx
  on public.group_conversation_invitations(invitee_profile_id, status, created_at desc, id desc);
create index group_conversation_invitations_conversation_idx
  on public.group_conversation_invitations(conversation_id, status, invitee_profile_id);

create unique index conversation_members_one_active_owner_uidx
  on public.conversation_members(conversation_id)
  where membership_status = 'active' and role = 'owner';

comment on table public.group_conversations is
  'Invite-only course group metadata. Creation IDs make retries idempotent.';
comment on table public.group_membership_periods is
  'Exclusive-start/inclusive-end message visibility windows. Multiple periods support safe re-entry without exposing gaps.';
comment on table public.group_conversation_invitations is
  'Consent records for group membership. A pending invitation never grants conversation access.';

alter table public.group_conversations enable row level security;
alter table public.group_membership_periods enable row level security;
alter table public.group_conversation_invitations enable row level security;

revoke all on public.group_conversations, public.group_membership_periods,
  public.group_conversation_invitations from public, anon, authenticated;

-- Every accepted member has at least one visibility period. Direct rows use a
-- permanent period starting before sequence one; group periods may be closed.
create or replace function messaging_private.can_read_conversation(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1
    from public.conversation_members m
    join public.conversations c on c.id = m.conversation_id
    where m.conversation_id = p_conversation_id
      and m.profile_id = (select auth.uid())
      and c.status <> 'removed'
      and exists (
        select 1 from public.group_membership_periods period
        where period.conversation_id = m.conversation_id
          and period.profile_id = m.profile_id
      )
  );
$$;
revoke all on function messaging_private.can_read_conversation(uuid) from public, anon, authenticated;
grant execute on function messaging_private.can_read_conversation(uuid) to authenticated;

create function messaging_private.can_read_message(p_conversation_id uuid, p_sequence bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and p_sequence is not null and p_sequence > 0
    and exists (
      select 1
      from public.conversation_members m
      join public.conversations c on c.id = m.conversation_id
      join public.group_membership_periods period
        on period.conversation_id = m.conversation_id
       and period.profile_id = m.profile_id
      where m.conversation_id = p_conversation_id
        and m.profile_id = (select auth.uid())
        and c.status <> 'removed'
        and p_sequence > period.starts_after_sequence
        and (period.ends_at_sequence is null or p_sequence <= period.ends_at_sequence)
    );
$$;
revoke all on function messaging_private.can_read_message(uuid, bigint) from public, anon, authenticated;
grant execute on function messaging_private.can_read_message(uuid, bigint) to authenticated;

create function messaging_private.is_active_group_manager(
  p_conversation_id uuid, p_allow_administrator boolean default true
)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1
    from public.conversation_members member
    join public.group_conversations g on g.conversation_id = member.conversation_id
    join public.conversations c on c.id = g.conversation_id
    where member.conversation_id = p_conversation_id
      and member.profile_id = (select auth.uid())
      and member.membership_status = 'active'
      and (member.role = 'owner' or (p_allow_administrator and member.role = 'administrator'))
      and c.status = 'active'
  );
$$;
revoke all on function messaging_private.is_active_group_manager(uuid, boolean)
  from public, anon, authenticated;
grant execute on function messaging_private.is_active_group_manager(uuid, boolean) to authenticated;

drop policy conversations_read on public.conversations;
create policy conversations_read on public.conversations for select to authenticated
  using (type = 'direct' and messaging_private.can_read_conversation(id));

drop policy messages_read on public.messages;
create policy messages_read on public.messages for select to authenticated
  using (messaging_private.can_read_message(conversation_id, sequence));

create function messaging_private.group_title(p_title text)
returns text language plpgsql immutable security invoker set search_path = '' as $$
declare v_title text := btrim(p_title);
begin
  if v_title is null or char_length(v_title) < 1 or char_length(v_title) > 80 then
    raise exception 'Group title must contain 1 to 80 characters' using errcode = '22023';
  end if;
  return v_title;
end;
$$;
revoke all on function messaging_private.group_title(text) from public, anon, authenticated;

create function messaging_private.management_revision(p_revision bigint)
returns bigint language plpgsql immutable security invoker set search_path = '' as $$
begin
  if p_revision is null or p_revision < 0
    or p_revision >= 9223372036854775807::bigint then
    raise exception 'Invalid group management revision' using errcode = '22023';
  end if;
  return p_revision;
end;
$$;
revoke all on function messaging_private.management_revision(bigint)
  from public, anon, authenticated;

create function messaging_private.require_group_course_member(
  p_course_id uuid, p_profile_id uuid, p_require_discoverable boolean
)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_course_id is null or p_profile_id is null or not exists (
    select 1
    from public.courses course
    join public.academic_terms term on term.id = course.term_id
    join public.course_memberships membership on membership.course_id = course.id
    join public.profiles profile on profile.id = membership.profile_id
    where course.id = p_course_id
      and course.status <> 'archived'
      and term.status = 'current'
      and membership.profile_id = p_profile_id
      and membership.status = 'enrolled'
      and profile.onboarding_completed_at is not null
      and profile.display_name is not null
      and (not p_require_discoverable or profile.is_discoverable)
  ) then
    raise exception 'Profile is unavailable for this course group' using errcode = '42501';
  end if;
end;
$$;
revoke all on function messaging_private.require_group_course_member(uuid, uuid, boolean)
  from public, anon, authenticated;

create function messaging_private.create_group(
  p_client_creation_id uuid, p_course_id uuid, p_title text, p_invitee_profile_ids uuid[]
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := messaging_private.require_actor(true);
  v_title text := messaging_private.group_title(p_title);
  v_invitees uuid[];
  v_conversation_id uuid;
  v_existing public.group_conversations;
  v_existing_invitees uuid[];
  v_now timestamptz := clock_timestamp();
  v_target uuid;
begin
  if p_client_creation_id is null or p_course_id is null or p_invitee_profile_ids is null
    or array_position(p_invitee_profile_ids, null) is not null
    or v_actor = any(p_invitee_profile_ids) then
    raise exception 'Invalid group creation request' using errcode = '22023';
  end if;
  select array_agg(profile_id order by profile_id) into v_invitees
  from (select distinct unnest(p_invitee_profile_ids) as profile_id) requested;
  if coalesce(cardinality(v_invitees), 0) < 1 or cardinality(v_invitees) > 19 then
    raise exception 'Choose between 1 and 19 group invitees' using errcode = '22023';
  end if;
  if cardinality(v_invitees) <> cardinality(p_invitee_profile_ids) then
    raise exception 'Group invitees must be unique' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'campusclutch:group:' || v_actor::text || ':' || p_client_creation_id::text, 0));
  select g.* into v_existing from public.group_conversations g
  where g.creator_id = v_actor and g.client_creation_id = p_client_creation_id;
  if found then
    select array_agg(i.invitee_profile_id order by i.invitee_profile_id)
      into v_existing_invitees
    from public.group_conversation_invitations i
    where i.conversation_id = v_existing.conversation_id and i.is_initial;
    if v_existing.course_id <> p_course_id or v_existing.initial_title <> v_title
      or coalesce(v_existing_invitees, '{}'::uuid[]) <> v_invitees then
      raise exception 'Group retry does not match its original content' using errcode = '22023';
    end if;
    return v_existing.conversation_id;
  end if;

  perform messaging_private.require_group_course_member(p_course_id, v_actor, false);
  foreach v_target in array v_invitees loop
    perform messaging_private.require_group_course_member(p_course_id, v_target, true);
  end loop;

  insert into public.conversations(type, created_by, created_at, updated_at)
  values ('group', v_actor, v_now, v_now) returning id into v_conversation_id;
  insert into public.group_conversations(
    conversation_id, course_id, creator_id, client_creation_id,
    title, initial_title, created_at
  ) values (
    v_conversation_id, p_course_id, v_actor, p_client_creation_id,
    v_title, v_title, v_now
  );
  insert into public.conversation_members(
    conversation_id, profile_id, role, membership_status, joined_at, last_read_sequence
  ) values (v_conversation_id, v_actor, 'owner', 'active', v_now, 0);
  insert into public.group_membership_periods(
    conversation_id, profile_id, period_number, starts_after_sequence,
    visible_group_title, started_at
  ) values (v_conversation_id, v_actor, 1, 0, v_title, v_now);
  insert into public.group_conversation_invitations(
    id, conversation_id, invited_by_profile_id, invitee_profile_id,
    is_initial, status, created_at
  )
  select gen_random_uuid(), v_conversation_id, v_actor, target, true, 'pending', v_now
  from unnest(v_invitees) target;
  return v_conversation_id;
end;
$$;
revoke all on function messaging_private.create_group(uuid, uuid, text, uuid[])
  from public, anon, authenticated;
grant execute on function messaging_private.create_group(uuid, uuid, text, uuid[]) to authenticated;

create function messaging_private.invite_group_member(
  p_conversation_id uuid, p_invitee_profile_id uuid, p_invitation_id uuid,
  p_expected_management_revision bigint
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := messaging_private.require_actor(true);
  v_group public.group_conversations;
  v_existing public.group_conversation_invitations;
  v_expected_revision bigint := messaging_private.management_revision(
    p_expected_management_revision);
  v_count integer;
  v_now timestamptz := clock_timestamp();
begin
  if p_conversation_id is null or p_invitee_profile_id is null or p_invitation_id is null
    or p_invitee_profile_id = v_actor then
    raise exception 'Invalid group invitation' using errcode = '22023';
  end if;

  -- The client invitation UUID is the idempotency key. Resolve an already
  -- committed exact call before checking the caller's current manager role so
  -- a lost response remains reconcilable after a later demotion or removal.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'campusclutch:group-invitation:' || p_invitation_id::text, 0));
  select invitation.* into v_existing
  from public.group_conversation_invitations invitation
  where invitation.id = p_invitation_id;
  if found then
    if v_existing.conversation_id <> p_conversation_id
      or v_existing.invited_by_profile_id <> v_actor
      or v_existing.invitee_profile_id <> p_invitee_profile_id then
      raise exception 'Invitation retry does not match its original content' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  perform 1 from public.conversations c where c.id = p_conversation_id for update;
  if not found then raise exception 'Group unavailable' using errcode = '42501'; end if;

  -- Repeat the idempotency lookup after the conversation wait. This closes the
  -- window where a concurrent first insert was not visible before lock wait.
  select invitation.* into v_existing
  from public.group_conversation_invitations invitation
  where invitation.id = p_invitation_id;
  if found then
    if v_existing.conversation_id <> p_conversation_id
      or v_existing.invited_by_profile_id <> v_actor
      or v_existing.invitee_profile_id <> p_invitee_profile_id then
      raise exception 'Invitation retry does not match its original content' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  if not messaging_private.is_active_group_manager(p_conversation_id, true) then
    raise exception 'Group management is unavailable' using errcode = '42501';
  end if;
  select g.* into v_group from public.group_conversations g
  where g.conversation_id = p_conversation_id for update;
  if not found then raise exception 'Group unavailable' using errcode = '42501'; end if;
  if v_group.management_revision <> v_expected_revision then
    raise exception 'Group management revision is stale' using errcode = '55000';
  end if;

  if exists (select 1 from public.conversation_members member
    where member.conversation_id = p_conversation_id
      and member.profile_id = p_invitee_profile_id
      and member.membership_status = 'active') then
    raise exception 'Profile is already an active group member' using errcode = '55000';
  end if;
  if exists (select 1 from public.group_conversation_invitations invitation
    where invitation.conversation_id = p_conversation_id
      and invitation.invitee_profile_id = p_invitee_profile_id
      and invitation.status = 'pending') then
    raise exception 'Profile already has a pending invitation' using errcode = '55000';
  end if;
  select
    (select count(*) from public.conversation_members member
      where member.conversation_id = p_conversation_id and member.membership_status = 'active')
    + (select count(*) from public.group_conversation_invitations invitation
      where invitation.conversation_id = p_conversation_id and invitation.status = 'pending')
    into v_count;
  if v_count >= 20 then
    raise exception 'Group already has 20 active or invited members' using errcode = '55000';
  end if;
  perform messaging_private.require_group_course_member(v_group.course_id, p_invitee_profile_id, true);
  insert into public.group_conversation_invitations(
    id, conversation_id, invited_by_profile_id, invitee_profile_id,
    is_initial, status, created_at
  ) values (
    p_invitation_id, p_conversation_id, v_actor, p_invitee_profile_id,
    false, 'pending', v_now
  );
  update public.group_conversations g
    set management_revision = management_revision + 1
    where g.conversation_id = p_conversation_id;
  return p_invitation_id;
end;
$$;
revoke all on function messaging_private.invite_group_member(uuid, uuid, uuid, bigint)
  from public, anon, authenticated;
grant execute on function messaging_private.invite_group_member(uuid, uuid, uuid, bigint)
  to authenticated;

create function messaging_private.respond_group_invitation(p_invitation_id uuid, p_decision text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := messaging_private.require_actor(true);
  v_decision text := lower(btrim(p_decision));
  v_conversation_id uuid;
  v_invitation public.group_conversation_invitations;
  v_conversation public.conversations;
  v_member public.conversation_members;
  v_period integer;
  v_now timestamptz := clock_timestamp();
begin
  if p_invitation_id is null or v_decision is null
    or v_decision not in ('accepted', 'declined') then
    raise exception 'Choose accepted or declined' using errcode = '22023';
  end if;
  select invitation.conversation_id into v_conversation_id
  from public.group_conversation_invitations invitation
  where invitation.id = p_invitation_id and invitation.invitee_profile_id = v_actor;
  if not found then raise exception 'Invitation unavailable' using errcode = '42501'; end if;
  select c.* into v_conversation from public.conversations c
  where c.id = v_conversation_id for update;
  select invitation.* into v_invitation
  from public.group_conversation_invitations invitation
  where invitation.id = p_invitation_id and invitation.invitee_profile_id = v_actor
  for update;
  if v_invitation.status = v_decision then return v_conversation_id; end if;
  if v_invitation.status <> 'pending' then
    raise exception 'Invitation has already been resolved' using errcode = '55000';
  end if;
  if v_decision = 'declined' then
    update public.group_conversation_invitations
      set status = 'declined', responded_at = v_now where id = p_invitation_id;
    update public.group_conversations g
      set management_revision = management_revision + 1
      where g.conversation_id = v_conversation_id;
    return v_conversation_id;
  end if;
  if v_conversation.status <> 'active' then
    raise exception 'Group is unavailable' using errcode = '55000';
  end if;
  perform messaging_private.require_group_course_member(
    (select g.course_id from public.group_conversations g
      where g.conversation_id = v_conversation_id),
    v_actor,
    false
  );
  select member.* into v_member from public.conversation_members member
  where member.conversation_id = v_conversation_id and member.profile_id = v_actor
  for update;
  if found and v_member.membership_status = 'active' then
    update public.group_conversation_invitations
      set status = 'accepted', responded_at = v_now where id = p_invitation_id;
    update public.group_conversations g
      set management_revision = management_revision + 1
      where g.conversation_id = v_conversation_id;
    return v_conversation_id;
  end if;
  if found then
    update public.conversation_members member
      set role = 'member', membership_status = 'active', joined_at = v_now, ended_at = null,
        last_read_sequence = greatest(member.last_read_sequence, v_conversation.last_message_sequence)
      where member.conversation_id = v_conversation_id and member.profile_id = v_actor;
    select coalesce(max(period.period_number), 0) + 1 into v_period
    from public.group_membership_periods period
    where period.conversation_id = v_conversation_id and period.profile_id = v_actor;
  else
    insert into public.conversation_members(
      conversation_id, profile_id, role, membership_status, joined_at, last_read_sequence
    ) values (
      v_conversation_id, v_actor, 'member', 'active', v_now,
      v_conversation.last_message_sequence
    );
    v_period := 1;
  end if;
  insert into public.group_membership_periods(
    conversation_id, profile_id, period_number, starts_after_sequence,
    visible_group_title, started_at
  ) values (
    v_conversation_id, v_actor, v_period, v_conversation.last_message_sequence,
    (select g.title from public.group_conversations g
      where g.conversation_id = v_conversation_id),
    v_now
  );
  update public.group_conversation_invitations
    set status = 'accepted', responded_at = v_now where id = p_invitation_id;
  update public.group_conversations g
    set management_revision = management_revision + 1
    where g.conversation_id = v_conversation_id;
  return v_conversation_id;
end;
$$;
revoke all on function messaging_private.respond_group_invitation(uuid, text)
  from public, anon, authenticated;
grant execute on function messaging_private.respond_group_invitation(uuid, text) to authenticated;

create function messaging_private.my_group_invitations(p_limit integer)
returns table (
  id uuid, conversation_id uuid, group_title text, course_id uuid,
  course_code text, course_title text, invited_by_profile_id uuid,
  invited_by_display_name text, active_member_count integer,
  status text, created_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := messaging_private.require_actor();
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Invitation page size must be between 1 and 50' using errcode = '22023';
  end if;
  return query
    select invitation.id, invitation.conversation_id, g.title, g.course_id,
      course.code, course.title, invitation.invited_by_profile_id,
      inviter.display_name,
      (select count(*)::integer from public.conversation_members member
        where member.conversation_id = invitation.conversation_id
          and member.membership_status = 'active'),
      invitation.status, invitation.created_at
    from public.group_conversation_invitations invitation
    join public.group_conversations g on g.conversation_id = invitation.conversation_id
    join public.conversations c on c.id = g.conversation_id and c.status = 'active'
    join public.courses course on course.id = g.course_id
    join public.profiles inviter on inviter.id = invitation.invited_by_profile_id
    where invitation.invitee_profile_id = v_actor and invitation.status = 'pending'
    order by invitation.created_at desc, invitation.id desc
    limit p_limit;
end;
$$;
revoke all on function messaging_private.my_group_invitations(integer)
  from public, anon, authenticated;
grant execute on function messaging_private.my_group_invitations(integer) to authenticated;

create function messaging_private.group_members(p_conversation_id uuid)
returns table (
  profile_id uuid, display_name text, role text, joined_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := messaging_private.require_actor();
begin
  if p_conversation_id is null or not exists (
    select 1 from public.conversation_members caller
    join public.group_conversations g on g.conversation_id = caller.conversation_id
    where caller.conversation_id = p_conversation_id and caller.profile_id = v_actor
      and caller.membership_status = 'active'
  ) then
    raise exception 'Group roster is unavailable' using errcode = '42501';
  end if;
  return query
    select member.profile_id, profile.display_name, member.role, member.joined_at
    from public.conversation_members member
    join public.profiles profile on profile.id = member.profile_id
    where member.conversation_id = p_conversation_id
      and member.membership_status = 'active'
    order by case member.role when 'owner' then 0 when 'administrator' then 1 else 2 end,
      lower(profile.display_name), member.profile_id;
end;
$$;
revoke all on function messaging_private.group_members(uuid) from public, anon, authenticated;
grant execute on function messaging_private.group_members(uuid) to authenticated;

create function messaging_private.group_pending_invitations(p_conversation_id uuid)
returns table (
  id uuid, invitee_profile_id uuid, invitee_display_name text,
  invited_by_profile_id uuid, invited_by_display_name text,
  created_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
begin
  perform messaging_private.require_actor();
  if p_conversation_id is null
    or not messaging_private.is_active_group_manager(p_conversation_id, true) then
    raise exception 'Pending invitations are unavailable' using errcode = '42501';
  end if;
  return query
    select invitation.id, invitation.invitee_profile_id, invitee.display_name,
      invitation.invited_by_profile_id, inviter.display_name, invitation.created_at
    from public.group_conversation_invitations invitation
    join public.profiles invitee on invitee.id = invitation.invitee_profile_id
    join public.profiles inviter on inviter.id = invitation.invited_by_profile_id
    where invitation.conversation_id = p_conversation_id and invitation.status = 'pending'
    order by invitation.created_at, invitation.id;
end;
$$;
revoke all on function messaging_private.group_pending_invitations(uuid)
  from public, anon, authenticated;
grant execute on function messaging_private.group_pending_invitations(uuid) to authenticated;

create function messaging_private.group_management_snapshot(p_conversation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  perform messaging_private.require_actor();
  if p_conversation_id is null
    or not messaging_private.is_active_group_manager(p_conversation_id, true) then
    raise exception 'Group management is unavailable' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'conversation_id', g.conversation_id,
    'title', g.title,
    'management_revision', g.management_revision::text,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'profile_id', member.profile_id,
        'display_name', profile.display_name,
        'role', member.role,
        'membership_period', period.period_number,
        'joined_at', member.joined_at
      ) order by
        case member.role when 'owner' then 0 when 'administrator' then 1 else 2 end,
        lower(profile.display_name), member.profile_id)
      from public.conversation_members member
      join public.profiles profile on profile.id = member.profile_id
      join public.group_membership_periods period
        on period.conversation_id = member.conversation_id
       and period.profile_id = member.profile_id
       and period.ends_at_sequence is null
      where member.conversation_id = g.conversation_id
        and member.membership_status = 'active'
    ), '[]'::jsonb),
    'pending_invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', invitation.id,
        'invitee_profile_id', invitation.invitee_profile_id,
        'invitee_display_name', invitee.display_name,
        'invited_by_profile_id', invitation.invited_by_profile_id,
        'invited_by_display_name', inviter.display_name,
        'created_at', invitation.created_at
      ) order by invitation.created_at, invitation.id)
      from public.group_conversation_invitations invitation
      join public.profiles invitee on invitee.id = invitation.invitee_profile_id
      join public.profiles inviter on inviter.id = invitation.invited_by_profile_id
      where invitation.conversation_id = g.conversation_id
        and invitation.status = 'pending'
    ), '[]'::jsonb)
  ) into v_result
  from public.group_conversations g
  where g.conversation_id = p_conversation_id;
  if v_result is null then
    raise exception 'Group unavailable' using errcode = '42501';
  end if;
  return v_result;
end;
$$;
revoke all on function messaging_private.group_management_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function messaging_private.group_management_snapshot(uuid)
  to authenticated;

create function messaging_private.revoke_group_invitation(
  p_invitation_id uuid, p_expected_management_revision bigint
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_conversation_id uuid;
  v_invitation public.group_conversation_invitations;
  v_group public.group_conversations;
  v_expected_revision bigint := messaging_private.management_revision(
    p_expected_management_revision);
begin
  perform messaging_private.require_actor();
  if p_invitation_id is null then
    raise exception 'Invalid invitation' using errcode = '22023';
  end if;
  select invitation.conversation_id into v_conversation_id
  from public.group_conversation_invitations invitation where invitation.id = p_invitation_id;
  if not found then raise exception 'Invitation unavailable' using errcode = '42501'; end if;
  perform 1 from public.conversations c where c.id = v_conversation_id for update;
  if not found then raise exception 'Invitation unavailable' using errcode = '42501'; end if;
  if not messaging_private.is_active_group_manager(v_conversation_id, true) then
    raise exception 'Group management is unavailable' using errcode = '42501';
  end if;
  select g.* into v_group from public.group_conversations g
  where g.conversation_id = v_conversation_id for update;
  if not found then raise exception 'Group unavailable' using errcode = '42501'; end if;
  select invitation.* into v_invitation from public.group_conversation_invitations invitation
  where invitation.id = p_invitation_id for update;
  if v_invitation.status = 'revoked'
    and v_group.management_revision = v_expected_revision + 1 then
    return 'revoked';
  end if;
  if v_group.management_revision <> v_expected_revision then
    raise exception 'Group management revision is stale' using errcode = '55000';
  end if;
  if v_invitation.status <> 'pending' then
    raise exception 'Only a pending invitation can be revoked' using errcode = '55000';
  end if;
  update public.group_conversation_invitations
    set status = 'revoked', responded_at = clock_timestamp() where id = p_invitation_id;
  update public.group_conversations g
    set management_revision = management_revision + 1
    where g.conversation_id = v_conversation_id;
  return 'revoked';
end;
$$;
revoke all on function messaging_private.revoke_group_invitation(uuid, bigint)
  from public, anon, authenticated;
grant execute on function messaging_private.revoke_group_invitation(uuid, bigint)
  to authenticated;

create function messaging_private.leave_group(
  p_conversation_id uuid, p_expected_membership_period integer
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := messaging_private.require_actor();
  v_conversation public.conversations;
  v_member public.conversation_members;
  v_period public.group_membership_periods;
  v_now timestamptz := clock_timestamp();
begin
  if p_conversation_id is null or p_expected_membership_period is null
    or p_expected_membership_period < 1 then
    raise exception 'Invalid group membership period' using errcode = '22023';
  end if;
  select c.* into v_conversation from public.conversations c
  join public.group_conversations g on g.conversation_id = c.id
  where c.id = p_conversation_id for update;
  if not found then raise exception 'Group unavailable' using errcode = '42501'; end if;
  select member.* into v_member from public.conversation_members member
  where member.conversation_id = p_conversation_id and member.profile_id = v_actor for update;
  if not found then raise exception 'Group unavailable' using errcode = '42501'; end if;
  select period.* into v_period from public.group_membership_periods period
  where period.conversation_id = p_conversation_id and period.profile_id = v_actor
    and period.period_number = p_expected_membership_period for update;
  if not found then
    raise exception 'Membership period is unavailable' using errcode = '55000';
  end if;
  if v_period.ends_at_sequence is not null then
    if v_period.end_reason = 'left' then return 'left'; end if;
    raise exception 'Membership period ended with a different action' using errcode = '55000';
  end if;
  if v_member.membership_status <> 'active'
    or not exists (
      select 1 from public.group_membership_periods current_period
      where current_period.conversation_id = p_conversation_id
        and current_period.profile_id = v_actor
        and current_period.period_number = p_expected_membership_period
        and current_period.ends_at_sequence is null
    ) then
    raise exception 'Membership period is stale' using errcode = '55000';
  end if;
  if v_member.role = 'owner' then
    raise exception 'Transfer group ownership before leaving' using errcode = '55000';
  end if;
  update public.group_membership_periods period
    set ends_at_sequence = v_conversation.last_message_sequence,
      end_reason = 'left', ended_at = v_now
    where period.conversation_id = p_conversation_id and period.profile_id = v_actor
      and period.period_number = p_expected_membership_period
      and period.ends_at_sequence is null;
  if not found then raise exception 'Active membership period is missing' using errcode = '55000'; end if;
  update public.conversation_members member
    set membership_status = 'left', ended_at = v_now
    where member.conversation_id = p_conversation_id and member.profile_id = v_actor;
  update public.group_conversations g
    set management_revision = management_revision + 1
    where g.conversation_id = p_conversation_id;
  return 'left';
end;
$$;
revoke all on function messaging_private.leave_group(uuid, integer)
  from public, anon, authenticated;
grant execute on function messaging_private.leave_group(uuid, integer) to authenticated;

create function messaging_private.remove_group_member(
  p_conversation_id uuid, p_profile_id uuid,
  p_expected_membership_period integer,
  p_expected_management_revision bigint
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := messaging_private.require_actor();
  v_conversation public.conversations;
  v_group public.group_conversations;
  v_actor_member public.conversation_members;
  v_target public.conversation_members;
  v_period public.group_membership_periods;
  v_expected_revision bigint := messaging_private.management_revision(
    p_expected_management_revision);
  v_now timestamptz := clock_timestamp();
begin
  if p_conversation_id is null or p_profile_id is null or p_profile_id = v_actor
    or p_expected_membership_period is null or p_expected_membership_period < 1 then
    raise exception 'Invalid member removal' using errcode = '22023';
  end if;
  select c.* into v_conversation from public.conversations c
  join public.group_conversations g on g.conversation_id = c.id
  where c.id = p_conversation_id for update;
  if not found then raise exception 'Group unavailable' using errcode = '42501'; end if;
  select member.* into v_actor_member from public.conversation_members member
  where member.conversation_id = p_conversation_id and member.profile_id = v_actor
    and member.membership_status = 'active' for update;
  if not found or v_actor_member.role not in ('owner', 'administrator') then
    raise exception 'Group management is unavailable' using errcode = '42501';
  end if;
  select g.* into v_group from public.group_conversations g
  where g.conversation_id = p_conversation_id for update;
  if not found then raise exception 'Group unavailable' using errcode = '42501'; end if;
  select member.* into v_target from public.conversation_members member
  where member.conversation_id = p_conversation_id and member.profile_id = p_profile_id for update;
  if not found then raise exception 'Member unavailable' using errcode = '42501'; end if;
  select period.* into v_period from public.group_membership_periods period
  where period.conversation_id = p_conversation_id and period.profile_id = p_profile_id
    and period.period_number = p_expected_membership_period for update;
  if not found then
    raise exception 'Membership period is unavailable' using errcode = '55000';
  end if;
  if v_period.ends_at_sequence is not null then
    if v_period.end_reason = 'removed'
      and v_group.management_revision = v_expected_revision + 1 then
      return 'removed';
    end if;
    if v_period.end_reason = 'removed' then
      raise exception 'Group management revision is stale' using errcode = '55000';
    end if;
    raise exception 'Membership period ended with a different action' using errcode = '55000';
  end if;
  if v_group.management_revision <> v_expected_revision then
    raise exception 'Group management revision is stale' using errcode = '55000';
  end if;
  if v_target.membership_status <> 'active' then
    raise exception 'Only an active member can be removed' using errcode = '55000';
  end if;
  if v_target.role = 'owner'
    or (v_actor_member.role = 'administrator' and v_target.role <> 'member') then
    raise exception 'This role cannot be removed by the caller' using errcode = '42501';
  end if;
  update public.group_membership_periods period
    set ends_at_sequence = v_conversation.last_message_sequence,
      end_reason = 'removed', ended_at = v_now
    where period.conversation_id = p_conversation_id and period.profile_id = p_profile_id
      and period.period_number = p_expected_membership_period
      and period.ends_at_sequence is null;
  if not found then raise exception 'Active membership period is missing' using errcode = '55000'; end if;
  update public.conversation_members member
    set membership_status = 'removed', ended_at = v_now
    where member.conversation_id = p_conversation_id and member.profile_id = p_profile_id;
  update public.group_conversations g
    set management_revision = management_revision + 1
    where g.conversation_id = p_conversation_id;
  return 'removed';
end;
$$;
revoke all on function messaging_private.remove_group_member(uuid, uuid, integer, bigint)
  from public, anon, authenticated;
grant execute on function messaging_private.remove_group_member(uuid, uuid, integer, bigint)
  to authenticated;

create function messaging_private.set_group_role(
  p_conversation_id uuid, p_profile_id uuid,
  p_expected_membership_period integer, p_role text,
  p_expected_management_revision bigint
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_role text := lower(btrim(p_role));
  v_target public.conversation_members;
  v_group public.group_conversations;
  v_expected_revision bigint := messaging_private.management_revision(
    p_expected_management_revision);
begin
  perform messaging_private.require_actor();
  if p_conversation_id is null or p_profile_id is null
    or p_expected_membership_period is null or p_expected_membership_period < 1
    or v_role is null
    or v_role not in ('administrator', 'member') then
    raise exception 'Choose administrator or member' using errcode = '22023';
  end if;
  perform 1 from public.conversations c where c.id = p_conversation_id for update;
  if not found or not messaging_private.is_active_group_manager(p_conversation_id, false) then
    raise exception 'Only the group owner can change roles' using errcode = '42501';
  end if;
  select g.* into v_group from public.group_conversations g
  where g.conversation_id = p_conversation_id for update;
  if not found then raise exception 'Group unavailable' using errcode = '42501'; end if;
  select member.* into v_target from public.conversation_members member
  where member.conversation_id = p_conversation_id and member.profile_id = p_profile_id for update;
  if not found or v_target.membership_status <> 'active' or v_target.role = 'owner' then
    raise exception 'Active non-owner member required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.group_membership_periods period
    where period.conversation_id = p_conversation_id
      and period.profile_id = p_profile_id
      and period.period_number = p_expected_membership_period
      and period.ends_at_sequence is null
  ) then
    raise exception 'Membership period is stale' using errcode = '55000';
  end if;
  if v_group.management_revision = v_expected_revision + 1
    and v_target.role = v_role then
    return v_role;
  end if;
  if v_group.management_revision <> v_expected_revision then
    raise exception 'Group management revision is stale' using errcode = '55000';
  end if;
  if v_target.role = v_role then return v_role; end if;
  update public.conversation_members member set role = v_role
  where member.conversation_id = p_conversation_id and member.profile_id = p_profile_id;
  update public.group_conversations g
    set management_revision = management_revision + 1
    where g.conversation_id = p_conversation_id;
  return v_role;
end;
$$;
revoke all on function messaging_private.set_group_role(uuid, uuid, integer, text, bigint)
  from public, anon, authenticated;
grant execute on function messaging_private.set_group_role(uuid, uuid, integer, text, bigint)
  to authenticated;

create function messaging_private.transfer_group_owner(
  p_conversation_id uuid, p_new_owner_profile_id uuid,
  p_expected_membership_period integer,
  p_expected_management_revision bigint
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := messaging_private.require_actor();
  v_actor_member public.conversation_members;
  v_target public.conversation_members;
  v_group public.group_conversations;
  v_expected_revision bigint := messaging_private.management_revision(
    p_expected_management_revision);
begin
  if p_conversation_id is null or p_new_owner_profile_id is null
    or p_expected_membership_period is null or p_expected_membership_period < 1
    or p_new_owner_profile_id = v_actor then
    raise exception 'Choose another active member' using errcode = '22023';
  end if;
  perform 1 from public.conversations c where c.id = p_conversation_id for update;
  if not found then raise exception 'Group unavailable' using errcode = '42501'; end if;
  select g.* into v_group from public.group_conversations g
  where g.conversation_id = p_conversation_id for update;
  if not found then raise exception 'Group unavailable' using errcode = '42501'; end if;
  select member.* into v_actor_member from public.conversation_members member
  where member.conversation_id = p_conversation_id and member.profile_id = v_actor
    and member.membership_status = 'active' for update;
  if not found then
    raise exception 'Only the group owner can transfer ownership' using errcode = '42501';
  end if;
  select member.* into v_target from public.conversation_members member
  where member.conversation_id = p_conversation_id
    and member.profile_id = p_new_owner_profile_id
    and member.membership_status = 'active' for update;
  if not found then raise exception 'Choose an active member' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.group_membership_periods period
    where period.conversation_id = p_conversation_id
      and period.profile_id = p_new_owner_profile_id
      and period.period_number = p_expected_membership_period
      and period.ends_at_sequence is null
  ) then
    raise exception 'Membership period is stale' using errcode = '55000';
  end if;
  if v_group.management_revision = v_expected_revision + 1
    and v_target.role = 'owner'
    and v_actor_member.role = 'administrator' then
    return 'transferred';
  end if;
  if v_actor_member.role <> 'owner' then
    raise exception 'Only the group owner can transfer ownership' using errcode = '42501';
  end if;
  if v_group.management_revision <> v_expected_revision then
    raise exception 'Group management revision is stale' using errcode = '55000';
  end if;
  if v_target.role = 'owner' then
    raise exception 'Choose an active non-owner member' using errcode = '42501';
  end if;
  update public.conversation_members member set role = 'administrator'
  where member.conversation_id = p_conversation_id and member.profile_id = v_actor;
  update public.conversation_members member set role = 'owner'
  where member.conversation_id = p_conversation_id and member.profile_id = p_new_owner_profile_id;
  update public.group_conversations g
    set management_revision = management_revision + 1
    where g.conversation_id = p_conversation_id;
  return 'transferred';
end;
$$;
revoke all on function messaging_private.transfer_group_owner(uuid, uuid, integer, bigint)
  from public, anon, authenticated;
grant execute on function messaging_private.transfer_group_owner(uuid, uuid, integer, bigint)
  to authenticated;

create function messaging_private.rename_group(
  p_conversation_id uuid, p_title text, p_expected_management_revision bigint
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_title text := messaging_private.group_title(p_title);
  v_group public.group_conversations;
  v_expected_revision bigint := messaging_private.management_revision(
    p_expected_management_revision);
begin
  perform messaging_private.require_actor();
  perform 1 from public.conversations c where c.id = p_conversation_id for update;
  if not found or not messaging_private.is_active_group_manager(p_conversation_id, true) then
    raise exception 'Group management is unavailable' using errcode = '42501';
  end if;
  select g.* into v_group from public.group_conversations g
  where g.conversation_id = p_conversation_id for update;
  if not found then raise exception 'Group unavailable' using errcode = '42501'; end if;
  if v_group.management_revision = v_expected_revision + 1
    and v_group.title = v_title then
    return v_title;
  end if;
  if v_group.management_revision <> v_expected_revision then
    raise exception 'Group management revision is stale' using errcode = '55000';
  end if;
  if v_group.title = v_title then return v_title; end if;
  update public.group_conversations g
    set title = v_title, management_revision = management_revision + 1
    where g.conversation_id = p_conversation_id;
  update public.group_membership_periods period
    set visible_group_title = v_title
    where period.conversation_id = p_conversation_id
      and period.ends_at_sequence is null;
  update public.conversations c set updated_at = clock_timestamp() where c.id = p_conversation_id;
  return v_title;
end;
$$;
revoke all on function messaging_private.rename_group(uuid, text, bigint)
  from public, anon, authenticated;
grant execute on function messaging_private.rename_group(uuid, text, bigint)
  to authenticated;

create function messaging_private.enforce_one_group_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_conversation_id uuid;
begin
  v_conversation_id := case when tg_table_name = 'conversations'
    then (v_row->>'id')::uuid else (v_row->>'conversation_id')::uuid end;
  if exists (select 1 from public.group_conversations g
    where g.conversation_id = v_conversation_id) then
    if not exists (select 1 from public.conversations c
      where c.id = v_conversation_id and c.type = 'group') then
      raise exception 'Group metadata requires a group conversation' using errcode = '23514';
    end if;
    if (select count(*) from public.conversation_members member
      where member.conversation_id = v_conversation_id
        and member.membership_status = 'active' and member.role = 'owner') <> 1 then
      raise exception 'A group must have exactly one active owner' using errcode = '23514';
    end if;
  end if;
  return null;
end;
$$;
revoke all on function messaging_private.enforce_one_group_owner() from public, anon, authenticated;
create constraint trigger enforce_one_group_owner
after insert or update or delete on public.conversation_members
deferrable initially deferred for each row
execute function messaging_private.enforce_one_group_owner();

create constraint trigger enforce_group_integrity_on_metadata
after insert or update on public.group_conversations
deferrable initially deferred for each row
execute function messaging_private.enforce_one_group_owner();

create constraint trigger enforce_group_integrity_on_parent
after insert or update of type on public.conversations
deferrable initially deferred for each row
execute function messaging_private.enforce_one_group_owner();

create or replace function messaging_private.summary(p_conversation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := messaging_private.require_actor(); v_result jsonb;
begin
  if p_conversation_id is null then
    raise exception 'Invalid conversation' using errcode = '22023';
  end if;
  if not messaging_private.can_read_conversation(p_conversation_id) then
    raise exception 'Conversation unavailable' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'id', c.id,
    'type', c.type,
    'status', c.status,
    'other_profile_id', counterpart.id,
    'other_display_name', counterpart.display_name,
    'last_message_body', latest.body,
    'last_message_at', case when c.type = 'direct' then c.last_message_at else latest.created_at end,
    'last_activity_at', case when c.type = 'direct'
      then coalesce(c.last_message_at, c.created_at)
      else greatest(coalesce(latest.created_at, member.joined_at), member.joined_at) end,
    'last_message_sequence', case when c.type = 'direct'
      then c.last_message_sequence else coalesce(latest.sequence, 0) end::text,
    'last_read_sequence', member.last_read_sequence::text,
    'unread_count', (
      select count(*)::integer
      from public.messages unread
      where unread.conversation_id = c.id
        and unread.sequence > member.last_read_sequence
        and unread.sender_id <> v_user
        and exists (
          select 1 from public.group_membership_periods visible_period
          where visible_period.conversation_id = unread.conversation_id
            and visible_period.profile_id = v_user
            and unread.sequence > visible_period.starts_after_sequence
            and (visible_period.ends_at_sequence is null
              or unread.sequence <= visible_period.ends_at_sequence)
        )
    ),
    'created_at', c.created_at
  ) || case when c.type = 'group' then jsonb_build_object(
    'group_title', case when member.membership_status = 'active' then g.title
      else (select period.visible_group_title
        from public.group_membership_periods period
        where period.conversation_id = c.id and period.profile_id = v_user
        order by period.period_number desc limit 1) end,
    'group_course_id', g.course_id,
    'group_course_code', course.code,
    'management_revision', case when member.membership_status = 'active'
      then g.management_revision::text else '0' end,
    'active_member_count', case when member.membership_status = 'active'
      then (select count(*)::integer from public.conversation_members active_member
        where active_member.conversation_id = c.id
          and active_member.membership_status = 'active') else 0 end,
    'my_role', member.role,
    'my_membership_status', member.membership_status,
    'my_membership_period', (select max(period.period_number)
      from public.group_membership_periods period
      where period.conversation_id = c.id and period.profile_id = v_user),
    'can_send', c.status = 'active' and member.membership_status = 'active'
      and exists (select 1 from public.group_membership_periods open_period
        where open_period.conversation_id = c.id and open_period.profile_id = v_user
          and open_period.ends_at_sequence is null)
  ) else '{}'::jsonb end
  into v_result
  from public.conversations c
  join public.conversation_members member
    on member.conversation_id = c.id and member.profile_id = v_user
  left join public.direct_conversation_pairs pair on pair.conversation_id = c.id
  left join public.profiles counterpart on counterpart.id = case
    when pair.user_low_id = v_user then pair.user_high_id else pair.user_low_id end
  left join public.group_conversations g on g.conversation_id = c.id
  left join public.courses course on course.id = g.course_id
  left join lateral (
    select message.* from public.messages message
    where message.conversation_id = c.id
      and exists (
        select 1 from public.group_membership_periods visible_period
        where visible_period.conversation_id = message.conversation_id
          and visible_period.profile_id = v_user
          and message.sequence > visible_period.starts_after_sequence
          and (visible_period.ends_at_sequence is null
            or message.sequence <= visible_period.ends_at_sequence)
      )
    order by message.sequence desc limit 1
  ) latest on true
  where c.id = p_conversation_id and c.status <> 'removed';
  if v_result is null then
    raise exception 'Conversation unavailable' using errcode = '42501';
  end if;
  return v_result;
end;
$$;
revoke all on function messaging_private.summary(uuid) from public, anon, authenticated;
grant execute on function messaging_private.summary(uuid) to authenticated;

drop function public.get_my_conversations(integer, timestamptz, uuid);
drop function messaging_private.inbox(integer, timestamptz, uuid);

create function messaging_private.inbox(
  p_limit integer, p_before_activity_at timestamptz, p_before_id uuid
)
returns table (
  id uuid, type text, status text,
  other_profile_id uuid, other_display_name text,
  group_title text, group_course_id uuid, group_course_code text,
  active_member_count integer, my_role text, my_membership_status text,
  my_membership_period integer, management_revision text, can_send boolean,
  last_message_body text, last_message_at timestamptz, last_activity_at timestamptz,
  last_message_sequence text, last_read_sequence text, unread_count integer,
  created_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := messaging_private.require_actor();
begin
  if p_limit is null or p_limit < 1 or p_limit > 50
    or ((p_before_activity_at is null) <> (p_before_id is null))
    or (p_before_activity_at is not null and not isfinite(p_before_activity_at)) then
    raise exception 'Invalid conversation page' using errcode = '22023';
  end if;
  return query
    select summary_row.*
    from public.conversation_members member
    join public.conversations c on c.id = member.conversation_id
    cross join lateral jsonb_to_record(messaging_private.summary(c.id)) as summary_row(
      id uuid, type text, status text,
      other_profile_id uuid, other_display_name text,
      group_title text, group_course_id uuid, group_course_code text,
      active_member_count integer, my_role text, my_membership_status text,
      my_membership_period integer, management_revision text, can_send boolean,
      last_message_body text, last_message_at timestamptz, last_activity_at timestamptz,
      last_message_sequence text, last_read_sequence text, unread_count integer,
      created_at timestamptz
    )
    where member.profile_id = v_user and member.membership_status = 'active'
      and c.status <> 'removed'
      and (p_before_activity_at is null
        or (summary_row.last_activity_at, summary_row.id) < (p_before_activity_at, p_before_id))
    order by summary_row.last_activity_at desc, summary_row.id desc
    limit p_limit;
end;
$$;
revoke all on function messaging_private.inbox(integer, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function messaging_private.inbox(integer, timestamptz, uuid) to authenticated;

create function public.get_my_conversations(
  p_limit integer default 20,
  p_before_activity_at timestamptz default null,
  p_before_id uuid default null
) returns table (
  id uuid, type text, status text,
  other_profile_id uuid, other_display_name text,
  group_title text, group_course_id uuid, group_course_code text,
  active_member_count integer, my_role text, my_membership_status text,
  my_membership_period integer, management_revision text, can_send boolean,
  last_message_body text, last_message_at timestamptz, last_activity_at timestamptz,
  last_message_sequence text, last_read_sequence text, unread_count integer,
  created_at timestamptz
) language sql stable security invoker set search_path = '' as $$
  select * from messaging_private.inbox(p_limit, p_before_activity_at, p_before_id);
$$;
revoke all on function public.get_my_conversations(integer, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.get_my_conversations(integer, timestamptz, uuid) to authenticated;

drop function public.get_conversation_messages(uuid, bigint, integer);
drop function messaging_private.message_page(uuid, bigint, integer);

create function messaging_private.message_page(
  p_conversation_id uuid, p_before_sequence bigint, p_limit integer
)
returns table (
  id uuid, conversation_id uuid, sender_id uuid, sender_display_name text,
  client_message_id uuid, sequence text, body text, created_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := messaging_private.require_actor();
begin
  if p_conversation_id is null or p_limit is null or p_limit < 1 or p_limit > 50
    or (p_before_sequence is not null and p_before_sequence < 1) then
    raise exception 'Invalid message page' using errcode = '22023';
  end if;
  if not messaging_private.can_read_conversation(p_conversation_id) then
    raise exception 'Conversation unavailable' using errcode = '42501';
  end if;
  return query
    select message.id, message.conversation_id, message.sender_id,
      sender.display_name, message.client_message_id, message.sequence::text,
      message.body, message.created_at
    from public.messages message
    join public.profiles sender on sender.id = message.sender_id
    where message.conversation_id = p_conversation_id
      and (p_before_sequence is null or message.sequence < p_before_sequence)
      and exists (
        select 1 from public.group_membership_periods visible_period
        where visible_period.conversation_id = message.conversation_id
          and visible_period.profile_id = v_actor
          and message.sequence > visible_period.starts_after_sequence
          and (visible_period.ends_at_sequence is null
            or message.sequence <= visible_period.ends_at_sequence)
      )
    order by message.sequence desc limit p_limit;
end;
$$;
revoke all on function messaging_private.message_page(uuid, bigint, integer)
  from public, anon, authenticated;
grant execute on function messaging_private.message_page(uuid, bigint, integer) to authenticated;

create function public.get_conversation_messages(
  p_conversation_id uuid, p_before_sequence bigint default null, p_limit integer default 30
) returns table (
  id uuid, conversation_id uuid, sender_id uuid, sender_display_name text,
  client_message_id uuid, sequence text, body text, created_at timestamptz
) language sql stable security invoker set search_path = '' as $$
  select * from messaging_private.message_page(p_conversation_id, p_before_sequence, p_limit);
$$;
revoke all on function public.get_conversation_messages(uuid, bigint, integer)
  from public, anon, authenticated;
grant execute on function public.get_conversation_messages(uuid, bigint, integer) to authenticated;

create or replace function messaging_private.message_json(p_message public.messages)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', (p_message).id,
    'conversation_id', (p_message).conversation_id,
    'sender_id', (p_message).sender_id,
    'sender_display_name', (select profile.display_name from public.profiles profile
      where profile.id = (p_message).sender_id),
    'client_message_id', (p_message).client_message_id,
    'sequence', (p_message).sequence::text,
    'body', (p_message).body,
    'created_at', (p_message).created_at
  );
$$;
revoke all on function messaging_private.message_json(public.messages)
  from public, anon, authenticated;

create or replace function messaging_private.send_message(
  p_conversation_id uuid, p_client_message_id uuid, p_body text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := messaging_private.require_actor();
  v_conversation public.conversations;
  v_member public.conversation_members;
  v_message public.messages;
  v_body text;
  v_now timestamptz;
begin
  v_body := regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if p_conversation_id is null or p_client_message_id is null or v_body is null
    or char_length(v_body) < 1 or char_length(v_body) > 4000 then
    raise exception 'A message must contain 1 to 4000 characters' using errcode = '22023';
  end if;
  select c.* into v_conversation from public.conversations c
  where c.id = p_conversation_id and c.status <> 'removed'
    and exists (select 1 from public.conversation_members member
      where member.conversation_id = c.id and member.profile_id = v_user)
  for update;
  if not found or not messaging_private.can_read_conversation(p_conversation_id) then
    raise exception 'Conversation unavailable' using errcode = '42501';
  end if;

  -- Resolve an exact earlier send even if the member has since left or was removed.
  select message.* into v_message from public.messages message
  where message.sender_id = v_user and message.client_message_id = p_client_message_id;
  if found then
    if v_message.conversation_id <> p_conversation_id or v_message.body <> v_body then
      raise exception 'Message retry does not match its original content' using errcode = '22023';
    end if;
    return messaging_private.message_json(v_message);
  end if;

  select member.* into v_member from public.conversation_members member
  where member.conversation_id = p_conversation_id and member.profile_id = v_user;
  if v_conversation.status <> 'active' then
    raise exception 'This conversation is closed to new messages' using errcode = '55000';
  end if;
  if v_member.membership_status <> 'active' or not exists (
    select 1 from public.group_membership_periods period
    where period.conversation_id = p_conversation_id and period.profile_id = v_user
      and period.ends_at_sequence is null
  ) then
    raise exception 'Active conversation membership is required' using errcode = '55000';
  end if;

  v_now := clock_timestamp();
  insert into public.messages(
    conversation_id, sender_id, client_message_id, sequence, body, created_at
  ) values (
    p_conversation_id, v_user, p_client_message_id,
    v_conversation.last_message_sequence + 1, v_body, v_now
  ) on conflict (sender_id, client_message_id) do nothing returning * into v_message;
  if not found then
    select message.* into v_message from public.messages message
    where message.sender_id = v_user and message.client_message_id = p_client_message_id;
    if not found or v_message.conversation_id <> p_conversation_id or v_message.body <> v_body then
      raise exception 'Message retry does not match its original content' using errcode = '22023';
    end if;
    return messaging_private.message_json(v_message);
  end if;
  update public.conversations c
    set last_message_sequence = v_message.sequence,
      last_message_at = v_now,
      updated_at = v_now
    where c.id = p_conversation_id;
  return messaging_private.message_json(v_message);
end;
$$;
revoke all on function messaging_private.send_message(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function messaging_private.send_message(uuid, uuid, text) to authenticated;

create or replace function messaging_private.mark_read(
  p_conversation_id uuid, p_through_sequence bigint
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := messaging_private.require_actor();
  v_conversation public.conversations;
  v_cursor bigint;
begin
  if p_conversation_id is null or p_through_sequence is null or p_through_sequence < 0 then
    raise exception 'Invalid read cursor' using errcode = '22023';
  end if;
  select c.* into v_conversation from public.conversations c
  where c.id = p_conversation_id and c.status <> 'removed'
    and exists (select 1 from public.conversation_members member
      where member.conversation_id = c.id and member.profile_id = v_user)
  for update;
  if not found or not messaging_private.can_read_conversation(p_conversation_id) then
    raise exception 'Conversation unavailable' using errcode = '42501';
  end if;
  if p_through_sequence > v_conversation.last_message_sequence
    or (p_through_sequence > 0
      and (not exists (select 1 from public.messages message
        where message.conversation_id = p_conversation_id
          and message.sequence = p_through_sequence)
        or not messaging_private.can_read_message(p_conversation_id, p_through_sequence))) then
    raise exception 'Read cursor must identify a visible message in this conversation'
      using errcode = '22023';
  end if;
  update public.conversation_members member set
    last_read_at = case when p_through_sequence > member.last_read_sequence
      then clock_timestamp() else member.last_read_at end,
    last_read_sequence = greatest(member.last_read_sequence, p_through_sequence)
  where member.conversation_id = p_conversation_id and member.profile_id = v_user
  returning member.last_read_sequence into v_cursor;
  return v_cursor::text;
end;
$$;
revoke all on function messaging_private.mark_read(uuid, bigint)
  from public, anon, authenticated;
grant execute on function messaging_private.mark_read(uuid, bigint) to authenticated;

create or replace function messaging_private.unread_total()
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := messaging_private.require_actor(); v_count bigint;
begin
  select count(*) into v_count
  from public.conversation_members member
  join public.conversations c on c.id = member.conversation_id and c.status <> 'removed'
  join public.messages message on message.conversation_id = member.conversation_id
    and message.sequence > member.last_read_sequence and message.sender_id <> v_actor
  where member.profile_id = v_actor and member.membership_status = 'active'
    and exists (
      select 1 from public.group_membership_periods visible_period
      where visible_period.conversation_id = message.conversation_id
        and visible_period.profile_id = v_actor
        and message.sequence > visible_period.starts_after_sequence
        and (visible_period.ends_at_sequence is null
          or message.sequence <= visible_period.ends_at_sequence)
    );
  return v_count;
end;
$$;
revoke all on function messaging_private.unread_total() from public, anon, authenticated;
grant execute on function messaging_private.unread_total() to authenticated;

create function public.create_group_conversation(
  p_client_creation_id uuid, p_course_id uuid, p_title text, p_invitee_ids uuid[]
)
returns uuid language sql security invoker set search_path = '' as $$
  select messaging_private.create_group(
    p_client_creation_id, p_course_id, p_title, p_invitee_ids
  );
$$;

create function public.get_my_group_invitations(p_limit integer default 20)
returns table (
  id uuid, conversation_id uuid, group_title text, course_id uuid,
  course_code text, course_title text, invited_by_profile_id uuid,
  invited_by_display_name text, active_member_count integer,
  status text, created_at timestamptz
) language sql stable security invoker set search_path = '' as $$
  select * from messaging_private.my_group_invitations(p_limit);
$$;

create function public.respond_to_group_invitation(p_invitation_id uuid, p_response text)
returns uuid language sql security invoker set search_path = '' as $$
  select messaging_private.respond_group_invitation(p_invitation_id, p_response);
$$;

create function public.invite_group_member(
  p_conversation_id uuid, p_client_invitation_id uuid, p_invitee_id uuid,
  p_expected_management_revision bigint
)
returns uuid language sql security invoker set search_path = '' as $$
  select messaging_private.invite_group_member(
    p_conversation_id, p_invitee_id, p_client_invitation_id,
    p_expected_management_revision
  );
$$;

create function public.revoke_group_invitation(
  p_invitation_id uuid, p_expected_management_revision bigint
)
returns text language sql security invoker set search_path = '' as $$
  select messaging_private.revoke_group_invitation(
    p_invitation_id, p_expected_management_revision);
$$;

create function public.get_group_members(p_conversation_id uuid)
returns table (
  profile_id uuid, display_name text, role text, joined_at timestamptz
)
language sql stable security invoker set search_path = '' as $$
  select * from messaging_private.group_members(p_conversation_id);
$$;

create function public.get_group_pending_invitations(p_conversation_id uuid)
returns table (
  id uuid, invitee_profile_id uuid, invitee_display_name text,
  invited_by_profile_id uuid, invited_by_display_name text,
  created_at timestamptz
) language sql stable security invoker set search_path = '' as $$
  select * from messaging_private.group_pending_invitations(p_conversation_id);
$$;

create function public.get_group_management_snapshot(p_conversation_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select messaging_private.group_management_snapshot(p_conversation_id);
$$;

create function public.leave_group_conversation(
  p_conversation_id uuid, p_expected_membership_period integer
)
returns text language sql security invoker set search_path = '' as $$
  select messaging_private.leave_group(
    p_conversation_id, p_expected_membership_period
  );
$$;

create function public.remove_group_member(
  p_conversation_id uuid, p_profile_id uuid,
  p_expected_membership_period integer, p_expected_management_revision bigint
)
returns text language sql security invoker set search_path = '' as $$
  select messaging_private.remove_group_member(
    p_conversation_id, p_profile_id, p_expected_membership_period,
    p_expected_management_revision
  );
$$;

create function public.set_group_member_role(
  p_conversation_id uuid, p_profile_id uuid,
  p_expected_membership_period integer, p_role text,
  p_expected_management_revision bigint
)
returns text language sql security invoker set search_path = '' as $$
  select messaging_private.set_group_role(
    p_conversation_id, p_profile_id, p_expected_membership_period, p_role,
    p_expected_management_revision
  );
$$;

create function public.transfer_group_ownership(
  p_conversation_id uuid, p_new_owner_id uuid,
  p_expected_membership_period integer, p_expected_management_revision bigint
)
returns text language sql security invoker set search_path = '' as $$
  select messaging_private.transfer_group_owner(
    p_conversation_id, p_new_owner_id, p_expected_membership_period,
    p_expected_management_revision
  );
$$;

create function public.rename_group_conversation(
  p_conversation_id uuid, p_title text, p_expected_management_revision bigint
)
returns text language sql security invoker set search_path = '' as $$
  select messaging_private.rename_group(
    p_conversation_id, p_title, p_expected_management_revision);
$$;

revoke all on function
  public.create_group_conversation(uuid, uuid, text, uuid[]),
  public.get_my_group_invitations(integer),
  public.respond_to_group_invitation(uuid, text),
  public.invite_group_member(uuid, uuid, uuid, bigint),
  public.revoke_group_invitation(uuid, bigint),
  public.get_group_members(uuid),
  public.get_group_pending_invitations(uuid),
  public.get_group_management_snapshot(uuid),
  public.leave_group_conversation(uuid, integer),
  public.remove_group_member(uuid, uuid, integer, bigint),
  public.set_group_member_role(uuid, uuid, integer, text, bigint),
  public.transfer_group_ownership(uuid, uuid, integer, bigint),
  public.rename_group_conversation(uuid, text, bigint)
from public, anon, authenticated;

grant execute on function
  public.create_group_conversation(uuid, uuid, text, uuid[]),
  public.get_my_group_invitations(integer),
  public.respond_to_group_invitation(uuid, text),
  public.invite_group_member(uuid, uuid, uuid, bigint),
  public.revoke_group_invitation(uuid, bigint),
  public.get_group_members(uuid),
  public.get_group_pending_invitations(uuid),
  public.get_group_management_snapshot(uuid),
  public.leave_group_conversation(uuid, integer),
  public.remove_group_member(uuid, uuid, integer, bigint),
  public.set_group_member_role(uuid, uuid, integer, text, bigint),
  public.transfer_group_ownership(uuid, uuid, integer, bigint),
  public.rename_group_conversation(uuid, text, bigint)
to authenticated;
