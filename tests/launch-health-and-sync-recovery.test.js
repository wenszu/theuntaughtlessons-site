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

assert.match(admin, /data-target="section-launch-health">Learner readiness</, 'Learner readiness is easy to find under Student Progress');
assert.match(admin, /data-target="section-site-reliability">Technical reliability</, 'technical reliability is easy to find under Preview & Health');
assert.ok(
  admin.indexOf('data-target="section-student-progress"') < admin.indexOf('data-target="section-launch-health"'),
  'Student Progress appears before Learner readiness in the navigation'
);
assert.ok(
  admin.indexOf('id="section-student-progress"') < admin.indexOf('id="section-launch-health"'),
  'Student Progress appears before Learner readiness in the page structure'
);
assert.match(admin, /id="lhRefresh"/, 'Learner readiness can be refreshed on demand');
assert.match(admin, /id="srRefresh"/, 'Technical reliability can be refreshed on demand');
assert.match(admin, /Never signed in/, 'Learner readiness identifies members who have not signed in');
assert.match(admin, /Orientation incomplete/, 'Learner readiness identifies incomplete orientation');
assert.match(admin, /Recent sync recoveries/, 'Technical reliability shows known sync recoveries');
assert.match(admin, /browser must reconnect before it can report an offline incident/i, 'Technical reliability explains its reporting limitation');
assert.match(admin, /async function loadLaunchHealth\(forceRefresh\)/, 'Both views use the authenticated member data source');

console.log('launch health and progress sync recovery contracts passed');
