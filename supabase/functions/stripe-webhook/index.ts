// stripe-webhook: receives Stripe's "checkout.session.completed" and grants the purchase.
//
// DEPLOY WITH THE GATEWAY JWT CHECK OFF:
//   supabase functions deploy stripe-webhook --no-verify-jwt --project-ref czljyikfavtjgqcibdda
// The caller is Stripe, not a person, so it carries no Supabase token. The ONLY lock is the Stripe-Signature header,
// checked in core.mjs with HMAC SHA256 and the secret STRIPE_WEBHOOK_SECRET over the raw request bytes, with a 5 minute
// time limit and a constant time comparison. Because verify_jwt is off, that signature is the only protection: the
// endpoint secret must be the whsec_ value of THIS endpoint (Stripe gives each endpoint its own), and it is never logged
// and never put in a web page. Without a valid signature the function reads nothing and writes nothing.
//
// Secrets this function reads (Supabase dashboard, Edge Functions, Secrets, or `supabase secrets set`):
//   STRIPE_WEBHOOK_SECRET
// The platform injects SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY itself. The function does not need STRIPE_SECRET_KEY:
// it never calls the Stripe API, because everything it needs is in the signed event.
//
// All behaviour lives in core.mjs (pure, tested in node). This file only wires the environment, fetch and Deno.serve. It
// logs nothing but kind, Stripe event type, status, a short reason and duration. No email, no session id, no body.
import { handleWebhook, MAX_BODY_BYTES, readBytesCapped } from "./core.mjs";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

const log = (entry: Record<string, unknown>) => console.log(JSON.stringify(entry));

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

Deno.serve(async (request: Request): Promise<Response> => {
  const started = Date.now();
  const early = (status: number, reason: string, extra: Record<string, string> = {}): Response => {
    log({ kind: "stripe-webhook", type: "unknown", status, reason, ms: Date.now() - started });
    return json(status, { received: false }, extra);
  };

  if (request.method !== "POST") return early(405, "method", { Allow: "POST" });

  // A signed event is small. Refuse a large body before reading it, and cap the stream itself.
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) return early(413, "too-large");
  const body = await readBytesCapped(request.body, MAX_BODY_BYTES);
  if (!body.ok) return early(413, "too-large");

  const result = await handleWebhook(
    { method: request.method, headers: request.headers, rawBody: body.bytes },
    {
      env: {
        STRIPE_WEBHOOK_SECRET: Deno.env.get("STRIPE_WEBHOOK_SECRET"),
        SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
        SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
      },
      fetchImpl: fetch,
      log,
    },
  );
  return json(result.status, result.body);
});
