# Organization console foundation

> **Platform note (2026-10-09):** the platform has moved from Firebase to Supabase. Where this file mentions Firebase, Firestore, Google Apps Script or Node 20 functions, read `docs/SUPABASE_PLATFORM.md` first for the current state and rules; that guide wins on any conflict.


## Current status

Verified 2026-10-04 against source, git history, and the deployed-functions inventory:

- **Static UI:** Current organization/admin/member UI is in the GitHub Pages source on `main`.
- **Deployed callables:** `getOrganizationConsole`, `getMyOrganizationAccess`, `getOrganizationAccessAdmin`, `saveOrganizationDefinition`, `checkOrganizationRepEmail`, and `saveOrganizationAccessMember` are deployed.
- **Source-only callables:** `submitOrganizationRosterDraft`, `reviewOrganizationRosterDraft`, and `sendWeeklyOrganizationReports` exist in `functions-admin/index.js` but are absent from the deployed inventory.
- **External dependency:** Whether the live Apps Script contains the `WeeklyOrgReport` dispatch cannot be established from this repository and needs an owner check.
- **Dated handoffs below:** Retained as implementation history. Where they contradict this summary, this summary and the deployed inventory take precedence.

## What Phase 1 does

Phase 1 prepares the existing internal Admin Console for more cohorts and future organization access. It adds optional organization and lifecycle fields to the existing `settings/cohorts` map. Existing cohorts require no migration and appear as Active when no status has been saved.

No client can access the Admin Console as a result of this work. Firestore rules and the current `owner`, `admin`, and `member` access checks remain unchanged.

## Phase 2 read only console

The first organization-facing console is available at `/member-login/organization.html`. It is intentionally separate from the UTL Admin Console. It shows aggregate progress, cohort summaries, and a limited learner roster for the organization and cohorts assigned to the signed-in organization user.

The page reads through the verified `getOrganizationConsole` callable function. It does not query `authorized_members`, `users`, exercise answers, learner goals, internal notes, or sign-in details directly. The function validates the caller's organization membership before returning a sanitized response.

Organizations are created explicitly, not inferred from cohort IDs. A UTL owner or admin adds an organization once (name plus a stable ID, auto-suggested from the name and editable only at creation) in **Admin console → Member Management → Organization access**, then assigns each of its cohorts to it from the cohort's own detail panel in Cohort Analytics — a dropdown listing every organization on file, not a free-text field. The two pilot organizations are set up the same way as any other:

| Organization | Cohorts |
| --- | --- |
| AyalaLand | `TSA-03-ALI-01` |
| Ateneo de Manila University | `TSA-01-ADMU-01`, `TSA-02-ADMU-02` |

`beta-user`, `No cohort`, blank cohorts, and other unassigned learners remain individual enrollments. They are not placed into a synthetic organization and never appear in an organization console. A cohort's `organizationId` pointer that doesn't resolve to a real, existing organization (a stale reference to one that was never created, or a value typed outside the dropdown) is silently ignored rather than ever creating a phantom organization.

An organization can be archived (not deleted) when a client relationship ends, from the same admin panel. Archiving immediately revokes console access for any of that organization's representatives, while keeping the record and its history intact for later reactivation.

### Granting client access

Organization console access is never inferred from a learner's email domain or cohort. A UTL owner or admin must create an active membership record at:

`organizations/{organizationId}/members/{uid}`

Required fields are `uid`, `organizationId`, `role`, and `status: active`. Cohort-scoped roles also require `assignedCohortIds`. Until this record exists, the person cannot open the organization console.

UTL owners and administrators manage these records through **Admin console → Members & Access → Organization access**. The form shows the exact organization, role, cohort scope, visible information, and excluded information before a grant is saved. Organization Owner and Program Manager cover every cohort in the selected organization. Cohort Facilitator and Report Viewer require at least one selected cohort.

The representative must first sign in to UTL once so Firebase Authentication has a verified account to attach to the grant. Access can be suspended and reactivated. The record stays in place so its history remains reviewable.

Every grant, edit, suspension, and reactivation creates an audit record containing the representative, prior and next scope, the UTL administrator who made the change, and the timestamp. This audit trail is visible only in the UTL admin console.

### Test coverage

- Unit tests cover ALI and ADMU mapping, individual exclusions, role-to-cohort scoping, sanitized learner output, aggregate calculations, and the callable-only client architecture.
- Firestore Emulator tests cover same-organization reads, cross-organization denials, signed-out denials, and denied client writes.
- UTL administrators can preview both mapped organizations through the same callable without granting client access.

## Role model

UTL platform roles and organization roles must remain separate. An organization role must never satisfy the existing UTL admin check.

### UTL platform roles

| Role | Purpose | Scope |
| --- | --- | --- |
| Owner | Security, billing, platform roles, and final control | Every organization and cohort |
| Admin | Day to day program operations | Every organization and cohort |
| Support, future | Resolve access and learner support issues | Minimum learner data needed for support |
| Analyst, future | Review cross program performance | Read only aggregate and permitted learner data |

### Organization roles

| Role | Purpose | Recommended access |
| --- | --- | --- |
| Organization Owner | Accountable client lead | Organization settings, managers, every cohort, reports |
| Program Manager | Runs the learning program | Assigned organization cohorts, rosters, analytics, reports, draft invitations |
| Cohort Facilitator | Supports a specific group | Assigned cohorts and learner support signals only |
| Report Viewer | HR sponsor, buyer, or leader | Read only reports and aggregate analytics |
| Roster Coordinator, future | Prepares participant lists | Draft rosters only, with no learner performance data |

Learners keep the existing Member role. A person may hold more than one organization role, but access is always limited to an explicit organization and, where applicable, assigned cohorts.

## Workspace entry

The profile menu shows **Organization console** only when the signed in user has an active organization membership with at least one permitted cohort. The access check returns only the organization name, organization role and permitted cohort count. It does not load learner records or analytics until the person opens the console.

The entry stays hidden for ordinary learners, individual enrollments and UTL administrators who do not hold an explicit organization membership. This keeps organization access separate from UTL platform administration.

## Future security shape

Do not add organization roles to `authorized_members.role`. That field currently protects UTL wide access.

When the organization console is approved, use organization scoped membership records such as:

`organizations/{organizationId}/members/{uid}`

Suggested optional fields:

| Field | Type | Purpose |
| --- | --- | --- |
| `role` | string | Exact organization role enum |
| `assignedCohortIds` | array of strings | Limits facilitators and managers where needed |
| `status` | string | invited, active, suspended, removed |
| `invitedAt` | timestamp | Audit trail |
| `invitedBy` | string | UTL admin UID |

Every organization console query must be scoped by `organizationId`. Roster changes should begin as drafts and require UTL approval during the first release.

## Cohort lifecycle

The internal cohort record now accepts these optional fields:

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `organizationName` | string | empty | Human readable client name |
| `organizationId` | string | empty | Stable organization key for future linking |
| `status` | string | `active` | draft, upcoming, active, completed, archived, or cancelled |
| `endDate` | date string | empty | Planned or actual cohort end date |

Completed means the cohort has finished but remains part of normal reporting. Archived means the cohort is hidden from the working list by default. Archive is a display choice and never deletes learner or analytics data.

## Platform metric definitions

These definitions should be fixed before an organization dashboard is built.

| Metric | Definition |
| --- | --- |
| Enrolled learners | Unique active member records with a program enrollment |
| Learners who started | Unique learners with at least one meaningful program activity |
| Program completers | Unique learners who completed every required core activity |
| Video starts | Unique learner and video pairs with a recorded Vimeo play event |
| Video completions | Unique learner and video pairs that reached the configured 80 percent threshold |
| Exercise completions | Unique learner and exercise pairs with a completed result |
| Time invested | Estimated active exercise time plus recorded Vimeo playback time; label as an estimate |

Platform totals should exclude UTL test accounts where a reliable test account marker exists. Counts must state their date range and denominator. Public claims require manual review before publication.

## Later phases

Items 1–2 shipped (pushed and deployed) between the Sep 17 and Sep 18 handoffs below. Items 3–5 were built in the Sep 23–25 pass — pushed to git and live on the static site, but **the Cloud Functions side is not yet deployed** (see the Sep 25 handoff for exactly what that gates).

1. Done and live: create organization records, scoped membership rules, UTL access administration, and a conditional workspace entry for approved representatives.
2. Done and live: read only organization console for assigned cohorts.
3. Done, pending Cloud Functions deploy: draft roster preparation with UTL approval (`organizations/{orgId}/roster_drafts`).
4. Done and live: platform-wide aggregate metrics — split across two surfaces rather than one dashboard: **Platform overview** (admin, per-organization operational breakdown) and **Program adoption** (Engagement Insights, a reach/engagement/outcomes funnel for the whole program). See the Sep 25 handoff for why they're separate.
5. Done, pending Cloud Functions deploy and one manual Apps Script paste-in: scheduled weekly stats emails, opt-in per organization.

## September 17, 2026 handoff

### What is implemented locally

- Cohort records accept optional organization and lifecycle metadata. Individual and unassigned learners remain outside organization consoles.
- `/member-login/organization.html` provides a read only organization view through the verified `getOrganizationConsole` callable.
- Firestore rules protect organization records and prevent organization users from reading raw learner collections or writing organization data directly.
- **Admin console → Member Management → Organization access** lets a UTL owner or admin grant, edit, suspend, or reactivate a representative's organization access and cohort scope.
- `getMyOrganizationAccess` returns the minimum metadata needed to decide whether the signed in user should see the Organization Console entry.
- The workspace profile menu shows that entry only for an active organization membership with at least one permitted cohort. It fails closed and stays hidden for ordinary learners.

### Verification completed

- JavaScript syntax checks passed for `functions-admin/index.js`, `assets/firebase.js`, and `member-login/content-config.js`.
- `git diff --check` passed.
- The complete automated suite passed: 70 tests.
- The Firebase Auth and Firestore Emulator behavior test passed, including same-organization access, cross-organization denial, signed-out denial, and organization-user write denial.
- A final local HTTP smoke test after the latest menu change was not rerun because the environment would not allow the local server to restart. This was an environment limitation rather than a reported code failure.

### Deployment state

Nothing in this organization-console pass has been pushed or deployed. The working tree also contains an unrelated untracked `visual/` directory; preserve it unless its owner confirms it should be included.

Production activation requires three separate release steps:

1. Deploy the reviewed `firestore.rules` changes.
2. Deploy the Firebase callable exports used by the console and access management: `getOrganizationConsole`, `getOrganizationAccessAdmin`, `saveOrganizationAccessMember`, and `getMyOrganizationAccess`.
3. Push and deploy the static site after the Firebase changes are live.

After deployment, test with three accounts: a UTL owner or admin, an approved organization representative, and an ordinary learner. Confirm that the representative sees only permitted cohorts, the learner does not see the menu entry, and cross-organization access is denied.

### What to build next

The safest next product slice is roster preparation without account creation or invitations:

1. Add an organization-scoped roster draft with `draft`, `submitted`, `approved`, and `rejected` states.
2. Allow only approved organization roles to prepare or submit a roster for their permitted cohorts.
3. Let only a UTL owner or admin approve it.
4. Do not create learner access, send email, or modify `authorized_members` when a draft is submitted. Those actions belong in a later, separately approved release.
5. Test organization isolation, cohort scope, duplicate email handling, invalid rows, and resubmission before adding any onboarding automation.

## September 18, 2026 handoff — organizations made first-class

The Sep 17 design had organizations existing only as a byproduct of cohort tagging (a hardcoded pilot-org constant, merged with whatever cohorts happened to declare an `organizationId`/`organizationName`). That made an organization impossible to create ahead of its first cohort, impossible to rename in one place, and vulnerable to a typo silently creating a second, phantom organization. This pass makes organizations directly manageable:

- New callable `exports.saveOrganizationDefinition` (`functions-admin/index.js`) supports `create` / `rename` / `archive` / `reactivate`, admin-gated the same way as every other admin callable, writing directly to `organizations/{orgId}` (already permitted by the existing `allow write: if isAdmin();` rule — no rules change needed) plus an audit-log entry in the same batch.
- Removed the hardcoded `ORGANIZATION_DEFAULTS` constant and the `organizationIdForCohort()` regex inference (both the server copy and its client-side twin in `admin/index.html`). `mergeOrganizationDefinitions()` now reads real organization documents plus each cohort's `organizationId` pointer — a pointer that doesn't resolve to a real organization is silently dropped, never auto-creating a phantom one.
- Fixed a real access-control gap: archiving an organization now actually revokes its representatives' console access (`organizationMembershipsForCaller` previously checked only the membership's own status, never the parent organization's).
- **Admin console → Member Management → Organization access** gained an "Organizations" panel (add / rename / archive / reactivate) directly above the existing representative-access form, which now sources its organization list from real records instead of an inferred one. The Cohort Analytics cohort-detail panel's two free-text organization fields became one dropdown sourced from that same list.
- Also fixed: the organization dropdown getting stuck on "Loading organizations…" forever on any fetch failure (it previously only updated a different panel on error, never itself).
- `tests/organization-console.test.js` and `tests/organization-access-admin.test.js` were rewritten to fixture explicit organization/cohort data instead of relying on the removed hardcoded defaults; `tests/organization-console-foundation.test.js` was updated for the removed free-text cohort field. `tests/organization-console-rules.behavior.test.js` (the emulator-based isolation test) needed no changes — it already seeded organizations as plain `{name, status}` documents, which matches this simplified model.
- Deployment state is unchanged from Sep 17: nothing in the organization-console feature has been pushed or deployed. The same three release steps apply, with `saveOrganizationDefinition` added to the list of callables that must be deployed alongside the others.

### September 18, 2026 follow-up — design pass after first live review

A first pass through the rebuilt "Organizations" panel surfaced three UI defects and two usability gaps, all now fixed:

- The "Add an organization" fields and the "Set emergency password" button had layout bugs (mismatched field heights and a cramped button) from CSS the new panel didn't inherit; both now match the alignment and spacing rules already used elsewhere on the page.
- The Role dropdown in "Add a representative" had no explanation of what each role means — an admin had to select a role, then an organization, before the existing "Can see / cannot see" preview would even appear. A one-line description now shows under the Role field immediately and updates as the selection changes, and the preview box no longer sits blank when organization data hasn't loaded.
- New callable `exports.checkOrganizationRepEmail` (`functions-admin/index.js`) plus a "Check" button next to the representative email field let an admin confirm someone has signed in to UTL before filling out the rest of the grant — previously that only surfaced as a failure after clicking Grant access. This was a deliberate choice over two alternatives: restricting the field to the internal Members list (wrong, since organization representatives are typically external client contacts who are never enrolled learners) or building full autocomplete over every Firebase Auth user (bigger surface area, deferred).
- `saveOrganizationDefinition`, `getOrganizationConsole`, `getMyOrganizationAccess`, and `getOrganizationAccessAdmin` were re-audited end to end against `firestore.rules` and each other: organization documents and membership records are admin-write-only, a representative can only ever read their own membership record, the audit log has no client-facing rule at all (server-only via the admin-gated callable), and every self-service query is scoped to the caller's own UID server-side — confirmed no cross-organization leakage is possible even by a client guessing IDs.

## September 25, 2026 handoff — draft rosters, platform overview, program adoption, scheduled reports (and a bug that predates all of it)

This pass built the three items the Sep 17 handoff queued up next ("What to build next" above, and Later phases 3–5). Along the way, live user testing surfaced a chain of real bugs — most self-contained, one serious enough that it had been silently breaking the console's core promise since Sep 17.

### Draft roster submission

The first rep-facing *write* path in this codebase (everything before this was read-only for representatives). Firestore rules already restrict `organizations/**` writes to `isAdmin()`, so submission goes through a new callable rather than a direct client write, matching how every other org-facing mutation already works.

- `organizations/{orgId}/roster_drafts/{draftId}`: `organizationId`, `cohortId`, `rows: [{name, email}]` (capped at 25 — deliberately small; this is "propose a handful of people," not a bulk-import tool), `status` (`submitted`/`approved`/`rejected`, no separate unsubmitted `draft` state in this MVP — a rep just submits directly), submitter/reviewer uid+email+timestamps, `reviewNote`.
- New callable `submitOrganizationRosterDraft`: rep-gated (not admin-gated) by a new `ORGANIZATION_ROSTER_PROPOSAL_ROLES` Set (`organization_owner`, `program_manager`, `cohort_facilitator` — **not** `report_viewer`, matching its existing read-only framing everywhere else), validated against `allowedCohortsForMembership()` so a rep can only propose into a cohort they already have access to.
- New callable `reviewOrganizationRosterDraft`: admin-gated the same way as every other admin callable. Approving sets `status: "approved"` **immediately** (a deliberate choice, confirmed with the user, over gating it on the admin actually finishing the resulting bulk-add — simpler semantics, and "approved" means "an admin looked at this and greenlit it," not "learners were definitely created").
- Approving does **not** create accounts, send email, or touch `authorized_members` itself — per this doc's own Sep 17 caution. Instead, the admin-side "Approve & open in bulk add" action opens the *existing, already-tested* bulk-add wizard (`admin/index.html`), pre-filled with the draft's cohort and rows, jumping straight to its existing review step. Everything downstream — the editable per-row review table, ready/skip/error states, `mbBulkProcess`, welcome email, sign-in invite — is the unmodified existing bulk-add code path. This was the main design goal: no second, parallel account-creation path to keep in sync with the first.
- Admin UI: a new "Roster proposals" panel in **Member Access → Organization access**, with its own "How roster proposals work" collapsible guide matching the existing "How organization access works" guide's exact pattern.
- Rep UI: a "Propose a roster" card on `member-login/organization.html`, gated client-side on role (server re-validates regardless), with a plain 3-step instructions list and a simple repeatable name+email row form — no CSV/paste, since this is for a handful of people.

### Platform overview

A new nav item under **Student Progress**, generalizing the existing single-organization Overview dialog's aggregation across every organization at once, plus an explicit "Individual / unassigned" row for cohorts not tied to any organization (never silently folded into one, per this doc's own rule). Pure client-side aggregation over data already fetched elsewhere — no new Cloud Functions. Reuses `oaOpenOverview()` for per-organization drill-down rather than building a second dialog.

Nav ordering note: Platform overview was initially placed *before* Student Progress in the nav (making it the new default landing tab). The user asked for Student Progress to stay first, with Platform overview second — implemented by swapping both the nav-button order and the section markup order so scroll behavior matches nav order.

### Program adoption

Originally built as a "Program adoption" card bolted onto the bottom of Platform overview. The user asked for a redesign: **it now lives as the first tab inside Engagement Insights**, not on Platform overview at all. Reasoning, from the design conversation: Engagement Insights' other tabs (Overview, Videos, Students, Cohorts, Activities) are all diagnostic — "who needs help right now," "which video has a drop-off problem." Adoption answers a different, more strategic question — "how is the whole program doing" — which is the question a caring admin asks *first*, before drilling into specifics. It leads the tab list for that reason.

The metrics are grouped as a funnel rather than one flat grid, since that's how an admin actually reads it:

- **Reach** — total learners, organizations.
- **Engagement volume** — lessons watched (total + avg/learner), exercises completed (total + avg/learner).
- **Outcomes** — started the program, graduates (certificates issued), finish rate.

Every metric uses the same `EI_METRICS` glossary-card pattern (`eiMetricCard`) every other Engagement Insights metric already has — a "How to interpret this metric" expandable with measured-as / what-it-tells-you / combine-with — rather than bare numbers. "Started" reuses `spFurthestPhase(member) !== 'none'` (the same definition Student Progress's own "Phase 1+" filter already uses). "Graduates" counts credentials with `status === 'active'` from the existing credential registry, not a completion-percentage approximation. A "Copy summary" button (same `navigator.clipboard` + `window.prompt` fallback pattern as the Leaderboard's existing share feature) generates a short shareable text blurb of the headline numbers — not a public API, just the easiest first bridge toward the user's stated eventual goal of showing adoption on the public website, which is explicitly **not** in scope yet (confirmed admin-only, no freshness requirement, in the design conversation).

### Scheduled weekly reports

`exports.sendWeeklyOrganizationReports` — the first `onSchedule` (v2 scheduler) function in this codebase. Runs Tuesdays 8am Asia/Manila (confirmed with the user). For each **active** organization with `weeklyReportOptIn: true` and a contact email, sends one **combined** email per organization (not one per cohort — confirmed with the user) via the existing Apps Script relay, reusing `organizationDefinitions()`, `loadOrganizationLearners()`, and `organizationConsoleAggregate()` — the same helpers `getOrganizationConsole` already uses, so the numbers a scheduled email reports match what a rep would see live. Content is **stats-only, deliberately** — no auto-generated narrative, since the manual weekly report's highlight/attention/action fields are human-authored and reviewed per week; automating that text was explicitly ruled out.

- `weeklyReportOptIn` (boolean, default false) — a new field on the organization document, opt-in **per organization**, never a global switch. Off by default so no organization gets an unsolicited email just because the feature shipped.
- `organizations/{orgId}/weekly_report_log/{isoWeekId}` (e.g. `2026-W39`) — one doc per org per week, both the send-idempotency guard against a retried scheduler invocation and a send audit trail.
- The relay-POST logic that used to live only inside `runAdminAction` was factored into a shared `postToAdminRelay(action, payload, requestedBy)` helper, since `onSchedule` triggers have no `request.auth` to reuse the callable's own auth check — `runAdminAction` and the scheduled function now share the same fetch/response-validation logic instead of duplicating it.
- **Still needs a manual step outside this repo**: the Apps Script action allowlist (`ALLOWED_ADMIN_ACTIONS`) now includes `"WeeklyOrgReport"` server-side, but the live Apps Script itself needs one new dispatch line pasted in by hand (documented in `scripts/apps-script-email-actions.gs`, same pattern as every other Apps Script change this project has needed — Claude Code cannot push to that script directly). No new handler function is needed; it reuses the existing generic `handleTemplateEmail`.

### The bug that predates all of it: organization↔cohort attribution never actually worked

While building Platform overview, the user reported every organization showing 0 cohorts and 0 learners — even for organizations with cohorts genuinely assigned in Cohort Analytics. The root cause was not new: `organizationDefinitions()` (`functions-admin/index.js`) read `settings/cohorts` as `cohortSettingsSnap.data().cohorts` — expecting a **nested** `cohorts` field. That field has never existed. Every real writer of that document (`setCohortDetails`/`getCohortDetails` in `assets/firebase.js`, used by Cohort Analytics' save button and cohort renaming) has always stored each cohort's details as a **flat top-level field** on the document, keyed by cohort name.

The practical consequence: `mergeOrganizationDefinitions()` — the function this entire foundation doc's organization model depends on — has **never** been able to see any cohort's real `organizationId` in production, since it was originally built on Sep 17. This means the one-page Organization overview dialog shipped Sep 17–18 has also always shown 0 cohorts for every organization, not just the new Platform overview. It was invisible to the existing test suite because `tests/organization-console.test.js`/`tests/organization-access-admin.test.js` only ever exercised `mergeOrganizationDefinitions()` directly with a pre-shaped flat object, bypassing the buggy extraction line entirely.

Fixed the read to match every actual writer's shape (`cohortSettingsSnap.data() || {}`, no `.cohorts` unwrap). Added a regression test (`tests/organization-console.test.js`) that greps both the writer's and the reader's exact shape, so this specific class of mismatch can't silently reappear. **This fix is in `functions-admin/index.js` and has not been deployed** — see Deployment state below. Until it is deployed, every organization will keep showing 0 cohorts regardless of what's assigned in Cohort Analytics.

### Other real bugs found during testing (all fixed, all front-end, all already live)

Each surfaced from the same underlying cause: Platform overview made the existing Organization overview dialog and its "Edit organization" action reachable from the **Student Progress** tab, when they had only ever been built to be opened from the **Member Access** tab where they physically live.

- **The dialog opened invisibly and got stuck.** A `<dialog>` cannot render while nested inside a hidden ancestor (`section-organization-access` is `hidden` whenever Member Access isn't the active top-level tab). `showModal()` didn't throw, `.open` became `true`, but nothing was visible — and because it was "open," the *next* dialog-open attempt threw (`showModal()` on an already-open dialog), which is what made the bug look inconsistent between different organizations depending on click order. Fixed by moving `#oaOverviewDialog` to a direct child of `<body>`, which is never hidden by tab-switching.
- **Consequence of that fix: the dialog's Close buttons stopped working.** Their listeners were wired once via `document.querySelectorAll('[data-sp-dialog-close]')` at a point in the page's script that runs *before* the (now relocated) dialog exists in the DOM for a synchronous, non-deferred script — so it silently found zero matching buttons. Replaced with one delegated `document.addEventListener('click', ...)` listener, which works no matter where in the page a `[data-sp-dialog-close]` element ends up, now or in the future.
- **"Edit organization" (a button inside that dialog) silently did nothing** when triggered from Student Progress, for the identical hidden-ancestor reason — the edit form populated correctly but stayed invisible. `oaOrgEdit()` now calls `switchAdminTab('member-management')` itself before populating and scrolling to the form.
- **A same-origin `mbRequireFirebaseAdmin()` popup race could corrupt the whole admin session, not just one action.** Firebase Auth's SDK cannot handle two concurrent `signInWithGooglePopup()` calls — the second corrupts the first's internal state (`INTERNAL ASSERTION FAILED: Pending promise was never set`), after which every *other* admin action on the page silently fails too, since they all funnel through the same auth check. This bug is not new, but several sections now auto-load on tab switch (Platform overview joins Cohort Analytics), which made a genuine user click racing an in-flight auto-load call meaningfully more likely to happen in normal use, not just in scripted tests. Fixed by having every caller share one in-flight promise instead of each independently attempting sign-in.
- A weekly-report opt-in checkbox rendered with its label shoved far off to the right of an invisible full-width box, from inheriting the page's global `input, select { width: 100% }` rule (meant for text inputs) onto a checkbox. Given its own explicit width plus a proper label/heading/description, matching the rest of the form.

### Test coverage added this pass

`tests/organization-console.test.js`: `normalizeOrganizationRosterRows()` validation/dedupe/cap, the `settings/cohorts` flat-shape coupling test, page-level assertions for the rep-facing roster form. `tests/organization-access-admin.test.js`: both new callables' admin-gating, the roster-draft-approval-never-touches-`authorized_members` guarantee, the dialog's placement outside any tab-scoped section, the delegated close-listener pattern, `oaOrgEdit`'s tab-switch, the scheduled function's schedule/timezone/relay-sharing, `weeklyReportOptIn` normalization, and the Program adoption tab/panel/metrics-grouping/glossary-entry structure. `tests/security-hardening.test.js` updated for the new `ALLOWED_ADMIN_ACTIONS` entry. Full suite (67 files) green throughout.

### Deployment state

Pushed to `main`, live via GitHub Pages: `admin/index.html`, `assets/firebase.js`, `member-login/organization.html` (commits `5ecb9bc` — an unrelated About-page photo update bundled in the same push — and `e1972ba`).

**Not deployed**: `functions-admin/index.js`. This gates three things at once — deploy with `firebase deploy --only functions:admin-actions` before any of them can work in production:

1. The `settings/cohorts` read-shape fix (every organization will keep showing 0 cohorts until this deploys, independent of anything an admin assigns in Cohort Analytics).
2. The two new roster-draft callables (`submitOrganizationRosterDraft`, `reviewOrganizationRosterDraft`) — the rep-facing form and the admin review panel are both live in the UI already, but calling either callable will fail with a not-found error until deployed.
3. `sendWeeklyOrganizationReports` — also needs the one manual Apps Script paste-in described above before an opted-in organization will actually receive anything.

### What to build next

Nothing queued. The Sep 17 "Later phases" list (draft rosters → platform metrics → scheduled reports) is now fully built end to end; the only remaining work on it is the deploy steps above. Any new organization-console feature should start with a fresh scoping conversation rather than assuming a queued item, since none remain from this doc's original roadmap.
