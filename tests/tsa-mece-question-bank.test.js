const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../apps/tsa-diagnostic-v2/index.html'), 'utf8');
const admin = fs.readFileSync(path.resolve(__dirname, '../admin/index.html'), 'utf8');
const literal = (pattern, label) => { const match=source.match(pattern); assert.ok(match, label); return Function(`"use strict"; return ${match[1]}`)(); };
const bank = literal(/const MECE_QUIZ_BANK=(\[[\s\S]*?\]);\n    const QUESTION_DIFFICULTY/, 'MECE bank should be readable');
const difficulty = literal(/const QUESTION_DIFFICULTY=(\{[^;]+\});/, 'difficulty metadata should exist');
const rationales = literal(/const QUESTION_RATIONALES=(\{[\s\S]*?\});\n    MECE_QUIZ_BANK/, 'rationales should be readable');
const part1 = literal(/const PART1_ASSIGNMENTS=(\{[\s\S]*?\});\n    const QUIZ_ASSIGNMENTS/, 'Part 1 assignments should be readable');
const part2 = literal(/const QUIZ_ASSIGNMENTS=(\{[\s\S]*?\});\n    function seededPositionOrder/, 'Part 2 assignments should be readable');
const byId = new Map(bank.map(question => [question.id, question]));

assert.equal(bank.length, 56);
assert.equal(new Set(bank.map(q=>q.id)).size, 56);
assert.equal(bank.filter(q=>q.type==='overlap').length, 20);
for (const type of ['gap','level','misplaced','revision']) assert.equal(bank.filter(q=>q.type===type).length, 9);
for (const q of bank) {
  assert.ok(q.prompt.endsWith('?'), `${q.id} should be a question`);
  assert.equal(q.options.length, 4, `${q.id} should store four source choices`);
  assert.equal(new Set(q.options).size, 4, `${q.id} choices should be unique`);
  assert.ok(Number.isInteger(q.answer) && q.answer>=0 && q.answer<4, `${q.id} should have a source answer`);
  assert.ok(difficulty[q.id], `${q.id} should have difficulty metadata`);
  assert.ok(rationales[q.id] && rationales[q.id].length>=50, `${q.id} should have a rationale`);
}

for (const kind of ['diagnostic','checkpoint']) for (const form of ['A','B','C']) {
  const p1=part1[kind][form].map(id=>byId.get(id));
  assert.equal(p1.length,5); assert.equal(new Set(p1.map(q=>q.id)).size,5); assert.ok(p1.every(q=>q.type==='overlap'));
  assert.deepEqual(p1.reduce((c,q)=>(c[difficulty[q.id]]++,c),{accessible:0,moderate:0,hard:0}),{accessible:1,moderate:3,hard:1});
  const p2=part2[kind][form].map(id=>byId.get(id));
  assert.equal(p2.length,10); assert.equal(new Set(p2.map(q=>q.id)).size,10); assert.ok(p2.every(q=>q.type!=='overlap'));
  assert.deepEqual(p2.reduce((c,q)=>(c[q.type]++,c),{gap:0,level:0,misplaced:0,revision:0}),{gap:3,level:2,misplaced:2,revision:3});
  assert.deepEqual(p2.reduce((c,q)=>(c[difficulty[q.id]]++,c),{accessible:0,moderate:0,hard:0}),{accessible:2,moderate:6,hard:2});
  assert.equal(p2.filter(q=>q.noneCorrect).length,2, `${kind} ${form} should use None as the key twice`);
}
const checkpointFor={A:'B',B:'C',C:'A'};
for (const form of ['A','B','C']) {
  assert.equal(part1.checkpoint[checkpointFor[form]].filter(id=>new Set(part1.diagnostic[form]).has(id)).length,0);
  assert.equal(part2.checkpoint[checkpointFor[form]].filter(id=>new Set(part2.diagnostic[form]).has(id)).length,0);
}
assert.equal(Object.keys(difficulty).length,56); assert.equal(Object.keys(rationales).length,56);
assert.deepEqual(bank.reduce((c,q)=>(c[difficulty[q.id]]++,c),{accessible:0,moderate:0,hard:0}),{accessible:10,moderate:33,hard:13},'the full bank should use the 18% / 59% / 23% difficulty ramp');
assert.match(source,/version:'mc8',date:'2026-08-01'/);
assert.equal((bank.filter(question=>question.type==='level'&&question.prompt.includes('Which heading is not at the same level as the other three?')).length),9,'every Mixed Levels item should use the standardized stem');
assert.equal((bank.filter(question=>question.type==='level'&&question.prompt.includes('Look for')).length),9,'every Mixed Levels item should state the hierarchy direction');
assert.equal(bank.filter(question=>question.type==='level'&&/specific (action|example)/.test(question.prompt)).length,4,'four Mixed Levels items explicitly ask for a specific action or example');
assert.equal(bank.filter(question=>question.type==='level'&&question.prompt.includes('parent category')).length,4,'four Mixed Levels items explicitly ask for a parent category');
assert.equal(bank.filter(question=>question.type==='level'&&question.prompt.includes('result mixed with the drivers')).length,1,'one Mixed Levels item explicitly asks for a result among its drivers');
for (const id of ['g4','g5','g6','g7','g9']) {
  const question=byId.get(id);
  assert.ok(question && !question.noneCorrect, `${id} should test a named missing parent category`);
  assert.match(rationales[id],/(examples? inside|examples? within|part of)/, `${id} rationale should explain why distractors are child items`);
}

const seeded=(seed,length,choiceCount)=>{const p=Array.from({length},(_,i)=>i%choiceCount);let h=2166136261;for(const ch of String(seed)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}for(let i=p.length-1;i>0;i--){h=(Math.imul(h,1664525)+1013904223)>>>0;const j=h%(i+1);[p[i],p[j]]=[p[j],p[i]]}return p};
assert.deepEqual(seeded('part1',5,4).sort(),[0,0,1,2,3]);
assert.deepEqual(seeded('part2',10,4).sort(),[0,0,0,1,1,1,2,2,3,3]);
assert.match(source,/\[\.\.\.source\.options,'None of the above'\]/);
assert.match(source,/source\.noneCorrect\?4:source\.answer/);
assert.match(source,/includeNone&&order\[4\]!==4/, 'saved orders with None outside the last position should be repaired');
assert.match(source,/if\(includeNone\)order\.push\(4\)/, 'None of the above should always render last');
assert.match(admin,/20 overlap questions used by Challenge 2 Part 1 and the 36 structure questions/);
assert.match(admin,/shownOptions=.*'None of the above'/);
assert.match(admin,/correctIndex=.*question\.noneCorrect/);
assert.match(admin,/id="qbPart"/, 'Admin should let reviewers isolate Part 1 or Part 2');
assert.match(admin,/Part 1: \$\{part1Count\}/, 'Admin should summarize visible Part 1 questions');
assert.match(admin,/Part 2: \$\{part2Count\}/, 'Admin should summarize visible Part 2 questions');
assert.match(admin,/Accessible: \$\{difficultyCounts\.accessible\}/, 'Admin should summarize the visible difficulty ramp');
assert.match(admin,/questionPart==='part1'\?'Part 1':'Part 2'/, 'Every question card should identify its part');
assert.match(admin,/“None of the above” stays last/, 'Admin should explain the fixed None placement');
console.log('TSA MECE question bank structure and rotation passed');
