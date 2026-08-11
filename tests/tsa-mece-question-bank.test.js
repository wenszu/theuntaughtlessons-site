const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../apps/tsa-diagnostic/index.html'), 'utf8');
const admin = fs.readFileSync(path.resolve(__dirname, '../admin/index.html'), 'utf8');
const literal = (pattern, label) => { const match = source.match(pattern); assert.ok(match, label); return Function(`"use strict"; return ${match[1]}`)(); };
const bank = literal(/const SPOT_QUESTION_BANK=(\[[\s\S]*?\]);\n\s*const SPOT_DIFFICULTY/, 'Question bank should be readable');

// --- Structure ---
assert.equal(bank.length, 45, 'the bank should have 45 questions');
assert.equal(new Set(bank.map(q => q.id)).size, 45, 'question ids should be unique');
for (const format of [1, 2, 3]) assert.equal(bank.filter(q => q.format === format).length, 15, `format ${format} should have fifteen questions`);

for (const q of bank) {
  assert.ok(q.prompt.trim().endsWith('?'), `${q.id} prompt should be phrased as a question`);
  assert.equal(q.options.length, 4, `${q.id} should have four options`);
  assert.equal(new Set(q.options).size, 4, `${q.id} options should be unique`);
  assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4, `${q.id} should have a valid answer index`);
  assert.ok(q.rationale && q.rationale.length >= 30, `${q.id} should have a substantive rationale`);
}

// --- Format 1 asks the learner to identify one specific heading from the scenario ---
bank.filter(q => q.format === 1).forEach(q => {
  assert.match(q.prompt, /Which one would you change\?$/, `${q.id} should use the heading-review prompt`);
  q.options.forEach(option => assert.ok(q.prompt.includes(option), `${q.id} option should be a heading shown in its scenario`));
});

// --- Rotation: the correct letter should be roughly even across each 15-question format, not clustered on one letter ---
for (const format of [1, 2, 3]) {
  const counts = { 0: 0, 1: 0, 2: 0, 3: 0 };
  bank.filter(q => q.format === format).forEach(q => counts[q.answer]++);
  Object.entries(counts).forEach(([letter, count]) => {
    assert.ok(count >= 3 && count <= 4, `format ${format} letter ${letter} should appear 3-4 times for even rotation, appeared ${count}`);
  });
}

// --- No framework jargon leaks to the test-taker anywhere visible ---
const banned = /\bMECE\b|mutually exclusive|collectively exhaustive/i;
bank.forEach(q => {
  assert.ok(!banned.test(q.prompt), `${q.id} prompt must not name the underlying framework`);
  q.options.forEach(o => assert.ok(!banned.test(o), `${q.id} options must not name the underlying framework`));
});

// --- Format 2 asks for the one additional category that completes the given set ---
bank.filter(q => q.format === 2).forEach(q => {
  assert.match(q.prompt, /Which would you add next\?$/, `${q.id} should ask for the next category`);
});

// --- Runtime draw: 5 questions per format, 15 total, persisted with the attempt so it does not reshuffle on reload ---
assert.match(source, /function spotAssessmentQuestions\(\)\{if\(!Array\.isArray\(state\.spot\.questionIds\)\|\|state\.spot\.questionIds\.length!==15\)/, 'the draw should persist exactly 15 questions once chosen');
assert.match(source, /function pick5\(ids\)/, 'each format should contribute five questions');
assert.match(source, /take\(candidates\('accessible'\),1\).*take\(candidates\('core'\),2\).*take\(candidates\('stretch'\),2\)/, 'each format should draw one accessible, two core, and two stretch questions');
assert.match(source, /const picked=\[\.\.\.pick5\(byFormat\[1\]\),\.\.\.pick5\(byFormat\[2\]\),\.\.\.pick5\(byFormat\[3\]\)\]/, 'the draw should pull five questions from each of the three formats');
assert.match(source, /for\(let i=picked\.length-1;i>0;i--\)/, 'the three formats should be mixed rather than shown in blocks');

// --- Definitive-answer contract ---
assert.doesNotMatch(JSON.stringify(bank), /None of the above/i, 'the bank should never rely on None of the above');
assert.match(source, /Every question has exactly one correct answer/, 'the learner instructions should state the single-answer contract');
bank.forEach(q => assert.equal(bank.filter(other => other.id === q.id && other.answer === q.answer).length, 1, `${q.id} should have one stored answer key`));

// --- Admin question bank viewer stays in sync with the new structure ---
assert.match(admin, /const bank = qbReadLiteral\(source, \/const SPOT_QUESTION_BANK=/, 'admin viewer should read the renamed bank constant');
assert.match(admin, /id="qbFormat"/, 'admin viewer should let reviewers isolate a format');
assert.match(admin, /45 of \$\{qbBank\.length\}|\$\{qbBank\.length\} questions/, 'admin viewer should summarize the total question count');

console.log('TSA question bank structure, rotation, and admin viewer contract passed');
