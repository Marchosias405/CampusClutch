# 🎓 Clu

Clu helps SFU students find classmates, review courses, message each other, and exchange campus help for points. It runs on Expo, React Native, TypeScript, and Supabase.

**Launch status · November 25, 2026**

The core app has passed Android Preview testing. The GitHub repository is now **Clu**. The new name and graduation badge are implemented on `codex/clu-launch-brand`. The next phone checkpoint is a signed Clu APK.

## ✅ Complete

| Area | What works |
| --- | --- |
| Accounts and profiles | Email signup, verification and password reset across devices, profile editing, private avatars, discoverability, and account deletion. Accepted jobs must be resolved before deletion. Other participants retain past messages under “Deleted student.” |
| Courses and reviews | Browse Fall 2026 and Spring 2027 offerings, read reviews before joining, find classmates, and write reviews for previously taken courses through the review directory. Authors can revise a hidden review. |
| Requests and points | Create and filter four request types, make and accept offers, finish or cancel jobs, transfer reserved points, and submit mutual ratings. New students receive a one-time welcome grant. |
| Messages and alerts | Realtime direct messages, unread counts, profile access from a DM, a bell inbox, and Android push preferences. Background DM delivery was confirmed on a phone. New public postings stay in the request feed by default. |
| Safety and moderation | Blocking, reports on students, requests, messages and reviews, admin review and recovery, content removal, warnings, seven-day suspensions, and appeals. Students receive reasons and can see appeal decisions and their warning count. |
| Interface and privacy | Loading screens, skeletons, reduced-motion support, consistent profile actions, separate admin controls, and offline-readable privacy and terms drafts. |
| Security and CI | Server-side authorization, row-level security, protected sessions and private drafts, and avatar storage limits. GitHub CI passed the app checks, database migrations, pgTAP suite, and browser workflows on `main` at `d58636e`. |

## 🚧 Remaining before launch

1. **Finish the Clu rollout.** The branding branch passed lint, TypeScript, and 42 automated checks. Verify the live Expo project name and slug, review and merge the branch, and roll out the branded database notices, Edge Functions, and separately hosted password-reset page. Existing app identifiers preserve upgrades and account access.
2. **Produce the signed Android Preview.** The release gate, Expo credentials, and Supabase migration dry run passed. Expo’s free Android build quota stopped the APK step. The run applied no migrations and published no install link. After the reported **December 1** quota reset, check the seven-day Supabase token and deploy the current tested `main` commit. Refresh the friend-testing branch once the branded APK passes its phone check. [Deployment run](https://github.com/Marchosias405/Clu/actions/runs/45369404498) · [Release guide](docs/preview-deployment.md)
3. **Activate production privacy controls.** Local tests passed for audited admin holds and cleanup of expired requests, messages, job history, closed cases, bell entries, and deletion receipts. Held evidence survives account deletion and becomes eligible for cleanup after its last hold and retention obligations end. Roll out the deferred migrations and schedules, verify a hosted backup restore, and enforce verified SFU email at launch. Preview accepts other email addresses for testing. Publish the operator name, monitored privacy mailbox, and final privacy notice and terms.
4. **Prepare the store release.** Configure Production credentials, redirects, and push delivery. Recheck permissions and dependency advisories, then complete internal testing, store listings, screenshots, privacy disclosures, monitoring, and rollback arrangements.

## 📱 Phone checks still open

The consolidated checklist has **31 of 33** confirmed passes. The later UI and policy checklist has **13 of 14**. Keep these checks open for a later session:

| Check | Pass condition |
| --- | --- |
| **19 · Overturn a warning** | Overturn a warning in the cycle that triggered an automatic suspension. The count drops and access returns unless another suspension applies. |
| **33 · Restore points once** | Delete and recreate a disposable account with the same email. The exact prior balance returns once, survives restart and sign-in, and earns no second welcome grant. |
| **M6 · Sign-in and profile setup** | An unverified sign-in reaches verification recovery. The sign-in screen has no permanent verification shortcut, and the Continue and Delete account buttons on profile setup have visible space between them. |

- **Next APK:** Install over the previous Preview. Check the Clu launcher icon, splash screen, sign-in, push notification, and account-recovery page. Confirm the existing account still opens.
- **Later:** Run the multi-user notification pilot across accounts and devices. TalkBack testing is deferred. Group conversations and creator-made quests are also deferred.

## 🧪 Run the tester emulator on Windows

Use an Intel or AMD 64-bit PC with Git installed and virtualization enabled. Paste both lines into **PowerShell or Command Prompt**. The tester branch launches its packaged Preview APK and needs no backend credentials. Its current APK predates the Clu branding.

```bat
git clone -c http.sslBackend=schannel --depth 1 --single-branch --branch codex/friend-preview https://github.com/Marchosias405/Clu.git Clu-test
.\Clu-test\Run-on-Windows.cmd
```

Already cloned? From inside the tester folder, run:

```bat
git pull --ff-only
.\Run-on-Windows.cmd
```

## 🛠️ Develop and verify

Use Node 22 and npm. From the source checkout, run:

```sh
npm ci
npm run check
node --test scripts/release/preview.test.cjs
```

Use a feature branch and merge through CI. For local app and database setup, follow the [backend setup guide](docs/backend-setup.md). Feature details are in the [course catalog](docs/spring-2027-course-catalog.md), [requests](docs/task-8-requests.md), [offers and points](docs/task-9-offers.md), and [messaging](docs/task-10-messages.md) guides. [Apache 2.0 license](LICENSE)
