(function () {
  var STYLE_ID = "utl-tactile-buttons-style";
  var TACTILE_CLASS = "utl-tactile-button";

  var actionSelectors = [
    ".ws-button",
    ".buttons button",
    ".done-toggle",
    "button.primary",
    "button.gold",
    "button.primary-action",
    "button.secondary-action",
    ".btn",
    ".link-button",
    ".tsa-speak-button",
    ".tsa-speak-link-button",
    ".ab-button",
    ".ab-small-button",
    ".eisenhower-button",
    ".bad-news-button",
    ".lsh-button",
    ".slo-button",
    ".write-to-aiko-submit",
    ".write-to-aiko-reset",
    ".write-to-aiko-sample-toggle",
    ".tk-button",
    ".placeholder-button",
    ".tsa-stp-primary",
    ".tsa-stp-secondary",
    ".btn-download",
    ".btn-send",
    ".btn-copy-workbook",
    ".btn-view-full",
    ".primary-button",
    ".small-button",
    ".secondary-button",
    ".danger-button",
    ".mb-btn"
  ].join(",");

  var excludedSelectors = [
    ".icon-timer-btn",
    ".metric-hide-btn",
    ".mode-btn",
    ".mobile-tab",
    ".timer-toggle",
    ".timer-reset",
    ".bucket-add-slot",
    ".eisenhower-chip",
    ".eisenhower-add-slot",
    ".tsa-speak-mode-btn",
    ".write-to-aiko-toggle",
    ".write-to-aiko-icon-button",
    ".write-to-aiko-scqa-toggle",
    ".email-toggle",
    ".panel-close",
    ".hint-toggle",
    ".summary-toggle",
    ".clear-link",
    ".add-detail",
    ".detail-remove",
    ".advance-prompt",
    ".tk-tab",
    ".tk-toggle",
    ".ws-avatar",
    ".ws-journey-head",
    ".ws-orientation-head",
    ".ws-how-toggle",
    ".ws-context-toggle",
    ".ws-practice-head",
    ".ws-exercise-tab",
    ".ws-video-check",
    ".ws-lesson-check",
    ".admin-profile-button",
    ".results-profile-button",
    "[data-watch-id]",
    "[data-watch-all]",
    "[data-watch-reset]",
    "[data-journey-toggle]",
    "[data-orientation-toggle]",
    "[data-context-toggle]",
    "[data-practice-toggle]",
    "[data-welcome-toggle]",
    "[data-rewatch-toggle]",
    "[data-tab]",
    "[data-move-selected-to]",
    "[data-password-toggle]",
    "[data-close-panel]",
    "[aria-label*='timer']",
    "[aria-label*='Timer']",
    "[aria-label*='hide']",
    "[aria-label*='Hide']",
    "[aria-label*='close']",
    "[aria-label*='Close']"
  ].join(",");

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      "." + TACTILE_CLASS + "{",
      "position:relative;",
      "transform:translateY(0);",
      "box-shadow:none;",
      "transition:transform .12s ease,box-shadow .12s ease,background .15s ease,border-color .15s ease,filter .15s ease;",
      "will-change:transform;",
      "}",
      "." + TACTILE_CLASS + ":hover:not(:disabled):not([disabled]):not(.disabled):not(.ws-disabled):not([aria-disabled='true']){",
      "transform:translateY(-2px);",
      "box-shadow:none;",
      "}",
      "." + TACTILE_CLASS + ":active:not(:disabled):not([disabled]):not(.disabled):not(.ws-disabled):not([aria-disabled='true']){",
      "transform:translateY(4px);",
      "box-shadow:none;",
      "}",
      "." + TACTILE_CLASS + ":disabled,",
      "." + TACTILE_CLASS + "[disabled],",
      "." + TACTILE_CLASS + ".disabled,",
      "." + TACTILE_CLASS + ".ws-disabled,",
      "." + TACTILE_CLASS + "[aria-disabled='true']{",
      "box-shadow:none;",
      "transform:none;",
      "will-change:auto;",
      "}",
      ".utl-tactile-primary{",
      "box-shadow:none;",
      "}",
      ".utl-tactile-primary:hover:not(:disabled):not([disabled]):not(.disabled):not(.ws-disabled):not([aria-disabled='true']){",
      "background:#0B4A83;",
      "border-color:#0B4A83;",
      "box-shadow:none;",
      "filter:brightness(1.03);",
      "}",
      ".utl-tactile-primary:active:not(:disabled):not([disabled]):not(.disabled):not(.ws-disabled):not([aria-disabled='true']){",
      "background:#002A55;",
      "border-color:#002A55;",
      "box-shadow:none;",
      "filter:none;",
      "}",
      ".utl-tactile-gold{",
      "box-shadow:none;",
      "}",
      ".utl-tactile-gold:hover:not(:disabled):not([disabled]):not(.disabled):not(.ws-disabled):not([aria-disabled='true']){",
      "box-shadow:none;",
      "}",
      ".utl-tactile-gold:active:not(:disabled):not([disabled]):not(.disabled):not(.ws-disabled):not([aria-disabled='true']){",
      "box-shadow:none;",
      "}",
      "@media (prefers-reduced-motion:reduce){",
      "." + TACTILE_CLASS + ",",
      "." + TACTILE_CLASS + ":hover:not(:disabled):not([disabled]),",
      "." + TACTILE_CLASS + ":active:not(:disabled):not([disabled]){",
      "transition:box-shadow .12s ease,background .15s ease,border-color .15s ease;",
      "transform:none;",
      "}",
      "}"
    ].join("");
    document.head.appendChild(style);
  }

  function isBackLink(element) {
    var text = (element.textContent || "").trim();
    return /^(←\s*)?back\b/i.test(text) || /\bback to\b/i.test(text);
  }

  function isExcluded(element) {
    if (!element || !element.matches) return true;
    if (element.matches(excludedSelectors)) return true;
    if (element.closest(".ws-profile-menu, .admin-profile-menu, .results-profile-menu")) return true;
    return isBackLink(element);
  }

  function hasGoldBackground(element) {
    if (!window.getComputedStyle) return false;
    var color = window.getComputedStyle(element).backgroundColor || "";
    var match = color.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
    if (!match) return false;
    var red = Number(match[1]);
    var green = Number(match[2]);
    var blue = Number(match[3]);
    return red >= 190 && green >= 105 && green <= 205 && blue <= 90;
  }

  function setVariant(element) {
    element.classList.remove("utl-tactile-primary", "utl-tactile-gold");
    var goldAction = element.matches(".gold, .primary-action, .ab-gold, .eisenhower-button.gold, .ws-button-gold, .tsa-stp-primary") || hasGoldBackground(element);
    if (goldAction) {
      element.classList.add("utl-tactile-gold");
      return;
    }
    if (
      element.matches(".primary, .btn-primary, .ws-button-navy, .bad-news-button-primary, .lsh-button-primary, .slo-button-primary, .tsa-speak-button:not(.secondary), .primary-button, .btn-download, .btn-send")
    ) {
      element.classList.add("utl-tactile-primary");
    }
  }

  function applyTo(element) {
    if (!element || !element.matches || !element.matches(actionSelectors) || isExcluded(element)) return;
    element.classList.add(TACTILE_CLASS);
    setVariant(element);
  }

  function applyAll(root) {
    var scope = root && root.querySelectorAll ? root : document;
    if (scope.matches) applyTo(scope);
    scope.querySelectorAll(actionSelectors).forEach(applyTo);
  }

  function applyFromEvent(event) {
    var target = event.target;
    if (!target || !target.closest) return;
    applyTo(target.closest(actionSelectors));
  }

  function boot() {
    injectStyles();

    var scan = function () { applyAll(document); };
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(scan, { timeout: 800 });
    } else {
      window.setTimeout(scan, 1);
    }

    document.addEventListener("pointerover", applyFromEvent, { passive: true });
    document.addEventListener("focusin", applyFromEvent);
    document.addEventListener("touchstart", applyFromEvent, { passive: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
