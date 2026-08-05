-- Task 6: Allow authenticated users to read avatar objects in their own folder.
--
-- This supports safe avatar replacement:
--   upload new -> update profiles.avatar_path -> delete old
--
-- The existing approved-avatar SELECT policy remains responsible for
-- allowing other authenticated users to read the current avatar of a
-- completed discoverable profile.

create policy "Users can read avatars from their own folder"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and owner_id = (select auth.uid()::text)
);