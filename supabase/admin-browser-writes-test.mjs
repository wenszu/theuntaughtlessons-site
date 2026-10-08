// Tests for migration 20261008002220: the Supabase copy of the admin console writes made straight from the browser.
// Run: node supabase/admin-browser-writes-test.mjs
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
const q = async (s, p) => (await db.query(s, p)).rows;
const n1 = async (s) => Number((await q(s))[0].n);
const OWNER = 'fb_owner', MEMBER = 'fb_member', SUPPORT = 'fb_support', TARGET = 'fb_target';
const call = async (sub, sql) => (await as('authenticated', sub, `select ${sql} as r`))[0].r;
const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const OWNER_ID = U(1), MEMBER_ID = U(2), SUPPORT_ID = U(3), TARGET_ID = U(4);
const COHORT_A = U(501), COHORT_B = U(502), COHORT_C = U(503), ORG_ID = U(601);

await db.exec(`
 insert into people (id, auth_uid, primary_email, display_name) values
  ('${OWNER_ID}','${OWNER}','owner@utl.com','Olive Owner'),
  ('${MEMBER_ID}','${MEMBER}','member@acme.org','Mia Member'),
  ('${SUPPORT_ID}','${SUPPORT}','support@utl.com','Sam Support'),
  ('${TARGET_ID}','${TARGET}','target@acme.org','Tess Target');
 insert into person_emails (person_id, email) values ('${TARGET_ID}','target@acme.org');
 insert into role_grants (person_id, scope_type, role) values
  ('${OWNER_ID}','platform','platform_owner'),('${SUPPORT_ID}','platform','customer_support');
 insert into organizations (id, slug, name) values ('${ORG_ID}','acme-learning','Acme Learning');
`);

// ============================================================ grants and exposure
const FNS = [
  ['admin_mirror_cohort', 'uuid,text,text,date,date,text,text,text,uuid,text', `public.admin_mirror_cohort('${COHORT_A}', 'Wave 1')`],
  ['admin_mirror_cohort_rename', 'text,text,uuid', `public.admin_mirror_cohort_rename('Wave 1', 'Wave 2', '${COHORT_B}')`],
  ['admin_mirror_feedback_enabled', 'text,boolean', `public.admin_mirror_feedback_enabled('${TARGET}', true)`],
  ['admin_mirror_support_preview', 'text,text,text', `public.admin_mirror_support_preview('evt1', '${TARGET}', null)`]
];
for (const [fn, args] of FNS) {
  const g = (await q(`select has_function_privilege('anon','public.${fn}(${args})','execute') a, has_function_privilege('authenticated','public.${fn}(${args})','execute') u,
     (select count(*)::int from pg_proc where proname='${fn}') n,
     (select prosecdef from pg_proc where proname='${fn}') sd,
     (select array_to_string(proconfig, ',') from pg_proc where proname='${fn}') cfg,
     (select prosrc from pg_proc where proname='${fn}') src`))[0];
  ok(`${fn}: anon no, authenticated yes, one version`, g.a === false && g.u === true && g.n === 1);
  ok(`${fn}: security definer with an empty search_path`, g.sd === true && /search_path=("")?(,|$)/.test(g.cfg || ''), g.cfg);
  ok(`${fn}: the first statement refuses anyone but a platform_owner with 42501`, /^\s*if not private\.has_platform_role\(array\['platform_owner'\]\) then\s+raise exception[^;]*errcode = '42501';/i.test(g.src.slice(g.src.search(/\bbegin\b/i) + 5)), g.src.slice(0, 80));
  ok(`${fn}: no dynamic sql`, !/^\s*execute\b/im.test(g.src) && !/\bexecute\b\s+(format|'|\$|quote)/i.test(g.src));
}

// Refused for anon, a plain member, support staff and an unknown token.
for (const [fn, , expr] of FNS) {
  await rejectsAs(`${fn}: anon refused`, 'anon', null, `select ${expr}`, '42501');
  await rejectsAs(`${fn}: plain member refused`, 'authenticated', MEMBER, `select ${expr}`, '42501');
  await rejectsAs(`${fn}: customer_support refused`, 'authenticated', SUPPORT, `select ${expr}`, '42501');
  await rejectsAs(`${fn}: unknown token refused`, 'authenticated', 'fb_nobody', `select ${expr}`, '42501');
}
ok('a refused call changed nothing', await n1(`select count(*) n from cohorts`) === 0 && await n1(`select count(*) n from audit_events`) === 0);

// ============================================================ admin_mirror_cohort
const first = await call(OWNER, `public.admin_mirror_cohort('${COHORT_A}', '  Wave 1  ', 'active', '2026-09-01', '2026-12-01', 'Priya Shah', 'Priya@Acme.org', 'first group', '${ORG_ID}', null)`);
ok('creates a cohort and says so', first.created === true && first.id === COHORT_A, JSON.stringify(first));
let c = (await q(`select * from cohorts where id = '${COHORT_A}'`))[0];
ok('stored with the TSA program, the trimmed name and a lower case contact email', c.program_id === 'tsa' && c.name === 'Wave 1' && c.contact_email === 'priya@acme.org' && c.contact_name === 'Priya Shah' && c.notes === 'first group');
ok('dates and organization stored', String(c.starts_on.toISOString ? c.starts_on.toISOString() : c.starts_on).startsWith('2026-09-01') && c.organization_id === ORG_ID, JSON.stringify(c));
const again = await call(OWNER, `public.admin_mirror_cohort('${COHORT_A}', 'Wave 1', 'completed', null, null, '', '', '', null, null)`);
ok('the same name again updates the row, created is false', again.created === false && again.id === COHORT_A);
c = (await q(`select * from cohorts where id = '${COHORT_A}'`))[0];
ok('cleared fields are cleared (no organization, no dates, no email)', c.status === 'completed' && c.organization_id === null && c.starts_on === null && c.ends_on === null && c.contact_email === null && c.notes === '');
ok('still exactly one row for the name', await n1(`select count(*) n from cohorts where name = 'Wave 1'`) === 1);
// A different id for an existing name keeps the existing row (the name is the natural key).
const clash = await call(OWNER, `public.admin_mirror_cohort('${COHORT_C}', 'Wave 1', 'active')`);
ok('a different id for an existing name updates the existing row', clash.id === COHORT_A && clash.created === false && await n1(`select count(*) n from cohorts where id = '${COHORT_C}'`) === 0);
// Organization by name, unknown organization, bad status, bad email, end before start.
await call(OWNER, `public.admin_mirror_cohort('${COHORT_C}', 'Wave 3', 'weird', '2026-10-10', '2026-10-01', 'Q', 'not an email', 'n', '${U(999)}', 'ACME learning')`);
c = (await q(`select * from cohorts where id = '${COHORT_C}'`))[0];
ok('an unknown status falls back to active, a bad email is dropped', c.status === 'active' && c.contact_email === null);
ok('an organization is found by name (case blind) when the id is unknown', c.organization_id === ORG_ID);
ok('an end date before the start date keeps the start date only', c.ends_on === null && c.starts_on !== null);
await call(OWNER, `public.admin_mirror_cohort('${U(504)}', 'Wave 4', 'active', null, null, '', null, '', '${U(999)}', 'No Such Org')`);
ok('an unknown organization is ignored', (await q(`select organization_id from cohorts where name = 'Wave 4'`))[0].organization_id === null);
await rejectsAs('an empty name is refused (22023)', 'authenticated', OWNER, `select public.admin_mirror_cohort('${U(505)}', '   ')`, '22023');
await rejectsAs('a missing id is refused (22023)', 'authenticated', OWNER, `select public.admin_mirror_cohort(null, 'X')`, '22023');
const long = await call(OWNER, `public.admin_mirror_cohort('${U(506)}', '${'n'.repeat(200)}')`);
ok('a long name is cut to 120 characters', (await q(`select length(name) l from cohorts where id = '${U(506)}'`))[0].l === 120 && long.created === true);
ok('the audit rows carry counts only', (await q(`select detail from audit_events where action = 'cohort.mirrored' order by id`)).every((r) => Object.keys(r.detail).every((k) => k === 'created') && typeof r.detail.created === 'boolean'));
ok('the audit rows are attributed to the owner', await n1(`select count(*) n from audit_events where action = 'cohort.mirrored' and actor_person_id = '${OWNER_ID}'`) > 0);
ok('program enrollments were not touched by a details update', await n1(`select count(*) n from enrollments`) === 0);

// ============================================================ admin_mirror_cohort_rename
await db.exec(`insert into enrollments (person_id, program_id, cohort_id, status) values ('${TARGET_ID}','tsa','${COHORT_A}','active'), ('${MEMBER_ID}','tsa','${COHORT_A}','completed')`);
const rn = await call(OWNER, `public.admin_mirror_cohort_rename('Wave 1', 'Wave 2', '${COHORT_B}')`);
ok('rename reports the move', rn.renamed === true && Number(rn.moved) === 2, JSON.stringify(rn));
ok('the new row has the new id and the old details', (await q(`select id, status, name from cohorts where name = 'Wave 2'`))[0].id === COHORT_B);
ok('the old row is gone and both enrollments follow the new cohort', await n1(`select count(*) n from cohorts where name = 'Wave 1'`) === 0 && await n1(`select count(*) n from enrollments where cohort_id = '${COHORT_B}'`) === 2);
const noop = await call(OWNER, `public.admin_mirror_cohort_rename('Wave 1', 'Wave 9', '${U(507)}')`);
ok('an unknown old name is a no-op', noop.renamed === false && await n1(`select count(*) n from cohorts where name = 'Wave 9'`) === 0);
const same = await call(OWNER, `public.admin_mirror_cohort_rename('Wave 2', 'Wave 2', '${U(508)}')`);
ok('the same name is a no-op', same.renamed === false);
// Rename onto an existing cohort merges into it.
await db.exec(`insert into enrollments (person_id, program_id, cohort_id, status) values ('${OWNER_ID}','tsa','${COHORT_C}','active')`);
const merge = await call(OWNER, `public.admin_mirror_cohort_rename('Wave 3', 'Wave 2', '${U(509)}')`);
ok('renaming onto an existing name moves into it and does not create another row', merge.renamed === true && Number(merge.moved) === 1 && await n1(`select count(*) n from cohorts where name = 'Wave 2'`) === 1 && await n1(`select count(*) n from enrollments where cohort_id = '${COHORT_B}'`) === 3);
// A stub for the new name appears at the very moment of the insert (the member trigger racing the rename): a test trigger
// inserts the stub, with another id, just before the rename's own insert.
const RACE_OLD = U(701), RACE_NEW_ID = U(702), RACE_STUB = U(703);
await db.exec(`
 insert into cohorts (id, program_id, name) values ('${RACE_OLD}', 'tsa', 'Race Old');
 insert into enrollments (person_id, program_id, cohort_id, status) values ('${SUPPORT_ID}', 'tsa', '${RACE_OLD}', 'active');
 create function pg_temp.race_stub() returns trigger language plpgsql as $$
 begin
   insert into public.cohorts (id, program_id, name) values ('${RACE_STUB}', 'tsa', 'Race New');
   return new;
 end $$;
 create trigger race_stub_before before insert on public.cohorts for each row when (new.id = '${RACE_NEW_ID}') execute function pg_temp.race_stub();
`);
const race = await call(OWNER, `public.admin_mirror_cohort_rename('Race Old', 'Race New', '${RACE_NEW_ID}')`);
ok('a stub made at the same moment does not break the rename (no 23505)', race.renamed === true && Number(race.moved) === 1, JSON.stringify(race));
ok('the enrollment follows the stub row that holds the name', (await q(`select cohort_id from enrollments where person_id = '${SUPPORT_ID}'`))[0].cohort_id === RACE_STUB);
ok('the old row is gone and the name is held once', await n1(`select count(*) n from cohorts where name = 'Race Old'`) === 0 && await n1(`select count(*) n from cohorts where name = 'Race New'`) === 1);
await db.exec(`drop trigger race_stub_before on public.cohorts; delete from enrollments where person_id = '${SUPPORT_ID}';`);
await rejectsAs('a missing new id is refused (22023)', 'authenticated', OWNER, `select public.admin_mirror_cohort_rename('Wave 2', 'Wave 5', null)`, '22023');
ok('rename audit rows carry counts only', (await q(`select detail from audit_events where action = 'cohort.renamed'`)).every((r) => Object.keys(r.detail).sort().join() === 'moved,old_row_removed'));

// ============================================================ admin_mirror_feedback_enabled
const fb1 = await call(OWNER, `public.admin_mirror_feedback_enabled('${TARGET}', false)`);
ok('creates the profile row when missing and sets the switch', Number(fb1.updated) === 1 && (await q(`select feedback_enabled from person_profiles where person_id = '${TARGET_ID}'`))[0].feedback_enabled === false);
await call(OWNER, `public.admin_mirror_feedback_enabled('${TARGET}', true)`);
ok('updates the existing row', (await q(`select feedback_enabled from person_profiles where person_id = '${TARGET_ID}'`))[0].feedback_enabled === true && await n1(`select count(*) n from person_profiles where person_id = '${TARGET_ID}'`) === 1);
const fb2 = await call(OWNER, `public.admin_mirror_feedback_enabled('fb_ghost', true)`);
ok('an unknown uid is a no-op', Number(fb2.updated) === 0 && await n1(`select count(*) n from person_profiles`) === 1);
await rejectsAs('a null switch is refused (22023)', 'authenticated', OWNER, `select public.admin_mirror_feedback_enabled('${TARGET}', null)`, '22023');
await rejectsAs('an empty uid is refused (22023)', 'authenticated', OWNER, `select public.admin_mirror_feedback_enabled('  ', true)`, '22023');
ok('the audit rows hold counts and the switch only', (await q(`select detail from audit_events where action = 'member.feedback_switch'`)).every((r) => Object.keys(r.detail).sort().join() === 'enabled,updated'));
ok('only the target profile changed', await n1(`select count(*) n from person_profiles where person_id <> '${TARGET_ID}'`) === 0);

// ============================================================ admin_mirror_support_preview
const sp = await call(OWNER, `public.admin_mirror_support_preview('1759900000000-abc123', '${TARGET}', null)`);
ok('records one audit row', Number(sp.recorded) === 1);
const row = (await q(`select * from audit_events where action = 'support_preview_opened'`))[0];
ok('actor is the caller, subject is the member found by uid', row.actor_person_id === OWNER_ID && row.person_id === TARGET_ID && row.subject_id === TARGET_ID && row.subject_type === 'person');
ok('the row is keyed by its Firestore path and holds no email or name', row.legacy_firestore_id === 'support_preview_audit/1759900000000-abc123' && !/@|Tess|Target/.test(JSON.stringify(row.detail)), JSON.stringify(row.detail));
const sp2 = await call(OWNER, `public.admin_mirror_support_preview('1759900000000-abc123', '${TARGET}', null)`);
ok('the same event twice records once', Number(sp2.recorded) === 0 && await n1(`select count(*) n from audit_events where action = 'support_preview_opened'`) === 1);
const sp3 = await call(OWNER, `public.admin_mirror_support_preview('evt-by-mail', null, 'TARGET@acme.org')`);
ok('the member is found by email when the uid is missing', Number(sp3.recorded) === 1 && (await q(`select person_id from audit_events where legacy_firestore_id = 'support_preview_audit/evt-by-mail'`))[0].person_id === TARGET_ID);
const sp4 = await call(OWNER, `public.admin_mirror_support_preview('evt-nobody', 'fb_ghost', 'ghost@nowhere.org')`);
ok('an unknown member still records the event without a person', Number(sp4.recorded) === 1 && (await q(`select person_id from audit_events where legacy_firestore_id = 'support_preview_audit/evt-nobody'`))[0].person_id === null);
await rejectsAs('a bad event id is refused (22023)', 'authenticated', OWNER, `select public.admin_mirror_support_preview('bad id!', null, null)`, '22023');
await rejectsAs('an empty event id is refused (22023)', 'authenticated', OWNER, `select public.admin_mirror_support_preview('', null, null)`, '22023');
ok('the audit table stays append only', await (async () => { try { await db.exec(`update audit_events set action = 'x'`); return false; } catch (e) { return true; } })());

// ============================================================ no direct table access was added
for (const t of ['cohorts', 'person_profiles', 'audit_events']) {
  const w = (await q(`select has_table_privilege('authenticated','public.${t}','insert,update,delete') w`))[0].w;
  ok(`${t}: authenticated has no write privilege on the table`, w === false);
}
ok('the migration file has no backslash', !(await import('fs')).readFileSync(new URL('./migrations/20261008002220_admin_browser_writes.sql', import.meta.url), 'utf8').includes('\\'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
