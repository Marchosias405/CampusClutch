begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Supabase installations can give client roles privileges such as TRUNCATE on
-- newly created tables. Row policies apply to rows, not to table-wide DDL.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from public, anon, authenticated;

-- Some hosted projects install this event trigger to enable RLS for new
-- tables. It still runs as a DDL hook without granting access to API callers.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;

-- Keep course ownership, account-standing and classmates checks together in
-- their existing implementation. The public RPC contracts remain unchanged.
create schema courses_private;
revoke all on schema courses_private from public, anon, authenticated, service_role;
grant usage on schema courses_private to authenticated;

alter function public.join_my_course(uuid) set schema courses_private;
alter function public.leave_my_course(uuid) set schema courses_private;
alter function public.get_course_classmates(uuid) set schema courses_private;
revoke all on function courses_private.join_my_course(uuid),
  courses_private.leave_my_course(uuid), courses_private.get_course_classmates(uuid)
  from public, anon, authenticated, service_role;
grant execute on function courses_private.join_my_course(uuid),
  courses_private.leave_my_course(uuid), courses_private.get_course_classmates(uuid)
  to authenticated;

create function public.join_my_course(p_course_id uuid) returns text
language sql security invoker set search_path = '' as $$
  select safety_private.check_account_access();
  select courses_private.join_my_course(p_course_id);
$$;
create function public.leave_my_course(p_course_id uuid) returns text
language sql security invoker set search_path = '' as $$
  select safety_private.check_account_access();
  select courses_private.leave_my_course(p_course_id);
$$;
create function public.get_course_classmates(p_course_id uuid)
returns table (profile_id uuid, display_name text, major text, year_of_study smallint,
  campus_id uuid, campus_display_name text, avatar_path text, shared_interests text[],
  shared_interest_count integer, same_campus boolean)
language sql security invoker set search_path = '' as $$
  select safety_private.check_account_access();
  select * from courses_private.get_course_classmates(p_course_id);
$$;
revoke all on function public.join_my_course(uuid), public.leave_my_course(uuid),
  public.get_course_classmates(uuid) from public, anon, authenticated, service_role;
grant execute on function public.join_my_course(uuid), public.leave_my_course(uuid),
  public.get_course_classmates(uuid) to authenticated;
commit;
