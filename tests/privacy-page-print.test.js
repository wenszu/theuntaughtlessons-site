const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'privacy', 'index.html'), 'utf8');
const sitemap = fs.readFileSync(path.join(__dirname, '..', 'sitemap.xml'), 'utf8');

assert.match(html, /<title>Privacy notice \| The Untaught Lessons<\/title>/, 'the page title names the notice');
assert.match(sitemap, /theuntaughtlessons\.com\/privacy\//, 'the notice is in the sitemap');

// Print: same page margins and running header and footer as the reports, no named or first page margins
// (Chrome lays the whole document out at the width of the first page), nothing that bleeds past the margins.
const print = html.slice(html.indexOf('@media print'));
assert.match(print, /@page\{size:letter;margin:28mm 18mm 20mm 18mm\}/, 'print uses the same letter page and margins as the reports');
assert.doesNotMatch(html, /@page\s*(:first|[a-z-]+\s*)\{[^}]*margin/, 'no first page or named page margins');
assert.match(print, /\.site-nav[^{]*\{display:none!important\}/, 'the website menu is hidden in print');
assert.match(print, /\.privacy-print[^{]*\{display:none!important\}|\.privacy-print/, 'the print button is hidden in print');
assert.match(print, /background:#fff!important/, 'print uses a white page, not the cream screen background');
assert.match(print, /\.privacy-wrap\{max-width:none/, 'print text fills the page width between the margins');
assert.match(print, /h2\{[^}]*break-after:avoid/, 'a heading is never left alone at the bottom of a page');
assert.match(print, /Page " counter\(page\) " of " counter\(pages\)/, 'the footer numbers the pages');
assert.match(html, /window\.print\(\)/, 'the page has a print or save as PDF button');
assert.doesNotMatch(html, /[–—]/, 'no en or em dashes in the notice');

console.log('Privacy page print checks passed');
