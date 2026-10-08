"use strict";

// Verifies a Supabase Auth access token on the server. NOT wired into any callable yet (docs/SUPABASE_PLAN_SIGNIN.md,
// section 6.3): the callables in index.js still trust only Firebase sign in. This file is the one shared check they
// would call once sign in moves.
//
// What a valid token is (all of it, or the token is refused):
//   - a JWT of at most 8 KB signed with ES256 or RS256 by a key in the project's published key set
//     (<project>/auth/v1/.well-known/jwks.json), or with HS256 and the project's legacy JWT secret when one is given
//   - iss equal to <project url>/auth/v1, aud (a string, or a list that includes it) equal to "authenticated"
//   - exp in the future (30 seconds of clock tolerance), nbf not in the future, sub with uuid shape
//   - role "authenticated" (the "anon" and "service_role" tokens are refused) and not an anonymous user
// The algorithm comes from a fixed list and must match the key type: "none" is refused, and an HS256 token is never
// checked against a public key (the classic algorithm confusion attack).
//
// What it does NOT decide:
//   - Whether the email is verified. A Supabase token has no trustworthy email_verified claim: user_metadata is written
//     by the signed in person, and the top level email is present for any confirmed account. requireSupabaseCaller()
//     therefore asks the caller to pass isEmailConfirmed(sub, email), which should read the account record with the
//     Auth Admin API (auth.admin.getUserById: email_confirmed_at set, not banned) or auth.users. It refuses when the hook
//     is missing, so a callable cannot forget the check.
//   - Who the person is. The caller's identity key is the Supabase user id (sub), which maps to people.supabase_uid
//     (migration 1800 and 2270). Code that keys on a Firebase uid (platform_staff/{uid}, organizations/*/members/{uid},
//     customerAuthLinks/{uid}) must look the person up by email or supabase_uid first.
//   - What the person may do. Roles still come from the database (authorized_members, platform_staff, role_grants).
//
// A Firebase onCall function verifies the Authorization header itself before the handler runs, and refuses a header that
// is not a Firebase token. A browser with only a Supabase session therefore sends the token inside the request data
// (field supabaseAccessToken, see extractToken) and no Authorization header, or the function is moved to an onRequest
// function or an Edge Function, where the bearer header is read directly (see bearerFromHeaders).

const crypto = require("crypto");

const DEFAULT_PROJECT_URL = "https://czljyikfavtjgqcibdda.supabase.co";
const TOKEN_FIELD = "supabaseAccessToken";
const MAX_TOKEN_LENGTH = 8192;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class SupabaseTokenError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "SupabaseTokenError";
    this.code = code;
  }
}

function fromBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]*$/.test(value)) throw new SupabaseTokenError("malformed", "The token is not a valid JWT.");
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function parseJson(buffer) {
  try {
    const value = JSON.parse(buffer.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value;
  } catch (error) {
    throw new SupabaseTokenError("malformed", "The token is not a valid JWT.");
  }
}

function decode(token) {
  if (typeof token !== "string" || !token || token.length > MAX_TOKEN_LENGTH) throw new SupabaseTokenError("malformed", "The token is missing or too large.");
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) throw new SupabaseTokenError("malformed", "The token is not a valid JWT.");
  return {
    header: parseJson(fromBase64Url(parts[0])),
    payload: parseJson(fromBase64Url(parts[1])),
    signature: fromBase64Url(parts[2]),
    signingInput: Buffer.from(`${parts[0]}.${parts[1]}`, "utf8")
  };
}

function createSupabaseTokenVerifier(options = {}) {
  const projectUrl = String(options.projectUrl || DEFAULT_PROJECT_URL).replace(/\/+$/, "");
  const issuer = `${projectUrl}/auth/v1`;
  const audience = String(options.audience || "authenticated");
  const jwtSecret = options.jwtSecret ? String(options.jwtSecret) : "";
  const jwksUrl = String(options.jwksUrl || `${issuer}/.well-known/jwks.json`);
  const fetchImpl = options.fetchImpl || (typeof fetch === "function" ? fetch : null);
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const toleranceSeconds = Number.isFinite(options.clockToleranceSeconds) ? options.clockToleranceSeconds : 30;
  const jwksTtlMs = Number.isFinite(options.jwksTtlMs) ? options.jwksTtlMs : 10 * 60 * 1000;
  const jwksMinRefreshMs = Number.isFinite(options.jwksMinRefreshMs) ? options.jwksMinRefreshMs : 60 * 1000;
  const allowAnonymous = options.allowAnonymous === true;

  let keys = new Map(); // kid -> { jwk, key }
  let fetchedAt = 0;
  let inFlight = null;

  async function loadKeys() {
    if (typeof fetchImpl !== "function") throw new SupabaseTokenError("jwks_unavailable", "No fetch function is available to load the signing keys.");
    let response;
    try {
      response = await fetchImpl(jwksUrl, { headers: { Accept: "application/json" } });
    } catch (error) {
      throw new SupabaseTokenError("jwks_unavailable", "The signing keys could not be loaded.");
    }
    if (!response || !response.ok) throw new SupabaseTokenError("jwks_unavailable", "The signing keys could not be loaded.");
    let body;
    try { body = await response.json(); } catch (error) { throw new SupabaseTokenError("jwks_unavailable", "The signing keys could not be read."); }
    const list = body && Array.isArray(body.keys) ? body.keys : [];
    const next = new Map();
    list.forEach((jwk) => {
      if (!jwk || typeof jwk.kid !== "string" || !jwk.kid) return;
      if (jwk.use && jwk.use !== "sig") return;
      if (Array.isArray(jwk.key_ops) && !jwk.key_ops.includes("verify")) return;
      try {
        next.set(jwk.kid, { jwk, key: crypto.createPublicKey({ key: jwk, format: "jwk" }) });
      } catch (error) {
        // A key this runtime cannot read is skipped.
      }
    });
    keys = next;
    fetchedAt = now();
  }

  function refresh() {
    if (!inFlight) inFlight = loadKeys().finally(() => { inFlight = null; });
    return inFlight;
  }

  // A known key is used while the list is fresh; an unknown kid triggers at most one reload per jwksMinRefreshMs (a key
  // rotation), so a stream of bad kids cannot be used to hammer the key endpoint.
  async function keyFor(kid) {
    if (!fetchedAt || now() - fetchedAt > jwksTtlMs) await refresh();
    if (!keys.has(kid) && now() - fetchedAt >= jwksMinRefreshMs) await refresh();
    return keys.get(kid) || null;
  }

  function verifySignature(alg, parsed, entry) {
    if (alg === "ES256") {
      if (entry.jwk.kty !== "EC" || entry.jwk.crv !== "P-256") return false;
      return crypto.verify("sha256", parsed.signingInput, { key: entry.key, dsaEncoding: "ieee-p1363" }, parsed.signature);
    }
    if (entry.jwk.kty !== "RSA") return false;
    return crypto.verify("RSA-SHA256", parsed.signingInput, entry.key, parsed.signature);
  }

  async function verify(token) {
    const parsed = decode(token);
    const alg = parsed.header.alg;
    if (alg !== "ES256" && alg !== "RS256" && alg !== "HS256") throw new SupabaseTokenError("unsupported_alg", "The token uses an unsupported signature algorithm.");

    if (alg === "HS256") {
      if (!jwtSecret) throw new SupabaseTokenError("unsupported_alg", "HS256 tokens are not accepted by this configuration.");
      const expected = crypto.createHmac("sha256", jwtSecret).update(parsed.signingInput).digest();
      if (expected.length !== parsed.signature.length || !crypto.timingSafeEqual(expected, parsed.signature)) {
        throw new SupabaseTokenError("bad_signature", "The token signature is not valid.");
      }
    } else {
      const kid = parsed.header.kid;
      if (typeof kid !== "string" || !kid) throw new SupabaseTokenError("unknown_key", "The token names no signing key.");
      const entry = await keyFor(kid);
      if (!entry) throw new SupabaseTokenError("unknown_key", "The token was signed with an unknown key.");
      if (entry.jwk.alg && entry.jwk.alg !== alg) throw new SupabaseTokenError("bad_signature", "The token signature is not valid.");
      let valid = false;
      try { valid = verifySignature(alg, parsed, entry); } catch (error) { valid = false; }
      if (!valid) throw new SupabaseTokenError("bad_signature", "The token signature is not valid.");
    }

    const claims = parsed.payload;
    const nowSeconds = Math.floor(now() / 1000);
    if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp)) throw new SupabaseTokenError("no_expiry", "The token has no expiry.");
    if (claims.exp + toleranceSeconds <= nowSeconds) throw new SupabaseTokenError("expired", "The token has expired.");
    if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf - toleranceSeconds > nowSeconds)) throw new SupabaseTokenError("not_yet_valid", "The token is not valid yet.");
    if (claims.iss !== issuer) throw new SupabaseTokenError("bad_issuer", "The token was not issued by this project.");
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(audience)) throw new SupabaseTokenError("bad_audience", "The token is not for signed in members.");
    if (claims.role !== "authenticated") throw new SupabaseTokenError("bad_role", "The token is not a signed in member token.");
    if (typeof claims.sub !== "string" || !UUID_PATTERN.test(claims.sub)) throw new SupabaseTokenError("bad_subject", "The token has no valid subject.");
    if (claims.is_anonymous === true && !allowAnonymous) throw new SupabaseTokenError("anonymous", "Anonymous sessions are not accepted.");

    const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
    return {
      sub: claims.sub.toLowerCase(),
      email,
      role: claims.role,
      sessionId: typeof claims.session_id === "string" ? claims.session_id : "",
      aal: typeof claims.aal === "string" ? claims.aal : "",
      expiresAt: claims.exp,
      // A label only: the signed in person can edit user_metadata, so nothing is decided from it.
      name: claims.user_metadata && typeof claims.user_metadata.full_name === "string" ? claims.user_metadata.full_name.slice(0, 200) : "",
      claims
    };
  }

  return { verify, issuer, audience };
}

// The token in a Firebase callable request: the data field supabaseAccessToken. Returns "" when there is none.
function extractToken(request) {
  const data = request && request.data;
  const value = data && typeof data === "object" ? data[TOKEN_FIELD] : "";
  return typeof value === "string" ? value.trim() : "";
}

// The bearer token of a plain HTTP request (onRequest function, Edge Function). Headers may be a plain object or a Headers.
function bearerFromHeaders(headers) {
  if (!headers) return "";
  const raw = typeof headers.get === "function" ? headers.get("authorization") : (headers.authorization || headers.Authorization);
  const match = typeof raw === "string" ? raw.match(/^Bearer\s+(\S+)$/i) : null;
  return match ? match[1] : "";
}

// Verifies the token and the email confirmation, and returns the caller in the shape requireVerifiedCaller returns
// ({ uid, email }) plus the source. uid is the Supabase user id: it is NOT a Firebase uid.
async function requireSupabaseCaller(input) {
  const { token, verifier, isEmailConfirmed } = input || {};
  if (!verifier || typeof verifier.verify !== "function") throw new SupabaseTokenError("not_configured", "No token verifier was given.");
  if (typeof isEmailConfirmed !== "function") throw new SupabaseTokenError("not_configured", "An email confirmation check is required.");
  const claims = await verifier.verify(token);
  if (!claims.email) throw new SupabaseTokenError("no_email", "The token has no email address.");
  let confirmed = false;
  try { confirmed = (await isEmailConfirmed(claims.sub, claims.email)) === true; } catch (error) { confirmed = false; }
  if (!confirmed) throw new SupabaseTokenError("email_not_verified", "The email address of this account is not verified.");
  return { uid: claims.sub, email: claims.email, name: claims.name, source: "supabase", claims };
}

module.exports = {
  DEFAULT_PROJECT_URL,
  TOKEN_FIELD,
  SupabaseTokenError,
  createSupabaseTokenVerifier,
  extractToken,
  bearerFromHeaders,
  requireSupabaseCaller
};
