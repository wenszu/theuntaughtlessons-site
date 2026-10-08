// Tests for migration 20261008002350: the question bank screen of the admin console as database functions, and the rollback.
//   node supabase/question-bank-test.mjs
// Covers: who may call each function (42501 for everyone but a platform owner, anon cannot execute), the numbers (compared with the
// JavaScript reference in assets/supabase-question-bank.js on one data set, plus a few hand checked values), privacy (counts only: no
// person, no attempt id, no date, no other item field, nothing from attempts that did not come through the item attempt path), odd stored
// values, the review write (validation, dry run, log kept to 100 entries, entry built by the database, audit row without the note), no
// writes by the reads, and the rollback.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { isDeepStrictEqual } from 'util';
import { boot } from './schema-apply-harness.mjs';

const { db, failed } = await boot();
if (failed) { console.log('FAIL migrations did not apply'); process.exit(1); }
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, !c && d ? `[${d}]` : ''); };
const as = async (role, sub, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${sub ? JSON.stringify({ sub, role: role === 'anon' ? 'anon' : 'authenticated' }) : ''}', false);`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
};
const codeOf = (e) => e.code || (e.message.match(/\b(\d{2}[0-9A-Z]{3})\b/) || [])[1] || '';
const rejectsAs = async (n, role, sub, sql, code) => {
  try { await as(role, sub, sql); ok(n, false, 'did not fail'); }
  catch (e) { const got = codeOf(e); ok(`${n}  [${got || e.message.slice(0, 50)}]`, !code || got === code, e.message.slice(0, 120)); }
};
const q = async (s, p) => (await db.query(s, p)).rows;
const call = async (sub, sql) => (await as('authenticated', sub, `select ${sql} as r`))[0].r;
const j = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

// The JavaScript reference (an ES module in a .js file: copied to a temporary .mjs so that Node loads it as a module).
const copy = path.join(os.tmpdir(), `utl-question-bank-${process.pid}.mjs`);
fs.copyFileSync(new URL('../assets/supabase-question-bank.js', import.meta.url), copy);
process.on('exit', () => { try { fs.unlinkSync(copy); } catch (e) { /* best effort */ } });
const reference = await import(pathToFileURL(copy).href);

// ---- people
const OWNER = 'fb_owner', SUPPORT = 'fb_support', NOBODY = 'fb_nobody';
const ID = { owner: U(1), support: U(2), nobody: U(3), m1: U(11), m2: U(12), m3: U(13), m4: U(14) };
await db.exec(`
 insert into people (id, auth_uid, primary_email, display_name) values
  ('${ID.owner}','${OWNER}','owner@utl.test','Olive Owner'),
  ('${ID.support}','${SUPPORT}','support@utl.test','Sam Support'),
  ('${ID.nobody}','${NOBODY}','nobody@utl.test','Nora Nobody'),
  ('${ID.m1}','fb_m1','m1@utl.test','Mia One'),
  ('${ID.m2}','fb_m2','m2@utl.test','Max Two'),
  ('${ID.m3}','fb_m3','m3@utl.test','Mo Three'),
  ('${ID.m4}','fb_m4','m4@utl.test','Mae Four');
 insert into role_grants (person_id, scope_type, role) values ('${ID.owner}','platform','platform_owner'), ('${ID.support}','platform','customer_support');
 insert into enrollments (person_id, program_id, status) values ('${ID.m1}','tsa','active'), ('${ID.m2}','tsa','active'), ('${ID.m3}','tsa','active'), ('${ID.m4}','tsa','active');
`);

// ---- attempts, written the way the browser writes them (record_tsa_item_attempt), and the same documents in Firestore shape
const MEMBERS = ['fb_m1', 'fb_m2', 'fb_m3', 'fb_m4'];
const BANK = '2026-08-13-v1', RUBRIC = 'tsa-unified-20260814-c3-mc13';
const docs = [];
const item = (id, version, o) => ({ questionId: id, questionVersion: version, format: 1, intendedDifficulty: 'core', selectedAnswer: 1, correctAnswer: 1, correct: true, responseTimeMs: 4000, answerChanges: 0, questionPosition: 1, feedbackType: '', feedbackComment: '', assessmentTotal: 50, ...o });
const NOTE = 'PRIVATE-FORM-MARKER';
for (let i = 0; i < 14; i += 1) {
  const assessment = i % 3 === 2 ? 'checkpoint' : 'diagnostic';
  const total = 40 + i * 3;
  const correct = i % 3 !== 0;
  const items = [
    item('f1-01', 1, { correct, selectedAnswer: correct ? 1 : (i % 4), responseTimeMs: 3000 + i * 500, answerChanges: i % 2, assessmentTotal: total,
      feedbackType: i === 5 ? 'unclear_term' : (i === 9 ? 'other' : ''), feedbackComment: i === 5 ? 'The word is unclear' : (i === 9 ? `Tab${String.fromCharCode(9)}and line${String.fromCharCode(10)}break` : '') })
  ];
  if (i < 6) items.push(item('f1-02', 1, { correct: i % 2 === 0, selectedAnswer: 2, responseTimeMs: 8000 + i, answerChanges: 0, assessmentTotal: total }));
  if (i >= 12) items.push(item('f1-01', 2, { correct: true, selectedAnswer: 3, assessmentTotal: total }));
  if (i === 0) {
    items.push(item('bad id!', 1, {}));
    items.push(item('-lead', 1, {}));                                                      // an id may not start with a dash
    items.push(item('f1-09', '1', {}));                                                   // a text version is not counted
    items.push(item('f1-01', 1, { correct: 'true', selectedAnswer: 7, responseTimeMs: 1e12, assessmentTotal: 500, feedbackType: 7, feedbackComment: 5 }));
    items.push({ questionId: 'f1-03', questionVersion: 1, correct: true, formMarker: NOTE });   // an extra field is never returned; no assessmentTotal
  }
  const completedAt = `2026-01-${String(10 + i).padStart(2, '0')}T10:00:00Z`;
  docs.push({ key: `qb-attempt-key-${String(i).padStart(2, '0')}`, member: MEMBERS[i % 4], assessment, totalScore: total, completedAt, items });
}
const attemptIds = [];
for (const d of docs) {
  const r = await call(d.member, `record_tsa_item_attempt('${d.key}', '${d.assessment}', '${BANK}', '${RUBRIC}', 'A', ${d.totalScore}, ${j(d.items)}, '${d.completedAt}')`);
  attemptIds.push(r.attempt_id);
  d.id = d.key;
}
ok('fourteen attempts were stored through the browser function', attemptIds.length === 14 && attemptIds.every(Boolean));

// An attempt row that did NOT come through the item attempt path must be left out (no legacy id of that path).
const stray = await q(`insert into assessment_attempts (person_id, program_id, assessment_id, version_id, status, idempotency_hash, completed_at, overall_score, response_checksum, result_checksum, source)
  select person_id, program_id, assessment_id, version_id, 'completed', '${'e'.repeat(64)}', '2026-01-30T10:00:00Z', 50, '${'a'.repeat(64)}', '${'b'.repeat(64)}', '{}'::jsonb from assessment_attempts limit 1 returning id`);
await db.exec(`insert into assessment_response_parts (attempt_id, part_number, part_count, answers, scoring_inputs, response_checksum) values ('${stray[0].id}', 1, 1, ${j([item('ZZ-EXCLUDED', 1, {})])}, '{}'::jsonb, '${'c'.repeat(64)}')`);

// ---- the functions
const fns = await q(`select p.proname, p.prosecdef, array_to_string(p.proconfig, ',') cfg, p.prosrc, pg_get_function_identity_arguments(p.oid) args,
    has_function_privilege('anon', p.oid, 'execute') anon_x, has_function_privilege('authenticated', p.oid, 'execute') auth_x
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('admin_item_health','admin_item_reviews','admin_save_item_review')`);
ok('the three functions exist', fns.length === 3);
for (const f of fns) {
  ok(`${f.proname}: security definer, empty search_path, authenticated only`, f.prosecdef && /search_path=("")?(,|$)/.test(f.cfg || '') && !f.anon_x && f.auth_x);
  const afterBegin = f.prosrc.slice(f.prosrc.search(/\bbegin\b/i) + 5).trimStart();
  ok(`${f.proname}: the platform owner check is the first statement and refuses with 42501`, /^if not private\.has_platform_role\(array\['platform_owner'\]\) then\s+raise exception[^;]*errcode = '42501';/i.test(afterBegin));
  ok(`${f.proname}: no dynamic sql, no backslash`, !/^\s*execute\b/im.test(f.prosrc) && !f.prosrc.includes(String.fromCharCode(92)));
}
for (const f of fns.filter((x) => x.proname !== 'admin_save_item_review')) {
  ok(`${f.proname}: takes no argument and never writes`, f.args === '' && !/\b(insert\s+into|update\s+public|delete\s+from|create\s+temp)/i.test(f.prosrc));
  ok(`${f.proname}: never selects a person, a person id, an email or a date of an attempt`, !/person_id|primary_email|display_name|auth_uid|public\.people/i.test(f.prosrc));
}
const save = fns.find((x) => x.proname === 'admin_save_item_review');
ok('admin_save_item_review: one jsonb document and the dry run flag', save.args === 'p_input jsonb, p_dry_run boolean', save.args);
ok('admin_save_item_review: writes only assessment_item_reviews and (through aw_audit) audit_events',
  [...save.prosrc.matchAll(/(?:insert\s+into|update|delete\s+from)\s+public\.([a-z_]+)/gi)].every((m) => m[1].toLowerCase() === 'assessment_item_reviews') && !/insert\s+into\s+public\.audit_events/i.test(save.prosrc) && /private\.aw_audit/.test(save.prosrc));
const helpers = await q(`select p.proname, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') b
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname in ('qb_iso','qb_review_json')`);
ok('the two private helpers exist and are closed to browsers', helpers.length === 2 && helpers.every((h) => !h.a && !h.b));
const ddl = fs.readFileSync(new URL('./migrations/20261008002350_question_bank.sql', import.meta.url), 'utf8') + fs.readFileSync(new URL('./rollbacks/20261008002350_question_bank_down.sql', import.meta.url), 'utf8');
ok('no backslash anywhere in the migration or its rollback', !ddl.includes(String.fromCharCode(92)));

// ---- permissions
const CALLS = [
  ['admin_item_health', 'admin_item_health()'],
  ['admin_item_reviews', 'admin_item_reviews()'],
  ['admin_save_item_review', `admin_save_item_review(${j({ questionId: 'f1-01', reviewStatus: 'Watch' })}, true)`]
];
for (const [name, sql] of CALLS) {
  await rejectsAs(`${name}: anon refused`, 'anon', null, `select ${sql}`, '42501');
  await rejectsAs(`${name}: a signed in person without a role refused`, 'authenticated', NOBODY, `select ${sql}`, '42501');
  await rejectsAs(`${name}: customer_support refused`, 'authenticated', SUPPORT, `select ${sql}`, '42501');
  await rejectsAs(`${name}: a member refused`, 'authenticated', 'fb_m1', `select ${sql}`, '42501');
  await rejectsAs(`${name}: a token with no person refused`, 'authenticated', 'fb_unknown', `select ${sql}`, '42501');
  await rejectsAs(`${name}: no token at all refused`, 'authenticated', null, `select ${sql}`, '42501');
  const r = await call(OWNER, sql);
  ok(`${name}: the platform owner gets an answer with ok true`, r && r.ok === true, JSON.stringify(r).slice(0, 100));
}

// ---- the numbers, against the JavaScript reference on the same attempts
const before = await q(`select (select count(*) from audit_events) a, (select count(*) from assessment_item_reviews) r, (select count(*) from assessment_attempts) t, (select count(*) from people) p`);
const health = await call(OWNER, 'admin_item_health()');
const after = await q(`select (select count(*) from audit_events) a, (select count(*) from assessment_item_reviews) r, (select count(*) from assessment_attempts) t, (select count(*) from people) p`);
ok('the health read wrote nothing', JSON.stringify(before) === JSON.stringify(after));
const expected = reference.summarizeItemAttempts(docs.map((d) => ({ id: d.id, assessment: d.assessment, totalScore: d.totalScore, completedAt: d.completedAt, items: d.items })), {});
ok('attempts counted: 14 in all, the stray one left out', health.attempts.all === 14 && health.attempts.all === expected.attempts.all
  && health.attempts.diagnostic === expected.attempts.diagnostic && health.attempts.checkpoint === expected.attempts.checkpoint, JSON.stringify(health.attempts));
ok('not truncated', health.truncated === false);
const near = (a, b) => (a === null || b === null ? a === b : Math.abs(a - b) < 1e-9);
const keyOf = (g) => `${g.scope}|${g.questionId}|${g.questionVersion}`;
const sqlGroups = new Map(health.items.map((g) => [keyOf(g), g]));
const jsGroups = new Map(expected.items.map((g) => [keyOf(g), g]));
ok('the same question groups as the reference', [...sqlGroups.keys()].sort().join() === [...jsGroups.keys()].sort().join(), `${[...sqlGroups.keys()].sort().join()}  VS  ${[...jsGroups.keys()].sort().join()}`);
for (const [key, g] of jsGroups) {
  const s = sqlGroups.get(key);
  if (!s) { ok(`group ${key}`, false, 'missing'); continue; }
  const same = ['n', 'correct', 'diagnosticN', 'diagnosticCorrect', 'checkpointN', 'checkpointCorrect', 'changed', 'reports'].every((f) => s[f] === g[f])
    && JSON.stringify(s.optionCounts) === JSON.stringify(g.optionCounts) && near(s.medianMs, g.medianMs) && near(s.discrimination, g.discrimination);
  ok(`group ${key}: counts, option counts, median and discrimination equal the reference`, same, `${JSON.stringify(s)}  VS  ${JSON.stringify(g)}`);
}
ok('the items come back in a fixed order (scope, question, version)', JSON.stringify(health.items.map(keyOf)) === JSON.stringify(expected.items.map(keyOf)));
ok('the quality reports equal the reference (order and text)', isDeepStrictEqual(health.reports, expected.reports), JSON.stringify(health.reports).slice(0, 300));

// Hand checked values for the main question, all scopes (f1-01, version 1): rows 0..13 plus the odd row of attempt 0.
{
  const all = sqlGroups.get('all|f1-01|1');
  ok('hand check: f1-01 v1 has 15 responses (14 attempts and the odd row)', all.n === 15, String(all.n));
  const correctCount = [...Array(14).keys()].filter((i) => i % 3 !== 0).length;   // the odd row says correct:"true" (a text), which is not true
  ok('hand check: correct counts only the json value true', all.correct === correctCount, String(all.correct));
  const diag = sqlGroups.get('diagnostic|f1-01|1');
  const chk = sqlGroups.get('checkpoint|f1-01|1');
  ok('hand check: diagnostic and checkpoint responses add up to all', diag.n + chk.n === all.n && diag.n === 10 + 1 && chk.n === 4, `${diag.n} ${chk.n}`);
  ok('hand check: scopes keep their own counts (a diagnostic scope has no checkpoint responses)', diag.checkpointN === 0 && chk.diagnosticN === 0 && all.diagnosticN === diag.n && all.checkpointN === chk.n);
  ok('hand check: option counts add up to the responses with a selected answer from 0 to 3 (the odd row chose 7)', all.optionCounts.reduce((a, b) => a + b, 0) === 14, JSON.stringify(all.optionCounts));
  ok('hand check: the response time of 1e12 is ignored in the median (14 times)', (() => { const ms = [...Array(14).keys()].map((i) => 3000 + i * 500); ms.sort((a, b) => a - b); return all.medianMs === (ms[6] + ms[7]) / 2; })(), String(all.medianMs));
  ok('hand check: answer changes counted (odd attempt numbers)', all.changed === 7, String(all.changed));
  ok('hand check: two quality reports on f1-01 v1 (the odd row has a number as a type and is not a report)', all.reports === 2, String(all.reports));
  ok('hand check: f1-01 version 2 is its own group with two responses', sqlGroups.get('all|f1-01|2').n === 2);
  ok('hand check: f1-02 has 6 responses, f1-03 has 1 and no total (no discrimination)', sqlGroups.get('all|f1-02|1').n === 6 && sqlGroups.get('all|f1-03|1').n === 1 && sqlGroups.get('all|f1-03|1').discrimination === null);
  ok('hand check: fewer than 10 responses has no discrimination, 10 or more has a number between -1 and 1', sqlGroups.get('all|f1-02|1').discrimination === null && typeof all.discrimination === 'number' && Math.abs(all.discrimination) <= 1);
  ok('hand check: junk is dropped (a text version, an id with a space, a question that is not in the data)', !health.items.some((g) => g.questionId === 'bad id!' || g.questionId === '-lead' || g.questionId === 'f1-09' || g.questionId === 'ZZ-EXCLUDED'));
}
{
  // The page's own formula for one question, from the reference stats (not the database), for the three scopes.
  const stats = reference.questionStats(health, 'all', 'f1-01', 1);
  ok('questionStats over the database answer: n, rates, option counts, reports', stats.n === 15 && stats.reports.length === 2 && stats.optionCounts.length === 4 && stats.correctRate !== null && stats.diagnosticRate !== null && stats.checkpointRate !== null);
  const diagnostic = reference.questionStats(health, 'diagnostic', 'f1-01', 1);
  ok('questionStats: a diagnostic scope has no checkpoint rate and fewer reports', diagnostic.checkpointRate === null && diagnostic.n === 11);
  const none = reference.questionStats(health, 'all', 'f1-99', 1);
  ok('questionStats: an unknown question has zero responses and null rates', none.n === 0 && none.correctRate === null && none.reportRate === null && none.discrimination === null);
}

// ---- privacy: counts only
{
  const text = JSON.stringify(health);
  ok('privacy: no person id, attempt id, email, name or auth id appears in the answer', ![...Object.values(ID), ...attemptIds, 'm1@utl.test', 'Mia One', 'fb_m1', 'owner@utl.test'].some((s) => text.includes(s)));
  ok('privacy: no date of an attempt appears', !/2026-01-/.test(text) && !/completed/i.test(text));
  ok('privacy: a field the page does not use is never returned', !text.includes(NOTE) && !text.includes('formMarker') && !text.includes('correctAnswer') && !text.includes('questionPosition') && !text.includes('intendedDifficulty'));
  ok('privacy: top level keys', Object.keys(health).sort().join() === 'attempts,items,ok,reports,reviewStatuses,truncated', Object.keys(health).sort().join());
  ok('privacy: item keys', health.items.every((g) => Object.keys(g).sort().join() === 'changed,checkpointCorrect,checkpointN,correct,diagnosticCorrect,diagnosticN,discrimination,medianMs,n,optionCounts,questionId,questionVersion,reports,scope'));
  ok('privacy: report keys are the type, the comment and where it belongs, nothing else', health.reports.every((r) => Object.keys(r).sort().join() === 'assessment,feedbackComment,feedbackType,questionId,questionVersion'));
  const hit = health.reports.find((r) => r.feedbackType === 'other');
  ok('privacy: control characters in a comment become spaces, a comment is cut to 500 characters', hit && !/[\u0000-\u001f]/.test(hit.feedbackComment) && hit.feedbackComment === 'Tab and line break');
}

// ---- the review write
const reviewIn = (o = {}) => ({ questionId: 'f1-01', reviewStatus: 'Watch', currentNote: 'Looks too easy', questionVersion: 1, bankRelease: BANK, ...o });
const saveSql = (input, dry) => `admin_save_item_review(${j(input)}, ${dry ? 'true' : 'false'})`;
{
  const dry = await call(OWNER, saveSql(reviewIn(), true));
  ok('dry run: answers with the review and the rows it would write, dryRun true', dry.ok === true && dry.dryRun === true && dry.wouldWrite.assessment_item_reviews.length === 1 && dry.wouldWrite.audit_events.length === 1);
  ok('dry run: writes nothing at all', Number((await q('select count(*) n from assessment_item_reviews'))[0].n) === 0 && Number((await q(`select count(*) n from audit_events where action = 'item_review_saved'`))[0].n) === 0);
  const r = await call(OWNER, saveSql(reviewIn(), false));
  ok('first save: ok, not a dry run', r.ok === true && r.dryRun === false);
  ok('first save: the review has the Firestore document keys', Object.keys(r.review).sort().join() === 'bankRelease,currentNote,decisionLog,questionId,questionVersion,reviewStatus,updatedAt');
  ok('first save: values', r.review.questionId === 'f1-01' && r.review.reviewStatus === 'Watch' && r.review.currentNote === 'Looks too easy' && r.review.questionVersion === 1 && r.review.bankRelease === BANK);
  ok('first save: one log entry built by the database (time, status, note, by, version)', r.review.decisionLog.length === 1
    && Object.keys(r.review.decisionLog[0]).sort().join() === 'at,by,note,questionVersion,status'
    && r.review.decisionLog[0].by === 'owner@utl.test' && r.review.decisionLog[0].status === 'Watch' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r.review.decisionLog[0].at));
  const row = (await q(`select * from assessment_item_reviews where question_key = 'f1-01'`))[0];
  ok('first save: one row under tsa-diagnostic with the legacy id, the reviewer and the review', row.assessment_id === 'tsa-diagnostic' && row.legacy_firestore_id === 'assessment_item_reviews/f1-01' && row.reviewed_by === ID.owner && row.review.reviewStatus === 'Watch');
  const audit = (await q(`select * from audit_events where action = 'item_review_saved'`));
  ok('first save: one audit row with ids and counts, never the note', audit.length === 1 && audit[0].actor_person_id === ID.owner && audit[0].subject_id === 'f1-01'
    && isDeepStrictEqual(audit[0].detail, { reviewStatus: 'Watch', noteLength: 14, questionVersion: 1 }) && !JSON.stringify(audit[0]).includes('Looks too easy'));
  const r2 = await call(OWNER, saveSql(reviewIn({ reviewStatus: 'Revise', currentNote: 'Rewrite option B', questionVersion: 2 }), false));
  ok('second save: the same row, two log entries, newest last', r2.review.decisionLog.length === 2 && r2.review.decisionLog[1].status === 'Revise' && r2.review.decisionLog[0].status === 'Watch'
    && Number((await q('select count(*) n from assessment_item_reviews'))[0].n) === 1);
  const stale = (await q(`select review from assessment_item_reviews`))[0].review;
  ok('second save: the document holds the newest status, note and version', stale.reviewStatus === 'Revise' && stale.currentNote === 'Rewrite option B' && stale.questionVersion === 2);
  const loop = await q(`select updated_at > created_at as moved from assessment_item_reviews`);
  ok('second save: the update time moved', loop[0].moved === true);
  // The log is cut to the last 100 entries.
  for (let i = 0; i < 104; i += 1) await call(OWNER, saveSql(reviewIn({ currentNote: `note ${i}` }), false));
  const long = (await q(`select review from assessment_item_reviews`))[0].review;
  ok('the decision log keeps only its last 100 entries, newest last', long.decisionLog.length === 100 && long.decisionLog[99].note === 'note 103' && long.decisionLog[0].note === 'note 4', `${long.decisionLog.length} ${long.decisionLog[0].note}`);
  // A multi line note keeps its line break; the other control characters go.
  const withLines = await call(OWNER, saveSql(reviewIn({ questionId: 'f1-02', currentNote: `first${String.fromCharCode(10)}second${String.fromCharCode(1)}` }), false));
  ok('a note keeps a new line and loses other control characters', withLines.review.currentNote === `first${String.fromCharCode(10)}second`);
}
{
  const bad = [
    ['an unknown key', reviewIn({ decisionLog: [] })],
    ['a missing question id', { reviewStatus: 'Active' }],
    ['a question id with a space', reviewIn({ questionId: 'f1 01' })],
    ['a question id that starts with a dash', reviewIn({ questionId: '-f1' })],
    ['a question id longer than 64', reviewIn({ questionId: 'a'.repeat(65) })],
    ['an unknown status', reviewIn({ reviewStatus: 'Done' })],
    ['a missing status', { questionId: 'f1-01' }],
    ['a note over 1000 characters', reviewIn({ currentNote: 'x'.repeat(1001) })],
    ['a version of 0', reviewIn({ questionVersion: 0 })],
    ['a version with a fraction', reviewIn({ questionVersion: 1.5 })],
    ['a text version', reviewIn({ questionVersion: '1' })],
    ['a bank release with markup', reviewIn({ bankRelease: '<b>x</b>' })],
    ['a bank release over 80', reviewIn({ bankRelease: 'a'.repeat(81) })]
  ];
  for (const [label, input] of bad) await rejectsAs(`refused: ${label}`, 'authenticated', OWNER, `select ${saveSql(input, false)}`, '22023');
  await rejectsAs('refused: the input is not an object', 'authenticated', OWNER, `select admin_save_item_review('[]'::jsonb, false)`, '22023');
  const rows = Number((await q(`select count(*) n from assessment_item_reviews`))[0].n);
  ok('a refused save wrote nothing more (two questions have a review)', rows === 2, String(rows));
  // An empty note and an empty bank release are allowed (the page may send them).
  const minimal = await call(OWNER, saveSql({ questionId: 'f1-03', reviewStatus: 'Active', currentNote: '', questionVersion: 1, bankRelease: '' }, false));
  ok('an empty note and an empty bank release are saved', minimal.ok === true && minimal.review.currentNote === '' && minimal.review.bankRelease === '');
}

// ---- the review read, and the health read picks the status up
{
  const r = await call(OWNER, 'admin_item_reviews()');
  ok('reviews: three documents in question id order, shaped like the Firestore documents', r.reviews.map((x) => x.id).join() === 'f1-01,f1-02,f1-03'
    && r.reviews.every((x) => Object.keys(x).sort().join() === 'data,id' && Object.keys(x.data).sort().join() === 'bankRelease,currentNote,decisionLog,questionId,questionVersion,reviewStatus,updatedAt'));
  ok('reviews: the newest values', r.reviews[0].data.reviewStatus === 'Watch' && r.reviews[0].data.decisionLog.length === 100 && r.reviews[1].data.currentNote.includes('second'));
  ok('reviews: the answer has no reviewer id and no audit data', !JSON.stringify(r).includes(ID.owner) && !JSON.stringify(r).includes('legacy'));
  const h = await call(OWNER, 'admin_item_health()');
  ok('health: the review status of each reviewed question', h.reviewStatuses['f1-01'] === 'Watch' && h.reviewStatuses['f1-02'] === 'Watch' && h.reviewStatuses['f1-03'] === 'Active' && Object.keys(h.reviewStatuses).length === 3);
  // A hand made row with odd content still reads back in the right shape.
  await db.exec(`insert into assessment_item_reviews (assessment_id, question_key, review) values ('tsa-diagnostic', 'odd-one', '{"reviewStatus":"Bogus","currentNote":5,"decisionLog":"x"}')`);
  const odd = (await call(OWNER, 'admin_item_reviews()')).reviews.find((x) => x.id === 'odd-one');
  ok('reviews: an odd stored row reads back with safe defaults', odd.data.reviewStatus === 'Active' && odd.data.currentNote === '' && Array.isArray(odd.data.decisionLog) && odd.data.questionVersion === 1);
  await db.exec(`delete from assessment_item_reviews where question_key = 'odd-one'`);
}

// ---- odd stored values cannot break the screen, and a big answer text is bounded
{
  const wide = [];
  for (let k = 0; k < 6; k += 1) wide.push(item('wide-' + k, 1, { responseTimeMs: -5, answerChanges: 1e9, selectedAnswer: -1, assessmentTotal: -3, correct: null }));
  await call('fb_m1', `record_tsa_item_attempt('qb-odd-attempt-1', 'diagnostic', '${BANK}', '${RUBRIC}', 'A', 10, ${j(wide)}, '2026-01-28T10:00:00Z')`);
  const h = await call(OWNER, 'admin_item_health()');
  const g = h.items.find((x) => x.scope === 'all' && x.questionId === 'wide-0');
  ok('out of range numbers are ignored, not an error', g && g.n === 1 && g.medianMs === null && g.changed === 0 && g.optionCounts.join() === '0,0,0,0' && g.discrimination === null);
  await call(OWNER, 'admin_item_health()');
}

// ---- the rollback, then the migration again
{
  await db.exec(fs.readFileSync(new URL('./rollbacks/20261008002350_question_bank_down.sql', import.meta.url), 'utf8'));
  const gone = await q(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where (n.nspname = 'public' and p.proname in ('admin_item_health','admin_item_reviews','admin_save_item_review')) or (n.nspname = 'private' and p.proname like 'qb\\_%')`);
  ok('rollback: the three functions and two helpers are gone', gone[0].n === 0, String(gone[0].n));
  ok('rollback: the saved reviews and their audit rows stay', Number((await q('select count(*) n from assessment_item_reviews'))[0].n) === 3 && Number((await q(`select count(*) n from audit_events where action = 'item_review_saved'`))[0].n) >= 3);
  await db.exec(fs.readFileSync(new URL('./migrations/20261008002350_question_bank.sql', import.meta.url), 'utf8'));
  const again = await call(OWNER, 'admin_item_reviews()');
  ok('the migration applies again after the rollback', again.ok === true && again.reviews.length === 3);
}

console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
