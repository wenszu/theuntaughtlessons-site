# Firebase to Supabase migration plan

Owner: Claude Code (desktop session) in the `supabase-core` worktree. Shared note: `docs/SUPABASE_BUILD_HANDOFF.md`. Written 2026-10-06.

This plan moves every record and, at the end, sign-in itself from Firebase to the Supabase project `utl-core`. It is written so that at every step the site keeps working for AyalaLand and every other member, and so that every step can be undone.

## 1. Where we stand

| Area | State on 2026-10-06 |
|---|---|
| Supabase project `utl-core` | Exists. Free plan. Migrations 0100 to 1000 applied. No data |
| TSA learning schema (1100) | Written and tested locally (59 of 59 checks). Not applied |
| Firebase Auth | 61 users. All carry `role` = `authenticated`. Supabase accepts their tokens (end-to-end check passed) |
| `setRoleClaimOnUserCreated` | Written, not deployed. New sign-ups get no claim until it is |
| `supabase-core` branch | Merged with `main` (`2070e33`), one conflict resolved by hand, merge not yet committed |
| Firestore | Live and the only data store. Document counts unknown until the inventory runs |
| Site | GitHub Pages serves `main`. Firebase Functions in three codebases. Stripe scaffolding on `main` |

### Numbers we know

- 61 Firebase Auth users. 54 match the 55 `authorized_members`. 7 Auth users have no member record. 1 member has no Auth user.
- Sign-in methods among the 7 unmatched: 5 Google, 2 password or email link.
- 55 members in the 2026-10-04 production baseline.
- 36 top-level Firestore collections named in rules or server code, 8 per-user subcollections, 4 other subcollections.

### Numbers we need

`scripts/supabase-firestore-inventory.js` reports document counts and field names per collection, with no values. It needs to run once before the import is written, and once more right before cutover. Run it from the worktree:

```
FIREBASE_ADMIN_MODULE_DIR="<main folder>/functions-admin/node_modules/firebase-admin" node scripts/supabase-firestore-inventory.js --project the-untaught-lessons --out /tmp/firestore-inventory.json
```

## 2. The shape of the move

Four stages, each one reversible on its own:

1. **Prepare.** Apply the schema, deploy the claim trigger, build the import tool, build the server write path.
2. **Copy.** Import all data into Supabase while Firestore stays live. Rerun until the counts match.
3. **Switch.** Point the site at Supabase one surface at a time behind a flag, with Firestore still written in parallel. Then stop writing to Firestore.
4. **Move sign-in.** Replace Firebase Auth with Supabase Auth, with both token types accepted during the overlap.

Members notice nothing in stages 1 and 2. In stage 3 they may notice a short reload. In stage 4 Google users sign in again once; password users set a new password once.

## 3. Steps

Each step says what it changes, how we know it worked, and how to undo it. "Decision" marks a point where Wen-Szu chooses before work continues.

### Stage 1: Prepare

**1.1 Commit the merge and deploy the claim trigger**
- Commit the `main` merge on `supabase-core`. Deploy only `setRoleClaimOnUserCreated` with `firebase deploy --only functions:admin-actions:setRoleClaimOnUserCreated`.
- Check: `firebase functions:list` shows it. Create a throwaway test account on localhost, run `--verify` for it, then delete the account.
- Undo: `firebase functions:delete setRoleClaimOnUserCreated`. Existing claims stay.

**1.2 Run the Firestore inventory**
- Read-only. Produces counts and field names. Record the summary table in the handoff note.
- Check: every collection in the inventory list reports a count, and `unlistedTopLevel` is empty or explained.

**1.3 Apply migration 1100 to `utl-core`**
- Through the Supabase MCP `apply_migration`, then run the security and performance advisors and fix anything flagged in a 1200 migration.
- Check: `list_migrations` shows 11. Local test page still passes 4 of 4.
- Undo: a down migration that drops the 1100 tables. Nothing depends on them yet.

**1.4 Seed the activity catalog**
- A script reads `exerciseProgressIds` and the exercise content in site code and writes `activities` and `activity_keys`. The catalog is checked into the repo as `supabase/seed/activities.json` so it is reviewable.
- Check: every key in `exerciseProgressIds` resolves to one activity. Every exercise id seen in the inventory has a key.
- Decision: titles and `module_key` values for exercises that only exist in Firestore and not in current site code.

**1.5 Build the server write path**
- Learners write from the browser today. Supabase tables accept no browser writes. The replacement is a set of Postgres functions (`security definer`, validated, using `private.current_person_id()`) called through the REST `rpc` endpoint with the Firebase token: `record_activity_submission`, `save_activity_draft`, `record_activity_attempt`, `record_learning_evidence`, `record_engagement`, `record_stability_event`, `update_my_profile`. They do the validation the Firestore rules do today, and they update `activity_progress` and `reward_ledger` in the same transaction.
- Admin writes (members, cohorts, settings, access decisions) go through the existing `admin-actions` Firebase Functions, extended to write to Supabase with the service role. They already run as trusted server code.
- Check: a new test file in `supabase/schema-test.mjs` calls each function as a learner and confirms the rows, the rejected inputs and the progress and reward side effects.
- Undo: functions are additive. Dropping them removes the write path.

**1.6 Build the import tool**
- `scripts/supabase-import.js`: Firebase Admin SDK read, Supabase service role write. Dry run by default. Every run writes a `migration_runs` row and one `migration_records` row per document with checksums. Reruns skip rows whose `legacy_firestore_id` already exists.
- Mapping, in dependency order: `authorized_members` and `users` into `people`, `person_emails`, `person_profiles`, `enrollments` (tsa), `role_grants`; `settings/cohorts` into `cohorts`; `organizations` into `organizations` and `role_grants`; `customers`, `customerAuthLinks`, `customerEmailClaims` merged into the same `people` rows by email; `entitlements`, `enrollments`, `assessmentAttempts`, `responseParts`, `consentEvents`, `auditEvents` into their core tables; the learner collections into the 1100 tables; `assessment_item_attempts` into `assessment_attempts` with definitions `tsa-diagnostic` and `tsa-checkpoint`; `settings/*` into `app_settings`; `access_requests`, `public_credentials`, `credential_issuance` into their tables (the last two need a small 1200 migration).
- Decision: AyalaLand entitlements get `valid_until` one year from import date (recorded decision). The 7 unmatched Auth users become `people` rows with no enrollment unless a Firestore record claims them.
- Decision: rewards are imported as ledger entries from each user's `rewards.ledger`, and the `mpTotal` is compared against the sum. Where they differ the difference is logged, not invented.
- Check: dry run report compares source count to planned rows per table, lists every exception, and prints the totals Wen-Szu approves.

**1.7 Upgrade `utl-core` to Pro**
- Needed before any real record is imported, for daily backups and so the project never pauses. Decision on the date.

### Stage 2: Copy

**2.1 Import dry run, review, apply**
- Dry run, review the report, then `--apply` with typed confirmation. Expect one `migration_runs` row with status `completed`.
- Check: row counts per table equal the dry run plan. Reconciliation query: every `people` row has a `person_emails` row, every submission has a progress row, every completed enrollment has a completion date.
- Undo: `--rollback <run id>` deletes every row created by that run, using `migration_records`. The tables return to empty.

**2.2 Shadow comparison**
- A read-only script loads one member's data from both stores and prints differences by field (no values). Run for ten members including the owner, one AyalaLand member, and one of the 7 unmatched users.
- Check: zero differences, or each difference explained in the handoff note.

**2.3 Delta reruns**
- Firestore keeps changing while the site uses it. Re-import weekly during stage 3. Reruns only add new or changed documents.

### Stage 3: Switch

**3.1 Dual writes**
- The client writes each learner action to Firestore (as today) and to the Supabase function. Supabase failures are logged, never shown. Admin functions write to both.
- Check: after a week, the delta rerun finds nothing to add, which means the dual write is complete.
- Undo: remove the Supabase call. Nothing read from Supabase yet.

**3.2 Read cutover, one surface at a time**
- Flag per surface in `app_settings.public_site.dataSource`. Order: public settings; member workspace progress and rewards; exercise drafts and history; learning profile; admin console member list; admin analytics; Executive Signature app; organization console.
- Each surface: switch for the owner account first, then everyone. Watch stability events and support mail for two days before the next surface.
- Undo: flip the flag back. Firestore is still written, so nothing is lost.

**3.3 Stop writing to Firestore**
- When every surface reads from Supabase, remove the Firestore writes. Set Firestore rules to deny all client writes. Keep server reads for one more delta run, then stop.
- Export Firestore to a Cloud Storage bucket as the frozen archive. Record the export path and checksum in the handoff note.
- Undo: Firestore still holds everything up to this moment. Reverting the client restores it as the live store, with the rows written to Supabase since then re-imported by hand.

**3.4 Retire Firebase Functions that only touched Firestore**
- Keep `admin-actions` while it serves admin writes. Decide later whether to move those to Supabase Edge Functions; that is a code move, not a data move.

### Stage 4: Move sign-in

Supabase can trust Firebase tokens and its own tokens at the same time, which is what makes this stage safe.

**4.1 Decide whether to move sign-in at all (decision)**
- Keeping Firebase Auth as a third-party provider is a supported long-term setup. Moving removes one vendor, the claim trigger and the Firebase client library. It costs each member one re-sign-in.
- Recommendation: move, but only after stage 3 is stable for a month.

**4.2 Create Supabase Auth users**
- Script creates one Supabase Auth user per Firebase user with the same email, marks the email confirmed when Firebase says so, and sets `people.supabase_uid` (new column, 1200 migration). `people.auth_uid` keeps the Firebase uid. `private.current_person_id()` matches either.
- Google users: enable the Google provider in Supabase with the same OAuth client. On first Supabase sign-in the identity links by verified email.
- Password users: Firebase stores scrypt hashes that Supabase cannot import. Each password user gets a one-time "set your password" email on their first visit after the switch. Email-link users get Supabase magic links, which behave the same.
- Check: `auth.users` count equals Firebase user count. Every `people` row with an `auth_uid` has a `supabase_uid`.

**4.3 Switch the client sign-in**
- Replace Firebase sign-in calls with Supabase Auth in `assets/firebase.js` (renamed) and the admin console. Deploy for the owner account first.
- Both token types stay accepted for 30 days. Members who still hold a Firebase session keep working until it expires.

**4.4 Turn off Firebase Auth acceptance**
- Remove the third-party provider in Supabase. Delete `setRoleClaimOnUserCreated`. Export the Firebase Auth user list as the archive. Firebase project stays, paused, for 90 days, then is deleted.

## 4. Risks

| Risk | Where | Likelihood | Effect | What we do about it |
|---|---|---|---|---|
| AyalaLand member cannot sign in during the move | Stage 4 | Low | High | Both token types accepted for 30 days. Owner and one AyalaLand volunteer test first. Firebase sign-in stays available until 4.4 |
| Password users locked out | 4.2 | Medium | Medium | Set-password email on first visit, plus a support path. Count them first: the inventory says how many use `password` |
| Import maps a record to the wrong person | 1.6 | Medium | High | Join on normalized email and uid both. Unmatched records go to `duplicate_candidates`, never guessed. Shadow comparison on ten members |
| Rewards totals change after import | 1.6 | Medium | Low | Import the ledger, compare to stored total, log differences. Members see the ledger sum. Owner reviews any member whose total drops |
| Exercise payloads lose fields | 1.6 | Low | Medium | Payloads are copied whole into `jsonb`. Checksums in `migration_records` prove it |
| Data written to Firestore after the final import | 3.3 | Medium | Medium | Dual writes make the final delta small. Firestore rules deny client writes at the moment of the switch |
| Browser write path has a validation gap | 1.5 | Medium | Medium | Every function has tests mirroring the Firestore rules. Advisors run after each migration |
| Supabase Free project pauses | Before 1.7 | High over weeks | Medium | Upgrade to Pro before the first real import |
| Admin console reads two stores at once and disagrees | 3.2 | Medium | Low | Flags switch whole surfaces. No surface mixes stores |
| Stripe webhook grants access in Firestore only | 3.1 | Medium | Medium | `payments-service.js` gets the Supabase dual write in stage 3.1 before anyone pays |
| Deploying functions from this worktree ships unmerged code | Any deploy | Low now | High | `main` is merged into this branch. Deploy only after committing and comparing with `origin/main` |
| Loss of the Firestore archive | 3.3 | Low | High | Export to Cloud Storage with a checksum, plus a local copy outside the repo |

## 5. Effort

Working sessions, each a few hours. These are estimates for planning, not promises.

| Stage | Sessions | Waiting time |
|---|---|---|
| 1 Prepare | 6 to 8 | Pro upgrade decision |
| 2 Copy | 2 to 3 | Dry run approval |
| 3 Switch | 5 to 7 | Two days per surface, about three weeks of elapsed time |
| 4 Sign-in | 3 to 4 | 30-day overlap |

## 6. Decisions needed now

1. Commit the `main` merge on `supabase-core` (I cannot commit without your say).
2. Run the Firestore inventory (the command in section 1; the permission layer blocks me from reading production).
3. Date for the Pro upgrade.
4. Confirm the order of surfaces in 3.2, or change it.
5. Confirm stage 4 is wanted, and whether the 30-day overlap is long enough for AyalaLand.
