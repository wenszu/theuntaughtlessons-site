// The Executive Signature full facet report, drawn again from the scores the server stored.
// Run: node tests/executive-signature-facet-report.test.js
//
// 1. apps/executive-signature/facet-report.js reads the ten stored facet scores and agrees with the server's scoring
//    (functions-admin/executive-signature-versions.js) and with the page's own scoreFull (apps/executive-signature/index.html)
//    on random answer sets: readiness score, band, profile, strengths and growth edges.
// 2. The server mirror already keeps what the report needs: the attempt row with all ten facet scores, and the raw
//    answers with the item order. A mirrored row read back gives the same report.
// 3. The My Results page of the assessment shows the report from the status, hides it when the ten facets are not stored,
//    and escapes everything it draws.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = path.resolve(__dirname, '..');
const report = require('../apps/executive-signature/facet-report.js');
const { getVersion, normalizeAnswers, scoreVersion } = require('../functions-admin/executive-signature-versions');
const mirror = require('../functions-admin/supabase-mirror/payments-assessments');
const pageSource = fs.readFileSync(path.join(REPO_ROOT, 'apps/executive-signature/index.html'), 'utf8');
const myResults = fs.readFileSync(path.join(REPO_ROOT, 'apps/executive-signature/my-results/index.html'), 'utf8');
const facetSource = fs.readFileSync(path.join(REPO_ROOT, 'apps/executive-signature/facet-report.js'), 'utf8');

let checks = 0;
const ok = (condition, name) => { checks += 1; assert.ok(condition, name); };
const eq = (actual, expected, name) => { checks += 1; assert.deepStrictEqual(actual, expected, name); };

// The real content file, loaded the way the browser loads it.
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(REPO_ROOT, 'apps/executive-signature/content.js'), 'utf8'), sandbox);
const CONTENT = sandbox.window.READINESS_CONTENT;
ok(CONTENT && Array.isArray(CONTENT.bands) && CONTENT.facets, 'content.js loads');

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VERSION = getVersion('readiness-full@1.0.0');
function randomAnswers(random) {
  const answers = {};
  VERSION.questions.forEach((question) => { answers[question.id] = 1 + Math.floor(random() * 5); });
  return answers;
}

// The page's own scoring function, cut out of index.html and run with the page's own settings.
function pageScoreFull() {
  const start = pageSource.indexOf('function scoreFull(');
  const end = pageSource.indexOf('function renderFullResult(', start);
  assert.ok(start > 0 && end > start, 'scoreFull found in the page');
  const context = {
    FULL_ITEMS: VERSION.questions.map((q) => ({ id: q.id, domain: q.area, key: q.direction })),
    READINESS_FACETS: report.READINESS_FACETS,
    SETTINGS: { levelLow: 40, levelHigh: 60, voiceLow: 40, voiceHigh: 60, closeGap: 10 },
    DATA: {
      bands: CONTENT.bands.map((b) => [b.label, b.min, b.looksLike]),
      profiles: Object.entries(report.PROFILES).map(([key, name]) => [...key.split('|'), name])
    }
  };
  vm.runInNewContext(`${pageSource.slice(start, end)}\nthis.scoreFull = scoreFull;`, context);
  return context.scoreFull;
}
const scoreFull = pageScoreFull();

// ---- 1. agreement with the server and the page -----------------------------------------------------------

const random = mulberry32(20261008);
let compared = 0;
for (let round = 0; round < 400; round += 1) {
  const answers = randomAnswers(random);
  const server = scoreVersion(VERSION, normalizeAnswers(VERSION, answers));
  ok(report.hasFacetScores(server.areaScores), 'the server stores all ten facets');
  const reading = report.readingFromAreaScores(server.areaScores, { bands: CONTENT.bands });
  const page = scoreFull(answers);
  if (reading.readiness !== server.overallScore) eq(reading.readiness, server.overallScore, `round ${round}: readiness matches the server`);
  if (reading.band !== server.band) eq(reading.band, server.band, `round ${round}: band matches the server`);
  if (reading.profile !== server.profileLabel) eq(reading.profile, server.profileLabel, `round ${round}: profile matches the server`);
  if (reading.driveCloseCall !== server.driveCloseCall) eq(reading.driveCloseCall, server.driveCloseCall, `round ${round}: close call matches the server`);
  if (reading.readiness !== page.readiness || reading.band !== page.band || reading.profile !== page.profile[2]) {
    eq([reading.readiness, reading.band, reading.profile], [page.readiness, page.band, page.profile[2]], `round ${round}: matches the page`);
  }
  // The page shows strengths and growth edges from the rounded values (renderFullResult); a stable sort on the rounded values.
  const pageRanked = report.READINESS_FACETS.map((f) => [f, Math.round(page.shown[f])]).sort((a, b) => b[1] - a[1]);
  const pageStrengths = pageRanked.slice(0, 2).map((e) => e[0]);
  const pageGrowth = pageRanked.slice(-2).reverse().map((e) => e[0]);
  if (JSON.stringify(reading.strengths) !== JSON.stringify(pageStrengths) || JSON.stringify(reading.growthEdges) !== JSON.stringify(pageGrowth)) {
    eq([reading.strengths, reading.growthEdges], [pageStrengths, pageGrowth], `round ${round}: strengths and growth edges match the page`);
  }
  report.ALL_FACETS.forEach((facet) => {
    if (Math.abs(reading.shown[facet] - page.shown[facet]) >= 0.0005) eq(reading.shown[facet], page.shown[facet], `round ${round}: ${facet} score`);
  });
  compared += 1;
}
ok(compared === 400, 'four hundred random answer sets agree with the server and with the page');
ok(new Set(Array.from({ length: 50 }, () => report.readingFromAreaScores(scoreVersion(VERSION, normalizeAnswers(VERSION, randomAnswers(random))).areaScores).profile)).size >= 4, 'the random sets cover several profiles');

eq(report.readingFromAreaScores({ Extraversion: 55, Agreeableness: 70 }), null, 'quick check scores (five areas) have no facet report');
eq(report.readingFromAreaScores(null), null, 'nothing stored gives no report');
const nine = Object.assign({}, scoreVersion(VERSION, normalizeAnswers(VERSION, randomAnswers(random))).areaScores);
delete nine.Altruism;
eq(report.readingFromAreaScores(nine), null, 'nine facets are not enough');
nine.Altruism = 'high';
eq(report.readingFromAreaScores(nine), null, 'a facet that is not a number is not enough');
eq(report.hasFacetScores({}), false, 'empty scores');

// Scores outside the scale are held to 0 to 100 and the thresholds sit where the page puts them.
const edge = {};
report.ALL_FACETS.forEach((facet) => { edge[facet] = 40; });
eq(report.readingFromAreaScores(edge).voice, 'Balanced', 'a voice score of exactly 40 is balanced');
edge.Assertiveness = 39.999;
eq(report.readingFromAreaScores(edge).voice, 'Reserved', 'just under 40 is reserved');
edge.Assertiveness = 130;
eq(report.readingFromAreaScores(edge).shown.Assertiveness, 100, 'a score above 100 is held at 100');
eq(report.readingFromAreaScores(edge).voice, 'Vocal', 'high voice is vocal');
eq(report.readingFromAreaScores(Object.assign({}, edge, { 'Achievement-Striving': 50, Altruism: 50 })).drive, 'Achievement-driven', 'a tie goes to achievement, as on the page');

// ---- 2. the mirror keeps what the report needs ---------------------------------------------------------------

const answers = randomAnswers(mulberry32(7));
const scored = scoreVersion(VERSION, normalizeAnswers(VERSION, answers));
const itemOrder = VERSION.questions.map((q) => q.id).reverse();
const personId = '11111111-1111-4111-8111-111111111111';
const writes = [
  { path: 'assessmentAttempts/att-es-1', data: {
    schemaVersion: 1, customerId: 'cust-1', programId: 'executive-signature', assessmentId: 'full-assessment', versionId: VERSION.versionId,
    formVersion: VERSION.formVersion, scoringVersion: VERSION.scoringVersion, contentVersion: VERSION.contentVersion, status: 'completed',
    idempotencyHash: 'a'.repeat(64), startedAt: new Date('2026-10-01T10:00:00Z'), completedAt: new Date('2026-10-01T10:08:00Z'), durationSeconds: 480,
    overallScore: scored.overallScore, areaScores: scored.areaScores, profileLabel: scored.profileLabel, band: scored.band,
    responseChecksum: 'b'.repeat(64), resultChecksum: 'c'.repeat(64), consentEventIds: [], source: { channel: 'web' }, createdBy: 'uid-1'
  } },
  { path: 'assessmentAttempts/att-es-1/responseParts/part-1', data: {
    schemaVersion: 1, attemptId: 'att-es-1', customerId: 'cust-1', partNumber: 1, partCount: 2,
    answers: VERSION.questions.slice(0, 20).map((q) => ({ questionId: q.id, value: answers[q.id] })),
    scoringInputs: { itemOrder, scoringVersion: VERSION.scoringVersion, config: scored.scoringInputs }, payload: null, responseChecksum: 'd'.repeat(64)
  } },
  { path: 'assessmentAttempts/att-es-1/responseParts/part-2', data: {
    schemaVersion: 1, attemptId: 'att-es-1', customerId: 'cust-1', partNumber: 2, partCount: 2,
    answers: VERSION.questions.slice(20).map((q) => ({ questionId: q.id, value: answers[q.id] })), scoringInputs: {}, payload: null, responseChecksum: 'e'.repeat(64)
  } }
];
const rows = mirror.rowsForWrites(writes, { now: '2026-10-08T00:00:00.000Z', personIds: { 'cust-1': personId } });
const attemptRow = (rows.assessment_attempts || [])[0];
ok(attemptRow, 'the attempt is mirrored');
eq(attemptRow.area_scores, scored.areaScores, 'the mirrored row holds all ten facet scores exactly as the server scored them');
eq(Object.keys(attemptRow.area_scores).sort(), report.ALL_FACETS.slice().sort(), 'the ten facets, no more and no fewer');
eq([attemptRow.overall_score, attemptRow.band, attemptRow.profile_label], [scored.overallScore, scored.band, scored.profileLabel], 'score, band and profile are mirrored');
eq(attemptRow.source.formVersion, VERSION.formVersion, 'the form version is kept in source (get_my_es_status returns it)');
eq(attemptRow.legacy_firestore_id, 'assessmentAttempts/att-es-1', 'the Firestore attempt id is kept (get_my_es_status strips the prefix)');
const parts = rows.assessment_response_parts || [];
eq(parts.length, 2, 'both response parts are mirrored');
eq(parts[0].scoring_inputs.itemOrder, itemOrder, 'the item order is kept with the first part');
eq(parts.flatMap((p) => p.answers).length, 40, 'all forty answers are kept');
const fromRow = report.readingFromAreaScores(attemptRow.area_scores, { bands: CONTENT.bands });
eq([fromRow.readiness, fromRow.band, fromRow.profile], [scored.overallScore, scored.band, scored.profileLabel], 'a report read back from the mirrored row equals the server result');
// The answers are enough to rebuild the same scores, so the stored copy is a second route to the same report.
const rebuilt = scoreVersion(VERSION, normalizeAnswers(VERSION, Object.fromEntries(parts.flatMap((p) => p.answers).map((a) => [a.questionId, a.value]))));
eq(rebuilt.areaScores, scored.areaScores, 'the mirrored answers rebuild the same facet scores');

// ---- 3. the My Results page --------------------------------------------------------------------------------------

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const html = report.renderHtml(fromRow, { escape: esc, content: CONTENT, profileLabel: scored.profileLabel, band: scored.band });
ok(html.startsWith('<div class="facet-report" data-facet-report>'), 'the report is one block');
report.ALL_FACETS.forEach((facet) => ok(html.includes(facet.replace(/-/g, '‑')), `the report names ${facet}`));
ok(html.includes(`${scored.overallScore} out of 100, ${scored.band} range`), 'the headline gives the score and the band');
ok(html.includes(scored.profileLabel), 'the profile is shown');
ok(fromRow.strengths.every((facet) => html.includes(esc(CONTENT.facets[facet].strength))), 'the two strengths come with their text from content.js');
ok(fromRow.growthEdges.every((facet) => html.includes(esc(CONTENT.facets[facet].growthEdge))), 'the two growth edges come with their text from content.js');
ok(report.STYLE_FACETS.every((facet) => html.includes(esc(CONTENT.facets[facet].levels[fromRow.level(Math.round(fromRow.shown[facet]))]))), 'each style facet shows the sentence for its level');
ok((html.match(/facet-bar-track/g) || []).length >= 10 + 5, 'every facet and every area has a bar');
ok(/width:\d{1,3}%/.test(html) && !/width:NaN|undefined|null/.test(html), 'bars carry numbers only');
const hostile = report.renderHtml(fromRow, { escape: esc, content: CONTENT, profileLabel: '<img src=x onerror=alert(1)>', band: '"><script>' });
ok(!hostile.includes('<img') && !hostile.includes('<script>'), 'a stored profile label or band cannot inject markup');
eq(report.renderHtml(null, { escape: esc }), '', 'no reading, no report');
ok(!/[–—]/.test(html), 'no dash characters in the report copy');
ok(!/\b(isn't|doesn't|don't|can't|won't|it's|you're|you've)\b/i.test(facetSource.split('\n').filter((line) => /<p|<h2|<h3|muted/.test(line)).join(' ')), 'no contractions in the new copy');

ok(/<script src="\.\.\/content\.js"><\/script>\s*<script src="\.\.\/facet-report\.js"><\/script>\s*<script type="module">/.test(myResults), 'My Results loads the content and the report module before its module script');
ok(/<div class="card" id="facetReportCard" hidden><\/div>/.test(myResults), 'the report card starts hidden');
ok(/renderFacetReport\(fullEntry && fullEntry\.latestAttempt\);/.test(myResults), 'the report is drawn from the latest full assessment of the status');
ok(/if \(!reading\) \{ card\.hidden = true; card\.innerHTML = ''; return; \}/.test(myResults), 'no stored facets, no report');
ok(/api\.renderHtml\(reading, \{ escape: esc,/.test(myResults), 'the page passes its escape function');
ok(/getMyEsStatus\(\)\.catch\(\(\) => null\)/.test(myResults), 'the status read is unchanged and still fails quietly');
ok(/import \{ auth, db, doc, getDoc, getDataSource, getMyEsStatus,/.test(myResults), 'the page still uses getMyEsStatus from assets/firebase.js (Firestore base, Supabase fills gaps in the wrapper)');

ok(/getDataSource\(\) === 'supabase' && api && attempt \? api\.readingFromAreaScores/.test(myResults), 'the report card is drawn only with the Supabase data switch on, so switch off is the old page');
ok(/overallScore: attempt\.overallScore/.test(myResults), 'the page passes the stored overall score');
const stored = report.renderHtml(fromRow, { escape: esc, content: CONTENT, profileLabel: scored.profileLabel, band: scored.band, overallScore: 71.4 });
ok(stored.includes('<h2>71 out of 100,'), 'the headline is the stored overall score when there is one');
ok(report.renderHtml(fromRow, { escape: esc, content: CONTENT, overallScore: null }).includes(`<h2>${fromRow.readiness} out of 100,`), 'a missing stored score falls back to the recomputed mean');
ok(report.renderHtml(fromRow, { escape: esc, content: CONTENT, overallScore: 'abc' }).includes(`<h2>${fromRow.readiness} out of 100,`), 'an unreadable stored score falls back too');
ok(report.renderHtml(fromRow, { escape: esc, content: CONTENT, overallScore: 250 }).includes('<h2>100 out of 100,'), 'a stored score is held to the 0 to 100 scale');

console.log(`executive-signature-facet-report: ${checks} checks passed`);
