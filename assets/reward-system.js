(function () {
  const DEFAULT_REWARD_SETTINGS = {
    enabled: true,
    levels: [
      { name: "Intern", threshold: 0 },
      { name: "Analyst", threshold: 300 },
      { name: "Associate", threshold: 800 },
      { name: "Principal", threshold: 1350 },
      { name: "Executive", threshold: 1850 }
    ],
    mp: {
      videoComplete: 10,
      contextComplete: 5,
      exerciseMode: "score-improvement",
      exerciseCompleteFallback: 50,
      reflectionExercise: 30,
      phaseCompletion: { phase1: 100, phase2: 150, phase3: 200 },
      assessmentBonus: 100
    },
    streak: {
      enabled: true,
      dailyExerciseGoal: 3,
      mpBase: 5,
      mpFormula: "base*n"
    },
    tokens: { enabled: false, hintCost: 1 }
  };

  function numberOr(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeSettings(settings) {
    const stored = settings || {};
    const def = DEFAULT_REWARD_SETTINGS;
    return {
      enabled: stored.enabled !== false,
      levels: Array.isArray(stored.levels) && stored.levels.length
        ? stored.levels.map((level) => ({
            name: level.name || "Level",
            threshold: Math.max(0, numberOr(level.threshold, 0))
          })).sort((a, b) => a.threshold - b.threshold)
        : def.levels.map((level) => ({ ...level })),
      mp: Object.assign({}, def.mp, stored.mp || {}, {
        phaseCompletion: Object.assign({}, def.mp.phaseCompletion, (stored.mp && stored.mp.phaseCompletion) || {})
      }),
      streak: Object.assign({}, def.streak, stored.streak || {}),
      tokens: Object.assign({}, def.tokens, stored.tokens || {})
    };
  }

  function getLevelForMp(mp, settings) {
    const normalized = normalizeSettings(settings);
    const total = Math.max(0, numberOr(mp, 0));
    let current = normalized.levels[0];
    let next = null;
    normalized.levels.forEach((level, index) => {
      if (total >= level.threshold) {
        current = level;
        next = normalized.levels[index + 1] || null;
      }
    });
    return { current, next };
  }

  function mpToNextLevel(mp, settings) {
    const total = Math.max(0, numberOr(mp, 0));
    const level = getLevelForMp(total, settings);
    return level.next ? Math.max(0, level.next.threshold - total) : 0;
  }

  function calculateEventMp(event, settings) {
    const normalized = normalizeSettings(settings);
    if (normalized.enabled === false) return 0;
    const type = event && event.type;
    if (type === "video-completed") return Math.max(0, numberOr(normalized.mp.videoComplete, 0));
    if (type === "context-completed") return Math.max(0, numberOr(normalized.mp.contextComplete, 0));
    if (type === "completion-exercise") return Math.max(0, numberOr(normalized.mp.exerciseCompleteFallback, 0));
    if (type === "reflection-exercise") return Math.max(0, numberOr(normalized.mp.reflectionExercise, 0));
    if (type === "assessment-completed") return Math.max(0, numberOr(normalized.mp.assessmentBonus, 0));
    if (type === "phase-completed") {
      const phaseKey = event.phase || "phase1";
      return Math.max(0, numberOr(normalized.mp.phaseCompletion[phaseKey], 0));
    }
    if (type === "daily-streak") {
      if (normalized.streak.enabled === false) return 0;
      const day = Math.max(1, Math.round(numberOr(event.streakDay, 1)));
      const base = Math.max(0, numberOr(normalized.streak.mpBase, 0));
      return base * day;
    }
    if (type === "scored-exercise") {
      const score = Math.max(0, Math.min(100, numberOr(event.score, 0)));
      const previousBest = Math.max(0, Math.min(100, numberOr(event.previousBest, 0)));
      if (normalized.mp.exerciseMode === "fixed") {
        return Math.max(0, numberOr(normalized.mp.exerciseCompleteFallback, 0));
      }
      if (normalized.mp.exerciseMode === "score-total") return previousBest > 0 ? 0 : score;
      return Math.max(0, score - previousBest);
    }
    return 0;
  }

  function simulateRewardEvent(event, settings) {
    const normalized = normalizeSettings(settings);
    const startMp = Math.max(0, Math.round(numberOr(event && event.startMp, 0)));
    const mpEarned = Math.max(0, Math.round(calculateEventMp(event || {}, normalized)));
    const newTotal = startMp + mpEarned;
    const before = getLevelForMp(startMp, normalized);
    const after = getLevelForMp(newTotal, normalized);
    const levelUp = before.current.name !== after.current.name;
    const showDailyPopup = (event && event.type) === "daily-streak" && mpEarned > 0;
    const showLevelModal = levelUp;
    return {
      mpEarned,
      startMp,
      newTotal,
      previousLevel: before.current.name,
      currentLevel: after.current.name,
      nextLevel: after.next ? after.next.name : "",
      mpToNext: mpToNextLevel(newTotal, normalized),
      levelUp,
      showDailyPopup,
      showLevelModal,
      settings: normalized
    };
  }

  window.UTLRewardSystem = {
    DEFAULT_REWARD_SETTINGS,
    normalizeSettings,
    getLevelForMp,
    mpToNextLevel,
    calculateEventMp,
    simulateRewardEvent
  };
})();
