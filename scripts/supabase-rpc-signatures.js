#!/usr/bin/env node
// The contract of the database functions the browser may call through PostgREST (/rest/v1/rpc/<name>).
//
// It READS the migrations in supabase/migrations/*.sql, in file order, and works out the final signature of every
// `public.` function: the last `create [or replace] function` wins, `drop function` removes it. The result is
// supabase/rpc-signatures.json, shaped { name: [{ argName, type, hasDefault }] } (input arguments only, in order).
//
// It never touches a database. The live project is compared by hand with the read-only query printed by `--live-query`
// (see docs/SUPABASE_RPC_CALL_AUDIT.md). The tests (tests/rpc-call-contract.test.js) use `parseMigrations()` to prove
// the checked-in JSON is current, and the shared fake in tests/helpers/rpc-contract.js uses the JSON to answer calls
// exactly like PostgREST does (404 for an unknown function or argument set, 400 style for a bad shape).
//
//   node scripts/supabase-rpc-signatures.js            print the parsed contract summary
//   node scripts/supabase-rpc-signatures.js --write    rewrite supabase/rpc-signatures.json
//   node scripts/supabase-rpc-signatures.js --check    exit 1 when the JSON is not what the migrations produce
//   node scripts/supabase-rpc-signatures.js --live-query   print the read-only SQL to run on the live project

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');
const SIGNATURES_FILE = path.join(REPO_ROOT, 'supabase', 'rpc-signatures.json');
const SCHEMA = 'public';

// Blank out comments (keeping offsets and newlines) so a word in a comment is never read as SQL.
function maskComments(sql) {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const d = sql[i + 1];
    if (c === '-' && d === '-') {
      while (i < n && sql[i] !== '\n') { out += ' '; i += 1; }
    } else if (c === '/' && d === '*') {
      let depth = 0;
      while (i < n) {
        if (sql[i] === '/' && sql[i + 1] === '*') { depth += 1; out += '  '; i += 2; }
        else if (sql[i] === '*' && sql[i + 1] === '/') { depth -= 1; out += '  '; i += 2; if (!depth) break; }
        else { out += sql[i] === '\n' ? '\n' : ' '; i += 1; }
      }
    } else if (c === "'") {
      // keep string literals as they are (a double dash inside a string is not a comment)
      out += c; i += 1;
      while (i < n) {
        out += sql[i];
        if (sql[i] === "'") { if (sql[i + 1] === "'") { out += sql[i + 1]; i += 2; continue; } i += 1; break; }
        i += 1;
      }
    } else if (c === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i, i + 64));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        const stop = end === -1 ? n : end + tag[0].length;
        // Dollar quoted bodies are kept as they are, but their comments are not blanked: function bodies are never
        // scanned for `create function` (see maskBodies), so nothing inside them can matter.
        out += sql.slice(i, stop); i = stop;
      } else { out += c; i += 1; }
    } else { out += c; i += 1; }
  }
  return out;
}

// Replace the inside of every dollar quoted block (function bodies) with spaces so statements are found only at top level.
function maskBodies(sql) {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    if (sql[i] === "'") {
      out += sql[i]; i += 1;
      while (i < n) {
        out += sql[i];
        if (sql[i] === "'") { if (sql[i + 1] === "'") { out += sql[i + 1]; i += 2; continue; } i += 1; break; }
        i += 1;
      }
    } else if (sql[i] === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i, i + 64));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        const stop = end === -1 ? n : end + tag[0].length;
        out += tag[0] + sql.slice(i + tag[0].length, stop - (end === -1 ? 0 : tag[0].length)).replace(/[^\n]/g, ' ') + (end === -1 ? '' : tag[0]);
        i = stop;
      } else { out += sql[i]; i += 1; }
    } else { out += sql[i]; i += 1; }
  }
  return out;
}

// Index of the ")" that closes the "(" at `open`, ignoring parentheses inside quotes.
function matchParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (c === "'") { i += 1; while (i < text.length && !(text[i] === "'" && text[i + 1] !== "'")) { if (text[i] === "'") i += 1; i += 1; } continue; }
    if (c === '(') depth += 1;
    else if (c === ')') { depth -= 1; if (!depth) return i; }
  }
  throw new Error('unbalanced parenthesis in a function signature');
}

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "'") { i += 1; while (i < text.length && !(text[i] === "'" && text[i + 1] !== "'")) { if (text[i] === "'") i += 1; i += 1; } continue; }
    if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth -= 1;
    else if (c === ',' && !depth) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  if (text.slice(start).trim()) parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

// Spell types the way pg_get_function_arguments prints them, so a migration and the live database compare equal.
const TYPE_ALIASES = [
  [/\btimestamptz\b/g, 'timestamp with time zone'], [/\btimetz\b/g, 'time with time zone'],
  [/\bint4\b|\bint\b/g, 'integer'], [/\bint8\b/g, 'bigint'], [/\bint2\b/g, 'smallint'], [/\bbool\b/g, 'boolean'],
  [/\bfloat8\b/g, 'double precision'], [/\bfloat4\b/g, 'real'], [/\bvarchar\b/g, 'character varying']
];

function normaliseType(type) {
  const text = normaliseTypeSpacing(type);
  return TYPE_ALIASES.reduce((acc, [pattern, to]) => acc.replace(pattern, to), text);
}

function normaliseTypeSpacing(type) {
  return String(type).trim().replace(/\s+/g, ' ').replace(/\s*\(\s*/g, '(').replace(/\s*\)\s*/g, ')').replace(/\s*,\s*/g, ',')
    .replace(/\s*\[\s*\]/g, '[]').toLowerCase().replace(/^public\./, '').replace(/"/g, '');
}

// One argument: [in|out|inout|variadic] [name] type [default expr | = expr]. Returns null for output only arguments.
function parseArgument(text) {
  let rest = text.trim();
  let mode = 'in';
  const m = /^(inout|in|out|variadic)\s+/i.exec(rest);
  if (m) { mode = m[1].toLowerCase(); rest = rest.slice(m[0].length); }
  let hasDefault = false;
  // top level `default` keyword or `=`
  let cut = -1;
  let depth = 0;
  for (let i = 0; i < rest.length; i += 1) {
    const c = rest[i];
    if (c === "'") { i += 1; while (i < rest.length && !(rest[i] === "'" && rest[i + 1] !== "'")) { if (rest[i] === "'") i += 1; i += 1; } continue; }
    if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth -= 1;
    else if (!depth && c === '=') { cut = i; break; }
    else if (!depth && /\s/.test(rest[i - 1] || ' ') && /^default\b/i.test(rest.slice(i))) { cut = i; break; }
  }
  if (cut !== -1) { hasDefault = true; rest = rest.slice(0, cut).trim(); }
  if (mode === 'out') return null;
  const tokens = rest.split(/\s+/);
  let argName = '';
  let type = rest;
  if (tokens.length > 1 && /^"?[A-Za-z_][A-Za-z0-9_]*"?$/.test(tokens[0])) {
    // `name type...`. A name-less argument such as `double precision` is the only single-word-name look alike.
    const nameless = /^(double|character|timestamp|time|bit)$/i.test(tokens[0]) && /^(precision|varying|with|without|zone)/i.test(tokens[1]);
    if (!nameless) { argName = tokens[0].replace(/"/g, ''); type = tokens.slice(1).join(' '); }
  }
  return { argName, type: normaliseType(type), hasDefault, mode };
}

function parseArgumentList(listText) {
  return splitTopLevel(listText).map(parseArgument).filter(Boolean);
}

function identityOf(args) {
  return args.map((arg) => arg.type).join(',');
}

const CREATE_RE = new RegExp(`\\bcreate\\s+(?:or\\s+replace\\s+)?function\\s+(?:"?${SCHEMA}"?\\s*\\.\\s*)"?([A-Za-z_][A-Za-z0-9_]*)"?\\s*\\(`, 'gi');
const DROP_RE = new RegExp(`\\bdrop\\s+function\\s+(?:if\\s+exists\\s+)?(?:"?${SCHEMA}"?\\s*\\.\\s*)"?([A-Za-z_][A-Za-z0-9_]*)"?\\s*\\(`, 'gi');
const RENAME_RE = new RegExp(`\\balter\\s+function\\s+(?:"?${SCHEMA}"?\\s*\\.\\s*)"?([A-Za-z_][A-Za-z0-9_]*)"?\\s*\\([^)]*\\)\\s+rename\\s+to\\s+"?([A-Za-z_][A-Za-z0-9_]*)"?`, 'gi');

// Parse migration SQL text (in the order given) into { name: [signature, ...] }; a name has several signatures only
// when overloaded. `files` is [{ name, sql }].
function parseSql(files) {
  const live = new Map(); // key "name(types)" -> { name, args }
  for (const file of files) {
    const masked = maskBodies(maskComments(file.sql));
    const events = [];
    let m;
    CREATE_RE.lastIndex = 0;
    while ((m = CREATE_RE.exec(masked))) {
      const open = m.index + m[0].length - 1;
      const close = matchParen(masked, open);
      events.push({ at: m.index, kind: 'create', name: m[1], args: parseArgumentList(masked.slice(open + 1, close)) });
      CREATE_RE.lastIndex = close;
    }
    DROP_RE.lastIndex = 0;
    while ((m = DROP_RE.exec(masked))) {
      const open = m.index + m[0].length - 1;
      const close = matchParen(masked, open);
      events.push({ at: m.index, kind: 'drop', name: m[1], args: parseArgumentList(masked.slice(open + 1, close)) });
      DROP_RE.lastIndex = close;
    }
    RENAME_RE.lastIndex = 0;
    while ((m = RENAME_RE.exec(masked))) events.push({ at: m.index, kind: 'rename', name: m[1], to: m[2] });
    events.sort((a, b) => a.at - b.at);
    for (const event of events) {
      if (event.kind === 'create') {
        live.set(`${event.name}(${identityOf(event.args)})`, { name: event.name, args: event.args });
      } else if (event.kind === 'drop') {
        live.delete(`${event.name}(${identityOf(event.args)})`);
      } else {
        for (const [key, value] of [...live]) {
          if (value.name === event.name) { live.delete(key); live.set(`${event.to}(${identityOf(value.args)})`, { name: event.to, args: value.args }); }
        }
      }
    }
  }
  const byName = {};
  for (const { name, args } of live.values()) {
    (byName[name] = byName[name] || []).push(args.map(({ argName, type, hasDefault }) => ({ argName, type, hasDefault })));
  }
  return byName;
}

function listMigrationFiles(dir = MIGRATIONS_DIR) {
  return fs.readdirSync(dir).filter((name) => /\.sql$/.test(name)).sort().map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), 'utf8') }));
}

// The contract in the checked-in shape: { name: [{ argName, type, hasDefault }] }. A function with two signatures
// (an overload) is a problem PostgREST answers badly (PGRST203), so the parser refuses it.
function parseMigrations(dir = MIGRATIONS_DIR) {
  const byName = parseSql(listMigrationFiles(dir));
  const out = {};
  for (const name of Object.keys(byName).sort()) {
    if (byName[name].length > 1) throw new Error(`public.${name} is defined with ${byName[name].length} different argument lists (an overload); PostgREST cannot choose between them`);
    out[name] = byName[name][0];
  }
  return out;
}

function newestMigrationName(dir = MIGRATIONS_DIR) {
  const files = listMigrationFiles(dir);
  return files.length ? files[files.length - 1].name : '';
}

function readSignatures(file = SIGNATURES_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const LIVE_QUERY = "select p.proname, pg_get_function_identity_arguments(p.oid) as identity_arguments, pg_get_function_arguments(p.oid) as arguments from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by p.proname";

// Compare the rows of LIVE_QUERY with the contract. Live wins: every difference is reported. `rows` is
// [{ proname, arguments }] (pg_get_function_arguments text such as "p_id uuid, p_name text DEFAULT 'x'::text").
function compareWithLive(contract, rows) {
  const report = { onlyLive: [], onlyContract: [], different: [] };
  const live = new Map();
  for (const row of rows) {
    const name = row.proname;
    const args = parseArgumentList(String(row.arguments || '').replace(/\bDEFAULT\b/g, 'default'));
    (live.get(name) || live.set(name, []).get(name)).push(args.map(({ argName, type, hasDefault }) => ({ argName, type, hasDefault })));
  }
  for (const [name, signatures] of live) {
    if (!contract[name]) { report.onlyLive.push(name); continue; }
    const match = signatures.some((sig) => JSON.stringify(sig.map((a) => [a.argName, a.type, a.hasDefault])) === JSON.stringify(contract[name].map((a) => [a.argName, a.type, a.hasDefault])));
    if (!match) report.different.push({ name, live: signatures, contract: contract[name] });
  }
  for (const name of Object.keys(contract)) if (!live.has(name)) report.onlyContract.push(name);
  return report;
}

// The same check PostgREST makes before it runs a function: the function must exist, every key sent must be a real
// argument name, and every argument without a default must be present. Returns null when the call is accepted, or
// { status, code, message } shaped like the PostgREST answer.
function checkCall(contract, name, body) {
  const signature = contract[name];
  if (!signature) return { status: 404, code: 'PGRST202', message: `Could not find the function public.${name} in the schema cache` };
  const sent = body === undefined || body === null || body === '' ? {} : body;
  if (typeof sent !== 'object' || Array.isArray(sent)) {
    // A single unnamed json(b) parameter may receive a bare value (Prefer: params=single-object); the browser never does this.
    return { status: 404, code: 'PGRST202', message: `Could not find the function public.${name} with a request body that is not an object` };
  }
  const known = new Set(signature.map((arg) => arg.argName));
  const keys = Object.keys(sent);
  const unknown = keys.filter((key) => !known.has(key));
  const missing = signature.filter((arg) => !arg.hasDefault && !(arg.argName in sent)).map((arg) => arg.argName);
  if (unknown.length || missing.length) {
    const detail = [unknown.length ? `unknown argument(s): ${unknown.join(', ')}` : '', missing.length ? `missing required argument(s): ${missing.join(', ')}` : ''].filter(Boolean).join('; ');
    return { status: 404, code: 'PGRST202', message: `Could not find the function public.${name}(${keys.sort().join(', ')}) in the schema cache (${detail})` };
  }
  return null;
}

module.exports = {
  MIGRATIONS_DIR, SIGNATURES_FILE, LIVE_QUERY,
  parseSql, parseMigrations, listMigrationFiles, newestMigrationName, readSignatures, compareWithLive, checkCall, parseArgumentList
};

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  const contract = parseMigrations();
  const text = `${JSON.stringify(contract, null, 2)}\n`;
  if (args.has('--live-query')) {
    console.log(LIVE_QUERY);
  } else if (args.has('--write')) {
    fs.writeFileSync(SIGNATURES_FILE, text);
    console.log(`wrote ${path.relative(REPO_ROOT, SIGNATURES_FILE)}: ${Object.keys(contract).length} functions (newest migration ${newestMigrationName()})`);
  } else if (args.has('--check')) {
    let current = '';
    try { current = fs.readFileSync(SIGNATURES_FILE, 'utf8'); } catch (error) { /* missing counts as stale */ }
    if (current !== text) { console.error('supabase/rpc-signatures.json is not what the migrations produce. Run: node scripts/supabase-rpc-signatures.js --write'); process.exit(1); }
    console.log(`supabase/rpc-signatures.json is current (${Object.keys(contract).length} functions)`);
  } else {
    console.log(`${Object.keys(contract).length} public functions parsed from ${listMigrationFiles().length} migrations (newest ${newestMigrationName()})`);
  }
}
