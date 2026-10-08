// Tests for migration 2360: the switchboard gets two more flags, es_submit and mail. Loads every migration (2300 and 2360 included).
//   node supabase/switchboard-more-flags-test.mjs
import fs from 'fs';
import { isDeepStrictEqual } from 'util';
import { boot } from './schema-apply-harness.mjs';

const { db, failed } = await boot();
if (failed) { console.log('\nmigrations did not apply, stopping'); process.exit(1); }
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n); };
const q = async (s) => (await db.query(s)).rows;
const codeOf = (e) => e.code || (e.message.match(/\b(\d{2}[0-9A-Z]{3})\b/) || [])[1] || '';
const rejects = async (n, run, code) => {
  try { await run(); ok(n + '  [call succeeded]', false); } catch (e) { const got = codeOf(e); ok(n + '  [' + (got || e.message.slice(0, 60)) + ']', !code || got === code || e.message.includes(code)); }
};
const row = async () => (await q(`select key, visibility, value from app_settings where key = 'switchboard'`))[0];
const sqlSet = (obj) => db.exec(`update app_settings set value = '${JSON.stringify(obj)}'::jsonb where key = 'switchboard'`);
const audit = async () => q(`select detail from audit_events where action = 'switchboard.changed' order by id`);
const migration = fs.readFileSync(new URL('./migrations/20261008002360_switchboard_more_flags.sql', import.meta.url), 'utf8');
const down = fs.readFileSync(new URL('./rollbacks/20261008002360_switchboard_more_flags_down.sql', import.meta.url), 'utf8');
const SIX = { ai: 'firebase', auth: 'firebase', data_source: 'firebase', payments: 'firebase', server_reads: 'firebase', server_writes: 'firebase' };
const EIGHT = { ...SIX, es_submit: 'firebase', mail: 'firebase' };

// ---- the files
ok('the migration has no backslash', !migration.includes('\\'));
ok('the rollback has no backslash', !down.includes('\\'));
ok('both set a lock timeout of 3 seconds', /set local lock_timeout = '3s'/.test(migration) && /set local lock_timeout = '3s'/.test(down));
ok('the migration takes no grant and creates no table', !/\b(grant|create table|drop)\b/i.test(migration.replace(/--.*$/gm, '')));

// ---- after the migrations (2300 then 2360)
ok('the audit table is empty right after the migrations (the migration wrote no change log row)', (await q(`select count(*)::int n from audit_events`))[0].n === 0);
ok('the change log trigger is switched on', (await q(`select tgenabled from pg_trigger where tgname = 'app_settings_switchboard_log'`))[0].tgenabled === 'O');
let r = await row();
ok('the row has all eight flags', isDeepStrictEqual(Object.keys(r.value).sort(), Object.keys(EIGHT).sort()));
ok('every flag, the two new ones included, starts as firebase', isDeepStrictEqual(r.value, EIGHT));
ok('the row is still public', r.visibility === 'public');

// ---- the shape check
for (const [flag, value] of [['es_submit', 'supabase'], ['mail', 'supabase'], ['es_submit', 'firebase'], ['mail', 'firebase']]) {
  await sqlSet({ ...EIGHT, [flag]: value });
  ok(`${flag} = ${value} is accepted`, (await row()).value[flag] === value);
}
await sqlSet(EIGHT);
for (const [flag, value] of [['data_source', 'supabase'], ['auth', 'supabase'], ['payments', 'supabase'], ['ai', 'supabase'], ['server_reads', 'shadow'], ['server_writes', 'shadow']]) {
  await sqlSet({ ...EIGHT, [flag]: value });
  ok(`the old flag ${flag} = ${value} is still accepted`, (await row()).value[flag] === value);
}
await sqlSet(EIGHT);
const before = JSON.stringify((await row()).value);
for (const [name, value] of [
  ['shadow for es_submit', { ...EIGHT, es_submit: 'shadow' }],
  ['shadow for mail', { ...EIGHT, mail: 'shadow' }],
  ['a capital letter for mail', { ...EIGHT, mail: 'Supabase' }],
  ['an empty word for es_submit', { ...EIGHT, es_submit: '' }],
  ['a number for mail', { ...EIGHT, mail: 1 }],
  ['an object for es_submit', { ...EIGHT, es_submit: { on: 'supabase' } }],
  ['a secret as a value', { ...EIGHT, mail: 'sk_live_123' }],
  ['an unknown flag', { ...EIGHT, mystery: 'firebase' }],
  ['a near miss name', { ...EIGHT, email: 'firebase' }],
  ['a secret looking name', { ...EIGHT, mail_api_key: 'firebase' }]
]) await rejects(`${name} is refused`, () => sqlSet(value), '22023');
ok('after all those refusals the row is unchanged', JSON.stringify((await row()).value) === before);
ok('a row with only the old six flags is still accepted (missing flags count as firebase)', await sqlSet(SIX).then(() => true, () => false));
await sqlSet(EIGHT);

// ---- applying the migration again never resets a flag
await sqlSet({ ...EIGHT, es_submit: 'supabase', mail: 'supabase', ai: 'supabase' });
const logBefore = (await audit()).length;
await db.exec(migration);
r = await row();
ok('applying it again keeps a flipped es_submit', r.value.es_submit === 'supabase');
ok('and a flipped mail', r.value.mail === 'supabase');
ok('and a flipped old flag', r.value.ai === 'supabase');
ok('and writes no change log row', (await audit()).length === logBefore);
ok('and still one row', (await q(`select count(*)::int n from app_settings where key = 'switchboard'`))[0].n === 1);

// ---- a row from before 2360 (six flags) gets the two new flags as firebase and keeps its other values
await db.exec(`alter table app_settings disable trigger app_settings_switchboard_check`);
await sqlSet({ ...SIX, auth: 'supabase', server_reads: 'shadow' });
await db.exec(`alter table app_settings enable trigger app_settings_switchboard_check`);
const logSix = (await audit()).length;
await db.exec(migration);
r = await row();
ok('a six flag row gains es_submit and mail as firebase', r.value.es_submit === 'firebase' && r.value.mail === 'firebase');
ok('and keeps the flags that were flipped', r.value.auth === 'supabase' && r.value.server_reads === 'shadow');
ok('the migration writes no change log row (adding the names is a schema step, not a flip)', (await audit()).length === logSix);
ok('the change log trigger is switched on again', (await q(`select tgenabled from pg_trigger where tgname = 'app_settings_switchboard_log'`))[0].tgenabled === 'O');
await sqlSet({ ...SIX, auth: 'firebase', es_submit: 'firebase', mail: 'firebase' });
ok('and a flip afterwards is logged as before', (await audit()).length === logSix + 1);

// ---- only one of the two flags present: the present one is kept, the other is added
await db.exec(`alter table app_settings disable trigger app_settings_switchboard_check`);
await sqlSet({ ...SIX, mail: 'supabase' });
await db.exec(`alter table app_settings enable trigger app_settings_switchboard_check`);
await db.exec(migration);
r = await row();
ok('a row with only mail keeps mail and gains es_submit', r.value.mail === 'supabase' && r.value.es_submit === 'firebase');
await sqlSet(EIGHT);

// ---- the function keeps its closed doors
const fn = (await q(`select p.prosecdef, array_to_string(p.proconfig, ',') as config, p.prosrc,
   has_function_privilege('anon', p.oid, 'execute') as a, has_function_privilege('authenticated', p.oid, 'execute') as u
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'switchboard_check'`));
ok('exactly one switchboard_check, closed to browsers, with an empty search path', fn.length === 1 && !fn[0].a && !fn[0].u && /search_path=("")?(,|$)/.test(fn[0].config));
ok('the trigger is still attached', (await q(`select count(*)::int n from pg_trigger where tgname = 'app_settings_switchboard_check'`))[0].n === 1);
ok('the new check lists es_submit and mail', fn[0].prosrc.includes("'es_submit'") && fn[0].prosrc.includes("'mail'"));

// ---- the rollback
await sqlSet({ ...EIGHT, es_submit: 'supabase', mail: 'supabase', ai: 'supabase' });
await db.exec(down);
r = await row();
ok('the rollback takes the two flags out, whatever they held', isDeepStrictEqual(Object.keys(r.value).sort(), Object.keys(SIX).sort()));
ok('and keeps every other flag as it was', r.value.ai === 'supabase' && r.value.auth === 'firebase');
const fn2 = (await q(`select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'switchboard_check'`));
ok('the check is back to six names', fn2.length === 1 && !fn2[0].prosrc.includes("'es_submit'") && fn2[0].prosrc.includes("'ai']"));
await rejects('es_submit is refused again', () => sqlSet({ ...SIX, es_submit: 'supabase' }), '22023');
await rejects('mail is refused again', () => sqlSet({ ...SIX, mail: 'supabase' }), '22023');
ok('the six flags still work', await sqlSet({ ...SIX, ai: 'firebase' }).then(() => true, () => false));
ok('the row and both triggers are still there', !!(await row()) && (await q(`select count(*)::int n from pg_trigger where tgname like 'app_settings_switchboard%'`))[0].n === 2);
ok('and both are switched on (the rollback leaves the change log trigger enabled)', (await q(`select count(*)::int n from pg_trigger where tgname like 'app_settings_switchboard%' and tgenabled = 'O'`))[0].n === 2);
await db.exec(down);
ok('the rollback can run twice', true);

// ---- and the migration applies again
await db.exec(migration);
r = await row();
ok('re-applying adds the two flags as firebase', isDeepStrictEqual(r.value, { ...SIX, ai: 'firebase', es_submit: 'firebase', mail: 'firebase' }));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
