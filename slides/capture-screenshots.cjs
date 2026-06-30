// Capture screenshots of the CURRENT frontend for the promo deck.
// Renders frontend/standalone.html (self-contained, no server) via headless Chromium and
// writes PNGs to slides/assets/.
//   Deps: npm install --prefix slides playwright && node slides/node_modules/playwright/cli.js install chromium
//   Run AFTER rebundling:  node frontend/bundle.mjs && node slides/capture-screenshots.cjs
const { chromium } = require('playwright');   // installed locally into slides/node_modules
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'assets');
const URL = 'file://' + path.join(__dirname, '..', 'frontend', 'standalone.html');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  // Suppress the first-run tour (storage key bumped to v2 when the tour was rewritten).
  await p.addInitScript(() => { try { localStorage.setItem('case-tracker-tour-seen-v2', '1'); } catch (e) {} });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  const go = async (hash, waitSel) => {
    await p.goto(URL + hash);
    await p.waitForSelector(waitSel, { timeout: 10000 });
    await p.waitForTimeout(450);   // let route-board animations settle
  };
  const el = async (sel, name) => {
    await p.locator(sel).first().screenshot({ path: path.join(OUT, name) });
    console.log('shot', name);
  };
  const clip = async (name, c) => {
    await p.screenshot({ path: path.join(OUT, name), clip: c });
    console.log('shot', name);
  };

  // Hero board — Picked workspace + Hand-off Route Board
  await go('#/cases', '.picked-workspace');
  await clip('board.png', { x: 0, y: 0, width: 1500, height: 820 });
  await el('.route-band', 'routeboard.png');   // route-board strip close-up (bonus)

  // Two clocks + ownership/process timeline (HQ case with a full Core → HQ chain)
  await go('#/cases/C-2405', '.clock-grid');
  await el('.clock-grid', 'clocks.png');
  await el('.detail-section:has(.timeline)', 'timeline.png');

  // Handover note (C-2414 carries one in the seed)
  await go('#/cases/C-2414', '.handover-note');
  await el('.detail-section:has(.handover-note)', 'handover.png');

  // Shift coverage + the in-app roster editor
  await go('#/shifts', '.shift-grid');
  await el('.shift-grid', 'shifts.png');
  await el('#roster-editor', 'editor.png');

  // Weekly overview + status flow
  await go('#/archive', '.archive-grid');
  await el('.archive-grid', 'archive.png');
  await go('#/flow', '.flow-container');
  await el('.flow-container', 'flow.png');

  if (errs.length) console.log('PAGE ERRORS:', JSON.stringify(errs));
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
