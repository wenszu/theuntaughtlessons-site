// stripe-checkout: starts a Stripe Checkout Session for a signed in member and returns the page address to send them to.
//
// DEPLOY WITH THE GATEWAY JWT CHECK OFF:
//   supabase functions deploy stripe-checkout --no-verify-jwt --project-ref czljyikfavtjgqcibdda
// Why: the members sign in with Firebase, and the Edge Function gateway (verify_jwt) only accepts tokens signed by
// Supabase's own keys, so it would turn every member away. The check is done inside core.mjs instead, and it is the
// same check the database applies to every member request: the bearer token is sent to public.get_my_checkout_identity()
// (called with the caller's token, never decoded here). A missing, expired, forged or unknown token gives no person
// and the function answers 401 before it reads settings or touches Stripe.
//
// Secrets this function reads (Supabase dashboard, Edge Functions, Secrets, or `supabase secrets set`):
//   STRIPE_SECRET_KEY  (sk_test_... while rehearsing, sk_live_... only at the real cut over)
//   UTL_PUBLISHABLE_KEY  (only if SUPABASE_ANON_KEY is not injected into functions of this project; the publishable
//                         key is public, it is the one already in assets/firebase.js)
// The platform injects SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY itself. The service role key is used
// for two things only: reading app_settings.payments and adding one audit_events row.
//
// All behaviour lives in core.mjs (pure, tested in node). This file only wires the environment, fetch and Deno.serve.
// It logs nothing but kind, status and duration. Nothing about the person, the token or Stripe is ever logged.
import { bearerFrom, corsHeaders, handleCheckout, MAX_BODY_BYTES, readBodyCapped } from "./core.mjs";

const log = (entry: { kind: string; status: number; ms: number }) => console.log(JSON.stringify(entry));

function json(status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders(origin) },
  });
}

Deno.serve(async (request: Request): Promise<Response> => {
  const started = Date.now();
  const origin = request.headers.get("origin");
  const early = (status: number, code: string, message: string): Response => {
    log({ kind: "checkout", status, ms: Date.now() - started });
    return json(status, { error: { code, message } }, origin);
  };

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "POST") return early(405, "invalid-argument", "Use POST.");

  // The sign in token is required before the body is read at all.
  if (!bearerFrom(request.headers)) return early(401, "unauthenticated", "Sign in to continue.");
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) return early(413, "invalid-argument", "The request is too large.");
  const body = await readBodyCapped(request.body, MAX_BODY_BYTES);
  if (!body.ok) return early(413, "invalid-argument", "The request is too large.");

  const result = await handleCheckout(
    { method: request.method, headers: request.headers, bodyText: body.text },
    {
      env: {
        STRIPE_SECRET_KEY: Deno.env.get("STRIPE_SECRET_KEY"),
        SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
        SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
        SUPABASE_ANON_KEY: Deno.env.get("SUPABASE_ANON_KEY"),
        UTL_PUBLISHABLE_KEY: Deno.env.get("UTL_PUBLISHABLE_KEY"),
      },
      fetchImpl: fetch,
      log,
    },
  );
  return json(result.status, result.body, origin);
});
