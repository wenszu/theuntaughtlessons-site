const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../my-results/index.html'), 'utf8');

// The diagnostic and checkpoint must never share live state again — this is the exact
// bug the v1 retirement fixed (checkpoint used to overwrite the diagnostic's scores).
assert.doesNotMatch(source, /tsa_sort_score|tsa_spot_score|tsa_speak_score/, 'my-results must not read the retired shared v1 score keys');
assert.doesNotMatch(source, /apps\/tsa-checkpoint\/|apps\/tsa-diagnostic-v2\//, 'my-results must not link to retired v1/v2 paths');
assert.match(source, /utl_result_tsa_'\s*\+\s*kind\s*\+\s*'_v2'/, 'my-results should read the independent per-kind v2 result keys');
assert.match(source, /kind:\s*'diagnostic'/);
assert.match(source, /kind:\s*'checkpoint'/);
assert.match(source, /tsa-diagnostic\/index\.html\?assessment=checkpoint/, 'the checkpoint should route through the sole assessment via the assessment query param');
assert.match(source, /diagnosticResult\s*&&\s*checkpointResult/, 'a comparison should only render once both independent results exist');
assert.match(source, /class="assessment-total"/, 'assessment cards should make the total score visually primary');
assert.match(source, /class="assessment-breakdown"/, 'assessment cards should separate the Think, Speak, and Act breakdown');
assert.match(source, /score\('Think', s\.think, 40\).*score\('Speak', s\.speak, 30\).*score\('Act', s\.act, 30\)/s, 'assessment scorecards should preserve the official dimensions and maxima');

console.log('my-results TSA independence contract passed');
