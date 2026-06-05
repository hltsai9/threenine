// Characterization tests for the prototype's pure functions.
//
// These lock in current behavior before the planned P1 refactors (e.g. the PROMPT_HANDLERS
// extraction). Zero dependencies: run with `node prototype/tests/run.cjs`.
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
  console.error('Failed to load the prototype headlessly — the DOM shim or app boot likely needs');
  console.error('updating in prototype/tests/load-prototype.cjs.\n');
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

/* ---------- statusLabel / displayStatus / isQueued ---------- */
test('statusLabel: maps known enum', () => eq(statusLabel('with_fit'), 'With Local FIT'));
test('statusLabel: passthrough unknown', () => eq(statusLabel('weird'), 'weird'));
test('displayStatus: prefers ccStatusLabel', () => eq(displayStatus({ status: 'with_fit', ccStatusLabel: 'In-Progress Wait User' }), 'In-Progress Wait User'));
test('displayStatus: falls back to enum label', () => eq(displayStatus({ status: 'closed' }), 'Closed'));
test('isQueued: queued → true', () => ok(isQueued({ agentStatus: 'queued' })));
test('isQueued: unqueued → false', () => ok(!isQueued({ agentStatus: 'unqueued' })));

/* ---------- caseSlaMs ---------- */
test('caseSlaMs: paused → accumulated only', () =>
  eq(caseSlaMs({ slaAccumulatedMs: 5 * HOUR, slaPaused: true, status: 'with_fit', slaStartedAt: iso(2 * HOUR) }), 5 * HOUR));
test('caseSlaMs: closed → accumulated only (no running segment)', () =>
  eq(caseSlaMs({ slaAccumulatedMs: 3 * HOUR, slaPaused: false, status: 'closed', slaStartedAt: iso(2 * HOUR) }), 3 * HOUR));
test('caseSlaMs: running → accumulated + segment to now', () =>
  eq(caseSlaMs({ slaAccumulatedMs: HOUR, slaPaused: false, status: 'with_fit', slaStartedAt: iso(2 * HOUR) }), 3 * HOUR));

/* ---------- caseHoldMs ---------- */
test('caseHoldMs: not current owner → stored total only', () =>
  eq(caseHoldMs({ holdMs: { fit: 2 * HOUR, hq: 0 }, currentOwner: null }, 'fit'), 2 * HOUR));
test('caseHoldMs: current owner → adds running segment', () =>
  eq(caseHoldMs({ holdMs: { fit: HOUR, hq: 0 }, currentOwner: 'fit', holdStartedAt: iso(HOUR) }, 'fit'), 2 * HOUR));
test('caseHoldMs: other kind unaffected by running fit segment', () =>
  eq(caseHoldMs({ holdMs: { fit: HOUR, hq: 30 * 60000 }, currentOwner: 'fit', holdStartedAt: iso(HOUR) }, 'hq'), 30 * 60000));

/* ---------- derivePromptsForCase ---------- */
const kinds = c => derivePromptsForCase(c).map(p => p.kind);
test('derive: closed → none', () => eq(kinds({ status: 'closed' }), []));
test('derive: resolved → none', () => eq(kinds({ status: 'resolved' }), []));
test('derive: new + unassigned → assign_fit', () => eq(kinds({ id: 'X', status: 'new', fitId: null }), ['assign_fit']));
test('derive: new + already assigned → none', () => eq(kinds({ id: 'X', status: 'new', fitId: 'fit-apac' }), []));
test('derive: with_fit + cannot resolve → escalate', () =>
  eq(kinds({ id: 'X', status: 'with_fit', fitCannotResolve: true, lastOwnerContact: { at: iso(0) } }), ['escalate_to_hq']));
test('derive: with_fit + idle past threshold → chase_fit', () =>
  eq(kinds({ id: 'X', status: 'with_fit', lastOwnerContact: { at: iso((TH.fitIdleHours + 1) * HOUR) } }), ['chase_fit']));
test('derive: with_fit + fresh contact → none', () =>
  eq(kinds({ id: 'X', status: 'with_fit', lastOwnerContact: { at: iso(Math.max(0, TH.fitIdleHours - 1) * HOUR) } }), []));
test('derive: with_fit + never contacted → chase_fit (idle = Infinity)', () =>
  eq(kinds({ id: 'X', status: 'with_fit' }), ['chase_fit']));
test('derive: with_hq + idle past threshold → chase_hq', () =>
  eq(kinds({ id: 'X', status: 'with_hq', lastOwnerContact: { at: iso((TH.hqIdleHours + 1) * HOUR) } }), ['chase_hq']));
test('derive: sanity_check → verify_fix', () => eq(kinds({ id: 'X', status: 'sanity_check' }), ['verify_fix']));

/* ---------- needsHandoverNote ---------- */
test('handover: closed → false', () => ok(!needsHandoverNote({ status: 'closed' })));
test('handover: new → false', () => ok(!needsHandoverNote({ status: 'new' })));
test('handover: open + no note → true', () => ok(needsHandoverNote({ status: 'with_fit', handover: null })));
test('handover: open + stale note → true', () => ok(needsHandoverNote({ status: 'with_fit', handover: { staleForCurrentShift: true } })));
test('handover: open + fresh note by current shift → false', () =>
  ok(!needsHandoverNote({ status: 'with_fit', handover: { staleForCurrentShift: false, author: opId } })));

/* ---------- seed sanity (structural; robust to data.js regeneration) ---------- */
test('seed: CASES is a non-empty array', () => ok(Array.isArray(app.CASES) && app.CASES.length > 0));
test('seed: every case has a non-empty string id', () =>
  ok(app.CASES.every(c => typeof c.id === 'string' && c.id.trim())));
test('seed: thresholds present and numeric', () =>
  ok(typeof TH.fitIdleHours === 'number' && typeof TH.hqIdleHours === 'number'));

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

const FIT = app.OWNERS.fit[0].id;
const HQ = app.OWNERS.hq[0].id;
const SCRATCH_ID = app.CASES[0].id;
function scratch(props) {
  const c = app.caseById(SCRATCH_ID);
  Object.assign(c, {
    status: 'new', agentStatus: 'unqueued', fitId: null, hqId: null, currentOwner: null,
    fitCannotResolve: false, slaPaused: false, slaAccumulatedMs: 0, slaStartedAt: iso(0),
    holdMs: { fit: 0, hq: 0 }, holdStartedAt: null, lastOwnerContact: null,
    handover: null, reminder: null, closedAt: undefined, resolutionCode: undefined,
    history: [], requester: 'Test Requester',
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

test('assign_fit: routes new case to FIT and starts the hold clock', () => {
  const c = scratch({ status: 'new', fitId: null });
  submitPrompt(SCRATCH_ID, 'assign_fit', { fitId: FIT });
  eq([c.status, c.currentOwner, c.fitId, lastKind(c)], ['with_fit', 'fit', FIT, 'assigned']);
  ok(c.holdStartedAt && c.lastOwnerContact && c.lastOwnerContact.channel === 'Slack');
});

test('escalate_to_hq: stops FIT clock, starts HQ, clears cannot-resolve', () => {
  const c = scratch({ status: 'with_fit', currentOwner: 'fit', fitId: FIT, holdStartedAt: iso(2 * HOUR), fitCannotResolve: true });
  submitPrompt(SCRATCH_ID, 'escalate_to_hq', { hqId: HQ, reason: 'needs product' });
  eq([c.status, c.currentOwner, c.hqId, c.fitCannotResolve, c.holdMs.fit, lastKind(c)],
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

test('resume: restarts the SLA clock and routes back to FIT', () => {
  const c = scratch({ status: 'returned_to_requester', slaPaused: true, fitId: FIT, slaStartedAt: iso(10 * HOUR) });
  submitPrompt(SCRATCH_ID, 'resume', { dest: 'fit', note: '' });
  eq([c.status, c.currentOwner, c.slaPaused, c.slaStartedAt, lastKind(c)],
     ['with_fit', 'fit', false, iso(0), 'resumed']);
});

test('cancel: marks cancelled, banks clocks, warns', () => {
  const c = scratch({ status: 'with_fit', currentOwner: 'fit', fitId: FIT, holdStartedAt: iso(HOUR), slaStartedAt: iso(HOUR) });
  submitPrompt(SCRATCH_ID, 'cancel', { reason: 'duplicate' });
  eq([c.status, c.currentOwner, c.holdMs.fit, c.slaAccumulatedMs, lastKind(c)],
     ['cancelled', null, HOUR, HOUR, 'cancelled']);
  eq(toasts[0].t, 'warn');
});

test('toggle_queue: flips agent status both ways with history', () => {
  const c = scratch({ status: 'with_fit', agentStatus: 'unqueued' });
  directPrompt(SCRATCH_ID, 'toggle_queue');
  eq([c.agentStatus, lastKind(c)], ['queued', 'queue_added']);
  directPrompt(SCRATCH_ID, 'toggle_queue');
  eq([c.agentStatus, lastKind(c)], ['unqueued', 'queue_removed']);
});

test('move_to_sanity_check: direct status change', () => {
  const c = scratch({ status: 'with_hq', currentOwner: 'hq', hqId: HQ });
  directPrompt(SCRATCH_ID, 'move_to_sanity_check');
  eq([c.status, lastKind(c)], ['sanity_check', 'status']);
});

test('unknown / missing case id is a no-op', () => {
  _modal = null; toasts.length = 0;
  app.handlePrompt('NO-SUCH-CASE', 'assign_fit');
  eq([_modal, toasts.length], [null, 0]);
});

/* ---------- report ---------- */
process.stdout.write('\n\n');
for (const f of fails) {
  console.error(`FAIL: ${f.name}\n      ${String(f.e && f.e.message || f.e).replace(/\n/g, '\n')}\n`);
}
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
