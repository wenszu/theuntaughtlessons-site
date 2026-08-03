(function () {
  var REWARD_STATE_KEY = "utl_rewards_state";
  var DAILY_MISSION_KEY = "utl_daily_mission_plan";

  function localDateString() {
    var now = new Date();
    return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
  }

  function readDailyMission() {
    try {
      var plan = JSON.parse(localStorage.getItem(DAILY_MISSION_KEY) || "null");
      return plan && plan.date === localDateString() ? plan : null;
    } catch (error) {
      return null;
    }
  }

  function missionTaskDone(task) {
    if (!task) return false;
    if (task.manual) return Boolean(task.complete);
    if (task.type === "Video") return localStorage.getItem("utl_watched_" + task.id) === "true";
    if (Array.isArray(task.doneKeys) && task.doneKeys.some(function (key) { return localStorage.getItem(key) === "true"; })) return true;
    return localStorage.getItem("utl_done_" + task.id) === "true";
  }

  function missionTaskHref(task) {
    var href = String(task && task.href || "");
    if (href.indexOf("../apps/") === 0) return "../../apps/" + href.slice(8);
    if (/^phase-[123]\.html/.test(href)) return "../../member-login/" + href;
    return href || "../../member-login/index.html";
  }

  function missionLinkHtml() {
    var plan = readDailyMission();
    var hasPlan = plan && Array.isArray(plan.tasks) && plan.tasks.length;
    var done = hasPlan ? plan.tasks.filter(missionTaskDone).length : 0;
    var total = hasPlan ? plan.tasks.length : 0;
    var value = !hasPlan ? "Set" : (done === total ? "&#10003;" : done + " / " + total);
    var aria = !hasPlan ? "Daily mission: not set" : "Daily mission: " + done + " of " + total + " complete";
    var nextTask = hasPlan ? plan.tasks.filter(function (task) { return !missionTaskDone(task); })[0] : null;
    var popover = !hasPlan
      ? '<span class="utl-app-mission-popover"><small>Daily mission</small><strong>No mission set yet</strong><p>Choose a plan based on what is next.</p><a href="../../member-login/index.html?open=planner#todays-mission">Set mission</a></span>'
      : '<span class="utl-app-mission-popover"><small>Daily mission</small><strong>' + done + ' of ' + total + ' complete</strong><p>' + (nextTask ? 'Next: ' + nextTask.title : 'You completed today’s mission.') + '</p>' + (nextTask ? '<a href="' + missionTaskHref(nextTask) + '">Continue</a>' : '') + '</span>';
    return '<span class="utl-app-mission" tabindex="0" aria-label="' + aria + '"><span>Daily mission:</span><b>' + value + '</b>' + popover + '</span>';
  }

  function loadRewardUi() {
    if (window.UTLRewardUI) return Promise.resolve(window.UTLRewardUI);
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-utl-reward-ui]');
      if (existing) {
        existing.addEventListener("load", function () { resolve(window.UTLRewardUI); });
        existing.addEventListener("error", reject);
        return;
      }
      var script = document.createElement("script");
      script.src = "../../assets/reward-ui.js?v=20260730-celebration-1";
      script.async = true;
      script.dataset.utlRewardUi = "true";
      script.onload = function () { resolve(window.UTLRewardUI); };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function loadExerciseContextFlow() {
    if (window.UTLExerciseContextFlow) return Promise.resolve(window.UTLExerciseContextFlow);
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector("script[data-utl-context-flow]");
      if (existing) {
        existing.addEventListener("load", function () { resolve(window.UTLExerciseContextFlow); });
        existing.addEventListener("error", reject);
        return;
      }
      var script = document.createElement("script");
      script.src = "../../assets/exercise-context-flow.js?v=20260803-scqa-video-1";
      script.dataset.utlContextFlow = "true";
      script.onload = function () { resolve(window.UTLExerciseContextFlow); };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function readRewardState() {
    try {
      return JSON.parse(localStorage.getItem(REWARD_STATE_KEY) || "{}");
    } catch (error) {
      return {};
    }
  }

  function injectStyles() {
    if (document.getElementById("utl-app-reward-header-styles")) return;
    var style = document.createElement("style");
    style.id = "utl-app-reward-header-styles";
    style.textContent = [
      "html,body{max-width:100%;overflow-x:clip}",
      ".utl-app-rewards-attached{grid-template-columns:auto auto minmax(180px,1fr) auto auto!important}",
      ".utl-compact-timer-group{display:flex!important;align-items:center!important;align-self:center;min-height:42px!important;padding:0!important;border:1px solid rgba(255,255,255,.28)!important;border-radius:8px!important;background:rgba(255,255,255,.1)!important}",
      ".utl-compact-timer-group>.utility-metric,.utl-compact-timer-group>.write-to-aiko-utility,.utl-compact-timer-group>.ab-utility-metric{min-height:40px!important;padding:4px 10px!important;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important}",
      ".utl-compact-timer-group>.utility-controls,.utl-compact-timer-group>.write-to-aiko-timer-controls,.utl-compact-timer-group>.ab-controls{display:flex!important;align-items:center!important;gap:2px!important;min-height:40px!important;padding:0 5px!important;border-left:1px solid rgba(255,255,255,.2)}",
      ".utl-compact-timer-group button{display:grid!important;place-items:center!important;width:32px!important;min-width:32px!important;height:32px!important;min-height:32px!important;padding:0!important;border:0!important;border-radius:6px!important;background:transparent!important;box-shadow:none!important}",
      ".utl-compact-timer-group button:hover,.utl-compact-timer-group button:focus-visible{background:rgba(255,255,255,.13)!important}",
      ".utl-compact-timer-group.utl-direct-timer{gap:7px!important;padding:0 5px 0 10px!important}",
      ".utl-app-engagement{display:flex;align-items:center;justify-self:end;gap:8px;min-width:0}",
      ".utl-app-reward-mount{justify-self:end}",
      ".utl-app-reward-mount .utl-reward-cluster{min-height:42px;border-radius:8px}",
      ".utl-app-mission{position:relative;display:inline-flex;align-items:center;gap:7px;min-height:38px;padding:0 11px;border:1px solid rgba(238,163,32,.65);border-radius:999px;color:#fff;text-decoration:none;font:700 10px Lato, Arial, sans-serif;white-space:nowrap}",
      ".utl-app-mission b{color:#EEA320}",
      ".utl-app-mission-popover{position:absolute;right:0;top:calc(100% + 10px);z-index:9990;width:280px;padding:15px 16px;border:1px solid rgba(238,163,32,.42);border-radius:11px;background:#fff;color:#4A4A4A;box-shadow:0 18px 48px rgba(0,51,102,.22);opacity:0;pointer-events:none;transform:translateY(-6px);transition:opacity .16s ease,transform .16s ease;white-space:normal}.utl-app-mission:hover .utl-app-mission-popover,.utl-app-mission:focus-within .utl-app-mission-popover{opacity:1;pointer-events:auto;transform:translateY(0)}.utl-app-mission-popover small{display:block;color:#EEA320;font:700 10px Lato, Arial, sans-serif;text-transform: none}.utl-app-mission-popover strong{display:block;margin-top:5px;color:#003366;font:700 17px Lato,sans-serif}.utl-app-mission-popover p{margin:7px 0 11px;color:#4D7094;font:700 13px/1.4 Lato,sans-serif}.utl-app-mission-popover a{display:inline-flex;min-height:36px;align-items:center;border-radius:7px;background:#EEA320;color:#003366;padding:0 11px;text-decoration:none;text-transform: none}",
      ".utl-attempts-toggle{display:inline-flex;align-items:center;gap:8px;border:0;background:transparent;color:#003366;font:700 13px Lato,Arial,sans-serif;cursor:pointer}.utl-attempts-toggle span{display:grid;place-items:center;width:24px;height:24px;border:1px solid rgba(0,51,102,.25);border-radius:999px}.utl-attempts-collapsed>.panel-body{display:none!important}",
      "@media(max-width:1100px){.utl-app-rewards-attached{grid-template-columns:auto minmax(150px,1fr) auto!important}.utl-app-rewards-attached>:is(.brand-divider,.write-to-aiko-divider,.ab-divider,.bad-news-divider,.lsh-divider,.slo-divider){display:none!important}.utl-app-reward-mount{display:none}.utl-app-mission>span:first-child{display:none}.utl-app-mission{min-width:42px;justify-content:center;padding:0 8px}}",
      "@media(max-width:760px){.utl-app-rewards-attached{grid-template-columns:auto minmax(150px,1fr) auto!important;grid-auto-flow:row!important}.utl-app-rewards-attached>.write-to-aiko-logo{grid-column:1!important;grid-row:1!important}.utl-app-rewards-attached>.write-to-aiko-heading{grid-column:2 / -1!important;grid-row:1!important;min-width:0}.utl-app-rewards-attached>.utl-app-engagement{grid-column:1;grid-row:2;justify-self:start}.utl-app-rewards-attached>:is(.app-timer,.utility-cluster,.ab-timer,.write-to-aiko-utilities,.bad-news-timer,.lsh-timer,.slo-timer){grid-column:2 / -1!important;grid-row:2!important;justify-self:end;max-width:100%}.utl-app-engagement{gap:4px}.utl-app-mission{min-height:34px;font-size:9px}.utl-compact-timer-group{min-height:46px!important}.utl-compact-timer-group>.utility-metric,.utl-compact-timer-group>.write-to-aiko-utility,.utl-compact-timer-group>.ab-utility-metric{min-height:44px!important}.utl-compact-timer-group>.utility-controls,.utl-compact-timer-group>.write-to-aiko-timer-controls,.utl-compact-timer-group>.ab-controls{min-height:44px!important}.utl-compact-timer-group button{width:44px!important;min-width:44px!important;height:44px!important;min-height:44px!important}}",
      "@media(max-width:440px){.utl-app-rewards-attached>.write-to-aiko-logo{display:none!important}.utl-app-rewards-attached>.write-to-aiko-heading{grid-column:1 / -1!important}.utl-app-mission{display:none}.utl-app-rewards-attached>.utl-app-engagement{display:none}.utl-app-rewards-attached>:is(.app-timer,.utility-cluster,.ab-timer,.write-to-aiko-utilities,.bad-news-timer,.lsh-timer,.slo-timer){grid-column:1 / -1!important;grid-row:2!important;justify-self:stretch}.utl-compact-timer-group{flex:1}.utl-compact-timer-group>.utility-metric,.utl-compact-timer-group>.write-to-aiko-utility,.utl-compact-timer-group>.ab-utility-metric{flex:1}}"
    ].join("\n");
    document.head.appendChild(style);
  }

  function makeAttemptsCollapsible() {
    document.querySelectorAll(".attempts-panel").forEach(function (panel) {
      var heading = panel.querySelector(".panel-head h2, .panel-head h3");
      var head = panel.querySelector(".panel-head");
      if (!heading || !head || !/previous attempts/i.test(heading.textContent) || head.querySelector(".utl-attempts-toggle")) return;
      var button = document.createElement("button");
      button.type = "button";
      button.className = "utl-attempts-toggle";
      button.setAttribute("aria-expanded", "false");
      button.innerHTML = '<span aria-hidden="true">+</span><b>Show</b>';
      panel.classList.add("utl-attempts-collapsed");
      head.appendChild(button);
      button.addEventListener("click", function () {
        var collapsed = panel.classList.toggle("utl-attempts-collapsed");
        button.setAttribute("aria-expanded", String(!collapsed));
        button.innerHTML = '<span aria-hidden="true">' + (collapsed ? '+' : '&minus;') + '</span><b>' + (collapsed ? 'Show' : 'Hide') + '</b>';
      });
    });
  }

  function normalizeLearningJourneyLinks() {
    document.querySelectorAll("a").forEach(function (link) {
      var href = link.getAttribute("href") || "";
      var text = (link.textContent || "").trim();
      var phaseMatch = href.match(/member-login\/phase-([123])(?:\.html|\/practice\/index\.html)/);
      var returnsToOldPhase = Boolean(phaseMatch);
      var namesOldPhase = /back to phase [123](?: exercises)?/i.test(text);
      if (!returnsToOldPhase && !namesOldPhase) return;
      var namedPhase = (text.match(/phase ([123])/i) || [])[1];
      var phaseNumber = phaseMatch && phaseMatch[1] || namedPhase || "1";
      link.setAttribute("href", "../../member-login/index.html?phase=phase" + phaseNumber + "#learning-journey");
      link.textContent = text.indexOf("←") === 0 ? "← Back to Learning Journey" : "Back to Learning Journey →";
    });
  }

  function compactTimerUtilities(header) {
    if (!header || header.querySelector(".utl-compact-timer-group")) return;
    var direct = header.querySelector(".bad-news-timer,.lsh-timer,.slo-timer");
    if (direct) {
      direct.classList.add("utl-compact-timer-group", "utl-direct-timer");
      return;
    }
    var host = header.querySelector(".write-to-aiko-utilities,.app-timer,.utility-cluster,.ab-timer");
    if (!host) return;
    var controls = host.querySelector(".write-to-aiko-timer-controls,.utility-controls,.ab-controls");
    var metrics = Array.prototype.slice.call(host.querySelectorAll(".write-to-aiko-utility,.utility-metric,.ab-utility-metric"));
    var timerMetric = metrics.filter(function (metric) {
      return metric.querySelector('[id*="timer" i],[class*="timer" i]') || /timer|elapsed time/i.test(metric.textContent || "");
    })[0];
    if (!timerMetric || !controls) return;
    var group = document.createElement("div");
    group.className = "utl-compact-timer-group";
    group.setAttribute("aria-label", "Timer controls");
    host.insertBefore(group, timerMetric);
    group.appendChild(timerMetric);
    group.appendChild(controls);
  }

  function attach() {
    injectStyles();
    makeAttemptsCollapsible();
    normalizeLearningJourneyLinks();
    loadExerciseContextFlow().then(function (flow) {
      if (flow && flow.attach) flow.attach();
    }).catch(function (error) {
      console.warn("Exercise context flow failed to load.", error);
    });
    var header = document.querySelector([
      ".app-header",
      ".ab-header",
      ".eisenhower-header",
      ".tsa-speak-header",
      ".bad-news-header",
      ".lsh-header",
      ".slo-header",
      ".write-to-aiko-header",
      ".aiko-header"
    ].join(","));
    if (!header) return;
    compactTimerUtilities(header);
    if (header.querySelector(".header-gamification-cluster")) return;
    if (header.querySelector(".utl-app-engagement")) return;
    var engagement = document.createElement("div");
    engagement.className = "utl-app-engagement";
    engagement.innerHTML = missionLinkHtml();
    var mount = document.createElement("div");
    mount.className = "utl-app-reward-mount";
    mount.setAttribute("data-utl-reward-mount", "");
    mount.setAttribute("aria-label", "Learning rewards");
    engagement.appendChild(mount);
    var timer = header.querySelector([
      ".app-timer",
      ".utility-cluster",
      ".ab-timer",
      ".write-to-aiko-utilities",
      ".bad-news-timer",
      ".lsh-timer",
      ".slo-timer"
    ].join(","));
    header.insertBefore(engagement, timer || null);
    header.classList.add("utl-app-rewards-attached");
    loadRewardUi()
      .then(function (rewardUi) {
        if (rewardUi && rewardUi.renderCluster) rewardUi.renderCluster(mount, { state: readRewardState() });
      })
      .catch(function (error) {
        console.warn("App reward header failed to load.", error);
        engagement.remove();
        header.classList.remove("utl-app-rewards-attached");
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }
})();
