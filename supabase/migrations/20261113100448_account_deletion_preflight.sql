-- Account deletion checkpoint 1: caller-bound, read-only readiness.
-- This is not a deletion authorization token. The eventual executor must lock
-- and recheck the live account, assignments, wallet and staff role at commit.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create schema account_private;
revoke all on schema account_private from public,anon,authenticated,service_role;
grant usage on schema account_private to authenticated;

create function account_private.deletion_preflight() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); session_id uuid; signed_in_at timestamptz;
  accepted_jobs integer; reservations integer; balance bigint; reserved bigint;
  staff boolean; blockers text[]:='{}'; recent boolean;
begin
  -- Resolve the actor only from a live Auth session. No target ID or editable
  -- metadata is accepted, and a recovered/revoked session cannot inspect data.
  begin session_id:=(auth.jwt()->>'session_id')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode='42501',message='Sign in again to review account deletion.';
  end;
  select s.created_at into signed_in_at from auth.sessions s join auth.users u on u.id=s.user_id
  where s.id=session_id and s.user_id=actor and u.deleted_at is null
    and (s.not_after is null or s.not_after>statement_timestamp())
    and not coalesce(u.is_anonymous,false) and u.email_confirmed_at is not null
    and (u.banned_until is null or u.banned_until<=statement_timestamp());
  if not found then
    raise exception using errcode='42501',message='Sign in again to review account deletion.';
  end if;
  -- An incomplete profile or an app suspension does not hide deletion guidance.
  -- The actual delete workflow must remain accessible outside the app's gate.
  recent:=signed_in_at is not null and signed_in_at<=statement_timestamp()
    and signed_in_at>=statement_timestamp()-interval '10 minutes';

  select count(*)::integer into accepted_jobs from (
    select r.id from public.requests r where r.owner_id=actor and r.status='accepted'
    union
    select r.id from public.request_offers o join public.requests r on r.id=o.request_id
      where o.offering_user_id=actor and o.status='accepted' and o.offer_round=r.offer_round and r.status='accepted'
    union
    -- A reserved payment always blocks, even if its request/offer state is
    -- inconsistent. Deadline expiry does not discharge an accepted obligation.
    select p.request_id from public.request_point_reservations p
      where (p.poster_id=actor or p.helper_id=actor) and p.status='reserved'
  ) jobs;
  select count(*)::integer into reservations from public.request_point_reservations
    where (poster_id=actor or helper_id=actor) and status='reserved';
  select w.balance,w.reserved into balance,reserved from public.points_wallets w where w.profile_id=actor;
  balance:=coalesce(balance,0); reserved:=coalesce(reserved,0);
  select exists(select 1 from safety_private.staff_roles where profile_id=actor and enabled) into staff;
  if accepted_jobs>0 then blockers:=array_append(blockers,'accepted_jobs'); end if;
  if reserved>0 or reservations>0 then blockers:=array_append(blockers,'reserved_points'); end if;
  if staff then blockers:=array_append(blockers,'staff_access'); end if;
  if not recent then blockers:=array_append(blockers,'recent_sign_in'); end if;

  return jsonb_build_object('policy_version',1,'checked_at',statement_timestamp(),
    'eligible',cardinality(blockers)=0,'blockers',to_jsonb(blockers),
    'accepted_jobs',accepted_jobs,'point_reservations',reservations,
    'points_balance',balance::text,'points_reserved',reserved::text,
    'open_requests',(select count(*) from public.requests where owner_id=actor and status='open' and deadline_at>statement_timestamp()),
    'pending_offers',(select count(*) from public.request_offers o join public.requests r on r.id=o.request_id
      where o.offering_user_id=actor and o.status='pending' and o.offer_round=r.offer_round
        and r.status='open' and r.deadline_at>statement_timestamp()),
    'course_memberships',(select count(*) from public.course_memberships where profile_id=actor),
    'course_reviews',(select count(*) from course_reviews_private.reviews where author_id=actor));
end $$;

create function public.get_my_account_deletion_preflight() returns jsonb
language sql stable security invoker set search_path='' as $$
  select account_private.deletion_preflight();
$$;
revoke all on function account_private.deletion_preflight(),public.get_my_account_deletion_preflight()
  from public,anon,authenticated,service_role;
grant execute on function account_private.deletion_preflight(),public.get_my_account_deletion_preflight() to authenticated;
comment on function public.get_my_account_deletion_preflight() is
  'Read-only deletion readiness for the live signed-in account. No deletion, reservation or authorization promise; all conditions must be rechecked by a future executor.';
notify pgrst,'reload schema';
commit;
