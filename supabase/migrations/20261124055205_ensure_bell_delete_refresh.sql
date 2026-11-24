-- Some environments enable inbox refresh before they roll out bell retention.
-- Use the same statement trigger in either order so one deletion sends one
-- refresh per eligible recipient, even when several notices are removed.
create or replace trigger notifications_broadcast_delete
after delete on public.notifications
referencing old table as changed_notifications for each statement
execute function notifications_private.broadcast_changes();
