# Organization console foundation

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

The first two items are implemented locally but have not been pushed or deployed as of September 17, 2026.

1. Completed locally: create organization records, scoped membership rules, UTL access administration, and a conditional workspace entry for approved representatives.
2. Completed locally: build a read only organization console for assigned cohorts.
3. Next recommended build: add draft roster preparation with UTL approval.
4. Add platform wide aggregate metrics for UTL owners and admins.
5. Add scheduled reports only after metric definitions have been validated against real cohorts.

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
