# Executive Signature submission on Supabase: setup and switch

This describes the public submission of the Executive Signature quick check and full assessment as a Supabase Edge Function named `readiness-submit`. It replaces the Firebase function `recordReadinessCompletion`. Nothing here is deployed or applied yet. The page still uses Firebase until you switch it, one browser at a time.

## What exists

| Piece | File | What it is for |
| --- | --- | --- |
| Database change | `supabase/migrations/20261008002330_readiness_submit.sql` (undo: `supabase/rollbacks/20261008002330_readiness_submit_down.sql`) | One database function that saves the whole result in one step (person, access, attempt, answers, consent, to do list, audit), and a small table that counts submissions for the limits |
| Edge Function | `supabase/functions/readiness-submit/` | Checks the request, scores the answers on the server, calls the database function |
| Browser file | `assets/readiness-submit-client.js` | The page's `recordReadinessCompletion`, which talks to Supabase only in a browser that you switched |
| Tests | `supabase/readiness-submit-test.mjs`, `tests/readiness-submit-core.test.js`, and new checks in `supabase/function-audit-test.mjs` | Prove the rules below |

## What it does, in plain words

1. A visitor finishes the quick check or the full assessment. The page sends the same information it sends to Firebase today.
2. The function checks every field. The score, band and profile are worked out again on the server from the answers. What the page says about them is ignored.
3. The database function does everything in one step, or nothing at all:
   - finds the person by email (main email first, then an active older email), or creates the person;
   - for the quick check, keeps one free access record per person and allows unlimited retakes, as Firebase does;
   - for the full assessment, uses only the one comped access record that this path made for the person itself (one attempt, no retakes), exactly the "Full Assessment testing access" Firebase gives today. **It never uses, counts against or attaches to a paid or sponsored access record, never copies a sponsor organization onto an attempt, and never changes anyone else's grant.** This path is anonymous, so it cannot prove who owns the email address, and a stranger who types a customer's email must not be able to spend that customer's purchase;
   - saves the attempt with its score, band, profile label, checksums and source (form version, channel, campaign, referrer code, and a suspect mark when the attempt looks automated);
   - saves the raw answers in parts of 20 together with the order the questions were shown in;
   - saves the consent record. Marketing consent is saved **only when this call created the person**. For a person who already existed, only the assessment processing consent is saved, and its source reads, for example, `web (unverified)`;
   - adds the to do events (analytics for both, report generation for the full assessment) and one audit row that holds only counts and codes, never the email, name or answers.
4. Sending the same submission twice (same email, tier and submission id) saves it once and returns the first answer. A repeat is not counted against the limits.
5. The page receives `{ ok: true, attemptId }`, the same as before. Any problem receives the same short message, "Could not save your result.", without saying why. Two answers are different on purpose: "Sign in required." (see ES_FULL_ACCESS below) and a plain 429 when the emergency ceiling is reached.

### Limits

- Per email address: 5 per hour and 10 per day (same as Firebase).
- Per network address: 30 per hour (same as Firebase). The address comes only from the `cf-connecting-ip` header, which the network edge sets and a caller cannot choose. The older `x-forwarded-for` header is **not** used, because a caller can write anything in it. An IPv6 address is reduced to its /64 block before it is turned into a one way code, so one home network cannot use a new address for every request. The code is the only thing stored.
- Callers whose address is unknown (no usable `cf-connecting-ip`) all share one bucket with a lower limit: 10 per hour for all of them together.
- Everyone together: 2000 per day. Past that, nothing is refused. The attempts are saved and marked suspect, and the function logs one line named `READINESS_GLOBAL_LIMIT_TRIPPED` the first time that day.
- Emergency ceiling: past 20000 per day (ten times the suspect mark) every request is refused with a plain 429 until the next UTC day. Normal traffic is far below this.
- A refusal by an email or address limit looks exactly like any other save failure. The counters are deleted after three days.
- Time limits inside the database function: it waits at most 3 seconds for a lock, and later statements are limited to 15 seconds (the hard bound on a whole call is the Edge Function's own 12 second deadline). The lock that creates the first assessment version is only taken when the version does not exist yet.

### Other protections

- Only these web addresses may call it from a browser: `https://theuntaughtlessons.com`, `https://www.theuntaughtlessons.com`, and `http://localhost` or `http://127.0.0.1` on any port. Look alike addresses are refused.
- JSON only. A request body above 32 KB is refused while it is being read.
- An email must be plain printable ASCII: letters, digits and `. ! # $ % & * + / = ? ^ _ { | } ~ -` before the at sign, and letters, digits, dots and dashes after it. No spaces, quotes, backslashes, control characters or accented letters. (This is stricter than Firebase. An address such as `o'brien@example.com` or one with an accented letter is refused. If this turns out to hurt real visitors, the pattern in `core.mjs` and in the migration is the one place to relax.)
- The logs hold only the kind, the status code, the time taken and a fixed note. They never hold an email, name, answer, address or key.
- Only the service key (kept as a server secret) can call the database function. Browsers cannot.

## Differences from Firebase you should know

1. **No sign in account is created by default.** Firebase created a login for every person who submitted. With Supabase sign up switched off (the plan), the function saves the person but creates no login. When that person later asks for an email link, it will be refused until a login exists. Two ways to fix it: set `ES_CREATE_AUTH_USER` to `on` (the function then creates an unconfirmed login for the email after the result is saved; a failure there never loses the result), or run the provisioning script later. Turn it on before you send real visitors through this path.
2. **The full assessment is open to anyone, as in Firebase today, but only through the path's own record.** Firebase gives anyone who submits a full assessment one free "testing access" record. This function does the same by default (when `ES_FULL_ACCESS` is not set). It will not use a purchase. A person who bought the full assessment must use a signed in path, which does not exist yet (a separate piece of work). Until then, set `ES_FULL_ACCESS` to `entitlement` once payments are live: the anonymous full assessment is then refused with "Sign in required.".
3. **ES_FULL_ACCESS fails closed.** Not set (or empty): Firebase style, as above. The exact text `comped`: the same. **Anything else**, including `entitlement` and any typing mistake such as `Comped`, `compd` or a trailing space, refuses the anonymous full assessment. This is on purpose: a typo must never open the door.
4. **Quick check retakes** are counted in `attempts_completed` but not in `retakes_used`, because the database rule says retakes used can never exceed retakes allowed. Nothing is limited by this.
5. **A person who already has any other comped full assessment grant (for example one given by staff) cannot use the anonymous path for the full assessment.** The path only uses its own record. That person is refused with the same generic message.
6. The attempt id is now a Supabase id. The Firebase "Email me this result" function looks attempts up in Firebase, so it cannot find attempts saved only in Supabase. Do not switch a real visitor's page until the result email has its own Supabase path (a separate piece of work).
7. **Not included:** `checkReadinessAccountEmail` (the "resend my access" check) is a separate route in the plan and is not part of this piece.
8. The Stripe webhook refuses a purchase when the database has no `full-assessment` definition. This function creates that definition (and its published version) the first time it is needed, so after the first full assessment goes through it exists. If a payment could arrive before that, ask the assistant to create the definition by hand first.

## What counts against a limit (exact statement)

- A request that fails the Edge Function's checks (bad fields, wrong form version, missing consent, a bad origin, too large, not JSON) is **not** counted anywhere. Nothing reaches the database.
- A request that reaches the database is counted once, before anything is saved. If it is then refused for a normal reason (an archived account, no attempt left, a switched off access record), the count stays, so repeated attempts against such an account use up the limit.
- A repeat of an already saved submission is **not** counted.
- If the database raises an error halfway (a bug or a failure), the whole step is undone, including its count. A repeated failing request therefore does not use up a limit. The Edge Function answers it with the generic message.
- A limited request itself is not counted again (the counters stop at the limit).

## Known exposures (read before switching real traffic)

1. **Forged consent.** Anyone can type any email address. The function cannot prove the typist owns it. So an assessment processing consent can be recorded for a person who never gave it. It is stored with a source ending in `(unverified)` for an existing person, and the audit row says `consent_unverified`. Marketing consent is never recorded for an existing person, so nobody can sign another person up for marketing this way. A person created by this very call can still be created with a typed address and marketing consent (the address was unknown before, so there is no one else's data to harm, but the consent itself is still unverified until the owner of the address confirms it). Do not treat these consent rows as proof of consent until the person confirms the email.
2. **Attempts added to a stranger's record.** The same reason: anyone can add a quick check attempt to the free record of an existing person, and raise its counters (`attempts_completed`), by typing that email. It does not touch purchases or sponsor links (see above). The staff screens will show those attempts under that person. Marked `suspect` is only a hint.
3. **Email rotation.** The limits count per email and per address. An attacker with many addresses can use a new email for every request, and an attacker behind a huge address pool can use a new address too. The 2000 per day mark and the 20000 per day ceiling are the backstop. Expect to see suspect marks, not blocked traffic, in that case. A CAPTCHA would be the next step (not built).
4. **The database being down fails closed.** Firebase let a request through when its limit store failed ("fail open"). Here the limit counters and the save are the same database step, so when the database is down or slow the visitor gets "Could not save your result." and the page offers a retry. No result is lost silently, but a visitor can lose the chance to save during an outage.
5. **Database logs may hold the submission.** A database error can make Postgres write the failing statement and its parameters to its log, depending on the setting `log_parameter_max_length_on_error` (and `log_statement`). The submission holds the email, name and answers. **Please check, or ask the assistant to check, the Supabase Postgres log settings for the project (Database, Settings, Postgres configuration, and Logs) and make sure parameters are not written on errors** (`log_parameter_max_length_on_error` set to 0, and `log_statement` not set to log everything). The Edge Function itself never logs the submission.
6. **The unknown address bucket is shared.** If the network edge stops sending `cf-connecting-ip`, all callers fall into the one bucket of 10 per hour, and the quick check would be refused for most visitors. Check the Edge Function logs for a rise in refusals after deploying.

## Secrets

You do not need to set any secret for the basic setup. The platform provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the function by itself.

| Secret | Needed? | Meaning |
| --- | --- | --- |
| `ES_CREATE_AUTH_USER` | Optional | The exact text `on` also creates an unconfirmed login for the email after the result is saved. Anything else, or not set, creates none. |
| `ES_FULL_ACCESS` | Optional | Not set: Firebase style (the anonymous full assessment gets its own comped record). Exactly `comped`: the same. Anything else, including `entitlement` and typing mistakes: the anonymous full assessment is refused with "Sign in required.". |

Set them in the Supabase dashboard (Edge Functions, Secrets) or ask the assistant to run `supabase secrets set NAME=value --project-ref czljyikfavtjgqcibdda`. Never put the service key in a web page.

## Steps

### Done by the assistant (after you approve)

1. Review the migration, then apply it to the project `czljyikfavtjgqcibdda` (the name in the migration list is `readiness_submit`).
2. Check the Postgres log settings described in exposure 5.
3. Deploy the function with the gateway token check switched off, because visitors have no account:
   `supabase functions deploy readiness-submit --no-verify-jwt --project-ref czljyikfavtjgqcibdda`
4. Run the test below with a clearly fake address.

### Test with a fake address (never your own account)

Use an address that cannot belong to a real person, for example `utl-es-test+0001@example.invalid`. In a terminal, send a quick check with the address and a new submission id. The assistant builds the request body from the test file `supabase/readiness-submit-test.mjs`. Expected: the answer is `{"ok":true,"attemptId":"..."}` and the assistant, using read only queries, finds one new person, one free access record, one completed attempt with the same score the Firebase code gives, 20 answers in one part, one consent record (plus marketing if it was given, for a new person only), one to do event and one audit row without the email in it. Send the identical request again: the same `attemptId` comes back and nothing new is saved. Send it from a browser console on a page that is not ours: the browser refuses. After the test, the assistant removes the test person and its rows in the same careful way it removes other test data.

### Switch one browser to Supabase (you)

The page must first get the two line change below (the assistant makes it after the tests above pass; it is safe because the default stays Firebase).

In `apps/executive-signature/index.html`, in the module script near the end that imports `recordReadinessCompletion` from `assets/firebase.js`:

```
import { recordReadinessCompletion as recordReadinessCompletionChoice } from '../../assets/readiness-submit-client.js';
window.raRecordCompletion = recordReadinessCompletionChoice;
```

The second line replaces `window.raRecordCompletion = recordReadinessCompletion;`. The first line is added right after the existing `import { recordReadinessCompletion, checkReadinessAccountEmail, sendReadinessAccessLink } ...` line.

Then, in the browser you want to try, open the developer console and run:

`localStorage.setItem('utl_es', 'supabase')`

Finish a quick check with a test address. A new person and attempt appear in Supabase and not in Firebase.

### Go back

In the same browser run `localStorage.removeItem('utl_es')`. The page uses Firebase again immediately. To remove the Supabase side completely: switch every browser back, then ask the assistant to run the rollback file (it removes the functions and the counter table and keeps the saved data).

## Risks to watch

- Until a Supabase path exists for the result email and the sign in link, a real visitor on the Supabase path cannot use "Email me this result" (it asks Firebase) and may not be able to open the saved results by email link (see difference 1).
- The hourly limit for one network address can affect many people behind one office connection. The number is the same as Firebase and is generous (30 per hour).
- If the function is deployed with the gateway token check left on, every browser request fails. Redeploy with `--no-verify-jwt`.
