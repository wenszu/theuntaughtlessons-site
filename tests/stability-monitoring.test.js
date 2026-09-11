const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('learner monitoring is fail-safe, bounded and privacy-conscious', () => {
  const source = read('assets/stability-monitor.js');
  assert.match(source, /MAX_PER_SESSION = 20/);
  assert.match(source, /DEDUPE_MS = 5 \* 60 \* 1000/);
  assert.match(source, /Monitoring must never affect the learner experience/);
  assert.match(source, /unhandledrejection/);
  assert.match(source, /resource_error/);
  assert.match(source, /network_offline/);
  assert.match(source, /utl:stability-event/);
  assert.match(source, /\[email removed\]/);
  assert.match(source, /\[link removed\]/);
  assert.doesNotMatch(source, /\.stack\b/);
});

test('monitor is loaded without blocking existing engagement analytics', () => {
  const source = read('assets/engagement-analytics.js');
  assert.match(source, /import\("\.\/stability-monitor\.js[^)]*\)\.catch\(\(\) => \{\}\)/);
});

test('Firebase stores bounded reports and exposes an admin-only reader', () => {
  const firebase = read('assets/firebase.js');
  const rules = read('firestore.rules');
  assert.match(firebase, /async function saveStabilityEvent/);
  assert.match(firebase, /async function getAllStabilityEvents/);
  assert.match(firebase, /orderBy\("occurredAtMs", "desc"\), limit\(25\)/);
  assert.match(firebase, /eventType: "sync_error"/);
  assert.match(rules, /match \/users\/\{userId\}\/stability_events\/\{eventId\}/);
  assert.match(rules, /allow read: if isAdmin\(\)/);
  assert.match(rules, /allow create: if signedIn\(\) && request\.auth\.uid == userId/);
  assert.match(rules, /allow update, delete: if false/);
});

test('Technical reliability explains and lists technical reports', () => {
  const admin = read('admin/index.html');
  assert.match(admin, /Technical reports · 24h/);
  assert.match(admin, /Technical reliability/);
  assert.match(admin, /How these reports are measured/);
  assert.match(admin, /learner answers are never collected/);
  assert.match(admin, /await fb\.getAllStabilityEvents/);
});

test('Vimeo recovery reports stalls and player failures', () => {
  const config = read('member-login/content-config.js');
  assert.match(config, /reportVimeoStability/);
  assert.match(config, /"video_stall"/);
  assert.match(config, /"video_error"/);
});
