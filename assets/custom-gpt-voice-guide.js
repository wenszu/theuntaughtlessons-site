(function () {
  "use strict";

  var STORAGE_KEY = "utl_skip_custom_gpt_voice_guide";
  var triggers = Array.prototype.slice.call(document.querySelectorAll("[data-custom-gpt-voice-guide]"));
  var helpTriggers = Array.prototype.slice.call(document.querySelectorAll("[data-custom-gpt-voice-help]"));
  if (!triggers.length) return;

  var style = document.createElement("style");
  style.textContent = [
    ".utl-voice-dialog{box-sizing:border-box;width:min(780px,calc(100vw - 28px));max-height:min(90dvh,820px);overflow:hidden;border:0;border-radius:16px;padding:0;background:#fff;color:#333;box-shadow:0 26px 80px rgba(0,31,61,.38)}",
    ".utl-voice-dialog::backdrop{background:rgba(0,31,61,.62);backdrop-filter:blur(3px)}",
    ".utl-voice-dialog *{box-sizing:border-box}",
    ".utl-voice-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding:24px 26px 18px;border-bottom:1px solid #d8e1e8}",
    ".utl-voice-kicker{display:block;margin:0 0 5px;color:#a86400;font:700 12px/1.2 Lato,Arial,sans-serif}",
    ".utl-voice-head h2{margin:0;color:#003366;font:700 30px/1.15 'Playfair Display',Georgia,serif}",
    ".utl-voice-close{display:grid;flex:0 0 36px;width:36px;height:36px;place-items:center;border:1px solid #c7d8e8;border-radius:50%;background:#fff;color:#003366;font:700 22px/1 Arial,sans-serif;cursor:pointer}",
    ".utl-voice-close:hover,.utl-voice-close:focus-visible{border-color:#003366;background:#f3f7fa}",
    ".utl-voice-body{max-height:calc(90dvh - 92px);overflow-y:auto;overscroll-behavior:contain;padding:22px 26px 26px}",
    ".utl-voice-intro{margin:0 0 20px;color:#4d7094;font:16px/1.5 Lato,Arial,sans-serif}",
    ".utl-voice-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0;padding:0;list-style:none}",
    ".utl-voice-step{min-width:0;border:1px solid #c7d8e8;border-radius:12px;background:#fff;padding:16px}",
    ".utl-voice-step-number{display:grid;width:30px;height:30px;margin-bottom:12px;place-items:center;border-radius:50%;background:#fff1cf;color:#003366;font:800 13px/1 Lato,Arial,sans-serif}",
    ".utl-voice-step h3{margin:0 0 6px;color:#003366;font:800 16px/1.25 Lato,Arial,sans-serif}",
    ".utl-voice-step p{margin:0;color:#4a4a4a;font:14px/1.48 Lato,Arial,sans-serif}",
    ".utl-voice-graphic{display:flex;align-items:center;justify-content:center;height:92px;margin:0 0 14px;border-radius:9px;background:#f5f7f9;color:#003366}",
    ".utl-voice-window{width:100%;max-width:190px;border:1px solid #d7dde3;border-radius:12px;background:#fff;padding:10px;box-shadow:0 5px 16px rgba(0,31,61,.08)}",
    ".utl-voice-window-bar{display:flex;gap:4px;margin-bottom:22px}.utl-voice-window-bar i{width:5px;height:5px;border-radius:50%;background:#c5ced7}",
    ".utl-voice-compose{display:flex;align-items:center;justify-content:flex-end;gap:7px;height:30px;border:1px solid #d8dee5;border-radius:15px;padding:4px 5px}",
    ".utl-voice-mic{width:12px;height:16px;border:2px solid #777;border-radius:7px;position:relative}.utl-voice-mic:after{content:'';position:absolute;left:3px;bottom:-5px;width:3px;height:4px;border-left:1px solid #777}",
    ".utl-voice-button-highlight{display:grid;place-items:center;padding:5px;border:2px solid #eea320;border-radius:10px;background:#fff7e8;box-shadow:0 0 0 3px rgba(238,163,32,.12)}",
    ".utl-voice-button-demo{display:grid;width:24px;height:24px;place-items:center;border-radius:50%;background:#287ff0;color:#fff;box-shadow:0 0 0 3px rgba(40,127,240,.14)}",
    ".utl-voice-button-demo span{display:flex;align-items:center;gap:1px;height:11px}.utl-voice-button-demo i{display:block;width:2px;border-radius:2px;background:#fff}.utl-voice-button-demo i:nth-child(1),.utl-voice-button-demo i:nth-child(5){height:5px}.utl-voice-button-demo i:nth-child(2),.utl-voice-button-demo i:nth-child(4){height:9px}.utl-voice-button-demo i:nth-child(3){height:11px}",
    ".utl-voice-callout{margin:8px 0 0;text-align:right;color:#1768c4;font:800 11px/1.2 Lato,Arial,sans-serif}",
    ".utl-voice-talk-icon{display:grid;width:56px;height:56px;place-items:center;border-radius:50%;background:#eaf3fb;font-size:27px}",
    ".utl-voice-note{margin:16px 0 0;padding:11px 13px;border-radius:8px;background:#f3ede2;color:#4a4a4a;font:13px/1.45 Lato,Arial,sans-serif}",
    ".utl-voice-actions{display:flex;align-items:center;gap:14px;margin-top:20px}",
    ".utl-voice-open{display:inline-flex;min-height:48px;align-items:center;justify-content:center;border:0;border-radius:8px;background:#eea320;color:#003366;padding:0 22px;text-decoration:none;font:800 15px/1.2 Lato,Arial,sans-serif;cursor:pointer}",
    ".utl-voice-text{border:0;background:transparent;color:#003366;padding:10px 3px;text-decoration:underline;text-underline-offset:3px;font:700 14px/1.2 Lato,Arial,sans-serif;cursor:pointer}",
    ".utl-voice-preference{display:flex;align-items:center;gap:9px;margin-top:17px;color:#4d7094;font:13px/1.3 Lato,Arial,sans-serif}",
    ".utl-voice-preference input{width:16px;height:16px;accent-color:#003366}",
    "@media(max-width:680px){.utl-voice-dialog{width:calc(100vw - 20px);max-height:94dvh}.utl-voice-head{padding:19px 18px 15px}.utl-voice-head h2{font-size:25px}.utl-voice-body{max-height:calc(94dvh - 78px);padding:17px 18px 20px}.utl-voice-steps{grid-template-columns:1fr}.utl-voice-step{display:grid;grid-template-columns:38px 1fr;column-gap:10px}.utl-voice-step-number{grid-row:1/3;margin:0}.utl-voice-graphic{grid-column:2;height:76px}.utl-voice-step h3,.utl-voice-step p{grid-column:2}.utl-voice-actions{align-items:stretch;flex-direction:column}.utl-voice-open,.utl-voice-text{width:100%}}",
    "@media(prefers-reduced-motion:reduce){.utl-voice-dialog{scroll-behavior:auto}}"
  ].join("");
  document.head.appendChild(style);

  var dialog = document.createElement("dialog");
  dialog.className = "utl-voice-dialog";
  dialog.setAttribute("aria-labelledby", "utlVoiceGuideTitle");
  dialog.innerHTML = [
    '<div class="utl-voice-head"><div><span class="utl-voice-kicker">Voice practice</span><h2 id="utlVoiceGuideTitle">Talk through the conversation.</h2></div><button class="utl-voice-close" type="button" aria-label="Close voice instructions">&times;</button></div>',
    '<div class="utl-voice-body"><p class="utl-voice-intro">Use voice mode so you can practice responding in the moment. It takes three steps.</p>',
    '<ol class="utl-voice-steps">',
    '<li class="utl-voice-step"><span class="utl-voice-step-number">1</span><div class="utl-voice-graphic"><span class="utl-voice-talk-icon" aria-hidden="true">↗</span></div><h3>Open the CustomGPT</h3><p>ChatGPT will open in a new tab. Sign in if it asks you to.</p></li>',
    '<li class="utl-voice-step"><span class="utl-voice-step-number">2</span><div class="utl-voice-graphic"><div class="utl-voice-window" aria-hidden="true"><div class="utl-voice-window-bar"><i></i><i></i><i></i></div><div class="utl-voice-compose"><span class="utl-voice-mic"></span><span class="utl-voice-button-highlight"><span class="utl-voice-button-demo"><span><i></i><i></i><i></i><i></i><i></i></span></span></span></div><p class="utl-voice-callout">Select the highlighted button</p></div></div><h3>Start voice mode</h3><p>Select the blue voice button at the bottom right. Allow microphone access if asked.</p></li>',
    '<li class="utl-voice-step"><span class="utl-voice-step-number">3</span><div class="utl-voice-graphic"><span class="utl-voice-talk-icon" aria-hidden="true">🎙</span></div><h3>Practice out loud</h3><p>Explain your situation and respond naturally. Return here when you finish.</p></li>',
    '</ol>',
    '<p class="utl-voice-note"><strong>Cannot use voice?</strong> You can complete the same practice in text. The voice button may look slightly different on another device or version of ChatGPT.</p>',
    '<div class="utl-voice-actions"><a class="utl-voice-open" target="_blank" rel="noopener">Open CustomGPT</a><button class="utl-voice-text" type="button">Continue with text instead</button></div>',
    '<label class="utl-voice-preference"><input type="checkbox"> Do not show these instructions again</label></div>'
  ].join("");
  document.body.appendChild(dialog);

  var activeUrl = "";
  var activeLabel = "Open CustomGPT";
  var closeButton = dialog.querySelector(".utl-voice-close");
  var openLink = dialog.querySelector(".utl-voice-open");
  var textButton = dialog.querySelector(".utl-voice-text");
  var preference = dialog.querySelector(".utl-voice-preference input");

  function rememberPreference() {
    try {
      if (preference.checked) localStorage.setItem(STORAGE_KEY, "true");
    } catch (error) {}
  }

  function closeDialog() {
    rememberPreference();
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  function launch() {
    rememberPreference();
    window.open(activeUrl, "_blank", "noopener");
    closeDialog();
  }

  function shouldSkip() {
    try { return localStorage.getItem(STORAGE_KEY) === "true"; } catch (error) { return false; }
  }

  function showGuide(trigger, event, honorPreference) {
      if (honorPreference && shouldSkip()) return;
      event.preventDefault();
      activeUrl = trigger.href;
      activeLabel = trigger.dataset.voiceGuideLabel || trigger.textContent.trim() || "Open CustomGPT";
      openLink.href = activeUrl;
      openLink.textContent = activeLabel;
      preference.checked = false;
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      window.requestAnimationFrame(function () { closeButton.focus(); });
  }

  triggers.forEach(function (trigger) {
    trigger.addEventListener("click", function (event) { showGuide(trigger, event, true); });
  });
  helpTriggers.forEach(function (trigger) {
    trigger.addEventListener("click", function (event) {
      var launchTrigger = document.querySelector("[data-custom-gpt-voice-guide]");
      showGuide(launchTrigger, event, false);
    });
  });

  closeButton.addEventListener("click", closeDialog);
  openLink.addEventListener("click", function () { rememberPreference(); closeDialog(); });
  textButton.addEventListener("click", launch);
  dialog.addEventListener("click", function (event) {
    if (event.target === dialog) closeDialog();
  });
})();
