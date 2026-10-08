// functions-admin/supabase-token.js: server side check of a Supabase Auth access token.
// Keys are generated here; nothing talks to a real service. Run: node tests/supabase-token.test.js

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const token = require('../functions-admin/supabase-token');

const PROJECT = 'https://czljyikfavtjgqcibdda.supabase.co';
const ISS = `${PROJECT}/auth/v1`;
const SUB = '22222222-3333-4444-8555-666666666666';
const NOW = Date.parse('2026-10-08T12:00:00Z');
const NOW_S = Math.floor(NOW / 1000);

const b64u = (value) => Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const json = (value) => b64u(JSON.stringify(value));

const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const ec2 = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwkOf = (pair, kid, extra = {}) => Object.assign(pair.publicKey.export({ format: 'jwk' }), { kid }, extra);

function sign(header, payload, key) {
  const input = `${json(header)}.${json(payload)}`;
  let signature;
  if (header.alg === 'ES256') signature = crypto.sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
  else if (header.alg === 'RS256') signature = crypto.sign('RSA-SHA256', Buffer.from(input), key);
  else if (header.alg === 'HS256') signature = crypto.createHmac('sha256', key).update(input).digest();
  else signature = Buffer.from('unsigned');
  return `${input}.${b64u(signature)}`;
}
const claims = (extra = {}) => Object.assign({
  iss: ISS, aud: 'authenticated', sub: SUB, role: 'authenticated', email: 'Member@Example.test', exp: NOW_S + 3600, iat: NOW_S - 60,
  session_id: 'sess-1', aal: 'aal1', is_anonymous: false, user_metadata: { full_name: 'Member One', email_verified: true }
}, extra);
const esToken = (extra, header = {}) => sign(Object.assign({ alg: 'ES256', typ: 'JWT', kid: 'ec1' }, header), claims(extra), ec.privateKey);

function jwksServer(initialKeys) {
  const state = { keys: initialKeys, calls: 0, fail: false };
  state.fetchImpl = async () => {
    state.calls += 1;
    if (state.fail) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ keys: state.keys }) };
  };
  return state;
}
function verifierFor(server, extra = {}) {
  let clock = NOW;
  const verifier = token.createSupabaseTokenVerifier(Object.assign({ fetchImpl: server.fetchImpl, now: () => clock }, extra));
  verifier.advance = (ms) => { clock += ms; };
  return verifier;
}
const refusal = async (promise) => { try { await promise; } catch (error) { assert.ok(error instanceof token.SupabaseTokenError, `a SupabaseTokenError, got ${error && error.message}`); return error.code; } assert.fail('expected a refusal'); };

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; } catch (error) { error.message = `[${name}] ${error.message}`; throw error; }
}

(async function main() {
  await check('defaults: project URL, issuer and audience', () => {
    const verifier = token.createSupabaseTokenVerifier({ fetchImpl: async () => ({}) });
    assert.equal(token.DEFAULT_PROJECT_URL, PROJECT);
    assert.equal(verifier.issuer, ISS);
    assert.equal(verifier.audience, 'authenticated');
  });

  await check('a valid ES256 token verifies; email is lowercased; the label comes from user_metadata but decides nothing', async () => {
    const server = jwksServer([jwkOf(ec, 'ec1')]);
    const result = await verifierFor(server).verify(esToken());
    assert.equal(result.sub, SUB);
    assert.equal(result.email, 'member@example.test');
    assert.equal(result.role, 'authenticated');
    assert.equal(result.sessionId, 'sess-1');
    assert.equal(result.name, 'Member One');
    assert.equal(result.expiresAt, NOW_S + 3600);
    assert.equal(server.calls, 1);
  });
  await check('a valid RS256 token verifies', async () => {
    const server = jwksServer([jwkOf(rsa, 'rs1')]);
    const result = await verifierFor(server).verify(sign({ alg: 'RS256', typ: 'JWT', kid: 'rs1' }, claims(), rsa.privateKey));
    assert.equal(result.sub, SUB);
  });
  await check('a valid HS256 token verifies only when the legacy secret is configured', async () => {
    const secret = 'legacy-jwt-secret-for-the-test-only-0123456789';
    const t = sign({ alg: 'HS256', typ: 'JWT' }, claims(), secret);
    assert.equal((await verifierFor(jwksServer([]), { jwtSecret: secret }).verify(t)).sub, SUB);
    assert.equal(await refusal(verifierFor(jwksServer([])).verify(t)), 'unsupported_alg');
    assert.equal(await refusal(verifierFor(jwksServer([]), { jwtSecret: 'another-secret' }).verify(t)), 'bad_signature');
  });
  await check('the key list is cached, and an unknown kid causes at most one reload per minute', async () => {
    const server = jwksServer([jwkOf(ec, 'ec1')]);
    const verifier = verifierFor(server);
    await verifier.verify(esToken());
    await verifier.verify(esToken());
    assert.equal(server.calls, 1, 'cached');
    const other = sign({ alg: 'ES256', typ: 'JWT', kid: 'ec2' }, claims(), ec2.privateKey);
    assert.equal(await refusal(verifier.verify(other)), 'unknown_key');
    assert.equal(server.calls, 1, 'a fresh list is not reloaded for an unknown kid inside the minute');
    verifier.advance(61 * 1000);
    server.keys = [jwkOf(ec, 'ec1'), jwkOf(ec2, 'ec2')];
    assert.equal((await verifier.verify(sign({ alg: 'ES256', typ: 'JWT', kid: 'ec2' }, claims({ exp: NOW_S + 7200 }), ec2.privateKey))).sub, SUB);
    assert.equal(server.calls, 2, 'a key rotation is picked up');
    verifier.advance(11 * 60 * 1000);
    await verifier.verify(esToken({ exp: NOW_S + 20000 }));
    assert.equal(server.calls, 3, 'the list is reloaded after ten minutes');
  });
  await check('when the key list cannot be loaded the token is refused (fail closed)', async () => {
    const server = jwksServer([jwkOf(ec, 'ec1')]);
    server.fail = true;
    assert.equal(await refusal(verifierFor(server).verify(esToken())), 'jwks_unavailable');
    const thrower = token.createSupabaseTokenVerifier({ fetchImpl: async () => { throw new Error('offline'); }, now: () => NOW });
    assert.equal(await refusal(thrower.verify(esToken())), 'jwks_unavailable');
  });

  const refusals = [
    ['an expired token', () => esToken({ exp: NOW_S - 120 }), 'expired'],
    ['a token without expiry', () => esToken({ exp: undefined }), 'no_expiry'],
    ['a token from another project', () => esToken({ iss: 'https://other.supabase.co/auth/v1' }), 'bad_issuer'],
    ['a Firebase token', () => esToken({ iss: 'https://securetoken.google.com/the-untaught-lessons' }), 'bad_issuer'],
    ['a token with no issuer', () => esToken({ iss: undefined }), 'bad_issuer'],
    ['a token for another audience', () => esToken({ aud: 'anon' }), 'bad_audience'],
    ['a token with a list of audiences without authenticated', () => esToken({ aud: ['x', 'y'] }), 'bad_audience'],
    ['an anon role token', () => esToken({ role: 'anon' }), 'bad_role'],
    ['a service role token', () => esToken({ role: 'service_role' }), 'bad_role'],
    ['a subject that is not a uuid', () => esToken({ sub: 'fb_uid_1234' }), 'bad_subject'],
    ['an anonymous session', () => esToken({ is_anonymous: true }), 'anonymous'],
    ['a token that is not valid yet', () => esToken({ nbf: NOW_S + 3600 }), 'not_yet_valid'],
    ['alg none', () => `${json({ alg: 'none', typ: 'JWT' })}.${json(claims())}.`, 'malformed'],
    ['alg none with an empty signature part', () => `${json({ alg: 'none', typ: 'JWT', kid: 'ec1' })}.${json(claims())}.${b64u('x')}`, 'unsupported_alg'],
    ['an unsupported algorithm', () => sign({ alg: 'ES384', typ: 'JWT', kid: 'ec1' }, claims(), ec.privateKey), 'unsupported_alg'],
    ['a token with no kid', () => sign({ alg: 'ES256', typ: 'JWT' }, claims(), ec.privateKey), 'unknown_key'],
    ['a token signed by another key under a known kid', () => sign({ alg: 'ES256', typ: 'JWT', kid: 'ec1' }, claims(), ec2.privateKey), 'bad_signature'],
    ['text that is not a token', () => 'not-a-token', 'malformed'],
    ['an empty token', () => '', 'malformed'],
    ['an oversize token', () => 'a'.repeat(9000), 'malformed']
  ];
  for (const [name, make, code] of refusals) {
    await check(`refused: ${name}`, async () => {
      assert.equal(await refusal(verifierFor(jwksServer([jwkOf(ec, 'ec1')])).verify(make())), code);
    });
  }
  await check('refused: a tampered payload with the old signature', async () => {
    const parts = esToken().split('.');
    const forged = `${parts[0]}.${json(claims({ sub: '99999999-3333-4444-8555-666666666666' }))}.${parts[2]}`;
    assert.equal(await refusal(verifierFor(jwksServer([jwkOf(ec, 'ec1')])).verify(forged)), 'bad_signature');
  });
  await check('refused: algorithm confusion (an HS256 token "signed" with the public key as the secret, with no legacy secret configured)', async () => {
    const publicPem = ec.publicKey.export({ type: 'spki', format: 'pem' });
    const forged = sign({ alg: 'HS256', typ: 'JWT', kid: 'ec1' }, claims(), publicPem);
    assert.equal(await refusal(verifierFor(jwksServer([jwkOf(ec, 'ec1')])).verify(forged)), 'unsupported_alg');
  });
  await check('refused: an RS256 token against an EC key and an ES256 token against an RSA key', async () => {
    const server = jwksServer([jwkOf(ec, 'ec1'), jwkOf(rsa, 'rs1')]);
    const verifier = verifierFor(server);
    assert.equal(await refusal(verifier.verify(sign({ alg: 'RS256', typ: 'JWT', kid: 'ec1' }, claims(), rsa.privateKey))), 'bad_signature');
    assert.equal(await refusal(verifier.verify(sign({ alg: 'ES256', typ: 'JWT', kid: 'rs1' }, claims(), ec.privateKey))), 'bad_signature');
  });
  await check('refused: a key whose own alg differs, and a key marked for encryption', async () => {
    const wrongAlg = verifierFor(jwksServer([jwkOf(ec, 'ec1', { alg: 'RS256' })]));
    assert.equal(await refusal(wrongAlg.verify(esToken())), 'bad_signature');
    const encryptionKey = verifierFor(jwksServer([jwkOf(ec, 'ec1', { use: 'enc' })]));
    assert.equal(await refusal(encryptionKey.verify(esToken())), 'unknown_key');
  });
  await check('tolerance: 30 seconds past expiry is accepted, 31 is not; anonymous can be allowed on purpose', async () => {
    const verifier = verifierFor(jwksServer([jwkOf(ec, 'ec1')]));
    assert.equal((await verifier.verify(esToken({ exp: NOW_S - 29 }))).sub, SUB);
    assert.equal(await refusal(verifier.verify(esToken({ exp: NOW_S - 31 }))), 'expired');
    const lenient = verifierFor(jwksServer([jwkOf(ec, 'ec1')]), { allowAnonymous: true });
    assert.equal((await lenient.verify(esToken({ is_anonymous: true }))).sub, SUB);
  });
  await check('an audience list that includes authenticated is accepted', async () => {
    assert.equal((await verifierFor(jwksServer([jwkOf(ec, 'ec1')])).verify(esToken({ aud: ['x', 'authenticated'] }))).sub, SUB);
  });
  await check('a custom project URL changes the issuer and the key list address', async () => {
    const seen = [];
    const verifier = token.createSupabaseTokenVerifier({ projectUrl: 'https://abc.supabase.co/', now: () => NOW, fetchImpl: async (url) => { seen.push(url); return { ok: true, json: async () => ({ keys: [jwkOf(ec, 'ec1')] }) }; } });
    assert.equal(verifier.issuer, 'https://abc.supabase.co/auth/v1');
    assert.equal((await verifier.verify(esToken({ iss: 'https://abc.supabase.co/auth/v1' }))).sub, SUB);
    assert.deepEqual(seen, ['https://abc.supabase.co/auth/v1/.well-known/jwks.json']);
  });

  // ---- requireSupabaseCaller
  const good = () => ({ verifier: verifierFor(jwksServer([jwkOf(ec, 'ec1')])), token: esToken(), isEmailConfirmed: async () => true });
  await check('requireSupabaseCaller returns the caller when the token and the confirmation hold', async () => {
    const calls = [];
    const input = good();
    input.isEmailConfirmed = async (sub, email) => { calls.push([sub, email]); return true; };
    const caller = await token.requireSupabaseCaller(input);
    assert.equal(caller.uid, SUB);
    assert.equal(caller.email, 'member@example.test');
    assert.equal(caller.source, 'supabase');
    assert.deepEqual(calls, [[SUB, 'member@example.test']]);
  });
  await check('requireSupabaseCaller fails closed: no hook, a false answer, a throwing hook, no email, a bad token', async () => {
    const noHook = good(); delete noHook.isEmailConfirmed;
    assert.equal(await refusal(token.requireSupabaseCaller(noHook)), 'not_configured');
    assert.equal(await refusal(token.requireSupabaseCaller({ ...good(), verifier: null })), 'not_configured');
    assert.equal(await refusal(token.requireSupabaseCaller({ ...good(), isEmailConfirmed: async () => false })), 'email_not_verified');
    assert.equal(await refusal(token.requireSupabaseCaller({ ...good(), isEmailConfirmed: async () => 'yes' })), 'email_not_verified');
    assert.equal(await refusal(token.requireSupabaseCaller({ ...good(), isEmailConfirmed: async () => { throw new Error('admin api down'); } })), 'email_not_verified');
    assert.equal(await refusal(token.requireSupabaseCaller({ ...good(), token: esToken({ email: undefined }) })), 'no_email');
    assert.equal(await refusal(token.requireSupabaseCaller({ ...good(), token: 'garbage' })), 'malformed');
  });
  await check('user_metadata.email_verified is never used as proof', async () => {
    const forged = esToken({ user_metadata: { email_verified: true } });
    assert.equal(await refusal(token.requireSupabaseCaller({ ...good(), token: forged, isEmailConfirmed: async () => false })), 'email_not_verified');
  });

  // ---- finding the token
  await check('extractToken reads the callable data field; bearerFromHeaders reads a bearer header', () => {
    assert.equal(token.TOKEN_FIELD, 'supabaseAccessToken');
    assert.equal(token.extractToken({ data: { supabaseAccessToken: ' abc.def.ghi ' } }), 'abc.def.ghi');
    assert.equal(token.extractToken({ data: { supabaseAccessToken: 5 } }), '');
    assert.equal(token.extractToken({ data: 'x' }), '');
    assert.equal(token.extractToken(null), '');
    assert.equal(token.bearerFromHeaders({ authorization: 'Bearer abc.def.ghi' }), 'abc.def.ghi');
    assert.equal(token.bearerFromHeaders({ Authorization: 'bearer abc' }), 'abc');
    assert.equal(token.bearerFromHeaders(new Headers({ Authorization: 'Bearer xyz' })), 'xyz');
    assert.equal(token.bearerFromHeaders({ authorization: 'Basic abc' }), '');
    assert.equal(token.bearerFromHeaders({ authorization: 'Bearer a b' }), '');
    assert.equal(token.bearerFromHeaders(null), '');
  });

  // ---- not wired
  await check('the helper is not wired into any callable yet', () => {
    const sources = ['index.js', 'readiness-email.js', 'results-email.js', 'customer-program-service.js']
      .map((file) => fs.readFileSync(path.join(REPO_ROOT, 'functions-admin', file), 'utf8'));
    sources.forEach((source) => assert.ok(!/supabase-token/.test(source), 'no file requires supabase-token yet'));
  });
  await check('the file holds no secret and needs no package beyond Node', () => {
    const source = fs.readFileSync(path.join(REPO_ROOT, 'functions-admin', 'supabase-token.js'), 'utf8');
    assert.ok(!/service_role|sb_secret|eyJ[A-Za-z0-9_-]{20,}/.test(source.replace(/"service_role" tokens/g, '')));
    const requires = (source.match(/require\("[^"]+"\)/g) || []);
    assert.deepEqual(requires, ['require("crypto")']);
  });

  console.log(`${passed} checks passed`);
}()).catch((error) => { console.error(error); process.exit(1); });
