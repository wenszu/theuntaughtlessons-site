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
assert.match(home, /pointerenter', \(\) => \{\s*pause\(\);\s*resumeSoon\(\);/, 'testimonial auto-scroll should pause briefly on hover, then resume without requiring the pointer to leave');
assert.match(home, /let position = browser\.scrollLeft;/, 'auto-scroll must accumulate position in a float variable, not by reading back the integer-rounded scrollLeft each frame (sub-pixel increments get lost to rounding otherwise)');
assert.match(home, />5,000\+<\/strong>/, 'meaningful statistic values should exist without JavaScript');
assert.doesNotMatch(home, /5,000\+ professionals\. 100% would recommend it\./, 'the metrics section should not repeat its values in an extra heading');
assert.match(home, /duration = 5600/, 'metric counting should run once at the revised 20-percent-faster pace');
assert.match(home, /progress \* progress \* \(3 - 2 \* progress\)/, 'metric counting should ease smoothly at both ends');
assert.match(home, /observer\.disconnect\(\)/, 'metric counting should stop permanently at its final values');
assert.doesNotMatch(home, /runStatsCycle|metrics-resetting/, 'metrics should not reset or repeat');
assert.match(styles, /font-variant-numeric: lining-nums tabular-nums/, 'metric digits should not shift horizontally as values change');
assert.match(styles, /prefers-reduced-motion: reduce/, 'the motion system should honor reduced-motion preferences');
assert.match(styles, /scroll-snap-type: none/, 'testimonial auto-scroll should move continuously instead of snapping between cards');
assert.match(home, /const pxPerFrame = \.35;/, 'testimonial auto-scroll should use a slow reading pace');
assert.match(styles, /\.home-page \.testimonial-track \{[\s\S]*?align-items: flex-start;/, 'testimonial cards should keep their natural content height instead of stretching to the tallest quote');
assert.match(styles, /\.home-page \.testimonial-card \{[\s\S]*?min-height: 0;/, 'testimonial cards should not reserve unnecessary empty space');
for (const [name, page] of Object.entries({ home, programs, programDetail, about, contact })) {
  assert.doesNotMatch(page, /class="footer-tagline"/, `${name} should use the concise public footer`);
  assert.match(page, /styles\.css\?v=[\w-]+/, `${name} should load a cache-busted copy of the public styles`);
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
assert.match(programDetail, /id="learning-experience"/, 'the program page should show the actual learner experience near the introduction');
assert.equal((programDetail.match(/class="experience-step"/g) || []).length, 4, 'the program experience should explain four concrete steps');
assert.equal((programDetail.match(/class="experience-panel"/g) || []).length, 4, 'each experience step should have a corresponding product preview');
assert.match(programDetail, /assets\/program-experience\/learning-journey\.png/, 'the program experience should begin with a privacy-safe Learning Journey preview');
assert.match(programDetail, /assets\/program-experience\/lesson-slide\.png/, 'the program experience should show a visual lesson preview');
assert.match(programDetail, /assets\/program-experience\/lesson-presenter\.png/, 'the lesson preview should show the actual presenter alongside the visual lesson slide');
assert.match(programDetail, /data-experience-carousel/, 'multi-image product previews should use the shared screenshot carousel');
assert.match(programDetail, /data-carousel-previous/, 'screenshot carousels should provide a previous-image control');
assert.match(programDetail, /data-carousel-next/, 'screenshot carousels should provide a next-image control');
assert.match(programDetail, /scroll-snap-type: x mandatory/, 'the lesson carousel should support touch and trackpad scrolling');
assert.match(programDetail, /assets\/program-experience\/learning-journey-activity\.png/, 'the Learning Journey preview should show the activity details drawer');
assert.match(programDetail, /assets\/program-experience\/exercise-setup\.png/, 'the exercise preview should show the setup that comes before the learner works');
assert.match(programDetail, /assets\/program-experience\/practice-exercise\.png/, 'the program experience should show an actual exercise preview');
assert.match(programDetail, /experience-image-private/, 'the public exercise preview should obscure private source-note text');
assert.match(programDetail, /assets\/program-experience\/feedback-review\.png/, 'the program experience should show actual submitted feedback');
assert.match(programDetail, /assets\/program-experience\/feedback-answer\.png/, 'the feedback preview should show the learner answer tab');
assert.match(programDetail, /assets\/program-experience\/feedback-sample\.png/, 'the feedback preview should show the sample answer tab');
assert.match(programDetail, /const selectExperience = \(selectedTab\)/, 'the experience preview should be controlled by the learner rather than autoplaying');
assert.match(programDetail, /event\.key === 'ArrowDown'/, 'the experience tabs should support keyboard navigation');
assert.doesNotMatch(programDetail, /experience-preview-dots/, 'the product preview should not include decorative browser dots when it already has carousel controls');
assert.match(programDetail, /class="experience-support"/, 'the program page should explain the support learners receive while working independently');
assert.match(programDetail, /walkthrough\/daily-goal-20260816\.png/, 'the support section should show the real daily mission picker');
assert.match(programDetail, /program-experience\/level-progression\.png/, 'the support section should show the full five-level progression');
assert.match(programDetail, /walkthrough\/cohort-standing-20260902\.png/, 'the support section should show the real anonymous cohort standing view');
assert.match(programDetail, /Mastery Points \(MP\)/, 'the first mention in support copy should spell out Mastery Points and its abbreviation');
assert.match(programDetail, /\.testimonial-grid \{\s*align-items: start;/, 'program testimonial cards should keep their natural content height instead of stretching to the longest quote');
assert.match(programDetail, /data-experience-zoom/, 'product screenshots should open in an accessible full-view dialog');
assert.doesNotMatch(programDetail, /Open full view/, 'screenshots should open directly without a separate full-view control');
assert.match(programDetail, /image\.addEventListener\('click', \(\) => openSlideZoom\(slide\)\)/, 'each screenshot should open the larger view when selected');
assert.match(programDetail, /event\.key !== 'Enter' && event\.key !== ' '/, 'screenshot zoom should support keyboard activation');

// --- wherever the program mark sits beside what would otherwise be a duplicate heading, it should be the
//     single unified logo image (icon + wordmark baked in), not an icon paired with separately-typed text ---
assert.match(home, /program-logo-tsa-white\.png/, 'the homepage featured-program spotlight should show the full white program lockup on its navy card');
assert.match(home, /<a class="program-highlight-spotlight" href="\/programs\/think-speak-act\.html"/, 'the full featured-program card should link to the program page');
assert.match(home, /class="program-highlight-action">View the program/, 'the featured-program card should state clearly that it can be opened');
assert.match(styles, /\.program-highlight-spotlight:hover \{[\s\S]*?transform: translateY\(-4px\)/, 'the featured-program link should respond visibly on hover');
assert.match(styles, /\.program-highlight-spotlight:focus-visible \{[\s\S]*?outline: 3px solid var\(--home-gold\)/, 'the featured-program link should retain a visible keyboard focus state');
assert.doesNotMatch(home, /class="pillars-mark"/, '"What you will learn" should not repeat the program mark now that the featured-program banner already introduced it');
assert.match(programs, /<h2 class="catalog-card-mark-heading"><img class="catalog-card-mark" src="assets\/program-logo-tsa\.png/, 'the programs directory card should use the full logo as its heading, not an icon beside separate text');
assert.doesNotMatch(programs, /<h2>Think, speak and act like an executive/, 'the programs directory card should not also spell out the name as separate heading text');
assert.match(programDetail, /<h1 id="hero-title" class="program-hero-mark"><img src="\.\.\/assets\/program-logo-tsa-white\.png/, 'the navy hero should use the full white logo as the heading, not an icon beside separate text');
assert.doesNotMatch(programDetail, /Think, speak and act like an executive<\/h1>/, 'the hero should not also spell out the name as separate heading text');
assert.doesNotMatch(programDetail, /\.program-hero h1\{/, 'the hero should not carry leftover text styling for a heading that is now an image');
assert.doesNotMatch(programDetail, /program-trademark/, 'unused trademark-span styling should not linger once the hero heading is an image');

console.log('public homepage and program motion system contracts passed');
