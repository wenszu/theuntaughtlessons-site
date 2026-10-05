# Supabase build handoff

This file is the shared note between two Claude sessions. Claude Code in VS Code owns the repo. The Claude web session owns the schema design and reviews. Read this file first, then update the status log at the bottom after every step.

## Where things live

- **Drive source:** `04 Website design / utl-supabase-build /` holds this note and a `supabase/` folder with the migrations and tests. It sits next to the `theuntaughtlessons-site` folder on purpose and is not inside it.
- **Repo target:** Copy `supabase/` to the root of the `supabase-core` worktree. Copy this note to `docs/SUPABASE_BUILD_HANDOFF.md` in that worktree.
- **Never edit the Drive copy of the migrations once they are in the repo.** The repo copy is the source of truth from then on, and this note records any change.

## Ownership rules

- **Branch:** Work only on the branch `supabase-core` in a separate worktree. Never edit the admin console navigation files on the main working branch.
- **Repo writer:** Claude Code is the only session that edits files in the repo, runs Firebase scripts and runs import scripts.
- **Schema design:** The Claude web session proposes schema changes by updating this file or the migration files in Drive. Claude Code applies them.
- **Do not touch:** The existing Supabase project "UTL DOC Development". It has its own organization model and these migrations would collide with it.
- **Production data:** No import runs against production until Wen-Szu approves the dry run report.
- **One writer at a time:** Both Claude Code sessions (desktop and VS Code) read this same file. Only one of them edits the repo at any moment, and the other waits or only reads.

## What is in the folder

- `supabase/migrations/` holds nine ordered migrations (0100 to 0900). They were tested on a local Postgres with 33 checks, all passing.
- `supabase/schema-test.mjs` and `supabase/schema-apply-harness.mjs` rerun those checks with `npm i -D @electric-sql/pglite` and `node supabase/schema-test.mjs` from the repo root.

## Design in one page

- **People and organizations:** Separate tables. A person can hold many affiliations over time. The database blocks overlapping dates for the same person and organization.
- **Programs:** Rows in `programs`, never columns on a person. Seeded with `tsa`, `executive-signature` and `doc` (draft).
- **Enrollments:** One active enrollment per person per program. The sponsor organization is stored on the enrollment and on each attempt, so history survives job changes.
- **Assessments:** Published versions are frozen. Completed attempts are frozen. A retake is a new attempt. Scoring rules live in a server only table.
- **Access:** Browsers can only read, and only their own rows or rows their role allows. All writes go through trusted server code with the service role.
- **Organization reports:** Sponsors see aggregates only through `org_assessment_summary`, which hides results below 5 distinct people.
- **Login branding:** `get_public_org_brand(slug)` returns logo and colors only for active organizations with logo permission confirmed.

## Apply steps

1. Create a Supabase development branch or a new empty project. Confirm the cost with Wen-Szu first.
2. In Authentication, add Firebase as a third party provider with the Firebase project id.
3. Backfill the custom claim `role: 'authenticated'` on all 54 Firebase users with the Admin SDK, and set it for every new user at sign up. Without it Supabase rejects the token.
4. Run the migrations in order with `supabase db push` or the SQL editor.
5. Run `supabase/schema-test.mjs` locally. All 33 checks should pass.
6. Optional hardening: add a restrictive policy that checks the token issuer matches the Firebase project.
7. Run Supabase advisors for security and performance and fix anything flagged.

## Mapping notes for the import scripts

- Firebase uid goes to `people.auth_uid` as text. Emails must be lowercase and trimmed.
- Firestore document ids go to `legacy_firestore_id` on every migrated table so the import can rerun safely.
- `tsa_program_lead` and `es_program_lead` become one `role_grants` row with `role = 'program_lead'` scoped to the matching program.
- Organization roles keep their current names. These are `organization_owner`, `program_manager`, `cohort_facilitator` and `report_viewer`.
- Existing enrollments in the repo have `organizationId: null`. Fill the sponsor from the cohort or the person's current affiliation where it can be proven, otherwise leave it empty and log it.
- Every import writes to `migration_runs` and `migration_records` with checksums. Run a dry run first and compare row counts per table.

## Decisions from Wen-Szu (2026-10-05)

- **AyalaLand cohort:** The official cohort has ended, but some people are still finishing and log in occasionally. Access stays open for one more year, so import their entitlements with an expiry date one year out and do not archive them.
- **Freeze:** No hard freeze is needed for AyalaLand. The cutover must keep sign in working for them at all times.
- **Navigation work:** Not committed yet and still changing. Create `supabase-core` from the last commit that exists and never touch `admin/index.html` until Wen-Szu says the navigation work is merged.
- **Supabase project:** One production project holds all programs.
- **Former employers:** A sponsor organization keeps seeing the results of people it sponsored after they leave, because the sponsorship is part of the sponsor's own account. The schema already does this, since sponsor access follows the sponsor stored on the enrollment and the attempt, not the current affiliation. Do not add any rule that hides results after an affiliation ends.

## Next phase: TSA learning tables

The TSA learning tables need the real Firestore shapes from `firestore.rules` and `assets/firebase.js`. The inventory below is that list. No tables are designed yet. The design belongs to the Claude web session.

### TSA learning inventory (2026-10-05)

Sources: `firestore.rules` and `assets/firebase.js` in this worktree, compared with the uncommitted copies in the main folder. The main folder differs only by a `settings/payments` document and its helpers, which are not learning data. Shapes come from the code that writes them. No live documents were read, so real records may hold older or extra fields.

**Finding that conflicts with this note.** There are no `modules`, `lessons` or `notes` collections in Firestore. Course structure is static site content. Learner data is keyed by exercise id (for example `grocery-list`), with a map in `assets/firebase.js` (`exerciseProgressIds`) to canonical ids such as `p1-e1`. Two app keys can map to one canonical id (`issue-tree` and `issue-tree-builder` both map to `p2-e1`).

**Per-learner collections, keyed by Firebase uid**

| Path | Doc id | Fields | Write rule |
|---|---|---|---|
| `users/{uid}` | uid | `email`, `displayName`, `role`, `photoURL`, `lastSignInProvider`, `signInProviders[]`, `feedbackEnabled`, `lastSeenAt`, `updatedAt`, plus the nested maps below | Self or admin, no field validation |
| `users/{uid}/completed_exercises` | exercise id | `status` ("Done"), `exerciseName`, `updatedAt`, `savedPayload` (free-form map) | Self or admin. Overwritten on each completion |
| `users/{uid}/exercise_submissions` | `{exerciseId}-{completedAt}` | `schemaVersion`, `userId`, `exerciseId`, `exerciseTitle`, `submissionId`, `attemptNumber`, `completedAtClient`, `durationSeconds`, `responsePayload` (free-form map), `createdAt` | Self. No delete |
| `users/{uid}/exercise_attempts` | attempt id | `schemaVersion`, `userId`, `attemptId`, `exerciseId`, `exerciseTitle`, `contentVersion`, `score`, `scoreMaximum`, `scorePercent`, `attemptNumber`, `durationSeconds`, `submittedAt`, `createdAt` | Self, create only, fully validated |
| `users/{uid}/exercise_work` | exercise id | `schemaVersion`, `userId`, `exerciseId`, `exerciseTitle`, `draftPayload` (free-form map), `updatedAt` | Self only. Admin cannot read. Deletable |
| `users/{uid}/learning_profile_evidence` | evidence id | `schemaVersion`, `userId`, `evidenceId`, `exerciseId`, `attemptId`, `programId`, `evidenceSource`, `recordedAtClient`, `learningDimensions` (5 keys), `capabilities[]` (up to 20), `performance` (3 keys), `measurementDesign` (9 keys), `createdAt` | Self, create only, fully validated |
| `learning_profile_summaries/{uid}` | uid | `schemaVersion`, `userId`, `personality`, `learning`, `programs` (maps), `updatedAt` | Self. Derived from the evidence in a client transaction |
| `users/{uid}/analytics_sessions` | session id | 37 validated fields: timing counters, page and activity ids, progress percent, video watch counters | Self, create and update |
| `users/{uid}/analytics_activity_sessions` | activity session id | Same fields plus `activitySessionId` | Self, create and update |
| `users/{uid}/stability_events` | event id | `eventType`, `severity`, `fingerprint`, `message`, `source`, `pagePath`, `activityId`, `browser`, `deviceClass`, `online`, `occurredAtClient`, `occurredAtMs`, `receivedAt` | Self, create only. Admin read only |

**Maps nested inside `users/{uid}`**

- `workspaceProgress.exercises.{id}`: `visited`, `completed`, `completedAt`, `title`, `appKey`. Written under both the app key and the canonical id, so each completion appears twice.
- `rewards`: `mpTotal`, `masteryPoints`, `level`, `currentLevel`, `earnedEvents`, `earnedEventIds`, `ledger[]` (up to 500 entries with `id`, `earnedAt`, `mpEarned`). The same object is also copied to `workspaceProgress.rewards`.
- `syncHealth`: `pendingProgressSaves`, `lastSyncSuccessAt`, `lastRecoveredAt`.

**TSA assessment collections, top level**

| Path | Doc id | Fields | Write rule |
|---|---|---|---|
| `assessment_item_attempts` | attempt id | `userId`, `assessment` (diagnostic or checkpoint), `bankRelease`, `rubricVersion`, `formId`, `totalScore`, `items[]` (up to 45), `completedAt`, `updatedAt` | Owner creates and updates. Admin read only |
| `assessment_item_reviews` | question id | Not written in `assets/firebase.js`. Shape unknown | Admin only |
| `tsa_scoring_comparisons` | attempt id | `userId`, `attemptId`, `assessment`, `formId`, `rubricVersion`, `enabled`, `officialSource`, `deterministic`, `genAi`, `difference`, `modelVersion`, `completedAt`, `updatedAt` | Owner writes. Admin read only |

**Membership and settings that TSA depends on**

- `authorized_members/{email}`: keyed by lowercase email, not uid. Fields seen: `email`, `role`, `name`, `goals`, `avatarIconId`, `cohort`, `feedbackEnabled`, `googleGroupAdded`, `addedAt`, `updatedAt`, `firstLoginAt`, `lastLoginAt`, `lastSignInProvider`, `signInProviders[]`. The admin console can add other fields through a spread, so the full field list needs a live sample.
- `settings/{docId}`: `cohorts`, `feedback`, `engagement`, `rewards`, `assessments`, `public_assessments`, `tsa_scoring`, `admin_visibility`, `emailTemplates`, `publicSite`, and `payments` (main folder only).
- `access_requests/{email}`: `fullName`, `email`, `notes`, `status`, `requestedAt`.
- Operational: `google_group_sync_jobs`, `support_preview_audit`.
- Server only, not in `firestore.rules`: `access_audit`, `roster_drafts`, `weekly_report_log`.

**Points the table design has to settle**

1. **Three records per completion.** One completion writes `completed_exercises`, `exercise_submissions` and `workspaceProgress.exercises`. The design needs one source of truth.
2. **Free-form payloads.** `savedPayload`, `responsePayload` and `draftPayload` differ per exercise and have no schema. They fit a `jsonb` column unless each exercise gets its own shape.
3. **Exercise catalog.** Exercise ids and titles exist only in site code. A catalog table would need to be created, including the app key to canonical id map.
4. **Browser writes.** Learners write all of this directly from the browser today. The core design allows browsers to read only, so every one of these writes needs a server path.
5. **Email keys.** `authorized_members` is keyed by email and `users` by uid. The import has to join them, and 7 Auth users have no member record.
6. **Client-computed values.** Rewards totals and learning profile summaries are calculated in the browser. Decide whether to import them as they are or recompute them.
7. **Volume.** Analytics sessions and stability events are high volume. Decide whether they move to Supabase at all.
8. **Draft privacy.** `exercise_work` is hidden from admins today. Keep that rule or change it on purpose.

**Still needed before design:** document counts per collection and a few real documents with values removed, to catch legacy fields. That is a read-only script against production Firestore and needs Wen-Szu's approval first.

## Deployment rule

Do not deploy any Firebase function from this worktree until the uncommitted changes in the main working folder (`theuntaughtlessons-site` in Drive) are committed and merged into `main`. The main folder has uncommitted edits to `functions-admin/index.js` and `assets/firebase.js`, and deploying from here would ship code that doesn't match what's in that folder.

The only exception: deploy `setRoleClaimOnUserCreated` on its own, with `firebase deploy --only functions:admin-actions:setRoleClaimOnUserCreated`. The `admin-actions` part is the codebase name in `firebase.json`. Don't deploy the whole codebase.

## Supabase project

- **Project name:** utl-core
- **Project ref:** czljyikfavtjgqcibdda
- **Region:** ap-southeast-1
- **Organization:** The Untaught Lessons
- **Plan:** Free for now. Upgrade to Pro before any real data import.
- **Migrations:** 0100 to 1000 applied.
- **Data:** No data imported.
- **Do not touch:** the old UTL DOC Development project.

## Status log

Add one dated line per step, newest last.

- 2026-10-05: Nine migrations written and tested locally. Files placed in Drive under `04 Website design / utl-supabase-build`. Nothing applied to any Supabase project. Nothing changed in the repo.
- 2026-10-05: Worktree `supabase-core` created at `~/dev/utl-supabase-core` (orphan branch, the repo has no commits yet). `supabase/` and this handoff copied in; `schema-test.mjs` passed 33 of 33 checks with `@electric-sql/pglite` installed as a dev dependency.
- 2026-10-05: Worktree `supabase-core` recreated at `~/dev/utl-supabase-core` from `main` (commit `8228faa`) in `theuntaughtlessons-site`, replacing the orphan worktree. `schema-test.mjs` passed 33 of 33 checks after `npm init -y` and `npm i -D @electric-sql/pglite` inside the worktree.
- 2026-10-05: Added migration `20261005001000_hardening.sql` to the worktree, `node_modules/` to `.gitignore`, and the "Supabase project" section. `schema-test.mjs` still passes 33 of 33 with the hardening migration included. Nothing committed.
- 2026-10-05: Read-only Firebase Auth claim audit written to `docs/SUPABASE_AUTH_CLAIM_AUDIT.md`. No `role` claim or claim API exists in the repo, and none of the 61 Firebase users has any custom claims. Script at `scripts/supabase-auth-claim-audit.js`. Nothing changed in Firebase or Supabase, nothing committed.
- 2026-10-05: Built the `role` = `authenticated` claim in this worktree, not deployed. Added the `setRoleClaimOnUserCreated` trigger, `scripts/supabase-auth-claim-backfill.js` (dry run by default, typed-confirm apply, `--remove` undo), merge unit tests, and a forced token refresh for new accounts in `assets/firebase.js`. Backfill dry run: 61 users, all would receive the claim, 0 conflicts. Of the 61, 7 are not in the 55 members baseline. Nothing applied, nothing committed.
- 2026-10-05: Added `--email` (single-user scope) and `--verify` to the backfill script. Dry run for the owner account: 1 user, would change. Added the deployment rule above. Committed this worktree's work to `supabase-core` as a checkpoint, not pushed. Nothing deployed, nothing applied.
- 2026-10-05: The Admin SDK end-to-end check stopped at token creation (`auth/invalid-credential`, because the local login is a personal account). Replaced it with a local-only test page at `tools/supabase-auth-check/index.html`, which is never deployed. The failed script was deleted. Nothing committed yet.
- 2026-10-05: Local end-to-end check passed 4 of 4 (signed-in token carries the role claim, Supabase returns programs `tsa` and `executive-signature` with the token, anonymous reads return no rows, unknown-slug brand RPC returns 0 rows). Results in `docs/SUPABASE_AUTH_CLAIM_AUDIT.md` section 11. `tools/` excluded from Firebase hosting. Committed to `supabase-core`, not pushed.
- 2026-10-05: Desktop Claude Code session took over as the only repo writer. Read-only checks: the live audit shows all 61 Firebase users carry `role` = `authenticated` (the backfill apply was never logged here, and audit sections 9 and 11 still say it was not run); `utl-core` has ten migrations applied; `setRoleClaimOnUserCreated` is not in the deployed functions list; the main folder's `firebase.json` does not yet ignore `tools`. Apply step 3 still says 54 users and "What is in the folder" still says nine migrations. Nothing changed outside this note.
- 2026-10-05: Wrote the TSA learning inventory under "Next phase" from `firestore.rules` and `assets/firebase.js`. No `modules`, `lessons` or `notes` collections exist; learner data is keyed by exercise id. No live documents read, no tables designed, nothing committed.
- 2026-10-06: Wen-Szu reported the main folder's work is pushed and in production (`origin/main` at `2070e33`, main folder clean). Merged `origin/main` into `supabase-core`; one conflict in `functions-admin/index.js` (both sides appended to the file) resolved by keeping both. The merge is resolved in the working tree but not committed; the permission layer blocks commits without Wen-Szu's go. The deployment rule's condition is now met.
- 2026-10-06: Designed the TSA learning tables as `supabase/migrations/20261006001100_tsa_learning.sql` (activities and keys, submissions, attempts, progress, drafts, learning profile, reward ledger and totals view, engagement sessions, stability events, scoring comparisons, item reviews, person profiles, app settings, access requests). Added 26 checks to `schema-test.mjs`; 59 of 59 pass locally. Not applied to `utl-core`.
- 2026-10-06: Wrote `scripts/supabase-firestore-inventory.js` (read-only counts and field names, no values). Running it against production was blocked by the permission layer; Wen-Szu runs it. Wrote `docs/SUPABASE_MIGRATION_PLAN.md`: four stages, steps with checks and undo, risks, effort, decisions. Nothing committed, nothing deployed, nothing applied.
