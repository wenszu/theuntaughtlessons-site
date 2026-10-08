// weekly-org-reports: the weekly organization report emails, replacing the Firebase timer sendWeeklyOrganizationReports.
//
// Address:
//   POST https://czljyikfavtjgqcibdda.supabase.co/functions/v1/weekly-org-reports
//   header x-utl-cron-secret: <the value of the Supabase secret CRON_SECRET>
//   body {} for a real run, {"dry_run": true} to see what would be sent and send nothing
//
// DEPLOY WITH THE GATEWAY JWT CHECK OFF:
//   supabase functions deploy weekly-org-reports --no-verify-jwt --project-ref czljyikfavtjgqcibdda
// The caller is the database timer (pg_cron through pg_net), not a signed in person, so it carries no token. The ONLY lock is
// the header x-utl-cron-secret, checked in core.mjs in constant time against CRON_SECRET. With CRON_SECRET unset the function
// refuses every call. Keep the secret long (openssl rand -hex 32), never log it, never put it in a web page.
// The timer itself is set up by the owner: docs/SUPABASE_REPORTS_SETUP.md (it is not in a migration because it needs the secret).
//
// Secrets this function reads (Supabase dashboard, Edge Functions, Secrets):
//   CRON_SECRET (required), MAIL_RELAY_SECRET (required to send; the same value send-email checks),
//   WEEKLY_REPORT_RECIPIENT_OVERRIDE (optional: send every report to this one address with [TEST] in the subject and log nothing),
//   SEND_EMAIL_URL (optional: only if send-email is not at <project>/functions/v1/send-email).
// The platform injects SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY itself.
//
// All behaviour lives in core.mjs (pure, tested in node). This file only wires the environment, fetch and Deno.serve. It logs
// nothing but kind, status, counts and duration. No address, no organization name, no email text.
import { checkSecret, handleWeeklyReports, MAX_BODY_CHARS } from "./core.mjs";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

const log = (entry: Record<string, unknown>) => console.log(JSON.stringify(entry));

Deno.serve(async (request: Request): Promise<Response> => {
  // The secret is checked BEFORE the body is read, so a stranger cannot make this function read anything. The body is tiny:
  // a large one is refused without being read (core.mjs sees an oversized body and answers 400).
  let bodyText = "";
  if (request.method === "POST" && checkSecret(request.headers, Deno.env.get("CRON_SECRET")) === "ok") {
    const declared = Number(request.headers.get("content-length") || 0);
    bodyText = declared > MAX_BODY_CHARS * 4 ? "x".repeat(MAX_BODY_CHARS + 1) : await request.text();
  }

  const result = await handleWeeklyReports(
    { method: request.method, headers: request.headers, bodyText },
    {
      env: {
        CRON_SECRET: Deno.env.get("CRON_SECRET"),
        MAIL_RELAY_SECRET: Deno.env.get("MAIL_RELAY_SECRET"),
        SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
        SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
        SEND_EMAIL_URL: Deno.env.get("SEND_EMAIL_URL"),
        WEEKLY_REPORT_RECIPIENT_OVERRIDE: Deno.env.get("WEEKLY_REPORT_RECIPIENT_OVERRIDE"),
      },
      fetchImpl: fetch,
      log,
    },
  );
  return new Response(JSON.stringify(result.body), { status: result.status, headers: JSON_HEADERS });
});
