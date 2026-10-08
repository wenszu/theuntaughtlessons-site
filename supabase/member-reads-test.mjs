// Tests for migration 2250: the four member facing read functions and the rollback.
//   node supabase/member-reads-test.mjs
// The cohort standing answer is checked against a line by line port of the Firebase handler (functions-admin/index.js,
// getCohortStanding, from the point where the entries are known), so a difference in ranking, ties, the next member or the
// five row window shows up as a failure.
import fs from 'fs';
import { isDeepStrictEqual } from 'util';
import { boot } from './schema-apply-harness.mjs';

const { db, failed } = await boot();
if (failed) { console.log('\nmigrations did not apply, stopping'); process.exit(1); }
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n); };
const as = async (role, sub, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${sub ? JSON.stringify({ sub, role: role === 'anon' ? 'anon' : 'authenticated' }) : ''}', false);`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
};
const rejectsAs = async (n, role, sub, sql, code) => {
  try { await as(role, sub, sql); ok(n + '  [call succeeded]', false); }
  catch (e) {
    const got = e.code || (e.message.match(/\b(\d{2}[0-9A-Z]{3})\b/) || [])[1] || '';
    ok(n + '  [' + (got || e.message.slice(0, 50)) + ']', !code || got === code || e.message.includes(code));
  }
};
const q = async (s) => (await db.query(s)).rows;
const call = async (sub, fn) => (await as('authenticated', sub, `select ${fn} as r`))[0].r;
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

// ---- the catalog the standing counts: orientation, 12 lessons, 16 exercises (29 ids) plus the TSA diagnostic
const REQUIRED = ['orientation', 'p1-l1', 'p1-l2', 'p1-l3', 'p1-l4', 'p1-l5', 'p2-l1', 'p2-l3', 'p3-l1', 'p3-l2', 'p3-l3', 'p3-l4', 'p3-l5',
  'p1-e1', 'p1-e2', 'p1-e3', 'p1-e4', 'p1-e5', 'p1-e6', 'p2-e1', 'p2-e2', 'p2-e3', 'p2-e4', 'p2-e5', 'p2-e6', 'p3-e1', 'p3-e2', 'p3-e3', 'p3-e4'];
const kindOf = (a) => (a === 'orientation' ? 'orientation' : /-l\d$/.test(a) ? 'lesson' : 'exercise');
await db.exec(`
 insert into activities (id, program_id, kind, title, config) values
  ${REQUIRED.map((a) => `('${a}', 'tsa', '${kindOf(a)}', 'Title ${a}', '{}')`).join(',\n  ')},
  ('tsa-diagnostic', 'tsa', 'assessment', 'TSA diagnostic', '{}'),
  ('p2-e5-extra', 'tsa', 'exercise', 'Not counted', '{}');
 insert into activity_keys (key, activity_id) values
  ('grocery-list', 'p1-e1'), ('tsa-diagnostic-v2', 'tsa-diagnostic'), ('utl_result_tsa_diagnostic', 'tsa-diagnostic'),
  ('explain-to-aiko', 'p2-e5'), ('explain-to-aiko-120', 'p2-e5'), ('explain-to-aiko-120s', 'p2-e5');
`);
// ---- cohorts, organizations
await db.exec(`
 insert into organizations (id, slug, name, status, legacy_firestore_id) values
  ('${id(900)}', 'acme-co', 'Acme Co', 'active', 'organizations/acme-co'),
  ('${id(901)}', 'beta-inc', 'Beta Inc', 'active', 'organizations/Beta_Inc'),
  ('${id(902)}', 'old-org', 'Old Org', 'archived', 'organizations/old-org');
 insert into cohorts (id, program_id, name, status, organization_id) values
  ('${id(100)}', 'tsa', 'Batch A', 'active', '${id(900)}'),
  ('${id(101)}', 'tsa', 'Batch B', 'active', '${id(900)}'),
  ('${id(102)}', 'tsa', 'Batch C', 'active', '${id(901)}'),
  ('${id(103)}', 'tsa', 'Batch D', 'active', null),
  ('${id(104)}', 'tsa', 'Batch E', 'active', null),
  ('${id(105)}', 'tsa', 'Batch Old', 'archived', '${id(902)}');
`);

// ---- people. Cohort A has 6 ranked members, an admin, an expired member and a member who never signed in.
const people = [];
const enroll = [];
const addPerson = (n, uid, email, name, extra = {}) => {
  people.push(`('${id(n)}', ${uid ? `'${uid}'` : 'null'}, '${email}', '${name}', 'active', ${extra.legacy ? `'${extra.legacy}'` : 'null'})`);
};
const A = [1, 2, 3, 4, 5, 6];
A.forEach((n) => { addPerson(n, `fb_a${n}`, `a${n}@a.com`, `Member A${n}`); enroll.push(`('${id(n)}', 'tsa', 'active', '${id(100)}')`); });
addPerson(7, 'fb_admin', 'admin@a.com', 'Admin A7'); enroll.push(`('${id(7)}', 'tsa', 'active', '${id(100)}')`);
addPerson(8, 'fb_expired', 'expired@a.com', 'Expired A8'); enroll.push(`('${id(8)}', 'tsa', 'expired', '${id(100)}')`);
addPerson(9, null, 'neversignedin@a.com', 'Never A9'); enroll.push(`('${id(9)}', 'tsa', 'active', '${id(100)}')`);
// Cohort B: three members (small). Cohort C: exactly five. Cohort D: four.
[10, 11, 12].forEach((n) => { addPerson(n, `fb_b${n}`, `b${n}@a.com`, `Member B${n}`); enroll.push(`('${id(n)}', 'tsa', 'active', '${id(101)}')`); });
[20, 21, 22, 23, 24].forEach((n) => { addPerson(n, `fb_c${n}`, `c${n}@a.com`, `Member C${n}`); enroll.push(`('${id(n)}', 'tsa', 'completed', '${id(102)}')`); });
[30, 31, 32, 33].forEach((n) => { addPerson(n, `fb_d${n}`, `d${n}@a.com`, `Member D${n}`); enroll.push(`('${id(n)}', 'tsa', 'invited', '${id(103)}')`); });
addPerson(40, 'fb_nocohort', 'nocohort@a.com', 'No Cohort'); enroll.push(`('${id(40)}', 'tsa', 'active', null)`);
addPerson(41, 'fb_noenroll', 'noenroll@a.com', 'No Enrollment');
addPerson(42, 'fb_es', 'es@a.com', 'ES Only', { legacy: 'customers/cust_42' });
addPerson(43, 'fb_both', 'both@a.com', 'Both Programs', { legacy: 'customers/cust_43' }); enroll.push(`('${id(43)}', 'tsa', 'withdrawn', null)`);
addPerson(44, 'fb_esexpired', 'esexp@a.com', 'ES Expired');
addPerson(45, 'fb_archived', 'archived@a.com', 'Archived');
addPerson(46, 'fb_owner', 'owner@a.com', 'Org Owner');
addPerson(47, 'fb_fac', 'fac@a.com', 'Facilitator');
addPerson(48, 'fb_viewer', 'viewer@a.com', 'Viewer No Cohort');
addPerson(49, 'fb_multi', 'multi@a.com', 'Multi Org');
await db.exec(`
 insert into people (id, auth_uid, primary_email, display_name, account_status, legacy_firestore_id) values ${people.join(',\n  ')};
 update people set account_status = 'archived' where id = '${id(45)}';
 insert into enrollments (person_id, program_id, status, cohort_id) values ${enroll.join(',\n  ')};
 insert into role_grants (person_id, scope_type, role, status) values ('${id(7)}', 'platform', 'platform_owner', 'active');
 insert into entitlements (person_id, program_id, assessment_id, access_type, status) values
  ('${id(42)}', 'executive-signature', null, 'comped', 'active'),
  ('${id(43)}', 'executive-signature', null, 'free', 'active'),
  ('${id(44)}', 'executive-signature', null, 'free', 'expired');
`);

// ---- progress and points for cohort A, C and D
const doneOf = { 1: 10, 2: 10, 3: 15, 4: 3, 5: 20, 6: 0, 7: 12, 8: 29, 9: 29 };
const mpOf = { 1: 100, 2: 350, 3: 900, 4: 100, 5: 1900, 6: 0, 7: 5000, 8: 5000, 9: 5000 };
const doneC = { 20: 5, 21: 5, 22: 29, 23: 1, 24: 0 };
const mpC = { 20: 50, 21: 50, 22: 600, 23: 0, 24: 10 };
const progressSql = [];
const ledgerSql = [];
const addProgress = (n, done) => REQUIRED.slice(0, done).forEach((a) => progressSql.push(`('${id(n)}', '${a}', 'tsa', 'completed', now())`));
Object.entries(doneOf).forEach(([n, d]) => addProgress(Number(n), d));
Object.entries(doneC).forEach(([n, d]) => addProgress(Number(n), d));
Object.entries(mpOf).forEach(([n, m]) => { if (m) ledgerSql.push(`('${id(Number(n))}', 'tsa', 'e-${n}', ${m})`); });
Object.entries(mpC).forEach(([n, m]) => { if (m) ledgerSql.push(`('${id(Number(n))}', 'tsa', 'e-${n}', ${m})`); });
// Things that must not count: an activity outside the 29, a visited one, a ledger row for another program is impossible (only tsa).
progressSql.push(`('${id(6)}', 'tsa-diagnostic', 'tsa', 'completed', now())`, `('${id(6)}', 'p1-e1', 'tsa', 'visited', null)`, `('${id(6)}', 'p2-e5-extra', 'tsa', 'completed', now())`);
await db.exec(`
 insert into activity_progress (person_id, activity_id, program_id, status, completed_at) values ${progressSql.join(',\n  ')};
 insert into reward_ledger (person_id, program_id, entry_key, points) values ${ledgerSql.join(',\n  ')};
 insert into reward_ledger (person_id, program_id, entry_key, points) values ('${id(6)}', 'tsa', 'neg', 40), ('${id(6)}', 'tsa', 'neg2', -90);
`);

// ---- reference: the Firebase handler from the entries onward (functions-admin/index.js getCohortStanding and rankCohort)
function rankCohort(entries, metric) {
  const key = metric === 'mp' ? 'mp' : 'percent';
  entries.sort((a, b) => (b[key] - a[key]) || a.uid.localeCompare(b.uid));
  let previousScore = null, previousRank = 0;
  entries.forEach((entry, index) => {
    const score = entry[key];
    entry.rank = score === previousScore ? previousRank : index + 1;
    previousScore = score; previousRank = entry.rank;
  });
  return entries;
}
const LEVELS = [['Intern', 0], ['Analyst', 300], ['Associate', 800], ['Principal', 1350], ['Executive', 1800]];
const levelFor = (mp, levels = LEVELS) => levels.filter(([, t]) => t <= mp).sort((a, b) => b[1] - a[1])[0][0];
function reference(entries, ownUid, metric, levels) {
  if (entries.length < 5) return { ok: true, state: 'small-cohort', metric, minimumSize: 5 };
  const ranked = rankCohort(entries.map((e) => ({ ...e })), metric);
  const callerIndex = ranked.findIndex((entry) => entry.uid === ownUid);
  if (callerIndex < 0) return { ok: true, state: 'no-progress', metric };
  const own = ranked[callerIndex];
  const key = metric === 'mp' ? 'mp' : 'percent';
  const tiedCount = ranked.filter((entry) => entry[key] === own[key]).length;
  const next = ranked.slice(0, callerIndex).reverse().find((entry) => entry[key] > own[key]) || null;
  const displayRanked = ranked.slice().sort((a, b) => (a.rank - b.rank) || (a.uid === own.uid ? -1 : b.uid === own.uid ? 1 : a.uid.localeCompare(b.uid)));
  const displayIndex = displayRanked.findIndex((entry) => entry.uid === own.uid);
  const start = Math.max(0, Math.min(displayIndex - 2, displayRanked.length - 5));
  const windowEntries = displayRanked.slice(start, Math.min(displayRanked.length, start + 5)).map((entry) => ({
    rank: entry.rank, isTied: ranked.filter((candidate) => candidate[key] === entry[key]).length > 1, isYou: entry.uid === own.uid, value: entry[key]
  }));
  return {
    ok: true, state: 'ready', metric, cohortSize: ranked.length,
    you: { rank: own.rank, tiedCount, percent: own.percent, mp: own.mp, level: levelFor(own.mp, levels), done: own.done, total: 29 },
    next: next ? { difference: Math.max(0, next[key] - own[key]), activities: metric === 'completion' ? Math.max(1, next.done - own.done + 1) : null } : null,
    entries: windowEntries
  };
}
const entryOf = (uid, done, mp) => ({ uid, email: uid + '@x', done, total: 29, percent: Math.round(done / 29 * 100), mp });
const cohortA = A.map((n) => entryOf(`fb_a${n}`, doneOf[n] - (n === 6 ? 0 : 0), mpOf[n]));
// Member 6 has done 0 lessons counted (diagnostic, visited and extra do not count), and 40 - 90 points (negative total floors at 0).
cohortA.find((e) => e.uid === 'fb_a6').mp = 0;
const cohortC = Object.keys(doneC).map((n) => entryOf(`fb_c${n}`, doneC[n], mpC[n]));
const strip = (a) => { const { generatedAt, ...rest } = a; return rest; };

// ---- cohort standing: every member of cohort A and C, both metrics, against the reference
for (const [group, label] of [[cohortA, 'A'], [cohortC, 'C']]) {
  for (const metric of ['completion', 'mp']) {
    for (const e of group) {
      const got = strip(await call(e.uid, `public.get_my_cohort_standing('${metric}')`));
      const want = reference(group, e.uid, metric);
      ok(`cohort ${label} ${metric} ${e.uid}: same answer as the Firebase rules`, isDeepStrictEqual(got, want));
      if (!isDeepStrictEqual(got, want)) console.log('   got ', JSON.stringify(got), '\n   want', JSON.stringify(want));
    }
  }
}
let r = await call('fb_a1', `public.get_my_cohort_standing()`);
ok('the metric defaults to completion', r.metric === 'completion' && r.state === 'ready');
r = await call('fb_a1', `public.get_my_cohort_standing('anything-else')`);
ok('an unknown metric is completion, as in Firebase', r.metric === 'completion');
r = await call('fb_a1', `public.get_my_cohort_standing('mp')`);
ok('generatedAt is an ISO time', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r.generatedAt));
ok('the admin, the expired member and the member who never signed in are not counted (cohort size 6)', r.cohortSize === 6);
ok('a ready answer has exactly the Firebase keys', isDeepStrictEqual(Object.keys(r).sort(), ['cohortSize', 'entries', 'generatedAt', 'metric', 'next', 'ok', 'state', 'you']));
ok('the five row window has exactly rank, isTied, isYou and value', r.entries.length === 5 && r.entries.every((e) => isDeepStrictEqual(Object.keys(e).sort(), ['isTied', 'isYou', 'rank', 'value'])));
ok('exactly one row of the window is the caller', r.entries.filter((e) => e.isYou).length === 1);
ok('you holds rank, tiedCount, percent, mp, level, done and total', isDeepStrictEqual(Object.keys(r.you).sort(), ['done', 'level', 'mp', 'percent', 'rank', 'tiedCount', 'total']));

// Anonymity: nothing in any answer names another member.
const others = ['fb_a2', 'fb_a3', 'fb_a4', 'fb_a5', 'fb_a6', 'fb_admin', 'fb_expired', 'a2@a.com', 'Member A2', 'Member A3', 'Admin A7', id(2), id(3), id(7), id(9)];
for (const metric of ['completion', 'mp']) {
  const text = JSON.stringify(await call('fb_a1', `public.get_my_cohort_standing('${metric}')`));
  ok(`anonymity (${metric}): no other member's name, email, uid or id appears`, !others.some((o) => text.includes(o)));
}

// Minimum group size: 3, 4 and 5 people.
r = await call('fb_b10', `public.get_my_cohort_standing()`);
ok('three people: small-cohort, minimum 5, nothing else (no rank, no size)', isDeepStrictEqual(r, { ok: true, state: 'small-cohort', metric: 'completion', minimumSize: 5 }));
r = await call('fb_d30', `public.get_my_cohort_standing('mp')`);
ok('four people: still small-cohort', r.state === 'small-cohort' && r.minimumSize === 5 && !('you' in r) && !('cohortSize' in r) && !('entries' in r));
r = await call('fb_c20', `public.get_my_cohort_standing()`);
ok('exactly five people: ready', r.state === 'ready' && r.cohortSize === 5);
r = await call('fb_nocohort', `public.get_my_cohort_standing()`);
ok('a member with no cohort: no-cohort', isDeepStrictEqual(r, { ok: true, state: 'no-cohort', metric: 'completion' }));
r = await call('fb_admin', `public.get_my_cohort_standing()`);
ok('a platform owner in a ready cohort is not ranked: no-progress', r.state === 'no-progress');
await rejectsAs('a member without an active enrollment is refused (42501)', 'authenticated', 'fb_expired', `select public.get_my_cohort_standing()`, '42501');
await rejectsAs('a person with no enrollment at all is refused (42501)', 'authenticated', 'fb_noenroll', `select public.get_my_cohort_standing()`, '42501');
await rejectsAs('a withdrawn member is refused (42501)', 'authenticated', 'fb_both', `select public.get_my_cohort_standing()`, '42501');
await rejectsAs('a signed in token that matches nobody is refused (42501)', 'authenticated', 'fb_nobody', `select public.get_my_cohort_standing()`, '42501');
await rejectsAs('no token at all is refused (42501)', 'authenticated', null, `select public.get_my_cohort_standing()`, '42501');
await rejectsAs('anon cannot execute standing', 'anon', null, `select public.get_my_cohort_standing()`, '42501');

// Levels from the rewards setting.
const defaultLevel = (await call('fb_a5', `public.get_my_cohort_standing('mp')`)).you.level;
ok('1900 points is Executive with the default levels', defaultLevel === 'Executive');
await db.exec(`update app_settings set value = '{"levels":[{"name":"Rookie","threshold":0},{"title":"Pro","threshold":500},{"name":"Master","threshold":1500},{"name":"Broken","threshold":"x"}]}'::jsonb where key = 'rewards'`);
r = await call('fb_a5', `public.get_my_cohort_standing('mp')`);
ok('levels come from the rewards setting (title or name, bad thresholds ignored)', r.you.level === 'Master');
r = await call('fb_a3', `public.get_my_cohort_standing('mp')`);
ok('900 points is Pro with those levels', r.you.level === 'Pro');
await db.exec(`update app_settings set value = '{}'::jsonb where key = 'rewards'`);
r = await call('fb_a4', `public.get_my_cohort_standing('mp')`);
ok('an empty setting falls back to the default levels', r.you.level === 'Intern');

// ---- workspaces
r = await call('fb_a1', `public.get_my_workspaces()`);
ok('TSA member: one workspace, tsa, no customer', isDeepStrictEqual(r, { ok: true, customerId: null, workspaces: [{ programId: 'tsa', label: 'Think, Speak, Act' }], hasMultiple: false }));
r = await call('fb_es', `public.get_my_workspaces()`);
ok('ES only: executive-signature, customer id without its prefix', isDeepStrictEqual(r, { ok: true, customerId: 'cust_42', workspaces: [{ programId: 'executive-signature', label: 'Executive Signature' }], hasMultiple: false }));
r = await call('fb_both', `public.get_my_workspaces()`);
ok('a withdrawn TSA enrollment still lists tsa (Firebase: the member document exists); both give hasMultiple', r.workspaces.length === 2 && r.workspaces[0].programId === 'tsa' && r.workspaces[1].programId === 'executive-signature' && r.hasMultiple === true && r.customerId === 'cust_43');
r = await call('fb_esexpired', `public.get_my_workspaces()`);
ok('an expired ES entitlement gives no workspace', isDeepStrictEqual(r, { ok: true, customerId: null, workspaces: [], hasMultiple: false }));
r = await call('fb_nobody', `public.get_my_workspaces()`);
ok('an unknown person gets the empty answer, not an error', isDeepStrictEqual(r, { ok: true, customerId: null, workspaces: [], hasMultiple: false }));
r = await call('fb_archived', `public.get_my_workspaces()`);
ok('an archived account gets the empty answer', r.workspaces.length === 0);
r = await as('authenticated', null, `select public.get_my_workspaces() as r`);
ok('no token: the empty answer', r[0].r.workspaces.length === 0);
await rejectsAs('anon cannot execute workspaces', 'anon', null, `select public.get_my_workspaces()`, '42501');

// ---- organization access
await db.exec(`
 insert into role_grants (person_id, scope_type, organization_id, role, status, assigned_cohort_names, ended_at) values
  ('${id(46)}', 'organization', '${id(900)}', 'organization_owner', 'active', '{}', null),
  ('${id(46)}', 'organization', '${id(901)}', 'program_manager', 'active', '{}', null),
  ('${id(46)}', 'organization', '${id(902)}', 'organization_owner', 'active', '{}', null),
  ('${id(47)}', 'organization', '${id(900)}', 'cohort_facilitator', 'active', '{"Batch B","Not A Cohort"}', null),
  ('${id(47)}', 'organization', '${id(901)}', 'report_viewer', 'suspended', '{"Batch C"}', null),
  ('${id(48)}', 'organization', '${id(900)}', 'report_viewer', 'active', '{"Not A Cohort"}', null),
  ('${id(49)}', 'organization', '${id(900)}', 'report_viewer', 'active', '{"Batch A","Batch B"}', null),
  ('${id(49)}', 'organization', '${id(901)}', 'cohort_facilitator', 'active', '{"Batch C"}', now());
`);
r = await call('fb_owner', `public.get_my_organization_access()`);
ok('owner of two active organizations and one archived: the archived one is left out, ordered by id', r.ok === true && r.hasAccess === true && r.organizations.length === 2 && r.organizations[0].id === 'acme-co' && r.organizations[1].id === 'beta_inc'.replace('_', ''));
ok('an owner counts every cohort of the organization', r.organizations[0].cohortCount === 2 && r.organizations[0].roleLabel === 'Organization Owner' && r.organizations[0].name === 'Acme Co' && r.organizations[0].role === 'organization_owner');
ok('a program manager is labelled and counts every cohort', r.organizations[1].roleLabel === 'Program Manager' && r.organizations[1].cohortCount === 1 && r.organizations[1].role === 'program_manager');
ok('each organization has exactly the Firebase keys', r.organizations.every((o) => isDeepStrictEqual(Object.keys(o).sort(), ['cohortCount', 'id', 'name', 'role', 'roleLabel'])));
r = await call('fb_fac', `public.get_my_organization_access()`);
ok('a facilitator counts only assigned cohorts that exist; a suspended grant gives nothing', r.organizations.length === 1 && r.organizations[0].id === 'acme-co' && r.organizations[0].cohortCount === 1 && r.organizations[0].roleLabel === 'Cohort Facilitator');
r = await call('fb_viewer', `public.get_my_organization_access()`);
ok('a report viewer with no matching cohort has no access', isDeepStrictEqual(r, { ok: true, hasAccess: false, organizations: [] }));
r = await call('fb_multi', `public.get_my_organization_access()`);
ok('an ended grant is ignored; the active one counts', r.organizations.length === 1 && r.organizations[0].cohortCount === 2 && r.organizations[0].roleLabel === 'Report Viewer');
r = await call('fb_a1', `public.get_my_organization_access()`);
ok('a learner has no organization access', isDeepStrictEqual(r, { ok: true, hasAccess: false, organizations: [] }));
r = await call('fb_nobody', `public.get_my_organization_access()`);
ok('an unknown person gets the empty answer', isDeepStrictEqual(r, { ok: true, hasAccess: false, organizations: [] }));
ok('a member only sees their own grants (the facilitator answer holds nothing about the owner)', !JSON.stringify(await call('fb_fac', `public.get_my_organization_access()`)).includes('beta'));
await rejectsAs('anon cannot execute organization access', 'anon', null, `select public.get_my_organization_access()`, '42501');

// ---- exercise responses
await db.exec(`
 insert into activity_submissions (person_id, activity_id, program_id, kind, submission_key, completed_at, response, legacy_firestore_id) values
  ('${id(1)}', 'p1-e1', 'tsa', 'submission', 'grocery-list-old', '2026-01-01T10:00:00Z', '{"v":"old"}', null),
  ('${id(1)}', 'p1-e1', 'tsa', 'submission', 'grocery-list-new', '2026-02-01T10:00:00Z', '{"v":"new","list":["a","b"]}', null),
  ('${id(1)}', 'p1-e1', 'tsa', 'practice', 'grocery-list-practice', '2026-03-01T10:00:00Z', '{"v":"practice"}', null),
  ('${id(1)}', 'tsa-diagnostic', 'tsa', 'submission', 'diag-1', '2026-02-05T10:00:00Z', '{"scores":{"total":42}}', null),
  ('${id(1)}', 'p2-e5', 'tsa', 'submission', 'aiko-1', '2026-02-06T10:00:00Z', '{"score":7}', 'users/fb_a1/completed_exercises/explain-to-aiko-120'),
  ('${id(1)}', 'p1-e2', 'tsa', 'practice', 'only-practice', '2026-02-06T10:00:00Z', '{"v":"p"}', null),
  ('${id(1)}', 'p1-e3', 'tsa', 'submission', 'no-key-yet', '2026-02-07T10:00:00Z', '{"v":1}', null),
  ('${id(2)}', 'p1-e1', 'tsa', 'submission', 'other-person', '2026-02-02T10:00:00Z', '{"v":"someone else"}', null);
`);
r = await call('fb_a1', `public.get_my_exercise_responses()`);
ok('keys: site key, the diagnostic v2 key (the localStorage style key is skipped), the legacy document id, the activity id when there is no key', isDeepStrictEqual(Object.keys(r).sort(), ['explain-to-aiko-120', 'grocery-list', 'p1-e3', 'tsa-diagnostic-v2']));
ok('the latest real submission wins; a practice round never counts', r['grocery-list'].savedPayload.v === 'new' && r['grocery-list'].savedPayload.list.length === 2);
ok('each document has the Firestore fields: status Done, exerciseName, updatedAt (ISO), savedPayload', isDeepStrictEqual(Object.keys(r['grocery-list']).sort(), ['exerciseName', 'savedPayload', 'status', 'updatedAt']) && r['grocery-list'].status === 'Done' && r['grocery-list'].exerciseName === 'Title p1-e1' && r['grocery-list'].updatedAt === '2026-02-01T10:00:00.000Z');
ok('the page reads responses[tsa-diagnostic-v2].savedPayload.scores', r['tsa-diagnostic-v2'].savedPayload.scores.total === 42);
ok('an exercise with only practice rounds is absent', !('p1-e2' in r) && !JSON.stringify(r).includes('"practice"'));
ok('nothing of another person', !JSON.stringify(r).includes('someone else'));
r = await call('fb_a2', `public.get_my_exercise_responses()`);
ok('another member sees only their own', Object.keys(r).length === 1 && r['grocery-list'].savedPayload.v === 'someone else');
r = await call('fb_a3', `public.get_my_exercise_responses()`);
ok('a member with no submissions gets an empty object', isDeepStrictEqual(r, {}));
await rejectsAs('a token that matches nobody is refused (42501)', 'authenticated', 'fb_nobody', `select public.get_my_exercise_responses()`, '42501');
await rejectsAs('anon cannot execute exercise responses', 'anon', null, `select public.get_my_exercise_responses()`, '42501');

// ---- grants and shape of the functions themselves
const fnRows = await q(`select p.proname, p.prosecdef, p.provolatile, array_to_string(p.proconfig, ',') as config, pg_get_function_identity_arguments(p.oid) as args,
   has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec, p.prosrc
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('get_my_workspaces','get_my_organization_access','get_my_cohort_standing','get_my_exercise_responses')`);
ok('all four functions exist', fnRows.length === 4);
for (const f of fnRows) {
  ok(`${f.proname}: security definer, empty search_path, stable, authenticated only`, f.prosecdef && /search_path=("")?(,|$)/.test(f.config) && f.provolatile === 's' && !f.anon_exec && f.auth_exec);
  ok(`${f.proname}: never writes and has no dynamic sql`, !/\b(insert\s+into|update\s+public|delete\s+from|create\s+temp)/i.test(f.prosrc) && !/^\s*execute\b/im.test(f.prosrc));
  ok(`${f.proname}: no backslash in the body`, !f.prosrc.includes('\\'));
}
ok('the only parameter anywhere is the standing metric', fnRows.filter((f) => f.args !== '').map((f) => f.proname + ':' + f.args).join() === 'get_my_cohort_standing:p_metric text');
const helper = (await q(`select has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') b from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'reward_level_for'`))[0];
ok('private.reward_level_for is closed to browsers', helper && !helper.a && !helper.b);

// ---- rollback
await db.exec(fs.readFileSync(new URL('./rollbacks/20261008002250_member_reads_down.sql', import.meta.url), 'utf8'));
ok('the rollback removes all four functions and the helper', (await q(`select count(*)::int n from pg_proc where proname in ('get_my_workspaces','get_my_organization_access','get_my_cohort_standing','get_my_exercise_responses','reward_level_for')`))[0].n === 0);
ok('the rollback touches no data', (await q(`select count(*)::int n from people`))[0].n === people.length && (await q(`select count(*)::int n from activity_submissions`))[0].n === 8);

console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
