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
test('statusLabel: maps known enum', () => eq(statusLabel('with_core'), 'With Core Team'));
test('statusLabel: passthrough unknown', () => eq(statusLabel('weird'), 'weird'));
test('displayStatus: prefers ccStatusLabel', () => eq(displayStatus({ status: 'with_core', ccStatusLabel: 'In-Progress Wait User' }), 'In-Progress Wait User'));
test('displayStatus: falls back to enum label', () => eq(displayStatus({ status: 'closed' }), 'Closed'));
test('isQueued: queued → true', () => ok(isQueued({ agentStatus: 'queued' })));
test('isQueued: unqueued → false', () => ok(!isQueued({ agentStatus: 'unqueued' })));

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
test('processSegments: orders by start time and uses minutes for duration', () => {
  const segs = processSegments({ processTimeline: [
    { processType: 'B', startedAt: iso(2 * HOUR), endedAt: iso(1 * HOUR), minutes: 60 },
    { processType: 'A', startedAt: iso(4 * HOUR), endedAt: iso(2 * HOUR), minutes: 120 },
  ] });
  eq(segs.map(s => s.processType), ['A', 'B']);   // re-sorted oldest-first
  eq(segs.map(s => s.ms), [120 * 60000, 60 * 60000]);
});
test('processSegments: falls back to end − start when minutes absent', () => {
  const segs = processSegments({ processTimeline: [
    { startedAt: iso(3 * HOUR), endedAt: iso(1 * HOUR) },
  ] });
  eq(segs[0].ms, 2 * HOUR);
});
test('processSegments: non-objects are dropped', () => {
  eq(processSegments({ processTimeline: [null, 0, { startedAt: iso(HOUR), minutes: 0 }] }).length, 1);
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
test('toolbar (http): Load New + Refresh Existing + per-case refresh all render', () => {
  app.location.protocol = 'https:'; app.__LIVE__ = true;
  const html = app.renderCaseList();
  ok(html.includes('>Load New<'), 'Load New label');
  ok(html.includes('id="refresh-existing"'), 'Refresh Existing button');
  ok(html.includes('data-action="refresh-case"'), 'per-case refresh on cards');
});
test('toolbar (file://): refresh buttons always show; Load New stays http-only', () => {
  app.location.protocol = 'file:'; app.__LIVE__ = false;
  const html = app.renderCaseList();
  ok(!html.includes('id="lookback-load"'), 'no look-back "Load New" control on file://');
  ok(html.includes('id="refresh-existing"'), 'Refresh Existing shown even on file://');
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
    return c && !['closed', 'cancelled'].includes(c.status) && c.agentStatus === 'queued';
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
  ok(html.includes('left:88%'), 'stay dot at HQ (88%)');
});
test('watch row dot is placed at the case station (HQ)', () => {
  const c = { id: 'C-WATCH', subject: 's', assigneeDept: 'HQ Identity', trackStatus: 'escalated_to_hq',
    processTimeline: [{ processType: 'Service Team', startedAt: iso(HOUR) }] };
  const html = app._renderWatchRow(c, 0);
  ok(html.includes('left:88%'), 'watch dot at HQ (88%)');
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
  ok(html.includes('left:31%'), 'dot at 1st-Line pct');
  ok(html.includes('rb-fl-arrow-left') && html.includes('rb-fl-arrow-right'), 'both arrows');
});

/* ---------- report ---------- */
process.stdout.write('\n\n');
for (const f of fails) {
  console.error(`FAIL: ${f.name}\n      ${String(f.e && f.e.message || f.e).replace(/\n/g, '\n')}\n`);
}
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
