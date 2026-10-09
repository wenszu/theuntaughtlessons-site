#!/usr/bin/env node
// Rewrites every "?v=..." cache-busting query string on versioned asset
// references (src=/href= and dynamic import()/new URL() calls in JS) to one
// shared value, so a shared file can never be loaded under multiple
// conflicting cache keys at once. Run with --dry-run to preview changes,
// --check to verify the repository without writing, or --version=<value>
// to pin a deterministic release version.
//
// Module-to-module imports: every first party JavaScript import (static
// `import ... from './x.js'`, side-effect `import './x.js'`, dynamic
// `import('./x.js')`, `export ... from './x.js'` and
// `new URL('./x.js', import.meta.url)`) in the shipped site must carry the
// same ?v=<version> query as the HTML pages. Without it a browser that cached
// an older module (the site is cached for hours) runs a fresh versioned module
// against stale unversioned siblings. The default (write) mode adds the query
// to any such import that lacks it, and --check fails if one is missing.
// Vendored files (assets/vendor/**) are immutable and hash-locked: they are
// never edited and imports that target them are left alone (their folder name
// already carries the library version).
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_EXTENSIONS = new Set(['.html', '.js', '.css']);
const EXCLUDE_DIR_NAMES = new Set([
  'node_modules', '.firebase', 'public', 'visual', 'tests', '.claude', '.vscode'
]);

// Folders that are not part of the published site (see the rsync excludes in
// .github/workflows/deploy-pages.yml) or are not browser ES modules (Deno edge
// functions import './x.ts'-style files and must never get a query string).
const IMPORT_EXCLUDE_DIR_NAMES = new Set([
  'supabase', 'functions', 'functions-aiko', 'functions-admin', 'scripts', 'reference', 'tools', 'docs'
]);
const VENDOR_DIR = path.join(ROOT, 'assets', 'vendor');

// A relative module specifier that does not yet carry a query string, found in
// an import context. Group 1 = prefix, 2 = quote, 3 = specifier.
const UNVERSIONED_IMPORT = new RegExp(
  '(\\bfrom\\s*|\\bimport\\s*\\(?\\s*|\\bnew\\s+URL\\(\\s*)' +
  '([\'"])(\\.{1,2}/[^\'"`\\s?#$]*?\\.m?js)\\2',
  'g'
);
const URL_CONTEXT = /\bnew\s+URL\(\s*$/;

function isVendorPath(file) {
  const rel = path.relative(VENDOR_DIR, file);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Returns true when an import-context specifier in `file` is a first party
// module that this script is responsible for versioning.
function isManagedImport(file, specifier) {
  // Resolve the way a browser does: against the site root, where a leading
  // "../" that would climb above the root is simply dropped. Some classic
  // scripts under assets/ use '../../assets/x.js', which only works because of
  // that clamping.
  const siteDir = path.relative(ROOT, path.dirname(file)).split(path.sep).join('/');
  const sitePath = path.posix.normalize(`/${siteDir}/${specifier}`);
  const target = path.join(ROOT, ...sitePath.split('/'));
  if (isVendorPath(target)) return false;
  try { return fs.statSync(target).isFile(); } catch (error) { return false; }
}

function isImportExcluded(file) {
  const rel = path.relative(ROOT, file).split(path.sep);
  return isVendorPath(file) || IMPORT_EXCLUDE_DIR_NAMES.has(rel[0]);
}

// Finds (and optionally fixes) first party imports without a version query.
function processImports(file, text, version) {
  const missing = [];
  if (isImportExcluded(file)) return { text, missing };
  const out = text.replace(UNVERSIONED_IMPORT, (match, prefix, quote, specifier, offset) => {
    // `new URL('./x.js', ...)` only counts when the second argument is import.meta.url.
    if (URL_CONTEXT.test(prefix)) {
      const rest = text.slice(offset + match.length, offset + match.length + 40);
      if (!/^\s*,\s*import\.meta\.url/.test(rest)) return match;
    }
    if (!isManagedImport(file, specifier)) return match;
    missing.push(specifier);
    return `${prefix}${quote}${specifier}?v=${version}${quote}`;
  });
  return { text: out, missing };
}

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
  const unversionedImports = [];

  for (const file of files) {
    const original = fs.readFileSync(file, 'utf8');
    const importScan = processImports(file, original, version);
    for (const specifier of importScan.missing) {
      unversionedImports.push(`${path.relative(ROOT, file)}: ${specifier}`);
    }
    for (const match of original.matchAll(/\.(?:js|css|json|png|jpe?g|svg|ico)\?v=([^"'&)\s]+)/g)) {
      const foundVersion = match[1];
      if (!versions.has(foundVersion)) versions.set(foundVersion, []);
      versions.get(foundVersion).push(path.relative(ROOT, file));
    }
    if (checkOnly) continue;
    let refsInFile = importScan.missing.length;
    const rewritten = importScan.text.replace(pattern, (match, ext) => {
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
    if (unversionedImports.length > 0) {
      console.error(`Found ${unversionedImports.length} first party module import(s) without a ?v= query; run node scripts/sync-cache-versions.js --version=<version> to add it.`);
      for (const entry of unversionedImports.slice(0, 20)) console.error(`  ${entry}`);
      process.exitCode = 1;
      return;
    }
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
