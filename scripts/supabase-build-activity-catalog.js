#!/usr/bin/env node
"use strict";

// Builds supabase/seed/activities.json from the site content. The catalog is the list of
// activities (orientation, contexts, lessons, exercises, assessments) and the alternate keys
// that site code and Firestore use for them. Rerun it whenever member-login/content-config.js
// or exerciseProgressIds in assets/firebase.js changes, then review the diff.
//
// Usage: node scripts/supabase-build-activity-catalog.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const OUT = path.join(root, "supabase", "seed", "activities.json");
const PROGRAM_ID = "tsa";

// Takes the object literal assigned to `const <name> = {` and evaluates it on its own.
function extractObjectLiteral(source, name) {
  const start = source.indexOf(`const ${name} = {`);
  if (start < 0) throw new Error(`${name} not found`);
  let i = source.indexOf("{", start);
  let depth = 0;
  let inString = null;
  for (; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (ch === "\\") i += 1;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") inString = ch;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const literal = source.slice(source.indexOf("{", start), i + 1);
  return vm.runInNewContext(`(${literal})`, {});
}

function build() {
  const content = extractObjectLiteral(fs.readFileSync(path.join(root, "member-login", "content-config.js"), "utf8"), "UTL_CONTENT");
  const appKeyMap = extractObjectLiteral(fs.readFileSync(path.join(root, "assets", "firebase.js"), "utf8"), "exerciseProgressIds");

  const activities = [];
  const keys = [];
  const seen = new Set();
  let sort = 10;
  const add = (activity) => {
    if (seen.has(activity.id)) throw new Error(`duplicate activity id ${activity.id}`);
    seen.add(activity.id);
    activities.push(Object.assign({ program_id: PROGRAM_ID, status: "active", sort_order: sort }, activity));
    sort += 10;
  };
  const addKey = (key, activityId) => {
    if (!key || key === activityId) return;
    if (keys.some((k) => k.key === key)) return;
    keys.push({ key, activity_id: activityId });
  };

  // Orientation and its contexts. Progress stores orientation.ready and contexts[<context id>].
  add({ id: "orientation", kind: "orientation", title: "Orientation", module_key: "orientation", config: { videoUrl: content.orientation.videoUrl || "" } });
  (content.orientation.contexts || []).forEach((context) => {
    add({ id: context.id, kind: "context", title: context.contextTitle || context.id, module_key: "orientation", config: { contextType: context.contextType || "" } });
  });

  ["phase1", "phase2", "phase3"].forEach((phaseKey, index) => {
    const phase = content[phaseKey];
    const moduleKey = `phase-${index + 1}`;
    (phase.lessons || []).forEach((lesson) => {
      add({ id: lesson.id, kind: "lesson", title: lesson.title, module_key: moduleKey, config: { duration: lesson.duration || "", videoUrl: lesson.videoUrl || "" } });
    });
    (phase.introContexts || []).forEach((context) => {
      add({ id: context.id, kind: "context", title: context.contextTitle || context.id, module_key: moduleKey, config: { contextType: context.contextType || "" } });
    });
    (phase.exercises || []).forEach((exercise) => {
      const appKey = String(exercise.appUrl || "").match(/\/apps\/([^/]+)/);
      add({
        id: exercise.id,
        kind: "exercise",
        title: exercise.title,
        module_key: moduleKey,
        config: {
          estimatedMinutes: Number(exercise.estimatedMinutes || 0),
          type: exercise.type || "",
          appUrl: exercise.appUrl || "",
          appKey: appKey ? appKey[1] : ""
        }
      });
      if (appKey) addKey(appKey[1], exercise.id);
      // Each exercise has an intro context that progress stores under the exercise id.
      if (exercise.contextTitle || exercise.contextUrl) {
        add({ id: `${exercise.id}-context`, kind: "context", title: exercise.contextTitle || `${exercise.title} context`, module_key: moduleKey, config: { contextType: exercise.contextType || "", forExercise: exercise.id } });
      }
    });
  });

  // The TSA diagnostic and checkpoint show up in progress as exercises with these keys.
  add({ id: "tsa-diagnostic", kind: "assessment", title: "TSA diagnostic", module_key: "assessment", config: {} });
  add({ id: "tsa-checkpoint", kind: "assessment", title: "TSA checkpoint", module_key: "assessment", config: {} });
  addKey("tsa-diagnostic-v2", "tsa-diagnostic");
  addKey("tsa-checkpoint-v2", "tsa-checkpoint");
  // Section scores of the TSA assessment and the public Find Your Level flow are saved as completed
  // exercises in Firestore under these ids.
  add({ id: "tsa-sort-score", kind: "assessment", title: "TSA section: Sort", module_key: "assessment", config: { section: "sort" } });
  add({ id: "tsa-spot-score", kind: "assessment", title: "TSA section: Spot", module_key: "assessment", config: { section: "spot" } });
  add({ id: "tsa-speak-score", kind: "assessment", title: "TSA section: Speak", module_key: "assessment", config: { section: "speak" } });
  add({ id: "find-your-level", kind: "assessment", title: "Find Your Level", module_key: "assessment", config: {} });
  addKey("tsa_sort_score", "tsa-sort-score");
  addKey("tsa_spot_score", "tsa-spot-score");
  addKey("tsa_speak_score", "tsa-speak-score");

  // Content that members have progress against but that is no longer in site code (found by the
  // 2026-10-06 dry run). Kept as retired activities so their history is imported, not dropped.
  [
    { id: "p1-welcome-ma", kind: "context", title: "Retired: phase 1 welcome", module_key: "phase-1" },
    { id: "p2-recap", kind: "context", title: "Retired: phase 2 recap", module_key: "phase-2" },
    { id: "p3-recap", kind: "context", title: "Retired: phase 3 recap", module_key: "phase-3" },
    { id: "p2-l2", kind: "lesson", title: "Retired: phase 2 lesson 2", module_key: "phase-2" },
    { id: "p2-l4", kind: "lesson", title: "Retired: phase 2 lesson 4", module_key: "phase-2" }
  ].forEach((legacy) => add(Object.assign({ status: "retired", config: { retired: true } }, legacy)));
  // Progress also records the assessment results under these local-storage style keys.
  addKey("utl_result_tsa_diagnostic", "tsa-diagnostic");
  addKey("utl_result_tsa_checkpoint", "tsa-checkpoint");

  // App keys from site code. Every target must exist in the catalog.
  Object.entries(appKeyMap).forEach(([key, activityId]) => {
    if (!seen.has(activityId)) throw new Error(`exerciseProgressIds points ${key} at unknown activity ${activityId}`);
    addKey(key, activityId);
  });

  return { generatedFrom: ["member-login/content-config.js", "assets/firebase.js"], activities, keys };
}

if (require.main === module) {
  const catalog = build();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(catalog, null, 2) + "\n");
  console.log(`${catalog.activities.length} activities, ${catalog.keys.length} keys written to ${path.relative(root, OUT)}`);
}

module.exports = { build, extractObjectLiteral };
