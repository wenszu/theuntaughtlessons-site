# The Untaught Lessons Website Context

Last updated: 2026-09-13

Single source of truth for agents working on this repo. Read before making changes, update after structural changes. Detailed historical entries and full page/app maps are in `archive/WEBSITE_CONTEXT_ARCHIVE.md`.

## How To Use This File

1. `Working Rules` — how to behave in the repo
2. `Git and Deployment Rules` — how to commit and push
3. `Brand System` — colors, fonts, logos
4. `Firebase Member System` — auth and Firestore structure
5. `Quick Reference` — page and app file list
6. `Known Notes` — active limitations
7. `Current Implementation Notes` — architecture rules
8. `Change Log` — recent context only (last 3 days)

Related files: `context/brand.md` (brand/UI rules), `context/voice-editor.md` (writing voice), `context/claude.md` (Claude-specific reminders).
Operational docs: `GOOGLE_GROUP_SETUP.md`, `FIREBASE_EMAIL_TEMPLATE.md`.
Migration trackers: `GOOGLE_GROUP_SYNC_MIGRATION.md`.
Assessment reference: `ASSESSMENTS_AND_GROCERY_REFERENCE.md`.

## Working Rules

- Read this file first before any website change.
- Follow `context/brand.md` for brand and design.
- Follow `context/voice-editor.md` for prose edits.
- Keep changes minimal. No redesigns unless explicitly asked.
- Preserve the static HTML/CSS/JavaScript architecture. No npm, no framework, no build step unless the user explicitly approves.
- Prefer existing patterns in `styles.css`, page-local CSS, `member-login/content-config.js`, and existing app files.
- Do not overwrite unrelated user changes.
- Do not remove legacy localStorage compatibility keys unless explicitly approved.
- Do not change practice app logic unless the task requires it.
- Check mobile layouts at 375px and 768px for meaningful UI changes.
- Update this file when pages, apps, data structures, auth behavior, deployment notes, or major design rules change.

## Git and Deployment Rules

- Do not commit or push unless the user asks (save / commit / push / upload to Git / publish branch).
- Run `git status --short --branch` first, inspect changed files, stage only relevant files.
- Do not stage `.DS_Store`, local debug files, or unrelated edits.
- Push to `origin` after committing. If branch has no upstream, push with tracking.
- Do not deploy to Firebase Hosting unless separately requested.
- Never use `git reset --hard` or `git checkout --` unless explicitly requested.

GitHub remote: `origin https://github.com/wenszu/theuntaughtlessons-site.git`

Local preview: `http://127.0.0.1:8061/`
Local server: `python3 -m http.server 8061 --bind 127.0.0.1`

## Brand System

Fonts: `Playfair Display` (headings) · `Lato` (body) · `Roboto Mono` (labels/utility)

Colors: Navy `#003366` · Gold `#EEA320` · Cream `#F3EDE2` · Charcoal `#4A4A4A` · Steel `#4D7094` · White `#FFFFFF`

Logos: `assets/logo.png` (main) · `assets/utl-logo-nav-white.png` (app header white)

Favicon: `assets/favicon-bluebg-whitedoor-thicker-32.png` (the `?v=` value is automated — see cache-busting note under Current Implementation Notes; do not hand-set a specific version here)

Trademarks: `C³ Rubric™` · `Think, speak and act like an executive™` — use ™ on first use per public page/email, then omit on later shorthand references. The previous score brand is paused; use `Find your level`, `Diagnostic`, `Checkpoint`, or `Assessments` instead.

## Firebase Member System

Firebase project: `the-untaught-lessons` · Shared client: `assets/firebase.js`

The Admin Console imports the shared Firebase client with an explicit version query. Update that version whenever the module's named exports change so a cached older module cannot prevent the admin authentication gate from starting.

Firestore collections:
- `authorized_members/{email}` — who can sign in with an approved email link or identity provider. Email keys are normalized lowercase.
- `users/{uid}` — per-user profile and progress. Fields: `email`, `displayName`, `role`, `lastSeenAt`, `workspaceProgress`, `feedbackEnabled`.
- `users/{uid}/completed_exercises/{exerciseId}` — per-exercise completion records.
- `settings/emailTemplates` — welcome email template. Read/written by `getEmailTemplates`/`saveEmailTemplate` in `assets/firebase.js`.
- `settings/feedback` — global `defaultFeedbackEnabled` boolean.
- `settings/publicSite` — public toggle settings (e.g. `findLevelVisible`).
- `settings/admin_visibility` — admin/owner preview-only visibility settings, including whether admins/owners can preview hidden public Find your level cards and bypass the public Find your level data form.
- `google_group_sync_jobs/{jobId}` — legacy Google Group add/remove jobs retained for history. The Admin Console no longer creates these jobs because Google Workspace group automation is unavailable.

Key `authorized_members` fields: `email`, `name`, `role` (member/admin/owner), `status`, `googleGroupAdded`, `googleGroupAddedAt`, `googleGroupAddedBy`, `googleGroupRemovedAt`, `googleGroupRemovedBy`, `feedbackEnabled`, `addedAt`, `updatedAt`.

Auth behavior:
- Supports passwordless email links plus Google, Microsoft, and Facebook sign-in for emails in `authorized_members`.
- Local test accounts: `admin/password123` and `testuser/member2026`.
- Unauthorized Google accounts are signed out with an invite error (outside localhost/emulator).
- Admin access: role `admin` or `owner`.
- `adminProfileData()` reads from `utl_member_profile` localStorage JSON, falls back to `utl_member_username` → `'admin'` for local test accounts.

Passwordless invites: Admin sends Firebase email-link invites from `admin/index.html`. Current `actionCodeSettings.url` points to `http://localhost:8061/member-login/` — update before production use.

Emulators (Auth: 9099, Firestore: 8085, Hosting: 5000): enable with `localStorage.setItem("utl_use_firebase_emulators", "true")` or `?emulators=true`.

Firestore rules pattern for settings: public pages can read `publicSite` and `public_assessments`; other settings require sign-in.

The repository still contains the optional `functions/processGoogleGroupSyncJob` implementation, but it is not deployed. It requires paid Google Workspace administration and domain-wide delegation. Member access does not depend on it.

## Quick Reference — Pages

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
| `member-login/content-config.js` | Workspace config, nav, shared styles, rendering |
| `member-login/admin.html` | Deprecated redirect to `admin/index.html` |
| `my-results/index.html` | Participant exercise record (no password gate) |
| `admin/index.html` | Admin panel — Content Manager, Student Progress, Rewards, Member Management, Engagement, Content Library, Preview &amp; Health |

## Quick Reference — Apps

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
| `apps/eisenhower-matrix/` | Phase 3 | Prioritization matrix, 6 scenarios |
| `apps/eisenhower-matrix/` | Phase 3 | Guided five-round prioritization and written-no exercise (member-facing v1) |
| `apps/i-have-bad-news/` | Phase 3 | Difficult conversations launch page |
| `apps/lets-switch-hats/` | Phase 3 | Perspective-taking launch page |
| `apps/speak-like-obama/` | Phase 3 | Speech delivery launch page |
| `apps/tsa-diagnostic/` | Assessment | The sole TSA assessment — Think/Speak/Act in one saved flow. `?assessment=checkpoint` serves the post-program Checkpoint from the same file |

Data files: `data/sort-bucket.json` (public concept-scored Find your level exercises), `data/tsa-score-bands.js` (public score bands/scoring helpers), `data/tsa/*.json` (member assessments), `data/practice/*.json` (member practice), `data/testimonials.json`. See archive for schemas.

Apps Script endpoint (all POST submissions): `https://script.google.com/macros/s/AKfycbzJE--FL2kB_XDNZRnszCtlyLRPvaLAHGuF5TAOdXJk40atbvf5Y6ELuSK2B7CSLaMN/exec`

Apps Script `action` routing: `WelcomeEmail`, `TestEmailTemplate`, `ResultsEmail`, `RemovedMember`, `AddGoogleGroupMember`, `RemoveGoogleGroupMember`. Default = lead/sheet logging.

## Assessment Documentation

Two reference files govern all assessment design, scoring logic, and exercise content. Load these files when working on anything related to the TSA Score™, C³ Rubric™, Find Your Level, the Diagnostic, the Checkpoint, or individual exercises.

### UTL_TSA_scoring_framework.md
The stable reference for the TSA Score™ structure, the C³ Rubric™ (C1–C10), tier scoring rules (Tier 1/2/3), the points model per exercise type, scoring type reference (Type 1 rule-based vs Type 2 AI rubric), assessment versions (Diagnostic, Checkpoint, Find Your Level), score bands, and the results page methodology.

Load this file when:
- Designing a new exercise type
- Writing or updating Gem prompts that involve scoring
- Working on the white paper series (Papers 1–5)
- Explaining the TSA Score or C³ Rubric to anyone
- Building the results page or score report UI

This file changes rarely. It is the philosophy layer.

### UTL_assessment_exercises.md
The working register for all exercises across all three phases. Contains the exercise bank status, type-level design rules, the full exercise register table, and per-exercise detail sections including concepts, Tier 1 items, trap items, panel decisions, and open questions.

Source of truth for exercise content is the JSON files (data/sort-bucket.json and equivalents per exercise type). This file documents decisions and registers exercises — the JSON is the implementation.

Load this file when:
- Building or refining any exercise
- Running panel tests on new exercises
- Checking which exercises are available for each assessment version
- Updating the question bank

This file changes every time a new exercise is built or a decision is made. It is the build layer.

### Handoff rule
Decisions are made in Claude (claude.ai). JSON updates are handled in Codex. Documentation updates to both .md files are handled in Claude Code. WEBSITE_CONTEXT.md is the entry point that routes to the right file for the task.

## Known Notes

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

## Current Implementation Notes

- Static site — no backend, no npm, no framework, no build step.
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
- Cache-busting `?v=...` query strings are now fully automated (added 2026-09-11) — do NOT hand-edit any `?v=` value anywhere in the repo anymore. `.github/workflows/sync-cache-versions.yml` runs `node scripts/sync-cache-versions.js` on every push to `main`, rewrites every `?v=...` on every `.js`/`.css`/`.json`/image reference (in HTML attributes and in JS-constructed `import()`/`new URL()` calls) to one shared timestamp value, runs the full test suite against the result, and commits it back to `main` with `[skip ci]` if anything changed. Before this existed, versions drifted silently — `firebase.js` was loaded under 4 different `?v=` values depending which file referenced it. Tests that need to assert a cache-bust value is present now use a pattern match (e.g. `/content-config\.js\?v=[\w-]+/`) rather than a literal string, since the literal changes on every deploy. To dry-run the rewrite locally without committing: `node scripts/sync-cache-versions.js --dry-run`.
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

### 2026-09-11 — Public form delivery fix and MECE operational health monitoring

- Pushed commit `dcb0d51` (`Improve form delivery and operational health monitoring`) to `origin/main`. The working tree was clean immediately after the push. The documentation update in this entry was made afterward as a Claude handoff.
- Fixed misleading failure states on the public Contact and Join the waitlist forms. The Apps Script endpoint had already written test submissions to the `Contacts` sheet, but the browser could still show an error because a static cross-origin page cannot reliably inspect the Apps Script redirect/response. Both forms now queue the JSON payload with `navigator.sendBeacon()` using a `text/plain` `Blob`, then fall back to a `no-cors`, `keepalive` fetch. Contact preference storage is isolated in its own `try/catch`, so disabled session storage cannot turn a queued submission into a visible error.
- Both public forms explicitly send `tab: 'Contacts'`. This is required because the connected spreadsheet has a `Contacts` tab and no `Leads` tab, while the Apps Script's historical default is `Leads`. The spreadsheet is `[Website] UTL leads and assessments v1`, ID `10iQByFqVCffHanZbbHLnYj7Csbet4fgOCd2FWDzEqkE`. The `Contacts` columns are Timestamp, Name, Email, Role, What brings you here?, Page, and Source.
- Static-site limitation: `sendBeacon()` confirms that the browser accepted the request for delivery; it cannot prove that Apps Script finished processing it. Do not restore response-body inspection on these cross-origin submissions. For end-to-end confirmation, submit once and check the `Contacts` sheet and notification inbox. Avoid repeated tests because each test creates a real row and may send a notification.
- Bumped `assets/public-waitlist.js` references to `?v=3` on `index.html`, `about.html`, `programs.html`, `contact.html`, and `programs/think-speak-act.html` so visitors receive the corrected submission code.
- Split the former mixed `Launch Health` screen into two mutually exclusive operational views:
  - `Student Progress > Learner readiness` is the people/support view. It covers active members, activity in the last 24 hours, learners who never signed in, incomplete orientation, pending progress saves, and one consolidated follow-up queue.
  - `Preview & Health > Technical reliability` is the incident view. It covers browser/page failures, failed resources, Vimeo stalls and player errors, connection/save incidents, affected learners, and successful sync recoveries. It explains reporting coverage and does not collect learner answers.
  - `Preview & Health > Site health check` remains the separate configuration/structure audit for expected accordions, cards, app links, completion keys, and embed keys. Keep this separate from runtime incident monitoring.
- Added `assets/stability-monitor.js`, loaded fail-safely through `assets/engagement-analytics.js`. Monitoring is bounded to 20 reports per session, deduplicates the same fingerprint for five minutes, strips email addresses and links from messages, omits stack traces and learner answers, and must never interrupt the learner experience.
- Added Firebase persistence/admin reading for `users/{uid}/stability_events/{eventId}` in `assets/firebase.js`. `firestore.rules` permits a signed-in learner to create a tightly validated event under only their own UID, permits admins to read events, and disallows client update/delete. `member-login/content-config.js` dispatches Vimeo stall and error reports into the shared monitor.
- Deployment caveat: the Git push publishes static code through the normal Cloudflare Pages flow, but it does not deploy Firestore rules. Before relying on production Technical reliability data, deploy the updated `firestore.rules` through the project's normal Firebase rules deployment process. The monitor is fail-safe if rules have not yet been deployed, so learner pages remain usable.
- Files in commit `dcb0d51`: `about.html`, `admin/index.html`, `assets/engagement-analytics.js`, `assets/firebase.js`, `assets/public-waitlist.js`, `assets/stability-monitor.js`, `contact.html`, `firestore.rules`, `index.html`, `member-login/content-config.js`, `programs.html`, `programs/think-speak-act.html`, `tests/launch-health-and-sync-recovery.test.js`, `tests/public-waitlist.test.js`, and `tests/stability-monitoring.test.js`.
- Verification completed before push: all 60 repository tests passed, contact inline JavaScript parsed, `assets/public-waitlist.js` passed `node --check`, `git diff --check` passed, Firestore rules compiled in the emulator earlier in the implementation, and the local server on port 8061 served the new Contact, Learner readiness, and Technical reliability code.


### 2026-09-11 (cont.) — Vimeo CSP fix, Firebase admin-loading cache, and Learner readiness filtering

- `_headers`' report-only CSP omitted `player.vimeo.com` from `script-src`, `frame-src`, and `connect-src` even though the site loads the Vimeo Player SDK and embeds videos from it. Fixed. Note: confirmed via live `curl` that `_headers` is not actually served at all today — GitHub Pages doesn't read that file, and Cloudflare in front is DNS/CDN only (not Cloudflare Pages) — so no security headers, CSP included, currently reach the live site. Making them real would need a Cloudflare Worker or a move to Cloudflare Pages; that's an infrastructure decision, not made here.
- `admin/index.html`'s `getAllMemberWorkspaceProgress()` (full `authorized_members` + `users` collection scan) was called independently by Student Progress, Learner readiness/Technical reliability, and Engagement Insights with no caching, re-fetching on every tab switch. Added `spFetchAllMembers(fb, forceRefresh)` — a 45-second shared cache; every Refresh button passes `forceRefresh:true` to bypass it, tab-switch navigation does not.
- Added cohort/search/signal filtering to `Student Progress > Learner readiness` (previously the only tab in that group without it, unlike Student Progress itself), and cross-referenced recent Technical reliability incidents (last 72h) directly into its follow-up queue as a "Recent technical issue" signal, so following up on a struggling learner doesn't require checking a second tab.

### 2026-09-11 (cont. 2) — Local `.git` metadata deleted by an external tool; recovered from GitHub

- Mid-session, the user's local `.git` directory (HEAD, config, refs, nearly all objects) was emptied by "Meta AI" during an unrelated cleanup task running in parallel, and 4 tracked source files (`functions-aiko/index.js`, `functions-aiko/package.json`, `functions-aiko/package-lock.json`, `functions-admin/package.json`) were also deleted from disk. The working tree was otherwise untouched.
- Recovered by cloning `wenszu/theuntaughtlessons-site` fresh from GitHub into a scratch directory, verifying it with `git fsck --full`, restoring the 4 missing files from that clone, then splicing the clone's `.git` folder into the site directory in place of the emptied one (the sandbox's safety classifier blocks Bash commands that touch `.git` directly, so the user ran that one splice command themselves). One local commit (`1e9c0cd`, "Document form and health monitoring handoff") had never been pushed and its git record was unrecoverable, but its content was intact in the untouched working tree and was re-committed.
- Lesson for future sessions: if `git status` run from inside this repo ever shows the *entire home directory* as untracked, stop immediately — it means `.git` here is missing/corrupt and git has walked up to a different repository. Do not run any git write command in that state.

### 2026-09-11 (cont. 3) — Site-wide load-speed pass: fonts, cache-busting automation, dead-code removal, images, offline indicator

- Fonts: `tools/tools-shared.css`, `portal/portal.css`, and `apps/explain-to-aiko/aiko.css` loaded Google Fonts via CSS `@import` (serializes the fetch behind the CSS itself downloading first) while the rest of the site already used `<link rel="preconnect">` + `<link rel="stylesheet">`. Removed the `@import`s, added the same preconnect pattern to the 8 HTML pages that load those 3 CSS files.
- Cache-busting is now automated — see the dedicated note under Current Implementation Notes. Before automating it, found and fixed real live drift: `assets/firebase.js` was being loaded under 4 different `?v=` values depending which file referenced it (`admin/index.html`, `reward-events.js`, `stability-monitor.js`, `engagement-analytics.js` each had a different one), `app-access-guard.js` under 4, `styles.css` under 3 (one page 3+ months stale), `feedback-widget.js` under 2 — meaning different pages could genuinely have been running different cached copies of the same shared file. `scripts/sync-cache-versions.js` + `.github/workflows/sync-cache-versions.yml` now keep every reference in sync automatically on every push to `main`.
- `member-login/content-config.js`: removed ~340 lines of confirmed-dead code — `renderAdmin()` and its supporting cluster (`adminNavHtml`, `bindAdminTabs`, `renderAdminContent`, `bindAdminContentManager`, `visibilityHtml`, `renderContentManagerTabHtml`, `adminExerciseSlot`, `renderStudentProgressTabHtml`, `renderMemberManagementTabHtml`, an orphaned duplicate `bindAdmin`, and `saveField`), plus the two now-unused constants `ADMIN_PASSWORD_KEY`/`DEFAULT_ADMIN_PASSWORD`. `admin/index.html` has its own separate, self-contained admin implementation and has never called `window.UTLWorkspace.renderAdmin()` — it only reads `window.UTL_CONTENT` from this file as data. `window.UTLWorkspace` now exposes exactly `renderIndex`, `renderOrientation`, `renderPhasePage`, `renderPhasePracticePage`, `getPhase` (verified live via a browser harness).
- A full-file split of `content-config.js` (198 top-level functions in one closure, ~4,000 lines) was investigated and explicitly deferred: `renderIndex()` alone touches auth, rewards, progress, and DOM-rendering groups in one function body, and the Vimeo-tracking code calls rewards/progress functions directly — a real multi-file runtime split would need converting ~15 scattered closure-private `var`s into an explicit shared namespace object, a materially bigger and riskier refactor than "split a file." Not attempted.
- Images: found that the "1-1.4MB logo PNGs" flagged in an external audit were actually unreferenced dead design-asset variants (0 references anywhere) — not a real load-speed issue. The real problem was 6 different live, widely-loaded images shipping at many times their display resolution: `assets/utl-logo-nav-white.png` (2500×1100 source for a ~126-286px display, loaded on every member/app page, 150KB→33KB), `assets/logo.png` (3000×3000 for ≤160px, every public page, 135KB→25KB), `assets/Wen-Szu__profile_picture__-_Substack.jpg` (2389×2389 for a ≤380px on-page display / used as `og:image`, resized to 1200px matching recommended OG dimensions, 371KB→176KB), `assets/program-logo-tsa-icon.png` (374px source shown at 23px on the Learning Journey page — the main learner dashboard — 16x oversized, 41KB→7KB), `assets/program-logo-tsa.png` (414px source shown at 68px on `programs.html` and in admin's cohort report, 85KB→36KB), `assets/program-logo-tsa-white.png` (413px source shown at up to 108px on the homepage, 84KB→69KB, a smaller gain — this variant doesn't compress as efficiently at the same resolution reduction). Resized in place with `sips` (same filenames/paths, no HTML changes) after visually verifying each against its actual on-page background. The walkthrough onboarding screenshots and `apps/chalkboard-notes/assets/chalkboard-notes.jpg` were checked and are already close to their display resolution — resizing them either produced no gain or made the file bigger, so they were left alone.
- Added `<link rel="preconnect">` for `https://www.gstatic.com` (the Firebase SDK's CDN origin) and the three Firebase REST origins (`firestore.googleapis.com`, `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`) to all 23 pages that load Firebase-dependent code (the 6 `member-login/*.html` shell pages, `admin/index.html`, and the 16 exercise apps that load `assets/app-access-guard.js`), so connection setup for the always-on-the-critical-path auth check isn't paid for after the Firebase SDK script starts running.
- `assets/stability-monitor.js` already listened for the browser's `offline`/`online` events (previously only to log them for Technical reliability). Added a real-time top banner ("You're offline. Your work keeps saving in this browser and will sync once you're back online.") shown/hidden by those same listeners, plus a check on load in case the page opens while already offline — previously a learner who lost connection got no feedback until something happened to fail a save. No new script tags needed; this file already loads on every learner-facing page.
- Considered and explicitly declined (per user): capping Vimeo playback quality lower specifically on mobile viewports. `addVimeoPlaybackParams()` in `content-config.js` already sets one shared `max_quality=720p` ceiling for every device, and Vimeo already adapts the actual stream to player size/bandwidth on its own; a mobile-specific lower cap was assessed as feasible (same function, viewport-width check against the site's existing 768px breakpoint) but not worth doing.

### 2026-09-12 — Admin console navigation review and cleanup

- Full audit of `admin/index.html`'s navigation (7 top-level tabs, 30 sections) at the user's request, focused on the "Preview & Health" tab specifically. Found: `section-reward-rules` ("MP rules" — the actual editable form behind the read-only "Rules & MP" summary, ~16 settings covering the whole MP economy) had no sidebar nav button at all — a real bug, not a deliberate omission. Two other sections were also nav-orphaned but deliberately so, per an existing test (`tests/admin-navigation.test.js`) asserting they stay out of primary navigation: `section-passwords` ("Legacy local access", a pre-Firebase-auth break-glass local password, explicitly labeled "Not production account security") and `section-email-nudges` ("Email nudges", a fully disabled placeholder form for a feature with no backend automation connected yet, labeled "Not connected"). Confirmed with the user and left both exactly as they were.
- "Technical reliability" and "Site health check" sound like synonyms but check fundamentally different things — the former is a live incident monitor (real browser errors/video stalls/sync failures from actual signed-in sessions, pulled from Firebase, last 24h), the latter is a static config/build linter (video URL formats, page reachability, ID naming conventions, checked against `window.UTL_CONTENT` and `localStorage`, no Firebase, auto-runs on page load). Reworded both descriptions to state plainly what each does and doesn't check, and to name the other by name.
- Added "MP rules" to the Rewards nav. Folded "Unlock phases" — a section that was a single checkbox — into "Member preview settings" as a new "Admin preview" toggle group inside the existing `VISIBILITY_CHECKLIST` array (same item shape, same `setChecklistValue()` handler); removed the now-redundant `ADMIN_PREVIEW_ITEMS` array, `renderAdminPreviewChecklist()` function, and the standalone section. The two places that already echoed that toggle's value read-only (Member preview settings' own status card, Site health check's release-settings group) were untouched since both read straight from `localStorage`, not from the removed array. Reworded "Quick links"' description — it's a static bookmark directory (~22 hardcoded links), not a check, and was easy to mistake for one sitting among monitoring tools.
- Follow-up from the user: "Rules & MP" (the read-only live summary of current reward rules) and "MP rules" (the edit form added to the nav above) read as near-duplicates side by side despite being a view/edit pair. Renamed "Rules & MP" to "Rules summary" and added a one-line cross-reference in each section's description pointing at the other, making the Rewards tab MECE: Levels (title/threshold ladder) · Rules summary (read-only) · MP rules (edit) · Award preview (per-exercise reflection/celebration preview).
- Verified throughout: full test suite (`tests/admin-navigation.test.js` updated for the admin-preview merge and the two orphan-status assertions), a headless-Chrome load of `admin/index.html` with zero console errors, and a small in-browser harness confirming `window.UTLWorkspace`'s exposed keys after the `content-config.js` cleanup above.
