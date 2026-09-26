# Task 10 — Conversations and Messages

**Current status:** Checkpoint 1 completed locally on September 26, 2026, on `codex/persist-messages`, based on `main` at `0ae8af1` after Task 9 implementation and documentation merged. This checkpoint establishes the direct-messaging database and typed API. Task 10 is not complete. Existing message screens still use their fixtures until the next checkpoint integrates the validated API. Hosted Development and Preview remain on Task 9; no new APK was built for this backend checkpoint.

## Checkpoint 1: direct-messaging foundation

The existing inbox stores five example conversations in the screen file. The thread appends messages to React state, uses sample timestamps, and loses messages after reopening. Real UUID student messaging is disabled. The inbox compose button points to `/messages/new`, which has no dedicated route. These screen issues will be addressed together during the UI checkpoint.

### Scope

- Persistent direct conversations, with exactly one conversation per normalized pair of users.
- Membership-controlled message history and inbox summaries.
- Idempotent text sending with a client-generated UUID retained for retries.
- Per-conversation message sequences and cursor pagination.
- Private, monotonic read state and unread counts that exclude the caller's own messages.
- Authorized request links for each accepted assignment round, including earlier completed/cancelled rounds.
- A typed client that pins the authenticated session for each call and rejects results after account changes.

Group creation and invitations, realtime updates, the app screens, hosted deployment and a new APK are separate checkpoints. No push notifications, peer read receipts, attachments, message editing/deletion, typing indicators, or presence are introduced here.

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
npx supabase test db --local
python scripts/test-messages-concurrency.py
npm run test:messages-local
```

The database/API checks require the running local Supabase stack with repository migrations applied. The concurrency and API scripts also require `psql` on PATH; the API script requires `.env.local` to point exactly to `http://127.0.0.1:54321` with its local publishable/anon key. These scripts refuse hosted API use or hardcode local database access and clean up only their isolated fixtures. No phone test is required until the screens use this API.

## Next checkpoint: connect the app

1. Replace inbox and thread fixtures with authorized persistent data, retaining the red/white styling and Android keyboard behavior.
2. Enable direct messaging from real student profiles and request assignment history using the returned conversation UUID.
3. Handle loading, empty states, retry, account/focus changes, pagination and retained failed-send drafts.
4. Advance read state only for messages actually loaded while the conversation is focused. Do not expose another person's read cursor.
5. Replace or implement the compose action and give filters an accurate backend meaning.
6. Run a phone checkpoint for two-account sending, restart persistence, unread behavior, request-round isolation and offline retry.

Group membership/invitation consent and history visibility must be settled before the group checkpoint. Hosted rollout, standalone Preview testing, final review, CI and merge follow completed feature checkpoints.

## References checked for this implementation

- [Supabase changelog](https://supabase.com/changelog): reviewed before implementation; no extension or version change is part of this checkpoint.
- [Row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security): explicit grants, member predicates and authorization tests.
- [Database functions](https://supabase.com/docs/guides/database/functions): invoker defaults, fixed search paths and restricted execution.
