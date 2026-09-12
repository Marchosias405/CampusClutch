# CampusClutch

CampusClutch is an Expo React Native mobile app for university students to connect through courses, classmates, student profiles, campus help requests, direct messages, group conversations, notifications, and user profiles.

Authentication, user profiles, courses, course memberships, classmates, and campus requests now use persistent Supabase data. Tasks 6–8 have been validated in hosted Development and Preview. Messages and notifications still use mock or local state; the real Offer Help workflow is the next roadmap task.

> **Current status:** Tasks 1–8 are complete and merged. Task 7 merged through [PR #24](https://github.com/Marchosias405/CampusClutch/pull/24) at `13d2202`. Task 8 merged through [PR #25](https://github.com/Marchosias405/CampusClutch/pull/25) at `19f3e61`, after backend validation, all five standalone Preview phone tests, final code review, and passing GitHub CI. Local `main` was synchronized and the Task 8 feature branch deleted locally and remotely. Task 9—Implement Real Offer Help Workflow—is next and has not started.

---

## Current Tech Stack

- Expo SDK 54
- Expo Dev Client
- Expo Image Picker
- React Native
- TypeScript
- Expo Router
- React 19
- React Native Web
- React Native Reanimated
- React Native Safe Area Context
- React Native Community DateTimePicker
- Expo Vector Icons
- Supabase
- Supabase JavaScript client
- React Native AsyncStorage
- React Native URL polyfill
- Supabase CLI
- Docker Desktop for local Supabase
- Mock data
- In-memory React context
- Expo Application Services (EAS)
- GitHub Actions CI
- Apache License 2.0
- Node 22
- npm
- Windows and PowerShell development environment

---

# Current Project Status

Completed major milestones:

- Courses and classmates navigation
- Student profile screens
- Local direct-message threads
- Classmate-to-chat routing
- Campus request feed and filters
- Request creation for four request types
- Request validation and submission feedback
- Request details and the original Offer Help UI prototype (superseded by Task 8)
- Android keyboard fixes for messages and request forms
- Expo/EAS project configuration
- Android and iOS application identifiers
- EAS development, preview, and production profiles
- Successful Android preview APK builds
- Successful Android development-client build
- Physical Android device testing
- GitHub Actions lint/typecheck CI
- Protected `main` branch workflow
- Public repository review
- Apache License 2.0
- Approved Supabase backend architecture
- Local Supabase project structure and Docker workflow
- Hosted Supabase Development and Preview projects
- Separate EAS Development and Preview environment variables
- Typed Expo environment validation
- Reusable Supabase client foundation
- Backend setup documentation
- Hosted Development email/password authentication
- Auth-state subscription and session restoration
- Protected Expo Router navigation
- Email confirmation and resend flow
- Password-reset request and recovery flow
- Hosted PKCE email-confirmation callback verified end to end
- Local Mailpit recovery testing
- Recovery-mode protection during password-reset sessions
- Task 5 merged into `main`
- Persistent Supabase profile schema
- Shared campus reference data
- Persistent profile onboarding
- Persistent profile editing
- Persistent discoverability controls
- Persistent normalized interests
- Atomic interest replacement
- Persistent LinkedIn and Instagram profile links
- Per-social-link visibility controls
- Private profile-avatar Storage
- Expo image-picker profile integration
- Safe avatar replacement and cleanup
- Persistent avatar rendering
- Public UUID student-profile loading
- Shared-interest calculation for real profiles
- Database-enforced social-link visibility
- Stale/deleted-account sign-out recovery
- Task 6 migrations applied to Development
- Task 6 migrations applied to Preview
- Physical Android testing of the Task 6 profile flows
- Persistent course catalog, academic terms, and course memberships
- Backend classmates with profile privacy enforcement
- Persistent creation and details for all four request types
- Owner-only request editing, cancellation, and history
- Backend request filtering, pagination, and expiration
- Offline refresh recovery and form retention after failed saves
- Standalone Task 8 Preview APK built and tested
- Task 7 and Task 8 merged with passing CI

Current roadmap position:

```text
Task 6 — Complete and merged (PR #22, 870b6a7)
Task 7 — Complete and merged (PR #24, 13d2202)
Task 8 — Complete and merged (PR #25, 19f3e61)
Task 9 — Next; not started
```

Task 8 completion record:

- Implementation, database validation, hosted deployment, and Android testing passed.
- Final local lint/typecheck and whitespace checks passed.
- Code review found no blocking issues; the required GitHub CI check passed.
- PR #25 merged into `main` on September 11, 2026 (America/Vancouver).
- Local `main` was synchronized with `origin/main` at `19f3e61` with a clean working tree.
- `codex/persist-requests` was deleted locally and remotely, and stale references were pruned.
- This README closure update is on `codex/update-readme-task-8`; pushing it does not itself merge it into protected `main`.

Detailed validation history: [Task 8 checkpoint](docs/task-8-requests.md). Its earlier pending notes describe checkpoints before the completed PR #25 merge.

---

# Important Current Limitations

CampusClutch has persistent authentication, profiles, courses, memberships, and requests. Remaining feature limitations are listed below.

This means:

- Requests persist in the selected backend environment; local, hosted Development, and hosted Preview accounts/data are separate.
- Locally sent messages reset when the conversation is reopened or the app reloads.
- Real offers are not implemented. Task 8 removed the simulated offer confirmation; Task 9 will add persistent offers.
- Course membership persists; current/previous courses derive from membership and academic-term state.
- Classmates load from real course membership with backend visibility rules.
- Legacy classmate profile IDs such as `aisha-r`, `jordan-t`, and `mei-l` remain explicitly supported by the student-profile screen.
- Real Supabase UUID student profiles can load persisted backend profile data.
- Real UUID messaging is intentionally disabled until persistent conversations/messages are implemented in Task 10.
- Signed-in user identity loads from hosted Supabase.
- Profile onboarding and profile editing persist.
- Profile discoverability is persisted and enforced by RLS.
- Profile campuses are stored through shared campus reference IDs.
- Interests are normalized in the database.
- Interest replacement is atomic.
- LinkedIn and Instagram values are persisted separately from profile core fields.
- Social-link visibility is enforced by database RLS.
- Profile avatars use private Supabase Storage.
- Owner-scoped avatar paths are enforced.
- Avatar replacement uses safe upload/update/delete ordering.
- Public profile avatar rendering uses authenticated signed URLs.
- Initials remain as a fallback when no avatar exists or avatar loading fails.
- Task 6 migrations are applied and synchronized in both hosted Development and Preview.
- Offers, conversations, messages, and notifications do not yet use persistent feature tables.
- There are no real push notifications.
- There is no production reporting or moderation workflow.
- The production Supabase project and production EAS variables are not configured.

An installable EAS build and partially persistent backend do not make the app a complete production service.

---

# Team Working Method

CampusClutch uses a waterfall-style development process.

Each task should be finished before the next dependent task begins.

```text
Choose one focused task
→ create a branch
→ inspect the current code
→ implement only that task
→ test locally
→ run quality checks
→ commit
→ push
→ open/update a pull request
→ wait for CI
→ review
→ merge
→ update local main
→ delete the feature branch
→ document completion
→ start the next task
```

Current team expectations:

- Either active developer may take the next task.
- No task is permanently assigned.
- The third teammate can test, review, document, or help prepare plans.
- Avoid having two people edit the same files at the same time.
- Do not start dependent roadmap items before earlier work is merged.
- Keep pull requests focused and reviewable.

---

# Important Development Rules

1. Use Expo Router for navigation.
2. Use `useRouter` for navigation actions.
3. Use `useLocalSearchParams` for dynamic route parameters.
4. Do not create `App.tsx`.
5. Do not add `NavigationContainer`.
6. Do not use React Navigation directly for screen routing.
7. Keep shared types in `src/types/`.
8. Keep shared mock data in `src/constants/mockData.ts`.
9. Structure mock-data code so a backend can replace it later.
10. Do not rewrite unrelated screens.
11. Keep the existing CampusClutch red and white design.
12. Work on one focused task at a time.
13. Test each task before starting another.
14. Do not push feature work directly to `main`.
15. Use branches, pull requests, passing CI, and merge workflow.
16. Ask for the latest file contents before making a large edit when the current implementation is uncertain.
17. Use PowerShell-compatible commands.
18. Keep pull requests focused.
19. Document intentional limitations before merging.
20. Do not combine unrelated backend, UI, EAS, and feature work in one pull request.
21. Update this README when a major task is completed.
22. Do not assume `src/app/messages/new.tsx` exists.
23. Keep Supabase temporary CLI state under `supabase/.temp/` uncommitted.
24. Keep hosted Development as the normal linked Supabase project after Preview validation.
25. Finish the Task 8 documentation closure before beginning Task 9 from updated `main`. Continue to complete each task through validation, CI, review, merge, and documentation before starting the next.

---

# Required Git Workflow

Start every new task from an updated `main` branch:

```powershell
git switch main
git pull origin main
git switch -c <branch-name>
```

Before committing:

```powershell
npm run check
git diff --check
git status
```

Stage only the files related to the task:

```powershell
git add -- <file-paths>
git diff --cached --check
git --no-pager diff --cached
```

Commit and push:

```powershell
git commit -m "<type>: describe the change"
git push -u origin <branch-name>
```

After the pull request is merged:

```powershell
git switch main
git pull origin main
git branch -d <branch-name>
git fetch --prune
git status
```

Expected final state:

```text
On branch main
Your branch is up to date with 'origin/main'.

nothing to commit, working tree clean
```

---

# Local Quality Checks

The project includes:

```powershell
npm run lint
npm run typecheck
npm run check
```

`npm run check` runs linting and TypeScript checking together.

Current expected result:

```text
0 errors
0 warnings
```

The former Courses `matchesQuery` Hook warnings were resolved in Task 7.

Task 8 also has database tests in `supabase/tests/requests.test.sql` (61 assertions), course regression tests in `supabase/tests/course_memberships.test.sql` (13 assertions), and a local API integration script in `scripts/test-requests-local.cjs` (13 assertions). These passed during feature validation; they are not yet part of GitHub CI. See [the checkpoint](docs/task-8-requests.md) for prerequisites and repeatable commands.

---

# CI and Branch Protection

GitHub Actions CI is configured in:

```text
.github/workflows/ci.yml
```

CI runs:

```powershell
npm ci
npm run check
```

The required GitHub check is displayed as:

```text
CI / Lint and typecheck
```

The `main` branch is protected.

Current protection includes:

- Pull requests are required.
- Required CI checks must pass.
- Branches must be up to date before merging.
- Open review conversations must be resolved.
- Force pushes are blocked.
- Branch deletion is restricted by the repository ruleset.
- Feature work should not be pushed directly to `main`.

---

# Current Relevant Project Structure

```text
CampusClutch/
├── .github/
│   └── workflows/
│       └── ci.yml
├── .vscode/
│   ├── extensions.json
│   └── settings.json
├── docs/
│   ├── backend-plan.md
│   ├── backend-setup.md
│   └── task-8-requests.md
├── scripts/
│   └── test-requests-local.cjs
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── forgot-password.tsx
│   │   │   ├── sign-in.tsx
│   │   │   └── sign-up.tsx
│   │   ├── (tabs)/
│   │   │   ├── _layout.tsx
│   │   │   ├── courses.tsx
│   │   │   ├── index.tsx
│   │   │   ├── messages.tsx
│   │   │   ├── profile.tsx
│   │   │   └── requests.tsx
│   │   ├── auth/
│   │   │   ├── callback.tsx
│   │   │   └── reset-password.tsx
│   │   ├── courses/
│   │   │   ├── add.tsx
│   │   │   └── classmates.tsx
│   │   ├── messages/
│   │   │   └── [id].tsx
│   │   ├── profile/
│   │   │   ├── onboarding.tsx
│   │   │   └── settings.tsx
│   │   ├── requests/
│   │   │   ├── [id].tsx
│   │   │   └── create.tsx
│   │   ├── students/
│   │   │   └── [id].tsx
│   │   ├── _layout.tsx
│   │   └── notifications.tsx
│   ├── assets/
│   │   └── images/
│   ├── components/
│   ├── constants/
│   │   └── mockData.ts
│   ├── context/
│   │   ├── AuthContext.tsx
│   │   ├── ProfileContext.tsx
│   │   └── RequestsContext.tsx
│   ├── lib/
│   │   ├── avatars.ts
│   │   ├── courses.ts
│   │   ├── crypto.ts
│   │   ├── crypto.native.ts
│   │   ├── requests.ts
│   │   ├── env.ts
│   │   ├── profiles.ts
│   │   └── supabase.ts
│   └── types/
│       ├── course.ts
│       ├── index.ts
│       └── profile.ts
├── supabase/
│   ├── .gitignore
│   ├── migrations/
│   │   ├── 20260729074002_add_auth_profiles.sql
│   │   ├── 20260803061327_persist_user_profiles.sql
│   │   ├── 20260805042701_replace_profile_interests_atomically.sql
│   │   ├── 20260805052414_add_profile_social_links.sql
│   │   ├── 20260805053323_replace_profile_social_links_atomically.sql
│   │   ├── 20260805061611_allow_avatar_owner_cleanup.sql
│   │   ├── 20260818072241_persist_courses_and_memberships.sql
│   │   └── 20260907204626_persist_requests.sql
│   ├── tests/
│   │   ├── course_memberships.test.sql
│   │   └── requests.test.sql
│   ├── config.toml
│   └── seed.sql
├── .env.example
├── .gitignore
├── app.json
├── babel.config.js
├── eas.json
├── eslint.config.js
├── expo-env.d.ts
├── LICENSE
├── package-lock.json
├── package.json
├── README.md
└── tsconfig.json
```

Verify the current folder structure before adding a new route or provider.

In particular, do not assume this file exists:

```text
src/app/messages/new.tsx
```

The Supabase CLI may create ignored temporary state under:

```text
supabase/.temp/
```

Do not commit that directory.

---

# Completed Features

## Courses Flow

Completed behavior:

- Available courses and academic terms load from Supabase.
- `+ Add Course` opens `/courses/add` with search by course code/title.
- Joining and leaving a course persists through guarded backend functions.
- Duplicate enrollment is prevented; leaving and rejoining are supported.
- Current and previous course lists derive from persisted membership and term status.
- Course cards open `/courses/classmates` with `courseId`.
- Classmates load from actual memberships, with discoverability and access rules enforced by the backend.
- Student cards open real UUID profiles at `/students/[id]`.
- Loading, error, empty, and refresh states are present.

Known working flow:

```text
Courses
→ Add / Remove Course
→ Reload with membership preserved
→ Classmates
→ Persistent Student Profile
```

Known limitation:

- Messaging from real UUID profiles remains disabled until Task 10.
- Legacy mock profile/chat routes remain compatibility paths; they do not supply the current classmates list.

---

# Student Profiles

`src/app/students/[id].tsx` now supports two explicit profile paths.

## Legacy mock path

Existing mock IDs remain supported:

```text
aisha-r
jordan-t
mei-l
```

Legacy behavior remains intact:

- Avatar
- Name
- Program
- Year
- Campus
- Shared interests
- Match badge where applicable
- Shared-course/activity note
- Recently-active indicator
- Existing mock Message routing

Manually regression-tested:

- Aisha R.
- Jordan T.
- Mei L.

## Persistent UUID path

Real Supabase profile UUIDs now load backend-backed profile data.

Supported persisted data includes:

- Display name
- Major
- Year of study
- Campus
- Profile avatar
- Shared interests
- Visible LinkedIn profile
- Visible Instagram profile

Behavior:

- Only valid UUID routes attempt real Supabase profile loading.
- RLS controls whether another user can read the target profile.
- Non-discoverable/incomplete profiles appear unavailable.
- Shared interests are calculated against the current signed-in user's persisted interests.
- Public social rows come only from social-link data readable through RLS.
- Private avatar objects are loaded through authenticated signed URLs.
- Initials are used when no avatar exists.
- Real UUID profiles do not display legacy mock-only match/activity data.
- Real UUID messaging is deliberately disabled and displays:
  - `Messaging coming later`

Persistent messaging remains Task 10 work.

Manual Android validation completed:

- Real discoverable UUID profile loads.
- Persisted name loads.
- Persisted major loads.
- Persisted year loads.
- Persisted campus loads.
- Persisted shared interests load.
- Visible LinkedIn and Instagram load.
- No-avatar profile displays initials.
- Uploaded avatar replaces initials and renders on the real UUID student-profile screen.
- Legacy mock profile behavior remains intact.

---

# Persisted User Profiles — Task 6

Task 6 has implemented the profile domain while preserving later roadmap boundaries.

## Core profile schema

`public.profiles` includes:

- `id`
- `display_name`
- `major`
- `year_of_study`
- `campus_id`
- `avatar_path`
- `is_discoverable`
- `onboarding_completed_at`
- `created_at`
- `updated_at`

Profile rows remain one-to-one with:

```text
auth.users
```

A new Auth user automatically receives a corresponding profile row.

## Profile completion

A completed profile requires:

- A non-empty persisted display name
- A populated onboarding completion timestamp

Incomplete signed-in users are routed to:

```text
/profile/onboarding
```

Completed signed-in users are allowed into the protected application routes.

## Campus data

Shared campus reference data includes:

- Burnaby
- Surrey
- Vancouver

Profiles store the shared campus ID rather than duplicating free-form campus text.

## Profile onboarding

Backend-backed onboarding supports:

- Profile photo
- Display name
- Major
- Year of study
- Campus
- Interests
- LinkedIn URL
- LinkedIn visibility
- Instagram username
- Instagram visibility
- Overall profile discoverability

Onboarding persistence survives full app restarts.

Profile completion is saved last so protected navigation does not remove the onboarding route before related profile data has finished saving.

## Profile Settings

`/profile/settings` supports editing:

- Profile photo
- Display name
- Major
- Year of study
- Campus
- Interests
- LinkedIn
- LinkedIn visibility
- Instagram
- Instagram visibility
- Profile discoverability

Saved changes persist across app restarts.

---

# Interests

Task 6 added:

```text
public.interests
public.profile_interests
```

The client loads the active interest catalog from Supabase.

Interest selection is available in:

- Profile onboarding
- Edit Profile

Replacement uses:

```text
public.replace_my_profile_interests(uuid[])
```

The function:

- Derives the target profile from `auth.uid()`.
- Deduplicates selected IDs.
- Validates selected interests before replacement.
- Atomically replaces the interest set.
- Prevents a failed update from deleting the previous valid selections.

Focused tests verified:

- Valid replacement
- Repeated-ID deduplication
- Invalid-ID rollback
- Inactive-interest rollback
- Empty replacement clearing all interests
- Cross-user modification prevention
- Discoverable profile-interest reads

---

# Social Profiles

Task 6 added:

```text
public.profile_social_links
```

Currently supported platforms:

```text
linkedin
instagram
```

Each row stores:

- Profile ID
- Platform
- Value
- Visibility
- Created timestamp
- Updated timestamp

Social replacement uses:

```text
public.replace_my_profile_social_links(...)
```

Behavior:

- Derives ownership from `auth.uid()`.
- Supports LinkedIn and Instagram independently.
- Blank values remove the corresponding platform.
- Visibility is stored separately per platform.
- Replacement is atomic.
- Invalid replacement does not partially update the other social link.

Privacy behavior:

- Owners can read/manage their own values.
- Other authenticated users can read only visible social links.
- The parent profile must also be completed and discoverable.
- Hidden social values are blocked by database RLS rather than being merely hidden in the UI.

Hosted Android testing verified:

- Social fields save.
- Values survive restart.
- Fresh onboarding social values persist.
- Edit Profile reloads persisted values.
- Public UUID profiles show allowed social links.

---

# Profile Avatars

Task 6 added private profile-avatar support through Supabase Storage.

Bucket:

```text
avatars
```

Restrictions:

- Private bucket
- Maximum file size: 5 MiB
- JPEG
- PNG
- WebP

Object paths follow the owner-scoped pattern:

```text
<profile-id>/<unique-file-name>.<extension>
```

Avatar helpers are implemented in:

```text
src/lib/avatars.ts
```

Supported behavior:

- Upload
- Signed URL creation
- Delete
- Safe replacement
- MIME validation
- Size validation
- Owner validation

## Safe replacement order

Profile avatar replacement follows:

```text
upload new image
→ update profiles.avatar_path
→ confirm database update
→ delete previous image
```

If the database update fails:

```text
new uploaded orphan is deleted
old avatar is preserved
```

If deletion of the old avatar fails after a successful database update:

```text
new avatar remains the active profile avatar
old cleanup failure is reported separately
```

This prevents profile data from pointing at deleted images.

## Avatar Storage security

Verified behavior includes:

- Owner upload succeeds.
- Cross-user upload fails.
- Invalid MIME fails.
- Files above 5 MiB fail.
- Owner can read own private avatar.
- Other authenticated users can read the active avatar only when the profile is appropriately discoverable.
- Private profile avatar reads are hidden from other users.
- Owner cleanup/deletion works.
- Previous owner avatar objects can be read for cleanup without exposing them to other users.

## Android avatar validation

A new EAS Android development client was built after adding the native image-picker module.

Manually verified:

- Photo picker opens.
- Image cropping works.
- First avatar upload succeeds.
- Avatar persists after restart.
- Avatar renders in Edit Profile.
- Avatar renders in the signed-in Profile tab.
- Avatar replacement succeeds.
- Replacement persists after restart.
- Public UUID profile displays the persisted uploaded avatar.
- Initials fallback works when `avatar_path` is null.

---

# Profile Privacy and RLS

Task 6 profile RLS enforces:

- Anonymous profile reads denied.
- Authenticated owner can read own profile.
- Owner can update approved fields.
- Owner cannot update another profile.
- Protected database-managed fields cannot be modified by the client.
- Other authenticated users can read only appropriately discoverable completed profiles.
- Profile interests inherit profile visibility rules.
- Social links additionally require per-link visibility.
- Avatar object access follows profile visibility and owner-storage rules.

Discoverability is therefore enforced in Supabase rather than depending only on client rendering.

---

# Stale/Deleted Account Recovery

A server-deleted Auth/profile account can leave a cached mobile session until the app signs out locally.

The `Profile unavailable` state now includes:

- Retry
- Sign Out

Sign-out uses:

```text
scope: local
```

so the current mobile session can be cleared without unnecessarily signing out other devices.

Manual test completed:

```text
sign into expendable Development account
→ delete server-side Auth user
→ reopen app with cached session
→ Profile unavailable
→ Sign Out
→ normal Sign In screen
```

This prevents the user from being trapped in the protected profile-loading state.

---

# Task 6 Backend Migrations

This section records Task 6 validation history. Tasks 7 and 8 added the two later migrations listed in the project tree; their validation is recorded in the roadmap sections below.

Task 6 uses the following migration sequence:

```text
20260729074002_add_auth_profiles.sql
20260803061327_persist_user_profiles.sql
20260805042701_replace_profile_interests_atomically.sql
20260805052414_add_profile_social_links.sql
20260805053323_replace_profile_social_links_atomically.sql
20260805061611_allow_avatar_owner_cleanup.sql
```

## Local validation

Completed:

- `npx supabase db reset`
- Local schema validation
- Local RLS/security testing
- Profile validation testing
- Interest atomicity testing
- Social-link atomicity testing
- Avatar Storage policy testing

## Hosted Development

All six migrations are recorded in remote migration history.

Verified migration sync:

```text
Local == Remote
```

for all six migrations.

## Hosted Preview

Preview was restored from its paused state.

Before applying migrations:

```text
npx supabase db push --dry-run
```

reported exactly the expected six migrations.

All six migrations were then applied to Preview.

A Supabase CLI pg-delta catalog-cache warning occurred after SQL application because the temporary certificate file:

```text
supabase/.temp/pgdelta/pgdelta-target-ca.crt
```

was unavailable inside the temporary runtime.

The SQL migration push still completed.

Migration history was immediately verified afterward and showed all six migrations synchronized:

```text
Local == Remote
```

Preview validation is therefore complete.

The CLI was then relinked to the normal hosted Development project.

Current normal linked project ref:

```text
ayisjsajufjkebvbzpdr
```

Preview project ref:

```text
udbijakeasbvoycjyghe
```

---

# Messages Flow

Completed behavior:

- Conversation cards are pressable.
- Conversation cards open `/messages/[id]`.
- Student, delivery, and group conversation headers are supported.
- Mock chat bubbles are displayed.
- The text input stores typed messages.
- Send adds a local message.
- Back returns to Messages.
- Android keyboard avoidance keeps the composer visible.
- Multiline input works above the Android keyboard.
- Hiding and reopening the keyboard keeps the composer usable.

Classmate chat routing:

- Legacy classmate IDs are resolved against `mockStudents`.
- Aisha, Mei, and Jordan display the correct name, major, and avatar.
- New classmate chats begin with an empty thread.
- Existing inbox conversations still display their original mock threads.

Known limitation:

- Messages are local and in memory only.
- Real UUID profile messaging is not implemented.
- New classmate conversations are not added permanently to the Messages inbox.
- Messages reset after reload.

Persistent conversations/messages remain Task 10.

---

# Requests Feed

Completed behavior:

- Category filters: All, Delivery, Event Help, Pickup, and Study Help.
- Campus feed loads open, unexpired requests from Supabase.
- My requests loads the signed-in owner's history, including cancelled/expired requests.
- Backend filtering and pagination support loading more requests.
- Pull-to-refresh, focus refresh, and a one-minute refresh update visible data.
- Loading, error, retry, and empty states are supported.
- Stale responses are discarded when the account or selected view changes.
- Request cards open `/requests/[id]`; the floating `+` opens `/requests/create`.
- Location/deadline rows and View Details are separated to avoid overlap.
- The feed toggle has spacing above the category buttons.

Known limitation:

- Offset pagination can shift when other users post concurrently; refresh starts from the beginning.
- Requester profile names and a real points/reward system remain future work.

---

# Create Request Flow

The Create Request screen persists all four types:

- Delivery: pickup and drop-off locations.
- Pickup: pickup location and destination.
- Event Help: event name and help needed.
- Study Help: course/subject and study topic.

Shared fields:

- Request Title
- Campus
- Room/Specific Location
- Item/Task Size
- Description
- Deadline
- Points Offered

Completed behavior:

- Burnaby, Surrey, and Vancouver campus selection.
- Native/web date selection and past-date blocking.
- Positive whole-number points and type-specific validation.
- Red invalid-field styling and submission feedback.
- Duplicate-tap protection while awaiting the save.
- Common and type-specific fields save atomically through the backend.
- Failed/offline saves preserve form values for retry.
- Successful saves open the persisted request details.
- Owner edits preload persisted values; category remains fixed.
- An unchanged deadline is preserved; a newly selected date uses the end of that day in the phone's timezone.
- Android keyboard avoidance and a scrollable form.

Known limitation:

- If connectivity fails after the server has saved but before the response arrives, check My requests before resubmitting. Duplicate-tap protection does not provide server-side idempotency across retries.

---

# Request Details

Completed behavior:

- UUID-based backend loading independent of the feed.
- Loading, unavailable/not-found, and error/retry states.
- Category, title, description, location, deadline, points, urgency, and Additional Details.
- Persisted status and posted timestamp.
- Owner-only Edit Request and Cancel Request controls.
- Another account cannot edit or cancel the request; authorization is also enforced on the backend.
- Cancellation preserves history and removes the request from the open campus feed.
- Cancelled/expired requests cannot be edited.
- Owner action buttons have spacing and centered labels.
- Back navigation remains available.

Known limitation:

- Real Offer Help, offer acceptance/rejection, and completion are later workflows. The previous simulated Offer Sent confirmation has been removed.

---

# Expo EAS Configuration

## EAS Project

CampusClutch is linked to:

```text
@marchosias405/CampusClutch
```

Expo project ID:

```text
a5524197-aec7-42b0-a8ea-37d5fe714c68
```

Permanent identifiers:

```text
Android package:
com.marchosias405.campusclutch

iOS bundle identifier:
com.marchosias405.campusclutch
```

---

# EAS Build Profiles

`eas.json` includes:

## Development

```json
{
  "environment": "development",
  "developmentClient": true,
  "distribution": "internal"
}
```

## Preview

```json
{
  "environment": "preview",
  "distribution": "internal"
}
```

## Production

```json
{
  "environment": "production",
  "autoIncrement": true
}
```

The project uses remote app version management.

No production store submission has been performed.

---

# Android Builds and Physical Testing

Completed:

- Initial Android preview APK built.
- EAS-managed Android signing configured.
- APK installed on a physical Android device.
- Android-specific issues fixed.
- Updated preview APK tested.
- Development-client APK built.
- Updated development-client APK built after adding native image picker.
- Development client connected to Metro.
- USB/ADB testing confirmed.
- `campusclutch` custom URL scheme confirmed.

Task 6 Android testing includes:

- Authentication
- Session restoration
- Fresh-account onboarding
- Profile editing
- Interests
- Social links
- Discoverability
- Avatar picking
- Avatar cropping
- Avatar upload
- Avatar replacement
- Avatar restart persistence
- Signed-in profile avatar rendering
- Missing-avatar initials fallback
- Stale/deleted-account recovery
- Legacy student profiles
- Legacy student messaging
- Real UUID public student profiles
- Shared interests
- Visible social links
- Public persisted avatar rendering
- Real UUID messaging-disabled state

---

## Current Android Testing Setup

The latest standalone Task 8 Preview APK contains its JavaScript bundle and uses hosted Preview. It launches without Metro, USB, or open laptop terminals. It still needs internet access for backend operations. Local accounts/requests are separate from hosted Preview accounts/requests.

The development-client APK displays a development-server launcher and requires Metro. With the existing local backend configuration, connect the phone by USB and use:

```powershell
Set-Location D:\Projects\CampusClutch
adb reverse tcp:8081 tcp:8081
adb reverse tcp:54321 tcp:54321
npx expo start --dev-client --localhost
```

Local Supabase must also be running. Removing USB disconnects these forwarded services. Restoring access recovered the persisted requests during testing. A development-server launcher indicates the development installation, not the standalone Preview launch flow.

Fresh password-reset recovery was manually verified after the native rebuild. For local recovery testing, use the newest email link from Mailpit on the same phone/app installation that requested it; local mail is available at `http://127.0.0.1:54324` on the laptop.

---

# Authentication Flow

## Implemented

- Email/password sign-up
- Email/password sign-in
- Local-device sign-out
- Auth-state subscription
- AsyncStorage session persistence
- Session restoration
- App-state-controlled token refresh
- Public auth routes
- Protected routes with Expo Router `Stack.Protected`
- Email confirmation
- Verification resend
- Native PKCE callback
- Forgot Password
- Password recovery
- Password update
- Recovery-mode route protection
- Auth-to-profile routing
- Automatic Auth profile initialization

Task 5 remains complete and merged.

Task 6 additionally adjusted post-auth routing so `Stack.Protected` determines whether a signed-in account enters onboarding or the main app.

---

# Completed Roadmap Tasks

## Task 1 — Configure Expo EAS

**Status: Complete**

Completion condition: Met.

---

## Task 2 — Create and Test an Android Preview Build

**Status: Complete**

Completion condition: Met.

---

## Task 3 — Define Backend Architecture

**Status: Complete**

Architecture document:

```text
docs/backend-plan.md
```

Completion condition: Met.

---

## Task 4 — Add Backend Project and Environment Setup

**Status: Complete**

Setup guide:

```text
docs/backend-setup.md
```

Completion condition: Met.

---

## Task 5 — Add Authentication

**Status: Complete**

Merged through:

```text
Pull request #21
```

Completion condition: Met.

---

# Task 6 — Persist User Profiles

**Status: Complete**

Merged through:

```text
Pull request #22
Merge commit 870b6a7
```

The completed `feature/persist-user-profiles` branch was deleted locally and remotely after merge.

Completed:

- Persistent profile schema
- Shared campuses
- Profile RLS
- Profile update restrictions
- Profile onboarding
- Profile editing
- Profile completion routing
- ProfileContext
- Interests
- Atomic interest replacement
- LinkedIn
- Instagram
- Per-link visibility
- Atomic social-link replacement
- Private avatar Storage
- Avatar Storage RLS
- Expo image picker
- Safe avatar replacement
- Avatar rendering
- Initials fallback
- Public UUID student-profile loading
- Explicit legacy mock-profile compatibility
- Shared-interest display
- Social-link privacy enforcement
- Real UUID messaging-disabled state
- Stale/deleted-profile recovery
- Local backend tests
- Hosted Development tests
- Physical Android tests
- Preview migration deployment
- Development migration verification
- Preview migration verification
- CLI returned to Development

Historical Task 6 local quality result:

```text
0 errors
2 existing Courses warnings (resolved in Task 7)
```

Final completion record:

- Final local quality checks passed.
- Full Task 6 branch diff review passed.
- GitHub CI passed.
- Pull request #22 was marked ready for review.
- Pull request #22 merged successfully into `main`.
- Merge commit `870b6a7` is present on local and remote `main`.
- Local `main` was synchronized with `origin/main`.
- The local Task 6 feature branch was deleted.
- The remote Task 6 feature branch was deleted.
- Stale remote references were pruned.
- Development and Preview migration histories were verified synchronized.
- The Supabase CLI was relinked to Development after Preview validation.

Completion condition:

- Profile data loads from backend.
- Profile changes persist.
- Interests work securely.
- Social links work securely.
- Avatars work securely.
- Discoverability is enforced.
- Public student-profile screens use backend data where appropriate.
- Legacy Classmates remains functional.
- Stale-account recovery exists.
- Development migrations are validated.
- Preview migrations are validated.
- Manual regression testing passes.
- Local quality checks pass.
- GitHub CI passes.
- PR review passes.
- PR is merged.

All Task 6 implementation, backend, Preview, manual-test, local-check, CI, review, and merge conditions are met.

**Completion condition: Met.**

---

# Task 7 — Persist Courses and Course Membership

**Status: Complete**

Merged through:

```text
Pull request #24
Merge commit 13d2202
```

Completed:

- Persistent academic terms, course catalog, and course memberships.
- Backend course loading, joining, leaving, and duplicate membership prevention.
- Current/previous course classification.
- Classmates derived from real memberships with backend authorization and profile visibility.
- Existing Expo Router navigation preserved.
- Loading, error, empty, and refresh states.
- Former Courses Hook lint warnings resolved.
- Android auth routing and native crypto support updated; fresh password-reset recovery was manually verified.
- Development and Preview backend validation and Android manual testing completed before merge.
- Task 7 merged with passing CI; Task 8 began from synchronized `main`.

Migration:

```text
supabase/migrations/20260818072241_persist_courses_and_memberships.sql
```

The 13 course/membership regression assertions also passed after Task 8's migration in local, hosted Development, and hosted Preview validation.

**Completion condition: Met.**

---

# Task 8 — Persist Requests

**Status: Complete**

Merged through:

```text
Pull request #25
Merge commit 19f3e61
Implementation commit cca8a0f
```

Completed:

- Replaced in-memory requests with persistent backend loading and saves.
- All four request types retain their type-specific Additional Details.
- Server-controlled owner ID, initial status, and timestamps.
- Atomic common/detail creation and editing.
- Owner-only editing and soft cancellation; cancellation retains history.
- RLS-protected reads and guarded mutation functions; anonymous access denied.
- Open/unexpired campus feed, owner history, category filters, pagination, and refresh.
- Loading, error, empty, and retry states with stale-response protection.
- Offline save form retention and duplicate-tap protection.
- Android request-card, filter, and owner-button spacing fixes.
- Simulated offer confirmations and mock points balance removed.

Migration:

```text
supabase/migrations/20260907204626_persist_requests.sql
```

## Backend validation

- 61 request assertions passed locally and in each hosted environment.
- 13 course regression assertions passed locally and in each hosted environment.
- 13 local API integration assertions passed using the actual request service.
- Test fixtures were rolled back or cleaned up; existing user/course data was not reset.
- Development and Preview migration histories were aligned to repository version `20260907204626`.
- Hosted advisors did not flag Task 8 request objects.
- Existing advisor warnings on `rls_auto_enable`, course functions, and disabled leaked-password protection remain documented for review before production release.

Final local checks did not rerun these database suites because local Supabase was stopped. These results describe the completed feature-validation runs, not a new live health check.

## Standalone Preview validation

Build: `bb1edd72-ab02-4d24-8372-2f4540112157` — **FINISHED**.

[Build page](https://expo.dev/accounts/marchosias405/projects/CampusClutch/builds/bb1edd72-ab02-4d24-8372-2f4540112157)

The user confirmed all five phone tests passed:

1. Create all four request types, restart, and confirm persistence.
2. Edit and cancel owned requests.
3. Verify another account cannot edit/cancel them.
4. Turn off Wi-Fi and mobile data, refresh, reconnect, and retry.
5. Save offline and confirm form values remain.

This closes the Requests offline/retry test that was previously deferred during USB development testing.

## Final completion record

- `npm run check` and whitespace checks passed.
- Final code review found no blocking issues.
- Required GitHub CI passed before merge.
- [PR #25](https://github.com/Marchosias405/CampusClutch/pull/25) merged on September 11, 2026 (America/Vancouver).
- Local `main` and `origin/main` were synchronized at `19f3e61` with a clean working tree.
- The completed feature branch was removed locally and remotely.
- Full checkpoint history and repeatable backend test commands are in [docs/task-8-requests.md](docs/task-8-requests.md).

**Completion condition: Met.**

---

# Task 9 — Implement Real Offer Help Workflow

**Status: Next roadmap task — not started**

Requests persistence is complete. Begin after this README closure update has passed the documentation PR workflow and local `main` is synchronized.

Requirements:

- Persist offers.
- Prevent duplicate active offers.
- Store offering user.
- Store request ID.
- Support:
  - pending
  - accepted
  - rejected
  - withdrawn
- Notify request owner.
- Allow owner acceptance/rejection.
- Update request status.

Completion condition:

- Offer state persists.
- Unauthorized management is blocked.
- Duplicate offers are prevented.

---

# Task 10 — Persist Conversations and Messages

Start only after Offer Help is complete.

Requirements:

- One-to-one conversations
- Group conversations
- Conversation membership
- Message sender
- Message timestamps
- Message loading state
- Send failure state
- Read/unread design
- Secure conversation access
- Request-offer conversation integration
- Decide whether `/messages/new` is required

Completion condition:

- Messages survive reload.
- Conversation access is secure.
- Real UUID student messaging can replace the current disabled state.

---

# Task 11 — Implement Notifications

Start only after messages are persisted.

Possible events:

- Help offer
- Offer accepted
- Offer rejected
- New message
- Request deadline
- Classmate joined a course
- Request completed

Completion condition:

- Notification data is real and persistent.

---

# Task 12 — Add Automated Tests

Course/request database tests and a local request API integration script already exist. This task expands coverage and adds automated test execution to CI beyond lint/typecheck.

Recommended coverage:

## Unit

- Request validation
- Filters
- Date formatting
- Permission helpers

## Component

- Create Request
- Request Details
- Authentication
- Profile states
- Student Profile states
- Messages

## End-to-end

- Sign up/sign in
- Complete profile
- Add course
- Open classmate
- Create request
- Offer help
- Open conversation
- Send message
- View notification

Completion condition:

- Critical flows have automated coverage.
- Tests run in CI.

---

# Task 13 — Accessibility and UI Quality Audit

Audit:

- Screen readers
- Focus order
- Touch targets
- Font scaling
- Color contrast
- Loading states
- Empty states
- Error states
- Disabled states
- Android Back behavior
- Small screens
- Keyboard avoidance

---

# Task 14 — Privacy, Safety, and Moderation

Define and implement:

- Privacy policy
- Terms
- Data retention
- Account deletion
- Blocking
- Reporting
- Moderation
- Abuse handling
- Safety notices

---

# Task 15 — Production Release Preparation

Requirements include:

- Production Supabase
- Production EAS variables
- Store metadata
- Screenshots
- Privacy URL
- Support URL
- Production Android/iOS builds
- Internal store testing

---

# Task 16 — Store Submission

Requirements:

- Google Play submission
- App Store submission
- Privacy questionnaires
- Review feedback
- Release tracking
- Rollback planning

---

# Task 17 — Post-Release Operations

Possible work:

- Crash reporting
- Analytics
- Performance monitoring
- User feedback
- Security reviews
- Database backups
- Incident response
- Dependency maintenance
- Release cadence

---

# Repository and Release Notes

- Repository license: Apache License 2.0
- Repository visibility: Public
- GitHub Actions CI: Active
- Protected `main`: Active
- EAS project: Linked
- Android preview APK: Built and tested
- Android development client: Built and tested
- Backend decision: Supabase
- Backend architecture: Approved and documented
- Local Supabase: Initialized and tested
- Hosted Development project: Task 7 and Task 8 migrations deployed and validated
- Hosted Preview project: Task 7 and Task 8 migrations deployed and validated
- EAS Development variables: Configured
- EAS Preview variables: Configured
- Production Supabase project: Not created
- Production EAS variables: Not configured
- Authentication: Task 5 complete and merged
- User profiles: Task 6 complete and merged through pull request #22
- Task 6 pull request: #22 merged into `main` at merge commit `870b6a7`
- Courses/Classmates persistence: Task 7 complete, PR #24 (`13d2202`)
- Requests persistence: Task 8 complete, PR #25 (`19f3e61`)
- Offer Help persistence: Task 9 next; not started
- Messaging persistence: Task 10
- Production Android build: Not started
- Production iOS build: Not started
- Google Play submission: Not started
- App Store submission: Not started

No secrets, private keys, database passwords, store credentials, or real environment files should be committed.

---

# Current Production Limitations

CampusClutch still needs:

- Real request offers
- Persistent conversations and messages
- Real notifications
- Broader component/end-to-end tests and backend test execution in CI
- Accessibility audit
- Production-ready email delivery/SMTP strategy
- Production Supabase environment
- Production EAS environment variables
- Privacy policy
- Account deletion
- Blocking/reporting/moderation
- Error/crash reporting
- Production store configuration
- Review of existing hosted security-advisor findings recorded in the Task 8 checkpoint

---

# Next Action

Finish the documentation-only closure update:

```text
codex/update-readme-task-8
```

Immediate steps:

1. Review and push the README-only commit.
2. Open a documentation-only pull request into `main`.
3. Confirm CI passes, review, and merge the documentation update.
4. Synchronize local `main` and clean up the documentation branch.

Then begin:

```text
Task 9 — Implement Real Offer Help Workflow
```

Create the next feature branch from updated `main`:

```powershell
git switch main
git pull --ff-only origin main
git switch -c codex/persist-request-offers
```

Initial Task 9 work should:

1. Inspect the current request details screen, request service, and Task 8 database contract.
2. Review `docs/backend-plan.md` and existing migrations before designing offer tables.
3. Define ownership, allowed status transitions, duplicate-active-offer prevention, and request eligibility.
4. Specify how acceptance updates the request atomically, including concurrent offers and owner decisions.
5. Define pending, accepted, rejected, and withdrawn behavior and the owner-facing offer list.
6. Decide the owner notification behavior for this task while keeping the full notification system in Task 11 and persistent messaging in Task 10.
7. Add backend authorization and lifecycle tests before connecting the UI.
8. Implement one bounded checkpoint at a time, preserving the existing Expo Router navigation and red/white design.
9. Stop at a working checkpoint for manual Android testing before advancing.
10. Complete local/hosted validation, Preview tests, CI, review, merge, and documentation before Task 10.

Task 9 implementation has not started. This update documents completed progress and the next plan only.
