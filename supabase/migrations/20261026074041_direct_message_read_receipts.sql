-- First acknowledged read time for direct messages. Existing read cursors are
-- retained; their historical timestamps cannot be reconstructed honestly.
create table messaging_private.direct_message_reads (
  message_id uuid primary key references public.messages(id) on delete cascade,
  read_at timestamptz not null check (isfinite(read_at))
);
alter table messaging_private.direct_message_reads enable row level security;
revoke all on messaging_private.direct_message_reads from public, anon, authenticated;

create function messaging_private.record_direct_message_reads()
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
    join public.profiles profile on profile.id = member.profile_id
    join auth.users account on account.id = profile.id
    where member.conversation_id = new.conversation_id and member.profile_id <> new.profile_id
      and member.membership_status = 'active'
      and profile.onboarding_completed_at is not null and profile.display_name is not null
      and account.deleted_at is null
      and (account.banned_until is null or account.banned_until <= now())
  loop
    perform realtime.send(jsonb_build_object('conversation_id', new.conversation_id),
      'messages_changed', 'messages:' || v_peer::text, true);
  end loop;
  return new;
end;
$$;
revoke all on function messaging_private.record_direct_message_reads() from public, anon, authenticated;
create trigger direct_message_read_receipts after update of last_read_sequence on public.conversation_members
for each row execute function messaging_private.record_direct_message_reads();

create function messaging_private.message_read_receipts(p_conversation_id uuid, p_message_ids uuid[])
returns table (message_id uuid, is_read boolean, read_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := messaging_private.realtime_actor();
begin
  if v_actor is null or not messaging_private.can_read_conversation(p_conversation_id) then
    raise exception 'Conversation unavailable' using errcode = '42501';
  end if;
  if p_message_ids is null or cardinality(p_message_ids) < 1 or cardinality(p_message_ids) > 50
    or array_ndims(p_message_ids) <> 1
    or exists (select 1 from unnest(p_message_ids) id where id is null)
    or (select count(distinct id) from unnest(p_message_ids) id) <> cardinality(p_message_ids) then
    raise exception 'Choose 1 to 50 distinct messages' using errcode = '22023';
  end if;
  if (select count(*) from public.messages message where message.id = any(p_message_ids)
    and message.conversation_id = p_conversation_id and message.sender_id = v_actor) <> cardinality(p_message_ids) then
    raise exception 'Messages unavailable' using errcode = '42501';
  end if;
  return query
  select message.id, coalesce(peer.last_read_sequence >= message.sequence, false), receipt.read_at
  from public.messages message
  left join public.conversation_members peer on peer.conversation_id = message.conversation_id
    and peer.profile_id <> v_actor and peer.membership_status = 'active'
  left join messaging_private.direct_message_reads receipt on receipt.message_id = message.id
  where message.id = any(p_message_ids) and message.conversation_id = p_conversation_id
    and message.sender_id = v_actor;
end;
$$;
revoke all on function messaging_private.message_read_receipts(uuid, uuid[]) from public, anon, authenticated;
grant execute on function messaging_private.message_read_receipts(uuid, uuid[]) to authenticated;

create function public.get_message_read_receipts(p_conversation_id uuid, p_message_ids uuid[])
returns table (message_id uuid, is_read boolean, read_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select * from messaging_private.message_read_receipts(p_conversation_id, p_message_ids);
$$;
revoke all on function public.get_message_read_receipts(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.get_message_read_receipts(uuid, uuid[]) to authenticated;
comment on function public.get_message_read_receipts(uuid, uuid[]) is
  'Bounded sender-only direct-message receipts. Historical read cursors can report Read with no known time.';
