# Deploying main to Preview

GitHub Actions builds an internal Android APK for the commit that passed CI on `main`. After the APK succeeds, it applies reviewed database migrations to **Clu Preview**, deploys the three Edge Functions and checks the Auth and email callback endpoints. Open **Actions → Deploy Preview → Summary** for the install link and commit.

## Browser pilot

Open the [Clu web pilot](https://clu--pilot.expo.app) in Safari or another browser. Sign in with an Android Preview account to see the same profile, courses and conversations. To check a shared link, open [Courses](https://clu--pilot.expo.app/courses) while signed out, sign in and refresh. Both steps should land on Courses.

Use the same three public Preview environment variables as Android. Run
`npm run web:pilot` to export the site and check the compiled backend and route
manifest. Publish it with `eas deploy --export-dir .expo/clu-web-pilot --environment preview --alias pilot`.
The `pilot` alias is independent of both the Android workflow and the `account`
alias used in password-recovery emails.

## Enable the first release

- Integrate the tested app, all its migration files and its database CI job into `main`. CI must pass both **Lint and typecheck** and **Database migrations and pgTAP** on the push. Pull requests run regression tests. A run superseded on `main` skips deployment.
- In GitHub **Settings → Environments**, create `preview` and restrict deployments to `main`. Set the environment secrets `EXPO_TOKEN` and `SUPABASE_ACCESS_TOKEN` using deployment credentials scoped as narrowly as available. Supabase can issue a temporary database login. Set `SUPABASE_DB_PASSWORD` only if the deployment identity needs a database password to connect.
- In Expo, use the existing `preview` environment, its public Supabase settings, the `GOOGLE_SERVICES_JSON` Android client file variable and the existing Android signing credentials. The APK consumes an EAS Android build when a usable build for that tested commit does not already exist. Check the account’s build allowance before enabling deployments.

## What gets released

- Preview is pinned to `udbijakeasbvoycjyghe`. A dry run checks the migration history in an isolated work directory before requesting an APK. The deployment skips seed data and role imports. Ten historical retention and signup-policy migrations have separate rollout checkpoints. Their exact filenames are listed in [preview.cjs](../scripts/release/preview.cjs). Review the rollout and dry run before changing that list.
- Functions are `account-deletion`, `android-push` and `email-verified`, using the JWT settings in `supabase/config.toml`. Existing schedules, dashboard Auth configuration, worker secrets and the separately hosted password-reset page have their own rollout procedures.
- If the run fails partway through, fix the cause and rerun the failed jobs while that commit is still current. Migration history preserves completed migrations. The APK step reuses a matching finished build or waits for one already in progress. Functions can be deployed again. The install link is published in the run summary after the checks pass.

Run the offline release checks with `node --test scripts/release/preview.test.cjs`. For the provider setup, see [Expo builds on CI](https://docs.expo.dev/build/building-on-ci/) and [Supabase deployment environments](https://supabase.com/docs/guides/deployment/managing-environments).
