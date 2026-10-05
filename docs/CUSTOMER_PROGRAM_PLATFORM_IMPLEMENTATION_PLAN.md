# Customer and Program Platform Implementation Plan

Last updated: 2026-10-03  
Status: Phases 0–4 passed; Phases 5–6 built locally and still gated  
Scope: Cross-program customer data, Executive Signature (ES), TSA compatibility, admin console, and member workspace switching

## Purpose

This is the implementation source of truth for introducing a cross-program customer model and Executive Signature without breaking the existing Think, Speak, Act (TSA) program.

The plan was reviewed from three perspectives: database administration, UX design, and product management. All three reviews approved the direction with conditions. Those conditions are incorporated here and must be resolved through Phase 0 before production persistence is built.

Use `docs/CUSTOMER_PROGRAM_PLATFORM_TRACKER.md` to execute and record progress. `WEBSITE_CONTEXT.md` remains the repository entry point.

## Approved product decisions

1. Use **Executive Signature (ES)** as the program name, with **Quick Check** and **Full Assessment** as its two assessments.
2. Create one cross-program **Customers** directory in the admin console.
3. Match automatically only through a verified Firebase Auth identity or exact normalized email. Send possible duplicates to administrator review.
4. Preserve every assessment attempt. Retakes never overwrite history.
5. Keep raw answers private to authorized UTL administrators. Organization clients receive completion information and sufficiently large aggregates unless a separately approved, versioned consent permits more.
6. Treat Quick Check participants as free participants, not TSA members.
7. Keep TSA's live collections and behavior working while the new model is introduced additively.

## Canonical vocabulary

```text
Program
├── Think, Speak, Act (TSA)
│   ├── Learning activities
│   ├── Diagnostic and checkpoint
│   └── Credentials
└── Executive Signature (ES)
    ├── Quick Check assessment
    └── Full Assessment
```

Use **assessment** for Quick Check and Full Assessment in the UI. Use **entitlement** for the database record that determines access, funding, expiration, reports, and retakes.

## Customer classification

Do not store one ambiguous relationship label. Keep these dimensions independent:

### Account status

- `active`
- `restricted`
- `archived`
- `deletionPending`

### Access or funding type

- `free`: no payment and no third-party sponsor is required; normally the ES Quick Check.
- `paid`: the participant personally purchased the entitlement.
- `comped`: UTL deliberately granted an ordinarily paid entitlement at no charge.
- `sponsored`: an organization or another third party funded or allocated the entitlement.

These values describe how a specific entitlement was obtained, not the person's identity. One customer can have a free Quick Check entitlement, a sponsored TSA enrollment, and a comped ES Full Assessment at the same time.

### Program status, per enrollment

- `invited`
- `active`
- `completed`
- `withdrawn`
- `expired`
- `revoked`

### Roles

- Participant
- Organization representative
- UTL staff roles defined in the role matrix

Relationship labels such as lead, customer, member, and alumni should be derived from entitlements and enrollments rather than manually maintained as one mutually exclusive status.

## Target data architecture

Use opaque IDs. Do not use email addresses in document paths.

```text
customers/{customerId}
customerEmailClaims/{emailHash}
customerAuthLinks/{authUid}
programs/{programId}
enrollments/{enrollmentId}
entitlements/{entitlementId}
assessmentAttempts/{attemptId}
assessmentAttempts/{attemptId}/responseParts/{partId}
consentEvents/{consentEventId}
duplicateCandidates/{candidateId}
auditEvents/{auditEventId}
outboxEvents/{eventId}
migrationRuns/{runId}
migrationRuns/{runId}/records/{recordId}
```

A single response document may replace `responseParts` only after a size test proves that every supported form remains safely below Firestore's document limit with operating headroom.

### Identity rules

- Create the normalized-email claim and customer in one Firestore transaction.
- A Firebase Auth UID can link to only one active canonical customer.
- Exact normalized email may connect an existing record only under the approved identity policy.
- Different emails never merge automatically.
- Names and organizations never trigger automatic merging.
- Linking, unlinking, and merging are audited.
- Merge reversal must be designed before merge actions are enabled.

### Authority during transition

| Datum | Transitional authority | Intended final authority |
| --- | --- | --- |
| Authentication identity | Firebase Auth | Firebase Auth |
| Customer identity/profile | Existing `users` plus new customer projection | `customers` |
| TSA access | `authorized_members` | Unchanged until a separately approved migration |
| TSA progress, rewards, credentials | Existing TSA records | Existing TSA records during this project |
| ES access | `entitlements` | `entitlements` |
| ES result | `assessmentAttempts` | `assessmentAttempts` |
| ES raw responses | Attempt response parts | Attempt response parts |
| Customer product summary | Rebuildable projection | Rebuildable projection, never analytical authority |

Phase 0 must expand this into a field-level source-of-truth matrix.

### Assessment-write contract

Every submission must have:

- A server-recognized idempotency key
- Immutable form and scoring versions
- Server timestamps
- Response and result checksums
- Explicit states such as `received`, `scoring`, `completed`, and `failed`
- A transactional Firestore core
- A durable outbox for email, report generation, analytics, and other external effects

A retry returns the original attempt. A deliberate retake receives a new idempotency key and attempt.

## Target admin console

```text
Admin Console
├── Overview
├── Customers
├── Programs
│   ├── Think, Speak, Act (TSA)
│   └── Executive Signature (ES)
├── Organizations
├── Communications
├── Content
└── Operations
```

### Customers

One row per person. Customer detail tabs:

- Overview
- Programs
- Assessments
- Activity
- Consent & privacy
- Audit

Keep people, enrollments/entitlements, and attempts as distinct concepts and counts.

### TSA workspace

Relocate existing capabilities without redesigning them in the same release:

- Overview
- Learners
- Cohorts
- Progress
- Engagement
- Assessments
- Rewards
- Credentials

The current TSA section IDs, queries, writers, and behavior remain intact during early phases.

### ES workspace

```text
Overview | Participants | Attempts | Configuration | Data governance
```

- Configuration: Assessments, versions, scoring
- Data governance: Consent, retention, exports
- Participants: one row per person
- Attempts: one row per attempt

### Transitional console

Before the final navigation migration:

```text
Program | Student Progress | Executive Signature (ES)
Customers | Member Access | Rewards | Communications
Content Data | Admin Tools
```

Customers is initially read-only. Member Access remains the authority for legacy TSA access until the plan explicitly changes it.

## Member workspace and profile menu

The profile menu switches workspaces; it does not reproduce every program's navigation.

```text
Identity
Current workspace
Switch workspace, when more than one is available
Account & programs
Organization console, when authorized
Admin console, when authorized
Log out
```

Workspace landing order:

1. Authorized deep link
2. Last successfully visited authorized workspace
3. The only authorized workspace
4. Workspace chooser when several exist and no history exists
5. Account/access-help page when no active entitlement exists

TSA retains Learning Journey, My Results, Toolkit, and Mastery Points. ES uses Overview, Assessments, and Results. TSA rewards and MP never appear in ES.

## TSA protection rules

1. Do not rename or delete existing TSA collections during this project.
2. Do not change TSA progress, reward, certificate, or organization writers in ES backend phases.
3. Reference TSA records from the new model; do not replace their IDs prematurely.
4. Every migration is dry-run capable, idempotent, restartable, and reconciled.
5. All new UI and writes are independently feature-flagged.
6. ES-only customers never appear in TSA Student Progress without a TSA enrollment.
7. ES entitlement never grants TSA authorization.
8. A TSA member taking ES retains the same Auth UID and TSA access.
9. Relocating TSA navigation and changing TSA data sources are separate releases.
10. TSA remains authoritative until shadow verification passes.

## Delivery phases

### Phase 0 — Product, data, UX, privacy, and operating contract

Approve the entitlement matrix, participant journeys, role/permission matrix, lifecycle rules, identity/merge policy, sponsor visibility, retention/deletion rules, source-of-truth matrix, route/capability inventory, query/index plan, TSA baseline, KPIs, quantitative release thresholds, backup/restore design, and rollback responsibilities.

### Phase 1 — Emulator data architecture and security

Implement new collections, transactional identity claims, indexes, and security rules in emulators only. Existing TSA tests must continue to pass.

### Phase 2 — Identity and entitlement service

Implement canonical customer resolution, Auth links, duplicate candidates, entitlements, auditing, and idempotent service contracts.

### Phase 3 — Immutable ES persistence

Persist versioned attempts, response parts, consent references, reproducible scoring, projections, and outbox events. Keep any legacy ES summary as a temporary compatibility projection.

### Phase 4 — Backfill and reconciliation

Dry-run and then backfill customers and TSA links without modifying TSA sources. Every migrated record receives a migration run ID; all exceptions enter a managed queue. Restore must be rehearsed first.

### Phase 5 — Read-only Customers console

Release the cross-program directory behind a feature flag. Verify identity, participation, missing-data, migrated, duplicate, deletion, restricted, empty, error, responsive, and accessible states.

### Phase 6 — Connected ES admin workspace

Connect overview, participants, attempts, configuration, scoring, consent, retention, and exports. Raw-response access must be authorized and audited.

### Phase 7 — Entitlement-aware member workspaces

Release deterministic routing, ES pages, Account & programs, and the workspace switcher. Preserve the TSA-only experience.

### Phase 8 — TSA shadow verification

Compare new projections with legacy TSA sources while all TSA screens continue using legacy sources. Resolve or formally approve every mismatch.

### Phase 9 — Final admin information architecture

Relocate existing TSA capabilities into Programs → TSA and move organization/operations areas. Preserve legacy deep links and backend behavior.

### Phase 10 — Controlled production release

Deploy indexes, backward-compatible rules, functions, migration, flags, internal access, limited cohorts, and general availability in that order. Run written go/no-go decisions and observation windows.

### Phase 11 — Stabilization and legacy retirement

Monitor data integrity, privacy queues, support, performance, and TSA stability. Remove compatibility fields only after a dependency scan proves zero consumers.

## Proposed release thresholds

Phase 0 must approve or amend these values:

| Measure | Proposed threshold |
| --- | ---: |
| Cross-customer or cross-organization exposure | 0 |
| Incorrect TSA access changes | 0 |
| Data-loss incidents | 0 |
| Identity/Auth critical parity | 100% |
| Migration reconciliation | 100% or named, approved exceptions |
| Assessment write success | At least 99.9% |
| Retry-created duplicate attempts | 0 |
| Reproducible completed scores | 100% |
| TSA critical-flow tests | 100% pass |
| TSA page p95 performance regression | No more than 20% |
| Critical/serious accessibility defects | 0 |
| Open Sev 1 defects at release | 0 |
| Open Sev 2 defects in released scope | 0 unless formally accepted outside that scope |

## Immediate rollback triggers

- Cross-customer or cross-organization exposure
- Incorrect TSA access grant or revocation
- Data loss
- Non-reproducible scoring
- Duplicate attempts caused by retries
- TSA login or progression degradation beyond the approved threshold
- Unexplained reconciliation drift

## Required accountability

| Workstream | Accountable role |
| --- | --- |
| Product contracts and acceptance | Product lead |
| Schema, migration, and reconciliation | Database/engineering lead |
| Admin and member UX | UX lead |
| Security, privacy, and retention | Security/privacy owner |
| TSA regression protection | TSA product owner |
| Release and rollback | Engineering/release owner |
| Support readiness | Operations/support lead |

One person may hold several roles, but the tracker must name one accountable individual for each role before its gate can pass.

## Gate rule

A phase is not complete when its code is complete. It passes only when all mandatory evidence is attached to the tracker and the named approvers record a go decision. Any unresolved privacy exposure, data-loss risk, incorrect access behavior, or TSA regression fails the gate.
