# Plan: moving sign in from Firebase Auth to Supabase Auth

Written 2026-10-08 by a planner session. Research only. Nothing was changed, deployed, committed or applied. Sources: the repo files named in each section, the Supabase documentation (searched on the day of writing), and the public source of the Supabase Auth server for the password hash format. No personal data was read. I tried to count sign in providers from the saved Firestore snapshot and the permission system refused it, so I used only the counts already written in the docs and the snapshot manifest (counts only).

Language note for whoever builds this: write the member facing text in the owner's voice rules (no dashes, no idioms, no unnatural contractions).

---

## 1. Summary (read this first)

**What moves.** Who you are when you sign in. Today a Firebase account proves it. After this move a Supabase Auth account proves it. Your data is already in Supabase, so this is the last piece that ties the site to Firebase besides the server functions.

**The good news.**
- The database already understands both kinds of sign in. Migration 1800 (`private.jwt_identity`) accepts a Firebase token and a Supabase token side by side, and ties each one to the right person row. So the database needs no change to start.
- Every imported row hangs off `people.id` (a number made from the email address), not off the Firebase user id. Nothing in the database has to be re keyed. The only job is to fill one column, `people.supabase_uid`, for each person. That column already exists.
- No custom tokens, no phone sign in, no anonymous sign in, no two step sign in, no password reset flow exist in the code today. The list of things to rebuild is short: Google, Microsoft, Facebook, email link, one emergency password path, and server side account creation in two places.

**The hard parts, honestly.**
1. **The Firebase callable functions only trust Firebase sign in.** About 35 server functions and the admin console's direct Firestore reads check a Firebase session. A person signed in only with Supabase cannot use them. So the sign in move must come after the server functions and the admin console have moved (phases 4 and 5 of the migration plan), or it needs a temporary bridge. This is the main reason I put sign in last.
2. **Passwords.** The official Supabase migration tool does not import password hashes. The Supabase Auth server can check Firebase's password format, but the official docs do not describe it, so it must be proven with a test account first. Good news: regular members do not have passwords at all. Only emergency (break glass) accounts do, and probably only one to three people.
3. **Email delivery.** The built in Supabase sender is not usable for real members. A sender on your own domain (with DNS records) is needed. Today no such sender exists for sign in emails (Firebase sends them; the welcome email goes through a Google Apps Script mail relay).
4. **Microsoft and Facebook.** These two may not link to existing accounts as cleanly as Google does, because those providers do not always say the email is verified. I need the counts of who uses them before deciding to keep them.

**What I recommend.**
- Move sign in **last**, after the server functions and admin console are on Supabase.
- Use a **dual login period of about two weeks**: Supabase Auth for every new login, while Firebase sessions that are already open keep working because Supabase still accepts Firebase tokens. Not all at once.
- Create all Supabase accounts **ahead of time** (a quiet step members never notice), so the first Google or email sign in simply finds the account.
- Keep **Google and email** for everyone. Keep Microsoft only if the counts show real use. Drop Facebook if the count is zero.
- Keep the emergency password path, but only for the owner and any other admin.
- Keep **Firebase Auth untouched** (never delete a Firebase account) until the two week window ends and one more week of quiet has passed. That is the rollback.

**Is keeping Firebase Auth alone a viable fallback?** Yes. It already works in production with Supabase today (the data layer uses it). It is a safe place to stop if the sign in move proves harder than it is worth. The cost is described in section 11.

**Size of work.** About 4 to 6 working sessions of building and testing, plus about 2 weeks of watching. The longest items are the sign in pages (`member-login/content-config.js`, `assets/firebase.js`, admin sign in) and the server functions that create accounts. The owner needs about 1 hour in the Supabase dashboard, 30 minutes in the Google Cloud console, and an email sender setup with DNS records (about 1 hour plus waiting for DNS).

---

## 2. What exists today

### 2.1 Sign in methods in the code

| Method | Where | Notes |
|---|---|---|
| Google, popup with redirect fallback | `assets/firebase.js`: `signInWithGooglePopup`, `signInWithGoogleRedirect`, `getGoogleRedirectResult`. Used by `member-login/content-config.js` (`handleGoogleLogin`, `handleGoogleRedirectResult`) and by the admin console (`openProductionAdmin`, `mbRequireFirebaseAdmin`, `mbSwitchFirebaseAdminAccount` in `admin/index.html`) | Always asks which account (`prompt: select_account`) |
| Microsoft (any work, school or personal account, tenant `common`) | `signInWithMicrosoftPopup`, `signInWithMicrosoftRedirect`, `getMicrosoftRedirectResult`; `handleMicrosoftLogin` | Offered on the login page and tested by `tests/member-login-auth-options.test.js` |
| Facebook (asks for the email scope) | `signInWithFacebookPopup`, `signInWithFacebookRedirect`, `getFacebookRedirectResult`; `handleFacebookLogin` | Offered on the login page |
| Email link (Firebase calls it passwordless email link) | `sendSignInInvite` (login page button and admin console "send sign in link"), `isSignInWithEmailLink`, `signInWithEmailLink`; `handleEmailLinkSignIn` asks the person to type the email again; link target `/member-login/` | The default first method for new members. Corporate mail scanners often use up the one time link, and the page already has a message for that |
| Email link for Executive Signature results | `sendReadinessAccessLink`, then `signInWithEmailLink` on `apps/executive-signature/my-results/index.html` | Target `/apps/executive-signature/my-results/` |
| Email and password | `signInWithEmailPassword`, shown only at `/member-login/?emergency=1` (`maybeRenderEmergencyLogin`). Passwords are set by the admin callable `setEmergencyCredential` (`functions-admin/index.js`), which only works for an email that is already an active admin or owner | Break glass only. Regular members have no password |
| ES quick check account creation | `recordReadinessCompletion` (callable, no sign in needed) calls `admin.auth().createUser({ email, displayName })` with no password and an unverified email. The person later proves the email with the email link | Same function is the path for the paid full report |
| Admin console login | Google popup, then a check of `authorized_members/{email}.role` equal to `admin` or `owner` (plus a hard coded list of bootstrap owner emails). An older local "admin console password" setting (`utl_admin_password`) is browser only and does not grant server access | The admin console also reads Firestore directly (six places) so it needs a live Firebase session |
| Support preview and student experience preview | `assets/app-access-guard.js` and flags in `localStorage` (`utl_experience_preview_active`, `utl_admin_preview_bypass`). Not a separate account. The admin stays signed in as the admin and the preview only pauses writes | No sign in change needed, but it must keep working while the admin session changes provider |
| Custom tokens, anonymous, phone, two step, password reset, email change by the person | None in the code. Searched for `createCustomToken`, `signInWithCustomToken`, `signInAnonymously`, `PhoneAuthProvider`, `multiFactor`, `sendPasswordResetEmail`, `updatePassword`, `sendEmailVerification`: zero hits | A callable `changeMyCustomerEmail` exists on the server but no page calls it |
| Role claim for Supabase | Firebase function `setRoleClaimOnUserCreated` plus the backfill script `scripts/supabase-auth-claim-backfill.js` set `role = authenticated` on every Firebase user so Supabase accepts the token | Becomes unnecessary after the move (Supabase tokens carry the role on their own) |

Two more gates sit around every method and must keep working: `requireAuthorizedMember` (the email must be in `authorized_members`, otherwise the person is signed out) and the status and expiry checks in `finishGoogleUser`.

### 2.2 People and providers

From `docs/SUPABASE_AUTH_CLAIM_AUDIT.md` (2026-10-05, counts only) and the snapshot manifest (2026-10-07):

| Fact | Count |
|---|---|
| Firebase Auth accounts | 61 |
| Accounts matching one of the 55 members | 54 |
| Accounts with no member record | 7 (5 Google, 2 password or email link) |
| Members with no Firebase account | 1 |
| Accounts with a custom claim before the role backfill | 0 |
| Snapshot of 2026-10-07: `authorized_members` 56, `users` 55, `customerAuthLinks` 54 | |

**Not known yet:** the split of the 54 matched accounts across Google, Microsoft, Facebook, email link and password. The audit says email link accounts show up as `password` in Firebase, so "password" is not the same as "has a real password". The Firestore field `signInProviders` on each member record would answer it, but I was not allowed to read the snapshot, and a counts only script does not exist yet. See task A1 below.

What is also not known: how many of the 61 accounts have a stored password hash. Only these need the hash import in section 5.3. By design this should be the break glass accounts only.

---

## 3. Decisions I need from the owner

Written as questions with my recommendation.

1. **Which sign in methods stay?** Recommendation: Google and email always. Microsoft only if at least one active member uses it. Facebook only if at least one active member uses it (my guess is none). Decide after task A1 gives the counts.
2. **Which email sender?** The sign in emails need a sender on `theuntaughtlessons.com` or the emails land in spam. Options: Resend, Brevo, Amazon SES, Postmark. I recommend one with an easy dashboard and a free tier that covers 55 people. You choose, then you add the DNS records I give you. Sending through the Google Apps Script mail relay is possible for the welcome email but is not suitable for sign in codes (daily Gmail limits, and it is tied to one personal account).
3. **Email link or code, or both?** Recommendation: both in one email. A button that opens a page on your site, and a six digit code underneath. The code works on any device and avoids the scanner problem completely.
4. **Remove or keep the "type your email again" step?** Recommendation: remove it. The new link flow does not need it.
5. **Silent upgrade for people who are already signed in?** Recommendation: no. Their Firebase session keeps working during the two week window. When the window ends they sign in once more. Only build the silent upgrade if the active count turns out to be large.
6. **Closed sign up?** Recommendation: switch off "Allow new users to sign up" in Supabase, so only accounts that the server creates can sign in. This matches today's rule that only people in `authorized_members` get in. It costs one thing: the login page can tell an outsider "this email is not a member" (see risk R6).
7. **Test admin.** For testing the admin console I want a second admin member (a test member with the admin role) so tests never touch your own record. OK?

---

## 4. Target design

- Supabase Auth in the project `utl-core` (ref `czljyikfavtjgqcibdda`). The browser keeps using the plain web calls it uses now. For sign in it needs the Supabase browser library (`@supabase/supabase-js`). Recommendation: copy one pinned version of the library into `assets/vendor/` so the page loads it from your own site. This keeps the content security policy simple and avoids a third party script source. The exact version is chosen at build time, not now.
- Tokens: Supabase access tokens contain `iss` ending in `/auth/v1`, `sub` as the Supabase user id (a uuid), `role = authenticated`, `email` and `app_metadata`/`user_metadata`. Migration 1800 already maps this to the right person through `people.supabase_uid`.
- Google, Microsoft and Facebook use the redirect style (the whole page goes to the provider and comes back). The popup style is not the Supabase default. A bonus: the Firebase warning in `admin/index.html` about two popups at once (line 7247) disappears.
- Email: `signInWithOtp` with `shouldCreateUser: false`. The email template links to a page on your own site with a button, then the page calls `verifyOtp` with the token hash. A scanner that opens the link only sees the page and does not use up the token.
- Server functions: verify the Supabase token (either ask Supabase `auth.getUser(token)` on each call, simple and honours sign out, or check the signature against Supabase's published public keys at `/auth/v1/.well-known/jwks.json`). Which signing key type the project uses is not known to me (see unknowns).
- Roles: still read from the database (`authorized_members` today, `role_grants` after the move), never from the token. This is what the claim audit already decided.

---

## 5. Moving the people

### 5.1 The id mapping

| Thing | Today | After |
|---|---|---|
| The person | `people.id` (uuid made from the email) | Unchanged. This is the real key everywhere in Supabase |
| Firebase user id (28 letters and digits) | `people.auth_uid` (unique text) | Kept as a historical record, never deleted |
| Supabase Auth user id (uuid) | `people.supabase_uid` (unique uuid, column exists since migration 1200) | Filled for all people, matched by lowercase email |
| Safety checks | Migration 1800: `auth_uid` may not have uuid shape; `supabase_uid` may never equal any `auth_uid`; the sign in lookup depends on the token issuer | Already live. Nothing to add |

**Re keying.** Nothing needs re keying in the imported data:
- Imported rows use `people.id` or other uuids built from emails and document ids, not Firebase user ids.
- The only text column holding a Firebase uid besides `people.auth_uid` is `roster_drafts.submitted_by_uid` (migration 2130), and that table also has `submitted_by_person_id`. It is history. Leave it.
- Firestore documents keyed by Firebase uid (`users/{uid}`, `platform_staff/{uid}`, `organizations/*/members/{uid}`, `customerAuthLinks/{uid}`) stay as they are in Firestore until Firestore closes. The server code that reads them by `request.auth.uid` must be changed to look up the person by token first (section 7).

**The provisioning step** (new script, proposed name `scripts/supabase-auth-provision.js`, dry run by default, typed APPLY, counts only, never prints emails):
1. Read Firebase users with the Admin SDK (the same pattern as `scripts/supabase-auth-claim-backfill.js`).
2. For each active user with an email: create the Supabase Auth user with the Auth Admin API (`auth.admin.createUser`) using the lowercase email, `email_confirm` set to Firebase's `emailVerified`, a display name and photo in `user_metadata`, and a marker in `app_metadata` (`migrated_from: "firebase"`). The Admin API creates the user and the email identity together, which is safer than writing rows straight into `auth.users` (the official community tool writes `auth.users` only and no identity rows, so email sign in for those users is not guaranteed to work).
3. Write the new id back to `people.supabase_uid` for the person with that email. A person with no row yet (the 7 accounts without a member record) is reported, not guessed.
4. Safe to run twice: a user that already exists (same email) is skipped.
5. Keep the mapping file (Firebase uid, Supabase id, email) outside the repository, as the other backups are.

### 5.2 Per method

| Method of the person | What the script does | First sign in after the move |
|---|---|---|
| Google | Creates the account with a confirmed email. No identity row for Google yet | Supabase finds the account with the same verified email and links the Google identity to it. The account does not duplicate. I rely on Supabase's automatic linking of identities with the same verified email, which is documented behaviour, but **test it with the test member before relying on it** |
| Email link | Same as above | Request a code or link, sign in. No password reset needed because there was never a password |
| Microsoft, Facebook | Same as above | May fail to link if the provider does not say the email is verified. Test, and if it fails, tell those people to use the email code once (it links to the same account). See unknowns |
| Password (break glass) | See 5.3 | Same password if the hash import works, otherwise one reset email |
| ES quick check (accounts with no member record, unverified email) | Create with `email_confirm` false, or true. Unknown which is better (see R9) | Email code |
| Disabled Firebase accounts | Skip, list the count | Not applicable |

### 5.3 Passwords, without forcing a reset where possible

**Facts I checked.**
- Firebase stores passwords with a modified scrypt. To read it, four project parameters are needed: the signer key, the salt separator, the rounds and the memory cost. They are in the Firebase console: Authentication, Users, the three dots menu, "Password hash parameters". Treat them as secrets.
- The Supabase migration guide and the community tool `firebase-to-supabase` do **not** import password hashes. The tool writes an empty password. Its password check "middleware" is marked unfinished.
- The Supabase Auth server source does contain a check for Firebase's scrypt format. A stored password with this exact shape is verified on sign in:

  `$fbscrypt$v=1,n=<memory cost>,r=<rounds>,p=1,ss=<salt separator>,sk=<signer key>$<salt>$<password hash>`

  where `n` is the memory cost exponent as Firebase shows it (14 means 2 to the power 14), `r` is the rounds value (8 in the Firebase sample), `p` is 1, and the salt separator, signer key, salt and hash are standard base64.
- I did not find this format in the Supabase user documentation. So it is supported in code, but not promised in the docs. That is the risk.

**Method.**
1. Export the users with their hashes using the Firebase CLI (`firebase auth:export users.json --format=json`) or the Admin SDK `listUsers`. Keep the file outside the repository and delete it after the import. It holds secrets.
2. Only for accounts that have a hash: build the string above. Firebase writes salt and hash in web safe base64 (`-` and `_`); convert to standard base64 (`+` and `/`, with padding) before building the string.
3. Create the user, then set the stored password to that string. The Admin API's `password_hash` field is documented for bcrypt and Argon2 only. Whether it accepts the Firebase format is **not confirmed**. If it refuses, the fallback is a one off SQL update of `auth.users.encrypted_password` for those few rows, run by the owner in the SQL editor after review. This is a write to the auth tables, so it needs the owner's explicit approval at that time.
4. **Prove it first** with a throwaway account that has a known password (create one in a scratch Firebase user, export it, import it, sign in). If sign in works, apply it to the real accounts. If not, send those people a Supabase "set a password" email instead.
5. Limits:
   - It only works if the account is a real password account. Email link accounts have no hash.
   - After the Firebase project is deleted, nobody can re run this, so do it during the dual window.
   - Supabase may keep the Firebase style hash after a successful sign in and not convert it to its own. That is acceptable, but a later password change by the person writes a normal hash.
   - Passwords shorter than the Supabase minimum (default 6) are not affected by import, only by later changes.

**Realistic expectation:** there are very few password accounts, so even the worst case (everyone gets a reset email) is small. Do not spend more than half a session on this.

---

## 6. Every place in the code that changes

Counted from searches on 2026-10-08. File and function names only.

### 6.1 Browser: `assets/firebase.js` (the main file)
- Imports of the Firebase Auth library (lines 1 to 21) and the Auth setup: `auth`, `provider`, `microsoftProvider`, `facebookProvider`, `authPersistenceReady`, the emulator connection for Auth, `requireFirebaseAuth`.
- Sign in functions: `signInWithEmailPassword`, `signInWithGooglePopup`, `signInWithGoogleRedirect`, `getGoogleRedirectResult`, the Microsoft and Facebook equivalents, `describeAccountExistsError` (uses `fetchSignInMethodsForEmail`, which Supabase does not need because linking is automatic), `getSignedInUser`, `requireAuthorizedMember` (its sign out), `sendSignInInvite`, `sendReadinessAccessLink`, `actionCodeSettings`, `readinessActionCodeSettings`.
- `saveUserProfile` (writes `users/{uid}` keyed by Firebase uid, refreshes the token for new accounts) and `getMemberAccount` (reads `user.uid`, `user.providerData`).
- `supabaseData()` passes `getIdToken` from the Firebase user. This becomes "Supabase session token if present, otherwise Firebase token" during the dual window, then only Supabase.
- `settleDataSourceAtPageLoad` and the data source gate: they wait for a Firebase signed in user. They need to ask the new session helper instead.
- All the `httpsCallable` wrappers that begin with `await getSignedInUser()`: about 30 functions (organization console, ES status, customer directory, credentials, and so on). They keep working only while a Firebase session exists, see the cutover section.
- The export list at the bottom (lines 2749 to 2871) hands raw Firebase SDK functions to pages: `auth`, `onAuthStateChanged`, `signInWithEmailLink`, `isSignInWithEmailLink`, `createUserWithEmailAndPassword`, `signInWithPopup`, `GoogleAuthProvider`, `signOut`. Pages that use them must switch to a small wrapper (`getSession`, `onSessionChange`, `signOutEverywhere`).

### 6.2 Browser: pages and scripts that touch sign in
- `member-login/content-config.js`: `handleGoogleLogin`, `handleMicrosoftLogin`, `handleFacebookLogin`, the three `handle...RedirectResult` functions, `handleEmailLinkSignIn`, `maybeRenderEmergencyLogin`, `finishGoogleUser`, `finishGoogleCredential`, `clearWorkspaceSession`, the account page (`getMemberAccount` consumer, provider labels around line 2306), the login markup in `renderIndex`.
- `admin/index.html`: `openProductionAdmin`, `mbRequireFirebaseAdmin`, `mbSwitchFirebaseAdminAccount`, `mbGetFirebaseAdminRole`, `adminFirebaseApiReady`, `waitForAdminFirebaseApi`, the member add and "send sign in link" code around lines 5321 to 5362 (it even tells the admin to enable email link in the Firebase console), `auth.currentUser?.email` at line 8345, and the Emergency access tab (`eaSubmit` around line 12602, `setEmergencyCredential`). The six direct Firestore calls must already be moved.
- `admin/inbox/index.html` (line 228, the token for the inbox) and `admin/inbox/inbox.js` (`getToken`).
- `apps/executive-signature/my-results/index.html`, `apps/executive-signature/home/index.html`, `apps/executive-signature/assets/site-nav.js` (`onAuthStateChanged`, `signOut`), `apps/executive-signature/index.html` (the access link and account check).
- `apps/toolkit/index.html`, `my-results/index.html`, `certificate/index.html`, `tsa-score.html`, `apps/find-your-level/index.html`, `member-login/organization.html`: each calls `getSignedInUser` or `signOut`.
- `assets/feedback-widget.js` (`auth.currentUser.getIdToken`, `onAuthStateChanged`), `apps/explain-to-aiko/aiko.js` (line 425, sends the token to the Aiko scorer), `assets/app-access-guard.js` (reads only local flags, no change except to keep them aligned).
- `tools/supabase-auth-check/index.html`: the diagnostic page signs in with Firebase. Add a Supabase mode.
- `verify/index.html` imports `db` only for a public read. Not a sign in change, but it moves with Firestore.

### 6.3 Server: `functions-admin/` (Firebase codebase `admin-actions`)
- `requireVerifiedCaller` (line 102) and every function that checks `request.auth.token.email` and `email_verified === true`: lines 103, 1469, 1600, 1658 and `readiness-email.js` line 198. They must accept a Supabase token. Note: Supabase puts the verified email flag in different places depending on how the person signed in. Do not copy the `email_verified` test blindly. Check the person's confirmation time with `auth.admin.getUserById`, or check what the token really contains (task in the test plan).
- `request.auth.uid` used as a key: `requireCustomerProgramRole` (reads `platform_staff/{uid}`), `resolveMyCustomerIdentityHandler`, `getMyWorkspacesHandler`, `getMyEsStatusHandler`, `changeMyCustomerEmailHandler`, the credential functions (`issueVerifiedCredential` line 450), the organization functions (`collectionGroup("members").where("uid", "==", caller.uid)` line 669, roster drafts), `getCohortStanding` (line 1236). Each must resolve the person from the token first.
- Calls to `admin.auth()`: `checkOrganizationRepEmail` (line 1104 `getUserByEmail`), `saveOrganizationAccessMember` (line 1120), `setEmergencyCredential` (lines 1683 to 1687: `getUserByEmail`, `updateUser`, `createUser`), `recordReadinessCompletion` (lines 1758 to 1761: `getUserByEmail`, `createUser`), `checkReadinessAccountEmail` (line 1846), `setRoleClaimOnUserCreated` (lines 1943 to 1947, to be deleted at the end). All move to the Supabase Auth Admin API (a secret key kept as a server secret, never in the browser).
- `removeMemberHandler`: today it deletes `authorized_members` and `users` but does not delete the Firebase Auth account (a removed member can still sign in and write, noted in the handoff). Decide for Supabase: ban or delete the Auth user when a member is removed. Recommendation: ban, so the history is kept.
- `functions-admin/auth-claims.js` and `tests/auth-claim-merge.test.js`: delete at the end.
- `customer-program-service.js` (`resolveCustomerIdentity` with `authUid`) and `functions-admin/supabase-mirror/organizations.js` (`personStubRows` writes `auth_uid`) and `people.js`: take a "subject plus issuer" and write `supabase_uid` for Supabase subjects.

### 6.4 Server: other codebases
- `functions-aiko/`: the scorers (`scoreExplainToAiko`, `scoreScqa`, `runAdvisoryBoard`, `scoreTsaDiagnostic`) do not verify any token. `store-attempt.js` only forwards the caller's bearer token to Supabase, which works with a Supabase token without change. Nothing required. (Separate observation: these endpoints are open to anyone, which is a different question from this plan.)
- `functions/` (Google Group sync): triggered by a Firestore write, no sign in. No change.
- `firestore.rules`: read the Firebase token. They stop mattering when Firestore closes. No change for sign in, but while Firestore is in use members still need a Firebase session (see the cutover section).

### 6.5 Database and scripts
- No schema change is required to start. After the dual window:
  - Remove the "no `iss` claim" fallback branches in `private.jwt_identity` and the Firebase branch (a new migration, with a down file like the others).
  - Remove or keep `people.auth_uid`: keep.
  - Remove the Firebase third party provider in Supabase (dashboard step, section 10).
- Scripts to add: `supabase-auth-provision.js` (section 5.1), `supabase-auth-provider-audit.js` (counts only: provider mix, password hash present, email verified, last sign in age, disabled), and an optional rollback script that creates missing Firebase users for people created only in Supabase.
- Scripts to retire at the end: `supabase-auth-claim-audit.js`, `supabase-auth-claim-backfill.js`.
- Tests to update: `tests/member-login-auth-options.test.js`, `tests/customer-program-callable-auth.test.js`, `tests/supabase-switch.test.js`, `tests/helpers/firebase-harness.js`, `tests/data-source-preserved.test.js`, and the others that import the harness (about 40 files mention `assets/firebase.js`).
- Docs to update after: `WEBSITE_CONTEXT.md` (line 66 and 122), `FIREBASE_EMAIL_TEMPLATE.md` (replace with the Supabase template text), `docs/SUPABASE_BUILD_HANDOFF.md`.

---

## 7. Settings: redirects, domains, content security policy

### 7.1 Supabase Authentication settings
| Setting | Value |
|---|---|
| Site URL | `https://theuntaughtlessons.com` |
| Redirect URLs (allow list) | `https://theuntaughtlessons.com/member-login/**`, `https://theuntaughtlessons.com/apps/executive-signature/my-results/**`, `https://theuntaughtlessons.com/admin/**`. Add `http://localhost:8082/**` only while testing on your computer, and remove it afterwards. Add the `www` form only if the site answers on it (the repo has `CNAME` with the bare domain) |
| Email provider | On. "Confirm email" on |
| Allow new users to sign up | Off (decision 6) |
| Google, Azure (Microsoft), Facebook | Configure only the ones kept |
| One time password expiry | 3600 seconds or less (Supabase recommends this). I suggest 1800 |
| Third party auth: Firebase | Keep during the dual window. Remove at the end |
| Password settings | Minimum length 12 to match `MIN_EMERGENCY_PASSWORD_LENGTH` |
| CAPTCHA | Optional (Cloudflare Turnstile). Worth adding if the login page becomes a target. Your site already sits behind Cloudflare |
| Session length and sign out after inactivity | Offered on the Pro plan. Default keeps people signed in until they sign out, which matches Firebase |

### 7.2 Google
Redirect URI to allow at Google: `https://czljyikfavtjgqcibdda.supabase.co/auth/v1/callback`. The page the person lands on afterwards is the redirect URL from the table above, set in the code (`redirectTo`). Pass `prompt: select_account` as a query parameter to keep today's behaviour.

The Google consent screen will name the Supabase address. Firebase shows `the-untaught-lessons.firebaseapp.com` in the same place today, so this is not a step backwards. A custom domain for Supabase Auth is a paid add on and is optional.

### 7.3 Content security policy
- Fact: the live site does **not** send any security policy header today. I checked the response headers of `https://theuntaughtlessons.com/` on 2026-10-08. The `_headers` file in the repo (a report only policy) and the header block in `firebase.json` are not used, because GitHub Pages serves the site and does not read those files. Treat both as notes, not as protection.
- If a policy is ever applied (for example with a Cloudflare rule), what sign in needs:
  - `connect-src`: `https://czljyikfavtjgqcibdda.supabase.co` (already listed in `_headers`).
  - `script-src`: nothing new if the Supabase library is copied into the site. If loaded from a content delivery network, that host.
  - Google, Microsoft and Facebook sign in use full page redirects, so `frame-src` and popup rules are not needed (`COOP: same-origin-allow-popups` is only needed for popups).
  - Remove after leaving Firebase: `https://www.gstatic.com` (Firebase scripts), `https://*.googleapis.com`, `https://*.firebaseio.com`, `https://*.cloudfunctions.net`, `https://*.a.run.app`, and `https://accounts.google.com` in `frame-src`.
  - If a custom domain is added for Supabase Auth, add it to `connect-src`.
- No enforcement test is possible until a policy is actually applied.

### 7.4 Email templates and sender
- Templates to write (owner's voice, no dashes): Magic link (the sign in email, with a button and a code), Confirm sign up (rarely used because accounts are created by the server), Reset password (break glass accounts only), Change email address, and optionally the security notices (password changed, sign in method linked).
- The sign in email: subject "Your sign in code for The Untaught Lessons". Body: a button "Open my workspace" pointing to `{{ .SiteURL }}/member-login/?token_hash={{ .TokenHash }}&type=email`, then "Or enter this code: `{{ .Token }}`". The page shows a "Continue" button and only then calls `verifyOtp`, so scanners cannot use the token up. Supabase's own guidance recommends this approach for company mail systems.
- Sender: a custom SMTP service. The Supabase built in sender is limited to a very small number of emails per hour and is meant for project team addresses only, so it is not usable. The sender address, for example `login@theuntaughtlessons.com`, must be verified with the provider by adding DNS records (SPF, DKIM and a DMARC record) in Cloudflare. Turn off link click tracking at the sender, because it rewrites the link and breaks it.
- Today's Firebase sender name and subject (`FIREBASE_EMAIL_TEMPLATE.md`) are the model for the new text.

### 7.5 Rate limits (from the Supabase documentation on 2026-10-08)
| Limit | Value | Effect for UTL |
|---|---|---|
| Emails that sign in or sign up cause | Set by you once custom SMTP is on. Supabase's guide says the default for custom SMTP is 30 new users per hour | Fine for 55 people. Raise it before a large intake |
| Sign in codes (`/auth/v1/otp`) | 360 per hour for the whole project, and one request per 60 seconds for the same person | Fine. A whole cohort asking at the same time (60 people) is well under the limit |
| Code or link checks (`/auth/v1/verify`) | 360 per hour per IP address, bursts of 30 | A company office behind one IP address could reach this if many people sign in within the same hour. Unlikely at this size. Watch for 429 answers at the first large cohort |
| Token refresh | 1800 per hour per IP address | Fine |
| Where the limits are changed | Authentication, Rate Limits | |

### 7.6 Other
- Supabase Pro already includes a large monthly active user allowance. People who sign in through the Firebase bridge also count. At 61 accounts this is not a cost question.
- Supabase's JWT signing keys: check the setting (Project Settings, JWT Keys). A newer project uses asymmetric keys that servers can verify against a public list. If the project still uses the older shared secret, the server should use `auth.getUser` instead. Unknown today.

---

## 8. Cutover options

### Option A: all at once, with a maintenance window
Everyone is moved on one day. The old login pages are replaced, every member signs in again, Firebase Auth is turned off for the site that evening.
- Good: only one code path at a time. No period of two systems.
- Bad: everyone is signed out on the same day, which conflicts with your decision that sign in must keep working at all times for the AyalaLand people. Rollback after new accounts have been created in Supabase only (a new member, an ES quick check) is messy. A mistake in email delivery or Google setup affects everybody at once.

### Option B: dual login period (about two weeks), recommended
1. Before the window (members notice nothing): create all Supabase accounts, set up providers and email sending, build the new login page behind a switch that is off, test with the test member.
2. Window day: turn the switch on. New sign ins use Supabase Auth. People who are already signed in with Firebase are not interrupted, because Supabase still accepts their Firebase token and the database already recognises it.
3. During the window new accounts (a new member added by the admin, an ES quick check) are created in Supabase only.
4. After two weeks of quiet: end the dual window. Remove the Firebase third party provider in Supabase, delete the claim trigger and backfill scripts, stop offering the old login. Keep Firebase Auth accounts untouched for at least one more week.
- Good: nobody is forced out. Cheap undo (turn the switch off). It matches the plan already written (section F of the migration plan said both token types are accepted for a week; I suggest two weeks because AyalaLand members "log in occasionally").
- Bad: two code paths for two weeks, and the server functions have to understand both kinds of token during that time.

### Option C: bridge (only if the order of work forces it)
If sign in must move before the server functions and admin console have moved: add one Firebase function that checks a Supabase login and returns a Firebase "custom token" for the person's existing Firebase uid (looked up in `people.auth_uid`). The browser then signs into Firebase with it as well. Everything that depends on a Firebase session keeps working with no other change. Cost: one new sensitive function, a Firebase account must still exist for each person (including new ones), and Firebase stays in the sign in path for longer. I do not recommend it unless the schedule demands it.

### Recommendation
**Option B, with sign in moved after phases 4 and 5.** Reason: Option B protects the people you said must never lose access, it has an easy undo, and the database already supports it. Moving sign in last removes the single biggest risk (the Firebase only server functions). If that order has to change, use Option C as a temporary step, not Option A.

**Prerequisites for the window day (all must be true):**
1. The server functions listed in 6.3 accept a Supabase token (by moving to Supabase or by a shared token check).
2. The admin console no longer reads Firestore directly, or the admin keeps a Firebase session for as long as it does.
3. `recordReadinessCompletion` and `setEmergencyCredential` create accounts in Supabase.
4. Custom email sender verified and a test email received in the main mailbox providers (Gmail, Outlook, and a corporate mailbox if you have one).
5. The test plan in section 9 passed with the test member.

---

## 9. Rollback

| Stage | How to go back | What it costs |
|---|---|---|
| Before the window day | Nothing to undo. Supabase accounts are inert until used. Delete them with the Auth Admin API if wanted | None |
| During the window | Turn the switch off. The login page returns to Firebase. Firebase accounts were never changed, so everyone can sign in as before | Anyone created only in Supabase during the window (new members, ES quick checks) has no Firebase account. Run the rollback script to create their Firebase accounts, or have them use the email link once |
| After the window, Firebase still present | Same as above, and the Firebase provider must not have been removed from Supabase yet. This is why the removal comes last | Same |
| After Firebase is closed | Import the saved Firebase Auth export back into a new Firebase project (`firebase auth:import` with the saved hash parameters), and redeploy the old login code from git | A half day or more. It is the reason to take the export, with hash parameters, before any change and to keep it encrypted offline |

Before the window day, take and keep: the Firebase Auth export, the hash parameters, the mapping file (Firebase uid, Supabase id), and a note of the current Supabase Auth settings (screenshots of each page are enough).

---

## 10. Test plan (separate test members only)

Rules, taken from the memory note: never run tester exercises on the owner's own member record. Sign in only (no completing exercises) is acceptable on the owner's own account as the very last check. Use the existing test member recorded in `docs/SUPABASE_BUILD_HANDOFF.md` for member tests, and a second test member created through the admin console with the admin role for admin tests (decision 7). For the ES quick check use new addresses of your own mailbox with a plus part (for example `+utlsignin1`), which the system treats as new people. Remove all test rows afterwards with the cleanup tools.

| # | Test | Pass looks like |
|---|---|---|
| 1 | Provision dry run, then apply for the test member only | The count says 1 created, `people.supabase_uid` is filled for that person, nobody else changed |
| 2 | Hash proof with a throwaway password account | Sign in with the old password works, or the fallback (reset email) works |
| 3 | Google sign in for the test member (desktop Chrome, iPhone Safari, one Android phone) | Lands on the workspace. Only one Auth user exists for that email. The database shows the same person |
| 4 | Email code and link for the test member | The code works. The link opens a page with a button. Opening the link in a second browser without clicking does not use it up (simulated scanner) |
| 5 | Email delivered to Gmail, Outlook and one company mailbox, in the inbox and not in spam | Yes in all three |
| 6 | A non member email on the login page | A friendly refusal, no account created, no leftover row |
| 7 | An inactive member and an expired member | Same messages as today (`finishGoogleUser` checks) |
| 8 | Dual window: sign in with Firebase on one browser and Supabase on another for the same test member | Both see the same progress. Saves from either land on the same person |
| 9 | An already signed in Firebase session when the switch turns on | Not interrupted. Data saves still work |
| 10 | Admin console: sign in as the test admin, open Members, Student Progress, send a sign in link, add a member | Works. A non admin is refused |
| 11 | Emergency password path with the test admin | Works. A wrong password gives the same message as today |
| 12 | ES quick check with a new plus address, then "see my results" | Account created, code arrives, results open. The server function accepts the new session (the `email_verified` check works) |
| 13 | Support preview and student experience preview as the test admin | Banner shows, writes stay paused, exit works |
| 14 | Sign out on one page signs out on all pages, and the next page load asks for a login | Yes. Also check `clearWorkspaceSession` clears the new storage key (`sb-...-auth-token`) |
| 15 | Rate limits: request a code twice in a minute | Second request gets a clear "wait a minute" message, not a blank error |
| 16 | After the window: remove the Firebase provider in a copy of the settings first (a Supabase branch if available) | Nothing in the site still sends a Firebase token. `stability_events` shows no `auth` errors for a day |

Also run the full existing test suite (`npm test` style runner, 122 test files) after each build step, and the database suites for any migration.

---

## 11. Exact owner steps

Menu names change over time in both consoles. If a name differs, search the page for the setting name in quotes.

### 11.1 Information to gather first (task A)
- A1. Ask Claude to build `supabase-auth-provider-audit.js` (counts only), run it as a dry run in your terminal, and read the counts back: how many accounts per provider, how many have a password hash, how many are unverified, how many signed in during the last 90 days.
- A2. In the Firebase console (Authentication, Users), note the date of the last sign in of anyone from AyalaLand.

### 11.2 Supabase dashboard (project `utl-core`)
1. Authentication, Sign In / Providers (also called Providers): confirm Email is on. Turn on "Confirm email". Turn off "Allow new users to sign up" when the provisioning is done and tested.
2. Authentication, Sign In / Providers, Google: enter the client ID and secret from section 11.3. Copy the callback address shown there into the Google console. Leave "Skip nonce check" off.
3. Same page, Azure (Microsoft): only if kept. Needs an Azure app registration (section 11.4). Set the tenant URL for work, school and personal accounts according to Supabase's current Azure guide.
4. Same page, Facebook: only if kept.
5. Authentication, URL Configuration: set the Site URL and the redirect URL list from section 7.1.
6. Authentication, Emails (Templates): paste the texts Claude writes for Magic link, Confirm sign up, Reset password, Change email address. Subject lines too.
7. Authentication, Emails, SMTP Settings: switch on custom SMTP and enter the host, port, user, password and the sender address and name from your email provider. Enter the secret yourself, never in a chat.
8. Authentication, Rate Limits: set the email send limit, leave the others unless a test shows a need. Turn on IP address forwarding only if a server function will call the Auth API for many different users (it is for server side calls).
9. Authentication, Attack Protection: optional CAPTCHA with Cloudflare Turnstile.
10. Authentication, Sessions (Pro): decide on time limits. Default is fine.
11. Project Settings, JWT Keys: note whether the project uses asymmetric keys. Tell Claude.
12. Project Settings, API Keys: create a new secret key for the provisioning script and the server functions that create accounts. Store it as a Firebase secret for functions (`firebase functions:secrets:set`) and in your terminal session only for the script. Delete the one used for the script when it is done (the same habit as the import key).
13. Authentication, Third-Party Auth: leave Firebase in place until the end of the dual window. Remove it last.
14. Authentication, Users: after provisioning, look at the count (about 61 minus disabled) and open the test member only.

### 11.3 Google Cloud console (project `the-untaught-lessons`)
1. APIs and Services (or Google Auth Platform), Credentials: Create credentials, OAuth client ID, Web application. Name it "UTL Supabase sign in". I recommend a new client instead of editing the Firebase one, so the two can be removed independently.
2. Authorized redirect URIs: add `https://czljyikfavtjgqcibdda.supabase.co/auth/v1/callback`.
3. Authorized JavaScript origins: add `https://theuntaughtlessons.com` (not needed for plain redirect sign in, harmless to add).
4. Copy the client ID and secret into the Supabase Google provider page (11.2 step 2).
5. OAuth consent screen (Google Auth Platform, Audience and Branding): confirm the status is "In production" (not "Testing", which limits to listed test users and expires sign ins). Confirm the scopes are only `openid`, `email` and `profile`. These do not need a Google review. Confirm the authorized domain `theuntaughtlessons.com` is listed.
6. At the end: delete the Firebase created web client only after Firebase Auth is closed.

### 11.4 Microsoft (only if kept)
Azure portal, Microsoft Entra ID, App registrations, New registration. Supported account types: accounts in any organisational directory and personal Microsoft accounts. Redirect URI (Web): the same Supabase callback. Create a client secret and enter ID and secret in Supabase. Secrets expire (up to 24 months). Add a calendar reminder.

### 11.5 Email sender and DNS (Cloudflare)
Create an account with the chosen email provider. Add the sending domain. Add the DNS records the provider shows (SPF, DKIM, and a DMARC record starting with a monitoring only policy). In Cloudflare set these records to "DNS only" (grey cloud). Wait for the provider to show "verified". Send a test email to three mailboxes.

### 11.6 Later, on the window day and at the end
- Window day: tell Claude to turn the switch on after the prerequisites pass. You or Claude flips it in the settings document, whichever the build chooses.
- End of window: remove the Firebase provider (11.2 step 13), delete the claim trigger with `firebase deploy` run by you (Claude does not deploy functions), save the final Firebase Auth export, then pause the Firebase project as already planned.

---

## 12. Keeping Firebase Auth alone as the fallback

**Is it viable?** Yes. It is the setup running in production today. Supabase documents Firebase Auth as a supported third party sign in provider. All data layer calls, the identity lookup, and the row level security rules already work with Firebase tokens, and tests exist.

**What it costs to stay:**
- **Two vendors forever.** Firebase must stay for Auth even after Firestore and the other functions are gone. The Firebase project cannot be paused or deleted, which changes the plan's final step ("pause the Firebase project for 90 days, then delete").
- **The role claim stays a standing duty.** The `setRoleClaimOnUserCreated` function (a first generation Cloud Function) must keep working for every new account, and the first token of a new account does not have the role until it is refreshed. Today `saveUserProfile` forces that refresh. If a new sign in path forgets it, the person gets a silent 401 on their first save.
- **Server functions for accounts remain in Firebase.** `recordReadinessCompletion` and `setEmergencyCredential` create Firebase accounts, so a Firebase Cloud Functions deployment (Blaze billing plan) must be kept just for them, or rewritten as small functions that still call the Firebase Admin SDK.
- **Weaker email control.** Firebase's sign in email template is limited (`FIREBASE_EMAIL_TEMPLATE.md` says so), its sender is a Firebase address, and corporate scanners already burn the one time link. Supabase gives a real template, a code option and your own sender.
- **No single place to manage people.** The admin sees members in Supabase but accounts in the Firebase console.
- **Security hygiene is on you.** Firebase tokens have no `iss` match with Supabase unless the database function keeps checking the issuer (it does). Any future change to row level security must keep thinking about two identity types, and migration 1800 exists only because of this.
- **Money:** small. Firebase Auth for 61 accounts is free. Cloud Functions on Blaze cost cents at this volume. Supabase counts third party sign in users in its monthly active user allowance, which Pro covers many times over.

**When I would choose it anyway:** if the sign in move is delayed by the server function move, or if the owner prefers not to take the delivery work (custom domain email, DNS) and risk now. It does not block any other part of the migration.

---

## 13. Unknowns and risks

Honest list. The first four I could not settle by reading.

| # | Unknown or risk | What I would do about it |
|---|---|---|
| R1 | Provider split of the 54 matched accounts, and how many have a password hash | Task A1, before any decision on Microsoft, Facebook and passwords |
| R2 | Whether the Supabase Admin API accepts a Firebase style password hash, or only the database column can hold it | Prove it with a throwaway account (test 2). Worst case: a few reset emails |
| R3 | Whether the Microsoft and Facebook sign in link to an existing account when the provider does not mark the email as verified. Supabase links only on a verified email | Test with the test member. Fallback: those people use the email code once |
| R4 | Whether an account created by the server with an unverified email can still use the email code, and which token field carries "email verified" for each method | Test 12 and a small token inspection on the preview. The server must not assume Firebase's `email_verified` claim |
| R5 | Which signing key type the Supabase project uses | Look at Project Settings, JWT Keys. Choose `getUser` or public key checking accordingly |
| R6 | With sign up closed, the login page learns if an email is a member (the error differs). Today Firebase sends a link to any address and rejects after sign in. Someone could probe for member emails | Turn on CAPTCHA, or route the request through a small server function that always answers the same way. Decide with the owner. At 55 people the harm is small but not zero |
| R7 | The server functions are the real critical path. Starting the sign in move early creates the problem of members who have no Firebase session | Keep the order in section 8. Option C is the escape |
| R8 | The email sender is new and untested. Spam placement can quietly stop people from signing in | Test 5. Keep the emergency path and the admin "send a link" tool until delivery is proven. Monitor bounce reports for the first week |
| R9 | ES quick check accounts: if created as confirmed without proof, then a stranger who types someone else's email only creates an empty account that still requires the inbox to use. If created unconfirmed, the first code may behave as a sign up email rather than a sign in email | Test on the preview with a plus address. Pick the behaviour that sends one clear email |
| R10 | The popup flow in the admin console is replaced with a page redirect. The admin console holds a lot of in page state | Return to the same tab (`?tab=` is already supported). Test 10 |
| R11 | Session storage: Supabase stores its session in the browser's local storage under its own key. A person who signs in on two tabs is fine. A shared computer needs the existing sign out to clear it | Test 14 |
| R12 | A removed member can still sign in with an existing account (already true for Firebase). Supabase can ban the user, which is better | Decision at build time. Recommend ban on removal |
| R13 | I found `functions-aiko` endpoints that accept requests with no token check. Not part of this plan but worth a separate review | Not in scope here |
| R14 | Supabase documentation and menu names change. My steps are accurate in intent, not in every label | Search the dashboard for the setting name |

---

## 14. Order of work, in the owner's voice

Each line starts with the short version.

### Before the sign in project starts (already planned)
- [ ] **Finish phases 4 and 5.** The server functions and the admin console must be on Supabase, or I accept Option C.
- [ ] **Count the sign in methods.** I ask Claude for the counts only script and read the numbers (A1).
- [ ] **Choose the email sender.** I pick a provider and tell Claude the sender address.

### Quiet preparation (members notice nothing)
- [ ] **Set up the email sender.** I add the DNS records and send three test emails (11.5).
- [ ] **Set up Google at Supabase.** New client in the Google Cloud console, then the Supabase Google page (11.3, 11.2).
- [ ] **Write the email texts.** Claude drafts, I approve, I paste them into Supabase (7.4, 11.2).
- [ ] **Take the safety copies.** Firebase Auth export with hash parameters, a screenshot of every Supabase auth page, and the mapping file location (section 9).
- [ ] **Claude builds** the provisioning script, the new login page behind a switch, the session helper, the server token check, the tests. Claude does not deploy.
- [ ] **I create a new secret key** in Supabase for the script and for the account creating functions, and delete the script key afterwards (11.2 step 12).
- [ ] **Provision the test member only.** Dry run, read the count, apply (test 1).
- [ ] **Prove passwords with a throwaway account** (test 2).
- [ ] **Run the whole test plan** with the test member and the test admin (section 10).
- [ ] **Provision everyone.** Dry run, read the counts, apply. Check Authentication, Users shows the expected number.

### Window day
- [ ] **Check the prerequisites** in section 8.
- [ ] **Deploy the site and the functions.** The push to `main` and every `firebase deploy` are run by me.
- [ ] **Turn the switch on.** Watch `stability_events`, the Supabase Auth logs and my support mail for the day.

### During the two weeks
- [ ] **Watch daily for five minutes.** Sign in errors, 429 answers, bounced emails, members who write in.
- [ ] **Ask one AyalaLand member** to sign in once and tell me what happened.

### End of the window
- [ ] **Remove the Firebase provider** from Supabase (11.2 step 13).
- [ ] **Delete the role claim trigger** and retire the claim scripts.
- [ ] **Remove the Firebase fallback** from `private.jwt_identity` in a new migration with a down file.
- [ ] **Save a final Firebase Auth export,** then the Firebase project is paused as planned.
- [ ] **Remove** `http://localhost:8082/**` from the Supabase redirect list, delete the unused secret keys, and update `WEBSITE_CONTEXT.md`.
