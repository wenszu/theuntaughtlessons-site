const assert = require('node:assert/strict');
const fs = require('node:fs');

const page = fs.readFileSync('apps/lets-switch-hats/index.html', 'utf8');

assert(!page.includes('gemini.google.com'), 'Let’s switch hats no longer links to Gemini');
assert(!/Michael Gem|Michael Felipe|two custom AI bots/i.test(page), 'Michael and two-bot instructions are removed');
assert(page.includes('chatgpt.com/g/'), 'the Custom GPT remains the single AI practice path');
assert(page.includes('Use ChatGPT voice mode'), 'the page introduces voice mode');
assert(page.includes('black voice button with the white waveform'), 'the voice control is identified visually');
assert(page.includes('allow ChatGPT to use your microphone'), 'microphone permission is explained');
assert(page.includes('lsh-voice-steps'), 'spoken practice uses a concise reusable step pattern');
assert(page.includes('id="completeExerciseBtn"'), 'completion and MP action remains available');

console.log('Custom GPT voice guidance contract passed');
