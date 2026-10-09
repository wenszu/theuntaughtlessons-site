// Pure core of the ai-score Edge Function.
//
// It replaces the two Firebase scorers (functions-aiko/index.js): scoreExplainToAiko and scoreTsaDiagnostic.
// Same request fields, same answer fields, same prompts, same output cleaning. What is new is the lock on the
// door: a valid signed in token is required, and each person has an hourly limit.
//
// No Deno-only and no Node-only APIs are used here, so the same file runs in the Supabase Edge runtime and in the
// node tests (tests/ai-score-core.test.js). index.ts is the thin wrapper that reads the environment, passes fetch
// and calls Deno.serve.
//
// Rules this file enforces:
//   - POST only (OPTIONS answers the browser's cross-origin check). A request from an origin that is not on the
//     list is refused with 403. A request with no Origin header (a script) is allowed, because the token is the lock.
//   - The caller must send "Authorization: Bearer <token>". The token is checked by asking the database
//     (public.get_my_person_id through PostgREST, with the caller's own token). A missing, invalid, expired or
//     unknown-person token gets 401 and nothing else happens: the body is not even read.
//   - Each person may make 30 scoring calls per hour per route. The count lives in the database
//     (public.ai_score_take_mine, migration 2280), because a function instance has no memory between calls.
//     Only a request that passed validation uses up a call. When the count cannot be checked the call is refused
//     (503), never allowed, so the Gemini quota cannot be drained while the database is down.
//   - Request body at most 64 KB, checked on the announced size and again while reading the stream.
//   - Every outbound call has a deadline (Gemini 25 s per attempt, the database 5 s).
//   - Answers are JSON only, with generic error text. Nothing about the transcript, the answers, the token, the
//     person or the key is ever logged. The one log line is: route, our HTTP status, milliseconds and a fixed note.
//   - GEMINI_API_KEY goes to Google in a header, never in a web address.

export const SUPABASE_URL = "https://czljyikfavtjgqcibdda.supabase.co";
// A publishable key is a public value by design (it is also shipped in the site's pages).
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_uxSIlhwWdbAa6EnHyn_Flw__P3u6tlW";
export const ROUTES = ["explain-to-aiko", "tsa-diagnostic"];
export const MAX_BODY_BYTES = 64 * 1024;
export const GEMINI_TIMEOUT_MS = 25000;
// Explain to Aiko may try a second model, but both attempts together stay inside this budget, because the page
// gives up after 50 seconds.
export const GEMINI_TOTAL_BUDGET_MS = 44000;
export const MIN_SECOND_ATTEMPT_MS = 5000;
export const DATABASE_TIMEOUT_MS = 5000;
export const STORE_TIMEOUT_MS = 4000;
export const MODELS = ["gemini-flash-latest", "gemini-2.5-flash"];
export const GEMINI_URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
export const ALLOWED_ORIGINS = ["https://theuntaughtlessons.com", "https://www.theuntaughtlessons.com"];
// http only for a local test page: localhost or 127.0.0.1 with any port.
const LOCAL_ORIGIN = /^http:[/][/](localhost|127[.]0[.]0[.]1)(:[0-9]{1,5})?$/;
const TOKEN_PATTERN = /^[A-Za-z0-9._~+/-]{1,4096}=*$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTEMPT_ID_PATTERN = /^[A-Za-z0-9-]{8,100}$/;
const ACTIVITY_BY_MODE = { "120": "explain-to-aiko-120", "60": "explain-to-aiko-60" };
const CONTENT_VERSION = "aiko-score-v1";
const SCORE_MAXIMUM = 30;
const RUBRIC_NAMES = [
  "Clear core idea",
  "Message coverage",
  "Close and ask",
  "Structure",
  "Concise execution",
  "Confident language"
];

// ---------------------------------------------------------------------------
// Small helpers
//
// This file must contain no backslash and no character outside plain ASCII, because the deploy tool can corrupt
// both. Where a backslash, a new line or a special character is needed it is built from its code number.
// (tests/edge-functions-no-backslash.test.js fails if one slips in.)

const NL = String.fromCharCode(10);
const BACKSLASH = String.fromCharCode(92);
const BOM = String.fromCharCode(65279);
const OPEN_QUOTE = String.fromCharCode(8220);
const CLOSE_QUOTE = String.fromCharCode(8221);

// True for exactly the characters a regular expression whitespace class would match: space, tab, new line,
// vertical tab, form feed, carriage return, no-break space, the Unicode space separators, line and paragraph
// separators, and the byte order mark. (The same set String.prototype.trim removes.)
function isSpaceCode(code) {
  return code === 32 || (code >= 9 && code <= 13) || code === 160 || code === 5760 || (code >= 8192 && code <= 8202)
    || code === 8232 || code === 8233 || code === 8239 || code === 8287 || code === 12288 || code === 65279;
}

// Same result as text.split(a run of whitespace): a leading or trailing run of whitespace gives an empty first or last piece.
export function splitOnWhitespace(text) {
  const value = String(text);
  const parts = [];
  let start = 0;
  let index = 0;
  while (index < value.length) {
    if (isSpaceCode(value.charCodeAt(index))) {
      let end = index + 1;
      while (end < value.length && isSpaceCode(value.charCodeAt(end))) end += 1;
      parts.push(value.slice(start, index));
      start = end;
      index = end;
    } else {
      index += 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

export function countWords(text) {
  return splitOnWhitespace(text).filter(Boolean).length;
}

function stripTrailingSlashes(text) {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 47) end -= 1;
  return text.slice(0, end);
}

export function originAllowed(origin) {
  const value = String(origin || "");
  return ALLOWED_ORIGINS.includes(value) || LOCAL_ORIGIN.test(value);
}

function readHeader(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get(name) || "");
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === wanted) return String(headers[key] || "");
  }
  return "";
}

// Returns the bearer token from an Authorization header value, or "" when there is none or it looks unusable.
export function tokenFromHeader(headerValue) {
  const value = String(headerValue || "").trim();
  if (value.length < 8 || value.slice(0, 6).toLowerCase() !== "bearer" || value.charCodeAt(6) !== 32) return "";
  const token = value.slice(7);
  for (let index = 0; index < token.length; index += 1) {
    if (isSpaceCode(token.charCodeAt(index))) return "";
  }
  return TOKEN_PATTERN.test(token) ? token : "";
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

// Runs work(signal) with a hard deadline. The deadline is a race, so a fetch that ignores the abort signal still
// cannot hold the caller. Rejects with an Error whose message is "timeout" when the time is up.
async function withDeadline(ms, work) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      if (controller) { try { controller.abort(); } catch (error) { /* already finished */ } }
      reject(new Error("timeout"));
    }, ms);
  });
  const job = Promise.resolve().then(() => work(controller ? controller.signal : undefined));
  // If the deadline wins, the abandoned job may reject later. Swallow that.
  job.catch(() => {});
  try {
    return await Promise.race([job, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Reads a request body stream (anything with getReader(), such as a web ReadableStream) and stops as soon as the
// byte cap is passed, with or without a Content-Length header. Resolves { ok: true, text } or { ok: false }.
export async function readBodyCapped(body, maxBytes) {
  const limit = Number(maxBytes) > 0 ? Number(maxBytes) : MAX_BODY_BYTES;
  if (!body) return { ok: true, text: "" };
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        try { await reader.cancel(); } catch (error) { /* already closed */ }
        return { ok: false };
      }
      chunks.push(value);
    }
  } catch (error) {
    return { ok: false };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { ok: true, text: new TextDecoder().decode(bytes) };
}

// ---------------------------------------------------------------------------
// Explain to Aiko. The prompt and the cleaning below are copied unchanged from functions-aiko/index.js.

function levelFor(total) {
  if (total >= 28) return "Executive-ready";
  if (total >= 23) return "Strong";
  if (total >= 15) return "Developing";
  return "Foundational";
}

export function buildExplainPrompt(input) {
  const isSixty = input.mode === "60";
  const compression = isSixty && input.priorTranscript
    ? `${NL}ORIGINAL 120-SECOND TRANSCRIPT FOR COMPRESSION COMPARISON:${NL}"""${NL}${input.priorTranscript}${NL}"""${NL}For C5, weigh whether the 60-second version kept the bottom line and strongest reasons while cutting lower-value detail.`
    : "";
  return `You are an expert executive-communication coach scoring a spoken explanation to a CEO named Aiko.

SCENARIO: The speaker is explaining an email arguing that the Olympics is losing cultural impact. The email's bottom line is that this is driven by reduced everyday relevance, fragmented attention, and weaker emotional connection. The three supporting ideas are: (1) the Olympics peaks only every four years while sports and digital content are always on; (2) audiences are spread across platforms, weakening sustained collective attention; and (3) fewer consistent athlete narratives and national storylines reduce attachment. The speaker should close with implications, a next step, decision, meeting, or follow-up for Aiko.

MEASURED DELIVERY DATA (real client-side measurements; trust these values):
- Mode: ${input.mode} seconds
- Actual duration: ${input.durationSeconds} seconds
- Words per minute: ${input.wpm}
- Filler words: ${input.fillerCount}
- Target: ${isSixty ? "60 seconds or less and 110-130 words" : "about 120 seconds and 220-260 words"}

SCORE each criterion from 1 to 5 using whole numbers:
- C1 Clear core idea: bottom line stated in roughly the first 10 seconds.
- C2 Message coverage: covers the three drivers by meaning; reward accurate paraphrase, not keyword matching.
- C3 Close and ask: ends with a clear next step, decision, meeting, or follow-up.
- C4 Structure: conclusion first with three audible signposts and a clean close.
- C5 Concise execution: use the measured duration, pace, and target above.${isSixty ? " Judge effective compression." : " Judge whether the speaker used the window without rambling."}
- C6 Confident language: decisive verbs, little hedging, and ownership of the message.

REQUIREMENTS:
- For every criterion, evidence must be a short verbatim quote from the transcript, or exactly "No relevant content found".
- Feedback must be one specific improvement of no more than 25 words.
- missed must list gaps as questions Aiko would still ask. Use an empty array when nothing important is missing.
- exemplar_opening must rewrite the member's own opening in about 40 words at a 5/5 level.
- summary must be two direct, encouraging sentences.
- Return strict JSON only in this exact shape:
{"total":24,"level":"Strong","criteria":[{"name":"Clear core idea","score":4,"evidence":"verbatim quote","feedback":"specific improvement"}],"missed":["What would Aiko still ask?"],"exemplar_opening":"...","summary":"..."}
${compression}

TRANSCRIPT:
"""
${input.transcript}
"""`;
}

// accept: decides which parsed objects count as the answer. The Explain to Aiko answer has "criteria".
// The TSA answer has "scores" (see the note on the TSA route below).
function isExplainShape(parsed) {
  return Boolean(parsed) && (Array.isArray(parsed.criteria) || Array.isArray(parsed.advisors) || Object.prototype.hasOwnProperty.call(parsed, "speakScore"));
}

function isTsaShape(parsed) {
  return Boolean(parsed) && typeof parsed === "object" && Boolean(parsed.scores) && typeof parsed.scores === "object";
}

// The text inside every triple-backtick block, with an optional "json" label (any letter case) and the white space
// after it skipped, in the order they appear. Same result as a global, case-insensitive match of
// three backticks, an optional json, white space, then as little as possible up to the next three backticks.
function fencedBlocks(source) {
  const marker = "```";
  const blocks = [];
  let from = 0;
  for (;;) {
    const open = source.indexOf(marker, from);
    if (open < 0) break;
    let at = open + marker.length;
    if (source.slice(at, at + 4).toLowerCase() === "json") at += 4;
    while (at < source.length && isSpaceCode(source.charCodeAt(at))) at += 1;
    const close = source.indexOf(marker, at);
    // No closing marker here means there is none further on either (every later start needs one too).
    if (close < 0) break;
    blocks.push(source.slice(at, close));
    from = close + marker.length;
  }
  return blocks;
}

export function extractJson(text, accept = isExplainShape) {
  let source = String(text || "");
  if (source.charAt(0) === BOM) source = source.slice(1);
  source = source.trim();
  if (!source) throw new Error("Gemini returned no JSON object.");

  const candidates = [source];
  for (const block of fencedBlocks(source)) candidates.push(block.trim());

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (accept(parsed)) return parsed;
    } catch (_) { /* Try balanced JSON objects next. */ }
  }

  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const char = source[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === BACKSLASH) escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') { inString = true; continue; }
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      if (depth !== 0) continue;
      try {
        const parsed = JSON.parse(source.slice(start, index + 1));
        if (accept(parsed)) return parsed;
      } catch (_) { break; }
    }
  }
  throw new Error("Gemini returned text, but no valid JSON object could be extracted.");
}

export function normalizeResult(result) {
  if (!result || !Array.isArray(result.criteria) || result.criteria.length !== 6) throw new Error("Invalid rubric response.");
  if (!Array.isArray(result.missed) || typeof result.exemplar_opening !== "string" || typeof result.summary !== "string") throw new Error("Incomplete rubric response.");
  const criteria = result.criteria.map((criterion, index) => {
    if (!criterion || typeof criterion.evidence !== "string" || typeof criterion.feedback !== "string") throw new Error("Invalid criterion response.");
    return {
      name: RUBRIC_NAMES[index],
      score: Math.min(5, Math.max(1, Math.round(Number(criterion.score) || 1))),
      evidence: criterion.evidence.slice(0, 500),
      feedback: criterion.feedback.slice(0, 500)
    };
  });
  const total = criteria.reduce((sum, criterion) => sum + criterion.score, 0);
  return {
    total,
    level: levelFor(total),
    criteria,
    missed: result.missed.map((item) => String(item).slice(0, 500)).slice(0, 8),
    exemplar_opening: result.exemplar_opening.slice(0, 1500),
    summary: result.summary.slice(0, 1500),
    fallback: false
  };
}

// Same field handling as scoreExplainToAiko. Returns { error } for a refusal or { input }.
export function parseExplainInput(body) {
  const transcript = String(body?.transcript || "").trim().slice(0, 12000);
  if (countWords(transcript) < 5) return { error: "Transcript is empty or too short to score." };
  return {
    input: {
      mode: body?.mode === "60" ? "60" : "120",
      transcript,
      durationSeconds: Math.max(0, Math.round(Number(body?.durationSeconds) || 0)),
      wpm: Math.max(0, Math.round(Number(body?.wpm) || 0)),
      fillerCount: Math.max(0, Math.round(Number(body?.fillerCount) || 0)),
      priorTranscript: String(body?.priorTranscript || "").trim().slice(0, 12000)
    }
  };
}

// ---------------------------------------------------------------------------
// TSA diagnostic. The prompt and the cleaning below are copied unchanged from functions-aiko/index.js.
//
// ONE DELIBERATE DIFFERENCE: the Firebase version passed the TSA answer through the Explain to Aiko shape check,
// which only accepts an object with "criteria", "advisors" or "speakScore". The TSA answer has none of those
// (it has "scores" and "feedback"), so the Firebase scorer always ended in {fallback:true}. Here the TSA route
// accepts an object that has a "scores" object. Every later check (ranges, totals, quote must appear in the
// transcript) is unchanged.

export function buildTsaDiagnosticPrompt(input) {
  return `You are a careful assessment evaluator and concise developmental coach for The Untaught Lessons. Score only the sections enabled below. Use only evidence in the response. Do not infer tone, confidence, presence, accent, personality, or vocal delivery from text. Do not reward fancy vocabulary or grammar. Give direct, encouraging feedback suitable for a teenager or working adult. For each enabled section, identify one specific strength, one most important improvement, and one small practical exercise the learner can try next. Keep the improvement and exercise distinct.

FORM: ${input.formId}
ATTEMPT: ${input.kind}
SCORE SPEAK: ${input.speakEnabled}
SCORE ACT: ${input.actEnabled}

SPEAK SCENARIO FACTS:
${input.speakFacts.map((fact) => `- ${fact}`).join(NL)}
SPEAK TASK: Give a recommendation, two or three reasons, and a clear next step.
SPEAK TRANSCRIPT:
"""${input.speakTranscript}"""

ACT SITUATION: ${input.actSetup}
ACT SELECTED CHOICE: ${input.actChoiceText}
ACT PUSHBACK: ${input.actPushback}
ACT TASK: State a decision, respond to the concern, explain the tradeoff, and give a constructive next step.
ACT TRANSCRIPT:
"""${input.actTranscript}"""

Speak rubric when enabled: Leads 0-8, Supports 0-14, Focuses 0-8. Act rubric when enabled: Decides 0-10, Adapts 0-12, Advances 0-8. Each total must equal its three dimensions. A defensible Act choice can earn full credit regardless of the reference default. Return null for a disabled section.

Return strict JSON only:
{"scores":{"speak":{"total":0,"leads":0,"supports":0,"focuses":0},"act":{"total":0,"decides":0,"adapts":0,"advances":0}},"feedback":{"speakEvidence":"Short verbatim quote","actEvidence":"Short verbatim quote","speakStrength":"One observed strength","speakImprovement":"One specific improvement area","speakPractice":"One small practical exercise","actStrength":"One observed strength","actImprovement":"One specific improvement area","actPractice":"One small practical exercise"}}`;
}

// Removes one opening quote (straight or curly) at the start and one closing quote at the end.
function stripQuoteMarks(text) {
  let start = 0;
  let end = text.length;
  if (end > 0 && (text.charAt(0) === '"' || text.charAt(0) === OPEN_QUOTE)) start = 1;
  if (end > start && (text.charAt(end - 1) === '"' || text.charAt(end - 1) === CLOSE_QUOTE)) end -= 1;
  return text.slice(start, end);
}

export function normalizeTsaDiagnostic(result, input) {
  if (!result || typeof result !== "object") throw new Error("Invalid TSA diagnostic response.");
  const normalizeScore = (score, fields, limits) => {
    if (!score || typeof score !== "object") throw new Error("Missing TSA section score.");
    const output = {};
    fields.forEach((field, index) => { const value = Number(score[field]); if (!Number.isFinite(value) || value < 0 || value > limits[index]) throw new Error("Invalid TSA dimension score."); output[field] = Math.round(value * 10) / 10; });
    output.total = Math.round(fields.reduce((sum, field) => sum + output[field], 0) * 10) / 10;
    return output;
  };
  const feedback = result.feedback || {};
  const quote = (value, transcript) => {
    const cleaned = stripQuoteMarks(String(value || "").trim());
    if (!cleaned || !transcript.toLowerCase().includes(cleaned.toLowerCase())) return "No relevant content found";
    return cleaned.slice(0, 400);
  };
  const speakEvidence = quote(feedback.speakEvidence, input.speakTranscript);
  const actEvidence = quote(feedback.actEvidence, input.actTranscript);
  return {
    scores: {
      speak: input.speakEnabled ? normalizeScore(result.scores?.speak, ["leads", "supports", "focuses"], [8, 14, 8]) : null,
      act: input.actEnabled ? normalizeScore(result.scores?.act, ["decides", "adapts", "advances"], [10, 12, 8]) : null
    },
    feedback: {
      speakEvidence, actEvidence,
      speakStrength: String(feedback.speakStrength || "").slice(0, 400), speakImprovement: String(feedback.speakImprovement || "").slice(0, 400), speakPractice: String(feedback.speakPractice || "").slice(0, 400),
      actStrength: String(feedback.actStrength || "").slice(0, 400), actImprovement: String(feedback.actImprovement || "").slice(0, 400), actPractice: String(feedback.actPractice || "").slice(0, 400)
    },
    modelVersion: "gemini-flash-latest/tsa-c3-20260814-coach",
    fallback: false
  };
}

// Same field handling as scoreTsaDiagnostic. Returns { fallback: true } where Firebase answered {fallback:true}.
export function parseTsaInput(body) {
  const input = {
    formId: String(body?.formId || "").slice(0, 4),
    kind: body?.kind === "checkpoint" ? "checkpoint" : "diagnostic",
    speakEnabled: body?.enabled?.speak === true,
    actEnabled: body?.enabled?.act === true,
    speakTranscript: String(body?.speak?.transcript || "").trim().slice(0, 6000),
    actTranscript: String(body?.act?.transcript || "").trim().slice(0, 6000),
    actChoice: Math.max(0, Math.min(2, Math.round(Number(body?.act?.choice) || 0))),
    speakBase: Math.max(0, Math.min(30, Number(body?.deterministic?.speak) || 0)),
    actBase: Math.max(0, Math.min(30, Number(body?.deterministic?.act) || 0)),
    speakFacts: Array.isArray(body?.scenario?.speakFacts) ? body.scenario.speakFacts.map((item) => String(item).slice(0, 500)).slice(0, 6) : [],
    actSetup: String(body?.scenario?.actSetup || "").slice(0, 1500),
    actChoiceText: String(body?.scenario?.actChoice || "").slice(0, 800),
    actPushback: String(body?.scenario?.actPushback || "").slice(0, 1000)
  };
  if (!input.speakEnabled && !input.actEnabled) return { fallback: true };
  if ((input.speakEnabled && splitOnWhitespace(input.speakTranscript).length < 5) || (input.actEnabled && splitOnWhitespace(input.actTranscript).length < 5)) return { fallback: true };
  return { input };
}

// ---------------------------------------------------------------------------
// The Gemini call. Same request body as Firebase; the key travels in a header, not in the web address.

async function callModel(apiKey, model, prompt, accept, timeoutMs, fetchImpl) {
  return withDeadline(timeoutMs, async (signal) => {
    const response = await fetchImpl(`${GEMINI_URL_BASE}${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.35, responseMimeType: "application/json" }
      })
    });
    if (!response.ok) throw new Error(`gemini-http-${Number(response.status) || 0}`);
    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((part) => part.text || "").join("");
    if (!text.trim()) throw new Error("gemini-empty");
    return extractJson(text, accept);
  });
}

// Explain to Aiko tries each model in turn inside one overall budget. TSA tries the first model only.
async function callGemini(apiKey, prompt, options) {
  const { models, accept, perAttemptMs, totalBudgetMs, fetchImpl, now } = options;
  const started = now();
  let lastError = new Error("gemini-failed");
  for (let index = 0; index < models.length; index += 1) {
    const remaining = totalBudgetMs - (now() - started);
    if (index > 0 && remaining < MIN_SECOND_ATTEMPT_MS) break;
    try {
      return await callModel(apiKey, models[index], prompt, accept, Math.max(1, Math.min(perAttemptMs, remaining)), fetchImpl);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// The database: who is calling, how many calls they have used, and the optional attempt store.

function restHeaders(token, apiKey) {
  return { apikey: apiKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" };
}

// Asks the database who the token belongs to. Resolves { state: "ok" } or { state: "unauthorized" } or
// { state: "unavailable" }. The person id is not returned: nothing else in this function needs it.
async function verifyToken(token, deps) {
  try {
    return await withDeadline(deps.databaseTimeoutMs, async (signal) => {
      const response = await deps.fetchImpl(`${deps.supabaseUrl}/rest/v1/rpc/get_my_person_id`, {
        method: "POST",
        headers: restHeaders(token, deps.supabaseKey),
        body: "{}",
        // The token must never follow a redirect to another host.
        redirect: "error",
        signal
      });
      const status = Number(response.status) || 0;
      if (status === 401 || status === 403) return { state: "unauthorized" };
      if (!response.ok) return { state: "unavailable" };
      let value = null;
      try { value = await response.json(); } catch (error) { value = null; }
      return typeof value === "string" && UUID_PATTERN.test(value) ? { state: "ok" } : { state: "unauthorized" };
    });
  } catch (error) {
    return { state: "unavailable" };
  }
}

// Uses up one call for the signed in person. Resolves "allowed", "limited" or "unavailable".
async function takeSlot(token, bucket, deps) {
  try {
    return await withDeadline(deps.databaseTimeoutMs, async (signal) => {
      const response = await deps.fetchImpl(`${deps.supabaseUrl}/rest/v1/rpc/ai_score_take_mine`, {
        method: "POST",
        headers: restHeaders(token, deps.supabaseKey),
        body: JSON.stringify({ p_bucket: bucket }),
        redirect: "error",
        signal
      });
      if (!response.ok) return "unavailable";
      let value = null;
      try { value = await response.json(); } catch (error) { value = null; }
      if (value === true) return "allowed";
      if (value === false) return "limited";
      return "unavailable";
    });
  } catch (error) {
    return "unavailable";
  }
}

// Optional, off unless AIKO_STORE_ATTEMPT is exactly "on": store the server's own score with the caller's token
// (public.record_activity_attempt). Never throws, waits at most 4 seconds, and a failure only means recorded:false.
async function storeAttempt(options) {
  try {
    const token = tokenFromHeader(`Bearer ${String(options.token || "")}`);
    const attemptId = typeof options.attemptId === "string" ? options.attemptId : "";
    if (!token || !ATTEMPT_ID_PATTERN.test(attemptId)) return { recorded: false };
    const deps = options.deps;
    const response = await withDeadline(STORE_TIMEOUT_MS, async (signal) => {
      const answer = await deps.fetchImpl(`${deps.supabaseUrl}/rest/v1/rpc/record_activity_attempt`, {
        method: "POST",
        headers: restHeaders(token, deps.supabaseKey),
        body: JSON.stringify({
          p_activity: ACTIVITY_BY_MODE[options.mode === "60" ? "60" : "120"],
          p_attempt_key: attemptId,
          p_attempt_number: clampInt(options.attemptNumber, 1, 10000, 1),
          p_score: clampInt(options.total, 0, SCORE_MAXIMUM, 0),
          p_score_maximum: SCORE_MAXIMUM,
          p_duration_seconds: clampInt(options.durationSeconds, 0, 43200, 0),
          p_content_version: CONTENT_VERSION
        }),
        redirect: "error",
        signal
      });
      // The answer is not read; release the connection.
      try { if (answer && answer.body && typeof answer.body.cancel === "function") answer.body.cancel().catch(() => {}); } catch (error) { /* nothing to release */ }
      return answer;
    });
    const status = Number(response && response.status);
    if (response && response.ok === true && status >= 200 && status < 300) return { recorded: true, attemptId };
    return { recorded: false };
  } catch (error) {
    return { recorded: false };
  }
}

// ---------------------------------------------------------------------------
// The handler

function corsFor(origin) {
  const headers = { Vary: "Origin" };
  if (origin && originAllowed(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, apikey, x-client-info";
    headers["Access-Control-Max-Age"] = "600";
  }
  return headers;
}

// The route comes from the last part of the address (.../ai-score/explain-to-aiko). Returns "" when the address
// names no route, null when it names one that does not exist.
export function routeFromPath(pathname) {
  const parts = String(pathname || "").split("/").filter(Boolean);
  const at = parts.lastIndexOf("ai-score");
  if (at < 0 || at === parts.length - 1) return "";
  const route = parts[at + 1];
  return ROUTES.includes(route) && at + 1 === parts.length - 1 ? route : null;
}

// request: { method, pathname, headers (Headers or plain object), readBody(maxBytes) -> { ok, text } }
// deps: { env: { GEMINI_API_KEY, AIKO_STORE_ATTEMPT }, fetchImpl, log, now, supabaseUrl, supabaseKey,
//         geminiTimeoutMs, geminiTotalBudgetMs, databaseTimeoutMs }
// Resolves to { status, body, headers }.
export async function handleAiScore(request, deps) {
  const now = deps.now || (() => Date.now());
  const log = typeof deps.log === "function" ? deps.log : () => {};
  const started = now();
  const env = deps.env || {};
  const fetchImpl = deps.fetchImpl;
  const origin = readHeader(request && request.headers, "origin");
  let route = "unknown";

  const finish = (status, body, note, extraHeaders) => {
    // The one and only log line: route, status, milliseconds, a fixed note. Never any request data.
    log({ route, status, ms: Math.max(0, now() - started), note });
    const headers = { ...corsFor(origin), ...(extraHeaders || {}) };
    return { status, body: status === 204 ? null : body, headers };
  };

  // 1. Origin. A browser from a page that is not ours is refused. No Origin header is a script and is let through
  //    to the token check.
  if (origin && !originAllowed(origin)) {
    log({ route, status: 403, ms: Math.max(0, now() - started), note: "origin" });
    return { status: 403, body: { error: "Origin not allowed." }, headers: { Vary: "Origin" } };
  }

  const method = String(request && request.method || "").toUpperCase();
  if (method === "OPTIONS") return finish(204, null, "preflight");
  if (method !== "POST") return finish(405, { error: "POST only." }, "method", { Allow: "POST, OPTIONS" });

  const pathRoute = routeFromPath(request.pathname);
  if (pathRoute === null) return finish(404, { error: "Unknown route." }, "route");
  if (pathRoute) route = pathRoute;

  // 2. Announced size, before anything is read.
  const declared = Number(readHeader(request.headers, "content-length") || 0);
  if (declared > MAX_BODY_BYTES) return finish(413, { error: "Request is too large." }, "size");

  // 3. Who is calling. Nothing is read and nothing is sent to Gemini until the database says the token is good.
  const token = tokenFromHeader(readHeader(request.headers, "authorization"));
  if (!token) return finish(401, { error: "Sign in required." }, "no-token");
  const supabase = {
    fetchImpl,
    supabaseUrl: stripTrailingSlashes(String(deps.supabaseUrl || SUPABASE_URL)),
    supabaseKey: String(deps.supabaseKey || SUPABASE_PUBLISHABLE_KEY),
    databaseTimeoutMs: Number(deps.databaseTimeoutMs) > 0 ? Number(deps.databaseTimeoutMs) : DATABASE_TIMEOUT_MS
  };
  const who = await verifyToken(token, supabase);
  if (who.state === "unauthorized") return finish(401, { error: "Sign in required." }, "unauthorized");
  if (who.state !== "ok") return finish(503, { error: "Service unavailable." }, "auth-unavailable");

  // 4. The body, capped while reading.
  const read = await request.readBody(MAX_BODY_BYTES);
  if (!read || !read.ok) return finish(413, { error: "Request is too large." }, "size");
  let body = {};
  try { body = JSON.parse(read.text); } catch (error) { body = {}; }
  if (!body || typeof body !== "object" || Array.isArray(body)) body = {};

  if (!pathRoute) {
    const fromBody = typeof body.route === "string" ? body.route : "";
    if (!ROUTES.includes(fromBody)) return finish(400, { error: "Unknown route." }, "route");
    route = fromBody;
  }

  // 5. Validate. The same refusals and the same fallbacks as the Firebase functions. A request that fails here
  //    does not use up one of the person's calls.
  let input;
  if (route === "explain-to-aiko") {
    const parsed = parseExplainInput(body);
    if (parsed.error) return finish(400, { error: parsed.error }, "invalid");
    input = parsed.input;
  } else {
    const parsed = parseTsaInput(body);
    if (parsed.fallback) return finish(200, { fallback: true }, "invalid-fallback");
    input = parsed.input;
  }

  const apiKey = String(env.GEMINI_API_KEY || "").trim();
  if (!apiKey) return finish(200, { fallback: true }, "no-key");

  // 6. The hourly limit.
  const slot = await takeSlot(token, route, supabase);
  if (slot === "limited") {
    const secondsLeft = 3600 - (Math.floor(now() / 1000) % 3600);
    return finish(429, { error: "Too many requests. Please try again later." }, "rate-limited", { "Retry-After": String(secondsLeft) });
  }
  if (slot !== "allowed") return finish(503, { error: "Service unavailable." }, "limit-unavailable");

  // 7. Gemini.
  const perAttemptMs = Number(deps.geminiTimeoutMs) > 0 ? Number(deps.geminiTimeoutMs) : GEMINI_TIMEOUT_MS;
  const totalBudgetMs = Number(deps.geminiTotalBudgetMs) > 0 ? Number(deps.geminiTotalBudgetMs) : GEMINI_TOTAL_BUDGET_MS;
  try {
    if (route === "explain-to-aiko") {
      const raw = await callGemini(apiKey, buildExplainPrompt(input), { models: MODELS, accept: isExplainShape, perAttemptMs, totalBudgetMs, fetchImpl, now });
      const result = normalizeResult(raw);
      let stored = { recorded: false };
      if (env.AIKO_STORE_ATTEMPT === "on") {
        stored = await storeAttempt({
          token, attemptId: body.attemptId, attemptNumber: body.attemptNumber, mode: input.mode,
          total: result.total, durationSeconds: input.durationSeconds, deps: supabase
        });
      }
      return finish(200, stored && stored.recorded ? { ...result, attemptRecorded: true, attemptId: stored.attemptId } : result, stored && stored.recorded ? "ok-stored" : "ok");
    }
    const raw = await callGemini(apiKey, buildTsaDiagnosticPrompt(input), { models: [MODELS[0]], accept: isTsaShape, perAttemptMs, totalBudgetMs, fetchImpl, now });
    return finish(200, normalizeTsaDiagnostic(raw, input), "ok");
  } catch (error) {
    // Same as Firebase: the page gets {fallback:true} and carries on. The note is fixed text, never the error text.
    const message = error && typeof error.message === "string" ? error.message : "";
    const note = message === "timeout" ? "gemini-timeout" : /^gemini-http-[0-9]+$/.test(message) ? message : "gemini-failed";
    return finish(200, { fallback: true }, note);
  }
}
