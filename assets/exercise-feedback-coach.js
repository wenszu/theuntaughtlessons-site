(function () {
  const STYLE_ID = "utl-feedback-coach-style";
  const DIALOG_ID = "utl-feedback-coach-dialog";
  let currentPrompt = "";

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character];
    });
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .utl-coach-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:16px 0}
      .utl-coach-card{border:1px solid var(--line,#c7d8e8);border-radius:8px;background:#fff;padding:14px}
      .utl-coach-card small{display:block;margin-bottom:6px;color:var(--steel,#4d7094);font-weight:700}
      .utl-coach-card span{display:block;color:var(--charcoal,#333);line-height:1.4}
      .utl-coach-prompt{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-top:16px;padding:15px;border:1px solid #bdd2e5;border-radius:8px;background:#eef5fa}
      .utl-coach-prompt strong{display:block;color:var(--navy,#003366)}.utl-coach-prompt span{display:block;margin-top:3px;color:var(--steel,#4d7094);font-size:13px}
      .utl-coach-prompt button{flex:0 0 auto;min-height:42px;border:0;border-radius:7px;background:var(--navy,#003366);color:#fff;padding:0 15px;font:700 14px Lato,Arial,sans-serif;cursor:pointer}
      .utl-coach-comparison{margin-bottom:15px;border:1px solid #e8bd68;border-radius:8px;background:#fff8e8;padding:14px}
      .utl-coach-comparison>strong{display:block;color:var(--navy,#003366);font-size:17px}.utl-coach-comparison>p{margin:4px 0 12px;color:var(--steel,#4d7094);font-size:13px}
      .utl-coach-insights{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.utl-coach-insight{border-radius:7px;background:#fff;padding:10px}.utl-coach-insight small{display:block;color:var(--steel,#4d7094);font-weight:700}.utl-coach-insight span{display:block;margin-top:3px;color:var(--charcoal,#333);font-size:13px;line-height:1.4}
      .utl-coach-dialog{width:min(720px,calc(100vw - 28px));max-height:88dvh;overflow:hidden;border:0;border-radius:12px;padding:0;box-shadow:0 22px 70px rgba(0,31,61,.3);color:var(--charcoal,#333);overscroll-behavior:contain}.utl-coach-dialog::backdrop{background:rgba(0,31,61,.58)}
      .utl-coach-dialog-head{display:flex;justify-content:space-between;gap:20px;padding:20px 22px 16px;border-bottom:1px solid var(--line,#c7d8e8)}.utl-coach-dialog-head h2{margin:0;color:var(--navy,#003366);font:700 25px/1.2 "Playfair Display",Georgia,serif}
      .utl-coach-dialog-close{display:grid;width:32px;height:32px;flex:0 0 32px;place-items:center;padding:0;border:1px solid #d7e0e8;border-radius:50%;background:#fff;color:var(--steel,#4d7094);cursor:pointer}.utl-coach-dialog-close:hover{border-color:var(--navy,#003366);color:var(--navy,#003366);background:#f7fafc}.utl-coach-dialog-close svg{width:15px;height:15px;pointer-events:none}
      .utl-coach-dialog-body{max-height:calc(88dvh - 78px);overflow-y:auto;overscroll-behavior:contain;padding:18px 22px 22px}.utl-coach-privacy{margin:0 0 13px;padding:11px 13px;border-radius:7px;background:#eef5fa;color:var(--navy,#003366);font-size:13px}.utl-coach-dialog-body label{display:block;color:var(--navy,#003366);font-weight:700}.utl-coach-scroll-cue{display:flex;align-items:center;gap:6px;margin:5px 0 0;color:var(--steel,#4d7094);font-size:12px}.utl-coach-scroll-cue::before{content:"↓";color:var(--gold,#eea320);font-weight:700}.utl-coach-prompt-text{box-sizing:border-box;width:100%;height:min(390px,48dvh);min-height:220px;max-height:52dvh;overflow:auto;overscroll-behavior:contain;margin-top:7px;resize:vertical;border:1px solid var(--line,#c7d8e8);border-radius:8px;padding:12px;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
      .utl-coach-dialog-actions{display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:12px}.utl-coach-copy-status{margin-right:auto;color:#2c7a4b;font-size:13px}.utl-coach-dialog-actions button{min-height:42px;border:1px solid var(--navy,#003366);border-radius:7px;padding:0 15px;background:#fff;color:var(--navy,#003366);font-weight:700;cursor:pointer}.utl-coach-dialog-actions .primary{background:var(--navy,#003366);color:#fff}
      @media(max-width:700px){.utl-coach-summary,.utl-coach-insights{grid-template-columns:1fr}.utl-coach-prompt{align-items:stretch;flex-direction:column}.utl-coach-dialog-body{max-height:calc(92dvh - 72px);padding:15px}.utl-coach-prompt-text{height:42dvh;min-height:190px;max-height:48dvh}.utl-coach-dialog-actions{align-items:stretch;flex-direction:column}.utl-coach-copy-status{margin:0}.utl-coach-dialog-actions button{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function ensureDialog() {
    injectStyles();
    let dialog = document.getElementById(DIALOG_ID);
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.id = DIALOG_ID;
    dialog.className = "utl-coach-dialog";
    dialog.setAttribute("aria-labelledby", "utlCoachDialogTitle");
    dialog.innerHTML = `<div class="utl-coach-dialog-head"><div><small id="utlCoachDialogKicker">Optional AI coaching</small><h2 id="utlCoachDialogTitle">Use the AI tool you prefer.</h2></div><button class="utl-coach-dialog-close" type="button" aria-label="Close AI prompt"><svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg></button></div><div class="utl-coach-dialog-body"><p class="utl-coach-privacy"><strong>Nothing is sent automatically.</strong> This prompt is prepared in your browser. Review it, copy it, and paste it into the AI tool of your choice.</p><label for="utlCoachPromptText" id="utlCoachPromptLabel">Your feedback prompt</label><p class="utl-coach-scroll-cue">Scroll inside the prompt to read it in full.</p><textarea class="utl-coach-prompt-text" id="utlCoachPromptText" readonly></textarea><div class="utl-coach-dialog-actions"><span class="utl-coach-copy-status" aria-live="polite"></span><button data-utl-coach-cancel type="button">Cancel</button><button class="primary" data-utl-coach-copy type="button">Copy prompt</button></div></div>`;
    document.body.appendChild(dialog);
    const close = function () { if (typeof dialog.close === "function") dialog.close(); else { dialog.removeAttribute("open"); restorePageScroll(); } };
    dialog.querySelector(".utl-coach-dialog-close").addEventListener("click", close);
    dialog.querySelector("[data-utl-coach-cancel]").addEventListener("click", close);
    dialog.addEventListener("click", function (event) { if (event.target === dialog) close(); });
    dialog.addEventListener("close", restorePageScroll);
    dialog.querySelector("[data-utl-coach-copy]").addEventListener("click", async function (event) {
      const textarea = dialog.querySelector(".utl-coach-prompt-text");
      try { await navigator.clipboard.writeText(currentPrompt); }
      catch (error) { textarea.focus(); textarea.select(); document.execCommand("copy"); }
      dialog.querySelector(".utl-coach-copy-status").textContent = "Copied. Paste it into the AI tool you prefer.";
      event.currentTarget.textContent = "Copied ✓";
      setTimeout(function () { event.currentTarget.textContent = "Copy prompt"; }, 1800);
    });
    return dialog;
  }

  let previousPageOverflow = "";

  function lockPageScroll() {
    previousPageOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
  }

  function restorePageScroll() {
    document.documentElement.style.overflow = previousPageOverflow;
  }

  function promptText(options) {
    const criteria = (options.criteria || []).map(function (item, index) { return `${index + 1}. ${item}`; }).join("\n");
    const signals = (options.signals || []).map(function (item, index) { return `${index + 1}. ${item}`; }).join("\n");
    return `You are a practical coach. Review my response to ${options.title || "this exercise"}.

THE GOAL
${options.goal || "Give clear, useful feedback that I can apply in my next attempt."}

USE THESE CRITERIA
${criteria}

MY RESPONSE
${options.response || "No written response was provided."}

${options.sample ? `ONE SAMPLE APPROACH\n${options.sample}\n\nUse the sample as one possible approach. Focus on the quality of the thinking and communication.\n\n` : ""}${signals ? `CURRENT RULE BASED SIGNALS\n${signals}\n\n` : ""}Return your feedback in five numbered sections:
1. One specific strength, quoting a short phrase from my response
2. The single most important improvement, with evidence from my response
3. Important information or thinking I missed or made unclear
4. A revised version of only the weakest part
5. A two sentence explanation of why that revision is stronger

Use only information found in my response or the sample. Keep the feedback concise and constructive.`;
  }

  function openPrompt(options) {
    currentPrompt = promptText(options || {});
    const dialog = ensureDialog();
    dialog.querySelector("#utlCoachDialogKicker").textContent = "Optional AI coaching";
    dialog.querySelector("#utlCoachDialogTitle").textContent = "Use the AI tool you prefer.";
    dialog.querySelector("#utlCoachPromptLabel").textContent = "Your feedback prompt";
    dialog.querySelector(".utl-coach-prompt-text").value = currentPrompt;
    dialog.querySelector(".utl-coach-copy-status").textContent = "";
    lockPageScroll();
    if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
    requestAnimationFrame(function () { dialog.querySelector("[data-utl-coach-copy]").focus(); });
  }

  function openPreparedPrompt(prompt, options) {
    const settings = options || {};
    currentPrompt = String(typeof prompt === "function" ? prompt() : prompt || "").trim();
    const dialog = ensureDialog();
    dialog.querySelector("#utlCoachDialogKicker").textContent = settings.kicker || "AI assisted activity";
    dialog.querySelector("#utlCoachDialogTitle").textContent = settings.dialogTitle || "Use the AI tool you prefer.";
    dialog.querySelector("#utlCoachPromptLabel").textContent = settings.promptLabel || "Your prepared prompt";
    dialog.querySelector(".utl-coach-prompt-text").value = currentPrompt;
    dialog.querySelector(".utl-coach-copy-status").textContent = "";
    lockPageScroll();
    if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
    requestAnimationFrame(function () { dialog.querySelector("[data-utl-coach-copy]").focus(); });
  }

  function promptActionHtml() {
    return `<div class="utl-coach-prompt"><div><strong>Want a more personalized critique?</strong><span>Prepare a prompt with your response, the criteria, and the sample. Then use it in the AI tool you choose.</span></div><button type="button" data-utl-coach-open>Prepare AI feedback prompt</button></div>`;
  }

  function mountPrompt(options) {
    injectStyles();
    const mount = typeof options.mount === "string" ? document.querySelector(options.mount) : options.mount;
    if (!mount) return;
    mount.querySelector("[data-utl-coach-root]")?.remove();
    const root = document.createElement("div");
    root.setAttribute("data-utl-coach-root", "");
    root.innerHTML = promptActionHtml();
    mount.appendChild(root);
    root.querySelector("[data-utl-coach-open]").addEventListener("click", function () {
      const resolved = Object.assign({}, options, {
        response: typeof options.response === "function" ? options.response() : options.response,
        sample: typeof options.sample === "function" ? options.sample() : options.sample,
        signals: typeof options.signals === "function" ? options.signals() : options.signals
      });
      openPrompt(resolved);
    });
  }

  function mountPreparedPrompt(options) {
    injectStyles();
    const mount = typeof options.mount === "string" ? document.querySelector(options.mount) : options.mount;
    if (!mount) return;
    mount.querySelector("[data-utl-coach-root]")?.remove();
    const root = document.createElement("div");
    root.setAttribute("data-utl-coach-root", "");
    root.innerHTML = `<div class="utl-coach-prompt"><div><strong>${escapeHtml(options.heading || "Prepare your AI prompt")}</strong><span>${escapeHtml(options.description || "Review the prepared prompt, then copy it into the AI tool you choose.")}</span></div><button type="button" data-utl-coach-open>${escapeHtml(options.buttonLabel || "Prepare AI prompt")}</button></div>`;
    mount.appendChild(root);
    root.querySelector("[data-utl-coach-open]").addEventListener("click", function () { openPreparedPrompt(options.prompt, options); });
  }

  window.UTLFeedbackCoach = { mountPrompt, mountPreparedPrompt, openPrompt, openPreparedPrompt, promptText, promptActionHtml };
})();
