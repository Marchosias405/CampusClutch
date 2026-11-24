begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();

create function pg_temp.signup(address text) returns void language sql as $$
  insert into auth.users(id, email) values (gen_random_uuid(), address);
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname='campusclutch_test_email_signup') then
    create role campusclutch_test_email_signup nologin;
  end if;
end;
$$;
select lives_ok($$select pg_temp.signup('eligibility-preview@example.test')$$, 'The test backend accepts fixture mailboxes');
-- Rename inside this transaction so the fixture policy still applies to other database sessions.
alter role campusclutch_test_email_signup rename to campusclutch_inactive_fixture_policy;
set local request.jwt.claims = '{"app_environment":"preview"}';
select throws_ok($$select pg_temp.signup('eligibility-default@example.test')$$, '23514',
  'Use your SFU email address ending in @sfu.ca.', 'The default requires SFU regardless of client claims');

select throws_ok(format('select pg_temp.signup(%L)', address), '23514',
  'Use your SFU email address ending in @sfu.ca.', label)
from (values ('a@notsfu.ca','Reject a lookalike domain'), ('a@cs.sfu.ca','Reject subdomains'),
  ('a@sfu.ca.example.test','Reject longer domains'), ('a@@sfu.ca','Reject extra at signs'),
  ('a b@sfu.ca','Reject embedded spaces'), (null,'Require an email for new identities')) as cases(address,label);
select lives_ok($$select pg_temp.signup('eligibility_alias@SFU.CA')$$, 'Accept SFU mailbox aliases and domain case');
select is((select email_confirmed_at from auth.users where email = 'eligibility_alias@SFU.CA'), null::timestamptz,
  'Matching the domain does not confirm the mailbox');
select lives_ok($$update auth.users set email=email, email_confirmed_at=now()
  where email='eligibility-preview@example.test'$$, 'Existing test accounts can finish verification');
select throws_ok($$update auth.users set email_change='changed@example.test' where email='eligibility_alias@SFU.CA'$$,
  '23514','Use your SFU email address ending in @sfu.ca.', 'Block a non-SFU pending change');
select throws_ok($$update auth.users set email='changed@example.test' where email='eligibility_alias@SFU.CA'$$,
  '23514','Use your SFU email address ending in @sfu.ca.', 'Block a non-SFU committed change');
select lives_ok($$update auth.users set email_change='eligibility-new@sfu.ca' where email='eligibility-preview@example.test'$$,
  'Allow existing testers to request a change to SFU');
select lives_ok($$update auth.users set email=email_change, email_change='' where email='eligibility-preview@example.test'$$,
  'Allow completing the SFU change and clearing its pending value');
select lives_ok($$update auth.users set email='deleted-eligibility', deleted_at=now() where email='eligibility-new@sfu.ca'$$,
  'Allow soft deletion to anonymize the mailbox');
select throws_ok($$update auth.users set deleted_at=null where email='deleted-eligibility'$$,
  '23514','Use your SFU email address ending in @sfu.ca.', 'Recheck email when a deleted identity is restored');

select * from finish();
rollback;
