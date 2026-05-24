const UTL_CONTENT = {
  orientation: {
    videoUrl: "",
    contexts: [
      {
        id: "orientation-welcome",
        legacyEmbedKey: "utl_embed_orientation_welcome",
        contextType: "video",
        contextUrl: "https://drive.google.com/file/d/1_o8FmQXijNxUmUJpOJ3XgZ9hOUxcCiI1/view",
        contextTitle: "Your first day at MA",
        contextBody: "Welcome to the MA storyline. You are stepping into a Chief of Staff role where Aiko expects clarity, structure, and judgment from day one."
      },
      {
        id: "orientation-howto",
        legacyEmbedKey: "utl_embed_orientation_howto",
        contextType: "slides",
        contextUrl: "https://docs.google.com/presentation/d/1p0bvALYVQ_U-FGFfUx47W05sQuy4GQRka_-N079n9J0/edit?slide=id.g3e2ad370f6d_0_361",
        contextTitle: "How this program works",
        contextBody: "Use this orientation to understand the learning rhythm: watch the setup, read the context, complete the practice, and mark your progress as you go."
      }
    ]
  },
  phase1: {
    title: "Think Clearly",
    description: "Build clean structure before you communicate. Watch the lessons, then practice turning messy inputs into clear thinking.",
    lessons: [
      { id: "p1-l1", title: "KonMari for the Cluttered Mind", duration: "12 min", videoUrl: "" },
      { id: "p1-l2", title: "Rule of Three", duration: "9 min", videoUrl: "" },
      { id: "p1-l3", title: "Bolded Summary Phrase", duration: "11 min", videoUrl: "" },
      { id: "p1-l4", title: "Wait, What's the Problem Again?", duration: "14 min", videoUrl: "" },
      { id: "p1-l5", title: "Divide and Conquer", duration: "10 min", videoUrl: "" }
    ],
    exercises: [
      {
        id: "p1-e1",
        legacyDoneKey: "utl_p1_ex1_done",
        legacyEmbedKey: "utl_embed_p1_first_day",
        title: "Grocery List",
        type: "Sort & Bucket",
        description: "Apply MECE thinking by sorting a messy grocery list into clean, non-overlapping categories.",
        appUrl: "../apps/grocery-list/index.html",
        contextType: "video",
        contextUrl: "https://drive.google.com/file/d/1O9Uyc_3XmP4XfltPQJ7T-zPUba6fdiJJ/view?usp=vids_web",
        contextTitle: "Before your first day",
        contextBody: "You've just arrived in Tokyo for your new role at MA as CEO's Chief of Staff. Before jumping into onboarding, you need to get your personal life in order. Aiko expects clarity from day one."
      },
      {
        id: "p1-e2",
        legacyDoneKey: "utl_p1_ex2_done",
        legacyEmbedKey: "utl_embed_p1_ai_grocery",
        title: "Grocery List with AI",
        type: "AI Prompting",
        description: "Use AI to improve your grocery-list structure and compare the result against your own MECE logic.",
        appUrl: "../apps/grocery-list-ai/index.html",
        contextType: "slides",
        contextUrl: "https://docs.google.com/presentation/d/1p0bvALYVQ_U-FGFfUx47W05sQuy4GQRka_-N079n9J0/edit?slide=id.g3e2ad370f6d_0_717",
        contextTitle: "Try the same task with AI",
        contextBody: "Now that you have practiced sorting the list yourself, try the same task with AI and pay attention to what the prompt does or does not make clear."
      },
      {
        id: "p1-e3",
        legacyDoneKey: "utl_p1_ex3_done",
        legacyEmbedKey: "utl_embed_p1_message_desk",
        title: "Manager's Messy Notes",
        type: "Restructure",
        description: "Turn a disorganized voice memo into a structured, decision-ready response.",
        appUrl: "../apps/messy-notes/index.html",
        contextType: "video",
        contextUrl: "https://drive.google.com/file/d/1JpPDKz5RTyWFIJxUkeKSB5etP4W57Dax/view?usp=vids_web",
        contextTitle: "A message just landed on your desk",
        contextBody: "Your manager just sent a rambling voice memo before running into a meeting. Turn it into something decision-ready before she's back."
      },
      {
        id: "p1-e4",
        legacyDoneKey: "utl_p1_ex4_done",
        legacyEmbedKey: "utl_embed_p1_hugh_favour",
        title: "Rushed Voice Memo",
        type: "Voice Structure",
        description: "Practice converting a rushed spoken update into a clearer spoken response.",
        appUrl: "../apps/rushed-voice-memo/index.html",
        contextType: "video",
        contextUrl: "https://drive.google.com/file/d/1EZe8wYzQvic6DaFJwraixATYR6Kx18oM/view?usp=vids_web",
        contextTitle: "Hugh needs a favour",
        contextBody: "Hugh needs a favor and the information is messy. Your job is to slow the situation down and make the request easier to understand."
      },
      {
        id: "p1-e5",
        legacyDoneKey: "utl_p1_ex5_done",
        legacyEmbedKey: "utl_embed_p1_ai_memo",
        title: "Rushed Voice Memo with AI",
        type: "AI Practice",
        description: "Use AI to pressure-test and improve the structure of a rushed memo response.",
        appUrl: "../apps/rushed-voice-memo-ai/index.html",
        contextType: "slides",
        contextUrl: "https://docs.google.com/presentation/d/1p0bvALYVQ_U-FGFfUx47W05sQuy4GQRka_-N079n9J0/edit?slide=id.g3e2ad370f6d_0_1347",
        contextTitle: "Try the same memo with AI",
        contextBody: "Use the AI version to compare your own restructuring choices against another structured draft."
      },
      {
        id: "p1-e6",
        legacyDoneKey: "utl_p1_ex6_done",
        legacyEmbedKey: "utl_embed_p1_olympic_brainstorm",
        title: "Chalkboard Notes",
        type: "Synthesis",
        description: "Sort a messy Olympic brainstorm into a clean, useful structure.",
        appUrl: "../apps/chalkboard-notes/index.html",
        contextType: "video",
        contextUrl: "https://drive.google.com/file/d/1kuQ7yqGvwjRnGufN4ZHMIAcqtdLq9NfN/view?usp=vids_web",
        contextTitle: "Aiko needs the Olympic brainstorm session sorted",
        contextBody: "Aiko needs the Olympic brainstorm session turned into something the team can use. Clean up the fragments and make the structure visible."
      }
    ]
  },
  phase2: {
    title: "Speak Concisely",
    description: "Move from structured thinking to sharp communication. Practice making the point first and making the logic easy to follow.",
    lessons: [
      { id: "p2-l1", title: "The Executive Storyline", duration: "13 min", videoUrl: "" },
      { id: "p2-l2", title: "Divide and Conquer", duration: "11 min", videoUrl: "" },
      { id: "p2-l3", title: "The Art of Persuasion", duration: "14 min", videoUrl: "" },
      { id: "p2-l4", title: "Bolded Summary Phrase (Advanced)", duration: "10 min", videoUrl: "" }
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
        legacyDoneKey: "utl_p2_ex1_done",
        legacyEmbedKey: "utl_embed_p2_aiko_question",
        title: "Issue Tree Builder",
        type: "Problem Breakdown",
        description: "Build an issue tree from a central question with hypothesis, arguments, and supporting details.",
        appUrl: "../apps/issue-tree-builder/index.html",
        contextType: "video",
        contextUrl: "https://drive.google.com/file/d/15AaNTTkiRsIVf90RfsmcSa3aEuFTqOAT/view?usp=vids_web",
        contextTitle: "Aiko liked your work. Now she has a question.",
        contextBody: "Aiko needs a clear breakdown of the project challenge before the team meeting. Your job is to structure the problem so she can make a decision."
      },
      {
        id: "p2-e2",
        legacyDoneKey: "utl_p2_ex2_done",
        legacyEmbedKey: "utl_embed_p2_frame_answer",
        title: "SCQA Builder",
        type: "Storyline",
        description: "Practice writing two SCQA formulations from a single context.",
        appUrl: "../apps/scqa-builder/index.html",
        contextType: "video",
        contextUrl: "https://drive.google.com/open?id=168tYlq9fRUKl7NrlELHuwAPwAxC2_5yD&usp=drive_copy",
        contextTitle: "Before you frame your answer",
        contextBody: "You need to send Aiko a concise update on the project status. Use the SCQA framework to structure your message so it lands immediately."
      },
      {
        id: "p2-e3",
        legacyDoneKey: "utl_p2_ex3_done",
        legacyEmbedKey: "utl_embed_p2_outside_perspectives",
        title: "Advisory board with AI",
        type: "AI Advisory Board",
        description: "Use AI to simulate outside perspectives before committing to a recommendation.",
        appUrl: "../apps/advisory-board/index.html",
        contextType: "slides",
        contextUrl: "https://docs.google.com/presentation/d/1p0bvALYVQ_U-FGFfUx47W05sQuy4GQRka_-N079n9J0/edit?slide=id.g3e2dc34c604_0_64",
        contextTitle: "Get outside perspectives before you commit",
        contextBody: "Before you lock in your answer, use outside perspectives to test what you may be missing."
      },
      {
        id: "p2-e4",
        legacyDoneKey: "utl_p2_ex4_done",
        legacyEmbedKey: "utl_embed_p2_aiko_email",
        title: "Write to Aiko",
        type: "Answer-First Email",
        description: "Write a concise, answer-first email to Aiko using your SCQA logic.",
        appUrl: "../apps/write-to-aiko/index.html",
        contextType: "video",
        contextUrl: "https://drive.google.com/open?id=1Tw0MhCjy5Tkdodjy8LvIEB-XEEuK4Di3&usp=drive_copy",
        contextTitle: "Aiko does not have time to read everything",
        contextBody: "Aiko needs the answer first. Turn your structure into a short email she can read quickly and act on."
      },
      {
        id: "p2-e5",
        legacyDoneKey: "utl_p2_ex5_done",
        legacyEmbedKey: "utl_embed_p2_hallway",
        title: "Explain to Aiko (120s)",
        type: "Spoken Explanation",
        description: "Prepare and record a 120-second spoken explanation of the same answer.",
        appUrl: "../apps/explain-to-aiko/index.html",
        contextType: "video",
        contextUrl: "https://drive.google.com/file/d/10b0x6cTO1rf3DYlTBbDm4tNQ4cirhWzh/view?usp=vids_web",
        contextTitle: "She bumped into you in the hallway",
        contextBody: "You do not have the luxury of a long memo. Explain the key points out loud in a clear, structured way."
      },
      {
        id: "p2-e6",
        legacyDoneKey: "utl_p2_ex6_done",
        legacyEmbedKey: "utl_embed_p2_compress",
        title: "Explain to Aiko (60s)",
        type: "Elevator Pitch",
        description: "Compress the same message into 60 seconds or less.",
        appUrl: "../apps/explain-to-aiko-60/index.html",
        contextType: "slides",
        contextUrl: "https://docs.google.com/presentation/d/1p0bvALYVQ_U-FGFfUx47W05sQuy4GQRka_-N079n9J0/edit?slide=id.g3e2dc34c604_0_430",
        contextTitle: "Now compress it",
        contextBody: "Now, instead of 120 seconds, see if you can deliver the key points in 60 seconds or less."
      }
    ]
  },
  phase3: {
    title: "Act Confidently",
    description: "Practice judgment under pressure. Decide what matters, read the room, and speak with steadiness when the stakes rise.",
    lessons: [
      { id: "p3-l1", title: "How to Read People", duration: "11 min", videoUrl: "" },
      { id: "p3-l2", title: "Let's Switch Hats", duration: "9 min", videoUrl: "" },
      { id: "p3-l3", title: "Speak Like Obama", duration: "13 min", videoUrl: "" },
      { id: "p3-l4", title: "The Art of Saying No", duration: "10 min", videoUrl: "" },
      { id: "p3-l5", title: "I Have Bad News...", duration: "12 min", videoUrl: "" }
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
        legacyDoneKey: "utl_p3_ex1_done",
        legacyEmbedKey: "utl_embed_p3_lead_role",
        title: "The Art of Saying No",
        type: "Prioritize",
        description: "Decide what to deprioritize when everything feels urgent.",
        appUrl: "../apps/eisenhower-matrix/index.html",
        contextType: "video",
        contextUrl: "https://drive.google.com/open?id=18UnP9dxWd31EeCfEfODiPBQ-Jfyxbd8Q&usp=drive_copy",
        contextTitle: "You just got the lead role.",
        contextBody: "Requests are coming from every direction and Aiko will not tell you what to prioritize. She expects you to decide."
      },
      {
        id: "p3-e2",
        legacyDoneKey: "utl_p3_ex2_done",
        legacyEmbedKey: "utl_embed_p3_bad_news",
        title: "I Have Bad News...",
        type: "Difficult Conversation",
        description: "Practice delivering hard news clearly while preserving trust.",
        appUrl: "../apps/i-have-bad-news/index.html",
        contextType: "video",
        contextUrl: "https://drive.google.com/file/d/1m04hT3TUZkaKZN8-f0zlWWOBLA1DS6fF/view?usp=vids_web",
        contextTitle: "You have to be the one to say it",
        contextBody: "Something has gone wrong, and you need to say it plainly without making the conversation worse."
      },
      {
        id: "p3-e3",
        legacyDoneKey: "utl_p3_ex3_done",
        legacyEmbedKey: "utl_embed_p3_read_room",
        title: "Let's Switch Hats",
        type: "Perspective Taking",
        description: "See the situation from the other person's side before deciding what to say.",
        appUrl: "../apps/lets-switch-hats/index.html",
        contextType: "video",
        contextUrl: "https://drive.google.com/file/d/1UVaAj5EG7Kg4c1uZhXaR0bqwasgtjQgS/view?usp=vids_web",
        contextTitle: "Read the room before you speak",
        contextBody: "Before pushing your point, understand the other person's constraints, incentives, and version of success."
      },
      {
        id: "p3-e4",
        legacyDoneKey: "utl_p3_ex4_done",
        legacyEmbedKey: "utl_embed_p3_eyes_on_you",
        title: "Speak Like Obama",
        type: "Executive Presence",
        description: "Practice speaking with rhythm, restraint, and conviction when all eyes are on you.",
        appUrl: "../apps/speak-like-obama/index.html",
        contextType: "video",
        contextUrl: "https://drive.google.com/file/d/1ndtAyGJpud5jDA5pLyYoGmqOJOeFabPO/view?usp=vids_web",
        contextTitle: "All eyes are on you",
        contextBody: "You have the room's attention. Practice making your message steady, memorable, and easy to follow."
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
  var phases = ["phase1", "phase2", "phase3"];
  var phaseNumbers = { phase1: 1, phase2: 2, phase3: 3 };
  var phaseLabels = { phase1: "Phase 1", phase2: "Phase 2", phase3: "Phase 3" };
  var phaseFiles = { phase1: "phase-1.html", phase2: "phase-2.html", phase3: "phase-3.html" };
  var phaseDescriptions = {
    phase1: "Learn to sort noise into signal.",
    phase2: "Turn structure into concise communication.",
    phase3: "Act with judgment when the answer is not obvious."
  };

  function inAdminRoot() {
    return /\/admin\/(?:index\.html)?$/.test(window.location.pathname);
  }

  function memberHref(file) {
    return inAdminRoot() ? "../member-login/" + file : file;
  }

  function appHref(path) {
    return inAdminRoot() ? path.replace(/^\.\.\//, "../") : path;
  }

  function homeHref() {
    return inAdminRoot() ? "../index.html" : "../index.html";
  }

  function adminHref() {
    return inAdminRoot() ? "index.html" : "../admin/index.html";
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

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
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

  function getPhase(key) {
    return UTL_CONTENT[key];
  }

  function orderedLessons(phaseKey) {
    var phase = getPhase(phaseKey);
    var lessons = (phase.lessons || []).slice();
    try {
      var order = JSON.parse(localStorage.getItem("utl_lesson_order_" + phaseKey) || "[]");
      if (Array.isArray(order) && order.length) {
        lessons.sort(function (a, b) {
          var aIndex = order.indexOf(a.id);
          var bIndex = order.indexOf(b.id);
          return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
        });
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
    return localStorage.getItem("utl_url_" + lesson.id) || lesson.videoUrl || "";
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
    if (phaseKey === "phase2") return localStorage.getItem("utl_phase2_status") !== "hide";
    if (phaseKey === "phase3") return localStorage.getItem("utl_phase3_status") !== "hide";
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

  function renderIframe(url, title) {
    var src = sanitizeMediaUrl(url);
    if (!src) return "";
    return '<iframe src="' + escapeHtml(src) + '" title="' + escapeHtml(title || "Video Player") + '" frameborder="0" scrolling="no" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe>';
  }

  function injectStyles() {
    if (document.getElementById("utl-workspace-styles")) return;
    var style = document.createElement("style");
    style.id = "utl-workspace-styles";
    style.textContent = [
      "@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Lato:wght@300;400;700&family=Roboto+Mono:wght@400;500;700&display=swap');",
      ":root{--ws-navy:#003366;--ws-gold:#EEA320;--ws-cream:#F3EDE2;--ws-charcoal:#4A4A4A;--ws-steel:#4D7094;--ws-white:#FFFFFF;--ws-line:#E3D8C8;--ws-green:#2C7A4B;}",
      "*{box-sizing:border-box}",
      "body.ws-page{margin:0;min-height:100vh;background:var(--ws-cream);color:var(--ws-charcoal);font-family:Lato,sans-serif;overflow-x:hidden}",
      ".ws-shell{width:min(1120px,calc(100% - 40px));margin:0 auto}",
      ".ws-hidden{display:none}",
      ".ws-nav{position:sticky;top:0;z-index:30;background:var(--ws-navy);color:var(--ws-white);box-shadow:0 10px 28px rgba(0,51,102,.14)}",
      ".ws-nav-inner{height:54px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:22px;width:min(1180px,calc(100% - 32px));margin:0 auto}",
      ".ws-brand{display:flex;align-items:center;gap:14px;min-width:0}.ws-logo-link{display:flex;align-items:center;border-radius:6px}.ws-logo-link:hover,.ws-workspace-link:hover{background:rgba(238,163,32,.18)}.ws-logo{height:31px;width:auto;display:block}.ws-brand-sep,.ws-nav-divider{width:1px;height:22px;background:rgba(255,255,255,.28)}.ws-workspace-link{color:rgba(255,255,255,.72);font:700 10px/1.1 'Roboto Mono',monospace;letter-spacing:.08em;text-transform:uppercase;padding:7px;border-radius:6px;text-decoration:none}",
      ".ws-links{display:flex;align-items:center;justify-content:center;gap:12px;min-width:0}.ws-link{min-height:54px;display:inline-flex;align-items:center;border-bottom:3px solid transparent;color:rgba(255,255,255,.68);font:700 10.5px 'Roboto Mono',monospace;letter-spacing:.08em;text-transform:uppercase;text-decoration:none;white-space:nowrap}.ws-link:hover,.ws-link.ws-active{color:var(--ws-white);border-bottom-color:var(--ws-gold)}.ws-sep{color:rgba(255,255,255,.32);font-family:'Roboto Mono',monospace}",
      ".ws-user{position:relative;display:flex;align-items:center;gap:10px;justify-content:flex-end}.ws-user-email{max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(255,255,255,.68);font:700 10px 'Roboto Mono',monospace;letter-spacing:.06em}.ws-avatar{width:36px;height:36px;border-radius:999px;border:0;background:var(--ws-gold);color:var(--ws-navy);display:grid;place-items:center;font:700 12px 'Roboto Mono',monospace;cursor:pointer;overflow:hidden;padding:0}.ws-avatar img,.ws-profile-avatar img{width:100%;height:100%;object-fit:cover;display:block}.ws-profile-menu{position:absolute;right:0;top:46px;width:236px;background:#fff;color:var(--ws-charcoal);border:1px solid var(--ws-line);border-radius:9px;box-shadow:0 18px 40px rgba(0,51,102,.22);padding:0;z-index:50;overflow:hidden}.ws-profile-menu:before{content:'';position:absolute;top:-8px;right:18px;width:16px;height:16px;background:var(--ws-navy);transform:rotate(45deg)}.ws-profile-menu[hidden]{display:none}.ws-profile-head{position:relative;display:flex;align-items:center;gap:13px;background:var(--ws-navy);color:#fff;padding:14px 16px 13px;border-bottom:3px solid var(--ws-gold)}.ws-profile-avatar{width:46px;height:46px;border-radius:999px;background:var(--ws-gold);color:var(--ws-navy);display:grid;place-items:center;overflow:hidden;font:700 14px 'Roboto Mono',monospace;flex:0 0 auto}.ws-profile-name{margin:0;color:#fff;font-size:15px;font-weight:700;line-height:1.15}.ws-profile-role{margin:4px 0 0;color:var(--ws-gold);font:700 9.5px 'Roboto Mono',monospace;letter-spacing:.12em;text-transform:uppercase}.ws-profile-section{padding:11px 16px 10px;border-bottom:1px solid var(--ws-line)}.ws-profile-section:last-child{border-bottom:0}.ws-profile-section-label{display:block;margin:0 0 7px;color:var(--ws-gold);font:700 9.5px 'Roboto Mono',monospace;letter-spacing:.12em;text-transform:uppercase}.ws-profile-menu a,.ws-profile-menu button{width:100%;min-height:36px;display:flex;align-items:center;gap:12px;border:0;background:transparent;color:var(--ws-navy);font:700 14px Lato,sans-serif;text-align:left;text-decoration:none;cursor:pointer;padding:4px 0}.ws-profile-menu a:hover,.ws-profile-menu button:hover{text-decoration:underline}.ws-profile-icon{width:18px;color:var(--ws-steel);display:inline-flex;justify-content:center;font-size:16px;line-height:1}.ws-profile-menu .ws-admin-link .ws-profile-icon{color:var(--ws-gold)}.ws-profile-menu .ws-logout{color:var(--ws-steel)}",
      ".ws-main{padding:54px 0 72px}.ws-kicker{display:inline-flex;color:var(--ws-gold);font:700 11px 'Roboto Mono',monospace;letter-spacing:.1em;text-transform:uppercase}.ws-title{margin:10px 0 12px;color:var(--ws-navy);font:700 clamp(40px,6vw,66px)/.98 'Playfair Display',serif}.ws-subtitle{max-width:760px;margin:0;color:var(--ws-steel);font-size:18px;line-height:1.55}",
      ".ws-login-wrap{min-height:calc(100vh - 54px);display:grid;place-items:center;padding:48px 20px}.ws-login-card{width:min(460px,100%);background:#fff;border:1px solid var(--ws-line);border-radius:12px;padding:30px;box-shadow:0 18px 45px rgba(0,51,102,.1)}.ws-login-card .ws-subtitle{font-size:17px}.ws-form{display:grid;gap:12px;margin-top:24px}.ws-form label{color:var(--ws-navy);font-weight:700}.ws-login-divider{display:flex;align-items:center;gap:12px;margin:18px 0;color:var(--ws-steel);font:700 10px 'Roboto Mono',monospace;letter-spacing:.08em;text-transform:uppercase}.ws-login-divider:before,.ws-login-divider:after{content:'';height:1px;background:var(--ws-line);flex:1}.ws-input,.ws-textarea,.ws-select{width:100%;min-height:46px;border:1px solid rgba(0,51,102,.22);border-radius:8px;padding:10px 12px;background:#fff;color:var(--ws-charcoal);font:400 15px Lato,sans-serif}.ws-textarea{min-height:88px;resize:vertical}.ws-message{min-height:20px;margin:0;color:#8A1F1F;font-weight:700}.ws-message.ws-success{color:var(--ws-green)}.ws-google-button{min-height:40px;width:auto;gap:9px;background:#fff;border:1px solid #747775;border-radius:999px;color:#1f1f1f;text-transform:none;font:700 13px Arial,sans-serif;letter-spacing:0;padding:0 15px 0 11px}.ws-google-button:hover{background:#f8fafd;filter:none}.ws-google-mark{position:relative;width:18px;height:18px;border-radius:999px;background:conic-gradient(from -45deg,#4285F4 0 25%,#34A853 0 50%,#FBBC05 0 75%,#EA4335 0 100%);display:inline-block;flex:0 0 auto}.ws-google-mark:before{content:'';position:absolute;inset:4px;background:#fff;border-radius:999px}.ws-google-mark:after{content:'';position:absolute;right:0;top:7px;width:9px;height:4px;background:#4285F4;border-radius:0 2px 2px 0}",
      ".ws-button{min-height:44px;border-radius:8px;border:1px solid var(--ws-gold);background:var(--ws-gold);color:var(--ws-navy);font:700 13px 'Roboto Mono',monospace;letter-spacing:.04em;text-transform:uppercase;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;padding:0 18px;cursor:pointer}.ws-button:hover{filter:brightness(.97)}.ws-button[disabled],.ws-button.ws-disabled{opacity:.45;cursor:not-allowed;filter:grayscale(.2)}.ws-button-secondary{background:#fff;border-color:rgba(0,51,102,.28);color:var(--ws-navy)}.ws-button-navy{background:var(--ws-navy);border-color:var(--ws-navy);color:#fff}",
      ".ws-progress-card{margin:34px 0 24px;background:#fff;border:1px solid var(--ws-line);border-radius:12px;padding:18px}.ws-progress-row{display:flex;justify-content:space-between;gap:16px;color:var(--ws-navy);font:700 11px 'Roboto Mono',monospace;letter-spacing:.08em;text-transform:uppercase}.ws-progress-track{height:12px;background:#EFE6D8;border-radius:999px;margin-top:12px;overflow:hidden}.ws-progress-fill{height:100%;background:linear-gradient(90deg,var(--ws-gold),#f4c15c);border-radius:999px}",
      ".ws-phase-list{display:grid;gap:18px}.ws-phase-card{position:relative;display:grid;grid-template-columns:8px 92px 1fr auto;align-items:center;gap:22px;min-height:178px;background:#fff;border:1px solid var(--ws-line);border-radius:12px;overflow:hidden;padding:22px 24px 22px 0;text-decoration:none;color:inherit;box-shadow:0 12px 28px rgba(0,51,102,.06)}.ws-phase-card.ws-locked{opacity:.72}.ws-phase-stripe{align-self:stretch;background:var(--ws-gold)}.ws-locked .ws-phase-stripe{background:#9AAFC3}.ws-phase-number{color:rgba(0,51,102,.08);font:700 74px/1 'Playfair Display',serif;text-align:center}.ws-phase-content h2{margin:6px 0;color:var(--ws-navy);font:700 34px/1.05 'Playfair Display',serif}.ws-phase-content p{margin:0;color:var(--ws-steel);line-height:1.45}.ws-trail{display:flex;align-items:center;gap:8px;margin-top:16px;color:var(--ws-navy);font:700 10px 'Roboto Mono',monospace;text-transform:uppercase;letter-spacing:.07em}.ws-dot{width:10px;height:10px;border-radius:99px;background:var(--ws-gold)}.ws-arrow{color:var(--ws-steel)}.ws-pill{display:inline-flex;align-items:center;border-radius:999px;padding:5px 9px;font:700 10px 'Roboto Mono',monospace;letter-spacing:.06em;text-transform:uppercase}.ws-pill-gold{background:rgba(238,163,32,.18);color:var(--ws-navy)}.ws-pill-muted{background:#E8EEF4;color:var(--ws-steel)}.ws-pill-green{background:rgba(44,122,75,.12);color:var(--ws-green)}.ws-phase-actions{display:grid;gap:10px;justify-items:end}",
      ".ws-stepper{display:flex;gap:10px;margin:28px 0;align-items:center}.ws-step{display:flex;align-items:center;gap:8px;border:0;border-bottom:2px solid var(--ws-line);background:transparent;padding:8px 2px;color:var(--ws-steel);font:700 11px 'Roboto Mono',monospace;text-transform:uppercase;letter-spacing:.06em}.ws-step.ws-active{border-bottom-color:var(--ws-navy);color:var(--ws-navy)}.ws-step.ws-done{border-bottom-color:var(--ws-green);color:var(--ws-green)}",
      ".ws-section{margin-top:30px}.ws-section-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:14px}.ws-section-head h2{margin:0;color:var(--ws-navy);font:700 31px 'Playfair Display',serif}.ws-count{color:var(--ws-steel);font:700 11px 'Roboto Mono',monospace;text-transform:uppercase;letter-spacing:.08em}",
      ".ws-player-card{background:#fff;border:1px solid var(--ws-line);border-radius:12px;overflow:hidden}.ws-player{position:relative;aspect-ratio:16/9;background:linear-gradient(135deg,#002448,#003366 55%,#244F78);display:grid;place-items:center;color:#fff}.ws-player iframe{position:absolute;inset:0;width:100%;height:100%;border:0}.ws-player-placeholder{text-align:center;padding:22px}.ws-play-icon{width:58px;height:58px;border-radius:999px;background:var(--ws-gold);color:var(--ws-navy);display:grid;place-items:center;margin:0 auto 14px;font-size:24px}.ws-player-meta{position:absolute;left:22px;bottom:20px;right:22px;text-shadow:0 2px 8px rgba(0,0,0,.35)}.ws-player-meta h3{margin:6px 0 0;color:#fff;font:700 25px 'Playfair Display',serif}.ws-player-actions{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px}",
      ".ws-rail-wrap{padding:22px 22px 24px;border-top:1px solid rgba(0,51,102,.08);background:#fff}.ws-scroll-hint{display:none;color:var(--ws-steel);font:700 10px 'Roboto Mono',monospace;letter-spacing:.08em;text-transform:uppercase;margin:0 0 8px}.ws-lesson-rail{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:14px}.ws-lesson-tile{min-height:108px;border:1px solid var(--ws-line);border-radius:10px;background:#fff;color:var(--ws-navy);padding:14px 38px 14px 14px;text-align:left;cursor:pointer}.ws-lesson-tile.ws-active{background:var(--ws-navy);color:#fff}.ws-lesson-tile strong{display:block;font:700 10px 'Roboto Mono',monospace;letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px}.ws-lesson-tile span{display:block;font-size:13px;line-height:1.25}.ws-lesson-tile small{display:block;margin-top:9px;color:inherit;opacity:.75}.ws-check{color:var(--ws-gold);font-weight:700}",
      ".ws-collapsed{background:#fff;border:1px solid var(--ws-line);border-radius:12px;padding:18px;display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:14px;cursor:pointer}.ws-green-circle{width:34px;height:34px;border-radius:999px;background:var(--ws-green);color:#fff;display:grid;place-items:center;font-weight:700}.ws-video-toggle-icon{width:34px;height:34px;border-radius:9px;background:rgba(77,112,148,.16);color:var(--ws-navy);display:grid;place-items:center;font-size:16px;font-weight:700}.ws-collapsed h3{margin:0;color:var(--ws-navy);font:700 24px 'Playfair Display',serif}.ws-collapsed p{margin:2px 0 0;color:var(--ws-steel)}.ws-rewatch{display:none;background:#fff;border:1px solid var(--ws-line);border-top:0;border-radius:0 0 12px 12px;padding:22px}.ws-rewatch.ws-open{display:block}.ws-rewatch .ws-lesson-rail a{text-decoration:none}",
      ".ws-exercise-stack{display:grid;gap:20px}.ws-unit{border-radius:12px;overflow:hidden;box-shadow:0 12px 28px rgba(0,51,102,.06)}.ws-context{background:var(--ws-navy);color:#fff;padding:20px 22px}.ws-context-tag{color:var(--ws-gold);font:700 10px 'Roboto Mono',monospace;letter-spacing:.09em;text-transform:uppercase}.ws-context h3{margin:7px 0;color:#fff;font:700 27px 'Playfair Display',serif}.ws-context p{margin:0;color:rgba(255,255,255,.78);line-height:1.5}.ws-media-row{margin-top:14px;display:flex;align-items:center;gap:12px;border:1px solid rgba(255,255,255,.22);border-radius:10px;padding:11px;color:#fff;text-decoration:none}.ws-media-icon{width:34px;height:34px;border-radius:999px;background:var(--ws-gold);color:var(--ws-navy);display:grid;place-items:center;font-weight:700}.ws-media-row.ws-missing{opacity:.62;pointer-events:none}.ws-exercise-card{display:grid;grid-template-columns:1fr auto;gap:16px;background:#fff;border:1px solid var(--ws-line);border-top:0;padding:22px;text-decoration:none;color:inherit}.ws-exercise-card.ws-disabled{opacity:.55}.ws-exercise-card.ws-disabled a,.ws-exercise-card.ws-disabled button{pointer-events:none}.ws-exercise-card h3{margin:7px 0;color:var(--ws-navy);font:700 28px 'Playfair Display',serif}.ws-exercise-card p{margin:0 0 14px;color:var(--ws-steel);line-height:1.45}.ws-open-link{font:700 11px 'Roboto Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--ws-navy)}.ws-mark-done{align-self:end}",
      ".ws-video-complete .ws-player-card,.ws-lesson-tile.ws-watched{border-color:var(--ws-green);box-shadow:0 0 0 2px rgba(44,122,75,.16)}.ws-lesson-tile{position:relative}.ws-lesson-check{position:absolute;top:8px;right:8px;width:20px;height:20px;border-radius:999px;border:1px solid rgba(0,51,102,.24);background:#fff;color:transparent;display:grid;place-items:center;font-size:12px;font-weight:700}.ws-lesson-tile.ws-watched .ws-lesson-check{background:var(--ws-green);border-color:var(--ws-green);color:#fff}.ws-video-check{position:absolute;top:14px;right:14px;width:30px;height:30px;border-radius:999px;border:1px solid rgba(255,255,255,.6);background:rgba(255,255,255,.9);color:transparent;display:grid;place-items:center;font-weight:700;z-index:2;cursor:pointer}.ws-video-complete .ws-video-check{background:var(--ws-green);border-color:var(--ws-green);color:#fff}",
      ".ws-context-toggle{width:100%;display:flex;align-items:center;gap:14px;border:0;border-radius:10px;background:#ded6c8;color:var(--ws-navy);padding:16px 18px;text-align:left;cursor:pointer}.ws-context-toggle-icon{width:30px;height:30px;border-radius:8px;background:var(--ws-gold);color:#fff;display:grid;place-items:center;font-size:24px;font-weight:700;line-height:1}.ws-context-toggle-title{display:block;color:var(--ws-navy);font-size:17px;font-weight:700}.ws-context-toggle-sub{display:block;color:var(--ws-steel);font-size:14px;margin-top:2px}.ws-context-panel{display:none;padding:18px 0 0}.ws-context-panel.ws-open{display:block}.ws-context-panel-inner{color:var(--ws-charcoal)}.ws-context-panel-inner p{margin:0 0 14px;color:var(--ws-charcoal);line-height:1.5}.ws-context-embed{margin-top:14px;border-radius:10px;overflow:hidden;background:#000;border:1px solid var(--ws-line)}.ws-context-embed iframe{display:block;width:100%;height:450px;border:0}.ws-fullscreen-link{display:block;padding:14px 22px 0;text-align:right;color:var(--ws-navy);font-weight:700;text-decoration:none}.ws-fullscreen-link:hover{text-decoration:underline}.ws-context-panel .ws-fullscreen-link{padding:0;margin-top:12px}.ws-context-panel .ws-media-row{background:var(--ws-navy);margin-top:14px}.ws-workbook-card{position:relative;margin-top:18px;background:#fff;border:1px solid var(--ws-line);border-radius:12px;padding:34px 36px;display:grid;gap:22px}.ws-workbook-card.ws-done{border:2px solid var(--ws-green)}.ws-workbook-card.ws-disabled{opacity:.56}.ws-workbook-card.ws-disabled a,.ws-workbook-card.ws-disabled button{pointer-events:none}.ws-workbook-top{display:flex;align-items:center;gap:12px;color:var(--ws-steel);font:700 14px 'Roboto Mono',monospace;letter-spacing:.14em;text-transform:uppercase}.ws-status-circle{width:28px;height:28px;border-radius:999px;background:#d9e4ee;color:var(--ws-steel);display:grid;place-items:center;font:700 14px Lato,sans-serif}.ws-workbook-card.ws-done .ws-status-circle{background:var(--ws-green);color:#fff}.ws-workbook-card h3{margin:0;color:var(--ws-navy);font:700 clamp(34px,5vw,54px)/1.02 'Playfair Display',serif}.ws-workbook-card p{max-width:780px;margin:0;color:var(--ws-steel);font-size:22px;line-height:1.35}.ws-card-actions{display:flex;gap:12px;flex-wrap:wrap}.ws-done-pill{display:inline-flex;align-items:center;gap:5px;background:rgba(44,122,75,.12);color:var(--ws-green);border-radius:999px;padding:4px 10px;font:700 12px Lato,sans-serif;letter-spacing:0;text-transform:none}",
      ".ws-admin-visibility{margin-top:30px;background:#fff;border:1px solid var(--ws-line);border-radius:12px;padding:18px;display:grid;gap:12px}.ws-check-row{display:flex;align-items:flex-start;gap:10px;color:var(--ws-navy);font-weight:700}.ws-check-row input{margin-top:3px}.ws-help{margin:0;color:var(--ws-steel);font-size:14px;line-height:1.45}",
      ".ws-bottom-nav{display:flex;justify-content:space-between;gap:12px;margin-top:34px}.ws-bottom-nav .ws-button{min-width:180px}.ws-admin-grid{display:grid;gap:16px;margin-top:30px}.ws-admin-phase{background:#fff;border:1px solid var(--ws-line);border-radius:12px;overflow:hidden}.ws-admin-toggle{width:100%;display:grid;grid-template-columns:74px 1fr auto;align-items:center;gap:16px;border:0;background:#fff;padding:18px;text-align:left;cursor:pointer}.ws-admin-num{color:rgba(0,51,102,.12);font:700 54px 'Playfair Display',serif}.ws-admin-body{display:none;padding:0 18px 18px}.ws-admin-phase.ws-open .ws-admin-body{display:block}.ws-slot{border-top:1px solid var(--ws-line);padding:16px 0;display:grid;gap:10px}.ws-slot-head{display:flex;justify-content:space-between;gap:12px}.ws-type-buttons{display:flex;gap:8px}.ws-type-button{border:1px solid rgba(0,51,102,.25);background:#fff;color:var(--ws-navy);border-radius:999px;padding:7px 10px;font:700 10px 'Roboto Mono',monospace;cursor:pointer}.ws-type-button.ws-selected{background:var(--ws-navy);color:#fff}.ws-save-row{display:flex;gap:8px}.ws-save-row .ws-input{background:#fbf7ef}.ws-save-note{min-height:18px;color:var(--ws-green);font:700 11px 'Roboto Mono',monospace}.ws-save-bar{position:sticky;bottom:0;background:#fff;border-top:1px solid var(--ws-line);padding:12px 0;margin-top:32px;box-shadow:0 -8px 20px rgba(0,51,102,.07)}.ws-save-bar-inner{display:flex;justify-content:space-between;align-items:center;gap:16px}",
      "@media(max-width:768px){.ws-shell{width:calc(100% - 32px)}.ws-nav-inner{height:auto;grid-template-columns:1fr auto;gap:0;width:100%;padding:0 12px}.ws-brand{height:54px}.ws-brand-sep,.ws-workspace-link{display:none}.ws-user{height:54px}.ws-links{grid-column:1/-1;justify-content:flex-start;overflow-x:auto;white-space:nowrap;gap:10px;border-top:1px solid rgba(255,255,255,.14);scrollbar-width:none}.ws-links::-webkit-scrollbar,.ws-lesson-rail::-webkit-scrollbar{display:none}.ws-link{min-height:44px;font-size:10px}.ws-user-email{display:none}.ws-main{padding:34px 0 48px}.ws-title{font-size:38px}.ws-subtitle{font-size:16px}.ws-phase-card{grid-template-columns:6px 54px 1fr;gap:14px;padding:18px 16px 18px 0}.ws-phase-actions{grid-column:2/-1;justify-items:start}.ws-phase-number{font-size:48px}.ws-phase-content h2{font-size:27px}.ws-stepper{flex-wrap:wrap}.ws-section-head{align-items:flex-start;flex-direction:column}.ws-player-actions{align-items:flex-start;flex-direction:column}.ws-scroll-hint{display:block}.ws-lesson-rail{display:flex;overflow-x:auto;gap:10px;padding-bottom:4px;scrollbar-width:none}.ws-lesson-tile{min-width:104px}.ws-collapsed{grid-template-columns:auto 1fr auto}.ws-collapsed .ws-pill{display:none}.ws-context-embed iframe{height:260px}.ws-workbook-card{padding:24px 20px}.ws-workbook-top{font-size:11px;letter-spacing:.1em}.ws-workbook-card h3{font-size:34px}.ws-workbook-card p{font-size:17px}.ws-card-actions .ws-button{width:100%}.ws-exercise-card{grid-template-columns:1fr}.ws-bottom-nav{flex-direction:row}.ws-bottom-nav .ws-button{min-width:0;flex:1;padding:0 10px;font-size:10px}.ws-admin-toggle{grid-template-columns:48px 1fr auto}.ws-save-bar-inner{flex-direction:column;align-items:stretch}.ws-save-row{flex-direction:column}}"
    ].join("\n");
    document.head.appendChild(style);
  }

  function pageShell(active, contentHtml) {
    injectStyles();
    document.body.classList.add("ws-page");
    document.body.innerHTML = navHtml(active) + '<main class="ws-main"><div class="ws-shell">' + contentHtml + "</div></main>";
    bindNav();
  }

  function navHtml(active) {
    var user = currentUser();
    var avatar = user.photoURL ? '<img src="' + escapeHtml(user.photoURL) + '" alt="">' : escapeHtml(user.initials);
    var roleLabel = user.role === "admin" ? "Administrator" : "Member";
    var adminSection = user.role === "admin" ? '<div class="ws-profile-section"><span class="ws-profile-section-label">Admin</span><a class="ws-admin-link" href="' + adminHref() + '"><span class="ws-profile-icon">&#9788;</span><span>Admin Console</span></a></div>' : "";
    var links = [
      { key: "orientation", label: "Orientation", href: memberHref("orientation.html") },
      { key: "phase1", label: "Phase 1", href: memberHref("phase-1.html") },
      { key: "phase2", label: "Phase 2", href: memberHref("phase-2.html"), hidden: localStorage.getItem("utl_phase2_status") === "hide" },
      { key: "phase3", label: "Phase 3", href: memberHref("phase-3.html"), hidden: localStorage.getItem("utl_phase3_status") === "hide" },
      { key: "assessments", label: "Assessments", href: memberHref("index.html") + "#assessments", hidden: localStorage.getItem("utl_tsa_status") === "hidden" }
    ].filter(function (link) { return !link.hidden; });
    if (active === "admin") links.push({ key: "admin", label: "Admin", href: adminHref() });
    return '<header class="ws-nav"><div class="ws-nav-inner">' +
      '<div class="ws-brand"><a class="ws-logo-link" href="' + homeHref() + '" aria-label="The Untaught Lessons home"><img class="ws-logo" src="../assets/utl-logo-nav-white.png" alt="The Untaught Lessons"></a><span class="ws-brand-sep"></span><a class="ws-workspace-link" href="' + memberHref("index.html") + '">Member Workspace</a></div>' +
      '<nav class="ws-links" aria-label="Member workspace">' + links.map(function (link, index) {
        return (index ? '<span class="ws-sep">|</span>' : "") + '<a class="ws-link ' + (active === link.key ? "ws-active" : "") + '" href="' + link.href + '">' + link.label + '</a>';
      }).join("") + '</nav>' +
      '<div class="ws-user"><span class="ws-user-email">' + escapeHtml(user.email) + '</span><button class="ws-avatar" type="button" aria-label="Open profile menu" aria-expanded="false">' + avatar + '</button><div class="ws-profile-menu" hidden><div class="ws-profile-head"><span class="ws-profile-avatar">' + avatar + '</span><div><p class="ws-profile-name">' + escapeHtml(user.label) + '</p><p class="ws-profile-role">' + roleLabel + '</p></div></div><div class="ws-profile-section"><span class="ws-profile-section-label">Your Space</span><a href="../my-results/index.html"><span class="ws-profile-icon">&#9638;</span><span>My Results</span></a><a href="../apps/toolkit/index.html"><span class="ws-profile-icon">&#8962;</span><span>Toolkit</span></a></div>' + adminSection + '<div class="ws-profile-section"><button class="ws-logout" type="button"><span class="ws-profile-icon">&#8618;</span><span>Log out</span></button></div></div></div>' +
      '</div></header>';
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
      qsa(".ws-profile-menu").forEach(function (menu) { menu.hidden = true; });
      qsa(".ws-avatar").forEach(function (button) { button.setAttribute("aria-expanded", "false"); });
    });
    qsa(".ws-logout").forEach(function (button) {
      button.addEventListener("click", function () {
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(ADMIN_KEY);
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem(PROFILE_KEY);
        window.location.href = memberHref("index.html");
      });
    });
  }

  function isMemberUnlocked() {
    return readBool(SESSION_KEY);
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
    if ((username === "admin" && password === "password123") || (username === "testuser" && password === "member2026")) {
      writeBool(SESSION_KEY, true);
      localStorage.setItem(USER_KEY, username);
      localStorage.setItem(PROFILE_KEY, JSON.stringify({ email: username, displayName: username, role: username === "admin" ? "admin" : "member" }));
      if (username === "admin") localStorage.setItem(ADMIN_KEY, "true");
      else localStorage.removeItem(ADMIN_KEY);
      window.location.href = "index.html";
      return;
    }
    message.textContent = "That password did not work.";
  }

  async function handleGoogleLogin(button, message) {
    if (!button || !message) return;
    var originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Connecting to Google...";
    message.textContent = "";
    message.classList.remove("ws-success");
    try {
      var firebaseAuth = await import("../assets/firebase.js");
      var credential = await firebaseAuth.signInWithGooglePopup();
      var member = await firebaseAuth.requireAuthorizedMember(credential.user);
      var email = credential.user && credential.user.email ? String(credential.user.email).trim().toLowerCase() : "";
      writeBool(SESSION_KEY, true);
      localStorage.setItem(USER_KEY, email || "member");
      localStorage.setItem(PROFILE_KEY, JSON.stringify({
        email: email || "member",
        displayName: credential.user && credential.user.displayName ? credential.user.displayName : email,
        photoURL: credential.user && credential.user.photoURL ? credential.user.photoURL : "",
        role: member && member.role ? member.role : "member"
      }));
      if (member && member.role === "admin") localStorage.setItem(ADMIN_KEY, "true");
      else localStorage.removeItem(ADMIN_KEY);
      message.classList.add("ws-success");
      message.textContent = "Signed in. Opening your workspace...";
      window.location.href = "index.html";
    } catch (error) {
      console.error("Google member login failed.", error);
      message.textContent = error && error.message ? error.message : "Google sign-in did not work.";
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  function renderIndex() {
    injectStyles();
    document.body.classList.add("ws-page");
    if (!isMemberUnlocked()) {
      document.body.innerHTML = '<section class="ws-login-wrap"><article class="ws-login-card"><span class="ws-kicker">Member Login</span><h1 class="ws-title">Welcome back.</h1><p class="ws-subtitle">Sign in to open your Untaught Lessons workspace.</p><form class="ws-form" id="wsLoginForm"><label for="wsUsername">Username or email</label><input class="ws-input" id="wsUsername" autocomplete="username" required><label for="wsPassword">Password</label><input class="ws-input" id="wsPassword" type="password" autocomplete="current-password" required><button class="ws-button" type="submit">Sign in</button><p class="ws-message" id="wsLoginMessage" aria-live="polite"></p></form><div class="ws-login-divider">Or</div><button class="ws-button ws-google-button" id="wsGoogleLogin" type="button"><span class="ws-google-mark" aria-hidden="true"></span><span>Sign in with Google</span></button></article></section>';
      qs("#wsLoginForm").addEventListener("submit", function (event) {
        event.preventDefault();
        handleLogin(event.currentTarget, qs("#wsLoginMessage"));
      });
      qs("#wsGoogleLogin").addEventListener("click", function (event) {
        event.preventDefault();
        handleGoogleLogin(event.currentTarget, qs("#wsLoginMessage"));
      });
      return;
    }
    var progress = allPhaseProgress();
    var visiblePhases = phases.filter(function (phaseKey) {
      return !(phaseKey === "phase2" && localStorage.getItem("utl_phase2_status") === "hide") && !(phaseKey === "phase3" && localStorage.getItem("utl_phase3_status") === "hide");
    });
    var cards = visiblePhases.map(function (phaseKey) {
      var number = phaseNumbers[phaseKey];
      var phase = getPhase(phaseKey);
      var unlocked = phaseUnlocked(phaseKey);
      var done = exercisesDone(phaseKey);
      var status = done ? "Done" : unlocked ? "In Progress" : "Locked";
      var pillClass = done ? "ws-pill-green" : unlocked ? "ws-pill-gold" : "ws-pill-muted";
      return '<article class="ws-phase-card ' + (unlocked ? "" : "ws-locked") + '"><div class="ws-phase-stripe"></div><div class="ws-phase-number">0' + number + '</div><div class="ws-phase-content"><span class="ws-kicker">' + phaseLabels[phaseKey] + '</span><h2>' + escapeHtml(phase.title) + '</h2><p>' + escapeHtml(phaseDescriptions[phaseKey]) + '</p><div class="ws-trail"><span class="ws-dot"></span>Watch<span class="ws-arrow">&rarr;</span><span class="ws-dot"></span>Practice</div></div><div class="ws-phase-actions"><span class="ws-pill ' + pillClass + '">' + status + '</span>' + (unlocked ? '<a class="ws-button" href="' + phaseFiles[phaseKey] + '">Continue</a>' : '<span class="ws-button ws-disabled">Locked</span>') + '</div></article>';
    }).join("");
    pageShell("workspace", '<span class="ws-kicker">Member Workspace</span><h1 class="ws-title">Your Learning Journey</h1><p class="ws-subtitle">Work through each phase in order - watch all the videos, then complete the exercises before moving on.</p><section class="ws-progress-card"><div class="ws-progress-row"><span>Overall progress</span><span>' + progress.done + ' of ' + progress.total + ' complete</span></div><div class="ws-progress-track"><div class="ws-progress-fill" style="width:' + progress.percent + '%"></div></div></section><section class="ws-phase-list">' + cards + '</section>' + assessmentsSection() + '<div style="margin-top:28px;display:flex;gap:12px;flex-wrap:wrap"><a class="ws-button ws-button-secondary" href="orientation.html">Start orientation</a><a style="align-self:center;color:var(--ws-steel);font:700 12px Lato,sans-serif;text-decoration:underline;text-underline-offset:2px" href="../admin/index.html">Admin</a></div>');
  }

  function assessmentsSection() {
    if (localStorage.getItem("utl_tsa_status") === "hidden") return "";
    return '<section class="ws-section" id="assessments"><div class="ws-section-head"><h2>Assessments</h2><span class="ws-count">TSA Score</span></div><div class="ws-phase-list"><article class="ws-phase-card"><div class="ws-phase-stripe"></div><div class="ws-phase-number">A</div><div class="ws-phase-content"><span class="ws-kicker">Assessment</span><h2>The Diagnostic</h2><p>Take the starting assessment when you are ready.</p></div><div class="ws-phase-actions"><a class="ws-button" href="../apps/tsa-diagnostic/index.html">Open</a></div></article><article class="ws-phase-card"><div class="ws-phase-stripe"></div><div class="ws-phase-number">B</div><div class="ws-phase-content"><span class="ws-kicker">Assessment</span><h2>The Checkpoint</h2><p>Return here after the practice sequence to compare progress.</p></div><div class="ws-phase-actions"><a class="ws-button ws-button-secondary" href="../apps/tsa-checkpoint/index.html">Open</a></div></article></div></section>';
  }

  function renderOrientation() {
    if (!requireMember()) return;
    pageShell("orientation", '<span class="ws-kicker">Orientation</span><h1 class="ws-title">Start here.</h1><p class="ws-subtitle">Get oriented to the MA storyline, the learning sequence, and how to move through the member workspace.</p>' + orientationContextSection() + '<nav class="ws-bottom-nav"><a class="ws-button ws-button-secondary" href="index.html">&larr; Dashboard</a><a class="ws-button" href="phase-1.html">Phase 1: Think Clearly &rarr;</a></nav>');
    bindContextToggles();
  }

  function phaseHeader(phaseKey) {
    var phase = getPhase(phaseKey);
    var number = phaseNumbers[phaseKey];
    var doneVideos = videosDone(phaseKey);
    return '<span class="ws-kicker">' + phaseLabels[phaseKey] + '</span><h1 class="ws-title">' + escapeHtml(phase.title) + '</h1><p class="ws-subtitle">' + escapeHtml(doneVideos ? "Videos done. Now apply what you learned." : phase.description) + '</p><div class="ws-stepper"><span class="ws-step ' + (doneVideos ? "ws-done" : "ws-active") + '">Step 1 Watch</span><span class="ws-step ' + (doneVideos ? "ws-active" : "") + '">Step 2 Practice</span></div>';
  }

  function renderPhasePage(phaseKey) {
    if (!requireMember()) return;
    if (!phaseUnlocked(phaseKey)) {
      pageShell(phaseKey, '<span class="ws-kicker">' + phaseLabels[phaseKey] + '</span><h1 class="ws-title">This phase is locked.</h1><p class="ws-subtitle">Complete the previous phase exercises to continue.</p><p style="margin-top:24px"><a class="ws-button" href="index.html">Back to dashboard</a></p>');
      return;
    }
    var activeId = sessionStorage.getItem("utl_active_lesson_" + phaseKey) || getPhase(phaseKey).lessons[0].id;
    pageShell(phaseKey, phaseHeader(phaseKey) + videoSection(phaseKey, activeId) + exerciseSection(phaseKey) + bottomPhaseNav(phaseKey));
    bindPhasePage(phaseKey);
  }

  function videoSection(phaseKey, activeId) {
    var phase = getPhase(phaseKey);
    var lessons = orderedLessons(phaseKey);
    var number = phaseNumbers[phaseKey];
    var count = watchedCount(phaseKey);
    var done = videosDone(phaseKey);
    var active = lessons.find(function (lesson) { return lesson.id === activeId; }) || lessons[0];
    var activeWatched = readBool(watchedKey(active.id));
    var fullscreen = lessonFullscreenLink(active);
    if (done) {
      return '<section class="ws-section"><div class="ws-collapsed" data-rewatch-toggle><span class="ws-video-toggle-icon">&#9654;</span><div><h3>Watch the Lessons</h3><p>All ' + lessons.length + ' watched &middot; click to rewatch</p></div><span class="ws-pill ws-pill-green">Done</span><span class="ws-context-toggle-icon" data-rewatch-symbol>+</span></div><div class="ws-rewatch" id="wsRewatch">' + rewatchPlayer(phaseKey, active.id) + '</div></section>';
    }
    var url = lessonUrl(active);
    var player = url ? renderIframe(url, active.title) : '<div class="ws-player-placeholder"><div class="ws-play-icon">&#9654;</div><h2>' + escapeHtml(active.title) + '</h2><p>Video coming soon</p></div>';
    return '<section class="ws-section ' + (activeWatched ? "ws-video-complete" : "") + '"><div class="ws-section-head"><h2>Watch the Lessons</h2><span class="ws-count">' + count + ' of ' + lessons.length + ' watched</span></div><div class="ws-player-card"><div class="ws-player">' + player + '<div class="ws-player-meta"><span class="ws-kicker">Lesson ' + (lessons.indexOf(active) + 1) + ' of ' + lessons.length + ' &middot; Phase ' + number + '</span><h3>' + escapeHtml(active.title) + '</h3></div></div>' + fullscreen + '<div class="ws-rail-wrap">' + lessonRail(phaseKey, active.id, false) + '</div></div></section>';
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
    return '<div class="ws-player-card"><div class="ws-player">' + player + '<div class="ws-player-meta"><span class="ws-kicker">Rewatch lesson</span><h3>' + escapeHtml(active.title) + '</h3></div></div>' + lessonFullscreenLink(active) + '<div class="ws-rail-wrap">' + lessonRail(phaseKey, active.id, false) + '</div></div>';
  }

  function lessonFullscreenLink(lesson) {
    var url = lessonUrl(lesson);
    if (!url) return "";
    return '<a class="ws-fullscreen-link" href="' + escapeHtml(sanitizeMediaUrl(url)) + '" target="_blank" rel="noopener">Open in a new screen &nearr;</a>';
  }

  function orientationContextSection() {
    var contexts = UTL_CONTENT.orientation.contexts || [];
    if (!contexts.length) return "";
    return '<section class="ws-section"><div class="ws-section-head"><h2>Orientation Context</h2><span class="ws-count">' + contexts.length + ' sections</span></div><div class="ws-exercise-stack">' + contexts.map(function (context) {
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
      return contextBlock(context);
    }).join("") + '</div>';
  }

  function exerciseSection(phaseKey) {
    var phase = getPhase(phaseKey);
    var doneVideos = videosDone(phaseKey);
    return '<section class="ws-section ws-exercises"><div class="ws-section-head"><h2>Practice the Exercises</h2><span class="ws-count">' + phase.exercises.filter(function (exercise) { return exerciseDone(exercise); }).length + ' of ' + phase.exercises.length + ' done</span></div>' + introContextSection(phaseKey) + '<div class="ws-exercise-stack">' + phase.exercises.map(function (exercise) {
      return exerciseUnit(phaseKey, exercise, doneVideos);
    }).join("") + '</div></section>';
  }

  function contextBlock(context) {
    var contextType = exerciseContextType(context);
    var contextUrl = exerciseContextUrl(context);
    var open = readBool("utl_ctx_open_" + context.id);
    var media = "";
    if (contextType === "video") {
      media = contextUrl ? '<div class="ws-context-embed">' + renderIframe(contextUrl, context.contextTitle) + '</div><a class="ws-fullscreen-link" href="' + escapeHtml(sanitizeMediaUrl(contextUrl)) + '" target="_blank" rel="noopener">Open in full screen &nearr;</a>' : '<div class="ws-media-row ws-missing"><span class="ws-media-icon">&#9654;</span><span>Context video coming soon</span></div>';
    } else if (contextType === "slides") {
      media = contextUrl ? '<div class="ws-context-embed">' + renderIframe(contextUrl, context.contextTitle) + '</div><a class="ws-fullscreen-link" href="' + escapeHtml(sanitizeMediaUrl(contextUrl)) + '" target="_blank" rel="noopener">Open in full screen &nearr;</a>' : '<div class="ws-media-row ws-missing"><span class="ws-media-icon">&#9635;</span><span>Slides coming soon</span></div>';
    }
    return '<article class="ws-unit"><button class="ws-context-toggle" type="button" data-context-toggle="' + context.id + '" aria-expanded="' + (open ? "true" : "false") + '"><span class="ws-context-toggle-icon">' + (open ? "&minus;" : "+") + '</span><span><span class="ws-context-toggle-title">' + escapeHtml(context.contextTitle) + '</span><span class="ws-context-toggle-sub">Read before starting</span></span></button><div class="ws-context-panel ' + (open ? "ws-open" : "") + '" data-context-panel="' + context.id + '"><div class="ws-context-panel-inner"><p>' + escapeHtml(context.contextBody) + '</p>' + media + '</div></div></article>';
  }

  function exerciseUnit(phaseKey, exercise, enabled) {
    var contextType = exerciseContextType(exercise);
    var contextUrl = exerciseContextUrl(exercise);
    var done = exerciseDone(exercise);
    var open = readBool("utl_ctx_open_" + exercise.id);
    var media = "";
    if (contextType === "video") {
      media = contextUrl ? '<div class="ws-context-embed">' + renderIframe(contextUrl, exercise.contextTitle) + '</div><a class="ws-fullscreen-link" href="' + escapeHtml(sanitizeMediaUrl(contextUrl)) + '" target="_blank" rel="noopener">Open in full screen &nearr;</a>' : '<div class="ws-media-row ws-missing"><span class="ws-media-icon">&#9654;</span><span>Context video coming soon</span></div>';
    } else if (contextType === "slides") {
      media = contextUrl ? '<div class="ws-context-embed">' + renderIframe(contextUrl, exercise.contextTitle) + '</div><a class="ws-fullscreen-link" href="' + escapeHtml(sanitizeMediaUrl(contextUrl)) + '" target="_blank" rel="noopener">Open in full screen &nearr;</a>' : '<div class="ws-media-row ws-missing"><span class="ws-media-icon">&#9635;</span><span>Slides coming soon</span></div>';
    }
    return contextBlock(exercise).replace("</article>", '<div class="ws-workbook-card ' + (done ? "ws-done " : "") + (enabled ? "" : "ws-disabled") + '"><div class="ws-workbook-top"><span class="ws-status-circle">' + (done ? "&#10003;" : phaseNumbers[phaseKey]) + '</span><span>' + phaseLabels[phaseKey] + ' | ' + escapeHtml(getPhase(phaseKey).title) + '</span>' + (done ? '<span class="ws-done-pill"><span>&#10003;</span><span>Done</span></span>' : "") + '</div><h3>' + escapeHtml(exercise.title) + '</h3><p>' + escapeHtml(exercise.description) + '</p><div class="ws-card-actions"><a class="ws-button" href="' + escapeHtml(exercise.appUrl) + '" data-exercise-visit="' + exercise.id + '">' + (enabled ? "Open tool" : "Watch all videos to unlock") + '</a>' + (enabled ? '<button class="ws-button ws-button-secondary" type="button" data-exercise-done="' + exercise.id + '">' + (done ? "Click to undo" : "Mark as done") + '</button>' : "") + '</div></div></article>');
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
        var key = watchedKey(button.getAttribute("data-watch-id"));
        writeBool(key, !readBool(key));
        videosDone(phaseKey);
        renderPhasePage(phaseKey);
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
        getPhase(button.getAttribute("data-watch-all")).lessons.forEach(function (lesson) {
          writeBool(watchedKey(lesson.id), true);
        });
        videosDone(phaseKey);
        renderPhasePage(phaseKey);
      });
    });
    qsa("[data-watch-reset]").forEach(function (button) {
      button.addEventListener("click", function () {
        getPhase(button.getAttribute("data-watch-reset")).lessons.forEach(function (lesson) {
          localStorage.removeItem(watchedKey(lesson.id));
        });
        writeBool(phaseVideosDoneKey(phaseKey), false);
        renderPhasePage(phaseKey);
      });
    });
    qsa("[data-exercise-visit]").forEach(function (link) {
      link.addEventListener("click", function () {
        writeBool(visitedKey(link.getAttribute("data-exercise-visit")), true);
      });
    });
    qsa("[data-exercise-done]").forEach(function (button) {
      button.addEventListener("click", function () {
        var id = button.getAttribute("data-exercise-done");
        var exercise = getPhase(phaseKey).exercises.find(function (item) { return item.id === id; });
        if (!exercise) return;
        writeExerciseDone(exercise, !exerciseDone(exercise));
        exercisesDone(phaseKey);
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

  function renderAdmin() {
    injectStyles();
    var needsPassword = localStorage.getItem(ADMIN_KEY) !== "true";
    var acceptedPassword = localStorage.getItem(ADMIN_PASSWORD_KEY) || DEFAULT_ADMIN_PASSWORD;
    if (needsPassword) {
      document.body.classList.add("ws-page");
      document.body.innerHTML = '<section class="ws-login-wrap"><article class="ws-login-card"><span class="ws-kicker">Admin</span><h1 class="ws-title">Content manager.</h1><p class="ws-subtitle">Enter the admin password to manage member workspace URLs.</p><form class="ws-form" id="wsAdminLogin"><label for="wsAdminPassword">Admin password</label><input class="ws-input" id="wsAdminPassword" type="password" required><button class="ws-button" type="submit">Open admin</button><p class="ws-message" id="wsAdminMessage"></p></form></article></section>';
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
    pageShell("admin", '<span class="ws-pill ws-pill-gold">Admin &middot; Content Manager</span><h1 class="ws-title">Manage Videos & Context</h1><p class="ws-subtitle">Update video URLs and context links for each phase. Paste a Google Drive share link or Vimeo URL. Changes are saved to your browser and override the defaults.</p>' + visibilityHtml() + '<section class="ws-admin-grid">' + adminAccordionHtml() + '</section><div class="ws-save-bar"><div class="ws-shell ws-save-bar-inner"><span class="ws-count">Changes are saved per field and take effect immediately.</span><button class="ws-button" id="wsSaveAll">Save all changes</button></div></div>');
    bindAdmin();
  }

  function visibilityHtml() {
    var phase2Visible = localStorage.getItem("utl_phase2_status") !== "hide";
    var phase3Visible = localStorage.getItem("utl_phase3_status") !== "hide";
    return '<section class="ws-admin-visibility"><span class="ws-kicker">Visibility</span><label class="ws-check-row"><input type="checkbox" data-visibility-phase="utl_phase2_status" ' + (phase2Visible ? "checked" : "") + '><span>Allow Phase 2 to appear when unlocked</span></label><p class="ws-help">Phase 2 appears once Phase 1 exercises are complete and this box is checked.</p><label class="ws-check-row"><input type="checkbox" data-visibility-phase="utl_phase3_status" ' + (phase3Visible ? "checked" : "") + '><span>Allow Phase 3 to appear when unlocked</span></label><p class="ws-help">Phase 3 appears once Phase 2 exercises are complete and this box is checked.</p></section>';
  }

  function adminAccordionHtml() {
    var orientation = '<article class="ws-admin-phase ws-open"><button class="ws-admin-toggle" type="button"><span class="ws-admin-num">00</span><span><span class="ws-kicker">Orientation</span><strong>Welcome</strong><br><small>2 context sections &middot; 0 exercises</small></span><span>v</span></button><div class="ws-admin-body"><p class="ws-help">Orientation is context-only and has no separate lesson video.</p></div></article>';
    return orientation + phases.map(function (phaseKey) {
      var phase = getPhase(phaseKey);
      return '<article class="ws-admin-phase"><button class="ws-admin-toggle" type="button"><span class="ws-admin-num">0' + phaseNumbers[phaseKey] + '</span><span><span class="ws-kicker">' + phaseLabels[phaseKey] + '</span><strong>' + escapeHtml(phase.title) + '</strong><br><small>' + phase.lessons.length + ' lessons &middot; ' + phase.exercises.length + ' exercises</small></span><span>v</span></button><div class="ws-admin-body"><h3>Lesson Videos</h3>' + phase.lessons.map(function (lesson, index) {
        return '<div class="ws-slot"><div class="ws-slot-head"><strong>Lesson ' + (index + 1) + ': ' + escapeHtml(lesson.title) + '</strong><span class="ws-pill ws-pill-muted">' + escapeHtml(lesson.duration) + '</span></div><div class="ws-save-row"><input class="ws-input" data-storage-key="utl_url_' + lesson.id + '" placeholder="Paste Google Drive or Vimeo URL" value="' + escapeHtml(lessonUrl(lesson)) + '"><button class="ws-button ws-button-navy" data-save-field type="button">Save</button></div><span class="ws-save-note"></span></div>';
      }).join("") + '<h3>Exercise Context</h3>' + phase.exercises.map(function (exercise) {
        return adminExerciseSlot(exercise);
      }).join("") + '</div></article>';
    }).join("");
  }

  function adminExerciseSlot(exercise) {
    var selected = exerciseContextType(exercise);
    var url = exerciseContextUrl(exercise);
    return '<div class="ws-slot" data-admin-exercise="' + exercise.id + '"><div class="ws-slot-head"><strong>' + escapeHtml(exercise.title) + '</strong><span class="ws-pill ws-pill-gold">' + escapeHtml(exercise.type) + '</span></div><div class="ws-type-buttons" data-type-buttons="' + exercise.id + '">' + ["video", "slides", "text"].map(function (type) {
      return '<button class="ws-type-button ' + (selected === type ? "ws-selected" : "") + '" data-type="' + type + '" type="button">' + (type === "text" ? "Text only" : type[0].toUpperCase() + type.slice(1)) + '</button>';
    }).join("") + '</div><div class="ws-save-row ' + (selected === "text" ? "ws-hidden" : "") + '"><input class="ws-input" data-storage-key="utl_ctx_url_' + exercise.id + '" placeholder="Paste Google Drive or Vimeo URL" value="' + escapeHtml(url) + '"><button class="ws-button ws-button-navy" data-save-field type="button">Save</button></div><span class="ws-save-note"></span></div>';
  }

  function bindAdmin() {
    qsa("[data-visibility-phase]").forEach(function (checkbox) {
      checkbox.addEventListener("change", function () {
        localStorage.setItem(checkbox.getAttribute("data-visibility-phase"), checkbox.checked ? "show" : "hide");
      });
    });
    qsa(".ws-admin-toggle").forEach(function (button) {
      button.addEventListener("click", function () {
        button.closest(".ws-admin-phase").classList.toggle("ws-open");
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
    renderAdmin: renderAdmin,
    getPhase: getPhase
  };
})();
