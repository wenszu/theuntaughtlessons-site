const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('apps/speak-like-obama/index.html', 'utf8');
const workspace = fs.readFileSync('member-login/content-config.js', 'utf8');

assert(app.includes("const PRACTICE_ATTEMPTS_KEY = 'utl_speak_like_obama_practice_attempts'"), 'practice attempts have a separate stable local key');
assert(app.includes("const PRACTICE_WORKSPACES_KEY = 'utl_speak_like_obama_practice_workspaces'"), 'unfinished practice is restorable per topic, not a single overwritable slot');
assert(app.includes("'In progress'"), 'the topic picker distinguishes an unfinished draft from a never-started topic');
assert(app.includes('Optional practice · no additional MP'), 'optional practice clearly states that it does not award MP');
assert(app.includes('Choose a speaking situation.'), 'practice starts with a topic picker');
assert(app.includes('Your preparation notes'), 'practice uses one open preparation box');
assert(app.includes('Start 60-second preparation'), 'the preparation timer requires an explicit start');
assert(app.includes('What will you improve in your next speech?'), 'saving practice requires an improvement commitment');
assert(app.includes('Practice another speech'), 'completion offers another optional round');
assert(app.includes('id="completeExerciseStatus"'), 'completed core exercise uses a quiet status instead of a duplicate practice action');
assert(app.includes("document.getElementById('completeExerciseBtn').hidden") || app.includes('button.hidden = true'), 'the original completion action is removed after completion');
assert(app.includes('Practice this topic again'), 'completed topics can be repeated without overwriting the prior round');
assert(app.includes("localStorage.setItem(PRACTICE_ATTEMPTS_KEY"), 'completed rounds are saved separately');
assert(!/award(?:Completion|Reflection|Scored)Exercise\([\s\S]{0,350}PRACTICE_ATTEMPTS_KEY/.test(app), 'optional practice does not issue a reward event');

const topicIds = [...app.matchAll(/^\s+id: '([^']+)',$/gm)].map((match) => match[1]);
assert.equal(topicIds.length, 8, 'the curated bank contains eight practice situations');
assert(topicIds.includes('fairer-group-projects'), 'the bank includes a school situation');
assert(topicIds.includes('phone-free-hour'), 'the bank includes an everyday situation');
assert(topicIds.includes('shared-space'), 'the bank includes a community situation');
assert(topicIds.includes('delayed-project'), 'the bank includes a work or organized-activity situation');

assert(workspace.includes('function speakingPracticeState()'), 'Learning Journey reads optional speaking state');
assert(workspace.includes('utl_speak_like_obama_practice_workspaces'), 'Learning Journey reads the same per-topic workspace key the app writes');
assert(workspace.includes('Practice another speech'), 'completed Learning Journey preview offers optional speaking practice');
assert(workspace.includes('Resume practice'), 'Learning Journey resumes an unfinished speaking draft');
assert(workspace.includes('Review original speech'), 'Learning Journey can reopen the required speech');

console.log('Speak like Obama optional practice contracts passed');
