const assert = require('assert');
const fs = require('fs');

const pages = ['index.html', 'about.html', 'programs.html', 'programs/think-speak-act.html', 'contact.html'];
for (const page of pages) {
  const html = fs.readFileSync(page, 'utf8');
  assert.match(html, /assets\/public-waitlist\.js/);
  assert.match(html, /data-waitlist-cta/);
  assert.doesNotMatch(html, /data-public-find-level/);
  assert.doesNotMatch(html, />Find your level</);
  assert.match(html, />Home<\/a>[\s\S]*>Programs<\/a>[\s\S]*>About<\/a>[\s\S]*>Contact<\/a>/);
  const nav = html.match(/<div id="navMenu"[\s\S]*?<\/div>/)?.[0] || '';
  assert.doesNotMatch(nav, /Get in touch|Explore Programs|Find your level/);
}

const component = fs.readFileSync('assets/public-waitlist.js', 'utf8');
for (const field of ['I am interested for', 'Myself', 'My organization', 'Name', 'Email', 'Organization name', 'What are you hoping to work on?']) assert.ok(component.includes(field));
assert.ok(component.includes("We'll reach out to find a time to talk."));
assert.ok(component.includes('dataset.waitlistAudience'));
assert.match(component, /Content-Type': 'text\/plain;charset=UTF-8'/);
assert.doesNotMatch(component, /<select/);

const tsaProgram = fs.readFileSync('programs/think-speak-act.html', 'utf8');
assert.match(tsaProgram, /For organizations/);
assert.match(tsaProgram, /Initial focus/);
assert.match(tsaProgram, /For individuals/);
assert.match(tsaProgram, /data-waitlist-audience="My organization"/);
assert.match(tsaProgram, /data-waitlist-audience="Myself"/);
assert.match(tsaProgram, /Downloadable certificate/);
assert.match(tsaProgram, /Public verification record/);
assert.match(tsaProgram, /Add to LinkedIn/);

console.log('public waitlist CTA and form contracts passed');
