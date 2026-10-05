# Customer and Program Platform — Phase 2 Evidence

Date: 2026-10-03  
Status: Passed  
Environment: Local Firebase Auth and Firestore emulators only  
Production impact: None; functions, rules, indexes, data, and hosting were not deployed

## Outcome

Phase 2 implements the trusted identity and entitlement service for TSA, Executive Signature, and future programs. It creates one canonical customer through transactional Auth/email claims, isolates conflicts for manual review, supports verified email changes, validates and manages entitlements, records append-only audits, and makes every mutation idempotent.

The service is additive. Existing TSA authorization, progress, rewards, credentials, cohorts, and organization records remain authoritative and unchanged.

## Implemented artifacts

| Artifact | Purpose |
| --- | --- |
| `functions-admin/customer-program-service.js` | Transactional identity, email-change, entitlement, lifecycle, audit, duplicate, and idempotency service |
| `functions-admin/index.js` | Authenticated callable boundaries and readiness-completion compatibility integration |
| `firestore.rules` | Explicit client denial for trusted-service idempotency receipts |
| `docs/CUSTOMER_PROGRAM_PLATFORM_SCHEMA_V1.md` | Phase 2 service and `serviceRequests` contract |
| `tests/customer-program-phase2-contract.test.js` | Static service/callable/rules boundary checks |
| `tests/customer-program-identity-entitlement.test.js` | Emulator concurrency, identity, duplicate, email-change, entitlement, audit, and TSA-isolation checks |
| `tests/customer-program-callable-auth.test.js` | Emulator verification of participant, analyst, TSA-lead, support, and bootstrap-owner callable authorization |

## Callable boundaries

| Callable | Authorization | Result |
| --- | --- | --- |
| `resolveMyCustomerIdentity` | Verified Firebase Auth account | Resolves/creates only the caller's canonical Auth/email identity |
| `changeMyCustomerEmail` | Verified Firebase Auth account controlling the new email plus existing active Auth link | Atomically reserves new claim and retires the old claim |
| `grantCustomerEntitlement` | Platform owner, customer support, or ES program lead | Validated, reasoned, audited entitlement grant |
| `changeCustomerEntitlementStatus` | Platform owner, customer support, or ES program lead | Validated, reasoned, audited lifecycle transition |

The bootstrap owner retains platform-owner authority. Browser clients still cannot write the underlying collections directly.

## Verified invariants

- Two simultaneous first-touch requests for the same exact identity converge on one canonical customer.
- Normalization is trim plus lowercase; the claim ID is SHA-256 of the normalized email.
- Similar names with different emails create different customers.
- An Auth link and email claim resolving to different customers are not merged; a deterministic duplicate candidate is opened.
- A verified email change reserves the new claim before marking the previous claim historical.
- Replaying an identity, entitlement, email-change, or status request with the same idempotency key returns the stored result.
- Concurrent entitlement retries create one entitlement.
- `free`, `paid`, `comped`, and `sponsored` are entitlement attributes, not person types.
- Sponsored access requires a sponsor organization; paid access requires an opaque payment reference.
- Archived or deletion-pending customers cannot receive new entitlements.
- Invalid lifecycle transitions are rejected.
- Audit events contain hashes instead of raw email addresses.
- ES identity/access does not create or mutate `authorized_members`.
- A person already in TSA receives the same canonical customer plus a separate ES entitlement; their TSA record is unchanged.

## Readiness compatibility

The existing `recordReadinessCompletion` callable continues writing the legacy readiness summary required by the current app. In the same workflow it now resolves canonical identity and creates/reuses:

- `free` Quick Check access, or
- `comped` Full Assessment access while payment is not live.

The Phase 2 entitlement is stable across retries. Quick Check reuse is governed by the future Phase 3 attempt service; its entitlement is not automatically consumed.

## Verification results

The complete emulator gate passed with exit code 0:

1. Existing member-account Firestore behavior
2. Existing organization-console Firestore behavior
3. Existing readiness-account behavior and TSA/ES coexistence
4. Phase 1 customer-program authorization boundaries
5. Phase 2 identity and entitlement service behavior
6. Phase 2 callable role authorization

The repository contains 78 test files. In the plain non-emulator sweep, 77 exit successfully (including six intentional emulator skips) and one known pre-existing typography test fails on the readiness prototype's `.ra-data-rule` border. All six emulator-dependent suites passed in explicit emulator runs. The typography exception was present in the Phase 0 baseline and is unrelated to Phase 2.

The Firestore emulator may log transaction lock timeouts during the intentional concurrency collision tests. The Admin SDK retries those transactions; the test passes only after both calls converge and the wrapper exits with code 0.

## How to reproduce

```sh
node tests/customer-program-phase2-contract.test.js
node --check functions-admin/customer-program-service.js
node --check functions-admin/index.js
```

```sh
firebase emulators:exec --config firebase.phase1-emulator.json --only auth,firestore --project the-untaught-lessons "node tests/member-account-rules.behavior.test.js && node tests/organization-console-rules.behavior.test.js && node tests/readiness-assessment-account.test.js && node tests/customer-program-platform-rules.behavior.test.js && node tests/customer-program-identity-entitlement.test.js && node tests/customer-program-callable-auth.test.js"
```

## Gate decision

Pass. Phase 3 (immutable ES persistence) may begin in local emulators. This does not authorize function deployment, rules/index deployment, production data access, backfill, admin-console release, or TSA navigation/data migration.
