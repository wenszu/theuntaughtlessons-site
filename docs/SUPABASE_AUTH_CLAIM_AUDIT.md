# Supabase Auth claim audit

Audit date: 2026-10-05. The audit itself was read-only. Nothing was deployed, changed in Firebase, or applied to Supabase. Nothing committed.

Goal: Supabase accepts Firebase sign-ins only when each token carries the custom claim `role` = `authenticated`. This audit checks whether adding that claim can collide with anything that already exists.

## 1. Repo search for existing claims

Searched the working copy of `theuntaughtlessons-site` (Drive folder, which includes the uncommitted changes), including `firestore.rules`, `functions/`, `functions-admin/`, `functions-aiko/`, `assets/`, `admin/`, `scripts/`, `tests/`, and docs.

**Claim APIs: zero hits.** No use of any of these anywhere in the repo:
- `setCustomUserClaims`
- `getCustomUserClaims`
- `customClaims`
- `getIdTokenResult` / `idTokenResult`
- `.claims`

**Token `role` reads: zero hits.** Nothing reads `token.role`, `claims.role`, or a `role` key from an ID token.

**Token field reads that exist.** These read `email`, `email_verified`, and `name` from `request.auth.token`. They don't touch a `role` field, so a `role` claim can't collide with them.
- `firestore.rules:10`, `:11`, `:17`, `:61`, `:68`, `:471`, `:479` (`email_verified`, `email`)
- `functions-admin/index.js:97`, `:98`, `:132` (`email`, `email_verified`, `name`), `:1401`, `:1402`, `:1522`, `:1523`, `:1578`, `:1579` (`email`, `email_verified`)

**`role` as a Firestore field: many hits, none are token claims.** Examples: `firestore.rules:62` (`authorized_members/{email}.role`), `:89` (`platform_staff/{uid}.role`), `functions-admin/index.js:120` and `:268` (`data.role` read from Firestore), and `admin/index.html:7156`, `:12910` (`role` on Firestore member documents, read client-side). A custom claim named `role` lives on the ID token, not in Firestore, so these don't collide.

Conclusion: no existing custom claim or token field named `role`. Adding one doesn't collide with anything in the repo. One caution for later: don't reuse the name `role` for a UTL app role inside the token. Firestore rules and functions read app roles from Firestore documents, and that should stay true.

## 2. Audit script

`scripts/supabase-auth-claim-audit.js` (in this worktree, not committed).

- Uses the Firebase Admin SDK with Application Default Credentials, the same method as the other scripts in `scripts/`.
- Requires `--project <id>`.
- Pages through `listUsers` (read-only). Writes no users and sets no claims.
- Prints counts and claim key names only. It never prints emails, UIDs, tokens, or secrets.

Note: this worktree has no `functions-admin/node_modules`, so the script takes the `firebase-admin` location from `FIREBASE_ADMIN_MODULE_DIR`. I pointed it at the real repo's `functions-admin/node_modules/firebase-admin`.

## 3. Credentials

Present. Application Default Credentials exist, and `firebase-admin` is installed in the real repo's `functions-admin`. No keys were created or guessed.

## 4. Audit results (before any change)

Run: `node scripts/supabase-auth-claim-audit.js --project the-untaught-lessons`

| Measure | Count |
|---|---|
| Total Firebase Auth users | 61 |
| Users with any custom claims | 0 |
| Users with a claim named `role` | 0 |
| Users with `role` = `authenticated` | 0 |
| Claim keys in use | none |

Every existing user has zero custom claims, so adding `role` can't overwrite or conflict with an existing claim today.

## 5. Decisions

- **Claim:** `role` = `"authenticated"` for every Firebase user.
- **New users:** an `onUserCreated` trigger (Firebase Auth v1 trigger, `setRoleClaimOnUserCreated` in the `admin-actions` codebase). Not a blocking `beforeUserCreated` function. Identity Platform is not used.
- **Merge rule:** `setCustomUserClaims` replaces the whole claims object. Every write reads the user's current claims first and adds or removes only `role`. Other claims are never removed or changed.
- **Conflicts:** a `role` claim that already holds a different value is never overwritten or removed. It is counted as a conflict and reported.
- **Client refresh:** after a new account's profile is written in `saveUserProfile` (`assets/firebase.js`), the client calls `getIdToken(true)`. A failed refresh is logged and doesn't block sign-in.

## 6. What was implemented (worktree only, not deployed, not committed)

| File | What it does |
|---|---|
| `functions-admin/auth-claims.js` | Pure merge logic: `planSetRole` and `planRemoveRole`. Shared by the trigger, the backfill and the test. |
| `functions-admin/index.js` | Adds `setRoleClaimOnUserCreated` (v1 `auth.user().onCreate`). It re-reads the user, plans the merge, and writes only if the claim is missing. Imports `firebase-functions/v1/auth`, which is present in the installed `firebase-functions` 7.3.2. |
| `scripts/supabase-auth-claim-backfill.js` | Backfill and undo. Dry run by default. `--apply` writes after a typed `APPLY` (`--remove --apply` requires typed `REMOVE`). Re-reads each user before writing. Counts only. |
| `tests/auth-claim-merge.test.js` | Unit tests for the merge rules: merge keeps other claims, skip when already set, conflicts never overwritten, idempotent, removal touches only `role`, set then remove returns to the original. Also checks the trigger and the backfill use the shared module. |
| `assets/firebase.js` | `saveUserProfile` refreshes the ID token for new accounts. |

The `--remove` flag undoes the change. It removes only `role = "authenticated"`, leaves other claims alone, and leaves a user with no claims at all when `role` was their only claim.

## 7. Backfill dry run (2026-10-05, read-only)

Run: `node scripts/supabase-auth-claim-backfill.js --project the-untaught-lessons`

| Measure | Count |
|---|---|
| Users | 61 |
| Already have the claim | 0 |
| Would receive the claim | 61 |
| Conflicts | 0 |
| Errors | 0 |

Nothing was written. The apply step has not been run.

## 8. Authorized members comparison (read-only)

Source: the signed 2026-10-04 production baseline in `~/phase4-production-artifacts/` (outside the repo, not in version control). It holds 55 `authorized_members`. Compared by normalized email. Counts only.

| Measure | Count |
|---|---|
| Auth users matching one of the 55 members | 54 |
| Auth users not in the 55 members | 7 |
| Members with no Auth user | 1 |
| Auth users with no email | 0 |

The 7 Auth users not in the members list, by sign-in method:

| Sign-in method (provider) | Count |
|---|---|
| `google.com` | 5 |
| `password` | 2 |

Email-link accounts also appear under `password` in Firebase Auth, so the `password` count may include email-link users. The baseline is a 2026-10-04 snapshot and may differ from the live `authorized_members` collection.

## 9. Backfill and rollout (not yet run)

Order:
1. Deploy `setRoleClaimOnUserCreated` only after review. Deploying is a separate step.
2. Run `node scripts/supabase-auth-claim-backfill.js --project the-untaught-lessons` (dry run) and check the counts.
3. Run with `--apply` and type `APPLY` when asked.
4. Re-run the audit script. `usersWithRoleClaimEqualToAuthenticated` should equal the user count.
5. Re-run `--apply`. Expect 0 changes (idempotent check).

Rollback: `node scripts/supabase-auth-claim-backfill.js --project the-untaught-lessons --remove --apply`, then type `REMOVE`.

## 10. Open items

- Confirm the Supabase third-party auth setup that will read the `role` claim, so the claim name and value match what Supabase expects.
- The `onUserCreated` trigger runs asynchronously. The client's forced refresh may run before the claim is written, so a brand-new user may need one more token refresh. A later refresh or the next hourly token renewal picks it up.
- Decide whether the 7 users not in the members list should keep `authenticated`. The current decision is yes, for every Firebase user.
