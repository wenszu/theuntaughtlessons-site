// Independent permission audit of the browser-facing write functions. Not written by the builders of those
// functions. It asks the database what each function really allows, instead of trusting the source text.
//
//   node supabase/function-audit-test.mjs
//
// Checks, for each function in WRITE_FUNCTIONS that exists:
//   security definer, search_path fixed to empty, no dynamic SQL, resolves the caller through
//   private.current_person_id(), takes no parameter that names a person, role or email,
//   anon cannot execute it, authenticated can, and the service role is not the only caller.
// And across the whole public schema: any other security definer function a browser can call must be on an
// explicit allowlist, so nothing is exposed by accident.
import { boot } from './schema-apply-harness.mjs';

const WRITE_FUNCTIONS = [
  'save_activity_draft', 'clear_activity_draft', 'record_activity_submission', 'record_activity_attempt', 'mark_activity_progress',
  'record_engagement_session', 'record_stability_event', 'record_learning_evidence', 'add_reward_entries', 'update_my_profile', 'record_login',
  'record_activity_practice', 'record_tsa_item_attempt', 'record_tsa_scoring_comparison'
];
// Existing functions that browsers may call on purpose.
const PUBLIC_ALLOWLIST = ['get_public_org_brand', 'get_public_credential'];                 // anon and authenticated
const SIGNED_IN_ALLOWLIST = ['org_assessment_summary', 'get_my_es_status', 'get_es_attempt_report', 'get_my_person_id'];  // authenticated only (the two ES read functions are migration 2210, get_my_person_id is 2230)
// Inbox (migration 2170). The two submit functions are the only new functions anon may execute. The staff functions are
// authenticated only and refuse everyone but a platform_owner as their first statement.
const SUBMIT_FUNCTIONS = ['submit_lead', 'submit_feedback'];                                 // anon and authenticated
const STAFF_FUNCTIONS = ['admin_inbox_list', 'admin_inbox_set_status', 'admin_inbox_delete', 'admin_inbox_purge', 'admin_people_search',
  'admin_set_person_test_flag', 'admin_cleanup_preview', 'admin_cleanup_purge_people', 'admin_cleanup_junk_events'];
// Settings and access (migration 2200), both authenticated only: the caller's own access record (no parameter at all) and the
// platform owner only settings writer.
const ACCESS_FUNCTIONS = ['get_my_access'];
const SETTINGS_STAFF_FUNCTIONS = ['admin_set_app_setting'];
// Admin browser writes (migration 2220): platform owner only copies of the cohort, feedback switch and support preview records.
const ADMIN_MIRROR_FUNCTIONS = ['admin_mirror_cohort', 'admin_mirror_cohort_rename', 'admin_mirror_feedback_enabled', 'admin_mirror_support_preview'];
// A parameter must not let the caller name a person, role, email or organization. (A plain p_status is a progress state.)
const FORBIDDEN_PARAMS = /(^|_)(person|user|uid|auth|email|role|account_status|organization|org)(_|$)/i;

const { db, failed } = await boot();
if (failed) { console.log('FAIL migrations did not apply'); process.exit(1); }

// For testing the audit itself: UTL_AUDIT_EXTRA_SQL=<file> runs extra SQL (a deliberately unsafe function) first.
if (process.env.UTL_AUDIT_EXTRA_SQL) {
  const { readFileSync } = await import('fs');
  await db.exec(readFileSync(process.env.UTL_AUDIT_EXTRA_SQL, 'utf8'));
}

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${!cond && detail ? `  [${detail}]` : ''}`); };

const { rows: fns } = await db.query(`
  select p.oid, p.proname, p.prosecdef, p.prosrc, array_to_string(p.proconfig, ',') as config,
         pg_get_function_identity_arguments(p.oid) as args,
         coalesce(p.proargnames, '{}') as argnames,
         has_function_privilege('anon', p.oid, 'execute') as anon_exec,
         has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'`);

const found = fns.filter((f) => WRITE_FUNCTIONS.includes(f.proname));
console.log(`Write functions present: ${found.length} of ${WRITE_FUNCTIONS.length}\n`);
ok('at least one write function exists to audit', found.length > 0);

for (const f of found) {
  const name = f.proname;
  ok(`${name}: security definer`, f.prosecdef);
  ok(`${name}: search_path fixed to empty`, /search_path=("")?(,|$)/.test(f.config || ''), f.config);
  ok(`${name}: no dynamic sql`, !/\bexecute\b\s+(format|'|\$|quote)/i.test(f.prosrc) && !/^\s*execute\b/im.test(f.prosrc));
  // Either inline, or through the shared helper that is itself checked below.
  const viaHelper = /private\.(require_person_id|pw_person)\(\)/.test(f.prosrc);
  ok(`${name}: resolves the caller from the token`, viaHelper || /private\.current_person_id\(\)/.test(f.prosrc));
  ok(`${name}: refuses a signed-out caller (42501)`, viaHelper || /42501/.test(f.prosrc));
  ok(`${name}: no parameter names a person, role, status or email`, !(f.argnames || []).some((a) => FORBIDDEN_PARAMS.test(a)), (f.argnames || []).join(','));
  ok(`${name}: anon cannot execute`, !f.anon_exec);
  ok(`${name}: authenticated can execute`, f.auth_exec);
  ok(`${name}: does not write to the person table's role or status`, !/update\s+public\.people\s+set[^;]*(account_status|primary_email|auth_uid|supabase_uid)/i.test(f.prosrc));
  ok(`${name}: never touches role_grants, enrollments status or entitlements`, !/(insert\s+into|update|delete\s+from)\s+public\.(role_grants|entitlements|organizations|affiliations)\b/i.test(f.prosrc));
}

// The submit functions: public on purpose, so the checks are about what they must not do.
const submits = fns.filter((f) => SUBMIT_FUNCTIONS.includes(f.proname));
ok('both submit functions exist', submits.length === SUBMIT_FUNCTIONS.length, submits.map((f) => f.proname).join());
for (const f of submits) {
  const name = f.proname;
  ok(`${name}: security definer`, f.prosecdef);
  ok(`${name}: search_path fixed to empty`, /search_path=("")?(,|$)/.test(f.config || ''), f.config);
  ok(`${name}: no dynamic sql`, !/^\s*execute\b/im.test(f.prosrc) && !/\bexecute\b\s+(format|'|\$|quote)/i.test(f.prosrc));
  ok(`${name}: anon and authenticated can execute`, f.anon_exec && f.auth_exec);
  ok(`${name}: the only parameter is one jsonb document (no person, role or email parameter)`, /^\w+ jsonb$/.test(f.args) && !(f.argnames || []).some((a) => FORBIDDEN_PARAMS.test(a)), f.args);
  ok(`${name}: the caller is resolved from the token, never from the input`, /private\.current_person_id\(\)/.test(f.prosrc) && !/p_(lead|feedback)\s*->>?\s*'(person_id|status|is_test)'/.test(f.prosrc));
  ok(`${name}: returns only ok / error, never an id or stored data`, !/returning\b/i.test(f.prosrc) && !/jsonb_build_object\('(id|email|data)'/.test(f.prosrc));
  ok(`${name}: rate limited inside the function`, /rate-limited/.test(f.prosrc));
  ok(`${name}: does not touch roles, entitlements or people`, !/(insert\s+into|update|delete\s+from)\s+public\.(role_grants|entitlements|organizations|affiliations|people)\b/i.test(f.prosrc));
}
// The staff functions: first statement is the platform_owner check with 42501, authenticated only.
const staff = fns.filter((f) => STAFF_FUNCTIONS.includes(f.proname));
ok('all nine staff functions exist', staff.length === STAFF_FUNCTIONS.length, staff.map((f) => f.proname).join());
for (const f of staff) {
  const name = f.proname;
  ok(`${name}: security definer`, f.prosecdef);
  ok(`${name}: search_path fixed to empty`, /search_path=("")?(,|$)/.test(f.config || ''), f.config);
  ok(`${name}: no dynamic sql`, !/^\s*execute\b/im.test(f.prosrc) && !/\bexecute\b\s+(format|'|\$|quote)/i.test(f.prosrc));
  const afterBegin = f.prosrc.slice(f.prosrc.search(/\bbegin\b/i) + 5).trimStart();
  ok(`${name}: first statement refuses anyone but a platform_owner with 42501`, /^if not private\.has_platform_role\(array\['platform_owner'\]\) then\s+raise exception[^;]*errcode = '42501';/i.test(afterBegin), afterBegin.slice(0, 120));
  ok(`${name}: anon cannot execute`, !f.anon_exec);
  ok(`${name}: authenticated can execute`, f.auth_exec);
  if (name === 'admin_cleanup_purge_people') ok(`${name}: fails fast instead of waiting on locks (lock_timeout set)`, /lock_timeout=3s/.test(f.config || ''), f.config);
}
// Every helper added by the inbox migration is closed to browsers, whatever its name.
const inboxHelpers = await db.query(`select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and (p.proname like 'inbox\\_%' or p.proname like 'cleanup\\_%')`);
ok('the five inbox and clean up helpers exist', inboxHelpers.rows.length === 5, String(inboxHelpers.rows.length));
for (const h of inboxHelpers.rows) ok(`private.${h.proname}: closed to browsers`, !h.anon_exec && !h.auth_exec);
// No table of the inbox migration is reachable by a browser.
for (const t of ['leads', 'feedback_submissions']) {
  const g = await db.query(`select (select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and table_name = $1 and grantee in ('anon', 'authenticated', 'PUBLIC')) as grants,
     (select relrowsecurity from pg_class where oid = ('public.' || $1)::regclass) as rls, (select count(*)::int from pg_policies where tablename = $1) as policies`, [t]);
  ok(`${t}: row level security on, no policy, no grant for anon or authenticated`, g.rows[0].rls && g.rows[0].policies === 0 && g.rows[0].grants === 0);
}

// The shared helpers the write functions lean on must themselves do the lookup and the refusal.
for (const helperName of ['require_person_id', 'pw_person']) {
  const helper = await db.query(`select p.prosrc, p.prosecdef, array_to_string(p.proconfig, ',') as config,
      has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = $1`, [helperName]);
  if (!helper.rows.length) continue;
  const h = helper.rows[0];
  ok(`private.${helperName}: uses current_person_id and refuses with 42501`, /private\.current_person_id\(\)/.test(h.prosrc) && /42501/.test(h.prosrc));
  ok(`private.${helperName}: security definer with empty search_path`, h.prosecdef && /search_path=("")?(,|$)/.test(h.config || ''));
  ok(`private.${helperName}: not callable by browsers`, !h.anon_exec && !h.auth_exec);
}

// Every helper added by the write function migrations must be closed to browsers, whatever its name.
const helpers = await db.query(`select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and (p.proname like 'pw\\_%' or p.proname in ('require_person_id', 'resolve_activity', 'open_enrollment_id', 'check_jsonb_object', 'check_key', 'reject_update'))`);
for (const h of helpers.rows) ok(`private.${h.proname}: closed to browsers`, !h.anon_exec && !h.auth_exec || h.proname === 'reject_update');

// The two Executive Signature read functions (migration 2210): read only, caller from the token, no person parameter.
// get_my_person_id (migration 2230): no argument, returns only the caller's own id.
{
  const f = fns.find((x) => x.proname === 'get_my_person_id');
  ok('get_my_person_id: exists, security definer, empty search_path, no argument', !!f && f.prosecdef && /search_path=("")?(,|$)/.test(f.config || '') && f.args === '');
  if (f) {
    ok('get_my_person_id: anon cannot execute, authenticated can', !f.anon_exec && f.auth_exec);
    ok('get_my_person_id: returns the caller from the token and nothing else', /private\.current_person_id\(\)/.test(f.prosrc) && !/\bfrom\s+public\./i.test(f.prosrc));
  }
}
for (const f of fns.filter((x) => ['get_my_es_status', 'get_es_attempt_report'].includes(x.proname))) {
  const name = f.proname;
  ok(`${name}: security definer, search_path fixed to empty, no dynamic sql`, f.prosecdef && /search_path=("")?(,|$)/.test(f.config || '') && !/^\s*execute\b/im.test(f.prosrc));
  ok(`${name}: resolves the caller from the token and refuses a signed out caller`, /private\.require_person_id\(\)/.test(f.prosrc));
  ok(`${name}: takes no parameter that names a person, role, email or organization`, !(f.argnames || []).some((a) => FORBIDDEN_PARAMS.test(a)), (f.argnames || []).join(','));
  ok(`${name}: anon cannot execute, authenticated can`, !f.anon_exec && f.auth_exec);
  ok(`${name}: never writes`, !/\b(insert\s+into|update\s+public|delete\s+from)\b/i.test(f.prosrc));
  ok(`${name}: never reads the raw answer table`, !/assessment_response_parts/.test(f.prosrc));
}

// Settings and access (migration 2200).
for (const name of [...ACCESS_FUNCTIONS, ...SETTINGS_STAFF_FUNCTIONS]) {
  const f = fns.find((x) => x.proname === name);
  ok(`${name}: exists`, Boolean(f));
  if (!f) continue;
  ok(`${name}: security definer`, f.prosecdef);
  ok(`${name}: search_path fixed to empty`, /search_path=("")?(,|$)/.test(f.config || ''), f.config);
  ok(`${name}: no dynamic sql`, !/^\s*execute\b/im.test(f.prosrc) && !/\bexecute\b\s+(format|'|\$|quote)/i.test(f.prosrc));
  ok(`${name}: anon cannot execute, authenticated can`, !f.anon_exec && f.auth_exec);
  ok(`${name}: no parameter names a person, role, status or email`, !(f.argnames || []).some((a) => FORBIDDEN_PARAMS.test(a)), (f.argnames || []).join(','));
}
const access = fns.find((f) => f.proname === 'get_my_access');
if (access) {
  ok('get_my_access: takes no parameter, so a caller can only ever read their own record', access.args === '');
  ok('get_my_access: resolves the person from the token (jwt sub) and writes nothing', /auth\.jwt\(\)/.test(access.prosrc) && !/\b(insert\s+into|update\s+public|delete\s+from)\b/i.test(access.prosrc));
  ok('get_my_access: never raises for a missing person (the browser treats it as no information)', !/raise exception/i.test(access.prosrc));
}
for (const name of SETTINGS_STAFF_FUNCTIONS) {
  const f = fns.find((x) => x.proname === name);
  if (!f) continue;
  const afterBegin = f.prosrc.slice(f.prosrc.search(/\bbegin\b/i) + 5).trimStart();
  ok(`${name}: first statement refuses anyone but a platform_owner with 42501`, /^if not private\.has_platform_role\(array\['platform_owner'\]\) then\s+raise exception[^;]*errcode = '42501';/i.test(afterBegin), afterBegin.slice(0, 120));
  ok(`${name}: only touches app_settings and audit_events`, !/(insert\s+into|update|delete\s+from)\s+public\.(?!app_settings\b|audit_events\b)/i.test(f.prosrc));
}

// Admin browser writes (migration 2220): staff only, first statement is the platform_owner check, authenticated only,
// and each may touch only the tables it is meant to.
const ADMIN_MIRROR_TABLES = {
  admin_mirror_cohort: ['cohorts', 'audit_events'],
  admin_mirror_cohort_rename: ['cohorts', 'enrollments', 'audit_events'],
  admin_mirror_feedback_enabled: ['person_profiles', 'audit_events'],
  admin_mirror_support_preview: ['audit_events']
};
for (const name of ADMIN_MIRROR_FUNCTIONS) {
  const f = fns.find((x) => x.proname === name);
  ok(`${name}: exists`, Boolean(f));
  if (!f) continue;
  ok(`${name}: security definer`, f.prosecdef);
  ok(`${name}: search_path fixed to empty`, /search_path=("")?(,|$)/.test(f.config || ''), f.config);
  ok(`${name}: no dynamic sql`, !/^\s*execute\b/im.test(f.prosrc) && !/\bexecute\b\s+(format|'|\$|quote)/i.test(f.prosrc));
  ok(`${name}: anon cannot execute, authenticated can`, !f.anon_exec && f.auth_exec);
  const afterBegin = f.prosrc.slice(f.prosrc.search(/\bbegin\b/i) + 5).trimStart();
  ok(`${name}: first statement refuses anyone but a platform_owner with 42501`, /^if not private\.has_platform_role\(array\['platform_owner'\]\) then\s+raise exception[^;]*errcode = '42501';/i.test(afterBegin), afterBegin.slice(0, 120));
  const touched = [...f.prosrc.matchAll(/(?:insert\s+into|update|delete\s+from)\s+public\.([a-z_]+)/gi)].map((m) => m[1].toLowerCase());
  ok(`${name}: writes only ${ADMIN_MIRROR_TABLES[name].join(', ')}`, touched.every((t) => ADMIN_MIRROR_TABLES[name].includes(t)), touched.join());
  ok(`${name}: never touches people, role_grants, entitlements or organizations`, !/(insert\s+into|update|delete\s+from)\s+public\.(people|role_grants|entitlements|organizations|affiliations)\b/i.test(f.prosrc));
}

// Nothing else is exposed by accident.
const exposed = fns.filter((f) => f.prosecdef && (f.anon_exec || f.auth_exec));
for (const f of exposed) {
  const allowed = WRITE_FUNCTIONS.includes(f.proname) || PUBLIC_ALLOWLIST.includes(f.proname) || SIGNED_IN_ALLOWLIST.includes(f.proname)
    || SUBMIT_FUNCTIONS.includes(f.proname) || STAFF_FUNCTIONS.includes(f.proname)
    || ACCESS_FUNCTIONS.includes(f.proname) || SETTINGS_STAFF_FUNCTIONS.includes(f.proname) || ADMIN_MIRROR_FUNCTIONS.includes(f.proname);
  ok(`${f.proname}: browser-callable security definer function is on the allowlist`, allowed);
  if (f.anon_exec) ok(`${f.proname}: anon access is intended`, PUBLIC_ALLOWLIST.includes(f.proname) || SUBMIT_FUNCTIONS.includes(f.proname));
  if (STAFF_FUNCTIONS.includes(f.proname)) ok(`${f.proname}: staff function is not callable by anon`, !f.anon_exec);
}
const rollback = fns.find((f) => f.proname === 'rollback_migration_run');
if (rollback) ok('rollback_migration_run is not callable by browsers', !rollback.anon_exec && !rollback.auth_exec);

console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
