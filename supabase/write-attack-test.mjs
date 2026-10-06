// Independent attack test for the browser write functions. Written separately from the builders' own tests.
// Bob (a second signed-in learner) and an anonymous caller try to read, overwrite or impersonate Alice
// through every write function. Alice's rows are fingerprinted before and after and must not change.
//
//   UTL_BASE_ONLY=20261006001500 UTL_EXTRA_MIGRATIONS=20261006001600,20261006001700 node supabase/write-attack-test.mjs
//   (or with every migration: node supabase/write-attack-test.mjs)
import { boot } from './schema-apply-harness.mjs';

const { db, failed } = await boot();
if (failed) { console.log('FAIL migrations did not apply'); process.exit(1); }

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${!cond && detail ? `  [${detail}]` : ''}`); };
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

async function as(role, sub, sql) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', ${sub ? lit(JSON.stringify({ sub, role: role === 'anon' ? 'anon' : 'authenticated' })) : "''"}, false);`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
}
async function refused(name, role, sub, sql, expectCode) {
  try { await as(role, sub, sql); ok(name, false, 'call succeeded'); }
  catch (e) {
    const code = e.code || '';
    ok(name, expectCode ? code === expectCode : true, `${code} ${String(e.message).slice(0, 80)}`);
  }
}
const q = async (sql) => (await db.query(sql)).rows;
const exists = async (name) => (await q(`select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '${name}'`)).length > 0;

const ALICE = '00000000-0000-0000-0000-0000000000a1';
const BOB = '00000000-0000-0000-0000-0000000000b2';
await db.exec(`
  insert into people (id, auth_uid, primary_email) values ('${ALICE}', 'fb_alice', 'alice@a.com'), ('${BOB}', 'fb_bob', 'bob@a.com');
  insert into activities (id, program_id, title) values ('p1-e1', 'tsa', 'Grocery list'), ('p1-e2', 'tsa', 'Second');
  insert into activity_keys (key, activity_id) values ('grocery-list', 'p1-e1');
  insert into enrollments (person_id, program_id, status) values ('${ALICE}', 'tsa', 'active'), ('${BOB}', 'tsa', 'active');
`);

// Everything Alice owns, as one fingerprint.
const fingerprint = async () => (await q(`
  select md5(concat_ws('|',
    (select coalesce(string_agg(md5(t::text), ',' order by t.id), '') from activity_submissions t where t.person_id = '${ALICE}'),
    (select coalesce(string_agg(md5(t::text), ',' order by t.id), '') from activity_attempts t where t.person_id = '${ALICE}'),
    (select coalesce(string_agg(md5(t::text), ',' order by t.activity_id), '') from activity_progress t where t.person_id = '${ALICE}'),
    (select coalesce(string_agg(md5(t::text), ',' order by t.activity_id), '') from activity_drafts t where t.person_id = '${ALICE}'),
    (select coalesce(md5(p::text), '') from people p where p.id = '${ALICE}'),
    (select coalesce(md5(pp::text), '') from person_profiles pp where pp.person_id = '${ALICE}'),
    (select coalesce(string_agg(md5(t::text), ',' order by t.entry_key), '') from reward_ledger t where t.person_id = '${ALICE}'),
    (select coalesce(md5(t::text), '') from reward_state t where t.person_id = '${ALICE}' limit 1)
  )) as f`))[0].f;

if (await exists('record_activity_submission')) {
  // Alice does real work first.
  await as('authenticated', 'fb_alice', `select save_activity_draft('p1-e1', '{"text":"alice draft"}'::jsonb)`);
  await as('authenticated', 'fb_alice', `select record_activity_submission('grocery-list', 'sub-alice-1', 1, now(), 100, '{"a":1}'::jsonb)`);
  await as('authenticated', 'fb_alice', `select record_activity_attempt('p1-e1', 'attempt-alice-1', 1, 8, 10, 60)`);
  const before = await fingerprint();

  // Bob acts on the same activities, with the same keys, and with hostile input.
  await as('authenticated', 'fb_bob', `select record_activity_submission('p1-e1', 'sub-alice-1', 1, now(), 5, '{"b":1}'::jsonb)`);
  await as('authenticated', 'fb_bob', `select record_activity_attempt('p1-e1', 'attempt-alice-1', 1, 1, 10, 5)`);
  await as('authenticated', 'fb_bob', `select save_activity_draft('p1-e1', '{"text":"bob overwrote?"}'::jsonb)`);
  await as('authenticated', 'fb_bob', `select mark_activity_progress('p1-e1', 'visited')`);
  await as('authenticated', 'fb_bob', `select clear_activity_draft('p1-e1')`);
  ok('Alice is unchanged after Bob uses the same activity and the same keys', (await fingerprint()) === before);
  ok('Bob got his own submission row, not Alice\'s', (await q(`select count(*)::int n from activity_submissions where person_id = '${BOB}'`))[0].n === 1);
  ok('the same key under two people makes two rows', (await q(`select count(*)::int n from activity_submissions where submission_key = 'sub-alice-1'`))[0].n === 2);
  ok('Bob cannot read Alice through the tables', (await as('authenticated', 'fb_bob', `select count(*)::int n from activity_submissions where person_id = '${ALICE}'`))[0].n === 0);
  ok('Bob cannot read Alice\'s draft', (await as('authenticated', 'fb_bob', `select count(*)::int n from activity_drafts where person_id = '${ALICE}'`))[0].n === 0);

  // Direct table writes are refused for browsers, whoever they are.
  await refused('Bob cannot insert a submission directly', 'authenticated', 'fb_bob', `insert into activity_submissions (person_id, activity_id, program_id, submission_key, completed_at) values ('${ALICE}', 'p1-e1', 'tsa', 'x', now())`, '42501');
  await refused('Bob cannot update Alice\'s progress directly', 'authenticated', 'fb_bob', `update activity_progress set status = 'not_started' where person_id = '${ALICE}'`, '42501');
  await refused('Bob cannot delete Alice\'s draft directly', 'authenticated', 'fb_bob', `delete from activity_drafts where person_id = '${ALICE}'`, '42501');

  // Hostile input never becomes SQL and never reaches another person.
  await refused('SQL in the activity id is just an unknown activity', 'authenticated', 'fb_bob', `select save_activity_draft($$p1-e1'; delete from people; --$$, '{}'::jsonb)`, '22023');
  await refused('SQL in a key is refused', 'authenticated', 'fb_bob', `select record_activity_submission('p1-e1', $$k'; delete from people; --$$, 1, now(), 1, '{}'::jsonb)`, '22023');
  await refused('a key with spaces is refused', 'authenticated', 'fb_bob', `select record_activity_attempt('p1-e1', 'has spaces in it', 1, 1, 10, 5)`, '22023');
  await refused('a json array instead of an object is refused', 'authenticated', 'fb_bob', `select save_activity_draft('p1-e1', '[1,2]'::jsonb)`, '22023');
  const clamped = await as('authenticated', 'fb_bob', `select record_activity_submission('p1-e1', 'future-1', 1, now() + interval '30 days', 1, '{}'::jsonb) as r`);
  ok('a far future completion time is clamped to now, not stored as given', new Date(clamped[0].r.completed_at) <= new Date());
  await refused('a learner cannot complete an exercise by marking it', 'authenticated', 'fb_bob', `select mark_activity_progress('p1-e2', 'completed')`, '22023');
  ok('both people still exist after the hostile input', (await q(`select count(*)::int n from people`))[0].n === 2);

  // Token tricks.
  await refused('an unknown uid in the token is refused', 'authenticated', 'fb_nobody', `select save_activity_draft('p1-e1', '{}'::jsonb)`, '42501');
  await refused('a token with no subject is refused', 'authenticated', null, `select save_activity_draft('p1-e1', '{}'::jsonb)`, '42501');
  await refused('an anonymous caller cannot call a write function', 'anon', null, `select save_activity_draft('p1-e1', '{}'::jsonb)`);
  await refused('an anonymous caller cannot record a submission', 'anon', null, `select record_activity_submission('p1-e1', 'anon-1', 1, now(), 1, '{}'::jsonb)`);
  await db.exec(`update people set account_status = 'archived' where id = '${BOB}'`);
  await refused('an archived account is refused', 'authenticated', 'fb_bob', `select save_activity_draft('p1-e1', '{}'::jsonb)`, '42501');
  await db.exec(`update people set account_status = 'active' where id = '${BOB}'`);
  await refused('browsers cannot call the private helpers', 'authenticated', 'fb_bob', `select private.require_person_id()`);
  await refused('browsers cannot pick a person through the resolver', 'authenticated', 'fb_bob', `select * from private.resolve_activity('p1-e1')`);
  ok('Alice is still unchanged after every attack', (await fingerprint()) === before);
} else {
  console.log('learner write functions not present, skipping that part');
}

if (await exists('update_my_profile')) {
  const before = await fingerprint();
  const profileCalls = [
    [`select update_my_profile('{"displayName":"Bob renamed"}'::jsonb)`, 'own display name is allowed'],
  ];
  await as('authenticated', 'fb_bob', profileCalls[0][0]);
  ok('Bob can rename himself', (await q(`select display_name from people where id = '${BOB}'`))[0].display_name === 'Bob renamed');
  ok('Alice is unchanged by Bob\'s profile update', (await fingerprint()) === before);
  for (const [name, fields] of [
    ['role', '{"role":"platform_owner"}'], ['account status', '{"accountStatus":"archived"}'], ['email', '{"email":"x@evil.com"}'],
    ['auth uid', '{"authUid":"fb_alice"}'], ['person id', `{"personId":"${ALICE}"}`], ['organization', '{"organizationId":"1"}'],
    ['an unknown key', '{"anything":1}']
  ]) {
    await refused(`update_my_profile refuses ${name}`, 'authenticated', 'fb_bob', `select update_my_profile(${lit(fields)}::jsonb)`, '22023');
  }
  ok('no role grant appeared', (await q(`select count(*)::int n from role_grants`))[0].n === 0);
  ok('Bob\'s email and status are untouched', (await q(`select primary_email, account_status from people where id = '${BOB}'`))[0].primary_email === 'bob@a.com');
  await refused('anon cannot update a profile', 'anon', null, `select update_my_profile('{"goals":"x"}'::jsonb)`);
}

if (await exists('add_reward_entries')) {
  const before = await fingerprint();
  await as('authenticated', 'fb_bob', `select add_reward_entries('tsa', '[{"id":"bob-1","mpEarned":10,"earnedAt":"2026-01-01T00:00:00Z"}]'::jsonb, '{"streakDays":1,"tokens":0}'::jsonb)`);
  ok('Alice\'s rewards unchanged by Bob\'s entries', (await fingerprint()) === before);
  ok('Bob\'s entry landed under Bob', (await q(`select count(*)::int n from reward_ledger where person_id = '${BOB}'`))[0].n === 1);
  await refused('more than 500 entries in one call is refused', 'authenticated', 'fb_bob',
    `select add_reward_entries('tsa', (select jsonb_agg(jsonb_build_object('id', 'e' || g, 'mpEarned', 1, 'earnedAt', '2026-01-01T00:00:00Z')) from generate_series(1, 501) g), '{}'::jsonb)`, '22023');
  await refused('anon cannot add reward entries', 'anon', null, `select add_reward_entries('tsa', '[]'::jsonb, '{}'::jsonb)`);
  // Fixes from the security review.
  await refused('negative points are refused', 'authenticated', 'fb_bob', `select add_reward_entries('tsa', '[{"id":"neg-1","mpEarned":-100000}]'::jsonb, null)`, '22023');
  await refused('an infinite time is refused', 'authenticated', 'fb_bob', `select add_reward_entries('tsa', '[{"id":"inf-1","mpEarned":1,"earnedAt":"infinity"}]'::jsonb, null)`, '22023');
  await refused('rewards for a draft program are refused', 'authenticated', 'fb_bob', `select add_reward_entries('doc', '[{"id":"doc-1","mpEarned":1}]'::jsonb, null)`, '22023');
  await as('authenticated', 'fb_bob', `select add_reward_entries('tsa', '[{"id":"year-9999","mpEarned":1,"earnedAt":"9999-12-31T00:00:00Z"}]'::jsonb, null)`);
  ok('a year 9999 time is stored as no later than now', (await q(`select earned_at <= now() as fine from reward_ledger where entry_key = 'year-9999' and person_id = '${BOB}'`))[0].fine === true);
  await db.exec(`insert into activities (id, program_id, title, status) values ('p9-secret','tsa','Not released','draft')`);
  await refused('evidence for a draft activity is refused', 'authenticated', 'fb_bob', `select record_learning_evidence('{"schemaVersion":1,"evidenceId":"evidence-secret-1","exerciseId":"p9-secret","evidenceSource":"self_report","learningDimensions":{"guidance":"light_touch"}}'::jsonb, '{"schemaVersion":1,"personality":{},"learning":{"guidance":{}},"programs":{}}'::jsonb)`, '22023');
  ok('Alice is unchanged after the reward and evidence attacks', (await fingerprint()) === before);
}

console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
