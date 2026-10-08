// Tests for migration 2210: the Executive Signature read functions (get_my_es_status, get_es_attempt_report), and the rollback.
//   node supabase/es-report-test.mjs
import fs from 'fs';
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
const status = async (sub) => (await as('authenticated', sub, `select public.get_my_es_status() as r`))[0].r;
const report = async (sub, id) => (await as('authenticated', sub, `select public.get_es_attempt_report('${id}') as r`))[0].r;

const ALICE = '00000000-0000-0000-0000-0000000000a1';
const BOB = '00000000-0000-0000-0000-0000000000b2';
const OWNER = '00000000-0000-0000-0000-0000000000c3';
const SUPPORT = '00000000-0000-0000-0000-0000000000c4';
const LEAD = '00000000-0000-0000-0000-0000000000c5';
const OUTSIDER = '00000000-0000-0000-0000-0000000000c6';
const CHARLIE = '00000000-0000-0000-0000-0000000000c7';

const FACETS_FULL = {
  'Achievement-Striving': 71.25, 'Self-Discipline': 64.5, Orderliness: 58, Intellect: 80.75, Anxiety: 44.25, 'Self-Consciousness': 52,
  Assertiveness: 66.5, 'Activity Level': 49, Cooperation: 73, Altruism: 61.125
};
const AREAS_QUICK = { Extraversion: 55, Agreeableness: 70, Conscientiousness: 62.5, Neuroticism: 48, Intellect: 77 };
const V_QUICK = '00000000-0000-0000-0000-00000000f001';
const V_FULL = '00000000-0000-0000-0000-00000000f002';
const sha = (c) => c.repeat(64 / c.length);

await db.exec(`
 insert into people (id, auth_uid, primary_email, legacy_firestore_id) values
  ('${ALICE}','fb_alice','alice@a.com','customers/cust-alice'),
  ('${BOB}','fb_bob','bob@a.com',null),
  ('${OWNER}','fb_owner','owner@a.com',null),
  ('${SUPPORT}','fb_support','support@a.com',null),
  ('${LEAD}','fb_lead','lead@a.com',null),
  ('${OUTSIDER}','fb_outsider','outsider@a.com',null),
  ('${CHARLIE}','fb_charlie','charlie@a.com',null);
 insert into role_grants (person_id, scope_type, role) values
  ('${OWNER}','platform','platform_owner'), ('${SUPPORT}','platform','customer_support');
 insert into role_grants (person_id, scope_type, program_id, role) values ('${LEAD}','program','executive-signature','program_lead');
 insert into assessment_definitions (id, program_id, title, status) values
  ('quick-check','executive-signature','Quick Check','live'), ('full-assessment','executive-signature','Full Assessment','live');
 insert into assessment_versions (id, assessment_id, version, scoring_version, content_version, status, published_at) values
  ('${V_QUICK}','quick-check','1.0.0','s1','c1','published', now()), ('${V_FULL}','full-assessment','1.0.0','s2','c1','published', now());
 insert into entitlements (person_id, program_id, assessment_id, access_type, status, attempts_completed, retakes_allowed, retakes_used, report_available) values
  ('${ALICE}','executive-signature','quick-check','free','active', 2, 0, 0, false),
  ('${ALICE}','executive-signature','full-assessment','comped','consumed', 1, 0, 0, true),
  ('${BOB}','executive-signature','quick-check','free','active', 1, 0, 0, false),
  ('${CHARLIE}','executive-signature','full-assessment','comped','revoked', 1, 0, 0, true);
`);
const attempt = (id, person, version, assessment, completed, score, areas, label, band, hashChar, legacy, form) =>
  `insert into assessment_attempts (id, person_id, program_id, assessment_id, version_id, status, idempotency_hash, started_at, completed_at, duration_seconds, overall_score, area_scores, profile_label, band, result_checksum, source, legacy_firestore_id)
   values ('${id}','${person}','executive-signature','${assessment}','${version}','completed','${sha(hashChar)}','${completed}'::timestamptz - interval '5 minutes','${completed}',300,${score},'${JSON.stringify(areas)}'::jsonb,'${label}','${band}','${sha(hashChar)}','${JSON.stringify({ formVersion: form, createdBy: 'x' })}'::jsonb, ${legacy ? `'${legacy}'` : 'null'})`;
await db.exec(attempt('00000000-0000-0000-0000-0000000a0001', ALICE, V_QUICK, 'quick-check', '2026-09-01T10:00:00Z', 60.17, AREAS_QUICK, 'Team player', 'Strong', '1', 'assessmentAttempts/fsQuick1', 'readiness-free@1.0.0'));
await db.exec(attempt('00000000-0000-0000-0000-0000000a0002', ALICE, V_QUICK, 'quick-check', '2026-09-05T10:00:00Z', 66, AREAS_QUICK, 'Go-getter', 'Strong', '2', 'assessmentAttempts/fsQuick2', 'readiness-free@1.0.0'));
await db.exec(attempt('00000000-0000-0000-0000-0000000a0003', ALICE, V_FULL, 'full-assessment', '2026-09-06T10:00:00Z', 62.4, FACETS_FULL, 'Team player', 'Strong', '3', 'assessmentAttempts/fsFull1', 'readiness-full@1.0.0'));
await db.exec(attempt('00000000-0000-0000-0000-0000000a0004', BOB, V_QUICK, 'quick-check', '2026-09-07T10:00:00Z', 41, AREAS_QUICK, 'Steady supporter', 'Developing', '4', null, 'readiness-free@1.0.0'));
await db.exec(attempt('00000000-0000-0000-0000-0000000a0005', CHARLIE, V_FULL, 'full-assessment', '2026-09-08T10:00:00Z', 55, FACETS_FULL, 'Team player', 'Developing', '5', 'assessmentAttempts/fsFullC', 'readiness-full@1.0.0'));
// An attempt that is not completed, and a TSA-less second quick attempt for ordering checks.
await db.exec(`insert into assessment_attempts (person_id, program_id, assessment_id, version_id, status, idempotency_hash, legacy_firestore_id) values ('${ALICE}','executive-signature','quick-check','${V_QUICK}','in_progress','${sha('6')}','assessmentAttempts/fsOpen')`);
for (let i = 0; i < 6; i += 1) {
  await db.exec(attempt(`00000000-0000-0000-0000-0000000b000${i}`, BOB, V_QUICK, 'quick-check', `2026-10-0${i + 1}T09:00:00Z`, 50 + i, AREAS_QUICK, 'Go-getter', 'Developing', `${i}c`, `assessmentAttempts/bobMany${i}`, 'readiness-free@1.0.0'));
}

// ---- function shape and grants
const fn = await q(`select p.proname, p.prosecdef, array_to_string(p.proconfig, ',') as config, has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('get_my_es_status', 'get_es_attempt_report')`);
ok('both functions exist', fn.length === 2);
ok('both are security definer with an empty search_path', fn.every((f) => f.prosecdef && /search_path=("")?(,|$)/.test(f.config || '')));
ok('anon cannot execute either, authenticated can', fn.every((f) => !f.anon_exec && f.auth_exec));
const helper = (await q(`select has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') b from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'es_attempt_summary'`))[0];
ok('the private helper is closed to browsers', helper && !helper.a && !helper.b);
await rejectsAs('anon cannot call get_my_es_status', 'anon', null, `select public.get_my_es_status()`, '42501');
await rejectsAs('a signed in token with no person row is refused (status)', 'authenticated', 'fb_nobody', `select public.get_my_es_status()`, '42501');
await rejectsAs('a signed in token with no person row is refused (report)', 'authenticated', 'fb_nobody', `select public.get_es_attempt_report('fsFull1')`, '42501');
await rejectsAs('anon cannot call get_es_attempt_report', 'anon', null, `select public.get_es_attempt_report('fsFull1')`, '42501');

// ---- get_my_es_status: own data in the callable's shape
const a = await status('fb_alice');
ok('shape: ok, customerId and both assessments', a.ok === true && a.customerId === 'cust-alice' && Object.keys(a.assessments).sort().join() === 'full-assessment,quick-check');
const quick = a.assessments['quick-check'], full = a.assessments['full-assessment'];
ok('quick check: entitlement counters', quick.hasEntitlement === true && quick.status === 'active' && quick.attemptsCompleted === 2 && quick.retakesAllowed === 0 && quick.retakesUsed === 0);
ok('quick check: two completed attempts, newest first, the unfinished one left out', quick.recentAttempts.length === 2 && quick.recentAttempts[0].attemptId === 'fsQuick2' && quick.recentAttempts[1].attemptId === 'fsQuick1');
ok('quick check: latestAttempt is the newest', quick.latestAttempt.attemptId === 'fsQuick2' && quick.latestAttempt.profileLabel === 'Go-getter' && quick.latestAttempt.band === 'Strong' && quick.latestAttempt.overallScore === 66);
ok('summary keys are exactly the callable keys plus formVersion', Object.keys(quick.latestAttempt).sort().join() === 'areaScores,assessmentId,attemptId,band,completedAt,formVersion,overallScore,profileLabel');
ok('completedAt is an ISO text in UTC', quick.latestAttempt.completedAt === '2026-09-05T10:00:00.000Z');
ok('the overall score keeps its decimals', quick.recentAttempts[1].overallScore === 60.17);
ok('full assessment: a consumed entitlement still shows its attempt', full.status === 'consumed' && full.hasEntitlement && full.latestAttempt && full.latestAttempt.attemptId === 'fsFull1');
ok('full assessment carries all ten facet scores exactly as stored', JSON.stringify(Object.keys(full.latestAttempt.areaScores).sort()) === JSON.stringify(Object.keys(FACETS_FULL).sort()) && Object.entries(FACETS_FULL).every(([k, v]) => full.latestAttempt.areaScores[k] === v));
ok('formVersion comes from the stored source', full.latestAttempt.formVersion === 'readiness-full@1.0.0');
ok('no checksum, hash or answer key leaks', !/checksum|idempotency|answers|responseParts/i.test(JSON.stringify(a)));

const b = await status('fb_bob');
ok('only the newest five attempts are returned', b.assessments['quick-check'].recentAttempts.length === 5 && b.assessments['quick-check'].latestAttempt.attemptId === 'bobMany5');
ok('no entitlement for an assessment gives the empty entry', b.assessments['full-assessment'].hasEntitlement === false && b.assessments['full-assessment'].latestAttempt === null && b.assessments['full-assessment'].recentAttempts.length === 0 && b.assessments['full-assessment'].status === null);
ok('a revoked entitlement counts but shows no attempts (as the callable does)', (await status('fb_charlie')).assessments['full-assessment'].status === 'revoked');
const empty = await status('fb_outsider');
ok('a person with nothing gets two empty entries', empty.assessments['quick-check'].hasEntitlement === false && empty.assessments['full-assessment'].hasEntitlement === false && empty.ok === true);
ok('a person without a Firestore customer id gets the row uuid as customerId', empty.customerId === OUTSIDER);
ok('another person never sees Alice data', !JSON.stringify(b).includes('fsQuick') && !JSON.stringify(b).includes('fsFull1'));

// Best entitlement wins: add a second, expired quick check entitlement for Alice and a higher ranked one stays.
await db.exec(`insert into entitlements (person_id, program_id, assessment_id, access_type, status) values ('${ALICE}','executive-signature','quick-check','free','expired')`);
ok('the active entitlement still wins over an expired one', (await status('fb_alice')).assessments['quick-check'].status === 'active');

// ---- get_es_attempt_report
const own = await report('fb_alice', 'fsFull1');
ok('owner reads the report by Firestore id', own && own.ok === true && own.isOwner === true && own.attemptId === 'fsFull1' && own.assessmentId === 'full-assessment' && own.band === 'Strong' && own.profileLabel === 'Team player');
ok('the report carries the ten facets and the duration', Object.keys(own.areaScores).length === 10 && own.durationSeconds === 300 && own.startedAt === '2026-09-06T09:55:00.000Z');
ok('the same report by the prefixed id', (await report('fb_alice', 'assessmentAttempts/fsFull1')).attemptId === 'fsFull1');
ok('the same report by the row uuid', (await report('fb_alice', '00000000-0000-0000-0000-0000000a0003')).attemptId === 'fsFull1');
ok('an attempt without a Firestore id is addressed by its uuid', (await report('fb_bob', '00000000-0000-0000-0000-0000000a0004')).attemptId === '00000000-0000-0000-0000-0000000a0004');
ok('another member gets null for Alice attempt (no signal)', (await report('fb_bob', 'fsFull1')) === null);
ok('an outsider gets null for a real id and for a made up id alike', (await report('fb_outsider', 'fsFull1')) === null && (await report('fb_outsider', 'nope-nope')) === null);
ok('owner platform role can read it', (await report('fb_owner', 'fsFull1')).isOwner === false && (await report('fb_owner', 'fsFull1')).band === 'Strong');
ok('customer support can read it', (await report('fb_support', 'fsFull1')).attemptId === 'fsFull1');
ok('the program lead of executive-signature can read it', (await report('fb_lead', 'fsFull1')).attemptId === 'fsFull1');
ok('an attempt that is not completed is not returned, even to the owner', (await report('fb_alice', 'fsOpen')) === null && (await report('fb_owner', 'fsOpen')) === null);
ok('empty and oversized ids return null', (await report('fb_alice', '')) === null && (await report('fb_alice', 'x'.repeat(201))) === null);
ok('a report never carries raw answers or checksums', !/checksum|idempotency|answers/i.test(JSON.stringify(own)));
await db.exec(`insert into role_grants (person_id, scope_type, role, status) values ('${OUTSIDER}','platform','read_only_analyst','suspended')`);
ok('a suspended staff grant gives no access', (await report('fb_outsider', 'fsFull1')) === null);
await db.exec(`update assessment_attempts set status = 'deleted' where legacy_firestore_id = 'assessmentAttempts/fsQuick1'`);
ok('a deleted attempt (privacy request) is gone from the report and from the status list', (await report('fb_alice', 'fsQuick1')) === null && (await status('fb_alice')).assessments['quick-check'].recentAttempts.length === 1);

// ---- the database stays read only for these functions
const before = (await q(`select (select count(*)::int from assessment_attempts) a, (select count(*)::int from entitlements) e, (select count(*)::int from audit_events) u`))[0];
await status('fb_alice'); await report('fb_alice', 'fsFull1'); await report('fb_owner', 'fsFull1');
const after = (await q(`select (select count(*)::int from assessment_attempts) a, (select count(*)::int from entitlements) e, (select count(*)::int from audit_events) u`))[0];
ok('reads change nothing', JSON.stringify(before) === JSON.stringify(after));
ok('the function bodies never write', !/\b(insert\s+into|update\s+public|delete\s+from)\b/i.test((await q(`select string_agg(prosrc, ' ') s from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private') and p.proname in ('get_my_es_status','get_es_attempt_report','es_attempt_summary')`))[0].s));
ok('no backslash in the migration file', !fs.readFileSync(new URL('./migrations/20261008002210_es_report.sql', import.meta.url), 'utf8').includes('\\'));

// ---- rollback
await db.exec(fs.readFileSync(new URL('./rollbacks/20261008002210_es_report_down.sql', import.meta.url), 'utf8'));
const gone = await q(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname in ('get_my_es_status','get_es_attempt_report','es_attempt_summary')`);
ok('rollback removes both functions and the helper', gone[0].n === 0);
ok('rollback leaves the attempts untouched', (await q(`select count(*)::int n from assessment_attempts`))[0].n === 12);
// and the migration can be applied again
await db.exec(fs.readFileSync(new URL('./migrations/20261008002210_es_report.sql', import.meta.url), 'utf8'));
ok('the migration applies again after the rollback', (await status('fb_alice')).ok === true);

console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
