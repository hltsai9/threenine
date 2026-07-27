// Characterization tests for the frontend's pure functions.
//
// These lock in current behavior before the planned P1 refactors (e.g. the PROMPT_HANDLERS
// extraction). Zero dependencies: run with `node frontend/tests/run.cjs`.
//
// The clock is frozen to the seed's NOW (see load-prototype.cjs), so NOW-relative inputs are
// built as offsets from FIXED and assertions are exact.

const { loadPrototype } = require('./load-prototype.cjs');

let passed = 0, failed = 0;
const fails = [];
function test(name, fn) {
  try { fn(); passed++; process.stdout.write('.'); }
  catch (e) { failed++; fails.push({ name, e }); process.stdout.write('F'); }
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg || 'not equal'}\n      expected: ${b}\n      actual:   ${a}`);
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'expected truthy'); }

let app;
try {
  app = loadPrototype();
} catch (e) {
  console.error('Failed to load the frontend headlessly — the DOM shim or app boot likely needs');
  console.error('updating in frontend/tests/load-prototype.cjs.\n');
  console.error(e && e.stack || e);
  process.exit(1);
}
const HOUR = app.__HOUR__;
const FIXED = app.__FIXED__;
const TH = app.THRESHOLDS;
const opId = app.CURRENT_OPERATOR_ID;
const iso = msAgo => new Date(FIXED - msAgo).toISOString(); // ISO string `msAgo` before frozen now
const {
  fmtDuration, statusLabel, displayStatus, isQueued,
  caseSlaMs, caseHoldMs, derivePromptsForCase, needsHandoverNote,
} = app;

/* ---------- fmtDuration ---------- */
test('fmtDuration: null → em dash', () => eq(fmtDuration(null), '—'));
test('fmtDuration: zero → 0m', () => eq(fmtDuration(0), '0m'));
test('fmtDuration: under an hour', () => eq(fmtDuration(59 * 60000), '59m'));
test('fmtDuration: exact hour', () => eq(fmtDuration(60 * 60000), '1h'));
test('fmtDuration: hours + minutes', () => eq(fmtDuration(90 * 60000), '1h 30m'));
test('fmtDuration: exact day', () => eq(fmtDuration(24 * HOUR), '1d'));
test('fmtDuration: days + hours', () => eq(fmtDuration(25 * HOUR), '1d 1h'));

/* ---------- fmtHours (IT process time — always hours, never days) ---------- */
test('fmtHours: whole hours trim the decimal', () => eq(app.fmtHours(15 * HOUR), '15h'));
test('fmtHours: half hour → 10.5h', () => eq(app.fmtHours(10.5 * HOUR), '10.5h'));
test('fmtHours: over a day stays in hours → 30.6h (not 1d 6.6h)', () => eq(app.fmtHours(30.6 * HOUR), '30.6h'));
test('fmtHours: null → em dash', () => eq(app.fmtHours(null), '—'));

/* ---------- statusLabel / displayStatus / isQueued ---------- */
test('statusLabel: maps known enum', () => eq(statusLabel('with_core'), 'With Core Team'));
test('statusLabel: passthrough unknown', () => eq(statusLabel('weird'), 'weird'));
test('displayStatus: prefers ccStatusLabel', () => eq(displayStatus({ status: 'with_core', ccStatusLabel: 'In-Progress Wait User' }), 'In-Progress Wait User'));
test('displayStatus: falls back to enum label', () => eq(displayStatus({ status: 'closed' }), 'Closed'));
test('isQueued: queued → true', () => ok(isQueued({ agentStatus: 'queued' })));
test('isQueued: unqueued → false', () => ok(!isQueued({ agentStatus: 'unqueued' })));

/* ---------- _ccMapStatus (CC status → board column) ---------- */
// Terminal caseStatus must win over the processType refinement: a "Close" case whose last
// timeline stage was Service Team is closed, not with_core (and therefore not pickable).
test('_ccMapStatus: Close + Service Team timeline → closed (terminal wins)', () =>
  eq(app._ccMapStatus('Close', null, 'Service Team'), 'closed'));
test('_ccMapStatus: Drop + Service Team timeline → cancelled (terminal wins)', () =>
  eq(app._ccMapStatus('Drop', null, 'Service Team'), 'cancelled'));
test('_ccMapStatus: In-Progress + Service Team → with_core (refinement for open cases)', () =>
  eq(app._ccMapStatus('In-Progress', null, 'Service Team'), 'with_core'));
test('_ccMapStatus: In-Progress|Wait User pair wins over refinement', () =>
  eq(app._ccMapStatus('In-Progress', 'Wait User', 'Service Team'), 'returned_to_requester'));
test('_ccMapStatus: unmapped status falls back to new', () =>
  eq(app._ccMapStatus('Bogus', null, null), 'new'));

/* ---------- fixStaleTerminalStatus (stored payloads that predate "terminal wins") ---------- */
test('fixStaleTerminalStatus: with_core + raw Close → closed', () =>
  eq(app.fixStaleTerminalStatus({ status: 'with_core', ccStatusLabel: 'Close' }).status, 'closed'));
test('fixStaleTerminalStatus: label with sub-transition still detected', () =>
  eq(app.fixStaleTerminalStatus({ status: 'with_core', ccStatusLabel: 'Close Sanity Check' }).status, 'closed'));
test('fixStaleTerminalStatus: with_core + raw Drop → cancelled', () =>
  eq(app.fixStaleTerminalStatus({ status: 'with_core', ccStatusLabel: 'Drop' }).status, 'cancelled'));
test('fixStaleTerminalStatus: open raw status left untouched', () =>
  eq(app.fixStaleTerminalStatus({ status: 'with_core', ccStatusLabel: 'In-Progress Wait User' }).status, 'with_core'));
test('fixStaleTerminalStatus: no ccStatusLabel → untouched', () =>
  eq(app.fixStaleTerminalStatus({ status: 'with_core' }).status, 'with_core'));
test('normalizeLiveCase: corrects a stale stored terminal status', () =>
  eq(app.normalizeLiveCase({ id: 'C-STALE', status: 'with_core', ccStatusLabel: 'Close' }).status, 'closed'));

/* ---------- caseNotesText (aggregated Note column / handover note history) ---------- */
// New-style handover history entries carry the note text in `detail`, so EVERY past
// handover's message survives in the export — not just the latest one on c.handover.
test('caseNotesText: keeps the text of every handover note (new-style entries)', () => {
  const txt = app.caseNotesText({
    history: [
      { at: iso(3 * HOUR), who: opId, kind: 'handover', detail: 'Handover note (Day → Night): first note' },
      { at: iso(1 * HOUR), who: opId, kind: 'handover', detail: 'Handover to Bo (Night → Day): second note' },
    ],
    handover: { at: iso(1 * HOUR), author: opId, note: 'second note' },
  });
  ok(txt.includes('first note'), 'older handover note text must survive');
  ok(txt.includes('second note'), 'latest handover note text must be present');
});
test('caseNotesText: legacy generic entry substitutes the current note text', () => {
  const txt = app.caseNotesText({
    history: [{ at: iso(1 * HOUR), who: opId, kind: 'handover', detail: 'Handover note (Day → Night)' }],
    handover: { at: iso(1 * HOUR), author: opId, note: 'watch the SLA' },
  });
  ok(txt.includes('watch the SLA'), 'legacy note text reaches the export');
  eq(txt.split('\n').length, 1, 'no duplicate line for the same handover');
});
test('caseNotesText: only handover notes — other actions are excluded', () => {
  const txt = app.caseNotesText({
    history: [
      { at: iso(5 * HOUR), who: opId, kind: 'picked', detail: 'Picked for follow-up' },
      { at: iso(4 * HOUR), who: opId, kind: 'track-status-set', detail: 'untracked → escalate_to_core' },
      { at: iso(2 * HOUR), who: opId, kind: 'handover', detail: 'Handover note (Day → Night): only this line' },
    ],
    handover: { at: iso(2 * HOUR), author: opId, note: 'only this line' },
  });
  eq(txt.split('\n').length, 1, 'a single handover line');
  ok(txt.includes('only this line') && !txt.includes('Picked for follow-up'), 'actions excluded');
});
test('caseHandoverNotes: returns every note, prefix stripped, oldest first', () => {
  const notes = app.caseHandoverNotes({
    history: [
      { at: iso(3 * HOUR), who: opId, kind: 'handover', detail: 'Handover note (Day → Night): first' },
      { at: iso(1 * HOUR), who: opId, kind: 'handover', detail: 'Handover to Bo (Night → Day): second' },
    ],
    handover: { at: iso(1 * HOUR), author: opId, note: 'second' },
  });
  eq(notes.map(n => n.text), ['first', 'second']);
});
test('routeTrackerTag: TKMS icon appears right of the name only when flagged', () => {
  const base = { id: 'X', agentStatus: 'queued', history: [{ at: iso(HOUR), who: opId, kind: 'picked' }] };
  ok(!app.routeTrackerTag({ ...base }).includes('rb-tkms-ic'), 'no icon without the flag');
  const tagged = app.routeTrackerTag({ ...base, addedToTkms: true });
  ok(tagged.includes('rb-tkms-ic'), 'icon present when flagged');
  ok(tagged.indexOf('rb-tracker-name') < tagged.indexOf('rb-tkms-ic'), 'icon sits after the name');
});

test('routeBoardTableData: TKMS column sits between Core Team and HQ, Yes when ticked', () => {
  const { headers, rows } = app.routeBoardTableData();
  eq(headers.indexOf('If added to TKMS page'), headers.indexOf('Core Team') + 1);
  eq(headers.indexOf('HQ Product Team'), headers.indexOf('If added to TKMS page') + 1);
  const c = app.routeBoardCases()[0];
  const was = c.addedToTkms;
  c.addedToTkms = true;
  const row = app.routeBoardTableData().rows.find(r => r[0] === app.caseHref(c));
  eq(row[headers.indexOf('If added to TKMS page')], 'Yes');
  c.addedToTkms = was;
});
test('caseNotesText: admin-authored notes are excluded from the export only', () => {
  const c = {
    history: [
      { at: iso(3 * HOUR), who: 'op-admin', kind: 'handover', detail: 'Handover note (Day → Night): admin note' },
      { at: iso(1 * HOUR), who: opId, kind: 'handover', detail: 'Handover note (Day → Night): operator note' },
    ],
    handover: { at: iso(1 * HOUR), author: opId, note: 'operator note' },
  };
  const txt = app.caseNotesText(c);
  ok(!txt.includes('admin note'), 'admin note dropped from export');
  ok(txt.includes('operator note'), 'operator note kept');
  ok(app.caseHandoverNotes(c).some(n => n.text === 'admin note'), 'panel source still includes it');
});
test('renderDelimited: CR normalized; multi-line cell stays quoted in one field', () => {
  const out = app.renderDelimited(['A', 'B'], [['x', 'line1\r\nline2\rline3']], '\t');
  const dataRow = out.split('\r\n').slice(1).join('\r\n');
  eq(dataRow, 'x\t"line1\nline2\nline3"', 'CRs become bare LFs inside one quoted field');
});
test('renderHtmlTable: one <tr> per case, same-cell flag for Excel', () => {
  const html = app.renderHtmlTable(['A'], [['l1\nl2'], ['solo']]);
  eq((html.match(/<tr>/g) || []).length, 3, 'header + 2 rows');
  ok(html.includes('mso-data-placement:same-cell'), 'Excel same-cell flag present');
  ok(html.includes('l1<br>l2'), 'in-cell line break');
});

/* ---------- renderPickedList (Cases / Sanity Check tabs) ---------- */
test('renderPickedList: tabs split Sanity Check cases from active ones', () => {
  const picked = app.pickedCases();
  const sanity = picked.filter(c => (c.trackStatus || null) === 'sanity_check').length;
  ok(sanity > 0, 'seed should contain picked Sanity Check cases');
  const rowCount = html => (html.match(/picked-row-head/g) || []).length;
  app.STATE.pickedListTab = 'cases';
  eq(rowCount(app.renderPickedList()), picked.length - sanity, 'Cases tab hides sanity rows');
  app.STATE.pickedListTab = 'sanity';
  eq(rowCount(app.renderPickedList()), sanity, 'Sanity tab shows only sanity rows');
  app.STATE.pickedListTab = 'cases';
});

/* ---------- product_team_handling (watch at HQ, over-limit flag off) ---------- */
test('product_team_handling: classifies as a watch row', () =>
  eq(app._classifyRouteRow({ id: 'X', trackStatus: 'product_team_handling', processTimeline: [] }), 'watch'));
test('product_team_handling: case away from HQ gets an intent arrow toward HQ', () => {
  // Latest stage Service Team → station Core Team → not at the expected HQ → intent row, arrow right.
  const c = { id: 'X', subject: 's', trackStatus: 'product_team_handling', history: [],
    processTimeline: [{ processType: 'Service Team', startedAt: iso(4 * HOUR) }] };
  const html = app._renderWatchRow(c, 0);
  ok(html.includes('rb-row-watch-intent'), 'intent variant (not settled)');
  ok(html.includes('rb-wi-right'), 'arrow points toward HQ');
});
test('itProcessOver: red flag suppressed for product_team_handling', () => {
  const c = { id: 'X', status: 'with_hq',
    processTimeline: [{ processType: 'Service Team', startedAt: iso(40 * HOUR), endedAt: iso(1 * HOUR) }] };
  ok(app.itProcessOver(c), 'a 39h IT-process case is over the 24h limit normally');
  c.trackStatus = 'product_team_handling';
  ok(!app.itProcessOver(c), 'flag off once the Product Team owns it');
  ok(app.itProcessMs(c) > 24 * HOUR, 'the hours themselves keep counting');
});

/* ---------- caseTracker: handover route with current-shift invariant ---------- */
const dayOp = app.OPERATORS.find(o => o.shift === 'Day');
const nightOp = app.OPERATORS.find(o => o.shift === 'Night');
// The harness's current operator is on the Day shift — assert so route tests stay valid.
test('tracker: harness current operator is Day shift', () =>
  eq(app.getOperator(app.STATE.operatorId).shift, 'Day'));
test('tracker route: previous-shift note addressed to a current-shift operator → "A → B"', () => {
  const c = { id: 'X', status: 'with_core', agentStatus: 'queued', history: [],
    handover: { author: nightOp.id, toOperator: app.STATE.operatorId, from: 'Night', to: 'Day', at: iso(HOUR), staleForCurrentShift: false } };
  const t = app.caseTracker(c);
  eq(t.kind, 'route');
  eq(t.from, app.shortOpName(nightOp.name));
  eq(t.to, app.shortOpName(app.getOperator(app.STATE.operatorId).name));
});
test('tracker route: current shift handing forward to the next → "A → B"', () => {
  const c = { id: 'X', status: 'with_core', agentStatus: 'queued', history: [],
    handover: { author: app.STATE.operatorId, toOperator: nightOp.id, from: 'Day', to: 'Night', at: iso(HOUR), staleForCurrentShift: false } };
  const t = app.caseTracker(c);
  eq(t.kind, 'route');
  eq(t.to, app.shortOpName(nightOp.name));
});
test('tracker gap: picked by the previous shift, no handover → "A → ?"', () => {
  const c = { id: 'X', status: 'with_core', agentStatus: 'queued',
    history: [{ at: iso(9 * HOUR), who: nightOp.id, kind: 'picked' }], handover: null };
  const t = app.caseTracker(c);
  eq(t.kind, 'gap');
  eq(t.from, app.shortOpName(nightOp.name));
  eq(t.to, '?');
});
test('tracker gap: stale note whose recipient is off-shift names the previous HOLDER', () => {
  const c = { id: 'X', status: 'with_core', agentStatus: 'queued',
    history: [{ at: iso(20 * HOUR), who: dayOp.id, kind: 'picked' }],
    handover: { author: dayOp.id, toOperator: nightOp.id, from: 'Day', to: 'Night', at: iso(18 * HOUR), staleForCurrentShift: true } };
  const t = app.caseTracker(c);
  eq(t.kind, 'gap');
  eq(t.from, app.shortOpName(nightOp.name), 'previous-shift holder (recipient), not the author');
});
test('tracker by: picked by a current-shift operator, nothing to route', () => {
  const c = { id: 'X', status: 'with_core', agentStatus: 'queued',
    history: [{ at: iso(HOUR), who: dayOp.id, kind: 'picked' }], handover: null };
  const t = app.caseTracker(c);
  eq(t.kind, 'by');
  eq(t.from, app.shortOpName(dayOp.name));
  eq(t.to, null);
});
test('routeTrackerTag: gap renders the highlighted "?" chip', () => {
  const c = { id: 'X', status: 'with_core', agentStatus: 'queued',
    history: [{ at: iso(9 * HOUR), who: nightOp.id, kind: 'picked' }] };
  const html = app.routeTrackerTag(c);
  ok(html.includes('rb-tracker-gap'), 'gap styling');
  ok(html.includes('rb-tracker-q'), 'question mark styled');
  ok(html.includes('→'), 'arrow shown');
});

/* ---------- computeCurrentShift (sidebar "Ends" fix) ---------- */
test('computeCurrentShift: inside Day (08–20 UTC) → ends 20:00 same day', () => {
  const cs = app.computeCurrentShift(new Date(Date.UTC(2026, 6, 15, 12, 0, 0)));
  eq(cs.name, 'Day');
  eq(cs.endsAtUtc, '2026-07-15T20:00:00.000Z');
});
test('computeCurrentShift: Night wraps midnight → ends 08:00 NEXT day', () => {
  const cs = app.computeCurrentShift(new Date(Date.UTC(2026, 6, 15, 23, 0, 0)));
  eq(cs.name, 'Night');
  eq(cs.endsAtUtc, '2026-07-16T08:00:00.000Z');
});
test('computeCurrentShift: after midnight still Night → ends 08:00 same day', () => {
  const cs = app.computeCurrentShift(new Date(Date.UTC(2026, 6, 16, 0, 30, 0)));
  eq(cs.name, 'Night');
  eq(cs.endsAtUtc, '2026-07-16T08:00:00.000Z');
});
test('computeCurrentShift: exactly at a boundary belongs to the NEXT shift', () => {
  const cs = app.computeCurrentShift(new Date(Date.UTC(2026, 6, 15, 20, 0, 0)));
  eq(cs.name, 'Night');
});
test('computeCurrentShift: unparseable roster → null (caller keeps the old value)', () => {
  const prev = app.SHIFTS;
  app.SHIFTS = [{ name: 'X', hoursUtc: 'whenever' }];
  eq(app.computeCurrentShift(new Date()), null);
  app.SHIFTS = prev;
});

/* ---------- operator day Gantt (analytics, from processTimeline) ---------- */
const ganttDay = app.isoToLocalInput(new Date(FIXED).toISOString()).slice(0, 10);
test('processorMatchesOperator: CC id = roster id without "op-"; also name / short name', () => {
  const op = { id: 'op-cc123', name: 'Mia Chen (MC)', shift: 'Day' };
  eq(app.processorMatchesOperator('cc123', op), true, 'bare Case Center id matches op-<ccId>');
  eq(app.processorMatchesOperator('CC123', op), true, 'case-insensitively');
  eq(app.processorMatchesOperator(op.id, op), true);
  eq(app.processorMatchesOperator(dayOp.name.toUpperCase(), dayOp), true);
  eq(app.processorMatchesOperator(app.shortOpName(dayOp.name), dayOp), true);
  eq(app.processorMatchesOperator('someone-else', dayOp), false);
  eq(app.processorMatchesOperator(null, dayOp), false);
});
test('operatorGanttData: groups the operator\'s segments per case, sums their time', () => {
  const fake = { id: 'GANTT-1', status: 'in_it', agentStatus: 'none', history: [],
    processTimeline: [   // processor = the bare Case Center id (roster id minus "op-")
      { processor: dayOp.id.replace(/^op-/, ''), processType: 'Service Team', startedAt: iso(3 * HOUR), endedAt: iso(2 * HOUR) },
      { processor: dayOp.id.replace(/^op-/, ''), processType: 'IT Office', startedAt: iso(2 * HOUR), endedAt: iso(1 * HOUR) },
      { processor: 'someone-else', processType: 'Service Team', startedAt: iso(3 * HOUR), endedAt: iso(1 * HOUR) },
    ] };
  app.STATE.cases.push(fake);
  try {
    const g = app.operatorGanttData(dayOp.id, ganttDay, ganttDay);
    const row = g.rows.find(r => r.c.id === 'GANTT-1');
    ok(row, 'the case appears');
    eq(row.segs.length, 2, "only the matching processor's segments");
    eq(row.ms, 2 * HOUR);
    ok(g.totalMs >= 2 * HOUR, 'total includes this case');
  } finally { app.STATE.cases.pop(); }
});
test('operatorGanttData: open segment (no endedAt) runs to the frozen NOW', () => {
  const fake = { id: 'GANTT-2', status: 'in_it', agentStatus: 'none', history: [],
    processTimeline: [{ processor: dayOp.name, processType: 'IT Office', startedAt: iso(HOUR) }] };
  app.STATE.cases.push(fake);
  try {
    const row = app.operatorGanttData(dayOp.id, ganttDay, ganttDay).rows.find(r => r.c.id === 'GANTT-2');
    ok(row, 'processor matched by full name');
    eq(row.ms, HOUR);
  } finally { app.STATE.cases.pop(); }
});
test('operatorGanttData: from/to range includes earlier days; a single day excludes them', () => {
  const prevDay = app.isoToLocalInput(new Date(FIXED - 24 * HOUR).toISOString()).slice(0, 10);
  const fake = { id: 'GANTT-4', status: 'in_it', agentStatus: 'none', history: [],
    processTimeline: [{ processor: dayOp.id, processType: 'Service Team', startedAt: iso(30 * HOUR), endedAt: iso(28 * HOUR) }] };
  app.STATE.cases.push(fake);
  try {
    const ranged = app.operatorGanttData(dayOp.id, prevDay, ganttDay);
    const row = ranged.rows.find(r => r.c.id === 'GANTT-4');
    ok(row, 'yesterday\'s segment is inside the from/to range');
    eq(row.ms, 2 * HOUR);
    eq(ranged.rangeMs, 48 * HOUR, 'both days inclusive');
    eq(ranged.activeDays, 1, 'only yesterday had activity — today does not dilute the average');
    eq(ranged.avgCasesPerDay, 1);
    ok(!app.operatorGanttData(dayOp.id, ganttDay, ganttDay).rows.some(r => r.c.id === 'GANTT-4'),
      'today-only range excludes it');
  } finally { app.STATE.cases.pop(); }
});
test('operatorGanttSvg: renders labelled bars + the summary line; huge ranges are refused', () => {
  const fake = { id: 'GANTT-3', status: 'in_it', agentStatus: 'none', history: [],
    caseLink: 'https://cc.example/case/GANTT-3',
    processTimeline: [{ processor: dayOp.id, processType: 'Service Team', startedAt: iso(2 * HOUR), endedAt: iso(HOUR) }] };
  app.STATE.cases.push(fake);
  try {
    const html = app.operatorGanttSvg(dayOp.id, ganttDay, ganttDay);
    ok(html.includes('an-gantt-bar'), 'segment bar rendered');
    ok(html.includes('GANTT-3'), 'case id row label');
    ok(html.includes('href="https://cc.example/case/GANTT-3"'), 'row label links to Case Center');
    ok(html.includes('handled'), 'summary line present');
    const wide = app.operatorGanttSvg(dayOp.id, '2026-01-01', ganttDay);
    ok(wide.includes('31 days or fewer'), 'over-wide range refused with a hint');
  } finally { app.STATE.cases.pop(); }
});

/* ---------- operator pick survives a refresh (DB-roster race) ---------- */
test('operator pick: unresolvable stored id goes pending and is never clobbered', () => {
  const prevOp = app.STATE.operatorId;
  const prevKey = app.localStorage.getItem('case-tracker-operator-v1');
  app.localStorage.setItem('case-tracker-operator-v1', 'op-db-only');
  app.__PENDING_OPERATOR__ = null;
  app.restoreOperatorChoice();                       // seed roster: id unknown → pending
  eq(app.__PENDING_OPERATOR__, 'op-db-only');
  eq(app.STATE.operatorId, prevOp, 'operator unchanged while pending');
  app.saveOperatorChoice();                          // early render's save must NOT clobber
  eq(app.localStorage.getItem('case-tracker-operator-v1'), 'op-db-only', 'stored pick preserved');
  // DB roster lands (as applyShiftsConfig would do) → the pick resolves.
  app.OPERATORS.push({ id: 'op-db-only', name: 'Dana (DB)', shift: 'Day' });
  app.restoreOperatorChoice();
  eq(app.STATE.operatorId, 'op-db-only');
  eq(app.__PENDING_OPERATOR__, null);
  app.saveOperatorChoice();
  eq(app.localStorage.getItem('case-tracker-operator-v1'), 'op-db-only');
  // restore globals
  app.OPERATORS.pop();
  app.STATE.operatorId = prevOp;
  app.__PENDING_OPERATOR__ = null;
  if (prevKey == null) app.localStorage.removeItem('case-tracker-operator-v1');
  else app.localStorage.setItem('case-tracker-operator-v1', prevKey);
});
test('operator pick: explicit pick clears pending and wins', () => {
  const prevOp = app.STATE.operatorId;
  const prevKey = app.localStorage.getItem('case-tracker-operator-v1');
  app.__PENDING_OPERATOR__ = 'op-gone';
  app.STATE.operatorId = opId;
  app.__PENDING_OPERATOR__ = null;                   // what the switcher / gate handlers do
  app.saveOperatorChoice();
  eq(app.localStorage.getItem('case-tracker-operator-v1'), opId);
  app.STATE.operatorId = prevOp;
  if (prevKey == null) app.localStorage.removeItem('case-tracker-operator-v1');
  else app.localStorage.setItem('case-tracker-operator-v1', prevKey);
  app.saveOperatorChoice();
});

/* ---------- picked flag survives closing (analysis views) ---------- */
test('closed picked case: off the board (isPicked) but flag retained (isQueued)', () => {
  const c = app.pickedCases()[0];
  ok(c, 'a picked case exists');
  const prev = c.status;
  c.status = 'closed';
  ok(!app.isPicked(c), 'drops off the Route Board / picked workspace');
  ok(app.isQueued(c), 'pick flag retained for analysis');
  c.status = prev;
});
test('archive "Picked only" still lists a case that closed after being picked', () => {
  const c = app.pickedCases()[0];
  const prevStatus = c.status, prevFilter = app.STATE.archivePickedOnly;
  c.status = 'closed';
  app.STATE.archivePickedOnly = true;
  ok(app.archiveWeekCases(c.weekId).some(x => x.id === c.id), 'kept in the picked-only week view');
  c.status = prevStatus;
  app.STATE.archivePickedOnly = prevFilter;
});
test('renderQueueToggleButton: closed+picked → static kept badge; closed+unpicked → nothing', () => {
  const kept = app.renderQueueToggleButton({ id: 'X', status: 'closed', agentStatus: 'queued' }, 'tiny');
  ok(kept.includes('queue-kept') && kept.includes('✓ Picked'), 'static badge');
  ok(!kept.includes('<button'), 'not interactive');
  eq(app.renderQueueToggleButton({ id: 'X', status: 'closed', agentStatus: 'unqueued' }, 'tiny'), '');
});

/* ---------- deleteHandoverNote ---------- */
test('deleteHandoverNote: deleting the latest falls back to the previous note', () => {
  const c = {
    history: [
      { at: iso(3 * HOUR), who: opId, kind: 'handover', detail: 'Handover note (Day → Night): first' },
      { at: iso(1 * HOUR), who: opId, kind: 'handover', detail: 'Handover note (Day → Night): second' },
    ],
    handover: { at: iso(1 * HOUR), author: opId, note: 'second', from: 'Day', to: 'Night' },
  };
  ok(app.deleteHandoverNote(c, iso(1 * HOUR)));
  eq(c.handover.note, 'first', 'previous note promoted');
  eq(c.handover.from, 'Day'); eq(c.handover.to, 'Night');
  ok(c.handover.staleForCurrentShift, 'restored note marked stale');
  eq(app.caseHandoverNotes(c).length, 1, 'one note left');
});
test('deleteHandoverNote: deleting the only note clears c.handover', () => {
  const c = {
    history: [{ at: iso(1 * HOUR), who: opId, kind: 'handover', detail: 'Handover note (Day → Night): solo' }],
    handover: { at: iso(1 * HOUR), author: opId, note: 'solo', from: 'Day', to: 'Night' },
  };
  ok(app.deleteHandoverNote(c, iso(1 * HOUR)));
  eq(c.handover, null);
  eq(app.caseNotesText(c), '', 'export empties too');
});
test('deleteHandoverNote: deleting an older note keeps the current one', () => {
  const c = {
    history: [
      { at: iso(3 * HOUR), who: opId, kind: 'handover', detail: 'Handover note (Day → Night): first' },
      { at: iso(1 * HOUR), who: opId, kind: 'handover', detail: 'Handover note (Day → Night): second' },
    ],
    handover: { at: iso(1 * HOUR), author: opId, note: 'second', from: 'Day', to: 'Night' },
  };
  ok(app.deleteHandoverNote(c, iso(3 * HOUR)));
  eq(c.handover.note, 'second', 'current untouched');
  eq(app.caseHandoverNotes(c).length, 1);
});
test('deleteHandoverNote: soft delete retains the note + text for audit/recovery', () => {
  const c = {
    history: [
      { at: iso(3 * HOUR), who: opId, kind: 'handover', detail: 'Handover note (Day → Night): first' },
      { at: iso(1 * HOUR), who: opId, kind: 'handover', detail: 'Handover note (Day → Night): second' },
    ],
    handover: { at: iso(1 * HOUR), author: opId, note: 'second', from: 'Day', to: 'Night' },
  };
  ok(app.deleteHandoverNote(c, iso(1 * HOUR), opId));
  eq(c.history.length, 2, 'entry retained in history, not spliced out');
  const gone = c.history.find(h => h.at === iso(1 * HOUR));
  ok(gone.deleted, 'entry flagged deleted');
  ok(gone.deletedAt, 'deletion time recorded');
  eq(gone.deletedBy, opId, 'deleter recorded');
  ok(/second/.test(gone.detail), 'original text kept for recovery');
  eq(app.caseHandoverNotes(c).length, 1, 'but hidden from the visible notes');
  ok(!app.caseNotesText(c).includes('second'), 'and hidden from the export');
});

test('moving row: assigned core-bound case shows BOTH deadline and member chips', () => {
  // Find a core-bound moving case in the seed and assign a member with a known name.
  const c = app.pickedCases().find(x => (x.trackStatus || null) === 'escalate_to_core');
  ok(c, 'seed has an escalate_to_core case');
  const desk = app.OWNERS.core.find(d => Array.isArray(d.members) && d.members.length);
  ok(desk, 'a core desk with members exists');
  const prevCore = c.coreId, prevMember = c.coreMemberId;
  c.coreId = desk.id; c.coreMemberId = desk.members[0].id;
  const html = app._renderMovingRow(c, 0, 0);
  ok(html.includes('rb-chip-member'), 'member chip present');
  ok(html.includes(desk.members[0].name.replace(/&/g, '&amp;').slice(0, 8)) || html.includes(desk.members[0].name), 'member name shown');
  ok(/rb-chip rb-chip-(amber|overdue)/.test(html), 'deadline chip still present');
  c.coreId = prevCore; c.coreMemberId = prevMember;
});

/* ---------- track() + analytics chart helpers ---------- */
test('track: no-ops outside DB-backend mode', () => {
  app.__EVENT_BUFFER__.length = 0;
  app.track('pick', null, 'C-1');
  eq(app.__EVENT_BUFFER__.length, 0, 'demo mode must not collect events');
});
test('track: buffers a correctly-shaped event in DB-backend mode', () => {
  app.__SERVER_OPERATOR_LAYER__ = true;
  app.__EVENT_BUFFER__.length = 0;
  app.track('copy_table', { via: 'test' }, 'C-9');
  eq(app.__EVENT_BUFFER__.length, 1);
  const ev = app.__EVENT_BUFFER__[0];
  eq(ev.kind, 'copy_table');
  eq(ev.caseId, 'C-9');
  eq(ev.detail, { via: 'test' });
  ok(typeof ev.at === 'string' && ev.at.includes('T'), 'ISO timestamp');
  ok(!!ev.operatorId, 'operator attributed');
  app.__SERVER_OPERATOR_LAYER__ = false;
  app.__EVENT_BUFFER__.length = 0;
});
test('barChartHtml: one bar row per datum', () => {
  const html = app.barChartHtml([{ label: 'Mia', value: 5 }, { label: 'Ren', value: 2 }]);
  eq((html.match(/an-bar-row/g) || []).length, 2);
});
test('lineChartSvg: renders a polyline over the series', () => {
  const svg = app.lineChartSvg([{ day: '2026-07-13', count: 1 }, { day: '2026-07-14', count: 3 }]);
  ok(svg.includes('<polyline'), 'has a line');
  ok(svg.includes('2026-07-13') && svg.includes('2026-07-14'), 'axis labels');
});
test('lineChartSvg: y-axis ticks and per-day hover titles', () => {
  const svg = app.lineChartSvg([{ day: '2026-07-13', count: 2 }, { day: '2026-07-14', count: 4 }]);
  ok((svg.match(/<title>/g) || []).length === 2, 'one hover title per day');
  ok(svg.includes('2026-07-14 — 4 events'), 'hover title carries the count');
  ok(svg.includes('text-anchor="end"') && svg.includes('>0<'), 'y-axis tick labels incl. 0');
  ok((svg.match(/<circle/g) || []).length === 2, 'a visible dot per day');
});

/* ---------- routeBoardTableData (export filter) ---------- */
test('routeBoardTableData: excludeSanity drops exactly the Sanity Check rows', () => {
  const shown = app.routeBoardCases();
  const sanity = shown.filter(c => (c.trackStatus || null) === 'sanity_check').length;
  ok(sanity > 0, 'seed should contain picked Sanity Check cases');
  const all = app.routeBoardTableData().rows.length;
  const filtered = app.routeBoardTableData({ excludeSanity: true }).rows.length;
  eq(all, shown.length);
  eq(filtered, all - sanity);
});

test('caseNotesText: no duplication when detail already contains the note', () => {
  const txt = app.caseNotesText({
    history: [{ at: iso(1 * HOUR), who: opId, kind: 'handover', detail: 'Handover note (Day → Night): watch the SLA' }],
    handover: { at: iso(1 * HOUR), author: opId, note: 'watch the SLA' },
  });
  eq(txt.split('\n').length, 1, 'single line');
  eq((txt.match(/watch the SLA/g) || []).length, 1, 'note text appears once');
});

/* ---------- caseSlaMs ---------- */
test('caseSlaMs: paused → accumulated only', () =>
  eq(caseSlaMs({ slaAccumulatedMs: 5 * HOUR, slaPaused: true, status: 'with_core', slaStartedAt: iso(2 * HOUR) }), 5 * HOUR));
test('caseSlaMs: closed → accumulated only (no running segment)', () =>
  eq(caseSlaMs({ slaAccumulatedMs: 3 * HOUR, slaPaused: false, status: 'closed', slaStartedAt: iso(2 * HOUR) }), 3 * HOUR));
test('caseSlaMs: running → accumulated + segment to now', () =>
  eq(caseSlaMs({ slaAccumulatedMs: HOUR, slaPaused: false, status: 'with_core', slaStartedAt: iso(2 * HOUR) }), 3 * HOUR));

/* ---------- caseHoldMs ---------- */
test('caseHoldMs: not current owner → stored total only', () =>
  eq(caseHoldMs({ holdMs: { core: 2 * HOUR, hq: 0 }, currentOwner: null }, 'core'), 2 * HOUR));
test('caseHoldMs: current owner → adds running segment', () =>
  eq(caseHoldMs({ holdMs: { core: HOUR, hq: 0 }, currentOwner: 'core', holdStartedAt: iso(HOUR) }, 'core'), 2 * HOUR));
test('caseHoldMs: other kind unaffected by running core segment', () =>
  eq(caseHoldMs({ holdMs: { core: HOUR, hq: 30 * 60000 }, currentOwner: 'core', holdStartedAt: iso(HOUR) }, 'hq'), 30 * 60000));

/* ---------- derivePromptsForCase ---------- */
const kinds = c => derivePromptsForCase(c).map(p => p.kind);
test('derive: closed → none', () => eq(kinds({ status: 'closed' }), []));
test('derive: resolved → none', () => eq(kinds({ status: 'resolved' }), []));
test('derive: new + unassigned → assign_core', () => eq(kinds({ id: 'X', status: 'new', coreId: null }), ['assign_core']));
test('derive: new + already assigned → none', () => eq(kinds({ id: 'X', status: 'new', coreId: 'core-apac' }), []));
test('derive: with_core + cannot resolve → escalate', () =>
  eq(kinds({ id: 'X', status: 'with_core', coreCannotResolve: true, lastOwnerContact: { at: iso(0) } }), ['escalate_to_hq']));
test('derive: with_core + idle past threshold → chase_core', () =>
  eq(kinds({ id: 'X', status: 'with_core', lastOwnerContact: { at: iso((TH.coreIdleHours + 1) * HOUR) } }), ['chase_core']));
test('derive: with_core + fresh contact → none', () =>
  eq(kinds({ id: 'X', status: 'with_core', lastOwnerContact: { at: iso(Math.max(0, TH.coreIdleHours - 1) * HOUR) } }), []));
test('derive: with_core + never contacted → chase_core (idle = Infinity)', () =>
  eq(kinds({ id: 'X', status: 'with_core' }), ['chase_core']));
test('derive: with_hq + idle past threshold → chase_hq', () =>
  eq(kinds({ id: 'X', status: 'with_hq', lastOwnerContact: { at: iso((TH.hqIdleHours + 1) * HOUR) } }), ['chase_hq']));
test('derive: sanity_check → verify_fix', () => eq(kinds({ id: 'X', status: 'sanity_check' }), ['verify_fix']));

/* ---------- needsHandoverNote ---------- */
test('handover: closed → false', () => ok(!needsHandoverNote({ status: 'closed' })));
test('handover: new → false', () => ok(!needsHandoverNote({ status: 'new' })));
test('handover: open + no note → true', () => ok(needsHandoverNote({ status: 'with_core', handover: null })));
test('handover: open + stale note → true', () => ok(needsHandoverNote({ status: 'with_core', handover: { staleForCurrentShift: true } })));
test('handover: open + fresh note by current shift → false', () =>
  ok(!needsHandoverNote({ status: 'with_core', handover: { staleForCurrentShift: false, author: opId } })));

/* ---------- ownership/holder totals (drives the clocks, incl. First line) ----------
 * holderTotals reconstructs possession segments from case history; the case-detail clocks
 * (SLA aside) are derived from it. First-line handling time = triage only; Sanity Check time
 * is attributed to the requester (4.8). */
const holderTotals = app.holderTotals;
const lifecycle = {
  createdAt: iso(10 * HOUR), status: 'closed', history: [
    { at: iso(10 * HOUR), kind: 'created' },
    { at: iso(8 * HOUR), kind: 'assigned', detail: 'Core Team — APAC' },
    { at: iso(5 * HOUR), kind: 'escalated', detail: 'FIT → HQ' },
    { at: iso(3 * HOUR), kind: 'status', detail: '→ Sanity Check' },
    { at: iso(1 * HOUR), kind: 'closed', detail: 'Resolution: fixed' },
  ],
};
test('holderTotals: full lifecycle splits triage/core/hq; sanity → requester', () => {
  const t = holderTotals(lifecycle);
  // triage 10→8h, core 8→5h, hq 5→3h, Sanity-Check 3→1h counted as requester.
  eq([t.triage, t.core, t.hq, t.requester], [2 * HOUR, 3 * HOUR, 2 * HOUR, 2 * HOUR]);
});
test('holderTotals: first-line time = triage only (no sanity)', () => {
  const t = holderTotals(lifecycle);
  eq(t.triage, 2 * HOUR);
  ok(!('sanity' in t), 'no separate sanity bucket');
});
test('holderTotals: open New case accrues triage up to now', () => {
  const c = { createdAt: iso(4 * HOUR), status: 'new', history: [{ at: iso(4 * HOUR), kind: 'created' }] };
  eq(holderTotals(c).triage, 4 * HOUR);
});
test('holderTotals: open Sanity Check case accrues requester time up to now', () => {
  const c = {
    createdAt: iso(5 * HOUR), status: 'sanity_check', history: [
      { at: iso(5 * HOUR), kind: 'created' },
      { at: iso(4 * HOUR), kind: 'assigned', detail: 'Core Team — APAC' },
      { at: iso(2 * HOUR), kind: 'status', detail: '→ Sanity Check' },
    ],
  };
  const t = holderTotals(c);
  eq([t.triage, t.core, t.requester], [1 * HOUR, 2 * HOUR, 2 * HOUR]);
});
test('holderTotals: returned case accrues requester time up to now', () => {
  const c = {
    createdAt: iso(6 * HOUR), status: 'returned_to_requester', history: [
      { at: iso(6 * HOUR), kind: 'created' },
      { at: iso(5 * HOUR), kind: 'assigned', detail: 'Core Team — APAC' },
      { at: iso(2 * HOUR), kind: 'returned', detail: 'Returned to requester' },
    ],
  };
  const t = holderTotals(c);
  eq([t.triage, t.core, t.requester], [1 * HOUR, 3 * HOUR, 2 * HOUR]);
});
test('holderTotals: open case with no history accrues triage from creation', () => {
  // A brand-new live case (empty history) has been in first line since it was created.
  const t = holderTotals({ createdAt: iso(HOUR), status: 'new', history: [] });
  eq([t.triage, t.core, t.hq, t.requester], [HOUR, 0, 0, 0]);
});
test('holderTotals: live case (no created event) — first line = assign − create', () => {
  // Live cases arrive with an empty history; assigning to FIT adds only an 'assigned' event.
  const c = {
    createdAt: iso(3 * HOUR), status: 'with_core', history: [
      { at: iso(1 * HOUR), who: 'op', kind: 'assigned', detail: 'Core Team — APAC' },
    ],
  };
  const t = holderTotals(c);
  eq(t.triage, 2 * HOUR);   // assign (1h ago) − create (3h ago) = 2h on first line
  eq(t.core, 1 * HOUR);      // assign (1h ago) → now = 1h with FIT
});

/* ---------- process timeline (Case Center per-stage processing log) ----------
 * processSegments orders the raw processTimeline by start time and gives each entry a duration
 * (its processMinutes, falling back to end − start). Drives the case-detail "Process timeline". */
const processSegments = app.processSegments;
test('processSegments: empty / missing → []', () => {
  eq(processSegments({}), []);
  eq(processSegments({ processTimeline: [] }), []);
});
test('processSegments: orders by start; non-last uses minutes, last runs to now', () => {
  const segs = processSegments({ processTimeline: [
    { processType: 'B', startedAt: iso(2 * HOUR), endedAt: iso(1 * HOUR), minutes: 60 },
    { processType: 'A', startedAt: iso(4 * HOUR), endedAt: iso(2 * HOUR), minutes: 90 },
  ] });
  eq(segs.map(s => s.processType), ['A', 'B']);   // re-sorted oldest-first
  // A is not the current stage → uses its minutes (90m). B is the current/last stage →
  // its frozen endedAt is overridden to now (start 2h ago → 2h elapsed), minutes ignored.
  eq(segs.map(s => s.ms), [90 * 60000, 120 * 60000]);
});
test('processSegments: non-last with no minutes falls back to end − start', () => {
  const segs = processSegments({ processTimeline: [
    { startedAt: iso(3 * HOUR), endedAt: iso(1 * HOUR) },   // non-last → end−start = 2h
    { startedAt: iso(1 * HOUR), endedAt: iso(1 * HOUR) },   // last → forced to now = 1h
  ] });
  eq(segs[0].ms, 2 * HOUR);
  eq(segs[1].ms, 1 * HOUR);
});
test('processSegments: non-objects are dropped', () => {
  eq(processSegments({ processTimeline: [null, 0, { startedAt: iso(HOUR), minutes: 0 }] }).length, 1);
});
test('processSegments: open stage (no endedAt) runs to now', () => {
  const segs = processSegments({ processTimeline: [
    { processType: 'Service Team', startedAt: iso(2 * HOUR) },   // current stage, still open
  ] });
  eq(segs[0].ms, 2 * HOUR);   // start 2h ago → now = 2h elapsed
  eq(segs[0].end, FIXED);     // end defaulted to NOW (the frozen clock)
});

test('processSegments: last stage runs to now even with a stale endedAt', () => {
  const segs = processSegments({ processTimeline: [
    { processType: '1st  Line', startedAt: iso(5 * HOUR), endedAt: iso(4 * HOUR) },  // closed earlier stage
    { processType: 'Service Team', startedAt: iso(3 * HOUR), endedAt: iso(3 * HOUR) }, // current: endedAt frozen at start
  ] });
  // Earlier stage keeps its real endedAt window (5h ago → 4h ago = 1h).
  eq(segs[0].ms, 1 * HOUR);
  eq(segs[0].end, FIXED - 4 * HOUR);
  // Last stage's frozen endedAt is overridden to NOW (start 3h ago → now = 3h elapsed).
  eq(segs[1].end, FIXED);
  eq(segs[1].ms, 3 * HOUR);
});

test('processSegments: last stage ignores stale minutes, recomputes to now', () => {
  const segs = processSegments({ processTimeline: [
    { processType: 'Service Team', startedAt: iso(2 * HOUR), endedAt: iso(2 * HOUR), minutes: 1 },
  ] });
  eq(segs[0].end, FIXED);
  eq(segs[0].ms, 2 * HOUR);   // not 1 minute — last stage recomputes start→now
});

test('processSegments: closed case keeps its real final endedAt (not now)', () => {
  const segs = processSegments({ status: 'closed', processTimeline: [
    { processType: 'Service Team', startedAt: iso(3 * HOUR), endedAt: iso(1 * HOUR) },  // resolved 1h ago
  ] });
  eq(segs[0].end, FIXED - 1 * HOUR);   // real completion time, NOT now
  eq(segs[0].ms, 2 * HOUR);            // 3h ago → 1h ago = 2h
});

/* ---------- itProcessMs (total IT-side process time; Route Board + Overview column) ---------- */
// IT process time = 1st Line + Service Team + 2nd Line + Unknown (everything except User).
test('itProcessMs: sums all IT stages, ignores User', () => {
  const ms = app.itProcessMs({ status: 'closed', processTimeline: [
    { processType: 'Unknown',      startedAt: iso(6 * HOUR), endedAt: iso(5 * HOUR) },  // 1h
    { processType: '1st  Line',    startedAt: iso(5 * HOUR), endedAt: iso(4 * HOUR) },  // 1h
    { processType: 'Service Team', startedAt: iso(4 * HOUR), endedAt: iso(3 * HOUR) },  // 1h
    { processType: '2nd Line',     startedAt: iso(3 * HOUR), endedAt: iso(2 * HOUR) },  // 1h
    { processType: 'User',         startedAt: iso(2 * HOUR), endedAt: iso(1 * HOUR) },  // ignored
  ] });
  eq(ms, 4 * HOUR);
});
test('itProcessMs: whitespace/case-normalised matching', () => {
  eq(app.itProcessMs({ status: 'closed', processTimeline: [
    { processType: '1st Line', startedAt: iso(2 * HOUR), endedAt: iso(1 * HOUR) },   // single space
  ] }), 1 * HOUR);
});
test('itProcessMs: open current IT segment counts up to now', () => {
  eq(app.itProcessMs({ status: 'new', processTimeline: [
    { processType: 'Service Team', startedAt: iso(2 * HOUR) },   // open → runs to now
  ] }), 2 * HOUR);
});
test('itProcessMs: User-only timeline → 0', () => {
  eq(app.itProcessMs({ status: 'closed', processTimeline: [
    { processType: 'User', startedAt: iso(2 * HOUR), endedAt: iso(1 * HOUR) },
  ] }), 0);
});
test('itProcessOver: over the configured limit (THRESHOLDS.itProcessHours)', () => {
  const under = { status: 'closed', processTimeline: [
    { processType: 'Service Team', startedAt: iso(10 * HOUR), endedAt: iso(0) },  // 10h
  ] };
  const over = { status: 'closed', processTimeline: [
    { processType: 'Service Team', startedAt: iso(20 * HOUR), endedAt: iso(0) },  // 20h
  ] };
  ok(!app.itProcessOver(under), 'under 15h limit');
  ok(app.itProcessOver(over), 'over 15h limit');
});

/* ---------- SLA · time on us / Total time / On-us share (case-detail clocks) ----------
 * SLA · time on us = itProcessMs (IT-side stages). Total time = every process stage. The share
 * is itProcessMs / processTotalMs as a 0–100 integer. */
test('processTotalMs: sums every stage incl. User (the whole lifetime)', () => {
  eq(app.processTotalMs({ status: 'closed', processTimeline: [
    { processType: 'User',     startedAt: iso(20 * HOUR), endedAt: iso(15 * HOUR) },  // 5h
    { processType: '1st Line', startedAt: iso(15 * HOUR), endedAt: iso(0) },          // 15h
  ] }), 20 * HOUR);
});
test('slaSharePct: IT time as a share of total time', () => {
  eq(app.slaSharePct({ status: 'closed', processTimeline: [
    { processType: 'User',     startedAt: iso(20 * HOUR), endedAt: iso(15 * HOUR) },  // 5h (not on us)
    { processType: '1st Line', startedAt: iso(15 * HOUR), endedAt: iso(0) },          // 15h on us
  ] }), 75);   // 15 / 20
});
test('slaSharePct: empty timeline → null (renders as —)', () => {
  eq(app.slaSharePct({ status: 'new', processTimeline: [] }), null);
});

/* ---------- "Wait User" due math (case-detail "Waiting on user" panel) ----------
 * waitUserDueMs returns signed ms to the Wait User due time (NOW-based): positive = due in the
 * future, negative = overdue, null = no waitUser/due date. */
const waitUserDueMs = app.waitUserDueMs;
test('waitUserDueMs: null without waitUser or due date', () => {
  eq(waitUserDueMs({}), null);
  eq(waitUserDueMs({ waitUser: {} }), null);
});
test('waitUserDueMs: positive when due in the future', () =>
  eq(waitUserDueMs({ waitUser: { dueDateTime: iso(-2 * HOUR) } }), 2 * HOUR));
test('waitUserDueMs: negative when overdue', () =>
  eq(waitUserDueMs({ waitUser: { dueDateTime: iso(3 * HOUR) } }), -3 * HOUR));

/* ---------- caseHref (Case Center link, with client-side fallback) ----------
 * Prefer the server-built caseLink; fall back to base URL + id when it's empty (e.g. a case
 * stored before CASE_CENTER_BASE_URL was set, now that refresh no longer re-fetches). */
const caseHref = app.caseHref;
test('caseHref: uses the stored caseLink when present', () =>
  eq(caseHref({ id: 'C-1', caseLink: 'https://cc.example/CC-1' }), 'https://cc.example/CC-1'));
test('caseHref: builds from base URL + id when caseLink is empty', () => {
  app.CASE_CENTER_BASE_URL = 'https://cc.example/cases/';   // trailing slash trimmed
  eq(caseHref({ id: 'C-9', caseLink: '' }), 'https://cc.example/cases/C-9');
  delete app.CASE_CENTER_BASE_URL;
});
test('caseHref: empty string when there is no link and no base URL', () =>
  eq(caseHref({ id: 'C-9' }), ''));

/* ---------- XSS / injection hardening (safeId / safeUrl / caseHref) ----------
 * Case Center caseId + caseLink are untrusted and flow into innerHTML attributes,
 * #/cases/<id> routes and href="...". These boundary sanitisers must strip markup
 * breakout chars from ids and reject non-http(s) schemes from links. */
const { safeId, safeUrl, sanitizeCaseIdentity } = app;
test('safeId: strips markup/attribute breakout chars', () =>
  eq(safeId('"><img src=x onerror=alert(1)>'), 'img src=x onerror=alert(1)'));
test('safeId: preserves ordinary case ids (hyphens, dots, digits)', () =>
  eq(safeId('C-2401.3'), 'C-2401.3'));
test('safeId: coerces null/undefined to empty string', () =>
  eq([safeId(null), safeId(undefined)], ['', '']));
test('safeUrl: keeps http(s) links', () => {
  eq(safeUrl('https://cc.example/CC-1'), 'https://cc.example/CC-1');
  eq(safeUrl('http://cc.example/CC-1'), 'http://cc.example/CC-1');
});
test('safeUrl: rejects javascript:/data: and other schemes', () =>
  eq([safeUrl('javascript:alert(1)'), safeUrl('data:text/html,<script>'), safeUrl('JavaScript:alert(1)')], ['', '', '']));
test('caseHref: refuses a javascript: caseLink (falls through to empty)', () =>
  eq(caseHref({ id: 'C-1', caseLink: 'javascript:alert(1)' }), ''));
test('sanitizeCaseIdentity: cleans id and caseLink in place', () => {
  const c = sanitizeCaseIdentity({ id: 'A"><b>', caseLink: 'javascript:alert(1)' });
  eq([c.id, c.caseLink], ['Ab', '']);
});

/* ---------- seed sanity (structural; robust to data.js regeneration) ---------- */
test('seed: CASES is a non-empty array', () => ok(Array.isArray(app.CASES) && app.CASES.length > 0));
test('seed: every case has a non-empty string id', () => {
  // Two shapes possible: legacy board-shape (`id`) or raw Case Center
  // (`caseId`, mapped at boot via mapRawCcRecord). Accept either.
  const idField = app.CASES_RAW_CC ? 'caseId' : 'id';
  ok(app.CASES.every(c => typeof c[idField] === 'string' && c[idField].trim()));
});
test('seed: thresholds present and numeric', () =>
  ok(typeof TH.coreIdleHours === 'number' && typeof TH.hqIdleHours === 'number'));

/* ---------- Route Board dept-list config ---------- */
test('owners: CC dept lists are non-empty arrays', () => {
  ok(Array.isArray(app.CC_CORE_DEPARTMENTS) && app.CC_CORE_DEPARTMENTS.length > 0, 'core list');
  ok(Array.isArray(app.CC_HQ_DEPARTMENTS) && app.CC_HQ_DEPARTMENTS.length > 0, 'hq list');
});

/* ---------- action handlers (handlePrompt outcomes) ----------
 * handlePrompt opens a modal via showModal(html, onSubmit) then mutates the case on submit.
 * We intercept showModal/render/showToast (sloppy-mode globals are reassignable), drive
 * onSubmit with a fake modal, and read the mutated case back via caseById. The clock is
 * frozen, so clock math is exact. A single scratch case is reset to a known baseline per test. */
app.render = () => {};
const toasts = [];
app.showToast = (m, t) => toasts.push({ m, t });
let _modal = null;
app.showModal = (html, onSubmit) => { _modal = { html, onSubmit }; };

const FIT = app.OWNERS.core[0].id;
const HQ = app.OWNERS.hq[0].id;
// Pick the first mapped (board-shape) case from STATE via the public caseById
// helper — covers both raw-CC and legacy seeds without reaching into STATE.
const SCRATCH_ID = (() => {
  const idField = app.CASES_RAW_CC ? 'caseId' : 'id';
  const id = app.CASES[0][idField];
  return id;
})();
function scratch(props) {
  const c = app.caseById(SCRATCH_ID);
  Object.assign(c, {
    status: 'new', agentStatus: 'unqueued', coreId: null, hqId: null, currentOwner: null,
    coreCannotResolve: false, slaPaused: false, slaAccumulatedMs: 0, slaStartedAt: iso(0),
    holdMs: { core: 0, hq: 0 }, holdStartedAt: null, lastOwnerContact: null,
    handover: null, reminder: null, closedAt: undefined, resolutionCode: undefined,
    history: [], user: 'Test User',
  }, props);
  return c;
}
function fakeModal(values) {
  return {
    querySelector: sel => {
      const m = sel.match(/data-field="([^"]+)"/);
      const name = m && m[1];
      return { value: name && values[name] != null ? String(values[name]) : '' };
    },
  };
}
function submitPrompt(caseId, kind, values) {       // open + submit a modal handler
  _modal = null; toasts.length = 0;
  app.handlePrompt(caseId, kind);
  const ret = _modal ? _modal.onSubmit(fakeModal(values || {})) : undefined;
  return { opened: !!_modal, ret };
}
function directPrompt(caseId, kind) {               // no-modal handler
  toasts.length = 0;
  app.handlePrompt(caseId, kind);
}
const lastKind = c => c.history[c.history.length - 1].kind;

test('assign_core: routes new case to FIT and starts the hold clock', () => {
  const c = scratch({ status: 'new', coreId: null });
  submitPrompt(SCRATCH_ID, 'assign_core', { coreId: FIT });
  eq([c.status, c.currentOwner, c.coreId, lastKind(c)], ['with_core', 'core', FIT, 'assigned']);
  ok(c.holdStartedAt && c.lastOwnerContact && c.lastOwnerContact.channel === 'Slack');
});

test('escalate_to_hq: stops FIT clock, starts HQ, clears cannot-resolve', () => {
  const c = scratch({ status: 'with_core', currentOwner: 'core', coreId: FIT, holdStartedAt: iso(2 * HOUR), coreCannotResolve: true });
  submitPrompt(SCRATCH_ID, 'escalate_to_hq', { hqId: HQ, reason: 'needs product' });
  eq([c.status, c.currentOwner, c.hqId, c.coreCannotResolve, c.holdMs.core, lastKind(c)],
     ['with_hq', 'hq', HQ, false, 2 * HOUR, 'escalated']);
});

test('verify_fix: closes the case, banks the SLA, stops clocks', () => {
  const c = scratch({ status: 'sanity_check', currentOwner: 'hq', hqId: HQ, holdStartedAt: iso(HOUR), slaAccumulatedMs: HOUR, slaStartedAt: iso(2 * HOUR) });
  const { ret } = submitPrompt(SCRATCH_ID, 'verify_fix', { code: 'fixed_by_owner', note: 'confirmed' });
  eq([ret, c.status, c.resolutionCode, c.currentOwner, c.holdStartedAt, c.holdMs.hq, c.slaAccumulatedMs, lastKind(c)],
     [true, 'closed', 'fixed_by_owner', null, null, HOUR, 3 * HOUR, 'closed']);
});

test('verify_fix: blank note is rejected and nothing changes', () => {
  const c = scratch({ status: 'sanity_check', currentOwner: 'hq', hqId: HQ });
  const { ret } = submitPrompt(SCRATCH_ID, 'verify_fix', { code: 'fixed_by_owner', note: '' });
  eq([ret, c.status, c.history.length], [false, 'sanity_check', 0]);
});

test('approaching_sla: pauses SLA and returns to requester', () => {
  const c = scratch({ status: 'with_hq', currentOwner: 'hq', hqId: HQ, holdStartedAt: iso(HOUR), slaStartedAt: iso(3 * HOUR) });
  submitPrompt(SCRATCH_ID, 'approaching_sla', { reason: 'need repro' });
  eq([c.status, c.slaPaused, c.currentOwner, c.holdStartedAt, c.slaAccumulatedMs, c.holdMs.hq, lastKind(c)],
     ['returned_to_requester', true, null, null, 3 * HOUR, HOUR, 'returned']);
});

test('approaching_sla: first line can return a New case to the requester (4.9)', () => {
  const c = scratch({ status: 'new', currentOwner: null, slaStartedAt: iso(2 * HOUR) });
  const { ret } = submitPrompt(SCRATCH_ID, 'approaching_sla', { reason: 'need repro steps' });
  eq([ret, c.status, c.slaPaused, c.slaAccumulatedMs, lastKind(c)],
     [true, 'returned_to_requester', true, 2 * HOUR, 'returned']);
});
test('statusTransitions: returns empty after CC-shaped action surface removal', () => {
  // The kanban-by-CC-status board and its status-transition dropdown are gone (see
  // docs/case-center-overview-plan.md §4); the only operator-set field on a picked
  // case is now `trackStatus`. statusTransitions() survives as a no-op shim.
  eq(app.statusTransitions({ status: 'new' }), []);
});

test('resume: restarts the SLA clock and routes back to FIT', () => {
  const c = scratch({ status: 'returned_to_requester', slaPaused: true, coreId: FIT, slaStartedAt: iso(10 * HOUR) });
  submitPrompt(SCRATCH_ID, 'resume', { dest: 'core', note: '' });
  eq([c.status, c.currentOwner, c.slaPaused, c.slaStartedAt, lastKind(c)],
     ['with_core', 'core', false, iso(0), 'resumed']);
});

test('cancel: marks cancelled, banks clocks, warns', () => {
  const c = scratch({ status: 'with_core', currentOwner: 'core', coreId: FIT, holdStartedAt: iso(HOUR), slaStartedAt: iso(HOUR) });
  submitPrompt(SCRATCH_ID, 'cancel', { reason: 'duplicate' });
  eq([c.status, c.currentOwner, c.holdMs.core, c.slaAccumulatedMs, lastKind(c)],
     ['cancelled', null, HOUR, HOUR, 'cancelled']);
  eq(toasts[0].t, 'warn');
});

test('toggle_queue: picks/unpicks the case with history', () => {
  const c = scratch({ status: 'with_core', agentStatus: 'unqueued' });
  directPrompt(SCRATCH_ID, 'toggle_queue');
  eq([c.agentStatus, lastKind(c)], ['queued', 'picked']);
  directPrompt(SCRATCH_ID, 'toggle_queue');
  eq([c.agentStatus, lastKind(c)], ['unqueued', 'unpicked']);
});

test('move_to_sanity_check: direct status change', () => {
  const c = scratch({ status: 'with_hq', currentOwner: 'hq', hqId: HQ });
  directPrompt(SCRATCH_ID, 'move_to_sanity_check');
  eq([c.status, lastKind(c)], ['sanity_check', 'status']);
});

test('unknown / missing case id is a no-op', () => {
  _modal = null; toasts.length = 0;
  app.handlePrompt('NO-SUCH-CASE', 'assign_core');
  eq([_modal, toasts.length], [null, 0]);
});

/* ---------- live merge + refresh UI gating (4.1 / 4.2) ---------- */
const mergeLiveCase = app.mergeLiveCase;
test('mergeLiveCase: malformed records → null', () => {
  eq([mergeLiveCase(null), mergeLiveCase('x'), mergeLiveCase({}), mergeLiveCase({ id: '   ' }), mergeLiveCase([{ id: 'x' }])],
     [null, null, null, null, null]);
});
test('mergeLiveCase: new id is added + normalized', () => {
  const r = mergeLiveCase({ id: 'C-MERGE-NEW', subject: 'New one', status: 'with_core' });
  eq([r.added, r.id], [true, 'C-MERGE-NEW']);
  const c = app.caseById('C-MERGE-NEW');
  eq([c.status, c.subject, c.agentStatus], ['with_core', 'New one', 'unqueued']);
});
test('mergeLiveCase: refresh updates CC fields (incl. status) but preserves operator work', () => {
  // Simulate operator work on the case: assigned to FIT, notes, history, clocks, queue, handover.
  const c0 = app.caseById('C-MERGE-NEW');
  Object.assign(c0, {
    status: 'with_core', coreId: 'core-apac', currentOwner: 'core', agentStatus: 'queued',
    notes: 'operator notes', slaAccumulatedMs: 3 * HOUR, holdMs: { core: HOUR, hq: 0 },
    history: [{ at: iso(2 * HOUR), who: 'op', kind: 'assigned', detail: 'Core Team — APAC' }],
    handover: { note: 'keep me', author: 'op', from: 'Day', to: 'Night', at: iso(0), staleForCurrentShift: false },
  });
  // Case Center sends back the raw record. status IS now a CC-owned field — when CC moves
  // the case, the board follows along on the next refresh.
  const r = mergeLiveCase({ id: 'C-MERGE-NEW', subject: 'Updated subject', status: 'new', priority: 'high', ccStatusLabel: 'In-Progress' });
  eq(r.added, false);
  const c = app.caseById('C-MERGE-NEW');
  // CC-owned fields refreshed (status moved with the raw payload):
  eq([c.subject, c.priority, c.ccStatusLabel, c.status], ['Updated subject', 'high', 'In-Progress', 'new']);
  // Operator's local layer preserved (routing, notes, clocks, queue, history, handover):
  eq([c.coreId, c.currentOwner, c.agentStatus, c.notes, c.slaAccumulatedMs, c.holdMs.core, c.history.length, c.handover.note],
     ['core-apac', 'core', 'queued', 'operator notes', 3 * HOUR, HOUR, 1, 'keep me']);
});
test('toolbar (http): live-fetch controls hidden by flag; per-case refresh still renders', () => {
  // SHOW_LIVE_FETCH_CONTROLS is false — "Created between … Load New" and "Refresh Existing"
  // are hidden in the UI (code retained behind the flag). Per-case refresh on cards stays.
  app.location.protocol = 'https:'; app.__LIVE__ = true;
  const html = app.renderCaseList();
  ok(!html.includes('>Load New<'), 'Load New hidden by flag');
  ok(!html.includes('id="refresh-existing"'), 'Refresh Existing hidden by flag');
  ok(html.includes('data-action="refresh-case"'), 'per-case refresh on cards');
});
test('toolbar (file://): live-fetch controls hidden by flag; per-case refresh still renders', () => {
  app.location.protocol = 'file:'; app.__LIVE__ = false;
  const html = app.renderCaseList();
  ok(!html.includes('id="lookback-load"'), 'no look-back "Load New" control');
  ok(!html.includes('id="refresh-existing"'), 'Refresh Existing hidden by flag');
  ok(html.includes('data-action="refresh-case"'), 'per-case refresh shown even on file://');
});

/* ---------- recycle bin (4.4) ---------- */
const REAL_HOUR = 3600 * 1000;
test('isBinned / binExpired / binMsRemaining', () => {
  // `realNow()` inside the sandbox is anchored to FIXED (load-prototype.cjs
  // freezes Date for determinism), so build deletedAt off realNow() too — using
  // the host Date.now() makes this test flaky when the real wall-clock drifts
  // away from the seed's `window.NOW`.
  const fixedMs = app.realNow().getTime();
  const fresh = { deletedAt: new Date(fixedMs - REAL_HOUR).toISOString() };
  const old = { deletedAt: new Date(fixedMs - 8 * 24 * REAL_HOUR).toISOString() };
  ok(app.isBinned(fresh) && app.isBinned(old) && !app.isBinned({}));
  ok(!app.binExpired(fresh) && app.binExpired(old));
  ok(app.binMsRemaining(fresh) > 0 && app.binMsRemaining(old) === 0);
});
test('binned case is hidden from board, archive stats and week table', () => {
  // Board now renders only PICKED (queued) cases — find a non-closed, queued
  // case in STATE (post-mapping) so we can verify it appears, then delete it.
  // Iterating board-shape cases via caseById walks the same set the renderer
  // sees — no need to know whether the seed is raw or board.
  const idField = app.CASES_RAW_CC ? 'caseId' : 'id';
  const ids = app.CASES.map(r => r[idField]).filter(Boolean);
  const id = ids.find(x => {
    const c = app.caseById(x);
    // Skip Sanity Check cases: the picked list now shows them on their own tab (hidden from
    // the default Cases tab), so they wouldn't appear in renderCaseList() before deletion.
    return c && !['closed', 'cancelled'].includes(c.status) && c.agentStatus === 'queued'
      && (c.trackStatus || null) !== 'sanity_check';
  });
  const c = app.caseById(id);
  c.agentStatus = 'queued';
  const wk = c.weekId;
  const before = app.weekStats(wk).total;
  const boardBefore = app.renderCaseList().includes(`data-case-id="${id}"`);
  c.deletedAt = new Date().toISOString();
  const after = app.weekStats(wk).total;
  const boardAfter = app.renderCaseList().includes(`data-case-id="${id}"`);
  eq([after, boardBefore, boardAfter], [before - 1, true, false]);
  // and it shows up in the recycle bin view
  ok(app.renderRecycleBin().includes(id));
  c.deletedAt = null; // restore for other tests
});
test('purgeCases hard-removes from state', () => {
  app.mergeLiveCase({ id: 'C-PURGE', subject: 'Bye', status: 'new' });
  ok(app.caseById('C-PURGE'));
  app.__LIVE__ = false; // skip the server call in tests
  app.purgeCases(['C-PURGE']);
  ok(!app.caseById('C-PURGE'));
});

/* ---------- created-between load window (4.10) ---------- */
test('liveCasesUrl: legacy within-N vs created-between band', () => {
  eq(app.liveCasesUrl(72, 0), 'api/cases?hours=72');
  eq(app.liveCasesUrl(72, 60), 'api/cases?fromHours=72&toHours=60');
  eq(app.liveCasesUrl(0, 0), 'api/cases');
});
test('windowError: validates the created-between window', () => {
  eq(app.windowError(0, 0), 'Enter a positive number of hours for the older bound.');
  eq(app.windowError(72, -1), 'The newer bound must be 0 or more hours ago.');
  eq(app.windowError(60, 72), 'The newer bound must be smaller than the older bound.');
  eq(app.windowError(72, 60), null);
  eq(app.windowError(24, 0), null);
});

/* ---------- reminder: set at a specific time ---------- */
test('nextTimeIso: next future occurrence of a local HH:MM (today or tomorrow)', () => {
  const base = new Date(FIXED);
  const soon = new Date(base.getTime() + 60000);   // 1 min ahead → same day
  const hh = `${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`;
  const r = new Date(app.nextTimeIso(hh, base));
  ok(r.getTime() > base.getTime() && r.getTime() - base.getTime() <= 25 * HOUR);
  eq([r.getHours(), r.getMinutes()], [soon.getHours(), soon.getMinutes()]);
  const past = new Date(base.getTime() - 60000);   // 1 min behind → rolls to tomorrow
  const ph = `${String(past.getHours()).padStart(2, '0')}:${String(past.getMinutes()).padStart(2, '0')}`;
  ok(new Date(app.nextTimeIso(ph, base)).getTime() - base.getTime() > 23 * HOUR);
  eq([app.nextTimeIso('99:99', base), app.nextTimeIso('', base)], [null, null]);
});

/* ---------- latestProcessType (skips Unknown) ---------- */
const latestProcessType = app.latestProcessType;
test('latestProcessType: returns latest non-Unknown by start time', () => {
  eq(latestProcessType({ processTimeline: [
    { processType: '1st  Line', processStartTime: iso(3 * HOUR) },
    { processType: 'Service Team', processStartTime: iso(1 * HOUR) },
    { processType: 'Unknown', processStartTime: iso(0) },
  ] }), 'Service Team');
});
test('latestProcessType: empty / all-Unknown / missing → "1st  Line"', () => {
  eq(latestProcessType({ processTimeline: [] }), '1st  Line');
  eq(latestProcessType({ processTimeline: [{ processType: 'Unknown', processStartTime: iso(0) }] }), '1st  Line');
  eq(latestProcessType({}), '1st  Line');
});
test('latestProcessType: sorts by startedAt (mapped shape) regardless of array order', () => {
  eq(latestProcessType({ processTimeline: [
    { processType: 'Service Team', startedAt: iso(1 * HOUR) },  // more recent, listed first
    { processType: '1st  Line',    startedAt: iso(3 * HOUR) },  // older, listed second
  ] }), 'Service Team');
});

/* ---------- caseStation (dot = current CC location) ---------- */
const caseStation = app.caseStation;
// Pin the dept lists for deterministic tests.
app.CC_CORE_DEPARTMENTS = ['Site IT'];
app.CC_HQ_DEPARTMENTS = ['HQ Identity', 'HQ Mobile'];
const stationCase = (dept, pt, extra) => Object.assign({
  assigneeDept: dept,
  processTimeline: [{ processType: pt, processStartTime: iso(1 * HOUR) }],
}, extra || {});

test('caseStation: latest processType User wins everything', () =>
  eq(caseStation(stationCase('HQ Identity', 'User')), 'User'));
test('caseStation: Core dept + Service Team → Core Team', () =>
  eq(caseStation(stationCase('Site IT', 'Service Team')), 'Core Team'));
test('caseStation: Core dept + 1st Line → 1st Line', () =>
  eq(caseStation(stationCase('Site IT', '1st  Line')), '1st Line'));
test('caseStation: HQ dept → HQ', () =>
  eq(caseStation(stationCase('HQ Mobile', 'Service Team')), 'HQ'));
test('caseStation: unrecognised dept → 1st Line', () =>
  eq(caseStation(stationCase('Marketing', 'Service Team')), '1st Line'));
test('caseStation: Unknown is skipped when resolving', () =>
  eq(caseStation({ assigneeDept: 'Site IT', processTimeline: [
    { processType: 'Service Team', processStartTime: iso(2 * HOUR) },
    { processType: 'Unknown', processStartTime: iso(1 * HOUR) },
  ] }), 'Core Team'));
test('caseStation: Track Status no longer pins the dot to User', () =>
  eq(caseStation(stationCase('HQ Identity', 'Service Team', { trackStatus: 'sanity_check' })), 'HQ'));
test('caseStation: null/undefined input is safe → 1st Line', () => {
  eq(app.caseStation(null), '1st Line');
  eq(app.caseStation(undefined), '1st Line');
});
test('caseStation: case_closed Track Status also does not pin the dot', () =>
  eq(caseStation(stationCase('HQ Identity', 'Service Team', { trackStatus: 'case_closed' })), 'HQ'));

/* ---------- Route Board dot positions follow caseStation ---------- */
test('ROUTE_STATION_POS: 1st Line sits between User and Core', () => {
  ok(app.ROUTE_STATION_POS['1st Line'] > app.ROUTE_STATION_POS['User'], 'right of User');
  ok(app.ROUTE_STATION_POS['1st Line'] < app.ROUTE_STATION_POS['Core Team'], 'left of Core');
});
test('stay row dot is placed at the case station (HQ), not hard-coded User', () => {
  const c = { id: 'C-STAY', subject: 's', assigneeDept: 'HQ Identity',
    processTimeline: [{ processType: 'Service Team', processStartTime: iso(HOUR) }] };
  const html = app._renderStayRow(c, 0);
  ok(html.includes(`left:${app.ROUTE_STATION_POS['HQ']}%`), 'stay dot at the HQ station');
});
test('watch row dot is placed at the case station (HQ)', () => {
  const c = { id: 'C-WATCH', subject: 's', assigneeDept: 'HQ Identity', trackStatus: 'escalated_to_hq',
    processTimeline: [{ processType: 'Service Team', startedAt: iso(HOUR) }] };
  const html = app._renderWatchRow(c, 0);
  ok(html.includes(`left:${app.ROUTE_STATION_POS['HQ']}%`), 'watch dot at the HQ station');
});

/* ---------- watch row: settled ring (at expected) vs intent arrow (not at expected) ---------- */
test('watch: escalated_to_hq AT HQ → settled ring, no intent arrow', () => {
  const c = { id: 'C-EH', subject: 's', trackStatus: 'escalated_to_hq', assigneeDept: 'HQ Identity',
    processTimeline: [{ processType: 'Service Team', startedAt: iso(HOUR) }] };
  const html = app._renderWatchRow(c, 0);
  ok(html.includes('rb-watch-ring') && !html.includes('rb-row-watch-intent'), 'settled ring');
});
test('watch: escalated_to_hq NOT at HQ (at Core) → intent arrow pointing right (toward HQ)', () => {
  const c = { id: 'C-EHI', subject: 's', trackStatus: 'escalated_to_hq', assigneeDept: 'Site IT',
    processTimeline: [{ processType: 'Service Team', startedAt: iso(HOUR) }] };
  const html = app._renderWatchRow(c, 0);
  ok(html.includes('rb-row-watch-intent'), 'intent row');
  ok(html.includes('rb-wi-right'), 'arrow points right toward HQ');
});
test('watch: need_to_contact_user NOT at User (at HQ) → intent arrow pointing left (toward User)', () => {
  const c = { id: 'C-NU', subject: 's', trackStatus: 'need_to_contact_user', assigneeDept: 'HQ Identity',
    processTimeline: [{ processType: 'Service Team', startedAt: iso(HOUR) }] };
  const html = app._renderWatchRow(c, 0);
  ok(html.includes('rb-row-watch-intent') && html.includes('rb-wi-left'), 'intent arrow toward User');
});
test('watch: need_to_contact_user AT User → settled ring', () => {
  const c = { id: 'C-NUU', subject: 's', trackStatus: 'need_to_contact_user', assigneeDept: 'x',
    processTimeline: [{ processType: 'User', startedAt: iso(HOUR) }] };
  const html = app._renderWatchRow(c, 0);
  ok(html.includes('rb-watch-ring') && !html.includes('rb-row-watch-intent'), 'settled ring at User');
});

/* ---------- 1st-Line lane ---------- */
test('_classifyRouteRow: untracked 1st-Line case → firstline', () => {
  const c = { id: 'C-FL', subject: 's', assigneeDept: 'Site IT',
    processTimeline: [{ processType: '1st  Line', processStartTime: iso(HOUR) }] };
  eq(app._classifyRouteRow(c), 'firstline');
});
test('_classifyRouteRow: 1st-Line case WITH a scheduled desired → moving', () => {
  const c = { id: 'C-FLM', subject: 's', assigneeDept: 'Site IT', agentStatus: 'queued',
    trackStatus: 'escalate_to_core',
    processTimeline: [{ processType: '1st  Line', processStartTime: iso(HOUR) }] };
  eq(app._classifyRouteRow(c), 'moving');
});
test('_classifyRouteRow: sanity_check beats firstline even at 1st Line', () => {
  const c = { id: 'C-SFL', subject: 's', assigneeDept: 'Site IT', trackStatus: 'sanity_check',
    processTimeline: [{ processType: '1st  Line', processStartTime: iso(HOUR) }] };
  eq(app._classifyRouteRow(c), 'sanity');
});
test('_renderFirstLineRow: static dot at 1st-Line pct + two dashed arrows', () => {
  const c = { id: 'C-FL', subject: 's', assigneeDept: 'Site IT',
    processTimeline: [{ processType: '1st  Line', processStartTime: iso(HOUR) }] };
  const html = app._renderFirstLineRow(c, 0);
  ok(html.includes('rb-row-firstline'), 'firstline row class');
  ok(html.includes(`left:${app.ROUTE_STATION_POS['1st Line']}%`), 'dot at 1st-Line pct');
  ok(html.includes('rb-fl-arrow-left') && html.includes('rb-fl-arrow-right'), 'both arrows');
});

/* ---------- moving-case overdue: deadline anchors on trackStatusAt and STICKS ---------- */
// weekend_case schedules a hand-off to HQ at Sun 17:30 MST. The deadline is the first such
// occurrence after the commit time (trackStatusAt) — once it passes with the case not yet at HQ,
// the case is overdue against that date (it does NOT roll forward to the next Sunday).
test('scheduledHandoff: no anchor falls back to now → next future deadline (legacy behaviour)', () => {
  const c = { id: 'C-NA', subject: 's', assigneeDept: 'Site IT', trackStatus: 'weekend_case',
    processTimeline: [{ processType: 'Service Team', processStartTime: iso(HOUR) }] };
  const h = app.scheduledHandoff(c);
  ok(h && Date.parse(h.dueAt) > FIXED, 'unanchored → deadline in the future');
});
test('trackStatusPhase: freshly committed moving case is NOT overdue (anchor = now)', () => {
  const c = { id: 'C-FRESH', subject: 's', assigneeDept: 'Site IT',
    trackStatus: 'weekend_case', trackStatusAt: iso(0),  // committed at frozen now
    processTimeline: [{ processType: 'Service Team', processStartTime: iso(HOUR) }] };
  ok(Date.parse(app.scheduledHandoff(c).dueAt) > FIXED, 'deadline in the future');
  ok(app.trackStatusPhase(c) !== 'overdue', 'not overdue right after committing');
});
test('trackStatusPhase: moving case goes overdue once its anchored deadline passes', () => {
  const c = { id: 'C-OD', subject: 's', assigneeDept: 'Site IT',
    trackStatus: 'weekend_case', trackStatusAt: iso(6 * 24 * HOUR),  // committed ~6 days ago
    processTimeline: [{ processType: 'Service Team', processStartTime: iso(7 * 24 * HOUR) }] };
  const h = app.scheduledHandoff(c);
  ok(h && Date.parse(h.dueAt) < FIXED, 'the committed deadline is now in the past');
  eq(app.caseStation(c), 'Core Team');           // not yet at HQ (the destination)
  eq(app.trackStatusPhase(c), 'overdue');        // → overdue (was previously unreachable)
});
test('trackStatusPhase: overdue deadline sticks — does not roll to the next Sunday', () => {
  const c = { id: 'C-STICK', subject: 's', assigneeDept: 'Site IT',
    trackStatus: 'weekend_case', trackStatusAt: iso(6 * 24 * HOUR),
    processTimeline: [{ processType: 'Service Team', processStartTime: iso(7 * 24 * HOUR) }] };
  // The deadline stays anchored to the MISSED Sunday (in the past), not re-targeted forward.
  ok(Date.parse(app.scheduledHandoff(c).dueAt) < FIXED, 'stuck on the past (missed) deadline');
});
test('trackStatusPhase: delivered (at destination) wins over overdue past the deadline', () => {
  const c = { id: 'C-DV', subject: 's', assigneeDept: 'HQ Identity',   // already at HQ (destination)
    trackStatus: 'weekend_case', trackStatusAt: iso(6 * 24 * HOUR),
    processTimeline: [{ processType: 'Service Team', processStartTime: iso(7 * 24 * HOUR) }] };
  eq(app.caseStation(c), 'HQ');
  eq(app.trackStatusPhase(c), 'delivered');      // not overdue — it arrived
});

/* ---------- escalate_to_core: "next 09:00" lands on the day AFTER a same-day commit ---------- */
// Regression: a status set on Monday (after 09:00 MST) must schedule Tue 09:00 — not Wed.
test('scheduledHandoff: escalate_to_core set Mon 11:00 MST → Tue 09:00 (not Wed)', () => {
  const c = { id: 'C-ESC', subject: 's', trackStatus: 'escalate_to_core',
    trackStatusAt: '2026-06-15T18:00:00Z' };          // Mon 2026-06-15, 11:00 MST
  const h = app.scheduledHandoff(c);
  eq(h.dueDay, 'Tue');
  eq(h.dueAt, '2026-06-16T16:00:00.000Z');            // Tue 2026-06-16 09:00 MST (Wed would be the 17th)
});
test('scheduledHandoff: set before 09:00 MST → same day (Mon 06:00 → Mon 09:00)', () => {
  const c = { id: 'C-ESC2', subject: 's', trackStatus: 'escalate_to_core',
    trackStatusAt: '2026-06-15T13:00:00Z' };          // Mon 06:00 MST
  eq(app.scheduledHandoff(c).dueAt, '2026-06-15T16:00:00.000Z');  // Mon 09:00 MST
});
test('scheduledHandoff: no anchor → falls back to the logged track-status-set time, not NOW', () => {
  const c = { id: 'C-HF', subject: 's', trackStatus: 'escalate_to_core', trackStatusAt: null,
    history: [{ kind: 'track-status-set', at: '2026-06-15T18:00:00Z', who: 'op' }] };  // set Mon 11:00 MST
  eq(app.scheduledHandoff(c).dueAt, '2026-06-16T16:00:00.000Z');  // Tue 09:00 MST — anchored to history
});

/* ---------- display timezone toggle (MST / GMT+8 / Local) ---------- */
// 2026-06-14T00:30Z = Sat 17:30 MST = Sun 08:30 GMT+8 — the weekday flips across the date line.
test('display zone: MST vs GMT+8 render the same instant differently', () => {
  const inst = '2026-06-14T00:30:00.000Z';
  app.setDisplayTz('mst');
  eq(app._displayHHMM(inst), '17:30');
  eq(app._displayWeekday(inst), 'Sat');
  app.setDisplayTz('gmt8');
  eq(app._displayHHMM(inst), '08:30');
  eq(app._displayWeekday(inst), 'Sun');
  app.setDisplayTz('mst');
});
test('fmtAbsolute carries the active zone label', () => {
  app.setDisplayTz('gmt8');
  eq(app.fmtAbsolute('2026-06-14T00:30:00.000Z'), '2026-06-14 08:30 GMT+8');
  app.setDisplayTz('mst');
});
test('formatDeadlineChip weekday + time follow the display zone', () => {
  const h = { dueAt: '2026-06-14T00:30:00.000Z', dueDay: 'Sat', to: 'HQ' };
  app.setDisplayTz('mst');
  eq(app.formatDeadlineChip(h, 'upcoming'), 'Sat 17:30');
  app.setDisplayTz('gmt8');
  eq(app.formatDeadlineChip(h, 'upcoming'), 'Sun 08:30');
  app.setDisplayTz('mst');
});

/* ---------- custom hand-off time (datetime-local picker) ---------- */
test('localInputToIso ⇄ isoToLocalInput round-trip in a fixed-offset zone (GMT+8)', () => {
  app.setDisplayTz('gmt8');
  const inst = '2026-06-14T00:30:00.000Z';
  eq(app.isoToLocalInput(inst), '2026-06-14T08:30');
  eq(app.localInputToIso('2026-06-14T08:30'), inst);
  app.setDisplayTz('mst');
});
test('localInputToIso interprets the wall-clock in MST', () => {
  app.setDisplayTz('mst');
  eq(app.localInputToIso('2026-06-16T09:00'), '2026-06-16T16:00:00.000Z');  // 09:00 MST = 16:00Z
});
test('scheduledHandoff: operator hand-off override wins over the standard rule', () => {
  const c = { id: 'C-OV', trackStatus: 'escalate_to_core', trackStatusAt: '2026-06-15T18:00:00Z',
    trackStatusDueAt: '2026-06-20T16:30:00.000Z' };
  eq(app.scheduledHandoff(c).dueAt, '2026-06-20T16:30:00.000Z');   // not the rule's Tue 09:00
});
test('hand-off suggestion: next rule time in the PICKED zone, today if not yet passed', () => {
  const escalate = { id: 'escalate_to_core', scheduled: { to: 'Core Team', day: null, shift: 'Day', hh: 9, mm: 0 } };
  // FIXED = 2026-06-12T13:00Z → 06:00 MST (before 09:00) so today; 21:00 GMT+8 (after 09:00) so tomorrow.
  app.setDisplayTz('mst');
  eq(app.suggestHandoffLocalInput(escalate), '2026-06-12T09:00');
  app.setDisplayTz('gmt8');
  eq(app.suggestHandoffLocalInput(escalate), '2026-06-13T09:00');
  app.setDisplayTz('mst');
});
test('hand-off suggestion honours the target weekday in the picked zone (Weekend Case = Sun 17:30)', () => {
  const weekend = { id: 'weekend_case', scheduled: { to: 'HQ', day: 'Sun', shift: 'Day', hh: 17, mm: 30 } };
  app.setDisplayTz('mst');
  const v = app.suggestHandoffLocalInput(weekend);
  eq(v, '2026-06-14T17:30');                                     // next Sunday 17:30 MST
  eq(app._tzParts(app.localInputToIso(v)).weekday, 'Sun');       // lands on Sunday in the picked zone
  app.setDisplayTz('mst');
});
test('scheduledHandoff: no override → falls back to the standard rule', () => {
  const c = { id: 'C-NOV', trackStatus: 'escalate_to_core', trackStatusAt: '2026-06-15T18:00:00Z',
    trackStatusDueAt: null };
  eq(app.scheduledHandoff(c).dueAt, '2026-06-16T16:00:00.000Z');   // Tue 09:00 MST
});

/* ---------- current week tracks the real date (syncWeeksToNow) ---------- */
// The seed authors weeks around window.NOW; on boot they're re-derived so "this week" follows
// the clock. (Under the frozen test clock, "now" = the seed anchor, so this is deterministic.)
test('CURRENT_WEEK is the bucket containing now, flagged isCurrent', () => {
  const id = app.weekIdFor(new Date(FIXED).toISOString());
  eq(app.CURRENT_WEEK.id, id);
  const cur = app.WEEKS.find(w => w.id === app.CURRENT_WEEK.id);
  ok(cur && cur.isCurrent, 'current bucket exists and is flagged');
  ok(Date.parse(cur.startsAt) <= FIXED && FIXED < Date.parse(cur.endsAt), 'now falls inside the current week');
});
test('the week after the current one is flagged isFuture', () => {
  const next = app.weekIdFor(new Date(FIXED + 7 * 24 * HOUR).toISOString());
  const w = app.WEEKS.find(x => x.id === next);
  ok(w && w.isFuture && !w.isCurrent, 'next week is future, not current');
});
test('a case weekId resolves to a bucket whose range contains its createdAt', () => {
  const idField = app.CASES_RAW_CC ? 'caseId' : 'id';
  const id = app.CASES.map(r => r[idField]).find(Boolean);
  const c = app.caseById(id);
  const w = app.WEEKS.find(x => x.id === c.weekId);
  ok(w, 'weekId resolves to a real bucket');
  const t = Date.parse(c.createdAt);
  ok(Date.parse(w.startsAt) <= t && t < Date.parse(w.endsAt), 'createdAt sits inside its week bucket');
});

test('weekly archive hides future weeks (kept in WEEKS for the Shifts planner)', () => {
  const html = app.renderArchiveIndex();
  const future = app.WEEKS.filter(w => w.isFuture);
  ok(future.length > 0, 'WEEKS still carries upcoming weeks');
  future.forEach(w => ok(!html.includes(`#/archive/${w.id}`), `future week ${w.id} should not be listed`));
  ok(html.includes(`#/archive/${app.CURRENT_WEEK.id}`), 'current week is listed');
});

/* ---------- weekly archive summary stats ---------- */
test('isCancelledOrDropped: counts the cancelled enum and raw Drop/Cancel labels', () => {
  ok(app.isCancelledOrDropped({ status: 'cancelled' }), 'mapped cancelled enum');
  ok(app.isCancelledOrDropped({ status: 'new', ccStatusLabel: 'Drop' }), 'raw Drop label');
  ok(app.isCancelledOrDropped({ status: 'new', ccStatusLabel: 'Cancelled' }), 'raw Cancelled label');
  ok(!app.isCancelledOrDropped({ status: 'with_core', ccStatusLabel: 'In-Progress' }), 'in-progress is not cancelled');
});
test('_percentile: nearest-rank (P95/P99/empty)', () => {
  const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  eq(app._percentile(v, 95), 10);
  eq(app._percentile(v, 50), 5);
  eq(app._percentile([], 95), null);
});
test('weekStats: cancelled+dropped counted, IT P95/P99 present, no median field', () => {
  const s = app.weekStats(app.CURRENT_WEEK.id);
  ok(typeof s.cancelled === 'number', 'cancelled is a count');
  ok('itP95Ms' in s && 'itP99Ms' in s, 'IT percentiles present');
  ok(!('medianOnUsHrs' in s), 'old median field removed');
});

/* ---------- report ---------- */
process.stdout.write('\n\n');
for (const f of fails) {
  console.error(`FAIL: ${f.name}\n      ${String(f.e && f.e.message || f.e).replace(/\n/g, '\n')}\n`);
}
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
