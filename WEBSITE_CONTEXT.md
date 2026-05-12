# The Untaught Lessons Website Context

Last updated: 2026-05-11  
Primary purpose: Living implementation and design reference for The Untaught Lessons static website and practice apps.

Use this file when referencing the site with other tools. It should be updated whenever pages, apps, visual rules, navigation, routing, forms, or core functionality change.

## Change Log

### 2026-05-11

- Restructured the member dashboard into five workbook and assessment sections:
  - TSA Score™.
  - Workbook A, Think Clearly.
  - Workbook B, Speak Concisely.
  - Workbook C, Act Confidently.
  - More Tools.
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
- Added trademark usage rules for `TSA Score™`, `C³ Rubric™`, and standalone `Think. Speak. Act.™`.
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

## Update Protocol

When the site changes, update this file in the same work session.

Update these sections as needed:

- `Change Log`: Add the date and a concise list of meaningful changes.
- `Page Map`: Add, rename, or remove public pages.
- `App Map`: Add, rename, or remove practice apps.
- `Design System`: Update fonts, colors, logos, favicon, spacing, card styles, or shared UI patterns.
- `Functionality`: Update timers, forms, login gating, scoring, app interactions, or routing.
- `Known Notes`: Add current limitations, placeholder states, or decisions that future tools should respect.

Use absolute dates in the change log. Keep entries practical and implementation-focused.

## Site Overview

The Untaught Lessons is a static HTML, CSS, and JavaScript website for teaching practical skills around thinking clearly, speaking concisely, and acting confidently.

The site is intentionally lightweight:

- No backend code in the repo.
- No npm packages.
- No build process.
- No framework.
- Pages run directly in the browser through static hosting.

Primary local preview URL:

```text
http://127.0.0.1:8061/
```

Typical local server command:

```bash
python3 -m http.server 8061 --bind 127.0.0.1
```

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

Use `Think. Speak. Act.™` when it appears as a standalone tagline, title, hero phrase, or title-style phrase.

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
- Testimonial marquee through `assets/testimonials.js`.

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

- Explains the Think. Speak. Act.™ program.
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

Member tools landing page.

Purpose:

- Password-gated workspace for practice tools.
- Lists tools after access.

Current visible tools include:

- Grocery List
- Manager's Messy Notes
- Issue Tree Builder
- SCQA Builder

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

### `apps/tsa-diagnostic/index.html`

Phase:

- TSA Score™.

Purpose:

- Member Diagnostic hub for the baseline TSA Score™ assessment.
- Routes participants into available Diagnostic exercises and shows completion progress.

Current sections:

- Section 1, Think Clearly:
  - Exercise A, Sort & Bucket, links to `../tsa-sort-bucket/index.html`.
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

- Exercise A of TSA Diagnostic Part 1, Think Clearly.
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

- Exercise B of TSA Diagnostic Part 1, Think Clearly.
- Assesses whether the participant can detect overlap and gap problems in a pre-organized structure.

Key functionality:

- Contact gate before the assessment loads.
- Randomly selects one of five assessment sets.
- Uses a two-part drag/drop and mobile tap workflow:
  - Part A, Find the Overlaps, asks participants to move duplicate ideas back to the left across three random problems.
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
  - Exercise A, Sort & Bucket, links to `../tsa-sort-bucket/index.html?assessment=checkpoint`.
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

- Google Sheet admin changes are pending Google Drive connector reconnection:
  - Rename sheet ID `10iQByFqVCffHanZbbHLnYj7Csbet4fgOCd2FWDzEqkE` to `[Website] UTL leads and assessments`.
  - Add an `Assessments` tab with columns `email`, `assessment_type`, `version`, `score`, `variation_id`, and `submitted_at`.
  - Add a `source` column to the contacts tab if it does not already exist.
- The current Google Apps Script endpoint must route Find Your Level assessment payloads to the future `Assessments` tab. The static site already sends the required assessment fields.

## Lead Form Integration

Homepage lead form submits to Google Apps Script:

```text
https://script.google.com/macros/s/AKfycbzJE--FL2kB_XDNZRnszCtlyLRPvaLAHGuF5TAOdXJk40atbvf5Y6ELuSK2B7CSLaMN/exec
```

Submission pattern:

```js
await fetch(SCRIPT_URL, {
  method: 'POST',
  mode: 'no-cors',
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
assets/testimonials.js
```

Homepage loads the script and fills:

- `#testimonialRowOne`
- `#testimonialRowTwo`

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

## Git and Deployment Notes

Current branch may contain uncommitted changes. Before committing:

- Review `git status --short`.
- Do not stage `.DS_Store` files.
- Do not revert unrelated user changes.
- Keep commits focused on the requested site changes.

Static preview should use:

```text
http://127.0.0.1:8061/
```

## Future Build Notes

Likely next work areas:

- Build the TSA Diagnostic assessment.
- Build the TSA Checkpoint assessment.
- Add actual scoring logic using the C³ Rubric™.
- Decide whether TSA results are purely local or submitted somewhere.
- Continue aligning all app headers and timers.
- Keep `WEBSITE_CONTEXT.md` updated with each meaningful change.
