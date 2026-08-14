const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../apps/tsa-diagnostic/index.html'), 'utf8');
const admin = fs.readFileSync(path.resolve(__dirname, '../admin/index.html'), 'utf8');
const literal = (pattern, label) => { const match = source.match(pattern); assert.ok(match, label); return Function(`"use strict"; return ${match[1]}`)(); };
const bank = literal(/const SPOT_QUESTION_BANK=(\[[\s\S]*?\]);(?:\r?\n)/, 'Question bank should be readable');
const promptRules = literal(/const SPOT_PROMPT_RULES=(\{[\s\S]*?\});\n\s*const SPOT_BANK_RELEASE/, 'Question prompt rules should be readable');
const fullPrompt = q => q.prompt.replace(/Which one would you change\?|Which would you add next\?|Which headings would you use\?$/, promptRules[q.format]);

// --- Structure ---
assert.equal(bank.length, 45, 'the bank should have 45 questions');
const legacyAdminMatch = source.match(/const SPOT_QUESTION_BANK=(\[[\s\S]*?\]);\n\s*function spotAssessmentQuestions/);
assert.ok(legacyAdminMatch, 'the diagnostic source should remain compatible with a cached pre-release admin parser');
assert.equal(Function('"use strict"; return (' + legacyAdminMatch[1] + ')')().length, 45, 'the cached admin parser should recover all 45 questions');
assert.match(admin, /adminSource=20260813-question-bank-2/, 'the current admin should cache-bust its canonical diagnostic source request');
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
  assert.match(fullPrompt(q), /at a different level, overlaps another heading, or uses a different grouping rule\?$/, `${q.id} should explain how to diagnose the grouping`);
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
  assert.match(fullPrompt(q), /same level, rather than repeating, sitting inside, or cutting across an existing category\?$/, `${q.id} should define a valid addition`);
});

bank.filter(q => q.format === 3).forEach(q => {
  assert.match(fullPrompt(q), /distinct, same-level headings for analysing this issue\?$/, `${q.id} should define a valid breakdown`);
});

// --- Expert pressure-test regressions: potentially exhaustive frameworks need an explicit boundary ---
const byId = Object.fromEntries(bank.map(question => [question.id, question]));
['f3-01','f3-02','f3-03','f3-04','f3-05','f3-06','f3-07','f3-08','f3-09','f3-10','f3-11','f3-12','f3-13','f3-14'].forEach(id => {
  assert.match(byId[id].prompt, /equation|every|requires|measures|confirmed|one of three|codes/i, `${id} should define the universe that its headings must exhaust`);
});
assert.match(byId['f1-06'].prompt, /Address missing a house number/, 'f1-06 should use an unambiguous child of an address-location failure');
assert.match(byId['f1-11'].prompt, /Burst water pipes/, 'f1-11 should use an unambiguous plumbing subtype');
assert.match(byId['f2-10'].options[byId['f2-10'].answer], /Production stopped for a quality inspection/, 'f2-10 should name an event that actually stops production');
assert.match(byId['f2-12'].rationale, /purpose-and-impact reason/, 'f2-12 rationale should preserve the meaning of work mattering');
assert.match(fullPrompt(byId['f2-14']), /rather than repeating, sitting inside, or cutting across/, 'f2-14 should not imply that fraud signals can never co-occur');
['f2-04','f2-08','f2-11','f2-12'].forEach(id => assert.match(byId[id].prompt, /one primary reason/, `${id} should define a single-code causal system`));
assert.match(byId['f2-14'].prompt, /primary triggering signal/, 'f2-14 should assign overlapping fraud signals by one primary trigger');
assert.match(byId['f3-05'].options[byId['f3-05'].answer], /Work took longer than estimated/, 'f3-05 should mirror the observed delay rather than infer estimation error');
assert.match(byId['f3-11'].prompt, /production matched plan/, 'f3-11 should operationally separate production and sales variance');
assert.match(byId['f3-11'].prompt, /each case assigned to one primary cause/, 'f3-11 should explicitly prevent cause overlap');
assert.match(byId['f3-13'].options[byId['f3-13'].answer], /Confidence in care/, 'f3-13 should mirror the survey wording');
assert.match(byId['f3-15'].options[byId['f3-15'].answer], /Customer arrival pattern/, 'f3-15 should use the precise queueing variable');
assert.equal(byId['f2-13'].options[byId['f2-13'].answer], 'Cleaning quality below standard', 'f2-13 should separate cleaning quality from amenities and linen condition');
assert.match(byId['f3-05'].rationale, /one possible explanation for it/, 'f3-05 should treat optimistic estimates as a possible explanation, not a subset');
assert.match(byId['f3-15'].rationale, /upstream factor that may affect/, 'f3-15 should not claim staffing alone determines open tills');
assert.match(byId['f3-01'].rationale, /introduces an ambiguous factor/, 'f3-01 should not imply that rising selling prices contain food and staff costs');
assert.match(byId['f1-06'].rationale, /different grouping rule/, 'f1-06 should explain the mixed information-versus-outcome axis');
assert.doesNotMatch(byId['f1-06'].rationale, /sits inside/, 'f1-06 should not claim an incomplete address always prevents location');
assert.match(byId['f2-03'].prompt, /one primary reason/, 'f2-03 should define a primary rejection classification');
assert.match(byId['f2-15'].prompt, /one primary category/, 'f2-15 should define a primary supplier-problem classification');

// --- Runtime draw: 5 questions per format, 15 total, persisted with the attempt so it does not reshuffle on reload ---
assert.match(source, /if\(!Array\.isArray\(state\.spot\.questionIds\)\|\|state\.spot\.questionIds\.length!==15\)/, 'the normal learner draw should persist exactly 15 questions once chosen');
assert.match(source, /const previewBank=previewFormat\?SPOT_QUESTION_BANK\.filter/, 'the admin learner-view preview should support one question format at a time');
assert.match(source, /:SPOT_QUESTION_BANK;state\.spot\.questionIds=previewBank\.map/, 'the all-formats preview should still include all 45 questions');
assert.match(source, /function pick5\(ids\)/, 'each format should contribute five questions');
assert.match(source, /take\(candidates\('accessible'\),1\).*take\(candidates\('core'\),2\).*take\(candidates\('stretch'\),2\)/, 'each format should draw one accessible, two core, and two stretch questions');
assert.match(source, /const picked=\[\.\.\.pick5\(byFormat\[1\]\),\.\.\.pick5\(byFormat\[2\]\),\.\.\.pick5\(byFormat\[3\]\)\]/, 'the draw should pull five questions from each of the three formats');
assert.match(source, /for\(let i=picked\.length-1;i>0;i--\)/, 'the three formats should be mixed rather than shown in blocks');

// --- Definitive-answer contract ---
assert.doesNotMatch(JSON.stringify(bank), /None of the above/i, 'the bank should never rely on None of the above');
assert.match(source, /Every question has exactly one correct answer/, 'the learner instructions should state the single-answer contract');
bank.forEach(q => assert.equal(bank.filter(other => other.id === q.id && other.answer === q.answer).length, 1, `${q.id} should have one stored answer key`));

// --- Admin question bank viewer stays in sync with the new structure ---
assert.match(admin, /const bank = qbReadLiteral\(source, \/const SPOT_QUESTION_BANK=.*\\r\?\\n/, 'admin viewer should read the bank without depending on its following declaration');
assert.match(admin, /id="qbFormat"/, 'admin viewer should let reviewers isolate a format');
assert.match(admin, /id="qbDownloadCsv"/, 'admin viewer should provide a spreadsheet download');
assert.match(admin, /id="qbDownloadJson"/, 'admin viewer should provide a JSON download');
assert.match(admin, /id="qbHealthRows"/, 'admin viewer should include item health analytics');
assert.match(admin, /assessment_item_attempts/, 'admin viewer should load item-level attempt records');
assert.match(admin, /assessment_item_reviews/, 'admin viewer should save human review history');
assert.match(admin, /45 of \$\{qbBank\.length\}|\$\{qbBank\.length\} questions/, 'admin viewer should summarize the total question count');

console.log('TSA question bank structure, rotation, and admin viewer contract passed');
