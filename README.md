# CampusClutch

CampusClutch is an Expo React Native mobile app for university students to connect through courses, classmates, student profiles, campus help requests, direct messages, group conversations, notifications, and user profiles.

The app still uses mock data and in-memory React context for several feature flows, but Supabase authentication and the user-profile domain are now connected to persistent backend data. Task 6 has implemented persistent profiles, onboarding, editing, interests, social links, discoverability, avatars, public student-profile loading, and stale-session recovery across the hosted Development and Preview environments.

> **Current status:** Tasks 1–6 are complete and merged. Task 6—Persist User Profiles—was merged through pull request #22 at merge commit `870b6a7`. All Task 6 migrations are synchronized in hosted Development and Preview, the completed feature branch was cleaned up locally and remotely, and the repository was synchronized back to `main`. This README is being finalized on the documentation-only `docs/complete-task-6` branch. Task 7—Persist Courses and Course Membership—is the next roadmap task and must not begin until this documentation-only closure update is merged back into `main`.

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
- Request details and Offer Help state
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

Current roadmap position:

```text
Task 6 — Complete
Task 7 — Next
```

Task 6 completion record:

```text
Pull request #22 — Merged
Merge commit — 870b6a7
```

Task 6 implementation, backend validation, Preview deployment, manual testing, CI, review, merge, branch cleanup, and `main` synchronization are complete.

Current documentation-only closure branch:

```text
docs/complete-task-6
```

After this README-only branch is merged, Task 7 can begin from a fresh branch created from updated `main`.
---

# Important Current Limitations

CampusClutch now has working authentication and a persistent profile domain, but several other feature flows still use mock or in-memory data.

This means:

- Newly created requests reset when the app reloads.
- Locally sent messages reset when the conversation is reopened or the app reloads.
- Offer Help state is local UI state and resets when the request details screen is reopened.
- Course membership is not persisted.
- Classmates are still derived from `mockStudents`.
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
- Courses, requests, offers, conversations, messages, and notifications do not yet use persistent feature tables.
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
25. Do not begin Task 8 until Task 7 has passed implementation, backend validation, manual testing, CI, review, merge, documentation, and `main` synchronization.

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
2 warnings
```

The two existing warnings are in:

```text
src/app/(tabs)/courses.tsx
```

They are React Hook `useMemo` dependency warnings involving `matchesQuery`.

These warnings are intentionally deferred to Task 7 because they are in the Courses flow that Task 7 will migrate to persistent backend data.

Do not make a separate unrelated warning-only change before Task 7.

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
│   └── backend-setup.md
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
│   │   ├── env.ts
│   │   ├── profiles.ts
│   │   └── supabase.ts
│   └── types/
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
│   │   └── 20260805061611_allow_avatar_owner_cleanup.sql
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

- `+ Add Course` opens `/courses/add`.
- Current course cards open `/courses/classmates`.
- The selected course is passed through `courseId`.
- Find Classmates opens `/courses/classmates`.
- Course search works by code and title.
- Course cards are selectable.
- Selected cards use red/pink styling.
- A checkmark appears on the selected course.
- Add Course returns to the Courses screen.
- Classmates are loaded from shared mock data.
- Student cards open `/students/[id]`.
- Legacy classmate Message buttons open `/messages/[id]`.

Known working flow:

```text
Courses
→ Course
→ Classmates
→ Student Profile
→ Message Thread
```

Known limitation:

- Added courses are not persisted after reload.
- Classmate discovery is still mock-backed until Task 7.

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

- Category filters:
  - All
  - Delivery
  - Event Help
  - Pickup
  - Study Help
- Request cards open `/requests/[id]`.
- Nested Offer Help presses use `event.stopPropagation()`.
- Offer Help does not trigger duplicate navigation.
- Back navigation requires one press.
- Newly created requests are added to the beginning of the feed.
- An empty state appears when a filter has no matching requests.
- The floating `+` button opens `/requests/create`.

Known limitation:

- Requests remain in-memory and reset after app restart.

---

# Create Request Flow

The Create Request screen supports:

- Delivery
- Pickup
- Event Help
- Study Help

Shared fields:

- Request Title
- Campus
- Room/Specific Location
- Item/Task Size
- Description
- Deadline
- Points Offered

Completed behavior includes:

- Burnaby, Surrey, and Vancouver campus selection
- Native/web date selection
- Past-date blocking
- Numeric points validation
- Whole-number validation
- Type-specific validation
- Red invalid-field styling
- Duplicate-submit protection
- Submission feedback
- Android keyboard avoidance
- Scrollable form while keyboard is open
- Successful request insertion into local Requests context

Known limitation:

- Created requests reset after reload.

---

# Request Details

Completed behavior:

- Dynamic request IDs
- Request lookup through `RequestsContext`
- Request Not Found state
- Category
- Title
- Description
- Location
- Deadline
- Points
- Urgent badge
- Additional Details for new requests
- Local Offer Help state
- Back navigation

Known limitation:

- Offer Help state resets when the screen is reopened.

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

Current expected local quality result:

```text
0 errors
2 existing Courses warnings
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

**Status: Next roadmap task — not started**

Start only after the documentation-only `docs/complete-task-6` closure update is merged and local `main` is synchronized.

Requirements:

- Load available courses.
- Add a course membership.
- Prevent duplicate membership.
- Remove a course.
- Separate current and previous courses.
- Load classmates from real course memberships.
- Preserve existing navigation.
- Add loading, error, and empty states.
- Resolve the existing `matchesQuery` lint warnings during this task.

Completion condition:

- Added courses persist after reload.
- Classmates are based on backend membership.
- Course screens no longer depend on hardcoded membership mock data.

---

# Task 8 — Persist Requests

Start only after Courses persistence is complete.

Requirements:

- Replace in-memory request creation.
- Load requests from backend.
- Persist every request type.
- Preserve type-specific details.
- Store owner ID.
- Store timestamps.
- Store status.
- Add loading state.
- Add error state.
- Add refresh behavior.
- Keep category filters working.
- Keep Additional Details working.
- Add owner edit/delete rules.

Completion condition:

- Requests survive app reload.
- Multiple users can see appropriate requests.
- Request ownership is enforced.

---

# Task 9 — Implement Real Offer Help Workflow

Start only after requests are persisted.

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
- Hosted Development project: Active
- Hosted Preview project: Active and Task 6 migrations applied
- EAS Development variables: Configured
- EAS Preview variables: Configured
- Production Supabase project: Not created
- Production EAS variables: Not configured
- Authentication: Task 5 complete and merged
- User profiles: Task 6 complete and merged through pull request #22
- Task 6 pull request: #22 merged into `main` at merge commit `870b6a7`
- Courses/Classmates persistence: Task 7
- Requests persistence: Task 8
- Offer Help persistence: Task 9
- Messaging persistence: Task 10
- Production Android build: Not started
- Production iOS build: Not started
- Google Play submission: Not started
- App Store submission: Not started

No secrets, private keys, database passwords, store credentials, or real environment files should be committed.

---

# Current Production Limitations

CampusClutch still needs:

- Persistent course storage and memberships
- Backend classmate discovery
- Persistent request storage
- Real request offers
- Persistent conversations and messages
- Real notifications
- Automated tests beyond lint/typecheck
- Accessibility audit
- Production-ready email delivery/SMTP strategy
- Production Supabase environment
- Production EAS environment variables
- Privacy policy
- Account deletion
- Blocking/reporting/moderation
- Error/crash reporting
- Production store configuration

---

# Next Action

Finish the documentation-only Task 6 closure branch:

```text
docs/complete-task-6
```

Immediate steps:

1. Replace `README.md` with this updated file.
2. Run:
   ```powershell
   npm run check
   git diff --check
   git status --short
   git --no-pager diff --stat
   ```
3. Stage only `README.md`.
4. Verify the staged diff.
5. Commit the documentation update.
6. Push `docs/complete-task-6`.
7. Open a small documentation-only pull request.
8. Confirm CI passes.
9. Merge the documentation PR into `main`.
10. Switch back to `main`.
11. Pull `origin/main`.
12. Delete the local documentation branch.
13. Delete the remote documentation branch.
14. Run `git fetch --prune`.
15. Verify a clean synchronized `main`.

After that, begin:

```text
Task 7 — Persist Courses and Course Membership
```

Create Task 7 from updated `main`:

```powershell
git switch main
git pull origin main
git switch -c feature/persist-courses
```

Task 7 should begin with inspection rather than immediate implementation.

Initial Task 7 work should:

1. Verify the new branch and clean working tree.
2. Inspect the current Courses and Classmates screens.
3. Inspect the current course types and mock data.
4. Review `docs/backend-plan.md` for the approved course/membership architecture.
5. Inspect existing Supabase migrations before designing new schema changes.
6. Define the persistent course and membership model before writing application code.
7. Preserve existing Expo Router navigation and the CampusClutch red/white UI.
8. Keep Requests, Offers, Messages, and Notifications out of Task 7.
9. Resolve the two existing `matchesQuery` warnings as part of the Courses migration.
10. Implement and test Task 7 sequentially before moving to Task 8.

Do not begin Task 8 until Task 7 has passed implementation, backend validation, manual testing, local checks, CI, review, merge, documentation, and `main` synchronization.
