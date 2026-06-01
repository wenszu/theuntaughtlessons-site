# WEBSITE_CONTEXT Archive

Archived from `WEBSITE_CONTEXT.md` on 2026-05-30.
Contains entries older than 2026-05-27 and reference sections moved to reduce token load.
Current implementation facts live in `WEBSITE_CONTEXT.md`.

---

## Change Log (before 2026-05-27)

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
- Updated member workspace nav/profile behavior to use Firebase profile data. Admin access granted by `authorized_members` role `admin` or `owner`.
- Phase 2 and Phase 3 now show/hide via `utl_phase2_status` / `utl_phase3_status`. `utl_tsa_status` controls Assessments link and section.
- Restored full previous member sequence into `member-login/content-config.js`: Orientation context sections, six Phase 1 exercises, six Phase 2 exercises, four Phase 3 exercises, and old `utl_embed_*` / `utl_p*_ex*_done` compatibility keys.
- Phase pages read legacy admin-saved context media from `utl_embed_*` JSON first, then fall back to built-in Google Drive / Google Slides defaults.

### 2026-05-18

- Split Orientation section in `member-login/index.html` into two separate accordions: `Your first day at MA` and `How this program works`.
- Restructured Phase 2 section to fully vertical stacked layout.
- Updated all Phase 2 context accordion labels to narrative-driven names aligned with the MA storyline.
- Phase 2 exercises 1-6 are live: Issue Tree Builder, SCQA Builder, Advisory board with AI, Write to Aiko, Explain to Aiko (120s), and Explain to Aiko (60s).
- Phase 2 localStorage keys: `utl_p2_ex1_done` through `utl_p2_ex6_done`.
- Phase 3 exercises 1-4 are live: The Art of Saying No, I Have Bad News..., Let's Switch Hats, and Speak Like Obama.
- Phase 3 localStorage keys: `utl_p3_ex1_done` through `utl_p3_ex4_done`.
- Added per-accordion embed management to admin panel using `utl_embed_[id]` keys.
- Added site sync check section to admin panel.
- Admin Visibility section controls `utl_public_find_level`, `utl_mission_card`, `utl_phase1_status`, `utl_phase2_status`, `utl_phase3_status`, `utl_tsa_status`, and `utl_admin_preview_bypass`.
- Created `apps/advisory-board/index.html` — Phase 2 advisory board app. CSS prefix: `ab-`.
- Created `apps/toolkit/index.html` — cross-program AI prompt reference. CSS prefix: `tk-`.
- Created `apps/write-to-aiko/index.html` — Phase 2 answer-first email exercise. CSS prefix: `write-to-aiko-`.
- Created `apps/explain-to-aiko/index.html` — Phase 2 120-second spoken explanation exercise.
- Created `apps/explain-to-aiko-60/index.html` — Phase 2 60-second compression exercise.
- Created `apps/eisenhower-matrix/index.html` — Phase 3 Eisenhower Matrix practice app.
- Created `apps/grocery-list-ai/index.html` — Phase 1 AI practice app.

### 2026-05-17

- Resized context accordion rows in member workspace.
- Added gold/green/locked border states to Phase 1 exercise cards.
- Added Mark as Done toggle button to each exercise card, saving to localStorage (`utl_p1_ex[N]_done`).
- Exercise gating: Phase 1 exercises unlock sequentially as each is marked done.

### 2026-05-13

- Added `admin/index.html` as a static localStorage-powered configuration panel:
  - Password-gated with default password `utl2026_admin`.
  - Controls member hub mission card visibility, footer admin link visibility, TSA Score™ status, phase lock states, slide URLs, and member/admin passwords.
- Updated `member-login/index.html` to read admin configuration from localStorage.
- Created `my-results/index.html`: participant exercise record with assessment section, phase-by-phase exercise cards, progress bar, copy to workbook, download, and send-to-instructor action.
- Added standardized local result saving to active practice apps.
- Added Assessments section to the member hub with The Diagnostic and The Checkpoint cards.

### 2026-05-12

- Redesigned `member-login/index.html` as a structured member hub.
- Created `apps/rushed-voice-memo/index.html`, `apps/rushed-voice-memo-ai/index.html`, `apps/chalkboard-notes/index.html`.
- Moved Grocery List from orientation warm-up into Phase 1 exercise sequence.

### 2026-05-11

- Restructured the member dashboard with core section order: TSA Score™, Orientation, Phase 1, Phase 2, Phase 3.
- Created `apps/find-your-level/index.html` — public email-gated Sort & Bucket exercise.
- Created `data/sort-bucket.json` — root-level public Sort & Bucket question bank (six variations, stable `exercise_id` values).
- Updated `tsa-score.html` with Find your level positioning and locked member assessment cards.
- Migrated testimonials from `assets/testimonials.js` into `data/testimonials.json`.
- Refactored TSA assessment content into `data/tsa/`: `sort-bucket.json`, `spot-the-problem.json`, `speak-concisely.json`, `act-confidently.json`.
- Refactored member practice content into `data/practice/`: `grocery-list.json`, `messy-notes.json`, `issue-tree-builder.json`, `scqa-builder.json`.
- Added lightweight content-management import/export: `/csv/tsa/`, `/csv/practice/`, `/scripts/import-exercise-data.js`.
- Added a site-wide session contact profile (sessionStorage).

### 2026-05-09

- Reworked the Diagnostic into a hub: `apps/tsa-diagnostic/index.html` now shows all Diagnostic sections before participants enter individual exercises.
- Moved Sort & Bucket to `apps/tsa-sort-bucket/index.html`.
- Connected Speak Concisely as active Section 2 Exercise A in the Checkpoint hub.
- Created `apps/tsa-speak-concisely/index.html` as Part 2 Speak Concisely placeholder.
- Added `apps/tsa-act-confidently/index.html` as the Act Confidently placeholder.

### 2026-05-08

- Redesigned TSA Spot the Problem into a two-part assessment (Part A: Find the Overlaps, Part B: Fix the Gaps).
- Updated TSA Checkpoint from a placeholder into a two-exercise hub.

### 2026-05-06

- Wired homepage `Get in Touch` form to Google Apps Script.
- Updated testimonial display so titles and company names are separated.

### 2026-05-05

- Standardized app headers across practice tools.
- Fixed Manager's Messy Notes three-section response mode.
- Updated favicon to blue background and thicker white door.

### 2026-05-04

- Added and refined Phase 1 and Phase 2 practice apps.
- Added Issue Tree Builder with supporting detail structure.
- Added member login landing page access to practice apps.

---

## Page Map (detailed)

### `index.html`

Homepage. Sticky nav, hero, sound-familiar section, three learning pillars, TSA Score™ teaser, stats/credibility, testimonials marquee, closing CTA, footer, lead modal. Testimonials from `data/testimonials.json` into `#testimonialRowOne` and `#testimonialRowTwo`.

### `tsa-score.html`

Find your level page. Routes public visitors to `apps/find-your-level/index.html`. Shows The Diagnostic and The Checkpoint as member-only locked cards. CSS scoped with `tsa-` prefixes.

### `apps/find-your-level/index.html`

Public Sort & Bucket exercise. Lead gate → `sort_bucket_001` only → drag/drop (desktop) + tap-to-move (mobile) → score out of 20 → Apps Script submit (`source: "find-your-level"`).

### `about.html`

About page. Founder story, founder profile, proof and credibility sections.

### `programs.html`

Programs page. Think, Speak, and Act Like an Executive program. Audiences, phases, what to expect, CTA. Contains inline page-specific CSS.

### `contact.html`

Contact page. Full contact form and contact details. Public nav and footer.

### `tools.html`

Tools page. Public/free tools. Uses older navigation pattern. Still includes Find your level and Member Login links.

### `member-login/index.html`

Member learning journey dashboard. Password-gated (local gate + Firebase Google sign-in). Shows phase cards, overall progress bar. Phases 2 and 3 unlock sequentially. Supports first-login name prompt. Links to orientation, phase-1, phase-2, phase-3, my-results, toolkit, admin.

### `member-login/orientation.html`

Orientation page. Shared nav from `content-config.js`. Reads orientation video from `utl_url_orientation` → `UTL_CONTENT.orientation.videoUrl`. Links forward to phase-1.

### `member-login/phase-1.html`

Think Clearly phase page. Watch-then-practice sequence. Tracks watch state with `utl_watched_{lessonId}` and `utl_p1_videos_done`. Sets `utl_p1_done` when all exercises done.

### `member-login/phase-2.html`

Speak Concisely phase page. Locked until `utl_p1_done` and `utl_phase2_status` is not `hide`. Sets `utl_p2_done`.

### `member-login/phase-3.html`

Act Confidently phase page. Locked until `utl_p2_done` and `utl_phase3_status` is not `hide`. Sets `utl_p3_done`. Routes to `my-results/index.html` on completion.

### `member-login/admin.html`

Deprecated redirect to `../admin/index.html`.

### `member-login/content-config.js`

Source of truth for phase-based workspace. Holds `UTL_CONTENT` with orientation, phase lessons, exercise context, and app links. Provides shared `.ws-` scoped styles, member nav rendering, localStorage/Firebase profile helpers, phase rendering, and admin page rendering.

### `my-results/index.html`

Participant exercise record page. Reads `utl_result_*` from localStorage. Shows TSA results, phase exercise results. Copy-to-workbook, download, send-to-instructor actions. No password gate.

### `admin/index.html`

Admin panel. Access via footer link on member dashboard. Default password: `utl2026_admin` (key: `utl_admin_password`). Session key: `utl_admin_auth`. Three top-level tabs: Site & Content, Student Progress, Member Management. Configures video URLs, context media, phase visibility, email templates. Member Management reads/writes Firestore `authorized_members`.

---

## App Map (detailed)

### `apps/find-your-level/index.html`

Public Think Clearly entry point. Details gate, fetches `data/sort-bucket.json`, `sort_bucket_001` only. Drag/drop desktop, tap-to-move mobile. Score out of 20 with interpretation and waitlist CTA. Sends lead + assessment payload to Apps Script.

### `apps/grocery-list/index.html`

Phase 1, Think Clearly. Practice sorting messy grocery list into MECE buckets. Drag/drop desktop, tap-to-move mobile. Timer, reflection flow.

### `apps/messy-notes/index.html`

Phase 1, Think Clearly. Turn messy manager notes into structured response. Open response and three-section modes. Timer, word count.

### `apps/rushed-voice-memo/index.html`

Phase 1, Think Clearly. Turn rushed verbal update transcript into clean structured summary. Sections: Current status, Key blockers, Next steps. Open and three-section modes.

### `apps/rushed-voice-memo-ai/index.html`

Phase 1, Think Clearly. Transcribe voice file via ChatGPT then structure with AI prompt. Five-step transcription block, transcript textarea, collapsible AI structuring prompt.

### `apps/chalkboard-notes/index.html`

Phase 1, Think Clearly. Take chalkboard image notes and organise into MECE buckets. Image placeholder: `assets/chalkboard-notes.jpg`. Sections: Current state, Ideal state, Roadblocks.

### `apps/issue-tree-builder/index.html`

Phase 2, Speak Concisely. Build issue tree from central question, hypothesis, arguments, and supporting details. Desktop tree layout + mobile-friendly. Header timer and word count. Preload fills problem statement only, not subsequent answers.

### `apps/scqa-builder/index.html`

Phase 2, Speak Concisely. Practice writing two SCQA formulations from one context. Context → SCQA #1 → SCQA #2 → Review. Header timer and word count.

### `apps/advisory-board/index.html`

Phase 2, Speak Concisely. Virtual advisory board builder. Pre-filled Olympics example, 8 preset personas + custom, Mode A/B prompt generation, output capture, localStorage saved board. CSS prefix: `ab-`.

### `apps/toolkit/index.html`

Cross-program reference. 5 AI prompt tool cards: MECE Checker, Problem Breakdown, SCQA Sharpener, Decision-Ready Email, Advisory Board (Mode A/B toggle). Member area only. CSS prefix: `tk-`.

### `apps/write-to-aiko/index.html`

Phase 2, Speak Concisely. Answer-first email to Aiko from completed SCQA. Pre-filled Olympics SCQA reference, structured/open writing modes, 80-120 word target, sample answer toggle. Firestore + localStorage save. CSS prefix: `write-to-aiko-`.

### `apps/explain-to-aiko/index.html`

Phase 2, Speak Concisely. 120-second spoken explanation practice. Talk brief → prep screen (email left, talking-points right) → transcript paste. Target: 120s / 220-260 words. Saves `utl_result_explain_to_aiko`.

### `apps/explain-to-aiko-60/index.html`

Phase 2, Speak Concisely. 60-second elevator pitch compression. Same structure as 120s. Target: 60s / 110-130 words. Saves `utl_result_explain_to_aiko_60`.

### `apps/eisenhower-matrix/index.html`

Phase 3, Act Confidently. Prioritization practice across six scenarios. Drag/drop desktop, tap-to-select mobile. Example reveal, try-again reset.

### `apps/i-have-bad-news/index.html`

Phase 3, Act Confidently. Instruction launch page for difficult conversations / delivering bad news. 20-minute timer, links to Difficult Conversations CustomGPT.

### `apps/lets-switch-hats/index.html`

Phase 3, Act Confidently. Instruction launch page for perspective-taking. 15-minute timer, links to Let's Switch Hats CustomGPT.

### `apps/speak-like-obama/index.html`

Phase 3, Act Confidently. Instruction launch page for executive speech delivery. 15-minute timer, links to Speak Like Obama Gemini Gem.

### `apps/tsa-diagnostic/index.html`

TSA Score™ member Diagnostic hub. Section 1 Think Clearly (Sort & Bucket, Spot the Problem), Section 2 Speak Concisely (Short Talk), Section 3 Act Confidently (coming soon). Reads `tsa_sort_score`, `tsa_spot_score`, `tsa_speak_score` from browser storage.

### `apps/tsa-sort-bucket/index.html`

TSA Score™. Exercise A, Think Clearly. Contact gate → random set from 6 → bucket label selection + item sort → score out of 20 → stores `tsa_sort_score`.

### `apps/tsa-spot-the-problem/index.html`

TSA Score™. Exercise B, Think Clearly. Contact gate → Part A Find Overlaps + Part B Fix Gaps → score out of 20 → stores `tsa_spot_score`. Shows combined Think Clearly score (out of 40) when Sort & Bucket score also exists.

### `apps/tsa-checkpoint/index.html`

TSA Score™ member Checkpoint hub. Same sections as Diagnostic. Exercises pass `?assessment=checkpoint`. Shows retake buttons and Think Clearly/Speak Concisely scorecards when results exist.

### `apps/12-in-12/index.html`

Existing app or exercise area for a 12-in-12 challenge. Less recently maintained.

---

## Exercise Data Architecture

### Editing Pipeline

```text
Google Sheets → CSV → script → JSON → commit → deploy
```

- `csv/tsa/` — Google Sheets CSV exports for TSA exercises
- `csv/practice/` — Google Sheets CSV exports for practice apps
- `scripts/import-exercise-data.js` — plain Node.js CSV-to-JSON scaffold
- `data/` — production JSON fetched by the website at runtime

The website never fetches Google Sheets or CSV directly. Browser pages fetch only static JSON from `data/tsa/` and `data/practice/`.

### TSA Assessment Data

```text
data/tsa/sort-bucket.json
data/tsa/spot-the-problem.json
data/tsa/speak-concisely.json
data/tsa/act-confidently.json
data/sort-bucket.json  ← public Find your level only (locks to sort_bucket_001)
```

Sort & Bucket schema: `id`, `title`, `difficulty`, `tags`, `prompt`, `scenario`, `sortingInstruction`, `items`, `bucketOptions`, `correctBuckets`, `answerKey`, `scoring`. `answerKey` maps correct bucket labels to item text strings.

Spot the Problem schema: sets with `partA` (`topic`, `buckets`, `overlaps`) and `partB` (`topic`, `leftItems`, `buckets`, `answers`).

Speak Concisely schema: topics with `id`, `number`, `category`, `title`, `scenario`, `points`, `keyMessages`, `difficulty`, `tags`, `timeLimitSeconds`.

### Practice App Data

```text
data/practice/grocery-list.json
data/practice/messy-notes.json
data/practice/issue-tree-builder.json
data/practice/scqa-builder.json
```

Practice apps currently load the first variation in each JSON file.

Practice JSON schema for future Google Sheets: stable `id`, `title`, `difficulty`, `phase`, `tags`, `prompt`, `timerMinutes`. Grocery: `itemBank`, `keywords`, `idealLabels`, `generation`, `sampleAnswer`, `reflectionPrompts`. Messy Notes: activity config + `sampleAnswer`, `checklist`, `scoring`, `reflectionPrompts`. Issue Tree: `problemStatement`, `sampleAnswer.arguments`. SCQA: `context`, `topicLabel`, `sampleAnswers`.

---

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

---

## Lead Form Integration

Apps Script endpoint (all form submissions + email + feedback):

```text
https://script.google.com/macros/s/AKfycbzJE--FL2kB_XDNZRnszCtlyLRPvaLAHGuF5TAOdXJk40atbvf5Y6ELuSK2B7CSLaMN/exec
```

Submission pattern:

```javascript
await fetch(SCRIPT_URL, {
  method: 'POST',
  mode: 'no-cors',
  body: JSON.stringify(payload)
});
```

Lead payload fields: `name`, `email`, `role`, `message`, `page`, `source`.

`source` values: `contact-form`, `find-your-level`.

Apps Script routes by `action` field: `WelcomeEmail`, `TestEmailTemplate`, `ResultsEmail`. Default (no action) = lead/sheet logging.

---

## Testimonials

Rendered from `data/testimonials.json` into:
- `#testimonialRowOne` and `#testimonialRowTwo` (homepage marquee)
- `#programTestimonials` (programs page, first six)

Fields: `quote`, `name`, `title`, `company`. Current companies are all Uber. Marquee animation is intentionally slow.

---

## CSS Structure

Primary shared stylesheet: `styles.css`

CSS scopes:
- `.home-page` — core public site styling
- `.about-page` — about-specific
- `.contact-page` — contact-specific
- `.programs-page` — programs-specific
- `.tsa-...` — TSA Score™ page and homepage teaser

New TSA Score™ styles must remain scoped with `tsa-` class names to avoid collisions.

Shared Design Patterns:
- Public site nav: `site-nav` pattern. Logo left. Active state: `class="nav-link-active" aria-current="page"` → gold underline.
- Footer: `.site-footer` — logo, tagline, nav links, copyright.
- App header: navy sticky. White logo (links to homepage) → divider → gold Roboto Mono phase label → white Playfair Display title → timer + controls right.
- Timer: "Elapsed Time" gold label, white Roboto Mono time, eye icon to hide/show, pause/play/reset icons.
- Buttons: primary = gold bg + navy text. Secondary = navy outline or white/transparent. App controls = compact icon buttons.
- Cards: white bg, subtle border, 4-12px radius, soft shadow, gold accents.

---

## Future Build Notes (archived 2026-05-30)

- Add production lesson video URLs and context media URLs to `member-login/content-config.js` once final assets are approved.
- Decide whether member workspace admin URL changes should remain browser-local or move to a publishable static JSON/config workflow.
- Add actual scoring logic using the C³ Rubric™.
- Decide whether TSA results are purely local or submitted somewhere.
- Continue aligning all app headers and timers.
