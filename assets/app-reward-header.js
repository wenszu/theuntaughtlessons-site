(function () {
  var REWARD_STATE_KEY = "utl_rewards_state";

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
      script.src = "../../assets/reward-ui.js?v=20260710-rewards-ui-5";
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
      ".utl-app-rewards-attached{grid-template-columns:auto auto minmax(180px,1fr) auto auto!important}",
      ".utl-app-reward-mount{justify-self:end}",
      ".utl-app-reward-mount .utl-reward-cluster{min-height:42px;border-radius:8px}",
      "@media(max-width:1100px){.utl-app-reward-mount{display:none}}"
    ].join("\n");
    document.head.appendChild(style);
  }

  function attach() {
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
    if (header.querySelector(".utl-app-reward-mount")) return;
    injectStyles();
    var mount = document.createElement("div");
    mount.className = "utl-app-reward-mount";
    mount.setAttribute("data-utl-reward-mount", "");
    mount.setAttribute("aria-label", "Learning rewards");
    var timer = header.querySelector(".app-timer");
    header.insertBefore(mount, timer || null);
    header.classList.add("utl-app-rewards-attached");
    loadRewardUi()
      .then(function (rewardUi) {
        if (rewardUi && rewardUi.renderCluster) rewardUi.renderCluster(mount, { state: readRewardState() });
      })
      .catch(function (error) {
        console.warn("App reward header failed to load.", error);
        mount.remove();
        header.classList.remove("utl-app-rewards-attached");
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }
})();
