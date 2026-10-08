// readiness-access: "send me my Executive Signature results link" as an Edge Function. It replaces the Firebase callable
// checkReadinessAccountEmail and the browser step that followed it (sendReadinessAccessLink).
//
// Address:
//   POST https://czljyikfavtjgqcibdda.supabase.co/functions/v1/readiness-access     body { email }     answer { ok: true }
//
// DEPLOY WITH THE GATEWAY TOKEN CHECK OFF:
//   supabase functions deploy readiness-access --no-verify-jwt --project-ref czljyikfavtjgqcibdda
// The endpoint is anonymous by design (a visitor asking for their results link has no session). The protection is in core.mjs and
// in the database function (migration 2341): the origin list, JSON only, a 2 KB body, per address and per caller address limits,
// and an answer that is the same whatever was found.
//
// Secrets: none of its own. The platform injects SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The service key is only used on the
// server (the database function and the Auth admin API) and is never sent to a browser.
//
// Supabase Auth settings this relies on: sign up stays OFF (the function makes the account through the admin API), the magic link
// email template is the one in docs/SUPABASE_PLAN_SIGNIN.md, and https://theuntaughtlessons.com/** is in the redirect URLs.
//
// All behaviour lives in core.mjs (pure, tested in node). This file only wires the environment, fetch, the background hook and
// Deno.serve. It logs nothing but kind, status, duration and a fixed note. It never logs an address, a name or a key.
import { handleReadinessAccess, readBodyCapped } from "./core.mjs";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

const log = (entry: { kind: string; status: number; ms: number; note: string }) => console.log(JSON.stringify(entry));

// Work that continues after the reply was sent (the Edge runtime keeps the function alive until it is done).
// deno-lint-ignore no-explicit-any
const runtime = (globalThis as any).EdgeRuntime;
const background = runtime && typeof runtime.waitUntil === "function"
  ? (work: Promise<unknown>) => runtime.waitUntil(work)
  : undefined;

Deno.serve(async (request: Request): Promise<Response> => {
  const result = await handleReadinessAccess(
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
      },
      fetchImpl: fetch,
      log,
      background,
    },
  );
  if (result.body === null) return new Response(null, { status: result.status, headers: result.headers });
  return new Response(JSON.stringify(result.body), { status: result.status, headers: { ...JSON_HEADERS, ...result.headers } });
});
