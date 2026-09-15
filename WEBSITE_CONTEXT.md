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

### 2026-09-11 — Public form delivery fix and MECE operational health monitoring

- Public forms now queue cross-origin Apps Script submissions with `sendBeacon()` and a `no-cors` fallback. A queued request is not proof of processing; confirm important submissions in the `Contacts` sheet and notification inbox.
- Operational health is split by use case: `Student Progress > Learner readiness` for people/support, `Preview & Health > Technical reliability` for runtime incidents, and `Preview & Health > Site health check` for configuration integrity.
- Stability events are privacy-bounded and fail-safe. Deploy `firestore.rules` separately before relying on production incident data.
- Implementation commit: `dcb0d51`. Detailed record: [archive](archive/WEBSITE_CONTEXT_ARCHIVE.md#2026-09-11--public-form-delivery-and-operational-health).


### 2026-09-11 (cont.) — Vimeo CSP fix, Firebase admin-loading cache, and Learner readiness filtering

- Vimeo is allowed in the repository CSP, but `_headers` is not served by the current GitHub Pages/CDN setup. Enforcing those headers requires a Cloudflare Worker or a move to Cloudflare Pages.
- Admin member/progress loading uses a shared 45-second cache with explicit refresh bypass. Learner readiness includes cohort/search/signal filters and recent technical incidents.
- Detailed record: [archive](archive/WEBSITE_CONTEXT_ARCHIVE.md#2026-09-11--vimeo-csp-and-admin-progress-loading).

### 2026-09-11 (cont. 2) — Local `.git` metadata deleted by an external tool; recovered from GitHub

- Repository metadata and four tracked files were recovered from a verified fresh GitHub clone after an external tool deleted them. One unpushed commit record was lost, but its working-tree content was retained and recommitted.
- If `git status` ever shows the entire home directory as untracked, stop without running a Git write command. See the [recovery record](archive/WEBSITE_CONTEXT_ARCHIVE.md#2026-09-11--git-metadata-recovery).

### 2026-09-11 (cont. 3) — Site-wide load-speed pass: fonts, cache-busting automation, dead-code removal, images, offline indicator

- Improved font loading, resized six live images, added Firebase-origin preconnects, removed confirmed dead admin code, and added the learner offline banner. Vimeo retains one adaptive 720p ceiling across devices.
- Cache-busting is automated; never hand-edit `?v=` values. A risky full split of `member-login/content-config.js` was evaluated and deferred.
- Detailed record: [archive](archive/WEBSITE_CONTEXT_ARCHIVE.md#2026-09-11--site-wide-load-speed-and-stability-pass).

### 2026-09-12 — Admin console navigation review and cleanup

- Admin navigation now exposes MP rules, distinguishes runtime reliability from static site health, and merges phase unlocking into Member preview settings. Legacy local access and unconnected email nudges intentionally remain hidden from navigation.
- Rewards is organized as Levels, Rules summary, MP rules, and Award preview. Detailed record: [archive](archive/WEBSITE_CONTEXT_ARCHIVE.md#2026-09-12--admin-console-navigation-cleanup).

### 2026-09-15 — CustomGPT voice-practice guide

- `i-have-bad-news` and `lets-switch-hats` share an opt-out voice-practice dialog that shows how to open the CustomGPT, find the highlighted blue ChatGPT voice control, allow microphone access, and practice aloud. Text remains an available fallback, and a small help link reopens the guide.
- The external CustomGPT destination, completion keys, and MP award logic were not changed.
