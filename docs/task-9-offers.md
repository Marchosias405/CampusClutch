# Task 9 — Request Offers

## Checkpoint 1: local backend (2026-09-11, America/Vancouver)

Branch: `codex/persist-request-offers`, based on `9a87581` after README PR #26 merged.

Status at checkpoint 1: backend checkpoint tested locally. Later checkpoints below add the app UI and reopening. Task 9 is **not complete**. No hosted deployment, new APK, PR, or merge is included in these local checkpoints.

## Database contract

Migration: `20260912060259_persist_request_offers.sql`.

- `request_offers`: request/helper ownership, pending/accepted/rejected/withdrawn status, optional trimmed message (1–1000 characters; blank becomes null), server timestamps.
- Unique `(request_id, offering_user_id)` is permanent. At checkpoint 1, a terminal offer could not be submitted again. Checkpoint 3 supersedes that restriction: an owner must reopen the request before a helper can explicitly renew their offer. Ordinary retries still never reactivate an offer.
- A partial unique index permits only one accepted offer per request.
- Authenticated clients can read only their own offers or offers on requests they own. Direct inserts, updates, and deletes are denied.
- All decisions lock the request row before the offer row and recheck status and server time after waiting. Acceptance updates the request, selected offer, competing offers, and notification events in one transaction.
- Existing Task 8 cancellation also rejects pending offers atomically. Accepted requests cannot use open-request cancellation.
- Accepted helpers retain request/detail access. Rejected helpers retain their own offer history, without access to the accepted request or other offers.
- `offer_notifications` stores recipient-scoped durable event records. Recipients and event types come from backend triggers. Event uniqueness prevents duplicate notifications on retries. Event insertion failure rolls back the whole mutation.
- This is a scoped notification foundation. Task 11 will integrate the notification UI and read state; Task 10 will add conversations. No push, conversation, completion, or points transfer happens here.

Public RPCs (authenticated only; invoker wrappers around private, caller-checked functions):

| RPC | Purpose |
|---|---|
| `create_my_request_offer(p_request_id, p_message = null)` | Submit or recover the caller's existing offer ID |
| `decide_request_offer(p_offer_id, p_action)` | Owner accepts/rejects, helper withdraws; actions use `accepted`, `rejected`, `withdrawn` |
| `get_request_offers(p_request_id)` | Owner sees request offers; helper sees only their own; unrelated callers receive no rows |

Expiry uses a transactional read strategy: an authorized offer-list refresh persists `expired` and settles pending offers. Inactive rows may remain physically `open` after the deadline until that refresh, but feed queries and every new mutation enforce the server deadline immediately. A failed mutation raises an error and rolls back; it does not claim to have persisted expiry. The future UI must reload request state after fetching offers because fetching can settle expiry.

Privileged SQL writers remain responsible for request/offer lifecycle consistency. Client writes are restricted to the tested functions; existing trusted Task 8 fixtures can still represent accepted requests without an offer.

## Verification

- 53 pgTAP offer assertions passed, including role permissions, duplicate submission, terminal history, message validation, owner/helper visibility, acceptance, competing rejection, cancellation, expiry, and rollback when event creation fails.
- Five tests used separate PostgreSQL sessions. A coordinator held the request lock until both contenders were observed waiting, then released them: duplicate creation, competing acceptance, withdrawal versus acceptance, cancellation versus acceptance, and expiry during acceptance lock wait all passed.
- 61 request assertions and 13 course assertions passed as regressions.
- The exact reviewed migration was recreated and all 53 offer assertions rerun inside a rollback-only transaction. Existing local data was preserved. Concurrency fixtures were removed afterward.
- `npm run check` passed (ESLint and TypeScript).
- Local migration history matches repository version `20260912060259`.
- Local security/performance advisors reported no Task 9 warnings. They reported existing multiple permissive SELECT policies on `profiles` and `profile_social_links`: [advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies). Earlier hosted findings are recorded in the Task 8 checkpoint and were not re-audited here.

The CLI-generated schema diff included unrelated pre-existing function differences and omitted explicit privilege revocations. The migration was reviewed and replaced with the exact tested Task 9 DDL, retaining its generated version and explicit grants/revokes. The final file was replay-tested. CLI 2.109.1 sometimes reported a telemetry shutdown timeout after a successful operation; database state and generated files were verified separately.

Re-run local tests with the Supabase test runner against `supabase/tests/request_offers.test.sql`; run the independent races with:

```powershell
python scripts/test-request-offers-concurrency.py
npm run check
```

The race script needs Python and `psql` on PATH. It is deliberately fixed to the local development database on `127.0.0.1:54322`, never the hosted projects. Run it in an isolated development session; its temporary users and requests are visible briefly and are removed in `finally`.

## Checkpoint 1 handoff (historical)

Add typed client calls, approved helper display information, the helper offer flow, and owner management UI. Cover session changes, retries, offline failures, confirmation dialogs, expiry refresh, and stale decisions. Bound/paginate the owner list before shipping the UI.

There is no new phone test to run for checkpoint 1: the app has not been connected to these functions yet. The next checkpoint should provide Android tests for creating/reloading an offer, duplicate taps, withdrawing, owner rejection/acceptance, another helper's losing offer, cancellation/expiry, and offline retry. Hosted migration validation and a new Preview APK follow local UI validation.


## Checkpoint 2: offer UI and local Android validation

Implemented on the same Task 9 branch. Migration `20260912071410_offer_review_pages.sql` is applied locally; both hosted projects remain unchanged.

The user reported the checkpoint 2 phone tests passed on September 15, 2026. Their feedback identified two follow-ups: make accepted requests easier to find and allow the poster to reopen selection when they change their mind. Checkpoint 3 below addresses those follow-ups. Poster-confirmed completion, points, and mutual ratings remain separate planned checkpoints.

- Request details include Offer Help, optional message, existing offer status, withdrawal, and owner accept/decline confirmations.
- Requests links to **My offers**, which keeps accepted/closed history reachable after restart. Accepted helpers can open the request details from that history.
- Owner pages show name, major, year, and campus. Offering explicitly shares those fields with the owner even when discovery is disabled. General profile queries remain restricted; email, social links, interests, and avatars are not added to the offer response.
- `get_request_offer_page(p_request_id = null, p_limit = 20, p_offset = 0)` returns the caller's history when the request ID is null; otherwise it returns only offers the caller may review. Page sizes are limited to 1–50. Authorized reads settle expired requests and pending offers in the page.
- Client operations verify the expected account, pin the checked token on the request, and reject stale success after an account change. Screen cleanup/generation checks discard old loads.
- An offer form stays mounted during request refresh. A failed save retains its message and asks for a refresh before retry, since the server might have committed before connectivity failed. No optimistic acceptance success is shown.
- Notification events remain durable backend records; notification UI and messaging are later tasks.

Validation:

- 25 new offer-page SQL assertions passed, including pagination, private-profile summaries, unrelated-user exclusion, closed history and expiry settlement.
- All 152 SQL assertions passed (61 requests, 13 courses, 53 offer lifecycle, 25 offer pages).
- Five real concurrency races passed again.
- 13 checks in `scripts/test-offers-local.cjs` passed through local Auth/PostgREST using the actual typed offer service. This includes token pinning and stale-session rejection.
- The exact final migration passed replay with all 25 new assertions in a rollback-only transaction. Temporary API and concurrency fixtures were removed.
- ESLint, TypeScript, and Android Hermes export passed. The user subsequently reported the local Android tests passed on September 15, 2026.
- Local advisor results remain the two pre-existing multiple-permissive-policy warnings described in checkpoint 1; no new Task 9 warning was reported.

### Phone setup

Use the existing [development APK](https://expo.dev/artifacts/eas/O9HkRH_1Lpy37ay_N9CNYgVfS__VPVFfREnLUfeJdU8.apk), build `3082844b-68e0-46ac-ac22-c1faa9910e99`. This checkpoint adds no native dependencies. The Task 8 standalone Preview APK cannot load the new local source; install the development APK if Preview is currently installed.

Keep Docker Desktop running and connect the phone by USB. In your development PowerShell terminal (where `adb` is available):

```powershell
Set-Location D:\Projects\CampusClutch
adb reverse tcp:8081 tcp:8081
adb reverse tcp:54321 tcp:54321
npx expo start --dev-client --localhost
```

Open CampusClutch's development launcher and connect to `http://localhost:8081`. Use local accounts; hosted Preview accounts and data are separate. The local migrations are already applied.

### Checkpoint 2 phone checklist (passed; historical)

Use account A as the requester and account B as a helper. Use a third local account C for the competing-helper check if convenient.

1. **Offer and persist:** A creates a future-dated request. B opens it, writes an optional message and taps Offer Help. Check Pending, then close/reopen the app and find it in Requests → My offers. Rapid repeat taps/refresh must not create duplicate offers.
2. **Owner review and privacy:** A opens the request and sees B's offer and limited summary. B must not see owner accept/decline controls. If B has discovery disabled, A can still see the offer summary without gaining general profile access.
3. **Withdraw:** On a separate request, B withdraws and confirms. Reload as B and A; Withdrawn persists and B cannot reoffer in the same round. Checkpoint 3 allows a fresh offer after the owner reopens.
4. **Decline:** On another request, A declines B. B sees Not selected after refreshing; the request stays open. B cannot reoffer in the same round. Checkpoint 3 allows a fresh offer after the owner reopens.
5. **Accept and competing offers:** B and C offer on one request. A accepts B. The request becomes Accepted, B sees Accepted, C sees Not selected, and a second acceptance is unavailable. B can open the request from My offers after restart. The campus feed no longer lists it.
6. **Cancel:** A cancels an open request with B's pending offer. B refreshes My offers and sees a closed/cancelled request with the offer no longer pending.
7. **Offline draft and recovery:** As B, open a new request and type an offer message. Keep USB/Metro connected, then run `adb reverse --remove tcp:54321` in a second terminal. Try Offer Help and Refresh offers. Check the error and that the typed message remains. Restore with `adb reverse tcp:54321 tcp:54321`, refresh first, then submit only if no existing offer appears. Confirm exactly one offer persists. Turning off Wi-Fi alone does not disconnect this USB-forwarded local database.
8. **Layout and navigation:** Check the keyboard, long messages, spacing, confirmation Cancel buttons, back navigation and My offers entry. Refresh should show a loading state and keep unfinished input.

Expiry and pagination have automated coverage. The original hosted/Preview handoff is deferred until the checkpoint 3 phone findings and the separately planned completion/points scope are resolved.

## Checkpoint 3: request history and reopening (2026-09-24, America/Vancouver)

Status: implemented locally; phone validation is next. Task 9 remains in progress on `codex/persist-request-offers` and is not complete or merged. Both hosted databases and the standalone Preview APK still have their previous behavior.

- Requests now has separate **Campus feed** and **My requests** tabs, plus **My offers**. My requests includes status labels and an explanation that accepted and closed requests stay in the owner's history.
- An accepted request leaves the open campus feed. Its poster can find it in My requests, and the currently selected helper can open its details from My offers.
- The poster can choose **Reopen for new offers** on an open or accepted request and choose a new future deadline. The confirmation shows the deadline and explains that the current selection ends and every helper must offer again.
- Reopening increments the request's offer round, clears acceptance, and retires all pending/accepted offers atomically. Earlier declined and withdrawn offers remain in history. No former helper is automatically selected or returned to Pending.
- Once the request is reopened, helpers can explicitly choose **Offer again**, including helpers who were previously declined or withdrew. Each helper still has one permanent offer ID; renewal moves it into the current round with fresh consent and preserves earlier states/messages in `request_offer_history`.
- Declining or withdrawing within the current round is terminal for that round. The owner must reopen again before that helper can renew. The round sent by the app protects against an old confirmation deciding a later offer.
- Reopen/renew retries do not duplicate state or events. A stale reopen retry cannot undo a newer acceptance. Legacy decision calls are limited to the first round so an older client cannot decide renewed offers without a round check.
- Reopening accepts a new future deadline for an accepted request even if its original deadline passed. An overdue open request, a settled expired request, a cancelled request, or a completed request cannot use this workflow.
- History is visible only to the helper who owns the offer and the request poster. Direct client changes to rounds, audit records, and event records remain denied. A notification failure rolls back the complete reopen operation.

Migration: `20260924091300_reopen_request_offers.sql`, applied locally. New authenticated RPCs are `reopen_my_request`, `renew_my_request_offer`, `decide_request_offer_for_round`, and `get_request_offer_page_v2`.

Validation:

- All 93 assertions in `supabase/tests/reopen_request_offers.test.sql` passed locally, including ownership, round checks, explicit consent, deadline rules, history privacy, event deduplication, and transaction rollback.
- All 245 SQL assertions passed across five test files: 93 new reopening assertions plus the 152 earlier request, course, offer, and review-page assertions.
- Nine concurrency races and 19 typed service/API checks passed against local Supabase.
- Final ESLint, TypeScript, and Android Hermes export passed.
- Local advisors report only the two pre-existing multiple-permissive-profile-policy warnings described above; no new Task 9 warning was reported.
- The CLI-captured schema included unrelated drift and omitted explicit privilege revocations. The generated migration was narrowed to the tested reopening SQL, preserving the generated filename and explicit grants/revokes. The exact final file passed replay with all 93 new assertions in one rollback-only transaction. Existing profiles, requests, offers, notifications, offer history, and Auth users had identical row counts and fingerprints before and after replay.
- Local migration history matches repository version `20260924091300`. Read-only code review found no remaining blocking issue; native layout/date-picker behavior remains for the phone checklist below.
- Phone testing caught identical React keys on the adjacent reopening and offer sections in request details. Distinct `reopen:` and `offers:` prefixes now preserve their separate identities while retaining account/round remounts. Lint and TypeScript passed after the correction; phone confirmation is pending.

### Checkpoint 3 phone checklist

Use the existing development APK and the Phone setup commands above. Reload Metro to receive this source; this checkpoint adds no native dependency and needs no new APK. Use local accounts A (poster), B (helper), and C (second helper). Most checks work with two accounts; C is needed to confirm choosing a different helper.

1. **Find accepted work:** A creates a future-dated request, B and C offer, and A accepts B. Confirm it leaves Campus feed but remains visible as Accepted in A's My requests. B can still open it from My offers. Restart and verify both histories persist.
2. **Review before reopening:** As A, choose a new future date in Reopen for new offers. Read the confirmation and press Keep as is. Confirm B stays accepted and the request is unchanged. Repeat and confirm reopening; the new deadline should match the selected date at the end of that day.
3. **Require new consent:** A's request returns to Campus feed as Open. B's old acceptance has ended, and neither B nor C is automatically Pending or selected. After refreshing, B and C may each use Offer again and submit a new message. Confirm there is one current offer per helper and the new messages persist after reload.
4. **Choose a different helper:** A accepts C's new offer. Confirm C is Accepted, B is Not selected, and A can still find the request in My requests. C can open its details from My offers. B keeps their offer history. Reload all accounts and confirm the selection persists.
5. **Reopen an open request:** On a separate open request, decline B or have B withdraw. B must not be able to submit again in the same round. A reopens and confirms a future deadline; B may now explicitly Offer again. Confirm no previous message is submitted automatically.
6. **Permissions and repeat actions:** B and C must not see the poster's reopen or accept/decline controls. A cannot offer or renew on a helper's behalf. Repeated taps and refreshes must not create duplicate offers or unexpectedly clear an accepted helper.
7. **Offline message/deadline retention:** Keep USB and Metro connected. As a helper, type a fresh Offer again message; as the poster, choose a new reopen deadline in a separate run. In another terminal run `adb reverse --remove tcp:54321`, try the action, and confirm a useful error with the entered value retained. Restore with `adb reverse tcp:54321 tcp:54321`, refresh to check whether it already saved, then retry only if still needed. Confirm one resulting offer or reopen. Do not remove the Metro forwarding on port 8081 or disconnect USB for this test.
8. **Layout and cancellation:** Check both request tabs, status labels, long messages, date picker, keyboard, and confirmation Keep as is buttons. Cancelling the confirmation must leave the prior state intact.

### Planned completion, points, and ratings checkpoints

The requested next workflow is poster-confirmed completion: accepting a helper does not mean the work is done. The poster must explicitly confirm that it was completed before points transfer.

- Reserve the poster's points balance when a helper is accepted, preventing the same points from being committed to multiple requests.
- Release that reservation when the poster reopens selection. Require fresh helper consent and a fresh reservation when another offer is accepted.
- Transfer the reserved points to the accepted helper only when the poster confirms completion. The operation must update request status and the points ledger atomically and be safe to retry.
- Add mutual ratings after a completed request, limited to its poster and selected helper, to support reliability information. Rating eligibility and duplicate protections must be enforced by the backend.

The starting-balance/points-funding policy is unresolved and must be decided before the balance workflow is implemented. These later checkpoints are planned, not shipped: the current reopening work does not reserve, transfer, or award points and has no completion or rating action. Local phone validation is the current stopping point; hosted deployment, a new Preview APK, Preview validation, CI, review, merge, and documentation closure remain before Task 9 is complete.
