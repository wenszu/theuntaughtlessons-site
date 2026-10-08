// The deploy tool can corrupt a backslash, so the Edge Functions that are deployed or about to be deployed must not contain one at all
// (no regular expression escape, no string escape, nothing). This test reads every file in those six folders and fails on the first
// backslash it finds. send-email, ai-score, stripe-checkout and stripe-webhook are older and are not covered here.
// Run: node tests/edge-functions-no-backslash.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'supabase', 'functions');
const FOLDERS = ['readiness-submit', 'result-emails', 'weekly-org-reports', 'readiness-access', 'auth-admin', 'admin-mail'];
const BACKSLASH = String.fromCharCode(92);
let files = 0;
for (const folder of FOLDERS) {
  const dir = path.join(root, folder);
  assert.ok(fs.existsSync(dir), folder + ' exists');
  const entries = fs.readdirSync(dir).filter((name) => fs.statSync(path.join(dir, name)).isFile());
  assert.ok(entries.some((name) => name === 'core.mjs') && entries.some((name) => name === 'index.ts'), folder + ' has core.mjs and index.ts');
  for (const name of entries) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    const at = text.indexOf(BACKSLASH);
    const line = at < 0 ? 0 : text.slice(0, at).split('\n').length;
    assert.strictEqual(at, -1, folder + '/' + name + ' contains a backslash character on line ' + line);
    files += 1;
  }
}
console.log('no backslash in ' + files + ' files of ' + FOLDERS.length + ' Edge Function folders');
