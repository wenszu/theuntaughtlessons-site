// admin-mail: the emails the admin console sends (welcome email, template test email, manual weekly report email) as an Edge Function.
// It replaces the Firebase callable runAdminAction.
//
// Address (POST, JSON, header Authorization: Bearer <the administrator's sign in token>):
//   https://czljyikfavtjgqcibdda.supabase.co/functions/v1/admin-mail     body { action, payload }
//   action: WelcomeEmail, TestEmailTemplate, WeeklyOrgReport, or RemovedMember (answered ok without doing anything: the removal itself
//   writes the audit row that the old Google Sheet line stood for).
//
// DEPLOY WITH THE GATEWAY TOKEN CHECK OFF:
//   supabase functions deploy admin-mail --no-verify-jwt --project-ref czljyikfavtjgqcibdda
// Reason: the caller may hold a Firebase token (during the dual sign in period) and the browser's cross-origin check carries no token.
// The lock is not removed: core.mjs asks the database who the token belongs to before it reads the body, and only a platform owner
// passes.
//
// Secrets this function reads (Supabase dashboard, Edge Functions, Secrets):
//   MAIL_RELAY_SECRET  (required: the value the send-email function checks; already set for send-email)
//   SEND_EMAIL_URL     (optional: only if send-email is not at <project>/functions/v1/send-email; it must still start with
//                       <project>/functions/v1/, otherwise the function sends nothing)
// The platform injects SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The service key is used only to count each administrator's emails
// (60 per hour, 300 per day; migration 2344) and is never sent to a browser or to send-email.
//
// All behaviour lives in core.mjs (pure, tested in node). This file only wires the environment, fetch and Deno.serve. It logs
// nothing but kind, action, status, duration and a fixed note. It never logs a recipient, a subject, a body or a token.
import { handleAdminMail, readBodyCapped } from "./core.mjs";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

const log = (entry: { kind: string; action: string; status: number; ms: number; note: string }) => console.log(JSON.stringify(entry));

Deno.serve(async (request: Request): Promise<Response> => {
  const result = await handleAdminMail(
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
        MAIL_RELAY_SECRET: Deno.env.get("MAIL_RELAY_SECRET"),
        SEND_EMAIL_URL: Deno.env.get("SEND_EMAIL_URL"),
      },
      fetchImpl: fetch,
      log,
    },
  );
  if (result.body === null) return new Response(null, { status: result.status, headers: result.headers });
  return new Response(JSON.stringify(result.body), { status: result.status, headers: { ...JSON_HEADERS, ...result.headers } });
});
