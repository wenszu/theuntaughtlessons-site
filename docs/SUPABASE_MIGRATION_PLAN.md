# Firebase to Supabase migration plan

Owner: Claude Code (desktop session) in the `supabase-core` worktree. Shared note: `docs/SUPABASE_BUILD_HANDOFF.md`. Written 2026-10-06, shortened the same day at Wen-Szu's request.

Goal: every record and, at the end, sign-in itself moves from Firebase to the Supabase project `utl-core`, fast, with Firebase kept as the backup. The site is small (54 users, about 5,300 documents, most members inactive), so there are no waiting periods in this plan. Each step is a working session, and the steps run back to back.

## 1. Where we stand

| Area | State on 2026-10-06 |
|---|---|
| Supabase project `utl-core` | Exists. Free plan. Migrations 0100 to 1500 applied. Firestore data imported 2026-10-06 (run `c431b8db`, 8,671 rows, verified) |
| Schema (1100 to 1500) | Applied to `utl-core` on 2026-10-06. 15 migrations. 75 of 75 local checks |
| Firebase Auth | 61 users. All carry `role` = `authenticated`. Supabase accepts their tokens (end-to-end check passed) |
| `setRoleClaimOnUserCreated` | Deployed 2026-10-06 (v1, us-east1). New sign-ups get the claim |
| `supabase-core` branch | Merged with `main`. Last commit `5ee6f8a`; the import fixes, migration 1500 and the new tests are not committed |
| Firestore | Live and the only data store. About 5,300 documents across 47 paths (inventory below) |
| Site | GitHub Pages serves `main`. Firebase Functions in three codebases. Stripe scaffolding on `main` |

### Numbers

- 61 Firebase Auth users. 54 match the 55 `authorized_members`. 7 Auth users have no member record. 1 member has no Auth user.
- Sign-in methods among the 7 unmatched: 5 Google, 2 password or email link.
- Where the code talks to Firestore: `assets/firebase.js` (131 exports, used by the member site and the admin console), 6 direct calls in `admin/index.html`, 2 in the Executive Signature results page, and 34 callables in `functions-admin/index.js` that write server side.

### Production inventory (2026-10-06, counts and field names only)

Run by Wen-Szu with `scripts/supabase-firestore-inventory.js`. 47 collection paths read, none unlisted.

| Firestore path | Docs | Parents with docs | Target table |
|---|---|---|---|
| `users/*/analytics_activity_sessions` | 2,784 | 37 of 54 | `engagement_sessions` (kind activity) |
| `users/*/stability_events` | 755 | 34 | `stability_events` |
| `users/*/completed_exercises` | 469 | 45 | `activity_submissions` and `activity_progress` |
| `users/*/analytics_sessions` | 375 | 37 | `engagement_sessions` (kind session) |
| `users/*/exercise_submissions` | 184 | 30 | `activity_submissions` |
| `users/*/exercise_work` | 97 | 24 | `activity_drafts` |
| `authorized_members` | 55 | | `people`, `person_profiles`, `enrollments`, `role_grants` |
| `customers`, `customerEmailClaims` | 55 each | | `people`, `person_emails` (same rows) |
| `users` | 54 | | `people`, `person_profiles`, `activity_progress`, `reward_ledger`, `reward_state` |
| `customerAuthLinks` | 54 | | `people.auth_uid` |
| `enrollments` | 53 | | `enrollments` |
| `google_group_sync_jobs` | 48 | | `audit_events` (archive, feature is disabled) |
| `auditEvents` | 34 | | `audit_events` |
| `users/*/exercise_attempts` | 33 | 25 | `activity_attempts` |
| `assessment_item_attempts` | 21 | | `assessment_attempts` and `assessment_response_parts` |
| `support_preview_audit` | 21 | | `audit_events` |
| `public_credentials` 16, `credential_issuance` 15 | | | `credentials` |
| `settings` | 8 | | `app_settings`, `cohorts` (three cohort entries) |
| `consentEvents` 4, `serviceRequests` 4, `outboxEvents` 2, `migrationRuns` 1 (+55 records) | | | core tables |
| `organizations` 2, `assessmentAttempts` 2 (+2 response parts), `assessmentDefinitions` 1, `assessmentVersions` 1, `entitlements` 1, `platformFeatureFlags` 2 | | | core tables |
| 15 empty collections | 0 | | shape from code only |

What the inventory changed in the design (migration 1200): lessons, contexts and orientation became activity kinds; `reward_state` holds streaks and tokens; `enrollments.notes` and `enrollments.source` hold the member notes and invitation metadata; `public_credentials` and `credential_issuance` merged into `credentials` with a public verify function; `people.supabase_uid` added so the sign-in move needs no schema change.

## 2. The plan in one view

| Step | What happens | Members notice | Undo |
|---|---|---|---|
| A. Today: schema and backup | Deploy claim trigger, apply 1100 and 1200, export Firestore to Cloud Storage, upgrade to Pro | Nothing | Drop the new tables |
| B. Today or next session: copy | Import tool, dry run, apply. Supabase holds everything | Nothing | Rollback by run id |
| C. Build the switch | Postgres write functions, rewrite the data layer in `assets/firebase.js`, point the 6 admin calls and the ES results page at Supabase. Sign-in stays on Firebase | Nothing (not deployed) | Nothing to undo |
| D. Test and flip the site | Test with you plus 2 or 3 members on a preview. Then: deny Firestore client writes, re-import once, merge to `main`. One hour of writes frozen, sign-in never interrupted | A reload. Drafts saved during the hour are kept (re-import) | Re-enable Firestore writes, revert `main` |
| E. Move the server callables | The 34 `functions-admin` callables write Supabase with the service role. Stripe grants an entitlement in Supabase | Nothing | Redeploy previous functions |
| F. Move sign-in | Create Supabase Auth users, Google via the same OAuth client, password users set a new password once, both token types accepted for one week | Google users sign in again once, password users set a password once | Keep Firebase sign-in on until everyone is through |
| G. Close | Firestore read-only archive, Firebase project paused 90 days then deleted | Nothing | Archive stays |

Build effort: about 8 to 10 working sessions in all. A and B fit in one day. D can happen the same day C is finished. Between D and E the customer platform (Executive Signature, 2 attempts, 1 entitlement) still writes Firestore for a few days; that is accepted because its volume is near zero and its reads are server side.

## 3. Steps in detail

### A. Schema and backup (today)

1. Done. `setRoleClaimOnUserCreated` deployed alone and listed.
2. Done. 1100, 1200 and 1300 (advisor fixes) applied; 13 migrations.
3. Done. Firestore exported to `gs://the-untaught-lessons-firestore-backups/2026-10-06` (bucket in `asia-east1`, same as the database). This is the backup, taken before any data was copied.
4. Upgrade `utl-core` to Pro so backups run from the first import. Pending.

### B. Copy

1. Done. `scripts/supabase-import.js`: Firebase Admin read, Supabase service role write (REST, key from `SUPABASE_SERVICE_ROLE_KEY`), dry run by default, `--apply` with typed APPLY, `--rollback <run id>` with typed ROLLBACK. Every apply writes `migration_runs` and one `migration_records` row per document with checksums. Ids are deterministic (uuid v5 of the Firestore key), so reruns upsert; append-only tables skip existing rows. The mapping is `scripts/supabase-import-mapping.js`, tested in `tests/supabase-import-mapping.test.js`. The catalog comes from `scripts/supabase-build-activity-catalog.js` into `supabase/seed/activities.json`.
2. Mapping, in dependency order: members and users into `people`, `person_emails`, `person_profiles`, `enrollments` (tsa, status and `valid_until` from `status` and `expiryDate`; AyalaLand gets one year from import date), `role_grants` (`admin` and `owner` become `platform_owner`); `settings/cohorts` into `cohorts`; `customers`, `customerAuthLinks`, `customerEmailClaims` merged into the same `people` rows by email; the customer platform collections into their core tables; `workspaceProgress`, `completed_exercises`, `exercise_submissions`, `exercise_attempts`, `exercise_work` into the activity tables (the catalog is seeded first from `exerciseProgressIds` and `member-login/content-config.js`); `rewards` into `reward_ledger` and `reward_state`; analytics and stability events; `assessment_item_attempts` into `assessment_attempts`; `settings/*` into `app_settings`; credentials; audits into `audit_events`.
3. Dry run, Wen-Szu reads the counts, apply. Check: counts per table match the plan; every submission has a progress row; reward ledger sums are compared with stored `mpTotal` and differences listed.
4. Shadow comparison for three members (owner, one AyalaLand member, one of the 7 unmatched): field by field, no values printed.

### C. Build the switch

1. Postgres functions for learner writes, called through REST `rpc` with the Firebase token: `record_activity_submission`, `save_activity_draft`, `record_activity_attempt`, `record_learning_evidence`, `record_engagement`, `record_stability_event`, `update_my_profile`, `save_workspace_progress`. Each validates like the Firestore rules do and updates `activity_progress`, `reward_ledger` and `reward_state` in the same transaction. Tests added to `schema-test.mjs`.
2. Admin writes (members, cohorts, settings, access decisions, progress repair) move from direct Firestore calls into `functions-admin` callables that use the service role. Most already exist as callables; the rest are added.
3. Rewrite the data functions in `assets/firebase.js` to call Supabase. Sign-in functions stay on Firebase. The file keeps its exports so no page changes. Point the 6 direct calls in `admin/index.html` and the 2 in the ES results page at the same layer.

### D. Test and flip

1. Serve the branch locally and from a preview. Wen-Szu signs in, completes an exercise, saves a draft, checks rewards and the admin console. Two or three members do the same on the preview.
2. Flip: set Firestore rules to deny client writes (sign-in unaffected), run the import once more for the delta, merge `supabase-core` into `main`, push. GitHub Pages publishes within minutes.
3. Watch `stability_events` and support mail for the rest of the day. Undo is one revert of `main` plus re-enabling Firestore writes.

### E. Server callables

1. Add `@supabase/supabase-js` to `functions-admin` with the service role key in a Firebase secret. Rewrite `customer-program-service.js`, `assessment-persistence-service.js` and `payments-service.js` to write Supabase. Deploy `admin-actions`.
2. Check: create a test entitlement through the admin console, run one ES attempt on the preview, confirm rows in Supabase.

### F. Sign-in

1. Script creates one Supabase Auth user per Firebase user, email confirmed where Firebase says so, `people.supabase_uid` set. Enable Google in Supabase with the same OAuth client.
2. Replace Firebase sign-in in `assets/firebase.js` and the admin console with Supabase Auth. Password and email-link users get a set-password or magic link on first visit. Deploy.
3. Both token types accepted for one week, then the Firebase provider is removed from Supabase and the claim trigger deleted.

### G. Close

Firestore rules deny everything. Firebase Auth export saved beside the Firestore export. Firebase project paused for 90 days, then deleted.

## 4. Risks

| Risk | Step | What we do |
|---|---|---|
| A member cannot sign in during the move | D, F | Sign-in stays on Firebase until F. In F both token types work for a week. Owner and one AyalaLand member test first |
| Password users locked out | F | Set-password email on first visit. The inventory says 2 of the 7 unmatched use password; the import counts the rest |
| Record mapped to the wrong person | B | Join on normalized email and uid both. Unmatched records go to `duplicate_candidates`, never guessed. Shadow comparison on three members |
| Reward totals change | B | Ledger imported, sum compared with `mpTotal`, differences listed for review |
| Writes land in Firestore after the final import | D | Client writes denied by rules one hour before the flip; one last import |
| Write function has a validation gap | C | Tests mirror the Firestore rules. Advisors run after each migration |
| Free project pauses | A | Pro before the first import |
| Stripe grants access in Firestore only | E | Payments is not open yet; E lands before it opens |
| Deploying from this worktree ships stale code | any deploy | `main` is merged in; compare with `origin/main` before each deploy |
| Losing the archive | A, G | Cloud Storage export with checksum plus a local copy outside the repo |

## 5. Decisions needed now

1. Commit the 1200 migration, tests and this plan on `supabase-core`.
2. Go for step A (deploy the trigger, apply 1100 and 1200, Firestore export, Pro upgrade).
3. Which 2 or 3 members test in step D.
