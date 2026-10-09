# Customer and Program Platform Schema v1

> **Platform note (2026-10-09):** the platform has moved from Firebase to Supabase. Where this file mentions Firebase, Firestore, Google Apps Script or Node 20 functions, read `docs/SUPABASE_PLATFORM.md` first for the current state and rules; that guide wins on any conflict.


Last updated: 2026-10-04  
Phase: 3 — immutable ES persistence  
Deployment status: Phase 4 migration records and declared composite indexes exist in production; current rules and customer/ES callables remain undeployed  

## Rules of the schema

- IDs are opaque and contain no email addresses or other direct PII.
- Firebase Auth and transactional identity-claim records establish identity; names never do.
- Clients cannot create, update, or delete the collections in this document.
- Trusted server code must validate the field contracts before using the Admin SDK.
- Server timestamps are authoritative.
- Existing TSA collections remain authoritative and unchanged.
- Summary/projection fields can be rebuilt from enrollments, entitlements, and attempts.

Unless marked optional or nullable, fields are required.

## `customers/{customerId}`

| Field | Type | Contract |
| --- | --- | --- |
| `schemaVersion` | integer | `1` |
| `primaryEmail` | string | normalized lowercase; private |
| `emailHash` | string | SHA-256 lowercase hex of normalized email |
| `firstName`, `lastName`, `displayName` | string | bounded profile values |
| `accountStatus` | string | `active`, `restricted`, `archived`, `deletionPending` |
| `programIds` | string array | projection, e.g. `tsa`, `executive-signature` |
| `organizationIds` | string array | projection of current associations |
| `relationships` | string array | rebuildable: `lead`, `customer`, `member`, `alumni` |
| `productSummary` | map | compact rebuildable projection only |
| `searchNameNormalized` | string | bounded lowercase search projection |
| `lastActivityAt`, `createdAt`, `updatedAt` | timestamp | server timestamps |
| `projectionVersion` | integer | summary rebuild version |
| `projectionRebuiltAt` | timestamp/null | last successful rebuild |

## `customerEmailClaims/{emailHash}`

| Field | Type | Contract |
| --- | --- | --- |
| `schemaVersion` | integer | `1` |
| `customerId` | string | canonical customer |
| `emailNormalized` | string | private, normalized lowercase |
| `status` | string | `active`, `releasing`, `historical` |
| `createdAt`, `updatedAt` | timestamp | server timestamps |

The claim and new customer are created in one transaction. The document ID is the SHA-256 hash, not the email.

## `customerAuthLinks/{authUid}`

| Field | Type | Contract |
| --- | --- | --- |
| `schemaVersion` | integer | `1` |
| `customerId` | string | canonical customer |
| `status` | string | `active`, `revoked` |
| `linkedAt`, `updatedAt` | timestamp | server timestamps |
| `linkedBy` | string | trusted actor/service ID |

## `platform_staff/{authUid}`

| Field | Type | Contract |
| --- | --- | --- |
| `schemaVersion` | integer | `1` |
| `role` | string | `platform_owner`, `customer_support`, `tsa_program_lead`, `es_program_lead`, `content_scoring_admin`, `privacy_data_admin`, `read_only_analyst` |
| `status` | string | `active`, `suspended` |
| `rawResponseAccess` | boolean | exceptional ES manager permission; default `false` |
| `updatedAt` | timestamp | server timestamp |

Staff grants are server-written. The existing `authorized_members` admin/owner behavior remains intact for existing TSA functionality.
The stored `*_program_lead` IDs are intentionally distinct from the existing organization-console role IDs. The UI may label them “TSA program manager” and “ES program manager.”

## `programs/{programId}`

Stable IDs: `tsa`, `executive-signature`.

| Field | Type | Contract |
| --- | --- | --- |
| `schemaVersion` | integer | `1` |
| `name` | string | display name |
| `status` | string | `active`, `retired` |
| `workspacePath` | string | safe internal path |
| `updatedAt` | timestamp | server timestamp |

## `assessmentDefinitions/{assessmentId}`

Stable ES IDs: `quick-check`, `full-assessment`.

| Field | Type | Contract |
| --- | --- | --- |
| `schemaVersion` | integer | `1` |
| `programId` | string | `executive-signature` |
| `title` | string | display title |
| `status` | string | `draft`, `live`, `retired` |
| `currentVersionId` | string | published version ID |
| `estimatedMinutes` | integer | bounded positive value |
| `updatedAt` | timestamp | server timestamp |

Public clients may fetch a known definition only when `status == live`; they cannot list definitions.

## `assessmentVersions/{versionId}`

| Field | Type | Contract |
| --- | --- | --- |
| `schemaVersion` | integer | `1` |
| `assessmentId`, `programId` | string | stable parent IDs |
| `version`, `scoringVersion`, `contentVersion` | string | immutable version labels |
| `status` | string | `draft`, `published`, `retired` |
| `questions` | array | bounded immutable question configuration |
| `scoring` | map | immutable scoring configuration |
| `content` | map | immutable result/content snapshot |
| `publishedAt`, `createdAt` | timestamp/null | server timestamps |

Public clients may fetch a known version only when `status == published`; they cannot list versions.

## `enrollments/{enrollmentId}`

| Field | Type | Contract |
| --- | --- | --- |
| `schemaVersion` | integer | `1` |
| `customerId`, `programId` | string | required references |
| `organizationId`, `cohortId` | string/null | optional grouping |
| `status` | string | `invited`, `active`, `completed`, `withdrawn`, `expired`, `revoked` |
| `joinedAt`, `completedAt`, `validUntil` | timestamp/null | server authority |
| `createdAt`, `updatedAt` | timestamp | server timestamps |
| `migrationRunId` | string/null | lineage |

## `entitlements/{entitlementId}`

| Field | Type | Contract |
| --- | --- | --- |
| `schemaVersion` | integer | `1` |
| `customerId`, `programId` | string | required references |
| `assessmentId` | string/null | ES assessment access where applicable |
| `accessType` | string | `free`, `paid`, `comped`, `sponsored` |
| `status` | string | `pending`, `active`, `expired`, `revoked`, `refunded`, `consumed` |
| `sponsorOrganizationId` | string/null | third-party sponsor |
| `reportAvailable` | boolean | report access projection |
| `attemptsCompleted`, `retakesAllowed`, `retakesUsed` | integer | nonnegative counters; Full Assessment capacity is `1 + retakesAllowed` |
| `validFrom`, `validUntil` | timestamp/null | validity |
| `paymentReference` | string/null | opaque processor reference, never card data |
| `createdAt`, `updatedAt` | timestamp | server timestamps |

## `assessmentAttempts/{attemptId}`

| Field | Type | Contract |
| --- | --- | --- |
| `schemaVersion` | integer | `1` |
| `customerId`, `programId`, `assessmentId` | string | required references |
| `versionId`, `formVersion`, `scoringVersion`, `contentVersion` | string | immutable version references |
| `entitlementId`, `enrollmentId`, `organizationId`, `campaignId` | string/null | context references |
| `status` | string | `received`, `in_progress`, `scoring`, `completed`, `abandoned`, `failed`, `deleted` |
| `idempotencyHash` | string | server-derived submission claim reference |
| `startedAt`, `updatedAt`, `completedAt` | timestamp/null | server timestamps |
| `durationSeconds` | integer/null | bounded nonnegative value |
| `overallScore` | number/null | 0–100 |
| `areaScores` | map/null | bounded 0–100 named scores |
| `profileLabel`, `band` | string/null | result summary |
| `responseChecksum`, `resultChecksum` | string/null | lowercase SHA-256 hex |
| `consentEventIds` | string array | versioned consent references |
| `responsePartCount` | integer | required response-part count |
| `source` | map | channel/campaign metadata without uncontrolled PII |
| `createdBy`, `writeVersion` | string/integer | service lineage |
| `migrationRunId` | string/null | migration lineage |

Clients may read their own attempt summary. They cannot write attempts or read raw response parts.

## `assessmentAttempts/{attemptId}/responseParts/{partId}`

| Field | Type | Contract |
| --- | --- | --- |
| `schemaVersion` | integer | `1` |
| `attemptId`, `customerId` | string | parent integrity references |
| `partNumber`, `partCount` | integer | bounded sequence |
| `answers` | array | bounded question ID/value records |
| `scoringInputs` | map | reproducibility inputs |
| `payload` | map/null | reserved bounded content |
| `responseChecksum` | string | part checksum |
| `createdAt` | timestamp | server timestamp |

The three potentially large fields are exempt from indexing. Only platform owners, privacy/data administrators, and explicitly authorized ES managers may read them.

## `consentEvents/{consentEventId}`

| Field | Type | Contract |
| --- | --- | --- |
| `schemaVersion` | integer | `1` |
| `customerId` | string | subject |
| `type` | string | `assessment_processing`, `marketing`, `organization_disclosure`, `research` |
| `noticeVersion` | string | immutable notice version |
| `granted` | boolean | choice |
| `recordedAt` | timestamp | server timestamp |
| `source` | string | bounded channel |

## Operations-only collections

- `duplicateCandidates`: candidate customer IDs, reason codes, status, review due date, resolution, audit references.
- `auditEvents`: append-only redacted action evidence; never raw answers.
- `outboxEvents`: server-only retryable effects with status, attempt count, next-attempt time, correlation ID, and bounded payload/reference.
- `migrationRuns` and `migrationRuns/{runId}/records`: run state, checkpoints, counts, mapping, checksums, exceptions.
- `programAggregates`: server-produced cross-program aggregates for authorized staff/analysts.
- `organizations/{organizationId}/assessment_aggregates`: server-produced, minimum-group-suppressed ES aggregates for authorized organization representatives.

## `serviceRequests/{requestHash}`

Trusted-service idempotency receipt. The document ID is SHA-256 of the operation name plus the caller-supplied idempotency key; the raw key is never stored.

| Field | Type | Contract |
| --- | --- | --- |
| `schemaVersion` | integer | `1` |
| `operation` | string | trusted operation name |
| `status` | string | `completed` in Phase 2 |
| `result` | map | bounded stable response identifiers/status; no raw email or assessment response |
| `createdAt`, `completedAt` | timestamp | server timestamps |

Clients cannot read or write these receipts.

## Phase 2 trusted service contracts

`functions-admin/customer-program-service.js` provides the trusted transactional boundary:

- `resolveCustomerIdentity`: resolves verified Auth UID first, otherwise exact normalized email; atomically creates the customer, email claim, Auth link, audit event, and idempotency receipt when needed.
- `changeCustomerEmail`: requires the active Auth link, reserves the new verified-email claim before marking the prior claim historical, and sends claimed addresses to manual review.
- `grantEntitlement`: validates program, assessment, funding type, sponsor/payment requirements, account state, retake allowance, and reason; creates one entitlement per idempotency key and updates rebuildable customer projections.
- `changeEntitlementStatus`: enforces explicit lifecycle transitions and writes an append-only audit event.

Auth/email conflicts never merge automatically. They create deterministic `duplicateCandidates` records with a five-day review target and leave both authoritative links unchanged. Audit records contain email/Auth hashes, not raw addresses or tokens.

The existing public readiness-completion compatibility path now creates or reuses the canonical identity and one Quick Check or Full Assessment entitlement while continuing to write its legacy `users.products.readinessAssessment` summary. It never creates or changes `authorized_members`.

## Phase 3 immutable persistence contract

`functions-admin/assessment-persistence-service.js` owns the completion transaction. `functions-admin/executive-signature-versions.js` is the deployable server registry for the two locked v1 assessment/scoring configurations; an automated parity test compares its question IDs, areas, directions, order, and count with the browser's `forms.js` registry.

One successful transaction creates or updates all of the following:

- one immutable completed `assessmentAttempts` summary;
- one 20-answer response part for Quick Check or two 20-answer parts for Full Assessment;
- assessment-processing consent and optional marketing consent as separate immutable events;
- the published assessment definition/version snapshot when first encountered;
- entitlement usage, report availability, and Full Assessment consumption state;
- the rebuildable `customers.productSummary.executiveSignature` latest-result projection;
- a redacted audit event with response/result checksums but no answers;
- an analytics outbox event, plus a report-generation event for Full Assessment; and
- a hashed idempotency receipt containing the stable response.

Server scoring is authoritative. The client supplies answer values, locked form version, shuffled item order, timing, consent version, and a non-PII submission ID. The server rejects unknown/missing answers, invalid scales/order, mismatched form/assessment/entitlement, missing consent, inactive or expired access, and exhausted Full Assessment capacity before writing.

Response and result checksums use deterministic key ordering. A score can be reproduced from the stored version snapshot, ordered response parts, and scoring inputs. The compatibility `users.products.readinessAssessment` summary is written only from the server result and includes the authoritative attempt ID/checksum.

Quick Check access is reusable. Full Assessment permits one completion plus `retakesAllowed`; once capacity is reached the entitlement becomes `consumed`, while `reportAvailable` remains true. Each admin-granted retake is a new immutable attempt and never overwrites the earlier result.

### `outboxEvents/{eventId}` Phase 3 shape

| Field | Type | Contract |
| --- | --- | --- |
| `schemaVersion` | integer | `1` |
| `eventType` | string | `assessment.analytics_projection` or `assessment.report_generation` |
| `aggregateType` | string | `assessment_completed` |
| `status` | string | `pending`, later processor states are `processing`, `completed`, `retry`, `dead_letter` |
| `attemptCount` | integer | starts at `0` |
| `nextAttemptAt` | timestamp | server-controlled retry eligibility |
| `correlationId` | string | hashed service-request ID |
| `payload` | map | attempt/customer/assessment IDs only; no answers or email |
| `createdAt`, `updatedAt` | timestamp | server timestamps |

Phase 3 persists retryable work but does not send email, generate a report file, or call an external CRM inside the completion transaction. Consumers and operational retry/dead-letter handling must be connected and verified before production release.

## Phase 4 migration lineage

Migration-created `customers`, `customerEmailClaims`, `customerAuthLinks`, and `enrollments` may carry nullable `migrationRunId`, `migrationVersion`, and `migrationChecksum` fields. They are provenance only and never grant entitlement by themselves.

`migrationRuns/{runId}` stores the version, source/plan checksums, snapshot ID, mode, status, bounded checkpoint, planned counts, outcome counts, timestamps, reconciliation summary, and restore-drill summary. `migrationRuns/{runId}/records/{recordId}` stores only hashed source/email/Auth references, target IDs, source/target checksums, warnings/reason codes, and `applied`, `skipped_existing`, `exception`, or `quarantined` status. It contains no raw assessment answers and no raw email.

Legacy TSA source collections remain authoritative and immutable during backfill. A planned row reconciles only when its targets match, or when a named per-record exception accounts for it. Replaying a completed checkpoint cannot create duplicate records.

## Query and index manifest

`firestore.indexes.json` is the exact Phase 1 manifest. It covers bounded customer, enrollment, entitlement, attempt, consent, duplicate, audit, and outbox queries and disables indexes for raw response payloads.

## Current non-goals

- No production release of the customer/ES callables, current repository rules, Phase 5 Customers UI, or Phase 6 ES UI. Phase 4's additive production backfill and the composite-index deployment are complete.
- No feature-flag enablement for the Customers or ES admin workspaces.
- No member workspace/navigation change; the assessment only adds its required persistence payload and save-error notice.
- No change to TSA authority or TSA collection shapes.
- No automatic identity merge or destructive duplicate cleanup.
- No production outbox consumer or external report/email/CRM delivery.
