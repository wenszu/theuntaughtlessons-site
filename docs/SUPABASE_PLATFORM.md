# The platform after the move to Supabase: the guide for every thread that works on this site

Last updated: 2026-10-09. Read this together with `WEBSITE_CONTEXT.md` before changing anything about data, sign in, email, payments, or any server function.

**Status line (update this first when it changes):** since 2026-10-09 the website runs on Supabase: data layer, server reads, admin saves, sign in, Executive Signature saves and mail. Only AI scoring and payments still use Firebase, because their keys (Gemini, Stripe) are not set yet. Firebase stays in place as the safety net for about two weeks (the quiet period), then is closed following `docs/SUPABASE_CUTOVER_RUNBOOK.md` section 10.

## 1. The three places data can live

| Place | What it is | Role |
| --- | --- | --- |
| **utl-core** (Supabase project `czljyikfavtjgqcibdda`, `https://czljyikfavtjgqcibdda.supabase.co`) | Postgres with row level security, 100+ database functions, Supabase Auth, six Edge Functions | The platform for the website (TSA, Executive Signature, admin console, organizations, certificates, email). The future primary store. |
| **UTL DOC Development** (Supabase project `geavcshbhryikljhgsmy`) | The DOC simulation app's own database and Edge Functions (repo `wenszu/utl-doc-simulation`, local clone `/Users/wenszu/dev/utl-doc-work`) | Separate on purpose. DOC only borrows identity (who the person is and what they may open). A Supabase sign in adapter for DOC is built on the branch `supabase-identity` and is not switched on. |
| **Firebase** (Google project `the-untaught-lessons`: Auth, Firestore, Cloud Functions) | The original system | Safety net. It still receives writes until the flip, and keeps a full copy afterwards. Do not delete the project (it also holds the Google sign in client used by Supabase, the Gemini key's project and the backup bucket). |

Pages are served by GitHub Pages from the `main` branch of `wenszu/theuntaughtlessons-site`. Cloudflare is only the CDN (browser cache TTL set to 20 minutes).

## 2. The switchboard (how the site decides Firebase or Supabase)

One public row in the table `public.app_settings` (key `switchboard`) holds eight flags. Every page reads it (`assets/switchboard.js`, cached 5 minutes) and copies each flag into a browser switch, except where the person set that browser switch by hand (a hand set value always wins, so a tester can opt out).

| Flag | Browser switch | What it moves |
| --- | --- | --- |
| `data_source` | `utl_data_source` | Member data layer reads and the bridge to Supabase |
| `server_reads` | `utl_server_reads` | Admin screens, member reads (standing, workspaces, organization access), settings reads |
| `server_writes` | `utl_server_writes` | Admin saves, member certificate button, staff tools |
| `auth` | `utl_auth` | Sign in (Supabase email link and Google) and the Supabase-only member mode |
| `mail` | `utl_mail` | Admin and result emails through Edge Functions |
| `es_submit` | `utl_es` | Executive Signature saves through the Edge Function |
| `payments` | `utl_payments` | Stripe checkout (needs the Stripe keys, not set yet) |
| `ai` | `utl_ai` | AI scoring through Supabase (needs the Gemini key, not set yet) |

Values are `firebase` or `supabase` (`server_reads` and `server_writes` also accept `shadow`). Flip with one statement in the Supabase SQL editor, undo with the same statement and `firebase`:

```sql
update public.app_settings set value = jsonb_set(value, '{server_reads}', '"supabase"') where key = 'switchboard';
```

Every change is logged (`audit_events`, action `switchboard.changed`). Details: `docs/SUPABASE_SWITCHBOARD.md`. The exact order and the checks for each flip: `docs/SUPABASE_CUTOVER_RUNBOOK.md`. A read only health check: `SUPABASE_SERVICE_ROLE_KEY=... node scripts/supabase-cutover-check.js --stage 4`.

## 3. Cutover status (keep this table current)

| Step | State on 2026-10-09 |
| --- | --- |
| Data copied and compared member by member (56 members) | Done. Only the test member (left out on purpose) and the owner record (extra Supabase test rows) differ. |
| Server mirror (Firestore changes copied to Supabase by the server) | On (Firebase secret `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_MIRROR=on`). |
| `data_source`, `server_reads` | Supabase, live. |
| Sign in setup (Supabase Auth, Resend sender, Google) | Done and tested with the test member and by the owner (phone and Google). 56 Supabase accounts exist and are linked. Sign up is OFF. |
| `server_writes`, `es_submit`, `mail`, `auth` | **Flipped to Supabase on 2026-10-09** (owner approved). Tested live as the test member with no manual switches: email link sign in, workspace, Executive Signature quick check saved in Supabase, result email delivered, zero Firebase requests. Undo: one statement setting these four flags back to `firebase` (see section 2). |
| `ai`, `payments` | Waiting for the Gemini and Stripe keys. Edge Functions `ai-score`, `stripe-checkout`, `stripe-webhook` are written, not deployed. |
| Certificates | Database trigger `credential_auto_issue` is ENABLED (2026-10-09). The Firebase trigger is idle because progress no longer lands in Firestore; remove it when closing Firebase. Three real members have all required exercises marked complete but never received a certificate in Firebase either: do NOT run `private.issue_missing_credentials()` without the owner's decision. |
| DOC identity | Adapter built on a branch, not switched on. Needs the flip first. |
| Closing Firebase | After the quiet period (about two weeks), see the runbook section 10. |

## 4. Rules for changing the database (migrations)

All schema lives in `supabase/migrations/` (file names `20261008002xxx_<name>.sql`). The numbers used so far, in order: 2300 switchboard, 2310 admin console reads, 2320 certificates and reports, 2330 Executive Signature saves, 2340 to 2344 the remaining server functions, 2350 question bank, 2360 more switchboard flags, 2370 to 2374 account and progress tools. The next free range is 2380. Write a rollback for every migration in `supabase/rollbacks/`.

The process (the "double check"), always, for the live database:
1. A builder writes the migration and a test (`supabase/<name>-test.mjs`, PGlite).
2. An independent read only reviewer checks it against the live schema (SELECT only).
3. Apply with the Supabase MCP `apply_migration`, one migration per call, exactly the reviewed text.
4. Verify structurally with SELECTs on `pg_proc` and `pg_class` (who may execute, search path, row level security), and run `scripts/supabase-cutover-check.js`.

Hard rules (each one was learned the hard way):
- Every function is `security definer` with `set search_path = ''`. Staff functions check `private.has_platform_role(array['platform_owner'])` as the first statement (raise 42501). Member functions find the person from the token (`private.current_person_id()`), never from an argument.
- The live default privileges grant `anon` and `authenticated` execute on every NEW public function. Always write explicit `revoke ... from public, anon, authenticated` and then the grant you want (`authenticated`, or `service_role` for server only functions).
- No dynamic SQL. No backslash characters and no `\u` escapes in migrations or Edge Function files (the deploy tool changes them): use `chr()`, `[0-9]`, `[.]`, `String.fromCharCode`.
- Tables: row level security on, grants revoked explicitly. Additive changes only (new tables, new nullable columns). On busy tables use `set local lock_timeout = '3s'`.
- Append only guards exist (`reward_ledger_append_only`, assessment attempts). Do not work around them in a migration; the owner runs any exception by hand.
- Add every browser callable function to the allowlist in `supabase/function-audit-test.mjs`.
- After any migration: `node scripts/supabase-rpc-signatures.js --write` and commit `supabase/rpc-signatures.json`. The tests fail if a browser call uses an unknown function or argument name.

## 5. Rules for the browser code

- Static pages, plain JavaScript modules, no framework. Central switch file: `assets/firebase.js` (the name is historical). Supabase adapters: `assets/supabase-*.js`. Firebase behaviour must stay byte for byte unchanged when all flags are `firebase` (`tests/fixtures/firebase-baseline.js` must not change).
- Every first party module import carries `?v=<version>`. Run `node scripts/sync-cache-versions.js --version=<current>` after adding an import; CI runs it with the commit sha and then `--check`. Assets are cached by browsers (20 minutes now), so mixed versions across modules break pages.
- In Supabase-only mode (`utl_auth` is `supabase`) no code may call Firebase: the Firestore and callable functions are wrapped to refuse and log "Blocked:". New member features must use Supabase functions.
- Test with `node tests/<file>.test.js` (all) and `npx -y node@20` for new browser tests (CI runs Node 20; supabase-js needs the WebSocket stub as in `tests/supabase-auth.test.js`). Fake database calls in tests are validated against the live signatures (`tests/helpers/rpc-contract.js`).
- Do not use the owner account (`wenszu@gmail.com`) in tests. The test member is `wenszu+utltest@gmail.com`, person id `a7e57000-0000-4000-8000-000000000001`; the import skips it (`--exclude-email`).

## 6. Edge Functions (Supabase)

Deployed to utl-core, all with `verify_jwt` off and their own checks: `send-email`, `weekly-org-reports`, `result-emails`, `readiness-submit`, `readiness-access`, `admin-mail`. Written, not deployed: `ai-score`, `stripe-checkout`, `stripe-webhook`, `auth-admin` (invite only; the emergency password was retired). They fail closed when their secrets are missing. Deploy through the Supabase MCP `deploy_edge_function` with the files copied exactly, then fetch them back and compare. Files in `supabase/functions/<name>/` (`core.mjs` pure logic, `index.ts` thin entry).

Secrets that exist: `MAIL_RELAY_SECRET` (Supabase and Firebase), Resend sender key, Firebase `SUPABASE_SERVICE_ROLE_KEY`. Secrets still to create: `CRON_SECRET` (weekly report schedule), `GEMINI_API_KEY`, Stripe keys.

## 7. Email

Mail goes through Resend from `hello@theuntaughtlessons.com` (domain verified; SPF, DKIM and DMARC pass). Admin and result emails: Edge Function `send-email` (called by `admin-mail` and `result-emails`). Sign in emails: Supabase Auth with custom SMTP through Resend (Magic Link template in the site voice, link goes straight to `/member-login/?token_hash=...&type=email`). The old Apps Script relay is retired. Resend free plan: 100 emails a day.

## 8. Sign in

Supabase Auth: email link and Google only (Microsoft and Facebook are off; no member used them). Sign up is OFF; accounts are made by `scripts/supabase-provision-auth.js` (typed APPLY) and by the `auth-admin` invite route. A person is tied to an account by `people.supabase_uid` (`public.link_my_identity()` from the verified email). Access answers come from `public.get_my_access()`. Details: `docs/SUPABASE_PLAN_SIGNIN.md`, `docs/SUPABASE_SIGNIN_OWNER_STEPS.md`.

## 9. Files and secrets on the owner's Mac (outside the repository)

`~/utl-backups/` holds: `.supabase-key` (secret key named "migration"), `.supabase-token` (access token), `.resend-key`, `.google-client-id`, `.google-client-secret`, Firestore snapshots (`firestore-snapshot-*.json`), the owner's reward backups, and the previous Supabase auth settings. **Delete the keys and tokens in the dashboards and these files when the move is finished** (list in the runbook section 10). Never print or paste a secret in chat.

## 10. Working agreements with the owner

- The assistant may apply reviewed migrations, deploy reviewed Edge Functions and Firebase functions, and push to `main` when the owner has authorised that work (given on 2026-10-09 for this migration). Changing the combined switches (`server_writes`, `es_submit`, `mail`, `auth`) needs the owner's explicit go, because every member signs in again.
- Always keep the one line undo ready and run the health check after every flip.
- Writing voice for anything members read: no dashes in prose, no contractions that sound unnatural, no idioms (see `context/voice-editor.md`).
- Decisions on record: the emergency password feature is retired; buying the full Executive Signature report requires signing in first; the reward ledger stays append only (a reset adds a balancing entry); Microsoft and Facebook sign in are off.

## 11. Where to read more

`docs/SUPABASE_BUILD_HANDOFF.md` (the full dated log), `docs/SUPABASE_CUTOVER_RUNBOOK.md`, `docs/SUPABASE_SWITCHBOARD.md`, `docs/SUPABASE_CALLABLE_GAP.md` (every Firebase function and what replaced it), `docs/SUPABASE_REMAINING_FIRESTORE_READS.md`, `docs/SUPABASE_RPC_CALL_AUDIT.md`, `docs/SUPABASE_BROWSER_WIRING.md`, `docs/SUPABASE_REPORTS_SETUP.md`, `docs/SUPABASE_READINESS_SUBMIT_SETUP.md`, `docs/SUPABASE_PROVISION_AUTH.md`, `docs/SUPABASE_QUESTION_BANK.md`, `docs/SUPABASE_MIRROR_SWITCH_ON.md`.
