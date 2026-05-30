# The Untaught Lessons Website Context

Last updated: 2026-05-30

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

Favicon: `assets/favicon-bluebg-whitedoor-thicker-32.png?v=6`

Trademarks: `TSA Score™` · `C³ Rubric™` — use ™ on first use per page. Program name: `Think, Speak, and Act Like an Executive`.

## Firebase Member System

Firebase project: `the-untaught-lessons` · Shared client: `assets/firebase.js`

Firestore collections:
- `authorized_members/{email}` — who can sign in with Google. Email keys are normalized lowercase.
- `users/{uid}` — per-user profile and progress. Fields: `email`, `displayName`, `role`, `lastSeenAt`, `workspaceProgress`, `feedbackEnabled`.
- `users/{uid}/completed_exercises/{exerciseId}` — per-exercise completion records.
- `settings/emailTemplates` — welcome email template. Read/written by `getEmailTemplates`/`saveEmailTemplate` in `assets/firebase.js`.
- `settings/feedback` — global `defaultFeedbackEnabled` boolean.
- `settings/publicSite` — public toggle settings (e.g. `findLevelVisible`).

Key `authorized_members` fields: `email`, `name`, `role` (member/admin/owner), `status`, `googleGroupAdded`, `feedbackEnabled`, `addedAt`, `updatedAt`.

Auth behavior:
- Supports Google sign-in for emails in `authorized_members`.
- Local test accounts: `admin/password123` and `testuser/member2026`.
- Unauthorized Google accounts are signed out with an invite error (outside localhost/emulator).
- Admin access: role `admin` or `owner`.
- `adminProfileData()` reads from `utl_member_profile` localStorage JSON, falls back to `utl_member_username` → `'admin'` for local test accounts.

Passwordless invites: Admin sends Firebase email-link invites from `admin/index.html`. Current `actionCodeSettings.url` points to `http://localhost:8061/member-login/` — update before production use.

Emulators (Auth: 9099, Firestore: 8085, Hosting: 5000): enable with `localStorage.setItem("utl_use_firebase_emulators", "true")` or `?emulators=true`.

Firestore rules pattern for settings: `allow read: if docId == 'publicSite' || signedIn();`

## Quick Reference — Pages

| File | Purpose |
| --- | --- |
| `index.html` | Homepage with lead modal, testimonials, TSA teaser |
| `about.html` | Founder story and credibility |
| `programs.html` | Program overview and CTA |
| `contact.html` | Contact form |
| `tsa-score.html` | Find Your Level routing page (public + member cards) |
| `member-login/index.html` | Member dashboard (phase cards, progress) |
| `member-login/orientation.html` | Orientation page |
| `member-login/phase-1.html` | Think Clearly watch + practice |
| `member-login/phase-2.html` | Speak Concisely watch + practice |
| `member-login/phase-3.html` | Act Confidently watch + practice |
| `member-login/content-config.js` | Workspace config, nav, shared styles, rendering |
| `member-login/admin.html` | Deprecated redirect to `admin/index.html` |
| `my-results/index.html` | Participant exercise record (no password gate) |
| `admin/index.html` | Admin panel — Site & Content, Student Progress, Member Management |

## Quick Reference — Apps

| File | Phase | Purpose |
| --- | --- | --- |
| `apps/find-your-level/` | Public | Lead gate + Sort & Bucket exercise (`sort_bucket_001`) |
| `apps/grocery-list/` | Phase 1 | Sort messy grocery list into MECE buckets |
| `apps/grocery-list-ai/` | Phase 1 | AI-assisted grocery list structuring |
| `apps/messy-notes/` | Phase 1 | Turn manager notes into structured response |
| `apps/rushed-voice-memo/` | Phase 1 | Structure a rushed verbal update |
| `apps/rushed-voice-memo-ai/` | Phase 1 | Transcribe voice then structure with AI |
| `apps/chalkboard-notes/` | Phase 1 | Organise chalkboard image notes into MECE |
| `apps/issue-tree-builder/` | Phase 2 | Build issue tree from question + arguments |
| `apps/scqa-builder/` | Phase 2 | Write two SCQA formulations from one context |
| `apps/advisory-board/` | Phase 2 | Virtual advisory board builder (CSS: `ab-`) |
| `apps/write-to-aiko/` | Phase 2 | Answer-first email exercise (CSS: `write-to-aiko-`) |
| `apps/explain-to-aiko/` | Phase 2 | 120s spoken explanation (220-260 words) |
| `apps/explain-to-aiko-60/` | Phase 2 | 60s elevator pitch compression (110-130 words) |
| `apps/toolkit/` | Cross-program | AI prompt toolkit reference (CSS: `tk-`) |
| `apps/eisenhower-matrix/` | Phase 3 | Prioritization matrix, 6 scenarios |
| `apps/i-have-bad-news/` | Phase 3 | Difficult conversations launch page |
| `apps/lets-switch-hats/` | Phase 3 | Perspective-taking launch page |
| `apps/speak-like-obama/` | Phase 3 | Speech delivery launch page |
| `apps/tsa-diagnostic/` | TSA | Diagnostic hub (Sort & Bucket, Spot Problem, Short Talk) |
| `apps/tsa-sort-bucket/` | TSA | Exercise A Think Clearly — contact gate, 6 sets, score/20 |
| `apps/tsa-spot-the-problem/` | TSA | Exercise B Think Clearly — Part A overlaps, Part B gaps |
| `apps/tsa-checkpoint/` | TSA | Checkpoint hub (same exercises, `?assessment=checkpoint`) |
| `apps/tsa-speak/` | TSA | Speak Concisely short talk assessment |

Data files: `data/sort-bucket.json` (public), `data/tsa/*.json` (member TSA), `data/practice/*.json` (member practice), `data/testimonials.json`. See archive for schemas.

Apps Script endpoint (all POST submissions): `https://script.google.com/macros/s/AKfycbzJE--FL2kB_XDNZRnszCtlyLRPvaLAHGuF5TAOdXJk40atbvf5Y6ELuSK2B7CSLaMN/exec`

Apps Script `action` routing: `WelcomeEmail`, `TestEmailTemplate`, `ResultsEmail`. Default = lead/sheet logging.

## Known Notes

- Member workspace video/context management is browser-local (localStorage). Admin content changes do not publish to other visitors unless defaults in `content-config.js` are updated in code.
- Google Sheet admin changes are pending Google Drive connector reconnection: rename sheet `10iQByFqVCffHanZbbHLnYj7Csbet4fgOCd2FWDzEqkE`, add `Assessments` tab, add `source` column to contacts tab.
- `googleGroupAdded` field in `authorized_members` is a manual record only — it does not add/remove anyone from Google Groups. See `GOOGLE_GROUP_SETUP.md`.
- Passwordless invite `actionCodeSettings.url` currently points to localhost — update before sending real member invites.
- `adminProfileData().email` returns `'admin'` when using local test accounts (not a real email). Any email validation must check for `@` before using as a recipient.
- `no-cors` mode on Apps Script fetches returns opaque responses — server-side failures are invisible to the client. Always validate inputs client-side.
- Email templates are stored in Firestore `settings/emailTemplates`. `loadEmailTemplates` in `admin/index.html` always falls back to defaults if Firestore fails, then calls `syncEmailTemplateForm` and `initEmailTemplateListeners` regardless.

## Current Implementation Notes

- Static site — no backend, no npm, no framework, no build step.
- Prefer editing existing HTML, CSS, and JavaScript directly.
- Do not modify existing practice app logic unless the task requires it.
- Keep new visual work aligned with the brand system.
- App header pattern: navy sticky, white logo (links homepage), gold Roboto Mono phase label, white Playfair Display title, timer + controls right.
- Navigation active state: `class="nav-link-active" aria-current="page"` → gold underline.
- Mobile layouts: check at 375px and 768px for meaningful UI changes.
- Logo clicks in app headers link back to the homepage.

## Change Log

### 2026-05-30

- Updated Admin Console email-template tests/welcome sends to post JSON as `text/plain` to Apps Script, preserving `action`, recipient fields, `templateData`, and `renderedHtml` while avoiding the form-encoded payload that could be ignored by the deployed script.
- Changed the Email Templates URL field into an optional extra button: the two setup buttons stay fixed, and filling Button text + Button URL adds a separate button after the opening paragraph in the live preview.
- Fixed Admin Console email-template delivery payloads: `TestEmailTemplate` and `WelcomeEmail` include explicit `recipient`, `to`, and `email` fields so the live script does not fall back to the default contact-form handler.
- Refined the Admin Console Email Templates editor: compact standard logo toggle, clearer "Workspace button link" field with the live member-login URL, and simplified brand accent swatches that explain what they change in the preview.
- Redesigned welcome email template (`generateEmailHtml` in `admin/index.html`): white card on `#F7F5F0` background, logo, personalized greeting, "We are glad you are here." subtitle, opening paragraph, YOUR SETUP section with 3 hardcoded steps (Join Google Group → Sign in to workspace → Complete orientation), closing sign-off, footer.
- Simplified Email Templates editor UI: hidden Headline and Button Label fields, relabeled Button URL to "Workspace URL", relabeled Intro to "Opening paragraph".
- Fixed `loadEmailTemplates` to always call `syncEmailTemplateForm` and `initEmailTemplateListeners` regardless of Firestore success/failure (fixes color swatches not working and "Could not load templates" error).
- Fixed `et-testEmail` input to only populate when admin email contains `@` (fixes test email failing silently for local test accounts).
- Defined `etGetTemplate(id)` function in `admin/index.html` (was causing ReferenceError crash in add-member flow).
- Fixed `generateEmailHtml` button URL: now uses `data.buttonUrl` instead of hardcoded `#`. Personalization replaces `{{workspace_url}}` placeholder.
- Fixed hardcoded `you@example.com` in Step 2 email body — now uses `data.loginEmail`.
- Updated Google Apps Script to support `WelcomeEmail` action (uses `data.renderedHtml` from admin panel) and `TestEmailTemplate` action (sends `[TEST]` prefixed email to specified recipient).
- Added brand color swatches to Email Template editor.
- Implemented "Send test email" functionality in Admin Console.
- Implemented "Email Templates" editor in Admin Console under Engagement tab. Templates stored in Firestore `settings/emailTemplates`.
- Added `getEmailTemplates` and `saveEmailTemplate` to `assets/firebase.js`.
- Standardized exercise naming to sentence case across all exercise titles, labels, and JSON data files.
- Finalized learner-controlled submission model for all member practice apps.

### 2026-05-29

- Reordered Content Library tab in Admin Console: "Data files" before "GitHub setup".
- "GitHub setup" section starts collapsed by default.
- Updated Admin Console member-management process guide: capitalized action text after role labels, added bolded summary phrases to Method C's email sub-bullets, updated CSV export filename format to `YYYYMMDD - utl-members download.csv`.
- Added Admin Tools public homepage toggle for `Find your level`: writes to Firestore `settings/publicSite.findLevelVisible`; `index.html` reads it and hides `data-public-find-level` elements when off/missing.
- Updated Admin Console: Site & Content sections start collapsed by default.

### 2026-05-28

- Added floating "Got feedback?" widget to entire site via `assets/feedback-widget.js` (ES module, load with `<script type="module">`).
- Widget visible only when user is signed into Firebase AND `feedbackEnabled !== false` on their Firestore user document.
- Feedback widget style: gold `#EEA320`, navy `#003366`, Roboto Mono 11px 700, border-radius 20px, fixed bottom-right 24px.
- Feedback modal: captures name/email from Firebase Auth, page URL, timestamp, feedback type (6 options), free-text description. Submits to Apps Script `Feedback` tab.
- Added `feedbackEnabled` boolean to `users/{uid}`. Inherited from `authorized_members/{email}.feedbackEnabled` → `settings/feedback.defaultFeedbackEnabled` → default `true`.
- Added `getUserFeedbackEnabled`, `setUserFeedbackEnabled`, `findUserUidByEmail`, `getGlobalFeedbackSetting`, `setGlobalFeedbackSetting` to `assets/firebase.js`.
- Updated `firestore.rules`: admins can write `users/{userId}`; signed-in users can read `settings/{docId}`; admins can write `settings/{docId}`.
- Admin panel: member edit form has Feedback widget select (Default/Enabled/Disabled). Global defaults section in Site & Content with `defaultFeedbackEnabled` Firestore toggle.

### 2026-05-27

- Admin Console tabbed interface: Site & Content, Student Progress, Member Management.
- Student Progress tab: Firestore-backed progress table via `getAllMemberWorkspaceProgress()`. Shows name/email, last active date, dot indicators for video and exercise completion per phase.
- Moved Members and Passwords sections into Member Management tab.
- Restored admin profile control in top-right sticky admin bar (profile details, workspace/My results links, Log out).
- Updated `firestore.rules`: admins can read `users/{userId}` and `users/{userId}/completed_exercises/{exerciseId}`.
- Fixed Admin Console tab content rendering and event binding for `bindAdminContentManager()`.
- Restored "Assessments" link in `my-results/index.html` navigation.
- Redesigned `my-results/index.html` with stage-based summary model, collapsible accordions for each stage, video progress tracking.
- Updated member practice apps to remove automated email triggers. Switched to learner-controlled submission via My Results dashboard.
