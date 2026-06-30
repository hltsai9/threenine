// Build the Case Tracker promo deck (Case-Tracker-Overview.pptx) with pptxgenjs.
// Run: node slides/build-deck.cjs   (after node slides/capture-screenshots.cjs)
const path = require('path');
const fs = require('fs');
const pptxgen = require('pptxgenjs');   // installed locally: npm install --prefix slides pptxgenjs

const A = path.join(__dirname, 'assets');
const img = n => path.join(A, n);
const has = n => fs.existsSync(img(n));

// palette (from frontend/styles.css :root)
const ACCENT = '2563EB', CHAR = '1F2937', TEXT = '111827', MUTED = '6B7280',
      BORDER = 'E5E7EB', LIGHT = 'F7FAFC', GOOD = '059669', DANGER = 'DC2626', WARN = 'D97706';
const FONT = 'Segoe UI';
const URL = 'https://hltsai9.github.io/threenine/';

const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';        // 13.333 x 7.5 in
pptx.author = 'Case Tracker';
pptx.title = 'Case Tracker — Overview';
const W = 13.333, H = 7.5;

let pageNo = 0;
function base(slide, { footer = true } = {}) {
  slide.background = { color: 'FFFFFF' };
  if (footer) {
    pageNo++;
    slide.addShape(pptx.ShapeType.line, { x: 0.6, y: 7.02, w: 12.13, h: 0, line: { color: BORDER, width: 1 } });
    slide.addText('Case Tracker  ·  ' + URL, { x: 0.6, y: 7.04, w: 10, h: 0.32, fontFace: FONT, fontSize: 9, color: MUTED, align: 'left', valign: 'middle' });
    slide.addText(String(pageNo), { x: 12.0, y: 7.04, w: 0.7, h: 0.32, fontFace: FONT, fontSize: 9, color: MUTED, align: 'right', valign: 'middle' });
  }
  return slide;
}
function heading(slide, title, subtitle) {
  slide.addText(title, { x: 0.6, y: 0.45, w: 12.1, h: 0.7, fontFace: FONT, fontSize: 26, bold: true, color: CHAR });
  slide.addShape(pptx.ShapeType.rect, { x: 0.62, y: 1.18, w: 1.4, h: 0.06, fill: { color: ACCENT } });
  if (subtitle) slide.addText(subtitle, { x: 0.6, y: 1.26, w: 12.1, h: 0.4, fontFace: FONT, fontSize: 13, color: MUTED });
}
function bullets(slide, lines, box) {
  slide.addText(
    lines.map(t => ({ text: t, options: { bullet: { code: '2022', indent: 14 }, breakLine: true } })),
    Object.assign({ fontFace: FONT, fontSize: 15.5, color: TEXT, valign: 'top', lineSpacingMultiple: 1.15, paraSpaceAfter: 8 }, box)
  );
}
function picture(slide, name, box) {
  if (!has(name)) { slide.addText('[' + name + ' missing]', Object.assign({ fontFace: FONT, color: DANGER, fontSize: 12 }, box)); return; }
  slide.addImage({ path: img(name), x: box.x, y: box.y, w: box.w, h: box.h, sizing: { type: 'contain', w: box.w, h: box.h } });
}

/* 1 — Title */
(() => {
  const s = base(pptx.addSlide(), { footer: false });
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.28, fill: { color: ACCENT } });
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 7.22, w: W, h: 0.28, fill: { color: CHAR } });
  s.addText('Case Tracker', { x: 0, y: 2.35, w: W, h: 1.1, align: 'center', fontFace: FONT, fontSize: 52, bold: true, color: CHAR });
  s.addText('Retire the Excel workbook — one live board for the whole case lifecycle',
    { x: 1.5, y: 3.5, w: W - 3, h: 0.7, align: 'center', fontFace: FONT, fontSize: 20, color: MUTED });
  s.addText(URL, { x: 0, y: 4.35, w: W, h: 0.4, align: 'center', fontFace: FONT, fontSize: 15, color: ACCENT });
  s.addText('Deployable for your team · PostgreSQL-backed · multi-operator · live Case Center sync', { x: 0, y: 6.7, w: W, h: 0.4, align: 'center', fontFace: FONT, fontSize: 11, color: MUTED });
})();

/* 2 — The problem */
(() => {
  const s = base(pptx.addSlide());
  heading(s, 'Today: one shared Excel workbook', 'It works — until it doesn\'t.');
  bullets(s, [
    'Free-form cells → inconsistent values and broken formulas.',
    'No action queue → you rely on memory and ad-hoc filters for "what\'s next".',
    'No visibility → "where is this case stuck? who\'s slow?" is guesswork.',
    'Handover is verbal or a side document → nothing enforced or auditable.',
  ], { x: 0.7, y: 1.9, w: 11.8, h: 3.2 });
  s.addShape(pptx.ShapeType.roundRect, { x: 0.7, y: 5.3, w: 11.9, h: 1.0, rectRadius: 0.08, fill: { color: 'FEF2F2' }, line: { color: 'FECACA', width: 1 } });
  s.addText('The cost: cases stall between teams, SLAs slip unnoticed, and context is lost at every shift change.',
    { x: 1.0, y: 5.3, w: 11.3, h: 1.0, valign: 'middle', fontFace: FONT, fontSize: 15, italic: true, color: '991B1B' });
})();

/* 3 — The solution */
(() => {
  const s = base(pptx.addSlide());
  heading(s, 'One board, live — the workbook, replaced');
  picture(s, 'board.png', { x: 1.5, y: 1.5, w: 10.3, h: 5.0 });
  s.addText('Your Picked workspace + the Hand-off Route Board — where every case is, live from Case Center.',
    { x: 0.6, y: 6.5, w: 12.1, h: 0.4, align: 'center', fontFace: FONT, fontSize: 12, color: MUTED });
})();

/* 3b — Route Board: where every case is */
(() => {
  const s = base(pptx.addSlide());
  heading(s, 'The Hand-off Route Board', 'See where every case actually is — and where it still needs to go.');
  bullets(s, [
    'One strip across User → Core Team → HQ. The dot sits where Case Center says the case is now.',
    'A dashed "watch" ring = parked there, keeping an eye; a moving arrow = it should move (your intent).',
    'Scheduled hand-offs (weekend / retry / escalate) carry a deadline; the board never hides the real location.',
    'At a glance: who holds each case, and exactly where first line still has an action.',
  ], { x: 0.7, y: 1.85, w: 11.9, h: 2.3 });
  // mini route-board diagram
  const ly = 5.35, x0 = 1.6, x1 = 11.8;
  s.addShape(pptx.ShapeType.line, { x: x0, y: ly, w: x1 - x0, h: 0, line: { color: BORDER, width: 2 } });
  [['User', 2.4], ['Core Team', 6.65], ['HQ', 10.9]].forEach(([label, cx]) => {
    s.addShape(pptx.ShapeType.rect, { x: cx - 0.09, y: ly - 0.13, w: 0.18, h: 0.26, fill: { color: MUTED } });
    s.addText(label, { x: cx - 1.0, y: ly + 0.2, w: 2.0, h: 0.3, align: 'center', fontFace: FONT, fontSize: 12, bold: true, color: CHAR });
  });
  // current location (Case Center) — filled dot at Core Team
  s.addShape(pptx.ShapeType.ellipse, { x: 6.65 - 0.14, y: ly - 0.14, w: 0.28, h: 0.28, fill: { color: ACCENT } });
  s.addText('current — Case Center', { x: 5.15, y: ly - 0.66, w: 3.0, h: 0.3, align: 'center', fontFace: FONT, fontSize: 10, bold: true, color: ACCENT });
  // intent (Track Status) — dashed arrow Core Team → HQ
  s.addShape(pptx.ShapeType.line, { x: 6.95, y: ly, w: 10.9 - 6.95 - 0.18, h: 0, line: { color: WARN, width: 2, dashType: 'dash', endArrowType: 'triangle' } });
  s.addText('intent — Track Status', { x: 7.0, y: ly + 0.2, w: 3.9, h: 0.3, align: 'center', fontFace: FONT, fontSize: 10, italic: true, color: WARN });
})();

/* 4 — Two statuses */
(() => {
  const s = base(pptx.addSlide());
  heading(s, 'Two assignees per case', 'Where it IS (Case Center) vs where you WANT it (your Track Status).');
  bullets(s, [
    'Case Center assignee = where the case is now — this places the dot.',
    'Track Status = where first line wants it next, with a suggested time.',
    'When the two differ, the board animates an arrow — your cue to act.',
    'Do the work in Case Center; the board catches up on the next sync.',
  ], { x: 0.7, y: 1.95, w: 11.9, h: 2.1 });
  const cw = 5.85, cy = 4.25, ch = 1.95;
  s.addShape(pptx.ShapeType.roundRect, { x: 0.7, y: cy, w: cw, h: ch, rectRadius: 0.08, fill: { color: 'EFF6FF' }, line: { color: ACCENT, width: 1.25 } });
  s.addText([{ text: 'Current — Case Center\n', options: { bold: true, fontSize: 15, color: ACCENT } }, { text: 'Site IT + processType → Core / 1st Line · HQ dept → HQ · returned → User', options: { fontSize: 12.5, color: TEXT } }],
    { x: 0.95, y: cy + 0.2, w: cw - 0.5, h: ch - 0.4, valign: 'top', fontFace: FONT });
  s.addShape(pptx.ShapeType.roundRect, { x: 6.78, y: cy, w: cw, h: ch, rectRadius: 0.08, fill: { color: 'FFFBEB' }, line: { color: WARN, width: 1.25 } });
  s.addText([{ text: 'Desired — Track Status\n', options: { bold: true, fontSize: 15, color: WARN } }, { text: 'Escalate to HQ · Need to contact user · Weekend case · Sanity check — each with a suggested action time', options: { fontSize: 12.5, color: TEXT } }],
    { x: 7.03, y: cy + 0.2, w: cw - 0.5, h: ch - 0.4, valign: 'top', fontFace: FONT });
})();

/* 5 — Live from Case Center */
(() => {
  const s = base(pptx.addSlide());
  heading(s, 'Live from your on-prem Case Center', 'Real cases, refreshed every time you load the board.');
  bullets(s, [
    'Pulls live cases from Case Center on every refresh.',
    'Runs locally — your API key and cookie never leave your laptop.',
    'Your queue, handover notes and reminders are kept across refreshes.',
    'Case Center owns the status; your handling layer stays yours.',
  ], { x: 0.7, y: 1.9, w: 6.2, h: 4.6 });
  // simple architecture diagram (stacked)
  const bx = 8.5, bw = 3.7, bh = 0.95;
  const box = (y, label, fill, line, color) => {
    s.addShape(pptx.ShapeType.roundRect, { x: bx, y, w: bw, h: bh, rectRadius: 0.08, fill: { color: fill }, line: { color: line, width: 1.25 } });
    s.addText(label, { x: bx, y, w: bw, h: bh, align: 'center', valign: 'middle', fontFace: FONT, fontSize: 13, bold: true, color });
  };
  const arrow = (y) => s.addShape(pptx.ShapeType.line, { x: bx + bw / 2, y, w: 0, h: 0.5, line: { color: MUTED, width: 1.75, endArrowType: 'triangle' } });
  box(1.75, 'Your laptop (browser)', 'EEF2FF', ACCENT, CHAR);
  arrow(2.7);
  box(3.25, 'Local server (Python)', LIGHT, BORDER, CHAR);
  arrow(4.2);
  box(4.75, 'Case Center (on-prem)', LIGHT, BORDER, CHAR);
  s.addText('🔒 key + cookie stay here', { x: bx - 3.0, y: 3.4, w: 2.9, h: 0.6, align: 'right', valign: 'middle', fontFace: FONT, fontSize: 11, italic: true, color: GOOD });
})();

/* 6 — One-click actions */
(() => {
  const s = base(pptx.addSlide());
  heading(s, 'The next action is on the card', 'Surfaced by status and idle time — the agent never hunts.');
  const rows = [
    ['A', '6366F1', 'Assign to Core Team', 'New case with no owner yet.'],
    ['C', WARN, 'Chase — no response', 'Owner idle past the threshold (Core 4h / HQ 8h).'],
    ['E', DANGER, 'Escalate to HQ', 'Core Team can\'t resolve — hand to the product team.'],
    ['V', GOOD, 'Verify reported fix', 'Sanity-check, then close.'],
  ];
  let y = 2.0;
  rows.forEach(([ic, col, title, desc]) => {
    s.addShape(pptx.ShapeType.roundRect, { x: 0.8, y, w: 0.5, h: 0.5, rectRadius: 0.06, fill: { color: col } });
    s.addText(ic, { x: 0.8, y, w: 0.5, h: 0.5, align: 'center', valign: 'middle', fontFace: FONT, fontSize: 16, bold: true, color: 'FFFFFF' });
    s.addText([{ text: title + '   ', options: { bold: true, color: TEXT } }, { text: desc, options: { color: MUTED } }],
      { x: 1.5, y, w: 11, h: 0.5, valign: 'middle', fontFace: FONT, fontSize: 15 });
    y += 0.85;
  });
  s.addText('Plus reminders/bells and a one-click handover note — nothing falls through the cracks.',
    { x: 0.8, y: y + 0.1, w: 11.5, h: 0.5, fontFace: FONT, fontSize: 13, italic: true, color: MUTED });
})();

/* 7 — Two clocks + ownership timeline */
(() => {
  const s = base(pptx.addSlide());
  heading(s, 'Two clocks — and a timeline of who held it');
  bullets(s, [
    'SLA clock = time on us (pauses when returned to the requester).',
    'Core Team vs HQ time, tracked separately.',
    'Ownership timeline shows exactly when a case sat with whom.',
    'Answers "who\'s consuming the time?" at a glance.',
  ], { x: 0.7, y: 1.8, w: 5.3, h: 4.6 });
  s.addText('Separated Core Team / HQ clocks', { x: 6.3, y: 1.7, w: 6.4, h: 0.3, fontFace: FONT, fontSize: 11, bold: true, color: MUTED });
  picture(s, 'clocks.png', { x: 6.3, y: 2.0, w: 6.5, h: 0.75 });
  s.addText('Ownership timeline', { x: 6.3, y: 3.3, w: 6.4, h: 0.3, fontFace: FONT, fontSize: 11, bold: true, color: MUTED });
  picture(s, 'timeline.png', { x: 6.3, y: 3.6, w: 6.5, h: 1.0 });
})();

/* 8 — Handover on the board */
(() => {
  const s = base(pptx.addSlide());
  heading(s, 'Handover, on the board', 'No separate screen, no lost context.');
  bullets(s, [
    'One structured note per case, labelled Day → Night.',
    'Write it straight from the card (⚠ Note) or the reading panel.',
    'A banner flags open cases that still need a fresh note before cutover.',
    'Yellow = stale for the current shift and needs a rewrite.',
  ], { x: 0.7, y: 1.9, w: 11.9, h: 2.2 });
  picture(s, 'handover.png', { x: 0.9, y: 4.5, w: 11.5, h: 1.4 });
})();

/* 9 — Shift coverage */
(() => {
  const s = base(pptx.addSlide());
  heading(s, 'Shift coverage at a glance', 'Day / Night rosters, handover stats, and a "view as" perspective switch.');
  picture(s, 'shifts.png', { x: 0.8, y: 2.0, w: 11.7, h: 2.0 });
  bullets(s, [
    'See who is on, what was handed over, and what still needs a note.',
    'Switch the active operator to see exactly what they see.',
  ], { x: 0.7, y: 4.6, w: 11.9, h: 1.6 });
})();

/* 10 — Manage your roster */
(() => {
  const s = base(pptx.addSlide());
  heading(s, 'Manage your own roster', 'Add and edit operators right in the app.');
  bullets(s, [
    'Add/edit shifts and operators; IDs auto-suggest from names.',
    'Foolproof delete: reassign an operator\'s records or block — never orphan data.',
    'Can\'t delete the last operator; the default operator moves automatically.',
    'Generates the shifts.js snippet to make changes permanent.',
  ], { x: 0.7, y: 1.9, w: 5.6, h: 4.6 });
  picture(s, 'editor.png', { x: 6.5, y: 1.7, w: 6.2, h: 4.9 });
})();

/* 11 — Reporting Excel can't */
(() => {
  const s = base(pptx.addSlide());
  heading(s, 'Reporting the workbook can\'t', 'Every week, automatically.');
  picture(s, 'archive.png', { x: 0.8, y: 2.0, w: 11.7, h: 1.9 });
  bullets(s, [
    'Per-week totals: opened, closed, cancelled, carried-in, bounces.',
    'Median time-on-us — track whether you\'re getting faster.',
  ], { x: 0.7, y: 4.5, w: 11.9, h: 1.6 });
})();

/* 12 — Clear lifecycle */
(() => {
  const s = base(pptx.addSlide());
  heading(s, 'A clear, enforced lifecycle');
  picture(s, 'flow.png', { x: 1.6, y: 1.5, w: 10.1, h: 4.9 });
  s.addText('New → Core Team → HQ → Sanity Check → Closed, with pause/return and escalation paths.',
    { x: 0.6, y: 6.5, w: 12.1, h: 0.4, align: 'center', fontFace: FONT, fontSize: 12, color: MUTED });
})();

/* 13 — Why switch */
(() => {
  const s = base(pptx.addSlide());
  heading(s, 'Why switch');
  const colW = 5.85, y0 = 1.8, h = 4.6;
  s.addShape(pptx.ShapeType.roundRect, { x: 0.7, y: y0, w: colW, h, rectRadius: 0.08, fill: { color: 'FAFAFA' }, line: { color: BORDER, width: 1 } });
  s.addShape(pptx.ShapeType.roundRect, { x: 6.78, y: y0, w: colW, h, rectRadius: 0.08, fill: { color: 'EFF6FF' }, line: { color: ACCENT, width: 1.25 } });
  s.addText('Excel workbook', { x: 0.7, y: y0 + 0.12, w: colW, h: 0.4, align: 'center', fontFace: FONT, fontSize: 15, bold: true, color: MUTED });
  s.addText('Case Tracker', { x: 6.78, y: y0 + 0.12, w: colW, h: 0.4, align: 'center', fontFace: FONT, fontSize: 15, bold: true, color: ACCENT });
  bullets(s, [
    'Free-form cells',
    'Remember what\'s next',
    'No SLA / owner-time visibility',
    'Verbal, unenforced handover',
    'Manual, no reporting',
  ], { x: 0.95, y: y0 + 0.7, w: colW - 0.5, h: h - 0.9, fontSize: 14, color: '6B7280' });
  bullets(s, [
    'Structured, validated data',
    'A queue that tells you what\'s next',
    'SLA + separated Core/HQ time + timeline',
    'Enforced, auditable shift handover',
    'Weekly dashboards · live Case Center sync',
    'Shared across operators · PostgreSQL-backed · deployable (Render or your own server)',
  ], { x: 7.03, y: y0 + 0.7, w: colW - 0.5, h: h - 0.9, fontSize: 14, color: TEXT });
})();

/* 13b — Deploy it for your team */
(() => {
  const s = base(pptx.addSlide());
  heading(s, 'Deploy it for your team', 'From single-laptop demo to a shared, always-on board.');
  bullets(s, [
    'PostgreSQL-backed: every operator signs in and sees the same live board, from any device.',
    'Secured: a token login gate in front of the API — case data is never left wide open.',
    'Periodic Case Center sync: a scheduled job pulls new cases into the DB automatically (systemd timer / cron).',
    'Host it your way: your own Ubuntu server, or a managed platform like Render.',
  ], { x: 0.7, y: 1.9, w: 11.9, h: 2.5 });
  // flow: Case Center -> ingest (timer) -> Postgres -> API/SPA -> operators
  const fy = 4.95, bw = 2.15, bh = 0.95, gap = 0.30; let fx = 0.8;
  const fbox = (label, fill, line, color) => {
    s.addShape(pptx.ShapeType.roundRect, { x: fx, y: fy, w: bw, h: bh, rectRadius: 0.08, fill: { color: fill }, line: { color: line, width: 1.25 } });
    s.addText(label, { x: fx, y: fy, w: bw, h: bh, align: 'center', valign: 'middle', fontFace: FONT, fontSize: 12, bold: true, color });
    fx += bw;
  };
  const farrow = () => { s.addShape(pptx.ShapeType.line, { x: fx + 0.02, y: fy + bh / 2, w: gap - 0.04, h: 0, line: { color: MUTED, width: 1.75, endArrowType: 'triangle' } }); fx += gap; };
  fbox('Case Center', LIGHT, BORDER, CHAR); farrow();
  fbox('Ingest (timer)', 'FFFBEB', WARN, CHAR); farrow();
  fbox('PostgreSQL', 'EFF6FF', ACCENT, CHAR); farrow();
  fbox('API + SPA', 'EFF6FF', ACCENT, CHAR); farrow();
  fbox('Operators', LIGHT, BORDER, CHAR);
  s.addText('Step-by-step self-host runbook: docs/SELF-HOST-UBUNTU.md', { x: 0.7, y: 6.25, w: 11.9, h: 0.35, align: 'center', fontFace: FONT, fontSize: 11, italic: true, color: MUTED });
})();

/* 13c — What it runs on (tech stack) */
(() => {
  const s = base(pptx.addSlide());
  heading(s, 'What it runs on', 'A Python web service + PostgreSQL. Node is build-time only — never needed to run the site.');
  const row = (y, emoji, fill, label, desc) => {
    s.addShape(pptx.ShapeType.ellipse, { x: 0.9, y, w: 0.72, h: 0.72, fill: { color: fill }, line: { color: BORDER, width: 1 } });
    s.addText(emoji, { x: 0.9, y, w: 0.72, h: 0.72, align: 'center', valign: 'middle', fontFace: FONT, fontSize: 26 });
    s.addText([{ text: label + '\n', options: { bold: true, fontSize: 17, color: CHAR } }, { text: desc, options: { fontSize: 14, color: MUTED } }],
      { x: 1.95, y: y - 0.06, w: 10.5, h: 0.84, valign: 'middle', fontFace: FONT, lineSpacingMultiple: 1.05 });
  };
  row(1.95, '🌐', 'EEF2FF', 'Front end — the web app', 'Plain HTML / CSS / vanilla JavaScript. No framework, no Node in the browser; just static files.');
  row(2.95, '🐍', 'E8F2EC', 'Back end — web server + API', 'Python · FastAPI · uvicorn. Serves the app and the /api endpoints from one origin.');
  row(3.95, '🐘', 'EFF6FF', 'Database', 'PostgreSQL — one shared, live board for every operator and device.');
  row(4.95, '⏱️', 'FFFBEB', 'Data sync', 'A scheduled Python job pulls from Case Center on a timer (systemd / cron).');
  s.addShape(pptx.ShapeType.roundRect, { x: 0.9, y: 6.0, w: 11.55, h: 0.78, rectRadius: 0.06, fill: { color: LIGHT }, line: { color: BORDER, width: 1 } });
  s.addText([
    { text: '🔒 Optional: ', options: { bold: true } }, { text: 'nginx + HTTPS in front.    ', options: {} },
    { text: '🧰 Node.js is build-time only ', options: { bold: true } }, { text: '(bundler · tests · this deck) — the running site needs only Python + PostgreSQL.', options: {} },
  ], { x: 1.15, y: 6.0, w: 11.1, h: 0.78, valign: 'middle', fontFace: FONT, fontSize: 12.5, color: TEXT });
})();

/* 14 — Call to action */
(() => {
  const s = base(pptx.addSlide(), { footer: false });
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.28, fill: { color: ACCENT } });
  s.addText('See it. Deploy it.', { x: 0, y: 1.7, w: W, h: 0.8, align: 'center', fontFace: FONT, fontSize: 36, bold: true, color: CHAR });
  s.addText(URL, { x: 0, y: 2.7, w: W, h: 0.5, align: 'center', fontFace: FONT, fontSize: 20, color: ACCENT });
  bullets(s, [
    'Try the live demo — open the link and take the built-in guided tour.',
    'Deploy for your team — Postgres + token login + periodic Case Center sync, on Render or your own Ubuntu server.',
    'Step-by-step runbook: docs/SELF-HOST-UBUNTU.md. Feedback welcome — it\'s a working tool, not a mockup.',
  ], { x: 2.2, y: 3.7, w: 8.9, h: 2.4, fontSize: 16 });
})();

const out = path.join(__dirname, 'Case-Tracker-Overview.pptx');
pptx.writeFile({ fileName: out }).then(() => console.log('Wrote', out, '·', pageNo + 1, 'slides')).catch(e => { console.error(e); process.exit(1); });
