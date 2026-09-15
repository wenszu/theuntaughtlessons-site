const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const headers = fs.readFileSync('_headers', 'utf8');
const workflow = fs.readFileSync('.github/workflows/sync-cache-versions.yml', 'utf8');
const deployWorkflow = fs.readFileSync('.github/workflows/deploy-pages.yml', 'utf8');

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
assert.match(
  deployWorkflow,
  /sync-cache-versions\.js --version="\$\{GITHUB_SHA::12\}"/,
  'the deployment artifact should use its source commit as the cache key'
);
assert.match(deployWorkflow, /actions\/upload-pages-artifact@v3/, 'the prepared site should be uploaded as one artifact');
assert.match(deployWorkflow, /actions\/deploy-pages@v4/, 'the prepared artifact should be deployed atomically');
assert.match(deployWorkflow, /--exclude 'functions\/'/, 'Cloud Functions source should not be published with the static site');
assert.doesNotMatch(deployWorkflow, /git push/, 'deployment preparation should never rewrite repository history');

const check = spawnSync(process.execPath, ['scripts/sync-cache-versions.js', '--check'], {
  cwd: process.cwd(),
  encoding: 'utf8'
});
assert.equal(check.status, 0, `${check.stdout}\n${check.stderr}`);

console.log('deployment cache contracts passed');
