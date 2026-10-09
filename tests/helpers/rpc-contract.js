// The database function contract for every fake Supabase in the tests.
//
// A real PostgREST answers 404 (PGRST202) when /rest/v1/rpc/<name> names a function that does not exist, sends an argument
// the function does not have, or leaves out an argument that has no default. A fake that accepts any shape hides exactly that
// kind of bug (a profile save that sent bare keys instead of { p_fields: ... } passed every test and failed live).
//
// Every fake that answers /rest/v1/rpc/ requests calls  rpcContract.reject(url, init)  first:
//
//   const bad = rpcContract.reject(url, init); if (bad) return bad;
//
// It returns null when the call is accepted, or a fetch Response look alike (404, PostgREST body) for the fake to return. A
// rejected call is also recorded; when the test process ends with a recorded rejection it prints them and exits with 1, even if
// the code under test swallowed the 404. A test that sends a bad shape ON PURPOSE (tests/rpc-call-contract.test.js) uses
// rpcContract.expectRejections(fn) so those are not counted.
//
// The contract is supabase/rpc-signatures.json, made from the migrations by scripts/supabase-rpc-signatures.js.

'use strict';

const path = require('path');
const { readSignatures, checkCall } = require(path.join(__dirname, '..', '..', 'scripts', 'supabase-rpc-signatures.js'));

const contract = readSignatures();
const rejections = [];
let expecting = 0;

function pathOf(url) {
  const text = typeof url === 'string' ? url : (url && url.url) || String(url);
  const m = /\/rest\/v1\/rpc\/([A-Za-z0-9_]+)(\?[^#]*)?$/.exec(text);
  return m ? { name: m[1], query: m[2] || '' } : null;
}

// The JSON body of a request, or the query string of a GET.
function argumentsOf(init, query) {
  const method = String((init && init.method) || 'POST').toUpperCase();
  if (method === 'GET' || method === 'HEAD') {
    const out = {};
    new URLSearchParams(query).forEach((value, key) => { out[key] = value; });
    return out;
  }
  const raw = init && init.body;
  if (raw === undefined || raw === null || raw === '') return {};
  if (typeof raw === 'object' && !(typeof raw === 'string')) return raw;
  try { return JSON.parse(String(raw)); } catch (error) { return { __unparsable__: true }; }
}

function response(status, body) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => text,
    json: async () => JSON.parse(text),
    clone() { return response(status, body); }
  };
}

// Returns null (accepted or not an rpc request) or a 404 response, and records the rejection.
function reject(url, init) {
  const target = pathOf(url);
  if (!target) return null;
  const args = argumentsOf(init, target.query);
  const problem = args && args.__unparsable__ ? { status: 400, code: 'PGRST100', message: `The request body of ${target.name} is not JSON` } : checkCall(contract, target.name, args);
  if (!problem) return null;
  if (!expecting) rejections.push({ name: target.name, keys: Object.keys(args || {}), message: problem.message });
  return response(problem.status, { code: problem.code, details: null, hint: null, message: problem.message });
}

// For a fake of supabase-js's client.rpc(name, args): returns { data: null, error } like the client does for a refused call, or null.
function rejectCall(name, args) {
  const refused = reject(`https://fake.supabase.co/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(args === undefined ? {} : args) });
  if (!refused) return null;
  return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name} in the schema cache`, status: 404 } };
}

function expectRejections(fn) {
  expecting += 1;
  const done = () => { expecting -= 1; };
  try {
    const out = fn();
    if (out && typeof out.then === 'function') return out.then((value) => { done(); return value; }, (error) => { done(); throw error; });
    done();
    return out;
  } catch (error) {
    done();
    throw error;
  }
}

process.on('exit', (code) => {
  if (!rejections.length) return;
  console.error(`\nDATABASE FUNCTION CONTRACT: ${rejections.length} request(s) were refused by the fake exactly as PostgREST would refuse them:`);
  rejections.forEach((r) => console.error(`  ${r.name}(${r.keys.join(', ')}): ${r.message}`));
  if (!code) process.exitCode = 1;
});

module.exports = { reject, rejectCall, expectRejections, rejections, contract };
