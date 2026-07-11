(function () {
  const REWARD_STATE_KEY = "utl_rewards_state";
  const REWARD_SETTINGS_KEY = "utl_reward_settings";
  const LEGACY_MP_KEY = "utl_demo_mp_total";
  const FIREBASE_URL = document.currentScript && document.currentScript.src
    ? new URL("firebase.js?v=20260710-reward-sync-1", document.currentScript.src).href
    : "";
  let syncTimer = null;
  const DEFAULT_LEVELS = [
    { title: "Intern", threshold: 0 },
    { title: "Analyst", threshold: 300 },
    { title: "Associate", threshold: 800 },
    { title: "Principal", threshold: 1350 },
    { title: "Executive", threshold: 1850 }
  ];
  const DEFAULT_SETTINGS = {
    enabled: true,
    levels: DEFAULT_LEVELS.map((level) => ({ name: level.title, threshold: level.threshold })),
    mp: {
      exerciseMode: "score-improvement",
      exerciseCompleteFallback: 50,
      reflectionExercise: 30,
      videoComplete: 10,
      contextComplete: 5,
      assessmentBonus: 100
    },
    streak: {
      enabled: true,
      dailyExerciseGoal: 3,
      mpBase: 5
    }
  };

  function readSettings() {
    let stored = {};
    try {
      stored = JSON.parse(localStorage.getItem(REWARD_SETTINGS_KEY) || "{}");
    } catch (error) {
      stored = {};
    }
    return {
      enabled: stored.enabled !== false,
      display: { showLevel: true, showMp: true, showStreak: true, showTokens: false, ...(stored.display || {}) },
      levels: Array.isArray(stored.levels) && stored.levels.length ? stored.levels : DEFAULT_SETTINGS.levels,
      mp: { ...DEFAULT_SETTINGS.mp, ...(stored.mp || {}) },
      streak: { ...DEFAULT_SETTINGS.streak, ...(stored.streak || {}) },
      tokens: { enabled: false, ...(stored.tokens || {}) }
    };
  }

  function writeSettings(settings) {
    const normalized = settings && typeof settings === "object" ? settings : {};
    localStorage.setItem(REWARD_SETTINGS_KEY, JSON.stringify(normalized));
    refreshRewardCluster(readState());
    return readSettings();
  }

  function numberOr(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clampScore(score) {
    return Math.max(0, Math.min(100, Math.round(numberOr(score, 0))));
  }

  function localDateString(date) {
    const value = date instanceof Date ? date : new Date();
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function addDays(dateString, amount) {
    const [year, month, day] = String(dateString || "").split("-").map(Number);
    if (!year || !month || !day) return "";
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + amount);
    return localDateString(date);
  }

  function getLevelForMp(mp) {
    const points = Math.max(0, numberOr(mp, 0));
    const levels = readSettings().levels.map((level) => ({
      title: level.title || level.name || "Level",
      threshold: Math.max(0, numberOr(level.threshold, 0))
    })).sort((a, b) => a.threshold - b.threshold);
    return levels.reduce((current, level) => {
      return points >= level.threshold ? level : current;
    }, levels[0] || DEFAULT_LEVELS[0]);
  }

  function normalizeState(raw) {
    const legacyMp = numberOr(localStorage.getItem(LEGACY_MP_KEY), NaN);
    const mpTotal = Math.max(0, numberOr(raw && (raw.masteryPoints ?? raw.mpTotal), Number.isFinite(legacyMp) ? legacyMp : 0));
    const ledger = Array.isArray(raw && raw.ledger) ? raw.ledger : [];
    const earnedEventIds = {
      ...((raw && raw.earnedEvents && typeof raw.earnedEvents === "object") ? raw.earnedEvents : {}),
      ...((raw && raw.earnedEventIds && typeof raw.earnedEventIds === "object") ? raw.earnedEventIds : {})
    };
    const streak = raw && raw.streak && typeof raw.streak === "object" ? raw.streak : {};
    return {
      ...(raw || {}),
      mpTotal,
      masteryPoints: mpTotal,
      level: getLevelForMp(mpTotal),
      streakDays: Math.max(0, numberOr(raw && raw.streakDays, numberOr(streak.currentDays, 0))),
      tokens: Math.max(0, numberOr(raw && raw.tokens, 0)),
      ledger,
      earnedEventIds,
      earnedEvents: earnedEventIds,
      streak: {
        currentDays: Math.max(0, numberOr(streak.currentDays, numberOr(raw && raw.streakDays, 0))),
        lastQualifiedDate: streak.lastQualifiedDate || "",
        dailyActivities: streak.dailyActivities && typeof streak.dailyActivities === "object" ? streak.dailyActivities : {},
        awardedDates: streak.awardedDates && typeof streak.awardedDates === "object" ? streak.awardedDates : {}
      }
    };
  }

  function readState() {
    try {
      return normalizeState(JSON.parse(localStorage.getItem(REWARD_STATE_KEY) || "{}"));
    } catch (error) {
      return normalizeState({});
    }
  }

  function writeState(state) {
    const normalized = normalizeState(state);
    localStorage.setItem(REWARD_STATE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function queueRemoteSync(state) {
    if (!FIREBASE_URL) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      import(FIREBASE_URL)
        .then((firebase) => firebase.saveMemberRewards ? firebase.saveMemberRewards(state) : null)
        .catch((error) => console.warn("Reward sync deferred until the next signed-in page.", error));
    }, 80);
  }

  function findRewardMount() {
    return document.querySelector("[data-utl-reward-mount]") ||
      document.querySelector(".utl-app-reward-mount") ||
      document.querySelector(".header-gamification-cluster");
  }

  function refreshRewardCluster(state) {
    const mount = findRewardMount();
    if (mount && window.UTLRewardUI && typeof window.UTLRewardUI.renderCluster === "function" && !mount.classList.contains("header-gamification-cluster")) {
      window.UTLRewardUI.renderCluster(mount, { state });
    }
    return mount;
  }

  function dispatchUpdate(state, detail) {
    window.dispatchEvent(new CustomEvent("utl:reward-update", {
      detail: { state, reward: detail || null }
    }));
  }

  function showRewardMoment(detail, previousState, nextState) {
    const mount = refreshRewardCluster(previousState);
    if (window.UTLRewardUI && typeof window.UTLRewardUI.handleRewardMoment === "function") {
      window.UTLRewardUI.handleRewardMoment({
        container: mount,
        startMp: previousState.mpTotal,
        newTotal: nextState.mpTotal,
        endMp: nextState.mpTotal,
        mpEarned: detail.mpEarned,
        title: detail.title,
        body: detail.body,
        type: detail.type,
        levelBefore: getLevelForMp(previousState.mpTotal),
        levelAfter: getLevelForMp(nextState.mpTotal),
        previousLevel: getLevelForMp(previousState.mpTotal).title,
        currentLevel: getLevelForMp(nextState.mpTotal).title,
        showLevelModal: getLevelForMp(previousState.mpTotal).title !== getLevelForMp(nextState.mpTotal).title
      });
    } else if (!document.querySelector("script[data-utl-reward-ui-loader]")) {
      const script = document.createElement("script");
      script.src = "../../assets/reward-ui.js?v=20260710-rewards-ui-5";
      script.defer = true;
      script.dataset.utlRewardUiLoader = "true";
      script.addEventListener("load", () => showRewardMoment(detail, previousState, nextState), { once: true });
      document.head.appendChild(script);
    } else if (window.UTLRewardUI && typeof window.UTLRewardUI.showToast === "function") {
      window.UTLRewardUI.showToast(detail);
    }
    dispatchUpdate(nextState, detail);
  }

  function awardEvent(event) {
    const eventId = event && event.eventId;
    if (!eventId) return { awarded: false, reason: "missing-event-id", state: readState() };
    if (readSettings().enabled === false) return { awarded: false, reason: "rewards-disabled", state: readState() };

    const previousState = readState();
    if (previousState.earnedEventIds[eventId]) {
      return { awarded: false, reason: "already-awarded", state: previousState };
    }

    const mpEarned = Math.max(0, Math.round(numberOr(event.mpEarned, 0)));
    const nextState = normalizeState({
      ...previousState,
      mpTotal: previousState.mpTotal + mpEarned,
      masteryPoints: previousState.mpTotal + mpEarned,
      earnedEventIds: {
        ...previousState.earnedEventIds,
        [eventId]: true
      },
      ledger: [
        ...previousState.ledger,
        {
          id: eventId,
          type: event.type || "reward",
          title: event.title || "Reward earned",
          mpEarned,
          oldTotal: previousState.mpTotal,
          newTotal: previousState.mpTotal + mpEarned,
          levelBefore: getLevelForMp(previousState.mpTotal).title,
          levelAfter: getLevelForMp(previousState.mpTotal + mpEarned).title,
          earnedAt: new Date().toISOString(),
          metadata: event.metadata || {}
        }
      ].slice(-500)
    });
    writeState(nextState);
    queueRemoteSync(nextState);

    if (mpEarned > 0 || event.showZero) {
      showRewardMoment({
        type: event.type || "reward",
        title: event.title || "Reward earned",
        body: event.body || "Your progress was saved.",
        mpEarned
      }, previousState, nextState);
    } else {
      refreshRewardCluster(nextState);
      dispatchUpdate(nextState, event);
    }

    return { awarded: true, mpEarned, previousState, state: nextState };
  }

  function recordPracticeActivity(appId, options) {
    if (readSettings().enabled === false) return { awarded: false, reason: "rewards-disabled" };
    const settings = readSettings().streak;
    if (!settings.enabled || !appId) return { awarded: false, reason: "streak-disabled-or-missing-app" };

    const dateString = options && options.localDate ? options.localDate : localDateString(options && options.date);
    const previousState = readState();
    const dailyActivities = {
      ...(previousState.streak.dailyActivities || {})
    };
    const todayActivities = {
      ...(dailyActivities[dateString] || {})
    };
    todayActivities[appId] = true;
    dailyActivities[dateString] = todayActivities;

    let nextState = normalizeState({
      ...previousState,
      streak: {
        ...previousState.streak,
        dailyActivities
      }
    });
    writeState(nextState);

    const uniqueCount = Object.keys(todayActivities).length;
    if (uniqueCount < settings.dailyExerciseGoal || nextState.streak.awardedDates[dateString]) {
      return { awarded: false, reason: "daily-goal-not-met", count: uniqueCount, state: nextState };
    }

    const yesterday = addDays(dateString, -1);
    const previousQualified = nextState.streak.lastQualifiedDate;
    const currentDays = previousQualified === yesterday ? nextState.streak.currentDays + 1 : 1;
    const mpEarned = settings.mpBase * currentDays;
    nextState = normalizeState({
      ...nextState,
      streakDays: currentDays,
      streak: {
        ...nextState.streak,
        currentDays,
        lastQualifiedDate: dateString,
        awardedDates: {
          ...nextState.streak.awardedDates,
          [dateString]: true
        }
      }
    });
    writeState(nextState);

    return awardEvent({
      eventId: `daily-streak:${dateString}`,
      type: "daily-streak",
      title: `Daily streak +${mpEarned} MP`,
      body: currentDays === 1
        ? "You hit today's practice goal!"
        : `You practiced ${currentDays} days in a row!`,
      mpEarned,
      metadata: { dateString, currentDays, dailyExerciseGoal: settings.dailyExerciseGoal }
    });
  }

  function awardScoredExercise(options) {
    if (readSettings().enabled === false) return { awarded: false, reason: "rewards-disabled", state: readState() };
    const appId = options && options.appId;
    if (!appId) return { awarded: false, reason: "missing-app-id" };
    const score = clampScore(options.score);
    const bestKey = `utl_reward_best_score_${appId}`;
    const settings = readSettings();
    const legacyRewarded = Boolean(readState().earnedEventIds[`legacy-exercise:${appId}`]);
    const migratedBaseline = legacyRewarded ? clampScore(settings.mp.exerciseCompleteFallback || 0) : 0;
    const previousBest = Math.max(migratedBaseline, clampScore(localStorage.getItem(bestKey) || 0));
    const improvement = Math.max(0, score - previousBest);
    const mode = settings.mp.exerciseMode || "score-improvement";
    if (legacyRewarded && (mode === "fixed" || mode === "score-total")) {
      return { awarded: false, reason: "already-awarded", state: readState() };
    }
    if (score > previousBest) localStorage.setItem(bestKey, String(score));
    const isOneTime = mode === "fixed" || mode === "score-total";
    const mpEarned = mode === "fixed"
      ? Math.max(0, numberOr(settings.mp.exerciseCompleteFallback, 0))
      : mode === "score-total"
        ? (previousBest > 0 ? 0 : score)
        : improvement;
    const result = awardEvent({
      eventId: isOneTime ? `scored-exercise:${appId}` : `scored-exercise:${appId}:best-${score}`,
      type: "scored-exercise",
      title: options.title || "Exercise scored",
      body: improvement > 0
        ? `Score improved from ${previousBest} to ${score}.`
        : `Score saved at ${score}.`,
      mpEarned,
      showZero: false,
      metadata: { appId, score, previousBest, mode }
    });
    recordPracticeActivity(appId, options);
    return result;
  }

  function awardCompletionExercise(options) {
    if (readSettings().enabled === false) return { awarded: false, reason: "rewards-disabled", state: readState() };
    const appId = options && options.appId;
    if (!appId) return { awarded: false, reason: "missing-app-id" };
    if (readState().earnedEventIds[`legacy-exercise:${appId}`]) {
      return { awarded: false, reason: "already-awarded", state: readState() };
    }
    const result = awardEvent({
      eventId: `completion-exercise:${appId}`,
      type: "completion-exercise",
      title: options.title || "Exercise complete",
      body: options.body || "Progress saved.",
      mpEarned: options.mpEarned == null ? readSettings().mp.exerciseCompleteFallback : options.mpEarned,
      metadata: { appId }
    });
    if (result.awarded) recordPracticeActivity(appId, options);
    return result;
  }

  function awardReflectionExercise(options) {
    if (readSettings().enabled === false) return { awarded: false, reason: "rewards-disabled", state: readState() };
    const appId = options && options.appId;
    if (!appId) return { awarded: false, reason: "missing-app-id" };
    if (readState().earnedEventIds[`legacy-exercise:${appId}`]) {
      return { awarded: false, reason: "already-awarded", state: readState() };
    }
    const result = awardEvent({
      eventId: `reflection-exercise:${appId}`,
      type: "reflection-exercise",
      title: options.title || "Reflection saved",
      body: options.body || "Your thinking was saved.",
      mpEarned: options.mpEarned == null ? readSettings().mp.reflectionExercise : options.mpEarned,
      metadata: { appId }
    });
    if (result.awarded) recordPracticeActivity(appId, options);
    return result;
  }

  function awardAssessment(options) {
    if (readSettings().enabled === false) return { awarded: false, reason: "rewards-disabled", state: readState() };
    const assessmentId = options && options.assessmentId;
    if (!assessmentId) return { awarded: false, reason: "missing-assessment-id" };
    return awardEvent({
      eventId: `assessment-completed:${assessmentId}`,
      type: "assessment-completed",
      title: options.title || "Assessment complete",
      body: options.body || "Your assessment results were saved.",
      mpEarned: options.mpEarned == null ? readSettings().mp.assessmentBonus : options.mpEarned,
      metadata: { assessmentId }
    });
  }

  window.UTLRewardEvents = {
    readState,
    writeState,
    readSettings,
    writeSettings,
    awardEvent,
    awardScoredExercise,
    awardCompletionExercise,
    awardReflectionExercise,
    awardAssessment,
    recordPracticeActivity,
    localDateString,
    _test: {
      normalizeState,
      getLevelForMp,
      addDays,
      clampScore
    }
  };

  if (window.addEventListener) {
    window.addEventListener("storage", (event) => {
      if (event.key === REWARD_STATE_KEY) refreshRewardCluster(readState());
      if (event.key === REWARD_SETTINGS_KEY) refreshRewardCluster(readState());
    });
  }
})();
