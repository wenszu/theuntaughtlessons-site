# Documentation and context audit report

> **Platform note (2026-10-09):** the platform has moved from Firebase to Supabase. Where this file mentions Firebase, Firestore, Google Apps Script or Node 20 functions, read `docs/SUPABASE_PLATFORM.md` first for the current state and rules; that guide wins on any conflict.


Audit date: 2026-10-04  
Status: Initial findings recorded before documentation edits; final disposition and counts will be added after cleanup.  
Authority used: repository code and configuration, git history from the last 60 days, and a read-only Firebase deployed-functions inventory. Markdown files were treated as claims to verify.

## Discrepancy findings

| File | Section | Documentation claim | Code, configuration, or history evidence | Proposed action |
| --- | --- | --- | --- | --- |
| `WEBSITE_CONTEXT.md` | Working rules / Current implementation notes | The site has “no backend, no npm.” | `firebase.json` declares three Node 20 Functions codebases; each has `package.json`; Firebase currently lists deployed Gen 2 functions. The browser-facing site itself remains static HTML/CSS/JS. | Update |
| `WEBSITE_CONTEXT.md` | Firebase member system | Cross-program Phase 1–3 rules/functions are all emulator-only and Phase 4 production is pending. | Phase 4 evidence and migration ledgers record a completed 55-record production backfill; `firestore.indexes.json` was deployed. Cross-program callable functions and rules are still not deployed. | Update |
| `WEBSITE_CONTEXT.md` | Quick reference — pages | Omits current member/account, organization, portal, program-detail, credential, and assessment subpages. | Files exist under `member-login/`, `portal/`, `programs/`, `certificate/`, `verify/`, and `apps/readiness-assessment/`. | Update |
| `WEBSITE_CONTEXT.md` | Quick reference — apps | Contains two contradictory rows for `apps/eisenhower-matrix/` and omits readiness subpages. | Only one Eisenhower app directory exists; readiness has admin, build-plan, how-it-works, research, and my-results pages. | Update |
| `WEBSITE_CONTEXT.md` | Deployment | Treats Firebase Hosting and GitHub Pages ambiguously and treats `_headers` as operational. | `.github/workflows/deploy-pages.yml` publishes the public artifact to GitHub Pages; `CNAME` is `theuntaughtlessons.com`; Cloudflare proxies the custom domain. `_headers` is copied as a static file by Pages and is not applied as response-header configuration. Firebase Hosting is configured for emulator/manual use but is not the production web host. | Update |
| `WEBSITE_CONTEXT.md` | Functions deployment note | `functions-admin` deploy state is described only as an “as of 2026-09-25” unknown. | Read-only `firebase functions:list` shows 18 deployed Gen 2 Node 20 functions. Several current repo exports are not deployed, including all customer-program/ES callables, roster-draft functions, readiness functions, and the weekly scheduler. | Update |
| `WEBSITE_CONTEXT.md` | Auth behavior | Local credentials are presented alongside production sign-in without a sharp environment boundary; admin role description omits bootstrap owner and `platform_staff`. | `assets/firebase.js`, `member-login/content-config.js`, `admin/index.html`, and `functions-admin/index.js` implement email link, Google, Microsoft, Facebook, emergency-password, local emulator accounts, bootstrap owner, legacy `authorized_members`, and new `platform_staff` checks. | Update |
| `WEBSITE_CONTEXT.md` | Change log | Contains entries older than the promised three-day window and contradictory same-day phase statements. | Entries dated 2026-10-01 and earlier are outside the 2026-10-02 through 2026-10-04 window; later 2026-10-04 entries supersede earlier Phase 4-blocked wording. | Archive/update |
| `archive/WEBSITE_CONTEXT_ARCHIVE.md` | App map | Lists removed v1 assessment apps as if they were current. | Git history (`ffc72dd`) removed those apps; the active app is `apps/tsa-diagnostic/index.html`. | Update historical header/labels; keep history |
| `ASSESSMENTS_AND_GROCERY_REFERENCE.md` | Source files / inventory | Calls retired v1 member assessment files and apps current source files. | Those files were removed in commit `ffc72dd`; the document itself is marked partially archived. Public Find your level and grocery content remain current. | Update and retain only as clearly split current/historical reference |
| `UTL_TSA_scoring_framework.md` | Whole file | Historical scoring architecture remains in repo root. | Header says the architecture was retired 2026-08-11; live scoring is in `apps/tsa-diagnostic/index.html`. | Archive |
| `UTL_assessment_exercises.md` | Exercise bank status | Describes the retired multi-app assessment build as active/in progress. | The old app/data paths were removed; unified diagnostic is live. | Archive |
| `SECURITY_MIGRATION_PLAN.md` | Stages 1–6 | Stage labels mix “implemented in code” with unclear production status. | Admin authentication and a subset of admin/AI functions are deployed; customer-platform, readiness, roster-draft, weekly scheduler, Google-group worker, and other exports are not. Progress/rewards remain partly client/Firestore-driven; course files remain in a public Pages artifact guarded by application logic rather than private delivery. | Update |
| `GOOGLE_GROUP_SETUP.md` | Automated group sync / future automation | Describes Google Group automation as a current or future operational path. | Git history (`b7bc6a8`) retired onboarding dependence; active context says the admin no longer creates sync jobs; `processGoogleGroupSyncJob` exists in repo but is not deployed. | Update/archive obsolete operating steps |
| `GOOGLE_GROUP_SYNC_MIGRATION.md` | Current parallel mode / checklist | Describes a migration still underway. | The worker is not deployed and current member access no longer depends on Google Group automation. Historical jobs remain only for recordkeeping. | Archive |
| `FIREBASE_EMAIL_TEMPLATE.md` | Email-link operation | Does not clearly distinguish member links, readiness links, and emergency password access. | Shared client exports separate member/readiness email-link actions; emergency password is hidden behind `?emergency=1` and restricted to existing active admin/owner accounts. | Update if wording conflicts; otherwise keep |
| `BUILD_STATUS.md` | Current phase / not changed | Says customer-program work stops at Phase 3 and no production data/index work occurred. | Phases 4–6 code/evidence now exist; Phase 4 production backfill completed; indexes deployed; Phase 5/6 remain off and their callables are undeployed. | Update |
| `README-assessment.md` | Phase/status and deployment | Uses Phase 0/Phase 3 preview language that predates completed Phase 4 and local Phase 5/6 work. | Readiness app remains excluded from the GitHub Pages artifact and Firebase Hosting ignore list, but its server code exists only in the undeployed current `functions-admin` source. | Update |
| `docs/CUSTOMER_PROGRAM_PLATFORM_IMPLEMENTATION_PLAN.md` | Header status | Says Phase 0 is next. | Tracker and code show Phase 4 passed; Phase 5/6 are built locally with remaining gates. | Update |
| `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_4.md` | Implemented controls | Calls the core migration writer emulator-only without clarifying the separate production runner. | Core guarded APIs are emulator-only, while `scripts/customer-program-production-apply.js` is the separately guarded production path and was used once. | Clarify |
| `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_5.md` | Outcome / remaining work | Says Phase 4 is unresolved and no production customer data exists. | Phase 4 passed with 55 customers; direct read-only production reconciliation passed after indexes were deployed. The callable/UI path remains undeployed and flagged off. | Update |
| `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_6.md` | Outcome / remaining work | Says Phase 4 is unresolved and no production ES data exists because of that blocker. | Phase 4 passed; production correctly has zero ES participants/attempts. Direct service reconciliation passed; callable/UI deployment, accessibility, ownership decisions, and meaningful-scale performance remain open. | Update |
| `docs/CUSTOMER_PROGRAM_PLATFORM_TRACKER.md` | Phase 4–6 rows | Summary is current, but several detailed rows still say Phase 4 production/reconciliation is pending or blocks Phase 5/6. | Later decision log and evidence rows record Phase 4 pass and real-data reconciliation. | Update |
| `docs/CUSTOMER_PROGRAM_PLATFORM_SCHEMA_V1.md` | Current non-goals | Does not reflect the completed production backfill/index deployment or Phase 5/6 read services. | Migration lineage exists in production; indexes are deployed; UI/callables remain unreleased. | Update |
| `docs/EXECUTIVE_READINESS_ASSESSMENT_IMPLEMENTATION_PLAN.md` | Whole file | Presents an older parallel schema and rollout plan as active. | Customer Program Platform plan/schema and Phase 1–6 evidence supersede it; some proposed collection names differ from implemented schema. | Archive |
| `docs/ORGANIZATION_CONSOLE_FOUNDATION.md` | Deployment state | Multiple dated sections contradict one another and the current deployed-functions inventory. | Static organization UI is in current Pages source; the deployed admin codebase contains organization read/access/definition callables, but roster-draft callables and weekly scheduler are absent from the deployed list. | Update current-status summary; retain dated handoffs as history |
| Root/docs markdown references | Dead references | Several Markdown code-path references name removed v1 apps/data files. | File existence scan and git history identify removals, especially old TSA assessment paths. | Update or mark historical; produce dead-reference check in final report |
| Planned platform work | Planning source | No active context points to “20261004 - Sales practice system design v1” or records the Firestore/Postgres decision. | No repository file with that title exists; it is an external planning source supplied by the owner. | Update; mark link/location as needs owner decision |

## Needs owner decision

- **Sales practice system design link:** The title “20261004 - Sales practice system design v1” is not present in the repository. The context can name it as the planning source, but a stable URL or repository location is needed if it should be clickable.
- **Practice-system database:** Decide whether new practice data belongs in Firestore or Postgres before implementation.
- **Phase 5/6 release ownership:** Name who may toggle `platformFeatureFlags/customersConsole` and `platformFeatureFlags/esWorkspace`.
- **Raw-response access:** Name any people allowed to hold `platform_staff.rawResponseAccess == true`, or explicitly decide that nobody receives it initially.
- **Production-adjacent Phase 4 artifacts:** Decide when to delete the `cpp-phase4-baseline` database and local restricted artifacts listed in the tracker.

## Findings to act on

- **Undeployed browser dependencies:** Current static UI contains paths that depend on Cloud Functions absent from the deployed-function inventory; keep relevant flags off until a reviewed deploy and live verification.
- **Security rules deployment:** Repository rules include additive cross-program boundaries, but documentation/history does not establish that those current rules were deployed. Verify before enabling Phase 5/6.
- **Weekly organization reports:** `sendWeeklyOrganizationReports` is present in source but absent from the deployed list; the Apps Script `WeeklyOrgReport` dispatch remains externally unverifiable from this repository.
- **Roster proposals:** `submitOrganizationRosterDraft` and `reviewOrganizationRosterDraft` are present in source but absent from the deployed list.
- **Readiness persistence:** `recordReadinessCompletion` and `checkReadinessAccountEmail` are present in source but absent from the deployed list; the private readiness app remains excluded from production Pages.
- **Public artifact privacy model:** GitHub Pages serves static files; sensitive course/privacy requirements cannot rely on `_headers` or Firebase Hosting configuration.

## Archive and deletion candidates

| File | Proposed disposition | Evidence |
| --- | --- | --- |
| `archive/UTL_TSA_scoring_framework.md` | Archived | File header declared the architecture retired; corresponding apps were removed in git history. |
| `archive/UTL_assessment_exercises.md` | Archived | Describes the same retired v1 assessment build. |
| `archive/GOOGLE_GROUP_SETUP.md` | Archived | Current onboarding/media no longer depends on Google Groups. |
| `archive/GOOGLE_GROUP_SYNC_MIGRATION.md` | Archived | Migration is not active; worker is undeployed and member access no longer depends on group sync. |
| `archive/EXECUTIVE_READINESS_ASSESSMENT_IMPLEMENTATION_PLAN.md` | Archived | Superseded by the implemented Customer Program Platform plan/schema/evidence. |

No file was proven safe to delete. Historical material was archived instead.

## Hygiene results

- **Environment/key-like files found:** `functions-admin/.env` and `functions/.env.local`.
- **Ignore coverage:** Both files are covered by `.gitignore` through `.env` / `.env.*`; neither is tracked.
- **Tracked key/service-account files:** None found by filename scan.
- **Current secret-pattern candidates:** `assets/firebase.js`, `tests/member-account-rules.behavior.test.js`, and `tests/organization-console-rules.behavior.test.js`. These matches are Firebase web API configuration or test fixture strings, not service-account/private-key material; Firebase web API keys are identifiers and still require rules/API restrictions.
- **History secret-pattern candidates:** `assets/firebase.js` in commits `2eae476fec6475e2a364cf0709bb3282699de0c7`, `3fe2a462f4700f0eb3761c009ff33303b4e5b540`, `885bef66bb0b9c5622d8c51ed7aa95879884cf22`, and `bb2db7c4bb5c66f1a4b318b53a7852057afd7c74`; `tests/member-account-rules.behavior.test.js` in `07217dc736d1795359d6dcb7bacaba28a1825456`; `tests/organization-console-rules.behavior.test.js` in `6a173a65eafecda59c3cb61aa95d6a1065d5cc7d`. These are Firebase web API configuration or test fixtures, not private keys. The scan found no private-key header, GitHub token, or tracked service-account JSON.
- **Scope caution:** Pattern scanning cannot prove that no secret ever existed; it reports the configured high-confidence patterns without printing values.

## What changed

- **Context corrected:** Hosting, edge, Firebase/Auth/database/functions, Apps Script, AI scoring, media, CI, deployment state, page/app lists, and customer-platform status now match current code/config and the read-only deployed inventory.
- **Phase records reconciled:** Phase 4 is recorded as passed; Phase 5/6 are in verification with direct production reconciliation complete and deployment/performance/accessibility/ownership gates open.
- **Security plan clarified:** Each security stage now distinguishes code presence, deployed subset, and outstanding architecture work.
- **Readiness and organization status corrected:** Private hosting, deployed versus source-only callables, and current dependencies are explicit.
- **Planning pointer added:** “20261004 - Sales practice system design v1” is named as the planning source, with Firestore versus Postgres recorded as an open decision.

## What was archived

Five historical/superseded files were moved to `archive/` with dated one-line explanations:

1. `archive/UTL_TSA_scoring_framework.md`
2. `archive/UTL_assessment_exercises.md`
3. `archive/GOOGLE_GROUP_SETUP.md`
4. `archive/GOOGLE_GROUP_SYNC_MIGRATION.md`
5. `archive/EXECUTIVE_READINESS_ASSESSMENT_IMPLEMENTATION_PLAN.md`

The 2026-10-01 active-context changelog entry was summarized into `archive/WEBSITE_CONTEXT_ARCHIVE.md`.

## What was deleted

None. No duplicate, empty, superseded draft, or removed-feature file was sufficiently consequence-free to delete rather than archive.

## Final change summary

- **Updated:** 14 existing Markdown files, plus this audit report.
- **Archived:** 5 files and 1 older changelog entry.
- **Deleted:** 0 files.
