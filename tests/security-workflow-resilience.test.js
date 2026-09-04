const assert = require('node:assert/strict');
const fs = require('node:fs');

const workflow = fs.readFileSync('.github/workflows/security-checks.yml', 'utf8');

assert.match(workflow, /schedule:\s*\n\s*- cron:/, 'security audits should run on a daily schedule as well as code changes');
assert.match(workflow, /google\/osv-scanner-action\/.github\/workflows\/osv-scanner-reusable\.yml@v2\.5\.0/, 'dependency checks should use the official OSV Scanner workflow');
assert.match(workflow, /--lockfile=functions\/package-lock\.json/, 'Google Group dependencies should be scanned');
assert.match(workflow, /--lockfile=functions-aiko\/package-lock\.json/, 'AI function dependencies should be scanned');
assert.match(workflow, /--lockfile=functions-admin\/package-lock\.json/, 'administrative function dependencies should be scanned');
assert.match(workflow, /security-events: write/, 'OSV results should be published to GitHub code scanning');
assert.match(workflow, /npm ci --ignore-scripts --no-audit/, 'dependency installation should not call the unavailable npm audit endpoint');

console.log('independent dependency vulnerability scan contracts passed');
