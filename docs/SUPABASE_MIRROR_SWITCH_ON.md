# Switch the server side Supabase mirror on

Written 2026-10-08. For the owner. Nothing in this file has been done yet: no key exists, nothing is deployed, the patch is not applied.

## Summary

What this does: when you add, edit or move a member in the admin console, issue a credential, finish an Executive Signature assessment, pay through Stripe, change an organization and so on, the server saves it to Firestore as it does today and then also copies it to Supabase. Today those server side changes reach Firestore only, so Supabase falls behind.

Why it is safe for the live site:

- Firestore stays the system of record. The copy happens after the Firestore save succeeded. If the copy fails, the member sees nothing and the Firestore result is unchanged.
- The copy code never throws an error to the function that called it, and it waits at most 2.5 seconds (it does not wait for Supabase longer than that).
- With the switch off, or without the key, the copy code does nothing at all: it contacts nobody and writes no log line.
- Access to the site is still decided by Firestore, not by the Supabase copy.

What you need: about 45 minutes, a terminal in the repo folder, and access to the Supabase dashboard and the Firebase CLI (`firebase login` done).

The order matters. The key must exist in Firebase before the patch is applied and deployed. A function that names a secret which does not exist makes the whole deploy fail (nothing changes, but you must start again).

The steps:

1. Create a new Supabase secret key.
2. Store it as a Firebase secret.
3. Add the switch line to the private `.env` file.
4. Apply the prepared patch (18 functions get the key).
5. Deploy `admin-actions`.
6. Test with the test member (never your own account).
7. Watch the logs.
8. Catch up everything written while the mirror was off (the import).
9. Know how to switch it off again.

The prepared patch is saved outside the repo at `~/utl-backups/mirror-on.patch`.

## Before you start

1. Open a terminal in the repo folder:

   ```
   cd ~/dev/utl-supabase-core
   ```

2. The deploy sends whatever is in this folder, saved in git or not. Check that nothing unexpected is waiting:

   ```
   git status --short
   ```

   The list should be empty. If it shows files you did not expect (for example a new function another session is still writing), stop and ask Claude. Those files would be deployed too.

3. This deploy also ships server changes that were written after the last deploy and are not part of the mirror: the abuse limits on `recordReadinessCompletion` (per email 5 per hour and 10 per day, per address 30 per hour), the fix for `getMyOrganizationAccess` (it returned an error before), and the new member trigger. They were reviewed and tested, but they are new on the live site. If you want to ship them separately, tell Claude first.

4. Check that the private settings file is here (this prints only a number, not the content):

   ```
   grep -c '' functions-admin/.env
   ```

   It should print 1 or more. This file is private and never goes to git. The deploy reads it from the folder you run the command in.

5. Optional safety check in the Supabase SQL editor (project utl-core). It only reads. All five new tables should show `true` in both columns:

   ```sql
   select c.relname as table_name,
          has_table_privilege('service_role', c.oid, 'INSERT') as can_insert,
          has_table_privilege('service_role', c.oid, 'UPDATE') as can_update
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('identity_conflicts', 'organization_roster_drafts', 'organization_weekly_report_log',
                       'stripe_processed_sessions', 'service_requests')
   order by 1;
   ```

## Step 1. Create the Supabase key

1. Open the Supabase dashboard and choose the project utl-core.
2. Open Project Settings, then API Keys.
3. Under the new "secret keys" section choose "Create new secret key" (the button wording can differ a little).
4. Name it `server mirror`.
5. Copy the key. It starts with `sb_secret_`. Keep the page open until step 2 is finished.

The key can read and write every table. Treat it like a password: never paste it into chat, a file, an email or a note.

## Step 2. Store it as a Firebase secret

```
firebase functions:secrets:set SUPABASE_SERVICE_ROLE_KEY --project the-untaught-lessons
```

The terminal asks for the value. Paste the key (the paste is not shown) and press Return. Then check that the secret exists (this shows the name and version, not the value):

```
firebase functions:secrets:get SUPABASE_SERVICE_ROLE_KEY --project the-untaught-lessons
```

Do not use `secrets:access`: it prints the value on screen.

Then clear your clipboard (copy any other word) and close the Supabase page.

## Step 3. Add the switch line

This line is not part of the patch because `.env` files are private (git ignores them). Add it yourself:

```
printf '\nSUPABASE_MIRROR=on\n' >> functions-admin/.env
grep -c '^SUPABASE_MIRROR=on$' functions-admin/.env
```

The second command should print `1`. If it prints more than 1, the line was added twice; that is harmless.

Without this line, or without the key, the mirror stays off. That is why steps 2 and 3 on their own change nothing.

## Step 4. Apply the patch

```
git apply --check ~/utl-backups/mirror-on.patch
git apply ~/utl-backups/mirror-on.patch
git status --short
```

`git status` must list exactly three files:

- `functions-admin/index.js` (17 functions get the key)
- `functions-admin/supabase-mirror/member-trigger.js` (the member trigger gets the key)
- `functions-admin/supabase-mirror/secret.js` (new, declares the secret once)

Quick local check (nothing contacts the internet):

```
node tests/supabase-mirror-member-trigger.test.js
node tests/supabase-mirror-hooks-index.test.js
```

Both should end with a line saying the checks passed.

The 18 functions that receive `SUPABASE_SERVICE_ROLE_KEY`:

| Function | What triggers it |
|---|---|
| `mirrorAuthorizedMemberWrite` | Firestore trigger: any add or edit of a member document (this covers the admin console member screens) |
| `removeMember` | admin callable |
| `recordReadinessCompletion` | public Executive Signature result save |
| `resolveMyCustomerIdentity` | member callable |
| `changeMyCustomerEmail` | member callable |
| `grantCustomerEntitlement` | staff callable |
| `changeCustomerEntitlementStatus` | staff callable |
| `issueVerifiedCredential` | member callable |
| `repairMemberVerifiedCredential` | admin callable |
| `autoIssueVerifiedCredential` | Firestore trigger on finished exercises |
| `manageVerifiedCredential` | admin callable (rename, reissue, revoke) |
| `saveOrganizationDefinition` | admin callable |
| `saveOrganizationAccessMember` | admin callable |
| `submitOrganizationRosterDraft` | organization callable |
| `reviewOrganizationRosterDraft` | admin callable |
| `sendWeeklyOrganizationReports` | scheduled, Tuesdays 08:00 Manila time |
| `createCheckoutSession` | Stripe checkout start |
| `stripeWebhook` | Stripe payment confirmation |

The other 22 functions in the codebase do not call the mirror and get no key (read only functions, `runAdminAction`, the email senders, the sign in claim trigger, and so on).

## Step 5. Deploy

```
firebase deploy --only functions:admin-actions --project the-untaught-lessons
```

What to expect:

- A line "Loaded environment variables from .env".
- One new function (`mirrorAuthorizedMemberWrite`) and updates to the others.
- It takes about 5 to 10 minutes.
- If it says the secret does not exist: go back to step 2. Nothing was changed.
- If it complains about a permission for the new trigger ("Eventarc"): wait 2 minutes and run the same command again. This happens once when a new kind of trigger is created.
- If it asks whether to delete functions that are no longer in the code, answer No and tell Claude.

Do not push anything to GitHub yet.

## Step 6. Test with a harmless change

Use the test member `wenszu+utltest@gmail.com`. Never use your own account for tests.

1. In the Supabase SQL editor (project utl-core) run this read only query and write down the result (the notes value and updated_at):

   ```sql
   select e.notes, e.status, e.updated_at
   from public.enrollments e
   join public.people p on p.id = e.person_id
   where p.primary_email = 'wenszu+utltest@gmail.com'
     and e.program_id = 'tsa'
   order by e.updated_at desc
   limit 3;
   ```

   If it returns no row, that is fine too: the test then creates one.

2. Open the admin console, Members, find the test member and open Edit. Write down what the Notes field holds now. Change Notes to exactly `mirror test 1` and press Save changes.

3. Wait about 30 seconds and run the same query again. You should see:

   - `notes` is `mirror test 1`
   - `updated_at` is within the last minute

   That proves the whole chain: the admin save, the Firestore trigger, the secret, the switch, the network call and the Supabase write.

4. Put the old Notes value back in the admin console and save. Run the query once more and check that `notes` matches the old value.

If the row does not change after 2 minutes, go to step 7 (logs) before trying again. If you cannot fix it quickly, switch off (step 9). Nothing is lost: the catch up import in step 8 copies it later.

## Step 7. Watch the logs

On success the mirror writes nothing to the logs. An empty log is good. It writes one line only when something goes wrong, and that line never contains a name, an email, a key or a row. It looks like this:

```
supabase-mirror member write { table: 'enrollments', status: 401 }
```

Look at the last 300 lines for any mirror warning:

```
firebase functions:log --project the-untaught-lessons -n 300 | grep supabase-mirror
```

Or in the browser: https://console.cloud.google.com/logs/query?project=the-untaught-lessons and search for `supabase-mirror`.

What the lines mean:

| You see | Meaning | What to do |
|---|---|---|
| `status: 401` | the key is wrong, revoked or missing | check step 2; the site is not affected |
| `status: 403` or `404` | a table or permission is missing | tell Claude which table |
| `status: 409` | a row already exists under another id | harmless, send it to Claude once |
| `status: 400` or `422` | Supabase refused the data shape | send the label and table to Claude |
| `status: 500` and above | Supabase had trouble | wait, the catch up import repairs it |
| `error: 'timeout'` or `'network'` | Supabase was slow or unreachable | harmless if rare |
| `status: 'no-row'` | there was no row to update yet | the catch up import creates it |
| `error: 'step-failed'` | a mistake inside the copy code | tell Claude the label |

Check the logs again after one hour, after the first real member edit, after the first Stripe payment (if payments are on), and after the first Tuesday weekly report.

## Step 8. Catch up what was written while the mirror was off

Why: everything that happened on the server side since the last import (2026-10-07 09:42 UTC) is in Firestore only. The importer reads all of Firestore again and writes what is missing. It is safe to run again and again: row ids are fixed, so nothing is doubled.

Why now and not before: the mirror is on, so anything written after the switch is copied live, and the import covers everything before it. Run the import soon after step 6 and avoid doing admin work while it runs.

Use a second Supabase key for the import (name it `catch-up import`, create it the same way as in step 1) and delete it when you are done. That keeps the server key out of your terminal.

### 8a. Dry run (reads Firestore, writes nothing to Supabase)

```
node scripts/supabase-import.js --project the-untaught-lessons --save-snapshot ~/utl-backups --exclude-email wenszu+utltest@gmail.com --out ~/utl-backups/catchup-dry-run.json
```

No key is needed for this. It saves the Firestore read as a private file in `~/utl-backups` (outside the repo, readable by you only) and the report next to it. If it complains about Google credentials, run `gcloud auth application-default login` once and try again.

A good dry run prints, in this order:

- `Reading Firestore...`
- `Snapshot saved: ...firestore-snapshot-<date>.json`
- `Excluded 1 member(s) from the plan` (the test member is always left out: their Supabase rows were made by hand and would clash)
- the table "Source documents" and the table "Planned rows". These describe all of Firestore, not only the new part. Numbers should be close to last time (about 55 members and 55 users) or higher. A sharp drop is a reason to stop.
- `Warnings: <a few>. Exceptions: 0.` Last time it was 3 warnings and 0 exceptions. Any exception line starting with `skip` is a stop sign: send the output to Claude.
- `Dry run only. Nothing was written.`

### 8b. Apply

Only after the dry run looked good. Replace the file name with the one printed in 8a.

```
read -s "SUPABASE_SERVICE_ROLE_KEY?Paste the import key, then press Return: "
export SUPABASE_SERVICE_ROLE_KEY
node scripts/supabase-import.js --from-snapshot ~/utl-backups/firestore-snapshot-<date>.json --exclude-email wenszu+utltest@gmail.com --apply --out ~/utl-backups/catchup-apply.json
unset SUPABASE_SERVICE_ROLE_KEY
```

It asks you to type `APPLY`. A good result:

- one line per table, such as `  people: 57 written`, `  reward_ledger: 0 written, 1763 already there`. For tables that are updated in place, "written" means "sent", not "new". For history tables, "already there" is the normal answer.
- no `failed` text and no `Stopped at ...` line
- a final summary with `applied` and `skipped_existing` numbers and a run id

If it stops at a table, send the output to Claude. Running the same command again is safe.

Afterwards delete the `catch-up import` key in the Supabase dashboard (Project Settings, API Keys). Keep the snapshot file as a safety copy.

### Append only tables

Some Supabase tables refuse any change or delete once a row is written: `reward_ledger`, `audit_events`, `consent_events`, `stability_events`, assessment attempts and response parts, and the saved answers and attempts of the exercises. The import and the mirror only add missing rows there, and they recognise rows by id, by their natural key or by the Firestore path stored in the row. So a row the mirror already copied is skipped, not doubled.

What follows from that:

- A wrong row cannot be corrected by running the import again. That is why the dry run comes first and why you should never apply a snapshot nobody looked at.
- The only undo is `node scripts/supabase-import.js --rollback <run id>` (it asks you to type `ROLLBACK`). It removes rows created by that one import run. Rows written live by the mirror have no run id and are not covered by it.
- Tables updated in place (people, enrollments, credentials, settings) take the Firestore value, which is right while Firestore is the system of record. Do not rerun the import after any function has started to write to Supabase first without asking Claude.

### What the import cannot catch up

The importer has no reader for these Firestore collections, so changes made there while the mirror was off are only picked up from the switch on: organization members, roster drafts, organization access audit, weekly report log, platform staff, Stripe processed sessions, service requests, outbox events, duplicate candidates, customer email claims. If any of those changed since 2026-10-07, ask Claude whether a one time copy is needed.

## Step 9. Switch it off again

Fastest, takes seconds: in the Supabase dashboard (Project Settings, API Keys) delete the `server mirror` key. From that moment every copy attempt is refused with a 401 line in the logs. The site is not affected, Firestore keeps working, and the hooked functions carry on as before. This is the emergency stop.

Clean switch off, takes the time of one deploy (usually 3 to 8 minutes):

1. Remove the switch line:

   ```
   sed -i '' '/^SUPABASE_MIRROR=/d' functions-admin/.env
   ```

2. Redeploy:

   ```
   firebase deploy --only functions:admin-actions --project the-untaught-lessons
   ```

   With the line gone the mirror is off even though the key is still attached. This is enough.

3. To go back fully to the code before the switch on (optional): `git apply -R ~/utl-backups/mirror-on.patch` if the patch is not committed yet (otherwise ask Claude to revert the commit), then deploy again with the same command. Only after that deploy, and only if you want to remove the secret completely, run `firebase functions:secrets:destroy SUPABASE_SERVICE_ROLE_KEY --project the-untaught-lessons`. Never destroy it while a deployed function still names it.

4. Delete the `server mirror` key in Supabase.

Rows already copied stay in Supabase. When you switch on again, run step 8 once to repair the gap.

After a verified switch on, ask Claude to commit the patch so the repository matches what is deployed.

## What could go wrong, and the guards already in place

| Risk | Guard or answer |
|---|---|
| The deploy fails because the secret is missing | Nothing changes. Do step 2, then deploy again. |
| Supabase is down or refuses a write | The copy returns a failure, one warning line is logged, the Firestore result and the answer to the member are unchanged. The import repairs the gap later. |
| Supabase is slow | A hooked function waits at most 2.5 seconds for the copy (3 seconds for the weekly report, 8 seconds in the member trigger where nobody is waiting). The copy is a short capped wait, not fire and forget, because Cloud Functions may stop work after the reply. Each single request is also cut off after 8 seconds. |
| The copy code has a bug | Every hook is wrapped so an error becomes a failure result. It never throws into the function. |
| The copy writes wrong data | Access to the site is decided by Firestore, and the Supabase fallback is off (`ACCESS_FALLBACK_ENABLED = false`), so a wrong copy cannot let anyone in or lock anyone out. The copy only fills an empty sign in id, never replaces one, and never deletes anything. |
| The key leaks | It is only a Firebase secret, only 18 functions can read it, it appears in no file and no log. Delete it in Supabase and create a new one. |
| A log line shows personal data | Log lines hold a fixed label, a table name, a count or a status code. They never hold a row, an email, a name or a key. |
| A burst of member edits (bulk import, cohort rename) | The trigger runs once per member document. Each run is a handful of small requests. Expect warnings only if Supabase rate limits; the import repairs those. |
| Extra cost | One small request group per hooked action. Negligible. |

## What the mirror does not cover

- Anything written while the mirror was off. The import (step 8) covers most of it, but not the collections listed under "What the import cannot catch up".
- Deletes. Nothing in Supabase is ever deleted by the mirror. `removeMember` archives the person in Supabase. A document deleted from Firestore by any other route (for example straight from the browser or the Firebase console) is not mirrored.
- The Google Group sync codebase (`group-sync`). Retired and deleted 2026-10-08, see the decision below.
- Firebase Auth users and sign in. Those move in the sign in phase.
- The Aiko codebase and the Apps Script relay.
- Reads. The mirror only writes. Server functions still read Firestore.
- Writes on the `users` document made by `autoIssueVerifiedCredential` (exercise progress patch) and `repairMemberExerciseProgress`. The browser copy of exercise progress covers the learner side.
- Writes to `settings/payments` from the server. The admin console's own copy (the `admin_set_app_setting` path) handles settings.

## Does the mirror collide with the browser copy? (double writes)

Checked in the code on 2026-10-08. Short answer: no harmful collision, and the overlaps are safe because the keys match.

- Learning data (progress, drafts, submissions, attempts, rewards, engagement, stability events, TSA item attempts): the browser writes these. No server mirror hook touches these tables. No overlap.
- Member documents: the admin console writes them from the browser to Firestore only. The browser does not also copy them to Supabase (the admin copy code says so). The Firestore trigger is the only copier. Where a callable (the Stripe webhook) also writes a member document, both the webhook hook and the trigger copy it. Both send the same fields and the same fixed ids, so the second write changes nothing.
- Sign in bookkeeping (last login time, providers): the browser records these through `record_login`. The trigger ignores a document change that only touches those fields. If an admin edit happens to carry the stored login time, the same value is written again; a difference of a few seconds in `last_login_at` is possible and harmless.
- Cohorts: the browser's admin copy sends the row with the same fixed id (a name based id) that the mirror uses, and the mirror only ever inserts a placeholder cohort row with ignore duplicates. Whichever arrives first, there is one row, and the browser copy then fills in its details.
- Feedback switch per member: the browser copy writes `person_profiles.feedback_enabled`, and the trigger may write the same value from the member document. Same value, last write wins.
- History tables (`audit_events`, `consent_events`): inserted with ignore duplicates on a unique Firestore path column, so a repeat is skipped. The importer recognises mirrored rows through the same Firestore path stored inside the row, so import after mirror does not double them. (Import before mirror cannot happen for the same document: the mirror only sends documents written after the switch on.)
- Idempotency: all mirror writes use fixed ids (derived from the email or the Firestore document id), merge or ignore duplicates, and patch style updates that only touch the fields the document states. Running a hook twice gives the same rows.

One thing to watch, not a conflict: the importer overwrites in place tables with the Firestore value. That is correct today because Firestore is the system of record, and it would be wrong for any data that later becomes Supabase first.

## Decision: the Google Group sync codebase (`group-sync`)

RESOLVED 2026-10-08: the owner retired the Google Group sync completely. The `functions/` folder, its mirror hooks and its test are deleted, so there is nothing to switch on there and the notes below are kept for history only.

Original recommendation: leave it out of this switch on.

- The member trigger already copies the Google Group state of each member (the `googleGroup...` fields and the added flag), because those fields change the member document and the trigger does not ignore them. The Supabase copy of "is this member in the group" is therefore already covered.
- The only extra the group sync mirror adds is one history row per sync job. The import already creates that row for every job, with the same Firestore path, so the two do not double.
- That codebase runs the live Google Group membership sync. Deploying it needs its own settings (the Workspace admin email setting has no default and there is no `functions/.env` in this folder, so the deploy would ask for it) and carries a small risk of disturbing a working system for a very small gain.
- Revisit when the admin console moves the Google Group queue to Supabase.

(No longer possible without restoring the deleted folder from git history.) If you had decided to do it later: add `SUPABASE_SERVICE_ROLE_KEY` as a secret to `processGoogleGroupSyncJob` in `functions/index.js`, add `SUPABASE_MIRROR=on` to a private `functions/.env`, deploy with `firebase deploy --only functions:group-sync`. The same Firebase secret is reused.

## Open questions for the owner

1. Are you ready to ship the other pending server changes in the same deploy (the readiness abuse limits and the organization access fix)?
2. Do you want a one time copy of the collections the importer cannot read (organization members, roster drafts, platform staff and the others listed in step 8)?
3. The Node 20 to Node 22 upgrade is a separate prepared patch (`~/utl-backups/node22-upgrade.patch`) and must be deployed before 2026-10-30. Both patches apply together without a conflict, but deploy them as two separate deploys so a problem points to one cause.
