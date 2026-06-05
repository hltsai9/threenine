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

/* ---------- report ---------- */
process.stdout.write('\n\n');
for (const f of fails) {
  console.error(`FAIL: ${f.name}\n      ${String(f.e && f.e.message || f.e).replace(/\n/g, '\n')}\n`);
}
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
