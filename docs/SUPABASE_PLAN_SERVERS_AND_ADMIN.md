# Moving the server functions and the admin console to Supabase

Written 2026-10-08 for Wen-Szu. This is a read only research result: nothing was changed, deployed or applied while writing it. It refines phases 4, 5 and 7 of `docs/SUPABASE_MIGRATION_PLAN.md` (section 8 there is the earlier outline). Facts come from the code in this worktree on branch `supabase-core` and from `docs/SUPABASE_BUILD_HANDOFF.md`. Where I could not check something live, I say so in section 11.

## 1. Summary

**What exists today.** Four places run server code for the site:

- 39 functions in `functions-admin` (codebase `admin-actions`): 36 callables or web endpoints and 3 triggers. One trigger is scheduled (weekly organization reports), one fires on a Firestore write (certificates), one fires when a Firebase user is created (the role claim).
- 4 functions in `functions-aiko` (codebase `aiko`): the AI scorers. They use the Google Gemini key, not an Anthropic key. There is no Anthropic key anywhere in the code.
- 1 function in `functions` (codebase `group-sync`): the Google Group sync. Nothing creates jobs for it any more (`WEBSITE_CONTEXT.md` says the admin console stopped because Workspace group automation is unavailable). It is dead code.
- The admin console (`admin/index.html`, 14,210 lines, plus the new `admin/inbox/` page): 39 sections in 7 tabs. It reads and writes Firestore directly through `assets/firebase.js` and through the callables above.

**What I recommend.** Use the database for almost everything and use Edge Functions only where the database cannot do the job.

- About 28 of the 39 admin functions become plain SQL functions (called with the member's or staff member's own sign-in token, protected by the staff checks that already exist in the schema). No server to keep alive, no secret, and the answer comes straight from the data.
- Six Edge Functions are needed (plus one optional), because each one holds a secret, talks to an outside service, creates a sign-in account, or accepts anonymous traffic with its own logic: AI scoring, the email relay, the weekly organization reports, Stripe checkout, the Stripe webhook, and the public Executive Signature submission. The optional seventh is a small sign-in administration function, needed only if you keep the emergency password and invite features.
- Three functions are deleted instead of moved: the Google Group sync, and the two AI endpoints that nothing in the site calls (`scoreScqa`, `runAdvisoryBoard`), once the logs confirm no traffic.
- One Firestore-shaped repair callable (`repairMemberExerciseProgress`) disappears on its own once Supabase is the only store, because it exists to fix a second copy of progress that Supabase does not have.
- The admin console keeps its look. A new file `assets/supabase-admin.js` (same function names as the Firebase file, same return shapes) is wired in screen by screen behind a switch, the way the learner side was done. Every screen has an off switch back to Firebase until the final close.

**Order, lowest risk first.** Section 5 has the full order. In short: foundations and a 30 minute spike, then delete what is dead, then turn on the server mirror that is already built, then read-only staff screens, then member-facing reads, then the AI scorers, then settings and member administration, then database writers, then email, then certificates, then Stripe, then the hard group (public Executive Signature submission and sign-in identity), then the sign-in move, then close.

**Effort.** Roughly 20 to 29 working sessions for the server functions and the admin console together (the table at the end of section 5 adds up the waves), on top of the sign-in move itself (phase 6 in the main plan). I count a session the way the main plan does: one working block with Claude. About 8 of the sessions are the hard group and the admin analytics screens. The owner tasks add up to around 10 short jobs of 10 to 40 minutes each (section 9).

**What stays with Google after Firebase closes.** Google sign-in itself (the OAuth client lives in Google Cloud), Apps Script (email sending and the public contact forms, which can leave later), and the Gemini key if you keep Gemini. None of these needs Firebase. Section 8 explains each.

**Three findings you should know before anything else.**

1. **Closing the Firebase project would also delete things Supabase needs.** The Google OAuth client used for Google sign-in, your Firestore backup bucket (`the-untaught-lessons-firestore-backups`), and possibly the Gemini key all live in the same Google Cloud project as Firebase. Deleting the project deletes them. The plan in section 10 keeps the Google Cloud project alive, empty and unbilled, or moves each item first.
2. **Supabase sign-in emails need your own email sender.** Firebase sends the email-link sign-in mail today. Supabase's built-in sender is only meant for testing and is rate limited, so before the sign-in move you need a real sending service (section 9, task 7). I could not verify the current Supabase limits, so treat this as "plan for it".
3. **Admin changes made in the browser have no server path yet.** Adding a member, editing one, moving a cohort, changing a setting and the question reviews all write Firestore straight from the browser. They are not mirrored to Supabase. They need staff SQL functions (wave 6). Until then Supabase drifts from Firestore for admin edits, so every comparison in the earlier waves starts with a fresh snapshot import. Other sessions have already written migrations 2200 and 2220 for the settings and cohort parts (section 12); check which are applied before relying on them.

## 2. Decisions and why

### 2.1 The rule for SQL function versus Edge Function

Use a **plain SQL function** (called from the browser with the person's own token) when the work is only reading or writing our own tables. It is faster (no extra hop), cheaper (no function to run), safer (the database enforces who may call it, the same way it already does for the 11 learner save functions and the Inbox functions), and testable with the local database harness we already have.

Use an **Edge Function** when at least one of these is true:

| Reason | Functions that have it |
|---|---|
| Holds a secret that must never reach a browser (Stripe keys, the email relay secret, the AI key) | Stripe checkout, Stripe webhook, mail relay, AI scoring |
| Calls an outside service that needs a server (Stripe, Gemini, the Apps Script web app) | same list |
| Is called by something that is not a signed in person (Stripe sending a webhook, a timer, an anonymous visitor finishing the Executive Signature quick check) | Stripe webhook, weekly reports, public submission |
| Must create or change a sign-in account (needs the privileged auth interface) | public submission (creates the account today), emergency password, invite |
| Has scoring or rendering logic that is already written in JavaScript and is long | public submission (the scoring in `executive-signature-versions.js`), result email rendering (`readiness-email.js`) |

Everything else is SQL. The last row is a judgment call: SQL could do the scoring, but porting about 140 lines of tested JavaScript to TypeScript is a smaller and safer change than rewriting it in SQL, and the existing unit tests can carry over.

### 2.2 How each Edge Function knows who is calling

Today the callables trust the Firebase token through the Firebase SDK. For Edge Functions, I recommend this pattern, because it is the one already proven to work end to end with real tokens:

1. The browser sends its normal sign-in token in the `Authorization` header.
2. The Edge Function passes that header on to the database and asks a SQL function "who am I and may I do this" (the same `private.current_person_id()` and `private.has_platform_role(...)` checks the schema already uses). The database answers for both Firebase tokens now and Supabase tokens after the sign-in move, because `private.jwt_identity()` already understands both issuers.
3. Functions that must accept anonymous traffic (Stripe, the timer, the public submission) use the function setting that turns off the gateway token check and do their own check (a signature, a shared secret, or rate limits like `submit_lead` has).

**Unknown, needs a 30 minute spike (wave 0):** whether the Supabase gateway accepts a Firebase token for a function that keeps the gateway check turned on. If it does not, those functions turn the gateway check off and rely on step 2, which is equally safe because step 2 asks the database. I will not assume either answer.

### 2.3 Safety pattern for every move (the same one used for the learner side)

Every function moves in three stages. Each stage can be undone by the stage before it.

- **Stage A, Firebase is the base.** The old Firebase function stays the live one. The server mirror (already built) copies its writes to Supabase. The new Supabase version is built and tested, and it runs in "shadow": the admin or member browser calls both and compares, without using the Supabase answer.
- **Stage B, Supabase is the base.** A per-function switch sends the real traffic to the Supabase version. The Firebase function stays deployed and untouched. Undo is flipping the switch back.
- **Stage C, Firebase half removed.** Only after the function has been quiet on Supabase for the agreed time. The Firebase function is deleted at the close (section 10).

**Honest limit on undo after Stage B.** Once Supabase is the base, a change made there is not in Firestore. Flipping the switch back would hide it. For low volume tables this is small (credentials 16 rows, entitlements 2, organizations 2, members 55), so before each Stage B flip I will write a short "replay back" script that copies the rows changed since the flip into Firestore. I do not recommend giving Supabase a Google service account key to write Firestore live, because that puts a Google secret into the system we are moving to, which is the opposite of the goal.

### 2.4 Where the shadow runs and what it compares

- **Reads:** the admin console (you are the only user) gets a mode `?utl_server=shadow`. Each moved read calls both versions, compares row counts and a hash of the normalized answer, and shows only "match" or "N differences" plus which fields, never the values. For member-facing reads the test member runs the same mode.
- **Writes:** each SQL writer takes a `p_dry_run` flag that returns the rows it would write, so I can compare with what the Firebase function wrote for the same input on the **test member** (`wenszu+utltest@gmail.com`), never on your own record (your real record was inflated twice by portal tests).
- **AI scorers, emails, Stripe:** fixed test inputs through both paths (details in each wave).
- **Production reads are run by you.** My own production Firebase reads are blocked in this setup, so the compare scripts in `scripts/` are run by you and I read only counts, the same way as `scripts/supabase-shadow-compare.js` today.

## 3. Inventory: every server function

Legend for the last columns. **Kind:** SQL = plain database function, EDGE = Edge Function, DEL = delete, DB-TRG = database trigger or cron. **W** = wave in section 5. **Risk:** L low, M medium, H high.

### 3.1 Codebase `admin-actions` (`functions-admin/index.js`, 39 exports)

| # | Function | How it runs | Reads (Firestore) | Writes (Firestore or outside) | Supabase replacement | Kind | W | Risk |
|---|---|---|---|---|---|---|---|---|
| 1 | `resolveMyCustomerIdentity` | callable, signed in | `customerEmailClaims`, `customerAuthLinks`, `customers`, `duplicateCandidates`, `serviceRequests` | same collections plus `auditEvents` | `resolve_my_identity()` on `people`, `person_emails`, `identity_conflicts`, `service_requests`; ties to the sign-in move | SQL | 11 | H |
| 2 | `getMyWorkspaces` | callable | `authorized_members`, `customerAuthLinks`, `entitlements` | none | `get_my_workspaces()` over `enrollments`, `entitlements` | SQL | 4 | L |
| 3 | `getMyEsStatus` | callable | `customerAuthLinks`, `entitlements`, `assessmentAttempts` | none | `get_my_es_status()` over `entitlements`, `assessment_attempts` | SQL | 4 | L |
| 4 | `changeMyCustomerEmail` | callable | claims, auth links, customers | same, plus audit | `change_my_email()` for our tables; the sign-in account email change is a separate Supabase Auth step | SQL + Auth | 11 | H |
| 5 | `grantCustomerEntitlement` | callable, staff | `customers`, `entitlements`, `serviceRequests` | `entitlements`, `serviceRequests`, `auditEvents` | `admin_grant_entitlement(...)`, writes `entitlements`, `service_requests`, `audit_events` in one transaction | SQL | 7 | M |
| 6 | `changeCustomerEntitlementStatus` | callable, staff | `entitlements` | `entitlements`, audit | `admin_set_entitlement_status(...)` | SQL | 7 | M |
| 7 | `getCustomerDirectory` | callable, staff | `customers`, claims | none | `admin_list_customers(search, program, limit, cursor)` | SQL | 3 | L |
| 8 | `getCustomerDetailForStaff` | callable, staff | `customers`, `enrollments`, `entitlements`, `assessmentAttempts`, `consentEvents`, `auditEvents` | none | `admin_get_customer(person_id)`; private fields only for owner and privacy role | SQL | 3 | L |
| 9 | `listEsParticipants` | callable, staff | `customers` (program filter) | none | `admin_list_es_participants(...)` | SQL | 3 | L |
| 10 | `listEsAttempts` | callable, staff | `assessmentAttempts`, definitions, versions | none | `admin_list_es_attempts(...)` | SQL | 3 | L |
| 11 | `getEsConfiguration` | callable, staff | `assessmentDefinitions`, `assessmentVersions` | none | `admin_get_es_configuration()` | SQL | 3 | L |
| 12 | `getEsDataGovernance` | callable, staff | `consentEvents`, `auditEvents` | none | `admin_get_es_governance(...)` | SQL | 3 | L |
| 13 | `revealAssessmentResponse` | callable, owner or privacy role or flagged ES lead | `assessmentAttempts/.../responseParts` | audit entry (who looked and why) | `admin_reveal_response(attempt, reason)`; the read and the audit row happen in one transaction, so a reveal can never be unlogged | SQL | 7 | M |
| 14 | `issueVerifiedCredential` | callable, member | `settings/engagement`, `authorized_members`, `completed_exercises`, `users` | `public_credentials`, `credential_issuance` | `issue_my_credential()` | SQL | 9 | M |
| 15 | `repairMemberVerifiedCredential` | callable, admin | `users`, as above | as above | `admin_issue_credential(person)`; becomes a thin staff wrapper | SQL | 9 | M |
| 16 | `getOrganizationConsole` | callable, sponsor staff or admin | `organizations`, `settings/cohorts`, org `members`, `authorized_members`, `users`, `roster_drafts` | none | `get_organization_console(org)`; must keep the "hide groups under 5" rule (`private.min_group_size`) and sponsor-follows-enrollment rule | SQL | 7 | M |
| 17 | `getMyOrganizationAccess` | callable | `organizations`, org `members`, `settings/cohorts` | none | `get_my_organization_access()` over `role_grants` | SQL | 4 | L |
| 18 | `getOrganizationAccessAdmin` | callable, admin | organizations, members, `roster_drafts`, `access_audit` | none | `admin_organization_access()` | SQL | 3 | L |
| 19 | `submitOrganizationRosterDraft` | callable, sponsor staff | org definitions, members | `roster_drafts`, `access_audit` | `submit_roster_draft(...)` into `organization_roster_drafts`, `audit_events` | SQL | 7 | M |
| 20 | `reviewOrganizationRosterDraft` | callable, admin | `roster_drafts` | draft status, `access_audit` | `admin_review_roster_draft(...)` | SQL | 7 | M |
| 21 | `saveOrganizationDefinition` | callable, admin | `organizations` | `organizations`, `access_audit` | `admin_save_organization(action, ...)` | SQL | 7 | M |
| 22 | `checkOrganizationRepEmail` | callable, admin | Firebase Auth lookup by email | none | answered from `people.auth_uid` or `supabase_uid` (no Auth interface needed) | SQL | 12 | L |
| 23 | `saveOrganizationAccessMember` | callable, admin | Auth lookup, org members | org `members`, `access_audit` | `admin_save_org_access_member(...)` using `role_grants`, `assigned_cohort_names` | SQL | 7 | M |
| 24 | `getCohortStanding` | callable, member | `authorized_members`, `users` (progress, rewards) | none (30 second in-memory cache) | `get_my_cohort_standing(metric)` over `activity_progress`, `reward_totals`; keep the minimum of 5 people | SQL | 4 | M |
| 25 | `autoIssueVerifiedCredential` | trigger on `users/*/completed_exercises/*` | the written doc, `users`, as in 14 | `users.workspaceProgress`, credentials | Postgres trigger on `activity_progress` calling `issue_credential_if_eligible(person)` | DB-TRG | 9 | M |
| 26 | `repairMemberExerciseProgress` | callable, admin | `completed_exercises` | `users.workspaceProgress` | none; Supabase has one progress table | DEL | 13 | L |
| 27 | `manageVerifiedCredential` | callable, admin | `public_credentials`, `credential_issuance` | status, name, reissue | `admin_manage_credential(action, ...)` on `credentials` | SQL | 9 | M |
| 28 | `searchVerifiedCredentials` | callable, admin | `credential_issuance`, `public_credentials` | none | `admin_search_credentials(query)` | SQL | 3 | L |
| 29 | `getMemberCredentialRegistry` | callable, admin | `credential_issuance`, `public_credentials` | none | `admin_credential_registry()` | SQL | 3 | L |
| 30 | `runAdminAction` | callable, admin | none | posts to Apps Script (`WelcomeEmail`, `TestEmailTemplate`, `RemovedMember`, `WeeklyOrgReport`) with the relay secret | Edge `mail-relay` (admin route) | EDGE | 8 | M |
| 31 | `sendWeeklyOrganizationReports` | scheduled, Tuesday 08:00 Manila | organizations, members, users, `weekly_report_log` | `weekly_report_log`, email through Apps Script | SQL view for the numbers, `pg_cron` timer, Edge `weekly-org-reports` for sending | DB-TRG + EDGE | 8 | M |
| 32 | `removeMember` | callable, admin | `users` by email | deletes `authorized_members` and `users` doc, `auditEvents` | `admin_remove_member(email)`; decide about the sign-in account (section 11) | SQL | 6 | M |
| 33 | `setEmergencyCredential` | callable, admin | Firebase Auth | sets a Firebase password | retire; use the Supabase dashboard as the emergency path, or an Edge `auth-admin` function | DEL or EDGE | 12 | M |
| 34 | `recordReadinessCompletion` | callable, **anonymous** | Auth lookup, claims, entitlements | creates a Firebase Auth account, customer, entitlement, attempt, outbox events, consent events, `users` doc | Edge `readiness-submit` (port the scoring to TypeScript, write through one SQL function) | EDGE | 11 | H |
| 35 | `checkReadinessAccountEmail` | callable, **anonymous** | Auth lookup, `users` | none | Edge `readiness-submit` (second route); must not reveal whether an email exists beyond today's answer | EDGE | 11 | M |
| 36 | `sendReadinessResultEmail` | callable, member or attempt holder | `assessmentAttempts`, `customers`, `readinessEmailLimits` | limits doc, email through Apps Script | Edge `mail-relay` (result route); limits move to a table | EDGE | 8 | M |
| 37 | `createCheckoutSession` | callable, anonymous | `settings/payments` | `auditEvents`; Stripe session | Edge `stripe-checkout` | EDGE | 10 | M |
| 38 | `stripeWebhook` | web endpoint, Stripe | `stripeProcessedSessions` | `authorized_members` or customer and entitlement, `auditEvents`, `stripeProcessedSessions` | Edge `stripe-webhook` calling `grant_paid_access(...)` | EDGE | 10 | H |
| 39 | `setRoleClaimOnUserCreated` | Firebase user created | Firebase Auth | sets claim `role=authenticated` | not needed after sign-in moves (Supabase tokens already carry the role) | DEL | 12 | L |

Services used by these functions: `customer-program-service.js` (965 lines, the customer, entitlement, attempt and consent logic), `assessment-persistence-service.js` (271 lines), `payments-service.js` (181), `readiness-email.js` (338), `executive-signature-versions.js` (139). Their business rules are the specification for the SQL functions. The existing tests in `tests/customer-program-*.test.js` and `tests/readiness-email.test.js` are the checklist of behaviors to keep.

### 3.2 Codebase `aiko` (`functions-aiko`)

| Function | How it runs | Reads | Writes | Replacement | Kind | W | Risk |
|---|---|---|---|---|---|---|---|
| `scoreExplainToAiko` | web endpoint, any allowed origin, no sign-in required | nothing stored | optionally one attempt through the caller's token when `AIKO_STORE_ATTEMPT=on`; calls Gemini | Edge `ai-score` route `explain-to-aiko` | EDGE | 5 | M |
| `scoreTsaDiagnostic` | web endpoint, same | nothing | calls Gemini | Edge `ai-score` route `tsa-diagnostic` | EDGE | 5 | M |
| `scoreScqa` | web endpoint | nothing | calls Gemini | no caller found in the repo; delete after the logs confirm | DEL | 1 | L |
| `runAdvisoryBoard` | web endpoint | nothing | calls Gemini | no caller found in the repo; delete after the logs confirm | DEL | 1 | L |

Secret: `GEMINI_API_KEY` in Firebase's secret store. The two live pages call the Firebase URLs directly: `apps/explain-to-aiko/aiko.js` line 15 and `apps/tsa-diagnostic/index.html` line 158. All four endpoints are open to the internet from the allowed origins, which also means a person who copies the URL can spend your Gemini quota. The move is a chance to require the sign-in token for member exercises and add a small daily limit per person (section 5, wave 5).

### 3.3 Codebase `group-sync` (`functions/index.js`)

| Function | How it runs | Reads | Writes | Replacement | Kind | W | Risk |
|---|---|---|---|---|---|---|---|
| `processGoogleGroupSyncJob` | trigger on a new `google_group_sync_jobs` doc | the job | job status, `authorized_members` group fields; calls the Google Directory API with a service account (secret `GOOGLE_GROUP_SYNC_SERVICE_ACCOUNT_JSON`, parameters `GOOGLE_WORKSPACE_ADMIN_EMAIL`, `GOOGLE_GROUP_EMAIL`) | none; feature is retired. The 48 old jobs are already archived in `audit_events` | DEL | 1 | L |

## 4. What each Edge Function is, in one place

| Name | Routes | Secrets (Supabase secret store) | Who may call | Timer | Notes |
|---|---|---|---|---|---|
| `ai-score` | `explain-to-aiko`, `tsa-diagnostic` | `GEMINI_API_KEY` (or `ANTHROPIC_API_KEY` if you choose to switch, see below) | signed in member token; allowed origins; per person daily cap in a table | none | Same prompts and the same output cleaning as today. Fallback answer `{fallback:true}` kept so pages behave as now |
| `mail-relay` | `admin-action` (WelcomeEmail, TestEmailTemplate, RemovedMember), `result-email` | `APPS_SCRIPT_ADMIN_RELAY_SECRET`, `APPS_SCRIPT_ADMIN_URL` | staff for admin routes; member or attempt holder for result email | none | Calls the existing Apps Script web app exactly as `postToAdminRelay` does. Limits (1 per attempt per 10 minutes, 3 per address per day, 150 per day) move to a table |
| `weekly-org-reports` | one | same two | the timer only (shared secret header) | `pg_cron`, Tuesday 00:00 UTC, which is 08:00 in Manila (Manila has no clock change) | The numbers come from a SQL function; the log table `organization_weekly_report_log` already exists and makes a repeat harmless |
| `stripe-checkout` | one | `STRIPE_SECRET_KEY` | anyone (as today), redirect addresses restricted to our own site as today | none | Reads the payments setting and prices from `app_settings` |
| `stripe-webhook` | one | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe only (signature check, gateway token check off) | none | Idempotent through `stripe_processed_sessions` (already created) |
| `readiness-submit` | `complete`, `check-email` | none beyond service access | anyone (anonymous by design), rate limited like `submit_lead` | none | Port of the scoring and persistence. Writes through one SQL function in one transaction |
| `auth-admin` (optional) | `set-emergency-password`, `send-invite` | service access only | staff | none | Only if you want to keep the emergency password and invite features (decision D4) |

**Platform limits I believe apply and you should confirm on the Supabase pricing and limits page before wave 5:** a request has a wall clock limit of roughly 150 seconds on the free plan and longer on Pro, a CPU time limit of a few seconds, and a memory limit of about 256 MB. Our slowest call is the Explain to Aiko scorer (the Firebase version allows 120 seconds and Gemini has a 40 second timeout per model attempt, up to two attempts), which fits. Pro includes millions of invocations a month; your traffic is tiny. Stripe's library works in this runtime if the webhook uses the async signature check; I have not run it here.

**About the "Anthropic key".** The request mentioned Aiko scoring with an Anthropic key. The code uses Gemini. I recommend moving it unchanged first (same model, same prompts, same key moved to the new secret store), because changing the model changes scores and that deserves its own test with a set of saved transcripts. If you do want Anthropic later, it is a one function change in `ai-score`, and I would run both models on the same 20 saved transcripts and compare before switching. That is decision D3.

## 5. Order of moves, lowest risk first

Each wave lists: what moves, effort in sessions, risk, the shadow compare step, and the rollback. "Switch" means a per-function setting that sends traffic to Supabase or Firebase, read at page load, with a per-browser override for testing, like the learner switch.

### Wave 0. Foundations (no live effect). 1 session. Risk: low.

- Add `supabase/functions/` with a shared helper (caller check, cross-origin rules, logging that never records personal data), a `config.toml`, and Node-testable pure modules (same pattern as `assets/supabase-data.js`).
- 30 minute spike: deploy a function `whoami` that echoes `current_person_id()` from the caller's header. Test with your Firebase token and with the test member. This answers the gateway question in 2.2.
- Build the switch layer: one browser helper `callServer(name, data)` that picks Firebase callable or Supabase per function, plus the `?utl_server=shadow` mode.
- Extend `scripts/supabase-shadow-compare.js` into `scripts/supabase-shadow-compare-server.js`: runs a list of fixed staff reads against both sides with your token and prints counts and hashes only.
- Confirm the staff model: today `role_grants` holds 2 platform owner grants (from `admin` and `owner` members); there is no `platform_staff` data. Record the result of the one line check `select role, status from role_grants where scope_type='platform'` in the handoff log, so the staff checks have a known starting point. Your bootstrap address (`wenszu@gmail.com`) is hard coded in the Firebase code as owner; in Supabase the owner is the `platform_owner` grant, and the Supabase dashboard (your own separate login) is the emergency way in.
- List which of migrations 2190 to 2220 are applied to `utl-core` and which are only written (section 12), and record it in the handoff log.
- **Rollback:** nothing is live.

### Wave 1. Delete what is dead. 0.5 session plus a log check. Risk: low.

- `processGoogleGroupSyncJob`: confirm no new `google_group_sync_jobs` documents since the admin console stopped creating them (the newest one in the archive), then delete the function.
- `scoreScqa` and `runAdvisoryBoard`: nothing in the repo calls them. Check 60 days of invocation counts in the Firebase console (Functions, then each function, then metrics). Zero calls: delete. Some calls: list the caller and port them in wave 5.
- **Shadow compare:** not applicable; deletion is checked by zero traffic.
- **Rollback:** the code stays in git. Redeploy the one function with `firebase deploy --only functions:group-sync` (or `aiko:scoreScqa`) if something turns out to use it. Deleting a function does not delete its secret.
- Benefit: the Gemini endpoints with no caller are open to the internet and consume your key if found.

### Wave 2. Turn on the server mirror that is already built. 1 session plus owner tasks. Risk: low to medium.

The mirror (`functions-admin/supabase-mirror/*.js`, about 3,000 lines, wired with 14 hooks in `index.js` and 7 hook groups in the services, switched off by default) copies every server write to Supabase after the Firestore write succeeds. It never throws, never blocks, and does nothing unless `SUPABASE_MIRROR=on` and a key exist. It is transitional scaffolding: when Firestore is gone the mapping code goes too, but its row shapes are the target shapes for the new SQL writers, so nothing is wasted.

Why now: every shadow compare in later waves needs Supabase to be current. The deploy of `admin-actions` is already waiting on you for the Inbox wave (handoff deploy order), so this adds no extra deploy.

- Owner: create the new Supabase secret key, store it as a Firebase secret, deploy (exact steps, section 9, task 2). I then add the secret binding and `SUPABASE_MIRROR=on` in one commit made after the secret exists (a function that names a missing secret fails to deploy).
- Then one catch up import from a fresh snapshot (existing tooling: `node scripts/supabase-import.js --project the-untaught-lessons --save-snapshot ~/utl-backups`, then the import from that file, dry run first).
- **Shadow compare:** the existing per member compare, plus row counts for the new mirror tables (`identity_conflicts`, `organization_roster_drafts`, `organization_weekly_report_log`, `stripe_processed_sessions`, `service_requests`).
- **Rollback:** set `SUPABASE_MIRROR` to anything other than `on` and redeploy, or delete the Firebase secret binding. Firestore is untouched either way.
- **Not covered by the mirror (important):** admin writes made in the browser (add or edit member, cohort move, settings, flags, question reviews, support preview audit) and the old Google Group fields. Wave 6 covers them.

### Wave 3. Staff read screens as SQL. 2 sessions. Risk: low.

Functions: `getCustomerDirectory`, `getCustomerDetailForStaff`, `listEsParticipants`, `listEsAttempts`, `getEsConfiguration`, `getEsDataGovernance`, `searchVerifiedCredentials`, `getMemberCredentialRegistry`, `getOrganizationAccessAdmin` (9 functions, rows 7 to 12, 18, 28, 29 in the inventory). Read only, the table data exists, and the staff read policies exist already in migration 0700.

- Build `admin_*` SQL functions (security definer, empty search path, staff check on `private.has_platform_role`, the same style as the Inbox functions). Private fields (emails, consent detail) only for `platform_owner` and `privacy_data_admin`, as the Firebase code does with `canSeePrivileged`.
- Add them to the audit and attack suites (`function-audit-test.mjs`, a new staff attack test: a non staff member and an anonymous caller must be refused by every one of them).
- **Shadow compare:** `?utl_server=shadow` in the admin console. For each screen: same page, same filters, compare counts and hash. Expect small differences from data written after the last snapshot; the catch up import in wave 2 narrows them. Go criterion: zero unexplained differences on 3 consecutive loads of each screen.
- **Switch:** per function; admin only, so the only person affected by a mistake is you.
- **Rollback:** flip the switch back. No data was written.
- **Per screen order inside the wave:** Credential registry and search first (16 rows), then Customer directory, then ES screens, then Organization access.

### Wave 4. Member-facing reads. 1.5 sessions. Risk: medium (members see the result).

Functions: `getMyWorkspaces`, `getMyEsStatus`, `getMyOrganizationAccess`, `getCohortStanding`.

- `getCohortStanding` is the delicate one: it ranks the member against the cohort, shows nothing for groups under 5, and caches for 30 seconds. The SQL version reads `activity_progress` and the reward totals view. Reward totals can differ from Firestore (known open item: importer score points difference, owner's reward rows, rebuild behaviour), so the comparison is on rank bands and cohort size, and a difference in points is reported, not blocked. The earlier decision that points do not matter for the accelerated cutover applies, but a rank flipping for a real member is worth a look before the switch.
- **Shadow compare:** the test member and you run `?utl_server=shadow` on the member hub, My Results and the ES workspace entry. Compare state (`ready`, `small-cohort`, `no-cohort`), cohort size and rank.
- **Switch:** per function, flagged by member wave if you want (same mechanism as the learner wave flag). Start with you and the test member.
- **Rollback:** flip back. No writes.

### Wave 5. AI scorers to an Edge Function. 1 session. Risk: medium.

Functions: `scoreExplainToAiko`, `scoreTsaDiagnostic` (and `scoreScqa`, `runAdvisoryBoard` only if wave 1 found callers).

- Port the prompt builders, JSON extraction and normalizers unchanged (they are pure JavaScript). The Gemini call stays a plain web request. Keep the optional attempt storing (`store-attempt.js`), but because the function now lives next to the database it can store with the caller's token as today. Keep the old-shape fallback the Aiko page already has.
- Hardening while moving (each is one small change, you can decline any): require the member token for these two routes; allow only the site origins; a per person daily cap (table `ai_usage`, a limit such as 60 calls a day, number is yours to set); never log transcripts.
- Owner task: put the Gemini key in the Supabase secret store (section 9, task 3). Prefer creating a new key in a Google project that will stay, then revoking the old one at the close, over copying the old one.
- **Shadow compare:** send 10 fixed saved transcripts to the Firebase and the Supabase versions. Check: valid JSON shape every time, six criteria, totals within 3 points of each other (the model varies between runs, so equality is not the test), and time to answer. Keep the 10 transcripts in a local file outside the repo, not in git.
- **Switch:** the two pages read the endpoint from one constant. Change the constant behind a setting so that a bad day is fixed by flipping the setting, not by waiting for a site deploy: `app_settings` key `server_endpoints`, read once at page load, with the Firebase URL as the built-in default.
- **Rollback:** flip the setting back. The Firebase scorers stay deployed until the close.
- **Cost note:** this is the only Gemini traffic; confirm in the Google billing page whether it is billed to the Firebase project (section 11).

### Wave 6. Settings and member administration from the browser. 3 sessions. Risk: medium.

This is the admin writes that never had a server path (the key finding in the handoff log for 2026-10-07 late).

What moves:

- **Settings (`settings/*`):** `rewards`, `engagement`, `feedback`, `publicSite`, `assessments`, `public_assessments`, `admin_visibility`, `tsa_scoring`, `emailTemplates`, `payments`, `cohorts`. Target: `app_settings` and `cohorts`. Learner pages also read some of them (reward, engagement, TSA scoring, public assessment, find-your-level, payments, admin visibility, feedback flag): this is gap 2 in the 2026-10-08 dependency audit. Add `get_public_settings()` (anonymous, only the keys the public site needs) and `admin_get_settings()` / `admin_set_setting(key, value)` (owner only, audited in `audit_events`).
- **Members:** `authorizeMember`, bulk import, status and expiry changes, the per member feedback flag (`setUserFeedbackEnabled`), `renameCohort`, `setCohortDetails`, `removeMember`. Target: `people`, `person_emails`, `person_profiles`, `enrollments`, `role_grants`, `cohorts`. Functions: `admin_upsert_member(...)`, `admin_set_member_status(...)`, `admin_rename_cohort(from, to)` (one transaction, where today it is one write per member), `admin_remove_member(email)`.
- Support preview log (`logMemberSupportPreview`) writes into `audit_events`.

Pattern: the browser adapter writes Firestore first (as now) and then calls the staff function as a best effort copy (the learner side pattern). That keeps Firestore current, so reads can move in wave 12 without a gap, and needs no Google secret on the Supabase side. Reads of the members list stay on Firestore until wave 12.

- **Shadow compare:** after a batch of edits on the test member's record, compare the Firestore and Supabase rows field by field (counts and equality only).
- **Rollback:** switch the Supabase copy off; Firestore was always written.
- **Risk notes:** `renameCohort` and bulk import are the busiest paths; test them on a scratch cohort name with only the test member in it. Welcome emails are separate (wave 8).

### Wave 7. Database writers. 3 sessions. Risk: medium.

Functions: `grantCustomerEntitlement`, `changeCustomerEntitlementStatus`, `revealAssessmentResponse`, `saveOrganizationDefinition`, `saveOrganizationAccessMember`, `submitOrganizationRosterDraft`, `reviewOrganizationRosterDraft`, `getOrganizationConsole`.

- Each is one transaction in SQL with the same checks the JavaScript has (role lists, cohort ownership, valid emails, "this person must sign in once first" which becomes "the person row must have a sign-in id").
- Idempotency: `service_requests` already holds the key (the hash the JavaScript used). Keep the same hashing so a retry never double writes.
- `getOrganizationConsole` is the largest read (it joins members, progress, rewards, cohorts and the minimum group size rule). It sits here, not in wave 3, because sponsors rely on it and the group size privacy rule must be proven by an attack test: a sponsor sees only their own cohorts, never groups under 5, and a former employee's results stay visible to the sponsor (owner decision 2026-10-05).
- **Shadow compare:** dry run each writer on the test member and a scratch organization; compare the rows planned with the rows Firebase wrote for the same input. For the console: compare member counts, aggregates and the visible cohort list for both organizations (2 exist).
- **Switch:** per function. Stage B flips one function at a time, in this order: entitlements, roster drafts, organization definition and access, reveal, console.
- **Rollback:** switch back; run the replay back script for the few rows written since the flip (section 2.3).

### Wave 8. Email functions. 2 sessions. Risk: medium.

Functions: `runAdminAction`, `sendWeeklyOrganizationReports`, `sendReadinessResultEmail`.

- `mail-relay` calls the existing Apps Script web app with the existing secret, so Apps Script does not change at all. This is the lowest risk way to move email: the part that talks to Gmail stays exactly as it is, and the web app address is already public in about nine site files.
- Weekly reports: a SQL function returns, per opted in organization, the enrolled, started, completed counts and the average (the same four numbers and the by cohort lines as `weeklyOrgReportBody`). A `pg_cron` entry runs at `0 0 * * 2` (UTC) and calls the Edge Function through `pg_net` with a shared secret stored in the database's vault. The function skips an organization if `organization_weekly_report_log` already has that week (the ISO week id `YYYY-Www` is the key, as in Firebase).
- Result email limits move from the Firestore `readinessEmailLimits` documents to a small table (`email_limits`) with the same three rules.
- Owner task: set the two secrets and the timer extensions (section 9, task 4).
- **Shadow compare:** (a) admin test email and welcome email to your own address from both paths with the `[TEST]` subject; compare the received mail side by side. (b) Weekly report: run the SQL function and the Firebase text builder on the same snapshot, compare the body text (it is deterministic, so it must be equal). (c) First live Tuesday: the Firebase timer is switched off and the Supabase timer is on, but the recipient is overridden to you for one week, then real.
- **Rollback:** re-enable the Firebase schedule (do not delete the Firebase function before two good Tuesdays on Supabase), turn off the `pg_cron` entry with `select cron.unschedule('weekly-org-reports')`. Because both write the same week key in different places, never run both for real in the same week: the owner flips exactly one on.
- **Apps Script note:** `MailApp` has a daily recipient quota (the number depends on the kind of Google account; I did not verify yours). Weekly reports for 2 organizations are far below any quota.

### Wave 9. Certificates. 1.5 sessions. Risk: medium.

Functions: `issueVerifiedCredential`, `repairMemberVerifiedCredential`, `autoIssueVerifiedCredential` (trigger), `manageVerifiedCredential`.

- The handoff flagged this as a silent stop: the certificate trigger fires only on a Firestore `completed_exercises` write. Today it still fires because Firestore is written first. The day Firestore stops being written for completions, certificates stop without any error.
- Replacement: a Postgres trigger on `activity_progress` (when a required exercise becomes completed) calls `issue_credential_if_eligible(person)`: checks certificates enabled in `app_settings.engagement.certificate`, active membership, all 16 required exercises completed, then inserts one `credentials` row with a random id of the same shape (`UTL-TSA-` plus 12 characters from the same alphabet, using the database's random bytes) and a unique key `person_id + program_version` so repeats do nothing. The 16 required exercise ids are in the Firebase file (`REQUIRED_EXERCISES`) and the two retired alias maps are in `EXERCISE_ALIASES`; the SQL version uses canonical ids only, since the catalog already maps aliases.
- `manageVerifiedCredential` (revoke, reactivate, update name, reissue) becomes `admin_manage_credential` with the same four actions and the same replacement chain rule (old becomes `superseded`, as the importer and mirror already do).
- **Shadow compare:** a nightly "would issue" report from the SQL function (read only mode) against the real credential list: every member with all 16 completed must show an issued credential, and no member without should appear. Run it for the whole group (55 people) now; it is a good check on the data in its own right.
- **Switch order, important:** the two triggers must never both issue certificates for real, because each picks its own random id and one person could end up with two certificates. Procedure at the switch moment: take a snapshot import of `credentials`, disable the Firebase trigger (`firebase functions:delete autoIssueVerifiedCredential`, or deploy without it), then enable the Supabase trigger straight away. In Supabase a unique key on person and program version blocks duplicates from then on. A member who completes an exercise in the minutes between the two steps is picked up by the nightly check described above, which issues any missing certificate.
- **Rollback:** disable the Supabase trigger (`alter table ... disable trigger ...`), redeploy the Firebase trigger. Credentials issued by Supabase in the meantime exist only there: replay them into Firestore with the replay back script (there are very few).
- The public verify page (`verify/index.html`) reads `public_credentials` from Firestore today and must move to the `get_public_credential` function that already exists. Plan that edit in this wave, and test the old certificate links, including `UTL-TSA-9WKGGPB3FZ6Q` which has no matching person.

### Wave 10. Stripe. 1.5 sessions. Risk: high if live, low if not live yet.

Functions: `createCheckoutSession`, `stripeWebhook`.

- First fact to settle: payments are not open (`settings/payments.enabled` defaults to false and checkout refuses without a key). If the Stripe secrets were never created in Firebase, there is nothing to cut over: build the Supabase version only, test it in Stripe test mode, and never put the Firebase version live. That is the cleanest outcome and I recommend it. Please check (section 9, task 5).
- `stripe-webhook`: verify the signature with the raw body, ignore other event types, call `grant_paid_access(session)` once. For the Executive Signature the function resolves the person by email and grants an entitlement with access type `paid`; for TSA it creates the member row, exactly as `payments-service.js` does, and it keeps the existing rule that the Google Group and welcome email are not triggered (flag written to the audit event so you can follow up by hand, as the code comments say).
- Idempotency table `stripe_processed_sessions` exists. One webhook endpoint at a time: Stripe lets you register several; do not leave the old one enabled for the same events once the new one is live.
- Test: Stripe test mode, `checkout.session.completed` from the Stripe CLI and from a real test checkout; replay the same event twice and confirm one entitlement.
- **Shadow compare:** if the Firebase version was ever used, send the same test event to both endpoints (test mode only) and compare the resulting rows. Otherwise compare against `tests/` expectations in `payments-service` tests.
- **Rollback:** point the Stripe endpoint back at the Firebase URL (one field in the Stripe dashboard). Stripe retries failed events for days, and the processed sessions table makes retries safe.
- **Also needed before payments open:** the decision flagged in the tracker about what happens to the free or comped full report grant, and the TSA group and welcome follow up. Not a migration question, but it should not be decided during a cutover.

### Wave 11. The hard group: public submission and identity. 3 sessions. Risk: high.

Functions: `recordReadinessCompletion`, `checkReadinessAccountEmail`, `resolveMyCustomerIdentity`, `changeMyCustomerEmail`.

Why hard: `recordReadinessCompletion` is anonymous, scores on the server, creates a sign-in account, then writes customer, entitlement, attempt, consent and outbox rows. An error here either loses a visitor's result or creates a duplicate person. Identity resolution decides who a sign-in belongs to, and a wrong match shows one person another person's data.

- `readiness-submit` Edge Function: port `executive-signature-versions.js` (versions, normalizing, scoring) and the checksum logic to TypeScript; keep the same checksums so old and new results are comparable. Writes through one SQL function `submit_readiness(...)` that does identity, entitlement, attempt, consent and outbox in one transaction. Anti abuse like `submit_lead`: honeypot, per email and per address limits, size caps.
- **Design choice to make with you (D5):** today the function creates a Firebase account with no password ("access by magic link only"). In Supabase it is simpler and safer not to create a sign-in account at submission time. The person row is created with the email; when the visitor later asks for a sign-in link, Supabase creates the account then, and the first sign-in links to the existing person by email (the same approach the sign-in move uses for the 55 members). That removes the need for the privileged auth interface in this function. The cost: the "My results" page needs the magic link to be requested once, as it does today.
- `resolveMyCustomerIdentity` and `changeMyCustomerEmail` become SQL functions over `people`, `person_emails`, `identity_conflicts`. Rules to preserve: an email maps to one person; an email in conflict goes to review, never guessed; an email change keeps the old address as history. The existing `duplicate_candidates` rows (and any in `identity_conflicts`) stay human reviewed.
- **Shadow compare:** replay 20 stored real answer sets (from `assessmentAttempts`, in a local file outside the repo) through the TypeScript scorer and compare band, profile label and area scores and `resultChecksum` with what is stored. Equal on all 20 is the go criterion for the scorer. Then run the full path on the test member in a private window for both tiers (free and full) and compare the rows.
- **Rollback:** the Executive Signature page chooses its endpoint by setting; flip back. A submission accepted by Supabase while it is the base is not in Firestore; run the replay back script. Because the visitor sees the same page either way, the risk is correctness, not appearance.
- Do this wave after wave 7 (the entitlement writer it depends on) and, ideally, in the same week as the sign-in move planning, because the identity rules and the sign-in move touch the same rows.

### Wave 12. Pieces that depend on the sign-in move. 1.5 sessions. Risk: medium.

`setRoleClaimOnUserCreated`, `setEmergencyCredential`, `checkOrganizationRepEmail`, and the invite email (`sendSignInInvite` in `assets/firebase.js`, which is Firebase's email link).

- `setRoleClaimOnUserCreated` is removed once Firebase sign-in is gone; Supabase tokens already carry the role.
- Invites: the admin console invite becomes a call that asks Supabase to send a one time sign-in link to that address (an Edge `auth-admin` route or the standard sign-in link from the admin's browser). Requires the email sender (task 7).
- Emergency password: recommended to retire (decision D4). The dashboard login you own is a stronger emergency way in than an in-site password feature that any admin session can call.
- `checkOrganizationRepEmail` becomes a lookup on `people`.
- **Shadow compare:** not applicable; these are tied to the cutover test with the test member and one AyalaLand member that the main plan already schedules.
- **Rollback:** Firebase sign-in stays enabled until everyone is through (main plan phase 6).

### Wave 13. Admin console reads and the end of the Firestore halves. 5 sessions. Risk: medium.

The big reading screens move last, because they depend on Supabase being completely current and are used only by you.

- **Replace the many small reads with a few aggregate queries.** Today `getAllEngagementAnalytics` reads two subcollections for every one of 54 members (about 3,200 documents) and `getAllMemberWorkspaceProgress` reads all members and all users. In Supabase these are a few SQL aggregates: `admin_platform_overview()`, `admin_member_progress_all()`, `admin_engagement_summary(...)`, `admin_stability_recent(limit)`, `admin_member_support_snapshot(person)`. Faster and cheaper, and they need no per member loops.
- Progress repair tools (`replaceMemberWorkspaceProgress`, `resetMemberWorkspaceProgress`, `repairMemberProgramCompletionReward`) become `admin_replace_member_progress`, `admin_reset_member_progress` (uses `person_profiles.progress_revision`, which exists for this), and `admin_repair_reward`. `repairMemberExerciseProgress` is deleted because the problem it repairs (two copies of progress) will not exist. `repairMemberVerifiedCredential` stays as a staff wrapper over the certificate function (wave 9).
- The question bank screen (`assessment_item_attempts`, `assessment_item_reviews` read directly) needs the TSA assessment item functions that the 2026-10-08 log names as the next wave (learner side `saveAssessmentItemAttempt` and `saveTsaScoringComparison` have no Supabase path yet). That learner write path must exist first, or this screen shows a frozen snapshot.
- **Shadow compare:** each screen in `?utl_server=shadow`; the number of members, completions and points per member must agree within the known reward differences.
- **Switch:** per screen. Order: Technical reliability, Platform overview, Learner readiness, Leaderboard, Cohort analytics, Engagement insights, Student progress (the one with write tools, last), Members list, Question bank.
- **Rollback:** per screen switch; Firestore is still written by the wave 6 pattern.
- After a quiet period, remove the Firestore halves from the adapter and delete `assets/firebase.js` pieces that are no longer used.

### Wave 14. Close. See section 10. 1.5 sessions plus owner tasks.

### Effort and risk at a glance

| Wave | What | Sessions | Risk | Owner tasks |
|---|---|---|---|---|
| 0 | Foundations and the gateway spike | 1 | L | tools install (task 1) |
| 1 | Delete dead functions | 0.5 | L | log check (task 6) |
| 2 | Turn on the mirror | 1 | L-M | secret and deploy (task 2) |
| 3 | Staff reads in SQL | 2 | L | none |
| 4 | Member facing reads | 1.5 | M | test member pass |
| 5 | AI scorers to Edge | 1 | M | Gemini key (task 3) |
| 6 | Settings and member administration | 3 | M | none |
| 7 | Database writers | 3 | M | test member pass |
| 8 | Email and weekly reports | 2 | M | secrets and timer (task 4) |
| 9 | Certificates | 1.5 | M | none |
| 10 | Stripe | 1.5 | H or L | Stripe check (task 5) |
| 11 | Public submission and identity | 3 | H | decision D5 |
| 12 | Sign-in dependent pieces | 1.5 | M | email sender (task 7) |
| 13 | Admin reads and Firestore removal | 5 | M | none |
| 14 | Close | 1.5 | M | tasks 8 to 10 |
| | **Total** | **about 29** | | |

The table adds the upper estimate of every wave (29). The lower end of the range (20) assumes waves 4, 6, 7 and 13 run at the smaller end and that Stripe is not live yet. Treat 20 to 29 sessions as the honest range. It is the weakest number in this plan (section 11).

## 6. The admin console

### 6.1 How it is built today

- One page, `admin/index.html`, plus `admin/inbox/` (already on Supabase). It imports about 60 functions from `assets/firebase.js` and, in a few places, calls Firestore directly (`authorized_members`, `assessment_item_attempts`, `assessment_item_reviews`).
- Who may use it: sign in with Google, then the code checks that the address is the hard coded owner address or an `authorized_members` record with role `admin` or `owner`. Customer platform functions also check a `platform_staff` role. There is also a "Legacy local access" screen with a password check that runs in the browser; it protects nothing on the server and has no data (remove it at the close).
- Many screens treat results as Firestore documents (`snapshot.forEach`, `.data()`), so the new layer returns objects that look the same. That is why I recommend an adapter file rather than editing each of the 14,000 lines.

### 6.2 What replaces it

| Today | Replacement | Why |
|---|---|---|
| Direct Firestore reads and writes, guarded by `firestore.rules` and the admin role | Staff SQL functions (`admin_*`) and staff read policies, guarded by `private.has_platform_role(...)` | The same schema checks already protect the Inbox; no secret in the browser; each function is tested by the audit and attack suites |
| Callables that only touch our tables | SQL functions called with the staff member's own token | No server to run |
| Anything with a secret or outside service (email, Stripe, AI, sign-in accounts) | Edge Functions (section 4) | The secret must stay on a server |
| Firebase email link invites | Supabase sign-in link, sent by your own email sender | Firebase Auth goes away |
| Browser password gate (legacy) | removed | It was never a real lock |

**Where I would still keep a thin server function:** Stripe, the email relay, the weekly timer, the public submission, and (only if kept) account administration. Everything else goes without one.

### 6.3 Every screen, what it reads and writes, and what replaces it

Tabs and sections are from `admin/index.html`. "Verify" means I classified the screen from its function calls and headings and will read its code at build time (I did not read all 14,210 lines).

| Tab / screen | Reads today | Writes today | Replacement | Wave |
|---|---|---|---|---|
| **Customers / Customer directory** | callables `getCustomerDirectory`, `getCustomerDetailForStaff`; a feature flag `platformFeatureFlags/customersConsole` | none | `admin_list_customers`, `admin_get_customer`; flag moves to `app_settings` | 3 |
| **Programs, Executive Signature / Overview, Participants, Attempts, Configuration, Data governance** | callables `listEsParticipants`, `listEsAttempts`, `getEsConfiguration`, `getEsDataGovernance`; flag `esWorkspace` | `revealAssessmentResponse` (audited) | `admin_list_es_*`, `admin_get_es_*`, `admin_reveal_response` | 3, 7 |
| **Programs, TSA / Members** (list, add, edit, bulk import, expiry, welcome email, invite, remove, export CSV) | `authorized_members` (all), `users` lookup by email, credential registry, cohort details | `authorized_members`; `users.feedbackEnabled`; `removeMember`; `runAdminAction` (welcome email, removed member log to the Sheet); Firebase email link | `admin_list_members`, `admin_upsert_member`, `admin_set_member_status`, `admin_remove_member`; `mail-relay`; sign-in link | 6, 8, 12, 13 |
| **TSA / Student Progress** (per member progress, support preview, reset, replace, repair) | `authorized_members`, `users` (progress, rewards), `completed_exercises` | `users`, `completed_exercises`, reward repair, `support_preview_audit`, three repair callables | `admin_member_progress_all`, `admin_member_support_snapshot`, `admin_reset_member_progress`, `admin_replace_member_progress`, `admin_repair_reward`; the audit goes to `audit_events` | 13 |
| **TSA / Platform overview, Learner readiness, Leaderboard, Engagement Insights, Cohort Analytics** | all members' progress, per member analytics sessions and activity sessions, stability events, cohort details, reward settings, credential registry | none (cohort rename on Cohort Analytics) | aggregate SQL: `admin_platform_overview`, `admin_engagement_summary`, `admin_member_progress_all` | 13 |
| **Operations / Technical reliability** | per member `stability_events` | none | `admin_stability_recent` | 13 |
| **TSA / Reward levels, Rules members experience, MP rules, Exercise award simulator** | `settings/rewards` | `settings/rewards` | `app_settings` key `rewards` via `admin_get_settings` and `admin_set_setting`; the learner pages read `get_public_settings` | 6 |
| **TSA / Visibility & access, Orientation, Phase 1, Phase 2, Phase 3** | `settings/assessments`, `settings/admin_visibility`, `settings/public_assessments`, `settings/tsa_scoring`; browser storage for "this browser only" previews | the same settings | `app_settings`; browser only previews unchanged. Verify | 6 |
| **Communications / Global defaults, In-app nudges, Email nudges** | `settings/engagement`, `settings/feedback`, `settings/publicSite` | the same | `app_settings` | 6 |
| **Communications / Email templates** | `settings/emailTemplates` | same; test email through `runAdminAction` | `app_settings`; `mail-relay` | 6, 8 |
| **TSA / Certificate** | `settings/engagement.certificate`; credential callables | settings; revoke, reactivate, rename, reissue | `app_settings`; `admin_search_credentials`, `admin_manage_credential` | 3, 6, 9 |
| **Organizations / Organization access** | callable `getOrganizationAccessAdmin`; `checkOrganizationRepEmail` | `saveOrganizationDefinition`, `saveOrganizationAccessMember`, `reviewOrganizationRosterDraft` | `admin_organization_access`, `admin_save_organization`, `admin_save_org_access_member`, `admin_review_roster_draft`; email check from `people` | 3, 7, 12 |
| **Operations / Payments** | `settings/payments` | same | `app_settings` key `payments`; Stripe pieces in section 4 | 6, 10 |
| **Operations / Emergency access** | none | `setEmergencyCredential` (Firebase password) | retire or `auth-admin` (D4) | 12 |
| **Content / Data files** | static JSON files from the site | none (it offers a download) | none; unchanged | n/a |
| **TSA / Assessment content review (question bank)** | `assessment_item_attempts`, `assessment_item_reviews` direct | review notes | needs the TSA assessment item functions (see wave 13) | 13 |
| **TSA / Welcome walkthrough screenshots, Operations / Site health check, Member preview settings, Quick links, README, Legacy local access** | none or browser storage. Verify | none | unchanged; remove "Legacy local access" at the close | n/a |
| **Operations / Inbox page** (leads, feedback, cleanup) | Supabase `admin_inbox_*` | Supabase | already on Supabase | done |

### 6.4 Admin console order and safety

Order of screens is in wave 13. Three rules for the admin console, because it is your only control panel:

1. Each screen keeps a working Firebase path until the close. A bad screen is fixed by switching it back.
2. The Supabase dashboard SQL editor is the emergency view of every table, with your separate login.
3. No admin function is ever called with a secret in the browser: staff functions check who you are from your token.

## 7. What can be built without you, and what needs you

### 7.1 I can build and test now, no owner action

- All SQL functions, triggers, views and tables (migrations written and tested with the local database harness, then the double check process: builder tests, independent audit, separate reviewer, apply, fingerprint compare, advisors). Applying a migration to `utl-core` needs your go in chat each time, as for 2120 to 2180.
- The Edge Function source (`supabase/functions/*`), its pure modules and Node tests with a fake network, the switch layer, the admin adapter file, the shadow compare scripts, the replay back scripts, and the delete lists.
- Staff attack and audit tests: every `admin_*` function must refuse anonymous callers and non staff members.
- A read only plan for the hard group: porting `executive-signature-versions.js` to TypeScript with the existing unit tests.

### 7.2 Needs your hands (one or two at a time)

Secrets, deploys of Firebase functions, dashboard clicks, third party dashboards, production reads. Deploying Edge Function code: the connected Supabase tool in this setup can deploy function code, so I will propose it in chat and deploy only after your yes; secrets I cannot set, only you.

## 8. What cannot leave Google (or Firebase), and why

| Item | Stays where | Why | Can it leave later |
|---|---|---|---|
| Google sign-in | Google Cloud (OAuth client) | Google issues the identity; Supabase just uses your OAuth client. The client's redirect address changes to the Supabase address | No. The client must live in a Google Cloud project that you keep |
| Apps Script email relay (`WelcomeEmail`, weekly reports, result email, removed member sheet log) | Google Apps Script, run as you | It is the only thing that sends the mail today from your Google account. The Edge Functions just call its web address | Yes, by adding a mail sending service. Worth doing after Firebase is closed, not during |
| Public contact, waitlist, TSA score and program forms on several site pages | Apps Script (Sheet row plus owner notification) | Not part of Firebase at all | Yes: `submit_lead` and the Inbox already exist and could take them. Separate project |
| Gemini AI key | Google (AI Studio or Google Cloud) | The scorers call Gemini | Yes, by switching to another model (D3). Not required |
| Google Group sync | nowhere | Retired. Reviving it would need Google Workspace group management through the Directory API with a service account; the site's group address is a `googlegroups.com` address, which is the reason the feature was switched off | Not needed |
| Firebase Auth | Firebase | It signs 61 people in. Nothing else can close until phase 6 moves them | Yes: the sign-in move |
| GitHub Pages, Cloudflare | unchanged | They serve the site; nothing in this plan touches them | n/a |
| Vimeo and Drive embeds | unchanged | Not part of Firebase | n/a |

## 9. Owner tasks, exact steps

Written in your voice. I have marked the points where menu names may differ slightly from what you see, because dashboards change.

### Task 1. Install the Supabase tools on my computer (once, 15 minutes)

- [ ] I open Terminal and run `brew install supabase/tap/supabase` (if I do not have Homebrew I tell Claude and we use the other way).
- [ ] I run `supabase login`. A browser window opens; I approve it.
- [ ] I run `cd ~/dev/utl-supabase-core && supabase link --project-ref czljyikfavtjgqcibdda`. It asks for the database password only for some commands; I tell Claude if it does and we use the dashboard instead.
- [ ] I tell Claude "tools ready". (Claude can also deploy function code through the connected Supabase tool, so this is mainly for me to be able to look and to run emergency commands.)

### Task 2. Turn on the server mirror (wave 2, 20 minutes)

- [ ] In the Supabase dashboard for `utl-core`: Project Settings, API Keys, create a new secret key named `server-mirror`. I copy it once.
- [ ] In Terminal: `cd ~/dev/utl-supabase-core/functions-admin && firebase functions:secrets:set SUPABASE_SERVICE_ROLE_KEY --project the-untaught-lessons`. I paste the key when asked (it is not shown). I close the window afterwards so the key is not left on screen.
- [ ] I tell Claude "secret set". Claude makes one commit that binds the secret and turns `SUPABASE_MIRROR` on.
- [ ] I check that `origin/main` still equals what Claude lists (the deployment rule), then run `firebase deploy --only functions:admin-actions --project the-untaught-lessons`.
- [ ] I run the snapshot and catch up import when Claude gives me the two commands, and I read the counts to Claude.

### Task 3. Move the Gemini key (wave 5, 15 minutes)

- [ ] In Google AI Studio (or the Google Cloud Credentials page) I create a new key for this use. I note which Google project it is created in; it must be a project I keep.
- [ ] In the Supabase dashboard: Edge Functions, then Secrets (the menu name may differ), add `GEMINI_API_KEY` with the new key. Or in Terminal: `supabase secrets set --env-file ~/utl-secrets/ai.env` where the file holds one line `GEMINI_API_KEY=...` and is kept outside the repository and deleted afterwards. I prefer the dashboard because a command typed in Terminal can stay in the history.
- [ ] I tell Claude "key set". After the switch works, I revoke the old key (close checklist).

### Task 4. Email relay secrets and the weekly timer (wave 8, 20 minutes)

- [ ] I read the current relay secret value with `firebase functions:secrets:access APPS_SCRIPT_ADMIN_RELAY_SECRET --project the-untaught-lessons` (it prints once) and add it as the Supabase secret `APPS_SCRIPT_ADMIN_RELAY_SECRET`. The Apps Script already holds the same value as a script property, so nothing changes there. If I would rather rotate it, I set a new value in both places in one sitting and accept a few minutes where Firebase emails fail.
- [ ] I add `APPS_SCRIPT_ADMIN_URL` with the Apps Script web app address (it is the `exec` address already in `functions-admin/.env`).
- [ ] In the dashboard: Database, Extensions, I switch on `pg_cron` and `pg_net` if Claude's migration cannot (Claude will tell me). The menu name may differ.
- [ ] On the first live Tuesday I check my inbox for the test copy, then I tell Claude to remove the recipient override.

### Task 5. Stripe check (before wave 10, 10 minutes)

- [ ] I open the Stripe dashboard and tell Claude only this: are there live mode keys, are there test mode keys, and is a webhook endpoint registered, and to which address. (I do not paste any key into chat.)
- [ ] I check `settings/payments` in the Firebase console: is `enabled` false. If it is true, I tell Claude before anything else.
- [ ] When Claude is ready: in Stripe, Developers, Webhooks, Add endpoint, address `https://czljyikfavtjgqcibdda.supabase.co/functions/v1/stripe-webhook`, event `checkout.session.completed`, test mode first. I copy the signing secret into the Supabase secret `STRIPE_WEBHOOK_SECRET`, and the secret API key into `STRIPE_SECRET_KEY`.

### Task 6. Check that the three Firebase functions are really unused (wave 1, 10 minutes)

- [ ] In the Firebase console, Functions: open `scoreScqa`, `runAdvisoryBoard` and `processGoogleGroupSyncJob`, look at the invocation metric for the last 60 days, and tell Claude the numbers.
- [ ] If all are zero, I say "delete them" and Claude gives me the exact delete commands to run.

### Task 7. A real email sender for sign-in links (before wave 12, 40 minutes)

- [ ] I choose a sending service (for example Resend, Postmark or the SMTP service of my own Google Workspace if I have one; Claude lists the pros and cons when we get here).
- [ ] I add the DNS records that service asks for (mostly DKIM and SPF) in Cloudflare, DNS. I do not change any existing record for the website itself; I only add the new records.
- [ ] In the Supabase dashboard: Authentication, then the SMTP settings (the menu name may differ), I enter the service's settings. I send myself a test link.

### Task 8. Final exports before closing (wave 14, 30 minutes)

Exact commands are in section 10.2.

### Task 9. The Google Cloud project (wave 14, 30 minutes)

- [ ] I decide D6: keep the Google Cloud project alive (recommended) or create a new project for the Google sign-in client and the backups first.

### Task 10. Revoke the old secrets (wave 14, 30 minutes)

The list is in section 10.4.

### Decisions I need to make (with a recommendation each)

- [ ] **D1. Turn the mirror on in wave 2, or skip it and use a fresh snapshot import before each compare?** Recommended: turn it on; it is built, reviewed, and the deploy is already pending.
- [ ] **D2. Wave 6 uses the "write Firestore first, copy to Supabase second" pattern from the browser. Agree?** Recommended: yes; it avoids a Google key in Supabase.
- [ ] **D3. AI model.** Recommended: move Gemini unchanged now; test Anthropic separately on 20 saved transcripts only if you want to switch.
- [ ] **D4. Emergency password feature.** Recommended: retire it; rely on the Supabase dashboard login and a second admin account.
- [ ] **D5. Do not create a sign-in account at the moment someone finishes the Executive Signature quick check; create it at first sign-in link.** Recommended: yes.
- [ ] **D6. Keep the Google Cloud project after Firebase closes.** Recommended: yes.
- [ ] **D7. Daily limit per person for AI scoring, and a number.** Recommended: require sign-in and 60 calls per day.
- [ ] **D8. Remove a member: should it also delete the member's sign-in account?** Today it does not; the account stays. Recommended: keep as is, review at the sign-in move.

## 10. Close Firebase checklist

Do this only when every row of section 3 is Stage C, sign-in has moved (main plan phase 6), and a full pass on the live site shows no Firebase traffic.

### 10.1 Gates before anything is turned off

- [ ] For 14 days, the Firebase console shows zero invocations for every function (or only the ones I chose to leave).
- [ ] In a private window, a full pass (sign in, finish an exercise, rewards, certificate, admin console, an organization view, an Executive Signature run, a payment in test mode if payments are in scope) shows no requests to `firestore.googleapis.com`, `identitytoolkit.googleapis.com`, `securetoken.googleapis.com` or `cloudfunctions.net` in the browser network tab. I do this for me and for the test member.
- [ ] `grep -r "gstatic.com/firebasejs" ` over the repository shows no remaining page that loads the Firebase libraries (Claude runs this).
- [ ] The reverse check: I try the old Firebase sign-in and the old callable addresses on purpose after the Firebase rules are set to deny; they must fail cleanly.

### 10.2 Final export and backup (before any deletion)

- [ ] Fresh Firestore export: `gcloud firestore export gs://the-untaught-lessons-firestore-backups/<date>-close --project the-untaught-lessons`. Wait for it to finish.
- [ ] Save the same read as a snapshot file: `node scripts/supabase-import.js --project the-untaught-lessons --save-snapshot ~/utl-backups`.
- [ ] Firebase Auth export: `firebase auth:export ~/utl-backups/auth-<date>.json --format=JSON --project the-untaught-lessons`. This file contains password hashes. I keep it only on an encrypted disk or encrypted archive, never in git, never in Drive in plain form.
- [ ] Copy the backup bucket out of the project: `gcloud storage cp -r gs://the-untaught-lessons-firestore-backups ~/utl-backups/gcs-backups`, then check sizes and file counts match.
- [ ] Take a database dump of `utl-core` as the post move baseline (Supabase dashboard, Database, Backups, or `pg_dump` with the connection string). Confirm the Pro plan daily backups are on.
- [ ] Keep one copy of all of this outside my computer (an encrypted external drive).
- [ ] Claude compares document counts in the export with the import report and logs the result in the handoff note.

### 10.3 DNS and hosting: confirm the website is unaffected

The site is served by GitHub Pages (`CNAME` file: `theuntaughtlessons.com`) with Cloudflare in front as a content delivery network; Firebase Hosting is configured only for local testing (`WEBSITE_CONTEXT.md` line 64). Closing Firebase should not touch either. Verify, do not assume:

- [ ] Firebase console, Hosting: no custom domain is connected to the Firebase site. The site's default addresses (`the-untaught-lessons.web.app`, `the-untaught-lessons.firebaseapp.com`) may stop working; that is expected. Note: Firebase's Google sign-in uses the `firebaseapp.com` address as its sign-in handler, so this only becomes safe after sign-in has moved.
- [ ] Cloudflare, DNS: list every record for `theuntaughtlessons.com`. None should point to `web.app`, `firebaseapp.com` or a Firebase hosting address. I do not change any record.
- [ ] GitHub, repository Settings, Pages: custom domain still `theuntaughtlessons.com`, and the "Deploy site" workflow still succeeds on the next push after the cleanup commit.
- [ ] Email records (MX, SPF, DKIM) are untouched; the new sender's records from task 7 are additions.
- [ ] Remove the `hosting` block and the `functions`, `firestore` sections from `firebase.json` in the cleanup commit, so nobody can deploy to Firebase by accident (`firebase deploy` with no filter would deploy hosting from `public: "."`).
- [ ] Add the Supabase address to the `connect-src` of the report-only content security policy in `_headers` before that policy is ever enforced (already noted in the log), and remove the Firebase hosts after close.
- [ ] Open the live site in a private window from two networks and confirm pages, sign-in, certificate verify and the admin console load.

### 10.4 Secrets and keys to revoke or delete

- [ ] Firebase secrets: `GEMINI_API_KEY` (after revoking the key itself), `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (in Stripe, roll the secret key and delete the old webhook endpoint so the copy in Firebase is worthless), `GOOGLE_GROUP_SYNC_SERVICE_ACCOUNT_JSON` (delete the service account key; also remove the domain wide delegation entry in the Google Workspace admin console if one exists), `APPS_SCRIPT_ADMIN_RELAY_SECRET` (the Apps Script property stays, since Supabase uses the same value; if I rotated it, delete the old one), `SUPABASE_SERVICE_ROLE_KEY` (the mirror key; also delete the key `server-mirror` in the Supabase dashboard).
- [ ] Firebase parameters: `APPS_SCRIPT_ADMIN_URL`, `GOOGLE_GROUP_EMAIL`, `GOOGLE_WORKSPACE_ADMIN_EMAIL`, and the local file `functions-admin/.env`.
- [ ] Firebase service accounts: the Firebase Admin SDK account and any key created for scripts (Google Cloud, IAM, Service Accounts); delete unused keys; remove any local credential file used by import scripts.
- [ ] Local sign-ins: `firebase logout`, `gcloud auth revoke`, and remove application default credentials if I created them.
- [ ] GitHub: Settings, Secrets and variables, check for any Firebase or Google token. The workflow files I read use none for deploying, but I confirm in the settings page.
- [ ] The Firebase web API key in `assets/firebase.js` is public by design; after the close it can be restricted or deleted.
- [ ] Supabase import key: already deleted 2026-10-07. Confirm there is no other long lived secret key in the dashboard.
- [ ] Stripe: if the Stripe key was ever pasted anywhere else, roll it.

### 10.5 Billing and shutdown

- [ ] Delete in this order: functions in all three codebases (this also removes the Cloud Scheduler job for the weekly report and the build artifacts; I check Cloud Scheduler and Artifact Registry afterwards, since leftovers can still bill), then the Firestore database data (or leave it with rules that deny everything for the grace period, see below), then secrets.
- [ ] Set Firestore rules to deny all reads and writes, deploy them once, and keep the project for the grace period. The plan said "paused for 90 days". Firebase has no pause; the real choices are: leave the project in place on the free Spark plan with everything deleted or locked, or schedule shutdown. Recommended: lock, remove billing, wait 90 days, then decide.
- [ ] Billing: move the project off the paid plan (Blaze) or unlink the billing account, but only after the functions are deleted. Set a budget alert at a low amount on the Google billing account for the next two months, and look at the invoice lines for Cloud Storage, Artifact Registry, Cloud Scheduler, Secret Manager, Cloud Logging and Cloud Run.
- [ ] Before any "shut down project" on the Google Cloud project: confirm nothing depends on it (decision D6): the Google sign-in OAuth client, any Gemini key created there, the backup bucket (copied out already), and the Apps Script's linked cloud project (in the Apps Script settings, check whether it is linked to this project; the Admin Directory service requirement noted in the script comments suggests it might be). If anything depends on it, move it first.
- [ ] After 90 days with no surprises, shut down the project (it can be restored for a period after shutdown), or keep it empty.

### 10.6 Repository cleanup (Claude)

- [ ] Remove `functions/`, `functions-aiko/`, `functions-admin/` (including `supabase-mirror/`), `firestore.rules`, `firestore.indexes.json`, `firebase.json`, `firebase.phase1-emulator.json`, `firebase-debug.log`, the Firebase library imports in `assets/firebase.js`, the emulator switch, the Firebase specific tests; keep the replay back and import scripts in `scripts/` until the 90 day period ends.
- [ ] Update `WEBSITE_CONTEXT.md`, the memory notes (hosting and sign-in lines) and `docs/SUPABASE_BUILD_HANDOFF.md` with the closing date and the backup locations.

## 11. Unknowns and honest limits

1. **What is deployed right now.** I could not run `firebase functions:list`. The handoff says the server mirror and the Inbox wave's `admin-actions` and `aiko` deploys were pending on 2026-10-08. If they have been deployed since, wave 2 starts further along.
2. **Edge Function platform details I have not verified here:** the exact time and memory limits, whether the gateway accepts a Firebase token (the wave 0 spike), the names of the default environment variables that functions receive under the newer API key system, the pricing of `pg_cron` and `pg_net`, and that the Stripe library runs with the async signature check. Check the Supabase documentation page for each when building.
3. **Email limits.** I believe Supabase's built in sign-in email sender is only for testing and is heavily rate limited, which is why task 7 exists. I did not verify the current numbers. The Apps Script `MailApp` daily recipient quota depends on the type of Google account; I did not verify yours.
4. **Whether Stripe is configured at all** (task 5).
5. **Which Google Cloud project holds the Gemini key and the OAuth client, and what Apps Script is linked to.** If they are all the one Firebase project, D6 is mandatory.
6. **Admin screens not read line by line.** I classified the 39 sections from their headings and the functions they call. The preview and walkthrough screens may touch settings I did not see. Each screen gets a short code reading at the start of its wave.
7. **Members with no sign-in record and members with no member record** (7 sign-in accounts without a member row, 1 member without a sign-in account) matter for the identity functions in wave 11; the answer depends on the sign-in move design.
8. **Reward totals.** The open importer difference (best minus 57) and the owner's reward rows will make point values differ between the two systems. The comparisons report these as known differences; I did not try to fix them in this plan.
9. **Scoring equality for the AI.** A model can answer differently each run, so the AI shadow compare checks shape, bands and speed, not identical text.
10. **Effort numbers** are my estimate from the size of the code (about 8,500 lines in the three Firebase codebases and the services, about 3,000 lines of mirror code, 14,210 lines of admin page, 122 test files), not from measured pace. The ranges in section 5 are the honest ones.
11. **`removeMember` does not delete the person's sign-in account today** (nor does the Firebase code check that a removed member who still has a Firebase account can still write, which the handoff also notes). I did not change that in this plan (decision D8).
12. **My own access.** Production reads from Firebase are blocked for me in this setup, so every compare that reads Firestore is run by you, and I read only counts.

## 12. Work found already under way in this worktree

While I was writing, other sessions added uncommitted files to this worktree (the git status was clean when I started). I did not touch them. They overlap this plan, so read this section before starting any wave.

| Found | What it is | How it changes this plan |
|---|---|---|
| `supabase/migrations/20261008002190_tsa_item_attempts.sql` (written, header says not applied) | `record_tsa_item_attempt` and `record_tsa_scoring_comparison`: the learner side write path for the TSA diagnostic and checkpoint | This is the prerequisite I named for the question bank screen in wave 13. Once applied and wired in the browser, that screen can move |
| `20261008002200_settings_and_access.sql` | `admin_set_app_setting(key, value)` for the ten admin settings (owner only, audited, the browser sends the whole stored document after the Firestore write), and `get_my_access()` | This is the settings half of wave 6, built the way decision D2 recommends (Firestore first, Supabase copy second). Wave 6 then only needs the member administration half and the learner page reads of settings. Note it deliberately says `get_my_access()` must never deny anyone while Firestore is the base |
| `20261008002210_es_report.sql` | `get_my_es_status()` and `get_es_attempt_report(attempt)` | `get_my_es_status` is the SQL replacement for the `getMyEsStatus` callable (row 3, wave 4). Check its answer against the callable in the shadow step. `get_es_attempt_report` supports the Executive Signature results page without a callable |
| `20261008002220_admin_browser_writes.sql` | `admin_mirror_cohort`, `admin_mirror_cohort_rename`, `admin_mirror_feedback_enabled`, `admin_mirror_support_preview` (owner only) | The cohort, feedback flag and support preview parts of wave 6. Its header also mentions member documents being copied "by a Firestore trigger in functions-admin". No such trigger exists in `functions-admin/index.js` today, so that part is planned, not built. A Firestore trigger would keep a Google dependency until the close and would need the mirror secret; compare it with simply adding the member write to the browser adapter (decision D2) |
| `functions/supabase-mirror/` and `functions/supabase-mirror-core.js` | A Supabase mirror for the Google Group sync | **I recommend against finishing this.** The sync is retired (nothing creates jobs; the 48 old jobs are already archived), and wave 1 deletes the function. If someone still wants the mirror, it is dead weight to maintain |
| `docs/SUPABASE_PLAN_SIGNIN.md` | The sign-in move plan, by another planner | Agrees with my order (sign-in last, after the server functions and admin console), also says the built in Supabase email sender cannot be used (my task 7) and recommends a two week dual period where the main plan says one week. One item to settle between the two documents: it recommends a new Google OAuth client for Supabase, and my close checklist (decision D6) still requires keeping the Google Cloud project that holds whichever client is used |

Nothing here is wrong; it means waves 4 and 6 are partly built, and a short "what is applied and what is only written" check should be the first thing done in wave 0.

## 13. Where this fits in the main plan

| Main plan phase | This document |
|---|---|
| 4. Server functions | waves 1 to 12 |
| 5. Admin console | waves 3, 6, 7, 13 and section 6 |
| 6. Move sign-in | wave 12 depends on it; sign-in itself is covered in `docs/SUPABASE_PLAN_SIGNIN.md`, in 10.3 and in section 9 (task 7) |
| 7. Close | wave 14 and section 10 |

Nothing in this document is started. The first useful step is wave 0 and the 30 minute gateway spike, which changes no live behavior.
