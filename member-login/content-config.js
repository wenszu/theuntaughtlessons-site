const UTL_CONTENT = {
  orientation: {
    videoUrl: "https://drive.google.com/open?id=19q9wU__985LRFgY_3uWawiAVJJOmhI9k&usp=drive_copy",
    contexts: [
      {
        id: "orientation-start",
        contextType: "text",
        contextUrl: "",
        contextTitle: "Welcome to MA!",
        contextBody: "You are now Chief of Staff to Aiko Mori, founder of MA, one of the most prestigious marketing agencies in the world. This is the biggest move of your career so far.\n\nAt MA, work moves quickly. Information arrives incomplete, priorities shift constantly, and decisions need to be made before everything feels ready. As the newest addition to Aiko's team, she expects you to bring clarity into that environment.\n\nThink clearly when information is cluttered. Speak concisely when attention is limited. Act confidently when there is pressure, uncertainty, or risk.\n\nYour role is simple: help Aiko move from chaos to clarity.\n\nTo prepare you for this role, Aiko has suggested that you take The Untaught Lessons, a course built around the real skills people are expected to have at work but are rarely taught directly. Over the next set of exercises, you will step into situations that mirror the kinds of problems MA teams deal with every day: messy updates, rushed conversations, unclear priorities, difficult decisions, and high-stakes communication.\n\nWelcome to MA."
      },
      {
        id: "orientation-welcome",
        legacyEmbedKey: "utl_embed_orientation_welcome",
        contextType: "video",
        contextUrl: "https://drive.google.com/open?id=19q9wU__985LRFgY_3uWawiAVJJOmhI9k&usp=drive_copy",
        contextTitle: "Welcome to The Untaught Lessons",
        contextBody: "Start with a short welcome before moving into the program flow."
      }
    ]
  },
  phase1: {
    title: "Think clearly",
    description: "Build clean structure before you communicate. Watch the lessons, then practice turning messy inputs into clear thinking.",
    lessons: [
      { id: "p1-l1", title: "KonMari for the cluttered mind", duration: "9 min 35 sec", videoUrl: "https://drive.google.com/file/d/1JogKtDiCfhNjNckFLhOEJCCw7gh7eORq/view?usp=sharing" },
      { id: "p1-l2", title: "Rule of three", duration: "8 min 26 sec", videoUrl: "https://drive.google.com/open?id=1fFBBPC0JbHf1IPeHIz_9yKrp173coxJM&usp=drive_copy" },
      { id: "p1-l3", title: "Bolded summary phrases (BSP)", duration: "8 min 21 sec", videoUrl: "https://drive.google.com/open?id=1ZSKGHTUSZs2T3g3aTMgQ9fk9lHg_fN34&usp=drive_copy" }
    ],
    introContexts: [
      {
        id: "p1-welcome-ma",
        legacyEmbedKey: "utl_embed_p1_welcome_ma",
        contextType: "video",
        contextUrl: "https://drive.google.com/file/d/1BdvDKLdjPz931sPVHSwTvcZT0u72Rcn1/view",
        contextTitle: "Welcome to MA",
        contextBody: "The journey that you will undertake in the program."
      }
    ],
    exercises: [
      {
        id: "p1-e1",
        estimatedMinutes: 10,
        legacyDoneKey: "utl_p1_ex1_done",
        legacyEmbedKey: "utl_embed_p1_first_day",
        title: "Grocery list",
        type: "Sort & bucket",
        description: "Apply MECE thinking by sorting a messy grocery list into clean, non-overlapping categories.",
        appUrl: "../apps/grocery-list/index.html",
        contextType: "video",
        contextUrl: "https://drive.google.com/file/d/1O9Uyc_3XmP4XfltPQJ7T-zPUba6fdiJJ/view?usp=vids_web",
        contextTitle: "Before your first day",
        contextBody: "You have just arrived in Tokyo for your new role at MA as CEO's Chief of Staff. Before jumping into onboarding, you need to get your personal life in order. Aiko expects clarity from day one, so practice it before starting your role."
      },
      {
        id: "p1-e2",
        estimatedMinutes: 15,
        legacyDoneKey: "utl_p1_ex2_done",
        legacyEmbedKey: "utl_embed_p1_ai_grocery",
        title: "Grocery list with AI",
        type: "AI prompting",
        description: "Use AI to improve your grocery-list structure and compare the result against your own MECE logic.",
        appUrl: "../apps/grocery-list-ai/index.html",
        contextType: "slides",
        contextUrl: "https://docs.google.com/presentation/d/1p0bvALYVQ_U-FGFfUx47W05sQuy4GQRka_-N079n9J0/edit?slide=id.g3e2ad370f6d_0_717",
        contextTitle: "Try the same task with AI",
        contextBody: "Now that you have practiced sorting the list yourself, try the same task with AI and pay attention to what the prompt does or does not make clear."
      },
      {
        id: "p1-e3",
        estimatedMinutes: 15,
        legacyDoneKey: "utl_p1_ex3_done",
        legacyEmbedKey: "utl_embed_p1_message_desk",
        title: "Manager's messy notes",
        type: "Restructure",
        description: "Turn a disorganized message into a structured, decision-ready response using MECE, Rule of three, and BSP.",
        appUrl: "../apps/messy-notes/index.html",
        contextType: "video",
        contextUrl: "https://drive.google.com/file/d/1JpPDKz5RTyWFIJxUkeKSB5etP4W57Dax/view?usp=vids_web",
        contextTitle: "A message just landed on your desk",
        contextBody: "One of Aiko's direct reports, Ashley, just sent a cluttered update for Aiko. She needs you to turn it into something decision-ready before she's back. Apply the lessons from Phase 1 to get this done easily."
      },
      {
        id: "p1-e4",
        estimatedMinutes: 20,
        legacyDoneKey: "utl_p1_ex4_done",
        legacyEmbedKey: "utl_embed_p1_hugh_favour",
        title: "Rushed voice memo",
        type: "Voice structure",
        description: "Turn a rushed spoken update into a clear, actionable update using the principles of MECE, Rule of three, and BSP.",
        appUrl: "../apps/rushed-voice-memo/index.html",
        contextType: "video",
        contextUrl: "https://drive.google.com/file/d/1EZe8wYzQvic6DaFJwraixATYR6Kx18oM/view?usp=vids_web",
        contextTitle: "Hugh needs a favour",
        contextBody: "Hugh needs a favor and the information is messy. Your job is to slow the situation down and make the request easier to understand."
      },
      {
        id: "p1-e5",
        estimatedMinutes: 15,
        legacyDoneKey: "utl_p1_ex5_done",
        legacyEmbedKey: "utl_embed_p1_ai_memo",
        title: "Rushed voice memo with AI",
        type: "AI practice",
        description: "Use AI to pressure-test and improve the structure of a rushed memo response.",
        appUrl: "../apps/rushed-voice-memo-ai/index.html",
        contextType: "slides",
        contextUrl: "https://docs.google.com/presentation/d/1p0bvALYVQ_U-FGFfUx47W05sQuy4GQRka_-N079n9J0/edit?slide=id.g3e2ad370f6d_0_1347",
        contextTitle: "Try the same memo with AI",
        contextBody: "Use the AI version to compare your own restructuring choices against another structured draft."
      },
      {
        id: "p1-e6",
        estimatedMinutes: 25,
        legacyDoneKey: "utl_p1_ex6_done",
        legacyEmbedKey: "utl_embed_p1_olympic_brainstorm",
        title: "Chalkboard notes",
        type: "Synthesis",
        description: "Practice how to think clearly by cleaning up visual clutter into actionable and MECE insights.",
        appUrl: "../apps/chalkboard-notes/index.html",
        contextType: "video",
        contextUrl: "https://drive.google.com/file/d/1kuQ7yqGvwjRnGufN4ZHMIAcqtdLq9NfN/view?usp=vids_web",
        contextTitle: "Aiko needs the Olympic brainstorm session sorted",
        contextBody: "Aiko needs the Olympic brainstorm session turned into something the team can use. Clean up the fragments and make the structure visible."
      }
    ]
  },
  phase2: {
    title: "Speak concisely",
    description: "Move from structured thinking to sharp communication. Practice making the point first and making the logic easy to follow.",
    lessons: [
      { id: "p1-l4", title: "Wait, what's the problem again?", duration: "10 min 21 sec", videoUrl: "https://drive.google.com/open?id=1b2nAA0d-Rq-jetDuRQeAusttazKQa-Si&usp=drive_copy" },
      { id: "p1-l5", title: "Divide and conquer", duration: "6 min 1 sec", videoUrl: "https://drive.google.com/open?id=1hsdZTxdjNF2Yqsy9JRdC9jkc7wk5uGEO&usp=drive_copy" },
      { id: "p2-l1", title: "The executive storyline", duration: "7 min 38 sec", videoUrl: "https://drive.google.com/open?id=1BONR9sIQM-Mscia3ZaG-06lP6G2dTZP_&usp=drive_copy" },
      { id: "p2-l3", title: "The art of persuasion", duration: "12 min 38 sec", videoUrl: "https://drive.google.com/open?id=1Qxo0Mf_1I3_J_CLXf4CzKJvtZdxyz2kL&usp=drive_copy" }
    ],
    introContexts: [
      {
        id: "p2-recap",
        legacyEmbedKey: "utl_embed_p2_recap_storyline",
        contextType: "video",
        contextUrl: "https://drive.google.com/open?id=1A6lCodeBWSOQLNAEMOE4bpYYB5xJXWjb&usp=drive_copy",
        contextTitle: "Recap and storyline",
        contextBody: "Before moving into concise communication, reconnect the work to the MA storyline and the logic you built in Phase 1."
      }
    ],
    exercises: [
      {
        id: "p2-e1",
        estimatedMinutes: 15,
        legacyDoneKey: "utl_p2_ex1_done",
        legacyEmbedKey: "utl_embed_p2_aiko_question",
        title: "Issue tree builder",
        type: "Problem breakdown",
        description: "Build an issue tree to break down the problem into solvable parts.",
        appUrl: "../apps/issue-tree-builder/index.html",
        contextType: "video",
        contextUrl: "https://drive.google.com/file/d/15AaNTTkiRsIVf90RfsmcSa3aEuFTqOAT/view?usp=vids_web",
        contextTitle: "Aiko liked your work. Now she has a question.",
        contextBody: "Create an issue tree to break problems down into MECE parts for your answer to Aiko."
      },
      {
        id: "p2-e2",
        estimatedMinutes: 10,
        legacyDoneKey: "utl_p2_ex2_done",
        legacyEmbedKey: "utl_embed_p2_frame_answer",
        title: "Framing the storyline",
        type: "Storyline",
        description: "Using the issue tree, create an SCQA formulation.",
        appUrl: "../apps/scqa-builder/index.html",
        contextType: "video",
        contextUrl: "https://drive.google.com/open?id=168tYlq9fRUKl7NrlELHuwAPwAxC2_5yD&usp=drive_copy",
        contextTitle: "Create an executive-ready brief for Aiko.",
        contextBody: "You will need to make this more readable for Aiko. Use the SCQA framework to do so."
      },
      {
        id: "p2-e3",
        estimatedMinutes: 20,
        legacyDoneKey: "utl_p2_ex3_done",
        legacyEmbedKey: "utl_embed_p2_outside_perspectives",
        title: "Advisory board with AI",
        type: "AI advisory board",
        description: "Use AI to simulate outside perspectives before committing to a recommendation.",
        appUrl: "../apps/advisory-board/index.html",
        contextType: "video",
        contextUrl: "https://drive.google.com/file/d/1hNWuA1HBbZI57fUfDgdjlqLkJHYHjf1Q/view?usp=vids_web",
        contextTitle: "Get outside perspectives before you commit",
        contextBody: "Find expert opinions on your outputs."
      },
      {
        id: "p2-e4",
        estimatedMinutes: 15,
        legacyDoneKey: "utl_p2_ex4_done",
        legacyEmbedKey: "utl_embed_p2_aiko_email",
        title: "Write to Aiko",
        type: "Answer-first email",
        description: "Write a concise, answer-first email to Aiko using your SCQA logic.",
        appUrl: "../apps/write-to-aiko/index.html",
        contextType: "video",
        contextUrl: "https://drive.google.com/open?id=1Tw0MhCjy5Tkdodjy8LvIEB-XEEuK4Di3&usp=drive_copy",
        contextTitle: "Aiko does not have time to read everything",
        contextBody: "Aiko needed the reply yesterday. She needs the email ASAP."
      },
      {
        id: "p2-e5",
        estimatedMinutes: 15,
        legacyDoneKey: "utl_p2_ex5_done",
        legacyEmbedKey: "utl_embed_p2_hallway",
        title: "Explain to Aiko (120s)",
        type: "Spoken explanation",
        description: "Prepare and record a 120-second spoken explanation of the same answer.",
        appUrl: "../apps/explain-to-aiko/index.html",
        contextType: "video",
        contextUrl: "https://drive.google.com/file/d/17Nbk0w7C3MuEfwb_gsBn9oipmZ85exJ4/view",
        contextTitle: "You bumped into Aiko",
        contextBody: "Aiko said you can send her a quick voice message; she does not mind this time."
      },
      {
        id: "p2-e6",
        estimatedMinutes: 15,
        legacyDoneKey: "utl_p2_ex6_done",
        legacyEmbedKey: "utl_embed_p2_compress",
        title: "Explain to Aiko (60s)",
        type: "Elevator pitch",
        description: "Compress the same message into 60 seconds or less.",
        appUrl: "../apps/explain-to-aiko-60/index.html",
        contextType: "video",
        contextUrl: "https://drive.google.com/file/d/1LSc2dnbgk855FeG7R4WvWvf8P0kLJCpb/view",
        contextTitle: "Now compress it",
        contextBody: "Now, instead of 120 seconds, see if you can deliver the key points in 60 seconds or less."
      }
    ]
  },
  phase3: {
    title: "Act confidently",
    description: "Practice judgment under pressure. Decide what matters, read the room, and speak with steadiness when the stakes rise.",
    lessons: [
      { id: "p3-l1", title: "How to read people", duration: "7 min 19 sec", videoUrl: "https://drive.google.com/open?id=1YUxx3D7GsLXzKZLG4SlvNrk8jWVgvM0_&usp=drive_copy" },
      { id: "p3-l2", title: "Let's switch hats", duration: "7 min 19 sec", videoUrl: "https://drive.google.com/open?id=1h9r_4E7IkQ_aTKtHd3bl6IYHxF3dozhO&usp=drive_copy" },
      { id: "p3-l3", title: "Speak like Obama", duration: "21 min 47 sec", videoUrl: "https://drive.google.com/open?id=1sYAwaMxQE85_rvxRMabJvDm5a3yjZ6oz&usp=drive_copy" },
      { id: "p3-l4", title: "The art of saying no", duration: "18 min 25 sec", videoUrl: "https://drive.google.com/open?id=1XCOBAWDlcTht8w_utWZKwkw8wfBO_gC5&usp=drive_copy" },
      { id: "p3-l5", title: "I have bad news...", duration: "7 min 7 sec", videoUrl: "https://drive.google.com/open?id=1RZxxq34xb3C6lpLxVYt5399a66ganrHG&usp=drive_copy" }
    ],
    introContexts: [
      {
        id: "p3-recap",
        legacyEmbedKey: "utl_embed_p3_recap_storyline",
        contextType: "video",
        contextUrl: "https://drive.google.com/file/d/1xJsxbjivMPHJvGKjWxtvPM0grgm2LiE-/view?usp=vids_web",
        contextTitle: "Recap and storyline",
        contextBody: "Before Phase 3, reconnect the storyline: you have built structure, practiced concise communication, and now need to act with judgment."
      }
    ],
    exercises: [
      {
        id: "p3-e1",
        estimatedMinutes: 30,
        legacyDoneKey: "utl_p3_ex1_done",
        legacyEmbedKey: "utl_embed_p3_lead_role",
        title: "The art of saying no",
        type: "Prioritize",
        description: "Everything feels important, but not everything is.",
        appUrl: "../apps/eisenhower-matrix/index.html",
        contextType: "video",
        contextUrl: "https://drive.google.com/open?id=18UnP9dxWd31EeCfEfODiPBQ-Jfyxbd8Q&usp=drive_copy",
        contextTitle: "You just got the lead role.",
        contextBody: "Requests are coming from every direction and Aiko will not tell you what to prioritize. She expects you to decide."
      },
      {
        id: "p3-e2",
        estimatedMinutes: 20,
        legacyDoneKey: "utl_p3_ex2_done",
        legacyEmbedKey: "utl_embed_p3_bad_news",
        title: "I have bad news...",
        type: "Difficult conversation",
        description: "Learn the art of being comfortable with difficult conversations.",
        appUrl: "../apps/i-have-bad-news/index.html",
        contextType: "video",
        contextUrl: "https://drive.google.com/file/d/1m04hT3TUZkaKZN8-f0zlWWOBLA1DS6fF/view?usp=vids_web",
        contextTitle: "You have to be the one to say it",
        contextBody: "Something has gone wrong, and you need to say it plainly without making the conversation worse."
      },
      {
        id: "p3-e3",
        estimatedMinutes: 15,
        legacyDoneKey: "utl_p3_ex3_done",
        legacyEmbedKey: "utl_embed_p3_read_room",
        title: "Let's switch hats",
        type: "Perspective taking",
        description: "You will need to understand how others think.",
        appUrl: "../apps/lets-switch-hats/index.html",
        contextType: "video",
        contextUrl: "https://drive.google.com/file/d/1UVaAj5EG7Kg4c1uZhXaR0bqwasgtjQgS/view?usp=vids_web",
        contextTitle: "Read the room before you speak",
        contextBody: "Before pushing your point, understand the other person's constraints, incentives, and version of success."
      },
      {
        id: "p3-e4",
        estimatedMinutes: 15,
        legacyDoneKey: "utl_p3_ex4_done",
        legacyEmbedKey: "utl_embed_p3_eyes_on_you",
        title: "Speak like Obama",
        type: "Executive presence",
        description: "Your task involves two things: being clear and being impactful. In short, deliver it with Obama-level presence.",
        appUrl: "../apps/speak-like-obama/index.html",
        contextType: "video",
        contextUrl: "https://drive.google.com/file/d/1ndtAyGJpud5jDA5pLyYoGmqOJOeFabPO/view?usp=vids_web",
        contextTitle: "All eyes are on you",
        contextBody: "Act as your team's voice and lead with confidence."
      }
    ]
  }
};

(function () {
  var SESSION_KEY = "utl_member_unlocked";
  var USER_KEY = "utl_member_username";
  var PROFILE_KEY = "utl_member_profile";
  var ADMIN_KEY = "utl_admin_auth";
  var ADMIN_PASSWORD_KEY = "utl_admin_password";
  var DEFAULT_ADMIN_PASSWORD = "utl2026_admin";
  var LOCAL_PW_ADMIN = "utl_local_pw_admin";
  var LOCAL_PW_TESTUSER = "utl_local_pw_testuser";
  var phases = ["phase1", "phase2", "phase3"];
  var phaseNumbers = { phase1: 1, phase2: 2, phase3: 3 };
  var phaseLabels = { phase1: "Phase 1", phase2: "Phase 2", phase3: "Phase 3" };
  var phaseFiles = { phase1: "phase-1.html", phase2: "phase-2.html", phase3: "phase-3.html" };
  var remoteProgressLoaded = false;
  var remoteProgressLoading = false;
  var remoteProgressSaveTimer = null;
  var rewardUiLoadPromise = null;
  var REWARD_STATE_KEY = "utl_rewards_state";
  var REWARD_SETTINGS_KEY = "utl_reward_settings";
  var VIDEO_COMPLETE_MP = 10;
  var CONTEXT_COMPLETE_MP = 5;
  var REWARD_LEVELS = [
    { name: "Intern", threshold: 0 },
    { name: "Analyst", threshold: 300 },
    { name: "Associate", threshold: 800 },
    { name: "Principal", threshold: 1350 },
    { name: "Executive", threshold: 1850 }
  ];
  var PROGRAM_COMPLETION_MP = 200;
  var phaseDescriptions = {
    phase1: "Learn to sort noise into signal.",
    phase2: "Turn structure into concise communication.",
    phase3: "Act with judgment when the answer is not obvious."
  };

  function inAdminRoot() {
    return /\/admin\/(?:index\.html)?$/.test(window.location.pathname);
  }

  function inPhasePracticeRoot() {
    return /\/member-login\/phase-1\/practice\/(?:index\.html)?$/.test(window.location.pathname);
  }

  function adminPreviewMode() {
    var params = new URLSearchParams(window.location.search || "");
    var adminSession = params.get("mode") === "admin" || localStorage.getItem(ADMIN_KEY) === "true";
    return adminSession && localStorage.getItem("utl_admin_preview_bypass") === "on";
  }

  function memberHref(file) {
    if (inPhasePracticeRoot()) return "../../" + file;
    return inAdminRoot() ? "../member-login/" + file : file;
  }

  function memberPath(file) {
    return inAdminRoot() ? "../member-login/" + file : file;
  }

  function appHref(path) {
    if (inPhasePracticeRoot()) return "../../" + path.replace(/^\.\.\//, "../");
    return inAdminRoot() ? path.replace(/^\.\.\//, "../") : path;
  }

  function homeHref() {
    return memberHref("index.html");
  }

  function publicSiteHref() {
    if (inPhasePracticeRoot()) return "../../../index.html";
    return "../index.html";
  }

  function adminHref() {
    if (inPhasePracticeRoot()) return "../../../admin/index.html";
    return inAdminRoot() ? "index.html" : "../admin/index.html";
  }

  function assetHref(path) {
    if (inPhasePracticeRoot()) return "../../" + path;
    return path;
  }

  function firebaseHref() {
    var version = "?v=20260712-program-reward-1";
    if (inPhasePracticeRoot()) return "../../../assets/firebase.js" + version;
    return (inAdminRoot() ? "../assets/firebase.js" : "../assets/firebase.js") + version;
  }

  function rewardUiHref() {
    var version = "?v=20260712-rewards-ui-12";
    if (inPhasePracticeRoot()) return "../../../assets/reward-ui.js" + version;
    return (inAdminRoot() ? "../assets/reward-ui.js" : "../assets/reward-ui.js") + version;
  }

  function ensureRewardUiLoaded() {
    if (window.UTLRewardUI) return Promise.resolve(window.UTLRewardUI);
    if (rewardUiLoadPromise) return rewardUiLoadPromise;
    rewardUiLoadPromise = new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-utl-reward-ui]');
      if (existing) {
        existing.addEventListener("load", function () { resolve(window.UTLRewardUI); });
        existing.addEventListener("error", reject);
        return;
      }
      var script = document.createElement("script");
      script.src = rewardUiHref();
      script.async = true;
      script.dataset.utlRewardUi = "true";
      script.onload = function () { resolve(window.UTLRewardUI); };
      script.onerror = reject;
      document.head.appendChild(script);
    }).catch(function (error) {
      console.warn("Reward UI failed to load.", error);
      return null;
    });
    return rewardUiLoadPromise;
  }

  function qs(selector, root) {
    return (root || document).querySelector(selector);
  }

  function qsa(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function readBool(key) {
    return localStorage.getItem(key) === "true";
  }

  function writeBool(key, value) {
    localStorage.setItem(key, value ? "true" : "false");
  }

  function rewardLevelForMp(mp) {
    var total = Math.max(0, Number(mp || 0));
    var current = REWARD_LEVELS[0];
    REWARD_LEVELS.forEach(function (level) {
      if (total >= level.threshold) current = level;
    });
    return current.name;
  }

  function applyRewardSettings(settings) {
    if (!settings || typeof settings !== "object") return;
    localStorage.setItem(REWARD_SETTINGS_KEY, JSON.stringify(settings));
    if (Array.isArray(settings.levels) && settings.levels.length) {
      REWARD_LEVELS = settings.levels.map(function (level) {
        return { name: level.name || level.title || "Level", threshold: Math.max(0, Number(level.threshold || 0)) };
      }).sort(function (a, b) { return a.threshold - b.threshold; });
    }
    if (settings.mp && Number.isFinite(Number(settings.mp.videoComplete))) {
      VIDEO_COMPLETE_MP = Math.max(0, Number(settings.mp.videoComplete));
    }
    if (settings.mp && Number.isFinite(Number(settings.mp.contextComplete))) {
      CONTEXT_COMPLETE_MP = Math.max(0, Number(settings.mp.contextComplete));
    }
  }

  function rewardSettings() {
    try {
      return JSON.parse(localStorage.getItem(REWARD_SETTINGS_KEY) || "{}");
    } catch (error) {
      return {};
    }
  }

  try {
    applyRewardSettings(JSON.parse(localStorage.getItem(REWARD_SETTINGS_KEY) || "{}"));
  } catch (error) {}

  function readRewardState() {
    var fallback = { mpTotal: 0, masteryPoints: 0, tokens: 0, streakDays: 0, level: "Intern", earnedEvents: {}, earnedEventIds: {}, ledger: [] };
    try {
      var parsed = JSON.parse(localStorage.getItem(REWARD_STATE_KEY) || "{}");
      parsed.mpTotal = Math.max(0, Number(parsed.mpTotal || parsed.masteryPoints || 0));
      parsed.masteryPoints = parsed.mpTotal;
      parsed.tokens = Math.max(0, Number(parsed.tokens || 0));
      parsed.streakDays = Math.max(0, Number(parsed.streakDays || 0));
      parsed.level = rewardLevelForMp(parsed.mpTotal);
      parsed.earnedEvents = Object.assign({}, parsed.earnedEventIds || {}, parsed.earnedEvents || {});
      parsed.earnedEventIds = parsed.earnedEvents;
      parsed.ledger = Array.isArray(parsed.ledger) ? parsed.ledger : [];
      return Object.assign(fallback, parsed);
    } catch (error) {
      return fallback;
    }
  }

  function writeRewardState(state) {
    localStorage.setItem(REWARD_STATE_KEY, JSON.stringify(state));
  }

  function rewardSnapshot() {
    var state = readRewardState();
    return {
      mpTotal: state.mpTotal,
      masteryPoints: state.masteryPoints,
      tokens: state.tokens,
      streakDays: state.streakDays,
      level: state.level,
      streak: state.streak || {},
      earnedEvents: state.earnedEvents,
      earnedEventIds: state.earnedEvents,
      ledger: state.ledger
    };
  }

  function mergeRemoteRewards(remoteRewards) {
    if (!remoteRewards || typeof remoteRewards !== "object") return;
    var local = readRewardState();
    var remoteMp = Math.max(0, Number(remoteRewards.mpTotal || remoteRewards.masteryPoints || 0));
    local.tokens = Math.max(local.tokens, Number(remoteRewards.tokens || 0));
    local.streakDays = Math.max(local.streakDays, Number(remoteRewards.streakDays || 0));
    local.level = rewardLevelForMp(local.mpTotal);
    local.earnedEvents = Object.assign({}, remoteRewards.earnedEventIds || {}, remoteRewards.earnedEvents || {}, local.earnedEventIds || {}, local.earnedEvents || {});
    local.earnedEventIds = local.earnedEvents;
    var ledgerById = {};
    [].concat(remoteRewards.ledger || [], local.ledger || []).forEach(function (entry) {
      if (!entry || !entry.id) return;
      ledgerById[entry.id] = entry;
    });
    local.ledger = Object.keys(ledgerById).map(function (id) { return ledgerById[id]; })
      .sort(function (a, b) { return String(a.earnedAt || '').localeCompare(String(b.earnedAt || '')); })
      .slice(-500);
    var ledgerTotal = local.ledger.reduce(function (sum, entry) {
      return sum + Math.max(0, Number(entry.mpEarned || 0));
    }, 0);
    local.mpTotal = Math.max(local.mpTotal, remoteMp, ledgerTotal);
    local.masteryPoints = local.mpTotal;
    local.level = rewardLevelForMp(local.mpTotal);
    var localStreak = local.streak && typeof local.streak === "object" ? local.streak : {};
    var remoteStreak = remoteRewards.streak && typeof remoteRewards.streak === "object" ? remoteRewards.streak : {};
    var mergedDailyActivities = {};
    Object.keys(Object.assign({}, remoteStreak.dailyActivities || {}, localStreak.dailyActivities || {})).forEach(function (date) {
      mergedDailyActivities[date] = Object.assign({}, (remoteStreak.dailyActivities || {})[date] || {}, (localStreak.dailyActivities || {})[date] || {});
    });
    local.streak = Object.assign({}, remoteStreak, localStreak, {
      currentDays: Math.max(Number(localStreak.currentDays || 0), Number(remoteStreak.currentDays || 0), Number(local.streakDays || 0)),
      lastQualifiedDate: String(localStreak.lastQualifiedDate || "") > String(remoteStreak.lastQualifiedDate || "") ? localStreak.lastQualifiedDate : remoteStreak.lastQualifiedDate || localStreak.lastQualifiedDate || "",
      dailyActivities: mergedDailyActivities,
      awardedDates: Object.assign({}, remoteStreak.awardedDates || {}, localStreak.awardedDates || {})
    });
    writeRewardState(local);
  }

  function awardRewardEvent(event) {
    if (rewardSettings().enabled === false) {
      var disabledState = readRewardState();
      return { awarded: false, mpEarned: 0, startTotal: disabledState.mpTotal, total: disabledState.mpTotal, reason: "rewards-disabled" };
    }
    var state = readRewardState();
    var startTotal = state.mpTotal;
    if (!event || !event.id || state.earnedEvents[event.id]) {
      return { awarded: false, mpEarned: 0, startTotal: startTotal, total: state.mpTotal };
    }
    var mp = Math.max(0, Number(event.mp || 0));
    state.mpTotal += mp;
    state.masteryPoints = state.mpTotal;
    state.level = rewardLevelForMp(state.mpTotal);
    state.earnedEvents[event.id] = true;
    state.earnedEventIds = state.earnedEvents;
    state.ledger.push({
      id: event.id,
      type: event.type,
      title: event.title || "",
      mpEarned: mp,
      totalAfter: state.mpTotal,
      earnedAt: new Date().toISOString()
    });
    state.ledger = state.ledger.slice(-500);
    writeRewardState(state);
    return { awarded: true, mpEarned: mp, startTotal: startTotal, total: state.mpTotal };
  }

  function awardOrientationVideo() {
    return awardRewardEvent({
      id: "video:orientation-welcome",
      type: "video-completed",
      title: "Orientation video",
      mp: VIDEO_COMPLETE_MP
    });
  }

  function backfillExistingProgressRewards() {
    var settings = rewardSettings();
    if (settings.enabled === false) return { count: 0, mp: 0 };
    var exerciseMp = Math.max(0, Number(settings.mp && settings.mp.exerciseCompleteFallback));
    if (!Number.isFinite(exerciseMp)) exerciseMp = 50;
    var totalMp = 0;
    var count = 0;
    function add(event) {
      var result = awardRewardEvent(event);
      if (!result.awarded) return;
      totalMp += result.mpEarned;
      count += 1;
    }
    if (readBool("utl_orientation_ready")) add({
      id: "video:orientation-welcome",
      type: "video-completed",
      title: "Orientation video",
      mp: VIDEO_COMPLETE_MP
    });
    allLessons().forEach(function (lesson) {
      if (!readBool(watchedKey(lesson.id))) return;
      add({ id: "video:" + lesson.id, type: "video-completed", title: lesson.title, mp: VIDEO_COMPLETE_MP });
    });
    allExercises().forEach(function (exercise) {
      if (!exerciseDone(exercise)) return;
      var rewardIds = Object.keys(readRewardState().earnedEvents || {});
      var appKey = exerciseAppKey(exercise);
      var knownIds = [exercise.id, appKey].filter(Boolean);
      var alreadyRewarded = rewardIds.some(function (eventId) {
        return knownIds.some(function (id) {
          return eventId === "completion-exercise:" + id
            || eventId === "reflection-exercise:" + id
            || eventId === "legacy-exercise:" + id
            || eventId.indexOf("scored-exercise:" + id) === 0;
        });
      });
      if (alreadyRewarded) return;
      var migrationId = appKey || exercise.id;
      var bestScoreKey = "utl_reward_best_score_" + migrationId;
      if (localStorage.getItem(bestScoreKey) === null) localStorage.setItem(bestScoreKey, String(exerciseMp));
      add({
        id: "legacy-exercise:" + migrationId,
        type: "legacy-exercise-completed",
        title: exercise.title,
        mp: exerciseMp
      });
    });
    phases.forEach(function (phaseKey) {
      if (!exercisesDone(phaseKey)) return;
      var phaseMp = Number(settings.mp && settings.mp.phaseCompletion && settings.mp.phaseCompletion[phaseKey]);
      if (!Number.isFinite(phaseMp)) phaseMp = ({ phase1: 100, phase2: 150, phase3: 200 })[phaseKey] || 0;
      add({
        id: "phase-completed:" + phaseKey,
        type: "phase-completed",
        title: phaseLabels[phaseKey] + " complete",
        mp: phaseMp
      });
    });
    if (phases.every(function (phaseKey) { return exercisesDone(phaseKey); })) {
      var programMp = Number(settings.mp && settings.mp.programCompletion);
      if (!Number.isFinite(programMp)) programMp = PROGRAM_COMPLETION_MP;
      add({
        id: "program-completed:tsa-program",
        type: "program-completed",
        title: "Full program complete",
        mp: programMp
      });
    }
    if (count) queueRemoteProgressSave();
    return { count: count, mp: totalMp };
  }

  function allLessons() {
    return phases.reduce(function (items, phaseKey) {
      return items.concat(getPhase(phaseKey).lessons || []);
    }, []);
  }

  function allExercises() {
    return phases.reduce(function (items, phaseKey) {
      return items.concat((getPhase(phaseKey).exercises || []).map(function (exercise) {
        exercise.phaseKey = phaseKey;
        return exercise;
      }));
    }, []);
  }

  function exerciseAppKey(exercise) {
    var match = String(exercise && exercise.appUrl || "").match(/\/apps\/([^/]+)/);
    return match ? match[1] : "";
  }

  function progressSnapshot() {
    var lessons = {};
    var exercises = {};
    var contexts = {};
    phases.forEach(function (phaseKey) {
      orderedLessons(phaseKey).forEach(function (lesson) {
        lessons[lesson.id] = { watched: readBool(watchedKey(lesson.id)) };
      });
    });
    allExercises().forEach(function (exercise) {
      var appKey = exerciseAppKey(exercise);
      exercises[exercise.id] = {
        visited: readBool(visitedKey(exercise.id)) || (appKey ? readBool(visitedKey(appKey)) : false),
        completed: exerciseDone(exercise) || (appKey ? readBool(doneKey(appKey)) : false),
        phase: exercise.phaseKey || "",
        title: exercise.title,
        appKey: appKey
      };
      contexts[exercise.id] = { completed: readBool(contextDoneKey(exercise.id)) };
    });
    phases.forEach(function (phaseKey) {
      (getPhase(phaseKey).introContexts || []).forEach(function (context) {
        contexts[context.id] = { completed: readBool(contextDoneKey(context.id)) };
      });
    });
    return {
      version: 1,
      orientation: {
        ready: readBool("utl_orientation_ready"),
        open: readBool("utl_orientation_open")
      },
      lessons: lessons,
      exercises: exercises,
      contexts: contexts,
      rewards: rewardSnapshot(),
      phases: {
        phase1: { videosDone: readBool(phaseVideosDoneKey("phase1")), exercisesDone: readBool(phaseDoneKey("phase1")) },
        phase2: { videosDone: readBool(phaseVideosDoneKey("phase2")), exercisesDone: readBool(phaseDoneKey("phase2")) },
        phase3: { videosDone: readBool(phaseVideosDoneKey("phase3")), exercisesDone: readBool(phaseDoneKey("phase3")) }
      },
      updatedAtClient: new Date().toISOString()
    };
  }

  function applyRemoteProgress(progress) {
    if (!progress || typeof progress !== "object") return;
    var orientation = progress.orientation || {};
    if (typeof orientation.ready === "boolean") writeBool("utl_orientation_ready", orientation.ready);
    if (typeof orientation.open === "boolean") writeBool("utl_orientation_open", orientation.open);

    var remoteLessons = progress.lessons || {};
    allLessons().forEach(function (lesson) {
      var saved = remoteLessons[lesson.id];
      if (saved && typeof saved.watched === "boolean") writeBool(watchedKey(lesson.id), saved.watched);
    });

    var remoteExercises = progress.exercises || {};
    allExercises().forEach(function (exercise) {
      var appKey = exerciseAppKey(exercise);
      var saved = remoteExercises[exercise.id] || (appKey ? remoteExercises[appKey] : null);
      if (!saved) return;
      if (typeof saved.visited === "boolean") writeBool(visitedKey(exercise.id), saved.visited);
      if (saved.completed === true) writeExerciseDone(exercise, true);
      else if (saved.completed === false && !exerciseDone(exercise)) writeExerciseDone(exercise, false);
    });

    var remoteContexts = progress.contexts || {};
    Object.keys(remoteContexts).forEach(function (id) {
      if (typeof remoteContexts[id]?.completed === "boolean") {
        writeBool(contextDoneKey(id), remoteContexts[id].completed);
      }
    });

    phases.forEach(function (phaseKey) {
      videosDone(phaseKey);
      exercisesDone(phaseKey);
    });
    mergeRemoteRewards(progress.rewards);
  }

  function saveRemoteProgressNow() {
    if (!readBool(SESSION_KEY)) return Promise.resolve();
    return import(firebaseHref())
      .then(function (firebase) {
        return firebase.saveMemberWorkspaceProgress(progressSnapshot());
      })
      .catch(function (error) {
        console.warn("Firestore workspace progress save failed.", error);
      });
  }

  function queueRemoteProgressSave() {
    if (remoteProgressSaveTimer) clearTimeout(remoteProgressSaveTimer);
    remoteProgressSaveTimer = setTimeout(saveRemoteProgressNow, 250);
  }

  function ensureRemoteProgressLoaded(callback) {
    if (!readBool(SESSION_KEY) || remoteProgressLoaded) {
      callback();
      return;
    }
    injectStyles();
    document.body.classList.add("ws-page");
    remoteProgressLoaded = true;
    callback();
    if (remoteProgressLoading) return;
    remoteProgressLoading = true;
    import(firebaseHref())
      .then(function (firebase) {
        return Promise.all([
          firebase.getMemberWorkspaceProgress(),
          firebase.getRewardSettings ? firebase.getRewardSettings() : null
        ]);
      })
      .then(function (results) {
        var progress = results && results[0];
        applyRewardSettings(results && results[1]);
        if (progress) applyRemoteProgress(progress);
        var backfill = backfillExistingProgressRewards();
        if (backfill.count) {
          setTimeout(function () {
            var state = readRewardState();
            showWorkspaceRewardMoment({
              label: "Prior progress recognized",
              title: "+" + backfill.mp + " MP added",
              body: backfill.count + " completed item" + (backfill.count === 1 ? " was" : "s were") + " converted into Rewards.",
              startMp: Math.max(0, state.mpTotal - backfill.mp),
              newTotal: state.mpTotal,
              previousLevel: rewardLevelForMp(Math.max(0, state.mpTotal - backfill.mp)),
              currentLevel: rewardLevelForMp(state.mpTotal),
              showLevelModal: rewardLevelForMp(Math.max(0, state.mpTotal - backfill.mp)) !== rewardLevelForMp(state.mpTotal)
            });
          }, 120);
        }
        return saveRemoteProgressNow();
      })
      .catch(function (error) {
        console.warn("Firestore workspace progress load failed.", error);
      })
      .then(function () {
        remoteProgressLoading = false;
        callback();
      });
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function textParagraphs(value) {
    return String(value || "").split(/\n{2,}/).map(function (paragraph) {
      return "<p>" + escapeHtml(paragraph.trim()) + "</p>";
    }).join("");
  }

  function initials(value) {
    var cleaned = String(value || "Member").trim();
    var parts = cleaned.split(/[\s@._-]+/).filter(Boolean);
    return (parts[0] && parts[1] ? parts[0][0] + parts[1][0] : cleaned.slice(0, 2)).toUpperCase();
  }

  function currentUser() {
    var profile = {};
    try {
      profile = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
    } catch (error) {
      profile = {};
    }
    var email = profile.email || localStorage.getItem(USER_KEY) || "member";
    var fullName = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
    var label = fullName || profile.displayName || email;
    return {
      email: email,
      label: label,
      initials: initials(label || email),
      photoURL: profile.photoURL || "",
      role: profile.role || (localStorage.getItem(ADMIN_KEY) === "true" ? "admin" : "member")
    };
  }

  async function clearWorkspaceSession() {
    try {
      var firebaseAuth = _preloadedFirebase || await import(firebaseHref());
      _preloadedFirebase = firebaseAuth;
      if (firebaseAuth.signOut && firebaseAuth.auth) {
        await firebaseAuth.signOut(firebaseAuth.auth);
      }
    } catch (error) {
      console.warn("Firebase sign-out did not complete:", error && error.message);
    }
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(ADMIN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(PROFILE_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem("utl_google_login_pending");
    localStorage.removeItem("utl_google_login_pending");
  }

  function getPhase(key) {
    return UTL_CONTENT[key];
  }

  function orderedLessons(phaseKey) {
    var phase = getPhase(phaseKey);
    var lessons = (phase.lessons || []).slice();
    try {
      var order = JSON.parse(localStorage.getItem("utl_lesson_order_" + phaseKey) || "[]");
      if (Array.isArray(order) && order.length) {
        var currentIds = lessons.map(function (lesson) { return lesson.id; });
        var matchesCurrentLessons = currentIds.every(function (id) { return order.indexOf(id) !== -1; });
        if (matchesCurrentLessons) {
          lessons.sort(function (a, b) {
            var aIndex = order.indexOf(a.id);
            var bIndex = order.indexOf(b.id);
            return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
          });
        }
      }
    } catch (error) {
      return lessons;
    }
    return lessons;
  }

  function watchedKey(id) {
    return "utl_watched_" + id;
  }

  function visitedKey(id) {
    return "utl_visited_" + id;
  }

  function doneKey(id) {
    return "utl_done_" + id;
  }

  function exerciseDone(exercise) {
    return readBool(doneKey(exercise.id)) || (exercise.legacyDoneKey ? readBool(exercise.legacyDoneKey) : false);
  }

  function writeExerciseDone(exercise, value) {
    writeBool(doneKey(exercise.id), value);
    if (exercise.legacyDoneKey) writeBool(exercise.legacyDoneKey, value);
  }

  function phaseDoneKey(phaseKey) {
    return "utl_p" + phaseNumbers[phaseKey] + "_done";
  }

  function phaseVideosDoneKey(phaseKey) {
    return "utl_p" + phaseNumbers[phaseKey] + "_videos_done";
  }

  function lessonUrl(lesson) {
    var saved = localStorage.getItem("utl_url_" + lesson.id);
    return supportedMediaUrl(saved) ? saved : (lesson.videoUrl || "");
  }

  function supportedMediaUrl(value) {
    var url = String(value || "").trim();
    if (!url) return false;
    return /^https?:\/\/.+/i.test(url);
  }

  function legacyEmbedConfig(item) {
    if (!item || !item.legacyEmbedKey) return {};
    try {
      var config = JSON.parse(localStorage.getItem(item.legacyEmbedKey) || "{}");
      if (config && config.url) return config;
    } catch (error) {
      // Fall through to the built-in defaults.
    }
    return {};
  }

  function exerciseContextType(exercise) {
    var legacy = legacyEmbedConfig(exercise);
    return localStorage.getItem("utl_ctx_type_" + exercise.id) || legacy.type || exercise.contextType || "text";
  }

  function exerciseContextUrl(exercise) {
    var legacy = legacyEmbedConfig(exercise);
    return localStorage.getItem("utl_ctx_url_" + exercise.id) || legacy.url || exercise.contextUrl || "";
  }

  function watchedCount(phaseKey) {
    return orderedLessons(phaseKey).filter(function (lesson) {
      return readBool(watchedKey(lesson.id));
    }).length;
  }

  function videosDone(phaseKey) {
    var lessons = orderedLessons(phaseKey);
    var done = lessons.length > 0 && watchedCount(phaseKey) === lessons.length;
    writeBool(phaseVideosDoneKey(phaseKey), done);
    return done;
  }

  function exercisesDone(phaseKey) {
    var phase = getPhase(phaseKey);
    var done = phase.exercises.length > 0 && phase.exercises.every(function (exercise) {
      return exerciseDone(exercise);
    });
    writeBool(phaseDoneKey(phaseKey), done);
    return done;
  }

  function phaseUnlocked(phaseKey) {
    if (phaseKey === "phase1") return true;
    if (adminPreviewMode()) return true;
    if (phaseKey === "phase2") return exercisesDone("phase1") && localStorage.getItem("utl_phase2_status") !== "hide";
    if (phaseKey === "phase3") return exercisesDone("phase2") && localStorage.getItem("utl_phase3_status") !== "hide";
    return true;
  }

  function allPhaseProgress() {
    var total = 0;
    var done = 0;
    phases.forEach(function (phaseKey) {
      var phase = getPhase(phaseKey);
      total += phase.lessons.length + phase.exercises.length;
      done += watchedCount(phaseKey);
      done += phase.exercises.filter(function (exercise) {
        return exerciseDone(exercise);
      }).length;
    });
    return { done: done, total: total, percent: total ? Math.round((done / total) * 100) : 0 };
  }

  function exerciseProgress() {
    var total = 0;
    var done = 0;
    phases.forEach(function (phaseKey) {
      var exercises = getPhase(phaseKey).exercises || [];
      total += exercises.length;
      done += exercises.filter(function (exercise) {
        return exerciseDone(exercise);
      }).length;
    });
    return { done: done, total: total, percent: total ? Math.round((done / total) * 100) : 0 };
  }

  function phaseProgress(phaseKey) {
    var phase = getPhase(phaseKey);
    var lessonsTotal = phase.lessons.length;
    var exercisesTotal = phase.exercises.length;
    var watched = watchedCount(phaseKey);
    var exercisesComplete = phase.exercises.filter(function (exercise) {
      return exerciseDone(exercise);
    }).length;
    var total = lessonsTotal + exercisesTotal;
    var done = watched + exercisesComplete;
    return {
      watched: watched,
      lessonsTotal: lessonsTotal,
      exercisesComplete: exercisesComplete,
      exercisesTotal: exercisesTotal,
      done: done,
      total: total,
      percent: total ? Math.round((done / total) * 100) : 0
    };
  }

  function nextExerciseTarget(phaseKey) {
    var phase = getPhase(phaseKey);
    return (phase.exercises || []).find(function (exercise) {
      return !exerciseDone(exercise);
    }) || null;
  }

  function phaseStepState(phaseKey, type) {
    var phase = getPhase(phaseKey);
    if (type === "watch") {
      var watched = watchedCount(phaseKey);
      if (watched === 0) return "empty";
      return watched === phase.lessons.length ? "solid" : "half";
    }
    var done = phase.exercises.filter(function (exercise) {
      return exerciseDone(exercise);
    }).length;
    var visited = phase.exercises.some(function (exercise) {
      return readBool(visitedKey(exercise.id));
    });
    if (done === 0 && !visited) return "empty";
    return done === phase.exercises.length ? "solid" : "half";
  }

  function phaseStatus(phaseKey) {
    if (!phaseUnlocked(phaseKey)) return "Locked";
    if (exercisesDone(phaseKey)) return "Completed";
    if (phaseStepState(phaseKey, "watch") === "empty" && phaseStepState(phaseKey, "practice") === "empty") return "Not started";
    return "In progress";
  }

  function sanitizeMediaUrl(url) {
    var value = String(url || "").trim();
    if (!value) return "";
    var deckMatch = value.match(/docs\.google\.com\/presentation\/d\/([^/]+)/);
    if (deckMatch) {
      var slideMatch = value.match(/[?&]slide=([^&#]+)/) || value.match(/#slide=([^&#]+)/);
      var slideParam = slideMatch ? "&slide=" + encodeURIComponent(decodeURIComponent(slideMatch[1])) : "";
      return "https://docs.google.com/presentation/d/" + deckMatch[1] + "/embed?start=false&loop=false&delayms=3000" + slideParam;
    }
    var openMatch = value.match(/drive\.google\.com\/open\?id=([^&]+)/);
    if (openMatch) {
      return "https://drive.google.com/file/d/" + openMatch[1] + "/preview";
    }
    if (/drive\.google\.com\/file\/d\//.test(value)) {
      return value.replace(/\/view(\?[^#]*)?$/, "/preview");
    }
    return value;
  }

  function directMediaUrl(url) {
    var value = String(url || "").trim();
    if (!value) return "";
    var deckMatch = value.match(/docs\.google\.com\/presentation\/d\/([^/]+)/);
    if (deckMatch) return "https://docs.google.com/presentation/d/" + deckMatch[1] + "/edit";
    var openMatch = value.match(/drive\.google\.com\/open\?id=([^&]+)/);
    if (openMatch) return "https://drive.google.com/file/d/" + openMatch[1] + "/view";
    var fileMatch = value.match(/drive\.google\.com\/file\/d\/([^/]+)/);
    if (fileMatch) return "https://drive.google.com/file/d/" + fileMatch[1] + "/view";
    return value;
  }

  function renderIframe(url, title) {
    var src = sanitizeMediaUrl(url);
    if (!src) return "";
    return '<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:8px;"><iframe src="' + escapeHtml(src) + '" title="' + escapeHtml(title || "Video player") + '" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe></div>';
  }

  function videoAccessHelp(url) {
    var email = currentUser().email || "";
    var emailText = email.indexOf("@") > -1 ? ' Your workspace email is <strong>' + escapeHtml(email) + '</strong>.' : "";
    var directUrl = directMediaUrl(url);
    var directLink = directUrl ? '<a class="ws-access-direct" href="' + escapeHtml(directUrl) + '" target="_blank" rel="noopener">Open in Google Drive</a>' : "";
    return '<details class="ws-video-access-help"><summary><span>Video not opening?</span><small>Try these fixes</small></summary><div class="ws-access-help-body">' +
      '<p class="ws-access-warning"><strong>Do not request access to each video.</strong> Your access is handled through your membership record.</p>' +
      '<div class="ws-access-top">' + directLink + '<p><strong>Fastest fix:</strong> Open the video directly, confirm you are using the approved Google account, then return to this page and refresh.</p></div>' +
      '<div class="ws-access-guide">' +
        '<section><h4>Quick checks</h4><ol>' +
          '<li><strong>Use the approved Google account:</strong> The Google account that can view the Drive file must match your member workspace email.' + emailText + '</li>' +
          '<li><strong>Wait after access changes:</strong> New Google Group access can take a few minutes to apply.</li>' +
          '<li><strong>Hard refresh:</strong> Reload this page after confirming the video opens in Google Drive.</li>' +
        '</ol></section>' +
        '<section><h4>Desktop browsers</h4><ol>' +
          '<li><strong>Chrome is best:</strong> If Brave, Safari, Edge, or an incognito window blocks the embedded player, try Chrome first.</li>' +
          '<li><strong>Brave/ Safari privacy settings:</strong> Turn off Shields or allow third-party cookies for this site and Google Drive.</li>' +
          '<li><strong>Multiple Google accounts:</strong> Sign out of extra Google accounts, then sign back in with the approved member email.</li>' +
        '</ol></section>' +
        '<section><h4>Mobile devices</h4><ol>' +
          '<li><strong>Use Chrome mobile:</strong> Embedded Drive videos can fail in Safari private browsing or privacy-focused browsers.</li>' +
          '<li><strong>Open directly if embedded playback fails:</strong> Tap <em>Open in Google Drive</em>, then use the Drive app or browser to play it.</li>' +
          '<li><strong>Check the account switcher:</strong> In Google Drive, make sure the active account is the approved member email.</li>' +
        '</ol></section>' +
      '</div>' +
      '<p class="ws-access-footer"><strong>Still blocked?</strong> Reply to your welcome email and include your browser, device, and the email shown in your Google Drive account switcher.</p>' +
    '</div></details>';
  }

  function renderEmbeddedMedia(url, title) {
    var frame = renderIframe(url, title);
    return frame ? frame + videoAccessHelp(url) : "";
  }

  function injectStyles() {
    if (document.getElementById("utl-workspace-styles")) return;
    var style = document.createElement("style");
    style.id = "utl-workspace-styles";
    style.textContent = [
      "@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Lato:wght@300;400;700&family=Roboto+Mono:wght@400;500;700&display=swap');",
      ":root{--ws-navy:#003366;--ws-gold:#EEA320;--ws-cream:#F3EDE2;--ws-charcoal:#4A4A4A;--ws-steel:#4D7094;--ws-white:#FFFFFF;--ws-line:#E3D8C8;--ws-green:#2C7A4B;}",
      ".ws-mission-overlay{position:fixed;inset:0;z-index:8500;display:grid;place-items:center;padding:24px;background:rgba(0,28,56,.68);overflow:auto}.ws-mission-overlay.ws-hidden{display:none}.ws-mission-dialog{position:relative;width:min(1120px,100%);max-height:calc(100vh - 48px);overflow:auto;border-radius:14px}.ws-mission-close{position:absolute;right:14px;top:14px;z-index:4;width:40px;height:40px;border:0;border-radius:999px;background:#fff;color:var(--ws-navy);font-size:27px;line-height:1;cursor:pointer;box-shadow:0 3px 12px rgba(0,51,102,.16)}.ws-mission-bonus{cursor:pointer;border:2px solid transparent}.ws-mission-bonus>input{width:20px;height:20px;accent-color:var(--ws-gold)}.ws-mission-bonus:has(input:checked){border-color:var(--ws-navy);background:#FFF8EC}.ws-mission-nav{display:inline-flex;align-items:center;gap:7px;min-height:34px;padding:0 10px;border:1px solid rgba(238,163,32,.65);border-radius:999px;color:#fff;text-decoration:none;font:700 10px Lato, Arial, sans-serif;white-space:nowrap}.ws-mission-nav b{color:var(--ws-gold)}@media(max-width:768px){.ws-mission-overlay{padding:12px}.ws-mission-dialog{max-height:calc(100vh - 24px)}.ws-mission-close{right:8px;top:8px}.ws-mission-nav>span:first-child{display:none}}",
      "*{box-sizing:border-box}",
      "body.ws-page{margin:0;min-height:100vh;background:var(--ws-cream);color:var(--ws-charcoal);font-family:Lato,sans-serif;overflow-x:hidden}",
      ".ws-shell{width:min(1120px,calc(100% - 40px));margin:0 auto}",
      ".ws-hidden{display:none}",
      ".ws-mission-nav{position:relative;cursor:pointer}.ws-mission-popover{position:absolute;right:0;top:calc(100% + 12px);z-index:9990;width:320px;padding:16px 18px;border:1px solid rgba(238,163,32,.42);border-radius:12px;background:#fff;color:var(--ws-charcoal);box-shadow:0 18px 48px rgba(0,51,102,.22);opacity:0;pointer-events:none;transform:translateY(-6px);transition:opacity .16s ease,transform .16s ease;white-space:normal;text-align:left}.ws-mission-nav:hover .ws-mission-popover,.ws-mission-nav:focus-within .ws-mission-popover{opacity:1;pointer-events:auto;transform:translateY(0)}.ws-mission-popover small{display:block;color:var(--ws-gold);font:700 10px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none}.ws-mission-popover>strong{display:block;margin-top:5px;color:var(--ws-navy);font:700 18px Lato,sans-serif}.ws-mission-popover p{margin:7px 0 12px;color:var(--ws-steel);font:700 13px/1.4 Lato,sans-serif}.ws-mission-popover ul{display:grid;gap:7px;margin:12px 0;padding:0;list-style:none}.ws-mission-popover li{display:grid;grid-template-columns:18px 1fr;gap:6px;color:var(--ws-navy);font:700 13px/1.3 Lato,sans-serif}.ws-mission-popover li.ws-done{color:var(--ws-green)}.ws-mission-popover>a,.ws-mission-popover-actions a{display:inline-flex;align-items:center;justify-content:center;min-height:38px;border-radius:7px;background:var(--ws-gold);color:var(--ws-navy);padding:0 12px;text-decoration:none;font:700 11px Lato,sans-serif;text-transform: none}.ws-mission-popover-actions{display:flex!important;align-items:center;justify-content:flex-end;gap:8px;margin-top:12px}.ws-mission-popover-actions b{color:var(--ws-green);font:700 12px Lato,sans-serif}@media(max-width:620px){.ws-mission-popover{position:fixed;top:94px;right:12px;width:calc(100vw - 24px);max-height:calc(100svh - 112px);overflow:auto}}",
      ".ws-mission-action-buttons{display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap}@media(max-width:600px){.ws-mission-action-buttons{width:100%;display:grid}.ws-mission-action-buttons .ws-button{width:100%}}",
      ".ws-mission-dialog .ws-mission-header{padding-right:58px}@media(max-width:768px){.ws-mission-dialog .ws-mission-header{padding-right:50px}}",
      "body:has(.ws-mission-overlay:not(.ws-hidden)) #utl-feedback-btn{display:none!important}@media(max-width:768px){.ws-mission-dialog:has(.ws-mission-preview) .ws-mission-close{top:52px}}",
      ".ws-challenge-intention{margin:18px 0 0;padding:12px 14px;border-radius:8px;background:#FFF8EC;color:var(--ws-navy)}.ws-challenge-form{display:grid;gap:18px;margin-top:22px}.ws-challenge-form fieldset{display:grid;gap:9px;margin:0;padding:0;border:0}.ws-challenge-form legend{margin-bottom:10px;color:var(--ws-navy);font-size:18px;font-weight:700}.ws-challenge-form fieldset label{display:flex;align-items:center;gap:10px;min-height:44px;padding:10px 12px;border:1px solid var(--ws-line);border-radius:8px;background:#FAF8F3;color:var(--ws-navy);cursor:pointer}.ws-challenge-form input[type=radio]{width:18px;height:18px;accent-color:var(--ws-gold)}.ws-challenge-note{display:grid;gap:7px;color:var(--ws-navy);font-weight:700}.ws-challenge-note textarea{width:100%;resize:vertical;border:1px solid var(--ws-line);border-radius:8px;padding:10px;font:400 15px Lato,sans-serif}",
      ".ws-mission-bonus{grid-template-columns:auto minmax(0,1fr) auto!important}.ws-mission-bonus>span{min-width:0}.ws-mission-bonus>b{grid-column:auto!important}@media(max-width:600px){.ws-mission-bonus{grid-template-columns:auto minmax(0,1fr)!important}.ws-mission-bonus>b{grid-column:2!important;justify-self:start}}",
      ".ws-mission-checklist{display:grid;gap:10px;margin:22px 0 0;padding:0;list-style:none}.ws-mission-checklist li{display:grid;grid-template-columns:32px 1fr auto;gap:11px;align-items:center;padding:12px 14px;border-radius:9px;background:#FAF8F3}.ws-mission-checklist li>span:first-child{width:28px;height:28px;border:1px solid var(--ws-line);border-radius:999px;display:grid;place-items:center;color:var(--ws-steel);font:700 11px Lato, Arial, sans-serif}.ws-mission-checklist li.ws-done{background:#F6FBF7}.ws-mission-checklist li.ws-done>span:first-child{background:var(--ws-green);border-color:var(--ws-green);color:#fff}.ws-mission-checklist strong{display:block;color:var(--ws-navy)}.ws-mission-checklist small{display:block;margin-top:2px;color:var(--ws-steel)}.ws-mission-checklist button{min-height:36px;border:1px solid var(--ws-gold);border-radius:7px;background:#fff;color:var(--ws-navy);font-weight:700;cursor:pointer}@media(max-width:600px){.ws-mission-checklist li{grid-template-columns:30px 1fr}.ws-mission-checklist button{grid-column:2;width:100%}}",
      ".ws-reward-toast{position:fixed;right:22px;top:72px;z-index:9999;width:min(330px,calc(100vw - 44px));padding:16px 18px;border:1px solid rgba(238,163,32,.46);border-radius:12px;background:#fff;color:var(--ws-navy);box-shadow:0 18px 44px rgba(0,51,102,.22);opacity:0;transform:translateY(-10px);transition:opacity .18s ease,transform .18s ease}.ws-reward-toast.ws-visible{opacity:1;transform:translateY(0)}.ws-reward-toast span{display:block;color:var(--ws-gold);font:700 10px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none}.ws-reward-toast strong{display:block;margin-top:5px;color:var(--ws-navy);font-size:18px}.ws-reward-toast p{margin:5px 0 0;color:var(--ws-steel);font-size:13px;line-height:1.4}",
      ".ws-nav{position:sticky;top:0;z-index:30;background:var(--ws-navy);color:var(--ws-white);box-shadow:0 10px 28px rgba(0,51,102,.14)}",
      ".ws-nav-inner{height:54px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:22px;width:min(1180px,calc(100% - 32px));margin:0 auto}",
      ".ws-brand{display:flex;align-items:center;gap:14px;min-width:0}.ws-logo-link{display:flex;align-items:center;border-radius:6px}.ws-logo-link:hover{background:rgba(238,163,32,.18)}.ws-logo{height:31px;width:auto;display:block}.ws-brand-sep,.ws-workspace-link,.ws-nav-divider{display:none}",
      ".ws-links{display:flex;align-items:center;justify-content:center;gap:16px;min-width:0}.ws-link{min-height:54px;display:inline-flex;align-items:center;border-bottom:3px solid transparent;color:rgba(255,255,255,.72);font:700 13px Lato,sans-serif;letter-spacing:0;text-decoration:none;white-space:nowrap}.ws-link:hover,.ws-link.ws-active{color:var(--ws-white);border-bottom-color:var(--ws-gold)}.ws-sep{color:rgba(255,255,255,.32);font-family:Lato,sans-serif}",
      ".ws-nav-drop{position:relative;display:inline-flex}.ws-nav-trigger{border-left:0;border-right:0;border-top:0;background:transparent;padding:0;cursor:pointer}.ws-phase-menu{position:absolute;top:52px;left:0;width:300px;background:#fff;color:var(--ws-navy);border:1px solid var(--ws-line);border-radius:8px;box-shadow:0 18px 40px rgba(0,51,102,.22);overflow:hidden;z-index:80;display:none}.ws-nav-drop:hover .ws-phase-menu,.ws-nav-drop:focus-within .ws-phase-menu{display:block}.ws-phase-menu:before{content:attr(data-label);display:block;padding:12px 16px 8px;color:var(--ws-steel);font:700 11px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none}.ws-phase-menu a{display:flex;gap:12px;align-items:center;padding:13px 16px;color:var(--ws-navy);text-decoration:none}.ws-phase-menu a:hover{background:#f4eddf}.ws-phase-menu strong{display:block;font-size:16px}.ws-phase-menu small{display:block;margin-top:2px;color:var(--ws-steel);font-size:13px}.ws-phase-menu .ws-media-icon{margin:0;width:36px;height:36px;border-radius:8px}",
      ".ws-user{position:relative;display:flex;align-items:center;gap:10px;justify-content:flex-end}.ws-user-email{max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(255,255,255,.72);font:700 12px Lato,sans-serif;letter-spacing:0}.ws-avatar{width:36px;height:36px;border-radius:999px;border:0;background:var(--ws-gold);color:var(--ws-navy);display:grid;place-items:center;font:700 12px Lato, Arial, sans-serif;cursor:pointer;overflow:hidden;padding:0}.ws-avatar img,.ws-profile-avatar img{width:100%;height:100%;object-fit:cover;display:block}.ws-profile-menu{position:absolute;right:0;top:100%;min-width:200px;max-width:240px;background:#fff;color:var(--ws-charcoal);border:1px solid var(--ws-line);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.15);padding:0;z-index:200;overflow:hidden}.ws-profile-menu:before{content:'';position:absolute;top:-8px;right:18px;width:16px;height:16px;background:var(--ws-navy);transform:rotate(45deg)}.ws-profile-menu[hidden]{display:none}.ws-profile-head{position:relative;display:flex;align-items:center;gap:13px;background:var(--ws-navy);color:#fff;padding:14px 16px 13px;border-bottom:3px solid var(--ws-gold)}.ws-profile-avatar{width:46px;height:46px;border-radius:999px;background:var(--ws-gold);color:var(--ws-navy);display:grid;place-items:center;overflow:hidden;font:700 14px Lato, Arial, sans-serif;flex:0 0 auto}.ws-profile-name{margin:0;color:#fff;font-size:15px;font-weight:700;line-height:1.15}.ws-profile-role{margin:4px 0 0;color:var(--ws-gold);font:700 9.5px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none}.ws-profile-section{padding:11px 16px 10px;border-bottom:1px solid var(--ws-line)}.ws-profile-section:last-child{border-bottom:0}.ws-profile-section-label{display:block;margin:0 0 7px;color:var(--ws-gold);font:700 9.5px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none}.ws-profile-menu a,.ws-profile-menu button{width:100%;min-height:36px;display:flex;align-items:center;gap:12px;border:0;background:transparent;color:var(--ws-navy);font:700 14px Lato,sans-serif;text-align:left;text-decoration:none;cursor:pointer;padding:4px 0}.ws-profile-menu a:hover,.ws-profile-menu button:hover{text-decoration:underline}.ws-profile-icon{width:18px;color:var(--ws-steel);display:inline-flex;justify-content:center;font-size:16px;line-height:1}.ws-profile-menu .ws-admin-link .ws-profile-icon{color:var(--ws-gold)}.ws-profile-menu .ws-logout{color:var(--ws-steel)}",
      ".ws-main{padding:54px 0 72px}.ws-kicker{display:inline-flex;color:var(--ws-gold);font:700 11px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none}.ws-title{margin:10px 0 12px;color:var(--ws-navy);font:700 clamp(40px,6vw,66px)/.98 'Playfair Display',serif}.ws-subtitle{width:100%;max-width:1040px;margin:0;color:var(--ws-steel);font-size:18px;line-height:1.55;text-wrap:pretty;overflow-wrap:anywhere}",
      ".ws-login-wrap{min-height:calc(100vh - 54px);display:grid;place-items:center;padding:48px 20px}.ws-login-card{width:min(460px,100%);background:#fff;border:1px solid var(--ws-line);border-radius:12px;padding:30px;box-shadow:0 18px 45px rgba(0,51,102,.1)}.ws-login-card .ws-subtitle{font-size:17px}.ws-form{display:grid;gap:12px;margin-top:24px}.ws-form label{color:var(--ws-navy);font-weight:700}.ws-login-card .ws-form .ws-button,.ws-login-card .ws-google-button{width:100%}.ws-login-divider{display:flex;align-items:center;gap:12px;margin:18px 0;color:var(--ws-steel);font:700 10px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none}.ws-login-divider:before,.ws-login-divider:after{content:'';height:1px;background:var(--ws-line);flex:1}.ws-input,.ws-textarea,.ws-select{width:100%;min-height:46px;border:1px solid rgba(0,51,102,.22);border-radius:8px;padding:10px 12px;background:#fff;color:var(--ws-charcoal);font:400 15px Lato,sans-serif}.ws-textarea{min-height:88px;resize:vertical}.ws-message{min-height:20px;margin:0;color:#8A1F1F;font-weight:700}.ws-message.ws-success{color:var(--ws-green)}.ws-login-card .ws-google-button{position:relative;min-height:46px;gap:10px;background:#fff;border:1px solid #747775;border-radius:8px;color:#1f1f1f;text-transform:none;font:500 14px/20px Roboto,Arial,sans-serif;letter-spacing:0;padding:0 12px;box-shadow:none}.ws-login-card .ws-google-button:hover{background:#f8fafd;border-color:#3c4043;filter:none}.ws-login-card .ws-google-button:focus-visible{outline:2px solid #4285F4;outline-offset:2px}.ws-login-card .ws-google-button[disabled]{background:#f1f3f4;color:#5f6368;border-color:#dadce0}.ws-google-mark{width:20px;height:20px;display:inline-block;flex:0 0 auto;background:center/contain no-repeat url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Cpath fill='%23EA4335' d='M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z'/%3E%3Cpath fill='%234285F4' d='M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z'/%3E%3Cpath fill='%23FBBC05' d='M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24s.92 7.54 2.56 10.78l7.97-6.19z'/%3E%3Cpath fill='%2334A853' d='M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z'/%3E%3Cpath fill='none' d='M0 0h48v48H0z'/%3E%3C/svg%3E\")}",
      ".ws-home-stack{display:grid;gap:26px}.ws-journey-card{background:#fff;border:1px solid var(--ws-line);border-radius:12px;overflow:hidden;box-shadow:none}.ws-journey-head{width:100%;border:0;background:#fff;display:grid;grid-template-columns:1fr auto;align-items:center;gap:16px;padding:20px 22px;text-align:left;cursor:pointer}.ws-journey-title{margin:3px 0 6px;color:var(--ws-navy);font:700 31px/1.1 'Playfair Display',serif}.ws-journey-sub{max-width:960px;margin:0;color:var(--ws-steel);font-size:17px;line-height:1.5;text-wrap:pretty}.ws-journey-body{display:none;padding:0 22px 22px}.ws-journey-card.ws-open .ws-journey-body{display:block}.ws-journey-map{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:4px 0 16px}.ws-journey-step{border:1px solid var(--ws-line);border-radius:10px;background:#FAF8F3;padding:16px 16px 15px;min-height:124px}.ws-journey-step-num{width:34px;height:34px;border-radius:999px;background:var(--ws-navy);color:#fff!important;display:flex!important;align-items:center;justify-content:center;font:700 13px/1 Lato, Arial, sans-serif;margin:0 0 11px;text-align:center;letter-spacing:0}.ws-journey-step strong{display:block;color:var(--ws-navy);margin-bottom:5px;font-size:17px}.ws-journey-step span:not(.ws-journey-step-num){display:block;color:var(--ws-steel);font-size:14px;line-height:1.35}.ws-journey-actions{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;border-top:1px solid rgba(0,51,102,.1);padding-top:14px}.ws-journey-ready{margin:0;color:var(--ws-navy);font-weight:700}.ws-journey-ready small{display:block;margin-top:3px;color:var(--ws-steel);font-weight:700}.ws-journey-cue{display:inline-flex;align-items:center;gap:8px;color:var(--ws-navy);font:700 12px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none;text-decoration:none}.ws-journey-cue span{width:28px;height:28px;border-radius:999px;background:var(--ws-gold);color:var(--ws-navy);display:grid;place-items:center;font:700 16px/1 Lato,sans-serif}.ws-orientation-card{background:#fff;border:1px solid var(--ws-line);border-radius:12px;overflow:hidden}.ws-orientation-head{width:100%;border:0;background:#fff;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:14px;padding:18px 20px;text-align:left;cursor:pointer}.ws-start-badge{background:var(--ws-navy);color:var(--ws-gold);border-radius:3px;padding:5px 9px;font:700 9px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none}.ws-orientation-title{display:block;color:var(--ws-navy);font-weight:700}.ws-orientation-sub{display:block;margin-top:2px;color:var(--ws-steel);font-size:13px}.ws-disclosure-icon{width:34px;height:34px;border-radius:8px;background:var(--ws-gold);color:#fff;display:inline-grid;place-items:center;font:700 22px/1 Lato,sans-serif}.ws-orientation-body{display:none;padding:0 20px 20px}.ws-orientation-card.ws-open .ws-orientation-body{display:block}.ws-orientation-copy{max-width:960px;margin:0 0 20px;color:var(--ws-charcoal);font-size:17px;line-height:1.68;text-wrap:pretty}.ws-orientation-copy h3{margin:0 0 14px;color:var(--ws-navy);font:700 30px/1.1 'Playfair Display',serif}.ws-orientation-copy p{margin:0 0 13px}.ws-orientation-copy p:last-child{margin-bottom:0}.ws-ready-row{display:flex;gap:10px;align-items:center;margin-top:14px;color:var(--ws-navy);font-weight:700}.ws-ready-row input{width:18px;height:18px}.ws-how-row{margin-top:14px}.ws-how-toggle{width:100%;border:0;background:#efe7d9;border-radius:8px;display:flex;align-items:center;gap:12px;padding:12px;color:var(--ws-navy);text-align:left;cursor:pointer}.ws-how-toggle .ws-media-icon{width:26px;height:26px;font-size:12px}.ws-how-toggle .ws-disclosure-icon{margin-left:auto;width:28px;height:28px;font-size:18px}.ws-how-body{display:none;padding:14px 2px 0}.ws-how-body.ws-open{display:block}.ws-step-tabs{position:sticky;top:54px;z-index:25;background:var(--ws-cream);border-bottom:1px solid var(--ws-line)}.ws-step-tabs-inner{width:min(1180px,calc(100% - 32px));margin:0 auto;display:flex;gap:24px}.ws-step-tab{min-height:46px;display:inline-flex;align-items:center;border-bottom:3px solid transparent;color:var(--ws-steel);font:700 11px Lato,sans-serif;letter-spacing: 0;text-transform: none;text-decoration:none}.ws-step-tab.ws-active{color:var(--ws-navy);border-bottom-color:var(--ws-gold)}.ws-breadcrumb{display:none}.ws-gold-cta{margin-top:18px;background:var(--ws-gold);border-radius:10px;padding:16px 18px;display:flex;justify-content:space-between;align-items:center;gap:16px;color:var(--ws-navy);font-weight:700}.ws-gold-cta a{color:var(--ws-navy);font:700 12px Lato,sans-serif;text-transform: none;text-decoration:none}.ws-phase-card .ws-dot.empty{background:#fff;border:1px solid var(--ws-line)}.ws-phase-card .ws-dot.half{background:linear-gradient(90deg,var(--ws-gold) 50%,#fff 50%);border:1px solid var(--ws-gold)}.ws-phase-card .ws-dot.solid{background:var(--ws-gold);border:1px solid var(--ws-gold)}.ws-locked .ws-dot{background:#e4e4e4!important;border-color:#d6d6d6!important}.ws-locked .ws-phase-stripe{background:#d5d5d5}.ws-locked .ws-button{background:#f7f5ef;border-color:#d8d2c8;color:#9a9389}.ws-pill-locked{background:#efefef;color:#9a9389}.ws-pill-progress{background:rgba(238,163,32,.18);color:var(--ws-navy)}.ws-orientation-prompt{display:flex;align-items:center;gap:12px;background:#FFF8EC;border:1px solid rgba(238,163,32,.45);border-radius:8px;padding:13px 16px;font-size:14px;color:var(--ws-navy)}.ws-orientation-prompt a{color:var(--ws-navy);font-weight:700}",
      ".ws-mission-card{position:relative;overflow:hidden;background:#fff;border:1px solid var(--ws-line);border-radius:12px;box-shadow:none}.ws-mission-rail{position:absolute;inset:0 auto 0 0;width:6px;background:var(--ws-gold)}.ws-mission-inner{padding:24px 26px 24px 30px}.ws-mission-preview{margin:-24px -26px 20px -30px;padding:8px 30px;background:var(--ws-navy);color:#fff;font:700 10px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none}.ws-mission-header{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}.ws-mission-header h1{margin:5px 0 6px;color:var(--ws-navy);font:700 32px/1.08 'Playfair Display',serif}.ws-mission-recognition{margin:0;color:var(--ws-steel);font-size:15px}.ws-mission-mark{width:42px;height:42px;border:2px solid var(--ws-navy);border-radius:999px;color:var(--ws-gold);display:grid;place-items:center;font-weight:700}.ws-mission-prompt{display:grid;gap:4px;margin:22px 0 14px}.ws-mission-prompt strong{color:var(--ws-navy);font-size:18px}.ws-mission-prompt span{color:var(--ws-steel);font-size:14px}.ws-mission-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0;padding:0;border:0}.ws-mission-option{position:relative;display:block;min-width:0;min-height:190px;padding:17px 16px 15px;border:1px solid var(--ws-line);border-radius:10px;background:#FAF8F3;cursor:pointer;transition:border-color .16s ease,background .16s ease}.ws-mission-option:hover{border-color:var(--ws-steel)}.ws-mission-option:focus-within{outline:3px solid rgba(238,163,32,.48);outline-offset:2px}.ws-mission-option.ws-selected{border:2px solid var(--ws-navy);background:#FFF8EC;padding:16px 15px 14px}.ws-mission-option>input{position:absolute;opacity:0;pointer-events:none}.ws-mission-radio{position:absolute;right:14px;top:14px;width:22px;height:22px;border:2px solid var(--ws-steel);border-radius:999px;background:#fff}.ws-selected .ws-mission-radio{border:6px solid var(--ws-navy);background:var(--ws-gold)}.ws-mission-option-head{display:flex;justify-content:space-between;gap:38px;align-items:flex-start}.ws-mission-option-head small{display:block;color:var(--ws-gold);font:700 9px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none}.ws-mission-option-head strong{display:block;margin-top:4px;color:var(--ws-navy);font:700 19px/1.15 'Playfair Display',serif}.ws-mission-option-head b{display:none}.ws-mission-option ol{display:grid;gap:9px;margin:16px 0 0;padding:0;list-style:none}.ws-mission-option li{display:grid;grid-template-columns:22px 1fr;gap:7px;align-items:start}.ws-mission-task-icon{color:var(--ws-navy);font-size:12px;line-height:18px}.ws-mission-option li strong{display:block;color:var(--ws-navy);font-size:13px;line-height:1.25}.ws-mission-option li small{display:block;margin-top:2px;color:var(--ws-steel);font-size:11px}.ws-mission-action{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:16px;padding-top:16px;border-top:1px solid var(--ws-line)}.ws-mission-action small{display:block;color:var(--ws-gold);font:700 9px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none}.ws-mission-action strong{display:block;margin-top:3px;color:var(--ws-navy);font-size:14px}.ws-mission-bonus{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;margin-top:16px;padding:13px 14px;border-radius:8px;background:#FAF8F3;color:var(--ws-navy)}.ws-mission-star{color:var(--ws-gold);font-size:23px}.ws-mission-bonus small{display:block;margin-bottom:3px;color:var(--ws-gold);font:700 9px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none}.ws-mission-bonus span span{font-size:13px;line-height:1.35}.ws-mission-bonus b{color:var(--ws-steel);font:700 11px Lato, Arial, sans-serif;white-space:nowrap}.ws-mission-complete{display:grid;gap:4px;margin-top:20px;padding:16px;border-radius:9px;background:#F6FBF7;color:var(--ws-navy)}.ws-mission-complete span{color:var(--ws-steel)}",
      ".ws-practice-reminder{margin:24px 0;background:#fff7e8;border:1px solid rgba(238,163,32,.35);border-radius:10px;padding:14px 16px;color:var(--ws-navy);font-weight:700}.ws-practice-reminder a{color:var(--ws-navy);text-decoration:underline;text-underline-offset:3px}.ws-practice-list{display:grid;gap:18px}.ws-practice-card{background:#fff;border:1px solid var(--ws-line);border-radius:12px;overflow:hidden}.ws-practice-head{width:100%;border:0;background:#fff;display:grid;grid-template-columns:1fr auto;gap:14px;padding:22px 22px 12px;text-align:left;cursor:pointer}.ws-practice-head h3{margin:6px 0;color:var(--ws-navy);font:700 30px 'Playfair Display',serif}.ws-practice-head p{margin:0;color:var(--ws-steel);line-height:1.45}.ws-practice-chevron{width:26px;height:26px;border-radius:6px;background:var(--ws-gold);color:#fff;display:inline-grid;place-items:center;font:700 20px/1 Lato,sans-serif}.ws-practice-body{display:none;padding:0 22px 22px}.ws-practice-card.ws-open .ws-practice-body{display:block}.ws-exercise-tabs{display:flex;gap:22px;border-bottom:2px solid var(--ws-line);margin:10px 0 8px}.ws-exercise-tab{border:0;border-bottom:3px solid transparent;background:transparent;color:#9a9a9a;display:inline-flex;align-items:center;gap:8px;padding:12px 0 11px;font:700 12px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none;cursor:pointer}.ws-exercise-tab.ws-active{color:var(--ws-navy);border-bottom-color:var(--ws-gold)}.ws-tab-badge{width:22px;height:22px;border-radius:999px;background:#e8e0d4;color:#9a9a9a;display:inline-grid;place-items:center;font:700 11px Lato,sans-serif}.ws-exercise-tab.ws-active .ws-tab-badge{background:var(--ws-gold);color:#fff}.ws-tab-hint{margin:0 0 18px;color:#9a9a9a;font:700 9px Lato, Arial, sans-serif;letter-spacing: 0}.ws-tab-hint span{color:var(--ws-gold)}.ws-practice-pane{display:none}.ws-practice-pane.ws-active{display:block}.ws-before-block{background:var(--ws-cream);border:1px solid var(--ws-line);border-radius:10px;padding:18px;margin-bottom:16px}.ws-before-block h4,.ws-ai-context h4{margin:0 0 10px;font:700 12px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none}.ws-before-block h4{color:var(--ws-navy)}.ws-before-block p{margin:0;line-height:1.5}.ws-practice-pane .ws-context-embed{margin-bottom:16px}.ws-practice-pane .ws-button{width:100%}.ws-ai-context{background:var(--ws-navy);color:#fff;border-radius:10px;padding:20px 22px;margin-bottom:16px}.ws-ai-context h4{color:rgba(255,255,255,.62)}.ws-ai-context p{margin:0;color:#fff;line-height:1.55}.ws-ai-link-card{min-height:92px;border:2px solid var(--ws-line);border-radius:10px;background:#fff;color:var(--ws-navy);display:grid;grid-template-columns:54px 1fr auto;align-items:center;gap:16px;padding:16px 20px;margin-bottom:16px;text-decoration:none}.ws-ai-link-card:hover{border-color:var(--ws-gold)}.ws-ai-icon{width:42px;height:42px;border-radius:8px;background:#f3eee6;display:grid;place-items:center;font-size:22px}.ws-ai-link-card strong{display:block;color:var(--ws-navy);font-size:16px}.ws-ai-link-card small{display:block;color:var(--ws-charcoal);font-weight:700;margin-top:3px}.ws-ai-arrow{color:var(--ws-gold);font-size:22px}.ws-button-gold{background:var(--ws-gold);border-color:var(--ws-gold);color:#fff}.ws-button-dashed{background:#fff;border-style:dashed;border-color:rgba(0,51,102,.38);color:var(--ws-navy)}",
      ".ws-button{min-height:44px;border-radius:8px;border:1px solid var(--ws-gold);background:var(--ws-gold);color:var(--ws-navy);font:700 13px Lato,sans-serif;letter-spacing: 0;text-transform: none;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;padding:0 18px;cursor:pointer}.ws-button:hover{filter:brightness(.97)}.ws-button[disabled],.ws-button.ws-disabled{opacity:.45;cursor:not-allowed;filter:grayscale(.2)}.ws-button-secondary{background:#fff;border-color:rgba(0,51,102,.28);color:var(--ws-navy)}.ws-button-navy{background:var(--ws-navy);border-color:var(--ws-navy);color:#fff}",
      ".ws-progress-card{margin:34px 0 24px;background:#fff;border:1px solid var(--ws-line);border-radius:12px;padding:18px}.ws-progress-row{display:flex;justify-content:space-between;gap:16px;color:var(--ws-navy);font:700 11px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none}.ws-progress-track{height:12px;background:#EFE6D8;border-radius:999px;margin-top:12px;overflow:hidden}.ws-progress-fill{height:100%;background:linear-gradient(90deg,var(--ws-gold),#f4c15c);border-radius:999px}.ws-pace-note{margin:12px 0 0;color:var(--ws-steel);font-size:14px;line-height:1.45}.ws-level-explainer{max-width:850px;margin:10px 0 0;color:var(--ws-navy);font-size:14px;line-height:1.45}",
      ".ws-phase-list{display:grid;gap:18px}.ws-phase-card{position:relative;display:grid;grid-template-columns:8px 92px 1fr auto;align-items:center;gap:22px;min-height:178px;background:#fff;border:1px solid var(--ws-line);border-radius:12px;overflow:hidden;padding:22px 24px 22px 0;text-decoration:none;color:inherit;box-shadow:none}.ws-phase-card.ws-locked{opacity:.72}.ws-phase-stripe{align-self:stretch;background:var(--ws-gold)}.ws-locked .ws-phase-stripe{background:#d5d5d5}.ws-phase-number{color:rgba(0,51,102,.08);font:700 74px/1 'Playfair Display',serif;text-align:center}.ws-phase-content h2{margin:6px 0;color:var(--ws-navy);font:700 34px/1.05 'Playfair Display',serif}.ws-phase-content p{margin:0;color:var(--ws-steel);line-height:1.45}.ws-trail{display:flex;align-items:center;gap:8px;margin-top:16px;color:var(--ws-navy);font:700 10px Lato, Arial, sans-serif;text-transform: none;letter-spacing: 0}.ws-dot{width:10px;height:10px;border-radius:99px;background:var(--ws-gold)}.ws-arrow{color:var(--ws-steel)}.ws-pill{display:inline-flex;align-items:center;border-radius:999px;padding:5px 9px;font:700 10px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none}.ws-pill-gold{background:rgba(238,163,32,.18);color:var(--ws-navy)}.ws-pill-muted{background:#E8EEF4;color:var(--ws-steel)}.ws-pill-green{background:rgba(44,122,75,.12);color:var(--ws-green)}.ws-phase-actions{display:grid;gap:10px;justify-items:end}.ws-lock-note{font:400 12px Lato,sans-serif;color:var(--ws-steel);text-align:right;line-height:1.3;max-width:160px}",
      ".ws-stepper{display:flex;gap:10px;margin:28px 0;align-items:center}.ws-step{display:flex;align-items:center;gap:8px;border:0;border-bottom:2px solid var(--ws-line);background:transparent;padding:8px 2px;color:var(--ws-steel);font:700 11px Lato, Arial, sans-serif;text-transform: none;letter-spacing: 0}.ws-step.ws-active{border-bottom-color:var(--ws-navy);color:var(--ws-navy)}.ws-step.ws-done{border-bottom-color:var(--ws-green);color:var(--ws-green)}",
      ".ws-phase-flow{margin:28px 0 8px;background:#fff;border:1px solid var(--ws-line);border-left:4px solid var(--ws-gold);border-radius:12px;padding:20px;box-shadow:none}.ws-phase-flow-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:16px}.ws-phase-flow h2{margin:3px 0 6px;color:var(--ws-navy);font:700 28px/1.1 'Playfair Display',serif}.ws-phase-flow p{margin:0;color:var(--ws-steel);line-height:1.5}.ws-flow-progress{flex:0 0 auto;background:rgba(238,163,32,.16);border-radius:999px;padding:7px 10px;color:var(--ws-navy);font:700 10px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none}.ws-flow-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0 0 16px;padding:0;list-style:none}.ws-flow-step{border:1px solid var(--ws-line);border-radius:8px;background:#FAF8F3;padding:13px 14px;line-height:1.45}.ws-flow-step strong{display:block;margin-bottom:5px;color:var(--ws-navy)}.ws-flow-step.ws-current{border-color:rgba(238,163,32,.62);box-shadow:0 0 0 2px rgba(238,163,32,.16)}.ws-flow-step.ws-done{border-color:rgba(44,122,75,.38);background:#F7FBF7}.ws-flow-actions{display:flex;flex-wrap:wrap;align-items:center;gap:12px}.ws-flow-actions .ws-button{min-width:180px}.ws-flow-note{margin:0;color:var(--ws-steel);font-size:14px;font-weight:700}.ws-practice-locked{margin-top:24px;background:#fff;border:1px solid var(--ws-line);border-radius:12px;padding:26px;box-shadow:none}.ws-practice-locked h2{margin:0 0 8px;color:var(--ws-navy);font:700 32px/1.1 'Playfair Display',serif}.ws-practice-locked p{max-width:760px;margin:0 0 18px;color:var(--ws-steel);font-size:17px;line-height:1.55}.ws-practice-locked-list{display:grid;gap:10px;margin:0 0 20px;padding:0;list-style:none}.ws-practice-locked-list li{border:1px solid rgba(0,51,102,.12);border-radius:8px;background:#FAF8F3;padding:12px 14px;line-height:1.45}.ws-practice-locked-list strong{color:var(--ws-navy)}",
      ".ws-section{margin-top:30px}.ws-section-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:14px}.ws-section-head h2{margin:0;color:var(--ws-navy);font:700 31px 'Playfair Display',serif}.ws-count{color:var(--ws-steel);font:700 11px Lato, Arial, sans-serif;text-transform: none;letter-spacing: 0}",
      ".ws-player-card{background:#fff;border:1px solid var(--ws-line);border-radius:12px;overflow:hidden}.ws-player{position:relative;background:linear-gradient(135deg,#002448,#003366 55%,#244F78);color:#fff}.ws-player-placeholder{text-align:center;padding:22px}.ws-play-icon{width:58px;height:58px;border-radius:999px;background:var(--ws-gold);color:var(--ws-navy);display:grid;place-items:center;margin:0 auto 14px;font-size:24px}.ws-player-meta{position:static;padding:14px 18px 16px;background:var(--ws-navy);text-shadow:none}.ws-player-meta h3{margin:6px 0 0;color:#fff;font:700 25px 'Playfair Display',serif}.ws-player-actions{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px;border-top:1px solid var(--ws-line);background:#fff}.ws-player-action-text{color:var(--ws-steel);font-size:14px;line-height:1.4}.ws-player-action-text strong{display:block;color:var(--ws-navy);font-size:15px}.ws-player-actions .ws-button{flex:0 0 auto}.ws-player-actions .ws-button-secondary{border-color:rgba(44,122,75,.42);color:var(--ws-green)}",
      ".ws-video-access-help{background:#fff;color:var(--ws-charcoal);border-top:1px solid var(--ws-line)}.ws-video-access-help summary{display:flex;align-items:center;justify-content:space-between;gap:12px;list-style:none;cursor:pointer;padding:13px 16px;color:var(--ws-navy);font-weight:700}.ws-video-access-help summary::-webkit-details-marker{display:none}.ws-video-access-help summary span{display:inline-flex;align-items:center;gap:8px}.ws-video-access-help summary span:before{content:'?';width:22px;height:22px;border-radius:999px;background:rgba(238,163,32,.18);color:var(--ws-navy);display:inline-grid;place-items:center;font:700 13px Lato,sans-serif}.ws-video-access-help summary small{color:var(--ws-steel);font:700 10px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none;text-align:right}.ws-access-help-body{padding:0 16px 16px}.ws-access-help-body p{margin:0 0 10px;line-height:1.45}.ws-access-help-body ol{margin:0;padding-left:20px;display:grid;gap:8px;line-height:1.45}.ws-access-help-body li strong,.ws-access-help-body h4{color:var(--ws-navy)}.ws-access-help-body a{color:var(--ws-navy);font-weight:700;text-underline-offset:3px}.ws-access-warning{position:relative;background:#fff6f4;border:1px solid rgba(154,42,42,.24);border-left:4px solid #B44A42;border-radius:8px;padding:10px 12px 10px 14px;color:#6f2d2a;font-weight:700}.ws-access-warning strong{color:#8A2E29}.ws-access-top{display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:center;margin:12px 0 14px;padding:12px;border:1px solid rgba(0,51,102,.12);border-radius:8px;background:var(--ws-cream)}.ws-access-top p{margin:0}.ws-access-direct{display:inline-flex;align-items:center;justify-content:center;min-height:38px;padding:9px 13px;border-radius:6px;background:var(--ws-gold);color:var(--ws-navy)!important;text-decoration:none;font:700 12px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none;white-space:nowrap}.ws-access-guide{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.ws-access-guide section{border:1px solid var(--ws-line);border-radius:8px;background:#fff;padding:12px}.ws-access-guide h4{margin:0 0 8px;font:700 12px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none}.ws-access-footer{margin:12px 0 0!important;padding-top:10px;border-top:1px solid var(--ws-line)}",
      ".ws-rail-wrap{padding:22px 22px 24px;border-top:1px solid rgba(0,51,102,.08);background:#fff}.ws-scroll-hint{display:none;color:var(--ws-steel);font:700 10px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none;margin:0 0 8px}.ws-lesson-rail{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:14px}.ws-lesson-tile{min-height:108px;border:1px solid var(--ws-line);border-radius:10px;background:#fff;color:var(--ws-navy);padding:14px 38px 14px 14px;text-align:left;cursor:pointer}.ws-lesson-tile.ws-active{background:var(--ws-navy);color:#fff}.ws-lesson-tile strong{display:block;font:700 10px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none;margin-bottom:8px}.ws-lesson-tile span{display:block;font-size:13px;line-height:1.25}.ws-lesson-tile small{display:block;margin-top:9px;color:inherit;opacity:.75}.ws-check{color:var(--ws-gold);font-weight:700}",
      ".ws-collapsed{background:#fff;border:1px solid var(--ws-line);border-radius:12px;padding:18px;display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:14px;cursor:pointer}.ws-green-circle{width:34px;height:34px;border-radius:999px;background:var(--ws-green);color:#fff;display:grid;place-items:center;font-weight:700}.ws-video-toggle-icon{width:34px;height:34px;border-radius:9px;background:rgba(77,112,148,.16);color:var(--ws-navy);display:grid;place-items:center;font-size:16px;font-weight:700}.ws-collapsed h3{margin:0;color:var(--ws-navy);font:700 24px 'Playfair Display',serif}.ws-collapsed p{margin:2px 0 0;color:var(--ws-steel)}.ws-rewatch{display:none;background:#fff;border:1px solid var(--ws-line);border-top:0;border-radius:0 0 12px 12px;padding:22px}.ws-rewatch.ws-open{display:block}.ws-rewatch .ws-lesson-rail a{text-decoration:none}",
      ".ws-exercise-stack{display:grid;gap:20px}.ws-intro-contexts{gap:18px;margin:8px 0 24px}.ws-unit{border-radius:12px;overflow:hidden;box-shadow:none}.ws-exercises .ws-exercise-stack>.ws-unit{display:grid;gap:18px;background:#fff;border:1px solid var(--ws-line);padding:18px}.ws-exercises .ws-exercise-stack>.ws-unit>.ws-context-toggle{border-radius:10px}.ws-exercises .ws-exercise-stack>.ws-unit>.ws-context-panel{padding:0}.ws-exercises .ws-exercise-stack>.ws-unit>.ws-workbook-card{margin-top:0}.ws-stacked-unit{display:grid;gap:18px;background:#fff;border:1px solid var(--ws-line);padding:18px}.ws-stacked-unit .ws-context-toggle{border-radius:10px}.ws-stacked-unit .ws-context-panel{padding:0}.ws-stacked-unit .ws-workbook-card{margin:0}.ws-context{background:var(--ws-navy);color:#fff;padding:20px 22px}.ws-context-tag{color:var(--ws-gold);font:700 10px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none}.ws-context h3{margin:7px 0;color:#fff;font:700 27px 'Playfair Display',serif}.ws-context p{margin:0;color:rgba(255,255,255,.78);line-height:1.5}.ws-media-row{margin-top:14px;display:flex;align-items:center;gap:12px;border:1px solid rgba(255,255,255,.22);border-radius:10px;padding:11px;color:#fff;text-decoration:none}.ws-media-icon{width:34px;height:34px;border-radius:999px;background:var(--ws-gold);color:var(--ws-navy);display:grid;place-items:center;font-weight:700}.ws-media-row.ws-missing{opacity:.62;pointer-events:none}.ws-exercise-card{display:grid;grid-template-columns:1fr auto;gap:16px;background:#fff;border:1px solid var(--ws-line);border-top:0;padding:22px;text-decoration:none;color:inherit}.ws-exercise-card.ws-disabled{opacity:.55}.ws-exercise-card.ws-disabled a,.ws-exercise-card.ws-disabled button{pointer-events:none}.ws-exercise-card h3{margin:7px 0;color:var(--ws-navy);font:700 28px 'Playfair Display',serif}.ws-exercise-card p{margin:0 0 14px;color:var(--ws-steel);line-height:1.45}.ws-open-link{font:700 11px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none;color:var(--ws-navy)}.ws-mark-done{align-self:end}",
      ".ws-video-complete .ws-player-card,.ws-lesson-tile.ws-watched{border-color:var(--ws-green);box-shadow:0 0 0 2px rgba(44,122,75,.16)}.ws-lesson-tile{position:relative}.ws-lesson-check{position:absolute;top:8px;right:8px;width:20px;height:20px;border-radius:999px;border:1px solid rgba(0,51,102,.24);background:#fff;color:transparent;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;line-height:1;padding:0;text-align:center}.ws-lesson-tile.ws-watched .ws-lesson-check{background:var(--ws-green);border-color:var(--ws-green);color:#fff}.ws-video-check{position:absolute;top:14px;right:14px;width:30px;height:30px;border-radius:999px;border:1px solid rgba(255,255,255,.6);background:rgba(255,255,255,.9);color:transparent;display:flex;align-items:center;justify-content:center;font-size:15px;line-height:1;padding:0;font-weight:700;z-index:2;cursor:pointer}.ws-video-complete .ws-video-check{background:var(--ws-green);border-color:var(--ws-green);color:#fff}",
      ".ws-context-toggle{width:100%;display:flex;align-items:center;gap:14px;border:0;border-radius:10px;background:#ded6c8;color:var(--ws-navy);padding:16px 18px;text-align:left;cursor:pointer}.ws-context-toggle-icon{width:30px;height:30px;border-radius:8px;background:var(--ws-gold);color:#fff;display:grid;place-items:center;font-size:24px;font-weight:700;line-height:1}.ws-context-toggle-title{display:block;color:var(--ws-navy);font-size:17px;font-weight:700}.ws-context-toggle-sub{display:block;color:var(--ws-steel);font-size:14px;margin-top:2px}.ws-context-panel{display:none;padding:18px 0 0}.ws-context-panel.ws-open{display:block}.ws-context-panel-inner{color:var(--ws-charcoal)}.ws-context-panel-inner p{margin:0 0 14px;color:var(--ws-charcoal);line-height:1.5}.ws-context-embed{margin-top:14px;border-radius:10px;overflow:hidden;border:1px solid var(--ws-line)}.ws-context-panel .ws-media-row{background:var(--ws-navy);margin-top:14px}.ws-workbook-card{position:relative;margin-top:18px;background:#fff;border:1px solid var(--ws-line);border-radius:12px;padding:34px 36px;display:grid;gap:22px}.ws-workbook-card.ws-done{border:2px solid var(--ws-green);background:#f8fbf7}.ws-workbook-card.ws-disabled{opacity:.56}.ws-workbook-card.ws-disabled a,.ws-workbook-card.ws-disabled button{pointer-events:none}.ws-workbook-top{display:flex;align-items:center;gap:12px;color:var(--ws-steel);font:700 14px Lato,sans-serif;letter-spacing: 0;text-transform: none}.ws-status-circle{width:28px;height:28px;border-radius:999px;background:#d9e4ee;color:var(--ws-steel);display:grid;place-items:center;font:700 14px Lato,sans-serif}.ws-workbook-card.ws-done .ws-status-circle{background:var(--ws-green);color:#fff}.ws-workbook-card h3{margin:0;color:var(--ws-navy);font:700 clamp(34px,5vw,54px)/1.02 'Playfair Display',serif}.ws-workbook-card p{max-width:780px;margin:0;color:var(--ws-steel);font-size:22px;line-height:1.35}.ws-card-actions{display:flex;gap:12px;flex-wrap:wrap;justify-content:center}.ws-card-actions .ws-button{min-width:190px}.ws-done-pill{display:inline-flex;align-items:center;gap:5px;background:rgba(44,122,75,.12);color:var(--ws-green);border-radius:999px;padding:4px 10px;font:700 12px Lato,sans-serif;letter-spacing:0;text-transform:none}",
      ".ws-practice-body>.ws-context-embed,.ws-practice-pane .ws-context-embed{margin-bottom:22px}.ws-card-actions{display:grid;gap:22px;justify-content:stretch;margin-top:22px}.ws-card-actions .ws-button{width:100%;min-width:0}.ws-context-completion{width:100%;box-sizing:border-box;margin-bottom:18px;border:1px solid var(--ws-line);border-radius:10px;padding:16px;background:#fff}.ws-context-completion .ws-button{width:auto;min-width:190px}.ws-context-completion.ws-context-done{background:#F6FBF7;border-color:rgba(44,122,75,.32)}.ws-mark-incomplete{justify-self:center;border:0;background:transparent;color:var(--ws-steel);font:700 12px Lato,sans-serif;text-decoration:underline;text-underline-offset:3px;cursor:pointer;padding:4px 8px}.ws-mark-incomplete:hover{color:var(--ws-navy)}",
      ".ws-admin-visibility{margin-top:30px;background:#fff;border:1px solid var(--ws-line);border-radius:12px;padding:18px;display:grid;gap:12px}.ws-check-row{display:flex;align-items:flex-start;gap:10px;color:var(--ws-navy);font-weight:700}.ws-check-row input{margin-top:3px}.ws-help{margin:0;color:var(--ws-steel);font-size:14px;line-height:1.45}",
      ".ws-bottom-nav{display:flex;justify-content:space-between;gap:12px;margin-top:34px}.ws-bottom-nav .ws-button{min-width:180px}.ws-admin-grid{display:grid;gap:16px;margin-top:30px}.ws-admin-phase{background:#fff;border:1px solid var(--ws-line);border-radius:12px;overflow:hidden}.ws-admin-toggle{width:100%;display:grid;grid-template-columns:74px 1fr auto;align-items:center;gap:16px;border:0;background:#fff;padding:18px;text-align:left;cursor:pointer}.ws-admin-num{color:rgba(0,51,102,.12);font:700 54px 'Playfair Display',serif}.ws-admin-body{display:none;padding:0 18px 18px}.ws-admin-phase.ws-open .ws-admin-body{display:block}.ws-slot{border-top:1px solid var(--ws-line);padding:16px 0;display:grid;gap:10px}.ws-slot-head{display:flex;justify-content:space-between;gap:12px}.ws-type-buttons{display:flex;gap:8px}.ws-type-button{border:1px solid rgba(0,51,102,.25);background:#fff;color:var(--ws-navy);border-radius:999px;padding:7px 10px;font:700 10px Lato, Arial, sans-serif;cursor:pointer}.ws-type-button.ws-selected{background:var(--ws-navy);color:#fff}.ws-save-row{display:flex;gap:8px}.ws-save-row .ws-input{background:#fbf7ef}.ws-save-note{min-height:18px;color:var(--ws-green);font:700 11px Lato, Arial, sans-serif}.ws-save-bar{position:sticky;bottom:0;background:#fff;border-top:1px solid var(--ws-line);padding:12px 0;margin-top:32px;box-shadow:0 -8px 20px rgba(0,51,102,.07)}.ws-save-bar-inner{display:flex;justify-content:space-between;align-items:center;gap:16px}",
      ".ws-nudge-continue{display:flex;align-items:center;gap:16px;background:#fff;border:1px solid var(--ws-line);border-left:4px solid var(--ws-gold);border-radius:12px;padding:18px 20px;box-shadow:none}.ws-nudge-continue-text{flex:1;min-width:0}.ws-nudge-continue-label{color:var(--ws-gold);font:700 10px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none;display:block;margin-bottom:4px}.ws-nudge-continue-title{color:var(--ws-navy);font:700 18px 'Playfair Display',serif;margin:0 0 2px}.ws-nudge-continue-sub{color:var(--ws-steel);font-size:13px;margin:0}.ws-nudge-days{display:flex;align-items:center;gap:12px;background:#F3EDE2;border:1px solid rgba(0,51,102,.12);border-radius:10px;padding:12px 16px;font-size:14px;color:var(--ws-navy)}.ws-nudge-days-icon{font-size:20px;flex-shrink:0}.ws-nudge-almost{display:block;margin-top:8px;padding:6px 10px;background:rgba(238,163,32,.12);border-radius:6px;color:var(--ws-navy);font:700 11px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none}.ws-nudge-modal-overlay{position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:24px}.ws-nudge-modal{background:#fff;border-radius:14px;max-width:420px;width:100%;padding:40px 36px 32px;text-align:center;position:relative;box-shadow:0 24px 64px rgba(0,51,102,.22)}.ws-nudge-modal-close{position:absolute;top:12px;right:14px;background:none;border:none;font-size:22px;color:#aaa;cursor:pointer;min-width:36px;min-height:36px;display:flex;align-items:center;justify-content:center}.ws-nudge-modal-icon{width:56px;height:56px;border-radius:999px;background:rgba(238,163,32,.15);display:grid;place-items:center;margin:0 auto 18px;font-size:28px}.ws-nudge-modal h2{margin:0 0 10px;color:var(--ws-navy);font:700 26px 'Playfair Display',serif}.ws-nudge-modal p{margin:0 0 24px;color:var(--ws-steel);font-size:15px;line-height:1.55}.ws-nudge-modal .ws-button{width:100%}",
      ".ws-phase-progress-panel{margin:28px 0 24px;background:#fff;border:1px solid var(--ws-line);border-radius:12px;padding:18px;box-shadow:none}.ws-phase-progress-top{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:start}.ws-phase-progress-top h2{margin:0;color:var(--ws-navy);font:700 28px/1.1 'Playfair Display',serif}.ws-phase-progress-top p{margin:5px 0 0;color:var(--ws-steel);line-height:1.45}.ws-phase-percent{min-width:82px;min-height:48px;border-radius:999px;background:#FFF3D8;color:var(--ws-navy);display:grid;place-items:center;font:700 16px Lato, Arial, sans-serif}.ws-phase-meter{height:12px;margin:16px 0 14px;border-radius:999px;background:#EFE6D8;overflow:hidden}.ws-phase-meter span{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--ws-green),#77AA81)}.ws-phase-milestones{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.ws-milestone{border:1px solid var(--ws-line);border-radius:10px;background:#FAF8F3;padding:13px 14px;display:grid;grid-template-columns:auto 1fr;gap:11px;align-items:center}.ws-milestone.ws-complete{border-color:rgba(44,122,75,.42);background:#F6FBF7}.ws-milestone-check{width:30px;height:30px;border-radius:999px;border:1px solid rgba(0,51,102,.22);background:#fff;color:transparent;display:grid;place-items:center;font-weight:700}.ws-milestone.ws-complete .ws-milestone-check{border-color:var(--ws-green);background:var(--ws-green);color:#fff}.ws-milestone strong{display:block;color:var(--ws-navy);font-size:14px}.ws-milestone small{display:block;margin-top:2px;color:var(--ws-steel);font-weight:700}.ws-next-action{margin-top:14px;display:flex;align-items:center;justify-content:space-between;gap:14px;border-top:1px solid rgba(0,51,102,.1);padding-top:14px}.ws-next-action span{color:var(--ws-navy);font-weight:700}.ws-complete-banner{margin-top:14px;border:1px solid rgba(44,122,75,.38);background:#F6FBF7;border-radius:10px;padding:12px 14px;color:var(--ws-navy);font-weight:700}",
      ".ws-phase-progress-top{grid-template-columns:1fr}.ws-phase-percent,.ws-phase-meter,.ws-phase-milestones{display:none}.ws-progress-split{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:16px}.ws-progress-metric{border:1px solid var(--ws-line);border-radius:10px;background:#FAF8F3;padding:14px}.ws-progress-metric.ws-complete{border-color:rgba(44,122,75,.42);background:#F6FBF7}.ws-progress-metric-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:10px}.ws-progress-metric strong{display:block;color:var(--ws-navy);font-size:15px}.ws-progress-metric small{display:block;margin-top:3px;color:var(--ws-steel);font-weight:700}.ws-progress-value{border-radius:999px;background:#FFF3D8;color:var(--ws-navy);padding:6px 9px;font:700 11px Lato, Arial, sans-serif;white-space:nowrap}.ws-progress-metric.ws-complete .ws-progress-value{background:#EAF5ED;color:var(--ws-green)}.ws-metric-track{height:10px;border-radius:999px;background:#EFE6D8;overflow:hidden}.ws-metric-track span{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--ws-green),#77AA81)}.ws-progress-guidance{margin-top:12px;color:var(--ws-steel);font-size:14px;font-weight:700;line-height:1.45}",
      ".ws-practice-card.ws-complete,.ws-unit.ws-complete{border-color:rgba(44,122,75,.42);background:#FBFEFB}.ws-practice-card.ws-complete .ws-practice-head,.ws-unit.ws-complete .ws-context-toggle{background:#F6FBF7}.ws-practice-status-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:6px}.ws-card-check{width:30px;height:30px;border-radius:999px;border:1px solid rgba(0,51,102,.22);background:#fff;color:transparent;display:inline-grid;place-items:center;font-weight:700;flex:0 0 auto}.ws-complete .ws-card-check,.ws-workbook-card.ws-done .ws-status-circle{border-color:var(--ws-green);background:var(--ws-green);color:#fff}.ws-card-role{display:inline-flex;align-items:center;border-radius:999px;background:var(--ws-navy);color:#fff;padding:5px 9px;font:700 10px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none}.ws-card-state{display:inline-flex;align-items:center;gap:6px;border-radius:999px;background:#F7F1E7;color:var(--ws-steel);padding:5px 9px;font:700 10px Lato, Arial, sans-serif;letter-spacing: 0;text-transform: none}.ws-card-state.ws-done{background:#EAF5ED;color:var(--ws-green)}.ws-card-state.ws-next{background:var(--ws-gold);color:var(--ws-navy);box-shadow:0 0 0 2px rgba(238,163,32,.18)}.ws-practice-state{display:flex;align-items:center;justify-content:flex-end;gap:8px;justify-self:end;white-space:nowrap}.ws-exercise-tab.ws-tab-done{color:var(--ws-green)}.ws-exercise-tab.ws-tab-done .ws-tab-badge{background:var(--ws-green);color:#fff}.ws-workbook-card.ws-done{border-color:rgba(44,122,75,.42);background:#F6FBF7}.ws-workbook-card.ws-done .ws-button:first-child{background:#fff;border-color:rgba(44,122,75,.38);color:var(--ws-navy)}",
      ".ws-practice-card{box-shadow:none}.ws-practice-head{width:calc(100% - 44px);box-sizing:border-box;grid-template-columns:auto minmax(0,1fr) auto;align-items:start;background:#F0E9DD;border:1px solid rgba(0,51,102,.08);border-radius:12px;margin:22px 22px 0;padding:18px 22px;column-gap:18px;row-gap:10px}.ws-practice-head>span:not(.ws-practice-chevron):not(.ws-practice-state){min-width:0}.ws-practice-chevron{grid-column:1;width:30px;height:30px;margin-top:2px}.ws-practice-head h3{margin:7px 0 4px}.ws-practice-head p{font-size:16px}.ws-practice-card.ws-next-card{border-color:rgba(238,163,32,.55)}.ws-practice-card.ws-next-card .ws-practice-head{background:#FFF7E8;border-color:rgba(238,163,32,.58);border-left:5px solid var(--ws-gold)}.ws-practice-card.ws-complete .ws-practice-head{background:#F6FBF7;border:1px solid rgba(44,122,75,.3);box-shadow:none}.ws-practice-card.ws-complete .ws-practice-head h3{color:rgba(0,51,102,.54)}.ws-practice-card.ws-complete .ws-practice-head p{color:rgba(77,112,148,.62)}.ws-practice-card.ws-complete .ws-card-role{background:rgba(0,51,102,.62)}.ws-practice-card:not(.ws-complete) .ws-card-check{display:none}.ws-practice-body{padding:18px 22px 22px}.ws-practice-card.ws-open .ws-practice-head{border-radius:12px}.ws-practice-card:not(.ws-open) .ws-practice-head{margin-bottom:22px}.ws-context-card{border-color:rgba(77,112,148,.28);background:#F8FBFC}.ws-context-card .ws-practice-head{background:#EEF3F6;border:1px solid rgba(77,112,148,.22);box-shadow:none}.ws-context-card .ws-practice-chevron{background:#4D7094}.ws-context-card .ws-kicker{color:#4D7094}.ws-context-card .ws-practice-body{background:#F8FBFC}",
      "@media(max-width:768px){.ws-phase-flow{padding:18px}.ws-phase-flow-head{display:grid}.ws-flow-progress{width:max-content}.ws-flow-steps{grid-template-columns:1fr}.ws-flow-actions{display:grid}.ws-flow-actions .ws-button{width:100%}.ws-practice-locked{padding:22px 18px}.ws-practice-locked h2{font-size:28px}.ws-phase-progress-top,.ws-phase-milestones,.ws-progress-split{grid-template-columns:1fr}.ws-phase-percent{width:max-content}.ws-next-action{align-items:flex-start;flex-direction:column}.ws-next-action .ws-button{width:100%}.ws-card-check{width:28px;height:28px}.ws-practice-head{width:calc(100% - 32px);grid-template-columns:auto minmax(0,1fr);margin:16px 16px 0;padding:16px}.ws-practice-state{grid-column:2;justify-self:start;white-space:normal}.ws-practice-card:not(.ws-open) .ws-practice-head{margin-bottom:16px}.ws-practice-body{padding:16px 16px 16px}}",
      "@media(min-width:769px) and (max-width:1100px){.ws-shell{width:calc(100% - 48px)}.ws-main{padding:44px 0 64px}.ws-title{font-size:clamp(48px,7vw,62px)}.ws-subtitle{max-width:none;font-size:18px;line-height:1.55}.ws-orientation-copy,.ws-journey-sub,.ws-level-explainer,.ws-practice-locked p,.ws-workbook-card p{max-width:none}.ws-phase-card{grid-template-columns:8px 72px 1fr auto;gap:16px}.ws-phase-number{font-size:60px}}",
      "@media(max-width:768px){body.ws-page{background:var(--ws-cream)}.ws-shell{width:calc(100% - 28px)}.ws-nav-inner{height:auto;grid-template-columns:auto 1fr auto;grid-template-rows:auto auto;gap:0 10px;width:100%;padding:8px 12px 0}.ws-brand{grid-column:1;grid-row:1;height:42px;align-items:center}.ws-logo{height:30px}.ws-user{grid-column:3;grid-row:1;height:42px}.ws-user-email{display:none}.ws-avatar{width:36px;height:36px}.ws-links{grid-column:1/-1;grid-row:2;justify-content:flex-start;overflow-x:auto;white-space:nowrap;gap:10px;border-top:1px solid rgba(255,255,255,.14);scrollbar-width:none}.ws-links::-webkit-scrollbar,.ws-lesson-rail::-webkit-scrollbar,.ws-step-tabs-inner::-webkit-scrollbar,.ws-exercise-tabs::-webkit-scrollbar{display:none}.ws-link{min-height:42px;font-size:14px}.ws-sep{opacity:.55}.ws-phase-menu{position:fixed;left:12px;right:12px;top:92px;width:auto}.ws-profile-menu{position:fixed;top:56px;right:12px;left:auto;width:min(270px,calc(100vw - 24px));max-width:none}.ws-main{padding:24px 0 48px}.ws-title{font-size:40px}.ws-subtitle{font-size:17px}.ws-login-wrap{min-height:calc(100svh - 54px);padding:28px 16px}.ws-login-card{padding:28px 24px}.ws-login-card .ws-title{font-size:54px}.ws-login-card .ws-subtitle{font-size:18px}.ws-login-card .ws-google-button{min-height:50px}.ws-journey-head{padding:16px;align-items:start}.ws-journey-title{font-size:25px}.ws-journey-body{padding:0 16px 18px}.ws-journey-map{grid-template-columns:1fr}.ws-journey-step{min-height:0}.ws-journey-actions{display:grid;justify-content:stretch}.ws-journey-cue{justify-content:space-between}.ws-orientation-head{grid-template-columns:1fr auto;align-items:start;padding:16px}.ws-start-badge{width:max-content;margin-bottom:8px}.ws-orientation-title{font-size:18px}.ws-orientation-sub{font-size:15px;line-height:1.35}.ws-orientation-body{padding:0 16px 18px}.ws-orientation-copy{font-size:16px;line-height:1.58}.ws-orientation-copy h3{font-size:28px}.ws-disclosure-icon{width:34px;height:34px}.ws-player-card,.ws-context-embed{border-radius:12px}.ws-player-meta{position:static;padding:12px 14px;background:var(--ws-navy);text-shadow:none}.ws-player-meta h3{font-size:21px}.ws-video-access-help summary{align-items:flex-start;flex-direction:column}.ws-access-top,.ws-access-guide{grid-template-columns:1fr}.ws-access-direct{width:100%;white-space:normal;text-align:center}.ws-how-toggle{padding:12px}.ws-ready-row{align-items:flex-start;font-size:16px;line-height:1.35}.ws-ready-row input{margin-top:3px;flex:0 0 auto}.ws-step-tabs{top:85px}.ws-step-tabs-inner{width:100%;padding:0 12px;overflow-x:auto;scrollbar-width:none;gap:20px}.ws-step-tab{flex:0 0 auto;min-height:42px;font-size:10px}.ws-gold-cta{align-items:flex-start;flex-direction:column}.ws-exercise-tabs{gap:14px;overflow-x:auto;scrollbar-width:none}.ws-exercise-tab{flex:0 0 auto;font-size:10px}.ws-ai-link-card{grid-template-columns:42px 1fr;gap:12px;padding:14px}.ws-ai-arrow{display:none}.ws-phase-card{grid-template-columns:6px 50px 1fr;gap:12px;min-height:150px;padding:18px 14px 18px 0}.ws-phase-actions{grid-column:2/-1;justify-items:start}.ws-phase-number{font-size:46px}.ws-phase-content h2{font-size:27px}.ws-stepper{flex-wrap:wrap}.ws-section{margin-top:24px}.ws-section-head{align-items:flex-start;flex-direction:column}.ws-player-actions{align-items:flex-start;flex-direction:column}.ws-scroll-hint{display:block}.ws-lesson-rail{display:flex;overflow-x:auto;gap:10px;padding-bottom:4px;scrollbar-width:none}.ws-lesson-tile{min-width:124px}.ws-collapsed{grid-template-columns:auto 1fr auto}.ws-collapsed .ws-pill{display:none}.ws-context-toggle{padding:14px}.ws-workbook-card{padding:24px 20px}.ws-workbook-top{font-size:11px;letter-spacing: 0}.ws-workbook-card h3{font-size:34px}.ws-workbook-card p{font-size:17px}.ws-card-actions .ws-button{width:100%}.ws-exercise-card{grid-template-columns:1fr}.ws-bottom-nav{flex-direction:row}.ws-bottom-nav .ws-button{min-width:0;flex:1;padding:0 10px;font-size:10px}.ws-admin-toggle{grid-template-columns:48px 1fr auto}.ws-save-bar-inner{flex-direction:column;align-items:stretch}.ws-save-row{flex-direction:column}}",
      "@media(max-width:768px){.ws-user{gap:6px}.ws-player-actions{align-items:stretch;padding:14px}.ws-player-actions .ws-button{width:100%;min-height:48px}.ws-player-action-text{font-size:14px}}"
      ,"@media(max-width:768px){.ws-mission-rail{width:4px}.ws-mission-inner{padding:19px 16px 18px 20px}.ws-mission-preview{margin:-19px -16px 17px -20px;padding:8px 20px}.ws-mission-header h1{font-size:28px}.ws-mission-mark{width:32px;height:32px}.ws-mission-prompt{margin-top:19px}.ws-mission-options{grid-template-columns:1fr;gap:10px}.ws-mission-option{min-height:0}.ws-mission-option-head b{display:block;margin-right:28px;color:var(--ws-steel);font:700 10px Lato, Arial, sans-serif;white-space:nowrap}.ws-mission-option ol{margin-top:12px}.ws-mission-action{align-items:stretch;flex-direction:column}.ws-mission-action .ws-button{width:100%;min-height:48px}.ws-mission-bonus{grid-template-columns:auto 1fr}.ws-mission-bonus>b{grid-column:2}.ws-mission-recognition{line-height:1.45}}@media(prefers-reduced-motion:reduce){.ws-mission-option{transition:none}}"
      ,".ws-journey-card.ws-complete,.ws-orientation-card.ws-complete{background:#f4f1ea;border-color:#d8d2c6}.ws-journey-card.ws-complete .ws-journey-head,.ws-orientation-card.ws-complete .ws-orientation-head{color:var(--ws-steel)}.ws-journey-card.ws-complete .ws-kicker,.ws-orientation-card.ws-complete .ws-start-badge{color:#68766f}"
    ].join("\n");
    document.head.appendChild(style);
  }

  function pageShell(active, contentHtml, subnavHtml) {
    injectStyles();
    document.body.classList.add("ws-page");
    document.body.innerHTML = navHtml(active) + (subnavHtml || "") + '<main class="ws-main"><div class="ws-shell">' + contentHtml + "</div></main>";
    bindNav();
    renderWorkspaceRewardCluster();
    checkMissionProgressMoment();
  }

  function renderWorkspaceRewardCluster() {
    var mount = qs("#wsRewardCluster");
    if (!mount) return;
    ensureRewardUiLoaded().then(function (rewardUi) {
      if (!rewardUi || !qs("#wsRewardCluster")) return;
      rewardUi.renderCluster(qs("#wsRewardCluster"), { state: readRewardState() });
    });
  }

  function showWorkspaceRewardMoment(details) {
    ensureRewardUiLoaded().then(function (rewardUi) {
      if (rewardUi && rewardUi.handleRewardMoment) {
        rewardUi.handleRewardMoment(Object.assign({ container: qs("#wsRewardCluster") }, details || {}));
        return;
      }
      showRewardToast(details);
    });
  }

  function showRewardToast(details) {
    if (!details) return;
    var existing = qs(".ws-reward-toast");
    if (existing) existing.remove();
    var toast = document.createElement("div");
    toast.className = "ws-reward-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.innerHTML =
      '<span>' + escapeHtml(details.label || "Reward") + '</span>' +
      '<strong>' + escapeHtml(details.title || "") + '</strong>' +
      '<p>' + escapeHtml(details.body || "") + '</p>';
    document.body.appendChild(toast);
    requestAnimationFrame(function () { toast.classList.add("ws-visible"); });
    setTimeout(function () {
      toast.classList.remove("ws-visible");
      setTimeout(function () { toast.remove(); }, 220);
    }, 3200);
  }

  function navHtml(active) {
    var user = currentUser();
    var avatar = user.photoURL ? '<img src="' + escapeHtml(user.photoURL) + '" alt="">' : escapeHtml(user.initials);
    var roleLabel = user.role === "admin" ? "Administrator" : "Member";
    var adminSection = user.role === "admin" ? '<div class="ws-profile-section"><span class="ws-profile-section-label">Admin</span><a class="ws-admin-link" href="' + adminHref() + '"><span class="ws-profile-icon">&#9788;</span><span>Admin console</span></a></div>' : "";
    var links = [
      { key: "home", label: "Home", href: memberHref("index.html") },
      { key: "phase1", label: "Phase 1", href: memberHref("phase-1.html"), dropdown: true },
      { key: "phase2", label: "Phase 2", href: memberHref("phase-2.html"), dropdown: true },
      { key: "phase3", label: "Phase 3", href: memberHref("phase-3.html"), dropdown: true },
      { key: "assessments", label: "Assessments", href: memberHref("index.html") + "#assessments", hidden: localStorage.getItem("utl_tsa_status") === "hidden" },
    ].filter(function (link) { return !link.hidden; });
    if (active === "admin") links.push({ key: "admin", label: "Admin", href: adminHref() });
    return '<header class="ws-nav"><div class="ws-nav-inner">' +
      '<div class="ws-brand"><a class="ws-logo-link" href="' + homeHref() + '" aria-label="The Untaught Lessons member home"><img class="ws-logo" src="' + assetHref("../assets/utl-logo-nav-white.png") + '" alt="The Untaught Lessons"></a></div>' +
      '<nav class="ws-links" aria-label="Member workspace">' + links.map(function (link, index) {
        if (link.dropdown) {
          return (index ? '<span class="ws-sep">|</span>' : "") + phaseDropdownHtml(link, active);
        }
        return (index ? '<span class="ws-sep">|</span>' : "") + '<a class="ws-link ' + (active === link.key ? "ws-active" : "") + '" href="' + link.href + '">' + link.label + '</a>';
      }).join("") + '</nav>' +
      '<div class="ws-user">' + (active === "admin" ? "" : missionNavHtml() + '<div id="wsRewardCluster" class="ws-reward-cluster-shell" data-utl-reward-mount aria-label="Learning rewards"></div>') + '<span class="ws-user-email">' + escapeHtml(user.email) + '</span><button class="ws-avatar" type="button" aria-label="Open profile menu" aria-expanded="false">' + avatar + '</button><div class="ws-profile-menu" hidden><div class="ws-profile-head"><span class="ws-profile-avatar">' + avatar + '</span><div><p class="ws-profile-name">' + escapeHtml(user.label) + '</p><p class="ws-profile-role">' + roleLabel + '</p></div></div><div class="ws-profile-section"><span class="ws-profile-section-label">Your space</span><a href="' + appHref("../my-results/index.html") + '"><span class="ws-profile-icon">&#9638;</span><span>My results</span></a><a href="' + appHref("../apps/toolkit/index.html") + '"><span class="ws-profile-icon">&#8962;</span><span>Toolkit</span></a></div><div class="ws-profile-section"><span class="ws-profile-section-label">Program</span><a href="' + publicSiteHref() + '"><span class="ws-profile-icon">&#8599;</span><span>Public website</span></a></div>' + adminSection + '<div class="ws-profile-section"><button class="ws-logout" type="button"><span class="ws-profile-icon">&#8618;</span><span>Log out</span></button></div></div></div>' +
      '</div></header>';
  }

  function missionNavHtml() {
    var plan = readDailyMission();
    var preview = missionPreviewRequested();
    var progress = plan ? missionProgress(plan) : (preview ? { done: 1, total: 3 } : null);
    var value = !progress ? "Set" : (progress.total > 0 && progress.done === progress.total ? "&#10003;" : progress.done + ' / ' + progress.total);
    var aria = !progress ? "Daily mission: not set" : "Daily mission: " + progress.done + " of " + progress.total + " complete";
    var popover = "";
    if (!plan) {
      popover = '<span class="ws-mission-popover" role="tooltip"><small>Daily mission</small><strong>' + (preview ? "Preview: 1 of 3 complete" : "No mission set yet") + '</strong><p>Choose a realistic plan based on what is next in your course.</p><a href="' + memberHref("index.html") + (preview ? '?mode=admin&preview=welcome' : '?open=planner') + '#todays-mission">Set today\'s mission</a></span>';
    } else {
      var nextTask = plan.tasks.filter(function (task) { return !missionTaskIsDone(task); })[0] || null;
      var rows = plan.tasks.map(function (task) { return '<li class="' + (missionTaskIsDone(task) ? "ws-done" : "") + '"><span aria-hidden="true">' + (missionTaskIsDone(task) ? "&#10003;" : "&#8226;") + '</span>' + escapeHtml(task.title) + '</li>'; }).join("");
      popover = '<span class="ws-mission-popover" role="tooltip"><small>Daily mission</small><strong>' + progress.done + ' of ' + progress.total + ' complete</strong><ul>' + rows + '</ul><span class="ws-mission-popover-actions">' + (progress.done === 0 ? '<a href="' + memberHref("index.html") + '?open=planner&change=mission#todays-mission">Change</a>' : '') + (nextTask ? '<a href="' + escapeHtml(nextTask.href) + '">Continue</a>' : '<b>Mission complete</b>') + '</span></span>';
    }
    return '<span class="ws-mission-nav" tabindex="0" aria-label="' + aria + '"><span>Daily mission:</span><b>' + value + '</b>' + popover + '</span>';
  }

  function phaseDropdownHtml(link, active) {
    var key = link.key;
    var phase = getPhase(key);
    var label = link.label + " - " + phase.title;
    var watchHref = key === "phase1" ? memberHref("phase-1.html") : memberHref(phaseFiles[key]);
    var practiceHref = key === "phase1" ? memberHref("phase-1/practice/index.html") : memberHref(phaseFiles[key]) + "#exercises";
    var lessonText = phase.lessons.length + " lessons";
    var exerciseText = phase.exercises.length + " exercises";
    return '<span class="ws-nav-drop"><a class="ws-link ws-nav-trigger ' + (active === key ? "ws-active" : "") + '" href="' + watchHref + '">' + link.label + '</a><div class="ws-phase-menu" data-label="' + escapeHtml(label) + '"><a href="' + watchHref + '"><span class="ws-media-icon">&#9654;</span><span><strong>Watch the lessons</strong><small>' + lessonText + '</small></span></a><a href="' + practiceHref + '"><span class="ws-media-icon">&#9998;</span><span><strong>Practice the exercises</strong><small>' + exerciseText + '</small></span></a></div></span>';
  }

  function bindNav() {
    qsa(".ws-avatar").forEach(function (button) {
      button.addEventListener("click", function () {
        var menu = button.parentElement.querySelector(".ws-profile-menu");
        var open = menu && menu.hidden;
        qsa(".ws-profile-menu").forEach(function (item) { item.hidden = true; });
        qsa(".ws-avatar").forEach(function (avatar) { avatar.setAttribute("aria-expanded", "false"); });
        if (menu) {
          menu.hidden = !open;
          button.setAttribute("aria-expanded", open ? "true" : "false");
        }
      });
    });
    document.addEventListener("click", function (event) {
      if (event.target.closest(".ws-user")) return;
      if (event.target.closest(".ws-nav-drop")) return;
      qsa(".ws-profile-menu").forEach(function (menu) { menu.hidden = true; });
      qsa(".ws-avatar").forEach(function (button) { button.setAttribute("aria-expanded", "false"); });
    });
    qsa(".ws-logout").forEach(function (button) {
      button.addEventListener("click", async function () {
        button.disabled = true;
        await clearWorkspaceSession();
        window.location.href = memberHref("index.html");
      });
    });
  }

  function isMemberUnlocked() {
    return readBool(SESSION_KEY);
  }

  function needsNameEntry() {
    if (!readBool(SESSION_KEY)) return false;
    var profile = {};
    try { profile = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}"); } catch (e) {}
    var email = profile.email || "";
    if (email === "admin" || email === "testuser") return false;
    return !("firstName" in profile);
  }

  function renderNameEntry() {
    injectStyles();
    document.body.classList.add("ws-page");
    var profile = {};
    try { profile = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}"); } catch (e) {}
    var nameParts = (profile.displayName || "").trim().split(/\s+/);
    var preFirst = escapeHtml(nameParts[0] || "");
    var preLast = escapeHtml(nameParts.slice(1).join(" ") || "");

    document.body.innerHTML =
      '<section class="ws-login-wrap"><article class="ws-login-card">' +
      '<span class="ws-kicker">Welcome</span>' +
      '<h1 class="ws-title">What should we call you?</h1>' +
      '<p class="ws-subtitle">This is how your name will appear in your workspace. You can use your preferred name.</p>' +
      '<form class="ws-form" id="wsNameForm">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
      '<div><label for="wsFirstName">First name</label><input class="ws-input" id="wsFirstName" type="text" autocomplete="given-name" required placeholder="First name" value="' + preFirst + '"></div>' +
      '<div><label for="wsLastName">Last name</label><input class="ws-input" id="wsLastName" type="text" autocomplete="family-name" placeholder="Last name" value="' + preLast + '"></div>' +
      '</div>' +
      '<button class="ws-button" type="submit">Continue to workspace &rarr;</button>' +
      '<p class="ws-message" id="wsNameMessage" aria-live="polite"></p>' +
      '</form>' +
      '<p style="margin-top:12px;text-align:center;"><button type="button" id="wsSkipName" style="background:none;border:none;color:#888;font-size:13px;cursor:pointer;text-decoration:underline;padding:0;">Skip for now</button></p>' +
      '</article></section>';

    var form = qs("#wsNameForm");
    var message = qs("#wsNameMessage");

    async function doSaveName(firstName, lastName) {
      var updated = {};
      try { updated = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}"); } catch (e) {}
      updated.firstName = firstName;
      updated.lastName = lastName;
      localStorage.setItem(PROFILE_KEY, JSON.stringify(updated));
      var email = updated.email || "";
      if (email && email !== "admin" && email !== "testuser") {
        try {
          var firebaseAuth = await import(firebaseHref());
          var nameVal = [firstName, lastName].filter(Boolean).join(" ").trim();
          if (nameVal) {
            await firebaseAuth.updateDoc(
              firebaseAuth.doc(firebaseAuth.db, "authorized_members", email),
              { name: nameVal }
            );
          }
        } catch (e) {
          console.warn("Could not save name to Firestore:", e && e.message);
        }
      }
      renderIndex();
    }

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var firstName = (qs("#wsFirstName").value || "").trim();
      var lastName = (qs("#wsLastName").value || "").trim();
      if (!firstName) { message.textContent = "Please enter your first name."; return; }
      var btn = form.querySelector("button[type='submit']");
      btn.disabled = true;
      btn.textContent = "Saving…";
      message.textContent = "";
      await doSaveName(firstName, lastName);
    });

    var skipBtn = qs("#wsSkipName");
    if (skipBtn) {
      skipBtn.addEventListener("click", function () {
        var updated = {};
        try { updated = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}"); } catch (e) {}
        updated.firstName = "";
        localStorage.setItem(PROFILE_KEY, JSON.stringify(updated));
        renderIndex();
      });
    }
  }

  function requireMember() {
    if (!isMemberUnlocked()) {
      window.location.href = memberHref("index.html");
      return false;
    }
    return true;
  }

  function handleLogin(form, message) {
    var username = qs("#wsUsername", form).value.trim();
    var password = qs("#wsPassword", form).value;

    // Check built-in local accounts (passwords configurable from admin panel)
    var adminPw = localStorage.getItem(LOCAL_PW_ADMIN) || atob("cGFzc3dvcmQxMjM=");
    var testPw = localStorage.getItem(LOCAL_PW_TESTUSER) || atob("bWVtYmVyMjAyNg==");
    var adminUser = atob("YWRtaW4=");
    var testUser = atob("dGVzdHVzZXI=");
    if ((username === adminUser && password === adminPw) || (username === testUser && password === testPw)) {
      writeBool(SESSION_KEY, true);
      localStorage.setItem(USER_KEY, username);
      localStorage.setItem(PROFILE_KEY, JSON.stringify({ email: username, displayName: username, role: username === "admin" ? "admin" : "member" }));
      if (username === "admin") localStorage.setItem(ADMIN_KEY, "true");
      else localStorage.removeItem(ADMIN_KEY);
      window.location.href = "index.html";
      return;
    }

    // Check Firestore for members with a localUsername set
    message.textContent = "Checking credentials…";
    import(firebaseHref()).then(function (fb) {
      return fb.getDocs(fb.query(
        fb.collection(fb.db, "authorized_members"),
        fb.where("localUsername", "==", username)
      ));
    }).then(function (snap) {
      if (snap.empty) {
        message.textContent = "That username or password did not match.";
        return;
      }
      var memberDoc = snap.docs[0];
      var data = memberDoc.data() || {};
      if (!data.localPassword || data.localPassword !== password) {
        message.textContent = "That username or password did not match.";
        return;
      }
      var role = data.role || "member";
      writeBool(SESSION_KEY, true);
      localStorage.setItem(USER_KEY, username);
      localStorage.setItem(PROFILE_KEY, JSON.stringify({
        email: data.email || username,
        displayName: data.name || username,
        role: role
      }));
      if (role === "admin" || role === "owner") localStorage.setItem(ADMIN_KEY, "true");
      else localStorage.removeItem(ADMIN_KEY);
      window.location.href = "index.html";
    }).catch(function () {
      message.textContent = "That username or password did not match.";
    });
  }

  async function handlePasswordReset(message) {
    if (!message) return;
    var email = (qs("#wsUsername") && qs("#wsUsername").value || "").trim().toLowerCase();
    message.classList.remove("ws-success");
    if (!email || email.indexOf("@") === -1) {
      message.textContent = "Enter your email address above, then tap Forgot password again.";
      return;
    }
    message.textContent = "Sending password reset email...";
    try {
      var fb = _preloadedFirebase || await import(firebaseHref());
      _preloadedFirebase = fb;
      await fb.sendMemberPasswordReset(email);
      message.classList.add("ws-success");
      message.textContent = "Password reset email sent. Check your inbox.";
    } catch (error) {
      console.error("Password reset failed.", error);
      message.textContent = "Could not send a reset email. Check the address or use the email-link sign-in option.";
    }
  }

  var _preloadedFirebase = null;

  async function finishGoogleUser(firebaseAuth, user, message) {
    if (!user) throw new Error("Google sign-in did not return a user.");
    var member = await firebaseAuth.requireAuthorizedMember(user);
    // Status and expiry checks — skipped for localhost emulator bypass
    if (member && member.source !== "local-emulator") {
      if (member.status === "inactive") {
        await firebaseAuth.signOut(firebaseAuth.auth);
        throw new Error("Your account is currently inactive. Please contact Wen-Szu.");
      }
      if (member.expiryDate) {
        var expiry = member.expiryDate.toDate ? member.expiryDate.toDate() : new Date(member.expiryDate);
        if (expiry < new Date()) {
          var expiryStr = expiry.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
          await firebaseAuth.signOut(firebaseAuth.auth);
          throw new Error("Your access expired on " + expiryStr + ". Please reach out to renew your access.");
        }
      }
    }
    var email = user && user.email ? String(user.email).trim().toLowerCase() : "";
    writeBool(SESSION_KEY, true);
    localStorage.setItem(USER_KEY, email || "member");
    localStorage.setItem(PROFILE_KEY, JSON.stringify({
      email: email || "member",
      displayName: user && user.displayName ? user.displayName : email,
      photoURL: user && user.photoURL ? user.photoURL : "",
      role: member && member.role ? member.role : "member"
    }));
    await firebaseAuth.saveUserProfile(user, member || {});
    if (member && member.role === "admin") localStorage.setItem(ADMIN_KEY, "true");
    else localStorage.removeItem(ADMIN_KEY);
    sessionStorage.removeItem("utl_google_login_pending");
    localStorage.removeItem("utl_google_login_pending");
    if (message) {
      message.classList.add("ws-success");
      message.textContent = "Signed in. Opening your workspace...";
    }
    window.location.href = "index.html";
  }

  async function finishGoogleCredential(firebaseAuth, credential, message) {
    await finishGoogleUser(firebaseAuth, credential && credential.user, message);
  }

  async function handleGoogleRedirectResult(message) {
    try {
      var firebaseAuth = _preloadedFirebase || await import(firebaseHref());
      _preloadedFirebase = firebaseAuth;
      var credential = await firebaseAuth.getGoogleRedirectResult();
      var user = credential && credential.user ? credential.user : null;
      var isPending = sessionStorage.getItem("utl_google_login_pending") === "true" ||
                      localStorage.getItem("utl_google_login_pending") === "true";
      if (!user && isPending) {
        if (message) {
          message.textContent = "Finishing Google sign-in...";
          message.classList.add("ws-success");
        }
        user = await firebaseAuth.getSignedInUser();
      }
      if (!user) {
        sessionStorage.removeItem("utl_google_login_pending");
        localStorage.removeItem("utl_google_login_pending");
        if (isPending && message) {
          message.classList.remove("ws-success");
          message.textContent = "Google sign-in did not complete. Try the email link option below instead.";
        }
        return;
      }
      if (message) {
        message.textContent = "Finishing Google sign-in...";
        message.classList.remove("ws-success");
      }
      await finishGoogleUser(firebaseAuth, user, message);
    } catch (error) {
      sessionStorage.removeItem("utl_google_login_pending");
      localStorage.removeItem("utl_google_login_pending");
      console.error("Google redirect login failed.", error);
      if (message) message.textContent = error && error.message ? error.message : "Google sign-in did not work.";
    }
  }

  async function handleEmailLinkSignIn() {
    try {
      var firebaseAuth = await import(firebaseHref());
      if (!firebaseAuth.isSignInWithEmailLink(firebaseAuth.auth, window.location.href)) return;

      var card = document.querySelector(".ws-login-card");
      if (!card) return;
      card.innerHTML = '<span class="ws-kicker">Magic link sign-in</span><h1 class="ws-title">One more step.</h1><p class="ws-subtitle">Enter the email address this link was sent to.</p><form class="ws-form" id="wsEmailLinkForm"><label for="wsEmailConfirm">Your email address</label><input class="ws-input" id="wsEmailConfirm" type="email" autocomplete="email" placeholder="you@example.com" required><button class="ws-button" type="submit">Sign in</button><p class="ws-message" id="wsEmailLinkMessage" aria-live="polite"></p></form>';

      qs("#wsEmailLinkForm").addEventListener("submit", async function (event) {
        event.preventDefault();
        var emailInput = qs("#wsEmailConfirm");
        var linkMessage = qs("#wsEmailLinkMessage");
        var submitBtn = event.currentTarget.querySelector("button[type=submit]");
        var email = emailInput.value.trim();
        if (!email) {
          linkMessage.textContent = "Please enter your email address.";
          return;
        }
        submitBtn.disabled = true;
        submitBtn.textContent = "Signing in...";
        linkMessage.textContent = "";
        linkMessage.classList.remove("ws-success");
        try {
          var credential = await firebaseAuth.signInWithEmailLink(firebaseAuth.auth, email, window.location.href);
          await finishGoogleUser(firebaseAuth, credential.user, linkMessage);
        } catch (err) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Sign in";
          var errMsg = "Sign-in failed. ";
          if (err.code === "auth/invalid-action-code") {
            errMsg = "This link has expired or already been used. Please ask for a new one.";
          } else if (err.code === "auth/invalid-email") {
            errMsg = "That email does not match the one this link was sent to. Please check and try again.";
          } else {
            errMsg += err.message || "Please try again.";
          }
          linkMessage.textContent = errMsg;
        }
      });
    } catch (err) {
      console.error("Email link sign-in check failed.", err);
    }
  }

  async function handleGoogleLogin(button, message) {
    if (!button || !message) return;
    var originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Connecting to Google...";
    message.textContent = "";
    message.classList.remove("ws-success");
    try {
      // Use preloaded module so there is no network await between the tap and window.open()
      var firebaseAuth = _preloadedFirebase || await import(firebaseHref());
      _preloadedFirebase = firebaseAuth;
      var credential = await firebaseAuth.signInWithGooglePopup();
      await finishGoogleCredential(firebaseAuth, credential, message);
    } catch (error) {
      console.error("Google member login failed.", error);
      if (error && (error.code === "auth/popup-blocked" || error.code === "auth/popup-closed-by-user")) {
        try {
          var redirectAuth = _preloadedFirebase || await import(firebaseHref());
          message.classList.add("ws-success");
          message.textContent = "Opening Google sign-in...";
          sessionStorage.setItem("utl_google_login_pending", "true");
          localStorage.setItem("utl_google_login_pending", "true");
          await redirectAuth.signInWithGoogleRedirect();
          return;
        } catch (redirectError) {
          console.error("Google redirect fallback failed.", redirectError);
          error = redirectError;
        }
      }
      message.textContent = error && error.message ? error.message : "Google sign-in did not work.";
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  function renderIndex() {
    injectStyles();
    document.body.classList.add("ws-page");
    if (!isMemberUnlocked()) {
      document.body.innerHTML = '<section class="ws-login-wrap"><article class="ws-login-card"><span class="ws-kicker">Member login</span><h1 class="ws-title">Welcome back.</h1><p class="ws-subtitle">Sign in to open your Untaught Lessons workspace.</p><form class="ws-form" id="wsLoginForm"><label for="wsUsername">Username or email</label><input class="ws-input" id="wsUsername" autocomplete="username" required><label for="wsPassword">Password</label><input class="ws-input" id="wsPassword" type="password" autocomplete="current-password" required><button class="ws-button" type="submit">Sign in</button><button type="button" id="wsForgotPassword" style="width:max-content;background:none;border:0;color:var(--ws-steel);font-weight:700;text-decoration:underline;text-underline-offset:3px;cursor:pointer;padding:0">Forgot password?</button><p class="ws-message" id="wsLoginMessage" aria-live="polite"></p></form><div class="ws-login-divider">or</div><button class="ws-button ws-google-button" id="wsGoogleLogin" type="button"><span class="ws-google-mark" aria-hidden="true"></span><span>Sign in with Google</span></button><div class="ws-login-divider">or</div><div id="wsEmailSignInSection"><button class="ws-button ws-button-secondary" id="wsShowEmailSignIn" type="button" style="width:100%">Sign in with email link</button></div></article></section>';
      qs("#wsLoginForm").addEventListener("submit", function (event) {
        event.preventDefault();
        handleLogin(event.currentTarget, qs("#wsLoginMessage"));
      });
      qs("#wsGoogleLogin").addEventListener("click", function (event) {
        event.preventDefault();
        handleGoogleLogin(event.currentTarget, qs("#wsLoginMessage"));
      });
      qs("#wsForgotPassword").addEventListener("click", function () {
        handlePasswordReset(qs("#wsLoginMessage"));
      });
      qs("#wsShowEmailSignIn").addEventListener("click", function () {
        var section = qs("#wsEmailSignInSection");
        if (!section) return;
        section.innerHTML = '<form class="ws-form" id="wsEmailLinkForm" style="margin-top:0"><label for="wsEmailLinkAddr">Your email address</label><input class="ws-input" id="wsEmailLinkAddr" type="email" autocomplete="email" placeholder="you@example.com" required><button class="ws-button" type="submit" style="width:100%">Send sign-in link</button><p class="ws-message" id="wsEmailLinkMsg" aria-live="polite"></p></form>';
        qs("#wsEmailLinkForm").addEventListener("submit", async function (event) {
          event.preventDefault();
          var email = qs("#wsEmailLinkAddr").value.trim().toLowerCase();
          var msg = qs("#wsEmailLinkMsg");
          var btn = event.currentTarget.querySelector("button[type=submit]");
          if (!email) return;
          btn.disabled = true;
          btn.textContent = "Sending...";
          msg.textContent = "";
          msg.classList.remove("ws-success");
          try {
            var fb = _preloadedFirebase || await import(firebaseHref());
            _preloadedFirebase = fb;
            var member = await fb.getAuthorizedMember(email);
            if (!member) {
              msg.textContent = "That email is not in our member list. Check your spelling or contact Wen-Szu.";
              btn.disabled = false;
              btn.textContent = "Send sign-in link";
              return;
            }
            await fb.sendSignInInvite(email);
            msg.classList.add("ws-success");
            msg.textContent = "Link sent. Check your email and tap the sign-in link — it opens the workspace.";
            btn.textContent = "Sent";
          } catch (err) {
            console.error("Email sign-in link failed.", err);
            msg.textContent = "Could not send sign-in link. Please try again.";
            btn.disabled = false;
            btn.textContent = "Send sign-in link";
          }
        });
        qs("#wsEmailLinkAddr").focus();
      });
      // Preload firebase eagerly so signInWithGooglePopup() opens with minimal async delay
      if (!_preloadedFirebase) {
        import(firebaseHref()).then(function(m) { _preloadedFirebase = m; }).catch(function(){});
      }
      handleGoogleRedirectResult(qs("#wsLoginMessage"));
      handleEmailLinkSignIn();
      return;
    }
    if (needsNameEntry()) {
      renderNameEntry();
      return;
    }
    if (!remoteProgressLoaded) {
      ensureRemoteProgressLoaded(renderIndex);
      return;
    }
    pageShell("home", homePageHtml());
    bindHomePage();
    applyNudges();
    applyAssessmentVisibility();
  }

  function homePageHtml() {
    var progress = exerciseProgress();
    var orientationDone = readBool("utl_orientation_ready");
    var orientationPrompt = orientationDone ? "" : '<div class="ws-orientation-prompt"><span style="font-size:18px;flex-shrink:0">&#9888;</span><span>Complete orientation before starting Phase 1 — it sets up the storyline and context for all exercises. <a href="#orientation">Open orientation &uarr;</a></span></div>';
    var allDone = phases.every(function (pk) { return exercisesDone(pk); });
    var certSection = allDone ? '<section class="ws-section"><div class="ws-section-head"><h2>Your certificate</h2></div><article class="ws-phase-card"><div class="ws-phase-stripe" style="background:#2C7A4B"></div><div class="ws-phase-number" style="color:rgba(44,122,75,.15)">&#10003;</div><div class="ws-phase-content"><span class="ws-kicker">Complete</span><h2>Certificate of completion</h2><p>You have finished the full program. Download or share your certificate.</p></div><div class="ws-phase-actions"><span class="ws-pill ws-pill-green">Done</span><a class="ws-button" href="../certificate/index.html">View certificate &rarr;</a></div></article></section>' : "";
    var paceDay = Math.max(1, Math.ceil(progress.done / 3));
    var paceCopy = progress.done === 0 ? "Start with orientation, then choose your first daily mission." : "You have reached the program’s Day " + paceDay + " milestone at a pace of three activities per learning day.";
    return '<div class="ws-home-stack">' + dailyWelcomePopupHtml(progress) + learningJourneyCardHtml(progress, orientationDone) + orientationCardHtml() + orientationPrompt + '<section id="learning-journey"><div class="ws-section-head"><h2>Your learning journey</h2><span class="ws-count">' + progress.done + ' of ' + progress.total + ' complete</span></div><section class="ws-progress-card"><div class="ws-progress-row"><span>Overall progress</span><span>' + progress.percent + '%</span></div><div class="ws-progress-track"><div class="ws-progress-fill" style="width:' + progress.percent + '%"></div></div><p class="ws-pace-note">' + escapeHtml(paceCopy) + '</p></section><section class="ws-phase-list">' + phases.map(phaseJourneyCard).join("") + '</section></section>' + certSection + assessmentsSection() + '</div>';
  }

  function missionDayKey() {
    var now = new Date();
    return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
  }

  function readDailyMission() {
    try {
      var plan = JSON.parse(localStorage.getItem("utl_daily_mission_plan") || "null");
      return plan && plan.date === missionDayKey() ? plan : null;
    } catch (error) { return null; }
  }

  function missionTaskIsDone(task) {
    if (!task) return false;
    if (task.manual) return Boolean(task.complete);
    if (task.type === "Video") return readBool(watchedKey(task.id));
    if (Array.isArray(task.doneKeys) && task.doneKeys.some(function (key) { return readBool(key); })) return true;
    var exercise = null;
    phases.some(function (phaseKey) {
      exercise = getPhase(phaseKey).exercises.filter(function (item) { return item.id === task.id; })[0] || null;
      return Boolean(exercise);
    });
    return exercise ? exerciseDone(exercise) : false;
  }

  function missionProgress(plan) {
    var tasks = plan && Array.isArray(plan.tasks) ? plan.tasks : [];
    var done = tasks.filter(missionTaskIsDone).length;
    return { done: done, total: tasks.length };
  }

  function checkMissionProgressMoment() {
    var plan = readDailyMission();
    if (!plan) return;
    var progress = missionProgress(plan);
    var previous = Number(plan.lastSeenDone || 0);
    if (progress.done <= previous) return;
    plan.lastSeenDone = progress.done;
    localStorage.setItem("utl_daily_mission_plan", JSON.stringify(plan));
    setTimeout(function () {
      showWorkspaceRewardMoment({
        label: progress.done === progress.total ? "Mission complete" : "Activity complete",
        title: progress.done === progress.total ? "You completed today\'s mission" : progress.done + " of " + progress.total + " complete",
        body: progress.done === progress.total ? "You accomplished what you committed to today." : "Nice work. Continue when you are ready for the next activity."
      });
    }, 250);
  }

  function dailyWelcomePopupHtml(progress) {
    var card = dailyWelcomeCardHtml(progress);
    if (!card) return "";
    var openRequested = new URLSearchParams(window.location.search || "").get("open") === "planner";
    return '<div class="ws-mission-overlay ' + (!openRequested && !missionPreviewRequested() ? "ws-hidden" : "") + '" id="todays-mission" data-mission-overlay><div class="ws-mission-dialog" role="dialog" aria-modal="true" aria-labelledby="ws-mission-title"><button class="ws-mission-close" type="button" data-mission-close aria-label="Close Today\'s Mission">&times;</button>' + card + '</div></div>';
  }

  function durationSecondsFromLabel(label) {
    var value = String(label || "");
    var minutes = Number((value.match(/(\d+)\s*min/) || [0, 0])[1]);
    var seconds = Number((value.match(/(\d+)\s*sec/) || [0, 0])[1]);
    return (minutes * 60) + seconds;
  }

  function missionPreviewRequested() {
    var params = new URLSearchParams(window.location.search || "");
    return adminPreviewMode() && params.get("preview") === "welcome";
  }

  function missionTaskPool() {
    var tasks = [];
    phases.forEach(function (phaseKey) {
      if (!phaseUnlocked(phaseKey)) return;
      orderedLessons(phaseKey).forEach(function (lesson) {
        if (readBool(watchedKey(lesson.id))) return;
        var seconds = durationSecondsFromLabel(lesson.duration);
        tasks.push({ id: lesson.id, type: "Video", title: lesson.title, minutes: Math.max(1, Math.ceil(seconds / 60)), durationLabel: lesson.duration, href: phaseFiles[phaseKey] + "#lessons", phaseKey: phaseKey, mp: VIDEO_COMPLETE_MP });
      });
      getPhase(phaseKey).exercises.forEach(function (exercise) {
        if (exerciseDone(exercise)) return;
        tasks.push({ id: exercise.id, type: "Exercise", title: exercise.title, minutes: Math.max(1, Number(exercise.estimatedMinutes || 0)), durationLabel: "About " + Number(exercise.estimatedMinutes || 0) + " min", href: exercise.appUrl, phaseKey: phaseKey, mp: 0, doneKeys: [doneKey(exercise.id), exercise.legacyDoneKey].filter(Boolean) });
      });
    });
    if (!tasks.length && missionPreviewRequested()) {
      var previewPhase = getPhase("phase1");
      tasks = orderedLessons("phase1").slice(0, 2).map(function (lesson) {
        var seconds = durationSecondsFromLabel(lesson.duration);
        return { id: lesson.id, type: "Video", title: lesson.title, minutes: Math.ceil(seconds / 60), durationLabel: lesson.duration, href: phaseFiles.phase1 + "#lessons", phaseKey: "phase1", mp: VIDEO_COMPLETE_MP };
      });
      tasks.push({ id: previewPhase.exercises[0].id, type: "Exercise", title: previewPhase.exercises[0].title, minutes: previewPhase.exercises[0].estimatedMinutes, durationLabel: "About " + previewPhase.exercises[0].estimatedMinutes + " min", href: previewPhase.exercises[0].appUrl, phaseKey: "phase1", mp: 0 });
    }
    return tasks;
  }

  function missionOption(tasks, target, label, descriptor) {
    var selected = [];
    var total = 0;
    tasks.some(function (task) {
      if (selected.length && total + task.minutes > target) return true;
      selected.push(task);
      total += task.minutes;
      return false;
    });
    if (!selected.length && tasks[0]) { selected.push(tasks[0]); total = tasks[0].minutes; }
    return { target: target, label: label, descriptor: descriptor, tasks: selected, minutes: total };
  }

  function uniqueMissionOptions(tasks) {
    var seen = {};
    return [missionOption(tasks, 15, "About 15 minutes", "Quick start"), missionOption(tasks, 30, "About 30 minutes", "Focused session"), missionOption(tasks, 45, "About 45 minutes", "Deep dive")].filter(function (option) {
      var signature = option.tasks.map(function (task) { return task.id; }).join("|");
      if (seen[signature]) return false;
      seen[signature] = true;
      return true;
    });
  }

  function missionOptionHtml(option, index, selectedTarget) {
    var checked = Number(selectedTarget) === option.target;
    var rows = option.tasks.map(function (task) {
      return '<li><span class="ws-mission-task-icon" aria-hidden="true">' + (task.type === "Video" ? "&#9654;" : "&#9633;") + '</span><span><strong>' + escapeHtml(task.title) + '</strong><small>' + escapeHtml(task.type) + ' &middot; ' + escapeHtml(task.durationLabel) + '</small></span></li>';
    }).join("");
    return '<label class="ws-mission-option ' + (checked ? "ws-selected" : "") + '"><input type="radio" name="wsMissionPlan" value="' + option.target + '" ' + (checked ? "checked" : "") + '><span class="ws-mission-radio" aria-hidden="true"></span><span class="ws-mission-option-head"><span><small>' + escapeHtml(option.descriptor) + '</small><strong>About ' + option.minutes + ' minutes</strong></span><b>~' + option.minutes + ' min</b></span><ol>' + rows + '</ol></label>';
  }

  function challengeFlowCardHtml(task, firstName) {
    var preparing = task.stage === "prepare";
    var choices = preparing ? task.preChoices : task.postChoices;
    var prompt = preparing ? task.prePrompt : task.postPrompt;
    var savedIntention = task.intention ? '<p class="ws-challenge-intention">You planned to: <strong>' + escapeHtml(task.intention) + '</strong></p>' : "";
    return '<article class="ws-mission-card"><div class="ws-mission-rail"></div><div class="ws-mission-inner"><span class="ws-kicker">Optional challenge</span><h1 id="ws-mission-title">' + (preparing ? "Set your intention, " + escapeHtml(firstName) + "." : "How did the challenge go?") + '</h1><p class="ws-mission-recognition">' + (preparing ? "A quick commitment makes it easier to follow through." : "Reflect briefly before completing today’s mission.") + '</p>' + savedIntention + '<form class="ws-challenge-form" data-challenge-' + (preparing ? "prepare" : "reflect") + '><fieldset><legend>' + escapeHtml(prompt) + '</legend>' + choices.map(function (choice, index) { return '<label><input type="radio" name="challengeChoice" value="' + escapeHtml(choice) + '" ' + (index === 0 ? "required" : "") + '><span>' + escapeHtml(choice) + '</span></label>'; }).join("") + '</fieldset><label class="ws-challenge-note"><span>' + (preparing ? "What specifically will you do differently? (optional)" : "What changed in your response? (optional)") + '</span><textarea name="challengeNote" rows="3"></textarea></label><div class="ws-mission-action"><button class="ws-button ws-button-secondary" type="button" ' + (preparing ? "data-challenge-back" : "data-mission-close") + '>' + (preparing ? "Back" : "Finish later") + '</button><button class="ws-button" type="submit">' + (preparing ? "Commit and reopen exercise →" : "Complete challenge") + '</button></div></form></div></article>';
  }

  function dailyWelcomeCardHtml(progress) {
    if (localStorage.getItem("utl_daily_welcome_card") === "hide" && !missionPreviewRequested()) return "";
    var tasks = missionTaskPool();
    var user = currentUser();
    var firstName = String(user.label || "there").split(/[\s@]/)[0] || "there";
    var reward = readRewardState();
    var streakSummary = reward.streakDays > 0 ? ' &middot; ' + reward.streakDays + '-day streak' : '';
    var activePlan = readDailyMission();
    var changingMission = new URLSearchParams(window.location.search || "").get("change") === "mission";
    if (activePlan && !missionPreviewRequested() && !changingMission) {
      var activeProgress = missionProgress(activePlan);
      var nextTask = activePlan.tasks.filter(function (task) { return !missionTaskIsDone(task); })[0] || null;
      if (nextTask && nextTask.manual && (nextTask.stage === "prepare" || nextTask.stage === "active")) return challengeFlowCardHtml(nextTask, firstName);
      var planRows = activePlan.tasks.map(function (task, index) {
        var done = missionTaskIsDone(task);
        return '<li class="' + (done ? "ws-done" : "") + '"><span aria-hidden="true">' + (done ? "&#10003;" : (index + 1)) + '</span><span><strong>' + escapeHtml(task.title) + '</strong><small>' + escapeHtml(task.type) + ' &middot; About ' + Number(task.minutes || 0) + ' min</small></span>' + (task.manual && !done ? '<button type="button" data-mission-start-challenge>Start challenge</button>' : '') + '</li>';
      }).join("");
      return '<article class="ws-mission-card"><div class="ws-mission-rail"></div><div class="ws-mission-inner">' + (missionPreviewRequested() ? '<div class="ws-mission-preview">Admin preview &middot; changes stay in this browser</div>' : '') + '<header class="ws-mission-header"><div><span class="ws-kicker">Today\'s mission</span><h1 id="ws-mission-title">' + (activeProgress.done === activeProgress.total ? "Mission complete." : "Keep going, " + escapeHtml(firstName) + ".") + '</h1><p class="ws-mission-recognition">' + activeProgress.done + ' of ' + activeProgress.total + ' activities complete</p></div></header><ol class="ws-mission-checklist">' + planRows + '</ol><div class="ws-mission-action"><span><small>Today\'s progress</small><strong>' + (activeProgress.done === activeProgress.total ? "You accomplished what you set out to do." : (activeProgress.total - activeProgress.done) + " activities remaining") + '</strong></span><div class="ws-mission-action-buttons">' + (activeProgress.done === 0 ? '<button class="ws-button ws-button-secondary" type="button" data-mission-change>Change mission</button>' : '') + (nextTask ? (nextTask.manual ? '<button class="ws-button" type="button" data-mission-start-challenge>Start challenge &rarr;</button>' : '<a class="ws-button" href="' + escapeHtml(nextTask.href) + '">Continue mission &rarr;</a>') : '<button class="ws-button" type="button" data-mission-close>Done</button>') + '</div></div></div></article>';
    }
    if (!tasks.length) {
      return '<article class="ws-mission-card"><div class="ws-mission-rail"></div><div class="ws-mission-inner"><span class="ws-kicker">Today\'s mission</span><h1>Welcome back, ' + escapeHtml(firstName) + '.</h1><p class="ws-mission-recognition">' + reward.mpTotal + ' MP &middot; ' + escapeHtml(reward.level) + streakSummary + ' &middot; ' + progress.done + ' activities complete</p><div class="ws-mission-complete"><strong>Your core program work is complete.</strong><span>Use your results and toolkit to keep applying what you learned.</span></div></div></article>';
    }
    var storedTarget = Number(localStorage.getItem("utl_daily_mission_target") || 30);
    var options = uniqueMissionOptions(tasks);
    if (!options.some(function (option) { return option.target === storedTarget; })) storedTarget = (options[1] || options[0]).target;
    var selected = options.filter(function (option) { return option.target === storedTarget; })[0] || options[0];
    var nextPhase = phaseLabels[tasks[0].phaseKey] + " · " + getPhase(tasks[0].phaseKey).title;
    var completedExercise = null;
    phases.forEach(function (phaseKey) { getPhase(phaseKey).exercises.forEach(function (exercise) { if (exerciseDone(exercise)) completedExercise = exercise; }); });
    var challenge = completedExercise
      ? 'Revisit <strong>' + escapeHtml(completedExercise.title) + '</strong> and improve or tighten your response.'
      : 'After your plan, write down one way you can apply today\'s idea at work.';
    return '<article class="ws-mission-card"><div class="ws-mission-rail"></div><div class="ws-mission-inner">' + (missionPreviewRequested() ? '<div class="ws-mission-preview">Admin preview &middot; changes stay in this browser</div>' : '') + '<header class="ws-mission-header"><div><span class="ws-kicker">Today\'s mission</span><h1 id="ws-mission-title">Welcome back, ' + escapeHtml(firstName) + '.</h1><p class="ws-mission-recognition">' + reward.mpTotal + ' MP &middot; ' + escapeHtml(reward.level) + streakSummary + ' &middot; ' + progress.done + ' activities complete</p></div></header><div class="ws-mission-prompt"><strong>How much would you like to accomplish today?</strong><span>Next up: ' + escapeHtml(nextPhase) + '. Choose a plan based on the work ahead.</span></div><fieldset class="ws-mission-options"><legend class="ws-hidden">Choose today\'s mission length</legend>' + options.map(function (option, index) { return missionOptionHtml(option, index, storedTarget); }).join("") + '</fieldset><div class="ws-mission-action" aria-live="polite"><span><small>Your plan</small><strong data-mission-summary>About ' + selected.minutes + ' minutes &middot; ' + selected.tasks.length + ' activit' + (selected.tasks.length === 1 ? 'y' : 'ies') + '</strong></span><a class="ws-button" data-mission-start href="' + escapeHtml(selected.tasks[0].href) + '">Start today\'s mission &rarr;</a></div><label class="ws-mission-bonus"><input type="checkbox" data-mission-challenge data-challenge-title="' + escapeHtml(completedExercise ? "Revisit " + completedExercise.title : "Apply today\'s idea at work") + '" data-challenge-href="' + escapeHtml(completedExercise ? completedExercise.appUrl : memberHref("index.html")) + '"><span><small>Optional challenge</small><span>' + challenge + '</span></span><b>+10 min</b></label></div></article>';
  }

  function learningJourneyCardHtml(progress, orientationDone) {
    var seen = readBool("utl_learning_journey_seen");
    var open = localStorage.getItem("utl_learning_journey_open") === null ? (!seen && !orientationDone) : readBool("utl_learning_journey_open");
    var readiness = orientationDone
      ? "You have completed orientation. Use the phase cards below to continue."
      : "Ready to begin? Move to the Orientation section next.";
    return '<article class="ws-journey-card ' + (open ? "ws-open" : "") + '" id="program-journey"><button class="ws-journey-head" type="button" data-journey-toggle><span><span class="ws-kicker">Start here</span><h1 class="ws-journey-title">Think, speak, and act like an executive.</h1><p class="ws-journey-sub">This program builds the habits behind executive judgment: clear thinking, concise communication, and confident action when the answer is not obvious.</p><p class="ws-level-explainer">Complete lessons and exercises to earn MP. Your MP moves you through five levels: Intern, Analyst, Associate, Principal, and Executive.</p></span><span class="ws-disclosure-icon ws-journey-chevron">' + (open ? "&minus;" : "+") + '</span></button><div class="ws-journey-body"><div class="ws-journey-map"><article class="ws-journey-step"><span class="ws-journey-step-num">1</span><strong>Orientation</strong><span>Start here so the MA storyline and your role are clear.</span></article><article class="ws-journey-step"><span class="ws-journey-step-num">2</span><strong>Lessons</strong><span>Watch the lessons before using each framework in practice.</span></article><article class="ws-journey-step"><span class="ws-journey-step-num">3</span><strong>Practice</strong><span>Use the exercises to turn messy situations into executive-ready work.</span></article><article class="ws-journey-step"><span class="ws-journey-step-num">4</span><strong>Progress</strong><span>Track completion and move phase by phase as your judgment sharpens.</span></article></div><div class="ws-journey-actions"><p class="ws-journey-ready">' + readiness + '<small>' + progress.done + ' of ' + progress.total + ' exercises complete</small></p><a class="ws-journey-cue" href="' + (orientationDone ? "#learning-journey" : "#orientation") + '" data-journey-link>' + (orientationDone ? "View phases" : "Orientation is below") + '<span>&darr;</span></a></div></div></article>';
  }

  function orientationCardHtml() {
    var complete = readBool("utl_orientation_ready");
    var open = localStorage.getItem("utl_orientation_open") === null ? !complete : readBool("utl_orientation_open");
    var intro = UTL_CONTENT.orientation.contexts[0] || {};
    var orientation = UTL_CONTENT.orientation.contexts[1] || {};
    var orientationUrl = orientation.contextUrl || exerciseContextUrl(orientation);
    var welcomeOpen = localStorage.getItem("utl_welcome_video_open") === null ? true : readBool("utl_welcome_video_open");
    var video = orientationUrl ? '<div class="ws-context-embed">' + renderEmbeddedMedia(orientationUrl, orientation.contextTitle) + '</div>' : '<div class="ws-player-card"><div class="ws-player"><div class="ws-player-placeholder"><span class="ws-play-icon">&#9654;</span><p>Orientation video coming soon</p></div></div></div>';
    return '<article class="ws-orientation-card ' + (open ? "ws-open" : "") + '" id="orientation"><button class="ws-orientation-head" type="button" data-orientation-toggle><span class="ws-start-badge">Start here</span><span><span class="ws-orientation-title">Orientation</span><span class="ws-orientation-sub">' + (complete ? "Orientation complete &#10003;" : "Get oriented before jumping into Phase 1") + '</span></span><span class="ws-orientation-chevron ws-disclosure-icon">' + (open ? "&minus;" : "+") + '</span></button><div class="ws-orientation-body"><div class="ws-orientation-copy"><h3>' + escapeHtml(intro.contextTitle || "Welcome") + '</h3>' + textParagraphs(intro.contextBody) + '</div><div class="ws-how-row"><button class="ws-how-toggle" type="button" data-welcome-toggle><span class="ws-media-icon">&#9654;</span><span><strong>' + escapeHtml(orientation.contextTitle || "Welcome to The Untaught Lessons") + '</strong><br><small>' + escapeHtml(orientation.contextBody || "Watch before starting") + '</small></span><span class="ws-disclosure-icon" data-welcome-icon>' + (welcomeOpen ? "&minus;" : "+") + '</span></button><div class="ws-how-body ' + (welcomeOpen ? "ws-open" : "") + '" data-welcome-body>' + video + '</div></div><div class="ws-player-actions" data-orientation-action>' + orientationWatchActionHtml(complete) + '</div></div></article>';
  }

  function orientationWatchActionHtml(watched) {
    return watched
      ? '<div class="ws-player-action-text"><strong>Orientation marked complete.</strong><span>You can mark it not watched if this was a mistake. MP already earned is kept.</span></div><button class="ws-button ws-button-secondary" type="button" data-orientation-watch>Mark not watched</button>'
      : '<div class="ws-player-action-text"><strong>Finished watching?</strong><span>Mark the orientation complete to save progress and earn ' + VIDEO_COMPLETE_MP + ' MP once.</span></div><button class="ws-button" type="button" data-orientation-watch>Mark orientation complete</button>';
  }

  function phaseJourneyCard(phaseKey) {
    var number = phaseNumbers[phaseKey];
    var phase = getPhase(phaseKey);
    var unlocked = phaseUnlocked(phaseKey);
    var status = phaseStatus(phaseKey);
    var pillClass = status === "Locked" ? "ws-pill-locked" : status === "In progress" ? "ws-pill-progress" : "ws-pill-muted";
    var href = phaseKey === "phase1" ? phaseFiles.phase1 : phaseFiles[phaseKey];
    var lockNote = "";
    if (!unlocked) {
      var prereqKey = phaseKey === "phase2" ? "phase1" : "phase2";
      var prereqPhase = getPhase(prereqKey);
      var remaining = prereqPhase.exercises.filter(function (ex) { return !exerciseDone(ex); }).length;
      var releaseHidden = (phaseKey === "phase2" && localStorage.getItem("utl_phase2_status") === "hide") || (phaseKey === "phase3" && localStorage.getItem("utl_phase3_status") === "hide");
      lockNote = releaseHidden && remaining === 0
        ? '<span class="ws-lock-note">' + phaseLabels[phaseKey] + ' is not released yet</span>'
        : '<span class="ws-lock-note">' + remaining + ' exercise' + (remaining !== 1 ? 's' : '') + ' left in ' + phaseLabels[prereqKey] + ' to unlock</span>';
    }
    return '<article class="ws-phase-card ' + (unlocked ? "" : "ws-locked") + '"><div class="ws-phase-stripe"></div><div class="ws-phase-number">0' + number + '</div><div class="ws-phase-content"><span class="ws-kicker">' + phaseLabels[phaseKey] + '</span><h2>' + escapeHtml(phase.title) + '</h2><p>' + escapeHtml(phaseDescriptions[phaseKey]) + '</p><div class="ws-trail"><span class="ws-dot ' + phaseStepState(phaseKey, "watch") + '"></span>Watch<span class="ws-arrow">&rarr;</span><span class="ws-dot ' + phaseStepState(phaseKey, "practice") + '"></span>Practice</div></div><div class="ws-phase-actions"><span class="ws-pill ' + pillClass + '">' + status + '</span>' + (unlocked ? '<a class="ws-button" href="' + href + '">Continue &rarr;</a>' : '<span class="ws-button ws-disabled">Continue &rarr;</span>') + lockNote + '</div></article>';
  }

  function assessmentsSection() {
    if (localStorage.getItem("utl_tsa_status") === "hidden") return "";
    var phase3Done = exercisesDone("phase3");
    var checkpointCard = phase3Done ? '<article class="ws-phase-card"><div class="ws-phase-stripe"></div><div class="ws-phase-number">B</div><div class="ws-phase-content"><span class="ws-kicker">Assessment</span><h2>The checkpoint</h2><p>Take the post-program checkpoint after finishing all three phases to see how far you have come.</p></div><div class="ws-phase-actions"><a class="ws-button" href="../apps/tsa-checkpoint/index.html">Open &rarr;</a></div></article>' : '<article class="ws-phase-card ws-locked"><div class="ws-phase-stripe"></div><div class="ws-phase-number">B</div><div class="ws-phase-content"><span class="ws-kicker">Assessment</span><h2>The checkpoint</h2><p>Complete all three phases to unlock this post-program assessment.</p></div><div class="ws-phase-actions"><span class="ws-pill ws-pill-locked">Locked</span><span class="ws-button ws-disabled">Open &rarr;</span></div></article>';
    return '<section class="ws-section" id="assessments"><div class="ws-section-head"><h2>Assessments</h2><span class="ws-count">Find your level</span></div><div class="ws-phase-list"><article class="ws-phase-card"><div class="ws-phase-stripe"></div><div class="ws-phase-number">A</div><div class="ws-phase-content"><span class="ws-kicker">Assessment</span><h2>The diagnostic</h2><p>Take the starting assessment when you are ready.</p></div><div class="ws-phase-actions"><a class="ws-button" href="../apps/tsa-diagnostic/index.html">Open &rarr;</a></div></article>' + checkpointCard + '</div></section>';
  }

  // ===== In-app nudges =====

  var NUDGE_LAST_VISIT_KEY = "utl_nudge_last_visit";
  var NUDGE_PHASE_SEEN_PREFIX = "utl_nudge_phase_seen_";

  function nudgeContinueTarget() {
    var target = null;
    phases.forEach(function (phaseKey) {
      if (target || !phaseUnlocked(phaseKey)) return;
      getPhase(phaseKey).exercises.forEach(function (ex) {
        if (!target && !exerciseDone(ex)) target = { ex: ex, phaseKey: phaseKey };
      });
    });
    return target;
  }

  function nudgeNewlyCompletePhases() {
    var result = [];
    phases.forEach(function (phaseKey) {
      var num = phaseNumbers[phaseKey];
      var seenKey = NUDGE_PHASE_SEEN_PREFIX + num;
      if (exercisesDone(phaseKey) && localStorage.getItem(seenKey) !== "true") {
        result.push(phaseKey);
      }
    });
    return result;
  }

  function insertContinueCard(stack, target) {
    if (qs("#ws-nudge-continue")) return;
    var phaseLabel = phaseLabels[target.phaseKey] || "";
    var href = appHref(target.ex.appUrl);
    var card = document.createElement("div");
    card.id = "ws-nudge-continue";
    card.className = "ws-nudge-continue";
    card.innerHTML =
      '<div class="ws-nudge-continue-text">' +
        '<span class="ws-nudge-continue-label">Continue where you left off</span>' +
        '<p class="ws-nudge-continue-title">' + escapeHtml(target.ex.title) + '</p>' +
        '<p class="ws-nudge-continue-sub">' + escapeHtml(phaseLabel) + ' &middot; ' + escapeHtml(target.ex.type || "") + '</p>' +
      '</div>' +
      '<a class="ws-button" href="' + escapeHtml(href) + '">Open &rarr;</a>';
    var journey = qs("#program-journey");
    if (journey && journey.parentNode === stack) {
      stack.insertBefore(card, journey.nextSibling || null);
    } else {
      stack.insertBefore(card, stack.firstChild);
    }
  }

  function insertDaysSinceBanner(stack, days) {
    if (qs("#ws-nudge-days")) return;
    var banner = document.createElement("div");
    banner.id = "ws-nudge-days";
    banner.className = "ws-nudge-days";
    banner.innerHTML =
      '<span class="ws-nudge-days-icon">&#128336;</span>' +
      '<span>You were last here <strong>' + days + ' day' + (days !== 1 ? 's' : '') + ' ago</strong> &mdash; good to have you back.</span>';
    var firstChild = stack.firstChild;
    if (firstChild) {
      stack.insertBefore(banner, firstChild.nextSibling || null);
    } else {
      stack.appendChild(banner);
    }
  }

  function applyAlmostThere(threshold) {
    phases.forEach(function (phaseKey) {
      if (!phaseUnlocked(phaseKey)) return;
      var phase = getPhase(phaseKey);
      var remaining = phase.exercises.filter(function (ex) { return !exerciseDone(ex); }).length;
      if (remaining > 0 && remaining <= threshold) {
        var num = phaseNumbers[phaseKey];
        var cards = document.querySelectorAll(".ws-phase-card");
        cards.forEach(function (card) {
          var kicker = card.querySelector(".ws-kicker");
          if (kicker && kicker.textContent.trim() === phaseLabels[phaseKey]) {
            if (!card.querySelector(".ws-nudge-almost")) {
              var badge = document.createElement("span");
              badge.className = "ws-nudge-almost";
              badge.textContent = remaining + ' exercise' + (remaining !== 1 ? 's' : '') + ' left to complete this phase';
              var content = card.querySelector(".ws-phase-content");
              if (content) content.appendChild(badge);
            }
          }
        });
      }
    });
  }

  function showPhaseCompletionModal(phaseKey) {
    if (qs(".ws-nudge-modal-overlay")) return;
    var phase = getPhase(phaseKey);
    var allDone = phases.every(function (pk) { return exercisesDone(pk); });
    var overlay = document.createElement("div");
    overlay.className = "ws-nudge-modal-overlay";

    var certLink = allDone
      ? '<a class="ws-button" href="../certificate/index.html" style="margin-top:8px">View your certificate &rarr;</a>'
      : "";
    var nextPhaseKey = phases[phases.indexOf(phaseKey) + 1];
    var nextBtn = (!allDone && nextPhaseKey && phaseUnlocked(nextPhaseKey))
      ? '<a class="ws-button" href="' + escapeHtml(phaseFiles[nextPhaseKey]) + '">' + escapeHtml(phaseLabels[nextPhaseKey]) + ': ' + escapeHtml(getPhase(nextPhaseKey).title) + ' &rarr;</a>'
      : "";

    overlay.innerHTML =
      '<div class="ws-nudge-modal" role="dialog" aria-modal="true" aria-labelledby="ws-nudge-modal-title">' +
        '<button class="ws-nudge-modal-close" type="button" aria-label="Close">&times;</button>' +
        '<div class="ws-nudge-modal-icon">&#127881;</div>' +
        '<h2 id="ws-nudge-modal-title">' + escapeHtml(phaseLabels[phaseKey]) + ' complete</h2>' +
        '<p>' + (allDone ? 'You have completed the full program. Congratulations.' : 'You have finished all exercises in ' + escapeHtml(phaseLabels[phaseKey]) + '. Keep the momentum going.') + '</p>' +
        (certLink || nextBtn || '<button class="ws-button" type="button" data-nudge-close>Back to dashboard</button>') +
      '</div>';

    overlay.querySelector(".ws-nudge-modal-close").addEventListener("click", function () { overlay.remove(); });
    var closeBtn = overlay.querySelector("[data-nudge-close]");
    if (closeBtn) closeBtn.addEventListener("click", function () { overlay.remove(); });
    overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  function applyNudges() {
    var stack = qs(".ws-home-stack");
    if (!stack) return;

    var now = Date.now();
    var lastVisit = parseInt(localStorage.getItem(NUDGE_LAST_VISIT_KEY) || "0", 10);
    localStorage.setItem(NUDGE_LAST_VISIT_KEY, String(now));
    var daysSince = lastVisit ? Math.floor((now - lastVisit) / 86400000) : 0;

    var continueTarget = nudgeContinueTarget();
    var newlyComplete = nudgeNewlyCompletePhases();

    var defaults = { continueCard: true, daysSinceBanner: true, daysSinceThreshold: 5, almostThere: true, almostThereThreshold: 2, phaseCompletionModal: true };

    function applyWithSettings(inApp) {
      var s = Object.assign({}, defaults, inApp || {});
      if (s.continueCard && continueTarget && !qs(".ws-mission-card", stack)) insertContinueCard(stack, continueTarget);
      if (s.daysSinceBanner && lastVisit > 0 && daysSince >= Number(s.daysSinceThreshold || 5)) insertDaysSinceBanner(stack, daysSince);
      if (s.almostThere) applyAlmostThere(Number(s.almostThereThreshold || 2));
      if (s.phaseCompletionModal && newlyComplete.length) {
        var phaseReward = null;
        var programReward = null;
        newlyComplete.forEach(function (pk) {
          localStorage.setItem(NUDGE_PHASE_SEEN_PREFIX + phaseNumbers[pk], "true");
          var settings = rewardSettings();
          var phaseMp = Number(settings.mp && settings.mp.phaseCompletion && settings.mp.phaseCompletion[pk]);
          if (!Number.isFinite(phaseMp)) phaseMp = ({ phase1: 100, phase2: 150, phase3: 200 })[pk] || 0;
          var result = awardRewardEvent({
            id: "phase-completed:" + pk,
            type: "phase-completed",
            title: phaseLabels[pk] + " complete",
            mp: phaseMp
          });
          if (result.awarded) phaseReward = { phaseKey: pk, result: result };
        });
        if (phases.every(function (phaseKey) { return exercisesDone(phaseKey); })) {
          var programSettings = rewardSettings();
          var programMp = Number(programSettings.mp && programSettings.mp.programCompletion);
          if (!Number.isFinite(programMp)) programMp = PROGRAM_COMPLETION_MP;
          var programResult = awardRewardEvent({
            id: "program-completed:tsa-program",
            type: "program-completed",
            title: "Full program complete",
            mp: programMp
          });
          if (programResult.awarded) programReward = programResult;
        }
        if (phaseReward || programReward) {
          queueRemoteProgressSave();
          var displayedReward = programReward || phaseReward.result;
          showWorkspaceRewardMoment({
            label: programReward ? "Program complete" : "Phase complete",
            title: "+" + displayedReward.mpEarned + " MP earned",
            body: programReward
              ? "You completed the full learning journey and earned the 200 MP program bonus. Total MP: " + displayedReward.total + "."
              : phaseLabels[phaseReward.phaseKey] + " completion bonus awarded. Total MP: " + displayedReward.total + ".",
            startMp: displayedReward.startTotal,
            newTotal: displayedReward.total,
            previousLevel: rewardLevelForMp(displayedReward.startTotal),
            currentLevel: rewardLevelForMp(displayedReward.total),
            showLevelModal: rewardLevelForMp(displayedReward.startTotal) !== rewardLevelForMp(displayedReward.total)
          });
        }
        showPhaseCompletionModal(newlyComplete[newlyComplete.length - 1]);
      }
    }

    import(firebaseHref())
      .then(function (fb) { return fb.getEngagementSettings(); })
      .then(function (settings) { applyWithSettings((settings || {}).inApp); })
      .catch(function () { applyWithSettings({}); });
  }

  // ===== End in-app nudges =====

  // ===== Assessment visibility =====

  function isAdminUser() {
    var profile = {};
    try { profile = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}"); } catch {}
    return profile.role === "admin" || profile.role === "owner" || localStorage.getItem(ADMIN_KEY) === "true";
  }

  function hideAssessmentsFromPage() {
    // Hide nav link
    var links = document.querySelectorAll('a.ws-link');
    links.forEach(function (link) {
      if (link.href && link.href.indexOf("#assessments") !== -1) {
        var sep = link.previousElementSibling;
        if (sep && sep.classList.contains("ws-sep")) sep.style.display = "none";
        link.style.display = "none";
      }
    });
    // Hide dashboard section
    var section = document.getElementById("assessments");
    if (section) section.style.display = "none";
  }

  function applyAssessmentVisibility() {
    import(firebaseHref())
      .then(function (fb) { return fb.getAssessmentVisibility(); })
      .then(function (settings) {
        var userEnabled = settings.userEnabled !== false;
        var adminEnabled = settings.adminEnabled !== false;
        var admin = isAdminUser();
        var canSee = admin ? (userEnabled || adminEnabled) : userEnabled;
        if (!canSee) hideAssessmentsFromPage();
      })
      .catch(function () {});
  }

  // ===== End assessment visibility =====

  function bindHomePage() {
    var missionOverlay = qs("[data-mission-overlay]");
    function closeMissionPopup() {
      if (!missionOverlay) return;
      missionOverlay.classList.add("ws-hidden");
      localStorage.setItem("utl_daily_mission_dismissed", missionDayKey());
    }
    qsa("[data-mission-close]").forEach(function (button) { button.addEventListener("click", closeMissionPopup); });
    if (missionOverlay) missionOverlay.addEventListener("click", function (event) { if (event.target === missionOverlay) closeMissionPopup(); });

    function selectedMissionOption() {
      var selectedRadio = qs('input[name="wsMissionPlan"]:checked');
      var target = Number(selectedRadio ? selectedRadio.value : 30);
      return uniqueMissionOptions(missionTaskPool()).filter(function (option) { return option.target === target; })[0] || missionOption(missionTaskPool(), target, "", "");
    }
    function refreshMissionSummary() {
      var option = selectedMissionOption();
      var challenge = qs("[data-mission-challenge]");
      var extra = challenge && challenge.checked ? 10 : 0;
      var count = option.tasks.length + (extra ? 1 : 0);
      var summary = qs("[data-mission-summary]");
      if (summary) summary.textContent = "About " + (option.minutes + extra) + " minutes · " + count + " activit" + (count === 1 ? "y" : "ies");
      var start = qs("[data-mission-start]");
      if (start && option.tasks[0]) start.href = option.tasks[0].href;
    }
    qsa('input[name="wsMissionPlan"]').forEach(function (radio) {
      radio.addEventListener("change", function () {
        var target = Number(radio.value);
        localStorage.setItem("utl_daily_mission_target", String(target));
        qsa(".ws-mission-option").forEach(function (card) {
          card.classList.toggle("ws-selected", Boolean(card.querySelector("input:checked")));
        });
        refreshMissionSummary();
      });
    });
    var missionChallenge = qs("[data-mission-challenge]");
    if (missionChallenge) missionChallenge.addEventListener("change", refreshMissionSummary);
    var missionStart = qs("[data-mission-start]");
    if (missionStart) missionStart.addEventListener("click", function () {
      var option = selectedMissionOption();
      var planTasks = option.tasks.map(function (task) { return Object.assign({}, task); });
      if (missionChallenge && missionChallenge.checked) {
        planTasks.push({ id: "challenge:" + missionDayKey(), type: "Challenge", title: missionChallenge.dataset.challengeTitle, href: missionChallenge.dataset.challengeHref, minutes: 10, manual: true, complete: false, stage: "pending", prePrompt: "What do you want to improve this time?", preChoices: ["Make my structure clearer", "Make my response more concise", "Strengthen my recommendation", "Try a different approach"], postPrompt: "How did it go?", postChoices: ["I made a clear improvement", "I improved it somewhat", "I need another attempt"] });
      }
      localStorage.setItem("utl_daily_mission_plan", JSON.stringify({ date: missionDayKey(), target: option.target, tasks: planTasks, lastSeenDone: 0 }));
      localStorage.setItem("utl_daily_mission_dismissed", missionDayKey());
    });
    qsa("[data-mission-start-challenge]").forEach(function (button) { button.addEventListener("click", function () {
      var plan = readDailyMission();
      if (!plan) return;
      plan.tasks.forEach(function (task) { if (task.manual) task.stage = "prepare"; });
      localStorage.setItem("utl_daily_mission_plan", JSON.stringify(plan));
      renderIndex();
    }); });
    var challengePrepare = qs("[data-challenge-prepare]");
    if (challengePrepare) challengePrepare.addEventListener("submit", function (event) {
      event.preventDefault();
      var choice = new FormData(challengePrepare).get("challengeChoice");
      if (!choice) return;
      var plan = readDailyMission();
      var challengeTask = plan && plan.tasks.filter(function (task) { return task.manual; })[0];
      if (!challengeTask) return;
      challengeTask.intention = String(choice);
      challengeTask.preNote = String(new FormData(challengePrepare).get("challengeNote") || "");
      challengeTask.stage = "active";
      localStorage.setItem("utl_daily_mission_plan", JSON.stringify(plan));
      window.location.href = challengeTask.href;
    });
    var challengeReflect = qs("[data-challenge-reflect]");
    if (challengeReflect) challengeReflect.addEventListener("submit", function (event) {
      event.preventDefault();
      var data = new FormData(challengeReflect);
      var choice = data.get("challengeChoice");
      if (!choice) return;
      var plan = readDailyMission();
      var challengeTask = plan && plan.tasks.filter(function (task) { return task.manual; })[0];
      if (!challengeTask) return;
      challengeTask.outcome = String(choice);
      challengeTask.postNote = String(data.get("challengeNote") || "");
      challengeTask.complete = true;
      challengeTask.stage = "complete";
      localStorage.setItem("utl_daily_mission_plan", JSON.stringify(plan));
      renderIndex();
    });
    var challengeBack = qs("[data-challenge-back]");
    if (challengeBack) challengeBack.addEventListener("click", function () {
      var plan = readDailyMission();
      if (!plan) return;
      plan.tasks.forEach(function (task) { if (task.manual) task.stage = "pending"; });
      localStorage.setItem("utl_daily_mission_plan", JSON.stringify(plan));
      renderIndex();
    });
    var changeMission = qs("[data-mission-change]");
    if (changeMission) changeMission.addEventListener("click", function () {
      var plan = readDailyMission();
      if (plan && missionProgress(plan).done > 0) return;
      localStorage.removeItem("utl_daily_mission_plan");
      localStorage.removeItem("utl_daily_mission_dismissed");
      renderIndex();
    });
    var journeyToggle = qs("[data-journey-toggle]");
    var journeyCard = qs(".ws-journey-card");
    if (journeyCard && readBool("utl_orientation_ready")) journeyCard.classList.add("ws-complete");
    if (journeyToggle && journeyCard) {
      journeyToggle.addEventListener("click", function () {
        var open = !journeyCard.classList.contains("ws-open");
        journeyCard.classList.toggle("ws-open", open);
        writeBool("utl_learning_journey_open", open);
        if (!open) writeBool("utl_learning_journey_seen", true);
        var chevron = journeyToggle.querySelector(".ws-journey-chevron");
        if (chevron) chevron.innerHTML = open ? "&minus;" : "+";
      });
    }
    qsa("[data-journey-link]").forEach(function (link) {
      link.addEventListener("click", function () {
        writeBool("utl_learning_journey_seen", true);
        writeBool("utl_learning_journey_open", false);
        if (!journeyCard) return;
        journeyCard.classList.remove("ws-open");
        var chevron = qs(".ws-journey-chevron");
        if (chevron) chevron.innerHTML = "+";
      });
    });
    var orientationToggle = qs("[data-orientation-toggle]");
    var orientationCard = qs(".ws-orientation-card");
    if (orientationCard && readBool("utl_orientation_ready")) orientationCard.classList.add("ws-complete");
    if (orientationToggle && orientationCard) {
      orientationToggle.addEventListener("click", function () {
        var open = !orientationCard.classList.contains("ws-open");
        orientationCard.classList.toggle("ws-open", open);
        writeBool("utl_orientation_open", open);
        queueRemoteProgressSave();
        var chevron = orientationToggle.querySelector(".ws-orientation-chevron");
        if (chevron) chevron.innerHTML = open ? "&minus;" : "+";
      });
    }
    var welcomeToggle = qs("[data-welcome-toggle]");
    if (welcomeToggle) {
      welcomeToggle.addEventListener("click", function () {
        var body = qs("[data-welcome-body]");
        if (body) {
          var open = !body.classList.contains("ws-open");
          body.classList.toggle("ws-open", open);
          writeBool("utl_welcome_video_open", open);
          var icon = qs("[data-welcome-icon]");
          if (icon) icon.innerHTML = open ? "&minus;" : "+";
        }
      });
    }
    var orientationWatch = qs("[data-orientation-watch]");
    if (orientationWatch && orientationCard) {
      if (readBool("utl_orientation_ready")) {
        var backfillReward = awardOrientationVideo();
        if (backfillReward.awarded) queueRemoteProgressSave();
      }
      function handleOrientationWatch() {
        var nowWatched = !readBool("utl_orientation_ready");
        writeBool("utl_orientation_ready", nowWatched);
        var orientationReward = nowWatched ? awardOrientationVideo() : null;
        queueRemoteProgressSave();
        var action = qs("[data-orientation-action]");
        if (action) {
          action.innerHTML = orientationWatchActionHtml(nowWatched);
          var nextButton = action.querySelector("[data-orientation-watch]");
          if (nextButton) nextButton.addEventListener("click", handleOrientationWatch);
        }
        var sub = qs(".ws-orientation-sub");
        if (sub) sub.innerHTML = nowWatched ? "Orientation complete &#10003;" : "Get oriented before jumping into Phase 1";
        if (nowWatched) {
          orientationCard.classList.add("ws-complete");
          if (journeyCard) {
            journeyCard.classList.add("ws-complete");
            journeyCard.classList.remove("ws-open");
          }
          writeBool("utl_learning_journey_open", false);
          writeBool("utl_learning_journey_seen", true);
          if (orientationReward && orientationReward.awarded) {
            showWorkspaceRewardMoment({
              label: "Orientation complete",
              title: "+" + orientationReward.mpEarned + " MP earned",
              body: "Your orientation progress was saved. Total MP: " + orientationReward.total + ".",
              startMp: orientationReward.startTotal,
              newTotal: orientationReward.total,
              previousLevel: rewardLevelForMp(orientationReward.startTotal),
              currentLevel: rewardLevelForMp(orientationReward.total),
              showLevelModal: rewardLevelForMp(orientationReward.startTotal) !== rewardLevelForMp(orientationReward.total)
            });
          }
          setTimeout(function () {
            orientationCard.classList.remove("ws-open");
            writeBool("utl_orientation_open", false);
            queueRemoteProgressSave();
            var chevron = qs(".ws-orientation-chevron");
            if (chevron) chevron.innerHTML = "+";
          }, 550);
        }
      }
      orientationWatch.addEventListener("click", handleOrientationWatch);
    }
  }

  function renderOrientation() {
    if (!requireMember()) return;
    if (!remoteProgressLoaded) {
      ensureRemoteProgressLoaded(function () { renderOrientation(); });
      return;
    }
    pageShell("orientation", '<span class="ws-kicker">Orientation</span><h1 class="ws-title">Start here.</h1><p class="ws-subtitle">Get oriented to the MA storyline, the learning sequence, and how to move through the member workspace.</p>' + orientationContextSection() + '<nav class="ws-bottom-nav"><a class="ws-button ws-button-secondary" href="index.html">&larr; Dashboard</a><a class="ws-button" href="phase-1.html">Phase 1: Think clearly &rarr;</a></nav>');
    bindContextToggles();
  }

  function phaseHeader(phaseKey) {
    var phase = getPhase(phaseKey);
    var number = phaseNumbers[phaseKey];
    var doneVideos = videosDone(phaseKey);
    return '<span class="ws-kicker">' + phaseLabels[phaseKey] + '</span><h1 class="ws-title">' + escapeHtml(phase.title) + '</h1><p class="ws-subtitle">' + escapeHtml(doneVideos ? "Videos done. Now apply what you learned." : phase.description) + '</p><div class="ws-stepper"><span class="ws-step ' + (doneVideos ? "ws-done" : "ws-active") + '">Step 1 Watch</span><span class="ws-step ' + (doneVideos ? "ws-active" : "") + '">Step 2 Practice</span></div>';
  }

  function phaseOneWatchHeader() {
    var phase = getPhase("phase1");
    return '<span class="ws-kicker">Phase 1</span><h1 class="ws-title">' + escapeHtml(phase.title) + '</h1><p class="ws-subtitle">' + escapeHtml(phase.description) + '</p>';
  }

  function phaseOnePracticeHeader() {
    return '<span class="ws-kicker">Phase 1</span><h1 class="ws-title">Practice the exercises</h1><p class="ws-subtitle">Apply the Think clearly lessons in the MA storyline. Start with your own structure, then compare with AI when useful.</p>';
  }

  function phaseProgressPanel(phaseKey, mode) {
    var phase = getPhase(phaseKey);
    var progress = phaseProgress(phaseKey);
    var videosComplete = progress.watched === progress.lessonsTotal;
    var practiceComplete = progress.exercisesComplete === progress.exercisesTotal;
    var videoPercent = progress.lessonsTotal ? Math.round((progress.watched / progress.lessonsTotal) * 100) : 0;
    var exercisePercent = progress.exercisesTotal ? Math.round((progress.exercisesComplete / progress.exercisesTotal) * 100) : 0;
    var next = nextExerciseTarget(phaseKey);
    var nextHref = "";
    var nextText = "";
    if (!videosComplete) {
      nextHref = mode === "practice" && phaseKey === "phase1" ? memberHref("phase-1.html") + "#lessons" : "#lessons";
      nextText = "Continue watching lessons";
    } else if (next) {
      nextHref = appHref(next.appUrl);
      nextText = "Continue: " + next.title;
    }
    var guidance = videosComplete
      ? "Videos are done. Keep going through the exercises when you are ready."
      : "Recommended: finish the lesson videos first, then use the exercises to practice the frameworks.";
    var nextAction = practiceComplete
      ? '<div class="ws-complete-banner">&#10003; Phase practice complete. You can review any finished exercise whenever you want.</div>'
      : '<div class="ws-next-action"><span>' + escapeHtml(nextText || "Keep going when you are ready") + '</span>' + (nextHref ? '<a class="ws-button ws-button-navy" href="' + escapeHtml(nextHref) + '"' + (next && videosComplete ? ' data-exercise-visit="' + next.id + '"' : '') + '>Open next step &rarr;</a>' : '') + '</div>';
    return '<section class="ws-phase-progress-panel" aria-label="' + escapeHtml(phaseLabels[phaseKey]) + ' progress">' +
      '<div class="ws-phase-progress-top"><div><span class="ws-kicker">' + escapeHtml(mode === "practice" ? "Practice progress" : "Phase progress") + '</span><h2>' + escapeHtml(mode === "practice" ? "Exercise progress" : "Your progress") + '</h2><p>Track videos and exercises separately so it is clear what has been finished and what comes next.</p></div></div>' +
      '<div class="ws-progress-split">' +
        '<article class="ws-progress-metric ' + (videosComplete ? "ws-complete" : "") + '"><div class="ws-progress-metric-head"><span><strong>Videos</strong><small>' + progress.watched + ' of ' + progress.lessonsTotal + ' watched</small></span><span class="ws-progress-value">' + videoPercent + '%</span></div><div class="ws-metric-track" aria-hidden="true"><span style="width:' + videoPercent + '%"></span></div></article>' +
        '<article class="ws-progress-metric ' + (practiceComplete ? "ws-complete" : "") + '"><div class="ws-progress-metric-head"><span><strong>Exercises</strong><small>' + progress.exercisesComplete + ' of ' + progress.exercisesTotal + ' complete</small></span><span class="ws-progress-value">' + exercisePercent + '%</span></div><div class="ws-metric-track" aria-hidden="true"><span style="width:' + exercisePercent + '%"></span></div></article>' +
      '</div><p class="ws-progress-guidance">' + escapeHtml(guidance) + '</p>' + nextAction +
    '</section>';
  }

  function stepTabs(active) {
    return '<div class="ws-step-tabs"><div class="ws-step-tabs-inner"><a class="ws-step-tab ' + (active === "watch" ? "ws-active" : "") + '" href="' + memberHref("phase-1.html") + '">Step 1 &middot; Watch the lessons</a><a class="ws-step-tab ' + (active === "practice" ? "ws-active" : "") + '" href="' + memberHref("phase-1/practice/index.html") + '">Step 2 &middot; Practice the exercises</a></div></div>';
  }

  function phaseOneFlowCard(activeStep) {
    var phase = getPhase("phase1");
    var count = watchedCount("phase1");
    var total = phase.lessons.length;
    var done = videosDone("phase1");
    var stepClass = {
      watch: done ? "ws-done" : activeStep === "watch" ? "ws-current" : "",
      context: done && activeStep === "practice" ? "ws-current" : done ? "ws-done" : "",
      practice: done && activeStep === "practice" ? "ws-current" : ""
    };
    var action = done
      ? '<a class="ws-button" href="' + memberHref("phase-1/practice/index.html") + '">Start Phase 1 practice &rarr;</a><p class="ws-flow-note">You have watched the lessons. Review the setup, then begin the exercises.</p>'
      : '<a class="ws-button ws-button-navy" href="#lessons">Keep watching Phase 1 lessons</a><p class="ws-flow-note">Do not start the exercises yet. Practice unlocks after all Phase 1 lessons are watched.</p>';
    return '<section class="ws-phase-flow" aria-label="Phase 1 flow"><div class="ws-phase-flow-head"><div><span class="ws-kicker">How to use this phase</span><h2>Watch first, then practice.</h2><p>The exercises assume you have learned MECE, the Rule of three, and BSP. Finish the lessons before moving into the tools.</p></div><span class="ws-flow-progress">' + count + ' of ' + total + ' watched</span></div><ol class="ws-flow-steps"><li class="ws-flow-step ' + stepClass.watch + '"><strong>Watch the lessons first.</strong> Learn the frameworks before you try to use them.</li><li class="ws-flow-step ' + stepClass.context + '"><strong>Review the MA setup.</strong> Understand the situation Aiko is putting you in.</li><li class="ws-flow-step ' + stepClass.practice + '"><strong>Practice the exercises.</strong> Apply the frameworks in order, starting with your own answer before using AI.</li></ol><div class="ws-flow-actions">' + action + '</div></section>';
  }

  function phaseOneLockedPractice() {
    var phase = getPhase("phase1");
    return '<section class="ws-practice-locked"><span class="ws-kicker">Practice locked</span><h2>Watch all Phase 1 lessons before starting the exercises.</h2><p>The exercises use the exact frameworks from the videos. If learners skip the lessons, the tools feel like isolated tasks instead of a sequence.</p><ul class="ws-practice-locked-list"><li><strong>Watch the lessons first:</strong> Complete all ' + phase.lessons.length + ' videos on MECE, the Rule of three, and BSP.</li><li><strong>Then review the setup:</strong> Read the MA context so each exercise makes sense in the storyline.</li><li><strong>Then practice:</strong> Start Exercise 1 and move through the tools in order.</li></ul><a class="ws-button ws-button-navy" href="' + memberHref("phase-1.html") + '">Go to Phase 1 lessons &rarr;</a></section>';
  }

  function renderPhasePage(phaseKey) {
    if (!requireMember()) return;
    if (!remoteProgressLoaded) {
      ensureRemoteProgressLoaded(function () { renderPhasePage(phaseKey); });
      return;
    }
    if (!phaseUnlocked(phaseKey)) {
      pageShell(phaseKey, '<span class="ws-kicker">' + phaseLabels[phaseKey] + '</span><h1 class="ws-title">This phase is locked.</h1><p class="ws-subtitle">Complete the previous phase exercises to continue.</p><p style="margin-top:24px"><a class="ws-button" href="index.html">Back to dashboard</a></p>');
      return;
    }
    var activeId = sessionStorage.getItem("utl_active_lesson_" + phaseKey) || getPhase(phaseKey).lessons[0].id;
    if (phaseKey === "phase1") {
      var doneVideos = videosDone("phase1");
      var nextCta = doneVideos
        ? '<div class="ws-gold-cta"><span>Lessons complete &rarr;</span><a href="' + memberHref("phase-1/practice/index.html") + '">Go to Practice the Exercises</a></div>'
        : '<div class="ws-gold-cta"><span>Step 1 is not finished yet &rarr;</span><a href="#lessons">Watch all 3 Phase 1 lesson videos before practice</a></div>';
      pageShell(phaseKey, '<div id="top"></div>' + phaseOneWatchHeader() + phaseProgressPanel(phaseKey, "watch") + phaseOneFlowCard("watch") + videoSection(phaseKey, activeId) + nextCta, stepTabs("watch"));
    } else {
      pageShell(phaseKey, phaseHeader(phaseKey) + phaseProgressPanel(phaseKey, "phase") + videoSection(phaseKey, activeId) + exerciseSection(phaseKey) + bottomPhaseNav(phaseKey));
    }
    bindPhasePage(phaseKey);
    scrollToHashTarget();
  }

  function renderPhasePracticePage(phaseKey) {
    if (!requireMember()) return;
    if (!remoteProgressLoaded) {
      ensureRemoteProgressLoaded(function () { renderPhasePracticePage(phaseKey); });
      return;
    }
    if (phaseKey !== "phase1") {
      renderPhasePage(phaseKey);
      return;
    }
    var doneVideos = videosDone("phase1");
    var reminder = doneVideos
      ? '<div class="ws-practice-reminder">Ready to practice. Review each setup clip, then start the matching exercise.</div>'
      : '<div class="ws-practice-reminder">Recommended: finish the Phase 1 videos first. The exercises are visible here so you can preview the sequence and return when ready.</div>';
    var body = phaseOnePracticeHeader() + phaseProgressPanel(phaseKey, "practice") + reminder + '<section class="ws-practice-list">' + phaseOnePracticeCards() + '</section>';
    pageShell("phase1", body, stepTabs("practice"));
    bindPracticePage();
    scrollToHashTarget();
  }

  function scrollToHashTarget() {
    var hash = window.location.hash ? window.location.hash.slice(1) : "";
    if (!hash) return;
    setTimeout(function () {
      var target = qs("#" + hash);
      if (target) target.scrollIntoView({ block: "start" });
    }, 0);
  }

  function phaseOnePracticeCards() {
    var phase = getPhase("phase1");
    var exercises = phase.exercises;
    var grocery = exercises[0];
    var groceryAi = exercises[1];
    var notes = exercises[2];
    var rushed = exercises[3];
    var notesAi = exercises[4];
    var chalkboard = exercises[5];
    return contextOnlyPracticeCard("practice-p1-welcome", phase.introContexts[0], true) + practiceCard("practice-grocery", grocery, groceryAi, true) + singlePracticeCard("practice-notes", notes, false) + practiceCard("practice-rushed", rushed, notesAi, false) + singlePracticeCard("practice-chalkboard", chalkboard, false);
  }

  function mediaPreview(exercise) {
    var url = exerciseContextUrl(exercise);
    if (!url) return '<div class="ws-media-row ws-missing"><span class="ws-media-icon">&#9654;</span><span>Video coming soon</span></div>';
    return '<div class="ws-context-embed" data-context-media-id="' + escapeHtml(exercise.id || '') + '" data-context-media-title="' + escapeHtml(exercise.contextTitle || exercise.title || 'Context') + '">' + renderEmbeddedMedia(url, exercise.contextTitle || exercise.title) + '</div>';
  }

  function contextDoneKey(id) {
    return "utl_context_complete_" + id;
  }

  function contextCompletionAction(item) {
    var type = exerciseContextType(item);
    var url = exerciseContextUrl(item);
    if (!item || !item.id || !url || (type !== "video" && type !== "slides")) return "";
    var done = readBool(contextDoneKey(item.id));
    var prompt = type === "slides" ? "Finished reviewing?" : "Finished watching?";
    var instruction = type === "slides" ? "Mark these slides complete" : "Mark this context video complete";
    return '<div class="ws-player-actions ws-context-completion ' + (done ? 'ws-context-done' : '') + '" data-context-kind="' + type + '"><div class="ws-player-action-text"><strong>' + (done ? 'Context marked complete.' : prompt) + '</strong><span>' + (done ? 'You can mark it not watched if this was a mistake. MP already earned is kept.' : instruction + ' to save progress and earn ' + CONTEXT_COMPLETE_MP + ' MP once.') + '</span></div><button class="ws-button ' + (done ? 'ws-button-secondary' : '') + '" type="button" data-context-complete="' + escapeHtml(item.id) + '" data-context-title="' + escapeHtml(item.contextTitle || item.title || 'Context') + '" title="' + (done ? 'Click to mark this context incomplete. Earned MP is kept.' : 'Confirm after watching the video or reviewing the slides.') + '">' + (done ? 'Mark not watched' : 'Mark context complete') + '</button></div>';
  }

  function decorateContextCompletionActions() {
    qsa("[data-context-media-id]").forEach(function (media) {
      var id = media.getAttribute("data-context-media-id");
      if (!id || document.querySelector('[data-context-complete="' + id + '"]')) return;
      var item = allExercises().find(function (exercise) { return exercise.id === id; });
      if (!item) {
        phases.some(function (phaseKey) {
          item = (getPhase(phaseKey).introContexts || []).find(function (context) { return context.id === id; });
          return !!item;
        });
      }
      if (!item) return;
      var body = media.closest(".ws-practice-body");
      if (!body) return;
      var actions = body.querySelector(".ws-card-actions");
      if (!actions) {
        actions = document.createElement("div");
        actions.className = "ws-card-actions";
        media.insertAdjacentElement("afterend", actions);
      }
      actions.insertAdjacentHTML("afterbegin", contextCompletionAction(item));
    });
  }

  function bindContextCompletionButtons() {
    decorateContextCompletionActions();
    qsa("[data-context-complete]").forEach(function (button) {
      button.addEventListener("click", function () {
        var id = button.getAttribute("data-context-complete");
        var key = contextDoneKey(id);
        var wasDone = readBool(key);
        var nowDone = !wasDone;
        writeBool(key, nowDone);
        queueRemoteProgressSave();
        button.classList.toggle("ws-button-secondary", nowDone);
        button.innerHTML = nowDone ? "Mark not watched" : "Mark context complete";
        var completion = button.closest(".ws-context-completion");
        if (completion) {
          completion.classList.toggle("ws-context-done", nowDone);
          var text = completion.querySelector(".ws-player-action-text");
          var isSlides = completion.getAttribute("data-context-kind") === "slides";
          if (text) text.innerHTML = nowDone
            ? "<strong>Context marked complete.</strong><span>You can mark it not watched if this was a mistake. MP already earned is kept.</span>"
            : "<strong>" + (isSlides ? "Finished reviewing?" : "Finished watching?") + "</strong><span>" + (isSlides ? "Mark these slides complete" : "Mark this context video complete") + " to save progress and earn " + CONTEXT_COMPLETE_MP + " MP once.</span>";
        }
        button.title = nowDone
          ? "Click to mark this context incomplete. Earned MP is kept."
          : "Confirm after watching the video or reviewing the slides.";
        if (!nowDone) return;
        var reward = awardRewardEvent({
          id: "context:" + id,
          type: "context-completed",
          title: button.getAttribute("data-context-title") || "Context",
          mp: CONTEXT_COMPLETE_MP
        });
        if (reward && reward.awarded) {
          showWorkspaceRewardMoment({
            label: "Context complete",
            title: "+" + reward.mpEarned + " MP earned",
            body: "Your preparation was saved. Total MP: " + reward.total + ".",
            startMp: reward.startTotal,
            newTotal: reward.total,
            previousLevel: rewardLevelForMp(reward.startTotal),
            currentLevel: rewardLevelForMp(reward.total),
            showLevelModal: rewardLevelForMp(reward.startTotal) !== rewardLevelForMp(reward.total)
          });
        }
      });
    });
  }

  function practiceOpenState(cardId, defaultOpen, complete) {
    if (localStorage.getItem("utl_practice_open_" + cardId) === null) return complete ? false : defaultOpen;
    return readBool("utl_practice_open_" + cardId);
  }

  function practiceCardStatus(done, next) {
    if (done) return '<span class="ws-card-state ws-done">&#10003; Complete</span>';
    if (next) return '<span class="ws-card-state ws-next">Next up</span>';
    return '<span class="ws-card-state">Not started</span>';
  }

  function practiceCardCheck(done) {
    return done ? '<span class="ws-card-check">&#10003;</span>' : "";
  }

  function practiceCard(cardId, exercise, aiExercise, defaultOpen) {
    var complete = exerciseDone(exercise) && exerciseDone(aiExercise);
    var next = nextExerciseTarget("phase1");
    var isNext = next && (next.id === exercise.id || next.id === aiExercise.id);
    var open = practiceOpenState(cardId, defaultOpen, complete);
    var activeTab = localStorage.getItem("utl_practice_tab_" + cardId) || "start";
    var hint = activeTab === "ai" ? 'Watch the AI setup. Then, compare how prompting changes the shape of the work.' : 'Start here first. Then, compare your work with <span>AI &#10022;</span>';
    return '<article class="ws-practice-card ' + (complete ? "ws-complete " : "") + (!complete && isNext ? "ws-next-card " : "") + (open ? "ws-open" : "") + '" data-practice-card="' + cardId + '"><button class="ws-practice-head" type="button" data-practice-toggle="' + cardId + '"><span class="ws-practice-chevron">' + (open ? "&minus;" : "+") + '</span><span><span class="ws-practice-status-row"><span class="ws-card-role">Exercise</span></span><h3>' + escapeHtml(exercise.title) + '</h3><p>' + escapeHtml(complete ? "Complete. Open this card if you want to review or redo it." : exercise.description) + '</p></span><span class="ws-practice-state">' + practiceCardCheck(complete) + practiceCardStatus(complete, isNext) + '</span></button><div class="ws-practice-body"><div class="ws-exercise-tabs" role="tablist" aria-label="' + escapeHtml(exercise.title) + ' exercise modes"><button class="ws-exercise-tab ' + (exerciseDone(exercise) ? "ws-tab-done " : "") + (activeTab === "ai" ? "" : "ws-active") + '" type="button" role="tab" data-practice-tab="' + cardId + '" data-tab-value="start"><span class="ws-tab-badge">' + (exerciseDone(exercise) ? "&#10003;" : "1") + '</span><span>Start here</span></button><button class="ws-exercise-tab ' + (exerciseDone(aiExercise) ? "ws-tab-done " : "") + (activeTab === "ai" ? "ws-active" : "") + '" type="button" role="tab" data-practice-tab="' + cardId + '" data-tab-value="ai"><span class="ws-tab-badge">' + (exerciseDone(aiExercise) ? "&#10003;" : "2") + '</span><span>Try with AI &#10022;</span></button></div><p class="ws-tab-hint" data-tab-hint="' + cardId + '">' + hint + '</p><div class="ws-practice-pane ' + (activeTab === "ai" ? "" : "ws-active") + '" data-tab-pane="' + cardId + '" data-tab-panel="start"><div class="ws-before-block"><h4>Before you start</h4><p>' + escapeHtml(exercise.contextBody) + '</p></div>' + mediaPreview(exercise) + '<a class="ws-button ws-button-navy" href="' + appHref(exercise.appUrl) + '" data-exercise-visit="' + exercise.id + '">' + (exerciseDone(exercise) ? "Go to exercise" : "Start exercise") + ' &rarr;</a></div><div class="ws-practice-pane ' + (activeTab === "ai" ? "ws-active" : "") + '" data-tab-pane="' + cardId + '" data-tab-panel="ai"><div class="ws-ai-context"><h4>Now try it with AI</h4><p>You have now completed the core exercise. Now, let us see how we can use AI to handle the same task. Notice how the prompt you give AI will shape the output you get back.</p></div><a class="ws-ai-link-card" href="' + appHref(aiExercise.appUrl) + '" data-exercise-visit="' + aiExercise.id + '"><span class="ws-ai-icon">&#128203;</span><span><strong>' + escapeHtml(exercise.title) + ' &mdash; AI exercise</strong><small>Prompt guide + walkthrough</small></span><span class="ws-ai-arrow">&rarr;</span></a><a class="ws-button ws-button-gold" href="' + appHref(aiExercise.appUrl) + '" data-exercise-visit="' + aiExercise.id + '">' + (exerciseDone(aiExercise) ? "Go to AI exercise" : "Start AI exercise") + ' &rarr;</a></div></div></article>';
  }

  function singlePracticeCard(cardId, exercise, defaultOpen) {
    var complete = exerciseDone(exercise);
    var next = nextExerciseTarget("phase1");
    var open = practiceOpenState(cardId, defaultOpen, complete);
    return '<article class="ws-practice-card ' + (complete ? "ws-complete " : "") + (!complete && next && next.id === exercise.id ? "ws-next-card " : "") + (open ? "ws-open" : "") + '" data-practice-card="' + cardId + '"><button class="ws-practice-head" type="button" data-practice-toggle="' + cardId + '"><span class="ws-practice-chevron">' + (open ? "&minus;" : "+") + '</span><span><span class="ws-practice-status-row"><span class="ws-card-role">Exercise</span></span><h3>' + escapeHtml(exercise.title) + '</h3><p>' + escapeHtml(complete ? "Complete. Open this card if you want to review or redo it." : exercise.description) + '</p></span><span class="ws-practice-state">' + practiceCardCheck(complete) + practiceCardStatus(complete, next && next.id === exercise.id) + '</span></button><div class="ws-practice-body"><div class="ws-before-block"><h4>Before you start</h4><p>' + escapeHtml(exercise.contextBody) + '</p></div><div class="ws-practice-pane ws-active">' + mediaPreview(exercise) + '<a class="ws-button ws-button-navy" href="' + appHref(exercise.appUrl) + '" data-exercise-visit="' + exercise.id + '">' + (complete ? "Go to exercise" : "Start exercise") + ' &rarr;</a></div></div></article>';
  }

  function contextOnlyPracticeCard(cardId, context, defaultOpen) {
    if (!context) return "";
    var open = localStorage.getItem("utl_practice_open_" + cardId) === null ? defaultOpen : readBool("utl_practice_open_" + cardId);
    return '<article class="ws-practice-card ws-context-card ' + (open ? "ws-open" : "") + '" data-practice-card="' + cardId + '"><button class="ws-practice-head" type="button" data-practice-toggle="' + cardId + '"><span class="ws-practice-chevron">' + (open ? "&minus;" : "+") + '</span><span><span class="ws-kicker">Story setup</span><h3>' + escapeHtml(context.contextTitle) + '</h3><p>Read before starting the exercises. ' + escapeHtml(context.contextBody) + '</p></span></button><div class="ws-practice-body">' + mediaPreview(context) + '</div></article>';
  }

  function bindPracticePage() {
    bindContextToggles();
    bindPracticeCardToggles();
    bindPracticeTabs();
    bindContextCompletionButtons();
    bindExerciseVisitLinks();
  }

  function bindPracticeCardToggles() {
    qsa("[data-practice-toggle]").forEach(function (button) {
      button.addEventListener("click", function () {
        var id = button.getAttribute("data-practice-toggle");
        var card = qs('[data-practice-card="' + id + '"]');
        if (!card) return;
        var open = !card.classList.contains("ws-open");
        card.classList.toggle("ws-open", open);
        writeBool("utl_practice_open_" + id, open);
        var chevron = button.querySelector(".ws-practice-chevron");
        if (chevron) chevron.innerHTML = open ? "&minus;" : "+";
      });
    });
  }

  function bindPracticeTabs() {
    qsa("[data-practice-tab]").forEach(function (button) {
      button.addEventListener("click", function () {
        var id = button.getAttribute("data-practice-tab");
        var value = button.getAttribute("data-tab-value");
        localStorage.setItem("utl_practice_tab_" + id, value);
        qsa('[data-practice-tab="' + id + '"]').forEach(function (tab) {
          tab.classList.toggle("ws-active", tab.getAttribute("data-tab-value") === value);
        });
        qsa('[data-tab-pane="' + id + '"]').forEach(function (pane) {
          pane.classList.toggle("ws-active", pane.getAttribute("data-tab-panel") === value);
        });
        var hint = qs('[data-tab-hint="' + id + '"]');
        if (hint) hint.innerHTML = value === "ai" ? 'Watch the AI setup. Then, compare how prompting changes the shape of the work.' : 'Start here first. Then, compare your work with <span>AI &#10022;</span>';
      });
    });
  }

  function bindExerciseVisitLinks() {
    qsa("[data-exercise-visit]").forEach(function (link) {
      link.addEventListener("click", function () {
        writeBool(visitedKey(link.getAttribute("data-exercise-visit")), true);
        saveRemoteProgressNow();
      });
    });
  }

  function videoSection(phaseKey, activeId) {
    var phase = getPhase(phaseKey);
    var lessons = orderedLessons(phaseKey);
    var number = phaseNumbers[phaseKey];
    var count = watchedCount(phaseKey);
    var done = videosDone(phaseKey);
    var active = lessons.find(function (lesson) { return lesson.id === activeId; }) || lessons[0];
    var activeWatched = readBool(watchedKey(active.id));
    if (done) {
      return '<section class="ws-section" id="lessons"><div class="ws-collapsed" data-rewatch-toggle><span class="ws-video-toggle-icon">&#9654;</span><div><h3>Watch the Lessons</h3><p>All ' + lessons.length + ' watched &middot; click to rewatch or change watched status</p></div><span class="ws-pill ws-pill-green">Done</span><span class="ws-context-toggle-icon" data-rewatch-symbol>+</span></div><div class="ws-rewatch" id="wsRewatch">' + rewatchPlayer(phaseKey, active.id) + '</div></section>';
    }
    var url = lessonUrl(active);
    var player = url ? renderIframe(url, active.title) : '<div class="ws-player-placeholder"><div class="ws-play-icon">&#9654;</div><h2>' + escapeHtml(active.title) + '</h2><p>Video coming soon</p></div>';
    var help = url ? videoAccessHelp(url) : "";
    return '<section class="ws-section ' + (activeWatched ? "ws-video-complete" : "") + '" id="lessons"><div class="ws-section-head"><h2>Watch the Lessons</h2><span class="ws-count">' + count + ' of ' + lessons.length + ' watched</span></div><div class="ws-player-card"><div class="ws-player">' + player + '<div class="ws-player-meta"><span class="ws-kicker">Lesson ' + (lessons.indexOf(active) + 1) + ' of ' + lessons.length + ' &middot; Phase ' + number + '</span><h3>' + escapeHtml(active.title) + '</h3></div></div><div class="ws-player-actions">' + lessonWatchActionHtml(active, activeWatched) + '</div>' + help + '<div class="ws-rail-wrap">' + lessonRail(phaseKey, active.id, false) + '</div></div></section>';
  }

  function lessonWatchActionHtml(lesson, watched) {
    return watched
      ? '<div class="ws-player-action-text"><strong>Lesson marked complete.</strong><span>You can mark it not watched if this was a mistake. MP already earned is kept.</span></div><button class="ws-button ws-button-secondary" type="button" data-watch-id="' + lesson.id + '">Mark not watched</button>'
      : '<div class="ws-player-action-text"><strong>Finished watching?</strong><span>Mark this lesson complete to save progress and earn ' + VIDEO_COMPLETE_MP + ' MP once.</span></div><button class="ws-button" type="button" data-watch-id="' + lesson.id + '">Mark lesson complete</button>';
  }

  function lessonRail(phaseKey, activeId, asLinks) {
    var lessons = orderedLessons(phaseKey);
    return '<p class="ws-scroll-hint">Scroll lessons &rarr;</p><div class="ws-lesson-rail">' + lessons.map(function (lesson, index) {
      var watched = readBool(watchedKey(lesson.id));
      var tileClass = 'ws-lesson-tile ' + (watched ? "ws-watched " : "") + (lesson.id === activeId ? "ws-active" : "");
      var content = '<span class="ws-lesson-check" data-watch-id="' + lesson.id + '" role="button" tabindex="0" aria-label="Toggle watched status">&#10003;</span><strong>Lesson ' + (index + 1) + '</strong><span>' + escapeHtml(lesson.title) + '</span><small>' + escapeHtml(lesson.duration) + '</small>';
      if (asLinks) {
        var url = lessonUrl(lesson);
        return url ? '<a class="' + tileClass + '" href="' + escapeHtml(sanitizeMediaUrl(url)) + '" target="_blank" rel="noopener">' + content + '</a>' : '<div class="' + tileClass + '">' + content + '</div>';
      }
      return '<button class="' + tileClass + '" data-lesson-id="' + lesson.id + '">' + content + '</button>';
    }).join("") + '</div>';
  }

  function rewatchPlayer(phaseKey, activeId) {
    var lessons = orderedLessons(phaseKey);
    var active = lessons.find(function (lesson) { return lesson.id === activeId; }) || lessons[0];
    var url = lessonUrl(active);
    var player = url ? renderIframe(url, active.title) : '<div class="ws-player-placeholder"><div class="ws-play-icon">&#9654;</div><h2>' + escapeHtml(active.title) + '</h2><p>Video coming soon</p></div>';
    var help = url ? videoAccessHelp(url) : "";
    return '<div class="ws-player-card"><div class="ws-player">' + player + '<div class="ws-player-meta"><span class="ws-kicker">Rewatch lesson</span><h3>' + escapeHtml(active.title) + '</h3></div></div><div class="ws-player-actions">' + lessonWatchActionHtml(active, readBool(watchedKey(active.id))) + '</div>' + help + '<div class="ws-rail-wrap">' + lessonRail(phaseKey, active.id, false) + '</div></div>';
  }

  function orientationContextSection() {
    var contexts = UTL_CONTENT.orientation.contexts || [];
    if (!contexts.length) return "";
    return '<section class="ws-section"><div class="ws-section-head"><h2>Orientation context</h2><span class="ws-count">' + contexts.length + ' sections</span></div><div class="ws-exercise-stack">' + contexts.map(function (context) {
      if (context.id === "orientation-welcome" && localStorage.getItem("utl_ctx_open_" + context.id) === null) {
        writeBool("utl_ctx_open_" + context.id, true);
      }
      return contextBlock(context);
    }).join("") + '</div></section>';
  }

  function introContextSection(phaseKey) {
    var contexts = getPhase(phaseKey).introContexts || [];
    if (!contexts.length) return "";
    return '<div class="ws-exercise-stack ws-intro-contexts">' + contexts.map(function (context) {
      return phaseContextCard(phaseKey + "-" + context.id, context, true);
    }).join("") + '</div>';
  }

  function exerciseSection(phaseKey) {
    var phase = getPhase(phaseKey);
    var doneVideos = videosDone(phaseKey);
    return '<section class="ws-section ws-exercises" id="exercises"><div class="ws-section-head"><h2>Practice the Exercises</h2><span class="ws-count">' + phase.exercises.filter(function (exercise) { return exerciseDone(exercise); }).length + ' of ' + phase.exercises.length + ' done</span></div>' + introContextSection(phaseKey) + '<div class="ws-exercise-stack">' + phase.exercises.map(function (exercise) {
      return exerciseUnit(phaseKey, exercise, doneVideos);
    }).join("") + '</div></section>';
  }

  function phaseContextCard(cardId, context, defaultOpen) {
    return contextOnlyPracticeCard("practice-" + cardId, context, defaultOpen);
  }

  function contextBlock(context) {
    return '<article class="ws-unit">' + contextPanelHtml(context) + '</article>';
  }

  function contextPanelHtml(context, defaultOpen) {
    var contextType = exerciseContextType(context);
    var contextUrl = exerciseContextUrl(context);
    var open = localStorage.getItem("utl_ctx_open_" + context.id) === null && typeof defaultOpen === "boolean" ? defaultOpen : readBool("utl_ctx_open_" + context.id);
    var media = "";
    if (contextType === "video") {
      media = contextUrl ? '<div class="ws-context-embed">' + renderEmbeddedMedia(contextUrl, context.contextTitle) + '</div>' : '<div class="ws-media-row ws-missing"><span class="ws-media-icon">&#9654;</span><span>Context video coming soon</span></div>';
    } else if (contextType === "slides") {
      media = contextUrl ? '<div class="ws-context-embed">' + renderEmbeddedMedia(contextUrl, context.contextTitle) + '</div>' : '<div class="ws-media-row ws-missing"><span class="ws-media-icon">&#9635;</span><span>Slides coming soon</span></div>';
    }
    return '<button class="ws-context-toggle" type="button" data-context-toggle="' + context.id + '" aria-expanded="' + (open ? "true" : "false") + '"><span class="ws-context-toggle-icon">' + (open ? "&minus;" : "+") + '</span><span><span class="ws-context-toggle-title">' + escapeHtml(context.contextTitle) + '</span><span class="ws-context-toggle-sub">Read before starting</span></span></button><div class="ws-context-panel ' + (open ? "ws-open" : "") + '" data-context-panel="' + context.id + '"><div class="ws-context-panel-inner"><p>' + escapeHtml(context.contextBody) + '</p>' + media + '</div></div>';
  }

  function exerciseUnit(phaseKey, exercise, enabled) {
    return phaseExerciseCard(phaseKey, exercise, enabled);
  }

  function stackedExerciseUnit(phaseKey, exercises, enabled) {
    var items = exercises.filter(Boolean);
    return items.map(function (exercise) {
      return phaseExerciseCard(phaseKey, exercise, enabled);
    }).join("");
  }

  function phaseExerciseCard(phaseKey, exercise, enabled) {
    var done = exerciseDone(exercise);
    var next = nextExerciseTarget(phaseKey);
    var isNext = next && next.id === exercise.id;
    var cardId = "practice-" + phaseKey + "-" + exercise.id;
    var open = practiceOpenState(cardId, enabled && isNext, done);
    var actionLabel = enabled ? (done ? "Go to exercise" : "Start exercise") : "Watch all videos to unlock";
    var actionHtml = enabled
      ? '<a class="ws-button ws-button-navy" href="' + escapeHtml(appHref(exercise.appUrl)) + '" data-exercise-visit="' + exercise.id + '">' + actionLabel + ' &rarr;</a>'
      : '<span class="ws-button ws-disabled">' + actionLabel + '</span>';
    return '<article class="ws-practice-card ' + (done ? "ws-complete " : "") + (!done && isNext ? "ws-next-card " : "") + (open ? "ws-open" : "") + '" data-practice-card="' + cardId + '">' +
      '<button class="ws-practice-head" type="button" data-practice-toggle="' + cardId + '"><span class="ws-practice-chevron">' + (open ? "&minus;" : "+") + '</span><span><span class="ws-practice-status-row"><span class="ws-card-role">Exercise</span></span><h3>' + escapeHtml(exercise.title) + '</h3><p>' + escapeHtml(done ? "Complete. Open this card if you want to review or redo it." : exercise.description) + '</p></span><span class="ws-practice-state">' + practiceCardCheck(done) + practiceCardStatus(done, isNext) + '</span></button>' +
      '<div class="ws-practice-body"><div class="ws-before-block"><h4>Before you start</h4><p>' + escapeHtml(exercise.contextBody) + '</p></div>' + mediaPreview(exercise) + '<div class="ws-card-actions">' + contextCompletionAction(exercise) + actionHtml + (enabled && done ? '<button class="ws-mark-incomplete" type="button" data-exercise-done="' + exercise.id + '">Mark incomplete</button>' : "") + '</div></div>' +
    '</article>';
  }

  function bottomPhaseNav(phaseKey) {
    var index = phases.indexOf(phaseKey);
    var prevHref = index === 0 ? "orientation.html" : phaseFiles[phases[index - 1]];
    var prevLabel = index === 0 ? "&larr; Orientation" : "&larr; " + phaseLabels[phases[index - 1]];
    var done = exercisesDone(phaseKey);
    if (phaseKey === "phase3") {
      return '<nav class="ws-bottom-nav"><a class="ws-button ws-button-secondary" href="' + prevHref + '">' + prevLabel + '</a>' + (done ? '<a class="ws-button" href="../my-results/index.html">You\'re done. View your results &rarr;</a>' : '<span class="ws-button ws-disabled" title="Complete the exercises to continue">You\'re done. View your results &rarr;</span>') + '</nav>';
    }
    var nextKey = phases[index + 1];
    return '<nav class="ws-bottom-nav"><a class="ws-button ws-button-secondary" href="' + prevHref + '">' + prevLabel + '</a>' + (done ? '<a class="ws-button" href="' + phaseFiles[nextKey] + '">' + phaseLabels[nextKey] + ': ' + getPhase(nextKey).title + ' &rarr;</a>' : '<span class="ws-button ws-disabled" title="Complete the exercises to continue">' + phaseLabels[nextKey] + ': ' + getPhase(nextKey).title + ' &rarr;</span>') + '</nav>';
  }

  function bindPhasePage(phaseKey) {
    var rewatch = qs("[data-rewatch-toggle]");
    if (rewatch) {
      rewatch.addEventListener("click", function () {
        var panel = qs("#wsRewatch");
        var symbol = qs("[data-rewatch-symbol]");
        if (!panel) return;
        var open = !panel.classList.contains("ws-open");
        panel.classList.toggle("ws-open", open);
        if (symbol) symbol.innerHTML = open ? "&minus;" : "+";
      });
    }
    bindContextToggles();
    bindPracticeCardToggles();
    bindContextCompletionButtons();
    qsa("[data-lesson-id]").forEach(function (button) {
      button.addEventListener("click", function () {
        var wasRewatch = !!button.closest("#wsRewatch");
        sessionStorage.setItem("utl_active_lesson_" + phaseKey, button.getAttribute("data-lesson-id"));
        renderPhasePage(phaseKey);
        if (wasRewatch) {
          setTimeout(function () {
            var toggle = qs("[data-rewatch-toggle]");
            var panel = qs("#wsRewatch");
            if (panel) panel.classList.add("ws-open");
            if (toggle) toggle.scrollIntoView({ block: "start" });
          }, 0);
        }
      });
    });
    qsa("[data-watch-id]").forEach(function (button) {
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        var lessonId = button.getAttribute("data-watch-id");
        var key = watchedKey(lessonId);
        var wasWatched = readBool(key);
        var nowWatched = !wasWatched;
        var lesson = orderedLessons(phaseKey).find(function (item) { return item.id === lessonId; });
        var reward = null;
        writeBool(key, nowWatched);
        if (nowWatched) {
          reward = awardRewardEvent({
            id: "video:" + lessonId,
            type: "video-completed",
            title: lesson ? lesson.title : "Lesson video",
            mp: VIDEO_COMPLETE_MP
          });
        }
        videosDone(phaseKey);
        queueRemoteProgressSave();
        renderPhasePage(phaseKey);
        if (nowWatched && reward && reward.awarded) {
          setTimeout(function () {
            showWorkspaceRewardMoment({
              label: "Lesson complete",
              title: "+" + reward.mpEarned + " MP earned",
              body: "Your progress was saved. Total MP: " + reward.total + ".",
              startMp: reward.startTotal,
              newTotal: reward.total,
              previousLevel: rewardLevelForMp(reward.startTotal),
              currentLevel: rewardLevelForMp(reward.total),
              showLevelModal: rewardLevelForMp(reward.startTotal) !== rewardLevelForMp(reward.total)
            });
          }, 80);
        } else if (wasWatched) {
          setTimeout(function () {
            showWorkspaceRewardMoment({
              label: "Progress updated",
              title: "Marked not watched",
              body: "Your lesson progress changed. Any MP already earned is kept.",
              startMp: readRewardState().mpTotal,
              newTotal: readRewardState().mpTotal
            });
          }, 80);
        }
      });
      button.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        button.click();
      });
    });
    qsa("[data-watch-all]").forEach(function (button) {
      button.addEventListener("click", function () {
        var totalAwarded = 0;
        var totalMp = readRewardState().mpTotal;
        var startingMp = totalMp;
        getPhase(button.getAttribute("data-watch-all")).lessons.forEach(function (lesson) {
          var wasWatched = readBool(watchedKey(lesson.id));
          writeBool(watchedKey(lesson.id), true);
          if (!wasWatched) {
            var reward = awardRewardEvent({
              id: "video:" + lesson.id,
              type: "video-completed",
              title: lesson.title,
              mp: VIDEO_COMPLETE_MP
            });
            if (reward.awarded) {
              totalAwarded += reward.mpEarned;
              totalMp = reward.total;
            }
          }
        });
        videosDone(phaseKey);
        queueRemoteProgressSave();
        renderPhasePage(phaseKey);
        if (totalAwarded > 0) {
          setTimeout(function () {
            showWorkspaceRewardMoment({
              label: "Lessons complete",
              title: "+" + totalAwarded + " MP earned",
              body: "New video completion rewards were added. Total MP: " + totalMp + ".",
              startMp: startingMp,
              newTotal: totalMp,
              previousLevel: rewardLevelForMp(startingMp),
              currentLevel: rewardLevelForMp(totalMp),
              showLevelModal: rewardLevelForMp(startingMp) !== rewardLevelForMp(totalMp)
            });
          }, 80);
        }
      });
    });
    qsa("[data-watch-reset]").forEach(function (button) {
      button.addEventListener("click", function () {
        getPhase(button.getAttribute("data-watch-reset")).lessons.forEach(function (lesson) {
          localStorage.removeItem(watchedKey(lesson.id));
        });
        writeBool(phaseVideosDoneKey(phaseKey), false);
        queueRemoteProgressSave();
        renderPhasePage(phaseKey);
      });
    });
    bindExerciseVisitLinks();
    qsa("[data-exercise-done]").forEach(function (button) {
      button.addEventListener("click", function () {
        var id = button.getAttribute("data-exercise-done");
        var exercise = getPhase(phaseKey).exercises.find(function (item) { return item.id === id; });
        if (!exercise) return;
        writeExerciseDone(exercise, !exerciseDone(exercise));
        exercisesDone(phaseKey);
        queueRemoteProgressSave();
        renderPhasePage(phaseKey);
      });
    });
  }

  function bindContextToggles() {
    qsa("[data-context-toggle]").forEach(function (button) {
      button.addEventListener("click", function () {
        var id = button.getAttribute("data-context-toggle");
        var panel = qs('[data-context-panel="' + id + '"]');
        var icon = button.querySelector(".ws-context-toggle-icon");
        var open = !(panel && panel.classList.contains("ws-open"));
        writeBool("utl_ctx_open_" + id, open);
        if (panel) panel.classList.toggle("ws-open", open);
        button.setAttribute("aria-expanded", open ? "true" : "false");
        if (icon) icon.innerHTML = open ? "&minus;" : "+";
      });
    });
  }

  function adminNavHtml(activeTab) {
    const tabs = [
      { key: "content-manager", label: "Content Manager" },
      { key: "student-progress", label: "Student Progress" },
      { key: "member-management", label: "Member Management" }
    ];
    return `
      <nav class="ws-admin-tabs" aria-label="Admin sections">
        ${tabs.map(tab => `
          <a href="${adminHref()}?tab=${tab.key}" class="ws-admin-tab ${activeTab === tab.key ? 'ws-active' : ''}">
            ${tab.label}
          </a>
        `).join('')}
      </nav>
    `;
  }

  function bindAdminTabs() {
    qsa(".ws-admin-tab").forEach(button => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const tabKey = new URL(event.currentTarget.href).searchParams.get("tab");
        window.history.pushState({}, '', `${adminHref()}?tab=${tabKey}`);
        renderAdminContent(tabKey);
      });
    });
  }

  async function renderAdminContent(activeTab) {
    const mount = qs("#adminTabContent");
    if (!mount) return;

    let content = '';
    if (activeTab === "content-manager") {
      content = renderContentManagerTabHtml();
    } else if (activeTab === "student-progress") {
      try {
        const firebase = await import(firebaseHref());
        const allProgress = await firebase.getAllMemberWorkspaceProgress();
        content = renderStudentProgressTabHtml(allProgress);
      } catch (error) {
        console.error("Failed to load student progress:", error);
        content = `<p class="ws-message ws-error">Failed to load student progress: ${escapeHtml(error.message)}</p>`;
      }
    } else if (activeTab === "member-management") {
      content = renderMemberManagementTabHtml();
    } else {
      // Default to content manager if tab is unknown
      content = renderContentManagerTabHtml();
    }
    mount.innerHTML = content;
    // Rebind specific handlers for the newly rendered content
    if (activeTab === "content-manager") {
      bindAdminContentManager(); // Assuming a function to bind content manager specific events
    }
  }

  // This is the original bindAdmin function, renamed and called when content manager tab is active
  function bindAdminContentManager() {
    qsa("[data-visibility-phase]").forEach(function (checkbox) {
      checkbox.addEventListener("change", function () {
        var key = checkbox.getAttribute("data-visibility-phase");
        localStorage.setItem(key, key === "utl_admin_preview_bypass" ? (checkbox.checked ? "on" : "off") : (checkbox.checked ? "show" : "hide"));
      });
    });
    qsa(".ws-admin-toggle").forEach(function (button) {
      button.addEventListener("click", function () {
        var phase = button.closest(".ws-admin-phase");
        phase.classList.toggle("ws-open");
        var icon = button.querySelector(".ws-disclosure-icon");
        if (icon) icon.innerHTML = phase.classList.contains("ws-open") ? "&minus;" : "+";
      });
    });
    qsa("[data-type-buttons]").forEach(function (group) {
      group.addEventListener("click", function (event) {
        var button = event.target.closest("[data-type]");
        if (!button) return;
        var id = group.getAttribute("data-type-buttons");
        var type = button.getAttribute("data-type");
        localStorage.setItem("utl_ctx_type_" + id, type);
        qsa(".ws-type-button", group).forEach(function (item) { item.classList.toggle("ws-selected", item === button); });
        var row = group.parentElement.querySelector(".ws-save-row");
        if (row) row.style.display = type === "text" ? "none" : "flex";
      });
    });
    qsa("[data-save-field]").forEach(function (button) {
      button.addEventListener("click", function () {
        saveField(button);
      });
    });
    var saveAll = qs("#wsSaveAll");
    if (saveAll) {
      saveAll.addEventListener("click", function () {
        qsa("[data-storage-key]").forEach(function (input) {
          localStorage.setItem(input.getAttribute("data-storage-key"), input.value.trim());
        });
        saveAll.textContent = "Saved";
        setTimeout(function () { saveAll.textContent = "Save all changes"; }, 1500);
      });
    }
  }

  function renderAdmin() {
    injectStyles();
    var needsPassword = localStorage.getItem(ADMIN_KEY) !== "true";
    var acceptedPassword = localStorage.getItem(ADMIN_PASSWORD_KEY) || DEFAULT_ADMIN_PASSWORD;
    if (needsPassword) {
      document.body.classList.add("ws-page"); // Ensure ws-page class is added for styling
      document.body.innerHTML = '<section class="ws-login-wrap"><article class="ws-login-card"><span class="ws-kicker">Admin</span><h1 class="ws-title">Admin Console.</h1><p class="ws-subtitle">Enter the admin password to access the management tools.</p><form class="ws-form" id="wsAdminLogin"><label for="wsAdminPassword">Admin password</label><input class="ws-input" id="wsAdminPassword" type="password" required><button class="ws-button" type="submit">Open admin</button><p class="ws-message" id="wsAdminMessage"></p></form></article></section>';
      qs("#wsAdminLogin").addEventListener("submit", function (event) {
        event.preventDefault();
        if (qs("#wsAdminPassword").value === acceptedPassword) {
          localStorage.setItem(ADMIN_KEY, "true");
          writeBool(SESSION_KEY, true);
          localStorage.setItem(USER_KEY, "admin");
          localStorage.setItem(PROFILE_KEY, JSON.stringify({ email: "admin", displayName: "admin", role: "admin" }));
          renderAdmin();
        } else {
          qs("#wsAdminMessage").textContent = "That admin password did not work.";
        }
      });
      return;
    }

    const urlParams = new URLSearchParams(window.location.search); // Get URL parameters
    const activeTab = urlParams.get('tab') || 'content-manager'; // Default to content-manager

    document.body.classList.add("ws-page");
    document.body.innerHTML = `
      <header class="ws-nav">${navHtml("admin")}</header>
      <main class="ws-main">
        <div class="ws-shell">
          ${adminNavHtml(activeTab)}
          <div id="adminTabContent"></div>
        </div>
      </main>`;
    bindNav(); // Bind the main nav (for profile menu) - this is already called in pageShell, but good to ensure here.
    bindAdminTabs(); // Bind the new admin tab navigation events
    renderAdminContent(activeTab); // Render content for the active tab
  }

  function visibilityHtml() {
    var phase2Visible = localStorage.getItem("utl_phase2_status") !== "hide";
    var phase3Visible = localStorage.getItem("utl_phase3_status") !== "hide";
    var previewUnlocked = localStorage.getItem("utl_admin_preview_bypass") === "on";
    return '<section class="ws-admin-visibility"><span class="ws-kicker">Learner release gates</span><label class="ws-check-row"><input type="checkbox" data-visibility-phase="utl_phase2_status" ' + (phase2Visible ? "checked" : "") + '><span>Release Phase 2 after Phase 1 is complete</span></label><p class="ws-help">Use this to hold Phase 2 until its videos, context, and exercises are ready. Learners still need to complete Phase 1 before it opens.</p><label class="ws-check-row"><input type="checkbox" data-visibility-phase="utl_phase3_status" ' + (phase3Visible ? "checked" : "") + '><span>Release Phase 3 after Phase 2 is complete</span></label><p class="ws-help">Use this to hold Phase 3 until its videos, context, and exercises are ready. Learners still need to complete Phase 2 before it opens.</p><label class="ws-check-row"><input type="checkbox" data-visibility-phase="utl_admin_preview_bypass" ' + (previewUnlocked ? "checked" : "") + '><span>Unlock all phases for admin preview</span></label><p class="ws-help">For admins only. When on, Phase 2 and Phase 3 open immediately while you preview the member area.</p></section>';
  }

  function renderContentManagerTabHtml() {
    // Existing content manager HTML
    var orientation = '<article class="ws-admin-phase ws-open"><button class="ws-admin-toggle" type="button"><span class="ws-admin-num">00</span><span><span class="ws-kicker">Orientation</span><strong>Welcome</strong><br><small>2 context sections &middot; 0 exercises</small></span><span class="ws-disclosure-icon">&minus;</span></button><div class="ws-admin-body"><p class="ws-help">Orientation is context-only and has no separate lesson video.</p></div></article>';

    return `
      <section class="ws-admin-section">
      <span class="ws-kicker">Content Manager</span>
      <h1 class="ws-title">Manage videos and context</h1>
      <p class="ws-subtitle">Update video URLs and context links for each phase. Paste a Google Drive share link or Vimeo URL. Changes are saved to your browser and override the defaults.</p>
      ${visibilityHtml()}
      <section class="ws-admin-grid">
    ` + phases.map(function (phaseKey) {
      var phase = getPhase(phaseKey);
      return '<article class="ws-admin-phase"><button class="ws-admin-toggle" type="button"><span class="ws-admin-num">0' + phaseNumbers[phaseKey] + '</span><span><span class="ws-kicker">' + phaseLabels[phaseKey] + '</span><strong>' + escapeHtml(phase.title) + '</strong><br><small>' + phase.lessons.length + ' lessons &middot; ' + phase.exercises.length + ' exercises</small></span><span class="ws-disclosure-icon">+</span></button><div class="ws-admin-body"><h3>Lesson videos</h3>' + phase.lessons.map(function (lesson, index) {
        return '<div class="ws-slot"><div class="ws-slot-head"><strong>Lesson ' + (index + 1) + ': ' + escapeHtml(lesson.title) + '</strong><span class="ws-pill ws-pill-muted">' + escapeHtml(lesson.duration) + '</span></div><div class="ws-save-row"><input class="ws-input" data-storage-key="utl_url_' + lesson.id + '" placeholder="Paste Google Drive or Vimeo URL" value="' + escapeHtml(lessonUrl(lesson)) + '"><button class="ws-button ws-button-navy" data-save-field type="button">Save</button></div><span class="ws-save-note"></span></div>';
      }).join("") + '<h3>Exercise context</h3>' + phase.exercises.map(function (exercise) {
        return adminExerciseSlot(exercise);
      }).join("") + '</div></article>';
    }).join("") + orientation + `
      </section>
      <div class="ws-save-bar">
        <div class="ws-shell ws-save-bar-inner">
          <span class="ws-count">Changes are saved per field and take effect immediately.</span>
          <button class="ws-button" id="wsSaveAll">Save all changes</button>
        </div>
      </div>
    `;
  }

  function adminExerciseSlot(exercise) {
    var selected = exerciseContextType(exercise);
    var url = exerciseContextUrl(exercise);
    return '<div class="ws-slot" data-admin-exercise="' + exercise.id + '"><div class="ws-slot-head"><strong>' + escapeHtml(exercise.title) + '</strong><span class="ws-pill ws-pill-gold">' + escapeHtml(exercise.type) + '</span></div><div class="ws-type-buttons" data-type-buttons="' + exercise.id + '">' + ["video", "slides", "text"].map(function (type) {
      return '<button class="ws-type-button ' + (selected === type ? "ws-selected" : "") + '" data-type="' + type + '" type="button">' + (type === "text" ? "Text only" : type[0].toUpperCase() + type.slice(1)) + '</button>';
    }).join("") + '</div><div class="ws-save-row ' + (selected === "text" ? "ws-hidden" : "") + '"><input class="ws-input" data-storage-key="utl_ctx_url_' + exercise.id + '" placeholder="Paste Google Drive or Vimeo URL" value="' + escapeHtml(url) + '"><button class="ws-button ws-button-navy" data-save-field type="button">Save</button></div><span class="ws-save-note"></span></div>';
  }

  function renderStudentProgressTabHtml(allProgress) {
    if (!allProgress || allProgress.length === 0) {
      return '<p class="ws-help">No member progress data available yet.</p>';
    }

    const phaseTitles = {
      orientation: "Orientation",
      phase1: "Phase 1",
      phase2: "Phase 2",
      phase3: "Phase 3",
      assessments: "Assessments"
    };

    const headerRow = `
      <thead>
        <tr>
          <th>Member</th>
          <th>Last Active</th>
          ${Object.keys(phaseTitles).map(key => `<th>${phaseTitles[key]}</th>`).join('')}
          <th>Actions</th>
        </tr>
      </thead>
    `;

    const bodyRows = allProgress.map(member => {
      const lastActive = member.lastSeenAt ? new Date(member.lastSeenAt.toDate()).toLocaleDateString() : 'N/A';
      const memberName = member.displayName || member.email;
      const memberEmail = member.email;

      const phaseProgressCells = Object.keys(phaseTitles).map(phaseKey => {
        if (phaseKey === 'assessments') {
          const diag = member.workspaceProgress?.exercises?.['utl_result_tsa_diagnostic']?.completed;
          const check = member.workspaceProgress?.exercises?.['utl_result_tsa_checkpoint']?.completed;
          return `<td>
            <span class="ws-progress-dot ${diag ? 'ws-dot-solid' : 'ws-dot-pending'}" title="Diagnostic"></span>
            <span class="ws-progress-dot ${check ? 'ws-dot-solid' : 'ws-dot-pending'}" title="Checkpoint"></span>
          </td>`;
        }

        const lessonsInPhase = LESSONS[phaseKey]?.length || 0;
        const exercisesInPhase = APPS.filter(app => app.phase === phaseNumbers[phaseKey]).length || 0;

        const watchedLessons = lessonsInPhase > 0 ? (Object.values(member.workspaceProgress?.lessons || {}).filter(l => l.watched && LESSONS[phaseKey].some(lesson => lesson.id === l.id)).length) : 0;
        const completedExercises = exercisesInPhase > 0 ? (Object.values(member.workspaceProgress?.exercises || {}).filter(e => e.completed && APPS.some(app => app.id === e.appKey && app.phase === phaseNumbers[phaseKey])).length) : 0;

        const videoDots = Array(lessonsInPhase).fill(0).map((_, i) => {
          const lessonId = LESSONS[phaseKey][i]?.id;
          const isWatched = member.workspaceProgress?.lessons?.[lessonId]?.watched;
          return `<span class="ws-progress-dot ${isWatched ? 'ws-dot-solid' : 'ws-dot-pending'}" title="${LESSONS[phaseKey][i]?.title || 'Lesson'}"></span>`;
        }).join('');

        const exerciseDots = Array(exercisesInPhase).fill(0).map((_, i) => {
          const exerciseId = APPS.filter(app => app.phase === phaseNumbers[phaseKey])[i]?.id;
          const isCompleted = member.workspaceProgress?.exercises?.[exerciseId]?.completed;
          return `<span class="ws-progress-dot ${isCompleted ? 'ws-dot-solid' : 'ws-dot-pending'}" title="${APPS.filter(app => app.phase === phaseNumbers[phaseKey])[i]?.name || 'Exercise'}"></span>`;
        }).join('');

        return `<td>
          <div class="ws-progress-dots-group">${videoDots}</div>
          <div class="ws-progress-dots-group">${exerciseDots}</div>
        </td>`;
      }).join('');

      return `
        <tr>
          <td>${escapeHtml(memberName)}<br><small>${escapeHtml(memberEmail)}</small></td>
          <td>${lastActive}</td>
          ${phaseProgressCells}
          <td><button class="ws-button ws-button-secondary ws-button-small" onclick="alert('View details for ${escapeHtml(memberName)}')">View Details</button></td>
        </tr>
      `;
    }).join('');

    return `
      <section class="ws-admin-section">
        <span class="ws-kicker">Student Progress</span>
        <h1 class="ws-title">Member Learning Dashboard</h1>
        <p class="ws-subtitle">Overview of all member progress, including video watch status and exercise completion.</p>
        <div class="ws-admin-table-wrap">
          <table class="ws-admin-table">
            ${headerRow}
            <tbody>
              ${bodyRows}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderMemberManagementTabHtml() {
    return `
      <section class="ws-admin-section">
        <span class="ws-kicker">Member Management</span>
        <h1 class="ws-title">Manage Member Accounts</h1>
        <p class="ws-subtitle">Add, edit, or remove member access and roles.</p>
        <p class="ws-help">This section will contain the tools for managing individual member accounts.</p>
      </section>
    `;
  }

  function bindAdmin() {
    qsa("[data-visibility-phase]").forEach(function (checkbox) {
      checkbox.addEventListener("change", function () {
        var key = checkbox.getAttribute("data-visibility-phase");
        localStorage.setItem(key, key === "utl_admin_preview_bypass" ? (checkbox.checked ? "on" : "off") : (checkbox.checked ? "show" : "hide"));
      });
    });
    qsa(".ws-admin-toggle").forEach(function (button) {
      button.addEventListener("click", function () {
        var phase = button.closest(".ws-admin-phase");
        phase.classList.toggle("ws-open");
        var icon = button.querySelector(".ws-disclosure-icon");
        if (icon) icon.innerHTML = phase.classList.contains("ws-open") ? "&minus;" : "+";
      });
    });
    qsa("[data-type-buttons]").forEach(function (group) {
      group.addEventListener("click", function (event) {
        var button = event.target.closest("[data-type]");
        if (!button) return;
        var id = group.getAttribute("data-type-buttons");
        var type = button.getAttribute("data-type");
        localStorage.setItem("utl_ctx_type_" + id, type);
        qsa(".ws-type-button", group).forEach(function (item) { item.classList.toggle("ws-selected", item === button); });
        var row = group.parentElement.querySelector(".ws-save-row");
        if (row) row.style.display = type === "text" ? "none" : "flex";
      });
    });
    qsa("[data-save-field]").forEach(function (button) {
      button.addEventListener("click", function () {
        saveField(button);
      });
    });
    var saveAll = qs("#wsSaveAll");
    if (saveAll) {
      saveAll.addEventListener("click", function () {
        qsa("[data-storage-key]").forEach(function (input) {
          localStorage.setItem(input.getAttribute("data-storage-key"), input.value.trim());
        });
        saveAll.textContent = "Saved";
        setTimeout(function () { saveAll.textContent = "Save all changes"; }, 1500);
      });
    }
  }

  function saveField(button) {
    var slot = button.closest(".ws-slot");
    var input = slot.querySelector("[data-storage-key]");
    var note = slot.querySelector(".ws-save-note");
    if (input) localStorage.setItem(input.getAttribute("data-storage-key"), input.value.trim());
    if (note) {
      note.textContent = "Saved";
      setTimeout(function () { note.textContent = ""; }, 1500);
    }
  }

  window.UTL_CONTENT = UTL_CONTENT;
  window.UTLWorkspace = {
    renderIndex: renderIndex,
    renderOrientation: renderOrientation,
    renderPhasePage: renderPhasePage,
    renderPhasePracticePage: renderPhasePracticePage,
    renderAdmin: renderAdmin,
    getPhase: getPhase
  };
})();
