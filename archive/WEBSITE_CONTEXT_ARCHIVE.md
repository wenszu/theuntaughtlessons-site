# WEBSITE_CONTEXT Archive

Archived from `WEBSITE_CONTEXT.md` on 2026-05-30.
Contains entries older than 2026-05-27 and reference sections moved to reduce token load.
Current implementation facts live in `WEBSITE_CONTEXT.md`.

Extended on 2026-07-30: moved entries from 2026-05-27 through 2026-07-22 here. `WEBSITE_CONTEXT.md`'s Change Log now only keeps roughly the last 3 days of entries — archive here whenever it grows past that.

Extended on 2026-09-13: moved entries from 2026-07-29 through 2026-08-11 here (had been sitting well past the 3-day window).

---

## Change Log (2026-07-29 through 2026-08-11)

### 2026-08-11 — Retired v1 TSA assessment; the unified diagnostic is now the sole assessment

- v1 (`apps/tsa-diagnostic/`, `apps/tsa-checkpoint/`, `apps/tsa-sort-bucket/`, `apps/tsa-spot-the-problem/`, `apps/tsa-speak/`, plus the placeholder stubs `apps/tsa-act-confidently/` and `apps/tsa-speak-concisely/`) was never finished (Speak/Act were literal placeholder pages) and saw no real production use, per the user. Deleted all seven app folders, their content data (`data/tsa/*.json`), and the v1-only `tests/diagnostic-ux.test.js`. Renamed `apps/tsa-diagnostic-v2/` → `apps/tsa-diagnostic/` so the URL drops its version suffix now that there's only one build. Member-facing names are unchanged — "the Diagnostic" (before the program) and "the Checkpoint" (after) — the checkpoint is served from the same file via `?assessment=checkpoint`. `apps/find-your-level/`, `data/sort-bucket.json` (root), and `data/tsa-score-bands.js` are a separate, unrelated public teaser feature and were not touched.
- Fixed two pre-existing bugs in the renamed assessment while it was becoming the sole path: (1) a stale `rubricVersion` string mismatch between `blank()` and `load()` meant in-progress attempts never actually resumed on reload — every reload silently restarted the member's progress; fixed by aligning the two strings. (2) `results()`'s copy said "During the pilot..." — reworded now that this is the permanent, sole assessment, while keeping the honest "still calibrating against real learner responses" caveat.
- Rewired every place that pointed at the retired v1 paths or the v1/v2 toggle: `admin/index.html` (removed the `tsaDiagnostic` version-toggle radio/publish mechanism from the shared "Member exercise versions" block — the other three toggles, explainToAiko120/60 and eisenhowerMatrix, are untouched — but kept a simplified static "preview scenario sets" card so the 6 form-preview links, A/B/C × diagnostic/checkpoint, aren't lost; cleaned up `renderQuickLinks()` and the Content Library's 4 now-dead `data/tsa/*.json` entries), `member-login/content-config.js` (`assessmentsSection()`, the real Learning Journey card generator, now hardcodes the sole assessment path and drops the admin-only "Assessment C" preview card that only made sense while v2 was an alternate; also deleted a dead link-rewriting branch and removed `tsaDiagnostic` from the shared `aikoVersions` object).
- **Fixed the site's long-standing "no honest before/after comparison" limitation** as a direct consequence of the migration: v1's diagnostic and checkpoint shared one live set of three sub-exercise score keys, so the checkpoint silently overwrote the diagnostic's scores. v2 already wrote fully independent keys per kind (`utl_result_tsa_diagnostic_v2` / `utl_result_tsa_checkpoint_v2`); rewrote `my-results/index.html` to read those instead (`tsaResultFor(kind)`, replacing the four v1-only functions/consts `ASSESSMENTS`-adjacent `TSA_SUBSCORES`/`tsaSubscoreValue`/`tsaAssessmentStatus`/`tsaSubscoreText`), fixing all three consumers (the Assessments accordion, the collapsed-section summary count, and the downloadable results-text export — the last of which had the same shared-state bug independently). The accordion now shows total + Think/Speak/Act breakdown per assessment plus a delta line once both exist. Added `tests/my-results-tsa-independence.test.js` guarding against regressing back to the shared keys.
- `UTL_TSA_scoring_framework.md` and `ASSESSMENTS_AND_GROCERY_REFERENCE.md` (the latter found mid-task to contain substantial v1-specific scoring detail, expanding scope slightly from the original ask) were marked archived/superseded with a pointer to where scoring actually lives now (`deterministic()`/`scoreAll()`/`scoreText()` in `apps/tsa-diagnostic/index.html`) rather than rewritten — a full C³ Rubric-to-v2 rewrite was explicitly deferred per user decision. `ASSESSMENTS_AND_GROCERY_REFERENCE.md`'s "Public Find your level" sections are unrelated and were left untouched.
- Full `tests/*.test.js` regression pass is green (this is also what CI runs, per `.github/workflows/security-checks.yml`).

### 2026-08-05 — Public site audit + alignment fixes (programs.html, index.html, about.html, contact.html, tsa-score.html)

- User shared the firm-facing pitch deck ("Think, speak and act like an executive — program overview (cohort) v2.pdf") and asked for a review-only audit of the 5 public pages against 5 criteria: alignment with the member work area, alignment of look and feel, reduced AI phrasing, consistent terminology, and general informativeness. Explicit constraint: **do not publish pricing anywhere on the public site**. Delivered findings as an Artifact first, implemented nothing until asked.
- User then said "let's fix everything you recommended" and answered 3 clarifying questions, which set scope:
  - **FAQ placement**: a new section on `programs.html` (not a separate tab, no pre-existing hidden FAQ existed anywhere on the site).
  - **Look and feel**: user explicitly rejected my recommended "tone down toward whiteboard simplicity" and chose **"keep the marketing energy, just fix the italics"** instead — flip-cards, testimonial marquee, animated stat counters, and scroll-reveal animations on the public pages were deliberately left untouched. Only italic styling on 4 heading-level selectors (`.program-heading`, `.program-hero h1`, `.phase-name`, `.closing-program-cta h2`) was removed; the other 11 italic instances (body/caption/quote text) were left as-is.
  - **Cohort vs. self-led tracks**: describe both tracks on the page, no prices shown for either.
- Fixed real data drift between `programs.html`'s marketing copy and the member portal's actual curriculum (`member-login/content-config.js` is the source of truth): phase exercise counts were stale (site said 7/7/5, actual is 6/6/4 per phase), Phase 1's video list included a phantom "Introduction" video that doesn't exist, and phase/total time estimates were recomputed from real `estimatedMinutes` + parsed video durations (Phase 1 ~1h45m, Phase 2 ~1h55m, Phase 3 ~2h20m, total ~6h including ~2h video + ~4h exercises — replacing stale ~7h/2.5h/4.5h figures).
- Added ™ mark on first mention of "Think, speak and act like an executive" on `index.html`, `about.html`, and `contact.html` (matching `programs.html`'s existing convention: a bare `™` Unicode character inline, not the `&trade;` entity, not wrapped in the unused `.program-trademark` span), and introduced the "Also known as Think. Speak. Act." shorthand in the `programs.html` hero copy so the two names are explicitly tied together for the first time.
- Added a certificate-of-completion mention to the "What to expect" copy on `programs.html` (previously unmentioned on the public site despite being a real program feature) and rewrote the 3 audience cards (Students/Professionals/Organizations) for varied sentence rhythm per the "reduce AI phrasing" ask.
- Added two new sections to `programs.html` between "What to expect" and "Testimonials": `#how-to-join` (cohort-based vs. self-led tracks, no pricing) and `#faq` (4 questions: who designed it, does it teach AI, is there a certificate, what if someone misses a live session — links to `/about.html` for founder background rather than duplicating it). Confirmed cream/deep-cream section backgrounds still alternate correctly with no two adjacent sections sharing a background.
- Fixed one em dash on `tsa-score.html` (site-wide convention is no em dashes in prose, per `context/voice-editor.md`).
- **Known latent gap, not fixed this pass**: the deck's simplified marketing exercise names (e.g. "Sending Aiko our first email") differ from the actual member portal exercise titles (e.g. "Write to Aiko"). Not a live bug today since the public site doesn't name individual exercises, but worth reconciling if the site ever does.
- Verified via tag-balance check (section/div/article/h2/h3/p/span counts all matched) across all 5 files, inline `<script>` syntax check, and a full `tests/*.test.js` run (all green — confirmed none of the existing tests reference these 5 root-level public pages; all `index.html`-matching test hits are against unrelated files like `apps/*/index.html`, `admin/index.html`, `member-login/index.html`).

### 2026-08-04 (cont. 3) — Daily Mission planner: 20% time buffer

- Members reported that missions they picked (15/30/45-minute options built by `missionOption()`/`uniqueMissionOptions()` in `member-login/content-config.js`) took noticeably longer than the picked time in practice.
- Investigated the packer: it's a plain greedy accumulation with **zero buffer anywhere** — video minutes come from the real parsed MM:SS duration, exercise minutes come straight from `estimatedMinutes`, and both are summed with no allowance for the real overhead of switching between activities (loading the next video, granting mic permission, waiting on AI scoring, general re-orientation). Individual number accuracy aside, that's a structural gap that compounds across every bundled activity.
- Added `MISSION_BUFFER_FACTOR = 0.8`: `missionOption()` now stops adding activities once the running total would exceed 80% of the picked target, leaving ~20% of each mission's nominal time as real headroom, confirmed by the user as the preferred buffer size over 10%/30% alternatives offered.
- Left the individual `estimatedMinutes` values alone this pass — cross-checked the current numbers against the detailed content-based analysis from the 2026-08-04 timing-panel review and found several have already been recalibrated since (some now close to that analysis, a couple deliberately raised further, in ways that may reflect real usage data this session doesn't have visibility into) — didn't want to unilaterally overwrite a correction someone already made without knowing why. The buffer fix addresses the structural gap directly; specific numbers can be revisited if the complaints persist after this ships.
- **Known remaining edge case, flagged but not fixed this pass**: the packer always includes the first unwatched task regardless of size (existing fallback, to guarantee a mission is never empty). If that first item alone is large (e.g., Speak like Obama's video rounds to 22 min), the "15 minute" and "30 minute" options both collapse to that same single oversized item — the displayed number is still honest (`missionOptionHtml()` renders the real computed `option.minutes`, e.g. "About 22 minutes," never the smaller nominal target), but the option loses its "quick" framing and `uniqueMissionOptions()`'s dedup logic merges what would otherwise be 3 distinct choices down to fewer. A real fix would mean either reordering tasks out of curriculum sequence or accepting there's genuinely no small option available at that point in the journey — a product decision, not implemented here.
- Verified via direct extraction and execution of `missionOption()` against realistic task data: confirmed a 45-minute mission now packs to a real ~29 minutes instead of running flush to 45, and confirmed the oversized-first-item case still displays its true total rather than a misleadingly small one. Full test suite green throughout.

### 2026-08-04 (cont. 2) — Explain to Aiko: fixed missing cache-busting + rewrote prep instructions

- `apps/explain-to-aiko/aiko.js` and `aiko.css` were loaded with no cache-busting version string at all (`<script src="aiko.js">`, unlike every other shared asset on the page), so a browser could silently keep serving a pre-edit copy after any change to this file — this is very likely why earlier fixes in this file didn't appear to "take" on localhost. Added `?v=20260804-practice-2` to both references in `apps/explain-to-aiko/index.html` and `apps/explain-to-aiko-60/index.html`; bump this value on every future edit to this shared file, matching the convention already used elsewhere on the site.
- Rewrote `renderPreparation()`'s instructional copy, which still relied on unexplained business jargon ("make the structure audible," "lead with the point") without ever addressing why there's an email to look at or what "explain, don't read" actually sounds like in practice:
  - New concrete framing per mode: the 120s screen now opens with "You already wrote Aiko an email. Now imagine she stops by your desk and says, 'Can you just tell me about that, real quick?' You would not read your email out loud from memory..."; the 60s screen frames compression as "Aiko is in a rush and only has 60 seconds to listen."
  - Added a new visual "Reading it word-for-word (avoid this)" vs. "Explaining it in your own words (aim for this)" side-by-side comparison (`.aiko-compare`, new CSS) with two short quoted examples, so the distinction the copy describes is also demonstrated concretely rather than left abstract.
  - Reworded the "What your talk needs to do" checklist in plain terms ("Say your main point first," "Give 2 to 3 short reasons") instead of "Open with the conclusion" / "Make the structure audible."
  - Left "BSP" unexplained deliberately — it's taught earlier in the curriculum (Phase 1's Manager's messy notes) and reused consistently across later exercises without redefinition, same as "MECE"; this is a different situation from the reading-vs-explaining gap, which had no explanation anywhere before this.
- Verified via per-function HTML tag-balance check (all balanced), full test suite green, and direct extraction of the new copy to confirm both mode variants render as intended. Caught and fixed two em dashes in my own first draft of this copy before finalizing, per the site's established "no AI-ish dashes" convention from earlier this session.

### 2026-08-04 (cont.) — Explain to Aiko: optional two-round practice (120s then 60s)

- Built the optional practice feature discussed in the entry below: explain a new topic in 120 seconds, then immediately compress the same idea to 60 seconds, mirroring the two required exercises. No MP, does not affect required completion.
- **Safety-first architecture**: rather than modifying the required exercise's recorder/scoring pipeline (`renderRecording`, `initializeRecorder`, `startRecording`, `tick`, `stopRecording`, `submitForScoring`, `renderResults`, `saveResult` in `apps/explain-to-aiko/aiko.js`) to be mode-aware, practice mode is an entirely separate, additive set of functions (`renderPractice*`, `pr*` recorder state) with its own DOM ids (`practice*` prefix) and its own recording-state object (`pr`), so the required, MP-earning flow is literally untouched — confirmed via the full existing test suite staying green throughout, plus direct extraction-and-execution of the required flow's gating logic. Pure stateless helpers (`escapeHtml`, `wordCount`, `fillerCount`, `formatDuration`, `SCORE_URL`, `SPEECH_RECOGNITION`, `RING_CIRCUMFERENCE`) are reused as-is since they carry no required-flow state.
- Runs entirely on the 120s app's page (`explain-to-aiko/index.html?practice=1`) — both recording rounds happen there via the duplicated parameterized recorder (`pr.targetSeconds` swaps between 120 and 60 mid-session), so no cross-page navigation is needed mid-practice. Real AI feedback is reused via the same `SCORE_URL` endpoint the required exercise uses (richer than Speak like Obama's practice, which relies on an external Playback link since Explain to Aiko already has in-house scoring).
- Storage mirrors the per-topic-workspace pattern already proven for SCQA and Speak like Obama: `utl_explain_aiko_practice_workspaces` (map keyed by topic id, holds both rounds' transcripts/scores + notes + improvement + stage) and `utl_explain_aiko_practice_attempts` (array of completed combined rounds). A 6-topic bank (`PRACTICE_TOPICS`) covers everyday/school/community/work situations, same data shape as Speak like Obama's.
- Clear upfront instructions per the user's explicit request: `practiceShell()`'s intro (shown on every practice screen) states "This practice has two rounds... first a 120-second explanation, then a 60-second compression," repeated on the picker screen's own heading and reinforced by the round-1/round-2 progress labels and the "Now compress it to 60 seconds →" button between rounds — nobody should discover the second round only after starting the first.
- **Entry points, deliberately gated on `utl_p2_ex5_done` AND `utl_p2_ex6_done` both being true** (not either alone), since the practice rehearses the *pair*, not one exercise:
  - In-app: the 60s exercise's own "Well done" completion screen (the moment that actually completes the pair) gets a "Practice another explanation" link alongside "Back to Learning Journey." The 120s completion screen intentionally does not, since finishing just 120s doesn't yet unlock the paired skill.
  - Learning Journey: both row 2.9 (120s) and row 2.10 (60s) offer the same "Practice another explanation" / "Resume practice" action in their preview drawer once both are done, always pointing at the one canonical practice URL (the 120s app) regardless of which row was clicked — added `explainAikoBothRequiredDone()` and `explainAikoPracticeState()` to `member-login/content-config.js`, following the exact same shape as `speakingPracticeState()`.
  - Defensively checks `activity.href` doesn't contain `-v2` before offering practice, since Admin Console can roll either exercise back to the older self-recorded `-v2` alternate, which doesn't have this feature.
- Verified extensively given the risk to required, graded functionality: HTML tag-balance check per new screen function (8 screens, all balanced), full storage/state-machine simulation (create → resume → cross-topic isolation → stage transitions survive a simulated fresh-page-load resume → completion archives to `_attempts` and clears the `_workspaces` entry, sibling topics untouched), the required-flow completion-link gating logic (only mode 60 + both done shows the link, never mode 120, never with only one done), and all five realistic Learning Journey row states (neither/one/both done, with/without an in-progress draft, and the v2-rollback suppression) rendered via direct extraction of the real functions from both files. Full test suite green throughout, including before-and-after runs to confirm zero regression in the required flow's own contracts.

### 2026-08-04 — Explain to Aiko: show the learner's own email, not a fixed example

- User feedback: the "Email to Aiko" reference card on the prep screen confused learners (unclear why it was there), and because it was already well-written, kids were just reading it verbatim instead of practicing their own notes/delivery.
- `apps/explain-to-aiko/aiko.js` (shared by both `explain-to-aiko` and `explain-to-aiko-60`, so one edit covers both): added `readOwnEmail()`, which reads the learner's actual composed email from `localStorage['utl_result_write-to-aiko']` (the `.response` field `write-to-aiko` already saves on completion). `sourceEmailHtml()` now shows that as "Your email to Aiko" with a note explaining what it is and why ("Explain the same logic out loud instead of reading it"), with the original fixed `EMAIL_TO_AIKO` demoted to a collapsed "See an example email instead" disclosure. If the learner hasn't completed Write to Aiko yet (no saved result), it falls back to the fixed example, honestly labeled "Example email to Aiko" rather than implying it's theirs.
- `apps/explain-to-aiko/aiko.css`: added `.aiko-source-note` (small steel-colored explanatory line) and `.aiko-example-toggle` (bordered `<details>`, matching the existing `.aiko-phone` disclosure pattern already used lower on the same page) — both files are shared with `explain-to-aiko-60` via relative path, so no duplicate edits needed there.
- Verified both branches (own email present / absent) by extracting `sourceEmailHtml()` directly from the file and calling it against a synthetic `utl_result_write-to-aiko` value. Full test suite green throughout.
- Also discussed (not built, per explicit request): an optional practice mode for Explain to Aiko mirroring Speak like Obama's, but spanning both the 120s and 60s durations. Since `aiko.js` already parameterizes duration via `mode`, the recommended direction is one practice flow that runs both takes back-to-back on a single page (prep once, record at 120s, feedback, then compress the same notes to 60s, feedback again, one saved practice record) rather than two independent practice add-ons — this actually practices the compression skill the required exercise chain teaches, instead of just repeating it at two disconnected lengths.

### 2026-07-31 — Unified TSA diagnostic

- Added `apps/tsa-diagnostic-v2/index.html` as a parallel single-shell assessment. The existing diagnostic and checkpoint remain intact. The new flow is Welcome → Think/organize → Think/spot → Speak → Act → Results, with three neutral parallel forms (A/B/C), tap-based interactions, local autosave/resume, separate diagnostic/checkpoint records, in-browser recording and live transcript where supported, and an equal typed fallback.
- The official always-available score totals 100 points: Think 40, Speak 30, Act 30. `functions-aiko/index.js` now exposes `scoreTsaDiagnostic`, which adds optional evidence-based Speak and Act comments but cannot alter the official score; it returns `{ fallback: true }` on failure. The browser stops waiting after eight seconds and completes with deterministic scoring. AI, network, microphone, and transcription failures never block completion or rewards.
- `settings/assessment_versions.tsaDiagnostic` controls member routing from the Learning Journey. Internally, `v1` safely opens the existing multi-page assessment and `v2` opens the unified diagnostic (plus `?assessment=checkpoint` for the checkpoint). Admin controls and direct previews are under **Assessments & exercise experiences → Live exercise experience**, where these are labeled by experience rather than version number.
- Resumable state uses `utl_tsa_unified_{diagnostic|checkpoint}_v2`; completed snapshots use `utl_result_tsa_{diagnostic|checkpoint}_v2`. The completed Firebase payload uses a stable attempt ID and includes assigned/actual form, item-level responses, transcripts, response mode, measured duration, deterministic subscore details, optional AI comments, and rubric version. Keep baseline and checkpoint keys separate. The results screen appears even when remote services fail, shows the central-save state separately, retains failed saves locally, and retries them when the browser returns online or the results page becomes active. Results are explicitly labeled provisional/directional until real-user calibration establishes form equivalence and defensible bands.
- Exercise duration estimates are canonical in each exercise's `estimatedMinutes` field in `member-login/content-config.js`. Learning Journey rows and drawers, Daily Mission options, and welcome-card plan totals derive from those values. As of this update, each phase's exercises total 80 minutes. Exercise pages with their own visible brief (`eisenhower-matrix`, `i-have-bad-news`, `lets-switch-hats`, and `speak-like-obama`) mirror the same values; `tests/exercise-duration-contract.test.js` prevents drift.
- Unified diagnostic usability pass: Challenge 1 follows the Grocery List source-panel plus three-bucket layout, with horizontally scrollable buckets on phones. Challenge 2 Part 1 starts with worked same/related examples, then delivers five multiple-choice overlap questions from a 20-item bank; each correct answer earns one point. Every Part 1 form follows a `1 accessible / 3 moderate / 1 hard` ramp. Part 2 delivers ten questions from a separate 36-item structure bank covering gaps, mixed levels, misplaced ideas, and stronger revisions; each correct answer earns 1.5 points. Every Part 2 question includes `None of the above`, permanently displayed as the last choice, with two keyed uses in every delivered form (20%). The four substantive choices use attempt-seeded answer positions; saved legacy orders that placed `None` elsewhere are repaired on render. Six explicit baseline/checkpoint sets use a `2 accessible / 6 moderate / 2 hard` Part 2 ramp, store question IDs and option order, and share zero questions across each assigned baseline/checkpoint pair. The canonical 56-item bank contains `10 accessible / 33 moderate / 13 hard` questions (about 18% / 59% / 23%). Medium and hard items use ninth-grade-readable language with same-domain distractors, multi-layered scenarios, and explicit organizing rules. All Mixed Levels items use one standardized question followed by an explicit cue stating whether to find a specific example, a parent category, or a result among its drivers. The `mc8` refinement keeps the earlier conceptual overlap upgrades and applies the G4/G5 hierarchy model to G6, G7, and G9: each wrong choice is now a child example inside a category already present rather than a separate off-topic concept. Every item has an item-specific answer rationale and versioned review metadata. Difficulty labels remain hypotheses until pilot response data measures actual item facility and discrimination. Parts 1 and 2 are worth 5 and 15 points respectively, preserving the 20-point Challenge 2 and 40-point Think ceilings while giving broader structural reasoning more weight than paraphrase recognition. The `mc8` rubric resets incomplete older diagnostic attempts so stored question and answer mappings cannot cross rubric versions. Speak/Act response-method controls are neutral segmented choices (`Use microphone` / `Type my response`) so the circular `Start recording` control is the only primary recording action. Scenario facts use bolded summary phrases ending in colons, and routine scenario cards no longer use a decorative gold top rail.
- Unified diagnostic calibration: Member-facing results say `Your TSA profile` without exposing internal A/B/C form codes. Admin previews use descriptive scenario-set names (`Everyday decisions`, `Planning under pressure`, and `Community choices`). Placement controls share the same 14px Lato interface typography. Part 1a explicitly requires a timing-based structure and uses dependency- or deadline-based details, so its predetermined labels measure applying a stated rule rather than choosing the author's preferred organizing dimension. Part 2 does not prefer a particular recommendation; any supported option can earn full credit. Its deterministic evidence groups include plain-language semantic variants. Part 3 treats every available first action equally, but its six choice points require the learner to select an action and explicitly commit to it; reasoning, acknowledgement of pushback, and next step differentiate performance. The Speak and Act fallback rubrics cap responses that do not state an original recommendation or decision, preventing copied prompts and context from earning mid-range scores.
- TSA C³ scoring uses auditable, punctuation-neutral deterministic rubrics: Speak is Leads 8 + Supports 14 + Focuses 8, and Act is Decides 10 + Adapts 12 + Advances 8. Missing-recommendation and missing-decision gates remain 10 and 8 respectively. Admins have separate, centrally stored GenAI scoring switches for Speak and Act; both default off. An enabled section uses a validated GenAI C³ score as official, silently falls back to its deterministic score on any failure, and always logs the deterministic, GenAI, and per-dimension differences in the private `tsa_scoring_comparisons` collection for later calibration. Disabled sections do not call GenAI. Learners never see scorer provenance or fallback status.
- Content Data includes a complete `Assessment content review` workspace and Item Health view. Separate collapsible sections load Parts 1a, 1b, 2, and 3 directly from `apps/tsa-diagnostic/index.html`, including every A/B/C form, learner instruction, scenario, keyed content, scoring allocation, and configured evidence terms. Each form card opens that section in the assessment's real learner UI; Part 1b has a dedicated sequential preview of all 45 bank questions. Preview state stays in memory, never writes learner progress or item telemetry, and ends with a return to Content Data. A top-level guide explains the assessment journey, high-level rubrics, exact deterministic scoring, and the planned GenAI shadow-scoring comparison for Parts 2 and 3. Admins select any combination of parts and download one standard UTF-8 CSV file per selected part, or one structured JSON file. Part 1b retains its format/search filters, keyed-answer display, standalone bank downloads, and collapsible Item Health table. The current bank begins item-level versioning at v1 under bank release `2026-08-13-v1`. Completed attempts save current-version percent-correct inputs, diagnostic/checkpoint split, response time, answer changes, answer distribution, discrimination inputs, and optional learner quality reports without transcripts. Item Health labels fewer than 30 responses as collecting, 30–49 as an early signal, and applies documented automated review rules from 50 responses onward. Admins separately control Active/Watch/Revise/Retired review status and maintain a timestamped decision log for each item.
- Challenge 2 uses an explicit two-part learner flow. A compact step header distinguishes `Part 1 · Find repeated ideas` from `Part 2 · Answer 10 questions`; Part 1 ends with a prominent `Next: 10 quick questions` preview and `Start Part 2` button. Part 2 renders one question at a time with progress, persistent Previous/Next controls, editable selection, visible selection confirmation, and explicit DOM event bindings that do not rely on element IDs becoming browser globals.

### 2026-07-31 — SCQA single-build review and optional scenario practice

- `apps/scqa-builder/index.html` now requires one complete SCQA instead of a second mandatory reframe. The primary action is `Review my SCQA`; the review screen shows the learner's full S/C/Q/A, a constructive rules-based connection review with bolded summary phrases, and an optional Gemini coherence review.
- Optional scenario practice uses a compact `Your SCQAs` switcher after a second attempt is started. Desktop shows numbered attempt tabs; mobile shows one `Viewing:` selector. Each workspace retains its draft, completion status, rules review inputs, and Gemini feedback, so learners can return to the required Olympics SCQA without leaving the exercise or losing practice work.
- Added `functions-aiko.scoreScqa`, using the existing `GEMINI_API_KEY` secret and the low-cost `gemini-2.5-flash-lite` model. It returns structured JSON, handles its own CORS, and returns `{ fallback: true }` when unavailable so AI never blocks completion. This function must be deployed before live AI review works.
- Completion and reflection MP are awarded once after `Save and finish exercise`, not when the learner merely opens the review. Five optional non-Aiko practice contexts live in `data/practice/scqa-builder.json`; learners may add reasonable details, and practice attempts save separately without duplicate completion MP.
- My Results displays the new single-SCQA payload cleanly while retaining compatibility with older saved two-formulation results. Reframing remains unimplemented pending a final decision on its optional advanced flow.

### 2026-07-31 (cont.) — Site-wide response-field placeholder audit: "Type your answer here."

- Follow-up to the SCQA builder consolidation (cont. 10): the user asked to check every exercise app for the same restated-question-as-placeholder pattern and standardize to the neutral `"Type your answer here."` cue used in `scqa-builder` and `write-to-aiko`, on the reasoning that a persistent hint/label near the field should carry the explanation since placeholder text disappears the instant the learner types.
- Audited every `apps/*/index.html` (via a research agent, then verified each finding directly) for learner free-response `<textarea>`/text `<input>` fields. Standardized the placeholder to `Type your answer here.` in 12 files where a real explanation already exists nearby (label, instruction paragraph, or `mode-guidance` text) and the placeholder was just restating it: `write-to-aiko` (5 structured fields + open draft — done in the prior turn), `messy-notes` (open response + section-response, including the `inputPlaceholder` default in `data/practice/messy-notes.json`), `chalkboard-notes` and `rushed-voice-memo` (same pattern, `inputPlaceholder` hardcoded in each file's own topic-config object rather than an external JSON), `explain-to-aiko`/`explain-to-aiko-60` (shared `aiko.js`, open notes + section notes), `explain-to-aiko-v2`/`explain-to-aiko-60-v2` (open notes + section notes), `tsa-speak` (section notes + open notes, both prep and reflection steps), `eisenhower-matrix` (Round 4 "why" free-text reason + Round 5 written-no), `grocery-list` (bucket-choice reflection), `grocery-list-ai` (AI-output reflection), `issue-tree-builder` (per-argument reason field).
- Deliberately left unstandardized, since the placeholder text there is doing a genuinely different job than "type your own answer":
  - **Paste fields** (`advisory-board`'s AI-output paste box, `explain-to-aiko`'s phone-transcript and text-fallback paste boxes, `explain-to-aiko-v2`/`-60-v2`'s Playback-feedback-or-reflection box, `rushed-voice-memo-ai`'s AI-structured-output box, `tsa-speak`'s transcript box) — these ask the learner to paste external content, not compose an original answer, so `Type your answer here.` would be actively wrong there.
  - **Pre-filled work-sample fields** in `advisory-board` (Problem Statement / Issue Tree / SCQA edit boxes) — these ship with real example text already in them, not an empty box with a placeholder.
  - **`find-your-level`'s lead-gen "What brings you here?" field** — a marketing intake question on the public signup gate, not an in-exercise answer field; out of scope for this consistency pass.
- Verified via `grep` sweep confirming no old restated-question placeholders remain outside the deliberately-excluded fields, `new Function()`/`node --check` syntax validation on every touched file, JSON validity check on `messy-notes.json`, and the full test suite (all green).

### 2026-07-31 — Advisory board: name advisors in the AI prompt's format instructions

- `apps/advisory-board/index.html`'s `buildModeA()` (the "Run your board" copy-prompt) already listed each selected advisor by name in the "THE ADVISORY BOARD" section (`Advisor: ${person.name}`), matching the orchestrator's own listing. But its Step 1 output-format instructions used one generic literal placeholder line, `ADVISOR NAME`, for every advisor, while Step 2's orchestrator format instruction directly interpolated the real name (`ORCHESTRATOR VERDICT: ${orchestrator().name}`) — an asymmetry the user noticed and asked to fix so every named advisor is actually named wherever the orchestrator is.
- Replaced the single generic placeholder with `${selectedPeople().map(...)}`, repeating the same `[Name] / What I like / What I would challenge or cut / What I recommend` block once per selected advisor with their real name as the header — works the same for real names (Steve Jobs) and role-based personas (The Front-Line User) since both are just `person.name`, no special-casing needed.
- `buildModeB()` (the "help me design a board" prompt, used before any board is selected) is unaffected — there are no advisors to name yet at that point, it's asking the AI to invent them.
- Verified by extracting `buildModeA`/`selectedPeople`/`orchestrator` straight out of the edited file and calling them with a synthetic selection (2 named advisors + 1 role-persona + orchestrator); confirmed each advisor's real name now appears as its own format header. Full test suite still green.

### 2026-07-30 (cont. 10) — SCQA builder: one explanation per field, textbook-grounded wording

- Follow-up to cont. 9. Each SCQA field previously stacked three separate text blocks around the input (a `field-hint` paragraph above, placeholder text inside the box repeating the hint in different words, and a `microHintFor` micro-tip below) — the hint/placeholder redundancy was flagged as adding to the confusion rather than reducing it, since the placeholder also vanishes the instant the learner types, so it can't serve as an ongoing reference anyway.
- Consolidated to one persistent explanation per field: `hintFor`/`placeholderFor` were replaced with `explanationFor(part)` (the definition, now grounded in how SCQA/the Pyramid Principle is actually taught rather than an invented phrasing) and `exampleFor(part)` (a concrete, universally relatable worked example — the user's own "family deciding what to eat for dinner" scenario, which doesn't require any business-world knowledge to follow). Both render together under each field (`.field-hint` + new `.field-example`, navy/bold "Example:" lead-in) and are also reused verbatim in `referenceMarkup()` (the sidebar "What each part means" card and the mobile "Show guidance" disclosure), so the explanation is now identical everywhere it appears instead of three near-duplicate phrasings competing for the reader's attention.
- Placeholder attributes on the S/C/Q/A inputs are now a neutral "Type your answer here." (previously a restated question). `microHintFor.s` had its overlapping clause trimmed ("State facts your audience already accepts" — now covered by the persistent hint) but otherwise still carries the format-only tips (sentence count, question-mark rule, etc.), which are a genuinely different kind of guidance from the concept explanation and were kept.
- Verified via `new Function()` syntax-check on the inline script and by extracting `scqaFieldsMarkup`/`referenceMarkup` directly from the edited file and calling them to confirm the rendered hint/example/placeholder text and the sidebar reference text match exactly. Full test suite green.

### 2026-07-30 (cont. 9) — SCQA builder: dropped Part A, rewrote the copy

- A user reported `apps/scqa-builder/index.html` was confusing their kids: unclear how to start on the merged "Part A (set your context) / Part B (write SCQA)" screen. Recommendation given and accepted: writing an original business situation from scratch is a harder, unrelated task bolted onto the actual skill (SCQA structuring) — the Olympic case study should be the default, not an opt-in escape hatch.
  - `journeyPhaseActivities`/`buildWorkScreen()` unaffected elsewhere; changes are local to this app. `initializeApp()` and `clearAll()` now seed a fresh `state` with `templateState.context`/`topicLabel` pre-filled (previously blank, requiring the learner to either write their own or click "Load the Olympics template"). The "Part A"/"Part B" heading split is gone; screen 1 is now just "Write your SCQA," and the `how-strip` reads 1/2/3 instead of A/B/2/3.
  - The old always-visible context textarea + "Load the Olympics template" link were replaced with a collapsed `<details class="context-toggle">` inside the sidebar's "Your context" card, labeled "Use your own situation instead" — the custom-context path still exists for advanced learners who want it, but it's opt-in and secondary now, not the first thing on the screen. Its "Reset to the Olympic case study" button (`#resetTemplate`, replacing the old `#loadTemplate` handler) only touches `state.context`/`topicLabel`, not the SCQA fields, so switching back to the case study can't silently wipe answers already written against a custom context.
  - Verified via HTML tag-balance check on the rebuilt template literal, `new Function()` syntax-check on the whole inline script, and the full test suite (`tests/*.test.js`, including `feedback-widget-collision.test.js` and `weekly-audit-experience.test.js`, which both read this file) — all green. No live-browser check was possible (no Playwright/Puppeteer in this environment and installing one would add an npm dependency this static-site repo intentionally avoids); this was flagged rather than skipped silently.
- Rewrote copy across the app to remove "gravity" and em-dash-as-connective-tissue phrasing (both flagged as reading "too AI'ish"):
  - `data/practice/scqa-builder.json`: rewrote the Olympic `context` string and swapped "cultural/Olympic gravity" → "cultural/Olympic relevance" in both `sampleAnswers` entries (the word appeared 5 times across the two sample formulations, not just in the context paragraph).
  - The Situation field's leading question was specifically called out as confusing ("What is still true today... the stable ground your audience stands on before you introduce the tension"). Replaced in both `referenceMarkup()` and `hintFor('s')` with "The plain, agreed-upon facts about the situation today, before you mention any problem," and the textarea placeholder with "What's the current situation, in plain terms everyone would agree on?"
  - Removed em dashes from remaining prose across the app (exercise intro/review subtitles, the reframe callout, the "C" hint, the lever-picker subtitle, both question-mark warnings, the answer-check copy, and the sample-answers notice), rephrasing each as two sentences or a colon rather than a dash-joined clause.

### 2026-07-30 (cont. 8) — Learning Journey "In progress" row state

- A member reported that a Learning Journey exercise row showed "Completed" after they had only reviewed the exercise's setup/context video, not done the exercise itself. Investigated `journeyActivityRowHtml()`/`exerciseDone()` in `member-login/content-config.js`: the "Completed" badge is driven purely by the exercise's own `utl_done_*`/legacy completion key, written only by that exercise app's own "Save and complete" action — never by the separate setup gate (`assets/exercise-context-flow.js`, which only ever writes `utl_context_complete_{id}`). No code path was found where finishing setup alone flips the done flag, so the reported case is most likely stale prior-session state, an admin reset that didn't clear a legacy key, or (worth checking separately) one of these exercises accepting a too-easy "complete" click with little real input — not fixed here.
- Added the "In progress" row state the audit surfaced as a real gap regardless of that root cause: previously a row only had three states (Completed/Up next/Locked), so an exercise where setup was reviewed but the exercise wasn't finished showed as "Up next" (indistinguishable from never having touched it) or, once a later activity became "next," as "Locked" (implying it's inaccessible, which it isn't).
  - `journeyPhaseActivities()`: each exercise now carries `contextGated` (true only when it has a real video/slides setup gate — same check as `contextCompletionAction()`'s guard) and `contextComplete` (reads the existing `utl_context_complete_{id}` key via the already-defined `contextDoneKey()`; no new storage key was introduced).
  - `journeyActivityRowHtml()`: a row is now "In progress" (new fourth state, between "next" and "locked" in priority — checked before the "next" comparison) whenever `contextGated && contextComplete && !done`. Its action link and the preview drawer's CTA both read "Resume" (reusing the same `?setup=1` href, which re-opens the setup gate already marked done with the "Continue to the exercise" tab enabled).
  - CSS: added a `.ws-journey-activity-progress` variant alongside the existing `-done`/`-next`/`-locked` rules in all three places they're defined (base/full row styling, the compact/narrow breakpoint, and the phase-panel state-text color override) — a steel/navy tint (`#E8EEF4`/`--ws-navy`), deliberately distinct from "Up next"'s warm gold so the two don't read as the same status at a glance. A half-filled circle (`&#9680;`) distinguishes its status icon from "next"'s solid dot.
  - Verified by extracting `journeyActivityRowHtml` straight out of the edited file and calling it with synthetic activities for all 5 cases (done, in-progress, next, locked, video) — each produced the expected row class/state text/action label. Full test suite (`tests/*.test.js`) still green.
- Bumped `content-config.js?v=20260730-celebration-1` → `?v=20260730-journey-progress-1` across all 7 referrers (the 6 `member-login/*.html` pages + `admin/index.html`).

### 2026-07-30 — exercise timing estimate review (not yet applied to code)

- User asked for a simulated 5-persona usability panel to check whether the 16 exercises' `estimatedMinutes` values (in `member-login/content-config.js`) are realistic. Built a persona panel (Maya: fast/AI-native student; David: average-pace coordinator; Priya: fast, business-fluent manager; James: slow reader/typer, new to the frameworks; Sofia: careful ESL writer) and modeled per-exercise time from each app's actual reading load, fields to compose, drag/click interactions, and external-AI-tool round trips. Full writeup published as an artifact (not persisted in the repo) — recommended numbers below are the authoritative output; don't re-run this analysis from scratch, just apply it.
- **Recommended `estimatedMinutes` changes** (current → recommended): grocery-list 10→9, grocery-list-ai 15→8, messy-notes 15→16, rushed-voice-memo 20→15, rushed-voice-memo-ai 15→10, chalkboard-notes 25→13, issue-tree-builder 15→7, scqa-builder 10→15, advisory-board 20→15, write-to-aiko 15→9, explain-to-aiko (120s) 15→11, explain-to-aiko-60 15→8, eisenhower-matrix 30→14, i-have-bad-news 20→10, lets-switch-hats 15→10, speak-like-obama 15→20. Net effect: total advertised time across all 16 drops from 270 min to ~191 min — most exercises were overestimated, `scqa-builder` and `speak-like-obama` were underestimated.
- **Real bug found, independent of the panel**: `apps/eisenhower-matrix/index.html`'s own intro card tells the learner "about 12 minutes," but its Learning Journey listing says 30 — the panel's independent estimate (12–14 min) agrees with the app's own copy, not the 30. The 30 looks like a stale value from before the guided v1 rewrite (see the 2026-07-22 entry in the archive). Worth fixing regardless of whether the other estimates above are adopted.
- **Secondary finding, not yet actioned**: `apps/i-have-bad-news`, `apps/lets-switch-hats`, and `apps/speak-like-obama` each end with a "note one thing you'd say differently" reflection prompt, but none of the three has an actual input field to capture a response — there is nothing to fill in before clicking "Mark exercise complete." Flagged for a possible future fix (add a short reflection textarea, consistent with how other exercises capture theirs) but not implemented.
- User is applying the `estimatedMinutes` changes offline (possibly with a different AI/tool on this same branch) rather than having this session make the edit — if you find `estimatedMinutes` values in `content-config.js` that already differ from the current column above, the offline update has already happened; don't overwrite it back to the old numbers.

### 2026-07-31 — certificate polish

- Added the ™ mark to the credential title default ("Think, speak and act like an executive™.") in all three copies (`assets/firebase.js`, `certificate/index.html`'s own fallback, `admin/index.html`'s placeholder) — matches how `programs.html`'s hero title and meta description already mark it on first/primary use; other public-site body copy mentions intentionally omit it, consistent with normal trademark practice of marking the primary usage rather than every mention.
- Added the site logo (`assets/apple-touch-icon.png` — already a tightly-cropped icon+wordmark mark, unlike the other logo source files which have large transparent margins) to the certificate, above the "The Untaught Lessons" label: as a real `<img>` in the HTML certificate, and drawn onto the canvas in `renderCertificateImage()` (loaded via a `loadImage()` helper, same-origin so no canvas-tainting concerns) for the downloaded/shared PNG.
- Changed "You have finished the full program..."/"You finished all three phases..." to open with "Congratulations!" in the two places that used that exact phrasing as their opener: `member-login/content-config.js`'s Learning Journey home certificate card, and `my-results/index.html`'s certificate callout. Left `assets/reward-ui.js`'s program-complete modal alone — it already opens with a celebratory "You did it." headline, so adding "Congratulations!" to its body text would have been redundant.

### 2026-07-30 (cont. 6) — data-safety audit before push

- Traced the program-completion MP bonus change (200→600) all the way through for existing-member safety, since it touches live reward data. Found and fixed two more stale `programCompletion: 200` defaults I'd missed in the earlier pass: `assets/firebase.js`'s `getDefaultRewardSettings()` (the fallback used when the Firestore `settings/rewards` document doesn't exist at all — likely the actual live default for this site) and a defensive `|| 200` fallback in `repairMemberProgramCompletionReward()`, plus a `|| 200` display fallback in admin's Student Progress panel. All four are now `600`, consistent with every other copy.
- Confirmed the reward system cannot lose any existing member's MP from these changes: `awardEvent`/`awardRewardEvent` are purely additive and id-guarded (an already-earned event is never re-awarded or recalculated), and nothing in this session's changes touches or rewrites past ledger entries or `mpTotal` downward.
- Confirmed already-completed members get fairly topped up, not left behind: `awardProgramCompletionBonus()` (client, runs automatically for every real member session via `backfillExistingProgressRewards()`) and `repairMemberProgramCompletionReward()` (server-side Firestore transaction, used by admin's Student Progress panel — both automatically for every completed member when the panel loads, and via a per-student "Award missing MP" button) both compute `missing = max(0, target - alreadyCredited, executiveThreshold - currentTotal)` and add a new ledger entry for exactly that gap — never subtracting. A member who already banked the old 200 MP bonus will automatically receive a "program-completion-adjustment" top-up (visible as a "Prior progress recognized" reward moment client-side, or via the admin repair tools) bringing them to the new 600 MP baseline, fully visible in their reward ledger / My Results reward history.
- Note for the site owner: if the Admin → Rewards panel was ever saved before today, the Firestore `settings/rewards` document has its own persisted `programCompletion` value that overrides the code default — check that field after deploying and re-save if it still shows the old value, or the new 600 baseline won't take effect until it's updated there.

### 2026-07-30 (cont. 5) — pre-push audit

- Bumped stale cache-busting query strings to `?v=20260730-celebration-1` for the shared files substantially edited today: `member-login/content-config.js` (all 7 referrers: the 6 `member-login/*.html` pages + `admin/index.html`), `assets/reward-ui.js`, `assets/reward-events.js` (all ~20 exercise apps + `tsa-diagnostic`), and `assets/app-reward-header.js` (all 20 exercise apps — this one previously had two different stale version strings in circulation, `20260714-audit-1` and `20260729-phase3-4`, now consistent). Updated `tests/weekly-audit-experience.test.js`'s hardcoded version-string assertion to match.
- Found `assets/exercise-context-flow.js` sitting untracked (never `git add`ed) despite being load-bearing: `assets/app-reward-header.js` dynamically injects a `<script src="../../assets/exercise-context-flow.js">` tag to load it on every exercise page (the "Review setup" gate feature). It is not gitignored — just an oversight from earlier in the session. Flagged to the user: this file must be staged along with everything else, or the setup-review feature breaks on every exercise page after deploy.
- Confirmed clean otherwise: no merge-conflict markers, no new `console.log`/`debugger` statements introduced, no secrets/API keys/credentials in the diff, full 16-test suite green.

### 2026-07-30 (cont. 4)

- Fixed a CSS bug on `my-results/index.html`: `.device-notice strong` was a descendant selector, so it also styled the dynamically-injected `<strong>127.0.0.1</strong>`/`<strong>localhost</strong>` inside the nested local-testing hint (`#storageOriginHint`) as block-level elements, breaking the sentence onto disjointed lines (visible in a screenshot). Scoped it to `.device-notice > strong` (direct child only) so it only affects the intended "Saved on this device only." lead-in.
- Added a certificate link in two places, both gated on actual completion:
  - `my-results/index.html`: a gold-bordered "Your certificate is ready" callout near the top of the page, shown only when `APPS.filter(isComplete).length === APPS.length` (all 16 exercises done) — the same condition already used everywhere else on this page.
  - `assets/reward-ui.js`'s `levelPopoverHtml()` (the sticky-nav Level chip's dropdown, shared across every page site-wide via `renderCluster()`): now shows a "View your certificate →" link whenever `state.nextLevel` is empty (i.e. the member is at the top configured level — Executive under current settings), in the same branch that already shows "You have reached the highest configured level!". Added `certificatePageHref()` to resolve the correct relative path (`../../certificate/index.html` vs `../certificate/index.html`) based on whether the current page is under `/apps/` — needed because this single shared function renders at two different directory depths across the site.

### 2026-07-30 (cont. 3)

- Turned assessments (Diagnostic/Checkpoint) off by default, both sites, since they're not ready yet: `assets/firebase.js`'s `getDefaultAssessmentVisibility()` now defaults `userEnabled: false` (kept `adminEnabled: true` so admins/owner can still preview/test), and `getDefaultPublicAssessmentSettings()` now defaults `diagnosticVisible`/`checkpointVisible` to `false`. Synced `admin/index.html`'s corresponding checkbox defaults (removed `checked` from the three "show/see assessments" toggles; left the admin-access toggle checked). Note: both the public `tsa-score.html` and the member dashboard render visible-by-default first, then hide asynchronously once settings resolve — a brief flash is possible on slower connections; this is pre-existing architecture, not something this change introduces or fixes.
- Audited every exercise for step count. Found one outlier — `apps/advisory-board/index.html` had 7 screens vs. 1–3 everywhere else — and consolidated it to 5: merged the intro/FAQ screen into the "example work" screen (FAQ now a collapsed `<details>` disclosure, `.ab-details`/`.ab-qa-list` reused), and merged "Save your board" into the final completion screen (secondary actions, not competing with the primary "Mark as done"/certificate-adjacent gold button). Renumbered `data-screen` attributes 1–5, updated the two hardcoded `showScreen()` jump targets (`buildPromptBtn` 4→3, `newBoardBtn` 3→2), and the "Step N of 7"→"Step N of 5" progress label.
- Certificate updates (`certificate/index.html`, `assets/firebase.js`, `admin/index.html`):
  - Credential title changed from "The Untaught Lessons — Full Program" to "Think, speak and act like an executive." — matching the program's actual established/trademarked tagline already used across the public site (index.html, programs.html, about.html), rather than the shorter alternative offered ("Think. Speak. Act.") which isn't the real brand name. Updated the default in all three places it's duplicated (firebase.js's `getDefaultEngagementSettings`, certificate/index.html's own fallback, admin's placeholder text).
  - Added a cursive rendering of the signatory's name (`.cert-sig-cursive`, Alex Brush via Google Fonts — the page already links Google Fonts directly, unlike Artifacts, so no CDN restriction applies here) directly above the signature line and printed name, mimicking an actual signature.
  - Added sharing, since Instagram has no web-share link at all and Facebook's only pulls a static page-metadata image (not this specific learner's personalized certificate) — confirmed the approach with the user first: (1) "Download image" button that renders the certificate to a PNG entirely client-side via Canvas 2D (hand-drawn recreation of the card — background, borders, corner ornaments, all text — not a DOM screenshot, to avoid the cross-origin webfont-embedding issues that plague foreignObject/html-to-canvas techniques without a library); (2) "Share your achievement" button using the Web Share API (only shown when `navigator.share` exists, i.e. mostly mobile), which opens the native share sheet with a link to `https://theuntaughtlessons.com/`, a caption naming the credential, and the generated PNG attached when the platform supports file-sharing (`navigator.canShare({ files })`). Not visually verified in a live browser — flagged to the user to check rendering before relying on it.

### 2026-07-30 (cont. 2)

- Implemented every finding from the celebration-review artifact. Summary of what changed, file by file:
  - `assets/reward-ui.js` / `member-login/content-config.js`: toasts (`.utl-reward-toast` / `.ws-reward-toast`, used for video/context/streak completions) now have a small pulsing sparkle icon, a warm gold-tinted gradient background, a springier bounce-in entrance (was a flat 0.18s slide, now a 0.3–0.4s overshoot easing), and stay visible longer (4200ms, was 3600/3200ms).
  - `assets/reward-events.js`: `awardScoredExercise()` now applies a `scoredExerciseFirstAttemptFloor` (default 20 MP) to a scored exercise's very first submission, so a genuine but low first score (e.g. 24/100) doesn't earn less MP — and a visibly smaller celebration — than an ungraded reflection exercise. Resubmissions to improve a score are unaffected and stay purely score-driven. Mirrored the same floor logic in `assets/reward-system.js` (the admin preview/simulator) so its live previews match real behavior.
  - `assets/reward-ui.js`: added `showProgramCompleteModal()` — a new, distinct celebration for finishing the entire program, reusing the confetti-streamer/burst treatment already built for exercises and levels, with a gold trophy icon (vs. the green checkmark used for exercises/levels) and a prominent gold "View your certificate" CTA as the visual centerpiece, with "Continue to the Learning Journey" demoted to a plain secondary link. Exposed on `window.UTLRewardUI`.
  - `assets/reward-ui.js`: `handleRewardMoment()` now accepts an optional completion callback for the non-exercise (toast) path, invoked after any level-up modal closes (or immediately if none) — this lets the caller sequence a follow-up dialog instead of both appearing back-to-back/stacked.
  - `member-login/content-config.js`: `applyWithSettings()`'s phase/program-completion handling was restructured to use the above. Program completion now shows the new gold program-complete modal (via `ensureRewardUiLoaded()` + `rewardUi.showProgramCompleteModal`), chained into the level-up modal if one is also due, with the plain phase-completion dialog (`showPhaseCompletionModal`) skipped entirely for that case. Phase-only completions still use the existing toast/level-modal path, now properly sequenced before `showPhaseCompletionModal` (previously fired essentially in parallel/unsequenced, risking a level-up modal appearing on top of the phase dialog for a phase completion that also happened to cross a level threshold).
  - **Correction discovered mid-implementation**: the celebration-review artifact's claim that "Executive may be out of reach even for a diligent member" was wrong — `member-login/content-config.js`'s `awardProgramCompletionBonus()` already tops up the program-completion bonus to whatever's needed to guarantee crossing the Executive threshold (`Math.max(target, executiveThreshold - currentTotal)`), including a follow-up "adjustment" award if the base bonus was already claimed. This safety net was missed during the original review (a research gap, not a real product bug) — reaching Executive on program completion was already guaranteed. Raised the base bonus itself from 200 → 600 MP anyway (`PROGRAM_COMPLETION_MP` in `content-config.js`; `mp.programCompletion` defaults in `assets/reward-events.js`, `assets/reward-system.js`, and `admin/index.html`'s `DEFAULT_REWARD_SETTINGS`/form default/policy note) so the capstone bonus itself feels like a bigger deal and the admin preview's numbers stay honest — not to fix a reachability bug that didn't exist. Updated `tests/reward-economy.test.js` (the canonical policy-contract test) and `tests/exercise-award-experience.test.js` to reflect the new 600 MP default.
  - `member-login/content-config.js`: `applyAlmostThere()` (the "N exercises left" nudge) was querying `.ws-phase-card` elements for Phase 1/2/3, which stopped existing for phases after the tabbed Learning Journey redesign (only the Certificate/Assessment sections still use that class) — it had been silently failing ever since. Rewired to target the current `.ws-journey-phase-tab[data-journey-phase-tab]` elements, appending the badge into the tab itself.
- `assets/reward-events.js`: `recordPracticeActivity()` now detects a member's very first-ever daily streak award (via `Object.keys(previousState.streak.awardedDates).length === 0`) and expands that one toast's body copy to explain the mechanic ("each consecutive day earns more bonus MP... skipping a day resets it") — every subsequent streak toast stays as short as before.
- A streak day now requires one newly completed meaningful activity, not three exercises. Lesson/orientation videos, context videos or slides, exercises, and assessments qualify; login alone and reopening previously completed work do not. Legacy reward settings without `streak.activityTypes` migrate in memory to `dailyExerciseGoal: 1` and `activityTypes: "any-completion"`.
  - `certificate/index.html`: fixed the "Awarded" date always showing today's date on every page load (recomputed via `new Date()` each visit) — now written once to `localStorage.utl_program_completed_at` on first load and read from there afterward, so revisiting the certificate later still shows the real completion date.
  - `my-results/index.html`: added a new "Reward history" accordion section (reusing the existing `.ex-result-card` component) listing every MP-earning ledger entry — title, date, MP earned — newest first, with the total MP and entry count as the section summary. Where a ledger entry has a saved "what worked" reflection attached (`metadata.completionReflection`, already persisted by `reward-events.js`'s `utl:exercise-reflection` listener but never surfaced anywhere before this), the reflection's choice and note render inline under that entry. This addresses both the "no mechanism to revisit past celebrations" and "reflections are saved but never shown again" gaps in one place, since the data was already linked.
  - `member-login/content-config.js`: locked Phase 1/2/3 tabs now show a one-line teaser (`phase.description`, already existed as data but was unused for this) instead of just the word "Locked". The locked Checkpoint assessment card's copy was similarly expanded from "Complete all three phases to unlock this post-program assessment" to explain what it actually does ("it re-tests the same skills as your diagnostic so you can see exactly how far you have come").

### 2026-07-30 (cont.)

- Implemented the "Return to Learning Journey" consistency recommendation from the return-to-journey audit artifact: color now follows exercise *state* rather than varying by file — low-key (plain text) before completion, gold-filled once there's nothing left to finish, matching how video lessons and `explain-to-aiko`/`-60` already worked.
  - **Fixed 4 true dead ends** (no exit affordance of any kind once finished): `write-to-aiko` (added a `Back to Learning Journey` link reusing `.write-to-aiko-submit`'s gold style, shown/hidden alongside the existing "Try again" button); `eisenhower-matrix-v2` (added the same pattern to its fixed action bar, toggled by `markDone()`/`resetBoard()`); `eisenhower-matrix` (added a gold "Back to Learning Journey" button to the summary screen's button row — `showSummary()` already awards completion before this screen renders, so no state toggle was needed); `issue-tree-builder` (added a gold `.btn.btn-primary` link inside `completionSaveNotice()`, which only ever renders after `submitIssueTreeAnswer()`'s success path).
  - **advisory-board / grocery-list-ai**: their completion-screen "Back to Learning Journey" was a bordered button sitting at the same weight as "Back", even after "Mark as done"/"Mark exercise complete" was clicked. Both now add a `gold`/`ab-gold` class to that link inside the success callback (`markDoneBtn` click handler in advisory-board; `syncDoneButton()` in grocery-list-ai, which also runs on page load so a previously-completed visit reflects the state correctly).
  - **speak-like-obama / i-have-bad-news / lets-switch-hats**: identical pattern — clicking "Mark exercise complete" now also swaps the adjacent exit link's class to the same `*-button *-button-primary` gold style used by the click-to-complete button itself.
  - **explain-to-aiko-v2 / explain-to-aiko-60-v2**: each has two "Back to Learning Journey" instances sharing one class — a mid-flow one (correctly plain text, exercise not yet done) and one on the dedicated post-submission `renderCompletion()` screen. Dropped the `.exit-link` modifier from only the completion-screen instance, falling back to the base gold-filled `.tsa-speak-link-button` style; the mid-flow instance is untouched.
  - **Deliberately left unchanged**: the `completion-save-notice`/`.save-notice-link` family (`rushed-voice-memo`, `rushed-voice-memo-ai`, `chalkboard-notes`, `messy-notes`, `grocery-list`). Unlike the apps above, these are re-submittable scored exercises — "Submit"/"Try again" stays fully active after the notice appears, so there's a real, ongoing gold "Submit" competing for attention, not a single settled "done" state. The earlier fix (navy `.exit-link` distinct from the gold "Go to next exercise"/"View all results") already resolves the actual collision risk here and remains correct under the state-based rule.
- `member-login/content-config.js`: added a hover highlight to the Learning Journey's Phase 1/2/3 tabs (`.ws-journey-phase-tab:hover:not(.ws-active)`), matching the "Continue where you left off" card's hover treatment — background lightens to white with a soft gold box-shadow glow, plus a preview of the gold top-accent bar that marks the active tab, so hovering hints at what selecting the tab will do.
- `apps/rushed-voice-memo/index.html` and `apps/rushed-voice-memo-ai/index.html`: swapped Hugh's voice-memo Google Drive file (old ID `13nvMb6RrHjzCQevI1wZtDBhL-tMYObG_` → new ID `1vjcNHKWZ0uK4LPKQ8lEnd2ug3wqRR7fy`) in both apps — the URL-parsing helpers in both files extract the file ID via regex, so no other code changes were needed. Replaced the placeholder transcript in `rushed-voice-memo-ai`'s "lazy way" tab with the real transcript of the memo (kept verbatim, including its rushed/run-on phrasing — that messiness is the exercise's whole premise, not something to clean up).

### 2026-07-30

- `member-login/content-config.js`: Learning Journey rows now name the specific AI tool an exercise routes to, so learners know what to expect before starting. Added an `aiTool` field to the six raw exercise entries that involve an external/AI step: `i-have-bad-news` and `lets-switch-hats` → `"CustomGPT"`, `speak-like-obama` → `"GEM"`, and `grocery-list-ai`/`rushed-voice-memo-ai`/`advisory-board` → `"AI prompt"` (these three hand the learner a prompt to paste into any AI tool of their choice rather than opening one specific named tool, so they're labeled generically rather than "CustomGPT" to keep the tag accurate). `explain-to-aiko`/`-60` intentionally got no tag — they score automatically in-browser via a backend call, with no external tool for the learner to open. `journeyPhaseActivities()` passes `aiTool` through to each activity object; `journeyActivityRowHtml()` appends it to the compact list's type tag (e.g. "Exercise (CustomGPT)") and, in the slide-out preview drawer's "Inside this activity" steps, changes step 2 from "Complete the exercise" to "Open [tool] and complete the exercise" when present.
- Button-color and "Back to Learning Journey" consistency pass, from a user feedback doc. Audited every app for "Copy prompt"-style content-generation buttons and every "Back to/Return to Learning Journey" exit link (21 files). Findings: the header `module-back-link` is already consistent across 19/21 files (`tsa-speak` intentionally has none — it's only ever launched from the TSA Diagnostic/Checkpoint assessment flow, not the Learning Journey, and its one exit link correctly points at `#assessments` instead; `toolkit` intentionally shows "← Workspace" instead, since it's a standalone reference tool reachable from the profile menu at any time, not tied to one Learning Journey activity — neither is a bug). `scqa-builder`'s "Back to Learning Journey" is a solid gold button, but that's correct there too: the app has no separate MP/"mark complete" mechanic, so it's genuinely the only primary action on that screen. Real inconsistencies found and fixed: (1) `apps/advisory-board` and `apps/grocery-list-ai` had "Copy prompt" sharing the exact same gold class as the actual primary "Continue"/"Mark as done" button, making a content-generation action look identical to the exercise-completion action — added a new `accent` style (white background, 2px gold border, navy text — reusing the same "notable but not primary" tier already built for "Open [tool]" buttons this session) and moved "Copy prompt" onto it in `advisory-board`, `grocery-list-ai`, and `toolkit` (whose only button, also "Copy prompt", got the same treatment for a consistent "same action, same look" rule even though it had nothing to compete with there). (2) `grocery-list-ai`'s completion-screen "Back to Learning Journey" used the navy-filled `.primary` class — the same weight as "Mark as done" — changed to the plain bordered `.button-link` it already used earlier in the same file. (3) `grocery-list`, `rushed-voice-memo`, `rushed-voice-memo-ai`, `chalkboard-notes`, and `messy-notes` all render "Back to Learning Journey" via a shared `.save-notice-link` class also used by "Go to next exercise"/"View all your results" — both rendered in the same gold, so leaving vs. continuing looked equally weighted. Added a `.save-notice-link.exit-link` modifier (navy, green on hover) and applied it only to the exit link in all five files, leaving the forward links gold. (4) `explain-to-aiko-v2` (120s) had no completion screen at all — clicking "Save Playback feedback" just swapped the button's own label to "Saved" in place, with no confirmation state and no post-completion exit link, unlike its `explain-to-aiko-60-v2` sibling which shows a proper "You saved your Playback feedback" screen with "Try again" + "Back to Learning Journey". Added the matching `renderCompletion()` screen to the 120s version. Left `advisory-board`'s and `grocery-list-ai`'s screen-1 "Back to Learning Journey" links alone — both were already the plain bordered/secondary style, not gold or navy-filled. Also noticed `messy-notes` is the only file whose "Back to Learning Journey" links pass `?phase=phase1` (which `learningJourneyHomeHtml()` in `content-config.js` reads to select and persist the correct phase tab) — every other app's exit links omit this, meaning they may land on the wrong phase tab on return if the completed exercise isn't already `journeyNextActivity()`'s computed "next" activity; flagged here as a possible follow-up (propagating each app's own phase param to its exit links) rather than changed now, since it's a behavior addition beyond the consistency pass that was asked for.
- Fixed a title-misalignment bug this surfaced: each Learning Journey row (`.ws-journey-activity-preview-button`) is its own independent CSS grid, so setting the type-tag column to `auto` sized each row to fit only *that row's own* tag text — rows with the long new "(AI prompt)"/"(CustomGPT)" tags pushed their titles further right than plain "Video"/"Exercise" rows in the same list, leaving titles unaligned down the column (flagged from a screenshot of the Phase 1 tab). Changed the type-tag column from `auto` to a fixed `128px` across all three affected rules (the compact 3-column overview's base and 850px-breakpoint rules, and the full-width phase-panel rule), so every row in a given list shares the same column template and titles line up regardless of tag length. Added `overflow:hidden;text-overflow:ellipsis` to `.ws-journey-type` as a safeguard in case a future tag name exceeds the fixed width. Left the two 22px icon-only breakpoint variants (`font-size:0` on the type text) untouched since they don't render tag text at all.

- `apps/rushed-voice-memo-ai/index.html`: fixed the "AI structuring prompt"'s bold formatting — the numbered rules were using literal markdown `**asterisks**` inside a `<pre>` block, so they rendered as visible asterisks instead of actual bold text. Replaced the `<pre>` with a `<div class="tsa-speak-prompt-box">` (same monospace/pre-wrap look) using real `<strong>` tags, so the phrases render properly bold on screen and still copy as clean plain text (no stray asterisks) when selected and pasted into an AI tool.
- Replaced the "How to transcribe the voice file" disclosure with a two-path picker addressing the drop-off point flagged from user feedback (the manual ChatGPT-voice-mode transcription workaround required leaving the app and was a major source of drop-off). Added a `.voice-memo-path-tabs` segmented control with two options: "😴 Take the lazy way" (default-selected) shows a ready-to-copy transcript of Hugh's voice memo with a "Copy transcript" button; "🎧 Transcribe it yourself" shows the original 5-step manual-transcription guide, now framed as an opt-in practice path rather than the only path. The transcript itself is a placeholder (`[PLACEHOLDER — paste Hugh's voice memo transcript here]`) — it needs the actual transcript text, which isn't available anywhere in the codebase and can't be produced without listening to the Drive audio file; swap in the real transcript once supplied. Added a `.tsa-speak-button.accent` tier (white background, 2px gold border, navy text) for the new "Copy transcript" button, matching the same "notable but not primary" style used for "Copy prompt" buttons elsewhere this session.

### 2026-07-29

- Rolled out the compact tabbed Learning Journey, focused lesson player, phase-preserving return links, and shared setup-first exercise flow across the curriculum. Added canonical context saving, one-time 5 MP context rewards, cached-script versioning, and a visible way to review completed setup material.
- Standardized shared exercise-header ordering and responsive layouts. Timed exercises now use a compact 42px outlined timer/start/reset unit; word count remains a separate matching-height metric where present.
- Reconnected the full celebration cadence to the Learning Journey: MP animation and exercise reflection remain in-app, promotion follows when earned, and completion returns to the selected phase with the finished and next activities visually identified.
- Completed Phase 5 navigation migration: bare legacy phase routes now resolve to the Learning Journey, focused lesson URLs remain supported, mismatched lesson/phase URLs self-correct, and Daily Mission video links open the focused player directly.
- Retired the old full-page phase layout (`phaseOneWatchHeader`, `phaseHeader`, `videoSection`, `exerciseSection`, and their exercise-card helpers) now that `renderPhasePage` only ever renders the focused lesson player or redirects to the Learning Journey — there is one phase-page UI, not two. The admin "Experience preview" lesson picker now links straight to the real `?lesson=` URL instead of a parallel `utl_experience_preview_lesson_` localStorage flag, so previewing a lesson exercises the same code path a student uses. Split the merged grocery-list/rushed-voice-memo "Start here / Try with AI" tabbed practice card into two independent cards, matching how they already appear as two separate rows on the Learning Journey. Shortened the repeated "Before you start" exercise context on the practice page to a one-line teaser (full version lives in the in-app setup gate). Learning Journey home page: merged the header's standalone progress stat into the "Continue where you left off" card (which is now a single fully-clickable link with a light gold fill) and removed the redundant Completed/Up next/Locked legend and the phase tabs' duplicate "X of Y" count.
- `orientation.html` now has its own "Mark orientation complete" action and a "Return to Learning Journey" hand-off, matching the mark-complete-then-return pattern every lesson and exercise already uses — orientation no longer requires backtracking to the dashboard to find the completion control. The Learning Journey home page also now scrolls the "Just completed" activity row into view on return from an exercise, instead of relying on its pulse animation alone.
- `my-results/index.html`: simplified the sticky nav to "Learning Journey | My Results" (it still had the pre-redesign Home/Phase 1/Phase 2/Phase 3/Assessments dropdown nav) and removed the now-dead dropdown CSS. Fixed stale lesson/exercise titles, removed three lesson tiles that could never show as watched (`p1-welcome-ma` and the two orientation video entries have no corresponding `utl_watched_*` writes anywhere), and pointed "watch again" links at real `?lesson=<id>` deep links instead of bare phase pages. Added response formatters for `grocery-list-ai`, `advisory-board`, and `eisenhower-matrix` (previously fell back to a raw JSON dump, and for advisory-board specifically to an empty `{}` since its payload fields are flat on the record rather than nested under `.response`) — `i-have-bad-news`, `lets-switch-hats`, and `speak-like-obama` save no free-text response at all, so no formatter applies there. Rewired the Assessments section: it was checking `utl_result_tsa_diagnostic`/`utl_result_tsa_checkpoint` keys that no app writes, so it always showed "Not yet taken." The real state lives in three shared keys (`tsa_sort_score`, `tsa_spot_score`, `tsa_speak_score`) written by the sub-exercise apps regardless of whether they were launched from the diagnostic or the checkpoint — both assessments now read that shared state. Note: because the sub-exercise apps overwrite one live score per sub-exercise, there is no way to preserve a diagnostic score once the checkpoint is taken; the previous "Diagnostic → Checkpoint delta" comparison was removed since it could never be honestly computed. A proper fix would give each sub-exercise app assessment-specific keys — not done here, flagged for a future pass.
- Completed Phase 6 stabilization without reversing the visual consolidation work: preserved the streamlined journey/continue card, orientation return flow, admin preview route cleanup, and Results corrections; removed the checkpoint page’s accidental monospace-uppercase/shadow regression; aligned Admin/member cache keys; and documented file ownership plus the shared TSA-score limitation for future agents.
- `my-results/index.html` visual refresh, bringing it toward the Learning Journey's component language (kept as a dense record page — no tabs/drawer restructuring): per-phase progress dots replaced with a single gradient bar (`.progress-bar-track`) matching the Journey's mini-progress treatment; `device-notice`/`sync-notice` restyled as bordered, tinted, rounded callouts instead of flat unbordered boxes; removed a standalone `box-shadow` on `.results-accordion` that violated the site's no-card-shadow rule; and unified the exercise cards and lesson video tiles onto one icon-led row grammar (`.ex-result-icon`, `.video-row`) — a status circle followed by title/meta followed by action, replacing the old title/badge layout and the separate video-tile grid.
- Deprecated `member-login/phase-1/practice/index.html`: nothing live linked to it anymore (Learning Journey rows go straight to each exercise's app; admin Experience Preview does the same), so `renderPhasePracticePage` now always redirects to the Learning Journey, matching how the old phase-page layout was retired. Removed the cascade of now-fully-dead helpers this exposed: `phaseOnePracticeHeader`, `phaseOnePracticeCards`, `singlePracticeCard`, `contextOnlyPracticeCard`, `practiceCardStatus`, `practiceCardCheck`, `practiceOpenState`, `stepTabs`, `phaseProgressPanel`, `bottomPhaseNav`, and the already-unreachable `phaseDropdownHtml` nav helper (dead since the nav's `links` array never set `dropdown: true`). Added the "Choose one format" mode-guidance paragraph to `apps/write-to-aiko/index.html`'s Structured/Open toggle, matching the pattern already used in `apps/messy-notes/index.html`.
- Redesigned `apps/scqa-builder/index.html`'s second-formulation mechanic. Previously the exercise required two fully independent 4-field SCQA write-ups (8 fields total) plus a blocking "are you sure this is different" confirmation modal. It now keeps the first full SCQA as-is, then has the learner pick one of three named levers (`LEVERS` — Sharpen the Complication, Reframe the Question, Challenge the Answer, each naming which 1–2 fields become editable) instead of writing a second SCQA from scratch; the unchanged fields carry over from SCQA #1 and render read-only (`.scqa-card.locked`). The confirmation modal is gone — picking a lever is the commitment. The "differentiation check" in `renderFeedback` now confirms the specific lever's field actually changed (via the existing `hasSharedPhrase` heuristic) rather than comparing Situation/Question similarity, since Situation is now locked by design and would always read as "similar." `my-results`' SCQA formatter needed no changes — `scqa1`/`scqa2` keep the same field shape, just with some values inherited rather than freshly written. Known gap: `data/practice/scqa-builder.json`'s sample-answer pair still shows the old fully-independent style (both formulations differ in all four fields), so "Show sample answers" doesn't demonstrate the new lever mechanic — not updated, flagged for a follow-up.
- Merged `apps/scqa-builder/index.html`'s standalone "set your context" screen into the SCQA #1 screen — context input, topic label, and the template-load option now sit above the S/C/Q/A fields on one screen instead of requiring a separate click-through. Screens renumbered 1–3 (was 1–4): 1 = context + SCQA #1, 2 = lever/reframe, 3 = review. The obsolete `toScqa1` button/listener was removed; the merged screen's advance button (`toReframe`) now gates on both a filled context and a complete SCQA #1. `startTimerFromInteraction` and `goToScreen`'s per-screen behavior (timer reset, review render) were remapped to the new numbering. Fixed a follow-on regression this caused: `#loadTemplate` and `#clearFresh` now live inside `buildWorkScreen()`'s dynamic markup, but their `addEventListener` bindings still ran once at top-level script load — before that markup existed — so `$(...)` returned `null` and the `.addEventListener` call threw, silently aborting the whole script before `initializeApp()` ever ran (blank exercise body, timer stuck on its static placeholder with no button icons). Moved both into the existing delegated `document.addEventListener("click", ...)` handler alongside the other dynamically-rendered controls.
- Fixed a header bug affecting `.utility-metric`-style timer widgets (confirmed on `scqa-builder`, likely present on other apps sharing the same shared-header timer-compacting logic — worth checking if it recurs elsewhere): `assets/app-reward-header.js`'s `.utl-compact-timer-group` normalization forced a fixed `height`/`max-height` (42px, 40px inner) with `overflow:hidden`, sized for a one-row timer display. Widgets with a two-row structure (a label+hide-toggle row above the elapsed-time digits, as in `.utility-metric`) had their digit row silently clipped off. Changed the fixed `height`/`max-height` to `min-height` (and removed `overflow:hidden`) at both the base and the 760px breakpoint, so the compacted timer pill grows to fit whatever content is inside instead of clipping it.
- `apps/scqa-builder/index.html`: labeled the merged context+SCQA#1 screen's two sub-steps as Part A (set your context) / Part B (write SCQA #1) — a heading before each, matching letter badges in the `how-strip`, and a per-part status line in the sidebar progress box (`Context needed` → `Context ✓`) — so the screen reads as two distinct required parts instead of one long form. Renumbered the how-strip's remaining steps to 2/3 to match the actual 3-screen flow (it previously read 1–4, implying a fourth screen that no longer exists).
- Header/completion-button consistency pass across exercise apps: `apps/eisenhower-matrix/index.html`'s sticky header had a bespoke "Current round" metric alongside the shared Level/MP cluster and timer pill — three widgets crowding/wrapping on narrow viewports — that duplicated the round indicator already shown prominently in the in-body context strip; removed it (and its now-dead `headerRound` JS refs) since no other exercise header carries app-specific state. In `apps/i-have-bad-news`, `apps/lets-switch-hats`, `apps/speak-like-obama`, `apps/explain-to-aiko-v2`, and `apps/explain-to-aiko-60-v2`, the "Open [CustomGPT/Gem/Playback]" external-tool launch button had the app's gold primary-button treatment while the actual required "Mark exercise complete"/"Save Playback feedback" action used the plain/secondary treatment — backwards emphasis. Swapped it: the completion action is now the primary gold button in every one of these apps, and the external-tool link uses the plain/secondary treatment (still a clear button, just not competing for attention). Also standardized every "Back to member workspace"/"Back to workspace"/"Back to dashboard" exit link (these apps, `apps/tsa-speak`, `apps/toolkit`, and two in `member-login/content-config.js`) to "Back to Learning Journey" pointing at `index.html#learning-journey` — several still pointed at `#phase2`/`#phase3`, anchors that no longer exist since the phase-page consolidation earlier this pass, so those links silently went nowhere.
- Gave the "Open [external AI tool]" button a third button tier (`.bad-news-button-accent`/`.lsh-button-accent`/`.slo-button-accent` — white fill, 2px gold border, navy text) between the solid-gold primary ("Mark exercise complete") and the plain exit link, so it reads as a notable, encouraged action without competing with the primary CTA. Rolled out to `apps/i-have-bad-news`, `apps/lets-switch-hats`, and `apps/speak-like-obama` — all three previously used the app's plain `-button` style (white background, no border) sitting on an equally-white action card, so the button was functionally invisible (just floating text, as flagged from a screenshot of `lets-switch-hats`). `apps/explain-to-aiko-v2`/`-60-v2`'s "Open Gem" already used a navy-bordered secondary style and didn't have this problem, so left alone. Also matched "Open CustomGPT"'s width to "Mark exercise complete" in `i-have-bad-news`/`speak-like-obama` (`align-items: flex-end` → `stretch` on the shared actions column, at both the base and tablet breakpoint) since they're stacked in the same container; `lets-switch-hats`/`explain-to-aiko-*` don't share that layout (their Open-tool button sits in its own section), so no width-matching applied there. Converted every "Back to Learning Journey" exit link that sits next to one of these buttons from a bordered button-box to a plain underline-on-hover text link (`i-have-bad-news`, `lets-switch-hats`, `speak-like-obama`, and both `explain-to-aiko-*`, via a new `.tsa-speak-link-button.exit-link` modifier so the neighboring "Back to prep" button wasn't affected).
- Standardized "Open [tool]" button naming across the five apps that launch an exercise-specific external AI tool. Audit found the same Gemini Gem ("The Playback") used by `speak-like-obama` and both `explain-to-aiko-*` apps, but named correctly only in `speak-like-obama`; the other two said the generic "Open Gem" even though their own nearby help text already called it "The Playback" — aligned both buttons to "Open The Playback." `lets-switch-hats`'s Custom GPT had never been given a distinguishing name (button just said "Open GPT," body copy said "the Custom GPT"); confirmed with the user and named it descriptively rather than inventing a persona name — button and body copy now read "Open CustomGPT (Let's switch hats)." `i-have-bad-news`'s "Difficult Conversations" naming was already correct and left unchanged.
- `apps/issue-tree-builder/index.html` consistency + mechanics pass: removed the 10th "cleaned-up note" (`ashley-no-meaning`) — the exercise only has 9 supporting-detail slots, and the remaining 9 notes map cleanly 3-per-argument onto the sample answer key with no forced "choose 9 of 10" step; updated the instructional copy to match. Removed the header's "Word count (in current box)" metric and all of its now-dead JS (`renderWordCount`, `activeWordField`) — it also displayed for the supporting-detail slots, which no longer accept typed input (see below), and this app's primary mechanic reference (`grocery-list`) has no equivalent widget. Made supporting-detail slots drag/tap-only: previously an empty slot rendered a live, placeholder-inviting `<textarea>` a learner could type directly into, defeating the "select from Ashley's notes" mechanic. Rebuilt the "Show sample answer" panel: it was a bespoke full-width "presentation slide" (a gold ribbon banner, a 72px Playfair headline, giant gold bars) unrelated to the rest of the site's visual language and hard to reconcile with a topic change. Replaced it with the same `.panel`/`.panel-close` treatment already used by this app's own "Check answers" feedback panel, built on a `.review-grid`/`.review-arg-header`/`.detail-row` component set that already existed in this file's CSS but was never wired to any markup (leftover scaffolding, evidently intended for exactly this). Also removed the fully-unused `.comparison-grid`/`.compare-column`/`.compare-section` CSS family that neither the old nor new sample panel used. The sample panel already read from `templateState`, itself sourced from `data/practice/issue-tree-builder.json`'s `sampleAnswer` field, so it was already topic-data-driven — the rebuild keeps that and just changes the presentation.
- `apps/issue-tree-builder/index.html`: merged each argument's 3 individually-dashed-boxed supporting-detail slots into one shared drop zone, directly copying `grocery-list`'s bucket pattern — a single `.detail-list` carries the dashed border/background (previously each of the 3 `.detail-wrap` sub-boxes had its own), one `.detail-add-slot` ("Add selected note here") appears once when a note is selected and the argument has room, and one `.detail-empty-hint` ("Drag or tap a note here") appears once when the argument is completely empty, instead of the same hint text repeating 3 times (flagged from a screenshot showing three stacked "Drag or tap a note here" boxes where `grocery-list` only ever shows one). Placement no longer targets a specific slot index directly — `applyEvidenceToDetail`/`moveDetailSlot` now resolve to the argument's first empty `details[]` index, matching how `grocery-list` items land in a bucket without the learner choosing a position; the data model is unchanged (still a fixed 3-element `details` array per argument, just filled/read/removed by index instead of by a dedicated slot element). Also dropped the per-card bullet decoration on `.placed-detail-card` to match `grocery-list`'s plain `.item-card` look, and cleaned up the now-fully-dead `.detail-wrap`/`.empty-detail-slot` CSS (including a `min-width:1024px` breakpoint override that had already implemented a version of this unified look for desktop only, which is why the problem was visible on mobile/narrow viewports but not on wide ones).
- `apps/explain-to-aiko/aiko.js` (shared by both `apps/explain-to-aiko` and `apps/explain-to-aiko-60` via `data-aiko-mode`): reduced the pre-recording flow from 3 screens to 2. The old "Step 1 · Talk brief" screen was pure instructional copy with a single "I am ready to start preparing" button and no input of its own — merged it into the top of what is now "Step 1 · Prepare your talk" (the former Preparation screen), matching the same merge already applied to `apps/scqa-builder` and `apps/issue-tree-builder` this session. Removed the now-pointless "Back" button between Brief and Preparation (there's no earlier screen to return to) and renumbered Record/Feedback to Step 2/Step 3. Chosen over a more aggressive 1-screen option (also merging the recorder itself into this screen) after presenting both as options — the 2-screen version was picked as lower-risk. Also fixed a stray "Back to workspace" link on the results screen pointing at the dead `#phase2` anchor (same class of bug fixed elsewhere this session); now reads "Back to Learning Journey" → `#learning-journey`.
- Aligned "Open [tool]" button copy to the `"Open [Category] ([Name])"` pattern across the three remaining apps not covered by the initial CustomGPT/Gem naming pass: `apps/speak-like-obama` and both `apps/explain-to-aiko-*` now read "Open GEM (The Playback)" (was "Open The Playback" / "Open Gem"), and `apps/i-have-bad-news` reads "Open CustomGPT (Difficult conversations)" (was "Open CustomGPT"). `apps/lets-switch-hats`'s "Open CustomGPT (Let's switch hats)" from the prior pass already matched this pattern.
- Exercise-page structure pass, implementing the design review published as an artifact (audit + common-structure recommendation) covering all three phases. Root cause of the inconsistent section order (some apps show intro → "how this is checked" → exercise; others show the check panel before anything else): `assets/exercise-scoring-intro.js` inserts its panel directly after whatever direct child of `<main>` matches a fixed class list, falling back to inserting at the very top of `<main>` when nothing matches. Three apps had a near-miss class name the script wasn't actually checking for (`apps/i-have-bad-news` used `.bad-news-intro` vs. the expected `.bad-news-hero`; `apps/lets-switch-hats` used `.lsh-intro` vs. `.lsh-hero`; `apps/speak-like-obama` used `.slo-intro` vs. `.slo-hero`), and four more render their whole page through JavaScript with no static wrapper at all as the first child of `<main>` (`apps/issue-tree-builder`, `apps/write-to-aiko`, `apps/scqa-builder`, `apps/eisenhower-matrix`), so the panel fell back to the top in both cases. Fixed by (a) extending the shared script's selector list to also match `.bad-news-intro`/`.lsh-intro`/`.slo-intro` plus a new generic `.exercise-intro` class, and (b) giving each of the four JavaScript-shell apps a real anchor: `issue-tree-builder` gets a persistent static intro banner ahead of its screens (its old screen 1 "problem statement" entry was already fully dead code — `initializeApp()` and `goToScreen()` both unconditionally skip past it to screen 2, so nothing was lost by leaving it in place and adding the banner above it — flagged for a future cleanup pass, not removed here); `write-to-aiko` gets a new intro block (it previously had no exercise-level title/description anywhere in the body, only in the sticky header) and its `.write-to-aiko-grid` reference column changed from a `.88fr`/`1.12fr` (~44:56) split to a fixed 300px sidebar, matching the majority convention; `scqa-builder`'s screen 1 already renders a proper intro via `buildWorkScreen()`, so it just needed the `.exercise-intro` class added; `eisenhower-matrix` needed its dynamic content container (`id="app"`) moved from being `<main>` itself to a nested `<div>` inside a new static `<main><div class="exercise-intro">…</div><div id="app">…</div></main>` wrapper, since its `render()` function fully replaces `#app`'s contents on every interaction and there was nowhere stable to anchor a static sibling otherwise. Bumped `exercise-scoring-intro.js?v=3` → `?v=4` across all 19 apps that load it. Also corrected two claims from the initial audit after a closer read of the actual CSS cascade: `eisenhower-matrix`'s reference rail was already on the left (a later, unminified `.layout{grid-template-columns:300px minmax(0,1fr)}` override further down the same stylesheet flips an earlier `minmax(0,1fr) 300px` declaration — easy to miss on a first pass), and its solid-navy "Goal" card is the one deliberate exception the review's own color rule allows (a single one-time objective statement, not routine reference material); neither needed changing. For `apps/i-have-bad-news`, `apps/lets-switch-hats`, and `apps/speak-like-obama` (identical structure, just class-prefixed), narrowed the page width from 1120px to 960px and roughly doubled the vertical gap between the three stacked sections (intro, the scenario/steps grid, and the practice-with-AI action card) from ~18–22px to 36px, so the page reads as three distinct stages instead of one dense, evenly-spaced wall of content.
- Follow-up fixes found during a live pass over the redesigned pages. `apps/scqa-builder`: the previous fix wrongly added `.exercise-intro` to `#screen1` itself, which is the *entire* merged context+SCQA#1 screen (title, callout, full form) — the panel anchored after all of that instead of just the title, landing at the bottom of the page. Replaced with a genuinely separate static intro banner ahead of the screens, and trimmed the now-duplicate eyebrow/title/subtitle out of `buildWorkScreen()`'s own render (kept the "Why reframe?" callout and how-strip, which are unique to that screen). `apps/issue-tree-builder` and `apps/scqa-builder`: the injected "How this exercise is checked" panel has no horizontal margin of its own and both apps' `<main>` has no width cap (each screen insets itself with its own padding instead) — so the panel rendered edge-to-edge while surrounding content was inset 60px. Added a same-specificity-beating `main .utl-scoring-intro` margin rule (60px, 20px under 767px) to both. `apps/advisory-board`: its `.ab-hero` blocks exist per-wizard-step (nested inside `<section data-screen="N">`), not as a direct child of `<main>` — the actual first child was a bare progress indicator (`.ab-progress`, "Step 1 of 7"), which didn't match the injector's selector list, so the panel rendered above everything including the progress indicator. Added a persistent top-level intro banner. `apps/explain-to-aiko`/`apps/explain-to-aiko-60` (shared `aiko.js`) and `apps/rushed-voice-memo-ai`: both already render a consistent intro wrapper on every screen (`.aiko-intro` from `aiko.js`'s `shell()` helper; `.tsa-speak-intro` as static markup) — just missing from the injector's selector list. Added both class names; bumped `exercise-scoring-intro.js` to `?v=5` then `?v=6` across all 19 apps for these two rounds of selector-list fixes. `apps/i-have-bad-news`: its "Exercise brief" card's bold duration text used `var(--bad-news-navy)` (blue) while the identical card in `apps/lets-switch-hats` and `apps/speak-like-obama` already used their `-gold` token (orange) — standardized to gold. `apps/rushed-voice-memo`: the voice memo used a raw `<audio src>` pointed at a Google Drive `uc?export=download` URL, which Google serves inconsistently for embedding (sometimes an interstitial page instead of raw audio) — the file loaded enough metadata to show a duration but wouldn't actually play, and rendered as the browser's native audio chrome (a dark waveform pill in Safari) which looked out of place against the site's custom styling. Switched to the Google Drive `/preview` iframe embed (already used for video review content elsewhere, e.g. `apps/messy-notes`) as the primary path for any Drive-hosted URL, keeping the raw `<audio>` tag only as a fallback for non-Drive direct file URLs.
- `apps/eisenhower-matrix`: its "Exercise brief" card (`.goal`, the aside shown during round-play) used a solid navy fill with white text — the one deliberate exception noted in the design review as acceptable, but flagged as inconsistent by direct comparison against `apps/i-have-bad-news`/`apps/lets-switch-hats`/`apps/speak-like-obama`'s "Exercise brief" cards (white/bordered, gold heading). Removed the navy override so it falls back to the shared `.rail-card` look and changed the heading color to gold, matching the other three apps exactly.
- Completed the cleanup plan published earlier (audit artifact): removed the empty `apps/eisenhower-matrix-swap/` directory (zero files) and `apps/12-in-12/` (confirmed with the user first — a standalone PWA-shell app with zero references anywhere in the codebase). `apps/issue-tree-builder`: removed the fully-dead screen 1 ("problem statement" entry) confirmed earlier this session — `initializeApp()` and `goToScreen()` both unconditionally skipped past it, so the textarea, "Load the Olympics template" button, "Start building" button, and "Clear and start fresh" button were all unreachable. Kept a hidden `<textarea id="problemStatement">` in place of the visible card so the existing state-sync code (`fields.problem`) keeps working unchanged — `state.problemStatement` itself is very much alive (drives the tree, scoring, and sample comparison), only the now-redundant manual entry UI was removed (the auto-fill-from-template path in `initializeApp()` already covers it unconditionally). Simplified `goToScreen()`'s now-vestigial index-based `.screen` toggle, which broke when screen 1 was removed (there is only one `.screen` left, so the old `index + 1 === screen` positional match no longer lined up with the hardcoded `goToScreen(2)` callers). Removed the associated now-orphaned CSS (`.problem-card`, `.instruction`, `.template-toggle`, `.template-status`, `.link-button`, `.cta-area`, `.clear-link` and their breakpoint overrides) after confirming zero remaining usages of each class. `data/practice/scqa-builder.json`: the sample answer previously showed two fully independent SCQA formulations (the pre-redesign mechanic); rewrote the second sample to match the live lever mechanic exactly — identical Situation and Complication, a genuinely different Question and Answer (demonstrating the "Reframe the Question" lever) — and added a `reframeLever` field the app now reads (`loadPracticeData()`) and displays (`renderSamples()` labels it "Sample formulation 2 (reframed: Reframe the Question)", mirroring how `copyText()` already labeled it). Backend review of both Firebase Functions codebases (`functions/`, `functions-aiko/`): both are correctly wired, minimal, and have no unused dependencies. Found and fixed one real inefficiency in `functions-aiko/index.js`'s `callGemini()` — after looping through both models in `MODELS` and having both fail, it retried the *last* model in that list a second time (an exact duplicate of the loop's final attempt) before giving up; removed the redundant retry. Also removed an unused `job` parameter threaded through `markJobConfirmed`/`markJobFailed` in `functions/index.js` that was never read inside either function.

Entries from 2026-05-27 through 2026-07-22 archived in `archive/WEBSITE_CONTEXT_ARCHIVE.md` (2026-07-30 archiving pass).

### 2026-08-01 — Revised Advisory Board experience

- Built the revised Advisory Board as a parallel prototype, reviewed its full learner flow, AI fallback, completion, rewards, saved progress, accessibility, and responsive layout, then promoted it to the canonical `apps/advisory-board/index.html` URL. The former exercise now lives at `apps/advisory-board-legacy/index.html` as a reversible direct-link archive and is not linked from the member experience.
- The prototype now follows the original exercise's visual language in three stages: understand how a virtual advisory board changes a decision, build a three-to-four-person board, and hear the board before recording a decision. Step 1 puts the school-event comparison before a compact FAQ. Step 2 uses a 370px non-sticky context rail plus working area, removes SCQA terminology, separates the question/context, perspective selection, and board-chair selection into 2a/2b/2c, and mixes public figures with established professional roles. The context field is 250px tall and the seeded Olympics question models a bounded audience, timing, constraints, and success measure.
- Step 3 is named `Hear the board`. It calls the `functions-aiko` `runAdvisoryBoard` Firebase Function, which uses the existing server-side `GEMINI_API_KEY` to return distinct non-chair advisor responses plus one board-chair synthesis. The chair recommends; the member records the final decision. The structured response includes a decision criterion, central tradeoff, important uncertainty, advice accepted/declined, and next step. Members can also copy the generated prompt to another AI and paste the response back. A clearly labeled sample remains available if AI fails, and completion is never blocked by AI availability.
- The learner-facing Step 3 intentionally stays shorter than the function's full structured response: one primary `Hear from my board` action, one collapsed `Other ways to continue` fallback, two concise points per advisor, four board-chair summary points, and three required reflection fields (decision, what changed or needs checking, and next step). The fuller AI fields remain available in the saved response without adding interface work for the learner.
- The Step 1 FAQ intentionally keeps the original exercise's fuller explanations of the virtual board, role-specific advice, orchestrator/board-chair responsibility and final decision ownership. V2 adapts only the mechanics: members provide a question, context and starting view rather than an issue tree and SCQA, and the board uses three to four advisors rather than six.
- Step 3 keeps fallback choices visually and conceptually separate. `Use another AI` is a numbered two-step flow: copy the hidden prepared prompt, then paste and continue with the response. `Continue with a sample` is its own card. Successful in-page and sample responses are rendered as normal advisor cards and are never written into the paste field as raw JSON.
- Completion keeps the existing advisory-board contract (`utl_p2_ex3_done`, `utl_result_advisory-board`, `saveUserProgress('advisory-board', ...)`, and `awardCompletionExercise({ appId: 'advisory-board' })`) so the canonical route change does not fragment progress or rewards. The current exercise also keeps a separate `utl-advisory-board-draft` local copy.

### 2026-08-01 — Learning Journey sequential-unlock repair

- Activity availability now comes from the actual ordered chain inside each phase: an unfinished activity opens whenever its phase is available and every activity before it is complete. It no longer depends on matching one global `journeyNextActivity()` key, which could leave an eligible activity labeled `Locked` when browser and cloud progress arrived in a different order.
- `exerciseDone()` now self-heals missing workspace flags when a local result record clearly contains a completion timestamp or completed status. `apps/scqa-builder/` also repairs its legacy `utl_p2_ex2_done` flag when an older saved state already says `completedOnce`, resolving the specific completed-SCQA/locked-Advisory-Board disagreement.

### 2026-08-01 — Member-facing copy cleanup

- Applied a targeted copy pass to the public home/program pages, selected exercise instructions, assessment feedback, workspace descriptions and certificate. Rewrites focus on broken grammar, ambiguous references, internal engineering language, repetitive marketing formulas and abstract wording that does not tell the learner what to do.
- Member-facing site copy does not use contractions. Use complete forms such as `you are`, `we will` and `do not`; concise imperative button labels are preferable when the expanded phrase sounds stiff. Official lesson and exercise titles are explicit exceptions and must remain verbatim, including `Let's switch hats` and `Wait, what's the problem again?`. Possessives, learner-entered text and parsing patterns that recognize contractions are not contractions in the site's authored voice. Oxford commas, functional colons and occasional rhetorical repetition remain acceptable when they improve clarity or serve the lesson, including deliberate speaking techniques in the Speak like Obama exercise. Bolded summary phrases continue to use a colon by design.

### 2026-08-02 — Security hardening and private-content migration

- Added the first non-disruptive security layer without changing member or admin workflows: escaped saved response text before rendering it in My Results, constrained public access-request writes, limited Firestore settings reads by audience, capped AI request bodies, protected Google Sheet cells from formula injection in the repository-owned Apps Script handlers, restricted Google Group actions to the configured group, added report-only browser security headers, and added automated secret, syntax, test, and dependency checks.
- These changes do not make static course HTML, JavaScript, or other files private. Google Group membership protects restricted Google Drive assets, but any file published from the public site origin remains directly retrievable. The staged migration required for genuinely private course delivery, including expected member and administrator effects, is documented in `SECURITY_MIGRATION_PLAN.md`.
- Keep browser Firebase configuration public and restricted by Firestore rules and authorized domains. Never put service-account credentials, Gemini keys, Apps Script signing secrets, or other server credentials in shipped files or Firestore settings readable by members.
- The Admin Console password gate is now localhost-only. On production, `admin/index.html` discards the browser-only admin flag, requires Firebase Google sign-in, and opens only for an `authorized_members` account with `admin` or `owner` role (with the existing bootstrap owner retained for lockout recovery). Localhost and `127.0.0.1` keep the password preview workflow.
- Admin welcome/test emails and removed-member logs now route through the authenticated `runAdminAction` Firebase callable. It verifies the Firebase user and admin/owner role, allowlists actions, caps payloads, and relays to Apps Script with `APPS_SCRIPT_ADMIN_RELAY_SECRET`. Browser-to-Apps-Script Google Group requests were removed, and the Admin Console does not create group-sync jobs while Workspace automation is unavailable.
- Production Admin keeps the Google sign-in button disabled until the Firebase authentication API is ready. The gate listens for the Firebase-ready/error events and also polls briefly so a missed or delayed module event cannot leave the page on a permanent loading message.

### 2026-08-02 — Optional SCQA practice flow

- The required Olympics SCQA remains the only completion and reward event. After saving it, members can return to the Learning Journey or choose one of five optional, non-Aiko practice topics. Practice attempts reuse the same builder, rules review, AI fallback, samples and saved-attempt switcher, but never award completion MP again.
- The completed SCQA preview in the Learning Journey offers `Review my SCQA` and `Practice another SCQA`. The second link opens the existing exercise directly at its topic picker. The journey status shows the number of distinct completed practice topics when at least one has been saved.
- The SCQA review page presents the deterministic structure check and optional AI review inside one `Feedback on your SCQA` panel. Items needing work stay visible, while passed rules sit in one collapsed summary so the page emphasizes action rather than a long checklist.
- The optional-practice topic picker uses a warm cream background and restrained gold border, while topic cards remain white. This visually separates optional repetition from the required review without making it look like another mandatory course step.

### 2026-08-03 — SCQA setup video

- Replaced the Phase 2 SCQA setup video with Google Drive file `10GgHE70T14fcp4tvGF3gsltwsGgp-HXQ` in the Learning Journey source, shared setup-first exercise flow and Admin Content defaults. A targeted migration replaces the former built-in file in existing browser settings while leaving genuinely customized URLs alone.

### 2026-08-03 — Written completion reflections

- The shared exercise award flow now asks members for one short written takeaway instead of offering three preset answers. Members can still skip, so reflection never blocks progress.
- Each core exercise keeps a tailored reflection question. Saved responses remain attached to the exercise reward ledger, while existing historical reflections remain intact.
- The Admin Console Rewards tab edits the question and previews the same member experience; the obsolete three-answer editor was removed.

### 2026-08-03 — Optional Speak like Obama practice

- The prepared Olympics speech remains the only required `Speak like Obama` completion and reward event. After completing it, members can return to the Learning Journey or practice an original 60-to-90-second speech. Optional rounds never award MP or change required course progress.
- Optional speaking practice deliberately mirrors the SCQA pattern: a visually separate topic picker, selected-topic preview, saved draft restoration, completed-round count, review/practice actions in the Learning Journey, and a compact `Your speeches` switcher inside the app.
- Preparation uses one open notes box rather than three required fields. Persistent prompts suggest a main point, supporting reason or example, deliberate emphasis or pauses, and a memorable close. The 60-second preparation timer starts only when the member selects it.
- Practice keeps the existing external Playback workflow. A round is saved only after the member records, reviews Playback feedback, and writes one specific improvement for the next speech. Recordings are not uploaded to or stored by the site. Local keys: `utl_speak_like_obama_practice_workspaces` and `utl_speak_like_obama_practice_attempts`.

### 2026-08-04 — Speak like Obama practice: per-topic workspaces, minor cleanup

- Reviewed the optional-practice feature above and found the same class of bug the SCQA practice pattern had already solved: a single `utl_speak_like_obama_practice_draft` slot meant starting or resuming practice on any topic silently overwrote whatever unsaved draft existed for a different (or even the same) topic, and the topic picker had no way to show "in progress" versus "not started." Notes also autosaved on a 250ms debounce, so navigating away within that window could drop the last few keystrokes.
- Replaced the single draft slot with `utl_speak_like_obama_practice_workspaces`, a map keyed by topic id — ported directly from `apps/scqa-builder/index.html`'s `utl_scqa_attempt_workspaces` pattern rather than inventing a new one. `saveDraft()` now writes into `workspaces[draft.topicId]` on every keystroke (no debounce, matching SCQA's synchronous-save convention, which also eliminates the race). Starting practice on a topic (`beginOrResumePractice()`) resumes that topic's existing workspace if one exists instead of creating a fresh draft, and routes straight to whichever stage (prepare/record/reflect) it was left at. Completing a round removes that topic's workspace entry (it's archived in the separate `utl_speak_like_obama_practice_attempts` array instead), so a finished topic always starts clean if practiced again.
- Topic picker now shows a third status, "In progress," for any topic with an unfinished workspace, and the "Start this practice round" button relabels to "Resume this practice round" for those topics, so the resume behavior is visible before the member clicks in.
- `member-login/content-config.js`'s `speakingPracticeState()` (added in the entry above) was updated to match: it now reads the workspaces map and surfaces the most-recently-updated in-progress topic as the Learning Journey's "Resume practice" target, instead of a single fixed slot.
- Also fixed two harmless leftovers from the original build: an unused `result` variable from the old `awardReflectionExercise()` call, and a `journeyLink.className` assignment made pointless by the very next line hiding that element.
- Updated `tests/speak-like-obama-optional-practice.test.js`'s contract to match (the old test asserted the single-slot `PRACTICE_DRAFT_KEY` design by name — that assertion was testing the design being replaced, not a still-valid constraint, so it was updated rather than preserved as a compatibility shim). Verified beyond the contract test: extracted the actual storage functions from both files and ran them through a real switch-topics-mid-draft-then-resume sequence, and confirmed `speakingPracticeState()` reads the exact shape the app writes. Full test suite green throughout.

### 2026-08-11 — Permanent exercise experiences

- Retired the manual/self-recorded alternatives for both Explain to Aiko exercises, the free-form Art of Saying No matrix, and the unlinked legacy Advisory Board archive. Their app folders, context-flow entries, query-string overrides, member routing logic, and Admin Console publish/preview controls were removed.
- The Admin Console now identifies the three permanent exercise experiences without offering version switches. Explain to Aiko retains its in-exercise microphone/transcription and AI-unavailable recovery paths because those prevent blocked completions; they are resilience behavior inside the permanent experience, not alternate manual versions.
- Member routing now uses the canonical exercise URLs directly and no longer reads `settings/assessment_versions`. Firestore rules no longer expose that retired document publicly. Historical completion-ID normalization remains so learners who used an older Explain to Aiko implementation do not lose reward history.

### 2026-08-11 — Admin Program UX simplification

- A virtual review panel covering nontechnical owners, operations admins, substitute admins, technical owners, content editors, and accessibility concerns, plus a senior UX review, found that the Program page mixed live settings, browser-only previews, QA links, and passive documentation. The redesign separates those purposes.
- Replaced the two Program access destinations with one `Visibility & access` page containing only live public, member, and admin/owner controls. Removed the dead browser-only assessment card states, the unused MA mission-card toggle, the redundant permanent-experience cards, and the misleading local visibility summary entries. Assessment scenario previews moved to `Preview & Health > Quick links`.
- Moved browser-only member-card and release-gate controls to `Preview & Health > Member preview settings`. Public settings now share one explicit Save action, avoiding the previous mixture of immediate and grouped saves.
- Phase pages now present compact read-only inventories of published lesson videos, setup content, and exercises. Each configured media item offers Open and Copy actions plus a textual Configured/Missing status. The browser-local Edit, Save override, Use config, drag/reorder, add-context, save-default, and reset-layout surfaces were removed from the visible admin workflow because they did not publish member changes.

---

## Change Log (2026-05-27 through 2026-07-22)

### 2026-07-22

- Added the guided The art of saying no experience at `apps/eisenhower-matrix/` with five persisted rounds, retry-without-penalty scoring, keyboard play, live written-no checks, summary skill bars, and legacy-compatible progress/reward saves. The original free-form experience is available as the v2 alternate at `apps/eisenhower-matrix-v2/`.
- Extended the Admin Console exercise-version manager and `settings/assessment_versions` routing with an independent `eisenhowerMatrix` switch: guided v1 is the safe default and the original free-form matrix is the v2 alternate. Audit metadata, local preview mirrors, direct preview links, and the semantic `?matrixVersion=v1|v2` testing override follow those labels.

### 2026-07-20

- Added dark-launched Explain to Aiko v2 apps for 120-second and 60-second practice with browser recording, live Web Speech transcription, countdown rings, measured duration/WPM/fillers, paste and phone/Playback fallbacks, and additive legacy-compatible completion saves.
- Added `scoreExplainToAiko`, a CORS-restricted Firebase HTTPS Function using the `GEMINI_API_KEY` secret, Gemini model fallback/retry, server-side rubric validation, and a non-blocking `{ fallback: true }` response on scoring failure.
- Added independent Admin Console rollout controls backed by `settings/assessment_versions`, public-read/admin-write Firestore rules, localhost preview mirrors, audit metadata, and direct preview links. The canonical AI exercise is primary and the `-v2` self-recorded exercise is the alternate.

### 2026-06-11

- Implemented Aldon feedback batch: phase cards now show `Completed` when exercises are done; member practice apps now load `assets/app-access-guard.js` so direct app URLs require a member session and respect phase locks; the guard also checks individual exercise completion keys when aggregate phase keys are stale.
- Moved the global feedback widget to the bottom-left and made it more compact to reduce overlap with sticky/final action buttons.
- Added local completion-key writes to Phase 2/3 save flows where they were missing, added explicit completion handling to Advisory board and Eisenhower, allowed the Advisory board orchestrator to be selected from the existing board, added Advisory board back navigation and a final debrief step, and updated SCQA sample answers from the Aldon notes.
- Updated My Results capitalization (`Home & orientation`, `Assessments`) and reframed the email action as a thank-you summary with progress and workbook details.

### 2026-06-10

- Redesigned the recording assessment flow for `apps/explain-to-aiko/`, `apps/explain-to-aiko-60/`, and `apps/speak-like-obama/` around the shared TSA Gemini Gem. The Aiko pages now instruct learners to record on phone in portrait mode, upload the video/audio to the Gem, and save Gem feedback/reflection in the exercise instead of transcribing into the page; `my-results/` recognizes the new `gem_feedback` field. Speak like Obama now includes a formatted recording script and a matching six-step phone-to-Gem upload flow with the same clipart style.
- Added the missing final-screen `Mark as done` action to `apps/grocery-list-ai/`; it writes local completion keys and saves `grocery-list-ai` progress to Firestore with the learner reflection.

### 2026-06-09

- Hardened member workspace progress hydration: `assets/firebase.js#getMemberWorkspaceProgress` now merges `users/{uid}/completed_exercises` into `workspaceProgress.exercises` so Phase unlocks can recover if the summary progress map is stale. `member-login/content-config.js` no longer lets remote `completed: false` clear an existing local completed exercise during hydration.
- Updated Phase 3 AI assistant launch links: `apps/speak-like-obama/` now opens the shared TSA Gemini Gem, and `apps/lets-switch-hats/` now opens the Gemini Gem version instead of the older ChatGPT link.
- Fixed Phase 1 feedback items from `[2026] Weekly goals for Aldon`: `apps/rushed-voice-memo/` and `apps/chalkboard-notes/` now override inherited launch-specific coverage keywords with task-specific content coverage criteria; `apps/rushed-voice-memo-ai/` no longer starts with a body scroll lock that can hide the bottom action buttons.

### 2026-06-03

- Updated public Find your level scoring: `apps/find-your-level/index.html` now supports random/fixed exercise selection from all eight public Sort & Bucket sets, uses concept-based 100-point scoring from `data/tsa-score-bands.js`, and shows the learner's score plus band explanation on the result screen. Admin Console `Assessment visibility & access > Public` controls random vs fixed exercise selection.
- Reorganized Admin Console `Site & Content` assessment controls into `Assessment visibility & access`, ordered as Public, Members, then Admin/ owner. Public Find your level/card visibility, member assessment access, member Diagnostic/Checkpoint card status, and Admin/ owner preview controls now live together; the duplicate standalone `Assessments` left-nav item was removed. Admin/ owner preview can keep hidden public Diagnostic/Checkpoint cards visible on `tsa-score.html`. The Admin Tools section remains reachable from the top nav/profile path but no longer appears in the left sidebar.

### 2026-06-02

- Added `ASSESSMENTS_AND_GROCERY_REFERENCE.md` as a shareable reference for all current assessment content, answer keys, and scoring methodology, including public/member Sort & Bucket, Spot the Problem, Speak Concisely, Act Confidently placeholder status, and the Phase 1 Grocery list practice exercise.
- Added richer member video troubleshooting in `member-login/content-config.js`: each embedded Drive/Slides media block now includes an `Open in Google Drive` fallback plus desktop/mobile guidance for wrong Google account, Brave/ Safari privacy settings, third-party cookies, mobile Drive account switcher, and Google Group propagation delays.

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
- Updated member practice apps to remove automated email triggers. Switched to learner-controlled submission via My Results dashboard. Added.

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

Phase 1, Think Clearly. Take chalkboard image notes and organise into MECE buckets. Exercise image: `apps/chalkboard-notes/assets/chalkboard-notes.jpg`. Sections: Current state, Ideal state, Roadblocks.

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
