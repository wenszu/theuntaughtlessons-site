// Tests for migration 2290: private.apply_stripe_payment (and its service role wrapper), and the rollback.
//   node supabase/stripe-payment-test.mjs
// Covers: who may execute it, the happy path for both programs, idempotency (a replay changes nothing), the
// transaction (a failure after the marker leaves nothing behind, so a Stripe retry starts clean), input checks,
// and that no email or name reaches the audit trail.
import fs from 'fs';
import { boot } from './schema-apply-harness.mjs';

const { db, failed } = await boot();
if (failed) { console.log('\nmigrations did not apply, stopping'); process.exit(1); }
let pass = 0, fail = 0;
const ok = (n, c, detail = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, !c && detail ? `[${detail}]` : ''); };
const count = async (sql) => (await db.query(`select count(*)::int n from ${sql}`)).rows[0].n;
const apply = async (session) => (await db.query('select private.apply_stripe_payment($1::jsonb) as r', [JSON.stringify(session)])).rows[0].r;
const applyError = async (session) => {
  try { await apply(session); return null; } catch (e) { return e; }
};
const as = async (role, sql, claims) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${claims ? JSON.stringify(claims) : ''}', false);`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
};

const HINT = '11111111-2222-4333-8444-555555555555';
const base = (over) => Object.assign({ id: 'cs_test_a1B2c3D4e5', program: 'executive-signature', email: 'buyer@example.test', amount_total: 4900, currency: 'usd', payment_status: 'paid', person_id_hint: HINT }, over || {});

// ---- who may execute ----
const fn = (await db.query(`select p.prosecdef, array_to_string(p.proconfig, ',') as config, n.nspname,
    has_function_privilege('anon', p.oid, 'execute') as anon_exec,
    has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
    has_function_privilege('service_role', p.oid, 'execute') as service_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = 'apply_stripe_payment' order by n.nspname`)).rows;
ok('both the private function and the public wrapper exist', fn.length === 2 && fn[0].nspname === 'private' && fn[1].nspname === 'public');
for (const f of fn) {
  ok(`${f.nspname}.apply_stripe_payment: security definer with an empty search_path`, f.prosecdef && /search_path=("")?(,|$)/.test(f.config || ''));
  ok(`${f.nspname}.apply_stripe_payment: anon and authenticated cannot execute, the service role can`, !f.anon_exec && !f.auth_exec && f.service_exec);
}
const prosrc = (await db.query(`select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'apply_stripe_payment'`)).rows[0].prosrc;
ok('no dynamic sql in the function', !/^\s*execute\b/im.test(prosrc) && !/\bexecute\b\s+(format|'|\$|quote)/i.test(prosrc));
ok('the migration file has no backslash', !fs.readFileSync(new URL('./migrations/20261008002290_stripe_payment.sql', import.meta.url), 'utf8').includes('\\'));
let anonRefused = false, authRefused = false;
try { await as('anon', `select public.apply_stripe_payment('{}'::jsonb)`); } catch (e) { anonRefused = /permission denied/.test(e.message); }
try { await as('authenticated', `select public.apply_stripe_payment('{}'::jsonb)`); } catch (e) { authRefused = /permission denied/.test(e.message); }
ok('anon is refused at the wrapper', anonRefused);
ok('authenticated is refused at the wrapper', authRefused);
const viaWrapper = await as('service_role', `select public.apply_stripe_payment('{"id":"cs_test_wrapper1","program":"tsa","email":"wrap@example.test","payment_status":"paid"}'::jsonb) as r`);
ok('the service role can call the wrapper', viaWrapper[0].r.status === 'processed');

// ---- the assessment definition the entitlement points at must exist ----
const snap0 = async () => ({ m: await count('stripe_processed_sessions'), e: await count('entitlements'), a: await count('audit_events'), p: await count('people') });
const missingBefore = JSON.stringify(await snap0());
const missingErr = await applyError(base({ id: 'cs_test_nodef001', email: 'nodef@example.test' }));
ok('without the full-assessment definition the call fails clearly', !!missingErr && /full-assessment definition is missing/.test(missingErr.message));
ok('and leaves nothing behind (no marker, no person)', JSON.stringify(await snap0()) === missingBefore);
await db.exec(`insert into assessment_definitions (id, program_id, title, status) values ('full-assessment', 'executive-signature', 'Executive Signature full assessment', 'live')`);

// ---- Executive Signature, a buyer with no person row yet ----
const people0 = await count('people');
let r = await apply(base());
ok('processed', r.status === 'processed' && r.program === 'executive-signature');
ok('a new person is created with the hint id and the lower case email', (await db.query(`select id, primary_email::text as e, account_status from people where primary_email = 'buyer@example.test'`)).rows[0].id === HINT);
ok('one new person and one active email row', (await count('people')) === people0 + 1 && (await count(`person_emails where person_id = '${HINT}' and status = 'active' and email = 'buyer@example.test'`)) === 1);
const ent = (await db.query(`select * from entitlements where person_id = '${HINT}'`)).rows;
ok('exactly one entitlement: full-assessment, paid, active, no retakes, reference stripe:<session>',
  ent.length === 1 && ent[0].program_id === 'executive-signature' && ent[0].assessment_id === 'full-assessment' && ent[0].access_type === 'paid'
  && ent[0].status === 'active' && ent[0].retakes_allowed === 0 && ent[0].payment_reference === 'stripe:cs_test_a1B2c3D4e5' && ent[0].report_available === false);
const marker = (await db.query(`select * from stripe_processed_sessions where session_id = 'cs_test_a1B2c3D4e5'`)).rows;
ok('the processed marker holds program, email and the person', marker.length === 1 && marker[0].program_id === 'executive-signature' && marker[0].email === 'buyer@example.test' && marker[0].person_id === HINT);
const sr = (await db.query(`select * from service_requests`)).rows.filter((x) => x.operation === 'grantEntitlement');
ok('one grantEntitlement service request with the Firebase style id (64 hex)', sr.length >= 1 && sr.some((x) => /^[0-9a-f]{64}$/.test(x.id) && x.result.entitlementId === ent[0].id));
const audit = (await db.query(`select * from audit_events where action = 'checkout_session_completed' and person_id = '${HINT}'`)).rows;
ok('one audit row with counts and amounts', audit.length === 1 && audit[0].detail.rows.entitlements === 1 && audit[0].detail.rows.people === 1 && audit[0].detail.amountTotal === 4900 && audit[0].detail.currency === 'usd');
ok('the audit row says it matched by email and the amount equals the default price', audit[0].detail.matched_by === 'email' && audit[0].detail.amount_matches_setting === true);
ok('the audit row holds no email and no name', !/buyer@example\.test|buyer/i.test(JSON.stringify(audit[0])), JSON.stringify(audit[0]));
ok('the result holds no email', !/buyer@example\.test/.test(JSON.stringify(r)));

// ---- idempotency ----
const before = { p: await count('people'), e: await count('entitlements'), m: await count('stripe_processed_sessions'), s: await count('service_requests'), a: await count('audit_events'), n: await count('enrollments') };
r = await apply(base());
ok('a replay reports already_processed', r.status === 'already_processed');
ok('a replay changes nothing anywhere', before.p === await count('people') && before.e === await count('entitlements') && before.m === await count('stripe_processed_sessions')
  && before.s === await count('service_requests') && before.a === await count('audit_events') && before.n === await count('enrollments'));
r = await apply(base({ email: 'someone.else@example.test', program: 'tsa' }));
ok('the same session id with other contents is still a no-op (the session id is the key)', r.status === 'already_processed' && (await count('people')) === before.p);

// ---- an existing person is reused (email case and spaces ignored) ----
const CAROL = '00000000-0000-0000-0000-0000000000c1';
await db.exec(`insert into people (id, auth_uid, primary_email) values ('${CAROL}', 'fb_carol', 'carol@example.test')`);
const peopleBefore = await count('people');
r = await apply(base({ id: 'cs_test_carol0001', email: '  Carol@Example.TEST ', person_id_hint: undefined }));
ok('an existing person is found by email, not duplicated', r.status === 'processed' && (await count('people')) === peopleBefore && (await count(`entitlements where person_id = '${CAROL}'`)) === 1);
ok('the existing person keeps their sign in link', (await db.query(`select auth_uid from people where id = '${CAROL}'`)).rows[0].auth_uid === 'fb_carol');
// A second purchase by the same person is a second entitlement (a different session), as before.
r = await apply(base({ id: 'cs_test_carol0002', email: 'carol@example.test' }));
ok('a different session by the same person adds its own entitlement', r.status === 'processed' && (await count(`entitlements where person_id = '${CAROL}'`)) === 2);
// A buyer found through an old (active) email row.
const DAN = '00000000-0000-0000-0000-0000000000d1';
await db.exec(`insert into people (id, primary_email) values ('${DAN}', 'dan.new@example.test'); insert into person_emails (person_id, email, status) values ('${DAN}', 'dan.old@example.test', 'active')`);
r = await apply(base({ id: 'cs_test_dan00001', email: 'dan.old@example.test' }));
ok('a buyer is found through an active email row of a person', r.status === 'processed' && (await count(`entitlements where person_id = '${DAN}'`)) === 1);

// ---- TSA ----
r = await apply(base({ id: 'cs_test_tsa00001', program: 'tsa', email: 'tsa.buyer@example.test', amount_total: 19900, person_id_hint: undefined }));
const tsaPerson = (await db.query(`select id from people where primary_email = 'tsa.buyer@example.test'`)).rows[0].id;
const enr = (await db.query(`select * from enrollments where person_id = '${tsaPerson}'`)).rows;
ok('TSA creates an active enrollment, no entitlement', r.status === 'processed' && enr.length === 1 && enr[0].program_id === 'tsa' && enr[0].status === 'active' && (await count(`entitlements where person_id = '${tsaPerson}'`)) === 0);
ok('the enrollment says it came from the purchase, has a joined date and says nothing about the retired Google Group', enr[0].source.origin === 'stripe_self_guided_purchase' && enr[0].source.stripeSessionId === 'cs_test_tsa00001' && !('googleGroup' in enr[0].source) && !('followUp' in enr[0].source) && enr[0].joined_at !== null);
const tsaAudit = (await db.query(`select detail from audit_events where person_id = '${tsaPerson}'`)).rows;
ok('the TSA audit event has no email and no Google Group note, and the amount matches the TSA default price', tsaAudit.length === 1 && !/tsa\.buyer|group/i.test(JSON.stringify(tsaAudit[0])) && tsaAudit[0].detail.amount_matches_setting === true);
// A member who is already enrolled keeps their enrollment (and status); the purchase is added to the record.
const EVA = '00000000-0000-0000-0000-0000000000e1';
await db.exec(`insert into people (id, primary_email) values ('${EVA}', 'eva@example.test');
  insert into enrollments (person_id, program_id, status, source, notes) values ('${EVA}', 'tsa', 'active', '{"addedBy":"admin@example.test"}'::jsonb, 'keep me')`);
r = await apply(base({ id: 'cs_test_tsa00002', program: 'tsa', email: 'eva@example.test' }));
const evaRows = (await db.query(`select * from enrollments where person_id = '${EVA}'`)).rows;
ok('an enrolled member gets no second enrollment; their record keeps its fields and gains the purchase', evaRows.length === 1 && evaRows[0].notes === 'keep me' && evaRows[0].source.addedBy === 'admin@example.test' && evaRows[0].source.stripeSessionId === 'cs_test_tsa00002');
// A revoked member is not reopened by a payment.
const FAY = '00000000-0000-0000-0000-0000000000f1';
await db.exec(`insert into people (id, primary_email) values ('${FAY}', 'fay@example.test'); insert into enrollments (person_id, program_id, status) values ('${FAY}', 'tsa', 'revoked')`);
r = await apply(base({ id: 'cs_test_tsa00003', program: 'tsa', email: 'fay@example.test' }));
ok('a revoked enrollment is left alone and flagged for a person to review', r.status === 'processed' && r.flag === 'revoked_enrollment_needs_review'
  && (await count(`enrollments where person_id = '${FAY}'`)) === 1 && (await count(`enrollments where person_id = '${FAY}' and status = 'revoked'`)) === 1);
// A finished enrollment is followed by a new active one.
const GUS = '00000000-0000-0000-0000-0000000000a9';
await db.exec(`insert into people (id, primary_email) values ('${GUS}', 'gus@example.test'); insert into enrollments (person_id, program_id, status) values ('${GUS}', 'tsa', 'completed')`);
r = await apply(base({ id: 'cs_test_tsa00004', program: 'tsa', email: 'gus@example.test' }));
ok('a finished enrollment is kept as history and a new active one is added', r.status === 'processed' && (await count(`enrollments where person_id = '${GUS}'`)) === 2 && (await count(`enrollments where person_id = '${GUS}' and status = 'active'`)) === 1);

// ---- the transaction: a failure after the marker leaves nothing behind ----
const HAL = '00000000-0000-0000-0000-0000000000b1';
await db.exec(`insert into people (id, auth_uid, primary_email, account_status) values ('${HAL}', 'fb_hal', 'hal@example.test', 'archived')`);
const snapshot = async () => ({ m: await count('stripe_processed_sessions'), e: await count('entitlements'), a: await count('audit_events'), s: await count('service_requests'), p: await count('people'), n: await count('enrollments') });
let s0 = await snapshot();
let err = await applyError(base({ id: 'cs_test_hal00001', email: 'hal@example.test' }));
ok('an archived account is refused for the Executive Signature', !!err && /cannot receive/.test(err.message));
ok('the refusal leaves no marker and no row (everything rolled back)', JSON.stringify(await snapshot()) === JSON.stringify(s0));

// A failure at the very last step (the audit insert) after a person, an entitlement and a marker were written.
await db.exec(`create function public.test_boom() returns trigger language plpgsql as $$ begin raise exception 'forced failure'; end $$;
  create trigger boom before insert on public.audit_events for each row execute function public.test_boom();`);
s0 = await snapshot();
err = await applyError(base({ id: 'cs_test_boom0001', email: 'newbuyer@example.test', person_id_hint: undefined }));
ok('a forced failure at the last step is raised to the caller', !!err && /forced failure/.test(err.message));
ok('the person, email row, entitlement, request and marker were all rolled back', JSON.stringify(await snapshot()) === JSON.stringify(s0)
  && (await count(`people where primary_email = 'newbuyer@example.test'`)) === 0);
await db.exec('drop trigger boom on public.audit_events; drop function public.test_boom()');
r = await apply(base({ id: 'cs_test_boom0001', email: 'newbuyer@example.test', person_id_hint: undefined }));
ok('the Stripe retry of the same session then succeeds, once', r.status === 'processed' && (await count(`entitlements where payment_reference = 'stripe:cs_test_boom0001'`)) === 1);

// ---- unpaid and bad input ----
s0 = await snapshot();
r = await apply(base({ id: 'cs_test_unpaid001', payment_status: 'unpaid', email: 'unpaid@example.test' }));
ok('an unpaid session is ignored and writes nothing', r.status === 'ignored_not_paid' && JSON.stringify(await snapshot()) === JSON.stringify(s0));
r = await apply(base({ id: 'cs_test_nopay0001', payment_status: 'no_payment_required', email: 'free@example.test' }));
ok('a session with no payment required grants nothing', r.status === 'ignored_not_paid' && JSON.stringify(await snapshot()) === JSON.stringify(s0));
r = await apply(base({ id: 'cs_test_nostat001', payment_status: undefined, email: 'nostatus@example.test' }));
ok('a session with no payment status grants nothing', r.status === 'ignored_not_paid' && JSON.stringify(await snapshot()) === JSON.stringify(s0));
r = await apply(base({ id: 'cs_test_hint00001', email: 'free@example.test' }));
ok('a hint id already used by another person gets a fresh id', r.status === 'processed'
  && (await db.query(`select id from people where primary_email = 'free@example.test'`)).rows[0].id !== HINT);
const bad = [
  ['null', null], ['an array', []], ['a string', 'x'],
  ['no id', base({ id: undefined })], ['id not cs_', base({ id: 'pi_123456' })], ['id with a space', base({ id: 'cs_test x' })], ['id too long', base({ id: 'cs_' + 'a'.repeat(400) })],
  ['unknown program', base({ id: 'cs_test_bad00001', program: 'doc' })], ['program is a number', base({ id: 'cs_test_bad00002', program: 5 })],
  ['no email', base({ id: 'cs_test_bad00003', email: undefined })], ['email without a domain', base({ id: 'cs_test_bad00004', email: 'nobody' })],
  ['email with a space', base({ id: 'cs_test_bad00005', email: 'a b@example.test' })],
  ['negative amount', base({ id: 'cs_test_bad00006', amount_total: -5 })], ['amount as text', base({ id: 'cs_test_bad00007', amount_total: '49' })],
  ['currency in capitals', base({ id: 'cs_test_bad00008', currency: 'USD' })], ['unknown payment status', base({ id: 'cs_test_bad00009', payment_status: 'maybe' })],
  ['bad hint', base({ id: 'cs_test_bad00010', person_id_hint: 'not-a-uuid' })], ['extra key', base({ id: 'cs_test_bad00011', role: 'platform_owner' })]
];
s0 = await snapshot();
for (const [name, value] of bad) {
  const e = await applyError(value === null || typeof value !== 'object' || Array.isArray(value) ? value : value);
  ok(`bad input is refused: ${name}`, !!e && /invalid payment/.test(e.message), e && e.message);
}
ok('all the refused inputs wrote nothing', JSON.stringify(await snapshot()) === JSON.stringify(s0));
const sqlNull = await db.query(`select private.apply_stripe_payment(null) as r`).then(() => null, (e) => e);
ok('a database null is refused', !!sqlNull && /invalid payment/.test(sqlNull.message));

// ---- the session is bound to the signed in person ----
const IVY = '00000000-0000-0000-0000-0000000000a1';
const JON = '00000000-0000-0000-0000-0000000000a2';
await db.exec(`insert into people (id, auth_uid, primary_email) values ('${IVY}', 'fb_ivy', 'ivy@example.test'), ('${JON}', 'fb_jon', 'jon@example.test')`);
s0 = await snapshot();
r = await apply(base({ id: 'cs_test_bound0001', email: 'jon@example.test', person_id: IVY }));
ok('a bound session gives the purchase to the bound person even when another person owns the typed email',
  r.status === 'processed' && (await count(`entitlements where person_id = '${IVY}'`)) === 1 && (await count(`entitlements where person_id = '${JON}'`)) === 0);
ok('and creates no person, and the marker points at the bound person', (await count('people')) === s0.p && (await db.query(`select person_id from stripe_processed_sessions where session_id = 'cs_test_bound0001'`)).rows[0].person_id === IVY);
ok('the audit row says it matched by person id', (await db.query(`select detail from audit_events where person_id = '${IVY}' and action = 'checkout_session_completed'`)).rows[0].detail.matched_by === 'person_id');
r = await apply(base({ id: 'cs_test_bound0002', email: 'typed.somewhere.else@example.test', person_id: IVY, program: 'tsa', amount_total: 19900 }));
ok('a bound TSA session with an unknown typed email creates no new person and enrolls the bound person', r.status === 'processed' && (await count('people')) === s0.p
  && (await count(`enrollments where person_id = '${IVY}' and program_id = 'tsa'`)) === 1 && (await count(`people where primary_email = 'typed.somewhere.else@example.test'`)) === 0);
// An unbound session (no person id) still goes by email.
r = await apply(base({ id: 'cs_test_unbound01', email: 'jon@example.test' }));
ok('a session without a person id is matched by email as before', r.status === 'processed' && (await count(`entitlements where person_id = '${JON}'`)) === 1);
// A bound person that does not exist, or whose account is not active.
s0 = await snapshot();
err = await applyError(base({ id: 'cs_test_bound0003', email: 'jon@example.test', person_id: '99999999-9999-4999-8999-999999999999' }));
ok('a person id that does not exist is an error (never falls back to the typed email)', !!err && /buyer record was not found/.test(err.message) && JSON.stringify(await snapshot()) === JSON.stringify(s0));
err = await applyError(base({ id: 'cs_test_bound0004', email: 'jon@example.test', person_id: HAL }));
ok('a bound person whose account is archived is refused, and nothing is kept', !!err && /cannot receive/.test(err.message) && JSON.stringify(await snapshot()) === JSON.stringify(s0));
err = await applyError(base({ id: 'cs_test_bound0005', email: 'jon@example.test', person_id: 'nope' }));
ok('a malformed person id is refused', !!err && /invalid payment/.test(err.message));

// ---- archived accounts are refused for TSA too ----
err = await applyError(base({ id: 'cs_test_halt0001', program: 'tsa', email: 'hal@example.test' }));
ok('an archived account is refused for TSA with the same kind of error as Executive Signature', !!err && /cannot receive/.test(err.message) && JSON.stringify(await snapshot()) === JSON.stringify(s0));
const KIM = '00000000-0000-0000-0000-0000000000a3';
await db.exec(`insert into people (id, primary_email, account_status) values ('${KIM}', 'kim@example.test', 'restricted')`);
r = await apply(base({ id: 'cs_test_kim00001', program: 'tsa', email: 'kim@example.test' }));
ok('a restricted account can still receive a purchase', r.status === 'processed');

// ---- amount_matches_setting is a flag only ----
r = await apply(base({ id: 'cs_test_amt00001', email: 'amt1@example.test', amount_total: 1 }));
ok('a wrong amount is still granted (flag only)', r.status === 'processed');
ok('and the flag says it does not match', (await db.query(`select detail from audit_events where detail ->> 'sessionId' = 'cs_test_amt00001'`)).rows[0].detail.amount_matches_setting === false);
r = await apply(base({ id: 'cs_test_amt00002', email: 'amt2@example.test', currency: 'eur' }));
ok('a different currency does not match', (await db.query(`select detail from audit_events where detail ->> 'sessionId' = 'cs_test_amt00002'`)).rows[0].detail.amount_matches_setting === false);
r = await apply(base({ id: 'cs_test_amt00003', email: 'amt3@example.test', amount_total: undefined }));
ok('an unknown amount gives an unknown flag (null)', (await db.query(`select detail from audit_events where detail ->> 'sessionId' = 'cs_test_amt00003'`)).rows[0].detail.amount_matches_setting === null);
await db.exec(`update app_settings set value = '{"enabled": true, "prices": {"executive-signature": {"amountCents": 7700, "currency": "usd", "label": "ES"}}}'::jsonb where key = 'payments'`);
r = await apply(base({ id: 'cs_test_amt00004', email: 'amt4@example.test', amount_total: 7700 }));
ok('the stored price in app_settings is the one compared', (await db.query(`select detail from audit_events where detail ->> 'sessionId' = 'cs_test_amt00004'`)).rows[0].detail.amount_matches_setting === true);
r = await apply(base({ id: 'cs_test_amt00005', email: 'amt5@example.test', amount_total: 4900 }));
ok('and the old default no longer matches', (await db.query(`select detail from audit_events where detail ->> 'sessionId' = 'cs_test_amt00005'`)).rows[0].detail.amount_matches_setting === false);
await db.exec(`update app_settings set value = '{}'::jsonb where key = 'payments'`);

// ---- get_my_checkout_identity ----
const idFn = (await db.query(`select p.prosecdef, array_to_string(p.proconfig, ',') as config, pg_get_function_arguments(p.oid) as args,
    has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_my_checkout_identity'`)).rows[0];
ok('get_my_checkout_identity: security definer, empty search_path, no argument', !!idFn && idFn.prosecdef && /search_path=("")?(,|$)/.test(idFn.config || '') && idFn.args === '');
ok('get_my_checkout_identity: authenticated only', !idFn.anon_exec && idFn.auth_exec);
const identity = (await as('authenticated', 'select public.get_my_checkout_identity() as r', { sub: 'fb_ivy', role: 'authenticated' }))[0].r;
ok('a member gets their own person id and email', identity.person_id === IVY && identity.email === 'ivy@example.test');
ok('another member gets their own, not the first one\'s', (await as('authenticated', 'select public.get_my_checkout_identity() as r', { sub: 'fb_jon', role: 'authenticated' }))[0].r.person_id === JON);
ok('an unknown token gets null', (await as('authenticated', 'select public.get_my_checkout_identity() as r', { sub: 'fb_nobody', role: 'authenticated' }))[0].r === null);
ok('no claims at all gets null', (await as('authenticated', 'select public.get_my_checkout_identity() as r', null))[0].r === null);
ok('an archived account gets null', (await as('authenticated', 'select public.get_my_checkout_identity() as r', { sub: 'fb_hal', role: 'authenticated' }))[0].r === null);
let idAnon = false;
try { await as('anon', 'select public.get_my_checkout_identity()', { role: 'anon' }); } catch (e) { idAnon = /permission denied/.test(e.message); }
ok('anon is refused', idAnon);

// ---- rollback ----
await db.exec(fs.readFileSync(new URL('./rollbacks/20261008002290_stripe_payment_down.sql', import.meta.url), 'utf8'));
ok('the rollback removes the functions and keeps the data', (await count(`pg_proc where proname in ('apply_stripe_payment', 'get_my_checkout_identity')`)) === 0 && (await count('stripe_processed_sessions')) > 0);
await db.exec(fs.readFileSync(new URL('./migrations/20261008002290_stripe_payment.sql', import.meta.url), 'utf8'));
r = await apply(base({ id: 'cs_test_again0001', email: 'again@example.test' }));
ok('the migration applies again after the rollback', r.status === 'processed');

console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
