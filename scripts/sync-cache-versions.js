#!/usr/bin/env node
// Rewrites every "?v=..." cache-busting query string on versioned asset
// references (src=/href= and dynamic import()/new URL() calls in JS) to one
// shared value, so a shared file can never be loaded under multiple
// conflicting cache keys at once. Run with --dry-run to preview changes,
// --check to verify the repository without writing, or --version=<value>
// to pin a deterministic release version.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_EXTENSIONS = new Set(['.html', '.js', '.css']);
const EXCLUDE_DIR_NAMES = new Set([
  'node_modules', '.firebase', 'public', 'visual', 'tests', '.claude', '.vscode'
]);

function isExcludedDir(name) {
  return EXCLUDE_DIR_NAMES.has(name) || name.startsWith('.git');
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (isExcludedDir(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.isFile()) {
      if (SCAN_EXTENSIONS.has(path.extname(entry.name))) out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function defaultVersion() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const checkOnly = args.includes('--check');
  const versionArg = args.find((a) => a.startsWith('--version='));
  const version = versionArg ? versionArg.slice('--version='.length) : defaultVersion();

  // Matches an asset extension immediately followed by a "?v=" cache-bust
  // query string, capturing everything up to the next quote/ampersand/paren/
  // whitespace so it works inside HTML attributes and JS string literals.
  const pattern = /(\.(?:js|css|json|png|jpe?g|svg|ico))\?v=[^"'&)\s]*/g;

  const files = walk(ROOT, []);
  let changedFiles = 0;
  let changedRefs = 0;
  const versions = new Map();

  for (const file of files) {
    const original = fs.readFileSync(file, 'utf8');
    for (const match of original.matchAll(/\.(?:js|css|json|png|jpe?g|svg|ico)\?v=([^"'&)\s]+)/g)) {
      const foundVersion = match[1];
      if (!versions.has(foundVersion)) versions.set(foundVersion, []);
      versions.get(foundVersion).push(path.relative(ROOT, file));
    }
    if (checkOnly) continue;
    let refsInFile = 0;
    const rewritten = original.replace(pattern, (match, ext) => {
      refsInFile += 1;
      return `${ext}?v=${version}`;
    });
    if (refsInFile === 0 || rewritten === original) continue;
    changedFiles += 1;
    changedRefs += refsInFile;
    console.log(`${dryRun ? '[dry-run] ' : ''}${path.relative(ROOT, file)}: ${refsInFile} reference(s) -> ?v=${version}`);
    if (!dryRun) fs.writeFileSync(file, rewritten);
  }

  if (checkOnly) {
    if (versions.size === 0) {
      console.error('No cache-busting versions were found.');
      process.exitCode = 1;
      return;
    }
    if (versions.size > 1) {
      console.error(`Found ${versions.size} cache versions; expected exactly one.`);
      for (const [foundVersion, foundFiles] of versions) {
        console.error(`  ${foundVersion}: ${foundFiles.length} reference(s), including ${foundFiles.slice(0, 3).join(', ')}`);
      }
      process.exitCode = 1;
      return;
    }
    const [[onlyVersion, foundFiles]] = versions;
    console.log(`Cache-busting consistency passed: ${foundFiles.length} reference(s) use ?v=${onlyVersion}.`);
    return;
  }

  console.log(`\n${dryRun ? 'Would update' : 'Updated'} ${changedRefs} reference(s) across ${changedFiles} file(s) to ?v=${version}.`);
}

main();
