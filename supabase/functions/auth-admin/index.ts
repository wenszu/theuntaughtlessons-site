// auth-admin: sends a sign in invitation to a person who may have no sign in account yet (the admin console, "send sign in link").
// It replaces the Firebase email link invitation. The emergency password feature (setEmergencyCredential) is retired by the owner
// and has no route here.
//
// Address (POST, JSON, header Authorization: Bearer <the administrator's sign in token>):
//   https://czljyikfavtjgqcibdda.supabase.co/functions/v1/auth-admin/invite     body { email, destination? }
//   destination: "member" (default, the member login page) or "results" (the Executive Signature results page).
// See docs/SUPABASE_CALLABLE_GAP.md.
//
// OFF BY DEFAULT. The function answers 404 to every request, from any origin, until the secret AUTH_ADMIN_ENABLED is exactly "on"
// (supabase secrets set AUTH_ADMIN_ENABLED=on).
//
// DEPLOY WITH THE GATEWAY TOKEN CHECK OFF:
//   supabase functions deploy auth-admin --no-verify-jwt --project-ref czljyikfavtjgqcibdda
// Reason: the caller may hold a Firebase token (during the dual sign in period) and the browser's cross-origin check carries no token.
// The lock is not removed: core.mjs asks the database who the token belongs to before it reads the body, and only a platform owner
// passes.
//
// Secrets: AUTH_ADMIN_ENABLED (the text "on"). The platform injects SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The service key is
// used only on the server (the database functions of migration 2343 and the Auth admin API) and is never sent to a browser.
//
// All behaviour lives in core.mjs (pure, tested in node). This file only wires the environment, fetch and Deno.serve. It logs
// nothing but kind, status, duration and a fixed note. It never logs an address, a password, a token or a key.
import { handleAuthAdmin, readBodyCapped } from "./core.mjs";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

const log = (entry: { kind: string; status: number; ms: number; note: string }) => console.log(JSON.stringify(entry));

Deno.serve(async (request: Request): Promise<Response> => {
  const result = await handleAuthAdmin(
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
        AUTH_ADMIN_ENABLED: Deno.env.get("AUTH_ADMIN_ENABLED"),
      },
      fetchImpl: fetch,
      log,
    },
  );
  if (result.body === null) return new Response(null, { status: result.status, headers: result.headers });
  return new Response(JSON.stringify(result.body), { status: result.status, headers: { ...JSON_HEADERS, ...result.headers } });
});
