# Task 10 — Conversations and Messages

**Current status:** Checkpoint 5 implements direct-message realtime locally on `codex/persist-messages`. Checkpoint 2 phone tests 1–8 passed; the new realtime checklist below is pending. On October 22, the user deferred group conversations: checkpoints 3–4 remain historical implementation records, but group navigation and server access are now disabled without deleting group data. Group phone testing is no longer a gate for this release. Hosted Development/Preview remain on Task 9, development build `872b050f` remains the local test client, and no new standalone APK was built.

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
npm run test:messages-concurrency
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

The user confirmed all amended tests 1–8 pass by October 9. This covers the three entry and badge fixes below, historical assignment isolation, durable failed-send recovery without duplication, account-scoped ordinary drafts, stale-operation suppression, history pagination, long-message rendering, length validation, keyboard/navigation usability, filters and empty states. Group conversations, invitations, realtime subscriptions, hosted rollout and a new Preview build remain later checkpoints.

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

No hosted deployment or additional APK is part of this follow-up.

### October 9 phone completion and message-layout correction

- The user confirmed all checkpoint 2 phone tests 1–8 pass. Failed submissions remain available across navigation/reload and reconcile to exactly one server message; ordinary drafts stay isolated by backend, account and conversation.
- History above 30 messages remains reachable through older-page loading and refresh without duplicate bubbles. Multiline and more-than-one-screen messages, the 4,000-character boundary, keyboard/send controls, timestamps, navigation, search, All/Unread and empty states passed on Android.
- The final layout run exposed one Android race: after a successful send, `maintainVisibleContentPosition` restored the formerly newest bubble after the screen's early scroll, leaving the new bubble just below the viewport. The thread now records the new row during the layout commit and scrolls only after FlatList reports the updated content size. A local outgoing message always reveals itself; an incoming message follows only when the reader was already at the bottom; loading older history keeps the current position.
- Six production-screen layout regressions now cover initial history, outgoing-at-bottom, outgoing-while-reading-older, incoming-at-bottom, incoming-while-reading-older with the jump action, and older pagination. The complete messaging UI command passes **104 groups**; all **26 messaging/contact client groups**, lint/typecheck and an Android Hermes export also pass. The previous screen implementation fails the new device-ordering regression, confirming that it detects the reported race.
- Independent review found no remaining thread lifecycle, stale-reference, pagination, retry, TypeScript or React Native blocker. No database or native dependency changed.

Checkpoint 2 is complete locally. No hosted deployment or additional APK is part of this correction.

## Checkpoint 3: group-conversation backend and typed API

This checkpoint implements the group membership, invitation-consent and history-visibility contract locally. It extends the existing message engine instead of creating a second message store. Direct-message behavior and the completed checkpoint 2 phone flows remain compatible.

### Product and membership rules

- Groups are private, invite-only and scoped to one current course. The creator and every invitee must have a completed profile and be currently enrolled in that course when the invitation is created; eligibility is checked again when an invitation is accepted.
- Creation requires a title of 1–80 characters and 1–19 unique invitees. The creator starts as the only active owner, while every selected classmate starts with a pending invitation and no message access.
- A group can have at most 20 active and pending people combined, including the owner. Pending invitees see only the invitation preview needed to decide: group title, course, inviter and active-member count. They cannot read the roster, conversation summary, messages or unread state.
- Invitations require an explicit accept or decline. Invitations can be revoked, and a former member can return only through a new invitation and acceptance.
- Active roles are owner, administrator and member. There is exactly one active owner. Owners and administrators can invite people, revoke pending invitations and rename the group. Administrators can remove ordinary members. Only the owner can change roles or transfer ownership, and the owner must transfer ownership before leaving.
- Accepted membership is not revoked automatically if the member later leaves the course or the term changes. That preserves an existing group's continuity and history. New invitations, invitation acceptance and rejoining still require current course enrollment and a completed profile.
- There is no automatic invitation expiry in this checkpoint. Public rooms, group avatars, notifications, mute/archive controls, blocking/reporting and system messages remain outside this stage.

### Privacy and history boundaries

`group_conversations` stores private course/title metadata, `group_conversation_invitations` stores consent, and `group_membership_periods` records the exact message-sequence interval visible during each accepted membership. `conversation_members` now records role, active/left/removed state and the membership end time. Existing and future direct members receive a permanent visibility period so the generalized message functions preserve direct-message behavior.

An accepted member can send and read new messages while an active membership period is open. Leaving or removal closes that period at the current sequence and disables sending. A former member retains read-only access only to messages from their accepted membership period; they cannot see later messages. If they rejoin, a fresh period begins and messages from the absence gap remain hidden. A pending, declined or revoked invite never grants membership or history.

The new implementation tables are RPC-only, with RLS enabled and raw table privileges revoked. Public invoker wrappers call private authorization functions using the authenticated profile, fixed search paths and database locks for membership, ownership, invitation and message-sequence races. One deferred database constraint enforces exactly one active owner after each transaction.

Group-management reads use one atomic snapshot containing the title, monotonic management revision, active roster with membership-period numbers and pending invitations. Manager mutations carry the exact revision from that snapshot; leave/removal also carry the relevant membership period. Every invitation, membership, role, owner or title transition advances the revision exactly once. Delayed commands from an older snapshot fail instead of overwriting a newer decision, while exact immediate retries and client-ID retries reconcile without advancing it again. Each closed membership period records whether it ended by leaving or removal, so an old leave cannot close a later rejoin.

### Group API contract

| RPC | Purpose |
|---|---|
| `create_group_conversation` | Idempotently create a course group and its initial pending invitations |
| `get_my_group_invitations` | Load the caller's pending invitation previews; retained for compatibility |
| `get_my_group_invitations_page` | Page every pending invitation with an exact timestamp/UUID cursor |
| `get_my_former_group_conversations` | Rediscover privacy-masked former-group summaries with an exact activity/UUID cursor |
| `respond_to_group_invitation` | Explicitly accept or decline an invitation |
| `invite_group_member` | Invite one currently eligible classmate with a retry UUID |
| `revoke_group_invitation` | Revoke one pending invitation |
| `get_group_members` | Load the roster for an active member |
| `get_group_pending_invitations` | Load pending invitations for an authorized manager |
| `get_group_management_snapshot` | Atomically load a manager's title, revision, roster periods and pending invitations |
| `leave_group_conversation` | Close the caller's membership period; owners must transfer first |
| `remove_group_member` | Close another member's period under the role rules |
| `set_group_member_role` | Promote or demote an active non-owner member |
| `transfer_group_ownership` | Atomically move the single owner role to another active member |
| `rename_group_conversation` | Rename a group as an owner or administrator |

The typed boundary is in `src/lib/groupConversations.ts`, with direct and group summary/message projections in `src/types/messaging.ts` and `src/lib/messages.ts`. Revisions remain exact decimal strings across Postgres and TypeScript. Group conversations use the same bounded inbox, message-page, send, read and unread RPCs as direct conversations. Message rows now include the sender's display name. Inbox activity for a rejoined member starts no earlier than the current join time, so old visible history cannot incorrectly move a rejoined group to the top.

### Checkpoint 3 validation

Validated locally on October 9, 2026:

- All **1,182 SQL assertions across 15 files** passed, including **188 group-message assertions** and all existing direct-message and Task 9 regressions.
- **27 direct-message API checks** and **15 group-message API checks** passed against local Supabase Auth/PostgREST. Both suites verified their exact public-table fingerprints and removed every temporary user, course, invitation, membership, conversation and message fixture.
- **10 direct-message concurrency cases** and **eight group concurrency cases** passed. They cover idempotent creation/invitation/acceptance, cap enforcement, stale management revisions, owner/role transitions, removal/rejoin periods, sends and read ordering.
- **38 messaging client contract groups** passed, including **11 new group-client groups**. The unchanged direct-message app suite still passes **104 UI/controller/lifecycle groups**, and all **nine offer-action lifecycle checks** pass.
- Lint/typecheck passed. `supabase db lint --local` returned no errors or warnings.
- All 21 migrations, including `20261009094852_persist_group_conversations.sql`, replayed successfully in an isolated shadow database. The diff command still reports previously documented function-definition drift outside this checkpoint; no unrelated generated diff was saved.
- Independent schema, authorization, concurrency and client reviews found no blocking issue after corrections. Review added explicit NULL rejection, acceptance-time eligibility checks, future-direct membership initialization, correct rejoin activity ordering, immutable creation fingerprints, group-parent/owner constraints, membership-period operation guards and monotonic management revisions before final validation.

This is a backend/API checkpoint. It adds no group screens, phone-test gate, native dependency, hosted migration, realtime subscription or standalone APK. Hosted Development/Preview and the phone-tested Preview build remain unchanged.

## Checkpoint 4: group-conversation app integration

This checkpoint connects the checkpoint 3 contract to the existing red-and-white messaging experience while preserving the completed direct-message flows. It remains a local-development checkpoint: no hosted migration, realtime subscription, native dependency or standalone APK was added.

### App flow

- A protected creation screen loads current courses and course classmates, validates a 1–80-character title and 1–19 unique invitees, then opens the confirmed server conversation.
- Creation persists the exact account/backend-scoped title, course, invitees and client UUID before dispatch. An uncertain response can retry only that frozen request; changing details requires an explicit discard that mints a new identity.
- Pending invitations have a dedicated cursor-paged screen. Accept and decline are serialized, reject stale focus/background/account results, and lock contradictory actions after an ambiguous response until a confirmed refresh.
- The main inbox renders direct and group conversations together. Group rows show title, course, active count and persisted preview, participate in loaded-row search and unread filtering, and navigate to the shared message thread.
- Group threads label each sender, share durable drafts and duplicate-safe sends with direct threads, and make `can_send` authoritative. Active members can open group details; former members receive a read-only history notice, no current group details and no composer.
- Active members can inspect the roster. Owners and administrators can rename and invite; pending invitations can be revoked. Owners can change roles and transfer ownership, administrators can remove ordinary members, and owners must transfer before leaving.
- Every manager mutation uses one atomic management snapshot's exact revision and target membership period. A failed authorization refresh clears previously privileged data, and an ambiguous mutation disables more changes until a confirmed refresh.
- Manager invitations persist the exact invitee, retry UUID and management revision before dispatch. The target remains frozen across reload, offline failure or lost response until confirmation or an explicit discard.
- Leaving or removal moves a conversation out of the active inbox. Paged Past groups lets the former member reopen only their bounded membership-period messages; current roster/count, later activity and sending stay unavailable. A later accepted re-invitation begins a fresh visible period without revealing the gap.

### Discovery migration

Migration `20261009104214_page_group_history_and_invitations.sql` adds bounded keyset RPCs for pending invitations and former groups. Both pair the full PostgreSQL timestamp with a UUID tie-breaker, reject partial/non-finite/replayed cursors, pin the authenticated actor and return only narrow projections. The app preserves PostgreSQL microseconds instead of reducing cursors to JavaScript milliseconds. The legacy invitation RPC remains available.

### Checkpoint 4 validation

Validated locally on October 9, 2026:

- All **1,210 SQL assertions across 16 files** passed, including the new 28-assertion discovery suite and every earlier direct-message, group-message and Task 9 regression.
- **27 direct-message plus 17 group-message live API checks** passed with exact fixture cleanup and unchanged pre-existing public-table fingerprints.
- **10 direct plus eight group concurrency cases** passed, covering duplicate identities, races at invitation capacity, acceptance/revocation, removal/send, role and ownership transitions.
- **40 messaging client contract checks** passed: 16 core messaging, 11 request-contact/unread and 13 group-client groups.
- **148 messaging UI/controller/lifecycle checks** passed, including 44 group policy, creation and production-route checks. All **nine offer-action lifecycle checks** also pass.
- Lint/typecheck and whitespace checks pass. Database lint reports no application-schema errors. All 22 migrations replay cleanly in an isolated shadow database with no schema drift and without resetting the working local database.
- Android production export bundled all 1,642 modules and generated Hermes bytecode successfully after directing the desktop sandbox's temporary output into the repository.
- Independent UI and client/database reviews found no correctness or authorization blocker. Review hardened durable retries, stale lifecycle suppression, manager-data clearing, exact microsecond cursor advancement and former-member privacy.

Historical gate: focused group phone testing was pending after checkpoint 4. On October 22 the user deferred groups; the implementation is preserved but disabled by checkpoint 5. Group testing no longer blocks the direct-message release.

## Checkpoint 5: direct realtime and group deferral

On October 22, 2026, the user chose to postpone group conversations. This checkpoint finishes the next local direct-message stage without changing hosted environments or building another APK.

### Group deferral

- `GROUP_MESSAGING_ENABLED = false` hides group rows, creation, invitations and former-group history. The root navigator and each group route independently block old deep links; the shared thread also rejects a group summary.
- Migration `20261022090959_defer_groups_and_direct_realtime.sql` removes client execution permissions from dedicated group APIs and private entry points. The common conversation/message authorization guard rejects groups, and inbox/unread queries include direct conversations only. An older APK cannot bypass the deferral.
- No group rows, messages, invitations or membership periods are deleted. Earlier migrations and dormant code remain available for a separately reviewed re-enablement, including fresh validation and phone tests.
- Historical group SQL suites are retained under `supabase/deferred-tests`; group-only live API/concurrency scripts remain as historical tests and are not part of the active commands. They require a deliberately re-enabled group schema. Pure group client/UI tests remain to protect the retained implementation, and new tests assert that production routes stay disabled.

### Realtime contract and lifecycle

- Each completed, signed-in account joins its own **private** `messages:<profile UUID>` topic. RLS allows receiving only that topic. Clients cannot publish messages to it or subscribe as another account.
- Direct message inserts and new direct memberships emit `messages_changed`. A read-cursor advance emits only to its owner; peers receive no read receipt. The payload carries only a conversation UUID plus Supabase's random broadcast ID, never message text, participant metadata or read cursors.
- Signals invalidate local views. The inbox, open thread and tab unread total refetch through the existing authorized APIs. Automatic inbox catch-up retains older loaded conversations and fills activity gaps; manual refresh resets the page. Repeated events coalesce; an event received during a load or pagination queues one catch-up load instead of being lost.
- Subscription success/reconnect and foreground return trigger catch-up. A 30-second foreground fallback recovers missed events or unavailable realtime service. Manual refresh/retry remains available.
- Each session uses an isolated realtime client. Token changes replace the connection; backgrounding, sign-out and cleanup disconnect it. Late callbacks from an older connection are ignored. Screens only refresh while focused/foreground, and a thread ignores signals for other conversations.
- Drafts, frozen send retries, exact message cursors, pagination and the existing newest-message scroll behavior remain intact. No new native dependency, push notification, typing indicator, presence or peer read receipt is introduced.

### Checkpoint 5 validation

Validated locally on October 22, 2026:

- **1,059 active SQL assertions** pass, including 65 new group-deferral/realtime assertions. The 216 historical group assertions are retained outside the active test directory because the current contract intentionally denies groups.
- **27 direct API checks**, **19 actual websocket checks** and **10 direct-message concurrency cases** pass. Both live API suites cleaned their temporary fixtures and verified unchanged pre-existing public-table fingerprints.
- **40 messaging client checks**, **177 messaging UI/controller checks**, **17 realtime lifecycle/transport checks** and **nine offer-action lifecycle checks** pass.
- Lint/typecheck, Android Hermes bundle export and whitespace validation pass. Scoped database lint and local security advisors report no application issues.
- All **23 migrations** replay successfully in an isolated shadow database, the messaging schema diff is empty, and local migration history is aligned. No working database was reset.
- Independent client lifecycle and database authorization reviews found no blockers. Review also preserved older paginated inbox rows during automatic refresh and retained manual refresh's explicit reset behavior.

Phone results remain pending. Hosted environments and the standalone Preview APK are unchanged.

### Web testing startup correction

The first laptop-browser attempt crashed Expo with `ReferenceError: window is not defined`. Supabase's client was being constructed during Expo's Node static render with the browser AsyncStorage adapter, which tried to access `window.localStorage` before hydration.

`src/lib/supabase.ts` now detects web rendering without `window`, omits browser storage and disables persistence/automatic refresh only in that environment. The installed SDK uses isolated memory storage for that render. Browser and native clients retain AsyncStorage, automatic refresh, PKCE, the process lock and existing session behavior; native runtimes without `window` are not mistaken for servers.

Seven regression checks exercise the production configuration and installed auth SDK, including server initialization and INITIAL_SESSION, memory isolation, real web AsyncStorage persistence, and Android/iOS persistence without `window`. They run through `npm run test:auth-runtime` in CI. Lint/typecheck, web static export (35 routes), Android Hermes export, and loading/reloading the browser sign-in screen pass. The existing web shadow-style deprecation warning is non-fatal.

After a crashed Expo process, restart `npx expo start --dev-client --localhost --clear`. Press `w` in that terminal to open `http://localhost:8081`, then sign into the second local test account. Keep the first account signed in on the phone; a second Metro server is unnecessary. These startup checks do not replace the pending two-account realtime phone checklist.

### Checkpoint 5 phone checklist

Use the development client connected to current local source and local Supabase. Two simultaneously signed-in sessions (two devices, or a phone and a second supported client) are needed to observe delivery without manually changing accounts. Both accounts must use the same backend.

```powershell
Set-Location D:\Projects\CampusClutch
adb devices
adb reverse tcp:8081 tcp:8081
adb reverse tcp:54321 tcp:54321
npx expo start --dev-client --localhost
```

Keep Metro and Docker running and USB connected. This is a local development-client test, not the older standalone Preview APK. For two USB Android devices, use `adb -s <device-id> reverse ...` for each device. Local reset emails remain at `http://127.0.0.1:54324/` on the laptop.

1. **Live thread:** Open the same direct conversation on A and B. Send both ways without refreshing. Each new message should appear once, and the sender's newest message should stay visible with the keyboard open.
2. **Inbox and badge:** Keep B on Home while A sends. B's Messages tab badge should increase automatically. Open B's inbox: the conversation preview and individual unread count should match. Reading the incoming messages should clear the appropriate counts without a manual refresh. Also start one new direct conversation to confirm it appears in the recipient's inbox.
3. **Older history:** On B, scroll up and load earlier messages while A sends several. B should keep its reading position and offer the new-message jump control. Jump to the newest messages and confirm there are no missing or duplicate bubbles; the draft should remain intact.
4. **Reconnect/background:** Disconnect B's database access while leaving Metro reachable (`adb reverse --remove tcp:54321` for that device), send from A, then restore `adb reverse tcp:54321 tcp:54321`. B should catch up without losing the draft or duplicating messages. Separately background B, send from A, and reopen B; the missed messages should appear. Allow up to 30 seconds for the fallback if the socket is still reconnecting.
5. **Account isolation:** Sign B out, then sign in as a third account. Send another A-to-B message from A. B's old conversation, draft and badge must not appear in the third account. Sign back into B and confirm catch-up.
6. **Deferred groups:** Messages should show direct conversations only, with no create-group, invitation or past-group entry points. An old saved group link should not open group content or allow sending. Direct messaging from profiles/classmates/requests should still work.

Stop at this gate and record failures before moving to hosted deployment. The earlier durable-send/offline tests need repeating only if these checks reveal a regression.

## Remaining integration and release work

1. Complete the checkpoint 5 direct realtime phone checklist.
2. Deploy and validate the full Task 10 migration sequence in hosted Development/Preview, including the group deferral; build and test a new standalone Preview APK.
3. Complete final review, CI, merge and documentation closure, then begin Task 11 notifications.

Group conversations and creator-made quests are deferred product work. Their retained code does not mean they are released or phone-validated.

## References checked for this implementation

- [Supabase changelog](https://supabase.com/changelog): reviewed again for checkpoint 3; no current Database, Auth or client-library change affects this implementation, and no extension or version change is part of the checkpoint.
- [Row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security): explicit grants, member predicates and authorization tests.
- [Database functions](https://supabase.com/docs/guides/database/functions): invoker defaults, fixed search paths and restricted execution.

- [Realtime broadcast](https://supabase.com/docs/guides/realtime/broadcast) and [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization): checkpoint 5 uses private database broadcasts and receive-only topic authorization. The changelog was rechecked on October 22; the announced legacy TLS cipher retirement does not require a client or extension change here.
