// send-email: sends one transactional email through Resend.
//
// DEPLOY WITH JWT CHECK OFF:
//   supabase functions deploy send-email --no-verify-jwt --project-ref czljyikfavtjgqcibdda
// The callers are Firebase functions, not signed in Supabase users, so they carry no
// Supabase JWT. The gate is instead the shared secret header x-utl-mail-secret, checked
// in core.mjs against the Supabase secret MAIL_RELAY_SECRET. Because verify_jwt is off,
// that secret is the only protection: keep it long (openssl rand -hex 32), never log it,
// and never put it in a web page.
//
// Secrets this function reads (Supabase dashboard, Edge Functions, Secrets):
//   RESEND_API_KEY, MAIL_FROM, MAIL_REPLY_TO (optional), MAIL_RELAY_SECRET.
// MAIL_FROM is never hardcoded anywhere.
//
// All behaviour lives in core.mjs (pure, tested in node). This file only wires the
// environment, fetch and Deno.serve. It logs nothing but kind, status and duration.
import { handleSendEmail, MAX_BODY_CHARS } from "./core.mjs";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "POST") {
    // Same answer the core gives; handled here too so we never read a body for it.
    return json(405, { ok: false, error: "invalid" }, { "Allow": "POST" });
  }

  // Refuse a clearly oversized body before reading it. Characters can be up to 4 bytes.
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_CHARS * 4) return json(413, { ok: false, error: "invalid" });

  const bodyText = await request.text();

  const result = await handleSendEmail(
    { method: request.method, headers: request.headers, bodyText },
    {
      env: {
        RESEND_API_KEY: Deno.env.get("RESEND_API_KEY"),
        MAIL_FROM: Deno.env.get("MAIL_FROM"),
        MAIL_REPLY_TO: Deno.env.get("MAIL_REPLY_TO"),
        MAIL_RELAY_SECRET: Deno.env.get("MAIL_RELAY_SECRET"),
      },
      fetchImpl: fetch,
      // Only kind, status and ms ever reach this function. See core.mjs.
      log: (entry: { kind: string; status: number; ms: number }) => console.log(JSON.stringify(entry)),
    },
  );

  return json(result.status, result.body);
});
