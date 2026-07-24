# CampusClutch

CampusClutch is an Expo React Native mobile app for university students to connect through courses, classmates, student profiles, campus help requests, direct messages, group conversations, notifications, and user profiles.

The app currently uses mock data and in-memory React context while the main user flows, build configuration, and release workflow are being developed.

> **Current status:** The app can be built as an installable Android preview APK through Expo EAS. Core flows have been tested on a physical Android device. CampusClutch is not yet production-ready because it does not have a backend, authentication, permanent storage, authorization, moderation, or production privacy infrastructure.

---

## Current Tech Stack

- Expo SDK 54
- React Native
- TypeScript
- Expo Router
- React 19
- React Native Web
- React Native Reanimated
- React Native Safe Area Context
- React Native Community DateTimePicker
- Expo Vector Icons
- Mock data
- In-memory React context
- Expo Application Services (EAS)
- GitHub Actions CI
- Apache License 2.0
- Node 22
- npm
- Windows and PowerShell development environment

---

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

Next major milestone:

```text
Task 3 — Define Backend Architecture
```

The backend must be planned before adding a backend SDK or replacing mock data.

---

## Important Current Limitations

CampusClutch still uses mock and in-memory data.

This means:

- Newly created requests reset when the app reloads.
- Locally sent messages reset when the conversation is reopened or the app reloads.
- Offer Help state is local UI state and resets when the request details screen is reopened.
- Course membership is not persisted.
- Student profiles are loaded from shared mock data.
- There are no real user accounts.
- There is no authentication or authorization.
- There is no permanent database.
- There are no backend security rules.
- There are no real push notifications.
- There is no production reporting or moderation workflow.

An installable EAS build does not make the app a complete production service.

---

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
├── src/
│   ├── app/
│   │   ├── (tabs)/
│   │   │   ├── _layout.tsx
│   │   │   ├── courses.tsx
│   │   │   ├── index.tsx
│   │   │   ├── messages.tsx
│   │   │   ├── profile.tsx
│   │   │   └── requests.tsx
│   │   ├── courses/
│   │   │   ├── add.tsx
│   │   │   └── classmates.tsx
│   │   ├── messages/
│   │   │   └── [id].tsx
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
│   │   └── RequestsContext.tsx
│   └── types/
│       └── index.ts
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

Verify the current folder structure before adding a new route.

In particular, do not assume this file exists:

```text
src/app/messages/new.tsx
```

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

---

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

**Status: Next**

Do not immediately install a backend SDK.

First create:

```text
docs/backend-plan.md
```

The plan should compare suitable backend options, such as:

- Supabase
- Firebase

The team must select one backend before implementation begins.

The architecture plan must define:

- Authentication approach
- University-email verification decision
- Users table
- Public profiles table
- Courses table
- Course memberships
- Requests table
- Request offers table
- Conversations table
- Conversation members
- Messages table
- Notifications table
- Ownership rules
- Authorization rules
- Row-level security or equivalent
- Environment variable strategy
- Local development setup
- Migration path from mock data
- Loading-state expectations
- Error-state expectations
- Offline and retry expectations
- File/avatar storage strategy
- Account deletion approach
- Reporting and blocking requirements
- Development, preview, and production environments

Recommended branch:

```powershell
git switch main
git pull origin main
git switch -c docs/backend-architecture
```

Completion condition:

- `docs/backend-plan.md` is reviewed.
- The team agrees on the backend.
- The initial schema is documented.
- The security model is documented.
- The migration path from mock data is documented.
- No backend implementation starts before approval.

---

# Task 4 — Add Backend Project and Environment Setup

Start only after Task 3 is approved.

Requirements:

1. Create the backend project.
2. Add only public client configuration to the app.
3. Store secrets correctly.
4. Add `.env.example`.
5. Confirm real `.env` files are ignored.
6. Document setup instructions.
7. Verify the app starts without committed secrets.
8. Add a typed backend client module.
9. Add connection-error handling.
10. Run CI and merge.

Do not implement every feature in this task.

Completion condition:

- Backend connection exists.
- Environment setup is documented.
- No secrets are committed.
- The app still passes CI.

---

# Task 5 — Add Authentication

Start only after backend setup is merged.

Requirements:

- Sign up
- Sign in
- Sign out
- Session restoration
- Loading state
- Authentication error messages
- Protected app routes
- User profile initialization
- Secure token handling
- University-email verification based on the Task 3 decision

Completion condition:

- A user can create an account.
- A user can sign in and sign out.
- Session restoration works.
- Protected routes cannot be opened without authentication.
- Tests and CI pass.

---

# Task 6 — Persist User Profiles

Start only after authentication is complete.

Requirements:

- Profile belongs to authenticated user.
- Name
- Major
- Year
- Campus
- Avatar strategy
- Interests
- Profile editing
- Loading state
- Error state
- Safe validation
- Public versus private profile fields

Completion condition:

- Profile data loads from the backend.
- Profile changes persist.
- Student profile screens use backend data where appropriate.

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
- Production Android build: Not started
- Production iOS build: Not started
- Google Play submission: Not started
- App Store submission: Not started

No secrets, private keys, store credentials, or production environment files should be committed.

---

# Current Production Limitations

CampusClutch still needs:

- Backend architecture approval
- Real backend
- Authentication
- Authorization
- Permanent request storage
- Permanent course storage
- Permanent message storage
- Real notifications
- User ownership
- Secure environment configuration
- Privacy policy
- Content moderation and reporting
- Account deletion
- Error reporting
- Automated tests beyond lint/typecheck
- Production store setup

---

# Next Action

Start only:

```text
Task 3 — Define Backend Architecture
```

Recommended first commands:

```powershell
git switch main
git pull origin main
git switch -c docs/backend-architecture
git status
```

Then create:

```text
docs/backend-plan.md
```

Do not install Supabase, Firebase, or another backend SDK until the architecture plan has been reviewed and approved.
