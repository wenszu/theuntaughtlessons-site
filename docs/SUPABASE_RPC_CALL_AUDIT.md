# Database function call audit

Date of the audit: 2026-10-09. Scope: every place the repository calls a database function (`/rest/v1/rpc/<name>`) or an Edge Function (`/functions/v1/<name>`).

## Why

`assets/supabase-data.js` called `rpc("update_my_profile", picked)` with the profile keys as top level arguments. The live function is `public.update_my_profile(p_fields jsonb)`, so PostgREST answered 404 and the profile save (name, goals, avatar, photo, feedback switch) failed without a visible error. The unit tests did not notice because their fake Supabase accepted any argument shape, and two tests even asserted the wrong shape.

## The contract

- `supabase/rpc-signatures.json` is `{ name: [{ argName, type, hasDefault }] }` for all 103 functions in schema `public`.
- It is produced from `supabase/migrations/*.sql` by `scripts/supabase-rpc-signatures.js` (read only; the last `create [or replace] function` wins, `drop function` removes, `alter function ... rename` is followed, an overload is refused because PostgREST cannot choose between overloads).
  - Refresh: `node scripts/supabase-rpc-signatures.js --write`. Check only: `--check`.
- Checked against the live project `czljyikfavtjgqcibdda` on 2026-10-09 with a read only select on `pg_proc` (`node scripts/supabase-rpc-signatures.js --live-query` prints the select): 103 functions live, 103 in the contract, none only live, none only in the contract, no difference in argument names, order, types or defaults. The live database matches the migrations.

## Call sites checked

| Area | Files | Call sites | Notes |
| --- | --- | --- | --- |
| Browser (assets, admin, apps, tools) | 14 | 93 | 55 direct calls or URLs, 38 wrapper table entries whose arguments come from a builder |
| Edge Function cores (server side calls with the service key or the member token) | 9 | 24 | |
| Firebase function `functions-aiko/store-attempt.js` | 1 | 1 | |
| Owner scripts (`scripts/supabase-cutover-check.js` probes, import, rehearsal) | 3 | 39 | |
| Total | 27 | 157 | 0 problems after the fix |

Direct calls and URLs: `assets/supabase-data.js` (25), `admin/inbox/inbox.js` (11), `assets/supabase-site.js`, `-member-reads.js`, `-question-bank.js`, `-callables.js`, `-auth.js`, `feedback-widget.js`, `public-waitlist.js`, `apps/find-your-level/index.html`, `tools/supabase-auth-check/index.html`. Wrapper tables: `assets/supabase-admin-reads.js` (11), `-admin-console-reads.js` (13), `-admin-writes.js` (14). The builders behind the tables are run by `tests/rpc-call-contract.test.js` against the contract, with several argument shapes each.

## Mismatches found

| # | Where | Call | Problem | Status |
| --- | --- | --- | --- | --- |
| 1 | `assets/supabase-data.js` (`updateMyProfile`, `updateMemberAccount`) | `update_my_profile` | Profile keys sent as top level arguments; the function takes one argument `p_fields jsonb` | Fixed by the main assistant before this audit (`{ p_fields: ... }`); tests updated here |
| 2 | `tests/remaining-firestore-reads.test.js`, `tests/supabase-data-adapter.test.js`, `tests/supabase-switch.test.js`, `tests/supabase-member-mode.test.js` | `update_my_profile` | Asserted the wrong (bare keys) body | Corrected to `{ p_fields: {...} }` |

No other call site mismatches: every function name exists, every argument name is a real parameter, every required parameter (no default) is sent, and every JSON object parameter is passed under its `p_` name. The paged reads send `p_limit: null` when the page has no size; the name is valid and the parameter has a default, but whether the SQL treats an explicit null like the default is a database behaviour question for the pglite tests in `supabase/`, not for this audit.

## Edge Function request bodies

The keys each client sends were compared with the keys the Edge Function core reads. No mismatch.

| Function | Client | Keys sent | Read by the core |
| --- | --- | --- | --- |
| readiness-submit | `apps/executive-signature/index.html` through `assets/readiness-submit-client.js` | name, email, tier, band, profile, formVersion, submissionId, answers, itemOrder, startedAt, durationSeconds, consent, source | all read as `input.*` |
| readiness-access | `assets/supabase-callables.js` | email | `body.email` |
| result-emails | `assets/result-email-client.js` | readiness-result: attemptId; my-results: recipients, resultsText, filename | `input.*` |
| admin-mail | `assets/supabase-callables.js` (from `admin/index.html`) | action, payload | `body.action`, `body.payload` (payload keys: templateData, subject, renderedHtml, plainBody, emailFormat, recipient, to, email) |
| auth-admin/invite | `assets/supabase-site.js` | email, destination | `body.email`, `body.destination` |
| stripe-checkout | `assets/firebase.js` | program, successUrl, cancelUrl | `input.*` |
| ai-score (explain-to-aiko and tsa-diagnostic) | `assets/ai-score-client.js`, `apps/explain-to-aiko/aiko.js`, `apps/tsa-diagnostic/index.html` | the same bodies as the Firebase scorers | `body.*` |

All routes the browser posts to under `functions/v1/` exist as `supabase/functions/<name>`.

## What now enforces it

- `tests/helpers/rpc-contract.js`: every fake Supabase in `tests/` (about 35 test files, plus the shared `tests/helpers/firebase-harness.js` that backs another nine) calls `rpcContract.reject(url, init)`. An unknown function, an unknown argument name or a missing required argument is answered 404 (`PGRST202`) exactly like PostgREST, and the rejection is recorded: the test process exits with 1 even if the code under test swallowed the 404.
- `tests/rpc-call-contract.test.js` (22 checks): the contract file equals what the migrations produce (so it cannot be older than the newest migration or list a function the migrations do not define); the parser and the live comparison are unit tested; the static scan of the repository (`scripts/supabase-rpc-call-scan.js`) has no problems and demonstrably sees the known call sites; the scan fails on the old bug shape (arguments that cannot be read, bare keys, unknown function, unknown argument, missing argument); the real builders of the table driven modules are run; every test with a fake `/rest/v1/rpc/` is required to use the check; the Edge Function request bodies match what the cores read.
- `node scripts/supabase-rpc-call-scan.js` prints every call site and exits 1 on a problem.

## Not verified

- Argument types (a text argument sent a number, a uuid that is not a uuid) are not checked, only names and presence. PostgREST and the database check those.
- Wrapper builders are exercised with sample inputs, not every possible page input.
- Nested keys inside JSON objects (the contents of `p_input`, `p_fields`, `p_evidence` and so on) are not part of the contract; the pglite tests in `supabase/` cover them.
- The live check is a one time comparison on 2026-10-09. After a migration is applied, re-run the select printed by `--live-query` and `--write`.
