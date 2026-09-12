# Task 8 — Persist Requests

## Latest checkpoint: Preview phone validation passed (2026-09-11)

The user confirmed all five standalone Preview tests passed on build `bb1edd72-ab02-4d24-8372-2f4540112157`: all four request types persist after restart; owner edit/cancel works; another account cannot edit/cancel; offline refresh recovers after reconnecting; and an offline save preserves form values. This closes the previously deferred Requests offline/retry test. Earlier pending/unverified notes below describe prior checkpoints.

Phone validation is complete. Final CI, review, and Task 8 merge remain pending.

Final local review on September 11 covered owner-only mutations, request/detail atomicity, RLS visibility, category mapping, stale-read guards, form error retention, and the Android layout fixes. No blocking findings were identified. `npm run check` and `git diff --check` passed. Local Supabase was stopped, so the previously passed database/API suites and hosted validation were not represented as fresh local reruns. GitHub CI must pass before merge.

## Checkpoint: database foundation (2026-09-07)

Task 7 is merged through PR #24 (`13d2202`). This work starts from that commit on `codex/persist-requests`.

Stages 1 and 2 are implemented locally. The app now uses persistent request loading, creation, details, editing, cancellation, and owner history. Task 8 is **not complete** until Android validation, hosted deployment, CI/review, and merge.

Migration: `supabase/migrations/20260907204626_persist_requests.sql`.
Tests: `supabase/tests/requests.test.sql`.

## Database contract

- `requests` stores shared fields, authenticated owner, server timestamps, status, campus, deadline, positive integer points, item size, and urgency.
- Each request has exactly one matching row in `delivery_request_details`, `pickup_request_details`, `event_help_request_details`, or `study_help_request_details`. Composite foreign keys reject category mismatches; deferred constraints reject missing details.
- Signed-out clients have no access. Authenticated clients can read open, unexpired requests; owners can also read their own history. Detail visibility follows the parent request.
- Clients cannot write tables directly. Public RPC wrappers run as the caller and delegate mutations to guarded functions in the unexposed `request_private` schema.
- `save_my_request(p_payload jsonb, p_request_id uuid default null)` returns the UUID. Omit the ID to create; supply it to replace editable common/detail fields of an owned, open, unexpired request. An onboarded profile is required. The transaction rolls back both rows on failure.
- The payload requires `category`, `title`, `description`, `campus_id`, `room_location`, `deadline_at`, `points`, `item_size`, and `details`. `is_urgent` is optional and defaults to false, including during edits. Send the complete form when editing. Owner, status, timestamps, IDs, and other unknown fields are rejected.
- Categories: `delivery`, `pickup`, `event_help`, `study_help`. Item sizes: `small`, `medium`, `large`. Points must be a JSON number with a positive integral value. Deadline must be finite and future according to database time.
- Detail keys: delivery → `pickup_location`, `dropoff_location`; pickup → `pickup_location`, `destination`; event help → `event_name`, `help_needed`; study help → `course_or_subject`, `topic`. All are required strings; study fields remain free text for this task.
- `cancel_my_request(p_request_id uuid)` preserves the row, changes an owned open request to cancelled, and sets cancellation/update timestamps. Repeating cancellation is harmless. An expired row whose stored status is still open can be cancelled; it cannot be edited or revived. Accepted/completed workflows belong to later tasks.
- `get_request_feed(p_category text default null, p_campus_id uuid default null, p_limit integer default 20, p_offset integer default 0)` returns open, unexpired rows ordered by urgency, creation time, then UUID descending. Page sizes are 1–50. Null category means all categories. Offset pagination may shift as new requests arrive; refresh starts from offset zero.
- Expiration is evaluated at read time; no scheduler changes stored status to expired. Owner history must calculate the effective expired label from deadline/status. Urgency remains a user-supplied boolean until its product policy is settled.

## Verification and environment

- 61 pgTAP assertions passed against local Supabase, including all four categories, invalid input, atomic rollback, spoofing, owner/non-owner/anonymous access, cancellation, expiration, filtering, and relational integrity.
- All 13 existing course/membership tests passed after the migration.
- Local security advisors reported no issues at warning/error level.
- The migration was applied with `supabase migration up --local`; migration history confirms version `20260907204626`. CLI 2.109.1 reported a PostHog shutdown timeout after successful migration/advisor output; direct database checks and subsequent tests confirmed success.
- Test fixtures run inside rollback transactions; no test requests remain. Existing users and course data were not reset.
- Hosted Development and Preview received this Task 8 migration on September 7 (see stage 3). The local `.env.local` still points at local Supabase.

To independently repeat the database checks from the repository using an installed PostgreSQL client:

```powershell
$env:PGPASSWORD = 'postgres' # Local Supabase development password only
psql -X -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/requests.test.sql
psql -X -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/course_memberships.test.sql
```

Expect `1..61` and `1..13`, every assertion `ok`, and final `ROLLBACK`. A pgTAP `not ok` is a failed test even if psql exits successfully.

## Stage 2: Android checkpoint

The user agreed to defer request-feed offline/retry validation to the standalone Preview build before release. It remains unverified. The temporary header Refresh button was removed after this decision; pull-to-refresh remains available.

Connection-test follow-up: after removing the database USB forwarding, reopening the app displayed the profile connection error with Retry. Restoring forwarding recovered normal operation with saved requests intact. This confirms startup connection-error handling and persistence. Pull-to-refresh reportedly appeared to do nothing, so request-feed offline/retry remains unverified. An explicit header Refresh button and loading label were added to make that test observable. Keep USB and port 8081 connected, remove only port 54321 forwarding, tap Refresh on Requests, then restore port 54321 and retry.

Android feedback received September 7: the user confirmed that Edit/Cancel are hidden when viewing another account's request, reload persistence passes, and invalid-input tests pass. Screenshots also show all four detail types, an updated study request, cancellation, and removal from the feed. Offline/retry remains unconfirmed. Screenshot review prompted a layout fix: location and deadline now have separate rows above View Details, and owner actions have a gap with centered labels. These visual changes need a quick phone recheck.

The request service maps all four detail types from the API. Feed filtering and pagination run on the backend; pull-to-refresh, focus refresh, and a one-minute refresh keep visible data current. My requests includes owned history. Detail screens load by UUID independently of the feed. Only owners see edit/cancel controls. Form saves are awaited with a duplicate-tap lock; errors preserve the form. Session changes discard stale reads. No private owner-profile fields are fetched or exposed; named requester profiles remain a follow-up decision. The simulated offer confirmation and mock points balance were removed from the request feed/details.

Validation: TypeScript and ESLint pass. The local API integration test uses the actual request service against a temporary account: all four creates/reloads and detail mappings, owner history, filtered feed, edit, cancellation, and feed removal passed (13 assertions). Run `node scripts/test-requests-local.cjs` from the repo with local Supabase and `psql` available. It requires `.env.local` to point exactly at `http://127.0.0.1:54321` and cleans up its temporary account/requests. It does not exercise the phone UI.

Use the existing development APK; no native dependencies changed. Keep local Supabase running, connect the phone by USB, and restart Metro if needed:

The Android production JavaScript bundle also exported successfully (1,616 modules). This validates bundling, not physical-device behavior.

```powershell
Set-Location D:\Projects\CampusClutch
adb reverse tcp:8081 tcp:8081
adb reverse tcp:54321 tcp:54321
npx expo start --dev-client --localhost
```

Android tests:

1. Open Requests. Expect an empty real feed if no requests exist; no mock cards or balance. Pull to refresh without an error.
2. Create Delivery, Pickup, Event Help, and Study Help requests with distinct titles, points, locations, and details. Use a future date. Each successful save opens its details with the exact submitted values. Dates chosen in the form expire at the end of that day in the phone's timezone.
3. Reload the app. All four requests should remain. Switch each category filter, return to All, and pull to refresh. Open details again and verify every category-specific field.
4. Open an owned request, choose Edit Request, change title, points, and a category detail, then save and reload. Changes persist. Category stays fixed. An unchanged deadline is preserved.
5. Cancel a request and confirm. It disappears from the campus feed but remains Cancelled under My requests. It has no edit button.
6. Sign out and sign in as a different onboarded user. Open remaining requests; no edit/cancel controls should appear. My requests should show only that account's requests. No simulated Offer Sent confirmation should appear.
7. Submit an empty title, a short description, zero/negative/fractional points. No request should be created. Valid submission with rapid repeated taps should create one row.
8. Disconnect the phone's network/USB connection to local Supabase. Feed refresh and saving should show an error. Restore the connection and retry. Form values should remain after a failed save. If connection drops during a save, check My requests before resubmitting because the server may already have saved it.
9. If you have more than 20 requests, use Load more and verify no duplicate cards. Change category or toggle My requests while loading; results should match the newest selection.

Expiration and unauthorized writes are covered by the database tests. For a phone expiration check, a request passing its deadline should disappear after refresh and show Expired in My requests. The phone supplies the display label; database time controls feed eligibility and edit authorization.

After Android validation, deploy and verify the migration in Development and Preview, complete CI/review, and then merge Task 8.

## Stage 3: hosted database validation (2026-09-07)

The request migration is deployed to CampusClutch Development (`ayisjsajufjkebvbzpdr`) and CampusClutch Preview (`udbijakeasbvoycjyghe`). Both were ACTIVE_HEALTHY before deployment. Each passed 61 request assertions and 13 course regression assertions through rollback transactions. No test users or requests remain. Existing user/course data was not reset.

Migration history in both environments matches repository version `20260907204626`. The connector assigned deployment-time versions (`20260908033155` in Development and `20260908033253` in Preview); those exact history records were aligned to the repository version after successful application to prevent a future CLI push from applying the same schema twice.

Hosted security advisors did not flag Task 8 request objects. They reported warnings on existing objects/settings in both environments:

- `public.rls_auto_enable()` execution grants for anonymous and authenticated roles: [anonymous definer guidance](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).
- Authenticated execution of `get_course_classmates`, `join_my_course`, and `leave_my_course`: [authenticated definer guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). The course authorization regression tests passed; these findings still need review before release.
- Disabled leaked-password protection: [password protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

The EAS `preview` environment was verified as `EXPO_PUBLIC_APP_ENV=preview` and `EXPO_PUBLIC_SUPABASE_URL=https://udbijakeasbvoycjyghe.supabase.co`. Local environment files are Git-ignored and local configuration remains unchanged. TypeScript and ESLint passed before build packaging.

On September 8 the user explicitly authorized uploading the current source to Expo/EAS. Upload succeeded and standalone Android Preview build `bb1edd72-ab02-4d24-8372-2f4540112157` was submitted using the existing signing key. [Build status](https://expo.dev/accounts/marchosias405/projects/CampusClutch/builds/bb1edd72-ab02-4d24-8372-2f4540112157).

Build status: **FINISHED**. [Download the standalone Preview APK](https://expo.dev/artifacts/eas/86g_Kk2Eal1kXnxdIS2pSdFZLZ5DqpQrb-19xq2wBQk.apk).

Install this APK on the phone. It uses the same Android package as the development app, so it may replace that installation. Launch it without Metro or USB forwarding. Use a hosted Preview account; local accounts and requests are separate.

Preview phone checklist:

1. Open without USB/Metro and sign in or create a Preview account, completing onboarding if needed.
2. Create each request type and check all details. Close/reopen the app and verify persistence.
3. Edit an owned request, then cancel it. Verify the edited values persist and cancellation removes it from the feed while keeping it in My requests.
4. With another Preview account, verify the first account's open requests are visible but Edit/Cancel are hidden.
5. While Requests stays open, turn off both Wi-Fi and mobile data, then pull to refresh. Record whether an error appears or loading stalls. Restore networking and retry; saved requests should return.
6. Test a failed save while offline. Form values should remain. After restoring networking, check My requests before resubmitting in case a previous save already reached the server.

The build and physical-device Preview validation are complete. No app-store submission or Task 8 merge has been performed.

The completed build uses Android profile `preview`, internal distribution, and the existing EAS keystore. Hosted phone validation and offline/retry validation passed. Final CI/review and merge remain pending.
