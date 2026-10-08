# Question bank screen (Assessment content review) on Supabase

Written 2026-10-08. Built, tested locally, NOT applied to any database, NOT deployed, NOT switched on. The page itself is not changed yet (section 5).

## 1. Plain language summary

- The admin section "Assessment content review" shows, for each question of the TSA diagnostic and checkpoint bank, how learners did (responses, percent correct, median time, how often people changed their answer, how often each answer was chosen, quality reports) and lets a platform owner save a review (Active, Watch, Revise, Retired, with a note).
- Today the browser reads EVERY Firestore attempt document (each one holds the item results of one learner) and every review, and works the numbers out itself. A snapshot of learner results sits in the browser.
- Now the database works the numbers out and sends back counts only. No person, no attempt id, no date, no other field of an attempt ever leaves the database. The review write is a database function too.
- Migration `supabase/migrations/20261008002350_question_bank.sql` (undo: `supabase/rollbacks/20261008002350_question_bank_down.sql`) adds three functions, all for a platform owner only:
  `admin_item_health()`, `admin_item_reviews()`, `admin_save_item_review(p_input, p_dry_run)`.
- The browser side is `assets/supabase-question-bank.js` plus three new exported functions in `assets/firebase.js`: `getAssessmentItemHealth`, `listAssessmentItemReviews`, `saveAssessmentItemReview`.

## 2. What the health read returns (and what it never returns)

Per question, per question version and per scope (`all`, `diagnostic`, `checkpoint`):

| Field | Meaning |
|---|---|
| `n`, `correct` | responses, and how many were correct (the json value true) |
| `diagnosticN`, `diagnosticCorrect`, `checkpointN`, `checkpointCorrect` | the same split by assessment inside the scope |
| `optionCounts` | how many chose answer 0, 1, 2 and 3 |
| `changed` | responses where the learner changed the answer at least once |
| `reports` | learner quality reports (a feedback type was chosen) |
| `medianMs` | median response time |
| `discrimination` | the page's own formula (correlation of correct with the assessment total minus 20/15 when correct), only from 10 responses |

Also returned: the learner quality reports themselves (type and comment, newest 100 per question version), because the screen lists them to staff today, and the review status of each question. Everything else (person, person id, attempt id, dates, form, the correct answer, the question position, the intended difficulty, any extra field) is never returned. Only the item list of attempts written through the item attempt path is read (`legacy_firestore_id` starts with `assessment_item_attempts/`). Bounds: the newest 5000 attempts (the answer says `truncated`), at most 45 items per attempt, 3000 question groups, 6000 reports. Out of range numbers (a response time over a day, a total over 100) are ignored, so one odd stored value cannot break the screen.

Decision for you: the screen shows learner comments to staff today, so they are kept (bounded, 500 characters each, control characters turned into spaces). If you prefer counts without comments, say so and the comment text is dropped from the answer (the type counts stay).

## 3. The review write

`admin_save_item_review` takes `questionId`, `reviewStatus`, `currentNote` (up to 1000 characters), `questionVersion`, `bankRelease`. The database builds the decision log entry itself (time, status, note, the caller's address, version) and keeps the last 100 entries. The browser does not send a log. The audit row holds the question id, the status, the version and the length of the note, never the note. A dry run does the real work inside a savepoint and rolls it back. Reviews are stored in `assessment_item_reviews` under assessment `tsa-diagnostic` (one row per question).

## 4. Switches (all off by default; the default is the old behaviour)

| Flag | Reads (`getAssessmentItemHealth`, `listAssessmentItemReviews`) | Review write |
|---|---|---|
| none | Firestore only. `getAssessmentItemHealth` works the same numbers out of the Firestore documents with the same rules as the database | Firestore `setDoc`, field for field as the page does it |
| `?utl_server=shadow` | Firebase answers; Supabase is asked in the background; one console line with counts and field names, never a value | Firestore write first; after it succeeds ONE dry run is asked; one console line |
| `localStorage utl_server_reads=supabase` | Supabase first; a failure or an empty answer falls back to Firestore | not affected |
| `localStorage utl_server_writes=supabase` | not affected | Supabase ONLY (Firestore is not written). A failure is thrown with the Firebase style code, no fallback |

Turn the two flags on together. If only the write flag is on, a saved review does not show on a screen that still reads Firestore.

## 5. The page change (not done: `admin/index.html` was outside this slice)

All of it is in `admin/index.html`, section `cl-question-bank`:

1. Add `getAssessmentItemHealth`, `listAssessmentItemReviews` and `saveAssessmentItemReview` to the `window.utlFirebaseAuth` object (around line 4551).
2. `qbLoadHealth` (around line 8466): replace the two `fb.getDocs(...)` calls by `fb.getAssessmentItemHealth()` and `fb.listAssessmentItemReviews()`. Keep the answer in a variable (for example `qbHealth`) instead of `qbAttempts`. The status line "Loaded N completed assessment attempts" uses `qbHealth.attempts.all`.
3. `qbStats` (around line 8257): the part that filters rows and computes `n`, `correctRate`, `diagnosticRate`, `checkpointRate`, `medianMs`, `changedRate`, `reports`, `optionCounts`, `reportRate`, `discrimination` is replaced by one call per question to `questionStats(qbHealth, scope, question.id, qbVersionFor(question.id))`, where `scope` is the value of the assessment filter (`all`, `diagnostic`, `checkpoint`) and `questionStats` comes from `assets/supabase-question-bank.js` (`const { questionStats } = await import('../assets/supabase-question-bank.js')`). The result has exactly the field names the page already uses. Everything after that (formatMedians, the flags, the health words) stays as it is. `qbCurrentRows` is not needed any more.
4. `qbSaveReview` (around line 8338): replace the `setDoc(...)` by `await fb.saveAssessmentItemReview(questionId, { reviewStatus: status, currentNote: note, questionVersion: qbVersionFor(questionId), bankRelease: qbBankRelease, decisionLog })`. The page must take the review RETURNED by `saveItemReview` (the stored document, with the log the database built) as the new `qbReviews[questionId]`, instead of building the log entry itself.
5. Reviews: `qbReviews` is filled from `reviewSnapshot.forEach(...)`, which works unchanged on the snapshot look alike.

With no flag the page behaves as today (the same collections are read and the same numbers are shown).

## 6. Things to know before you turn it on

- The importer does not copy `assessment_item_reviews` (the collection is empty or nearly so). Before turning on `utl_server_reads=supabase`, look at the screen: if any question shows a review status other than Active, save the same review once with `utl_server_writes=supabase` on, or tell Claude and a small one off copy of the existing documents can be made. An empty Supabase answer falls back to Firestore on its own, but once one review exists in Supabase the Firestore reviews stop showing.
- The attempt numbers are only as complete as the mirror. New attempts reach Supabase through the browser copy (`record_tsa_item_attempt`, flag `utl_auth`/data source) and the importer; an attempt that reached only Firestore after the last import is not counted. Run the shadow mode first and read the console line: it says how many attempts each side counted.
- The health read scans the item lists of up to 5000 attempts. At today's size (hundreds) this is fast.

## 7. Owner steps (when you want it on)

1. Tell Claude. Claude shows you the migration and applies it only after you approve (read only functions plus one review write; additive; undo file ready).
2. After the page change (section 5) is deployed: open the admin console with `?utl_server=shadow`, open the section and read the console lines `Question bank read shadow ...`. Expected: `match`, or small count differences for data newer than the last import.
3. After three clean loads: `localStorage.setItem('utl_server_reads', 'supabase')` in your browser, check the screen, then the same for `utl_server_writes` when you want reviews saved in Supabase. Both come from the switchboard later (`server_reads`, `server_writes`).
4. To go back: `localStorage.removeItem('utl_server_reads')` and `localStorage.removeItem('utl_server_writes')`.

## 8. Tests

- `node supabase/question-bank-test.mjs` (116 checks): permissions, the numbers against the JavaScript reference on one data set, privacy, odd values, the review write, the log limit, the rollback.
- `node tests/supabase-question-bank.test.js` (45 checks; the CI runner is Node 20): the adapter, the default behaviour, shadow, Supabase first and Supabase only.
- `node supabase/function-audit-test.mjs`: the three functions are on the allowlist with their checks.
