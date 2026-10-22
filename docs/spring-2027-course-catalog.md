# Spring 2027 SFU course catalog — local and hosted checkpoints

This is a focused catalog checkpoint before Task 11. Tasks 1–10 remain complete; notifications, group messaging and creator-made quests remain deferred.

## Scope

- Published **Spring 2027** SFU enrollment sections with an explicit undergraduate degree level and **at least 3 units**.
- One CampusClutch offering per course, term and campus. Multiple qualifying sections at the same campus share one offering. Different campuses and explicitly online offerings remain separate.
- Units shown are the minimum across the included qualifying enrollment sections. Non-enrollment tutorials/labs are not separate courses; legitimate enrollment labs worth at least 3 units remain eligible.
- Graduate, below-three-unit and explicitly cancelled sections are excluded. Unknown degree level, variable/invalid units, unresolved campus, identity mismatch and conflicting titles are reported for review, never guessed.
- Existing course IDs, memberships and historical records are preserved. Importing does not register anyone with SFU or indicate seat availability.

The source is the [SFU Course Outlines API](https://www.sfu.ca/outlines/help/api.html), using its [Spring 2027 inventory](https://www.sfu.ca/bin/wcm/course-outlines?2027/spring). Term dates follow the [Spring 2027 calendar](https://www.sfu.ca/students/calendar/2027/spring.html): January 5 through April 26, including exams. The calendar lists approved courses; the outlines API supplies the published term/section evidence used here.

The API location labels `GOLDCORP` and `DT VSAR` map to Vancouver using [SFU Student Services’ building/location reference](https://www.sfu.ca/students/enrolment-services/exams/study-spaces/building-and-locations.html). Unrecognized locations remain quarantined.

## Catalog and data safety

The reviewed snapshot lives at `supabase/catalogs/sfu/2027-spring.json`. It includes eligible rows, fetch times, public source URLs, exclusions and unresolved records. Neither instructor details nor student information is collected. The app queries the database in 30-row pages; it does not download this snapshot or fetch SFU data on the phone.

The importer defaults to a complete transactional dry run that rolls back. It only connects to local Postgres at `127.0.0.1:54322`. The hosted checkpoint below used a separately reviewed administrative SQL transaction generated from the same importer; the local-only CLI was not pointed at a hosted database. Repeated imports preserve IDs and enrollments, reject unmanaged collisions and older records, and update only matching source-managed offerings. Empty snapshots fail closed.

Incomplete source coverage requires an explicit `--allow-source-gaps` after reviewing the snapshot. This imports verified rows only. Missing courses are retained by default. `--close-missing` is available only for a complete inventory with no quarantined records, affects only source-managed offerings in this term, and refuses an older snapshot that would close newer data. It never deletes a course or its enrollments.

## App behavior

- Add a Course searches the selected term on the server, with debounce, paging, retry and stale-result protection.
- Spring 2027 displays the undergraduate/3+ unit scope. Results show units and campus/Online.
- Joined upcoming courses appear in **Courses → Upcoming**, survive reload, and can be removed/re-added.
- Account changes clear prior-account screen state; enrollment mutations pin the intended account.
- Classmate discovery retains its current-term requirement. Upcoming courses explain that classmates become available when the term starts.

## Repeatable local workflow

Docker Desktop/local Supabase must be running. PostgreSQL `psql` must be on PATH (on this laptop: `C:\Program Files\PostgreSQL\17\bin`). These commands do not target hosted Development or Preview.

```powershell
Set-Location D:\Projects\CampusClutch
$env:Path = "C:\Program Files\PostgreSQL\17\bin;" + $env:Path

# Resume a scan using sanitized cached responses.
node scripts/sfu-catalog.cjs --output "$env:TEMP\campusclutch-sfu-2027"
# Add --refresh when you deliberately need a new source snapshot.
# Exit code 2 means the snapshot was written but source coverage has gaps.

# Review rows, errors, quarantine and coverage before selecting the snapshot.
# Dry run the checked-in reviewed snapshot:
node scripts/import-sfu-catalog.cjs --snapshot supabase/catalogs/sfu/2027-spring.json --allow-source-gaps
# Commit the same reviewed data to LOCAL Supabase:
node scripts/import-sfu-catalog.cjs --snapshot supabase/catalogs/sfu/2027-spring.json --allow-source-gaps --apply-local

npm run test:catalog
npm run test:catalog-local
npm run check
```

The initial collection on this Windows/Node 22 laptop needed `NODE_EXTRA_CA_CERTS` pointing to its trusted Windows CA export. The local export is in the workspace at `catalog-spring2027/windows-trusted-ca.pem`; it is not part of the repository. TLS verification remained enabled.

`--plan-only --output <file.sql>` writes a reviewable rollback SQL plan without connecting. Do not use `--allow-source-gaps` without reviewing the actual failures, or treat the API inventory as a guarantee of every eventual offering. The source was refreshed and independently reviewed before the hosted import below; refresh and reconcile it again near launch. Term status currently follows the existing administrative reference-data model; this change does not add a scheduled term rollover.

## Local checkpoint results — October 22, 2026

**All six local phone checks passed on October 22, 2026, including offline save/search recovery with the gateway stop/start method below.** Local Supabase has migration `20261022111506_sfu_catalog_metadata_and_search.sql` and 990 verified offerings covering 933 distinct course codes: 723 Burnaby, 115 Surrey, 92 Vancouver and 60 online. Existing six course records, eight memberships, all other application rows and existing auth accounts were preserved exactly. Repeating the import plan reports zero new rows and 990 existing matches.

Source coverage is intentionally not marked complete:

- 77 of 78 department endpoints and 1,801 of 1,809 course section-list endpoints were readable. All 2,898 discovered enrollment-section detail endpoints were read.
- Nine endpoints returned HTTP 404: SCI; BISC 657; CMNS 428, 455W and 830; COGS 300; ENGL 112W and 431W; PSYC 379. An unavailable endpoint does not prove the course is not offered.
- 770 section records need review: 742 lack a published instructional campus or explicit online delivery, 14 lack usable units, and 14 lack an explicit degree level. These involve 264 course codes, some of which have other eligible sections already imported. Many are directed-study/practicum sections. Their full URLs and reasons are in the snapshot.
- 936 graduate sections, 101 below-three-unit sections and 1,786 non-enrollment components were excluded. No guessed course, unit value or campus was added.
- The source snapshot was reviewed and imported with `--allow-source-gaps`, with no absence-based closing or deletion. Reconcile these gaps and refresh before launch; the catalog is not a promise of every eventual Spring offering.

Validation passed:

- 27 collector/parser/cache checks, 21 importer unit checks, 12 typed-client checks and 16 production-screen runtime checks.
- 66 new SQL assertions, including all pages of a 1,250-offering fixture, RLS, literal search, metadata constraints and current-term classmate restrictions.
- 19 rollback-only import SQL assertions for repeat imports, stable identities/memberships, safe updates, stale snapshots, collisions and source-owned closing.
- 12 live local Auth/PostgREST checks against all 990 imported offerings, with exact temporary-account cleanup and unchanged application data.
- All 13 existing course-membership SQL assertions, 20 classmate-message entry checks and 17 group-deferral/integration checks.
- Lint/typecheck, Android/web exports, rollback migration replay and local migration-history verification. Advisors report only the two pre-existing multiple-permissive-policy warnings on profiles/social links; none involve the catalog changes.

The Supabase CLI completed advisors, capture and history operations but returned a telemetry shutdown timeout afterward. Database results and migration history were independently verified with PostgreSQL. The captured migration was narrowed to the reviewed catalog DDL; unrelated private-function serialization and the test extension were excluded.

At this local checkpoint, hosted Development and Preview still had their 24 Task 10 migrations and there was no catalog APK. The subsequent hosted checkpoint is recorded below. Existing 2026 fixture term statuses are retained locally; explicitly select **Spring 2027** for local checks.

## Manual phone checkpoint

Use the development client with this branch and local Supabase, not the existing standalone Preview APK. Keep USB connected and Metro open:

```powershell
Set-Location D:\Projects\CampusClutch
adb devices
adb reverse tcp:8081 tcp:8081
adb reverse tcp:54321 tcp:54321
npx expo start --dev-client --localhost
```

1. Open **Courses → + → Spring 2027**. Confirm the undergraduate/3+ unit label and campus/Online plus units on results. Search a known course such as **CMPT 120** and verify its official details. Below-three-unit and graduate offerings must not appear in this term's imported catalog.
2. Search by course code and part of a title, clear search, and use **Load more courses**. Results should not duplicate, disappear or mix with another selected term. Change the search quickly and confirm only the newest query remains.
3. Add a Spring course, go back to **Upcoming**, close/reopen the app and confirm it remains. Adding it again must not create a duplicate. Upcoming classmates should remain unavailable with an explanation.
4. Remove that upcoming course, reload, then add it again. Confirm removal persists and rejoining produces one entry.
5. Switch accounts. The other account must not inherit the first account's courses. Both may independently add the same offering.
6. Disconnect database access or go offline while keeping the development bundle available. Failed search/join must provide retry; a failed join should keep the selection. Reconnect and retry once. Confirm one saved membership. Existing current courses and classmate direct messaging should still work.

For check 6, stop only the local API gateway while leaving Docker, the database, USB and Metro running. Removing the USB listener alone did not reliably interrupt access in the first phone attempt: CMPT 363 was actually saved once, so that attempt does not count as an offline failure/retry pass. On October 22, the gateway stop/start method was verified separately: the API became unreachable while Postgres stayed healthy, then returned HTTP 200 after restart. The user subsequently confirmed check 6 passed, completing the local phone gate.

In a second PowerShell window, first restore forwarding if it was removed:

```powershell
adb reverse tcp:54321 tcp:54321
```

Select a different Spring course that is not already added, then run:

```powershell
docker stop --timeout 5 supabase_kong_CampusClutch
```

Wait for the command to finish. Tap Add and confirm a failure message with the selection retained. Restore access with:

```powershell
docker start supabase_kong_CampusClutch
```

Allow a few seconds for the gateway to start, then retry Add. Confirm exactly one upcoming membership after reopening the app. Repeat the same stop/start sequence for a changed search query and its Retry course search button. Finish with the gateway running. This does not delete or reset database data; no app source change was needed for the successful-save report. For a different checkout, verify its gateway name with `docker ps --filter name=supabase_kong --format '{{.Names}}'` before stopping it.

The local reset-email inbox remains http://127.0.0.1:54324/.

The six local, six standalone catalog and both later banner-removal phone checks are complete. Final PR review, required CI and merge remain before Task 11.

## Hosted Development and Preview checkpoint — October 22, 2026

**Deployment, automated hosted checks and APK inspection passed. The user confirmed all six standalone phone checks passed on build `2fd64d08` on October 22, 2026.**

Both hosted environments have 25 migrations through `20261022111506` and 990 verified offerings covering 933 course codes. Each passes 66 catalog SQL assertions, 25 imported-data assertions and 12 live Auth/PostgREST smoke groups; existing data and the complete imported catalog are preserved after exact fixture cleanup.

- The freshly collected snapshot was generated at `2026-10-22T12:32:02.304Z` (UTC), SHA-256 `a639d989009d1c9bd272d8360e5b1c36e40cf0e448c9cd8bb35c02a184d4a671`. Every included source section was independently rechecked against the sanitized source cache (1,091 section checks).
- The refreshed import includes 723 Burnaby, 115 Surrey, 92 Vancouver and 60 online offerings. The refreshed SFU source still has 9 unavailable endpoints and 770 quarantined section records. Only verified undergraduate offerings worth at least 3 units were imported; missing offerings were not closed or deleted, and complete eventual Spring coverage is not claimed.
- Both imports used reviewed transactions with source-gap acceptance and no absence-based closing. Repeated rollback plans add zero rows and match all 990 existing offerings.
- Before/after deployment fingerprints preserved all 31 Development and 31 Preview baseline relations, including existing courses, memberships, Auth users/identities and Storage objects. Live API fixture cleanup also preserved complete fingerprints including the newly imported catalog.
- Both hosted environments retain the same eight baseline advisor warnings, with no new findings. These existing findings remain tracked for launch.
- The 66 SQL assertions cover metadata constraints, RLS, literal search and stable paging. The 25 imported-data assertions compare every reviewed value/source section, campus totals and real catalog pagination. The 12 live Auth/PostgREST groups use the production typed course client, test both account identities, persist/remove/rejoin memberships, enforce session-switch guards, and verify access denials.
- [Standalone Preview build `2fd64d08`](https://expo.dev/accounts/marchosias405/projects/CampusClutch/builds/2fd64d08-8255-4907-ad06-b7506ae3d0ae) completed from source `5bf8320`, the same app code that passed the six local phone checks. Later source-snapshot/reference-data updates do not change its app code. All 16 artifact checks pass: release/non-debuggable package, embedded Hermes bundle, hosted Preview only, no local backend/development launcher, current messaging APIs, catalog search and cursors, scope/coverage notices, Upcoming courses, retry and pagination.
- APK size: 154,210,018 bytes. SHA-256: `caed2a94978362b3aea32e3bbf5ee72b51d909e2137c7845fa1bbdf2e5531f0a`. Use the stable Expo build page above to obtain a current download; do not reuse old temporary signed APK links.

## Standalone Preview phone checklist

**Status: PASSED — all six checks, confirmed by the user on October 22, 2026, using build `2fd64d08`.** This is the six-check catalog baseline; the later build `b39cde7e` also passed both visual cleanup checks below. The checklist remains below for future regression testing: use hosted Preview accounts with Metro/laptop terminals closed and USB disconnected. Local accounts and enrollments are separate; no Docker or laptop server is required.

1. Open **Courses → + → Spring 2027**. Confirm the undergraduate/3+ unit scope and published-coverage notice, with units and campus/Online on results. Search a known course such as **CMPT 120**.
2. Search by course code and part of a title, clear search and use **Load more courses**. Change searches/terms quickly; results must match the latest selection without duplicates or mixed-term rows.
3. Add a Spring course, open **Courses → Upcoming**, close/reopen the app and confirm one saved entry. Repeated Add must not duplicate it; upcoming classmates must remain unavailable with an explanation.
4. Remove that upcoming course and reopen the app; removal must persist. Add it again and confirm one entry.
5. Switch to another hosted Preview account. Courses must stay isolated; both accounts may independently add the same offering. Confirm existing current-course/classmate direct-message entry still works.
6. Select a course not already added, then turn off **both Wi-Fi and mobile data**. Add must show a failure while retaining selection. Reconnect and retry; confirm one saved entry after reopening. Repeat the offline/reconnect sequence with a changed search and **Retry course search**. Finish online.

The six-check standalone catalog phone gate and both later banner-removal visual checks are complete. Finish final review, required CI and merge before starting **Task 11 — Notifications**. Groups and creator-made quests remain deferred.

## Banner-removal Preview checkpoint

**PASSED — both visual phone checks, confirmed by the user on October 22, 2026: the banner is gone and Classmates still works.** [Preview build `b39cde7e`](https://expo.dev/accounts/marchosias405/projects/CampusClutch/builds/b39cde7e-7549-4785-bfd5-c6336bb51f62) completed on October 22, 2026 from app source `70875ef`. It removes the redundant Find Classmates / Courses banner while retaining each current course’s Classmates button. No backend changes were made for this rebuild.

Lint/typecheck and all 16 existing catalog UI runtime checks passed after the banner removal. The finished APK passes all 18 artifact checks: the prior 16 standalone/catalog checks plus absence of the redundant banner text and presence of the classmates route. The new checks were calibrated against build `2fd64d08`, which correctly fails only the banner-absence check.

APK size: 154,209,090 bytes. SHA-256: `bc773fac94f4e75edb0cf185bdadf436e31b21ccafb087b83650090f063147f1`. Use the stable Expo build page above to download; temporary signed artifact URLs expire.

Retain these steps for regression testing: install this Preview APK over the existing app, close Metro/laptop terminals and disconnect USB. Open **Courses**, then check **Current Term**, **Upcoming** and **Previous Terms**: the Find Classmates / Courses banner should be gone. Open an existing current course’s **Classmates** button and confirm it still opens the classmates page. Upcoming courses should continue to hide classmates until their term is marked current.

The six passed catalog phone checks remain recorded against build `2fd64d08`; the two visual cleanup checks passed against `b39cde7e`. All manual gates for this catalog checkpoint are complete.

## Spring 2027 launch requirement

Before launch, arrange for an administrator to mark the `2027-spring` academic term `current` in the launch backend at the term start on January 5, 2027. Reaching its calendar start date alone does not change the stored status; this checkpoint implements no scheduled term rollover. Current-course classification and classmate access require a `current` term, an `enrolled` membership and a course that is not `archived`, alongside the existing profile/privacy rules. Verify the term status and eligible classmate access as part of launch readiness. Refresh the catalog and reconcile the documented SFU source gaps again before launch.
