begin;

-- Account decisions remain available to a suspended student, including while
-- completing onboarding. Both the account and its specific sign-in must exist.
create function safety_private.require_decision_actor()
returns uuid language plpgsql stable security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if not exists (
    select 1
    from auth.sessions s
    join auth.users u on u.id = s.user_id
    join public.profiles p on p.id = u.id
    where s.user_id = actor and s.id::text = (auth.jwt()->>'session_id')
      and (s.not_after is null or s.not_after > clock_timestamp())
      and u.deleted_at is null and p.deleted_at is null and u.email_confirmed_at is not null
      and not coalesce(u.is_anonymous, false)
      and (u.banned_until is null or u.banned_until <= clock_timestamp())
  ) then
    raise exception using errcode = '42501', message = 'Sign in to view your account decisions.';
  end if;
  return actor;
end;
$$;
revoke all on function safety_private.require_decision_actor() from public, anon, authenticated, service_role;

-- Preserve the session lock used by appeals. Acknowledgements also take it,
-- so a session revocation and a change to the read position have a clear order.
create or replace function safety_private.require_appeal_actor()
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from auth.sessions s
    where s.user_id = auth.uid() and s.id::text = (auth.jwt()->>'session_id')
    for share;
  if not found then
    raise exception using errcode = '42501', message = 'Sign in to view your account decisions.';
  end if;
  return safety_private.require_decision_actor();
end;
$$;

create or replace function safety_private.my_account_standing()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := safety_private.require_decision_actor();
  standing safety_private.account_standing;
  notices jsonb;
begin
  select * into standing from safety_private.account_standing where profile_id = actor;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'kind', kind, 'reason', reason, 'created_at', created_at,
    'automatic_suspension', automatic_suspension
  ) order by created_at desc), '[]'::jsonb) into notices
  from (
    select * from safety_private.enforcement_actions
    where subject_id = actor and revoked_at is null
      and (kind <> 'warn' or standing.suspended_until > now())
      and created_at > coalesce(standing.acknowledged_at, '-infinity')
    order by created_at desc limit 20
  ) n;
  return jsonb_build_object('warning_count', coalesce(standing.warning_count, 0),
    'suspended_until', standing.suspended_until, 'suspended', coalesce(standing.suspended_until > now(), false),
    'notices', notices);
end;
$$;

create or replace function safety_private.acknowledge_account_notice(p_through timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := safety_private.require_appeal_actor();
begin
  if p_through is null or not isfinite(p_through) or p_through > clock_timestamp() then
    raise exception using errcode = '22023', message = 'Invalid acknowledgement.';
  end if;
  update safety_private.account_standing
    set acknowledged_at = greatest(acknowledged_at, p_through) where profile_id = actor;
end;
$$;

commit;
