const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const ALLOWED_ORIGINS = new Set([
  "https://theuntaughtlessons.com",
  "https://www.theuntaughtlessons.com",
  "http://127.0.0.1:8061",
  "http://localhost:8061"
]);
const RUBRIC_NAMES = [
  "Clear core idea",
  "Message coverage",
  "Close and ask",
  "Structure",
  "Concise execution",
  "Confident language"
];
const MODELS = ["gemini-flash-latest", "gemini-2.5-flash"];

function levelFor(total) {
  if (total >= 28) return "Executive-ready";
  if (total >= 23) return "Strong";
  if (total >= 15) return "Developing";
  return "Foundational";
}

function buildPrompt(input) {
  const isSixty = input.mode === "60";
  const compression = isSixty && input.priorTranscript
    ? `\nORIGINAL 120-SECOND TRANSCRIPT FOR COMPRESSION COMPARISON:\n"""\n${input.priorTranscript}\n"""\nFor C5, weigh whether the 60-second version kept the bottom line and strongest reasons while cutting lower-value detail.`
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

function extractJson(text) {
  const source = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!source) throw new Error("Gemini returned no JSON object.");

  const candidates = [source];
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fence;
  while ((fence = fencePattern.exec(source))) candidates.push(fence[1].trim());

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && (Array.isArray(parsed.criteria) || Array.isArray(parsed.advisors) || Object.prototype.hasOwnProperty.call(parsed, "speakScore"))) return parsed;
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
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') { inString = true; continue; }
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      if (depth !== 0) continue;
      try {
        const parsed = JSON.parse(source.slice(start, index + 1));
        if (parsed && (Array.isArray(parsed.criteria) || Array.isArray(parsed.advisors) || Object.prototype.hasOwnProperty.call(parsed, "speakScore"))) return parsed;
      } catch (_) { break; }
    }
  }
  throw new Error("Gemini returned text, but no valid JSON object could be extracted.");
}

async function callModel(apiKey, model, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 40000);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.35, responseMimeType: "application/json" }
      })
    });
    if (!response.ok) throw new Error(`Gemini ${model} returned HTTP ${response.status}.`);
    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((part) => part.text || "").join("");
    if (!text.trim()) throw new Error(`Gemini ${model} returned no text.`);
    return extractJson(text);
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(apiKey, prompt) {
  let lastError;
  for (const model of MODELS) {
    try {
      return await callModel(apiKey, model, prompt);
    } catch (error) {
      lastError = error;
      console.error("Gemini model attempt failed:", error.message);
    }
  }
  throw lastError;
}

function normalizeResult(result) {
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

function buildScqaPrompt(input) {
  return `You are a clear, constructive SCQA writing coach. Review one learner response without rewriting the whole answer.

CONTEXT:
${input.context}

LEARNER SCQA:
Situation: ${input.situation}
Complication: ${input.complication}
Question: ${input.question}
Answer: ${input.answer}

Check whether:
1. Situation gives stable, relevant background.
2. Complication explains a meaningful change, tension, problem, or risk.
3. Question follows logically from the Complication.
4. Answer responds directly to the Question.
5. All four parts form one coherent storyline.

Use direct, encouraging language suitable for a teenager or working adult. Do not use em dashes. Do not use the words "delve", "leverage", "nuanced", "robust", "landscape", "tapestry", "carry forward", or "gravity". Do not claim there is one correct business answer. Give one improvement only.

Return strict JSON:
{"summary":"Two short sentences describing the storyline and overall coherence.","connections":[{"name":"Situation","status":"strong","feedback":"Specific feedback."},{"name":"Complication","status":"review","feedback":"Specific feedback."},{"name":"Question","status":"strong","feedback":"Specific feedback."},{"name":"Answer","status":"strong","feedback":"Specific feedback."}],"improvementTitle":"Bolded summary phrase","improvement":"One specific improvement in no more than 35 words."}`;
}

function extractScqaJson(text) {
  const source = String(text || "").replace(/^\uFEFF/, "").trim();
  const candidates = [source];
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fence;
  while ((fence = fencePattern.exec(source))) candidates.push(fence[1].trim());
  const firstBrace = source.indexOf("{");
  const lastBrace = source.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(source.slice(firstBrace, lastBrace + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && Array.isArray(parsed.connections)) return parsed;
    } catch (_) { /* Try the next candidate. */ }
  }
  throw new Error("Gemini returned no valid SCQA review JSON.");
}

async function callScqaModel(apiKey, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 40000);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json"
        }
      })
    });
    if (!response.ok) throw new Error(`Gemini SCQA review returned HTTP ${response.status}.`);
    const data = await response.json();
    const output = (data?.candidates?.[0]?.content?.parts || []).map((part) => part.text || "").join("");
    return extractScqaJson(output);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeScqaResult(result) {
  if (!result || typeof result.summary !== "string" || !Array.isArray(result.connections) || result.connections.length !== 4) {
    throw new Error("Invalid SCQA review response.");
  }
  const expectedNames = ["Situation", "Complication", "Question", "Answer"];
  return {
    summary: result.summary.slice(0, 800),
    connections: result.connections.map((item, index) => ({
      name: expectedNames[index],
      status: item?.status === "strong" ? "strong" : "review",
      feedback: String(item?.feedback || "").slice(0, 500)
    })),
    improvementTitle: String(result.improvementTitle || "Strengthen the connection").slice(0, 120),
    improvement: String(result.improvement || "").slice(0, 500),
    fallback: false
  };
}

exports.scoreScqa = onRequest({
  secrets: [GEMINI_API_KEY],
  timeoutSeconds: 60,
  memory: "256MiB"
}, async (request, response) => {
  const origin = String(request.get("origin") || "");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    response.status(403).json({ error: "Origin not allowed." });
    return;
  }
  if (origin) response.set("Access-Control-Allow-Origin", origin);
  response.set("Vary", "Origin");
  response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.set("Access-Control-Allow-Headers", "Content-Type");
  response.set("Content-Type", "application/json");
  if (request.method === "OPTIONS") { response.status(204).send(""); return; }
  if (request.method !== "POST") { response.status(405).json({ error: "POST only." }); return; }

  let body = request.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  const input = {
    context: String(body?.context || "").trim().slice(0, 2500),
    situation: String(body?.situation || "").trim().slice(0, 2000),
    complication: String(body?.complication || "").trim().slice(0, 2000),
    question: String(body?.question || "").trim().slice(0, 1500),
    answer: String(body?.answer || "").trim().slice(0, 3000)
  };
  if (Object.values(input).some((value) => value.split(/\s+/).filter(Boolean).length < 3)) {
    response.status(400).json({ error: "Complete all four SCQA fields before requesting AI feedback." });
    return;
  }
  try {
    const apiKey = String(GEMINI_API_KEY.value() || "").trim();
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
    const raw = await callScqaModel(apiKey, buildScqaPrompt(input));
    response.status(200).json(normalizeScqaResult(raw));
  } catch (error) {
    console.error("SCQA review unavailable:", error.message);
    response.status(200).json({ fallback: true });
  }
});

function buildAdvisoryBoardPrompt(input) {
  const advisors = input.advisors.map((advisor) => `ADVISOR: ${advisor.name}\nPerspective: ${advisor.lens}\nWhat to examine: ${advisor.description}`).join("\n\n");
  return `Facilitate a short virtual advisory board meeting. The learner should hear clearly different perspectives and then receive one decision. Use direct language suitable for a teenager or working adult. Do not use em dashes. Do not use corporate filler or praise the learner.

QUESTION FOR THE BOARD:
${input.question}

WHAT THE BOARD SHOULD KNOW:
${input.context}

LEARNER'S STARTING VIEW:
${input.startingView || "Not provided"}

BOARD MEMBERS:
${advisors}

BOARD CHAIR:
${input.decisionMaker.name}
Perspective: ${input.decisionMaker.lens}

For each advisor, provide one distinct concern, the evidence to verify or assumption behind it, and one recommendation. Do not invent facts. Do not repeat another advisor's concern. State what information could change the recommendation. The board chair is not an advisor and should not add a second version of their own perspective. The board chair must compare the advisors, use some advice, explicitly decline at least one suggestion, and recommend one direction. The learner makes the final decision. Keep the full response under 500 words.

Return strict JSON only in this exact shape:
{"advisors":[{"name":"Exact advisor name","mainConcern":"One or two sentences","evidenceOrAssumption":"One or two sentences","recommendation":"One or two sentences"}],"decision":{"decisionMaker":"Exact board chair name","finalDecision":"Recommended direction in one or two sentences","decisionCriterion":"The main standard used to choose","centralTradeoff":"The main tradeoff being made","adviceAccepted":"Name the advice used and why","adviceDeclined":"Name advice not used and why","importantUncertainty":"The most important fact or assumption still uncertain","nextStep":"One specific action"}}`;
}

function normalizeAdvisoryBoardResult(result, input) {
  if (!result || !Array.isArray(result.advisors) || result.advisors.length !== input.advisors.length || !result.decision) {
    throw new Error("Invalid advisory board response.");
  }
  const clean = (value, limit = 1000) => String(value || "").trim().slice(0, limit);
  const advisors = result.advisors.map((advisor, index) => {
    const expected = input.advisors[index];
    const normalized = {
      name: expected.name,
      lens: expected.lens,
      mainConcern: clean(advisor?.mainConcern),
      evidenceOrAssumption: clean(advisor?.evidenceOrAssumption),
      recommendation: clean(advisor?.recommendation)
    };
    if (!normalized.mainConcern || !normalized.evidenceOrAssumption || !normalized.recommendation) throw new Error("Incomplete advisor response.");
    return normalized;
  });
  const decision = {
    decisionMaker: input.decisionMaker.name,
    finalDecision: clean(result.decision.finalDecision, 1500),
    decisionCriterion: clean(result.decision.decisionCriterion, 1000),
    centralTradeoff: clean(result.decision.centralTradeoff, 1000),
    adviceAccepted: clean(result.decision.adviceAccepted, 1500),
    adviceDeclined: clean(result.decision.adviceDeclined, 1500),
    importantUncertainty: clean(result.decision.importantUncertainty, 1000),
    nextStep: clean(result.decision.nextStep, 1000)
  };
  if (Object.values(decision).some((value) => !value)) throw new Error("Incomplete decision response.");
  return { advisors, decision, fallback: false };
}

exports.runAdvisoryBoard = onRequest({
  secrets: [GEMINI_API_KEY], timeoutSeconds: 60, memory: "256MiB"
}, async (request, response) => {
  const origin = String(request.get("origin") || "");
  if (origin && !ALLOWED_ORIGINS.has(origin)) { response.status(403).json({ error: "Origin not allowed." }); return; }
  if (origin) response.set("Access-Control-Allow-Origin", origin);
  response.set("Vary", "Origin");
  response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.set("Access-Control-Allow-Headers", "Content-Type");
  response.set("Content-Type", "application/json");
  if (request.method === "OPTIONS") { response.status(204).send(""); return; }
  if (request.method !== "POST") { response.status(405).json({ error: "POST only." }); return; }

  let body = request.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  const input = {
    question: String(body?.question || "").trim().slice(0, 2500),
    context: String(body?.context || "").trim().slice(0, 5000),
    startingView: String(body?.startingView || "").trim().slice(0, 2000),
    advisors: Array.isArray(body?.advisors) ? body.advisors.slice(0, 4).map((advisor) => ({
      name: String(advisor?.name || "").trim().slice(0, 120),
      lens: String(advisor?.lens || "").trim().slice(0, 200),
      description: String(advisor?.description || "").trim().slice(0, 800)
    })) : [],
    decisionMaker: {
      name: String(body?.decisionMaker?.name || "").trim().slice(0, 120),
      lens: String(body?.decisionMaker?.lens || "").trim().slice(0, 200)
    }
  };
  if (input.question.split(/\s+/).length < 4 || input.context.split(/\s+/).length < 8 || input.startingView.split(/\s+/).length < 3 || input.advisors.length < 2 || !input.decisionMaker.name) {
    response.status(400).json({ error: "Add a clear question, context, starting view, at least two advisors, and a board chair." });
    return;
  }
  if (input.advisors.some((advisor) => !advisor.name || !advisor.lens || !advisor.description)) {
    response.status(400).json({ error: "Every advisor needs a name, perspective, and description." });
    return;
  }
  try {
    const apiKey = String(GEMINI_API_KEY.value() || "").trim();
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
    const raw = await callGemini(apiKey, buildAdvisoryBoardPrompt(input));
    response.status(200).json(normalizeAdvisoryBoardResult(raw, input));
  } catch (error) {
    console.error("Advisory board unavailable:", error.message);
    response.status(200).json({ fallback: true });
  }
});

exports.scoreExplainToAiko = onRequest({
  secrets: [GEMINI_API_KEY],
  timeoutSeconds: 120,
  memory: "256MiB"
}, async (request, response) => {
  const origin = String(request.get("origin") || "");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    response.status(403).json({ error: "Origin not allowed." });
    return;
  }
  if (origin) response.set("Access-Control-Allow-Origin", origin);
  response.set("Vary", "Origin");
  response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.set("Access-Control-Allow-Headers", "Content-Type");
  response.set("Content-Type", "application/json");
  if (request.method === "OPTIONS") { response.status(204).send(""); return; }
  if (request.method !== "POST") { response.status(405).json({ error: "POST only." }); return; }

  let body = request.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  const transcript = String(body?.transcript || "").trim().slice(0, 12000);
  if (transcript.split(/\s+/).filter(Boolean).length < 5) {
    response.status(400).json({ error: "Transcript is empty or too short to score." });
    return;
  }
  const input = {
    mode: body?.mode === "60" ? "60" : "120",
    transcript,
    durationSeconds: Math.max(0, Math.round(Number(body?.durationSeconds) || 0)),
    wpm: Math.max(0, Math.round(Number(body?.wpm) || 0)),
    fillerCount: Math.max(0, Math.round(Number(body?.fillerCount) || 0)),
    priorTranscript: String(body?.priorTranscript || "").trim().slice(0, 12000)
  };

  try {
    const apiKey = String(GEMINI_API_KEY.value() || "").trim();
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
    const raw = await callGemini(apiKey, buildPrompt(input));
    response.status(200).json(normalizeResult(raw));
  } catch (error) {
    console.error("Explain to Aiko scoring unavailable:", error.message);
    response.status(200).json({ fallback: true });
  }
});

function buildTsaDiagnosticPrompt(input) {
  return `You are a careful assessment feedback reviewer for The Untaught Lessons. Review two transcript-based responses. The official score has already been calculated with fixed rules. Do not rescore it. Add concise, evidence-based comments only. Do not infer tone, confidence, presence, accent, personality, or vocal delivery from text. Do not reward fancy vocabulary or grammar. Use only evidence in the response.

FORM: ${input.formId}
ATTEMPT: ${input.kind}
DETERMINISTIC SPEAK SCORE: ${input.speakBase}/30
DETERMINISTIC ACT SCORE: ${input.actBase}/30

SPEAK SCENARIO FACTS:
${input.speakFacts.map((fact) => `- ${fact}`).join("\n")}
SPEAK TASK: Give a recommendation, two or three reasons, and a clear next step.
SPEAK TRANSCRIPT:
"""${input.speakTranscript}"""

ACT SITUATION: ${input.actSetup}
ACT SELECTED CHOICE: ${input.actChoiceText}
ACT PUSHBACK: ${input.actPushback}
ACT TASK: State a decision, respond to the concern, explain the tradeoff, and give a constructive next step.
ACT TRANSCRIPT:
"""${input.actTranscript}"""

Return strict JSON only:
{"speakEvidence":"Short verbatim quote","actEvidence":"Short verbatim quote","speakStrength":"One observed strength","speakNext":"One concrete next move","actStrength":"One observed strength","actNext":"One concrete next move"}`;
}

function normalizeTsaDiagnostic(result, input) {
  if (!result || typeof result !== "object") throw new Error("Invalid TSA diagnostic response.");
  const required = ["speakEvidence", "actEvidence", "speakStrength", "speakNext", "actStrength", "actNext"];
  if (required.some((key) => typeof result[key] !== "string" || !result[key].trim())) throw new Error("Incomplete TSA diagnostic feedback.");
  const quote = (value, transcript) => {
    const cleaned = String(value || "").trim().replace(/^[“"]|[”"]$/g, "");
    if (!cleaned || !transcript.toLowerCase().includes(cleaned.toLowerCase())) return "No relevant content found";
    return cleaned.slice(0, 400);
  };
  const speakEvidence = quote(result.speakEvidence, input.speakTranscript);
  const actEvidence = quote(result.actEvidence, input.actTranscript);
  if (speakEvidence === "No relevant content found" || actEvidence === "No relevant content found") {
    throw new Error("TSA feedback evidence was not found in the transcript.");
  }
  return {
    speakEvidence,
    actEvidence,
    speakStrength: result.speakStrength.slice(0, 400),
    speakNext: result.speakNext.slice(0, 400),
    actStrength: result.actStrength.slice(0, 400),
    actNext: result.actNext.slice(0, 400),
    modelVersion: "gemini-flash-latest/tsa-unified-20260731",
    fallback: false
  };
}

exports.scoreTsaDiagnostic = onRequest({
  secrets: [GEMINI_API_KEY], timeoutSeconds: 60, memory: "256MiB"
}, async (request, response) => {
  const origin = String(request.get("origin") || "");
  if (origin && !ALLOWED_ORIGINS.has(origin)) { response.status(403).json({ error: "Origin not allowed." }); return; }
  if (origin) response.set("Access-Control-Allow-Origin", origin);
  response.set("Vary", "Origin");
  response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.set("Access-Control-Allow-Headers", "Content-Type");
  response.set("Content-Type", "application/json");
  if (request.method === "OPTIONS") { response.status(204).send(""); return; }
  if (request.method !== "POST") { response.status(405).json({ error: "POST only." }); return; }
  let body = request.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  const input = {
    formId: String(body?.formId || "").slice(0, 4),
    kind: body?.kind === "checkpoint" ? "checkpoint" : "diagnostic",
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
  if (input.speakTranscript.split(/\s+/).length < 5 || input.actTranscript.split(/\s+/).length < 5) {
    response.status(200).json({ fallback: true }); return;
  }
  try {
    const apiKey = String(GEMINI_API_KEY.value() || "").trim();
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
    const raw = await callModel(apiKey, MODELS[0], buildTsaDiagnosticPrompt(input));
    response.status(200).json(normalizeTsaDiagnostic(raw, input));
  } catch (error) {
    console.error("TSA diagnostic scoring unavailable:", error.message);
    response.status(200).json({ fallback: true });
  }
});
