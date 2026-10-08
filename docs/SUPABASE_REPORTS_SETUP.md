# Weekly reports, result emails and certificates on Supabase: owner steps

Built for waves 8 and 9 of `docs/SUPABASE_PLAN_SERVERS_AND_ADMIN.md`. Nothing here is switched on yet. Everything below is in the order to do it. The code is in `supabase/migrations/20261008002320_credentials_reports.sql`, `supabase/functions/weekly-org-reports/`, `supabase/functions/result-emails/` and `assets/result-email-client.js`.

## 1. Secrets (Supabase dashboard, Edge Functions, Secrets)

| Secret | Used by | What it is |
|---|---|---|
| `CRON_SECRET` | weekly-org-reports | New. A long random value: `openssl rand -hex 32`. The timer sends it in a header. If it is not set, the function refuses every call. |
| `MAIL_RELAY_SECRET` | weekly-org-reports, result-emails (and send-email) | Already exists for send-email. Same value everywhere. |
| `WEEKLY_REPORT_RECIPIENT_OVERRIDE` | weekly-org-reports | Optional. Your own address, only for the first live Tuesday (step 5). Delete it afterwards. |
| `SEND_EMAIL_URL` | both | Optional. Only if send-email is not at `<project>/functions/v1/send-email`. Leave unset. |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are put in by the platform. The service role key is used only to call database functions that no browser can run (the report list, the log row, the send limits).

## 2. Apply and deploy (Claude does these when you say so, after the database change is reviewed)

1. Apply `20261008002320_credentials_reports.sql`. Undo file: `supabase/rollbacks/20261008002320_credentials_reports_down.sql`.
2. Deploy both functions with the gateway token check off (the weekly one is called by the timer, the result one may be called by a visitor who just finished the test; both do their own check):

```
supabase functions deploy weekly-org-reports --no-verify-jwt --project-ref czljyikfavtjgqcibdda
supabase functions deploy result-emails --no-verify-jwt --project-ref czljyikfavtjgqcibdda
```

## 3. Look before sending anything (dry run)

From your computer (replace the value):

```
curl -s -X POST https://czljyikfavtjgqcibdda.supabase.co/functions/v1/weekly-org-reports \
  -H "x-utl-cron-secret: <CRON_SECRET>" -H "Content-Type: application/json" -d '{"dry_run": true}'
```

It returns, for every organization that is opted in, active and has a contact email, the subject and the text that would be sent. Nothing is sent and nothing is recorded. Compare the numbers with what the organization console shows for the same organization. They are the same rules as the Firebase timer.

## 4. The timer (pg_cron). Not in a migration, because it needs the secret

In the dashboard, Database, Extensions: switch on `pg_cron` and `pg_net` (the menu names may differ). Then, in the SQL editor, once:

```sql
-- keep the secret in the vault, not in the schedule text. Use the same value as CRON_SECRET.
select vault.create_secret('<the same value as CRON_SECRET>', 'utl_cron_secret');

-- Tuesday 00:00 UTC, the same moment as the Firebase timer (08:00 Manila).
select cron.schedule(
  'weekly-org-reports',
  '0 0 * * 2',
  $job$
  select net.http_post(
    url := 'https://czljyikfavtjgqcibdda.supabase.co/functions/v1/weekly-org-reports',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-utl-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'utl_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);
```

To look at it later: `select * from cron.job_run_details order by start_time desc limit 5;`. To stop it: `select cron.unschedule('weekly-org-reports');`.

## 5. The switch (one timer only, never both in the same week)

**Only one scheduler may run in any week.** The Firebase timer and the pg_cron job must never both be live for the same week.

The week key (`2026-W41`) is the same in both systems, but a report sent by one is not seen by the other unless the Firebase mirror is on. So exactly one timer is real in a given week.

1. First Tuesday on Supabase: set `WEEKLY_REPORT_RECIPIENT_OVERRIDE` to your own address. Keep the Firebase timer on. Supabase sends every report to you with `[TEST]` in the subject and writes no log row, so the real send is not blocked. Check your inbox against the Firebase copies that went to the organizations.
2. When the copies match: pause the Firebase timer (Google Cloud console, Cloud Scheduler, the job for `sendWeeklyOrganizationReports`, Pause). Do not delete the Firebase function yet.
3. Delete the override secret. From the next Tuesday Supabase sends the real reports and writes the log row.
4. After two good Tuesdays, Claude removes the Firebase function.

Rollback: `select cron.unschedule('weekly-org-reports');` and resume the Firebase job.

Differences from the Firebase timer, on purpose:
* A week whose send failed is not blocked: a later run in the same week tries that organization again. A week that was sent is never sent twice.
* The log row records only a fixed word on failure (`provider`, `timeout`, ...), not the provider text.
* There is no minimum group size, as in Firebase (that rule belongs to the cohort standing a learner sees). If you want a floor of 5 for these emails, say so; it is a small change in `private.weekly_org_aggregate`.

## 6. The two result emails

Both are behind a browser switch, default Firebase. The pages are not changed yet. To try one browser: `localStorage.setItem('utl_mail', 'supabase')` in the page console on the live site; go back with `localStorage.removeItem('utl_mail')`.

The page edits (two lines each, made only when you decide to):

* `apps/executive-signature/index.html` line 2163: change `'../../assets/firebase.js'` to `'../../assets/result-email-client.js'`.
* `my-results/index.html` line 2154: change `import('../assets/firebase.js')` to `import('../assets/result-email-client.js')` (the call below it, `fb.sendMyResultsEmail(...)`, stays as it is).
* `apps/executive-signature/my-results/index.html` line 167: remove `sendReadinessResultEmail` from the long import list from `assets/firebase.js`, and add one line next to it: `import { sendReadinessResultEmail } from '../../../assets/result-email-client.js';`.

The sender of "Email my results" is the person's primary email in the database, and the token must carry that same address as verified: for a Firebase token the signed `email_verified` claim, for a Supabase Auth token the account record (`auth.users.email_confirmed_at`, read by a service role only function), never `user_metadata`. For "Email me this result", a token that proves no verified address is treated as anonymous (allowed only within an hour of the test); a rejected token or a malformed Authorization header is refused. The same rule applies to `issue_my_credential()`.

## 7. Certificates: the switch moment

The automatic issue trigger is created and switched OFF. Keep it disabled during imports and backfills (bulk loads of `activity_progress`): switch it on only afterwards, then run `private.issue_missing_credentials()` once to catch up. The migration can be applied again safely; it never switches an enabled trigger back off. Do not switch it on while the Firebase trigger `autoIssueVerifiedCredential` is still deployed: each picks its own random certificate id, so one person could get two.

1. Before the switch, look at what would happen (SQL editor, as the owner):
   `select * from private.credential_shadow_report();`
   `missing` lines are members with all 16 exercises, an active enrollment and no certificate. `unexpected` lines hold a certificate without all 16 exercises in the database (usually an import gap, worth a look).
2. Take the credentials export, then remove the Firebase trigger (`firebase functions:delete autoIssueVerifiedCredential`, or deploy without it).
3. Straight away: `alter table public.activity_progress enable trigger credential_auto_issue;`
4. Then catch up anyone who finished in between: `select private.issue_missing_credentials();` (it prints how many it made; running it again makes none).
5. Rollback: `alter table public.activity_progress disable trigger credential_auto_issue;` and redeploy the Firebase trigger. Certificates made by Supabase in between exist only in Supabase; replay them into Firestore with the replay back script.

Certificates can be switched off for both systems in the admin console (engagement settings, certificate, enabled off). The member button (`public.issue_my_credential()`) is not wired into a page yet; `certificate/index.html` and `my-results/index.html` still call the Firebase `issueVerifiedCredential`.
