// 12 in 12 (apps/12-in-12/): storage, backup and restore, date logic, service worker, and design and copy contracts.
// Plain node:assert, no dependencies.
// Run: node tests/twelve-in-twelve.test.js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const APP = path.join(__dirname, '..', 'apps', '12-in-12');
const read = (name) => fs.readFileSync(path.join(APP, name), 'utf8');
const Core = require(path.join(APP, 'core.js'));

function fakeStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); }
  };
}

const OCT_2026 = new Date(2026, 9, 10, 12, 0, 0);
const challenge = { name: 'Stretch for 15 minutes each day', category: 'Body', month: 10, year: 2026 };

// 1. Storage: current key, legacy key migration, damaged data.
{
  const stored = fakeStorage({ [Core.STORAGE_KEY]: JSON.stringify({ activeChallenge: challenge, log: { '2026-10-02': 'done', '2026-10-03': 'sparkle' } }) });
  const loaded = Core.loadData(stored, OCT_2026);
  assert.deepEqual(loaded.log, { '2026-10-02': 'done' }, 'unknown statuses are dropped on load');
  assert.equal(loaded.activeChallenge.name, challenge.name);

  const legacy = fakeStorage({
    [Core.LEGACY_KEY]: JSON.stringify({
      goal: 'Read daily', category: 'Focus', startDate: '2026-10-01',
      entries: { '2026-10-01': { status: 'done', note: 'ignored' }, '2026-10-02': { status: 'bogus' }, 'not-a-date': { status: 'done' } }
    })
  });
  const migrated = Core.loadData(legacy, OCT_2026);
  assert.deepEqual(migrated.activeChallenge, { name: 'Read daily', category: 'Focus', month: 10, year: 2026 }, 'legacy goal becomes the active challenge');
  assert.deepEqual(migrated.log, { '2026-10-01': 'done' }, 'only valid legacy entries survive, notes are not carried over');

  const both = fakeStorage({ [Core.STORAGE_KEY]: JSON.stringify({ activeChallenge: challenge, log: {} }), [Core.LEGACY_KEY]: JSON.stringify({ goal: 'Old goal' }) });
  assert.equal(Core.loadData(both, OCT_2026).activeChallenge.name, challenge.name, 'the current key wins over the legacy key');

  for (const raw of ['{not json', 'null', '[]', '"text"', '42']) {
    assert.deepEqual(Core.loadData(fakeStorage({ [Core.STORAGE_KEY]: raw }), OCT_2026), Core.emptyData(), `damaged data ${raw} loads as empty`);
  }
  assert.deepEqual(Core.loadData(fakeStorage(), OCT_2026), Core.emptyData(), 'a new visitor starts empty');

  const later = Core.loadData(stored, new Date(2026, 10, 1, 9, 0, 0));
  assert.deepEqual(later, Core.emptyData(), 'a challenge from an earlier month starts again in a new month');

  const saved = fakeStorage();
  Core.saveData(saved, { activeChallenge: challenge, log: { '2026-10-02': 'partial' } });
  assert.deepEqual(Core.loadData(saved, OCT_2026).log, { '2026-10-02': 'partial' }, 'save then load keeps the log');
}

// 2. Backup export and restore round trip, and rejection of anything unexpected.
{
  const data = { activeChallenge: challenge, log: { '2026-10-01': 'done', '2026-10-02': 'partial', '2026-10-03': 'missed' } };
  const backup = Core.buildBackup(data, OCT_2026);
  const parsedBackup = JSON.parse(backup);
  assert.equal(parsedBackup.app, '12-in-12');
  assert.equal(parsedBackup.version, Core.BACKUP_VERSION);
  const restored = Core.parseBackup(backup);
  assert.equal(restored.ok, true, restored.error);
  assert.deepEqual(restored.data, data, 'export then restore returns the same data');
  assert.equal(Core.parseBackup(JSON.stringify({ activeChallenge: null, log: {} })).ok, true, 'an empty backup is allowed');
  assert.equal(Core.parseBackup(JSON.stringify({ activeChallenge: challenge, log: data.log })).ok, true, 'a backup from before version numbers is allowed');

  const bad = (value, why) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    const result = Core.parseBackup(text);
    assert.equal(result.ok, false, `rejected: ${why}`);
    assert.equal(typeof result.error, 'string');
    assert.ok(result.error.length > 0);
  };
  bad('', 'empty text');
  bad('   ', 'blank text');
  bad('{not json', 'bad JSON');
  bad('null', 'null');
  bad('[]', 'array');
  bad('"text"', 'string');
  bad('x'.repeat(Core.BACKUP_MAX_BYTES + 1), 'over the size cap');
  bad(JSON.stringify({ activeChallenge: challenge, log: {}, pad: 'x'.repeat(Core.BACKUP_MAX_BYTES) }), 'over the size cap with a valid shape');
  bad({ activeChallenge: challenge, log: {}, extra: 1 }, 'unknown top level field');
  bad({ app: 'other', activeChallenge: null, log: {} }, 'wrong app');
  bad({ version: 2, activeChallenge: null, log: {} }, 'unknown version');
  bad({ activeChallenge: { ...challenge, extra: 'x' }, log: {} }, 'unknown challenge field');
  bad({ activeChallenge: { ...challenge, name: '' }, log: {} }, 'empty name');
  bad({ activeChallenge: { ...challenge, name: 42 }, log: {} }, 'name is not text');
  bad({ activeChallenge: { ...challenge, name: 'y'.repeat(500) }, log: {} }, 'name too long');
  bad({ activeChallenge: { ...challenge, category: 'Wealth' }, log: {} }, 'unknown category');
  bad({ activeChallenge: { ...challenge, month: 13 }, log: {} }, 'month out of range');
  bad({ activeChallenge: { ...challenge, month: '10' }, log: {} }, 'month as text');
  bad({ activeChallenge: { ...challenge, month: 10.5 }, log: {} }, 'month not whole');
  bad({ activeChallenge: { ...challenge, year: 1999 }, log: {} }, 'year too early');
  bad({ activeChallenge: { ...challenge, year: 2101 }, log: {} }, 'year too late');
  bad({ activeChallenge: challenge, log: { '2026-10-01': 'DONE' } }, 'status in the wrong case');
  bad({ activeChallenge: challenge, log: { '2026-10-01': '<img src=x onerror=alert(1)>' } }, 'markup as a status');
  bad({ activeChallenge: challenge, log: { '2026-10-01': { status: 'done' } } }, 'status as an object');
  bad({ activeChallenge: challenge, log: { '2026-02-30': 'done' } }, 'a date that does not exist');
  bad({ activeChallenge: challenge, log: { '2026-1-1': 'done' } }, 'a date without zero padding');
  bad({ activeChallenge: challenge, log: { '1999-01-01': 'done' } }, 'a date out of range');
  bad({ activeChallenge: challenge, log: [] }, 'log as an array');
  bad({ activeChallenge: null, log: { '2026-10-01': 'done' } }, 'check-ins without a challenge');
  bad({ activeChallenge: [], log: {} }, 'challenge as an array');
  bad('{"activeChallenge":null,"log":{"__proto__":"done"}}', 'prototype key in the log');
  bad('{"__proto__":{"polluted":true},"log":{}}', 'prototype key at the top level');
  assert.equal({}.polluted, undefined, 'no prototype pollution');

  const tooMany = {};
  for (let i = 0; i < Core.BACKUP_MAX_BYTES; i += 1) {
    if (Object.keys(tooMany).length > 4000) break;
    const date = new Date(2000, 0, 1 + i);
    tooMany[Core.isoDate(date)] = 'done';
  }
  bad({ activeChallenge: challenge, log: tooMany }, 'too many entries');

  const whitespace = Core.parseBackup(JSON.stringify({ activeChallenge: { ...challenge, name: '  Read\u0000\n daily  ' }, log: {} }));
  assert.equal(whitespace.data.activeChallenge.name, 'Read daily', 'control characters and extra spaces are cleaned from the name');
}

// 3. Month length, leap years, strict dates.
{
  const lengths2025 = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  lengths2025.forEach((days, index) => assert.equal(Core.daysInMonth(2025, index + 1), days, `2025 month ${index + 1}`));
  assert.equal(Core.daysInMonth(2024, 2), 29, '2024 is a leap year');
  assert.equal(Core.daysInMonth(2028, 2), 29);
  assert.equal(Core.daysInMonth(2000, 2), 29, '2000 is a leap year');
  assert.equal(Core.daysInMonth(2100, 2), 28, '2100 is not a leap year');
  assert.ok(Core.parseIsoDate('2024-02-29'), 'leap day exists in 2024');
  assert.equal(Core.parseIsoDate('2025-02-29'), null, 'leap day does not exist in 2025');
  assert.equal(Core.parseIsoDate('2026-04-31'), null);
  assert.equal(Core.parseIsoDate('2026-13-01'), null);
  assert.equal(Core.parseIsoDate('2026-10-1'), null);
  assert.equal(Core.parseIsoDate(20261010), null);
  assert.equal(Core.isoDate(Core.parseIsoDate('2026-10-10')), '2026-10-10');
  assert.equal(Core.monthKey(new Date(2026, 0, 31)), '2026-01');
  const leapLog = { '2024-02-29': 'done', '2024-02-01': 'partial', '2024-03-01': 'done' };
  assert.deepEqual(Core.statusCounts(leapLog, 2024, 2), { done: 1, partial: 1, missed: 0 });
}

// 4. Midnight and time zones. The day is the local calendar day, never the UTC day.
{
  const script = `
    const Core = require(${JSON.stringify(path.join(APP, 'core.js'))});
    const rows = [
      new Date(2026, 0, 31, 23, 59, 59),
      new Date(2026, 1, 1, 0, 0, 0),
      new Date(2024, 1, 29, 23, 30, 0),
      new Date(2026, 11, 31, 23, 59, 0)
    ].map((d) => Core.isoDate(d));
    process.stdout.write(JSON.stringify(rows));
  `;
  const expected = ['2026-01-31', '2026-02-01', '2024-02-29', '2026-12-31'];
  ['UTC', 'Pacific/Auckland', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Kolkata'].forEach((zone) => {
    const result = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: zone }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), expected, `local dates are stable in ${zone}`);
  });
  const rollover = Core.rollMonthIfNeeded({ activeChallenge: challenge, log: { '2026-10-31': 'done' } }, new Date(2026, 9, 31, 23, 59, 59));
  assert.ok(rollover.activeChallenge, 'the challenge is still active at 23:59:59 on the last day');
  const after = Core.rollMonthIfNeeded({ activeChallenge: challenge, log: { '2026-10-31': 'done' } }, new Date(2026, 10, 1, 0, 0, 0));
  assert.equal(after.activeChallenge, null, 'the challenge ends at midnight');
  assert.doesNotMatch(read('core.js') + read('app.js'), /toISOString\(\)\.slice|toISOString\(\)\.split|getUTC/, 'dates must never be built from UTC parts');
}

// 5. Service worker: scope, cache name from ?v=, no automatic skipWaiting, shell only.
{
  const source = read('sw.js');
  function loadWorker(version) {
    const listeners = {};
    const calls = { skipWaiting: 0, deleted: [], added: [] };
    const self = {
      location: { href: `https://example.test/apps/12-in-12/sw.js${version === null ? '' : `?v=${version}`}`, origin: 'https://example.test' },
      registration: { scope: 'https://example.test/apps/12-in-12/' },
      addEventListener: (name, fn) => { listeners[name] = fn; },
      skipWaiting: () => { calls.skipWaiting += 1; },
      clients: { claim: () => Promise.resolve() }
    };
    const caches = {
      open: () => Promise.resolve({ addAll: (urls) => { calls.added.push(...urls); return Promise.resolve(); } }),
      keys: () => Promise.resolve(['utl-12-in-12-old', 'utl-12-in-12-' + version, 'someone-elses-cache']),
      delete: (key) => { calls.deleted.push(key); return Promise.resolve(true); },
      match: () => Promise.resolve(undefined)
    };
    vm.runInNewContext(source, { self, caches, URL, fetch: () => Promise.reject(new Error('offline')), Promise });
    return { listeners, calls };
  }
  const { listeners, calls } = loadWorker('abc123def456');
  let installWork;
  listeners.install({ waitUntil: (p) => { installWork = p; } });
  assert.ok(installWork && typeof installWork.then === 'function', 'install waits on the cache');
  installWork.then(() => {
    assert.equal(calls.skipWaiting, 0, 'installing must not skip waiting');
    assert.ok(calls.added.length >= 4);
    calls.added.forEach((url) => {
      assert.ok(url.startsWith('https://example.test/apps/12-in-12/') || url.startsWith('https://example.test/assets/'), `shell file stays on this site: ${url}`);
      assert.doesNotMatch(url, /member-login|supabase|firebase|googleapis|\/api\//, 'no member or API URL is cached');
    });
    assert.ok(calls.added.some((url) => url.endsWith('/app.js?v=abc123def456')), 'shell files carry the same ?v= value');
    listeners.message({ data: { type: 'SKIP_WAITING' } });
    assert.equal(calls.skipWaiting, 1, 'skipWaiting only happens when the page asks for it');
    listeners.message({ data: { type: 'anything else' } });
    listeners.message({ data: null });
    assert.equal(calls.skipWaiting, 1, 'other messages are ignored');
    let activateWork;
    listeners.activate({ waitUntil: (p) => { activateWork = p; } });
    return activateWork;
  }).then(() => {
    assert.deepEqual(calls.deleted, ['utl-12-in-12-old'], 'only older 12 in 12 caches are deleted');
    let responded = false;
    listeners.fetch({ request: { method: 'POST', url: 'https://example.test/apps/12-in-12/', mode: 'cors' }, respondWith: () => { responded = true; } });
    listeners.fetch({ request: { method: 'GET', url: 'https://other.test/x.js', mode: 'cors' }, respondWith: () => { responded = true; } });
    listeners.fetch({ request: { method: 'GET', url: 'https://example.test/member-login/index.html', mode: 'navigate' }, respondWith: () => { responded = true; } });
    listeners.fetch({ request: { method: 'GET', url: 'https://example.test/assets/firebase.js?v=abc123def456', mode: 'cors' }, respondWith: () => { responded = true; } });
    assert.equal(responded, false, 'posts, other sites, pages outside the folder and non-shell files are never answered by this worker');
    assert.equal(loadWorker(null).calls.skipWaiting, 0, 'a worker with no version still loads');
    console.log('twelve-in-twelve service worker checks passed');
  }).catch((error) => { console.error(error); process.exit(1); });

  assert.match(source, /const VERSION = \(new URL\(self\.location\.href\)\.searchParams\.get\('v'\)/, 'cache name comes from the worker URL query');
  assert.match(source, /const CACHE_NAME = `\$\{CACHE_PREFIX\}\$\{VERSION\}`/);
  assert.doesNotMatch(source, /utl-12-in-12-v\d/, 'no hand-bumped cache name');
  assert.equal((source.match(/skipWaiting\(\)/g) || []).length, 1, 'skipWaiting appears once, behind the message handler');
  assert.match(source, /message[\s\S]{0,120}SKIP_WAITING[\s\S]{0,60}skipWaiting\(\)/);
  assert.doesNotMatch(source, /cache\.put|importScripts/, 'the worker never stores arbitrary responses or loads other scripts');

  const app = read('app.js');
  assert.match(app, /register\('\.\/sw\.js\?v=[\w.-]+', \{ scope: '\.\/' \}\)/, 'registered from this folder with a ?v= value and an explicit scope');
  assert.doesNotMatch(app, /register\('\/|register\('\.\.\//, 'the worker is never registered from outside the folder');
  assert.match(app, /A new version|updateBanner/);
  const html = read('index.html');
  assert.match(html, /A new version is ready/, 'the page tells people a new version is ready');
  assert.match(html, /<script src="\.\/core\.js\?v=[\w.-]+"><\/script>\s*<script src="\.\/app\.js\?v=[\w.-]+"><\/script>/, 'both scripts carry ?v=');
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.scope, './');
  assert.equal(manifest.start_url, './');
}

// 6. Restore and rendering safety.
{
  const app = read('app.js');
  assert.doesNotMatch(app + read('core.js'), /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/, 'user text never goes through markup parsing');
  assert.match(app, /Core\.parseBackup\(els\.importText\.value\)/, 'restore goes through the strict parser');
  assert.doesNotMatch(app, /JSON\.parse\(els\.importText/, 'no second, looser parser');
  assert.doesNotMatch(app, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket/, 'the app makes no network calls');
  assert.doesNotMatch(read('index.html'), /feedback-widget|firebase|supabase/, 'the page loads no sign-in or server code');
}

// 7. Contracts: design tokens and calendar marks.
{
  const html = read('index.html');
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const rootBlock = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')) + 1);
  const cssOutsideTokens = css.replace(rootBlock, '');
  assert.doesNotMatch(css, /arial/i, 'no Arial');
  assert.doesNotMatch(css, /georgia/i, 'no Georgia');
  assert.doesNotMatch(cssOutsideTokens, /#[0-9a-fA-F]{3,8}\b/, 'no hard-coded hex outside the tokens');
  assert.doesNotMatch(cssOutsideTokens, /rgba?\(/, 'no hard-coded colour functions outside the tokens');
  assert.doesNotMatch(cssOutsideTokens, /%23[0-9a-fA-F]{3,6}/, 'no colour hidden in an encoded image');
  assert.doesNotMatch(css, /border-radius:\s*(9{3}|50%|100%|\d{3,}px)/, 'no pill or round radius');
  const radii = [...css.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1].trim());
  radii.forEach((value) => assert.ok(['var(--radius)', '0'].includes(value), `one radius from the token: ${value}`));
  assert.doesNotMatch(css, /box-shadow:\s*(?!none)/, 'no shadows');
  assert.doesNotMatch(css.replace(/\n\s*select \{[^\n]*\}/, ''), /gradient\(/, 'no decorative gradients (only the select arrow draws with them)');
  assert.match(css, /--radius:\s*8px/);
  assert.match(css, /Playfair Display/);
  assert.match(css, /'Lato'/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /:focus-visible\s*\{\s*outline: 2px solid var\(--navy\)/, 'a visible focus outline');
  assert.doesNotMatch(css.replace(/\.onboarding:focus \{ outline: none; \}/, ''), /outline:\s*(none|0)\b/, 'focus outline is never removed from controls (only the dialog container, which is not a control)');
  assert.doesNotMatch(html, /<script[^>]+src="https?:/, 'no third-party scripts');

  const markFor = { done: '\\\\2713', partial: '\\\\00BD', missed: '\\\\2715' };
  Object.keys(markFor).forEach((state) => {
    assert.match(css, new RegExp(`\\.day\\.${state}::after \\{ content: '${markFor[state]}'; \\}`), `calendar state ${state} carries a text mark`);
  });
  const app = read('app.js');
  assert.ok(app.includes('classList.add(entry)'), 'cells take their state class from the stored status');
  assert.match(app, /aria-label', `\$\{formatLongDate\(dateKey\)\}\$\{entry \? `, \$\{titleCaseStatus\(entry\)\}` : ''\}`/, 'every cell has an accessible name with its state');
  assert.match(html, /<p class="legend"><span>&#10003; Done<\/span><span>&frac12; Partial<\/span><span>&#10005; Missed<\/span><\/p>/, 'a legend names every mark');
  ['done', 'partial', 'missed'].forEach((state) => {
    assert.match(html, new RegExp(`status-${state}[\\s\\S]{0,120}status-mark[\\s\\S]{0,80}${state.charAt(0).toUpperCase()}${state.slice(1)}`), `today button ${state} has a mark and a label`);
  });
  assert.match(html, /class="app-header"[\s\S]{0,200}<a class="brand" href="\/"/, 'the logo links to the homepage');
  assert.match(html, /name="viewport"/);
  assert.ok(Core.CATEGORIES.every((name) => app.includes(`${name}: {`)), 'every category has starter challenges');
  assert.equal((app.match(/^    [A-Z][a-z]+: \{$/gm) || []).length, Core.CATEGORIES.length, 'no category without a name in core.js');
}

// 8. Copy contracts: voice guide and no research claims.
{
  const html = read('index.html');
  const body = html.slice(html.indexOf('<body>'));
  const text = body.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z0-9#]+;/g, ' ');
  const app = read('app.js');
  const library = app.slice(app.indexOf('const LIBRARY'), app.indexOf('const els'));
  const strings = [...app.matchAll(/'([^'\\\n]{12,})'|"([^"\\\n]{12,})"/g)].map((m) => m[1] || m[2]);
  const copy = [text, library, ...strings.filter((value) => /\s/.test(value) && !/^[.#\[\w-]+$/.test(value))].join('\n');
  assert.doesNotMatch(copy, /—|–/, 'no em or en dashes');
  assert.doesNotMatch(text, /;/, 'no semicolons in page copy');
  const libraryStrings = [...library.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] || m[2]);
  assert.ok(libraryStrings.length > 40, 'the starter challenges were found');
  libraryStrings.forEach((value) => assert.doesNotMatch(value, /;/, `no semicolons in starter challenges: ${value}`));
  assert.doesNotMatch(copy, /\b(?:don't|doesn't|didn't|can't|won't|isn't|aren't|wasn't|it's|you're|you'll|you've|that's|there's|let's|we're|I'm|couldn't|wouldn't|shouldn't)\b/i, 'no contractions');
  const claims = /\b(?:21 days|30 days|66 days|science|scientific|research|study|studies|proven|proves|evidence|neuroscience|brain|rewire|builds? (?:twelve|12)|form(?:s|ing)? (?:a )?habits?|streaks?|guarantee)\b/i;
  assert.doesNotMatch(copy, claims, 'no research or behaviour-change claims');
  assert.doesNotMatch(copy, /\$\d|per month|\/month|premium|subscribe/i, 'no prices');
  assert.doesNotMatch(copy, /\b(?:habitica|streaks app|loop habit|way of life|fabulous|atoms|strides)\b/i, 'no competitor names');
  assert.match(text, /they are never sent to a server/, 'privacy wording says data stays on the device');
  assert.match(text, /saved only in this browser on this device/);
  assert.match(text, /There is no account/);
  assert.match(text, /Partial means less than you planned/);
}

console.log('twelve-in-twelve contracts passed');
