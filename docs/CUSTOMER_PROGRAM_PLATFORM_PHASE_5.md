# Phase 5 — Read-Only Customers Console

Last updated: 2026-10-04
Scope completed: local/emulator read service, callable authorization, admin console UI behind a feature flag, and direct production-data reconciliation
Production execution: indexes and Phase 4 data exist; Phase 5 callables/UI release and flag enablement have not occurred

## Outcome

Phase 5 adds the first UI surface in this plan: a cross-program, read-only Customers directory in the admin console. It is additive and read-only. No TSA, entitlement, or ES write path is touched. It is reachable only when a `platformFeatureFlags/customersConsole` document has `enabled == true` (absent or `false` by default, so nothing changes for existing admin users until the flag is explicitly turned on by a trusted operator with Firestore access), and only staff with an active `platform_staff` role of `platform_owner`, `customer_support`, or `privacy_data_admin` can call the underlying service. This mirrors `canReadCustomerIdentity()` in `firestore.rules`, the same boundary Phase 1 already defined for reading `customers` documents directly.

Phase 4 has passed and production contains 55 backfilled canonical customers. The service module was exercised read-only against that data and reconciled successfully after the required composite indexes were deployed. The Phase 5 callable exports are absent from the deployed-functions inventory, the feature flag remains off, and no live administrator has received this console.

## Required UI/data states (implementation plan, Phase 5)

| State | How it is produced |
| --- | --- |
| Identity | Overview tab from the canonical `customers` document |
| Participation | Programs tab from `enrollments` where `customerId == X` |
| Missing data | Empty Programs/Assessments lists render an explicit empty message, not a blank table |
| Migrated | `isMigrated` is `true` when the customer carries a `migrationRunId` stamped by the Phase 4 backfill |
| Duplicate | `hasOpenDuplicate` is computed server-side from open `duplicateCandidates` referencing the customer; the client never reads that collection directly |
| Deletion / restricted | `accountStatus` badge surfaces `active`, `restricted`, `archived`, `deletionPending` |
| Empty | Zero directory rows renders an explicit empty state, not a loading spinner |
| Error | Callable failures render a retry-capable error state with the server message |
| Responsive | The directory table scrolls horizontally in its own container below the admin console's existing breakpoint, rather than widening the page |
| Accessible | Semantic `<table>` markup, row buttons with accessible names, `aria-live` status regions for load/error state, keyboard-operable detail drawer |

Consent & privacy and Audit are additional detail tabs beyond the plan's minimum list. They exist because Phase 0's role matrix already restricts both collections to `platform_owner`/`privacy_data_admin`; `customer_support` sees an explicit "restricted" state on those two tabs rather than the tabs being hidden, which doubles as the UI's restricted-state evidence without inventing a synthetic example.

## Read contract

`functions-admin/customer-program-service.js` adds two read-only functions, used only by server-side callables (never exposed as direct client Firestore queries):

- `listCustomerDirectory({ search, pageSize, cursorCustomerId })` — bounded to 1–100 rows (default 25), cursor-paginated by re-fetching the cursor document and calling Firestore `startAfter(docSnapshot)`. An exact email search resolves through `customerEmailClaims/{emailHash}` (O(1), not a scan). A name search uses a single-field prefix range on `searchNameNormalized` already declared in Phase 1. Neither path introduces a new composite index or an unbounded scan.
- `getCustomerDetailForStaff({ customerId, canSeePrivileged })` — reads the customer, up to 50 enrollments, up to 50 entitlements, and up to 50 assessment attempt summaries (never `responseParts`, so raw answers are structurally unreachable from this phase). Consent and audit events are included only when the caller holds `platform_owner` or `privacy_data_admin`.

`functions-admin/index.js` wires these as `getCustomerDirectory` and `getCustomerDetailForStaff`, both gated by `requireCustomerProgramRole(request, ["platform_owner", "customer_support", "privacy_data_admin"])` — the same helper Phase 2's entitlement callables use, extended with the `privacy_data_admin` role already defined in `firestore.rules`.

Duplicate-candidate lookups use Firestore's `array-contains-any` in chunks of 10 scoped to the customer IDs already on the current bounded page, so the check never performs its own unbounded query.

## Implemented controls

- Directory and detail reads are callable-only; `firestore.rules` already denies broader client reads than `canReadCustomerIdentity()` grants, and this phase adds no new client-reachable query surface.
- Every list query is bounded (`limit`) and paginated; there is no code path that can return the full `customers` collection in one call.
- Raw ES responses (`assessmentAttempts/{id}/responseParts`) are never read by either function.
- Consent and audit data are withheld from `customer_support` at the service layer, not just hidden in the UI.
- The admin UI is inert unless `platformFeatureFlags/customersConsole.enabled == true`; `firestore.rules` denies client writes to that document, so only a trusted operator with direct Firestore access can turn it on.
- The directory never shows ES-only customers as TSA participants: `programIds` is read verbatim from the canonical `customers` projection, which Phase 4's migration only ever populates with `tsa` for actual TSA participants.

## Evidence

| Evidence | Result |
| --- | --- |
| `functions-admin/customer-program-service.js` | `listCustomerDirectory`, `getCustomerDetailForStaff` |
| `functions-admin/index.js` | `getCustomerDirectory`, `getCustomerDetailForStaff` callables |
| `tests/customer-program-phase5-directory.test.js` | Unauthenticated/under-privileged rejection, bounded pagination (full page returns a cursor, remainder page does not), exact-email resolution, migrated flag, open-duplicate flag, role-gated consent/audit restriction, not-found handling, and a direct assertion that no response payload ever contains raw answer content |
| Static repository sweep | 71 pass, 11 emulator-only skips, 1 pre-existing `typography-system.test.js` baseline failure (unchanged from Phase 4) |
| Firebase emulator regression | `customer-program-platform-contract`, `customer-program-platform-rules.behavior`, `member-account-rules.behavior`, `organization-console-rules.behavior`, `customer-program-identity-entitlement`, `customer-program-callable-auth`, `customer-program-assessment-persistence`, `customer-program-migration`, and the new `customer-program-phase5-directory` suites all pass together |

## Still required before Phase 5 can pass

- A performance/cost trace at a meaningful customer volume; the current 55-record production baseline is too small to represent planned scale.
- A reviewed deployment of the current Firestore rules and Phase 5 callables before enabling the UI.
- An accessibility/usability pass with the console turned on for an authorized reviewer.
- An explicit decision on who may toggle `platformFeatureFlags/customersConsole`, recorded in the tracker's required-owners table.

## Local verification commands

```sh
firebase emulators:exec --config firebase.phase1-emulator.json --only auth,firestore --project the-untaught-lessons \
  "node tests/customer-program-phase5-directory.test.js"
```
