const assert = require('node:assert/strict');
const fs = require('node:fs');

const home = fs.readFileSync('index.html', 'utf8');
const programs = fs.readFileSync('programs.html', 'utf8');
const about = fs.readFileSync('about.html', 'utf8');
const contact = fs.readFileSync('contact.html', 'utf8');
const styles = fs.readFileSync('styles.css', 'utf8');

assert.match(home, /--question-scale/, 'homepage questions should respond to scroll proximity');
assert.match(home, /requestAnimationFrame\(updateQuestionFocus\)/, 'question motion should use one throttled animation frame');
assert.match(home, /--pillar-scale/, 'pillar cards should grow deliberately as their section reaches focus');
assert.match(home, /0\.92 \+ proximity \* 0\.16/, 'question focus should be visually apparent');
assert.doesNotMatch(home, /class="flip-card"/, 'essential pillar content must not be hidden behind flip cards');
assert.equal((home.match(/class="pillar-card motion-reveal"/g) || []).length, 3, 'all three pillars should use the shared reveal system');
assert.match(home, /id="testimonialTrack"/, 'testimonials should use a user-controlled track');
assert.doesNotMatch(home, /marquee-track/, 'testimonials should not move perpetually');
assert.match(home, />5,000\+<\/strong>/, 'meaningful statistic values should exist without JavaScript');
assert.doesNotMatch(home, /5,000\+ professionals\. 100% would recommend it\./, 'the metrics section should not repeat its values in an extra heading');
assert.match(home, /duration = 5600/, 'metric counting should run once at the revised 20-percent-faster pace');
assert.match(home, /progress \* progress \* \(3 - 2 \* progress\)/, 'metric counting should ease smoothly at both ends');
assert.match(home, /observer\.disconnect\(\)/, 'metric counting should stop permanently at its final values');
assert.doesNotMatch(home, /runStatsCycle|metrics-resetting/, 'metrics should not reset or repeat');
assert.match(styles, /font-variant-numeric: lining-nums tabular-nums/, 'metric digits should not shift horizontally as values change');
assert.match(styles, /prefers-reduced-motion: reduce/, 'the motion system should honor reduced-motion preferences');
assert.match(styles, /scroll-snap-type: x proximity/, 'testimonial cards should support controlled horizontal browsing');
for (const [name, page] of Object.entries({ home, programs, about, contact })) {
  assert.doesNotMatch(page, /class="footer-tagline"/, `${name} should use the concise public footer`);
  assert.match(page, /styles\.css\?v=public-20260814-6/, `${name} should load the current public styles`);
}

assert.match(programs, /class="phase-rail"/, 'desktop programs should expose a phase progress rail');
assert.equal((programs.match(/<details class="phase-block program-reveal"/g) || []).length, 3, 'all three phases should be keyboard-accessible disclosures');
assert.equal((programs.match(/<details class="phase-block program-reveal"[^>]* open>/g) || []).length, 1, 'only the first curriculum should begin expanded');
assert.match(programs, /requestAnimationFrame\(updateActivePhase\)/, 'the phase rail should follow reading progress in one throttled frame');
assert.match(programs, /is-active-phase/, 'the phase content should visually follow the active rail marker');
assert.match(programs, /--rail-progress/, 'the phase rail should show continuous progress');
assert.match(programs, /phase-rail\.is-fixed/, 'the full rail should be viewport-fixed within the phase journey');
assert.match(programs, /phase-rail\.is-past/, 'the full rail should release only at the phase journey boundary');
assert.match(programs, /\.programs-page main \{\s*overflow: visible;/, 'the page must not create an ancestor that breaks the sticky phase rail');
assert.match(programs, /class="programs-document"/, 'the program document should opt out of shared clipping that breaks sticky positioning');
assert.match(programs, /\.programs-document,[\s\S]*?overflow-x: visible;/, 'the full phase rail should remain in one viewport-fixed unit');
assert.match(programs, /font-size: 15px/, 'program section labels should remain legible');
assert.doesNotMatch(programs, /Best for a facilitated pilot group/, 'cohort copy should describe the actual experience directly');
assert.match(styles, /\.home-page \.section-label-text \{[\s\S]*?color: var\(--home-navy\)/, 'public section-label colors should be consistent');
assert.match(styles, /\.about-page \.about-results \.section-label-text \{[\s\S]*?color: var\(--home-white\) !important;/, 'labels on dark public sections should remain visible');
assert.match(styles, /\.about-page \.about-results \.section-headline \{[\s\S]*?color: var\(--home-white\);/, 'titles on dark public sections should remain visible');
assert.match(programs, /phase\.addEventListener\('toggle'/, 'phase disclosure labels should track open state');
assert.match(programs, /\.motion-ready \.program-reveal/, 'program reveals should be progressively enhanced');

console.log('public homepage and program motion system contracts passed');
