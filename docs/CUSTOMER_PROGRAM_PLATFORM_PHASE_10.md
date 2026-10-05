# Phase 10 — Controlled Production Release

Last updated: 2026-10-05
Scope: indexes, backward-compatible rules, functions, migration, flags, internal access, limited cohorts, and general availability, in that exact order, each with a written go/no-go decision and an observation window (per the implementation plan's "Phase 10 — Controlled production release")
Status: 4 of 8 ordered steps complete

## Where this project actually stands against the required order

| Step | Status | Evidence |
| --- | --- | --- |
| 1. Indexes | Done, 2026-10-04 | `firebase deploy --only firestore:indexes`; see Phase 4/5/6 decision log entries |
| 2. Backward-compatible rules | Done, 2026-10-05 | Live ruleset verified byte-identical to `firestore.rules` before deploy (empty diff); `firebase deploy --only firestore:rules` released successfully; re-verified live via the Firebase Rules API (new ruleset `18d2ae5e-d32b-44ba-bbda-79ce48fe2ebe`, `updateTime` 2026-10-05T01:16:07Z) |
| 3. Functions | Done, 2026-10-04 | `firebase deploy --only functions:admin-actions`; every `functions-admin` export live |
| 4. Migration | Done, 2026-10-04 | Phase 4 production backfill: 55/55 applied, reconciled |
| 5. Flags | Not done | `platformFeatureFlags/customersConsole` and `/esWorkspace` remain unset (default off) |
| 6. Internal access | Not done | No named decision on who may toggle a flag or hold `rawResponseAccess: true` |
| 7. Limited cohorts | Not done | Depends on flags/internal access |
| 8. General availability | Not done | Depends on everything above |

Indexes, functions, migration, and rules all landed ahead of the plan's literal single-event ordering because each was authorized individually as its own narrow, low-blast-radius decision when a specific need arose (the Phase 5/6 reconciliation evidence needed indexes; the Phase 5/6 accessibility review needs functions; the rules deploy was verified as a content no-op before being authorized). That is consistent with the plan's intent — each step still got its own explicit go decision — just not executed as one single "Phase 10 release" event.

## Rules-deployment risk assessment (step 2) — resolved, deployed 2026-10-05

This section is kept as a record of how the decision was made, not as a pending item.

### What would actually be deployed

`firestore.rules` is a single file; a deploy replaces the entire live ruleset atomically, not just the lines that changed. The file currently contains both the pre-existing legacy TSA/member/organization rules (`users`, `authorized_members`, `organizations`, `public_credentials`, `credential_issuance`, `access_requests`, `google_group_sync_jobs`, `support_preview_audit`, `settings`, `assessment_item_attempts`, `assessment_item_reviews`, `tsa_scoring_comparisons`, and several `users/{userId}/...` subcollections) and the new customer-program-platform additions (`customers`, `customerEmailClaims`, `customerAuthLinks`, `platform_staff`, `platformFeatureFlags`, `programs`, `assessmentDefinitions`, `assessmentVersions`, `enrollments`, `entitlements`, `assessmentAttempts`, `consentEvents`, `duplicateCandidates`, `auditEvents`, `outboxEvents`, `serviceRequests`, `migrationRuns`, `programAggregates`). Every one of these behavioral suites has been passing together in the emulator throughout Phases 1–7 (`member-account-rules.behavior.test.js`, `organization-console-rules.behavior.test.js`, `readiness-assessment-account.test.js`, `customer-program-platform-rules.behavior.test.js`), which is strong evidence the new blocks don't regress TSA behavior *as modeled in the emulator*.

### Why this needs its own decision rather than being bundled with anything already done

The Firestore-indexes deployment on 2026-10-04 revealed that **no Firestore resource of any kind had ever been deployed through this project's tooling before** — the first production deployment in this entire project's history was that index deploy, the same day the functions deploy happened. That means there is no confirmed record, inside this project, of what ruleset is actually live in production today, or how it was put there (the Firebase console UI directly, an older unversioned script, etc.). The emulator suites prove the rules *in this repository* behave correctly; they cannot prove the rules *currently live in production* match this file, because nothing in this project has ever compared the two.

### The concrete pre-deployment step this document recommends

Before authorizing this deploy, fetch and read the actual live ruleset (read-only, no risk) and diff it against `firestore.rules` in this repository. This cannot be done by Claude in this session — the auto-mode classifier blocks `gcloud`/credential-bearing commands run directly, by design, the same way every other production-adjacent command in this project has been handed to the owner to run directly. The command, to be run in the owner's own terminal (it only reads, never writes):

```sh
curl -s -H "Authorization: Bearer $(gcloud auth application-default print-access-token)" \
  "https://firebaserules.googleapis.com/v1/projects/the-untaught-lessons/releases/cloud.firestore" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['rulesetName'])"
```

That prints the active ruleset's resource name; fetching that resource (`GET https://firebaserules.googleapis.com/v1/{rulesetName}`) returns its actual rule source text, which can then be diffed by eye or with `diff` against `firestore.rules`. If the live content turns out to already match this file closely (plausible — someone may have deployed rules directly through the Firebase console at some point outside this project's own tooling), the risk here is much lower than it looks on paper. If it's materially different, that's exactly the kind of fact this project's existing discipline says should be surfaced before a decision, not after.

### Rollback plan if a deploy does regress something

Firestore rules deployments are versioned automatically by Firebase (every deploy creates a new ruleset and a new release pointing at it; the previous ruleset is not deleted). The fastest rollback is through the Firebase console's Firestore Rules history view: select the prior version and republish it, which takes effect immediately and requires no code deploy. This should be confirmed and, ideally, rehearsed once (view the history list, identify the pre-deploy version by timestamp) before the real deploy, so the rollback path is known rather than discovered during an incident.

### Recommendation

Do the read-only live-ruleset fetch above first. Then decide whether to deploy `firestore.rules` as its own isolated step (recommended — it is the only remaining way to observe something before compounding it with a flag/cohort decision), separate from turning any feature flag on. Deploying rules alone changes nothing visible: no flag is on, so no new UI surface becomes reachable; the only behavior change is that `platformFeatureFlags/*` reads start succeeding instead of failing closed (and they still return "not enabled" either way, since no flag document has been set to `enabled: true`).

### Verified 2026-10-05

The owner ran the read-only fetch. The live ruleset (`projects/the-untaught-lessons/rulesets/7fae3e7a-0065-4148-b162-a6ed63372c56`, created 2026-05-23, last updated 2026-09-18 — both before this platform project began) is **byte-for-byte identical** to this repository's `firestore.rules`, confirmed with a direct `diff` (empty output). This means whatever deployed the live rules already carries every customer-program-platform addition, even though no deploy of this file had happened through this project's own tracked tooling before. The open question of "what's actually live" from the risk assessment above is resolved: there is no unknown baseline, and a deploy of `firestore.rules` today is a verified content no-op. Proceeding is now effectively zero-risk; it only establishes the deployment through this project's own tracked history.

## Steps 5–8: flags, internal access, cohorts, general availability

These are not prepared by this document beyond what's already recorded elsewhere, because each is a business decision this project's tooling cannot make:

- **Flags (step 5):** turning on `platformFeatureFlags/customersConsole` or `/esWorkspace` is a single Firestore document write (`{ enabled: true }`), trivial to execute once decided, and trivial to reverse (write `false`). The decision is *when* and *for whom it becomes visible* (see internal access), not how.
- **Internal access (step 6):** already flagged as open in the Phase 5 and Phase 6 gate checklists — a named decision is needed on who may toggle each flag, and on which named individuals (if any) should hold `rawResponseAccess: true` on their `platform_staff` document. Nothing should be turned on generally until this is named.
- **Limited cohorts (step 7):** requires deciding who the first real users of the Customers console and ES workspace are (which staff members, in what order) and for how long they operate before wider rollout — a staffing/process decision, not an engineering one.
- **General availability (step 8):** requires the performance/cost trace and accessibility review still open on Phase 5/6 (P5-08/09, P6-11/12), which in turn need real usage data and a human accessibility reviewer exercising the live UI — neither of which can be produced by this tooling in advance of real use.

## Observation-window instrumentation

P0-15 (`docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_0.md`) specifies what to track and alert on before any release observation window begins. None of it requires a decision to build; it has simply not been built yet because there has been no release to observe. What exists today versus what P0-15 calls for:

| P0-15 signal | Exists today? | What it would take |
| --- | --- | --- |
| Function latency and error rate | Partially — Cloud Functions automatically reports these to Cloud Monitoring for every deployed function, unconfigured | Build a Cloud Monitoring dashboard/alert policy over the already-emitted metrics; no code change needed, only configuration |
| Rules-denied spikes | Not yet | Firestore also emits security-rules-denial metrics to Cloud Monitoring automatically once rules are live; same as above, configuration only |
| Customer-resolution conflicts, duplicate claims | Buildable now | A simple scheduled read of `duplicateCandidates` where `status == "open"`, grouped by age — same query shape already used by `scripts/tsa-shadow-verification.js` and the Phase 4 reconciliation tooling |
| Orphan attempts/response parts/entitlements/enrollments | Buildable now | The Phase 8 shadow-verification tool's orphan-detection logic is the direct template; a similar read-only scan over `entitlements`/`assessmentAttempts` for records with no resolvable `customerId` |
| Outbox retries and dead letters | Buildable now | A read of `outboxEvents` where `status` indicates a dead letter, per the schema's outbox contract |
| Migration throughput/errors/retry age | Exists | `migrationRuns/{runId}` documents already carry `checkpoint`/`counts`/`status`; this is just reading them |
| TSA login/progress/reward/credential/organization regressions | Covered differently | This is what Phase 8's shadow verification is for, plus the existing TSA emulator behavioral suites re-run as a regression gate before and after any production change |
| Firestore read/write/index/storage cost | Not yet | Needs the Google Cloud Billing/Firestore usage dashboard, a console-configuration task, not something this repository's tooling produces |
| Dual-read divergence | Not applicable yet | No screen performs a dual read today (every screen reads either legacy or new, never both for the same decision); this becomes relevant only if Phase 8's shadow verification ever graduates into an actual dual-read comparison at request time, which is not currently planned |

Building the buildable-now items (duplicate-candidate age, orphan scan, outbox dead-letter read) as actual scripts is reasonable decision-free follow-up work, structurally identical to the Phase 8/11 tooling already built — not done in this pass to avoid growing this already-large parallel effort further without a checkpoint; recorded here so it's ready to pick up next.

## What this document does not do

It does not deploy anything, and it does not decide anything. It exists so that when the business owner is ready to authorize the rules deployment (or any of steps 5–8), the risk, the verification step, and the rollback path are already known rather than discovered in the moment.
