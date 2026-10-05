# The Untaught Lessons Website Context

Last updated: 2026-10-04

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
| `apps/i-have-bad-news/` | Phase 3 | Difficult conversations launch page |
| `apps/lets-switch-hats/` | Phase 3 | Perspective-taking launch page |
| `apps/speak-like-obama/` | Phase 3 | Speech delivery launch page |
| `apps/tsa-diagnostic/` | Assessment | The sole TSA assessment — Think/Speak/Act in one saved flow. `?assessment=checkpoint` serves the post-program Checkpoint from the same file |
| `apps/readiness-assessment/` | Private ES preview | Executive Signature Quick Check and Full Assessment plus admin, build-plan, how-it-works, research, and returning-results pages. The whole directory is excluded from the production Pages artifact; its current callable persistence code is not deployed. Read `README-assessment.md` and `BUILD_STATUS.md` before editing. |

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
- Pure external/CustomGPT exercises (`i-have-bad-news`, `lets-switch-hats`, and `speak-like-obama`) use a simple `Mark exercise complete · +30 MP` action. Each writes both its legacy and canonical completion keys and awards the one-time `reflection-exercise` reward through `assets/reward-events.js`; `tests/external-link-rewards.test.js` guards this contract.

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

Entries older than ~3 days live in `archive/WEBSITE_CONTEXT_ARCHIVE.md` (most recent archived block: 2026-09-23 through 2026-09-28).

### 2026-10-04 — Full Phases 7–11 plan written; decision-free work kicked off and verified across four parallel streams

- Wrote `docs/CUSTOMER_PROGRAM_PLATFORM_PHASES_7_TO_11_PLAN.md`: every remaining phase of the customer-program platform broken into decision-free engineering work versus owner decisions, in dependency order, with a coordination log so parallel work streams don't collide.
- Ran four background agents in parallel, each scoped to its own non-overlapping new files, then independently re-verified every one of them afterward (re-ran their tests myself, spot-checked specific factual claims against the real code, confirmed via file-modification timestamps that none touched another stream's files):
  - **Phase 8** (TSA shadow verification): a read-only tool comparing the legacy `authorized_members`/`users`/`settings/cohorts` sources against the Phase 4 `customers`/`enrollments` projection, in both directions. Found a real gap worth tracking: Phase 4's migration hardcoded `organizationId: null` on every enrollment, so org/cohort consistency can't be fully verified from that field yet.
  - **Phase 9** (admin route matrix): expanded the Phase 0 admin-navigation table to ~140 individual actions/dialogs/exports. Surfaced two previously-unnoticed issues, both confirmed directly against the code: a "Remove member" button performs an unaudited direct `deleteDoc` on `authorized_members`/`users` from the browser (the only identity-destructive action that bypasses the audited-callable pattern used everywhere else since Phase 2), and there are two separate, disconnected "Executive Signature" admin tabs today (the old static "Readiness Assessment" tab and the real connected one built in Phases 5–6).
  - **Phase 7 continuation**: wired `apps/readiness-assessment` to real entitlements — a new self-service `getMyEsStatus` read (entitlement status plus safe attempt summaries, never raw responses) now lets a signed-in returning participant see a notice pointing to their real result instead of being silently restarted at question one. Entry remains free/open, unchanged.
  - **Phase 11** (legacy-field retirement): a dependency scanner that greps the repository for references to compatibility fields like `productSummary` and the legacy readiness projection, so a future removal decision can be backed by evidence instead of guesswork. Run against both real candidates today: neither is close to clean, as expected, since nothing has migrated off them yet.
- My own work in parallel: extended the existing member Account page with an Executive Signature program row (verified by executing the rendering function directly with real inputs, not just reading it); wrote `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_10.md`, a risk assessment for the next production step (a Firestore rules deployment), explaining why it needs its own decision — the index deployment earlier this week revealed that no Firestore resource had ever been deployed through this project's own tooling before, so there's no confirmed record of what rules are actually live today — and giving the exact read-only command to check that before deciding; built and verified observability-scan tooling (duplicate-candidate age, orphaned entitlements/attempts, outbox dead letters) for the signals Phase 0 specified that are cheap to compute without new infrastructure.
- Caught and fixed one real documentation inconsistency along the way: the Phase 7 doc's "not yet built" list still named the Account-page and ES-entry work as outstanding after both were actually completed in this same round, left stale by the parallel work happening across multiple streams without an immediate sync pass.
- Every new and existing test passes together in one combined emulator run (15 suites); the full static repository sweep remains at exactly the one known pre-existing `typography-system.test.js` failure. Nothing from this work was pushed to `main` or deployed to production beyond what was already authorized earlier the same day (Cloud Functions). See `docs/CUSTOMER_PROGRAM_PLATFORM_TRACKER.md`'s decision log for the full record.

### 2026-10-04 — First Cloud Functions deployment; Phase 7 begun locally

- Deployed the full `functions-admin` (`admin-actions`) Cloud Functions codebase to production for the first time (`firebase deploy --only functions:admin-actions`). Every pre-existing function updated successfully; every new customer-program-platform callable (`getCustomerDirectory`, `getCustomerDetailForStaff`, `listEsParticipants`, `listEsAttempts`, `getEsConfiguration`, `getEsDataGovernance`, `revealAssessmentResponse`, the Phase 2 identity/entitlement callables, plus the new `getMyWorkspaces` below) created successfully, with zero exports removed. Verified live with a probe call returning `401 unauthenticated` rather than a 404/500.
- Deliberately did not deploy Firestore rules in the same step. The admin console's feature-flag read already fails closed harmlessly without them, and a rules deployment is Phase 10-scoped in the implementation plan; the index-deployment discovery that no Firestore resource had ever been deployed via this pipeline before means the live rules' real baseline is unverified. Turning the Phase 5/6 flags on for an actual accessibility review still needs this as its own later decision.
- Began Phase 7 (member workspaces and switcher) at the local/emulator level, ahead of Phase 6's own formal pass, mirroring the precedent set when Phase 5 began under the same condition (only production-dependent evidence remained open on the prior phase). Built and emulator-verified a self-service `getMyWorkspaces` read (TSA eligibility from `authorized_members`, ES eligibility from an active `entitlements` row, no side effects) and a pure, dependency-free `resolveLandingWorkspace` module implementing the Phase 0 landing order (deep link → last visited → only workspace → chooser → account-help) exactly.
- An existing Phase 2 static contract test caught a real design mistake in the first draft: TSA logic had leaked into `customer-program-service.js`, which must stay structurally free of any TSA dependency. Fixed by moving that check to the callable layer; full regression (all customer-program-platform emulator suites plus the new Phase 7 suite) then passed clean. See `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_7.md`.
- Nothing from Phase 7 is wired into the live member-facing pages yet, and nothing from either milestone has been pushed to `main`.

### 2026-10-04 — Cross-program Phase 6 built locally; release evidence remains open

- Added a new "Executive Signature" admin tab (Overview, Participants, Attempts, Configuration, Data governance), additive and read-only except for one explicit, audited action: revealing raw responses for a single attempt.
- `functions-admin/customer-program-service.js` adds `listEsParticipants`, `listEsAttempts`, `getEsConfiguration`, `getEsDataGovernance`, and `revealAssessmentResponse`; callable-gated in `functions-admin/index.js` to the existing `canReadEsOperations()` role set (`platform_owner`/`customer_support`/`es_program_lead`/`privacy_data_admin`).
- `revealAssessmentResponse` uses a strictly narrower server-side check mirroring `canReadRawEsResponses()`: only `platform_owner`, `privacy_data_admin`, or an `es_program_lead` whose own `platform_staff` document has `rawResponseAccess == true` can call it; the flag is read from Firestore server-side, never trusted from the client. Every reveal writes an `auditEvents` record (actor, attempt, reason) that never contains the raw answer content, verified by test.
- The reveal is a deliberate two-step UI gesture (open a confirm panel → type a required reason → confirm) on the Attempts tab only; it never runs automatically when an attempt's detail is viewed. No bulk export of raw responses exists in this phase.
- `firestore.rules` needed no changes: `assessmentDefinitions`, `assessmentVersions`, `entitlements`, `assessmentAttempts`, `responseParts`, and `platformFeatureFlags` already carried the exact boundaries this phase relies on, confirmed by rereading the file.
- The tab is inert unless `platformFeatureFlags/esWorkspace.enabled == true`, off by default. New `tests/customer-program-phase6-es-workspace.test.js` (emulator) plus `tests/customer-program-phase6-ui-contract.test.js` (static) join the full existing TSA/customer-program emulator suite (now ten emulator files) passing together; static sweep lands at 72 pass, 12 emulator-only skips, 1 pre-existing typography baseline failure.
- Phase 4 later passed. Direct service verification correctly found zero production ES records; Phase 6 callables/UI remain undeployed and flagged off pending scale, accessibility, ownership, and gate evidence. See `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_6.md`.

### 2026-10-04 — First production deployment (Firestore indexes only); Phase 5/6 reconciliation against real data passes

- Verified Phase 5/6's read logic directly against production through the service module, not through the undeployed customer-program callables. Existing unrelated Firebase Functions remain live.
- Found that `listEsParticipants` failed on a missing composite index, and discovered the root cause: **zero Firestore indexes had ever been deployed to production**, true since this project began (not specific to Phase 5/6). Every prior phase's gate decision had explicitly withheld production deployment.
- Deployed `firestore.indexes.json` to production (`firebase deploy --only firestore:indexes`) — index-only, no Firestore rules, Cloud Functions, or data touched. This is the first production deployment of any kind in this entire project. After the index finished building, re-verified `listEsParticipants` returns 0 rows, correctly matching that Phase 4 only backfilled TSA data (no Executive Signature entitlements exist yet).
- Phase 5's and Phase 6's "reconciliation against real backfilled data" gate items both now pass. What remains before either phase can fully pass: a performance/cost trace (not meaningful yet at 55 real customers and 0 ES participants) and an accessibility/usability review of the live UI with its feature flag on — the latter requires a first Cloud Functions deployment, which has not been authorized.

### 2026-10-04 — Cross-program Phase 4 passed, including the first production write in this plan

- Captured and signed a restricted production baseline by cloning the live Firestore `(default)` database into an isolated `cpp-phase4-baseline` database (`firebase firestore:databases:clone`), then reading only the clone (never production directly) with a new read-only `scripts/customer-program-production-baseline.js`: 55 `authorized_members`, 54 `users`, 2 `organizations`, 0 rows in any customer-program-platform collection.
- Generated and reviewed a production dry-run plan (`scripts/customer-program-production-dry-run.js`, combining the baseline with one read-only Firebase Auth `listUsers` call): 55 records, 0 named exceptions, 1 soft warning.
- Approved an operating window (batch size 25, halt on mismatch, rollback owner Wen-Szu) and executed the production apply with a new, separately reviewed `scripts/customer-program-production-apply.js` — emulator-verified for correct batching/checkpointing/idempotent replay before its first production use. Result: 55/55 applied, 0 exceptions, 0 skipped. This is additive only; `authorized_members`, `users`, and `organizations` were not modified.
- Reconciliation initially reported `FAILED` despite `matched=55, mismatched=0` — a bug in the reconciliation tooling (comparing the wrong snapshot variant for its `sourceUnchanged` check), not a data problem. Fixed, regression-tested, and re-run: PASSED (`sourceUnchanged=true`, `matched=55`, `mismatched=0`).
- Phase 4 has fully passed, local and production. Phase 5/6 direct production-data reconciliation also passed; their meaningful-scale performance, accessibility/usability, deployment, ownership, and written gate evidence remain before either feature flag can be enabled. See the tracker for current status.

### 2026-10-04 — Cross-program Phase 5 built locally; release evidence remains open

- Added bounded, cursor-paginated cross-program customer directory and detail read functions (`functions-admin/customer-program-service.js`), callable-gated to `platform_owner`/`customer_support`/`privacy_data_admin` (`functions-admin/index.js`).
- Raw assessment responses (`assessmentAttempts/{id}/responseParts`) are never read by this phase; Consent and Audit detail tabs are withheld from `customer_support` at the service layer, not just hidden in the UI.
- Added a new admin console tab (`admin/index.html` → Customers → Directory) with search, pagination, a row/detail view, and the full required state set (identity, participation, missing-data, migrated, duplicate, deletion/restricted, empty, error, responsive, accessible).
- The console is inert unless `platformFeatureFlags/customersConsole.enabled == true` (new `firestore.rules` match block, read-only for staff, no client write path); the flag is off by default and nothing changes for existing admin users.
- New `tests/customer-program-phase5-directory.test.js` plus the full existing TSA/customer-program emulator suite pass together; static sweep unchanged (71 pass, 11 emulator-only skips, 1 pre-existing typography baseline failure).
- Phase 4 later passed and direct service reconciliation against 55 production customers succeeded. Phase 5 callables/UI remain undeployed and flagged off pending scale, accessibility, ownership, and gate evidence. See `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_5.md`.

### 2026-10-04 — Cross-program Phase 4 local gate passed; production gate pending

- Added emulator-only source/target inventory, checksum-protected dry-run planning, bounded/checkpointed application, per-record migration ledger, reconciliation, and exact-target restore tooling.
- Existing canonical email claims are reused; duplicates, unverified Auth links, changed-email cases, and ownership conflicts are quarantined with named reason codes rather than auto-merged.
- Synthetic and full TSA/customer-program emulator gates pass, including idempotent rerun, source immutability, conflict, and restore drills. The sole static-suite failure remains the pre-existing typography baseline.
- Phase 4 remains **In verification** until the restricted production baseline, recoverable export, isolated restore, reviewed dry run, authorized backfill, and signed reconciliation are complete. Phase 5 remains locked and nothing was deployed.

### 2026-10-03 — Cross-program Phase 1 passed in emulators

- Added the exact additive schema contract, Firestore rule boundaries, composite-index manifest, payload-size checks, and behavioral authorization tests for TSA, Executive Signature, and future programs.
- Existing TSA/member, organization-console, and readiness-account Firestore behavior suites pass together with the new cross-program suite in isolated local emulators.
- New domain writes are server-only; raw ES responses require a narrowly privileged role; sponsors and analysts receive aggregate-only access.
- Phase 2 identity and entitlement work is open for emulator-only implementation. No Phase 1 Firebase rules, indexes, functions, data, or hosting were deployed to production.

### 2026-10-03 — Cross-program Phase 2 passed in emulators

- Added transactional canonical identity resolution, verified email change, duplicate-candidate routing, entitlement grants/lifecycle changes, append-only audits, and idempotency receipts.
- Concurrent exact-email/Auth claims converge on one customer; conflicting customers remain separate and enter manual review.
- Existing readiness completion now creates/reuses canonical ES identity and entitlement records while retaining its current legacy summary.
- Complete member, organization, readiness, cross-program rules, and identity/entitlement emulator regression passed. Phase 3 is open for emulator-only work; nothing was deployed.

### 2026-10-04 — Cross-program Phase 3 passed in emulators

- Added immutable, server-scored Executive Signature attempts with one 20-answer Quick Check response part or two 20-answer Full Assessment parts.
- Added locked version/scoring snapshots, versioned consent events, deterministic response/result checksums, rebuildable customer projections, redacted audits, and pending analytics/report outbox work.
- Full Assessment one-use and administrator-granted retake limits are transactionally enforced; every retake creates a separate immutable attempt.
- Browser/server scoring parity and the seven-suite TSA/cross-program Firebase regression gate pass. Phase 4 is open only for local/synthetic migration preparation; production data and deployment remain locked.

### 2026-10-03 — Superseded Claude/Codex handoff after chat reset

**Historical only:** Later 2026-10-04 phase evidence and the current sections above supersede the architecture/status directions in this handoff. It remains in the three-day change window to preserve why the subsequent work was undertaken; do not use it instead of the tracker.

Immediate open item if continuing the last active task:

- **Executive Signature result polish**: The user asked to fix spacing in the Executive Signature/readiness result pages before moving on. Work mainly lives in `apps/readiness-assessment/index.html` and `apps/readiness-assessment/my-results/index.html`.
  - Add more breathing room between text and beige/cream boxes across result sections.
  - Fix spectrum rows where the score and labels collide, such as `50HigherLower`; the `Higher` and `Lower` labels need their own line or clearer spacing.
  - Rename the CTA currently reading `Get the full report, free for now`. The accurate action is to take a separate 40-statement Full Assessment after the 20-question Quick Check. Suggested wording: `Take the 40-statement Full Assessment`.
  - Redesign the full-report table of contents. The current TOC is too plain. Use a cleaner card/step treatment that still fits the UTL brand.
  - PDF print header: the UTL logo is already intended for the top-left running header through the print-logo assets. Add more vertical space below the orange rule before body content. Be careful with print CSS because the 2026-10-01 Chromium `@page margin` bug still applies.
  - Do not make new factual claims about the assessment without user approval.

Suggested low-risk wiring after the result polish:

- Add an `Executive Signature` entry in the member profile/dropdown so TSA learners can find the assessment/results from the workspace. Keep it as a link to `apps/readiness-assessment/my-results/` or the assessment landing flow rather than changing the Learning Journey structure.
- If showing it inside `My Results` later, keep it separated from TSA exercise results. Executive Signature is its own product/signal, not a TSA exercise.

Recent readiness-assessment product decisions:

- The public title and positioning should use `Are you ready to be an executive?`
- Use `Executive Signature` as the learner-facing assessment/report concept where appropriate.
- Avoid saying the assessment is "free" as the core value. If needed, say it is open sourced or currently available while testing, but lead with history and scientific soundness.
- Introduce Big Five/IPIP in plain language first, with sources in smaller type. Do not assume visitors know IPIP or Big Five.
- Use the user's voice guide: concrete, direct, no `X, not Y` constructions, no AI-sounding abstractions, no forbidden terms such as "verdict" when describing assessment results, and use Bolded Summary Phrase style for bullets where used.
- There are no right answers. Copy should make clear that scores describe traits commonly found in executives and should not make someone feel they "failed."
- Replace `What the check looks at` with `What the assessment looks at`.
- Remove the orange outline/card top bars where they feel too AI-ish. Brand colors are fine; avoid decorative outlines that make cards feel generated.
- Results should be easier to scan. Results need clearer structure, better spacing, and more careful explanation of the five areas.
- Scale copy preference: use labels like `1 = Not me at all` and `5 = Spot on`.

Readiness assessment data and architecture direction:

- Keep readiness-assessment leads, attempts, results, and versions separate from TSA program progress so Student Progress stays fast and clean.
- A good split is:
  - `readiness_leads` or equivalent for public assessment lead/contact info.
  - `readiness_attempts` for raw 20/40-statement attempt data, item order, answers, timing, and form version.
  - `readiness_results` for computed scores and report data.
  - `readiness_forms` or equivalent for versioned form definitions.
  - Existing TSA data remains under the current users/member/progress paths.
- The 20-question Quick Check and 40-statement Full Assessment are fixed item sets, but item display order should be shuffled per attempt and stored as `itemOrder`.
- Scoring must depend on item ID, not display order.
- Every attempt and result should store the exact `formVersion`.
- Admin needs a Readiness Assessment tab eventually, not a page-within-a-page. It should manage form versions, uploads, downloads, attempts, results, and lead/contact details independently from Student Progress.

Important non-readiness recent work and open notes:

- Mobile exercise headers were recently compacted because the sticky header consumed too much of the phone screen. Continue to test important member pages at 375px and 768px.
- Dropdown/select controls needed more right padding because arrows were too close to the edge. Apply consistently to shared select styling, not one-off controls.
- Program page learning-experience screenshots were added/reworked. User prefers screenshots that open on click rather than explicit `Open full view` buttons, and wants the copy to say `Mastery Points (MP)`.
- Testimonials were redesigned to reduce excessive white space and return to a slow rolling movement.
- Toolkit AI prompt section was redesigned; template framework exists or is planned with `AI prompts` usable now and documents/spreadsheets/presentations as coming soon.
- Organization console foundation exists. Known org IDs: `ALI` = AyalaLand, `ADMU` = Ateneo de Manila University. Individual/beta users should not be forced into an organization.

Before pushing anything:

- Run the relevant local tests for the touched area. For readiness work, likely start with:
  - `node --test tests/readiness-assessment-forms.test.js tests/readiness-assessment-preview.test.js tests/readiness-assessment-account.test.js tests/readiness-signature.test.js`
  - `node --check member-login/content-config.js` if that file changes.
- Do not push unless the user explicitly asks.
