# The Untaught Lessons Website Context

Last updated: 2026-05-30
Primary purpose: Shared implementation memory and operating guide for The Untaught Lessons website.

This file is the single source of truth for agents working on this repo. Codex, Claude, Gemini, and any future assistant should read it before making website changes and update it whenever the shape of the site changes.

## How To Use This File

Read this file in this order:

1. `Working Rules`: How to behave in the repo.
2. `Git and Deployment Rules`: How to commit, push, and deploy.
3. `Site Overview`: What the site is and how it runs.
4. `Current Implementation Notes`: Current architecture decisions.
5. `Known Notes`: Active limitations and pending decisions.
6. Relevant sections in `Page Map`, `App Map`, `Firebase Member System`, or `Exercise Data Architecture`.
7. `Change Log`: Historical context only. Do not rely on the changelog instead of the current-state sections above.

## Working Rules

Before changing the website:

- Read this file first.
- Also follow `context/brand.md` for brand and design rules.
- If editing prose, follow `context/voice-editor.md`.
- Keep changes minimal and implementation-focused unless the user explicitly asks for a redesign.
- Preserve the static HTML/CSS/JavaScript architecture unless the user explicitly approves a backend, build step, framework, or package manager.
- Prefer existing patterns in `styles.css`, page-local CSS, `member-login/content-config.js`, and existing app files before adding a new abstraction.
- Do not overwrite unrelated user changes.
- Do not remove legacy localStorage compatibility keys unless the user explicitly approves it.
- Do not change practice app logic unless the task explicitly asks for it or the change is required to fix the requested behavior.
- Check mobile layouts around 375px and 768px when making meaningful UI changes.
- Update this file in the same work session when pages, apps, data structures, auth behavior, deployment notes, admin workflows, or major design rules change.

Related context files:

- `context/brand.md`: Brand and visual rules. Treat this as required for design/UI work.
- `context/voice-editor.md`: Wen-Szu writing and editing voice.
- `context/claude.md`: Short Claude-specific reminder that points back to the brand rules.

## Git and Deployment Rules

The user prefers careful, explicit Git handling.

- Do not commit or push unless the user asks to save, commit, push, upload to Git, upload to GitHub, publish a branch, or similar.
- When the user asks to upload to Git/GitHub, use the current branch unless they specify another branch.
- First run `git status --short --branch`.
- Inspect the changed files before staging.
- Stage only files relevant to the requested website change. Do not stage `.DS_Store`, local debug files, or unrelated edits.
- Use a concise commit message that describes the actual site change. If the message is not obvious, ask the user.
- Push to `origin` after committing. If the branch has no upstream, push with upstream tracking.
- Do not deploy to Firebase Hosting or any other host just because the user asked to upload to GitHub. Treat deployment as a separate explicit request.
- If the user asks to deploy, inspect `firebase.json` first and confirm the intended target. This repo is configured for Firebase Hosting with public root `"."`.
- `WEBSITE_CONTEXT.md`, `context/**`, `csv/**`, and `scripts/**` are ignored by Firebase Hosting in `firebase.json`, so documentation and developer-only files can be committed without being published to the live site.
- Never use destructive Git commands such as `git reset --hard` or `git checkout --` unless the user clearly asks for that exact operation.

GitHub remote:

```text
origin https://github.com/wenszu/theuntaughtlessons-site.git
```

Static preview should use:

```text
http://127.0.0.1:8061/
```

Typical local server command:

```bash
python3 -m http.server 8061 --bind 127.0.0.1
```

## Maintenance Rules

Update this file when a change affects future work. Do not record every tiny CSS adjustment, but do record anything another agent would need in order to avoid confusion.

Update these sections as needed:

- `Last updated`: Set to the absolute date of the latest meaningful context update.
- `Change Log`: Add a dated entry with concise implementation facts.
- `Page Map`: Add, rename, or remove public/member pages.
- `App Map`: Add, rename, remove, or materially change practice apps.
- `Firebase Member System`: Update auth, Firestore, invite, role, or emulator behavior.
- `Exercise Data Architecture`: Update JSON/CSV/script workflow or schemas.
- `LocalStorage Admin Keys`: Add or remove browser storage keys used by the site.
- `Known Notes`: Record current limitations, pending decisions, and browser-local vs shared-production behavior.
- `Git and Deployment Rules`: Update only when the user explicitly changes their workflow preference.

Writing rules for this file:

- Prefer current-state facts over vague history.
- Use absolute dates.
- Name exact files and keys.
- Keep instructions practical enough that another model can act without chat history.
- Do not store secrets, private credentials, or one-time tokens here.

## Change Log

### 2026-05-30

- Updated Google Apps Script to support multi-tab routing (Contacts, Assessments, Feedback) and rich HTML templated emails.
- Adjusted `scroll-margin-top` for `.admin-section` in the Admin Console to prevent fixed headers from obscuring section titles when navigating.
- Added brand guideline color swatches to the Email Template editor for quick accent color selection.
- Implemented "Send test email" functionality in the Admin Console to preview custom templates in a real inbox.
- Implemented "Email Templates" editor in the Admin Console under the Engagement tab.
- Added support for editing and live-previewing the Wharton/MasterClass-styled Welcome Email.
- Templates are stored in Firestore at `settings/emailTemplates`.
- Added `getEmailTemplates` and `saveEmailTemplate` helper functions to `assets/firebase.js`.

### 2026-05-30

- Completed the "Sentence Case" standardization across all exercise titles, labels, and JSON data files (e.g., "Grocery list" instead of "Grocery List").
- Finalized the transition to the "learner-controlled submission" model for all member practice apps.

### 2026-05-30

- Standardized exercise naming across the website and documentation to use sentence case (e.g., "Grocery list" and "Issue tree builder") to align with the brand voice.

### 2026-05-29

- Reordered the Content Library tab in the Admin Console: "Data files" now appears before "GitHub setup" in both the sidebar and the main content area.
- Updated Admin Console logic to ensure the "GitHub setup" section starts collapsed by default when the tab is opened.

### 2026-05-29

- Updated the Admin Console member-management process guide in `admin/index.html`:
  - Capitalized the action text after each role label, such as `Admin:` and `Member:`.
  - Added bolded summary phrases to Method C's email sub-bullets.
  - Updated the member CSV export filename format to `YYYYMMDD - utl-members download.csv`.
- Added an Admin Tools public homepage toggle for `Find your level`:
  - Admin Console writes the live setting to Firestore `settings/publicSite.findLevelVisible`.
  - `index.html` reads that setting through `assets/firebase.js` and hides `data-public-find-level` elements when the setting is off or missing.
  - `firestore.rules` allows public reads of `settings/publicSite` while keeping settings writes admin-only.
- Updated the Admin Console content-manager default so Site & Content sections start collapsed by default.

### 2026-05-28

- Added floating "Got feedback?" widget to the entire site via `assets/feedback-widget.js`.
- Widget is a self-contained ES module. Every page loads it with a single `<script type="module">` tag before `</body>`. Script tag paths are relative to each page's depth.
- Widget is visible only when: user is signed into Firebase AND `feedbackEnabled !== false` on their Firestore user document.
- Button style: gold `#EEA320`, navy `#003366`, Roboto Mono 11px 700, border-radius 20px, fixed bottom-right 24px from edges.
- Feedback modal: white card, Playfair Display 22px heading, Lato Light 13px subheading. Captures name/email from Firebase Auth, page URL, timestamp, feedback type (6 options), and free-text description.
- Submit: POST with `mode: 'no-cors'` to the shared Apps Script endpoint. Success shows "Got it. Thank you." (Playfair italic) with gold checkmark, auto-closes after 2 s.
- Apps Script endpoint (same for all form submissions): `https://script.google.com/macros/s/AKfycbzJE--FL2kB_XDNZRnszCtlyLRPvaLAHGuF5TAOdXJk40atbvf5Y6ELuSK2B7CSLaMN/exec`
- Submissions go to a `Feedback` tab in the connected Google Sheet.
- Added `feedbackEnabled` boolean to `users/{uid}` Firestore documents. New users inherit from `authorized_members/{email}.feedbackEnabled` if pre-set, then from `settings/feedback.defaultFeedbackEnabled`, then default `true`.
- Added `settings/feedback` Firestore document with `defaultFeedbackEnabled` boolean (global default for new users).
- Updated `firestore.rules`:
  - `users/{userId}` write rule now allows admins as well as the user themselves.
  - New `settings/{docId}` rule: signed-in users may read; admins may write.
- Added 5 new exported functions to `assets/firebase.js`:
  - `getUserFeedbackEnabled()` — reads `feedbackEnabled` from the signed-in user's Firestore document.
  - `setUserFeedbackEnabled(uid, enabled)` — writes `feedbackEnabled` to `users/{uid}`.
  - `findUserUidByEmail(email)` — queries `users` by email, returns the first matching uid.
  - `getGlobalFeedbackSetting()` — reads `settings/feedback.defaultFeedbackEnabled`, defaults to `true`.
  - `setGlobalFeedbackSetting(enabled)` — writes `settings/feedback.defaultFeedbackEnabled`.
- Modified `saveUserProfile()` in `assets/firebase.js` to set `feedbackEnabled` on new user documents only, using the logic above.
- Admin panel (`admin/index.html`) updates:
  - Member edit form now includes a `Feedback widget` select with three options: Default (inherit global), Enabled, Disabled.
  - Saving writes `feedbackEnabled` to both `authorized_members/{email}` (via `authorizeMember`) and `users/{uid}` (via `findUserUidByEmail` + `setUserFeedbackEnabled`).
  - New "Global defaults" section in Site & Content tab (`section-global-defaults`) with a Firestore-backed toggle for `defaultFeedbackEnabled`.

### 2026-05-27

- Wired the visible Admin Console at `admin/index.html` to render the top-level tabs: Site & Content, Student Progress, and Member Management.
- The Admin Console keeps the existing sidebar and section design, but sidebar items are now scoped to the active top-level tab.
- Added `section-student-progress` in `admin/index.html` with a Firestore-backed progress table using `getAllMemberWorkspaceProgress()`.
- Student Progress refresh now shows loading, failure, and last-refreshed states. The Firebase helper returns authorized members even when they do not yet have saved progress.
- Moved the existing Members and Passwords sections into the Member Management tab.
- Removed the redundant `The Untaught Lessons` kicker above the left-pane Admin title.
- Restored the admin profile control in the top-right sticky admin bar, including profile details, member workspace/My results links, and Log out.
- Updated `firestore.rules` so admins can read `users/{userId}` and `users/{userId}/completed_exercises/{exerciseId}` for the Student Progress dashboard.
- Important implementation note: a previous tabbed Admin Console attempt exists in `member-login/content-config.js`, but the page loaded at `/admin/index.html` does not use that renderer. The canonical admin surface is `admin/index.html`.

### 2026-05-27

- Fixed Admin Console tab content rendering and event binding. The `bindAdminContentManager()` function now correctly applies event listeners for the content management tab, ensuring interactive elements work as expected.
- Restored the "Assessments" link in `my-results/index.html` navigation, which was inadvertently removed.

### 2026-05-27
- Implemented a tabbed interface for the Admin Console (`/admin/index.html`).
- Added a new "Student Progress" tab with a high-level table view of all members.
- The table displays member name/email, last active date, and dot indicators for video and exercise completion across Orientation, Phase 1, Phase 2, Phase 3, and Assessments.
- Added a new Firebase function `getAllMemberWorkspaceProgress()` to fetch data for the student progress table.
- Renamed `adminAccordionHtml()` to `renderContentManagerTabHtml()` and created `renderMemberManagementTabHtml()` as a placeholder.
- Removed the vertical separator ("|") between Phase 3 and Assessments in the "My Results" navigation bar.
- Removed the "Admin console" link from the "My Results" page navigation and profile menu to keep the learner record focused and uncluttered.

### 2026-05-27

- Redesigned "My Results" page (`/my-results/index.html`) to use a stage-based summary model.
- Added collapsible accordion sections for Orientation/Home, Phase 1, Phase 2, Phase 3, and TSA Assessments.
- Added video viewing progress tracking per section, mirroring the workspace lessons.
- Exercises are now grouped within their respective stages, clearly distinguishing between "Learning" (videos) and "Applying" (exercises).

### 2026-05-27

- Updated member practice apps (starting with Write to Aiko) to remove automated email triggers via Apps Script.
- Switched to a "learner-controlled submission" model: data is saved to Firestore and LocalStorage automatically upon completion, but emails are only sent when requested from the "My Results" dashboard.

### 2026-05-27

- Reworked the top of this file into an operating guide for Codex, Claude, Gemini, and future tools.
- Added `How To Use This File`, `Working Rules`, `Git and Deployment Rules`, and `Maintenance Rules` so the file can be used without prior chat history.
- Added explicit Git/GitHub preference: only commit/push when asked, stage only relevant files, push the current branch to `origin`, and do not deploy unless separately requested.
- Added Firebase/member management notes from recent work so the context file no longer stops at the 2026-05-24 localStorage-only member workspace state.

### 2026-05-26

- Added Firebase-backed member authorization and progress support in `assets/firebase.js`.
- Added Firestore collections and rules for:
  - `authorized_members`
  - `access_requests`
  - `users/{userId}`
  - `users/{userId}/completed_exercises/{exerciseId}`
- Added Google sign-in and passwordless invite helpers through Firebase Auth.
- Member login now supports Google sign-in for authorized members while preserving the local test accounts `admin/password123` and `testuser/member2026`.
- Unauthorized Google accounts are signed out and shown an active-membership invite error outside local emulator mode.
- Added first-login / missing-name prompt in the member workspace so members can set a preferred display name.
- Added admin-only member management to `admin/index.html`:
  - Add member with name, email, role, status, and Google Group Added flag.
  - Edit member name, role, status, and Google Group Added flag.
  - Remove member records.
  - Send passwordless login invites.
  - View invite log for the current admin session.
- Added `GOOGLE_GROUP_SETUP.md` documenting the manual Google Group workflow used to grant Drive-folder access to members. The admin field `googleGroupAdded` is a manual record only; it does not currently add/remove users from Google Groups.
- Added Firebase local emulator support when `localStorage.utl_use_firebase_emulators` is `"true"` or the URL includes `?emulators=true`.
- Updated member workspace nav/profile behavior to use Firebase profile/member data when available, with admin access granted by `authorized_members` role `admin` or `owner`.
- Added a `Name` field to the admin member edit form.

### 2026-05-24

- Rebuilt `member-login/index.html` as the new member learning journey dashboard instead of the previous flat tool list.
- Added `member-login/content-config.js` as the member workspace source of truth for orientation video defaults, phase lesson video slots, exercise context URLs, progress keys, shared workspace nav, shared `.ws-` scoped styles, and admin/localStorage overrides.
- Added dedicated member workspace pages:
  - `member-login/orientation.html`
  - `member-login/phase-1.html`
  - `member-login/phase-2.html`
  - `member-login/phase-3.html`
  - `admin/index.html`
- Added the new sticky member workspace nav across the new member pages with UTL white logo, phase links, My Results, Toolkit, user label, gold avatar, active gold underline, and phase done checkmarks.
- Preserved the existing local member gate pattern using `utl_member_unlocked` and the hardcoded test accounts `admin/password123` and `testuser/member2026`.
- Added phase-based progression:
  - Phase 1 is always accessible.
  - Phase 2 unlocks when all Phase 1 exercises are marked done.
  - Phase 3 unlocks when all Phase 2 exercises are marked done.
  - Unlock state is stored with `utl_p1_done`, `utl_p2_done`, and `utl_p3_done`.
- Added lesson watch state using `utl_watched_{lessonId}` and `utl_p{N}_videos_done`; exercise cards remain visible but dimmed until all lessons in that phase are watched.
- Added exercise visit and completion state using `utl_visited_{exerciseId}` and `utl_done_{exerciseId}`. Exercise cards mark visits before navigating to existing app URLs under `apps/`.
- Added `admin/index.html` as the active localStorage content manager for lesson video URLs, orientation video URL, exercise context media URLs, exercise context types, and Phase 2 / Phase 3 visibility toggles. Admin overrides use `utl_url_{lessonId}`, `utl_ctx_url_{exerciseId}`, `utl_ctx_type_{exerciseId}`, `utl_phase2_status`, and `utl_phase3_status`.
- Deprecated `member-login/admin.html`; it now redirects to `admin/index.html`.
- Added member profile dropdown behavior to the new workspace nav, including the profile label, admin link, member workspace link, and Log out action.
- Updated phase pages so exercise context blocks remain visible even while practice cards are locked until lessons are watched. Added manual Mark all watched and Reset watched controls for testing the watch/practice transition.
- Restored the original `admin/index.html` admin console design as the canonical admin surface. Added a Learning videos section there for Orientation and Phase 1 / 2 / 3 lesson URL controls while keeping `member-login/admin.html` as a redirect only.
- Linked the new Phase 2 / Phase 3 workspace unlock behavior to the existing admin visibility keys (`utl_phase2_status`, `utl_phase3_status`) so those checkboxes now govern whether unlocked phases can appear.
- Updated new phase exercise sections to match the earlier member workspace pattern: beige context accordion rows with plus/minus controls, expandable embedded context media, large white practice cards, green completion outlines, and `Open tool` / `Mark as done` or `Click to undo` actions.
- Added small checked circles and green outlines for watched lesson tiles and the active video player. Current lesson, Mark all watched, and Reset watched controls support manual testing of the watch flow.
- Restored the quiet bottom Admin link on the new member dashboard pointing to `admin/index.html`; Log out now lives in the workspace profile dropdown.
- Restored the full previous member sequence into `member-login/content-config.js`: Orientation context sections, six Phase 1 exercises, six Phase 2 exercises, four Phase 3 exercises, and the old `utl_embed_*` / `utl_p*_ex*_done` compatibility keys.
- New phase pages now read legacy admin-saved context media from `utl_embed_*` JSON first, then fall back to built-in Google Drive / Google Slides defaults. Google Drive `open?id=` and Google Slides edit URLs are rewritten into embeddable iframe URLs at render time.
- When all lesson videos in a phase are marked watched, the collapsed Watch section can now be expanded into a real rewatch player with the lesson rail still available.
- Main phase lesson videos now include `Open in full screen` links, watched lessons can be toggled back to unwatched with `Click to unwatch`, and the collapsed Watch section chevron changes between expand and collapse states.
- Moved lesson video URL controls out of the separate Learning videos admin section and into the Phase 1 / Phase 2 / Phase 3 admin sections as blue-tinted lesson video rows. Orientation remains context-only with no standalone lesson video control.
- Member workspace phase visibility now treats `utl_phase2_status` and `utl_phase3_status` as direct show/hide gates for the new phase pages and nav links. `utl_tsa_status` now controls whether the Assessments link appears in the member workspace nav and whether the dashboard renders the Assessments section.
- Simplified the phase lesson player controls by removing the Mark as Watched / Mark all watched / Reset watched action row. Learners now toggle watched state only from the small check circle on each lesson tile. Main and rewatch players show a direct `Open in a new screen` link when a lesson URL exists.
- Removed the standalone video player from `member-login/orientation.html`; Orientation is now context-only.
- Improved phase lesson player spacing: fullscreen links now sit in their own padded row, lesson rails have more top/bottom padding, lesson tiles have wider gaps and internal right padding, and rewatch panels include more breathing room around the player and tile rail.
- Orientation now defaults `Your first day at MA` to expanded on first load while keeping `How this program works` collapsed.
- Completed phase video sections now use a blue-tinted play icon plus the same gold +/- control style used by context accordions.
- Admin lesson video rows now use the same six-dot drag handle as context/app rows, can be reordered within each phase, and save order to `utl_lesson_order_{phaseId}`. Phase pages read that saved order when rendering lesson videos.
- Added additional spacing between each phase admin action row and the first lesson video box.
- Updated the member workspace profile dropdown so Admin appears in its own `Admin access` section for admin users, separated from normal navigation and Log out. Logging out now clears the local admin access flag as well as the member session.
- Left existing `apps/` practice files untouched. Phase pages link to existing app URLs from `content-config.js`.

### 2026-05-18

- Split Orientation section in `member-login/index.html` into two separate accordions: `Your first day at MA` (Welcome to MA storyline, shown first) and `How this program works` (UTL workbook orientation FAQs, shown second). Both start collapsed. Both use the gold square +/- accordion icon.
- Restructured Phase 2 section in `member-login/index.html` to fully vertical stacked layout. Each exercise now has its own context accordion immediately above it.
- Updated all Phase 2 context accordion labels to narrative-driven names aligned with the MA storyline.
- Removed side-by-side card layout for Explain to Aiko (120s) and Explain to Aiko (60s). Both are now full-width stacked cards.
- Phase 2 exercises 1-6 are live and use the same Mark as Done workflow: Issue Tree Builder, SCQA Builder, Advisory board with AI, Write to Aiko, Explain to Aiko (120s), and Explain to Aiko (60s).
- Phase 2 localStorage keys: `utl_p2_ex1_done`, `utl_p2_ex2_done`, `utl_p2_ex3_done`, `utl_p2_ex4_done`, `utl_p2_ex5_done`, and `utl_p2_ex6_done`. Sequential unlock runs through exercises 1-6.
- Restructured Phase 3 section in `member-login/index.html` to fully vertical stacked layout. Each exercise has its own context accordion immediately above it.
- Phase 3 exercises 1-4 are live and use the same Mark as Done workflow: The Art of Saying No, I Have Bad News..., Let's Switch Hats, and Speak Like Obama.
- Phase 3 context accordion labels: You just got the lead role / You have to be the one to say it / Read the room before you speak / All eyes are on you.
- Phase 3 exercise titles: The Art of Saying No / I Have Bad News... / Let's Switch Hats / Speak Like Obama.
- Added per-accordion embed management to admin panel. Each context accordion has a URL input and type selector (Google Slides or Google Drive Video). Embed config saved to localStorage using `utl_embed_[id]` keys. Renders as iframe on participant page on load.
- Added site sync check section to admin panel. Checks accordion IDs, exercise titles, app paths, localStorage keys, and embed keys against expected values. Triggered on demand via Run check button.
- Improved site sync check controls with clearer Run, Rerun, and Hide results actions plus a summary count after each check.
- Added Visibility section to admin panel showing Phase 1, Phase 2, Phase 3, and admin-mode visibility status from the current localStorage completion state.
- Admin Visibility section is organized as a checklist grouped by Main Page, Member Workspace, and Admin Preview. It controls `utl_public_find_level`, `utl_mission_card`, `utl_phase1_status`, `utl_phase2_status`, `utl_phase3_status`, `utl_tsa_status`, and `utl_admin_preview_bypass` with plain-language labels.
- Added admin preview bypass toggle in the Visibility section. When on, the preview link opens the member hub with `?mode=admin` and the member hub treats bypass as active in the same authenticated admin browser; when off, it opens the normal participant sequence.
- Added individual admin view toggles for The Diagnostic and The Checkpoint assessment cards, with Live, Coming soon, and Hidden states.
- Added a `Set ready assessment apps live` shortcut in the admin Assessments section to restore the overall section, Diagnostic card, and Checkpoint card to Live when older browser settings still hold placeholder values.
- Added quick links for Diagnostic and Checkpoint hubs plus ready TSA exercise apps: Sort & Bucket, Spot the Problem, and Speak Concisely.
- Created `apps/advisory-board/index.html` — Phase 2 advisory board app. 5 screens: Your Work (pre-filled Olympics example, copy-per-section + copy-all), Build Your Board (orchestrator education copy, 8 preset personas + custom card, orchestrator selection), Generate Prompt (Mode A: assembled board prompt, Mode B: AI board design prompt), Capture Insights (paste and parse output, orchestrator verdict card), Save Your Board (localStorage persistence with pre-select on return). CSS prefix: `ab-`.
- Created `apps/toolkit/index.html` — cross-program AI prompt reference. 5 tool cards: MECE Checker, Problem Breakdown, SCQA Sharpener, Decision-Ready Email, Advisory Board (Mode A/B toggle). Member area only. CSS prefix: `tk-`.
- Created `apps/write-to-aiko/index.html` — Phase 2 answer-first email exercise. Two-column SCQA reference and writing area, structured/open writing modes, live timer and word count, sample answer toggle, and Apps Script submit flow. CSS prefix: `write-to-aiko-`.
- Created `apps/explain-to-aiko/index.html` — Phase 2 120-second spoken explanation exercise. Reuses TSA Speak recording/transcription structure, with email reference on the left and talking-points prep on the right. Target: 120 seconds / 220-260 words.
- Created `apps/explain-to-aiko-60/index.html` — Phase 2 60-second compression exercise. Same broad recording/transcription structure as the 120-second version, shortened instructions, target 60 seconds / 110-130 words, and completion message congratulating the learner on delivering an elevator pitch.
- `apps/explain-to-aiko/index.html` saves the latest talking-points prep to `utl_explain_to_aiko_120_prep`; `apps/explain-to-aiko-60/index.html` preloads that prep by default.
- Created `apps/eisenhower-matrix/index.html` — Phase 3 Eisenhower Matrix practice app for The Art of Saying No. Six scenarios, desktop drag/drop, mobile tap-to-select, example placement reveal, and try-again reset.
- Added Phase 3 sequential completion state for the four live Phase 3 apps using `utl_p3_ex1_done`, `utl_p3_ex2_done`, `utl_p3_ex3_done`, and `utl_p3_ex4_done`. The member workspace uses the same green outline, done pill, lock hint, and next-app unlock behavior as Phase 1 and Phase 2. Admin includes Phase 3 completion toggles and visibility status for the checkpoint nudge.
- Added workbook slide-link defaults to `member-login/index.html` so pre-app context accordions load their Google Slides embeds even when admin/localStorage has no saved URL. Existing saved admin URLs still override defaults.
- Updated member workspace slide embed URLs to preserve the `slide=` anchor from Google Slides links.
- Added `Back to member workspace` links to recording/transcript pages: TSA Speak assessment recordings return to `#assessments`, Rushed Voice Memo with AI returns to `#phase1`, and both Explain to Aiko recording pages return to `#phase2`.
- Added three tool links to `member-login/index.html`: Advisory Board, Toolkit, Write to Aiko.
- Renamed the Phase 2 advisory app to `Advisory board with AI` in the app header and member workspace card.
- Reordered `apps/advisory-board/index.html` so it starts with a Q&A introduction to virtual boards and orchestrators, then shows example work, board selection, prompt generation, output capture, and saved board flow.
- Updated `apps/tsa-speak/index.html` so the role selector matches the contact gate input height and valid details allow the assessment to start even if lead capture cannot reach the Apps Script endpoint.
- Added Mark as Done buttons and sequential completion state to Phase 2 exercises 3 and 4: Advisory board with AI and Write to Aiko. Admin sync and phase visibility checks now track `utl_p2_ex3_done` and `utl_p2_ex4_done`.
- Moved Toolkit out of the Phase 2 exercise sequence and into its own bottom-level `#toolkit` section in the member workspace. Added Toolkit to the sticky nav as a destination link to the right of My results.
- Updated the member workspace sticky nav so phase links stay left, Assessments / My results / Toolkit sit as a right-aligned utility group, and vertical dividers separate the phase group and Log out. Utility active state now uses filled navy styling.
- Updated Orientation and Phase 1 / 2 / 3 active nav states to use a gold underline while keeping utility links on the filled navy active style.
- Created `apps/grocery-list-ai/index.html` — Phase 1 AI practice app. Four-screen flow: storyline + copyable supply list, prompt-angle selection, reflection response, and takeaway. Reuses the Grocery List app header/timer/screen pattern and Messy Notes open-response styling.
- Refined `apps/grocery-list-ai/index.html` so the supply list and prompt choices appear together on the first screen. Each copied prompt now includes the full supply list in a clearer structured format, and Back buttons support easier navigation between screens.
- Updated Grocery List with AI prompt cards to use BSP-style section labels, ordered the prompts as Setup Sequence / Ownership / AI-created structure, and added a GenAI-created MECE bucket prompt.
- Updated all Grocery List with AI prompt list items so each point starts with a bolded summary phrase, reinforcing BSP writing inside the prompts themselves.
- Removed footer link toggle from admin panel. Admin footer link is now always visible. Removed any show/hide logic tied to it.
- Added automatic phase visibility gating. Phase 2 hidden until all 6 Phase 1 live exercises marked done. Phase 3 hidden until Phase 2 exercises 1-6 marked done. Admin mode bypasses all phase gating. Brief gold reveal message shown on phase unlock.
- Updated mark as done button label in done state from Marked as done to Click to undo across all phases.

### 2026-05-17

- Resized context accordion rows in member workspace — 24px icon, 13.5px label, slightly smaller than exercise cards.
- Added gold/green/locked border states to Phase 1 exercise cards.
- Added Mark as Done toggle button to each exercise card. Saves to localStorage (`utl_p1_ex[N]_done`). Toggling undone reverses all states and re-locks the next exercise if not yet completed.
- Exercise gating: Phase 1 exercises unlock sequentially as each is marked done. State restored on page load from localStorage.
- Matched Phase 2 and Phase 3 context accordions and app cards to the Orientation and Phase 1 workspace pattern.

### 2026-05-13

- Added `admin/index.html` as a static localStorage-powered configuration panel:
  - Password-gated with default password `utl2026_admin`.
  - Controls member hub mission card visibility, footer admin link visibility, TSA Score™ status, phase lock states, slide URLs, and member/admin passwords.
  - Provides quick links to the member hub, My results, and all current member apps.
  - Password fields and login gates include an on-brand eye toggle to show or hide password values.
- Updated `member-login/index.html` to read admin configuration from localStorage:
  - Slim navy identity bar added above the sticky member navigation.
  - Sticky section nav now follows Orientation, Phase 1, Phase 2, Phase 3, and My results.
  - Phase 2 and Phase 3 default to locked until changed in the admin panel.
  - TSA Score™ section replaced by contextual Diagnostic and Checkpoint prompt cards.
  - Footer now includes a prominent My results link and quiet Admin link.
- Created `my-results/index.html`:
  - Participant exercise record with assessment section, phase-by-phase exercise cards, progress bar, copy to workbook, download, and send-to-instructor action.
  - Reads `utl_result_*` keys from localStorage and has no password gate.
- Added standardized local result saving to active practice apps:
  - Grocery List, Manager's messy notes, Rushed voice memo, Rushed voice memo with AI, Chalkboard notes, Issue tree builder, and SCQA builder.
  - Completion screens now include a saved-on-this-browser notice with a link to My results.
- Added Send to instructor controls to the admin panel:
  - `utl_send_instructor` controls button visibility.
  - `utl_send_instructor_url` stores the Apps Script endpoint for future result submission.
- Added Assessments section to the member hub:
  - `#assessments` contains The Diagnostic and The Checkpoint cards with timing instructions and context chips.
  - Sticky nav now includes Assessments and My results as matched destination links.
  - Standalone checkpoint prompt after Phase 3 was replaced by a lightweight one-line nudge linking to `#assessments`.
  - Admin sidebar label changed from TSA Score™ to Assessments.
- Added configurable Google Slides behavior:
  - Slide context rows remain collapsed by default.
  - Saved Google Slides URLs replace placeholders with embedded iframe blocks.
  - Missing URLs continue to show `Slides coming soon`.

### 2026-05-12

- Redesigned `member-login/index.html` as a structured member hub:
  - Added sticky section navigation for Orientation, Phase 1, Phase 2, and Phase 3.
  - Added an MA mission card positioning the member as Chief of Staff to Aiko Mori.
  - Added optional TSA Score™ bookends before the workbook sections.
  - Organised all workbook content into interleaved context slide blocks and exercise cards.
- Restyled member hub app cards to match the previous large workbook-card design:
  - Gold top border.
  - Roboto Mono phase label.
  - Playfair Display navy app title.
  - Larger description text.
  - Gold `Open tool` CTA treatment.
- Added the Google Slides embed pattern for member hub context blocks:
  - 16:9 iframe wrapper.
  - Full-screen link below each embed.
  - Placeholder slide URLs pending actual published deck links.
- Added the published Google Slides embed URL for the member hub Orientation section.
- Updated member hub slide blocks so live iframe blocks and placeholder slide blocks start collapsed and open from the slide context bar toggle.
- Added alternating white and parchment backgrounds to member hub content sections while keeping exercise cards white.
- Reinforced the public `tsa-score.html` Find Your Level CTA so it renders as a gold button rather than a plain text link on deployment.
- Created `apps/rushed-voice-memo/index.html`:
  - Based on the Messy Notes app.
  - Phase 1, Think Clearly.
  - Uses Current status, Key blockers, and Next steps as structured response sections.
- Created `apps/rushed-voice-memo-ai/index.html`:
  - Based on the TSA Speak app.
  - Phase 1, Think Clearly.
  - Adds the AI transcription flow, transcript entry, time fields, and collapsible AI structuring prompt.
- Created `apps/chalkboard-notes/index.html`:
  - Based on the Messy Notes app.
  - Adds the chalkboard image placeholder block.
  - Uses Current state, Ideal state, and Roadblocks as structured response sections.
- Moved Grocery List from an orientation warm-up position into the Phase 1 exercise sequence.

### 2026-05-11

- Restructured the member dashboard so the core section order is:
  - 1. TSA Score™.
  - 2. Orientation.
  - 3. Workbook A, Think Clearly.
  - 4. Workbook B, Speak Concisely.
  - 5. Workbook C, Act Confidently.
  - More Tools remains below the core five sections.
- Created `apps/find-your-level/index.html` as a public email-gated Sort & Bucket exercise:
  - Uses the shared app header pattern with Think Clearly / Find Your Level.
  - Collects name, email, optional role, and `What brings you here?` before the exercise starts.
  - Sends lead submissions with `source: "find-your-level"`.
  - Loads `sort_bucket_001` from `data/sort-bucket.json`.
  - Scores bucket labels and item placement out of 20, converts the result to a percentage, and shows the result immediately.
  - Sends assessment result payloads with `assessment_type: "find-your-level"` for the future Assessments tab.
- Created `data/sort-bucket.json` as the root-level public Sort & Bucket question bank:
  - Contains all six Sort & Bucket variations with stable `exercise_id` values.
  - Includes scenarios, prompts, correct buckets, label word banks, label equivalents, dual-bucket items, item answer keys, and scoring metadata.
- Updated `tsa-score.html`:
  - Replaced the hero and description copy with the shorter Find Your Level positioning.
  - Added a prominent public CTA to `apps/find-your-level/index.html`.
  - Locked The Diagnostic and The Checkpoint cards to member access only.
  - Removed public routing from the Diagnostic and Checkpoint cards.
- Updated contact form payloads:
  - Homepage and contact page Get in Touch submissions now include `source: "contact-form"`.
  - Find Your Level submissions use `source: "find-your-level"`.
  - Contact form message fields are visibly labeled `What brings you here?` and submit through the `message` payload field.
- Restored `apps/tsa-diagnostic/index.html` and `apps/tsa-checkpoint/index.html` as assessment hub pages:
  - Diagnostic now routes to Sort & Bucket, Spot the Problem, and Speak Concisely.
  - Checkpoint now routes to checkpoint-mode Sort & Bucket, Spot the Problem, and Speak Concisely.
  - Act Confidently is separated into its own Section 3 block instead of appearing inside Speak Concisely.
  - Both hubs show completion status and score summaries from browser storage.
  - Act Confidently remains marked as coming soon.
- Bumped the `tsa-score.html` stylesheet cache key and tightened the public Find Your Level CTA styling so deployed versions render it as a gold button with white text.
- Updated `apps/find-your-level/index.html` so participants go directly into the combined Sort & Bucket workspace:
  - Removed the separate first bucket-naming step from the user flow.
  - Moved bucket label dropdowns into the three bucket columns.
  - Matched the workspace more closely to the Grocery List drop-zone look and feel.
- Added a site-wide session contact profile:
  - Public lead forms store contact details in `sessionStorage` after successful submission.
  - Find Your Level reuses that profile and skips its gate during the same browser session.
  - TSA Sort & Bucket, Spot the Problem, and Speak Concisely reuse the same session profile and skip repeat contact gates.
- Standardized role capture across all contact-style forms:
  - Find Your Level and TSA assessment gates now use the same role dropdown pattern as the main contact forms.
  - Shared options are Student, Professional, Manager, and Other.
- Updated `tsa-score.html` How It Works section to describe only the public Sort & Bucket exercise.
- Updated `programs.html` What People Say section to use the real testimonial source instead of placeholder workshop quotes.
- Migrated testimonials from `assets/testimonials.js` into `data/testimonials.json`:
  - Removed `assets/testimonials.js`.
  - Homepage now fetches testimonial JSON at page load and fills `#testimonialRowOne` and `#testimonialRowTwo`.
  - Programs page now fetches the same JSON and renders the first six real testimonials.
  - Testimonial fields are `quote`, `name`, `title`, and `company`.
- Google Sheet operations requested for this release are pending reconnection of the Google Drive connector:
  - Rename the sheet to `[Website] UTL leads and assessments`.
  - Add the `Assessments` tab.
  - Add a `source` column to the contacts tab if missing.
- Updated TSA Sort & Bucket scoring and data after panel testing:
  - Added `labelEquivalents` to all `data/tsa/sort-bucket.json` exercise sets so semantically correct bucket labels can receive credit.
  - Replaced four ambiguous Sort & Bucket items and added replacement audit notes in the JSON.
  - Added a `dualBucket` rule for `Debate over office layout` in `sort_bucket_001`.
  - Updated `apps/tsa-sort-bucket/index.html` scoring so label scoring uses JSON equivalents and placement scoring respects dual-bucket items.
- Added a lightweight content-management import/export structure:
  - New `/csv/tsa/` folder for TSA assessment CSV exports.
  - New `/csv/practice/` folder for member-area practice CSV exports.
  - New `/scripts/` folder for developer-only utility scripts.
  - Added `scripts/import-exercise-data.js` as a plain Node.js CSV-to-JSON import scaffold.
  - Added README files documenting the Google Sheets → CSV → script → JSON → commit → deploy workflow.
  - The production website continues to fetch JSON only and never reads CSV or Google Sheets directly.
- Refactored TSA assessment content into shared JSON:
  - New files under `data/tsa/`: `sort-bucket.json`, `spot-the-problem.json`, `speak-concisely.json`, and `act-confidently.json`.
  - TSA apps now fetch assessment sets, prompts, answer keys, topic details, and scoring metadata from JSON before rendering.
  - Diagnostic and Checkpoint continue to share the same TSA exercise data sources through query parameters.
  - Existing contact gates, scoring logic, storage keys, answer reveal, copy results, email results, routing, and mobile tap interactions were preserved.
- Refactored member practice content into shared JSON:
  - New files under `data/practice/`: `grocery-list.json`, `messy-notes.json`, `issue-tree-builder.json`, and `scqa-builder.json`.
  - Practice apps now load item banks, prompts, templates, sample answers, reflection prompts, timer metadata, and scoring metadata from JSON.
  - Apps currently load the first practice variation by default so future variation selectors can be added without changing the data model.
- Added loading and error handling for JSON-powered apps:
  - Apps show a simple loading state while data is fetched.
  - Apps show a user-friendly error if the JSON file is missing, malformed, or empty.
- Updated the implementation rule:
  - Future exercise variations should be added to `/data/tsa/` or `/data/practice/`, not hardcoded into app `index.html` files.

### 2026-05-09

- Reworked the Diagnostic into a hub:
  - `apps/tsa-diagnostic/index.html` now shows all Diagnostic sections before participants enter individual exercises.
  - Existing Sort & Bucket exercise moved to `apps/tsa-sort-bucket/index.html`.
  - Diagnostic Section 1 links only to Sort & Bucket.
  - Diagnostic Section 2 links only to the Speak Concisely Short Talk assessment.
  - Diagnostic Section 3 links to the Act Confidently Difficult Conversation placeholder.
  - Diagnostic scorecard starts hidden and uses an eye icon button to reveal or hide scores.
- Connected Speak Concisely as the active Section 2 Exercise A in the Checkpoint hub.
- Clarified the TSA Spot the Problem score screen:
  - The scorecard now separates Exercise B overall score from Part A, Find the Overlaps, and Part B, Fix the Gaps.
  - The combined Think Clearly scorecard labels Exercise A, Sort & Bucket, and Exercise B, Spot the Problem, explicitly.
  - Removed the return link back to Sort & Bucket from the final Spot the Problem score screen.
- Added an Email Results action to the Spot the Problem score screen:
  - Uses the participant email saved from the TSA contact gate.
  - Opens a branded email draft with Exercise A, Exercise B, part scores, combined score when available, and links back to the site.
  - Keeps the site static by using a browser `mailto:` flow rather than adding backend email code.
- Improved the TSA Checkpoint hub:
  - The hub shows a scorecard below the exercise cards when Exercise A or Exercise B has been completed.
  - Partial progress is shown clearly when only one exercise is complete.
  - Completed exercise cards now show the score directly inside the card and expose a Retake Exercise A or Retake Exercise B button.
  - TSA exercise results are saved to both `sessionStorage` and `localStorage` so completion is still visible when participants return to the Checkpoint hub in the same browser.
  - The Checkpoint hub now stays visually clean before any exercise is completed. The scorecard appears below the exercise cards only after at least one assessment has been taken.
  - The Think Clearly total is visually emphasized above the individual exercise score boxes.
  - Removed separate View scorecard buttons because the scorecard already appears directly below the exercise cards.
- Added a Part 2 Speak Concisely placeholder:
  - New file: `apps/tsa-speak-concisely/index.html`.
  - The Checkpoint hub includes a Part 2 card linking to the placeholder.
  - The Sort & Bucket score screen now continues to the Speak Concisely placeholder instead of Spot the Problem.
- Reorganized the Checkpoint hub into three TSA sections:
  - Section 1, Think Clearly, contains Exercise A Sort & Bucket and Exercise B Spot the Problem.
  - Section 2, Speak Concisely, includes Exercise A and Exercise B placeholder cards.
  - Section 3, Act Confidently, includes Exercise A and Exercise B placeholder cards.
- Added `apps/tsa-act-confidently/index.html` as the Act Confidently placeholder.
- Updated `tsa-score.html` assessment details so The Diagnostic and The Checkpoint are described as three sections, with Checkpoint noting Part A/B exercises.

### 2026-05-08

- Redesigned TSA Spot the Problem into a two-part assessment:
  - Part A, Find the Overlaps, uses a gold workspace where participants move duplicate ideas back to the left across three randomly selected problems.
  - Part B, Fix the Gaps, uses a steel blue workspace where participants move missing items into the correct buckets across three randomly selected problems.
  - The exercise now uses a Grocery List style left-list and right-bucket layout with drag/drop and mobile tap movement.
  - The top-right topic box was removed because the topic already appears in the section title.
  - Results are stored in `sessionStorage` under `tsa_spot_score`.
  - The score screen includes a button back to the Checkpoint hub.
- Updated TSA Checkpoint from a placeholder into a two-exercise hub:
  - Sort & Bucket.
  - Spot the Problem.
  - Checkpoint links pass `?assessment=checkpoint` so the shared exercise pages can distinguish Checkpoint submissions from Diagnostic submissions.
  - The Checkpoint hub reads `tsa_sort_score` and `tsa_spot_score` from session storage and marks completed exercises.
  - The Checkpoint hub shows available scores for each exercise and a combined Part 1 total when both are complete.
- Updated TSA assessment set labels to show only the exercise name, not `Set #`.
- Copied the clearer Sort & Bucket drop-zone affordance into the Grocery List app:
  - Empty buckets now show `Drop or tap items here.`
  - Bucket interiors use a dashed drop-zone treatment.
  - Selected or drag-hover targets get the gold highlight treatment.
- Improved TSA Diagnostic Sort & Bucket instructions and visual affordance:
  - The set name now appears as quiet utility context instead of a button-like chip.
  - Instructions now explain the scan, label, and sort flow in a concise paragraph.
  - Bucket columns now use white cards with dashed drop zones and empty-state guidance.
- Refined TSA Diagnostic Sort & Bucket so participants see the item list while selecting bucket labels. The exercise now uses one grocery-list-style workspace with the unplaced list on the left and three bucket columns on the right.
- Built TSA Diagnostic Part 1 assessment files:
  - `apps/tsa-sort-bucket/index.html` for Exercise A, Sort & Bucket.
  - `apps/tsa-spot-the-problem/index.html` for Exercise B, Spot the Problem.
- Added contact gates to both TSA Diagnostic Part 1 files using the existing Google Apps Script endpoint.
- Added session storage behavior for TSA Diagnostic Part 1:
  - `tsa_gate_complete` keeps the gate hidden within the same session.
  - `tsa_sort_score` passes the Sort & Bucket score into Spot the Problem.
- Added Type 1 auto-scoring, answer reveal, copy-results behavior, and Part 1 combined scoring for the Think Clearly assessment.
- Added the `Find Your Level` active nav state consistently across Home, About, Programs, Contact, and Find Your Level.
- Added trademark usage rules for `TSA Score™`, `C³ Rubric™`, and the then-current standalone program title.
- Created `tsa-score.html`, a standalone TSA Score™ routing page for The Diagnostic and The Checkpoint.
- Added homepage TSA Score™ teaser after the three learning pillars.
- Added `Find Your Level` navigation link across the public site.
- Created placeholder assessment apps:
  - `apps/tsa-diagnostic/index.html`
  - `apps/tsa-checkpoint/index.html`
- Created this living website context document.

### 2026-05-06

- Wired homepage `Get in Touch` form to Google Apps Script.
- Confirmed submissions are writing into the connected Google Sheet.
- Added `page` URL to the form payload so the final sheet column shows where the lead came from.
- Updated testimonial display so titles and company names are separated, with titles italicized and company names styled separately.
- Set testimonial company name to black because all current testimonials are from Uber.

### 2026-05-05

- Standardized app headers across practice tools with the UTL logo, phase label, exercise title, timer, and utility controls.
- Updated timers across apps to use icon controls and an eye icon for hiding or showing elapsed time.
- Fixed Manager's Messy Notes three-section response mode.
- Updated Issue Tree Builder preload behavior so it does not fill all later pages automatically.
- Updated Issue Tree Builder word count so it changes when users move from box to box.
- Updated favicon to the current blue background and thicker white door asset.

### 2026-05-04

- Added and refined Phase 1 and Phase 2 practice apps.
- Added supporting detail structure to Issue Tree Builder.
- Updated desktop and mobile layouts for Issue Tree Builder.
- Added member login landing page access to practice apps.
- Added logo and favicon consistency across app pages.

## Site Overview

The Untaught Lessons is a static HTML, CSS, and JavaScript website for teaching practical skills around thinking clearly, speaking concisely, and acting confidently.

The site is intentionally lightweight:

- No custom backend application code in the repo.
- No npm packages.
- No build process.
- No framework.
- Pages run directly in the browser through static hosting.
- Firebase Auth and Firestore are used from the browser for member authorization, member management, and progress persistence.

Primary local preview URL and server command are listed in `Git and Deployment Rules`.

## Brand System

### Fonts

- Headings: `Playfair Display`
- Body: `Lato`
- Labels and utility text: `Roboto Mono`

### Colors

- Navy: `#003366`
- Gold: `#EEA320`
- Cream: `#F3EDE2`
- Charcoal: `#4A4A4A`
- Steel: `#4D7094`
- White: `#FFFFFF`

### Logo Assets

- Main site logo: `assets/logo.png`
- App header white logo: `assets/utl-logo-nav-white.png`
- Legacy or alternate white logo asset: `assets/[Logo] The Untaught Lessons - white text - transparent.png`

### Favicon

Current favicon:

```text
assets/favicon-bluebg-whitedoor-thicker-32.png
```

Most pages reference it with `?v=6` for cache busting.

### Trademark Rules

Use the trademark symbol on first use on each page or distinct section:

- `TSA Score™`
- `C³ Rubric™`

Use `Think, Speak, and Act Like an Executive` when referring to the program name.

Do not add `™` when Think, Speak, and Act appear as individual headers, labels, or pillar names.

## Shared Design Patterns

### Public Site Navigation

Most public pages use the newer `site-nav` pattern:

- Logo on the left.
- Primary links in the center or right.
- `Find Your Level` nav item before `Member Login`.
- `Member Login` as a secondary button.
- `Get in Touch` as a primary gold button.
- Mobile hamburger menu through `.nav-toggle` and `.nav-menu.is-open`.

Current active page state:

```html
class="nav-link-active"
aria-current="page"
```

The active nav item gets a gold underline.

### Footer

Most public pages use `.site-footer`:

- Logo
- Short tagline
- Footer nav links
- Copyright line

### App Header

Practice apps use a navy sticky header:

- UTL white logo on the left.
- Logo links back to the homepage.
- Divider after the logo.
- Phase label in Roboto Mono gold.
- Exercise title in Playfair Display white.
- Timer and utility controls on the right.

### Timer Pattern

Current timer design:

- `Elapsed Time` label in gold.
- Time display in white Roboto Mono.
- Eye icon beside the label to hide or show the visible time.
- Pause, play, and reset icon controls.
- Hiding the time does not pause the timer.

### Buttons

- Primary public CTAs often use gold background with navy text.
- Secondary public CTAs often use navy outline or white/transparent variants.
- App controls use compact icon buttons in the navy header.

### Cards

Public site cards generally use:

- White background.
- Subtle border.
- Small radius, usually 4px to 12px depending on context.
- Soft shadow.
- Gold accents for labels, top borders, or dividers.

## Exercise Data Architecture

Exercise content is stored outside app HTML files in shared JSON files. Static apps fetch these files with relative paths, so the site still works with:

```bash
python3 -m http.server 8061 --bind 127.0.0.1
```

and remains compatible with Cloudflare Pages static hosting.

### Editing Pipeline

Google Sheets can act as the human editing layer, but it is not a runtime dependency.

The content workflow is:

```text
Google Sheets → CSV → script → JSON → commit → deploy
```

Folder roles:

- `csv/tsa/`: Holds Google Sheets CSV exports for TSA assessment exercises.
- `csv/practice/`: Holds Google Sheets CSV exports for member-area practice apps.
- `scripts/`: Holds developer-only utility scripts, including `scripts/import-exercise-data.js`.
- `data/`: Holds production JSON fetched by the website at runtime.

Runtime rule:

- The website should never fetch Google Sheets directly.
- The website should never fetch CSV files directly.
- Browser pages should fetch only static JSON from `data/tsa/` and `data/practice/`.

Importer status:

- `scripts/import-exercise-data.js` is a plain Node.js scaffold.
- It reads CSV files recursively from `csv/tsa/` and `csv/practice/`.
- It detects missing CSV files, skips empty files, parses CSV safely, validates basic columns, and logs clear status.
- Most schema-specific CSV-to-JSON converters are TODO placeholders until the Google Sheets tab schemas are finalized.

### TSA Assessment Data

TSA assessment content lives in:

```text
data/tsa/
  sort-bucket.json
  spot-the-problem.json
  speak-concisely.json
  act-confidently.json
```

Public Find Your Level content lives in:

```text
data/sort-bucket.json
```

This root-level file is intentionally separate from the member TSA assessment JSON because the public Find Your Level app locks to one public variation, `sort_bucket_001`, while still preserving the full six-exercise Sort & Bucket question bank for future reuse.

Use TSA JSON for assessment content, answer mappings, scoring metadata, diagnostic/checkpoint reuse, and future analytics fields.

Current app data sources:

- `apps/find-your-level/index.html` fetches `../../data/sort-bucket.json` and locks to `sort_bucket_001`.
- `apps/tsa-sort-bucket/index.html` fetches `../../data/tsa/sort-bucket.json`.
- `apps/tsa-spot-the-problem/index.html` fetches `../../data/tsa/spot-the-problem.json`.
- `apps/tsa-speak/index.html` fetches `../../data/tsa/speak-concisely.json`.
- `apps/tsa-act-confidently/index.html` fetches `../../data/tsa/act-confidently.json`.

TSA JSON should contain content and answer metadata only. Scoring logic, rendering, storage, contact gates, routing, drag/drop, mobile tap behavior, and email/copy results stay in the app JavaScript.

Sort & Bucket schema notes:

- Array of sets.
- Each set should include `id`, `title`, `difficulty`, `tags`, `prompt`, `scenario`, `sortingInstruction`, `items`, `bucketOptions`, `correctBuckets`, `answerKey`, and `scoring`.
- `answerKey` maps each correct bucket label to the list of item text strings that belong there.

Spot the Problem schema notes:

- Array of sets.
- Each set includes `partA` and `partB`.
- `partA` contains `topic`, `buckets`, and `overlaps`.
- `partB` contains `topic`, `leftItems`, `buckets`, and `answers`.

Speak Concisely schema notes:

- Array of topics.
- Each topic includes `id`, `number`, `category`, `title`, `scenario`, `points`, `keyMessages`, `difficulty`, `tags`, and optional `timeLimitSeconds`.

### Practice App Data

Practice content lives in:

```text
data/practice/
  grocery-list.json
  messy-notes.json
  issue-tree-builder.json
  scqa-builder.json
```

Use practice JSON for practice variations, prompts, sample answers, templates, reflection prompts, timer defaults, difficulty tags, and item banks.

Current practice app data sources:

- `apps/grocery-list/index.html` fetches `../../data/practice/grocery-list.json`.
- `apps/messy-notes/index.html` fetches `../../data/practice/messy-notes.json`.
- `apps/issue-tree-builder/index.html` fetches `../../data/practice/issue-tree-builder.json`.
- `apps/scqa-builder/index.html` fetches `../../data/practice/scqa-builder.json`.

Practice apps currently load the first variation in each JSON file. Add future variations as additional array entries. Do not add new exercise content directly to app HTML unless it is generic placeholder UI copy.

Practice JSON schema notes for future Google Sheets export:

- Keep stable `id` fields for each variation.
- Include `title`, `difficulty`, `phase`, `tags`, `prompt`, and `timerMinutes`.
- For sample answers, prefer structured arrays over long strings so they can map cleanly into sheet rows later.
- Grocery: `itemBank`, `keywords`, `idealLabels`, `generation`, `sampleAnswer`, `reflectionPrompts`.
- Messy Notes: activity config fields plus `sampleAnswer`, `checklist`, `scoring`, and `reflectionPrompts`.
- Issue Tree: `problemStatement` and `sampleAnswer.arguments`.
- SCQA: `context`, `topicLabel`, and `sampleAnswers`.

## Firebase Member System

Firebase project:

```text
the-untaught-lessons
```

Shared Firebase client:

```text
assets/firebase.js
```

Purpose:

- Supports Google sign-in, passwordless email-link invites, authorized member lookup, Firestore member records, and progress saves.
- Keeps the website static. There is still no custom server in this repo.

Core Firestore collections:

- `authorized_members/{email}`: Source of truth for who can enter the member workspace with Google sign-in. Email document IDs are normalized lowercase addresses.
- `access_requests/{email}`: Stores public/member access requests for admin review.
- `users/{userId}`: Stores per-user workspace profile/progress data.
- `users/{userId}/completed_exercises/{exerciseId}`: Stores per-exercise completion records.
- `settings/feedback`: Global site settings document. Currently stores `defaultFeedbackEnabled` (boolean, default `true`).

Authorized member fields currently used:

- `email`
- `name`
- `role`: `member`, `admin`, or `owner` are the important roles. Some admin UI labels may display `member` as `user`.
- `status`: usually `active`.
- `googleGroupAdded`: manual flag showing whether the person has been added to the Google Group for Drive access.
- `feedbackEnabled`: optional boolean. If set before a member's first login, it is copied into `users/{uid}` at first sign-in. If absent, the global `settings/feedback.defaultFeedbackEnabled` is used instead.
- `addedAt`
- `updatedAt`

User document fields (`users/{uid}`) currently used:

- `email`, `displayName`, `photoURL`, `role`
- `lastSeenAt`, `updatedAt`
- `workspaceProgress`: nested object of exercise progress.
- `feedbackEnabled`: boolean. Controls whether the floating feedback widget is shown. Set at first login; can be overridden by admin from the Members tab.

Auth behavior:

- Member login supports Google sign-in for emails that exist in `authorized_members`.
- Local test accounts are still supported for development and quick checks:
  - `admin/password123`
  - `testuser/member2026`
- Outside localhost/emulator mode, Google users without an `authorized_members` document are signed out and shown an active-membership invite error.
- Admin access is granted by an authorized member role of `admin` or `owner`.
- Members may update only their own `name` field in `authorized_members` during onboarding.

Passwordless invite behavior:

- Admin can authorize a member and send a Firebase email-link invite from `admin/index.html`.
- Current `actionCodeSettings.url` in `assets/firebase.js` points to:

```text
http://localhost:8061/member-login/
```

- Before production invite use, confirm this URL should be changed to the live member-login URL.

Local emulator behavior:

- Firebase Auth emulator port: `9099`
- Firestore emulator port: `8085`
- Hosting emulator port: `5000`
- Enable emulator client mode with either:
  - `localStorage.setItem("utl_use_firebase_emulators", "true")`
  - `?emulators=true`

Google Group / Drive access:

- `GOOGLE_GROUP_SETUP.md` documents the manual Google Group workflow.
- `googleGroupAdded` is only an admin record today. It does not automatically add/remove anyone from Google Groups.
- Future automation may use a Cloud Function, but that function is not present in this repo.

## Page Map

### `index.html`

Homepage.

Core sections:

- Sticky navigation.
- Navy hero with main brand message.
- Sound familiar question section.
- Three learning pillars: Think Clearly, Speak Concisely, Act Confidently.
- TSA Score™ teaser section with CTA to `tsa-score.html`.
- Stats and credibility section.
- Testimonials marquee section.
- Closing CTA.
- Footer.
- Lead modal connected to Google Apps Script.

Important functionality:

- Mobile nav toggle.
- Lead form modal.
- Google Apps Script submission.
- Animated reveal questions.
- Stats count-up animation.
- Testimonial marquee through `data/testimonials.json`.

### `tsa-score.html`

Find Your Level page.

Purpose:

- Introduces the TSA Score™.
- Routes public visitors to the Find Your Level exercise.
- Shows The Diagnostic and The Checkpoint as member-only assessments.

Sections:

- Sticky public nav with `Find Your Level` active.
- Hero.
- Public CTA card linking to `apps/find-your-level/index.html`.
- Two equal-height locked assessment cards:
  - The Diagnostic.
  - The Checkpoint.
- Footer.

CSS for this page is scoped with `tsa-` class prefixes in `styles.css`.

### `apps/find-your-level/index.html`

Public Find Your Level exercise.

Purpose:

- Lets non-members see how clearly they think in under 10 minutes.
- Uses the public Sort & Bucket exercise variation `sort_bucket_001`.
- Captures lead details before the exercise begins.

Key functionality:

- Details gate with name, email, and optional role.
- `What brings you here?` field submits through the `message` payload field.
- Lead payload uses `source: "find-your-level"`.
- Loads `data/sort-bucket.json`.
- Locks to `sort_bucket_001`, Meeting Agenda from Hell.
- Participants name three buckets from the word bank, then sort twelve items.
- Desktop supports drag and drop.
- Mobile supports tap item, then tap bucket.
- Scores bucket labels and item placement out of 20, converts the total to a percentage, and shows a score interpretation.
- Sends assessment result payloads for future routing to the Google Sheet `Assessments` tab.

### `about.html`

About page.

Purpose:

- Explains the founder story and why The Untaught Lessons exists.
- Includes founder profile, proof, and credibility sections.

### `programs.html`

Programs page.

Purpose:

- Explains the Think, Speak, and Act Like an Executive program.
- Covers audiences, phases, what to expect, and program CTA.

Important note:

- Contains inline page-specific CSS for program sections.

### `contact.html`

Contact page.

Purpose:

- Provides a full contact form and contact details.
- Uses the public nav and footer.

### `tools.html`

Tools page.

Purpose:

- Lists public or free tools.
- Uses an older navigation pattern compared with the newer `site-nav`.
- Still includes `Find Your Level` and `Member Login` links.

### `member-login/index.html`

Member learning journey dashboard.

Purpose:

- Password-gated landing page for the member learning sequence.
- Replaces the prior flat tool list with three phase cards and an overall progress bar.

Current section order:

- Login card when locked.
- `Your Learning Journey` dashboard when unlocked.
- Overall progress bar.
- Phase 1, Think Clearly card.
- Phase 2, Speak Concisely card.
- Phase 3, Act Confidently card.

Key functionality:

- Uses the existing local member gate pattern with `utl_member_unlocked`.
- Hardcoded test accounts remain `admin/password123` and `testuser/member2026`.
- Also supports Firebase Google sign-in for emails listed in Firestore `authorized_members`.
- First login can prompt for a preferred display name when a member has no saved name.
- Phase 1 is always accessible.
- Phase 2 unlocks when Phase 1 exercises are complete.
- Phase 3 unlocks when Phase 2 exercises are complete.
- Dashboard progress reads lesson and exercise completion state from localStorage.
- Links to `member-login/orientation.html`, `phase-1.html`, `phase-2.html`, `phase-3.html`, `my-results/index.html`, `apps/toolkit/index.html`, and `admin/index.html`.

### `member-login/orientation.html`

Orientation page for members.

Purpose:

- Introduces the MA storyline and member workspace flow before Phase 1.

Key functionality:

- Uses the shared member workspace nav from `member-login/content-config.js`.
- Reads the orientation video URL from `utl_url_orientation`, falling back to `UTL_CONTENT.orientation.videoUrl`.
- Shows a 16:9 video player when a URL exists and a branded coming-soon placeholder when empty.
- Links forward to `member-login/phase-1.html`.

### `member-login/phase-1.html`

Phase page for Think Clearly.

Purpose:

- Hosts the Phase 1 watch-then-practice sequence.

Key functionality:

- Reads lesson and exercise data from `member-login/content-config.js`.
- Tracks lesson watch state with `utl_watched_{lessonId}` and `utl_p1_videos_done`.
- Keeps exercise context blocks visible while exercise cards remain locked until all Phase 1 videos are watched.
- Includes manual Mark as Watched, Mark all watched, and Reset watched controls for testing.
- Tracks exercise visits with `utl_visited_{exerciseId}` and completion with `utl_done_{exerciseId}`.
- Sets `utl_p1_done` when all Phase 1 exercises are marked done.

### `member-login/phase-2.html`

Phase page for Speak Concisely.

Purpose:

- Hosts the Phase 2 watch-then-practice sequence.

Key functionality:

- Locked until `utl_p1_done` is true and `utl_phase2_status` is not `hide`.
- Tracks lesson watch state with `utl_watched_{lessonId}` and `utl_p2_videos_done`.
- Sets `utl_p2_done` when all Phase 2 exercises are marked done.

### `member-login/phase-3.html`

Phase page for Act Confidently.

Purpose:

- Hosts the Phase 3 watch-then-practice sequence.

Key functionality:

- Locked until `utl_p2_done` is true and `utl_phase3_status` is not `hide`.
- Tracks lesson watch state with `utl_watched_{lessonId}` and `utl_p3_videos_done`.
- Sets `utl_p3_done` when all Phase 3 exercises are marked done.
- Final bottom navigation routes to `my-results/index.html` when complete.

### `member-login/admin.html`

Deprecated redirect.

Purpose:

- Redirects old member admin links to `../admin/index.html`.

### `member-login/content-config.js`

Member workspace configuration and renderer.

Purpose:

- Single source of truth for the new phase-based member workspace defaults.
- Holds `UTL_CONTENT` with orientation, phase lessons, exercise context, and app links.
- Provides shared `.ws-` scoped styles, shared member nav rendering, localStorage/Firebase profile helpers, progress helpers, phase page rendering, and admin page rendering.

### `my-results/index.html`

Participant exercise record page.

Purpose:

- Reads all `utl_result_*` keys from localStorage.
- Shows assessment results for TSA Score™.
- Shows exercise results by phase with completion status.
- Provides copy-to-workbook, full response viewing, download, and send-to-instructor actions.
- No password gate.

Access:

- Sticky nav `My results` link.
- Member hub footer link.
- Exercise completion save notice links.

### `admin/index.html`

Admin panel.

Access:

- Footer link on `member-login/index.html`, shown as a small low-opacity `Admin` text link.

Default password:

- `utl2026_admin`

Password localStorage key:

- `utl_admin_password`

Purpose:

- Configure member workspace video URLs, context media URLs, phase visibility, and member access records.

Key functionality:

- Password-gated admin session stored under `utl_admin_auth`.
- Uses the shared member workspace nav/profile behavior from `member-login/content-config.js`.
- Visibility checkboxes control whether Phase 2 and Phase 3 can appear when unlocked.
- Orientation video URL saves under `utl_url_orientation`.
- Lesson video URLs save under `utl_url_{lessonId}`.
- Exercise context URLs save under `utl_ctx_url_{exerciseId}`.
- Exercise context type overrides save under `utl_ctx_type_{exerciseId}`.
- `Save all changes` writes all visible URL inputs to localStorage.
- Member Management tab reads/writes Firestore `authorized_members` documents.
- Member Management supports name, email, role, status, Google Group Added flag, edit, remove, and send-invite flows.
- The passwordless invite flow uses Firebase Auth email links and writes authorization records before sending.
- The Google Group Added field is manual tracking only. Follow `GOOGLE_GROUP_SETUP.md` to add/remove people in Google Groups.

## LocalStorage Admin Keys

| Key | Default | Options | Controls |
| --- | --- | --- | --- |
| `utl_admin_auth` | — | `"true"` | Admin session |
| `utl_admin_password` | `utl2026_admin` | any string | Admin password |
| `utl_member_unlocked` | — | `"true"` / `"false"` | Member workspace session gate |
| `utl_member_username` | — | string | Current local member username/email label |
| `utl_member_profile` | — | JSON object | Current local member profile label and role |
| `utl_watched_{lessonId}` | — | `"true"` | Lesson watched state |
| `utl_p1_videos_done` | — | `"true"` / `"false"` | Phase 1 lesson completion |
| `utl_p2_videos_done` | — | `"true"` / `"false"` | Phase 2 lesson completion |
| `utl_p3_videos_done` | — | `"true"` / `"false"` | Phase 3 lesson completion |
| `utl_visited_{exerciseId}` | — | `"true"` | Exercise card has been clicked |
| `utl_done_{exerciseId}` | — | `"true"` | Exercise manually marked done |
| `utl_p1_done` | — | `"true"` / `"false"` | Phase 1 exercise completion and Phase 2 unlock |
| `utl_p2_done` | — | `"true"` / `"false"` | Phase 2 exercise completion and Phase 3 unlock |
| `utl_p3_done` | — | `"true"` / `"false"` | Phase 3 exercise completion |
| `utl_url_orientation` | — | URL string | Orientation video URL override |
| `utl_url_{lessonId}` | — | URL string | Lesson video URL override |
| `utl_ctx_url_{exerciseId}` | — | URL string | Exercise context media URL override |
| `utl_ctx_type_{exerciseId}` | — | `video` / `slides` / `text` | Exercise context type override |
| `utl_send_instructor` | `hidden` | `live` / `hidden` | Send to instructor button |
| `utl_send_instructor_url` | `""` | URL string | Apps Script endpoint |
| `utl_result_grocery-list` | — | JSON object | Grocery list result |
| `utl_result_messy-notes` | — | JSON object | Messy notes result |
| `utl_result_rushed-voice-memo` | — | JSON object | Rushed voice memo result |
| `utl_result_rushed-voice-memo-ai` | — | JSON object | Rushed voice memo AI result |
| `utl_result_chalkboard-notes` | — | JSON object | Chalkboard notes result |
| `utl_result_issue-tree` | — | JSON object | Issue tree result |
| `utl_result_scqa-builder` | — | JSON object | SCQA builder result |
| `utl_result_tsa_diagnostic` | — | JSON object | TSA Diagnostic result |
| `utl_result_tsa_checkpoint` | — | JSON object | TSA Checkpoint result |

## App Map

### `apps/find-your-level/index.html`

Phase:

- Public Think Clearly entry point.

Purpose:

- Gives non-members a short public diagnostic experience before joining the program.
- Captures lead details and shows an immediate Sort & Bucket score.

Key functionality:

- Details gate before exercise content loads.
- Fetches `data/sort-bucket.json`.
- Uses `sort_bucket_001` only.
- Bucket naming from a word bank.
- Drag/drop on desktop and tap-to-move on mobile.
- Score screen with percentage, interpretation, and waitlist CTA.
- Sends lead and assessment payloads through the existing Google Apps Script endpoint.

### `apps/grocery-list/index.html`

Phase:

- Phase 1, Think Clearly.

Purpose:

- Practice sorting a messy grocery list into clean MECE buckets.

Key functionality:

- Drag and drop on desktop.
- Tap-to-select and tap-to-move behavior for mobile.
- Timer in app header.
- Bucket-based item movement.
- Reflection flow.

Recent design rule:

- Mobile users should be able to tap an item to highlight it, then tap a bucket to move it.

### `apps/messy-notes/index.html`

Phase:

- Phase 1, Think Clearly.

Purpose:

- Turn messy manager notes into a structured response.

Key functionality:

- Open response mode.
- Three-section response mode.
- Timer in app header.
- Word count and response review behavior.

Known important fix:

- Three-section response navigation must continue to work.

### `apps/rushed-voice-memo/index.html`

Phase:

- Phase 1, Think Clearly.

Purpose:

- Turn a rushed verbal update, provided as a transcript, into a clean structured written summary.

Key functionality:

- Same core interaction pattern as Messy Notes.
- Open response mode.
- Three-section structured response mode.
- Timer and word count.
- Structured sections are Current status, Key blockers, and Next steps.

### `apps/rushed-voice-memo-ai/index.html`

Phase:

- Phase 1, Think Clearly.

Purpose:

- Transcribe a provided voice file using ChatGPT, then use an AI prompt to structure the transcript into MECE buckets.

Key functionality:

- Five-step transcription instruction block.
- Transcript textarea.
- Collapsible AI structuring prompt.
- Recording time fields.
- Submit button for continuing after the transcript is pasted.
- Adapted from the TSA Speak app pattern.

### `apps/chalkboard-notes/index.html`

Phase:

- Phase 1, Think Clearly.

Purpose:

- Take notes from a provided chalkboard image and organise them into MECE buckets with BSP headers.

Key functionality:

- Same core interaction pattern as Messy Notes.
- Open response mode.
- Three-section structured response mode.
- Chalkboard image placeholder above the source input.
- Structured sections are Current state, Ideal state, and Roadblocks.
- Image placeholder path is `assets/chalkboard-notes.jpg`.

### `apps/issue-tree-builder/index.html`

Phase:

- Phase 2, Speak Concisely.

Purpose:

- Build an issue tree from a central question, hypothesis, arguments, and supporting details.

Key functionality:

- Desktop issue-tree style layout.
- Mobile-friendly layout.
- Supporting details under each argument.
- Add supporting detail behavior.
- Remove additional supporting detail behavior for detail 4 and beyond.
- Header timer and current-box word count.
- Preload should only fill the starting problem statement, not all subsequent answers.

### `apps/scqa-builder/index.html`

Phase:

- Phase 2, Speak Concisely.

Purpose:

- Practice writing two SCQA formulations from a single context.

Key functionality:

- Context setup.
- SCQA #1.
- Different SCQA #2.
- Review and scoring.
- Header timer and word count.

Design note:

- Preload should provide leading context or prompts, not fill all answers.

### `apps/advisory-board/index.html`

Phase:

- Phase 2, Speak Concisely.

Purpose:

- Virtual advisory board builder and prompt generator.

Key functionality:

- Pre-filled Olympics example.
- 8 preset personas plus custom advisor cards.
- Orchestrator education and selection.
- Mode A and Mode B prompt generation.
- Output paste and parse flow.
- Saved default board in localStorage.

CSS scope:

- `ab-`

### `apps/toolkit/index.html`

Phase:

- Cross-program reference.

Purpose:

- Reusable AI prompt toolkit for post-program application.

Key functionality:

- 5 tool cards.
- Collapsible example input blocks.
- Copy-prompt buttons.
- Mode A/B toggle on advisory board card.

CSS scope:

- `tk-`

Access:

- Member area only.

### `apps/write-to-aiko/index.html`

Phase:

- Phase 2, Speak Concisely.

Purpose:

- Practice writing a concise, answer-first email to Aiko from a completed SCQA.

Key functionality:

- Pre-filled Olympics SCQA reference panel with prominent Answer field.
- Collapsed Situation, Complication, and Question details behind a full SCQA toggle.
- Structured mode with five writing fields.
- Open mode with one freeform textarea.
- Static salutation and signoff.
- Header timer and word count.
- Footer word count with 80-120 word target.
- Sample answer toggle.
- Firestore and LocalStorage progress save flow. Controlled email submission via My Results dashboard.

CSS scope:

- `write-to-aiko-`

### `apps/explain-to-aiko/index.html`

Phase:

- Phase 2, Speak Concisely.

Purpose:

- Practice turning the Aiko email into a 120-second spoken explanation.

Key functionality:

- Same broad structure as `apps/tsa-speak/index.html`.
- Talk brief screen with 120-second instruction and recommended word count.
- Prep screen with the email to Aiko on the left and talking-points prep on the right.
- Open response and three-section prep modes.
- Record/transcribe help panel.
- Transcript paste box with recording duration fields and live character/word count.
- Apps Script submit flow plus localStorage fallback record under `utl_result_explain_to_aiko`.
- Firestore and LocalStorage progress save flow. Controlled email submission via My Results dashboard.

Target:

- 120 seconds.
- Recommended 220-260 words.

### `apps/explain-to-aiko-60/index.html`

Phase:

- Phase 2, Speak Concisely.

Purpose:

- Practice compressing the 120-second Aiko explanation into a 60-second elevator pitch.

Key functionality:

- Same broad structure as `apps/explain-to-aiko/index.html`.
- Short compression brief: deliver the key points in 60 seconds or less.
- Prep screen with the email to Aiko on the left and talking-points prep on the right.
- Open response and three-section prep modes.
- Record/transcribe help panel.
- Transcript paste box with recording duration fields and live character/word count.
- Apps Script submit flow plus localStorage fallback record under `utl_result_explain_to_aiko_60`.
- Firestore and LocalStorage progress save flow. Controlled email submission via My Results dashboard.
- Completion screen congratulates the learner for delivering the elevator pitch.

Target:

- 60 seconds or less.
- Recommended 110-130 words.

### `apps/eisenhower-matrix/index.html`

Phase:

- Phase 3, Act Confidently.

Purpose:

- Practice prioritizing tasks using the Eisenhower Matrix across six real-world scenarios.

Key functionality:

- Drag-and-drop on desktop.
- Tap-to-select on mobile.
- Scenario switcher dropdown.
- Example placement reveal with read-only flip view.
- Try again reset.

### `apps/i-have-bad-news/index.html`

Phase:

- Phase 3, Act Confidently.

Purpose:

- Instruction launch page for practicing difficult conversations and delivering bad news clearly, calmly, and humanely.

Key functionality:

- 20-minute exercise timer.
- Brand-aligned instruction panels for scenario selection and message structure.
- Primary link to the Difficult Conversations CustomGPT.
- Back link to the Phase 3 member workspace.

### `apps/lets-switch-hats/index.html`

Phase:

- Phase 3, Act Confidently.

Purpose:

- Instruction launch page for perspective-taking practice before a difficult conversation.

Key functionality:

- 15-minute exercise timer.
- Brand-aligned instruction panels for scenario selection and the switching framework.
- Primary link to the Let's Switch Hats CustomGPT.
- Back link to the Phase 3 member workspace.

### `apps/speak-like-obama/index.html`

Phase:

- Phase 3, Act Confidently.

Purpose:

- Instruction launch page for executive speech delivery practice using the Speak Like Obama Gem.

Key functionality:

- 15-minute exercise timer.
- Brand-aligned instruction panels for speech setup and the delivery feedback loop.
- Primary link to the Speak Like Obama Gemini Gem.
- Back link to the Phase 3 member workspace.

### `apps/tsa-diagnostic/index.html`

Phase:

- TSA Score™.

Purpose:

- Member Diagnostic hub for the baseline TSA Score™ assessment.
- Routes participants into available Diagnostic exercises and shows completion progress.

Current sections:

- Section 1, Think Clearly:
  - Exercise A, Sort & bucket, links to `../tsa-sort-bucket/index.html`.
  - Exercise B, Spot the Problem, links to `../tsa-spot-the-problem/index.html`.
- Section 2, Speak Concisely:
  - Short Talk, links to `../tsa-speak/index.html`.
- Section 3, Act Confidently:
  - Marked as coming soon.

Score behavior:

- Reads `tsa_sort_score`, `tsa_spot_score`, and `tsa_speak_score` from browser storage.
- Shows completed status pills when scores are available.
- Shows a Think Clearly score out of 40 when Sort & Bucket and Spot the Problem are complete.
- Shows a partial Think Clearly score when only one Think Clearly exercise is complete.

### `apps/tsa-sort-bucket/index.html`

Phase:

- TSA Score™.

Purpose:

- Exercise A of TSA diagnostic part 1, Think clearly.
- Assesses whether the participant can name clean buckets and sort messy information into those buckets.

Key functionality:

- Contact gate before the assessment loads.
- Randomly selects one of six assessment sets.
- Shows the item list and three buckets in a single workspace.
- Each bucket has a dropdown label selector from the word bank.
- Participants must choose three different bucket labels.
- Participants sort twelve items into those buckets.
- Desktop supports drag and drop.
- Mobile supports tap item, then tap bucket.
- Auto-scored out of 20 points:
  - Bucket labels: 6 points.
  - Item placement: 14 points.
- Stores result in `sessionStorage` and `localStorage` under `tsa_sort_score`.
- Score screen includes answer reveal, copy-results button, and continuation to Speak Concisely.

### `apps/tsa-spot-the-problem/index.html`

Phase:

- TSA Score™.

Purpose:

- Exercise B of TSA diagnostic part 1, Think clearly.
- Assesses whether the participant can detect overlap and gap problems in a pre-organized structure.

Key functionality:

- Contact gate before the assessment loads.
- Randomly selects one of five assessment sets.
- Uses a two-part drag/drop and mobile tap workflow:
  - Part A, Find the overlaps, asks participants to move duplicate ideas back to the left across three random problems.
  - Part B, Fix the Gaps, asks participants to move correct missing items from the left into the right bucket across three random problems.
- Auto-scored out of 20 points.
- Stores result in `sessionStorage` under `tsa_spot_score`.
- Reads `tsa_sort_score` from `sessionStorage` when available.
- Shows combined Part 1 Think Clearly score out of 40 when Sort & Bucket score exists.
- Score screen includes answer reveal and copy-results button.

### `apps/tsa-checkpoint/index.html`

Phase:

- TSA Score™.

Purpose:

- Member Checkpoint hub for the post-program TSA Score™ assessment.
- Routes participants into available Checkpoint exercises and shows completion progress.

Current sections:

- Section 1, Think Clearly:
  - Exercise A, Sort & bucket, links to `../tsa-sort-bucket/index.html?assessment=checkpoint`.
  - Exercise B, Spot the Problem, links to `../tsa-spot-the-problem/index.html?assessment=checkpoint`.
- Section 2, Speak Concisely:
  - Short Talk, links to `../tsa-speak/index.html?version=checkpoint`.
- Section 3, Act Confidently:
  - Marked as coming soon.

Score behavior:

- Reads `tsa_sort_score`, `tsa_spot_score`, and `tsa_speak_score` from browser storage.
- Shows completed status pills and retake buttons for available exercises.
- Shows Think Clearly and Speak Concisely scorecards when results exist.

### `apps/12-in-12/index.html`

Purpose:

- Existing app or exercise area for a 12-in-12 challenge.

Note:

- Less recently maintained than the main four practice apps.

## Known Notes

- Member workspace video/context management is still localStorage-only by design. Admin content changes are per browser and do not publish to other visitors unless the defaults in `member-login/content-config.js` are updated in code.
- Member authorization and member records are Firebase/Firestore-backed through `authorized_members`.
- Member progress has both localStorage behavior and Firebase helper support. Check the specific page/app before assuming progress is saved remotely.
- New member workspace lesson `videoUrl` and exercise `contextUrl` defaults are intentionally empty until real URLs are added through the admin page or committed into `member-login/content-config.js`.
- Google Sheet admin changes are pending Google Drive connector reconnection:
  - Rename sheet ID `10iQByFqVCffHanZbbHLnYj7Csbet4fgOCd2FWDzEqkE` to `[Website] UTL leads and assessments`.
  - Add an `Assessments` tab with columns `email`, `assessment_type`, `version`, `score`, `variation_id`, and `submitted_at`.
  - Add a `source` column to the contacts tab if it does not already exist.
- The current Google Apps Script endpoint must route Find Your Level assessment payloads to the future `Assessments` tab. The static site already sends the required assessment fields.

## Lead Form Integration

Public leads (Contact, Find Your Level) submit to Google Apps Script for immediate notification:

```text
https://script.google.com/macros/s/AKfycbzJE--FL2kB_XDNZRnszCtlyLRPvaLAHGuF5TAOdXJk40atbvf5Y6ELuSK2B7CSLaMN/exec
```

Submission pattern:

```javascript
await fetch(SCRIPT_URL, {
  method: 'POST',
  mode: 'no-cors',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});
```

Payload fields:

- `name`
- `email`
- `role`
- `message`
- `page`
- `source`

The `page` field is the URL where the form was submitted from. The `source` field distinguishes contact leads from assessment leads, such as `contact-form` or `find-your-level`.

## Testimonials

Testimonials are rendered from:

```text
data/testimonials.json
```

Homepage fetches the JSON at page load and fills:

- `#testimonialRowOne`
- `#testimonialRowTwo`

Programs page also fetches this JSON and renders the first six testimonials in `#programTestimonials`.

Field structure:

- `quote`
- `name`
- `title`
- `company`

Current styling:

- Testimonial quote in italic body text.
- Person name in navy.
- Person title in italic charcoal.
- Company displayed separately in larger black text.
- Current companies are all Uber.
- Marquee animation is intentionally slow.

## CSS Structure

Primary shared stylesheet:

```text
styles.css
```

Important CSS scopes:

- `.home-page`: core public site styling.
- `.about-page`: about-specific styling.
- `.contact-page`: contact-specific styling.
- `.programs-page`: programs-specific styling.
- `.tsa-...`: TSA Score™ page and homepage teaser styling.

New TSA Score™ styles must remain scoped with `tsa-` class names to avoid collisions.

## Current Implementation Notes

- The site is static and should remain static unless explicitly changed.
- Do not introduce npm, frameworks, bundlers, or a backend without a clear decision.
- Prefer editing existing HTML, CSS, and JavaScript directly.
- Do not modify existing practice app logic unless the task explicitly asks for it.
- Keep new visual work aligned with the existing brand system.
- The app header pattern should remain consistent across practice tools.
- Logo clicks in app headers should return to the homepage.
- Navigation active states should use the same gold underline pattern.
- Mobile layouts should be checked around 375px and 768px widths when meaningful UI changes are made.

## Future Build Notes

Likely next work areas:

- Add production lesson video URLs and context media URLs to `member-login/content-config.js` once the final assets are approved.
- Decide whether member workspace admin URL changes should remain browser-local or move to a publishable static JSON/config workflow later.
- Add actual scoring logic using the C³ Rubric™.
- Decide whether TSA results are purely local or submitted somewhere.
- Continue aligning all app headers and timers.
- Keep `WEBSITE_CONTEXT.md` updated with each meaningful change.
