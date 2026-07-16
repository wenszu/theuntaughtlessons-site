const assert = require('node:assert/strict');
const fs = require('node:fs');

const rewardUi = fs.readFileSync('assets/reward-ui.js', 'utf8');
const appHeader = fs.readFileSync('assets/app-reward-header.js', 'utf8');
const workspace = fs.readFileSync('member-login/content-config.js', 'utf8');
const messyNotes = fs.readFileSync('apps/messy-notes/index.html', 'utf8');
const scqa = fs.readFileSync('apps/scqa-builder/index.html', 'utf8');
const styles = fs.readFileSync('styles.css', 'utf8');
const tactileButtons = fs.readFileSync('assets/tactile-buttons.js', 'utf8');

assert(rewardUi.includes('data-award-stage="takeaway"'), 'exercise completion includes a takeaway stage');
assert(rewardUi.includes('Continue in your workspace'), 'exercise completion leads learners back into the program');
assert(rewardUi.includes('Phase '), 'exercise completion reports phase progress');
assert(rewardUi.includes('activities in today’s mission'), 'exercise completion reports daily mission progress when set');
assert(appHeader.includes('makeAttemptsCollapsible'), 'shared exercise UI collapses previous attempts');
assert(appHeader.includes('overflow-x:clip'), 'shared exercise UI guards against horizontal overflow');
assert(styles.includes('overflow-x: clip'), 'public pages guard against horizontal overflow');
assert(workspace.includes('program’s Day '), 'workspace explains the learner’s program pace');
assert(workspace.includes('Intern, Analyst, Associate, Principal, and Executive'), 'workspace explains the five levels');
assert(messyNotes.includes('contextViewTab'), 'messy notes can switch between source note and context');
assert(scqa.includes('secondScqaModal'), 'SCQA confirms the learner will take a different angle');
assert(scqa.includes('secondScqaAcknowledged: false'), 'SCQA confirmation begins unacknowledged');
assert(scqa.includes('if (state.secondScqaAcknowledged) goToScreen(3)'), 'SCQA confirmation only interrupts the first transition');
assert(scqa.includes('state.secondScqaAcknowledged = true'), 'SCQA saves the learner’s acknowledgement');
assert(scqa.includes('.form-header p { width: 100%; max-width: none;'), 'SCQA instructions use the available content width');
assert(!scqa.includes('How to make this one different'), 'SCQA avoids repeating the second-formulation guidance');
const appHtml = fs.readdirSync('apps').filter((name) => fs.existsSync(`apps/${name}/index.html`)).map((name) => fs.readFileSync(`apps/${name}/index.html`, 'utf8')).join('\n');
const shadowTokens = [...appHtml.matchAll(/--(?:eisenhower-|lsh-|slo-|bad-news-)?shadow:\s*([^;]+);/g)];
assert(shadowTokens.every((match) => match[1].trim() === 'none'), 'standalone exercise card-shadow tokens are disabled');
assert(!tactileButtons.includes('box-shadow:0 5px 0'), 'buttons no longer use decorative offset shadows');
assert(!rewardUi.includes('12px 12px 0 rgba(238,163,32,.18)'), 'exercise awards do not use a decorative offset shadow');
assert(workspace.includes('.ws-practice-card{box-shadow:none}'), 'workspace cards use borders instead of decorative elevation');

console.log('weekly audit completion, pacing, overflow, and exercise UX contracts passed');
