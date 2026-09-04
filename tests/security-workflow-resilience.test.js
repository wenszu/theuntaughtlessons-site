const assert = require('node:assert/strict');
const fs = require('node:fs');

const workflow = fs.readFileSync('.github/workflows/security-checks.yml', 'utf8');
const auditScript = fs.readFileSync('scripts/npm-audit-with-retry.js', 'utf8');

assert.match(workflow, /schedule:\s*\n\s*- cron:/, 'security audits should run on a daily schedule as well as code changes');
assert.equal((workflow.match(/node \.\.\/scripts\/npm-audit-with-retry\.js/g) || []).length, 3, 'every deployed function package should use the resilient audit runner');
assert.match(auditScript, /--audit-level=high/, 'high and critical vulnerability findings should remain blocking');
assert.match(auditScript, /if \(!timedOut && !transientPattern\.test\(output\)\)/, 'confirmed audit findings should not be treated as service outages');
assert.match(auditScript, /::error title=npm audit unavailable::/, 'persistent registry outages should remain visible and fail closed');
assert.match(auditScript, /process\.exit\(1\);\s*$/, 'the security gate should not pass without a vulnerability result');
assert.match(auditScript, /timeout: 30_000/, 'each unavailable registry attempt should have a bounded wait');

console.log('security workflow outage resilience contracts passed');
