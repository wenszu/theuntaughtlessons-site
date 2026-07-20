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
      script.src = "../../assets/reward-ui.js?v=20260714-flat-1";
      script.async = true;
      script.dataset.utlRewardUi = "true";
      script.onload = function () { resolve(window.UTLRewardUI); };
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
      ".utl-app-engagement{display:flex;align-items:center;justify-self:end;gap:8px;min-width:0}",
      ".utl-app-reward-mount{justify-self:end}",
      ".utl-app-reward-mount .utl-reward-cluster{min-height:42px;border-radius:8px}",
      ".utl-app-mission{position:relative;display:inline-flex;align-items:center;gap:7px;min-height:38px;padding:0 11px;border:1px solid rgba(238,163,32,.65);border-radius:999px;color:#fff;text-decoration:none;font:700 10px Lato, Arial, sans-serif;white-space:nowrap}",
      ".utl-app-mission b{color:#EEA320}",
      ".utl-app-mission-popover{position:absolute;right:0;top:calc(100% + 10px);z-index:9990;width:280px;padding:15px 16px;border:1px solid rgba(238,163,32,.42);border-radius:11px;background:#fff;color:#4A4A4A;box-shadow:0 18px 48px rgba(0,51,102,.22);opacity:0;pointer-events:none;transform:translateY(-6px);transition:opacity .16s ease,transform .16s ease;white-space:normal}.utl-app-mission:hover .utl-app-mission-popover,.utl-app-mission:focus-within .utl-app-mission-popover{opacity:1;pointer-events:auto;transform:translateY(0)}.utl-app-mission-popover small{display:block;color:#EEA320;font:700 10px Lato, Arial, sans-serif;text-transform: none}.utl-app-mission-popover strong{display:block;margin-top:5px;color:#003366;font:700 17px Lato,sans-serif}.utl-app-mission-popover p{margin:7px 0 11px;color:#4D7094;font:700 13px/1.4 Lato,sans-serif}.utl-app-mission-popover a{display:inline-flex;min-height:36px;align-items:center;border-radius:7px;background:#EEA320;color:#003366;padding:0 11px;text-decoration:none;text-transform: none}",
      ".utl-attempts-toggle{display:inline-flex;align-items:center;gap:8px;border:0;background:transparent;color:#003366;font:700 13px Lato,Arial,sans-serif;cursor:pointer}.utl-attempts-toggle span{display:grid;place-items:center;width:24px;height:24px;border:1px solid rgba(0,51,102,.25);border-radius:999px}.utl-attempts-collapsed>.panel-body{display:none!important}",
      "@media(max-width:1100px){.utl-app-reward-mount{display:none}.utl-app-mission>span:first-child{display:none}.utl-app-mission{min-width:42px;justify-content:center;padding:0 8px}}",
      "@media(max-width:620px){.utl-app-engagement{gap:4px}.utl-app-mission{min-height:34px;font-size:9px}}"
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

  function attach() {
    injectStyles();
    makeAttemptsCollapsible();
    var header = document.querySelector([
      ".app-header",
      ".ab-header",
      ".eisenhower-header",
      ".tsa-speak-header",
      ".bad-news-header",
      ".lsh-header",
      ".slo-header",
      ".write-to-aiko-header"
    ].join(","));
    if (!header) return;
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
    var timer = header.querySelector(".app-timer");
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
