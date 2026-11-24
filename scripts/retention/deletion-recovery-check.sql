-- Run on the authoritative source and the fenced restore at the same cutoff.
-- Save the source result independently of the database backup.
\set ON_ERROR_STOP on
begin transaction isolation level repeatable read read only;
set local row_security = off;
set local statement_timeout = '60s';
set local lock_timeout = '3s';
with deletion_state as (
  select d.id, d.profile_id, d.requested_at, d.completed_at,
         p.deleted_at is not null and p.is_discoverable is false
         and p.display_name = 'Deleted student' and p.avatar_path is null
         and p.major is null and p.campus_id is null and p.year_of_study is null
         and not exists (select from auth.sessions s where s.user_id = d.profile_id)
         and not exists (select from public.course_memberships m where m.profile_id = d.profile_id)
         and not exists (select from course_reviews_private.reviews r where r.author_id = d.profile_id)
         and not exists (select from notifications_private.android_push_devices n where n.profile_id = d.profile_id)
         and (d.completed_at is null or (
           u.deleted_at is not null and not exists (
             select from storage.objects o where o.owner_id = d.profile_id::text
               or (o.bucket_id = 'avatars' and split_part(o.name, '/', 1) = d.profile_id::text)
           )
         )) as cleanup_consistent
  from account_private.deletions d
  left join public.profiles p on p.id = d.profile_id
  left join auth.users u on u.id = d.profile_id
)
select count(*) as accepted, count(completed_at) as completed,
       count(*) filter (where completed_at is null) as pending,
       count(*) filter (where cleanup_consistent is not true) as privacy_mismatches,
       encode(sha256(convert_to(coalesce(string_agg(
         id::text || '/' || profile_id::text || '/' || extract(epoch from requested_at)::text
         || '/' || coalesce(extract(epoch from completed_at)::text, 'pending'),
         E'\n' order by id), ''), 'UTF8')), 'hex') as deletion_digest
from deletion_state;
rollback;
