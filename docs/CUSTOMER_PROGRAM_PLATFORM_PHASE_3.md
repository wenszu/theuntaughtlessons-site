# Customer and Program Platform — Phase 3 Evidence

Date: 2026-10-04  
Status: Passed  
Environment: Local Firebase Auth and Firestore emulators only  
Production impact: None; functions, rules, indexes, data, and hosting were not deployed

## Outcome

Phase 3 replaces summary-only Executive Signature completion storage with an immutable, server-scored, versioned persistence transaction. Each completion keeps the answer evidence and exact scoring references needed to reproduce the result, while the existing readiness summary remains as a compatibility projection.

Existing TSA sources and authorization remain unchanged.

## Implemented artifacts

| Artifact | Purpose |
| --- | --- |
| `functions-admin/executive-signature-versions.js` | Deployable locked Quick Check and Full Assessment scoring/version registry |
| `functions-admin/assessment-persistence-service.js` | Atomic completion, response, consent, scoring, entitlement, projection, audit, idempotency, and outbox persistence |
| `functions-admin/index.js` | Preflight validation and integration into the existing readiness completion callable |
| `apps/readiness-assessment/index.html` | Sends locked answers/order/timing/versioned consent and surfaces save failure without changing the result experience |
| `tests/customer-program-phase3-contract.test.js` | Browser/server form parity and static persistence contract checks |
| `tests/customer-program-assessment-persistence.test.js` | Emulator atomicity, concurrency, reproducibility, response parts, consent, retake, projection, audit, and outbox checks |
| `tests/readiness-assessment-account.test.js` | Existing account/TSA coexistence behavior through the new persistence path |

## Transaction boundary

For a valid completion, one Firestore transaction writes:

1. Immutable completed attempt metadata
2. One Quick Check response part or two Full Assessment response parts
3. Assessment-processing and optional marketing consent events
4. Published assessment definition/version snapshots when absent
5. Entitlement usage and report availability
6. Latest-result customer projection
7. Redacted audit evidence
8. Pending analytics outbox work and, for Full Assessment, pending report-generation work
9. Hashed idempotency receipt

No external email, report-generation, analytics, CRM, or payment call occurs inside this transaction.

## Verified results

- Browser and server registries match for all 20 Quick Check and 40 Full Assessment question IDs, areas, scoring directions, and order.
- The server independently calculates the official score, band, area/facet scores, and profile.
- Neutral Quick Check answers reproduce score 50 / Developing.
- The strong Full Assessment fixture reproduces score 75 / Strong.
- Quick Check uses one 20-answer response part; Full Assessment uses two 20-answer parts.
- Stored response parts plus the locked server version reproduce the stored score exactly.
- Deterministic response and result checksums match the stored attempt.
- Two concurrent calls with the same submission ID return one attempt.
- Missing consent, missing answers, malformed order, invalid entitlement, and exhausted capacity produce no partial attempt.
- Full Assessment permits one completion by default, then marks the entitlement consumed while retaining report access.
- `retakesAllowed: 1` permits exactly two completed Full Assessment attempts and records one retake used.
- Every completion creates analytics outbox work; Full Assessment also creates report-generation work.
- Audit records contain checksums and IDs, not answer values or question IDs.
- The legacy readiness summary uses the server result and points to the authoritative attempt/checksum.
- Existing TSA/member and organization behavior remains green.

Transaction lock-timeout messages during intentional concurrency tests are expected emulator evidence of contention. The Admin SDK retries; the gate passes only when both calls converge and the emulator wrapper exits 0.

## Test results

The complete seven-suite Firebase regression gate passed with exit code 0:

1. Existing member-account rules
2. Existing organization-console rules
3. Existing readiness-account behavior
4. Cross-program Firestore authorization
5. Phase 2 identity and entitlement service
6. Phase 2 callable authorization
7. Phase 3 immutable assessment persistence

The repository has 80 test files. The non-emulator sweep reports 70 passing, nine intentional emulator skips, and one known pre-existing readiness typography failure involving `.ra-data-rule`. All Phase 3-attributable tests pass, and the skipped Phase 1–3/TSA suites pass in the explicit emulator run.

## How to reproduce

```sh
node tests/customer-program-phase3-contract.test.js
node --check functions-admin/executive-signature-versions.js
node --check functions-admin/assessment-persistence-service.js
node --check functions-admin/index.js
```

```sh
firebase emulators:exec --config firebase.phase1-emulator.json --only auth,firestore --project the-untaught-lessons "node tests/member-account-rules.behavior.test.js && node tests/organization-console-rules.behavior.test.js && node tests/readiness-assessment-account.test.js && node tests/customer-program-platform-rules.behavior.test.js && node tests/customer-program-identity-entitlement.test.js && node tests/customer-program-callable-auth.test.js && node tests/customer-program-assessment-persistence.test.js"
```

## Gate decision

Pass. Phase 4 may begin with local migration tooling, synthetic dry runs, backup/restore rehearsal design, and reconciliation development. Production data access, production export, production backfill, deployment, and source mutation remain locked until the Phase 4 prerequisites and explicit production authorization are satisfied.
