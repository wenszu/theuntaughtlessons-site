// Tests for migration 2320: certificates (issue_my_credential, the automatic issue and its trigger), the weekly organization
// report numbers, and the limits of the two result emails. Only test people and test organizations are used.
//   node supabase/credentials-reports-test.mjs
import fs from 'fs';
import { createRequire } from 'module';
import { boot } from './schema-apply-harness.mjs';

const require = createRequire(import.meta.url);
const mirror = require('../functions-admin/supabase-mirror/credentials.js');

const { db, failed } = await boot();
if (failed) { console.log('\nmigrations did not apply, stopping'); process.exit(1); }
let pass = 0, fail = 0;
const ok = (n, c, detail = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, !c && detail ? `[${detail}]` : ''); };
const count = async (sql) => (await db.query(`select count(*)::int n from ${sql}`)).rows[0].n;
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const as = async (role, sql, claims) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${claims ? JSON.stringify(claims).replace(/'/g, "''") : ''}', false);`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
};
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
const same2 = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
const fails = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const FB = 'https://securetoken.google.com/test-project';
const claimsFor = (uid, extra) => Object.assign({ sub: uid, iss: FB, role: 'authenticated', email_verified: true }, extra || {});

// ---- the file itself, the objects, who can execute what ----
const sqlText = fs.readFileSync(new URL('./migrations/20261008002320_credentials_reports.sql', import.meta.url), 'utf8');
const downText = fs.readFileSync(new URL('./rollbacks/20261008002320_credentials_reports_down.sql', import.meta.url), 'utf8');
ok('the migration and its rollback have no backslash (so no unicode escape either)', !sqlText.includes('\\') && !downText.includes('\\'));
ok('both files set a 3 second lock timeout first', /set local lock_timeout = '3s';/.test(sqlText) && /set local lock_timeout = '3s';/.test(downText));
ok('the migration is written to be applied twice (if not exists, create or replace, guarded trigger)', /create table if not exists public\.email_limits/.test(sqlText) && !/create trigger credential_auto_issue/.test(sqlText.split('do $do$')[0]));
ok('the migration stays inside its number range (no cron job, no other table)', !/cron\./i.test(sqlText) && (sqlText.match(/create table /g) || []).length === 1);

const fns = (await db.query(`select p.proname, n.nspname, p.prosecdef, array_to_string(p.proconfig, ',') as config, p.prosrc,
    has_function_privilege('anon', p.oid, 'execute') as anon_exec,
    has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
    has_function_privilege('service_role', p.oid, 'execute') as service_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.proname in ('issue_my_credential','issue_credential_core','issue_credential_if_eligible','credential_auto_issue_trigger','credential_shadow_report',
    'issue_missing_credentials','cert_settings','cert_required_activities','weekly_org_report','weekly_org_aggregate','weekly_org_reports_due','weekly_report_record',
    'report_progress_activities','readiness_email_begin','readiness_email_release','results_email_take','results_email_release','result_email_confirmed')`)).rows;
ok('all 25 functions exist (17 private, 8 public: the member entry point and the service role wrappers)', fns.length === 25 && fns.filter((f) => f.nspname === 'public').length === 8, String(fns.length));
ok('every new function is security definer or a pure constant, with an empty search_path, no dynamic sql, no backslash',
  fns.every((f) => /search_path=("")?(,|$)/.test(f.config || '') && !/^\s*execute\b/im.test(f.prosrc) && !f.prosrc.includes('\\') && (f.prosecdef || /constant|activities/.test(f.proname))));
const pub = fns.filter((f) => f.nspname === 'public');
const mine = pub.find((f) => f.proname === 'issue_my_credential');
ok('issue_my_credential: authenticated can execute, anon cannot', mine && mine.auth_exec && !mine.anon_exec);
ok('the only function a browser can execute is issue_my_credential', fns.filter((f) => f.anon_exec || f.auth_exec).map((f) => f.proname).join() === 'issue_my_credential');
ok('every other public function is for the service role only', pub.filter((f) => f.proname !== 'issue_my_credential').every((f) => f.service_exec && !f.anon_exec && !f.auth_exec));
ok('the private functions are closed to browsers', fns.filter((f) => f.nspname === 'private').every((f) => !f.anon_exec && !f.auth_exec));
const tbl = await one(`select c.relrowsecurity, has_table_privilege('authenticated', 'public.email_limits', 'select') as sel, has_table_privilege('anon', 'public.email_limits', 'insert') as ins
  from pg_class c where c.oid = 'public.email_limits'::regclass`);
ok('email_limits: row level security on, no browser can read or write it', tbl.relrowsecurity && !tbl.sel && !tbl.ins);
const trg = await one(`select tgenabled from pg_trigger where tgname = 'credential_auto_issue' and tgrelid = 'public.activity_progress'::regclass`);
ok('the automatic issue trigger exists and is switched OFF', trg && trg.tgenabled === 'D');

// ---- fixtures ----
const REQUIRED = ['p1-e1', 'p1-e2', 'p1-e3', 'p1-e4', 'p1-e5', 'p1-e6', 'p2-e1', 'p2-e2', 'p2-e3', 'p2-e4', 'p2-e5', 'p2-e6', 'p3-e1', 'p3-e2', 'p3-e3', 'p3-e4'];
const LESSONS = ['p1-l1', 'p1-l2', 'p1-l3', 'p1-l4', 'p1-l5', 'p2-l1', 'p2-l3', 'p3-l1', 'p3-l2', 'p3-l3', 'p3-l4', 'p3-l5'];
const PROGRESS = ['orientation', ...LESSONS, ...REQUIRED];
for (const id of [...PROGRESS, 'p1-e1-context']) await db.query(`insert into activities (id, program_id, kind, title) values ($1, 'tsa', 'exercise', $1)`, [id]);
const pid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const mkPerson = async (n, name, status = 'active') => {
  await db.query(`insert into people (id, auth_uid, primary_email, display_name, account_status) values ($1, $2, $3, $4, $5)`, [pid(n), `fb_p${n}`, `p${n}@example.test`, name, status]);
  return pid(n);
};
const mkEnroll = async (person, status = 'active', cohort = null) => (await one(`insert into enrollments (person_id, program_id, status, cohort_id) values ($1, 'tsa', $2, $3) returning id`, [person, status, cohort])).id;
const complete = async (person, ids, at = '2026-09-01T10:00:00Z') => {
  for (const id of ids) {
    await db.query(`insert into activity_progress (person_id, activity_id, program_id, status, completed_at, first_visited_at) values ($1, $2, 'tsa', 'completed', $3, $3)
      on conflict (person_id, activity_id) do update set status = 'completed', completed_at = excluded.completed_at`, [person, id, at]);
  }
};
const issueAs = (uid, extra) => as('authenticated', `select public.issue_my_credential() as r`, claimsFor(uid, extra));

// ---- issue_my_credential: refusals, in the Firebase order ----
const alice = await mkPerson(1, 'Alice Test');
const aliceEnroll = await mkEnroll(alice);
await complete(alice, REQUIRED.slice(0, 15));
let e = await fails(() => as('anon', `select public.issue_my_credential()`));
ok('a signed out caller cannot execute it at all', !!e && /permission denied/.test(e.message));
e = await fails(() => as('authenticated', `select public.issue_my_credential()`, { role: 'authenticated' }));
ok('a token with no known person is refused (42501)', !!e && e.code === '42501');
e = await fails(() => as('authenticated', `select public.issue_my_credential()`, { sub: 'fb_p1', iss: FB, role: 'authenticated' }));
ok('a token whose email is not verified is refused (42501)', !!e && e.code === '42501');
e = await fails(() => as('authenticated', `select public.issue_my_credential()`, { sub: 'fb_p1', iss: FB, role: 'authenticated', user_metadata: { email_verified: true } }));
ok('a Firebase token that only claims email_verified inside user_metadata is refused (42501)', !!e && e.code === '42501', e && e.message);
e = await fails(() => issueAs('fb_p1'));
ok('15 of 16 exercises: failed-precondition (55000) with the Firebase message', !!e && e.code === '55000' && e.message === 'Complete all program exercises before requesting a certificate.', e && e.message);
ok('nothing was written by the refusal', (await count('credentials')) === 0 && (await count('audit_events')) === 0);

const bob = await mkPerson(2, 'Bob Nomember');
await complete(bob, REQUIRED);
e = await fails(() => issueAs('fb_p2'));
ok('all 16 but no enrollment: permission-denied (42501) with the Firebase message', !!e && e.code === '42501' && e.message === 'This account does not have active member access.', e && e.message);
const carol = await mkPerson(3, 'Carol Revoked');
await mkEnroll(carol, 'revoked');
await complete(carol, REQUIRED);
e = await fails(() => issueAs('fb_p3'));
ok('a revoked enrollment is not active membership', !!e && e.code === '42501');
const dan = await mkPerson(4, 'Dan Archived', 'archived');
await mkEnroll(dan);
await complete(dan, REQUIRED);
e = await fails(() => issueAs('fb_p4'));
ok('an archived account is refused (it resolves to no person)', !!e && e.code === '42501');

// certificates switched off in the engagement setting
await db.exec(`update app_settings set value = '{"certificate":{"enabled":false}}'::jsonb where key = 'engagement'`);
await complete(alice, ['p3-e4']);
e = await fails(() => issueAs('fb_p1'));
ok('certificates switched off: failed-precondition (55000) with the Firebase message, checked first', !!e && e.code === '55000' && e.message === 'Certificates are not currently available.', e && e.message);
await db.exec(`update app_settings set value = '{"certificate":{"enabled":true,"credentialTitle":"Custom title","signatoryName":"A Signer","signatoryTitle":"Chief"}}'::jsonb where key = 'engagement'`);

// ---- the happy path and the row ----
let r = (await issueAs('fb_p1', { name: 'Token Name' }))[0].r;
const code = r.credential && r.credential.credentialId;
ok('issued: ok, issued, created, a UTL-TSA id of 12 characters from the Firebase alphabet', r.ok === true && r.issued === true && r.created === true && /^UTL-TSA-[0-9A-HJKMNP-TV-Z]{12}$/.test(code), JSON.stringify(r));
const row = await one(`select * from credentials where credential_code = $1`, [code]);
ok('the row is for the right person, program, version, enrollment and status', row.person_id === alice && row.program_id === 'tsa' && row.program_version === 'tsa-2026-v1' && row.enrollment_id === aliceEnroll && row.status === 'issued');
ok('the title and signatory come from the engagement setting', row.title === 'Custom title' && row.signatory_name === 'A Signer' && row.signatory_title === 'Chief' && row.issuer === 'The Untaught Lessons');
ok('the recipient name is the person display name (the member name wins over the token name)', row.recipient_name === 'Alice Test');
ok('required exercises are the 16 canonical ids in order', JSON.stringify(row.required_activity_ids) === JSON.stringify(REQUIRED));
ok('the issue date is the latest completion of the 16', new Date(row.issued_at).toISOString() === '2026-09-01T10:00:00.000Z');
ok('the legacy links have the Firebase shape', row.legacy_firestore_id === `public_credentials/${code}` && row.legacy_issuance_id === 'credential_issuance/fb_p1_tsa-2026-v1');
ok('the id is the importer uuid of the code', row.id === mirror.credentialRowId(code));
ok('the answer has the Firebase public document shape', r.credential.recipientName === 'Alice Test' && r.credential.status === 'active' && r.credential.programId === 'think-speak-act-executive' && r.credential.credentialCode === 'TSA'
  && r.credential.verificationUrl === `https://theuntaughtlessons.com/verify/?id=${code}` && r.credential.issuedAt === '2026-09-01T10:00:00.000Z' && r.credential.programVersion === 'tsa-2026-v1');
const audit = (await db.query(`select * from audit_events where action = 'credential_issued'`)).rows;
ok('one audit row, ids and fixed words only (no name, no email)', audit.length === 1 && audit[0].subject_id === row.id && audit[0].detail.source === 'self' && !/Alice|example\.test|Token/i.test(JSON.stringify(audit[0])));

// the same row the mirror writes for the same Firestore documents
const built = mirror.rowsForCredential(
  { id: code, data: { credentialId: code, recipientName: 'Alice Test', credentialTitle: 'Custom title', issuer: 'The Untaught Lessons', issuedAt: '2026-09-01T10:00:00.000Z', status: 'active',
    programId: 'think-speak-act-executive', credentialCode: 'TSA', programVersion: 'tsa-2026-v1', signatoryName: 'A Signer', signatoryTitle: 'Chief' } },
  { issuance: { id: 'fb_p1_tsa-2026-v1', data: { userId: 'fb_p1', email: 'p1@example.test', credentialId: code, programId: 'think-speak-act-executive', credentialCode: 'TSA', programVersion: 'tsa-2026-v1',
    completionVerifiedAt: '2026-10-08T00:00:00.000Z', issuedAt: '2026-09-01T10:00:00.000Z', status: 'active', requiredExercises: REQUIRED, createdAt: '2026-10-08T00:00:00.000Z' } },
    personId: alice, enrollmentId: aliceEnroll, now: '2026-10-08T00:00:00.000Z' }).credentials[0];
const skip = new Set(['completion_verified_at', 'created_at', 'updated_at', 'migration_run_id', 'revoked_at']);
const same = Object.keys(built).filter((k) => !skip.has(k)).every((k) => JSON.stringify(row[k] instanceof Date ? row[k].toISOString() : row[k]) === JSON.stringify(k === 'issued_at' ? new Date(built[k]).toISOString() : built[k]));
ok('every column equals what the mirror (rowsForCredential) builds for the same documents', same,
  Object.keys(built).filter((k) => !skip.has(k) && JSON.stringify(row[k] instanceof Date ? row[k].toISOString() : row[k]) !== JSON.stringify(k === 'issued_at' ? new Date(built[k]).toISOString() : built[k])).join());
ok('completion_verified_at is set and revoked_at is empty', row.completion_verified_at !== null && row.revoked_at === null);

// ---- idempotency, revoked, replaced ----
r = (await issueAs('fb_p1'))[0].r;
ok('a second call returns the same certificate and creates nothing', r.created === false && r.credential.credentialId === code && (await count('credentials')) === 1 && (await count(`audit_events where action = 'credential_issued'`)) === 1);
await db.exec(`update credentials set status = 'revoked', revoked_at = now() where credential_code = '${code}'`);
r = (await issueAs('fb_p1'))[0].r;
ok('a revoked certificate is returned as it is (status revoked) and is not replaced', r.credential.credentialId === code && r.credential.status === 'revoked' && (await count('credentials')) === 1);
await db.exec(`update credentials set status = 'issued', revoked_at = null where credential_code = '${code}'`);
// the staff reissue moves the issuance link to a new row and supersedes the old one
await db.exec(`insert into credentials (id, credential_code, person_id, program_id, title, recipient_name, program_version, status, legacy_firestore_id, legacy_issuance_id)
  values (gen_random_uuid(), 'UTL-TSA-REPLACEMENT1', '${alice}', 'tsa', 'Custom title', 'Alice Test', 'tsa-2026-v1', 'issued', 'public_credentials/UTL-TSA-REPLACEMENT1', null)`);
await db.exec(`update credentials set status = 'superseded', legacy_issuance_id = null where credential_code = '${code}'`);
r = (await issueAs('fb_p1'))[0].r;
ok('after a reissue the current (replacement) certificate is the one returned, nothing new is made', r.credential.credentialId === 'UTL-TSA-REPLACEMENT1' && r.created === false && (await count('credentials')) === 2);
await db.exec(`delete from credentials where credential_code = 'UTL-TSA-REPLACEMENT1'`);
await db.exec(`update credentials set status = 'issued' where credential_code = '${code}'`);

// recipient name fallbacks
const eve = await mkPerson(5, '');
await db.exec(`update people set first_name = 'Eve', last_name = 'Lastname' where id = '${eve}'`);
await mkEnroll(eve, 'invited');
await complete(eve, REQUIRED, '2026-09-05T08:00:00Z');
r = (await issueAs('fb_p5'))[0].r;
ok('without a display name: first and last name; an invited enrollment counts as a member', r.credential.recipientName === 'Eve Lastname');
const finn = await mkPerson(6, '');
await mkEnroll(finn, 'completed');
await complete(finn, REQUIRED);
r = (await issueAs('fb_p6', { name: 'Finn From Token' }))[0].r;
ok('without any stored name: the token name; a completed enrollment counts', r.credential.recipientName === 'Finn From Token');
const gil = await mkPerson(7, '');
await mkEnroll(gil);
await complete(gil, REQUIRED);
r = (await issueAs('fb_p7'))[0].r;
ok('without any name at all: the part of the email before the @', r.credential.recipientName === 'p7');
// a default title when the setting has none
await db.exec(`update app_settings set value = '{}'::jsonb where key = 'engagement'`);
const hal = await mkPerson(8, 'Hal Default');
await mkEnroll(hal);
await complete(hal, REQUIRED);
r = (await issueAs('fb_p8'))[0].r;
ok('with no certificate setting: certificates are on and the default title and signatory apply', r.issued === true
  && r.credential.credentialTitle === 'Think, speak and act like an executive' + String.fromCharCode(8482) + '.' && r.credential.signatoryName === 'Wen-Szu Lin' && r.credential.signatoryTitle === 'Founder, The Untaught Lessons');

// ---- a Supabase Auth token: the account record decides, never user_metadata ----
await db.exec(`create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz)`);
const SU = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SB = 'https://example-project.supabase.co/auth/v1';
const sam = await mkPerson(20, 'Sam Supabase');
await db.exec(`update people set supabase_uid = '${SU(20)}' where id = '${sam}'`);
await mkEnroll(sam);
await complete(sam, REQUIRED);
const sbClaims = (extra) => Object.assign({ sub: SU(20), iss: SB, role: 'authenticated', email: 'p20@example.test' }, extra || {});
const sbIssue = (extra) => as('authenticated', `select public.issue_my_credential() as r`, sbClaims(extra));
e = await fails(() => sbIssue({ user_metadata: { email_verified: true } }));
ok('Supabase token, no auth.users row: user_metadata.email_verified does not count (42501)', !!e && e.code === '42501', e && e.message);
await db.exec(`insert into auth.users (id, email, email_confirmed_at) values ('${SU(20)}', 'p20@example.test', null)`);
e = await fails(() => sbIssue({ user_metadata: { email_verified: true }, email_verified: true }));
ok('Supabase token, account not confirmed: neither user_metadata nor a top level claim counts (42501)', !!e && e.code === '42501');
await db.exec(`update auth.users set email_confirmed_at = now(), email = 'other.address@example.test' where id = '${SU(20)}'`);
e = await fails(() => sbIssue());
ok('Supabase token, confirmed address is not the primary address: refused (42501)', !!e && e.code === '42501');
ok('result_email_confirmed is false for that account', (await one(`select private.result_email_confirmed('${sam}') as r`)).r === false);
await db.exec(`update auth.users set email = 'P20@Example.test' where id = '${SU(20)}'`);
ok('result_email_confirmed is true once the confirmed address is the primary address (any case)', (await one(`select private.result_email_confirmed('${sam}') as r`)).r === true);
const confirmedOthers = await one(`select private.result_email_confirmed('${alice}') as a, private.result_email_confirmed('${pid(9999)}') as b, private.result_email_confirmed(null) as c`);
ok('and false for a person with no Supabase account, an unknown person and null', confirmedOthers.a === false && confirmedOthers.b === false && confirmedOthers.c === false);
r = (await sbIssue())[0].r;
ok('Supabase token, confirmed in auth.users: the certificate is issued', r.issued === true && r.created === true && r.credential.recipientName === 'Sam Supabase');
e = await fails(() => as('authenticated', `select public.result_email_confirmed('${sam}')`, sbClaims()));
ok('a browser cannot call result_email_confirmed', !!e && /permission denied/.test(e.message));
ok('the service role can', (await as('service_role', `select public.result_email_confirmed('${sam}') as r`))[0].r === true);

// ---- the recipient name skips a display name that is an address ----
const nia = await mkPerson(21, 'nia.name@example.test');
await db.exec(`update people set first_name = 'Nia', last_name = 'Name' where id = '${nia}'`);
await mkEnroll(nia);
await complete(nia, REQUIRED);
r = (await issueAs('fb_p21'))[0].r;
ok('a display name that holds an @ is skipped: first and last name are used', r.credential.recipientName === 'Nia Name', r.credential.recipientName);
const omar = await mkPerson(22, 'omar@example.test');
await mkEnroll(omar);
await complete(omar, REQUIRED);
r = (await issueAs('fb_p22', { name: 'Omar Token' }))[0].r;
ok('and with no first and last name the token name is used, never the address', r.credential.recipientName === 'Omar Token');
const pat = await mkPerson(23, 'pat@example.test');
await mkEnroll(pat);
await complete(pat, REQUIRED);
r = (await issueAs('fb_p23'))[0].r;
ok('and with nothing else the part before the @ is used', r.credential.recipientName === 'p23');

// ---- the automatic path ----
const before = await count('credentials');
const ivy = await mkPerson(9, 'Ivy Auto');
await mkEnroll(ivy);
await complete(ivy, REQUIRED);
ok('the trigger is off: finishing all 16 makes no certificate by itself', (await count('credentials')) === before);
const rep1 = (await db.query(`select * from private.credential_shadow_report() order by person_id`)).rows;
ok('the shadow report lists exactly the members who would get one (Ivy), not the refused ones', rep1.length === 1 && rep1[0].person_id === ivy && rep1[0].finding === 'missing', JSON.stringify(rep1));
ok('issue_credential_if_eligible issues for an eligible person and answers created', (await one(`select private.issue_credential_if_eligible('${ivy}') as r`)).r.created === true);
ok('and the shadow report is empty afterwards', (await count('private.credential_shadow_report()')) === 0);
const noone = (await one(`select private.issue_credential_if_eligible('${carol}') as r`)).r;
ok('an ineligible person gets issued:false with a reason, never an error', noone.issued === false && noone.reason === 'permission-denied');
const unknown = (await one(`select private.issue_credential_if_eligible('${pid(999)}') as r`)).r;
ok('an unknown person gets issued:false, never an error', unknown.issued === false);
ok('a null person is swallowed too (never raises)', (await one(`select private.issue_credential_if_eligible(null) as r`)).r.issued === false);

// catch-up
const jon = await mkPerson(10, 'Jon Catchup');
await mkEnroll(jon);
await complete(jon, REQUIRED);
const made = (await one(`select private.issue_missing_credentials() as n`)).n;
ok('the catch-up issues what is missing and counts it', made === 1 && (await count(`credentials where person_id = '${jon}'`)) === 1);
ok('running the catch-up again issues nothing', (await one(`select private.issue_missing_credentials() as n`)).n === 0);
// a certificate without the exercises is reported as unexpected
await db.exec(`delete from activity_progress where person_id = '${jon}' and activity_id = 'p1-e1'`);
const rep2 = (await db.query(`select * from private.credential_shadow_report()`)).rows;
ok('a certificate held without all 16 exercises is reported as unexpected', rep2.some((x) => x.person_id === jon && x.finding === 'unexpected'));
await complete(jon, ['p1-e1']);

// switch the trigger on
await db.exec(`alter table public.activity_progress enable trigger credential_auto_issue`);
const kim = await mkPerson(11, 'Kim Trigger');
await mkEnroll(kim);
await complete(kim, REQUIRED.slice(0, 15));
ok('trigger on: 15 exercises make no certificate', (await count(`credentials where person_id = '${kim}'`)) === 0);
await complete(kim, ['p1-e1-context']);
ok('a non-required activity does nothing', (await count(`credentials where person_id = '${kim}'`)) === 0);
await complete(kim, [REQUIRED[15]], '2026-09-20T09:00:00Z');
const kimRow = await one(`select * from credentials where person_id = '${kim}'`);
ok('the 16th completion issues exactly one certificate, dated at the latest completion', !!kimRow && new Date(kimRow.issued_at).toISOString() === '2026-09-20T09:00:00.000Z' && (await count(`credentials where person_id = '${kim}'`)) === 1);
ok('the automatic audit row names the source auto and has no actor', (await one(`select detail, actor_person_id from audit_events where subject_id = '${kimRow.id}'`)).detail.source === 'auto');
await complete(kim, [REQUIRED[15]], '2026-09-21T09:00:00Z');
await db.exec(`update activity_progress set completion_count = completion_count + 1 where person_id = '${kim}'`);
ok('saving the same completed row again changes nothing (idempotent)', (await count(`credentials where person_id = '${kim}'`)) === 1 && (await count(`audit_events where action = 'credential_issued' and person_id = '${kim}'`)) === 1);
// a person who cannot get one: the learner write still succeeds
const lou = await mkPerson(12, 'Lou Nomember');
const beforeAudit = await count('audit_events');
await complete(lou, REQUIRED);
ok('a learner with no enrollment completes 16 exercises: the writes succeed, no certificate, no error', (await count(`activity_progress where person_id = '${lou}' and status = 'completed'`)) === 16 && (await count(`credentials where person_id = '${lou}'`)) === 0 && (await count('audit_events')) === beforeAudit);
// a failure inside the issue never reaches the learner write
const original = (await one(`select pg_get_functiondef('private.aw_new_credential_code()'::regprocedure) as d`)).d;
await db.exec(`create or replace function private.aw_new_credential_code() returns text language plpgsql as $f$ begin raise exception 'boom for a test'; end $f$`);
const mia = await mkPerson(13, 'Mia Boom');
await mkEnroll(mia);
const notices = [];
const writeError = await fails(async () => { await db.query(`insert into activity_progress (person_id, activity_id, program_id, status, completed_at) select '${mia}', x, 'tsa', 'completed', now() from unnest($1::text[]) x`, [REQUIRED], { onNotice: (n) => notices.push(n) }); });
ok('the trigger swallows a failure of the issue: the learner write succeeds', writeError === null && (await count(`activity_progress where person_id = '${mia}' and status = 'completed'`)) === 16, writeError && writeError.message);
ok('and no certificate was made', (await count(`credentials where person_id = '${mia}'`)) === 0);
ok('the only warning carries the SQL state, nothing personal', notices.every((n) => !/Mia|p13@|boom/.test(JSON.stringify(n))), JSON.stringify(notices).slice(0, 200));
await db.exec(original);
ok('(restored) a later catch-up issues for the person the failure missed', (await one(`select private.issue_missing_credentials() as n`)).n >= 1 && (await count(`credentials where person_id = '${mia}'`)) === 1);
// the trigger is not a path for a browser: a learner cannot call the private functions
e = await fails(() => as('authenticated', `select private.issue_credential_if_eligible('${mia}')`, claimsFor('fb_p13')));
ok('a signed in learner cannot call the private issue function directly', !!e && /permission denied/.test(e.message));
await db.exec(`alter table public.activity_progress disable trigger credential_auto_issue`);
ok('the trigger can be switched off again', (await one(`select tgenabled from pg_trigger where tgname = 'credential_auto_issue'`)).tgenabled === 'D');

// ---- weekly organization report ----
// Independent calculation, the way the Firebase code does it: per learner round(done / 29 * 100), aggregate over the learners.
const org1 = (await one(`insert into organizations (slug, name, contact_name, contact_email, weekly_report_opt_in) values ('acme-co', 'Acme Co', 'Pat Contact', 'Contact@Acme.Example.test', true) returning id`)).id;
const org2 = (await one(`insert into organizations (slug, name, contact_email, weekly_report_opt_in) values ('beta-inc', 'Beta Inc', 'beta@example.test', true) returning id`)).id;
const org3 = (await one(`insert into organizations (slug, name, contact_email, weekly_report_opt_in) values ('opted-out', 'Opted Out', 'out@example.test', false) returning id`)).id;
const org4 = (await one(`insert into organizations (slug, name, contact_email, weekly_report_opt_in, status) values ('archived-co', 'Archived Co', 'arch@example.test', true, 'archived') returning id`)).id;
const org5 = (await one(`insert into organizations (slug, name, weekly_report_opt_in) values ('no-contact', 'No Contact', true) returning id`)).id;
const cohortA = (await one(`insert into cohorts (program_id, organization_id, name) values ('tsa', '${org1}', 'Cohort A') returning id`)).id;
const cohortB = (await one(`insert into cohorts (program_id, organization_id, name) values ('tsa', '${org1}', 'Cohort B') returning id`)).id;
const cohortC = (await one(`insert into cohorts (program_id, organization_id, name) values ('tsa', '${org2}', 'Solo') returning id`)).id;
const plan = [];  // { cohort, done, status, owner }
let n = 100;
const addLearner = async (cohort, done, status = 'active', owner = false) => {
  n += 1;
  const p = await mkPerson(n, `Learner ${n}`);
  await mkEnroll(p, status, cohort);
  const ids = PROGRESS.slice(0, done);
  if (ids.length) await complete(p, ids);
  if (owner) await db.exec(`insert into role_grants (person_id, scope_type, role) values ('${p}', 'platform', 'platform_owner')`);
  plan.push({ cohort, done, status, owner });
};
for (const done of [0, 5, 29, 29, 14, 15, 1]) await addLearner(cohortA, done);
for (const done of [29, 10, 0]) await addLearner(cohortB, done);
await addLearner(cohortA, 20, 'revoked');           // not counted: access ended
await addLearner(cohortB, 29, 'expired');           // not counted
await addLearner(cohortA, 29, 'active', true);      // an owner: not counted
await addLearner(cohortA, 16, 'completed');         // counted
await addLearner(cohortC, 29);
await addLearner(cohortC, 0);
const expected = (cohort) => {
  const list = plan.filter((x) => (cohort === null ? [cohortA, cohortB].includes(x.cohort) : x.cohort === cohort) && ['invited', 'active', 'completed'].includes(x.status) && !x.owner);
  const percents = list.map((x) => Math.round(x.done / 29 * 100));
  return {
    enrolledLearners: list.length,
    learnersStarted: list.filter((x) => x.done > 0).length,
    programCompleters: percents.filter((p) => p === 100).length,
    averageCompletionPercent: list.length ? Math.round(percents.reduce((s, p) => s + p, 0) / list.length) : 0
  };
};
const rep = (await one(`select private.weekly_org_report('${org1}') as r`)).r;
ok('the organization numbers equal an independent calculation of the Firebase rules', same2(rep.aggregate, expected(null)), JSON.stringify(rep.aggregate) + ' vs ' + JSON.stringify(expected(null)));
ok('each cohort line equals the independent calculation', rep.cohorts.length === 2 && rep.cohorts[0].cohortId === 'Cohort A' && rep.cohorts[1].cohortId === 'Cohort B'
  && same2(rep.cohorts[0].aggregate, expected(cohortA)) && same2(rep.cohorts[1].aggregate, expected(cohortB)), JSON.stringify(rep.cohorts));
ok('revoked, expired and platform owner learners are left out; completed ones count', rep.aggregate.enrolledLearners === 11 && rep.aggregate.programCompleters === 3);
ok('the report carries the name, the lower case contact and the cohort names, and no learner name or email', rep.name === 'Acme Co' && rep.contactEmail === 'contact@acme.example.test' && rep.cohortNames.join() === 'Cohort A,Cohort B' && !/Learner [0-9]|p1[0-9][0-9]@/i.test(JSON.stringify(rep)));
const rep2o = (await one(`select private.weekly_org_report('${org2}') as r`)).r;
ok('a one cohort organization has one cohort line (the email prints By cohort only above one)', rep2o.cohorts.length === 1 && same2(rep2o.aggregate, expected(cohortC)));
ok('an unknown organization gives null', (await one(`select private.weekly_org_report('${pid(5555)}') as r`)).r === null);
const orgEmpty = (await one(`select private.weekly_org_report('${org3}') as r`)).r;
ok('an organization with no cohort reports zeros and no cohort lines', same2(orgEmpty.aggregate, { enrolledLearners: 0, learnersStarted: 0, programCompleters: 0, averageCompletionPercent: 0 }) && orgEmpty.cohorts.length === 0);
ok('NO minimum group size is applied (a group of 2 is reported, as in Firebase)', rep2o.aggregate.enrolledLearners === 2);

const WEEK = '2026-W41';
let due = (await one(`select private.weekly_org_reports_due('${WEEK}') as r`)).r;
ok('due: only active opted in organizations with a contact email, in slug order', due.reports.map((x) => x.slug).join() === 'acme-co,beta-inc' && due.skippedNoContact === 1, JSON.stringify(due.reports.map((x) => x.slug)));
e = await fails(() => db.query(`select private.weekly_org_reports_due('2026-41')`));
ok('a malformed week is refused', !!e && e.code === '22023');
let rec = (await one(`select public.weekly_report_record('${org1}', '${WEEK}', 'failed', 'provider', 'Contact@Acme.Example.test', array['Cohort A','Cohort B']) as r`)).r;
ok('a failed row is recorded', rec.recorded === true && (await one(`select status, error, recipient_email::text as r, cohort_names, legacy_firestore_id from organization_weekly_report_log where organization_id = '${org1}'`)).status === 'failed');
due = (await one(`select private.weekly_org_reports_due('${WEEK}') as r`)).r;
ok('a failed week is not blocked: the organization is due again', due.reports.some((x) => x.slug === 'acme-co'));
rec = (await one(`select public.weekly_report_record('${org1}', '${WEEK}', 'sent', null, 'Contact@Acme.Example.test', array['Cohort A','Cohort B']) as r`)).r;
const logRow = await one(`select * from organization_weekly_report_log where organization_id = '${org1}' and week_id = '${WEEK}'`);
ok('the same week can then be recorded as sent (one row per organization per week)', rec.recorded === true && logRow.status === 'sent' && logRow.error === null && (await count(`organization_weekly_report_log where organization_id = '${org1}'`)) === 1);
ok('the log row has the lower case recipient, the cohort names and the Firebase legacy id', logRow.recipient_email === 'contact@acme.example.test' && logRow.cohort_names.join() === 'Cohort A,Cohort B' && logRow.legacy_firestore_id === `organizations/acme-co/weekly_report_log/${WEEK}`);
rec = (await one(`select public.weekly_report_record('${org1}', '${WEEK}', 'failed', 'timeout', 'x@example.test', array[]::text[]) as r`)).r;
ok('a sent row is never overwritten (idempotent per organization per week)', rec.recorded === false && (await one(`select status from organization_weekly_report_log where organization_id = '${org1}'`)).status === 'sent');
due = (await one(`select private.weekly_org_reports_due('${WEEK}') as r`)).r;
ok('a sent organization is no longer due for that week, but is for the next week', !due.reports.some((x) => x.slug === 'acme-co') && (await one(`select private.weekly_org_reports_due('2026-W42') as r`)).r.reports.some((x) => x.slug === 'acme-co'));
e = await fails(() => db.query(`select public.weekly_report_record('${pid(7777)}', '${WEEK}', 'sent', null, null, null)`));
ok('an unknown organization is refused', !!e && e.code === 'P0002');
e = await fails(() => db.query(`select public.weekly_report_record('${org2}', '${WEEK}', 'weird', null, null, null)`));
ok('an unknown status is refused', !!e && e.code === '22023');
await db.query(`select public.weekly_report_record('${org2}', '${WEEK}', 'failed', 'x', null, null)`);
ok('a failed row with no recipient and no cohorts is fine', (await one(`select recipient_email, cohort_names from organization_weekly_report_log where organization_id = '${org2}'`)).recipient_email === null);
for (const role of ['anon', 'authenticated']) {
  e = await fails(() => as(role, `select public.weekly_org_reports_due('${WEEK}')`, claimsFor('fb_p1')));
  ok(`${role} cannot call the report functions`, !!e && /permission denied/.test(e.message));
}
ok('the service role can', (await as('service_role', `select public.weekly_org_reports_due('2026-W50') as r`))[0].r.reports.length === 2);

// ---- the two result emails: limits ----
// An Executive Signature attempt for a test person.
await db.exec(`insert into assessment_definitions (id, program_id, title, status) values ('quick-check', 'executive-signature', 'Quick check', 'live'), ('full-assessment', 'executive-signature', 'Full', 'live');
  insert into assessment_versions (id, assessment_id, version, scoring_version, content_version, status) values
  ('00000000-0000-0000-0000-00000000a001', 'quick-check', 'v1', 's1', 'c1', 'draft'), ('00000000-0000-0000-0000-00000000a002', 'full-assessment', 'v1', 's1', 'c1', 'draft')`);
const ES = await mkPerson(200, 'Esther Result');
let hashN = 0;
const attempt = async (person, legacy, assessment, completedAt) => {
  hashN += 1;
  return (await one(`insert into assessment_attempts (person_id, program_id, assessment_id, version_id, status, idempotency_hash, completed_at, overall_score, result_checksum, area_scores, band, profile_label, legacy_firestore_id)
    values ($1, 'executive-signature', $2, $3, 'completed', $4, $5, 71.5, $6, '{"Extraversion": 80, "Intellect": 55.4}'::jsonb, 'Developing', 'The Builder', $7) returning id`,
    [person, assessment, assessment === 'quick-check' ? '00000000-0000-0000-0000-00000000a001' : '00000000-0000-0000-0000-00000000a002', String(hashN).padStart(64, 'a'), completedAt, String(hashN).padStart(64, 'b'), legacy])).id;
};
const T0 = '2026-10-08T12:00:00Z';
await attempt(ES, 'assessmentAttempts/AttemptOne12345', 'quick-check', T0);
const begin = async (id, email, at) => (await one(`select private.readiness_email_begin($1, $2, $3::timestamptz) as r`, [id, email, at])).r;
const limitRows = () => count('email_limits');
let before0 = await limitRows();
ok('an invalid attempt id is invalid', (await begin('short', null, T0)).error === 'invalid' && (await begin('has space in it', null, T0)).error === 'invalid');
ok('an unknown attempt is not-found and writes nothing', (await begin('NoSuchAttempt99', null, T0)).error === 'not-found' && (await limitRows()) === before0);
const wrongEmail = await begin('AttemptOne12345', 'someone.else@example.test', '2026-10-08T12:10:00Z');
ok('a signed in caller with another address gets not-found and nothing is written', wrongEmail.error === 'not-found' && (await limitRows()) === before0);
const late = await begin('AttemptOne12345', null, '2026-10-08T13:00:00Z');
ok('an anonymous caller after an hour gets not-found and nothing is written', late.error === 'not-found' && (await limitRows()) === before0);
const early = await begin('AttemptOne12345', null, '2026-10-08T11:50:00Z');
ok('an anonymous caller more than 5 minutes before the completion time gets not-found', early.error === 'not-found');
let b = await begin('AttemptOne12345', null, '2026-10-08T12:30:00Z');
ok('an anonymous caller within the hour is allowed', b.ok === true);
ok('the answer holds the stored address, the display name, the band, profile, area scores, tier and completion time', b.recipient === 'p200@example.test' && b.name === 'Esther Result' && b.band === 'Developing' && b.profileLabel === 'The Builder'
  && b.areaScores.Extraversion === 80 && b.tier === 'quick-check' && b.completedAt === '2026-10-08T12:00:00.000Z', JSON.stringify(b));
b = await begin('AttemptOne12345', 'P200@Example.Test', '2026-10-08T12:35:00Z');
ok('a second send within 10 minutes of the first is rate-limited (attempt-cooldown)', b.error === 'rate-limited' && b.reason === 'attempt-cooldown');
b = await begin('AttemptOne12345', 'p200@example.test', '2026-10-08T12:41:00Z');
ok('a signed in caller with the address on file (any case) is allowed after the cooldown', b.ok === true);
await attempt(ES, 'assessmentAttempts/AttemptTwo12345', 'full-assessment', T0);
await attempt(ES, 'assessmentAttempts/AttemptThree123', 'full-assessment', T0);
b = await begin('AttemptTwo12345', 'p200@example.test', '2026-10-08T12:45:00Z');
ok('a third send to the same address the same day is still allowed (3 per day)', b.ok === true);
b = await begin('AttemptThree123', 'p200@example.test', '2026-10-08T12:50:00Z');
ok('a fourth send to the same address the same day is refused (address-daily-limit)', b.error === 'rate-limited' && b.reason === 'address-daily-limit');
b = await begin('AttemptThree123', 'p200@example.test', '2026-10-09T08:00:00Z');
ok('the next day the address may be used again (the attempt was also past its cooldown)', b.ok === true);
// release gives back
await db.query(`select private.readiness_email_release('AttemptThree123', 'p200@example.test', '2026-10-09T08:01:00Z'::timestamptz)`);
b = await begin('AttemptThree123', 'p200@example.test', '2026-10-09T08:02:00Z');
ok('after a failed hand over the release clears the cooldown so the person may try again', b.ok === true);
// global
const ES2 = await mkPerson(201, 'Global Test');
await attempt(ES2, 'assessmentAttempts/GlobalAttempt1', 'quick-check', T0);
await db.exec(`insert into email_limits (bucket, period, used, updated_at) values ('readiness:global:20261011', '20261011', 150, '2026-10-11T00:00:00Z') on conflict (bucket) do update set used = 150`);
b = await begin('GlobalAttempt1', 'p201@example.test', '2026-10-11T00:05:00Z');
ok('150 sends in a day for everyone: global-daily-limit', b.error === 'rate-limited' && b.reason === 'global-daily-limit');
// the three counters of a refusal: the global refusal did not use up the person's own counters
ok('a refusal does not use up the address counter', (await one(`select coalesce(sum(used), 0)::int n from email_limits where bucket like 'readiness:addr:%:20261011'`)).n === 0);
// permission data checks
const PEND = await mkPerson(202, 'Pending Deletion', 'deletion_pending');
await attempt(PEND, 'assessmentAttempts/PendingAttempt1', 'quick-check', T0);
ok('a person pending deletion cannot have a result sent', (await begin('PendingAttempt1', null, '2026-10-08T12:10:00Z')).error === 'not-found');
const BADMAIL = await mkPerson(203, 'No Name@Shown');
await attempt(BADMAIL, 'assessmentAttempts/NameAttempt001', 'quick-check', T0);
const hidden = await begin('NameAttempt001', null, '2026-10-08T12:10:00Z');
ok('a display name that is an address is not used as the greeting name', hidden.ok === true && hidden.name === '');
// uuid and unprefixed legacy id lookup
const uuidAttempt = await attempt(ES2, 'assessmentAttempts/UuidLookup0001', 'quick-check', T0);
ok('the attempt is also found by its uuid', (await begin(uuidAttempt, null, '2026-10-08T12:20:00Z')).ok === true);
// an attempt that is not a completed Executive Signature attempt is not-found
await db.exec(`insert into assessment_attempts (person_id, program_id, assessment_id, version_id, status, idempotency_hash, legacy_firestore_id) values ('${ES}', 'executive-signature', 'quick-check', '00000000-0000-0000-0000-00000000a001', 'in_progress', '${'c'.repeat(64)}', 'assessmentAttempts/NotCompleted01')`);
ok('an attempt that is not completed is not-found', (await begin('NotCompleted01', 'p200@example.test', '2026-10-08T12:20:00Z')).error === 'not-found');

// my results limits
const MR = await mkPerson(210, 'Results Person');
const MR2 = await mkPerson(211, 'Other Person');
const take = async (p, at) => (await one(`select private.results_email_take($1::uuid, $2::timestamptz) as r`, [p, at])).r;
const hour1 = '2026-10-08T10:15:00Z';
let outcomes = [];
for (let i = 0; i < 6; i += 1) outcomes.push(await take(MR, hour1));
ok('five sends an hour, the sixth is user-hourly-limit', outcomes.slice(0, 5).every((x) => x === 'ok') && outcomes[5] === 'user-hourly-limit', outcomes.join());
ok('the refusal does not use anything up', (await one(`select max(used)::int as used from email_limits where bucket like 'results:hour:%' and period = '2026100810'`)).used === 5);
ok('another person is not affected', (await take(MR2, hour1)) === 'ok');
ok('the next hour starts again', (await take(MR, '2026-10-08T11:15:00Z')) === 'ok');
// day limit: 20 per day. 5 in hour 10 + 1 in hour 11 = 6 so far for MR; add up to 20
let used = 6;
for (let h = 12; used < 20; h += 1) { for (let i = 0; i < 5 && used < 20; i += 1) { await take(MR, `2026-10-08T${String(h).padStart(2, '0')}:05:00Z`); used += 1; } }
ok('after 20 in a day: user-daily-limit', (await take(MR, '2026-10-08T22:30:00Z')) === 'user-daily-limit');
ok('the next day starts again', (await take(MR, '2026-10-09T01:00:00Z')) === 'ok');
await db.query(`select private.results_email_release($1::uuid, '2026-10-09T01:01:00Z'::timestamptz)`, [MR]);
ok('release gives the send back (the counters go down by one)', (await one(`select coalesce(max(used), 0)::int n from email_limits where bucket like 'results:hour:%:2026100901'`)).n === 0);
await db.exec(`insert into email_limits (bucket, period, used, updated_at) values ('results:global:20261012', '20261012', 300, '2026-10-12T00:00:00Z') on conflict (bucket) do update set used = 300`);
ok('300 a day for everyone: global-daily-limit', (await take(MR2, '2026-10-12T05:00:00Z')) === 'global-daily-limit');
e = await fails(() => db.query(`select private.results_email_take(null)`));
ok('a null person is refused (22023)', !!e && e.code === '22023');
for (const role of ['anon', 'authenticated']) {
  e = await fails(() => as(role, `select public.results_email_take('${MR}')`, claimsFor('fb_p210')));
  ok(`${role} cannot take or release a send`, !!e && /permission denied/.test(e.message));
  e = await fails(() => as(role, `select public.readiness_email_begin('AttemptOne12345', null)`, claimsFor('fb_p210')));
  ok(`${role} cannot start a readiness send`, !!e && /permission denied/.test(e.message));
}
ok('the service role can take a send', (await as('service_role', `select public.results_email_take('${MR2}') as r`))[0].r === 'ok');
// old counter rows are removed by the next call
await db.exec(`insert into email_limits (bucket, period, used, updated_at) values ('results:old:row', 'x', 1, '2026-01-01T00:00:00Z')`);
await take(MR2, '2026-10-12T06:00:00Z');
ok('counters older than 3 days are removed by the next call', (await count(`email_limits where bucket = 'results:old:row'`)) === 0);
// the limit table holds no address and no name
const dump = JSON.stringify((await db.query(`select * from email_limits`)).rows);
ok('the limit table holds only hashes, ids and counts (no address, no name)', !/example\.test|Esther|Results Person/i.test(dump), dump.slice(0, 200));

// ---- applying the file twice ----
await db.exec(`alter table public.activity_progress enable trigger credential_auto_issue`);
const limitsBefore = await count('email_limits');
const credsBefore = await count('credentials');
await db.exec(sqlText);
ok('applying the migration again runs without error', true);
ok('a re-apply does not switch an enabled trigger off', (await one(`select tgenabled from pg_trigger where tgname = 'credential_auto_issue' and tgrelid = 'public.activity_progress'::regclass`)).tgenabled === 'O');
ok('a re-apply keeps the data (limits, certificates) and one trigger', (await count('email_limits')) === limitsBefore && (await count('credentials')) === credsBefore && (await count(`pg_trigger where tgname = 'credential_auto_issue'`)) === 1);
await db.exec(`alter table public.activity_progress disable trigger credential_auto_issue`);
await db.exec(sqlText);
ok('a re-apply leaves a disabled trigger disabled', (await one(`select tgenabled from pg_trigger where tgname = 'credential_auto_issue'`)).tgenabled === 'D');
ok('the functions still work after a re-apply', (await take(MR2, '2026-10-13T05:00:00Z')) === 'ok');

// ---- the rollback ----
await db.exec(downText);
const left = (await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.proname in ('issue_my_credential','issue_credential_core','issue_credential_if_eligible','credential_auto_issue_trigger','credential_shadow_report','issue_missing_credentials','cert_settings','cert_required_activities',
    'weekly_org_report','weekly_org_aggregate','weekly_org_reports_due','weekly_report_record','report_progress_activities','readiness_email_begin','readiness_email_release','results_email_take','results_email_release','result_email_confirmed')`)).rows;
ok('the rollback removes every function, the trigger and the table', left.length === 0 && (await count(`pg_trigger where tgname = 'credential_auto_issue'`)) === 0 && (await count(`pg_class where relname = 'email_limits' and relkind = 'r'`)) === 0);
ok('certificates already issued stay (ordinary rows)', (await count('credentials')) > 0);

console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
