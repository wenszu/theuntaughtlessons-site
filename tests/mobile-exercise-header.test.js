const assert = require('node:assert/strict');
const fs = require('node:fs');

const header = fs.readFileSync('assets/app-reward-header.js', 'utf8');
const feedback = fs.readFileSync('assets/feedback-widget.js', 'utf8');

assert(header.includes('function setupMobileHeader(header)'), 'shared exercise header includes the mobile setup');
assert(header.includes('max-width:760px'), 'mobile layout uses a phone-sized breakpoint');
assert(header.includes('height:58px!important'), 'mobile header stays compact');
assert(header.includes('utl-mobile-header-more'), 'mobile header exposes the controls menu');
assert(header.includes('utl-mobile-header-sheet'), 'secondary controls move into a bottom sheet');
assert(header.includes('restoreDesktop'), 'moved controls return to the desktop header');
assert(header.includes('header-progress-chip') && header.includes('header-gamification-cluster'), 'progress and rewards remain available in the mobile controls');
assert(feedback.includes('@media (max-width: 600px)') && feedback.includes('width: 46px'), 'feedback control becomes compact on phones');

const exercisePages = fs.readdirSync('apps')
  .filter((name) => fs.existsSync(`apps/${name}/index.html`))
  .map((name) => ({ name, html: fs.readFileSync(`apps/${name}/index.html`, 'utf8') }))
  .filter(({ html }) => html.includes('app-reward-header.js'));

assert(exercisePages.length >= 10, 'shared mobile header covers the main exercise set');
exercisePages.forEach(({ name, html }) => {
  assert(/app-reward-header\.js\?v=[\w-]+/.test(html), `${name} loads a cache-busted shared header`);
});

console.log(`compact mobile header is shared by ${exercisePages.length} exercises`);
