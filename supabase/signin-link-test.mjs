// Tests for migration 2270: public.link_my_identity(), and the rollback.
//   node supabase/signin-link-test.mjs
// The local database has no Supabase Auth table, so the test adds a minimal stand in for auth.users (the columns the
// function reads) and simulates tokens the way migration 1800 and its tests do: request.jwt.claims with iss, sub, role.
import fs from 'fs';
import { boot } from './schema-apply-harness.mjs';

const { db, failed } = await boot();
if (failed) { console.log('\nmigrations did not apply, stopping'); process.exit(1); }
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n); };
const q = async (s) => (await db.query(s)).rows;
const as = async (role, claims, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${claims ? JSON.stringify(claims) : ''}', false);`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
};

const SB = 'https://czljyikfavtjgqcibdda.supabase.co/auth/v1';
const FB = 'https://securetoken.google.com/the-untaught-lessons';
const u = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const P = (n) => `11111111-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const sbToken = (n, email, extra = {}) => ({ iss: SB, sub: u(n), role: 'authenticated', aud: 'authenticated', email, ...extra });
const link = async (claims) => (await as('authenticated', claims, 'select public.link_my_identity() as r'))[0].r;
const people = async () => (await q('select count(*)::int n from people'))[0].n;
const audits = async () => (await q(`select count(*)::int n from audit_events where action = 'auth.identity_linked'`))[0].n;
const uidOf = async (id) => (await q(`select supabase_uid from people where id = '${id}'`))[0].supabase_uid;

// A stand in for the Supabase Auth user table: only the columns the function reads.
await db.exec(`
 create table auth.users (
   id uuid primary key, email text, email_confirmed_at timestamptz, banned_until timestamptz,
   deleted_at timestamptz, is_anonymous boolean not null default false, is_sso_user boolean not null default false
 );
 create table auth.identities (
   id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id) on delete cascade,
   provider text not null, identity_data jsonb not null default '{}'::jsonb
 );
 insert into auth.users (id, email, email_confirmed_at) values
  ('${u(1)}', 'alice@a.com', now()),
  ('${u(2)}', 'bob@a.com', now()),
  ('${u(3)}', 'carol@new.com', now()),
  ('${u(4)}', 'dave@a.com', now()),
  ('${u(5)}', 'erin@a.com', null),
  ('${u(6)}', 'nobody@a.com', now()),
  ('${u(7)}', 'frank@a.com', now()),
  ('${u(8)}', 'gina@a.com', now()),
  ('${u(9)}', 'alice@a.com', now()),
  ('${u(10)}', 'hank@a.com', now());
 update auth.users set banned_until = now() + interval '1 day' where id = '${u(10)}';
 insert into auth.users (id, email, email_confirmed_at, is_anonymous) values ('${u(11)}', 'ivy@a.com', now(), true);
 insert into auth.users (id, email, email_confirmed_at, deleted_at) values ('${u(12)}', 'jon@a.com', now(), now());
 insert into auth.users (id, email, email_confirmed_at) values ('${u(13)}', 'newmail@a.com', now());
 insert into auth.users (id, email, email_confirmed_at, is_sso_user) values ('${u(14)}', 'sso@a.com', now(), true), ('${u(15)}', 'bare@a.com', now(), false),
  ('${u(16)}', 'azure@a.com', now(), false), ('${u(17)}', 'goog@a.com', now(), false), ('${u(18)}', 'gother@a.com', now(), false);
 insert into auth.identities (user_id, provider, identity_data)
  select id, 'email', jsonb_build_object('email', email) from auth.users where id not in ('${u(15)}', '${u(16)}', '${u(17)}', '${u(18)}');
 insert into auth.identities (user_id, provider, identity_data) values
  ('${u(16)}', 'azure', '{"email":"azure@a.com","email_verified":false}'),
  ('${u(17)}', 'google', '{"email":"goog@a.com","email_verified":true}'),
  ('${u(18)}', 'google', '{"email":"someone.else@a.com","email_verified":true}');
 insert into people (id, auth_uid, primary_email) values
  ('${P(14)}', 'fb_sso', 'sso@a.com'), ('${P(15)}', 'fb_bare', 'bare@a.com'), ('${P(16)}', 'fb_azure', 'azure@a.com'),
  ('${P(17)}', 'fb_goog', 'goog@a.com'), ('${P(18)}', 'fb_gother', 'gother@a.com');
 insert into people (id, auth_uid, primary_email) values
  ('${P(1)}', 'fb_alice', 'alice@a.com'),
  ('${P(2)}', 'fb_bob', 'bob@a.com'),
  ('${P(3)}', 'fb_carol', 'carol@old.com'),
  ('${P(5)}', 'fb_erin', 'erin@a.com'),
  ('${P(7)}', 'fb_frank', 'frank@a.com'),
  ('${P(8)}', 'fb_gina', 'gina@a.com'),
  ('${P(10)}', 'fb_hank', 'hank@a.com'),
  ('${P(11)}', 'fb_ivy', 'ivy@a.com'),
  ('${P(12)}', 'fb_jon', 'jon@a.com');
 insert into people (id, auth_uid, primary_email, account_status) values ('${P(4)}', 'fb_dave', 'dave@a.com', 'archived');
 update people set supabase_uid = '${u(99)}' where id = '${P(2)}';
 update people set supabase_uid = '${u(7)}' where id = '${P(7)}';
 insert into person_emails (person_id, email, status) values ('${P(3)}', 'carol@new.com', 'active'), ('${P(3)}', 'carol@old.com', 'active');
`);

// ---- the function itself
const fn = (await q(`select p.prosecdef, array_to_string(p.proconfig, ',') as config, pg_get_function_arguments(p.oid) as args, pg_get_function_result(p.oid) as result,
  has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'link_my_identity'`))[0];
ok('the function exists, returns jsonb, takes no argument', !!fn && fn.result === 'jsonb' && fn.args === '');
ok('security definer with an empty search_path', fn.prosecdef && /search_path=("")?(,|$)/.test(fn.config || ''));
ok('anon cannot execute, authenticated can', !fn.anon_exec && fn.auth_exec);
let anonRefused = false;
try { await as('anon', { role: 'anon' }, 'select public.link_my_identity()'); } catch (e) { anonRefused = /permission denied/.test(e.message); }
ok('anon is refused', anonRefused);

// ---- refusals write nothing
const peopleBefore = await people();
let r = await link(null);
ok('no token: not_signed_in', r.linked === false && r.reason === 'not_signed_in' && r.person_id === null);
r = await link({ sub: u(1), role: 'authenticated', email: 'alice@a.com' });
ok('a token with no iss claim is refused', r.linked === false && r.reason === 'not_supabase_token');
r = await link({ iss: FB, sub: u(1), role: 'authenticated', email: 'alice@a.com' });
ok('a Firebase token is refused', r.linked === false && r.reason === 'not_supabase_token');
r = await link({ iss: 'https://evil.example/auth/v2', sub: u(1), role: 'authenticated', email: 'alice@a.com' });
ok('another issuer is refused', r.reason === 'not_supabase_token');
r = await link({ iss: 'https://other-project.supabase.co/auth/v1', sub: u(1), role: 'authenticated', email: 'alice@a.com' });
ok('another project with the same path is refused (exact issuer)', r.reason === 'not_supabase_token');
r = await link({ iss: SB + '/', sub: u(1), role: 'authenticated', email: 'alice@a.com' });
ok('an issuer with a trailing slash is refused', r.reason === 'not_supabase_token');
r = await link({ iss: SB, sub: 'fb_alice', role: 'authenticated', email: 'alice@a.com' });
ok('a subject that is not a uuid is refused', r.reason === 'not_supabase_token');
r = await link({ iss: SB, sub: u(1), role: 'anon', email: 'alice@a.com' });
ok('a token whose role is not authenticated is refused', r.reason === 'not_supabase_token');
r = await link(sbToken(5, 'erin@a.com', { user_metadata: { email_verified: true } }));
ok('an unconfirmed account is refused, even when user_metadata claims it is verified', r.linked === false && r.reason === 'not_verified');
r = await link(sbToken(1, 'bob@a.com'));
ok('a token email that differs from the account email is refused', r.reason === 'not_verified');
r = await link(sbToken(40, 'alice@a.com'));
ok('a token with no auth.users row is refused', r.reason === 'not_verified');
r = await link({ iss: SB, sub: u(1), role: 'authenticated' });
ok('a token with no email claim is refused', r.reason === 'not_verified');
r = await link(sbToken(10, 'hank@a.com'));
ok('a banned account is refused', r.reason === 'not_verified');
r = await link(sbToken(11, 'ivy@a.com'));
ok('an anonymous account is refused', r.reason === 'not_verified');
r = await link(sbToken(12, 'jon@a.com'));
ok('a deleted account is refused', r.reason === 'not_verified');
r = await link(sbToken(14, 'sso@a.com'));
ok('a single sign on user is refused', r.reason === 'not_verified' && (await uidOf(P(14))) === null);
r = await link(sbToken(15, 'bare@a.com'));
ok('a user with no identity row is refused', r.reason === 'not_verified' && (await uidOf(P(15))) === null);
r = await link(sbToken(16, 'azure@a.com'));
ok('a user whose only identity is an unverified provider identity is refused', r.reason === 'not_verified' && (await uidOf(P(16))) === null);
r = await link(sbToken(18, 'gother@a.com'));
ok('a verified provider identity for a different address does not vouch for this one', r.reason === 'not_verified' && (await uidOf(P(18))) === null);
r = await link(sbToken(6, 'nobody@a.com'));
ok('an unknown email gets no_person', r.linked === false && r.reason === 'no_person' && r.person_id === null);
ok('refusals never created a person', (await people()) === peopleBefore);
r = await link(sbToken(4, 'dave@a.com'));
ok('an archived person is refused', r.linked === false && r.reason === 'person_inactive' && (await uidOf(P(4))) === null);
r = await link(sbToken(2, 'bob@a.com'));
ok('a person with a different supabase_uid is refused and unchanged', r.linked === false && r.reason === 'different_account' && (await uidOf(P(2))) === u(99));
ok('no refusal wrote an audit row', (await audits()) === 0);
ok('none of the refused attempts changed any supabase_uid', (await q(`select count(*)::int n from people where supabase_uid is not null`))[0].n === 2);
ok('the migration names the exact issuer and checks is_sso_user and identities', (() => { const t = fs.readFileSync(new URL('./migrations/20261008002270_signin_link.sql', import.meta.url), 'utf8'); return t.includes("v_iss <> 'https://czljyikfavtjgqcibdda.supabase.co/auth/v1'") && /is_sso_user/.test(t) && /auth\.identities/.test(t) && !/not like '%\/auth\/v1'/.test(t); })());

// ---- links
r = await link(sbToken(1, 'alice@a.com'));
ok('a verified email links the person', r.linked === true && r.reason === 'linked' && r.person_id === P(1));
ok('people.supabase_uid is now the account id', (await uidOf(P(1))) === u(1));
ok('one audit row, counts only (no email, no uid in the detail)', (await audits()) === 1 &&
  !/@|0000-4000/.test(JSON.stringify((await q(`select detail from audit_events where action = 'auth.identity_linked'`))[0].detail)));
r = await link(sbToken(1, 'alice@a.com'));
ok('calling again is harmless: already_linked, no second audit row', r.linked === true && r.reason === 'already_linked' && r.person_id === P(1) && (await audits()) === 1);
r = await link(sbToken(7, 'frank@a.com'));
ok('a person already linked to the same account is reported as linked', r.linked === true && r.reason === 'already_linked');
r = await link(sbToken(17, 'goog@a.com'));
ok('a verified Google identity for the same address vouches for it', r.linked === true && (await uidOf(P(17))) === u(17));
r = await link(sbToken(3, 'Carol@New.com'));
ok('an address in the email history links, whatever the case of the claim', r.linked === true && r.person_id === P(3) && (await uidOf(P(3))) === u(3));
r = await link(sbToken(9, 'alice@a.com'));
ok('a second account for the same email cannot take over a linked person', r.linked === false && r.reason === 'different_account' && (await uidOf(P(1))) === u(1));
r = await link(sbToken(13, 'newmail@a.com'));
ok('an address that belongs to nobody still creates nothing', r.reason === 'no_person');
await db.exec(`update people set supabase_uid = '${u(13)}' where id = '${P(12)}'`);
// uid_in_use: the account id is already stored on a different person
await db.exec(`update auth.users set email = 'gina@a.com' where id = '${u(13)}'`);
r = await link(sbToken(13, 'gina@a.com'));
ok('an account id already used by another person is refused (uid_in_use)', r.linked === false && r.reason === 'uid_in_use' && (await uidOf(P(8))) === null);
ok('the function never creates people', (await people()) === peopleBefore);

// ---- the result is what the rest of the schema expects
const mine = async (claims) => (await as('authenticated', claims, 'select public.get_my_person_id() as r'))[0].r;
ok('after linking, a Supabase token resolves to the person', (await mine(sbToken(1, 'alice@a.com'))) === P(1));
ok('a Firebase token with the same sub does not resolve to that person', (await mine({ iss: FB, sub: u(1), role: 'authenticated' })) === null);
ok('before linking a Supabase token resolves to nobody', (await mine(sbToken(5, 'erin@a.com'))) === null);

const body = (await q(`select prosrc from pg_proc where proname = 'link_my_identity'`))[0].prosrc;
ok('the function writes only people.supabase_uid and one audit row', (body.match(/\bupdate public\.people set supabase_uid\b/g) || []).length === 1 &&
  (body.match(/\binsert into\b/g) || []).length === 1 && !/\bdelete\b/i.test(body) && !/insert into public\.people/i.test(body));
ok('it does not trust user_metadata', !/user_metadata/.test(body));
ok('no backslash in the migration', !fs.readFileSync(new URL('./migrations/20261008002270_signin_link.sql', import.meta.url), 'utf8').includes('\\'));

// ---- rollback and re-apply
await db.exec(fs.readFileSync(new URL('./rollbacks/20261008002270_signin_link_down.sql', import.meta.url), 'utf8'));
ok('rollback removes the function', (await q(`select count(*)::int n from pg_proc where proname = 'link_my_identity'`))[0].n === 0);
ok('rollback keeps links already made', (await uidOf(P(1))) === u(1));
await db.exec(fs.readFileSync(new URL('./migrations/20261008002270_signin_link.sql', import.meta.url), 'utf8'));
r = await link(sbToken(1, 'alice@a.com'));
ok('the migration applies again', r.linked === true && r.reason === 'already_linked');
console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
