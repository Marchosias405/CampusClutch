# 🎓 Clu

Clu helps SFU students find classmates, review courses, message each other, and exchange campus help for points. It runs on Expo, React Native, TypeScript, and Supabase.

[Explore SFU course reviews](https://clu.expo.app/) · [Open the Clu web app](https://clu--pilot.expo.app/)

**Android Preview · November 25, 2026.** The signed Clu APK supports in-place upgrades. The launcher, splash screen and account access passed Preview testing. The branded DM notification still needs a physical Android check. [Branding PR](https://github.com/Marchosias405/Clu/pull/35)

## 🛠️ Project milestones

Clu began as a five-tab prototype with sample data. These milestones track its development into a multi-user Android Preview.

| Phase | What we built and verified |
| --- | --- |
| 1 · Build setup | Linked the Expo project to EAS and configured development, Preview and production build profiles. |
| 2 · Android Preview | Built and installed a signed APK so testers could run the app without a development server. |
| 3 · Backend design | Mapped the student workflows to a Postgres schema and defined who could read or change each record. [Architecture](docs/backend-plan.md) |
| 4 · Environments | Set up local Supabase and separate hosted Development and Preview projects, with typed configuration for each environment. |
| 5 · Authentication | Added email verification, session restoration and protected navigation. Verification and password reset work when the email opens on another device. |
| 6 · Student profiles | Added onboarding, editable profiles, interests, private avatars and controls for who can discover a student. |
| 7 · Courses and reviews | Imported Fall 2026 and Spring 2027 SFU offerings and connected classmates through enrolment. Students can read reviews before joining and review courses taken in earlier terms. |
| 8 · Campus requests | Students can post delivery, pickup, event and study requests with deadlines, filter the feed by category, and edit or cancel their own requests. |
| 9 · Offers and points | Accepting an offer reserves the points for one helper. Completion pays the helper, cancellation releases the reservation, and ratings appear after both students submit. |
| 10 · Messaging | Built private realtime DMs, request-linked conversations, read receipts and unread counts. Students can open a classmate’s profile from a conversation. |
| 11 · Notifications | Connected the bell inbox and Android push to messages and offer decisions. Confirmed background DM delivery on a phone. Public requests stay in the feed by default. |
| 12 · Automated tests | Added component tests, pgTAP checks for row-level security and two-student browser tests to CI. A local run passed 59 concurrency cases, including competing offers and points transfers. [CI workflow](.github/workflows/ci.yml) |
| 13 · Accessibility and usability | Fixed large-text clipping and keyboard layouts, added loading placeholders and reduced-motion support, and separated admin actions from student controls. TalkBack testing is deferred. |
| 14 · Privacy and moderation | Students can block, report and appeal. Admins can remove content and issue warnings or suspensions with reasons. Added admin recovery, account deletion and offline privacy and terms drafts. |
| 15 · Release preparation (in progress) | Applied the Clu branding, hardened sessions, drafts and avatar storage, and built the Preview deployment workflow. Verified the signed APK against the previous release certificate. |

## 🚧 Remaining before launch

- **Preview rollout.** Complete the automated release and deploy the branded notices and account-recovery pages. The earlier cloud build reached Expo’s free Android quota. Check the deployment token when the quota resets, then refresh the friend-testing branch after the phone check. [Deployment run](https://github.com/Marchosias405/Clu/actions/runs/45369404498) · [Release guide](docs/preview-deployment.md)
- **Privacy and production readiness.** Retention holds and cleanup passed local tests, including preserving held evidence after account deletion. Deploy the schedules and deferred migrations, verify a hosted backup restore, enable SFU-only signup, and publish the operator name, privacy mailbox and final policies. Preview accepts other verified emails.
- **Phases 16–17 · Store submission and operations (planned).** Finish production credentials and internal testing, submit the store listings and privacy disclosures, and set up crash monitoring, support and rollback procedures.

## 📱 Phone checks still open

The consolidated checklist has **31 of 33** confirmed passes. The later UI and policy checklist has **13 of 14**. Keep these checks open for a later session:

| Check | Pass condition |
| --- | --- |
| **19 · Overturn a warning** | Overturn a warning in the cycle that triggered an automatic suspension. The count drops and access returns unless another suspension applies. |
| **33 · Restore points once** | Delete and recreate a disposable account with the same email. The exact prior balance returns once, survives restart and sign-in, and earns no second welcome grant. |
| **M6 · Sign-in and profile setup** | An unverified sign-in reaches verification recovery. The sign-in screen has no permanent verification shortcut, and the Continue and Delete account buttons on profile setup have visible space between them. |

- **Clu branding checks 1, 2 and 4 passed in Preview.** The launcher shows the graduation badge. The splash screen, existing account and courses, and sign-out/sign-in flow passed.
- **Check 3 is pending on a physical Android phone.** Put Clu in the background and have another account send a DM. Check the notification icon and Clu app label, then tap the notification to open the app.
- **After the hosted rollout:** Check the Clu wording in a new notification and on the email verification and password-reset pages.
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
