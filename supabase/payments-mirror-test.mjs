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
function fakeFirestore(seed, start = 0) {
  const store = new Map(Object.entries(seed));
  const writes = [];
  let counter = start;
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
  ok('the migration adds no audit key of its own (it relies on 2130)', !/audit_events/.test(upSql.replace(/--.*$/gm, '')) && /2130/.test(upSql));
  ok('migration 2130 is applied before 2150', (await q(`select count(*)::int n from information_schema.columns where table_name = 'audit_events' and column_name = 'legacy_firestore_id'`))[0].n === 1);
  ok('audit_events.legacy_firestore_id (2130) is unique and has no mirror_key beside it', (await q(`select count(*)::int n from pg_indexes where tablename = 'audit_events' and indexdef like 'CREATE UNIQUE%legacy_firestore_id%'`))[0].n === 1 && (await q(`select count(*)::int n from information_schema.columns where table_name = 'audit_events' and column_name = 'mirror_key'`))[0].n === 0);
  ok('the migration inserts no data', !/\binsert\s+into\b/i.test(upSql.replace(/--.*$/gm, '')));
  ok('outbox_events.legacy_firestore_id exists', (await q(`select count(*)::int n from information_schema.columns where table_name = 'outbox_events' and column_name = 'legacy_firestore_id'`))[0].n === 1);
  ok('no assessment definition exists before the mirror creates one', (await q(`select count(*)::int n from assessment_definitions where id in ('quick-check','full-assessment')`))[0].n === 0);

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
      } else if (init.method === 'GET') {
        const cols = (u.searchParams.get('select') || '*').replace(/[^a-z_,*]/g, '');
        const idParam = u.searchParams.get('id') || '';
        const wanted = idParam.startsWith('in.(') ? idParam.slice(4, -1).split(',') : [idParam.replace(/^eq\./, '')];
        const found = (await db.query(`select ${cols} from public.${table} where id::text = any($1)`, [wanted])).rows;
        return { status: 200, ok: true, json: async () => found };
      }
      return { status: 201, ok: true };
    } catch (e) {
      lastError = { code: e.code, message: e.message };
      return { status: 409, ok: false };
    }
  };
  const mirror = createMirror({ env: { SUPABASE_MIRROR: 'on', SUPABASE_SERVICE_ROLE_KEY: 'test-key-not-real' }, fetchImpl: restOverPglite, logger: { warn() {}, log() {} } });

  // The people module cannot mirror an entitlement for 'full-assessment' before the definition exists (its foreign key),
  // so the first completion arrives with no entitlement row: the mirror falls back to null and says so.
  const entFull = uuidFor('entitlement:ent-full');

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
  ok('the missing entitlement degraded instead of failing the batch', first.degraded === true && JSON.stringify(first.degradedFields) === JSON.stringify(['entitlement_id']));
  const count = async (table) => (await q(`select count(*)::int n from ${table}`))[0].n;
  const attempt = (await q(`select * from assessment_attempts`))[0];
  ok('one completed attempt with the score and checksums', attempt.status === 'completed' && Number(attempt.overall_score) === result.overallScore && attempt.result_checksum === result.resultChecksum && attempt.response_checksum === result.responseChecksum);
  ok('the attempt is the import\'s uuid of the Firestore id', attempt.id === uuidFor(`attempt:${result.attemptId}`) && attempt.legacy_firestore_id === `assessmentAttempts/${result.attemptId}`);
  ok('the attempt points at the person and version, and has no entitlement link yet', attempt.person_id === person && attempt.entitlement_id === null && attempt.version_id === uuidFor('version:es-full-assessment-1.0.0'));
  ok('two response parts, two consent events', (await count('assessment_response_parts')) === 2 && (await count('consent_events')) === 2);
  ok('consent ids on the attempt are the consent rows', (await q(`select count(*)::int n from consent_events where id = any (select unnest(consent_event_ids) from assessment_attempts)`))[0].n === 2);
  ok('two outbox events and one service request', (await count('outbox_events')) === 2 && (await count('service_requests')) === 1);
  ok('the idempotency hash is the service request id', (await q(`select count(*)::int n from service_requests s join assessment_attempts a on a.idempotency_hash = s.id`))[0].n === 1);
  const audit = (await q(`select * from audit_events`))[0];
  ok('one audit event with its legacy id column (2130)', audit.action === 'assessment_completed' && /^auditEvents\//.test(audit.legacy_firestore_id) && audit.legacy_firestore_id === audit.detail.legacy_firestore_id && audit.person_id === person);
  const version = (await q(`select * from assessment_versions where id = $1`, [uuidFor('version:es-full-assessment-1.0.0')]))[0];
  ok('the version is published, with scoring', version.status === 'published' && version.published_at !== null && (await count('assessment_scoring')) === 1);
  ok('the definition points at the version', (await q(`select current_version_id from assessment_definitions where id = 'full-assessment'`))[0].current_version_id === version.id);
  const definitionRow = (await q(`select id, program_id, title, status, estimated_minutes from assessment_definitions where id = 'full-assessment'`))[0];
  const mappedDefinition = mirrorMod.rowsForAssessmentDefinition({ id: 'full-assessment', data: fsDb.writes.find((w) => w.path === 'assessmentDefinitions/full-assessment').data }, ctx).assessment_definitions[0];
  ok('the definition was created by the mirror, equal to what the service wrote', JSON.stringify(definitionRow) === JSON.stringify(mappedDefinition));

  // idempotency
  const before = { attempts: await count('assessment_attempts'), audit: await count('audit_events'), consent: await count('consent_events'), parts: await count('assessment_response_parts'), outbox: await count('outbox_events'), req: await count('service_requests') };
  const replay = await mirrorMod.mirrorAssessmentPersistence(mirror, fsDb.writes, ctx);
  const after = { attempts: await count('assessment_attempts'), audit: await count('audit_events'), consent: await count('consent_events'), parts: await count('assessment_response_parts'), outbox: await count('outbox_events'), req: await count('service_requests') };
  ok('replaying the same writes changes no row count', JSON.stringify(before) === JSON.stringify(after));
  ok('the replay skips the now published version instead of failing', replay.ok === true && replay.results.some((r) => r.table === 'assessment_versions' && r.reason === 'version-present'));

  // published version lock, and the frozen attempt
  const scoringBefore = (await q(`select scoring from assessment_scoring`))[0].scoring;
  const misuse = await mirrorMod.mirrorAssessmentPersistence(mirror, fsDb.writes.filter((w) => w.path.startsWith('assessmentVersions/')), ctx);
  ok('a published version document passed again is skipped without a scoring write (no database refusal needed)', misuse.ok === true && misuse.results.every((r) => r.table !== 'assessment_scoring') && lastError === null);
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
  const auditId = audit.legacy_firestore_id.split('/')[1];
  const auditDuplicate = await mirrorMod.mirrorAuditEvent(mirror, { id: auditId, data: fsDb.writes.find((w) => w.path === `auditEvents/${auditId}`).data }, ctx);
  ok('an audit event written twice is one row', auditDuplicate.ok === true && (await count('audit_events')) === 1);
  await rejects('the legacy id column is unique', db, `insert into audit_events (action, legacy_firestore_id) values ('x', '${audit.legacy_firestore_id}')`, '23505');
  // The importer's own rows leave legacy_firestore_id null, so a rerun of the importer (which can insert the same legacy id
  // twice when it does not dedupe) behaves exactly as before the migration.
  await db.exec(`insert into audit_events (action, detail) values ('import_style', '{"source":"firestore","legacy_firestore_id":"auditEvents/imported-1"}'), ('import_style_again', '{"source":"firestore","legacy_firestore_id":"auditEvents/imported-1"}')`);
  await db.exec(`insert into audit_events (action) values ('no_key_one'), ('no_key_two')`);
  ok('import style audit rows (null legacy id column) can still be inserted repeatedly', (await q(`select count(*)::int n from audit_events where detail ->> 'legacy_firestore_id' = 'auditEvents/imported-1'`))[0].n === 2);

  // Second completion: now the definition exists, the people module can mirror the entitlement, and the link is kept.
  await db.exec(`insert into entitlements (id, person_id, program_id, assessment_id, access_type, status, retakes_allowed, legacy_firestore_id)
    values ('${entFull}', '${person}', 'executive-signature', 'full-assessment', 'comped', 'active', 1, 'entitlements/ent-full')`);
  const fsDb2 = fakeFirestore({
    'customers/cust-parity': {}, 'assessmentVersions/es-full-assessment-1.0.0': { status: 'published' }, 'assessmentDefinitions/full-assessment': { status: 'live' },
    'entitlements/ent-full': { customerId: 'cust-parity', programId: 'executive-signature', assessmentId: 'full-assessment', status: 'active', attemptsCompleted: 1, retakesAllowed: 1 }
  }, 500);
  const result2 = await createAssessmentPersistenceService({ db: fsDb2, FieldValue }).persistCompletedAssessment({
    customerId: 'cust-parity', entitlementId: 'ent-full', assessmentId: 'full-assessment', formVersion: full.formVersion,
    answers: Object.fromEntries(full.questions.map((x, i) => [x.id, ((i + 2) % 5) + 1])), startedAt: new Date(Date.now() - 300000).toISOString(),
    consent: { assessmentProcessing: true, noticeVersion: 'notice@1' }, idempotencyKey: 'pglite-full-2', actor: { actorType: 'participant', actorId: 'uid-parity', actorRole: 'participant' }
  });
  ok('the retake writes no version or definition document', !fsDb2.writes.some((w) => w.path.startsWith('assessmentVersions/') || w.path.startsWith('assessmentDefinitions/')));
  const second = await mirrorMod.mirrorAssessmentPersistence(mirror, fsDb2.writes, ctx);
  ok('the second completion mirrors with the entitlement linked and nothing degraded', second.ok === true && second.degraded === false);
  ok('the second attempt is linked to the entitlement', (await q(`select entitlement_id from assessment_attempts where id = $1`, [uuidFor(`attempt:${result2.attemptId}`)]))[0].entitlement_id === entFull);
  ok('the version has exactly one scoring row and is still published', (await count('assessment_scoring')) === 1 && (await q(`select status from assessment_versions where id = $1`, [version.id]))[0].status === 'published');
  const ghost = uuidFor('person:ghost@example.com');
  const ghostRun = await mirrorMod.mirrorAssessmentPersistence(mirror, fsDb2.writes, { now: NOW, personIds: { 'cust-parity': ghost } });
  ok('a missing person row skips the attempt and reports degraded, without a database error', ghostRun.ok === false && ghostRun.degraded === true && (await count('assessment_attempts')) === 2);
  const noId = await mirrorMod.mirrorCheckoutSessionCreated(mirror, { data: { action: 'checkout_session_created', program: 'tsa', sessionId: 'cs_test_noid' } }, ctx);
  ok('an audit document without an id reports no-audit-id and writes nothing', noId.ok === false && noId.error === 'no-audit-id' && (await q(`select count(*)::int n from audit_events where detail ->> 'sessionId' = 'cs_test_noid'`))[0].n === 0);

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
  ok('down: the outbox legacy id is gone', (await q(`select count(*)::int n from information_schema.columns where column_name = 'legacy_firestore_id' and table_name = 'outbox_events'`))[0].n === 0);
  ok('down: audit rows are kept', (await count('audit_events')) === auditBeforeDown);
  ok('down: assessment definitions are untouched', (await q(`select count(*)::int n from assessment_definitions where id = 'full-assessment'`))[0].n === 1);
  ok('down: audit_events.legacy_firestore_id (migration 2130) is left alone', (await q(`select count(*)::int n from information_schema.columns where table_name = 'audit_events' and column_name = 'legacy_firestore_id'`))[0].n === 1);
  ok('down: the down script deletes nothing from existing tables', !/\bdelete\b/i.test(downSql.replace(/--.*$/gm, '')));
  await db.exec(upSql);
  ok('up again after down works (re-runnable)', (await q(`select count(*)::int n from information_schema.tables where table_schema = 'public' and table_name in ('stripe_processed_sessions','service_requests')`))[0].n === 2);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
