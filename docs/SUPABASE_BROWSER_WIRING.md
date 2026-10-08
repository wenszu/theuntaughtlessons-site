# Browser wiring for the Supabase replacements (written 2026-10-08, night)

Status: written and tested locally. Nothing is applied to a database, nothing is deployed, nothing is committed. With every switch on `firebase` (the starting state) the site behaves exactly as before: the tests compare each changed function with the baseline copy of `assets/firebase.js` (`tests/fixtures/firebase-baseline.js`) call by call.

This is the page and browser side of `docs/SUPABASE_CALLABLE_GAP.md` (section 7, B and C). The database functions and Edge Functions it talks to are described there.

## 1. What each page now does

| Piece | Page or file | Switch (browser) | Switchboard flag | Default | In Supabase mode |
|---|---|---|---|---|---|
| Quick check / full assessment is saved | `apps/executive-signature/index.html` loads `assets/readiness-submit-client.js` | `utl_es` | `es_submit` (new, migration 2360) | Firebase callable, same call as before | Edge `readiness-submit`. A failure is shown to the visitor as before; there is no second save path |
| "Email me this result" (quick check page and Executive Signature My Results) | both pages load `assets/result-email-client.js` | `utl_mail` | `mail` (new) | Firebase callable | Edge `result-emails` |
| "Email my results" (TSA My Results) | `my-results/index.html` loads `assets/result-email-client.js` | `utl_mail` | `mail` | Firebase callable | Edge `result-emails` |
| Emails sent from the admin console (welcome, template test, weekly report) | no page change; `runAdminAction` in `assets/firebase.js` | `utl_mail` | `mail` | Firebase callable | Edge `admin-mail`. No shadow (an email cannot be sent twice), no fallback to Firebase |
| "Send me a link to my results" | Executive Signature My Results calls the new `requestReadinessAccess(email)` | `utl_es` **and** `utl_auth` both `supabase` | `es_submit` and `auth` | the two steps as before: Firebase check, then the Firebase link | Edge `readiness-access`: one anonymous call, always answers `{ ok: true }`; the page text is the same whatever happens |
| Member's certificate | no page change; `issueVerifiedCredential` (certificate page, TSA My Results, portal) | `utl_server_writes` = `supabase` | `server_writes` | Firebase callable | database function `issue_my_credential`. `shadow` and `?utl_server=shadow` stay on Firebase on purpose (no dry run: a second call would issue a second certificate). Failures keep the Firebase style codes, so the certificate page shows the same texts |
| Staff certificate repair | no page change; `repairMemberVerifiedCredential` | `utl_server_writes` | `server_writes` | Firebase callable | `admin_issue_credential`; shadow works (dry run). The admin page never exposes this function, so the repair loop in Student Progress stays off (see risks) |
| Sponsor page and the administrator preview | no page change; `getOrganizationConsole` | `utl_server_reads` | `server_reads` | Firebase callable | `get_organization_console`; shadow compares counts and field names only; a failure falls back to Firebase |
| Organization address check | no page change; `checkOrganizationRepEmail` | `utl_server_reads` | `server_reads` | Firebase callable | `admin_check_org_rep_email`; same read rules |
| Members list | `admin/index.html` calls `fb.listAuthorizedMembers()` | `utl_server_reads` | `server_reads` | the same `getDocs` of `authorized_members` | `admin_console_members` |
| Question bank screen | `admin/index.html`: health, reviews, review save | reads `utl_server_reads`, write `utl_server_writes` | `server_reads`, `server_writes` | the page's own Firestore code, untouched | counts only from Supabase; review saved in Supabase only (the stored review comes back, including the decision log the database builds) |
| Explain to Aiko and the TSA diagnostic scorer | `apps/explain-to-aiko/aiko.js`, `apps/tsa-diagnostic/index.html` | `utl_ai` | `ai` | the Firebase request exactly as before | `assets/ai-score-client.js` (Edge `ai-score`). The TSA page now sends the signed in token through the client (decision D12); signed out, the client answers "fallback" and the page scores by its own rules, as with any scorer failure |
| Checkout | already wired | `utl_payments` | `payments` | Firebase callable | Edge `stripe-checkout` |

Eight switchboard flags in total: `data_source`, `server_reads`, `server_writes`, `auth`, `payments`, `ai` (migration 2300) and `es_submit`, `mail` (migration 2360).

### The readiness link needs two switches on purpose
The Supabase link that `readiness-access` sends is a Supabase Auth link. The My Results page only understands such a link while `utl_auth` is `supabase`. With `utl_es` alone the page keeps using the Firebase check and the Firebase link. With `utl_auth` alone it does what it did before this change (Firebase check, then the Supabase Auth link, which cannot reach a person who has no Supabase account yet). Flip both together.

## 2. Migration 2360 (not applied)
`supabase/migrations/20261008002360_switchboard_more_flags.sql` and its undo. It only widens the shape check of the switchboard row and adds the two flags as `firebase` where they are missing. Needs 2300 first. The statement that adds the flags switches the change log trigger off for itself and on again right after (adding the names is not a flip, and no audit row should say it was). Apply after the usual independent review. Tests: `supabase/switchboard-more-flags-test.mjs` (55 checks) and `tests/supabase-switchboard.test.js`. Until it is applied the site file already understands the two names and a row without them counts as `firebase`.

## 3. A Supabase-only session now works (no Firebase user)
Everything below uses `localStorage.utl_auth = supabase` as the signal; with any other value the Firebase code runs exactly as before.

* `assets/firebase.js`: the staff writes module took its token from `auth.currentUser`; it now uses `siteIdToken`, like every other Supabase module of the file. The remaining reads of `auth.currentUser` in that file are the data layer fallback (the data layer picks by the switch itself), `siteIdToken`, `getSignedInUser` and checkout, each after the Supabase check. A test counts them.
* `assets/feedback-widget.js`: with `utl_auth = supabase` the token comes from `getSignedInUser()`.
* `admin/inbox`: already used `getSignedInUser()` (test added, no change needed).
* Executive Signature nav (`apps/executive-signature/assets/site-nav.js`) and My Results: no `users/{uid}` read for a Supabase session (that document is keyed by the Firebase uid). The nav builds what it needs from `getMyEsStatus` (the existing person keyed read); My Results takes the address from the signed in user. Helper: `apps/executive-signature/assets/account-record.js`. One thing this cannot give a Supabase-only visitor: the nav's first name when the sign in provider has no display name (it then shows the address).
* `admin/index.html`: the reviewer name of a question bank review uses the Firebase account first and the signed in account of a Supabase session otherwise.

## 4. How to try one piece in one browser
Open the developer console on the site and run, for example: `localStorage.setItem('utl_mail', 'supabase')` (admin mail), `localStorage.setItem('utl_server_writes', 'supabase')` (certificate), `localStorage.setItem('utl_es', 'supabase'); localStorage.setItem('utl_auth', 'supabase')` (readiness link). Back: `localStorage.removeItem('<name>')`. Use the test member, never the owner record.

## 5. Not switchable yet (and why)
* `changeMyCustomerEmail`: not built (decision D10).
* `setEmergencyCredential` and the admin invitation (`sendSignInInvite`): the Edge Function `auth-admin` exists but no page calls it; decision D4 (retire the emergency password) is still open.
* Anything that is only a Firebase trigger (`autoIssueVerifiedCredential`, `mirrorAuthorizedMemberWrite`, `setRoleClaimOnUserCreated`) is moved by database and owner steps, not by a browser switch.
* The Student Progress certificate repair loop: `repairMemberVerifiedCredential` is wrapped but the admin page does not offer it (it was never in `window.utlFirebaseAuth`). Adding it to the page would switch on a repair loop that issues certificates automatically, so it was left out.
* The Firestore-only parts of the admin console and the public certificate check page (`verify/`).
* Direct `users/{uid}` reads and writes inside `assets/firebase.js` (the data layer): they stay with the `data_source` switch.

## 6. Risks
* No shadow for mail and the certificate: the first live check of those two is the real thing. Use the test member and an address you control.
* In Supabase mode a mail, certificate or readiness-link failure is thrown to the page and not retried on Firebase (a second path could send or issue twice).
* The question bank page uses the old Firestore code when no flag is set, and the figures from `assets/supabase-question-bank.js` when a flag is set. A test runs the page's own functions on one data set and the figures are equal. Two limits only exist on the new path: the newest 5000 attempts and the newest 100 quality reports per question.
* `readiness-access` and `admin-mail` are not deployed. Do not flip `es_submit` or `mail` before they are (flipping `mail` also moves the result emails, which need `result-emails` deployed).
* Flipping `server_writes` to `supabase` now also moves the member's certificate button. The learner's progress must be complete in Supabase (`data_source`), or the certificate page shows "Not yet".
* The switchboard reaches an open tab within about five minutes; the first page of a new session can still use the old value.

## 7. Tests
`tests/browser-wiring.test.js` (page wiring, question bank figures, Supabase-only session, AI pages, scan for direct session reads), `tests/supabase-callables-switch.test.js` (admin mail, certificate, readiness link, staff writes with each kind of session, the new module), `tests/supabase-admin-reads.test.js` and `tests/supabase-admin-writes-switch.test.js` (now include the two new reads and the repair), `tests/inbox-submit.test.js` (feedback widget with a Supabase session), `tests/supabase-switchboard.test.js`, `supabase/switchboard-more-flags-test.mjs`. All run under Node 22 and Node 20.
