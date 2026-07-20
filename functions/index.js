const admin = require("firebase-admin");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const { google } = require("googleapis");

admin.initializeApp();

const GROUP_EMAIL = defineString("GOOGLE_GROUP_EMAIL", {
  default: "utl-members@googlegroups.com"
});
const WORKSPACE_ADMIN_EMAIL = defineString("GOOGLE_WORKSPACE_ADMIN_EMAIL");
const SERVICE_ACCOUNT_JSON = defineSecret("GOOGLE_GROUP_SYNC_SERVICE_ACCOUNT_JSON");
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

const GROUP_SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.group",
  "https://www.googleapis.com/auth/admin.directory.group.member"
];

exports.processGoogleGroupSyncJob = onDocumentCreated({
  document: "google_group_sync_jobs/{jobId}",
  secrets: [SERVICE_ACCOUNT_JSON],
  timeoutSeconds: 60,
  memory: "256MiB"
}, async (event) => {
  const snap = event.data;
  if (!snap) return;

  const jobRef = snap.ref;
  const job = snap.data() || {};
  const email = String(job.email || job.memberEmail || "").trim().toLowerCase();
  const action = String(job.action || "").trim().toLowerCase();
  const groupEmail = String(job.groupEmail || GROUP_EMAIL.value()).trim().toLowerCase();

  await jobRef.set({
    status: "processing",
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  try {
    if (!email) throw new Error("Missing member email.");
    if (action !== "add" && action !== "remove") {
      throw new Error("Invalid Google Group sync action: " + action);
    }
    if (!groupEmail) throw new Error("Missing Google Group email.");

    const directory = getDirectoryClient();
    if (action === "add") {
      await addGroupMember(directory, groupEmail, email);
    } else {
      await removeGroupMember(directory, groupEmail, email);
    }

    await markJobConfirmed(jobRef, job, action, groupEmail, email);
  } catch (error) {
    await markJobFailed(jobRef, job, action, groupEmail, email, error);
  }
});

function getDirectoryClient() {
  const adminEmail = String(WORKSPACE_ADMIN_EMAIL.value() || "").trim();
  const rawJson = String(SERVICE_ACCOUNT_JSON.value() || "").trim();
  if (!adminEmail) {
    throw new Error("Missing GOOGLE_WORKSPACE_ADMIN_EMAIL function parameter.");
  }
  if (!rawJson) {
    throw new Error("Missing GOOGLE_GROUP_SYNC_SERVICE_ACCOUNT_JSON secret.");
  }

  const credentials = JSON.parse(rawJson);
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: String(credentials.private_key || "").replace(/\\n/g, "\n"),
    scopes: GROUP_SCOPES,
    subject: adminEmail
  });

  return google.admin({ version: "directory_v1", auth });
}

async function addGroupMember(directory, groupEmail, email) {
  try {
    await directory.members.get({ groupKey: groupEmail, memberKey: email });
    return;
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  await directory.members.insert({
    groupKey: groupEmail,
    requestBody: {
      email,
      role: "MEMBER"
    }
  });
}

async function removeGroupMember(directory, groupEmail, email) {
  try {
    await directory.members.delete({ groupKey: groupEmail, memberKey: email });
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

async function markJobConfirmed(jobRef, job, action, groupEmail, email) {
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  await jobRef.set({
    status: "confirmed",
    errorMessage: admin.firestore.FieldValue.delete(),
    completedAt: now,
    updatedAt: now
  }, { merge: true });

  const memberRef = db.collection("authorized_members").doc(email);
  const memberSnap = await memberRef.get();
  if (!memberSnap.exists && action === "remove") return;

  await memberRef.set({
    googleGroupAdded: action === "add",
    googleGroupSyncStatus: "confirmed",
    googleGroupSyncJobId: jobRef.id,
    googleGroupSyncAction: action,
    googleGroupSyncGroupEmail: groupEmail,
    googleGroupSyncConfirmedAt: now,
    googleGroupSyncError: admin.firestore.FieldValue.delete()
  }, { merge: true });
}

async function markJobFailed(jobRef, job, action, groupEmail, email, error) {
  const db = admin.firestore();
  const message = String(error && error.message || error || "Unknown Google Group sync error");
  const now = admin.firestore.FieldValue.serverTimestamp();

  await jobRef.set({
    status: "failed",
    errorMessage: message,
    failedAt: now,
    updatedAt: now
  }, { merge: true });

  if (email) {
    const memberRef = db.collection("authorized_members").doc(email);
    const memberSnap = await memberRef.get();
    if (!memberSnap.exists && action === "remove") return;

    await memberRef.set({
      googleGroupSyncStatus: "failed",
      googleGroupSyncJobId: jobRef.id,
      googleGroupSyncAction: action || "",
      googleGroupSyncGroupEmail: groupEmail || "",
      googleGroupSyncError: message,
      googleGroupSyncFailedAt: now
    }, { merge: true });
  }
}

function isNotFound(error) {
  const code = error && (error.code || error.status);
  const message = String(error && error.message || "");
  return code === 404 || /not.?found/i.test(message);
}

const AIKO_ALLOWED_ORIGINS = new Set([
  "https://theuntaughtlessons.com",
  "https://www.theuntaughtlessons.com",
  "http://127.0.0.1:8061",
  "http://localhost:8061"
]);
const AIKO_RUBRIC_NAMES = [
  "Clear core idea",
  "Message coverage",
  "Close and ask",
  "Structure",
  "Concise execution",
  "Confident language"
];
const AIKO_MODELS = ["gemini-flash-latest", "gemini-2.5-flash"];

function aikoLevel(total) {
  if (total >= 28) return "Executive-ready";
  if (total >= 23) return "Strong";
  if (total >= 15) return "Developing";
  return "Foundational";
}

function buildAikoPrompt(input) {
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

function extractAikoJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Gemini returned no JSON object.");
  return JSON.parse(text.slice(start, end + 1));
}

async function callAikoModel(apiKey, model, prompt) {
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
    const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts || [];
    const text = parts.map((part) => part.text || "").join("");
    if (!text.trim()) throw new Error(`Gemini ${model} returned no text.`);
    return extractAikoJson(text);
  } finally {
    clearTimeout(timer);
  }
}

async function callAikoGemini(apiKey, prompt) {
  let lastError;
  for (const model of AIKO_MODELS) {
    try { return await callAikoModel(apiKey, model, prompt); }
    catch (error) { lastError = error; console.error("Explain to Aiko scoring model failed:", error.message); }
  }
  try { return await callAikoModel(apiKey, AIKO_MODELS[AIKO_MODELS.length - 1], prompt); }
  catch (error) { throw lastError || error; }
}

function normalizeAikoResult(result) {
  if (!result || !Array.isArray(result.criteria) || result.criteria.length !== 6) throw new Error("Invalid rubric response.");
  if (!Array.isArray(result.missed) || typeof result.exemplar_opening !== "string" || typeof result.summary !== "string") throw new Error("Incomplete rubric response.");
  const criteria = result.criteria.map((criterion, index) => {
    if (!criterion || typeof criterion.evidence !== "string" || typeof criterion.feedback !== "string") throw new Error("Invalid criterion response.");
    return {
      name: AIKO_RUBRIC_NAMES[index],
      score: Math.min(5, Math.max(1, Math.round(Number(criterion.score) || 1))),
      evidence: criterion.evidence.slice(0, 500),
      feedback: criterion.feedback.slice(0, 500)
    };
  });
  const total = criteria.reduce((sum, criterion) => sum + criterion.score, 0);
  return {
    total,
    level: aikoLevel(total),
    criteria,
    missed: result.missed.map((item) => String(item).slice(0, 500)).slice(0, 8),
    exemplar_opening: result.exemplar_opening.slice(0, 1500),
    summary: result.summary.slice(0, 1500),
    fallback: false
  };
}

exports.scoreExplainToAiko = onRequest({
  secrets: [GEMINI_API_KEY],
  timeoutSeconds: 120,
  memory: "256MiB"
}, async (request, response) => {
  const origin = String(request.get("origin") || "");
  if (origin && !AIKO_ALLOWED_ORIGINS.has(origin)) {
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
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  const transcript = String(body && body.transcript || "").trim().slice(0, 12000);
  if (transcript.split(/\s+/).filter(Boolean).length < 5) {
    response.status(400).json({ error: "Transcript is empty or too short to score." });
    return;
  }
  const input = {
    mode: body && body.mode === "60" ? "60" : "120",
    transcript,
    durationSeconds: Math.max(0, Math.round(Number(body && body.durationSeconds) || 0)),
    wpm: Math.max(0, Math.round(Number(body && body.wpm) || 0)),
    fillerCount: Math.max(0, Math.round(Number(body && body.fillerCount) || 0)),
    priorTranscript: String(body && body.priorTranscript || "").trim().slice(0, 12000)
  };

  try {
    const apiKey = String(GEMINI_API_KEY.value() || "").trim();
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
    const raw = await callAikoGemini(apiKey, buildAikoPrompt(input));
    response.status(200).json(normalizeAikoResult(raw));
  } catch (error) {
    console.error("Explain to Aiko scoring unavailable:", error.message);
    response.status(200).json({ fallback: true });
  }
});
