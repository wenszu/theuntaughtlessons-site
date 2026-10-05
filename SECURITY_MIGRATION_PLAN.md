# Security migration plan

This document separates changes that can ship without altering the learner journey
from changes that require coordinated Firebase, Cloudflare, Google Workspace, or
Google Apps Script deployment. Do not treat browser-side checks as authorization.

## Current stage status

| Stage | Status verified 2026-10-04 | Evidence |
| --- | --- | --- |
| 1. Production admin authentication | Implemented in the production Pages source; bootstrap/backup-owner operational check remains | `admin/index.html`, current `main` history |
| 2. Authenticated administrative services | Partially deployed | `runAdminAction` and several admin callables are live; current source has additional undeployed callables and Google Group automation is retired/undeployed |
| 3. Authenticated AI services | Outstanding | Two Aiko HTTP functions are deployed, but Firebase-token/App Check/quota migration is not implemented as specified |
| 4. Server-authoritative progress and rewards | Partial | Credential/progress repair triggers/callables exist; core reward/progress authority is still shared with browser/Firestore flows |
| 5. Genuinely private course delivery | Outstanding | Production content is a public GitHub Pages artifact; application guards do not make files private |
| 6. Public forms and enforced browser policy | Outstanding/partial hardening only | Spam input guard exists; no Turnstile, and `_headers` is not enforced by GitHub Pages |

## Implemented non-disruptive hardening

- Saved learner responses are escaped before My Results renders them.
- Anonymous access requests have an exact Firestore schema and length limits.
- Members can read only the settings documents required by the member experience.
- The Apps Script helper neutralizes spreadsheet formula prefixes in removal logs
  and limits Google Group operations to the configured UTL group.
- AI endpoints reject request bodies larger than 64 KB.
- A repository `_headers` file documents a proposed report-only CSP and baseline
  headers, but GitHub Pages does not apply it as response-header configuration.
- Pull requests and pushes to `main` run tests, secret-pattern checks, syntax checks,
  and high-severity dependency audits.
- All three Firebase Functions codebases have lockfiles for reproducible installs.

## Stage 1: production admin authentication (implemented in code)

### Change

The Admin Console now ignores the browser password and local authorization flag on
production. It requires Firebase Google sign-in and verifies `admin` or `owner`
authorization before showing the console. The local username/password preview flow
remains available only on `localhost` and `127.0.0.1`; emergency production password
access is a separate hidden, server-gated path. The static admin gate is live, while
the backup-admin verification below remains an owner/operations check.

### Member impact

None. Member Google sign-in remains the same.

### Admin impact

- Admins must use an approved Google account.
- The shared admin password stops working.
- Every admin needs an `authorized_members` record with `admin` or `owner` role.
- Verify at least two owner/admin accounts before removing the old gate so one
  account problem cannot lock out the organization.

### Rollout gate

Confirm the bootstrap owner can sign in on production and perform a harmless
read-only admin action before disabling the old gate.

## Stage 2: authenticated administrative services (implemented in code)

### Change

Welcome email, test email, and removed-member logging now use the authenticated
`runAdminAction` Firebase callable, which verifies the Firebase identity and an
`admin` or `owner` role server-side before relaying an allowlisted action to Apps
Script. The relay uses a server-held shared secret and a 64 KB request cap. Google
Group changes are no longer part of member onboarding. `runAdminAction` is deployed,
but the optional Firestore Google Group worker is not deployed and member access
does not depend on it. Several newer admin exports in the current source are also
not deployed; use `firebase functions:list` during a release review.

### Member impact

No visible change. Welcome email delivery may be briefly delayed during cutover.

### Admin impact

- The same buttons remain, but an expired Google session requires sign-in again.
- Failures become visible because the browser receives authenticated JSON responses
  instead of opaque `no-cors` responses.
- Deploy the functions and admin client together to avoid a temporary email/group
  management outage.

## Stage 3: authenticated AI services

### Change

Require Firebase ID tokens for member AI functions, validate active membership,
enable App Check, and add per-user and per-IP quotas.

### Member impact

- Signed-in members see no normal workflow change.
- An expired session asks the member to sign in again before AI feedback runs.
- The existing deterministic or sample fallback must remain so completion is never
  blocked when AI is unavailable.

### Admin impact

Admin preview must use a real Firebase admin session. Anonymous direct endpoint
tests will stop working; use an authenticated test script or Firebase emulator.

## Stage 4: server-authoritative progress and rewards

### Change

Move completion, MP calculations, levels, streaks, and certificate eligibility to
Firebase Functions. After clients use the new functions, restrict Firestore so a
member cannot edit these authoritative fields directly.

### Member impact

- Completion looks the same, but MP appears after server confirmation.
- Poor connectivity shows `Saved locally, waiting to sync` until confirmation.
- Existing progress must be reconciled before stricter rules are deployed.
- No legitimate MP or completion should be removed during migration.

### Admin impact

- Manual progress edits call an admin-only function and create an audit entry.
- Experience preview uses simulated data and never writes production rewards.
- A reconciliation report identifies older accounts whose ledgers and totals differ.

## Stage 5: genuinely private course delivery

Google Group membership controls access to Google Drive videos and slides, but it
does not protect publicly hosted HTML, JavaScript, exercise text, answer banks, or
source code. The public GitHub repository also exposes those files directly.

### Recommended architecture

1. Make the GitHub repository private.
2. Keep the public marketing pages on a public Cloudflare Pages project.
3. Publish member applications to a separate protected origin.
4. Put a Cloudflare Worker in front of member files.
5. Exchange the Firebase sign-in session for a short-lived, secure, HttpOnly member
   cookie that the Worker validates on every protected request.
6. Continue using Google Group restrictions for Drive assets as a second layer.
7. Prevent protected responses from being cached publicly.

### Member impact

- Members continue signing in with Google from the same Learning Journey page.
- The first migration may require one additional sign-in.
- Direct bookmarks redirect to sign-in and return to the requested activity.
- Expired sessions redirect to sign-in rather than displaying a blank or locked app.
- Videos still depend on the member using a Google account in the permitted group.

### Admin impact

- Admins manage course membership in Firestore. Google Group automation remains an optional future layer if managed Google Workspace becomes available.
- Deployments require both public and protected-site checks.
- Preview links require an authenticated admin session.
- Support needs a documented process for mismatched Firebase and Google Group
  accounts.

### Rollout gate

Pilot the protected origin with admin accounts and two test-member accounts before
changing production links. Keep the current public member origin available only
during a short rollback window, then remove it.

## Stage 6: public forms and enforced browser policy

### Change

Add Turnstile and server-side rate limits to public forms. Apply formula protection
to every deployed Apps Script sheet write. After reviewing CSP reports, replace the
report-only policy with an enforced policy at the actual Cloudflare serving layer.

### Member impact

Member exercises remain unchanged. Public lead forms may show a short bot check only
when Cloudflare considers a request suspicious.

### Admin impact

Admins gain clearer rejected/spam request reporting. New external scripts, frames,
or APIs must be added deliberately to the CSP allowlist before launch.

## Repository and deployment controls

Protect `main` with pull requests, one approval, passing security checks, resolved
conversations, blocked force pushes, and blocked deletion. Enable GitHub secret
scanning, push protection, Dependabot, and code scanning. These controls change the
developer release process but do not affect members or site administrators using
the product.
