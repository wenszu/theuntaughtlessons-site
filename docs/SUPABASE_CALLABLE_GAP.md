# Firebase server functions against Supabase: what exists, what is written, what is missing

Written 2026-10-08 (night) for Wen-Szu. Read only research plus a small build: nothing in this document was applied to a database, deployed or committed. Facts come from the code in this worktree (branch `supabase-core`), from `docs/SUPABASE_BUILD_HANDOFF.md`, `docs/SUPABASE_PLAN_SERVERS_AND_ADMIN.md` and `docs/SUPABASE_PLAN_SIGNIN.md`, and from read only catalog queries on project `czljyikfavtjgqcibdda` (utl-core).

## 1. The short version

- **45 Firebase server functions** are still in the code: 41 in `functions-admin` (codebase `admin-actions`: 36 callables, 1 web endpoint, 1 scheduled job, 3 triggers) and 4 in `functions-aiko`. The Google Group sync (codebase `group-sync`) is already retired.
- **Before this round:** 22 of the 45 had a Supabase replacement that is live in the database and a browser wrapper behind a flag. 2 more were live in the database with no wrapper (`issueVerifiedCredential`, and the certificate trigger, which is switched off on purpose). 8 had a replacement written but not live (the Stripe, readiness, result email, weekly report and AI scoring Edge Functions). **7 had nothing**: `checkOrganizationRepEmail`, `repairMemberVerifiedCredential`, `getOrganizationConsole`, `checkReadinessAccountEmail`, `runAdminAction`, `setEmergencyCredential` and `changeMyCustomerEmail`; the Firebase email link invitation had no replacement either. 6 are not needed in Supabase, with a reason each (section 5). That adds up to 45 (with `setEmergencyCredential` now counted among the retired ones).
- **Built in this round (written and tested, not applied, not deployed):** 5 database changes (migrations 2340 to 2344) and 3 Edge Functions (`readiness-access`, `auth-admin`, `admin-mail`). They cover 5 of the 7 missing functions and the invitation. `setEmergencyCredential` is retired by the owner (D4) and is not rebuilt, and `changeMyCustomerEmail` is left out (nothing calls it). Section 6.
- **What is still missing** is one function (`changeMyCustomerEmail`, left out on purpose: nothing calls it) and, much more important, **the browser side**: ten server pieces now exist but no page or wrapper calls them yet, and 5 places in the browser still read the Firebase session directly, which would break a person who signed in with Supabase only. Section 7 is the ordered list.
- **Nothing on the server side still blocks the sign-in move once the Supabase versions are used**: every Supabase function finds the caller from the token and understands both Firebase and Supabase tokens. What blocks it is that **all 36 Firebase callables read `request.auth`** (a Firebase session), and the browser code in section 7, part C.

## 2. Where things stand live (checked read only, after the independent review)

- **Database `utl-core`:** migrations applied through `question_bank_2350` (that includes 2300 to 2330 and 2350). Migrations 2340, 2341, 2342, 2343 (this round) and 2344 (admin mail limits) are written and NOT applied. 2360 (more switchboard flags) belongs to another builder and is not covered here. The switchboard row exists with all flags on `firebase`.
- **Edge Functions deployed:** `send-email` (version 8, locked until `MAIL_RELAY_SECRET` is set), `weekly-org-reports`, `result-emails` and `readiness-submit` (all three at version 1, gateway token check off). Written but not deployed: `ai-score`, `stripe-checkout`, `stripe-webhook`, and the two new ones (`readiness-access`, `admin-mail`) plus `auth-admin` (off until its secret is set).
- **Firebase:** I cannot run `firebase functions:list` here. The handoff says the Firebase side is unchanged and everything is still served by the Firebase functions.

Status words used below. **LIVE**: the database function exists in utl-core. **WRITTEN**: in the repository, tested locally, not applied or deployed. **MISSING**: nothing exists. **NOT NEEDED**: gone on purpose, with the reason.

## 3. Table A: the 41 functions in `functions-admin` (codebase `admin-actions`)

"Firebase session?" says whether the Firebase function trusts a Firebase session. Every Firebase callable does (it reads `request.auth`, which only a Firebase token fills). Every Supabase replacement below finds the caller from the token with `private.current_person_id()` or the staff checks and works with both token kinds, so it does **not** trust a Firebase session. The wrapper column says what the browser has today. "server_reads", "server_writes", "payments", "ai" are the switchboard flags (`docs/SUPABASE_SWITCHBOARD.md`); `shadow` asks Supabase in the background and compares.

| # | Function | What it does | Called from | Supabase replacement and status | Browser wrapper and flag |
|---|---|---|---|---|---|
| 1 | `resolveMyCustomerIdentity` | Links the signed in account to a customer, making one if none | no page (tests only) | `link_my_identity()` (2270) LIVE, ties a Supabase account to the person with the same verified email, never creates a person. People are created by `apply_readiness_completion` (2330), `apply_stripe_payment` (2290) and `admin_authorize_member` (2260), so nothing needs to create one at sign in. NOT NEEDED as a callable | `assets/supabase-auth.js` calls it once per session when `utl_auth=supabase` |
| 2 | `getMyWorkspaces` | Which workspaces the member can open | `member-login/content-config.js`, `apps/executive-signature/assets/site-nav.js` | `get_my_workspaces()` (2250) LIVE | `assets/supabase-member-reads.js`, flag `server_reads` |
| 3 | `getMyEsStatus` | The member's Executive Signature access and attempts | ES pages (`index`, `home`, `my-results`), `apps/speak-like-obama` | `get_my_es_status()` (2210) LIVE | member reads wrapper, `server_reads` |
| 4 | `changeMyCustomerEmail` | Moves a customer to the new verified address, old one kept as history | no page (tests only) | **MISSING, left out on purpose.** No page offers "change my email". In Supabase it is two steps: Supabase Auth changes the account address, then a database function updates `people.primary_email` and keeps the old address in `person_emails`. Build it when a screen needs it (decision D10) | none |
| 5 | `grantCustomerEntitlement` | Staff grant an access entitlement | no page calls it today (exported by `assets/firebase.js`) | `admin_grant_entitlement(jsonb, dry_run)` (2260) LIVE | `assets/supabase-admin-writes.js`, `server_writes` |
| 6 | `changeCustomerEntitlementStatus` | Staff change an entitlement's status | no page today | `admin_set_entitlement_status` (2260) LIVE | admin writes wrapper, `server_writes` |
| 7 | `getCustomerDirectory` | Customer list for staff | `admin/index.html` | `admin_list_customers` (2240) LIVE | `assets/supabase-admin-reads.js`, `server_reads` |
| 8 | `getCustomerDetailForStaff` | One customer for staff | `admin/index.html` | `admin_get_customer` (2240) LIVE | admin reads wrapper, `server_reads` |
| 9 | `listEsParticipants` | ES participants | `admin/index.html` | `admin_list_es_participants` (2240) LIVE | admin reads wrapper |
| 10 | `listEsAttempts` | ES attempts | `admin/index.html` | `admin_list_es_attempts` (2240) LIVE | admin reads wrapper |
| 11 | `getEsConfiguration` | ES assessment configuration | `admin/index.html` | `admin_get_es_configuration` (2240) LIVE | admin reads wrapper |
| 12 | `getEsDataGovernance` | ES consent and audit view | `admin/index.html` | `admin_get_es_governance` (2240) LIVE | admin reads wrapper |
| 13 | `revealAssessmentResponse` | Staff read a raw answer, logged | `admin/index.html` | `admin_reveal_response` (2260) LIVE (read and audit row in one transaction) | admin writes wrapper, `server_writes` |
| 14 | `issueVerifiedCredential` | Member asks for their certificate | `certificate/index.html`, `my-results/index.html`, `member-login/content-config.js` | `issue_my_credential()` (2320) LIVE | **none**: no wrapper exists in `assets/`, the pages still call the Firebase callable |
| 15 | `repairMemberVerifiedCredential` | Staff issue a member's certificate | `admin/index.html` | `admin_issue_credential(jsonb, dry_run)` (**2340**, built in this round) WRITTEN. Same rules as row 14 through the same core function | none yet |
| 16 | `getOrganizationConsole` | Sponsor page: cohorts, learners, numbers, own roster proposals (and the administrator preview) | `member-login/organization.html` | `get_organization_console(p_organization_id)` (**2342**, built in this round) WRITTEN. Firebase parity, see D9 | none yet |
| 17 | `getMyOrganizationAccess` | Which organizations the member represents | `member-login/content-config.js` | `get_my_organization_access()` (2250) LIVE | member reads wrapper, `server_reads` |
| 18 | `getOrganizationAccessAdmin` | Organization access screen for staff | `admin/index.html` | `admin_organization_access` (2240) LIVE | admin reads wrapper |
| 19 | `submitOrganizationRosterDraft` | Sponsor staff propose people | `member-login/organization.html` | `submit_roster_draft` (2260) LIVE | admin writes wrapper, `server_writes` |
| 20 | `reviewOrganizationRosterDraft` | Staff approve or reject a proposal | `admin/index.html` | `admin_review_roster_draft` (2260) LIVE | admin writes wrapper |
| 21 | `saveOrganizationDefinition` | Create, rename, archive an organization | `admin/index.html` | `admin_save_organization` (2260) LIVE | admin writes wrapper |
| 22 | `checkOrganizationRepEmail` | Does this address already have a sign in account | `admin/index.html` | `admin_check_org_rep_email(p_email)` (**2340**) WRITTEN. Answers from `people` (a person with a sign in id), not from an Auth table | none yet |
| 23 | `saveOrganizationAccessMember` | Give or end an organization role | `admin/index.html` | `admin_save_org_access_member` (2260) LIVE | admin writes wrapper |
| 24 | `getCohortStanding` | Learner's rank in the cohort | `member-login/content-config.js` | `get_my_cohort_standing(metric)` (2250) LIVE | member reads wrapper |
| 25 | `autoIssueVerifiedCredential` (Firestore trigger) | Issues the certificate when the 16th exercise is completed | fires on a Firestore write | trigger `credential_auto_issue` on `activity_progress` (2320) LIVE but **DISABLED on purpose** (the Firebase trigger and this one must never both run) | none needed |
| 26 | `repairMemberExerciseProgress` | Repairs the second copy of progress in Firestore | `admin/index.html` | NOT NEEDED (Supabase has one progress table). Delete with the admin Student Progress move | none |
| 27 | `manageVerifiedCredential` | Revoke, reactivate, rename, reissue a certificate | `admin/index.html` | `admin_manage_credential` (2260) LIVE | admin writes wrapper |
| 28 | `searchVerifiedCredentials` | Search certificates | `admin/index.html` | `admin_search_credentials` (2240) LIVE | admin reads wrapper |
| 29 | `getMemberCredentialRegistry` | Certificate list | `admin/index.html` | `admin_credential_registry` (2240) LIVE | admin reads wrapper |
| 30 | `runAdminAction` | Sends the welcome email, the template test email, logs a removed member to a sheet | `admin/index.html` | Edge `admin-mail` plus migration **2344** (**new**) WRITTEN. Same mail as the Firebase code (a test compares them on the same inputs). A cap of 60 emails per hour and 300 per day per administrator. `RemovedMember` is answered ok and skipped: the removal writes an audit row (`admin_remove_member`) | none yet |
| 31 | `sendWeeklyOrganizationReports` (scheduled, Tuesday 08:00 Manila) | Weekly numbers email per organization | timer | `weekly_org_reports_due` and `weekly_report_record` (2320) LIVE, Edge `weekly-org-reports` WRITTEN. The timer (`pg_cron`) is an owner step in `docs/SUPABASE_REPORTS_SETUP.md` | none (timer) |
| 32 | `removeMember` | Remove a member | `admin/index.html` | `admin_remove_member` (2260) LIVE. Does not touch the sign in account (D8) | admin writes wrapper |
| 33 | `setEmergencyCredential` | Sets a password for an administrator account | `admin/index.html` (Emergency access tab) | **RETIRED by the owner (D4). No replacement.** The Supabase dashboard login is the emergency way in. Remove the Emergency access tab from the admin console when the console moves | none |
| 34 | `recordReadinessCompletion` (anonymous) | Saves a finished quick check or full assessment, scores it, makes the customer and entitlement | `apps/executive-signature/index.html` | Edge `readiness-submit` WRITTEN, `apply_readiness_completion` (2330) LIVE | `assets/readiness-submit-client.js` exists, **not loaded by any page**, own flag `utl_es` (not one of the six switchboard flags) |
| 35 | `checkReadinessAccountEmail` (anonymous) | "Do we hold a result for this address?", then the page sends a sign in link | ES `index` and `my-results` | Edge `readiness-access` plus `readiness_access_check` (**2341**, new) WRITTEN. It replaces this check **and** the link step in one call and always answers the same. Caller address: `cf-connecting-ip`, else the last `x-forwarded-for` entry | none yet |
| 36 | `sendReadinessResultEmail` | "Email me this result" | ES pages | Edge `result-emails` route `readiness-result` WRITTEN, limits in 2320 LIVE | `assets/result-email-client.js` exists, **not loaded by any page**, own flag `utl_mail` (not on the switchboard) |
| 37 | `sendMyResultsEmail` | "Email my results" | `my-results/index.html` | Edge `result-emails` route `my-results` WRITTEN | same client, same flag |
| 38 | `createCheckoutSession` | Starts a Stripe checkout | ES `index`, `programs/think-speak-act.html` | Edge `stripe-checkout` WRITTEN, `get_my_checkout_identity` (2290) LIVE. **Difference: it requires a signed in person; the Firebase callable was open** (D11) | wired in `assets/firebase.js`, flag `payments` (`utl_payments`) |
| 39 | `stripeWebhook` | Records a paid checkout | Stripe | Edge `stripe-webhook` WRITTEN, `apply_stripe_payment` (2290) LIVE | none (Stripe's endpoint address is changed in the Stripe dashboard) |
| 40 | `setRoleClaimOnUserCreated` (Firebase user created) | Gives a new Firebase account the claim `role=authenticated` so Supabase accepts the token | trigger | **STAYS until the sign-in move is finished, then delete.** In Supabase roles come from `role_grants` (people table), and Supabase Auth tokens already carry `role: authenticated`, so no claim is needed for them. A Firebase token still needs the claim while Firebase is a third party provider | none |
| 41 | `mirrorAuthorizedMemberWrite` (Firestore trigger) | Copies a member document to Supabase after a Firestore write | trigger | Transitional scaffolding. Replaced by `admin_authorize_member` (2260) when `server_writes` becomes `supabase`. Delete at the close | none |

## 4. Table B: the 4 functions in `functions-aiko`, and the rest

| Function | What it does | Called from | Supabase replacement and status | Browser wrapper and flag | Firebase session? |
|---|---|---|---|---|---|
| `scoreExplainToAiko` | Scores a spoken transcript with Gemini, optionally stores the attempt with the caller's token | `apps/explain-to-aiko/aiko.js` line 15 (fixed Firebase address) | Edge `ai-score` route `explain-to-aiko` WRITTEN. Same prompts and cleaning, plus a required token and 30 calls per hour per person (`ai_score_take_mine`, 2280 LIVE); stored attempts through 2160 LIVE | `assets/ai-score-client.js` exists, **not loaded by any page**; flag `ai` (`utl_ai`) is on the switchboard | The Firebase endpoint checks no token. The Edge version asks the database, so it works with either |
| `scoreTsaDiagnostic` | Same for the TSA diagnostic | `apps/tsa-diagnostic/index.html` line 158 (fixed Firebase address; the page sends **no token**, so it needs a change before it can use `ai-score`) | Edge `ai-score` route `tsa-diagnostic` WRITTEN | same | same |
| `scoreScqa`, `runAdvisoryBoard` | Gemini calls nothing uses | no caller | NOT NEEDED. The code now answers 410 (not deployed yet). Delete after the Firebase invocation counts show zero (owner task 6) | none | n/a |

Aiko port plan, in one place: the scorer is already fully ported (`supabase/functions/ai-score/`, `docs/SUPABASE_AI_SCORE_SETUP.md`). What remains is owner work (the Gemini key as a Supabase secret, deploy) and two page edits (the Explain to Aiko page and the TSA diagnostic page must call the client module, and the diagnostic page must send the token). Turn the TSA GenAI toggles off until then, as the handoff says.

**Other server pieces that are not Cloud Functions but still tie the site to Firebase:**

| Piece | Where | Replacement |
|---|---|---|
| Firebase Auth email link (`sendSignInLinkToEmail`) for invitations and "see my results" | `assets/firebase.js` `sendSignInInvite`, `sendReadinessAccessLink` | Supabase email link through `assets/supabase-auth.js` (already switchable with `utl_auth`). A person with **no Supabase account yet** cannot be sent a link (sign up is off): that is what Edge `auth-admin` route `invite` (admin invitations, the only route left in that function) and `readiness-access` (visitors) are for |
| Firestore security rules | `firestore.rules` | Stop mattering when Firestore closes |
| Google Group sync (`group-sync`) | deleted | NOT NEEDED, retired 2026-10-08 |
| Public certificate check reads Firestore | `verify/index.html` | `get_public_credential(code)` already exists (LIVE); the page edit is a wave 9 item |

## 5. Functions that are "not needed" and why

| Function | Why not needed |
|---|---|
| `resolveMyCustomerIdentity` | `link_my_identity()` ties an account to its person at sign in. People are created by the three functions that create customers (readiness submit, Stripe payment, admin authorize). Nothing creates a person just because someone signed in |
| `repairMemberExerciseProgress` | It repaired a second copy of progress in Firestore. Supabase has one progress table |
| `setRoleClaimOnUserCreated` | Role claims: in Supabase the role comes from `role_grants` and a Supabase token already carries `authenticated`. Keep the Firebase trigger only until the last Firebase token is gone |
| `mirrorAuthorizedMemberWrite` | Copy scaffolding for the time Firestore is still written first |
| `scoreScqa`, `runAdvisoryBoard` | No caller, open to anyone, used the Gemini key |
| `RemovedMember` (inside `runAdminAction`) | A line in a Google Sheet. The audit table now holds the same fact |
| `setEmergencyCredential` | Retired by the owner (D4). The Supabase dashboard login is the emergency way in |
| Google Group sync | Retired |

## 6. What this round built

All five migrations are additive, security definer with an empty search path, no dynamic SQL, no backslash, `lock_timeout` of 3 seconds, citext columns compared as citext, each with a tested rollback in `supabase/rollbacks/`. Nothing is applied. Apply order does not matter between them (they depend only on migrations through 2330).

| File | What it holds |
|---|---|
| `supabase/migrations/20261008002340_org_rep_check_and_credential_repair.sql` | `admin_check_org_rep_email(p_email)` and `admin_issue_credential(p_input, p_dry_run)`. Platform owner only (42501 first), read only and with a dry run |
| `supabase/migrations/20261008002341_readiness_access_check.sql` | Table `access_check_limits` (no policy, no grant) and `readiness_access_check(p_input)`, service role only. Limits: 3 per hour and 6 per day per address, 30 per hour per caller address (10 when unknown), 3000 per day for everyone |
| `supabase/migrations/20261008002342_organization_console.sql` | `get_organization_console(p_organization_id)`: sponsors see their own organizations and cohorts, a facilitator only the assigned cohort, a platform owner everything as the preview, a stranger gets 42501 for an organization they cannot see. People flagged as test people (`people.is_test`) are left out of sponsor views, not of the owner preview |
| `supabase/migrations/20261008002343_auth_admin_support.sql` | `auth_admin_target(p_input)` and `auth_admin_record(p_input)`, service role only, for the invitation only. The record call writes one audit row (ids and fixed words) and can store the new Supabase id on the person |
| `supabase/migrations/20261008002344_admin_mail_limits.sql` | `admin_mail_take(p_person)` and `admin_mail_release(p_person)`, service role only. 60 per hour and 300 per day per administrator, in the existing `email_limits` table under their own bucket names (no new table) |
| `supabase/functions/readiness-access/` | Anonymous "send me my results link". Always answers `{ok:true}`, so it cannot be used to find out who has a result. Makes the sign in account only when a result is on file, then asks Supabase Auth to email the one time link to the fixed results page |
| `supabase/functions/auth-admin/` | One route, `invite`, platform owner only, **off until the secret `AUTH_ADMIN_ENABLED` is exactly `on`** (when off, every request gets 404 before anything else is looked at, including the origin). For an existing account the audit row is written first. For a new account the account must exist before its id can be stored, so it is made first, the audit call follows at once, and if that call fails or reports the id was not stored (`linked` false) the new account is deleted again (best effort) and the call fails with 503 and no email |
| `supabase/functions/admin-mail/` | Drop in replacement for `runAdminAction` (same `{action, payload}`), platform owner only, with the per administrator cap. `SEND_EMAIL_URL`, if set, must start with this project's address plus `/functions/v1/`, so the mail secret cannot go anywhere else |
| `supabase/callable-gap-test.mjs`, `tests/readiness-access-core.test.js`, `tests/auth-admin-core.test.js`, `tests/admin-mail-core.test.js`, `tests/edge-functions-no-backslash.test.js` | Tests. The mail test runs the new code and the old `functions-admin/mail-sender.js` on the same inputs (including odd HTML). The last test fails if any file of the six Edge Function folders that are or will be deployed (`readiness-submit`, `result-emails`, `weekly-org-reports`, `readiness-access`, `auth-admin`, `admin-mail`) contains a backslash character |
| `supabase/function-audit-test.mjs` | Allowlist entries and checks for every new function (staff first statement, no browser access to the service role ones, helpers closed) |

How to put them live later (each needs your go in chat first):
1. Apply 2340, 2341, 2342, 2343, 2344 after the usual independent review. Undo files exist for each.
2. Deploy, all with the gateway token check off (they do their own check; reasons are in each `index.ts`):
   `supabase functions deploy readiness-access --no-verify-jwt --project-ref czljyikfavtjgqcibdda`, the same for `admin-mail` and for `auth-admin` (the invitation route; it stays off until the secret is set).
3. `admin-mail` needs the existing `MAIL_RELAY_SECRET` (and migration 2344 applied first, because it counts every email in the database and refuses to send when it cannot). `auth-admin` needs `AUTH_ADMIN_ENABLED=on`. `readiness-access` needs nothing of its own.
4. Supabase Auth settings these rely on (from the sign-in plan): sign up OFF, the magic link template with `token_hash`, `https://theuntaughtlessons.com/**` in the redirect list.

## 7. The ordered list of what is missing

Ordered by what blocks the sign-in move and the Firebase close first.

**A. Missing functions (one):**
1. `changeMyCustomerEmail`. No page calls it. Build it together with a "change my email" screen if you want one (D10).

**B. Written on the server, but nothing calls it yet (browser wrappers and flags):**
2. `issue_my_credential` has no wrapper. Three pages still call the Firebase callable.
3. No wrapper yet for `admin_issue_credential`, `admin_check_org_rep_email`, `get_organization_console`, the `admin-mail` function, the `auth-admin` function and the `readiness-access` function. Each is a few lines in `assets/firebase.js` in the style of the existing `server_reads` and `server_writes` wrappers (a `<name>FromFirebase` function kept unchanged). Call shapes: `admin_issue_credential` takes `{"userId": ...}`; `admin_check_org_rep_email` takes `p_email`; `get_organization_console` takes `p_organization_id`; `admin-mail` takes the same `{action, payload}` as the callable; `auth-admin/invite` takes `{email, destination}` (the only route); `readiness-access` takes `{email}` and the page then shows the same confirmation text whatever happens (it must no longer call the link step itself).
4. The three client modules that exist (`ai-score-client.js`, `readiness-submit-client.js`, `result-email-client.js`) are not loaded by any page, and two of their flags (`utl_es`, `utl_mail`) are not among the six switchboard flags, so one setting cannot move everyone. Add them to the switchboard or fold them into `payments`/`ai`-style flags.
5. The two Aiko pages still use fixed Firebase addresses (`apps/explain-to-aiko/aiko.js` line 15, `apps/tsa-diagnostic/index.html` line 158), and the diagnostic page sends no token.

**C. Browser code that reads the Firebase session directly and would break for a person signed in with Supabase only** (from the code, and the sign-in plan section 15.2):
6. `assets/firebase.js` line 1023: the staff writes module takes its token from `auth.currentUser` instead of the shared helper `siteIdToken` the read modules use. One line fix, but until then `server_writes` cannot work after the sign-in move.
7. `assets/feedback-widget.js` line 46 (`auth.currentUser.getIdToken`), `admin/inbox/inbox.js` and `admin/inbox/index.html` (a Firebase ID token), the `users/{uid}` records keyed by the Firebase uid in `assets/firebase.js`, and `admin/index.html` (`auth.currentUser?.email`).
8. All 36 Firebase callables read `request.auth`. They stop mattering one by one as the replacements in Table A are switched on; none can be used by a Supabase only session.

**D. Written, waiting for a decision or an owner step:** the Edge Functions listed WRITTEN above need their secrets and a deploy; the certificate trigger and the weekly report timer are switched on at the switch moment; `setRoleClaimOnUserCreated` stays until the end.

**E. Decisions I need from you (each with a recommendation):**
- **D4. Emergency password: RETIRED by the owner.** The route was removed from `auth-admin` with its tests. The Supabase dashboard login is the emergency way in. `auth-admin` keeps only `invite`, which is the answer to "how does a new member get a sign in account": without it a person added after the provisioning script has no account and no link can be sent.
- **D5 (already recommended, now built).** No sign in account is made when someone finishes the quick check. `readiness-access` makes it at the first link request. Accounts are made confirmed with no password; the link to the person's own address is the proof. `ES_CREATE_AUTH_USER` in `readiness-submit` should stay off.
- **D9. What a sponsor sees.** The old plan said the organization console hides groups under five. The Firebase code never did: sponsors see the named learners (name, address, progress, points) of their visible cohorts. I copied that, so moving the page changes nothing (one improvement: people flagged as test people are left out of sponsor views). Please confirm that is intended and covered by what learners were told. If not, hiding small groups is a one place change in 2342 (members and cohort cards), and it should be decided before the page moves.
- **D10. Changing a member's email address.** Recommendation: do not build until a screen needs it.
- **D11. Checkout needs a sign in: DECIDED by the owner (see Owner decisions below).** `stripe-checkout` keeps requiring a signed in person. What is left is page work: the buy button must send a visitor to sign in first and bring them back.
- **D12. TSA diagnostic and GenAI.** Keep the toggles off until the page sends a token and uses the client module.

## 8. Risks

- **Nothing here has run against the real database.** The tests use a local copy (PGlite) with the real migrations; they cannot show how Supabase Auth, the gateway, or the real `auth.users` behave. First live checks should use the test member only, never the owner record.
- **Accounts made without a password and marked confirmed** (`auth-admin/invite`, `readiness-access`). The address is not proven at creation, only when the link is used. A stranger cannot sign in as that person without the mailbox, but a confirmed account row for a typed address exists. Only addresses that already hold a result (readiness) or are known members or contacts (invite) get one, and the readiness path is limited to 3 per hour and 6 per day per address. If the new account's id cannot be stored on the person, the account is deleted again (best effort; if that delete itself fails, an unlinked account is left behind and the next invite finds it as already registered).
- **`auth-admin` and `admin-mail` find the caller with `get_my_access`.** That works for a Firebase token only while Firebase stays a third party provider in Supabase (the dual period). After that it works for Supabase tokens. The two functions do not need any change for that.
- **The anonymous readiness endpoint sends mail to a typed address.** Limits (above) and the fixed destination page protect a victim's inbox. The Supabase Auth mail limits apply on top. The caller address used for the limits is `cf-connecting-ip`, else the last `x-forwarded-for` entry; if neither exists the caller shares one lower bucket.
- **`get_organization_console` shows learners by name** (D9) and counts learners with an active or restricted account only; the weekly report counts by enrollment, so for a person archived without ending the enrollment the two numbers can differ by one. A real removal ends the enrollment, so for normal removals they agree (checked in the test).
- **Behavior differences to remember:** checkout and AI scoring need a sign in (D11, D12); the certificate trigger must be enabled at the same moment the Firebase one is disabled.
- **Not covered by anything:** the Firestore only parts of the admin console (member progress, support snapshot, cohort details) which the console reads plan keeps Firebase answered; the public certificate check page; the question bank (another builder).

## Owner decisions (2026-10-08)
- D4: the emergency password feature (setEmergencyCredential) is RETIRED. Do not deploy the auth-admin emergency route; recovery is the email link and Google sign-in. Keep only the invite route if it is still needed, and keep auth-admin off (AUTH_ADMIN_ENABLED unset) until then.
- D11: a visitor must sign in before buying the full Executive Signature report (stripe-checkout keeps requiring a signed-in person). The buy button must send the person to sign in first and bring them back.
