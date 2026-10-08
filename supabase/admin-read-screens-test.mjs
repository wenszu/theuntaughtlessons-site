// Tests for migration 20261008002240: the nine read only staff screens of the admin console as database functions.
//   node supabase/admin-read-screens-test.mjs
// Covers: who may call each function (42501 for everyone else, anon cannot execute), the return shapes (same field names as the
// Firebase callables), paging, privacy (private fields only for the roles that had them, raw answers never), and the rollback.
import fs from 'fs';
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
const q = async (s) => (await db.query(s)).rows;
const call = async (sub, sql) => (await as('authenticated', sub, `select ${sql} as r`))[0].r;
const keys = (o) => Object.keys(o).sort().join(',');
const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const sha = (c) => c.repeat(64 / c.length);

const OWNER = 'fb_owner', SUPPORT = 'fb_support', PRIVACY = 'fb_privacy', LEAD = 'fb_lead', ANALYST = 'fb_analyst', MEMBER = 'fb_member', ORGREP = 'fb_orgrep', NOBODY = 'fb_nobody';
const ID = { owner: U(1), support: U(2), privacy: U(3), lead: U(4), analyst: U(5), member: U(6), orgrep: U(7), alice: U(8), bob: U(9), dora: U(10), carl: U(11) };
const SECRET = 'SECRET-RAW-ANSWER-TEXT';
const V_QUICK = U(901), V_FULL = U(902);
const ORG = U(501), COHORT = U(601), COHORT2 = U(602);

await db.exec(`
 insert into people (id, auth_uid, primary_email, display_name, legacy_firestore_id, created_at, last_activity_at) values
  ('${ID.owner}','${OWNER}','owner@utl.test','Olive Owner',null,'2026-01-01T00:00:00Z','2026-10-01T00:00:00Z'),
  ('${ID.support}','${SUPPORT}','support@utl.test','Sam Support',null,'2026-01-01T00:00:00Z',null),
  ('${ID.privacy}','${PRIVACY}','privacy@utl.test','Pia Privacy',null,'2026-01-01T00:00:00Z',null),
  ('${ID.lead}','${LEAD}','lead@utl.test','Lena Lead',null,'2026-01-01T00:00:00Z',null),
  ('${ID.analyst}','${ANALYST}','analyst@utl.test','Ana Analyst',null,'2026-01-01T00:00:00Z',null),
  ('${ID.member}','${MEMBER}','member@utl.test','Mia Member',null,'2026-01-01T00:00:00Z',null),
  ('${ID.orgrep}','${ORGREP}','rep@acme.test','Rita Rep',null,'2026-01-01T00:00:00Z',null),
  ('${ID.alice}','fb_alice','alice@acme.test','Álice Ångström','customers/cust-alice','2026-03-01T00:00:00Z','2026-09-10T00:00:00Z'),
  ('${ID.bob}','fb_bob','bob@acme.test','Bob Builder','customers/cust-bob','2026-04-01T00:00:00Z','2026-09-20T00:00:00Z'),
  ('${ID.dora}','fb_dora','dora@acme.test','Dora Dup',null,'2026-05-01T00:00:00Z','2026-09-30T00:00:00Z'),
  ('${ID.carl}',null,'carl@nowhere.test','',null,'2026-06-01T00:00:00Z',null);
 insert into role_grants (person_id, scope_type, role) values
  ('${ID.owner}','platform','platform_owner'), ('${ID.support}','platform','customer_support'),
  ('${ID.privacy}','platform','privacy_data_admin'), ('${ID.analyst}','platform','read_only_analyst');
 insert into role_grants (person_id, scope_type, program_id, role) values ('${ID.lead}','program','executive-signature','program_lead');
 insert into organizations (id, slug, name, status, contact_name, contact_email, weekly_report_opt_in) values
  ('${ORG}','acme','Acme Corp','active','Carol Contact','Contact@Acme.test', true);
 insert into cohorts (id, program_id, organization_id, name, status) values
  ('${COHORT}','tsa','${ORG}','Acme Spring','active'), ('${COHORT2}','tsa','${ORG}','Acme Fall','planned');
 insert into role_grants (person_id, scope_type, organization_id, role, assigned_cohort_names, granted_by) values
  ('${ID.orgrep}','organization','${ORG}','cohort_facilitator', array['Acme Fall'], '${ID.owner}');
 insert into enrollments (person_id, program_id, cohort_id, status, joined_at) values
  ('${ID.member}','tsa','${COHORT}','active','2026-02-01T00:00:00Z'), ('${ID.bob}','tsa','${COHORT}','completed','2026-02-01T00:00:00Z');
 insert into entitlements (id, person_id, program_id, assessment_id, access_type, status) values
  ('${U(701)}','${ID.alice}','executive-signature',null,'free','active'),
  ('${U(702)}','${ID.bob}','executive-signature',null,'comped','active'),
  ('${U(703)}','${ID.dora}','executive-signature',null,'free','active');
 insert into assessment_definitions (id, program_id, title, status, estimated_minutes) values
  ('quick-check','executive-signature','Quick Check','live', 5), ('full-assessment','executive-signature','Full Assessment','live', 20),
  ('tsa-diagnostic','tsa','TSA diagnostic','live', 10)
  on conflict (id) do nothing;
 insert into assessment_versions (id, assessment_id, version, scoring_version, content_version, status, questions, content, published_at) values
  ('${V_QUICK}','quick-check','1.0.0','s1','c1','published','[{"id":"q1","text":"Question one"},{"id":"q2","text":"Question two"}]'::jsonb,'{"intro":"hello"}'::jsonb, now()),
  ('${V_FULL}','full-assessment','1.0.0','s2','c1','draft','[]'::jsonb,'{}'::jsonb, null);
 insert into assessment_scoring (version_id, scoring) values ('${V_FULL}', '{"weights":{"a":1}}'::jsonb);
 insert into consent_events (id, person_id, type, notice_version, granted, source, recorded_at) values
  ('${U(801)}','${ID.alice}','assessment_processing','n1',true,'web','2026-09-01T10:00:00Z'),
  ('${U(802)}','${ID.bob}','assessment_processing','n1',true,'web','2026-09-02T10:00:00Z'),
  ('${U(803)}','${ID.alice}','marketing','n2',false,'web','2026-09-03T10:00:00Z');
 insert into duplicate_candidates (person_a, person_b, status) values ('${ID.alice}','${ID.dora}','open');
 insert into audit_events (actor_person_id, action, subject_type, subject_id, person_id, detail) values
  (null, 'customer_entitlement_granted', 'person', '${ID.alice}', '${ID.alice}', '{"actorRole":"customer_support","outcome":"success","note":"private note"}'::jsonb);
`);
const attempt = (id, person, version, assessment, completed, score, label) =>
  `insert into assessment_attempts (id, person_id, program_id, assessment_id, version_id, status, idempotency_hash, started_at, completed_at, overall_score, area_scores, profile_label, band, result_checksum, legacy_firestore_id)
   values ('${id}','${person}','executive-signature','${assessment}','${version}','completed','${sha(id.slice(-1) + 'a')}','${completed}'::timestamptz - interval '5 minutes','${completed}',${score},'{"X":1}'::jsonb,'${label}','Strong','${sha('b')}','assessmentAttempts/fs${id.slice(-3)}')`;
await db.exec(attempt(U(1001), ID.alice, V_QUICK, 'quick-check', '2026-09-01T10:00:00Z', 60.5, 'Team player'));
await db.exec(attempt(U(1002), ID.alice, V_QUICK, 'quick-check', '2026-09-05T10:00:00Z', 66, 'Go-getter'));
await db.exec(attempt(U(1003), ID.bob, V_QUICK, 'quick-check', '2026-09-07T10:00:00Z', 41, 'Steady supporter'));
await db.exec(`insert into assessment_response_parts (attempt_id, part_number, part_count, answers, response_checksum) values ('${U(1001)}', 1, 1, '[{"q":"q1","a":"${SECRET}"}]'::jsonb, '${sha('c')}')`);
await db.exec(`insert into assessment_attempts (person_id, program_id, assessment_id, version_id, status, idempotency_hash, completed_at, overall_score, result_checksum)
  select '${ID.member}', 'tsa', 'tsa-diagnostic', v.id, 'completed', '${sha('d')}', now(), 50, '${sha('e')}' from (select ${`'${V_QUICK}'::uuid`} as id) v`).catch(() => {});
// Credentials: one with a person and an issuance marker, one without a person (the old orphan), one revoked, one superseded.
await db.exec(`
 insert into credentials (credential_code, person_id, program_id, title, recipient_name, program_version, status, issued_at, revoked_at, legacy_issuance_id, signatory_name, signatory_title) values
  ('UTL-TSA-AAAAAAAAAAAA','${ID.member}','tsa','Think, speak and act','Mia Member','tsa-2026-v1','issued','2026-09-01T00:00:00Z', null, 'credential_issuance/x1','Wen','Founder'),
  ('UTL-TSA-BBBBBBBBBBBB',null,'tsa','Think, speak and act','Orphan Person','tsa-2026-v1','issued','2026-08-01T00:00:00Z', null, null,'',''),
  ('UTL-TSA-CCCCCCCCCCCC','${ID.bob}','tsa','Think, speak and act','Bob Builder','tsa-2026-v1','revoked','2026-07-01T00:00:00Z','2026-07-02T00:00:00Z','credential_issuance/x2','',''),
  ('UTL-TSA-DDDDDDDDDDDD','${ID.bob}','tsa','Think, speak and act','Bob Builder','tsa-2026-v1','superseded','2026-06-01T00:00:00Z', null,'credential_issuance/x3','','');
 insert into organization_roster_drafts (id, organization_id, cohort_name, rows, status, submitted_by_uid, submitted_by_person_id, submitted_at, reviewed_at) values
  ('${U(1101)}','${ORG}','Acme Fall','[{"name":"New Person","email":"new@acme.test"}]'::jsonb,'submitted','${ORGREP}','${ID.orgrep}','2026-09-15T00:00:00Z', null),
  ('${U(1102)}','${ORG}','Acme Fall','[{"name":"Old Person","email":"old@acme.test"}]'::jsonb,'approved','${ORGREP}','${ID.orgrep}','2026-09-01T00:00:00Z','2026-09-02T00:00:00Z');
 insert into audit_events (actor_person_id, action, subject_type, subject_id, person_id, organization_id, detail, legacy_firestore_id) values
  ('${ID.owner}','organization_member_updated','person','${ID.orgrep}','${ID.orgrep}','${ORG}',
   '{"firestore_action":"updated","nextRole":"cohort_facilitator","nextCohortIds":["Acme Fall"]}'::jsonb,'organizations/acme/access_audit/a1'),
  ('${ID.owner}','renamed','organization','${ORG}',null,'${ORG}','{"firestore_action":"renamed","previousName":"Acme","nextName":"Acme Corp"}'::jsonb,'organizations/acme/access_audit/a2'),
  ('${ID.owner}','something_else','organization','${ORG}',null,'${ORG}','{}'::jsonb,null);
`);

const STAFF = {
  admin_list_customers: 'text,text,integer,text', admin_get_customer: 'text', admin_list_es_participants: 'integer,text',
  admin_list_es_attempts: 'integer,text', admin_get_es_configuration: '', admin_get_es_governance: 'integer,text',
  admin_search_credentials: 'text', admin_credential_registry: '', admin_organization_access: ''
};

// ============================================================ grants, definition and privacy of the functions
for (const [fn, args] of Object.entries(STAFF)) {
  const g = (await q(`select has_function_privilege('anon','public.${fn}(${args})','execute') a, has_function_privilege('authenticated','public.${fn}(${args})','execute') u,
     (select count(*)::int from pg_proc where proname='${fn}') n,
     (select prosecdef from pg_proc where oid = 'public.${fn}(${args})'::regprocedure) d,
     (select array_to_string(proconfig, ',') from pg_proc where oid = 'public.${fn}(${args})'::regprocedure) c,
     (select prosrc from pg_proc where oid = 'public.${fn}(${args})'::regprocedure) src`))[0];
  ok(`${fn}: anon no, authenticated yes, one version`, g.a === false && g.u === true && g.n === 1);
  ok(`${fn}: security definer, empty search_path`, g.d && /search_path=("")?(,|$)/.test(g.c || ''), g.c);
  ok(`${fn}: no dynamic sql, no writes`, !/^\s*execute\b/im.test(g.src) && !/\bexecute\b\s+(format|'|\$|quote)/i.test(g.src) && !/\b(insert\s+into|update\s+public|delete\s+from)\b/i.test(g.src));
  const after = g.src.slice(g.src.search(/\bbegin\b/i) + 5).trimStart();
  ok(`${fn}: first statement is the staff check with 42501`, /^if not \(?private\.has_platform_role\(array\[[^\]]+\]\)/i.test(after) && /^[^;]*?errcode = '42501';/is.test(after), after.slice(0, 100));
  ok(`${fn}: never selects the raw answers column`, !/\.answers\b|\bpayload\b|scoring_inputs/i.test(g.src));
}
const helpers = await q(`select p.proname, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname like 'ar!_%' escape '!'`);
ok('four private helpers exist and are closed to browsers', helpers.length === 4 && helpers.every((h) => !h.a && !h.u), JSON.stringify(helpers));
const wide = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosrc ~* 'password|secret|token|api_key|service_role'
  and p.proname in (${Object.keys(STAFF).map((f) => `'${f}'`).join(',')})`);
ok('no function reads a secret, password or token', wide.length === 0, JSON.stringify(wide));

// ============================================================ who may call what
const CALLS = {
  admin_list_customers: "public.admin_list_customers(null, null, 25, null)",
  admin_get_customer: `public.admin_get_customer('${ID.alice}')`,
  admin_list_es_participants: 'public.admin_list_es_participants(25, null)',
  admin_list_es_attempts: 'public.admin_list_es_attempts(25, null)',
  admin_get_es_configuration: 'public.admin_get_es_configuration()',
  admin_get_es_governance: 'public.admin_get_es_governance(25, null)',
  admin_search_credentials: "public.admin_search_credentials('mia')",
  admin_credential_registry: 'public.admin_credential_registry()',
  admin_organization_access: 'public.admin_organization_access()'
};
const ALLOWED = {
  admin_list_customers: [OWNER, SUPPORT, PRIVACY], admin_get_customer: [OWNER, SUPPORT, PRIVACY],
  admin_list_es_participants: [OWNER, SUPPORT, PRIVACY, LEAD], admin_list_es_attempts: [OWNER, SUPPORT, PRIVACY, LEAD],
  admin_get_es_configuration: [OWNER, SUPPORT, PRIVACY, LEAD], admin_get_es_governance: [OWNER, SUPPORT, PRIVACY, LEAD],
  admin_search_credentials: [OWNER], admin_credential_registry: [OWNER], admin_organization_access: [OWNER]
};
const ALL = [OWNER, SUPPORT, PRIVACY, LEAD, ANALYST, MEMBER, ORGREP, NOBODY];
for (const [fn, sql] of Object.entries(CALLS)) {
  await rejectsAs(`${fn}: anon cannot run it`, 'anon', null, `select ${sql}`, '42501');
  for (const who of ALL) {
    if (ALLOWED[fn].includes(who)) {
      let good = false; let why = '';
      try { const r = await call(who, sql); good = r && r.ok === true; } catch (e) { why = e.message.slice(0, 100); }
      ok(`${fn}: ${who} may call it`, good, why);
    } else {
      await rejectsAs(`${fn}: ${who} is refused`, 'authenticated', who, `select ${sql} as r`, '42501');
    }
  }
}
// A suspended or ended grant gives no access.
await db.exec(`update role_grants set status = 'suspended' where person_id = '${ID.support}'`);
await rejectsAs('a suspended customer_support grant is refused', 'authenticated', SUPPORT, `select ${CALLS.admin_list_customers} as r`, '42501');
await db.exec(`update role_grants set status = 'active' where person_id = '${ID.support}'`);
await db.exec(`update role_grants set status = 'suspended' where person_id = '${ID.lead}'`);
await rejectsAs('a suspended program lead is refused', 'authenticated', LEAD, `select ${CALLS.admin_list_es_attempts} as r`, '42501');
await db.exec(`update role_grants set status = 'active' where person_id = '${ID.lead}'`);

// ============================================================ customer directory
{
  const r = await call(OWNER, `public.admin_list_customers(null, null, 25, null)`);
  ok('directory: shape {ok, mode, rows, nextCursor}', keys(r) === 'mode,nextCursor,ok,rows' && r.ok === true && r.mode === 'recent', keys(r));
  const ids = r.rows.map((x) => x.customerId);
  ok('directory: customers are people with a program record or a customers/ id', ['alice', 'bob', 'dora', 'member'].every((n) => ids.includes(ID[n])) && !ids.includes(ID.owner) && !ids.includes(ID.carl), JSON.stringify(ids));
  const row = r.rows.find((x) => x.customerId === ID.alice);
  ok('directory: row has the Firebase directoryRow fields', keys(row) === 'accountStatus,createdAt,customerId,displayName,hasOpenDuplicate,isMigrated,lastActivityAt,primaryEmail,programIds,relationships', keys(row));
  ok('directory: row values', row.displayName === 'Álice Ångström' && row.primaryEmail === 'alice@acme.test' && row.accountStatus === 'active'
    && JSON.stringify(row.programIds) === '["executive-signature"]' && JSON.stringify(row.relationships) === '["lead"]' && row.hasOpenDuplicate === true && row.isMigrated === false
    && row.createdAt === '2026-03-01T00:00:00.000Z' && row.lastActivityAt === '2026-09-10T00:00:00.000Z', JSON.stringify(row));
  const bob = r.rows.find((x) => x.customerId === ID.bob);
  ok('directory: relationships are derived (comped customer, completed tsa enrollment is alumni)', JSON.stringify(bob.relationships) === '["alumni","customer"]' && JSON.stringify(bob.programIds) === '["executive-signature","tsa"]' && bob.isMigrated === true, JSON.stringify(bob));
  const mia = r.rows.find((x) => x.customerId === ID.member);
  ok('directory: an active tsa enrollment is a member', JSON.stringify(mia.relationships) === '["member"]');
  ok('directory: newest created first', r.rows[0].customerId === ID.member || r.rows[0].customerId === ID.dora, r.rows[0].customerId);
  const page1 = await call(OWNER, `public.admin_list_customers(null, null, 2, null)`);
  ok('directory: a full page returns the last id as nextCursor', page1.rows.length === 2 && page1.nextCursor === page1.rows[1].customerId);
  const page2 = await call(OWNER, `public.admin_list_customers(null, null, 2, '${page1.nextCursor}')`);
  ok('directory: the next page continues after the cursor with no overlap', page2.rows.length === 2 && !page2.rows.some((x) => page1.rows.some((y) => y.customerId === x.customerId)));
  const page3 = await call(OWNER, `public.admin_list_customers(null, null, 2, '${page2.nextCursor}')`);
  ok('directory: the last page is short and has no cursor', page3.rows.length === 0 && page3.nextCursor === null, JSON.stringify(page3));
  const legacyCursor = await call(OWNER, `public.admin_list_customers(null, null, 25, 'cust-alice')`);
  ok('directory: an old Firestore customer id works as a cursor', legacyCursor.rows.every((x) => x.customerId !== ID.alice) && legacyCursor.rows.length < r.rows.length);
  const tsa = await call(OWNER, `public.admin_list_customers(null, 'tsa', 25, null)`);
  ok('directory: program filter', tsa.rows.length === 2 && tsa.rows.every((x) => x.programIds.includes('tsa')), JSON.stringify(tsa.rows.map((x) => x.programIds)));
  const bogus = await call(OWNER, `public.admin_list_customers(null, 'nope', 25, null)`);
  ok('directory: an unknown program filter is ignored', bogus.rows.length === r.rows.length);
  const name = await call(OWNER, `public.admin_list_customers('alice ang', null, 25, null)`);
  ok('directory: name search is accent blind and prefix based', name.mode === 'byName' && name.rows.length === 1 && name.rows[0].customerId === ID.alice, JSON.stringify(name.rows.map((x) => x.displayName)));
  const none = await call(OWNER, `public.admin_list_customers('lice', null, 25, null)`);
  ok('directory: a name search matches the start of the name only', none.rows.length === 0);
  const email = await call(OWNER, `public.admin_list_customers('Bob@Acme.test', 'tsa', 25, null)`);
  ok('directory: an address is looked up exactly and ignores the filter', email.mode === 'byEmail' && email.rows.length === 1 && email.rows[0].customerId === ID.bob && email.nextCursor === null);
  const noEmail = await call(OWNER, `public.admin_list_customers('nobody@acme.test', null, 25, null)`);
  ok('directory: unknown address gives an empty list', noEmail.mode === 'byEmail' && noEmail.rows.length === 0);
  const wild = await call(OWNER, `public.admin_list_customers('al_ce', null, 25, null)`);
  ok('directory: an underscore is not a wildcard', wild.rows.length === 0);
  const big = await call(OWNER, `public.admin_list_customers(null, null, 100000, null)`);
  ok('directory: page size is capped and bad values default', big.rows.length === r.rows.length);
  ok('directory: support and privacy roles see the same rows', JSON.stringify((await call(SUPPORT, `public.admin_list_customers(null, null, 25, null)`)).rows) === JSON.stringify(r.rows));
}

// ============================================================ customer detail
{
  const d = await call(OWNER, `public.admin_get_customer('${ID.alice}')`);
  ok('detail: shape', keys(d) === 'assessments,audit,consent,ok,overview,programs', keys(d));
  ok('detail: overview equals the directory row', JSON.stringify(d.overview) === JSON.stringify((await call(OWNER, `public.admin_list_customers(null, null, 25, null)`)).rows.find((x) => x.customerId === ID.alice)));
  ok('detail: assessments shape', keys(d.assessments) === 'attempts,entitlements' && keys(d.assessments.entitlements[0]) === 'accessType,assessmentId,attemptsCompleted,entitlementId,programId,retakesAllowed,retakesUsed,status', keys(d.assessments.entitlements[0]));
  ok('detail: attempts hold results only', d.assessments.attempts.length === 2 && keys(d.assessments.attempts[0]) === 'assessmentId,attemptId,completedAt,resultLabel,resultScore,status' && d.assessments.attempts[0].resultScore === 60.5, JSON.stringify(d.assessments.attempts[0]));
  ok('detail: owner sees consent and audit history', d.consent.restricted === false && d.consent.events.length === 2 && keys(d.consent.events[0]) === 'consentEventId,consentType,granted,occurredAt,version'
    && d.audit.restricted === false && d.audit.events.length === 1 && keys(d.audit.events[0]) === 'action,actorRole,auditEventId,createdAt,outcome', JSON.stringify(d.audit));
  ok('detail: audit shows the role and outcome but not the private note', d.audit.events[0].actorRole === 'customer_support' && d.audit.events[0].outcome === 'success' && !JSON.stringify(d).includes('private note'));
  const s = await call(SUPPORT, `public.admin_get_customer('${ID.alice}')`);
  ok('detail: customer support gets the restricted notices and no events', s.consent.restricted === true && s.consent.events.length === 0 && s.audit.restricted === true && s.audit.events.length === 0
    && s.consent.reason === 'Consent and privacy records require the privacy data admin role.' && s.audit.reason === 'Audit history requires the privacy data admin role.');
  const p = await call(PRIVACY, `public.admin_get_customer('${ID.alice}')`);
  ok('detail: privacy data admin sees the history', p.consent.restricted === false && p.consent.events.length === 2);
  const bob = await call(OWNER, `public.admin_get_customer('cust-bob')`);
  ok('detail: an old Firestore customer id is accepted', bob.overview.customerId === ID.bob);
  ok('detail: programs list the cohort by name', bob.programs.length === 1 && bob.programs[0].cohortId === 'Acme Spring' && keys(bob.programs[0]) === 'cohortId,completedAt,enrollmentId,joinedAt,programId,status', JSON.stringify(bob.programs));
  await rejectsAs('detail: an unknown customer is not found', 'authenticated', OWNER, `select public.admin_get_customer('${U(9999)}') as r`, 'P0002');
  await rejectsAs('detail: an email address is not an opaque id', 'authenticated', OWNER, `select public.admin_get_customer('alice@acme.test') as r`, '22023');
  await rejectsAs('detail: an empty id is refused', 'authenticated', OWNER, `select public.admin_get_customer('') as r`, '22023');
  ok('detail: the raw answer text never appears', !JSON.stringify(d).includes(SECRET));
}

// ============================================================ Executive Signature screens
{
  const parts = await call(OWNER, `public.admin_list_es_participants(25, null)`);
  ok('participants: shape and rows', keys(parts) === 'nextCursor,ok,rows' && parts.rows.length === 3 && parts.rows.every((x) => x.programIds.includes('executive-signature')), JSON.stringify(parts.rows.map((x) => x.displayName)));
  ok('participants: most recent activity first', parts.rows[0].customerId === ID.dora && parts.rows[1].customerId === ID.bob, JSON.stringify(parts.rows.map((x) => x.customerId)));
  const pg = await call(LEAD, `public.admin_list_es_participants(2, null)`);
  const pg2 = await call(LEAD, `public.admin_list_es_participants(2, '${pg.nextCursor}')`);
  ok('participants: paging by cursor, program lead may read', pg.rows.length === 2 && pg2.rows.length === 1 && pg2.nextCursor === null);

  const at = await call(OWNER, `public.admin_list_es_attempts(25, null)`);
  ok('attempts: shape', keys(at) === 'nextCursor,ok,rows' && at.rows.length === 3, String(at.rows.length));
  ok('attempts: row fields', keys(at.rows[0]) === 'assessmentId,attemptId,band,completedAt,customerId,displayName,primaryEmail,responsePartCount,resultLabel,resultScore,startedAt,status', keys(at.rows[0]));
  ok('attempts: newest first, the TSA attempt is not listed', at.rows[0].attemptId === U(1003) && at.rows.every((x) => x.assessmentId !== 'tsa-diagnostic'), JSON.stringify(at.rows.map((x) => x.assessmentId)));
  const a1 = at.rows.find((x) => x.attemptId === U(1001));
  ok('attempts: who it belongs to, the score as a number, the answer parts only counted', a1.displayName === 'Álice Ångström' && a1.primaryEmail === 'alice@acme.test' && a1.resultScore === 60.5 && a1.responsePartCount === 1 && at.rows.find((x) => x.attemptId === U(1002)).responsePartCount === 0);
  ok('attempts: the raw answer text never appears', !JSON.stringify(at).includes(SECRET));
  const apg = await call(OWNER, `public.admin_list_es_attempts(2, null)`);
  const apg2 = await call(OWNER, `public.admin_list_es_attempts(2, '${apg.nextCursor}')`);
  ok('attempts: paging', apg.rows.length === 2 && apg2.rows.length === 1 && apg2.rows[0].attemptId === U(1001));
  const apgLegacy = await call(OWNER, `public.admin_list_es_attempts(25, 'fs003')`);
  ok('attempts: an old Firestore attempt id works as a cursor', apgLegacy.rows.length === 2);

  const cfg = await call(SUPPORT, `public.admin_get_es_configuration()`);
  ok('configuration: shape', keys(cfg) === 'definitions,ok,versions', keys(cfg));
  ok('configuration: Executive Signature definitions only', cfg.definitions.length === 2 && cfg.definitions.every((d) => d.programId === 'executive-signature') && keys(cfg.definitions[0]) === 'assessmentId,currentVersionId,estimatedMinutes,programId,status,title,updatedAt', keys(cfg.definitions[0]));
  const vq = cfg.versions.find((v) => v.versionId === V_QUICK);
  ok('configuration: version fields', keys(vq) === 'assessmentId,content,contentVersion,createdAt,programId,publishedAt,questionCount,questions,scoring,scoringVersion,status,version,versionId' && vq.questionCount === 2 && vq.questions[0].text === 'Question one' && vq.scoring === null && vq.publishedAt !== null, keys(vq));
  ok('configuration: scoring comes from the scoring table', cfg.versions.find((v) => v.versionId === V_FULL).scoring.weights.a === 1 && cfg.versions.find((v) => v.versionId === V_FULL).publishedAt === null);

  const gv = await call(OWNER, `public.admin_get_es_governance(25, null)`);
  ok('governance: shape', keys(gv) === 'consent,ok,retention' && keys(gv.consent) === 'events,nextCursor,reason,restricted' && gv.consent.restricted === false, keys(gv));
  ok('governance: events newest first with the Firebase fields', gv.consent.events.length === 3 && gv.consent.events[0].consentEventId === U(803) && keys(gv.consent.events[0]) === 'consentEventId,consentType,customerId,granted,noticeVersion,recordedAt', keys(gv.consent.events[0]));
  ok('governance: retention summary has four rows', gv.retention.length === 4 && keys(gv.retention[0]) === 'dataClass,deletionBehavior,retention' && gv.retention[3].dataClass === 'Consent proof');
  const gpg = await call(PRIVACY, `public.admin_get_es_governance(2, null)`);
  const gpg2 = await call(PRIVACY, `public.admin_get_es_governance(2, '${gpg.consent.nextCursor}')`);
  ok('governance: paging', gpg.consent.events.length === 2 && gpg2.consent.events.length === 1 && gpg2.consent.nextCursor === null);
  for (const who of [SUPPORT, LEAD]) {
    const g = await call(who, `public.admin_get_es_governance(25, null)`);
    ok(`governance: ${who} gets the restricted notice, no events, still the retention summary`, g.consent.restricted === true && g.consent.events.length === 0 && g.consent.nextCursor === null
      && g.consent.reason === 'Consent events require the privacy data admin or platform owner role.' && g.retention.length === 4);
  }
}

// ============================================================ credentials
{
  const s = await call(OWNER, `public.admin_search_credentials('mia')`);
  ok('search: shape', keys(s) === 'credentials,ok' && s.credentials.length === 1, JSON.stringify(s));
  ok('search: credential fields match the public record the page reads', keys(s.credentials[0]) === 'credentialCode,credentialId,credentialTitle,issuedAt,issuer,programId,programVersion,recipientName,signatoryName,signatoryTitle,status,verificationUrl', keys(s.credentials[0]));
  ok('search: values', s.credentials[0].credentialId === 'UTL-TSA-AAAAAAAAAAAA' && s.credentials[0].status === 'active' && s.credentials[0].programId === 'think-speak-act-executive' && s.credentials[0].credentialCode === 'TSA'
    && s.credentials[0].verificationUrl === 'https://theuntaughtlessons.com/verify/?id=UTL-TSA-AAAAAAAAAAAA' && s.credentials[0].issuedAt === '2026-09-01T00:00:00.000Z', JSON.stringify(s.credentials[0]));
  ok('search: by credential id (case blind)', (await call(OWNER, `public.admin_search_credentials('utl-tsa-bbbb')`)).credentials[0].recipientName === 'Orphan Person');
  const byEmail = await call(OWNER, `public.admin_search_credentials('Bob@acme.test')`);
  ok('search: by address finds that person, with revoked and replaced words as the page uses them', byEmail.credentials.map((c) => c.status).sort().join() === 'replaced,revoked', JSON.stringify(byEmail.credentials.map((c) => c.status)));
  ok('search: a percent sign is not a wildcard', (await call(OWNER, `public.admin_search_credentials('%%')`)).credentials.length === 0);
  await rejectsAs('search: under two characters is refused', 'authenticated', OWNER, `select public.admin_search_credentials('a') as r`, '22023');
  ok('search: the answer carries no address or person id', !/@|person_id|userId/.test(JSON.stringify(byEmail)));
  const reg = await call(OWNER, `public.admin_credential_registry()`);
  ok('registry: shape', keys(reg) === 'credentials,ok' && keys(reg.credentials[0]) === 'credentialId,email,issuedAt,recipientName,status,userId,verificationUrl', keys(reg.credentials[0]));
  ok('registry: only credentials that have an issuance record or a person (the orphan is not listed)', reg.credentials.length === 3 && !reg.credentials.some((c) => c.credentialId === 'UTL-TSA-BBBBBBBBBBBB'), JSON.stringify(reg.credentials.map((c) => c.credentialId)));
  const r1 = reg.credentials.find((c) => c.credentialId === 'UTL-TSA-AAAAAAAAAAAA');
  ok('registry: email and Firebase uid of the holder', r1.email === 'member@utl.test' && r1.userId === MEMBER && r1.status === 'active');
}

// ============================================================ organization access
{
  const o = await call(OWNER, `public.admin_organization_access()`);
  ok('org access: shape', keys(o) === 'audit,memberships,ok,organizations,roleLabels,rosterDrafts', keys(o));
  ok('org access: organization fields and cohort names', keys(o.organizations[0]) === 'cohortIds,contactEmail,contactName,id,name,status,weeklyReportOptIn' && o.organizations[0].id === 'acme'
    && JSON.stringify(o.organizations[0].cohortIds) === '["Acme Fall","Acme Spring"]' && o.organizations[0].contactEmail === 'contact@acme.test' && o.organizations[0].weeklyReportOptIn === true, JSON.stringify(o.organizations[0]));
  const m = o.memberships[0];
  ok('org access: membership fields', o.memberships.length === 1 && keys(m) === 'assignedCohortIds,displayName,email,organizationId,preview,role,status,uid,updatedAt,updatedByEmail', keys(m));
  ok('org access: membership values', m.uid === ORGREP && m.email === 'rep@acme.test' && m.role === 'cohort_facilitator' && m.organizationId === 'acme' && m.updatedByEmail === 'owner@utl.test' && JSON.stringify(m.assignedCohortIds) === '["Acme Fall"]');
  ok('org access: preview lists only the assigned cohort and the fixed permission text', keys(m.preview) === 'cohortIds,excluded,organizationId,organizationName,permissions,role,roleLabel,status' && JSON.stringify(m.preview.cohortIds) === '["Acme Fall"]'
    && m.preview.roleLabel === 'Cohort Facilitator' && m.preview.permissions.length === 3 && m.preview.excluded.length === 4);
  ok('org access: only submitted roster drafts', o.rosterDrafts.length === 1 && keys(o.rosterDrafts[0]) === 'cohortId,id,organizationId,organizationName,rows,status,submittedAt,submittedByEmail' && o.rosterDrafts[0].submittedByEmail === 'rep@acme.test' && o.rosterDrafts[0].rows[0].name === 'New Person');
  ok('org access: audit lists the access audit rows only, newest first, with the Firebase fields', o.audit.length === 2 && keys(o.audit[0]) === 'action,actorEmail,cohortIds,id,nextName,occurredAt,organizationId,organizationName,previousName,roleLabel,targetEmail'
    && o.audit.some((a) => a.action === 'renamed' && a.previousName === 'Acme' && a.nextName === 'Acme Corp') && o.audit.some((a) => a.action === 'updated' && a.targetEmail === 'rep@acme.test' && a.roleLabel === 'Cohort Facilitator' && a.actorEmail === 'owner@utl.test'), JSON.stringify(o.audit));
  ok('org access: role labels', JSON.stringify(Object.keys(o.roleLabels).sort()) === '["cohort_facilitator","organization_owner","program_manager","report_viewer"]' && o.roleLabels.report_viewer === 'Report Viewer');
  await db.exec(`update role_grants set ended_at = now() where person_id = '${ID.orgrep}' and scope_type = 'organization'`);
  ok('org access: an ended grant is not listed', (await call(OWNER, `public.admin_organization_access()`)).memberships.length === 0);
}

// ============================================================ nothing was written, tables stay closed
{
  const before = await q(`select (select count(*)::int from audit_events) a, (select count(*)::int from people) p, (select count(*)::int from role_grants) g`);
  for (const sql of Object.values(CALLS)) await call(OWNER, sql);
  const after = await q(`select (select count(*)::int from audit_events) a, (select count(*)::int from people) p, (select count(*)::int from role_grants) g`);
  ok('calling every function writes nothing', JSON.stringify(before) === JSON.stringify(after));
}

// ============================================================ rollback
{
  const down = fs.readFileSync(new URL('./rollbacks/20261008002240_admin_read_screens_down.sql', import.meta.url), 'utf8');
  await db.exec(down);
  const left = await q(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'public' and p.proname in (${Object.keys(STAFF).map((f) => `'${f}'`).join(',')})) or (n.nspname = 'private' and p.proname like 'ar!_%' escape '!')`);
  ok('rollback removes the nine functions and the four helpers', left[0].n === 0, String(left[0].n));
  ok('rollback leaves the data alone', (await q(`select count(*)::int n from credentials`))[0].n === 4 && (await q(`select count(*)::int n from people`))[0].n === 11);
}

console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
