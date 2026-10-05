# Phase 8 — TSA Shadow Verification

Last updated: 2026-10-05
Scope: a read-only comparison tool between the legacy TSA sources and the Phase 4 `customers`/`enrollments` projection, per the implementation plan's "Phase 8 — TSA shadow verification" and TSA protection rule 10 ("TSA remains authoritative until shadow verification passes")
Status: run against real production data; the one gap found (missing `organizationId` on 29 enrollments) has been corrected in production and independently verified; not yet "passed" (no formal gate review/sign-off has happened, and the tool should be re-run once to confirm a clean 0-mismatch result going forward)

## Outcome so far

Built and emulator-verified a standalone, read-only tool that compares every legacy `authorized_members` record against the additive `customers`/`enrollments` projection Phase 4 backfilled, in both directions. TSA screens continue to read only `authorized_members`, `users`, and `settings/cohorts` during this phase; this tool never writes anything and is not wired into any live page, callable, or scheduled job.

### Real production result (2026-10-05)

`node scripts/tsa-shadow-verification.js --project the-untaught-lessons`: `legacyMemberCount=55 matchedCount=26 mismatchedCount=29 orphanedShadowCount=0`. A reason-code tally on the full report (run with `--out`) showed **all 29 mismatches are exactly one reason code, `organization_mismatch`** — zero `missing_customer_projection`, zero `missing_enrollment_projection`, zero `cohort_mismatch`, zero `enrollment_status_inconsistent_with_active_member`.

This is a clean result, not a crisis: every one of the 55 legacy members' identity resolution, cohort assignment, and access status matches the new projection perfectly. The only gap is that `scripts/customer-program-migration.js` hardcoded `organizationId: null` on every TSA enrollment it created (confirmed directly in that file), so this shadow tool's organization-consistency check — which resolves the expected organization from the member's cohort as of *today* — fires for every enrollment whose cohort actually belongs to an organization. Zero orphans, zero never-backfilled members, zero status drift.

### Corrective tool built in response

`scripts/tsa-enrollment-organization-backfill.js` — additive-only, emulator-verified (`tests/tsa-enrollment-organization-backfill.test.js`): for every TSA enrollment with no `organizationId`, resolves the expected value from `settings/cohorts[cohortId].organizationId` and, only in `apply` mode with the same typed `--confirm-production-write <project-id>` gate `customer-program-production-apply.js` uses, sets it. It never overwrites an enrollment that already has an `organizationId`, re-checks that invariant transactionally at apply time (so a concurrent change can't be clobbered), writes an audit event per change, and is idempotent on replay (a second apply reports `skipped_already_set` rather than reapplying). `plan` mode is fully read-only and shows exactly what would change before anything is authorized.

### Applied to production (2026-10-05)

The owner reviewed the `plan` output (29 enrollments, cleanly mapping to `admu-fin` or `ayalaland`) and authorized `apply`. Independently confirmed afterward with a direct read-only query rather than trusting the apply command's own report alone: 29 `enrollment_organization_backfilled` audit events exist; a sample enrollment shows the expected `organizationId`; of 53 total TSA enrollments, exactly 29 now carry an `organizationId` and the other 24 legitimately have none (their cohorts have no organization mapping). The gap this phase's shadow verification found is corrected. A follow-up run of `tsa-shadow-verification.js` would be expected to now report 0 mismatches; that confirmation run has not been repeated since the fix, but is a simple, safe thing to do before treating Phase 8 as passed.

## What the tool checks

For every `authorized_members` document (keyed by normalized email, per the existing legacy shape confirmed in `functions-admin/index.js`):

- Whether a matching `customers` document exists, matched by `emailHash` the same way `scripts/customer-program-migration.js` resolves identity (normalized email, SHA-256 hashed, no fuzzy or name-based matching).
- Whether a matching `enrollments` document (`programId == "tsa"`, `customerId` pointing at the matched customer) exists, when the legacy member looks like a participant (`role == "member"`, or a `cohort` is set, or the linked `users` document has `products.tsa`) — the same participant heuristic Phase 4's `planSnapshot` already uses, so the two tools agree on who was expected to receive an enrollment.
- Whether the enrollment's `cohortId` matches the legacy member's current `authorized_members.cohort`, and whether its `organizationId` matches the organization `settings/cohorts[cohortId].organizationId` resolves to today (not at backfill time) — catching a cohort reassignment that happened after Phase 4 ran.
- Whether the enrollment's `status` is consistent with the legacy member still being authorized: an `authorized_members` status other than `inactive` paired with an enrollment `status` of `revoked` or `withdrawn` is reported, not assumed to be fine.

In the reverse direction, every `customers` document carrying `tsa` in `programIds` and every `enrollments` document with `programId == "tsa"` is checked for a corresponding `authorized_members` document; an orphan is reported as a mismatch, not a crash, even though an additive-only migration should never produce one.

## Legacy sources read

Confirmed directly in `functions-admin/index.js` rather than assumed:

- `authorized_members/{normalizedEmail}` — document ID is the normalized email itself; fields include `role`, `status`, `cohort`, `name`.
- `users/{uid}` — looked up by matching `email` field (not by Auth UID resolution, since this tool has no Firebase Auth `listUsers` call the way the Phase 4 production dry-run does); used only to evaluate the `products.tsa` participant signal.
- `settings/cohorts` — one document holding a flat map keyed by cohort ID, each value carrying `organizationId`; there is no nested `cohorts` field (matches the comment already in `functions-admin/index.js`'s `organizationDefinitions()`).
- `credential_issuance` and `public_credentials` — read for completeness per the task's instruction to locate the real credential/reward collection names; they are not yet part of any comparison rule (see "Not yet built"). Reward data itself (`mp`/`level`) is **not** a separate collection — it lives inline on the `users` document under `rewards` or `workspaceProgress.rewards`, computed by `cohortReward()` in `functions-admin/index.js`. There is no standalone rewards collection to read.

## Report shape

`compareTsaShadow()` returns:

```text
{
  schemaVersion: 1,
  generatedAt: <ISO timestamp>,
  counts: {
    legacyMemberCount,       // every authorized_members document read
    matchedCount,            // legacy members with zero reasonCodes
    mismatchedCount,         // total mismatches array length (forward + reverse)
    forwardMismatchCount,    // legacy member -> shadow direction only
    orphanedShadowCount      // shadow -> legacy direction only
  },
  mismatches: [
    { emailOrIdentifier: <SHA-256 of normalized email, never raw>, reasonCodes: [...], legacySide: {...}, newSide: {...} }
  ],
  reportChecksum: <SHA-256 of the report, same stable-key-ordering convention as scripts/customer-program-migration.js>
}
```

`matchedCount + forwardMismatchCount == legacyMemberCount` always holds; `orphanedShadowCount` is additional and has no legacy member to attribute to, so its entries carry `legacySide: null`. No raw email, name, or other direct PII is ever placed in the report; `emailOrIdentifier` is always the SHA-256 hash, and `legacySide`/`newSide` carry only bounded status/role/cohort/ID fields.

Reason codes produced: `invalid_or_missing_email`, `duplicate_authorized_email`, `missing_customer_projection`, `missing_enrollment_projection`, `cohort_mismatch`, `organization_mismatch`, `enrollment_status_inconsistent_with_active_member`, `orphaned_customer_projection_no_legacy_member`, `orphaned_enrollment_no_customer_record`.

## Implemented controls

- Read-only by construction: the script never calls `.set()`, `.update()`, `.delete()`, `transaction.create()`, or `batch()` against Firestore anywhere; grepped the finished file to confirm zero such calls outside of unrelated `Map.set()`/`crypto.update()` usages.
- `connectFirestore({ projectId, databaseId })` mirrors `scripts/customer-program-production-baseline.js`'s pattern: a named, non-default `databaseId` is addressed through `getFirestore(app, databaseId)`; omitting it falls back to `admin.firestore()` for ordinary emulator use. No production-specific CLI confirmation flag was built, per the task's scope — this tool reads, it never needs a typed production-write confirmation the way the Phase 4 apply script does.
- Comparison logic (`compareTsaShadow`) is a pure function over already-fetched rows, exported directly (not just reachable through `main()`), matching the `planSnapshot`/`applyRecord` separation in `scripts/customer-program-migration.js` so tests can call it without a live Firestore connection once the rows are in hand.
- `readLegacySources(db)` and `readProjections(db)` are separate exported async readers, so a caller (or a future production runner) can supply its own snapshot shape without re-deriving the comparison rules.
- `--out <file>` writes with the same `{ flag: "wx" }` no-clobber behavior as every other script in this project; omitting `--out` never touches disk.

## Evidence

| Evidence | Result |
| --- | --- |
| `scripts/tsa-shadow-verification.js` | `readLegacySources`, `readProjections`, `compareTsaShadow`, `runShadowVerification`, `connectFirestore` exports; CLI wrapper prints counts and `reportChecksum` |
| `tests/tsa-shadow-verification.test.js` | Emulator-verified: exact match (clean), never-backfilled member (`missing_customer_projection`), post-backfill cohort reassignment (`cohort_mismatch`), enrollment revoked while the legacy member stays active (`enrollment_status_inconsistent_with_active_member`), and a reverse-direction orphaned customer/enrollment with no legacy member (reported, not thrown) — plus an exact assertion on every count in `counts` |
| Static repository sweep | Unchanged baseline: only the pre-existing `tests/typography-system.test.js` failure; every other file passes or skips cleanly |

## Local verification commands

```sh
firebase emulators:exec --config firebase.phase1-emulator.json --only auth,firestore --project the-untaught-lessons \
  "node tests/tsa-shadow-verification.test.js"
```

```sh
for f in tests/*.test.js; do out=$(node "$f" 2>&1); code=$?; echo "$f: exit=$code"; done | grep -v "exit=0"
```

## Not yet built / not yet decided

- No production run. This tool has read only synthetic emulator fixtures. Running it against real production data (even read-only) and reviewing its output is a decision for the business owner, not something built or performed here.
- No use of `credential_issuance`/`public_credentials` in the comparison rules yet — they are read and available, but no reason code currently depends on them. Whether a shadow mismatch should also flag "credential issued without a shadow enrollment" is an open design question, not resolved by this phase.
- No reward (`mp`/`level`) comparison — there is no separate rewards collection to shadow-verify against; this was confirmed, not assumed, by reading `cohortReward()` in `functions-admin/index.js`.
- No disposition workflow for a real mismatch (the plan says "resolve or formally approve every mismatch"; this tool only detects and reports, it does not resolve).
- No wiring into the admin console, a scheduled job, or any alerting — it is a standalone script, run by hand.
- Phase 8 cannot be marked "passed" until it has been run against real production data and every real mismatch has been resolved or formally approved by the accountable owner, per the plan's gate rule.
