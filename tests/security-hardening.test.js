const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const results = fs.readFileSync(path.join(root, 'my-results/index.html'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const functions = fs.readFileSync(path.join(root, 'functions-aiko/index.js'), 'utf8');
const adminFunctions = fs.readFileSync(path.join(root, 'functions-admin/index.js'), 'utf8');
const sheetActions = fs.readFileSync(path.join(root, 'scripts/apps-script-email-actions.gs'), 'utf8');
const headers = fs.readFileSync(path.join(root, '_headers'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8');

assert.match(
  results,
  /escapeHtml\(formatPreview\(app\.id, record\)\)/,
  'My Results previews must escape saved learner content before using innerHTML.'
);
assert.match(
  results,
  /escapeHtml\(formatFullResponse\(app\.id, record\)\)/,
  'My Results full responses must escape saved learner content before using innerHTML.'
);
assert.match(rules, /function isValidAccessRequest\(requestId\)/);
assert.match(rules, /request\.resource\.data\.keys\(\)\.hasOnly/);
assert.doesNotMatch(
  rules,
  /match \/access_requests\/\{requestId\}[\s\S]*?allow create: if true;/,
  'Anonymous Firestore writes must have a schema.'
);
assert.doesNotMatch(
  rules,
  /match \/settings\/\{docId\}[\s\S]*?\|\| signedIn\(\);/,
  'Signed-in members must not receive blanket access to every settings document.'
);
assert.match(functions, /const MAX_REQUEST_BYTES = 64 \* 1024/);
assert.strictEqual((functions.match(/rejectOversizedRequest\(request, response\)/g) || []).length, 5);
assert.match(sheetActions, /function safeSheetCell_\(value\)/);
assert.match(sheetActions, /groupEmail !== String\(UTL_GOOGLE_GROUP_EMAIL\)/);
assert.match(sheetActions, /function isValidAdminRelay_\(data\)/);
assert.match(adminFunctions, /exports\.runAdminAction = onCall/);
assert.match(adminFunctions, /ALLOWED_ADMIN_ACTIONS = new Set\(\["WelcomeEmail", "TestEmailTemplate", "RemovedMember"\]\)/);
assert.match(adminFunctions, /await isAuthorizedAdmin\(email\)/);
assert.doesNotMatch(admin, /const EMAIL_SCRIPT_URL =/);
assert.doesNotMatch(admin, /mode: 'no-cors'/);
assert.doesNotMatch(admin, /mbRequestGoogleGroupSync/);
assert.doesNotMatch(admin, /mbQueueGoogleGroupSync/);
assert.doesNotMatch(admin, /Google Group sync queued/);
assert.doesNotMatch(admin, /Google Group Added/);
assert.match(admin, /const LOCAL_ADMIN_HOST = \/\^\(localhost\|127\\\.0\\\.0\\\.1\)\$\//);
assert.match(admin, /Production never trusts the browser-only password/);
assert.match(admin, /openProductionAdmin\(\{ interactive: true \}\)/);
assert.match(admin, /id="adminGoogleSignIn" type="button" disabled/);
assert.match(admin, /function waitForAdminFirebaseApi\(onReady\)/);
assert.match(admin, /window\.setInterval\(probe, 250\)/);
assert.match(admin, /firebase\.js\?v=20260813-tsa-scoring-2/, 'admin should cache-bust Firebase when its named exports change');
assert.match(admin, /Secure sign-in is still loading\. This page will continue automatically\./, 'slow authentication bootstrap should remain recoverable');
assert.doesNotMatch(admin, /Secure sign-in took too long to load/, 'a slow module load must not enter a terminal refresh-required state');
assert.match(admin, /from "\.\.\/assets\/firebase\.js\?v=[\w-]+"/);
assert.match(headers, /Content-Security-Policy-Report-Only:/);
assert.match(headers, /X-Content-Type-Options: nosniff/);

console.log('security-hardening.test.js passed');
