const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const roots = ['admin', 'apps', 'assets', 'certificate', 'member-login', 'my-results', 'portal'];
const extensions = new Set(['.css', '.html', '.js']);
const technicalMonospaceFiles = new Set([
  'admin/index.html',
  'tools/[Grade 8] Linear_systems_grapher.html',
  'tools/[Grade 9 and 10] Logarithm_explorer.html',
  'tools/tools-shared.css'
]);

function collect(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? collect(file) : extensions.has(path.extname(file)) ? [file] : [];
  });
}

const files = [...roots.flatMap(collect), 'programs.html', 'styles.css'];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  assert(!/text-transform:\s*uppercase/.test(source), `${file} should not force ordinary interface text to uppercase`);
  const tracked = [...source.matchAll(/letter-spacing:\s*([0-9.]+)(?:em|px)/g)]
    .some((match) => Number(match[1]) > 0);
  assert(!tracked, `${file} should not use decorative positive tracking`);
  if (!technicalMonospaceFiles.has(file)) {
    assert(!/Roboto Mono|Courier New/.test(source), `${file} should reserve monospace for functional technical content`);
  }
}

console.log('site typography uses natural casing and reserves monospace for technical content');
