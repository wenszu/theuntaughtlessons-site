# The Untaught Lessons Website Context

Last updated: 2026-10-08

Single source of truth for agents working on this repo. Read before making changes, update after structural changes. Detailed historical entries and full page/app maps are in `archive/WEBSITE_CONTEXT_ARCHIVE.md`.

## How to use this file

1. `Working Rules` — how to behave in the repo
2. `Git and Deployment Rules` — how to commit and push
3. `Brand System` — colors, fonts, logos
4. `Firebase Member System` — auth and Firestore structure
5. `Quick Reference` — page and app file list
6. `Known Notes` — active limitations
7. `Current Implementation Notes` — architecture rules
8. `Change Log` — recent context only (last 3 days)

Related files: `context/brand.md` (brand/UI rules), `context/voice-editor.md` (writing voice), `context/claude.md` (Claude-specific reminders).
Operational email template: `FIREBASE_EMAIL_TEMPLATE.md`.
Historical Google Group setup/migration material: `archive/GOOGLE_GROUP_SETUP.md` and `archive/GOOGLE_GROUP_SYNC_MIGRATION.md`.
Assessment reference: `ASSESSMENTS_AND_GROCERY_REFERENCE.md`.
Cross-program customer/ES implementation source of truth: `docs/CUSTOMER_PROGRAM_PLATFORM_IMPLEMENTATION_PLAN.md`.
Cross-program execution status, phase gates, evidence, decisions, and risks: `docs/CUSTOMER_PROGRAM_PLATFORM_TRACKER.md`.
Phase 0 contract, matrices, TSA baseline, recommendations, and open approvals: `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_0.md`.
Phase 1 schema contract and verification evidence: `docs/CUSTOMER_PROGRAM_PLATFORM_SCHEMA_V1.md` and `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_1.md`.
Phase 2 identity/entitlement service evidence: `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_2.md`.
Phase 3 immutable Executive Signature persistence evidence: `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_3.md`.
Phase 4 local backfill/reconciliation tooling and production-gate evidence: `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_4.md`.
Phase 5 read-only Customers console evidence: `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_5.md`.
Phase 6 connected Executive Signature admin workspace evidence: `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_6.md`.

When working on Customers, Executive Signature persistence, cross-program identity, entitlements, the admin-console reorganization, or the member workspace switcher, read the implementation plan, tracker, completed phase evidence, and current schema contract before changing code. The tracker is the shared Codex/Claude Code handoff: update it whenever scope, status, evidence, risks, or gate decisions change. Do not begin a locked phase or treat code completion as a passed gate.

## Working rules

- Read this file first before any website change.
- Follow `context/brand.md` for brand and design.
- Follow `context/voice-editor.md` for prose edits.
- Keep changes minimal. No redesigns unless explicitly asked.
- Preserve the static browser architecture: plain HTML/CSS/JavaScript with no front-end framework or repository-wide bundling step. Node/npm are used inside Firebase Functions and CI tooling.
- Prefer existing patterns in `styles.css`, page-local CSS, `member-login/content-config.js`, and existing app files.
- Do not overwrite unrelated user changes.
- Do not remove legacy localStorage compatibility keys unless explicitly approved.
- Do not change practice app logic unless the task requires it.
- Check mobile layouts at 375px and 768px for meaningful UI changes.
- Update this file when pages, apps, data structures, auth behavior, deployment notes, or major design rules change.

## Git and deployment rules

- Do not commit or push unless the user asks (save / commit / push / upload to Git / publish branch).
- Run `git status --short --branch` first, inspect changed files, stage only relevant files.
- Do not stage `.DS_Store`, local debug files, or unrelated edits.
- Push to `origin` after committing. If branch has no upstream, push with tracking.
- Do not deploy to Firebase Hosting unless separately requested.
- Never use `git reset --hard` or `git checkout --` unless explicitly requested.

GitHub remote: `origin https://github.com/wenszu/theuntaughtlessons-site.git`

Local preview: `http://127.0.0.1:8061/`
Local server: `python3 -m http.server 8061 --bind 127.0.0.1`

## Architecture at a glance

- **Hosting:** The production browser artifact is static HTML/CSS/JavaScript deployed by `.github/workflows/deploy-pages.yml` to GitHub Pages. Firebase Hosting is configured for local emulation/manual fallback, not as the production origin.
- **Edge:** `theuntaughtlessons.com` is the `CNAME` and is proxied by Cloudflare. GitHub Pages does not apply the repository's `_headers` file, so it is not an enforced production-header policy.
- **Authentication:** Firebase Authentication supports email links, Google, Microsoft, and Facebook. A hidden emergency-password path exists only for eligible administrator accounts; localhost/emulator test accounts are separate from production access.
- **Database:** Cloud Firestore stores TSA membership/progress, organizations, rewards/credentials, and the additive customer/program/ES model. See `firestore.rules`, `firestore.indexes.json`, and the [schema contract](docs/CUSTOMER_PROGRAM_PLATFORM_SCHEMA_V1.md).
- **Functions:** `firebase.json` declares `group-sync`, `aiko`, and `admin-actions`, all on Node 20. Deployment is per exported function/codebase; source presence does not mean deployment. See the deployment inventory under Current implementation notes.
- **Email and sheet logging:** Public forms and administrative email actions use the Google Apps Script relay; `scripts/apps-script-email-actions.gs` is a repository reference, not an automatically deployed script.
- **AI scoring:** The `aiko` Functions codebase provides Gemini-backed HTTP scoring for selected practice experiences. Apps keep non-blocking/fallback behavior where documented.
- **Media:** Current lesson/exercise media is primarily Vimeo; some Google Drive/Docs embeds remain and are cross-origin.
- **CI:** GitHub Actions runs static tests, syntax/dependency/security checks, cache-version validation, and Pages deployment. See `.github/workflows/`.

## Planned platform work

- **Planning source:** “20261004 - Sales practice system design v1” is the product/architecture source for the next sales-practice system. It is external to this repository; add its stable link when available.
- **Open architecture decision:** Decide whether new practice-system data will live in Firestore or Postgres before implementation. Do not infer the database from the existing TSA/customer platform.

## Brand system

Fonts: `Playfair Display` (headings) · `Lato` (body) · `Roboto Mono` (labels/utility)

Colors: Navy `#003366` · Gold `#EEA320` · Cream `#F3EDE2` · Charcoal `#4A4A4A` · Steel `#4D7094` · White `#FFFFFF`

Logos: `assets/logo.png` (main) · `assets/utl-logo-nav-white.png` (app header white) · `assets/mark-readiness.svg` (readiness assessment pentagon mark, vector) · `assets/print-logo-{utl,readiness}-{navy,white}*.{png,svg}` (readiness assessment PDF-only lockups — the `-header.svg`/`-cover.svg` files are the ones actually referenced in print CSS, pre-sized because Chrome's print engine renders a margin-box `content:url()` image at its own native pixel size and ignores CSS width/height on the margin box; there is no official "executive readiness" logo elsewhere in the brand kit, this lockup was built from `mark-readiness.svg` + Lato text for this one app)

Favicon: `assets/favicon-bluebg-whitedoor-thicker-32.png` (the `?v=` value is automated — see cache-busting note under Current Implementation Notes; do not hand-set a specific version here)

Trademarks: `C³ Rubric™` · `Think, speak and act like an executive™` — use ™ on first use per public page/email, then omit on later shorthand references. The previous score brand is paused; use `Find your level`, `Diagnostic`, `Checkpoint`, or `Assessments` instead.

## Firebase member system

Firebase project: `the-untaught-lessons` · Shared client: `assets/firebase.js`

The Admin Console imports the shared Firebase client with an explicit version query. Update that version whenever the module's named exports change so a cached older module cannot prevent the admin authentication gate from starting.

Firestore collections:
- `authorized_members/{email}` — who can sign in with an approved email link or identity provider. Email keys are normalized lowercase.
- `users/{uid}` — per-user profile and progress. Fields: `email`, `displayName`, `role`, `lastSeenAt`, `workspaceProgress`, `feedbackEnabled`.
- `users/{uid}/completed_exercises/{exerciseId}` — per-exercise completion records. This is the authoritative source for exercise completion (credential issuance and the member's own cross-device recovery both trust it); `users/{uid}.workspaceProgress.exercises` is a denormalized copy Student Progress reads for speed and can lag behind it — see Known Notes.
- `settings/emailTemplates` — welcome email template. Read/written by `getEmailTemplates`/`saveEmailTemplate` in `assets/firebase.js`.
- `settings/feedback` — global `defaultFeedbackEnabled` boolean.
- `settings/publicSite` — public toggle settings (e.g. `findLevelVisible`).
- `settings/admin_visibility` — admin/owner preview-only visibility settings, including whether admins/owners can preview hidden public Find your level cards and bypass the public Find your level data form.
- `settings/cohorts` — **a flat document**: each cohort's detail record (organization assignment, lifecycle status, dates, contact info) is stored as a top-level field on this one document, keyed by cohort name — there is no nested `cohorts` wrapper field. `getCohortDetails`/`setCohortDetails`/`renameCohort` (`assets/firebase.js`) and `organizationDefinitions()` (`functions-admin/index.js`) must all read/write this exact same flat shape. A 2026-09-25 bug (see Change Log) came from the server side expecting a nested field that never existed — read this document's real shape from one of those functions, never assume.
- `organizations/{orgId}` — organization records (`name`, `status` active/archived, `contactName`, `contactEmail`, `weeklyReportOptIn`). `cohortIds` is computed, not stored — derived server-side from `settings/cohorts` entries whose `organizationId` points at this org.
- `organizations/{orgId}/members/{uid}` — representative access grants (`role`, `status`, `assignedCohortIds`).
- `organizations/{orgId}/access_audit` — admin-action audit log for the organization (grants, org create/rename/archive, roster-draft submit/approve/reject).
- `organizations/{orgId}/roster_drafts/{draftId}` — a representative's proposed roster for one cohort (`cohortId`, `rows: [{name, email}]`, `status` submitted/approved/rejected, submitter/reviewer fields). Approval never creates accounts or sends anything by itself — see the organization console foundation doc.
- `organizations/{orgId}/weekly_report_log/{isoWeekId}` — one doc per org per ISO week (e.g. `2026-W39`) recording a scheduled weekly-report send; also the send-idempotency guard so a retried scheduler invocation can't double-send.
- `google_group_sync_jobs/{jobId}` — legacy Google Group add/remove jobs retained for history. The Admin Console no longer creates these jobs because Google Workspace group automation is unavailable.

The additive cross-program domain includes `customers`, identity claims/links, `platform_staff`, `programs`, assessment definitions/versions, `enrollments`, `entitlements`, immutable assessment attempts/response parts, consent, duplicate review, audit/outbox/migration records, and aggregate projections. Phase 4 backfilled 55 canonical customers/TSA links in production without replacing TSA authority, and the composite indexes are deployed. The current repository rules and customer/ES callable code are not proven deployed; keep Phase 5/6 feature flags off until rules/functions receive a reviewed deployment. Exact status is in the tracker.

Phase 2 added the trusted service in `functions-admin/customer-program-service.js` plus callable boundaries in `functions-admin/index.js`. Identity resolution uses verified Auth UID first, then an exact normalized-email SHA-256 claim; conflicts enter `duplicateCandidates` rather than merging. Entitlement and email-change mutations are transactional, audited, and idempotent through client-inaccessible `serviceRequests`. These customer-program callables are present in source but absent from the deployed-functions inventory taken 2026-10-04.

Phase 3 added immutable Executive Signature persistence through `functions-admin/assessment-persistence-service.js` and the locked scoring registry `functions-admin/executive-signature-versions.js`. The assessment browser submits locked answers/order/timing/consent and the server result is authoritative. The current readiness/customer-program functions are not deployed, and the private readiness app is excluded from the Pages artifact.

Key `authorized_members` fields: `email`, `name`, `role` (member/admin/owner), `status`, `googleGroupAdded`, `googleGroupAddedAt`, `googleGroupAddedBy`, `googleGroupRemovedAt`, `googleGroupRemovedBy`, `feedbackEnabled`, `addedAt`, `updatedAt`.

Auth behavior:
- Supports passwordless email links plus Google, Microsoft, and Facebook sign-in for emails in `authorized_members`.
- Local test accounts `admin/password123` and `testuser/member2026` work only in the explicit localhost/emulator bypass and are not production credentials.
- Unauthorized Google accounts are signed out with an invite error (outside localhost/emulator).
- Legacy admin access uses `authorized_members` role `admin` or `owner`; cross-program operations additionally use `platform_staff` roles. `wenszu@gmail.com` is the hard-coded bootstrap owner in rules, admin UI, and admin callable checks.
- Emergency password sign-in is hidden behind `/member-login/?emergency=1` and can be set only for an existing active administrator/owner through the authenticated callable.
- `adminProfileData()` reads from `utl_member_profile` localStorage JSON, falls back to `utl_member_username` → `'admin'` for local test accounts.

Passwordless invites: Admin sends Firebase email-link invites from `admin/index.html`. Current `actionCodeSettings.url` points to `http://localhost:8061/member-login/` — update before production use.

Emulators (Auth: 9099, Firestore: 8085, Hosting: 5000): enable with `localStorage.setItem("utl_use_firebase_emulators", "true")` or `?emulators=true`.

Firestore rules pattern for settings: public pages can read `publicSite` and `public_assessments`; other settings require sign-in.

The repository still contains the optional `functions/processGoogleGroupSyncJob` implementation, but it is not deployed. It requires paid Google Workspace administration and domain-wide delegation. Member access does not depend on it.

## Quick reference — pages

| File | Purpose |
| --- | --- |
| `index.html` | Homepage with lead modal, testimonials, Find your level teaser |
| `about.html` | Founder story and credibility |
| `programs.html` | Program overview and CTA |
| `contact.html` | Contact form |
| `tsa-score.html` | Find your level routing page (public + member cards) |
| `member-login/index.html` | Member dashboard (phase cards, progress) |
| `member-login/orientation.html` | Orientation page |
| `member-login/phase-1.html` | Think Clearly watch + practice |
| `member-login/phase-2.html` | Speak Concisely watch + practice |
| `member-login/phase-3.html` | Act Confidently watch + practice |
| `member-login/account.html` | Signed-in account and program access summary |
| `member-login/organization.html` | Authorized organization-representative console |
| `member-login/phase-1/practice/index.html` | Deprecated route shell that redirects to Learning Journey |
| `member-login/content-config.js` | Workspace config, nav, shared styles, rendering |
| `member-login/admin.html` | Deprecated redirect to `admin/index.html` |
| `my-results/index.html` | Participant exercise record (no password gate) |
| `admin/index.html` | Admin panel — Content Manager, Student Progress, Rewards, Member Management, Engagement, Content Library, Preview &amp; Health |
| `programs/think-speak-act.html` | Detailed public TSA program page |
| `certificate/index.html` | Participant credential/certificate page |
| `verify/index.html` | Public credential verification page |
| `portal/` | Legacy workbook portal and workbook pages |
| `tools.html` and `tools/` | Public tools index and standalone education tools |

## Quick reference — apps

| File | Phase | Purpose |
| --- | --- | --- |
| `apps/find-your-level/` | Public | Lead gate + random/fixed Sort & Bucket exercise using `data/sort-bucket.json` |
| `apps/grocery-list/` | Phase 1 | Sort messy grocery list into MECE buckets |
| `apps/grocery-list-ai/` | Phase 1 | AI-assisted grocery list structuring |
| `apps/messy-notes/` | Phase 1 | Turn manager notes into structured response |
| `apps/rushed-voice-memo/` | Phase 1 | Structure a rushed verbal update |
| `apps/rushed-voice-memo-ai/` | Phase 1 | Transcribe voice then structure with AI |
| `apps/chalkboard-notes/` | Phase 1 | Organise chalkboard image notes into MECE; exercise media lives in `apps/chalkboard-notes/assets/` |
| `apps/issue-tree-builder/` | Phase 2 | Build issue tree from question + arguments |
| `apps/scqa-builder/` | Phase 2 | Write and review one SCQA, with optional scenario practice |
| `apps/advisory-board/` | Phase 2 | Virtual advisory board builder (CSS: `ab-`) |
| `apps/write-to-aiko/` | Phase 2 | Answer-first email exercise (CSS: `write-to-aiko-`) |
| `apps/explain-to-aiko/` | Phase 2 | Primary 120s in-browser recording, transcription, measured delivery, and Gemini scoring exercise |
| `apps/explain-to-aiko-60/` | Phase 2 | Primary 60s recording/scoring exercise with 120s prep and prior-transcript compression comparison |
| `apps/toolkit/` | Cross-program | AI prompt toolkit reference (CSS: `tk-`) |
| `apps/eisenhower-matrix/` | Phase 3 | Guided five-round prioritization and written-no exercise (member-facing v1) |
| `apps/i-have-bad-news/` | Phase 3 | Difficult conversations practice. Learners copy a generated prompt into their own ChatGPT or Gemini (no CustomGPT). Old CustomGPT version archived at `archive/i-have-bad-news-customgpt-2026-10-05.html`. |
| `apps/lets-switch-hats/` | Phase 3 | Perspective-taking launch page |
| `apps/speak-like-obama/` | Phase 3 | Speech delivery launch page |
| `apps/tsa-diagnostic/` | Assessment | The sole TSA assessment — Think/Speak/Act in one saved flow. `?assessment=checkpoint` serves the post-program Checkpoint from the same file |
| `apps/executive-signature/` | Live ES program (renamed from `apps/readiness-assessment/` 2026-10-06) | Executive Signature Quick Check and Full Assessment plus admin, build-plan, how-it-works, research, and returning-results pages. Public on the production site as of 2026-10-06; its callable persistence code has been deployed since earlier this week. Read `README-assessment.md` and `BUILD_STATUS.md` before editing. |

Data files: `data/sort-bucket.json` (public concept-scored Find your level exercises), `data/tsa-score-bands.js` (public score bands/scoring helpers), `data/practice/*.json` (member practice), and `data/testimonials.json`. The unified member assessment embeds its current question/scoring data in `apps/tsa-diagnostic/index.html`; removed `data/tsa/` files survive only in history/archive references.

Apps Script endpoint (all POST submissions): `https://script.google.com/macros/s/AKfycbzJE--FL2kB_XDNZRnszCtlyLRPvaLAHGuF5TAOdXJk40atbvf5Y6ELuSK2B7CSLaMN/exec`

Apps Script `action` routing: `WelcomeEmail`, `TestEmailTemplate`, `ResultsEmail`, `RemovedMember`, `AddGoogleGroupMember`, `RemoveGoogleGroupMember`, `WeeklyOrgReport` (added 2026-09-25 for scheduled organization reports — confirm this dispatch line has actually been pasted into the live script before relying on it; `scripts/apps-script-email-actions.gs` is a reference file Claude cannot push directly). Default = lead/sheet logging, guarded by `shouldRejectContactSubmission_()` against direct bot POSTs (added 2026-09-23).

## Assessment documentation

Current TSA assessment behavior is governed by `apps/tsa-diagnostic/index.html`, its tests, and current data files. The older TSA Score/C³ exercise-bank documents were moved to `archive/` on 2026-10-04 because they describe the removed v1 multi-app assessment. `ASSESSMENTS_AND_GROCERY_REFERENCE.md` retains current public Find your level/grocery material and labels its retired member-assessment sections as history.

### Historical TSA assessment references

- `archive/UTL_TSA_scoring_framework.md` — retired v1 scoring framework.
- `archive/UTL_assessment_exercises.md` — retired v1 exercise register.

### Handoff rule
Decisions are made in Claude (claude.ai). JSON updates are handled in Codex. Documentation updates to both .md files are handled in Claude Code. WEBSITE_CONTEXT.md is the entry point that routes to the right file for the task.

## Known notes

- **Exercise completion has two records that can drift apart.** `users/{uid}/completed_exercises/{exerciseId}` is authoritative (credential issuance and the member's own cross-device recovery both trust it); `users/{uid}.workspaceProgress.exercises` is a denormalized copy that Student Progress's table reads directly. A Firestore trigger (`autoIssueVerifiedCredential`, `functions-admin/index.js`) keeps the second in sync with the first going forward, but only for writes made after that trigger existed. If a learner insists an exercise is done but Student Progress shows it incomplete, open that learner's Student Progress detail and click **"Repair exercise sync"** (`repairMemberExerciseProgress` callable) — it re-syncs `workspaceProgress.exercises` from their real `completed_exercises` record and reports how many it fixed. If it reports nothing needed repair, the exercise genuinely isn't recorded server-side at all (a different problem — check whether the learner's submission actually saved, e.g. an offline/local sync-queue failure) rather than a display bug.
- **Functions deployment inventory (verified 2026-10-04):** Firebase lists 18 active Gen 2 Node 20 functions. Deployed admin exports are `autoIssueVerifiedCredential`, `checkOrganizationRepEmail`, `getCohortStanding`, `getMemberCredentialRegistry`, `getMyOrganizationAccess`, `getOrganizationAccessAdmin`, `getOrganizationConsole`, `issueVerifiedCredential`, `manageVerifiedCredential`, `repairMemberExerciseProgress`, `repairMemberVerifiedCredential`, `runAdminAction`, `saveOrganizationAccessMember`, `saveOrganizationDefinition`, `searchVerifiedCredentials`, and `setEmergencyCredential`; deployed Aiko exports are `scoreExplainToAiko` and `scoreScqa`. The group-sync worker, other Aiko endpoints, roster-draft callables, weekly scheduler, readiness/customer-program/ES callables, and other current source exports are not deployed. Re-run `firebase functions:list` before relying on deployment state after a later release.
- Member workspace video/context management is browser-local (localStorage). Admin content changes do not publish to other visitors unless defaults in `content-config.js` are updated in code.
- Google Sheet admin changes are pending Google Drive connector reconnection: rename sheet `10iQByFqVCffHanZbbHLnYj7Csbet4fgOCd2FWDzEqkE`, add `Assessments` tab, add `source` column to contacts tab.
- Legacy Google Group fields in `authorized_members` are preserved but are no longer shown or changed by the Admin Console.
- New individual and bulk member onboarding no longer requests Google Group access. Welcome emails use a three-step path covering sign-in, orientation, and Phase 1.
- Deprecated phase-introduction videos have been removed. Hugh's voice memo is hosted on Vimeo, so active course media no longer depends on Google Drive or Google Groups.
- Embedded Google Drive videos/slides cannot expose their permission error state to site JavaScript because the iframe is cross-origin. The workspace instead shows a reusable "Video not opening?" access guide under protected embeds without exposing the internal Google Group address.
- Firebase Auth sign-in-link email copy is controlled in Firebase Console Authentication Templates. Use `FIREBASE_EMAIL_TEMPLATE.md` for the approved template copy.
- Passwordless invite `actionCodeSettings.url` uses the current site origin and `/member-login/`.
- `adminProfileData().email` returns `'admin'` when using local test accounts (not a real email). Any email validation must check for `@` before using as a recipient.
- Admin Console member-management writes require an active Firebase Google session whose `authorized_members/{email}.role` is `admin` or `owner`; the UI preflights this before add/edit/remove actions.
- If Member Management is opened while signed into the wrong Firebase Google account, the Admin Console prompts to switch accounts instead of leaving the table stuck on an authorization error.
- Bootstrap owner: `wenszu@gmail.com` is treated as an owner in both `firestore.rules` and the Admin Console even if its `authorized_members` row is missing or accidentally edited. The Admin Console hides edit/remove actions for this row, and Firestore rules block client-side delete/downgrade except by the bootstrap owner account itself.
- When `wenszu@gmail.com` opens an admin-only Firebase view, Admin Console tries to repair `authorized_members/wenszu@gmail.com` back to `role: owner`, `status: active`, `bootstrapOwner: true`. This repair requires the bootstrap-owner Firestore rule to be deployed first.
- Admin Console Member Management authorizes members in Firestore and sends onboarding email without creating Google Group jobs. Group controls are hidden while Workspace automation is unavailable.
- Admin Console remove-member flow sends a non-blocking Apps Script `RemovedMember` audit action for non-admin/non-owner members before deleting Firestore records. The Apps Script writes to the `Removed members` tab in the same Google Sheet as leads/feedback and skips admin/owner roles.
- Student Progress uses the same Firebase admin preflight/switch-account flow as Member Management. If `authorized_members` is readable but `users` progress documents are blocked by Firestore rules, it renders the member list with a rules warning instead of failing the whole table.
- Student Progress detail lets admins update individual lesson, exercise, orientation, and assessment completion states without rewriting the MP ledger. Its separately confirmed reset clears remote activity records, responses, rewards, level progress, and streaks while preserving membership access. An admin revision marker makes the student's member workspace apply the change authoritatively on its next load, including clearing stale browser progress after a full reset.
- Student Progress also provides a browser-only Experience Preview. Admins choose the activity immediately before which the walkthrough should begin; the tool backs up current local learning state, prepares prerequisite completions, pauses Firebase progress/reward writes, and opens the real member or exercise page. A persistent preview banner restores the prior browser state when the walkthrough ends.
- Admin Console IA: `Program > Visibility & access` contains only centrally stored live controls. Browser-only member cards and release-gate testing live under `Preview & Health > Member preview settings`. Program phase pages are read-only published-content inventories rather than browser-local content editors. `Preview & Health` also owns assessment QA links and health checks. `Communications` owns working nudges, email templates, certificates, and feedback defaults.
- Admin Console binary settings use right-aligned checkbox controls. Keep multi-state controls such as `Show / Coming soon / Hide` as segmented controls because they are not true yes/no settings.
- Admin Console `Program > Visibility & access > Admins and owners` controls admin/owner-only assessment preview behavior. `Preview public cards when hidden` writes `settings/admin_visibility.publicFindLevelPreview` and mirrors to localStorage key `utl_find_level_admin_public_preview`; `Skip the public data form` writes `settings/admin_visibility.findLevelLeadGateBypass` and mirrors to localStorage key `utl_find_level_admin_bypass`; public visitors are not affected.
- Admin Console `Find your level page` card visibility writes `settings/public_assessments` and mirrors to localStorage keys `utl_public_assessment_diagnostic_visible` / `utl_public_assessment_checkpoint_visible` for localhost preview. Live public reads require deployed Firestore rules that allow public read of `settings/public_assessments`.
- Admin Console `Visibility & access > Public visitors` also controls public Find your level exercise rotation through `settings/public_assessments.findLevelExerciseMode` (`random` or `fixed`) and `settings/public_assessments.findLevelExerciseId`; localhost mirrors use `utl_find_level_exercise_mode` and `utl_find_level_exercise_id`.
- Lesson video URLs are sourced from `member-login/content-config.js`. Program phase pages show the published URLs with Open and Copy actions. They do not offer browser-local editing; permanent video link changes update `member-login/content-config.js` and ship with a site release.
- `no-cors` mode on Apps Script fetches returns opaque responses — server-side failures are invisible to the client. Always validate inputs client-side.
- Email templates are stored in Firestore `settings/emailTemplates`. `loadEmailTemplates` in `admin/index.html` always falls back to defaults if Firestore fails, then calls `syncEmailTemplateForm` and `initEmailTemplateListeners` regardless.

## Current implementation notes

- The production web front end is static HTML/CSS/JavaScript on GitHub Pages, with no front-end framework or bundle step. It is not backend-free: Firebase Auth/Firestore, three Node/npm Firebase Functions codebases, Google Apps Script, and Gemini-backed scoring support server-side workflows. Node/npm are also used by CI and repository scripts.
- The member home now treats `Learning Journey` as the canonical course map. It uses compact Phase 1/2/3 tabs, numbered activities (`1.1`, `1.2`, etc.), distinct video/exercise treatments, completion/next/locked states, one “Continue where you left off” action, and an activity-preview drawer. Legacy phase pages remain available as route shells but should not be used as the primary navigation destination.
- Lesson links from the Learning Journey open a focused player through `focusedLessonPrototypeHtml()` in `member-login/content-config.js`. The focused view keeps only course position, the video, completion action, troubleshooting, and a sticky-header return to the selected Learning Journey phase. Do not restore the old phase overview/progress/how-to-use content around an individual lesson.
- Phase 5 retires the duplicate phase overview pages as destinations. Bare `phase-1.html`, `phase-2.html`, `phase-3.html`, and Phase 1 practice routes return to the matching Learning Journey tab; `?lesson={lessonId}` remains the supported focused-video deep link. If a lesson ID is opened under the wrong phase URL, the route repairs itself to the lesson’s owning phase. Existing bookmarks therefore continue to work without maintaining two course homes.
- Exercises with context media use the shared setup-first controller in `assets/exercise-context-flow.js`, loaded by `assets/app-reward-header.js`. Journey exercise links add `?setup=1`; step 1 reviews the configured video/slides and step 2 opens the existing exercise. Context completion writes `utl_context_complete_{exerciseId}` and awards the idempotent `context:{exerciseId}` event for 5 MP. Completed exercises expose `Review setup`; Manager’s messy notes keeps its native equivalent two-tab flow.
- Exercise sticky headers return to `member-login/index.html?phase=phaseN#learning-journey`. The shared header normalizer repairs older Phase-page links at runtime. In timed exercises, the intended right-side order is Daily mission → Level/MP → optional word count → one compact 42px outlined unit containing elapsed time, start/pause, and reset. `assets/app-reward-header.js` normalizes the existing timer variants into this pattern and collapses the header deliberately at laptop, tablet, and phone widths.
- Explain to Aiko's canonical 120-second and 60-second apps provide in-browser recording and transcription in supported browsers, a clearly labeled paste fallback where recording is unavailable, measured duration/WPM/fillers, and a six-criterion Gemini review through `scoreExplainToAiko`. AI failure never blocks saving or completion. These are permanent member experiences; the older self-recorded/Playback implementations and routing switches have been removed.
- The art of saying no permanently uses the guided five-round experience at `apps/eisenhower-matrix/`. It includes per-round progress, retry queues, keyboard shortcuts, exercise points, explanations for ambiguous calls, and a 50-word written-no round. The older free-form matrix implementation and routing switch have been removed.
- Member dashboard `Today’s Mission` planning screen is generated from the learner's next unfinished lesson videos and exercises. It opens automatically on the first Learning Journey visit each local calendar day when no mission has been selected and it has not already been dismissed that day; the sticky-nav control and `?open=planner` can reopen it at any time. Choices display their actual bundled estimate; streak appears in the welcome summary only when non-zero. An optional 10-minute challenge can be added and uses a saved pre-challenge intention plus post-challenge reflection before completion. The saved plan is tracked in the sticky nav as `Daily mission: n / n` (or `Daily mission: ✓`) with activity-completion nudges; mobile hides the text label and retains the compact count. Local keys: `utl_daily_mission_target`, `utl_daily_mission_plan`, `utl_daily_mission_dismissed`; visibility key: `utl_daily_welcome_card`. Admin preview: `member-login/index.html?mode=admin&preview=welcome#todays-mission`.
- `assets/app-reward-header.js` also renders `Daily mission` beside the reward cluster across all reward-enabled practice and assessment app headers. Before selection it shows `Daily mission: Set`; after selection it shows saved progress. Hover, focus, or click exposes a compact anchored breakdown like the MP popover. At narrower widths, the mission pill collapses to `Set`, its count, or a check.
- The MP reward popover calculates actual MP earned by ledger category, sorts categories by earned total, and shows current-level guidance. Daily/streak progress is intentionally omitted because the adjacent Daily mission control owns that information. Promotion guidance uses direct copy such as `You need 174 more MP to become an Associate!` rather than threshold-system language.
- Full curriculum completion now awards a stable, one-time `program-completed:tsa-program` bonus (recommended default: 200 MP). The deterministic curriculum plus both assessments totals 1,785 MP before this bonus; the recommended completion path therefore reaches 1,985 MP and makes the 1,800 MP Executive threshold challenging but attainable without streak farming. Existing fully completed students receive the bonus through reward backfill, plus an idempotent milestone adjustment when needed to reach Executive. Admin exposes the value, policy explanation, and simulator event in the Rewards tab.
- First-time completion of each of the 16 reward-enabled exercises opens a two-stage reward moment: a celebratory MP award card followed by a tailored key-learning reflection. Completion-only and reflection exercises show it once; scored exercises show it on the first score only, while later score improvements keep the lightweight toast. Saved reflection choices and optional notes attach to the exercise reward ledger metadata as `completionReflection` and sync with reward state. After reflection (and a level-up modal when earned), the learner returns to the matching Learning Journey phase rather than opening another exercise directly. The completed activity is briefly highlighted there, while the newly unlocked row remains marked `Up next`; phase/program milestones are then handled once on the journey.
- Admin can manage this experience under `Rewards > Award preview`: select any of the 16 exercises, edit its reflection question and three responses, preview the real two-stage learner modal using unsaved draft wording, restore the recommended copy, or save overrides to `settings/rewards.exerciseReflections` in Firebase. The older calculation form and duplicate MP summary are removed, while a compact bottom preview retains immediate buttons for MP count-up, reward toast, streak toast, level-up, and exercise award examples.
- Hovering or focusing the sticky-nav level renders a five-step Intern → Analyst → Associate → Principal → Executive progression. Completed/current/upcoming states are visually distinct, the current level is highlighted, and the next-promotion requirement appears below the track.
- Pure external/AI hand-off exercises (`i-have-bad-news`, `lets-switch-hats`, and `speak-like-obama`) use a simple `Mark exercise complete · +30 MP` action. Each writes both its legacy and canonical completion keys and awards the one-time `reflection-exercise` reward through `assets/reward-events.js`; `tests/external-link-rewards.test.js` guards this contract.

### Learning experience ownership (Phase 6 handoff)

- `member-login/content-config.js` owns the Learning Journey UI, focused lesson rendering, progress/locking logic, canonical phase routing, orientation flow, and the content metadata used by Admin preview. Change the course sequence here rather than recreating it in a phase page.
- `assets/exercise-context-flow.js` owns the shared two-step exercise setup gate. Individual apps should keep their exercise logic and declare compatible context metadata; they should not build a second setup overlay.
- `assets/app-reward-header.js` owns shared exercise-header normalization, Daily Mission/MP mounting, responsive timer grouping, and legacy “Back to Phase” link repair.
- `assets/reward-events.js` owns idempotent MP ledger events. `assets/reward-ui.js` owns count-up, toast, exercise-reflection, and promotion presentation. Exercise completion returns through these files to the Learning Journey.
- `my-results/index.html` is a standalone results reader. Its lesson links must use `?lesson={id}`. Diagnostic and checkpoint each read their own independent result key (`utl_result_tsa_diagnostic_v2` / `utl_result_tsa_checkpoint_v2`) via `tsaResultFor(kind)`, so the Assessments accordion shows a true before/after comparison — retaking one never overwrites the other (fixed 2026-08-11, see Change Log).
- `member-login/phase-1/practice/index.html` is deprecated. `renderPhasePracticePage` always redirects to the Learning Journey now — nothing live linked to it (the Learning Journey routes straight to each exercise's app; the admin Experience Preview also opens exercise apps directly, never this page). Its render helpers (`phaseOnePracticeHeader`, `phaseOnePracticeCards`, `singlePracticeCard`, `contextOnlyPracticeCard`, `practiceCardStatus`, `practiceCardCheck`, `practiceOpenState`, `stepTabs`) and the dead `phaseDropdownHtml` nav helper were removed. Some of their CSS (`.ws-practice-card`, `.ws-practice-reminder`, `.ws-step-tab*`, `.ws-bottom-nav`, etc.) remains as inert dead weight — left alone because several of those selectors are compounded with still-live classes (e.g. `.ws-context-toggle`), and untangling them risked more than the cleanup was worth.
- `admin/index.html` Experience Preview prepares local prerequisite state but opens the same lesson/exercise routes a student uses. Do not restore a separate admin-only lesson path.
- Cache-busting `?v=...` query strings use one shared release value. Do not hand-edit individual `?v=` values. Production is deployed by `.github/workflows/deploy-pages.yml`: it rewrites the checked-out build artifact to the source commit SHA, verifies that all references match, runs the full suite, excludes private/development directories, and deploys one atomic GitHub Pages artifact. It does not modify the repository or create a second deployment commit. `scripts/sync-cache-versions.js --check` remains the local and pull-request consistency check. The custom domain is proxied by Cloudflare, but the origin is GitHub Pages; `_headers` is therefore not relied upon for production cache behavior. Tests that assert cache-busting use a pattern such as `/content-config\.js\?v=[\w-]+/` rather than a literal release value.
- Visual invariants still apply after the consolidation pass: natural-case Lato/Playfair interface typography, no decorative monospace labels, no standalone card shadows, navy/gold/cream brand colors, and 44px touch targets for timed controls on tablet/mobile.
- The mission nav popover includes explicit Set, Change, and Continue actions. An active mission can be changed while it is still at 0 completed activities. After the first completion, the plan is kept stable to preserve the learner's commitment and progress history.
- All 12 core lesson videos have exact display durations in `member-login/content-config.js`. Exercises use `estimatedMinutes` for mission planning; these planning estimates reconcile to the public phase exercise totals (100/90/80 minutes) and remain separate from an app's active timer or recording-length target. Orientation, phase-intro, and exercise-context media still need exact durations before they can be included in mission calculations.
- Prefer editing existing HTML, CSS, and JavaScript directly.
- Do not modify existing practice app logic unless the task requires it.
- Keep new visual work aligned with the brand system.
- App header pattern: navy sticky, white logo (links homepage), gold Roboto Mono phase label, white Playfair Display title, timer + controls right.
- Navigation active state: `class="nav-link-active" aria-current="page"` → gold underline.
- Mobile layouts: check at 375px and 768px for meaningful UI changes.
- Logo clicks in app headers link back to the homepage.

## Change Log

Entries older than ~3 days live in `archive/WEBSITE_CONTEXT_ARCHIVE.md` (most recent archived block: 2026-10-03 through 2026-10-04).

### 2026-10-08 — `i-have-bad-news` rebuilt around the learner's own ChatGPT or Gemini; timers removed from hand-off exercises

Mock-up source of truth: `reference/mockups/i-have-bad-news-mockup.html` (published copy https://claude.ai/artifact/AKTaEF9a7tkbpuKR8CchwF). The live page is `apps/i-have-bad-news/index.html`. The previous CustomGPT version is archived unchanged at `archive/i-have-bad-news-customgpt-2026-10-05.html` (copied from git `HEAD`, so its relative asset paths do not resolve from `archive/`) and also remains in git history.

- **Page:** three open steps, no locked cards, real `bad-news-header`. Step 1: setup in a plus/minus `<details>` (open by default) with `Recommended` pre-selected (Alex, Medium, Work, first situation), optional `What should they call you?` (prefilled from `utl_member_profile.displayName`), names Alex, Elon, Priya, Marcus or typed, Easy/Medium/Hard, four settings plus `Surprise me`. Step 2: (a) shared `UTLFeedbackCoach.mountPreparedPrompt` strip and dialog, (b) `Read first` voice instructions dialog (four steps, page local `bn-voice-*`, `utl_bad_news_voice_read`), (c) `Open ChatGPT` (two thirds width, `Recommended`) and `Open Gemini` (one third, `Voice on phone only`), both also copy the prompt. Step 3: transcript request strip, paste box, `+10 MP` bonus, and the unchanged `Mark exercise complete · +30 MP` contract plus the explicit cloud completion record now used by the other external exercises.
- **Situations:** every card names both roles in the second person with the other person's name filled in; each is a pair in `CATEGORIES` (card text, first person prompt text). `I need to tell them they have bad breath` (shown as `You have to tell {name} that they have bad breath.`) is the required first Personal situation.
- **Prompt:** reduced version of the Sam GPT instructions (Drive `02-difficult-conversations-sam-gpt.md`): role play plus Coach, difficulty one-liners, short turns, `HOW IT ENDS` (`Coach, hint`; automatic ask after about eight turns, again after four more; `Coach, debrief now` any time), a briefing before the role play starts that ends with a bracketed voice note, the learner's name used by the other person and once in the debrief, and the debrief format (3 went well, 3 even better, each quoting the learner). Hard mode realism, interruption rules, scenario bank and security rules were left out on purpose.
- **Personalization hook (built now, for later):** step 1 has a `Make the practice fit you` block that tells the learner that details about them can be added to the prompt (today only the first name; later non-sensitive working style details such as Executive Signature findings), that they review everything before copying, and that nothing is sent automatically. A checkbox (`Use my details to personalize the practice`, on by default) turns it off, and a line shows what is included. In code, `profileHints()` reads `window.UTLLearnerProfile.practiceHints()` (an array of up to six short plain sentences) and adds an `ABOUT ME` section to the prompt (`Note 1:`, `Note 2:`, and so on, with an instruction to use them quietly and never mention them). Nothing provides hints yet. When Executive Signature data is ready, supply that function and keep the notes non-identifying (no scores, email or full name), as `speak-like-obama` does with its behavior label.
- **Voice facts:** ChatGPT hides its voice button until the cursor is in the message box. Gemini Live is in the phone app; the computer microphone is dictation only.
- **Bonus event:** `awardEvent` with eventId `transcript-shared:i-have-bad-news`, type `transcript-shared`, 10 MP, once (`utl_bad_news_transcript_done`). Pasted text is not stored. Not yet confirmed: the remote ledger and the admin Rewards views accept this type, and whether 10 MP belongs in reward settings.
- **Learning Journey:** `p3-e2` shows `ChatGPT, Gemini`; `lets-switch-hats` still shows `CustomGPT`.
- **Timers removed** from `i-have-bad-news` and `lets-switch-hats` (hand-off exercises where the timer ran while the learner was in another tab). `assets/app-reward-header.js` hides the frozen mobile `00:00` chip when a page has no timer. `speak-like-obama` and the in-app writing exercises keep theirs.
- **Executive Signature nav fix:** `Try Executive Signature` never hid because `.ws-es-nav-wrap{display:inline-flex}` overrode the `hidden` attribute. Added `.ws-es-nav-wrap[hidden]{display:none}` and the divider is hidden too. Rule: any element with a `display` rule needs its own `[hidden]` rule.
- **Tests:** `tests/custom-gpt-voice-guidance.test.js` updated (no voice guide expected on this page; asserts no `chatgpt.com/g/` link). Local server: `python3 -m http.server 8061 --bind 127.0.0.1` from the repo root.
- **Scenario panel (simulated, not user research):** keep deadline, lend money, price, feature, volunteer, rule change; rewrite raise, role change, budget cut, family event, delivery, contract, event cancelled, application; replace `cancel a trip` and `end a friendship`; suggested additions (former peer now reports to me, leadership rejected our plan, tell my senior their plan has a flaw, my mistake affects their work, my team promised something we cannot deliver). Open owner decisions: relationship choice for bad breath (default friend), exclude heavy items from `Surprise me`, cap Hard on personal items, a fifth `Managing people` setting, Southeast Asian names, whether to keep `Elon`, warning against real colleague names. None applied yet.
- **Not yet verified in a browser:** mobile width, and a signed-in run through the real page (no test sign-in was used, per the no tester runs on the owner account rule).

### 2026-10-05 — First push to `main` in nine days: the customer-program-platform work is now live

- Committed and pushed everything that had accumulated in the working tree since the last commit (2026-09-26): the full Phases 0–9 customer-program-platform build, the Executive Signature private-preview app and its report-design assets, and assorted documentation-accuracy fixes. 119 files, two commits (`b01feb8`, `8d36e01`).
- Before pushing: reviewed every file for secrets (found none beyond the standard public Firebase client `apiKey`, already live) and confirmed `reference/`, `visual/`, and `apps/readiness-assessment/` all stay excluded from the deployed artifact.
- Found and fixed two real, previously undetected typography-rule violations in `admin/index.html` (uppercase/letter-spaced Customers-table headers from Phase 5, and the original decorative `.ra-data-rule` border) that were blocking the CI test gate.
- Found that CI had actually been broken for nine days: the prior commit (`5113be2`, 2026-09-26) introduced `tests/select-controls.test.js` with a cache-busting version string hardcoded as a literal, which the deploy workflow's own SHA-based rewrite step invalidates on every single push. Nobody had pushed since, so nobody had noticed the live site was already one commit behind what `git log` suggested. Fixed the test to check version consistency instead (matching how `tests/deployment-cache.test.js` already handles this), and verified the fix for real by running the actual CI rewrite sequence locally before reverting the simulation.
- First push's deploy still failed on the newly-found issue; the second push succeeded completely. Verified independently, not just via the green checkmark: fetched the live site directly and confirmed `assets/firebase.js` now serves the new `getMyWorkspaces` function, and that `apps/readiness-assessment/index.html` correctly returns 404 (its exclusion works in production, not just in config).
- A separate, unrelated "Security checks" workflow (runs on a daily schedule, doesn't gate deployment) has been failing since 2026-10-01 due to newly-disclosed CVEs in transitive Firebase SDK dependencies across all three Functions codebases — pre-existing, unrelated to this push, flagged as a follow-up candidate.
- Full detail in `docs/CUSTOMER_PROGRAM_PLATFORM_TRACKER.md`'s decision log.

