const assert = require('assert');
const path = require('path');
const { buildPlan, uuidFor, normalizeEmail, iso, WRITE_ORDER, WRITE_MODE } = require('../scripts/supabase-import-mapping');

const catalog = require(path.resolve(__dirname, '..', 'supabase', 'seed', 'activities.json'));
const T = (s) => new Date(s);
const ts = (s) => ({ toDate: () => new Date(s) }); // Firestore Timestamp shape

const { snapshot } = require('./fixtures/import-snapshot');

const plan = buildPlan(snapshot, catalog, { importDate: '2026-10-06T00:00:00.000Z', runId: uuidFor('run:test') });
const t = plan.tables;
const by = (table, pred) => t[table].filter(pred);
const alice = uuidFor('person:alice@example.com');

// Deterministic ids and normalized email.
assert.equal(uuidFor('person:alice@example.com'), uuidFor('person:alice@example.com'));
assert.equal(normalizeEmail(' Carol@Example.com '), 'carol@example.com');
assert.equal(iso(ts('2025-01-01T00:00:00Z')), '2025-01-01T00:00:00.000Z');

// People: one row per email across members, users and customers. Orphan user included.
assert.equal(t.people.length, 5);
const aliceRow = t.people.find((p) => p.id === alice);
assert.equal(aliceRow.auth_uid, 'uid-alice');
assert.equal(aliceRow.first_name, 'Alice');
assert.equal(aliceRow.legacy_firestore_id, 'customers/cust-alice');
assert.ok(t.people.find((p) => p.primary_email === 'orphan@example.com'));
assert.equal(t.person_emails.length, 5);

// Profiles merge both sources.
const aliceProfile = t.person_profiles.find((p) => p.person_id === alice);
assert.equal(aliceProfile.photo_url, 'https://img/alice.png');
assert.equal(aliceProfile.goals, 'Lead better');
assert.equal(aliceProfile.google_group_added, true);

// Owner role becomes platform_owner.
assert.equal(t.role_grants.length, 1);
assert.equal(t.role_grants[0].role, 'platform_owner');

// Cohorts from settings/cohorts, organization resolved. Unknown member cohort value becomes a cohort.
assert.equal(t.cohorts.length, 3);
assert.equal(t.cohorts[0].organization_id, uuidFor('organization:ayalaland'));
const batch7 = t.cohorts.find((c) => c.name === 'Batch 7');
assert.ok(batch7 && batch7.organization_id === null);
assert.ok(plan.warnings.some((w) => w.includes('cohort "Batch 7" is not in settings/cohorts')));
const daveEnr = t.enrollments.find((e) => e.person_id === uuidFor('person:dave@example.com'));
assert.equal(daveEnr.cohort_id, batch7.id);

// Enrollments: Firestore enrollment merged with member fields; Carol created from member only.
const aliceEnr = t.enrollments.find((e) => e.person_id === alice);
assert.equal(aliceEnr.legacy_firestore_id, 'enrollments/enr-alice');
assert.equal(aliceEnr.notes, 'Pilot');
assert.equal(aliceEnr.source.addedBy, 'owner@example.com');
assert.equal(aliceEnr.sponsor_organization_id, uuidFor('organization:ayalaland'));
// AyalaLand decision: active and valid one year from import.
assert.equal(aliceEnr.status, 'active');
assert.equal(aliceEnr.valid_until, '2027-10-06T00:00:00.000Z');
const carolEnr = t.enrollments.find((e) => e.person_id === uuidFor('person:carol@example.com'));
assert.equal(carolEnr.status, 'expired');
assert.equal(carolEnr.legacy_firestore_id, 'authorized_members/carol@example.com');
assert.equal(t.enrollments.length, 4);

// Assessments: ES version inserted as draft then published; scoring row; current version update.
assert.equal(t.assessment_versions.filter((v) => v.assessment_id === 'es')[0].status, 'draft');
assert.equal(t.assessment_versions_publish.length, 2);
assert.equal(t.assessment_scoring.length, 1);
assert.equal(t.assessment_definitions_current[0].current_version_id, uuidFor('version:es-v1'));
// ES attempt: non-hex idempotency replaced, consent linked, entitlement linked.
const esAttempt = t.assessment_attempts.find((a) => a.assessment_id === 'es');
assert.match(esAttempt.idempotency_hash, /^[0-9a-f]{64}$/);
assert.equal(esAttempt.consent_event_ids[0], uuidFor('consent:consent-1'));
assert.equal(esAttempt.entitlement_id, uuidFor('entitlement:ent-1'));
// TSA attempt: version synthesized, completed with checksums, part row.
const tsaAttempt = t.assessment_attempts.find((a) => a.assessment_id === 'tsa-diagnostic');
assert.equal(tsaAttempt.status, 'completed');
assert.equal(tsaAttempt.overall_score, 64);
assert.equal(tsaAttempt.enrollment_id, aliceEnr.id);
assert.equal(t.assessment_response_parts.length, 2);
// Owner's products.readinessAssessment becomes an entitlement.
assert.equal(t.entitlements.length, 2);

// Catalog seeded.
assert.equal(t.activities.length, catalog.activities.length);
assert.equal(t.activity_keys.length, catalog.keys.length);

// Submissions: the legacy completion that matches a submission time is not duplicated; issue-tree legacy kept;
// the TSA section score maps through its underscore key.
assert.equal(t.activity_submissions.length, 3);
assert.ok(t.activity_submissions.find((s) => s.activity_id === 'tsa-sort-score'));
const grocery = t.activity_submissions.filter((s) => s.activity_id === 'p1-e1');
assert.equal(grocery.length, 1);
assert.equal(grocery[0].legacy_firestore_id, 'users/uid-alice/exercise_submissions/grocery-list-20250301');
const issueTree = t.activity_submissions.find((s) => s.activity_id === 'p2-e1');
assert.equal(issueTree.submission_key, 'legacy-issue-tree');
// Unknown exercise key is an exception, not a row.
assert.ok(plan.exceptions.some((e) => e.source === 'users/uid-alice/completed_exercises/not-an-exercise'));

// Progress: two keys for one exercise collapse to one row; lesson, context, orientation rows exist.
const progress = (id) => t.activity_progress.find((p) => p.person_id === alice && p.activity_id === id);
assert.equal(t.activity_progress.filter((p) => p.activity_id === 'p1-e1').length, 1);
assert.equal(progress('p1-e1').status, 'completed');
assert.equal(progress('p1-e1').completion_count, 1);
assert.equal(progress('p1-e1').latest_submission_id, grocery[0].id);
assert.equal(progress('p2-e1').status, 'completed'); // legacy completion wins over visited-only progress
assert.equal(progress('p1-l1').status, 'completed');
assert.equal(progress('p1-l2'), undefined); // watched false, never written
assert.equal(progress('p1-e1-context').status, 'completed'); // context stored under exercise id
assert.equal(progress('orientation-start').status, 'completed');
assert.equal(progress('p2-recap').status, 'completed'); // retired context kept
assert.equal(catalog.activities.find((a) => a.id === 'p2-recap').status, 'retired');
assert.equal(catalog.keys.find((k) => k.key === 'utl_result_tsa_diagnostic').activity_id, 'tsa-diagnostic');
assert.equal(progress('orientation').status, 'completed');
assert.equal(progress('tsa-diagnostic').status, 'completed'); // tsa-diagnostic-v2 key
assert.ok(t.activity_progress.every((p) => p.status !== 'completed' || p.completed_at));

// Attempts and drafts.
assert.equal(t.activity_attempts[0].score, 8);
assert.equal(t.activity_attempts[0].activity_id, 'p1-e1');
assert.deepStrictEqual(t.activity_drafts[0].draft, {});
assert.equal(t.activity_drafts[0].activity_id, 'p2-e2');

// Rewards: duplicate ledger id dropped, mismatch warned, state row built.
assert.equal(t.reward_ledger.filter((r) => r.person_id === alice).length, 2);
assert.ok(plan.warnings.some((w) => w.includes('stored mpTotal 70 differs from ledger sum 60')));
const state = t.reward_state.find((r) => r.person_id === alice);
assert.equal(state.streak_days, 2);
assert.equal(state.tokens, 1);
assert.equal(state.last_qualified_on, '2025-03-01');

// Engagement and stability.
assert.equal(t.engagement_sessions.length, 2);
const activitySession = t.engagement_sessions.find((s) => s.kind === 'activity');
assert.equal(activitySession.parent_session_key, 'sess-00000001');
assert.equal(activitySession.activity_id, 'p1-e1');
assert.equal(t.stability_events.length, 1);
assert.ok(plan.exceptions.some((e) => e.source.endsWith('stability_events/evt-00000002')));

// Credentials joined with issuance; the code is the document id, not the TSA program code.
assert.equal(t.credentials.length, 2);
assert.ok(t.credentials.every((c) => c.program_id === 'tsa')); // long program name maps to tsa
const cred1 = t.credentials.find((c) => c.credential_code === 'UTL-TSA-000001');
assert.ok(cred1);
assert.equal(cred1.person_id, alice);
assert.deepStrictEqual(cred1.required_activity_ids, ['p1-e1', 'p2-e1']);
assert.equal(cred1.status, 'issued');

// Settings: known docs mapped, unknown doc is an exception, flags collected.
assert.ok(t.app_settings.find((s) => s.key === 'public_site' && s.visibility === 'public'));
assert.ok(t.app_settings.find((s) => s.key === 'email_templates'));
assert.ok(t.app_settings.find((s) => s.key === 'feature_flags').value.customersConsole.enabled);
assert.ok(plan.exceptions.some((e) => e.source === 'settings/unknownDoc'));
assert.ok(t.app_settings.find((s) => s.key === 'assessment_versions' && s.visibility === 'staff'));

// Audit rows carry provenance.
assert.equal(t.audit_events.length, 3);
assert.ok(t.audit_events.every((a) => a.detail.legacy_firestore_id && a.detail.source === 'firestore'));

// Every table in the plan is in the write order with a write mode, and rows share one column set.
Object.keys(t).forEach((table) => {
  assert.ok(WRITE_ORDER.includes(table), `${table} missing from WRITE_ORDER`);
  assert.ok(WRITE_MODE[table], `${table} missing from WRITE_MODE`);
  const keys = Object.keys(t[table][0]).sort().join(',');
  t[table].forEach((row) => assert.equal(Object.keys(row).sort().join(','), keys, `${table} rows differ in columns`));
});

// Migration run id stamped on tables that have the column.
assert.equal(t.people[0].migration_run_id, uuidFor('run:test'));
assert.equal(t.activity_submissions[0].migration_run_id, uuidFor('run:test'));

console.log('supabase-import-mapping tests passed');

// Writer: a failing batch falls back to one row at a time, so one bad row is isolated.
(async () => {
  const { writeTable, recordId } = require('../scripts/supabase-import');
  const calls = [];
  const fake = {
    async upsert(table, rows) { calls.push(rows.length); if (rows.some((r) => r.bad)) throw new Error('bad row'); },
    async insert() {}, async update() {}
  };
  const results = [];
  await writeTable(fake, 'people', [{ id: 1 }, { id: 2, bad: true }, { id: 3 }], { conflict: 'id' }, results);
  assert.deepStrictEqual(results.map((r) => r.status), ['applied', 'exception', 'applied']);
  assert.deepStrictEqual(calls, [3, 1, 1, 1]);
  assert.equal(recordId('people', { legacy_firestore_id: 'customers/x', id: 'u' }), 'customers/x');
  assert.equal(recordId('activity_progress', { person_id: 'p', activity_id: 'a' }), 'activity_progress:p:a');
  console.log('supabase-import writer tests passed');
})();
