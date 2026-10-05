# Phase 6 — Connected ES Admin Workspace

Last updated: 2026-10-04
Scope completed: local/emulator read service, callable authorization, admin console UI behind a feature flag, one narrowly-scoped audited raw-response reveal, and direct production-data reconciliation
Production execution: indexes and Phase 4 data exist; Phase 6 callables/UI release and flag enablement have not occurred

## Outcome

Phase 6 connects an "Executive Signature" admin workspace: Overview, Participants, Attempts, Configuration, and Data governance. It is additive and read-only, with exactly one exception — a single-attempt, explicitly confirmed, fully audited raw-response reveal. No TSA, entitlement, enrollment, or ES-content write path is touched; no bulk export of raw responses exists anywhere in this phase. It is reachable only when a `platformFeatureFlags/esWorkspace` document has `enabled == true` (absent or `false` by default, so nothing changes for existing admin users until the flag is explicitly turned on by a trusted operator with Firestore access).

Ordinary reads (participants, attempts, configuration, consent) are gated to the role set `canReadEsOperations()` already defines in `firestore.rules`: `platform_owner`, `customer_support`, `es_program_lead`, `privacy_data_admin`. The raw-response reveal uses a strictly narrower boundary mirroring `canReadRawEsResponses()`: `platform_owner`, `privacy_data_admin`, or an `es_program_lead` whose own `platform_staff` document carries `rawResponseAccess == true`, read server-side — never a client-supplied flag.

Phase 4 has passed. Direct read-only service verification against production correctly found zero ES entitlements, participants, and attempts because the backfill covered TSA membership only. The Phase 6 callable exports are absent from the deployed-functions inventory, the feature flag remains off, and no live administrator has received the workspace or raw-response reveal.

## Required controls (implementation plan, Phase 6)

| Control | How it is produced |
| --- | --- |
| Overview | Static description of the workspace plus a reminder that raw answers are never shown automatically |
| Participants | One row per customer with an `executive-signature` program entitlement, from the canonical `customers` projection |
| Attempts | One row per `assessmentAttempts` document: assessment, status, result label/score, completion date — never response content |
| Configuration | Read-only summary of `assessmentDefinitions` and `assessmentVersions` — titles, statuses, version labels, and a question *count*, never the question/scoring/content payload itself |
| Data governance — consent | `consentEvents` listing, restricted to `platform_owner`/`privacy_data_admin` at the service layer; `customer_support`/`es_program_lead` see an explicit restricted state, not a hidden tab |
| Data governance — retention | A static, versioned summary of the Phase 0 retention matrix (P0-10), shown to every ES-operations role |
| Data governance — exports | Intentionally absent. See "Deliberately left out of scope" below |
| Raw-response reveal | A per-attempt button that opens a confirm panel requiring a typed reason; only on explicit confirm does it call `revealAssessmentResponse` and render the actual answers. It never runs on attempt-detail open |

## Read contract

`functions-admin/customer-program-service.js` adds five functions, used only by server-side callables:

- `listEsParticipants({ pageSize, cursorCustomerId })` — bounded to 1–100 rows (default 25), cursor-paginated using the same `customers` collection and `directoryRow`/`openDuplicateCustomerIdSet` helpers Phase 5 built, filtered to `programIds array-contains "executive-signature"` and ordered by `lastActivityAt desc`. This reuses the composite index `firestore.indexes.json` already declares for that exact filter/order pair; no new index was needed.
- `listEsAttempts({ pageSize, cursorAttemptId })` — bounded/paginated, ordered by `completedAt desc`. Rows carry `attemptId`, `customerId`, `assessmentId`, `status`, `resultLabel` (from `profileLabel`), `band`, `resultScore` (from `overallScore`), and timestamps. `responseParts` is never queried.
- `getEsConfiguration()` — reads up to 100 `assessmentDefinitions` and up to 100 `assessmentVersions` documents and returns summaries only; `questions`, `scoring`, and `content` are deliberately excluded (a `questionCount` is included instead) so Configuration cannot become a second path for bulk-reading assessment content.
- `getEsDataGovernance({ pageSize, cursorEventId, canSeePrivileged })` — bounded/paginated `consentEvents` listing, included only when the caller holds `platform_owner` or `privacy_data_admin`; otherwise returns an explicit `{ restricted: true, reason }` object, mirroring Phase 5's `getCustomerDetailForStaff` consent/audit pattern. The static retention summary is always included regardless of role.
- `revealAssessmentResponse({ attemptId, reason })` — the sensitive function. Requires a non-empty `reason` (mirroring the `reason` field pattern in `grantEntitlement`/`changeEntitlementStatus`), reads the attempt and its bounded `responseParts` subcollection, writes an `auditEvents` record (`action: "raw_response_revealed"`, actor, `subjectCustomerId`, `targetId: attemptId`, `assessmentId`, `reason`, `partCount` — never the answer content), and only then returns the response parts to the caller.

`functions-admin/index.js` wires these as `listEsParticipants`, `listEsAttempts`, `getEsConfiguration`, and `getEsDataGovernance`, each gated by `requireCustomerProgramRole(request, ["platform_owner", "customer_support", "es_program_lead", "privacy_data_admin"])`. `revealAssessmentResponse` is gated by a new `requireRawResponseAccess(request)` helper that mirrors `canReadRawEsResponses()`: it reads the caller's own `platform_staff` document server-side and only admits `platform_owner`, `privacy_data_admin`, or an `es_program_lead` whose stored `rawResponseAccess` field is `true`. A plain `customer_support` or plain `es_program_lead` caller is rejected with `permission-denied` before any Firestore read of the attempt happens.

## Implemented controls

- Every list query is bounded (`limit`) and cursor-paginated; no code path can return an entire collection in one call.
- `listEsAttempts` and `listEsParticipants` never read or reference `responseParts`.
- `getEsConfiguration` never returns question/scoring/content payloads, only summaries.
- Consent data is withheld from `customer_support`/`es_program_lead` at the service layer, not just hidden in the UI; the retention summary itself carries no PII and is always visible to ES-operations roles.
- `revealAssessmentResponse` authorizes against the caller's own server-read `platform_staff` document — a client cannot claim `rawResponseAccess` for itself.
- Every reveal writes an audit event before returning data to the caller, and that audit event is verified (by test) to never contain the raw answer content.
- The admin UI's reveal action is a distinct, two-step user gesture (open panel → type a reason → confirm) that only exists on the Attempts tab; nothing in Overview, Participants, Configuration, or Data governance can trigger it.
- The whole tab is inert unless `platformFeatureFlags/esWorkspace.enabled == true`; `firestore.rules`' existing `platformFeatureFlags/{flagId}` match block already covers this new flag ID with no rule change required, and denies all client writes to it.
- No new `firestore.rules` match blocks were needed: `assessmentDefinitions`, `assessmentVersions`, `entitlements`, `assessmentAttempts`, and `responseParts` already carry the exact `canReadEsOperations()`/`canReadRawEsResponses()` boundaries this phase relies on, verified by rereading the file rather than assumed.

## Deliberately left out of scope

- **Bulk/CSV export of raw ES responses.** The implementation plan's Data governance column lists "exports," and P0-09's role matrix allows an "exceptional approved export" for very specific roles — but this phase implements only the single-attempt, reason-required, audited reveal the task scoped. A bulk export is a materially different risk surface (more records leave the system in one action, harder to bound/audit per-record) and was not built. If a bulk export is wanted later, it should get its own phase-gate treatment, not be folded into this reveal action.
- **Editing assessment content/scoring from Configuration.** The tab is read-only by design; P0-09 reserves content edits to `content_scoring_admin`/`platform_owner` through a separate workflow this phase does not build.
- **An Overview counts/KPI dashboard.** Rather than add a new aggregate-count read path (and the cost/consistency questions that come with it), Overview stays a static orientation panel; Participants and Attempts are where real counts are visible once loaded.

## Evidence

| Evidence | Result |
| --- | --- |
| `functions-admin/customer-program-service.js` | `listEsParticipants`, `listEsAttempts`, `getEsConfiguration`, `getEsDataGovernance`, `revealAssessmentResponse` |
| `functions-admin/index.js` | `listEsParticipants`, `listEsAttempts`, `getEsConfiguration`, `getEsDataGovernance`, `revealAssessmentResponse` callables; new `requireRawResponseAccess` helper |
| `tests/customer-program-phase6-es-workspace.test.js` | Unauthenticated rejection on every new callable; role rejection for `read_only_analyst`/`tsa_program_lead`; bounded-pagination invariants for participants and attempts; ES-only scoping; configuration summaries exclude question content; consent restricted for `customer_support`, visible for `privacy_data_admin`; reveal rejected for plain `customer_support` and for an `es_program_lead` without the flag; reveal allowed for a flagged `es_program_lead` and for `privacy_data_admin`; a direct assertion that the written audit event never contains the raw answer content while the reveal response itself does |
| `tests/customer-program-phase6-ui-contract.test.js` | Static, emulator-free: the tab/nav/section markup exists; the flag guard calls `getEsWorkspaceFeatureFlag` before any section renders; opening the reveal panel and rendering the attempts list never call `revealAssessmentResponse`; only the explicit confirm-click handler does, and only after a typed reason; `revealAssessmentResponse` is wired to `requireRawResponseAccess`, not the broader ES operations role check; the service function never scans the attempts collection and its audit write never includes answer content |
| Static repository sweep | 72 pass, 12 emulator-only skips (11 Phase 5 + this phase's `customer-program-phase6-es-workspace.test.js`), 1 pre-existing `typography-system.test.js` baseline failure (unchanged cause: pre-existing `text-transform: uppercase`/positive letter-spacing in `.cs-table th`, introduced by Phase 5, not by this phase) |
| Firebase emulator regression | `customer-program-platform-contract`, `customer-program-platform-rules.behavior`, `member-account-rules.behavior`, `organization-console-rules.behavior`, `customer-program-identity-entitlement`, `customer-program-callable-auth`, `customer-program-assessment-persistence`, `customer-program-migration`, `customer-program-phase5-directory`, and the new `customer-program-phase6-es-workspace` suites all pass together |
| `firestore.rules` | Reread in full; no new match block was required for this phase |

## Still required before Phase 6 can pass

- A performance/cost trace once production has a meaningful ES participant/attempt volume; zero records cannot establish scale behavior.
- A reviewed deployment of the current Firestore rules and Phase 6 callables before enabling the UI.
- An accessibility/usability pass with the console actually turned on for a reviewer, including the reveal confirm flow specifically.
- A recorded decision on who may toggle `platformFeatureFlags/esWorkspace`, and on whether the "exceptional approved export" P0-09 mentions is ever built, and if so, as what kind of action.
- A recorded decision on which named individuals, if any, should carry `rawResponseAccess: true` on their `platform_staff` document — this phase builds the mechanism but does not grant the flag to anyone.

## Local verification commands

```sh
firebase emulators:exec --config firebase.phase1-emulator.json --only auth,firestore --project the-untaught-lessons \
  "node tests/customer-program-phase6-es-workspace.test.js"
node tests/customer-program-phase6-ui-contract.test.js
```
