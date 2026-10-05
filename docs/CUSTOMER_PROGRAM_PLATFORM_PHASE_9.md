# Phase 9 — Action-Level Admin Route and Capability Matrix

Last updated: 2026-10-05
Scope: Expansion of P0-11 (`docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_0.md`) to action/dialog/export/deep-link level, as P0-11 requires before Phase 9 restructuring begins
Status: Matrix reviewed by the owner (published as an artifact for review). Both flagged decisions (findings 1 and 2) resolved 2026-10-05. The broader admin/index.html restructuring into the final IA has not started.

## Decisions resolved (2026-10-05)

- **Finding 1 (two ES homes):** The owner chose to remove the stale "Readiness Assessment" tab and fold its still-useful content into the connected "Executive Signature" tab rather than keep both. Implemented: the old tab, its section, its workspace-nav JS, and its now-orphaned CSS (`.ra-workspace-nav`, `.ra-summary-grid`, `.ra-panel`, `.ra-version-*`, `.ra-status-chip`, `.ra-actions`, `.ra-data-rule`, `.readiness-admin-note`) were all removed from `admin/index.html`. The two links with no ES equivalent (participant-experience preview, research page) were added to ES Overview; the scoring-reference link and a question-inspection link were added to ES Configuration. The stale "40 vs. 60 questions" draft-form card and the already-superseded static "Forms and versions"/"Attempts"/"Results"/"Privacy" placeholder content were not ported, since ES's real Configuration and Data governance panels already cover that ground with live data. Verified: the main admin script block still parses cleanly after removal, and the full static/emulator suites pass unchanged.
- **Finding 2 (unaudited remove-member delete):** The owner's call, on a least-risk assessment, was to give it a proper audited callable rather than formally accept the gap. Implemented: `functions-admin/index.js` `removeMember` (admin/owner-only, via the existing `isAuthorizedAdmin` helper) performs the exact same two deletes (`authorized_members/{email}`, then `users/{uid}` if resolvable) the client used to do directly, and additionally writes an `auditEvents` record (`action: "tsa_member_removed"`, actor, target, removed uid). `admin/index.html`'s Remove button now calls this callable instead of `deleteDoc()` directly; the confirm wording, the best-effort email notification, and the success/error UI are all unchanged. Covered by `tests/member-removal.test.js` (unauthenticated, non-admin, inactive-admin, invalid email, successful removal with and without a matching `users` doc, and idempotent behavior removing an email that was never a member). Not yet deployed — built and emulator-verified only, consistent with how every other production-facing change in this project has been built before its own deploy decision.

## Outcome

P0-11 maps each current admin *section* (one row per tab/panel, e.g. "Member Access / Members") to a transitional and final destination, and states: "Before Phase 9, expand this table to action/dialog/export/deep-link level and execute every row." This document is that expansion, not the execution. It was produced by reading every admin section in `admin/index.html` (34 sections across 10 top-level tabs), tracing each button, dialog, export, and deep link to its concrete handler, and identifying — wherever the code makes it determinable — the exact Firestore collection or callable function it touches via `assets/firebase.js` and `functions-admin/*.js`.

No code has been changed. The actual relocation of `admin/index.html` content into the final `Overview / Customers / Programs → TSA / Executive Signature / Organizations / Communications / Content / Operations` structure is a separate, later, sequential implementation task gated on a human reviewing this document first, per `docs/CUSTOMER_PROGRAM_PLATFORM_PHASES_7_TO_11_PLAN.md`'s Phase 9 entry.

### How to read the matrix

Each P0-11 row becomes a subsection below with the same current tab/section name. Under it:

- **Actions** — each button, toggle, or inline control, what it does, and its backend target (collection via direct `setDoc`/`deleteDoc`/`getDoc`, or callable via `httpsCallable`).
- **Dialogs** — each `<dialog>` or `confirm()`/`prompt()` gate, with exact wording where it matters (wording that names what will be deleted/revoked should not silently change during relocation).
- **Exports** — anything that produces a CSV, JSON, PDF, or image file.
- **Deep links** — any URL with a query parameter or hash that jumps to a specific sub-view, almost all of which point *out* of the admin console (into `member-login` or `apps/`) rather than within it.
- **Preserve exactly** — the specific callable name, collection path, confirm wording, or URL shape that must not change when the surrounding navigation moves.

Admin console writes in this codebase come from two layers, both worth preserving verbatim at relocation time:

1. **Callables** (`httpsCallable(functions, "<name>")`, defined in `assets/firebase.js`, implemented in `functions-admin/index.js` and `functions-admin/customer-program-service.js`) — used for anything role-gated, audited, or added since Phase 2 (organizations, Customers, Executive Signature, credentials, emergency access).
2. **Direct client Firestore calls** (`setDoc`/`deleteDoc`/`getDoc` imported straight from the Firebase SDK) — used for most of the original TSA admin surface (`authorized_members`, `users`, `settings`, and a few newer collections such as `assessment_item_reviews`). These are *not* routed through a callable, so P0-11's "preserve callable behavior" language does not apply to them as written — the correct instruction for these rows is "preserve the exact collection path, document ID shape, and field names," because there is no callable layer to preserve.

## Program / Visibility & access — `section-access-controls`

**Actions:**
- Public homepage visibility checklist (read-only status) and "Refresh status" — reads via `getDoc`/checklist logic, no write.
- Public assessment settings form (Find-Your-Level exercise mode/exercise picker) → "Save public settings" → `setPublicAssessmentSettings()` (writes `settings` doc).
- TSA/diagnostic visibility form → "Save assessment access settings" → `setAssessmentVisibility()` (writes `settings` doc).
- Admin preview settings form → "Save admin preview settings" → `setAdminVisibilitySettings()` (writes `settings` doc).
- Phase content layout editor (drag-to-reorder rows, delete a "context sub-section") for Orientation/Phase 1/2/3 — **this is entirely client-local**: it reads/writes `localStorage` keys `utl_embed_<phaseId>_layout` / `utl_embed_<phaseId>_layout_default` via `savePhaseLayout()`/`phaseLayoutKey()`. It never calls Firestore. See "New findings" below — this matters because P0-11 calls Phase 1-3 content rows "relocate only," but the layout editor embedded in Visibility & access controls what Orientation/Phase 1-3 show, with state that lives only in the admin's own browser.

**Dialogs:**
- "Delete this context sub-section? This cannot be undone unless you reset the layout." (`confirm()`, line ~6003) — gates the `localStorage`-only delete above. Exact wording should be preserved since "cannot be undone" is true only within that browser profile.
- "Preview diagnostic journey nudge" opens `diagnosticNudgePreviewDialog`, a read-only, non-destructive state-by-state preview of the in-app nudge card (no writes).

**Exports:** None.

**Deep links:** None internal; `memberHubPreviewLink` / `welcomeCardPreviewLink` / `welcomeWalkthroughPreviewLink` (in the sibling Preview section, see below) use query/hash parameters into `member-login/index.html`.

**Preserve exactly:** `setPublicAssessmentSettings`, `setAssessmentVisibility`, `setAdminVisibilitySettings` function names and the `settings` document shape they write; the `localStorage` key names for the phase layout editor (a relocation that silently changes these keys would make every admin's saved content-ordering vanish on next load).

## Program / Orientation, Phase 1, Phase 2, Phase 3 — `section-orientation`, `section-phase1/2/3`

**Actions:** Each is a thin wrapper (`<div id="embed-orientation">`, `embed-phase1`, etc.) that the layout editor above renders into. There are no section-specific actions beyond that shared editor.

**Preserve exactly:** The `embed-<phaseId>` container IDs — the layout-editor JS looks them up by exact ID string.

## Student Progress — `section-student-progress`

**Actions:**
- "Refresh progress" → `getAllMemberWorkspaceProgress()` (reads `authorized_members` + per-user `users/{uid}/completed_exercises`).
- Search box and cohort filter (`spSearch`, `spCohortFilter`) — client-side filtering of the already-loaded table, no backend call.
- Row-level actions (found via `data-sp-*` attributes): `data-sp-edit-progress` (opens `spEditDialog` to hand-edit a member's progress fields), `data-sp-reset-progress` (opens `spResetDialog`), `data-sp-repair-bonus` → `repairMemberProgramCompletionReward(userId)`, `data-sp-repair-exercises` → `repairMemberExerciseProgress(userId)`, `data-sp-support-preview` (loads `getMemberSupportSnapshot(email)` + logs via `logMemberSupportPreview()`).
- "Experience preview" (`spPreviewLaunch`/`spPreviewEnd`) — a *browser sandbox* run of the real member experience ("nothing is written to a student or admin Firebase record" per the UI's own copy) using `localStorage` flag `utl_experience_preview_active`.
- Edit-dialog save (`spEditSave`) → `replaceMemberWorkspaceProgress(userId, nextProgress, options)`.
- Reset-dialog submit (`spResetSubmit`, gated by a checkbox, not a text confirm) → `resetMemberWorkspaceProgress(userId)`.

**Dialogs:**
- `spEditDialog` ("Update student progress") — direct field-level progress editing, no confirm beyond the Save click itself.
- `spResetDialog` ("Reset student progress?") — gated by a required checkbox ("I understand that this removes the student's saved learning progress.") rather than a `confirm()`/`prompt()`. This is a *stronger* gate pattern than a plain `confirm()` (it requires an explicit click, not just an OK on a native dialog) and should be preserved as the model for any destructive action moved into the final IA, not weakened to a plain confirm.

**Exports:** None directly in this section (CSV export of the roster lives under Member Access / Members).

**Deep links:** `spPreviewContinue` opens `../member-login/index.html` in a new tab (plain link, no query deep-link into a specific state).

**Preserve exactly:** `replaceMemberWorkspaceProgress`/`resetMemberWorkspaceProgress`/`repairMemberProgramCompletionReward`/`repairMemberExerciseProgress` callable names and signatures; the checkbox-gated reset pattern.

## Platform overview — `section-platform-overview`

**Actions:** "Refresh overview" → loads via `getAllMemberWorkspaceProgress()`/`getCohortDetails()`-derived aggregation (no dedicated callable; computed client-side from the same bulk reads Student Progress uses). No row-level actions — this is a read-only summary table.

**Exports/Dialogs/Deep links:** None.

## Learner readiness — `section-launch-health`

**Actions:** "Refresh readiness" loads the same member/progress data filtered to onboarding/technical-readiness signals; search (`lhSearch`) and cohort filter (`lhCohortFilter`) are client-side only. No write actions found in this section — it is read-only, consistent with P0-11's "Do not confuse with ES" note (this is TSA onboarding readiness, unrelated to the Executive Signature product).

**Exports/Dialogs/Deep links:** None.

## Leaderboard — `section-leaderboard`

**Actions:** "Refresh leaderboard" → `getCohortStanding(metric, previewEmail)` callable; cohort (`lbCohort`) and rank-by (`lbMetric`) selectors re-run the same callable with different parameters.

**Dialogs:** A `window.prompt('Copy this leaderboard text:', text)` (line ~9268) is used as a copy-to-clipboard fallback, not a confirmation — it is informational, not destructive.

**Exports:** None (text is copied via the prompt box above, not downloaded as a file).

**Preserve exactly:** `getCohortStanding` callable name and its `metric`/`previewEmail` parameters.

## Engagement Insights — `section-engagement-insights`

**Actions:** "Refresh insights" → `getAllEngagementAnalytics()` (reads `users/{uid}/analytics_sessions` and `analytics_activity_sessions`) plus `getAllStabilityEvents()`-adjacent data for context. "How engagement metrics work" toggles an inline glossary (`eiGlossary`), no backend call. Two sub-panels, Student engagement and Cohort engagement (`data-ei-panel="students"` / `"cohorts"`), switch the same loaded dataset's view — not separate queries.

**Dialogs:** A `window.prompt('Copy this adoption summary:', text)` (line ~9557) — same copy-to-clipboard pattern as Leaderboard, not destructive.

**Exports/Deep links:** None.

**Preserve exactly:** `getAllEngagementAnalytics`/`getAllStabilityEvents` names and the two subcollection paths they read.

## Cohort Analytics — `section-cohort-analytics`

This is the most feature-dense row in the entire P0-11 table — P0-11 lists it as a single "Unchanged → Programs → TSA → Cohorts" row, but it contains two full report-generation workflows.

**Actions:**
- "Refresh analytics" → cohort aggregation from `getAllMemberWorkspaceProgress()`/`getCohortDetails()`.
- Per-cohort detail view: "Export cohort CSV" (`caExportCsv`), "Create weekly update" (`caExportPdf`, opens `caReportDialog`), "Share cohort encouragement" (`caParticipantUpdate`, opens `cpDialog`).
- A roster filter inside cohort detail (`caRosterFilter`: all/complete/in-progress/not-started) — client-side only.
- Inline cohort rename: `confirm('Rename "' + cohortName + '" to "' + newName + '" for all N member(s)? This updates their records immediately.')` (line ~10075) → `renameCohort(oldName, newName, memberEmails)`, which rewrites the cohort field across every affected member record. This is a bulk, immediate, multi-record write gated by a single native confirm — worth flagging as higher-blast-radius than its one-line confirm suggests.

**Dialogs/report builders:**
- `caReportDialog` ("Create weekly cohort update") — a full form (week, version, date range, milestone, prepared-for, executive summary, highlights, attention items, suggested actions, action owner, name-display mode, MP/focused-time/metric-explanation toggles) that renders a client-side print preview (`caReportPreview`) and offers "Save as PDF" (`caReportDownload`) via the browser's print dialog — not a server-generated PDF.
- `cpDialog` ("Share cohort encouragement") — a second, separate report builder (variation style, week, milestone, headline, intro, next step, include-activities/videos/resumes toggles) targeting a 1080×1350 chat-share image, with "Copy message" (`cpCopy`), "Download image" (`cpDownloadPng`), and "Save as PDF" (`cpDownloadPdf`). It runs a client-side "privacy check" (`cpPrivacyStatus`) before enabling output, consistent with P0-10's small-group suppression intent, but this is a client-side heuristic, not the server-enforced minimum-group-of-5 rule P0-10 specifies for sponsor-facing aggregates — worth a decision on whether this client check is sufficient or needs a server-side equivalent once cohort reports can reach an organization's sponsor.

**Exports:** Cohort CSV (`caExportCsv`), weekly update PDF (print-to-PDF), cohort-encouragement PNG and PDF.

**Deep links:** None.

**Preserve exactly:** `renameCohort` callable name and its "updates their records immediately" confirm wording; the distinction between the two report dialogs (one for internal/client narrative reporting, one for name-free social-style sharing) — they must not be collapsed into one tool during relocation since their privacy postures differ (one includes names by design option, the other is explicitly name-free).

## Readiness Assessment — `section-readiness-assessment` *(see New findings: this is now a stale duplicate of the Executive Signature tab)*

**Actions:** Static workspace-nav tabs (Overview, Forms and versions, Attempts, Results, Scoring reference, Privacy) — all client-side panel switches, no backend calls. Links out to `../apps/readiness-assessment/`, `/research/`, `/how-it-works/`, and `?internal=1` (inspect questions).

**Content:** States "Connected attempts: Not connected" and "No connected attempts yet" throughout — this tab was never wired to real data. A draft-form card explicitly says "Confirm whether the intended product has 40 total questions or 60 total questions before this form receives a version number" — a decision Phase 0 already resolved (Quick Check + Full Assessment, not a 60-question single form), so this card's content is now stale, not just unconnected.

**Preserve exactly:** Nothing — this entire tab is superseded by the connected Executive Signature tab below. See "New findings."

## Executive Signature — `section-es-overview`, `section-es-participants`, `section-es-attempts`, `section-es-configuration`, `section-es-governance`

Fully documented already in `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_6.md`; summarized here for completeness against P0-11's single "Readiness Assessment" row, which this tab actually fulfills (connected, per P0-11's own instruction: "Connect only after data gates").

**Actions:**
- Overview: static orientation panel, no data calls, behind `getEsWorkspaceFeatureFlag()`.
- Participants: `listEsParticipants({ pageSize, cursorCustomerId })`, cursor-paginated, "Load more" (`espLoadMore`).
- Attempts: `listEsAttempts({ pageSize, cursorAttemptId })`, cursor-paginated, "Load more" (`esaLoadMore`).
- Configuration: `getEsConfiguration()` — read-only summaries of `assessmentDefinitions`/`assessmentVersions` (titles, status, version, question *count* only — never content).
- Data governance: `getEsDataGovernance({ pageSize, cursorEventId, canSeePrivileged })` — consent events restricted to `platform_owner`/`privacy_data_admin`; a static P0-10 retention-matrix summary visible to all ES-operations roles; exports are intentionally absent by design (Phase 6's explicit scope decision).

**Dialogs:**
- Raw-response reveal (`esRevealPanel`, triggered per-row by `data-esa-reveal` on Attempts): a two-step gesture — open panel, type a non-empty reason into `esRevealReason`, click "Reveal raw responses" (`esRevealConfirm`) — which calls `revealAssessmentResponse(attemptId, reason)`. This writes an `auditEvents` record server-side before returning data, and is gated server-side by `requireRawResponseAccess()` (not the broader ES-operations role check). This is the single most sensitive action in the entire admin console and the only one in this tab that performs a write.

**Exports:** None (deliberately — Phase 6 explicitly scoped bulk/CSV export of raw responses out).

**Preserve exactly:** All five callable names above; the two-step reveal gesture (never a one-click reveal); the `platformFeatureFlags/esWorkspace` flag gate; the exact role boundary (`requireRawResponseAccess` vs. `canReadEsOperations`).

## Rewards / Levels — `section-reward-levels`

**Actions:** Editable level table (`rewardLevelsBody`) → "Save level settings" (`rewardLevelsSave`) → `setRewardSettings(partial)`; "Reset recommended levels" (`rewardLevelsReset`) restores defaults client-side before save.

**Preserve exactly:** `setRewardSettings` and the `settings` document's level-table field shape.

## Rewards / Rules summary — `section-reward-overview`

**Actions:** None — a static read-only reference table of MP award rules (video, context item, scored/completion exercise, phase/program completion, assessment, streak). No form, no save button.

## Rewards / MP rules — `section-reward-rules`

**Actions:** A large settings form (system enabled/paused, display mode, per-activity MP values, streak settings, exercise mode, daily goal, token toggle disabled) → "Save MP rules" (`rewardRulesSave`) → `setRewardSettings(partial)`; "Reset recommended rules" (`rewardRulesReset`).

**Preserve exactly:** Same `setRewardSettings` writer as Levels — both rows write to the same `settings` document, just different fields. Relocating these to different final destinations (if ever proposed) would need to keep them pointed at the same document.

## Rewards / Award preview — `section-reward-simulator`

**Actions:** Reflection-prompt editor per exercise (`rewardReflectionExercise`, `rewardReflectionPrompt`) → "Save reflection" (`rewardReflectionSave`); "Preview award screen" (`rewardReflectionPreview`) — a non-destructive simulated award-screen render (`rewardQuickLevel`/`rewardQuickMp`), explicitly a preview with no further writes; "Restore recommended wording" (`rewardReflectionReset`).

**Preserve exactly:** "Preview isolation" per P0-11 — confirmed in code: the preview only renders sample numbers, it does not touch any real member's MP or level.

## Member Access / Members — `section-members`

The largest and highest-risk row in the matrix.

**Actions (top bar):** "+ Add member" (`mbAddMemberBtn`, opens inline form), "Bulk add learners" (`mbBulkAddBtn`), "Send login link" (`mbInviteBtn`), "Refresh" (`mbRefreshBtn`), "Download CSV" (`mbDownloadCsvBtn`, exports the full roster).

**Add member flow:** Name/email/role/cohort/notes form → sign-in method choice → "Add member" (`mbAddMemberSave`) → `authorizeMember(email, fields)` (writes `authorized_members/{email}`).

**Bulk add flow:** Paste or CSV-file input (`mbBulkPaste`/`mbBulkFile`, max 500 learners, two-column `name,email` format, downloadable template via `mbBulkTemplate`) → "Review learners" (`mbBulkReview`, client-side validation) → "Add ready learners" (`mbBulkConfirm`, gated by `confirm('Add N learner(s) and send the selected onboarding messages?')`) → `mbBulkProcess()`, which calls `authorizeMember()` per row → results list with "Retry failed items" (`mbBulkRetry`), "Download results CSV" (`mbBulkDownloadResults`), "View cohort members" (`mbBulkViewCohort`).

**Invite flow:** `inviteEmail` + "Send link" (`sendLoginInvite`) → `sendSignInInvite(email)`.

**Per-row actions** (via `data-mb-*` attributes on each table row):
- `data-mb-edit` / `data-mb-save` / `data-mb-cancel` — inline field editing, writes through `authorizeMember()`.
- `data-mb-extend` — "Extend expiry by 1 year" → `authorizeMember(email, { expiryDate })`.
- `data-mb-remove` — **deletes** `authorized_members/{email}` and, if resolvable, `users/{uid}` directly via `deleteDoc()` (not a callable). Gated by: `confirm('Remove ' + email + '?\n\nThis will:\n  ✓ Revoke member workspace access\n  ✓ Delete their Firestore profile\n\nContinue?')`. A best-effort, non-blocking log call (`mbLogRemovedMember`) runs first but failure there does not stop the deletion.
- `data-mb-welcome-resend` — resends the welcome email and records delivery status (`mbRecordWelcomeEmailStatus`) as pending/sent/failed.
- `data-mb-group-mark` — toggles a Google Group added/removed status flag on the member record (not a Google Groups API call itself; see `requestGoogleGroupSyncJob`/`getGoogleGroupSyncJobs`, which write/read `google_group_sync_jobs`, a collection not mentioned anywhere in P0-06's source-of-truth matrix).
- `data-mb-support-preview` — loads `getMemberSupportSnapshot(email)` and logs the preview via `logMemberSupportPreview()`.
- `data-mb-sort` / `data-mb-page` — client-side table sort/pagination.

**Dialogs:** The bulk-confirm and remove-confirm above; also a global "Switch Firebase account" confirm (`'You are signed into Firebase as X, but that account is not marked admin or owner. Switch Google account now?'`, line ~7172) that applies to any write attempt in this section when the signed-in Google account lacks admin/owner role in `authorized_members` — this is an authentication gate shared by the whole Member Access area, not specific to one button.

**Exports:** Roster CSV (`mbDownloadCsvBtn`), bulk-add CSV template (`mbBulkTemplate`), bulk-add results CSV (`mbBulkDownloadResults`).

**Preserve exactly:** `authorizeMember` as the single writer for create/edit/extend; the direct (non-callable) `deleteDoc` pattern for removal, and its exact three-line confirm wording, since it is the one action in this console that both revokes TSA access and deletes a Firestore profile in one irreversible step with no server-side audit write; `sendSignInInvite`; the `google_group_sync_jobs` collection.

## Member Access / Organization access — `section-organization-access`

**Actions:**
- Organization form: name/ID/contact/weekly-report-opt-in → "Add organization" (`oaOrgSave`) → `saveOrganizationDefinition(payload)`; "Cancel edit" (`oaOrgCancel`).
- Representative form: organization picker, email with "Check" (`oaEmailCheck` → `checkOrganizationRepEmail(email)`), role (program manager/organization owner/cohort facilitator/report viewer — matches P0-09's organization roles exactly), access status (active/suspended), cohort checkboxes → "Grant access" (`oaSave`) → `saveOrganizationAccessMember(payload)`.
- Per-row: `data-oa-edit` (edit representative), `data-oa-toggle` (active/suspended toggle), `data-oa-org-edit` (edit organization), `data-oa-org-overview`/`data-oa-overview-edit` (opens `oaOverviewDialog`, a read-heavy per-organization summary), `data-oa-org-toggle` (archive/reactivate an organization).
- Roster drafts: `data-oa-roster-approve` → `oaApproveRosterDraft(org, draftId)` → `reviewOrganizationRosterDraft()`; `data-oa-roster-reject` → `oaRejectRosterDraft(org, draftId)` → `reviewOrganizationRosterDraft()`, preceded by `prompt('Optional note for the representative (why this was rejected):', '')`.
- Audit list (`oaAudit`) — read-only history of access changes.

**Dialogs:**
- `confirm('Archive ' + organization.name + '? Its representatives will lose console access until it is reactivated.')` (line ~12311) — the organization archive action.
- `oaOverviewDialog` — informational only (organization summary), closable via `data-sp-dialog-close`.

**Exports/Deep links:** None.

**Preserve exactly:** `saveOrganizationDefinition`, `saveOrganizationAccessMember`, `checkOrganizationRepEmail`, `reviewOrganizationRosterDraft` callable names; the archive confirm wording (it is the only place that communicates the consequence — "lose console access until reactivated" — to the operator before an irreversible-feeling action that is actually reversible).

## Member Access / Emergency access — `section-emergency-access`

**Actions:** Email + password (minimum 12 characters) → "Set emergency password" (`eaSubmit`) → `setEmergencyCredential(email, password)` callable — the only action in this section.

**Preserve exactly:** `setEmergencyCredential` callable name; this is explicitly a "break-glass" path per P0-11 and should not gain any additional convenience actions during relocation that would weaken its narrow scope.

## Member Access / Legacy local access — `section-passwords`

**Actions:** A collapsed `<details>` panel reveals a single `password-block` control for `utl_admin_password` (default `utl2026_admin`), read/written to `localStorage` only.

**Correction to how this should be described in the final IA:** code confirms this password gate is checked only when `LOCAL_ADMIN_HOST` is true (`hostname` is `localhost` or `127.0.0.1`; see `gateForm` submit handler, line ~11020: `if (!LOCAL_ADMIN_HOST) return;`). It genuinely cannot authenticate a production session — the label "Not production account security" in the UI copy is accurate, not misleading. This is worth stating explicitly in Phase 9 because a reviewer skimming the admin gate code without checking `LOCAL_ADMIN_HOST` could otherwise reasonably suspect it was a live backdoor; it is not.

**Preserve exactly:** The `LOCAL_ADMIN_HOST` guard itself — if this ever relocates without that guard traveling with it, it would need re-verification that it still cannot run against the production hostname.

## Communications / In-app nudges — `section-inapp-nudges`

**Actions:** Engagement-nudge thresholds (days-since-activity, almost-there) → "Save in-app settings" (`engInAppSave`) → `setEngagementSettings(partial)`.

## Communications / Email templates — `section-email-templates`

**Actions:** Template picker (`etSelect`) → `getEmailTemplates()`/`saveEmailTemplate(id, data)`; a live rich-text editor with a toolbar (`etToolbar`) that inserts links/buttons into the template body; a live preview iframe (`etPreview`); a "send test" status line (`etTestStatus`).

**Dialogs:** Toolbar prompts — `prompt('Button text', ...)`, `prompt('Button URL', ...)` (lines ~7635-7637), `prompt('Link URL', 'https://')` (line ~7655) — used to insert a button or link into the template HTML being edited, not confirmations.

**Preserve exactly:** `getEmailTemplates`/`saveEmailTemplate` names; the toolbar's direct HTML-insertion behavior (it writes raw HTML into the template body based on the prompted URL/label, so the eventual relocation must not introduce sanitization that changes previously-saved template HTML).

## Communications / Email nudges — `section-email-nudges` *(not in P0-11 — see New findings)*

**Actions:** Re-engagement day threshold, sender name, reply-to address — but every control in this section (`engEmailForm` carries `class="eng-form is-unavailable"` and `aria-disabled="true"`; inputs carry `disabled`) is disabled, and the Save button reads "Automation not connected" and is itself `disabled`. This is a fully built, fully disabled settings panel for an email-automation feature that does not exist yet.

## Communications / Certificate — `section-certificate`

P0-11 describes this row only as "TSA credential settings," but the section contains a full credential-admin console beyond settings.

**Actions:**
- Settings form (credential title, signatory name/title) → "Save certificate settings" (`engCertSave`) → `setEngagementSettings(partial)` (shares the writer with In-app nudges' settings, different fields).
- Credential lookup: `engCredentialLookupId` (name, email, or credential ID) → "Search" (`engCredentialLookup`) → `searchVerifiedCredentials(queryText)` / `getMemberCredentialRegistry()`.
- Per-result actions (`data-credential-action`): `revoke` (confirm: "Revoke this credential? Its public verification page will immediately show that it is not active."), `reissue` (confirm: "Replace this credential with a new ID? The old public record will show that it was replaced."), `update-name` (no confirm — immediate `manageVerifiedCredential('update-name', id, { recipientName })` call). All three route through `manageVerifiedCredential(action, credentialId, details)`.
- `data-credential-open` — opens a credential directly from another context (e.g., a search result elsewhere) into this lookup box.

**Preserve exactly:** `manageVerifiedCredential`/`searchVerifiedCredentials`/`getMemberCredentialRegistry` callable names and the three action strings (`revoke`/`reissue`/`update-name`) they accept; both confirm wordings, since they are the only place an operator is told the public-facing consequence (verification page shows inactive / shows replaced) before acting — this reaches `credential_issuance`/`public_credentials`, which P0-06 names as a TSA-authoritative collection pair, so this row is also implicitly a TSA-protection-rule-relevant action despite living under Communications.

## Communications / Global defaults — `section-global-defaults`

**Actions:** Shares the `embed-*`-style layout with the Program content tabs in markup position only; functionally it is an engagement-defaults settings form → `setEngagementSettings(partial)` (the umbrella writer also used by In-app nudges and Certificate — all three rows share one `settings` document under different field paths, which must stay reconciled if any one of them relocates independently).

## Content Data / Data files — `section-cl-files`

**Actions:** File list (`clFileListInner`) → opening a file loads it into a textarea editor (`clTextarea`); "Validate JSON" (`clValidateBtn`, client-side validation only); "Download revised JSON" (`clDownloadBtn`, exports the edited file — there is no in-place save/publish action in this section; the operator must download the file and commit it through the normal repository workflow).

**Exports:** The edited-JSON download is the only output; there is no write-back to any server location from this screen, consistent with P0-11's "Relocate only."

## Content Data / Assessment content review — `section-cl-question-bank`

**Actions:**
- TSA scoring toggles (Speak/Act GenAI) + status (`tsaScoringStatus`) → `getTsaScoringSettings()`/`setTsaScoringSettings()`.
- Assessment-form preview accordions (Parts 1a/1b/2/3) — each "Preview" button opens a learner-view exercise rendering; explicitly stated as non-saving ("Preview answers are temporary and are never saved as learner results").
- Question bank list (`qbList`) with search (`qbSearch`) and format filter (`qbFormat`); "Download spreadsheet" (`qbDownloadCsv`), "Download JSON" (`qbDownloadJson`).
- Quality/health panel (`qbHealthPanel`): assessment selector (`qbAssessment`), "Refresh" (`qbRefreshHealth`), "Download health CSV" (`qbDownloadHealth`); a 13-column health table per question (version, difficulty, response count, correct rate, diagnostic/checkpoint rates, rate change, median time, changed-answer rate, quality-report count/rate, discrimination, health label, review status) with `data-qb-jump` links that scroll to a question's detail card.
- Per-question review widget (inside each question's detail): status dropdown (Active/Watch/Revise/Retired), decision-note textarea, "Save review" (`data-qb-review-save`) → **direct client `setDoc(doc(db, 'assessment_item_reviews', questionId), {...}, { merge: true })`** — not a callable, and `assessment_item_reviews` is a collection not named anywhere in P0-06's source-of-truth matrix (see "New findings").
- A separate CSV/JSON download pair at the top of the section (`assessmentDownloadCsv`/`assessmentDownloadJson`) for the raw question/answer content, distinct from the per-question-health downloads below it.

**Exports:** Four distinct exports in one section: question-bank spreadsheet (CSV), question-bank JSON, item-health CSV, and the top-of-section assessment CSV/JSON — easy to conflate during relocation; they should remain four separate buttons with their current labels.

**Preserve exactly:** `getTsaScoringSettings`/`setTsaScoringSettings`; the direct write to `assessment_item_reviews/{questionId}` including its `decisionLog` array-append pattern (capped at the last 100 entries) and the `by: auth.currentUser?.email` attribution field, which is this feature's only form of "who changed this" record — there is no `auditEvents` write for a review-status change, unlike the ES raw-response reveal.

## Preview & Health / Member preview settings — `section-visibility`

**Actions:** Visibility checklist/status (read-only), "Refresh status" (`refreshVisibility`). Three deep-link buttons: `memberHubPreviewLink` → `../member-login/index.html?mode=admin`; `welcomeCardPreviewLink` → `../member-login/index.html?mode=admin&preview=welcome#todays-mission`; `welcomeWalkthroughPreviewLink` → `../member-login/index.html?mode=admin&preview=welcome#welcome-walkthrough`.

**Deep links:** These three are the clearest "deep link" examples in the whole console — each opens the live member hub in a specific preview sub-state via `?mode=admin`, `&preview=welcome`, and a `#`-anchor. **Preserve exactly:** all three query/hash combinations; `member-login/index.html`'s own code (out of this phase's scope, but referenced) must keep recognizing them.

## Preview & Health / Quick links — `section-links`

**Actions:** A single rendered list (`quickLinks`, built from an in-code array around line 6457) of operational links — confirmed as P0-11 predicted: "probably just a list of links." No actions beyond following them.

## Preview & Health / Technical reliability — `section-site-reliability`

**Actions:** "Refresh reliability" (`srRefresh`) → reads via `getAllStabilityEvents()` (the same `users/{uid}/stability_events` subcollection Engagement Insights partially draws on) — this is real learner-reported runtime-error data, distinct from the next row.

## Preview & Health / Site health check — `section-sync`

**Actions:** "Run check" / "Rerun check" / "Hide results" (`runSyncCheck`/`rerunSyncCheck`/`hideSyncCheck`) — per its own description, this is a **pure configuration/content consistency check**: it compares the member hub's expected accordions, exercise cards, app links, completion keys, and embed keys against the admin panel's expectations, client-side, with no Firestore read at all. It explicitly is not about live learner activity ("For real errors reported by actual learner sessions, see Technical reliability").

**New finding worth flagging:** "Technical reliability" and "Site health check" are easy to conflate by name alone (both are under the same "Health" nav group today) but check fundamentally different things — one reads real production error telemetry, the other is a static self-test with zero backend reads. The final `Operations → Reliability` / `Operations → Site health` split in P0-11 already keeps them separate, which this finding confirms is the right call; the risk is only in naming during/after relocation.

## Preview & Health / Welcome walkthrough screenshots — `section-walkthrough-screenshots`

**Actions:** Read-only gallery (`wtShotsList`) of screenshot files with a maintenance instruction to re-run `node scripts/capture-walkthrough-screenshots.js` after specific TSA UI changes. No in-browser action regenerates the screenshots.

## Customers — `section-customers-directory` *(added by Phase 5, not in original P0-11; placed here because it already has a confirmed final destination)*

Fully documented in `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_5.md`. Summarized for this matrix's format:

**Actions:** Search (`csSearch`/`csSearchGo`/`csSearchClear`), "Refresh" (`csRefresh`) → `getCustomerDirectory({ search, pageSize, cursorCustomerId })`; "Load more" (`csLoadMore`) for pagination; row open (`data-cs-open`) → `getCustomerDetailForStaff({ customerId, canSeePrivileged })`; detail-panel tabs (`data-cs-tab`: Overview, Programs, Assessments, Activity, Consent & privacy, Audit).

**Preserve exactly:** `getCustomerDirectory`/`getCustomerDetailForStaff` callable names; the `platformFeatureFlags/customersConsole` gate; the six-tab detail structure, which already matches the implementation plan's target Customer detail tabs verbatim.

---

# New findings beyond P0-11

1. **Two parallel "Executive Signature" homes exist today.** P0-11's row "Readiness Assessment / Static ES admin preview → Rename Executive Signature (ES)" implied the existing static tab would become the ES tab. Instead, Phases 5-6 built a *new*, separately-named "Executive Signature" nav tab with real callables, and the old "Readiness Assessment" nav tab was left in place, unconnected, still showing "Not connected" and a stale "40 vs. 60 questions" scope note that Phase 0 already resolved. Phase 9's relocation plan needs an explicit decision on the old tab: delete it, or formally redirect/fold its content (the "Forms and versions," "Scoring reference," and "Privacy" sub-panels have no equivalent in the new tab yet) into the connected one before or during the move. Leaving both in the final IA would recreate the exact "two homes for one concept" problem Phase 9 exists to resolve.

2. **"Remove member" is a direct, unaudited, two-collection client delete, not a callable.** Unlike every other identity-affecting action built since Phase 2 (which all route through role-checked, audited callables), Member Access → Members' delete button calls `deleteDoc()` directly on `authorized_members/{email}` and `users/{uid}` from the browser, gated only by a native `confirm()`. There is a best-effort, non-blocking log call beforehand, but no `auditEvents` write, and no server-side role re-check beyond whatever `firestore.rules` allows for an authenticated admin. This is the single highest-risk action uncovered in this review given P0-16's "Incorrect TSA access changes: 0" threshold and P0-07's "Audit: trusted server only" invariant — it predates those invariants and was never retrofitted. This is worth a decision before or during Phase 9, not just a navigation move: should this action gain a server-side audited callable before relocation, or is the existing pattern formally accepted as a pre-existing exception (the same treatment Phase 0 gave the `typography-system.test.js` baseline failure)?

3. **The Program content layout editor (Orientation/Phase 1/2/3) is entirely client-local and non-authoritative.** Its drag-reorder and "delete context sub-section" actions write only to that admin's own browser `localStorage`, never to Firestore or any shared store. P0-11 marks these rows "relocate only," which is accurate for the editor's code, but a reviewer could reasonably assume a "Program content" editing tool persists centrally. It does not. This should be stated plainly wherever this capability resurfaces in the final IA, so no one later assumes two admins editing "the same" phase layout are seeing or affecting the same state.

4. **A previously uncatalogued collection, `assessment_item_reviews`, is written directly from the Content Data → Assessment content review question-bank quality widget.** *(Resolved 2026-10-05: added to P0-06's source-of-truth matrix.)* It stores a per-question review status (Active/Watch/Revise/Retired), a decision note, and a capped 100-entry decision log with email-based attribution — effectively a lightweight audit trail for question quality decisions, written client-side with no corresponding `auditEvents` entry.

5. **`google_group_sync_jobs` is a second previously uncatalogued collection**, written/read via `requestGoogleGroupSyncJob()`/`getGoogleGroupSyncJobs()` and toggled from Members' per-row Google-Group status control (`data-mb-group-mark`). *(Resolved 2026-10-05: added to P0-06's source-of-truth matrix.)* It tracks a manual/automated Google Group membership reconciliation workflow that sits adjacent to, but separate from, `authorized_members`.

6. **Communications → Certificate is really two features sharing one tab**: a settings form (credential title/signatory) and a full credential-admin console (search, revoke, reissue, rename recipient) touching `credential_issuance`/`public_credentials` — collections P0-06 explicitly marks TSA-authoritative, "existing trusted functions only." P0-11's one-line description ("TSA credential settings") undersells this; the revoke/reissue actions are consequential, publicly visible (a credential's public verification page changes immediately), and should probably be named explicitly in whatever final Communications or Programs → TSA → Credentials destination they land in, rather than inheriting the generic "Certificate" label.

7. **Four distinct export buttons live in one section** (Content Data → Assessment content review: question-bank CSV, question-bank JSON, item-health CSV, and a separate top-of-section assessment CSV/JSON pair) and are easy to merge or mislabel during a mechanical relocation. They should remain four separate, identically-labeled controls in the final location.

8. **Three settings-form rows (In-app nudges, Certificate, Global defaults) all write to the same underlying `settings` document via the same `setEngagementSettings()` writer**, just different field paths. P0-11 treats them as three independent rows with independent "Preserve settings" instructions; relocating any one of them without accounting for the shared document risks a stale-read/overwrite race if two of these three ever move to genuinely different final destinations with independent save flows.

9. **"Technical reliability" and "Site health check" check fundamentally different things** (real learner-reported runtime errors vs. a static, no-backend self-test of content/config consistency) despite sitting in the same "Health" nav group today under near-identical names. Not a defect — P0-11's final destinations already separate them (`Operations → Reliability` vs. `Operations → Site health`) — but worth stating explicitly so the distinction survives relocation in the UI copy, not just the route.

10. **Legacy local access is correctly scoped, not a hidden backdoor.** Confirmed in code that its password gate only evaluates when `window.location.hostname` is `localhost` or `127.0.0.1` (`LOCAL_ADMIN_HOST`); it structurally cannot authenticate a production session. Recorded here mainly so this does not need re-verification from scratch during Phase 9 — the guard itself is the thing to carry forward unchanged if this section relocates.

11. **No internal deep-linking exists within the admin console itself** (no `location.hash`/`URLSearchParams` routing to a specific tab or sub-view of `admin/index.html`). Every genuine deep link found points *out* of the admin console into `member-login/index.html` (three examples, cataloged under Preview & Health / Member preview settings) or into `apps/readiness-assessment/` and `apps/tsa-diagnostic/` with query flags (`?internal=1`, `?adminSource=...`). This means Phase 9's "preserve legacy deep links" instruction is almost entirely about those external links continuing to resolve after admin's own navigation changes — there are no bookmarked-admin-subsection URLs in current use to break.

# Closing note

## Full restructuring — completed 2026-10-05

The admin console was restructured from 9 top-level tabs to 6: **Customers, Programs, Organizations, Communications, Content, Operations**. No top-level "Overview" tab was built — nothing in the current console maps to one, and inventing a dashboard with no real content would have been scope creep beyond "relocate what exists."

**Programs** absorbs what were five separate tabs/areas (Program, Student Progress, Rewards, Executive Signature, and the Members/Certificate/Assessment-review/Walkthrough-screenshots items formerly scattered across Member Access, Communications, Content Data, and Preview & Health), organized into labeled sub-groups: TSA · Program access, TSA · Program content, TSA · Progress, TSA · Rewards, TSA · Enrollments (Members), TSA · Credentials (Certificate), TSA · Assessments (question-bank review), TSA · UX maintenance (walkthrough screenshots), and Executive Signature. **Organizations** is a new top-level tab, promoted from a sidebar item under the old Member Access. **Communications**, **Content** (renamed from Content Data), and **Operations** (renamed from Preview & Health) keep what's left after the above moves, plus Operations gained Emergency access and Legacy local access from the old Member Access.

**Members stayed deliberately separate from Customers**, per the owner's explicit decision: positioned under Programs → TSA · Enrollments with a new on-screen note ("Every member here also has a Customer profile under the Customers tab... administratively separate for now... until the customer model is formally verified fully equivalent") rather than merged into the Customer detail panel. No backend change.

### Judgment calls made during execution, flagged for visibility

- **Load-dispatch scoping changed from "fire whenever this tab is open" to "fire only when this specific section is active."** The old Program/Rewards tabs fired their settings-load calls unconditionally for any sub-item in that tab (since each was its own narrow tab). Replicating that literally inside the much larger merged Programs tab would mean clicking ES Attempts also re-fires TSA visibility-settings loads — wasteful and confusing. Each merged domain's loads are now scoped to its own targets only. This is a deliberate improvement, not a literal preservation, and is called out here rather than silently introduced.
- **Clicking Emergency Access no longer triggers a background Members-list load.** The original Member Access dispatch's `else` branch fired `mbLoadMembers()` for *any* non-organization-access target in that tab, including Emergency Access and Legacy local access — almost certainly an unintended side effect of how that tab's dispatch was written, not a deliberate feature. Now that those two live under Operations, that coupling is gone.
- **Legacy local access (`section-passwords`) still has no dedicated sidebar nav item**, matching a pre-existing, explicit test assertion (`tests/admin-navigation.test.js`: "legacy local credentials are removed from day-to-day navigation") that a first draft of this restructuring briefly violated by adding one, then reverted. It's still reachable by scrolling within Operations, exactly as before — just under a different tab.
- Three pre-existing static tests (`tests/admin-navigation.test.js`, `tests/customer-program-phase6-ui-contract.test.js`, `tests/organization-access-admin.test.js`) hardcoded assumptions about the old tab names and were updated to assert the new structure instead. The second one of these is what caught a real cross-tab navigation function (`oaOrgEdit`) that still pointed at the retired `'member-management'` tab name — fixed to `'organizations'`.

### Verification

Full consistency check (every nav item resolves to a real section; every section's tab-panel matches its nav item's scope; zero orphaned scope/panel/group values): clean, 36 nav items, 0 mismatches. Main admin script block parses with zero syntax errors. Full static sweep: 76/76 pass (the once-standing typography baseline failure was already fixed earlier the same day, unrelated to this restructuring). Full emulator regression (17 suites): all pass. Not yet pushed or deployed — this is local, verified, and ready for review.

This document enumerates and maps; it did not originally execute anything. Findings 1, 2, 4, and 5 are now resolved (see "Decisions resolved" above and the updated P0-06 matrix). The remaining findings (3, 6, 7, 8, 9, 10, 11) are not independent action items — each is a constraint on *how* the full relocation must be done correctly (preserve this exact behavior, don't merge these two things, name this clearly), not a defect to fix in isolation before that relocation happens. The broader relocation of the remaining `admin/index.html` content into the final `Overview / Customers / Programs → TSA / Executive Signature / Organizations / Communications / Content / Operations` structure is still a separate, later, sequential task — now unblocked on the decision side, pending a scope/pacing decision on when and how to execute it.
