// readiness-submit: the public Executive Signature submission (free quick check and full assessment) as an Edge Function.
// It replaces the Firebase callable recordReadinessCompletion.
//
// Address:
//   POST https://czljyikfavtjgqcibdda.supabase.co/functions/v1/readiness-submit
//   (the same request body the Firebase callable takes: email, name, tier, band, profile, formVersion, submissionId,
//    answers, itemOrder, startedAt, durationSeconds, consent, source; the answer is { ok: true, attemptId })
//
// DEPLOY WITH THE GATEWAY TOKEN CHECK OFF:
//   supabase functions deploy readiness-submit --no-verify-jwt --project-ref czljyikfavtjgqcibdda
// The endpoint is anonymous by design: a person who just finished the quick check has no account and no session. There is
// no token to check, so the protection is in core.mjs and in the database function: the origin list, JSON only, a 32 KB body
// cap, full validation, server side scoring, and limits per email (5 per hour, 10 per day), per hashed address (30 per hour, IPv6
// by /64 block, address from cf-connecting-ip only, unknown addresses share 10 per hour) and globally (2000 per day marks attempts
// as suspect; 20000 per day is an emergency ceiling that answers 429).
//
// Secrets this function reads (Supabase dashboard, Edge Functions, Secrets, or `supabase secrets set`):
//   ES_CREATE_AUTH_USER (optional, the text "on" also creates an unconfirmed sign in account for the email, after the result
//                        is saved; anything else, or not set, creates none)
//   ES_FULL_ACCESS      (optional; NOT SET keeps today's Firebase behaviour: the anonymous full assessment gets its own one
//                        comped entitlement. The exact text "comped" does the same. ANY other text, including "entitlement" and
//                        every typo, refuses the anonymous full assessment with "Sign in required.", because this endpoint
//                        never uses a person's paid or sponsored entitlement: it cannot prove who owns the email address)
// The platform injects SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY itself. The service key is only used on the server, to call
// the database function and the Auth Admin API; it is never sent to a browser.
//
// All behaviour lives in core.mjs (pure, tested in node). This file only wires the environment, fetch and Deno.serve. It
// logs nothing but kind, status, duration and a fixed note. It never logs an email, a name, an answer or a key.
import { handleReadinessSubmit, readBodyCapped } from "./core.mjs";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

// The only log line in this function. See core.mjs.
const log = (entry: { kind: string; status: number; ms: number; note: string }) => console.log(JSON.stringify(entry));

Deno.serve(async (request: Request): Promise<Response> => {
  const result = await handleReadinessSubmit(
    {
      method: request.method,
      pathname: new URL(request.url).pathname,
      headers: request.headers,
      readBody: (maxBytes: number) => readBodyCapped(request.body, maxBytes),
    },
    {
      env: {
        SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
        SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
        ES_CREATE_AUTH_USER: Deno.env.get("ES_CREATE_AUTH_USER"),
        ES_FULL_ACCESS: Deno.env.get("ES_FULL_ACCESS"),
      },
      fetchImpl: fetch,
      log,
    },
  );
  if (result.body === null) return new Response(null, { status: result.status, headers: result.headers });
  return new Response(JSON.stringify(result.body), { status: result.status, headers: { ...JSON_HEADERS, ...result.headers } });
});
