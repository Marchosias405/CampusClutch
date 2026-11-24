begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Each placement and release is insert-only. Keep the original staff account ID
-- even if its role changes or the account goes through deletion.
create table safety_private.retention_holds (
  id uuid primary key,
  target_kind text not null check (target_kind in ('case','job','thread','notice')),
  target_id uuid not null,
  placed_by uuid not null,
  placed_at timestamptz not null default clock_timestamp(),
  reason text not null check (char_length(reason) between 10 and 2000)
);
create index retention_holds_target_idx on safety_private.retention_holds(target_kind,target_id,placed_at desc,id);
create table safety_private.retention_hold_releases (
  hold_id uuid primary key references safety_private.retention_holds(id) on delete restrict,
  released_by uuid not null,
  released_at timestamptz not null default clock_timestamp(),
  reason text not null check (char_length(reason) between 10 and 2000)
);
alter table safety_private.retention_holds enable row level security;
alter table safety_private.retention_hold_releases enable row level security;
revoke all on safety_private.retention_holds, safety_private.retention_hold_releases from public, anon, authenticated, service_role;

create function safety_private.check_retention_target(p_kind text, p_id uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
  case p_kind
    when 'case' then perform 1 from safety_private.reports where id=p_id for key share;
    when 'job' then perform 1 from public.requests where id=p_id for key share;
    when 'thread' then perform 1 from public.conversations where id=p_id and type='direct' for key share;
    when 'notice' then perform 1 from public.notifications where id=p_id for key share;
    else raise exception using errcode='22023',message='Choose a retention record type.';
  end case;
  if not found then raise exception using errcode='PT404',message='Record unavailable.'; end if;
end $$;
revoke all on function safety_private.check_retention_target(text,uuid) from public,anon,authenticated,service_role;

create function safety_private.require_retention_admin(p_kind text,p_id uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare actor uuid;
begin
  perform safety_private.check_account_access();
  actor := safety_private.require_appeal_admin();
  if p_kind='case' and exists(select from safety_private.reports where id=p_id
      and (reporter_id=actor or reported_profile_id=actor)) then
    raise exception using errcode='PT404',message='Record unavailable.';
  end if;
  return actor;
end $$;
revoke all on function safety_private.require_retention_admin(text,uuid) from public,anon,authenticated,service_role;

create function safety_private.change_retention_hold(p_action text,p_kind text,p_id uuid,p_hold_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  explanation text := regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
  placement safety_private.retention_holds;
  prior_release safety_private.retention_hold_releases;
begin
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

create function safety_private.retention_hold_history(p_kind text,p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform safety_private.require_retention_admin(p_kind,p_id);
  -- A target may have disappeared through normal account deletion. Its audit
  -- remains discoverable to an admin and any outstanding hold can be released.
  if not exists(select from safety_private.retention_holds where target_kind=p_kind and target_id=p_id) then
    perform safety_private.check_retention_target(p_kind,p_id);
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'id',h.id,'placed_by',h.placed_by,'placed_at',h.placed_at,'reason',h.reason,
    'released_by',r.released_by,'released_at',r.released_at,'release_reason',r.reason)
    order by (r.hold_id is null) desc,h.placed_at desc,h.id),'[]'::jsonb)
    from safety_private.retention_holds h left join safety_private.retention_hold_releases r on r.hold_id=h.id
    where h.target_kind=p_kind and h.target_id=p_id);
end $$;

create function public.change_retention_hold(p_action text,p_kind text,p_id uuid,p_hold_id uuid,p_reason text)
returns uuid language sql security invoker set search_path='' as $$
  select safety_private.change_retention_hold(p_action,p_kind,p_id,p_hold_id,p_reason)
$$;
create function public.get_retention_holds(p_kind text,p_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select safety_private.retention_hold_history(p_kind,p_id)
$$;
revoke all on function safety_private.change_retention_hold(text,text,uuid,uuid,text),
  safety_private.retention_hold_history(text,uuid),public.change_retention_hold(text,text,uuid,uuid,text),
  public.get_retention_holds(text,uuid) from public,anon,authenticated,service_role;
grant execute on function safety_private.change_retention_hold(text,text,uuid,uuid,text),
  safety_private.retention_hold_history(text,uuid),public.change_retention_hold(text,text,uuid,uuid,text),
  public.get_retention_holds(text,uuid) to authenticated;
commit;
