const assert = require('node:assert/strict');
const fs = require('node:fs');

const home = fs.readFileSync('index.html', 'utf8');
const programs = fs.readFileSync('programs.html', 'utf8');
const styles = fs.readFileSync('styles.css', 'utf8');

assert.match(home, /--question-scale/, 'homepage questions should respond to scroll proximity');
assert.match(home, /requestAnimationFrame\(updateQuestionFocus\)/, 'question motion should use one throttled animation frame');
assert.doesNotMatch(home, /class="flip-card"/, 'essential pillar content must not be hidden behind flip cards');
assert.equal((home.match(/class="pillar-card motion-reveal"/g) || []).length, 3, 'all three pillars should use the shared reveal system');
assert.match(home, /id="testimonialTrack"/, 'testimonials should use a user-controlled track');
assert.doesNotMatch(home, /marquee-track/, 'testimonials should not move perpetually');
assert.match(home, />5,000\+<\/strong>/, 'meaningful statistic values should exist without JavaScript');
assert.match(styles, /prefers-reduced-motion: reduce/, 'the motion system should honor reduced-motion preferences');
assert.match(styles, /scroll-snap-type: x proximity/, 'testimonial cards should support controlled horizontal browsing');

assert.match(programs, /class="phase-rail"/, 'desktop programs should expose a phase progress rail');
assert.equal((programs.match(/<details class="phase-block program-reveal"/g) || []).length, 3, 'all three phases should be keyboard-accessible disclosures');
assert.equal((programs.match(/<details class="phase-block program-reveal"[^>]* open>/g) || []).length, 1, 'only the first curriculum should begin expanded');
assert.match(programs, /new IntersectionObserver\(entries =>/, 'the phase rail should follow reading progress');
assert.match(programs, /phase\.addEventListener\('toggle'/, 'phase disclosure labels should track open state');
assert.match(programs, /\.motion-ready \.program-reveal/, 'program reveals should be progressively enhanced');
assert.match(programs, /styles\.css\?v=motion-20260814/, 'program motion styles should be cache-busted');
assert.match(home, /styles\.css\?v=motion-20260814/, 'homepage motion styles should be cache-busted');

console.log('public homepage and program motion system contracts passed');
