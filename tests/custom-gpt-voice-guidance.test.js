const assert = require('node:assert/strict');
const fs = require('node:fs');

const page = fs.readFileSync('apps/lets-switch-hats/index.html', 'utf8');
const badNewsPage = fs.readFileSync('apps/i-have-bad-news/index.html', 'utf8');
// Difficult conversations moved from the CustomGPT to a copied prompt in the learner's own ChatGPT or Gemini (2026-10-08).
const guide = fs.readFileSync('assets/custom-gpt-voice-guide.js', 'utf8');

// Let's switch hats moved from the CustomGPT to a copied prompt in the learner's own ChatGPT or Gemini (2026-10-08).
assert(page.includes('gemini.google.com') && page.includes('chatgpt.com/'), 'Let’s switch hats opens the learner\'s own ChatGPT or Gemini');
assert(!/Michael Gem|two custom AI bots/i.test(page), 'the old Gem and two-bot instructions are not shown');
assert(/Michael Felipe/.test(page), 'the Olympic project case with Michael Felipe is the recommended practice');
assert(!page.includes('chatgpt.com/g/'), 'Let’s switch hats no longer links to a CustomGPT');
assert(guide.includes('Select the blue voice button'), 'the voice control is identified visually');
assert(guide.includes('Allow microphone access'), 'microphone permission is explained');
assert(guide.includes('Continue with text instead'), 'text practice remains available');
assert(guide.includes('Do not show these instructions again'), 'repeat learners can skip the guide');
assert(guide.includes('utl-voice-button-highlight'), 'the blue voice control has a highlighted callout');
assert(!badNewsPage.includes('chatgpt.com/g/'), 'Difficult conversations no longer links to a CustomGPT');
assert(page.includes('id="completeExerciseBtn"'), 'completion and MP action remains available');

console.log('Custom GPT voice guidance contract passed');
