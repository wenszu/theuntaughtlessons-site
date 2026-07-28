const assert = require('node:assert/strict');
const fs = require('node:fs');

const widget = fs.readFileSync('assets/feedback-widget.js', 'utf8');
const scqa = fs.readFileSync('apps/scqa-builder/index.html', 'utf8');
const issueTree = fs.readFileSync('apps/issue-tree-builder/index.html', 'utf8');
const eisenhower = fs.readFileSync('apps/eisenhower-matrix/index.html', 'utf8');

assert(widget.includes('installCollisionAvoidance'), 'feedback widget includes shared collision avoidance');
assert(widget.includes('window.getComputedStyle(element)'), 'collision handling checks actual fixed and sticky positioning');
assert(widget.includes('window.innerHeight - obstacleTop + 16'), 'feedback button moves above bottom controls');
assert(widget.includes('utl-feedback-avoiding'), 'feedback button becomes compact while avoiding an action bar');
assert(widget.includes('.bottom-bar'), 'shared handling covers sticky exercise bottom bars');
assert(widget.includes('.eisenhower-actions'), 'shared handling covers fixed exercise footers');
assert(scqa.includes('class="bottom-bar"'), 'SCQA uses a covered sticky bottom bar');
assert(issueTree.includes('class="bottom-bar"'), 'Issue tree uses a covered sticky bottom bar');
assert(eisenhower.includes('class="feedback"') && eisenhower.includes('.feedback{position:fixed'), 'Eisenhower uses a covered fixed feedback dock');

const exercisePages = fs.readdirSync('apps')
  .filter((name) => fs.existsSync(`apps/${name}/index.html`))
  .map((name) => fs.readFileSync(`apps/${name}/index.html`, 'utf8'));
exercisePages.filter((page) => page.includes('feedback-widget.js')).forEach((page) => {
  assert(page.includes('feedback-widget.js?v=6'), 'exercise pages load the collision-safe feedback widget');
});

console.log('feedback widget avoids sticky and fixed exercise actions');
