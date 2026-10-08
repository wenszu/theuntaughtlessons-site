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
import { checkSecret, handleSendEmail, MAX_BODY_BYTES, readBodyCapped } from "./core.mjs";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

// The only log line in this function: label, status, milliseconds. See core.mjs.
const log = (entry: { kind: string; status: number; ms: number }) => console.log(JSON.stringify(entry));

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

Deno.serve(async (request: Request): Promise<Response> => {
  const started = Date.now();
  const early = (status: number, error: string, extra: Record<string, string> = {}): Response => {
    log({ kind: "unknown", status, ms: Date.now() - started });
    return json(status, { ok: false, error }, extra);
  };

  if (request.method !== "POST") return early(405, "invalid", { "Allow": "POST" });

  const env = {
    RESEND_API_KEY: Deno.env.get("RESEND_API_KEY"),
    MAIL_FROM: Deno.env.get("MAIL_FROM"),
    MAIL_REPLY_TO: Deno.env.get("MAIL_REPLY_TO"),
    MAIL_RELAY_SECRET: Deno.env.get("MAIL_RELAY_SECRET"),
  };

  // First layer: the shared secret is checked BEFORE the body is read, so a stranger
  // cannot make this function read or parse anything.
  const gate = checkSecret(request.headers, env.MAIL_RELAY_SECRET);
  if (gate === "not-configured") return early(503, "not-configured");
  if (gate !== "ok") return early(401, "unauthorized");

  // Refuse an oversized body early when it announces its size, and cap the stream
  // itself so a missing or false Content-Length does not get around the limit.
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) return early(413, "invalid");
  const body = await readBodyCapped(request.body, MAX_BODY_BYTES);
  if (!body.ok) return early(413, "invalid");

  // Second layer: the core checks everything again (secret, shape, limits).
  const result = await handleSendEmail(
    { method: request.method, headers: request.headers, bodyText: body.text },
    { env, fetchImpl: fetch, log },
  );

  return json(result.status, result.body);
});
