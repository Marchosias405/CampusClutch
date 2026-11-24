-- Run only on an isolated Local, Development or Preview Supabase project.
-- This marker has no login, grants or members. Ordinary data dumps do not include roles.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'campusclutch_test_email_signup') then
    create role campusclutch_test_email_signup nologin;
  end if;
end;
$$;
