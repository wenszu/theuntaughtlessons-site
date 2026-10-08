# Email setup: sending mail from your own domain (Resend)

Written 2026-10-08. For the owner. No coding needed. Allow about 1 hour, plus waiting for DNS (usually minutes, sometimes a few hours).

## Summary

- **What changes:** emails (welcome emails, test emails, weekly organization reports, "email me my result", "email my results") are sent by a service called Resend instead of the Google Apps Script. Each email arrives from an address on your own domain, for example `hello@theuntaughtlessons.com`.
- **Why:** no Apps Script mail relay to keep alive, mail comes from your domain (better trust and fewer spam folders), and the Gmail daily sending limits no longer apply. It also gives you the sender the sign in emails need later.
- **What it costs:** the Resend Free plan is enough today. As of 2026-10-08 (checked on resend.com/pricing): Free is 3,000 emails per month and 100 emails per day, 3 domains, 30 days of logs. The next plan up is Pro at 20 US dollars per month for 50,000 emails with no daily cap. The Free plan stops at 100 a day instead of charging extra, so a very busy day would delay mail, not cost money. Prices change, so look at the pricing page when you sign up.
- **Risk:** low. Nothing switches until you change one setting (`MAIL_TRANSPORT`). You can switch back at any time.
- **Order of work:** (1) Resend account and domain, (2) DNS records in Cloudflare, (3) API key, (4) four secrets in Supabase, (5) one secret in Firebase, (6) deploy the Edge Function, (7) test, (8) switch over.

## How it fits together

Firebase functions (the admin actions) call a small Supabase Edge Function named `send-email`. That function checks a shared password (`MAIL_RELAY_SECRET`) and hands the email to Resend. Resend delivers it from your domain.

The Edge Function is deployed with the Supabase sign in check turned off (`verify_jwt = false`, or the flag `--no-verify-jwt`). This is deliberate: the callers are Firebase functions, which do not carry a Supabase sign in. The shared password is the only lock on the door, so make it long and keep it private. Without the right password, the function sends nothing.

## Step 1. Create the Resend account

1. Go to https://resend.com and sign up (the `wenszu@gmail.com` address is fine for the account owner).
2. Choose the Free plan.

## Step 2. Add your domain and the DNS records

1. In Resend, open Domains, then Add Domain. Enter `theuntaughtlessons.com`.
2. Resend shows you the exact DNS records to add. Do not type them from memory or from this note: copy them from the Resend screen. They normally are:
   - **SPF** (a TXT record) and a **mail server (MX) record** for the return path. Resend usually puts these on a subdomain such as `send`, which keeps them away from your existing mail records.
   - **DKIM** (a TXT record named like `resend._domainkey`). This is the signature that proves the mail is yours.
   - **DMARC** (a TXT record named `_dmarc`) is optional but recommended. A safe first value is a monitoring only policy. Resend shows a suggested value.
3. In Cloudflare, open the `theuntaughtlessons.com` domain, then DNS, then Records, then Add record. Add each record exactly as Resend shows (type, name, value). If Cloudflare offers a proxy switch, set it to "DNS only" (grey cloud).
4. Back in Resend, click Verify. It can take a few minutes. All records must show as verified.

### Warning: do not break your existing mail (SPF and Google Workspace)

Your domain may already receive or send mail through Google. A domain may have **only one SPF record** (one TXT record that starts with `v=spf1`) for the same name. Two SPF records for the same name make both fail, and then your normal Google mail can land in spam.

- Before adding anything, look in Cloudflare DNS for an existing TXT record that starts with `v=spf1` on the same name Resend asks for.
- If Resend puts its SPF on a `send` subdomain (the usual case), there is no clash. Just add it.
- If Resend asks for an SPF record on the main domain and one already exists, **do not add a second one**. Edit the existing record and merge: keep everything that is there and add Resend's `include:` part before the final `~all` (or `-all`). For example, an existing `v=spf1 include:_spf.google.com ~all` becomes `v=spf1 include:_spf.google.com include:<the value Resend shows> ~all`. Use the exact include text from the Resend screen.
- The same rule applies to DMARC: if a `_dmarc` record already exists, edit it, do not add another.
- If you are unsure, send me a screenshot of the existing DNS records before you change anything.

## Step 3. Create the API key

1. In Resend, open API Keys, then Create API Key.
2. Name it `utl-send-email`. Permission: "Sending access". Domain: `theuntaughtlessons.com`.
3. Copy the key now (it starts with `re_`). Resend shows it only once. Keep it in your password manager. Do not paste it into chat.

## Step 4. Choose the From address

Decide the exact sender text, for example:

`The Untaught Lessons <hello@theuntaughtlessons.com>`

The address part must be on the domain you verified. This is stored as a secret (`MAIL_FROM`), never inside the code, so it can be changed later without a deploy of code. `MAIL_REPLY_TO` is where replies go. It can be the same address or your Gmail address.

## Step 5. Add the secrets in Supabase

1. Create the shared password. In Terminal run `openssl rand -hex 32` and copy the 64 character result. This is `MAIL_RELAY_SECRET`. Use it in both Step 5 and Step 6, and keep a copy in your password manager.
2. Open the Supabase dashboard, project `utl-core`, then Edge Functions, then Secrets (Manage secrets). Add these four:

| Name | Value |
|---|---|
| `RESEND_API_KEY` | the key from Step 3 |
| `MAIL_FROM` | for example `The Untaught Lessons <hello@theuntaughtlessons.com>` |
| `MAIL_REPLY_TO` | the reply address, for example `hello@theuntaughtlessons.com` |
| `MAIL_RELAY_SECRET` | the output of `openssl rand -hex 32` |

If a secret is missing, the function answers "not configured" and sends nothing. That is safe.

## Step 6. Add the same password in Firebase

In Terminal, from the project folder:

```
firebase functions:secrets:set MAIL_RELAY_SECRET --project the-untaught-lessons
```

Paste the same value as in Step 5 when asked. It is not shown on screen.

Note for the code change: once the admin functions reference this secret, it must exist in Firebase before they are deployed, otherwise that deploy fails. That is why this step comes before switching over.

## Step 7. Deploy the Edge Function

Either of these works. The assistant can do the first one for you with its Supabase tool once the secrets exist.

- Ask the assistant: "deploy the send-email Edge Function with the sign in check off."
- Or in Terminal: `supabase functions deploy send-email --no-verify-jwt --project-ref czljyikfavtjgqcibdda`

If the function is ever deployed again without `--no-verify-jwt`, the Firebase functions will be refused with an "invalid JWT" message. Deploy it again with the flag.

## Step 8. Test (nothing is printed that should stay private)

This sends one test email to an address you choose. It asks for the shared password without showing it.

```
read -rs MAIL_RELAY_SECRET
```

Paste the password and press Enter (nothing appears on screen). Then:

```
curl -sS -X POST "https://czljyikfavtjgqcibdda.supabase.co/functions/v1/send-email" \
  -H "Content-Type: application/json" \
  -H "x-utl-mail-secret: $MAIL_RELAY_SECRET" \
  -d '{"to":["YOUR-ADDRESS@example.com"],"subject":"[TEST] Resend setup","html":"<p>This is a test from The Untaught Lessons.</p>","text":"This is a test from The Untaught Lessons.","kind":"manual-test"}'
unset MAIL_RELAY_SECRET
```

Replace `YOUR-ADDRESS@example.com` with your own address. What the reply means:

| Reply | Meaning |
|---|---|
| `{"ok":true,"id":"..."}` | Sent. Check the inbox, then check the spam folder once. Open "Show original" in Gmail and confirm SPF, DKIM and DMARC say PASS. |
| `{"ok":false,"error":"not-configured"}` | One of the four secrets is missing or empty (Step 5). |
| `{"ok":false,"error":"unauthorized"}` | The password does not match the one stored in Supabase. |
| `{"ok":false,"error":"provider"}` | Resend refused it. Usually the domain is not verified yet, or `MAIL_FROM` is not on the verified domain. Resend's Logs page shows the reason. |
| `{"ok":false,"error":"timeout"}` | Resend did not answer within 15 seconds. Try again. |
| `{"ok":false,"error":"invalid"}` | The request was malformed (for example a bad address). |

The function never writes addresses, subjects or message text to its logs. It records only a label, the status code and the time taken.

## Step 9. Switch the website over (and back)

After the code change described in the handoff report is merged and deployed, the whole switch is one setting:

- **Turn on the new sender:** in `functions-admin/.env` (the local file that is deployed with the functions and is not stored in git) add the line `MAIL_TRANSPORT=resend`, then deploy the admin functions (`firebase deploy --only functions:admin-actions --project the-untaught-lessons`).
- **Switch back to Apps Script:** change the line to `MAIL_TRANSPORT=appscript` (or delete it) and deploy again. The Apps Script path is not removed, so it works as before.

Suggested order for the first real use: send the admin "test email" from the admin console to yourself (the subject starts with `[TEST]`), compare it with an Apps Script one, then try "email me this result" on the Executive Signature page with a test member, then leave it on.

A few emails never move to Resend: the "removed member" log entry is not an email, it writes to a Google Sheet, so it stays on Apps Script on purpose.

## Good to know

- **Daily limit:** the Free plan allows 100 emails per day. Weekly organization reports and welcome emails are far below that today. If a bulk welcome run could pass 100 in a day, upgrade for that month or spread the sends over two days.
- **Per call limit:** one request can have at most 5 recipients (the "email my results" feature already limits itself to 5).
- **Results emails:** the old Apps Script attached the results as a text file. The new sender puts the same text in the body of the email instead, and uses the signed in person's address as the reply address.
- **Sign in emails later:** when the sign in moves to Supabase, the same Resend account can be used as the sign in email sender (Supabase Auth SMTP settings). That is a separate step, described in `docs/SUPABASE_PLAN_SIGNIN.md`.
- **If you need to rotate the password:** generate a new one, update it in both Supabase and Firebase, redeploy the admin functions. Until both match, sends fail with "unauthorized" (nothing is lost, the Firebase side reports an error).

## What lives where (for the assistant)

| Piece | File |
|---|---|
| Edge Function entry (Deno) | `supabase/functions/send-email/index.ts` |
| Tested logic (no Deno specific code) | `supabase/functions/send-email/core.mjs` |
| Firebase side client and the `MAIL_TRANSPORT` switch | `functions-admin/mail-sender.js` |
| Tests | `tests/send-email-core.test.js`, `tests/mail-sender.test.js` |
