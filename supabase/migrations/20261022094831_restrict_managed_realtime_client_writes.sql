-- Hosted Supabase retains managed realtime.messages grants even after the
-- earlier REVOKE. Deny client writes through supported RLS policy changes.
-- These restrictive policies also prevail over any permissive write policy.
-- Supabase db pull --local --schema realtime omitted these managed policies;
-- the verified local statements are retained explicitly in this CLI-created migration.

create policy direct_messages_deny_client_insert on realtime.messages
as restrictive for insert to anon, authenticated with check (false);

create policy direct_messages_deny_client_update on realtime.messages
as restrictive for update to anon, authenticated using (false) with check (false);

create policy direct_messages_deny_client_delete on realtime.messages
as restrictive for delete to anon, authenticated using (false);
