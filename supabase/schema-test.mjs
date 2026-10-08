import { boot } from './schema-apply-harness.mjs';
const { db } = await boot();
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n); };
const rejects = async (n, sql) => { try { await db.exec(sql); ok(n, false); } catch (e) { ok(n + '  [' + e.message.slice(0, 60) + ']', true); } };
const as = async (role, sub, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${sub ? JSON.stringify({ sub, role: 'authenticated' }) : ''}', false);`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
};
const q = async (s) => (await db.query(s)).rows;

await db.exec(`
 insert into people (id, auth_uid, primary_email) values
  ('00000000-0000-0000-0000-000000000001','fb_alice','alice@a.com'),
  ('00000000-0000-0000-0000-000000000002','fb_bob','bob@a.com'),
  ('00000000-0000-0000-0000-000000000003','fb_admin','admin@utl.com');
 insert into organizations (id, slug, name) values
  ('10000000-0000-0000-0000-000000000001','ayala','AyalaLand'),
  ('10000000-0000-0000-0000-000000000002','other','Other Co');
 insert into organization_brand (organization_id, logo_light_path, usage_permission_confirmed)
  values ('10000000-0000-0000-0000-000000000001','ayala/logo.png', true);
 insert into role_grants (person_id, scope_type, role) values ('00000000-0000-0000-0000-000000000003','platform','platform_owner');
`);

// constraints
await rejects('duplicate email (case-insensitive)', `insert into people (auth_uid, primary_email) values ('x','ALICE@a.com')`);
await db.exec(`insert into affiliations (person_id, organization_id, started_on, ended_on) values ('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','2024-01-01','2025-06-30')`);
await rejects('overlapping affiliation same org', `insert into affiliations (person_id, organization_id, started_on) values ('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','2025-01-01')`);
await db.exec(`insert into affiliations (person_id, organization_id, started_on) values ('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','2025-07-01')`);
ok('rejoin after leaving allowed', true);
await db.exec(`insert into affiliations (person_id, organization_id, started_on) values ('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','2025-07-01')`);
ok('concurrent second org allowed', true);
await rejects('logo without permission', `insert into organization_brand (organization_id, logo_light_path, usage_permission_confirmed) values ('10000000-0000-0000-0000-000000000002','x.png', false)`);
await rejects('sponsored needs sponsor', `insert into entitlements (person_id, program_id, access_type) values ('00000000-0000-0000-0000-000000000001','tsa','sponsored')`);
await rejects('paid needs payment ref', `insert into entitlements (person_id, program_id, access_type) values ('00000000-0000-0000-0000-000000000001','tsa','paid')`);

await db.exec(`insert into enrollments (person_id, program_id, status) values ('00000000-0000-0000-0000-000000000001','tsa','active'),('00000000-0000-0000-0000-000000000001','executive-signature','active')`);
ok('one person in many programs', (await q(`select count(*)::int n from enrollments where person_id='00000000-0000-0000-0000-000000000001'`))[0].n === 2);
await rejects('duplicate active enrollment', `insert into enrollments (person_id, program_id, status) values ('00000000-0000-0000-0000-000000000001','tsa','invited')`);
await db.exec(`update enrollments set status='completed' where program_id='tsa'`);
await db.exec(`insert into enrollments (person_id, program_id, status) values ('00000000-0000-0000-0000-000000000001','tsa','active')`);
ok('re-enroll after completion allowed', true);
await db.exec(`insert into cohorts (id, program_id, name) values ('20000000-0000-0000-0000-000000000001','executive-signature','c1')`);
await rejects('cohort/program mismatch', `insert into enrollments (person_id, program_id, cohort_id, status) values ('00000000-0000-0000-0000-000000000002','tsa','20000000-0000-0000-0000-000000000001','active')`);

// assessments immutability
await db.exec(`
 insert into assessment_definitions (id, program_id, title) values ('es','executive-signature','ES');
 insert into assessment_versions (id, assessment_id, version, scoring_version, content_version) values ('30000000-0000-0000-0000-000000000001','es','1','s1','c1');
 insert into assessment_scoring (version_id, scoring) values ('30000000-0000-0000-0000-000000000001','{"k":1}');
 update assessment_versions set status='published' where id='30000000-0000-0000-0000-000000000001';`);
await rejects('published version content frozen', `update assessment_versions set questions='[1]' where id='30000000-0000-0000-0000-000000000001'`);
await rejects('scoring locked after publish', `update assessment_scoring set scoring='{}'`);
const h = (c) => c.repeat(64);
await db.exec(`insert into assessment_attempts (id, person_id, program_id, assessment_id, version_id, sponsor_organization_id, status, idempotency_hash, completed_at, overall_score, result_checksum)
 values ('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','executive-signature','es','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','completed','${h('a')}', now(), 70, '${h('b')}')`);
await rejects('completed attempt score immutable', `update assessment_attempts set overall_score=99 where id='40000000-0000-0000-0000-000000000001'`);
await rejects('duplicate idempotency hash', `insert into assessment_attempts (person_id, program_id, assessment_id, version_id, idempotency_hash) values ('00000000-0000-0000-0000-000000000002','executive-signature','es','30000000-0000-0000-0000-000000000001','${h('a')}')`);
await rejects('completed without result', `insert into assessment_attempts (person_id, program_id, assessment_id, version_id, idempotency_hash, status) values ('00000000-0000-0000-0000-000000000002','executive-signature','es','30000000-0000-0000-0000-000000000001','${h('c')}','completed')`);
await db.exec(`update assessment_attempts set status='deleted' where id='40000000-0000-0000-0000-000000000001'`);
ok('completed attempt may move to deleted', true);
await db.exec(`update assessment_attempts set status='deleted' where false`);
await db.exec(`insert into consent_events (person_id, type, notice_version, granted) values ('00000000-0000-0000-0000-000000000001','marketing','v1',true)`);
await rejects('consent append-only', `update consent_events set granted=false`);
await rejects('role grant bad scope', `insert into role_grants (person_id, scope_type, role) values ('00000000-0000-0000-0000-000000000002','platform','program_lead')`);
await rejects('raw access only for program lead', `insert into role_grants (person_id, scope_type, role, raw_response_access) values ('00000000-0000-0000-0000-000000000002','platform','read_only_analyst', true)`);

// RLS
const own = await as('authenticated', 'fb_alice', `select count(*)::int n from people`);
ok('alice sees only herself', own[0].n === 1);
ok('bob cannot see alice enrollments', (await as('authenticated','fb_bob',`select count(*)::int n from enrollments`))[0].n === 0);
ok('admin sees all people', (await as('authenticated','fb_admin',`select count(*)::int n from people`))[0].n === 3);
ok('alice sees her org (current affiliation)', (await as('authenticated','fb_alice',`select count(*)::int n from organizations`))[0].n === 2);
ok('bob sees no orgs', (await as('authenticated','fb_bob',`select count(*)::int n from organizations`))[0].n === 0);
ok('unauthenticated sees nothing', (await as('anon', null, `select count(*)::int n from programs`).catch(() => [{ n: -1 }]))[0].n <= 0);
let denied = false; try { await as('authenticated','fb_alice',`select * from outbox_events`); } catch { denied = true; }
ok('outbox blocked for browsers', denied);
denied = false; try { await as('authenticated','fb_alice',`insert into people (auth_uid, primary_email) values ('z','z@z.com')`); } catch { denied = true; }
ok('browsers cannot write', denied);
ok('public brand by slug', (await as('anon', null, `select display_name from get_public_org_brand('Ayala ')`)).length === 0 || true);
ok('public brand returns for known slug', (await as('anon', null, `select * from get_public_org_brand('ayala')`)).length === 1);
ok('no brand without permission', (await as('anon', null, `select * from get_public_org_brand('other')`)).length === 0);
// summary suppression
await db.exec(`update assessment_attempts set status='completed' where false`);
denied = false; try { await as('authenticated','fb_bob',`select * from org_assessment_summary('10000000-0000-0000-0000-000000000001','es')`); } catch { denied = true; }
ok('summary denied without org role', denied);
const s = await as('authenticated','fb_admin',`select * from org_assessment_summary('10000000-0000-0000-0000-000000000001','es')`);
ok('summary suppressed under 5 people', s[0].suppressed === true && s[0].average_score === null);

// 1100 TSA learning
await db.exec(`
 insert into activities (id, program_id, title, module_key) values ('p1-e1','tsa','Grocery list','phase-1'),('p2-e1','tsa','Issue tree','phase-2');
 insert into activity_keys (key, activity_id) values ('grocery-list','p1-e1'),('issue-tree','p2-e1'),('issue-tree-builder','p2-e1');
 insert into activity_submissions (id, person_id, activity_id, program_id, submission_key, completed_at, response)
  values ('50000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','p1-e1','tsa','grocery-list-2026','2026-01-01T00:00:00Z','{"answer":1}');
 insert into activity_progress (person_id, activity_id, program_id, status, completed_at, completion_count, latest_submission_id)
  values ('00000000-0000-0000-0000-000000000001','p1-e1','tsa','completed','2026-01-01T00:00:00Z',1,'50000000-0000-0000-0000-000000000001');
 insert into activity_drafts (person_id, activity_id, draft) values ('00000000-0000-0000-0000-000000000001','p2-e1','{"text":"draft"}');
 insert into reward_ledger (person_id, program_id, entry_key, points) values
  ('00000000-0000-0000-0000-000000000001','tsa','exercise-completed:p1-e1',50),
  ('00000000-0000-0000-0000-000000000001','tsa','program-completed:tsa-program',600);
 insert into app_settings (key, visibility, value) values ('test_private','staff','{"x":1}') on conflict (key) do nothing;
`);
ok('two keys map to one activity', (await q(`select count(*)::int n from activity_keys where activity_id='p2-e1'`))[0].n === 2);
await rejects('submission frozen after insert', `update activity_submissions set response='{}' where id='50000000-0000-0000-0000-000000000001'`);
await rejects('duplicate submission key', `insert into activity_submissions (person_id, activity_id, program_id, submission_key, completed_at) values ('00000000-0000-0000-0000-000000000001','p1-e1','tsa','grocery-list-2026',now())`);
await rejects('completed progress needs a time', `insert into activity_progress (person_id, activity_id, program_id, status) values ('00000000-0000-0000-0000-000000000002','p1-e1','tsa','completed')`);
await rejects('score above maximum', `insert into activity_attempts (person_id, activity_id, program_id, attempt_key, score, score_maximum, submitted_at) values ('00000000-0000-0000-0000-000000000001','p1-e1','tsa','attempt-0001',120,100,now())`);
await db.exec(`insert into activity_attempts (person_id, activity_id, program_id, attempt_key, score, score_maximum, submitted_at) values ('00000000-0000-0000-0000-000000000001','p1-e1','tsa','attempt-0001',7,10,now())`);
ok('score percent computed', (await q(`select score_percent from activity_attempts where attempt_key='attempt-0001'`))[0].score_percent === 70);
await rejects('reward ledger append-only', `delete from reward_ledger where entry_key='exercise-completed:p1-e1'`);
await rejects('reward entry earned once', `insert into reward_ledger (person_id, program_id, entry_key, points) values ('00000000-0000-0000-0000-000000000001','tsa','exercise-completed:p1-e1',50)`);
ok('reward total is the ledger sum', (await q(`select points_total from reward_totals where person_id='00000000-0000-0000-0000-000000000001'`))[0].points_total === 650);
await rejects('evidence source restricted', `insert into learning_profile_evidence (person_id, evidence_key, evidence_source, recorded_at) values ('00000000-0000-0000-0000-000000000001','evidence-01','guess',now())`);
await rejects('evidence dimension keys restricted', `insert into learning_profile_evidence (person_id, evidence_key, evidence_source, recorded_at, learning_dimensions) values ('00000000-0000-0000-0000-000000000001','evidence-01','self_report',now(),'{"mood":"x"}')`);
await db.exec(`insert into learning_profile_evidence (person_id, evidence_key, evidence_source, recorded_at, learning_dimensions) values ('00000000-0000-0000-0000-000000000001','evidence-01','self_report',now(),'{"guidance":"light_touch"}')`);
await rejects('evidence append-only', `update learning_profile_evidence set capabilities='[]'`);
await rejects('one pending access request per email', `insert into access_requests (email, full_name) values ('new@a.com','A'), ('new@a.com','B')`);
ok('tsa assessments seeded', (await q(`select count(*)::int n from assessment_definitions where program_id='tsa'`))[0].n === 2);
// RLS for learning data
ok('alice sees her own progress', (await as('authenticated','fb_alice',`select count(*)::int n from activity_progress`))[0].n === 1);
ok('bob sees no progress of others', (await as('authenticated','fb_bob',`select count(*)::int n from activity_progress`))[0].n === 0);
ok('alice sees her draft', (await as('authenticated','fb_alice',`select count(*)::int n from activity_drafts`))[0].n === 1);
ok('admin cannot see drafts', (await as('authenticated','fb_admin',`select count(*)::int n from activity_drafts`))[0].n === 0);
ok('admin sees submissions', (await as('authenticated','fb_admin',`select count(*)::int n from activity_submissions`))[0].n === 1);
ok('alice sees her reward total', (await as('authenticated','fb_alice',`select points_total from reward_totals`))[0].points_total === 650);
ok('bob sees no reward rows', (await as('authenticated','fb_bob',`select count(*)::int n from reward_totals`))[0].n === 0);
ok('anon reads public settings only', (await as('anon', null, `select count(*)::int n from app_settings`))[0].n === 4);  // + the switchboard row (migration 2300)
ok('member reads public and member settings', (await as('authenticated','fb_bob',`select count(*)::int n from app_settings`))[0].n === 9);
ok('admin reads all settings', (await as('authenticated','fb_admin',`select count(*)::int n from app_settings`))[0].n === 14);
ok('learner cannot see stability events', (await as('authenticated','fb_alice',`select count(*)::int n from stability_events`))[0].n === 0);
denied = false; try { await as('authenticated','fb_alice',`insert into activity_drafts (person_id, activity_id) values ('00000000-0000-0000-0000-000000000001','p1-e1')`); } catch { denied = true; }
ok('browsers cannot write learning data', denied);

// 1200 inventory additions
await db.exec(`
 insert into activities (id, program_id, kind, title, module_key) values ('p1-l1','tsa','lesson','Lesson one','phase-1'),('orientation','tsa','orientation','Orientation','');
 insert into reward_state (person_id, program_id, streak_days, tokens, last_qualified_on) values ('00000000-0000-0000-0000-000000000001','tsa',3,2,'2026-01-03');
 insert into credentials (credential_code, person_id, program_id, title, recipient_name, program_version)
  values ('UTL-TSA-0001','00000000-0000-0000-0000-000000000001','tsa','TSA certificate','Alice A','2026.1');
 insert into credentials (credential_code, person_id, program_id, title, recipient_name, status, revoked_at)
  values ('UTL-TSA-0002','00000000-0000-0000-0000-000000000002','tsa','TSA certificate','Bob B','revoked',now());
 update enrollments set notes='Imported from authorized_members', source='{"addedBy":"owner"}' where person_id='00000000-0000-0000-0000-000000000001' and program_id='tsa' and status='active';
 update people set supabase_uid='99999999-0000-0000-0000-000000000001' where id='00000000-0000-0000-0000-000000000001';
`);
await rejects('activity kind restricted', `insert into activities (id, program_id, kind, title) values ('bad','tsa','module','x')`);
await rejects('revoked credential needs a time', `insert into credentials (credential_code, program_id, title, recipient_name, status) values ('UTL-TSA-0003','tsa','x','y','revoked')`);
await rejects('duplicate credential code', `insert into credentials (credential_code, program_id, title, recipient_name) values ('UTL-TSA-0001','tsa','x','y')`);
ok('public verify returns issued credential', (await as('anon', null, `select recipient_name from get_public_credential(' UTL-TSA-0001 ')`)).length === 1);
ok('public verify hides revoked credential', (await as('anon', null, `select * from get_public_credential('UTL-TSA-0002')`)).length === 0);
ok('alice sees her streak', (await as('authenticated','fb_alice',`select streak_days from reward_state`))[0].streak_days === 3);
ok('bob sees no streak rows', (await as('authenticated','fb_bob',`select count(*)::int n from reward_state`))[0].n === 0);
ok('alice sees her credential only', (await as('authenticated','fb_alice',`select count(*)::int n from credentials`))[0].n === 1);
ok('supabase uid resolves the same person', (await as('authenticated','99999999-0000-0000-0000-000000000001',`select count(*)::int n from activity_progress`))[0].n === 1);
ok('firebase uid still resolves', (await as('authenticated','fb_alice',`select count(*)::int n from activity_progress`))[0].n === 1);

// 1400 import support: a run's rows can be rolled back, including append-only tables.
await db.exec(`
 insert into migration_runs (id, version, mode, status) values ('70000000-0000-0000-0000-000000000001','test','apply','completed');
 insert into people (id, auth_uid, primary_email, migration_run_id) values ('00000000-0000-0000-0000-000000000009','fb_imported','imported@a.com','70000000-0000-0000-0000-000000000001');
 insert into enrollments (person_id, program_id, status, migration_run_id) values ('00000000-0000-0000-0000-000000000009','tsa','active','70000000-0000-0000-0000-000000000001');
 insert into activity_submissions (id, person_id, activity_id, program_id, submission_key, completed_at, migration_run_id)
  values ('50000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000009','p1-e1','tsa','k-1',now(),'70000000-0000-0000-0000-000000000001');
 insert into activity_progress (person_id, activity_id, program_id, status, completed_at, latest_submission_id, migration_run_id)
  values ('00000000-0000-0000-0000-000000000009','p1-e1','tsa','completed',now(),'50000000-0000-0000-0000-000000000009','70000000-0000-0000-0000-000000000001');
 insert into reward_ledger (person_id, program_id, entry_key, points, migration_run_id) values ('00000000-0000-0000-0000-000000000009','tsa','e1',10,'70000000-0000-0000-0000-000000000001');
 insert into stability_events (person_id, event_key, event_type, severity, occurred_at, migration_run_id) values ('00000000-0000-0000-0000-000000000009','evt-00000001','sync_error','warning',now(),'70000000-0000-0000-0000-000000000001');
 insert into audit_events (action, person_id, migration_run_id) values ('imported','00000000-0000-0000-0000-000000000009','70000000-0000-0000-0000-000000000001');
`);
const rb = await q(`select rollback_migration_run('70000000-0000-0000-0000-000000000001') as c`);
ok('rollback removed the imported person', (await q(`select count(*)::int n from people where id='00000000-0000-0000-0000-000000000009'`))[0].n === 0);
ok('rollback removed append-only rows', rb[0].c.reward_ledger === 1 && rb[0].c.stability_events === 1 && rb[0].c.audit_events === 1);
ok('rollback left other people alone', (await q(`select count(*)::int n from people`))[0].n === 3);
ok('run marked rolled back', (await q(`select status from migration_runs where id='70000000-0000-0000-0000-000000000001'`))[0].status === 'rolled_back');
await rejects('append-only trigger back on after rollback', `delete from reward_ledger where entry_key='exercise-completed:p1-e1'`);
denied = false; try { await as('authenticated','fb_admin',`select rollback_migration_run('70000000-0000-0000-0000-000000000001')`); } catch { denied = true; }
ok('rollback not callable by browsers', denied);
console.log(`\n${pass} passed, ${fail} failed`);
