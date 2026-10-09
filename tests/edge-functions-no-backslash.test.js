// The deploy tool can corrupt a backslash (and any escape sequence), and it can also mangle a character outside plain ASCII, so the
// Edge Functions that are deployed or about to be deployed must not contain a backslash or a non-ASCII character at all (no regular
// expression escape, no string escape, no curly quote, no dash that is not a hyphen, no invisible byte order mark). This test reads
// every file in those seven folders and fails on the first backslash or non-ASCII character it finds.
// send-email, stripe-checkout and stripe-webhook are older and are not covered here.
// Run: node tests/edge-functions-no-backslash.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'supabase', 'functions');
const FOLDERS = ['readiness-submit', 'result-emails', 'weekly-org-reports', 'readiness-access', 'auth-admin', 'admin-mail', 'ai-score'];
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
    const bad = text.search(/[^\x00-\x7f]/);
    const badLine = bad < 0 ? 0 : text.slice(0, bad).split('\n').length;
    assert.strictEqual(bad, -1, folder + '/' + name + ' contains a non-ASCII character (code ' + (bad < 0 ? 0 : text.charCodeAt(bad)) + ') on line ' + badLine);
    files += 1;
  }
}
console.log('no backslash and no non-ASCII character in ' + files + ' files of ' + FOLDERS.length + ' Edge Function folders');
