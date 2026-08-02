const assert = require('node:assert/strict');
const fs = require('node:fs');

const scqa = fs.readFileSync('apps/scqa-builder/index.html', 'utf8');
const data = JSON.parse(fs.readFileSync('data/practice/scqa-builder.json', 'utf8'));
const workspace = fs.readFileSync('member-login/content-config.js', 'utf8');

assert.equal(data[0].practiceScenarios.length, 5, 'SCQA provides exactly five optional practice topics');
assert(scqa.includes('Practice another SCQA'), 'completed SCQA offers another practice round');
assert(scqa.includes('#practiceScenarioPanel { border: 1px solid rgba(238,163,32,.72); background: #FFF8EC; }'), 'optional practice is visually distinct from required review content');
assert(scqa.includes('practice-scenario-option'), 'practice topics use comparable selection cards');
assert(scqa.includes('function updatePracticeScenarioSelection()'), 'changing a topic updates cards in place without closing the picker');
assert(scqa.includes('data-practice-scenario=') && scqa.includes('aria-pressed='), 'topic cards use stable selection buttons instead of browser radio toggles');
assert(!scqa.includes('input type="radio" name="practiceScenario"'), 'topic selection does not rebuild or toggle radio inputs');
assert(scqa.includes('Feedback on your SCQA') && scqa.includes('Structure check') && scqa.includes('Optional AI review'), 'rules and optional AI feedback share one review panel');
assert(scqa.includes('class="passed-checks"'), 'passed rules collapse so review emphasizes items needing attention');
assert(scqa.includes('urlParams.get("practice") === "1"'), 'a direct link can open the practice picker later');
assert(scqa.includes('urlParams.get("attempt") === "olympics"'), 'a direct review link returns to the required SCQA');
assert(scqa.includes('if (state.completedOnce && state.practiceScenarioId)'), 'practice saves do not repeat required exercise completion');
assert(workspace.includes('Review my SCQA') && workspace.includes('Practice another SCQA'), 'completed Learning Journey preview offers review and practice choices');
assert(workspace.includes('scqaPracticeCount()'), 'Learning Journey can report completed optional practice rounds');

const titles = data[0].practiceScenarios.map((scenario) => scenario.title);
assert(titles.includes('Household responsibilities feel uneven'), 'practice includes an everyday household situation');
assert(titles.includes('Friends cannot agree on a group trip'), 'practice includes an everyday planning situation');
assert(titles.includes('A school group project is off track'), 'practice includes a school situation');

console.log('SCQA optional practice flow contracts passed');
