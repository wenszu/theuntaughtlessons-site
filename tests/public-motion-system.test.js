const assert = require('node:assert/strict');
const fs = require('node:fs');

const home = fs.readFileSync('index.html', 'utf8');
const programs = fs.readFileSync('programs.html', 'utf8');
const programDetail = fs.readFileSync('programs/think-speak-act.html', 'utf8');
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
assert.match(home, /function initTestimonialAutoScroll\(\)/, 'testimonials should auto-scroll continuously');
assert.match(home, /if \(window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches\) return;/, 'testimonial auto-scroll should honor reduced-motion preference');
assert.match(home, /pointerenter', pause\)/, 'testimonial auto-scroll should pause on hover so quotes stay readable');
assert.match(home, /let position = browser\.scrollLeft;/, 'auto-scroll must accumulate position in a float variable, not by reading back the integer-rounded scrollLeft each frame (sub-pixel increments get lost to rounding otherwise)');
assert.match(home, />5,000\+<\/strong>/, 'meaningful statistic values should exist without JavaScript');
assert.doesNotMatch(home, /5,000\+ professionals\. 100% would recommend it\./, 'the metrics section should not repeat its values in an extra heading');
assert.match(home, /duration = 5600/, 'metric counting should run once at the revised 20-percent-faster pace');
assert.match(home, /progress \* progress \* \(3 - 2 \* progress\)/, 'metric counting should ease smoothly at both ends');
assert.match(home, /observer\.disconnect\(\)/, 'metric counting should stop permanently at its final values');
assert.doesNotMatch(home, /runStatsCycle|metrics-resetting/, 'metrics should not reset or repeat');
assert.match(styles, /font-variant-numeric: lining-nums tabular-nums/, 'metric digits should not shift horizontally as values change');
assert.match(styles, /prefers-reduced-motion: reduce/, 'the motion system should honor reduced-motion preferences');
assert.match(styles, /scroll-snap-type: x proximity/, 'testimonial cards should support controlled horizontal browsing');
for (const [name, page] of Object.entries({ home, programs, programDetail, about, contact })) {
  assert.doesNotMatch(page, /class="footer-tagline"/, `${name} should use the concise public footer`);
  assert.match(page, /styles\.css\?v=public-20260819-9/, `${name} should load the current public styles`);
}

// --- programs.html is now a lightweight directory, not the deep-dive itself ---
assert.match(programs, /class="catalog-grid"/, 'the programs directory should list programs as cards');
assert.match(programs, /href="\/programs\/think-speak-act\.html"/, 'the directory should link to the flagship program\'s own page');
assert.doesNotMatch(programs, /class="phase-rail"/, 'the directory should not carry the single-program curriculum detail');

// --- the flagship program's deep-dive now lives at its own URL ---
assert.match(programDetail, /class="phase-rail"/, 'desktop programs should expose a phase progress rail');
assert.equal((programDetail.match(/<details class="phase-block program-reveal"/g) || []).length, 3, 'all three phases should be keyboard-accessible disclosures');
assert.equal((programDetail.match(/<details class="phase-block program-reveal"[^>]* open>/g) || []).length, 1, 'only the first curriculum should begin expanded');
assert.match(programDetail, /requestAnimationFrame\(updateActivePhase\)/, 'the phase rail should follow reading progress in one throttled frame');
assert.match(programDetail, /is-active-phase/, 'the phase content should visually follow the active rail marker');
assert.match(programDetail, /--rail-progress/, 'the phase rail should show continuous progress');
assert.match(programDetail, /phase-rail\.is-fixed/, 'the full rail should be viewport-fixed within the phase journey');
assert.match(programDetail, /phase-rail\.is-past/, 'the full rail should release only at the phase journey boundary');
assert.match(programDetail, /\.programs-page main \{\s*overflow: visible;/, 'the page must not create an ancestor that breaks the sticky phase rail');
assert.match(programDetail, /class="programs-document"/, 'the program document should opt out of shared clipping that breaks sticky positioning');
assert.match(programDetail, /\.programs-document,[\s\S]*?overflow-x: visible;/, 'the full phase rail should remain in one viewport-fixed unit');
assert.match(programDetail, /font-size: 15px/, 'program section labels should remain legible');
assert.doesNotMatch(programDetail, /Best for a facilitated pilot group/, 'cohort copy should describe the actual experience directly');
assert.match(styles, /\.home-page \.section-label-text \{[\s\S]*?color: var\(--home-navy\)/, 'public section-label colors should be consistent');
assert.match(styles, /\.about-page \.about-results \.section-label-text \{[\s\S]*?color: var\(--home-white\) !important;/, 'labels on dark public sections should remain visible');
assert.match(styles, /\.about-page \.about-results \.section-headline \{[\s\S]*?color: var\(--home-white\);/, 'titles on dark public sections should remain visible');
assert.match(programDetail, /phase\.addEventListener\('toggle'/, 'phase disclosure labels should track open state');
assert.match(programDetail, /\.motion-ready \.program-reveal/, 'program reveals should be progressively enhanced');

// --- wherever the program mark sits beside what would otherwise be a duplicate heading, it should be the
//     single unified logo image (icon + wordmark baked in), not an icon paired with separately-typed text ---
assert.match(home, /program-logo-tsa-white\.png/, 'the homepage featured-program spotlight should show the full white program lockup on its navy card');
assert.doesNotMatch(home, /class="pillars-mark"/, '"What you will learn" should not repeat the program mark now that the featured-program banner already introduced it');
assert.match(programs, /<h2 class="catalog-card-mark-heading"><img class="catalog-card-mark" src="assets\/program-logo-tsa\.png/, 'the programs directory card should use the full logo as its heading, not an icon beside separate text');
assert.doesNotMatch(programs, /<h2>Think, speak and act like an executive/, 'the programs directory card should not also spell out the name as separate heading text');
assert.match(programDetail, /<h1 id="hero-title" class="program-hero-mark"><img src="\.\.\/assets\/program-logo-tsa-white\.png/, 'the navy hero should use the full white logo as the heading, not an icon beside separate text');
assert.doesNotMatch(programDetail, /Think, speak and act like an executive<\/h1>/, 'the hero should not also spell out the name as separate heading text');
assert.doesNotMatch(programDetail, /\.program-hero h1\{/, 'the hero should not carry leftover text styling for a heading that is now an image');
assert.doesNotMatch(programDetail, /program-trademark/, 'unused trademark-span styling should not linger once the hero heading is an image');

console.log('public homepage and program motion system contracts passed');
