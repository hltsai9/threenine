// Capture screenshots of the running prototype for the promo deck.
// Renders prototype/standalone.html (self-contained, no server) via headless Chromium
// and writes PNGs to slides/assets/. Run: node slides/capture-screenshots.cjs
const { chromium } = require('/opt/node22/lib/node_modules/playwright/index.js');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'assets');
const URL = 'file://' + path.join(__dirname, '..', 'prototype', 'standalone.html');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.addInitScript(() => { try { localStorage.setItem('case-tracker-tour-seen-v1', '1'); } catch (e) {} });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  const go = async (hash, waitSel) => {
    await p.goto(URL + hash);
    await p.waitForSelector(waitSel, { timeout: 10000 });
    await p.waitForTimeout(300);
  };
  const el = async (sel, name) => {
    await p.locator(sel).first().screenshot({ path: path.join(OUT, name) });
    console.log('shot', name);
  };
  const clip = async (name, c) => {
    await p.screenshot({ path: path.join(OUT, name), clip: c });
    console.log('shot', name);
  };

  // Board overview (sidebar + 4 columns + top of reading panel)
  await go('#/cases', '.kanban');
  await clip('board.png', { x: 0, y: 0, width: 1500, height: 780 });
  await el('[data-col-id="new"]', 'column.png');

  // Two clocks + ownership timeline (case with a full FIT -> HQ chain)
  await go('#/cases/C-1044', '.clock-grid');
  await el('.clock-grid', 'clocks.png');
  await el('.detail-section:has(.timeline)', 'timeline.png');

  // Handover note (a case that carries one)
  await go('#/cases/C-1042', '.handover-note');
  await el('.detail-section:has(.handover-note)', 'handover.png');

  // Shifts coverage + the in-app roster editor
  await go('#/shifts', '.shift-grid');
  await el('.shift-grid', 'shifts.png');
  await el('#roster-editor', 'editor.png');

  // Weekly archive + status flow
  await go('#/archive', '.archive-grid');
  await el('.archive-grid', 'archive.png');
  await go('#/flow', '.flow-container');
  await el('.flow-container', 'flow.png');

  if (errs.length) console.log('PAGE ERRORS:', JSON.stringify(errs));
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
