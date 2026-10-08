// The Executive Signature form versions, the answer checks and the scoring, for the readiness-submit Edge Function.
//
// This is a copy of the logic in functions-admin/executive-signature-versions.js (the Firebase server module), written as a
// plain ES module so it runs in the Supabase Edge runtime and in node. The numbers, the labels and the order of the
// questions must stay identical: tests/readiness-submit-core.test.js compares this file with the Firebase module on
// random answers (all fields of the score) and fails when they drift apart. Change both together, or neither.

export const BANDS = [
  { label: "Emerging", min: 0 },
  { label: "Developing", min: 40 },
  { label: "Strong", min: 60 },
  { label: "Exceptional", min: 80 },
];
export const PROFILES = {
  "Reserved|Achievement-driven": "Quiet achiever",
  "Reserved|Connection-driven": "Steady supporter",
  "Balanced|Achievement-driven": "Go-getter",
  "Balanced|Connection-driven": "Team player",
  "Vocal|Achievement-driven": "Natural leader",
  "Vocal|Connection-driven": "People person",
};
export const SETTINGS = { levelLow: 40, levelHigh: 60, voiceLow: 40, voiceHigh: 60, closeGap: 10 };

const FREE_ROWS = [
  ["mini_e1", "Extraversion", "+"], ["mini_a1", "Agreeableness", "+"], ["mini_c1", "Conscientiousness", "+"],
  ["mini_n1", "Neuroticism", "+"], ["mini_i1", "Intellect", "+"], ["mini_e2", "Extraversion", "-"],
  ["mini_a2", "Agreeableness", "-"], ["mini_c2", "Conscientiousness", "-"], ["mini_n2", "Neuroticism", "-"],
  ["mini_i2", "Intellect", "-"], ["mini_e3", "Extraversion", "+"], ["mini_a3", "Agreeableness", "+"],
  ["mini_c3", "Conscientiousness", "+"], ["mini_n3", "Neuroticism", "+"], ["mini_i3", "Intellect", "-"],
  ["mini_e4", "Extraversion", "-"], ["mini_a4", "Agreeableness", "-"], ["mini_c4", "Conscientiousness", "-"],
  ["mini_n4", "Neuroticism", "-"], ["mini_i4", "Intellect", "-"],
];

const FULL_GROUPS = [
  ["Achievement-Striving", ["+", "+", "-", "-"]],
  ["Self-Discipline", ["+", "+", "-", "-"]],
  ["Orderliness", ["+", "+", "-", "-"]],
  ["Intellect", ["+", "+", "-", "-"]],
  ["Anxiety", ["+", "+", "-", "-"]],
  ["Self-Consciousness", ["+", "+", "-", "-"]],
  ["Assertiveness", ["+", "+", "-", "-"]],
  ["Activity Level", ["+", "+", "-", "-"]],
  ["Cooperation", ["+", "+", "-", "-"]],
  ["Altruism", ["+", "+", "-", "-"]],
];

function rowsToQuestions(rows) {
  return rows.map(([id, area, direction], index) => ({ id, area, direction, orderInForm: index + 1 }));
}

const fullRows = [];
FULL_GROUPS.forEach(([area, directions], groupIndex) => directions.forEach((direction, itemIndex) => {
  fullRows.push(["neo_" + String(groupIndex + 1).padStart(2, "0") + "_" + (itemIndex + 1), area, direction]);
}));

export const VERSION_REGISTRY = {
  "readiness-free@1.0.0": {
    versionId: "es-quick-check-1.0.0",
    assessmentId: "quick-check",
    formVersion: "readiness-free@1.0.0",
    version: "1.0.0",
    scoringVersion: "es-quick-check-score@1.0.0",
    contentVersion: "readiness-content@1.0.0",
    title: "Executive Signature Quick Check",
    estimatedMinutes: 5,
    questions: rowsToQuestions(FREE_ROWS),
  },
  "readiness-full@1.0.0": {
    versionId: "es-full-assessment-1.0.0",
    assessmentId: "full-assessment",
    formVersion: "readiness-full@1.0.0",
    version: "1.0.0",
    scoringVersion: "es-full-score@1.0.0",
    contentVersion: "readiness-content@1.0.0",
    title: "Executive Signature Full Assessment",
    estimatedMinutes: 10,
    questions: rowsToQuestions(fullRows),
  },
};

// Returns the locked server copy of a form version, or null for a version this server does not know.
export function getVersion(formVersion) {
  const key = String(formVersion || "");
  return Object.prototype.hasOwnProperty.call(VERSION_REGISTRY, key) ? VERSION_REGISTRY[key] : null;
}

// Exactly the form's answers, each an integer from 1 to 5. Returns { ok: true, answers } with the answers in the form's
// question order, or { ok: false, error } with the same words the Firebase server uses.
export function normalizeAnswers(version, input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const expectedIds = new Set(version.questions.map((question) => question.id));
  const receivedIds = Object.keys(source);
  if (receivedIds.length !== expectedIds.size || receivedIds.some((id) => !expectedIds.has(id))) {
    return { ok: false, error: "Expected exactly " + expectedIds.size + " answers for " + version.formVersion + "." };
  }
  const answers = [];
  for (const question of version.questions) {
    const value = Number(source[question.id]);
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      return { ok: false, error: "Answer " + question.id + " must be an integer from 1 to 5." };
    }
    answers.push({ questionId: question.id, value });
  }
  return { ok: true, answers };
}

export function scoreVersion(version, answers) {
  const answerMap = new Map(answers.map((answer) => [answer.questionId, answer.value]));
  const sums = {};
  const counts = {};
  version.questions.forEach((question) => {
    const answer = answerMap.get(question.id);
    const scored = question.direction === "+" ? answer : 6 - answer;
    sums[question.area] = (sums[question.area] || 0) + scored;
    counts[question.area] = (counts[question.area] || 0) + 1;
  });
  const raw = {};
  Object.keys(sums).forEach((area) => { raw[area] = (sums[area] / counts[area] - 1) / 4 * 100; });
  let shown;
  let readinessAreas;
  let voiceArea;
  let achievementArea;
  let connectionArea;
  if (version.assessmentId === "quick-check") {
    shown = { ...raw, Neuroticism: 100 - raw.Neuroticism };
    readinessAreas = ["Conscientiousness", "Neuroticism", "Intellect"];
    voiceArea = "Extraversion";
    achievementArea = "Conscientiousness";
    connectionArea = "Agreeableness";
  } else {
    shown = { ...raw, Anxiety: 100 - raw.Anxiety, "Self-Consciousness": 100 - raw["Self-Consciousness"] };
    readinessAreas = ["Achievement-Striving", "Self-Discipline", "Orderliness", "Intellect", "Anxiety", "Self-Consciousness"];
    voiceArea = "Assertiveness";
    achievementArea = "Achievement-Striving";
    connectionArea = "Altruism";
  }
  const overallScore = Math.round(readinessAreas.reduce((sum, area) => sum + shown[area], 0) / readinessAreas.length);
  const band = [...BANDS].reverse().find((candidate) => overallScore >= candidate.min).label;
  const voiceValue = shown[voiceArea];
  const voice = voiceValue < SETTINGS.voiceLow ? "Reserved" : voiceValue > SETTINGS.voiceHigh ? "Vocal" : "Balanced";
  const drive = shown[achievementArea] >= shown[connectionArea] ? "Achievement-driven" : "Connection-driven";
  return {
    overallScore,
    areaScores: Object.fromEntries(Object.entries(shown).map(([area, value]) => [area, Math.round(value * 1000) / 1000])),
    band,
    profileLabel: PROFILES[voice + "|" + drive],
    scoringInputs: { readinessAreas, voiceArea, achievementArea, connectionArea, settings: SETTINGS },
    voice,
    drive,
    driveCloseCall: Math.abs(shown[achievementArea] - shown[connectionArea]) < SETTINGS.closeGap,
  };
}
