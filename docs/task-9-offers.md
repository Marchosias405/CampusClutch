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

The user reported the checkpoint 2 phone tests passed on September 15, 2026. Their feedback identified two follow-ups: make accepted requests easier to find and allow the poster to reopen selection when they change their mind. Checkpoint 3 below addresses those follow-ups. Checkpoint 4 adds points and poster-confirmed completion; mutual ratings remain later work.

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

Status: local phone tests passed after the request-details React key correction. Task 9 remains in progress on `codex/persist-request-offers` and is not complete or merged. Both hosted databases and the standalone Preview APK still have their previous behavior.

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
- Phone testing caught identical React keys on the adjacent reopening and offer sections in request details. Distinct `reopen:` and `offers:` prefixes now preserve their separate identities while retaining account/round remounts (`59aab33`). Lint and TypeScript passed after the correction; the user subsequently reported the tests passed.

### Checkpoint 3 phone checklist (passed; historical)

Use the existing development APK and the Phone setup commands above. Reload Metro to receive this source; this checkpoint adds no native dependency and needs no new APK. Use local accounts A (poster), B (helper), and C (second helper). Most checks work with two accounts; C is needed to confirm choosing a different helper.

1. **Find accepted work:** A creates a future-dated request, B and C offer, and A accepts B. Confirm it leaves Campus feed but remains visible as Accepted in A's My requests. B can still open it from My offers. Restart and verify both histories persist.
2. **Review before reopening:** As A, choose a new future date in Reopen for new offers. Read the confirmation and press Keep as is. Confirm B stays accepted and the request is unchanged. Repeat and confirm reopening; the new deadline should match the selected date at the end of that day.
3. **Require new consent:** A's request returns to Campus feed as Open. B's old acceptance has ended, and neither B nor C is automatically Pending or selected. After refreshing, B and C may each use Offer again and submit a new message. Confirm there is one current offer per helper and the new messages persist after reload.
4. **Choose a different helper:** A accepts C's new offer. Confirm C is Accepted, B is Not selected, and A can still find the request in My requests. C can open its details from My offers. B keeps their offer history. Reload all accounts and confirm the selection persists.
5. **Reopen an open request:** On a separate open request, decline B or have B withdraw. B must not be able to submit again in the same round. A reopens and confirms a future deadline; B may now explicitly Offer again. Confirm no previous message is submitted automatically.
6. **Permissions and repeat actions:** B and C must not see the poster's reopen or accept/decline controls. A cannot offer or renew on a helper's behalf. Repeated taps and refreshes must not create duplicate offers or unexpectedly clear an accepted helper.
7. **Offline message/deadline retention:** Keep USB and Metro connected. As a helper, type a fresh Offer again message; as the poster, choose a new reopen deadline in a separate run. In another terminal run `adb reverse --remove tcp:54321`, try the action, and confirm a useful error with the entered value retained. Restore with `adb reverse tcp:54321 tcp:54321`, refresh to check whether it already saved, then retry only if still needed. Confirm one resulting offer or reopen. Do not remove the Metro forwarding on port 8081 or disconnect USB for this test.
8. **Layout and cancellation:** Check both request tabs, status labels, long messages, date picker, keyboard, and confirmation Keep as is buttons. Cancelling the confirmation must leave the prior state intact.

## Checkpoint 4: starting points and confirmed completion (2026-09-24, America/Vancouver)

Status: implemented and tested locally; Android phone validation is next. The user approved **100 starting points for every account**, with creator-made miniature quests for earning more points later. Task 9 remains in progress; neither hosted database nor the standalone Preview APK has this checkpoint.

### Points policy and app behavior

- Every existing profile receives one 100-point welcome grant when the migration runs. New profiles receive the same grant through a database trigger. Sign-in, reload, reinstall, and profile updates do not create another grant.
- A wallet has a total balance, a reserved amount, and an available amount (`total - reserved`). Profile shows these values and the latest 20 ledger transactions. Home greets the signed-in account by its saved profile name and links to Profile instead of showing a mock balance or reward progress.
- Creating or editing a request requires the offered amount to fit the poster's current available balance, excluding reserved points. The app checks on every save and the database repeats the check under a wallet lock. Saving does not reserve points. Accepting a helper rechecks available points and reserves the request's amount. The helper receives nothing yet. A failed save or acceptance leaves existing data unchanged.
- Acceptance submits the points amount shown in its confirmation. The backend checks that amount and the offer round under the request lock. If another session changes the reward, the old confirmation fails and requires refresh. Older clients without an amount-confirmation parameter cannot accept; their decline and withdrawal actions remain supported.
- Reopening releases the current reservation and retires the old selection. Helpers must explicitly offer again, and a new acceptance creates a new reservation.
- Only the poster can choose **Confirm completion**. The confirmation names the amount and explains that completed work cannot be reopened. Confirming atomically completes the request, deducts the reserved points from the poster, credits the helper, and writes one debit and one credit. Retrying cannot pay twice.
- Accepted and completed work remains reachable through the poster's My requests and the helper's My offers. The helper sees whether points are reserved or paid but cannot confirm completion on the poster's behalf.
- The three existing local acceptances from before points were enabled are not automatically funded or charged. Such requests explain that the poster must reopen, receive a fresh offer, and accept it before completion. No payment is inferred from earlier tests.
- On a failed action, the app reports uncertainty and asks for a refresh before retrying. Balances are loaded from the backend rather than optimistically increased. Account changes discard stale results and actions use the checked account's token.

### Backend contract

Migration `20260924235230_request_points.sql` is applied locally and matches local migration history.

| Table / function | Purpose |
| --- | --- |
| `points_wallets` | One private wallet per profile; nonnegative balance and reservation constraints |
| `points_ledger` | One welcome grant per profile and paired, unique request payment entries |
| `request_point_reservations` | Held, released, or settled points for one request offer round; readable by its participants |
| `get_my_points()` | Caller-only balance and latest 20 transactions from one consistent database snapshot |
| `decide_request_offer_for_round(p_offer_id, p_action, p_expected_round, p_expected_points)` | Validates the confirmed amount and reserves points on acceptance |
| `complete_my_request(p_request_id, p_expected_round)` | Poster-only, atomic, retry-safe completion and payment |

All new tables enable RLS and grant authenticated clients read access only. Mutations run through checked functions in the private schema; the unchecked offer core and starter-grant trigger are not client-callable. Acceptance locks the request before updating available funds. Completion locks participant wallets in a consistent order so reciprocal payments do not deadlock. There is no arbitrary points-grant RPC, quest claim, or quest administration UI.

### Validation

- All **359 SQL assertions** passed across six files, including **114 points assertions** and the earlier request/course/offer/reopening regressions.
- Points coverage includes one-time grants, private balances/history, insufficient funds, multiple reservations, release, legacy acceptance recovery, poster-only completion, stale rounds, stale/missing confirmation amounts, blocked legacy acceptance, rollback on event/ledger failure, retry safety, and recent-history ordering.
- **13 real concurrency races** passed: nine offer/reopening races and four new points races covering competing reservations, duplicate completion, completion versus reopening, and reciprocal payment. Temporary fixtures were removed.
- **28 typed service/API checks** passed through local Auth and PostgREST, including actual balance/reservation/completion calls, amount mismatch rejection, account/token guards, direct-write denial, and payment retry. Temporary accounts and requests were removed.
- ESLint, TypeScript, and Android Hermes export passed. Review identified the stale acceptance-amount issue; the guarded confirmation and regression tests resolve it.
- Local advisors report only the two pre-existing profile-policy performance warnings documented above; no new points warning was reported.
- The CLI-captured schema contained unrelated function drift and omitted explicit privilege restrictions and welcome-grant backfill. The generated migration was narrowed to the tested SQL, including the final amount guard.
- The exact final migration passed replay with all 114 points assertions inside a rollback-only transaction. Row counts and fingerprints for all nine existing Auth/profile/request/offer/points tables matched before and after; no existing local data changed.

Repeatable local checks (Docker/Supabase running, Node/npm/Python/psql available):

```powershell
npx supabase test db --local supabase/tests
node scripts/test-offers-local.cjs
node scripts/test-requests-local.cjs
python scripts/test-request-offers-concurrency.py
python scripts/test-request-points-concurrency.py
npm run check
```

The API script reads the local URL and publishable key from `.env.local` and refuses to run unless the URL is `http://127.0.0.1:54321`. It also needs `psql` on PATH. Race tests are fixed to the local development database and clean up their temporary fixtures.

### Checkpoint 4 phone checklist

Use the existing development APK and the **Phone setup** commands above. Reload Metro to load the updated source; no new APK is required. Keep USB and Docker running. Use local accounts A (poster) and B (helper), and start with a new future-dated request. Existing hosted Preview accounts and the standalone Preview app do not include this checkpoint.

1. **Welcome grant:** Open Profile as A and B. Each account should show 100 total/available, 0 reserved, and one +100 welcome entry if no points have been spent yet. Restart and sign out/in; the grant must not repeat. A newly created local account should also receive 100 once. If you have already made payments, record the current balances and compare the changes below instead.
2. **Reserve without payment:** While A has 100 available, create requests for 30 and 80 points. B offers on both. A accepts the 30-point request. Check the amount in the confirmation. A should have 100 total, 70 available, and 30 reserved; B should still have 100. Find the accepted request through My requests/My offers after restart.
3. **Cancel confirmation and release:** As A, open Confirm completion and choose Not yet. Nothing should change. Reopen the request and confirm a future deadline: A returns to 100 available/0 reserved and B is still unpaid. B explicitly offers again; A accepts the fresh offer and reserves 30 again.
4. **Insufficient funds:** While A has only 70 available, creating or editing a request to offer 71 must fail, highlight the points field, and retain the form values. Offering exactly 70 is allowed. Try accepting B on the earlier 80-point request from step 2: this must also fail, leaving that request Open, B's offer Pending, and the original 30-point reservation unchanged.
5. **Confirm and pay once:** B must not have the poster's Confirm completion control. As A, confirm the completed 30-point request. A should have 70 total/available and 0 reserved; B should have 130 total/available. Each account has one corresponding -30/+30 payment entry. Refresh, restart, and revisit the request: it remains Completed, no further payment occurs, and reopening is unavailable.
6. **Offline completion recovery:** On a separate small accepted request, keep Metro/USB connected and remove only database forwarding with `adb reverse --remove tcp:54321`. Try confirming completion and check the error/refresh state. Restore `adb reverse tcp:54321 tcp:54321`, refresh completion and Profile first, then retry only if it is still accepted and unpaid. There must be one final payment, never two. Turning off Wi-Fi alone does not disconnect the USB-forwarded local database.
7. **Old acceptances and layout:** Open a request accepted before this checkpoint. It should explain that it needs reopening and fresh acceptance before payment; no Confirm completion button should charge it immediately. Check button spacing, long text, balance/history layout, and account switching. Home should greet each account by its own saved profile name, update after a profile-name edit, and keep long names clear of the View points button. Home's View points link should open the current account's real wallet.

### Posting balance-limit correction (2026-09-25, America/Vancouver)

Phone testing identified an account with 110 points being allowed to post a 111-point request. The original checkpoint checked affordability at acceptance only. Creating and editing now also require the requested amount to fit the caller's **available** points (`balance - reserved`). Exactly the available amount is allowed. Posting still does not reserve funds, so acceptance must also recheck the balance.

- The typed request service loads the current wallet on every save. An unaffordable amount returns a clear error and highlights the points field while retaining all form values. Saves pin the checked session token and reject stale success after an account change.
- The backend enforces the same rule even if the client validation is bypassed. Edits lock the owned request first; both new posts and edits then lock the caller's wallet and validate its latest available balance before changing any rows. Existing lifecycle, category, ownership, and field checks remain enforced.
- Migration `20260925085239_limit_request_points_to_balance.sql` is applied locally. Existing balances and requests were preserved; an already-posted unaffordable request can be edited down, and accepting it still requires enough funds. Hosted environments remain unchanged.
- All **388 SQL assertions** passed, including 29 new posting-limit checks covering 110 versus 111, all request categories, exact limits, edits and unchanged details after failures, reservations, own-account balances, zero available points, and acceptance rechecks.
- **22 request API checks** and **28 offer/points API checks** passed. All five points concurrency cases passed, including a new case where posting and editing wait while an acceptance reduces the same wallet's available balance; both saves reject the now-unaffordable amount.
- ESLint, TypeScript, and Android Hermes export passed. The exact saved migration passed replay with all 29 new assertions in a rollback-only transaction, with matching fingerprints for 13 data tables afterward. Advisors reported only the two pre-existing profile-policy warnings.
- The CLI captured unrelated pre-existing function drift, so the generated file was narrowed to the tested save-function change and its grants. Local migration history matches. The CLI's existing telemetry shutdown timeout occurred after successful database operations; replay and migration history were verified independently.

**Phone retest:** Reload the development app. With 110 **available** points, posting 111 must show an error without creating a request; changing it to 110 should save. Editing a request to 111 must also fail and retain the form. If 30 points are reserved, the maximum is 80. No new APK is required. The full checklist above has been updated so the insufficient-funds acceptance test creates its second request before the first reservation.

### Helper reward-consent correction (2026-09-25, America/Vancouver)

Phone testing found that a poster could change the points after a helper offered and then accept that earlier offer. The helper had never agreed to the new amount. Migration `20260925165806_require_helper_reward_consent.sql` and the updated app now require explicit confirmation of the current reward.

- Changing points on an open request advances its offer round and closes every pending offer in the same transaction. A decrease, increase, or change back to an earlier amount all require fresh consent. Saving without changing points preserves existing offers. Accepted and completed requests remain non-editable.
- Helpers see **Confirmation needed**, the current reward, and a new offer confirmation prompt. The poster cannot accept an old offer; that helper must confirm again first. History is retained, and other helpers remain unconfirmed when one helper confirms.
- `create_my_request_offer_for_terms(p_request_id, p_expected_round, p_expected_points, p_message)` and `renew_my_request_offer_for_terms(p_offer_id, p_expected_round, p_expected_points, p_message)` verify the exact displayed terms under the parent request lock. Missing or stale terms fail even on duplicate/retry paths. Old unchecked helper RPCs can no longer write through their private cores; reload old development clients.
- `get_request_offer_page_v3` returns offer state, request round, and `request_points` together. Renewal and acceptance use that same row's amount in both the confirmation and request. A reward edit while a confirmation dialog is open cannot silently change the agreed amount.
- The migration requires fresh confirmation once for existing open pending offers, whose original agreed amounts were not recorded. It locks and rechecks each parent before retiring those offers. One existing local open request needed this transition. It does not change accepted/completed work, wallets, reservations, or payment entries.
- A stale reopen retry must also match the saved deadline before returning success; a reward edit must not make an unapplied deadline change look successful.
- The correction is applied locally only. Mutual ratings, quests, hosted deployment, and a new Preview APK remain later checkpoints.

Validation:

- All **442 SQL assertions** passed across eight files, including 50 new reward-consent checks. Coverage includes decreases, increases, returning to the original amount, multiple helpers, missing/stale confirmation terms, unchanged-price edits, private/legacy bypass denial, account permissions, and rollback on history failure.
- **36 offer/points API checks** and **22 request API checks** passed against local Auth/PostgREST. The new API flow verifies 30 → 20 invalidation, blocked old acceptance, helper confirmation, a 20-point reservation, and exactly one 20-point payment.
- All **17 concurrency cases** passed: 12 offer/reopening races and five points races. The three new races overlap reward edits with first offers, acceptance, and renewed offers; either the old action fails or its consent is retired, and accepted work cannot be edited to a different reward. All temporary fixtures were removed.
- ESLint, TypeScript, and Android Hermes export passed. Independent SQL review found no remaining consent bypass; advisors reported only the two existing profile-policy performance warnings.
- The exact captured migration passed rollback-only replay with all 50 new assertions and eight legacy-data preservation checks. Accepted, completed, and terminal-only fixtures stayed unchanged; only the intended pending offers were retired. All 13 existing data-table fingerprints matched afterward.
- The captured schema diff included unrelated pre-existing course-function changes and omitted the one-time data transition. The final migration contains only the reviewed consent SQL, explicit grants/revokes, and the tested transition. Local migration history matches `20260925165806`; the CLI's existing telemetry shutdown timeout occurred after successful capture/history operations.

### Reward-consent phone retest

Reload the existing development app, with Metro, USB forwarding, and local Supabase available. Use accounts A (poster) and B (helper); choose amounts within A's available balance.

1. A posts a future-dated request for **30 points**. B offers and confirms 30.
2. A edits the reward to **20 points**. Refresh offers: B's earlier offer must show **Confirmation needed**, and A must not be able to accept it.
3. B opens My offers or the request, reviews the displayed 20 points, and confirms a new offer. Cancelling the prompt must leave the old offer unconfirmed. After confirmation, A can accept and reserves exactly 20.
4. A confirms completion. Exactly 20 transfers from A to B once, including after refresh/restart.
5. On a separate open request, repeat with an increase and with **30 → 20 → 30**. An old offer must never become acceptable merely because the price returns to 30. If two helpers offered, each must confirm separately.
6. Save an edit that leaves points unchanged: its pending offers should remain valid. For a stale-screen test using two devices if available, leave B's confirmation open, change the reward as A, then confirm as B. It must fail and require refreshing/reviewing the new amount.

### Three active requests per poster (2026-09-25, America/Vancouver)

The user requested a maximum of three active posts while phone testing is deferred. Migration `20260926000632_limit_active_requests.sql` is applied locally; it contains no request cancellation or balance changes.

- The cap applies across all four categories to requests **posted** by the account. Open requests count while their deadline is in the future. Accepted requests count even after the original deadline because the selected work still needs completion. Completed, cancelled, expired, and elapsed open requests free a slot; offering help on another person's request consumes no posting slot.
- The database rejects a fourth active post with `P0004`. The form explains the cap and retains all entered values after rejection. Ordinary edits at the cap remain allowed. Reopening accepted work keeps its existing slot.
- The `requests_active_limit_guard` trigger protects creation and every owner/status/deadline change that would activate a request. It locks the owner's wallet, evaluates expiry after any wait, and counts up to three other active requests. The partial owner/status/deadline index keeps this lookup limited to relevant rows. Direct client writes remain denied.
- Removing a slot does not acquire another wallet lock. This preserves the batch-expiry reader's lock order. Posting and active transitions use the existing parent-then-wallet order; the count does not lock other request rows.
- Existing over-limit accounts retain their requests, offer history, reservations, and payments. They may edit, accept, reopen, complete, or cancel existing active work; new posts remain blocked until fewer than three active requests remain. No automatic cancellation occurs.
- Older regression suites that need simultaneous historical fixtures now explicitly construct those grandfathered fixtures before enabling the guard for assertions. Other fixtures close completed test scenarios or create requests as slots become available. The production guard stays enabled.

Validation:

- All **490 SQL assertions** passed across nine files: 443 existing regressions and 47 new active-limit checks. The new coverage includes all categories sharing the cap, account isolation, edits at the cap, accepted work, slot release, failed-save rollback, grandfathered accounts, and direct-write denial.
- **25 request API checks** and **36 offer/points API checks** passed, including rejection of the fourth post, retained draft data, and cancellation freeing a slot without removing history.
- All **23 concurrency cases** passed: the earlier 12 offer and five points races, plus six active-limit cases. Four simultaneous first posts yield exactly three successes; two posts competing for the final slot yield one winner. Stale edit/reopen/accept actions cannot reactivate a fourth request after expiry and replacement. Batch expiry completes while both owners' wallets are locked. Temporary fixtures were removed.
- Lint, TypeScript, and Android export passed. Advisors reported only the two previously documented profile-policy performance warnings. Independent lock-order review informed the terminal-state early return to avoid adding a wallet lock to batch expiry.
- Exact migration replay passed all 47 new assertions inside a rollback-only transaction. Fingerprints for 13 existing data tables matched afterward. The captured diff was narrowed to the reviewed trigger, index, and privilege restrictions; local migration history matches `20260926000632`.

Re-run the new concurrency coverage with `python scripts/test-request-active-limit-concurrency.py` against the local database. Phone validation remains deferred; no hosted deployment or new APK is included.

### Active-request limit phone checklist

Deferred until the phone is available, together with the reward-consent retest above. Reload the existing development app; no new APK is required.

1. With fewer than three active posts, create requests until the account has three, using different categories. A fourth must show the limit message and keep the draft values.
2. Edit one of those requests without adding a new post. It must save normally. Cancel one, then retry the retained draft: it should save, and cancelled history should remain available.
3. Accept a helper on an active request. It still counts toward the cap. Poster-confirmed completion frees that slot; reopening accepted work alone does not.
4. An open request whose deadline has passed should not block a replacement. Completed and cancelled history should not count either.
5. A second account has its own three-post allowance. Offering help on somebody else's request must not reduce that allowance.
6. If an account already has more than three active requests, verify they remain visible and editable. New posting becomes available only after closing enough to leave fewer than three.

### Accepted cancellation and request archiving (2026-09-25, America/Vancouver)

Phone testing exposed two missing owner actions: accepted requests had no direct cancellation control, and expired requests could not be removed from the main My requests list.

- Owners can now cancel open or accepted work. Cancelling accepted work releases its reserved points once, closes the selected offer, and frees a posting slot. It does not pay the helper. Completed work must use Confirm completion instead; a completed request cannot be cancelled.
- The cancellation confirmation pins both the offer round and the displayed status. A stale open-request dialog cannot cancel a newly accepted arrangement, and a stale round cannot cancel reopened work. Account-scoped service calls pin the checked session token.
- Owners can archive expired, cancelled, or completed requests. Elapsed open requests are settled as expired when archived. Active work cannot be archived. The action changes only the owner's list placement; requests, offers, payment records, and helper history are retained.
- My requests has Unarchived and Archived lists. Each list applies its archive/category filter before pagination in a single owner query. Restore returns a closed request to the main list without reopening it or consuming a posting slot. Archive state is stored in the database and survives app restarts.
- The existing open-only cancellation RPC remains available for older clients. The new app uses `cancel_my_request_for_round` and `set_my_request_archived`; direct client writes remain denied.
- Migration `20260926064611_cancel_and_archive_requests.sql` is applied locally. The captured diff was narrowed to the reviewed cancellation/archive changes and explicit grants, excluding unrelated pre-existing function differences. Exact migration replay passed all 87 new assertions inside a rollback-only transaction; fingerprints for 12 existing data tables were unchanged after application, tests, and replay.
- Local validation includes 87 new SQL assertions and all 490 earlier SQL regressions, 78 typed request/offer API checks, four overlapping cancellation races, lint/typecheck, and Android Hermes export. The new tests cover ownership, stale confirmations, malformed reservations, rollback on audit failure, history preservation, and archive pagination. Advisors reported only the two existing profile-policy performance warnings.

#### Cancellation and archive phone checklist

Reload the existing development app with local Supabase running; no new APK is needed.

1. Open an accepted request you posted. Cancel Request should be visible. Choose Keep request first: status and balances must stay unchanged.
2. Cancel an accepted request whose work is not being completed. It should become Cancelled, reserved points should return to your available balance, and the helper should receive no payment. Reload and verify the release does not repeat. The helper should see the cancellation in My offers.
3. If you previously had three active posts, create another after cancelling one. The freed slot should permit it, provided the points offer fits your available balance.
4. Open an expired request and choose Archive Request. It should disappear from My requests → Unarchived and appear under Archived, including after restart. Repeat for a cancelled or completed request; completed payment history must stay unchanged.
5. Open the archived request and choose Restore Request. It should return to Unarchived with its original closed status. It must not return to the campus feed or use an active slot.
6. Switch accounts: another user's requests must not expose cancellation or archive controls. Active open/accepted work must have no Archive action. If a connection failure occurs during an action, reconnect and refresh before retrying.

**Focused phone retest passed (September 25, 2026):** The user confirmed all three tests supplied with commit `70ccd47`: cancelling an accepted request returns reserved points and permits another post, archiving an expired request persists after restart, and restoring it preserves its expired status. This completes the cancellation/archive fix checkpoint. This confirmation does not mark every case in the broader checklist or earlier checkpoint 4 checklists as passed.

These changes are local only. Hosted deployment and a new Preview APK remain pending.

### Next checkpoints

The cancellation/archive phone checkpoint has passed. Next, implement mutual ratings for completed requests, restricted to the poster and selected helper with duplicate-rating protection. Creator-managed miniature quests and controlled points rewards are later work. Confirm any remaining checkpoint 4 phone cases before hosted validation. Hosted deployment, a new Preview APK, Preview validation, CI, review, merge, and documentation closure remain before Task 9 is complete.
