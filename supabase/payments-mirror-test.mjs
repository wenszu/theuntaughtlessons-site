// Tests for migration 2150: payments and assessment persistence mirror. Run: node supabase/payments-mirror-test.mjs
// Needs @electric-sql/pglite (same as the other supabase/*-test.mjs suites). Synthetic data only. Nothing is applied
// to any real database: the migrations run in an in memory Postgres and the mirror module talks to it through a
// small stand in for the PostgREST endpoint.
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { boot } from './schema-apply-harness.mjs';

const require = createRequire(import.meta.url);
const { createMirror } = require('../functions-admin/supabase-mirror-core');
const mirrorMod = require('../functions-admin/supabase-mirror/payments-assessments');
const { createAssessmentPersistenceService } = require('../functions-admin/assessment-persistence-service');
const { getVersion } = require('../functions-admin/executive-signature-versions');
const { uuidFor } = mirrorMod;

let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n); };
const rejects = async (n, db, sql, code) => {
  try { await db.exec(sql); ok(n, false); }
  catch (e) { ok(`${n}  [${e.code || e.message.slice(0, 50)}]`, !code || e.code === code); }
};

const NOW = '2026-10-07T03:04:05.000Z';
const upSql = readFileSync(new URL('./migrations/20261007002150_payments_mirror.sql', import.meta.url), 'utf8');
const downSql = readFileSync(new URL('./rollbacks/20261007002150_payments_mirror_down.sql', import.meta.url), 'utf8');

// ---- fake Firestore (records what the real persistence service writes) ------------------------------------------
class ServerTimestampTransform { constructor() { this.methodName = 'FieldValue.serverTimestamp'; } }
class ArrayUnionTransform { constructor(values) { this.methodName = 'FieldValue.arrayUnion'; this.values = values; } }
const FieldValue = { serverTimestamp: () => new ServerTimestampTransform(), arrayUnion: (...v) => new ArrayUnionTransform(v) };
function fakeFirestore(seed) {
  const store = new Map(Object.entries(seed));
  const writes = [];
  let counter = 0;
  const docRef = (p) => ({ path: p, id: p.split('/').pop(), collection: (n) => collRef(`${p}/${n}`) });
  const collRef = (cp) => ({ doc: (id) => docRef(`${cp}/${id || `AUTOID${String(++counter).padStart(14, '0')}`}`) });
  return {
    writes,
    collection: (n) => collRef(n),
    async runTransaction(fn) {
      const pending = [];
      const tx = {
        async get(ref) { return { exists: store.has(ref.path), data: () => store.get(ref.path) }; },
        create(ref, data) { pending.push({ path: ref.path, data, op: 'create' }); },
        update(ref, data) { pending.push({ path: ref.path, data, op: 'update' }); }
      };
      const result = await fn(tx);
      pending.forEach((w) => { store.set(w.path, w.op === 'update' ? { ...store.get(w.path), ...w.data } : w.data); writes.push(w); });
      return result;
    }
  };
}

async function run() {
  const { db, failed } = await boot();
  if (failed) { console.log('FAIL migrations did not apply'); process.exit(1); }
  const q = async (s, params) => (await db.query(s, params)).rows;

  // ---- 1. shape of the migration ---------------------------------------------------------------------------------
  const tableNames = (await q(`select table_name from information_schema.tables where table_schema = 'public' and table_name in ('stripe_processed_sessions','service_requests') order by 1`)).map((r) => r.table_name);
  ok('both new tables exist', JSON.stringify(tableNames) === JSON.stringify(['service_requests', 'stripe_processed_sessions']));
  const rls = await q(`select relname, relrowsecurity from pg_class where relname in ('stripe_processed_sessions','service_requests') order by 1`);
  ok('row level security is on for both new tables', rls.length === 2 && rls.every((r) => r.relrowsecurity === true));
  ok('no policy on either new table (service role only)', (await q(`select count(*)::int n from pg_policies where tablename in ('stripe_processed_sessions','service_requests')`))[0].n === 0);
  const priv = (await q(`select
    has_table_privilege('anon','public.stripe_processed_sessions','select') or has_table_privilege('anon','public.stripe_processed_sessions','insert') or has_table_privilege('anon','public.service_requests','select') or has_table_privilege('anon','public.service_requests','insert') as anon_any,
    has_table_privilege('authenticated','public.stripe_processed_sessions','select') or has_table_privilege('authenticated','public.stripe_processed_sessions','insert') or has_table_privilege('authenticated','public.service_requests','select') or has_table_privilege('authenticated','public.service_requests','insert') as auth_any`))[0];
  ok('anon and authenticated hold no privilege on the new tables', priv.anon_any === false && priv.auth_any === false);
  await db.exec('set role anon');
  try { await db.query('select * from public.stripe_processed_sessions'); ok('anon cannot read stripe_processed_sessions', false); }
  catch (e) { ok(`anon cannot read stripe_processed_sessions  [${e.code}]`, e.code === '42501'); }
  await db.exec('reset role');
  await db.exec(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"someone","role":"authenticated"}', false)`);
  try { await db.query('select * from public.service_requests'); ok('authenticated cannot read service_requests', false); }
  catch (e) { ok(`authenticated cannot read service_requests  [${e.code}]`, e.code === '42501'); }
  await db.exec('reset role');
  ok('no function was added by the migration', !/create (or replace )?function/i.test(upSql));
  ok('the migration drops nothing', !/\bdrop\b/i.test(upSql.replace(/--.*$/gm, '')));
  const mirrorKey = (await q(`select is_nullable, is_generated from information_schema.columns where table_name = 'audit_events' and column_name = 'mirror_key'`))[0];
  ok('audit_events.mirror_key is a plain nullable column', mirrorKey && mirrorKey.is_nullable === 'YES' && mirrorKey.is_generated === 'NEVER');
  ok('audit_events.mirror_key has a unique index', (await q(`select count(*)::int n from pg_indexes where indexname = 'audit_events_mirror_key_key' and indexdef like 'CREATE UNIQUE%'`))[0].n === 1);
  ok('outbox_events.legacy_firestore_id exists', (await q(`select count(*)::int n from information_schema.columns where table_name = 'outbox_events' and column_name = 'legacy_firestore_id'`))[0].n === 1);
  const seeded = await q(`select id, program_id, title, status, estimated_minutes from assessment_definitions where id in ('quick-check','full-assessment') order by id`);
  ok('the two Executive Signature definitions are seeded', seeded.length === 2);
  const fakeSeedDb = fakeFirestore({ 'customers/c': {}, 'entitlements/e': { customerId: 'c', programId: 'executive-signature', assessmentId: 'quick-check', status: 'active', attemptsCompleted: 0, retakesAllowed: 0 } });
  await createAssessmentPersistenceService({ db: fakeSeedDb, FieldValue }).persistCompletedAssessment({
    customerId: 'c', entitlementId: 'e', assessmentId: 'quick-check', formVersion: 'readiness-free@1.0.0',
    answers: Object.fromEntries(getVersion('readiness-free@1.0.0').questions.map((x) => [x.id, 3])), startedAt: new Date(Date.now() - 60000).toISOString(),
    consent: { assessmentProcessing: true, noticeVersion: 'n@1' }, idempotencyKey: 'seed-check', actor: { actorType: 'participant', actorId: 'uid-seed', actorRole: 'participant' }
  });
  const serviceDefinition = fakeSeedDb.writes.find((w) => w.path === 'assessmentDefinitions/quick-check').data;
  const mappedDefinition = mirrorMod.rowsForAssessmentDefinition({ id: 'quick-check', data: serviceDefinition }, { now: NOW }).assessment_definitions[0];
  const seededQuick = seeded.find((r) => r.id === 'quick-check');
  ok('the seeded quick-check row equals what the service would create', JSON.stringify(seededQuick) === JSON.stringify(mappedDefinition));

  // ---- 2. constraints on the new tables -------------------------------------------------------------------------
  const person = uuidFor('person:parity@example.com');
  await db.exec(`insert into people (id, auth_uid, primary_email) values ('${person}', 'fb_parity', 'parity@example.com')`);
  await rejects('a processed session needs a lowercase email', db, `insert into stripe_processed_sessions (session_id, program_id, email) values ('cs_test_a','tsa','Buyer@Example.com')`, '23514');
  await rejects('a processed session needs a known program', db, `insert into stripe_processed_sessions (session_id, program_id, email) values ('cs_test_a','nope','a@example.com')`, '23503');
  await rejects('a processed session needs a session id', db, `insert into stripe_processed_sessions (session_id, program_id, email) values ('  ','tsa','a@example.com')`, '23514');
  await db.exec(`insert into stripe_processed_sessions (session_id, program_id, email) values ('cs_test_a','tsa','a@example.com')`);
  await rejects('a session id can be recorded once', db, `insert into stripe_processed_sessions (session_id, program_id, email) values ('cs_test_a','tsa','a@example.com')`, '23505');
  await rejects('a service request id must be a sha256 hash', db, `insert into service_requests (id, operation) values ('abc','x')`, '23514');
  await rejects('a service request result must be an object', db, `insert into service_requests (id, operation, result) values ('${'a'.repeat(64)}','x','[]')`, '23514');
  await db.exec(`delete from stripe_processed_sessions where session_id = 'cs_test_a'`);

  // ---- 3. the mirror module writing into the real schema ---------------------------------------------------------
  const colTypes = {};
  async function typesOf(table) {
    if (!colTypes[table]) {
      colTypes[table] = Object.fromEntries((await q(`select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = $1`, [table])).map((r) => [r.column_name, r.data_type]));
    }
    return colTypes[table];
  }
  let lastError = null;
  const toParam = (type, value) => (value === null || value === undefined ? null : type === 'jsonb' ? JSON.stringify(value) : value);
  const restOverPglite = async (url, init) => {
    const u = new URL(url);
    const table = decodeURIComponent(u.pathname.split('/').pop());
    const body = init.body ? JSON.parse(init.body) : undefined;
    const types = await typesOf(table);
    try {
      if (init.method === 'POST') {
        const conflict = u.searchParams.get('on_conflict');
        const ignore = String(init.headers.Prefer).includes('ignore-duplicates');
        for (const row of body) {
          const cols = Object.keys(row);
          const placeholders = cols.map((c, i) => `$${i + 1}${types[c] === 'jsonb' ? '::jsonb' : types[c] === 'ARRAY' ? '::uuid[]' : ''}`);
          const updates = cols.filter((c) => !conflict.split(',').includes(c)).map((c) => `${c} = excluded.${c}`);
          const action = ignore || !updates.length ? 'do nothing' : `do update set ${updates.join(', ')}`;
          await db.query(`insert into public.${table} (${cols.join(', ')}) values (${placeholders.join(', ')}) on conflict (${conflict}) ${action}`, cols.map((c) => toParam(types[c], row[c])));
        }
      } else if (init.method === 'PATCH') {
        const filters = [...u.searchParams.entries()];
        const sets = Object.keys(body);
        await db.query(`update public.${table} set ${sets.map((c, i) => `${c} = $${i + 1}${types[c] === 'jsonb' ? '::jsonb' : ''}`).join(', ')} where ${filters.map(([c], i) => `${c}::text = $${sets.length + i + 1}`).join(' and ')}`,
          [...sets.map((c) => toParam(types[c], body[c])), ...filters.map(([, v]) => v.replace(/^eq\./, ''))]);
      }
      return { status: 201, ok: true };
    } catch (e) {
      lastError = { code: e.code, message: e.message };
      return { status: 409, ok: false };
    }
  };
  const mirror = createMirror({ env: { SUPABASE_MIRROR: 'on', SUPABASE_SERVICE_ROLE_KEY: 'test-key-not-real' }, fetchImpl: restOverPglite, logger: { warn() {}, log() {} } });

  // what the people module would have mirrored first: the entitlement rows (assessment ids come from the seed)
  const entFull = uuidFor('entitlement:ent-full');
  await db.exec(`insert into entitlements (id, person_id, program_id, assessment_id, access_type, status, retakes_allowed, legacy_firestore_id)
    values ('${entFull}', '${person}', 'executive-signature', 'full-assessment', 'comped', 'active', 0, 'entitlements/ent-full')`);

  const fsDb = fakeFirestore({
    'customers/cust-parity': {},
    'entitlements/ent-full': { customerId: 'cust-parity', programId: 'executive-signature', assessmentId: 'full-assessment', status: 'active', attemptsCompleted: 0, retakesAllowed: 0 }
  });
  const full = getVersion('readiness-full@1.0.0');
  const result = await createAssessmentPersistenceService({ db: fsDb, FieldValue }).persistCompletedAssessment({
    customerId: 'cust-parity', entitlementId: 'ent-full', assessmentId: 'full-assessment', formVersion: full.formVersion,
    answers: Object.fromEntries(full.questions.map((x, i) => [x.id, (i % 5) + 1])), itemOrder: full.questions.map((x) => x.id),
    startedAt: new Date(Date.now() - 600000).toISOString(), durationSeconds: 600,
    consent: { assessmentProcessing: true, marketing: true, noticeVersion: 'notice@1' }, source: { channel: 'test', campaignId: 'camp-1', referrerCode: null },
    idempotencyKey: 'pglite-full-1', actor: { actorType: 'participant', actorId: 'uid-parity', actorRole: 'participant' }
  });
  const ctx = { now: NOW, personIds: { 'cust-parity': person } };
  const first = await mirrorMod.mirrorAssessmentPersistence(mirror, fsDb.writes, ctx);
  ok(`the whole completion mirrors into the real schema  ${lastError ? JSON.stringify(lastError) : ''}`, first.ok === true);
  const count = async (table) => (await q(`select count(*)::int n from ${table}`))[0].n;
  const attempt = (await q(`select * from assessment_attempts`))[0];
  ok('one completed attempt with the score and checksums', attempt.status === 'completed' && Number(attempt.overall_score) === result.overallScore && attempt.result_checksum === result.resultChecksum && attempt.response_checksum === result.responseChecksum);
  ok('the attempt is the import\'s uuid of the Firestore id', attempt.id === uuidFor(`attempt:${result.attemptId}`) && attempt.legacy_firestore_id === `assessmentAttempts/${result.attemptId}`);
  ok('the attempt points at the person, entitlement and version', attempt.person_id === person && attempt.entitlement_id === entFull && attempt.version_id === uuidFor('version:es-full-assessment-1.0.0'));
  ok('two response parts, two consent events', (await count('assessment_response_parts')) === 2 && (await count('consent_events')) === 2);
  ok('consent ids on the attempt are the consent rows', (await q(`select count(*)::int n from consent_events where id = any (select unnest(consent_event_ids) from assessment_attempts)`))[0].n === 2);
  ok('two outbox events and one service request', (await count('outbox_events')) === 2 && (await count('service_requests')) === 1);
  ok('the idempotency hash is the service request id', (await q(`select count(*)::int n from service_requests s join assessment_attempts a on a.idempotency_hash = s.id`))[0].n === 1);
  const audit = (await q(`select * from audit_events`))[0];
  ok('one audit event with its mirror key and legacy id', audit.action === 'assessment_completed' && /^auditEvents\//.test(audit.mirror_key) && audit.mirror_key === audit.detail.legacy_firestore_id && audit.person_id === person);
  const version = (await q(`select * from assessment_versions where id = $1`, [uuidFor('version:es-full-assessment-1.0.0')]))[0];
  ok('the version is published, with scoring', version.status === 'published' && version.published_at !== null && (await count('assessment_scoring')) === 1);
  ok('the definition points at the version', (await q(`select current_version_id from assessment_definitions where id = 'full-assessment'`))[0].current_version_id === version.id);
  ok('the seeded definition kept its row (insert only)', (await q(`select count(*)::int n from assessment_definitions where id = 'full-assessment'`))[0].n === 1);

  // idempotency
  const before = { attempts: await count('assessment_attempts'), audit: await count('audit_events'), consent: await count('consent_events'), parts: await count('assessment_response_parts'), outbox: await count('outbox_events'), req: await count('service_requests') };
  const replay = await mirrorMod.mirrorAssessmentPersistence(mirror, fsDb.writes, ctx);
  const after = { attempts: await count('assessment_attempts'), audit: await count('audit_events'), consent: await count('consent_events'), parts: await count('assessment_response_parts'), outbox: await count('outbox_events'), req: await count('service_requests') };
  ok('replaying the same writes changes no row count (the version replay is refused harmlessly)', JSON.stringify(before) === JSON.stringify(after));
  ok('the replay never throws and reports the refusal', typeof replay.ok === 'boolean');

  // published version lock, and the frozen attempt
  const scoringBefore = (await q(`select scoring from assessment_scoring`))[0].scoring;
  const misuse = await mirrorMod.mirrorAssessmentPersistence(mirror, fsDb.writes.filter((w) => w.path.startsWith('assessmentVersions/')), ctx);
  ok('a published version cannot get scoring rows from the mirror (database refuses, mirror reports ok:false)', misuse.ok === false && lastError && lastError.code === '42501');
  ok('the version and its scoring are unchanged after the refused write', JSON.stringify((await q(`select scoring from assessment_scoring`))[0].scoring) === JSON.stringify(scoringBefore) && (await q(`select status from assessment_versions where id = $1`, [version.id]))[0].status === 'published');
  await rejects('direct scoring insert for a published version is refused', db, `insert into assessment_scoring (version_id, scoring) values ('${version.id}', '{}') on conflict do nothing`, '42501');
  await rejects('a completed attempt cannot be rewritten', db, `update assessment_attempts set overall_score = 1 where id = '${attempt.id}'`, '42501');
  const noDraftTouch = await mirror.update('assessment_versions', { id: version.id, status: 'draft' }, { status: 'retired', published_at: NOW });
  ok('the publish update matches drafts only, so a published version is untouched', noDraftTouch.ok === true && (await q(`select status from assessment_versions where id = $1`, [version.id]))[0].status === 'published');

  // append only tables
  await rejects('audit_events rejects update', db, `update audit_events set action = 'x'`, '42501');
  await rejects('audit_events rejects delete', db, `delete from audit_events`, '42501');
  await rejects('consent_events rejects update', db, `update consent_events set granted = false`, '42501');
  await rejects('consent_events rejects delete', db, `delete from consent_events`, '42501');
  const auditId = audit.mirror_key.split('/')[1];
  const auditDuplicate = await mirrorMod.mirrorAuditEvent(mirror, { id: auditId, data: fsDb.writes.find((w) => w.path === `auditEvents/${auditId}`).data }, ctx);
  ok('an audit event written twice is one row', auditDuplicate.ok === true && (await count('audit_events')) === 1);
  await rejects('the mirror key is unique', db, `insert into audit_events (action, mirror_key) values ('x', '${audit.mirror_key}')`, '23505');
  // The importer's own rows leave mirror_key null, so a rerun of the importer (which can insert the same legacy id
  // twice when it does not dedupe) behaves exactly as before the migration.
  await db.exec(`insert into audit_events (action, detail) values ('import_style', '{"source":"firestore","legacy_firestore_id":"auditEvents/imported-1"}'), ('import_style_again', '{"source":"firestore","legacy_firestore_id":"auditEvents/imported-1"}')`);
  await db.exec(`insert into audit_events (action) values ('no_key_one'), ('no_key_two')`);
  ok('import style audit rows (null mirror key) can still be inserted repeatedly', (await q(`select count(*)::int n from audit_events where detail ->> 'legacy_firestore_id' = 'auditEvents/imported-1'`))[0].n === 2);

  // ---- 4. payments through the real module ----------------------------------------------------------------------
  const checkoutAudit = { id: 'AUTOID00000000000101', data: { action: 'checkout_session_created', program: 'tsa', sessionId: 'cs_test_synthetic_1', createdAt: new ServerTimestampTransform() } };
  const doneAudit = { id: 'AUTOID00000000000102', data: { action: 'checkout_session_completed', program: 'tsa', email: 'buyer@example.com', sessionId: 'cs_test_synthetic_1', note: 'manual follow up', createdAt: new ServerTimestampTransform() } };
  const marker = { id: 'cs_test_synthetic_1', data: { program: 'tsa', email: 'buyer@example.com', processedAt: new ServerTimestampTransform() } };
  const pctx = { now: NOW, personId: person };
  ok('checkout created mirrors', (await mirrorMod.mirrorCheckoutSessionCreated(mirror, checkoutAudit, pctx)).ok === true);
  ok('checkout completed mirrors', (await mirrorMod.mirrorCheckoutSessionCompleted(mirror, { audit: doneAudit, processed: marker }, pctx)).ok === true);
  ok('a Stripe retry replay adds no row', (await mirrorMod.mirrorCheckoutSessionCompleted(mirror, { audit: doneAudit, processed: marker }, pctx)).ok === true && (await count('stripe_processed_sessions')) === 1 && (await q(`select count(*)::int n from audit_events where action like 'checkout_session_%'`))[0].n === 2);
  const session = (await q(`select * from stripe_processed_sessions`))[0];
  ok('the processed session row holds ids and the document fields only', session.session_id === 'cs_test_synthetic_1' && session.program_id === 'tsa' && session.email === 'buyer@example.com' && session.person_id === person && session.legacy_firestore_id === 'stripeProcessedSessions/cs_test_synthetic_1');
  const esMarker = await mirrorMod.mirrorStripeProcessedSession(mirror, { id: 'cs_test_synthetic_2', data: { program: 'executive-signature', email: 'es@example.com', processedAt: new Date(NOW) } }, { now: NOW });
  ok('an Executive Signature purchase marker mirrors without a person id', esMarker.ok === true && (await q(`select person_id from stripe_processed_sessions where session_id = 'cs_test_synthetic_2'`))[0].person_id === null);
  const settings = await mirrorMod.mirrorPaymentsSettings(mirror, { enabled: true, prices: { tsa: { amountCents: 19900, currency: 'usd', label: 'TSA' } }, stripeSecretKey: 'not-copied' }, { now: NOW });
  const settingsRow = (await q(`select visibility, value from app_settings where key = 'payments'`))[0];
  ok('payments settings upsert into app_settings without secret keys', settings.ok === true && settingsRow.visibility === 'public' && settingsRow.value.enabled === true && !('stripeSecretKey' in settingsRow.value));
  await mirrorMod.mirrorPaymentsSettings(mirror, { enabled: false, prices: {} }, { now: NOW });
  ok('a later settings write replaces the value (merge on key)', (await q(`select value from app_settings where key = 'payments'`))[0].value.enabled === false);
  const sr = await mirrorMod.mirrorServiceRequest(mirror, { id: 'b'.repeat(64), data: { schemaVersion: 1, operation: 'resolveCustomerIdentity', status: 'completed', result: { ok: true, status: 'resolved', customerId: 'cust-x', created: false }, createdAt: new ServerTimestampTransform(), completedAt: new ServerTimestampTransform() } }, { now: NOW });
  ok('a service request from another service mirrors too', sr.ok === true && (await q(`select operation, result from service_requests where id = $1`, ['b'.repeat(64)]))[0].result.customerId === 'cust-x');
  const allText = JSON.stringify([await q('select * from stripe_processed_sessions'), await q('select * from service_requests'), await q('select detail from audit_events'), await q('select value from app_settings')]);
  ok('no card number or key in any mirrored payment row', !/4242|card_|sk_live|sk_test|whsec|not-copied/.test(allText));

  // ---- 5. undo --------------------------------------------------------------------------------------------------
  const auditBeforeDown = await count('audit_events');
  await db.exec(downSql);
  ok('down: both tables are gone', (await q(`select count(*)::int n from information_schema.tables where table_schema = 'public' and table_name in ('stripe_processed_sessions','service_requests')`))[0].n === 0);
  ok('down: the audit mirror key and the outbox legacy id are gone', (await q(`select count(*)::int n from information_schema.columns where (column_name = 'mirror_key' and table_name = 'audit_events') or (column_name = 'legacy_firestore_id' and table_name = 'outbox_events')`))[0].n === 0);
  ok('down: audit rows are kept', (await count('audit_events')) === auditBeforeDown);
  ok('down: a definition with attempts, entitlements or versions behind it is kept', (await q(`select count(*)::int n from assessment_definitions where id = 'full-assessment'`))[0].n === 1);
  ok('down: an unreferenced seeded definition is removed', (await q(`select count(*)::int n from assessment_definitions where id = 'quick-check'`))[0].n === 0 || (await q(`select count(*)::int n from assessment_versions where assessment_id = 'quick-check'`))[0].n > 0);
  await db.exec(upSql);
  ok('up again after down works (re-runnable)', (await q(`select count(*)::int n from information_schema.tables where table_schema = 'public' and table_name in ('stripe_processed_sessions','service_requests')`))[0].n === 2);

  // ---- 6. undo on a clean database removes the seed -------------------------------------------------------------
  const clean = await boot();
  await clean.db.exec(downSql);
  const left = (await clean.db.query(`select count(*)::int n from assessment_definitions where id in ('quick-check','full-assessment')`)).rows[0].n;
  ok('down on a clean database removes the two seeded definitions', left === 0);
  await clean.db.exec(upSql);
  ok('up after a clean down restores the seed', (await clean.db.query(`select count(*)::int n from assessment_definitions where id in ('quick-check','full-assessment')`)).rows[0].n === 2);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
