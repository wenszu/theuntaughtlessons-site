# Every place that still reads or writes Firestore, and what happens to it in a Supabase-only session

Written 2026-10-09 for Wen-Szu. Nothing in this document has been applied to a database, deployed or committed. It lists, one by one, the browser code that reads or writes Firestore (or calls a Firebase function) and says what is done about it. It follows `docs/SUPABASE_CUTOVER_RUNBOOK.md`, section 8, item 3, and the pages and assets searched for `getDoc`, `getDocs`, `collection(`, `onSnapshot`, `httpsCallable` and `auth.currentUser`.

Style note for later edits: no dashes, no unnatural contractions, no idioms (the owner's writing rules for the site).

## 1. The short version

1. **The account page, the site settings, the feature flags, the cohort details, the Student Progress tools (edit, reset, reward repair), the feedback switch, the support preview audit, the administrator gate, the invitation box and the public certificate check page can now all work without a Firebase session.** Each one has a Supabase path. With every switch on `firebase` each function runs exactly the Firestore code it always ran (a test compares every one against the baseline copy of `assets/firebase.js` call by call).
2. **Five new database changes are written, none applied** (migrations 2370 to 2374, section 5). One browser file is new (`assets/supabase-site.js`).
3. **Two things are different in Supabase and you should know them before you rely on them** (section 6): a reset of a student's progress cannot give the same points again, and the support preview opened from Supabase cannot show a student's saved answers. (A revoked certificate is handled by migration 2374.)
4. **What is intentionally left on Firestore** is short (section 4): two Firebase functions nobody should use (the emergency password, retired; the access request form, no page calls it), and the fallback code the pages keep so that nothing changes while the switches are off.
5. I did not touch the member gate or the member save and read data layer (the other builder owns them). Where this document mentions them it only lists them.

## 2. When does a function take the Supabase path

A function takes the Supabase path when **either** of these is true:

* the browser is a **Supabase-only session**: `localStorage utl_auth` is `supabase`. There is no Firebase user, so Firestore would refuse the request anyway. Nothing else needs to be set. The member data functions of the other builder use the same signal.
* the matching **switchboard flag** says so: `server_reads` (browser switch `utl_server_reads`) for reads, `server_writes` (`utl_server_writes`) for writes.

| What | Supabase path when | Reads or writes |
| --- | --- | --- |
| Account page (`getMemberAccount`, `updateMemberAccount`), first visit name (`saveMemberDisplayName`) | `utl_auth` is `supabase` | member's own record |
| Settings reads (the ten settings), feature flags | `utl_auth` is `supabase`, or `utl_server_reads` is `supabase` | Supabase first, Firestore fallback |
| Settings writes, cohort details, rename a cohort, feedback switch, support audit, Student Progress tools, exercise sync repair | `utl_auth` is `supabase`, or `utl_server_writes` is `supabase` | Supabase only, no Firestore call, a failure is shown to the administrator |
| Cohort details, member progress and support snapshot (the "three admin answers") | `utl_server_reads` is `supabase` **and** (`utl_server_writes` is `supabase` or `utl_auth` is `supabase`) | reads |
| Administrator gate, "is this a member", invitation | `utl_auth` is `supabase` | gate and checks |
| Public certificate check page | `utl_server_reads` is `supabase` or `utl_auth` is `supabase` | Supabase first, Firestore fallback |

With `utl_server_reads` or `utl_server_writes` set to `shadow` (or `?utl_server=shadow` in the address), Firebase answers and writes as always. For the Student Progress tools the database function is then also called as a **dry run** after the Firebase write succeeded (it writes nothing) and one console line names the fields and counts that differ, never a value. For the public certificate check, Supabase is asked in the background and the console line names the fields that differ.

The reason for the "Supabase only" rule in the first row of the table: if the settings could not be read from Firestore, every getter silently falls back to its default (the default reward levels, the default engagement settings). With a Supabase-only session that would apply wrong reward rules to real members without any error. So in that session the settings always come from Supabase.

## 3. The full list

Status words: **MOVED** (has a Supabase path, behind the rule named), **LEFT** (intentionally on Firestore or Firebase), **OTHER SLICE** (the member gate or the member data layer, owned by the other builder), **BEFORE** (moved in an earlier round, not changed here).

### 3.1 Account and member records

| Where | What it did | Status | Replacement |
| --- | --- | --- | --- |
| `assets/firebase.js` `getMemberAccount` | read `authorized_members/<address>` and `users/<uid>` | MOVED (`utl_auth`) | `get_my_account()` (migration 2371): name, goals, avatar, cohort, join date, role, status, expiry and the progress the page needs to show "not started, in progress, completed". Same answer shape; "no membership" gives the same message |
| `assets/firebase.js` `updateMemberAccount` | update the member document (name, goals, avatar) | MOVED (`utl_auth`) | the existing `update_my_profile` through the data layer (`displayName`, `goals`, `avatarIconId`), same checks and messages first |
| `member-login/content-config.js` first visit name (`doSaveName`) | `updateDoc` of `authorized_members/<address>` from the page | MOVED (`utl_auth`) | new export `saveMemberDisplayName`, which does the same `updateDoc`, or `update_my_profile({ displayName })`. The page keeps the old call as a fallback for a cached older module |
| `assets/firebase.js` `getUserFeedbackEnabled` | read `users/<uid>.feedbackEnabled` | OTHER SLICE (already done there: `getMyFeedbackEnabled`) | |
| `assets/firebase.js` `getAuthorizedMember`, `requireAuthorizedMember`, `saveUserProfile`, `settleDataSourceAtPageLoad`, `getAuthorizedMemberFirestore` | the member entry check and the sign in stamp | OTHER SLICE | |
| `apps/executive-signature/assets/site-nav.js`, `my-results/index.html`, `assets/account-record.js` | `users/<uid>` read | BEFORE (skipped for a Supabase session) | |
| `assets/feedback-widget.js` | `auth.currentUser` token | BEFORE (uses `getSignedInUser` when `utl_auth` is `supabase`) | |

### 3.2 Site settings and feature flags (flags `server_reads` and `server_writes`, or `utl_auth`)

| Where | What it did | Status | Replacement |
| --- | --- | --- | --- |
| `readSettingsDoc` (all ten getters: `getRewardSettings`, `getEngagementSettings`, `getGlobalFeedbackSetting`, `getPublicFindLevelSetting`, `getAssessmentVisibility`, `getPublicAssessmentSettings`, `getPaymentSettings`, `getAdminVisibilitySettings`, `getTsaScoringSettings`, `getEmailTemplates`) | read `settings/<doc>` | MOVED | the `app_settings` row, read through the existing data layer (`getAppSetting`). Logged out pages read the three public rows (`public_site`, `public_assessments`, `payments`) with the publishable key alone. An empty or hidden row, or any failure, goes on to the old Firestore code |
| `writeSettingsDoc` (all ten setters and `saveEmailTemplate`) | `setDoc(..., { merge: true })` then a background copy | MOVED | the Firestore merge is done on the stored row (`mergeSettings`: objects field by field, everything else replaced), then the whole document goes to the existing `admin_set_app_setting` (migration 2200, platform owner only). Two quick saves of one setting run one after the other. No Firestore call |
| `getCustomersConsoleFeatureFlag`, `getEsWorkspaceFeatureFlag` | read `platformFeatureFlags/<id>` | MOVED | the `app_settings` row `feature_flags` (staff only by row level security), keyed by the Firestore document id. A flag that is not in the row falls through to Firestore |

Key names (Firestore document to `app_settings.key`): `feedback` to `feedback`, `publicSite` to `public_site`, `engagement`, `rewards`, `assessments`, `public_assessments`, `payments`, `admin_visibility`, `tsa_scoring` the same, `emailTemplates` to `email_templates`, and `platformFeatureFlags/*` to the one row `feature_flags`.

No `get_app_setting` database function exists or is needed: reads use the table with its row level security (public rows for everyone, member rows for signed in people, staff rows for staff), as migration 2200 decided. The write function is the existing `admin_set_app_setting`.

### 3.3 The administrator gate, the invitation box, the three admin answers and the Student Progress tools

| Where | What it did | Status | Replacement |
| --- | --- | --- | --- |
| `admin/index.html` `mbGetFirebaseAdminRole` (the gate) | read `authorized_members/<address>` for the role | MOVED (`utl_auth`) | new export `getAdminRole`: Firestore as before, or `get_my_access` (the platform owner reads as admin). The page keeps the old read as a fallback. When the check itself fails in a Supabase-only session (an outage), the page says "Could not check administrator access. Please try again in a moment." and does not offer the "switch Google account" question or sign the person out; a Firebase session behaves as before |
| `admin/index.html` `handleSendLoginInvite` member check | read `authorized_members/<address>` | MOVED (`utl_auth`) | new export `memberRecordExists`, which asks `admin_member_exists` (migration 2373) |
| `sendSignInInvite` for the administrator invitation | Firebase email link | MOVED (`utl_auth`) | new export `sendAdminSignInInvite`: Edge Function `auth-admin`, route `invite` (it also makes the account of a person who has none; sign up is off). When that function is off or not deployed (404 or unreachable) the plain email link is sent instead, which only works for a person who already has an account. A refusal is never retried by e-mail |
| `getAllMemberWorkspaceProgress` | read `authorized_members` and `users` | MOVED (reads and writes flags, or `utl_auth`) | `admin_member_progress_all` (migration 2310). Used only when the Student Progress tools also write to Supabase |
| `getCohortDetails` | read `settings/cohorts` | MOVED (same rule) | `admin_cohort_details` (2310), which now reads the draft, upcoming and cancelled words because of migration 2370 |
| `getMemberSupportSnapshot` | read member, user and completed exercises | MOVED (same rule) | `admin_member_support_snapshot` (2310). **Without the learner's saved answers** (section 6, item 3) |
| `findUserUidByEmail`, `listAuthorizedMembers`, `getAllEngagementAnalytics`, `getAllStabilityEvents` | direct reads | BEFORE (`server_reads`) | 2310. A Supabase-only session now accepts a plain answer (an empty list) as the answer, because there is no Firestore to fall back to |
| `setCohortDetails` | `setDoc` of `settings/cohorts` | MOVED | `admin_mirror_cohort` (2220, replaced by 2370 so the draft, upcoming and cancelled words survive) |
| `renameCohort` | update every member, rewrite `settings/cohorts` | MOVED | `admin_mirror_cohort_rename` (2220): the cohort row and every enrollment move to the new name in one step |
| `replaceMemberWorkspaceProgress` (the Student Progress edit) | read and rewrite `users/<uid>`, `completed_exercises` | MOVED | `admin_replace_member_progress` (2372, with a dry run) |
| `resetMemberWorkspaceProgress` (reset) | same, with zero rewards | MOVED | `admin_reset_member_progress` (2372, with a dry run) |
| `repairMemberProgramCompletionReward` (award missing points) | transaction on `users/<uid>` | MOVED | `admin_repair_reward` (2372, with a dry run). A test runs the Firebase function and the database function on the same eight situations and compares the points, the total and the entry key |
| `repairMemberExerciseProgress` (re-sync) | Firebase callable that repairs the second copy of progress | MOVED | nothing to repair: Supabase has one progress table, so the answer is `{ ok: true, repaired: 0 }` |
| `setUserFeedbackEnabled` | `updateDoc` of `users/<uid>` | MOVED | `admin_mirror_feedback_enabled` (2220, replaced by 2372 so a person with only a Supabase sign in id is found) |
| `logMemberSupportPreview` | `setDoc` of `support_preview_audit/<id>` | MOVED | `admin_mirror_support_preview` (2220): one audit row with person ids only |
| `admin/index.html` question bank (health, reviews, review save) | Firestore collections | BEFORE (flags) | migration 2350. The page keeps the Firestore code when no flag is set |
| `admin/index.html` `qbReviewer`, other `auth.currentUser?.email` | session email | BEFORE | uses `getSignedInUser` when there is no Firebase account |

### 3.4 The public certificate check page

| Where | What it did | Status | Replacement |
| --- | --- | --- | --- |
| `verify/index.html` | `getDoc` of `public_credentials/<id>` from the page | MOVED | the page uses the new export `getPublicCredential` when the loaded `firebase.js` has it (a namespace import, so an older cached `firebase.js` cannot blank the page) and reads the Firestore document itself otherwise. With `utl_server_reads` or `utl_auth` on `supabase` it calls the existing anonymous `get_public_credential` (publishable key only, no token) and gets back the same field names as the Firestore document. When Supabase has nothing (the copy is behind, or the certificate is revoked) it asks Firestore, which anyone may read. Default and `shadow`: Firestore answers |

### 3.5 Everything else in `assets/firebase.js` that touches Firestore or a Firebase function

The test `tests/remaining-firestore-reads.test.js` scans the file and lists each such function; a new one fails the test until it is classified there and here.

* **BEFORE** (moved behind the flags in earlier rounds, listed so nothing is forgotten): all `...FromFirebase` wrappers of the admin read screens, the staff writes, the member reads (`getMyWorkspaces`, `getMyEsStatus`, `getMyOrganizationAccess`, `getCohortStanding`, `getOrganizationConsole`), the question bank, admin mail (`runAdminActionFromFirebase`), the certificate (`issueVerifiedCredentialFromFirebase`, `repairMemberVerifiedCredentialFromFirebase`), checkout (`createCheckoutSession`), the readiness callables (`recordReadinessCompletion`, `checkReadinessAccountEmail`, `sendReadinessResultEmail`, `sendMyResultsEmail`).
* **OTHER SLICE**: the member progress, drafts, attempts, submissions, evidence, analytics, stability and TSA item save and read functions, the sign in stamp and the entry check (`getAuthorizedMember...`, `saveUserProfile`, `saveUserProgress`, `saveMemberRewards`, `saveMemberWorkspaceProgress`, `getMemberWorkspaceProgress`, `getExerciseWork`, `getExerciseAttempts`, `getMemberExerciseResponses...`, `getUserFeedbackEnabled`, and the `save...Firestore` helpers).
* **LEFT**: see section 4.

## 4. Intentionally left on Firestore or Firebase

1. **`setEmergencyCredential`** (the Emergency access tab). Retired by the owner (decision D4). The Supabase dashboard login is the emergency way in. Remove the tab when the console moves.
2. **`submitAccessRequest`**. A request access form write. No page calls it (the export is dead). Not moved; delete it at the close.
3. **The fallback code in the pages** (`admin/index.html` keeps its old `getDoc` calls for a page loaded before `firebase.js` has the new exports, the question bank keeps its Firestore path when no flag is set, `member-login/content-config.js` keeps the old `updateDoc`). They run only with every switch on `firebase`. They are not read in a Supabase session.
4. **The Firestore documents themselves, the Firestore rules and the old triggers.** They stay during the dual period (runbook section 8, item 4).
5. **Executive Signature quick check page** (`apps/executive-signature/index.html`): the globals `raCheckAccountEmail` and `raSendAccessLink` are exported to the window and no code calls them. The working path is `requestReadinessAccess` (flags `es_submit` and `auth`).

## 5. The database changes (written, not applied)

All five are additive in the sense of the earlier rounds: security definer, empty `search_path`, the staff check as the first statement (42501), execute for authenticated only (revoked from public and anon), no dynamic SQL, no backslash, `lock_timeout` of 3 seconds where a table changes, and a tested rollback in `supabase/rollbacks/`. Apply in order, after the usual independent review. They need migrations 2220, 2260 and 2310 first.

| File | Holds |
| --- | --- |
| `20261008002370_cohort_status.sql` | widens `cohorts_status_check` to `draft, planned, active, completed, archived, cancelled` and replaces `admin_mirror_cohort` (same signature, same body, one change: the status word is lower cased, `upcoming` becomes `planned`, `draft` and `cancelled` are kept) |
| `20261008002371_member_account.sql` | `get_my_account()`: the caller's own account record (read only, no argument) |
| `20261008002372_admin_progress_writes.sql` | `admin_replace_member_progress`, `admin_reset_member_progress`, `admin_repair_reward` (platform owner, with dry run, same pattern as 2260), two private helpers, and `admin_mirror_feedback_enabled` replaced so it also finds a Supabase-only person |
| `20261008002373_admin_member_exists.sql` | `admin_member_exists(p_email)`: is this address a member (platform owner only, read only) |
| `20261008002374_public_credential_revoked.sql` | `get_public_credential` also returns a revoked certificate. Same name, same ten columns, same grants (anon, authenticated and service role may execute, public may not; read from the live definition), only the status list changes. A revoked row exposes exactly what an issued row exposes; `revoked_at` and every private column stay out |

### The cohort status decision (3 options, and why the check was widened)

The page offers six words; the table held four, and the 2220 function turned anything else into `active`. Draft and cancelled were therefore lost on the way in, upcoming was lost too, and nothing could read them back.

* **Chosen: widen the existing check.** One column keeps one truth. I searched every migration, Edge Function and mirror file for a reader of `cohorts.status`: only `admin_cohort_details` and `admin_cohorts_summary` (they hand the word through, `planned` shown as `upcoming`) and `get_organization_console` (hands it through, which the Firebase console also does). Nothing filters on it, so nothing changes for a reader. The change is a drop and an add of a check on a table of a handful of rows; no existing row can violate the wider check; the 3 second lock timeout makes it fail fast. A read only catalog query on the live project confirmed the constraint is named `cohorts_status_check` and holds the four old words.
* Rejected: put the two lost words into `cohorts.notes`. The notes are free text that staff edit and sponsors may see.
* Rejected: a new text column. Two columns that must agree, and every reader would have to learn which to prefer.

Rollback: cohorts holding `draft` or `cancelled` are changed to `active` first (the old check cannot hold them), then the four word check and the 2220 function come back.

**Importer (done, applies only after 2370 is live):** `scripts/supabase-import-mapping.js` now maps the six words (`upcoming` becomes `planned`; an unknown word and a cohort made from a member value stay `active`). The old four word check refuses `draft` and `cancelled`, so run the import with this version only after migration 2370 is applied; a comment at the line says so. Until the migration is applied, keep using the version of the importer from before this change. The mapping test covers all six words.

### What the Student Progress functions do exactly

* **Replace** changes **only the activities the page names**. Firestore replaced the whole document, so anything the page did not send was dropped. Here an unnamed activity is left alone, so an edit made from a stale screen cannot wipe progress the administrator never saw. Names are an activity id or an activity key (the exercise app keys and `tsa-diagnostic-v2`); a name that matches nothing is counted in `unknownKeys` and ignored. Two names for one activity that disagree: completed wins. A completed activity gets status `completed` with a completion count of at least one; an unticked one goes to `not_started` and keeps its completion count as history; a visited exercise that is not completed becomes `visited` (an `in_progress` row is not downgraded). Rewards are not touched by an edit, exactly like the Firebase edit. The page's `rewards`, titles and `phases` are not sent at all.
* **Reset** sets every TSA progress row to `not_started` with a zero count, the streak and tokens to zero, and the points to zero. The answers (submissions, attempts, drafts) and the certificate stay, as they did in Firestore.
* **Repair** is `computeProgramCompletionAdjustment` line for line (credited points are the entries `program-completed:tsa-program` and `program-completion-adjustment:tsa-program:*`; missing is the largest of target minus credited, the Executive threshold minus the total, and zero; one entry is added once). Levels come from the call, else the rewards setting, else the five default levels.
* Replace and reset write `person_profiles.progress_revision` (the opaque text the site compares with its cached progress, `adminProgressRevision` in Firestore) with a prefix that says which tool ran: `admin-edit-<ms>-<random>` for an edit (which also clears `progress_reset_at`) and `admin-reset-<ms>-<random>` for a reset (which also sets `progress_reset_at`). The browser derives `adminProgressReset` from the `admin-reset-` prefix. The reward repair does **not** touch the revision. `get_my_account` returns both markers, so the member side can notice a reset; the member data layer has to read them (section 7).
* Each writes one audit row with counts and fixed words only (never an activity name, an address or a name).

## 6. What is different in Supabase (read this before relying on it)

1. **A reset cannot give the same points again.** The reward ledger is append only by design (a database trigger refuses update and delete). A reset therefore brings the points to zero with **one balancing entry** (the negative of the old total) and keeps the old entries. The old entry keys stay in the ledger, and each entry key can be used once, so after a reset a student who finishes the same video or exercise again **does not receive its points a second time**. Firestore forgot the earned events on a reset and did award them again. A test states this as a known limit. New milestones are awarded normally. If you want the Firestore behavior, the ledger needs a "voided" marker: that is a schema decision I did not make.
2. **Revoked certificates (fixed by migration 2374, not applied).** `get_public_credential` used to return only issued and replaced certificates, so a revoked one would have shown "Credential not found" instead of "Credential not active" once Firestore is closed. 2374 widens the status list by one word and nothing else. Until it is applied the page asks Firestore as a fallback, so nothing changes today.
3. **The support preview from Supabase has no saved answers.** `admin_member_support_snapshot` leaves out the student's saved answers on purpose; the page used them to fill the results screens of the preview. The progress, the points and the levels are shown; the individual results pages are empty. If you need them, the way is the audited `admin_reveal_response` path, not an unlogged read.
4. **Settings writes are read, merge, replace.** Two administrators saving the same setting at the same moment can overwrite each other (Firestore merged field by field on the server). One browser saves one setting at a time. With one or two administrators this is not a practical risk.
5. **A feature flag that is not in the `feature_flags` row reads as off in a Supabase-only session.** The import copies the `platformFeatureFlags` documents into that row only when they exist and only when the import runs.
6. **The settings of the importer.** A setting row that is still empty (`{}`) in Supabase is treated as "not there", so the getter asks Firestore (or uses the default). Run the catch up import before relying on Supabase settings.
7. **Finishing the program can issue a certificate.** `admin_replace_member_progress` that completes the last core activity of a student can fire the database trigger `credential_auto_issue` on `activity_progress` (migration 2320), exactly as a student's own last completion does. That trigger is **disabled** in the live database on purpose, because the Firebase trigger `autoIssueVerifiedCredential` and this one must never both run. The owner decides when to enable it (runbook step 6, "Also on the day"). While it is disabled, an administrator's edit issues no certificate; the staff certificate repair (`admin_issue_credential`) stays the way to issue one.

## 7. Owner steps and the order

1. Review and apply 2370, 2371, 2372, 2373, 2374 (each has an undo file). Nothing in the site depends on them until a switch is flipped.
2. Widen the importer cohort status list (section 5) after 2370 is applied.
3. `scripts/supabase-cutover-check.js` now probes the new functions: `get_my_account` among the member probes, `admin_member_exists` and the three Student Progress tools among the staff probes (each must be refused for a stranger), and a separate check that `get_public_credential` answers an anonymous caller with an empty list for a made up code. Expect WARN lines for the probes until the migrations are applied.
4. The runbook (`docs/SUPABASE_CUTOVER_RUNBOOK.md`) sections 8 item 3 and 9 have been updated to match what is now built.
5. Member data layer (the other builder): read `progressRevision` and `progressResetAt` from `get_my_account` (or `person_profiles`) into the workspace progress as `adminProgressRevision`, otherwise a reset by an administrator does not reach a student's cached device state.
6. Test with the **test member**, never the owner record: sign in with Supabase only, open the account page, change the goals, open the home page and a settings driven screen. As an administrator in a Supabase-only session open Student Progress, edit and reset the test member only.

## 8. Tests

All run under Node 22 and Node 20 (`npx -y node@20`). Nothing talks to a real service.

* `supabase/cohort-status-test.mjs` (41 checks), `supabase/member-account-test.mjs` (30), `supabase/admin-member-exists-test.mjs` (20), `supabase/admin-progress-writes-test.mjs` (125): the real migrations in a local database (PGlite), who may call (anon, a stranger, support, the person edited are all refused with 42501), the behavior, dry run writes nothing, audit rows carry counts only, the Firebase reward repair against the database on eight situations, the rollback and applying again.
* `supabase/function-audit-test.mjs`: the new functions are on the allowlist with the same checks as the other staff and member functions, the helpers are closed to browsers, and the three tools never update or delete ledger rows and never read answers.
* `tests/remaining-firestore-reads.test.js` (57): the default equals the baseline for 16 functions plus the near miss words; a Supabase-only session (no Firebase user) for every moved function with the Supabase token and no Firestore call; the flags with a Firebase session; the shadow lines; the public certificate page; the pages; and the scan that classifies every Firestore touch.
* `tests/supabase-site.test.js` (11): the new browser module with a fake network: the settings merge, the certificate document shape and comparison, retry on an expired token, error codes, no value in an error.
* `supabase/public-credential-revoked-test.mjs` (20): the revoked certificate, the same ten columns, the same grants, the rollback.
* Also covered in the review round: the revision prefixes (`admin-edit-`, `admin-reset-`, repair leaves it alone) in the progress test, the six cohort words in `tests/supabase-import-mapping.test.js`, the new probes in `tests/supabase-cutover-check.test.js`, the guarded import of `verify/index.html` and the administrator outage message of `admin/index.html` in `tests/remaining-firestore-reads.test.js`.
* Updated: `tests/supabase-admin-writes-adapter.test.js` (fourteen wrappers), `tests/supabase-switch.test.js` (the export list grew by five names), `tests/helpers/firebase-harness.js` (copies the new module).

## 9. Risks

* **Nothing has run against the real database.** The tests use a local copy with the real migrations. The first live check must be the test member.
* **The mixed state.** If `auth` is `supabase` but the reads and writes flags are not, the three admin answers stay with Firebase and fail for a Supabase-only administrator; the settings and the account page still work. The runbook already requires the flags to be set before `auth` moves.
* **Student Progress edit changes only what the page names.** That differs from Firestore on purpose (section 5) and is safer; it also means an administrator cannot "clear everything not shown" with an edit. Use reset for that.
* **Reset and points** (section 6, item 1).
* **The new browser module is fetched only when a Supabase path runs.** With every switch on `firebase` it is never requested.
