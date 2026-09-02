/**
 * Recaptures the five annotated screenshots used inside the welcome walkthrough
 * (member-login/content-config.js -> UTL_CONTENT.welcomeWalkthrough.steps):
 *   - the "diagnostic" step's diagnostic-nudge card
 *   - the "phases" step's Learning Journey header / progress-dots row
 *   - the "dailyGoal" step's Today's Mission plan-picker card
 *   - the "levels" step's header Level/MP reward cluster
 *   - the "cohortStanding" step's anonymous cohort panel
 *
 * Run this after any redesign of the Learning Journey header, the Program path
 * section, the journey progress dots, the diagnostic nudge card, the Today's
 * Mission popup, or the reward cluster -- anything that would make the embedded
 * screenshots look out of date. The admin console's "Welcome walkthrough
 * screenshots" panel (Preview & Health tab) lists the current capture dates so
 * you know when a review is due.
 *
 * One-time setup (this project has no package.json / npm dependencies otherwise):
 *   npm install playwright
 *   npx playwright install chromium
 *
 * Usage (from the repo root, with a local static server already running):
 *   python3 -m http.server 8061 &
 *   node scripts/capture-walkthrough-screenshots.js
 *
 * Override the local server URL with WALKTHROUGH_BASE_URL if you're not using
 * port 8061.
 *
 * This script only writes image files into assets/walkthrough/. It does NOT
 * edit content-config.js for you -- it prints the exact `screenshot: {...}`
 * object literal for each step so you can review and paste it in yourself.
 */

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (error) {
  console.error('Playwright is not installed in this project.');
  console.error('One-time setup:\n  npm install playwright\n  npx playwright install chromium');
  process.exit(1);
}

const path = require('path');
const fs = require('fs');

const BASE_URL = process.env.WALKTHROUGH_BASE_URL || 'http://127.0.0.1:8061';
const OUT_DIR = path.resolve(__dirname, '..', 'assets', 'walkthrough');
const DATE = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, matches capturedOn format
const DATE_STAMP = DATE.replace(/-/g, ''); // YYYYMMDD, used in filenames

fs.mkdirSync(OUT_DIR, { recursive: true });

function forceShowAssessmentJourneyAndHidePopups(page) {
  return page.evaluate(() => {
    document.querySelectorAll('[data-assessment-journey]').forEach((el) => { el.style.display = ''; });
    document.querySelector('[data-mission-overlay]')?.classList.add('ws-hidden');
    document.querySelector('[data-walkthrough-overlay]')?.classList.add('ws-hidden');
  });
}

function pct(part, whole) {
  return ((part / whole) * 100).toFixed(2) + '%';
}

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 2 })).newPage();
  const results = [];

  // --- "phases" step: Learning Journey header (with progress dots) ---
  await page.goto(`${BASE_URL}/member-login/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('utl_member_unlocked', 'true');
    localStorage.setItem('utl_member_profile', JSON.stringify({ firstName: 'Jordan', lastName: 'Rivera', email: 'jordan@example.com' }));
    localStorage.setItem('utl_member_username', 'jordan@example.com');
    localStorage.setItem('utl_welcome_walkthrough_seen', 'true');
    localStorage.setItem('utl_orientation_open', 'false'); // collapsed, for a compact shot
  });
  await page.reload();
  await page.waitForSelector('.ws-learning-heading', { state: 'attached' });
  await page.waitForTimeout(700);
  await forceShowAssessmentJourneyAndHidePopups(page);
  await page.waitForTimeout(200);

  {
    const headerEl = await page.$('.ws-learning-heading');
    const headerBox = await headerEl.boundingBox();
    const dotsBox = await (await page.$('.ws-journey-milestone-dots')).boundingBox();
    const file = `learning-journey-header-${DATE_STAMP}.png`;
    await headerEl.screenshot({ path: path.join(OUT_DIR, file) });
    results.push({
      step: 'phases',
      file,
      screenshot: {
        src: `../assets/walkthrough/${file}`,
        alt: 'The Learning Journey page header, with the 6-step progress dots highlighted',
        capturedOn: DATE,
        cutout: {
          top: pct(dotsBox.y - headerBox.y, headerBox.height),
          left: pct(dotsBox.x - headerBox.x, headerBox.width),
          width: pct(dotsBox.width, headerBox.width),
          height: pct(dotsBox.height, headerBox.height)
        }
      }
    });
  }

  // --- "cohortStanding" step: the anonymized ranking panel opened from MP ---
  await page.evaluate(() => {
    const mount = document.querySelector('#wsRewardCluster');
    window.UTLRewardUI.renderCluster(mount, {
      state: { mpTotal: 540, streakDays: 2, level: 'Analyst', earnedByType: {} },
      cohortLoader: async (metric) => ({
        state: 'ready', metric, cohortSize: 6, generatedAt: new Date().toISOString(),
        you: { rank: 3, tiedCount: 1, percent: 42, mp: 540, level: 'Analyst', done: 12, total: 29 },
        next: metric === 'mp' ? { difference: 35 } : { difference: 3, activities: 2 },
        entries: [
          { rank: 1, value: metric === 'mp' ? 640 : 55 },
          { rank: 2, value: metric === 'mp' ? 575 : 48 },
          { rank: 3, isYou: true, value: metric === 'mp' ? 540 : 42 },
          { rank: 4, isTied: true, value: metric === 'mp' ? 510 : 35 },
          { rank: 4, isTied: true, value: metric === 'mp' ? 510 : 35 }
        ]
      })
    });
    mount.querySelector('[data-utl-reward-tab="cohort"]').click();
  });
  await page.waitForSelector('.utl-standing-list', { state: 'attached' });
  await page.waitForTimeout(200);

  {
    const panelEl = await page.$('.utl-mp-breakdown.is-cohort-enabled');
    const panelBox = await panelEl.boundingBox();
    const padding = 24;
    const clip = {
      x: Math.max(0, panelBox.x - 430),
      y: Math.max(0, panelBox.y - padding),
      width: Math.min(1000, panelBox.width + 430 + padding),
      height: Math.min(900, panelBox.height + padding * 2)
    };
    const file = `cohort-standing-${DATE_STAMP}.png`;
    await page.screenshot({ path: path.join(OUT_DIR, file), clip });
    results.push({
      step: 'cohortStanding',
      file,
      screenshot: {
        src: `../assets/walkthrough/${file}`,
        alt: 'The anonymous Cohort standing panel opened from the Mastery Points display',
        capturedOn: DATE,
        cutout: {
          top: pct(panelBox.y - clip.y, clip.height),
          left: pct(panelBox.x - clip.x, clip.width),
          width: pct(panelBox.width, clip.width),
          height: pct(panelBox.height, clip.height)
        }
      }
    });
  }

  // --- "diagnostic" step: the assessment nudge card, with its "Take diagnostic" CTA highlighted ---
  await page.evaluate(() => { localStorage.setItem('utl_orientation_ready', 'true'); }); // reveals the nudge card
  await page.reload();
  await page.waitForSelector('#ws-nudge-continue', { state: 'attached' });
  await page.waitForTimeout(700);
  await forceShowAssessmentJourneyAndHidePopups(page);
  await page.waitForTimeout(200);

  {
    const nudgeEl = await page.$('#ws-nudge-continue');
    const nudgeBox = await nudgeEl.boundingBox();
    const ctaBox = await (await page.$('#ws-nudge-continue .ws-button')).boundingBox();
    const file = `diagnostic-nudge-${DATE_STAMP}.png`;
    await nudgeEl.screenshot({ path: path.join(OUT_DIR, file) });
    results.push({
      step: 'diagnostic',
      file,
      screenshot: {
        src: `../assets/walkthrough/${file}`,
        alt: 'The diagnostic nudge card on the Learning Journey page, with the "Take diagnostic" button highlighted',
        capturedOn: DATE,
        cutout: {
          top: pct(ctaBox.y - nudgeBox.y, nudgeBox.height),
          left: pct(ctaBox.x - nudgeBox.x, nudgeBox.width),
          width: pct(ctaBox.width, nudgeBox.width),
          height: pct(ctaBox.height, nudgeBox.height)
        }
      }
    });
  }

  // --- "dailyGoal" step: the Today's Mission plan picker, with "Start today's mission" highlighted ---
  await page.evaluate(() => {
    localStorage.removeItem('utl_daily_mission_dismissed'); // make sure the picker actually shows
    localStorage.removeItem('utl_daily_mission');
  });
  await page.reload();
  await page.waitForSelector('[data-mission-overlay]:not(.ws-hidden)', { state: 'attached', timeout: 10000 });
  await page.waitForTimeout(700);

  {
    const dialogEl = await page.$('[data-mission-overlay] .ws-mission-dialog');
    const dialogBox = await dialogEl.boundingBox();
    const startBox = await (await page.$('[data-mission-start]')).boundingBox();
    const file = `daily-goal-${DATE_STAMP}.png`;
    await dialogEl.screenshot({ path: path.join(OUT_DIR, file) });
    results.push({
      step: 'dailyGoal',
      file,
      screenshot: {
        src: `../assets/walkthrough/${file}`,
        alt: 'The Today\'s Mission plan picker, with the "Start today\'s mission" button highlighted',
        capturedOn: DATE,
        cutout: {
          top: pct(startBox.y - dialogBox.y, dialogBox.height),
          left: pct(startBox.x - dialogBox.x, dialogBox.width),
          width: pct(startBox.width, dialogBox.width),
          height: pct(startBox.height, dialogBox.height)
        }
      }
    });
  }

  // --- "levels" step: the header's Level/streak/MP reward cluster ---
  await page.evaluate(() => {
    document.querySelector('[data-mission-overlay]')?.classList.add('ws-hidden');
  });
  await page.waitForSelector('.utl-reward-cluster', { state: 'attached' });
  await page.waitForTimeout(300);

  {
    const navEl = await page.$('.ws-nav-inner');
    const navBox = await navEl.boundingBox();
    const clusterBox = await (await page.$('.utl-reward-cluster')).boundingBox();
    const file = `levels-${DATE_STAMP}.png`;
    await navEl.screenshot({ path: path.join(OUT_DIR, file) });
    results.push({
      step: 'levels',
      file,
      screenshot: {
        src: `../assets/walkthrough/${file}`,
        alt: 'The Level and Mastery Points display in the member workspace header',
        capturedOn: DATE,
        cutout: {
          top: pct(clusterBox.y - navBox.y, navBox.height),
          left: pct(clusterBox.x - navBox.x, navBox.width),
          width: pct(clusterBox.width, navBox.width),
          height: pct(clusterBox.height, navBox.height)
        }
      }
    });
  }

  await browser.close();

  console.log(`\nSaved ${results.length} screenshots to ${OUT_DIR}\n`);
  console.log('Paste the matching object below into each step\'s "screenshot" field in');
  console.log('member-login/content-config.js (UTL_CONTENT.welcomeWalkthrough.steps),');
  console.log('replacing the old one. Delete the old dated image file once confirmed.\n');
  results.forEach((r) => {
    console.log(`--- "${r.step}" step ---`);
    console.log(JSON.stringify(r.screenshot, null, 2));
    console.log('');
  });
})().catch((error) => {
  console.error('Capture failed:', error.message);
  console.error(`Is a local server running at ${BASE_URL}? (e.g. python3 -m http.server 8061)`);
  process.exit(1);
});
