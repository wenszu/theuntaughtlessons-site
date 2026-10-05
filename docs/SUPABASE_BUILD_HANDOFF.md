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

## Next phase, not started

The TSA learning tables (modules, lessons, progress, notes) need the real Firestore shapes from `firestore.rules` and `assets/firebase.js`. Claude Code should list the collections and sample document shapes here before anyone designs those tables.

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
