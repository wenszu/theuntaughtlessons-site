// The contract between the browser code and the database functions (PostgREST /rest/v1/rpc/<name>).
//
// Why it exists: assets/supabase-data.js once called rpc("update_my_profile", picked) while the live function is
// public.update_my_profile(p_fields jsonb). PostgREST answered 404 and the profile save failed silently, and every unit test passed
// because the fake Supabase accepted any argument shape. This test, the contract file and the shared fake close that gap:
//
//   1. supabase/rpc-signatures.json is exactly what the migrations produce (scripts/supabase-rpc-signatures.js), so it can never be
//      older than the newest migration or list a function the migrations do not define.
//   2. Every place the repository calls a database function (browser files, Edge Function cores, the owner scripts) names a function
//      that exists, sends only real argument names, sends every argument that has no default, and passes the JSON parameters under their
//      p_ names (scripts/supabase-rpc-call-scan.js). The scan also reads the real argument builders of the table driven modules.
//   3. Every fake Supabase in tests/ answers a bad shape like PostgREST does (tests/helpers/rpc-contract.js), and a test file that has
//      such a fake without the check fails here.
//   4. The request bodies the clients send to the Edge Functions use keys the Edge Function reads.
//
// Run: node tests/rpc-call-contract.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const signatures = require('../scripts/supabase-rpc-signatures.js');
const scan = require('../scripts/supabase-rpc-call-scan.js');
const rpcContract = require('./helpers/rpc-contract');

const REPO_ROOT = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(REPO_ROOT, ...parts), 'utf8');
const contract = signatures.readSignatures();

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; } catch (error) { error.message = `[${name}] ${error.message}`; throw error; }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utl-rpc-contract-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { /* best effort */ } });
const load = (file) => { const copy = path.join(dir, path.basename(file).replace(/\.js$/, '.mjs')); fs.writeFileSync(copy, read(file)); return import(pathToFileURL(copy).href); };

(async function main() {
  // -- 1. the contract file --------------------------------------------------------------------------------------------------
  await check('rpc-signatures.json is exactly what the migrations produce (never older than the newest migration)', () => {
    const parsed = signatures.parseMigrations();
    const onlyParsed = Object.keys(parsed).filter((name) => !contract[name]);
    const onlyFile = Object.keys(contract).filter((name) => !parsed[name]);
    assert.deepStrictEqual(onlyParsed, [], 'functions defined by the migrations but missing from supabase/rpc-signatures.json (run: node scripts/supabase-rpc-signatures.js --write)');
    assert.deepStrictEqual(onlyFile, [], 'functions listed in supabase/rpc-signatures.json that the migrations do not define');
    assert.deepStrictEqual(contract, parsed, 'an argument list differs from the migrations (run: node scripts/supabase-rpc-signatures.js --write)');
    assert.strictEqual(read('supabase', 'rpc-signatures.json'), `${JSON.stringify(parsed, null, 2)}\n`, 'the file is not in the canonical form');
    const newest = signatures.newestMigrationName();
    assert.ok(newest, 'there are migrations');
    const fileTime = fs.statSync(signatures.SIGNATURES_FILE).mtimeMs;
    const newestTime = fs.statSync(path.join(signatures.MIGRATIONS_DIR, newest)).mtimeMs;
    // A fresh checkout gives every file the same moment, so only a clearly older contract file counts as stale.
    assert.ok(fileTime + 60000 >= newestTime, `supabase/rpc-signatures.json is older than the newest migration ${newest}`);
  });

  await check('the contract has the shape { name: [{ argName, type, hasDefault }] } and every input is named', () => {
    assert.ok(Object.keys(contract).length >= 100);
    Object.entries(contract).forEach(([name, args]) => {
      assert.ok(Array.isArray(args), name);
      args.forEach((arg) => {
        assert.deepStrictEqual(Object.keys(arg), ['argName', 'type', 'hasDefault'], name);
        assert.ok(/^p_[a-z0-9_]+$/.test(arg.argName), `${name}: ${arg.argName} is a p_ name`);
        assert.strictEqual(typeof arg.hasDefault, 'boolean');
      });
    });
    // The function that was called wrongly.
    assert.deepStrictEqual(contract.update_my_profile, [{ argName: 'p_fields', type: 'jsonb', hasDefault: false }]);
  });

  await check('the parser: last definition wins, drop removes, defaults, comments, bodies, rename, overloads', () => {
    const files = [
      { name: '1.sql', sql: `
        -- create function public.commented(p_a text) must not count
        create or replace function public.alpha(p_one text, p_two integer default 5) returns jsonb language sql as $$ select 1 $$;
        create function public.beta(p_x jsonb) returns jsonb language plpgsql as $body$ begin
          -- create function public.inside_body(p_z text)
          return '{}'; end $body$;
        create function public.gone(p_a text) returns text language sql as $$ select 'a' $$;
        create function private.hidden(p_a text) returns text language sql as $$ select 'a' $$;
        create function public.table_fn() returns table (a text, b integer) language sql as $$ select 'a', 1 $$;
        create function public.stamp(p_at timestamptz, p_note text = 'x', out p_ignored text) returns text language sql as $$ select 'a' $$;
        create function public.old_name(p_a text) returns text language sql as $$ select 'a' $$;` },
      { name: '2.sql', sql: `
        create or replace function public.alpha(p_one text, p_two integer) returns jsonb language sql as $$ select 2 $$;
        drop function public.gone(text);
        alter function public.old_name(text) rename to new_name;` }
    ];
    const parsed = signatures.parseSql(files);
    assert.deepStrictEqual(Object.keys(parsed).sort(), ['alpha', 'beta', 'new_name', 'stamp', 'table_fn']);
    assert.deepStrictEqual(parsed.alpha, [[{ argName: 'p_one', type: 'text', hasDefault: false }, { argName: 'p_two', type: 'integer', hasDefault: false }]]);
    assert.deepStrictEqual(parsed.beta, [[{ argName: 'p_x', type: 'jsonb', hasDefault: false }]]);
    assert.deepStrictEqual(parsed.table_fn, [[]]);
    assert.deepStrictEqual(parsed.stamp, [[{ argName: 'p_at', type: 'timestamp with time zone', hasDefault: false }, { argName: 'p_note', type: 'text', hasDefault: true }]]);
    const overloaded = fs.mkdtempSync(path.join(dir, 'ov-'));
    fs.writeFileSync(path.join(overloaded, '1.sql'), 'create function public.twice(p_a text) returns text language sql as $$ select 1 $$;\ncreate function public.twice(p_a integer) returns text language sql as $$ select 1 $$;');
    assert.throws(() => signatures.parseMigrations(overloaded), /overload/);
  });

  await check('compareWithLive: live wins (a missing, an extra and a changed function are all reported)', () => {
    const rows = Object.entries(contract).map(([proname, args]) => ({ proname, arguments: args.map((a) => `${a.argName} ${a.type}${a.hasDefault ? " DEFAULT NULL::text" : ''}`).join(', ') }));
    assert.deepStrictEqual(signatures.compareWithLive(contract, rows), { onlyLive: [], onlyContract: [], different: [] });
    const changed = rows.filter((row) => row.proname !== 'record_login').map((row) => (row.proname === 'update_my_profile' ? { proname: row.proname, arguments: 'p_fields jsonb, p_extra text' } : row));
    changed.push({ proname: 'brand_new', arguments: 'p_a text' });
    const report = signatures.compareWithLive(contract, changed);
    assert.deepStrictEqual(report.onlyLive, ['brand_new']);
    assert.deepStrictEqual(report.onlyContract, ['record_login']);
    assert.deepStrictEqual(report.different.map((d) => d.name), ['update_my_profile']);
  });

  // -- the PostgREST rule -----------------------------------------------------------------------------------------------------
  await check('checkCall: unknown function, unknown argument and a missing required argument are 404; defaults may be left out', () => {
    assert.strictEqual(signatures.checkCall(contract, 'update_my_profile', { p_fields: { goals: 'x' } }), null);
    assert.strictEqual(signatures.checkCall(contract, 'update_my_profile', { goals: 'x' }).status, 404, 'bare profile keys (the old bug)');
    assert.strictEqual(signatures.checkCall(contract, 'update_my_profile', {}).status, 404, 'required p_fields missing');
    assert.strictEqual(signatures.checkCall(contract, 'update_my_profile', { p_fields: {}, p_extra: 1 }).status, 404);
    assert.strictEqual(signatures.checkCall(contract, 'no_such_function', {}).status, 404);
    assert.strictEqual(signatures.checkCall(contract, 'get_my_access', {}), null);
    assert.strictEqual(signatures.checkCall(contract, 'get_my_access'), null);
    assert.strictEqual(signatures.checkCall(contract, 'get_my_access', { p_x: 1 }).status, 404);
    assert.strictEqual(signatures.checkCall(contract, 'admin_authorize_member', { p_input: {} }), null, 'p_dry_run has a default');
    assert.strictEqual(signatures.checkCall(contract, 'admin_authorize_member', { p_dry_run: true }).status, 404);
    assert.strictEqual(signatures.checkCall(contract, 'record_activity_attempt', { p_activity: 'a', p_attempt_key: 'k', p_attempt_number: 1, p_score: 1, p_score_maximum: 2, p_duration_seconds: 3 }), null, 'content version and detail have defaults');
  });

  await check('the shared fake answers like PostgREST: 404 body, the call is recorded, and expectRejections keeps a deliberate bad call out of the tally', async () => {
    const bad = await rpcContract.expectRejections(() => rpcContract.reject('https://x.supabase.co/rest/v1/rpc/update_my_profile', { method: 'POST', body: JSON.stringify({ photoUrl: 'https://a.test/p.jpg' }) }));
    assert.strictEqual(bad.status, 404);
    assert.strictEqual(bad.ok, false);
    const body = JSON.parse(await bad.text());
    assert.strictEqual(body.code, 'PGRST202');
    assert.match(body.message, /update_my_profile/);
    assert.strictEqual(rpcContract.rejections.length, 0, 'a deliberate rejection is not a failure of the run');
    assert.strictEqual(rpcContract.reject('https://x.supabase.co/rest/v1/rpc/update_my_profile', { method: 'POST', body: JSON.stringify({ p_fields: {} }) }), null);
    assert.strictEqual(rpcContract.reject('https://x.supabase.co/rest/v1/profiles?select=*', { method: 'GET' }), null, 'tables are not functions');
    assert.strictEqual(rpcContract.reject('https://x.supabase.co/functions/v1/admin-mail', { method: 'POST', body: '{"action":"x"}' }), null, 'edge functions are not database functions');
    assert.notStrictEqual(rpcContract.rejectCall('update_my_profile', { photoUrl: 'x' }), null);
    assert.strictEqual(rpcContract.rejectCall('update_my_profile', { p_fields: {} }), null);
    rpcContract.rejections.length = 0;
  });

  // -- 2. the call sites -----------------------------------------------------------------------------------------------------
  const found = scan.scanRepo();

  await check('every call site in the repository uses real function names and argument names', () => {
    const lines = found.problems.map((p) => `${p.file}:${p.line} ${p.name} ${p.problem}`);
    assert.deepStrictEqual(lines, [], 'database function calls that do not match supabase/rpc-signatures.json');
  });

  await check('the scan really sees the known call sites (it cannot pass by finding nothing)', () => {
    const byFile = {};
    found.sites.forEach((site) => { (byFile[site.file] = byFile[site.file] || new Set()).add(site.name); });
    const expectIn = {
      'assets/supabase-data.js': ['update_my_profile', 'record_activity_submission', 'record_activity_attempt', 'save_activity_draft', 'add_reward_entries', 'admin_mirror_cohort', 'get_my_access', 'get_my_person_id', 'record_login', 'admin_set_app_setting'],
      'assets/supabase-member-reads.js': ['get_my_workspaces', 'get_my_cohort_standing'],
      'assets/supabase-admin-reads.js': ['admin_list_customers', 'get_organization_console'],
      'assets/supabase-admin-console-reads.js': ['admin_console_members', 'admin_leaderboard'],
      'assets/supabase-admin-writes.js': ['admin_grant_entitlement', 'admin_authorize_member'],
      'assets/supabase-question-bank.js': ['admin_item_health', 'admin_save_item_review'],
      'assets/supabase-callables.js': ['issue_my_credential'],
      'assets/supabase-site.js': ['get_my_account', 'admin_member_exists', 'get_public_credential'],
      'assets/supabase-auth.js': ['link_my_identity'],
      'assets/feedback-widget.js': ['submit_lead', 'submit_feedback'],
      'assets/public-waitlist.js': ['submit_lead'],
      'apps/find-your-level/index.html': ['submit_lead', 'submit_feedback'],
      'admin/inbox/inbox.js': ['admin_inbox_list', 'admin_cleanup_purge_people', 'admin_people_search'],
      'functions-aiko/store-attempt.js': ['record_activity_attempt'],
      'supabase/functions/result-emails/core.mjs': ['readiness_email_begin', 'results_email_take'],
      'supabase/functions/weekly-org-reports/core.mjs': ['weekly_report_record']
    };
    Object.entries(expectIn).forEach(([file, names]) => names.forEach((name) => assert.ok(byFile[file] && byFile[file].has(name), `${file} should call ${name}`)));
    assert.ok(found.sites.length >= 120, `${found.sites.length} call sites`);
  });

  await check('the scan catches each kind of mistake (unknown function, unknown argument, missing argument, bare keys, unreadable arguments)', () => {
    const run = (code) => scan.checkSites(scan.scanSource(code, 'x.js'), contract, code, 'x.js').map((p) => p.problem);
    assert.deepStrictEqual(run('rpc("update_my_profile", { p_fields: picked });'), []);
    assert.match(run('rpc("update_my_profile", { displayName: name });').join('|'), /unknown argument name\(s\) displayName/);
    assert.match(run('rpc("update_my_profile", { displayName: name });').join('|'), /required argument\(s\) not sent: p_fields/);
    assert.match(run('const picked = pickKeys(fields, KEYS);\nrpc("update_my_profile", picked);').join('|'), /cannot be read from the source/);
    assert.match(run('rpc("update_my_profile_typo", { p_fields: 1 });').join('|'), /unknown database function/);
    assert.match(run('post("admin_save_item_review", { p_input: x, p_dryrun: false });').join('|'), /p_dryrun/);
    assert.match(run('fetch(URL + "/rest/v1/rpc/submit_lead", { body: JSON.stringify({ lead: payload }) });').join('|'), /unknown argument name\(s\) lead/);
    assert.deepStrictEqual(run('fetch(URL + "/rest/v1/rpc/submit_lead", { body: JSON.stringify({ p_lead: payload }) });'), []);
    assert.deepStrictEqual(run('const args = { p_kind: "a", p_ids: [] };\nargs.p_note = "x";\nrpc("admin_inbox_set_status", args);').join('|'), 'required argument(s) not sent: p_status');
    assert.deepStrictEqual(run('rpc("get_my_access", {});'), []);
    assert.deepStrictEqual(run('const o = { p_stray: 1 };\nrpc("get_my_access", {});').filter((p) => /p_stray/.test(p)).length, 1, 'a p_ key that no called function has');
  });

  // The table driven modules build their arguments in a switch: run the real builders against the contract.
  await check('assets/supabase-admin-reads.js builders: every wrapper sends valid arguments to its function', async () => {
    const mod = await load('assets/supabase-admin-reads.js');
    const samples = { getCustomerDirectory: [{ search: 'a', pageSize: 10, cursorCustomerId: 'c', programFilter: 'tsa' }], getCustomerDetailForStaff: ['cust-1'], listEsParticipants: [{ pageSize: 5 }], listEsAttempts: [{ cursorAttemptId: 'x' }],
      getEsConfiguration: [], getEsDataGovernance: [{}], searchVerifiedCredentials: ['UTL'], getMemberCredentialRegistry: [], getOrganizationAccessAdmin: [], checkOrganizationRepEmail: ['a@b.test'], getOrganizationConsole: ['acme'] };
    assert.deepStrictEqual(Object.keys(samples).sort(), mod.ADMIN_READ_NAMES.slice().sort());
    mod.ADMIN_READ_NAMES.forEach((name) => {
      [samples[name], []].forEach((args) => assert.strictEqual(signatures.checkCall(contract, mod.RPC_NAMES[name], mod.buildAdminReadArgs(name, args)), null, `${name} -> ${mod.RPC_NAMES[name]}`));
    });
  });

  await check('assets/supabase-admin-console-reads.js builders: every read sends valid arguments to its function', async () => {
    const mod = await load('assets/supabase-admin-console-reads.js');
    Object.keys(mod.RPC_NAMES).forEach((name) => {
      [[], ['a@b.test'], [{ cohort: 'c', metric: 'mp', limit: 5, days: 3 }], [['uid-1']]].forEach((args) => {
        [null, 'cursor-1'].forEach((cursor) => assert.strictEqual(signatures.checkCall(contract, mod.RPC_NAMES[name], mod.buildConsoleReadArgs(name, args, cursor)), null, `${name} -> ${mod.RPC_NAMES[name]} ${JSON.stringify(args)}`));
      });
    });
  });

  await check('assets/supabase-admin-writes.js: every staff write posts { p_input, p_dry_run } to a function that takes exactly those', async () => {
    const mod = await load('assets/supabase-admin-writes.js');
    assert.ok(mod.WRAPPER_NAMES.length >= 14);
    mod.WRAPPER_NAMES.forEach((name) => {
      const spec = mod.FUNCTIONS[name];
      assert.ok(contract[spec.rpc], `${name} -> ${spec.rpc} exists`);
      assert.strictEqual(signatures.checkCall(contract, spec.rpc, { p_input: {}, p_dry_run: false }), null, `${name} -> ${spec.rpc}`);
      assert.strictEqual(signatures.checkCall(contract, spec.rpc, { p_input: {} }), null);
    });
  });

  // -- 3. every fake in tests/ is guarded --------------------------------------------------------------------------------------
  await check('every test with a fake Supabase that answers /rest/v1/rpc/ uses the contract check', () => {
    const guarded = [];
    const unguarded = [];
    fs.readdirSync(__dirname).filter((name) => /\.test\.js$/.test(name)).forEach((name) => {
      const text = fs.readFileSync(path.join(__dirname, name), 'utf8');
      if (!/rest\/v1\/rpc|\/rpc\/|client\.rpc|rpc: async/.test(text)) return;
      const hasFake = /fetchImpl\s*[:=(]|global\.fetch\s*=|fetch:\s*fetchFn|rpc: async \(name|createHarness|world\.fetchImpl|fakeFetch|makeFetch/.test(text);
      if (!hasFake) return;
      (/rpc-contract|firebase-harness/.test(text) ? guarded : unguarded).push(name);
    });
    // Files that only read the source text of a module or only check that a string is present have no fake to guard.
    const textOnly = ['module-imports-versioned.test.js', 'browser-wiring.test.js', 'deployment-cache.test.js'];
    assert.deepStrictEqual(unguarded.filter((name) => !textOnly.includes(name)), [], 'add  const bad = rpcContract.reject(url, init); if (bad) return bad;  to the fake of these tests');
    assert.ok(guarded.length >= 30, `${guarded.length} guarded test files`);
  });

  await check('the shared harness (tests/helpers/firebase-harness.js) refuses a bad shape too', () => {
    assert.ok(/rpcContract\.reject\(url, init\)/.test(read('tests', 'helpers', 'firebase-harness.js')));
  });

  // -- 4. the Edge Function request bodies ------------------------------------------------------------------------------------
  // Each client sends a JSON body; the Edge Function core reads named keys of it. A key the client sends that the core never reads
  // (a typo, a rename on one side) is the same kind of bug as a wrong argument name. keys(file, anchor) reads the keys of the object
  // literal that follows the anchor text.
  const objectAfter = (file, anchor) => {
    const text = read(...file.split('/'));
    const at = text.indexOf(anchor);
    assert.ok(at !== -1, `${file} contains ${anchor}`);
    const open = text.indexOf('{', at);
    return scan.objectKeys(text.slice(open, scan.closeOf(text, open) + 1)).keys;
  };
  const coreReads = (core, key) => new RegExp(`\\b(?:input|body|data|payload|source|parsed)\\??\\.${key}\\b`).test(read('supabase', 'functions', core, 'core.mjs'));
  const EDGE = [
    { fn: 'readiness-submit', sent: objectAfter('apps/executive-signature/index.html', 'window.raRecordCompletion({'), mustSend: ['email', 'tier', 'consent', 'submissionId', 'answers', 'itemOrder', 'startedAt'] },
    { fn: 'readiness-access', sent: objectAfter('assets/supabase-callables.js', 'edge("readiness-access", {'), mustSend: ['email'] },
    { fn: 'admin-mail', sent: objectAfter('assets/supabase-callables.js', 'edge("admin-mail", {'), mustSend: ['action', 'payload'] },
    { fn: 'auth-admin', sent: objectAfter('assets/supabase-site.js', 'body: JSON.stringify({ email: address'), mustSend: ['email', 'destination'] },
    { fn: 'stripe-checkout', sent: objectAfter('assets/firebase.js', 'body: JSON.stringify({ program, successUrl, cancelUrl'), mustSend: ['program', 'successUrl', 'cancelUrl'] },
    { fn: 'result-emails', sent: objectAfter('assets/result-email-client.js', 'call("readiness-result", {').concat(objectAfter('assets/result-email-client.js', 'call("my-results", {')), mustSend: ['attemptId', 'recipients', 'resultsText', 'filename'] },
    // The scorer pages build their payloads with Object.assign, so the keys are listed from apps/explain-to-aiko/aiko.js and apps/tsa-diagnostic/index.html.
    { fn: 'ai-score', sent: ['mode', 'transcript', 'durationSeconds', 'wpm', 'fillerCount', 'priorTranscript', 'attemptId', 'attemptNumber', 'formId', 'kind', 'enabled', 'speak', 'act', 'scenario', 'deterministic'], mustSend: ['mode', 'transcript'] }
  ];
  for (const entry of EDGE) {
    await check(`Edge Function ${entry.fn}: the client sends the keys the function reads`, () => {
      assert.ok(entry.sent.length >= 1, 'the client body could be read');
      entry.sent.forEach((key) => assert.ok(coreReads(entry.fn, key), `${entry.fn} core.mjs never reads the key "${key}" that the client sends`));
      entry.mustSend.forEach((key) => assert.ok(entry.sent.includes(key), `the client must send "${key}" to ${entry.fn}`));
    });
  }

  await check('Edge Function routes: every route the clients post to is a route the function accepts', () => {
    assert.match(read('supabase', 'functions', 'result-emails', 'core.mjs'), /ROUTES = \["readiness-result", "my-results"\]/);
    assert.ok(/call\("readiness-result"/.test(read('assets', 'result-email-client.js')) && /call\("my-results"/.test(read('assets', 'result-email-client.js')));
    const aiRoutes = read('supabase', 'functions', 'ai-score', 'core.mjs');
    assert.ok(/explain-to-aiko/.test(aiRoutes) && /tsa-diagnostic/.test(aiRoutes));
    assert.ok(/score\("explain-to-aiko"/.test(read('assets', 'ai-score-client.js')) && /score\("tsa-diagnostic"/.test(read('assets', 'ai-score-client.js')));
    assert.ok(/auth-admin\/invite/.test(read('assets', 'supabase-site.js')) && /invite/.test(read('supabase', 'functions', 'auth-admin', 'core.mjs')));
    // every functions/v1/<name> the browser calls exists as supabase/functions/<name>
    const names = new Set();
    scan.listFiles().filter((file) => !file.startsWith('supabase/') && !file.startsWith('scripts/') && !file.startsWith('functions-')).forEach((file) => {
      scan.scanEdgeCalls(read(...file.split('/')), file).forEach((call) => names.add(call.route));
    });
    names.forEach((name) => assert.ok(fs.existsSync(path.join(REPO_ROOT, 'supabase', 'functions', name)), `functions/v1/${name} is called but supabase/functions/${name} does not exist`));
    assert.ok(names.size >= 6, [...names].join(','));
  });

  console.log(`rpc-call-contract: ${passed} checks passed`);
}()).catch((error) => { console.error(error); process.exit(1); });
