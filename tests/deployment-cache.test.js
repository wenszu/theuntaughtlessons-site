const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const headers = fs.readFileSync('_headers', 'utf8');
const workflow = fs.readFileSync('.github/workflows/sync-cache-versions.yml', 'utf8');

assert.match(
  headers,
  /Cache-Control: public, max-age=0, must-revalidate/,
  'Cloudflare should revalidate deployed files so a cached module cannot silently outlive its page'
);
assert.match(
  workflow,
  /contents: read/,
  'cache verification should not need permission to create a second deployment commit'
);
assert.match(workflow, /--check/, 'the deployment workflow should verify cache-version consistency');
assert.doesNotMatch(workflow, /git push/, 'cache automation should not trigger a second deployment');

const check = spawnSync(process.execPath, ['scripts/sync-cache-versions.js', '--check'], {
  cwd: process.cwd(),
  encoding: 'utf8'
});
assert.equal(check.status, 0, `${check.stdout}\n${check.stderr}`);

console.log('deployment cache contracts passed');
