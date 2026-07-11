(function () {
  var DEFAULT_LEVELS = [
    { name: "Intern", threshold: 0 },
    { name: "Analyst", threshold: 300 },
    { name: "Associate", threshold: 800 },
    { name: "Principal", threshold: 1350 },
    { name: "Executive", threshold: 1850 }
  ];

  var activeTimers = {};

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
      ".utl-reward-item.is-emphasis{background:rgba(255,255,255,.12);color:var(--reward-gold);font-family:'Roboto Mono',monospace;letter-spacing:.02em}",
      ".utl-reward-level{max-width:118px;overflow:hidden;text-overflow:ellipsis;color:rgba(255,255,255,.92)}",
      ".utl-reward-level strong{color:#fff}",
      ".utl-reward-icon{display:inline-flex;align-items:center;justify-content:center;min-width:16px;color:var(--reward-gold);line-height:1}",
      ".utl-reward-mp-number{display:inline-block;min-width:2ch;text-align:right;transition:transform .18s ease,color .18s ease}",
      ".utl-reward-cluster.is-counting .utl-reward-mp-number{color:#fff;transform:translateY(-1px) scale(1.08)}",
      ".utl-reward-cluster.is-finished .utl-reward-item.is-emphasis{animation:utlRewardPulse .52s ease}",
      ".utl-reward-popover{position:absolute;right:0;top:calc(100% + 12px);z-index:9990;width:300px;padding:16px 18px;border:1px solid rgba(238,163,32,.42);border-radius:12px;background:#fff;color:#4A4A4A;box-shadow:0 18px 48px rgba(0,51,102,.22);opacity:0;pointer-events:none;transform:translateY(-6px);transition:opacity .16s ease,transform .16s ease;white-space:normal}",
      ".utl-reward-item:hover .utl-reward-popover,.utl-reward-item:focus-within .utl-reward-popover{opacity:1;transform:translateY(0)}",
      ".utl-reward-popover span{display:block;margin-bottom:6px;color:var(--reward-gold);font:700 10px 'Roboto Mono',monospace;letter-spacing:.14em;text-transform:uppercase}",
      ".utl-reward-popover strong{display:block;color:var(--reward-navy);font:700 18px Lato,Arial,sans-serif;line-height:1.18}",
      ".utl-reward-popover p{margin:7px 0 0;color:#4D7094;font:700 13px/1.42 Lato,Arial,sans-serif}",
      ".utl-reward-toast{position:fixed;right:22px;top:76px;z-index:10000;width:min(340px,calc(100vw - 44px));padding:16px 18px;border:1px solid rgba(238,163,32,.46);border-radius:12px;background:#fff;color:#003366;box-shadow:0 18px 44px rgba(0,51,102,.22);opacity:0;transform:translateY(-10px);transition:opacity .18s ease,transform .18s ease}",
      ".utl-reward-toast.is-visible{opacity:1;transform:translateY(0)}",
      ".utl-reward-toast span{display:block;color:#EEA320;font:700 10px 'Roboto Mono',monospace;letter-spacing:.12em;text-transform:uppercase}",
      ".utl-reward-toast strong{display:block;margin-top:5px;color:#003366;font:700 18px Lato,Arial,sans-serif}",
      ".utl-reward-toast p{margin:6px 0 0;color:#4D7094;font:700 13px/1.4 Lato,Arial,sans-serif}",
      ".utl-reward-modal-backdrop{position:fixed;inset:0;z-index:10020;display:grid;place-items:center;padding:24px;background:rgba(0,30,60,.68);backdrop-filter:blur(5px)}",
      ".utl-reward-modal{position:relative;width:min(620px,100%);overflow:hidden;border:2px solid rgba(238,163,32,.82);border-radius:22px;background:radial-gradient(circle at 50% 0,rgba(255,224,156,.48),transparent 38%),linear-gradient(180deg,#fff 0%,#fffaf0 100%);padding:46px 46px 36px;text-align:center;box-shadow:0 32px 90px rgba(0,30,60,.48),0 0 0 8px rgba(238,163,32,.1);animation:utlRewardModalArrive .48s cubic-bezier(.2,.8,.2,1)}",
      ".utl-reward-celebration{position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(circle,#EEA320 0 3px,transparent 4px),radial-gradient(circle,#2C7A4B 0 2px,transparent 3px),radial-gradient(circle,#4D7094 0 2px,transparent 3px);background-position:8% 16%,91% 22%,16% 72%;background-size:74px 74px,92px 92px,66px 66px;opacity:.55;animation:utlRewardSparkle 1.8s ease-in-out infinite alternate}",
      ".utl-reward-streamers{position:absolute;inset:0;overflow:hidden;pointer-events:none}",
      ".utl-reward-streamer{position:absolute;top:-18%;left:var(--x);width:8px;height:54px;border-radius:999px;background:var(--color);opacity:0;transform:translate3d(0,-40px,0) rotate(var(--tilt));animation:utlRewardStreamerFall 5.8s var(--delay) cubic-bezier(.18,.65,.35,1) forwards}",
      ".utl-reward-burst{position:absolute;left:50%;top:91px;width:170px;height:170px;border-radius:999px;transform:translate(-50%,-50%) scale(.2);border:3px solid rgba(238,163,32,.5);box-shadow:0 0 0 12px rgba(238,163,32,.12),0 0 0 26px rgba(238,163,32,.06);opacity:0;animation:utlRewardBurst 1.25s .2s ease-out forwards;pointer-events:none}",
      ".utl-reward-modal-check{position:relative;width:82px;height:82px;margin:0 auto 18px;border:6px solid #fff;border-radius:999px;background:linear-gradient(145deg,#3C9563,#21653E);color:#fff;display:grid;place-items:center;font:700 44px/1 Lato,Arial,sans-serif;box-shadow:0 0 0 5px rgba(44,122,75,.15),0 14px 28px rgba(44,122,75,.24)}",
      ".utl-reward-modal-label{display:block;color:#EEA320;font:700 11px 'Roboto Mono',monospace;letter-spacing:.14em;text-transform:uppercase}",
      ".utl-reward-modal h2{position:relative;margin:9px 0 12px;color:#003366;font:700 52px/1.02 'Playfair Display',Georgia,serif}",
      ".utl-reward-modal p{position:relative;max-width:470px;margin:0 auto;color:#4A4A4A;font:700 17px/1.5 Lato,Arial,sans-serif}",
      ".utl-reward-modal-total{position:relative;display:inline-flex;margin-top:18px;padding:8px 13px;border:1px solid rgba(238,163,32,.45);border-radius:999px;background:#FFF1CF;color:#8A5A00;font:700 12px 'Roboto Mono',monospace;letter-spacing:.04em}",
      ".utl-reward-modal h2.is-celebrating{animation:utlRewardTitleFlash .82s ease-in-out 6}",
      ".utl-reward-modal button{position:relative;margin-top:26px;min-height:48px;border:0;border-radius:9px;background:#003366;color:#fff;padding:0 26px;font:700 12px 'Roboto Mono',monospace;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;box-shadow:0 5px 0 #001F3F,0 12px 24px rgba(0,31,63,.18)}",
      "@keyframes utlRewardPulse{0%{transform:translateY(0) scale(1)}45%{transform:translateY(-2px) scale(1.05)}100%{transform:translateY(0) scale(1)}}",
      "@keyframes utlRewardModalArrive{0%{opacity:0;transform:translateY(18px) scale(.92)}70%{transform:translateY(-3px) scale(1.015)}100%{opacity:1;transform:none}}",
      "@keyframes utlRewardSparkle{from{opacity:.35;transform:scale(.98)}to{opacity:.7;transform:scale(1.02)}}",
      "@keyframes utlRewardStreamerFall{0%{opacity:0;transform:translate3d(0,-45px,0) rotate(var(--tilt))}8%{opacity:1}60%{opacity:1}100%{opacity:0;transform:translate3d(var(--drift),650px,0) rotate(calc(var(--tilt) + 620deg))}}",
      "@keyframes utlRewardBurst{0%{opacity:0;transform:translate(-50%,-50%) scale(.2)}35%{opacity:1}100%{opacity:0;transform:translate(-50%,-50%) scale(1.35)}}",
      "@keyframes utlRewardTitleFlash{0%,100%{color:#003366;text-shadow:none;transform:scale(1)}50%{color:#A86400;text-shadow:0 0 18px rgba(238,163,32,.42),0 0 34px rgba(238,163,32,.22);transform:scale(1.055)}}",
      "@media(max-width:860px){.utl-reward-cluster{padding:4px;gap:4px}.utl-reward-level{display:none}.utl-reward-item{padding:5px 7px;font-size:12px}.utl-reward-popover{right:-74px;width:240px}}",
      "@media(max-width:620px){.utl-reward-cluster{display:flex;min-height:34px;padding:3px;border-radius:9px;background:rgba(255,255,255,.1)}.utl-reward-cluster>.utl-reward-item:not(.is-emphasis){display:none}.utl-reward-item.is-emphasis{min-height:28px;padding:4px 8px;font-size:11px}.utl-reward-item .utl-reward-popover{position:fixed;top:calc(env(safe-area-inset-top,0px) + 86px);right:12px;width:calc(100vw - 24px)}.utl-reward-toast{top:calc(env(safe-area-inset-top,0px) + 94px);right:12px;width:calc(100vw - 24px);padding:14px 16px;border-radius:10px}.utl-reward-toast strong{font-size:17px}.utl-reward-modal-backdrop{align-items:end;padding:16px;padding-bottom:calc(16px + env(safe-area-inset-bottom,0px))}.utl-reward-modal{max-height:calc(100svh - 32px);overflow:auto;padding:24px 20px 20px;border-radius:16px}.utl-reward-modal-check{width:54px;height:54px;font-size:30px}.utl-reward-modal h2{font-size:34px}.utl-reward-modal p{font-size:15px}.utl-reward-modal button{width:100%;min-height:46px}}",
      "@media(prefers-reduced-motion:reduce){.utl-reward-mp-number,.utl-reward-popover,.utl-reward-toast{transition:none!important}.utl-reward-cluster.is-finished .utl-reward-item.is-emphasis,.utl-reward-modal,.utl-reward-celebration,.utl-reward-modal h2.is-celebrating,.utl-reward-streamer,.utl-reward-burst{animation:none!important}.utl-reward-streamer,.utl-reward-burst{display:none}}"
    ].join("\n");
    document.head.appendChild(style);
  }

  function popoverHtml(label, title, body) {
    return '<span class="utl-reward-popover" role="tooltip"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(title) + '</strong><p>' + escapeHtml(body) + '</p></span>';
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
    var mpSettings = settings.mp || {};
    var videoMp = Math.max(0, numberOr(mpSettings.videoComplete, 10));
    var contextMp = Math.max(0, numberOr(mpSettings.contextComplete, 5));
    var completionMp = Math.max(0, numberOr(mpSettings.exerciseCompleteFallback, 50));
    var reflectionMp = Math.max(0, numberOr(mpSettings.reflectionExercise, 30));
    var scoreRule = mpSettings.exerciseMode === "fixed"
      ? completionMp + " MP per scored exercise"
      : mpSettings.exerciseMode === "score-total"
        ? "first score earned as MP"
        : "score improvements earn MP";
    var mpRulesBody = "Earn " + videoMp + " MP per lesson video, " + contextMp + " per context item, " + completionMp + " per completion exercise, and " + reflectionMp + " per reflection. Scored exercises: " + scoreRule + ". Level: " + state.level + ". Today: " + todayCount + " of " + dailyGoal + " exercises toward your streak.";
    var levelBody = state.nextLevel
      ? state.nextLevel + " starts at " + state.nextThreshold + " MP. You need " + state.mpToNext + " more MP."
      : "You are at the top configured level.";
    if (display.showMp === false) { container.innerHTML = ""; return null; }
    container.innerHTML = [
      '<div class="utl-reward-cluster" data-utl-reward-cluster>',
        display.showLevel ? '<span class="utl-reward-item utl-reward-level" tabindex="0">' : '',
        display.showLevel ? '<span>Level: <strong>' + escapeHtml(state.level) + '</strong></span>' : '',
        display.showLevel ? popoverHtml("Level", state.level + " · starts at " + state.currentThreshold + " MP", levelBody) : '',
        display.showLevel ? '</span>' : '',
        display.showStreak ? '<span class="utl-reward-item" tabindex="0">' : '',
        display.showStreak ? '<span class="utl-reward-icon" aria-hidden="true">&#128293;</span><span>' + state.streakDays + '</span>' : '',
        display.showStreak ? popoverHtml("Streak", state.streakDays + " day" + (state.streakDays === 1 ? "" : "s"), streakBody) : '',
        display.showStreak ? '</span>' : '',
        '<span class="utl-reward-item is-emphasis" tabindex="0">',
          '<span class="utl-reward-icon" aria-hidden="true">&#10022;</span><span class="utl-reward-mp-number" data-utl-mp-number>' + state.mpTotal + '</span><span>MP</span>',
          popoverHtml("Mastery Points", state.mpTotal + " MP earned", mpRulesBody),
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

  function handleRewardMoment(details) {
    var opts = details || {};
    var container = opts.container || document.getElementById("wsRewardCluster") || document.querySelector("[data-utl-reward-mount]");
    var startMp = Math.max(0, Math.round(numberOr(opts.startMp, opts.newTotal || 0)));
    var newTotal = Math.max(0, Math.round(numberOr(opts.newTotal, startMp)));
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
    handleRewardMoment: handleRewardMoment
  };
})();
