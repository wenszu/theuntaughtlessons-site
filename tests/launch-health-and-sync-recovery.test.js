const assert = require('node:assert/strict');
const fs = require('node:fs');

const firebase = fs.readFileSync('assets/firebase.js', 'utf8');
const admin = fs.readFileSync('admin/index.html', 'utf8');

assert.match(firebase, /PROGRESS_SYNC_QUEUE_KEY = "utl_pending_progress_syncs"/, 'failed progress writes are retained locally');
assert.match(firebase, /Your work is safe in this browser\./, 'learners receive a clear local-backup message');
assert.match(firebase, />Retry sync</, 'learners can retry synchronization');
assert.match(firebase, /window\.addEventListener\("online"/, 'pending progress retries when connectivity returns');
assert.match(firebase, /lastRecoveredAt/, 'successful recovery is recorded for launch monitoring');
assert.match(firebase, /pendingProgressSaves/, 'sync health records expose pending work without response content');

assert.match(admin, /data-target="section-launch-health">Launch Health</, 'Launch Health is easy to find under Student Progress');
assert.ok(
  admin.indexOf('data-target="section-student-progress"') < admin.indexOf('data-target="section-launch-health"'),
  'Student Progress appears before Launch Health in the navigation'
);
assert.ok(
  admin.indexOf('id="section-student-progress"') < admin.indexOf('id="section-launch-health"'),
  'Student Progress appears before Launch Health in the page structure'
);
assert.match(admin, /id="lhRefresh"/, 'Launch Health can be refreshed on demand');
assert.match(admin, /Never signed in/, 'Launch Health identifies members who have not signed in');
assert.match(admin, /Orientation incomplete/, 'Launch Health identifies incomplete orientation');
assert.match(admin, /Recent sync recoveries/, 'Launch Health shows known sync recoveries');
assert.match(admin, /completely offline browser cannot report itself/, 'Launch Health explains its real-time limitation');
assert.match(admin, /async function loadLaunchHealth\(\)/, 'Launch Health uses the authenticated member data source');

console.log('launch health and progress sync recovery contracts passed');
