const assert = require('node:assert/strict');
const fs = require('node:fs');

const page = fs.readFileSync('apps/lets-switch-hats/index.html', 'utf8');
const badNewsPage = fs.readFileSync('apps/i-have-bad-news/index.html', 'utf8');
const guide = fs.readFileSync('assets/custom-gpt-voice-guide.js', 'utf8');

assert(!page.includes('gemini.google.com'), 'Let’s switch hats no longer links to Gemini');
assert(!/Michael Gem|Michael Felipe|two custom AI bots/i.test(page), 'Michael and two-bot instructions are removed');
assert(page.includes('chatgpt.com/g/'), 'the Custom GPT remains the single AI practice path');
assert(page.includes('data-custom-gpt-voice-guide'), 'Let’s switch hats launches the reusable guide');
assert(badNewsPage.includes('data-custom-gpt-voice-guide'), 'Difficult conversations launches the reusable guide');
assert(page.includes('custom-gpt-voice-guide.js'), 'Let’s switch hats loads the guide module');
assert(badNewsPage.includes('custom-gpt-voice-guide.js'), 'Difficult conversations loads the guide module');
assert(guide.includes('Select the blue voice button'), 'the voice control is identified visually');
assert(guide.includes('Allow microphone access'), 'microphone permission is explained');
assert(guide.includes('Continue with text instead'), 'text practice remains available');
assert(guide.includes('Do not show these instructions again'), 'repeat learners can skip the guide');
assert(guide.includes('utl-voice-button-highlight'), 'the blue voice control has a highlighted callout');
assert(page.includes('data-custom-gpt-voice-help'), 'Let’s switch hats keeps a way to reopen the guide');
assert(badNewsPage.includes('data-custom-gpt-voice-help'), 'Difficult conversations keeps a way to reopen the guide');
assert(page.includes('id="completeExerciseBtn"'), 'completion and MP action remains available');

console.log('Custom GPT voice guidance contract passed');
