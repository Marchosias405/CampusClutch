# CampusClutch Backend Setup

## Purpose

This guide explains how to configure and run the CampusClutch Supabase foundation.

Task 4 only establishes the backend and environment foundation. It does not migrate profiles, courses, requests, offers, conversations, messages, or notifications.

For the full architecture, see `docs/backend-plan.md`.

## Current Environment Structure

| Environment | Supabase backend | EAS environment |
|---|---|---|
| Local | Local Supabase through Docker | Local `.env.local` |
| Development | CampusClutch Development | `development` |
| Preview | CampusClutch Preview | `preview` |
| Production | Not created yet | `production` reserved |

The repository is linked to the hosted Development project. Do not relink it to Preview unless a later deployment procedure explicitly requires it.

## Required Software

Install:

- Node.js
- npm
- Docker Desktop
- Git
- PowerShell
- Expo and EAS access
- Supabase account access

The Task 4 setup was verified with:

- Node.js 22.11.0
- npm 11.2.0
- Supabase CLI 2.109.1
- Docker Desktop 29.1.3

One dependency reports an engine warning with Node 22.11.0 and prefers Node 22.13.0 or newer in the Node 22 release line. The current checks still pass.

Verify the tools:

```powershell
node --version
npm --version
docker --version
npx supabase --version
npx eas-cli@latest whoami
```

## Install Project Dependencies

From the repository root:

```powershell
npm install
```

Do not run `npm audit fix --force` without reviewing the dependency changes.

## Environment Variables

CampusClutch uses these public Expo variables:

```text
EXPO_PUBLIC_APP_ENV
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Only public client configuration may use the `EXPO_PUBLIC_` prefix.

Never place any of the following in Expo client configuration:

- Supabase secret key
- Service-role key
- Database password
- Supabase access token
- Private server credentials

## Create the Local Environment File

Copy the example file:

```powershell
Copy-Item .env.example .env.local
```

Open it:

```powershell
notepad .env.local
```

For local development, use:

```text
EXPO_PUBLIC_APP_ENV=development
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<local publishable key>
```

Replace the placeholder with the local publishable key shown by the Supabase CLI.

Do not place secret, service-role, JWT, or database credentials in `.env.local`.

Verify that Git ignores the file:

```powershell
git check-ignore -v -- .env.local
git status --short --untracked-files=all
```

`.env.local` must not appear as an untracked or modified file.

## Start Local Supabase

Start Docker Desktop first.

Then run:

```powershell
npx supabase start
```

View the local service status:

```powershell
npx supabase status
```

Default local endpoints:

```text
API: http://127.0.0.1:54321
Database: port 54322
Studio: http://127.0.0.1:54323
Mailpit: http://127.0.0.1:54324
```

Do not paste complete `supabase status` output into public chats because it can display local development credentials.

## Open Supabase Studio

After the local stack starts, open:

```text
http://127.0.0.1:54323
```

Supabase Studio can be used to inspect the local database, authentication records, storage, and SQL state.

## Local Database Reset

Reset the local database from version-controlled migrations:

```powershell
npx supabase db reset
```

This command recreates the local database, applies migrations from `supabase/migrations`, and runs `supabase/seed.sql`.

A reset deletes local database records. It does not delete data from hosted Supabase projects.

## Create a Migration

Create a migration with a descriptive lowercase name:

```powershell
npx supabase migration new descriptive_migration_name
```

Edit the generated SQL file under:

```text
supabase/migrations/
```

Test the full migration history locally:

```powershell
npx supabase db reset
```

Schema changes must be stored in migrations. Do not rely on manual dashboard changes as the permanent source of truth.

Task 4 does not create application tables.

## Seed Data

Local development seed data belongs in:

```text
supabase/seed.sql
```

Seed data is loaded automatically by:

```powershell
npx supabase db reset
```

Seed data must contain only fake development records.

Never add real student data, production credentials, private messages, or personal information.

## Hosted Development Project

The repository is linked to:

```text
CampusClutch Development
```

Verify the link:

```powershell
npx supabase projects list
```

The linked marker should remain beside CampusClutch Development.

After migrations are created, reviewed, and tested locally, they can later be applied to the linked Development project with:

```powershell
npx supabase db push
```

Do not run `db push` until the migration being deployed has been reviewed.

Do not create feature tables during Task 4.

## Hosted Preview Project

The Preview backend is:

```text
CampusClutch Preview
```

The local repository should remain linked to Development, not Preview.

Preview deployment will be handled through a controlled workflow after migrations exist.

## EAS Environment Configuration

The following EAS environments are used:

```text
development
preview
production
```

The Development and Preview environments currently contain:

```text
EXPO_PUBLIC_APP_ENV
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

The Production environment is reserved but is not configured yet.

View configured variable names with:

```powershell
npx eas-cli@latest env:list --environment development
npx eas-cli@latest env:list --environment preview
```

Do not paste complete environment output into public chats.

The EAS build profiles in `eas.json` map to environments with the same names.

## Typed Environment Configuration

Public configuration is validated in:

```text
src/lib/env.ts
```

The module validates the environment name, Supabase URL, Supabase publishable key, and missing configuration.

Invalid or missing configuration produces a clear startup error instead of silently connecting to the wrong backend.

## Supabase Client

The Supabase client is located at:

```text
src/lib/supabase.ts
```

It configures:

- React Native URL support
- AsyncStorage session persistence
- Automatic token refresh
- Persistent sessions
- Disabled browser URL-session detection

Authentication lifecycle handling will be implemented in Task 5.

## Run the Application

Ensure `.env.local` exists and local Supabase is running.

Then run:

```powershell
npx expo start --clear
```

Task 4 must not break the existing mock-data application flows.

## Quality Checks

Run:

```powershell
npm run check
git diff --check
git status
```

The current known Courses dependency warnings are tracked separately and are not part of Task 4.

Expected Task 4 result:

- Zero errors from `npm run check`
- No whitespace errors
- No committed environment files
- No committed secret keys
- Existing application flows still work

## Stop Local Supabase

Stop the CampusClutch local services while preserving local database state:

```powershell
npx supabase stop
```

Do not use volume-deletion options unless local data should intentionally be removed.

## Security Checklist

Before committing backend work, confirm:

- `.env.local` is ignored.
- `.env.example` contains placeholders only.
- No database password is committed.
- No Supabase secret or service-role key is committed.
- Only publishable keys are used by the Expo client.
- Schema changes are stored in migrations.
- Seed data contains only fake records.
- The repository remains linked to Development.
- Preview and Development remain isolated.
- Production credentials do not exist in the repository.

## Task 4 Completion Boundary

Task 4 is complete when:

- Local Supabase can start.
- Development and Preview projects exist.
- EAS Development and Preview variables are configured.
- Typed environment validation exists.
- A Supabase client exists.
- Setup documentation exists.
- No secrets are committed.
- Project checks pass.
- The application still works with its existing mock data.

Authentication starts in Task 5.
