-- Captured with Supabase db pull --local; limited to the reviewed checkpoint.
-- Managed Realtime policies and explicit PUBLIC revocations are retained here
-- because the diff engine omits them. Unrelated legacy schema drift is excluded.
-- Task 10: defer groups without deleting their data; enable private direct-chat
-- invalidations. The retained group functions and tables can be restored later
-- by an explicitly reviewed migration, not by a client flag.

create or replace function messaging_private.can_read_conversation(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.conversation_members member
    join public.conversations conversation on conversation.id = member.conversation_id
    join public.profiles profile on profile.id = member.profile_id
    where member.conversation_id = p_conversation_id
      and member.profile_id = (select auth.uid())
      and conversation.type = 'direct' and conversation.status <> 'removed'
      and member.membership_status = 'active'
  );
$$;

create or replace function messaging_private.can_read_message(p_conversation_id uuid, p_sequence bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_sequence is not null and p_sequence > 0
    and messaging_private.can_read_conversation(p_conversation_id);
$$;

create or replace function messaging_private.inbox(
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
    from (
      select conversation.id, coalesce(conversation.last_message_at, conversation.created_at) as activity_at
      from public.conversation_members member
      join public.conversations conversation on conversation.id = member.conversation_id
      where member.profile_id = v_user and member.membership_status = 'active'
        and conversation.type = 'direct' and conversation.status <> 'removed'
        and (p_before_activity_at is null or
          (coalesce(conversation.last_message_at, conversation.created_at), conversation.id)
            < (p_before_activity_at, p_before_id))
      order by coalesce(conversation.last_message_at, conversation.created_at) desc, conversation.id desc
      limit p_limit
    ) page
    cross join lateral jsonb_to_record(messaging_private.summary(page.id)) as summary_row(
      id uuid, type text, status text,
      other_profile_id uuid, other_display_name text,
      group_title text, group_course_id uuid, group_course_code text,
      active_member_count integer, my_role text, my_membership_status text,
      my_membership_period integer, management_revision text, can_send boolean,
      last_message_body text, last_message_at timestamptz, last_activity_at timestamptz,
      last_message_sequence text, last_read_sequence text, unread_count integer,
      created_at timestamptz
    )
    order by page.activity_at desc, page.id desc;
end;
$$;

create or replace function messaging_private.unread_total()
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := messaging_private.require_actor(); v_count bigint;
begin
  select count(*) into v_count
  from public.conversation_members member
  join public.conversations conversation on conversation.id = member.conversation_id
    and conversation.type = 'direct' and conversation.status <> 'removed'
  join public.messages message on message.conversation_id = member.conversation_id
    and message.sequence > member.last_read_sequence and message.sender_id <> v_actor
  where member.profile_id = v_actor and member.membership_status = 'active';
  return v_count;
end;
$$;

-- Block every dedicated group entry point, including calls made through the
-- private schema. Generic summary/page/send/read paths use the central guard
-- above, so a saved group UUID cannot bypass this deferral.
revoke all on function
  public.create_group_conversation(uuid, uuid, text, uuid[]),
  public.get_my_group_invitations(integer),
  public.get_my_group_invitations_page(integer, timestamptz, uuid),
  public.get_my_former_group_conversations(integer, timestamptz, uuid),
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
  public.rename_group_conversation(uuid, text, bigint),
  messaging_private.create_group(uuid, uuid, text, uuid[]),
  messaging_private.my_group_invitations(integer),
  messaging_private.group_invitation_page(integer, timestamptz, uuid),
  messaging_private.former_group_inbox(integer, timestamptz, uuid),
  messaging_private.respond_group_invitation(uuid, text),
  messaging_private.invite_group_member(uuid, uuid, uuid, bigint),
  messaging_private.revoke_group_invitation(uuid, bigint),
  messaging_private.group_members(uuid),
  messaging_private.group_pending_invitations(uuid),
  messaging_private.group_management_snapshot(uuid),
  messaging_private.leave_group(uuid, integer),
  messaging_private.remove_group_member(uuid, uuid, integer, bigint),
  messaging_private.set_group_role(uuid, uuid, integer, text, bigint),
  messaging_private.transfer_group_owner(uuid, uuid, integer, bigint),
  messaging_private.rename_group(uuid, text, bigint),
  messaging_private.is_active_group_manager(uuid, boolean)
from public, anon, authenticated;

-- Realtime authorization cannot rely on JWT identity alone: removed accounts
-- can still hold unexpired access tokens. Require an extant, completed account.
create function messaging_private.realtime_actor()
returns uuid language sql stable security definer set search_path = '' as $$
  select profile.id from public.profiles profile
  join auth.users account on account.id = profile.id
  where profile.id = (select auth.uid())
    and profile.onboarding_completed_at is not null and profile.display_name is not null
    and account.deleted_at is null
    and (account.banned_until is null or account.banned_until <= now());
$$;
revoke all on function messaging_private.realtime_actor() from public, anon, authenticated;
grant execute on function messaging_private.realtime_actor() to authenticated;

-- Supabase owns realtime.messages and already enables RLS. Only its policy is
-- customized. No client may publish broadcast/presence data to these channels.
revoke insert, update, delete on realtime.messages from public, anon, authenticated;
create policy direct_messages_receive_own_invalidations on realtime.messages
for select to authenticated using (
  -- The service's authorization probe uses a synthetic row with private=false;
  -- private/public delivery isolation is enforced by Realtime's channel flag.
  extension = 'broadcast'
  and topic = (select realtime.topic())
  and topic = 'messages:' || (select messaging_private.realtime_actor())::text
);

create function messaging_private.broadcast_direct_invalidation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_profile uuid;
begin
  if not exists (select 1 from public.conversations conversation
    where conversation.id = new.conversation_id
      and conversation.type = 'direct' and conversation.status <> 'removed') then
    return new;
  end if;

  if tg_table_name = 'conversation_members' then
    -- A read acknowledgment is private to its owner. No peer read receipt is
    -- exposed. An unchanged monotonic cursor must not cause a refetch loop.
    if tg_op = 'UPDATE' and new.last_read_sequence = old.last_read_sequence then
      return new;
    end if;
    if exists (select 1 from public.profiles profile
      join auth.users account on account.id = profile.id
      where profile.id = new.profile_id and profile.onboarding_completed_at is not null
        and profile.display_name is not null and account.deleted_at is null
        and (account.banned_until is null or account.banned_until <= now())) then
      perform realtime.send(jsonb_build_object('conversation_id', new.conversation_id),
        'messages_changed', 'messages:' || new.profile_id::text, true);
    end if;
  else
    for v_profile in
      select member.profile_id from public.conversation_members member
      join public.profiles profile on profile.id = member.profile_id
      join auth.users account on account.id = profile.id
      where member.conversation_id = new.conversation_id and member.membership_status = 'active'
        and profile.onboarding_completed_at is not null and profile.display_name is not null
        and account.deleted_at is null
        and (account.banned_until is null or account.banned_until <= now())
    loop
      perform realtime.send(jsonb_build_object('conversation_id', new.conversation_id),
        'messages_changed', 'messages:' || v_profile::text, true);
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function messaging_private.broadcast_direct_invalidation() from public, anon, authenticated;

create trigger broadcast_direct_message_insert
after insert on public.messages for each row
execute function messaging_private.broadcast_direct_invalidation();
create trigger broadcast_direct_membership_insert
after insert on public.conversation_members for each row
execute function messaging_private.broadcast_direct_invalidation();
create trigger broadcast_direct_read_cursor
after update of last_read_sequence on public.conversation_members for each row
execute function messaging_private.broadcast_direct_invalidation();

comment on function messaging_private.broadcast_direct_invalidation() is
  'Private, content-free invalidations to eligible direct-chat participants. Clients refetch through authorized RPCs.';
