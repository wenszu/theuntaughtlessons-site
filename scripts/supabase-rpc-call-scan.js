#!/usr/bin/env node
// A static scan of the code that calls database functions (PostgREST /rest/v1/rpc/<name>) and Edge Functions, checked against
// the contract in supabase/rpc-signatures.json (built by scripts/supabase-rpc-signatures.js from the migrations).
//
// It finds, in every browser file and in the Edge Function cores:
//   1. calls to a function by name:   rpc("name", {...})  post("name", {...})  read("name", {...})  callRpc(ctx, "name", {...})  client.rpc("name")
//   2. URLs:                          "/rest/v1/rpc/name"  and  "/rest/v1/rpc/" + (cond ? "a" : "b")
//   3. name tables:                   RPC_NAMES = { wrapper: "name" }   and   { rpc: "name" }
// For a call whose argument object can be read from the source (an object literal, or a variable or builder function that
// returns one) it checks every key against the function's real argument names and that every argument without a default is
// sent. Argument objects that are built by a switch (assets/supabase-admin-reads.js and similar) are checked by
// tests/rpc-call-contract.test.js, which runs the real builders. Every `p_name:` key in a file must also belong to a function
// that file calls.
//
//   node scripts/supabase-rpc-call-scan.js            print every call site and every problem (exit 1 on a problem)
//   node scripts/supabase-rpc-call-scan.js --json     the same as JSON

'use strict';

const fs = require('fs');
const path = require('path');
const { readSignatures } = require('./supabase-rpc-signatures.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'archive', 'tests', 'vendor', 'docs', 'reference', 'visual', 'context', 'rollbacks', 'exports', 'seed', 'migrations', 'csv', 'data', '.github', '.claude', '.firebase']);
const EXTENSIONS = new Set(['.js', '.mjs', '.html', '.ts']);

// ---------------------------------------------------------------------------------------------------------------------
// Small source readers.

function lineOf(source, index) {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i += 1) if (source.charCodeAt(i) === 10) line += 1;
  return line;
}

// Index just after the string, template or comment that starts at i, or i when none starts there.
function skipLiteral(s, i) {
  const c = s[i];
  if (c === '"' || c === "'") {
    let j = i + 1;
    while (j < s.length && s[j] !== c) { if (s[j] === '\\') j += 1; j += 1; }
    return j + 1;
  }
  if (c === '`') {
    let j = i + 1;
    while (j < s.length && s[j] !== '`') {
      if (s[j] === '\\') { j += 2; continue; }
      if (s[j] === '$' && s[j + 1] === '{') { j = closeOf(s, j + 1) + 1; continue; }
      j += 1;
    }
    return j + 1;
  }
  if (c === '/' && s[i + 1] === '/') { const end = s.indexOf('\n', i); return end === -1 ? s.length : end; }
  if (c === '/' && s[i + 1] === '*') { const end = s.indexOf('*/', i + 2); return end === -1 ? s.length : end + 2; }
  return i;
}

// Index of the bracket that closes the one at `open` ( ( { [ ).
function closeOf(s, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const stack = [pairs[s[open]]];
  for (let i = open + 1; i < s.length; i += 1) {
    const skipped = skipLiteral(s, i);
    if (skipped !== i) { i = skipped - 1; continue; }
    const c = s[i];
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === stack[stack.length - 1]) { stack.pop(); if (!stack.length) return i; }
  }
  return s.length - 1;
}

// Split text at commas that are not inside brackets or literals.
function splitCommas(s) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i += 1) {
    const skipped = skipLiteral(s, i);
    if (skipped !== i) { i = skipped - 1; continue; }
    const c = s[i];
    if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') depth -= 1;
    else if (c === ',' && !depth) { parts.push(s.slice(start, i)); start = i + 1; }
  }
  parts.push(s.slice(start));
  return parts.map((part) => part.trim());
}

// The expression that starts at `from` and ends at the first top level comma, closing bracket or semicolon.
function expressionAt(s, from) {
  let depth = 0;
  for (let i = from; i < s.length; i += 1) {
    const skipped = skipLiteral(s, i);
    if (skipped !== i) { i = skipped - 1; continue; }
    const c = s[i];
    if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') { if (!depth) return s.slice(from, i).trim(); depth -= 1; }
    else if ((c === ',' || c === ';') && !depth) return s.slice(from, i).trim();
  }
  return s.slice(from).trim();
}

// Top level keys of an object literal text "{ a: 1, b, 'c': 2, ...d }".
function objectKeys(literal) {
  const inner = literal.trim().replace(/^\{/, '').replace(/\}$/, '');
  const keys = [];
  let unknown = false;
  splitCommas(inner).filter(Boolean).forEach((part) => {
    const cleaned = part.replace(/^(\s*\/\/[^\n]*\n|\s*\/\*[\s\S]*?\*\/)+/g, '').trim();
    if (!cleaned) return;
    if (cleaned.startsWith('...')) { unknown = true; return; }
    const m = /^(?:async\s+)?(?:\[([^\]]+)\]|["']([^"']+)["']|([A-Za-z_$][\w$]*))\s*(?::|\(|$)/.exec(cleaned);
    if (!m) { unknown = true; return; }
    if (m[1]) unknown = true; else keys.push(m[2] || m[3]);
  });
  return { keys, unknown };
}

// ---------------------------------------------------------------------------------------------------------------------
// Resolving the argument expression of a call to the key sets it can carry. Returns { sets: [[keys]], unresolved } .

function resolveArgument(source, expression, position, depth = 0) {
  let expr = String(expression || '').trim().replace(/^await\s+/, '');
  if (depth > 4) return { sets: [], unresolved: true };
  if (!expr) return { sets: [[]], unresolved: false };
  if (expr[0] === '{') {
    const { keys, unknown } = objectKeys(expr);
    return { sets: [keys], unresolved: unknown };
  }
  const json = /^JSON\.stringify\(([\s\S]*)\)$/.exec(expr);
  if (json) return resolveArgument(source, splitCommas(json[1])[0], position, depth + 1);
  const orEmpty = /^(.*?)\s*(?:\|\||\?\?)\s*\{\s*\}$/.exec(expr);
  if (orEmpty) return resolveArgument(source, orEmpty[1], position, depth + 1);
  const ternary = splitTernary(expr);
  if (ternary) {
    const a = resolveArgument(source, ternary[0], position, depth + 1);
    const b = resolveArgument(source, ternary[1], position, depth + 1);
    return { sets: a.sets.concat(b.sets), unresolved: a.unresolved || b.unresolved };
  }
  if (/^[A-Za-z_$][\w$]*$/.test(expr)) {
    // A variable: its nearest earlier declaration, plus `name.key = ...` assignments.
    const declaration = new RegExp(`(?:const|let|var)\\s+${expr}\\s*=\\s*`, 'g');
    let m;
    let found = null;
    while ((m = declaration.exec(source)) && m.index < position) found = m;
    if (!found) return { sets: [], unresolved: true };
    const resolved = resolveArgument(source, expressionAt(source, found.index + found[0].length), found.index, depth + 1);
    const extra = [];
    const assign = new RegExp(`\\b${expr}\\.([A-Za-z_$][\\w$]*)\\s*=[^=]`, 'g');
    while ((m = assign.exec(source))) extra.push(m[1]);
    return { sets: resolved.sets.map((set) => set.concat(extra)), unresolved: resolved.unresolved };
  }
  const call = /^(?:[\w$.]+\.)?([A-Za-z_$][\w$]*)\(/.exec(expr);
  if (call) {
    const fn = new RegExp(`function\\s+${call[1]}\\s*\\(`);
    const found = fn.exec(source);
    if (!found) return { sets: [], unresolved: true };
    const open = source.indexOf('{', closeOf(source, source.indexOf('(', found.index)));
    const body = source.slice(open, closeOf(source, open) + 1);
    const sets = [];
    let unresolved = false;
    const ret = /\breturn\s*(?=\{)/g;
    let m;
    while ((m = ret.exec(body))) {
      const objOpen = m.index + m[0].length;
      const literal = body.slice(objOpen, closeOf(body, objOpen) + 1);
      const { keys, unknown } = objectKeys(literal);
      sets.push(keys); if (unknown) unresolved = true;
    }
    return sets.length ? { sets, unresolved } : { sets: [], unresolved: true };
  }
  return { sets: [], unresolved: true };
}

function splitTernary(expr) {
  let depth = 0;
  let q = -1;
  for (let i = 0; i < expr.length; i += 1) {
    const skipped = skipLiteral(expr, i);
    if (skipped !== i) { i = skipped - 1; continue; }
    const c = expr[i];
    if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') depth -= 1;
    else if (c === '?' && !depth && expr[i + 1] !== '?' && expr[i - 1] !== '?' && expr[i + 1] !== '.') q = i;
    else if (c === ':' && !depth && q !== -1) return [expr.slice(q + 1, i).trim(), expr.slice(i + 1).trim()];
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Finding call sites in one file.

const NAME = '[a-z][a-z0-9]*(?:_[a-z0-9]+)+';
const CALL_HEADS = '(?:\\brpc|\\bpost|\\bread|\\bcallRpc|\\bcallMember|\\.rpc|\\bcallDatabase)';

function scanSource(source, file) {
  const sites = [];
  const seen = new Set();
  const add = (site) => { const key = `${site.kind}:${site.index}:${site.name}`; if (!seen.has(key)) { seen.add(key); sites.push(site); } };

  // 1. calls by name
  const callRe = new RegExp(`${CALL_HEADS}\\(\\s*(?:[A-Za-z_$][\\w$.]*\\s*,\\s*)?["'](${NAME})["']\\s*(,|\\))`, 'g');
  let m;
  while ((m = callRe.exec(source))) {
    const afterName = m.index + m[0].length;
    const argument = m[2] === ',' ? expressionAt(source, afterName) : '';
    const resolved = resolveArgument(source, argument, m.index);
    add({ file, line: lineOf(source, m.index), index: m.index, kind: 'call', name: m[1], argument, ...resolved });
  }

  // 2. urls (the argument object is the body property that follows)
  const urlRe = /\/rest\/v1\/rpc\/(?:([a-z][a-z0-9_]*)|["'`]\s*\+\s*\(\s*[\w$.]+\s*\?\s*["']([a-z0-9_]+)["']\s*:\s*["']([a-z0-9_]+)["']\s*\))/g;
  while ((m = urlRe.exec(source))) {
    const names = m[1] ? [m[1]] : [m[2], m[3]];
    const window = source.slice(m.index, m.index + 700);
    const bodyMatch = /\bbody\s*(?::\s*|(?=,|\s*\}))/.exec(window);
    let resolved = { sets: [], unresolved: true };
    if (bodyMatch) {
      const at = m.index + bodyMatch.index + bodyMatch[0].length;
      const expr = /^body\b/.test(bodyMatch[0]) && source.slice(at, at + 1) !== ':' && /^\s*(,|\})/.test(source.slice(at, at + 2)) ? 'body' : expressionAt(source, at);
      resolved = resolveArgument(source, expr, m.index);
    }
    names.forEach((name) => add({ file, line: lineOf(source, m.index), index: m.index, kind: 'url', name, alternatives: names.length > 1, ...resolved }));
  }
  // `${base}/rest/v1/rpc/${name}` and similar with a variable name: covered by the callers above (wrappers), nothing to read here.

  // 3. name tables
  const tableRe = /\bRPC_NAMES\s*=\s*\{/g;
  while ((m = tableRe.exec(source))) {
    const open = m.index + m[0].length - 1;
    const block = source.slice(open, closeOf(source, open) + 1);
    const valueRe = new RegExp(`:\\s*["'](${NAME})["']`, 'g');
    let v;
    while ((v = valueRe.exec(block))) add({ file, line: lineOf(source, open + v.index), index: open + v.index, kind: 'table', name: v[1], sets: [], unresolved: true });
  }
  // 4. probe lists: ["name", { p_x: ... }]
  const tupleRe = new RegExp(`\\[\\s*["'](${NAME})["']\\s*,\\s*(?=\\{)`, 'g');
  while ((m = tupleRe.exec(source))) {
    if (!/rpc/i.test(source)) break;
    const open = m.index + m[0].length;
    const literal = source.slice(open, closeOf(source, open) + 1);
    const { keys, unknown } = objectKeys(literal);
    add({ file, line: lineOf(source, m.index), index: m.index, kind: 'probe', name: m[1], sets: [keys], unresolved: unknown });
  }
  const propRe = new RegExp(`\\brpc:\\s*["'](${NAME})["']`, 'g');
  while ((m = propRe.exec(source))) add({ file, line: lineOf(source, m.index), index: m.index, kind: 'table', name: m[1], sets: [], unresolved: true });

  return sites;
}

// Every `p_name:` key (and `x.p_name =`) written in the file.
function parameterKeys(source) {
  const keys = new Set();
  const re = /(?:^|[^\w$.])(p_[a-z0-9_]+)\s*:|\.(p_[a-z0-9_]+)\s*=[^=]|["'](p_[a-z0-9_]+)["']\s*:/g;
  let m;
  while ((m = re.exec(source))) keys.add(m[1] || m[2] || m[3]);
  return keys;
}

// ---------------------------------------------------------------------------------------------------------------------
// Checking.

function checkSites(sites, contract, source, file) {
  const problems = [];
  sites.forEach((site) => {
    const signature = contract[site.name];
    if (!signature) { problems.push({ file, line: site.line, name: site.name, problem: `unknown database function public.${site.name}` }); return; }
    if (site.alternatives) return;
    // A name table (wrapper -> function) or a probe list carries no argument object here; the builders behind a table are run by the test.
    if (!site.sets.length) {
      const needed = signature.filter((arg) => !arg.hasDefault);
      if (site.kind !== 'table' && needed.length) {
        problems.push({ file, line: site.line, name: site.name, problem: `the arguments (${String(site.argument || 'not found').slice(0, 60)}) cannot be read from the source; pass an object literal with the real argument names (${needed.map((a) => a.argName).join(', ')})` });
      }
      return;
    }
    const known = new Set(signature.map((arg) => arg.argName));
    site.sets.forEach((keys) => {
      const unknown = keys.filter((key) => !known.has(key));
      if (unknown.length) problems.push({ file, line: site.line, name: site.name, problem: `unknown argument name(s) ${unknown.join(', ')}; the function takes ${signature.map((a) => a.argName).join(', ') || 'no arguments'}` });
      if (!site.unresolved) {
        const missing = signature.filter((arg) => !arg.hasDefault && !keys.includes(arg.argName)).map((arg) => arg.argName);
        if (missing.length) problems.push({ file, line: site.line, name: site.name, problem: `required argument(s) not sent: ${missing.join(', ')}` });
      }
    });
  });
  if (source !== undefined) {
    const allowed = new Set();
    sites.forEach((site) => (contract[site.name] || []).forEach((arg) => allowed.add(arg.argName)));
    parameterKeys(source).forEach((key) => {
      if (!allowed.has(key)) problems.push({ file, line: lineOf(source, source.indexOf(key)), name: '', problem: `the key ${key} is not an argument of any database function this file calls` });
    });
  }
  return problems;
}

function listFiles(root = REPO_ROOT) {
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') && entry.name !== '.') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const rel = path.relative(root, full).split(path.sep).join('/');
        // supabase/functions holds the Edge Functions (their cores are scanned); the rest of supabase/ is SQL and tests.
        if (rel === 'supabase' || rel === 'supabase/functions' || /^supabase\/functions\/[^/]+$/.test(rel)) { walk(full); continue; }
        if (rel.startsWith('supabase/')) continue;
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (EXTENSIONS.has(path.extname(entry.name))) {
        const rel = path.relative(root, full).split(path.sep).join('/');
        if (rel.startsWith('supabase/') && !/^supabase\/functions\/[^/]+\/[^/]+\.(mjs|ts|js)$/.test(rel)) continue;
        if (/^scripts\/supabase-rpc-/.test(rel)) continue;
        out.push(rel);
      }
    }
  }(root));
  return out.sort();
}

function scanRepo(root = REPO_ROOT, contract = readSignatures()) {
  const sites = [];
  const problems = [];
  listFiles(root).forEach((file) => {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    if (!/rpc|functions\/v1/.test(source)) return;
    const found = scanSource(source, file);
    if (!found.length && !parameterKeys(source).size) return;
    sites.push(...found);
    problems.push(...checkSites(found, contract, source, file));
  });
  return { sites, problems };
}

// ---------------------------------------------------------------------------------------------------------------------
// Edge Function requests: the route a client posts to and the keys of its JSON body.

function scanEdgeCalls(source, file) {
  const out = [];
  const re = /functions\/v1\/([a-z][a-z0-9-]*)/g;
  let m;
  while ((m = re.exec(source))) out.push({ file, line: lineOf(source, m.index), route: m[1] });
  const edgeRe = /\bedge\(\s*["']([a-z][a-z0-9-]*)["']\s*,\s*/g;
  while ((m = edgeRe.exec(source))) {
    const argument = expressionAt(source, m.index + m[0].length);
    out.push({ file, line: lineOf(source, m.index), route: m[1], ...resolveArgument(source, argument, m.index) });
  }
  return out;
}

module.exports = { scanSource, checkSites, scanRepo, listFiles, parameterKeys, resolveArgument, objectKeys, closeOf, splitCommas, expressionAt, lineOf, scanEdgeCalls, REPO_ROOT };

if (require.main === module) {
  const { sites, problems } = scanRepo();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ sites, problems }, null, 2));
  } else {
    sites.forEach((site) => console.log(`${site.file}:${site.line}  ${site.name}  [${site.kind}]  ${site.unresolved ? 'keys not fully readable' : (site.sets[0] || []).join(', ') || '(none)'}`));
    console.log(`\n${sites.length} call sites in ${new Set(sites.map((s) => s.file)).size} files`);
    problems.forEach((p) => console.error(`PROBLEM ${p.file}:${p.line} ${p.name} ${p.problem}`));
  }
  process.exit(problems.length ? 1 : 0);
}
