# Task 9 — Request Offers

## Checkpoint 1: local backend (2026-09-11, America/Vancouver)

Branch: `codex/persist-request-offers`, based on `9a87581` after README PR #26 merged.

Status: backend checkpoint tested locally. Task 9 is **not complete**. No hosted deployment, app UI change, new APK, PR, or merge is included in this checkpoint.

## Database contract

Migration: `20260912060259_persist_request_offers.sql`.

- `request_offers`: request/helper ownership, pending/accepted/rejected/withdrawn status, optional trimmed message (1–1000 characters; blank becomes null), server timestamps.
- Unique `(request_id, offering_user_id)` is permanent. A retry returns the existing ID without changing the message or reactivating a terminal offer.
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

## Next checkpoint and phone testing

Add typed client calls, approved helper display information, the helper offer flow, and owner management UI. Cover session changes, retries, offline failures, confirmation dialogs, expiry refresh, and stale decisions. Bound/paginate the owner list before shipping the UI.

There is no new phone test to run for checkpoint 1: the app has not been connected to these functions yet. The next checkpoint should provide Android tests for creating/reloading an offer, duplicate taps, withdrawing, owner rejection/acceptance, another helper's losing offer, cancellation/expiry, and offline retry. Hosted migration validation and a new Preview APK follow local UI validation.
