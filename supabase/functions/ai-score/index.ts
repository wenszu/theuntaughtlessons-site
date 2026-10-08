// ai-score: the two AI scorers (Explain to Aiko and the TSA diagnostic) in one Edge Function.
//
// Addresses (both work):
//   POST https://czljyikfavtjgqcibdda.supabase.co/functions/v1/ai-score/explain-to-aiko
//   POST https://czljyikfavtjgqcibdda.supabase.co/functions/v1/ai-score/tsa-diagnostic
//   (or POST .../ai-score with a "route" field in the JSON body)
//
// DEPLOY WITH THE GATEWAY TOKEN CHECK OFF:
//   supabase functions deploy ai-score --no-verify-jwt --project-ref czljyikfavtjgqcibdda
// Two reasons. The browser's cross-origin check (OPTIONS) carries no token, and the member's token is a Firebase
// token that the gateway may not accept. The lock is not removed: core.mjs asks the database who the token belongs
// to (public.get_my_person_id) before it reads the body or calls Gemini, and refuses everyone else with 401.
//
// Secrets this function reads (Supabase dashboard, Edge Functions, Secrets):
//   GEMINI_API_KEY (required), AIKO_STORE_ATTEMPT (optional, the text "on" stores each scored attempt).
//
// All behaviour lives in core.mjs (pure, tested in node). This file only wires the environment, fetch and
// Deno.serve. It logs nothing but route, status, duration and a fixed note. It never logs a prompt, an answer,
// a token or a key.
import { handleAiScore, readBodyCapped } from "./core.mjs";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

// The only log line in this function. See core.mjs.
const log = (entry: { route: string; status: number; ms: number; note: string }) => console.log(JSON.stringify(entry));

Deno.serve(async (request: Request): Promise<Response> => {
  const result = await handleAiScore(
    {
      method: request.method,
      pathname: new URL(request.url).pathname,
      headers: request.headers,
      readBody: (maxBytes: number) => readBodyCapped(request.body, maxBytes),
    },
    {
      env: {
        GEMINI_API_KEY: Deno.env.get("GEMINI_API_KEY"),
        AIKO_STORE_ATTEMPT: Deno.env.get("AIKO_STORE_ATTEMPT"),
      },
      fetchImpl: fetch,
      log,
    },
  );
  if (result.body === null) return new Response(null, { status: result.status, headers: result.headers });
  return new Response(JSON.stringify(result.body), { status: result.status, headers: { ...JSON_HEADERS, ...result.headers } });
});
