// Tests for migration 20261008002170: the Inbox (leads and feedback) and the data clean up toolset.
// Run: node supabase/inbox-cleanup-test.mjs
import { boot } from './schema-apply-harness.mjs';
const { db, failed } = await boot();
if (failed) { console.log('FAIL migrations did not apply'); process.exit(1); }
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, !c && d ? `[${d}]` : ''); };
const as = async (role, sub, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${sub ? JSON.stringify({ sub, role: 'authenticated' }) : ''}', false);`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
};
const codeOf = (e) => e.code || (e.message.match(/\b(\d{2}[0-9A-Z]{3})\b/) || [])[1] || '';
const rejectsAs = async (n, role, sub, sql, code) => {
  try { await as(role, sub, sql); ok(n, false, 'did not fail'); }
  catch (e) { const got = codeOf(e); ok(`${n}  [${got || e.message.slice(0, 50)}]`, !code || got === code, e.message.slice(0, 120)); }
};
const q = async (s, p) => (await db.query(s, p)).rows;
const n1 = async (s) => Number((await q(s))[0].n);
const j = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const arr = (ids) => `array[${ids.map((i) => `'${i}'`).join(',')}]::uuid[]`;
const OWNER = 'fb_owner', MEMBER = 'fb_member', SUPPORT = 'fb_support';
const call = async (sub, sql) => (await as('authenticated', sub, `select ${sql} as r`))[0].r;
const anon = async (sql) => (await as('anon', null, `select ${sql} as r`))[0].r;
const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const OWNER_ID = U(1), MEMBER_ID = U(2), SUPPORT_ID = U(3), REAL_ID = U(4);
const T1 = U(101), T2 = U(102), T3 = U(103);
const lead = (o = {}) => ({ email: 'someone@acme.org', ...o });
const submitLead = (o, who = null) => (who ? call(who, `public.submit_lead(${j(o)})`) : anon(`public.submit_lead(${j(o)})`));
const submitFb = (o, who = null) => (who ? call(who, `public.submit_feedback(${j(o)})`) : anon(`public.submit_feedback(${j(o)})`));
const lastLead = async () => (await q(`select * from leads order by seq desc limit 1`))[0];
const lastFb = async () => (await q(`select * from feedback_submissions order by seq desc limit 1`))[0];
const reset = async () => { await db.exec(`delete from leads; delete from feedback_submissions;`); };

// Test only: a sequence column so "the last stored row" is exact (now() ties inside one millisecond).
await db.exec(`alter table leads add column seq bigserial; alter table feedback_submissions add column seq bigserial;`);
await db.exec(`
 insert into people (id, auth_uid, primary_email, display_name) values
  ('${OWNER_ID}','${OWNER}','owner@utl.com','Olive Owner'),
  ('${MEMBER_ID}','${MEMBER}','member@acme.org','Mia Member'),
  ('${SUPPORT_ID}','${SUPPORT}','support@utl.com','Sam Support'),
  ('${REAL_ID}','fb_real','real@acme.org','Rita Real');
 insert into role_grants (person_id, scope_type, role) values
  ('${OWNER_ID}','platform','platform_owner'),('${SUPPORT_ID}','platform','customer_support');
`);

// ============================================================ grants and exposure
const ADMIN = [
  ['admin_inbox_list', 'text,text,text,boolean,integer,integer'], ['admin_inbox_set_status', 'text,uuid[],text,text'],
  ['admin_inbox_delete', 'text,uuid[]'], ['admin_inbox_purge', 'text,text[],integer,boolean'],
  ['admin_people_search', 'text,integer,boolean'], ['admin_set_person_test_flag', 'uuid[],boolean'],
  ['admin_cleanup_preview', 'uuid[]'], ['admin_cleanup_purge_people', 'uuid[],text,boolean'],
  ['admin_cleanup_junk_events', 'text,integer,text[],boolean']
];
for (const [fn, args] of ADMIN) {
  const g = (await q(`select has_function_privilege('anon','public.${fn}(${args})','execute') a, has_function_privilege('authenticated','public.${fn}(${args})','execute') u,
     (select count(*)::int from pg_proc where proname='${fn}') n`))[0];
  ok(`${fn}: anon no, authenticated yes, one version`, g.a === false && g.u === true && g.n === 1);
}
for (const fn of ['submit_lead', 'submit_feedback']) {
  const g = (await q(`select has_function_privilege('anon','public.${fn}(jsonb)','execute') a, has_function_privilege('authenticated','public.${fn}(jsonb)','execute') u`))[0];
  ok(`${fn}: callable by anon and authenticated`, g.a && g.u);
}
const anonFns = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') and (p.proname like 'submit\\_%' or p.proname like 'admin\\_%' or p.proname like 'cleanup\\_%')`);
ok('of the new functions only the two submit functions are callable by anon', anonFns.map((r) => r.proname).sort().join() === 'submit_feedback,submit_lead', anonFns.map((r) => r.proname).join());
const priv = await q(`select p.proname, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and (p.proname like 'inbox\\_%' or p.proname like 'cleanup\\_%')`);
ok('five private helpers exist and are closed to browsers', priv.length === 5 && priv.every((r) => !r.a && !r.u), JSON.stringify(priv));
for (const t of ['leads', 'feedback_submissions']) {
  const g = (await q(`select has_table_privilege('anon','public.${t}','select,insert,update,delete,truncate,references,trigger') a_all,
    (select count(*)::int from information_schema.role_table_grants where table_schema='public' and table_name='${t}' and grantee in ('anon','authenticated','PUBLIC')) n,
    (select relrowsecurity from pg_class where oid='public.${t}'::regclass) rls,
    (select count(*)::int from pg_policies where tablename='${t}') pol`))[0];
  ok(`${t}: row level security on, no policy, no grant for anon or authenticated`, g.rls && g.pol === 0 && g.n === 0 && !g.a_all);
  for (const priv of ['select', 'insert', 'update', 'delete']) {
    const p = (await q(`select has_table_privilege('authenticated','public.${t}','${priv}') u`))[0].u;
    if (p) ok(`${t}: authenticated has no ${priv}`, false);
  }
}
const colTest = (await q(`select has_column_privilege('authenticated','public.leads','email','select') c`))[0].c;
ok('no column privilege on leads for authenticated', colTest === false);
ok('people.is_test exists, boolean, default false', (await q(`select data_type, column_default from information_schema.columns where table_name='people' and column_name='is_test'`))[0].column_default === 'false');

// Direct table access is closed to browsers.
for (const [role, sub, who] of [['anon', null, 'anon'], ['authenticated', MEMBER, 'member'], ['authenticated', OWNER, 'owner']]) {
  await rejectsAs(`${who} cannot read leads`, role, sub, `select * from leads`, '42501');
  await rejectsAs(`${who} cannot read feedback_submissions`, role, sub, `select * from feedback_submissions`, '42501');
  await rejectsAs(`${who} cannot insert into leads`, role, sub, `insert into leads (kind, email) values ('gate','x@y.com')`, '42501');
  await rejectsAs(`${who} cannot insert into feedback_submissions`, role, sub, `insert into feedback_submissions (description) values ('x')`, '42501');
  await rejectsAs(`${who} cannot delete leads`, role, sub, `delete from leads`, '42501');
}

// Every admin function is refused for anon, a plain member and a staff member without the platform_owner role.
const adminCalls = {
  admin_inbox_list: `public.admin_inbox_list('leads')`,
  admin_inbox_set_status: `public.admin_inbox_set_status('leads', array[]::uuid[], 'reviewed')`,
  admin_inbox_delete: `public.admin_inbox_delete('leads', array[]::uuid[])`,
  admin_inbox_purge: `public.admin_inbox_purge('leads', array['spam'], 30)`,
  admin_people_search: `public.admin_people_search('a')`,
  admin_set_person_test_flag: `public.admin_set_person_test_flag(array[]::uuid[], true)`,
  admin_cleanup_preview: `public.admin_cleanup_preview(null)`,
  admin_cleanup_purge_people: `public.admin_cleanup_purge_people(array['${T1}']::uuid[], 'DELETE')`,
  admin_cleanup_junk_events: `public.admin_cleanup_junk_events('stability', 30)`
};
for (const [fn, call_] of Object.entries(adminCalls)) {
  await rejectsAs(`${fn}: anon refused`, 'anon', null, `select ${call_}`, '42501');
  await rejectsAs(`${fn}: plain member refused`, 'authenticated', MEMBER, `select ${call_}`, '42501');
  await rejectsAs(`${fn}: customer_support refused`, 'authenticated', SUPPORT, `select ${call_}`, '42501');
  await rejectsAs(`${fn}: signed in with an unknown token refused`, 'authenticated', 'fb_nobody', `select ${call_}`, '42501');
}
await rejectsAs('anon cannot call submit-like admin by sneaking a role claim', 'anon', 'fb_owner', `select ${adminCalls.admin_inbox_list}`, '42501');

// ============================================================ submit_lead
await reset();
let r = await submitLead(lead({ name: '  Ada Lovelace ', email: '  ADA@Acme.ORG ', role: 'CTO', message: 'Hello there', kind: 'result', score: 72.5, band: 'Strong', variationId: 'v3', assessmentType: 'es', page: 'https://theuntaughtlessons.com/apps/x', source: 'result-gate' }));
ok('anon can submit a lead: exactly { ok: true }', JSON.stringify(r) === '{"ok":true}', JSON.stringify(r));
let row = await lastLead();
ok('lead stored cleaned: trimmed, lowercased email, aliases mapped', row.name === 'Ada Lovelace' && row.email === 'ada@acme.org' && row.kind === 'result' && Number(row.score) === 72.5 && row.band === 'Strong' && row.variation_id === 'v3' && row.assessment_type === 'es' && row.role === 'CTO' && row.source === 'result-gate');
ok('lead status new, not test, no spam reason, no person, not handled', row.status === 'new' && row.is_test === false && row.spam_reason === '' && row.person_id === null && row.handled_at === null && row.handled_by_person_id === null);
ok('payload holds no copy of the columns (no name, email, message, score...), only extras', Object.keys(row.payload).every((k) => ['form_started_at', 'honeypot_filled'].includes(k)) && !JSON.stringify(row.payload).includes('Ada') && !JSON.stringify(row.payload).includes('acme.org'), JSON.stringify(row.payload));
r = await submitLead(lead({ email: 'b1@acme.org' }));
ok('kind defaults to gate', (await lastLead()).kind === 'gate' && r.ok === true);
r = await submitLead(lead({ email: 'b2@acme.org', kind: 'RESULT' }));
ok('kind is case insensitive', r.ok === true && (await lastLead()).kind === 'result');

// invalid input
const before = await n1(`select count(*) n from leads`);
const bad = [
  ['null', 'null::jsonb'], ['array', `'[]'::jsonb`], ['string', `'"x"'::jsonb`], ['number', `'5'::jsonb`], ['empty object', `'{}'::jsonb`],
  ['no email', j({ name: 'x' })], ['email empty', j({ email: '' })], ['email spaces', j({ email: '   ' })], ['email without at', j({ email: 'abc' })],
  ['email without dot', j({ email: 'a@b' })], ['email with space', j({ email: 'a b@c.com' })], ['email no local', j({ email: '@b.com' })],
  ['email two at', j({ email: 'a@@b.com' })], ['email short tld', j({ email: 'a@b.c' })], ['email object', j({ email: { a: 1 } })],
  ['email number', j({ email: 123 })], ['email too long', j({ email: 'a'.repeat(250) + '@b.com' })], ['unknown kind', j(lead({ kind: 'weird' }))],
  ['kind object', j(lead({ kind: { a: 1 } }))]
];
for (const [name, lit] of bad) {
  let res; try { res = await anon(`public.submit_lead(${lit})`); } catch (e) { res = { threw: e.message }; }
  ok(`invalid lead (${name}) returns { ok:false, error:'invalid' }`, res && res.ok === false && res.error === 'invalid' && Object.keys(res).length === 2, JSON.stringify(res));
}
ok('invalid leads stored nothing', (await n1(`select count(*) n from leads`)) === before);
const echo = await submitLead({ email: 'echo-me-not', name: 'Secret Name' });
ok('an invalid response does not echo input', !JSON.stringify(echo).includes('Secret') && !JSON.stringify(echo).includes('echo-me-not'));
const okEcho = await submitLead(lead({ email: 'echo2@acme.org', name: 'Secret Name' }));
ok('a valid response contains nothing but ok', Object.keys(okEcho).join() === 'ok');

// unknown keys, clamping and cleaning
r = await submitLead(lead({ email: 'keys@acme.org', evil: 'x', status: 'reviewed', is_test: false, person_id: MEMBER_ID, id: U(999), handled_at: '2020-01-01', note: 'n', created_at: '2000-01-01', spam_reason: 'zzz' }));
row = await lastLead();
ok('unknown and internal keys are ignored', r.ok && row.status === 'new' && row.person_id === null && row.id !== U(999) && row.note === '' && row.spam_reason === '' && new Date(row.created_at).getFullYear() >= 2026 && row.handled_at === null);
ok('payload has no unknown keys', !('evil' in row.payload) && !('status' in row.payload) && !('person_id' in row.payload) && !('note' in row.payload));
r = await submitLead(lead({ email: 'clamp@acme.org', name: 'n'.repeat(500), role: 'r'.repeat(500), message: 'm'.repeat(6000), band: 'b'.repeat(300), variation_id: 'v'.repeat(300), assessment_type: 'a'.repeat(300), page: 'p'.repeat(1000), source: 's'.repeat(1000) }));
row = await lastLead();
ok('every text length is clamped', r.ok && row.name.length === 200 && row.role.length === 200 && row.message.length === 5000 && row.band.length === 80 && row.variation_id.length === 120 && row.assessment_type.length === 80 && row.page.length === 500 && row.source.length === 200);
ok('payload stays under its size limit', JSON.stringify(row.payload).length < 20000);
r = await submitLead(lead({ email: 'score1@acme.org', score: 5000 })); ok('score out of range becomes null', r.ok && (await lastLead()).score === null);
r = await submitLead(lead({ email: 'score2@acme.org', score: '74.5' })); ok('score as text is accepted', r.ok && Number((await lastLead()).score) === 74.5);
r = await submitLead(lead({ email: 'score3@acme.org', score: 'abc' })); ok('score garbage becomes null', r.ok && (await lastLead()).score === null);
r = await submitLead(lead({ email: 'score4@acme.org', score: -3 })); ok('negative score becomes null', r.ok && (await lastLead()).score === null);
r = await submitLead(lead({ email: 'ctl@acme.org', name: 'A\u0001B\u0007C', message: 'line1\nline2\ttabx' }));
row = await lastLead();
ok('control characters are removed, line breaks kept', r.ok && row.name === 'ABC' && row.message === 'line1\nline2\ttabx', JSON.stringify([row.name, row.message]));
r = await submitLead(lead({ email: 'obj@acme.org', name: { a: 1 }, message: [1, 2] }));
ok('non text values for text fields become empty, not an error', r.ok && (await lastLead()).name === '' && (await lastLead()).message === '');
const huge = await anon(`public.submit_lead(${j(lead({ email: 'huge@acme.org', pad: 'x'.repeat(120000) }))})`);
ok('an oversized request is invalid and stores nothing', huge.ok === false && huge.error === 'invalid' && (await n1(`select count(*) n from leads where email='huge@acme.org'`)) === 0);
const deepJ = await anon(`public.submit_lead(${j(lead({ email: 'deep@acme.org', message: 'ok', extra: { a: { b: { c: [1, 2, 3] } } } }))})`);
ok('nested unknown values are ignored without error', deepJ.ok === true);

// honeypot
await reset();
r = await submitLead(lead({ email: 'hp1@acme.org', website: 'http://spam.example' })); row = await lastLead();
ok('honeypot filled -> spam / honeypot', r.ok === true && row.status === 'spam' && row.spam_reason === 'honeypot');
r = await submitLead(lead({ email: 'hp2@acme.org', website: '' })); ok('empty honeypot is fine', (await lastLead()).status === 'new');
r = await submitLead(lead({ email: 'hp3@acme.org', website: '   ' })); ok('blank honeypot is fine', (await lastLead()).status === 'new');
r = await submitLead(lead({ email: 'hp4@acme.org', website: null })); ok('null honeypot is fine', (await lastLead()).status === 'new');
r = await submitLead(lead({ email: 'hp5@acme.org', website: 1 })); ok('a non text honeypot value is spam', (await lastLead()).spam_reason === 'honeypot');
// links
r = await submitLead(lead({ email: 'l1@acme.org', message: 'see http://a.com and https://b.com and http://c.com' })); row = await lastLead();
ok('three links -> spam / links', r.ok && row.status === 'spam' && row.spam_reason === 'links');
r = await submitLead(lead({ email: 'l2@acme.org', message: 'see http://a.com and https://b.com' })); ok('two links are fine', (await lastLead()).status === 'new');
r = await submitLead(lead({ email: 'l3@acme.org', message: 'HTTP://A.COM HTTP://B.COM Http://c.com' })); ok('links are counted case insensitively', (await lastLead()).spam_reason === 'links');
r = await submitLead(lead({ email: 'l4@acme.org', message: 'no links here' })); ok('no links is fine', (await lastLead()).status === 'new');
// test classification
const testCases = [
  ['a@example.com', true], ['a@example.org', true], ['a@example.net', true], ['a@test.com', true], ['A@EXAMPLE.COM', true],
  ['a@example.test', true], ['test@gmail.com', true], ['test1@gmail.com', true], ['test042@gmail.com', true], ['Test@Gmail.com', true],
  ['bob+test@gmail.com', true], ['bob+test2@gmail.com', true], ['bob+test+news@gmail.com', true], ['bob@sub.example.com', true],
  ['testing@gmail.com', false], ['tester@gmail.com', false], ['testimony@gmail.com', false], ['test.user@gmail.com', false], ['test-a@gmail.com', false],
  ['bob+tester@gmail.com', false], ['bob@mytest.com', false], ['bob@gmail.com', false], ['contest@gmail.com', false], ['bob@example.com.au', false],
  ['bob@notexample.com', false]
];
for (const [em, expect] of testCases) {
  await submitLead(lead({ email: em })); row = await lastLead();
  ok(`email ${em} ${expect ? 'is' : 'is not'} a test row`, row.is_test === expect && row.status === (expect ? 'test' : 'new'), `${row.status}/${row.is_test}`);
}
await submitLead(lead({ email: 'pg1@acme.org', page: 'http://localhost:8080/x' })); row = await lastLead();
ok('page with localhost is a test row', row.is_test === true && row.status === 'test');
await submitLead(lead({ email: 'pg2@acme.org', page: 'http://127.0.0.1:5500/x' })); row = await lastLead();
ok('page with 127.0.0.1 is a test row', row.is_test === true && row.status === 'test');
await submitLead(lead({ email: 'pg3@acme.org', page: 'https://theuntaughtlessons.com/x' })); row = await lastLead();
ok('a live page is not a test row', row.is_test === false);
await submitLead(lead({ email: 'combo@example.com', website: 'x' })); row = await lastLead();
ok('spam and test together: status spam, is_test true', row.status === 'spam' && row.spam_reason === 'honeypot' && row.is_test === true);
// too fast
const ms = () => Date.now();
r = await submitLead(lead({ email: 'f1@acme.org', form_started_at: ms() - 300 })); row = await lastLead();
ok('form started 0.3 s ago -> spam / too-fast', r.ok && row.status === 'spam' && row.spam_reason === 'too-fast');
r = await submitLead(lead({ email: 'f2@acme.org', formStartedAt: ms() - 300 })); ok('camelCase alias works for form_started_at', (await lastLead()).spam_reason === 'too-fast');
r = await submitLead(lead({ email: 'f3@acme.org', form_started_at: ms() - 6000 })); ok('form started 6 s ago is fine', (await lastLead()).status === 'new');
r = await submitLead(lead({ email: 'f4@acme.org', form_started_at: String(ms() - 200) })); ok('form_started_at as text works', (await lastLead()).spam_reason === 'too-fast');
r = await submitLead(lead({ email: 'f5@acme.org', form_started_at: ms() + 3600000 })); ok('a start time in the future is ignored (client clock ahead)', (await lastLead()).status === 'new');
r = await submitLead(lead({ email: 'f6@acme.org', form_started_at: 'later' })); ok('garbage start time is ignored', r.ok && (await lastLead()).status === 'new');
r = await submitLead(lead({ email: 'f7@acme.org' })); ok('no start time is fine', (await lastLead()).status === 'new');
r = await submitLead(lead({ email: 'f8@acme.org', form_started_at: 0 })); ok('a zero start time is ignored', (await lastLead()).status === 'new');
r = await submitLead(lead({ email: 'f9@acme.org', form_started_at: ms() - 300, website: 'x', message: 'http http http' })); ok('honeypot wins over links and too-fast', (await lastLead()).spam_reason === 'honeypot');

// person_id only with a token
await reset();
await submitLead(lead({ email: 'p1@acme.org' })); ok('anon: person_id stays null', (await lastLead()).person_id === null);
r = await submitLead(lead({ email: 'p2@acme.org', person_id: MEMBER_ID }), null); ok('anon cannot set person_id by sending it', (await lastLead()).person_id === null);
r = await submitLead(lead({ email: 'p3@acme.org', person_id: REAL_ID }), MEMBER); row = await lastLead();
ok('a valid token sets person_id from the token, not from the input', r.ok && row.person_id === MEMBER_ID);
await submitLead(lead({ email: 'p4@acme.org' }), 'fb_nobody'); ok('a token for nobody leaves person_id null', (await lastLead()).person_id === null);
await db.exec(`update people set account_status='archived' where id='${REAL_ID}'`);
await submitLead(lead({ email: 'p5@acme.org' }), 'fb_real'); ok('an archived person does not get person_id', (await lastLead()).person_id === null);
await db.exec(`update people set account_status='active' where id='${REAL_ID}'`);

// rate limits
await reset();
for (let i = 0; i < 10; i++) { r = await submitLead(lead({ email: 'rate@acme.org' })); if (!r.ok) ok(`rate: submission ${i + 1} should pass`, false); }
ok('ten submissions per email pass', (await n1(`select count(*) n from leads where email='rate@acme.org'`)) === 10);
r = await submitLead(lead({ email: 'rate@acme.org' }));
ok('the eleventh is rate-limited and nothing is stored', r.ok === false && r.error === 'rate-limited' && Object.keys(r).length === 2 && (await n1(`select count(*) n from leads where email='rate@acme.org'`)) === 10);
r = await submitLead(lead({ email: ' RATE@acme.org ' })); ok('the limit is on the normalized email', r.error === 'rate-limited');
r = await submitLead(lead({ email: 'other-rate@acme.org' })); ok('another email still passes', r.ok === true);
r = await submitLead(lead({ email: 'rate@acme.org', website: 'x' })); ok('spam counts against the limit too', r.error === 'rate-limited');
await db.exec(`update leads set created_at = now() - interval '25 hours' where email='rate@acme.org'`);
r = await submitLead(lead({ email: 'rate@acme.org' })); ok('rows older than 24 hours do not count', r.ok === true);
await reset();
for (let i = 0; i < 10; i++) await submitLead(lead({ email: `pr${i}@acme.org` }), MEMBER);
r = await submitLead(lead({ email: 'pr-other@acme.org' }), MEMBER);
ok('a signed in person is limited to ten a day across emails', r.error === 'rate-limited');
r = await submitLead(lead({ email: 'pr-other@acme.org' })); ok('an anonymous caller with that email is not affected', r.ok === true);
await reset();
await db.exec(`insert into leads (kind, email, created_at) select 'gate', 'bulk' || g || '@acme.org', now() from generate_series(1, 300) g`);
r = await submitLead(lead({ email: 'fresh@acme.org' }));
ok('300 rows in the last minute -> rate-limited overall, nothing stored', r.error === 'rate-limited' && (await n1(`select count(*) n from leads where email='fresh@acme.org'`)) === 0);
await db.exec(`update leads set created_at = now() - interval '2 minutes'`);
r = await submitLead(lead({ email: 'fresh@acme.org' })); ok('after a minute the overall limit lifts', r.ok === true);
await reset();
await db.exec(`insert into leads (kind, email, created_at) select 'gate', 'bulk' || g || '@acme.org', now() from generate_series(1, 299) g`);
r = await submitLead(lead({ email: 'edge1@acme.org' })); ok('299 in the last minute: the 300th still passes', r.ok === true);
r = await submitLead(lead({ email: 'edge2@acme.org' })); ok('and the next one is limited', r.error === 'rate-limited');
await reset();

// ---- spam does not use up the normal limits; hourly and daily caps; the spam flood cap
await reset();
await db.exec(`insert into leads (kind, email, status, spam_reason, created_at) select 'gate', 'sp' || g || '@acme.org', 'spam', 'honeypot', now() - interval '2 hours' from generate_series(1, 400) g`);
r = await submitLead(lead({ email: 'afterspam@acme.org' }));
ok('old spam rows do not block a normal submission', r.ok === true && (await lastLead()).status === 'new');
await reset();
await db.exec(`insert into leads (kind, email, status, spam_reason, created_at) select 'gate', 'sp' || g || '@acme.org', 'spam', 'honeypot', now() from generate_series(1, 99) g`);
r = await submitLead(lead({ email: 'spam99@acme.org', website: 'bot' }));
ok('99 spam rows in the last hour: another spam row is still stored', r.ok === true && (await n1(`select count(*) n from leads where status='spam'`)) === 100);
const spamBefore = await n1(`select count(*) n from leads`);
r = await submitLead(lead({ email: 'spam100@acme.org', website: 'bot' }));
ok('100 spam rows in the last hour: more spam is dropped, the sender still sees ok:true', JSON.stringify(r) === '{"ok":true}' && (await n1(`select count(*) n from leads`)) === spamBefore);
r = await submitLead(lead({ email: 'real-during-flood@acme.org' }));
ok('during a spam flood a real lead is still stored', r.ok === true && (await lastLead()).email === 'real-during-flood@acme.org' && (await lastLead()).status === 'new');
r = await submitLead(lead({ email: 'links-during-flood@acme.org', message: 'http http http' }));
ok('other spam kinds are dropped too during a flood', r.ok === true && (await n1(`select count(*) n from leads where email='links-during-flood@acme.org'`)) === 0);
await db.exec(`update leads set created_at = now() - interval '90 minutes' where status = 'spam'`);
r = await submitLead(lead({ email: 'spam-later@acme.org', website: 'bot' }));
ok('spam older than an hour does not count toward the flood cap', (await n1(`select count(*) n from leads where email='spam-later@acme.org'`)) === 1);
await reset();
await db.exec(`insert into leads (kind, email, status, created_at) select 'gate', 'h' || g || '@acme.org', 'new', now() - interval '10 minutes' from generate_series(1, 599) g`);
r = await submitLead(lead({ email: 'hour1@acme.org' })); ok('599 normal rows in the last hour: the 600th passes', r.ok === true);
r = await submitLead(lead({ email: 'hour2@acme.org' }));
ok('600 normal rows in the last hour: rate-limited, nothing stored', r.ok === false && r.error === 'rate-limited' && (await n1(`select count(*) n from leads where email='hour2@acme.org'`)) === 0);
r = await submitLead(lead({ email: 'hour3@acme.org', website: 'bot' }));
ok('the hourly cap counts normal rows only: spam is still taken', r.ok === true && (await n1(`select count(*) n from leads where email='hour3@acme.org'`)) === 1);
await db.exec(`update leads set created_at = now() - interval '2 hours' where email like 'h%@acme.org' and status='new'`);
r = await submitLead(lead({ email: 'hour4@acme.org' })); ok('rows older than an hour leave the hourly cap', r.ok === true);
await reset();
await db.exec(`insert into leads (kind, email, status, created_at) select 'gate', 'd' || g || '@acme.org', 'new', now() - interval '5 hours' - g * interval '1 second' from generate_series(1, 2999) g`);
r = await submitLead(lead({ email: 'day1@acme.org' })); ok('2999 normal rows in the last day: the 3000th passes', r.ok === true);
r = await submitLead(lead({ email: 'day2@acme.org' }));
ok('3000 normal rows in the last day: rate-limited, nothing stored', r.error === 'rate-limited' && (await n1(`select count(*) n from leads where email='day2@acme.org'`)) === 0);
await db.exec(`update leads set created_at = now() - interval '30 hours' where email like 'd%@acme.org'`);
r = await submitLead(lead({ email: 'day3@acme.org' })); ok('rows older than a day leave the daily cap', r.ok === true);
await reset();
await db.exec(`insert into leads (kind, email, status, spam_reason, created_at) select 'gate', 'm' || g || '@acme.org', 'spam', 'honeypot', now() from generate_series(1, 300) g`);
r = await submitLead(lead({ email: 'minute-spam@acme.org' }));
ok('300 spam rows in the last minute do not trigger the per minute limit', r.ok === true);
await reset();

// payload holds extras only
r = await submitLead(lead({ email: 'pay1@acme.org', name: 'Pat Payload', message: 'Secret message', form_started_at: ms() - 5000, band: 'High', score: 80 })); row = await lastLead();
ok('payload keeps form_started_at and nothing that a column holds', r.ok && typeof row.payload.form_started_at === 'number' && Object.keys(row.payload).join() === 'form_started_at' && !JSON.stringify(row.payload).includes('Pat') && !JSON.stringify(row.payload).includes('Secret'), JSON.stringify(row.payload));
r = await submitLead(lead({ email: 'pay2@acme.org', website: 'http://bad.example/long' })); row = await lastLead();
ok('payload records that the honeypot was filled but not what was typed', row.payload.honeypot_filled === true && !JSON.stringify(row.payload).includes('bad.example'));
r = await submitLead(lead({ email: 'pay3@acme.org', message: 'm'.repeat(5000), name: 'n'.repeat(200) })); row = await lastLead();
ok('a maximal lead has a tiny payload', JSON.stringify(row.payload).length < 100);

// the per email check can use the index
const fnsrc = (await q(`select proname, prosrc from pg_proc where proname in ('submit_lead','submit_feedback')`));
ok('both submit functions compare the email with the citext operator', fnsrc.length === 2 && fnsrc.every((f) => /operator\(extensions\.=\)/.test(f.prosrc) && !/email::text\s*=/.test(f.prosrc)));
await db.exec(`insert into leads (kind, email, created_at) select 'gate', 'idx' || g || '@acme.org', now() from generate_series(1, 50) g; analyze leads; set enable_seqscan = off; set search_path = '';`);
const plan = (await q(`explain select count(*) from public.leads where email operator(extensions.=) 'x@acme.org'::extensions.citext and created_at > now() - interval '24 hours'`)).map((x) => x['QUERY PLAN']).join(' ');
await db.exec(`reset enable_seqscan; set search_path = public, extensions;`);
ok('the per email query plan uses the (email, created_at) index when the search_path is empty', /leads_email_created_idx/.test(plan), plan);
await db.exec(`set enable_seqscan = off; set search_path = '';`);
const plan2 = (await q(`explain select count(*) from public.leads where email::text = 'x@acme.org' and created_at > now() - interval '24 hours'`)).map((x) => x['QUERY PLAN']).join(' ');
await db.exec(`reset enable_seqscan; set search_path = public, extensions;`);
ok('for contrast, the old text comparison could not use that index', !/leads_email_created_idx/.test(plan2), plan2);
await reset();

// no backslash anywhere in the migrations or rollbacks (the apply tool mangles them)
{
  const { readdirSync, readFileSync } = await import('fs');
  const base = new URL('./', import.meta.url).pathname;
  const files = [...readdirSync(base + 'migrations').filter((f) => /^2026100[0-9]/.test(f) || true).map((f) => 'migrations/' + f), ...readdirSync(base + 'rollbacks').map((f) => 'rollbacks/' + f)]
    .filter((f) => /20261008002(17|18)0/.test(f));
  ok('the checked files are the 2170 and 2180 migrations and rollbacks', files.length === 4, files.join());
  for (const f of files) {
    const text = readFileSync(base + f, 'utf8');
    const line = text.split('\n').findIndex((l) => l.includes(String.fromCharCode(92)));
    ok(`${f}: contains no backslash`, line === -1, `line ${line + 1}`);
  }
}
// the sanitiser keeps ordinary text, including the letters x and digits that a mangled escape would strip
ok('private.inbox_text leaves "Max Wood" unchanged', (await q(`select private.inbox_text('{"a":"Max Wood"}'::jsonb, 'a', 50) v`))[0].v === 'Max Wood');
ok('private.inbox_text keeps x, X, 0, 1, 8, B, C, E, F and 7 characters', (await q(`select private.inbox_text('{"a":"x X 0 1 8 B C E F 7 xx01 08 0B 0C 0E 1F 7F"}'::jsonb, 'a', 80) v`))[0].v === 'x X 0 1 8 B C E F 7 xx01 08 0B 0C 0E 1F 7F');
ok('private.inbox_text strips control characters 1-8, 11, 12, 14-31 and 127 but keeps tab, line feed and carriage return', (await q(`select private.inbox_text(jsonb_build_object('a', 'a' || chr(1) || chr(8) || chr(11) || chr(12) || chr(14) || chr(31) || chr(127) || 'b' || chr(9) || 'c' || chr(10) || 'd' || chr(13) || 'e'), 'a', 50) v`))[0].v === 'ab\tc\nd\re');
r = await submitLead(lead({ email: 'maxwood@acme.org', name: 'Max Wood', role: 'Exec Xavier', message: 'Max Wood wrote 0x7F and x01 ok' })); row = await lastLead();
ok('a lead from Max Wood is stored unchanged', r.ok && row.name === 'Max Wood' && row.role === 'Exec Xavier' && row.message === 'Max Wood wrote 0x7F and x01 ok', JSON.stringify([row.name, row.role, row.message]));
await reset();

// ============================================================ submit_feedback
r = await submitFb({ name: ' Fay ', email: 'FAY@acme.org ', pageUrl: 'https://theuntaughtlessons.com/portal/', feedbackType: 'bug', description: '  Button broken  ', activityId: 'p1-e1' });
row = await lastFb();
ok('anon can submit feedback: exactly { ok: true }', JSON.stringify(r) === '{"ok":true}');
ok('feedback stored cleaned with aliases mapped', row.name === 'Fay' && row.email === 'fay@acme.org' && row.page_url.endsWith('/portal/') && row.feedback_type === 'bug' && row.description === 'Button broken' && row.activity_id === 'p1-e1');
ok('feedback defaults', row.status === 'new' && row.is_test === false && row.person_id === null && row.spam_reason === '' && !('description' in row.payload) && !('email' in row.payload));
r = await submitFb({ description: 'no email at all' }); row = await lastFb();
ok('email is optional for feedback', r.ok && row.email === '' && row.activity_id === null);
r = await submitFb({ description: 'bad email', email: 'not-an-email' }); row = await lastFb();
ok('a malformed feedback email is dropped, the feedback is kept', r.ok && row.email === '');
for (const [name, lit] of [['null', 'null::jsonb'], ['array', `'[]'::jsonb`], ['string', `'"x"'::jsonb`], ['empty object', `'{}'::jsonb`], ['empty description', j({ description: '' })],
  ['blank description', j({ description: '   \n ' })], ['description object', j({ description: { a: 1 } })], ['only control chars', j({ description: '\u0001\u0002' })], ['description null', j({ description: null })]]) {
  let res; try { res = await anon(`public.submit_feedback(${lit})`); } catch (e) { res = { threw: e.message }; }
  ok(`invalid feedback (${name})`, res && res.ok === false && res.error === 'invalid' && Object.keys(res).length === 2, JSON.stringify(res));
}
const fbBefore = await n1(`select count(*) n from feedback_submissions`);
const hugeFb = await anon(`public.submit_feedback(${j({ description: 'x', pad: 'x'.repeat(120000) })})`);
ok('oversized feedback is invalid', hugeFb.error === 'invalid' && (await n1(`select count(*) n from feedback_submissions`)) === fbBefore);
r = await submitFb({ description: 'd'.repeat(9000), name: 'n'.repeat(400), pageUrl: 'p'.repeat(900), feedbackType: 't'.repeat(200), activityId: 'a'.repeat(400), email: 'clampfb@acme.org' }); row = await lastFb();
ok('feedback lengths are clamped', r.ok && row.description.length === 5000 && row.name.length === 200 && row.page_url.length === 500 && row.feedback_type.length === 80 && row.activity_id.length === 120);
r = await submitFb({ description: 'x', email: 'unk@acme.org', status: 'reviewed', person_id: MEMBER_ID, is_test: true, evil: 1 }); row = await lastFb();
ok('feedback ignores unknown and internal keys', r.ok && row.status === 'new' && row.person_id === null && row.is_test === false && !('evil' in row.payload));
r = await submitFb({ description: 'a http://a b http://b c http://c', email: 'lk@acme.org' }); ok('feedback with three links is spam', (await lastFb()).spam_reason === 'links');
r = await submitFb({ description: 'a http://a b http://b', email: 'lk2@acme.org' }); ok('feedback with two links is fine', (await lastFb()).status === 'new');
r = await submitFb({ description: 'hello', email: 'hp@acme.org', website: 'bot' }); ok('feedback honeypot', (await lastFb()).spam_reason === 'honeypot');
r = await submitFb({ description: 'hello', email: 'ff@acme.org', form_started_at: ms() - 100 }); ok('feedback too fast', (await lastFb()).spam_reason === 'too-fast');
r = await submitFb({ description: 'hello', email: 'ff2@acme.org', form_started_at: ms() - 9000 }); ok('feedback slow enough', (await lastFb()).status === 'new');
r = await submitFb({ description: 'hello', email: 'x@example.com' }); row = await lastFb(); ok('feedback from example.com is a test row', row.is_test && row.status === 'test');
r = await submitFb({ description: 'hello', email: 'x2@acme.org', page_url: 'http://localhost:3000/a' }); row = await lastFb(); ok('feedback from localhost is a test row', row.is_test && row.status === 'test');
r = await submitFb({ description: 'hello', email: 'test@acme.org' }); ok('feedback with the local part test is a test row', (await lastFb()).is_test);
r = await submitFb({ description: 'hello', email: 'tester@acme.org' }); ok('feedback from tester@ is a real person', (await lastFb()).is_test === false);
r = await submitFb({ description: 'hello', email: 'testimony@acme.org' }); ok('feedback from testimony@ is a real person', (await lastFb()).is_test === false);
r = await submitFb({ description: 'hello', email: 'x3+test@acme.org' }); ok('feedback with +test is a test row', (await lastFb()).is_test);
r = await submitFb({ description: 'hello', email: 'combo@example.com', website: 'x' }); row = await lastFb(); ok('feedback spam and test together', row.status === 'spam' && row.is_test);
r = await submitFb({ description: 'signed', email: 'tok@acme.org' }, MEMBER); ok('feedback person_id comes from the token', (await lastFb()).person_id === MEMBER_ID);
r = await submitFb({ description: 'signed', person_id: REAL_ID }, MEMBER); ok('feedback person_id cannot be chosen', (await lastFb()).person_id === MEMBER_ID);
await submitFb({ description: 'anon', email: 'an@acme.org' }); ok('feedback person_id is null without a token', (await lastFb()).person_id === null);
await reset();
for (let i = 0; i < 10; i++) await submitFb({ description: 'same', email: 'fbrate@acme.org' });
r = await submitFb({ description: 'same', email: 'fbrate@acme.org' });
ok('feedback: eleventh for one email is rate-limited, nothing stored', r.error === 'rate-limited' && (await n1(`select count(*) n from feedback_submissions where email='fbrate@acme.org'`)) === 10);
for (let i = 0; i < 12; i++) r = await submitFb({ description: 'no email ' + i });
ok('feedback without an email has no per email limit', r.ok === true);
await reset();
for (let i = 0; i < 10; i++) await submitFb({ description: 'mine' }, MEMBER);
r = await submitFb({ description: 'mine' }, MEMBER); ok('feedback: ten a day per signed in person', r.error === 'rate-limited');
await reset();
await db.exec(`insert into feedback_submissions (description, created_at) select 'bulk', now() from generate_series(1, 300) g`);
r = await submitFb({ description: 'late', email: 'late@acme.org' }); ok('feedback: 300 in the last minute -> rate-limited', r.error === 'rate-limited');
await db.exec(`update feedback_submissions set created_at = now() - interval '3 minutes'`);
r = await submitFb({ description: 'late', email: 'late@acme.org' }); ok('feedback: limit lifts after a minute', r.ok === true);
await reset();
await db.exec(`insert into feedback_submissions (description, status, spam_reason, created_at) select 'junk', 'spam', 'honeypot', now() from generate_series(1, 100) g`);
const fbBefore2 = await n1(`select count(*) n from feedback_submissions`);
r = await submitFb({ description: 'bot text', email: 'fl1@acme.org', website: 'bot' });
ok('feedback: 100 spam rows in the last hour -> more spam dropped, sender sees ok:true', JSON.stringify(r) === '{"ok":true}' && (await n1(`select count(*) n from feedback_submissions`)) === fbBefore2);
r = await submitFb({ description: 'a real one', email: 'fl2@acme.org' });
ok('feedback: a real one still stored during a flood', r.ok && (await lastFb()).description === 'a real one');
r = await submitFb({ description: 'x', email: 'fl3@acme.org', website: 'bot' }); await db.exec(`update feedback_submissions set created_at = now() - interval '2 hours' where status = 'spam'`);
r = await submitFb({ description: 'later spam', email: 'fl4@acme.org', website: 'bot' });
ok('feedback: old spam does not count toward the flood cap', (await n1(`select count(*) n from feedback_submissions where description='later spam'`)) === 1);
await reset();
await db.exec(`insert into feedback_submissions (description, status, spam_reason, created_at) select 'junk', 'spam', 'honeypot', now() from generate_series(1, 400) g`);
await db.exec(`update feedback_submissions set created_at = now() - interval '2 hours'`);
r = await submitFb({ description: 'normal', email: 'fl5@acme.org' }); ok('feedback: spam never blocks normal feedback', r.ok === true);
await reset();
await db.exec(`insert into feedback_submissions (description, status, created_at) select 'n', 'new', now() - interval '10 minutes' from generate_series(1, 599) g`);
r = await submitFb({ description: 'h1', email: 'fh1@acme.org' }); ok('feedback: 599 in the last hour, the 600th passes', r.ok === true);
r = await submitFb({ description: 'h2', email: 'fh2@acme.org' }); ok('feedback: 600 in the last hour -> rate-limited', r.error === 'rate-limited' && (await n1(`select count(*) n from feedback_submissions where description='h2'`)) === 0);
await reset();
await db.exec(`insert into feedback_submissions (description, status, created_at) select 'n', 'new', now() - interval '5 hours' - g * interval '1 second' from generate_series(1, 3000) g`);
r = await submitFb({ description: 'd1', email: 'fd1@acme.org' }); ok('feedback: 3000 in the last day -> rate-limited', r.error === 'rate-limited');
await db.exec(`update feedback_submissions set created_at = now() - interval '30 hours'`);
r = await submitFb({ description: 'd2', email: 'fd2@acme.org' }); ok('feedback: older rows leave the daily cap', r.ok === true);
await reset();
await db.exec(`insert into feedback_submissions (description, status, spam_reason, created_at) select 'junk', 'spam', 'honeypot', now() from generate_series(1, 99) g`);
await db.exec(`update feedback_submissions set created_at = now() - interval '30 minutes'`);
r = await submitFb({ description: 'minute', email: 'fm1@acme.org' }); ok('feedback: spam rows do not count toward the per minute limit', r.ok === true);
await reset();
r = await submitFb({ description: 'Max Wood said so', name: 'Max Wood', email: 'maxfb@acme.org', form_started_at: ms() - 5000 }); row = await lastFb();
ok('feedback: "Max Wood" is stored unchanged', row.name === 'Max Wood' && row.description === 'Max Wood said so');
ok('feedback: payload holds extras only', Object.keys(row.payload).join() === 'form_started_at' && !JSON.stringify(row.payload).includes('Max'));
await reset();

// ============================================================ staff: list, status, delete, purge
const ago = (d) => `now() - interval '${d} days'`;
const insLead = (id, email, status, days, extra = {}) => `insert into leads (id, kind, name, email, message, status, is_test, spam_reason, created_at) values
  ('${id}', 'gate', '${extra.name || 'Name ' + id.slice(-4)}', '${email}', '${extra.message || 'msg'}', '${status}', ${extra.test ? 'true' : 'false'}, '${status === 'spam' ? 'honeypot' : ''}', ${ago(days)});`;
const L = (n) => `a0000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
await db.exec([
  insLead(L(1), 'one@acme.org', 'new', 1, { name: 'Ann Alpha', message: 'wants a demo' }),
  insLead(L(2), 'two@acme.org', 'reviewed', 2, { name: 'Bob Beta' }),
  insLead(L(3), 'three@acme.org', 'contacted', 3, { name: 'Cy Gamma', message: '100% sure_thing' }),
  insLead(L(4), 'four@acme.org', 'archived', 40),
  insLead(L(5), 'five@acme.org', 'spam', 5),
  insLead(L(6), 'six@example.com', 'test', 6, { test: true }),
  insLead(L(7), 'seven@acme.org', 'spam', 60, { test: true }),
  insLead(L(8), 'eight@acme.org', 'new', 0.5, { name: 'Dee Delta' }),
  insLead(L(9), 'nine@acme.org', 'archived', 90),
  insLead(L(10), 'ten@example.com', 'test', 70, { test: true })
].join('\n'));
let res = await call(OWNER, `public.admin_inbox_list('leads')`);
const ids = (x) => x.rows.map((r_) => r_.id);
ok('list: default hides spam and test, shows new, reviewed, contacted, archived', res.total === 6 && ids(res).every((i) => ![L(5), L(6), L(7), L(10)].includes(i)), ids(res).join());
ok('list: newest first', JSON.stringify(ids(res)) === JSON.stringify([L(8), L(1), L(2), L(3), L(4), L(9)]), ids(res).join());
ok('list: rows carry the expected fields and no payload', ['id', 'kind', 'name', 'email', 'message', 'status', 'is_test', 'created_at', 'note', 'person_id'].every((k) => k in res.rows[0]) && !('payload' in res.rows[0]));
ok('list: counts per status, all six keys, test rule applied', JSON.stringify(res.counts) === JSON.stringify({ archived: 2, contacted: 1, new: 2, reviewed: 1, spam: 1, test: 2 }) || (res.counts.new === 2 && res.counts.reviewed === 1 && res.counts.contacted === 1 && res.counts.archived === 2 && res.counts.test === 2 && res.counts.spam === 1), JSON.stringify(res.counts));
res = await call(OWNER, `public.admin_inbox_list('leads', 'spam')`);
ok('list: spam shown when asked, test rows hidden', res.total === 1 && ids(res)[0] === L(5), ids(res).join());
res = await call(OWNER, `public.admin_inbox_list('leads', 'spam', null, true)`);
ok('list: spam with include_test also shows test spam', res.total === 2);
res = await call(OWNER, `public.admin_inbox_list('leads', 'test')`);
ok('list: status test shows test rows without include_test', res.total === 2);
res = await call(OWNER, `public.admin_inbox_list('leads', null, null, true)`);
ok('list: include_test adds test rows but still not spam', res.total === 8 && !ids(res).includes(L(5)) && !ids(res).includes(L(7)));
res = await call(OWNER, `public.admin_inbox_list('leads', 'new')`);
ok('list: status filter', res.total === 2 && res.rows.every((x) => x.status === 'new'));
res = await call(OWNER, `public.admin_inbox_list('leads', '')`);
ok('list: empty status means no filter', res.total === 6);
res = await call(OWNER, `public.admin_inbox_list('leads', null, 'ALPHA')`);
ok('list: search by name, case insensitive', res.total === 1 && ids(res)[0] === L(1));
res = await call(OWNER, `public.admin_inbox_list('leads', null, 'two@acme')`);
ok('list: search by email', res.total === 1 && ids(res)[0] === L(2));
res = await call(OWNER, `public.admin_inbox_list('leads', null, 'a demo')`);
ok('list: search by message', res.total === 1 && ids(res)[0] === L(1));
res = await call(OWNER, `public.admin_inbox_list('leads', null, '100%')`);
ok('list: percent in a search is literal', res.total === 1 && ids(res)[0] === L(3));
res = await call(OWNER, `public.admin_inbox_list('leads', null, 'sure_thing')`);
ok('list: underscore in a search is literal', res.total === 1);
res = await call(OWNER, `public.admin_inbox_list('leads', null, 'sure-thing')`);
ok('list: an underscore does not match a dash', res.total === 0);
await db.exec(`update leads set message = 'wow! really' where id = '${L(2)}'`);
res = await call(OWNER, `public.admin_inbox_list('leads', null, '!')`);
ok('list: an exclamation mark in a search is literal', res.total === 1 && ids(res)[0] === L(2), String(res.total));
res = await call(OWNER, `public.admin_inbox_list('leads', null, 'wow!')`);
ok('list: search with the escape character in it', res.total === 1);
await db.exec(`update leads set message = 'msg' where id = '${L(2)}'`);
res = await call(OWNER, `public.admin_inbox_list('leads', null, '%')`);
ok('list: a lone percent matches only literal percent signs', res.total === 1);
res = await call(OWNER, `public.admin_inbox_list('leads', null, '${"x'; drop table leads; --".replace(/'/g, "''")}')`);
ok('list: a hostile search string is just text', res.total === 0 && (await n1(`select count(*) n from leads`)) === 10);
res = await call(OWNER, `public.admin_inbox_list('leads', null, null, false, 2, 0)`);
const p1 = ids(res);
res = await call(OWNER, `public.admin_inbox_list('leads', null, null, false, 2, 2)`);
const p2 = ids(res);
res = await call(OWNER, `public.admin_inbox_list('leads', null, null, false, 2, 4)`);
const p3 = ids(res);
ok('list: pagination pages are disjoint, ordered, total stays 6', p1.length === 2 && p2.length === 2 && p3.length === 2 && new Set([...p1, ...p2, ...p3]).size === 6 && res.total === 6 && p1[0] === L(8));
res = await call(OWNER, `public.admin_inbox_list('leads', null, null, false, 2, 100)`);
ok('list: offset past the end gives no rows but the total', res.rows.length === 0 && res.total === 6);
res = await call(OWNER, `public.admin_inbox_list('leads', null, null, false, 0, 0)`);
ok('list: limit below 1 is clamped to 1', res.rows.length === 1);
res = await call(OWNER, `public.admin_inbox_list('leads', null, null, false, -5, -5)`);
ok('list: negative limit and offset are clamped', res.rows.length === 1 && ids(res)[0] === L(8));
await db.exec(`insert into leads (kind, email, status, created_at) select 'gate', 'many' || g || '@acme.org', 'new', now() - interval '200 days' - g * interval '1 minute' from generate_series(1, 230) g`);
res = await call(OWNER, `public.admin_inbox_list('leads', null, null, false, 1000, 0)`);
ok('list: limit is clamped to 200', res.rows.length === 200 && res.total === 236);
res = await call(OWNER, `public.admin_inbox_list('leads', null, null, false, null, null)`);
ok('list: null limit and offset use the defaults', res.rows.length === 50);
await db.exec(`delete from leads where email like 'many%'`);
await rejectsAs('list: unknown kind -> 22023', 'authenticated', OWNER, `select public.admin_inbox_list('people')`, '22023');
await rejectsAs('list: unknown status -> 22023', 'authenticated', OWNER, `select public.admin_inbox_list('leads', 'nope')`, '22023');
await rejectsAs('list: null kind -> 22023', 'authenticated', OWNER, `select public.admin_inbox_list(null)`, '22023');

// feedback list
await db.exec(`insert into feedback_submissions (id, name, email, description, status, is_test, created_at, person_id) values
  ('b0000000-0000-0000-0000-000000000001','Fay','fay@acme.org','login is slow','new', false, ${ago(1)}, '${MEMBER_ID}'),
  ('b0000000-0000-0000-0000-000000000002','','','typo on page','spam', false, ${ago(2)}, null),
  ('b0000000-0000-0000-0000-000000000003','T','t@example.com','testing','test', true, ${ago(3)}, null),
  ('b0000000-0000-0000-0000-000000000004','Gus','gus@acme.org','love it','reviewed', false, ${ago(4)}, null)`);
res = await call(OWNER, `public.admin_inbox_list('feedback')`);
ok('feedback list: default hides spam and test', res.total === 2 && res.rows[0].description === 'login is slow' && res.rows[0].person_id === MEMBER_ID && !('payload' in res.rows[0]));
res = await call(OWNER, `public.admin_inbox_list('feedback', null, 'LOVE')`);
ok('feedback list: search in description', res.total === 1);
res = await call(OWNER, `public.admin_inbox_list('feedback', 'spam')`);
ok('feedback list: spam filter', res.total === 1);
res = await call(OWNER, `public.admin_inbox_list('feedback', null, null, true)`);
ok('feedback list: include_test', res.total === 3);
ok('feedback list: counts', res.counts.new === 1 && res.counts.test === 1 && res.counts.reviewed === 1 && res.counts.spam === 1 && res.counts.archived === 0);

// status updates
res = await call(OWNER, `public.admin_inbox_set_status('leads', ${arr([L(1), L(2)])}, 'contacted', 'called her')`);
ok('set_status: returns updated count', res.updated === 2 && Object.keys(res).join() === 'updated');
row = (await q(`select * from leads where id='${L(1)}'`))[0];
ok('set_status: status, note, handled_by and handled_at set', row.status === 'contacted' && row.note === 'called her' && row.handled_by_person_id === OWNER_ID && row.handled_at !== null);
await call(OWNER, `public.admin_inbox_set_status('leads', ${arr([L(1)])}, 'reviewed')`);
row = (await q(`select * from leads where id='${L(1)}'`))[0];
ok('set_status: an empty note keeps the old note', row.note === 'called her' && row.status === 'reviewed');
await call(OWNER, `public.admin_inbox_set_status('leads', ${arr([L(1)])}, 'new')`);
row = (await q(`select * from leads where id='${L(1)}'`))[0];
ok('set_status: back to new clears who handled it', row.status === 'new' && row.handled_by_person_id === null && row.handled_at === null);
await call(OWNER, `public.admin_inbox_set_status('leads', ${arr([L(3)])}, 'spam')`);
row = (await q(`select * from leads where id='${L(3)}'`))[0];
ok('set_status: manual spam records the reason manual', row.status === 'spam' && row.spam_reason === 'manual');
await call(OWNER, `public.admin_inbox_set_status('leads', ${arr([L(5)])}, 'spam')`);
ok('set_status: spam keeps an existing reason', (await q(`select spam_reason from leads where id='${L(5)}'`))[0].spam_reason === 'honeypot');
await call(OWNER, `public.admin_inbox_set_status('leads', ${arr([L(5)])}, 'new')`);
row = (await q(`select * from leads where id='${L(5)}'`))[0];
ok('set_status: leaving spam clears the reason', row.status === 'new' && row.spam_reason === '');
await call(OWNER, `public.admin_inbox_set_status('leads', ${arr([L(4)])}, 'test')`);
ok('set_status: moving to test sets is_test', (await q(`select is_test from leads where id='${L(4)}'`))[0].is_test === true);
await call(OWNER, `public.admin_inbox_set_status('leads', ${arr([L(4)])}, 'new')`);
ok('set_status: moving a test row out of test clears is_test', (await q(`select is_test from leads where id='${L(4)}'`))[0].is_test === false);
await call(OWNER, `public.admin_inbox_set_status('feedback', ${arr(['b0000000-0000-0000-0000-000000000002'])}, 'archived', 'ok')`);
row = (await q(`select * from feedback_submissions where id='b0000000-0000-0000-0000-000000000002'`))[0];
ok('set_status: works for feedback', row.status === 'archived' && row.note === 'ok' && row.spam_reason === '' && row.handled_by_person_id === OWNER_ID);
ok('set_status: ids that do not exist update nothing', (await call(OWNER, `public.admin_inbox_set_status('leads', ${arr([U(777)])}, 'new')`)).updated === 0);
ok('set_status: empty or null ids update nothing', (await call(OWNER, `public.admin_inbox_set_status('leads', array[]::uuid[], 'new')`)).updated === 0 && (await call(OWNER, `public.admin_inbox_set_status('leads', null, 'new')`)).updated === 0);
await call(OWNER, `public.admin_inbox_set_status('leads', ${arr([L(2)])}, 'archived', '${'z'.repeat(3000)}')`);
ok('set_status: a long note is clamped', (await q(`select length(note) l from leads where id='${L(2)}'`))[0].l === 2000);
await rejectsAs('set_status: unknown status -> 22023', 'authenticated', OWNER, `select public.admin_inbox_set_status('leads', ${arr([L(1)])}, 'bogus')`, '22023');
await rejectsAs('set_status: null status -> 22023', 'authenticated', OWNER, `select public.admin_inbox_set_status('leads', ${arr([L(1)])}, null)`, '22023');
await rejectsAs('set_status: unknown kind -> 22023', 'authenticated', OWNER, `select public.admin_inbox_set_status('x', ${arr([L(1)])}, 'new')`, '22023');
await rejectsAs('set_status: more than 500 ids -> 22023', 'authenticated', OWNER, `select public.admin_inbox_set_status('leads', (select array_agg(gen_random_uuid()) from generate_series(1, 501)), 'new')`, '22023');

// delete
const auditBefore = await n1(`select count(*) n from audit_events where action = 'inbox.delete'`);
res = await call(OWNER, `public.admin_inbox_delete('leads', ${arr([L(9), L(10), U(777)])})`);
ok('delete: removes the existing rows and counts them', res.deleted === 2 && Object.keys(res).join() === 'deleted' && (await n1(`select count(*) n from leads where id in ('${L(9)}','${L(10)}')`)) === 0);
let aud = (await q(`select * from audit_events where action = 'inbox.delete' order by id desc limit 1`))[0];
ok('delete: writes one audit row with counts only', (await n1(`select count(*) n from audit_events where action = 'inbox.delete'`)) === auditBefore + 1 && aud.actor_person_id === OWNER_ID && aud.detail.deleted === 2 && aud.detail.requested === 3 && !/@|acme|Name/i.test(JSON.stringify(aud)));
ok('delete: feedback works', (await call(OWNER, `public.admin_inbox_delete('feedback', ${arr(['b0000000-0000-0000-0000-000000000004'])})`)).deleted === 1);
ok('delete: empty ids delete nothing', (await call(OWNER, `public.admin_inbox_delete('leads', array[]::uuid[])`)).deleted === 0);
await rejectsAs('delete: more than 500 ids -> 22023', 'authenticated', OWNER, `select public.admin_inbox_delete('leads', (select array_agg(gen_random_uuid()) from generate_series(1, 501)))`, '22023');
await rejectsAs('delete: unknown kind -> 22023', 'authenticated', OWNER, `select public.admin_inbox_delete('nope', ${arr([L(1)])})`, '22023');
ok('delete: 500 ids is allowed', (await call(OWNER, `public.admin_inbox_delete('leads', (select array_agg(gen_random_uuid()) from generate_series(1, 500)))`)).deleted === 0);

// purge
await reset();
await db.exec([
  insLead(L(21), 'p1@acme.org', 'spam', 40), insLead(L(22), 'p2@acme.org', 'spam', 5), insLead(L(23), 'p3@example.com', 'test', 45, { test: true }),
  insLead(L(24), 'p4@acme.org', 'archived', 100), insLead(L(25), 'p5@acme.org', 'new', 400), insLead(L(26), 'p6@acme.org', 'reviewed', 400)
].join('\n'));
res = await call(OWNER, `public.admin_inbox_purge('leads', array['spam','test','archived'], 30)`);
ok('purge: dry run is the default and deletes nothing', res.matched === 3 && res.deleted === 0 && (await n1(`select count(*) n from leads`)) === 6);
ok('purge: a dry run writes no audit row', (await n1(`select count(*) n from audit_events where action = 'inbox.purge'`)) === 0);
res = await call(OWNER, `public.admin_inbox_purge('leads', array['spam'], 30, true)`);
ok('purge: dry run honours statuses and age', res.matched === 1 && res.deleted === 0);
res = await call(OWNER, `public.admin_inbox_purge('leads', array['spam','test','archived'], 30, false)`);
ok('purge: real run deletes only matching rows', res.matched === 3 && res.deleted === 3 && (await n1(`select count(*) n from leads`)) === 3 && (await n1(`select count(*) n from leads where status in ('new','reviewed')`)) === 2);
aud = (await q(`select * from audit_events where action = 'inbox.purge' order by id desc limit 1`))[0];
ok('purge: one audit row with counts only', !!aud && aud.detail.deleted === 3 && aud.detail.matched === 3 && aud.actor_person_id === OWNER_ID && !/@|acme/i.test(JSON.stringify(aud)));
res = await call(OWNER, `public.admin_inbox_purge('leads', array['spam'], 0, false)`);
ok('purge: zero days is allowed and takes everything of that status up to now', res.deleted === 1);
await rejectsAs('purge: status new is refused', 'authenticated', OWNER, `select public.admin_inbox_purge('leads', array['new'], 30, false)`, '22023');
await rejectsAs('purge: status reviewed mixed in is refused', 'authenticated', OWNER, `select public.admin_inbox_purge('leads', array['spam','reviewed'], 30, false)`, '22023');
await rejectsAs('purge: contacted is refused', 'authenticated', OWNER, `select public.admin_inbox_purge('leads', array['contacted'], 30)`, '22023');
await rejectsAs('purge: empty statuses refused', 'authenticated', OWNER, `select public.admin_inbox_purge('leads', array[]::text[], 30)`, '22023');
await rejectsAs('purge: null statuses refused', 'authenticated', OWNER, `select public.admin_inbox_purge('leads', null, 30)`, '22023');
await rejectsAs('purge: negative days refused', 'authenticated', OWNER, `select public.admin_inbox_purge('leads', array['spam'], -1)`, '22023');
await rejectsAs('purge: null days refused', 'authenticated', OWNER, `select public.admin_inbox_purge('leads', array['spam'], null)`, '22023');
await rejectsAs('purge: unknown kind refused', 'authenticated', OWNER, `select public.admin_inbox_purge('x', array['spam'], 1)`, '22023');
ok('purge: nothing real was touched by refused calls', (await n1(`select count(*) n from leads where status in ('new','reviewed')`)) === 2);
await db.exec(`insert into feedback_submissions (description, status, created_at) values ('a','spam',${ago(50)}),('b','archived',${ago(50)}),('c','new',${ago(50)})`);
res = await call(OWNER, `public.admin_inbox_purge('feedback', array['spam','archived'], 10, false)`);
ok('purge: works on feedback', res.deleted === 2 && (await n1(`select count(*) n from feedback_submissions`)) === 1);

// ============================================================ people search and the test flag
await db.exec(`
 insert into people (id, auth_uid, primary_email, display_name, first_name, last_name, is_test, created_at, last_activity_at) values
  ('${T1}','fb_t1','tester.one@example.com','Tess One', '', '', true, now() - interval '5 days', now() - interval '1 day'),
  ('${T2}','fb_t2','tester.two@example.com','', 'Tom', 'Two', true, now() - interval '4 days', null),
  ('${T3}','fb_t3','tester.three@example.com','Tina Three', '', '', true, now() - interval '3 days', null);
 insert into people (id, auth_uid, primary_email, display_name) values ('${U(105)}','fb_u5','under_score@acme.org','Under Score'),('${U(106)}','fb_u6','underxscore@acme.org','Other');
`);
let ppl = await call(OWNER, `public.admin_people_search('tess')`);
ok('people search by display name', ppl.length === 1 && ppl[0].id === T1 && ppl[0].email === 'tester.one@example.com' && ppl[0].is_test === true && ppl[0].last_activity_at !== null);
ok('people search rows have the promised keys', ['id', 'display_name', 'email', 'is_test', 'created_at', 'last_activity_at'].every((k) => k in ppl[0]));
ppl = await call(OWNER, `public.admin_people_search('tom')`);
ok('people search by first name, display name falls back to first and last', ppl.length === 1 && ppl[0].display_name === 'Tom Two');
ppl = await call(OWNER, `public.admin_people_search('three@EXAMPLE')`);
ok('people search by email, case insensitive', ppl.length === 1 && ppl[0].id === T3);
ppl = await call(OWNER, `public.admin_people_search('${T2}')`);
ok('people search by id', ppl.length === 1 && ppl[0].id === T2);
await db.exec(`insert into people (id, auth_uid, primary_email, display_name) values ('${U(107)}','fb_u7','fifty@acme.org','50% Off_Co'),('${U(108)}','fb_u8','bang@acme.org','Wow! Person')`);
const allPeople = await q(`select id, display_name, first_name, last_name, primary_email::text email from people`);
const hits = (ch) => allPeople.filter((x) => [x.display_name, x.first_name, x.last_name, x.email].some((v) => v.includes(ch))).map((x) => x.id).sort().join();
for (const ch of ['%', '_', '!']) {
  ppl = await call(OWNER, `public.admin_people_search('${ch}', 100)`);
  ok(`people search for "${ch}" matches only literal ones`, ppl.map((x) => x.id).sort().join() === hits(ch) && ppl.length >= 1 && ppl.length < allPeople.length, `${ppl.length} of ${allPeople.length}`);
}
ppl = await call(OWNER, `public.admin_people_search('Max Wood')`);
ok('people search for a plain name with x and d in it works', Array.isArray(ppl));
ppl = await call(OWNER, `public.admin_people_search('under_score')`);
ok('people search treats underscore literally', ppl.length === 1 && ppl[0].email === 'under_score@acme.org');
ppl = await call(OWNER, `public.admin_people_search('', 3)`);
ok('empty query lists the newest, limit respected', ppl.length === 3);
ppl = await call(OWNER, `public.admin_people_search(null, 1000)`);
ok('limit is clamped to 100 and null query works', ppl.length <= 100 && ppl.length >= 8);
ppl = await call(OWNER, `public.admin_people_search('', 0)`);
ok('limit below 1 is clamped to 1', ppl.length === 1);
ppl = await call(OWNER, `public.admin_people_search('', 50, true)`);
ok('only_test lists flagged people', ppl.length === 3 && ppl.every((x) => x.is_test));
ppl = await call(OWNER, `public.admin_people_search('owner')`);
ok('is_staff and is_self flags', ppl.length === 1 && ppl[0].is_staff === true && ppl[0].is_self === true);
ppl = await call(OWNER, `public.admin_people_search('support@')`);
ok('a customer_support holder counts as staff, not self', ppl[0].is_staff === true && ppl[0].is_self === false);
ppl = await call(OWNER, `public.admin_people_search('mia')`);
ok('a plain member is neither', ppl[0].is_staff === false && ppl[0].is_self === false);
ppl = await call(OWNER, `public.admin_people_search('zzz-nobody')`);
ok('no match gives an empty list', Array.isArray(ppl) && ppl.length === 0);

// flag
await db.exec(`update people set is_test = false where id in ('${T1}','${T2}','${T3}')`);
res = await call(OWNER, `public.admin_set_person_test_flag(${arr([T1, T2, T1])}, true)`);
ok('flag: sets the flag, counts changed rows once', res.updated === 2 && (await n1(`select count(*) n from people where is_test`)) === 2);
res = await call(OWNER, `public.admin_set_person_test_flag(${arr([T1, T2])}, true)`);
ok('flag: flagging again changes nothing', res.updated === 0);
res = await call(OWNER, `public.admin_set_person_test_flag(${arr([T3])}, true)`);
ok('flag: third person', res.updated === 1);
const flagsBefore = await n1(`select count(*) n from people where is_test`);
await rejectsAs('flag: refuses a platform_owner', 'authenticated', OWNER, `select public.admin_set_person_test_flag(${arr([REAL_ID, OWNER_ID])}, true)`, '22023');
await rejectsAs('flag: refuses a customer_support holder', 'authenticated', OWNER, `select public.admin_set_person_test_flag(${arr([SUPPORT_ID])}, true)`, '22023');
await rejectsAs('flag: refuses the caller', 'authenticated', OWNER, `select public.admin_set_person_test_flag(${arr([OWNER_ID])}, true)`, '22023');
ok('flag: a refused call changes nothing for anybody in the list', (await n1(`select count(*) n from people where is_test`)) === flagsBefore && (await n1(`select count(*) n from people where id='${REAL_ID}' and is_test`)) === 0);
await db.exec(`insert into role_grants (person_id, scope_type, role, status, ended_at) values ('${MEMBER_ID}','platform','read_only_analyst','suspended', now())`);
await rejectsAs('flag: refuses a person with an ended platform grant too', 'authenticated', OWNER, `select public.admin_set_person_test_flag(${arr([MEMBER_ID])}, true)`, '22023');
await db.exec(`delete from role_grants where person_id='${MEMBER_ID}'`);
await rejectsAs('flag: null flag -> 22023', 'authenticated', OWNER, `select public.admin_set_person_test_flag(${arr([REAL_ID])}, null)`, '22023');
ok('flag: empty list updates nothing', (await call(OWNER, `public.admin_set_person_test_flag(array[]::uuid[], true)`)).updated === 0);
res = await call(OWNER, `public.admin_set_person_test_flag(${arr([T3])}, false)`);
ok('flag: can be cleared', res.updated === 1 && (await n1(`select count(*) n from people where id='${T3}' and is_test`)) === 0);
await call(OWNER, `public.admin_set_person_test_flag(${arr([T3])}, true)`);
aud = await q(`select * from audit_events where action = 'cleanup.set_test_flag'`);
ok('flag: audited with counts only', aud.length >= 3 && aud.every((a) => !/@|example|Tess/i.test(JSON.stringify(a))));
await rejectsAs('flag: a member cannot flag', 'authenticated', MEMBER, `select public.admin_set_person_test_flag(${arr([T1])}, true)`, '42501');

// ============================================================ data for every table
const A = (n) => `c0000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
await db.exec(`
 insert into organizations (id, slug, name) values ('${A(1)}','acme','Acme') on conflict do nothing;
 insert into activities (id, program_id, kind, title, module_key) values ('p1-e1','tsa','exercise','Grocery','phase-1'),('p1-e2','tsa','exercise','Two','phase-1') on conflict do nothing;
 insert into assessment_versions (id, assessment_id, version, scoring_version, content_version) values ('${A(2)}','tsa-diagnostic','v-test','s1','c1') on conflict do nothing;
`);
let seq = 0;
const seed = (P, tag) => {
  const k = ++seq;
  const hex = (n) => n.toString(16).padStart(2, '0').repeat(32);
  return `
 insert into person_emails (person_id, email) values ('${P}','${tag}-alt@example.com');
 insert into person_profiles (person_id) values ('${P}');
 insert into affiliations (id, person_id, organization_id, started_on, created_by) values ('${A(10 + k)}','${P}','${A(1)}','2026-01-01', '${P}');
 insert into enrollments (id, person_id, program_id, status, affiliation_id) values ('${A(20 + k)}','${P}','tsa','active','${A(10 + k)}');
 insert into entitlements (id, person_id, program_id, access_type, status) values ('${A(30 + k)}','${P}','tsa','free','active');
 insert into consent_events (person_id, type, notice_version, granted) values ('${P}','marketing','v1',true);
 insert into role_grants (person_id, scope_type, organization_id, role, granted_by) values ('${P}','organization','${A(1)}','report_viewer','${P}');
 insert into credentials (credential_code, person_id, program_id, enrollment_id, title, recipient_name) values ('CRED-${tag}-${k}000','${P}','tsa','${A(20 + k)}','Certificate','${tag} Person');
 insert into activity_submissions (id, person_id, activity_id, program_id, enrollment_id, submission_key, completed_at) values ('${A(40 + k)}','${P}','p1-e1','tsa','${A(20 + k)}','sub-${tag}', now());
 insert into activity_attempts (person_id, activity_id, program_id, submission_id, attempt_key, score, score_maximum, submitted_at) values ('${P}','p1-e1','tsa','${A(40 + k)}','attempt-${tag}-1',3,5, now());
 insert into activity_progress (person_id, activity_id, program_id, enrollment_id, status, completed_at, completion_count, latest_submission_id) values ('${P}','p1-e1','tsa','${A(20 + k)}','completed', now(), 1, '${A(40 + k)}');
 insert into activity_drafts (person_id, activity_id) values ('${P}','p1-e2');
 insert into learning_profile_evidence (person_id, evidence_key, evidence_source, recorded_at) values ('${P}','evidence-${tag}-1','self_report', now());
 insert into learning_profile_summaries (person_id) values ('${P}');
 insert into reward_ledger (person_id, program_id, entry_key, points) values ('${P}','tsa','entry-${tag}',10);
 insert into reward_state (person_id, program_id) values ('${P}','tsa');
 insert into engagement_sessions (person_id, kind, session_key) values ('${P}','session','session-${tag}-1');
 insert into stability_events (person_id, event_key, event_type, severity, occurred_at) values ('${P}','stab-${tag}-1','javascript_error','error', now());
 insert into audit_events (actor_person_id, action, subject_type, subject_id, person_id) values ('${P}','test.action','person','${P}','${P}'), ('${OWNER_ID}','test.about','person','${P}', null);
 insert into assessment_attempts (id, person_id, program_id, assessment_id, version_id, entitlement_id, enrollment_id, idempotency_hash) values ('${A(50 + k)}','${P}','tsa','tsa-diagnostic','${A(2)}','${A(30 + k)}','${A(20 + k)}','${hex(k)}');
 insert into assessment_response_parts (attempt_id, part_number, part_count, answers, response_checksum) values ('${A(50 + k)}',1,1,'[]','${hex(k + 100)}');
 insert into assessment_scoring_comparisons (attempt_id) values ('${A(50 + k)}');
 insert into stripe_processed_sessions (session_id, program_id, email, person_id) values ('cs_${tag}_${k}','tsa','${tag}@example.com','${P}');
 insert into leads (kind, email, person_id, handled_by_person_id) values ('gate','lead-${tag}@acme.org','${P}', '${P}');
 insert into feedback_submissions (description, person_id) values ('fb ${tag}','${P}');
`;
};
await db.exec(seed(T1, 't1') + seed(T2, 't2') + seed(T3, 't3') + seed(REAL_ID, 'real'));
// rows by someone else that name T1 as author, to prove they are kept and cleared
await db.exec(`
 insert into duplicate_candidates (person_a, person_b, resolved_by) values ('${REAL_ID}','${T1}','${T1}');
 update app_settings set updated_by = '${T1}' where key = 'feedback';
 insert into access_requests (email, full_name, decided_by, status) values ('req@acme.org','Req','${T1}','approved');
 insert into role_grants (person_id, scope_type, organization_id, role, granted_by) values ('${MEMBER_ID}','organization','${A(1)}','report_viewer','${T1}');
 insert into affiliations (person_id, organization_id, started_on, created_by) values ('${MEMBER_ID}','${A(1)}','2026-02-01','${T1}');
 update leads set handled_by_person_id = '${T1}' where email = 'lead-real@acme.org';
`);

// preview
const TABLES = ['audit_events', 'stability_events', 'engagement_sessions', 'reward_state', 'reward_ledger', 'learning_profile_summaries', 'learning_profile_evidence',
  'activity_progress', 'activity_drafts', 'activity_attempts', 'activity_submissions', 'credentials', 'assessment_scoring_comparisons', 'assessment_response_parts',
  'assessment_attempts', 'entitlements', 'consent_events', 'enrollments', 'role_grants', 'person_profiles', 'person_emails', 'affiliations', 'duplicate_candidates',
  'stripe_processed_sessions', 'leads', 'feedback_submissions', 'people'];
let pv = await call(OWNER, `public.admin_cleanup_preview(${arr([T1])})`);
ok('preview: selected, limit and blocked present', pv.selected === 1 && pv.max_per_purge === 100 && pv.blocked.not_found === 0 && pv.blocked.not_test === 0 && pv.blocked.platform_role === 0 && pv.blocked.caller === 0 && pv.blocked.has_payments === 1, JSON.stringify(pv.blocked));
ok('preview: a count for every table', JSON.stringify(Object.keys(pv.counts).sort()) === JSON.stringify([...TABLES].sort()), Object.keys(pv.counts).join());
ok('preview: every table has at least one row for the seeded person', TABLES.every((t) => pv.counts[t] >= 1), JSON.stringify(Object.entries(pv.counts).filter(([, v]) => v < 1)));
ok('preview: audit_events counts the row about the person and the one naming the person as subject', pv.counts.audit_events === 2 && pv.counts.people === 1 && pv.counts.duplicate_candidates === 1);
pv = await call(OWNER, `public.admin_cleanup_preview(null)`);
ok('preview: null means everyone flagged as test', pv.selected === 3 && pv.counts.people === 3 && pv.counts.reward_ledger === 3);
pv = await call(OWNER, `public.admin_cleanup_preview(${arr([T1, REAL_ID, OWNER_ID, U(888)])})`);
ok('preview: blocked counts for a non test person, staff, the caller and a missing id', pv.blocked.not_test === 2 && pv.blocked.platform_role === 1 && pv.blocked.caller === 1 && pv.blocked.not_found === 1 && pv.blocked.has_payments === 2, JSON.stringify(pv.blocked));
pv = await call(OWNER, `public.admin_cleanup_preview(array[]::uuid[])`);
ok('preview: an empty list selects nobody', pv.selected === 0 && pv.counts.people === 0);
const writes = await n1(`select (select count(*) from people) + (select count(*) from reward_ledger) n`);
ok('preview deletes nothing', writes === (await n1(`select (select count(*) from people) + (select count(*) from reward_ledger) n`)));

// ============================================================ purge refusals (nothing deleted)
const snapshot = async () => JSON.stringify(await Promise.all(TABLES.map(async (t) => [t, await n1(`select count(*) n from ${t}`)])));
const snap0 = await snapshot();
await rejectsAs('purge people: wrong confirmation "delete"', 'authenticated', OWNER, `select public.admin_cleanup_purge_people(${arr([T1])}, 'delete')`, '22023');
await rejectsAs('purge people: empty confirmation', 'authenticated', OWNER, `select public.admin_cleanup_purge_people(${arr([T1])}, '')`, '22023');
await rejectsAs('purge people: null confirmation', 'authenticated', OWNER, `select public.admin_cleanup_purge_people(${arr([T1])}, null)`, '22023');
await rejectsAs('purge people: confirmation with spaces', 'authenticated', OWNER, `select public.admin_cleanup_purge_people(${arr([T1])}, ' DELETE ')`, '22023');
await rejectsAs('purge people: empty list', 'authenticated', OWNER, `select public.admin_cleanup_purge_people(array[]::uuid[], 'DELETE')`, '22023');
await rejectsAs('purge people: null list', 'authenticated', OWNER, `select public.admin_cleanup_purge_people(null, 'DELETE')`, '22023');
await rejectsAs('purge people: refuses a person who is not flagged', 'authenticated', OWNER, `select public.admin_cleanup_purge_people(${arr([REAL_ID])}, 'DELETE')`, '22023');
await rejectsAs('purge people: one unflagged person in the list refuses the whole call', 'authenticated', OWNER, `select public.admin_cleanup_purge_people(${arr([T1, REAL_ID])}, 'DELETE')`, '22023');
await rejectsAs('purge people: refuses the caller', 'authenticated', OWNER, `select public.admin_cleanup_purge_people(${arr([OWNER_ID])}, 'DELETE')`, '22023');
await db.exec(`update people set is_test = true where id in ('${OWNER_ID}','${SUPPORT_ID}')`);
await rejectsAs('purge people: refuses the caller even when flagged by hand', 'authenticated', OWNER, `select public.admin_cleanup_purge_people(${arr([OWNER_ID])}, 'DELETE')`, '22023');
await rejectsAs('purge people: refuses a flagged person with a platform role', 'authenticated', OWNER, `select public.admin_cleanup_purge_people(${arr([T1, SUPPORT_ID])}, 'DELETE')`, '22023');
await db.exec(`update people set is_test = false where id in ('${OWNER_ID}','${SUPPORT_ID}')`);
await rejectsAs('purge people: refuses an id that does not exist', 'authenticated', OWNER, `select public.admin_cleanup_purge_people(${arr([T1, U(888)])}, 'DELETE')`, '22023');
await rejectsAs('purge people: more than 100 people', 'authenticated', OWNER, `select public.admin_cleanup_purge_people((select array_agg(gen_random_uuid()) from generate_series(1, 101)), 'DELETE')`, '22023');
try { await as('authenticated', OWNER, `select public.admin_cleanup_purge_people((select array_agg(gen_random_uuid()) from generate_series(1, 101)), 'DELETE')`); }
catch (e) { ok('purge people: the limit message names the limit', /100/.test(e.message)); }
await rejectsAs('purge people: a member is refused', 'authenticated', MEMBER, `select public.admin_cleanup_purge_people(${arr([T1])}, 'DELETE')`, '42501');
ok('refused purges deleted nothing at all', (await snapshot()) === snap0);
ok('no purge audit row after refusals', (await n1(`select count(*) n from audit_events where action = 'cleanup.purge_people'`)) === 0);
// ---- payments: a purge never deletes money data unless it is told to
const P4 = U(204), P5 = U(205), P6 = U(206);
await db.exec(`
 insert into people (id, auth_uid, primary_email, display_name, is_test) values
  ('${P4}','fb_p4','p4@example.com','Pay Four', true), ('${P5}','fb_p5','p5@example.com','Pay Five', true), ('${P6}','fb_p6','p6@example.com','Pay Six', true);
 insert into reward_ledger (person_id, program_id, entry_key, points) values ('${P4}','tsa','p4-entry',5);
 insert into stripe_processed_sessions (session_id, program_id, email, person_id) values ('cs_p5','tsa','p5@example.com','${P5}');
 insert into entitlements (person_id, program_id, access_type, status) values ('${P6}','tsa','free','active');
`);
pv = await call(OWNER, `public.admin_cleanup_preview(${arr([P4, P5, P6])})`);
ok('preview: blocked.has_payments counts people with a stripe session or an entitlement', pv.blocked.has_payments === 2 && pv.counts.stripe_processed_sessions === 1 && pv.counts.entitlements === 1, JSON.stringify(pv.blocked));
ok('preview: a person without either has none', (await call(OWNER, `public.admin_cleanup_preview(${arr([P4])})`)).blocked.has_payments === 0);
const snapPay = await snapshot();
await rejectsAs('purge: a person with a stripe session is refused by default', 'authenticated', OWNER, `select public.admin_cleanup_purge_people(${arr([P5])}, 'DELETE')`, '22023');
await rejectsAs('purge: a person with an entitlement is refused by default', 'authenticated', OWNER, `select public.admin_cleanup_purge_people(${arr([P6])}, 'DELETE')`, '22023');
await rejectsAs('purge: p_allow_payments = false is the same as the default', 'authenticated', OWNER, `select public.admin_cleanup_purge_people(${arr([P5])}, 'DELETE', false)`, '22023');
await rejectsAs('purge: p_allow_payments = null counts as false', 'authenticated', OWNER, `select public.admin_cleanup_purge_people(${arr([P6])}, 'DELETE', null)`, '22023');
await rejectsAs('purge: one person with payments in a list refuses the whole call', 'authenticated', OWNER, `select public.admin_cleanup_purge_people(${arr([P4, P5])}, 'DELETE')`, '22023');
try { await as('authenticated', OWNER, `select public.admin_cleanup_purge_people(${arr([P5])}, 'DELETE')`); }
catch (e) { ok('purge: the refusal says why and how to allow it', /payment/.test(e.message) && /p_allow_payments/.test(e.message) && !/@/.test(e.message)); }
ok('purge: the payments refusals deleted nothing', (await snapshot()) === snapPay);
await rejectsAs('purge: the typed confirmation is still needed with p_allow_payments', 'authenticated', OWNER, `select public.admin_cleanup_purge_people(${arr([P5])}, 'delete', true)`, '22023');
await rejectsAs('purge: p_allow_payments does not lift the other refusals (not a test person)', 'authenticated', OWNER, `select public.admin_cleanup_purge_people(${arr([REAL_ID])}, 'DELETE', true)`, '22023');
await rejectsAs('purge: p_allow_payments does not lift the staff refusal', 'authenticated', OWNER, `select public.admin_cleanup_purge_people(${arr([OWNER_ID])}, 'DELETE', true)`, '22023');
res = await call(OWNER, `public.admin_cleanup_purge_people(${arr([P4])}, 'DELETE')`);
ok('purge: the old two argument call shape works for a person without payments', res.counts.people === 1 && res.counts.reward_ledger === 1);
let pAud = (await q(`select detail from audit_events where action = 'cleanup.purge_people' order by id desc limit 1`))[0].detail;
ok('purge: audit records that payments were not allowed', pAud.payments_allowed === false && pAud.counts.people === 1);
res = await call(OWNER, `public.admin_cleanup_purge_people(${arr([P5, P6])}, 'DELETE', true)`);
ok('purge: with p_allow_payments = true the payment rows go too', res.counts.people === 2 && res.counts.stripe_processed_sessions === 1 && res.counts.entitlements === 1 && (await n1(`select count(*) n from stripe_processed_sessions where session_id = 'cs_p5'`)) === 0);
pAud = (await q(`select detail from audit_events where action = 'cleanup.purge_people' order by id desc limit 1`))[0].detail;
ok('purge: audit records that payments were allowed, counts only', pAud.payments_allowed === true && !/@|p5|Pay/.test(JSON.stringify(pAud)));
const cfg = (await q(`select array_to_string(proconfig, ',') c from pg_proc where proname = 'admin_cleanup_purge_people'`))[0].c;
ok('purge function sets lock_timeout to 3s and an empty search_path', /lock_timeout=3s/.test(cfg) && /search_path=""/.test(cfg), cfg);
ok('exactly one overload of the purge function exists', (await n1(`select count(*) n from pg_proc where proname = 'admin_cleanup_purge_people'`)) === 1);

// exactly 100 is allowed (all nonexistent would be refused as not found; use 100 real flagged people)
await db.exec(`insert into people (id, auth_uid, primary_email, is_test) select ('d0000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'fb_bulk' || g, 'bulk' || g || '@example.com', true from generate_series(1, 101) g`);
const bulk = (n) => `(select array_agg(('d0000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid) from generate_series(1, ${n}) g)`;
await rejectsAs('purge people: 101 real flagged people are refused', 'authenticated', OWNER, `select public.admin_cleanup_purge_people(${bulk(101)}, 'DELETE')`, '22023');
res = await call(OWNER, `public.admin_cleanup_purge_people(${bulk(100)}, 'DELETE')`);
ok('purge people: exactly 100 is allowed', res.counts.people === 100);
await db.exec(`delete from people where id::text like 'd0000000-%'`);

// ============================================================ the purge itself
const TRIGGERS = [['audit_events', 'audit_events_append_only'], ['stability_events', 'stability_events_append_only'], ['reward_ledger', 'reward_ledger_append_only'],
  ['learning_profile_evidence', 'learning_profile_evidence_append_only'], ['consent_events', 'consent_events_append_only']];
const triggersOn = async () => (await q(`select tgrelid::regclass::text t, tgname, tgenabled from pg_trigger where not tgisinternal and tgname in (${TRIGGERS.map(([, n]) => `'${n}'`).join(',')})`));
ok('before: the five append only triggers exist and are enabled', (await triggersOn()).length === 5 && (await triggersOn()).every((t) => t.tgenabled === 'O'));
const realBefore = JSON.stringify(await Promise.all(TABLES.filter((t) => t !== 'people').map(async (t) => [t, await n1(`select count(*) n from ${t} where ${t === 'duplicate_candidates' ? `person_a='${REAL_ID}' or person_b='${REAL_ID}'` : t === 'audit_events' ? `person_id='${REAL_ID}' or subject_id='${REAL_ID}'` : t === 'assessment_scoring_comparisons' || t === 'assessment_response_parts' ? `attempt_id in (select id from assessment_attempts where person_id='${REAL_ID}')` : `person_id='${REAL_ID}'`}`)])));

// forced error: a table with a restricting foreign key makes the final delete of people fail, after everything else was deleted
await db.exec(`create table zz_blocker (person_id uuid references people (id) on delete restrict); insert into zz_blocker values ('${T3}');`);
const snapBlocked = await snapshot();
const purgeAudits0 = await n1(`select count(*) n from audit_events where action = 'cleanup.purge_people'`);
const tp = (await call(OWNER, `public.admin_cleanup_preview(${arr([T3])})`)).counts;
await rejectsAs('forced error in the middle of a purge', 'authenticated', OWNER, `select public.admin_cleanup_purge_people(${arr([T1, T3])}, 'DELETE', true)`, '23001');
ok('the failed purge rolled everything back, every table unchanged', (await snapshot()) === snapBlocked);
ok('the failed purge left all five triggers enabled', (await triggersOn()).length === 5 && (await triggersOn()).every((t) => t.tgenabled === 'O'), JSON.stringify(await triggersOn()));
ok('the failed purge wrote no audit row', (await n1(`select count(*) n from audit_events where action = 'cleanup.purge_people'`)) === purgeAudits0);
ok('the failed purge kept T3 data exactly', JSON.stringify((await call(OWNER, `public.admin_cleanup_preview(${arr([T3])})`)).counts) === JSON.stringify(tp));
try { await db.exec(`update reward_ledger set points = 99 where person_id = '${T3}'`); ok('reward_ledger update after failed purge', false); }
catch (e) { ok('reward_ledger rejects updates after the failed purge', codeOf(e) === '42501'); }
await db.exec(`drop table zz_blocker`);

// the real purge of T1 and T2
const preview12 = await call(OWNER, `public.admin_cleanup_preview(${arr([T1, T2])})`);
const t1Email = 'tester.one@example.com';
res = await call(OWNER, `public.admin_cleanup_purge_people(${arr([T1, T2])}, 'DELETE', true)`);
ok('purge: returns counts', res && res.counts && Object.keys(res).join() === 'counts');
ok('purge: returned counts equal the preview counts, table by table', JSON.stringify(Object.entries(res.counts).sort()) === JSON.stringify(Object.entries(preview12.counts).sort()), JSON.stringify(res.counts) + ' vs ' + JSON.stringify(preview12.counts));
ok('purge: two people removed', res.counts.people === 2 && (await n1(`select count(*) n from people where id in ('${T1}','${T2}')`)) === 0);
const gone = async (table, col, ids) => (await n1(`select count(*) n from ${table} where ${col} = any (${arr(ids)})`)) === 0;
for (const [t, c] of [['person_emails', 'person_id'], ['person_profiles', 'person_id'], ['affiliations', 'person_id'], ['enrollments', 'person_id'], ['entitlements', 'person_id'],
  ['consent_events', 'person_id'], ['role_grants', 'person_id'], ['credentials', 'person_id'], ['activity_submissions', 'person_id'], ['activity_attempts', 'person_id'],
  ['activity_progress', 'person_id'], ['activity_drafts', 'person_id'], ['learning_profile_evidence', 'person_id'], ['learning_profile_summaries', 'person_id'],
  ['reward_ledger', 'person_id'], ['reward_state', 'person_id'], ['engagement_sessions', 'person_id'], ['stability_events', 'person_id'], ['audit_events', 'person_id'],
  ['assessment_attempts', 'person_id'], ['stripe_processed_sessions', 'person_id'], ['leads', 'person_id'], ['feedback_submissions', 'person_id']]) {
  ok(`purge: ${t} has no rows left for the purged people (append only tables included)`, await gone(t, c, [T1, T2]));
}
ok('purge: response parts and scoring comparisons went with their attempts', (await n1(`select count(*) n from assessment_response_parts where attempt_id in ('${A(51)}','${A(52)}')`)) === 0 && (await n1(`select count(*) n from assessment_scoring_comparisons where attempt_id in ('${A(51)}','${A(52)}')`)) === 0);
ok('purge: audit rows that named the person as subject are gone too', (await n1(`select count(*) n from audit_events where subject_id in ('${T1}','${T2}')`)) === 0);
ok('purge: the shared duplicate candidate row is gone', (await n1(`select count(*) n from duplicate_candidates where person_a='${T1}' or person_b='${T1}'`)) === 0);
ok('purge: rows of other people that named the purged person are kept with the name cleared',
  (await n1(`select count(*) n from role_grants where person_id='${MEMBER_ID}' and granted_by is null`)) === 1 &&
  (await n1(`select count(*) n from affiliations where person_id='${MEMBER_ID}' and created_by is null`)) === 1 &&
  (await n1(`select count(*) n from app_settings where key='feedback' and updated_by is null`)) === 1 &&
  (await n1(`select count(*) n from access_requests where email='req@acme.org' and decided_by is null`)) === 1 &&
  (await n1(`select count(*) n from leads where email='lead-real@acme.org' and handled_by_person_id is null`)) === 1);
const realAfter = JSON.stringify(await Promise.all(TABLES.filter((t) => t !== 'people').map(async (t) => [t, await n1(`select count(*) n from ${t} where ${t === 'duplicate_candidates' ? `person_a='${REAL_ID}' or person_b='${REAL_ID}'` : t === 'audit_events' ? `person_id='${REAL_ID}' or subject_id='${REAL_ID}'` : t === 'assessment_scoring_comparisons' || t === 'assessment_response_parts' ? `attempt_id in (select id from assessment_attempts where person_id='${REAL_ID}')` : `person_id='${REAL_ID}'`}`)])));
const dupDiff = JSON.parse(realBefore).filter(([t], i) => JSON.parse(realAfter)[i][1] !== JSON.parse(realBefore)[i][1]).map(([t]) => t);
ok('purge: the real person keeps every row (only the shared duplicate pair changed)', dupDiff.join() === 'duplicate_candidates', dupDiff.join());
ok('purge: T3 and the owner are untouched', (await n1(`select count(*) n from people where id in ('${T3}','${OWNER_ID}','${REAL_ID}','${MEMBER_ID}')`)) === 4 && (await n1(`select count(*) n from reward_ledger where person_id='${T3}'`)) === 1);
ok('after: all five append only triggers are enabled again', (await triggersOn()).length === 5 && (await triggersOn()).every((t) => t.tgenabled === 'O'), JSON.stringify(await triggersOn()));
for (const [sql, label] of [[`update reward_ledger set points = 1 where person_id = '${REAL_ID}'`, 'reward_ledger update'], [`delete from reward_ledger where person_id = '${REAL_ID}'`, 'reward_ledger delete'],
  [`update audit_events set action = 'x' where person_id = '${REAL_ID}'`, 'audit_events update'], [`delete from audit_events where action = 'cleanup.purge_people'`, 'audit_events delete'],
  [`delete from stability_events where person_id = '${REAL_ID}'`, 'stability_events delete'], [`delete from consent_events where person_id = '${REAL_ID}'`, 'consent_events delete'],
  [`delete from learning_profile_evidence where person_id = '${REAL_ID}'`, 'learning_profile_evidence delete']]) {
  try { await db.exec(sql); ok(`${label} fails again after a purge`, false); } catch (e) { ok(`${label} fails again after a purge  [${codeOf(e)}]`, codeOf(e) === '42501'); }
}
const pa = await q(`select * from audit_events where action = 'cleanup.purge_people' order by id desc`);
ok('purge: exactly one new audit row, by the caller', pa.length === purgeAudits0 + 1 && pa[0].actor_person_id === OWNER_ID && pa[0].person_id === null);
ok('purge: the audit detail is counts only', pa[0].detail.counts.people === 2 && Object.values(pa[0].detail.counts).every((v) => typeof v === 'number') && Object.keys(pa[0].detail).sort().join() === 'counts,payments_allowed' && pa[0].detail.payments_allowed === true);
const auditText = JSON.stringify(await q(`select * from audit_events where action like 'cleanup.%' or action like 'inbox.%'`));
ok('no audit row of the clean up or inbox functions contains an email or a name', !/@|example\.com|Tess|Tom|Tina|Mia|Olive|Rita/.test(auditText), auditText.slice(0, 200));
ok('the purged email is nowhere in audit_events', !JSON.stringify(await q(`select * from audit_events`)).includes(t1Email));
await rejectsAs('purge a second time: the people are gone', 'authenticated', OWNER, `select public.admin_cleanup_purge_people(${arr([T1])}, 'DELETE')`, '22023');

// purge T3 on its own, now that nothing blocks it
res = await call(OWNER, `public.admin_cleanup_purge_people(${arr([T3])}, 'DELETE', true)`);
ok('a single test person can be purged', res.counts.people === 1 && res.counts.reward_ledger === 1);
ok('another purge audit row now', (await n1(`select count(*) n from audit_events where action = 'cleanup.purge_people'`)) === purgeAudits0 + 2);
ok('triggers are still enabled', (await triggersOn()).every((t) => t.tgenabled === 'O'));

// ============================================================ junk events
await db.exec(`
 insert into stability_events (event_key, event_type, severity, occurred_at) values
  ('junk-old-js-1','javascript_error','error', now() - interval '100 days'), ('junk-old-js-2','javascript_error','warning', now() - interval '60 days'),
  ('junk-old-net-1','network_offline','info', now() - interval '90 days'), ('junk-new-js-1','javascript_error','error', now() - interval '2 days');
 insert into engagement_sessions (person_id, kind, session_key, started_at) values
  ('${REAL_ID}','session','junk-sess-old-1', now() - interval '100 days'), ('${REAL_ID}','activity','junk-act-old-1', now() - interval '100 days'),
  ('${REAL_ID}','session','junk-sess-new-1', now() - interval '1 day');
`);
const stabBefore = await n1(`select count(*) n from stability_events`);
res = await call(OWNER, `public.admin_cleanup_junk_events('stability', 30)`);
ok('junk: dry run is the default', res.matched === 3 && res.deleted === 0 && (await n1(`select count(*) n from stability_events`)) === stabBefore);
res = await call(OWNER, `public.admin_cleanup_junk_events('stability', 30, array['network_offline'], true)`);
ok('junk: dry run honours the type filter', res.matched === 1 && res.deleted === 0);
res = await call(OWNER, `public.admin_cleanup_junk_events('stability', 70, null, true)`);
ok('junk: dry run honours the age', res.matched === 2);
const ja0 = await n1(`select count(*) n from audit_events where action = 'cleanup.junk_events'`);
ok('junk: dry runs wrote no audit row', ja0 === 0);
res = await call(OWNER, `public.admin_cleanup_junk_events('stability', 70, array['javascript_error'], false)`);
ok('junk: real run deletes by age and type only', res.matched === 1 && res.deleted === 1 && (await n1(`select count(*) n from stability_events where event_key = 'junk-old-js-1'`)) === 0 && (await n1(`select count(*) n from stability_events where event_key like 'junk-%'`)) === 3);
res = await call(OWNER, `public.admin_cleanup_junk_events('stability', 30, null, false)`);
ok('junk: real run with all types', res.deleted === 2 && (await n1(`select count(*) n from stability_events where event_key = 'junk-new-js-1'`)) === 1);
ok('junk: triggers enabled again afterwards', (await triggersOn()).every((t) => t.tgenabled === 'O'));
try { await db.exec(`delete from stability_events where event_key = 'junk-new-js-1'`); ok('stability_events delete fails again', false); } catch (e) { ok('stability_events delete fails again after the junk purge', codeOf(e) === '42501'); }
res = await call(OWNER, `public.admin_cleanup_junk_events('engagement', 30, array['session'], true)`);
ok('junk: engagement dry run by kind', res.matched === 1 && res.deleted === 0);
res = await call(OWNER, `public.admin_cleanup_junk_events('engagement', 30, null, false)`);
ok('junk: engagement real run', res.matched === 2 && res.deleted === 2 && (await n1(`select count(*) n from engagement_sessions where session_key like 'junk-%'`)) === 1);
const ja = await q(`select * from audit_events where action = 'cleanup.junk_events' order by id`);
ok('junk: one audit row per real run, counts only', ja.length === 3 && ja.every((a) => a.actor_person_id === OWNER_ID && typeof a.detail.deleted === 'number' && !/@/.test(JSON.stringify(a))));
await rejectsAs('junk: engagement floor, 29 days refused', 'authenticated', OWNER, `select public.admin_cleanup_junk_events('engagement', 29, null, true)`, '22023');
await rejectsAs('junk: engagement floor, 1 day refused', 'authenticated', OWNER, `select public.admin_cleanup_junk_events('engagement', 1, null, false)`, '22023');
ok('junk: engagement 30 days is allowed, stability 1 day is allowed', (await call(OWNER, `public.admin_cleanup_junk_events('engagement', 30)`)).deleted === 0 && (await call(OWNER, `public.admin_cleanup_junk_events('stability', 1)`)).deleted === 0);
await rejectsAs('junk: unknown kind', 'authenticated', OWNER, `select public.admin_cleanup_junk_events('logins', 30)`, '22023');
await rejectsAs('junk: zero days refused', 'authenticated', OWNER, `select public.admin_cleanup_junk_events('stability', 0, null, false)`, '22023');
await rejectsAs('junk: null days refused', 'authenticated', OWNER, `select public.admin_cleanup_junk_events('stability', null)`, '22023');
await rejectsAs('junk: unknown stability type refused', 'authenticated', OWNER, `select public.admin_cleanup_junk_events('stability', 30, array['bogus'])`, '22023');
await rejectsAs('junk: unknown engagement type refused', 'authenticated', OWNER, `select public.admin_cleanup_junk_events('engagement', 30, array['javascript_error'])`, '22023');
await rejectsAs('junk: empty type list refused', 'authenticated', OWNER, `select public.admin_cleanup_junk_events('stability', 30, array[]::text[])`, '22023');
await rejectsAs('junk: a member is refused', 'authenticated', MEMBER, `select public.admin_cleanup_junk_events('stability', 30, null, false)`, '42501');

// ============================================================ the browser can still do none of the staff actions after all of this
await rejectsAs('anon still cannot read leads at the end', 'anon', null, `select count(*) from leads`, '42501');
ok('triggers all enabled at the end', (await triggersOn()).length === 5 && (await triggersOn()).every((t) => t.tgenabled === 'O'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
