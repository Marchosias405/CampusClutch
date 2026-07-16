# CampusClutch — Team Next Steps

CampusClutch is an Expo React Native app for university students to connect through courses, classmates, campus requests, messages, notifications, and profiles.

This file is a project handoff and ordered roadmap for the team. It explains what is complete, what must happen next, and the exact workflow to follow.

The team currently has three people, but only two are pushing code. No tasks are permanently assigned. Work should follow a waterfall-style sequence: finish, test, review, merge, and document one task before starting the next.

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
- Mock data and in-memory React context
- GitHub Actions CI
- Apache License 2.0

The app currently uses mock data. It does not yet have a production backend, authentication system, or permanent database.

---

## Team Working Method

CampusClutch will use a waterfall-style development process.

Each task must be completed before the next one begins.

Required order:

```text
Choose one task
→ create a branch
→ inspect the current code
→ implement only that task
→ test locally
→ run quality checks
→ open a pull request
→ wait for CI
→ review
→ merge
→ update local main
→ document completion
→ start the next task
```

Do not work on later roadmap items while an earlier item is still incomplete unless the team explicitly decides to change the order.

Because only two people currently push code:

- Either developer may take the next task.
- The third teammate can review, test, document, or prepare plans.
- No permanent task ownership is assumed.
- The team should decide who handles each task immediately before starting it.
- Avoid two people editing the same files at the same time.
- Do not create parallel branches for roadmap items that depend on unfinished earlier work.

---

## Important Development Rules

Follow these rules before changing the project:

1. Use Expo Router for navigation.
2. Use `useRouter` for navigation actions.
3. Use `useLocalSearchParams` for dynamic route parameters.
4. Do not create `App.tsx`.
5. Do not add `NavigationContainer`.
6. Do not use React Navigation directly for screen routing.
7. Keep shared types in `src/types/index.ts`.
8. Keep shared mock data in `src/constants/mockData.ts`.
9. Do not rewrite unrelated screens.
10. Keep the existing red and white CampusClutch design.
11. Work on one focused task at a time.
12. Test the task before starting another one.
13. Do not push feature work directly to `main`.
14. Use a branch, pull request, passing CI, and merge workflow.
15. Ask for the latest file contents before making a large edit if the current implementation is uncertain.
16. Use PowerShell-compatible commands.
17. Keep pull requests small and focused.
18. Document any intentional limitation before merging.
19. Do not combine EAS setup, backend work, UI redesign, and feature work in one pull request.
20. Update this roadmap whenever a major task is completed.

---

## Required Git Workflow

Use this workflow for every task:

```powershell
git switch main
git pull origin main
git switch -c <branch-name>
```

After making changes:

```powershell
npm run check
git diff --check
git status
```

Then:

```powershell
git add .
git commit -m "<type>: describe the change"
git push -u origin <branch-name>
```

After the pull request is merged:

```powershell
git switch main
git pull origin main
git branch -d <branch-name>
git status
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

The expected current result is:

```text
0 errors
2 warnings
```

The two existing warnings are in:

```text
src/app/(tabs)/courses.tsx
```

They are `useMemo` dependency warnings involving `matchesQuery`.

Do not modify the Courses screen only to remove these warnings while working on unrelated tasks.

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

The required GitHub check is:

```text
CI / Lint and typecheck
```

The `main` branch is protected.

Current rules include:

- Pull requests are required.
- CI must pass.
- Branches must be up to date before merging.
- Force pushes are blocked.
- Branch deletion is restricted.
- Open review conversations must be resolved.
- Direct feature pushes to `main` should not be used.

---

## Current Relevant Project Structure

```text
src/
├── app/
│   ├── (tabs)/
│   │   ├── _layout.tsx
│   │   ├── courses.tsx
│   │   ├── index.tsx
│   │   ├── messages.tsx
│   │   ├── profile.tsx
│   │   └── requests.tsx
│   ├── courses/
│   │   ├── add.tsx
│   │   └── classmates.tsx
│   ├── messages/
│   │   └── [id].tsx
│   ├── requests/
│   │   ├── [id].tsx
│   │   └── create.tsx
│   ├── students/
│   │   └── [id].tsx
│   ├── _layout.tsx
│   └── notifications.tsx
├── assets/
├── components/
├── constants/
│   └── mockData.ts
├── context/
│   └── RequestsContext.tsx
└── types/
    └── index.ts
```

Do not assume `src/app/messages/new.tsx` exists. Verify the current folder structure before adding or routing to that screen.

---

# Completed Features

## Courses Flow

Completed behavior:

- `+ Add Course` opens `/courses/add`.
- Course cards open `/courses/classmates`.
- The selected course is passed through `courseId`.
- Course search works.
- Course cards are selectable.
- Selected cards use red/pink styling.
- Classmates are loaded from mock data.
- Student cards open `/students/[id]`.
- Student profile Message buttons open `/messages/[id]`.

Known working flow:

```text
Courses
→ Add Course
→ select/search course
→ back to Courses
```

and:

```text
Courses
→ Course
→ Classmates
→ Student Profile
→ Message Thread
```

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

Known working flow:

```text
Messages
→ Conversation
→ Send local message
→ Back to Messages
```

Messages are still local/mock only.

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
- Offer Help buttons open request details.
- Nested button presses use `event.stopPropagation()`.
- Back navigation requires only one press.
- New requests are added to the top of the feed.
- An empty state appears when a filter has no matching requests.
- The empty state includes a Create Request button.
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
- Web and native date selection are supported.
- Past dates are blocked.
- Points accept numeric input only.
- Points must be a whole number greater than zero.
- Type-specific validation is implemented.
- Invalid fields receive a red border.
- Validation clears when the user corrects a field.
- Rapid double submission is blocked.
- The button shows `Posting...`.
- The button then shows `Request Posted`.
- A success message appears.
- The app returns to the Requests feed.
- Exactly one request is created.

---

## Request Details

Completed behavior:

- Reads request IDs with `useLocalSearchParams`.
- Finds the request through `RequestsContext`.
- Handles invalid IDs with a Request Not Found screen.
- Displays request category, title, description, location, deadline, and points.
- Urgent requests display an urgent badge.
- Newly created requests display an Additional Details section.
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

Old mock requests do not display an empty Additional Details section.

---

## Shared Request Data Model

The shared request type supports:

```ts
export type RequestItemSize =
  | "Small"
  | "Medium"
  | "Large";

export type RequestStatus =
  | "open"
  | "offered"
  | "accepted"
  | "completed";
```

`CampusRequest` includes optional detailed fields for all request types.

`RequestsContext` creates IDs and inserts new requests at the start of the list.

Current request state is in memory only.

Reloading the app resets requests to `mockRequests`.

---

# Ordered Waterfall Roadmap

The tasks below must be completed in order.

Do not move to the next numbered task until the current task has:

- Completed implementation
- Passed manual testing
- Passed `npm run check`
- Passed `git diff --check`
- Passed GitHub CI
- Been reviewed and merged
- Been documented here

---

# Task 1 — Configure Expo EAS

This is the next task.

Create a branch:

```powershell
git switch main
git pull origin main
git switch -c chore/configure-eas
```

Before changing files:

```powershell
git status
Test-Path .\eas.json
Select-String -Path .\app.json -Pattern '"package"', '"bundleIdentifier"', '"projectId"'
npx eas-cli@latest whoami
```

Do not run `eas build:configure` until the output is reviewed.

The proposed permanent identifiers are:

```text
Android package:
com.marchosias405.campusclutch

iOS bundle identifier:
com.marchosias405.campusclutch
```

The team must confirm these before adding them.

Task 1 must include:

1. Verify the Expo account.
2. Confirm Android and iOS identifiers.
3. Add identifiers to `app.json`.
4. Link the project to Expo/EAS.
5. Generate `eas.json`.
6. Configure development, preview, and production profiles.
7. Confirm no secrets or unwanted files were generated.
8. Run local checks.
9. Open a pull request.
10. Wait for CI.
11. Merge.
12. Sync local `main`.

Completion condition:

- `app.json` contains confirmed identifiers.
- The Expo project is linked.
- `eas.json` is committed.
- CI passes.
- Configuration is merged to `main`.

---

# Task 2 — Create and Test an Android Preview Build

Start only after Task 1 is merged.

Create a new branch if any configuration changes are needed.

Goals:

1. Confirm the preview profile creates an APK suitable for direct installation.
2. Run the EAS Android preview build.
3. Download and install the APK on an Android device.
4. Test navigation and major flows.
5. Document build URL, build profile, version, and test result.
6. Fix build-only issues through a focused branch and pull request.

Minimum Android preview test:

```text
Launch app
→ open Courses
→ open Classmates
→ open Student Profile
→ open Message Thread
→ open Requests
→ create each request type
→ open Request Details
→ use Offer Help
→ verify back navigation
```

Completion condition:

- An installable Android preview build exists.
- The APK installs successfully.
- Core flows work on a physical Android device.
- Any required fixes are merged.

---

# Task 3 — Define Backend Architecture

Start only after the Android preview build is working.

Do not immediately add a backend SDK.

First create:

```text
docs/backend-plan.md
```

The plan must compare suitable options, such as Supabase and Firebase, and choose one.

The plan must define:

- Authentication approach
- Users table
- Profiles table
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
- Error and loading-state expectations

Completion condition:

- The architecture document is reviewed.
- The team agrees on the backend.
- The schema and security model are documented.
- No backend implementation starts before approval.

---

# Task 4 — Add Backend Project and Environment Setup

Start only after Task 3 is approved.

This task should:

1. Create the backend project.
2. Add only public client configuration to the app.
3. Store secrets correctly.
4. Add `.env.example`.
5. Confirm real `.env` files are ignored.
6. Document setup instructions.
7. Verify the app still starts without committed secrets.
8. Add a typed backend client module.
9. Add connection-error handling.
10. Run CI and merge.

Do not implement every feature in this task.

Completion condition:

- Backend connection exists.
- Environment setup is documented.
- No secrets are committed.
- App still passes CI.

---

# Task 5 — Add Authentication

Start only after backend setup is merged.

Authentication requirements:

- Sign up
- Sign in
- Sign out
- Session restoration
- Loading state
- Authentication error messages
- Protected app routes
- User profile initialization
- Secure token handling

Decide whether university-email verification is required before implementation.

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
- Load classmates from actual course memberships.
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
- Store offering user.
- Store request ID.
- Add offer status:
  - pending
  - accepted
  - rejected
  - withdrawn
- Notify the request owner.
- Allow owner to accept or reject.
- Update request status.
- Replace local `offerSent` state with backend state.
- Define what happens when an offer is accepted.

Completion condition:

- Offer state persists.
- Request owner can manage offers.
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
- Verify the current folder structure before adding the route.

Completion condition:

- Messages survive reload.
- Conversation access is secure.
- Accepted requests can lead to messaging.

---

# Task 11 — Implement Notifications

Start only after messages are persisted.

Notification events may include:

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
- Mark as read.
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
- Type mapping
- Permission helpers

## Component tests

- Create Request validation
- Empty request state
- Request Details
- Offer state
- Authentication forms
- Message sending states

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

- App icon final review
- Splash screen final review
- Android version code
- iOS build number
- Production EAS profile
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

- Submit Android build.
- Submit iOS build.
- Answer store privacy questions.
- Resolve review feedback.
- Track release version.
- Document rollback plan.
- Confirm support contact.

Completion condition:

- App is approved or release feedback is being handled.
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




# Current Production Limitations

CampusClutch still needs:

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
- Content moderation/reporting
- Account deletion
- Error reporting
- Automated tests beyond lint/typecheck

EAS can create an installable build, but an installable build alone does not make the app a complete production service.

---

# Next Action

Start only:

```text
Task 1 — Configure Expo EAS
```

Before editing files, run:

```powershell
git status
Test-Path .\eas.json
Select-String -Path .\app.json -Pattern '"package"', '"bundleIdentifier"', '"projectId"'
npx eas-cli@latest whoami
```

Review the output before running:

```powershell
eas build:configure
```

Do not begin Task 2 until Task 1 is merged and documented.