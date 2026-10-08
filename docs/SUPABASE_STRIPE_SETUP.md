# Stripe setup: moving checkout and the payment webhook to Supabase

Written 2026-10-08. For the owner. Wave 10 of docs/SUPABASE_PLAN_SERVERS_AND_ADMIN.md. This involves real money, so read the whole page before you do anything, and do the Stripe test mode rehearsal (Part 3) before any live step (Part 5).

## Summary

- **What changes:** two small Supabase Edge Functions replace the two Firebase functions that talk to Stripe. `stripe-checkout` starts a Stripe Checkout Session for a signed in member (it replaces `createCheckoutSession`). `stripe-webhook` receives Stripe's "this session was paid" message and grants the purchase (it replaces `stripeWebhook`). The prices, products, redirect rules and what a purchase grants are the same as today. The one new database function `apply_stripe_payment` does the granting in a single step, all or nothing.
- **Why:** the plan moves every server function off Firebase. Payments were built to ship switched off, so this is the cheapest function to move: if payments never opened, nothing live has to be cut over at all.
- **Risk:** low while payments are closed and you stay in Stripe test mode. High if you cut over live money without the rehearsal. Nothing in this page touches live money until Part 5.
- **State today:** all of it is written and tested on a laptop. Nothing is deployed, nothing is applied to the database, the site still uses Firebase. The only site change is a hidden per browser flag (`utl_payments`) that does nothing until you set it by hand.
- **Order of work:** (0) answer three questions about Stripe today, (1) database change, (2) secrets and deploy, (3) test mode rehearsal, (4) run both webhook endpoints side by side, (5) live cut over, (6) retire the Firebase endpoint.
- **Time:** about 90 minutes of your time for Parts 0 to 4, spread over a day if you like. Part 5 is about 30 minutes.

## The rules for keys (please read twice)

- **Never paste a Stripe key, a webhook signing secret or a Supabase service key into this chat, into an email, a document or a screenshot.** The values start with `sk_`, `rk_`, `pk_`, `whsec_` or look like a very long `eyJ...` string. If you ever pasted one anywhere, tell me only "I pasted a key", and roll (replace) it in Stripe.
- Type or paste secrets only into the Supabase dashboard secrets page (Edge Functions, then Secrets) and the Stripe dashboard. Do not use the command line for secrets: commands stay in your shell history.
- Use **test mode keys** (they start with `sk_test_`) for everything in Parts 1 to 4. Live keys (`sk_live_`) are only used in Part 5.
- Tell me what you did in words ("I added the test secret key and the test signing secret"), never the values.

## What was built

| Piece | Where | What it does |
|---|---|---|
| `stripe-checkout` | `supabase/functions/stripe-checkout/` | A signed in member asks for a checkout. The function asks the database who the member is, reads the payment settings, asks Stripe for a Checkout Session and returns its address. It writes one audit row. |
| `stripe-webhook` | `supabase/functions/stripe-webhook/` | Stripe calls it. The function proves the message is from Stripe, ignores everything except `checkout.session.completed`, and calls the database function. |
| `apply_stripe_payment` | `supabase/migrations/20261008002290_stripe_payment.sql` | In one step: records the session as processed (first, so a repeat does nothing), finds or creates the buyer, grants the purchase, writes an audit row. If any part fails, none of it is kept and Stripe tries again later. |
| Site flag | `assets/firebase.js`, `createCheckoutSession` | If the browser has `utl_payments` set to `supabase`, the buy button uses `stripe-checkout`. Anything else (the default) uses the Firebase function, exactly as today. |

What a purchase grants (same as the Firebase version):

- **Executive Signature:** one paid, active entitlement for the full assessment, no retakes, tied to the buyer's person record, with Stripe's session id as the payment reference.
- **Think, Speak, Act (TSA):** the buyer becomes an active TSA member (an enrollment, which is what the old member list became), with a joined date. The Google Group is retired, so nothing about it is written. The welcome email is not sent by the payment; see the owner decisions below.

## Part 0. Three questions about Stripe today (10 minutes, no changes)

This is task 5 from the plan. Open the Stripe dashboard and tell me only these three things, in words:

1. Do **live mode** keys exist? Do **test mode** keys exist?
2. Is a webhook endpoint registered, and to which address (the address is fine to tell me; it contains no secret)?
3. Is the "Payments" switch in the admin console (Operations, Payments) off? (It should be, by default.)

Why it matters: if the Firebase Stripe secrets were never created and the switch is off, **nothing is live, and nothing has to be cut over**. We build and test the Supabase version in test mode and the Firebase version is simply never used. That is the cleanest outcome.

## Part 1. The database change (Claude does it, with your approval)

1. Claude shows you the exact change (`20261008002290_stripe_payment.sql`) and you approve it. It adds three functions (the payment function, its service-only wrapper, and a small read that lets a signed in member fetch their own person id and email for checkout) and changes no table.
2. Before it runs, Claude runs two read only checks. Both must pass:
   - The `full-assessment` row exists in the assessment definitions (the purchase points at it). If it is missing, the function refuses to grant and the payment would fail on purpose, so we fix this first.
   - The `executive-signature` and `tsa` programs exist.

   The precheck for the first item is this read only query. It must return one row (id `full-assessment`, program `executive-signature`):

   ```sql
   select id, program_id, status from public.assessment_definitions where id = 'full-assessment';
   ```

   If it returns nothing, **stop**. The payment function deliberately fails (and writes nothing) for an Executive Signature purchase, and the Stripe log line then shows code 55000 with the message "the full-assessment definition is missing". Whether to add that row, or to import it, is an owner decision (see below). Claude does not insert it on its own.
3. After it runs, Claude checks that anonymous visitors and signed in members cannot run the function (only the server key can).

Undo: `supabase/rollbacks/20261008002290_stripe_payment_down.sql` removes the three functions. Rows already written stay, because they describe real purchases.

## Part 2. Secrets and deploying the functions

1. In the Supabase dashboard open Edge Functions, then Secrets, and add:
   - `STRIPE_SECRET_KEY` = your Stripe **test** secret key. Used by `stripe-checkout` only.
   - `STRIPE_WEBHOOK_SECRET` is added in step 4 below, because Stripe only shows it after the endpoint exists.
   - Supabase fills in `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` itself. If a deploy later says the anon key is missing, add a secret named `UTL_PUBLISHABLE_KEY` with the publishable key from `assets/firebase.js` (that one is public).
2. Claude deploys both functions with the gateway sign in check turned off. This is deliberate: Stripe is not a person, and the site's members sign in with Firebase, which the gateway would refuse. The locks are inside the functions: the webhook checks Stripe's signature, and the checkout asks the database who the member is.
3. Until the signing secret exists, the webhook answers "not configured" and does nothing. That is safe.
4. In Stripe, **test mode**: Developers, then Webhooks (Stripe moves this menu now and then), Add endpoint.
   - Address: `https://czljyikfavtjgqcibdda.supabase.co/functions/v1/stripe-webhook`
   - Event: only `checkout.session.completed`.
   - Create it, then reveal this endpoint's **signing secret** (starts with `whsec_`), copy it, and add it in the Supabase secrets page as `STRIPE_WEBHOOK_SECRET`. Each endpoint has its own secret. Never reuse the Firebase endpoint's secret.
5. **Do not remove or change the existing Firebase endpoint.** This is a second endpoint, added next to it.

## Part 3. The test mode rehearsal (the part that protects real money)

Everything here uses Stripe **test mode** only: no real card, no real charge. The test card number `4242 4242 4242 4242` is Stripe's published test card.

**3a. Signature and ignore rules (no purchase needed).** With the Stripe CLI Claude can send test events to the new address. Expected results, which Claude checks in the function logs:
- A normal event with a wrong or missing signature is refused (400) and writes nothing.
- A `checkout.session.completed` from the plain CLI trigger has no program in its details, so the function acknowledges it and ignores it. That is correct, and it is the first test.
- Any other event type is acknowledged and ignored.

**3b. A real test mode checkout.** Use the **separate test member**, not your own account (your real record has been disturbed by tests twice). Payments must be open for this browser, and only for it:
- The buy button appears only when the payments setting says enabled. To avoid showing a buy button to the public, Claude changes the **Supabase copy** of the setting only (not the Firestore copy that the public site reads), for about 15 minutes. Members whose browser already reads from Supabase may see the button in that window, so choose a quiet time. Claude turns it off again afterwards.
- In the test member's browser, set the flag `utl_payments` to `supabase` (Claude gives you the one line to run in the browser console), sign in, and press the buy button. Pay with the test card.
- Expected: Stripe redirects back to the site, the function logs show one `processed`, and the database has one processed session, one entitlement (Executive Signature) or one TSA enrollment, and one audit row. The audit row holds counts and ids, not the email.

**3c. Replay.** In the Stripe dashboard, resend the same event to the new endpoint. Expected: the log says `already_processed`, nothing new is written, Stripe shows success. Do it twice.

**3d. Failure and retry.** Claude breaks the database call on purpose in a test copy and confirms that nothing is half written, and that the next delivery succeeds. This is already proven by the database test; the rehearsal confirms it end to end.

**3e. Clean up.** Claude removes the test member's rehearsal rows (it lists them to you first) and closes the setting again.

Go criterion: 3a to 3d pass, twice, on two different days if you can.

## Part 4. Both endpoints side by side

Stripe can send each event to several endpoints. For a short period leave both on, in **test mode**, and send test purchases:

- The Firebase endpoint writes to Firestore. The new endpoint writes to Supabase. Compare the two results for each test purchase.
- One caution: if the Firebase server mirror is switched on (the setting `SUPABASE_MIRROR=on`), the Firebase endpoint also copies its result into Supabase. A test purchase could then appear twice in Supabase (one row from the mirror, one from the new function). While testing, either keep the mirror off for payments or use test emails only, and Claude deletes the duplicates afterwards. This only matters while both endpoints are on.
- The processed session marker prevents double granting within Supabase. It does not know about Firestore, which is a separate system until the end.

## Part 5. The live cut over (only after Parts 3 and 4 passed)

This is the only step that touches real money. Do it when you have time to watch it, not at the end of a day.

1. Settle the owner decisions listed under "Owner decisions still open" first. They are product decisions, not migration work, and none of them should be made during a cut over.
2. Anyone who buys must be a signed in member with a person record. See "Differences" below: the old function let anonymous visitors start a checkout, the new one does not. The Executive Signature buy button on the public quick check page needs a sign in step or an account step before it works with the new function. That is a site change that must be agreed and tested before this part.
3. In Stripe **live mode**, add a second endpoint with the same address, the same single event, and copy its own `whsec_` secret into `STRIPE_WEBHOOK_SECRET` (this replaces the test value, so Part 3 rehearsals cannot be repeated until you swap back; plan for that). Replace `STRIPE_SECRET_KEY` with the live key.
4. Make one real purchase yourself with a card you control, at the lowest price you configure, with the test member's email, then refund it in Stripe. Confirm the rows, then mark the entitlement refunded.
5. Only then switch the site default from the Firebase function to `stripe-checkout` (a small code change Claude prepares and you approve; the flag today defaults the other way).
6. Open the payments switch in the admin console.

## Part 6. Retire the Firebase endpoint

1. After the new endpoint has handled live events correctly for a while (a week is reasonable), disable the old Firebase endpoint in Stripe. Do not delete it yet.
2. Watch for a few days. Stripe shows delivery success per endpoint.
3. Delete the old endpoint. In wave 14, roll the Stripe secret key and remove the Firebase copies of the secrets, as the plan says.

## Rollback

| When | Do this |
|---|---|
| Before Part 5 | Delete or disable the new endpoint in Stripe. Set the browser flag back (`utl_payments` removed or `firebase`). Nothing else was live. |
| After Part 5, a problem with the new functions | In Stripe re-enable the old Firebase endpoint and disable the new one. Switch the site default back (Claude prepares that change). Stripe retries events that failed for up to three days, and the processed session marker makes a retry safe. |
| A purchase was granted wrongly | Refund in Stripe. Claude sets the entitlement to refunded (the status exists for this). |
| The database function itself | Run the rollback file. Rows already written stay. |

## Differences from the Firebase version

These are on purpose. Please read them.

1. **The payment is bound to the signed in person.** Checkout sends the member's own email to Stripe (prefilled) and their person id (as the client reference and in the session details). When the payment arrives, the purchase goes to **that person**, even if a different email was typed at the Stripe page. Only a session with no person id (one made by the old Firebase function) is matched by email. A person id that does not exist is an error, never a guess.
1. **Checkout needs a signed in member.** The Firebase function could be called by anyone. The new one answers "sign in" (401) unless the database recognizes the member's token. That also means a first time buyer must have a person record before the buy button works. Webhook side: a buyer who has no person record yet gets one created at payment time (with the email they gave Stripe), so a payment is never lost for lack of a record. A buyer's person record from the webhook has no sign in link yet; linking it to the buyer's sign in is part of the sign in work (phase 6), so check that a new buyer can reach what they bought before opening payments.
2. **A session that is not ours is ignored.** If the same Stripe account is ever used for another product, its `checkout.session.completed` has no `tsa` or `executive-signature` program in its details. The Firebase function answered with an error (and Stripe retried for days). The new one acknowledges and ignores it. A session of ours with no buyer email is still an error (loud on purpose).
3. **Only a paid session grants.** The session must say `payment_status` is `paid`. A missing status, `unpaid` and `no_payment_required` are acknowledged and ignored, with the reason `not-paid` in the log. Card payments are always paid when the event arrives. If a delayed payment method is ever added, a different event is needed.
4. **The webhook does not need `STRIPE_SECRET_KEY`.** It never calls Stripe; the signed message has everything. One less secret in the place that faces the internet.
5. **The signature time limit is five minutes in both directions.** An old copy of a real message cannot be replayed.
6. **The account status rule is kept, for both programs.** An archived or deletion pending person cannot receive a purchase of either program (the payment call fails on purpose, nothing is saved, and Stripe retries, so you see it in Stripe). A restricted account can. A TSA purchase for a person whose TSA access was revoked on purpose does not reopen it; the audit row carries the flag `revoked_enrollment_needs_review` for a person to decide.
7. **The audit row has no email.** The Firebase audit entry stored the email. The new one holds the program, the Stripe session id, the amount, the currency and row counts. (The processed session table keeps the email, as it did.)
8. **Failed Stripe calls give a plain message.** Stripe's own error text is not passed to the browser.
9. **The return and cancel addresses are normalized** before they go to Stripe (a backslash trick such as `https://theuntaughtlessons.com\@elsewhere.example/` becomes a harmless path on our own site, and an address with a user name part is refused).
10. **The audit row records whether the amount matched the price** (`amount_matches_setting`: true, false, or empty when unknown), comparing Stripe's amount and currency with the payments setting or the built in default. It is a flag only; a paid session is never refused for it.
11. **Test mode sessions are processed by default** (needed for the rehearsal). The constant `REJECT_TEST_MODE` at the top of `supabase/functions/stripe-webhook/core.mjs` can be set to true at the live cut over so the live endpoint ignores any `cs_test_` session (a second lock beside the signing secret).
12. **A failed payment call is logged with its database code and message** (for example code 55000 and "the full-assessment definition is missing"), cut to 200 characters, with any email or session id blanked out. Nothing else of the answer, and nothing of the Stripe event, is logged.

## Owner decisions still open

None of these is decided by the code. Each needs your answer before Part 5.

1. **Sign in before the buy buttons (both pages).** The new checkout refuses a visitor who is not signed in. Two pages call it: `apps/executive-signature/index.html` (the full report button, also reached from the public quick check) and `programs/think-speak-act.html` (the self-guided program button). Both now show a clear message when the checkout answers "Sign in to continue." (the Executive Signature page as a toast, the program page as the button text), instead of failing quietly. That message appears only when the Supabase path is in use; with the default Firebase path nothing changes. What is still missing is the actual route to sign in: the buttons need a "Sign in" step or link before or instead of the purchase, and a new buyer who has no member record needs a way to create one (for the Executive Signature quick check, the person record already exists after the free check; for the program page it may not). This is a page design decision and a site change that must be tested.
2. **A TSA member whose access was revoked pays.** Today the payment does not reopen the access; the audit row carries `revoked_enrollment_needs_review`. Decide who looks at those rows and how fast, and whether the buyer is refunded or reopened.
3. **An archived or deletion pending person pays (either program).** The payment call fails on purpose, nothing is saved, and Stripe retries for days. Decide the handling: refund and reply to the buyer, or restore the account first. Someone must watch the failed deliveries in Stripe.
4. **The `full-assessment` definition row.** If the precheck in Part 1 returns nothing, Executive Signature purchases fail. Decide whether the row comes from the normal import or is added by hand. Claude does not add it without your approval.
5. **Who follows up a paid TSA buyer.** The Google Group is retired, so there is no group invite. The payment grants access only; it sends no welcome email. Decide whether the welcome email should be sent by hand or automated by a later change.
6. **Both endpoints in parallel (Part 4).** Decide how long the Firebase and Supabase endpoints run side by side, in test mode only, and whether the Firebase server mirror is switched off for payments during that time so that no purchase is written twice into Supabase.
7. **The free or comped full report grant.** What happens to people who already have a free or comped report when the paid report opens.

## Things that can go wrong (and what you will see)

- **The buy button says "Sign in to continue":** the member is not signed in, or the browser flag is set but the token has expired. Sign in again.
- **Stripe shows the new endpoint failing (red):** open the delivery in Stripe. A 400 means the signing secret in Supabase does not match this endpoint (copy it again). A 500 with "not configured" means a secret is missing. A 500 otherwise means the database call failed; the whole payment is rolled back and Stripe retries. The Supabase function log for `stripe-webhook` then shows the database code and message (for example 55000, "the full-assessment definition is missing"). Tell Claude the time and the word "failed", not any key.
- **A buyer paid and sees no access:** look for the processed session. If it is there, the purchase was granted; check the person's sign in link. If it is not, the delivery failed; resend it from Stripe once the cause is fixed.
- **Duplicate rows in Supabase during Part 4:** the mirror caution above. Tell Claude, who removes the test rows.

## What I need from you

- [ ] Answer the three questions in Part 0.
- [ ] Approve the database change (Part 1).
- [ ] Add `STRIPE_SECRET_KEY` (test) and later `STRIPE_WEBHOOK_SECRET` in the Supabase secrets page (Part 2). Never in chat.
- [ ] Add the second webhook endpoint in Stripe test mode (Part 2).
- [ ] Be available for the rehearsal in Part 3, with the test member's sign in.
- [ ] Decide the Executive Signature sign in question and the two open product items before Part 5.
