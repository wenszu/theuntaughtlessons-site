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
      },
      {
        id: "orientation-howto",
        legacyEmbedKey: "utl_embed_orientation_howto",
        contextType: "slides",
        contextUrl: "https://drive.google.com/open?id=1Rw8tpfMir2c0LyV8FRIBNzoBmT5fUnVsu_n0-NftyXM&usp=drive_copy",
        contextTitle: "How this program works",
        contextBody: "Use this orientation to understand the learning rhythm: watch the setup, read the context, complete the practice, and mark your progress as you go."
      }
    ]
  },
  phase1: {
    title: "Think clearly",
    description: "Build clean structure before you communicate. Watch the lessons, then practice turning messy inputs into clear thinking.",
    lessons: [
      { id: "p1-l1", title: "KonMari for the cluttered mind", duration: "9 min", videoUrl: "https://drive.google.com/open?id=1JogKtDiCfhNjNckFLhOEJCCw7gh7eORq&usp=drive_copy" },
      { id: "p1-l2", title: "Rule of three", duration: "8 min", videoUrl: "https://drive.google.com/open?id=1fFBBPC0JbHf1IPeHIz_9yKrp173coxJM&usp=drive_copy" },
      { id: "p1-l3", title: "Bolded summary phrase", duration: "8 min", videoUrl: "https://drive.google.com/open?id=1ZSKGHTUSZs2T3g3aTMgQ9fk9lHg_fN34&usp=drive_copy" }
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
        legacyDoneKey: "utl_p1_ex3_done",
        legacyEmbedKey: "utl_embed_p1_message_desk",
        title: "Manager's messy notes",
        type: "Restructure",
        description: "Turn a disorganized voice memo into a structured, decision-ready response.",
        appUrl: "../apps/messy-notes/index.html",
        contextType: "video",
        contextUrl: "https://drive.google.com/file/d/1JpPDKz5RTyWFIJxUkeKSB5etP4W57Dax/view?usp=vids_web",
        contextTitle: "A message just landed on your desk",
        contextBody: "One of Aiko's direct reports, Ashley, just sent a cluttered update for Aiko. She needs you to turn it into something decision-ready before she's back. Apply the lessons from Phase 1 to get this done easily."
      },
      {
        id: "p1-e4",
        legacyDoneKey: "utl_p1_ex4_done",
        legacyEmbedKey: "utl_embed_p1_hugh_favour",
        title: "Rushed voice memo",
        type: "Voice structure",
        description: "Practice converting a rushed spoken update into a clearer written response for Aiko to read through easily.",
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
        legacyDoneKey: "utl_p1_ex6_done",
        legacyEmbedKey: "utl_embed_p1_olympic_brainstorm",
        title: "Chalkboard notes",
        type: "Synthesis",
        description: "Sort notes from a brainstorming session regarding the Olympic project into a clean, useful structure. Aiko asked you this personally!",
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
      { id: "p1-l4", title: "Wait, what's the problem again?", duration: "10 min", videoUrl: "https://drive.google.com/open?id=1b2nAA0d-Rq-jetDuRQeAusttazKQa-Si&usp=drive_copy" },
      { id: "p1-l5", title: "Divide and conquer", duration: "6 min", videoUrl: "https://drive.google.com/open?id=1hsdZTxdjNF2Yqsy9JRdC9jkc7wk5uGEO&usp=drive_copy" },
      { id: "p2-l1", title: "The executive storyline", duration: "7 min", videoUrl: "https://drive.google.com/open?id=1BONR9sIQM-Mscia3ZaG-06lP6G2dTZP_&usp=drive_copy" },
      { id: "p2-l3", title: "The art of persuasion", duration: "12 min", videoUrl: "https://drive.google.com/open?id=1Qxo0Mf_1I3_J_CLXf4CzKJvtZdxyz2kL&usp=drive_copy" }
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
        title: "Issue tree builder",
        type: "Problem breakdown",
        description: "Build an issue tree to break down the problem into solvable parts.",
        appUrl: "../apps/issue-tree-builder/index.html",
        contextType: "video",
        contextUrl: "https://drive.google.com/file/d/15AaNTTkiRsIVf90RfsmcSa3aEuFTqOAT/view?usp=vids_web",
        contextTitle: "Aiko liked your work. Now she has a question.",
        contextBody: "Break down the problem into MECE parts."
      },
      {
        id: "p2-e2",
        legacyDoneKey: "utl_p2_ex2_done",
        legacyEmbedKey: "utl_embed_p2_frame_answer",
        title: "Framing the storyline",
        type: "Storyline",
        description: "Using the issue tree, create an SCQA formulation.",
        appUrl: "../apps/scqa-builder/index.html",
        contextType: "video",
        contextUrl: "https://drive.google.com/open?id=168tYlq9fRUKl7NrlELHuwAPwAxC2_5yD&usp=drive_copy",
        contextTitle: "Create an executive-ready brief",
        contextBody: "You will need to make this more readable for Aiko."
      },
      {
        id: "p2-e3",
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
      { id: "p3-l1", title: "How to read people", duration: "11 min", videoUrl: "https://drive.google.com/open?id=1YUxx3D7GsLXzKZLG4SlvNrk8jWVgvM0_&usp=drive_copy" },
      { id: "p3-l2", title: "Let's switch hats", duration: "9 min", videoUrl: "https://drive.google.com/open?id=1h9r_4E7IkQ_aTKtHd3bl6IYHxF3dozhO&usp=drive_copy" },
      { id: "p3-l3", title: "Speak like Obama", duration: "13 min", videoUrl: "https://drive.google.com/open?id=1sYAwaMxQE85_rvxRMabJvDm5a3yjZ6oz&usp=drive_copy" },
      { id: "p3-l4", title: "The art of saying no", duration: "10 min", videoUrl: "https://drive.google.com/open?id=1XCOBAWDlcTht8w_utWZKwkw8wfBO_gC5&usp=drive_copy" },
      { id: "p3-l5", title: "I have bad news...", duration: "12 min", videoUrl: "https://drive.google.com/open?id=1RZxxq34xb3C6lpLxVYt5399a66ganrHG&usp=drive_copy" }
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
        legacyDoneKey: "utl_p3_ex4_done",
        legacyEmbedKey: "utl_embed_p3_eyes_on_you",
        title: "Speak like Obama",
        type: "Executive presence",
        description: "Your task involves two things: being clear, and being impactful. Make it land like Obama.",
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
  var phases = ["phase1", "phase2", "phase3"];
  var phaseNumbers = { phase1: 1, phase2: 2, phase3: 3 };
  var phaseLabels = { phase1: "Phase 1", phase2: "Phase 2", phase3: "Phase 3" };
  var phaseFiles = { phase1: "phase-1.html", phase2: "phase-2.html", phase3: "phase-3.html" };
  var remoteProgressLoaded = false;
  var remoteProgressSaveTimer = null;
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
    if (inPhasePracticeRoot()) return "../../index.html";
    return inAdminRoot() ? "../index.html" : "../index.html";
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
    var version = "?v=20260525-progress-save";
    if (inPhasePracticeRoot()) return "../../../assets/firebase.js" + version;
    return (inAdminRoot() ? "../assets/firebase.js" : "../assets/firebase.js") + version;
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
    });
    return {
      version: 1,
      orientation: {
        ready: readBool("utl_orientation_ready"),
        open: readBool("utl_orientation_open")
      },
      lessons: lessons,
      exercises: exercises,
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
      if (typeof saved.completed === "boolean") writeExerciseDone(exercise, saved.completed);
    });

    phases.forEach(function (phaseKey) {
      videosDone(phaseKey);
      exercisesDone(phaseKey);
    });
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
    import(firebaseHref())
      .then(function (firebase) {
        return firebase.getMemberWorkspaceProgress();
      })
      .then(function (progress) {
        if (progress) applyRemoteProgress(progress);
        else return saveRemoteProgressNow();
      })
      .catch(function (error) {
        console.warn("Firestore workspace progress load failed.", error);
      })
      .then(function () {
        remoteProgressLoaded = true;
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

  function renderIframe(url, title) {
    var src = sanitizeMediaUrl(url);
    if (!src) return "";
    return '<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:8px;"><iframe src="' + escapeHtml(src) + '" title="' + escapeHtml(title || "Video player") + '" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe></div>';
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
      ".ws-brand{display:flex;align-items:center;gap:14px;min-width:0}.ws-logo-link{display:flex;align-items:center;border-radius:6px}.ws-logo-link:hover{background:rgba(238,163,32,.18)}.ws-logo{height:31px;width:auto;display:block}.ws-brand-sep,.ws-workspace-link,.ws-nav-divider{display:none}",
      ".ws-links{display:flex;align-items:center;justify-content:center;gap:16px;min-width:0}.ws-link{min-height:54px;display:inline-flex;align-items:center;border-bottom:3px solid transparent;color:rgba(255,255,255,.72);font:700 13px Lato,sans-serif;letter-spacing:0;text-decoration:none;white-space:nowrap}.ws-link:hover,.ws-link.ws-active{color:var(--ws-white);border-bottom-color:var(--ws-gold)}.ws-sep{color:rgba(255,255,255,.32);font-family:Lato,sans-serif}",
      ".ws-nav-drop{position:relative;display:inline-flex}.ws-nav-trigger{border-left:0;border-right:0;border-top:0;background:transparent;padding:0;cursor:pointer}.ws-phase-menu{position:absolute;top:52px;left:0;width:300px;background:#fff;color:var(--ws-navy);border:1px solid var(--ws-line);border-radius:8px;box-shadow:0 18px 40px rgba(0,51,102,.22);overflow:hidden;z-index:80;display:none}.ws-nav-drop:hover .ws-phase-menu,.ws-nav-drop:focus-within .ws-phase-menu{display:block}.ws-phase-menu:before{content:attr(data-label);display:block;padding:12px 16px 8px;color:var(--ws-steel);font:700 11px 'Roboto Mono',monospace;letter-spacing:.14em;text-transform:uppercase}.ws-phase-menu a{display:flex;gap:12px;align-items:center;padding:13px 16px;color:var(--ws-navy);text-decoration:none}.ws-phase-menu a:hover{background:#f4eddf}.ws-phase-menu strong{display:block;font-size:16px}.ws-phase-menu small{display:block;margin-top:2px;color:var(--ws-steel);font-size:13px}.ws-phase-menu .ws-media-icon{margin:0;width:36px;height:36px;border-radius:8px}",
      ".ws-user{position:relative;display:flex;align-items:center;gap:10px;justify-content:flex-end}.ws-user-email{max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(255,255,255,.72);font:700 12px Lato,sans-serif;letter-spacing:0}.ws-avatar{width:36px;height:36px;border-radius:999px;border:0;background:var(--ws-gold);color:var(--ws-navy);display:grid;place-items:center;font:700 12px 'Roboto Mono',monospace;cursor:pointer;overflow:hidden;padding:0}.ws-avatar img,.ws-profile-avatar img{width:100%;height:100%;object-fit:cover;display:block}.ws-profile-menu{position:absolute;right:0;top:100%;min-width:200px;max-width:240px;background:#fff;color:var(--ws-charcoal);border:1px solid var(--ws-line);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.15);padding:0;z-index:200;overflow:hidden}.ws-profile-menu:before{content:'';position:absolute;top:-8px;right:18px;width:16px;height:16px;background:var(--ws-navy);transform:rotate(45deg)}.ws-profile-menu[hidden]{display:none}.ws-profile-head{position:relative;display:flex;align-items:center;gap:13px;background:var(--ws-navy);color:#fff;padding:14px 16px 13px;border-bottom:3px solid var(--ws-gold)}.ws-profile-avatar{width:46px;height:46px;border-radius:999px;background:var(--ws-gold);color:var(--ws-navy);display:grid;place-items:center;overflow:hidden;font:700 14px 'Roboto Mono',monospace;flex:0 0 auto}.ws-profile-name{margin:0;color:#fff;font-size:15px;font-weight:700;line-height:1.15}.ws-profile-role{margin:4px 0 0;color:var(--ws-gold);font:700 9.5px 'Roboto Mono',monospace;letter-spacing:.12em;text-transform:uppercase}.ws-profile-section{padding:11px 16px 10px;border-bottom:1px solid var(--ws-line)}.ws-profile-section:last-child{border-bottom:0}.ws-profile-section-label{display:block;margin:0 0 7px;color:var(--ws-gold);font:700 9.5px 'Roboto Mono',monospace;letter-spacing:.12em;text-transform:uppercase}.ws-profile-menu a,.ws-profile-menu button{width:100%;min-height:36px;display:flex;align-items:center;gap:12px;border:0;background:transparent;color:var(--ws-navy);font:700 14px Lato,sans-serif;text-align:left;text-decoration:none;cursor:pointer;padding:4px 0}.ws-profile-menu a:hover,.ws-profile-menu button:hover{text-decoration:underline}.ws-profile-icon{width:18px;color:var(--ws-steel);display:inline-flex;justify-content:center;font-size:16px;line-height:1}.ws-profile-menu .ws-admin-link .ws-profile-icon{color:var(--ws-gold)}.ws-profile-menu .ws-logout{color:var(--ws-steel)}",
      ".ws-main{padding:54px 0 72px}.ws-kicker{display:inline-flex;color:var(--ws-gold);font:700 11px 'Roboto Mono',monospace;letter-spacing:.1em;text-transform:uppercase}.ws-title{margin:10px 0 12px;color:var(--ws-navy);font:700 clamp(40px,6vw,66px)/.98 'Playfair Display',serif}.ws-subtitle{max-width:760px;margin:0;color:var(--ws-steel);font-size:18px;line-height:1.55}",
      ".ws-login-wrap{min-height:calc(100vh - 54px);display:grid;place-items:center;padding:48px 20px}.ws-login-card{width:min(460px,100%);background:#fff;border:1px solid var(--ws-line);border-radius:12px;padding:30px;box-shadow:0 18px 45px rgba(0,51,102,.1)}.ws-login-card .ws-subtitle{font-size:17px}.ws-form{display:grid;gap:12px;margin-top:24px}.ws-form label{color:var(--ws-navy);font-weight:700}.ws-login-card .ws-form .ws-button,.ws-login-card .ws-google-button{width:100%}.ws-login-divider{display:flex;align-items:center;gap:12px;margin:18px 0;color:var(--ws-steel);font:700 10px 'Roboto Mono',monospace;letter-spacing:.08em;text-transform:uppercase}.ws-login-divider:before,.ws-login-divider:after{content:'';height:1px;background:var(--ws-line);flex:1}.ws-input,.ws-textarea,.ws-select{width:100%;min-height:46px;border:1px solid rgba(0,51,102,.22);border-radius:8px;padding:10px 12px;background:#fff;color:var(--ws-charcoal);font:400 15px Lato,sans-serif}.ws-textarea{min-height:88px;resize:vertical}.ws-message{min-height:20px;margin:0;color:#8A1F1F;font-weight:700}.ws-message.ws-success{color:var(--ws-green)}.ws-login-card .ws-google-button{position:relative;min-height:46px;gap:10px;background:#fff;border:1px solid #747775;border-radius:8px;color:#1f1f1f;text-transform:none;font:500 14px/20px Roboto,Arial,sans-serif;letter-spacing:0;padding:0 12px;box-shadow:none}.ws-login-card .ws-google-button:hover{background:#f8fafd;border-color:#3c4043;filter:none}.ws-login-card .ws-google-button:focus-visible{outline:2px solid #4285F4;outline-offset:2px}.ws-login-card .ws-google-button[disabled]{background:#f1f3f4;color:#5f6368;border-color:#dadce0}.ws-google-mark{width:20px;height:20px;display:inline-block;flex:0 0 auto;background:center/contain no-repeat url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Cpath fill='%23EA4335' d='M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z'/%3E%3Cpath fill='%234285F4' d='M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z'/%3E%3Cpath fill='%23FBBC05' d='M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24s.92 7.54 2.56 10.78l7.97-6.19z'/%3E%3Cpath fill='%2334A853' d='M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z'/%3E%3Cpath fill='none' d='M0 0h48v48H0z'/%3E%3C/svg%3E\")}",
      ".ws-home-stack{display:grid;gap:26px}.ws-orientation-card{background:#fff;border:1px solid var(--ws-line);border-radius:12px;overflow:hidden}.ws-orientation-head{width:100%;border:0;background:#fff;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:14px;padding:18px 20px;text-align:left;cursor:pointer}.ws-start-badge{background:var(--ws-navy);color:var(--ws-gold);border-radius:3px;padding:5px 9px;font:700 9px 'Roboto Mono',monospace;letter-spacing:.1em;text-transform:uppercase}.ws-orientation-title{display:block;color:var(--ws-navy);font-weight:700}.ws-orientation-sub{display:block;margin-top:2px;color:var(--ws-steel);font-size:13px}.ws-disclosure-icon{width:34px;height:34px;border-radius:8px;background:var(--ws-gold);color:#fff;display:inline-grid;place-items:center;font:700 22px/1 Lato,sans-serif}.ws-orientation-body{display:none;padding:0 20px 20px}.ws-orientation-card.ws-open .ws-orientation-body{display:block}.ws-orientation-copy{max-width:820px;margin:0 0 20px;color:var(--ws-charcoal);font-size:17px;line-height:1.68}.ws-orientation-copy h3{margin:0 0 14px;color:var(--ws-navy);font:700 30px/1.1 'Playfair Display',serif}.ws-orientation-copy p{margin:0 0 13px}.ws-orientation-copy p:last-child{margin-bottom:0}.ws-ready-row{display:flex;gap:10px;align-items:center;margin-top:14px;color:var(--ws-navy);font-weight:700}.ws-ready-row input{width:18px;height:18px}.ws-how-row{margin-top:14px}.ws-how-toggle{width:100%;border:0;background:#efe7d9;border-radius:8px;display:flex;align-items:center;gap:12px;padding:12px;color:var(--ws-navy);text-align:left;cursor:pointer}.ws-how-toggle .ws-media-icon{width:26px;height:26px;font-size:12px}.ws-how-toggle .ws-disclosure-icon{margin-left:auto;width:28px;height:28px;font-size:18px}.ws-how-body{display:none;padding:14px 2px 0}.ws-how-body.ws-open{display:block}.ws-step-tabs{position:sticky;top:54px;z-index:25;background:var(--ws-cream);border-bottom:1px solid var(--ws-line)}.ws-step-tabs-inner{width:min(1180px,calc(100% - 32px));margin:0 auto;display:flex;gap:24px}.ws-step-tab{min-height:46px;display:inline-flex;align-items:center;border-bottom:3px solid transparent;color:var(--ws-steel);font:700 11px Lato,sans-serif;letter-spacing:.05em;text-transform:uppercase;text-decoration:none}.ws-step-tab.ws-active{color:var(--ws-navy);border-bottom-color:var(--ws-gold)}.ws-breadcrumb{display:none}.ws-gold-cta{margin-top:18px;background:var(--ws-gold);border-radius:10px;padding:16px 18px;display:flex;justify-content:space-between;align-items:center;gap:16px;color:var(--ws-navy);font-weight:700}.ws-gold-cta a{color:var(--ws-navy);font:700 12px Lato,sans-serif;text-transform:uppercase;text-decoration:none}.ws-phase-card .ws-dot.empty{background:#fff;border:1px solid var(--ws-line)}.ws-phase-card .ws-dot.half{background:linear-gradient(90deg,var(--ws-gold) 50%,#fff 50%);border:1px solid var(--ws-gold)}.ws-phase-card .ws-dot.solid{background:var(--ws-gold);border:1px solid var(--ws-gold)}.ws-locked .ws-dot{background:#e4e4e4!important;border-color:#d6d6d6!important}.ws-locked .ws-phase-stripe{background:#d5d5d5}.ws-locked .ws-button{background:#f7f5ef;border-color:#d8d2c8;color:#9a9389}.ws-pill-locked{background:#efefef;color:#9a9389}.ws-pill-progress{background:rgba(238,163,32,.18);color:var(--ws-navy)}",
      ".ws-practice-reminder{margin:24px 0;background:#fff7e8;border:1px solid rgba(238,163,32,.35);border-radius:10px;padding:14px 16px;color:var(--ws-navy);font-weight:700}.ws-practice-reminder a{color:var(--ws-navy);text-decoration:underline;text-underline-offset:3px}.ws-practice-list{display:grid;gap:18px}.ws-practice-card{background:#fff;border:1px solid var(--ws-line);border-radius:12px;overflow:hidden}.ws-practice-head{width:100%;border:0;background:#fff;display:grid;grid-template-columns:1fr auto;gap:14px;padding:22px 22px 12px;text-align:left;cursor:pointer}.ws-practice-head h3{margin:6px 0;color:var(--ws-navy);font:700 30px 'Playfair Display',serif}.ws-practice-head p{margin:0;color:var(--ws-steel);line-height:1.45}.ws-practice-chevron{width:26px;height:26px;border-radius:6px;background:var(--ws-gold);color:#fff;display:inline-grid;place-items:center;font:700 20px/1 Lato,sans-serif}.ws-practice-body{display:none;padding:0 22px 22px}.ws-practice-card.ws-open .ws-practice-body{display:block}.ws-exercise-tabs{display:flex;gap:22px;border-bottom:2px solid var(--ws-line);margin:10px 0 8px}.ws-exercise-tab{border:0;border-bottom:3px solid transparent;background:transparent;color:#9a9a9a;display:inline-flex;align-items:center;gap:8px;padding:12px 0 11px;font:700 12px 'Roboto Mono',monospace;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}.ws-exercise-tab.ws-active{color:var(--ws-navy);border-bottom-color:var(--ws-gold)}.ws-tab-badge{width:22px;height:22px;border-radius:999px;background:#e8e0d4;color:#9a9a9a;display:inline-grid;place-items:center;font:700 11px Lato,sans-serif}.ws-exercise-tab.ws-active .ws-tab-badge{background:var(--ws-gold);color:#fff}.ws-tab-hint{margin:0 0 18px;color:#9a9a9a;font:700 9px 'Roboto Mono',monospace;letter-spacing:.08em}.ws-tab-hint span{color:var(--ws-gold)}.ws-practice-pane{display:none}.ws-practice-pane.ws-active{display:block}.ws-before-block{background:var(--ws-cream);border:1px solid var(--ws-line);border-radius:10px;padding:18px;margin-bottom:16px}.ws-before-block h4,.ws-ai-context h4{margin:0 0 10px;font:700 12px 'Roboto Mono',monospace;letter-spacing:.12em;text-transform:uppercase}.ws-before-block h4{color:var(--ws-navy)}.ws-before-block p{margin:0;line-height:1.5}.ws-practice-pane .ws-context-embed{margin-bottom:16px}.ws-practice-pane .ws-button{width:100%}.ws-ai-context{background:var(--ws-navy);color:#fff;border-radius:10px;padding:20px 22px;margin-bottom:16px}.ws-ai-context h4{color:rgba(255,255,255,.62)}.ws-ai-context p{margin:0;color:#fff;line-height:1.55}.ws-ai-link-card{min-height:92px;border:2px solid var(--ws-line);border-radius:10px;background:#fff;color:var(--ws-navy);display:grid;grid-template-columns:54px 1fr auto;align-items:center;gap:16px;padding:16px 20px;margin-bottom:16px;text-decoration:none}.ws-ai-link-card:hover{border-color:var(--ws-gold)}.ws-ai-icon{width:42px;height:42px;border-radius:8px;background:#f3eee6;display:grid;place-items:center;font-size:22px}.ws-ai-link-card strong{display:block;color:var(--ws-navy);font-size:16px}.ws-ai-link-card small{display:block;color:var(--ws-charcoal);font-weight:700;margin-top:3px}.ws-ai-arrow{color:var(--ws-gold);font-size:22px}.ws-button-gold{background:var(--ws-gold);border-color:var(--ws-gold);color:#fff}.ws-button-dashed{background:#fff;border-style:dashed;border-color:rgba(0,51,102,.38);color:var(--ws-navy)}",
      ".ws-button{min-height:44px;border-radius:8px;border:1px solid var(--ws-gold);background:var(--ws-gold);color:var(--ws-navy);font:700 13px Lato,sans-serif;letter-spacing:.04em;text-transform:uppercase;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;padding:0 18px;cursor:pointer}.ws-button:hover{filter:brightness(.97)}.ws-button[disabled],.ws-button.ws-disabled{opacity:.45;cursor:not-allowed;filter:grayscale(.2)}.ws-button-secondary{background:#fff;border-color:rgba(0,51,102,.28);color:var(--ws-navy)}.ws-button-navy{background:var(--ws-navy);border-color:var(--ws-navy);color:#fff}",
      ".ws-progress-card{margin:34px 0 24px;background:#fff;border:1px solid var(--ws-line);border-radius:12px;padding:18px}.ws-progress-row{display:flex;justify-content:space-between;gap:16px;color:var(--ws-navy);font:700 11px 'Roboto Mono',monospace;letter-spacing:.08em;text-transform:uppercase}.ws-progress-track{height:12px;background:#EFE6D8;border-radius:999px;margin-top:12px;overflow:hidden}.ws-progress-fill{height:100%;background:linear-gradient(90deg,var(--ws-gold),#f4c15c);border-radius:999px}",
      ".ws-phase-list{display:grid;gap:18px}.ws-phase-card{position:relative;display:grid;grid-template-columns:8px 92px 1fr auto;align-items:center;gap:22px;min-height:178px;background:#fff;border:1px solid var(--ws-line);border-radius:12px;overflow:hidden;padding:22px 24px 22px 0;text-decoration:none;color:inherit;box-shadow:0 12px 28px rgba(0,51,102,.06)}.ws-phase-card.ws-locked{opacity:.72}.ws-phase-stripe{align-self:stretch;background:var(--ws-gold)}.ws-locked .ws-phase-stripe{background:#d5d5d5}.ws-phase-number{color:rgba(0,51,102,.08);font:700 74px/1 'Playfair Display',serif;text-align:center}.ws-phase-content h2{margin:6px 0;color:var(--ws-navy);font:700 34px/1.05 'Playfair Display',serif}.ws-phase-content p{margin:0;color:var(--ws-steel);line-height:1.45}.ws-trail{display:flex;align-items:center;gap:8px;margin-top:16px;color:var(--ws-navy);font:700 10px 'Roboto Mono',monospace;text-transform:uppercase;letter-spacing:.07em}.ws-dot{width:10px;height:10px;border-radius:99px;background:var(--ws-gold)}.ws-arrow{color:var(--ws-steel)}.ws-pill{display:inline-flex;align-items:center;border-radius:999px;padding:5px 9px;font:700 10px 'Roboto Mono',monospace;letter-spacing:.06em;text-transform:uppercase}.ws-pill-gold{background:rgba(238,163,32,.18);color:var(--ws-navy)}.ws-pill-muted{background:#E8EEF4;color:var(--ws-steel)}.ws-pill-green{background:rgba(44,122,75,.12);color:var(--ws-green)}.ws-phase-actions{display:grid;gap:10px;justify-items:end}",
      ".ws-stepper{display:flex;gap:10px;margin:28px 0;align-items:center}.ws-step{display:flex;align-items:center;gap:8px;border:0;border-bottom:2px solid var(--ws-line);background:transparent;padding:8px 2px;color:var(--ws-steel);font:700 11px 'Roboto Mono',monospace;text-transform:uppercase;letter-spacing:.06em}.ws-step.ws-active{border-bottom-color:var(--ws-navy);color:var(--ws-navy)}.ws-step.ws-done{border-bottom-color:var(--ws-green);color:var(--ws-green)}",
      ".ws-section{margin-top:30px}.ws-section-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:14px}.ws-section-head h2{margin:0;color:var(--ws-navy);font:700 31px 'Playfair Display',serif}.ws-count{color:var(--ws-steel);font:700 11px 'Roboto Mono',monospace;text-transform:uppercase;letter-spacing:.08em}",
      ".ws-player-card{background:#fff;border:1px solid var(--ws-line);border-radius:12px;overflow:hidden}.ws-player{position:relative;background:linear-gradient(135deg,#002448,#003366 55%,#244F78);color:#fff}.ws-player-placeholder{text-align:center;padding:22px}.ws-play-icon{width:58px;height:58px;border-radius:999px;background:var(--ws-gold);color:var(--ws-navy);display:grid;place-items:center;margin:0 auto 14px;font-size:24px}.ws-player-meta{position:absolute;left:22px;bottom:20px;right:22px;text-shadow:0 2px 8px rgba(0,0,0,.35)}.ws-player-meta h3{margin:6px 0 0;color:#fff;font:700 25px 'Playfair Display',serif}.ws-player-actions{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px}",
      ".ws-rail-wrap{padding:22px 22px 24px;border-top:1px solid rgba(0,51,102,.08);background:#fff}.ws-scroll-hint{display:none;color:var(--ws-steel);font:700 10px 'Roboto Mono',monospace;letter-spacing:.08em;text-transform:uppercase;margin:0 0 8px}.ws-lesson-rail{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:14px}.ws-lesson-tile{min-height:108px;border:1px solid var(--ws-line);border-radius:10px;background:#fff;color:var(--ws-navy);padding:14px 38px 14px 14px;text-align:left;cursor:pointer}.ws-lesson-tile.ws-active{background:var(--ws-navy);color:#fff}.ws-lesson-tile strong{display:block;font:700 10px 'Roboto Mono',monospace;letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px}.ws-lesson-tile span{display:block;font-size:13px;line-height:1.25}.ws-lesson-tile small{display:block;margin-top:9px;color:inherit;opacity:.75}.ws-check{color:var(--ws-gold);font-weight:700}",
      ".ws-collapsed{background:#fff;border:1px solid var(--ws-line);border-radius:12px;padding:18px;display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:14px;cursor:pointer}.ws-green-circle{width:34px;height:34px;border-radius:999px;background:var(--ws-green);color:#fff;display:grid;place-items:center;font-weight:700}.ws-video-toggle-icon{width:34px;height:34px;border-radius:9px;background:rgba(77,112,148,.16);color:var(--ws-navy);display:grid;place-items:center;font-size:16px;font-weight:700}.ws-collapsed h3{margin:0;color:var(--ws-navy);font:700 24px 'Playfair Display',serif}.ws-collapsed p{margin:2px 0 0;color:var(--ws-steel)}.ws-rewatch{display:none;background:#fff;border:1px solid var(--ws-line);border-top:0;border-radius:0 0 12px 12px;padding:22px}.ws-rewatch.ws-open{display:block}.ws-rewatch .ws-lesson-rail a{text-decoration:none}",
      ".ws-exercise-stack{display:grid;gap:20px}.ws-intro-contexts{gap:18px;margin:8px 0 24px}.ws-unit{border-radius:12px;overflow:hidden;box-shadow:0 12px 28px rgba(0,51,102,.06)}.ws-exercises .ws-exercise-stack>.ws-unit{display:grid;gap:18px;background:#fff;border:1px solid var(--ws-line);padding:18px}.ws-exercises .ws-exercise-stack>.ws-unit>.ws-context-toggle{border-radius:10px}.ws-exercises .ws-exercise-stack>.ws-unit>.ws-context-panel{padding:0}.ws-exercises .ws-exercise-stack>.ws-unit>.ws-workbook-card{margin-top:0}.ws-stacked-unit{display:grid;gap:18px;background:#fff;border:1px solid var(--ws-line);padding:18px}.ws-stacked-unit .ws-context-toggle{border-radius:10px}.ws-stacked-unit .ws-context-panel{padding:0}.ws-stacked-unit .ws-workbook-card{margin:0}.ws-context{background:var(--ws-navy);color:#fff;padding:20px 22px}.ws-context-tag{color:var(--ws-gold);font:700 10px 'Roboto Mono',monospace;letter-spacing:.09em;text-transform:uppercase}.ws-context h3{margin:7px 0;color:#fff;font:700 27px 'Playfair Display',serif}.ws-context p{margin:0;color:rgba(255,255,255,.78);line-height:1.5}.ws-media-row{margin-top:14px;display:flex;align-items:center;gap:12px;border:1px solid rgba(255,255,255,.22);border-radius:10px;padding:11px;color:#fff;text-decoration:none}.ws-media-icon{width:34px;height:34px;border-radius:999px;background:var(--ws-gold);color:var(--ws-navy);display:grid;place-items:center;font-weight:700}.ws-media-row.ws-missing{opacity:.62;pointer-events:none}.ws-exercise-card{display:grid;grid-template-columns:1fr auto;gap:16px;background:#fff;border:1px solid var(--ws-line);border-top:0;padding:22px;text-decoration:none;color:inherit}.ws-exercise-card.ws-disabled{opacity:.55}.ws-exercise-card.ws-disabled a,.ws-exercise-card.ws-disabled button{pointer-events:none}.ws-exercise-card h3{margin:7px 0;color:var(--ws-navy);font:700 28px 'Playfair Display',serif}.ws-exercise-card p{margin:0 0 14px;color:var(--ws-steel);line-height:1.45}.ws-open-link{font:700 11px 'Roboto Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--ws-navy)}.ws-mark-done{align-self:end}",
      ".ws-video-complete .ws-player-card,.ws-lesson-tile.ws-watched{border-color:var(--ws-green);box-shadow:0 0 0 2px rgba(44,122,75,.16)}.ws-lesson-tile{position:relative}.ws-lesson-check{position:absolute;top:8px;right:8px;width:20px;height:20px;border-radius:999px;border:1px solid rgba(0,51,102,.24);background:#fff;color:transparent;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;line-height:1;padding:0;text-align:center}.ws-lesson-tile.ws-watched .ws-lesson-check{background:var(--ws-green);border-color:var(--ws-green);color:#fff}.ws-video-check{position:absolute;top:14px;right:14px;width:30px;height:30px;border-radius:999px;border:1px solid rgba(255,255,255,.6);background:rgba(255,255,255,.9);color:transparent;display:flex;align-items:center;justify-content:center;font-size:15px;line-height:1;padding:0;font-weight:700;z-index:2;cursor:pointer}.ws-video-complete .ws-video-check{background:var(--ws-green);border-color:var(--ws-green);color:#fff}",
      ".ws-context-toggle{width:100%;display:flex;align-items:center;gap:14px;border:0;border-radius:10px;background:#ded6c8;color:var(--ws-navy);padding:16px 18px;text-align:left;cursor:pointer}.ws-context-toggle-icon{width:30px;height:30px;border-radius:8px;background:var(--ws-gold);color:#fff;display:grid;place-items:center;font-size:24px;font-weight:700;line-height:1}.ws-context-toggle-title{display:block;color:var(--ws-navy);font-size:17px;font-weight:700}.ws-context-toggle-sub{display:block;color:var(--ws-steel);font-size:14px;margin-top:2px}.ws-context-panel{display:none;padding:18px 0 0}.ws-context-panel.ws-open{display:block}.ws-context-panel-inner{color:var(--ws-charcoal)}.ws-context-panel-inner p{margin:0 0 14px;color:var(--ws-charcoal);line-height:1.5}.ws-context-embed{margin-top:14px;border-radius:10px;overflow:hidden;border:1px solid var(--ws-line)}.ws-context-panel .ws-media-row{background:var(--ws-navy);margin-top:14px}.ws-workbook-card{position:relative;margin-top:18px;background:#fff;border:1px solid var(--ws-line);border-radius:12px;padding:34px 36px;display:grid;gap:22px}.ws-workbook-card.ws-done{border:2px solid var(--ws-green);background:#f8fbf7}.ws-workbook-card.ws-disabled{opacity:.56}.ws-workbook-card.ws-disabled a,.ws-workbook-card.ws-disabled button{pointer-events:none}.ws-workbook-top{display:flex;align-items:center;gap:12px;color:var(--ws-steel);font:700 14px Lato,sans-serif;letter-spacing:.05em;text-transform:uppercase}.ws-status-circle{width:28px;height:28px;border-radius:999px;background:#d9e4ee;color:var(--ws-steel);display:grid;place-items:center;font:700 14px Lato,sans-serif}.ws-workbook-card.ws-done .ws-status-circle{background:var(--ws-green);color:#fff}.ws-workbook-card h3{margin:0;color:var(--ws-navy);font:700 clamp(34px,5vw,54px)/1.02 'Playfair Display',serif}.ws-workbook-card p{max-width:780px;margin:0;color:var(--ws-steel);font-size:22px;line-height:1.35}.ws-card-actions{display:flex;gap:12px;flex-wrap:wrap;justify-content:center}.ws-card-actions .ws-button{min-width:190px}.ws-done-pill{display:inline-flex;align-items:center;gap:5px;background:rgba(44,122,75,.12);color:var(--ws-green);border-radius:999px;padding:4px 10px;font:700 12px Lato,sans-serif;letter-spacing:0;text-transform:none}",
      ".ws-admin-visibility{margin-top:30px;background:#fff;border:1px solid var(--ws-line);border-radius:12px;padding:18px;display:grid;gap:12px}.ws-check-row{display:flex;align-items:flex-start;gap:10px;color:var(--ws-navy);font-weight:700}.ws-check-row input{margin-top:3px}.ws-help{margin:0;color:var(--ws-steel);font-size:14px;line-height:1.45}",
      ".ws-bottom-nav{display:flex;justify-content:space-between;gap:12px;margin-top:34px}.ws-bottom-nav .ws-button{min-width:180px}.ws-admin-grid{display:grid;gap:16px;margin-top:30px}.ws-admin-phase{background:#fff;border:1px solid var(--ws-line);border-radius:12px;overflow:hidden}.ws-admin-toggle{width:100%;display:grid;grid-template-columns:74px 1fr auto;align-items:center;gap:16px;border:0;background:#fff;padding:18px;text-align:left;cursor:pointer}.ws-admin-num{color:rgba(0,51,102,.12);font:700 54px 'Playfair Display',serif}.ws-admin-body{display:none;padding:0 18px 18px}.ws-admin-phase.ws-open .ws-admin-body{display:block}.ws-slot{border-top:1px solid var(--ws-line);padding:16px 0;display:grid;gap:10px}.ws-slot-head{display:flex;justify-content:space-between;gap:12px}.ws-type-buttons{display:flex;gap:8px}.ws-type-button{border:1px solid rgba(0,51,102,.25);background:#fff;color:var(--ws-navy);border-radius:999px;padding:7px 10px;font:700 10px 'Roboto Mono',monospace;cursor:pointer}.ws-type-button.ws-selected{background:var(--ws-navy);color:#fff}.ws-save-row{display:flex;gap:8px}.ws-save-row .ws-input{background:#fbf7ef}.ws-save-note{min-height:18px;color:var(--ws-green);font:700 11px 'Roboto Mono',monospace}.ws-save-bar{position:sticky;bottom:0;background:#fff;border-top:1px solid var(--ws-line);padding:12px 0;margin-top:32px;box-shadow:0 -8px 20px rgba(0,51,102,.07)}.ws-save-bar-inner{display:flex;justify-content:space-between;align-items:center;gap:16px}",
      "@media(max-width:768px){body.ws-page{background:var(--ws-cream)}.ws-shell{width:calc(100% - 28px)}.ws-nav-inner{height:auto;grid-template-columns:auto 1fr auto;grid-template-rows:auto auto;gap:0 10px;width:100%;padding:8px 12px 0}.ws-brand{grid-column:1;grid-row:1;height:42px;align-items:center}.ws-logo{height:30px}.ws-user{grid-column:3;grid-row:1;height:42px}.ws-user-email{display:none}.ws-avatar{width:36px;height:36px}.ws-links{grid-column:1/-1;grid-row:2;justify-content:flex-start;overflow-x:auto;white-space:nowrap;gap:10px;border-top:1px solid rgba(255,255,255,.14);scrollbar-width:none}.ws-links::-webkit-scrollbar,.ws-lesson-rail::-webkit-scrollbar,.ws-step-tabs-inner::-webkit-scrollbar,.ws-exercise-tabs::-webkit-scrollbar{display:none}.ws-link{min-height:42px;font-size:14px}.ws-sep{opacity:.55}.ws-phase-menu{position:fixed;left:12px;right:12px;top:92px;width:auto}.ws-profile-menu{position:fixed;top:56px;right:12px;left:auto;width:min(270px,calc(100vw - 24px));max-width:none}.ws-main{padding:24px 0 48px}.ws-title{font-size:40px}.ws-subtitle{font-size:17px}.ws-login-wrap{min-height:100svh;padding:28px 16px}.ws-login-card{padding:28px 24px}.ws-login-card .ws-title{font-size:54px}.ws-login-card .ws-subtitle{font-size:18px}.ws-login-card .ws-google-button{min-height:50px}.ws-orientation-head{grid-template-columns:1fr auto;align-items:start;padding:16px}.ws-start-badge{width:max-content;margin-bottom:8px}.ws-orientation-title{font-size:18px}.ws-orientation-sub{font-size:15px;line-height:1.35}.ws-orientation-body{padding:0 16px 18px}.ws-orientation-copy{font-size:16px;line-height:1.58}.ws-orientation-copy h3{font-size:28px}.ws-disclosure-icon{width:34px;height:34px}.ws-player-card,.ws-context-embed{border-radius:12px}.ws-player-meta{position:static;padding:12px 14px;background:var(--ws-navy);text-shadow:none}.ws-player-meta h3{font-size:21px}.ws-how-toggle{padding:12px}.ws-ready-row{align-items:flex-start;font-size:16px;line-height:1.35}.ws-ready-row input{margin-top:3px;flex:0 0 auto}.ws-step-tabs{top:85px}.ws-step-tabs-inner{width:100%;padding:0 12px;overflow-x:auto;scrollbar-width:none;gap:20px}.ws-step-tab{flex:0 0 auto;min-height:42px;font-size:10px}.ws-gold-cta{align-items:flex-start;flex-direction:column}.ws-exercise-tabs{gap:14px;overflow-x:auto;scrollbar-width:none}.ws-exercise-tab{flex:0 0 auto;font-size:10px}.ws-ai-link-card{grid-template-columns:42px 1fr;gap:12px;padding:14px}.ws-ai-arrow{display:none}.ws-phase-card{grid-template-columns:6px 50px 1fr;gap:12px;min-height:150px;padding:18px 14px 18px 0}.ws-phase-actions{grid-column:2/-1;justify-items:start}.ws-phase-number{font-size:46px}.ws-phase-content h2{font-size:27px}.ws-stepper{flex-wrap:wrap}.ws-section{margin-top:24px}.ws-section-head{align-items:flex-start;flex-direction:column}.ws-player-actions{align-items:flex-start;flex-direction:column}.ws-scroll-hint{display:block}.ws-lesson-rail{display:flex;overflow-x:auto;gap:10px;padding-bottom:4px;scrollbar-width:none}.ws-lesson-tile{min-width:124px}.ws-collapsed{grid-template-columns:auto 1fr auto}.ws-collapsed .ws-pill{display:none}.ws-context-toggle{padding:14px}.ws-workbook-card{padding:24px 20px}.ws-workbook-top{font-size:11px;letter-spacing:.1em}.ws-workbook-card h3{font-size:34px}.ws-workbook-card p{font-size:17px}.ws-card-actions .ws-button{width:100%}.ws-exercise-card{grid-template-columns:1fr}.ws-bottom-nav{flex-direction:row}.ws-bottom-nav .ws-button{min-width:0;flex:1;padding:0 10px;font-size:10px}.ws-admin-toggle{grid-template-columns:48px 1fr auto}.ws-save-bar-inner{flex-direction:column;align-items:stretch}.ws-save-row{flex-direction:column}}"
    ].join("\n");
    document.head.appendChild(style);
  }

  function pageShell(active, contentHtml, subnavHtml) {
    injectStyles();
    document.body.classList.add("ws-page");
    document.body.innerHTML = navHtml(active) + (subnavHtml || "") + '<main class="ws-main"><div class="ws-shell">' + contentHtml + "</div></main>";
    bindNav();
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
      { key: "assessments", label: "Assessments", href: memberHref("index.html") + "#assessments", hidden: localStorage.getItem("utl_tsa_status") === "hidden" }
    ].filter(function (link) { return !link.hidden; });
    if (active === "admin") links.push({ key: "admin", label: "Admin", href: adminHref() });
    return '<header class="ws-nav"><div class="ws-nav-inner">' +
      '<div class="ws-brand"><a class="ws-logo-link" href="' + homeHref() + '" aria-label="The Untaught Lessons home"><img class="ws-logo" src="' + assetHref("../assets/utl-logo-nav-white.png") + '" alt="The Untaught Lessons"></a></div>' +
      '<nav class="ws-links" aria-label="Member workspace">' + links.map(function (link, index) {
        if (link.dropdown) {
          return (index ? '<span class="ws-sep">|</span>' : "") + phaseDropdownHtml(link, active);
        }
        return (index ? '<span class="ws-sep">|</span>' : "") + '<a class="ws-link ' + (active === link.key ? "ws-active" : "") + '" href="' + link.href + '">' + link.label + '</a>';
      }).join("") + '</nav>' +
      '<div class="ws-user"><span class="ws-user-email">' + escapeHtml(user.email) + '</span><button class="ws-avatar" type="button" aria-label="Open profile menu" aria-expanded="false">' + avatar + '</button><div class="ws-profile-menu" hidden><div class="ws-profile-head"><span class="ws-profile-avatar">' + avatar + '</span><div><p class="ws-profile-name">' + escapeHtml(user.label) + '</p><p class="ws-profile-role">' + roleLabel + '</p></div></div><div class="ws-profile-section"><span class="ws-profile-section-label">Your space</span><a href="' + appHref("../my-results/index.html") + '"><span class="ws-profile-icon">&#9638;</span><span>My results</span></a><a href="' + appHref("../apps/toolkit/index.html") + '"><span class="ws-profile-icon">&#8962;</span><span>Toolkit</span></a></div>' + adminSection + '<div class="ws-profile-section"><button class="ws-logout" type="button"><span class="ws-profile-icon">&#8618;</span><span>Log out</span></button></div></div></div>' +
      '</div></header>';
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

  function isMobileAuthContext() {
    return window.matchMedia("(max-width: 768px), (pointer: coarse)").matches;
  }

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
      var firebaseAuth = await import(firebaseHref());
      var credential = await firebaseAuth.getGoogleRedirectResult();
      var user = credential && credential.user ? credential.user : null;
      if (!user && sessionStorage.getItem("utl_google_login_pending") === "true") {
        if (message) {
          message.textContent = "Finishing Google sign-in...";
          message.classList.add("ws-success");
        }
        user = await firebaseAuth.getSignedInUser();
      }
      if (!user) return;
      if (message) {
        message.textContent = "Finishing Google sign-in...";
        message.classList.remove("ws-success");
      }
      await finishGoogleUser(firebaseAuth, user, message);
    } catch (error) {
      sessionStorage.removeItem("utl_google_login_pending");
      console.error("Google redirect login failed.", error);
      if (message) message.textContent = error && error.message ? error.message : "Google sign-in did not work.";
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
      var firebaseAuth = await import(firebaseHref());
      if (isMobileAuthContext()) {
        message.classList.add("ws-success");
        message.textContent = "Opening Google sign-in...";
        sessionStorage.setItem("utl_google_login_pending", "true");
        await firebaseAuth.signInWithGoogleRedirect();
        return;
      }
      var credential = await firebaseAuth.signInWithGooglePopup();
      await finishGoogleCredential(firebaseAuth, credential, message);
    } catch (error) {
      console.error("Google member login failed.", error);
      if (error && (error.code === "auth/popup-blocked" || error.code === "auth/popup-closed-by-user")) {
        try {
          var redirectAuth = await import(firebaseHref());
          message.classList.add("ws-success");
          message.textContent = "Opening Google sign-in...";
          sessionStorage.setItem("utl_google_login_pending", "true");
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
      document.body.innerHTML = '<section class="ws-login-wrap"><article class="ws-login-card"><span class="ws-kicker">Member login</span><h1 class="ws-title">Welcome back.</h1><p class="ws-subtitle">Sign in to open your Untaught Lessons workspace.</p><form class="ws-form" id="wsLoginForm"><label for="wsUsername">Username or email</label><input class="ws-input" id="wsUsername" autocomplete="username" required><label for="wsPassword">Password</label><input class="ws-input" id="wsPassword" type="password" autocomplete="current-password" required><button class="ws-button" type="submit">Sign in</button><p class="ws-message" id="wsLoginMessage" aria-live="polite"></p></form><div class="ws-login-divider">or</div><button class="ws-button ws-google-button" id="wsGoogleLogin" type="button"><span class="ws-google-mark" aria-hidden="true"></span><span>Sign in with Google</span></button></article></section>';
      qs("#wsLoginForm").addEventListener("submit", function (event) {
        event.preventDefault();
        handleLogin(event.currentTarget, qs("#wsLoginMessage"));
      });
      qs("#wsGoogleLogin").addEventListener("click", function (event) {
        event.preventDefault();
        handleGoogleLogin(event.currentTarget, qs("#wsLoginMessage"));
      });
      handleGoogleRedirectResult(qs("#wsLoginMessage"));
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
  }

  function homePageHtml() {
    var progress = exerciseProgress();
    return '<div class="ws-home-stack">' + orientationCardHtml() + '<section><div class="ws-section-head"><h2>Your learning journey</h2><span class="ws-count">' + progress.done + ' of ' + progress.total + ' complete</span></div><section class="ws-progress-card"><div class="ws-progress-row"><span>Overall progress</span><span>' + progress.percent + '%</span></div><div class="ws-progress-track"><div class="ws-progress-fill" style="width:' + progress.percent + '%"></div></div></section><section class="ws-phase-list">' + phases.map(phaseJourneyCard).join("") + '</section></section>' + assessmentsSection() + '</div>';
  }

  function orientationCardHtml() {
    var complete = readBool("utl_orientation_ready");
    var open = localStorage.getItem("utl_orientation_open") === null ? !complete : readBool("utl_orientation_open");
    var intro = UTL_CONTENT.orientation.contexts[0] || {};
    var orientation = UTL_CONTENT.orientation.contexts[1] || {};
    var how = UTL_CONTENT.orientation.contexts[2] || {};
    var orientationUrl = orientation.contextUrl || exerciseContextUrl(orientation);
    var welcomeOpen = localStorage.getItem("utl_welcome_video_open") === null ? true : readBool("utl_welcome_video_open");
    var video = orientationUrl ? '<div class="ws-context-embed">' + renderIframe(orientationUrl, orientation.contextTitle) + '</div>' : '<div class="ws-player-card"><div class="ws-player"><div class="ws-player-placeholder"><span class="ws-play-icon">&#9654;</span><p>Orientation video coming soon</p></div></div></div>';
    return '<article class="ws-orientation-card ' + (open ? "ws-open" : "") + '" id="orientation"><button class="ws-orientation-head" type="button" data-orientation-toggle><span class="ws-start-badge">Start here</span><span><span class="ws-orientation-title">Orientation</span><span class="ws-orientation-sub">' + (complete ? "Orientation complete &#10003;" : "Get oriented before jumping into Phase 1") + '</span></span><span class="ws-orientation-chevron ws-disclosure-icon">' + (open ? "&minus;" : "+") + '</span></button><div class="ws-orientation-body"><div class="ws-orientation-copy"><h3>' + escapeHtml(intro.contextTitle || "Welcome") + '</h3>' + textParagraphs(intro.contextBody) + '</div><div class="ws-how-row"><button class="ws-how-toggle" type="button" data-welcome-toggle><span class="ws-media-icon">&#9654;</span><span><strong>' + escapeHtml(orientation.contextTitle || "Welcome to The Untaught Lessons") + '</strong><br><small>' + escapeHtml(orientation.contextBody || "Watch before starting") + '</small></span><span class="ws-disclosure-icon" data-welcome-icon>' + (welcomeOpen ? "&minus;" : "+") + '</span></button><div class="ws-how-body ' + (welcomeOpen ? "ws-open" : "") + '" data-welcome-body>' + video + '</div></div><div class="ws-how-row"><button class="ws-how-toggle" type="button" data-how-toggle><span class="ws-media-icon">i</span><span><strong>How this program works</strong><br><small>Read before starting</small></span><span class="ws-disclosure-icon" data-how-icon>+</span></button><div class="ws-how-body" data-how-body><p>' + escapeHtml(how.contextBody || "Watch the setup, read the context, complete the practice, and mark your progress as you go.") + '</p>' + (exerciseContextUrl(how) ? '<div class="ws-context-embed">' + renderIframe(exerciseContextUrl(how), how.contextTitle) + '</div>' : '') + '</div></div><label class="ws-ready-row"><input type="checkbox" data-orientation-ready ' + (complete ? "checked" : "") + '> <span>I\'ve watched the orientation and I\'m ready to start.</span></label></div></article>';
  }

  function phaseJourneyCard(phaseKey) {
    var number = phaseNumbers[phaseKey];
    var phase = getPhase(phaseKey);
    var unlocked = phaseUnlocked(phaseKey);
    var status = phaseStatus(phaseKey);
    var pillClass = status === "Locked" ? "ws-pill-locked" : status === "In progress" ? "ws-pill-progress" : "ws-pill-muted";
    var href = phaseKey === "phase1" ? phaseFiles.phase1 : phaseFiles[phaseKey];
    return '<article class="ws-phase-card ' + (unlocked ? "" : "ws-locked") + '"><div class="ws-phase-stripe"></div><div class="ws-phase-number">0' + number + '</div><div class="ws-phase-content"><span class="ws-kicker">' + phaseLabels[phaseKey] + '</span><h2>' + escapeHtml(phase.title) + '</h2><p>' + escapeHtml(phaseDescriptions[phaseKey]) + '</p><div class="ws-trail"><span class="ws-dot ' + phaseStepState(phaseKey, "watch") + '"></span>Watch<span class="ws-arrow">&rarr;</span><span class="ws-dot ' + phaseStepState(phaseKey, "practice") + '"></span>Practice</div></div><div class="ws-phase-actions"><span class="ws-pill ' + pillClass + '">' + status + '</span>' + (unlocked ? '<a class="ws-button" href="' + href + '">Continue &rarr;</a>' : '<span class="ws-button ws-disabled">Continue &rarr;</span>') + '</div></article>';
  }

  function assessmentsSection() {
    if (localStorage.getItem("utl_tsa_status") === "hidden") return "";
    return '<section class="ws-section" id="assessments"><div class="ws-section-head"><h2>Assessments</h2><span class="ws-count">TSA Score</span></div><div class="ws-phase-list"><article class="ws-phase-card"><div class="ws-phase-stripe"></div><div class="ws-phase-number">A</div><div class="ws-phase-content"><span class="ws-kicker">Assessment</span><h2>The diagnostic</h2><p>Take the starting assessment when you are ready.</p></div><div class="ws-phase-actions"><a class="ws-button" href="../apps/tsa-diagnostic/index.html">Open &rarr;</a></div></article></div></section>';
  }

  function bindHomePage() {
    var orientationToggle = qs("[data-orientation-toggle]");
    var orientationCard = qs(".ws-orientation-card");
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
    var howToggle = qs("[data-how-toggle]");
    if (howToggle) {
      howToggle.addEventListener("click", function () {
        var body = qs("[data-how-body]");
        if (body) {
          var open = !body.classList.contains("ws-open");
          body.classList.toggle("ws-open", open);
          var icon = qs("[data-how-icon]");
          if (icon) icon.innerHTML = open ? "&minus;" : "+";
        }
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
    var ready = qs("[data-orientation-ready]");
    if (ready && orientationCard) {
      ready.addEventListener("change", function () {
        writeBool("utl_orientation_ready", ready.checked);
        queueRemoteProgressSave();
        if (ready.checked) {
          setTimeout(function () {
            orientationCard.classList.remove("ws-open");
            writeBool("utl_orientation_open", false);
            queueRemoteProgressSave();
            var sub = qs(".ws-orientation-sub");
            var chevron = qs(".ws-orientation-chevron");
            if (sub) sub.innerHTML = "Orientation complete &#10003;";
            if (chevron) chevron.innerHTML = "+";
          }, 550);
        }
      });
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

  function stepTabs(active) {
    return '<div class="ws-step-tabs"><div class="ws-step-tabs-inner"><a class="ws-step-tab ' + (active === "watch" ? "ws-active" : "") + '" href="' + memberHref("phase-1.html") + '">Step 1 &middot; Watch the lessons</a><a class="ws-step-tab ' + (active === "practice" ? "ws-active" : "") + '" href="' + memberHref("phase-1/practice/index.html") + '">Step 2 &middot; Practice the exercises</a></div></div>';
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
      pageShell(phaseKey, phaseOneWatchHeader() + videoSection(phaseKey, activeId) + '<div class="ws-gold-cta"><span>When you\'re done &rarr;</span><a href="' + memberHref("phase-1/practice/index.html") + '">Go to Practice the Exercises</a></div>', stepTabs("watch"));
    } else {
      pageShell(phaseKey, phaseHeader(phaseKey) + videoSection(phaseKey, activeId) + exerciseSection(phaseKey) + bottomPhaseNav(phaseKey));
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
    var body = phaseOnePracticeHeader() + '<div class="ws-practice-reminder">Haven\'t watched the lessons yet? <a href="' + memberHref("phase-1.html") + '">Start with Step 1 &rarr;</a></div><section class="ws-practice-list">' + phaseOnePracticeCards() + '</section>';
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
    return '<div class="ws-context-embed">' + renderIframe(url, exercise.contextTitle || exercise.title) + '</div>';
  }

  function practiceCard(cardId, exercise, aiExercise, defaultOpen) {
    var open = localStorage.getItem("utl_practice_open_" + cardId) === null ? defaultOpen : readBool("utl_practice_open_" + cardId);
    var activeTab = localStorage.getItem("utl_practice_tab_" + cardId) || "start";
    var hint = activeTab === "ai" ? 'Watch the AI setup &mdash; then compare how prompting changes the shape of the work.' : 'Start here first &mdash; then compare your work with <span>AI &#10022;</span>';
    return '<article class="ws-practice-card ' + (open ? "ws-open" : "") + '" data-practice-card="' + cardId + '"><button class="ws-practice-head" type="button" data-practice-toggle="' + cardId + '"><span><span class="ws-kicker">' + escapeHtml(exercise.type) + '</span><h3>' + escapeHtml(exercise.title) + '</h3><p>' + escapeHtml(exercise.description) + '</p></span><span class="ws-practice-chevron">' + (open ? "&minus;" : "+") + '</span></button><div class="ws-practice-body"><div class="ws-exercise-tabs" role="tablist" aria-label="' + escapeHtml(exercise.title) + ' exercise modes"><button class="ws-exercise-tab ' + (activeTab === "ai" ? "" : "ws-active") + '" type="button" role="tab" data-practice-tab="' + cardId + '" data-tab-value="start"><span class="ws-tab-badge">1</span><span>Start here</span></button><button class="ws-exercise-tab ' + (activeTab === "ai" ? "ws-active" : "") + '" type="button" role="tab" data-practice-tab="' + cardId + '" data-tab-value="ai"><span class="ws-tab-badge">2</span><span>Try with AI &#10022;</span></button></div><p class="ws-tab-hint" data-tab-hint="' + cardId + '">' + hint + '</p><div class="ws-practice-pane ' + (activeTab === "ai" ? "" : "ws-active") + '" data-tab-pane="' + cardId + '" data-tab-panel="start"><div class="ws-before-block"><h4>Before you start</h4><p>' + escapeHtml(exercise.contextBody) + '</p></div>' + mediaPreview(exercise) + '<a class="ws-button ws-button-navy" href="' + appHref(exercise.appUrl) + '" data-exercise-visit="' + exercise.id + '">Start exercise &rarr;</a></div><div class="ws-practice-pane ' + (activeTab === "ai" ? "ws-active" : "") + '" data-tab-pane="' + cardId + '" data-tab-panel="ai"><div class="ws-ai-context"><h4>Now try it with AI</h4><p>You\'ve completed the exercise yourself. Now see how AI handles the same task &mdash; and how the prompt you give it shapes the output you get back.</p></div><a class="ws-ai-link-card" href="' + appHref(aiExercise.appUrl) + '" data-exercise-visit="' + aiExercise.id + '"><span class="ws-ai-icon">&#128203;</span><span><strong>' + escapeHtml(exercise.title) + ' &mdash; AI exercise</strong><small>Prompt guide + walkthrough</small></span><span class="ws-ai-arrow">&rarr;</span></a><a class="ws-button ws-button-gold" href="' + appHref(aiExercise.appUrl) + '" data-exercise-visit="' + aiExercise.id + '">Open AI exercise &rarr;</a></div></div></article>';
  }

  function singlePracticeCard(cardId, exercise, defaultOpen) {
    var open = localStorage.getItem("utl_practice_open_" + cardId) === null ? defaultOpen : readBool("utl_practice_open_" + cardId);
    return '<article class="ws-practice-card ' + (open ? "ws-open" : "") + '" data-practice-card="' + cardId + '"><button class="ws-practice-head" type="button" data-practice-toggle="' + cardId + '"><span><span class="ws-kicker">' + escapeHtml(exercise.type) + '</span><h3>' + escapeHtml(exercise.title) + '</h3><p>' + escapeHtml(exercise.description) + '</p></span><span class="ws-practice-chevron">' + (open ? "&minus;" : "+") + '</span></button><div class="ws-practice-body"><div class="ws-before-block"><h4>Before you start</h4><p>' + escapeHtml(exercise.contextBody) + '</p></div><div class="ws-practice-pane ws-active">' + mediaPreview(exercise) + '<a class="ws-button ws-button-navy" href="' + appHref(exercise.appUrl) + '" data-exercise-visit="' + exercise.id + '">Start exercise &rarr;</a></div></div></article>';
  }

  function contextOnlyPracticeCard(cardId, context, defaultOpen) {
    if (!context) return "";
    var open = localStorage.getItem("utl_practice_open_" + cardId) === null ? defaultOpen : readBool("utl_practice_open_" + cardId);
    return '<article class="ws-practice-card ' + (open ? "ws-open" : "") + '" data-practice-card="' + cardId + '"><button class="ws-practice-head" type="button" data-practice-toggle="' + cardId + '"><span><span class="ws-kicker">Context</span><h3>' + escapeHtml(context.contextTitle) + '</h3><p>' + escapeHtml(context.contextBody) + '</p></span><span class="ws-practice-chevron">' + (open ? "&minus;" : "+") + '</span></button><div class="ws-practice-body">' + mediaPreview(context) + '</div></article>';
  }

  function bindPracticePage() {
    bindContextToggles();
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
        if (hint) hint.innerHTML = value === "ai" ? 'Watch the AI setup &mdash; then compare how prompting changes the shape of the work.' : 'Start here first &mdash; then compare your work with <span>AI &#10022;</span>';
      });
    });
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
      return '<section class="ws-section"><div class="ws-collapsed" data-rewatch-toggle><span class="ws-video-toggle-icon">&#9654;</span><div><h3>Watch the Lessons</h3><p>All ' + lessons.length + ' watched &middot; click to rewatch</p></div><span class="ws-pill ws-pill-green">Done</span><span class="ws-context-toggle-icon" data-rewatch-symbol>+</span></div><div class="ws-rewatch" id="wsRewatch">' + rewatchPlayer(phaseKey, active.id) + '</div></section>';
    }
    var url = lessonUrl(active);
    var player = url ? renderIframe(url, active.title) : '<div class="ws-player-placeholder"><div class="ws-play-icon">&#9654;</div><h2>' + escapeHtml(active.title) + '</h2><p>Video coming soon</p></div>';
    return '<section class="ws-section ' + (activeWatched ? "ws-video-complete" : "") + '"><div class="ws-section-head"><h2>Watch the Lessons</h2><span class="ws-count">' + count + ' of ' + lessons.length + ' watched</span></div><div class="ws-player-card"><div class="ws-player">' + player + '<div class="ws-player-meta"><span class="ws-kicker">Lesson ' + (lessons.indexOf(active) + 1) + ' of ' + lessons.length + ' &middot; Phase ' + number + '</span><h3>' + escapeHtml(active.title) + '</h3></div></div><div class="ws-rail-wrap">' + lessonRail(phaseKey, active.id, false) + '</div></div></section>';
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
    return '<div class="ws-player-card"><div class="ws-player">' + player + '<div class="ws-player-meta"><span class="ws-kicker">Rewatch lesson</span><h3>' + escapeHtml(active.title) + '</h3></div></div><div class="ws-rail-wrap">' + lessonRail(phaseKey, active.id, false) + '</div></div>';
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
      return contextBlock(context);
    }).join("") + '</div>';
  }

  function exerciseSection(phaseKey) {
    var phase = getPhase(phaseKey);
    var doneVideos = videosDone(phaseKey);
    return '<section class="ws-section ws-exercises" id="exercises"><div class="ws-section-head"><h2>Practice the Exercises</h2><span class="ws-count">' + phase.exercises.filter(function (exercise) { return exerciseDone(exercise); }).length + ' of ' + phase.exercises.length + ' done</span></div>' + introContextSection(phaseKey) + '<div class="ws-exercise-stack">' + phase.exercises.map(function (exercise) {
      if (phaseKey === "phase2" && exercise.id === "p2-e6") return "";
      if (phaseKey === "phase2" && exercise.id === "p2-e5") return stackedExerciseUnit(phaseKey, [exercise, getPhase(phaseKey).exercises.find(function (item) { return item.id === "p2-e6"; })], doneVideos);
      return exerciseUnit(phaseKey, exercise, doneVideos);
    }).join("") + '</div></section>';
  }

  function contextBlock(context) {
    return '<article class="ws-unit">' + contextPanelHtml(context) + '</article>';
  }

  function contextPanelHtml(context) {
    var contextType = exerciseContextType(context);
    var contextUrl = exerciseContextUrl(context);
    var open = readBool("utl_ctx_open_" + context.id);
    var media = "";
    if (contextType === "video") {
      media = contextUrl ? '<div class="ws-context-embed">' + renderIframe(contextUrl, context.contextTitle) + '</div>' : '<div class="ws-media-row ws-missing"><span class="ws-media-icon">&#9654;</span><span>Context video coming soon</span></div>';
    } else if (contextType === "slides") {
      media = contextUrl ? '<div class="ws-context-embed">' + renderIframe(contextUrl, context.contextTitle) + '</div>' : '<div class="ws-media-row ws-missing"><span class="ws-media-icon">&#9635;</span><span>Slides coming soon</span></div>';
    }
    return '<button class="ws-context-toggle" type="button" data-context-toggle="' + context.id + '" aria-expanded="' + (open ? "true" : "false") + '"><span class="ws-context-toggle-icon">' + (open ? "&minus;" : "+") + '</span><span><span class="ws-context-toggle-title">' + escapeHtml(context.contextTitle) + '</span><span class="ws-context-toggle-sub">Read before starting</span></span></button><div class="ws-context-panel ' + (open ? "ws-open" : "") + '" data-context-panel="' + context.id + '"><div class="ws-context-panel-inner"><p>' + escapeHtml(context.contextBody) + '</p>' + media + '</div></div>';
  }

  function exerciseUnit(phaseKey, exercise, enabled) {
    var contextType = exerciseContextType(exercise);
    var contextUrl = exerciseContextUrl(exercise);
    var done = exerciseDone(exercise);
    var open = readBool("utl_ctx_open_" + exercise.id);
    var media = "";
    if (contextType === "video") {
      media = contextUrl ? '<div class="ws-context-embed">' + renderIframe(contextUrl, exercise.contextTitle) + '</div>' : '<div class="ws-media-row ws-missing"><span class="ws-media-icon">&#9654;</span><span>Context video coming soon</span></div>';
    } else if (contextType === "slides") {
      media = contextUrl ? '<div class="ws-context-embed">' + renderIframe(contextUrl, exercise.contextTitle) + '</div>' : '<div class="ws-media-row ws-missing"><span class="ws-media-icon">&#9635;</span><span>Slides coming soon</span></div>';
    }
    return contextBlock(exercise).replace("</article>", '<div class="ws-workbook-card ' + (done ? "ws-done " : "") + (enabled ? "" : "ws-disabled") + '"><div class="ws-workbook-top"><span class="ws-status-circle">' + (done ? "&#10003;" : phaseNumbers[phaseKey]) + '</span><span>' + phaseLabels[phaseKey] + ' | ' + escapeHtml(getPhase(phaseKey).title) + '</span>' + (done ? '<span class="ws-done-pill"><span>&#10003;</span><span>Done</span></span>' : "") + '</div><h3>' + escapeHtml(exercise.title) + '</h3><p>' + escapeHtml(exercise.description) + '</p><div class="ws-card-actions"><a class="ws-button" href="' + escapeHtml(exercise.appUrl) + '" data-exercise-visit="' + exercise.id + '">' + (enabled ? "Open tool" : "Watch all videos to unlock") + '</a>' + (enabled ? '<button class="ws-button ws-button-secondary" type="button" data-exercise-done="' + exercise.id + '">' + (done ? "Click to undo" : "Mark as done") + '</button>' : "") + '</div></div></article>');
  }

  function stackedExerciseUnit(phaseKey, exercises, enabled) {
    var items = exercises.filter(Boolean);
    return '<article class="ws-unit ws-stacked-unit">' + items.map(function (exercise) {
      var done = exerciseDone(exercise);
      return contextPanelHtml(exercise) + '<div class="ws-workbook-card ' + (done ? "ws-done " : "") + (enabled ? "" : "ws-disabled") + '"><div class="ws-workbook-top"><span class="ws-status-circle">' + (done ? "&#10003;" : phaseNumbers[phaseKey]) + '</span><span>' + phaseLabels[phaseKey] + ' | ' + escapeHtml(getPhase(phaseKey).title) + '</span>' + (done ? '<span class="ws-done-pill"><span>&#10003;</span><span>Done</span></span>' : "") + '</div><h3>' + escapeHtml(exercise.title) + '</h3><p>' + escapeHtml(exercise.description) + '</p><div class="ws-card-actions"><a class="ws-button" href="' + escapeHtml(exercise.appUrl) + '" data-exercise-visit="' + exercise.id + '">' + (enabled ? "Open tool" : "Watch all videos to unlock") + '</a>' + (enabled ? '<button class="ws-button ws-button-secondary" type="button" data-exercise-done="' + exercise.id + '">' + (done ? "Click to undo" : "Mark as done") + '</button>' : "") + '</div></div>';
    }).join("") + '</article>';
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
        queueRemoteProgressSave();
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
        queueRemoteProgressSave();
        renderPhasePage(phaseKey);
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
    qsa("[data-exercise-visit]").forEach(function (link) {
      link.addEventListener("click", function () {
        writeBool(visitedKey(link.getAttribute("data-exercise-visit")), true);
        saveRemoteProgressNow();
      });
    });
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
    pageShell("admin", '<span class="ws-pill ws-pill-gold">Admin &middot; content manager</span><h1 class="ws-title">Manage videos and context</h1><p class="ws-subtitle">Update video URLs and context links for each phase. Paste a Google Drive share link or Vimeo URL. Changes are saved to your browser and override the defaults.</p>' + visibilityHtml() + '<section class="ws-admin-grid">' + adminAccordionHtml() + '</section><div class="ws-save-bar"><div class="ws-shell ws-save-bar-inner"><span class="ws-count">Changes are saved per field and take effect immediately.</span><button class="ws-button" id="wsSaveAll">Save all changes</button></div></div>');
    bindAdmin();
  }

  function visibilityHtml() {
    var phase2Visible = localStorage.getItem("utl_phase2_status") !== "hide";
    var phase3Visible = localStorage.getItem("utl_phase3_status") !== "hide";
    var previewUnlocked = localStorage.getItem("utl_admin_preview_bypass") === "on";
    return '<section class="ws-admin-visibility"><span class="ws-kicker">Learner release gates</span><label class="ws-check-row"><input type="checkbox" data-visibility-phase="utl_phase2_status" ' + (phase2Visible ? "checked" : "") + '><span>Release Phase 2 after Phase 1 is complete</span></label><p class="ws-help">Use this to hold Phase 2 until its videos, context, and exercises are ready. Learners still need to complete Phase 1 before it opens.</p><label class="ws-check-row"><input type="checkbox" data-visibility-phase="utl_phase3_status" ' + (phase3Visible ? "checked" : "") + '><span>Release Phase 3 after Phase 2 is complete</span></label><p class="ws-help">Use this to hold Phase 3 until its videos, context, and exercises are ready. Learners still need to complete Phase 2 before it opens.</p><label class="ws-check-row"><input type="checkbox" data-visibility-phase="utl_admin_preview_bypass" ' + (previewUnlocked ? "checked" : "") + '><span>Unlock all phases for admin preview</span></label><p class="ws-help">For admins only. When on, Phase 2 and Phase 3 open immediately while you preview the member area.</p></section>';
  }

  function adminAccordionHtml() {
    var orientation = '<article class="ws-admin-phase ws-open"><button class="ws-admin-toggle" type="button"><span class="ws-admin-num">00</span><span><span class="ws-kicker">Orientation</span><strong>Welcome</strong><br><small>2 context sections &middot; 0 exercises</small></span><span class="ws-disclosure-icon">&minus;</span></button><div class="ws-admin-body"><p class="ws-help">Orientation is context-only and has no separate lesson video.</p></div></article>';
    return orientation + phases.map(function (phaseKey) {
      var phase = getPhase(phaseKey);
      return '<article class="ws-admin-phase"><button class="ws-admin-toggle" type="button"><span class="ws-admin-num">0' + phaseNumbers[phaseKey] + '</span><span><span class="ws-kicker">' + phaseLabels[phaseKey] + '</span><strong>' + escapeHtml(phase.title) + '</strong><br><small>' + phase.lessons.length + ' lessons &middot; ' + phase.exercises.length + ' exercises</small></span><span class="ws-disclosure-icon">+</span></button><div class="ws-admin-body"><h3>Lesson videos</h3>' + phase.lessons.map(function (lesson, index) {
        return '<div class="ws-slot"><div class="ws-slot-head"><strong>Lesson ' + (index + 1) + ': ' + escapeHtml(lesson.title) + '</strong><span class="ws-pill ws-pill-muted">' + escapeHtml(lesson.duration) + '</span></div><div class="ws-save-row"><input class="ws-input" data-storage-key="utl_url_' + lesson.id + '" placeholder="Paste Google Drive or Vimeo URL" value="' + escapeHtml(lessonUrl(lesson)) + '"><button class="ws-button ws-button-navy" data-save-field type="button">Save</button></div><span class="ws-save-note"></span></div>';
      }).join("") + '<h3>Exercise context</h3>' + phase.exercises.map(function (exercise) {
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
