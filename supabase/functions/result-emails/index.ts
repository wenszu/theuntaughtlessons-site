// result-emails: the two "email me my result" functions in one Edge Function, replacing the Firebase callables
// sendReadinessResultEmail and sendMyResultsEmail.
//
// Addresses:
//   POST https://czljyikfavtjgqcibdda.supabase.co/functions/v1/result-emails/readiness-result   body { attemptId }
//   POST https://czljyikfavtjgqcibdda.supabase.co/functions/v1/result-emails/my-results         body { recipients, resultsText, filename }
//   header Authorization: Bearer <the member's sign in token>  (required for my-results, optional for readiness-result)
//
// DEPLOY WITH THE GATEWAY TOKEN CHECK OFF:
//   supabase functions deploy result-emails --no-verify-jwt --project-ref czljyikfavtjgqcibdda
// Two reasons. The browser's cross-origin check (OPTIONS) carries no token, and the readiness result email may be requested
// by a visitor who has just finished the test and is not signed in yet. The lock is not removed: core.mjs asks the database who
// the token belongs to (public.get_my_person_id and public.get_my_checkout_identity) before it reads the body, and the database
// decides who may have a readiness result sent (migration 2320). The sender of a results email is always the verified address
// of the token, and the recipient of a readiness email is always the address on file.
//
// Secrets this function reads (Supabase dashboard, Edge Functions, Secrets):
//   MAIL_RELAY_SECRET (required: the value send-email checks), SEND_EMAIL_URL (optional: only if send-email is not at
//   <project>/functions/v1/send-email).
// The platform injects SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY itself. The service role key is used only to call the limit
// and lookup functions of migration 2320, which no browser can execute.
//
// All behaviour lives in core.mjs (pure, tested in node). This file only wires the environment, fetch and Deno.serve. It logs
// nothing but route, status, duration and a fixed note. It never logs an address, a name, a result text or a token.
import { handleResultEmails, readBodyCapped } from "./core.mjs";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

// The only log line in this function. See core.mjs.
const log = (entry: { route: string; status: number; ms: number; note: string }) => console.log(JSON.stringify(entry));

Deno.serve(async (request: Request): Promise<Response> => {
  const result = await handleResultEmails(
    {
      method: request.method,
      pathname: new URL(request.url).pathname,
      headers: request.headers,
      readBody: (maxBytes: number) => readBodyCapped(request.body, maxBytes),
    },
    {
      env: {
        MAIL_RELAY_SECRET: Deno.env.get("MAIL_RELAY_SECRET"),
        SEND_EMAIL_URL: Deno.env.get("SEND_EMAIL_URL"),
        SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
        SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
      },
      fetchImpl: fetch,
      log,
    },
  );
  if (result.body === null) return new Response(null, { status: result.status, headers: result.headers });
  return new Response(JSON.stringify(result.body), { status: result.status, headers: { ...JSON_HEADERS, ...result.headers } });
});
