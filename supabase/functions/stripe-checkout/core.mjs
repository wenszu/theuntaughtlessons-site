// Pure core of the stripe-checkout Edge Function.
//
// No Deno-only APIs and no Node-only APIs are used here, so the same file runs in the Supabase Edge runtime and in the
// node tests (tests/stripe-checkout-core.test.js). index.ts is the thin wrapper that reads the environment, passes fetch
// and calls Deno.serve.
//
// This is the port of createCheckoutSession (functions-admin/index.js) and createCheckoutSession in
// functions-admin/payments-service.js. Same products, prices, currency, metadata and the same redirect allowlist.
//
// Rules this file enforces:
//   - POST only. CORS answers only for our own origins.
//   - The caller must be a signed in member: the bearer token is checked by asking the database (public.get_my_checkout_identity()
//     called WITH THE CALLER'S TOKEN). No person, no checkout (401). The token is never decoded here and never logged.
//   - The settings come from app_settings key payments (service role read), exactly as the site's own settings do:
//     enabled must be true, the program must be tsa or executive-signature, the price must be a positive whole number.
//   - The Stripe call is a plain fetch to the Stripe REST API (no SDK), form encoded, with the secret key as the bearer.
//   - Nothing about the person, the token, the keys or the Stripe response is logged. The only log line is kind, status
//     and duration in milliseconds.

export const PROGRAM_IDS = ["tsa", "executive-signature"];

// Same defaults as DEFAULT_PRICES in functions-admin/payments-service.js and getDefaultPaymentSettings in assets/firebase.js.
export const DEFAULT_PRICES = Object.freeze({
  tsa: Object.freeze({ amountCents: 19900, currency: "usd", label: "Think, Speak, Act (self-guided)" }),
  "executive-signature": Object.freeze({ amountCents: 4900, currency: "usd", label: "Executive Signature full report" }),
});

// Same list as CHECKOUT_REDIRECT_ORIGINS in functions-admin/index.js.
export const REDIRECT_ORIGINS = ["https://theuntaughtlessons.com", "http://localhost", "http://127.0.0.1"];
export const STRIPE_URL = "https://api.stripe.com/v1/checkout/sessions";
export const MAX_BODY_BYTES = 10000;
export const TIMEOUT_MS = 15000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Same rule as isAllowedCheckoutRedirect: the exact origin, or the origin with a port (for localhost testing). Resolves to
// the NORMALIZED address (URL.href) or "" when the address is not allowed. The normalized form is what is sent to Stripe,
// never the raw string: the URL parser turns a backslash into a slash and resolves the host the way a browser does, so a
// trick such as https://theuntaughtlessons.com\@evil.example/ cannot reach Stripe in a spelling that Stripe might read
// differently from us. An address with a user name or password is refused.
export function normalizedRedirect(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.username || parsed.password) return "";
    const allowed = REDIRECT_ORIGINS.some((origin) => parsed.origin === origin || parsed.origin.startsWith(origin + ":"));
    return allowed ? parsed.href : "";
  } catch (error) {
    return "";
  }
}

export function isAllowedRedirect(url) {
  return normalizedRedirect(url) !== "";
}

// CORS: a browser on our own site (or localhost for testing) may call this function. Any other origin gets no CORS headers.
export function corsHeaders(origin) {
  if (!origin || !isAllowedRedirect(origin)) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

// The site's payment settings from the stored value of app_settings.payments (null or absent: the defaults).
// Same merge as getSettings in payments-service.js: a stored price replaces the default price of that program.
export function paymentSettingsFromValue(value) {
  const data = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const stored = data.prices && typeof data.prices === "object" && !Array.isArray(data.prices) ? data.prices : {};
  return { enabled: data.enabled === true, prices: Object.assign({}, DEFAULT_PRICES, stored) };
}

// Stripe takes nested form fields as a[b][c]=value and lists as a[0]=value.
export function encodeForm(value, prefix = "", pairs = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => encodeForm(item, `${prefix}[${index}]`, pairs));
  } else if (value && typeof value === "object") {
    Object.keys(value).forEach((key) => encodeForm(value[key], prefix ? `${prefix}[${key}]` : key, pairs));
  } else if (value !== undefined && value !== null) {
    pairs.push([prefix, String(value)]);
  }
  return pairs;
}

export function formBody(object) {
  return encodeForm(object).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
}

// The Checkout Session as payments-service.js creates it, plus the binding to the signed in person: customer_email (the
// person's primary email, prefilled), client_reference_id and metadata.person_id (the person's id). The webhook attaches the
// purchase to that person, not to whoever owns an email typed at the Stripe page.
export function sessionParams({ program, price, successUrl, cancelUrl, identity }) {
  const params = {
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [{
      price_data: {
        currency: price.currency || "usd",
        product_data: { name: price.label || program },
        unit_amount: price.amountCents,
      },
      quantity: 1,
    }],
    metadata: { program },
    success_url: successUrl,
    cancel_url: cancelUrl,
  };
  if (identity) {
    params.customer_email = identity.email;
    params.client_reference_id = identity.personId;
    params.metadata.person_id = identity.personId;
  }
  return params;
}

export function bearerFrom(headers) {
  const value = headers && typeof headers.get === "function" ? headers.get("authorization") : (headers && headers.authorization);
  const match = /^Bearer\s+([^\s]+)$/i.exec(String(value || "").trim());
  return match ? match[1] : "";
}

// Every failure the browser sees has this shape; the codes follow the Firebase callable codes the site already knows.
function failure(status, code, message) {
  return { status, body: { error: { code, message } } };
}

function withTimeout(fetchImpl, timeoutMs) {
  return async (url, init) => {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      return await fetchImpl(url, controller ? Object.assign({}, init, { signal: controller.signal }) : init);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

// Asks the database who the bearer token belongs to (public.get_my_checkout_identity, called with the caller's own token).
// Resolves { ok: true, personId, email } | { ok: false, reason }.
// reason "unauthenticated" is a sign in problem (401); "unavailable" is our side or the network (503).
async function resolvePerson({ supabaseUrl, anonKey, token, fetchImpl }) {
  let response;
  try {
    response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/get_my_checkout_identity`, {
      method: "POST",
      headers: { apikey: anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: "{}",
    });
  } catch (error) {
    return { ok: false, reason: "unavailable" };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, reason: "unauthenticated" };
  if (!response.ok) return { ok: false, reason: "unavailable" };
  let answer;
  try { answer = await response.json(); } catch (error) { return { ok: false, reason: "unavailable" }; }
  const personId = answer && typeof answer === "object" && typeof answer.person_id === "string" ? answer.person_id : "";
  const email = answer && typeof answer === "object" && typeof answer.email === "string" ? answer.email.trim().toLowerCase() : "";
  if (!UUID_PATTERN.test(personId) || !email || email.length > 254) return { ok: false, reason: "unauthenticated" };
  return { ok: true, personId: personId.toLowerCase(), email };
}

// Reads app_settings.payments with the service role. A missing row or a failed read is "unavailable", never "defaults":
// opening checkout because a read failed would be the unsafe direction.
async function readSettings({ supabaseUrl, serviceKey, fetchImpl }) {
  let response;
  try {
    response = await fetchImpl(`${supabaseUrl}/rest/v1/app_settings?key=eq.payments&select=value`, {
      method: "GET",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: "application/json" },
    });
  } catch (error) {
    return { ok: false };
  }
  if (!response.ok) return { ok: false };
  let rows;
  try { rows = await response.json(); } catch (error) { return { ok: false }; }
  if (!Array.isArray(rows)) return { ok: false };
  // No row at all means the default (payments closed), the same as a missing settings/payments document.
  return { ok: true, settings: paymentSettingsFromValue(rows[0] && rows[0].value) };
}

// request: { method, headers (Headers or plain object), bodyText }
// deps: { env: { STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, UTL_PUBLISHABLE_KEY },
//         fetchImpl, log, now, timeoutMs }
// Resolves to { status, body }. Success body: { url, sessionId }. Failure body: { error: { code, message } }.
export async function handleCheckout(request, deps) {
  const env = deps.env || {};
  const log = typeof deps.log === "function" ? deps.log : () => {};
  const now = typeof deps.now === "function" ? deps.now : () => Date.now();
  const fetchImpl = withTimeout(deps.fetchImpl, deps.timeoutMs || TIMEOUT_MS);
  const started = now();
  const finish = (result) => {
    log({ kind: "checkout", status: result.status, ms: Math.max(0, now() - started) });
    return result;
  };

  if (request.method !== "POST") return finish(failure(405, "invalid-argument", "Use POST."));

  const supabaseUrl = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const anonKey = String(env.SUPABASE_ANON_KEY || env.UTL_PUBLISHABLE_KEY || "").trim();
  if (!supabaseUrl || !serviceKey || !anonKey) return finish(failure(503, "failed-precondition", "Payments are not configured yet."));

  // 1. Who is asking. The token is checked by the database before anything else is read.
  const token = bearerFrom(request.headers);
  if (!token) return finish(failure(401, "unauthenticated", "Sign in to continue."));
  const person = await resolvePerson({ supabaseUrl, anonKey, token, fetchImpl });
  if (!person.ok) {
    return finish(person.reason === "unauthenticated"
      ? failure(401, "unauthenticated", "Sign in to continue.")
      : failure(503, "unavailable", "Could not start checkout. Please try again."));
  }

  // 2. The request, in the order the Firebase version checked it.
  let input;
  try { input = JSON.parse(request.bodyText || ""); } catch (error) { input = null; }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return finish(failure(400, "invalid-argument", "Checkout redirect URLs must point back to this site."));
  }
  const program = String(input.program || "").trim();
  const successUrl = normalizedRedirect(input.successUrl);
  const cancelUrl = normalizedRedirect(input.cancelUrl);
  if (!successUrl || !cancelUrl) {
    return finish(failure(400, "invalid-argument", "Checkout redirect URLs must point back to this site."));
  }
  if (!PROGRAM_IDS.includes(program)) return finish(failure(400, "invalid-argument", "Unknown program."));

  // 3. The site's payment settings.
  const read = await readSettings({ supabaseUrl, serviceKey, fetchImpl });
  if (!read.ok) return finish(failure(503, "unavailable", "Could not start checkout. Please try again."));
  const settings = read.settings;
  if (!settings.enabled) return finish(failure(409, "failed-precondition", "Payments are not open yet."));
  const price = settings.prices[program];
  if (!price || !Number.isInteger(price.amountCents) || price.amountCents <= 0) {
    return finish(failure(400, "invalid-argument", "No price is configured for this program yet."));
  }
  const stripeKey = String(env.STRIPE_SECRET_KEY || "").trim();
  if (!stripeKey) return finish(failure(409, "failed-precondition", "Payments are not configured yet."));

  // 4. Stripe.
  let created;
  try {
    const response = await fetchImpl(STRIPE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: formBody(sessionParams({ program, price, successUrl, cancelUrl, identity: person })),
    });
    if (!response.ok) return finish(failure(502, "unavailable", "Could not start checkout. Please try again."));
    created = await response.json();
  } catch (error) {
    return finish(failure(502, "unavailable", "Could not start checkout. Please try again."));
  }
  if (!created || typeof created.id !== "string" || typeof created.url !== "string" || !/^https:\/\//.test(created.url)) {
    return finish(failure(502, "unavailable", "Could not start checkout. Please try again."));
  }

  // 5. The audit trail (action, program and Stripe's session id; same as the Firebase auditEvents entry). A failure here
  //    never takes the checkout away from a member who already has a session.
  try {
    await fetchImpl(`${supabaseUrl}/rest/v1/audit_events`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        action: "checkout_session_created",
        subject_type: "person",
        subject_id: person.personId,
        person_id: person.personId,
        detail: { program, sessionId: created.id, source: "stripe-checkout" },
      }),
    });
  } catch (error) { /* best effort */ }

  return finish({ status: 200, body: { url: created.url, sessionId: created.id } });
}

// Reads a request body up to a byte limit. Resolves { ok, text }.
export async function readBodyCapped(body, maxBytes) {
  const limit = Number(maxBytes) > 0 ? Number(maxBytes) : MAX_BODY_BYTES;
  if (!body) return { ok: true, text: "" };
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        try { await reader.cancel(); } catch (error) { /* already closed */ }
        return { ok: false };
      }
      chunks.push(value);
    }
  } catch (error) {
    return { ok: false };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { ok: true, text: new TextDecoder().decode(bytes) };
}
