// Tests for migration 2330: private.apply_readiness_completion (and its service role wrapper), private.readiness_take,
// the limit table and the rollback.
//   node supabase/readiness-submit-test.mjs
// Covers: who may execute, the happy path for both tiers (the exact rows), idempotency, person matching (primary email, old
// email, archived), the entitlement rules (free, comped, paid, retakes, consumed, the entitlement only mode), the limits
// (hourly, daily, address, global flag), input checks, the transaction (a failure leaves nothing behind, not even a count),
// privacy (no email or name outside the person rows), and that the rows equal what the Firebase service plus the real mirror
// module write for the same input.
import fs from 'fs';
import crypto from 'crypto';
import { createRequire } from 'module';
import { boot } from './schema-apply-harness.mjs';

const require = createRequire(import.meta.url);
const firebaseVersions = require('../functions-admin/executive-signature-versions');
const mirror = require('../functions-admin/supabase-mirror/payments-assessments.js');
const { createAssessmentPersistenceService } = require('../functions-admin/assessment-persistence-service');
const core = await import('./functions/readiness-submit/core.mjs');

const { db, failed } = await boot();
if (failed) { console.log('\nmigrations did not apply, stopping'); process.exit(1); }
let pass = 0, fail = 0;
const ok = (n, c, detail = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, !c && detail ? `[${detail}]` : ''); };
const count = async (sql) => (await db.query(`select count(*)::int n from ${sql}`)).rows[0].n;
const J = (v) => JSON.stringify(v);
// Same value, keys in sorted order (jsonb does not keep the order a document had).
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
const C = (v) => JSON.stringify(sortKeys(v));
const as = async (role, sql, claims) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${claims ? JSON.stringify(claims) : ''}', false);`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
};

const FREE = firebaseVersions.getVersion('readiness-free@1.0.0');
const FULL = firebaseVersions.getVersion('readiness-full@1.0.0');
const FORMS = { free: FREE, full: FULL };
let serial = 0;
const answersFor = (version, fn) => Object.fromEntries(version.questions.map((q, i) => [q.id, fn(q, i)]));
async function input(tier, over = {}, ctx = {}) {
  const version = FORMS[tier];
  const body = Object.assign({
    name: 'Test Person', email: `person${serial}@example.test`, tier, band: 'Strong', profile: 'Go-getter', formVersion: version.formVersion,
    submissionId: `sub-${++serial}`, answers: answersFor(version, (q, i) => ((i * 7 + serial) % 5) + 1), itemOrder: version.questions.map((q) => q.id),
    startedAt: new Date(Date.now() - 180000).toISOString(), durationSeconds: 180,
    consent: { assessmentProcessing: true, marketing: false, noticeVersion: 'readiness-privacy-preview@1.0' },
    source: { channel: 'web', campaignId: null, referrerCode: null }
  }, over);
  const checked = core.validateSubmission(body, Date.now());
  if (!checked.ok) throw new Error('test input is not valid: ' + checked.error);
  // Each call gets its own address bucket unless a test names one ('' means an unknown address), so the address limit never gets in the way.
  const ip = ctx.ip === undefined ? `10.${(serial >> 8) & 255}.${serial & 255}.${Math.floor(serial / 65536) + 1}` : ctx.ip;
  return core.buildDatabaseInput(checked.value, { ip, fullAccess: ctx.fullAccess || 'comped' });
}
const apply = async (doc) => (await db.query('select private.apply_readiness_completion($1::jsonb) as r', [J(doc)])).rows[0].r;
const applyError = async (doc) => { try { await apply(doc); return null; } catch (e) { return e; } };
const snapshot = async () => J({
  p: await count('people'), pe: await count('person_emails'), e: await count('entitlements'), a: await count('assessment_attempts'), r: await count('assessment_response_parts'),
  c: await count('consent_events'), o: await count('outbox_events'), s: await count('service_requests'), u: await count('audit_events'),
  d: await count('assessment_definitions'), v: await count('assessment_versions'), sc: await count('assessment_scoring'), l: await count('readiness_limits')
});
const dataSnapshot = async () => J({
  p: await count('people'), pe: await count('person_emails'), e: await count('entitlements'), a: await count('assessment_attempts'), r: await count('assessment_response_parts'),
  c: await count('consent_events'), o: await count('outbox_events'), s: await count('service_requests'), u: await count('audit_events')
});
const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const emailHash = (email) => sha('readiness-completion-limit:' + email);

// ---- who may execute ----
const fns = (await db.query(`select n.nspname, p.proname, p.prosecdef, p.prosrc, array_to_string(p.proconfig, ',') as config,
    has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
    has_function_privilege('service_role', p.oid, 'execute') as service_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname in ('apply_readiness_completion', 'readiness_take', 'readiness_need') order by n.nspname, p.proname`)).rows;
ok('apply_readiness_completion exists in private and public, plus the take function and the helper', fns.length === 4, fns.map((f) => f.nspname + '.' + f.proname).join());
for (const f of fns) {
  ok(`${f.nspname}.${f.proname}: anon and authenticated cannot execute, the service role can`, !f.anon_exec && !f.auth_exec && f.service_exec);
  ok(`${f.nspname}.${f.proname}: empty search_path`, /search_path=("")?(,|$)/.test(f.config || ''), f.config);
  ok(`${f.nspname}.${f.proname}: no dynamic sql, no backslash`, !/^\s*execute\b/im.test(f.prosrc) && !/\bexecute\b\s+(format|'|\$|quote)/i.test(f.prosrc) && !f.prosrc.includes('\\'));
}
ok('apply and take are security definer', fns.filter((f) => ['apply_readiness_completion', 'readiness_take'].includes(f.proname)).every((f) => f.prosecdef));
const wrapper = fns.find((f) => f.nspname === 'public');
ok('the public wrapper is one line that calls the private function', wrapper && /^\s*select private\.apply_readiness_completion\(p_input\)\s*$/.test(wrapper.prosrc));
const applyFn = fns.find((f) => f.nspname === 'private' && f.proname === 'apply_readiness_completion');
ok('the function takes no parameter that names a person, role or account status (one document only)',
  (await db.query(`select pg_get_function_arguments(p.oid) as a from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'apply_readiness_completion'`)).rows[0].a === 'p_input jsonb');
ok('the function never writes the sign in link or the role tables', !/(insert\s+into|update|delete\s+from)\s+public\.(role_grants|organizations|affiliations|enrollments)\b/i.test(applyFn.prosrc) && !/supabase_uid|auth_uid|account_status\s*=/i.test(applyFn.prosrc.replace(/v_account|account_status into/g, '')));
ok('the migration and the rollback have no backslash', !fs.readFileSync(new URL('./migrations/20261008002330_readiness_submit.sql', import.meta.url), 'utf8').includes('\\') && !fs.readFileSync(new URL('./rollbacks/20261008002330_readiness_submit_down.sql', import.meta.url), 'utf8').includes('\\'));
ok('lock_timeout 3s and statement_timeout 15s are set (set local) at the top of the function', /\nbegin\s*(--[^\n]*\s*)*perform set_config\('lock_timeout', '3s', true\);\s*perform set_config\('statement_timeout', '15s', true\);/i.test(applyFn.prosrc), applyFn.prosrc.slice(0, 300));
{
  const versionLock = applyFn.prosrc.indexOf('readiness-version');
  const firstMissingCheck = applyFn.prosrc.indexOf('if v_version_id is null then');
  ok('the version lock is taken only inside the "version row is missing" branch (and once more checked inside)', versionLock > firstMissingCheck && firstMissingCheck > 0 && applyFn.prosrc.split('readiness-version').length === 2);
  ok('email lookups compare citext as citext (no text cast on the columns)', !/(primary_email|e\.email)::text/.test(applyFn.prosrc) && /primary_email operator\(extensions\.=\) v_email::extensions\.citext/.test(applyFn.prosrc) && /e\.email operator\(extensions\.=\) v_email::extensions\.citext/.test(applyFn.prosrc));
}
const tableAccess = (await db.query(`select (select relrowsecurity from pg_class where oid = 'public.readiness_limits'::regclass) as rls,
  (select count(*)::int from pg_policies where tablename = 'readiness_limits') as policies,
  (select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and table_name = 'readiness_limits' and grantee in ('anon', 'authenticated', 'PUBLIC')) as grants`)).rows[0];
ok('readiness_limits: row level security on, no policy, no grant for anon or authenticated', tableAccess.rls === true && tableAccess.policies === 0 && tableAccess.grants === 0);
let anonRefused = false, authRefused = false, tableRefused = false;
try { await as('anon', `select public.apply_readiness_completion('{}'::jsonb)`); } catch (e) { anonRefused = /permission denied/.test(e.message); }
try { await as('authenticated', `select public.apply_readiness_completion('{}'::jsonb)`); } catch (e) { authRefused = /permission denied/.test(e.message); }
try { await as('authenticated', `select * from public.readiness_limits`); } catch (e) { tableRefused = /permission denied/.test(e.message); }
ok('anon is refused at the wrapper', anonRefused);
ok('authenticated is refused at the wrapper', authRefused);
ok('authenticated cannot read the limit table', tableRefused);

// ---- the first quick check: a new person ----
let doc = await input('free', { email: 'Ada.Quick@Example.Test', name: 'Ada Lovelace King', consent: { assessmentProcessing: true, marketing: true, noticeVersion: 'readiness-privacy-preview@1.0' }, source: { channel: 'web', campaignId: 'summer-2026', referrerCode: 'friend_1' } }, { ip: '203.0.113.5' });
const wrapped = (await as('service_role', `select public.apply_readiness_completion('${J(doc).replace(/'/g, "''")}'::jsonb) as r`))[0].r;
ok('the service role can call the wrapper and a new quick check is completed', wrapped.status === 'completed' && /^[0-9a-f-]{36}$/.test(wrapped.attempt_id) && wrapped.person_created === true && wrapped.entitlement_created === true);
const ADA = (await db.query(`select * from people where primary_email = 'ada.quick@example.test'`)).rows;
ok('a person is created with the lower case email, the split name and the import id', ADA.length === 1 && ADA[0].id === doc.person_id_hint && ADA[0].first_name === 'Ada' && ADA[0].last_name === 'Lovelace King' && ADA[0].display_name === 'Ada Lovelace King' && ADA[0].account_status === 'active' && ADA[0].last_activity_at !== null);
ok('the person has no sign in link and is not a test person', ADA[0].auth_uid === null && ADA[0].supabase_uid === null && ADA[0].is_test === false);
ok('one active email row, not verified', (await db.query(`select status, verified_at from person_emails where person_id = '${ADA[0].id}'`)).rows.map((r) => r.status + ':' + r.verified_at).join() === 'active:null');
const ent = (await db.query(`select * from entitlements where person_id = '${ADA[0].id}'`)).rows;
ok('one free quick-check entitlement, active, no retakes allowed, one attempt counted, no report', ent.length === 1 && ent[0].program_id === 'executive-signature' && ent[0].assessment_id === 'quick-check' && ent[0].access_type === 'free'
  && ent[0].status === 'active' && ent[0].retakes_allowed === 0 && ent[0].retakes_used === 0 && ent[0].attempts_completed === 1 && ent[0].report_available === false && ent[0].valid_from !== null && ent[0].payment_reference === 'readiness-anonymous' && ent[0].sponsor_organization_id === null);
const def = (await db.query(`select * from assessment_definitions where id = 'quick-check'`)).rows[0];
const ver = (await db.query(`select * from assessment_versions where assessment_id = 'quick-check'`)).rows;
ok('the quick-check definition (live) and its published version were created, the definition points at the version', def.status === 'live' && def.program_id === 'executive-signature' && def.title === 'Executive Signature Quick Check' && def.estimated_minutes === 5
  && ver.length === 1 && ver[0].status === 'published' && ver[0].published_at !== null && ver[0].id === def.current_version_id && ver[0].version === '1.0.0' && ver[0].scoring_version === 'es-quick-check-score@1.0.0'
  && ver[0].questions.length === 20 && J(ver[0].questions) === J(JSON.parse(J(FREE.questions))));
ok('the version id is the import id', ver[0].id === mirror.uuidFor('version:es-quick-check-1.0.0'));
ok('its scoring row holds the scoring inputs', C((await db.query(`select scoring from assessment_scoring where version_id = '${ver[0].id}'`)).rows[0].scoring) === C(firebaseVersions.scoreVersion(FREE, firebaseVersions.normalizeAnswers(FREE, answersFor(FREE, () => 3))).scoringInputs));
const att = (await db.query(`select * from assessment_attempts where person_id = '${ADA[0].id}'`)).rows;
const expectedScore = firebaseVersions.scoreVersion(FREE, firebaseVersions.normalizeAnswers(FREE, await (async () => { const b = doc.parts.flatMap((p) => p.answers); return Object.fromEntries(b.map((a) => [a.questionId, a.value])); })()));
ok('one completed attempt with the server score, band and profile', att.length === 1 && att[0].id === wrapped.attempt_id && att[0].status === 'completed' && Number(att[0].overall_score) === expectedScore.overallScore
  && att[0].band === expectedScore.band && att[0].profile_label === expectedScore.profileLabel && C(att[0].area_scores) === C(expectedScore.areaScores));
ok('the attempt links the entitlement, the version and has no sponsor', att[0].entitlement_id === ent[0].id && att[0].version_id === ver[0].id && att[0].sponsor_organization_id === null && att[0].enrollment_id === null && att[0].program_id === 'executive-signature' && att[0].assessment_id === 'quick-check');
ok('campaign, duration, start and finish times are set', att[0].campaign_id === 'summer-2026' && att[0].duration_seconds === 180 && att[0].started_at !== null && att[0].completed_at !== null);
ok('both checksums are stored', att[0].response_checksum === doc.response_checksum && att[0].result_checksum === doc.result_checksum && /^[0-9a-f]{64}$/.test(att[0].idempotency_hash));
ok('the source holds channel, campaign, referrer, form version and the person as creator', att[0].source.channel === 'web' && att[0].source.campaignId === 'summer-2026' && att[0].source.referrerCode === 'friend_1' && att[0].source.formVersion === 'readiness-free@1.0.0' && att[0].source.createdBy === ADA[0].id && !('suspect' in att[0].source));
const consents = (await db.query(`select * from consent_events where person_id = '${ADA[0].id}' order by type`)).rows;
ok('two consent events: assessment processing and marketing, with the notice version and the channel', consents.map((c) => c.type + ':' + c.granted + ':' + c.notice_version + ':' + c.source).join() === 'assessment_processing:true:readiness-privacy-preview@1.0:web,marketing:true:readiness-privacy-preview@1.0:web');
ok('the attempt lists both consent ids', J([...att[0].consent_event_ids].sort()) === J(consents.map((c) => c.id).sort()));
const parts = (await db.query(`select * from assessment_response_parts where attempt_id = '${att[0].id}' order by part_number`)).rows;
ok('the raw answers are one part of 20 with the item order in the first part', parts.length === 1 && parts[0].part_count === 1 && parts[0].answers.length === 20 && parts[0].scoring_inputs.itemOrder.length === 20 && parts[0].scoring_inputs.scoringVersion === 'es-quick-check-score@1.0.0' && parts[0].payload === null && parts[0].response_checksum === doc.parts[0].checksum);
const outbox = (await db.query(`select * from outbox_events where correlation_id = '${att[0].idempotency_hash}'`)).rows;
ok('one outbox event: analytics projection, pending', outbox.length === 1 && outbox[0].event_type === 'assessment.analytics_projection' && outbox[0].aggregate_type === 'assessment_completed' && outbox[0].status === 'pending' && outbox[0].payload.attemptId === att[0].id && outbox[0].payload.assessmentId === 'quick-check');
const sreq = (await db.query(`select * from service_requests where id = '${att[0].idempotency_hash}'`)).rows;
ok('the idempotency record holds the first answer', sreq.length === 1 && sreq[0].operation === 'persistCompletedAssessment' && sreq[0].result.attemptId === att[0].id && sreq[0].result.reportAvailable === false && sreq[0].completed_at !== null);
const audit = (await db.query(`select * from audit_events where person_id = '${ADA[0].id}'`)).rows;
ok('one audit row with counts and opaque ids', audit.length === 1 && audit[0].action === 'assessment_completed' && audit[0].subject_type === 'person' && audit[0].subject_id === att[0].id && audit[0].detail.rows.assessment_attempts === 1 && audit[0].detail.rows.consent_events === 2 && audit[0].detail.rows.people === 1 && audit[0].detail.rows.entitlements === 1 && audit[0].detail.suspect === false);
ok('the audit row, the answer and every non person row hold no email and no name', !/ada\.quick|lovelace|ada /i.test(J(audit) + J(wrapped) + J(sreq) + J(outbox) + J(att) + J(consents) + J(ent)));

// ---- the timeouts really apply inside the transaction, and end with it ----
{
  const probe = await input('free', { email: 'timeouts@example.test' });
  const seen = await db.transaction(async (tx) => {
    await tx.query('select private.apply_readiness_completion($1::jsonb)', [J(probe)]);
    return (await tx.query(`select current_setting('lock_timeout') as l, current_setting('statement_timeout') as s`)).rows[0];
  });
  ok('inside the transaction lock_timeout is 3s and statement_timeout is 15s', seen.l === '3s' && seen.s === '15s', J(seen));
  const after = (await db.query(`select current_setting('lock_timeout') as l, current_setting('statement_timeout') as s`)).rows[0];
  ok('and they do not leak to the next transaction', after.l !== '3s' && after.s !== '15s', J(after));
}

// ---- idempotency ----
const before = await dataSnapshot();
const limitsBefore = J((await db.query(`select kind, period, calls from readiness_limits order by kind, key, period`)).rows);
let r = await apply(doc);
ok('the same submission again reports a replay with the first attempt id', r.status === 'replay' && r.attempt_id === att[0].id);
ok('a replay changes nothing anywhere', before === await dataSnapshot());
ok('a replay does not use up a limit', limitsBefore === J((await db.query(`select kind, period, calls from readiness_limits order by kind, key, period`)).rows));
const sameWithOtherAddress = Object.assign({}, doc, { ip_hash: sha('x') });
r = await apply(sameWithOtherAddress);
ok('a replay from another address is still a replay', r.status === 'replay' && r.attempt_id === att[0].id);

// ---- a second quick check by the same person ----
const second = await input('free', { email: 'ada.quick@example.test', name: 'Someone Else' });
r = await apply(second);
ok('a second attempt is a new attempt', r.status === 'completed' && r.attempt_id !== att[0].id && r.person_created === false && r.entitlement_created === false);
ok('no second person, email row or entitlement; the name is left alone', (await count(`people where primary_email = 'ada.quick@example.test'`)) === 1 && (await count(`entitlements where person_id = '${ADA[0].id}'`)) === 1
  && (await db.query(`select display_name from people where id = '${ADA[0].id}'`)).rows[0].display_name === 'Ada Lovelace King' && (await count(`person_emails where person_id = '${ADA[0].id}'`)) === 1);
const ent2 = (await db.query(`select attempts_completed, retakes_used, retakes_allowed, status from entitlements where person_id = '${ADA[0].id}'`)).rows[0];
ok('the entitlement counts two attempts, stays active, and respects its own retake rule', ent2.attempts_completed === 2 && ent2.retakes_used === 0 && ent2.retakes_allowed === 0 && ent2.status === 'active');
r = await apply(await input('free', { email: 'ada.quick@example.test', consent: { assessmentProcessing: true, marketing: true, noticeVersion: 'readiness-privacy-preview@1.0' } }));
ok('and a third one works too (free retakes are unlimited, as in Firebase)', r.status === 'completed' && (await count(`assessment_attempts where person_id = '${ADA[0].id}'`)) === 3 && (await count(`consent_events where person_id = '${ADA[0].id}'`)) === 4);
ok('consent from an existing person: marketing is NOT recorded (the third attempt asked for it), processing is recorded as unverified', (await count(`consent_events where person_id = '${ADA[0].id}' and type = 'marketing'`)) === 1
  && (await db.query(`select source from consent_events where person_id = '${ADA[0].id}' and type = 'assessment_processing' order by recorded_at, id`)).rows.map((x) => x.source).join() === 'web,web (unverified),web (unverified)');
{
  const third = (await db.query(`select a.consent_event_ids, u.detail from assessment_attempts a join audit_events u on u.subject_id = a.id::text where a.id = '${r.attempt_id}'`)).rows[0];
  ok('the attempt lists only the processing consent, and the audit row says the consent was unverified and marketing was skipped', third.consent_event_ids.length === 1 && third.detail.consent_unverified === true && third.detail.marketing_skipped === true && third.detail.rows.consent_events === 1);
  ok('for the person created by the first call the audit row says verified-by-creation (not unverified) and nothing skipped', audit[0].detail.consent_unverified === false && audit[0].detail.marketing_skipped === false);
}

// ---- atomicity: a forced failure leaves nothing behind (run before the full assessment exists, so its definition is tested too) ----
await db.exec(`create function public.test_boom() returns trigger language plpgsql as $$ begin raise exception 'forced failure'; end $$;
  create trigger boom before insert on public.audit_events for each row execute function public.test_boom();`);
const boomDoc = await input('full', { email: 'boom@example.test' });
let s0 = await snapshot();
let err = await applyError(boomDoc);
ok('a forced failure at the last step is raised to the caller', !!err && /forced failure/.test(err.message));
ok('the person, entitlement, definition, version, attempt, answers, consent, outbox, request and the limit count were all rolled back', s0 === await snapshot());
await db.exec('drop trigger boom on public.audit_events; drop function public.test_boom()');
r = await apply(boomDoc);
ok('the retry of the same submission then succeeds, once', r.status === 'completed' && (await count(`assessment_attempts where idempotency_hash = '${boomDoc.idempotency_hash}'`)) === 1);

// ---- the full assessment, a new person, Firebase style (comped) ----
const fullDoc = await input('full', { email: 'grace.full@example.test', name: 'Grace Hopper', consent: { assessmentProcessing: true, marketing: false, noticeVersion: 'readiness-privacy-preview@1.0' } });
r = await apply(fullDoc);
const GRACE = (await db.query(`select id from people where primary_email = 'grace.full@example.test'`)).rows[0].id;
const gEnt = (await db.query(`select * from entitlements where person_id = '${GRACE}'`)).rows;
ok('a full assessment completes and creates one comped entitlement with no retakes', r.status === 'completed' && gEnt.length === 1 && gEnt[0].assessment_id === 'full-assessment' && gEnt[0].access_type === 'comped' && gEnt[0].status === 'consumed' && gEnt[0].retakes_allowed === 0
  && gEnt[0].attempts_completed === 1 && gEnt[0].retakes_used === 0 && gEnt[0].report_available === true && gEnt[0].payment_reference === 'readiness-anonymous' && gEnt[0].sponsor_organization_id === null);
ok('the full assessment definition and version exist: 40 questions, published', (await db.query(`select d.status, d.title, v.status vs, jsonb_array_length(v.questions) n, v.id = d.current_version_id cur from assessment_definitions d join assessment_versions v on v.assessment_id = d.id where d.id = 'full-assessment'`)).rows.map((x) => J(x)).join() === J({ status: 'live', title: 'Executive Signature Full Assessment', vs: 'published', n: 40, cur: true }));
ok('the full attempt has two parts of 20 and two outbox events (analytics and report)', (await count(`assessment_response_parts where attempt_id = '${r.attempt_id}'`)) === 2
  && (await db.query(`select event_type from outbox_events where correlation_id = '${fullDoc.idempotency_hash}' order by event_type`)).rows.map((x) => x.event_type).join() === 'assessment.analytics_projection,assessment.report_generation');
ok('only the first part carries the scoring inputs', (await db.query(`select part_number, scoring_inputs from assessment_response_parts where attempt_id = '${r.attempt_id}' order by part_number`)).rows.map((x) => Object.keys(x.scoring_inputs).length).join() === '3,0');
ok('there is a single consent event when marketing is not given', (await count(`consent_events where person_id = '${GRACE}'`)) === 1);
s0 = await snapshot();
const limitsMid = J((await db.query(`select kind, period, calls from readiness_limits where kind = 'address_hour' and key = '${emailHash('grace.full@example.test')}'`)).rows);
r = await apply(await input('full', { email: 'grace.full@example.test' }));
ok('a second full assessment by the same person is refused (no attempt left), as Firebase refuses it', r.status === 'refused' && r.reason === 'no_attempts');
const afterRefusal = await snapshot();
ok('the refusal wrote nothing except the limit count', J({ ...JSON.parse(s0), l: 0 }) === J({ ...JSON.parse(afterRefusal), l: 0 }));
ok('and that attempt was counted', J((await db.query(`select kind, period, calls from readiness_limits where kind = 'address_hour' and key = '${emailHash('grace.full@example.test')}'`)).rows) !== limitsMid);

// ---- the anonymous path never uses, counts against or attaches to anyone else's entitlement ----
const entitlementsState = async (personId) => J((await db.query(`select id, access_type, status, attempts_completed, retakes_used, retakes_allowed, report_available, sponsor_organization_id, payment_reference from entitlements where person_id = '${personId}' and (payment_reference is distinct from 'readiness-anonymous') order by id`)).rows);
s0 = await dataSnapshot();
r = await apply(await input('full', { email: 'nobody.paid@example.test' }, { fullAccess: 'entitlement' }));
ok('entitlement mode: the anonymous full assessment is refused as "sign in required"', r.status === 'refused' && r.reason === 'sign_in_required');
ok('and no person, email row, entitlement or attempt is kept for it', s0 === await dataSnapshot() && (await count(`people where primary_email = 'nobody.paid@example.test'`)) === 0);
r = await apply(await input('free', { email: 'quick.in.entitlement.mode@example.test' }, { fullAccess: 'entitlement' }));
ok('entitlement mode does not affect the quick check', r.status === 'completed');
const HAL = '00000000-0000-0000-0000-0000000000a1';
await db.exec(`insert into people (id, primary_email) values ('${HAL}', 'hal.paid@example.test');
  insert into entitlements (person_id, program_id, assessment_id, access_type, status, retakes_allowed, valid_from, payment_reference) values ('${HAL}', 'executive-signature', 'full-assessment', 'paid', 'active', 1, now(), 'stripe:cs_test_hal')`);
let before2 = await entitlementsState(HAL);
r = await apply(await input('full', { email: 'hal.paid@example.test' }, { fullAccess: 'entitlement' }));
ok('entitlement mode: a person with an unused paid entitlement is still refused (the anonymous path may not use it)', r.status === 'refused' && r.reason === 'sign_in_required' && before2 === await entitlementsState(HAL));
r = await apply(await input('full', { email: 'hal.paid@example.test' }, { fullAccess: 'comped' }));
const halAttempt = (await db.query(`select a.entitlement_id, a.sponsor_organization_id, e.access_type, e.payment_reference from assessment_attempts a join entitlements e on e.id = a.entitlement_id where a.id = '${r.attempt_id}'`)).rows[0];
ok('comped mode: the attempt goes to the path\'s own comped entitlement, never to the paid one', r.status === 'completed' && r.entitlement_created === true && halAttempt.access_type === 'comped' && halAttempt.payment_reference === 'readiness-anonymous' && halAttempt.sponsor_organization_id === null);
ok('the paid entitlement did not change at all (attempts, retakes, report, status, reference)', before2 === await entitlementsState(HAL));
r = await apply(await input('full', { email: 'hal.paid@example.test' }, { fullAccess: 'comped' }));
ok('a second anonymous full assessment is refused, and the paid entitlement is still untouched', r.status === 'refused' && r.reason === 'no_attempts' && before2 === await entitlementsState(HAL));
// a sponsored entitlement and a sponsor organization
const ORG = '00000000-0000-0000-0000-0000000000f0';
await db.exec(`insert into organizations (id, slug, name) values ('${ORG}', 'sponsor-co', 'Sponsor Co')`);
const SAM = '00000000-0000-0000-0000-0000000000a5';
await db.exec(`insert into people (id, primary_email) values ('${SAM}', 'sam.sponsored@example.test');
  insert into entitlements (person_id, program_id, assessment_id, access_type, status, retakes_allowed, valid_from, sponsor_organization_id) values
    ('${SAM}', 'executive-signature', 'full-assessment', 'sponsored', 'active', 2, now(), '${ORG}'),
    ('${SAM}', 'executive-signature', 'quick-check', 'paid', 'active', 0, now(), null)`.replace("'paid', 'active', 0, now(), null)", "'free', 'active', 0, now(), '" + ORG + "')"));
let samBefore = await entitlementsState(SAM);
r = await apply(await input('full', { email: 'sam.sponsored@example.test' }));
const samAttempt = (await db.query(`select a.sponsor_organization_id, a.entitlement_id, e.access_type from assessment_attempts a join entitlements e on e.id = a.entitlement_id where a.id = '${r.attempt_id}'`)).rows[0];
ok('a sponsored full entitlement is not used: the attempt has no sponsor organization and uses the path\'s own comped entitlement', r.status === 'completed' && samAttempt.sponsor_organization_id === null && samAttempt.access_type === 'comped');
ok('and the sponsored entitlement did not change', samBefore === await entitlementsState(SAM));
r = await apply(await input('free', { email: 'sam.sponsored@example.test' }));
const samQuick = (await db.query(`select a.sponsor_organization_id from assessment_attempts a where a.id = '${r.attempt_id}'`)).rows[0];
ok('a quick check never copies a sponsor organization onto the attempt, even from a free entitlement that names one', r.status === 'completed' && samQuick.sponsor_organization_id === null);
// an admin granted comped entitlement is not the path\'s to use
const IDA = '00000000-0000-0000-0000-0000000000a2';
await db.exec(`insert into people (id, primary_email) values ('${IDA}', 'ida.both@example.test');
  insert into entitlements (person_id, program_id, assessment_id, access_type, status, retakes_allowed, valid_from) values ('${IDA}', 'executive-signature', 'full-assessment', 'comped', 'active', 3, now() - interval '1 day');
  insert into entitlements (person_id, program_id, assessment_id, access_type, status, retakes_allowed, valid_from, payment_reference) values ('${IDA}', 'executive-signature', 'full-assessment', 'paid', 'active', 0, now(), 'stripe:cs_test_ida')`);
let idaBefore = await entitlementsState(IDA);
r = await apply(await input('full', { email: 'ida.both@example.test' }));
ok('another comped grant (given by staff) and a paid one are left alone: the anonymous full assessment is refused', r.status === 'refused' && r.reason === 'no_attempts' && idaBefore === await entitlementsState(IDA));
// expired, revoked, not yet valid paid entitlements are irrelevant to this path too
const JOY = '00000000-0000-0000-0000-0000000000a3';
await db.exec(`insert into people (id, primary_email) values ('${JOY}', 'joy.old@example.test');
  insert into entitlements (person_id, program_id, assessment_id, access_type, status, retakes_allowed, valid_from, valid_until, payment_reference) values
    ('${JOY}', 'executive-signature', 'full-assessment', 'paid', 'active', 0, now() - interval '10 days', now() - interval '1 day', 'stripe:cs_test_joy1'),
    ('${JOY}', 'executive-signature', 'full-assessment', 'paid', 'revoked', 0, now() - interval '10 days', null, 'stripe:cs_test_joy2')`);
let joyBefore = await entitlementsState(JOY);
r = await apply(await input('full', { email: 'joy.old@example.test' }));
ok('old paid entitlements are untouched when the path makes its own', r.status === 'completed' && joyBefore === await entitlementsState(JOY));
// A quick check beside a paid or sponsored quick-check entitlement
const LEO = '00000000-0000-0000-0000-0000000000a6';
await db.exec(`insert into people (id, primary_email) values ('${LEO}', 'leo.paidquick@example.test');
  insert into entitlements (person_id, program_id, assessment_id, access_type, status, retakes_allowed, valid_from, payment_reference) values ('${LEO}', 'executive-signature', 'quick-check', 'paid', 'active', 5, now(), 'stripe:cs_test_leo')`);
let leoBefore = await entitlementsState(LEO);
r = await apply(await input('free', { email: 'leo.paidquick@example.test' }));
ok('a paid quick-check entitlement is not used either: the path keeps its own free one', r.status === 'completed' && r.entitlement_created === true && leoBefore === await entitlementsState(LEO));
ok('no attempt of this path is ever attached to a paid or sponsored entitlement', (await count(`assessment_attempts a join entitlements e on e.id = a.entitlement_id where e.access_type in ('paid', 'sponsored') and a.source ->> 'formVersion' is not null`)) === 0);
ok('no attempt of this path carries a sponsor organization', (await count(`assessment_attempts where sponsor_organization_id is not null`)) === 0);
const fnSrc = (await db.query(`select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'apply_readiness_completion'`)).rows[0].prosrc;
ok('the function source never names the paid or sponsored access types and never reads or writes a sponsor organization', !/'paid'|'sponsored'/.test(fnSrc) && !/sponsor_organization_id/.test(fnSrc.replace(/sponsor_organization_id is null/g, '')));
// quick check with a switched off free entitlement
const KAY = '00000000-0000-0000-0000-0000000000a4';
await db.exec(`insert into people (id, primary_email) values ('${KAY}', 'kay.off@example.test');
  insert into entitlements (person_id, program_id, assessment_id, access_type, status, retakes_allowed, valid_from) values ('${KAY}', 'executive-signature', 'quick-check', 'free', 'revoked', 0, now())`);
s0 = await dataSnapshot();
r = await apply(await input('free', { email: 'kay.off@example.test' }));
ok('a quick check against a revoked free entitlement is refused and writes nothing', r.status === 'refused' && r.reason === 'entitlement' && s0 === await dataSnapshot());

// ---- finding the person ----
const CAROL = '00000000-0000-0000-0000-0000000000c1';
await db.exec(`insert into people (id, auth_uid, primary_email, display_name, last_activity_at) values ('${CAROL}', 'fb_carol', 'carol@example.test', 'Carol Keep', '2020-01-01')`);
s0 = await count('people');
doc = await input('free', { email: 'x@example.test' });
doc.email = '  Carol@Example.TEST ';
r = await apply(doc);
ok('an existing person is found by the primary email, with case and spaces ignored', r.status === 'completed' && r.person_created === false && (await count('people')) === s0 && (await count(`assessment_attempts where person_id = '${CAROL}'`)) === 1);
ok('the existing person keeps the sign in link and the name, and the activity date moves', (await db.query(`select auth_uid, display_name, last_activity_at > '2021-01-01' as moved from people where id = '${CAROL}'`)).rows.map((x) => J(x)).join() === J({ auth_uid: 'fb_carol', display_name: 'Carol Keep', moved: true }));
const DAN = '00000000-0000-0000-0000-0000000000d1';
await db.exec(`insert into people (id, primary_email) values ('${DAN}', 'dan.new@example.test'); insert into person_emails (person_id, email, status) values ('${DAN}', 'dan.old@example.test', 'active')`);
s0 = await count('people');
r = await apply(await input('free', { email: 'dan.old@example.test' }));
ok('a person is found through an active email row of another address', r.status === 'completed' && (await count('people')) === s0 && (await count(`assessment_attempts where person_id = '${DAN}'`)) === 1);
const ERIN = '00000000-0000-0000-0000-0000000000e1';
await db.exec(`insert into people (id, primary_email) values ('${ERIN}', 'erin.now@example.test'); insert into person_emails (person_id, email, status, retired_at) values ('${ERIN}', 'erin.past@example.test', 'historical', now())`);
r = await apply(await input('free', { email: 'erin.past@example.test' }));
ok('a historical email row does not match: a new person is created', r.status === 'completed' && r.person_created === true && (await count(`assessment_attempts where person_id = '${ERIN}'`)) === 0);
for (const status of ['archived', 'deletion_pending']) {
  const email = `${status.replace('_', '.')}@example.test`;
  await db.exec(`insert into people (id, primary_email, account_status) values (gen_random_uuid(), '${email}', '${status}')`);
  s0 = await dataSnapshot();
  const limitBefore = (await db.query(`select coalesce(sum(calls), 0)::int n from readiness_limits where key = '${emailHash(email)}'`)).rows[0].n;
  r = await apply(await input('free', { email }));
  ok(`${status} account: refused with the generic refusal`, r.status === 'refused' && r.reason === 'account' && !('attempt_id' in r));
  ok(`${status} account: nothing is written for it`, s0 === await dataSnapshot());
  ok(`${status} account: the attempt is counted`, (await db.query(`select coalesce(sum(calls), 0)::int n from readiness_limits where key = '${emailHash(email)}'`)).rows[0].n === limitBefore + 2);
}
await db.exec(`insert into people (id, primary_email, account_status) values (gen_random_uuid(), 'restricted@example.test', 'restricted')`);
r = await apply(await input('free', { email: 'restricted@example.test' }));
ok('a restricted account can still submit (as in Firebase)', r.status === 'completed');
await db.exec(`insert into people (id, primary_email) values ('${doc.person_id_hint}', 'hint.owner@example.test')`);
const taken = await input('free', { email: 'hint.taker@example.test' });
taken.person_id_hint = doc.person_id_hint;
r = await apply(taken);
ok('a hint id already used by another person gets a fresh id', r.status === 'completed' && (await db.query(`select id from people where primary_email = 'hint.taker@example.test'`)).rows[0].id !== doc.person_id_hint);
const noHint = await input('free', { email: 'nohint@example.test' });
noHint.person_id_hint = null;
r = await apply(noHint);
ok('without a hint a random id is used', r.status === 'completed' && (await count(`people where primary_email = 'nohint@example.test'`)) === 1);

// ---- the limits ----
const LIM = 'limit.person@example.test';
const results = [];
for (let i = 0; i < 7; i += 1) results.push((await apply(await input('free', { email: LIM }))).status);
ok('per email: 5 per hour, then limited', J(results) === J(['completed', 'completed', 'completed', 'completed', 'completed', 'limited', 'limited']), J(results));
const LP = (await db.query(`select id from people where primary_email = '${LIM}'`)).rows[0].id;
ok('limited attempts write nothing (five attempts, five consents)', (await count(`assessment_attempts where person_id = '${LP}'`)) === 5 && (await count(`consent_events where person_id = '${LP}'`)) === 5);
ok('and the counter stays at 5 (a refusal does not count)', (await db.query(`select calls from readiness_limits where kind = 'address_hour' and key = '${emailHash(LIM)}'`)).rows[0].calls === 5);
const take = async (eh, ih, at, unknown = false) => (await db.query(`select private.readiness_take($1, $2, $3::timestamptz, $4) as r`, [eh, ih || sha('ip-of-' + eh), at, unknown])).rows[0].r;
const base = '2030-03-15T00:30:00Z';
const hourAt = (h, m = 30) => `2030-03-15T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;
const E1 = sha('addr-day-test');
let verdicts = [];
for (let i = 0; i < 5; i += 1) verdicts.push((await take(E1, null, hourAt(0))).allowed);
ok('per email: five in one hour are allowed', verdicts.every(Boolean));
ok('a sixth in the same hour is limited by the hourly rule', (await take(E1, null, hourAt(0, 59))).reason === 'address-hourly-limit');
verdicts = [];
for (let i = 0; i < 5; i += 1) verdicts.push((await take(E1, null, hourAt(1))).allowed);
ok('the next hour allows five more (ten for the day)', verdicts.every(Boolean));
ok('the eleventh of the day says the daily rule', (await take(E1, null, hourAt(2))).reason === 'address-daily-limit');
ok('the next day starts again', (await take(E1, null, '2030-03-16T00:05:00Z')).allowed === true);
const IPH = sha('ip-test');
verdicts = [];
for (let i = 0; i < 31; i += 1) verdicts.push(await take(sha('ip-person-' + i), IPH, hourAt(8)));
ok('per address hash: 30 per hour, the 31st is limited', verdicts.slice(0, 30).every((v) => v.allowed) && verdicts[30].allowed === false && verdicts[30].reason === 'ip-hourly-limit');
ok('the limited call did not count against its email', (await take(sha('ip-person-30'), null, hourAt(8))).allowed === true);
ok('another hour for the same address is fine', (await take(sha('ip-other'), IPH, hourAt(9))).allowed === true);
{
  const U = sha('unknown-bucket');
  verdicts = [];
  for (let i = 0; i < 11; i += 1) verdicts.push(await take(sha('unknown-person-' + i), U, hourAt(11), true));
  ok('the shared unknown address bucket has its own lower limit: 10 per hour, the 11th is limited', verdicts.slice(0, 10).every((v) => v.allowed) && verdicts[10].allowed === false && verdicts[10].reason === 'ip-hourly-limit');
  ok('the same bucket under the normal flag still allows 30 per hour', (await take(sha('unknown-person-x'), U, hourAt(11), false)).allowed === true);
  ok('a missing address hash is refused as invalid input', await (async () => { try { await db.query(`select private.readiness_take($1, null, now(), false)`, [sha('z')]); return false; } catch (e) { return /invalid readiness input/.test(e.message); } })());
}
ok('housekeeping: windows older than three days are removed', await (async () => {
  await db.exec(`insert into readiness_limits (kind, key, period, calls, updated_at) values ('address_day', '${sha('ancient')}', '20200101', 3, '2020-01-01')`);
  await take(sha('housekeeping'), null, hourAt(10));
  return (await count(`readiness_limits where period = '20200101'`)) === 0;
})());
// the global limit only marks
const G = '2031-05-05';
await db.exec(`insert into readiness_limits (kind, key, period, calls, updated_at) values ('global_day', 'all', '20310505', 1999, '${G}T00:00:00Z')`);
let g1 = await take(sha('g1'), null, `${G}T01:00:00Z`);
let g2 = await take(sha('g2'), null, `${G}T01:01:00Z`);
let g3 = await take(sha('g3'), null, `${G}T01:02:00Z`);
ok('global: the 2000th is allowed and not marked', g1.allowed === true && g1.over_global === false);
ok('global: past 2000 requests are still allowed, marked, and the first trip is reported once', g2.allowed === true && g2.over_global === true && g2.first_global_trip === true && g3.allowed === true && g3.over_global === true && g3.first_global_trip === false);
{
  await db.exec(`insert into readiness_limits (kind, key, period, calls, trip_logged, updated_at) values ('global_day', 'all', '20320101', 19999, true, '2032-01-01T00:00:00Z')`);
  const c1 = await take(sha('c1'), null, '2032-01-01T02:00:00Z');
  const c2 = await take(sha('c2'), null, '2032-01-01T02:01:00Z');
  ok('the emergency ceiling: the 20000th is allowed (and marked)', c1.allowed === true && c1.over_global === true);
  ok('past 20000 per day every request is refused with the ceiling reason', c2.allowed === false && c2.reason === 'global-ceiling');
  ok('and the next day starts again', (await take(sha('c3'), null, '2032-01-02T00:01:00Z')).allowed === true);
}
const gDoc = await input('free', { email: 'over.global@example.test' });
await db.exec(`insert into readiness_limits (kind, key, period, calls, trip_logged, updated_at) values ('global_day', 'all', to_char(now() at time zone 'UTC', 'YYYYMMDD'), 2500, true, now()) on conflict (kind, key, period) do update set calls = 2500, trip_logged = true`);
r = await apply(gDoc);
ok('over the global limit an attempt is still saved, never refused', r.status === 'completed' && r.over_global_limit === true && r.first_global_trip === false, J(r));
ok('and it is marked suspect on the attempt and in the audit row', (await db.query(`select source from assessment_attempts where id = '${r.attempt_id}'`)).rows[0].source.suspect === true && (await db.query(`select detail from audit_events where subject_id = '${r.attempt_id}'`)).rows[0].detail.over_global_limit === true);
{
  await db.exec(`update readiness_limits set calls = 20000 where kind = 'global_day' and key = 'all' and period = to_char(now() at time zone 'UTC', 'YYYYMMDD')`);
  s0 = await dataSnapshot();
  const ceilingDoc = await input('free', { email: 'ceiling.person@example.test' });
  r = await apply(ceilingDoc);
  ok('apply: at the emergency ceiling the answer is limited with the ceiling reason', r.status === 'limited' && r.reason === 'global-ceiling');
  ok('and nothing is written', s0 === await dataSnapshot());
  await db.exec(`update readiness_limits set calls = 2500 where kind = 'global_day' and key = 'all' and period = to_char(now() at time zone 'UTC', 'YYYYMMDD')`);
  r = await apply(ceilingDoc);
  ok('below the ceiling the same submission is saved (marked suspect)', r.status === 'completed' && r.over_global_limit === true);
}
r = await apply(await input('free', { email: 'quick.bot@example.test', durationSeconds: 5 }));
ok('the edge suspect mark (a very fast quick check) reaches the attempt', (await db.query(`select source from assessment_attempts where id = '${r.attempt_id}'`)).rows[0].source.suspect === true);
r = await apply(await input('free', { email: 'quick.same@example.test', answers: answersFor(FREE, () => 3) }));
ok('identical answers are marked suspect and saved', (await db.query(`select source, overall_score from assessment_attempts where id = '${r.attempt_id}'`)).rows[0].source.suspect === true);

// ---- bad input is refused and writes nothing ----
const good = await input('free', { email: 'attack@example.test' });
const clone = () => JSON.parse(J(good));
const mutate = (fn) => { const d = clone(); fn(d); return d; };
const bad = [
  ['null', null], ['an array', []], ['a string', 'x'],
  ['an unknown key', mutate((d) => { d.role = 'platform_owner'; })], ['a person id key', mutate((d) => { d.person_id = '00000000-0000-0000-0000-0000000000c1'; })],
  ['no email', mutate((d) => { delete d.email; })], ['email without a domain', mutate((d) => { d.email = 'nobody'; })], ['email with a comma', mutate((d) => { d.email = 'a,b@example.test'; })],
  ['email as a number', mutate((d) => { d.email = 5; })], ['an email over 200 characters', mutate((d) => { d.email = 'x'.repeat(200) + '@example.test'; })],
  ['an unknown tier', mutate((d) => { d.tier = 'premium'; })], ['a name over 200 characters', mutate((d) => { d.display_name = 'n'.repeat(201); })],
  ['no form version', mutate((d) => { delete d.form_version; })], ['a bad start time', mutate((d) => { d.started_at = 'tomorrow-ish'; })],
  ['a duration over 12 hours', mutate((d) => { d.duration_seconds = 50000; })], ['a negative duration', mutate((d) => { d.duration_seconds = -5; })], ['a fractional duration', mutate((d) => { d.duration_seconds = 1.5; })],
  ['an empty item order', mutate((d) => { d.item_order = []; })], ['a short item order', mutate((d) => { d.item_order = d.item_order.slice(1); })], ['an item order with a number', mutate((d) => { d.item_order[0] = 5; })],
  ['no consent', mutate((d) => { delete d.consent; })], ['an empty notice version', mutate((d) => { d.consent.notice_version = ' '; })], ['marketing as text', mutate((d) => { d.consent.marketing = 'yes'; })],
  ['a channel over 80 characters', mutate((d) => { d.source.channel = 'c'.repeat(81); })], ['suspect as text', mutate((d) => { d.suspect = 'no'; })],
  ['an address hash that is not hex', mutate((d) => { d.ip_hash = 'nothex'; })], ['a hint that is not a uuid', mutate((d) => { d.person_id_hint = 'abc'; })], ['an unknown full_access', mutate((d) => { d.full_access = 'free-for-all'; })],
  ['an idempotency hash that is not hex', mutate((d) => { d.idempotency_hash = 'abc'; })], ['a checksum that is not hex', mutate((d) => { d.result_checksum = 'z'.repeat(64); })],
  ['a score over 100', mutate((d) => { d.overall_score = 101; })], ['a negative score', mutate((d) => { d.overall_score = -1; })], ['a fractional score', mutate((d) => { d.overall_score = 50.5; })], ['a band that does not exist', mutate((d) => { d.band = 'Legendary'; })],
  ['no profile', mutate((d) => { delete d.profile_label; })], ['area scores as an array', mutate((d) => { d.area_scores = []; })],
  ['no version document', mutate((d) => { delete d.version; })], ['a version id that is not a uuid', mutate((d) => { d.version.id = 'nope'; })], ['questions as text', mutate((d) => { d.version.questions = 'x'; })],
  ['no parts', mutate((d) => { d.parts = []; })], ['too many parts', mutate((d) => { d.parts = Array.from({ length: 21 }, (_, i) => Object.assign({}, d.parts[0], { part_number: i + 1 })); })],
  ['a part number twice', mutate((d) => { d.parts.push(Object.assign({}, d.parts[0])); })], ['a part number out of range', mutate((d) => { d.parts[0].part_number = 2; })],
  ['an answer of 6', mutate((d) => { d.parts[0].answers[0].value = 6; })], ['an answer of 0', mutate((d) => { d.parts[0].answers[0].value = 0; })], ['an answer as text', mutate((d) => { d.parts[0].answers[0].value = '3'; })],
  ['an answer with no question id', mutate((d) => { delete d.parts[0].answers[0].questionId; })], ['a question that is not in the form', mutate((d) => { d.parts[0].answers[0].questionId = 'mini_zz'; })],
  ['a question answered twice', mutate((d) => { d.parts[0].answers[1] = d.parts[0].answers[0]; })], ['a missing answer', mutate((d) => { d.parts[0].answers.pop(); })],
  ['an extra answer', mutate((d) => { d.parts[0].answers.push({ questionId: 'mini_e1', value: 3 }); })], ['a part checksum that is not hex', mutate((d) => { d.parts[0].checksum = 'x'; })],
  ['full_access missing', mutate((d) => { delete d.full_access; })],
  ['no address hash', mutate((d) => { delete d.ip_hash; })], ['a null address hash', mutate((d) => { d.ip_hash = null; })], ['no unknown address flag', mutate((d) => { delete d.ip_unknown; })], ['the unknown flag as text', mutate((d) => { d.ip_unknown = 'yes'; })],
  ['an email with a double quote', mutate((d) => { d.email = 'a"b@example.test'; })], ['an email with a single quote', mutate((d) => { d.email = "o'brien@example.test"; })],
  ['an email with a backslash', mutate((d) => { d.email = 'a' + String.fromCharCode(92) + 'b@example.test'; })], ['an email with a control character', mutate((d) => { d.email = 'a' + String.fromCharCode(1) + 'b@example.test'; })],
  ['an email with a non ASCII letter', mutate((d) => { d.email = 'jos' + String.fromCharCode(233) + '@example.test'; })], ['an email with a backtick', mutate((d) => { d.email = 'a`b@example.test'; })],
  ['an email with a parenthesis', mutate((d) => { d.email = 'a(b)@example.test'; })], ['an email domain with no dot', mutate((d) => { d.email = 'a@localhost'; })]
];
s0 = await snapshot();
let allRefused = true, allSilent = true;
for (const [name, value] of bad) {
  const e = await applyError(value);
  const refused22023 = !!e && /invalid readiness input/.test(e.message);
  if (!refused22023) { allRefused = false; console.log('  not refused as invalid:', name, e && e.message); }
}
ok('every malformed document is refused as invalid input (' + bad.length + ' cases)', allRefused);
ok('and nothing at all was written, not even a limit count or a definition', s0 === await snapshot());
const sqlNull = await applyError(null);
ok('a database null is refused', !!sqlNull && /invalid readiness input/.test(sqlNull.message));
// The stored version, not the document, decides which answers are valid.
const tamper = await input('free', { email: 'tamper@example.test' });
tamper.version.questions = tamper.version.questions.map((q) => Object.assign({}, q, { id: 'x_' + q.id }));
tamper.parts[0].answers = tamper.parts[0].answers.map((a) => Object.assign({}, a, { questionId: 'x_' + a.questionId }));
s0 = await snapshot();
err = await applyError(tamper);
ok('a document that carries its own question list cannot override the stored published version', !!err && /invalid readiness input/.test(err.message));
ok('and that attempt (an exception) rolled back completely, the limit count included', s0 === await snapshot());
ok('the published version was not changed by any later document', (await db.query(`select count(*)::int n from assessment_versions where assessment_id = 'quick-check'`)).rows[0].n === 1 && J((await db.query(`select questions from assessment_versions where assessment_id = 'quick-check'`)).rows[0].questions) === J(JSON.parse(J(FREE.questions))));

// ---- privacy: the email and the name live only in the person rows ----
const needle = (await db.query(`select primary_email::text e, display_name from people where primary_email = 'grace.full@example.test'`)).rows[0];
let leaks = [];
for (const t of ['assessment_attempts', 'assessment_response_parts', 'consent_events', 'audit_events', 'outbox_events', 'service_requests', 'entitlements', 'readiness_limits', 'assessment_versions', 'assessment_scoring', 'assessment_definitions']) {
  const n = (await db.query(`select count(*)::int n from public.${t} x where x::text ilike '%grace.full%' or x::text ilike '%hopper%' or x::text ilike '%example.test%'`)).rows[0].n;
  if (n) leaks.push(`${t}:${n}`);
}
ok('no email, domain or name appears in any attempt, answer, consent, audit, outbox, request, entitlement, limit or assessment row', leaks.length === 0, leaks.join());
ok('the limit table holds only hashes and counts', (await count(`readiness_limits where key !~ '^[0-9a-f]{64}$' and key <> 'all'`)) === 0);

// ---- the rows equal what Firebase writes (the real service, then the real mirror module) ----
class ServerTimestampTransform { constructor() { this.methodName = 'FieldValue.serverTimestamp'; } }
class ArrayUnionTransform { constructor(values) { this.methodName = 'FieldValue.arrayUnion'; this.values = values; } }
const FieldValue = { serverTimestamp: () => new ServerTimestampTransform(), arrayUnion: (...values) => new ArrayUnionTransform(values) };
function createFakeDb(seed = {}) {
  const store = new Map(Object.entries(seed).map(([key, value]) => [key, JSON.parse(JSON.stringify(value))]));
  const writes = [];
  let counter = 0;
  const apply2 = (write) => {
    const current = store.get(write.path);
    if (write.op === 'update') store.set(write.path, Object.assign({}, current, write.data));
    else if (write.op === 'set' && write.merge) store.set(write.path, Object.assign({}, current || {}, write.data));
    else store.set(write.path, write.data);
    writes.push(write);
  };
  function docRef(refPath) {
    return { path: refPath, id: refPath.split('/').pop(), collection: (name) => collectionRef(`${refPath}/${name}`),
      async get() { return { exists: store.has(refPath), id: refPath.split('/').pop(), data: () => store.get(refPath) }; },
      async set(data, options) { apply2({ path: refPath, data, op: 'set', merge: Boolean(options && options.merge) }); } };
  }
  function collectionRef(collectionPath) {
    return { doc: (id) => docRef(`${collectionPath}/${id || `AUTOID${String(++counter).padStart(14, '0')}`}`),
      async add(data) { const ref = this.doc(); apply2({ path: ref.path, data, op: 'create' }); return ref; } };
  }
  return { store, writes, collection: (name) => collectionRef(name),
    async runTransaction(fn) {
      const pending = [];
      const transaction = {
        async get(ref) { return { exists: store.has(ref.path), id: ref.id, data: () => store.get(ref.path) }; },
        create(ref, data) { pending.push({ path: ref.path, data, op: 'create' }); return transaction; },
        set(ref, data, options) { pending.push({ path: ref.path, data, op: 'set', merge: Boolean(options && options.merge) }); return transaction; },
        update(ref, data) { pending.push({ path: ref.path, data, op: 'update' }); return transaction; }
      };
      const result = await fn(transaction);
      pending.forEach(apply2);
      return result;
    } };
}
const norm = (v) => JSON.parse(JSON.stringify(v));
for (const tier of ['free', 'full']) {
  const version = FORMS[tier];
  const email = `parity.${tier}@example.test`;
  const parityDoc = await input(tier, { email, name: 'Parity Person', consent: { assessmentProcessing: true, marketing: true, noticeVersion: 'notice@1' }, source: { channel: 'web', campaignId: 'camp-1', referrerCode: 'ref_1' } });
  const answerMap = Object.fromEntries(parityDoc.parts.flatMap((p) => p.answers).map((a) => [a.questionId, a.value]));
  // Firebase side
  const fdb = createFakeDb({
    'customers/cust-1': { primaryEmail: email, accountStatus: 'active' },
    'entitlements/ent-1': { customerId: 'cust-1', programId: 'executive-signature', assessmentId: version.assessmentId, status: 'active', attemptsCompleted: 0, retakesAllowed: 0 }
  });
  const service = createAssessmentPersistenceService({ db: fdb, FieldValue });
  await service.persistCompletedAssessment({
    customerId: 'cust-1', entitlementId: 'ent-1', idempotencyKey: 'k-' + tier, assessmentId: version.assessmentId, formVersion: version.formVersion,
    answers: answerMap, itemOrder: parityDoc.item_order, startedAt: parityDoc.started_at, durationSeconds: parityDoc.duration_seconds,
    consent: { assessmentProcessing: true, marketing: true, noticeVersion: 'notice@1' }, source: { channel: 'web', campaignId: 'camp-1', referrerCode: 'ref_1' },
    actor: { actorType: 'participant', actorId: 'uid-1', actorRole: 'participant' }
  });
  const personUuid = mirror.uuidFor(`person:${email}`);
  const expected = mirror.rowsForWrites(fdb.writes.map(({ path, data }) => ({ path, data })), { now: '2030-01-01T00:00:00.000Z', personIds: { 'cust-1': personUuid } });
  // Supabase side
  parityDoc.consent.notice_version = 'notice@1';
  const res = await apply(parityDoc);
  ok(`${tier}: the parity submission completed`, res.status === 'completed');
  const mine = {
    attempt: (await db.query(`select * from assessment_attempts where id = '${res.attempt_id}'`)).rows[0],
    parts: (await db.query(`select * from assessment_response_parts where attempt_id = '${res.attempt_id}' order by part_number`)).rows,
    consents: (await db.query(`select * from consent_events where person_id = '${personUuid}' order by type`)).rows,
    outbox: (await db.query(`select * from outbox_events where correlation_id = '${parityDoc.idempotency_hash}' order by event_type`)).rows,
    version: (await db.query(`select * from assessment_versions where assessment_id = '${version.assessmentId}'`)).rows[0],
    scoring: (await db.query(`select s.scoring from assessment_scoring s join assessment_versions v on v.id = s.version_id where v.assessment_id = '${version.assessmentId}'`)).rows[0],
    definition: (await db.query(`select * from assessment_definitions where id = '${version.assessmentId}'`)).rows[0],
    ent: (await db.query(`select * from entitlements where person_id = '${personUuid}'`)).rows[0],
    request: (await db.query(`select * from service_requests where id = '${parityDoc.idempotency_hash}'`)).rows[0],
    audit: (await db.query(`select * from audit_events where subject_id = '${res.attempt_id}'`)).rows[0]
  };
  const fa = expected.assessment_attempts[0];
  const pick = (row, keys) => Object.fromEntries(keys.map((k) => [k, row[k]]));
  const sourceOf = (s) => { const c = norm(s); delete c.createdBy; delete c.suspect; return c; };
  ok(`${tier}: the attempt row equals the Firebase mirror row (program, assessment, status, duration, score, areas, profile, band, checksums, campaign, version link, consent count)`,
    C(norm({ ...pick(fa, ['program_id', 'assessment_id', 'status', 'duration_seconds', 'profile_label', 'band', 'response_checksum', 'result_checksum', 'campaign_id', 'started_at']), overall_score: fa.overall_score, area_scores: fa.area_scores, version_id: fa.version_id, consents: fa.consent_event_ids.length, sponsor: fa.sponsor_organization_id }))
    === C(norm({ ...pick(mine.attempt, ['program_id', 'assessment_id', 'status', 'duration_seconds', 'profile_label', 'band', 'response_checksum', 'result_checksum', 'campaign_id']), started_at: new Date(mine.attempt.started_at).toISOString(), overall_score: Number(mine.attempt.overall_score), area_scores: mine.attempt.area_scores, version_id: mine.attempt.version_id, consents: mine.attempt.consent_event_ids.length, sponsor: mine.attempt.sponsor_organization_id })),
    J(norm(fa)) + ' / ' + J(norm(mine.attempt)));
  ok(`${tier}: the attempt source equals the Firebase one (channel, campaign, referrer, form version)`, C(sourceOf(fa.source)) === C(sourceOf(mine.attempt.source)), J(fa.source) + ' / ' + J(mine.attempt.source));
  const fparts = expected.assessment_response_parts;
  ok(`${tier}: the answer parts equal the Firebase ones (count, numbers, answers, scoring inputs, checksum)`, fparts.length === mine.parts.length
    && fparts.every((p, i) => C(norm({ n: p.part_number, c: p.part_count, a: p.answers, s: p.scoring_inputs, p: p.payload, k: p.response_checksum })) === C(norm({ n: mine.parts[i].part_number, c: mine.parts[i].part_count, a: mine.parts[i].answers, s: mine.parts[i].scoring_inputs, p: mine.parts[i].payload, k: mine.parts[i].response_checksum }))));
  const fconsents = [...expected.consent_events].sort((a, b) => a.type.localeCompare(b.type));
  ok(`${tier}: the consent events equal the Firebase ones (type, notice, granted, source)`, C(fconsents.map((c) => pick(c, ['type', 'notice_version', 'granted', 'source']))) === C(mine.consents.map((c) => pick(c, ['type', 'notice_version', 'granted', 'source']))));
  const fout = [...expected.outbox_events].sort((a, b) => a.event_type.localeCompare(b.event_type));
  ok(`${tier}: the outbox events equal the Firebase ones (type, aggregate, status, attempts, payload keys)`, J(fout.map((o) => ({ ...pick(o, ['event_type', 'aggregate_type', 'status', 'attempt_count']), keys: Object.keys(o.payload).sort(), assessment: o.payload.assessmentId })))
    === J(mine.outbox.map((o) => ({ ...pick(o, ['event_type', 'aggregate_type', 'status', 'attempt_count']), keys: Object.keys(o.payload).sort(), assessment: o.payload.assessmentId }))));
  ok(`${tier}: the published version row equals the Firebase one (assessment, version, scoring, content, questions, status, id)`, (() => {
    const fv = expected.assessment_versions[0];
    return C(norm(pick(fv, ['id', 'assessment_id', 'version', 'scoring_version', 'content_version', 'questions', 'content']))) === C(norm(pick(mine.version, ['id', 'assessment_id', 'version', 'scoring_version', 'content_version', 'questions', 'content'])))
      && mine.version.status === 'published' && expected.assessment_versions_publish[0].status === 'published';
  })());
  ok(`${tier}: the scoring row equals the Firebase one`, C(expected.assessment_scoring[0].scoring) === C(mine.scoring.scoring));
  ok(`${tier}: the definition row equals the Firebase one (program, title, status, minutes, current version)`, (() => {
    const fd = expected.assessment_definitions[0];
    return J(pick(fd, ['program_id', 'title', 'status', 'estimated_minutes'])) === J(pick(mine.definition, ['program_id', 'title', 'status', 'estimated_minutes'])) && expected.assessment_definitions_current[0].current_version_id === mine.definition.current_version_id;
  })());
  const counters = fdb.store.get('entitlements/ent-1');
  ok(`${tier}: the entitlement counters and status equal Firebase (attempts, retakes used, report, consumed)`, mine.ent.attempts_completed === counters.attemptsCompleted && mine.ent.retakes_used === counters.retakesUsed && mine.ent.report_available === counters.reportAvailable
    && mine.ent.status === counters.status, J(pick(mine.ent, ['attempts_completed', 'retakes_used', 'report_available', 'status'])) + ' / ' + J(counters));
  const frequest = [...fdb.store.entries()].find(([k]) => k.startsWith('serviceRequests/'))[1];
  ok(`${tier}: the idempotency record has the same operation and the same answer fields`, mine.request.operation === frequest.operation && mine.request.status === frequest.status
    && J(Object.keys(mine.request.result).sort()) === J(Object.keys(frequest.result).sort()));
  const faudit = [...fdb.store.entries()].find(([k]) => k.startsWith('auditEvents/'))[1];
  ok(`${tier}: the audit row has the same action`, mine.audit.action === faudit.action && mine.audit.person_id === personUuid);
}

// ---- the rollback ----
const attemptsBefore = await count('assessment_attempts');
await db.exec(fs.readFileSync(new URL('./rollbacks/20261008002330_readiness_submit_down.sql', import.meta.url), 'utf8'));
ok('the rollback removes the functions and the limit table and keeps the data', (await count(`pg_proc where proname in ('apply_readiness_completion', 'readiness_take', 'readiness_need')`)) === 0
  && (await count(`pg_class where relname = 'readiness_limits'`)) === 0 && (await count('assessment_attempts')) === attemptsBefore);
await db.exec(fs.readFileSync(new URL('./migrations/20261008002330_readiness_submit.sql', import.meta.url), 'utf8'));
r = await apply(await input('free', { email: 'again@example.test' }));
ok('the migration applies again after the rollback and works', r.status === 'completed');

console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
