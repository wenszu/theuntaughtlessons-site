# Customer and Program Platform Execution Tracker

Last updated: 2026-10-04  
Plan: `docs/CUSTOMER_PROGRAM_PLATFORM_IMPLEMENTATION_PLAN.md`  
Phases 7–11 execution plan and coordination log (which work stream/agent owns which files right now): `docs/CUSTOMER_PROGRAM_PLATFORM_PHASES_7_TO_11_PLAN.md`  
Current gate: Phase 4 — passed, including production backfill (2026-10-04). Firestore indexes, Firestore rules, and the full Cloud Functions codebase are deployed to production (indexes/functions 2026-10-04, rules 2026-10-05 after a verified-empty diff against what was already live). Phases 5–9 all have decision-free engineering substance built and verified; Phase 10 is 4 of 8 ordered steps complete; Phase 11 has its retirement-scan tooling built. Nothing beyond indexes/rules/functions/migration has been deployed or pushed. See `docs/CUSTOMER_PROGRAM_PLATFORM_PHASES_7_TO_11_PLAN.md` for the full breakdown of what's decision-free versus what needs the owner, in order.  
Phase 5 scope: local/emulator read service and admin UI built behind a feature flag that remains off; direct service reconciliation against production data passes. Performance, accessibility, and gate approval remain outstanding; callables are now deployed.  
Phase 6 scope: local/emulator ES workspace and audited single-attempt raw-response reveal built behind a feature flag that remains off; direct service reconciliation correctly returns zero production ES records. Performance, accessibility, access ownership, and gate approval remain outstanding; callables are now deployed.  
Phase 7 scope: self-service workspace-eligibility/status reads, the deterministic landing-order resolver, a workspace-switcher menu entry, an extended Account page, and an entitlement-aware ES entry notice are all built and emulator-verified. Accessibility review and wiring the landing-order resolver into real navigation remain.  
Phase 8 scope: a read-only TSA-shadow-verification tool is built and emulator-verified; it has not been run against production, and no mismatch disposition has been reviewed.  
Phase 9 scope: the action-level admin route/capability matrix is complete (~140 actions catalogued); the actual admin restructuring has not begun and needs human review of the matrix first.  
Phase 10 scope: indexes, functions, and migration (3 of 8 ordered steps) are live; a rules-deployment risk assessment is prepared; flags, internal access, cohorts, and GA remain owner decisions.  
Phase 11 scope: a dependency-scan tool for legacy/compatibility fields is built and verified; post-release monitoring and decommission approval cannot start before Phase 10 ships real traffic.  
Production status: Phase 4 data backfill, composite indexes, and the full `admin-actions` Cloud Functions codebase are live. No Phase 5–9 UI capability is released; the underlying callables exist in production but remain reachable only by role-gated staff (Phase 5/6) or are self-service with no fully-wired UI consumer yet (Phase 7). The Firestore rules needed for the admin UI's own feature-flag read (`platformFeatureFlags/*`) have not been deployed yet — treated as a separate, later decision (see decision log and `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_10.md`), not bundled into the functions deployment.

## How to use this tracker

- Update this file in every Codex or Claude Code session that changes scope, status, evidence, decisions, or risks.
- A checked build task does not pass a phase. Attach the required evidence and record the gate decision.
- Preserve TSA behavior unless a tracker item explicitly authorizes a change.
- Do not begin a later phase while an earlier blocking gate is failed.

## Status definitions

`Not started` → `In design` → `Ready for build` → `In build` → `In verification` → `Passed`

Exceptional states: `Blocked`, `Failed`, `Rolled back`.

## Overall dashboard

| Phase | Name | Status | Gate | Accountable owner | Evidence complete |
| ---: | --- | --- | --- | --- | --- |
| 0 | Contracts and TSA baseline | Passed | Passed 2026-10-03 | Wen-Szu | Yes; production-data baseline is deferred to the pre-backfill gate |
| 1 | Emulator architecture and security | Passed | Passed 2026-10-03 | Wen-Szu, interim | Yes |
| 2 | Identity and entitlements | Passed | Passed 2026-10-03 | Wen-Szu, interim | Yes |
| 3 | Immutable ES persistence | Passed | Passed 2026-10-04 | Wen-Szu, interim | Yes |
| 4 | Backfill and reconciliation | Passed | Passed 2026-10-04, including production backfill | Wen-Szu, interim | Yes, including production baseline, dry-run, apply, and reconciliation |
| 5 | Read-only Customers console | In verification | Local evidence and reconciliation against real data both pass; performance trace and accessibility review (needs a Cloud Functions deployment) remain | Wen-Szu, interim | Local and reconciliation evidence yes; performance/accessibility evidence no |
| 6 | ES admin workspace | In verification | Local evidence and reconciliation against real data both pass; performance trace and accessibility review (needs a Cloud Functions deployment) remain | Wen-Szu, interim | Local and reconciliation evidence yes; performance/accessibility evidence no |
| 7 | Member workspaces and switcher | In verification | All engineering substance built and emulator-verified (resolver, routing logic, menu entry, Account page, ES entry notice); accessibility review and gate sign-off remain | Wen-Szu, interim | Engineering evidence yes; accessibility and gate-review evidence no |
| 8 | TSA shadow verification | In verification | Run against real production data; the one gap found (29 enrollments missing `organizationId`) was corrected and independently verified 2026-10-05 | Wen-Szu, interim | Tooling, production run, and remediation evidence yes; confirmation re-run and gate review no |
| 9 | Final admin navigation | In design (matrix expanded) | Action-level route/capability matrix complete, pending human review before any restructuring begins | Wen-Szu, interim | Matrix evidence yes; restructuring implementation no |
| 10 | Controlled production release | In progress (3 of 8 ordered steps done) | Indexes, functions, and migration deployed; rules-deployment risk assessment prepared and awaiting a decision; flags/internal access/cohorts/GA remain owner decisions | Wen-Szu | Risk assessment yes; the release decisions themselves no |
| 11 | Stabilization and retirement | In build (tooling only) | Decision-free dependency-scan tooling built ahead of schedule; post-release monitoring and decommission remain locked by Phase 10 shipping | Wen-Szu, interim | Scanner tooling yes; monitoring/decommission no (no production traffic exists to monitor yet) |

## Required owners

| Role | Named owner | Confirmed | Notes |
| --- | --- | --- | --- |
| Product lead | Wen-Szu | Yes | Business/product owner |
| Database/engineering lead | Wen-Szu, interim | Yes, interim | Codex/Claude Code support implementation; accountability remains human |
| UX lead | Wen-Szu, interim | Yes, interim | May be delegated later |
| Security/privacy owner | Wen-Szu, interim | Yes, interim | Revisit before production persistence/deployment if specialist review is required |
| TSA product owner | Wen-Szu | Yes | Owns TSA non-regression sign-off |
| Engineering/release owner | Wen-Szu, interim | Yes, interim | Production remains separately gated |
| Operations/support lead | Wen-Szu, interim | Yes, interim | Must be reconfirmed before controlled release |

## Phase 0 work register

| ID | Deliverable | Owner | Status | Pass criteria | Evidence | Decision/notes |
| --- | --- | --- | --- | --- | --- | --- |
| P0-01 | Product hierarchy and vocabulary | Product lead | Passed | TSA and ES hierarchy; assessment, enrollment, entitlement, attempt, and role terms approved | `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_0.md#p0-01--product-hierarchy-and-vocabulary` | Approved 2026-10-03 |
| P0-02 | Entitlement matrix | Product lead | Passed | Free, paid, comped, sponsored, expiration, revocation, refund, report, and retake rules defined | `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_0.md#p0-02--entitlement-matrix` | Approved 2026-10-03 |
| P0-03 | ES participant journeys | Product + UX | Passed | Entry, identity, verification, resume, completion, result, report, conversion, and retake paths approved | `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_0.md#p0-03--es-participant-journeys` | Approved 2026-10-03 |
| P0-04 | Customer state model | Product + Data | Passed | Account, commercial/access, per-program, and role dimensions approved | `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_0.md#p0-04--customer-state-model` | Approved 2026-10-03 |
| P0-05 | Identity and duplicate policy | Data + Product | Passed | Exact-match, Auth UID, email change, shared email, duplicate, merge, and reversal rules approved | `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_0.md#p0-05--identity-and-duplicate-policy` | Approved 2026-10-03 |
| P0-06 | Field-level source-of-truth matrix | Data | Passed | Transitional and final authority defined for every field | `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_0.md#p0-06--field-level-source-of-truth-matrix` | Approved 2026-10-03 |
| P0-07 | Schema and data-flow specification | Data | Passed | IDs, references, invariants, timestamps, checksums, idempotency, outbox, and projections defined | `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_0.md#p0-07--schema-and-data-flow-contract` | Approved; Phase 1 validates response sizing |
| P0-08 | Query and index matrix | Data + Engineering | Passed | Every intended list/filter/order has bounded query, cursor, index, cost, and latency target | `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_0.md#p0-08--query-and-index-matrix` | Approved; exact manifest belongs to Phase 1 |
| P0-09 | Role and permission matrix | Security + Product | Passed | View/edit/export/merge/archive/delete/comp/scoring permissions defined for every role | `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_0.md#p0-09--role-and-permission-matrix` | Approved 2026-10-03 |
| P0-10 | Privacy, consent, sponsor visibility, retention, and deletion matrix | Security/privacy | Passed | Policy for every data class and downstream copy approved | `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_0.md#p0-10--privacy-consent-sponsor-visibility-retention-and-deletion` | Approved as operating default; later legal requirements may supersede through a logged decision |
| P0-11 | Current-to-future admin route/capability matrix | UX + TSA owner | Passed | 100% of current TSA routes, actions, dialogs, deep links, exports, roles, and states mapped | `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_0.md#p0-11--current-to-future-admin-route-and-capability-matrix` | Section inventory approved; action-level execution inventory remains a Phase 9 prerequisite |
| P0-12 | Admin and member UX state matrix | UX | Passed | Normal, loading, empty, partial, migrated, restricted, error, deleted, and conflict states defined | `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_0.md#p0-12--ux-state-and-navigation-contract` | Approved 2026-10-03 |
| P0-13 | TSA baseline | TSA owner + QA | Passed | Counts, critical tasks, screenshots, tests, performance, rewards, credentials, org mappings captured | `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_0.md#p0-13--tsa-baseline` | Code/test baseline approved; restricted production baseline remains mandatory before Phase 4 |
| P0-14 | Backup, restore, migration, and rollback design | Data + Release | Passed | Export, tested restore, run ledger, checksums, code/data rollback boundaries approved | `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_0.md#p0-14--backup-restore-migration-and-rollback-contract` | Approved; restore execution remains mandatory before backfill |
| P0-15 | Observability and incident plan | Release + Operations | Passed | Metrics, alerts, correlation IDs, dashboards, on-call, incident and dead-letter handling defined | `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_0.md#p0-15--observability-and-incident-contract` | Approved 2026-10-03 |
| P0-16 | KPI and launch threshold approval | Product + TSA owner | Passed | Product, reliability, privacy, performance, support, and rollback measures have owners and thresholds | `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_0.md#p0-16--kpis-quality-thresholds-and-observation-windows` | Approved 2026-10-03 |
| P0-17 | Scope exclusions | Product lead | Passed | Explicitly excludes generalized no-code program builder and unrelated TSA redesign | `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_0.md#p0-17--scope-exclusions` | Approved 2026-10-03 |
| P0-18 | Phase 0 gate review | All required approvers | Passed | All mandatory Phase 0 evidence approved; no blocking ambiguity remains | `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_0.md#p0-18--gate-decision-requirements` | Go decision recorded 2026-10-03; Phase 1 emulator-only |

## Phase 0 gate checklist

- [x] All required owners are named, with interim responsibilities explicitly recorded.
- [x] Product hierarchy and terminology are approved.
- [x] Entitlement matrix is approved.
- [x] ES customer journeys are approved.
- [x] Identity, email change, duplicate, merge, and reversal policies are approved.
- [x] Field-level source-of-truth matrix is approved.
- [x] Schema, transaction, idempotency, and outbox contracts are approved.
- [x] Query/index/cost plan is approved at contract level; Phase 1 produces the exact manifest.
- [x] Role and permission matrix is approved.
- [x] Privacy, sponsor visibility, consent, retention, deletion, export, and aggregation operating rules are approved.
- [x] Every current TSA section is mapped to transitional and final navigation; action-level execution inventory is required before Phase 9.
- [x] UI states and accessibility expectations are documented.
- [x] TSA code/test baseline is reproducible; restricted production-data baseline is required before Phase 4.
- [x] Backup, restore, migration, and rollback procedures are approved at contract level; restore execution is required before backfill.
- [x] KPIs, release thresholds, observation windows, and rollback triggers are approved.
- [x] Scope exclusions are approved.
- [x] Written Phase 0 go decision is recorded.

## Phase 1 work register

| ID | Deliverable | Owner | Status | Pass criteria | Evidence | Decision/notes |
| --- | --- | --- | --- | --- | --- | --- |
| P1-01 | Exact schema contract | Data + Engineering | Passed | Collection paths, fields, authority, invariants, and role IDs are explicit | `docs/CUSTOMER_PROGRAM_PLATFORM_SCHEMA_V1.md` | Additive model; existing TSA collections remain authoritative |
| P1-02 | Firestore access rules | Security + Engineering | Passed | Own-customer, staff, program, sponsor, aggregate, and raw-response boundaries enforced | `firestore.rules`; emulator behavior suite | New domain writes are server-only; raw responses require an explicit privileged role |
| P1-03 | Query/index manifest | Data + Engineering | Passed | Every Phase 1 composite query has a declared index; raw payloads are not indexed | `firestore.indexes.json`; contract suite | Connected to `firebase.json`; no unbounded Phase 1 query introduced |
| P1-04 | Static contract tests | Engineering | Passed | Schema/rules/index/config contracts are machine checked | `tests/customer-program-platform-contract.test.js` | Passed 2026-10-03 |
| P1-05 | Behavioral security tests | Security + Engineering | Passed | Participant, support, ES lead, privacy admin, analyst, and org-representative boundaries verified | `tests/customer-program-platform-rules.behavior.test.js` | Passed against isolated Firebase emulators |
| P1-06 | TSA security regression | TSA owner + Engineering | Passed | Existing member, organization, and assessment rule suites remain green | Emulator regression command in Phase 1 evidence | All four behavioral suites passed together; no TSA rule block was removed |
| P1-07 | Response payload sizing | Data + Engineering | Passed | Representative payloads remain below 512 KiB, preserving at least 50% headroom from Firestore's 1 MiB limit | Contract test output | Quick check: 67,187 bytes; full assessment: 68,487 bytes |
| P1-08 | Repository regression suite | Engineering | Passed with documented baseline exception | No new static regression attributable to Phase 1 | Phase 1 evidence report | 74 pass, 4 emulator-only skips, 1 pre-existing typography failure; skipped suites passed in emulator run |
| P1-09 | Phase 1 gate review | Required owners | Passed | All Phase 1 evidence complete with no access, privacy, data-integrity, or TSA regression | `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_1.md` | Phase 2 authorized for emulator-only implementation; production remains locked |

## Phase 1 gate checklist

- [x] Exact schema and source-of-truth contract is documented.
- [x] Composite indexes and large/raw field exemptions are declared.
- [x] All new domain collections deny direct client writes.
- [x] Participant and staff read boundaries pass behavioral tests.
- [x] Raw ES responses are unavailable to support, analysts, sponsor representatives, and ordinary ES leads.
- [x] Cross-program aggregates expose no raw response data.
- [x] Existing TSA/member, organization, and readiness-account security suites pass unchanged.
- [x] Representative assessment payloads retain more than 50% document-size headroom.
- [x] No production rules, indexes, data, functions, or hosting were deployed.
- [x] Written Phase 1 go decision is recorded.

## Phase 2 work register

| ID | Deliverable | Owner | Status | Pass criteria | Evidence | Decision/notes |
| --- | --- | --- | --- | --- | --- | --- |
| P2-01 | Canonical identity resolver | Data + Engineering | Passed | Verified Auth UID then exact normalized-email resolution; transactional customer/claim/link creation | `functions-admin/customer-program-service.js`; Phase 2 emulator test | Concurrent claims converge on one customer |
| P2-02 | Duplicate/conflict handling | Data + Privacy | Passed | Cross-customer Auth/email conflict never auto-merges and enters review with SLA | Phase 2 emulator test and audit sample | Deterministic open candidate; both authoritative links unchanged |
| P2-03 | Verified email change | Data + Security | Passed | Reserve new verified claim before retiring old claim; conflicts enter review | Phase 2 emulator test | Old claim becomes restricted historical alias |
| P2-04 | Entitlement grant service | Product + Engineering | Passed | Funding/status/sponsor/payment/account/retake rules validated transactionally | Phase 2 service and emulator test | Free/paid/comped/sponsored remain entitlement attributes |
| P2-05 | Entitlement lifecycle | Product + Engineering | Passed | Explicit transitions reject invalid state changes and preserve prior results | Phase 2 emulator test | No result deletion is performed by lifecycle changes |
| P2-06 | Audit and idempotency | Security + Engineering | Passed | Every mutation is reasoned/audited and replay-safe; no raw email in audit | `serviceRequests`, `auditEvents`, concurrency test | Idempotency receipts are client-inaccessible |
| P2-07 | Callable authorization | Security + Engineering | Passed | Participant self-service and staff grant/status roles are separated | `functions-admin/index.js`; `tests/customer-program-callable-auth.test.js` | Analyst and TSA lead denied; support and bootstrap owner allowed; client collection writes remain denied |
| P2-08 | Readiness compatibility | ES owner + Engineering | Passed | Legacy result summary preserved while canonical ES identity/access is added | Existing readiness account suite plus Phase 2 service suite | TSA member and ES participant resolve to one customer without TSA mutation |
| P2-09 | TSA and repository regression | TSA owner + QA | Passed with documented baseline exception | Existing emulator suites green; no Phase 2-attributable static regression | `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_2.md` | 77/78 static files exit successfully; sole known typography baseline failure remains |
| P2-10 | Phase 2 gate review | Required owners | Passed | Concurrency, identity invariants, entitlement matrix, audits, and TSA isolation pass | `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_2.md` | Phase 3 authorized in emulators only; production remains locked |

## Phase 2 gate checklist

- [x] Concurrent exact identity claims create one canonical customer.
- [x] Auth UID and email uniqueness are transactional and independently enforced.
- [x] Similar names and different emails never merge automatically.
- [x] Conflicts create a duplicate candidate without changing authoritative links.
- [x] Verified email changes reserve-before-release and are replay-safe.
- [x] Entitlement funding, sponsor/payment, status, retake, and account-state rules are validated.
- [x] Invalid entitlement transitions are rejected.
- [x] Audit records avoid raw email and assessment-response content.
- [x] Service idempotency receipts cannot be read or written by clients.
- [x] Existing readiness behavior remains compatible.
- [x] ES access does not grant or alter TSA authorization.
- [x] Existing TSA/member and organization security suites remain green.
- [x] No production resources were deployed or changed.
- [x] Written Phase 2 go decision is recorded.

## Phase 3 work register

| ID | Deliverable | Owner | Status | Pass criteria | Evidence | Decision/notes |
| --- | --- | --- | --- | --- | --- | --- |
| P3-01 | Locked server version registry | Data + ES owner | Passed | Browser/server IDs, areas, directions, order, and counts match | `functions-admin/executive-signature-versions.js`; Phase 3 parity test | Quick Check 20 items; Full Assessment 40 items |
| P3-02 | Server-authoritative scoring | Data + Engineering | Passed | Official result ignores client summary and reproduces from stored evidence | Phase 3 persistence test | Fixtures reproduce 50/Developing and 75/Strong |
| P3-03 | Immutable attempt transaction | Data + Engineering | Passed | Attempt, response parts, consent, entitlement, projection, audit, outbox, and idempotency commit together | `functions-admin/assessment-persistence-service.js` | Rejected submissions leave no partial attempt |
| P3-04 | Bounded raw-response storage | Data + Privacy | Passed | Quick Check is one bounded part; Full Assessment is two; client writes remain denied | Phase 3 emulator and rules suites | Raw answer fields remain index-exempt and privileged-read only |
| P3-05 | Consent evidence | Privacy + Engineering | Passed | Required processing and optional marketing choices are separate, versioned events | Phase 3 emulator test | Missing processing consent blocks the transaction |
| P3-06 | Integrity and reproducibility | Data + QA | Passed | Deterministic response/result checksums and stored scoring inputs reproduce result | Phase 3 emulator test | Stored Full result reproduced exactly from response parts |
| P3-07 | Entitlement/retake enforcement | Product + Engineering | Passed | One Full completion by default; explicit allowance creates new immutable attempts | Phase 3 emulator test | Default consumes after one; allowance `1` permits exactly two |
| P3-08 | Compatibility projection | ES + Engineering | Passed | Legacy summary is retained and sourced from authoritative server result | Updated readiness account suite | Summary stores attempt ID/result checksum; TSA record unchanged |
| P3-09 | Outbox creation | Engineering + Operations | Passed for persistence scope | Completion queues bounded, PII-safe analytics/report work outside core transaction | Phase 3 emulator test | Production consumers/retry/dead-letter operation remain later release prerequisites |
| P3-10 | TSA/repository regression | TSA owner + QA | Passed with documented baseline exception | All Firebase suites green; no Phase 3-attributable regression | `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_3.md` | 70 pass, 9 emulator skips, 1 known typography baseline failure; all seven relevant emulator suites pass |
| P3-11 | Phase 3 gate review | Required owners | Passed | Idempotency, failure paths, scoring reproduction, retakes, checksums, and TSA isolation pass | `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_3.md` | Phase 4 local/synthetic preparation only; production data/deploy remains locked |

## Phase 3 gate checklist

- [x] Browser and server locked-form scoring metadata match exactly.
- [x] Server scoring is authoritative and independently tested.
- [x] Completed attempts and response parts are immutable to clients.
- [x] Response payloads are bounded and raw fields remain index-exempt.
- [x] Every completed attempt references form, scoring, content, consent, and checksums.
- [x] Concurrent replay creates one attempt.
- [x] Validation and entitlement failures create no partial attempt.
- [x] Default Full Assessment and admin-granted retake rules are enforced.
- [x] Prior attempts are never overwritten.
- [x] Customer and legacy readiness projections point to authoritative results.
- [x] Audit and outbox records contain no raw answers or email.
- [x] Existing TSA/member, organization, and cross-program security suites remain green.
- [x] No production resources or data were changed.
- [x] Written Phase 3 go decision is recorded.

## Phase 4 work register

| ID | Deliverable | Owner | Status | Pass criteria | Evidence | Decision/notes |
| --- | --- | --- | --- | --- | --- | --- |
| P4-01 | Source and target inventory capture | Data + Engineering | Passed | Versioned snapshot and separate source/target checksums | `scripts/customer-program-migration.js`; Phase 4 emulator test; P4-08 production evidence | Production capture completed through the isolated clone |
| P4-02 | Dry-run planner | Data + Engineering | Passed locally | Exact identity, deterministic IDs, canonical claim reuse, no source mutation | Phase 4 contract/emulator tests | Invalid, duplicate, changed identity, and unverified Auth cases are explicit |
| P4-03 | Bounded resumable apply | Data + Release | Passed locally | Batch cap, durable checkpoint, idempotent replay, per-record ledger | Phase 4 emulator test | Emulator-only guard fails closed |
| P4-04 | Exception quarantine | Data + Privacy | Passed locally | Conflicts never auto-merge; every exception has reason codes | Synthetic and runtime collision drills | Human approval required for production exceptions |
| P4-05 | Reconciliation | Data + QA | Passed | Every planned row matched or named as an exception; TSA sources unchanged | `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_4.md` | Production reconciliation passed: 55 matched, 0 mismatched |
| P4-06 | Restore drill | Release + QA | Passed | Pre-existing targets restored and new targets removed | Phase 4 emulator test; `cpp-phase4-baseline` clone verification | Isolated production clone served as the recoverable export/restore target |
| P4-07 | TSA/repository regression | TSA owner + QA | Passed locally with baseline exception | Existing Firebase suites green; no Phase 4-attributable static failure | Phase 4 evidence | 81/82 static pass; known typography failure only |
| P4-08 | Production backfill gate | Required owners | Passed | Restricted baseline, export, isolated restore, dry-run review, authorization, apply, reconciliation | Firestore database `cpp-phase4-baseline` (clone of `(default)` at snapshot time 2026-10-04T04:02:00Z); baseline and dry-run plan both read from that clone (plus one read-only Firebase Auth `listUsers` call against live production — Auth has no per-database isolation); production apply and reconciliation via `scripts/customer-program-production-apply.js` against the live `(default)` database | Baseline signed 2026-10-04 by Wen-Szu. Counts: 55 `authorized_members`, 54 `users`, 2 `organizations`, 0 `customers`/`customerEmailClaims`/`customerAuthLinks`/`enrollments` before apply. `snapshotChecksum=2b266d07233a30d65979706bbf5620dd6b57f24242890ec4b6e106c0b9d613e2`. Dry-run plan: 55 records, 0 named exceptions, 1 soft warning (`no_auth_user_match`), 53 planned TSA enrollments. `planChecksum=88f3ddc68cdf22ef02c2478f7b8cbb2408c87945df360c1432f5f71d80652852`. **Production apply completed 2026-10-04**: 55/55 applied, 0 skipped, 0 exceptions, batch size 25 (checkpoints at 25/50/55). **Reconciliation passed 2026-10-04**: `sourceUnchanged=true`, `planned=55`, `matched=55`, `mismatched=0`. Full baseline/plan/reconciliation records (contain real names/emails) kept locally at `~/phase4-production-artifacts/`, outside any synced storage, not in the repository. |

## Phase 4 gate checklist

- [x] Migration implementation is additive and rejects non-emulator writes.
- [x] Dry-run plans are checksum-protected and do not mutate sources.
- [x] Existing canonical customers are reused through email claims.
- [x] Duplicate/ownership/changed-email conflicts are named, never auto-merged.
- [x] Batches are bounded, checkpointed, and replay-safe.
- [x] Synthetic/emulator reconciliation accounts for every row.
- [x] Synthetic/emulator restore drill passes.
- [x] Existing TSA/customer-program emulator regressions pass together.
- [x] Restricted production baseline is captured and signed. (2026-10-04, Wen-Szu; see P4-08 evidence)
- [x] Production export is restored and verified in isolated nonproduction. (2026-10-04, Wen-Szu: the `cpp-phase4-baseline` clone is both the export and the isolated restore target in one atomic Google-managed operation; counts/checksums were verified by reading it directly)
- [x] Production dry-run exceptions and operating window are approved. (2026-10-04, Wen-Szu: 0 named exceptions; operating window = batch size 25, halt on any checksum mismatch, rollback owner Wen-Szu, no special maintenance window since the backfill is purely additive and Phase 5/6 UI remain feature-flagged off)
- [x] Production backfill and signed reconciliation are complete. (2026-10-04: applied 55/55 records, 0 exceptions, 0 skipped via `scripts/customer-program-production-apply.js apply`; reconciled with `sourceUnchanged=true`, `matched=55`, `mismatched=0` via the same script's `reconcile` command — see P4-08 evidence)
- [x] Written Phase 4 pass decision authorizes Phase 5. (2026-10-04, Wen-Szu; see Gate decision record)

## Phase 5 work register

| ID | Deliverable | Owner | Status | Pass criteria | Evidence | Decision/notes |
| --- | --- | --- | --- | --- | --- | --- |
| P5-01 | Bounded, cursor-paginated directory read | Data + Engineering | Passed locally | Every list query is bounded and paginated; no unbounded scan | `functions-admin/customer-program-service.js` `listCustomerDirectory`; `tests/customer-program-phase5-directory.test.js` | Exact-email lookup is O(1); name search and recency paging use existing single-field indexes only |
| P5-02 | Customer detail read contract | Data + Engineering | Passed locally | Overview/Programs/Assessments/Activity always available; Consent/Audit gated to privileged roles; raw responses never read | `functions-admin/customer-program-service.js` `getCustomerDetailForStaff`; same test file | `responseParts` is never queried by this phase |
| P5-03 | Callable authorization | Security + Engineering | Passed locally | Only `platform_owner`, `customer_support`, `privacy_data_admin` may call either read function | `functions-admin/index.js`; same test file | Read-only analyst and ES/TSA program leads are explicitly rejected |
| P5-04 | Off-by-default release flag | Release + Engineering | Passed locally | The console is inert unless `platformFeatureFlags/customersConsole.enabled == true`; no client write path exists for the flag | `firestore.rules` `platformFeatureFlags` match block; admin UI flag check | Turning the flag on is a manual, non-client Firestore write by a trusted operator |
| P5-05 | Required UI/data states | UX + Engineering | Passed locally | Identity, participation, missing-data, migrated, duplicate, deletion/restricted, empty, error, responsive, accessible states all implemented | `admin/index.html` `#section-customers-directory`; `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_5.md` | Consent/Audit tabs additionally render an explicit "restricted" state for `customer_support` |
| P5-06 | TSA/repository regression | TSA owner + QA | Passed locally | Existing Firebase suites green; no Phase 5-attributable static failure | Phase 5 evidence doc | 71/83 static pass, 11 emulator-only skips, 1 pre-existing typography baseline failure (unchanged) |
| P5-07 | UI/data reconciliation against real data | Data + QA | Passed | Directory and detail counts match source collections against a real backfilled dataset | Read-only verification 2026-10-04 via a direct Admin SDK script (the Phase 5 callables are not deployed) against production `(default)` | `listCustomerDirectory` returned real customers (10/55 first page, correct shape/cursor); detail returned correctly. Composite indexes were then deployed and verified. Existing unrelated Firebase Functions are live, but no customer-program callable has been deployed. |
| P5-08 | Performance/cost trace | Engineering | Not started | Query latency/cost measured at production-scale customer counts | Not yet available | Not meaningful against emulator/synthetic data |
| P5-09 | Accessibility/usability report | UX | Not started | A reviewer exercises the console with the flag on | Not yet available | Rules and callables are both deployed now (2026-10-04/05); only turning `platformFeatureFlags/customersConsole` on and an authorized reviewer remain |
| P5-10 | Phase 5 gate review | Required owners | Not started | All Phase 5 evidence complete, including performance/accessibility | Not yet available | Keep the feature flag off until remaining evidence and ownership decisions pass |

## Phase 5 gate checklist

- [x] Every directory/detail read is bounded, paginated, and role-gated.
- [x] Raw assessment responses are structurally unreachable from this phase's read paths.
- [x] Consent and audit data are withheld from `customer_support` at the service layer.
- [x] The console UI is inert unless an explicit, non-client-writable feature flag is on.
- [x] ES-only customers are never shown as TSA participants.
- [x] Existing TSA/customer-program emulator regressions pass together with the new Phase 5 suite.
- [x] Reconciliation against real backfilled data is complete. (2026-10-04; see P5-07)
- [ ] Performance/cost trace at production scale is complete. (Not meaningful yet — only 55 real customers exist; deferred until closer to real usage volume)
- [ ] Accessibility/usability review with the flag enabled is complete. (Rules and Cloud Functions are both deployed now; only turning the flag on and a human reviewer remain)
- [ ] Written Phase 5 pass decision is recorded.

## Phase 6 work register

| ID | Deliverable | Owner | Status | Pass criteria | Evidence | Decision/notes |
| --- | --- | --- | --- | --- | --- | --- |
| P6-01 | Bounded, cursor-paginated participant read | Data + Engineering | Passed locally | Participants are scoped to `programIds array-contains "executive-signature"`; every list query is bounded and paginated | `functions-admin/customer-program-service.js` `listEsParticipants`; `tests/customer-program-phase6-es-workspace.test.js` | Reuses Phase 5's `directoryRow`/`openDuplicateCustomerIdSet` helpers and the existing `customers` composite index; no new index required |
| P6-02 | Bounded, cursor-paginated attempt read | Data + Engineering | Passed locally | Attempt rows carry result metadata only; `responseParts` is never read by this function | `functions-admin/customer-program-service.js` `listEsAttempts`; same test file | Ordered by `completedAt desc`; bounded pagination verified structurally regardless of accumulated emulator data |
| P6-03 | Configuration summary read | Data + Engineering | Passed locally | Definitions/versions are summarized; question/scoring/content payloads are excluded | `functions-admin/customer-program-service.js` `getEsConfiguration`; same test file | A `questionCount` replaces the full `questions` array |
| P6-04 | Data governance (consent/retention) read contract | Data + Privacy | Passed locally | Consent events are gated to `platform_owner`/`privacy_data_admin`; the retention summary is visible to every ES-operations role | `functions-admin/customer-program-service.js` `getEsDataGovernance`; same test file | Mirrors Phase 5's `getCustomerDetailForStaff` restricted-state pattern |
| P6-05 | Raw-response reveal authorization and audit | Security + Privacy + Engineering | Passed locally | Only `platform_owner`, `privacy_data_admin`, or a flagged `es_program_lead` may reveal; every reveal writes an audit event that never contains raw answer content | `functions-admin/index.js` `requireRawResponseAccess`; `functions-admin/customer-program-service.js` `revealAssessmentResponse`; same test file | Plain `customer_support` and an unflagged `es_program_lead` are both rejected before any attempt data is read |
| P6-06 | Callable authorization (ES operations reads) | Security + Engineering | Passed locally | `listEsParticipants`, `listEsAttempts`, `getEsConfiguration`, `getEsDataGovernance` require `canReadEsOperations()`'s role set | `functions-admin/index.js`; same test file | `read_only_analyst` and `tsa_program_lead` are explicitly rejected |
| P6-07 | Off-by-default release flag | Release + Engineering | Passed locally | The workspace is inert unless `platformFeatureFlags/esWorkspace.enabled == true`; no client write path exists for the flag | `firestore.rules` `platformFeatureFlags` match block (unchanged, already generic to any flag ID); admin UI flag check | Turning the flag on is a manual, non-client Firestore write by a trusted operator |
| P6-08 | Required UI/data states and reveal UX | UX + Engineering | Passed locally | Overview/Participants/Attempts/Configuration/Data governance implemented; the reveal is a distinct two-step gesture (open → type a reason → confirm) only on Attempts | `admin/index.html` `#section-es-overview` through `#section-es-governance`; `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_6.md` | The reveal never runs automatically when an attempt row or detail is opened |
| P6-09 | TSA/repository regression | TSA owner + QA | Passed locally | Existing Firebase suites green; no Phase 6-attributable static failure | Phase 6 evidence doc | 72/85 static pass, 12 emulator-only skips, 1 pre-existing typography baseline failure (unchanged cause) |
| P6-10 | UI/data reconciliation against real data | Data + QA | Passed | Participant and attempt counts match source collections against a real backfilled dataset | Read-only verification 2026-10-04 via a direct Admin SDK script against production `(default)` | `listEsAttempts`, `getEsConfiguration`, and `getEsDataGovernance` all work correctly against production (0 ES attempts/entitlements, since Phase 4 only backfilled TSA data — expected and correct). `listEsParticipants` initially failed with a missing-composite-index error (see P5-07); fixed by deploying `firestore.indexes.json`. After the index finished building, re-verified: `listEsParticipants` returns 0 rows, matching the 0 ES entitlements actually in production |
| P6-11 | Performance/cost trace | Engineering | Not started | Query latency/cost measured at production-scale participant/attempt counts | Not yet available | Not meaningful against emulator/synthetic data |
| P6-12 | Accessibility/usability report | UX | Not started | A reviewer exercises the workspace, including the reveal confirm flow, with the flag on | Not yet available | Rules and callables are both deployed now (2026-10-04/05); turning `platformFeatureFlags/esWorkspace` on, seeded/real ES test data, and an authorized reviewer remain |
| P6-13 | Phase 6 gate review | Required owners | Not started | All Phase 6 evidence complete, including performance/accessibility and access ownership | Not yet available | Keep the feature flag off until remaining evidence and ownership decisions pass |

## Phase 6 gate checklist

- [x] Every participant/attempt/configuration/consent read is bounded, paginated, and role-gated.
- [x] Raw assessment responses are structurally unreachable from the participant, attempt, and configuration read paths.
- [x] The raw-response reveal authorizes against the caller's own server-read `platform_staff` document, never a client-supplied flag.
- [x] Every reveal writes an audit event, and that audit event never contains the raw answer content.
- [x] The reveal is a deliberate, explicit, reason-required user action, never automatic on attempt-detail open, and never a bulk export.
- [x] The workspace UI is inert unless an explicit, non-client-writable feature flag is on.
- [x] Existing TSA/customer-program emulator regressions pass together with the new Phase 6 suite.
- [x] Reconciliation against real backfilled data is complete. (2026-10-04; see P6-10 — 0 ES participants/attempts found, correctly matching that Phase 4 only backfilled TSA data)
- [ ] Performance/cost trace at production scale is complete. (Not meaningful yet — 0 ES participants exist; deferred until real ES usage exists)
- [ ] Accessibility/usability review with the flag enabled, including the reveal flow, is complete. (Rules and Cloud Functions are both deployed now; turning the flag on, real/seeded ES data, and a human reviewer remain)
- [ ] A named decision records who may toggle `platformFeatureFlags/esWorkspace` and who, if anyone, holds `rawResponseAccess: true`.
- [ ] Written Phase 6 pass decision is recorded.

## Phase 7 work register

| ID | Deliverable | Owner | Status | Pass criteria | Evidence | Decision/notes |
| --- | --- | --- | --- | --- | --- | --- |
| P7-01 | Self-service workspace-eligibility read | Data + Engineering | Passed locally | A signed-in caller can read which of TSA/ES they are authorized for, read-only, with no side effects | `functions-admin/customer-program-service.js` `getMyEsWorkspaceAccess`; `functions-admin/index.js` `getMyWorkspaces`; `tests/customer-program-phase7-workspaces.test.js` | TSA check stayed in the callable layer, never the cross-program service module, after the existing Phase 2 contract test caught an initial violation |
| P7-02 | Deterministic landing-order resolver | Engineering + UX | Passed locally | Implements the Phase 0 order exactly: deep link, last-visited, only-workspace, chooser, account-help | `assets/workspace-routing.js`; `tests/workspace-routing.test.js` | Pure, dependency-free, dual-use (browser global and Node `require`) |
| P7-03 | Workspace switcher UI in the profile menu | UX + Engineering | In build (first slice) | Identity, current workspace, switch option when 2+ authorized, Account & programs link, org/admin links when authorized, log out | `member-login/content-config.js` `hydrateEsWorkspaceAccess()`, cloned from the proven `hydrateOrganizationAccess()` pattern; verified inert for every real member today (zero ES entitlements exist in production, and the check needs no Firestore rules) | The real member shell is `member-login/content-config.js`, not `index.html`/`programs.html` (that discovery corrected this row). Still missing: a true multi-workspace switch interaction and the reverse link from the ES preview |
| P7-04 | Account & programs page | UX + Engineering | Passed locally | Shows the signed-in person's workspaces, entitlements, and access-help state when none exist | `member-login/content-config.js` `accountEsProgramHtml()`, `renderAccount()`; `tests/member-account-foundation.test.js` | Extended the existing `member-login/account.html` rather than a new page. Only reachable by TSA members today — a fully ES-only customer can't open this page at all, since the shared `requireMember()`/`getMemberAccount()` entry gate assumes TSA membership; tracked as a known gap, not a decision point (no ES-only customers exist yet) |
| P7-05 | ES participant entry wired to entitlements | Data + Engineering | Passed locally | `apps/readiness-assessment` checks a real entitlement via this phase's resolver instead of running in private-preview/sample-data mode | `functions-admin/customer-program-service.js` `getMyEsStatus`; `functions-admin/index.js`/`assets/firebase.js` wrappers; `apps/readiness-assessment/index.html` entry notice; `tests/customer-program-phase7-es-status.test.js` | Entry remains free/open per approved product decision 6 (no new gate); the notice only tells a returning signed-in participant about a real result instead of silently restarting them. Links to the existing `my-results/` page rather than duplicating its rendering |
| P7-06 | Required UI/data states and accessibility | UX | Not started | P0-12's full state list and accessibility contract hold for every new screen | Not yet available | Needs a human accessibility pass; not decision-free |
| P7-07 | TSA/repository regression | TSA owner + QA | Passed locally | Existing Firebase suites green; no Phase 7-attributable static failure | Full emulator regression 2026-10-04 (15 suites together, including Phase 7 workspaces, Phase 7 ES-status, Phase 8, and the new observability scan); static sweep 75/76, same pre-existing typography failure only | — |
| P7-08 | Phase 7 gate review | Required owners | Not started | All Phase 7 evidence complete, including UI, accessibility, and TSA regression with the switcher live | Not yet available | — |

## Future phase gate summary

| Phase | Required success evidence | Automatic failure conditions |
| ---: | --- | --- |
| 1 | 100% emulator contract/rules tests; query/index inventory; TSA rules green | Privilege escalation, cross-tenant access, unplanned scan, TSA rule regression |
| 2 | Concurrency, identity invariants, entitlement matrix, audit samples | Duplicate canonical customer, incorrect merge, TSA access changed |
| 3 | Idempotency, failure injection, scoring reproduction, TSA checksums | Overwritten retake, contradictory state, unreproducible score |
| 4 | Dry-run reconciliation, rerun diff, exception ledger, restore drill | Silent loss, source mutation, duplicate rerun, no restore path |
| 5 | UI/data reconciliation, performance/cost trace, accessibility/usability report | Duplicate people, ES-only in TSA, raw answers in list, unbounded scan |
| 6 | Participant/attempt reconciliation, export/rule tests, aggregate rebuild | Count confusion, export bypass, unaudited raw-answer access |
| 7 | Entitlement route matrix, direct-URL auth tests, accessibility, TSA regression | Unauthorized workspace, MP in ES, hidden-link-only security |
| 8 | Daily parity reports, mismatch dashboard, signed exceptions | Any unexplained access/cohort/reward/credential mismatch |
| 9 | 100% route matrix, redirects, role navigation, TSA end-to-end tests | Lost action, permission bypass, simultaneous data cutover |
| 10 | Signed cutover checklist, canary dashboard, reconciliation, rollback drill | Privacy exposure, incorrect TSA access, data loss, threshold breach |
| 11 | Dependency scan, deletion/export proof, final reconciliation, decommission approval | Unknown consumer, residual undocumented PII, TSA regression |

## Defect policy

- **Sev 1:** data loss, privacy exposure, incorrect access, corrupt scoring, or widespread outage. Blocks the phase and triggers rollback if released.
- **Sev 2:** critical workflow unavailable, materially incorrect totals, or inaccessible critical path. Blocks release unless outside the released scope and formally accepted by product and engineering.
- **Sev 3:** limited defect with a safe workaround. Requires an owner and deadline.
- **Sev 4:** cosmetic or low-impact issue. May enter the backlog.

Privacy, access, and data-integrity failures cannot be waived as ordinary business exceptions.

## Decision log

| Date | Decision | Owner | Consequence |
| --- | --- | --- | --- |
| 2026-10-03 | Approved the seven product defaults in the implementation plan | User/product owner | Plan may proceed to Phase 0 alignment |
| 2026-10-03 | Database, UX, and product reviews approved the direction with conditions | Cross-functional review | Conditions incorporated into plan and Phase 0 register |
| 2026-10-03 | Profile dropdown is a workspace switcher, not full program navigation | UX review | Program-specific links remain inside each workspace |
| 2026-10-03 | Free, paid, comped, and sponsored classify an entitlement, not a person | Cross-functional review | A customer may hold multiple differently funded entitlements |
| 2026-10-03 | Phase 0 contract drafted from repository evidence and cross-functional conditions | Implementation review | Gate remains open pending business/privacy/technical approvals and named owners |
| 2026-10-03 | Business owner approved all recommended Phase 0 defaults | Wen-Szu | Phase 0 passed; Phase 1 emulator-only work may begin |
| 2026-10-03 | Wen-Szu holds required accountability roles on an interim basis until delegated | Wen-Szu | Production gates must reconfirm privacy, release, and operations ownership |
| 2026-10-03 | Phase 1 architecture and security gate passed in isolated Firebase emulators | Wen-Szu, interim technical/security/TSA owner | Phase 2 identity and entitlement work may begin in emulator only; production deployment remains unauthorized |
| 2026-10-03 | Phase 2 identity and entitlement gate passed in isolated Firebase emulators | Wen-Szu, interim product/technical/security/TSA owner | Phase 3 immutable ES persistence may begin in emulator only; production deployment remains unauthorized |
| 2026-10-04 | Phase 3 immutable ES persistence gate passed in isolated Firebase emulators | Wen-Szu, interim product/technical/privacy/TSA owner | Phase 4 may begin only with local tooling, synthetic dry runs, and restore/reconciliation preparation; production access and deployment remain unauthorized |
| 2026-10-04 | Phase 4 local migration, reconciliation, conflict, TSA-isolation, and restore drills passed | Wen-Szu, interim product/technical/privacy/TSA owner | Interim decision superseded later the same day by the signed production pass below |
| 2026-10-04 | Phase 5 scoped initially to local/emulator work behind an off-by-default feature flag | Wen-Szu, interim product/technical/privacy/TSA owner | Historical scope decision made before Phase 4 passed; Phase 5 is now in verification with real-data reconciliation complete |
| 2026-10-04 | Phase 6 scoped initially to local/emulator work behind an off-by-default feature flag | Wen-Szu, interim product/technical/privacy/TSA owner | Historical scope decision made before Phase 4 passed; Phase 6 is now in verification with zero-record production reconciliation complete; no bulk raw-response export or access grant was added |
| 2026-10-04 | Signed the restricted production baseline (P4-08 item 1): 55 `authorized_members`, 54 `users`, 2 `organizations`, 0 rows in any customer-program-platform collection, read from the `cpp-phase4-baseline` clone (never from the live `(default)` database) | Wen-Szu | Baseline checksums recorded in the P4-08 evidence row; the full record (containing real member names/emails) is kept locally outside synced storage, not in this repository |
| 2026-10-04 | Accepted the `cpp-phase4-baseline` clone as satisfying both the baseline capture and the "export restored and verified in isolated nonproduction" requirement (P4-08 items 1 and 2), since a Firestore clone is Google's own atomic export+restore mechanism and counts/checksums were already verified directly against it | Wen-Szu | P4-08 checklist items 1 and 2 checked off; item 3 (dry-run review and operating window) is next |
| 2026-10-04 | Generated and reviewed the production dry-run plan (P4-08 item 3, exceptions half): 55 records, 0 named exceptions, 1 soft warning, 53 planned TSA enrollments | Wen-Szu | Plan checksum `88f3ddc68cdf22ef02c2478f7b8cbb2408c87945df360c1432f5f71d80652852` recorded in the P4-08 evidence row; the operating window (batch size, rate, maintenance timing, rollback owner, stop conditions) still needs explicit approval before any apply; reconciliation remains outstanding |
| 2026-10-04 | Approved the production operating window (P4-08 item 5): batch size 25, halt on any checksum mismatch, rollback owner Wen-Szu, no special maintenance window since the backfill is purely additive and Phase 5/6 remain feature-flagged off | Wen-Szu | `scripts/customer-program-production-apply.js` built and verified against the Firestore emulator (confirmation guard, batching/checkpointing, idempotent replay, exception quarantine/acknowledgment) before any production use |
| 2026-10-04 | Executed the production apply (P4-08 item 6, apply half): 55/55 records applied, 0 skipped, 0 exceptions, checkpointed at 25/50/55 | Wen-Szu | First production write in this plan. Additive only — `authorized_members`, `users`, and `organizations` were not modified |
| 2026-10-04 | First reconciliation attempt reported FAILED despite `matched=55, mismatched=0`; root-caused to the reconciliation tooling comparing the raw baseline file against the plan's `sourceChecksum`, which was computed from the baseline merged with live Auth users — not a real data problem | Wen-Szu | Fixed `scripts/customer-program-production-dry-run.js` to emit the merged snapshot via `--snapshot-out`; renamed the reconcile CLI's input to `--source-snapshot` with a usage message explaining why; added a regression test (`tests/customer-program-phase4-production-tooling.test.js`) asserting a plan's `sourceChecksum` only matches the snapshot it was actually built from |
| 2026-10-04 | Re-ran reconciliation with the corrected source snapshot (P4-08 item 6, reconciliation half): PASSED — `sourceUnchanged=true`, `planned=55`, `matched=55`, `mismatched=0` | Wen-Szu | Phase 4's production backfill gate is complete; see the Gate decision record for the full Phase 4 pass decision |
| 2026-10-04 | Began Phase 5/6's "reconciliation against real data" evidence (P5-07, P6-10) now that production has real customer data. Verified `listCustomerDirectory`, `getCustomerDetailForStaff`, `listEsAttempts`, `getEsConfiguration`, and `getEsDataGovernance` directly against production (read-only, via a local script calling the service module directly — not yet via deployed Cloud Functions, since no Cloud Function has ever been deployed in this project) | Wen-Szu | All five functions returned correct results. Found `listEsParticipants` failing on a missing composite index |
| 2026-10-04 | Discovered zero Firestore composite indexes had ever been deployed to production (`firebase firestore:indexes` returned an empty list) — not a Phase 5/6-specific defect, true since the project began; every prior phase's gate decision explicitly withheld production deployment | Wen-Szu | Approved and executed the first production deployment of any kind in this project: `firebase deploy --only firestore:indexes` — index-only, no Firestore rules, Cloud Functions, or data changed. Chosen as the lowest-risk possible deployment category: adds query capability, cannot break any currently-working behavior |
| 2026-10-04 | Index build completed; re-verified `listEsParticipants` against production: returns 0 rows, correctly matching that Phase 4 only backfilled TSA data (no Executive Signature entitlements exist yet) | Wen-Szu | P5-07 and P6-10 ("reconciliation against real backfilled data") both pass. Remaining before Phase 5/6 can fully pass: performance/cost trace (not meaningful yet at 55 customers / 0 ES participants) and an accessibility/usability review of the live UI, which requires a first Cloud Functions deployment — not yet authorized |
| 2026-10-04 | Authorized and executed the first Cloud Functions deployment of this plan: `firebase deploy --only functions:admin-actions` | Wen-Szu | Every function in `functions-admin/index.js` is now live, including all customer-program-platform callables (`getCustomerDirectory`, `getCustomerDetailForStaff`, `listEsParticipants`, `listEsAttempts`, `getEsConfiguration`, `getEsDataGovernance`, `revealAssessmentResponse`, `getMyWorkspaces`, plus the Phase 2 identity/entitlement callables). Zero exports were removed from the source file, so the deploy was purely additive for pre-existing functions (all updated successfully) and purely additive for new ones (all created successfully); verified live with a probe call returning `401 unauthenticated` rather than 404/500. Firestore rules were deliberately NOT deployed in the same step: the admin UI's feature-flag read already fails closed and harmlessly on a permission error, and a rules deploy is reasoned about separately below |
| 2026-10-04 | Decided not to bundle a Firestore rules deployment with the Cloud Functions deployment, even though the admin console's client-side feature-flag read needs deployed rules to ever succeed | Claude (flagged for owner awareness, not yet a separate explicit approval) | The implementation plan scopes "backward-compatible rules" deployment as Phase 10 work, and the index-deployment discovery that *no* Firestore resource had ever been deployed via this pipeline before means the live rules' actual baseline is unverified by this project's own tooling. Functions use the Admin SDK and bypass rules entirely, so this did not block the functions deployment. Turning the Phase 5/6 feature flags on for a real accessibility review still requires this rules deployment as a distinct, later decision |
| 2026-10-04 | Began Phase 7 (member workspaces and switcher) at the local/emulator level, ahead of Phase 6's formal pass, since only Phase 6's production-dependent evidence (performance/accessibility) remains open and its product/security substance already passed — mirroring the exact precedent set when Phase 5 began under the same condition relative to Phase 4 | Wen-Szu (authorized via "figure out phase 7 and beyond... keep pushing forward and implement" once verified and no decision is needed) | Built and fully emulator-verified `getMyWorkspaces` (self-service workspace-eligibility read) and `resolveLandingWorkspace` (deterministic landing-order resolver). An existing Phase 2 static contract test caught a real architecture-boundary violation in the first draft (a TSA dependency leaking into the cross-program service module) before it reached the tracker as evidence; fixed by relocating that logic to the callable layer. Nothing from Phase 7 has been deployed or pushed; see `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_7.md` for full evidence and remaining scope |
| 2026-10-04 | Authorized the remaining Cloud Functions deployment step flagged above, and instructed planning and decision-free execution of the full remainder of the project (Phases 7–11), explicitly permitting coordinated background agents to parallelize the work | Wen-Szu ("please plan out for the rest of the project... kick off anything that does not require my decision... it is okay to kick off other agents") | Deployed the full `functions-admin` Cloud Functions codebase to production. Wrote `docs/CUSTOMER_PROGRAM_PLATFORM_PHASES_7_TO_11_PLAN.md`, breaking every remaining phase into decision-free work versus owner decisions, in order, with a coordination log. Ran four background agents in parallel, each scoped to non-overlapping new files and verified independently afterward (re-running their tests myself, spot-checking specific factual claims against the real code, confirming via file-modification timestamps that none touched another stream's files): Phase 8 TSA shadow-verification tooling, Phase 9's action-level admin route/capability matrix (~140 actions catalogued), and the ES participant app's entitlement-aware entry notice, plus my own foreground work extending the Account page, writing the Phase 10 rules-deployment risk assessment, and building the Phase 10/11 observability-scan and dependency-scan tooling. Every new/changed test passes individually and together in one combined emulator run (15 suites); the full static sweep remains at exactly the one pre-existing `typography-system.test.js` failure. One real documentation inconsistency was caught and fixed: the Phase 7 doc's "not yet built" list still named the Account page and ES-entry work as outstanding after they were actually completed, left stale because the work happened across my own edits and a concurrent agent's edits without a sync pass — corrected before this entry was written. Nothing from any of this was pushed to `main` or deployed beyond the one authorized Cloud Functions step |

| 2026-10-05 | Verified the live Firestore ruleset against `firestore.rules` before authorizing a deploy, per the Phase 10 risk assessment: fetched the live ruleset read-only and diffed it against the repo file | Wen-Szu (ran the read-only commands) | The diff was empty — the live ruleset (deployed 2026-05-23, updated 2026-09-18, both before this platform project began) is byte-for-byte identical to `firestore.rules` today. The "unknown baseline" risk named in the Phase 10 doc is resolved; a rules deploy is now a verified content no-op, effectively zero-risk |
| 2026-10-05 | Deployed `firestore.rules` to production: `firebase deploy --only firestore:rules --project the-untaught-lessons` | Wen-Szu ("let's kick it off") | Deploy completed cleanly. Verified it actually took effect (not just a reported success) by re-fetching the live release: new ruleset `18d2ae5e-d32b-44ba-bbda-79ce48fe2ebe`, `updateTime` now `2026-10-05T01:16:07Z`. Content was pre-verified identical to what was already live, so this carries no behavior change; it establishes the deployment through this project's own tracked tooling for the first time. Phase 10 step 2 (backward-compatible rules) is complete. Step 3 (functions) and step 4 (migration) were already done; steps 1 (indexes) likewise. Remaining: step 5 (flags), step 6 (internal access — who may toggle a flag, who holds `rawResponseAccess`), step 7 (limited cohorts), step 8 (general availability) — all owner decisions |
| 2026-10-05 | Ran Phase 8's TSA shadow-verification tool against real production data for the first time: `node scripts/tsa-shadow-verification.js --project the-untaught-lessons` | Wen-Szu (ran the read-only command) | `legacyMemberCount=55 matchedCount=26 mismatchedCount=29 orphanedShadowCount=0`. A reason-code tally on the full report showed all 29 mismatches are exactly one code, `organization_mismatch` — zero `missing_customer_projection`, zero `missing_enrollment_projection`, zero `cohort_mismatch`, zero `enrollment_status_inconsistent_with_active_member`. Root cause confirmed in code (`scripts/customer-program-migration.js` line ~193: every Phase 4 enrollment was created with `organizationId: null`, by construction, never populated). This is good news, not a regression: every member's identity, cohort assignment, and access status match perfectly; only one rebuildable projection field was never filled in. Built and emulator-verified a corrective, additive-only `scripts/tsa-enrollment-organization-backfill.js` (plan/apply, never overwrites a non-null `organizationId`, writes an audit event per change, idempotent on replay) in response. Running its `plan` command against production (read-only) and authorizing `apply` are the next steps, pending owner review |
| 2026-10-05 | Authorized and ran `scripts/tsa-enrollment-organization-backfill.js apply --project the-untaught-lessons --confirm-production-write the-untaught-lessons` after reviewing the `plan` output (29 enrollments, all cleanly mapping to `admu-fin` or `ayalaland`) | Wen-Szu | Applied cleanly. Independently verified with a direct read-only query (not just trusting the apply command's own report, since its first printed output was confusingly empty — explained below): 29 `enrollment_organization_backfilled` audit events exist; a sample enrollment now shows `organizationId: "admu-fin"` as planned; of 53 total TSA enrollments, exactly 29 now carry an `organizationId` (the other 24 legitimately have none, since their cohorts have no organization mapping). The apply command's own first printed result (`[]`, `Counts: {}`) was misleading only because it recomputes its plan fresh at the start of every invocation and the fix had already been fully applied by the time that particular invocation ran (most likely an earlier duplicate run of the same command) — not a sign anything went wrong. A fresh `plan` run immediately before and after confirmed 29 → 0 remaining, consistent with success. Phase 8's organization-projection gap is now resolved in production |

## Active production-adjacent resources

Temporary copies of production data created while working a gate must be listed here until deleted, so a verification copy never becomes a forgotten secondary location for customer PII (see the "Retention/deletion leaves secondary PII" risk below). Per owner instruction (2026-10-04), nothing in this table is deleted proactively — deletion happens only on the owner's explicit decision, not automatically once a step completes.

| Resource | Purpose | Created | Contains | Deletion plan |
| --- | --- | --- | --- | --- |
| Firestore database `cpp-phase4-baseline` in `the-untaught-lessons` | Phase 4 production baseline capture and isolated restore-verification target (clone of `(default)` at snapshot time 2026-10-04T04:02:00Z) | 2026-10-04, via `firebase firestore:databases:clone` | A full point-in-time copy of production Firestore, including `authorized_members`, `users`, `organizations`, and all customer-program collections | Phase 4 is now fully passed, so this is safe to delete whenever the owner chooses via `firebase firestore:databases:delete cpp-phase4-baseline`; not deleted automatically per owner instruction |
| Local file `~/phase4-production-artifacts/baseline-2026-10-04.json` (outside any synced/project folder, `chmod 600`) | Signed record backing the P4-08 baseline checksums | 2026-10-04, via `scripts/customer-program-production-baseline.js` against the clone above | Raw `authorized_members`/`users`/`organizations` rows (real names/emails) plus the empty customer-program-platform collections, as of the baseline snapshot | Owner decides when; not in the repository and not inside Google Drive sync, so it is not distributed anywhere by staying in place |
| Local file `~/phase4-production-artifacts/dry-run-plan-2026-10-04.json` (outside any synced/project folder, `chmod 600`) | The originally reviewed and applied production dry-run plan backing the P4-08 plan checksum | 2026-10-04, via `scripts/customer-program-production-dry-run.js` (baseline above plus one read-only Firebase Auth `listUsers` call against live production) | The planned target record for all 55 identity resolutions, including real names/emails, deterministic customer IDs, and per-record checksums | Owner decides when; not in the repository and not inside Google Drive sync |
| Local file `~/phase4-production-artifacts/dry-run-plan-2026-10-04-reconcile.json` and `~/phase4-production-artifacts/source-snapshot-2026-10-04.json` | Regenerated plan and its paired merged source snapshot (baseline + live Auth users), created to fix a reconciliation-tooling bug (see decision log) | 2026-10-04, via `scripts/customer-program-production-dry-run.js --snapshot-out` | Same content class as the baseline/plan above; `planChecksum` matches the original run exactly, confirming no data drift | Owner decides when; not in the repository and not inside Google Drive sync |
| Local file `~/phase4-production-artifacts/apply-result-2026-10-04.json`, `~/phase4-production-artifacts/reconciliation-2026-10-04.json` (failed attempt, tooling bug), and `~/phase4-production-artifacts/reconciliation-2026-10-04-v2.json` (passed) | Records of the production apply and reconciliation runs | 2026-10-04, via `scripts/customer-program-production-apply.js apply` / `reconcile` | Per-record apply results and the reconciliation report (customer IDs, checksums, match status — no raw PII beyond what the plan already contains) | Owner decides when; not in the repository and not inside Google Drive sync |

## Risk register

| Risk | Severity | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- |
| New ES work changes TSA access or progress | Critical | Additive model, legacy authority, feature flags, checksums, shadow comparison | TBD | Open |
| Duplicate canonical customers | Critical | Transactional email claims and Auth links | TBD | Open |
| Raw responses exposed | Critical | Server-only writes, least privilege, rules tests, audited reveal | TBD | Open |
| Backfill cannot be reversed | Critical | Pre-export, restore drill, migration ledger, checksums | TBD | Open |
| Admin loses existing TSA capability after navigation move | High | 100% route/capability matrix and separate navigation release | TBD | Open |
| Participant/attempt counts are confused | High | Separate tables, labels, metrics, and reconciliation | TBD | Open |
| Retention/deletion leaves secondary PII | Critical | Data-class matrix and end-to-end deletion tests | TBD | Open |

## Gate decision record

| Phase | Decision | Date | Approvers | Conditions or notes |
| ---: | --- | --- | --- | --- |
| 0 | Pass | 2026-10-03 | Wen-Szu, business/product/TSA owner and interim technical/privacy/release/operations owner | Phase 1 authorized for emulator-only implementation; no production deployment authorized |
| 1 | Pass | 2026-10-03 | Wen-Szu, business/product/TSA owner and interim technical/privacy/release/operations owner | Contract, rules, indexes, payload sizing, and TSA regressions passed; Phase 2 is emulator-only and no production deployment is authorized |
| 2 | Pass | 2026-10-03 | Wen-Szu, business/product/TSA owner and interim technical/privacy/release/operations owner | Concurrency, identity, email-change, duplicate, entitlement, audit, idempotency, readiness compatibility, and TSA regressions passed; Phase 3 is emulator-only |
| 3 | Pass | 2026-10-04 | Wen-Szu, business/product/TSA owner and interim technical/privacy/release/operations owner | Immutable response parts, versioned consent/scoring, reproducibility, retakes, projections, outbox persistence, and TSA regressions passed; Phase 4 remains local/synthetic until its production prerequisites are explicitly approved |
| 4 | Pass | 2026-10-04 | Wen-Szu, business/product/TSA owner and interim technical/privacy/release/operations owner | Production baseline signed, dry-run reviewed (0 exceptions), production apply completed (55/55 applied, 0 exceptions), and reconciliation passed (matched=55, mismatched=0, sourceUnchanged=true). Phase 4 fully passed, local and production. Phase 5/6's own production-dependent evidence (reconciliation/performance/accessibility against real data) remains outstanding before either phase's feature flag may be turned on |
