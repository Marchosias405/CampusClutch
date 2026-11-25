begin;

create or replace function safety_private.check_account_access() returns void
language plpgsql stable security invoker set search_path='' as $$
begin
  if not safety_private.account_allowed() then
    raise exception using errcode='PT403', message='Your Clu account is temporarily suspended.';
  end if;
end;
$$;

-- Preview and local have different versions of the deletion routine while
-- held-evidence cleanup is being rolled out. Preserve each version's behavior.
do $$
declare
  definition text := pg_get_functiondef('account_private.begin_deletion(uuid,text,text)'::regprocedure);
begin
  if strpos(definition, 'title=''CampusClutch''') = 0 then
    raise exception 'Unexpected deletion notice definition';
  end if;
  execute replace(definition, 'title=''CampusClutch''', 'title=''Clu''');
end;
$$;

update public.notifications set title='Clu'
where actor_id is null and title='CampusClutch' and body='An update is available.';

commit;
