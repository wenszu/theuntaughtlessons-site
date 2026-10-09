# Cutover runbook: finishing the move from Firebase to Supabase, with Firebase kept as the safety net

Written 2026-10-09 for Wen-Szu. This is a plan and a checklist. Nothing in it has been run. It was written by reading the code in the branch `supabase-core` (the same code that is live on the site up to commit `d344aee`), the migration notes, and the setup guides named in each step. Where I could not find a fact, I say so in plain words.

Style note for later edits: no dashes, no unnatural contractions, no idioms (the owner's writing rules for the site).

## 1. The honest summary (read this first)

1. **You can finish most of the move in a few hours, but not all of it.** Steps 1 to 4 below (and step 5 if Stripe is ready) can be done in one working session. While they are done, Firebase stays complete and stays the place where every write lands first. Going back is one statement.
2. **The last step, moving sign in (the flag `auth`), cannot be done in hours.** I read the code to check, and today a person who signs in only with Supabase cannot get into the member area. Two things stop them: the member entry check reads the Firestore document `authorized_members`, and Firestore refuses any request that has no Firebase session; and the progress, drafts and rewards are saved to Firestore first, which also needs a Firebase session. This is explained in section 8. Do not flip `auth` for everyone until the code in section 8 exists. If you flipped it today, members would be signed out and could not get back in.
3. **Data only flows one way: from Firestore to Supabase.** Nothing copies from Supabase back to Firestore. That is why the safety net stays complete only while the flags that write first to Supabase stay off. Those flags are `server_writes` set to `supabase`, `es_submit`, `payments` and `mail` (for the data they create), and `auth`. Section 3 gives the exact list of what is lost if you roll back.
4. **`data_source` is already on for every member.** It has been since 2026-10-07 (the member gate). Flipping it in the switchboard changes almost nothing. It is step 1 because it is harmless and it proves the method.
5. **The server side copy (the "mirror") is not switched on.** I found the prepared patch but not its effect in the code. So Firestore changes made by the admin console or by server functions (new members, edited members, certificates, Executive Signature results, organization changes) do not reach Supabase by themselves. They reach it only when the catch up import runs. This decides the timing in section 3.
6. **Time order I recommend:** steps 0 to 4 today, step 5 only if Stripe is ready and tested, then a quiet period of daily checks, then the build work in section 8, then step 6 on its own day, then the closing steps in section 10. I could not find any estimate for the build work in section 8; ask Claude to size it before you plan a date.

## 2. How to use this document

**The method for every step is the same:**

1. Tell Claude which step you are starting. Claude runs the check command in "Before" form and tells you the result.
2. Paste the one statement from the step into the Supabase SQL editor (dashboard, project `utl-core`, "SQL Editor"). The editor should answer "Success" and "1 row affected". An error that mentions an unknown flag or a word that is not allowed means nothing was saved. Check the spelling.
3. Wait 5 minutes, or open a new private browser window (a new window asks for the setting at once). A page asks for the setting at most once every 5 minutes, and a tab that is already open keeps its old value until its next page load.
4. Tell Claude. Claude runs the check command in "After" form and reads the database. Then you do the short click list with the **test member**.
5. If the stop condition is met, run the rollback statement for that step and tell Claude.

**The check command (Claude runs it, read only, prints counts and PASS or FAIL lines only, never an address or a key):**

```
node scripts/supabase-cutover-check.js --stage N
```

`N` is the step number. It compares the switchboard row with what the step should have produced, then checks that sign up is off, that a stranger (no sign in) is refused by the staff, member and server only database functions and cannot read private tables, and that the number of sign in accounts agrees with the number of people. With `--compare-all --exclude-email <test member>,<owner>` it also runs the member compare (`scripts/supabase-shadow-compare.js`) for every active person and prints totals per check. Two known differences are expected there: the owner record (rewards, see the 2026-10-09 handoff note) and the test member. Leave them out with `--exclude-email`.

**Rules that never change:** never use your own member record for tests (use the test member); never paste a key or secret into the chat; do not edit data in Supabase tables by hand; stop and ask Claude when anything is unclear.

**Where a switch reaches:** the switchboard sets a browser switch only where that browser has no value yet, and never over a value a person set by hand. To see what one browser holds, open the browser tools console and enter: `Object.entries(localStorage).filter(([k]) => k.startsWith('utl_'))`.

**Reading the current state at any time:**

```sql
select value from public.app_settings where key = 'switchboard';
select created_at, detail from public.audit_events where action = 'switchboard.changed' order by id desc limit 20;
```

**Putting every switch back at once:**

```sql
update public.app_settings
set value = '{"data_source":"firebase","server_reads":"firebase","server_writes":"firebase","auth":"firebase","payments":"firebase","ai":"firebase","es_submit":"firebase","mail":"firebase"}'::jsonb
where key = 'switchboard';
```

Putting a switch back never deletes data in Supabase. It only tells browsers to use Firebase again.

## 3. The truth about data direction (what happens to writes)

This section answers: after `data_source` is `supabase`, where do member writes go, does Firestore still get them, and what is lost if we go back.

**3.1 Member writes after `data_source` is `supabase` (true today for every member)**

1. Firestore is written first, exactly as before. Only after that write succeeds, a copy goes to Supabase in the background. The page never waits for the copy and a failed copy is never retried or queued (it creates one stability event named `sync_error`, nothing more). The kinds of data copied this way: finished exercises, workspace progress, rewards, exercise attempts, drafts, practice rounds, learning evidence, engagement and tracking, stability events, the sign in record and profile, the Test of Strategic Action (TSA) item attempts and scoring comparisons, the admin console's direct writes (cohort details, the member feedback switch, the support preview audit), and the ten settings.
2. **One exception: the full text of finished exercise answers.** For a member on Supabase, the answer history (`exercise_submissions`) is not written to Firestore at all. It is written to Supabase only. Firestore keeps only the latest completion record (`completed_exercises`, overwritten each time).
3. **Two things are written to Supabase only, whatever the switches say:** leads and feedback (the Find Your Level form, the waitlist and the feedback widget) go to Supabase through `submit_lead` and `submit_feedback`.
4. **Reads** combine both sources, with Firestore as the base. Supabase may only add what is missing. Rewards are read from Firestore only (this was fixed after the owner record was inflated twice).
5. **Server side writes are not copied at all today:** the admin console (add or edit a member, move a cohort), the Executive Signature save, Stripe payments, certificates, organization changes. They land in Firestore only. They reach Supabase only through the catch up import (`scripts/supabase-import.js`). This is the mirror that is not switched on (`docs/SUPABASE_MIRROR_SWITCH_ON.md`).

**3.2 What the flags do to this direction**

| Flag | When it is `supabase`, where do new writes go | Is Firestore still complete? |
| --- | --- | --- |
| `data_source` | Firestore first, copy to Supabase (as in 3.1) | Yes, except the answer history in 3.1 item 2 |
| `server_reads` | Nothing is written. Screens read Supabase first and fall back to Firebase on any failure | Yes |
| `server_writes` as `shadow` | Firebase does the write. After it succeeds, Supabase is asked to do the same as a dry run (it writes nothing) and the browser console says whether the two agree | Yes |
| `server_writes` as `supabase` | **Supabase only.** The Firebase function and the Firestore write are not called, and a failure is shown to the admin, not retried. Also moves the member's certificate button | **No** |
| `ai` | Nothing stored by the flag itself | Yes |
| `mail` | Emails are sent by Supabase functions. Result emails read the result from Supabase | Yes for stored data, but see the dependency on `es_submit` below |
| `es_submit` | **Supabase only.** The quick check and the full assessment are saved in Supabase, with no Firestore customer, no Firestore attempt and no Firebase account | **No** for new results |
| `payments` | Checkout and the Stripe webhook run in Supabase; the purchase is granted in Supabase only | **No** for new purchases |
| `auth` | Sign in is by Supabase. Anyone created from then on exists in Supabase only | **No** for new accounts |

**3.3 What is lost if you roll back (anything written only to Supabase)**

1. The answer history of finished exercises since 2026-10-07 for members on Supabase (still in Supabase; Firestore holds only each latest completion).
2. All leads and feedback.
3. After step 6 starts: every admin change, certificate, Executive Signature result, purchase and new sign in account made in Supabase while the flags were on. Firestore never receives them. They would have to be replayed by hand or by a new script. **I found no script that copies from Supabase to Firestore.**
4. Any background copy that failed earlier (the other direction: Firestore has it, Supabase missed it). The import and `--compare-all` find these.

Nothing is lost from Firestore by a rollback. Nothing in Supabase is deleted by a rollback.

**3.4 Recommendation: final catch up import and freeze**

1. **Run the catch up import twice:** once right before step 4 (when screens start to read Supabase), and once right before step 6. Use the dry run first. See `docs/SUPABASE_MIRROR_SWITCH_ON.md`, step 8, for the exact commands. It needs a short lived Supabase secret key in your own terminal, which you delete afterwards.
2. **You may repeat the import at any time until step 6.** Until then Firestore is the system of record, so the import is right to overwrite the Supabase copy of members, enrollments and credentials. **After step 6 starts, never run the import again** unless Claude agrees: it takes the Firestore value for rows that are updated in place (people, enrollments, credentials, settings) and would overwrite what was written first in Supabase.
3. **Freeze for admins only, not for members.** Members keep working during every step because their writes are copied live. Ask admins (you) not to add, edit or move members, change organizations or issue certificates from 10 minutes before an import until the check after the step passes. Step 4 needs about 30 minutes of that quiet. Step 6 needs about 90 minutes.
4. **If you will keep editing members between steps 4 and 6,** switch the server mirror on first (`docs/SUPABASE_MIRROR_SWITCH_ON.md`, about 45 minutes and a deploy), or rerun the import after each edit. Otherwise the Supabase screens do not show your edit, because the write went to Firestore only.

## 4. Step 0: before anything (about 30 minutes, no flips)

1. **Backups.** A new Firestore export (`gs://the-untaught-lessons-firestore-backups/<today>`), a new snapshot saved outside the repo (`node scripts/supabase-import.js --project the-untaught-lessons --save-snapshot ~/utl-backups`), and the Firebase sign in export with its password hash parameters kept offline (plan in `docs/SUPABASE_PLAN_SIGNIN.md`, section 9). Claude checks that the files exist and that their counts are close to last time.
2. **Check command, stage 0:** `node scripts/supabase-cutover-check.js --stage 0`. Every line must pass: all eight flags `firebase`, sign up disabled, strangers refused, accounts and people agree (56 accounts and 56 people at the last count, test member included).
3. **Test member ready:** the test member exists as a person, has a confirmed Supabase account and can sign in with Firebase. Know which browser and which private window you will use.
4. **Write down the rollback statement** for the step you are about to take, and keep the "put every switch back" statement from section 2 open in a tab.
5. **Decide the quiet hours.** Choose a time when the AyalaLand members are unlikely to be on the site. They are allowed to sign in at any time, so stay ready to roll back quickly.

## 5. Steps 1 to 6 (one flip each)

Each step has the same parts. The reach of every flip is "within 5 minutes, or at once in a new private window".

### Step 1. `data_source` to `supabase`

**What changes for visitors:** nothing you can see. Every member is already on Supabase through the member gate. The flag only fills the browser setting where it is empty, for example a browser that has never signed in. A member with `supabaseOptOut` on the member record stays on Firebase; the gate decides again at the next sign in.

**Needs first:** nothing. No secret, no deploy.

**Flip:**

```sql
update public.app_settings set value = jsonb_set(value, '{data_source}', '"supabase"') where key = 'switchboard';
```

**Roll back:**

```sql
update public.app_settings set value = jsonb_set(value, '{data_source}', '"firebase"') where key = 'switchboard';
```

**Safety net:** full (see section 3). Rolling back does not change which members are on Supabase; the gate keeps them. To take one browser off, open the site with `?utl_data=firebase` at the end of the address.

**Assistant checks afterwards:** the check command with `--stage 1`; the switchboard history shows one change; new rows keep arriving for the test member's actions (engagement and progress counts rise); the number of `sync_error` stability events does not jump.

**You check (test member, private window):**

1. Sign in to the member area.
2. Open one exercise, type a few words, close it, open it again: the draft is still there.
3. Open My Results or the progress page: it looks the same as yesterday.

**Stop if:** the test member is signed out, an exercise does not save, or the page shows a "could not sync" banner. Roll back and tell Claude.

### Step 2. `server_reads` and `server_writes` to `shadow` (observe, change nothing)

**What changes for visitors:** nothing. Firebase still answers every request. Supabase is asked quietly beside it and the two answers are compared, with the result printed in the browser console as one line per screen (counts and field names only, never values). For `server_writes`, the Firebase write happens first; only after it succeeded does Supabase get the same request as a dry run. The member's certificate button stays on Firebase on purpose in this mode.

**Needs first:** nothing. The database functions are applied (migrations 2240, 2250, 2260 and the console reads). No secret, no deploy.

**Flip (two flags in one statement):**

```sql
update public.app_settings set value = value || '{"server_reads":"shadow","server_writes":"shadow"}'::jsonb where key = 'switchboard';
```

**Roll back:**

```sql
update public.app_settings set value = value || '{"server_reads":"firebase","server_writes":"firebase"}'::jsonb where key = 'switchboard';
```

**Safety net:** full. Leave this step on for at least one full admin session, ideally a day.

**Assistant checks afterwards:** `--stage 2`; a run of `--compare-all --exclude-email <test member>,<owner>` and reads the totals; confirms there are no new `sync_error` events from the shadow calls.

**You check (admin, with the browser console open):**

1. Press Cmd+Option+J in Chrome, choose the Console tab, type `shadow` in the filter box.
2. Open these admin screens one after another: Members, Student Progress, Customers, Executive Signature participants and attempts, Organizations, Credentials, Question bank, Inbox.
3. Three kinds of line appear. Read screens: `Admin read shadow <name>: match` is good; a line with `difference(s)` names fields and counts. Member reads (open the member area as the test member in another window): `Member reads shadow compare: <name> agrees with Supabase` is good; `differs from Supabase in ...` is not. Admin writes: `Staff write shadow <name>: the database function agrees on the fields and counts` is good; `differs` is not.
4. Count the lines that show a difference and read the first words of one of them to Claude (they name fields and counts, never people).
5. Make one harmless edit on the **test member** only (for example a note). A dry run that runs after the real write may report "already exists" or "already archived": that is normal.

**Stop if:** you see more than a few differences on the same screen, or any line that says Supabase "did not answer". Differences by themselves are not harm (nothing visible changes), but they must be understood before step 4. The usual cause is a Firestore change made after the last import, and the fix is the catch up import.

### Step 3. `ai` to `supabase`

**What changes for visitors:** the AI scoring of Explain to Aiko and of the TSA diagnostic goes through Supabase instead of the Firebase scorers. A signed in member is required (the old scorers checked only the website address). Each person gets at most 30 scoring calls per hour per exercise. A signed out visitor gets the page's own fallback scoring.

**Needs first (not done yet according to the handoff):**

1. The Gemini key copied from Firebase to Supabase as the secret `GEMINI_API_KEY` (guide: `docs/SUPABASE_AI_SCORE_SETUP.md`, step 1; you do it, the key never appears in the chat).
2. The Edge Function `ai-score` deployed (Claude does it after your go, with the gateway token check off). The migration for its limits (2280) is already applied.
3. **Check the TSA setting that turns AI scoring on** (admin console, settings, TSA scoring). The old Firebase scorer always fell back, so the TSA page always scored by its own rules. The new one returns real AI scores. If that setting is on, TSA results will start to use AI scores at this step. Keep it off until you decide otherwise.
4. Not needed: Stripe, `CRON_SECRET`, the mail secrets.

**Flip:**

```sql
update public.app_settings set value = jsonb_set(value, '{ai}', '"supabase"') where key = 'switchboard';
```

**Roll back:**

```sql
update public.app_settings set value = jsonb_set(value, '{ai}', '"firebase"') where key = 'switchboard';
```

**Safety net:** full. The Firebase scorers stay deployed until Firebase is closed.

**Assistant checks afterwards:** `--stage 3`; the function log for `ai-score` (route, status and time only) shows 200 answers and no refusals for the test member; a stranger's call returns 401.

**You check (test member):**

1. Open Explain to Aiko, record or paste a short take, submit. You should see the six scored criteria, not "AI feedback is unavailable".
2. Open the TSA diagnostic page. It should score and show its result as before. If it stays on its own rules because the TSA AI setting is off, that is correct.

**Stop if:** "AI feedback is unavailable" appears for the signed in test member, or the answers are empty. Roll back.

### Step 4. `server_reads` to `supabase` (after a catch up import)

**What changes for visitors:** the admin screens (members, customers, Executive Signature lists, credentials, organizations, the sponsor page, the question bank counts) and the member reads (which workspaces I may open, my organization access, my cohort standing, my saved responses) are answered by Supabase first. Any failure or empty answer falls back to Firebase and prints a console warning. Three admin answers stay on Firebase even in this mode (the support snapshot, the cohort details, and the member progress behind the Student Progress tools), because they carry data Supabase does not hold in the same shape.

**Needs first:**

1. Step 2 has run long enough to show matches.
2. The catch up import has just run (section 3.4). Use a fresh Supabase key for it and delete the key afterwards. No admin edits while it runs.
3. Not needed: Stripe, `CRON_SECRET`, Gemini.

**Flip:**

```sql
update public.app_settings set value = jsonb_set(value, '{server_reads}', '"supabase"') where key = 'switchboard';
```

**Roll back (or return to observing):**

```sql
update public.app_settings set value = jsonb_set(value, '{server_reads}', '"shadow"') where key = 'switchboard';
```

Use `"firebase"` instead of `"shadow"` to stop the background comparing as well.

**Safety net:** full for data (reads only). One practical limit: while `server_writes` is `shadow`, an admin edit lands in Firestore and does not show in the Supabase screens until the next catch up import or the mirror (section 3.4, item 4). So after step 4, do not edit members without a plan for that.

**Assistant checks afterwards:** `--stage 4`; `--compare-all` totals (all PASS except the known owner and test member differences); the Edge and database logs show the read functions answering 200 for the owner's admin session.

**You check:**

1. As admin: open Members. The count and the list look right (ask Claude for the expected count). Open Student Progress, Customers, Credentials, Organizations. Nothing is empty.
2. As the test member: open the member area. The workspace list, cohort standing and My Results page load.
3. In the console, filter for `Admin read`. A line that says "Supabase did not answer; the Firebase answer is used" is a fallback, not a failure, but tell Claude how many you see.

**Stop if:** a screen is empty or shows fewer people than before, or members cannot open their workspace. Roll back to `shadow`.

### Step 5. `payments` to `supabase` (only if Stripe is ready; otherwise skip)

**What changes for visitors:** the Buy button starts a Stripe checkout through Supabase, and Stripe's "paid" message is received by Supabase. A buyer must be signed in first (decision D11: the buy button must send a visitor to sign in and bring them back; I could not confirm that page work is finished, ask Claude). A purchase is then recorded in Supabase only.

**Needs first (none of this is done according to the handoff):**

1. Part 0 of `docs/SUPABASE_STRIPE_SETUP.md`: three questions about Stripe today. **If Stripe was never live and the "Payments" switch in the admin console is off, there is nothing live to move. Skip this step and leave `payments` on `firebase`.**
2. The test mode keys and signing secret stored as Supabase secrets (dashboard only, never the chat), the two Edge Functions `stripe-checkout` and `stripe-webhook` deployed, and migration 2290 applied (it is applied).
3. The row `full-assessment` must exist in the assessment definitions (read only precheck query in the Stripe guide). Without it an Executive Signature purchase fails on purpose.
4. A full rehearsal in Stripe test mode with the Stripe test card, then the second webhook address in Stripe, then live keys. The guide's Parts 3 to 5 are the order. **Never rehearse with a live card.**

**Flip:**

```sql
update public.app_settings set value = jsonb_set(value, '{payments}', '"supabase"') where key = 'switchboard';
```

**Roll back:**

```sql
update public.app_settings set value = jsonb_set(value, '{payments}', '"firebase"') where key = 'switchboard';
```

**Safety net:** broken for new purchases (Supabase only). Before rolling back after a live purchase, check Stripe's dashboard for the payment and ask Claude how to record it in Firestore.

**Assistant checks afterwards:** `--stage 5` (or `--stage 5 --expect payments=firebase` when skipped); the function logs show the webhook accepted (status 200) for the rehearsal payment; the purchase appears once in the database.

**You check (test member, Stripe test mode only):**

1. Sign in, open the program page, press Buy, pay with the Stripe test card.
2. You land back on the success page, and the access you bought is active.
3. In the Stripe dashboard (test mode) the event shows as delivered.

**Stop if:** the checkout does not open, a payment is taken twice, or the access does not appear. Roll back.

### Step 6. `es_submit`, `mail`, `auth` and `server_writes` to `supabase` together (BLOCKED, do not start)

This is the move that makes Supabase the first writer for the public Executive Signature path, for emails, for sign in and for admin changes. **It is blocked until the code in section 8 exists and has been tested on the test member.** The four flags are one step because they depend on each other:

1. `es_submit` alone: a visitor's result is saved in Supabase, but "send me a link to my results" still uses the Firebase check and cannot find it. It needs `auth` as well.
2. `mail` alone: the result email looks up the result in Supabase and cannot find a result saved in Firestore. It needs `es_submit`. (`mail` also moves the admin console emails.)
3. `auth` alone: members sign in with Supabase but cannot pass the member gate (section 8).
4. `server_writes` as `supabase` alone: new members added by the admin exist in Supabase only, so they cannot pass the Firestore based member gate until `auth` moves too.

**What changes for visitors:**

1. **Every browser is signed out at its next page load.** From my reading of the code, once `auth` is `supabase` the page looks only for a Supabase session and ignores the stored Firebase session. People sign in again, with an email link or Google. (The sign in plan says people already signed in are not interrupted. The browser code does not do that. Treat my reading as a risk to test on the test member.) Microsoft and Facebook are off in Supabase today, so members who used them need the email link. I could not find how many that is.
2. Executive Signature visitors: results are saved in Supabase, "Email me this result" and "Send me a link" work through Supabase.
3. Admin changes, certificates and emails go through Supabase.

**Needs first:**

1. Everything in section 8 built and tested.
2. Steps 1 to 4 on, and step 5 on or consciously skipped.
3. The sign in setup of `docs/SUPABASE_SIGNIN_OWNER_STEPS.md` complete and the ten line test plan passed on the live site: the Resend sender and SMTP, the Magic Link template, the redirect addresses, the Google sign in client (a Google Cloud client in the project `the-untaught-lessons`), sign up OFF. The 56 sign in accounts are already created and linked.
4. Secrets: `MAIL_RELAY_SECRET` set in Supabase and in Firebase with the same value (confirm); `RESEND_API_KEY`, `MAIL_FROM`, `MAIL_REPLY_TO` set. `CRON_SECRET` is not needed for these four flags (it is only for the weekly report timer). Stripe and Gemini are not needed for these four flags.
5. A second catch up import done in the freeze, then no more imports (section 3.4).
6. The certificate switch moment prepared (see "Also on the day" below).

**Flip (one statement, in the freeze):**

```sql
update public.app_settings set value = value || '{"es_submit":"supabase","mail":"supabase","auth":"supabase","server_writes":"supabase"}'::jsonb where key = 'switchboard';
```

**Roll back (the four together):**

```sql
update public.app_settings set value = value || '{"es_submit":"firebase","mail":"firebase","auth":"firebase","server_writes":"firebase"}'::jsonb where key = 'switchboard';
```

After a rollback each browser returns to its stored Firebase session. Whatever was created in Supabase only during the window (section 3.3, item 3) is not in Firestore.

**Safety net:** gone for everything written after the flip. The window should be short and the first day should be watched. Ask one AyalaLand member to sign in once and report what they see.

**Also on the day, in this order (they are not switchboard flags):**

1. Certificates: take the credentials export, delete the Firebase trigger `autoIssueVerifiedCredential`, enable the Supabase trigger, and run the catch up function once (`docs/SUPABASE_REPORTS_SETUP.md`, section 7). Never run both triggers. The public certificate check page (`verify/index.html`) now reads Supabase first when `server_reads` is `supabase` (migration 2374 lets it show a revoked certificate as "not active"), and falls back to Firestore; set `server_reads` to `supabase` before the first certificate is made only in Supabase.
2. Weekly organization reports: set up the Supabase timer and the secret `CRON_SECRET`, run the dry run, send the first Tuesday to yourself, then pause the Firebase timer (`docs/SUPABASE_REPORTS_SETUP.md`, sections 1, 3, 4 and 5). Only one timer may run in any week. This can be done earlier or later than the flip.

**Assistant checks afterwards:** `--stage 6`; sign in log for errors from the mail server; the number of confirmed accounts stays 56; new engagement rows keep arriving for the test member; no refusals in the function logs; `--compare-all` once more (it reads Firestore, which stops changing for people who now write to Supabase first, so differences are expected to grow; use it only to detect a broken day).

**You check (test member first, in a private window; then the owner account only to sign in, never to test exercises):**

1. Open the member sign in page. Request an email link. The email arrives in the inbox within a minute from the right sender. Open it, enter the address, sign in.
2. The workspace loads. Open an exercise, complete it, reload: progress is saved.
3. Open My Results, press "Email my results": the email arrives.
4. Sign out, press the Google button: you arrive signed in, and there is still one account for that address.
5. Enter a stranger's address on the sign in page: the page says the email was sent, and no email and no new account appear.
6. Complete the Executive Signature quick check with a plus address of your own mailbox. Press "Email me this result", then "Send me a link": both arrive.
7. As admin (a Supabase sign in): open Members, add a note to the test member, issue or view a certificate for the test member.

**Stop if:** any member cannot get in, an email does not arrive within five minutes, or the account count changes. Roll back first and ask questions afterwards.

## 6. Which step needs which secret or deploy

| Step | Secrets and deploys needed | Not needed |
| --- | --- | --- |
| 1 `data_source` | none | everything |
| 2 shadow | none | everything |
| 3 `ai` | `GEMINI_API_KEY` as a Supabase secret; deploy `ai-score` | `CRON_SECRET`, Stripe, mail |
| 4 `server_reads` | a short lived Supabase key for the catch up import (terminal only, delete after) | `CRON_SECRET`, Stripe, Gemini, mail |
| 5 `payments` | Stripe test then live secret key and webhook signing secret as Supabase secrets; deploy `stripe-checkout` and `stripe-webhook`; second webhook address in Stripe | `CRON_SECRET`, Gemini |
| 6 four flags | `MAIL_RELAY_SECRET` (same value in Supabase and Firebase), Resend key, sender settings, Google client; migration state as in the guides | `CRON_SECRET` (weekly timer only), Stripe, Gemini |
| Also: weekly report timer | `CRON_SECRET` (new, `openssl rand -hex 32`), `pg_cron` and `pg_net` switched on | the eight flags |
| Also: admin invitation by email | deploy `auth-admin` and set `AUTH_ADMIN_ENABLED` to the exact word `on` | everything else |

State of the Edge Functions on 2026-10-09 (from the handoff, not checked again live): deployed are `send-email`, `weekly-org-reports`, `result-emails`, `readiness-submit`, `readiness-access` and `admin-mail`. Written but not deployed: `ai-score`, `stripe-checkout`, `stripe-webhook`, `auth-admin`. Ask Claude to read the live list before each step.

## 7. The dual login period

1. **What it is.** For a while both ways of signing in exist. Supabase accepts Firebase tokens as a third party provider, and the database understands both kinds (`private.jwt_identity`). Browsers with `utl_auth` set to `supabase` sign in with Supabase; browsers without it sign in with Firebase.
2. **How long.** The sign in plan recommends about two weeks, because AyalaLand members log in only now and then. I recommend at least one week of daily checks, and the full two weeks if you want to follow the plan.
3. **During the period do not:** remove the Firebase provider from "Third-Party Auth" in Supabase, delete the Firebase trigger that gives new accounts the role claim (`setRoleClaimOnUserCreated`), or delete any Firebase account.
4. **One browser can opt out.** In that browser, enter `localStorage.setItem('utl_auth', 'firebase')`. The switchboard never overwrites a value a person set by hand.
5. **Daily check, 5 minutes:** sign in errors and "too many requests" answers in the Supabase Auth log, bounced emails in Resend, members who write in, the check command.

## 8. What must exist before `auth` can move (from my reading; not built)

I could not find these in the code. Each is a reason the flip would fail today. Ask Claude to confirm and to size them.

1. **The member entry check reads Firestore.** `getAuthorizedMember` and `requireAuthorizedMember` in `assets/firebase.js` read the document `authorized_members/<address>`. The Firestore rule lets only a Firebase session read it. A Supabase only session is refused. The replacement is the database function `get_my_access`, already written and applied, but only used today to compare, with the grant fallback switched off by decision. The staged plan (stages A to D) is in the handoff entry of 2026-10-08, "SETTINGS AND ACCESS ENTRY".
2. **Progress, drafts and rewards need Firestore first.** The save functions write Firestore first and Supabase second. A Supabase only session cannot write Firestore, so every save would fail and be queued. The data layer needs a Supabase first mode, or a bridge that gives the browser a Firebase session after a Supabase sign in (called Option C in `docs/SUPABASE_PLAN_SIGNIN.md`, section 8). Neither exists.
3. **Other places that read the Firebase session or Firestore directly: BUILT, not applied or switched on** (`docs/SUPABASE_REMAINING_FIRESTORE_READS.md`). The account page, the settings reads and writes, the feature flags, the cohort details, the member progress and the support snapshot, the Student Progress edit, reset and repair tools, the administrator gate and invitation, and the public certificate check page now have a Supabase path (migrations 2370 to 2374 plus `assets/supabase-site.js`). They run in a Supabase-only session (`utl_auth` supabase) or behind `server_reads` and `server_writes`. What is left to decide: apply the five migrations; a reset cannot give the same points a second time (the ledger is append only); the support preview from Supabase has no saved answers; enabling the certificate trigger (a student's last completion, or an administrator's edit that completes the program, then issues a certificate) is the owner's decision at step 6.
4. **The Firestore rules and the old triggers** can stay as they are during the period.
5. **The sign in setup and its test plan** (owner steps) must have passed on the live site.

## 9. Firebase callables that stop working once `auth` is `supabase`

All 36 Firebase callables read the Firebase session (`request.auth`). A Supabase only browser has none, so none of them can be used. Each one has a replacement behind a flag. **The flag in the last column must already be `supabase` before `auth` moves, or the matching screen stops working.**

| What stops | Replacement | Flag that must already be `supabase` |
| --- | --- | --- |
| Member reads: which workspaces, Executive Signature status, organization access, cohort standing, saved responses | database reads `get_my_*` | `server_reads` |
| Admin reads: customers, customer detail, Executive Signature participants, attempts, configuration and data governance, credential search and registry, organization access screen, members list, engagement and stability screens | `admin_*` read functions | `server_reads` |
| Sponsor page and the address check for an organization representative | `get_organization_console`, `admin_check_org_rep_email` | `server_reads` |
| Admin writes: grant or change an entitlement, reveal a raw answer, save an organization, give an organization role, review a roster proposal, manage a certificate, remove a member, authorize a member | `admin_*` write functions | `server_writes` |
| A sponsor's roster proposal | `submit_roster_draft` | `server_writes` |
| The member's certificate button and the staff certificate repair | `issue_my_credential`, `admin_issue_credential` | `server_writes` (only the value `supabase` moves them) |
| Admin emails (welcome, template test, weekly report by hand) and the result emails | Edge `admin-mail`, `result-emails` | `mail` |
| The public quick check save, the "do we hold a result" check, the results link | Edge `readiness-submit`, `readiness-access` | `es_submit` (and `auth` for the link) |
| Checkout | Edge `stripe-checkout` | `payments` |
| The three admin answers that used to stay on Firebase (support snapshot, cohort details, member progress), and the Student Progress edit, reset and repair tools | `admin_member_progress_all`, `admin_cohort_details`, `admin_member_support_snapshot`, `admin_replace_member_progress`, `admin_reset_member_progress`, `admin_repair_reward` (migrations 2370 and 2372) | `server_reads` **and** `server_writes` (both `supabase`) |
| `changeMyCustomerEmail` | none, on purpose (no page calls it) | not applicable |
| `setEmergencyCredential` (the Emergency access tab) | retired by the owner; the Supabase dashboard login is the emergency way in | not applicable |
| `repairMemberExerciseProgress`, `resolveMyCustomerIdentity`, `mirrorAuthorizedMemberWrite`, the two unused Aiko endpoints | not needed | not applicable |

`ai` is not required before `auth`: the AI scorers do not use a session. The Firebase trigger `autoIssueVerifiedCredential` stops firing after the flip because nothing writes progress to Firestore any more, which is why the Supabase certificate trigger must be switched on at the same moment (step 6, "Also on the day").

## 10. After the flips: the quiet period and closing Firebase

**Quiet period.** After step 6 watch daily for the length of the dual login period (section 7). Keep every Firebase piece in place: the project, the functions, the Firestore data, the sign in accounts, the provider in Supabase.

**All of this must be true before you close Firebase:**

1. All eight flags have been `supabase` for the whole quiet period, and the daily checks were clean.
2. **Backups exist and have been opened once to prove they work:** a final Firestore export, a final snapshot (`--save-snapshot`), the Firebase sign in export with hash parameters (kept offline, encrypted), and the Supabase daily backups are running (Pro plan).
3. **Nothing still reads Firebase:** the Firebase invocation counts for every function show zero for several days; the console warnings `Admin read ... the Firebase answer is used` have stopped; the public certificate check page and the settings reads have moved; the Apps Script web app that earlier received forms is no longer called.
4. **Secrets revoked or removed** (names only here, values never): in Supabase delete the secret keys named `provisioning` and `catch up import` and the key saved for the assistant on this computer (`~/utl-backups/.supabase-key`), and remove `http://localhost:8082/**` from the redirect list. In Firebase, remove the secrets that the closed functions used: `GEMINI_API_KEY`, `APPS_SCRIPT_ADMIN_RELAY_SECRET`, the Firebase copy of `MAIL_RELAY_SECRET`, the Stripe secrets (only after the Stripe webhook address is moved and proven), and `SUPABASE_SERVICE_ROLE_KEY` if the mirror was ever switched on. Then remove the Firebase provider from "Third-Party Auth" in Supabase.
5. **Close in this order:** pause the Cloud Scheduler job for the weekly report; delete the Firebase functions (not the project); change the Firestore rules to refuse everything; take one more dated export. The site itself is served by GitHub Pages, so it stays up.
6. **Keep the Firebase and Google Cloud project `the-untaught-lessons`. Do not delete it.** It holds the Google sign in client that Supabase uses, the Gemini key's project, the backup bucket `the-untaught-lessons-firestore-backups`, and the exports. Deleting the project deletes these. The plan's old idea of deleting the project after 90 days does not apply.
7. After step 4 of the closing list, never run the import again.

## 11. If something looks wrong (one page)

**First rule: roll back the last step, then ask questions.** Rolling back never loses data in Supabase and, before step 6, loses nothing at all. After a rollback wait 5 minutes or use a new private window.

1. **Members cannot sign in, or are signed out.** Run the rollback for step 6 (or the "put every switch back" statement). In one browser you can also enter `localStorage.setItem('utl_auth','firebase')` and reload.
2. **An exercise does not save, or a "could not sync" banner appears.** Check whether the page address ever had `?utl_data=firebase` (that browser is opted out). Enter `localStorage.getItem('utl_data_source')` in the console. Tell Claude. Do not clear browser storage on the owner record (it inflated the owner points twice).
3. **Admin screens are empty or show fewer people.** Put `server_reads` back to `shadow` or `firebase`. Cause is usually a Firestore change made after the last import: tell Claude to run the catch up import (only before step 6).
4. **An admin save shows an error after step 6.** The failed save wrote nothing and was not retried on Firebase. Roll back `server_writes`, repeat the save, and tell Claude which one failed.
5. **AI feedback is unavailable.** Put `ai` back to `firebase`. Possible causes: signed out, more than 30 calls in the hour, missing `GEMINI_API_KEY`.
6. **An email does not arrive, or "Email me this result" fails.** Put `mail` and `es_submit` back to `firebase` together (they depend on each other). Check Resend's log and the spam folder.
7. **Buy fails or a payment looks wrong.** Put `payments` back to `firebase`. First look at the payment in Stripe. Never repeat a payment before you know whether the first one was taken.
8. **Two certificates for one person, or a certificate that will not verify.** Stop issuing. Tell Claude. Cause: both certificate triggers were on, or the verify page still reads Firestore.
9. **A switch did not take.** The page asks for the setting at most every 5 minutes. A value set by hand in that browser wins. Enter `Object.entries(localStorage).filter(([k]) => k.startsWith('utl_'))` in the console and send Claude the output.
10. **The SQL editor shows an error.** An unknown flag or a word that is not allowed means nothing was saved. Check the spelling and the double quotes inside the single quotes.
11. **The check command prints FAIL.**
    1. "sign up is ENABLED": turn off "Allow new users to sign up" in Authentication now.
    2. "anonymous caller was NOT refused" or "could read private tables": stop all work, change nothing else, and tell Claude at once.
    3. "linked person points to a missing account", "addresses differ", "two people share an account": do not flip anything; tell Claude.
    4. "switchboard ... expected": the row is not what the step should have produced; read the row and the history (section 2), then tell Claude.
    5. WARN lines about probes that found no such function: the check could not prove those; Claude will correct the probe or the name.
12. **You are unsure.** Stop. Do not flip the next step. Tell Claude what you see, in your own words.

## 12. What I could not determine

1. Whether the live Firebase functions have `SUPABASE_MIRROR` on. The repository shows the patch is not applied (no function declares the Supabase secret). I could not read the deployed settings.
2. How many members used Microsoft or Facebook to sign in. Both are off in Supabase.
3. Whether the Stripe account is live, and whether the buy button already sends a visitor to sign in first (decision D11).
4. Whether the Gemini key is already stored in Supabase, and whether `ai-score` is deployed (the handoff lists it as not deployed).
5. The effort to build the pieces in section 8.
6. Whether a browser that has a stored Firebase session is kept signed in when `utl_auth` becomes `supabase`. From the code it is not. This needs a test on the test member.

Files this runbook relies on: `docs/SUPABASE_SWITCHBOARD.md`, `docs/SUPABASE_BROWSER_WIRING.md`, `docs/SUPABASE_CALLABLE_GAP.md`, `docs/SUPABASE_PLAN_SIGNIN.md`, `docs/SUPABASE_SIGNIN_OWNER_STEPS.md`, `docs/SUPABASE_REPORTS_SETUP.md`, `docs/SUPABASE_READINESS_SUBMIT_SETUP.md`, `docs/SUPABASE_PROVISION_AUTH.md`, `docs/SUPABASE_AI_SCORE_SETUP.md`, `docs/SUPABASE_STRIPE_SETUP.md`, `docs/SUPABASE_MIRROR_SWITCH_ON.md`, `assets/switchboard.js`, `assets/firebase.js`. The check command is `scripts/supabase-cutover-check.js` with tests in `tests/supabase-cutover-check.test.js`.
