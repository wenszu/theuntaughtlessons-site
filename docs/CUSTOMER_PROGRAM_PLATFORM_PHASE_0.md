# Phase 0 — Product, Data, UX, Privacy, and Operating Contract

Last updated: 2026-10-03  
Status: Passed on 2026-10-03; approved defaults govern Phase 1  
Parent plan: `docs/CUSTOMER_PROGRAM_PLATFORM_IMPLEMENTATION_PLAN.md`  
Tracker: `docs/CUSTOMER_PROGRAM_PLATFORM_TRACKER.md`

## Gate objective

Phase 0 removes ambiguity before implementation. It defines what the system means, who may do what, which records are authoritative, how the current TSA system is protected, which queries the future UI needs, and which evidence determines success or rollback.

The business owner approved the recommended defaults in this document on 2026-10-03. They are now Phase 1 requirements unless a later decision-log entry explicitly changes one. Passing Phase 0 does not authorize a production deployment; Phase 1 remains emulator-only.

## P0-01 — Product hierarchy and vocabulary

### Approved hierarchy

```text
Program: Think, Speak, Act (TSA)
├── Learning activities
├── Diagnostic assessment
├── Checkpoint assessment
└── Verified credential

Program: Executive Signature (ES)
├── Quick Check assessment
└── Full Assessment
```

### Definitions

| Term | Definition |
| --- | --- |
| Customer | One canonical person known to UTL, whether free, paid, comped, sponsored, active, or historical |
| Program | A coherent UTL offering with its own experience and reporting, currently TSA or ES |
| Assessment | A defined assessment type, such as ES Quick Check or ES Full Assessment |
| Form version | The immutable question/content version answered during an attempt |
| Scoring version | The immutable algorithm/configuration used to calculate a result |
| Enrollment | A person's participation in an ongoing program or cohort |
| Entitlement | The authority to access an offering, report, or retake, including its funding and validity |
| Attempt | One start-to-terminal-state assessment instance; retakes are new attempts |
| Response | Question-level input associated with an attempt |
| Result | The versioned scored output of an attempt |
| Workspace | A participant-facing or role-facing application context: TSA, ES, organization, or admin |

Quick Check and Full Assessment use **assessment** as their primary UI label. “Product” is reserved for commercial discussions and is not an admin navigation level.

## P0-02 — Entitlement matrix

### Access/funding values

| Value | Payer/source | Price meaning | Example |
| --- | --- | --- | --- |
| `free` | No payer | Offering normally costs nothing | ES Quick Check |
| `paid` | Participant | Participant personally purchased access | ES Full Assessment purchase |
| `comped` | UTL | UTL waived an ordinarily payable price | Full Assessment during testing or a service recovery |
| `sponsored` | Third party | Organization/partner bought or allocated access | Employer-sponsored TSA or ES |

These values classify an entitlement, not a customer. A person may hold several entitlement types.

### Recommended entitlement behavior

| Offering | Default entitlement | Start/resume | Results | Report | Retake default |
| --- | --- | --- | --- | --- | --- |
| ES Quick Check | `free`, active | Allowed | Latest and history | Web result; no paid-report implication | Unlimited, each as a new attempt |
| ES Full Assessment, testing | `comped`, active | Allowed | Latest and history | Download when completed | One completed attempt plus admin-granted retakes |
| ES Full Assessment, future direct purchase | `paid`, active | Allowed after confirmed entitlement | Latest and history | Download when completed | One completed attempt; new entitlement required for another unless policy changes |
| ES Full Assessment, organization | `sponsored`, active with sponsor validity | Allowed while active | Participant can see own results | Download according to entitlement | Sponsor contract or admin grant controls retakes |
| TSA individual | `paid` or `comped` plus enrollment | TSA workspace | TSA results | Credential after completion | TSA rules, not ES retake rules |
| TSA organization | `sponsored` plus enrollment | TSA workspace while active | TSA results | Credential after completion | TSA rules |

### Entitlement status

- `pending`
- `active`
- `expired`
- `revoked`
- `refunded`
- `consumed`, only where a future one-use commercial rule explicitly requires it

Revocation or expiration prevents new starts and resumes but does not silently delete prior results. Refund behavior and report retention require commercial/privacy approval.

**Approved 2026-10-03:** use these defaults. Full Assessment includes one completed attempt; another requires a new or administrator-granted entitlement. A completed participant-owned report remains available after entitlement expiration unless an approved refund, legal, or security restriction requires otherwise.

## P0-03 — ES participant journeys

### Quick Check

1. Participant opens the public assessment.
2. Participant reviews purpose, limits, privacy, and separate marketing consent.
3. Participant supplies identity and context fields.
4. The system resolves or creates the customer safely.
5. A free entitlement is recorded.
6. The participant completes the version-pinned assessment.
7. The server persists the attempt, responses, consent reference, scoring inputs, and result.
8. The participant sees the result immediately.
9. The participant verifies their email before accessing the result from another device or later session.
10. A future Full Assessment offer appears inside the ES workspace, not in the identity dropdown.

### Full Assessment

1. The participant receives or purchases an active entitlement.
2. The system verifies identity and entitlement before starting.
3. The participant starts or resumes one version-pinned attempt.
4. Completion creates an immutable result and report entitlement.
5. Latest completed result opens by default; history remains available.
6. A deliberate retake requires an unused retake allowance or a new/admin-granted entitlement.

### Identity and account recommendation

- Starting the public Quick Check may remain possible before authentication.
- Account/customer resolution occurs before the first trusted server persistence.
- Email ownership must be verified before cross-device result access, exports, identity changes, or linking to an existing account.
- Same-browser immediate results do not require waiting for email verification, but the result cannot be claimed from another device until verification.
- In-progress browser recovery duration is proposed at 30 days; server retention of abandoned attempts is governed separately.

### Landing behavior

1. Authorized deep link
2. Last successfully visited authorized workspace
3. Only authorized workspace
4. Workspace chooser when several exist and no safe history exists
5. Account & programs/access-help page when no active access exists

**Approved 2026-10-03:** Quick Check may start before authentication; later/cross-device access requires verified email ownership. In-progress recovery lasts 30 days. Use the approved Full Assessment retake policy above.

## P0-04 — Customer state model

### Stored account status

`active`, `restricted`, `archived`, or `deletionPending`.

### Derived relationships

- `lead`: has only a free participation record
- `customer`: has a paid or comped entitlement
- `member`: has an active ongoing-program enrollment
- `alumni`: has a completed ongoing-program enrollment

These are nonexclusive computed labels. Do not write a single relationship field that can drift from authoritative records.

### Per-program state

Each enrollment independently uses `invited`, `active`, `completed`, `withdrawn`, `expired`, or `revoked`.

### Role state

Participant, organization representative, and UTL staff roles remain independent of customer relationships and program state.

## P0-05 — Identity and duplicate policy

### Automatic resolution

1. A verified Firebase Auth UID resolves through `customerAuthLinks/{uid}`.
2. Otherwise, an exact normalized email resolves through `customerEmailClaims/{sha256(email)}`.
3. Creating the email claim and customer occurs in one transaction.
4. Email and Auth links never grant a program enrollment or entitlement by themselves.

### Never automatic

- Different email addresses
- Similar names
- Same employer or organization
- Same job title or location
- A representative's assertion without verification

### Email changes

- Require control of the current authenticated account and verification of the new email, or a privileged support workflow.
- Reserve the new email claim transactionally before releasing the old claim.
- Retain a restricted, audited historical alias reference where policy permits; do not keep the old address in general logs.

### Duplicate review and merge

- Possible duplicates enter `duplicateCandidates` with reasons and confidence signals.
- Only the privacy/data administrator or platform owner may merge.
- Preview source, target, entitlements, enrollments, attempts, consent, and conflicts before confirmation.
- Preserve immutable attempts and audit history.
- A merge creates a reversible mapping/redirect; it does not immediately destroy the losing record.
- Reversal is allowed only before destructive cleanup and must itself be audited.

### Shared or role-based email addresses

Flag for manual review. Do not assume one shared mailbox equals one person.

**Approved 2026-10-03:** only the platform owner and privacy/data administrator may approve merges. Duplicate candidates have a five-business-day review target.

## P0-06 — Field-level source-of-truth matrix

| Domain/field | Transition authority | Final authority for this project | Writable by |
| --- | --- | --- | --- |
| Auth UID, verified email, provider links | Firebase Auth | Firebase Auth | Auth system/trusted server |
| Canonical name, primary contact email | `users`/Auth plus customer projection | `customers` after cutover gate | Customer for allowed profile fields; trusted server for identity keys |
| Email uniqueness | None today beyond Auth lookup | `customerEmailClaims` | Trusted server transaction only |
| Auth-to-customer link | Implicit UID/email | `customerAuthLinks` | Trusted server only |
| TSA authorization | `authorized_members` | `authorized_members` | Existing admin paths only |
| TSA cohort | `authorized_members.cohort` and `settings/cohorts` organization mapping | Existing TSA records | Existing admin paths only |
| TSA progress | Existing user progress/subcollections | Existing TSA records | Existing TSA paths only |
| TSA rewards | Existing user/reward records | Existing TSA records | Existing TSA paths only |
| TSA credential | `credential_issuance` and `public_credentials` | Existing credential records | Existing trusted functions only |
| Organization definition/access | `organizations` and subcollections | Existing organization records | Existing trusted admin functions |
| ES access/funding/validity | Legacy `users.products.readinessAssessment` summary | `entitlements` | Trusted server/admin workflow only |
| ES form/scoring configuration | Static versioned app files during prototype | Versioned assessment definitions/configuration | Authorized content/scoring admin through trusted process |
| ES attempt state/result | Legacy summary only | `assessmentAttempts` | Trusted server only after submission |
| ES raw responses | Browser only today | Attempt response parts | Trusted server only |
| Consent | Copy/checkbox plus limited legacy relay | `consentEvents`, referenced by attempt | Trusted server from participant action |
| Customer product summary | `users.products` legacy compatibility | `customers.productSummary` projection | Trusted projection/rebuild process |
| Marketing preference | Existing submitted checkbox/relay where available | Versioned consent/preference record | Participant or trusted support process |
| Audit | Existing targeted logs | `auditEvents` plus existing domain audit where retained | Trusted server only |

No new process may write TSA-authoritative fields unless a separately approved tracker item explicitly permits it.

## P0-07 — Schema and data-flow contract

### Stable IDs

- Program IDs: `tsa`, `executive-signature`
- ES assessment IDs: `quick-check`, `full-assessment`
- Customer, enrollment, entitlement, attempt, consent, audit, and migration IDs: opaque, non-PII IDs

### Core invariants

- One active customer per email claim.
- One active customer per Auth UID link.
- Enrollment and entitlement do not imply one another unless a trusted service creates both under an approved product rule.
- ES entitlement never creates `authorized_members`.
- Completed attempts are immutable to clients.
- Every completed attempt references form, scoring, consent, and response integrity information.
- Customer summaries are rebuildable projections, never analytical authority.
- All authoritative timestamps are server timestamps.

### Attempt transaction boundary

Transactional core:

- Idempotency claim
- Attempt state/result metadata
- Response manifest or bounded response parts
- Consent reference
- Customer/result projection update
- Outbox event creation

External/retryable effects:

- Email
- PDF/report generation
- Analytics aggregation
- CRM/Apps Script relay
- Payment reconciliation

The outbox processor retries external effects and moves exhausted work to a dead-letter state without changing a correct completed attempt.

### Response storage decision

Recommended default: response subdocuments grouped into bounded parts. This supports larger future assessments and deletion without approaching the single-document limit. Phase 1 must measure real payload sizes and may approve one document only with at least 50% size headroom at the largest supported form.

### Audit fields

Actor/service, action, target type/ID, redacted before/after hashes or minimal diff, reason, request/correlation ID, timestamp, and migration run ID where applicable. Never place raw answers in general audit logs.

## P0-08 — Query and index matrix

All list queries use stable cursor pagination. Default page size: 25; maximum: 100. Add the document ID as the final stable ordering tie-breaker.

| Screen/query | Scope and filters | Order/cursor | Proposed index/projection |
| --- | --- | --- | --- |
| Customers | account status, relationship projection, program chips, organization, search key | `updatedAt desc`, ID | Customer list projection; indexes by status/program/org + updatedAt |
| Customer search | exact normalized email; prefix name/search tokens | stable search key, ID | Email claim for exact match; bounded normalized search projection for name |
| TSA active customers | `programIds` contains `tsa`, active enrollment projection | `lastActivityAt desc`, ID | Customer list projection; never scan TSA progress |
| ES participants | `programIds` contains ES; assessment/entitlement filters | `lastActivityAt desc`, ID | Customer/ES participant projection |
| ES attempts | assessment ID, status, version, organization, completion range | `completedAt desc`, ID | Composite indexes per supported filter family |
| In-progress attempts | customer + assessment + nonterminal state | `updatedAt desc`, ID | Customer/assessment/status + updatedAt |
| Enrollment list | program, status, organization, cohort | `updatedAt desc`, ID | Composite indexes derived from exact admin filters |
| Entitlement list | program/assessment, status, access type, sponsor | `updatedAt desc`, ID | Composite indexes derived from exact admin filters |
| Duplicate queue | status, reason/severity | `createdAt asc`, ID | Queue index |
| Deletion queue | account status/deletion workflow state | `requestedAt asc`, ID | Privacy operations index |
| Audit for target | target type + target ID | `createdAt desc`, ID | Target audit index |
| Organization ES aggregate | organization + assessment + period | period | Precomputed aggregate; suppress small groups at server/export layer |

Raw response fields are index-exempt and never queried for list views. Phase 1 must translate this matrix into exact Firestore indexes and cost/latency budgets before UI implementation.

## P0-09 — Role and permission matrix

### Proposed UTL roles

- Platform owner
- Customer support
- TSA program manager
- ES program manager
- Content/scoring administrator
- Privacy/data administrator
- Read-only analyst
- Organization owner/program manager/cohort facilitator/report viewer, retaining current organization-role semantics

### Permissions

| Action | Owner | Support | TSA manager | ES manager | Content/scoring | Privacy/data | Analyst | Org rep |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| View customer identity | Yes | Yes | TSA-linked only | ES-linked only | No by default | Yes | Pseudonymized | Own permitted roster only |
| View TSA progress | Yes | Support need | Yes | No | No | Privacy need | Aggregate | Current org scope |
| View ES result summary | Yes | Support need | No | Yes | No identity by default | Yes | Aggregate | No individual score by default |
| View ES raw responses | Yes | No | No | Explicit restricted permission | De-identified only where possible | Yes | No | No |
| Grant/revoke TSA access | Yes | No | Approved existing workflow | No | No | No | No | No |
| Grant/comp ES entitlement | Yes | Approved support grant with reason | No | Yes | No | Audit/review | No | Propose/invite only if approved |
| Edit assessment content/version | Yes | No | TSA content only | ES configuration oversight | Yes | No | No | No |
| Change a completed score | No direct edit | No | No | No direct edit | Versioned recalculation only | Versioned correction oversight | No | No |
| Export identities | Yes | No by default | TSA scope | ES scope with approval | No | Yes | No | Approved roster only |
| Export raw responses | Exceptional | No | No | Exceptional approved export | De-identified research export | Yes with purpose | No | No |
| Merge identities | Yes | Propose only | No | No | No | Yes | No | No |
| Archive customer | Yes | Propose | No | No | No | Yes | No | No |
| Initiate/complete deletion | Initiate | Initiate request | No | No | No | Complete | No | No |

Server rules, not hidden navigation, enforce access. Sensitive reveals and exports are audited. Search responses must not disclose the existence of protected records to unauthorized actors.

**Approved 2026-10-03:** use the proposed roles. ES program managers do not receive raw-answer access by default; any exception requires restricted permission, purpose, and audit, with privacy/data administrator approval.

## P0-10 — Privacy, consent, sponsor visibility, retention, and deletion

### Consent events

Store separate, versioned events for:

- Assessment processing consent/acknowledgment
- Optional marketing permission
- Organization disclosure, if ever offered
- Research/de-identified use, if separately required

Withdrawal changes future processing/communications according to policy; it does not rewrite historical proof that a prior notice was accepted.

### Sponsor visibility default

- Invitation, entitlement, start, and completion status: allowed within the sponsor's scope.
- Individual result or score: not allowed by default.
- Raw responses: never allowed through standard sponsor access.
- Aggregates: allowed only after the minimum group threshold is met.
- Explicit individual disclosure requires separate versioned consent and approved policy.

Recommended minimum aggregate group: 5 completed participants. Suppress the metric/export rather than displaying a small-group value.

### Proposed retention matrix

| Data | Proposed retention | Deletion behavior |
| --- | --- | --- |
| Customer contact/profile | While relationship is active, then 24 months unless legal/business need differs | Delete or irreversibly anonymize after verified request and checks |
| In-progress/abandoned ES responses | 30 days after last activity | Hard delete response content; retain minimal operational count only |
| Completed ES raw responses | 24 months | Delete on verified request unless a documented legal basis requires restriction instead |
| Derived ES results | 24 months or while participant account retains the result | Delete or anonymize with raw response; aggregates remain only if irreversible |
| Consent proof | Required legal/business period, proposed 6 years | Restrict and minimize; retain only necessary proof |
| Payment/accounting records | Statutory accounting period | Retain required financial fields; sever unnecessary assessment detail |
| Audit/security logs | Proposed 24 months | Retain redacted security proof; no raw answers |
| Migration ledgers | Through stabilization plus 24 months | Remove direct PII where no longer needed |
| Backups/exports | According to backup lifecycle, proposed maximum 90 days for operational backups | Expire automatically; deletion requests documented across backup lifecycle |
| Aggregates | Indefinite only when irreversibly anonymized | Not personal data after verified anonymization |

Deletion must cover identity claims, Auth links, enrollments, entitlements, attempts, responses, reports/files, cached projections, exports, search indexes, outbox/dead-letter payloads, and downstream relays. TSA certificates, payment records, and audit evidence require explicit treatment rather than silent removal.

**Approved as the operating default on 2026-10-03:** use the proposed durations pending any future legal requirement, suppress organization aggregates below five completed participants, provide no individual sponsor scores/answers by default, and allow ES deletion independently of TSA membership while retaining only records with an approved legal/accounting/security basis.

## P0-11 — Current-to-future admin route and capability matrix

| Current tab/section | Current purpose | Transitional destination | Final destination | Migration rule |
| --- | --- | --- | --- | --- |
| Program / Visibility & access | Public/member visibility controls | Unchanged | Programs → TSA → Configuration | Preserve functions and IDs |
| Program / Orientation | TSA orientation content | Unchanged | Programs → TSA → Content | Relocate only |
| Program / Phase 1 | TSA content | Unchanged | Programs → TSA → Content | Relocate only |
| Program / Phase 2 | TSA content | Unchanged | Programs → TSA → Content | Relocate only |
| Program / Phase 3 | TSA content | Unchanged | Programs → TSA → Content | Relocate only |
| Student Progress | TSA per-learner progress/support | Unchanged | Programs → TSA → Progress | Preserve data source |
| Platform overview | Cross-org TSA operational summary | Unchanged | Programs → TSA → Overview | Preserve data source |
| Learner readiness | TSA onboarding/technical readiness | Unchanged | Programs → TSA → Learners | Do not confuse with ES |
| Leaderboard | TSA reward ranking | Unchanged | Programs → TSA → Rewards | Preserve calculations |
| Engagement Insights | TSA adoption/behavior | Unchanged | Programs → TSA → Engagement | Preserve queries |
| Cohort Analytics | TSA cohort outcomes | Unchanged | Programs → TSA → Cohorts | Preserve org mapping |
| Readiness Assessment | Static ES admin preview | Rename Executive Signature (ES) | Programs → ES | Connect only after data gates |
| Rewards / Levels | TSA level configuration | Unchanged | Programs → TSA → Rewards | Preserve settings |
| Rewards / Rules summary | TSA reward summary | Unchanged | Programs → TSA → Rewards | Preserve settings |
| Rewards / MP rules | TSA reward configuration | Unchanged | Programs → TSA → Rewards | Preserve writers |
| Rewards / Award preview | TSA reward preview | Unchanged | Programs → TSA → Rewards | Preserve preview isolation |
| Member Access / Members | TSA access management | Unchanged plus read-only Customers | Programs → TSA → Enrollments or Operations access, final ownership separately approved | `authorized_members` remains authority |
| Member Access / Organization access | Organization definitions/reps | Unchanged | Organizations → Representatives | Preserve callable behavior |
| Member Access / Emergency access | Break-glass admin credential | Unchanged | Operations → Access & staff roles | Preserve restrictions |
| Member Access / Legacy local access | Local testing credentials | Unchanged | Operations → Local testing | Never present as production security |
| Communications / In-app nudges | TSA messaging configuration | Unchanged | Communications → In-app | Preserve behavior |
| Communications / Email templates | Member email content | Unchanged | Communications → Email | Preserve writer |
| Communications / Certificate | TSA credential settings | Unchanged | Programs → TSA → Credentials | Preserve issuance contract |
| Communications / Global defaults | Engagement defaults | Unchanged | Communications → Defaults | Preserve settings |
| Content Data / Data files | Static content files | Unchanged | Content → Data files | Relocate only |
| Content Data / Assessment review | TSA diagnostic/checkpoint content | Unchanged | Programs → TSA → Assessments | Preserve canonical source |
| Preview & Health / Member preview settings | Admin preview behavior | Unchanged | Operations → Preview | Preserve isolation |
| Preview & Health / Quick links | Operational links | Unchanged | Operations → Quick links | Relocate only |
| Preview & Health / Technical reliability | Browser/runtime incidents | Unchanged | Operations → Reliability | Preserve queries |
| Preview & Health / Site health check | Configuration checks | Unchanged | Operations → Site health | Preserve checks |
| Preview & Health / Walkthrough screenshots | TSA visual maintenance | Unchanged | Programs → TSA → UX maintenance | Relocate only |

Before Phase 9, expand this table to action/dialog/export/deep-link level and execute every row. Navigation relocation does not authorize a query or writer rewrite.

## P0-12 — UX state and navigation contract

Every customer, enrollment, entitlement, attempt, and admin screen must define:

- Loading
- True empty/not yet occurred
- Not entitled
- Restricted/not permitted
- Partial/unlinked legacy record
- Migrated summary without raw response
- Possible duplicate
- Conflicting states
- Temporarily unavailable
- Failed action with safe retry
- Deletion pending
- Anonymized/deleted
- Success confirmation

Do not use blank content for unavailable or unauthorized data. A migrated attempt with no responses must say: “Result summary migrated from the legacy system. Question-level responses are unavailable.”

### Final shell

Top bar: product mark, global customer search, environment, alerts/data-quality queue, admin identity and active scope.

Primary navigation: Overview, Customers, Programs, Organizations, Communications, Content, Operations. Use one persistent primary navigation system; on small screens it becomes a labeled drawer.

### Profile/workspace menu

Identity, current workspace, switch workspace if applicable, Account & programs, authorized organization/admin workspaces, Log out. Detailed program navigation remains inside the active workspace.

### Accessibility contract

- Keyboard-complete navigation and dialogs
- Visible focus
- Screen-reader names and state announcements
- No status communicated by color alone
- 200% text zoom without lost actions or horizontal-page failure
- Mobile checks at 375px and 768px
- Long names/emails and content expansion
- Focus restoration after menus/dialogs
- Revoked-access and stale-deep-link recovery

## P0-13 — TSA baseline

Captured 2026-10-03 from the current working tree. This is a code/test baseline, not a production-data export.

### Existing authoritative boundaries

- TSA sign-in/access: `authorized_members`
- TSA user/profile/progress projection: `users`
- Exercise completion authority: `users/{uid}/completed_exercises`
- Cohort details and organization mapping: flat `settings/cohorts`
- Organizations and representative grants: `organizations` and subcollections
- Credentials: `credential_issuance` and `public_credentials`
- TSA assessment attempts: `assessment_item_attempts`

### Test baseline

- Test files discovered: 73
- Successful exit: 72
- Failure: 1
- Emulator-dependent suites that exited successfully by explicitly skipping: 3
  - `member-account-rules.behavior.test.js`
  - `organization-console-rules.behavior.test.js`
  - `readiness-assessment-account.test.js`
- Existing failure: `typography-system.test.js`
- Failure cause: `admin/index.html` currently contains `.ra-data-rule { border-left: 4px solid ... }`, while the test prohibits a thick decorative vertical color rail.
- Phase 0 treatment: baseline exception; do not attribute it to later platform work unless the diff changes that code. Resolve through a separately scoped UI correction before requiring a completely green general suite.

### Required production baseline before Phase 4

Capture authorized production counts without including PII in this document:

- Authorized TSA members by status
- Auth-linked TSA users
- Cohorts and organization assignments
- Exercise/progress record counts
- Reward and credential counts
- Organization representative grants
- Current error and support rates
- Critical TSA page p50/p95 performance
- Critical admin task success/time

Store the dated report in a restricted operational location and link its identifier in the tracker.

## P0-14 — Backup, restore, migration, and rollback contract

### Before backfill

- Confirm Firestore point-in-time recovery or create a named export.
- Record export ID, project, timestamp, collections, owner, and retention.
- Restore into a nonproduction Firebase project and reconcile sample/count checks.
- Never use a production restore as the first restore test.

### Migration controls

- Dry-run mode
- Idempotent writes
- Bounded batches and rate limits
- Restart checkpoints
- Immutable-source default
- `migrationRunId` on created/projected records
- Per-record mapping ledger
- Before/after checksums or equivalent comparisons
- Quarantine/exception queue
- Signed reconciliation report

### Rollback layers

1. Feature flag rollback: hide/disable a new capability.
2. Code rollback: redeploy the last compatible code/rules/functions.
3. Write stop: disable new writes safely without discarding accepted submissions; queue or show maintenance before accepting input.
4. Projection rebuild: recompute customer summaries/aggregates from authority.
5. Data rollback: use migration ledger or tested restore only when necessary and explicitly approved.

Rollback of code does not automatically reverse data. The release owner and data owner must decide each layer separately.

## P0-15 — Observability and incident contract

Track and alert on:

- Customer-resolution conflicts
- Duplicate email/Auth claims
- Attempt write failures
- Attempts stuck in nonterminal states
- Orphan attempts, response parts, entitlements, or enrollments
- Outbox retries and dead letters
- Projection/aggregate rebuild failures
- Dual-read divergence
- Rules-denied spikes
- Function latency and error rate
- Firestore read/write/index/storage cost
- Migration throughput, errors, and retry age
- Retention/deletion job failures
- TSA login, progress, reward, credential, and organization regressions

Every request and asynchronous job carries a correlation ID. Dashboards separate expected authorization denials from unexpected failures. Alerts name an owner, severity, and runbook.

### Incident severities

- Sev 1: data loss, privacy exposure, incorrect access, corrupt scoring, widespread outage
- Sev 2: critical workflow unavailable, materially incorrect totals, inaccessible critical path
- Sev 3: limited defect with safe workaround
- Sev 4: cosmetic/low impact

Any Sev 1 in released scope triggers the relevant rollback decision. No release proceeds with an open Sev 1 or an unaccepted in-scope Sev 2.

## P0-16 — KPIs, quality thresholds, and observation windows

### Non-negotiable safety thresholds

| Measure | Threshold |
| --- | ---: |
| Cross-customer/organization exposure | 0 |
| Incorrect TSA access changes | 0 |
| Data loss | 0 |
| Retry-created duplicate attempts | 0 |
| Reproducible completed scores | 100% |
| Identity/Auth critical parity | 100% |
| TSA critical-flow tests | 100% |
| Critical/serious accessibility defects | 0 |

### Proposed operating thresholds

| Measure | Proposed gate |
| --- | ---: |
| Assessment trusted-write success | At least 99.9% excluding confirmed client abandonment |
| Migration reconciliation | 100% mapped or named/approved exceptions |
| TSA p95 page regression | No more than 20% versus captured baseline |
| TSA admin critical-task time regression | No more than 10% in representative tests |
| Unresolved identity duplicate rate after queue SLA | Less than 0.5% of active customers |
| Sev 1 at release | 0 |
| In-scope Sev 2 at release | 0 |

### Product metrics to baseline and monitor

- Quick Check start-to-completion
- Verified-account recovery success
- Quick Check-to-Full entitlement conversion
- Full Assessment start-to-completion
- Resume success
- Report generation/download success
- Duplicate-candidate rate and resolution age
- Support contacts per 100 completions
- TSA sign-in, learning progression, and admin-task success

### Observation windows

- Emulator/staging: until all mandatory scenarios pass
- Internal production accounts: minimum 2 business days
- Limited external cohort: minimum 7 calendar days or 100 completed attempts, whichever is later
- General-availability stabilization: minimum 30 calendar days before compatibility retirement decisions

**Approved 2026-10-03:** use the proposed thresholds and observation windows. A later baseline may tighten them; any relaxation requires a recorded gate decision.

## P0-17 — Scope exclusions

This project does not include:

- A generalized no-code program builder
- A redesign of TSA curriculum, tables, scoring, rewards, or credentials
- Replacing existing TSA authoritative records
- Automatic identity merging by name or organization
- Employer access to individual ES results by default
- Manual editing of completed scores
- Live payment integration unless separately scoped and approved
- A broad CRM, marketing automation suite, or data warehouse
- Historical reconstruction of raw responses that were never stored
- Navigation relocation and TSA data-source migration in one release

New scope requires a decision-log entry, impact review, owner, and gate changes.

## P0-18 — Gate decision requirements

Phase 0 can pass only when:

1. Accountable people are named for all required roles.
2. Every **Approval required** item in this document is resolved.
3. Privacy/legal review approves data use, sponsor visibility, retention, deletion, and consent.
4. Product approves entitlements, customer journeys, KPIs, and scope.
5. Data/engineering approves identity uniqueness, authority, schema, queries, backup, restore, and rollback.
6. UX/TSA owners approve the route inventory, state model, accessibility contract, and TSA baseline.
7. The known typography baseline failure is either corrected in a separately scoped change or recorded as an accepted pre-existing exception for Phase 1 comparisons.
8. A written go/no-go decision is entered in the tracker.

## Approval register

| Decision | Approved default | Status |
| --- | --- | --- |
| Full Assessment retakes | One completed attempt; new/admin-granted entitlement for another | Approved 2026-10-03 |
| Report after entitlement expiry/revocation | Completed participant-owned report remains available unless an approved restriction applies | Approved 2026-10-03 |
| Quick Check authentication | May start before authentication; verify email for later/cross-device access | Approved 2026-10-03 |
| In-progress recovery | 30 days | Approved 2026-10-03 |
| Merge authority | Platform owner and privacy/data administrator only | Approved 2026-10-03 |
| Duplicate review SLA | 5 business days | Approved 2026-10-03 |
| ES manager raw-response access | Not by default; explicit restricted permission and audit | Approved 2026-10-03 |
| Sponsor individual visibility | Completion only; no individual score/answers by default | Approved 2026-10-03 |
| Aggregate minimum group | 5 completed participants | Approved 2026-10-03 |
| Retention periods | Use proposed matrix unless a later legal/privacy decision changes it | Approved operating default 2026-10-03 |
| Operating thresholds/windows | Use proposed values; relaxation requires a recorded decision | Approved 2026-10-03 |

## Phase 0 gate decision

**Pass — 2026-10-03.** The business owner approved the recommended defaults. Wen-Szu is the accountable business/product and TSA owner and holds the other human approval responsibilities on an interim basis until delegated. Codex and Claude Code may support implementation but are not human accountability owners. Phase 1 is authorized for emulator-only implementation; production deployment remains separately gated.
