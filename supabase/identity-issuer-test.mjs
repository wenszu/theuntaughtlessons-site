// Tests for migration 1800: the signed-in person is resolved by token issuer, not by sub alone.
//   node supabase/identity-issuer-test.mjs
// Claims are full objects (iss, sub, role) so each issuer path is exercised. The harness itself sets no iss,
// so the documented no-iss fallback is tested here too.
import { boot } from './schema-apply-harness.mjs';
const { db, failed } = await boot();
if (failed) { console.log('\nmigration failed to load, stopping'); process.exit(1); }
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n); };
const rejects = async (n, sql) => { try { await db.exec(sql); ok(n, false); } catch (e) { ok(n + '  [' + e.message.slice(0, 60) + ']', true); } };
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const as = async (role, claims, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', ${claims ? lit(JSON.stringify(claims)) : "''"}, false);`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
};
const rejectsAs = async (n, role, claims, sql, code) => {
  try { await as(role, claims, sql); ok(n, false); }
  catch (e) {
    const got = e.code || (e.message.match(/\b(\d{2}[0-9A-Z]{3})\b/) || [])[1] || '';
    ok(n + '  [' + (got || e.message.slice(0, 50)) + ']', !code || got === code || e.message.includes(code));
  }
};
const q = async (s) => (await db.query(s)).rows;
const who = async (role, claims) => (await as(role, claims, `select private.current_person_id() as id`))[0].id;

const FB_ISS = 'https://securetoken.google.com/utl-project';
const SB_ISS = 'https://abcdefghijklmnop.supabase.co/auth/v1';
const BAD_ISS = 'https://accounts.example.com/';
const fb = (sub) => ({ iss: FB_ISS, sub, role: 'authenticated', aud: 'utl-project' });
const sb = (sub) => ({ iss: SB_ISS, sub, role: 'authenticated', aud: 'authenticated' });
const bad = (sub) => ({ iss: BAD_ISS, sub, role: 'authenticated' });
const noiss = (sub) => ({ sub, role: 'authenticated' });

const ALICE = '00000000-0000-0000-0000-000000000001', ALICE_SB = '99999999-0000-0000-0000-000000000001';
const BOB = '00000000-0000-0000-0000-000000000002';
const CAROL = '00000000-0000-0000-0000-000000000003', CAROL_SB = '99999999-0000-0000-0000-000000000003';
const DAVE = '00000000-0000-0000-0000-000000000004', DAVE_SB = '99999999-0000-0000-0000-000000000004';
const ERIN = '00000000-0000-0000-0000-000000000005', ERIN_SB = '99999999-0000-0000-0000-000000000005';

await db.exec(`
 insert into people (id, auth_uid, supabase_uid, primary_email, account_status) values
  ('${ALICE}','fb_alice','${ALICE_SB}','alice@a.com','active'),
  ('${BOB}','fb_bob',null,'bob@a.com','active'),
  ('${CAROL}','fb_carol','${CAROL_SB}','carol@a.com','restricted'),
  ('${DAVE}','fb_dave','${DAVE_SB}','dave@a.com','archived'),
  ('${ERIN}',null,'${ERIN_SB}','erin@a.com','active');
 insert into enrollments (person_id, program_id, status) values ('${ALICE}','tsa','active'),('${BOB}','tsa','active'),('${ERIN}','tsa','active');
 insert into activities (id, program_id, title, module_key) values ('p1-e1','tsa','Grocery list','phase-1');
 insert into activity_keys (key, activity_id) values ('grocery-list','p1-e1');
`);

// ---- resolution by issuer
ok('firebase iss with sub = auth_uid resolves', await who('authenticated', fb('fb_alice')) === ALICE);
ok('firebase iss with sub = a supabase_uid resolves to nobody', await who('authenticated', fb(ALICE_SB)) === null);
ok('supabase iss with sub = supabase_uid resolves', await who('authenticated', sb(ALICE_SB)) === ALICE);
ok('supabase iss resolves a person with no firebase uid', await who('authenticated', sb(ERIN_SB)) === ERIN);
ok('supabase iss with sub = a firebase uid resolves to nobody', await who('authenticated', sb('fb_alice')) === null);
ok('supabase iss with a non uuid sub does not error', await who('authenticated', sb('not-a-uuid')) === null);
ok('unknown iss with a firebase uid resolves to nobody', await who('authenticated', bad('fb_alice')) === null);
ok('unknown iss with a supabase uid resolves to nobody', await who('authenticated', bad(ALICE_SB)) === null);
ok('no iss still resolves a firebase uid (documented fallback)', await who('authenticated', noiss('fb_alice')) === ALICE);
ok('no iss still resolves a supabase uid (documented fallback)', await who('authenticated', noiss(ALICE_SB)) === ALICE);
ok('no claims at all resolves to nobody', await who('authenticated', null) === null);
ok('empty sub resolves to nobody', await who('authenticated', fb('')) === null);
ok('firebase iss for a different project still counts as firebase', await who('authenticated', { iss: 'https://securetoken.google.com/other-project', sub: 'fb_alice', role: 'authenticated' }) === ALICE);
ok('local supabase iss (http, port) still counts as supabase', await who('authenticated', { iss: 'http://127.0.0.1:54321/auth/v1', sub: ALICE_SB, role: 'authenticated' }) === ALICE);
ok('iss that merely contains the firebase host is not firebase', await who('authenticated', { iss: 'https://evil.example.com/https://securetoken.google.com/x', sub: 'fb_alice', role: 'authenticated' }) === null);
ok('iss that merely contains /auth/v1 is not supabase', await who('authenticated', { iss: 'https://evil.example.com/auth/v1/x', sub: ALICE_SB, role: 'authenticated' }) === null);

// ---- account status
ok('archived: firebase path resolves to nobody', await who('authenticated', fb('fb_dave')) === null);
ok('archived: supabase path resolves to nobody', await who('authenticated', sb(DAVE_SB)) === null);
ok('archived: no iss path resolves to nobody', await who('authenticated', noiss('fb_dave')) === null && await who('authenticated', noiss(DAVE_SB)) === null);
ok('restricted: firebase path resolves', await who('authenticated', fb('fb_carol')) === CAROL);
ok('restricted: supabase path resolves', await who('authenticated', sb(CAROL_SB)) === CAROL);

// ---- grants
const priv = (await q(`select has_function_privilege('authenticated', 'private.current_person_id()', 'execute') as a,
                              has_function_privilege('anon', 'private.current_person_id()', 'execute') as n,
                              has_function_privilege('authenticated', 'private.jwt_identity()', 'execute') as ja,
                              has_function_privilege('anon', 'private.jwt_identity()', 'execute') as jn,
                              has_function_privilege('authenticated', 'private.people_identity_collision()', 'execute') as ta`))[0];
ok('authenticated can still execute current_person_id', priv.a === true);
ok('anon cannot execute current_person_id', priv.n === false);
ok('authenticated can execute jwt_identity (policies run as the user)', priv.ja === true);
ok('anon cannot execute jwt_identity', priv.jn === false);
ok('trigger function closed to browsers', priv.ta === false);
const fdef = (await q(`select pg_get_functiondef('private.current_person_id()'::regprocedure) as d`))[0].d;
ok('current_person_id is security definer with empty search_path', /SECURITY DEFINER/.test(fdef) && /SET search_path TO ''/.test(fdef));
let anonPeople = -1; try { anonPeople = (await as('anon', null, `select count(*)::int n from people`))[0].n; } catch { anonPeople = 0; }
ok('anon cannot read people', anonPeople === 0);
let anonEnr = -1; try { anonEnr = (await as('anon', null, `select count(*)::int n from enrollments`))[0].n; } catch { anonEnr = 0; }
ok('anon cannot read enrollments', anonEnr === 0);

// ---- constraints on people
await rejects('uuid shaped auth_uid rejected on insert', `insert into people (auth_uid, primary_email) values ('12345678-1234-1234-1234-123456789abc','u1@a.com')`);
await rejects('uuid shaped auth_uid rejected in upper case too', `insert into people (auth_uid, primary_email) values ('12345678-1234-1234-1234-123456789ABC','u2@a.com')`);
await rejects('uuid shaped auth_uid rejected on update', `update people set auth_uid = '${BOB}' where id = '${BOB}'`);
await db.exec(`insert into people (auth_uid, primary_email) values ('AbCdEfGhIjKlMnOpQrStUvWxYz12','fbshape@a.com')`);
ok('28 character firebase uid accepted', (await q(`select count(*)::int n from people where auth_uid = 'AbCdEfGhIjKlMnOpQrStUvWxYz12'`))[0].n === 1);
await db.exec(`insert into people (auth_uid, primary_email) values ('uid-alice','importshape@a.com')`);
ok('import fixture shaped uid accepted', true);
await db.exec(`insert into people (auth_uid, primary_email) values (null,'nouid@a.com')`);
ok('null auth_uid accepted', true);
ok('constraint is NOT VALID until the owner validates it', (await q(`select convalidated from pg_constraint where conname = 'people_auth_uid_not_uuid'`))[0].convalidated === false);
ok('trigger exists on people', (await q(`select count(*)::int n from pg_trigger where tgrelid = 'public.people'::regclass and tgname = 'people_identity_collision'`))[0].n === 1);

// The live apply sequence: a bad legacy row may exist while the constraint is NOT VALID. Model that by dropping
// the constraint, planting the row, and adding the constraint back NOT VALID (exactly as the migration does).
const LEGACY = '00000000-0000-0000-0000-00000000bad1', LEGACY_UID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
await db.exec(`alter table people drop constraint people_auth_uid_not_uuid`);
await db.exec(`insert into people (id, auth_uid, primary_email) values ('${LEGACY}','${LEGACY_UID}','legacy@a.com')`);
await db.exec(`alter table people add constraint people_auth_uid_not_uuid
  check (auth_uid is null or auth_uid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') not valid`);
ok('migration applies with a bad legacy row present (NOT VALID)', true);
await rejects('setting supabase_uid equal to another person\'s auth_uid is rejected', `update people set supabase_uid = '${LEGACY_UID}' where id = '${BOB}'`);
await rejects('inserting a person whose supabase_uid equals an auth_uid is rejected', `insert into people (supabase_uid, primary_email) values ('${LEGACY_UID}','clash@a.com')`);
await rejects('setting auth_uid equal to another person\'s supabase_uid is rejected (constraint or trigger)', `update people set auth_uid = '${ALICE_SB}' where id = '${BOB}'`);
ok('bob unchanged after the rejected updates', (await q(`select auth_uid, supabase_uid from people where id = '${BOB}'`))[0].supabase_uid === null);
ok('the legacy row cannot be resolved by a supabase token through the firebase column', await who('authenticated', sb(LEGACY_UID)) === null);
ok('the legacy row resolves only through a firebase token', await who('authenticated', fb(LEGACY_UID)) === LEGACY);
await rejects('validate fails while the bad row exists (the owner\'s count query would show 1)', `alter table people validate constraint people_auth_uid_not_uuid`);
await db.exec(`delete from people where id = '${LEGACY}'`);
await db.exec(`alter table people validate constraint people_auth_uid_not_uuid`);
ok('validate succeeds once the count is 0', (await q(`select convalidated from pg_constraint where conname = 'people_auth_uid_not_uuid'`))[0].convalidated === true);
// Trigger self-row branch: the same row's auth_uid equal to its supabase_uid. Guard 1 is validated now, so the
// check constraint fires first; either way the write is refused.
await rejects('one row with auth_uid = supabase_uid::text rejected', `insert into people (auth_uid, supabase_uid, primary_email) values ('${ERIN_SB}','${ERIN_SB}','self@a.com')`);

// ---- row level security end to end
const people = async (claims) => await as('authenticated', claims, `select id from people order by id`);
let rows = await people(fb('fb_alice'));
ok('firebase: alice sees only her own people row', rows.length === 1 && rows[0].id === ALICE);
rows = await people(sb(ALICE_SB));
ok('supabase: alice sees only her own people row', rows.length === 1 && rows[0].id === ALICE);
rows = await people(fb(ALICE_SB));
ok('firebase token carrying alice\'s supabase uid sees no people row', rows.length === 0);
rows = await people(sb('fb_alice'));
ok('supabase token carrying alice\'s firebase uid sees no people row', rows.length === 0);
rows = await people(bad('fb_alice'));
ok('unknown issuer sees no people row', rows.length === 0);
rows = await people(noiss('fb_alice'));
ok('no iss: alice sees her own row (fallback)', rows.length === 1 && rows[0].id === ALICE);
rows = await people(fb('fb_bob'));
ok('firebase: bob sees only bob', rows.length === 1 && rows[0].id === BOB);
rows = await people(sb(ERIN_SB));
ok('supabase: erin (no firebase uid) sees only erin', rows.length === 1 && rows[0].id === ERIN);
rows = await people(fb('fb_dave'));
ok('people policy keeps its old status behaviour: archived dave still sees his own row', rows.length === 1 && rows[0].id === DAVE);
ok('firebase: alice sees her enrollment', (await as('authenticated', fb('fb_alice'), `select count(*)::int n from enrollments`))[0].n === 1);
ok('supabase: alice sees her enrollment', (await as('authenticated', sb(ALICE_SB), `select count(*)::int n from enrollments`))[0].n === 1);
ok('firebase token with a supabase sub sees no enrollments', (await as('authenticated', fb(ALICE_SB), `select count(*)::int n from enrollments`))[0].n === 0);
ok('supabase token with a firebase sub sees no enrollments', (await as('authenticated', sb('fb_alice'), `select count(*)::int n from enrollments`))[0].n === 0);
ok('archived dave sees no enrollments through current_person_id', (await as('authenticated', fb('fb_dave'), `select count(*)::int n from enrollments`))[0].n === 0);

// ---- write functions
let r = (await as('authenticated', fb('fb_alice'), `select save_activity_draft('grocery-list', '{"values":{"a":1}}'::jsonb) as r`))[0].r;
ok('firebase token: save_activity_draft works', r.saved === true && r.activity_id === 'p1-e1');
ok('draft belongs to alice', (await q(`select person_id from activity_drafts`))[0].person_id === ALICE);
r = (await as('authenticated', sb(ALICE_SB), `select save_activity_draft('p1-e1', '{"values":{"a":2}}'::jsonb) as r`))[0].r;
ok('supabase token: save_activity_draft works for the same person', r.saved === true);
ok('still one draft row, owned by alice, now with the second value', (await q(`select count(*)::int n, min(person_id::text) p, min(draft->'values'->>'a') a from activity_drafts`))[0].n === 1
   && (await q(`select person_id, draft from activity_drafts`))[0].draft.values.a === 2);
r = (await as('authenticated', sb(ERIN_SB), `select save_activity_draft('p1-e1', '{"values":{"e":1}}'::jsonb) as r`))[0].r;
ok('supabase token: a person with no firebase uid can write', r.saved === true && (await q(`select count(*)::int n from activity_drafts where person_id = '${ERIN}'`))[0].n === 1);
await rejectsAs('firebase token with a supabase sub cannot write', 'authenticated', fb(ALICE_SB), `select save_activity_draft('p1-e1', '{}'::jsonb)`, '42501');
await rejectsAs('supabase token with a firebase sub cannot write', 'authenticated', sb('fb_alice'), `select save_activity_draft('p1-e1', '{}'::jsonb)`, '42501');
await rejectsAs('unknown issuer cannot write', 'authenticated', bad('fb_alice'), `select save_activity_draft('p1-e1', '{}'::jsonb)`, '42501');
await rejectsAs('archived dave cannot write with either issuer', 'authenticated', sb(DAVE_SB), `select save_activity_draft('p1-e1', '{}'::jsonb)`, '42501');
ok('alice\'s draft untouched by the refused calls', (await q(`select draft from activity_drafts where person_id = '${ALICE}'`))[0].draft.values.a === 2);
r = (await as('authenticated', sb(ALICE_SB), `select record_login('google.com') as r`))[0].r;
ok('supabase token: record_login (1700 profile function) works', r.saved === true);
r = (await as('authenticated', fb('fb_bob'), `select record_login('google.com') as r`))[0].r;
ok('firebase token: record_login works', r.saved === true);
ok('profile rows went to the right people', (await q(`select array_agg(person_id::text order by person_id) a from person_profiles`))[0].a.join(',') === [ALICE, BOB].join(','));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
