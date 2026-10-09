-- Task 10 checkpoint 4 foundation: page pending group invitations and
-- rediscover privacy-bounded history after leaving or removal.

create function messaging_private.group_invitation_page(
  p_limit integer, p_before_created_at timestamptz, p_before_id uuid
)
returns table (
  id uuid, conversation_id uuid, group_title text, course_id uuid,
  course_code text, course_title text, invited_by_profile_id uuid,
  invited_by_display_name text, active_member_count integer,
  status text, created_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := messaging_private.require_actor();
begin
  if p_limit is null or p_limit < 1 or p_limit > 50
    or ((p_before_created_at is null) <> (p_before_id is null))
    or (p_before_created_at is not null and not isfinite(p_before_created_at)) then
    raise exception 'Invalid group invitation page' using errcode = '22023';
  end if;

  return query
    select invitation.id, invitation.conversation_id, group_row.title,
      group_row.course_id, course.code, course.title,
      invitation.invited_by_profile_id, inviter.display_name,
      (select count(*)::integer
       from public.conversation_members member
       where member.conversation_id = invitation.conversation_id
         and member.membership_status = 'active'),
      invitation.status, invitation.created_at
    from public.group_conversation_invitations invitation
    join public.group_conversations group_row
      on group_row.conversation_id = invitation.conversation_id
    join public.conversations conversation
      on conversation.id = group_row.conversation_id
     and conversation.status = 'active'
    join public.courses course on course.id = group_row.course_id
    join public.profiles inviter on inviter.id = invitation.invited_by_profile_id
    where invitation.invitee_profile_id = v_actor
      and invitation.status = 'pending'
      and (p_before_created_at is null
        or (invitation.created_at, invitation.id)
          < (p_before_created_at, p_before_id))
    order by invitation.created_at desc, invitation.id desc
    limit p_limit;
end;
$$;
revoke all on function messaging_private.group_invitation_page(
  integer, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function messaging_private.group_invitation_page(
  integer, timestamptz, uuid
) to authenticated;

create function public.get_my_group_invitations_page(
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id uuid, conversation_id uuid, group_title text, course_id uuid,
  course_code text, course_title text, invited_by_profile_id uuid,
  invited_by_display_name text, active_member_count integer,
  status text, created_at timestamptz
) language sql stable security invoker set search_path = '' as $$
  select * from messaging_private.group_invitation_page(
    p_limit, p_before_created_at, p_before_id
  );
$$;
revoke all on function public.get_my_group_invitations_page(
  integer, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.get_my_group_invitations_page(
  integer, timestamptz, uuid
) to authenticated;

create function messaging_private.former_group_inbox(
  p_limit integer, p_before_activity_at timestamptz, p_before_id uuid
)
returns table (
  id uuid, type text, status text,
  other_profile_id uuid, other_display_name text,
  group_title text, group_course_id uuid, group_course_code text,
  active_member_count integer, my_role text, my_membership_status text,
  my_membership_period integer, management_revision text, can_send boolean,
  last_message_body text, last_message_at timestamptz,
  last_activity_at timestamptz, last_message_sequence text,
  last_read_sequence text, unread_count integer, created_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := messaging_private.require_actor();
begin
  if p_limit is null or p_limit < 1 or p_limit > 50
    or ((p_before_activity_at is null) <> (p_before_id is null))
    or (p_before_activity_at is not null and not isfinite(p_before_activity_at)) then
    raise exception 'Invalid former group page' using errcode = '22023';
  end if;

  return query
    select summary_row.*
    from public.conversation_members member
    join public.conversations conversation
      on conversation.id = member.conversation_id
     and conversation.type = 'group'
     and conversation.status <> 'removed'
    cross join lateral
      jsonb_to_record(messaging_private.summary(conversation.id)) as summary_row(
        id uuid, type text, status text,
        other_profile_id uuid, other_display_name text,
        group_title text, group_course_id uuid, group_course_code text,
        active_member_count integer, my_role text, my_membership_status text,
        my_membership_period integer, management_revision text, can_send boolean,
        last_message_body text, last_message_at timestamptz,
        last_activity_at timestamptz, last_message_sequence text,
        last_read_sequence text, unread_count integer, created_at timestamptz
      )
    where member.profile_id = v_actor
      and member.membership_status in ('left', 'removed')
      and (p_before_activity_at is null
        or (summary_row.last_activity_at, summary_row.id)
          < (p_before_activity_at, p_before_id))
    order by summary_row.last_activity_at desc, summary_row.id desc
    limit p_limit;
end;
$$;
revoke all on function messaging_private.former_group_inbox(
  integer, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function messaging_private.former_group_inbox(
  integer, timestamptz, uuid
) to authenticated;

create function public.get_my_former_group_conversations(
  p_limit integer default 20,
  p_before_activity_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id uuid, type text, status text,
  other_profile_id uuid, other_display_name text,
  group_title text, group_course_id uuid, group_course_code text,
  active_member_count integer, my_role text, my_membership_status text,
  my_membership_period integer, management_revision text, can_send boolean,
  last_message_body text, last_message_at timestamptz,
  last_activity_at timestamptz, last_message_sequence text,
  last_read_sequence text, unread_count integer, created_at timestamptz
) language sql stable security invoker set search_path = '' as $$
  select * from messaging_private.former_group_inbox(
    p_limit, p_before_activity_at, p_before_id
  );
$$;
revoke all on function public.get_my_former_group_conversations(
  integer, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.get_my_former_group_conversations(
  integer, timestamptz, uuid
) to authenticated;
