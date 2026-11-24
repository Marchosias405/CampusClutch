begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();

-- Catalog-only checks include new endpoints/tables as the application grows.
select is_empty($$
  select c.relname from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p')
    and not c.relrowsecurity
    and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass
                    and d.objid = c.oid and d.deptype = 'e')
$$, 'All public application tables have row-level security');

select is_empty($$
  select p.proname from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prosecdef
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
         or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass
                    and d.objid = p.oid and d.deptype = 'e')
$$, 'Application RPCs callable by client roles use invoker rights');

select is_empty($$
  select p.proname from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and has_function_privilege('anon', p.oid, 'EXECUTE')
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass
                    and d.objid = p.oid and d.deptype = 'e')
$$, 'New application RPCs must opt in to authenticated access explicitly');

select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where right(n.nspname, 8) = '_private' and c.relkind in ('r','p')
    and (not c.relrowsecurity
         or has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         or has_any_column_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')
         or has_any_column_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))
$$, 'Private application tables protect rows and deny all direct client reads and writes');

select is_empty($$
  select c.relname from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p')
    and (has_table_privilege('anon', c.oid, 'TRUNCATE,REFERENCES,TRIGGER')
         or has_table_privilege('authenticated', c.oid, 'TRUNCATE,REFERENCES,TRIGGER'))
    and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass
                    and d.objid = c.oid and d.deptype = 'e')
$$, 'Client roles have no table-wide administrative grants on application tables');

select ok(has_function_privilege('authenticated', 'public.' || f, 'EXECUTE')
      and has_function_privilege('authenticated', 'courses_private.' || f, 'EXECUTE')
      and not has_function_privilege('anon', 'courses_private.' || f, 'EXECUTE'),
      'Authenticated course RPC contract is preserved for ' || f)
from unnest(array['join_my_course(uuid)','leave_my_course(uuid)','get_course_classmates(uuid)']) f;

-- Check actual default ACLs on fresh objects without depending on the starting
-- privileges of a particular CLI or hosted Postgres version.
create table public.prelaunch_grant_probe(id integer);
create sequence public.prelaunch_sequence_probe;
select ok(not has_table_privilege(r, 'public.prelaunch_grant_probe',
                                  'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
          r || ' receives no implicit grants on a new public table')
from unnest(array['anon','authenticated']) r;
select ok(not has_sequence_privilege(r, 'public.prelaunch_sequence_probe', 'SELECT,UPDATE,USAGE'),
          r || ' receives no implicit grants on a new public sequence')
from unnest(array['anon','authenticated']) r;

select * from finish();
rollback;
