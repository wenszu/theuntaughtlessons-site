// Every first party JavaScript module import in the shipped site must carry the same ?v=<version> cache query that
// scripts/sync-cache-versions.js manages. The site is served with a cache lifetime of hours: without the query a
// browser could run a fresh firebase.js against a stale supabase-data.js from an earlier deploy (and the module
// would call functions that do not exist there). This test fails if an import lacks the query, if two different
// versions are in use, or if the sync script stops catching a missing one.
//
// Run: node tests/module-imports-versioned.test.js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'sync-cache-versions.js');

function run(args, cwdRoot) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: cwdRoot || ROOT, encoding: 'utf8' });
}

// 1. The repository as committed: no unversioned import, one version everywhere.
const repoCheck = run(['--check']);
assert.equal(repoCheck.status, 0, `${repoCheck.stdout}\n${repoCheck.stderr}`);
assert.doesNotMatch(repoCheck.stderr, /without a \?v=/);

// 2. The pieces the worry started with: the module loaders in firebase.js and the portal.
const firebase = fs.readFileSync(path.join(ROOT, 'assets', 'firebase.js'), 'utf8');
const dynamicImports = [...firebase.matchAll(/import\(\s*(["'])(\.\/[^"'?]+)\1\s*\)/g)].map((m) => m[2]);
assert.deepEqual(dynamicImports, [], `assets/firebase.js has a dynamic import without ?v=: ${dynamicImports.join(', ')}`);
for (const name of [
  'switchboard', 'supabase-auth', 'supabase-data', 'supabase-admin-reads', 'supabase-admin-console-reads',
  'supabase-question-bank', 'supabase-callables', 'supabase-admin-writes', 'supabase-member-reads', 'supabase-site'
]) {
  assert.match(firebase, new RegExp(`import\\("\\./${name}\\.js\\?v=[\\w.-]+"\\)`), `firebase.js imports ${name}.js with ?v=`);
}
const portal = fs.readFileSync(path.join(ROOT, 'member-login', 'content-config.js'), 'utf8');
for (const name of ['firebase', 'reward-ui', 'engagement-analytics']) {
  assert.match(portal, new RegExp(`assets/${name}\\.js\\?v=[\\w.-]+`), `member-login/content-config.js loads ${name}.js with ?v=`);
}
assert.doesNotMatch(portal, /var version = "\?v=/, 'no private version string in member-login/content-config.js (the sync script could not manage it)');

// 3. The sync script catches a missing query and fixes it, in a throwaway copy of a small site.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utl-import-version-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { /* best effort */ } });
const write = (rel, text) => {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
fs.mkdirSync(path.join(dir, 'scripts'));
fs.copyFileSync(SCRIPT, path.join(dir, 'scripts', 'sync-cache-versions.js'));
const local = (args) => spawnSync(process.execPath, [path.join(dir, 'scripts', 'sync-cache-versions.js'), ...args], { cwd: dir, encoding: 'utf8' });

write('assets/a.js', [
  "import { b } from './b.js';",
  "import './c.js';",
  "export { d } from './d.js';",
  "const lazy = () => import('./e.js');",
  "const lazy2 = () => import(\"./f.js\");",
  "const url = new URL('./g.js', import.meta.url);",
  "const notAModule = new URL('./h.js', 'https://example.test/');",
  "import { v } from './vendor/lib/lib.mjs';",
  "const text = \"from './missing.js'\";",
  ''
].join('\n'));
for (const name of ['b', 'c', 'd', 'e', 'f', 'g', 'h']) write(`assets/${name}.js`, '// module\n');
write('assets/vendor/lib/lib.mjs', "import { x } from './other.mjs';\nexport const v = 1;\n");
write('assets/vendor/lib/other.mjs', 'export const x = 1;\n');
write('pages/index.html', [
  '<script src="../assets/a.js?v=old"></script>',
  '<script type="module">',
  "  import { b } from '../assets/b.js';",
  "  import('../assets/e.js').then(() => {});",
  '</script>',
  ''
].join('\n'));
write('supabase/functions/edge.js', "import { b } from '../../assets/b.js';\n");

const failing = local(['--check']);
assert.notEqual(failing.status, 0, 'the check fails while imports are unversioned');
assert.match(failing.stderr, /without a \?v=/);
for (const name of ['b.js', 'c.js', 'd.js', 'e.js', 'f.js', 'g.js']) assert.ok(failing.stderr.includes(`./${name}`) || failing.stderr.includes(`../assets/${name}`), `${name} is reported`);
assert.ok(!failing.stderr.includes('h.js'), 'a URL that is not relative to import.meta.url is left alone');
assert.ok(!failing.stderr.includes('lib.mjs'), 'vendored files are left alone');
assert.ok(!failing.stderr.includes('edge.js'), 'folders outside the site are left alone');

const fixed = local(['--version=TESTV1']);
assert.equal(fixed.status, 0, fixed.stderr);
const a = fs.readFileSync(path.join(dir, 'assets/a.js'), 'utf8');
assert.ok(a.includes("from './b.js?v=TESTV1'"));
assert.ok(a.includes("import './c.js?v=TESTV1'"));
assert.ok(a.includes("from './d.js?v=TESTV1'"));
assert.ok(a.includes("import('./e.js?v=TESTV1')"));
assert.ok(a.includes('import("./f.js?v=TESTV1")'));
assert.ok(a.includes("new URL('./g.js?v=TESTV1', import.meta.url)"));
assert.ok(a.includes("new URL('./h.js', 'https://example.test/')"));
assert.ok(a.includes("from './vendor/lib/lib.mjs'"), 'the vendored import stays as it was');
assert.equal(fs.readFileSync(path.join(dir, 'assets/vendor/lib/lib.mjs'), 'utf8'), "import { x } from './other.mjs';\nexport const v = 1;\n", 'vendored files are never edited');
assert.equal(fs.readFileSync(path.join(dir, 'supabase/functions/edge.js'), 'utf8'), "import { b } from '../../assets/b.js';\n");
const page = fs.readFileSync(path.join(dir, 'pages/index.html'), 'utf8');
assert.ok(page.includes('a.js?v=TESTV1') && page.includes("from '../assets/b.js?v=TESTV1'") && page.includes("import('../assets/e.js?v=TESTV1')"));

const passing = local(['--check']);
assert.equal(passing.status, 0, `${passing.stdout}\n${passing.stderr}`);

// A second run with a new version moves everything together; nothing is left behind on the old one.
const moved = local(['--version=TESTV2']);
assert.equal(moved.status, 0, moved.stderr);
for (const rel of ['assets/a.js', 'pages/index.html']) assert.ok(!fs.readFileSync(path.join(dir, rel), 'utf8').includes('TESTV1'), `${rel} moved to the new version`);
assert.equal(local(['--check']).status, 0);

// One URL per module: a leftover import on an older version is reported as a split.
write('assets/late.js', "import { b } from './b.js?v=TESTV1';\n");
const split = local(['--check']);
assert.notEqual(split.status, 0, 'two versions in one site fail the check');
assert.match(split.stderr, /2 cache versions/);

console.log('module import versioning contracts passed');
