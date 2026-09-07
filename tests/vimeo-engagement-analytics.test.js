const assert = require('node:assert/strict');
const fs = require('node:fs');

const tracker = fs.readFileSync('assets/engagement-analytics.js', 'utf8');
const firebase = fs.readFileSync('assets/firebase.js', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');
const workspace = fs.readFileSync('member-login/content-config.js', 'utf8');
const admin = fs.readFileSync('admin/index.html', 'utf8');

assert.match(workspace, /data-vimeo-analytics="true"/);
assert.match(workspace, /new Vimeo\.Player\(frame\)/);
assert.match(workspace, /utl:vimeo-progress/);
assert.match(workspace, /percent >= 90/);
assert.match(workspace, /syncVimeoCourseCompletion/);
assert.match(workspace, /writeBool\(watchedKey\(lesson\.id\), true\)/);
assert.match(workspace, /watchDeltaSeconds/);
assert.match(tracker, /videoWatchSeconds/);
assert.match(tracker, /videoMaxPercent/);
assert.match(tracker, /videoMilestones/);
assert.match(firebase, /videoCompleted/);
assert.match(rules, /'video_progress', 'video_completed'/);
assert.match(rules, /'videoId', 'videoDurationSeconds', 'videoWatchSeconds'/);
assert.match(admin, /Median video coverage/);
assert.match(admin, /Most common video drop-off/);
assert.match(admin, /data-ei-panel="videos"/);
assert.match(admin, /Playback is counted only after a learner presses play in Vimeo/);
assert.match(admin, /source:'vimeo-90-percent'/);

console.log('Vimeo engagement analytics contracts passed');
