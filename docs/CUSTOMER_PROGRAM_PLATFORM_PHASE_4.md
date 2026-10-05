# Phase 4 — Backfill and Reconciliation Evidence

Last updated: 2026-10-04  
Scope completed: local/synthetic tooling, emulator verification, production baseline, production dry-run plan, production apply, and production reconciliation  
Production execution: complete

## Outcome

The migration system is implemented and verified locally. It creates additive canonical customer, email-claim, verified Auth-link, and TSA-enrollment records while treating `authorized_members`, `users`, `settings/cohorts`, and `organizations` as immutable legacy sources. Existing canonical email claims are reused; identity changes or ownership conflicts are quarantined for human review rather than merged.

Phase 4 has **Passed**, local and production. The restricted production baseline was captured and signed, a production dry-run plan was generated and reviewed (55 records, 0 named exceptions), the operating window was approved (batch size 25, halt on mismatch, rollback owner Wen-Szu), the apply completed (55/55 applied, 0 exceptions), and reconciliation passed (`matched=55`, `mismatched=0`, `sourceUnchanged=true`). Phase 5 and 6 are no longer blocked by Phase 4. Their direct production-data reconciliation has since passed; meaningful-scale performance, accessibility/usability, deployment, ownership decisions, and their written gates remain open.

## Implemented controls

- Core migration APIs retain an emulator-only write guard. The separately reviewed production runner requires an exact typed project confirmation and refuses unacknowledged exceptions.
- Offline, checksum-protected dry-run planning from a versioned snapshot.
- Deterministic opaque IDs and exact normalized-email matching; no fuzzy/name merge.
- Existing canonical email-claim reuse so TSA members already represented in the customer model are not duplicated.
- Duplicate, invalid, unverified, changed-email, and ownership-conflict handling with named ledger reasons.
- Bounded batches (`1–100`), durable checkpoints, per-record checksums, and idempotent replay.
- Before-state restore snapshot covering every target document.
- Reconciliation that requires each planned record to be matched or explicitly named as an exception, with source collections unchanged.
- Restore drill that recreates pre-existing target documents and removes only targets absent before the run.

## Evidence

| Evidence | Result |
| --- | --- |
| `scripts/customer-program-migration.js` | Planner, inventory capture, apply, resume, reconciliation, and restore implementation |
| `tests/fixtures/customer-program-migration-synthetic.json` | TSA participant, admin-only, unverified, mismatch, invalid, and duplicate fixtures |
| `tests/customer-program-phase4-contract.test.js` | Dry-run determinism, source immutability, entitlement restraint, checksum tamper, and production guard pass |
| `tests/customer-program-migration.test.js` | Apply/resume/idempotency, canonical reuse, collision quarantine, reconciliation, TSA isolation, and restore pass |
| Static repository sweep | 73/74 pass, 12 emulator-only skips; only the existing `typography-system.test.js` `.ra-data-rule` baseline fails |
| Firebase emulator regression | Existing TSA/member, organization, readiness, rules, identity, callable, and immutable-persistence suites plus migration drill pass together |
| `scripts/customer-program-production-baseline.js` | Read-only production baseline capture; refuses to target the live `"(default)"` database, only a named isolated database |
| `scripts/customer-program-production-dry-run.js` | Production dry-run plan generation from a signed baseline plus a read-only Firebase Auth `listUsers` call; refuses any non-production-verification snapshot; `--snapshot-out` persists the exact merged snapshot reconciliation needs |
| `scripts/customer-program-production-apply.js` | The only script in this project authorized to write to the live `"(default)"` database. Reuses `applyRecord`/`readTargetState`/`verifyPlan` from `customer-program-migration.js` (guard-free by construction) rather than touching that module's `assertEmulatorOnly`-guarded functions. Requires a typed `--confirm-production-write <project-id>` matching `--project` exactly; refuses a plan with named exceptions unless `--acknowledge-exceptions` is passed |
| `tests/customer-program-phase4-production-tooling.test.js` | Confirms all three production scripts' refusal guards, that `planSnapshot`'s default behavior (no `allowedEnvironments` option) is unchanged for every existing caller, and regression-guards the sourceChecksum/merged-snapshot relationship that caused the reconciliation incident below |
| `tests/customer-program-production-apply.test.js` | Emulator-verified: confirmation-guard rejection, batched apply with correct checkpointing, idempotent replay (zero duplicates on a second apply of the same plan), and exception quarantine requiring explicit acknowledgment — all proven safe before any production use |

## Production execution

1. **Isolated baseline/restore target.** `firebase firestore:databases:clone "(default)" cpp-phase4-baseline` created a full point-in-time copy of production (snapshot time `2026-10-04T04:02:00Z`) as a second, separate Firestore database in the same project. This single native operation served as both the recoverable export and the isolated nonproduction restore target — Google's clone mechanism is atomic, so there was no separate custom export/import step to get wrong.
2. **Restricted production baseline — signed 2026-10-04 by Wen-Szu.** `scripts/customer-program-production-baseline.js` read the clone (never the live database) and counted 55 `authorized_members`, 54 `users`, 2 `organizations`, and zero rows in every customer-program-platform collection — confirming nothing from this plan had reached production before this work began. `snapshotChecksum=2b266d07233a30d65979706bbf5620dd6b57f24242890ec4b6e106c0b9d613e2`, `targetInventoryChecksum=9959bec44aaf8a845ad5aceba64ed3e9b157be43b15992a64598dfcd48773f8f`.
3. **Production dry-run plan — generated and reviewed 2026-10-04.** `scripts/customer-program-production-dry-run.js` combined the signed baseline with one read-only Firebase Authentication `listUsers` call (Auth has no per-database isolation, unlike Firestore) and produced a plan of 55 records with 0 named exceptions and 1 soft warning (one member has no matching Auth account yet; handled, not blocking). 53 records create a TSA enrollment. `planChecksum=88f3ddc68cdf22ef02c2478f7b8cbb2408c87945df360c1432f5f71d80652852`.
4. **Operating window approved 2026-10-04 by Wen-Szu.** Batch size 25, halt on any checksum mismatch, rollback owner Wen-Szu, no special maintenance window (the backfill is purely additive and Phase 5/6's UI remain feature-flagged off, so there is no user-facing behavior to protect either way).
5. **Production apply — executed 2026-10-04.** `scripts/customer-program-production-apply.js apply` wrote 55/55 records, 0 skipped, 0 exceptions, checkpointing at 25/50/55. Every write is additive-only (`applyRecord` only ever `transaction.create()`s documents that do not already exist) and idempotent (a second apply of the same plan replayed safely from the ledger with zero duplicates, confirmed in the emulator test before production use).
6. **Reconciliation — passed 2026-10-04**, on the second attempt. The first attempt reported `FAILED` despite `matched=55, mismatched=0` — root-caused to the reconciliation tooling comparing the raw baseline file (no Auth users) against the plan's `sourceChecksum` (computed from the baseline *merged* with live Auth users). This was a bug in the verification tooling, not a data problem: `matched`/`mismatched` already proved every record was correct. Fixed by having the dry-run script persist the merged snapshot via `--snapshot-out`, and added a regression test. Re-run with the corrected snapshot: `sourceUnchanged=true`, `planned=55`, `matched=55`, `mismatched=0`, **PASSED**.

Full baseline, plan, apply-result, and reconciliation records (real member names/emails) are kept locally at `~/phase4-production-artifacts/` on the owner's machine, outside any synced storage and outside this repository, and are tracked in `docs/CUSTOMER_PROGRAM_PLATFORM_TRACKER.md`'s "Active production-adjacent resources" table. The `cpp-phase4-baseline` clone database remains live in the project until the owner explicitly deletes it.

## Production gate — complete

All six items the accountable owner needed to authorize are done:

1. ~~Capture and sign the restricted production TSA/customer baseline.~~ Done 2026-10-04.
2. ~~Create a recoverable production export and record its immutable identifier/checksum.~~ Done 2026-10-04 (the clone itself).
3. ~~Restore that export into an isolated nonproduction project and verify counts/checksums.~~ Done 2026-10-04 (the same clone, read directly).
4. ~~Generate the production dry-run plan without applying it; review every named exception.~~ Done 2026-10-04 — 0 exceptions to review.
5. ~~Approve batch size, rate, maintenance window, monitoring, stop conditions, and rollback owner.~~ Done 2026-10-04.
6. ~~Apply in bounded batches, reconcile 100% as matched or approved named exceptions, then sign the gate.~~ Done 2026-10-04.

The repository's original CLI still exposes only offline `plan` for `customer-program-migration.js` itself — production apply/reconcile live entirely in the separately reviewed `customer-program-production-apply.js`, which was emulator-verified before its first and only production use.

## Local verification commands

```sh
node tests/customer-program-phase4-contract.test.js
node tests/customer-program-phase4-production-tooling.test.js
firebase emulators:exec --config firebase.phase1-emulator.json --only auth,firestore --project the-untaught-lessons "node tests/customer-program-migration.test.js"
firebase emulators:exec --config firebase.phase1-emulator.json --only auth,firestore --project the-untaught-lessons "node tests/customer-program-production-apply.test.js"
```

## Production commands run

```sh
firebase firestore:databases:clone "projects/the-untaught-lessons/databases/(default)" "projects/the-untaught-lessons/databases/cpp-phase4-baseline" --project the-untaught-lessons
node scripts/customer-program-production-baseline.js --project the-untaught-lessons --database cpp-phase4-baseline --snapshot-time "2026-10-04T04:02:00Z" --out ~/phase4-production-artifacts/baseline-2026-10-04.json
node scripts/customer-program-production-dry-run.js --project the-untaught-lessons --baseline ~/phase4-production-artifacts/baseline-2026-10-04.json --out ~/phase4-production-artifacts/dry-run-plan-2026-10-04.json --run-id "prod_dry_run_20261004"
node scripts/customer-program-production-apply.js apply --project the-untaught-lessons --confirm-production-write the-untaught-lessons --plan ~/phase4-production-artifacts/dry-run-plan-2026-10-04.json --out ~/phase4-production-artifacts/apply-result-2026-10-04.json --batch-size 25
node scripts/customer-program-production-dry-run.js --project the-untaught-lessons --baseline ~/phase4-production-artifacts/baseline-2026-10-04.json --out ~/phase4-production-artifacts/dry-run-plan-2026-10-04-reconcile.json --snapshot-out ~/phase4-production-artifacts/source-snapshot-2026-10-04.json --run-id "prod_dry_run_20261004"
node scripts/customer-program-production-apply.js reconcile --project the-untaught-lessons --confirm-production-write the-untaught-lessons --plan ~/phase4-production-artifacts/dry-run-plan-2026-10-04-reconcile.json --source-snapshot ~/phase4-production-artifacts/source-snapshot-2026-10-04.json --out ~/phase4-production-artifacts/reconciliation-2026-10-04-v2.json
```
