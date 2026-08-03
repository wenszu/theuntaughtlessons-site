(function () {
  var MP = 5;
  var CONTEXTS = {
    "grocery-list": ["p1-e1", "phase1", "video", "Before your first day", "You have just arrived in Tokyo for your new role at MA. Aiko expects clarity from day one, so practice it before starting your role.", "https://drive.google.com/file/d/1O9Uyc_3XmP4XfltPQJ7T-zPUba6fdiJJ/view?usp=vids_web"],
    "grocery-list-ai": ["p1-e2", "phase1", "slides", "Try the same task with AI", "Compare your own sorting choices with an AI-assisted approach and notice what the prompt makes clear.", "https://docs.google.com/presentation/d/1p0bvALYVQ_U-FGFfUx47W05sQuy4GQRka_-N079n9J0/edit?slide=id.g3e2ad370f6d_0_717"],
    "rushed-voice-memo": ["p1-e4", "phase1", "video", "Hugh needs a favour", "Hugh needs a favor and the information is messy. Slow the situation down and make the request easier to understand.", "https://drive.google.com/file/d/1EZe8wYzQvic6DaFJwraixATYR6Kx18oM/view?usp=vids_web"],
    "rushed-voice-memo-ai": ["p1-e5", "phase1", "slides", "Try the same memo with AI", "Compare your restructuring choices with another structured draft before using AI.", "https://docs.google.com/presentation/d/1p0bvALYVQ_U-FGFfUx47W05sQuy4GQRka_-N079n9J0/edit?slide=id.g3e2ad370f6d_0_1347"],
    "chalkboard-notes": ["p1-e6", "phase1", "video", "Aiko needs the Olympic brainstorm sorted", "Turn the brainstorm fragments into something the team can use. Clean up the clutter and make the structure visible.", "https://drive.google.com/file/d/1kuQ7yqGvwjRnGufN4ZHMIAcqtdLq9NfN/view?usp=vids_web"],
    "issue-tree-builder": ["p2-e1", "phase2", "video", "Aiko liked your work. Now she has a question.", "Create an issue tree that breaks the problem into clear, solvable parts.", "https://drive.google.com/file/d/15AaNTTkiRsIVf90RfsmcSa3aEuFTqOAT/view?usp=vids_web"],
    "scqa-builder": ["p2-e2", "phase2", "video", "Create an executive-ready brief for Aiko", "Make the work easier for Aiko to read by using the SCQA framework.", "https://drive.google.com/file/d/10GgHE70T14fcp4tvGF3gsltwsGgp-HXQ/view?usp=sharing"],
    "advisory-board": ["p2-e3", "phase2", "video", "Get outside perspectives before you commit", "Use expert perspectives to test your thinking before committing to a recommendation.", "https://drive.google.com/file/d/1hNWuA1HBbZI57fUfDgdjlqLkJHYHjf1Q/view?usp=vids_web"],
    "write-to-aiko": ["p2-e4", "phase2", "video", "Aiko does not have time to read everything", "Aiko needed the reply yesterday. Prepare an answer-first email she can use quickly.", "https://drive.google.com/open?id=1Tw0MhCjy5Tkdodjy8LvIEB-XEEuK4Di3&usp=drive_copy"],
    "explain-to-aiko": ["p2-e5", "phase2", "video", "You bumped into Aiko", "Prepare a clear 120-second explanation of the same answer.", "https://drive.google.com/file/d/17Nbk0w7C3MuEfwb_gsBn9oipmZ85exJ4/view"],
    "explain-to-aiko-v2": ["p2-e5", "phase2", "video", "You bumped into Aiko", "Prepare a clear 120-second explanation of the same answer.", "https://drive.google.com/file/d/17Nbk0w7C3MuEfwb_gsBn9oipmZ85exJ4/view"],
    "explain-to-aiko-60": ["p2-e6", "phase2", "video", "Now compress it", "Deliver the same key points in 60 seconds or less.", "https://drive.google.com/file/d/1LSc2dnbgk855FeG7R4WvWvf8P0kLJCpb/view"],
    "explain-to-aiko-60-v2": ["p2-e6", "phase2", "video", "Now compress it", "Deliver the same key points in 60 seconds or less.", "https://drive.google.com/file/d/1LSc2dnbgk855FeG7R4WvWvf8P0kLJCpb/view"],
    "eisenhower-matrix": ["p3-e1", "phase3", "video", "You just got the lead role", "Requests are coming from every direction. Decide what matters and be ready to explain your choices.", "https://drive.google.com/open?id=18UnP9dxWd31EeCfEfODiPBQ-Jfyxbd8Q&usp=drive_copy"],
    "eisenhower-matrix-v2": ["p3-e1", "phase3", "video", "You just got the lead role", "Requests are coming from every direction. Decide what matters and be ready to explain your choices.", "https://drive.google.com/open?id=18UnP9dxWd31EeCfEfODiPBQ-Jfyxbd8Q&usp=drive_copy"],
    "i-have-bad-news": ["p3-e2", "phase3", "video", "You have to be the one to say it", "Something has gone wrong. Say it plainly without making the conversation worse.", "https://drive.google.com/file/d/1m04hT3TUZkaKZN8-f0zlWWOBLA1DS6fF/view?usp=vids_web"],
    "lets-switch-hats": ["p3-e3", "phase3", "video", "Read the room before you speak", "Understand the other person's constraints, incentives, and version of success before pushing your point.", "https://drive.google.com/file/d/1UVaAj5EG7Kg4c1uZhXaR0bqwasgtjQgS/view?usp=vids_web"],
    "speak-like-obama": ["p3-e4", "phase3", "video", "All eyes are on you", "Act as your team's voice and lead with confidence.", "https://drive.google.com/file/d/1ndtAyGJpud5jDA5pLyYoGmqOJOeFabPO/view?usp=vids_web"]
  };

  function appKey() {
    var match = location.pathname.match(/\/apps\/([^/]+)/);
    return match ? match[1] : "";
  }

  function embedUrl(url, type) {
    if (type === "slides") return url.replace(/\/edit(?:\?.*)?$/, "/embed");
    var id = (url.match(/\/file\/d\/([^/]+)/) || url.match(/[?&]id=([^&]+)/) || [])[1];
    return id ? "https://drive.google.com/file/d/" + id + "/preview" : url;
  }

  function isComplete(id) {
    return localStorage.getItem("utl_context_complete_" + id) === "true";
  }

  function injectStyles() {
    if (document.getElementById("utl-context-flow-styles")) return;
    var style = document.createElement("style");
    style.id = "utl-context-flow-styles";
    style.textContent = ".utl-context-review-link{display:inline-flex;margin:8px 0 0 12px;padding:0;border:0;background:transparent;color:rgba(255,255,255,.82);font:700 13px Lato,Arial,sans-serif;cursor:pointer;text-decoration:underline;text-underline-offset:3px}.utl-context-gate{position:fixed;left:0;right:0;bottom:0;z-index:8500;overflow:auto;background:#F3EDE2;padding:22px;font-family:Lato,Arial,sans-serif}.utl-context-card{width:min(1060px,100%);margin:auto;border:1px solid #C7D8E8;border-radius:12px;background:#fff;overflow:hidden}.utl-context-tabs{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #C7D8E8;background:#F2ECE3}.utl-context-tab{min-height:52px;display:flex;align-items:center;justify-content:center;gap:8px;border:0;background:transparent;color:#003366;font:700 14px Lato,Arial,sans-serif}.utl-context-tab:first-child{background:#fff;box-shadow:inset 0 4px 0 #EEA320}.utl-context-tab[type=button]:not(:disabled){cursor:pointer}.utl-context-tab[type=button]:not(:disabled):hover{background:#FFF8E8}.utl-context-tab:disabled{color:#7890A8;cursor:not-allowed}.utl-context-tab span{display:grid;width:24px;height:24px;place-items:center;border-radius:50%;background:#FFF1CF;font-size:11px}.utl-context-body{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(260px,.7fr);gap:22px;padding:22px}.utl-context-media{aspect-ratio:16/9;overflow:hidden;border-radius:8px;background:#003366}.utl-context-media iframe{width:100%;height:100%;border:0}.utl-context-help{display:flex;justify-content:space-between;gap:10px;margin-top:8px;color:#4D7094;font-size:12px}.utl-context-help a{color:#003366;font-weight:700}.utl-context-copy{align-self:center}.utl-context-copy small{color:#EEA320;font-weight:700}.utl-context-copy h1{margin:6px 0 10px;color:#003366;font:700 clamp(30px,4vw,43px)/1.08 'Playfair Display',Georgia,serif}.utl-context-copy p{margin:0 0 18px;color:#4D7094;font-size:16px;line-height:1.55}.utl-context-status{color:#2C7A4B!important;font-size:13px!important;font-weight:700}.utl-context-action{width:100%;min-height:50px;border:0;border-radius:8px;background:#EEA320;color:#003366;font-weight:700;cursor:pointer}.utl-context-back{display:inline-flex;margin-top:14px;color:#003366;font-size:13px;font-weight:700;text-decoration:none}@media(max-width:760px){.utl-context-review-link{margin-left:8px;font-size:11px}.utl-context-gate{padding:12px}.utl-context-body{grid-template-columns:1fr;padding:14px}.utl-context-tab{min-height:47px;font-size:12px}.utl-context-copy h1{font-size:29px}}";
    document.head.appendChild(style);
  }

  function attach() {
    if (document.getElementById("exerciseSetup")) return;
    var config = CONTEXTS[appKey()];
    if (!config) return;
    injectStyles();
    var backLink = Array.prototype.find.call(document.querySelectorAll("a"), function (link) {
      return /back to learning journey/i.test(link.textContent || "");
    });
    if (backLink && !document.querySelector(".utl-context-review-link")) {
      var reviewButton = document.createElement("button");
      reviewButton.type = "button";
      reviewButton.className = "utl-context-review-link";
      reviewButton.textContent = "Review setup";
      reviewButton.addEventListener("click", function () {
        var reviewUrl = new URL(location.href);
        reviewUrl.searchParams.set("setup", "1");
        location.href = reviewUrl.href;
      });
      backLink.insertAdjacentElement("afterend", reviewButton);
    }
    var params = new URLSearchParams(location.search);
    if (isComplete(config[0]) && params.get("setup") !== "1") return;
    var gate = document.createElement("section");
    gate.className = "utl-context-gate";
    gate.setAttribute("aria-label", "Exercise setup");
    var header = document.querySelector(".app-header,.ab-header,.eisenhower-header,.tsa-speak-header,.bad-news-header,.lsh-header,.slo-header,.write-to-aiko-header");
    function positionGate() {
      gate.style.top = Math.max(0, Math.ceil(header ? header.getBoundingClientRect().bottom : 0)) + "px";
    }
    var done = isComplete(config[0]);
    var journey = "../../member-login/index.html?phase=" + config[1] + "#learning-journey";
    gate.innerHTML = '<article class="utl-context-card"><div class="utl-context-tabs"><div class="utl-context-tab"><span>1</span>Review the setup</div><button class="utl-context-tab utl-context-exercise-tab" type="button" ' + (done ? "" : "disabled ") + 'aria-label="' + (done ? "Continue to the exercise" : "Complete the setup to unlock the exercise") + '"><span>2</span>Complete the exercise</button></div><div class="utl-context-body"><div><div class="utl-context-media"><iframe src="' + embedUrl(config[5], config[2]) + '" title="' + config[3] + '" allow="autoplay; fullscreen" allowfullscreen></iframe></div><div class="utl-context-help"><span>' + (config[2] === "slides" ? "Slides not opening?" : "Video not opening?") + '</span><a href="' + config[5] + '" target="_blank" rel="noopener">Open in a new tab</a></div></div><div class="utl-context-copy"><small>Before you begin</small><h1>' + config[3] + '</h1><p>' + config[4] + '</p>' + (done ? '<p class="utl-context-status">✓ Setup complete. Your progress is saved.</p>' : '') + '<button class="utl-context-action" type="button">' + (done ? "Continue to the exercise →" : "Mark setup complete and continue · +" + MP + " MP") + '</button><a class="utl-context-back" href="' + journey + '">← Back to Learning Journey</a></div></div></article>';
    function continueToExercise() {
      var wasDone = isComplete(config[0]);
      localStorage.setItem("utl_context_complete_" + config[0], "true");
      if (!wasDone && window.UTLRewardEvents && window.UTLRewardEvents.awardEvent) {
        window.UTLRewardEvents.awardEvent({ eventId: "context:" + config[0], type: "context-completed", title: config[3], body: "Setup complete. Your preparation was saved.", mpEarned: MP, metadata: { contextId: config[0] } });
        window.UTLRewardEvents.recordPracticeActivity?.("context:" + config[0]);
      }
      gate.remove();
      window.scrollTo(0, 0);
    }
    gate.querySelector(".utl-context-action").addEventListener("click", continueToExercise);
    gate.querySelector(".utl-context-exercise-tab").addEventListener("click", continueToExercise);
    document.body.appendChild(gate);
    positionGate();
    window.addEventListener("resize", positionGate, { passive: true });
  }

  window.UTLExerciseContextFlow = { attach: attach };
})();
