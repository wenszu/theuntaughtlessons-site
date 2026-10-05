# Phases 7–11 Execution Plan

Last updated: 2026-10-04
Purpose: break the remainder of the implementation plan (`docs/CUSTOMER_PROGRAM_PLATFORM_IMPLEMENTATION_PLAN.md`) into decision-free engineering work that can proceed now, versus decisions only the business owner can make, in dependency order, and record who/what is actively working on which piece so parallel work stays coordinated.

## How to read this

For each phase: what it is, what genuinely needs an owner decision, what can be built and verified locally without one, and the dependency that gates it from the phase before it. "Decision-free" means the work can be designed, built, tested in the emulator, and documented without needing the business owner's judgment call — it still never touches production or gets pushed to `main` without a separate, explicit authorization, exactly as every prior phase in this project has worked.

## Coordination log

Update this table whenever a work stream starts or finishes, so two sessions or agents never duplicate or collide on the same files.

| Work stream | Phase | Scope (files) | Status | Owner/agent | Started |
| --- | --- | --- | --- | --- | --- |
| Account & programs page (done), workspace switcher | 7 | `member-login/content-config.js` | Done | Claude (foreground) | 2026-10-04 |
| ES participant app wired to real entitlements | 7 | `apps/readiness-assessment/**`, new self-service `getMyEsStatus` in `functions-admin/customer-program-service.js` + `functions-admin/index.js` + `assets/firebase.js` | Done, independently verified | Background agent | 2026-10-04 |
| TSA shadow verification tooling | 8 | New: `scripts/tsa-shadow-verification.js`, `tests/tsa-shadow-verification.test.js`, `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_8.md` | Done, independently verified | Background agent | 2026-10-04 |
| Action-level route/capability matrix | 9 | `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_9.md` (doc only; no code changes) | Done, independently verified | Background agent | 2026-10-04 |
| Observability scan tooling (buildable-now P0-15 signals) | 10 | New: `scripts/platform-observability-scan.js`, `tests/platform-observability-scan.test.js` | Done, independently verified | Claude (foreground) | 2026-10-04 |
| Dependency scanner for legacy-field retirement | 11 | New: `scripts/legacy-field-dependency-scan.js`, `tests/legacy-field-dependency-scan.test.js`, `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_11.md` | Done, independently verified | Background agent | 2026-10-04 |
| Phase 10 rules-deployment risk assessment | 10 | `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_10.md` (doc only) | Done | Claude (foreground) | 2026-10-04 |

## Phase 7 — Member workspaces and switcher

Status: in build locally (see `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_7.md`). Backend resolver, routing logic, and the first workspace-switcher UI slice are done and verified.

Decision-free remaining work:
- Extend the existing Account page (`member-login/account.html` via `renderAccount()`/`accountPageHtml()`) to show a Programs section.
- Wire `apps/readiness-assessment` to real entitlement checks instead of sample data (still gated behind it staying a private preview — no change to its hosting/visibility).
- Add the required UI/data states (P0-12) and an internal accessibility pass (keyboard, focus, zoom, 375/768px) to whatever UI gets built.
- Re-run the full TSA/customer-program emulator regression after each UI change.

Needs an owner decision before it can go further than "built and verified locally":
- Whether/when to push any of this to `main` (which is live via GitHub Pages).
- Whether `apps/readiness-assessment` stops being a private preview.

## Phase 8 — TSA shadow verification

What it is: compare the new cross-program projections (`customers`, `enrollments` with `programId == "tsa"`) against the legacy TSA sources (`authorized_members`, `users`, `settings/cohorts`, reward/credential collections) while every TSA screen keeps reading only the legacy sources. Every mismatch must be resolved or formally approved — TSA remains authoritative until this passes (TSA protection rule 10).

Why it can start now: it depends on Phase 4's backfill (done) and the legacy TSA collections (unchanged, always available), not on Phase 7's UI. It is a read-only comparison tool, structurally the same shape as Phase 4's reconciliation tooling.

Decision-free work (being built now): a comparison script and report, emulator-tested with synthetic fixtures covering exact match, a legacy member never backfilled, a backfilled customer with no matching legacy member (should not happen, but must be detected if it does), and a cohort/reward/credential count mismatch.

Needs an owner decision:
- Disposition of any real mismatch the tool finds once run against production (approve as a named, explained exception, or fix the data).
- Who signs the Phase 8 gate.

## Phase 9 — Final admin information architecture

What it is: relocate existing TSA admin capability into `Programs → TSA`, move organization/operations areas, while preserving every legacy deep link and backend behavior exactly. P0-11 already maps every current admin section to its destination, but explicitly requires expansion "to action/dialog/export/deep-link level" and 100% execution of that expanded table before this phase can pass.

Why the matrix comes first, separately from the restructuring: `admin/index.html` is a large, live, daily-used file (TSA admin operations, the Customers/ES consoles added in Phases 5/6). Restructuring it is a big, mechanical, high-blast-radius change. Expanding the route matrix to full fidelity first — and reviewing it — makes the actual restructuring a mechanical execution of an already-verified checklist instead of an improvisation against a huge file. That expansion is happening now as a documentation task with no code changes, so it cannot collide with any other work stream.

Decision-free work: the matrix expansion itself (research + documentation).

Needs an owner decision:
- Review and approval of the expanded matrix before the actual relocation begins (it changes where every admin capability physically lives, which is worth a human look before a big mechanical edit starts).
- The restructuring implementation itself should happen as its own sequential pass after that review, not in parallel with other admin/index.html work.

## Phase 10 — Controlled production release

What it is, in the plan's own required order: indexes, backward-compatible rules, functions, migration, flags, internal access, limited cohorts, general availability — each with a written go/no-go decision and an observation window.

Where this project actually stands against that list: indexes — done (2026-10-04). Functions — done (2026-10-04). Migration — done (Phase 4, 2026-10-04). Rules, flags, internal access, cohorts, and GA — none have happened.

Decision-free work: writing the pre-deployment risk assessment for the rules deployment specifically (what's in the diff, what the "first deployment of any kind" discovery implies about the unverified production baseline, a rollback plan if something regresses) so that step is fully prepared whenever the owner decides to authorize it. Also: specifying the observation-window dashboards/queries from P0-15's metrics contract, so they exist before they're needed.

Needs an owner decision, each one separately, in order: authorize the rules deployment; decide who may toggle each `platformFeatureFlags` document and who (if anyone) holds `rawResponseAccess: true` (already flagged as open in the Phase 5/6 gate checklists); decide internal/staff-only access scope; decide the limited-cohort rollout (who, how many, for how long); decide general availability. None of these can be made by an AI assistant — they are product, legal/privacy, and operational calls for the business owner.

## Phase 11 — Stabilization and legacy retirement

What it is: monitor data integrity, privacy queues, support, performance, and TSA stability after release; remove compatibility fields only after a dependency scan proves zero consumers.

Why the scanner can be built now even though the monitoring can't: there is no real post-release data to monitor yet (Phase 10 hasn't shipped), but the dependency scanner that will eventually justify removing compatibility projections is a static-analysis tool over the current codebase, fully decision-free and independent of everything else.

Decision-free work (being built now): a script that greps the repository for references to each candidate-for-removal legacy/compatibility field (e.g. the `productSummary`/legacy readiness projection fields) and reports whether any consumer still exists, with a test asserting it correctly finds a known planted reference and correctly reports clean when none exists.

Needs an owner decision:
- Everything about the actual post-release monitoring and the final decommission approval, which cannot happen before Phase 10 ships real traffic.

## What this plan does not do

It does not attempt Phase 10's release decisions or Phase 11's post-release monitoring, because those are not implementable without real production traffic and explicit business decisions that belong to the owner, not to this tooling. Everything listed as "decision-free work" above is being built, tested, and documented now; everything listed as "needs an owner decision" is recorded here so it is visible and ready to act on the moment a decision is made, rather than being discovered late.
