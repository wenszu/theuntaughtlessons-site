// Tests for migration 2190: the TSA diagnostic and checkpoint item attempts and scoring comparisons, and the rollback.
//   node supabase/tsa-attempts-test.mjs
import fs from 'fs';
import crypto from 'crypto';
import { createRequire } from 'module';
import { isDeepStrictEqual } from 'util';
import { boot } from './schema-apply-harness.mjs';

const require = createRequire(import.meta.url);
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
const n1 = async (s) => Number((await q(s))[0].n);
const j = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const same = (a, b) => isDeepStrictEqual(a, b);
const call = async (sub, sql) => (await as('authenticated', sub, `select ${sql} as r`))[0].r;
const ALICE = 'fb_alice', BOB = 'fb_bob', NOENR = 'fb_noenr';
const ALICE_ID = '00000000-0000-0000-0000-000000000001';
const BOB_ID = '00000000-0000-0000-0000-000000000002';
const NOENR_ID = '00000000-0000-0000-0000-000000000003';
const ENROLLMENT = '60000000-0000-0000-0000-000000000001';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

await db.exec(`
 insert into people (id, auth_uid, primary_email) values
  ('${ALICE_ID}','fb_alice','alice@a.com'),
  ('${BOB_ID}','fb_bob','bob@a.com'),
  ('${NOENR_ID}','fb_noenr','noenr@a.com');
 insert into enrollments (id, person_id, program_id, status) values
  ('${ENROLLMENT}','${ALICE_ID}','tsa','active'),
  ('60000000-0000-0000-0000-000000000002','${BOB_ID}','tsa','active');
`);

const item = (i, extra = {}) => ({ questionId: 'q' + i, questionVersion: 'v1', format: 'mc', intendedDifficulty: 2, selectedAnswer: 1, correctAnswer: 1, correct: true, responseTimeMs: 4000 + i, answerChanges: 0, questionPosition: i + 1, feedbackType: '', feedbackComment: '', assessmentTotal: 61.5, ...extra });
const items = (n) => Array.from({ length: n }, (_, i) => item(i));
const BANK = '2026-08-13-v1', RUBRIC = 'tsa-unified-20260814-c3-mc13';
const attempt = (key, o = {}) => {
  const a = { assessment: 'diagnostic', bank: BANK, rubric: RUBRIC, form: 'A', total: 61.5, items: items(3), at: `'2026-10-01T10:00:00Z'`, ...o };
  return `record_tsa_item_attempt('${key}', '${a.assessment}', '${a.bank}', '${a.rubric}', '${a.form}', ${a.total}, ${j(a.items)}, ${a.at})`;
};
const comparison = (key, o = {}) => {
  const c = { assessment: 'diagnostic', rubric: RUBRIC, enabled: { speak: true, act: false }, official: { speak: 'genai', act: 'deterministic' },
    det: { speak: { total: 7 }, act: { total: 6 } }, gen: { speak: { total: 8 }, act: null }, diff: { speak: { total: 1 }, act: null }, model: 'model-x', ...o };
  return `record_tsa_scoring_comparison('${key}', '${c.assessment}', '${c.rubric}', ${j(c.enabled)}, ${j(c.official)}, ${j(c.det)}, ${j(c.gen)}, ${j(c.diff)}, '${c.model}')`;
};

// ---- the columns and the functions
const cols = await q(`select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name='assessment_scoring_comparisons' and column_name in ('enabled_by_task','official_source_by_task')`);
ok('two additive columns exist as jsonb, not null, default {}', cols.length === 2 && cols.every((c) => c.data_type === 'jsonb' && c.is_nullable === 'NO' && /'\{\}'::jsonb/.test(c.column_default)));
let badCol = ''; try { await db.exec(`insert into assessment_attempts (id, person_id, program_id, assessment_id, version_id, status, idempotency_hash) select gen_random_uuid(), '${ALICE_ID}', 'tsa', 'tsa-diagnostic', id, 'received', '${'f'.repeat(64)}' from assessment_versions limit 0`); } catch (e) { badCol = e.message; }
ok('setup sanity: direct insert shape accepted when no row', badCol === '');
const fns = await q(`select p.proname, p.prosecdef, array_to_string(p.proconfig, ',') cfg, has_function_privilege('anon', p.oid, 'execute') anon_x, has_function_privilege('authenticated', p.oid, 'execute') auth_x, p.prosrc
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private') and p.proname in ('record_tsa_item_attempt','record_tsa_scoring_comparison','tsa_ident','tsa_object')`);
const f = (name) => fns.find((x) => x.proname === name);
for (const name of ['record_tsa_item_attempt', 'record_tsa_scoring_comparison']) {
  ok(`${name}: security definer, empty search path, authenticated only`, f(name).prosecdef && /search_path=("")?(,|$)/.test(f(name).cfg) && !f(name).anon_x && f(name).auth_x);
  ok(`${name}: no dynamic sql, caller from the token`, !/^\s*execute\b/im.test(f(name).prosrc) && /private\.require_person_id\(\)/.test(f(name).prosrc));
}
ok('the two helpers are closed to browsers', ['tsa_ident', 'tsa_object'].every((h) => f(h) && !f(h).anon_x && !f(h).auth_x));
const ddl = fs.readFileSync(new URL('./migrations/20261008002190_tsa_item_attempts.sql', import.meta.url), 'utf8') + fs.readFileSync(new URL('./rollbacks/20261008002190_tsa_item_attempts_down.sql', import.meta.url), 'utf8');
ok('no backslash anywhere in the migration or its rollback', !ddl.includes(String.fromCharCode(92)));
await rejectsAs('anon cannot run the attempt function', 'anon', null, `select ${attempt('anon-attempt-1')}`, '42501');
await rejectsAs('anon cannot run the comparison function', 'anon', null, `select ${comparison('anon-attempt-1')}`, '42501');
await rejectsAs('a signed-out token is refused (attempt)', 'authenticated', null, `select ${attempt('signedout-1')}`, '42501');
await rejectsAs('a signed-out token is refused (comparison)', 'authenticated', null, `select ${comparison('signedout-1')}`, '42501');

// ---- the first attempt
const KEY1 = 'b2f2c2ae-1111-4222-8333-444455556666';
let r = await call(ALICE, attempt(KEY1));
ok('a first attempt is stored', r.inserted === true && r.assessment_id === 'tsa-diagnostic' && typeof r.attempt_id === 'string');
ok('the answer has exactly four keys', Object.keys(r).sort().join(',') === 'assessment_id,attempt_id,completed_at,inserted');
const A1 = r.attempt_id;
const row = (await q(`select * from assessment_attempts where id = '${A1}'`))[0];
ok('row: person, program, assessment, status, enrollment', row.person_id === ALICE_ID && row.program_id === 'tsa' && row.assessment_id === 'tsa-diagnostic' && row.status === 'completed' && row.enrollment_id === ENROLLMENT);
ok('row: score, completion time, creation time', Number(row.overall_score) === 61.5 && new Date(row.completed_at).toISOString() === '2026-10-01T10:00:00.000Z' && new Date(row.created_at).toISOString() === '2026-10-01T10:00:00.000Z');
ok('row: the import natural keys (hash of "tsa-attempt:" plus the id, and the legacy id)', row.idempotency_hash === sha('tsa-attempt:' + KEY1) && row.legacy_firestore_id === 'assessment_item_attempts/' + KEY1);
ok('row: source holds form, bank release and rubric version', same(row.source, { formId: 'A', bankRelease: BANK, rubricVersion: RUBRIC }));
ok('row: checksums are 64 hex characters and no run id', /^[0-9a-f]{64}$/.test(row.response_checksum) && /^[0-9a-f]{64}$/.test(row.result_checksum) && row.migration_run_id === null);
const part = (await q(`select * from assessment_response_parts where attempt_id = '${A1}'`));
ok('one response part: number 1 of 1 with the items as answers', part.length === 1 && part[0].part_number === 1 && part[0].part_count === 1 && same(part[0].answers, items(3)) && same(part[0].scoring_inputs, { formId: 'A' }) && part[0].payload === null);
const version = (await q(`select * from assessment_versions where id = '${row.version_id}'`))[0];
ok('version: published, named bank|rubric, with both version fields', version.status === 'published' && version.version === `${BANK}|${RUBRIC}` && version.scoring_version === RUBRIC && version.content_version === BANK && version.published_at !== null && same(version.questions, []));
ok('version: assessment id is the matching one', version.assessment_id === 'tsa-diagnostic');
ok('the program lead rule and definitions are untouched (two TSA definitions)', await n1(`select count(*) n from assessment_definitions where id in ('tsa-diagnostic','tsa-checkpoint')`) === 2);

// ---- a repeat of a key keeps the first write
r = await call(ALICE, attempt(KEY1, { total: 99, items: items(2), at: `'2026-10-02T10:00:00Z'`, form: 'B' }));
ok('a repeat returns the stored attempt and says it was not inserted', r.inserted === false && r.attempt_id === A1);
ok('a repeat returns the first completion time', new Date(r.completed_at).toISOString() === '2026-10-01T10:00:00.000Z');
ok('the repeat changed nothing in the attempt or its part', Number((await q(`select overall_score s from assessment_attempts where id='${A1}'`))[0].s) === 61.5 && same((await q(`select answers a from assessment_response_parts where attempt_id='${A1}'`))[0].a, items(3)));
ok('the repeat added no row', await n1(`select count(*) n from assessment_attempts where person_id = '${ALICE_ID}'`) === 1 && await n1(`select count(*) n from assessment_response_parts`) === 1);
let frozen = false; try { await db.exec(`update assessment_attempts set overall_score = 1 where id = '${A1}'`); } catch { frozen = true; }
ok('a completed attempt cannot be rewritten (existing trigger)', frozen);
let partsOpen = false; try { await as('authenticated', ALICE, `insert into assessment_response_parts (attempt_id, part_number, part_count, answers, response_checksum) values ('${A1}', 1, 1, '[]', '${'a'.repeat(64)}')`); partsOpen = true; } catch { /* expected */ }
ok('a learner cannot write response parts directly', !partsOpen);

// ---- a second attempt with the same bank and rubric reuses the version; another rubric makes a new one
r = await call(ALICE, attempt('b2f2c2ae-2222-4222-8333-444455556666', { total: 40 }));
ok('a second attempt is stored', r.inserted === true && r.attempt_id !== A1);
ok('it reuses the version row', await n1(`select count(*) n from assessment_versions where assessment_id='tsa-diagnostic'`) === 1);
r = await call(ALICE, attempt('b2f2c2ae-3333-4222-8333-444455556666', { rubric: 'tsa-unified-20260901-c4' }));
ok('a new rubric version makes a new published version row', r.inserted === true && await n1(`select count(*) n from assessment_versions where assessment_id='tsa-diagnostic' and status='published'`) === 2);
ok('the old version row is untouched', same((await q(`select version, scoring_version, content_version from assessment_versions where id = '${row.version_id}'`))[0], { version: `${BANK}|${RUBRIC}`, scoring_version: RUBRIC, content_version: BANK }));

// ---- checkpoint, a person without an enrollment, an empty rubric
r = await call(ALICE, attempt('chk-00000001', { assessment: 'checkpoint' }));
ok('a checkpoint is stored as tsa-checkpoint', r.inserted === true && r.assessment_id === 'tsa-checkpoint');
ok('and gets its own version row', await n1(`select count(*) n from assessment_versions where assessment_id='tsa-checkpoint'`) === 1);
r = await call(NOENR, attempt('noenr-0000001', { bank: '', rubric: '', form: '' }));
ok('a person with no enrollment is stored with no enrollment id', r.inserted === true && (await q(`select enrollment_id e from assessment_attempts where id='${r.attempt_id}'`))[0].e === null);
ok('empty bank release and rubric version attach to the fixed unlisted version, with null source fields', (await q(`select v.version, v.scoring_version, v.content_version, v.status, a.source from assessment_attempts a join assessment_versions v on v.id = a.version_id where a.id='${r.attempt_id}'`)).every((x) => x.version === 'unlisted|unlisted' && x.scoring_version === 'unlisted' && x.content_version === 'unlisted' && x.status === 'published' && same(x.source, { formId: null, bankRelease: null, rubricVersion: null })));
r = await call(ALICE, `record_tsa_item_attempt('items-empty-1', 'diagnostic', '${BANK}', '${RUBRIC}', 'A', 0, '[]'::jsonb, null)`);
ok('zero items and a null completion time are fine (the time becomes now)', r.inserted === true && Math.abs(Date.now() - new Date(r.completed_at).getTime()) < 60000);

// ---- keys
await rejectsAs('the same key as a checkpoint for a diagnostic is refused', 'authenticated', ALICE, `select ${attempt('chk-00000001')}`, '22023');
await rejectsAs('someone else using the key is refused', 'authenticated', BOB, `select ${attempt(KEY1)}`, '22023');
ok('the refused calls changed nothing', await n1(`select count(*) n from assessment_attempts where person_id = '${BOB_ID}'`) === 0 && Number((await q(`select overall_score s from assessment_attempts where id='${A1}'`))[0].s) === 61.5);
await rejectsAs('a key under 8 characters is refused', 'authenticated', ALICE, `select ${attempt('short')}`, '22023');
await rejectsAs('a key with a space is refused', 'authenticated', ALICE, `select ${attempt('has space in it')}`, '22023');
await rejectsAs('a key over 160 characters is refused', 'authenticated', ALICE, `select ${attempt('k'.repeat(161))}`, '22023');
r = await call(ALICE, attempt('k'.repeat(160)));
ok('a key of exactly 160 characters is accepted', r.inserted === true);
r = await call(ALICE, attempt('tsa-1760000000000-abc123x'));
ok('the browser fallback key shape (tsa-<time>-<random>) is accepted', r.inserted === true);

// ---- validation
const bad = (n, sql) => rejectsAs(n, 'authenticated', ALICE, `select ${sql}`, '22023');
await bad('unknown assessment refused', attempt('bad-key-0001', { assessment: 'final' }));
await bad('score above 100 refused', attempt('bad-key-0002', { total: 100.01 }));
await bad('negative score refused', attempt('bad-key-0003', { total: -1 }));
await bad('null score refused', `record_tsa_item_attempt('bad-key-0004', 'diagnostic', '${BANK}', '${RUBRIC}', 'A', null, '[]'::jsonb, null)`);
await bad('items that are an object refused', `record_tsa_item_attempt('bad-key-0005', 'diagnostic', '${BANK}', '${RUBRIC}', 'A', 5, '{"a":1}'::jsonb, null)`);
await bad('items that are a string refused', `record_tsa_item_attempt('bad-key-0006', 'diagnostic', '${BANK}', '${RUBRIC}', 'A', 5, '"x"'::jsonb, null)`);
await bad('an item that is not an object refused', attempt('bad-key-0007', { items: [item(0), 5] }));
await bad('an item that is null refused', attempt('bad-key-0008', { items: [null] }));
await bad('46 items refused', attempt('bad-key-0009', { items: items(46) }));
await bad('items of 100000 bytes or more refused', `record_tsa_item_attempt('bad-key-0010', 'diagnostic', '${BANK}', '${RUBRIC}', 'A', 5, jsonb_build_array(jsonb_build_object('t', repeat('x', 100000))), null)`);
await bad('a bank release with markup refused', attempt('bad-key-0011', { bank: '2026<script>' }));
await bad('a bank release with a quote refused', attempt('bad-key-0012', { bank: `x'y`.replace(/'/g, "''") }));
await bad('a bank release over 80 characters refused', attempt('bad-key-0013', { bank: 'b'.repeat(81) }));
await bad('a rubric version over 120 characters refused', attempt('bad-key-0014', { rubric: 'r'.repeat(121) }));
await bad('a form id over 20 characters refused', attempt('bad-key-0015', { form: 'f'.repeat(21) }));
await bad('a rubric version with a newline refused', `record_tsa_item_attempt('bad-key-0016', 'diagnostic', '${BANK}', 'a' || chr(10) || 'b', 'A', 5, '[]'::jsonb, null)`);
ok('no row was written by the refused calls', await n1(`select count(*) n from assessment_attempts where legacy_firestore_id like 'assessment_item_attempts/bad-key-%'`) === 0);
ok('and no version row either', await n1(`select count(*) n from assessment_versions where version like '%script%' or version like '%bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb%' and length(version) > 81`) === 0);
r = await call(ALICE, attempt('edge-key-0045', { items: items(45), total: 100 }));
ok('45 items and a score of exactly 100 are accepted', r.inserted === true && await n1(`select jsonb_array_length(answers) n from assessment_response_parts where attempt_id='${r.attempt_id}'`) === 45);
r = await call(ALICE, attempt('edge-key-0000', { total: 0 }));
ok('a score of 0 is accepted', r.inserted === true);
r = await call(ALICE, attempt('edge-key-1000', { bank: 'b'.repeat(80), rubric: 'r'.repeat(120), form: 'f'.repeat(20) }));
ok('the longest allowed bank release, rubric version and form id are accepted', r.inserted === true);
ok('free text of that shape is stored in the attempt source as sent, on the unlisted version', (await q(`select v.version, a.source from assessment_attempts a join assessment_versions v on v.id=a.version_id where a.id='${r.attempt_id}'`)).every((x) => x.version === 'unlisted|unlisted' && x.source.bankRelease === 'b'.repeat(80) && x.source.rubricVersion === 'r'.repeat(120) && x.source.formId === 'f'.repeat(20)));
const nearLimit = items(40).map((it) => ({ ...it, feedbackComment: 'c'.repeat(500) }));
r = await call(ALICE, attempt('edge-size-0001', { items: nearLimit }));
ok('forty items with 500 character comments (the realistic maximum) are accepted', r.inserted === true);
r = await call(ALICE, attempt('edge-score-1', { total: 55.555 }));
ok('a score with extra decimals is rounded to two places', Number((await q(`select overall_score s from assessment_attempts where id='${r.attempt_id}'`))[0].s) === 55.56);

// ---- completion time: kept inside 2020-01-01 and now
r = await call(ALICE, attempt('time-key-0001', { at: `'2999-01-01T00:00:00Z'` }));
ok('a completion time in the future is capped at now', new Date(r.completed_at).getTime() <= Date.now() + 1000);
r = await call(ALICE, attempt('time-key-0002', { at: `'1999-01-01T00:00:00Z'` }));
ok('a completion time before 2020 is raised to 2020-01-01 (the same literal the other write functions use, in the session time zone)', await n1(`select count(*) n from assessment_attempts where id = '${r.attempt_id}' and completed_at = '2020-01-01'::timestamptz`) === 1);

// ---- reading
const aliceSees = (await as('authenticated', ALICE, `select count(*)::int n from assessment_attempts`))[0].n;
ok('alice sees her own attempts through the existing policy', aliceSees === (await n1(`select count(*) n from assessment_attempts where person_id='${ALICE_ID}'`)));
ok('bob sees none of them', (await as('authenticated', BOB, `select count(*)::int n from assessment_attempts`))[0].n === 0);
ok('bob cannot read the response parts of alice', (await as('authenticated', BOB, `select count(*)::int n from assessment_response_parts`))[0].n === 0);

// ---- free text can never create version rows
const versionsBefore = await n1(`select count(*) n from assessment_versions where assessment_id = 'tsa-diagnostic'`);
const junk = ['x', '2026-08-13', '2026-08-13-v', '2026-8-13-v1', 'release one', '20260-08-13-v1', '2026-08-13-vX'];
for (let i = 0; i < junk.length; i++) {
  const rr = await call(ALICE, attempt('junk-key-' + String(i).padStart(4, '0'), { bank: junk[i].trim() }));
  ok(`a bank release of "${junk[i]}" uses the unlisted version`, rr.inserted === true && (await q(`select v.version from assessment_attempts a join assessment_versions v on v.id = a.version_id where a.id = '${rr.attempt_id}'`))[0].version === 'unlisted|unlisted');
}
for (const [i, rubric] of ['tsa-unified-2026081-c3', 'tsa-unified-20260814-', 'tsa-unified-20260814-c3_mc', 'tsa-20260814-c3', 'TSA-unified-20260814-c3', 'tsa-unified-20260814-c3 x'].entries()) {
  const rr = await call(ALICE, attempt('junk-rub-' + String(i).padStart(4, '0'), { rubric }));
  ok(`a rubric version of "${rubric}" uses the unlisted version`, rr.inserted === true && (await q(`select v.version from assessment_attempts a join assessment_versions v on v.id = a.version_id where a.id = '${rr.attempt_id}'`))[0].version === 'unlisted|unlisted');
}
ok('none of that created a version row beyond the one fixed unlisted row', await n1(`select count(*) n from assessment_versions where assessment_id = 'tsa-diagnostic'`) === versionsBefore);
ok('the unlisted version exists once per assessment', await n1(`select count(*) n from assessment_versions where assessment_id = 'tsa-diagnostic' and version = 'unlisted|unlisted'`) === 1);
ok('a real release shape still gets its own row', (await call(ALICE, attempt('real-shape-0001', { bank: '2026-09-01-v2' }))).inserted === true && await n1(`select count(*) n from assessment_versions where assessment_id = 'tsa-diagnostic' and version = '2026-09-01-v2|${RUBRIC}'`) === 1);

// ---- the per person limit (100 stored attempts per assessment) and the version cap (20, never an error)
await db.exec(`
 insert into assessment_attempts (person_id, program_id, assessment_id, version_id, status, idempotency_hash, completed_at, overall_score, result_checksum, legacy_firestore_id)
 select '${BOB_ID}', 'tsa', 'tsa-diagnostic', (select id from assessment_versions where assessment_id='tsa-diagnostic' limit 1), 'completed', md5(i::text) || md5(i::text || 'x'), now(), 50, '${'c'.repeat(64)}', 'filler/' || i
 from generate_series(1, 100) i;`);
await rejectsAs('the 101st diagnostic attempt of a person is refused (54000)', 'authenticated', BOB, `select ${attempt('limit-key-0101')}`, '54000');
ok('the refused call stored nothing', await n1(`select count(*) n from assessment_attempts where person_id='${BOB_ID}'`) === 100);
r = await call(BOB, attempt('limit-chk-0001', { assessment: 'checkpoint' }));
ok('the limit is per assessment: a checkpoint is still accepted', r.inserted === true);
const checkpointVersions = await n1(`select count(*) n from assessment_versions where assessment_id = 'tsa-checkpoint'`);
await db.exec(`
 insert into assessment_versions (assessment_id, version, scoring_version, content_version, status)
 select 'tsa-checkpoint', 'filler|' || i, '', '', 'published' from generate_series(1, ${20 - checkpointVersions}) i;`);
ok('setup: the checkpoint assessment is at the cap of 20 versions', await n1(`select count(*) n from assessment_versions where assessment_id = 'tsa-checkpoint'`) === 20);
r = await call(ALICE, attempt('limit-ver-0001', { assessment: 'checkpoint', rubric: 'tsa-unified-20260901-brand-new' }));
ok('a new real release shape past the cap is NOT an error: the attempt uses the unlisted version', r.inserted === true && (await q(`select v.version, a.source from assessment_attempts a join assessment_versions v on v.id = a.version_id where a.id = '${r.attempt_id}'`)).every((x) => x.version === 'unlisted|unlisted' && x.source.rubricVersion === 'tsa-unified-20260901-brand-new'));
ok('and no version row was added', await n1(`select count(*) n from assessment_versions where assessment_id = 'tsa-checkpoint' and version like '%brand-new%'`) === 0);
r = await call(ALICE, attempt('limit-ver-0002', { assessment: 'checkpoint' }));
ok('an existing version is still used when the cap is reached', r.inserted === true && (await q(`select v.version from assessment_attempts a join assessment_versions v on v.id = a.version_id where a.id = '${r.attempt_id}'`))[0].version === `${BANK}|${RUBRIC}`);

// ---- the scoring comparison
let c = await call(ALICE, comparison(KEY1));
ok('a comparison is stored for the attempt', c.inserted === true && c.attempt_id === A1);
const cmp = (await q(`select * from assessment_scoring_comparisons where attempt_id = '${A1}'`))[0];
ok('comparison: summary columns (enabled when either task is, gen_ai when either task is)', cmp.enabled === true && cmp.official_source === 'gen_ai');
ok('comparison: the by task detail keeps the real shape', same(cmp.enabled_by_task, { speak: true, act: false }) && same(cmp.official_source_by_task, { speak: 'genai', act: 'deterministic' }));
ok('comparison: scores, versions and the import natural key', same(cmp.deterministic, { speak: { total: 7 }, act: { total: 6 } }) && same(cmp.gen_ai, { speak: { total: 8 }, act: null }) && same(cmp.difference, { speak: { total: 1 }, act: null }) && cmp.rubric_version === RUBRIC && cmp.model_version === 'model-x' && cmp.legacy_firestore_id === 'tsa_scoring_comparisons/' + KEY1 && cmp.migration_run_id === null);
c = await call(ALICE, comparison(KEY1, { model: 'other', enabled: { speak: false, act: false } }));
ok('a repeat of the key keeps the first write', c.inserted === false && same((await q(`select model_version m, enabled e from assessment_scoring_comparisons where attempt_id='${A1}'`))[0], { m: 'model-x', e: true }));
ok('still one comparison for the attempt', await n1(`select count(*) n from assessment_scoring_comparisons where attempt_id='${A1}'`) === 1);
c = await call(ALICE, comparison('b2f2c2ae-2222-4222-8333-444455556666', { enabled: { speak: false, act: false }, official: { speak: 'deterministic', act: 'deterministic' }, gen: {}, diff: {} }));
const cmp2 = (await q(`select enabled, official_source from assessment_scoring_comparisons where legacy_firestore_id = 'tsa_scoring_comparisons/b2f2c2ae-2222-4222-8333-444455556666'`))[0];
ok('with nothing enabled the summary is enabled false and deterministic', cmp2.enabled === false && cmp2.official_source === 'deterministic');
await rejectsAs('a comparison with no stored attempt is refused', 'authenticated', ALICE, `select ${comparison('no-such-attempt-1')}`, '22023');
await rejectsAs('bob cannot attach a comparison to alice\'s attempt', 'authenticated', BOB, `select ${comparison('b2f2c2ae-3333-4222-8333-444455556666')}`, '22023');
ok('and nothing was stored for it', await n1(`select count(*) n from assessment_scoring_comparisons where legacy_firestore_id = 'tsa_scoring_comparisons/b2f2c2ae-3333-4222-8333-444455556666'`) === 0);
await rejectsAs('a comparison for the other kind of assessment is refused', 'authenticated', ALICE, `select ${comparison('b2f2c2ae-3333-4222-8333-444455556666', { assessment: 'checkpoint' })}`, '22023');
await rejectsAs('an unknown assessment is refused', 'authenticated', ALICE, `select ${comparison('b2f2c2ae-3333-4222-8333-444455556666', { assessment: 'x' })}`, '22023');
const KEY3 = 'b2f2c2ae-3333-4222-8333-444455556666';
await rejectsAs('enabled that is an array is refused', 'authenticated', ALICE, `select record_tsa_scoring_comparison('${KEY3}', 'diagnostic', '', '[1]'::jsonb, '{}', '{}', '{}', '{}', '')`, '22023');
await rejectsAs('a string deterministic part is refused', 'authenticated', ALICE, `select record_tsa_scoring_comparison('${KEY3}', 'diagnostic', '', '{}', '{}', '"x"'::jsonb, '{}', '{}', '')`, '22023');
await rejectsAs('a deterministic part of 20000 bytes is refused', 'authenticated', ALICE, `select record_tsa_scoring_comparison('${KEY3}', 'diagnostic', '', '{}', '{}', jsonb_build_object('t', repeat('x', 20000)), '{}', '{}', '')`, '22023');
await rejectsAs('a gen ai part of 20000 bytes is refused', 'authenticated', ALICE, `select record_tsa_scoring_comparison('${KEY3}', 'diagnostic', '', '{}', '{}', '{}', jsonb_build_object('t', repeat('x', 20000)), '{}', '')`, '22023');
await rejectsAs('an enabled part of 2000 bytes is refused', 'authenticated', ALICE, `select record_tsa_scoring_comparison('${KEY3}', 'diagnostic', '', jsonb_build_object('t', repeat('x', 2000)), '{}', '{}', '{}', '{}', '')`, '22023');
await rejectsAs('a rubric version with markup is refused', 'authenticated', ALICE, `select record_tsa_scoring_comparison('${KEY3}', 'diagnostic', 'a<b', '{}', '{}', '{}', '{}', '{}', '')`, '22023');
c = await call(ALICE, `record_tsa_scoring_comparison('${KEY3}', 'diagnostic', null, null, null, null, null, null, null)`);
ok('null parts count as empty objects and null versions as empty text', c.inserted === true && same((await q(`select enabled_by_task a, deterministic b, rubric_version r, model_version m, enabled e, official_source o from assessment_scoring_comparisons where attempt_id = '${c.attempt_id}'`))[0], { a: {}, b: {}, r: '', m: '', e: false, o: 'deterministic' }));
c = await call(ALICE, `record_tsa_scoring_comparison('chk-00000001', 'checkpoint', '${RUBRIC}', ${j({ speak: true })}, ${j({ speak: 'gen_ai' })}, '{}', '{}', '{}', 'm' || chr(1) || 'v' || repeat('z', 200))`);
const cmp3 = (await q(`select official_source o, model_version m from assessment_scoring_comparisons where attempt_id = '${c.attempt_id}'`))[0];
ok('a checkpoint comparison works; gen_ai spelling is recognised; control characters are removed and the model version is cut to 160', c.inserted === true && cmp3.o === 'gen_ai' && cmp3.m.length === 160 && cmp3.m.startsWith('mvz') && !/[\u0000-\u001f]/.test(cmp3.m));
ok('learners cannot read comparisons (staff only), not even their own', (await as('authenticated', ALICE, `select count(*)::int n from assessment_scoring_comparisons`))[0].n === 0);
let direct = false; try { await as('authenticated', ALICE, `insert into assessment_scoring_comparisons (attempt_id) values ('${A1}')`); direct = true; } catch { /* expected */ }
ok('learners cannot write comparisons directly', !direct);
let tableCheck = ''; try { await db.exec(`update assessment_scoring_comparisons set enabled_by_task = '[1]'::jsonb where attempt_id = '${A1}'`); } catch (e) { tableCheck = e.code || ''; }
ok('the table refuses a by-task column that is not an object (23514)', tableCheck === '23514');

// ---- the import and the mirror share keys: whichever writes first, the other finds the row
const mapping = require('../scripts/supabase-import-mapping.js');
const { snapshot } = require('../tests/fixtures/import-snapshot.js');
const catalog = JSON.parse(fs.readFileSync(new URL('./seed/activities.json', import.meta.url), 'utf8'));
const plan = mapping.buildPlan(snapshot, catalog, { importDate: '2026-10-07T00:00:00.000Z', runId: null });
const planAttempt = plan.tables.assessment_attempts.find((a) => a.legacy_firestore_id === 'assessment_item_attempts/tsa-att-1');
const planVersion = plan.tables.assessment_versions.find((v) => v.id === planAttempt.version_id);
const planPerson = plan.tables.people.find((p) => p.id === planAttempt.person_id);
ok('the import plan names the same hash, legacy id and version text the function builds', planAttempt.idempotency_hash === sha('tsa-attempt:tsa-att-1') && planVersion.version === 'bank-2025-08|rubric-3');
// The import wrote first: a person, the version and the attempt with the import's ids.
await db.exec(`insert into people (id, auth_uid, primary_email) values ('${planPerson.id}', '${planPerson.auth_uid}', 'import-person@a.com')`);
await db.exec(`insert into assessment_versions (id, assessment_id, version, scoring_version, content_version, status, questions, content, published_at) values ('${planVersion.id}', '${planVersion.assessment_id}', '${planVersion.version}', '${planVersion.scoring_version}', '${planVersion.content_version}', 'published', '[]', '{}', now())`);
await db.exec(`insert into assessment_attempts (id, person_id, program_id, assessment_id, version_id, status, idempotency_hash, completed_at, overall_score, response_checksum, result_checksum, source, legacy_firestore_id)
  values ('${planAttempt.id}', '${planAttempt.person_id}', 'tsa', '${planAttempt.assessment_id}', '${planAttempt.version_id}', 'completed', '${planAttempt.idempotency_hash}', '${planAttempt.completed_at}', ${planAttempt.overall_score}, '${planAttempt.response_checksum}', '${planAttempt.result_checksum}', '{}', '${planAttempt.legacy_firestore_id}')`);
const before = await n1(`select count(*) n from assessment_attempts`);
r = await call(planPerson.auth_uid, `record_tsa_item_attempt('tsa-att-1', 'diagnostic', 'bank-2025-08', 'rubric-3', 'A', 64, '[]'::jsonb, null)`);
ok('the mirror finds the imported attempt by key: not inserted, same id', r.inserted === false && r.attempt_id === planAttempt.id);
ok('and wrote no second attempt or version', await n1(`select count(*) n from assessment_attempts`) === before && await n1(`select count(*) n from assessment_versions where assessment_id='tsa-diagnostic' and version = 'bank-2025-08|rubric-3'`) === 1);
r = await call(planPerson.auth_uid, `record_tsa_item_attempt('tsa-att-2-later', 'diagnostic', 'bank-2025-08', 'rubric-3', 'A', 70, '[]'::jsonb, null)`);
ok('a later attempt with the imported (non release shaped) values uses the unlisted version, keeping the real values in source', r.inserted === true && (await q(`select v.version, a.source from assessment_attempts a join assessment_versions v on v.id = a.version_id where a.id = '${r.attempt_id}'`)).every((x) => x.version === 'unlisted|unlisted' && x.source.bankRelease === 'bank-2025-08' && x.source.rubricVersion === 'rubric-3'));
// A release shaped value the import created first is reused by the function.
const shaped = JSON.parse(JSON.stringify(snapshot));
shaped.collections.assessment_item_attempts.push({ id: 'tsa-att-shaped', data: { userId: 'uid-alice', assessment: 'diagnostic', bankRelease: '2026-11-01-v3', rubricVersion: 'tsa-unified-20260814-c3-mc13', formId: 'A', totalScore: 50, items: [], completedAt: '2026-01-01T00:00:00Z' } });
const shapedPlan = mapping.buildPlan(shaped, catalog, { importDate: '2026-10-07T00:00:00.000Z', runId: null });
const shapedAttempt = shapedPlan.tables.assessment_attempts.find((a) => a.legacy_firestore_id === 'assessment_item_attempts/tsa-att-shaped');
const shapedVersion = shapedPlan.tables.assessment_versions.find((v) => v.id === shapedAttempt.version_id);
ok('the import names a release shaped version exactly as the function does', shapedVersion.version === `2026-11-01-v3|${RUBRIC}`);
await db.exec(`insert into assessment_versions (id, assessment_id, version, scoring_version, content_version, status, questions, content, published_at) values ('${shapedVersion.id}', '${shapedVersion.assessment_id}', '${shapedVersion.version}', '${shapedVersion.scoring_version}', '${shapedVersion.content_version}', 'published', '[]', '{}', now())`);
r = await call(planPerson.auth_uid, attempt('tsa-att-shaped-later', { bank: '2026-11-01-v3' }));
ok('a later attempt with a release shaped bank and rubric reuses the imported version row', r.inserted === true && (await q(`select version_id v from assessment_attempts where id = '${r.attempt_id}'`))[0].v === shapedVersion.id);
c = await call(planPerson.auth_uid, comparison('tsa-att-1', { rubric: 'rubric-3' }));
ok('a comparison attaches to the imported attempt', c.inserted === true && c.attempt_id === planAttempt.id);
// The mirror wrote first: the import's comparison row for the same attempt is a duplicate of the mirror's.
const planComparison = plan.tables.assessment_scoring_comparisons[0];
ok('the import comparison has the same legacy id the function builds', planComparison.legacy_firestore_id === 'tsa_scoring_comparisons/tsa-att-1' && planComparison.attempt_id === planAttempt.id);
let importDup = ''; try { await db.exec(`insert into assessment_scoring_comparisons (attempt_id) values ('${planAttempt.id}') on conflict (attempt_id) do nothing`); } catch (e) { importDup = e.message; }
ok('the import writes comparisons with on conflict (attempt_id) do nothing: a mirrored row is skipped without an error', importDup === '' && await n1(`select count(*) n from assessment_scoring_comparisons where attempt_id = '${planAttempt.id}'`) === 1);

// ---- the rollback
await db.exec(fs.readFileSync(new URL('./rollbacks/20261008002190_tsa_item_attempts_down.sql', import.meta.url), 'utf8'));
const left = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname in ('record_tsa_item_attempt','record_tsa_scoring_comparison','tsa_ident','tsa_object')`);
ok('rollback: the two functions and two helpers are gone', left.length === 0);
ok('rollback: the two columns are gone, the old columns stay', await n1(`select count(*) n from information_schema.columns where table_name='assessment_scoring_comparisons' and column_name in ('enabled_by_task','official_source_by_task')`) === 0 && await n1(`select count(*) n from information_schema.columns where table_name='assessment_scoring_comparisons' and column_name in ('enabled','official_source','deterministic','gen_ai','difference','rubric_version','model_version')`) === 7);
ok('rollback: the stored attempts and parts stay', await n1(`select count(*) n from assessment_attempts where person_id = '${ALICE_ID}'`) > 5);
await db.exec(fs.readFileSync(new URL('./rollbacks/20261008002190_tsa_item_attempts_down.sql', import.meta.url), 'utf8'));
ok('rollback: running it twice is harmless', true);
await db.exec(fs.readFileSync(new URL('./migrations/20261008002190_tsa_item_attempts.sql', import.meta.url), 'utf8'));
ok('migration: applies again after the rollback', (await n1(`select count(*) n from pg_proc where proname in ('record_tsa_item_attempt','record_tsa_scoring_comparison')`)) === 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
