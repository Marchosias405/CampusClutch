# Task 10 — Conversations and Messages

**Current status:** Checkpoint 2 is in local phone validation on `codex/persist-messages`, based on `main` at `0ae8af1`. On September 27, the user confirmed that amended phone tests 1–4 pass, including the bottom-tab unread badge, contact before offering/acceptance, and the direct Message button on classmate cards. Tests 5–8 remain unconfirmed. Task 10 is not complete. Hosted Development and Preview remain on Task 9. Development build `872b050f` replaces the unavailable older development APK; the follow-up needs no further native rebuild.

## Checkpoint 1: direct-messaging foundation

At the start of Task 10, the inbox stored five example conversations in the screen file. The thread appended messages to React state, used sample timestamps, and lost messages after reopening. Real UUID student messaging was disabled, and compose pointed to `/messages/new` without a dedicated route. Checkpoint 2 replaces that prototype flow.

### Scope

- Persistent direct conversations, with exactly one conversation per normalized pair of users.
- Membership-controlled message history and inbox summaries.
- Idempotent text sending with a client-generated UUID retained for retries.
- Per-conversation message sequences and cursor pagination.
- Private, monotonic read state and unread counts that exclude the caller's own messages.
- Authorized request links for each accepted assignment round, including earlier completed/cancelled rounds.
- A typed client that pins the authenticated session for each call and rejects results after account changes.

Checkpoint 1 covered the backend/API; checkpoint 2 connects the app screens. Group creation and invitations, realtime updates, hosted deployment and a new APK are later checkpoints. No push notifications, peer read receipts, attachments, message editing/deletion, typing indicators, or presence are introduced here.

### Direct conversations and privacy

Starting a new ordinary direct conversation requires a completed caller profile and a completed, discoverable other profile. Self-conversations are rejected. Reversed or concurrent creation returns the same conversation. An existing authorized conversation remains available if a participant later disables discoverability.

Conversation summaries expose only the other participant's ID and display name. They do not grant general access to private profiles, interests, social links or avatar files. Initials can be used when the existing avatar policy does not authorize an image.

Members can read the conversation and its messages. Their private membership state is readable only by that member; a peer cannot inspect the read cursor and infer read receipts. Clients cannot insert members, impersonate senders, change conversation status or modify stored messages directly.

The current default keeps a conversation available to its original two participants after their request ends. If a later product decision restricts assignment-specific messaging, it must not close a shared direct conversation that supports another request between the same pair.

### Request assignment links

The architecture plan's original request-only link is refined to **`(request_id, offer_round)`** because Task 9 introduced reopening and replacement helpers. Participant identity comes from the immutable points reservation for that accepted round.

- A poster and accepted helper can lazily open or create their conversation for that round.
- Pending/rejected helpers and unrelated users cannot open it.
- If A/B's assignment ends and C becomes the helper, A/C's conversation is separate. C never joins A/B's conversation or reads its messages.
- Different assignments involving A/B reuse the same direct conversation, with separate round links.
- Cancellation, completion and owner archiving do not erase the original participants' link.
- Legacy acceptances without a points reservation require reopening and a fresh acceptance, matching Task 9's payment requirement. The API does not reconstruct historical participants from a mutable current offer.

This checkpoint creates links on an authorized open operation rather than rewriting Task 9's acceptance/payment functions. The UI integration will call that operation from the appropriate assignment action.

### Stored records

- `conversations`: direct type, trusted creator, status, server timestamps and latest sequence.
- `conversation_members`: exact participant membership plus the caller's private read state.
- `direct_conversation_pairs`: canonical ordered user pair with a uniqueness constraint.
- `messages`: server ID/sender/sequence/time, immutable body and retry UUID.
- `request_conversations`: immutable request-round link and original participant IDs.

RLS and explicit grants protect all exposed tables. Public RPCs use invoker wrappers over private functions that authorize the actual caller, with fixed empty search paths. No user-editable JWT metadata determines membership.

### API contract

| RPC | Purpose |
|---|---|
| `start_direct_conversation` | Open or atomically create a permitted direct pair |
| `open_request_conversation` | Open the original participants' request-round conversation |
| `get_conversation_summary` | Load one authorized conversation and the caller's unread state |
| `get_my_conversations` | Load inbox pages ordered by activity and ID |
| `get_conversation_messages` | Load message history, newest first, before a sequence cursor |
| `send_conversation_message` | Send once or recover the result of the same retry |
| `mark_conversation_read` | Advance only the caller's read cursor |
| `get_my_unread_message_count` | Count incoming unread messages across all of the caller's non-removed conversations |
| `get_request_contact` | Read limited identity in an authorized request context without creating a chat |
| `start_request_contact_conversation` | Open the same direct pair before an offer or acceptance, when request-contact eligibility permits |

The TypeScript boundary lives in `src/lib/messages.ts`, with shared types in `src/types/messaging.ts`. Bigint sequences remain decimal strings across the wire and in TypeScript, including values above JavaScript's safe integer limit.

Messages contain 1–4,000 characters after trimming. Page sizes are bounded to 1–50. A full page may be followed by an empty page; the client exposes that possibility through its pagination contract.

Sending locks the conversation before assigning a sequence, so a later message cannot commit ahead of an earlier allocated sequence. Read advancement uses the same lock, never moves backwards and rejects a future cursor. Sending does not implicitly mark earlier messages read.

A retry uses the same sender, client message UUID, destination and normalized body. A conflicting body or destination is rejected; it never edits a previous message. Failed or ambiguous UI sends must retain the exact draft submission and UUID until the caller resolves or retries it.

Inbox cursors use the activity timestamp plus conversation ID. Activity can change while pages are loaded; the UI must deduplicate by conversation ID and refresh the first page instead of treating the inbox as a frozen snapshot.

### Validation

Validated locally on September 26, 2026:

- All **942 SQL assertions across 13 files** passed, including **172 messaging assertions** and the existing Task 9 regressions.
- **10 deterministic concurrency cases** passed for pair creation, send idempotency, sequence ordering and read advancement.
- **21 integration checks** passed using the actual typed client against local Supabase Auth/PostgREST, including persistence across recreated clients, outsider denial, request acceptance/cancellation and retained original participants.
- **15 client contract test groups** passed for validation, account changes, response projection, cursor precision and safe errors. This suite is added to the CI workflow; remote CI will run when the feature PR is opened.
- Lint/typecheck and all **nine offer-action lifecycle checks** passed.
- Independent database and client reviews found no blocking issue.
- All **20 pre-existing application-table fingerprints** stayed unchanged. Temporary test users, requests and conversations were removed; no existing user data was reset.
- Local database advisors found no Task 10 issue. The two existing multiple-permissive-SELECT-policy warnings on profiles and social links remain outside this checkpoint.

Migration `20260926182818_persist_direct_messages.sql` was captured with the Supabase CLI after local schema iteration. The generated diff included unrelated existing function drift and omitted explicit privilege revocations, so the saved migration was narrowed to the exact reviewed messaging DDL and grants. It then recreated the messaging schema in a rollback-only transaction and passed all 172 messaging assertions again. All 19 migration versions match local history.

Repeatable commands from the repository root:

```powershell
npm run check
npm run test:offers-lifecycle
npm run test:messages-client
npm run test:messages-ui
npx supabase test db --local
python scripts/test-messages-concurrency.py
npm run test:messages-local
```

The database/API checks require the running local Supabase stack with repository migrations applied. The concurrency and API scripts also require `psql` on PATH; the API script requires `.env.local` to point exactly to `http://127.0.0.1:54321` with its local publishable/anon key. These scripts refuse hosted API use or hardcode local database access and clean up only their isolated fixtures. Checkpoint 1 had no phone gate; checkpoint 2 requires the phone checks below.

## Checkpoint 2: app integration

This checkpoint connects the existing red/white inbox and thread screens to the validated direct-message API. It remains local development work; hosted Development, hosted Preview and the standalone Preview APK are unchanged.

The inbox has All and Unread views, search over loaded conversations, cursor pagination, pull-to-refresh and a Refresh button. It reloads when focused or when the app returns to the foreground. The compose action opens Courses so the user can choose a course, view classmates and message a real student profile. The earlier sample course/delivery/group conversation filters are removed until those features have real backing data.

Student profiles open the server-authorized conversation UUID. Sample profiles do not create real chats. Request details list the caller's own accepted assignments, including older completed and cancelled rounds, with Message helper or Message poster actions. A replacement helper cannot open an earlier helper's conversation. Existing direct conversations remain available in Messages after their assignment ends.

Thread sending retains the exact body and retry UUID after an uncertain response, with drafts scoped to the backend, signed-in account and conversation. Account/route changes must not carry draft content or asynchronous navigation into another account. Read state advances only while the thread is focused and in the foreground, using messages observed in the thread. This stage uses explicit refresh and focus/foreground refresh; realtime arrival while staying on the same screen is a later checkpoint.

### Checkpoint 2 automated validation

- **50 new regression groups passed:** 12 inbox controller, 15 thread controller, 15 actual entry-component lifecycle and eight assignment-history client groups. They run through `npm run test:messages-ui` and are added to the CI workflow.
- All **15 existing messaging client groups** and **nine offer-action lifecycle checks** passed again.
- The actual local API suite now passes **23 checks**, including original assignment history, round pagination, private participant scope and replacement-helper chat isolation.
- Full lint/typecheck passed. Android export produced an embedded Hermes bundle successfully; no native dependency changes were required.
- Independent reviews found no remaining blocker. Review corrected stale draft hydration after refocus, missing history after an own send overtook unseen replies, queued/read retry behavior, tall-message visibility and Android empty-list inversion.
- No new schema migration or hosted change was made. The previous checkpoint's 942 SQL assertions and 10 database concurrency cases cover the unchanged persistence layer.
- All 20 pre-existing application-table fingerprints still matched after the expanded API suite, and its temporary messaging fixtures were removed.

These automated checks exercise the real controllers, client and entry components with controlled asynchronous events; they do not substitute for native keyboard, scrolling or long-message rendering on a phone.

### Local phone setup

Use the CampusClutch [development build `872b050f`](https://expo.dev/accounts/marchosias405/projects/CampusClutch/builds/872b050f-3144-4e0a-bb1f-d9efdc788418) with the phone connected by USB and Docker Desktop running. It was rebuilt on September 27 because the older `3082844b` artifact was no longer available. Install this development APK if the standalone Preview APK is currently installed. Its native crypto support is already included; these fixes add no native dependencies. The standalone Preview APK will continue showing the previous release until a later hosted deployment/build checkpoint. Use the build page to download; signed artifact URLs expire.

```powershell
Set-Location D:\Projects\CampusClutch
adb devices
adb reverse tcp:8081 tcp:8081
adb reverse tcp:54321 tcp:54321
npx expo start --dev-client --localhost
```

`adb devices` should list the phone as `device`. Open the development build and connect to `http://localhost:8081`. Keep Metro running during these tests. Local accounts are separate from hosted Preview accounts.

For a reliable local offline test, leave USB and Metro running and use a second terminal to stop only the API gateway:

```powershell
docker stop supabase_kong_CampusClutch
# Perform the offline refresh/send check in the already loaded app.
docker start supabase_kong_CampusClutch
```

This leaves the database and its data intact. Restore the gateway before closing/reopening the app, since the app needs the backend to reload the signed-in profile. Turning off Wi-Fi alone does not interrupt backend access while the USB tunnel is active.

### Checkpoint 2 phone checklist

Use two local accounts, A and B, with completed profiles. For the classmate entry point, both should be discoverable and enrolled in the same current course. A third account C is useful for the replacement-helper check.

1. **Start a direct chat:** As A, open Courses → a current course's classmates → Message on B's card. It must open B's DM directly. View Profile must still open B's profile; its Message action must reach the same conversation. Send a distinctive message. The Messages tab should show B's actual name and message preview, with no sample chats.
2. **Reply and persist:** Sign in as B, refresh Messages, open A's conversation and reply. Return to A, refresh and verify the reply. Close/reopen the app and confirm both messages and their timestamps remain. Use Refresh when waiting on the same screen.
3. **Unread state:** Send a new message from A while B is elsewhere in the app. On B, change tabs or wait up to 30 seconds while online; the Messages bottom tab should show the total unread count. Refresh Messages and confirm its individual conversation count and Unread filter agree. Open the conversation, view the new message, return to Messages and confirm both counts clear. A's own sends should not add to A's unread count. Switch accounts and confirm the previous account's badge disappears immediately.
4. **Request contact and accepted chat:** Before B offers help on A's open request, open its details as B. A's name/basic identity and Message poster must be visible and allow a chat. As A, receive/reply through Messages. After B offers, A should see B's identity and Message helper in that pending offer before accepting. After acceptance, Message helper / Message poster under Assignment chats must reach the same direct conversation. An unselected helper still cannot access someone else's assignment link or messages. Repeat with a poster hidden from profile discovery: request contact works, without exposing private full-profile fields.
5. **Historical participants:** Have B cancel an accepted assignment. Its chat should remain available to A/B. After reopening and accepting C, the new assignment should open A/C's separate conversation. C must not see the earlier A/B messages. Existing same-pair assignments may share a direct conversation.
6. **Failed-send retry:** Open a loaded conversation, stop the API gateway using the commands above, then send a distinctive message. Confirm its text remains and a retry is offered. Navigate away and back, then restore the gateway and close/reopen the app. Retry the retained submission if it is still pending, and confirm the recipient receives exactly one copy. An already saved message can reconcile automatically without another send. Use the explicit discard action only when intentionally abandoning an uncertain submission; it may already exist on the server.
7. **Account isolation and ordinary drafts:** Type without sending, leave and reopen the chat, and confirm the draft remains. Switch to the other account and confirm that draft is absent there. Return to the original account and verify its draft. Switch screens during refresh/sending and confirm no delayed response opens or changes a different account's chat.
8. **History and layout:** Exchange more than 30 messages, load older history, then refresh. Confirm the history remains reachable without duplicate bubbles. Test a multiline message and a message long enough to fill more than one screen; viewing it should update unread status. A draft over 4,000 characters should stay editable with a clear length error when sent. The keyboard, send control, timestamps and navigation bar should stay usable. In Messages, verify search, All/Unread and empty states.

The user confirmed that amended tests 1–4 pass, including the three entry and badge fixes below. Tests 5–8 remain for the next session. Group conversations, invitations, realtime subscriptions, hosted rollout and a new Preview build remain later checkpoints.

### September 27 follow-up: contact and unread badge

- The bottom Messages tab now shows the total incoming unread messages across the full inbox, including conversations outside loaded pages. Counts update after reading, inbox refresh, navigation, foreground return and every 30 seconds while the app is active. Offline failures keep the last known count; switching accounts immediately uses a fresh store. Incoming thread bubbles still require Refresh until the realtime checkpoint.
- An eligible viewer can inspect a live request's poster and contact them before offering. The poster can reply through Messages and contact helpers from pending offers. Accepted/historical participants retain their authorized contact path. The projection contains only name, major, year and campus; it does not change global hidden-profile discovery or expose private profile fields.
- Request introductions reuse the existing private direct pair. Viewing the contact does not create a conversation, offer or assignment. A new introduction is checked again on the server; unrelated users cannot name arbitrary hidden profiles as contacts, and replacement helpers never inherit another pair's chat.
- Classmate cards have separate View Profile and Message buttons. Message directly opens the authorized conversation UUID, with retry and navigation/account/background guards.
- Migration `20260927075447_request_contacts_and_unread_total.sql` is local only. Existing assignment links and Task 9 request/offer/payment behavior are preserved.

Follow-up validation completed locally:

- All **994 SQL assertions across 14 files** passed, including 52 new contact/unread assertions. The new functions replay successfully from the captured migration; local migration history and explicit execution privileges match the reviewed source.
- **27 actual typed-client Auth/PostgREST checks** passed. All **25 public-table data fingerprints** remained unchanged after temporary fixture cleanup.
- **26 messaging/contact client groups**, **98 messaging UI/controller/lifecycle groups**, and **nine offer-action lifecycle checks** passed. The CI commands include the new regression scripts; remote CI has not run for this local follow-up.
- Full lint/typecheck and Android Hermes bundle export passed. No native dependency change is required.
- Independent authorization review found no blocker. Security advisors returned no findings; the two existing permissive-policy performance notices on profile tables remain unchanged.
- UI review fixed stuck chat-opening buttons after navigation/backgrounding, prevented stale-profile badge activation after account changes, and synchronized inbox rows when the total unread count changes.

No hosted deployment or additional APK is part of this follow-up. Phone tests 5–8 remain the next gate.

## Remaining integration and release work

1. Complete checkpoint 2 phone validation and resolve any failures.
2. Define group membership/invitation consent and history visibility, then implement that checkpoint.
3. Add authorized realtime updates and validate reconnect/account-switch behavior.
4. Deploy and validate hosted Development/Preview, build and test a standalone APK, and complete final review, CI, merge and documentation closure.

Group membership/invitation consent and history visibility must be settled before the group checkpoint. Hosted rollout, standalone Preview testing, final review, CI and merge follow completed feature checkpoints.

## References checked for this implementation

- [Supabase changelog](https://supabase.com/changelog): reviewed before implementation; no extension or version change is part of this checkpoint.
- [Row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security): explicit grants, member predicates and authorization tests.
- [Database functions](https://supabase.com/docs/guides/database/functions): invoker defaults, fixed search paths and restricted execution.
