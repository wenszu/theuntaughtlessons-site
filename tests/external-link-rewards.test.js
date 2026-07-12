const assert = require('assert');
const fs = require('fs');

const externalExercises = [
  { file: 'apps/i-have-bad-news/index.html', appId: 'i-have-bad-news', doneKey: 'utl_done_p3-e2' },
  { file: 'apps/lets-switch-hats/index.html', appId: 'lets-switch-hats', doneKey: 'utl_done_p3-e3' },
  { file: 'apps/speak-like-obama/index.html', appId: 'speak-like-obama', doneKey: 'utl_done_p3-e4' }
];

externalExercises.forEach(({ file, appId, doneKey }) => {
  const source = fs.readFileSync(file, 'utf8');
  assert(source.includes('id="completeExerciseBtn"'), `${file} needs a simple completion button`);
  assert(source.includes('Mark exercise complete · +30 MP'), `${file} should disclose the external-exercise reward`);
  assert(source.includes(`localStorage.setItem('${doneKey}', 'true')`), `${file} should save its canonical completion key`);
  assert(source.includes('awardReflectionExercise({'), `${file} should use the 30 MP reflection/external-AI reward`);
  assert(source.includes(`appId: '${appId}'`), `${file} should use a stable reward event id`);
  assert(source.includes('assets/reward-events.js'), `${file} should load the reward event API`);
});

console.log('external-link completion and reward contracts passed');
