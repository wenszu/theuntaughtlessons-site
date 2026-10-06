# UTL readiness assessment

## Private preview and cross-program persistence status

The app remains excluded from the production GitHub Pages artifact and Firebase Hosting configuration. Customer-program Phase 4 has completed its additive production backfill, but the readiness completion/customer-program callables in the current `functions-admin` source are absent from the deployed-functions inventory taken 2026-10-04. Treat the browser flow as a private preview until those functions, current rules, legal/consent decisions, and release gates are explicitly deployed and approved.

The participant and assessment-administration screens remain a private preview. The limited Apps Script result log described below still sends name, email, tier, band and profile when configured.

As of 2026-10-04, the repository also contains the emulator-approved cross-program Phase 3 Firebase path. On completion, the browser supplies the locked form version, ordered answer values, timing and versioned consent to `recordReadinessCompletion`. Trusted server code validates and scores the result, then atomically persists the canonical customer/entitlement, immutable attempt, bounded raw-response parts, consent events, checksums, projections, audit evidence and outbox references. The legacy `users.products.readinessAssessment` entry remains a compatibility projection sourced from that server result. This Phase 3 code is not deployed; the preview remains excluded from public hosting. See `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_3.md` for exact evidence and gates.

**To turn this on, two things need to happen outside this repo:**

1. Add a tab named exactly `Readiness results` to that spreadsheet, with these column headers in row 1: `Logged at`, `Name`, `Email`, `Tier`, `Band`, `Profile`, `Form version`, `Page`, `Source`.
2. Add this branch to the live Apps Script's `handleWebsiteSubmission_` function, alongside the existing `Assessments` and `User feedback` branches, and add a matching case to `resolveSubmissionTab_`:

```js
// in resolveSubmissionTab_, alongside the existing checks:
if (tab === 'readiness' || tab === 'executive-signature') {
  return READINESS_TAB;
}

// new constant near the other *_TAB constants:
const READINESS_TAB = 'Readiness results';

// in handleWebsiteSubmission_, alongside the Assessments/User feedback branches:
if (tabName === READINESS_TAB) {
  sheet.appendRow([
    new Date(),
    data.name || '',
    data.email || '',
    data.tier || '',
    data.band || '',
    data.profile || '',
    data.formVersion || '',
    data.page || '',
    data.source || 'executive-signature'
  ]);
  return textResponse_('ok');
}
```

Separately, "Email me this result" sends the participant an actual email copy, not a log entry, using a new `EmailReadinessResult` action that reuses the existing `handleTemplateEmail` function exactly like `WeeklyOrgReport` does:

```js
// in doPost, alongside the other action checks:
if (action === 'EmailReadinessResult') {
  return handleTemplateEmail(data, false);
}
```

### Preview locally

From the repository root:

```bash
python3 -m http.server 8061
```

Open:

```text
http://127.0.0.1:8061/apps/executive-signature/index.html
```

Use the header to move between:

1. **Take the assessment:** participant landing page, personal details, brief work context, privacy choices, 20 questions, result and feedback.
2. **Assessment admin:** overview, question management, teams, people, insights and change log, all using sample data.
3. **Build plan:** the proposed path from preview to a live assessment.

You can select **Skip ahead with sample answers** to review the result without answering all 20 questions.

### Participant flow represented in Phase 0

The preview now models the intended live information architecture as separate screens:

1. **Introduction:** what the check is, how long it takes and what the participant receives.
2. **Your details:** required first name, last name and email.
3. **About your work:** age range, career stage and primary goal are three quick choices on one page. Organization, job title and country or region are optional.
4. **Privacy and consent:** assessment processing is required and program updates are a separate, optional choice.
5. **Questions:** one statement at a time with visible progress.
6. **Result:** readiness band first, the supporting score, distance to the next band, profile, five areas and feedback.

Before the questions, the preview introduces all five areas in plain language. Follow-through, Steadiness and Curiosity feed the readiness score. Social energy and Warmth describe working style and are shown as spectra because neither end is better.

The result includes a closed **What this means** reference for each area. The definitions, bands and practical suggestions all come from the versioned `apps/executive-signature/content.js` file. The same source powers the separate scoring reference at:

```text
http://127.0.0.1:8061/apps/executive-signature/how-it-works/
```

The questions and research sources are explained at:

```text
http://127.0.0.1:8061/apps/executive-signature/research/
```

The research page explains the Big Five, IPIP and Mini-IPIP in plain language. It separates the published questions from the names, explanations and readiness display created by UTL, and gives the complete references and limits.

### Locked forms and version review

The preview now uses two fixed, versioned form definitions in `apps/executive-signature/forms.js`:

- `readiness-free@1.0.0`, with 20 locked items
- `readiness-full@1.0.0`, with 40 locked items

Starting an attempt shuffles the full locked set and saves the resulting item IDs on that attempt as `itemOrder`. Resuming uses the saved order. Answers and scoring remain keyed by item ID, so display order cannot alter a score. A full-report attempt receives its own order even when the same person has already completed the free check.

The admin Questions preview separates Free check and Full report versions. It lists version status, item count, publication date and scored-attempt count. An administrator can inspect historical versions read only, download the selected item set as CSV and upload a CSV as a draft for review before publishing. Attempts and results both retain the exact `formVersion`, and the person's attempt history displays it.

These administration controls remain browser-only in Phase 0. Uploaded drafts, newly published versions and their change log are not written to Firebase and reset when the preview is reloaded. Production persistence, authorization and audit logging require the separately approved live-data phase.

Assessment admins can preview editing and publishing the Areas and Bands content separately from question or scoring changes. The score-display setting supports band first, number first and band only. These controls remain browser-only in Phase 0.

The **Sources** admin section uses the versioned registry in `apps/executive-signature/sources.js`. Editing a reference creates a patch version. The preview also checks that the planned paid facet questions match the registered source wording exactly before that source can be attached to the planned report. This control remains browser-only in Phase 0.

### Timing and sharing in the preview

The preview keeps detailed per-answer QA timing in the browser. Phase 3 submits only the bounded attempt start time and total active duration; the detailed timing map is not persisted.

The result can prepare a LinkedIn caption that includes the readiness band and profile. It leaves out the detailed numeric score by default. This makes the public result easy to share without exposing more detail than the participant intended.

Use **Preview the invited team flow** to see a sample organization invitation. In that variation the invited email is prefilled and read only. This is only a browser preview and does not create an identity or save any information.

The three header tabs are internal review tools. They do not represent the planned public navigation. A live build would use separate participant URLs and place assessment administration inside the existing UTL admin console.

## Privacy approach

The preview copy is written for an international audience. It describes purpose limitation, data minimisation, access, correction and deletion without claiming that a particular national privacy law applies everywhere. Assessment consent and optional marketing permission are deliberately separate. Phase 3 persists them as separate versioned events; processing consent is mandatory and marketing permission remains optional. Legal review still needs to confirm the controller, processors, retention period, team reporting rules, lawful basis and region-specific notices before production release.

## Deployment isolation

The repository currently deploys its public site through GitHub Pages and also contains Firebase Hosting configuration. Phase 0 is deliberately excluded from both public deployment paths. The source workbook and supplied prototype in `reference/` are excluded as well.

A private Cloudflare preview is not configured in this repository. Creating one requires an approved Cloudflare Pages project and access policy. Until that exists, use the local preview above. Do not remove the deployment exclusions simply to share the preview publicly.

## Source material

- `reference/20260926 - UTL readiness assessment v3.xlsx`
- `reference/20260926 - UTL readiness check prototype v1.html`

These files are design and scoring references. They are not production assets.

## Accounts, for both tiers

Completing either tier creates or reuses a Firebase Auth account keyed by normalized email, with no password set. Phase 2/3 also resolves that Auth UID and hashed email claim to one canonical `customers/{customerId}` record. If the person already participates in TSA, the same canonical person receives a separate ES entitlement; `authorized_members` and all TSA-authoritative records remain unchanged.

The compatibility `products.readinessAssessment.free` and `.full` summaries remain separate. The authoritative history is now `assessmentAttempts` plus bounded `responseParts`, so a retake creates a new immutable attempt rather than replacing history. Quick Check access is reusable. Full Assessment allows one completion by default; another requires a new or explicitly retake-enabled entitlement. Payment is not live, so Full Assessment testing access remains `comped`.

A returning customer can see their report again at `apps/executive-signature/my-results/`, which sends a magic-link sign-in to the email on file (reusing the same `sendSignInLinkToEmail` mechanism already live for TSA members) rather than asking for a password. That page now renders one of four states depending on what the account holds: no result yet, quick-check only (with a CTA into the full report), full report (the main view), or full report with a quiet note that a quick-check result also exists. The two Cloud Functions behind this, `recordReadinessCompletion` and `checkReadinessAccountEmail`, live in `functions-admin/index.js` and are the first genuinely public, unauthenticated callables in that file — worth knowing if you're scanning it for auth assumptions.

Like the rest of this app, `apps/executive-signature/` (including the new results page) stays excluded from both GitHub Pages and Firebase Hosting for now, see Deployment isolation below. The account-creation code is real and will run in production Firebase the moment someone reaches it, but nobody can reach it publicly until that exclusion is deliberately lifted.

## Emulator-approved live architecture

The implementation through Phase 3 is documented in the cross-program plan, schema, tracker and phase evidence under `docs/CUSTOMER_PROGRAM_PLATFORM_*`. It is emulator-only. No Firebase functions, rules, indexes, or data from these phases have been deployed. Every administration control in this preview remains browser-only. Retention/deletion execution, migrations, production outbox consumers, admin visibility, and public release remain later gated work.

## QA

Run the focused test:

```bash
node tests/executive-signature-preview.test.js
node tests/executive-signature-forms.test.js
node tests/executive-signature-account.test.js
node tests/customer-program-phase3-contract.test.js
node tests/customer-program-assessment-persistence.test.js
```

The tests cover the participant preview, locked forms, version wiring, server/browser scoring parity, identity/TSA coexistence, immutable response parts, versioned consent, checksums, idempotency, projections, outbox creation and Full Assessment retake enforcement. Emulator-dependent suites skip automatically when Firestore/Auth emulators are not running; use the exact full command in `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_3.md` for the release gate.
