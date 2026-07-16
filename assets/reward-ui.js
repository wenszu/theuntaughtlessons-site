(function () {
  var DEFAULT_LEVELS = [
    { name: "Intern", threshold: 0 },
    { name: "Analyst", threshold: 300 },
    { name: "Associate", threshold: 800 },
    { name: "Principal", threshold: 1350 },
    { name: "Executive", threshold: 1850 }
  ];

  var activeTimers = {};
  var EXERCISE_REFLECTIONS = {
    "advisory-board": { prompt: "What would make this advisory board useful for a real decision?", choices: ["Choose advisors who will disagree for good reasons", "Give the board one specific decision to examine", "End the discussion with a decision and next step"] },
    "chalkboard-notes": { prompt: "Which move did the most to improve your chalkboard summary?", choices: ["Grouped related ideas before writing", "Separated the main point from supporting detail", "Put the points in an order the reader can follow"] },
    "eisenhower-matrix": { prompt: "What will you do differently when deciding what deserves your time?", choices: ["Separate urgency from importance", "Protect time for important work before it becomes urgent", "Decline or delegate work that does not need me"] },
    "explain-to-aiko-60": { prompt: "What made your 60-second explanation more effective?", choices: ["Led with the answer", "Kept only the evidence Aiko needed", "Ended with a clear recommendation or ask"] },
    "explain-to-aiko-120": { prompt: "What strengthened your longer explanation without making it feel long?", choices: ["Used a clear beginning, middle, and end", "Connected each detail to the main point", "Made the recommendation easy to act on"] },
    "grocery-list-ai": { prompt: "What did the AI comparison teach you about giving better instructions?", choices: ["Specific constraints improve the output", "A clear structure makes results easier to review", "AI still needs my judgment to check the answer"] },
    "grocery-list": { prompt: "What was the most useful lesson from organizing the grocery list?", choices: ["Categories should not overlap", "Together, the categories should cover everything", "A clean structure makes messy information usable"] },
    "i-have-bad-news": { prompt: "What will help you handle a difficult message with more confidence?", choices: ["State the issue directly without being harsh", "Acknowledge the impact on the other person", "Pair the message with a constructive next step"] },
    "issue-tree": { prompt: "What made your issue tree a stronger problem-solving tool?", choices: ["Started with one precise question", "Created branches that do not overlap", "Made sure the branches cover the whole problem"] },
    "lets-switch-hats": { prompt: "What changed when you looked at the situation from another perspective?", choices: ["I noticed an assumption I was making", "I understood what another person might value", "I found a response that works for more than one side"] },
    "messy-notes": { prompt: "What helped you find the signal in the manager’s messy notes?", choices: ["Identified the governing idea first", "Grouped details by the question they answer", "Removed information that did not support the message"] },
    "rushed-voice-memo-ai": { prompt: "What will you remember when using AI to structure an unclear update?", choices: ["Give AI the audience and purpose", "Ask for a specific communication structure", "Review the output for judgment, not just polish"] },
    "rushed-voice-memo": { prompt: "What made the rushed voice memo easier to understand?", choices: ["Named the main message early", "Organized the supporting points into groups", "Ended with the action the listener should take"] },
    "scqa-builder": { prompt: "Which part of SCQA did the most work in your message?", choices: ["The situation gave the reader enough context", "The complication showed why the issue matters now", "The question and answer focused the recommendation"] },
    "speak-like-obama": { prompt: "Which delivery choice made the biggest difference?", choices: ["Used pauses instead of rushing", "Varied emphasis around the key idea", "Kept a steady pace and finished strongly"] },
    "write-to-aiko": { prompt: "What made your written recommendation feel executive-ready?", choices: ["Put the answer before the explanation", "Used evidence selectively", "Made the requested decision or next step explicit"] }
  };

  function numberOr(value, fallback) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function exerciseReflectionFor(appId, supplied) {
    var fallback = EXERCISE_REFLECTIONS[appId] || {
      prompt: "What worked best in this exercise?",
      choices: ["Started with the main point", "Put the ideas in a useful order", "Made the next action specific"]
    };
    var saved = {};
    try {
      var settings = JSON.parse(localStorage.getItem("utl_reward_settings") || "{}");
      saved = settings.exerciseReflections && settings.exerciseReflections[appId] || {};
    } catch (error) {}
    var resolved = Object.assign({}, fallback, saved, supplied || {});
    resolved.choices = Array.isArray(resolved.choices) && resolved.choices.length === 3 ? resolved.choices : fallback.choices;
    return resolved;
  }

  function exerciseProgressSummary(appId) {
    var phaseByExercise = {
      "grocery-list": 1, "grocery-list-ai": 1, "messy-notes": 1, "rushed-voice-memo": 1, "rushed-voice-memo-ai": 1,
      "scqa-builder": 2, "issue-tree": 2, "write-to-aiko": 2, "explain-to-aiko-60": 2, "explain-to-aiko-120": 2,
      "eisenhower-matrix": 3, "advisory-board": 3, "i-have-bad-news": 3, "lets-switch-hats": 3, "speak-like-obama": 3
    };
    var phase = phaseByExercise[appId] || 1;
    var total = 6;
    var done = 0;
    try {
      for (var index = 1; index <= total; index += 1) {
        if (localStorage.getItem("utl_done_p" + phase + "-e" + index) === "true" || localStorage.getItem("utl_p" + phase + "_ex" + index + "_done") === "true") done += 1;
      }
    } catch (error) {}
    return { phase: phase, done: done, total: total };
  }

  function dailyMissionSummary() {
    try {
      var plan = JSON.parse(localStorage.getItem("utl_daily_mission_plan") || "null");
      if (!plan || !Array.isArray(plan.tasks)) return "";
      var done = plan.tasks.filter(function (task) {
        if (task.manual) return Boolean(task.complete);
        if (task.type === "Video") return localStorage.getItem("utl_lesson_watched_" + task.id) === "true";
        return (task.doneKeys || []).some(function (key) { return localStorage.getItem(key) === "true"; });
      }).length;
      return done + " of " + plan.tasks.length + " activities in today’s mission";
    } catch (error) { return ""; }
  }

  function levelsFrom(settings) {
    var cached = {};
    if (!settings) {
      try { cached = JSON.parse(localStorage.getItem("utl_reward_settings") || "{}"); } catch (error) {}
    }
    var resolved = settings || cached;
    var source = resolved && Array.isArray(resolved.levels) && resolved.levels.length ? resolved.levels : DEFAULT_LEVELS;
    return source.map(function (level) {
      return {
        name: level.name || "Level",
        threshold: Math.max(0, numberOr(level.threshold, 0))
      };
    }).sort(function (a, b) { return a.threshold - b.threshold; });
  }

  function getLevelForMp(mp, settings) {
    var total = Math.max(0, numberOr(mp, 0));
    var levels = levelsFrom(settings);
    var current = levels[0];
    var next = null;
    levels.forEach(function (level, index) {
      if (total >= level.threshold) {
        current = level;
        next = levels[index + 1] || null;
      }
    });
    return { current: current, next: next, levels: levels };
  }

  function normalizeState(state, settings) {
    var safe = state && typeof state === "object" ? state : {};
    var mp = Math.max(0, Math.round(numberOr(safe.mpTotal || safe.masteryPoints, 0)));
    var level = getLevelForMp(mp, settings);
    return {
      mpTotal: mp,
      masteryPoints: mp,
      tokens: Math.max(0, Math.round(numberOr(safe.tokens, 0))),
      streakDays: Math.max(0, Math.round(numberOr(safe.streakDays, 0))),
      streak: safe.streak && typeof safe.streak === "object" ? safe.streak : {},
      ledger: Array.isArray(safe.ledger) ? safe.ledger : [],
      level: level.current.name,
      currentThreshold: level.current.threshold,
      nextLevel: level.next ? level.next.name : "",
      nextThreshold: level.next ? level.next.threshold : null,
      mpToNext: level.next ? Math.max(0, level.next.threshold - mp) : 0
    };
  }

  function injectStyles() {
    if (document.getElementById("utl-reward-ui-styles")) return;
    var style = document.createElement("style");
    style.id = "utl-reward-ui-styles";
    style.textContent = [
      ".utl-reward-cluster{--reward-navy:#003366;--reward-gold:#EEA320;--reward-soft:#1F4F80;--reward-line:rgba(255,255,255,.18);display:flex;align-items:center;gap:8px;min-height:36px;padding:5px 6px;border:1px solid var(--reward-line);border-radius:12px;background:rgba(255,255,255,.08);color:#fff;box-shadow:inset 0 -1px 0 rgba(255,255,255,.07)}",
      ".utl-reward-item{position:relative;display:inline-flex;align-items:center;gap:7px;min-height:28px;border-radius:9px;padding:5px 9px;color:#fff;font:700 13px Lato,Arial,sans-serif;white-space:nowrap}",
      ".utl-reward-item.is-emphasis{background:rgba(255,255,255,.12);color:var(--reward-gold);font-family:Lato, Arial, sans-serif;letter-spacing: 0}",
      ".utl-reward-level{max-width:none;overflow:visible;color:rgba(255,255,255,.92)}.utl-reward-level>span:first-child{display:block;max-width:118px;overflow:hidden;text-overflow:ellipsis}",
      ".utl-reward-level strong{color:#fff}",
      ".utl-reward-icon{display:inline-flex;align-items:center;justify-content:center;min-width:16px;color:var(--reward-gold);line-height:1}",
      ".utl-reward-mp-number{display:inline-block;min-width:2ch;text-align:right;transition:transform .18s ease,color .18s ease}",
      ".utl-reward-cluster.is-counting .utl-reward-mp-number{color:#fff;transform:translateY(-1px) scale(1.08)}",
      ".utl-reward-cluster.is-finished .utl-reward-item.is-emphasis{animation:utlRewardPulse .52s ease}",
      ".utl-reward-popover{position:absolute;right:0;top:calc(100% + 12px);z-index:9990;width:300px;padding:16px 18px;border:1px solid rgba(238,163,32,.42);border-radius:12px;background:#fff;color:#4A4A4A;box-shadow:0 18px 48px rgba(0,51,102,.22);opacity:0;pointer-events:none;transform:translateY(-6px);transition:opacity .16s ease,transform .16s ease;white-space:normal}",
      ".utl-reward-item:hover .utl-reward-popover,.utl-reward-item:focus-within .utl-reward-popover{opacity:1;transform:translateY(0)}",
      ".utl-reward-popover span{display:block;margin-bottom:6px;color:var(--reward-gold);font:700 10px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none}",
      ".utl-reward-popover strong{display:block;color:var(--reward-navy);font:700 18px Lato,Arial,sans-serif;line-height:1.18}",
      ".utl-reward-popover p{margin:7px 0 0;color:#4D7094;font:700 13px/1.42 Lato,Arial,sans-serif}",
      ".utl-level-popover{left:0;right:auto;width:360px}.utl-level-track{display:grid!important;grid-template-columns:repeat(5,minmax(0,1fr));gap:0;margin:16px 0 0!important;padding:0;list-style:none}.utl-level-step{position:relative;display:grid;justify-items:center;align-content:start;gap:6px;text-align:center}.utl-level-step:before{content:'';position:absolute;left:-50%;right:50%;top:14px;height:3px;background:#D9E1E8}.utl-level-step:first-child:before{display:none}.utl-level-step.is-complete:before,.utl-level-step.is-current:before{background:#EEA320}.utl-level-dot{position:relative;z-index:1;width:30px;height:30px;border:2px solid #BCC9D5;border-radius:999px;background:#fff;color:#7890A8;display:grid!important;place-items:center;margin:0!important;font:700 10px Lato, Arial, sans-serif!important;letter-spacing:0!important}.utl-level-step.is-complete .utl-level-dot{border-color:#EEA320;background:#FFF2D3;color:#003366}.utl-level-step.is-current .utl-level-dot{border-color:#003366;background:#003366;color:#EEA320;box-shadow:0 0 0 4px rgba(238,163,32,.24)}.utl-level-name{margin:0!important;color:#7890A8!important;font:700 10px/1.2 Lato,Arial,sans-serif!important;letter-spacing:0!important;text-transform:none!important}.utl-level-step.is-complete .utl-level-name,.utl-level-step.is-current .utl-level-name{color:#003366!important}.utl-level-threshold{margin:0!important;color:#7890A8!important;font:400 9px/1.2 Lato, Arial, sans-serif!important;letter-spacing:0!important;text-transform:none!important}.utl-level-step.is-current .utl-level-threshold{color:#A86400!important;font-weight:700!important}.utl-level-guidance{margin-top:15px!important;padding:11px 12px;border-radius:8px;background:#FFF8EC;color:#003366!important;font:700 13px/1.4 Lato,Arial,sans-serif!important}",
      ".utl-reward-popover.utl-mp-breakdown{width:350px}.utl-mp-list{display:grid!important;gap:0;margin:12px 0 0!important;padding:0;list-style:none}.utl-mp-list li{display:grid;grid-template-columns:24px 1fr auto;gap:8px;align-items:start;padding:8px 0;border-bottom:1px solid rgba(0,51,102,.09)}.utl-mp-list li:last-child{border-bottom:0}.utl-mp-icon{margin:0!important;color:inherit!important;font:400 16px/1.2 sans-serif!important;letter-spacing:0!important;text-transform:none!important}.utl-mp-copy{margin:0!important;color:#003366!important;font:700 13px/1.25 Lato,Arial,sans-serif!important;letter-spacing:0!important;text-transform:none!important}.utl-mp-copy small{display:block;margin-top:2px;color:#4D7094;font:400 12px/1.3 Lato,Arial,sans-serif}.utl-mp-value{margin:0!important;color:#8A5A00!important;font:700 12px/1.3 Lato, Arial, sans-serif!important;letter-spacing:0!important;text-transform:none!important;white-space:nowrap}.utl-mp-meta{display:grid!important;gap:7px;margin:11px 0 0!important;padding-top:11px;border-top:1px solid rgba(238,163,32,.35)}.utl-mp-meta li{display:grid;grid-template-columns:24px 1fr;gap:8px;color:#4D7094;font:700 12px/1.35 Lato,Arial,sans-serif}.utl-mp-meta b{color:#003366}",
      ".utl-reward-toast{position:fixed;right:22px;top:76px;z-index:10000;width:min(340px,calc(100vw - 44px));padding:16px 18px;border:1px solid rgba(238,163,32,.46);border-radius:12px;background:#fff;color:#003366;box-shadow:0 18px 44px rgba(0,51,102,.22);opacity:0;transform:translateY(-10px);transition:opacity .18s ease,transform .18s ease}",
      ".utl-reward-toast.is-visible{opacity:1;transform:translateY(0)}",
      ".utl-reward-toast span{display:block;color:#EEA320;font:700 10px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none}",
      ".utl-reward-toast strong{display:block;margin-top:5px;color:#003366;font:700 18px Lato,Arial,sans-serif}",
      ".utl-reward-toast p{margin:6px 0 0;color:#4D7094;font:700 13px/1.4 Lato,Arial,sans-serif}",
      ".utl-reward-modal-backdrop{position:fixed;inset:0;z-index:10020;display:grid;place-items:center;padding:24px;background:rgba(0,30,60,.68);backdrop-filter:blur(5px)}",
      ".utl-reward-modal{position:relative;width:min(620px,100%);overflow:hidden;border:2px solid rgba(238,163,32,.82);border-radius:22px;background:radial-gradient(circle at 50% 0,rgba(255,224,156,.48),transparent 38%),linear-gradient(180deg,#fff 0%,#fffaf0 100%);padding:46px 46px 36px;text-align:center;box-shadow:0 32px 90px rgba(0,30,60,.48),0 0 0 8px rgba(238,163,32,.1);animation:utlRewardModalArrive .48s cubic-bezier(.2,.8,.2,1)}",
      ".utl-reward-celebration{position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(circle,#EEA320 0 3px,transparent 4px),radial-gradient(circle,#2C7A4B 0 2px,transparent 3px),radial-gradient(circle,#4D7094 0 2px,transparent 3px);background-position:8% 16%,91% 22%,16% 72%;background-size:74px 74px,92px 92px,66px 66px;opacity:.55;animation:utlRewardSparkle 1.8s ease-in-out infinite alternate}",
      ".utl-reward-streamers{position:absolute;inset:0;overflow:hidden;pointer-events:none}",
      ".utl-reward-streamer{position:absolute;top:-18%;left:var(--x);width:8px;height:54px;border-radius:999px;background:var(--color);opacity:0;transform:translate3d(0,-40px,0) rotate(var(--tilt));animation:utlRewardStreamerFall 5.8s var(--delay) cubic-bezier(.18,.65,.35,1) forwards}",
      ".utl-reward-burst{position:absolute;left:50%;top:91px;width:170px;height:170px;border-radius:999px;transform:translate(-50%,-50%) scale(.2);border:3px solid rgba(238,163,32,.5);box-shadow:0 0 0 12px rgba(238,163,32,.12),0 0 0 26px rgba(238,163,32,.06);opacity:0;animation:utlRewardBurst 1.25s .2s ease-out forwards;pointer-events:none}",
      ".utl-reward-modal-check{position:relative;width:82px;height:82px;margin:0 auto 18px;border:6px solid #fff;border-radius:999px;background:linear-gradient(145deg,#3C9563,#21653E);color:#fff;display:grid;place-items:center;font:700 44px/1 Lato,Arial,sans-serif;box-shadow:0 0 0 5px rgba(44,122,75,.15),0 14px 28px rgba(44,122,75,.24)}",
      ".utl-reward-modal-label{display:block;color:#EEA320;font:700 11px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none}",
      ".utl-reward-modal h2{position:relative;margin:9px 0 12px;color:#003366;font:700 52px/1.02 'Playfair Display',Georgia,serif}",
      ".utl-reward-modal p{position:relative;max-width:470px;margin:0 auto;color:#4A4A4A;font:700 17px/1.5 Lato,Arial,sans-serif}",
      ".utl-reward-modal-total{position:relative;display:inline-flex;margin-top:18px;padding:8px 13px;border:1px solid rgba(238,163,32,.45);border-radius:999px;background:#FFF1CF;color:#8A5A00;font:700 12px Lato, Arial, sans-serif;letter-spacing: 0}",
      ".utl-reward-modal h2.is-celebrating{animation:utlRewardTitleFlash .82s ease-in-out 6}",
      ".utl-reward-modal button{position:relative;margin-top:26px;min-height:48px;border:0;border-radius:9px;background:#003366;color:#fff;padding:0 26px;font:700 12px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none;cursor:pointer;box-shadow:none}",
      ".utl-exercise-award{width:min(640px,100%);border:1px solid rgba(0,51,102,.16);border-top:12px solid #EEA320;border-radius:10px;background:linear-gradient(115deg,#FFFDF8 0%,#FFFDF8 72%,#F3EDE2 72%,#F3EDE2 100%);padding:34px 42px 34px;text-align:left;box-shadow:0 30px 80px rgba(0,30,60,.38)}.utl-exercise-award:after{content:'DONE';position:absolute;right:28px;top:48px;color:rgba(0,51,102,.09);font:900 56px/1 Lato,Arial,sans-serif;transform:rotate(90deg);transform-origin:center;pointer-events:none}.utl-exercise-award.is-reflecting{border:2px solid rgba(238,163,32,.7);border-top-width:2px;background:#fff;padding:38px 42px;text-align:left;box-shadow:0 32px 90px rgba(0,30,60,.42)}.utl-exercise-award.is-reflecting:after{display:none}.utl-exercise-award .utl-award-stage[hidden]{display:none}.utl-exercise-award [data-award-stage=celebrate] .utl-reward-modal-check{width:76px;height:76px;margin:0 0 22px;border:5px solid #fff;border-radius:999px;background:#003366;color:#EEA320;transform:none;box-shadow:0 0 0 3px #EEA320,0 10px 22px rgba(0,51,102,.2);font-size:38px}.utl-exercise-award [data-award-stage=celebrate] .utl-reward-modal-label{color:#A86400;font-size:13px}.utl-exercise-award [data-award-stage=celebrate] h2{max-width:470px;margin:7px 0 10px;color:#003366;font:800 44px/1.04 Lato,Arial,sans-serif}.utl-exercise-award [data-award-stage=celebrate] p{max-width:470px;margin:0;color:#4A4A4A;font:700 16px/1.5 Lato,Arial,sans-serif}.utl-exercise-award [data-award-stage=celebrate] p strong{color:#003366}.utl-exercise-award [data-award-stage=celebrate]>button{background:#003366;color:#fff;box-shadow:0 5px 0 #001F3F}.utl-exercise-award .utl-award-earned{display:inline-flex;align-items:center;gap:7px;margin-top:18px;padding:9px 15px;border:1px solid rgba(238,163,32,.55);border-radius:999px;background:#FFF1CF;color:#8A5A00;font:800 15px Lato,Arial,sans-serif}.utl-exercise-award .utl-award-progress{margin-top:9px;color:#4D7094;font:700 13px Lato,Arial,sans-serif}",
      ".utl-exercise-award .utl-reflection-head{display:grid;grid-template-columns:48px 1fr;gap:13px;align-items:center;text-align:left}.utl-reflection-icon{width:48px;height:48px;border-radius:999px;background:#FFF1CF;color:#A86400;display:grid;place-items:center;font-size:23px}.utl-exercise-award .utl-reflection-head h2{margin:0;font-size:34px}.utl-exercise-award .utl-reflection-prompt{margin:22px 0 13px;text-align:left;color:#003366;font:700 17px/1.4 Lato,Arial,sans-serif}",
      ".utl-reflection-options{display:grid;gap:9px}.utl-reflection-option{width:100%;margin:0!important;min-height:48px!important;padding:11px 14px!important;border:1px solid rgba(0,51,102,.2)!important;border-radius:9px!important;background:#fff!important;color:#003366!important;text-align:left!important;box-shadow:none!important;font:700 14px/1.35 Lato,Arial,sans-serif!important}.utl-reflection-option:hover,.utl-reflection-option.is-selected{border-color:#EEA320!important;background:#FFF8EC!important;box-shadow:0 0 0 2px rgba(238,163,32,.16)!important}",
      ".utl-reflection-note{width:100%;min-height:76px;margin-top:11px;border:1px solid rgba(0,51,102,.2);border-radius:9px;padding:11px 12px;resize:vertical;color:#4A4A4A;font:400 14px/1.4 Lato,Arial,sans-serif}.utl-reflection-actions{display:flex;justify-content:space-between;align-items:center;gap:12px}.utl-reflection-actions button{margin-top:18px}.utl-reflection-skip{background:transparent!important;color:#4D7094!important;box-shadow:none!important;padding:0 8px!important}.utl-reflection-save:disabled{opacity:.48;cursor:not-allowed}",
      ".utl-takeaway-stage{text-align:center}.utl-takeaway-stage .utl-reflection-icon{margin:0 auto 16px}.utl-takeaway-stage h2{margin-top:8px}.utl-takeaway-stage p{max-width:480px;padding:18px 20px;border-left:4px solid #EEA320;border-radius:8px;background:#FFF8EC;color:#003366;font-size:18px}.utl-takeaway-continue{position:relative;display:inline-flex;align-items:center;justify-content:center;min-height:48px;margin-top:24px;border-radius:9px;background:#003366;color:#fff;padding:0 26px;text-decoration:none;font:700 13px Lato,Arial,sans-serif;box-shadow:none}",
      "@keyframes utlRewardPulse{0%{transform:translateY(0) scale(1)}45%{transform:translateY(-2px) scale(1.05)}100%{transform:translateY(0) scale(1)}}",
      "@keyframes utlRewardModalArrive{0%{opacity:0;transform:translateY(18px) scale(.92)}70%{transform:translateY(-3px) scale(1.015)}100%{opacity:1;transform:none}}",
      "@keyframes utlRewardSparkle{from{opacity:.35;transform:scale(.98)}to{opacity:.7;transform:scale(1.02)}}",
      "@keyframes utlRewardStreamerFall{0%{opacity:0;transform:translate3d(0,-45px,0) rotate(var(--tilt))}8%{opacity:1}60%{opacity:1}100%{opacity:0;transform:translate3d(var(--drift),650px,0) rotate(calc(var(--tilt) + 620deg))}}",
      "@keyframes utlRewardBurst{0%{opacity:0;transform:translate(-50%,-50%) scale(.2)}35%{opacity:1}100%{opacity:0;transform:translate(-50%,-50%) scale(1.35)}}",
      "@keyframes utlRewardTitleFlash{0%,100%{color:#003366;text-shadow:none;transform:scale(1)}50%{color:#A86400;text-shadow:0 0 18px rgba(238,163,32,.42),0 0 34px rgba(238,163,32,.22);transform:scale(1.055)}}",
      "@media(max-width:860px){.utl-reward-cluster{padding:4px;gap:4px}.utl-reward-level{display:none}.utl-reward-item{padding:5px 7px;font-size:12px}.utl-reward-popover{right:-74px;width:240px}}",
      "@media(max-width:620px){.utl-reward-cluster{display:flex;min-height:34px;padding:3px;border-radius:9px;background:rgba(255,255,255,.1)}.utl-reward-cluster>.utl-reward-item:not(.is-emphasis){display:none}.utl-reward-item.is-emphasis{min-height:28px;padding:4px 8px;font-size:11px}.utl-reward-item .utl-reward-popover{position:fixed;top:calc(env(safe-area-inset-top,0px) + 86px);right:12px;width:calc(100vw - 24px)}.utl-reward-toast{top:calc(env(safe-area-inset-top,0px) + 94px);right:12px;width:calc(100vw - 24px);padding:14px 16px;border-radius:10px}.utl-reward-toast strong{font-size:17px}.utl-reward-modal-backdrop{align-items:end;padding:16px;padding-bottom:calc(16px + env(safe-area-inset-bottom,0px))}.utl-reward-modal{max-height:calc(100svh - 32px);overflow:auto;padding:24px 20px 20px;border-radius:16px}.utl-reward-modal-check{width:54px;height:54px;font-size:30px}.utl-reward-modal h2{font-size:34px}.utl-reward-modal p{font-size:15px}.utl-reward-modal button{width:100%;min-height:46px}.utl-exercise-award .utl-reflection-head h2{font-size:28px}.utl-reflection-actions{display:grid}.utl-reflection-actions button{margin-top:8px}}",
      "@media(prefers-reduced-motion:reduce){.utl-reward-mp-number,.utl-reward-popover,.utl-reward-toast{transition:none!important}.utl-reward-cluster.is-finished .utl-reward-item.is-emphasis,.utl-reward-modal,.utl-reward-celebration,.utl-reward-modal h2.is-celebrating,.utl-reward-streamer,.utl-reward-burst{animation:none!important}.utl-reward-streamer,.utl-reward-burst{display:none}}"
    ].join("\n");
    document.head.appendChild(style);
  }

  function popoverHtml(label, title, body) {
    return '<span class="utl-reward-popover" role="tooltip"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(title) + '</strong><p>' + escapeHtml(body) + '</p></span>';
  }

  function mpPopoverHtml(title, rules, level) {
    var earningRows = rules.map(function (rule) {
      return '<li><span class="utl-mp-icon" aria-hidden="true">' + rule.icon + '</span><span class="utl-mp-copy">' + escapeHtml(rule.label) + (rule.note ? '<small>' + escapeHtml(rule.note) + '</small>' : '') + '</span><span class="utl-mp-value">' + escapeHtml(rule.value) + '</span></li>';
    }).join("");
    return '<span class="utl-reward-popover utl-mp-breakdown" role="tooltip"><span>Mastery Points</span><strong>' + escapeHtml(title) + '</strong><ul class="utl-mp-list">' + earningRows + '</ul><ul class="utl-mp-meta"><li><span class="utl-mp-icon" aria-hidden="true">&#127941;</span><span><b>Current level</b><br>' + escapeHtml(level) + '</span></li></ul></span>';
  }

  function levelPopoverHtml(state, settings) {
    var levels = levelsFrom(settings);
    var currentIndex = levels.findIndex(function (level) { return level.name === state.level; });
    var steps = levels.map(function (level, index) {
      var status = index < currentIndex ? "is-complete" : index === currentIndex ? "is-current" : "is-upcoming";
      var marker = index < currentIndex ? "&#10003;" : String(index + 1);
      return '<li class="utl-level-step ' + status + '"><span class="utl-level-dot">' + marker + '</span><span class="utl-level-name">' + escapeHtml(level.name) + '</span><span class="utl-level-threshold">' + level.threshold + ' MP</span></li>';
    }).join("");
    var article = /^[AEIOU]/i.test(state.nextLevel || "") ? "an" : "a";
    var guidance = state.nextLevel
      ? "You need " + state.mpToNext + " more MP to become " + article + " " + state.nextLevel + "!"
      : "You have reached the highest configured level!";
    return '<span class="utl-reward-popover utl-level-popover" role="tooltip"><span>Level progression</span><strong>' + escapeHtml(state.level) + '</strong><ul class="utl-level-track">' + steps + '</ul><p class="utl-level-guidance">' + escapeHtml(guidance) + '</p></span>';
  }

  function earnedMpBreakdown(ledger, mpTotal) {
    var categories = [
      { key: "scored", icon: "&#127919;", label: "Scored exercises", matches: function (type) { return type === "scored-exercise"; } },
      { key: "completion", icon: "&#9989;", label: "Completion exercises", matches: function (type) { return type === "completion-exercise"; } },
      { key: "reflection", icon: "&#128173;", label: "Reflections & external AI", matches: function (type) { return type === "reflection-exercise"; } },
      { key: "video", icon: "&#127916;", label: "Lesson videos", matches: function (type) { return type === "video-completed"; } },
      { key: "context", icon: "&#129517;", label: "Context items", matches: function (type) { return type === "context-completed"; } },
      { key: "milestone", icon: "&#127942;", label: "Milestones & assessments", matches: function (type) { return type === "phase-completed" || type === "program-completed" || type === "assessment-completed"; } },
      { key: "streak", icon: "&#128293;", label: "Streak bonuses", matches: function (type) { return type === "daily-streak"; } }
    ];
    var other = 0;
    (Array.isArray(ledger) ? ledger : []).forEach(function (entry) {
      var amount = Math.max(0, numberOr(entry && entry.mpEarned, 0));
      var type = String(entry && entry.type || "");
      var category = categories.filter(function (item) { return item.matches(type); })[0];
      if (category) category.total = numberOr(category.total, 0) + amount;
      else other += amount;
    });
    var ledgerTotal = categories.reduce(function (sum, item) { return sum + numberOr(item.total, 0); }, 0) + other;
    var recognized = Math.max(0, numberOr(mpTotal, 0) - ledgerTotal);
    other += recognized;
    if (other > 0) categories.push({ key: "other", icon: "&#10022;", label: "Other recognized progress", total: other });
    return categories.filter(function (item) { return numberOr(item.total, 0) > 0; })
      .sort(function (a, b) { return b.total - a.total; })
      .map(function (item) { return { icon: item.icon, label: item.label, value: item.total + " MP" }; });
  }

  function renderCluster(container, options) {
    if (!container) return null;
    injectStyles();
    var opts = options || {};
    var settings = opts.settings;
    if (!settings) {
      try { settings = JSON.parse(localStorage.getItem("utl_reward_settings") || "{}"); } catch (error) { settings = {}; }
    }
    var display = Object.assign({ showLevel: true, showMp: true, showStreak: true }, settings.display || {});
    var state = normalizeState(opts.state, settings);
    var now = new Date();
    var todayKey = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
    var todayActivities = state.streak.dailyActivities && state.streak.dailyActivities[todayKey] || {};
    var todayCount = Object.keys(todayActivities).length;
    var dailyGoal = Math.max(1, Math.round(numberOr(settings.streak && settings.streak.dailyExerciseGoal, 3)));
    var streakBody = todayCount >= dailyGoal
      ? "Today’s practice goal is complete. Return tomorrow to continue your streak."
      : todayCount + " of " + dailyGoal + " exercises completed today.";
    var mpRules = earnedMpBreakdown(state.ledger, state.mpTotal);
    if (!mpRules.length) mpRules = [{ icon: "&#10022;", label: "No MP earned yet", value: "0 MP" }];
    var nextLevelArticle = /^[AEIOU]/i.test(state.nextLevel || "") ? "an" : "a";
    var levelBody = state.nextLevel
      ? "You need " + state.mpToNext + " more MP to become " + nextLevelArticle + " " + state.nextLevel + "!"
      : "You are at the top configured level.";
    if (display.showMp === false) { container.innerHTML = ""; return null; }
    container.innerHTML = [
      '<div class="utl-reward-cluster" data-utl-reward-cluster>',
        display.showLevel ? '<span class="utl-reward-item utl-reward-level" tabindex="0">' : '',
        display.showLevel ? '<span>Level: <strong>' + escapeHtml(state.level) + '</strong></span>' : '',
        display.showLevel ? levelPopoverHtml(state, settings) : '',
        display.showLevel ? '</span>' : '',
        display.showStreak ? '<span class="utl-reward-item" tabindex="0">' : '',
        display.showStreak ? '<span class="utl-reward-icon" aria-hidden="true">&#128293;</span><span>' + state.streakDays + '</span>' : '',
        display.showStreak ? popoverHtml("Streak", state.streakDays + " day" + (state.streakDays === 1 ? "" : "s"), streakBody) : '',
        display.showStreak ? '</span>' : '',
        '<span class="utl-reward-item is-emphasis" tabindex="0">',
          '<span class="utl-reward-icon" aria-hidden="true">&#10022;</span><span class="utl-reward-mp-number" data-utl-mp-number>' + state.mpTotal + '</span><span>MP</span>',
          mpPopoverHtml(state.mpTotal + " MP earned", mpRules, state.level + ". " + levelBody),
        '</span>',
      '</div>'
    ].join("");
    return container.querySelector("[data-utl-reward-cluster]");
  }

  function showToast(details) {
    injectStyles();
    var existing = document.querySelector(".utl-reward-toast");
    if (existing) existing.remove();
    var toast = document.createElement("div");
    toast.className = "utl-reward-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.innerHTML =
      '<span>' + escapeHtml(details && details.label || "Reward") + '</span>' +
      '<strong>' + escapeHtml(details && details.title || "") + '</strong>' +
      '<p>' + escapeHtml(details && details.body || "") + '</p>';
    document.body.appendChild(toast);
    requestAnimationFrame(function () { toast.classList.add("is-visible"); });
    setTimeout(function () {
      toast.classList.remove("is-visible");
      setTimeout(function () { if (toast.parentNode) toast.remove(); }, 220);
    }, details && details.duration || 3600);
  }

  function animateMp(container, start, end, callback) {
    var cluster = container && container.querySelector ? container.querySelector("[data-utl-reward-cluster]") : null;
    var number = container && container.querySelector ? container.querySelector("[data-utl-mp-number]") : null;
    if (!number || start === end) {
      if (number) number.textContent = end;
      if (callback) callback();
      return;
    }
    var id = container.id || "default";
    if (activeTimers[id]) cancelAnimationFrame(activeTimers[id]);
    var from = Math.max(0, Math.round(numberOr(start, 0)));
    var to = Math.max(0, Math.round(numberOr(end, 0)));
    var duration = Math.min(1250, Math.max(520, Math.abs(to - from) * 24));
    var began = performance.now();
    if (cluster) cluster.classList.add("is-counting");
    function tick(now) {
      var progress = Math.min(1, (now - began) / duration);
      var eased = 1 - Math.pow(1 - progress, 3);
      number.textContent = Math.round(from + (to - from) * eased);
      if (progress < 1) {
        activeTimers[id] = requestAnimationFrame(tick);
        return;
      }
      number.textContent = to;
      if (cluster) {
        cluster.classList.remove("is-counting");
        cluster.classList.add("is-finished");
        setTimeout(function () { cluster.classList.remove("is-finished"); }, 650);
      }
      if (callback) callback();
    }
    activeTimers[id] = requestAnimationFrame(tick);
  }

  function showLevelModal(details) {
    injectStyles();
    var existing = document.querySelector(".utl-reward-modal-backdrop");
    if (existing) existing.remove();
    var modal = document.createElement("div");
    modal.className = "utl-reward-modal-backdrop";
    modal.innerHTML = [
      '<div class="utl-reward-modal" role="dialog" aria-modal="true" aria-label="Congratulations! You have been promoted!">',
        '<div class="utl-reward-celebration" aria-hidden="true"></div>',
        '<div class="utl-reward-burst" aria-hidden="true"></div>',
        '<div class="utl-reward-streamers" aria-hidden="true">',
          '<i class="utl-reward-streamer" style="--x:5%;--delay:.05s;--color:#EEA320;--tilt:18deg;--drift:65px"></i>',
          '<i class="utl-reward-streamer" style="--x:14%;--delay:.55s;--color:#2C7A4B;--tilt:-22deg;--drift:-42px"></i>',
          '<i class="utl-reward-streamer" style="--x:24%;--delay:.18s;--color:#4D7094;--tilt:32deg;--drift:48px"></i>',
          '<i class="utl-reward-streamer" style="--x:34%;--delay:.8s;--color:#F5C96D;--tilt:-12deg;--drift:-58px"></i>',
          '<i class="utl-reward-streamer" style="--x:45%;--delay:.34s;--color:#EEA320;--tilt:24deg;--drift:54px"></i>',
          '<i class="utl-reward-streamer" style="--x:56%;--delay:.68s;--color:#2C7A4B;--tilt:-30deg;--drift:-46px"></i>',
          '<i class="utl-reward-streamer" style="--x:66%;--delay:.12s;--color:#4D7094;--tilt:14deg;--drift:62px"></i>',
          '<i class="utl-reward-streamer" style="--x:76%;--delay:.92s;--color:#F5C96D;--tilt:-26deg;--drift:-52px"></i>',
          '<i class="utl-reward-streamer" style="--x:86%;--delay:.42s;--color:#EEA320;--tilt:36deg;--drift:38px"></i>',
          '<i class="utl-reward-streamer" style="--x:94%;--delay:.2s;--color:#2C7A4B;--tilt:-18deg;--drift:-66px"></i>',
        '</div>',
        '<div class="utl-reward-modal-check">&#10003;</div>',
        '<span class="utl-reward-modal-label">Congratulations! You have been promoted!</span>',
        '<h2 class="is-celebrating">' + escapeHtml(details && details.currentLevel || "New level") + '</h2>',
        '<p>You moved from ' + escapeHtml(details && details.previousLevel || "the previous level") + ' to ' + escapeHtml(details && details.currentLevel || "the next level") + ' after reaching ' + escapeHtml(details && details.newTotal || 0) + ' MP.</p>',
        '<span class="utl-reward-modal-total" data-utl-promotion-total>&#10022; ' + escapeHtml(details && details.startMp || 0) + ' MP total</span>',
        '<button type="button" data-utl-reward-close>Continue</button>',
      '</div>'
    ].join("");
    document.body.appendChild(modal);
    var total = modal.querySelector("[data-utl-promotion-total]");
    var startTotal = Math.max(0, Math.round(numberOr(details && details.startMp, 0)));
    var endTotal = Math.max(startTotal, Math.round(numberOr(details && details.newTotal, startTotal)));
    var startedAt = performance.now();
    var countDuration = 3200;
    function countPromotion(now) {
      if (!total || !total.isConnected) return;
      var progress = Math.min(1, (now - startedAt) / countDuration);
      var eased = 1 - Math.pow(1 - progress, 3);
      total.innerHTML = "&#10022; " + Math.round(startTotal + ((endTotal - startTotal) * eased)) + " MP total";
      if (progress < 1) requestAnimationFrame(countPromotion);
    }
    requestAnimationFrame(countPromotion);
    modal.addEventListener("click", function (event) {
      if (event.target === modal || event.target.closest("[data-utl-reward-close]")) modal.remove();
    });
  }

  function showExerciseAwardModal(details, onComplete) {
    injectStyles();
    var opts = details || {};
    var metadata = opts.metadata || {};
    var appId = metadata.appId || "exercise";
    var reflection = exerciseReflectionFor(appId, opts.reflection);
    var exerciseName = String(opts.title || "Exercise").replace(/\s+(complete|scored)$/i, "");
    var phaseProgress = exerciseProgressSummary(appId);
    var missionProgress = dailyMissionSummary();
    var existing = document.querySelector(".utl-reward-modal-backdrop");
    if (existing) existing.remove();
    var modal = document.createElement("div");
    modal.className = "utl-reward-modal-backdrop";
    modal.innerHTML = [
      '<div class="utl-reward-modal utl-exercise-award" role="dialog" aria-modal="true" aria-labelledby="utl-exercise-award-title">',
        '<section class="utl-award-stage" data-award-stage="celebrate">',
          '<div class="utl-reward-celebration" aria-hidden="true"></div>',
          '<div class="utl-reward-burst" aria-hidden="true"></div>',
          '<div class="utl-reward-streamers" aria-hidden="true"><i class="utl-reward-streamer" style="--x:10%;--delay:.05s;--color:#EEA320;--tilt:18deg;--drift:65px"></i><i class="utl-reward-streamer" style="--x:25%;--delay:.22s;--color:#2C7A4B;--tilt:-22deg;--drift:-42px"></i><i class="utl-reward-streamer" style="--x:42%;--delay:.12s;--color:#4D7094;--tilt:32deg;--drift:48px"></i><i class="utl-reward-streamer" style="--x:62%;--delay:.3s;--color:#F5C96D;--tilt:-12deg;--drift:-58px"></i><i class="utl-reward-streamer" style="--x:82%;--delay:.16s;--color:#EEA320;--tilt:24deg;--drift:54px"></i></div>',
          '<div class="utl-reward-modal-check">&#10003;</div>',
          '<span class="utl-reward-modal-label">Exercise complete</span>',
          '<h2 id="utl-exercise-award-title">Congratulations!</h2>',
          '<p>You finished <strong>' + escapeHtml(exerciseName) + '</strong>. Before you move on, note what worked.</p>',
          '<span class="utl-award-earned">&#10022; +' + Math.max(0, Math.round(numberOr(opts.mpEarned, 0))) + ' MP earned</span>',
          '<div class="utl-award-progress">' + Math.max(0, Math.round(numberOr(opts.newTotal, 0))) + ' MP total</div>',
          (phaseProgress.total ? '<div class="utl-award-progress">Phase ' + phaseProgress.phase + ': ' + phaseProgress.done + ' of ' + phaseProgress.total + ' exercises complete</div>' : ''),
          (missionProgress ? '<div class="utl-award-progress">' + escapeHtml(missionProgress) + '</div>' : ''),
          '<button type="button" data-award-reflect>Review what worked</button>',
        '</section>',
        '<section class="utl-award-stage" data-award-stage="reflect" hidden>',
          '<div class="utl-reflection-head"><span class="utl-reflection-icon" aria-hidden="true">&#128161;</span><div><span class="utl-reward-modal-label">Review your work</span><h2>What worked?</h2></div></div>',
          '<div class="utl-reflection-prompt">' + escapeHtml(reflection.prompt) + '</div>',
          '<div class="utl-reflection-options">' + reflection.choices.map(function (choice, index) { return '<button class="utl-reflection-option" type="button" data-reflection-choice="' + index + '">' + escapeHtml(choice) + '</button>'; }).join("") + '</div>',
          '<textarea class="utl-reflection-note" maxlength="300" placeholder="Optional: add a note in your own words"></textarea>',
          '<div class="utl-reflection-actions"><button class="utl-reflection-skip" type="button" data-reflection-skip>Skip for now</button><button class="utl-reflection-save" type="button" data-reflection-save disabled>Save reflection and continue</button></div>',
        '</section>',
        '<section class="utl-award-stage utl-takeaway-stage" data-award-stage="takeaway" hidden>',
          '<span class="utl-reflection-icon" aria-hidden="true">&#10022;</span>',
          '<span class="utl-reward-modal-label">Your takeaway</span>',
          '<h2>Keep this in mind</h2>',
          '<p data-reflection-takeaway>Use the main idea from this exercise in your next decision or conversation.</p>',
          '<a class="utl-takeaway-continue" href="../../member-login/index.html">Continue in your workspace &rarr;</a>',
        '</section>',
      '</div>'
    ].join("");
    document.body.appendChild(modal);
    var selectedChoice = "";
    var celebration = modal.querySelector('[data-award-stage="celebrate"]');
    var reflectionStage = modal.querySelector('[data-award-stage="reflect"]');
    var saveButton = modal.querySelector('[data-reflection-save]');
    var takeawayStage = modal.querySelector('[data-award-stage="takeaway"]');
    function finish() {
      modal.remove();
      if (typeof onComplete === "function") onComplete();
    }
    function showTakeaway(message) {
      modal.querySelector('.utl-exercise-award').classList.add('is-reflecting');
      celebration.hidden = true;
      reflectionStage.hidden = true;
      takeawayStage.hidden = false;
      modal.querySelector('[data-reflection-takeaway]').textContent = message || "Use the main idea from this exercise in your next decision or conversation.";
      modal.querySelector('.utl-takeaway-continue').focus();
    }
    modal.querySelector('[data-award-reflect]').addEventListener("click", function () {
      modal.querySelector('.utl-exercise-award').classList.add('is-reflecting');
      celebration.hidden = true;
      reflectionStage.hidden = false;
      var firstChoice = reflectionStage.querySelector('[data-reflection-choice]');
      if (firstChoice) firstChoice.focus();
    });
    modal.querySelectorAll('[data-reflection-choice]').forEach(function (button) {
      button.addEventListener("click", function () {
        modal.querySelectorAll('[data-reflection-choice]').forEach(function (item) { item.classList.remove("is-selected"); });
        button.classList.add("is-selected");
        selectedChoice = reflection.choices[Number(button.dataset.reflectionChoice)] || "";
        saveButton.disabled = !selectedChoice;
      });
    });
    saveButton.addEventListener("click", function () {
      window.dispatchEvent(new CustomEvent("utl:exercise-reflection", { detail: {
        appId: appId,
        prompt: reflection.prompt,
        choice: selectedChoice,
        note: modal.querySelector('.utl-reflection-note').value.trim()
      } }));
      showTakeaway(selectedChoice);
    });
    modal.querySelector('[data-reflection-skip]').addEventListener("click", function () { showTakeaway(""); });
  }

  function handleRewardMoment(details) {
    var opts = details || {};
    var container = opts.container || document.getElementById("wsRewardCluster") || document.querySelector("[data-utl-reward-mount]");
    var startMp = Math.max(0, Math.round(numberOr(opts.startMp, opts.newTotal || 0)));
    var newTotal = Math.max(0, Math.round(numberOr(opts.newTotal, startMp)));
    var metadata = opts.metadata || {};
    var isExercise = opts.type === "completion-exercise" || opts.type === "reflection-exercise" || (opts.type === "scored-exercise" && numberOr(metadata.previousBest, 0) === 0);
    if (isExercise) {
      if (container) animateMp(container, startMp, newTotal);
      showExerciseAwardModal(Object.assign({}, opts, { startMp: startMp, newTotal: newTotal }), function () {
        if (opts.showLevelModal) showLevelModal(opts);
      });
      return;
    }
    showToast({
      label: opts.label || "Reward",
      title: opts.title || ("+" + Math.max(0, newTotal - startMp) + " MP earned"),
      body: opts.body || "Your progress was saved."
    });
    if (container) {
      animateMp(container, startMp, newTotal, function () {
        if (opts.showLevelModal) showLevelModal(opts);
      });
    } else if (opts.showLevelModal) {
      showLevelModal(opts);
    }
  }

  window.UTLRewardUI = {
    DEFAULT_LEVELS: DEFAULT_LEVELS,
    getLevelForMp: getLevelForMp,
    normalizeState: normalizeState,
    renderCluster: renderCluster,
    showToast: showToast,
    animateMp: animateMp,
    showLevelModal: showLevelModal,
    showExerciseAwardModal: showExerciseAwardModal,
    EXERCISE_REFLECTIONS: EXERCISE_REFLECTIONS,
    exerciseReflectionFor: exerciseReflectionFor,
    handleRewardMoment: handleRewardMoment
  };
})();
