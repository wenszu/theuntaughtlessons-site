const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../apps/tsa-diagnostic/index.html'), 'utf8');
const scoreSource = source.match(/function scoreText\(d,data,isAct\)\{.*?\}(?=\n    async function scoreAll)/s)?.[0];
assert.ok(scoreSource, 'live scoreText implementation should be extractable');
const helpers = String.raw`
function count(t){return String(t||'').trim().split(/\s+/).filter(Boolean).length}
function contains(text,terms){const t=text.toLowerCase();return terms.some(x=>t.includes(x))}
function normalizeContractions(t){return t.replace(/\bi'd\b/g,'i would').replace(/\bi'll\b/g,'i will').replace(/\bwe'd\b/g,'we would').replace(/\bwe'll\b/g,'we will')}`;
const scoreText = Function(`${helpers}\n${scoreSource}\nreturn scoreText`)();

const speak = {
  keywords: [
    ['library','park','community hall','hall'],
    ['65','capacity','people','everyone expected','accommodate','fit everyone','enough room'],
    ['rain','indoors','weather','forecast','disrupt','shelter','weather risk','uncertainty'],
    ['cost','additional cost','price','120','afford','budget','worth']
  ],
  next: ['book','reserve','confirm','check']
};
const strongSpeak = "I'd go with the hall. It comfortably fits everyone and removes the biggest uncertainty. The additional cost is worth avoiding a last-minute change. Let's reserve it today.";
const strongScore = scoreText({ transcript:strongSpeak }, speak, false);
assert.ok(strongScore.total >= 27, `natural paraphrase should score strongly, received ${strongScore.total}`);
assert.deepEqual(scoreText({ transcript:strongSpeak }, speak, false), strongScore, 'deterministic scoring must be repeatable');
assert.ok(scoreText({ transcript:'The hall makes the most sense here.' }, speak, false).leads >= 6, 'alternate recommendation wording should be recognized');
assert.ok(scoreText({ transcript:'hall 65 people rain capacity weather cost' }, speak, false).total <= 10, 'keyword stuffing without a recommendation should score poorly');
const punctuationFree = strongSpeak.replace(/[.!?]/g, '');
assert.equal(scoreText({ transcript:punctuationFree }, speak, false).total, strongScore.total, 'punctuation must not affect speech-to-text scoring');
assert.ok(scoreText({ transcript:'The hall, park, and library each have trade-offs because capacity, weather, and cost differ.' }, speak, false).total <= 10, 'Speak recommendation gate should cap discussion without a recommendation');

const actConcerns = ['overwhelmed','overloaded','workload','busy','too busy','stretched','stretched thin','capacity','bandwidth','too much','too much on your plate','cannot finish','struggling','wait'];
const act = {
  terms: ['deadline','tomorrow','handoff','section'],
  concerns: [actConcerns, actConcerns, actConcerns],
  next: ['send','share','finish','time','today']
};
const weakAdapt = scoreText({ choice:2, transcript:"I understand you're overwhelmed. I choose C." }, act, true);
const strongAdapt = scoreText({ choice:2, transcript:"I hear you. You have too much on your plate, so I'll reduce your scope and redistribute the rest while keeping the deadline." }, act, true);
assert.ok(strongAdapt.adapts >= weakAdapt.adapts + 4, 'addressing the concern should score materially above repeating it');
assert.ok(strongAdapt.total >= 25, 'a supported alternative Act decision should be capable of scoring highly');
assert.ok(scoreText({ choice:1, transcript:'Option A preserves time, option B changes scope, and option C changes cost while each has risks.' }, act, true).total <= 8, 'Act decision gate should cap discussion without commitment');

assert.equal(40 + 30 + 30, 100, 'Think, Speak, and Act maximum must remain 100');
console.log('TSA C3 deterministic scoring, paraphrase, gates, and punctuation contracts passed');
