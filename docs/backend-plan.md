# CampusClutch Backend Architecture Plan

**Status:** Ready for review
**Selected backend:** Supabase
**Current task:** Task 3 — Define Backend Architecture
**Implementation status:** Architecture complete; backend implementation not started

## 1. Purpose

This document defines the planned backend architecture for CampusClutch before any backend SDK, hosted project, database schema, authentication flow, or production service is added.

The plan is intended to:

- Replace mock and in-memory data gradually.
- Preserve the existing Expo Router navigation and CampusClutch UI.
- Keep the application buildable during each migration stage.
- Define data ownership and authorization before implementing features.
- Avoid one large backend pull request.
- Create a reviewable roadmap for authentication, profiles, courses, requests, offers, conversations, messages, notifications, storage, security, environments, and testing.

## 2. Current Application State

CampusClutch currently uses shared mock data and in-memory React state.

The application already includes working UI flows for:

- Courses and classmates
- Student profiles
- Request creation and request details
- Request filtering
- Offer Help local state
- Direct and group message screens
- Local message sending
- Notifications UI
- User profiles
- Android preview builds through EAS

Current data does not persist reliably after an application reload or restart.

The application does not yet have:

- Real user accounts
- Authentication or session restoration
- Backend authorization
- Permanent database storage
- Persistent course memberships
- Persistent requests or request offers
- Persistent conversations or messages
- Persistent notifications
- File or avatar storage policies
- Backend security rules
- Development, preview, and production backend environments

An installable EAS build does not make the application production-ready.

## 3. Product and Architecture Goals

The backend architecture must satisfy the following goals.

### 3.1 Gradual migration

- Replace one mock-data domain at a time.
- Keep unaffected screens using their existing data source until their migration task begins.
- Keep the application buildable and testable after each pull request.
- Do not remove mock data until the replacement flow has been tested.
- Avoid combining authentication, profiles, courses, requests, messaging, and notifications into one change.

### 3.2 Preserve the current application

- Preserve the existing Expo Router routes where practical.
- Preserve the current red-and-white visual design.
- Preserve existing Android keyboard and layout fixes.
- Avoid unnecessary changes to screen structure.
- Do not introduce `App.tsx`, `NavigationContainer`, or direct React Navigation screen routing.
- Keep shared application types in `src/types/index.ts` unless a later reviewed architecture decision changes this.

### 3.3 Typed data access

- Use TypeScript types for backend records and application-facing models.
- Create a clear data-access boundary between screens and Supabase.
- Avoid placing unrelated database queries directly throughout screen components.
- Keep UI models understandable even when database rows require transformation.
- Generate or maintain database types in a repeatable way after the schema exists.

### 3.4 Backend-enforced security

- Treat client-side validation as user experience support, not authorization.
- Enforce ownership and membership rules in the backend.
- Enable Row Level Security on application tables exposed to the client.
- Deny access by default until an explicit policy permits it.
- Never rely only on hidden buttons or disabled controls to protect data.
- Never include a Supabase secret or service-role credential in the Expo application.

### 3.5 Environment separation

Plan separate configuration for:

- Local development
- Shared development
- Preview builds
- Production builds

Environment-specific values must not be hard-coded into screens or committed as real secrets.

### 3.6 Operational clarity

The architecture must support:

- Version-controlled database migrations
- Repeatable developer setup
- Security-policy testing
- CI validation
- Preview-environment testing
- Clear rollback and recovery procedures
- Future monitoring and incident response

## 4. Backend Decision Criteria

The backend was evaluated against CampusClutch-specific requirements:

- Expo React Native compatibility
- TypeScript support
- Relational data modelling
- Authentication
- Session restoration
- Authorization clarity
- Row-level security
- Realtime messaging
- Realtime notifications
- Course memberships
- Request ownership
- Request offers
- Conversation membership
- Duplicate-prevention constraints
- Query complexity
- Local development
- Database migrations
- Automated testing
- Avatar and file storage
- Push-notification integration
- Cost and free-tier constraints
- Vendor lock-in
- Administrative complexity
- Team learning curve

## 5. Backend Decision

### 5.1 Selected platform

CampusClutch will use **Supabase** as its planned backend platform.

This decision approves the architecture direction only. It does not authorize creating a Supabase project or installing packages during Task 3.

### 5.2 Why Supabase fits CampusClutch

CampusClutch contains strongly related data:

- A user can belong to multiple courses.
- A course can contain multiple users.
- A request has one owner.
- A request can receive multiple offers.
- An offer connects a user and a request.
- A conversation can contain multiple members.
- A message belongs to a conversation and a sender.
- A notification belongs to a user and may reference another entity.

A relational PostgreSQL database fits these relationships naturally through:

- Primary keys
- Foreign keys
- Join tables
- Unique constraints
- Check constraints
- Transactions
- Indexed queries
- Database migrations

Supabase also provides a unified direction for:

- PostgreSQL data storage
- Authentication
- Row Level Security
- Realtime updates
- Avatar and file storage
- Local development
- Version-controlled schema migrations

### 5.3 Security reason

Supabase Row Level Security can enforce rules based on the authenticated user and their relationship to a row.

Planned examples include:

- Users may update only their own profile.
- Users may manage only their own course memberships.
- Request owners may edit or delete their requests.
- Users may submit offers only as themselves.
- Request owners may accept or reject offers on their requests.
- Only conversation members may read its messages.
- Only conversation members may send messages to it.
- Users may read only their own private notifications.

The final policies will be designed and reviewed after the schema section is approved.

### 5.4 Migration reason

Supabase supports SQL migration files that can be stored in Git.

This matches the existing CampusClutch workflow:

- Focused branch
- Focused change
- Local checks
- Diff review
- Pull request
- CI
- Review
- Merge
- Local synchronization

Database schema and policy changes should eventually follow the same review workflow as application code.

### 5.5 Accepted trade-offs

Selecting Supabase introduces responsibilities that must be planned carefully:

- The team must learn PostgreSQL, SQL migrations, and Row Level Security.
- Incorrect RLS policies could expose or block data.
- Realtime should be enabled only where it provides clear product value.
- Offline-first behavior will require a separate application strategy.
- Database indexes and query performance must be reviewed as data grows.
- Supabase-specific Auth, Realtime, Storage, and Edge Function APIs create some vendor dependency.
- Development, preview, and production environments require deliberate configuration.
- Administrative operations must never be exposed through the mobile client.

These trade-offs are accepted because relational integrity and authorization clarity are higher priorities for CampusClutch.

## 6. High-Level Architecture

The planned architecture contains the following layers.

### 6.1 Expo React Native application

The existing Expo application remains responsible for:

- Screens and navigation
- Form state
- Loading, empty, error, and retry states
- Safe optimistic updates
- Client-side input validation
- Secure local session persistence
- Calling typed data-access functions
- Displaying authorization failures clearly

The mobile application must contain only client-safe backend configuration.

### 6.2 Supabase Auth

Supabase Auth will eventually manage:

- Sign up
- Sign in
- Sign out
- Session restoration
- Password reset
- Email verification
- Account identity
- Authentication tokens

Authentication identity and public student profile data will be treated as separate concerns.

### 6.3 PostgreSQL database

PostgreSQL will eventually store:

- Public profiles
- Courses
- Course memberships
- Requests
- Request offers
- Conversations
- Conversation members
- Messages
- Notifications
- Device or push-notification registrations if required

Exact tables, columns, constraints, and relationships will be defined later in this document.

### 6.4 Row Level Security

RLS will be the primary authorization layer for client-accessible database records.

Policies will be based on:

- Authenticated user identity
- Record ownership
- Course membership
- Conversation membership
- Request ownership
- Offer ownership
- Notification ownership

### 6.5 Supabase Storage

Storage will eventually support:

- Profile avatars
- Future request attachments if approved

Storage policies must define:

- File ownership
- Allowed file types
- Maximum file size
- Read access
- Update access
- Deletion access
- Account-deletion cleanup

### 6.6 Realtime

Realtime subscriptions will be introduced selectively.

Likely candidates include:

- New messages
- Conversation updates
- Request-offer updates
- In-app notification updates

Realtime will not replace permanent database records.

### 6.7 Privileged backend operations

Operations requiring elevated privileges must not run directly from the Expo client.

Potential privileged operations may later use:

- Supabase Edge Functions
- Database functions with carefully reviewed permissions
- A separately controlled server process

Examples may include:

- Administrative moderation
- Secure notification dispatch
- Account-deletion cleanup
- Trusted multi-record workflows
- Abuse prevention
- Rate-limited operations

The exact approach will be decided per feature.

## 7. Architecture Boundaries

The following boundaries apply to future implementation tasks.

### 7.1 Client boundaries

The Expo application must not contain:

- Supabase secret keys
- Service-role credentials
- Administrative credentials
- Database passwords
- Trusted webhook secrets
- Provider secrets used for server-to-server operations

### 7.2 Authorization boundaries

The client may request an operation, but the backend decides whether it is allowed.

Examples:

- A client may request to edit a profile.
- RLS verifies that the profile belongs to that user.
- A client may request to accept an offer.
- Backend rules verify that the user owns the related request.
- A client may request conversation messages.
- Backend rules verify conversation membership.

### 7.3 Data-access boundaries

Screens should use domain-focused data-access modules, services, hooks, or providers rather than duplicating query logic.

Planned domains include:

- Authentication
- Profiles
- Courses
- Requests
- Offers
- Conversations
- Messages
- Notifications
- Storage

The exact folders and filenames will be decided during implementation after inspecting the current repository.

### 7.4 Migration boundaries

Each backend migration task must:

- Change one focused domain.
- Preserve unrelated working flows.
- Include loading, empty, error, and retry behavior.
- Include authorization requirements.
- Include a manual test checklist.
- Run existing lint and TypeScript checks.
- Avoid unrelated formatting or warning cleanup.

## 8. Research Basis

The backend decision was informed by current official documentation covering:

- Expo integration with Supabase
- Supabase Auth for React Native
- PostgreSQL and table relationships
- Row Level Security
- API key safety
- Local development
- Database migrations
- Multiple environment management

## 9. Authentication Architecture

### 9.1 Initial authentication method

The first authentication implementation will use:

- Email and password sign-up
- Email and password sign-in
- Email verification
- Password reset
- Sign-out
- Session restoration

Social login, passwordless login, phone authentication, and single sign-on are outside the first authentication milestone.

They may be evaluated later without changing the core profile and authorization model.

### 9.2 Authentication identity

Supabase Auth will be the source of truth for account identity.

Each authenticated account will receive a Supabase Auth user ID.

That ID will be used as the stable foreign key connecting the account to CampusClutch application records such as:

- Profile
- Course memberships
- Owned requests
- Request offers
- Conversation memberships
- Sent messages
- Notifications

The application must not generate a separate unrelated user identifier for backend ownership.

### 9.3 Sign-up flow

The planned sign-up flow is:

1. The user enters an email and password.
2. The client performs basic input validation.
3. Supabase Auth creates the authentication identity.
4. The user receives an email-verification message.
5. CampusClutch displays a verification-pending state.
6. After verification, the user signs in or the verified session is restored.
7. The application confirms that a corresponding public profile exists.
8. The user completes any required profile fields.
9. The user enters the authenticated application.

Sign-up screens must include:

- Loading and submitting states
- Duplicate-submit prevention
- Clear validation messages
- A verification-pending state
- A resend-verification action with rate-limit handling
- A path back to sign-in
- Generic security-conscious errors where exposing account existence is unnecessary

### 9.4 Email verification

Email verification will be required before a new account receives normal application access in shared development, preview, and production environments.

The application must clearly explain:

- That a verification email was sent
- Which email address was used
- That delivery may take time
- How to resend the message
- How to return and change the email address
- What to do when the link is expired or invalid

Verification links must return users to CampusClutch through an approved deep-link or universal-link configuration.

Local development may use environment-specific authentication settings for repeatable testing, but production behavior must require verified email ownership.

### 9.5 University-email restriction decision

The initial backend implementation will require a verified email address but will **not hard-code a university-domain allowlist**.

Reasons:

- Supported institutions and domains have not been formally defined.
- Universities may use multiple student, alumni, faculty, and regional domains.
- Hard-coded domain checks can reject legitimate students.
- A client-only domain check would not provide reliable authorization.
- Domain policy changes would require ongoing maintenance.

Before production launch, the product and privacy review must choose one of these options:

- Continue allowing any verified email
- Require a supported university email
- Allow any verified email but grant a separate verified-student status
- Use an invitation or institutional-verification process

If a university restriction is introduced, it must be enforced in trusted backend logic rather than only in the Expo client.

### 9.6 Sign-in flow

The sign-in flow will:

1. Accept email and password.
2. Validate that required fields are present.
3. Submit credentials once.
4. Display a loading state.
5. Handle invalid credentials without exposing unnecessary account details.
6. Check whether email verification is required.
7. Restore or create the authenticated session.
8. Confirm the user's public profile state.
9. Route the user to the correct authenticated or onboarding screen.

Repeated failed sign-in attempts and Supabase rate-limit responses must produce understandable user-facing errors.

### 9.7 Session persistence and restoration

CampusClutch must persist the Supabase session using an Expo and React Native compatible storage adapter.

The implementation must:

- Enable session persistence.
- Enable token refresh.
- Restore the session when the application launches.
- Subscribe to authentication-state changes.
- Start refresh behavior when the native application is active.
- Stop unnecessary refresh behavior when the application is inactive.
- Clean up authentication listeners correctly.
- Clear local session state after sign-out.
- Avoid briefly displaying protected screens before restoration finishes.

The root application flow must have an explicit authentication-loading state.

Until session restoration completes, the application should display a splash or loading state rather than assuming that the user is signed in or signed out.

The stored client session is not an authorization system. Database access remains controlled by Row Level Security.

The exact storage package and client filename will be selected during Task 4 after the current repository and Expo requirements are inspected.

### 9.8 Protected navigation

Expo Router will continue to control navigation.

A later authentication task will introduce a shared authentication state that exposes at least:

- Current session
- Current authenticated user
- Initial restoration status
- Authentication error state
- Sign-out action

Protected screens must not depend only on hiding links or buttons.

The routing design must:

- Prevent signed-out users from remaining on protected screens.
- Prevent redirect loops during session restoration.
- Return verified users to the appropriate authenticated route.
- Send users with incomplete profiles to onboarding.
- Preserve valid navigation after application reload.
- Preserve Android Back behavior.

Exact route groups and filenames must be chosen only after inspecting the repository at the start of Task 5.

### 9.9 Password reset

Password reset will use Supabase Auth email recovery.

The planned flow is:

1. The user enters their email.
2. CampusClutch requests a password-reset email.
3. The application shows a generic confirmation message.
4. The user opens the recovery link.
5. The link returns to CampusClutch.
6. The application validates the recovery session.
7. The user enters and confirms a new password.
8. The password is updated.
9. The user receives a success state and returns to sign-in or the authenticated app.

The implementation must test:

- Application already open
- Application closed
- Expired link
- Reused link
- Invalid link
- Password mismatch
- Network failure
- Rate-limit response

Development, preview, and production environments must each use approved redirect URLs.

### 9.10 Sign-out

Sign-out must:

- Call the Supabase sign-out operation.
- Clear application-level user state.
- Clear cached private data where required.
- Stop private realtime subscriptions.
- Return to the signed-out route.
- Prevent navigation back into protected private screens.

A failed sign-out request must not leave the UI pretending that sign-out succeeded without handling the remaining local session safely.

### 9.11 Authentication users and public profiles

Authentication records and CampusClutch profiles will be separate.

Supabase-managed authentication information remains in the protected Auth schema.

CampusClutch will use a public application table for profile data that screens need to query.

The planned relationship is:

- One Supabase Auth user
- One CampusClutch public profile
- The same UUID used as the profile primary key
- A foreign-key reference to the Auth user
- Cascading profile cleanup when the Auth user is deleted

The public profile must not store:

- Passwords
- Access tokens
- Refresh tokens
- Authentication secrets
- Administrative credentials

Email should remain authentication data unless a reviewed product requirement requires a separately controlled profile field.

### 9.12 Profile initialization after sign-up

A minimal profile record should be created automatically for each successfully created Auth user.

The preferred direction is a reviewed database function and Auth-user creation trigger that inserts the minimum profile row.

The initial automatic row should contain only values needed to establish the one-to-one relationship, such as:

- User ID
- Created timestamp
- Updated timestamp
- An onboarding or profile-completion state if required

User-provided profile details should then be validated and updated through the normal profile flow.

Profile initialization must be:

- Idempotent
- Covered by database tests
- Protected against duplicate profile rows
- Designed so partial onboarding can resume
- Documented in a migration
- Verified in local and preview environments

### 9.13 Authentication metadata

User-editable authentication metadata must not be used as the source of truth for authorization.

Fields such as role, request ownership, course membership, conversation membership, or administrative access must not be trusted merely because they appear in user-editable metadata.

Authorization should instead use:

- Database ownership columns
- Membership tables
- RLS policies
- Trusted backend-controlled claims only when a later reviewed requirement justifies them

Profile display information belongs in the public profile model rather than serving as an authorization mechanism.

### 9.14 Account deletion

Account deletion requires privileged backend processing and must not use a secret credential in the Expo client.

The planned flow is:

1. The authenticated user requests account deletion.
2. The application requires deliberate confirmation.
3. A trusted server-side function verifies the authenticated user.
4. The function applies the approved retention and anonymization policy.
5. User-owned Storage objects are deleted or reassigned as required.
6. Dependent application records are deleted, anonymized, or retained according to policy.
7. The Supabase Auth user is deleted using server-only administrative access.
8. The application clears its local session and private cached data.
9. The user receives a completion or support message.

Storage cleanup must occur before Auth-user deletion when the user owns stored objects that would prevent deletion.

The final behavior for requests, messages, offers, and moderation records will be defined during the privacy and data-retention task.

### 9.15 Authentication email delivery

Development email behavior must not be treated as production-ready email delivery.

Before production:

- A production-capable SMTP provider must be evaluated.
- Sender identity must be configured.
- Verification and recovery templates must be reviewed.
- Redirect links must be tested.
- Delivery failures must be monitored.
- Authentication email rate limits must be reviewed.
- Resend controls must prevent accidental abuse.

### 9.16 Authentication security requirements

The authentication implementation must:

- Use only the public Supabase client key in the application.
- Never expose a secret or service-role key.
- Require HTTPS for hosted services.
- Validate redirect destinations.
- Avoid logging passwords, tokens, or sensitive Auth responses.
- Handle token expiration.
- Handle revoked or invalid sessions.
- Use RLS for database authorization.
- Avoid client-controlled authorization metadata.
- Rate-limit or otherwise protect sensitive server-side operations.
- Provide generic errors where detailed errors could assist account enumeration.
- Remove private subscriptions and state when the authenticated user changes.

### 9.17 Authentication testing requirements

The authentication milestone must eventually test:

- New sign-up
- Duplicate sign-up
- Valid sign-in
- Invalid sign-in
- Unverified email
- Email verification
- Verification resend
- Application restart with a valid session
- Application restart with an expired session
- Sign-out
- Password reset
- Invalid or expired recovery link
- Profile initialization
- Interrupted onboarding
- Protected route access while signed out
- Authentication rate limits
- Network failure
- Account deletion
- Attempted unauthorized profile access

## 10. Users and Public Profiles

### 10.1 Profile architecture

Supabase Auth users and CampusClutch profiles will remain separate records.

The planned relationship is:

- `auth.users` stores account identity and authentication information.
- `public.profiles` stores student information used by CampusClutch screens.
- `profiles.id` uses the same UUID as the corresponding Auth user.
- `profiles.id` is the primary key.
- `profiles.id` references the Auth user's primary key.
- Deleting the Auth user cascades to the profile after required file and retention cleanup is complete.
- Each Auth user can have no more than one profile.

The application will not query the protected Auth schema directly for student-profile screens.

### 10.2 Proposed profile fields

The initial `profiles` model should include:

| Field | Planned type | Required | Purpose |
|---|---|---:|---|
| `id` | UUID | Yes | Primary key and reference to the Auth user |
| `display_name` | Text | After onboarding | Name displayed throughout CampusClutch |
| `major` | Text | No | Student's program or major |
| `year_of_study` | Small integer | No | Student's current year of study |
| `campus_id` | Foreign key | No | Student's primary campus |
| `avatar_path` | Text | No | Path to the user's avatar in Supabase Storage |
| `is_discoverable` | Boolean | Yes | Controls whether the profile appears in discovery queries |
| `onboarding_completed_at` | Timestamp with time zone | No | Records completion of required profile setup |
| `last_active_at` | Timestamp with time zone | No | Supports a privacy-conscious recent-activity indicator |
| `created_at` | Timestamp with time zone | Yes | Server-generated creation time |
| `updated_at` | Timestamp with time zone | Yes | Server-maintained modification time |

The final migration will define:

- Maximum and minimum text lengths
- Whitespace handling
- Supported year-of-study range
- Allowed campus references
- Required onboarding fields
- Timestamp defaults
- Update-trigger behavior

The profile table must not store:

- Passwords
- Access tokens
- Refresh tokens
- Authentication secrets
- Service-role credentials
- Administrative secrets
- Raw payment information

### 10.3 Display name

`display_name` is the primary user-facing name.

The implementation must:

- Trim leading and trailing whitespace.
- Reject an empty value after trimming.
- Apply a reviewed maximum length.
- Allow normal international names.
- Avoid assuming that every user has separate first and last names.
- Avoid using the email address as the permanent display name.

CampusClutch may temporarily show a neutral onboarding placeholder before the user completes their profile, but incomplete profiles must not appear as normal classmates.

### 10.4 Major and year of study

`major` and `year_of_study` describe the student's academic profile.

The initial plan is:

- `major` remains optional text while supported program data is incomplete.
- `year_of_study` remains optional during signup.
- The final schema applies a reasonable numeric range to `year_of_study`.
- User-facing labels such as `1st Year` are formatted by the application.
- The app does not infer a student's year from their account creation date.

A later product decision may replace free-text majors with a reviewed programs table if consistent filtering becomes necessary.

### 10.5 Campus

Profiles should reference a shared campus record rather than storing unrelated campus spellings throughout the database.

The planned campus values initially represent:

- Burnaby
- Surrey
- Vancouver

The same campus model should eventually be reusable by:

- Profiles
- Courses
- Requests
- Search and filtering

The exact campus table and foreign-key design will be finalized with the courses and memberships schema.

### 10.6 Interests

Interests should use a normalized many-to-many model rather than a comma-separated profile field.

The planned records are:

#### `interests`

- Interest ID
- Display name
- Stable slug
- Active/inactive state
- Created timestamp

#### `profile_interests`

- Profile ID
- Interest ID
- Created timestamp
- Composite uniqueness across profile ID and interest ID

This design allows:

- One profile to have multiple interests.
- One interest to belong to multiple profiles.
- Duplicate interests on one profile to be prevented.
- Interests to be renamed without updating every profile.
- Shared interests to be calculated through a query.

The current `shared interests` UI should be derived from the signed-in user's interests and the viewed student's interests. It should not be stored as permanent text on either profile.

### 10.7 Derived profile information

The following UI values should be derived rather than stored directly on `profiles`:

- Shared-course note
- Number of shared courses
- Shared interests
- Top Match badge
- Match score
- Conversation status
- Whether the signed-in user has previously contacted the student

Deriving these values avoids stale duplicated profile data.

Any future match score must have documented inputs and privacy rules before implementation.

### 10.8 Profile visibility

CampusClutch profiles are not intended to be anonymously searchable on the public internet.

The initial visibility direction is:

- Signed-out users cannot query student profiles.
- Authenticated users can always read their own profile.
- Authenticated users can read discoverable profile fields needed by approved CampusClutch features.
- Profiles with `is_discoverable = false` do not appear in general classmate or discovery results.
- A user may still need limited access to another non-discoverable profile when they share an existing conversation, request interaction, or other approved relationship.
- Administrative or moderation access requires trusted backend authorization.

The initial backend should prefer the most restrictive rule that still supports:

- Classmate lists
- Student profile screens
- Existing conversations
- Request ownership displays
- Offer-management screens

Relationship-specific visibility will be finalized with course, request, and conversation policies.

### 10.9 Public and private fields

Fields suitable for authenticated CampusClutch discovery may include:

- User ID
- Display name
- Major
- Year of study
- Campus
- Avatar
- Approved interests

Fields that must not be exposed through general profile discovery include:

- Email address
- Authentication-provider details
- Password or recovery information
- Access and refresh tokens
- Account-security metadata
- Administrative flags
- Moderation notes
- Push-notification tokens
- Private support records

`last_active_at` requires special handling:

- Exact activity timestamps should not be broadly displayed.
- The UI may expose only a coarse status such as `Recently active`.
- Visibility may be restricted to classmates, conversation members, or other approved relationships.
- Users should eventually receive an activity-visibility preference.
- Presence and activity must not be treated as proof that a user is currently online.

Private settings and operational fields may use separate tables rather than expanding the discoverable profile record.

### 10.10 Profile creation

A minimal profile should be initialized after Auth user creation.

The preferred direction is:

1. Supabase Auth creates the user.
2. A reviewed database trigger invokes a profile-initialization function.
3. The function inserts one minimal row using the Auth user UUID.
4. The function returns without creating duplicate records.
5. The user completes required profile fields through onboarding.

The profile-creation function must:

- Use an explicitly controlled search path.
- Insert only trusted and validated initial values.
- Avoid trusting user-editable metadata for authorization.
- Be idempotent where practical.
- Fail visibly during development.
- Be tested because a broken Auth trigger can prevent signup.
- Be stored in a version-controlled migration.

Task 3 does not create the trigger or migration.

### 10.11 Profile updates

Authenticated users may update only their own allowed profile fields.

The backend must enforce that:

- The row belongs to the authenticated user.
- The profile ID cannot be changed.
- The creation timestamp cannot be changed by the client.
- The updated timestamp is maintained by the backend.
- Administrative and moderation fields cannot be changed through profile updates.
- Text and numeric constraints remain valid.
- A user cannot update another user's profile by changing a request payload.

Client-side validation should improve usability but must not replace database constraints and RLS.

### 10.12 Profile deletion

The Expo client should not directly delete the profile as an isolated operation.

Profile deletion belongs to the reviewed account-deletion workflow because the system must also consider:

- Auth identity
- Avatar files
- Course memberships
- Requests
- Offers
- Conversations
- Messages
- Notifications
- Moderation and legal-retention records

The final retention policy may delete, retain, or anonymize different records.

### 10.13 Row Level Security direction

RLS will be enabled on the profile and profile-interest tables.

The planned profile-policy direction is:

#### Select

- Users may read their own profile.
- Authenticated users may read approved discoverable profiles.
- Relationship-based exceptions may support existing conversations or request interactions.
- Signed-out requests receive no student-profile access.

#### Insert

- Normal clients do not create arbitrary profile rows.
- Profile creation occurs through the reviewed Auth-user initialization process.

#### Update

- Users may update only their own profile.
- Updates must satisfy all table constraints.
- Protected fields remain server-controlled.

#### Delete

- Normal clients do not directly delete profiles.
- Account deletion uses trusted server-side processing.

The final policies must be tested as the profile owner, another authenticated user, a signed-out client, and a privileged backend operation.

### 10.14 Profile indexes and query needs

The final schema should consider indexes for:

- Discoverable profiles
- Campus filtering
- Year-of-study filtering
- Profile-interest joins
- Classmate queries through course memberships
- Recent-activity queries only if the product approves them

Indexes must be based on real query patterns rather than added without evidence.

Search behavior must define:

- Case handling
- Partial-name matching
- Result limits
- Pagination
- Whether major and interest search are included
- Whether hidden profiles are excluded before results reach the client

### 10.15 Avatar reference

The profile row should store an avatar object path or stable storage reference, not image binary data or a base64 image.

The planned storage direction is:

- Use a dedicated avatar bucket.
- Store each user's avatar under a user-specific path.
- Allow users to upload, replace, and delete only their own avatar.
- Validate allowed image types.
- Apply a reviewed file-size limit.
- Remove or replace old files safely.
- Do not trust the filename supplied by the device.
- Use Storage RLS policies in addition to object ownership.
- Clean up avatar files during account deletion.

Whether avatars are public or served through controlled authenticated access will be finalized in the Storage section.

### 10.16 Profile UX requirements

Profile-backed screens must eventually include:

- Initial loading state
- Missing-profile state
- Incomplete-onboarding state
- Empty optional fields
- Save/submitting state
- Save success feedback
- Validation errors
- Network failure state
- Authorization failure state
- Retry behavior
- Avatar-upload progress
- Avatar-upload failure recovery
- Protection against duplicate saves

The existing Student Not Found state should remain for invalid or inaccessible profile IDs.

### 10.17 Profile testing requirements

The profile milestone must eventually test:

- Profile created for a new Auth user
- No duplicate profile creation
- Successful onboarding
- Interrupted onboarding and resume
- User reads their own profile
- User updates their own profile
- User cannot update another profile
- Signed-out user cannot query profiles
- Discoverable profile appears in approved queries
- Hidden profile is excluded from discovery
- Existing authorized relationship behavior
- Invalid year-of-study value
- Empty or oversized display name
- Duplicate profile interest prevention
- Shared-interest query
- Avatar upload
- Invalid avatar file
- Oversized avatar file
- Avatar replacement
- Avatar deletion
- Account-deletion cleanup

## 11. Courses and Memberships

### 11.1 Goals

The courses architecture must support:

- A shared course catalog
- Academic terms
- Campus-specific courses where required
- Adding and leaving courses
- Duplicate-membership prevention
- Current and previous course lists
- Classmate discovery
- Shared-course information
- Backend-enforced membership rules
- Gradual replacement of the existing course mock data

Course membership is self-declared in the initial product unless a later institutional-verification system is approved.

Joining a course does not initially prove official university enrolment.

### 11.2 Core records

The planned course domain contains:

- `academic_terms`
- `courses`
- `course_memberships`

Campus records defined elsewhere in the architecture may also be referenced.

The relationship is:

- One academic term has many courses.
- One course belongs to one academic term.
- One course may be associated with one campus.
- One profile can belong to many courses.
- One course can contain many profiles.
- `course_memberships` implements the many-to-many relationship.

### 11.3 Academic terms

Academic terms should be stored separately instead of repeating free-form term text on every membership.

The proposed `academic_terms` fields are:

| Field | Planned type | Required | Purpose |
|---|---|---:|---|
| `id` | UUID | Yes | Primary key |
| `code` | Text | Yes | Stable value such as `2026-fall` |
| `display_name` | Text | Yes | User-facing value such as `Fall 2026` |
| `year` | Small integer | Yes | Academic year |
| `season` | Text or enum | Yes | Spring, Summer, or Fall |
| `starts_on` | Date | Yes | Beginning of the term |
| `ends_on` | Date | Yes | End of the term |
| `status` | Text or enum | Yes | Upcoming, current, or past |
| `created_at` | Timestamp with time zone | Yes | Server-generated creation time |
| `updated_at` | Timestamp with time zone | Yes | Server-maintained modification time |

The final migration should enforce:

- Unique term codes
- A valid year range
- An end date after the start date
- An approved season value
- An approved status value
- One consistent system for term transitions

Term timestamps and dates will use the database's configured time conventions. User-facing dates will be formatted by the application.

### 11.4 Term status

The planned term statuses are:

- `upcoming`
- `current`
- `past`

Only trusted administrative or scheduled backend processes may change term status.

Normal mobile clients must not mark terms as current or past.

The system must prevent multiple contradictory current terms for the same institution or academic scope once institution support is defined.

Initially, CampusClutch may manage term status manually through trusted administration rather than adding automated scheduling prematurely.

### 11.5 Courses

A `courses` row represents a CampusClutch course offering for a specific academic term.

The proposed fields are:

| Field | Planned type | Required | Purpose |
|---|---|---:|---|
| `id` | UUID | Yes | Primary key |
| `code` | Text | Yes | Canonical course code such as `CMPT 295` |
| `title` | Text | Yes | Course title |
| `term_id` | UUID foreign key | Yes | Related academic term |
| `campus_id` | UUID foreign key | No | Primary course campus when applicable |
| `status` | Text or enum | Yes | Active, closed, or archived |
| `created_at` | Timestamp with time zone | Yes | Server-generated creation time |
| `updated_at` | Timestamp with time zone | Yes | Server-maintained modification time |

Potential future fields include:

- Section identifier
- Instructor display name
- Delivery mode
- Department
- Institution
- Enrollment capacity
- Administrative notes

These fields should not be added before the application requires them.

### 11.6 Course code normalization

Course codes must use one canonical format.

The final implementation should:

- Trim leading and trailing whitespace.
- Normalize repeated internal whitespace.
- Normalize letters to uppercase.
- Apply a reviewed maximum length.
- Reject an empty code.
- Preserve the displayed format expected by students.

Examples that should resolve consistently include:

- `CMPT 295`
- `cmpt 295`
- ` CMPT 295 `
- `CMPT   295`

Normalization must occur in trusted database logic or constraints as well as in the client.

The application must not depend only on visual formatting to prevent duplicate course rows.

### 11.7 Course status

The proposed course statuses are:

- `active`
- `closed`
- `archived`

Their planned meanings are:

#### Active

- Visible in normal course search
- Open for new membership
- Available for classmate queries

#### Closed

- Existing members retain approved access
- New membership is blocked
- The course may remain visible to existing members
- Administrative review can reopen it

#### Archived

- Retained for history
- Not open for new membership
- Excluded from normal course search
- May appear in previous-course history

Course status and term status serve different purposes.

For example, an individual course may be closed while its academic term remains current.

### 11.8 Course uniqueness

The database must prevent duplicate course offerings.

The initial uniqueness direction is based on:

- Normalized course code
- Academic term
- Campus when campus distinguishes separate offerings

The exact unique constraint must account for nullable campus values correctly.

The final schema must decide whether two sections of the same course are:

- One shared CampusClutch course
- Separate course records
- One course with separate section records

CampusClutch should initially avoid section-level complexity unless the product requires separate classmate groups.

### 11.9 Course memberships

`course_memberships` connects profiles to courses.

The proposed fields are:

| Field | Planned type | Required | Purpose |
|---|---|---:|---|
| `course_id` | UUID foreign key | Yes | Related course |
| `profile_id` | UUID foreign key | Yes | Related user profile |
| `status` | Text or enum | Yes | Enrolled, completed, or left |
| `joined_at` | Timestamp with time zone | Yes | When membership began |
| `ended_at` | Timestamp with time zone | No | When membership ended or changed |
| `created_at` | Timestamp with time zone | Yes | Server-generated creation time |
| `updated_at` | Timestamp with time zone | Yes | Server-maintained modification time |

The preferred key is a composite primary key across:

- `course_id`
- `profile_id`

This ensures that one profile cannot have multiple membership rows for the same course.

If the user rejoins a course, the existing membership should be reviewed and transitioned instead of inserting a duplicate row.

### 11.10 Membership statuses

The proposed membership statuses are:

- `enrolled`
- `completed`
- `left`

#### Enrolled

The user is currently participating in the course and may appear in approved classmate queries.

#### Completed

The user completed the course or retained it as previous-course history.

Completed memberships do not appear in the normal current-classmate list.

#### Left

The user intentionally removed or dropped the course.

Left memberships do not appear in normal course or classmate lists.

Normal users must not be able to mark arbitrary memberships as completed.

Completion may be determined from term lifecycle or a trusted backend transition.

### 11.11 Adding a course

The planned Add Course operation is:

1. The authenticated user searches available active courses.
2. The user selects one course.
3. The client enters a submitting state.
4. The backend verifies the authenticated identity.
5. The backend verifies that the course is joinable.
6. The backend creates or safely reactivates the user's membership.
7. Database uniqueness prevents duplicate membership.
8. The application refreshes the user's current courses.
9. The application shows success or a clear error.

The backend must reject:

- Signed-out membership creation
- Membership creation for another profile
- Duplicate active membership
- Membership in an archived course
- Membership in a closed course
- Membership in a nonexistent course
- Invalid membership status supplied by the client

The final implementation may use a narrowly scoped database function for join and rejoin behavior if direct inserts cannot safely enforce all state transitions.

### 11.12 Leaving a course

Leaving a course should not immediately destroy all membership history.

The planned behavior is:

1. The user chooses to leave their own course.
2. The application requests confirmation.
3. The backend verifies ownership of the membership.
4. The membership transitions to `left`.
5. `ended_at` and `updated_at` are maintained by the backend.
6. The course is removed from the user's current list.
7. The user no longer appears in that course's normal classmate results.

A user must not be able to leave a course on behalf of another user.

The final product must decide whether rejoining a left course is allowed while the course remains active.

### 11.13 Current and previous courses

Current and previous course lists should be derived from membership, course, and term state.

The planned rules are:

#### Current courses

A course appears as current when:

- The membership belongs to the signed-in user.
- Membership status is `enrolled`.
- The course is not archived.
- The related term is current.

Upcoming courses may later receive a separate UI section rather than appearing as current.

#### Previous courses

A course appears as previous when:

- The membership belongs to the signed-in user.
- Membership status is `completed`; or
- The related term is past and the membership was not left.

#### Excluded courses

A course is excluded from normal current and previous lists when:

- Membership status is `left`; or
- Access has been removed by moderation or administration.

The same membership must not appear in both current and previous results.

The database remains the source of truth; the client must not permanently classify courses using local state.

### 11.14 Classmate queries

A classmate query should return approved profiles that share a course with the signed-in user.

The query must verify:

- The caller is authenticated.
- The caller has an enrolled membership in the requested course.
- The requested course exists.
- Returned users have an enrolled membership in the same course.
- Returned profiles satisfy the approved discoverability rules.
- Incomplete profiles are excluded.
- Left or completed memberships are excluded from current-classmate results.
- The caller can be excluded from the returned list.

The result should contain only fields needed by the classmate UI, such as:

- Profile ID
- Display name
- Major
- Year of study
- Campus
- Avatar reference
- Approved interests
- Coarse activity indicator if permitted

The classmate query should support:

- Stable ordering
- Result limits
- Pagination
- Search by approved fields
- Empty state
- Authorization failure
- Course-not-found state

### 11.15 Classmate-query security approach

The preferred architecture is to avoid granting every authenticated client unrestricted access to all course membership rows.

Two approaches may be evaluated during implementation:

#### Same-course RLS policies

Membership rows are readable only when the caller is also an enrolled member of the same course.

This approach must be tested for:

- Circular RLS dependencies
- Infinite policy recursion
- Query performance
- Privacy leakage

#### Narrow database function

A database function receives a course ID, verifies the caller's membership, and returns only approved classmate fields.

If a privileged or security-definer function is used, it must:

- Verify the authenticated caller explicitly.
- Use a fixed safe search path.
- Return only required columns.
- Avoid exposing unrestricted membership data.
- Restrict function execution to approved roles.
- Be covered by authorization tests.
- Be reviewed for RLS-bypass effects.

The final choice should use the simplest secure option that performs acceptably.

### 11.16 Shared-course information

Shared-course notes shown on student profiles must be derived from membership relationships.

Examples include:

- `You share CMPT 295`
- `You share 2 current courses`

The system must not store shared-course text permanently on a profile.

A shared-course query must consider:

- The signed-in user's memberships
- The viewed profile's memberships
- Membership status
- Term status
- Course visibility
- Profile visibility
- Authorization rules

Historical shared courses should not be exposed automatically unless the product explicitly approves that behavior.

### 11.17 Row Level Security direction

RLS will be enabled on:

- `academic_terms`
- `courses`
- `course_memberships`

The initial policy direction is:

#### Academic terms

- Authenticated users may read approved terms.
- Normal clients cannot insert, update, or delete terms.
- Trusted administrative processes manage term records.

#### Courses

- Authenticated users may read active courses.
- Existing members may retain approved access to closed or historical courses.
- Normal clients cannot create, edit, archive, or delete course records.
- Trusted administrative processes manage the course catalog.

#### Course memberships: select

- Users may always read their own memberships.
- Access to another user's membership requires an approved same-course relationship or a narrow classmate-query function.
- Signed-out clients receive no membership access.

#### Course memberships: insert

- The authenticated user may join only as their own profile ID.
- The course must be active and joinable.
- The initial status must be `enrolled`.
- Duplicate membership is rejected or handled through a reviewed rejoin operation.

#### Course memberships: update

- Users may initiate only approved transitions on their own membership.
- Users cannot change `profile_id` or `course_id`.
- Users cannot mark themselves or another user completed without approved backend logic.
- Trusted operations maintain server-controlled timestamps.

#### Course memberships: delete

- Normal clients do not directly delete membership rows.
- Leaving uses a status transition.
- Administrative deletion requires trusted authorization and an approved retention reason.

### 11.18 Course administration

The initial CampusClutch app will not expose course-catalog administration through the normal mobile client.

Trusted administration is responsible for:

- Creating terms
- Creating courses
- Correcting course titles
- Closing or archiving courses
- Resolving duplicates
- Managing invalid or abusive course records
- Updating term status

Administrative access must not be represented only by a client-controlled profile field.

A future administration system must use trusted backend authorization.

### 11.19 Index and query plan

The final schema should consider indexes for:

- Term code
- Term status
- Normalized course code
- Course term
- Course campus
- Course status
- Membership profile ID
- Membership course ID
- Membership status
- Current-course queries
- Classmate membership queries

The composite membership primary key supports uniqueness, but additional indexes may still be required for common reverse lookups.

Indexes must be validated against actual queries and query plans.

The project should avoid adding speculative indexes that increase storage and write costs without improving real access patterns.

RLS policy columns and membership lookup columns should receive special performance review.

### 11.20 Realtime behavior

Course and membership data does not initially require continuous realtime subscriptions on every screen.

The first backend implementation should prefer:

- Fetch on screen load
- Refresh after join or leave
- Pull-to-refresh where appropriate
- Refetch when returning to a relevant screen

Realtime may later be considered for specific events such as:

- A course being closed
- A membership being removed
- A classmate joining

The benefit must justify subscription complexity and privacy implications.

### 11.21 Mock-data migration

The course migration should happen after authentication and profiles are working.

A proposed focused migration order is:

1. Add backend tables and policies for terms, courses, and memberships.
2. Add a small reviewed development course catalog.
3. Add typed course data-access functions.
4. Load available courses from Supabase.
5. Persist Add Course membership.
6. Load the signed-in user's current and previous courses.
7. Load real classmates through approved membership queries.
8. Preserve existing student-profile and message routing.
9. Add loading, empty, error, and retry states.
10. Remove obsolete course membership mock paths only after testing.
11. Resolve the existing Courses `useMemo` warnings during this focused migration.

Shared mock students must not be inserted as real authenticated users merely to preserve demo data.

Preview testing may instead use explicitly created development test accounts.

### 11.22 Course UX requirements

Backend-backed course screens must eventually define:

- Initial loading state
- Empty available-course state
- Empty current-course state
- Empty previous-course state
- Search with no results
- Search loading behavior
- Join submitting state
- Join success feedback
- Duplicate membership response
- Closed-course response
- Leave confirmation
- Leave submitting state
- Network failure
- Authorization failure
- Retry behavior
- Pull-to-refresh behavior
- Pagination where needed

The current red selection styling and checkmark behavior should be preserved where appropriate.

### 11.23 Course testing requirements

The course milestone must eventually test:

- Read active academic terms
- Read active courses
- Search by course code
- Search by course title
- Course-code normalization
- Join a course
- Duplicate join prevention
- Join as another user is rejected
- Join closed course is rejected
- Join archived course is rejected
- Leave own course
- Leave another user's course is rejected
- Rejoin behavior
- Current-course classification
- Previous-course classification
- Left course exclusion
- Read own memberships
- Unauthorized membership access
- Classmate query as a member
- Classmate query as a nonmember
- Hidden profile exclusion
- Incomplete profile exclusion
- Shared-course query
- Pagination
- Network failure
- RLS recursion checks
- RLS performance checks

## 12. Requests

### 12.1 Goals

The requests architecture must support:

- Persistent campus help requests
- Authenticated request ownership
- Delivery requests
- Pickup requests
- Event Help requests
- Study Help requests
- Shared and category-specific fields
- Request filtering
- Deadlines
- Positive whole-number points
- Request status transitions
- Owner editing and cancellation
- Secure request visibility
- Gradual replacement of `RequestsContext`
- Future request offers and conversations

The initial backend migration must preserve the current request creation, feed, filtering, and details-screen behavior.

### 12.2 Core records

The planned request domain contains:

- `requests`
- `delivery_request_details`
- `pickup_request_details`
- `event_help_request_details`
- `study_help_request_details`

Request offers will use a separate table defined in the next architecture section.

The relationship is:

- One profile may own many requests.
- One request has exactly one owner.
- One request has exactly one category.
- One request has zero or one matching category-detail row.
- A category-specific request must have exactly one detail row for its category.
- A request must not have detail rows belonging to another category.

### 12.3 Request categories

The persisted request categories are:

- `delivery`
- `pickup`
- `event_help`
- `study_help`

`ALL` is a user-interface filter and must not be stored as a request category.

The existing UI labels may continue to display:

- DELIVERY
- PICKUP
- EVENT HELP
- STUDY HELP

The application data layer will map database values to existing UI values while the frontend types are migrated.

Category values should use one reviewed database enum or constrained text representation.

Normal clients must not create unrecognized categories.

### 12.4 Main requests table

The proposed `requests` fields are:

| Field | Planned type | Required | Purpose |
|---|---|---:|---|
| `id` | UUID | Yes | Primary key |
| `owner_id` | UUID foreign key | Yes | Profile that created the request |
| `category` | Text or enum | Yes | Delivery, pickup, event help, or study help |
| `title` | Text | Yes | Short request title |
| `description` | Text | Yes | Detailed request explanation |
| `campus_id` | UUID foreign key | Yes | Related campus |
| `room_location` | Text | Yes | Room or specific campus location |
| `deadline_at` | Timestamp with time zone | Yes | Deadline stored in a consistent timezone |
| `points` | Integer | Yes | Positive whole-number points offered |
| `item_size` | Text or enum | Yes | Small, Medium, or Large |
| `status` | Text or enum | Yes | Current request lifecycle state |
| `is_urgent` | Boolean | Yes | Approved urgent indicator |
| `created_at` | Timestamp with time zone | Yes | Server-generated creation time |
| `updated_at` | Timestamp with time zone | Yes | Server-maintained modification time |
| `accepted_at` | Timestamp with time zone | No | When an offer was accepted |
| `completed_at` | Timestamp with time zone | No | When the request was completed |
| `cancelled_at` | Timestamp with time zone | No | When the owner cancelled the request |

Potential future fields include:

- Request attachments
- Moderation state
- Report count
- Cancellation reason
- Completion confirmation
- Institution ID
- Expiration timestamp

These fields should not be added before the related product requirements are approved.

### 12.5 Request owner

`owner_id` identifies the authenticated profile that created the request.

The backend must enforce that:

- A signed-out user cannot create a request.
- The owner ID matches the authenticated user.
- A client cannot create a request for another profile.
- The owner ID cannot be changed after creation.
- The owner can read their own requests according to retention rules.
- Editing and cancellation are limited to the owner or trusted moderation.
- Account deletion follows the approved retention and anonymization policy.

The application must not trust a client-provided owner name, avatar, major, or campus description.

Owner display information should be loaded from the related profile.

### 12.6 Shared text fields

The request title, description, and room or location fields require reviewed validation.

The final implementation should:

- Trim leading and trailing whitespace.
- Reject empty values after trimming.
- Apply maximum lengths.
- Apply a reasonable minimum description length.
- Preserve international characters.
- Avoid storing HTML supplied by the client.
- Display user-provided text safely.
- Reject values that exceed database limits.
- Allow clear user-facing validation errors.

Client validation should match the backend rules where practical, but database validation remains authoritative.

### 12.7 Campus

Each request references an approved campus record.

The initial campus options remain:

- Burnaby
- Surrey
- Vancouver

The backend must reject unknown campus identifiers.

The client may continue to default visually to Burnaby, but the submitted request must contain a valid reviewed campus ID.

Campus filtering should query the campus relationship rather than comparing inconsistent display strings.

### 12.8 Item or task size

The initial item-size values are:

- `small`
- `medium`
- `large`

These map to the existing UI labels:

- Small
- Medium
- Large

The field represents the approximate size or effort expected for the request.

The product may later replace this with category-specific effort fields, but the first migration should preserve the current shared behavior.

### 12.9 Points

Request points are CampusClutch application points, not money.

The initial backend rule is:

- Points are stored as an integer.
- Points must be greater than zero.
- Decimal values are rejected.
- Empty values are rejected.
- Negative values are rejected.
- The client cannot submit text as a numeric value.
- The database applies the final positive-integer constraint.

The initial request system does not promise:

- Cash value
- Transferability
- Refunds
- Purchases
- Withdrawals
- A user points balance
- Financial settlement

A future points ledger or rewards system requires a separate reviewed architecture and must not be inferred from this request field.

### 12.10 Deadlines

`deadline_at` stores the request deadline as a timestamp with time zone.

The planned behavior is:

- The client displays dates in the user's local timezone.
- The backend stores one consistent timestamp representation.
- A new request deadline must be in the future at creation time.
- An owner may not edit a deadline to a past value.
- Deadline validation must occur in trusted backend logic.
- Expired requests must not remain indefinitely in the normal open feed.
- Deadline comparisons must use server time rather than trusting the device clock.

The final product must decide whether expired requests:

- Transition automatically to `expired`
- Are excluded through query logic
- Are changed through a scheduled backend process

The initial architecture prefers an explicit `expired` status once a reliable scheduled transition is introduced.

### 12.11 Request lifecycle statuses

The proposed persisted request statuses are:

- `open`
- `accepted`
- `completed`
- `cancelled`
- `expired`

#### Open

- The request is available for help offers.
- It may have zero or more pending offers.
- The owner may edit approved fields.
- The owner may cancel it.

#### Accepted

- One offer has been accepted.
- New offers are blocked.
- The accepted helper and owner receive approved access.
- Most request details become locked.

#### Completed

- The request was completed.
- New offers are blocked.
- The record remains available according to history and retention rules.

#### Cancelled

- The owner or trusted moderator cancelled the request.
- New offers are blocked.
- It is excluded from the normal open feed.

#### Expired

- The deadline passed without completion or acceptance.
- New offers are blocked.
- It is excluded from the normal open feed.

### 12.12 Existing `offered` status

The current local model contains an `offered` request status.

The backend plan will not persist `offered` as a request lifecycle status.

Instead:

- Pending offers are stored in `request_offers`.
- Whether an open request has pending offers is derived from those records.
- The request can remain `open` while pending offers exist.
- Accepting an offer transitions the request to `accepted`.
- Withdrawing or rejecting all offers does not require restoring a separate request status.

This avoids maintaining duplicated state between `requests` and `request_offers`.

The existing frontend type and UI must be updated carefully during the request-offer migration, not during Task 3.

### 12.13 Status transition rules

The initial allowed transitions are:

- `open` to `accepted`
- `open` to `cancelled`
- `open` to `expired`
- `accepted` to `completed`
- `accepted` to `cancelled` only through an approved cancellation workflow

The initial backend must reject transitions such as:

- `completed` back to `open`
- `cancelled` back to `open`
- `expired` directly to `completed`
- Client-created requests beginning as `accepted`
- Client-created requests beginning as `completed`
- A non-owner completing or cancelling a request without approved authorization

Accepted-offer handling must update the request and offer records atomically.

That operation will be defined in the Request Offers section.

### 12.14 Category-detail strategy

Category-specific data will use one-to-one detail tables instead of:

- A large number of unrelated nullable columns
- Unvalidated JSON supplied by the client
- Category-specific values stored only in display text

Each detail table uses `request_id` as:

- Its primary key
- A foreign key to `requests.id`

This enforces no more than one detail record of each kind for one request.

Trusted creation logic must verify that the detail-table type matches the main request category.

### 12.15 Delivery request details

The proposed `delivery_request_details` fields are:

| Field | Planned type | Required | Purpose |
|---|---|---:|---|
| `request_id` | UUID foreign key | Yes | Primary key and related request |
| `pickup_location` | Text | Yes | Where the item should be collected |
| `dropoff_location` | Text | Yes | Where the item should be delivered |
| `created_at` | Timestamp with time zone | Yes | Server-generated creation time |
| `updated_at` | Timestamp with time zone | Yes | Server-maintained modification time |

A delivery request must not be created without both locations.

The pickup and drop-off locations must not be treated as verified addresses unless a future location-verification feature is introduced.

### 12.16 Pickup request details

The proposed `pickup_request_details` fields are:

| Field | Planned type | Required | Purpose |
|---|---|---:|---|
| `request_id` | UUID foreign key | Yes | Primary key and related request |
| `pickup_location` | Text | Yes | Where the item should be collected |
| `destination` | Text | Yes | Where the item should be taken |
| `created_at` | Timestamp with time zone | Yes | Server-generated creation time |
| `updated_at` | Timestamp with time zone | Yes | Server-maintained modification time |

A pickup request must not be created without both required locations.

### 12.17 Event Help request details

The proposed `event_help_request_details` fields are:

| Field | Planned type | Required | Purpose |
|---|---|---:|---|
| `request_id` | UUID foreign key | Yes | Primary key and related request |
| `event_name` | Text | Yes | Name of the event |
| `help_needed` | Text | Yes | Description of the required help |
| `created_at` | Timestamp with time zone | Yes | Server-generated creation time |
| `updated_at` | Timestamp with time zone | Yes | Server-maintained modification time |

The event name and help description require their own reviewed length constraints.

### 12.18 Study Help request details

The proposed `study_help_request_details` fields are:

| Field | Planned type | Required | Purpose |
|---|---|---:|---|
| `request_id` | UUID foreign key | Yes | Primary key and related request |
| `course_or_subject` | Text | Yes | Relevant course or subject |
| `topic` | Text | Yes | Specific study topic |
| `created_at` | Timestamp with time zone | Yes | Server-generated creation time |
| `updated_at` | Timestamp with time zone | Yes | Server-maintained modification time |

A future version may reference an existing course record where appropriate.

The initial design keeps `course_or_subject` as text because Study Help may cover:

- A course the user has not joined in CampusClutch
- General subjects
- Admission or prerequisite material
- Non-course study topics

### 12.19 Atomic request creation

Creating a request requires:

1. Validating the authenticated user.
2. Inserting the main `requests` row.
3. Inserting exactly one matching category-detail row.
4. Returning the complete created request.
5. Rolling back the operation if any required step fails.

The preferred direction is a narrowly scoped database function.

The function must:

- Use the authenticated user as the owner.
- Ignore or reject a conflicting client owner ID.
- Validate the request category.
- Validate common fields.
- Validate category-specific fields.
- Insert only the matching detail type.
- Use a safe fixed search path.
- Avoid exposing administrative privileges.
- Return only fields needed by the client.
- Be covered by transaction and authorization tests.
- Be stored in a version-controlled migration.

The final function design must be reviewed before implementation.

### 12.20 Request feed queries

The normal request feed should return requests that are:

- Visible to the authenticated user
- In `open` status
- Not past the effective deadline
- Not removed by moderation
- Within approved campus or category filters
- Ordered predictably

The default ordering direction is:

1. Urgent requests
2. Newest requests
3. Request ID as a stable tie-breaker

The final query must support:

- Category filter
- Campus filter where the UI adds one
- Pagination
- Pull-to-refresh
- Empty results
- Stable ordering
- Result limits

The client should not download the entire request table and filter everything locally.

### 12.21 Request details queries

A request-details query should return:

- Common request fields
- Owner display information
- Campus information
- Matching category-specific details
- Approved status information
- Whether the signed-in user owns the request
- Whether the signed-in user has an existing offer
- Accepted-helper information only when authorized

The query must not return:

- Private owner account information
- Other users' private offer details
- Administrative moderation notes
- Push tokens
- Authentication metadata
- Unrelated detail-table rows

Old mock requests that have no category-specific data should be handled during migration without inventing backend records.

### 12.22 Editing requests

The owner may edit approved fields while the request is `open`.

Initially editable fields may include:

- Title
- Description
- Campus
- Room or specific location
- Deadline
- Points
- Item or task size
- Matching category-specific details
- Urgent indicator if the product retains it

The backend must enforce:

- The caller owns the request.
- The request is editable in its current status.
- The category cannot be changed after creation.
- The owner ID cannot be changed.
- The created timestamp cannot be changed.
- Status cannot be changed through a general edit request.
- Updated values satisfy all validation rules.
- A changed deadline remains valid.
- The category-detail row still matches the request category.

After an offer is accepted, normal detail editing should be locked.

Any exceptional edit after acceptance requires a separate reviewed workflow that informs the accepted helper.

### 12.23 Cancelling and deleting requests

Normal clients should cancel requests rather than hard-delete them.

Cancellation preserves:

- Offer history
- Conversation links
- Notification references
- Moderation evidence
- Product analytics
- Support investigation context

The initial cancellation rules are:

- The request owner may cancel an open request.
- Cancellation records `cancelled_at`.
- New offers are blocked.
- Existing pending offers transition according to the offer workflow.
- A request with an accepted offer requires an approved cancellation process.
- Non-owners cannot cancel the request.
- Trusted moderation may cancel a request for policy or safety reasons.

Permanent deletion is reserved for:

- Approved retention cleanup
- Account-deletion processing
- Legally required deletion
- Trusted administrative correction

The final privacy plan must define whether deleted user requests are removed, anonymized, or retained.

### 12.24 Urgent requests

The existing UI supports an urgent badge.

The initial architecture keeps `is_urgent` as a boolean but requires a product rule before production.

The rule must define:

- Who may mark a request urgent
- Whether all users receive the same limit
- Whether urgent marking is rate-limited
- Whether certain categories can be urgent
- Whether abuse removes urgent access
- How urgent requests affect ordering
- Whether urgent status expires

Urgency must not imply emergency-service availability or guaranteed assistance.

The application should include clear safety language before production.

### 12.25 Request visibility

The initial visibility direction is:

- Signed-out users cannot query requests.
- Authenticated users may read open, approved requests needed for the feed.
- Owners may read their own requests across approved statuses.
- Accepted helpers may read requests they are actively helping with.
- Completed and cancelled requests are not visible in the general feed.
- Historical visibility is limited to involved users and trusted administration.
- Moderated or removed requests are excluded from normal queries.

Future institution restrictions may further limit requests by:

- University
- Campus
- Course membership
- Verified-student status

These restrictions must be enforced in the backend, not only through client filters.

### 12.26 Row Level Security direction

RLS will be enabled on:

- `requests`
- `delivery_request_details`
- `pickup_request_details`
- `event_help_request_details`
- `study_help_request_details`

The initial policy direction is:

#### Requests: select

- Authenticated users may read approved open requests.
- Owners may read their own requests.
- Accepted helpers may read approved related requests.
- Signed-out clients receive no access.
- Removed or private records require trusted authorization.

#### Requests: insert

- The owner must match the authenticated user.
- The initial status must be `open`.
- Server-controlled timestamps must use approved defaults.
- All common fields must pass constraints.
- Preferred creation occurs through the reviewed request-creation function.

#### Requests: update

- Owners may update their own editable open requests.
- Ownership and category remain unchanged.
- General updates cannot bypass status-transition rules.
- The resulting row must continue to satisfy ownership and validation policies.

#### Requests: delete

- Normal authenticated clients do not directly delete request rows.
- Trusted retention or administration processes handle permanent deletion.

#### Detail tables

- Read access follows access to the related request.
- Creation occurs only for a matching request category.
- Owners may update details only while the related request is editable.
- Normal clients do not directly delete detail rows independently.
- A user cannot access details for a request they cannot read.

The final policies must avoid exposing a detail row through a weaker rule than the parent request.

### 12.27 Grants and function access

RLS policies do not replace object-level grants.

The final migration must explicitly review:

- Which tables the `authenticated` role may select
- Whether direct inserts are allowed
- Whether direct updates are allowed
- Which database functions may be executed
- Whether anonymous access is denied
- Whether administrative functions are placed outside exposed schemas
- Whether function search paths are fixed
- Whether any function unintentionally bypasses RLS

The request-creation and status-transition functions should expose the minimum required capability.

### 12.28 Request indexes

The final schema should consider indexes for:

- Owner ID
- Category
- Status
- Campus ID
- Deadline
- Created timestamp
- Urgent open-feed ordering
- Owner request history
- Accepted-helper lookup through request offers
- Foreign keys on each detail table

A likely feed index may include fields used together for:

- Open status
- Category
- Campus
- Urgent ordering
- Creation ordering

The exact index order must be based on final queries and query-plan testing.

Foreign-key indexes and RLS lookup columns require explicit review.

### 12.29 Realtime behavior

The initial request feed does not require a permanent realtime subscription.

The first backend version should prefer:

- Fetch on screen load
- Pull-to-refresh
- Refetch after request creation
- Refetch after editing or cancellation
- Refetch after returning from request details

Realtime may later support:

- New nearby requests
- Status changes
- Accepted-offer changes
- Request removals

Realtime subscriptions must apply the same visibility expectations as normal queries.

Realtime must not become the only source of request state.

### 12.30 Mock-data migration

The request migration should occur after authentication, profiles, courses, and memberships are stable.

A proposed focused migration order is:

1. Add request enums, tables, constraints, and policies.
2. Add category-detail tables.
3. Add the reviewed request-creation function.
4. Add typed request data-access functions.
5. Load the request feed from Supabase.
6. Load request details from Supabase.
7. Persist Create Request submissions.
8. Add owner edit and cancellation behavior.
9. Add loading, empty, error, retry, and refresh states.
10. Preserve the current Android form and keyboard fixes.
11. Verify new requests appear at the top of the feed.
12. Remove `RequestsContext` persistence only after the replacement works.
13. Retain required UI types while gradually replacing mock-specific fields.
14. Do not migrate Offer Help until the Request Offers task.

Shared mock requests must not be presented as real student-created production records.

Development fixtures should use clearly identified test accounts and migrations or seed data.

### 12.31 Request UX requirements

Backend-backed request screens must eventually define:

- Feed loading state
- Feed empty state
- Filtered empty state
- Feed error state
- Retry behavior
- Pull-to-refresh
- Pagination loading
- Request-details loading state
- Request Not Found state
- Authorization failure state
- Create submitting state
- Duplicate-submit protection
- Create success state
- Field-level validation
- Server-validation errors
- Edit submitting state
- Cancel confirmation
- Cancel submitting state
- Expired-request state
- Completed-request state
- Offline behavior
- Safe optimistic behavior only where rollback is clear

The existing approximately one-second success transition may remain only if it does not hide a failed backend write.

A request must not appear successfully posted until the backend confirms creation.

### 12.32 Request testing requirements

The request milestone must eventually test:

- Authenticated request creation
- Signed-out request creation rejection
- Owner ID spoofing rejection
- Every supported request category
- Missing category-detail fields
- Mismatched category-detail type
- Duplicate category-detail prevention
- Empty title
- Empty description
- Invalid campus
- Invalid item size
- Empty points
- Zero points
- Negative points
- Decimal points
- Past deadline
- Valid future deadline
- Server-time deadline validation
- Feed category filtering
- Feed campus filtering
- Stable feed ordering
- Urgent ordering
- Pagination
- Request-details query
- Owner profile display
- Owner edit while open
- Non-owner edit rejection
- Category-change rejection
- Owner cancellation
- Non-owner cancellation rejection
- Edit after acceptance rejection
- Completed request immutability
- Expired request exclusion
- Hidden or moderated request exclusion
- Detail-row authorization
- Atomic rollback when detail creation fails
- Network failure
- Duplicate submission
- RLS policy tests
- Query-plan and index review

## 13. Request Offers

### 13.1 Goals

The request-offer architecture must support:

- Persistent Offer Help actions
- One offer per user per request
- Pending, accepted, rejected, and withdrawn states
- Request-owner review
- Owner acceptance and rejection
- Offerer withdrawal
- One accepted offer per request
- Atomic request and offer status changes
- Approved notifications
- Future conversation creation or linking
- Backend-enforced ownership and authorization
- Gradual replacement of the current local Offer Help state

The initial implementation must preserve the existing request-details experience while replacing temporary local state with persistent records.

### 13.2 Core relationship

The planned offer domain contains:

- `request_offers`

The relationships are:

- One request may receive many offers.
- One profile may submit offers to many requests.
- One offer belongs to exactly one request.
- One offer belongs to exactly one offering user.
- One request may have no more than one accepted offer.
- One user may have no more than one offer record for the same request.

The request owner is derived through the related request and is not duplicated as an editable offer field.

### 13.3 Proposed request-offer fields

The proposed `request_offers` fields are:

| Field | Planned type | Required | Purpose |
|---|---|---:|---|
| `id` | UUID | Yes | Primary key |
| `request_id` | UUID foreign key | Yes | Related request |
| `offering_user_id` | UUID foreign key | Yes | Profile offering help |
| `status` | Text or enum | Yes | Pending, accepted, rejected, or withdrawn |
| `message` | Text | No | Optional short message from the offering user |
| `created_at` | Timestamp with time zone | Yes | Server-generated creation time |
| `updated_at` | Timestamp with time zone | Yes | Server-maintained modification time |
| `decided_at` | Timestamp with time zone | No | When the owner accepted or rejected the offer |
| `withdrawn_at` | Timestamp with time zone | No | When the offering user withdrew the offer |

Potential future fields include:

- Proposed completion time
- Availability information
- Owner response
- Cancellation reason
- Moderation state
- Safety acknowledgements

These fields should not be added before the product requires them.

### 13.4 Offer statuses

The supported offer statuses are:

- `pending`
- `accepted`
- `rejected`
- `withdrawn`

#### Pending

- The offering user has offered help.
- The request owner has not accepted or rejected it.
- The offering user may withdraw it.
- The request owner may accept or reject it.
- The request remains `open`.

#### Accepted

- The request owner selected this offer.
- The related request transitions to `accepted`.
- Other pending offers are no longer eligible for acceptance.
- The owner and accepted helper gain the approved relationship access.
- The offer cannot be withdrawn through the normal pending-offer action.

#### Rejected

- The request owner declined the offer.
- The request may remain open for other offers.
- The rejected offering user cannot change the same record back to pending.
- A future re-offer rule must be explicitly designed before allowing another offer.

#### Withdrawn

- The offering user withdrew a pending offer.
- The request may remain open.
- The owner cannot accept the withdrawn offer.
- Re-offer behavior must follow the approved duplicate and history rules.

### 13.5 Duplicate-offer prevention

The database must enforce uniqueness across:

- `request_id`
- `offering_user_id`

This prevents:

- Rapid duplicate taps creating multiple offers
- Retry requests inserting duplicate rows
- Two devices creating separate offers for the same user and request
- Client bugs bypassing local duplicate-submit controls

The preferred initial rule is one permanent offer record per user per request.

Under this rule:

- A rejected or withdrawn offer remains as history.
- The same user cannot create a new second row for that request.
- Re-offering would require an approved state-transition workflow rather than another insert.

A future product decision may allow re-offering, but it must preserve history and abuse controls.

### 13.6 One accepted offer per request

The database must guarantee that only one offer can have `accepted` status for a request.

The planned direction is a unique partial index covering:

- `request_id`
- Only rows where `status = 'accepted'`

Application logic must not be the only protection.

This constraint prevents:

- Two owners' devices accepting different offers simultaneously
- Duplicate acceptance requests
- Race conditions creating multiple accepted helpers
- Inconsistent request and conversation state

The accepted-offer constraint works together with transactional acceptance logic.

### 13.7 Offer creation requirements

A user may create an offer only when:

- The user is authenticated.
- The offering user ID matches the authenticated user.
- The request exists.
- The request is `open`.
- The request deadline has not passed.
- The request is visible to the user.
- The user does not own the request.
- The user does not already have an offer for the request.
- The request is not removed or restricted by moderation.

The backend must reject:

- Signed-out offers
- Offers submitted as another profile
- Offers on the user's own request
- Duplicate offers
- Offers on accepted requests
- Offers on completed requests
- Offers on cancelled requests
- Offers on expired requests
- Offers after the effective deadline
- Offers on inaccessible requests

### 13.8 Optional offer message

An offer may include a short optional message.

The final implementation should:

- Trim leading and trailing whitespace.
- Convert an empty trimmed value to `null`.
- Apply a reviewed maximum length.
- Store plain text.
- Display it safely.
- Reject oversized input.
- Avoid including sensitive contact information by default.

The product must decide whether phone numbers, personal email addresses, or off-platform contact details are permitted.

Until that policy is approved, the UI should encourage communication through CampusClutch messaging.

### 13.9 Offer creation workflow

The planned Offer Help workflow is:

1. The authenticated user opens an eligible request.
2. The application checks whether the user already has an offer.
3. The user presses Offer Help.
4. The button enters a submitting state.
5. The backend verifies the request and offering user.
6. The backend creates one pending offer.
7. Database uniqueness prevents duplicates.
8. A notification record is created for the request owner.
9. The application receives the confirmed offer.
10. The button changes to an offer-submitted state.

The UI must not display success until the backend confirms creation.

A repeated request caused by a timeout must result in either:

- The already-created offer being returned safely; or
- A clear duplicate-offer response that the client maps to the existing submitted state.

### 13.10 Offer Sent UI state

The current local `Offer Sent` state should eventually be derived from the signed-in user's persisted offer.

Possible UI states include:

- `Offer Help`
- `Sending...`
- `Offer Sent`
- `Offer Accepted`
- `Offer Rejected`
- `Offer Withdrawn`
- `Request Unavailable`

Reopening the request screen must load the existing offer state from the backend.

The button must not reset merely because the screen was reopened.

### 13.11 Offer withdrawal

The offering user may withdraw only their own pending offer.

The withdrawal operation must verify:

- The caller is authenticated.
- The caller owns the offer.
- The offer is pending.
- The request has not already accepted the offer.
- The resulting status is `withdrawn`.

The backend maintains:

- `status`
- `withdrawn_at`
- `updated_at`

The offering user must not be able to:

- Withdraw another user's offer
- Withdraw an accepted offer through the pending workflow
- Withdraw a rejected offer
- Change a withdrawn offer directly back to pending

Withdrawal should preserve the offer record.

### 13.12 Owner offer list

A request owner should be able to view offers only for requests they own.

The owner-offer query may return:

- Offer ID
- Offering profile ID
- Display name
- Avatar reference
- Major
- Year of study
- Campus
- Approved shared interests
- Approved shared-course information
- Optional offer message
- Offer status
- Created timestamp

It must not return:

- Authentication email
- Tokens
- Push-notification tokens
- Private profile settings
- Offers belonging to unrelated requests
- Moderation notes not intended for the owner

The query should support stable ordering and pagination if offer volume requires it.

### 13.13 Owner acceptance

Only the request owner may accept an offer.

Acceptance must verify:

- The caller is authenticated.
- The caller owns the related request.
- The request is still `open`.
- The request deadline has not invalidated acceptance.
- The selected offer belongs to the request.
- The selected offer is `pending`.
- No accepted offer already exists.
- The offering user remains eligible to participate.
- The request and offer have not been removed by moderation.

A normal client must not accept an offer by directly updating arbitrary rows.

### 13.14 Atomic acceptance workflow

Offer acceptance changes multiple related records and must run in one database transaction.

The planned transaction is:

1. Lock the request row.
2. Confirm that the request remains `open`.
3. Lock or validate the selected offer row.
4. Confirm that the offer remains `pending`.
5. Confirm that the caller owns the request.
6. Change the selected offer to `accepted`.
7. Set its `decided_at` and `updated_at`.
8. Change other pending offers for the request to `rejected`.
9. Set their decision timestamps.
10. Change the request status to `accepted`.
11. Set the request's `accepted_at` and `updated_at`.
12. Create approved notification records.
13. Create or link the related conversation when that schema is available.
14. Return the accepted relationship.
15. Roll back every change if any required step fails.

The preferred direction is a narrowly scoped database function.

The function must:

- Use the authenticated caller.
- Verify request ownership explicitly.
- Use row locking to prevent concurrent acceptance.
- Use a fixed safe search path.
- Expose only the required operation.
- Return only approved fields.
- Avoid accepting client-provided owner identity.
- Be stored in a version-controlled migration.
- Be tested under simultaneous acceptance attempts.

### 13.15 Rejection workflow

Only the request owner may reject a pending offer on their request.

Rejection must:

- Verify request ownership.
- Verify the offer belongs to that request.
- Require the offer to be pending.
- Change the status to `rejected`.
- Set `decided_at`.
- Update the timestamp.
- Preserve the offer record.
- Leave the request open unless another rule changes it.
- Create an approved notification for the offering user.

Rejecting one offer must not reject unrelated offers.

The owner may reject multiple pending offers individually.

### 13.16 Handling other pending offers after acceptance

When one offer is accepted, all other pending offers for that request should transition to `rejected`.

This prevents stale pending offers on a request that is no longer open.

The accepted transaction must:

- Reject only pending offers on the same request.
- Preserve already withdrawn or previously rejected offers.
- Record the decision time.
- Generate notifications according to the notification strategy.
- Avoid exposing the accepted helper's private details to rejected users.

The product copy may distinguish between:

- Direct owner rejection
- Automatic closure because another offer was accepted

The database may use the same `rejected` status initially while notifications store an appropriate event type.

### 13.17 Request status synchronization

Offer and request status must remain consistent.

Required invariants include:

- A pending offer belongs only to an open request.
- An accepted offer belongs to an accepted request.
- An open request has no accepted offer.
- An accepted request has exactly one accepted offer.
- A completed request retains its accepted offer history.
- A cancelled or expired request has no pending offers.
- Accepting an offer changes the request to accepted.
- Rejecting or withdrawing one offer does not close an otherwise open request.

These invariants must be enforced through constraints, transaction functions, triggers only where justified, and security policies.

The client must not independently update request and offer states in separate calls.

### 13.18 Request cancellation with offers

Cancelling an open request must also resolve pending offers.

The planned cancellation transaction is:

1. Verify the caller owns the request.
2. Lock the request.
3. Confirm cancellation is allowed.
4. Change the request to `cancelled`.
5. Change pending offers to `rejected`.
6. Record timestamps.
7. Create approved notifications.
8. Commit all changes together.

A request with an accepted offer requires a separate cancellation workflow because both involved users may need:

- Notification
- Conversation history
- Safety or support information
- Reason tracking
- Dispute handling

The exact accepted-request cancellation behavior will be finalized during privacy and safety planning.

### 13.19 Request expiration with offers

When an open request expires:

- The request transitions to `expired`.
- Pending offers are no longer actionable.
- Pending offers transition to `rejected` or another approved terminal state.
- Offering users receive an approved notification where useful.
- The request disappears from the normal open feed.
- Offer history remains available to involved users according to retention rules.

Expiration should occur through trusted server time and a reliable scheduled process or transactional query strategy.

The mobile device clock must not control expiration.

### 13.20 Accepted-offer behavior

After acceptance:

- The request owner can see the accepted helper.
- The accepted helper can see the approved request details.
- Other offering users cannot see private acceptance details.
- New offers are blocked.
- Normal request editing is locked.
- Completion becomes available through an approved workflow.
- A one-to-one conversation is created or linked when messaging persistence exists.
- Notifications are generated for involved users.
- The relationship remains available after application restart.

Acceptance does not automatically mark the request completed.

### 13.21 Conversation creation or linking

The accepted request should eventually create or link to a one-to-one conversation between:

- The request owner
- The accepted helper

The Conversations and Messages section will define the exact schema.

The offer-acceptance architecture must support:

- Reusing an existing one-to-one conversation when appropriate
- Avoiding duplicate direct conversations
- Recording that the request is related to the conversation
- Authorizing both participants
- Creating the relationship atomically or through a reliable idempotent process
- Preventing rejected offering users from entering the conversation

Until persistent messaging is implemented, request acceptance may be stored without creating a conversation.

The messaging migration must later backfill or create the required conversation safely.

### 13.22 Notifications

The offer workflow may generate notifications for:

- New help offer
- Offer accepted
- Offer rejected
- Offer withdrawn where useful to the owner
- Another offer accepted
- Request cancelled
- Request expired

Notification creation must:

- Use trusted backend logic.
- Avoid trusting a client-provided recipient.
- Reference the related request and offer where appropriate.
- Avoid storing unnecessary private message content.
- Be idempotent where retries are possible.
- Remain separate from push delivery.

The Notifications section will define the complete record and delivery strategy.

### 13.23 Offer visibility

The initial offer-visibility rules are:

#### Offering user

May read:

- Their own offers
- Status and timestamps
- Approved related request information

May not read:

- Other users' offers
- Owner-only review data
- Private acceptance details unrelated to them

#### Request owner

May read:

- All approved offers on their own requests
- Approved offering-profile details
- Offer status and message

May not read:

- Offers on other owners' requests
- Private authentication information

#### Other authenticated users

May not read offer records unless a later approved relationship requires it.

#### Signed-out users

Receive no offer access.

#### Trusted administration

May access offers only through approved moderation or support authorization.

### 13.24 Row Level Security direction

RLS will be enabled on `request_offers`.

The initial policy direction is:

#### Select

- Offering users may read their own offers.
- Request owners may read offers attached to their own requests.
- Signed-out clients receive no access.
- Other authenticated users receive no access.
- Trusted moderation uses separate authorization.

#### Insert

- The offering user ID must match the authenticated user.
- The related request must be open and eligible.
- The offering user must not own the request.
- The initial status must be `pending`.
- Duplicate offers are rejected.
- Server-controlled timestamps use approved defaults.

#### Update

Normal direct client updates should be narrowly restricted.

- Offering users may withdraw their own pending offers through an approved operation.
- Request owners may accept or reject offers only through reviewed transactional functions.
- Users cannot change `request_id`.
- Users cannot change `offering_user_id`.
- Users cannot directly set an offer to accepted.
- Users cannot restore terminal offers to pending.

#### Delete

- Normal clients do not delete offer records.
- Trusted retention and administration processes handle permanent deletion.

RLS policies in exposed schemas must explicitly target the authenticated role and use the authenticated user identity. Supabase recommends indexing policy columns and avoiding unrestricted scans even when RLS is present. :contentReference[oaicite:2]{index=2}

### 13.25 Function-security direction

Transactional offer functions may require broader database access than one direct table update.

Any function must:

- Verify `auth.uid()` is present.
- Verify the caller's relationship to the request or offer.
- Use a fixed search path.
- Be placed in an appropriate schema.
- Receive only required identifiers and approved user input.
- Avoid accepting role or owner claims from the client.
- Restrict execution grants.
- Avoid returning unrelated rows.
- Be tested against RLS bypass risks.
- Be reviewed if declared `security definer`.

Supabase warns that security-definer functions can bypass RLS and should not be created casually in exposed schemas. :contentReference[oaicite:3]{index=3}

### 13.26 Grants

The final migration must explicitly review:

- `SELECT` access for offering users and request owners
- Whether direct `INSERT` is permitted
- Whether withdrawal uses direct update or a function
- Whether accept and reject functions are executable by `authenticated`
- Whether anonymous execution is denied
- Whether table-level update privileges are narrower than policy intent
- Whether column-level grants are useful
- Whether administrative functions remain unavailable to the mobile client

RLS and SQL grants must work together.

### 13.27 Indexes

The final schema should consider indexes for:

- Request ID
- Offering user ID
- Offer status
- Offer creation timestamp
- Owner-offer list queries
- User offer-history queries
- Pending offers for one request
- Accepted offer lookup
- RLS relationship checks

Required uniqueness includes:

- One offer row per request and offering user
- One accepted offer per request

Foreign-key and RLS columns require explicit index review.

Indexes must be tested against actual query plans.

### 13.28 Concurrency and idempotency

The offer workflow must handle:

- Rapid duplicate Offer Help taps
- Retry after network timeout
- Two owner devices accepting different offers
- Withdrawal during owner acceptance
- Request cancellation during acceptance
- Request expiration during acceptance
- Duplicate notification creation
- Duplicate conversation creation

Database constraints, transactions, row locking, and idempotent functions must protect the data.

The client must not attempt to solve race conditions using only disabled buttons or local state.

### 13.29 Realtime behavior

Realtime may be useful for:

- New offers arriving on an owner's request
- Offer status changing
- Request acceptance
- Request cancellation
- Request expiration

The first persistent implementation may begin with:

- Fetch on screen load
- Refetch after mutation
- Pull-to-refresh
- Refetch when returning to the screen

Realtime should be added only after authorization and subscription cleanup are tested.

Realtime events must not expose offer data to unauthorized users.

### 13.30 Mock-state migration

The Request Offers migration should occur after persistent requests work.

A proposed focused migration order is:

1. Add offer enum, table, constraints, and indexes.
2. Add RLS and grants.
3. Add typed offer data-access functions.
4. Persist Offer Help.
5. Load the signed-in user's existing offer on request details.
6. Add the owner's offer-management screen or section.
7. Add withdrawal.
8. Add transactional rejection.
9. Add transactional acceptance.
10. Synchronize request status.
11. Add notification records.
12. Link or create conversations when messaging is ready.
13. Remove the local Offer Help state.
14. Preserve current request navigation and Android behavior.
15. Test restart and multi-device behavior.

### 13.31 Offer UX requirements

Backend-backed offer flows must eventually define:

- Existing-offer loading state
- Offer submitting state
- Duplicate-submit protection
- Offer success state
- Offer creation failure
- Request no longer available state
- Own-request restriction
- Withdraw confirmation
- Withdraw submitting state
- Owner offer-list loading
- Owner offer-list empty state
- Owner offer-list error state
- Accept confirmation
- Accept submitting state
- Reject confirmation
- Reject submitting state
- Concurrent-decision error
- Accepted state
- Rejected state
- Withdrawn state
- Retry behavior
- Offline behavior
- Clear rollback after failed optimistic updates

An acceptance success state must not display before the complete backend transaction commits.

### 13.32 Offer testing requirements

The request-offer milestone must eventually test:

- Authenticated offer creation
- Signed-out offer rejection
- Owner-ID spoofing rejection
- Offer on own request rejection
- Duplicate offer prevention
- Rapid duplicate tap
- Offer on open request
- Offer on accepted request rejection
- Offer on completed request rejection
- Offer on cancelled request rejection
- Offer on expired request rejection
- Offer after deadline rejection
- Optional message validation
- Offering user reads own offer
- Offering user cannot read another user's offer
- Request owner reads offers on own request
- Owner cannot read unrelated offers
- Offering user withdraws pending offer
- User cannot withdraw another user's offer
- Accepted offer cannot be normally withdrawn
- Owner rejects pending offer
- Non-owner rejection fails
- Owner accepts pending offer
- Non-owner acceptance fails
- One accepted offer per request
- Other pending offers rejected after acceptance
- Request transitions to accepted
- Acceptance rolls back fully on failure
- Two simultaneous acceptance attempts
- Withdrawal concurrent with acceptance
- Cancellation concurrent with acceptance
- Expiration concurrent with acceptance
- Notification idempotency
- Conversation-link idempotency
- Application restart preserves offer state
- RLS policy tests
- Function-execution grant tests
- Query-plan and index review

## 14. Conversations and Messages

### 14.1 Goals

The conversations and messages architecture must support:

- Persistent one-to-one conversations
- Persistent group conversations
- Conversation membership
- Unique membership records
- Persistent messages
- Message sender authorization
- Read and unread state
- Inbox ordering
- Request-linked conversations
- Realtime message delivery
- Application restart and multi-device synchronization
- Loading, empty, error, and retry states
- Gradual replacement of local mock conversations and messages

Persistent database rows remain the source of truth.

Realtime events improve responsiveness but do not replace stored conversation, membership, message, or read-state records.

### 14.2 Core records

The planned messaging domain contains:

- `conversations`
- `conversation_members`
- `direct_conversation_pairs`
- `messages`
- `request_conversations`

The relationships are:

- One conversation has many members.
- One profile may belong to many conversations.
- One conversation contains many messages.
- One message has one sender.
- One direct conversation represents exactly one normalized pair of users.
- One accepted request links to no more than one conversation.
- One direct conversation may be linked to multiple accepted requests involving the same users.

### 14.3 Conversation types

The supported conversation types are:

- `direct`
- `group`

#### Direct conversation

A direct conversation:

- Represents two users.
- Has exactly two active members.
- Has no user-editable group title.
- Should be reused when the same two users start another direct chat.
- May be created from a student profile.
- May be created or linked after a request offer is accepted.

#### Group conversation

A group conversation:

- Has two or more members.
- Has a title.
- May have an optional group avatar later.
- Supports owner, administrator, and member roles.
- Requires approved membership-management rules.

The initial backend should not introduce public open chat rooms.

### 14.4 Conversations table

The proposed `conversations` fields are:

| Field | Planned type | Required | Purpose |
|---|---|---:|---|
| `id` | UUID | Yes | Primary key |
| `type` | Text or enum | Yes | Direct or group |
| `title` | Text | For groups | User-facing group title |
| `created_by` | UUID foreign key | Yes | Profile that initiated the conversation |
| `status` | Text or enum | Yes | Active, closed, or removed |
| `created_at` | Timestamp with time zone | Yes | Server-generated creation time |
| `updated_at` | Timestamp with time zone | Yes | Server-maintained modification time |
| `last_message_at` | Timestamp with time zone | No | Time of the latest persisted message |

Potential future fields include:

- Group avatar path
- Group description
- Moderation state
- Retention category
- Last system-event timestamp

These fields should not be added until required.

### 14.5 Conversation statuses

The proposed conversation statuses are:

- `active`
- `closed`
- `removed`

#### Active

- Approved members may read messages.
- Approved members may send messages.
- Membership changes follow the conversation type's rules.

#### Closed

- Historical messages remain readable to approved members.
- New messages are blocked.
- Reopening requires a reviewed workflow.

#### Removed

- The conversation is unavailable to normal users.
- Trusted moderation or retention processing controls access.
- The record may remain for investigation or deletion processing.

Normal mobile clients must not directly change arbitrary conversation statuses.

### 14.6 Conversation members

`conversation_members` implements the many-to-many relationship between conversations and profiles.

The proposed fields are:

| Field | Planned type | Required | Purpose |
|---|---|---:|---|
| `conversation_id` | UUID foreign key | Yes | Related conversation |
| `profile_id` | UUID foreign key | Yes | Related member |
| `role` | Text or enum | Yes | Owner, administrator, or member |
| `membership_status` | Text or enum | Yes | Active, left, or removed |
| `joined_at` | Timestamp with time zone | Yes | When the user joined |
| `left_at` | Timestamp with time zone | No | When the user left |
| `last_read_sequence` | Big integer | Yes | Highest message sequence confirmed read |
| `last_read_at` | Timestamp with time zone | No | Time read state was updated |
| `archived_at` | Timestamp with time zone | No | User-specific inbox archive state |
| `muted_until` | Timestamp with time zone | No | Optional notification mute |
| `created_at` | Timestamp with time zone | Yes | Server-generated creation time |
| `updated_at` | Timestamp with time zone | Yes | Server-maintained modification time |

The preferred primary key is the composite key:

- `conversation_id`
- `profile_id`

This prevents duplicate membership rows for the same user and conversation.

### 14.7 Membership roles

The proposed membership roles are:

- `owner`
- `administrator`
- `member`

#### Owner

- Creates or owns a group conversation.
- May perform approved group-management actions.
- A group must retain at least one approved owner.

#### Administrator

- May perform approved member-management actions.
- Cannot exceed the owner's authority.
- Does not receive backend privileges outside the conversation.

#### Member

- May read and send messages while active.
- Cannot manage other members unless explicitly authorized.

Direct conversations should use `member` for both participants.

A client-controlled profile field must not grant group-administrator privileges.

### 14.8 Membership statuses

The proposed membership statuses are:

- `active`
- `left`
- `removed`

#### Active

- The user may access the conversation according to policy.
- The conversation appears in the user's normal inbox unless archived.

#### Left

- The user voluntarily left a group.
- The user cannot send new messages.
- Historical access depends on the approved product and privacy policy.

#### Removed

- A group owner, administrator, or trusted moderator removed the user.
- New message access is blocked.
- Historical access depends on the approved product and safety policy.

Direct-conversation membership should not normally transition to `left`.

A user may archive or mute a direct conversation without deleting membership.

### 14.9 Direct-conversation uniqueness

A direct conversation must be unique for one pair of users.

Membership rows alone do not provide a simple database guarantee that two users cannot have multiple direct conversations.

The planned design uses `direct_conversation_pairs` with:

| Field | Planned type | Required | Purpose |
|---|---|---:|---|
| `conversation_id` | UUID foreign key | Yes | Primary key and related direct conversation |
| `user_low_id` | UUID foreign key | Yes | Lower normalized UUID |
| `user_high_id` | UUID foreign key | Yes | Higher normalized UUID |
| `created_at` | Timestamp with time zone | Yes | Server-generated creation time |

The database must enforce:

- `user_low_id` is different from `user_high_id`.
- The two IDs use one deterministic ordering.
- The pair `(user_low_id, user_high_id)` is unique.
- The related conversation type is `direct`.
- Both users have active membership in the related conversation.

The normalized pair prevents `User A + User B` and `User B + User A` from producing separate direct chats.

### 14.10 Starting a direct conversation

Starting a direct conversation should use an idempotent database function.

The planned operation is:

1. Verify the caller is authenticated.
2. Accept the intended other profile ID.
3. Reject a conversation with the caller themselves.
4. Verify the other profile is eligible and accessible.
5. Normalize the two profile IDs.
6. Look for an existing direct pair.
7. Return the existing active conversation when found.
8. Otherwise create one direct conversation.
9. Create the normalized pair record.
10. Create exactly two active memberships.
11. Return the conversation.
12. Roll back all inserts if any step fails.

The function must:

- Use a fixed safe search path.
- Use database uniqueness to resolve concurrent creation.
- Avoid trusting a client-provided creator identity.
- Return only an authorized conversation.
- Be safe to retry after a timeout.
- Be stored in a version-controlled migration.
- Be tested under simultaneous creation attempts.

### 14.11 Group-conversation creation

Creating a group conversation should also use an atomic operation.

The planned operation is:

1. Verify the caller is authenticated.
2. Validate and trim the group title.
3. Validate the proposed member IDs.
4. Remove duplicate member IDs.
5. Include the creator automatically.
6. Verify all proposed members are eligible.
7. Create the group conversation.
8. Add the creator as owner.
9. Add other users as members.
10. Return the complete conversation summary.
11. Roll back if any required membership insert fails.

The initial product should define:

- Minimum member count
- Maximum member count
- Maximum title length
- Who may create groups
- Whether all proposed users must share a course or other relationship
- Whether users may decline group invitations

Until invitation behavior is implemented, group creation should be limited to approved relationships and conservative member limits.

### 14.12 Group membership management

Group membership changes must use reviewed operations.

Possible approved actions include:

- Owner adds a member
- Owner removes a member
- Administrator adds or removes a member
- Member leaves the group
- Owner transfers ownership
- Owner promotes or demotes an administrator

The backend must prevent:

- A normal member managing other members
- Adding the same profile twice
- Removing users from unrelated conversations
- Removing the final owner without replacement
- Adding signed-out or nonexistent profiles
- Adding users who are blocked or ineligible
- Direct-conversation membership changes through group operations

Membership history should normally remain as status transitions rather than hard deletion.

### 14.13 Messages table

The proposed `messages` fields are:

| Field | Planned type | Required | Purpose |
|---|---|---:|---|
| `id` | UUID | Yes | Public message identifier |
| `sequence_number` | Generated big integer | Yes | Stable ordering and read-state cursor |
| `conversation_id` | UUID foreign key | Yes | Related conversation |
| `sender_id` | UUID foreign key | Yes | Profile that sent the message |
| `client_message_id` | UUID | Yes | Client-generated retry identifier |
| `message_type` | Text or enum | Yes | Initially text or system |
| `body` | Text | Depends on type | Message text |
| `created_at` | Timestamp with time zone | Yes | Server-generated send time |
| `edited_at` | Timestamp with time zone | No | Reserved for later editing |
| `deleted_at` | Timestamp with time zone | No | Reserved for later soft deletion |

The initial messaging milestone should support persistent text messages.

Attachments, reactions, replies, edits, and user deletion require later focused designs.

### 14.14 Message sequence

`sequence_number` provides a stable server-generated order.

It supports:

- Consistent pagination
- Inbox last-message queries
- Read cursors
- Unread counts
- Tie-breaking when timestamps are equal
- Multi-device synchronization

The sequence number does not replace the public UUID message ID.

Clients must not supply or modify sequence numbers.

Queries should order messages by sequence number rather than trusting client timestamps.

### 14.15 Message sender

`sender_id` identifies the authenticated profile that created the message.

The backend must enforce:

- The caller is authenticated.
- The sender ID matches the caller.
- The caller has active conversation membership.
- The conversation is active.
- The caller has not left or been removed.
- The sender ID cannot be changed later.

Profile names and avatars are loaded through the profile relationship.

They should not be copied into every message row.

### 14.16 Message body validation

The initial message body is plain text.

The implementation must:

- Trim or evaluate whitespace-only input consistently.
- Reject an empty or whitespace-only message.
- Apply a reviewed maximum length.
- Preserve international text and emoji.
- Store no client-supplied HTML rendering.
- Display text safely.
- Avoid logging private message content.
- Return understandable validation errors.

The current multiline composer should remain supported.

A future attachment message may allow a null text body only when a valid attachment record exists.

### 14.17 Message idempotency

Each message includes a client-generated `client_message_id`.

The database should enforce uniqueness across:

- `sender_id`
- `client_message_id`

This protects against:

- Duplicate Send taps
- Retry after a network timeout
- Repeated mutation requests
- Temporary client reconnects

When the same idempotency key is retried, the data-access layer should return the existing authorized message or a response the client can safely reconcile.

The client-message ID is not used for global message ordering.

### 14.18 Sending a message

The planned send operation is:

1. The authenticated user enters a valid message.
2. The client creates one retry-safe client message ID.
3. The composer enters a sending state.
4. The backend verifies active membership.
5. The backend verifies the conversation is active.
6. The backend inserts the message using the authenticated sender.
7. The database assigns sequence and creation time.
8. The conversation's `last_message_at` is updated safely.
9. Approved notification records are created for other active members.
10. The confirmed message is returned.
11. Realtime distributes the persisted change to active authorized subscribers.

The UI must clearly distinguish:

- Sending
- Sent
- Failed
- Retrying

A failed backend insert must not permanently appear as a successful message.

### 14.19 Message mutation policy

The initial messaging milestone should treat sent messages as immutable through the normal client.

Initially:

- Users may insert authorized messages.
- Users may not change message sender.
- Users may not move messages between conversations.
- Users may not directly edit persisted message bodies.
- Users may not hard-delete message rows.
- Trusted moderation and retention processes remain separate.

Message editing, user deletion, and soft deletion require explicit product rules for:

- Edit windows
- Edit history
- Deletion visibility
- Notification behavior
- Safety investigations
- Legal retention

The nullable edit and deletion timestamps reserve a migration path without enabling those actions immediately.

### 14.20 System messages

`system` messages may later represent trusted conversation events such as:

- A request offer was accepted
- A group member joined
- A group member left
- A group title changed
- A request was completed

Normal clients must not create arbitrary system messages.

System messages require trusted database or server-side creation.

The initial messaging implementation may omit system messages until their generating workflows are ready.

### 14.21 Read and unread design

Read state belongs to each conversation membership.

The planned fields are:

- `last_read_sequence`
- `last_read_at`

Unread messages are derived from messages where:

- The conversation matches the membership.
- The message sequence is greater than `last_read_sequence`.
- The message was not sent by the current user.
- The message remains visible to the member.

The backend should not store a separate read row for every user and message in the initial version.

A per-message read-receipt system may be added later if the product requires it.

### 14.22 Updating read state

Read state should use a narrowly scoped operation.

The operation must:

1. Verify the caller is an active member.
2. Accept a message or sequence within that conversation.
3. Verify the target message belongs to the conversation.
4. Advance `last_read_sequence`.
5. Never move the read cursor backward.
6. Update `last_read_at`.
7. Return the updated unread state.

A client must not mark messages in another conversation as read.

The read operation should be safe to repeat.

### 14.23 Read receipts

The initial design supports unread counts but does not promise individual `Seen by` indicators.

Per-message read receipts can create:

- Additional privacy expectations
- More frequent writes
- More complex group-chat UI
- More notification and presence behavior

Before adding read receipts, the product must decide:

- Whether receipts are enabled by default
- Whether users can disable them
- Whether direct and group chats behave differently
- Whether only aggregate group read state is displayed
- How blocked and removed users are handled

### 14.24 Inbox query

The inbox should return only conversations where the signed-in user has approved membership.

Each inbox row may include:

- Conversation ID
- Conversation type
- Group title or direct participant
- Approved avatar
- Latest visible message preview
- Latest message timestamp
- Unread count
- Membership role
- Archive state
- Mute state
- Related-request indicator where useful

The query should:

- Exclude removed membership.
- Exclude archived conversations from the default inbox.
- Order by latest message time.
- Use a stable tie-breaker.
- Support pagination.
- Avoid exposing other conversations.
- Avoid returning full message history.

A security-invoker view or narrow database function may be evaluated after the final queries and RLS policies are known.

### 14.25 Message-history query

A message-history query must:

- Verify conversation membership.
- Return only messages in the requested conversation.
- Order by descending or ascending sequence consistently.
- Use cursor pagination.
- Limit each page.
- Avoid downloading the complete conversation.
- Return approved sender profile fields.
- Handle deleted or moderated messages according to policy.

The initial UI may load the newest page and request older pages as the user scrolls.

Offset pagination should be avoided for large message histories when a sequence cursor is available.

### 14.26 Direct-conversation header

A direct-conversation header should be derived from the other active member.

It may display:

- Display name
- Avatar
- Major
- Coarse activity indicator where permitted

The app must not rely on a conversation title copied from a profile.

This prevents stale names and avatars when a profile changes.

### 14.27 Group-conversation header

A group header may display:

- Group title
- Group avatar when implemented
- Active member count
- Approved participant preview

Group membership and role details should be loaded only for authorized members.

The current mock group header should be replaced gradually without breaking existing routing.

### 14.28 Request-linked conversations

Accepted requests should link to conversations through `request_conversations`.

The proposed fields are:

| Field | Planned type | Required | Purpose |
|---|---|---:|---|
| `request_id` | UUID foreign key | Yes | Primary key and accepted request |
| `conversation_id` | UUID foreign key | Yes | Related conversation |
| `created_at` | Timestamp with time zone | Yes | Server-generated link time |

This design allows:

- One accepted request to link to one conversation.
- One direct conversation to support multiple requests between the same users.
- Request details to navigate to the related chat.
- The conversation to show approved request context.
- Database uniqueness to prevent duplicate request links.

The request link does not give unrelated conversation members access to private request data.

### 14.29 Accepted request conversation workflow

When an offer is accepted and messaging persistence is available, the transaction should:

1. Identify the request owner.
2. Identify the accepted offering user.
3. Get or create their unique direct conversation.
4. Confirm both users have active membership.
5. Create the unique request-conversation link.
6. Create approved notifications.
7. Optionally create one trusted system message.
8. Return the linked conversation.
9. Roll back the acceptance workflow if required relationship creation fails.

The operation must be idempotent.

Retrying acceptance must not create:

- A second direct conversation
- Duplicate memberships
- A second request link
- Duplicate system messages
- Duplicate notifications

### 14.30 Conversation membership authorization

Only approved conversation members may read conversation data.

Authorization must verify:

- The caller is authenticated.
- A membership row exists.
- Membership status permits the requested action.
- The conversation status permits the requested action.

Active members may generally:

- Read the conversation
- Read approved members
- Read messages
- Send messages
- Update their own read state
- Archive or mute their own membership

Membership-management permissions depend on:

- Conversation type
- Member role
- Membership state
- Blocking and moderation rules

### 14.31 Row Level Security direction

RLS will be enabled on:

- `conversations`
- `conversation_members`
- `direct_conversation_pairs`
- `messages`
- `request_conversations`

The initial policy direction is:

#### Conversations: select

- Active approved members may read the conversation.
- Signed-out users receive no access.
- Nonmembers receive no access.
- Trusted moderation uses separate authorization.

#### Conversations: insert and update

- Normal clients do not directly create arbitrary conversation records.
- Direct and group creation use reviewed functions.
- General clients cannot change conversation type or creator.
- Status changes require approved operations.

#### Conversation members: select

- Users may read their own membership.
- Active members may read approved membership information for their conversation.
- Nonmembers receive no membership list.
- Direct-pair data is not generally exposed.

#### Conversation members: insert and update

- Membership changes use reviewed functions.
- Users may update only approved personal fields such as archive, mute, and read state.
- Users cannot promote themselves.
- Users cannot add themselves to unrelated conversations.
- Users cannot change another member through a generic update.

#### Messages: select

- Active approved conversation members may read visible messages.
- Signed-out users and nonmembers receive no access.

#### Messages: insert

- Sender ID must match the authenticated user.
- The sender must have active membership.
- The conversation must allow sending.
- The client message ID must satisfy idempotency rules.
- Message fields must satisfy validation constraints.

#### Messages: update and delete

- Normal clients cannot directly edit or delete persisted messages initially.
- Trusted moderation and retention use separate authorization.

#### Request-conversation links

- Involved request users and approved conversation members receive only the access required by the related feature.
- Normal clients cannot create arbitrary links.
- Link creation occurs through the accepted-offer transaction.

### 14.32 RLS helper-function safety

Conversation membership checks may be used by several policies.

A reviewed helper function may be needed to avoid:

- Repeating complex membership queries
- Circular RLS policy evaluation
- Infinite recursion
- Inconsistent access rules

Any helper function must:

- Accept only required identifiers.
- Check the authenticated user.
- Use a fixed safe search path.
- Return a narrow boolean or approved result.
- Restrict execution grants.
- Avoid exposing membership rows.
- Be reviewed before using `security definer`.
- Have indexed lookup paths.
- Be tested as member, nonmember, signed-out user, and trusted backend.

### 14.33 Realtime message delivery

The initial realtime direction is:

- Persist each message first.
- Subscribe only while an authenticated user is viewing or actively using messaging.
- Filter subscriptions by conversation where supported.
- Apply the same membership authorization as normal reads.
- Reconcile incoming events with existing messages using message ID and client message ID.
- Remove subscriptions when the screen unmounts, session changes, or membership ends.
- Refetch after reconnection to recover missed events.

The application must not assume that every realtime event is delivered exactly once.

Persistent queries remain necessary after:

- Application restart
- Network interruption
- Background suspension
- Token refresh
- Subscription failure

### 14.34 Postgres Changes and Broadcast

Postgres Changes is a suitable starting point for persisted message inserts because it follows database records and authorization.

However:

- Each event requires authorization against subscribers.
- High subscriber volume can increase authorization work.
- Filters and indexed membership checks are important.
- Delete events have limitations and should not be the basis of message-removal UX.
- Performance must be measured in preview testing.

Broadcast may later be considered when:

- Message-event throughput grows significantly
- Database-triggered broadcast provides a clearer fan-out model
- Private channel authorization is fully tested
- Persistent database writes remain the source of truth

The initial implementation should choose one approach and avoid running duplicate realtime pipelines without a clear reason.

### 14.35 Presence and typing indicators

Presence and typing indicators are optional later enhancements.

They must not be stored as permanent messages.

Potential ephemeral states include:

- User currently viewing the conversation
- Typing started
- Typing stopped
- Recently connected

The implementation must:

- Use private authorized channels.
- Avoid rapid uncontrolled updates.
- Expire stale typing state.
- Clean up state when the application backgrounds.
- Avoid presenting presence as guaranteed real-world availability.
- Respect future privacy settings.

Typing and presence are not required for the first persistent messaging milestone.

### 14.36 Push notifications

Realtime connections do not replace mobile push notifications.

When a recipient is offline or the app is suspended:

- A persistent notification record remains the source of in-app state.
- A trusted backend process may send a push notification.
- The Expo client must not contain server push credentials.
- Push payloads should reveal minimal private message content.
- User notification preferences must be respected.

The complete push strategy will be defined in the Notifications section.

### 14.37 Conversation archive and mute

Archive and mute are user-specific membership settings.

#### Archive

- Removes the conversation from the default inbox.
- Does not delete the conversation or messages.
- May be cleared when a new message arrives, depending on product rules.
- Must affect only the current user's membership.

#### Mute

- Suppresses approved notifications until a timestamp or indefinitely.
- Does not block message access.
- Does not affect other members.
- Does not change conversation authorization.

Archive and mute must not be stored as shared conversation fields.

### 14.38 Blocking and safety dependencies

User blocking has not yet been architected.

Before production messaging, the project must define:

- Whether blocked users can start new direct conversations
- Whether existing direct chats remain visible
- Whether blocked users can send new messages
- How shared group conversations behave
- How accepted request relationships are handled
- How reporting and moderation preserve evidence
- Whether safety notices are shown

The first messaging implementation must not be described as production-ready until blocking, reporting, moderation, and privacy rules are approved.

### 14.39 Message retention and account deletion

Message deletion behavior depends on the future privacy and retention plan.

Account deletion must decide whether authored messages are:

- Deleted
- Anonymized
- Retained with a deleted-user label
- Retained for a limited safety or legal period

Deleting an Auth user must not leave broken foreign-key relationships.

The final implementation may preserve conversation history while removing public profile identity, but that decision requires legal and privacy review.

### 14.40 Indexes

The final schema should consider indexes for:

- Conversation status
- Conversation last-message time
- Membership profile ID
- Membership conversation ID
- Membership status
- Direct normalized user pair
- Message conversation ID and sequence number
- Message sender ID
- Message client ID uniqueness
- Request-conversation conversation ID
- Inbox ordering
- Unread-count queries
- RLS membership checks

Likely important composite indexes include:

- Membership by profile and status
- Membership by conversation and status
- Messages by conversation and descending sequence
- Conversations by last-message time
- Unique direct-user pair
- Unique sender and client-message ID

Actual indexes must be confirmed with final queries and query-plan testing.

### 14.41 Realtime and query performance

Performance testing should consider:

- Number of active conversation subscriptions
- Message insert rate
- RLS membership-check cost
- Inbox query cost
- Unread-count query cost
- Message-history pagination
- Group membership size
- Reconnection behavior
- Duplicate-event reconciliation
- Realtime authorization latency

Realtime policy columns and membership lookups must be indexed.

The design should use filtered subscriptions and avoid one unrestricted messages-table subscription.

### 14.42 Mock-data migration

The messaging migration should occur after authentication, profiles, requests, and offers are persistent.

A proposed focused migration order is:

1. Add conversation, membership, pair, message, and request-link tables.
2. Add constraints, indexes, grants, and RLS.
3. Add direct-conversation get-or-create function.
4. Add group-creation function.
5. Add typed conversation data access.
6. Load the inbox from Supabase.
7. Load persistent message history.
8. Persist message sending.
9. Add idempotent retry handling.
10. Add read and unread state.
11. Add request-conversation linking.
12. Add realtime message inserts.
13. Add archive and mute.
14. Add approved group-member management.
15. Preserve Android keyboard behavior.
16. Remove obsolete local message arrays.
17. Remove obsolete mock inbox paths only after testing.
18. Decide whether `/messages/new` is needed after inspecting the final flow.

Mock classmate conversations must not be converted into real conversations involving nonexistent authenticated users.

Preview testing should use explicit development accounts.

### 14.43 Conversation UX requirements

Backend-backed conversation screens must eventually define:

- Inbox loading state
- Inbox empty state
- Inbox error state
- Retry behavior
- Pull-to-refresh
- Pagination
- Conversation loading state
- Conversation Not Found state
- Authorization failure state
- Empty conversation state
- Older-message loading
- Send submitting state
- Send failure state
- Retry failed message
- Duplicate reconciliation
- Offline composer behavior
- Reconnection behavior
- Group creation submitting state
- Member-management states
- Leave confirmation
- Archive behavior
- Mute behavior
- Closed-conversation state
- Removed-membership state

The current Android `KeyboardAvoidingView` behavior and multiline composer must be preserved.

### 14.44 Conversation and message testing requirements

The messaging milestone must eventually test:

- Create direct conversation
- Reuse existing direct conversation
- Reversed user order returns the same direct conversation
- Self-conversation rejection
- Concurrent direct-conversation creation
- Create group conversation
- Duplicate group member prevention
- Group owner assignment
- Unauthorized group management rejection
- Add group member
- Remove group member
- Leave group
- Final-owner protection
- Read own conversation
- Nonmember conversation access rejection
- Read membership list as member
- Nonmember membership access rejection
- Send text message
- Signed-out send rejection
- Sender spoofing rejection
- Nonmember send rejection
- Removed member send rejection
- Closed conversation send rejection
- Empty message rejection
- Oversized message rejection
- International text and emoji
- Duplicate client-message retry
- Stable message ordering
- Cursor pagination
- Read-state advancement
- Read cursor cannot move backward
- Unread-count calculation
- Inbox ordering
- Archive only affects current user
- Mute only affects current user
- Accepted request creates or links conversation
- Duplicate request-link prevention
- Request participants receive access
- Rejected offerer receives no conversation access
- Application restart preserves messages
- Multi-device message synchronization
- Realtime reconnect and refetch
- Duplicate realtime-event reconciliation
- Subscription cleanup on sign-out
- RLS recursion testing
- RLS performance testing
- Realtime authorization testing
- Query-plan and index review

## 15. Notifications

### 15.1 Goals

The notification architecture must support:

- Persistent in-app notifications
- Read and unread state
- Notification history
- Navigation to the related application screen
- Optional push-notification delivery
- Multiple registered devices per user
- User notification preferences
- Secure server-side notification creation
- Retry-safe delivery
- Invalid-token cleanup
- Realtime in-app updates where appropriate
- Scheduled deadline reminders
- Gradual replacement of the current notifications mock data

Persistent in-app notification records remain the source of truth.

Push notifications are a delivery convenience and must not be the only record that an event occurred.

### 15.2 Core records

The planned notification domain contains:

- `notifications`
- `push_devices`
- `notification_preferences`
- `push_delivery_attempts`

The relationships are:

- One profile may own many notification records.
- One profile may register multiple push-enabled installations.
- One profile has one notification-preferences record.
- One notification may have multiple delivery attempts.
- One notification may reference a request, offer, conversation, message, course, or another approved entity.

### 15.3 Notification event types

Initial notification event types should include:

- `request_offer_created`
- `request_offer_accepted`
- `request_offer_rejected`
- `request_offer_withdrawn`
- `request_cancelled`
- `request_expired`
- `request_completed`
- `request_deadline_approaching`
- `message_received`
- `conversation_created`
- `group_member_added`
- `group_member_removed`
- `course_classmate_joined`

Potential future event types include:

- Profile or account action required
- Moderation update
- Report outcome
- Safety notice
- Group role changed
- New course announcement
- System maintenance

Event types must use a controlled database enum or constrained text value.

Normal clients must not create arbitrary event types.

### 15.4 Notifications table

The proposed `notifications` fields are:

| Field | Planned type | Required | Purpose |
|---|---|---:|---|
| `id` | UUID | Yes | Primary key |
| `recipient_id` | UUID foreign key | Yes | Profile that owns the notification |
| `actor_id` | UUID foreign key | No | Profile whose action caused the event |
| `event_type` | Text or enum | Yes | Controlled notification event |
| `title` | Text | Yes | Short user-facing title |
| `body` | Text | Yes | Short user-facing description |
| `request_id` | UUID foreign key | No | Related request |
| `offer_id` | UUID foreign key | No | Related request offer |
| `conversation_id` | UUID foreign key | No | Related conversation |
| `message_id` | UUID foreign key | No | Related message |
| `course_id` | UUID foreign key | No | Related course |
| `navigation_key` | Text or enum | Yes | Approved application destination type |
| `read_at` | Timestamp with time zone | No | When the user marked it read |
| `created_at` | Timestamp with time zone | Yes | Server-generated creation time |
| `expires_at` | Timestamp with time zone | No | Optional notification-history expiration |
| `deduplication_key` | Text | No | Retry-safe event identifier |

Potential future fields include:

- Priority
- Administrative category
- Localization template key
- Notification grouping key
- Retention category
- Moderation reference

The table must not store:

- Push-provider credentials
- Expo access tokens
- Authentication tokens
- Private message histories
- Sensitive administrative notes
- Raw user passwords
- Arbitrary client-controlled navigation URLs

### 15.5 Notification ownership

`recipient_id` identifies the user who owns the notification.

The backend must enforce that:

- A notification has exactly one recipient.
- Normal users cannot create notifications for themselves or other users.
- Normal users cannot change the recipient.
- Users may read only their own notification records.
- Users may update only approved read-state fields on their own notifications.
- Users cannot inspect another user's notification history.
- Trusted backend operations determine the recipient from the related event.

The Expo client must not submit a recipient ID and expect it to be trusted.

### 15.6 Notification actor

`actor_id` identifies the user whose action caused the notification when relevant.

Examples include:

- The person who offered help
- The request owner who accepted an offer
- The sender of a message
- The classmate who joined a course

`actor_id` may be null for system-generated events such as:

- Deadline approaching
- Request expired
- Administrative notice
- System maintenance

Actor display information should be loaded from approved profile fields.

The actor's email address and private profile fields must not be copied into the notification.

### 15.7 Related entities

Notification records should use explicit nullable foreign keys for supported related entities.

Examples include:

- `request_offer_created`
  - Request ID
  - Offer ID
  - Actor ID

- `request_offer_accepted`
  - Request ID
  - Offer ID
  - Actor ID

- `message_received`
  - Conversation ID
  - Message ID
  - Actor ID

- `request_deadline_approaching`
  - Request ID
  - No actor

- `course_classmate_joined`
  - Course ID
  - Actor ID

The final schema should include check constraints or trusted creation functions that verify each event type contains the required relationship fields.

A message notification must not reference a message from an unrelated conversation.

### 15.8 Navigation targets

Notifications must use approved structured navigation information rather than arbitrary URLs supplied by a client.

The proposed `navigation_key` values include:

- `request_details`
- `request_offers`
- `conversation`
- `student_profile`
- `course_classmates`
- `notifications`
- `account_settings`

The client maps the navigation key and related entity ID to an existing Expo Router route.

Examples:

- `request_details` plus `request_id`
  - Opens `/requests/[id]`

- `conversation` plus `conversation_id`
  - Opens `/messages/[id]`

- `student_profile` plus `actor_id`
  - Opens `/students/[id]`

- `course_classmates` plus `course_id`
  - Opens the approved classmates route with the course parameter

The client must validate that the required identifier exists before navigating.

The notification record must not contain a client-controlled external URL.

### 15.9 Read and unread state

A notification is unread when:

- `read_at` is null

A notification is read when:

- `read_at` contains a server-approved timestamp

The initial design does not require a separate status column for read and unread state.

Unread count is derived from the signed-in user's notification rows where `read_at` is null.

The application should support:

- Mark one notification read
- Mark all notifications read
- Display unread count
- Display read and unread styling
- Preserve read state after application restart
- Synchronize read state across devices

### 15.10 Marking one notification read

The mark-read operation must:

1. Verify that the caller is authenticated.
2. Verify that the notification belongs to the caller.
3. Set `read_at` only when it is currently null.
4. Use a server timestamp.
5. Return the updated notification.
6. Be safe to repeat.

A user must not mark another user's notification as read.

The operation must not change:

- Recipient
- Actor
- Event type
- Related entities
- Creation timestamp
- Notification body

### 15.11 Marking all notifications read

The mark-all-read operation should use a narrow database function or controlled update.

It must:

- Apply only to the authenticated user's notifications.
- Update only unread rows.
- Use one server timestamp for the operation where practical.
- Avoid updating another user's records.
- Return the resulting unread count or affected count.
- Be safe to repeat.

The Expo client must not first download notification IDs and send an unrestricted bulk update.

### 15.12 Notification text

The initial notification row stores a short title and body so the user can view a consistent historical notification.

Notification text must:

- Be created by trusted backend logic.
- Use approved templates.
- Apply length limits.
- Avoid raw HTML.
- Avoid secrets and private account information.
- Avoid including complete private messages.
- Avoid including sensitive request details on a locked screen.
- Remain understandable if an actor later changes their display name.

A future localization system may store:

- Template key
- Template parameters
- Rendered fallback text

That complexity is not required for the first implementation.

### 15.13 Notification creation

Normal Expo clients must not directly insert notification records.

Notifications should be created through trusted backend logic such as:

- Transactional database functions
- Database triggers where the event is simple and safe
- Supabase Edge Functions
- Scheduled jobs
- Trusted administrative processes

Examples include:

- Offer creation transaction creates the owner notification.
- Offer acceptance transaction creates the helper notification.
- Message insertion creates recipient notification records.
- Deadline scheduler creates deadline notifications.
- Course membership operation creates an approved classmate notification.

Notification creation must remain in the same transaction as the related business event when consistency requires it.

### 15.14 Idempotency and duplicate prevention

Notification creation must handle retries safely.

The proposed direction uses a `deduplication_key`.

Examples include:

- `offer-created:<offer-id>:<recipient-id>`
- `offer-accepted:<offer-id>:<recipient-id>`
- `message:<message-id>:<recipient-id>`
- `deadline-24h:<request-id>:<recipient-id>`
- `request-completed:<request-id>:<recipient-id>`

The database should enforce uniqueness for non-null deduplication keys.

This prevents duplicate notification rows caused by:

- Retried database functions
- Retried Edge Functions
- Database webhook retries
- Scheduled-job retries
- Network timeouts
- Multiple workers processing the same event

The exact deduplication format must be generated by trusted backend logic.

### 15.15 New offer notification

When a user submits a valid request offer:

- The request owner receives a notification.
- The offering user is the actor.
- The request and offer are referenced.
- The destination opens the request-offer review flow.
- The notification is created only after the offer insert succeeds.
- A retry does not create a duplicate notification.
- The user does not receive a notification for offering on their own request because that action is prohibited.

The notification should not expose the offerer's private contact information.

### 15.16 Offer accepted notification

When an offer is accepted:

- The accepted helper receives an accepted notification.
- The request owner is the actor.
- The request and accepted offer are referenced.
- The destination opens the request or linked conversation.
- The notification is committed with the acceptance transaction.
- Rejected offering users receive separate approved notifications.
- Duplicate notifications are prevented.

The accepted notification must not be created if the acceptance transaction rolls back.

### 15.17 Offer rejected notification

When an offer is rejected:

- The offering user receives a rejection notification.
- The request owner is the actor.
- The request and offer are referenced.
- The notification opens the related request where access is still permitted.
- The body does not expose information about other offering users.
- Direct rejection and automatic rejection may use different event templates.

A rejected user must not receive access to an accepted conversation.

### 15.18 New message notification

When a message is persisted:

- Active recipients other than the sender may receive an in-app notification.
- The sender is the actor.
- The conversation and message are referenced.
- The destination opens the conversation.
- The notification is created only for authorized conversation members.
- Muted conversation preferences are respected for push delivery.
- The persistent notification may still be created even when push is muted.

The push preview should contain minimal private content.

The initial product may display:

- Sender name
- Generic text such as `Sent you a message`

Displaying the complete message body on a device lock screen should require an explicit privacy decision.

### 15.19 Deadline-approaching notification

Deadline notifications are system-generated.

Potential reminders include:

- 24 hours before deadline
- 1 hour before deadline

The first implementation should choose one reminder window rather than creating many reminders.

A reminder should be created only when:

- The request remains active.
- The recipient owns or is the accepted helper for the request.
- The deadline remains in the future.
- The same reminder has not already been generated.
- The request has not been completed, cancelled, or expired.

Deadline reminders require trusted server time.

The mobile device clock must not control reminder creation.

### 15.20 Classmate-joined notification

The product may notify course members when a new classmate joins.

This event must be conservative because large courses could create excessive notifications.

Before implementation, the product must decide:

- Whether this notification is enabled at all
- Whether it is limited to small courses
- Whether it is grouped into summaries
- Whether it is in-app only
- Whether users can disable it
- Whether hidden profiles generate notifications
- Whether existing members may navigate to the new profile

The initial implementation may keep this event disabled by default.

### 15.21 Request-completed notification

When a request is completed:

- The request owner and accepted helper may receive notifications as appropriate.
- The request is referenced.
- The accepted relationship is verified.
- The destination opens the request details or conversation.
- The notification is created with the trusted completion operation.
- Unrelated offering users do not receive completion details.
- Duplicate completion notifications are prevented.

The exact completion-confirmation workflow will be defined during the Request Offers or safety implementation task.

### 15.22 In-app notifications versus push notifications

In-app notifications and push notifications serve different purposes.

#### In-app record

- Stored in PostgreSQL
- Provides notification history
- Provides read and unread state
- Supports unread counts
- Supports application navigation
- Remains available after device changes
- Is protected through RLS

#### Push notification

- Delivered through an external platform
- May arrive while the application is backgrounded or closed
- May be delayed, duplicated, or not delivered
- May be disabled by the user or operating system
- Should contain minimal private content
- Must not be the source of truth

A push failure must not remove or invalidate the in-app notification.

### 15.23 Push-device registrations

Push registration belongs to an application installation rather than directly to a profile.

One user may have:

- An Android phone
- An iPhone
- A tablet
- A replacement device
- Multiple preview or development installations

Each active installation may have its own push token.

Signing out should detach or disable the installation's user association according to the approved security workflow.

### 15.24 Push devices table

The proposed `push_devices` fields are:

| Field | Planned type | Required | Purpose |
|---|---|---:|---|
| `id` | UUID | Yes | Primary key |
| `profile_id` | UUID foreign key | Yes | Current authenticated owner |
| `installation_id` | UUID | Yes | App-generated installation identifier |
| `expo_push_token` | Text | Yes | Expo push token |
| `platform` | Text or enum | Yes | Android or iOS |
| `app_environment` | Text or enum | Yes | Development, preview, or production |
| `project_id` | Text | Yes | Expected Expo/EAS project identifier |
| `notifications_enabled` | Boolean | Yes | Last confirmed app-level state |
| `last_registered_at` | Timestamp with time zone | Yes | Most recent successful registration |
| `last_seen_at` | Timestamp with time zone | Yes | Most recent authenticated app activity |
| `disabled_at` | Timestamp with time zone | No | When delivery was disabled |
| `created_at` | Timestamp with time zone | Yes | Server-generated creation time |
| `updated_at` | Timestamp with time zone | Yes | Server-maintained modification time |

The database should prevent inappropriate duplicate active registrations.

The final uniqueness design should consider:

- Expo push token
- Installation ID
- Environment
- Profile ID

Development and preview tokens must not be used by the production notification sender.

### 15.25 Push-token registration

The planned registration flow is:

1. Restore the authenticated session.
2. Determine whether push registration is appropriate.
3. Create the required Android notification channel.
4. Check existing notification permission.
5. Request permission only with clear user context.
6. Obtain the Expo push token using the configured project ID.
7. Generate or restore the installation ID.
8. Upsert the installation record for the authenticated user.
9. Record platform and application environment.
10. Refresh the registration when the token changes.
11. Disable or detach the registration after sign-out as approved.

The app must not display push registration as successful until the backend confirms the stored registration.

### 15.26 Notification permission UX

The application should not request notification permission immediately without context.

A preferred flow is:

1. Explain why CampusClutch notifications are useful.
2. Describe examples such as accepted offers and new messages.
3. Allow the user to continue without push permission.
4. Request operating-system permission after user intent.
5. Handle allowed, denied, and unavailable states.
6. Provide a path to system settings after permanent denial.
7. Continue supporting in-app notifications when push is denied.

Push permission must not be required to create an account.

### 15.27 Android notification channels

Android notification channels should separate meaningful notification categories.

Potential channels include:

- Messages
- Requests and offers
- Reminders
- General account notifications

The first implementation may begin with:

- Messages
- General

Channel behavior should define:

- Name
- Description
- Importance
- Sound
- Vibration
- Badge behavior

Channel IDs become persistent operating-system configuration and should be chosen carefully.

The application must create the required channel before requesting a push token on Android versions where this is required.

### 15.28 Notification preferences

The proposed `notification_preferences` fields are:

| Field | Planned type | Required | Purpose |
|---|---|---:|---|
| `profile_id` | UUID foreign key | Yes | Primary key and profile owner |
| `push_enabled` | Boolean | Yes | Master push preference |
| `messages_push_enabled` | Boolean | Yes | Push for messages |
| `offers_push_enabled` | Boolean | Yes | Push for request offers |
| `request_updates_push_enabled` | Boolean | Yes | Push for request changes |
| `deadline_push_enabled` | Boolean | Yes | Push for deadline reminders |
| `course_push_enabled` | Boolean | Yes | Push for course events |
| `created_at` | Timestamp with time zone | Yes | Server-generated creation time |
| `updated_at` | Timestamp with time zone | Yes | Server-maintained modification time |

The initial design keeps in-app notification records enabled for required product events.

Preferences primarily control external push delivery.

Future preferences may include:

- Quiet hours
- Per-conversation mute
- Email notifications
- Notification preview privacy
- Digest frequency

### 15.29 Preference ownership

Users may read and update only their own notification preferences.

The backend must enforce that:

- The preference profile ID matches the authenticated user.
- Users cannot change another user's preferences.
- Administrative fields cannot be changed through preference updates.
- Missing preferences receive reviewed defaults.
- Preference creation is idempotent.
- Preference changes apply to future push delivery.

A preference change must not delete existing notification history.

### 15.30 Trusted push delivery

The Expo mobile client must not send push notifications directly.

Push delivery requires trusted server-side logic because it may need:

- Expo access credentials
- Service-level database access
- Recipient token lookup
- Preference evaluation
- Rate limiting
- Retry logic
- Receipt processing
- Invalid-token cleanup

The preferred direction is a Supabase Edge Function triggered by a controlled delivery workflow.

Potential invocation strategies include:

- Database webhook after notification creation
- Database function queuing a delivery record
- Scheduled worker processing pending deliveries
- Direct call from a trusted transaction workflow

The final strategy must avoid sending a push before the related database transaction commits.

### 15.31 Edge Function security

A push Edge Function must:

- Keep Expo access credentials in server-side secrets.
- Never expose push credentials to the Expo client.
- Validate the invocation source.
- Load notification and recipient data from trusted storage.
- Verify preferences.
- Load only active tokens for the correct environment.
- Avoid logging tokens or private notification bodies.
- Apply timeout and retry handling.
- Record delivery outcomes.
- Restrict administrative database access.
- Be tested locally and in preview.

A Supabase secret or service-role credential must never be bundled into the mobile application.

### 15.32 Push delivery attempts

The proposed `push_delivery_attempts` fields are:

| Field | Planned type | Required | Purpose |
|---|---|---:|---|
| `id` | UUID | Yes | Primary key |
| `notification_id` | UUID foreign key | Yes | Related in-app notification |
| `push_device_id` | UUID foreign key | Yes | Target installation |
| `status` | Text or enum | Yes | Pending, sent, delivered, failed, or disabled |
| `attempt_count` | Small integer | Yes | Number of attempts |
| `provider_ticket_id` | Text | No | Expo ticket identifier |
| `provider_error_code` | Text | No | Approved provider error |
| `next_attempt_at` | Timestamp with time zone | No | Retry time |
| `sent_at` | Timestamp with time zone | No | Time request was sent |
| `receipt_checked_at` | Timestamp with time zone | No | Time receipt was checked |
| `created_at` | Timestamp with time zone | Yes | Server-generated creation time |
| `updated_at` | Timestamp with time zone | Yes | Server-maintained modification time |

The table must not expose provider details to normal mobile clients.

Delivery records are operational data, not user-facing notification history.

### 15.33 Push payload privacy

Push payloads should contain the minimum information needed to display and route the notification.

Potential fields include:

- Notification ID
- Navigation key
- Related entity ID
- Short title
- Short body

Push payloads must not contain:

- Authentication tokens
- Supabase credentials
- Full private message histories
- Private email addresses
- Phone numbers
- Moderation notes
- Hidden profile information
- Detailed location information unnecessary for the preview

The application should fetch authoritative details after opening.

Lock-screen message previews require an explicit privacy setting before production.

### 15.34 Delivery tickets and receipts

Sending a push request successfully does not prove that the device received it.

The push-delivery system must distinguish:

- Request accepted by Expo
- Provider ticket returned
- Receipt available
- Provider delivery error
- Device token no longer registered
- Temporary failure
- Permanent failure

Receipt processing should:

- Match receipts to recorded delivery attempts.
- Disable invalid tokens.
- Retry only appropriate temporary failures.
- Avoid unbounded retries.
- Store only approved operational error information.
- Support monitoring and investigation.

### 15.35 Invalid and replaced tokens

Push tokens may become invalid because:

- The application was uninstalled.
- Notification permission was revoked.
- The device registration changed.
- The user installed a different application environment.
- The operating system or push provider replaced the token.

When a token is reported as unregistered or invalid:

- Mark the push-device record disabled.
- Stop sending to that token.
- Preserve the operational history.
- Allow a future authenticated registration to reactivate or replace it.
- Do not disable the user's other devices.

### 15.36 Retry and rate-limit strategy

Push delivery is not guaranteed to succeed on the first attempt.

The delivery system must:

- Batch requests according to provider guidance.
- Apply bounded exponential backoff for retryable failures.
- Respect provider rate limits.
- Avoid retrying permanent token errors.
- Prevent duplicate user-visible notification records.
- Use delivery-attempt state to avoid duplicate uncontrolled sends.
- Monitor repeated failures.
- Stop after a reviewed maximum attempt count.

At-least-once external delivery means the application must tolerate a rare duplicate push.

The notification ID allows the client to reconcile duplicate taps with one in-app notification.

### 15.37 Tapping a push notification

When a user taps a push notification:

1. The application restores or verifies authentication.
2. The notification ID is read from approved payload data.
3. The application loads the notification through authorized backend access.
4. The app validates that it belongs to the signed-in user.
5. The notification is marked read.
6. The application maps the navigation key to an Expo Router route.
7. The related entity is loaded with normal authorization.
8. Missing or inaccessible targets show a safe fallback.

The app must handle taps when it is:

- Open in the foreground
- Running in the background
- Fully closed
- Restoring a session
- Signed out
- Opening an expired or deleted target

A push payload alone must not grant access to a protected screen.

### 15.38 In-app realtime updates

Realtime may update:

- Notification-list rows
- Unread badge count
- New notification banners

The initial direction is:

- Persist the notification first.
- Subscribe only while an authenticated session is active.
- Filter updates to the signed-in user.
- Refetch after reconnection.
- Remove subscriptions on sign-out.
- Deduplicate by notification ID.
- Continue supporting manual refresh.

Broadcast may be evaluated for scalability, but persistent rows remain authoritative.

### 15.39 Foreground behavior

When the application receives an event while open, the product may choose to:

- Update the unread badge silently
- Display an in-app banner
- Display a native notification
- Suppress notification UI when the user already views the related screen

Examples:

- Do not show an intrusive message notification when the user is actively viewing that conversation.
- Still persist the notification or update unread state according to the approved rule.
- Avoid displaying duplicate native and in-app banners simultaneously.

Foreground behavior must be tested on Android and iOS.

### 15.40 Scheduled notifications

Deadline reminders require a trusted scheduled process.

The planned process is:

1. Run at a reviewed interval.
2. Query active requests entering the reminder window.
3. Determine approved recipients.
4. Generate deterministic deduplication keys.
5. Insert missing in-app notification records.
6. Queue push delivery where preferences allow it.
7. Skip completed, cancelled, expired, or already-reminded requests.
8. Record failures and retry safely.

Potential Supabase mechanisms include scheduled Edge Functions and PostgreSQL scheduling capabilities.

The final implementation must be tested for:

- Timezone boundaries
- Daylight-saving changes
- Duplicate scheduler runs
- Delayed scheduler execution
- Request status changing during the run
- Deadline being edited after a reminder

### 15.41 Notification retention

The product must define how long notification history remains available.

The initial direction is:

- Preserve unread notifications.
- Preserve recent read notifications.
- Allow older non-critical notifications to expire.
- Keep operational push-delivery records for a shorter controlled period.
- Retain safety or moderation events according to separate policy.
- Delete or anonymize records through account-deletion and retention workflows.

Deleting a notification must not delete its related request, message, offer, course, or conversation.

### 15.42 Row Level Security direction

RLS will be enabled on:

- `notifications`
- `push_devices`
- `notification_preferences`

Operational delivery tables should not be directly exposed to normal mobile clients.

#### Notifications: select

- Users may read only notifications where `recipient_id` matches the authenticated user.
- Signed-out users receive no access.
- Trusted support and moderation use separate authorization.

#### Notifications: insert

- Normal clients cannot directly insert notifications.
- Trusted transactions, functions, schedulers, or server processes create them.

#### Notifications: update

- Users may update only approved read-state fields on their own notifications.
- Users cannot change recipient, actor, event type, content, or related entities.
- Mark-all-read uses a narrowly scoped operation.

#### Notifications: delete

- Normal clients should not directly hard-delete notifications initially.
- Retention and account-deletion processing handle removal.

#### Push devices

- Users may read their own registered installations.
- Users may register or update only an installation associated with themselves.
- Users cannot read another user's push token.
- Sensitive tokens should be omitted from ordinary client queries where possible.
- Trusted delivery processes can read active tokens.

#### Notification preferences

- Users may read and update only their own preferences.
- Defaults are created through an approved idempotent process.

### 15.43 Grants and backend access

The final migration must explicitly review:

- Client select access to notifications
- Narrow notification read-state update access
- Push-device registration function execution
- Preference update access
- Anonymous access denial
- Edge Function database credentials
- Scheduler access
- Delivery-attempt table isolation
- Receipt-processing access
- Administrative support access

A service-level backend process must still limit itself to the minimum required operation.

### 15.44 Indexes

The final schema should consider indexes for:

- Notification recipient ID
- Recipient and unread state
- Recipient and creation timestamp
- Notification event type
- Related request ID
- Related offer ID
- Related conversation ID
- Related message ID
- Related course ID
- Deduplication-key uniqueness
- Active push devices by profile
- Expo push-token uniqueness
- Installation ID and environment
- Pending delivery attempts
- Retry scheduling
- Receipt lookup

Likely important composite indexes include:

- Notifications by recipient and descending creation time
- Unread notifications by recipient
- Active push devices by profile and environment
- Pending delivery attempts by status and next attempt time

Final indexes must be confirmed through query-plan testing.

### 15.45 Realtime and push are separate

Realtime and push delivery must remain independent.

Realtime is useful while:

- The app is open
- The authenticated session is active
- A subscription is connected

Push is useful while:

- The app is backgrounded
- The app is closed
- The device still allows notifications

Neither guarantees permanent history.

The PostgreSQL notification row provides that history.

### 15.46 Mock-data migration

The notification migration should occur after persistent authentication and the event-producing domains are available.

A proposed focused migration order is:

1. Add notification event types and notification table.
2. Add constraints, indexes, grants, and RLS.
3. Add typed notification data access.
4. Load in-app notification history.
5. Add unread count.
6. Add mark-one-read.
7. Add mark-all-read.
8. Add notifications for request offers.
9. Add notifications for accepted and rejected offers.
10. Add persistent message notifications.
11. Add request-completion notifications.
12. Add deadline scheduler.
13. Add push-device registration.
14. Add notification preferences.
15. Add trusted push Edge Function.
16. Add delivery attempts and receipt handling.
17. Add realtime in-app updates.
18. Add deep-link and notification-tap routing.
19. Remove obsolete notification mock paths only after testing.

Push delivery should be implemented after in-app notification records work reliably.

### 15.47 Notification UX requirements

Backend-backed notification screens must eventually define:

- Initial loading state
- Empty notification state
- Error state
- Retry behavior
- Pull-to-refresh
- Pagination
- Unread badge
- Read and unread styling
- Mark-one-read feedback
- Mark-all-read submitting state
- Deleted or inaccessible navigation target
- Notification-permission explanation
- Permission denied state
- Permanent-denial settings guidance
- Push-registration error
- Notification preferences
- Offline notification-history behavior
- Realtime reconnect behavior
- Foreground banner behavior
- Duplicate-push reconciliation

The app must remain usable when push permission is denied.

### 15.48 Notification testing requirements

The notification milestone must eventually test:

- User reads own notifications
- User cannot read another user's notifications
- Signed-out notification access is rejected
- Normal client cannot insert notifications
- Offer-created notification
- Offer-accepted notification
- Offer-rejected notification
- Request-completed notification
- New-message notification
- Deadline reminder
- Classmate-joined preference behavior
- Correct recipient selection
- Correct actor selection
- Required related entity references
- Invalid event and entity combinations
- Duplicate notification prevention
- Retry-safe notification creation
- Mark one notification read
- Mark another user's notification read is rejected
- Mark all notifications read
- Unread-count calculation
- Read state across multiple devices
- Notification-list pagination
- Push permission allowed
- Push permission denied
- Push permission permanently denied
- Android notification-channel creation
- Push-token registration
- Push-token replacement
- Multiple-device registration
- Development and production token separation
- Sign-out registration behavior
- Push preference enforcement
- Conversation mute enforcement
- Edge Function authentication
- Secret exposure checks
- Push ticket recording
- Push receipt processing
- Invalid-token disabling
- Retryable delivery failure
- Permanent delivery failure
- Delivery rate limiting
- Duplicate push tolerance
- Foreground notification handling
- Background notification tap
- Closed-application notification tap
- Session restoration before navigation
- Unauthorized target rejection
- Deleted-target fallback
- Realtime notification insert
- Realtime subscription cleanup
- Scheduler duplicate-run protection
- Timezone and daylight-saving behavior
- RLS policy tests
- Edge Function tests
- Query-plan and index review

## 16. Detailed Security Policies

### 16.1 Security goals

The CampusClutch backend must protect:

- User accounts
- Public and private profile information
- Course memberships
- Request ownership
- Request offers
- Conversations
- Messages
- Notifications
- Avatar and future file storage
- Push-device registrations
- Administrative operations
- Service credentials
- Database integrity
- Audit and moderation evidence

Security must be enforced by the backend.

Client-side validation, hidden buttons, disabled controls, route guards, and UI state improve usability but do not provide authorization.

### 16.2 Security model

CampusClutch will use several security layers:

1. Supabase Auth verifies user identity.
2. PostgreSQL constraints protect data integrity.
3. SQL grants control which operations each database role may attempt.
4. Row Level Security controls which rows an authenticated user may access.
5. Narrow database functions implement trusted multi-record operations.
6. Edge Functions handle server-only integrations and secrets.
7. Storage policies protect avatar and file objects.
8. Realtime authorization restricts subscriptions and event visibility.
9. Application-level rate limits and abuse controls protect expensive actions.
10. Monitoring and security testing detect incorrect configuration.

No single layer should be treated as sufficient by itself.

### 16.3 Shared responsibility

Supabase manages the security of its hosted platform and infrastructure.

The CampusClutch team remains responsible for:

- Database schema design
- RLS policies
- SQL grants
- Function permissions
- API-key handling
- Application authorization
- Authentication settings
- File-access policies
- Secret storage
- Environment separation
- User privacy
- Moderation
- Data retention
- Dependency updates
- Monitoring
- Incident response

Using a managed backend does not automatically make CampusClutch secure or production-ready.

### 16.4 Default-deny approach

All application tables exposed through the Supabase Data API must use Row Level Security.

The policy direction is:

- Enable RLS as soon as each exposed table is created.
- Begin with no client policies.
- Add narrowly scoped policies only after the intended access is documented.
- Avoid broad policies such as allowing every authenticated user to access every row.
- Explicitly deny anonymous access unless a reviewed feature requires it.
- Test every policy from the perspective of multiple users.

When RLS is enabled and no applicable policy exists, client access should fail.

A missing policy is safer than an overly broad temporary policy.

### 16.5 Authenticated identity

Backend authorization must use the authenticated Supabase user identity.

The primary identity check should be based on:

- `auth.uid()`
- Trusted database relationships linked to that UUID
- Trusted server-controlled claims only when explicitly required

The backend must not trust:

- User IDs supplied in request bodies
- Profile IDs stored only in local state
- Client-provided roles
- Client-provided ownership flags
- Route parameters as proof of authorization
- User-editable metadata as proof of administrative access

When inserting user-owned data, the resulting owner ID must match the authenticated user.

### 16.6 Anonymous access

The initial CampusClutch architecture does not require anonymous database access.

The `anon` role should not receive access to:

- Profiles
- Course memberships
- Requests
- Offers
- Conversations
- Messages
- Notifications
- Push-device records
- Private Storage objects

Authentication screens may use Supabase Auth endpoints without granting anonymous access to application data.

Any future public content feature requires a separate security review.

### 16.7 Authentication requirements

The authentication security baseline includes:

- Verified email addresses
- Secure session persistence
- Token refresh
- Session restoration
- Password-reset support
- Generic errors where account enumeration is a concern
- Rate-limit handling
- Verification resend protection
- Secure deep-link validation
- Complete session cleanup on sign-out
- No password or token logging

The final production configuration must define:

- Minimum password requirements
- Password-compromise protection where available
- Authentication email limits
- Session lifetime
- Refresh-token behavior
- Multi-factor authentication requirements for administrators
- Account recovery procedures

### 16.8 Authentication abuse controls

The authentication configuration should use:

- Supabase Auth rate limits
- CAPTCHA or an approved bot-protection service where necessary
- Email-send limits
- Verification resend cooldowns
- Password-reset cooldowns
- Generic invalid-credential messages
- Monitoring for repeated failures
- Custom SMTP before production

The client must handle HTTP `429` responses clearly.

Repeated authentication requests must not cause uncontrolled email delivery.

### 16.9 User metadata

User-editable authentication metadata must not control authorization.

The following must not be trusted when stored in editable metadata:

- Administrator role
- Moderator role
- Course membership
- Request ownership
- Offer ownership
- Conversation membership
- Verified-student status
- Account suspension state

Authorization should use relational database records and backend-controlled state.

Trusted custom claims may be considered later only when:

- The claim cannot be edited by the user.
- Token-refresh behavior is understood.
- Stale-token behavior is acceptable.
- The same rule is tested against database state.
- The claim provides a measurable performance or architecture benefit.

### 16.10 SQL grants and RLS

RLS policies and SQL grants must work together.

For each table, the migration must review:

- `SELECT`
- `INSERT`
- `UPDATE`
- `DELETE`
- Function execution
- Sequence access
- Schema usage

A policy does not grant an operation that the role cannot attempt.

A SQL grant does not bypass an applicable RLS policy.

The final migration should grant only the minimum operations required by the authenticated application.

### 16.11 Policy role targeting

Policies should explicitly target the intended database role.

The default direction is:

- Authenticated application policies target `authenticated`.
- Anonymous access receives no application-data policies.
- Server-only operations do not depend on normal client policies.
- Administrative processes use separately controlled credentials and authorization.

Policies should not target `PUBLIC` unless a reviewed requirement justifies it.

### 16.12 Profile ownership policies

Profile security must enforce:

- Users may read their own profile.
- Authenticated users may read only approved discoverable profile fields.
- Users may update only their own editable fields.
- Users cannot change profile ownership.
- Users cannot change server-controlled timestamps.
- Users cannot change moderation or administrative fields.
- Normal users cannot directly delete profile rows.
- Signed-out users cannot query student profiles.

Private settings should use separate tables with owner-only policies.

### 16.13 Course and membership policies

Course security must enforce:

- Authenticated users may read approved active course-catalog records.
- Normal users cannot create or edit course records.
- Users may join only as themselves.
- Users may leave only their own membership.
- Duplicate membership is prevented by database constraints.
- Nonmembers cannot read unrestricted membership lists.
- Classmate queries verify shared-course membership.
- Closed and archived courses reject new membership.
- Administrative course changes use trusted authorization.

A user must not gain classmate access by supplying another user's profile ID.

### 16.14 Request ownership policies

Request security must enforce:

- Request ownership matches the authenticated user at creation.
- Owners may update only their editable open requests.
- Owners cannot change the owner ID.
- Owners cannot directly bypass lifecycle rules.
- Nonowners cannot edit or cancel requests.
- Signed-out users cannot access requests.
- General feed access includes only approved visible requests.
- Historical access is limited to involved users.
- Detail-table access follows parent-request access.
- Normal users cannot hard-delete requests.

Request status changes requiring multiple records must use trusted operations.

### 16.15 Offer-management policies

Offer security must enforce:

- Users may offer help only as themselves.
- Users cannot offer help on their own request.
- Duplicate offers are prevented.
- Offering users may read their own offers.
- Request owners may read offers on their own requests.
- Other users may not read the offers.
- Offering users may withdraw only their pending offers.
- Request owners may accept or reject only offers on their requests.
- Direct client updates cannot set arbitrary accepted status.
- Only one offer may be accepted per request.
- Acceptance updates all related records atomically.

The backend must handle concurrent acceptance attempts safely.

### 16.16 Conversation membership policies

Conversation security must enforce:

- Only approved members may read a conversation.
- Only approved members may read the membership list.
- Only active members may read messages.
- Only active members may send messages.
- Users cannot add themselves to unrelated conversations.
- Users cannot promote themselves.
- Normal members cannot manage other members.
- Group administrators cannot exceed their approved role.
- Nonmembers cannot infer private conversation existence.
- Rejected request offerers do not receive conversation access.

Direct-conversation creation must normalize and uniquely enforce the user pair.

### 16.17 Message policies

Message security must enforce:

- The sender matches the authenticated user.
- The sender has active conversation membership.
- The conversation permits new messages.
- Message text satisfies database constraints.
- Client retry identifiers are unique for the sender.
- Users cannot change message ownership.
- Users cannot move messages between conversations.
- Normal users cannot hard-delete messages.
- Normal users cannot create trusted system messages.
- Nonmembers cannot subscribe to or query message events.

Message authorization must be identical for initial queries and realtime subscriptions.

### 16.18 Notification policies

Notification security must enforce:

- Users may read only notifications addressed to them.
- Users may update only their own read state.
- Users cannot change notification content or recipient.
- Normal users cannot directly create notifications.
- Trusted workflows determine recipients.
- Push tokens are visible only where required.
- Users may manage only their own registered installations.
- Delivery-attempt data is not exposed to normal clients.
- Notification preferences belong only to their owner.

A client-provided push recipient must never be trusted.

### 16.19 Storage policies

Storage security must enforce:

- Users upload only to approved buckets.
- Avatar paths are scoped to the authenticated user.
- Users cannot overwrite another user's files.
- Users cannot delete another user's files.
- Allowed MIME types are validated.
- File size limits are enforced.
- Filenames are generated or sanitized.
- Public and private bucket behavior is documented.
- Old files are cleaned up safely.
- Account deletion removes or reassigns owned objects.
- Normal uploads cannot execute server-side code.

Storage object ownership alone must not replace explicit Storage policies.

### 16.20 Realtime security

Realtime subscriptions must:

- Require an authenticated session for private data.
- Use approved private channels where applicable.
- Filter by the narrowest practical relationship.
- Enforce the same visibility rules as database queries.
- Remove subscriptions when the session changes.
- Remove subscriptions when the user loses membership.
- Refetch after reconnecting.
- Deduplicate repeated events.
- Avoid subscribing to entire sensitive tables without filters.

Realtime must not become an authorization bypass.

### 16.21 Edge Function authentication

Every Edge Function must define its caller model.

Possible caller types include:

- Signed-in CampusClutch user
- Trusted scheduled process
- Database webhook
- Internal administrative operation
- External provider webhook

A user-invoked function must:

- Validate the authorization header.
- Verify the user session.
- Check the user's database relationship.
- Reject missing or invalid sessions.
- Avoid trusting user IDs in the body.
- Return only authorized data.

A machine-invoked function must validate the configured shared secret, signing method, or trusted invocation mechanism.

### 16.22 Secret and service keys

Supabase secret and legacy service-role credentials bypass Row Level Security.

They must be treated as server-only secrets.

They must never appear in:

- Expo source code
- `EXPO_PUBLIC_*` variables
- Git commits
- README examples containing real values
- Client logs
- Mobile build configuration readable by users
- Screenshots
- Error reports
- Analytics properties

Server-only credentials may be used only in controlled environments such as:

- Edge Function secrets
- Protected CI secrets
- Secure administrative tooling
- Trusted backend processes

### 16.23 Publishable client configuration

The Expo client may use only values intended for public client use, such as:

- Supabase project URL
- Supabase publishable client key
- Legacy anonymous key only if required by the selected SDK setup
- Expo project ID
- Environment identifier

Public client configuration is not confidential.

Security still depends on:

- RLS
- SQL grants
- Storage policies
- Function authorization
- Correct environment separation

The client key being public does not permit broad database access when policies are correct.

### 16.24 Secret rotation

The security plan must support credential rotation.

Rotation procedures should cover:

- Supabase secret keys
- Legacy service-role keys
- Database passwords
- SMTP credentials
- Expo push credentials
- Third-party webhook secrets
- CI access tokens
- Administrative personal access tokens

Rotation must include:

1. Create or activate the replacement credential.
2. Update trusted environments.
3. Deploy and verify the replacement.
4. Revoke the old credential.
5. Review logs for unexpected continued use.
6. Document the incident or scheduled rotation.

A suspected leaked credential must be rotated immediately.

### 16.25 Environment isolation

Development, preview, and production must not share unrestricted data or secrets.

Each environment should have:

- Separate Supabase project or an explicitly reviewed isolation strategy
- Separate database records
- Separate authentication users
- Separate redirect URLs
- Separate email settings where practical
- Separate push-device registrations
- Separate secrets
- Separate monitoring context

Development accounts must not automatically exist in production.

Preview builds must not connect to production by accident.

### 16.26 Database schemas

Application objects should use deliberate schemas.

The design should distinguish:

- Objects exposed through the Data API
- Internal operational tables
- Administrative functions
- Private helper functions
- Extension-created objects
- Auth-managed objects
- Storage-managed objects

Sensitive operational tables should not be exposed merely because they are placed in `public`.

The final migration must review the Data API exposed-schema configuration.

### 16.27 Database functions

Database functions must be narrowly scoped.

Each function must define:

- Expected caller
- Required inputs
- Authentication requirement
- Authorization checks
- Transaction behavior
- Returned columns
- Error behavior
- Retry and idempotency behavior
- Execution grants
- Search path
- Whether it runs as invoker or definer

Functions must not accept an owner ID or role and trust it without verification.

### 16.28 Security-invoker functions

`SECURITY INVOKER` should be preferred when the caller's existing privileges and RLS policies are sufficient.

Invoker functions:

- Run with the caller's database privileges.
- Continue to rely on the caller's grants.
- Continue to rely on applicable RLS.
- Reduce the risk of accidental privilege escalation.

A security-definer function should not be used merely to avoid writing correct policies.

### 16.29 Security-definer functions

`SECURITY DEFINER` may be used only when a reviewed workflow requires controlled elevated privileges.

Examples may include:

- Creating an initial profile from an Auth trigger
- Atomic offer acceptance
- Safe classmate lookup that avoids recursive policies
- Trusted notification creation
- Account-deletion cleanup

A security-definer function must:

- Be owned by an appropriate controlled role.
- Use a fixed safe `search_path`.
- Schema-qualify sensitive objects.
- Avoid schemas writable by untrusted roles.
- Verify the authenticated user explicitly.
- Check every required relationship.
- Return only necessary fields.
- Restrict `EXECUTE` grants.
- Avoid dynamic SQL where possible.
- Be covered by privilege-escalation tests.
- Be reviewed during every relevant migration.

### 16.30 Function search path

Functions performing privileged operations must not inherit an unsafe search path.

The function should:

- Set a deliberate search path.
- Exclude schemas where untrusted users can create objects.
- Schema-qualify tables and functions where practical.
- Avoid relying on whichever object name appears first.
- Avoid calling unreviewed helper functions.

Search-path safety is required for triggers as well as directly invoked functions.

### 16.31 Dynamic SQL

Dynamic SQL should be avoided unless the operation genuinely requires it.

When dynamic SQL is necessary:

- Do not concatenate raw user input into SQL.
- Use parameter binding or safe formatting.
- Validate identifiers against an allowlist.
- Avoid user-controlled schema or table names.
- Restrict the function's privileges.
- Test injection attempts.
- Log only safe operational details.

Most CampusClutch operations should use static SQL.

### 16.32 Database constraints

Security policies must be supported by database constraints.

Constraints should enforce:

- Required fields
- Valid enum values
- Positive request points
- Valid deadlines where feasible
- Foreign-key relationships
- One profile per Auth user
- Unique course membership
- Unique request offer
- One accepted offer per request
- Unique conversation membership
- Unique direct-conversation pair
- Unique request-conversation link
- Valid user-pair ordering
- Retry-safe message identifiers
- Notification deduplication

RLS determines who may attempt an operation.

Constraints determine whether the resulting data is valid.

### 16.33 Input validation

Validation must occur at multiple layers:

#### Client

- Immediate feedback
- Required-field highlighting
- Length guidance
- Disabled submitting states
- Input formatting

#### Database

- Required constraints
- Length constraints
- Numeric constraints
- Foreign keys
- Uniqueness
- Approved status values
- Trusted state transitions

#### Server-side functions

- Cross-table rules
- Ownership
- Membership
- Rate limits
- Multi-record transitions
- File and provider validation

Client validation must not be the final authority.

### 16.34 Error handling

Security-sensitive errors should be useful without disclosing unnecessary information.

The application should distinguish:

- Validation failure
- Authentication required
- Session expired
- Permission denied
- Record unavailable
- Rate limited
- Conflict
- Network failure
- Temporary server failure

The backend should avoid revealing:

- Whether a private record exists
- Another user's email
- Internal database structure
- SQL statements
- Secret values
- Privileged function details
- Stack traces in production responses

Detailed errors may be recorded securely for investigation.

### 16.35 Logging

Logs must not contain:

- Passwords
- Access tokens
- Refresh tokens
- Supabase secret keys
- Database passwords
- SMTP credentials
- Expo push credentials
- Full push tokens
- Full private message bodies
- Sensitive location details
- Private moderation evidence unless required in a protected system

Operational logs may include:

- Request identifier
- Function name
- Safe event category
- Actor UUID where justified
- Result status
- Duration
- Safe error code
- Correlation ID

Logs require retention and access-control rules.

### 16.36 Audit trail

Trusted administrative actions should be auditable.

Potential audit events include:

- Course catalog changes
- Request moderation
- Offer intervention
- Conversation or message moderation
- User suspension
- Role changes
- Administrative data access
- Account-deletion execution
- Credential rotation
- Security-setting changes

Audit records should include:

- Actor
- Action
- Target
- Timestamp
- Safe reason
- Result
- Correlation identifier

Normal users must not access administrative audit records.

### 16.37 Administrative access

Administrative access must follow least privilege.

The plan should require:

- Individual administrator accounts
- No shared dashboard accounts
- Multi-factor authentication
- Minimum necessary organization role
- Separation between development and production access
- Periodic access review
- Removal of former team members
- Protected database credentials
- Audited high-risk actions

Administrator status must not be set through an editable public profile field.

### 16.38 Database network protection

Production database access should use:

- Encrypted connections
- SSL enforcement where supported
- Network restrictions for direct Postgres connections where practical
- Limited database credentials
- Connection pooling appropriate to the workload
- No database passwords in the mobile client

Supabase network restrictions protect direct Postgres and pooler connections.

They do not replace RLS or protect every HTTPS product API.

### 16.39 Security Advisor

Before preview and production release, the team should review Supabase Security Advisor findings.

The review should check for:

- Tables without RLS
- Overly broad policies
- Unsafe functions
- Exposed objects
- Extension or schema concerns
- Weak database configuration
- Newly introduced warnings after migrations

Security Advisor findings must be investigated rather than dismissed automatically.

The project should record reviewed exceptions.

### 16.40 Backups and recovery

Production planning must include:

- Database backup availability
- Backup retention
- Point-in-time recovery requirements
- Storage-object recovery limitations
- Migration rollback strategy
- Accidental deletion response
- Recovery testing
- Responsible team member
- Recovery documentation

A backup is not considered reliable until restoration has been tested.

Database backups may not automatically provide the same recovery behavior for external Storage objects, Auth email delivery, or third-party push systems.

### 16.41 Rate limiting

Rate limits are needed beyond Supabase Auth.

Potential rate-limited operations include:

- Request creation
- Offer creation
- Message sending
- Group creation
- Member invitations
- Avatar uploads
- Push-device registration
- Notification resends
- Report creation
- Account deletion requests

Rate limits should consider:

- Authenticated user
- Installation
- IP address where available
- Target entity
- Time window
- Product risk

Disabled buttons alone do not prevent automated abuse.

### 16.42 Rate-limit enforcement

Rate limits may be enforced using:

- Supabase Auth configuration
- Database counters and trusted functions
- Edge Functions
- External gateway controls
- Provider-specific limits
- Unique constraints for duplicate prevention

The selected mechanism must be:

- Server-enforced
- Concurrency-safe
- Testable
- Observable
- Environment-specific
- Clear to users when exceeded

Rate-limit errors should identify when retrying later is appropriate without exposing internal limits unnecessarily.

### 16.43 Messaging abuse controls

Before production messaging, the app needs controls for:

- Message send rate
- Repeated identical messages
- Spam conversation creation
- Unwanted group additions
- Blocked-user communication
- Reported content
- Removed-member access
- Attachment abuse when files are introduced

These controls require the future blocking, reporting, moderation, and safety architecture.

Persistent messaging alone is not production-ready.

### 16.44 Request abuse controls

Before production requests, the app needs controls for:

- Excessive request creation
- Repeated urgent marking
- Misleading locations
- Unsafe requests
- Harassment
- Fraudulent points promises
- Repeated offers
- Offer spam
- Deadline manipulation
- Evading moderation after cancellation

The product must provide reporting and moderation paths.

### 16.45 File-upload abuse controls

File uploads require:

- Authenticated ownership
- MIME-type allowlists
- File-signature validation where appropriate
- Maximum file size
- Image dimension limits
- Metadata handling
- Safe generated object paths
- Upload rate limits
- Malware-risk review for future documents
- Cleanup for failed or abandoned uploads
- Moderation for abusive imagery

The first Storage implementation should support avatars only.

### 16.46 Blocking dependency

Blocking must be designed before production launch.

A blocked relationship may need to affect:

- Profile discovery
- Classmate results
- Request visibility
- Offer creation
- Direct conversations
- New messages
- Group invitations
- Notifications
- Activity status
- Search

Blocking rules must be enforced in backend queries and policies, not only by hiding UI elements.

### 16.47 Reporting and moderation dependency

Reporting must support approved entities such as:

- Profile
- Request
- Offer
- Conversation
- Message
- Avatar

A report should include:

- Reporting user
- Reported entity
- Controlled reason
- Optional explanation
- Timestamp
- Review status
- Assigned moderator where applicable

Users must not be able to read another user's reports.

Moderation decisions require trusted administrative authorization and audit logging.

### 16.48 Data minimization

CampusClutch should store only information required for approved features.

The initial backend should avoid collecting:

- Legal names when display names are sufficient
- Exact location history
- Continuous background location
- Birth dates unless required
- Government identification
- Payment information
- Unnecessary device identifiers
- Message analytics containing private content
- Unnecessary authentication metadata duplication

New personal fields require a product, privacy, and retention justification.

### 16.49 Privacy-sensitive activity data

Activity data such as `last_active_at` must be coarse and privacy-conscious.

The system should avoid exposing:

- Exact login times
- Exact session duration
- Detailed device activity
- Continuous online presence
- Unnecessary location information

The UI may display a broad status such as `Recently active` only when the approved relationship and user preference allow it.

### 16.50 Dependency security

The project should maintain:

- Supported Node and Expo versions
- Reviewed package updates
- Lockfile integrity
- Dependabot or equivalent alerts
- Regular vulnerability review
- Removal of unused packages
- Review of native package permissions
- Review of Expo configuration changes
- Review of Supabase SDK release changes

Automated vulnerability output must be reviewed rather than fixed through unrelated mass upgrades.

### 16.51 CI security checks

Future CI may include:

- Existing lint and TypeScript checks
- Migration syntax validation
- Generated database-type consistency
- RLS policy tests
- Database function tests
- Secret scanning
- Dependency vulnerability review
- Edge Function tests
- Storage-policy tests
- Formatting checks
- Test database reset and migration replay

Security tests should fail the pull request when a protected rule regresses.

### 16.52 Migration security review

Every database migration should be reviewed for:

- New tables
- RLS enablement
- Policies
- Grants
- Foreign keys
- Unique constraints
- Function security mode
- Function search path
- Trigger behavior
- Exposed schemas
- Realtime publication
- Storage access
- Rollback consequences
- Data migration safety

A table should not be merged into an exposed schema without its access model being documented.

### 16.53 Security test identities

Security tests should use multiple explicit identities:

- Signed-out client
- User A
- User B
- Unrelated user
- Request owner
- Offering user
- Accepted helper
- Rejected offering user
- Course member
- Course nonmember
- Conversation member
- Removed conversation member
- Group owner
- Group administrator
- Normal group member
- Trusted server process
- Administrator or moderator where applicable

Testing only as the record owner is insufficient.

### 16.54 Required RLS tests

Every protected table should test:

- Allowed `SELECT`
- Denied `SELECT`
- Allowed `INSERT`
- Denied `INSERT`
- Allowed `UPDATE`
- Denied `UPDATE`
- Allowed `DELETE` where applicable
- Denied `DELETE`
- Ownership spoofing
- Membership spoofing
- Cross-user access
- Signed-out access
- Terminal-status behavior
- Function-mediated operations
- Direct-table bypass attempts

Tests should verify both returned data and database state.

### 16.55 Function security tests

Privileged functions should test:

- Missing authentication
- Invalid authentication
- Wrong owner
- Wrong membership
- Valid caller
- Forged user ID
- Invalid record ID
- Concurrent execution
- Duplicate retry
- Partial-operation rollback
- Unsafe status transition
- Search-path manipulation attempt
- Unexpected execution role
- Excess returned data

A function must not be considered safe only because its happy path works.

### 16.56 Secret scanning

The repository and CI should detect committed secrets.

Secret review should cover:

- `.env` files
- Expo configuration
- EAS configuration
- Source files
- Test fixtures
- Documentation
- Screenshots
- Build logs
- GitHub Actions
- Migration files

`.env.example` must contain placeholders only.

If a real secret is committed, removing it from the latest file is not enough; the secret must be revoked and rotated.

### 16.57 Monitoring and alerts

Production monitoring should eventually cover:

- Authentication failure spikes
- Rate-limit spikes
- Database errors
- RLS authorization failures
- Edge Function failures
- Push delivery failures
- Invalid token growth
- Realtime connection failures
- Storage upload failures
- Suspicious request or message volume
- Administrative actions
- Backup failures

Alerts must avoid including private message or request content.

### 16.58 Incident response

Before production, CampusClutch should document:

1. How a security issue is reported.
2. Who receives the report.
3. How access is restricted.
4. How leaked credentials are rotated.
5. How affected environments are identified.
6. How logs are preserved.
7. How users are notified when required.
8. How data is restored.
9. How the fix is tested.
10. How the incident is documented afterward.

An incident-response owner and backup contact must be defined.

### 16.59 Production security gate

CampusClutch must not be described as production-ready until at least:

- RLS exists on all exposed application tables.
- RLS and function tests pass.
- Client builds contain no server secrets.
- Authentication abuse protections are configured.
- Production SMTP is configured.
- Storage policies are tested.
- Push credentials remain server-side.
- Security Advisor findings are reviewed.
- Backup and recovery behavior is documented.
- Administrative access uses MFA and least privilege.
- Blocking and reporting are implemented.
- Privacy and retention policies are approved.
- Account deletion is functional.
- Monitoring and incident response are prepared.

### 16.60 Security implementation order

Security is implemented alongside each backend domain rather than added at the end.

The recommended order is:

1. Establish environment and secret boundaries.
2. Add authentication configuration and session security.
3. Add profile constraints and RLS.
4. Add course and membership constraints and RLS.
5. Add request constraints and ownership policies.
6. Add offer transactional authorization.
7. Add conversation membership and message policies.
8. Add notification and push security.
9. Add Storage policies.
10. Add rate limits and abuse controls.
11. Add blocking, reporting, and moderation.
12. Add automated security tests.
13. Review Security Advisor findings.
14. Complete production security review.

## 17. Environment Strategy

### 17.1 Goals

The CampusClutch environment strategy must:

- Separate local, development, preview, and production data.
- Prevent preview builds from connecting to production accidentally.
- Keep real secrets out of the Expo client.
- Keep real environment files out of Git.
- Provide a safe `.env.example`.
- Make developer setup repeatable.
- Track database changes through migrations.
- Support CI validation.
- Support EAS development, preview, and production builds.
- Allow safe credential rotation.
- Keep test data out of production.
- Avoid one shared unrestricted backend for every environment.

Environment setup will begin during Task 4, not during Task 3.

### 17.2 Planned environments

CampusClutch should use four environment levels:

1. Local developer environment
2. Shared development environment
3. Preview environment
4. Production environment

Each level has a different purpose and must not be treated as interchangeable.

### 17.3 Local developer environment

Each developer should eventually run a local Supabase stack for:

- Schema development
- Migration development
- RLS testing
- Database-function testing
- Seed data
- Authentication-flow testing
- Resettable integration tests

The local stack should:

- Run only on the developer's machine.
- Use local generated credentials.
- Use development-only users and records.
- Be reproducible from committed configuration and migrations.
- Be resettable without affecting hosted environments.
- Never be exposed directly to the public internet.
- Never contain production personal data.

The local stack is not a production server.

### 17.4 Shared development environment

A hosted development Supabase project should support:

- Team integration testing
- Development builds
- Testing across physical devices
- Shared test accounts
- Early authentication testing
- Testing remote email callbacks
- Testing remote Storage behavior
- Testing remote Realtime behavior
- Reviewing migrations before preview deployment

Development data may be deleted or reset.

No real student data should be required.

### 17.5 Preview environment

A separate hosted preview Supabase project should support:

- EAS preview APK and internal iOS builds
- Pull-request or release-candidate testing
- Physical-device acceptance testing
- Authentication redirect testing
- Push-notification testing
- Realtime testing
- Storage-policy testing
- Security-policy testing
- End-to-end testing before production

Preview must not connect to production data.

Preview test accounts and push tokens must remain separate from production accounts and tokens.

### 17.6 Production environment

The production Supabase project will eventually contain:

- Real user accounts
- Real profiles
- Real memberships
- Real requests
- Real messages
- Real notifications
- Production Storage objects
- Production push-device registrations

Production access must be limited.

Production changes require:

- Reviewed migrations
- Passing CI
- Approved security tests
- Backup and recovery review
- Deployment documentation
- Rollback planning
- Monitoring

No production project is created during Task 3.

### 17.7 Environment isolation decision

The preferred hosted architecture is:

- One shared development Supabase project
- One preview Supabase project
- One production Supabase project
- One local stack per developer

Separate projects provide clearer isolation for:

- Auth users
- Database records
- Storage buckets
- Realtime configuration
- Redirect URLs
- SMTP configuration
- Edge Function secrets
- Logs
- Push-device registrations

Project availability and cost must be reviewed before Task 4.

Environment separation must not be weakened silently to reduce setup work.

### 17.8 Supabase branching

Supabase database branching may later provide temporary branch environments.

It is not required for the initial architecture.

The baseline workflow should remain usable without paid branching:

- Local database for feature work
- Shared development project
- Preview project
- Production project
- Version-controlled migrations

Branching may later be evaluated for:

- Pull-request databases
- Migration review
- Isolated integration tests
- Short-lived feature environments

The team must review cost, limitations, seed behavior, Auth behavior, and cleanup before enabling it.

### 17.9 Environment names

CampusClutch should use consistent environment names:

- `local`
- `development`
- `preview`
- `production`

### 17.10 Expo public variables

The Expo client will eventually require public configuration similar to:

```text
EXPO_PUBLIC_APP_ENV=
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

These values are considered public because they are embedded in the mobile application.

Security must rely on:

* Supabase Auth
* Row Level Security
* SQL grants
* Storage policies
* Function authorization
* Correct environment separation

The publishable key is not a replacement for user authentication.

### 17.11 Supabase key decision

New CampusClutch client configuration should prefer the Supabase publishable key.

The planned client variable is:

```text
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

A legacy anonymous key should be used only when required by a reviewed compatibility issue.

The architecture must not expose:

```text
SUPABASE_SECRET_KEY
SUPABASE_SERVICE_ROLE_KEY
```

Secret and service-role credentials bypass normal client authorization and are server-only.

### 17.12 Server-only environment values

Potential server-only values include:

```text
SUPABASE_SECRET_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_DB_URL
SUPABASE_ACCESS_TOKEN
EXPO_ACCESS_TOKEN
SMTP_PASSWORD
PUSH_PROVIDER_SECRET
WEBHOOK_SECRET
```

These values may be needed by:

* Supabase Edge Functions
* Protected CI jobs
* Database migration jobs
* Trusted administrative scripts
* Push-delivery services
* SMTP integrations
* Webhook handlers

They must not use the `EXPO_PUBLIC_` prefix.

They must not be imported by Expo application code.

### 17.13 `.env.example`

Task 4 should add a committed `.env.example` containing placeholders only.

The initial shape should be similar to:

```text
# Public Expo client configuration
EXPO_PUBLIC_APP_ENV=development
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

The example file must:

* Contain no real secret key.
* Contain no database password.
* Contain no SMTP credentials.
* Explain which values are public.
* Explain where developers obtain local or hosted values.
* Remain synchronized with required client configuration.

Server-only variables may use a separate documented template if trusted backend tooling later requires them.

### 17.14 Local environment files

Real local environment files must be ignored by Git.

Potential ignored files include:

```text
.env
.env.local
.env.development.local
.env.preview.local
.env.production.local
```

The final `.gitignore` update must be reviewed against Expo's environment-file behavior.

Before committing Task 4, the developer must verify ignore behavior with commands such as:

```powershell
git status --short --untracked-files=all
git check-ignore -v .env.local
```

A real environment file must not be staged.

### 17.15 Environment-file workflow

The preferred local workflow is:

* Keep `.env.example` committed.
* Keep `.env.local` ignored.
* Copy the required placeholders into `.env.local`.
* Add approved local or development values.
* Use one documented active source of configuration.
* Avoid multiple conflicting environment files.
* Verify the active backend before creating test data.

The documentation must explain which file takes priority when multiple files exist.

### 17.16 Backend selection

CampusClutch should not rely on manually changing `NODE_ENV` to select a Supabase project.

Build tools may set `NODE_ENV` automatically.

Backend selection should instead use:

* EAS environment selection
* Explicit public environment values
* An approved local `.env.local`
* Build-profile configuration

The selected Supabase URL must be explicit and reviewable.

The application must never silently fall back to production.

### 17.17 Static Expo variable access

Expo public variables should be referenced statically:

```typescript
process.env.EXPO_PUBLIC_APP_ENV
process.env.EXPO_PUBLIC_SUPABASE_URL
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

The implementation should avoid dynamic access such as:

```typescript
process.env["EXPO_PUBLIC_SUPABASE_URL"]
```

Task 4 should create a typed configuration module that validates the required values before constructing the Supabase client.

### 17.18 Typed environment configuration

The Expo application should not read environment variables throughout unrelated screens.

A typed configuration module should eventually:

* Read public variables once.
* Validate required values.
* Validate the environment name.
* Reject empty configuration clearly.
* Export only approved public values.
* Avoid logging keys.
* Avoid exposing server-only variable names.
* Keep screens independent of raw environment access.
* Provide a safe development error message.

The exact filename and location will be chosen during Task 4 after inspecting the current repository.

### 17.19 Configuration failure behavior

When required configuration is missing or invalid:

* The application must not silently connect to another environment.
* The application must not use a production fallback.
* The Supabase client must not be created with empty values.
* Development should display a clear configuration error.
* Preview and production should fail during build or startup validation where practical.
* Logs must not expose keys or secret values.

Connecting to the wrong environment is more dangerous than an explicit startup failure.

### 17.20 EAS environment mapping

CampusClutch should map its existing EAS build profiles to EAS environments:

* `development` profile uses development variables.
* `preview` profile uses preview variables.
* `production` profile uses production variables.

Task 4 must inspect the current `eas.json` before changing it.

No existing EAS build behavior should be modified without review.

### 17.21 EAS variable scope

CampusClutch variables should normally be project-scoped rather than account-wide.

Project-scoped variables reduce accidental reuse by unrelated Expo projects.

Account-wide values should be used only when:

* The value is intentionally shared.
* The security implications are understood.
* The value is not specific to one backend project.
* Access has been reviewed.

Supabase project URLs and keys should normally be project-scoped.

### 17.22 EAS variable visibility

Public client values may use an appropriate EAS visibility setting.

However:

* `EXPO_PUBLIC_*` values remain readable from the compiled application.
* Secret visibility does not make embedded client values confidential.
* Server-only values must not be referenced by client code.
* Production secrets must not be written directly into `eas.json`.
* Visibility settings should reflect operational handling, not create false security assumptions.

### 17.23 EAS Build verification

Every EAS build must use the intended environment.

The build process should verify:

* Build profile
* EAS environment
* Application environment identifier
* Supabase project URL
* Expo project ID
* Android package identifier
* iOS bundle identifier
* Update channel where applicable

A preview build must not use production variables.

A production build must not use preview variables.

### 17.24 EAS Update

EAS Update must use explicit environment and channel selection.

Before publishing an update, the team must verify:

* Runtime compatibility
* Target branch or channel
* Target build environment
* Supabase backend environment
* Public environment variables
* Production approval where applicable

A preview JavaScript update must not be delivered to a production runtime.

### 17.25 Development-build configuration

Development builds may connect to:

* Local Supabase from an emulator
* Local Supabase through an approved device-access method
* Shared development Supabase

Physical-device access to a local backend requires explicit networking configuration.

The local Supabase stack must not be exposed publicly merely to simplify device testing.

When safe local-device connectivity is impractical, the shared development project should be used.

### 17.26 Preview-build configuration

Preview builds should connect only to the preview Supabase project.

Preview configuration should include:

* Preview Supabase project URL
* Preview publishable key
* Preview authentication redirect URLs
* Preview Storage buckets
* Preview Edge Function endpoints
* Preview push-device environment label
* Preview test users
* Preview monitoring context

Preview records may be reset after testing.

### 17.27 Production-build configuration

Production builds should connect only to the production Supabase project.

Production configuration requires:

* Production Supabase project URL
* Production publishable key
* Production authentication redirect URLs
* Production SMTP
* Production Storage policies
* Production Edge Function secrets
* Production push configuration
* Production monitoring
* Production backup review

Production secrets must not be stored in `eas.json`.

### 17.28 Local Supabase repository structure

Task 4 should eventually initialize a `supabase/` directory similar to:

```text
supabase/
├── config.toml
├── migrations/
└── seed.sql
```

The expected version-control direction is:

* Commit `config.toml`.
* Commit migration files.
* Commit safe development seed structure.
* Ignore temporary CLI state.
* Reference secrets through environment variables.
* Never hard-code OAuth, SMTP, webhook, or provider secrets into `config.toml`.

The exact generated structure must be inspected before staging.

### 17.29 Database migrations

All schema changes should be represented by timestamped migration files.

Migrations may define:

* Tables
* Enums
* Constraints
* Indexes
* Row Level Security
* Policies
* Grants
* Database functions
* Triggers
* Storage policies
* Realtime publication changes
* Safe data transformations

Dashboard-only schema changes should be avoided after the migration workflow begins.

### 17.30 Local migration workflow

The planned local schema workflow is:

1. Update local `main`.
2. Create a focused branch.
3. Start the local Supabase stack.
4. Create one focused migration.
5. Reset the local database.
6. Apply all migrations from zero.
7. Load safe seed data.
8. Run database and RLS tests.
9. Review the migration.
10. Commit only related files.
11. Push and open a pull request.
12. Deploy only after review and CI.

Exact Supabase CLI commands will be defined during implementation.

### 17.31 Hosted migration workflow

Hosted schema changes should follow this order:

1. Validate locally.
2. Deploy to shared development.
3. Run integration and security tests.
4. Deploy to preview.
5. Complete physical-device acceptance testing.
6. Merge approved work to `main`.
7. Deploy to production through a protected process.

There should be no casual manual production database push from an unreviewed local branch.

The project must avoid competing schema changes from multiple developer machines.

### 17.32 Migration ownership

Each migration should have:

* One focused purpose
* A clear filename
* Reviewed SQL
* Security-impact review
* Data-loss review
* Environment deployment order
* Test evidence
* Rollback or recovery notes

Large unrelated schema changes should be divided into smaller migrations where safe.

### 17.33 Seed data

Seed data is for development and testing only.

Appropriate seed records include:

* Campuses
* Academic terms
* Sample courses
* Explicit test profiles
* Test requests
* Test conversations
* Controlled interests

Seed data must not contain:

* Real student accounts
* Production email addresses
* Real private messages
* Real push tokens
* Real credentials
* Real moderation records
* Production personal information

Production reference data should be delivered through reviewed migrations or administrative workflows, not development seed files.

### 17.34 Test accounts

Each hosted non-production environment may use explicit test accounts.

Test-account documentation should define:

* Purpose
* Environment
* Role
* Owned records
* Reset behavior
* Credential storage
* Who may access the account
* Cleanup procedure

Test credentials must not be committed.

Shared test accounts should be minimized.

### 17.35 Authentication redirect URLs

Each hosted environment requires separate approved authentication redirect URLs.

Redirect configuration must distinguish:

* Development builds
* Preview builds
* Production builds
* Local web testing where applicable
* Password-reset links
* Email-verification links

A preview verification link must not open the production backend flow.

Wildcard redirect URLs should be avoided unless their security impact has been reviewed.

### 17.36 SMTP separation

Authentication email behavior should be environment-specific.

Development and preview may use:

* Controlled testing SMTP
* Limited recipients
* Test templates

Production requires:

* Approved sender domain
* Production SMTP credentials
* Reviewed templates
* Delivery monitoring
* Bounce handling
* Authentication email rate-limit review

Production SMTP credentials remain server-side.

### 17.37 Edge Function environments

Edge Functions should use environment-specific secrets.

Development, preview, and production must not share unrestricted:

* Supabase secret keys
* Push credentials
* SMTP credentials
* Webhook secrets
* Third-party API credentials

Function deployments must target the intended project explicitly.

### 17.38 Push environment isolation

Push registrations must store their environment.

The push sender must:

* Send development notifications only to development tokens.
* Send preview notifications only to preview tokens.
* Send production notifications only to production tokens.
* Reject mismatched project identifiers.
* Disable invalid tokens without affecting other environments.

### 17.39 CI environment strategy

CI should use temporary or protected test configuration.

CI must not expose production secrets to ordinary pull requests.

Future CI may:

* Start local Supabase services.
* Apply all migrations.
* Load safe seed data.
* Run RLS tests.
* Run database-function tests.
* Generate database types.
* Verify that no migration drift exists.
* Run application checks.

Production deployment credentials should be available only to protected deployment workflows.

### 17.40 GitHub secrets

GitHub repository or environment secrets may eventually store:

* Supabase access token
* Supabase project reference
* Database deployment credential
* Expo access token
* Server-only test credentials

Secrets should be scoped to the minimum required workflow.

Production secrets should use protected GitHub environments where available.

### 17.41 Environment validation checklist

Before building or deploying, verify:

* Current Git branch
* Working-tree status
* Build profile
* Application environment
* Supabase project URL
* Supabase project reference
* Migration state
* Authentication redirect URLs
* Storage bucket environment
* Push environment
* No real secret is staged

### 17.42 Developer setup documentation

Task 4 documentation should explain:

* Required Node version
* Required npm version
* Supabase CLI setup
* Docker requirement for local Supabase
* How to create `.env.local`
* How to retrieve local public values
* How to start the local stack
* How to reset the local database
* How to apply migrations
* How to load seed data
* How to run checks
* How to stop local services

Instructions should use PowerShell-compatible commands.

### 17.43 Environment security requirements

The environment implementation must ensure:

* No server secret enters the Expo client.
* No real `.env` file enters Git.
* Preview cannot reach production accidentally.
* Local data does not contain production personal information.
* Hosted project access follows least privilege.
* Production migrations are reviewed.
* Credentials can be rotated.
* Logs do not expose keys.
* Test accounts remain environment-specific.

### 17.44 Environment testing requirements

The environment milestone must eventually test:

* Missing Supabase URL
* Missing publishable key
* Invalid environment name
* Local configuration
* Development configuration
* Preview configuration
* Production configuration
* Preview build cannot access production
* Production build cannot access preview
* Authentication redirect per environment
* Storage isolation
* Push-token isolation
* Edge Function secret isolation
* `.env.local` ignore behavior
* `.env.example` contains placeholders only
* Client bundle contains no server secret
* Migration replay from an empty database
* Development seed reset
* CI migration and RLS tests
* EAS environment mapping
* EAS Update environment mapping

## 18. Storage Strategy

### 18.1 Goals

The CampusClutch Storage architecture must:

* Support profile avatars securely.
* Keep file ownership tied to authenticated users.
* Prevent users from accessing or modifying another user's files without authorization.
* Enforce allowed file types and size limits.
* Avoid storing image binary data in PostgreSQL rows.
* Keep development, preview, and production files separate.
* Support safe replacement and cleanup.
* Support account deletion.
* Avoid introducing general-purpose file sharing before its safety requirements are approved.

The first Storage milestone should support avatars only.

Request attachments, message attachments, documents, videos, and other uploads require separate product and security reviews.

### 18.2 Avatar bucket

CampusClutch should create a dedicated avatar bucket.

The preferred initial direction is a private bucket because student profiles are intended for authenticated CampusClutch users rather than unrestricted public internet access.

The bucket should define:

* Approved image MIME types
* A reviewed maximum file size
* Private access by default
* Storage RLS policies
* Environment-specific separation
* A documented cleanup process

The exact bucket name will be chosen during implementation.

A likely name is:

```text
avatars
```

### 18.3 Avatar database reference

The `profiles` table should store only the object path or stable file reference.

It should not store:

* Base64 image data
* Raw binary image data
* Permanent signed URLs
* Device-local file paths
* User-provided external image URLs without review

A signed URL may expire and therefore should not be stored as the permanent avatar reference.

### 18.4 Object-path design

Avatar files should use a user-scoped generated path.

A suitable structure is:

```text
<profile-id>/<generated-file-id>.<approved-extension>
```

The path must:

* Include the authenticated profile ID.
* Use a server-approved or application-generated unique filename.
* Avoid trusting the original device filename.
* Avoid predictable shared filenames outside the user's directory.
* Remain separate across Supabase environments.

The database profile row stores the current avatar object path.

### 18.5 Upload workflow

The planned avatar upload flow is:

1. The authenticated user selects an image.
2. The client validates basic type and size requirements.
3. The client prepares the approved upload format.
4. The client generates a safe unique object name.
5. Storage policies verify that the path belongs to the authenticated user.
6. The upload completes.
7. The backend profile record is updated with the new path.
8. The application confirms that the new avatar can be loaded.
9. The previous avatar is deleted safely.
10. The UI displays the confirmed avatar.

The previous avatar should not be deleted before the replacement upload and profile update succeed.

### 18.6 File-type restrictions

The avatar bucket should allow only reviewed image types.

Potential initial types include:

* JPEG
* PNG
* WebP

The final implementation must validate:

* File extension
* Declared MIME type
* Actual content where practical
* Image decoding
* Maximum dimensions
* Maximum file size

Client validation improves the experience but must not replace Storage restrictions and backend checks.

SVG should remain disabled initially because it can contain active content and requires additional sanitization.

### 18.7 File-size and image processing

The project should select a conservative avatar size limit during implementation.

The upload flow may resize or compress images before upload to:

* Reduce bandwidth
* Reduce Storage usage
* Improve profile loading
* Avoid excessively large source images
* Standardize avatar quality

The original full-resolution image does not need to be retained unless a later product requirement justifies it.

The app should preserve reasonable image quality and orientation.

### 18.8 Storage access policies

Storage access must be enforced through policies on Storage objects.

The initial policy direction is:

#### Upload

* The user must be authenticated.
* The first path segment must match the authenticated user ID.
* The bucket must be the approved avatar bucket.
* The object must satisfy bucket restrictions.

#### Read

* Authenticated users may read avatars required by approved profile, request, course, and conversation screens.
* Signed-out users receive no avatar access initially.
* Hidden or inaccessible profiles must not become discoverable through Storage alone.

#### Update

* Users may replace only objects inside their own user-scoped path.
* Users cannot overwrite another user's object.

#### Delete

* Users may delete only their own avatar objects through an approved workflow.
* Trusted account-deletion processing may remove all objects owned by a deleted user.

Storage access must not be broader than profile visibility.

### 18.9 Loading avatars

The application should obtain avatar access through an approved authenticated download or short-lived authorized URL.

The client must handle:

* Missing avatar
* Expired URL
* Authorization failure
* Network failure
* Corrupt image
* Deleted object
* Loading placeholder
* Retry behavior

The existing initials-based avatar fallback should remain available.

### 18.10 Avatar replacement and caching

Replacing an avatar must account for image caching.

Using a unique object name for each replacement avoids a device continuing to show an old cached file.

The profile row should update only after the new object exists.

After confirmation:

* The new path becomes authoritative.
* The old object is queued for deletion.
* Failed cleanup is recorded and retried safely.
* The application refreshes the displayed avatar.

### 18.11 Orphaned-file cleanup

Orphaned files may occur when:

* Upload succeeds but profile update fails.
* Profile update succeeds but old-file deletion fails.
* A user closes the application during replacement.
* Account deletion partially fails.

A trusted cleanup process should identify avatar objects that:

* Are not referenced by any profile
* Belong to deleted accounts
* Exceed an approved temporary age
* Are marked for deletion

Cleanup must not delete the current profile avatar.

### 18.12 Account deletion

Account deletion must remove avatar objects before or as part of deleting the Auth user.

The trusted deletion workflow should:

1. Identify all user-owned avatar objects.
2. Remove the objects using trusted authorization.
3. Verify deletion or record a retry.
4. Clear the profile reference.
5. Continue the approved database anonymization or deletion process.
6. Delete the Auth user only after required cleanup is handled.

The mobile application must not contain a secret-level Storage credential.

### 18.13 Future request attachments

Request attachments are not included in the first Storage milestone.

Before adding them, the architecture must define:

* Allowed request categories
* Allowed file types
* File-size limits
* Maximum attachment count
* Ownership
* Visibility
* Accepted-helper access
* Moderation
* Reporting
* Malware risk
* Retention
* Cleanup after cancellation or deletion

Request attachments must use a separate bucket or clearly separated policy model.

### 18.14 Future message attachments

Message attachments are also deferred.

Before adding them, the architecture must define:

* Conversation-member access
* Upload authorization
* Download authorization
* Attachment types
* Media previews
* Retention after user deletion
* Blocking and reporting
* Removed-member access
* Forwarding or sharing behavior
* Malware and abusive-content controls

Persistent text messaging should work before message attachments are introduced.

### 18.15 Environment separation

Development, preview, and production must use separate Storage environments.

The implementation must prevent:

* Preview profiles from referencing production objects
* Production users from receiving development URLs
* Development cleanup jobs from targeting production
* Push or test data from crossing environments

Object paths may be similar between environments because the projects themselves remain separate.

### 18.16 Storage migration order

The avatar Storage migration should occur during the persistent profile task.

A proposed order is:

1. Create the avatar bucket through a reviewed migration or setup process.
2. Configure MIME-type and size restrictions.
3. Add Storage RLS policies.
4. Add typed avatar upload functions.
5. Add avatar loading and fallback behavior.
6. Add upload progress and errors.
7. Add profile-path update.
8. Add safe avatar replacement.
9. Add old-file cleanup.
10. Add account-deletion cleanup.
11. Test on Android and iOS preview builds.
12. Remove obsolete mock avatar assumptions only after testing.

### 18.17 Storage testing requirements

The Storage milestone must eventually test:

* Authenticated avatar upload
* Signed-out upload rejection
* Upload into own path
* Upload into another user's path rejection
* Read approved avatar
* Unauthorized avatar access rejection
* Valid JPEG
* Valid PNG
* Valid WebP
* Disallowed file type
* Oversized file
* Empty file
* Corrupt image
* Unique filename generation
* Avatar replacement
* Old-file cleanup
* Failed profile update after upload
* Failed old-file deletion
* Missing avatar fallback
* Deleted avatar fallback
* Account-deletion cleanup
* Development and preview separation
* Storage policy tests
* Client contains no server Storage secret

No Storage bucket, object, policy, package, migration, or Supabase project is created during Task 3.

## 19. Mock-Data Migration Order

### 19.1 Migration goals

The migration from mock and in-memory data must:

* Keep the app buildable after every pull request.
* Migrate one domain at a time.
* Preserve existing routes and UI where practical.
* Avoid one giant backend change.
* Keep unaffected screens using their current data until their migration begins.
* Remove mock paths only after the replacement has been tested.
* Add loading, empty, error, and retry states with each domain.
* Add backend authorization with the data model, not afterward.

### 19.2 Migration principles

Each migration task should:

1. Inspect the latest repository files.
2. Define the focused data boundary.
3. Add backend schema and security.
4. Add typed data access.
5. Connect one existing UI flow.
6. Test success and failure behavior.
7. Preserve unrelated mock flows.
8. Remove only obsolete code for that domain.
9. Run local checks.
10. Merge before starting a dependent task.

The app must not mix production data and mock data in a way that misrepresents mock users as real students.

### 19.3 Stage 1 — Backend foundation

Task 4 should add only:

* Local Supabase project structure
* Hosted environment plan implementation
* Public Expo environment variables
* `.env.example`
* Ignored real environment files
* Typed configuration validation
* Typed Supabase client
* Initial connection handling
* Setup documentation

It must not migrate every feature.

### 19.4 Stage 2 — Authentication

Task 5 should add:

* Sign up
* Email verification
* Sign in
* Sign out
* Password reset
* Session restoration
* Protected navigation
* Authentication loading and error states
* Minimal profile initialization

Existing mock feature data may remain after authentication is introduced.

### 19.5 Stage 3 — Profiles and avatars

Task 6 should migrate:

* Signed-in user profile
* Public student profiles
* Interests
* Discoverability
* Profile editing
* Avatar Storage
* Profile loading and error states

Mock student profiles should remain only where a still-unmigrated flow requires clearly identified fixtures.

### 19.6 Stage 4 — Courses and memberships

Task 7 should migrate:

* Course catalog
* Academic terms
* Add Course
* Leave Course
* Current courses
* Previous courses
* Classmate queries
* Shared-course information

This task should also resolve the existing Courses `useMemo` warnings because it is the focused Courses migration.

### 19.7 Stage 5 — Requests

Task 8 should migrate:

* Request feed
* Filters
* Create Request
* Request details
* Request ownership
* Editing
* Cancellation
* Status and timestamps
* Category-specific details

`RequestsContext` should remain until the backend-backed replacement is confirmed.

### 19.8 Stage 6 — Request offers

Task 9 should migrate:

* Offer Help
* Persistent offer state
* Withdrawal
* Owner offer review
* Rejection
* Atomic acceptance
* Request status synchronization
* Offer-related notifications

The local Offer Sent state should be removed only after persisted state survives screen reopening and application restart.

### 19.9 Stage 7 — Conversations and messages

Task 10 should migrate:

* Inbox conversations
* Direct conversation creation
* Group conversations
* Membership
* Persistent messages
* Read and unread state
* Archive and mute
* Request-linked conversations
* Realtime updates

The existing Android keyboard behavior must be preserved.

### 19.10 Stage 8 — Notifications

Task 11 should migrate:

* In-app notification history
* Unread count
* Mark read
* Navigation targets
* Offer notifications
* Message notifications
* Deadline reminders
* Push-device registration
* Push delivery
* Notification preferences

Push delivery should be added only after persistent in-app notification records work.

### 19.11 Stage 9 — Remove obsolete mock paths

Mock and in-memory paths should be removed only after all dependent flows work.

Removal should include:

* Obsolete mock records
* Obsolete local providers
* Duplicate data-access paths
* Temporary fallback code
* Unused shared types
* Unused imports
* Outdated documentation

Development fixtures may remain in an explicit seed system.

### 19.12 Compatibility during migration

During migration:

* A backend-backed screen may coexist with unrelated mock-backed screens.
* One domain should have one clear source of truth.
* Screens must not silently merge mock and real records.
* Mock records must not receive real ownership or authorization behavior.
* Test accounts should replace fake students when relational testing requires real users.

### 19.13 Rollback approach

Each stage should be independently reversible where practical.

A rollback plan may include:

* Reverting the focused application commit
* Applying a forward-fix migration
* Disabling a feature flag where approved
* Restoring the prior data-access module
* Preserving existing backend records during UI rollback

Applied production migrations should not be casually rewritten or deleted.

### 19.14 Migration completion criteria

A domain is migrated only when:

* Backend records persist.
* Authorization is enforced.
* Loading, empty, error, and retry states exist.
* Relevant tests pass.
* Physical-device behavior is verified where necessary.
* Existing routes still work.
* Obsolete mock code is identified.
* Documentation is updated.
* CI passes.
* The pull request is reviewed and merged.

## 20. UX Requirements

### 20.1 Global requirements

Every backend-backed screen must define:

* Initial loading state
* Empty state
* Error state
* Retry behavior
* Refresh behavior where appropriate
* Submitting or saving state
* Disabled state
* Success feedback
* Authorization failure
* Session-expired behavior
* Offline behavior
* Safe navigation behavior

A screen must not remain blank while a request is loading or has failed.

### 20.2 Loading states

Loading states should:

* Appear promptly.
* Preserve the existing layout where practical.
* Avoid repeated layout jumps.
* Distinguish initial loading from refresh.
* Avoid blocking unrelated navigation unnecessarily.
* Prevent duplicate submissions.
* Avoid showing stale private data after account changes.

Skeletons may be used where they improve clarity, but a simple loading indicator is acceptable initially.

### 20.3 Empty states

Empty states should explain:

* What is empty
* Why it may be empty
* What the user can do next

Examples include:

* No current courses
* No classmates found
* No open requests
* No offers yet
* No conversations
* No messages
* No notifications

Empty states should preserve the current CampusClutch visual design.

### 20.4 Error states

User-facing errors should distinguish:

* Validation error
* Network failure
* Authentication required
* Session expired
* Permission denied
* Record not found
* Conflict
* Rate limit
* Temporary server failure

Errors must not expose internal SQL, stack traces, credentials, or private record details.

### 20.5 Retry behavior

Retry actions should:

* Repeat only the failed operation.
* Avoid duplicate creates.
* Preserve user input where safe.
* Use idempotency keys for messages and other retry-sensitive operations.
* Avoid retrying permanent authorization or validation errors automatically.
* Clearly indicate when retrying later is required.

### 20.6 Form behavior

Backend forms must:

* Preserve field-level validation.
* Disable duplicate submission.
* Show submitting state.
* Preserve typed input after recoverable failure.
* Focus or identify invalid fields.
* Handle server validation.
* Avoid showing success before the backend confirms the write.
* Preserve Android keyboard and scrolling behavior.

### 20.7 Optimistic updates

Optimistic updates may be used only when:

* The operation is likely to succeed.
* The rollback is clear.
* The optimistic state cannot create a security misunderstanding.
* The final backend result is reconciled.

Good candidates may include:

* Mark notification read
* Archive conversation
* Update local mute state

Riskier operations should wait for backend confirmation:

* Create request
* Accept offer
* Send final success state
* Delete account
* Change membership
* Upload avatar

### 20.8 Offline behavior

CampusClutch is not initially designed as a fully offline-first application.

The initial offline direction is:

* Detect clear network failures.
* Preserve unsent form input where practical.
* Allow retry after reconnection.
* Avoid pretending a backend write succeeded.
* Display previously loaded non-sensitive data only when safe.
* Clear private cached data after sign-out.
* Refetch important records after reconnection.

Message offline queues require a separate reliable design.

### 20.9 Session restoration

The app must have a clear session-restoration state.

Before restoration completes:

* Do not assume signed-in status.
* Do not briefly display protected screens.
* Do not load private data for the previous user.
* Do not redirect repeatedly.
* Show an appropriate splash or loading state.

### 20.10 Authorization changes

The UI must handle access changing while a screen is open.

Examples include:

* User removed from a group
* Request cancelled
* Offer accepted by another device
* Course membership ended
* Profile hidden
* Session revoked

The app should:

* Stop unauthorized subscriptions.
* Clear inaccessible private data.
* Show an understandable state.
* Return to a safe route where necessary.

### 20.11 Destructive actions

Actions such as leaving a course, cancelling a request, withdrawing an offer, leaving a group, deleting an avatar, or deleting an account require:

* Clear action label
* Consequence explanation
* Confirmation
* Submitting state
* Failure recovery
* No duplicate action
* Success feedback
* Safe navigation afterward

### 20.12 Realtime UX

Realtime updates should:

* Reconcile with persisted data.
* Avoid duplicate rows.
* Avoid unexpected list jumping.
* Preserve user scroll position where practical.
* Display newly received messages clearly.
* Refetch after reconnecting.
* Avoid showing events the user is no longer authorized to see.

### 20.13 Accessibility baseline

Every migrated screen should preserve or improve:

* Accessible labels
* Touch-target sizes
* Font scaling
* Contrast
* Screen-reader order
* Keyboard focus
* Error announcements
* Disabled-state clarity

A complete accessibility audit remains a later roadmap task.

### 20.14 Domain requirements

Each domain must preserve its established behavior:

* Courses retain search, selection, and classmate routing.
* Profiles retain Student Not Found and avatar fallback.
* Requests retain filters, validation, date handling, and keyboard avoidance.
* Offers retain clear submitted and accepted states.
* Messages retain multiline input and Android keyboard behavior.
* Notifications retain navigation and unread styling.

### 20.15 UX completion criteria

A migrated screen is not complete until:

* Success behavior works.
* Loading behavior works.
* Empty behavior works.
* Failure behavior works.
* Retry works.
* Duplicate submission is blocked.
* Authorization loss is handled.
* Android behavior is tested.
* Navigation remains correct.

## 21. Testing Strategy

### 21.1 Goals

Testing must verify:

* Application logic
* Screen behavior
* Data access
* Database constraints
* RLS authorization
* Database functions
* Storage policies
* Realtime behavior
* End-to-end user flows
* Environment isolation
* Regression safety

Linting and TypeScript checks alone are not sufficient for production readiness.

### 21.2 Current checks

The existing baseline remains:

```text
npm run lint
npm run typecheck
npm run check
```

The expected current result is:

* 0 errors
* 2 existing Courses warnings

Those warnings should be resolved during the persistent Courses migration.

### 21.3 Unit tests

Unit tests should cover pure logic such as:

* Environment validation
* Data mappers
* Request validation
* Course-code normalization
* Status formatting
* Notification navigation mapping
* Message reconciliation
* Date and deadline helpers
* Error translation
* Permission helper logic that does not replace backend authorization

### 21.4 Component tests

Component tests should cover:

* Loading states
* Empty states
* Error states
* Form validation
* Submitting states
* Retry behavior
* Button disabling
* Navigation calls
* Authentication guards
* Message composer behavior
* Notification read styling

Expo-compatible Jest and React Native Testing Library should be evaluated during the automated-testing task.

### 21.5 Database tests

Database tests should run against a resettable local Supabase environment.

They should verify:

* Tables
* Required constraints
* Foreign keys
* Unique constraints
* Check constraints
* Enums
* Index existence where critical
* Functions
* Triggers
* Transaction rollback
* Seed data
* Migration replay

pgTAP or another Supabase-compatible database test approach should be used for SQL-level tests.

### 21.6 RLS tests

RLS tests must use multiple identities.

At minimum:

* Signed-out client
* User A
* User B
* Record owner
* Unrelated authenticated user
* Course member
* Course nonmember
* Request owner
* Offering user
* Accepted helper
* Conversation member
* Removed member
* Trusted backend process

Tests must verify both allowed and denied operations.

### 21.7 Function tests

Trusted functions must test:

* Valid caller
* Missing authentication
* Wrong owner
* Wrong membership
* Forged IDs
* Duplicate retry
* Concurrent execution
* Partial-operation rollback
* Invalid state transition
* Excess returned data
* Restricted execution grants

High-risk functions include:

* Profile initialization
* Course join or rejoin
* Request creation
* Offer acceptance
* Direct conversation creation
* Mark all notifications read
* Account deletion

### 21.8 Storage-policy tests

Storage tests must verify:

* Upload to own path
* Upload to another user's path rejected
* Approved read access
* Unauthorized read rejected
* Replacement
* Deletion
* MIME restrictions
* File-size restrictions
* Missing object
* Account cleanup
* Environment separation

### 21.9 Integration tests

Integration tests should exercise the Expo data-access layer against a test backend.

Examples include:

* Sign up creates a profile.
* Add Course creates one membership.
* Create Request creates matching detail data.
* Offer acceptance updates offers and request atomically.
* Accepted offer links a conversation.
* Message send creates a notification.
* Mark notification read updates unread count.
* Avatar upload updates the profile reference.

### 21.10 End-to-end tests

End-to-end testing should cover critical user journeys on preview builds.

Potential Maestro flows include:

* Sign up and verify account
* Sign in and restore session
* Complete profile
* Add a course
* View classmates
* Create a request
* Offer help from another account
* Accept the offer
* Open linked conversation
* Send a message
* Read a notification
* Sign out

Physical-device manual testing remains necessary for:

* Native date picker
* Android keyboard behavior
* Push notifications
* Deep links
* Background and closed-app behavior
* Permission prompts
* Image selection and upload

### 21.11 Realtime tests

Realtime testing should verify:

* Authorized subscription
* Unauthorized subscription rejection
* New message delivery
* Offer update delivery
* Notification delivery
* Reconnection
* Missed-event refetch
* Duplicate-event reconciliation
* Subscription cleanup
* Sign-out cleanup
* Membership removal

### 21.12 Environment tests

Environment tests should verify:

* Missing public configuration
* Invalid environment value
* Development configuration
* Preview configuration
* Production configuration
* Preview cannot access production
* Production cannot access preview
* Storage isolation
* Push-token isolation
* Auth redirect isolation
* Edge Function secret isolation

### 21.13 CI phases

The CI roadmap should progress gradually.

#### Current CI

* Install dependencies
* Run `npm run check`

#### Database foundation CI

* Start local Supabase
* Apply migrations
* Load safe seed data
* Run database tests
* Run RLS tests
* Verify migration replay

#### Application test CI

* Run unit tests
* Run component tests
* Run integration tests
* Generate coverage where useful

#### Preview acceptance

* Build preview application
* Run critical end-to-end flows
* Complete manual device checks
* Review CI and EAS results before merge

### 21.14 Test data

Tests must use:

* Explicit generated users
* Stable fixtures
* Safe fake emails
* Deterministic course and request records
* Isolated test transactions or resets
* No production personal data
* No real push tokens
* No committed credentials

Tests must clean up or reset their data.

### 21.15 Test reliability

Tests should avoid:

* Depending on execution order
* Sharing mutable state unexpectedly
* Using uncontrolled current time
* Using production services
* Using arbitrary sleeps where a real condition can be awaited
* Assuming realtime delivery without reconciliation
* Treating snapshots as the only behavioral assertion

### 21.16 Coverage priorities

The highest-priority automated coverage is:

1. Authentication and session restoration
2. RLS and ownership
3. Offer acceptance transaction
4. Conversation membership
5. Message authorization
6. Notification ownership
7. Environment isolation
8. Account deletion
9. Storage ownership
10. Critical Android flows

### 21.17 Testing completion criteria

A backend domain is ready to merge when:

* Focused unit or component tests pass.
* Database constraints are tested.
* RLS allowed and denied paths are tested.
* Functions are tested.
* Existing application checks pass.
* Manual flow testing is documented.
* Preview testing is completed where required.
* No unrelated failures are hidden.

No test framework, package, workflow, test database, or EAS workflow is added during Task 3.

## 22. Final Implementation Roadmap

### 22.1 Task 4 — Backend project and environment setup

* Create the selected Supabase projects according to the approved environment strategy.
* Initialize local Supabase structure.
* Add `.env.example`.
* Verify real environment files are ignored.
* Add typed public configuration.
* Add the typed Supabase client.
* Add setup documentation.
* Add safe configuration errors.
* Do not migrate feature data yet.

### 22.2 Task 5 — Authentication

* Sign up
* Email verification
* Sign in
* Sign out
* Session restoration
* Password reset
* Protected navigation
* Profile initialization
* Loading and error states
* University-email policy implementation if approved

### 22.3 Task 6 — Profiles and avatars

* Persistent profiles
* Profile editing
* Interests
* Discoverability
* Avatar Storage
* Storage RLS
* Loading, empty, and error states
* Account-deletion preparation

### 22.4 Task 7 — Courses and memberships

* Academic terms
* Course catalog
* Add and leave membership
* Duplicate prevention
* Current and previous courses
* Real classmates
* Shared-course information
* Resolve existing Courses warnings

### 22.5 Task 8 — Requests

* Persistent requests
* Category-specific details
* Request ownership
* Feed and filters
* Request details
* Create Request
* Edit and cancel
* Deadlines and status
* Loading, refresh, and error states

### 22.6 Task 9 — Request offers

* Persistent Offer Help
* Duplicate prevention
* Withdraw
* Owner review
* Reject
* Atomic acceptance
* Request status synchronization
* Offer notifications
* Accepted-helper authorization

### 22.7 Task 10 — Conversations and messages

* Direct conversation uniqueness
* Group conversations
* Conversation membership
* Persistent message history
* Idempotent message sending
* Read and unread state
* Request-linked conversations
* Realtime
* Archive and mute
* Preserve Android keyboard behavior

### 22.8 Task 11 — Notifications

* Persistent notification records
* Unread count
* Mark read
* Navigation
* Offer and message events
* Deadline reminders
* Push-device registration
* Preferences
* Edge Function push delivery
* Delivery receipts
* Invalid-token cleanup

### 22.9 Task 12 — Automated tests

* Unit tests
* Component tests
* Database tests
* RLS tests
* Function tests
* Storage-policy tests
* Integration tests
* End-to-end tests
* CI expansion
* Preview-environment testing

### 22.10 Task 13 — Accessibility and UI quality audit

* Screen-reader behavior
* Font scaling
* Contrast
* Touch targets
* Focus
* Small screens
* Keyboard behavior
* Android Back
* Loading, empty, error, and disabled states

### 22.11 Task 14 — Privacy, safety, and moderation

* Privacy policy
* Terms
* Retention
* Account deletion
* Blocking
* Reporting
* Moderation
* Abuse handling
* Safety notices
* Support and contact process

### 22.12 Task 15 — Production release preparation

* Final icons and splash assets
* Version and build numbers
* Production environment
* Store metadata
* Privacy and support URLs
* Google Play setup
* Apple Developer and App Store Connect setup
* Production builds
* Internal store testing
* Security review
* Backup and monitoring review

### 22.13 Task 16 — Store submission

* Android submission
* iOS submission
* Store privacy questionnaires
* Review feedback
* Release notes
* Rollback plan
* Support contact

### 22.14 Task 17 — Post-release operations

* Crash reporting
* Analytics
* Performance monitoring
* User feedback
* Bug triage
* Security review
* Backups
* Incident response
* EAS Update strategy
* Release cadence
* Dependency updates
* Regression testing

### 22.15 Task 3 completion criteria

Task 3 is complete when:

* Supabase is documented as the selected backend.
* Authentication architecture is defined.
* Profiles and interests are defined.
* Courses and memberships are defined.
* Requests and category details are defined.
* Request offers are defined.
* Conversations and messages are defined.
* Notifications and push strategy are defined.
* Security policies are defined.
* Environment strategy is defined.
* Storage strategy is defined.
* Mock-data migration order is defined.
* UX requirements are defined.
* Testing strategy is defined.
* The implementation roadmap is defined.
* The document is reviewed for contradictions and duplicate sections.
* Existing checks pass.
* The pull request passes CI.
* The pull request is reviewed and merged.

### 22.16 Approved architecture decision

CampusClutch will use Supabase as the planned backend because:

* PostgreSQL fits the application's relational data.
* Foreign keys and unique constraints protect memberships and ownership relationships.
* Row Level Security supports client-facing authorization.
* Supabase Auth supports account and session requirements.
* Realtime supports messaging and notification updates.
* Storage supports avatars with RLS.
* SQL migrations fit the existing Git and pull-request workflow.
* Local development supports repeatable schema and security testing.

This approval does not make CampusClutch production-ready.

Implementation remains divided into focused tasks and pull requests.

### 22.17 Production warning

CampusClutch must not be described as fully production-ready until it has:

* Real authentication
* Permanent backend storage
* Tested authorization
* Security-rule tests
* Account deletion
* Blocking
* Reporting
* Moderation
* Privacy and retention policies
* Production environment isolation
* Secret management
* Push-notification security
* Automated tests
* Monitoring
* Backup and recovery planning
* Store configuration
* Production release testing

Task 4 must not begin until this architecture document is reviewed, its pull request passes CI, and it is merged into main.
