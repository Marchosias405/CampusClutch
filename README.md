# CampusClutch

CampusClutch is an Expo React Native mobile app for university students to connect through courses, classmates, student profiles, campus help requests, direct messages, group conversations, notifications, and user profiles.

The app still uses mock data and in-memory React context for several feature flows, but Supabase authentication and the signed-in user profile flow are now connected to the hosted Development environment. Task 6 is actively replacing mock profile identity data with persistent Supabase profile, campus, interest, discoverability, and avatar-storage foundations.

> **Current status:** Tasks 1–5 are complete. Task 6—Persist User Profiles—is in progress on `feature/persist-user-profiles` with draft pull request #22. The Task 6 profile foundation and atomic-interest migrations are applied locally and to hosted Development. Profile RLS/storage policies have passed focused local security tests; onboarding, profile editing, discoverability, campuses, and profile-interest selection are backend-backed and persistent; the signed-in Profile tab reads real Supabase identity data; and the fresh-account auth/onboarding navigation race has been fixed and manually verified. Remaining Task 6 work includes the missing social-profile fields from the target design, avatar picker/upload/rendering, public student-profile backend migration where appropriate, deleted/stale-account recovery UX, final regression testing, Preview validation, CI/review, and merge. The app is not production-ready because courses, requests, offers, messages, notifications, moderation, production infrastructure, and release work are still outstanding.

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

## Current Project Status

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
- Task 4 Android smoke test after backend setup
- Hosted Development email/password authentication
- Auth-state subscription and session restoration
- Protected Expo Router navigation
- Sign-out integration on the Profile screen
- Email confirmation and resend flow
- Password-reset request and recovery flow
- Hosted PKCE email-confirmation callback verified end to end
- Protected-route auth transition updated so sign-in/sign-up/callback no longer manually replace `/` after session creation
- Local Mailpit-based recovery testing
- Recovery-mode protection during password-reset sessions
- Final Task 5 authenticated smoke tests
- Task 5 merged into `main`
- Task 6 profile schema migration created and applied locally
- Task 6 profile schema migration applied to hosted Development
- Shared `campuses` reference table added
- Normalized `interests` and `profile_interests` tables added
- Private `avatars` Storage bucket added with MIME and size restrictions
- Profile owner/discoverability RLS and restricted update grants added
- Local RLS/security validation for profiles, interests, and avatar Storage
- `ProfileContext` and typed profile data-access layer added
- Profile loading, missing-profile, error, and retry states added
- Backend-backed profile onboarding added and manually verified
- Onboarding completion persists across app restarts
- Signed-in Profile tab now loads real Supabase name, major, and discoverability
- Edit Profile screen added and manually verified
- Profile edits persist across app restarts
- Atomic profile-interest replacement RPC added and verified locally
- Profile-interest selection added to onboarding and Edit Profile
- Interest add/remove selections persist across hosted Development app restarts
- Onboarding interests persist and reload in Edit Profile after restart
- Fresh incomplete accounts now transition through protected routing without the previous `REPLACE "(tabs)"` warning

Current milestone:

```text
Task 6 — Persist User Profiles
```

Task 6 is partially implemented and intentionally remains unmerged. Current branch:

```text
feature/persist-user-profiles
```

Current draft pull request:

```text
#22 — wip: checkpoint Task 6 profile persistence foundation
```

Checkpoints already pushed:

```text
d1a7091 — wip: checkpoint Task 6 profile persistence foundation
28b9b39 — feat: add persistent profile onboarding and editing
```

Additional interests and auth-routing work is currently being prepared for the next Task 6 checkpoint. Do not merge pull request #22 until the remaining Task 6 profile, interests, avatar, public student-profile, testing, and environment-validation work is complete.

## Important Current Limitations

CampusClutch now has working authentication and a partially migrated persistent profile domain, but several feature flows still use mock or in-memory data.

This means:

- Newly created requests reset when the app reloads.
- Locally sent messages reset when the conversation is reopened or the app reloads.
- Offer Help state is local UI state and resets when the request details screen is reopened.
- Course membership is not persisted.
- Classmates are still derived from `mockStudents`.
- `src/app/students/[id].tsx` still uses mock student fixtures for the currently unmigrated classmate flow.
- `src/app/messages/[id].tsx` still understands mock/classmate IDs and local threads; real profile messaging is deferred to Task 10.
- Signed-in user profile identity now loads from hosted Supabase.
- Profile onboarding and profile editing now persist to hosted Development.
- Profile discoverability is persisted and enforced by RLS.
- Profile campuses are stored by shared campus reference ID.
- Interests are normalized in the database and are now editable in onboarding and Profile Settings. The replacement flow uses an atomic RPC so a failed update does not erase the previous selections.
- A private avatar Storage bucket and RLS policies exist, but the app-side picker/upload/rendering flow is not implemented yet.
- `expo-image-picker` is installed for the upcoming avatar UI.
- Avatar object paths are stored privately; the current signed-in Profile tab intentionally uses initials until authenticated avatar loading is implemented.
- Task 6 has been applied to hosted Development, but Preview validation/deployment is still pending.
- Courses, requests, offers, conversations, messages, and notifications do not yet use persistent feature tables.
- There are no real push notifications.
- There is no production reporting or moderation workflow.
- The production Supabase project and production EAS variables are not configured.

An installable EAS build and partially persistent backend do not make the app a complete production service.

## Team Working Method

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
→ open a pull request
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

## Important Development Rules

1. Use Expo Router for navigation.
2. Use `useRouter` for navigation actions.
3. Use `useLocalSearchParams` for dynamic route parameters.
4. Do not create `App.tsx`.
5. Do not add `NavigationContainer`.
6. Do not use React Navigation directly for screen routing.
7. Keep shared types in `src/types/index.ts`.
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
18. Keep pull requests small and focused.
19. Document intentional limitations before merging.
20. Do not combine EAS setup, backend work, UI redesign, and unrelated feature work in one pull request.
21. Update this README when a major task is completed.
22. Do not assume `src/app/messages/new.tsx` exists.

---

## Required Git Workflow

Start every task from an updated `main` branch:

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

## Local Quality Checks

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

Do not modify the Courses screen only to remove these warnings while working on unrelated tasks. They should be resolved when the Courses flow is migrated to persistent backend data.

---

## CI and Branch Protection

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

## Current Relevant Project Structure

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
│   │   └── 20260805042701_replace_profile_interests_atomically.sql
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

The Supabase CLI may also create ignored temporary state under `supabase/.temp/`. Do not commit that directory.

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
- Message buttons open `/messages/[id]`.

Known working flows:

```text
Courses
→ Add Course
→ search/select course
→ back to Courses
```

```text
Courses
→ Course
→ Classmates
→ Student Profile
→ Message Thread
```

Known limitation:

- Added courses are not persisted after reload.

---

## Student Profiles

`src/app/students/[id].tsx` is now a reusable student profile screen backed by `mockStudents`.

Completed behavior:

- Reads the student ID with `useLocalSearchParams`.
- Finds the matching student in shared mock data.
- Displays:
  - Avatar
  - Name
  - Program
  - Year
  - Campus
  - Shared interests
  - Shared-course or activity note
- Displays a Top Match badge when available.
- Displays an active indicator for recently active students.
- Includes a Message button.
- Opens the correct student chat.
- Handles invalid IDs with a Student Not Found screen.
- Back navigation returns to Classmates.
- The page scrolls correctly on a physical Android device.

Tested students:

- Aisha R.
- Mei L.
- Jordan T.

---

## Persisted Signed-In User Profile — Task 6 In Progress

The signed-in user's profile now uses hosted Supabase data rather than hardcoded identity values.

Implemented so far:

- `public.profiles` extended with `display_name`, `major`, `year_of_study`, `campus_id`, `avatar_path`, `is_discoverable`, onboarding, and timestamp fields.
- Shared `public.campuses` table with Burnaby, Surrey, and Vancouver campuses.
- Normalized `public.interests` catalog and `public.profile_interests` many-to-many relation.
- Private `avatars` Storage bucket with a 5 MiB limit and JPEG/PNG/WebP MIME restrictions.
- Profile owner update restrictions enforced with RLS and column-level grants.
- Signed-out profile reads denied.
- Other authenticated users can read only completed discoverable profiles.
- `ProfileContext` loads the authenticated user's profile separately from `AuthContext`.
- Root navigation distinguishes auth/profile loading, query failure, missing profile, incomplete onboarding, and completed profile states.
- Incomplete authenticated profiles are routed to `/profile/onboarding`.
- Onboarding supports display name, major, year of study, campus, interests, and discoverability.
- Completing onboarding persists `onboarding_completed_at` and survives a full app restart.
- The Profile tab now displays persisted name, major, discoverability, and initials fallback.
- `/profile/settings` edits display name, major, year, campus, interests, and discoverability.
- Profile edits update immediately and survive a full app restart.
- Loading, error, missing-profile, retry, validation, submitting, and success states are implemented for the current profile flow.
- `public.replace_my_profile_interests(uuid[])` atomically replaces the signed-in user's interest set.
- The client interest helper validates that it is updating the current authenticated profile and calls the atomic RPC.
- Explicit post-auth `router.replace("/")` calls were removed from sign-in/sign-up/callback flows so `Stack.Protected` controls whether a signed-in user lands in onboarding or the main tabs.

Focused local backend tests completed:

- Fresh Auth user creates exactly one profile row.
- New profile begins incomplete and non-discoverable.
- Owner can update approved profile fields.
- `onboarding_completed_at` is populated after valid completion.
- `updated_at` is backend-maintained.
- Protected fields such as `created_at` cannot be changed by the client.
- One authenticated user cannot update another profile.
- Private profile is hidden from other authenticated users.
- Discoverable completed profile is readable by other authenticated users.
- Anonymous profile reads are denied.
- Duplicate profile interests are rejected.
- Atomic replacement deduplicates repeated selected-interest IDs.
- Invalid/inactive-interest replacement fails without deleting the user's previous selections.
- An empty atomic replacement correctly clears all selected interests.
- Users cannot add interests to another user's profile.
- Discoverable profile interests can be read by another authenticated user.
- Owner avatar upload to the owner-scoped folder succeeds.
- Cross-user avatar upload is rejected.
- Discoverable avatar read succeeds for another authenticated user.
- Private avatar read is hidden from another authenticated user.
- Owner can read a private avatar.
- Invalid avatar MIME type is rejected.
- Avatar files above 5 MiB are rejected.
- Owner avatar deletion succeeds.
- Database constraints reject whitespace-only/oversized display names and invalid year values.
- Valid major/year/campus updates persist and normalize correctly.
- `npx supabase db reset` passes.
- `npx supabase db lint --local` reports no schema errors.
- `20260805042701_replace_profile_interests_atomically.sql` applies locally and passes schema linting.

Hosted Development validation completed:

- `20260803061327_persist_user_profiles.sql` is recorded in remote migration history.
- `20260805042701_replace_profile_interests_atomically.sql` is recorded in hosted Development migration history.
- Hosted campuses load in the Android development build.
- Existing incomplete hosted profile routes to onboarding.
- Onboarding saves and routes automatically into the normal app.
- Onboarding completion survives app restart.
- Profile edits save successfully and survive app restart.
- All 9 active interests load in Edit Profile.
- Interest additions/removals save successfully and survive full app restart.
- Fresh-account onboarding interest selections persist and reload in Edit Profile after restart.
- Fresh incomplete accounts enter onboarding without the previous unhandled `REPLACE "(tabs)"` navigation warning.

Still remaining in Task 6:

- Add the target-design social profile fields and controls: LinkedIn URL, Instagram username, `show_linkedin`, and `show_instagram`, with appropriate validation/visibility behavior.
- Add avatar picker UI using `expo-image-picker`.
- Implement authenticated private avatar upload/download rendering.
- Implement safe avatar replacement cleanup: upload new object → update `profiles.avatar_path` → delete old object only after the profile update succeeds.
- Keep initials fallback when no avatar exists or avatar loading fails.
- Migrate `/students/[id]` to backend profiles where appropriate while preserving clearly identified mock compatibility for the still-unmigrated Classmates flow.
- Keep Classmates backend migration in Task 7.
- Keep persistent messaging/direct-conversation creation in Task 10.
- Add a safe recovery action (such as Sign Out) to the `Profile unavailable` state so a locally cached session for a server-deleted account cannot trap the user.
- Complete final local/manual tests.
- Apply/validate Task 6 migration in Preview.
- Run final diff/security review.
- Pass CI/review and merge draft pull request #22.

---

## Messages Flow

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

Classmate chat routing was corrected:

- Classmate IDs are resolved against `mockStudents`.
- Aisha, Mei, and Jordan display the correct name, major, and avatar.
- New classmate chats begin with an empty thread.
- New classmate chats no longer display Marcus's mock messages.
- Existing inbox conversations still display their original mock threads.

Known limitation:

- Messages are local and in memory only.
- New classmate conversations are not added permanently to the Messages inbox.
- Messages reset after reload.

---

## Requests Feed

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
- The empty state includes:
  - Icon
  - `No requests found`
  - Explanation text
  - Create Request button
- The floating `+` button opens `/requests/create`.

---

## Create Request Flow

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

Type-specific fields:

### Delivery

- Pickup Location
- Drop-off Location

### Pickup

- Pickup Location
- Destination

### Event Help

- Event Name
- Help Needed

### Study Help

- Course or Subject
- Topic

Completed behavior:

- Campus selector supports Burnaby, Surrey, and Vancouver.
- Burnaby is the default.
- The selected campus uses red/pink styling and a checkmark.
- Web and native date selection are supported.
- Past dates are blocked.
- Points accept numeric input only.
- Letters are removed from the points input.
- Empty points are invalid.
- `0` is invalid.
- Points must be a whole number greater than zero.
- Type-specific validation is implemented.
- Invalid fields receive a red border.
- Validation clears when the user corrects a field.
- Changing request type clears stale type-specific validation.
- Rapid duplicate submissions are blocked.
- The button displays `Posting...`.
- The button then displays `Request Posted`.
- A success message appears.
- The app returns to the Requests feed after approximately one second.
- Exactly one request is created.
- Submission timeout cleanup runs on unmount.

Android form improvements:

- Deadline and Points Offered display as two aligned columns.
- The Points Offered label is positioned above the input.
- The coin icon and typed value no longer overlap.
- The points field can be cleared completely.
- `KeyboardAvoidingView` keeps lower form fields visible above the Android keyboard.
- The form can be scrolled while the keyboard is open.
- Dragging or pressing Android Back can dismiss the keyboard.
- Request submission still works after the layout changes.

---

## Request Details

Completed behavior:

- Reads request IDs with `useLocalSearchParams`.
- Finds the request through `RequestsContext`.
- Handles invalid IDs with a Request Not Found screen.
- Displays:
  - Category
  - Title
  - Description
  - Location
  - Deadline
  - Points
- Urgent requests display an urgent badge.
- Newly created requests display an Additional Details section.
- Old mock requests do not show an empty Additional Details card.
- Offer Help changes to Offer Sent.
- Offer Help becomes disabled after being pressed.
- A confirmation message appears.
- Back navigation works.

Additional Details can include:

- Campus
- Room/Location
- Pickup Location
- Drop-off Location
- Destination
- Event Name
- Help Needed
- Course/Subject
- Study Topic
- Item/Task Size
- Status
- Posted date and time

Known limitation:

- Offer Help state resets when the screen is reopened.

---

## Shared Request Data Model

Request categories include:

```ts
export type RequestCategory =
  | "ALL"
  | "DELIVERY"
  | "EVENT HELP"
  | "PICKUP"
  | "STUDY HELP";
```

Shared item size:

```ts
export type RequestItemSize =
  | "Small"
  | "Medium"
  | "Large";
```

Request status:

```ts
export type RequestStatus =
  | "open"
  | "offered"
  | "accepted"
  | "completed";
```

`CampusRequest` supports shared and type-specific optional fields.

`RequestsContext`:

- Creates a local request ID.
- Inserts the complete request at the start of the list.
- Preserves the structure needed for a later backend replacement.

Current request state remains in memory.

Reloading the app resets requests to `mockRequests`.

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

`app.json` includes:

- Expo owner
- Android package
- iOS bundle identifier
- EAS project ID

---

## EAS Build Profiles

`eas.json` includes:

### Development

```json
{
  "developmentClient": true,
  "distribution": "internal"
}
```

### Preview

```json
{
  "distribution": "internal"
}
```

The Android preview profile produces an installable APK for direct testing.

### Production

```json
{
  "autoIncrement": true
}
```

The project uses remote app version management.

No production store submission has been performed.

---

## Android Preview Builds

Completed:

- EAS successfully created the initial Android preview APK.
- EAS generated and securely managed the Android signing keystore.
- The APK installed successfully on a physical Android device.
- The app launched successfully.
- The initial build exposed several Android-specific UI and routing issues.
- Each issue was fixed in a focused branch and merged through CI.
- A fresh Android preview APK was built from the updated `main` branch.
- The updated APK installed successfully.
- The updated core-flow test was completed successfully.

Android issues fixed after the first APK test:

1. Message composer hidden by the Android keyboard.
2. Classmate Message buttons opening a generic Chat header with Marcus's thread.
3. Student profile placeholder screen.
4. Points Offered label/icon/input overlap.
5. Lower Create Request fields hidden by the Android keyboard.

A separate Android development build was also created after adding `expo-dev-client`.

Development-build validation completed:

- EAS development profile produced an installable APK.
- The APK installed on a physical Pixel device.
- The development client connected to Metro through USB and `adb reverse`.
- Android registered the `campusclutch` custom URL scheme.
- The native callback route opened from an ADB deep-link test.

No production build or store submission has been started.

---

## Physical Android Test Coverage

The updated preview APK was tested for:

- App launch
- Closing and reopening the app
- Bottom-tab navigation
- Courses
- Classmates
- Student profiles
- Student-to-chat navigation
- Existing inbox conversations
- Local message sending
- Android message keyboard behavior
- Request filters
- Request details
- Offer Help
- Create Request
- Native date picker
- Points validation
- Request-form keyboard avoidance
- Request submission
- Newly created request appearing at the top of the feed
- Expected in-memory reset after restarting the app
- Email/password sign-up and sign-in
- Sign-out from Profile
- Protected-route behavior after sign-out
- Session restoration after a full app restart
- Hosted email confirmation
- Fresh hosted PKCE callback code exchange and automatic navigation to Home
- Native `campusclutch://auth/callback` routing
- Password-reset request flow
- Native `campusclutch://auth/reset-password` routing
- Local Mailpit password-recovery flow
- Password update succeeds through Supabase Auth
- Old password is rejected after reset
- New password signs in successfully
- Session restoration after the recovery-flow changes
- Sign-out returns directly to Sign In
- Android Back does not reopen protected screens after sign-out
- Stale callback routes no longer trap the app on reload or after logout
- Authenticated regression smoke test for Courses, Requests, Messages, and Profile
- Development-client connection through USB/ADB

---


# Authentication Flow

## Implemented

- Email/password account creation through Supabase Auth.
- Email/password sign-in.
- Sign-out from the Profile screen.
- Auth-state subscription through `AuthContext`.
- Persisted sessions through AsyncStorage.
- Session restoration after fully closing and reopening the app.
- App-state-controlled Supabase token auto-refresh.
- Loading screen while the stored session is restored.
- Public sign-in, sign-up, and forgot-password routes.
- Protected application routes using Expo Router `Stack.Protected`.
- Android Back cannot reopen protected screens after sign-out.
- Email confirmation screen and resend action.
- Hosted Development redirect allow-list entries:
  - `campusclutch://auth/callback`
  - `campusclutch://auth/reset-password`
- Matching local Supabase redirect configuration.
- Mobile verification callback route:
  - `src/app/auth/callback.tsx`
- Password-recovery route:
  - `src/app/auth/reset-password.tsx`
- Supabase client configured for PKCE.
- PKCE `code` exchange for hosted email confirmation.
- Password-reset request through `resetPasswordForEmail`.
- Password update through `updateUser`.
- Recovery-mode state prevents temporary recovery sessions from opening the protected Home stack before the new password is saved.
- `PASSWORD_RECOVERY` auth events are handled in `AuthContext`.
- Stale callback-route restoration is handled so reloads, app restarts, and sign-out do not leave the user on an invalid verification screen.
- `expo-dev-client` added for stable native-scheme testing.
- Android development APK built, installed, and connected to Metro over USB/ADB.
- Local Supabase and Mailpit used to test password recovery without consuming the hosted auth-email quota.
- Minimal `public.profiles` table linked one-to-one with `auth.users`.
- Automatic profile-row creation through an auth-user trigger.
- Row Level Security enabled with owner-only authenticated reads.
- Anonymous access revoked.

## Manually verified

- Hosted Development account creation.
- Hosted PKCE email confirmation opens CampusClutch and routes automatically through protected navigation to the appropriate profile state.
- A corresponding `public.profiles` row is automatically created with the same UUID as the Auth user.
- Existing confirmed-account sign-in opens the application.
- Sign-out returns directly to Sign In.
- Android Back exits instead of restoring a protected screen.
- A stored authenticated session restores directly to Home after fully closing and reopening the app.
- Reloading or reopening a stale callback route no longer traps the user on `Verifying your email`.
- Hosted reset-request email delivery works.
- Local Supabase/Mailpit password recovery opens the native reset route.
- A new password can be saved through Supabase Auth.
- The old password is rejected after reset.
- The new password signs in successfully.
- Recovery completion routes to Home.
- Courses, Requests, Messages, and Profile still load after authentication changes.
- Android recognizes the `campusclutch` custom URL scheme.
- Development-client testing works over USB with ADB port reversal.

## Task 5 completion status

Task 5 is complete and merged into `main`.

The final authentication branch passed manual acceptance checks and was merged through pull request #21. Authentication remains the foundation for the active Task 6 profile work.

# Completed Roadmap Tasks

## Task 1 — Configure Expo EAS

**Status: Complete**

Completed:

- Verified the Expo account.
- Confirmed permanent Android and iOS identifiers.
- Added identifiers to `app.json`.
- Linked the local project to Expo.
- Added the EAS project ID.
- Generated `eas.json`.
- Added development, preview, and production profiles.
- Confirmed no secrets or unwanted files were generated.
- Ran local checks.
- Opened a pull request.
- Passed CI.
- Merged the configuration.
- Synchronized local `main`.

---

## Task 2 — Create and Test an Android Preview Build

**Status: Complete**

Completed:

- Confirmed the preview profile produces an APK.
- Created an Android preview build.
- Installed the APK on a physical Android phone.
- Tested the main user flows.
- Fixed Android-specific issues through focused branches.
- Passed local checks and CI for each fix.
- Rebuilt the preview APK from updated `main`.
- Completed final physical-device testing.

---

# Ordered Waterfall Roadmap

Do not begin a later task before the current task has:

- Completed implementation
- Passed manual testing
- Passed `npm run check`
- Passed `git diff --check`
- Passed GitHub CI
- Been reviewed and merged
- Been documented here

---

# Task 3 — Define Backend Architecture

**Status: Complete**

Completed:

- Compared suitable backend platforms.
- Selected Supabase as the backend.
- Documented the high-level architecture.
- Defined authentication and session requirements.
- Defined profile, course, membership, request, offer, conversation, message, notification, and storage strategies.
- Defined Row Level Security and authorization direction.
- Defined local, development, preview, and production environment separation.
- Defined migration order from mock data.
- Defined loading, error, retry, offline, testing, and security expectations.
- Defined the Task 4–17 implementation roadmap.
- Reviewed and merged the architecture through pull request #14.

Architecture document:

```text
docs/backend-plan.md
```

Completion condition: Met.

No feature data was migrated during this task.

# Task 4 — Add Backend Project and Environment Setup

**Status: Complete**

Completed:

- Initialized the local Supabase project structure.
- Added the Supabase CLI as a development dependency.
- Added the Supabase JavaScript client.
- Added React Native AsyncStorage and URL polyfill support.
- Added `.env.example` with public placeholders only.
- Confirmed real environment files are ignored.
- Added typed public configuration in `src/lib/env.ts`.
- Added the reusable Supabase client in `src/lib/supabase.ts`.
- Configured local Supabase through Docker Desktop.
- Created the hosted `CampusClutch Development` project.
- Created the hosted `CampusClutch Preview` project.
- Kept the repository linked to Development.
- Configured separate EAS Development and Preview variables.
- Added explicit EAS environment mapping.
- Added backend setup documentation.
- Verified local API and Studio access.
- Verified no credentials were committed.
- Passed local lint and type checking.
- Passed GitHub CI.
- Completed an Android smoke test.
- Merged pull request #15 into `main`.

Setup guide:

[`docs/backend-setup.md`](docs/backend-setup.md)

Current boundary:

- No application tables or feature migrations exist yet.
- No production Supabase project exists yet.
- Existing feature screens still use mock and in-memory data.

Completion condition: Met.

# Task 5 — Add Authentication

**Status: Complete**

Completed:

- Added `expo-dev-client` and tested an Android EAS development build.
- Added `AuthContext` with session restoration, auth-state subscription, token auto-refresh, sign-up, sign-in, email resend, password reset, password update, recovery state, and sign-out.
- Configured the Supabase client for AsyncStorage persistence, PKCE, `processLock`, and automatic token refresh.
- Added Sign In, Create Account, Forgot Password, verification callback, and reset-password routes.
- Added protected Expo Router navigation with `Stack.Protected`.
- Added hosted/local mobile redirects for auth callback and password recovery.
- Added PKCE email-confirmation handling, recovery-session protection, and stale callback-route handling.
- Added `20260729074002_add_auth_profiles.sql` with one-to-one Auth profile initialization and RLS foundation.
- Applied and verified the migration locally and in hosted Development.
- Verified hosted sign-up/sign-in/sign-out/session restoration and hosted PKCE email confirmation.
- Verified local Mailpit password recovery and password update.
- Verified Android Back cannot reopen protected screens after sign-out.
- Verified authenticated Courses, Requests, Messages, and Profile smoke tests.
- Passed local quality checks and GitHub CI.
- Merged the final authentication work into `main` through pull request #21.

Completion condition: Met.

# Task 6 — Persist User Profiles

**Status: In progress**

Current branch:

```text
feature/persist-user-profiles
```

Current pull request:

```text
#22 — Draft
```

Checkpoint already pushed:

```text
d1a7091 — wip: checkpoint Task 6 profile persistence foundation
```

Completed so far:

- Added `expo-image-picker` dependency for the upcoming avatar UI.
- Added typed profile/campus/interest models.
- Added `20260803061327_persist_user_profiles.sql`.
- Added `20260805042701_replace_profile_interests_atomically.sql`.
- Added shared campus reference data.
- Extended `public.profiles`.
- Added normalized interests and profile-interest relationships.
- Added private avatar Storage bucket and RLS.
- Added profile/discoverability RLS and restricted update grants.
- Passed local migration reset/schema linting and focused profile/interest/avatar security tests.
- Applied the migration to hosted Development and confirmed local/remote migration history sync.
- Added `src/lib/profiles.ts` as the typed Supabase profile data-access boundary.
- Added `ProfileContext`.
- Added profile loading, retry, error, missing-profile, and completion routing states.
- Added `/profile/onboarding` and verified hosted Development onboarding on Android.
- Verified onboarding completion survives app restart.
- Migrated the signed-in Profile tab identity away from hardcoded profile data.
- Added initials avatar fallback.
- Added `/profile/settings`.
- Verified profile editing and discoverability updates.
- Verified edited profile values survive app restart.
- Replaced the fragile delete-then-insert interest update with an authenticated atomic PostgreSQL RPC.
- Verified atomic interest replacement, duplicate-ID handling, invalid-ID rollback, and clearing all interests locally.
- Applied and verified the atomic-interest migration in hosted Development.
- Added active-interest loading and selection UI to onboarding and Edit Profile.
- Verified interest add/remove persistence and full-restart persistence in hosted Development.
- Verified onboarding interests persist after completing onboarding and reloading the app.
- Fixed the fresh-account auth navigation race by relying on `Stack.Protected` instead of explicit post-auth root replacements.
- Verified the previous unhandled `REPLACE "(tabs)"` warning is gone.
- Preserved mock points/activity because they belong to later roadmap work.

Remaining:

- Add LinkedIn/Instagram profile fields and per-field visibility controls from the target onboarding design.
- Add avatar picker/upload/download/rendering flow.
- Add safe avatar replacement/orphan cleanup behavior.
- Add avatar loading/failure fallback behavior.
- Migrate public student profile loading to backend data where appropriate.
- Preserve explicit mock compatibility for Classmates until Task 7.
- Keep direct-message persistence for Task 10.
- Add a Sign Out/recovery path to the missing-profile state for stale sessions after a server-side account deletion.
- Complete final Task 6 manual/regression tests.
- Apply/validate the migration in Preview.
- Run final `npm run check`, `git diff --check`, and staged review.
- Push remaining branch work.
- Pass GitHub CI/review.
- Merge draft pull request #22 only after Task 6 is complete.

Current expected local check:

```text
0 errors
2 existing Courses warnings
```

Completion condition:

- Profile data loads from the backend.
- Profile changes persist.
- Interests and avatars work securely.
- Discoverability is enforced.
- Public student profile screens use backend data where appropriate without breaking unmigrated flows.
- Loading, error, retry, validation, and fallback states are covered.
- Development and Preview backend migrations are validated.
- Manual tests, local checks, CI, review, and merge pass.

---

# Task 7 — Persist Courses and Course Membership

Start only after profiles are complete.

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
- Load requests from the backend.
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
- Add edit/delete rules for the owner.

Completion condition:

- Requests survive app reload.
- Multiple users can see appropriate requests.
- Request ownership is enforced.
- Existing request UX remains functional.

---

# Task 9 — Implement the Real Offer Help Workflow

Start only after requests are persisted.

Requirements:

- Create request-offer records.
- Prevent duplicate active offers.
- Store the offering user.
- Store the request ID.
- Add offer status:
  - pending
  - accepted
  - rejected
  - withdrawn
- Notify the request owner.
- Allow the owner to accept or reject.
- Update request status.
- Replace local Offer Help state with backend state.
- Define what happens when an offer is accepted.

Completion condition:

- Offer state persists.
- The request owner can manage offers.
- Unauthorized users cannot manage another user's offers.
- Duplicate offers are prevented.

---

# Task 10 — Persist Conversations and Messages

Start only after the offer workflow is complete.

Requirements:

- Persist one-to-one conversations.
- Persist group conversations.
- Store conversation members.
- Store message sender.
- Store message timestamps.
- Add message loading state.
- Add send failure state.
- Add read/unread design.
- Prevent unauthorized conversation access.
- Connect accepted request offers to a conversation.
- Decide whether `/messages/new` should be added.
- Verify the current folder structure before adding that route.

Completion condition:

- Messages survive reload.
- Conversation access is secure.
- Accepted requests can lead to messaging.

---

# Task 11 — Implement Notifications

Start only after messages are persisted.

Possible notification events:

- Someone offered help.
- An offer was accepted.
- An offer was rejected.
- A new message arrived.
- A request deadline is approaching.
- A classmate joined a course.
- A request was completed.

Requirements:

- Persist notification records.
- Load unread count.
- Mark notifications as read.
- Open the relevant screen.
- Add empty state.
- Add loading state.
- Add error state.

Completion condition:

- Notifications reflect real backend events.
- Notification navigation works.
- Unread state persists.

---

# Task 12 — Add Automated Tests

Start only after the main backend flows are stable.

Recommended order:

## Unit tests

- Request validation
- Request filtering
- Date formatting
- Request type mapping
- Permission helpers

## Component tests

- Create Request validation
- Empty request state
- Request Details
- Offer state
- Authentication forms
- Message sending states
- Student Profile states

## End-to-end tests

- Sign up/sign in
- Add course
- Open classmate profile
- Create request
- Offer help
- Accept offer
- Open conversation
- Send message
- View notification

Completion condition:

- Test tools are documented.
- Tests run in CI.
- Critical user flows have coverage.

---

# Task 13 — Accessibility and UI Quality Audit

Start only after automated tests are in place.

Audit:

- Screen-reader labels
- Focus order
- Keyboard navigation on web
- Touch target sizes
- Font scaling
- Color contrast
- Loading states
- Empty states
- Error states
- Disabled states
- Web shadow warnings
- Web pointer-events warnings
- Route-transition focus warnings
- Android back behavior
- Small-screen layouts
- Keyboard avoidance
- Form scrolling on mobile

Completion condition:

- Accessibility issues are documented and fixed.
- No major usability blockers remain.

---

# Task 14 — Privacy, Safety, and Moderation

Start only after the main product flows are stable.

Define:

- Privacy policy
- Terms of use
- Data retention
- Account deletion
- User blocking
- User reporting
- Request reporting
- Message reporting
- Content moderation
- Abuse handling
- Safety notices
- Contact process
- Minimum required personal data

Completion condition:

- Policies exist.
- Account deletion behavior exists.
- Reporting and blocking decisions are implemented or explicitly deferred.

---

# Task 15 — Production Release Preparation

Start only after privacy and moderation work is complete.

Requirements:

- Final app icon review
- Final splash screen review
- Android version code
- iOS build number
- Production EAS profile review
- Production environment configuration
- Store descriptions
- Store screenshots
- Privacy policy URL
- Support URL
- Google Play Console setup
- Apple Developer setup
- App Store Connect setup
- Production Android build
- Production iOS build
- Internal store testing

Completion condition:

- Production binaries are generated.
- Store metadata is complete.
- Internal testing is successful.

---

# Task 16 — Store Submission

Start only after production preparation is approved.

Requirements:

- Submit the Android build.
- Submit the iOS build.
- Answer store privacy questions.
- Resolve review feedback.
- Track the release version.
- Document a rollback plan.
- Confirm the support contact.

Completion condition:

- The app is approved or store feedback is actively being handled.
- Release documentation is complete.

---

# Task 17 — Post-Release Operations

Start only after release.

Possible work:

- Crash reporting
- Analytics
- Performance monitoring
- User feedback
- Bug triage
- Security review
- Database backups
- Incident response
- EAS Update strategy
- Release cadence
- Dependency updates
- Regression testing

---

# Repository and Release Notes

- Repository license: Apache License 2.0
- Repository visibility: Public
- GitHub Actions CI: Active
- Protected `main`: Active
- EAS project: Linked
- Android preview APK: Built and tested
- Backend decision: Supabase
- Backend architecture: Approved and documented
- Local Supabase: Initialized and tested
- Hosted Development project: Created and linked
- Hosted Preview project: Created
- EAS Development variables: Configured
- EAS Preview variables: Configured
- Production Supabase project: Not created
- Production EAS variables: Not configured
- Application database schema: Auth foundation plus Task 6 profiles/campuses/interests/avatar-storage migration and atomic-interest RPC migration applied to Development
- Authentication: Task 5 complete and merged
- User profiles: Task 6 in progress; onboarding, signed-in profile editing, campuses, discoverability, and profile interests are persistent in hosted Development
- Task 6 pull request: #22 open as Draft
- Production Android build: Not started
- Production iOS build: Not started
- Google Play submission: Not started
- App Store submission: Not started

No secrets, private keys, database passwords, store credentials, or real environment files should be committed.

# Current Production Limitations

CampusClutch still needs:

- Completion and merge of Task 6 profile persistence
- LinkedIn/Instagram profile fields and per-field visibility controls
- Avatar picker/upload/rendering integration
- Public student-profile backend migration where appropriate
- Task 6 Preview validation
- Production-ready authentication email delivery/SMTP strategy
- Persistent course storage and memberships
- Persistent request storage
- Real request offers
- Persistent conversations and messages
- Real notifications
- Production Supabase and EAS environments
- Privacy policy
- Content moderation and reporting
- Account deletion
- Error reporting
- Automated tests beyond lint/typecheck
- Production store setup

# Next Action

Continue only:

```text
Task 6 — Persist User Profiles
```

Current branch:

```text
feature/persist-user-profiles
```

Current draft pull request:

```text
#22
```

Immediate next steps:

1. Include this README update in the next Task 6 checkpoint.
2. Continue on `feature/persist-user-profiles`; do not merge the draft PR yet.
3. Add LinkedIn URL, Instagram username, and their per-field visibility controls from the target profile design, including backend validation/RLS-safe updates.
4. Add a Sign Out/recovery action to the missing-profile state for stale sessions after server-side account deletion.
5. Implement the avatar picker using the installed `expo-image-picker` dependency.
6. Implement private avatar upload/rendering with owner-scoped paths and initials fallback.
7. Use safe avatar replacement order: upload new object → update `avatar_path` → delete old object only after the database update succeeds; clean up the new orphan if the database update fails where practical.
8. Migrate `/students/[id]` to backend profile data where appropriate while preserving explicit mock compatibility for the still-unmigrated Classmates flow.
9. Keep Courses/Classmates persistence for Task 7 and Messages persistence for Task 10.
10. Run the remaining Task 6 local/manual regression tests.
11. Apply and validate all Task 6 migrations in Preview.
12. Run `npm run check`, `git diff --check`, and staged diff review.
13. Push the completed Task 6 branch.
14. Wait for GitHub CI and review.
15. Convert/merge pull request #22 only after Task 6 is complete.
16. Update local `main`, delete the feature branch, and mark Task 6 complete in this README.

Do not begin Task 7 until Task 6 has passed final testing, CI, review, and merge.
