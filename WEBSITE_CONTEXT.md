# The Untaught Lessons Website Context

Last updated: 2026-06-01

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

Trademarks: `C³ Rubric™` · `Think, speak and act like an executive™` — use ™ on first use per public page/email, then omit on later shorthand references. The previous score brand is paused; use `Find your level`, `Diagnostic`, `Checkpoint`, or `Assessments` instead.

## Firebase Member System

Firebase project: `the-untaught-lessons` · Shared client: `assets/firebase.js`

Firestore collections:
- `authorized_members/{email}` — who can sign in with Google. Email keys are normalized lowercase.
- `users/{uid}` — per-user profile and progress. Fields: `email`, `displayName`, `role`, `lastSeenAt`, `workspaceProgress`, `feedbackEnabled`.
- `users/{uid}/completed_exercises/{exerciseId}` — per-exercise completion records.
- `settings/emailTemplates` — welcome email template. Read/written by `getEmailTemplates`/`saveEmailTemplate` in `assets/firebase.js`.
- `settings/feedback` — global `defaultFeedbackEnabled` boolean.
- `settings/publicSite` — public toggle settings (e.g. `findLevelVisible`).
- `settings/admin_visibility` — admin/owner preview-only visibility settings, including whether admins/owners can bypass the public Find your level data form.
- `google_group_sync_jobs/{jobId}` — Google Group add/remove jobs queued by Admin Console and intended for Firebase Functions processing.

Key `authorized_members` fields: `email`, `name`, `role` (member/admin/owner), `status`, `googleGroupAdded`, `googleGroupAddedAt`, `googleGroupAddedBy`, `googleGroupRemovedAt`, `googleGroupRemovedBy`, `feedbackEnabled`, `addedAt`, `updatedAt`.

Auth behavior:
- Supports Google sign-in for emails in `authorized_members`.
- Local test accounts: `admin/password123` and `testuser/member2026`.
- Unauthorized Google accounts are signed out with an invite error (outside localhost/emulator).
- Admin access: role `admin` or `owner`.
- `adminProfileData()` reads from `utl_member_profile` localStorage JSON, falls back to `utl_member_username` → `'admin'` for local test accounts.

Passwordless invites: Admin sends Firebase email-link invites from `admin/index.html`. Current `actionCodeSettings.url` points to `http://localhost:8061/member-login/` — update before production use.

Emulators (Auth: 9099, Firestore: 8085, Hosting: 5000): enable with `localStorage.setItem("utl_use_firebase_emulators", "true")` or `?emulators=true`.

Firestore rules pattern for settings: public pages can read `publicSite` and `public_assessments`; other settings require sign-in.

Firebase Functions: `functions/processGoogleGroupSyncJob` watches `google_group_sync_jobs/{jobId}`. It requires Google Admin SDK credentials and is being introduced in parallel with Apps Script group sync. See `GOOGLE_GROUP_SYNC_MIGRATION.md`.

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
| `apps/tsa-diagnostic/` | Assessment | Diagnostic hub (Sort & Bucket, Spot Problem, Short Talk) |
| `apps/tsa-sort-bucket/` | Assessment | Exercise A Think clearly — contact gate, 6 sets, score/20 |
| `apps/tsa-spot-the-problem/` | Assessment | Exercise B Think clearly — Part A overlaps, Part B gaps |
| `apps/tsa-checkpoint/` | Assessment | Checkpoint hub (same exercises, `?assessment=checkpoint`) |
| `apps/tsa-speak/` | Assessment | Speak concisely short talk assessment |

Data files: `data/sort-bucket.json` (public), `data/tsa/*.json` (member assessments), `data/practice/*.json` (member practice), `data/testimonials.json`. See archive for schemas.

Apps Script endpoint (all POST submissions): `https://script.google.com/macros/s/AKfycbzJE--FL2kB_XDNZRnszCtlyLRPvaLAHGuF5TAOdXJk40atbvf5Y6ELuSK2B7CSLaMN/exec`

Apps Script `action` routing: `WelcomeEmail`, `TestEmailTemplate`, `ResultsEmail`, `RemovedMember`, `AddGoogleGroupMember`, `RemoveGoogleGroupMember`. Default = lead/sheet logging.

## Known Notes

- Member workspace video/context management is browser-local (localStorage). Admin content changes do not publish to other visitors unless defaults in `content-config.js` are updated in code.
- Google Sheet admin changes are pending Google Drive connector reconnection: rename sheet `10iQByFqVCffHanZbbHLnYj7Csbet4fgOCd2FWDzEqkE`, add `Assessments` tab, add `source` column to contacts tab.
- `googleGroupAdded` field in `authorized_members` is updated by Admin Console Google Group sync requests when Apps Script routes are deployed. If Apps Script is not updated or cannot use Admin Directory API, manage the group manually. See `GOOGLE_GROUP_SETUP.md`.
- Embedded Google Drive videos/slides cannot expose their permission error state to site JavaScript because the iframe is cross-origin. The workspace instead shows a reusable "Video not opening?" access guide under protected embeds without exposing the internal Google Group address.
- Firebase Auth sign-in-link email copy is controlled in Firebase Console Authentication Templates. Use `FIREBASE_EMAIL_TEMPLATE.md` for the approved template copy.
- Passwordless invite `actionCodeSettings.url` uses the current site origin and `/member-login/`.
- `adminProfileData().email` returns `'admin'` when using local test accounts (not a real email). Any email validation must check for `@` before using as a recipient.
- Admin Console member-management writes require an active Firebase Google session whose `authorized_members/{email}.role` is `admin` or `owner`; the UI preflights this before add/edit/remove actions.
- If Member Management is opened while signed into the wrong Firebase Google account, the Admin Console prompts to switch accounts instead of leaving the table stuck on an authorization error.
- Bootstrap owner: `wenszu@gmail.com` is treated as an owner in both `firestore.rules` and the Admin Console even if its `authorized_members` row is missing or accidentally edited. The Admin Console hides edit/remove actions for this row, and Firestore rules block client-side delete/downgrade except by the bootstrap owner account itself.
- When `wenszu@gmail.com` opens an admin-only Firebase view, Admin Console tries to repair `authorized_members/wenszu@gmail.com` back to `role: owner`, `status: active`, `bootstrapOwner: true`. This repair requires the bootstrap-owner Firestore rule to be deployed first.
- Admin Console Member Management **Group** column is the manual Google Group queue: header links to the `utl-members` member list and each row has an `Added` / `Not added` toggle for verified manual fixes. Manual toggle clicks record the verification date and admin email. The browser cannot query Google Groups directly; confirmed automation depends on `google_group_sync_jobs` + Functions.
- Admin Console remove-member flow sends a non-blocking Apps Script `RemovedMember` audit action for non-admin/non-owner members before deleting Firestore records. The Apps Script writes to the `Removed members` tab in the same Google Sheet as leads/feedback and skips admin/owner roles.
- On localhost only, Member Management Group toggle changes are stored in `localStorage` (`utl_mb_local_group_overrides`) instead of Firestore so manual verification can be tested without live Firebase writes. Live site toggles still write Firestore for shared admin visibility.
- Student Progress uses the same Firebase admin preflight/switch-account flow as Member Management. If `authorized_members` is readable but `users` progress documents are blocked by Firestore rules, it renders the member list with a rules warning instead of failing the whole table.
- Admin Console IA: `Site & Content` owns public/member visibility and content controls; `Visibility` is the single place for public homepage/Find your level/page-card visibility, Mission card visibility, learner release gates, and the read-only visibility status summary. `Assessment access` controls Firestore-backed assessment visibility for members/admins. `Admin Tools` owns preview/QA utilities; `Engagement` owns nudges, email, certificates, and feedback defaults; `Member Management` owns member access/password operations.
- Admin Console binary settings use right-aligned checkbox controls. Keep multi-state controls such as `Show / Coming soon / Hide` as segmented controls because they are not true yes/no settings.
- Admin Console `Site & Content > Visibility > Admin / owner preview` controls admin/owner-only preview behavior. `Skip Find your level data form` writes `settings/admin_visibility.findLevelLeadGateBypass` and mirrors to localStorage key `utl_find_level_admin_bypass`; public visitors are not affected.
- Admin Console `Find your level page` card visibility writes `settings/public_assessments` and mirrors to localStorage keys `utl_public_assessment_diagnostic_visible` / `utl_public_assessment_checkpoint_visible` for localhost preview. Live public reads require deployed Firestore rules that allow public read of `settings/public_assessments`.
- Lesson video URLs are sourced from `member-login/content-config.js`. The Admin Console Content Manager can save local browser preview overrides, but permanent video link changes must update `member-login/content-config.js` and be committed/pushed.
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

### 2026-06-01

- Standardized Admin Console binary setting controls to checkboxes across Visibility, Assessment access, Engagement, Email templates, and Certificate sections. Multi-state controls remain segmented controls.
- Added admin/owner-only Find your level form bypass: Admin Console Visibility has a checkbox for `Skip Find your level data form`, and `apps/find-your-level/index.html` skips the lead form only for admin/owner sessions when that setting is enabled.
- Added removed-member audit logging: non-admin/non-owner removals now post a `RemovedMember` action to Apps Script before Firestore deletion so the shared Leads/Feedback spreadsheet keeps add/remove history.
- Fixed public Find your level card visibility by allowing public reads of Firestore `settings/public_assessments` and adding localhost localStorage fallback keys for Diagnostic/Checkpoint card visibility.
- Updated program timing from `[2026] UTL - Workshop flow (for scale)`: member lesson durations in `content-config.js` use exact minutes/seconds from the PDF. Public page uses clean estimates: 7 hours total, with about 2.5 hours of videos and 4.5 hours of exercises.
- Fixed member workspace video controls by moving the lesson title/kicker strip below the Google Drive iframe instead of overlaying the bottom of the video player.
- Updated the Phase 1 KonMari lesson video URL to the canonical Google Drive `/file/d/.../view?usp=sharing` format.
- Hardened Admin Console lesson video editing: URL fields are read-only until Edit is clicked, bad old local overrides are ignored, and admins can reset a row back to the current backend config URL.
- Paused the old score-brand language across public/member-facing copy. The site should encourage `Find your level` without mentioning the paused score brand.
- Standardized the program name capitalization to `Think, speak and act like an executive` (with ™ on first use where appropriate).
- Hardened member records: `authorized_members` should use one canonical lowercase email document per person. Admin Console now blocks adding an email that already exists, hides duplicate normalized-email rows in the table, and `authorizeMember` refuses to create a second account or save an existing admin/owner as a user.
- Student Progress only shows Firebase `users` progress documents that have an email and can map back to a member; orphan UID-only progress documents are ignored so raw Firebase IDs do not appear as learners.
- Reorganized `Site & Content` IA so `Visibility` and `Assessment access` appear in the same order in the left nav and page body; moved preview/QA utilities to `Admin Tools` and engagement defaults to `Engagement`.

### 2026-05-31

- Added Admin Console Google Group sync requests for member add/edit/inactivate/remove flows. Requires deployed Apps Script routes `AddGoogleGroupMember` and `RemoveGoogleGroupMember` plus Apps Script Admin Directory API access before it truly adds/removes members in `utl-members@googlegroups.com`.
- Added Firebase admin-session preflight to Admin Console member add/edit/remove flows so raw `Missing or insufficient permissions` errors become actionable sign-in/admin-role guidance.
- Started Firestore/Cloud Functions Google Group sync migration: Admin Console queues `google_group_sync_jobs`, Firestore rules allow admins to manage jobs, and `functions/processGoogleGroupSyncJob` scaffold records confirmed/failed results once Google Admin SDK credentials are configured. Apps Script sync remains as fallback during verification.
- Redesigned Member Management Group column into a simpler manual queue with a header link to Google Groups and row-level `Added` / `Not added` toggles that display the manual verification date/admin after use. Remove-member popup reminds admins to manually remove from `utl-members@googlegroups.com` if sync does not confirm.
- Changed localhost Group toggle behavior to use local browser overrides instead of Firestore writes, avoiding Firebase permission errors while testing manual verification.
- Hardened Student Progress loading: admin preflight now runs before the progress query, and blocked `users` progress reads degrade to a member-list view with a clear Firestore rules warning.
- Cleaned up Admin Console section organization: removed the duplicate standalone Mission card section because Mission visibility lives in `Site & Content > Visibility`; folded Public pages and Find your level controls into `Visibility`; made public assessment and assessment-access toggles visible before Firebase hydration; labeled the status box as a read-only visibility summary; moved Site sync check and Quick links into `Admin Tools`; and moved Global defaults into `Engagement`.
- Removed member-facing Google Group details from the welcome email, Firebase sign-in template, and workspace video-access guidance. Google Group membership is now treated as an admin-only access mechanism.
- Updated welcome/sign-in email copy so the "right Google account" reminder is part of the workspace sign-in instruction, not a separate setup step.
- Added `wenszu@gmail.com` as a protected bootstrap owner in Firestore rules and Admin Console admin checks so the primary owner account cannot be locked out or removed by normal client-side admin actions.
- Added a self-repair path that restores `authorized_members/wenszu@gmail.com` to `role: owner` when the bootstrap owner signs into Admin Console after rules allow it.
- Fixed and deployed Google member sign-in Firestore rules: members can now update their own `firstLoginAt` and `lastLoginAt` fields on `authorized_members/{email}` during login, instead of failing with `Missing or insufficient permissions` after authorization.
- Added `FIREBASE_EMAIL_TEMPLATE.md` with polished Firebase Authentication sign-in-link copy. Firebase's built-in email cannot fully match the custom welcome email HTML unless a server-side custom email sender is added.

### 2026-05-30

- Added shared public-site visibility script `assets/public-site-settings.js` and applied `data-public-find-level` to public nav links on `index.html`, `about.html`, `programs.html`, and `contact.html` so the Admin Tools "Find your level" toggle controls those links consistently. The live toggle still requires deployed Firestore rules that allow public reads of `settings/publicSite`.
- Refined Email Templates editing: the live preview now has a toolbar (undo/redo, bold, italic, link, bullets, numbering, add/remove button), the opening paragraph is edited directly inside the preview, and the optional extra CTA is added through the preview toolbar instead of side-panel fields.
- Updated Admin Console email-template tests/welcome sends to post JSON as `text/plain` to Apps Script, preserving `action`, recipient fields, `templateData`, and `renderedHtml` while avoiding the form-encoded payload that could be ignored by the deployed script.
- Changed the Email Templates URL field into an optional extra button: the two setup buttons stay fixed, and filling Button text + Button URL adds a separate button after the opening paragraph in the live preview.
- Added `scripts/apps-script-email-actions.gs` with the missing Apps Script routes for `TestEmailTemplate` and `WelcomeEmail`. This must be pasted into the deployed Apps Script and called before the default contact-form handler; pushing GitHub alone does not update the Apps Script web app.
- Fixed Admin Console email-template delivery payloads: `TestEmailTemplate` and `WelcomeEmail` include explicit `recipient`, `to`, and `email` fields so the live script does not fall back to the default contact-form handler.
- Refined the Admin Console Email Templates editor: compact standard logo toggle, clearer "Workspace button link" field with the live member-login URL, and simplified brand accent swatches that explain what they change in the preview.
- Redesigned welcome email template (`generateEmailHtml` in `admin/index.html`): white card on `#F7F5F0` background, logo, personalized greeting, "We are glad you are here." subtitle, opening paragraph, YOUR SETUP section with 3 hardcoded steps, closing sign-off, footer.
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
