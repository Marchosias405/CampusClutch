# Deferred group messaging tests

Group messaging is deferred while Task 10 finishes one-to-one messaging. These
two retained pgTAP files contain 216 group assertions from the earlier group
foundation. They are excluded from the active `supabase/tests` directory because
the current schema intentionally denies group access.

Before running them again, restore group API grants and access guards through a
reviewed migration, then review these tests against the resulting schema. Do not
temporarily grant application access to groups merely to make the old tests pass.
The original migrations, group records and membership history remain preserved.

The corresponding `scripts/test-group-messages-local.cjs` and
`scripts/test-group-messages-concurrency.py` remain in the repository for that
future work; they are excluded from the active local/concurrency package commands.

Current group-deferral and direct Realtime authorization coverage lives in
`supabase/tests/direct_realtime_and_group_deferral.test.sql` and
`scripts/test-messages-realtime-local.cjs`.
