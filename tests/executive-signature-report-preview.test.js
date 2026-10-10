const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('apps/executive-signature/index.html');
const admin = read('admin/index.html');

global.globalThis.READINESS_PREVIEW_PERSONAS = undefined;
require(path.join(root, 'apps/executive-signature/preview-personas.js'));
const people = globalThis.READINESS_PREVIEW_PERSONAS;

// Six made-up people, one per profile, none of them a real person's details.
assert.strictEqual(people.length, 6, 'one made-up person for each of the six profiles');
assert.deepStrictEqual(people.map((x) => x.profile).sort(),
  ['Go-getter', 'Natural leader', 'People person', 'Quiet achiever', 'Steady supporter', 'Team player'], 'each profile appears once');
people.forEach((x) => {
  assert.ok(x.id && x.first && x.last && x.title, 'each person has an id, a name and a job title');
  assert.ok(!/@/.test(JSON.stringify(x)), 'a made-up person carries no email address');
  assert.strictEqual(Object.keys(x.f).length, 10, 'each person has all ten facet scores');
});

// The numbers must land each person on the profile they stand for, in the quick check and in the full report.
const expected = {
  'Quiet achiever': ['Reserved', 'Achievement-driven'], 'Steady supporter': ['Reserved', 'Connection-driven'],
  'Go-getter': ['Balanced', 'Achievement-driven'], 'Team player': ['Balanced', 'Connection-driven'],
  'Natural leader': ['Vocal', 'Achievement-driven'], 'People person': ['Vocal', 'Connection-driven']
};
const voice = (v) => (v < 40 ? 'Reserved' : v > 60 ? 'Vocal' : 'Balanced');
people.forEach((x) => {
  const f = x.f;
  const avg = (...k) => k.reduce((a, key) => a + f[key], 0) / k.length;
  const quick = [voice(avg('Assertiveness', 'Activity Level')), avg('Achievement-Striving', 'Self-Discipline', 'Orderliness') >= avg('Cooperation', 'Altruism') ? 'Achievement-driven' : 'Connection-driven'];
  const full = [voice(f.Assertiveness), f['Achievement-Striving'] >= f.Altruism ? 'Achievement-driven' : 'Connection-driven'];
  assert.deepStrictEqual(quick, expected[x.profile], `${x.profile} lands on its profile in the quick check`);
  assert.deepStrictEqual(full, expected[x.profile], `${x.profile} lands on its profile in the full report`);
});

// The assessment page: preview mode needs the internal switch, starts no attempt, sets no email and records nothing.
const start = html.indexOf('(function startReportPreview(){');
assert.ok(start > 0, 'the assessment page has a report preview mode');
const block = html.slice(start, html.indexOf('})();', start));
assert.match(block, /if\(!internalMode\|\|/, 'preview mode only runs behind ?internal=1');
assert.match(block, /email:''/, 'the preview person has no email, so nothing is recorded or sent');
assert.doesNotMatch(block, /startOrResumeAttempt|startOrResumeFullAttempt|saveActiveAttempt|saveFullActiveAttempt|sessionStorage|localStorage/, 'preview mode starts and stores no attempt');
assert.match(html, /<script src="preview-personas\.js\?v=/, 'the assessment page loads the made-up people');

// The admin console: a section of its own, separate from Configuration and Data governance.
assert.match(admin, /data-target="section-es-report-previews">Report previews</, 'the Executive Signature menu lists Report previews');
assert.match(admin, /id="section-es-report-previews"[^>]*data-admin-program="executive-signature"/, 'the section belongs to the Executive Signature program');
assert.match(admin, /id="esPrevFrame"/, 'the section shows the report in a frame');
assert.match(admin, /preview-personas\.js\?v=/, 'the admin page loads the same made-up people');
assert.match(admin, /esReportPreviewInit\(\)/, 'opening the section builds the preview');
assert.match(admin, /'section-es-report-previews'\s*,\s*'section-es-configuration'/, 'the section is routed like the other Executive Signature sections');
assert.match(admin, /\?internal=1&preview=/, 'the frame opens the preview mode of the assessment page');

// Print: the footer and header never hard-code which assessment is printed.
assert.doesNotMatch(html, /@bottom-left\{content:"The Untaught Lessons"[^}]*Full Assessment/, 'the footer does not name the full assessment on every report');
assert.match(html, /--print-title/, 'the report title in the page header comes from the report being printed');
assert.match(html, /Executive Signature Quick Check/, 'the quick check names itself when printed');

console.log('Executive Signature report preview checks passed');
