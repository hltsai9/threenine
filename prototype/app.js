// Case Tracker prototype — single-file SPA.
// Renders the kanban board (Cases), Case Detail, Shifts and Archive views
// against the seed data in data.js. State is in-memory; reload resets.
//
// Two statuses per case:
//   c.status      = Case Center status (real external status; drives kanban columns).
//   c.agentStatus = first-line agent status ('queued' | 'unqueued'; drives the
//                   top/bottom band split inside each column).

// === CONFIG ===
// How long to wait for the live /api/cases call (talking to Case Center) before giving up
// and falling back to seed data. Increase this if your on-prem Case Center is slow.
// Adjust without editing this file by adding ?liveTimeout=SECONDS to the URL,
// e.g.  http://127.0.0.1:8787/?liveTimeout=60   (60 seconds)
const LIVE_FETCH_TIMEOUT_MS = (() => {
  try {
    const q = new URLSearchParams(location.search).get('liveTimeout');
    if (q != null && q !== '' && !isNaN(+q)) return Math.max(1000, +q * 1000);
  } catch (e) { /* ignore */ }
  if (typeof window.LIVE_FETCH_TIMEOUT_MS === 'number') return window.LIVE_FETCH_TIMEOUT_MS;
  return 300000;  // default: 300 seconds (5 minutes)  ← edit this number to change the default
})();

// Polling cadences (ms). Kept here so all timing lives in one place.
const REMINDER_POLL_MS = 10000;        // how often to sweep for due reminders
const REMINDER_FIRST_RUN_MS = 200;     // first reminder sweep shortly after boot
const CLOCK_TICK_MS = 1000;            // sidebar clock refresh

const STATE = {
  cases: window.CASES.map(c => structuredClone(c)),
  operatorId: window.CURRENT_OPERATOR_ID,
  lastListRoute: '#/cases',
  lastListLabel: 'Cases',
  lookbackHours: 1,          // Case Center query window: older bound (hours ago)
  lookbackToHours: 0,        // newer bound (hours ago); 0 = up to now → "within N hours"
};
try {
  const lb = parseFloat(localStorage.getItem('case-tracker-lookback'));
  if (lb > 0) STATE.lookbackHours = lb;
  const lt = parseFloat(localStorage.getItem('case-tracker-lookback-to'));
  if (lt >= 0) STATE.lookbackToHours = lt;
} catch (e) { /* ignore */ }

// Resolve an API path against window.API_BASE (set in config.js). Empty base = same origin
// (relative path, exactly as before). A non-empty base points the SPA at a separate backend.
function apiUrl(path) {
  const base = (window.API_BASE || '').replace(/\/$/, '');
  return base ? base + '/' + path.replace(/^\//, '') : path;
}

// Build the /api/cases query for a created-between window. With a newer bound > 0 it asks for a
// band (created between fromHours and toHours ago); otherwise the legacy "within N hours" form.
function liveCasesUrl(from, to) {
  from = from || 0; to = to || 0;
  if (!from) return apiUrl('api/cases');
  if (to > 0) return apiUrl(`api/cases?fromHours=${encodeURIComponent(from)}&toHours=${encodeURIComponent(to)}`);
  return apiUrl(`api/cases?hours=${encodeURIComponent(from)}`);
}

// Validate a created-between window. Returns an error string, or null if OK. The older bound must
// be positive; the newer bound must be 0+ and strictly smaller (newer = fewer hours ago).
function windowError(from, to) {
  if (!(from > 0)) return 'Enter a positive number of hours for the older bound.';
  if (!(to >= 0)) return 'The newer bound must be 0 or more hours ago.';
  if (to >= from) return 'The newer bound must be smaller than the older bound.';
  return null;
}

const STORAGE_KEY = 'case-tracker-state-v7';
// In live mode (served by local/serve.py; cases come from Case Center on demand via
// "Load New" / "Refresh Existing", not on page refresh) we persist ONLY the local agent layer —
// agentStatus, handover, reminder — keyed by case id, so a data pull never clobbers the
// operator's own work. Seed/demo mode keeps full state.
const AGENT_KEY = 'case-tracker-agent-v1';

// The agent-owned fields that survive a live data refresh.
function agentLayerFromState() {
  const map = {};
  for (const c of STATE.cases) {
    map[c.id] = {
      agentStatus: c.agentStatus,
      handover: c.handover,
      reminder: c.reminder,
      trackStatus: c.trackStatus || null,
    };
  }
  return map;
}

function applyAgentLayer(map) {
  for (const c of STATE.cases) {
    const a = map[c.id];
    if (!a) { if (c.agentStatus == null) c.agentStatus = 'unqueued'; continue; }
    if (a.agentStatus != null) c.agentStatus = a.agentStatus;
    if (a.handover !== undefined) c.handover = a.handover;
    if (a.reminder !== undefined) c.reminder = a.reminder;
    if (a.trackStatus !== undefined) c.trackStatus = a.trackStatus;
  }
}

// Re-apply the operator's saved local layer (operator selection + agent layer keyed by case id).
function applyStoredAgentLayer() {
  try {
    const raw = localStorage.getItem(AGENT_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed.operatorId && window.OPERATORS.some(o => o.id === parsed.operatorId)) {
      STATE.operatorId = parsed.operatorId;
    }
    applyAgentLayer(parsed.agent || {});
  } catch (e) { /* ignore corrupt local layer */ }
}

// Baseline for change-detection in live mode: snapshot the current cases so only LATER operator
// edits POST back to the server (the store already has what's on the board right now).
function snapshotSavedCases() {
  STATE._savedSnapshot = {};
  for (const c of STATE.cases) if (c.id) STATE._savedSnapshot[c.id] = JSON.stringify(c);
}


function saveState() {
  try {
    if (window.__LIVE__) {
      localStorage.setItem(AGENT_KEY, JSON.stringify({
        v: 1,
        operatorId: STATE.operatorId,
        agent: agentLayerFromState(),
      }));
      persistChangedCases();   // push any operator edits to data.js via the local server
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      v: 7,
      cases: STATE.cases,
      operatorId: STATE.operatorId,
      anchorOffset: STATE.anchorOffset,   // ms the seed was shifted to anchor on real time
      rota: window.ROTA,                  // current week's rota (kept in sync with rotaByWeek[current])
      rotaByWeek: window.ROTA_BY_WEEK,    // current + next 3 weeks' rotas (Shifts-page editor)
    }));
  } catch (e) { /* SecurityError on some file:// origins, ignore */ }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (parsed.v !== 7 || !Array.isArray(parsed.cases)) return false;
    STATE.cases = parsed.cases;
    if (typeof parsed.anchorOffset === 'number') STATE.anchorOffset = parsed.anchorOffset;
    if (parsed.operatorId && window.OPERATORS.some(o => o.id === parsed.operatorId)) {
      STATE.operatorId = parsed.operatorId;
    }
    if (Array.isArray(parsed.rota)) window.ROTA = parsed.rota;
    if (parsed.rotaByWeek && typeof parsed.rotaByWeek === 'object') {
      window.ROTA_BY_WEEK = parsed.rotaByWeek;
      // Keep the current week's rota and window.ROTA pointing at the same array.
      const cur = window.CURRENT_WEEK?.id;
      if (cur && window.ROTA_BY_WEEK[cur]) window.ROTA = window.ROTA_BY_WEEK[cur];
    }
    return true;
  } catch (e) {
    return false;
  }
}

function resetState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(AGENT_KEY);
  } catch (e) { /* ignore */ }
  // In live mode the source of truth is Case Center — reload to re-pull fresh data.
  if (window.__LIVE__) { location.reload(); return; }
  STATE.cases = window.CASES.map(c => structuredClone(c));
  anchorFreshSeed();   // re-anchor the pristine seed on the real current time
  // Restore the roster to the data.js values (the editor mutates these in place).
  window.OPERATORS = structuredClone(SEED_ROSTER.operators);
  window.SHIFTS = structuredClone(SEED_ROSTER.shifts);
  window.CURRENT_OPERATOR_ID = SEED_ROSTER.currentOperatorId;
  window.ROTA = structuredClone(SEED_ROSTER.rota);
  window.ROTA_BY_WEEK = structuredClone(SEED_ROSTER.rotaByWeek);
  // Keep ROTA and ROTA_BY_WEEK[current] pointing at the same array.
  const curW = window.CURRENT_WEEK?.id;
  if (curW) window.ROTA_BY_WEEK[curW] = window.ROTA;
  window.OWNERS = structuredClone(SEED_OWNERS);
  STATE.operatorId = window.CURRENT_OPERATOR_ID;
  STATE.lastListRoute = '#/cases';
  STATE.lastListLabel = 'Cases';
  render();
}

// Pristine copy of the roster as defined in data.js, so "Reset to seed" can undo
// any in-session edits made with the shift editor.
const SEED_ROSTER = {
  operators: structuredClone(window.OPERATORS),
  shifts: structuredClone(window.SHIFTS),
  currentOperatorId: window.CURRENT_OPERATOR_ID,
  rota: structuredClone(window.ROTA || []),
  rotaByWeek: structuredClone(window.ROTA_BY_WEEK || {}),
};
// Pristine owner directory, so "Reset to seed" can undo in-session Owners-editor changes.
const SEED_OWNERS = structuredClone(window.OWNERS);

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const RECYCLE_BIN_MS = 7 * DAY;   // deleted cases are kept in the recycle bin for 7 days

// The demo clock. The seed in data.js is authored around SEED_ANCHOR; on boot we shift
// every seed timestamp by a single offset so "now" lands on the real current time — this
// keeps all the curated durations (SLA, idle, shift-ending) intact while making timestamps
// real and never in the future. Live mode (Case Center) sets NOW to real time directly.
let NOW = window.NOW;
const SEED_ANCHOR = window.NOW.getTime();
const SEED_CURRENT_SHIFT = structuredClone(window.CURRENT_SHIFT);

function shiftIso(v, off) { return v ? new Date(new Date(v).getTime() + off).toISOString() : v; }
function shiftCaseTimes(c, off) {
  c.createdAt = shiftIso(c.createdAt, off);
  c.slaStartedAt = shiftIso(c.slaStartedAt, off);
  c.holdStartedAt = shiftIso(c.holdStartedAt, off);
  if (c.closedAt) c.closedAt = shiftIso(c.closedAt, off);
  if (c.lastOwnerContact) c.lastOwnerContact.at = shiftIso(c.lastOwnerContact.at, off);
  if (c.handover) c.handover.at = shiftIso(c.handover.at, off);
  if (c.reminder) c.reminder.fireAt = shiftIso(c.reminder.fireAt, off);
  (c.history || []).forEach(h => { h.at = shiftIso(h.at, off); });
  (c.processTimeline || []).forEach(p => {
    p.startedAt = shiftIso(p.startedAt, off);
    p.endedAt = shiftIso(p.endedAt, off);
  });
  if (c.waitUser) {
    c.waitUser.dueDateTime = shiftIso(c.waitUser.dueDateTime, off);
    c.waitUser.transitionDateTime = shiftIso(c.waitUser.transitionDateTime, off);
  }
}
function applyShiftToCurrentShift(off) {
  window.CURRENT_SHIFT = structuredClone(SEED_CURRENT_SHIFT);
  window.CURRENT_SHIFT.endsAtUtc = shiftIso(SEED_CURRENT_SHIFT.endsAtUtc, off);
}
// Shift the pristine seed (already cloned into STATE.cases) so it anchors on real now.
function anchorFreshSeed() {
  // data.js written from live Case Center data: board-shaped cases with real timestamps.
  // Normalize them (fills weekId/agentStatus/etc. like a live fetch) and don't time-shift.
  if (window.CASES_LIVE_CAPTURE) {
    STATE.cases = window.CASES.map(c => normalizeLiveCase(structuredClone(c)));
    STATE.anchorOffset = 0;
    applyShiftToCurrentShift(0);
    NOW = new Date();
    return;
  }
  const off = Date.now() - SEED_ANCHOR;
  STATE.cases.forEach(c => shiftCaseTimes(c, off));
  STATE.anchorOffset = off;
  applyShiftToCurrentShift(off);
  NOW = new Date();
}
function seedBoot(loadedFromStorage) {
  if (loadedFromStorage && typeof STATE.anchorOffset === 'number' && !window.CASES_LIVE_CAPTURE) {
    applyShiftToCurrentShift(STATE.anchorOffset); // restored cases already carry this offset
    NOW = new Date();
  } else {
    anchorFreshSeed();
  }
}

seedBoot(loadState());

/* ---------- Helpers ---------- */

function getOperator(id) { return window.OPERATORS.find(o => o.id === id); }
function getOwner(type, id) {
  if (!id) return null;
  return (type === 'core' ? window.OWNERS.core : window.OWNERS.hq).find(o => o.id === id) || null;
}
function caseById(id) { return STATE.cases.find(c => c.id === id); }

// Case Center link for a case. Prefer the server-built caseLink; if it's empty (e.g. a case
// stored before CASE_CENTER_BASE_URL was set — and a page refresh no longer re-fetches to rebuild
// it), fall back to building it from the case id + the base URL serve.py exposes as
// window.CASE_CENTER_BASE_URL. Mirrors build_case_link() in casecenter.py.
function caseHref(c) {
  if (c && c.caseLink) return c.caseLink;
  const base = window.CASE_CENTER_BASE_URL;
  if (base && c && c.id) return String(base).replace(/\/+$/, '') + '/' + c.id;
  return '';
}

// Recycle bin: a binned case carries a `deletedAt` ISO timestamp. Binned cases are hidden from
// the board, archive and all stats, and live only in the recycle bin until 7 days pass (then
// they're purged). Bin timing uses real wall-clock time (like reminders), not the demo clock.
function isBinned(c) { return !!c.deletedAt; }
function binMsRemaining(c) {
  if (!c.deletedAt) return 0;
  return Math.max(0, RECYCLE_BIN_MS - (realNow().getTime() - new Date(c.deletedAt).getTime()));
}
function binExpired(c) {
  return !!c.deletedAt && (realNow().getTime() - new Date(c.deletedAt).getTime()) >= RECYCLE_BIN_MS;
}

function caseSlaMs(c) {
  // Total accumulated SLA time, including the running segment if currently running.
  let total = c.slaAccumulatedMs || 0;
  if (!c.slaPaused && !['resolved', 'closed', 'cancelled'].includes(c.status)) {
    const start = new Date(c.slaStartedAt).getTime();
    total += Math.max(0, NOW.getTime() - start);
  }
  return total;
}
function caseHoldMs(c, kind /* 'core' | 'hq' */) {
  let total = c.holdMs?.[kind] || 0;
  if (c.currentOwner === kind && c.holdStartedAt) {
    total += Math.max(0, NOW.getTime() - new Date(c.holdStartedAt).getTime());
  }
  return total;
}

function fmtDuration(ms) {
  if (ms == null) return '—';
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}
// Reminders use real wall-clock time (vs. frozen NOW used for case state).
function realNow() { return new Date(); }

// Live wall-clock shown in the sidebar — local-first (UTC kept on hover for reference).
function updateClock() {
  const t = document.getElementById('clock-time');
  const d = document.getElementById('clock-date');
  if (!t || !d) return;
  const now = realNow();
  t.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const date = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  d.textContent = `${date}${LOCAL_TZ ? ' · ' + LOCAL_TZ : ''}`;
  const wrap = t.closest('.sidebar-clock');
  if (wrap) wrap.title = `UTC ${now.toISOString().slice(11, 16)}`;
}
function fmtUntil(iso) {
  const diff = new Date(iso).getTime() - realNow().getTime();
  if (diff <= 0) return 'due now';
  const min = Math.round(diff / 60000);
  if (min < 1) return 'in <1m';
  if (min < 60) return `in ${min}m`;
  const hr = Math.floor(min / 60);
  const m = min % 60;
  return m ? `in ${hr}h ${m}m` : `in ${hr}h`;
}
// Next occurrence of a local clock time "HH:MM" — today if still ahead, otherwise tomorrow.
// Used by the reminder "at a specific time" option. Returns an ISO string, or null if invalid.
function nextTimeIso(hhmm, base) {
  base = base || realNow();
  const parts = String(hhmm).split(':');
  const h = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
  if (!(h >= 0 && h < 24 && m >= 0 && m < 60)) return null;
  const d = new Date(base.getTime());
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= base.getTime()) d.setDate(d.getDate() + 1);
  return d.toISOString();
}
function fmtOverdue(iso) {
  const diff = realNow().getTime() - new Date(iso).getTime();
  if (diff < 60000) return 'just now';
  const min = Math.round(diff / 60000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

function fmtRelative(iso) {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  const diff = NOW.getTime() - then;
  if (diff < 0) return 'in the future';
  if (diff < 60_000) return 'just now';
  return `${fmtDuration(diff)} ago`;
}
// Viewer's local timezone abbreviation (e.g. "PDT", "GMT+8"), computed once.
const LOCAL_TZ = (() => {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
      .formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || '';
  } catch (e) { return ''; }
})();

// Absolute case timestamps are shown in the viewer's LOCAL time (case timestamps are
// stored as ISO UTC; this renders them where the operator actually is).
function fmtAbsolute(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  const pad = n => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${date} ${time}${LOCAL_TZ ? ' ' + LOCAL_TZ : ''}`;
}
// Compact local "M/D HH:MM" for timeline transition markers (full time on hover).
function fmtClockShort(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
// Shifts are displayed in Mountain Standard Time (UTC-7, no DST — IANA "America/Phoenix").
// Changing this constant retargets every shift-time render: the sidebar shift-ends clock,
// the Shifts page roster headers, and the shift-card subtitles. Case timestamps still use
// the viewer's own local time (see fmtAbsolute).
const SHIFT_TZ = 'America/Phoenix';
const SHIFT_TZ_LABEL = 'MST';

// Convert an ISO UTC instant to "HH:MM" in the shift timezone via Intl.DateTimeFormat.
function _shiftTzHHMM(iso) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: SHIFT_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso));
  } catch (e) {
    // Fallback: hard-coded UTC-7 (MST is UTC-7 year-round, no DST).
    const d = new Date(iso);
    const ms = d.getTime() - 7 * 60 * 60 * 1000;
    const utc = new Date(ms);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(utc.getUTCHours())}:${pad(utc.getUTCMinutes())}`;
  }
}

// Shift-time HH:MM (+tz) for a single ISO timestamp (e.g. shift end).
function fmtLocalTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return `${_shiftTzHHMM(iso)} ${SHIFT_TZ_LABEL}`;
}
// Render a "HH:MM – HH:MM UTC" coverage window in the shift timezone (display only; the
// roster still stores the canonical UTC text). Falls back to the raw string if unparseable.
function fmtShiftHoursLocal(hoursUtc) {
  const m = String(hoursUtc || '').match(/(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/);
  if (!m) return hoursUtc || '—';
  const base = new Date();
  const toShiftTz = (h, min) => {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), +h, +min));
    return _shiftTzHHMM(d.toISOString());
  };
  return `${toShiftTz(m[1], m[2])} – ${toShiftTz(m[3], m[4])} ${SHIFT_TZ_LABEL}`;
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function ownerLocalNow(owner) {
  if (!owner) return null;
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: owner.tz, hour: '2-digit', minute: '2-digit', hour12: false,
    });
    return fmt.format(NOW);
  } catch (e) { return null; }
}
function ownerInOfficeHours(owner) {
  if (!owner || !owner.office) return null;
  const local = ownerLocalNow(owner);
  if (!local) return null;
  const [start, end] = owner.office.split('–').map(s => s.trim());
  if (!start || !end) return null;
  return local >= start && local <= end;
}

function statusLabel(s) {
  return ({
    new: 'New',
    with_core: 'With Core Team',
    with_hq: 'With HQ Product Team',
    sanity_check: 'Sanity Check',
    returned_to_requester: 'Returned to Requester',
    resolved: 'Resolved',
    closed: 'Closed',
    cancelled: 'Cancelled',
  })[s] || s;
}

// Visible status label. Live Case Center cases carry ccStatusLabel (the raw
// caseStatus + sub-transition, e.g. "In-Progress Wait User"); seed cases fall back to the
// board enum label. The pill COLOR still uses the mapped enum (c.status).
function displayStatus(c) {
  return (c && c.ccStatusLabel) || statusLabel(c.status);
}

// Agent status: has the first-line agent pulled this case into their active queue?
// Drives the top (queued) vs bottom (rest) band split inside each kanban column.
function isQueued(c) { return c.agentStatus === 'queued'; }

/* ---------- Action derivation ---------- */

// Derive the one-click actions that apply to a single case, given its status and how
// long the current owner has been idle. Used to put a primary CTA on kanban cards.
function derivePromptsForCase(c) {
  if (['closed', 'cancelled', 'resolved'].includes(c.status)) return [];

  const ownerIdleHrs = c.lastOwnerContact
    ? (NOW.getTime() - new Date(c.lastOwnerContact.at).getTime()) / HOUR
    : Infinity;

  const prompts = [];
  if (c.status === 'new' && !c.coreId) {
    prompts.push({ caseId: c.id, kind: 'assign_core' });
  }
  if (c.status === 'with_core' && c.coreCannotResolve) {
    prompts.push({ caseId: c.id, kind: 'escalate_to_hq' });
  } else if (c.status === 'with_core' && ownerIdleHrs > window.THRESHOLDS.coreIdleHours) {
    prompts.push({ caseId: c.id, kind: 'chase_core' });
  }
  if (c.status === 'with_hq' && ownerIdleHrs > window.THRESHOLDS.hqIdleHours) {
    prompts.push({ caseId: c.id, kind: 'chase_hq' });
  }
  if (c.status === 'sanity_check') {
    prompts.push({ caseId: c.id, kind: 'verify_fix' });
  }
  return prompts;
}

const PROMPT_DEFS = {
  assign_core:           { label: 'Assign to Core Team',                  icon: 'A', cls: 'icon-assign',   action: 'Pick Core Team' },
  chase_core:            { label: 'Chase Core Team — no response',        icon: 'C', cls: 'icon-chase',    action: 'Send reminder' },
  escalate_to_hq:       { label: 'Escalate to HQ Product Team',          icon: 'E', cls: 'icon-escalate', action: 'Pick HQ team' },
  chase_hq:             { label: 'Chase HQ Product Team — no response',  icon: 'C', cls: 'icon-chase',    action: 'Send reminder' },
  verify_fix:           { label: 'Verify reported fix (Sanity Check)',   icon: 'V', cls: 'icon-verify',   action: 'Verify & close' },
  approaching_sla:      { label: 'Approaching SLA — consider returning', icon: 'S', cls: 'icon-sla',      action: 'Return to requester' },
  watch_escalated:      { label: 'Watch escalated case',                 icon: 'W', cls: 'icon-watch',    action: 'Open case' },
  end_of_shift_handover:{ label: 'End-of-shift handover note required',  icon: 'H', cls: 'icon-handover', action: 'Write handover' },
};

/* ---------- Router ---------- */

function navigate(hash) {
  if (location.hash !== hash) location.hash = hash;
  else render();
}

function currentRoute() {
  const h = location.hash || '#/cases';
  if (h.startsWith('#/cases/')) return { name: 'detail', id: h.slice('#/cases/'.length) };
  if (h.startsWith('#/cases')) return { name: 'cases' };
  if (h === '#/archive/bin') return { name: 'recycleBin' };
  if (h.startsWith('#/archive/')) return { name: 'archiveWeek', id: h.slice('#/archive/'.length) };
  if (h.startsWith('#/archive')) return { name: 'archive' };
  if (h.startsWith('#/shifts/')) return { name: 'shiftDetail', shift: decodeURIComponent(h.slice('#/shifts/'.length)) };
  if (h.startsWith('#/shifts')) return { name: 'shifts' };
  if (h.startsWith('#/owners')) return { name: 'owners' };
  if (h.startsWith('#/flow')) return { name: 'flow' };
  if (h.startsWith('#/clocks')) return { name: 'clocks' };
  return { name: 'cases' };
}

window.addEventListener('hashchange', render);

/* ---------- Render dispatch ---------- */

function labelForRoute(route) {
  switch (route.name) {
    case 'cases': return 'Picked';
    case 'shifts': return 'Shifts';
    case 'owners': return 'Owners';
    case 'shiftDetail': return `${route.shift} shift`;
    case 'archive': return 'Overview';
    case 'recycleBin': return 'Recycle bin';
    case 'archiveWeek': {
      const w = window.WEEKS.find(w => w.id === route.id);
      return w ? w.label : 'Archive';
    }
    case 'flow': return 'Status Flow';
    case 'clocks': return 'Clock model';
    default: return 'Back';
  }
}

function render() {
  renderSidebar();
  const route = currentRoute();
  // Remember the last list-style view so the case detail can offer a contextual back link.
  if (route.name !== 'detail') {
    STATE.lastListRoute = location.hash || '#/cases';
    STATE.lastListLabel = labelForRoute(route);
  }
  const main = document.getElementById('main');
  document.querySelectorAll('.nav a').forEach(a => a.classList.remove('active'));
  const active = ({
    cases: 'cases', detail: 'cases',
    archive: 'archive', archiveWeek: 'archive', recycleBin: 'archive',
    shifts: 'shifts', shiftDetail: 'shifts',
    owners: 'owners',
    flow: 'flow',
    clocks: 'clocks',
  })[route.name];
  document.querySelector(`.nav a[data-route="${active}"]`)?.classList.add('active');

  if (route.name === 'cases') main.innerHTML = renderCaseList();
  else if (route.name === 'detail') main.innerHTML = renderCaseDetail(route.id);
  else if (route.name === 'archive') main.innerHTML = renderArchiveIndex();
  else if (route.name === 'archiveWeek') main.innerHTML = renderArchiveWeek(route.id);
  else if (route.name === 'recycleBin') main.innerHTML = renderRecycleBin();
  else if (route.name === 'shifts') main.innerHTML = renderShiftsIndex();
  else if (route.name === 'owners') main.innerHTML = renderOwnersPage();
  else if (route.name === 'shiftDetail') main.innerHTML = renderShiftDetail(route.shift);
  else if (route.name === 'flow') main.innerHTML = renderStatusFlow();
  else if (route.name === 'clocks') main.innerHTML = renderClockModel();
  bindHandlers();
  saveState();
}

function renderSidebar() {
  if (!getOperator(STATE.operatorId)) {
    STATE.operatorId = window.CURRENT_OPERATOR_ID;
  }
  const op = getOperator(STATE.operatorId);
  // Operator switcher — repopulate options every render so roster edits show up;
  // attach the change listener only once.
  const sw = document.getElementById('op-switcher');
  if (sw) {
    sw.innerHTML = window.OPERATORS
      .map(o => `<option value="${o.id}">${escapeHtml(o.name)} (${escapeHtml(o.shift)})</option>`)
      .join('');
    if (sw.dataset.bound !== '1') {
      sw.addEventListener('change', () => {
        STATE.operatorId = sw.value;
        render();
      });
      sw.dataset.bound = '1';
    }
    sw.value = STATE.operatorId;
  }

  document.getElementById('op-shift').textContent = op.shift;
  document.getElementById('op-ends').textContent = fmtLocalTime(window.CURRENT_SHIFT.endsAtUtc);
  document.getElementById('op-week').textContent = window.CURRENT_WEEK.label;
  updateClock();

  document.getElementById('nav-cases-count').textContent =
    STATE.cases.filter(c => !c.deletedAt && !['closed', 'cancelled'].includes(c.status) && c.weekId === window.CURRENT_WEEK.id).length;
  const navShifts = document.getElementById('nav-shifts-count');
  if (navShifts) navShifts.textContent = window.SHIFTS.length;
  const navOwners = document.getElementById('nav-owners-count');
  if (navOwners) navOwners.textContent = (window.OWNERS.core.length + window.OWNERS.hq.length);
  const navArchive = document.getElementById('nav-archive-count');
  if (navArchive) navArchive.textContent = window.WEEKS.length;
}

/* ---------- Shared action helpers ---------- */

const BELL_SVG = `<svg class="bell-svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6V11c0-3.07-1.64-5.64-4.5-6.32V4a1.5 1.5 0 0 0-3 0v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>`;

function renderQueueToggleButton(c, size /* 'tiny' | 'normal' */) {
  if (['closed', 'cancelled'].includes(c.status)) return '';
  const cls = size === 'tiny' ? 'btn-tiny' : 'btn';
  const inQ = isQueued(c);
  const label = size === 'tiny'
    ? (inQ ? '✓ Picked' : '+ Pick')
    : (inQ ? '✓ Unpick' : '+ Pick for follow-up');
  const title = inQ ? 'Remove from your Picked workspace' : 'Pick for follow-up — adds to your Picked workspace';
  return `<button class="${cls} queue-toggle${inQ ? ' in-queue' : ''}" data-action="prompt" data-case-id="${c.id}" data-kind="toggle_queue" title="${escapeHtml(title)}" onclick="event.stopPropagation()">${escapeHtml(label)}</button>`;
}

/* ---------- Track Status (operator's intent on each picked case) ----------
 * See docs/case-center-overview-plan.md §3 & §6.
 *   - 7-value enum, set/cleared by the operator. Never sent to Case Center.
 *   - The first three statuses carry a scheduled handoff rule that drives the
 *     animated Route Board arrows; the next two are "watching" (eyeball icon).
 *   - Case Closed and Sanity Check pin the dot to *User* regardless of CC dept.
 */
const TRACK_STATUSES = [
  { id: 'weekend_case',         label: 'Weekend Case',                       short: 'Weekend',     scheduled: { to: 'HQ',        day: 'Sun', shift: 'Day', hh: 17, mm: 30 } },
  { id: 'hq_did_not_handle',    label: 'HQ did not handle',                  short: 'HQ retry',    scheduled: { to: 'HQ',        day: null,  shift: 'Day', hh: 17, mm: 30 } },
  { id: 'escalate_to_core',     label: 'Escalate to Core Team',              short: 'To Core',     scheduled: { to: 'Core Team', day: null,  shift: 'Day', hh:  9, mm:  0 } },
  { id: 'escalated_to_hq',      label: 'Escalated to HQ — keep an eye',      short: 'Watch HQ',    watch: 'HQ' },
  { id: 'need_to_contact_user', label: 'Need to contact user',               short: 'Watch User',  watch: 'User' },
  { id: 'case_closed',          label: 'Case Closed',                        short: 'Closed',      pinTo: 'User' },
  { id: 'sanity_check',         label: 'Sanity Check',                       short: 'Sanity',      pinTo: 'User', useSubjectTag: true, collapsible: true },
];
const TRACK_STATUS_BY_ID = Object.fromEntries(TRACK_STATUSES.map(t => [t.id, t]));
const TRACK_GROUP_ORDER = [
  'weekend_case', 'hq_did_not_handle', 'escalate_to_core',
  'escalated_to_hq', 'need_to_contact_user', 'case_closed',
  null, // untracked picked cases
  'sanity_check', // last — collapsible bottom group
];

// Heuristic suggestion: which Track Statuses make sense to set on the current shift.
// Not gating — every value is one click away regardless of the operator's shift.
const SUGGESTED_TRACK_STATUS_BY_SHIFT = {
  Day:   ['hq_did_not_handle', 'escalate_to_core', 'escalated_to_hq', 'need_to_contact_user', 'case_closed', 'sanity_check'],
  Night: ['hq_did_not_handle', 'escalate_to_core'],
};
function suggestedTrackStatuses() {
  const op = getOperator(STATE.operatorId);
  const base = SUGGESTED_TRACK_STATUS_BY_SHIFT[op?.shift] || [];
  // Weekend Case is always suggested on Fri/Sat regardless of which shift.
  const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][NOW.getUTCDay()];
  if (dow === 'Fri' || dow === 'Sat') return Array.from(new Set([...base, 'weekend_case']));
  return base;
}

function caseTrackStatus(c) { return c?.trackStatus || null; }
function isPicked(c) { return isQueued(c) && !['closed', 'cancelled'].includes(c.status); }
function pickedCases() { return STATE.cases.filter(c => !c.deletedAt && isPicked(c)); }

// Resolve CC's `assigneeDept` (or fallback fields) to one of the three Route Board
// stations via the `route_role` field on `owners.js`. Anything we can't resolve →
// `User` (the case is considered to be sitting with the requester).
function deptToRoleRaw(dept) {
  if (!dept) return null;
  const owners = window.OWNERS || { core: [], hq: [] };
  const all = [...(owners.core || []), ...(owners.hq || [])];
  const match = all.find(o => {
    const fields = [o.name, o.area, o.region].filter(Boolean);
    return fields.some(f => String(f).toLowerCase() === String(dept).toLowerCase());
  });
  if (match && match.route_role) return match.route_role;
  // Fallback: look for partial inclusion of dept inside the team name.
  const partial = all.find(o => String(o.name || '').toLowerCase().includes(String(dept).toLowerCase()));
  return partial ? (partial.route_role || null) : null;
}
function caseStation(c) {
  const ts = caseTrackStatus(c);
  // Case Closed and Sanity Check pin the dot to User regardless of CC dept.
  const def = TRACK_STATUS_BY_ID[ts];
  if (def?.pinTo) return def.pinTo;
  const role = deptToRoleRaw(c.assigneeDept) || deptToRoleRaw(c.assignee);
  return role || 'User';
}

// Find the next dueAt for a scheduled-handoff Track Status. The scheduled hh:mm is
// interpreted in the shift timezone (SHIFT_TZ, MST, UTC-7 no DST), and the dueDay name
// is the MST weekday — so e.g. "next Sunday 17:30 MST" lands at 00:30 UTC Monday but
// is still labelled "Sun". Walks forward up to 14 MST-days. Returns null for non-
// scheduled statuses.
const MST_OFFSET_HOURS = 7;
function scheduledHandoff(c) {
  const ts = caseTrackStatus(c);
  const def = TRACK_STATUS_BY_ID[ts];
  if (!def?.scheduled) return null;
  const { to, day: targetDay, shift: targetShift, hh, mm } = def.scheduled;
  const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const nowMs = NOW.getTime();
  // Today's MST date (treat MST as UTC minus 7 hours, no DST).
  const mstAnchor = new Date(nowMs - MST_OFFSET_HOURS * 3600 * 1000);
  const y = mstAnchor.getUTCFullYear();
  const m = mstAnchor.getUTCMonth();
  const day0 = mstAnchor.getUTCDate();
  for (let i = 0; i < 14; i++) {
    // The MST date being considered.
    const mstDate = new Date(Date.UTC(y, m, day0 + i));
    const dayName = DAYS[mstDate.getUTCDay()];
    // The UTC instant for hh:mm MST on this MST date.
    const dueUtcMs = Date.UTC(y, m, day0 + i, hh + MST_OFFSET_HOURS, mm, 0);
    if (dueUtcMs <= nowMs) continue;
    if (targetDay && targetDay !== dayName) continue;
    if (!targetDay) {
      // Need the target shift to exist on that day per the rota for the week
      // that contains `dueUtcMs` — so a "next Day shift" lookup spanning into a
      // future week honours that week's edited rota.
      const dueWeek = (window.WEEKS || []).find(w => {
        const s = Date.parse(w.startsAt), e = Date.parse(w.endsAt);
        return dueUtcMs >= s && dueUtcMs < e;
      });
      const rota = dueWeek && window.ROTA_BY_WEEK?.[dueWeek.id] || window.ROTA || [];
      const rotaDay = rota.find(r => r.day === dayName);
      const onShift = rotaDay && rotaDay.shifts?.[targetShift] && rotaDay.shifts[targetShift].length > 0;
      if (!onShift) continue;
    }
    return {
      from: caseStation(c),
      to,
      dueAt: new Date(dueUtcMs).toISOString(),
      dueDay: dayName,
      dueShift: targetShift,
    };
  }
  return null;
}

function trackStatusPhase(c) {
  const h = scheduledHandoff(c);
  if (!h) return 'idle';
  const dueMs = Date.parse(h.dueAt) - NOW.getTime();
  // Action overdue: past dueAt and the dot hasn't reached the destination yet.
  if (dueMs < 0 && caseStation(c) !== h.to) return 'overdue';
  if (caseStation(c) === h.to) return 'delivered';
  // Action due this shift: dueAt within the current shift window.
  const shiftEndMs = Date.parse(window.CURRENT_SHIFT?.endsAtUtc || NOW.toISOString()) - NOW.getTime();
  if (dueMs <= Math.max(shiftEndMs, 0)) return 'due-this-shift';
  return 'upcoming';
}

function actionDueCases()      { return pickedCases().filter(c => trackStatusPhase(c) === 'due-this-shift'); }
function actionOverdueCases()  { return pickedCases().filter(c => trackStatusPhase(c) === 'overdue'); }

function renderBellButton(c, ctx) {
  if (['closed', 'cancelled'].includes(c.status)) return '';
  const r = c.reminder;
  let cls = 'btn bell-btn';
  let label = 'Remind me';
  let title = 'Set a reminder for this case';
  if (r && !r.fired) {
    cls += ' bell-set';
    label = fmtUntil(r.fireAt);
    title = `Reminder ${fmtUntil(r.fireAt)}${r.note ? ' · ' + r.note : ''}`;
  } else if (r && r.fired) {
    cls += ' bell-due';
    label = 'Reminder due';
    title = `Due ${fmtOverdue(r.fireAt)}${r.note ? ' · ' + r.note : ''}`;
  }
  return `<button class="${cls}" data-action="prompt" data-case-id="${c.id}" data-kind="set_reminder" title="${escapeHtml(title)}">${BELL_SVG} <span>${escapeHtml(label)}</span></button>`;
}

function approachingSlaCases() {
  return STATE.cases.filter(c => {
    if (c.deletedAt) return false;
    if (['closed', 'cancelled', 'resolved'].includes(c.status)) return false;
    if (c.slaPaused) return false;
    return caseSlaMs(c) / HOUR > window.THRESHOLDS.approachingSlaHours;
  }).sort((a, b) => caseSlaMs(b) - caseSlaMs(a));
}

function escalatedCases() {
  // Replaced by `actionDueCases()` / `actionOverdueCases()` in the new model; kept as a
  // shim returning an empty list so existing callers don't break during transition.
  return [];
}

// True when an open case lacks a fresh handover note authored during the current shift.
// Mirrors the rule from the old Shift Handover page: every open case must carry a note
// written by someone on the current shift. Writing one (from a card or the reading panel)
// clears the indicator.
function needsHandoverNote(c) {
  if (c.deletedAt) return false;
  if (['closed', 'cancelled', 'new'].includes(c.status)) return false;
  if (!c.handover || c.handover.staleForCurrentShift) return true;
  const op = getOperator(STATE.operatorId);
  const author = getOperator(c.handover.author);
  return !author || author.shift !== op.shift;
}

// True if this case is assigned (in Case Center) to whoever's currently signed in. The
// match is permissive because the operator roster (op-da, op-db, …) and Case Center
// account ids aren't centrally mapped: we compare against the operator's id and name.
function isAssignedToMe(c) {
  if (!c || !c.assignee) return false;
  const op = getOperator(STATE.operatorId);
  if (!op) return false;
  const a = String(c.assignee).toLowerCase();
  return a === String(op.id).toLowerCase() || a === String(op.name).toLowerCase();
}

function handoverPendingCases() {
  const shiftEndsSoon =
    (new Date(window.CURRENT_SHIFT.endsAtUtc).getTime() - NOW.getTime()) <
    window.THRESHOLDS.shiftEndingSoonMinutes * 60 * 1000;
  if (!shiftEndsSoon) return [];
  return STATE.cases.filter(needsHandoverNote);
}

function renderWatchlists(sla, escalated) {
  if (sla.length === 0 && escalated.length === 0) return '';
  const row = c => {
    const owner = c.currentOwner ? getOwner(c.currentOwner, c.currentOwner === 'core' ? c.coreId : c.hqId) : null;
    return `
      <a class="watch-row" href="#/cases/${c.id}">
        <span class="mono muted">${c.id}</span>
        <span class="watch-subject">${escapeHtml(c.subject)}</span>
        <span class="pill pill-${c.status}">${escapeHtml(displayStatus(c))}</span>
        <span class="muted tiny">${owner ? escapeHtml(owner.name.replace(/^(Core Team|FIT|HQ) — /, '')) + ' · ' : ''}on us ${fmtDuration(caseSlaMs(c))}</span>
      </a>
    `;
  };
  const slaSection = sla.length > 0 ? `
    <div class="watchlist-section">
      <div class="watchlist-header">Approaching SLA <span class="muted">(${sla.length})</span></div>
      ${sla.map(row).join('')}
    </div>
  ` : '';
  const escSection = escalated.length > 0 ? `
    <div class="watchlist-section">
      <div class="watchlist-header">Escalated — keep an eye <span class="muted">(${escalated.length})</span></div>
      ${escalated.map(row).join('')}
    </div>
  ` : '';
  return `<div class="watchlist">${slaSection}${escSection}</div>`;
}

function renderTzHint(owner) {
  if (!owner) return '';
  const local = ownerLocalNow(owner);
  const inHours = ownerInOfficeHours(owner);
  if (!local) return '';
  const cls = inHours == null ? '' : (inHours ? 'in-hours' : 'out-of-hours');
  return `<span class="tz-hint ${cls}" title="${escapeHtml(owner.tz)} · office ${escapeHtml(owner.office)}">${escapeHtml(local)} ${escapeHtml(owner.tz.split('/').pop())}</span>`;
}

/* ---------- Picked workspace view ----------
 * Replaces the old kanban-by-CC-status board. Layout (per
 * docs/case-center-overview-plan.md §1 / §6):
 *
 *    +-----------------------------------------------------+
 *    |   Aggregate Route Board strip (User · Core · HQ)    |   1/3 height
 *    +----------+------------------------------------------+
 *    |  Picked  |           Case detail                    |   2/3 height
 *    |  list    |                                          |   1:2 width
 *    +----------+------------------------------------------+
 *
 *  CC status no longer drives any columns. The only operator-set field on
 *  a picked case is `trackStatus` (see TRACK_STATUSES). Cases land here by
 *  being "picked" from #/archive (Overview).
 */

/* ---------- Hand-off Route Board ----------
 * Built to spec (band → card → absolute-positioned rows). Stations at left 12%,
 * 50%, 88% of the white card. Four row types:
 *
 *   MOVING (66px)  — scheduled handoff. Solid origin dot at the From station,
 *                    coloured route line to the destination, animated traveling
 *                    dot along the line, hollow ring + arrowhead at the To
 *                    station, deadline chip centered above the line.
 *   WATCH  (60px)  — `escalated_to_hq`. Dot at HQ ringed by a dashed circle,
 *                    amber eye icon and id to the right. No line.
 *   STAY   (48px)  — `case_closed` / `need_to_contact_user` / untracked. Quiet
 *                    dot at User with "<id> · stays". `need_to_contact_user`
 *                    adds an outlined blue-grey eye icon to the dot's left.
 *   SANITY (46px)  — collapsed header row for every `sanity_check` case with a
 *                    +/- toggle; expanded reveals one 38px sub-row per case.
 *
 * The fonts (Lora / IBM Plex Sans / IBM Plex Mono) are loaded in index.html.
 */

const ROUTE_STATION_POS = { 'User': 12, 'Core Team': 50, 'HQ': 88 };
// Midpoint of the route line where the deadline chip sits.
// Spec is explicit: 31% for Core, 70% for HQ (not the geometric midpoint of
// 12→88 — biased toward the destination so it doesn't overlap the case id).
const ROUTE_CHIP_POS = { 'Core Team': 31, 'HQ': 70 };
const ROUTE_GREEN = '#2E5641';
const ROUTE_RED = '#B05050';

function _mstYmd(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const ms = d.getTime() - MST_OFFSET_HOURS * 3600 * 1000;
  const m = new Date(ms);
  return `${m.getUTCFullYear()}-${m.getUTCMonth()}-${m.getUTCDate()}`;
}

// "today HH:MM" if the dueAt falls on the same MST date as NOW; otherwise
// "<Day> HH:MM" (e.g. "Sun 17:30"). Overdue chips get "overdue HH:MM".
function formatDeadlineChip(handoff, phase) {
  const due = handoff.dueAt;
  const time = _shiftTzHHMM(due);  // HH:MM in MST
  if (phase === 'overdue') return `overdue ${time}`;
  const sameMstDay = _mstYmd(due) === _mstYmd(NOW.toISOString());
  if (sameMstDay) return `today ${time}`;
  return `${handoff.dueDay} ${time}`;
}

function _classifyRouteRow(c) {
  const ts = caseTrackStatus(c);
  if (ts === 'sanity_check') return 'sanity';
  if (scheduledHandoff(c)) return 'moving';
  // WATCH covers both "watching at HQ" (escalated_to_hq) and "watching at User"
  // (need_to_contact_user) — same row shape, station position derived from the
  // Track Status definition's `watch` field.
  if (ts === 'escalated_to_hq' || ts === 'need_to_contact_user') return 'watch';
  return 'stay';  // case_closed, untracked
}

function _renderMovingRow(c, top, animDelay) {
  const handoff = scheduledHandoff(c);
  const phase = trackStatusPhase(c);
  const overdue = phase === 'overdue';
  const color = overdue ? ROUTE_RED : ROUTE_GREEN;
  const originPct = ROUTE_STATION_POS[handoff.from] ?? ROUTE_STATION_POS['User'];
  const destPct = ROUTE_STATION_POS[handoff.to];
  const chipPct = ROUTE_CHIP_POS[handoff.to] ?? ((originPct + destPct) / 2);
  const widthPct = destPct - originPct;
  const chipText = formatDeadlineChip(handoff, phase);
  const chipCls = overdue ? 'rb-chip rb-chip-overdue' : 'rb-chip rb-chip-amber';
  const sel = STATE.kanbanSelected === c.id ? ' rb-row-selected' : '';

  // When origin and destination resolve to the same station the travel line has
  // zero length; drawing the line/arrowhead/track then leaves a detached triangle
  // stacked on the dot. In that case render only the "at station" marker.
  const degenerate = Math.abs(widthPct) < 0.5;
  const travel = degenerate ? '' : `
      <div class="rb-line"            style="left:${originPct}%; width:${widthPct}%; background:${color};"></div>
      <div class="rb-line-arrowhead"  style="left:${destPct}%; border-left-color:${color};"></div>
      <div class="rb-travel-track"    style="left:${originPct}%; width:${widthPct}%;">
        <span class="rb-travel-dot" style="background:${color}; animation-delay:${animDelay}s;"></span>
      </div>`;

  return `
    <div class="rb-row rb-row-moving${sel}" style="top:${top}px;" data-case-id="${c.id}" data-action="select-case" title="${escapeHtml(c.id)} · ${escapeHtml(c.subject)}">
      ${travel}
      <div class="rb-origin-dot"      style="left:${originPct}%; background:#3f6e5e; box-shadow:0 0 0 1.5px #3f6e5e;"></div>
      <div class="rb-dest-ring"       style="left:${destPct}%; border-color:${color};"></div>
      <div class="rb-id"              style="left:calc(${originPct}% + 14px);">${escapeHtml(c.id)}</div>
      <div class="${chipCls}"         style="left:${chipPct}%;">${escapeHtml(chipText)}</div>
    </div>
  `;
}

function _renderWatchRow(c, top) {
  const sel = STATE.kanbanSelected === c.id ? ' rb-row-selected' : '';
  const ts = caseTrackStatus(c);
  const def = TRACK_STATUS_BY_ID[ts] || {};
  const station = def.watch || 'HQ';
  const pct = ROUTE_STATION_POS[station] ?? 88;
  // Dot colour matches the station's square in the header (User #3f6e5e, HQ #8C4A2F).
  const dotColor = station === 'User' ? '#3f6e5e' : '#8C4A2F';
  // The id sits on whichever side has room — to the right of the dashed ring when
  // we're at User (so it doesn't overflow the card on the left), otherwise to the right.
  const eyeLeftCalc = `calc(${pct}% + 22px)`;
  // For User position, push the id further right so the eye + id don't collide.
  const idShift = station === 'User' ? `calc(${pct}% + 44px)` : `calc(${pct}% + 42px)`;
  // The dashed ring pulses (shrinks to dot size, expands back) until the current
  // operator has personally handed this case over. Once the latest handover note
  // is authored by the current operator the ring goes quiet — a visual nudge
  // for *Watching at HQ / User* cases that still need a hand-off.
  const handoveredByMe = c.handover && c.handover.author === STATE.operatorId && !c.handover.staleForCurrentShift;
  const pulseCls = handoveredByMe ? '' : ' rb-watch-ring-pulse';
  return `
    <div class="rb-row rb-row-watch${sel}" style="top:${top}px;" data-case-id="${c.id}" data-action="select-case" title="${escapeHtml(c.id)} · ${escapeHtml(c.subject)}">
      <div class="rb-watch-ring${pulseCls}" style="left:${pct}%;"></div>
      <div class="rb-watch-dot"  style="left:${pct}%; background:${dotColor};"></div>
      <div class="rb-watch-eye"  style="left:${eyeLeftCalc};" aria-hidden="true">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#C9A53C" stroke-width="2"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
      </div>
      <div class="rb-watch-id" style="left:${idShift};">${escapeHtml(c.id)}</div>
    </div>
  `;
}

function _renderStayRow(c, top) {
  const sel = STATE.kanbanSelected === c.id ? ' rb-row-selected' : '';
  return `
    <div class="rb-row rb-row-stay${sel}" style="top:${top}px;" data-case-id="${c.id}" data-action="select-case" title="${escapeHtml(c.id)} · ${escapeHtml(c.subject)}">
      <div class="rb-stay-dot" style="left:12%;"></div>
      <div class="rb-stay-id" style="left:calc(12% + 14px);">${escapeHtml(c.id)} · stays</div>
    </div>
  `;
}

function _renderSanityHeader(count, expanded, top) {
  const sym = expanded ? '−' : '+';
  return `
    <div class="rb-row rb-row-sanity-header" style="top:${top}px;" data-action="toggle-sanity">
      <div class="rb-sanity-dot" style="left:12%;"></div>
      <button class="rb-sanity-toggle" style="left:calc(12% + 14px);" type="button" aria-expanded="${expanded}">${sym}</button>
      <div class="rb-sanity-label" style="left:calc(12% + 42px);">Sanity Check · ${count} case${count === 1 ? '' : 's'}</div>
    </div>
  `;
}

function _renderSanitySubRow(c, top) {
  const sel = STATE.kanbanSelected === c.id ? ' rb-row-selected' : '';
  return `
    <div class="rb-row rb-row-sanity-sub${sel}" style="top:${top}px;" data-case-id="${c.id}" data-action="select-case" title="${escapeHtml(c.id)} · ${escapeHtml(c.subject)}">
      <div class="rb-sanity-sub-dot" style="left:12%;"></div>
      <div class="rb-sanity-sub-id" style="left:calc(12% + 14px);">${escapeHtml(c.id)} · ${escapeHtml(c.subject)}</div>
    </div>
  `;
}

function renderRouteBoardStrip() {
  const all = pickedCases();

  // Bucket every picked case into one of the four visual row types.
  const moving = [], watch = [], stay = [], sanity = [];
  for (const c of all) {
    switch (_classifyRouteRow(c)) {
      case 'moving': moving.push(c); break;
      case 'watch':  watch.push(c);  break;
      case 'stay':   stay.push(c);   break;
      case 'sanity': sanity.push(c); break;
    }
  }
  // Overdue first inside the moving group; ties broken by soonest dueAt.
  moving.sort((a, b) => {
    const pa = trackStatusPhase(a) === 'overdue' ? 0 : 1;
    const pb = trackStatusPhase(b) === 'overdue' ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return Date.parse(scheduledHandoff(a).dueAt) - Date.parse(scheduledHandoff(b).dueAt);
  });

  const overdueCount = moving.filter(c => trackStatusPhase(c) === 'overdue').length;
  const summary = `${moving.length} moving · ${overdueCount} overdue · ${watch.length} watch`;

  // Stack rows top-to-bottom; absolute positioning means the card has a fixed
  // height computed from the per-row totals below.
  const HEADER_TOP = 14;             // distance from card top to station labels
  const STATIONS_HEIGHT = 30;        // label row height
  const FIRST_ROW_TOP = HEADER_TOP + STATIONS_HEIGHT + 8;
  let y = FIRST_ROW_TOP;
  const segments = [];
  let movingIdx = 0;
  for (const c of moving) {
    segments.push(_renderMovingRow(c, y, +(movingIdx * 0.55).toFixed(2)));
    y += 66;
    movingIdx++;
  }
  for (const c of watch) { segments.push(_renderWatchRow(c, y)); y += 60; }
  for (const c of stay)  { segments.push(_renderStayRow(c, y));  y += 48; }
  const sanityExpanded = !!STATE.sanityExpanded;
  if (sanity.length > 0) {
    segments.push(_renderSanityHeader(sanity.length, sanityExpanded, y));
    y += 46;
    if (sanityExpanded) {
      for (const c of sanity) {
        segments.push(_renderSanitySubRow(c, y));
        y += 38;
      }
    }
  }
  const cardHeight = Math.max(y + 14, FIRST_ROW_TOP + 40);

  // Empty state — keep the band chrome so the layout doesn't jump.
  const emptyBody = all.length === 0
    ? `<div class="rb-empty">No cases picked yet. Open <a href="#/archive">Overview</a> to find cases to pick.</div>`
    : segments.join('');

  return `
    <section class="route-band">
      <div class="rb-band-titlebar">
        <div class="rb-band-left">
          <span class="rb-band-dot"></span>
          <span class="rb-band-title">HAND-OFF ROUTE BOARD</span>
          <span class="rb-band-summary">${escapeHtml(summary)}</span>
        </div>
        <div class="rb-band-legend">
          <span><span class="rb-legend-swatch rb-legend-solid"></span>Solid dot = holding now</span>
          <span><span class="rb-legend-swatch rb-legend-ring"></span>Ring = hand over to</span>
          <span><span class="rb-legend-swatch rb-legend-red"></span>Red = overdue</span>
        </div>
      </div>
      <div class="rb-card" style="height:${cardHeight}px;">
        <div class="rb-guide" style="left:12%;"></div>
        <div class="rb-guide" style="left:50%;"></div>
        <div class="rb-guide" style="left:88%;"></div>
        <div class="rb-station rb-station-user" style="left:12%; top:${HEADER_TOP}px;">
          <span class="rb-station-square" style="background:#3f6e5e;"></span>
          <span class="rb-station-label"  style="color:#3f6e5e;">USER</span>
        </div>
        <div class="rb-station rb-station-core" style="left:50%; top:${HEADER_TOP}px;">
          <span class="rb-station-square" style="background:#8A3434;"></span>
          <span class="rb-station-label"  style="color:#8A3434;">CORE TEAM</span>
        </div>
        <div class="rb-station rb-station-hq" style="left:88%; top:${HEADER_TOP}px;">
          <span class="rb-station-square" style="background:#8C4A2F;"></span>
          <span class="rb-station-label"  style="color:#8C4A2F;">HQ</span>
        </div>
        ${emptyBody}
      </div>
    </section>
  `;
}

function trackStatusPill(c) {
  const ts = caseTrackStatus(c);
  if (!ts) return `<span class="ts-pill ts-none">Untracked</span>`;
  const def = TRACK_STATUS_BY_ID[ts];
  return `<span class="ts-pill ts-${ts}" title="${escapeHtml(def.label)}">${escapeHtml(def.short)}</span>`;
}

function renderPickedListRow(c) {
  const isSelected = STATE.kanbanSelected === c.id;
  return `
    <div class="picked-row${isSelected ? ' picked-row-selected' : ''}" data-case-id="${c.id}" data-action="select-case">
      <div class="picked-row-head">
        <span class="mono muted">${c.id}</span>
        ${trackStatusPill(c)}
        <span class="pill pill-${c.status}">${escapeHtml(displayStatus(c))}</span>
      </div>
      <div class="picked-row-subject">${escapeHtml(c.subject)}</div>
    </div>
  `;
}

function renderPickedList() {
  const all = pickedCases();
  // Sort: by Track Status group order, then due time within each group.
  const rank = id => {
    const i = TRACK_GROUP_ORDER.indexOf(id);
    return i === -1 ? TRACK_GROUP_ORDER.length : i;
  };
  const sorted = all.slice().sort((a, b) => {
    const ra = rank(caseTrackStatus(a));
    const rb = rank(caseTrackStatus(b));
    if (ra !== rb) return ra - rb;
    const ha = scheduledHandoff(a);
    const hb = scheduledHandoff(b);
    if (ha && hb) return Date.parse(ha.dueAt) - Date.parse(hb.dueAt);
    if (ha) return -1;
    if (hb) return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  if (sorted.length === 0) {
    return `<div class="picked-list-empty">No picked cases.<br><a href="#/archive">Open Overview</a></div>`;
  }
  return `<div class="picked-list">${sorted.map(renderPickedListRow).join('')}</div>`;
}

function renderCaseList() {
  const all = pickedCases();
  const selected = STATE.kanbanSelected ? caseById(STATE.kanbanSelected) : null;
  const validSelection = selected && all.includes(selected);
  // Default selection: the topmost picked case (matches the sorted list above).
  let activeCase = validSelection ? selected : null;
  if (!activeCase && all.length > 0) {
    const sorted = all.slice().sort((a, b) => {
      const rank = id => { const i = TRACK_GROUP_ORDER.indexOf(id); return i === -1 ? 99 : i; };
      return rank(caseTrackStatus(a)) - rank(caseTrackStatus(b));
    });
    activeCase = sorted[0];
    STATE.kanbanSelected = activeCase.id;
  }

  const handoverPending = handoverPendingCases();
  const handoverBanner = handoverPending.length > 0 ? `
    <div class="kanban-handover-banner">
      <strong>Shift ending:</strong> ${handoverPending.length} open case${handoverPending.length === 1 ? '' : 's'} still need a fresh ${escapeHtml(getOperator(STATE.operatorId).shift)}-shift handover note.
    </div>
  ` : '';

  const dueReminders = STATE.cases.filter(c =>
    !c.deletedAt && c.reminder && c.reminder.fired && !['closed', 'cancelled'].includes(c.status)
  );
  const remindersBanner = dueReminders.length > 0 ? `
    <div class="reminders-due">
      <div class="reminders-due-header">${BELL_SVG} Reminders due <span class="muted">(${dueReminders.length})</span></div>
      ${dueReminders.map(c => `
        <div class="reminder-row">
          <div>
            <div class="row-flex">
              <a class="mono" href="#/cases/${c.id}">${c.id}</a>
              <span class="pill pill-${c.status}">${escapeHtml(displayStatus(c))}</span>
              <span class="muted tiny">${escapeHtml(fmtOverdue(c.reminder.fireAt))}</span>
            </div>
            <div class="reminder-subject">${escapeHtml(c.subject)}</div>
            ${c.reminder.note ? `<div class="reminder-note">"${escapeHtml(c.reminder.note)}"</div>` : ''}
          </div>
          <div class="reminder-actions">
            <button class="btn" data-action="prompt" data-case-id="${c.id}" data-kind="snooze_reminder">Snooze 5m</button>
            <button class="btn" data-action="prompt" data-case-id="${c.id}" data-kind="dismiss_reminder">Dismiss</button>
          </div>
        </div>
      `).join('')}
    </div>
  ` : '';

  const watchlist = renderWatchlists(approachingSlaCases(), actionDueCases().concat(actionOverdueCases()));

  const liveBanner = window.__LIVE__ ? (() => {
    const total = STATE.cases.length;
    return `<div class="kanban-live-banner">Live · ${total} case${total === 1 ? '' : 's'} from Case Center · ${all.length} picked.</div>`;
  })() : '';

  return `
    <div class="picked-page">
      <div class="page-header picked-page-header">
        <div>
          <h1>Picked workspace</h1>
          <div class="subtitle">${all.length} picked · ${actionDueCases().length} due this shift · ${actionOverdueCases().length} overdue. Pick more from <a href="#/archive">Overview</a>.</div>
        </div>
        <div class="toolbar">
          ${/^https?:$/.test(location.protocol) ? `
          <label class="lookback-ctl">Created between
            <input type="number" id="lookback-input" min="1" step="1" value="${STATE.lookbackHours}">
            and
            <input type="number" id="lookback-to-input" min="0" step="1" value="${STATE.lookbackToHours}">
            h ago
            <button class="btn" id="lookback-load">Load New</button>
          </label>` : ''}
          <button class="btn" id="refresh-existing" title="Re-pull every case already on the board from Case Center">Refresh Existing</button>
          <button class="btn" data-action="prompt" data-kind="new_case" title="Manually import a single case by Case Center ID (for older cases outside the look-back window)">+ Import case by ID</button>
        </div>
      </div>
      ${liveBanner}
      ${remindersBanner}
      ${handoverBanner}
      <div class="picked-workspace">
        <div class="picked-workspace-top">
          ${renderRouteBoardStrip()}
        </div>
        <div class="picked-workspace-bottom${STATE.pickedListCollapsed ? ' is-list-collapsed' : ''}">
          <div class="picked-workspace-list">
            <div class="picked-list-header">
              <span class="picked-list-title">Picked cases (${pickedCases().length})</span>
              <button class="picked-list-toggle" data-action="toggle-picked-list" title="Hide list">◂ Hide</button>
            </div>
            ${renderPickedList()}
          </div>
          ${STATE.pickedListCollapsed ? `<button class="picked-list-show-btn" data-action="toggle-picked-list" title="Show list">▸ Show list</button>` : ''}
          <div class="picked-workspace-detail">${renderReadingPanel(activeCase)}</div>
        </div>
      </div>
      ${watchlist}
    </div>
  `;
}

// Per-case ⟳ — re-fetch this one case from Case Center. Always shown; if there's no backend
// (public demo / file://) the click degrades gracefully with a "no backend" toast.
function renderRefreshButton(c, size /* 'tiny' | 'normal' */) {
  const cls = size === 'tiny' ? 'btn-tiny' : 'btn';
  return `<button class="${cls} refresh-case-btn" data-action="refresh-case" data-case-id="${c.id}" title="Re-fetch this case from Case Center" onclick="event.stopPropagation()">⟳</button>`;
}

// Legacy kanban card renderer — preserved as a no-op shim because the kanban-by-CC-status
// grouping was removed (see plan §1). The new Picked workspace uses route lanes instead
// of cards. Nothing in the active render path calls this anymore.
function renderKanbanCard(_c) { return ''; }

// Dead code below intentionally kept for now but unreachable; safe to delete in a follow-up.
function _legacyRenderKanbanCard(c) {
  const flags = '';
  const owner = c.currentOwner ? getOwner(c.currentOwner, c.currentOwner === 'core' ? c.coreId : c.hqId) : null;
  const isSel = STATE.kanbanSelected === c.id;
  const bellState = c.reminder
    ? (c.reminder.fired ? '<span class="kanban-bell-mini bell-due" title="Reminder due">●</span>' : '<span class="kanban-bell-mini bell-set" title="Reminder ' + escapeHtml(fmtUntil(c.reminder.fireAt)) + '">●</span>')
    : '';

  // Primary one-click action for this case, if one applies (assign / chase / escalate / verify).
  const primary = derivePromptsForCase(c)[0];
  const primaryBtn = primary ? `
    <button class="btn-tiny kanban-cta" data-action="prompt" data-case-id="${c.id}" data-kind="${primary.kind}" title="${escapeHtml(PROMPT_DEFS[primary.kind].label)}" onclick="event.stopPropagation()">
      <span class="prompt-icon ${PROMPT_DEFS[primary.kind].cls}">${PROMPT_DEFS[primary.kind].icon}</span>
      ${escapeHtml(PROMPT_DEFS[primary.kind].action)}
    </button>
  ` : '';

  // Handover affordance — write a fresh shift note straight from the card.
  const handoverBtn = needsHandoverNote(c) ? `
    <button class="btn-tiny kanban-handover-btn" data-action="prompt" data-case-id="${c.id}" data-kind="end_of_shift_handover" title="Write a handover note for this shift" onclick="event.stopPropagation()">⚠ Note</button>
  ` : '';

  const mine = isAssignedToMe(c);
  return `
    <div class="kanban-card ${isSel ? 'is-selected' : ''} ${mine ? 'is-mine' : ''}" data-action="kanban-select" data-case-id="${c.id}">
      <div class="kanban-card-head">
        <span class="mono muted">${c.id}</span>
        <div class="kanban-card-head-right">
          ${mine ? '<span class="kanban-mine" title="Assigned to you">● me</span>' : ''}
          <span class="priority-${c.priority}">${escapeHtml(c.priority)}</span>
          ${bellState}
          ${isQueued(c) ? '<span class="kanban-queued" title="In your queue">★</span>' : ''}
        </div>
      </div>
      ${flags ? `<div class="kanban-card-flags">${flags}</div>` : ''}
      <div class="kanban-card-subject">${escapeHtml(c.subject)}</div>
      <div class="kanban-card-meta">
        <span>${owner ? escapeHtml(owner.name.replace(/^(Core Team|FIT|HQ) — /, '')) : (c.assignee ? escapeHtml(c.assignee) : '<span class="muted">unassigned</span>')}</span>
        <span class="muted">${fmtDuration(caseSlaMs(c))}${c.slaPaused ? ' ⏸' : ''}</span>
      </div>
      <div class="kanban-card-actions">
        ${primaryBtn}
        ${handoverBtn}
        ${renderRefreshButton(c, 'tiny')}
        ${renderQueueToggleButton(c, 'tiny')}
      </div>
    </div>
  `;
}

function renderReadingPanel(c) {
  if (!c) {
    return `<div class="reading-empty">Select a case from the list or the Route Board above to read its full detail here.</div>`;
  }
  const actions = renderDetailActions(c);

  return `
    <div class="reading-header">
      <div>
        <div class="row-flex">
          <a class="mono muted" href="#/cases/${c.id}">${c.id}</a>
          <span class="pill pill-${c.status}">${escapeHtml(displayStatus(c))}</span>
          <span class="priority-${c.priority}">${escapeHtml(c.priority)} priority</span>
          ${trackStatusPill(c)}
        </div>
        <h2 style="margin-top:6px;">${escapeHtml(c.subject)}</h2>
        <div class="muted tiny"><a href="${escapeHtml(caseHref(c))}" target="_blank" rel="noreferrer">${escapeHtml(caseHref(c))}</a></div>
      </div>
      <div class="reading-actions">${actions}</div>
    </div>
    ${renderCaseDetailBody(c)}
  `;
}

/* ---------- Case Detail view ---------- */

/* ---------- Ownership timeline (who held the case, when) ---------- */

// Reconstruct the ordered possession segments from a case's history. Each segment is
// { holder, start, end, label } where holder is which "hand" the case was in.
function ownershipSegments(c) {
  const events = (c.history || []).slice().sort((a, b) => new Date(a.at) - new Date(b.at));
  // Every case starts in first-line triage at creation. Anchor on createdAt so the triage
  // segment exists even for live cases, which arrive with an empty history (no 'created' event)
  // — assigning to FIT then yields first-line time = assign time − create time.
  const createdMs = c.createdAt ? new Date(c.createdAt).getTime()
    : (events[0] ? new Date(events[0].at).getTime() : null);
  if (createdMs == null) return [];

  // Map a history event to the holder it puts the case in (null = not a handoff).
  const classify = (ev, prev) => {
    const d = (ev.detail || '').toLowerCase();
    switch (ev.kind) {
      case 'created': return 'triage';
      case 'assigned': return 'core';      // assignment is always to Core Team
      case 'escalated': return 'hq';
      case 'returned': return 'requester';
      case 'closed': case 'cancelled': return 'done';
      case 'status': case 'resumed': {    // ambiguous — read the detail
        // Sanity Check = waiting on the requester to confirm the fix → counted as requester time.
        if (/sanity check/.test(d)) return 'requester';
        if (/\bhq\b|product team/.test(d)) return 'hq';
        if (/core team|→ core|\bcore\b/i.test(d)) return 'core';
        if (/requester|returned/.test(d)) return 'requester';
        if (/resolved|closed/.test(d)) return 'done';
        if (/unassigned|\bnew\b/.test(d)) return 'triage';
        return prev;
      }
      default: return null;               // reminder / handover / note / flag / reassigned
    }
  };

  const segs = [];
  let holder = 'triage';        // first line, from creation until the first handoff
  let start = createdMs;
  let label = '';
  for (const ev of events) {
    const h = classify(ev, holder);
    if (h == null) continue;
    if (h === holder) continue;
    const at = Math.max(new Date(ev.at).getTime(), start);  // guard against out-of-order timestamps
    segs.push({ holder, start, end: at, label });
    if (h === 'done') { holder = 'done'; break; }
    holder = h; start = at; label = ev.detail || '';
  }
  if (holder && holder !== 'done') {
    const terminal = ['resolved', 'closed', 'cancelled'].includes(c.status);
    const end = terminal ? start : NOW.getTime();
    segs.push({ holder, start, end: Math.max(end, start), label });
  }
  return segs;
}

// Total time spent in each holder, summed from the ownership segments (history-derived).
// Sanity Check is classified as requester time (see ownershipSegments), so there is no separate
// "sanity" bucket — that span lands in `requester`.
function holderTotals(c) {
  const tot = { triage: 0, core: 0, hq: 0, requester: 0 };
  for (const s of ownershipSegments(c)) {
    if (s.holder in tot) tot[s.holder] += Math.max(0, s.end - s.start);
  }
  return tot;
}

const HOLDER_META = {
  triage:    { label: 'First line',       cls: 'tl-triage' },
  core:       { label: 'Core Team',        cls: 'tl-core' },
  hq:        { label: 'HQ Product Team',  cls: 'tl-hq' },
  requester: { label: 'With requester',   cls: 'tl-requester' },
  done:      { label: 'Closed',           cls: 'tl-done' },
};

function renderOwnershipTimeline(c) {
  const segs = ownershipSegments(c);
  if (segs.length === 0) {
    return '<div class="muted tiny">The timeline appears here as the case moves between owners.</div>';
  }
  const first = segs[0].start;
  const last = segs[segs.length - 1].end;
  const span = Math.max(1, last - first);

  const bar = segs.map(s => {
    const m = HOLDER_META[s.holder] || HOLDER_META.triage;
    const dur = s.end - s.start;
    const pct = (dur / span) * 100;
    const tip = `${m.label} · ${fmtDuration(dur)} · from ${fmtAbsolute(new Date(s.start).toISOString())}${s.label ? ' · ' + s.label : ''}`;
    return `<div class="tl-seg ${m.cls}" style="width:${pct}%" title="${escapeHtml(tip)}">${pct > 14 ? escapeHtml(m.label) : ''}</div>`;
  }).join('');

  const totals = holderTotals(c);
  const legend = Object.keys(totals).filter(k => totals[k] > 0).map(k => {
    const m = HOLDER_META[k] || HOLDER_META.triage;
    return `<span class="tl-key"><span class="tl-dot ${m.cls}"></span>${escapeHtml(m.label)} <span class="muted">${fmtDuration(totals[k])}</span></span>`;
  }).join('');

  const terminal = ['resolved', 'closed', 'cancelled'].includes(c.status);
  // A timestamp marker at every transition (segment start) plus the end (now / closed).
  const bounds = segs.map(s => s.start).concat([last]);
  let prevPct = -99;
  const marks = bounds.map((b, i) => {
    const pct = ((b - first) / span) * 100;
    const isEnd = i === bounds.length - 1;
    const label = (isEnd && !terminal) ? 'now' : fmtClockShort(new Date(b).toISOString());
    const row = (pct - prevPct < 7) ? 1 : 0;  // stagger markers that sit too close together
    prevPct = pct;
    const horiz = pct <= 1 ? 'left:0;text-align:left'
      : pct >= 99 ? 'left:100%;transform:translateX(-100%);text-align:right'
        : `left:${pct}%;transform:translateX(-50%)`;
    return `<span class="tl-mark" style="${horiz};top:${row * 13}px" title="${escapeHtml(fmtAbsolute(new Date(b).toISOString()))}">${escapeHtml(label)}</span>`;
  }).join('');

  return `
    <div class="timeline" role="img" aria-label="Ownership timeline">${bar}</div>
    <div class="tl-marks">${marks}</div>
    <div class="tl-legend">${legend}</div>
  `;
}

/* ---------- Process timeline (Case Center's per-stage processing time) ---------- */

// Normalize c.processTimeline (Case Center's own per-stage log; see map_process_timeline in
// local/casecenter.py) into ordered, duration-bearing segments. Each entry's length is its
// reported processMinutes (the authoritative "process time"), falling back to end − start.
// This is a LIVE Case Center field; demo cases that carry a seeded processTimeline show it too.
function processSegments(c) {
  const items = (c.processTimeline || []).filter(s => s && typeof s === 'object').slice();
  items.sort((a, b) => new Date(a.startedAt || a.endedAt || 0) - new Date(b.startedAt || b.endedAt || 0));
  return items.map(it => {
    const start = it.startedAt ? new Date(it.startedAt).getTime() : null;
    const end = it.endedAt ? new Date(it.endedAt).getTime() : null;
    const ms = (typeof it.minutes === 'number' && isFinite(it.minutes))
      ? Math.max(0, it.minutes) * 60000
      : (start != null && end != null ? Math.max(0, end - start) : 0);
    return { ...it, start, end, ms };
  });
}

function renderProcessTimeline(c) {
  const segs = processSegments(c);
  if (segs.length === 0) {
    return '<div class="muted tiny">No Case Center process timeline for this case.</div>';
  }
  const totalMs = segs.reduce((s, x) => s + x.ms, 0) || 1;

  // One segment per processing stage; width ∝ its process time, colored by the board status
  // its Case Center status maps to (so stages read like the board columns).
  const bar = segs.map(s => {
    const pct = (s.ms / totalMs) * 100;
    const labelText = s.processType || s.ccStatus || '';
    const tip = [
      s.ccStatus || labelText,
      fmtDuration(s.ms),
      s.processor ? 'by ' + s.processor : '',
      s.processorDept || '',
      s.start != null ? 'from ' + fmtAbsolute(new Date(s.start).toISOString()) : '',
    ].filter(Boolean).join(' · ');
    return `<div class="tl-seg pill-${s.status || 'new'}" style="width:${pct}%" title="${escapeHtml(tip)}">${pct > 12 ? escapeHtml(labelText) : ''}</div>`;
  }).join('');

  // Legend: total process time grouped by `processType` — same key the bar
  // segments use for their visible label, so the two stay in sync. Falls back
  // to ccStatus / mapped board status label when a stage has no processType.
  const groups = new Map();
  segs.forEach(s => {
    const key = s.processType || s.ccStatus || statusLabel(s.status || 'new');
    const g = groups.get(key) || { status: s.status || 'new', ms: 0, count: 0 };
    g.ms += s.ms;
    g.count += 1;
    groups.set(key, g);
  });
  const legend = [...groups.entries()].map(([label, g]) =>
    `<span class="tl-key"><span class="tl-dot pill-${g.status}"></span>${escapeHtml(label)} <span class="muted">${fmtDuration(g.ms)}${g.count > 1 ? ` · ${g.count} stages` : ''}</span></span>`
  ).join('');

  // Markers: the clock time each stage began (and the last stage's end), placed at the
  // cumulative process-time boundaries. (Widths are process-minutes, not wall-clock, so gaps
  // between stages aren't drawn — the markers show when each stage started.)
  let acc = 0;
  const bounds = [];
  segs.forEach(s => {
    bounds.push({ pct: (acc / totalMs) * 100, iso: s.start != null ? new Date(s.start).toISOString() : null });
    acc += s.ms;
  });
  const lastEnd = segs[segs.length - 1].end;
  bounds.push({ pct: 100, iso: lastEnd != null ? new Date(lastEnd).toISOString() : null });
  let prevPct = -99;
  const marks = bounds.filter(b => b.iso).map(b => {
    const row = (b.pct - prevPct < 7) ? 1 : 0;
    prevPct = b.pct;
    const horiz = b.pct <= 1 ? 'left:0;text-align:left'
      : b.pct >= 99 ? 'left:100%;transform:translateX(-100%);text-align:right'
        : `left:${b.pct}%;transform:translateX(-50%)`;
    return `<span class="tl-mark" style="${horiz};top:${row * 13}px" title="${escapeHtml(fmtAbsolute(b.iso))}">${escapeHtml(fmtClockShort(b.iso))}</span>`;
  }).join('');

  return `
    <div class="timeline" role="img" aria-label="Process timeline">${bar}</div>
    <div class="tl-marks">${marks}</div>
    <div class="tl-legend">${legend}</div>
    <div class="muted tiny" style="margin-top:6px">Total process time: ${fmtDuration(totalMs)} · ${segs.length} stage${segs.length === 1 ? '' : 's'}</div>
  `;
}

/* ---------- "Wait User" substatus detail (Case Center subStatus block) ---------- */

// Signed ms from now until the Wait User due time: positive = still due in the future,
// negative = overdue, null = no due date. NOW-based, like the other case clocks.
function waitUserDueMs(c) {
  const due = c && c.waitUser && c.waitUser.dueDateTime;
  if (!due) return null;
  const t = new Date(due).getTime();
  return isNaN(t) ? null : t - NOW.getTime();
}

function renderWaitUser(c) {
  const w = c.waitUser;
  if (!w) return '';
  const lp = w.lastProcessor || {};
  const lpBits = [lp.assignee, lp.handlerGrp, lp.handlerType].filter(Boolean).map(escapeHtml).join(' · ');
  const dueMs = waitUserDueMs(c);
  let dueChip = '';
  if (dueMs != null) {
    const overdue = dueMs < 0;
    dueChip = ` <span class="wu-due ${overdue ? 'wu-overdue' : ''}">${escapeHtml(overdue ? `overdue by ${fmtDuration(-dueMs)}` : `due in ${fmtDuration(dueMs)}`)}</span>`;
  }
  const row = (k, v) => v ? `<div class="detail-row"><span class="k">${k}</span><span class="v">${v}</span></div>` : '';
  return `
    ${row('Reason', w.reason ? escapeHtml(w.reason) : '')}
    ${row('Due action', w.dueAction ? escapeHtml(w.dueAction) : '')}
    ${row('Due', w.dueDateTime ? `${fmtAbsolute(w.dueDateTime)}${dueChip}` : '')}
    ${row('Last processor', lpBits || '<span class="muted">—</span>')}
    ${row('Transition', w.transition ? `${escapeHtml(w.transition)}${w.transitionDateTime ? ` <span class="muted">· ${fmtAbsolute(w.transitionDateTime)}</span>` : ''}` : '')}
  `;
}

function renderCaseDetailBody(c) {
  const core = getOwner('core', c.coreId);
  const hq = getOwner('hq', c.hqId);

  const slaMs = caseSlaMs(c);
  // FIT/HQ time spent is derived from the ownership timeline so the clocks and the
  // timeline legend always agree (same source: the case history).
  const hold = holderTotals(c);
  const coreMs = hold.core;
  const hqMs = hold.hq;
  // First-line handling = time the case sat directly with the first-line agent during triage
  // (status New). Sanity Check counts as requester time, not first-line, so it's excluded.
  const firstLineMs = hold.triage;
  const firstLineHolding = c.currentOwner === null && c.status === 'new';

  const handoverHtml = c.handover ? (() => {
    const author = getOperator(c.handover.author);
    const recipient = c.handover.toOperator ? getOperator(c.handover.toOperator) : null;
    // "<author name> (<author shift>) → <recipient name> (<recipient shift>)"
    // when both sides have names; fall back to "<shift> → <shift>" when the
    // handover was shift-targeted rather than addressed to a specific operator.
    const fromLabel = author ? `${author.name} (${c.handover.from})` : c.handover.from;
    const toLabel = recipient
      ? `${recipient.name} (${recipient.shift})`
      : c.handover.to;
    return `
    <div class="handover-note ${c.handover.staleForCurrentShift ? 'handover-stale' : ''}">
      ${escapeHtml(c.handover.note)}
      <div class="meta">
        <span class="handover-from"><strong>From</strong> ${escapeHtml(fromLabel)}</span>
        <span class="handover-arrow">→</span>
        <span class="handover-to"><strong>To</strong> ${escapeHtml(toLabel)}</span>
        <span class="handover-when">· ${fmtAbsolute(c.handover.at)}</span>
        ${c.handover.staleForCurrentShift ? ' · <strong>stale for current shift</strong>' : ''}
      </div>
    </div>`;
  })()
  : `<div class="muted tiny">No handover note.</div>`;

  const history = (c.history || []).slice().reverse().map(h => {
    const op = getOperator(h.who);
    const who = op ? op.name : h.who;
    return `
    <li>
      <span class="when">${fmtAbsolute(h.at)}</span>
      <span><strong>${escapeHtml(h.kind)}</strong> by ${escapeHtml(who)}${h.detail ? ' — ' + escapeHtml(h.detail) : ''}</span>
    </li>`;
  }).join('');

  return `
    <div class="detail-grid">
      <div>
        <div class="card"><div class="card-body">
          <div class="detail-section">
            <h3>Clocks</h3>
            <div class="clock-grid">
              <div class="clock">
                <div class="label">SLA · time on us</div>
                <div class="value">${fmtDuration(slaMs)}</div>
                <div class="state ${c.slaPaused ? 'paused' : 'running'}">${c.slaPaused ? 'Paused (with requester)' : 'Running'}</div>
              </div>
              <div class="clock" title="Time the first-line agent handled this case directly, during triage (status New). Sanity Check counts as requester time.">
                <div class="label"><span class="clock-swatch tl-triage"></span>First line</div>
                <div class="value">${fmtDuration(firstLineMs)}</div>
                <div class="state ${firstLineHolding ? 'running' : ''}">${firstLineHolding ? 'Holding now' : 'Idle'}</div>
              </div>
              <div class="clock">
                <div class="label">Core Team</div>
                <div class="value">${fmtDuration(coreMs)}</div>
                <div class="state ${c.currentOwner === 'core' ? 'running' : ''}">${c.currentOwner === 'core' ? 'Holding now' : 'Idle'}</div>
              </div>
              <div class="clock">
                <div class="label">HQ Product Team</div>
                <div class="value">${fmtDuration(hqMs)}</div>
                <div class="state ${c.currentOwner === 'hq' ? 'running' : ''}">${c.currentOwner === 'hq' ? 'Holding now' : 'Idle'}</div>
              </div>
            </div>
          </div>
          <div class="detail-section">
            <h3>Ownership timeline</h3>
            ${renderOwnershipTimeline(c)}
          </div>
          ${(c.processTimeline && c.processTimeline.length) ? `
          <div class="detail-section">
            <h3>Process timeline <span class="muted tiny" style="font-weight:400">· from Case Center</span></h3>
            ${renderProcessTimeline(c)}
          </div>` : ''}
          ${c.waitUser ? `
          <div class="detail-section">
            <h3>Waiting on user <span class="muted tiny" style="font-weight:400">· from Case Center</span></h3>
            ${renderWaitUser(c)}
          </div>` : ''}
          <div class="detail-section">
            <h3>Handover (latest)</h3>
            ${handoverHtml}
          </div>
          <div class="detail-section">
            <h3>Notes</h3>
            <div>${escapeHtml(c.notes || '—')}</div>
          </div>
          <div class="detail-section">
            <h3>History</h3>
            <ul class="history">${history || '<li class="muted">No history.</li>'}</ul>
          </div>
        </div></div>
      </div>

      <div>
        <div class="card"><div class="card-body">
          <div class="detail-section">
            <h3>Routing</h3>
            <div class="detail-row"><span class="k">User</span><span class="v">${c.user ? escapeHtml(c.user) : '<span class="muted">—</span>'}${c.userDept ? ` <span class="muted">· ${escapeHtml(c.userDept)}</span>` : ''}</span></div>
            ${c.reporter ? `<div class="detail-row"><span class="k">Reporter</span><span class="v">${escapeHtml(c.reporter)}${c.reporterDept ? ` <span class="muted">· ${escapeHtml(c.reporterDept)}</span>` : ''}</span></div>` : ''}
            ${c.assignee ? `<div class="detail-row"><span class="k">Assignee</span><span class="v">${escapeHtml(c.assignee)}${c.assigneeDept ? ` <span class="muted">· ${escapeHtml(c.assigneeDept)}</span>` : ''}</span></div>` : ''}
            <div class="detail-row"><span class="k">Core Team</span><span class="v">${core ? `${escapeHtml(core.name)} ${renderTzHint(core)}` : '<span class="muted">— unassigned</span>'} <button class="btn-tiny" data-action="reassign" data-case-id="${c.id}" data-type="core">${core ? 'Change' : 'Assign'}</button></span></div>
            <div class="detail-row"><span class="k">HQ Product Team</span><span class="v">${hq ? `${escapeHtml(hq.name)} ${renderTzHint(hq)}` : '<span class="muted">— unassigned</span>'} <button class="btn-tiny" data-action="reassign" data-case-id="${c.id}" data-type="hq">${hq ? 'Change' : 'Assign'}</button></span></div>
            <div class="detail-row"><span class="k">Last contact</span><span class="v">${c.lastOwnerContact ? `${escapeHtml(c.lastOwnerContact.channel)} · ${fmtRelative(c.lastOwnerContact.at)}` : '<span class="muted">—</span>'}</span></div>
          </div>
          <div class="detail-section">
            <h3>Filing</h3>
            <div class="detail-row"><span class="k">Status</span><span class="v">${escapeHtml(displayStatus(c))}</span></div>
            <div class="detail-row"><span class="k">Case type</span><span class="v">${escapeHtml(c.caseType)}</span></div>
            <div class="detail-row"><span class="k">Week</span><span class="v">${escapeHtml(c.weekId)}</span></div>
            <div class="detail-row"><span class="k">Created</span><span class="v">${fmtAbsolute(c.createdAt)} · ${escapeHtml(c.createdBy)}</span></div>
          </div>
        </div></div>
      </div>
    </div>
  `;
}

function renderCaseDetail(id) {
  const c = caseById(id);
  if (!c) {
    return `<div class="page-header"><div><h1>Not found</h1><div class="subtitle">No case with ID ${escapeHtml(id)}.</div></div></div>
      <a class="btn" href="${escapeHtml(STATE.lastListRoute)}">← Back to ${escapeHtml(STATE.lastListLabel)}</a>`;
  }
  const actions = renderDetailActions(c);

  return `
    <div class="page-header">
      <div>
        <div class="row-flex">
          <a class="btn-link" href="${escapeHtml(STATE.lastListRoute)}">← ${escapeHtml(STATE.lastListLabel)}</a>
          <span class="mono muted">${c.id}</span>
          <span class="pill pill-${c.status}">${escapeHtml(displayStatus(c))}</span>
          <span class="priority-${c.priority}">${escapeHtml(c.priority)} priority</span>
          ${trackStatusPill(c)}
        </div>
        <h1 style="margin-top:8px">${escapeHtml(c.subject)}</h1>
        <div class="subtitle"><a href="${escapeHtml(caseHref(c))}" target="_blank" rel="noreferrer">${escapeHtml(caseHref(c))}</a></div>
      </div>
      <div class="toolbar">${actions}</div>
    </div>

    ${renderCaseDetailBody(c)}
  `;
}

function renderDetailActions(c) {
  // The CC-shaped action surface (Assign to Core, Escalate to HQ, Chase owner, Verify fix,
  // Return to requester, Move to sanity check, Close, Cancel, Reopen) has been removed —
  // operators do all that work in Case Center. The only operator-driven mutation here is
  // **Track Status** (see TRACK_STATUSES). The picker shows all 7 values to every shift,
  // with a "Suggested for your shift" pill on the relevant ones.
  const items = [];
  const ts = caseTrackStatus(c);
  const suggested = new Set(suggestedTrackStatuses());

  const opts = TRACK_STATUSES.map(t => {
    const sel = ts === t.id ? ' selected' : '';
    const hint = suggested.has(t.id) ? ' ★' : '';
    return `<option value="${t.id}"${sel}>${escapeHtml(t.label)}${hint}</option>`;
  }).join('');
  items.push(`
    <select class="ts-picker" data-action="track-status-select" data-case-id="${c.id}" title="Set Track Status (★ = suggested for your shift)">
      <option value=""${ts ? '' : ' selected'}>— Track Status —</option>
      ${opts}
    </select>
  `);
  if (ts) {
    items.push(`<button class="btn" data-action="prompt" data-case-id="${c.id}" data-kind="clear_track_status" title="Clear Track Status (after work is done and handover written)">Clear</button>`);
  }
  if (c.caseLink) {
    items.push(`<a class="btn" href="${escapeHtml(c.caseLink)}" target="_blank" rel="noreferrer" title="Open this case in Case Center">↗ Case Center</a>`);
  }

  items.push(`<button class="btn" data-action="prompt" data-case-id="${c.id}" data-kind="end_of_shift_handover">Write handover note</button>`);

  // "Hand over to" — pick a specific operator to address the handover note at.
  // Open the same note modal pre-filled with the chosen recipient.
  const meId = STATE.operatorId;
  const recipientOpts = (window.OPERATORS || [])
    .filter(o => o.id !== meId)
    .map(o => `<option value="${escapeHtml(o.id)}">${escapeHtml(o.name)} · ${escapeHtml(o.shift)}</option>`)
    .join('');
  if (recipientOpts) {
    items.push(`
      <select class="ts-picker handover-to-picker" data-action="handover-to-select" data-case-id="${c.id}" title="Pick an operator and address a handover note to them">
        <option value="">Hand over to…</option>
        ${recipientOpts}
      </select>
    `);
  }

  items.push(renderBellButton(c, 'detail'));
  items.push(renderQueueToggleButton(c, 'normal'));
  items.push(renderRefreshButton(c, 'normal'));

  return items.join(' ');
}

// Kept as a no-op shim; the old CC-shaped status transitions are gone. Anything
// that still calls this gets an empty list.
function statusTransitions(_c) { return []; }

/* ---------- Weekly Archive ---------- */

// Day-of-week index where weeks start. 0 = Sunday (per the team's convention; matches
// the W24-2026 seed that starts on Sun Jun 7). Change here if the week ever moves.
const WEEK_STARTS_ON = 0;

// Find an existing window.WEEKS bucket whose [startsAt, endsAt) contains `createdAt`,
// or auto-create one when no week fits. The new week is inserted in date order so the
// archive list stays sorted (newest first). Week id format: `W{weekNumber}-{year}`.
function weekIdFor(createdAtIso) {
  const t = Date.parse(createdAtIso);
  if (isNaN(t)) return window.CURRENT_WEEK.id;
  const weeks = window.WEEKS || [];
  const hit = weeks.find(w => {
    const s = Date.parse(w.startsAt), e = Date.parse(w.endsAt);
    return !isNaN(s) && !isNaN(e) && t >= s && t < e;
  });
  if (hit) return hit.id;
  // No fitting week — build a fresh one anchored to the case's createdAt.
  const created = new Date(t);
  // Find the Sunday at-or-before the created date (UTC).
  const dayOffset = (created.getUTCDay() - WEEK_STARTS_ON + 7) % 7;
  const start = new Date(Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), created.getUTCDate() - dayOffset));
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  const week = {
    id: `W${weekNumberFor(start)}-${start.getUTCFullYear()}`,
    label: weekLabel(start, end),
    startsAt: start.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    endsAt: end.toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
  // Avoid colliding with an existing id (e.g. a same-numbered week from a different year).
  if (weeks.some(w => w.id === week.id)) week.id = `${week.id}-${start.getUTCDate()}`;
  weeks.push(week);
  weeks.sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  return week.id;
}

// Sunday-anchored week number: 1 = the week containing Jan 1.
function weekNumberFor(sundayStart) {
  const y = sundayStart.getUTCFullYear();
  const jan1 = new Date(Date.UTC(y, 0, 1));
  const firstSundayOffset = (jan1.getUTCDay() - WEEK_STARTS_ON + 7) % 7;
  const firstWeekStart = new Date(Date.UTC(y, 0, 1 - firstSundayOffset));
  return Math.floor((sundayStart - firstWeekStart) / (7 * 24 * 60 * 60 * 1000)) + 1;
}

function weekLabel(start, end) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','June','July','Aug','Sept','Oct','Nov','Dec'];
  const last = new Date(end.getTime() - 24 * 60 * 60 * 1000);   // inclusive end day
  const sm = MONTHS[start.getUTCMonth()], em = MONTHS[last.getUTCMonth()];
  const sd = start.getUTCDate(), ed = last.getUTCDate();
  const yr = last.getUTCFullYear();
  const w = weekNumberFor(start);
  const range = sm === em ? `${sm} ${sd} – ${ed}` : `${sm} ${sd} – ${em} ${ed}`;
  return `W${w} · ${range}, ${yr}`;
}

function weekStats(weekId) {
  const cases = STATE.cases.filter(c => !c.deletedAt && c.weekId === weekId);
  const total = cases.length;
  const open = cases.filter(c => !['closed', 'cancelled'].includes(c.status)).length;
  const closed = cases.filter(c => c.status === 'closed').length;
  const cancelled = cases.filter(c => c.status === 'cancelled').length;
  const carriedIn = cases.filter(c => c.carriedFrom).length;
  const bounces = cases.filter(c => (c.history || []).some(h => h.kind === 'returned')).length;
  const closedCases = cases.filter(c => c.status === 'closed');
  const medianOnUsHrs = (() => {
    if (closedCases.length === 0) return null;
    const v = closedCases.map(c => (c.slaAccumulatedMs || 0) / HOUR).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  })();
  return { total, open, closed, cancelled, carriedIn, bounces, medianOnUsHrs };
}

function renderArchiveIndex() {
  const cards = window.WEEKS.map(w => {
    const s = weekStats(w.id);
    const current = w.isCurrent ? '<span class="badge-current">Current</span>' : '';
    return `
      <a class="archive-card" href="#/archive/${encodeURIComponent(w.id)}">
        <div class="week-label">${escapeHtml(w.label)} ${current}</div>
        <div class="week-meta">${s.total} case${s.total === 1 ? '' : 's'} filed</div>
        <div class="week-stats">
          <div class="stat"><div class="v">${s.open}</div><div class="k">Open</div></div>
          <div class="stat"><div class="v">${s.closed}</div><div class="k">Closed</div></div>
          <div class="stat"><div class="v">${s.cancelled}</div><div class="k">Cancelled</div></div>
          <div class="stat"><div class="v">${s.carriedIn}</div><div class="k">Carried in</div></div>
          <div class="stat"><div class="v">${s.bounces}</div><div class="k">Bounces</div></div>
          <div class="stat"><div class="v">${s.medianOnUsHrs != null ? s.medianOnUsHrs.toFixed(1) + 'h' : '—'}</div><div class="k">Median on us</div></div>
        </div>
      </a>
    `;
  }).join('');
  const binnedCount = STATE.cases.filter(c => c.deletedAt).length;
  return `
    <div class="page-header">
      <div>
        <h1>Weekly Archive</h1>
        <div class="subtitle">Browse past weekly workbooks. Each week is a snapshot — cases that carried over move to the next week's filing.</div>
      </div>
      <div class="toolbar">
        <a class="btn" href="#/archive/bin">🗑 Recycle bin${binnedCount ? ` <span class="count">${binnedCount}</span>` : ''}</a>
      </div>
    </div>
    <div class="archive-grid">${cards}</div>
  `;
}

function renderArchiveWeek(weekId) {
  const week = window.WEEKS.find(w => w.id === weekId);
  if (!week) {
    return `<div class="page-header"><div><h1>Week not found</h1><div class="subtitle">No such week: ${escapeHtml(weekId)}</div></div></div>
      <a class="btn" href="#/archive">← Back to archive</a>`;
  }
  const s = weekStats(weekId);
  const cases = STATE.cases
    .filter(c => !c.deletedAt && c.weekId === weekId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const rows = cases.length === 0 ? '' : cases.map(c => {
    const core = getOwner('core', c.coreId);
    const hq = getOwner('hq', c.hqId);
    const carry = c.carriedFrom ? ` <span class="flag" title="Carried from ${escapeHtml(c.carriedFrom)}">↩ ${escapeHtml(c.carriedFrom)}</span>` : '';
    return `
      <tr data-href="#/cases/${c.id}">
        <td class="col-id">${c.id}</td>
        <td>
          <div class="subject">${escapeHtml(c.subject)}</div>
          <div><a class="link-inline" href="${escapeHtml(caseHref(c))}" target="_blank" rel="noreferrer" onclick="event.stopPropagation()">case-center ↗</a></div>
        </td>
        <td>${escapeHtml(c.user)}</td>
        <td>${core ? escapeHtml(core.name) : '<span class="muted">—</span>'}</td>
        <td>${hq ? escapeHtml(hq.name) : '<span class="muted">—</span>'}</td>
        <td><span class="pill pill-${c.status}">${escapeHtml(displayStatus(c))}</span> ${trackStatusPill(c)}${carry}</td>
        <td>${fmtDuration(caseSlaMs(c))}${c.slaPaused ? ' <span class="muted tiny">(paused)</span>' : ''}</td>
        <td class="muted tiny">${c.closedAt ? fmtRelative(c.closedAt) : fmtRelative(c.createdAt)}</td>
        <td class="col-actions">
          ${renderQueueToggleButton(c, 'tiny')}
          <button class="btn-tiny bin-btn" data-action="bin-case" data-case-id="${c.id}" title="Move to recycle bin" onclick="event.stopPropagation()">🗑</button>
        </td>
      </tr>
    `;
  }).join('');

  const currentLink = week.isCurrent
    ? `<a class="btn btn-link" href="#/cases">Open in live Cases view →</a>`
    : '';

  return `
    <div class="page-header">
      <div>
        <div class="row-flex">
          <a class="btn-link mono" href="#/archive">← archive</a>
          <span class="mono muted">${escapeHtml(week.id)}</span>
          ${week.isCurrent ? '<span class="badge-current">Current</span>' : ''}
        </div>
        <h1 style="margin-top:8px">${escapeHtml(week.label)}</h1>
        <div class="subtitle">${fmtAbsolute(week.startsAt)} → ${fmtAbsolute(week.endsAt)}</div>
      </div>
      <div class="toolbar">${currentLink}</div>
    </div>

    <div class="summary-bar">
      <div class="stat"><div class="v">${s.total}</div><div class="k">Total cases</div></div>
      <div class="stat"><div class="v">${s.open}</div><div class="k">Open</div></div>
      <div class="stat"><div class="v">${s.closed}</div><div class="k">Closed</div></div>
      <div class="stat"><div class="v">${s.cancelled}</div><div class="k">Cancelled</div></div>
      <div class="stat"><div class="v">${s.carriedIn}</div><div class="k">Carried in</div></div>
      <div class="stat"><div class="v">${s.bounces}</div><div class="k">Returned to requester</div></div>
      <div class="stat"><div class="v">${s.medianOnUsHrs != null ? s.medianOnUsHrs.toFixed(1) + 'h' : '—'}</div><div class="k">Median on us (closed)</div></div>
    </div>

    ${cases.length === 0 ? '<div class="queue-empty">No cases filed in this week.</div>' : `
      <table class="case-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Subject / Case Link</th>
            <th>User</th>
            <th>Core Team</th>
            <th>HQ Product Team</th>
            <th>Status</th>
            <th>Process Time</th>
            <th>${week.isCurrent ? 'Created' : 'Closed'}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `}
  `;
}

function renderRecycleBin() {
  const binned = STATE.cases
    .filter(c => c.deletedAt)
    .sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
  const rows = binned.map(c => {
    const remaining = binMsRemaining(c);
    const soon = remaining < DAY;   // expiring within 24h
    return `
      <tr>
        <td class="col-id">${c.id}</td>
        <td><div class="subject">${escapeHtml(c.subject)}</div></td>
        <td>${escapeHtml(c.user)}</td>
        <td><span class="pill pill-${c.status}">${escapeHtml(displayStatus(c))}</span></td>
        <td class="muted tiny">${fmtRelative(c.deletedAt)}</td>
        <td class="tiny" ${soon ? 'style="color:var(--danger);font-weight:600"' : 'style="color:var(--text-muted)"'}>${remaining > 0 ? fmtDuration(remaining) + ' left' : 'expiring'}</td>
        <td class="col-actions">
          <button class="btn-tiny" data-action="restore-case" data-case-id="${c.id}">Restore</button>
          <button class="btn-tiny btn-danger" data-action="purge-case" data-case-id="${c.id}" title="Permanently delete — cannot be undone">Delete forever</button>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div class="page-header">
      <div>
        <div class="row-flex"><a class="btn-link mono" href="#/archive">← archive</a></div>
        <h1 style="margin-top:8px">Recycle bin</h1>
        <div class="subtitle">Deleted cases are kept here for 7 days, then permanently removed. ${binned.length} case${binned.length === 1 ? '' : 's'} in the bin.</div>
      </div>
    </div>
    ${binned.length === 0 ? '<div class="queue-empty">The recycle bin is empty.</div>' : `
      <table class="case-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Subject</th>
            <th>Requester</th>
            <th>Status</th>
            <th>Deleted</th>
            <th>Expires</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `}
  `;
}

/* ---------- Recycle bin actions ---------- */

// Soft-delete: move a case to the recycle bin (one confirm). It's hidden from the board and
// archive and restorable for 7 days. `deletedAt` uses real wall-clock time.
function handleBinCase(id) {
  const c = caseById(id);
  if (!c) return;
  showModal(`
    <h3>Move case ${escapeHtml(c.id)} to the recycle bin?</h3>
    <div class="modal-sub">${escapeHtml(c.subject)}</div>
    <div class="muted tiny" style="margin-top:8px">It will be hidden from the board and archive and kept in the recycle bin for 7 days — you can restore it any time before then.</div>
    <div class="modal-actions">
      <button class="btn" data-modal-cancel>Cancel</button>
      <button class="btn btn-danger" data-modal-submit>Move to bin</button>
    </div>
  `, () => {
    c.deletedAt = realNow().toISOString();
    logHistory(c, getOperator(STATE.operatorId), 'binned', 'Moved to recycle bin');
    showToast(`${c.id} moved to the recycle bin (restorable for 7 days).`, 'warn');
    render();
    return true;
  });
}

// Restore a binned case back to the board/archive.
function handleRestoreCase(id) {
  const c = caseById(id);
  if (!c || !c.deletedAt) return;
  c.deletedAt = null;   // null (not delete) so live-mode persistence clears it server-side too
  logHistory(c, getOperator(STATE.operatorId), 'restored', 'Restored from recycle bin');
  showToast(`${c.id} restored.`, 'success');
  render();
}

// Permanent delete (the second confirm) — destroys the case for good.
function handlePurgeCase(id) {
  const c = caseById(id);
  if (!c) return;
  showModal(`
    <h3>Permanently delete ${escapeHtml(c.id)}?</h3>
    <div class="modal-sub">${escapeHtml(c.subject)}</div>
    <div class="muted tiny" style="margin-top:8px"><strong>This cannot be undone.</strong> The case and its history are removed for good.</div>
    <div class="modal-actions">
      <button class="btn" data-modal-cancel>Keep in bin</button>
      <button class="btn btn-danger" data-modal-submit>Delete forever</button>
    </div>
  `, () => {
    purgeCases([id]);
    showToast(`${id} permanently deleted.`, 'warn');
    render();
    return true;
  });
}

// Hard-remove cases from state (and, in live mode, from data.js on the server).
function purgeCases(ids) {
  const set = new Set(ids);
  STATE.cases = STATE.cases.filter(c => !set.has(c.id));
  if (STATE._savedSnapshot) for (const id of ids) delete STATE._savedSnapshot[id];
  purgeCasesOnServer(ids);
}

// Tell the local server to drop these case ids from data.js (live mode only).
function purgeCasesOnServer(ids) {
  if (!window.__LIVE__ || !/^https?:$/.test(location.protocol) || !ids.length) return;
  setSaveStatus('saving', 'Deleting…');
  try {
    fetch(apiUrl('api/save'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purgeIds: ids }),
    }).then(r => setSaveStatus(r.ok ? 'saved' : 'error')).catch(() => setSaveStatus('error'));
  } catch (e) { setSaveStatus('error'); }
}

// Auto-purge bin entries older than 7 days. Returns true if anything was purged.
function purgeExpiredBin() {
  const expired = STATE.cases.filter(binExpired).map(c => c.id);
  if (!expired.length) return false;
  purgeCases(expired);
  return true;
}

/* ---------- Shifts ---------- */

function shiftStats(shiftName) {
  const opIds = window.SHIFTS.find(s => s.name === shiftName)?.operatorIds || [];
  const open = STATE.cases.filter(c => !c.deletedAt && !['closed', 'cancelled'].includes(c.status));
  const handedTo = open.filter(c => c.handover?.to === shiftName);
  const handedFrom = open.filter(c => c.handover?.from === shiftName);
  const writtenByShift = open.filter(c => c.handover && opIds.includes(c.handover.author));
  const missingForShift = open.filter(c => c.status !== 'new' && (!c.handover || c.handover.to !== shiftName));
  return { handedTo, handedFrom, writtenByShift, missingForShift, opIds };
}

/* ---------- Roster editor (Shifts page) ---------- */

// Unique operator id suggested from a name (prefers initials in parentheses, e.g.
// "Sam (SA)" -> op-sa), unique against the current operators.
function makeOpId(name, exceptIndex) {
  const paren = (String(name).match(/\(([^)]+)\)/) || [])[1];
  const base = (paren || name || 'op').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12) || 'op';
  const want = 'op-' + base;
  const taken = new Set(window.OPERATORS.filter((_, i) => i !== exceptIndex).map(o => o.id));
  if (!taken.has(want)) return want;
  let n = 2; while (taken.has(want + n)) n++;
  return want + n;
}

// Keep each shift's operatorIds derived from operators' shift assignment.
function syncShiftRosters() {
  window.SHIFTS.forEach(s => {
    s.operatorIds = window.OPERATORS.filter(o => o.shift === s.name).map(o => o.id);
  });
}

// How many records would be orphaned if this operator id were removed.
function operatorRefCounts(id) {
  let created = 0, history = 0, handover = 0;
  for (const c of STATE.cases) {
    if (c.createdBy === id) created++;
    if (c.handover && c.handover.author === id) handover++;
    for (const h of (c.history || [])) if (h.who === id) history++;
  }
  return { created, history, handover, total: created + history + handover };
}

function rosterSnippet() {
  const q = s => "'" + String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  const ops = window.OPERATORS.map(o => `  { id: ${q(o.id)}, name: ${q(o.name)}, shift: ${q(o.shift)} },`).join('\n');
  const shifts = window.SHIFTS.map(s => {
    const roster = window.OPERATORS.filter(o => o.shift === s.name).map(o => q(o.id));
    return `  { name: ${q(s.name)}, hoursUtc: ${q(s.hoursUtc)}, operatorIds: [${roster.join(', ')}] },`;
  }).join('\n');
  const cur = window.OPERATORS.some(o => o.id === window.CURRENT_OPERATOR_ID)
    ? window.CURRENT_OPERATOR_ID : (window.OPERATORS[0] && window.OPERATORS[0].id) || '';
  const rotaToBlock = (rotaArr) => normalizeRota(rotaArr).map(r => {
    const inner = Object.entries(r.shifts)
      .map(([name, ids]) => `${q(name)}: [${ids.map(q).join(', ')}]`)
      .join(', ');
    return `    { day: ${q(r.day)}, shifts: { ${inner} } },`;
  }).join('\n');
  const curId = window.CURRENT_WEEK?.id;
  const rotaBlock = rotaToBlock(curId ? rotaForWeek(curId) : window.ROTA).replace(/^    /gm, '  ');
  const weekIds = editableWeekIds();
  const rotaByWeek = weekIds.map(id => {
    const body = rotaToBlock(rotaForWeek(id));
    return `  ${q(id)}: [\n${body}\n  ],`;
  }).join('\n');
  return `window.OPERATORS = [\n${ops}\n];\n\nwindow.SHIFTS = [\n${shifts}\n];\n\nwindow.CURRENT_OPERATOR_ID = ${q(cur)};\n\nwindow.ROTA = [\n${rotaBlock}\n];\n\nwindow.ROTA_BY_WEEK = {\n${rotaByWeek}\n};`;
}

function rosterWarnings() {
  const w = [];
  const ids = window.OPERATORS.map(o => o.id);
  [...new Set(ids.filter((id, i) => id && ids.indexOf(id) !== i))].forEach(id => w.push({ err: 1, msg: `Duplicate operator ID: ${id}` }));
  window.OPERATORS.forEach(o => {
    if (!String(o.name).trim()) w.push({ err: 1, msg: 'An operator is missing a name.' });
    if (!window.SHIFTS.some(s => s.name === o.shift)) w.push({ err: 1, msg: `Operator "${o.name || o.id}" is on a shift that doesn't exist.` });
  });
  const sn = window.SHIFTS.map(s => s.name);
  [...new Set(sn.filter((n, i) => n && sn.indexOf(n) !== i))].forEach(n => w.push({ err: 1, msg: `Duplicate shift name: ${n}` }));
  window.SHIFTS.forEach(s => { if (s.name && !window.OPERATORS.some(o => o.shift === s.name)) w.push({ err: 0, msg: `Shift "${s.name}" has no operators.` }); });
  return w;
}

function renderRosterEditor() {
  const shiftRows = window.SHIFTS.map((s, i) => `
    <tr data-si="${i}">
      <td><input data-sf="name" value="${escapeHtml(s.name)}" placeholder="Day"></td>
      <td><input data-sf="hoursUtc" value="${escapeHtml(s.hoursUtc)}" placeholder="08:00 – 20:00 UTC"></td>
      <td class="re-x"><button class="btn-ghost re-del-shift" data-si="${i}" title="Remove shift">✕</button></td>
    </tr>`).join('');
  const shiftOpts = window.SHIFTS.map(s => s.name);
  const opRows = window.OPERATORS.map((o, i) => {
    const refs = operatorRefCounts(o.id);
    const sel = shiftOpts.map(n => `<option value="${escapeHtml(n)}"${n === o.shift ? ' selected' : ''}>${escapeHtml(n)}</option>`).join('')
      + (shiftOpts.includes(o.shift) ? '' : `<option selected value="${escapeHtml(o.shift)}">${escapeHtml(o.shift)} (missing)</option>`);
    return `
    <tr data-oi="${i}">
      <td><input data-of="name" value="${escapeHtml(o.name)}" placeholder="Sam (SA)"></td>
      <td><select data-of="shift">${sel}</select></td>
      <td><input class="re-mono" data-of="id" value="${escapeHtml(o.id)}" placeholder="op-…"></td>
      <td class="re-refs tiny ${refs.total ? '' : 'muted'}" title="cases created · history entries · handover notes referencing this operator">${refs.total ? refs.total + ' ref' + (refs.total === 1 ? '' : 's') : '—'}</td>
      <td class="re-x"><button class="btn-ghost re-del-op" data-oi="${i}" title="Remove operator">✕</button></td>
    </tr>`;
  }).join('');
  const curOpts = window.OPERATORS.map(o => `<option value="${escapeHtml(o.id)}"${o.id === window.CURRENT_OPERATOR_ID ? ' selected' : ''}>${escapeHtml(o.name)} — ${escapeHtml(o.shift)}</option>`).join('');
  const warns = rosterWarnings();
  const warnHtml = warns.length
    ? `<ul class="re-warn">${warns.map(x => `<li class="${x.err ? 'err' : ''}">${x.err ? '✗' : '⚠'} ${escapeHtml(x.msg)}</li>`).join('')}</ul>`
    : `<div class="re-ok">✓ ${window.OPERATORS.length} operator(s) across ${window.SHIFTS.length} shift(s).</div>`;

  return `
  <div class="card roster-editor" id="roster-editor">
    <div class="card-header">
      <span>Edit shifts &amp; operators</span>
      <span class="muted tiny">Session only · paste the snippet into <code>shifts.js</code> to keep changes · "Reset to seed" undoes them</span>
    </div>
    <div class="card-body">
      <div class="detail-section">
        <h3>Shifts</h3>
        <table class="re-table"><thead><tr><th>Shift</th><th>Hours (UTC)</th><th class="re-x"></th></tr></thead><tbody>${shiftRows}</tbody></table>
        <div class="re-actions"><button class="btn" id="re-add-shift">+ Add shift</button></div>
      </div>

      <div class="detail-section">
        <h3>Operators</h3>
        <table class="re-table"><thead><tr><th>Name</th><th>Shift</th><th>ID</th><th>Refs</th><th class="re-x"></th></tr></thead><tbody>${opRows}</tbody></table>
        <div class="re-actions">
          <button class="btn" id="re-add-op">+ Add operator</button>
          <span class="muted tiny" style="margin-left:auto">Default operator ("you")</span>
          <select id="re-current" class="re-select">${curOpts}</select>
        </div>
      </div>

      ${warnHtml}

      <div class="detail-section" style="margin-bottom:0">
        <div class="re-out-head">
          <h3 style="margin:0">Snippet for <code>shifts.js</code></h3>
          <div>${/^https?:$/.test(location.protocol) ? '<button class="btn btn-primary" id="re-save">Save to shifts.js</button> ' : ''}<button class="btn" id="re-copy">Copy</button><span class="re-copied" id="re-copied">Copied ✓</span></div>
        </div>
        <textarea class="re-output" id="roster-output" readonly spellcheck="false">${escapeHtml(rosterSnippet())}</textarea>
      </div>
    </div>
  </div>`;
}

// Foolproof operator removal: never delete the last operator; reassign or knowingly
// orphan any records that reference the operator; move the "default operator" if needed.
function deleteOperator(i) {
  const o = window.OPERATORS[i];
  if (!o) return;
  if (window.OPERATORS.length <= 1) { showToast('At least one operator is required.', 'warn'); return; }

  const refs = operatorRefCounts(o.id);
  const isDefault = window.CURRENT_OPERATOR_ID === o.id || STATE.operatorId === o.id;
  const others = window.OPERATORS.filter((_, j) => j !== i);
  const reassignOpts = others.map(x => `<option value="${escapeHtml(x.id)}">${escapeHtml(x.name || x.id)} (${escapeHtml(x.shift)})</option>`).join('');
  const refBox = refs.total
    ? `<div class="re-refbox"><strong>${escapeHtml(o.name || o.id)}</strong> is referenced by:
         <ul><li>${refs.created} case(s) created</li><li>${refs.history} history entr${refs.history === 1 ? 'y' : 'ies'}</li><li>${refs.handover} active handover note(s)</li></ul></div>`
    : '<div class="muted tiny">No cases reference this operator — safe to remove.</div>';

  showModal(`
    <h3>Delete operator “${escapeHtml(o.name || o.id)}”?</h3>
    <div class="modal-sub mono tiny">${escapeHtml(o.id)}${isDefault ? ' · current default operator' : ''}</div>
    ${refBox}
    ${refs.total ? `
      <div class="re-modesel">
        <div style="font-weight:600;margin:10px 0 4px">What happens to those records?</div>
        <label class="re-radio"><input type="radio" name="re-mode" value="reassign" checked> <span>Reassign them to another operator <span class="muted">(recommended — no broken references)</span></span></label>
        <select data-field="to">${reassignOpts}</select>
        <label class="re-radio"><input type="radio" name="re-mode" value="orphan"> <span>Delete anyway <span class="muted">— leaves records pointing at the removed ID</span></span></label>
      </div>
    ` : `<input type="hidden" data-field="to" value="${escapeHtml(others[0].id)}">`}
    ${isDefault ? '<div class="muted tiny" style="margin-top:8px">The default operator will move to the reassignment target (or the first remaining operator).</div>' : ''}
    <div class="modal-actions">
      <button class="btn" data-modal-cancel>Cancel</button>
      <button class="btn btn-danger" data-modal-submit>Delete operator</button>
    </div>`,
    (m) => {
      const modeEl = m.querySelector('input[name="re-mode"]:checked');
      const mode = modeEl ? modeEl.value : 'reassign';
      const toField = m.querySelector('[data-field="to"]');
      const toId = toField ? toField.value : others[0].id;
      const reassign = refs.total > 0 && mode === 'reassign';
      if (reassign) {
        for (const c of STATE.cases) {
          if (c.createdBy === o.id) c.createdBy = toId;
          if (c.handover && c.handover.author === o.id) c.handover.author = toId;
          for (const h of (c.history || [])) if (h.who === o.id) h.who = toId;
        }
      }
      const idx = window.OPERATORS.findIndex(x => x.id === o.id);
      window.OPERATORS.splice(idx, 1);
      const fallback = reassign ? toId : window.OPERATORS[0].id;
      if (window.CURRENT_OPERATOR_ID === o.id) window.CURRENT_OPERATOR_ID = fallback;
      if (STATE.operatorId === o.id) STATE.operatorId = fallback;
      syncShiftRosters();
      showToast(
        `Operator removed${refs.total ? (reassign ? `; records reassigned to ${getOperator(toId)?.name || toId}` : '; references left pointing at the old ID') : ''}.`,
        refs.total && !reassign ? 'warn' : 'success'
      );
      render();
      return true;
    });
}

function deleteShift(i) {
  const s = window.SHIFTS[i];
  if (!s) return;
  if (window.SHIFTS.length <= 1) { showToast('At least one shift is required.', 'warn'); return; }
  const members = window.OPERATORS.filter(o => o.shift === s.name);
  if (members.length === 0) {
    showModal(`<h3>Delete shift “${escapeHtml(s.name)}”?</h3>
      <div class="modal-sub">No operators are on this shift.</div>
      <div class="modal-actions"><button class="btn" data-modal-cancel>Cancel</button><button class="btn btn-danger" data-modal-submit>Delete shift</button></div>`,
      () => {
        window.SHIFTS.splice(window.SHIFTS.findIndex(x => x === s), 1);
        syncShiftRosters(); showToast('Shift deleted.', 'info'); render(); return true;
      });
    return;
  }
  const opts = window.SHIFTS.filter((_, j) => j !== i).map(o => `<option value="${escapeHtml(o.name)}">${escapeHtml(o.name)}</option>`).join('');
  showModal(`<h3>Delete shift “${escapeHtml(s.name)}”?</h3>
    <div class="modal-sub">${members.length} operator(s) are on this shift; move them first.</div>
    <label>Reassign operators to</label>
    <select data-field="to">${opts}</select>
    <div class="modal-actions"><button class="btn" data-modal-cancel>Cancel</button><button class="btn btn-danger" data-modal-submit>Reassign &amp; delete</button></div>`,
    (m) => {
      const to = m.querySelector('[data-field="to"]').value;
      members.forEach(o => { o.shift = to; });
      window.SHIFTS.splice(window.SHIFTS.findIndex(x => x === s), 1);
      syncShiftRosters(); showToast(`Shift deleted; ${members.length} operator(s) moved to ${to}.`, 'success'); render(); return true;
    });
}

/* ---------- This week's rota — drag/drop & save wiring ---------- */
function bindRotaEditor() {
  const ed = document.getElementById('rota-editor');
  if (!ed) return;
  let dragOpId = null;
  let dragFromDay = -1;
  let dragFromShift = null;

  // Start drag from either the palette or an already-assigned chip in a cell.
  ed.querySelectorAll('[data-rota-drag]').forEach(el => {
    el.addEventListener('dragstart', e => {
      dragOpId = el.dataset.rotaDrag;
      dragFromDay = el.dataset.rotaFromDay !== undefined ? +el.dataset.rotaFromDay : -1;
      dragFromShift = el.dataset.rotaFromShift || null;
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragOpId); } catch (_) {}
      el.classList.add('rota-dragging');
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('rota-dragging');
      ed.querySelectorAll('.rota-cell.rota-over').forEach(c => c.classList.remove('rota-over'));
      dragOpId = null; dragFromDay = -1; dragFromShift = null;
    });
  });

  // Cells accept drops. The dropped operator is added to the target (no duplicates);
  // if it came from another cell, it's removed from the source.
  ed.querySelectorAll('.rota-cell').forEach(cell => {
    cell.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      cell.classList.add('rota-over');
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('rota-over'));
    cell.addEventListener('drop', e => {
      e.preventDefault();
      cell.classList.remove('rota-over');
      const dayIdx = +cell.dataset.rotaDropDay;
      const shiftName = cell.dataset.rotaDropShift;
      const opId = dragOpId || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
      if (!opId || isNaN(dayIdx) || !shiftName) return;
      const rota = rotaForWeek(editingWeekId());
      if (!rota[dayIdx] || !rota[dayIdx].shifts[shiftName]) return;
      // Same cell → no-op.
      if (dragFromDay === dayIdx && dragFromShift === shiftName) return;
      // Remove from source (if any).
      if (dragFromDay >= 0 && dragFromShift && rota[dragFromDay] && rota[dragFromDay].shifts[dragFromShift]) {
        rota[dragFromDay].shifts[dragFromShift] =
          rota[dragFromDay].shifts[dragFromShift].filter(id => id !== opId);
      }
      // Add to target (skip duplicates).
      const arr = rota[dayIdx].shifts[shiftName];
      if (!arr.includes(opId)) arr.push(opId);
      render();
    });
  });

  // Per-chip remove (✕) button.
  ed.querySelectorAll('[data-rota-remove-op]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const dayIdx = +btn.dataset.rotaRemoveDay;
      const shiftName = btn.dataset.rotaRemoveShift;
      const opId = btn.dataset.rotaRemoveOp;
      const rota = rotaForWeek(editingWeekId());
      const cell = rota[dayIdx] && rota[dayIdx].shifts[shiftName];
      if (!cell) return;
      rota[dayIdx].shifts[shiftName] = cell.filter(id => id !== opId);
      render();
    });
  });

  // Week-picker tabs.
  ed.querySelectorAll('[data-rota-week-id]').forEach(tab => {
    tab.addEventListener('click', e => {
      e.preventDefault();
      STATE.editingRotaWeekId = tab.dataset.rotaWeekId;
      render();
    });
  });

  document.getElementById('rota-save')?.addEventListener('click', () => {
    // Snapshot the current rotaByWeek as the new "seed" so the editor reports "Saved";
    // persist via the shared saveState() (localStorage + server when running on http(s)).
    SEED_ROSTER.rota = structuredClone(window.ROTA || []);
    SEED_ROSTER.rotaByWeek = structuredClone(window.ROTA_BY_WEEK || {});
    saveState();
    // Refresh the shifts.js snippet so a copy/paste captures every week.
    const ta = document.getElementById('roster-output');
    if (ta) ta.value = rosterSnippet();
    if (/^https?:$/.test(location.protocol)) saveJsFile('shifts', rosterSnippet(), 'shifts.js');
    showToast('Rota saved.', 'success');
    render();
  });

  document.getElementById('rota-reset')?.addEventListener('click', () => {
    window.ROTA = structuredClone(SEED_ROSTER.rota || []);
    window.ROTA_BY_WEEK = structuredClone(SEED_ROSTER.rotaByWeek || {});
    const cur = window.CURRENT_WEEK?.id;
    if (cur) window.ROTA_BY_WEEK[cur] = window.ROTA;
    render();
  });
}

function bindRosterEditor() {
  const ed = document.getElementById('roster-editor');
  if (!ed) return;
  const refreshOutput = () => { const ta = document.getElementById('roster-output'); if (ta) ta.value = rosterSnippet(); };

  // Text inputs update the live roster but DON'T re-render (so typing keeps focus).
  ed.querySelectorAll('input[data-sf]').forEach(inp => inp.addEventListener('input', () => {
    const i = +inp.closest('tr').dataset.si, f = inp.dataset.sf;
    if (f === 'name') {
      const old = window.SHIFTS[i].name;
      window.SHIFTS[i].name = inp.value;
      window.OPERATORS.forEach(o => { if (o.shift === old) o.shift = inp.value; });
      syncShiftRosters();
    } else {
      window.SHIFTS[i][f] = inp.value;
    }
    refreshOutput();
  }));
  ed.querySelectorAll('input[data-of]').forEach(inp => inp.addEventListener('input', () => {
    const tr = inp.closest('tr');
    const i = +tr.dataset.oi, f = inp.dataset.of, o = window.OPERATORS[i];
    if (f === 'name') {
      o.name = inp.value;
      // Auto-suggest the id from the name until the user edits the id directly.
      if (!o._idEdited) {
        o.id = o.name.trim() ? makeOpId(o.name, i) : '';
        const idInput = tr.querySelector('input[data-of="id"]');
        if (idInput) idInput.value = o.id;
      }
    } else if (f === 'id') {
      o.id = inp.value;
      o._idEdited = true;
    } else {
      o[f] = inp.value;
    }
    refreshOutput();
  }));
  ed.querySelectorAll('select[data-of="shift"]').forEach(sel => sel.addEventListener('change', () => {
    const i = +sel.closest('tr').dataset.oi;
    window.OPERATORS[i].shift = sel.value;
    syncShiftRosters();
    refreshOutput();
  }));
  document.getElementById('re-current')?.addEventListener('change', e => { window.CURRENT_OPERATOR_ID = e.target.value; refreshOutput(); });
  document.getElementById('re-add-shift')?.addEventListener('click', () => { window.SHIFTS.push({ name: '', hoursUtc: '', operatorIds: [] }); render(); });
  document.getElementById('re-add-op')?.addEventListener('click', () => {
    // id starts blank and auto-derives from the name as you type (until edited directly).
    window.OPERATORS.push({ id: '', name: '', shift: window.SHIFTS[0] ? window.SHIFTS[0].name : '', _idEdited: false });
    syncShiftRosters(); render();
  });
  ed.querySelectorAll('.re-del-shift').forEach(btn => btn.addEventListener('click', () => deleteShift(+btn.dataset.si)));
  ed.querySelectorAll('.re-del-op').forEach(btn => btn.addEventListener('click', () => deleteOperator(+btn.dataset.oi)));
  document.getElementById('re-save')?.addEventListener('click', () => saveJsFile('shifts', rosterSnippet(), 'shifts.js'));
  document.getElementById('re-copy')?.addEventListener('click', async () => {
    const ta = document.getElementById('roster-output');
    try { await navigator.clipboard.writeText(ta.value); }
    catch (_) { ta.removeAttribute('readonly'); ta.select(); document.execCommand('copy'); ta.setAttribute('readonly', ''); }
    const c = document.getElementById('re-copied'); if (c) { c.classList.add('show'); setTimeout(() => c.classList.remove('show'), 1200); }
  });
}

/* ---------- Owners editor (Owners page) ---------- */

function makeOwnerId(pool, name, exceptIndex) {
  // Drop boilerplate words so "Core Team — LATAM desk" -> core-latam, "HQ Identity Team" -> hq-identity.
  const cleaned = String(name || '').toLowerCase().replace(/\b(core|core|hq|desk|team|product|the)\b/g, ' ');
  // Core Team desks (pool 'core') slug under the 'core-' prefix; HQ teams stay 'hq-'.
  const prefix = pool === 'core' ? 'core' : pool;
  const base = cleaned.replace(/[^a-z0-9]+/g, '').slice(0, 14) || prefix;
  const want = prefix + '-' + base;
  const taken = new Set(window.OWNERS[pool].filter((_, i) => i !== exceptIndex).map(o => o.id));
  if (!taken.has(want)) return want;
  let n = 2; while (taken.has(want + n)) n++;
  return want + n;
}

function ownerRefCounts(pool, id) {
  const field = pool === 'core' ? 'coreId' : 'hqId';
  let n = 0;
  for (const c of STATE.cases) if (c[field] === id) n++;
  return n;
}

function ownersSnippet() {
  const q = s => "'" + String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  const renderMembers = (members) => {
    if (!Array.isArray(members) || !members.length) return '';
    const inner = members.map(m =>
      `        { id: ${q(m.id)}, name: ${q(m.name)}, role: ${q(m.role || '')} }`).join(',\n');
    return `,\n      members: [\n${inner},\n      ]`;
  };
  const core = window.OWNERS.core.map(o =>
    `    { id: ${q(o.id)}, name: ${q(o.name)}, region: ${q(o.region || '')}, tz: ${q(o.tz || '')}, office: ${q(o.office || '')}, channel: ${q(o.channel || '')}${renderMembers(o.members)} },`).join('\n');
  const hq = window.OWNERS.hq.map(o =>
    `    { id: ${q(o.id)}, name: ${q(o.name)}, area: ${q(o.area || '')}, tz: ${q(o.tz || '')}, office: ${q(o.office || '')}, channel: ${q(o.channel || '')}${renderMembers(o.members)} },`).join('\n');
  return `window.OWNERS = {\n  core: [\n${core}\n  ],\n  hq: [\n${hq}\n  ],\n};`;
}

function ownersWarnings() {
  const w = [];
  ['core', 'hq'].forEach(pool => {
    const ids = window.OWNERS[pool].map(o => o.id);
    [...new Set(ids.filter((id, i) => id && ids.indexOf(id) !== i))].forEach(id => w.push({ err: 1, msg: `Duplicate ${pool.toUpperCase()} id: ${id}` }));
    window.OWNERS[pool].forEach(o => {
      if (!String(o.name).trim()) w.push({ err: 1, msg: `A ${pool.toUpperCase()} owner is missing a name.` });
      if (!String(o.id).trim()) w.push({ err: 1, msg: `A ${pool.toUpperCase()} owner is missing an id.` });
    });
  });
  return w;
}

function renderOwnerRows(pool) {
  const key = pool === 'core' ? 'region' : 'area';
  return window.OWNERS[pool].map((o, i) => {
    const refs = ownerRefCounts(pool, o.id);
    return `
    <tr data-pool="${pool}" data-oi="${i}">
      <td><input data-of="name" value="${escapeHtml(o.name || '')}" placeholder="${pool === 'core' ? 'Core Team — … desk' : 'HQ … Team'}"></td>
      <td><input data-of="${key}" value="${escapeHtml(o[key] || '')}" placeholder="${pool === 'core' ? 'Region' : 'Area'}"></td>
      <td><input data-of="tz" value="${escapeHtml(o.tz || '')}" placeholder="America/Phoenix"></td>
      <td><input data-of="office" value="${escapeHtml(o.office || '')}" placeholder="08:00–17:00"></td>
      <td><input data-of="channel" value="${escapeHtml(o.channel || '')}" placeholder="Slack / JIRA"></td>
      <td><input class="re-mono" data-of="id" value="${escapeHtml(o.id || '')}" placeholder="${pool === 'core' ? 'core' : pool}-…"></td>
      <td class="re-refs tiny ${refs ? '' : 'muted'}" title="cases routed to this owner">${refs ? refs + ' ref' + (refs === 1 ? '' : 's') : '—'}</td>
      <td class="re-x"><button class="btn-ghost re-del-owner" data-pool="${pool}" data-oi="${i}" title="Remove">✕</button></td>
    </tr>`;
  }).join('');
}

function renderOwnersTable(pool, label, regionLabel) {
  return `
    <div class="detail-section">
      <h3>${escapeHtml(label)}</h3>
      <div class="re-scroll"><table class="re-table"><thead><tr>
        <th>Name</th><th>${escapeHtml(regionLabel)}</th><th>Time zone</th><th>Office</th><th>Channel</th><th>ID</th><th>Refs</th><th class="re-x"></th>
      </tr></thead><tbody>${renderOwnerRows(pool)}</tbody></table></div>
      <div class="re-actions"><button class="btn" data-add-owner="${pool}">+ Add ${pool === 'core' ? 'Core Team desk' : 'HQ team'}</button></div>
    </div>`;
}

function renderTeamMembersEditor(pool, heading) {
  const cards = window.OWNERS[pool].map((team, ti) => {
    const members = Array.isArray(team.members) ? team.members : (team.members = []);
    const rows = members.map((m, mi) => `
        <div class="team-member-row" data-pool="${pool}" data-ti="${ti}" data-mi="${mi}">
          <input data-mf="name" value="${escapeHtml(m.name || '')}" placeholder="Member name">
          <input data-mf="role" value="${escapeHtml(m.role || '')}" placeholder="Role (Lead / Engineer / …)">
          <input class="re-mono" data-mf="id" value="${escapeHtml(m.id || '')}" placeholder="${escapeHtml(team.id || pool)}-mem">
          <button class="btn-ghost re-del-member" data-pool="${pool}" data-ti="${ti}" data-mi="${mi}" title="Remove member">✕</button>
        </div>`).join('');
    return `
      <div class="team-card">
        <div class="team-card-head">
          <strong>${escapeHtml(team.name)}</strong>
          <span class="muted tiny">${escapeHtml(team[pool === 'core' ? 'region' : 'area'] || '')}</span>
        </div>
        <div class="team-members">${rows || '<div class="muted tiny">No members yet.</div>'}</div>
        <div class="team-card-foot">
          <button class="btn" data-add-member data-pool="${pool}" data-ti="${ti}">+ Add member</button>
        </div>
      </div>`;
  }).join('');
  return `
    <div class="detail-section">
      <h3>${escapeHtml(heading)}</h3>
      <div class="team-grid">${cards}</div>
    </div>`;
}

function renderOwnersPage() {
  const warns = ownersWarnings();
  const warnHtml = warns.length
    ? `<ul class="re-warn">${warns.map(x => `<li class="${x.err ? 'err' : ''}">${x.err ? '✗' : '⚠'} ${escapeHtml(x.msg)}</li>`).join('')}</ul>`
    : `<div class="re-ok">✓ ${window.OWNERS.core.length} Core Team desk(s) · ${window.OWNERS.hq.length} HQ team(s).</div>`;
  return `
    <div class="page-header"><div>
      <h1>Owners</h1>
      <div class="subtitle">Core Team desks and HQ Product Teams that cases are routed to. Session edits; paste the snippet into <code>owners.js</code> to keep them. "Reset to seed" undoes them.</div>
    </div></div>
    <div class="card roster-editor" id="owners-editor">
      <div class="card-header"><span>Edit Core Team desks &amp; HQ teams</span></div>
      <div class="card-body">
        ${renderOwnersTable('core', 'Core Team desks', 'Region')}
        ${renderOwnersTable('hq', 'HQ Product Teams', 'Area')}
        ${renderTeamMembersEditor('core', 'Core Team members')}
        ${renderTeamMembersEditor('hq', 'HQ team members')}
        ${warnHtml}
        <div class="detail-section" style="margin-bottom:0">
          <div class="re-out-head"><h3 style="margin:0">Snippet for <code>owners.js</code></h3>
            <div>${/^https?:$/.test(location.protocol) ? '<button class="btn btn-primary" id="owners-save">Save to owners.js</button> ' : ''}<button class="btn" id="owners-copy">Copy</button><span class="re-copied" id="owners-copied">Copied ✓</span></div></div>
          <textarea class="re-output" id="owners-output" readonly spellcheck="false">${escapeHtml(ownersSnippet())}</textarea>
        </div>
      </div>
    </div>`;
}

// Foolproof delete: reassign the cases routed to this owner, or knowingly orphan them.
function deleteOwner(pool, i) {
  const o = window.OWNERS[pool][i];
  if (!o) return;
  const field = pool === 'core' ? 'coreId' : 'hqId';
  const kind = pool === 'core' ? 'Core Team desk' : 'HQ team';
  const refs = ownerRefCounts(pool, o.id);
  const others = window.OWNERS[pool].filter((_, j) => j !== i);
  const opts = others.map(x => `<option value="${escapeHtml(x.id)}">${escapeHtml(x.name || x.id)}</option>`).join('');
  const refBox = refs
    ? `<div class="re-refbox"><strong>${escapeHtml(o.name || o.id)}</strong> is routed ${refs} case${refs === 1 ? '' : 's'}.</div>`
    : '<div class="muted tiny">No cases are routed to this owner — safe to remove.</div>';
  showModal(`
    <h3>Delete ${kind} “${escapeHtml(o.name || o.id)}”?</h3>
    <div class="modal-sub mono tiny">${escapeHtml(o.id)}</div>
    ${refBox}
    ${refs ? (others.length ? `
      <div class="re-modesel">
        <div style="font-weight:600;margin:10px 0 4px">What about those cases?</div>
        <label class="re-radio"><input type="radio" name="own-mode" value="reassign" checked> <span>Reassign them to another ${kind}</span></label>
        <select data-field="to">${opts}</select>
        <label class="re-radio"><input type="radio" name="own-mode" value="orphan"> <span>Delete anyway <span class="muted">— those cases lose their ${pool.toUpperCase()} owner</span></span></label>
      </div>` : `<div class="muted tiny" style="margin-top:8px">No other ${kind} to reassign to — those cases will lose their ${pool.toUpperCase()} owner.</div>`) : ''}
    <div class="modal-actions"><button class="btn" data-modal-cancel>Cancel</button><button class="btn btn-danger" data-modal-submit>Delete</button></div>`,
    (m) => {
      const modeEl = m.querySelector('input[name="own-mode"]:checked');
      const mode = modeEl ? modeEl.value : 'orphan';
      const toEl = m.querySelector('[data-field="to"]');
      if (refs && mode === 'reassign' && toEl) {
        const toId = toEl.value;
        for (const c of STATE.cases) if (c[field] === o.id) c[field] = toId;
      } else if (refs) {
        for (const c of STATE.cases) if (c[field] === o.id) c[field] = null;
      }
      const idx = window.OWNERS[pool].indexOf(o);
      if (idx >= 0) window.OWNERS[pool].splice(idx, 1);
      showToast(`Removed ${o.name || o.id}.`, (refs && mode !== 'reassign') ? 'warn' : 'success');
      render();
      return true;
    });
}

function bindOwnersEditor() {
  const ed = document.getElementById('owners-editor');
  if (!ed) return;
  const refresh = () => { const ta = document.getElementById('owners-output'); if (ta) ta.value = ownersSnippet(); };
  ed.querySelectorAll('input[data-of]').forEach(inp => inp.addEventListener('input', () => {
    const tr = inp.closest('tr');
    const pool = tr.dataset.pool, i = +tr.dataset.oi, f = inp.dataset.of, o = window.OWNERS[pool][i];
    if (f === 'name') {
      o.name = inp.value;
      if (!o._idEdited) { o.id = o.name.trim() ? makeOwnerId(pool, o.name, i) : ''; const idIn = tr.querySelector('input[data-of="id"]'); if (idIn) idIn.value = o.id; }
    } else if (f === 'id') {
      o.id = inp.value; o._idEdited = true;
    } else {
      o[f] = inp.value;
    }
    refresh();
  }));
  ed.querySelectorAll('[data-add-owner]').forEach(btn => btn.addEventListener('click', () => {
    const pool = btn.dataset.addOwner;
    window.OWNERS[pool].push(pool === 'core'
      ? { id: '', name: '', region: '', tz: 'America/Phoenix', office: '08:00–17:00', channel: '', _idEdited: false }
      : { id: '', name: '', area: '', tz: 'Asia/Taipei', office: '09:00–18:00', channel: '', _idEdited: false });
    render();
  }));
  ed.querySelectorAll('.re-del-owner').forEach(btn => btn.addEventListener('click', () => deleteOwner(btn.dataset.pool, +btn.dataset.oi)));

  // Members editor (per Core Team desk and per HQ team).
  ed.querySelectorAll('.team-member-row input[data-mf]').forEach(inp => inp.addEventListener('input', () => {
    const row = inp.closest('.team-member-row');
    const pool = row.dataset.pool, ti = +row.dataset.ti, mi = +row.dataset.mi, f = inp.dataset.mf;
    const team = window.OWNERS[pool][ti];
    if (!Array.isArray(team.members)) team.members = [];
    const m = team.members[mi];
    if (!m) return;
    m[f] = inp.value;
    refresh();
  }));
  ed.querySelectorAll('[data-add-member]').forEach(btn => btn.addEventListener('click', () => {
    const pool = btn.dataset.pool, ti = +btn.dataset.ti;
    const team = window.OWNERS[pool][ti];
    if (!Array.isArray(team.members)) team.members = [];
    // Suggest a unique id based on the team prefix.
    const base = String(team.id || pool) + '-mem';
    const taken = new Set(team.members.map(m => m.id));
    let nextId = base, n = 1;
    while (taken.has(nextId)) { n++; nextId = base + n; }
    team.members.push({ id: nextId, name: '', role: '' });
    render();
  }));
  ed.querySelectorAll('.re-del-member').forEach(btn => btn.addEventListener('click', () => {
    const pool = btn.dataset.pool, ti = +btn.dataset.ti, mi = +btn.dataset.mi;
    const team = window.OWNERS[pool][ti];
    if (!Array.isArray(team.members)) return;
    team.members.splice(mi, 1);
    render();
  }));

  document.getElementById('owners-save')?.addEventListener('click', () => saveJsFile('owners', ownersSnippet(), 'owners.js'));
  document.getElementById('owners-copy')?.addEventListener('click', async () => {
    const ta = document.getElementById('owners-output');
    try { await navigator.clipboard.writeText(ta.value); }
    catch (_) { ta.removeAttribute('readonly'); ta.select(); document.execCommand('copy'); ta.setAttribute('readonly', ''); }
    const c = document.getElementById('owners-copied'); if (c) { c.classList.add('show'); setTimeout(() => c.classList.remove('show'), 1200); }
  });
}

/* ---------- This week's rota (drag-to-assign) ---------- */

// Initials for an operator: take the leading uppercase letters from each word in
// their name, falling back to the first two letters. "Mia (DA)" -> "M", "Alex Lee" -> "AL".
function operatorInitials(op) {
  if (!op) return '–';
  const name = String(op.name || op.id || '').trim();
  // Drop parenthetical suffixes like "(DA)" so they don't dominate the initials.
  const cleaned = name.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (!parts.length) return name.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Stable per-operator color for the avatar chip — a forest-palette ramp.
const _ROTA_COLORS = ['#3e7050', '#2f6147', '#4a8270', '#5a8f6b', '#4e8063', '#6f9b84', '#357a52'];
function operatorColor(op) {
  if (!op) return '#8a958d';
  const idx = (op.id || op.name || '').split('').reduce((s, ch) => s + ch.charCodeAt(0), 0) % _ROTA_COLORS.length;
  return _ROTA_COLORS[idx];
}

// The four week-ids the Shifts page lets the team edit: current + next three.
// Ordered current → future so the tabs read W24 · W25 · W26 · W27.
function editableWeekIds() {
  const all = window.WEEKS || [];
  const cur = all.find(w => w.isCurrent) || all[0];
  if (!cur) return [];
  const sorted = all.slice().sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const i = sorted.findIndex(w => w.id === cur.id);
  return sorted.slice(i, i + 4).map(w => w.id);
}

// Which week the editor is currently displaying. Defaults to the current week.
function editingWeekId() {
  const ids = editableWeekIds();
  if (STATE.editingRotaWeekId && ids.includes(STATE.editingRotaWeekId)) return STATE.editingRotaWeekId;
  return ids[0] || window.CURRENT_WEEK?.id;
}

// Read the rota for a given week, lazily creating one (cloned from the current
// week's rota) if it doesn't exist yet.
function rotaForWeek(weekId) {
  if (!window.ROTA_BY_WEEK) window.ROTA_BY_WEEK = {};
  if (!window.ROTA_BY_WEEK[weekId]) {
    window.ROTA_BY_WEEK[weekId] = structuredClone(window.ROTA || []);
  }
  return window.ROTA_BY_WEEK[weekId];
}

function rotaDirty() {
  const seed = SEED_ROSTER.rotaByWeek || {};
  const live = window.ROTA_BY_WEEK || {};
  for (const id of editableWeekIds()) {
    if (JSON.stringify(seed[id] || []) !== JSON.stringify(live[id] || [])) return true;
  }
  return false;
}

// One-off migration for the older single-operator rota format (`{ day, operatorId }`).
// Returns the rota in the new shape (`{ day, shifts: { [shiftName]: [opId, …] } }`).
// Operates on the given rota array (or window.ROTA when omitted) and returns the
// normalised copy without mutating the source.
function normalizeRota(rotaArr) {
  const rota = Array.isArray(rotaArr) ? rotaArr : (Array.isArray(window.ROTA) ? window.ROTA : []);
  const shifts = (window.SHIFTS || []).map(s => s.name);
  return rota.map(r => {
    const out = { day: r.day, shifts: {} };
    for (const name of shifts) out.shifts[name] = [];
    if (r.shifts && typeof r.shifts === 'object') {
      for (const [k, v] of Object.entries(r.shifts)) {
        if (!shifts.includes(k)) continue;
        out.shifts[k] = Array.isArray(v) ? v.slice() : [];
      }
    } else if (r.operatorId) {
      // Old single-operator format — drop the operator onto the shift they're assigned to.
      const op = getOperator(r.operatorId);
      const target = op && shifts.includes(op.shift) ? op.shift : shifts[0];
      if (target) out.shifts[target] = [r.operatorId];
    }
    return out;
  });
}

function renderRotaEditor() {
  const editIds = editableWeekIds();
  const editId = editingWeekId();
  // Make sure the chosen week's rota is normalised into the shape the renderer
  // and event handlers expect, and persist that normalised copy back.
  window.ROTA_BY_WEEK[editId] = normalizeRota(rotaForWeek(editId));
  // Keep window.ROTA pointing at the current week's rota.
  const curId = window.CURRENT_WEEK?.id;
  if (curId && window.ROTA_BY_WEEK[curId]) window.ROTA = window.ROTA_BY_WEEK[curId];

  const rota = window.ROTA_BY_WEEK[editId];
  const shiftNames = (window.SHIFTS || []).map(s => s.name);

  const renderChip = (op) => `
      <div class="rota-chip" draggable="true" data-rota-drag="${escapeHtml(op.id)}" title="Drag onto a cell below — release to assign ${escapeHtml(op.name)}">
        <span class="rota-avatar" style="background:${operatorColor(op)}">${escapeHtml(operatorInitials(op))}</span>
        <span class="rota-chip-name">${escapeHtml(op.name)}</span>
        <span class="rota-chip-shift muted">${escapeHtml(op.shift)}</span>
      </div>`;

  const palette = window.OPERATORS.map(renderChip).join('')
    || '<span class="muted">No operators defined yet.</span>';

  // Week-picker tabs (current + next 3).
  const tabs = editIds.map(id => {
    const w = (window.WEEKS || []).find(x => x.id === id);
    const label = w ? w.label.split(' · ')[0] : id;
    const sub = w ? w.label.split(' · ').slice(1).join(' · ') : '';
    const isCur = w?.isCurrent;
    const isEditing = id === editId;
    return `
      <button type="button" class="rota-week-tab${isEditing ? ' active' : ''}${isCur ? ' is-current' : ''}"
              data-rota-week-id="${escapeHtml(id)}"
              title="${escapeHtml(w?.label || id)}">
        <span class="rota-week-tab-id">${escapeHtml(label)}${isCur ? ' · this week' : ''}</span>
        ${sub ? `<span class="rota-week-tab-sub">${escapeHtml(sub)}</span>` : ''}
      </button>`;
  }).join('');

  // Header row: an empty label cell, then 7 day labels.
  const headerRow = `
      <div class="rota-corner"></div>
      ${rota.map(r => `<div class="rota-head">${escapeHtml(r.day)}</div>`).join('')}`;

  const renderCell = (dayIdx, shiftName, opIds) => {
    const chips = (opIds || []).map(opId => {
      const op = getOperator(opId);
      if (!op) return '';
      return `
        <div class="rota-assigned" draggable="true"
             data-rota-drag="${escapeHtml(op.id)}"
             data-rota-from-day="${dayIdx}"
             data-rota-from-shift="${escapeHtml(shiftName)}"
             title="${escapeHtml(op.name)} — drag to another cell to move, drag out to remove">
          <span class="rota-avatar" style="background:${operatorColor(op)}">${escapeHtml(operatorInitials(op))}</span>
          <span class="rota-mini-name">${escapeHtml(op.name.replace(/\s*\([^)]*\)\s*/g, '').trim() || op.name)}</span>
          <button class="rota-remove" data-rota-remove-day="${dayIdx}" data-rota-remove-shift="${escapeHtml(shiftName)}" data-rota-remove-op="${escapeHtml(op.id)}" title="Remove">✕</button>
        </div>`;
    }).join('');
    return `
      <div class="rota-cell" data-rota-drop-day="${dayIdx}" data-rota-drop-shift="${escapeHtml(shiftName)}">
        ${chips || '<span class="rota-empty muted">drop here</span>'}
      </div>`;
  };

  const shiftRows = shiftNames.map(shiftName => {
    const cells = rota.map((r, dayIdx) => renderCell(dayIdx, shiftName, r.shifts[shiftName])).join('');
    return `
      <div class="rota-row-label">${escapeHtml(shiftName)}</div>
      ${cells}`;
  }).join('');

  const editingWeek = (window.WEEKS || []).find(w => w.id === editId);
  const headerLabel = editingWeek?.isCurrent
    ? `This week's rota · ${escapeHtml(editingWeek.label)}`
    : `Rota · ${escapeHtml(editingWeek?.label || editId)}`;

  return `
    <div class="card rota-editor" id="rota-editor" data-editing-week="${escapeHtml(editId)}">
      <div class="card-header">
        <span>${headerLabel}</span>
        <span class="muted tiny">Pick a week, drag operators onto a Day or Night cell, then Save</span>
      </div>
      <div class="card-body">
        <div class="rota-week-tabs">${tabs}</div>
        <div class="detail-section">
          <h3>Operators</h3>
          <div class="rota-palette">${palette}</div>
        </div>
        <div class="detail-section">
          <h3>Schedule</h3>
          <div class="rota-grid" style="grid-template-columns: 84px repeat(${rota.length}, 1fr);">
            ${headerRow}
            ${shiftRows}
          </div>
        </div>
        <div class="re-actions">
          <button class="btn btn-primary" id="rota-save" ${rotaDirty() ? '' : 'disabled'}>Save rota</button>
          <button class="btn" id="rota-reset">Reset to seed</button>
          <span class="muted tiny" id="rota-status">${rotaDirty() ? 'Unsaved changes' : 'Saved'}</span>
        </div>
      </div>
    </div>`;
}

function renderShiftsIndex() {
  const cards = window.SHIFTS.map(sh => {
    const s = shiftStats(sh.name);
    const ops = sh.operatorIds.map(id => {
      const o = getOperator(id);
      const isYou = id === STATE.operatorId;
      return `<span class="op ${isYou ? 'is-you' : ''}">${escapeHtml(o.name)}${isYou ? ' (you)' : ''}</span>`;
    }).join('');
    const isCurrent = sh.name === window.CURRENT_SHIFT.name;
    return `
      <a class="shift-card ${isCurrent ? 'is-current' : ''}" href="#/shifts/${encodeURIComponent(sh.name)}">
        <div class="shift-name">${escapeHtml(sh.name)} shift ${isCurrent ? '<span class="badge-current">On now</span>' : ''}</div>
        <div class="shift-hours" title="${escapeHtml(sh.hoursUtc)}">${escapeHtml(fmtShiftHoursLocal(sh.hoursUtc))}</div>
        <div class="roster">${ops}</div>
        <div class="stats">
          <div class="stat"><div class="v">${s.handedTo.length}</div><div class="k">Handed to</div></div>
          <div class="stat"><div class="v">${s.writtenByShift.length}</div><div class="k">Notes by shift</div></div>
          <div class="stat"><div class="v">${s.missingForShift.length}</div><div class="k">Missing for shift</div></div>
        </div>
      </a>
    `;
  }).join('');
  return `
    <div class="page-header">
      <div>
        <h1>Shifts</h1>
        <div class="subtitle">Coverage map for the current week. Click a shift for its handover view and roster.</div>
      </div>
    </div>
    <div class="shift-grid">${cards}</div>
    ${renderRotaEditor()}
    ${renderRosterEditor()}
  `;
}

function renderShiftDetail(shiftName) {
  const sh = window.SHIFTS.find(s => s.name === shiftName);
  if (!sh) {
    return `<div class="page-header"><div><h1>Shift not found</h1></div></div>
      <a class="btn" href="#/shifts">← Back to shifts</a>`;
  }
  const s = shiftStats(shiftName);
  const isCurrent = sh.name === window.CURRENT_SHIFT.name;
  const otherShift = window.SHIFTS.find(o => o.name !== shiftName)?.name || '';
  const tabs = window.SHIFTS.map(o => `<a href="#/shifts/${encodeURIComponent(o.name)}" class="${o.name === shiftName ? 'active' : ''}">${escapeHtml(o.name)} shift</a>`).join('');

  const renderCaseRow = (c) => {
    const status = c.handover
      ? `<span class="note-status ${c.handover.staleForCurrentShift ? 'stale' : 'fresh'}">${escapeHtml(c.handover.from)} → ${escapeHtml(c.handover.to)}${c.handover.staleForCurrentShift ? ' (stale)' : ''}</span>`
      : '<span class="note-status missing">No note</span>';
    return `
      <div class="case-row">
        <div>
          <div class="row-flex">
            <a class="mono" href="#/cases/${c.id}">${c.id}</a>
            <span class="pill pill-${c.status}">${escapeHtml(displayStatus(c))}</span>
          </div>
          <div style="font-weight:500; margin-top:4px;">${escapeHtml(c.subject)}</div>
        </div>
        <div>${status}</div>
        <div class="muted tiny">${c.handover ? fmtRelative(c.handover.at) : '—'}</div>
      </div>
    `;
  };

  // Recent handover activity from history across all open cases.
  const allOpen = STATE.cases.filter(c => !c.deletedAt && !['closed', 'cancelled'].includes(c.status));
  const activity = [];
  for (const c of allOpen) {
    for (const h of (c.history || [])) {
      if (h.kind === 'handover' && sh.operatorIds.includes(h.who)) {
        activity.push({ at: h.at, who: h.who, caseId: c.id, detail: h.detail });
      }
    }
  }
  activity.sort((a, b) => new Date(b.at) - new Date(a.at));
  const activityHtml = activity.slice(0, 10).map(a => `
    <li>
      <span class="when">${fmtAbsolute(a.at)}</span>
      <span><a class="mono" href="#/cases/${a.caseId}">${a.caseId}</a> · <strong>${escapeHtml(getOperator(a.who)?.name || a.who)}</strong> — ${escapeHtml(a.detail || 'wrote handover')}</span>
    </li>
  `).join('') || '<li class="muted">No recent handover activity recorded by this shift.</li>';

  const ops = sh.operatorIds.map(id => {
    const o = getOperator(id);
    const isYou = id === STATE.operatorId;
    const switchBtn = isYou ? '' : `<button class="btn btn-link" data-action="switch-op" data-op-id="${id}">View as ${escapeHtml(o.name)}</button>`;
    return `<div class="kv" style="padding:6px 0;"><span class="v">${escapeHtml(o.name)}${isYou ? ' (you)' : ''}</span><span>${switchBtn}</span></div>`;
  }).join('');

  return `
    <div class="page-header">
      <div>
        <h1>${escapeHtml(sh.name)} shift ${isCurrent ? '<span class="badge-current">On now</span>' : '<span class="flag">Off shift</span>'}</h1>
        <div class="subtitle" title="${escapeHtml(sh.hoursUtc)}">${escapeHtml(fmtShiftHoursLocal(sh.hoursUtc))} · handover boundary with ${escapeHtml(otherShift)} shift</div>
      </div>
      <a class="btn" href="#/shifts">← Shifts</a>
    </div>

    <div class="card"><div class="card-body">
      <div class="tabs">${tabs}</div>

      <div class="summary-bar">
        <div class="stat"><div class="v">${s.handedTo.length}</div><div class="k">Cases handed to ${escapeHtml(sh.name)}</div></div>
        <div class="stat"><div class="v">${s.handedFrom.length}</div><div class="k">Cases handed from ${escapeHtml(sh.name)}</div></div>
        <div class="stat"><div class="v">${s.writtenByShift.length}</div><div class="k">Notes authored by shift</div></div>
        <div class="stat"><div class="v">${s.missingForShift.length}</div><div class="k">Open cases missing a note for ${escapeHtml(sh.name)}</div></div>
      </div>

      <div class="detail-section">
        <h3>Roster</h3>
        <div>${ops || '<div class="muted">No operators on this shift.</div>'}</div>
      </div>

      <div class="detail-section">
        <h3>Cases handed to ${escapeHtml(sh.name)} shift <span class="muted tiny">· ${s.handedTo.length} case${s.handedTo.length === 1 ? '' : 's'}</span></h3>
        <div>${s.handedTo.length === 0 ? '<div class="muted">No fresh handover notes addressed to this shift.</div>' : s.handedTo.map(renderCaseRow).join('')}</div>
      </div>

      <div class="detail-section">
        <h3>Open cases missing a note for ${escapeHtml(sh.name)} shift <span class="muted tiny">· ${s.missingForShift.length} case${s.missingForShift.length === 1 ? '' : 's'}</span></h3>
        <div>${s.missingForShift.length === 0 ? '<div class="muted">All open cases have a current note for this shift.</div>' : s.missingForShift.map(renderCaseRow).join('')}</div>
      </div>

      <div class="detail-section">
        <h3>Recent handover activity</h3>
        <ul class="activity-list" style="padding:0">${activityHtml}</ul>
      </div>
    </div></div>
  `;
}

/* ---------- Status Flow ---------- */

function renderStatusFlow() {
  // Lookup tables that mirror local/casecenter.py — kept in sync by hand. If the Python
  // source changes, update both. The page renders the three tiers map_status() consults,
  // in lookup order, so an operator can predict which column a live refresh will land in.
  const pairMap = [
    { cs: 'In-Progress', sub: 'Return',    to: 'new',                   note: 'Requester returned the case to IT' },
    { cs: 'In-Progress', sub: 'Wait User', to: 'returned_to_requester', note: 'Waiting on the user — SLA paused' },
  ];
  const processTypeMap = [
    { pt: '1st  Line',    to: 'new',       note: 'Triage stage — first-line agent still owns it' },
    { pt: 'Service Team', to: 'with_core', note: 'Routed to the Core Team' },
  ];
  const statusOnlyMap = [
    { cs: 'Open',            to: 'new',       note: 'Just opened in Case Center' },
    { cs: 'In-Progress',     to: 'new',       note: 'No sub-transition, no processType match → default to triage' },
    { cs: 'Wait Resolution', to: 'with_hq',   note: 'Routed to the HQ Product Team' },
    { cs: 'Close',           to: 'closed',    note: 'Terminal' },
    { cs: 'Drop',            to: 'cancelled', note: 'Terminal · no resolution code' },
  ];
  const pill = (s) => `<span class="pill pill-${s}">${escapeHtml(statusLabel(s))}</span>`;
  const mono = (s) => `<code class="mono">${escapeHtml(s)}</code>`;

  return `
    <div class="page-header">
      <div>
        <h1>Status Flow</h1>
        <div class="subtitle">How a case moves through the lifecycle (operator actions) and how Case Center statuses map onto the board (live refresh).</div>
      </div>
    </div>

    <div class="flow-container">
      <svg class="status-flow-svg" viewBox="0 0 980 580" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="arr-forward" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 Z" fill="#4e8063"/>
          </marker>
          <marker id="arr-pause" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 Z" fill="#5a9277"/>
          </marker>
          <marker id="arr-danger" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 Z" fill="#9c5a52"/>
          </marker>
        </defs>

        <g class="flow-node">
          <rect x="40" y="40" width="120" height="60" rx="8" fill="#eef1ee" stroke="#6b756d" stroke-width="2"/>
          <text x="100" y="76" text-anchor="middle" font-weight="600" font-size="13">New</text>
        </g>
        <g class="flow-node">
          <rect x="220" y="40" width="160" height="60" rx="8" fill="#e9f1ea" stroke="#3e7050" stroke-width="2"/>
          <text x="300" y="76" text-anchor="middle" font-weight="600" font-size="13">With Core Team</text>
        </g>
        <g class="flow-node">
          <rect x="440" y="40" width="180" height="60" rx="8" fill="#e3ede7" stroke="#2f6147" stroke-width="2"/>
          <text x="530" y="68" text-anchor="middle" font-weight="600" font-size="13">With HQ</text>
          <text x="530" y="86" text-anchor="middle" font-size="11">Product Team</text>
        </g>
        <g class="flow-node">
          <rect x="680" y="40" width="160" height="60" rx="8" fill="#e0ebe7" stroke="#2a5648" stroke-width="2"/>
          <text x="760" y="76" text-anchor="middle" font-weight="600" font-size="13">Sanity Check</text>
        </g>

        <g class="flow-node">
          <rect x="300" y="250" width="240" height="60" rx="8" fill="#ece4d6" stroke="#97744a" stroke-width="2"/>
          <text x="420" y="278" text-anchor="middle" font-weight="600" font-size="13">Returned to Requester</text>
          <text x="420" y="296" text-anchor="middle" font-size="11" fill="#97744a">SLA clock paused</text>
        </g>

        <g class="flow-node">
          <rect x="680" y="450" width="160" height="60" rx="8" fill="#eef1ee" stroke="#56635b" stroke-width="2"/>
          <text x="760" y="486" text-anchor="middle" font-weight="600" font-size="13">Closed</text>
        </g>

        <g class="flow-node">
          <rect x="40" y="450" width="160" height="60" rx="8" fill="#f1f4f1" stroke="#7c887f" stroke-width="2" stroke-dasharray="4,3"/>
          <text x="120" y="486" text-anchor="middle" font-weight="600" font-size="13" fill="#7c887f">Cancelled</text>
        </g>

        <g stroke="#4e8063" stroke-width="2" fill="none">
          <path d="M160,70 L218,70" marker-end="url(#arr-forward)"/>
          <path d="M380,70 L438,70" marker-end="url(#arr-forward)"/>
          <path d="M620,70 L678,70" marker-end="url(#arr-forward)"/>
          <path d="M760,100 L760,448" marker-end="url(#arr-forward)"/>
        </g>
        <g font-size="11" fill="#4e8063" font-weight="500">
          <text x="189" y="34" text-anchor="middle">Assign Core Team</text>
          <text x="409" y="34" text-anchor="middle">Escalate to HQ</text>
          <text x="649" y="34" text-anchor="middle">Move to Sanity</text>
          <text x="772" y="280" text-anchor="start">Verify &amp; close</text>
        </g>

        <g stroke="#5a9277" stroke-width="2" fill="none">
          <path d="M100,100 Q90,200 298,256" marker-end="url(#arr-pause)"/>
          <path d="M260,100 L340,248" marker-end="url(#arr-pause)"/>
          <path d="M520,100 L470,248" marker-end="url(#arr-pause)"/>
        </g>
        <g font-size="11" fill="#5a9277" font-weight="500">
          <text x="92" y="170" text-anchor="start">Return to requester</text>
          <text x="248" y="180" text-anchor="end">Return to requester</text>
          <text x="540" y="180" text-anchor="start">Return to requester</text>
        </g>

        <g stroke="#5a9277" stroke-width="1.5" fill="none" stroke-dasharray="5,4">
          <path d="M360,250 Q310,180 290,100" marker-end="url(#arr-pause)"/>
          <path d="M490,250 Q500,180 520,100" marker-end="url(#arr-pause)"/>
          <path d="M540,275 Q650,210 740,102" marker-end="url(#arr-pause)"/>
          <path d="M300,275 Q200,210 110,102" marker-end="url(#arr-pause)"/>
        </g>
        <g font-size="11" fill="#5a9277" font-style="italic">
          <text x="610" y="220" text-anchor="middle">Resume (requester replied)</text>
          <text x="200" y="220" text-anchor="middle">Resume (requester replied)</text>
        </g>

        <path d="M540,300 L678,460" stroke="#4e8063" stroke-width="2" fill="none" marker-end="url(#arr-forward)"/>
        <text x="640" y="395" font-size="11" fill="#4e8063" text-anchor="middle" font-weight="500">Close as resolved</text>

        <path d="M100,100 Q40,280 120,448" stroke="#9c5a52" stroke-width="1.5" fill="none" stroke-dasharray="5,4" marker-end="url(#arr-danger)"/>
        <g font-size="11" fill="#9c5a52" font-style="italic">
          <text x="14" y="285">Cancel — from</text>
          <text x="14" y="299">any open state</text>
        </g>
      </svg>

      <div class="flow-legend">
        <div class="legend-item"><span class="legend-swatch legend-forward"></span><span><strong>Forward</strong> — primary lifecycle path</span></div>
        <div class="legend-item"><span class="legend-swatch legend-pause"></span><span><strong>Pause / resume</strong> — SLA clock pauses on return</span></div>
        <div class="legend-item"><span class="legend-swatch legend-danger"></span><span><strong>Cancel</strong> — terminal, no resolution code</span></div>
      </div>
    </div>

    <h2 style="margin-top:24px;">Operator transitions</h2>
    <p class="muted tiny" style="margin:-6px 0 12px;">Triggered by the in-app actions (the Change status… dropdown / Assign / Return-to-requester modal). These run locally and do not touch Case Center.</p>
    <table class="transition-table">
      <thead>
        <tr><th>From</th><th>Action (Change status… dropdown)</th><th>To</th><th>Effect on clocks</th></tr>
      </thead>
      <tbody>
        <tr><td>${pill('new')}</td><td>Assign to Core Team</td><td>${pill('with_core')}</td><td>Core Team hold-clock starts</td></tr>
        <tr><td>${pill('new')}</td><td>Return to requester</td><td>${pill('returned_to_requester')}</td><td>SLA pauses (first line bounces it back)</td></tr>
        <tr><td>${pill('with_core')}</td><td>Escalate to HQ Product Team</td><td>${pill('with_hq')}</td><td>Core Team clock stops · HQ clock starts</td></tr>
        <tr><td>${pill('with_core')}</td><td>Return to requester</td><td>${pill('returned_to_requester')}</td><td>SLA pauses · Core Team clock stops</td></tr>
        <tr><td>${pill('with_hq')}</td><td>Move to Sanity Check</td><td>${pill('sanity_check')}</td><td>HQ clock stops</td></tr>
        <tr><td>${pill('with_hq')}</td><td>Return to requester</td><td>${pill('returned_to_requester')}</td><td>SLA pauses · HQ clock stops</td></tr>
        <tr><td>${pill('sanity_check')}</td><td>Verify &amp; close</td><td>${pill('closed')}</td><td>All clocks stop · resolution recorded</td></tr>
        <tr><td>${pill('returned_to_requester')}</td><td>Requester replied — resume</td><td>Core Team / HQ / Sanity Check / New <span class="muted tiny">(operator picks)</span></td><td>SLA resumes · owner clock restarts</td></tr>
        <tr><td>${pill('returned_to_requester')}</td><td>Close as resolved</td><td>${pill('closed')}</td><td>All clocks stop · resolution recorded</td></tr>
        <tr><td>Any non-terminal</td><td>Cancel case</td><td>${pill('cancelled')}</td><td>All clocks stop · no resolution code</td></tr>
      </tbody>
    </table>

    <h2 style="margin-top:32px;">Case Center → board mapping</h2>
    <p class="muted tiny" style="margin:-6px 0 12px;">Used by every live refresh: <code class="mono">local/casecenter.py</code> reads a raw Case Center record and assigns the board column via <code class="mono">map_status(caseStatus, subStatus.transition, lastProcessType)</code>. The three lookup tiers are tried in order — the first hit wins.</p>

    <div class="card"><div class="card-body">
      <div class="detail-section">
        <h3>1. <code class="mono">(caseStatus, subStatus.transition)</code> pair</h3>
        <p class="muted tiny" style="margin:0 0 8px;">Most specific. Checked first; an exact match short-circuits the other tiers.</p>
        <table class="transition-table">
          <thead><tr><th>caseStatus</th><th>subStatus.transition</th><th>Board status</th><th>Why</th></tr></thead>
          <tbody>
            ${pairMap.map(r => `<tr><td>${mono(r.cs)}</td><td>${mono(r.sub)}</td><td>${pill(r.to)}</td><td class="muted tiny">${escapeHtml(r.note)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="detail-section">
        <h3>2. Last <code class="mono">processTimeline[*].processType</code> refinement</h3>
        <p class="muted tiny" style="margin:0 0 8px;">Disambiguates an otherwise-ambiguous caseStatus (typically <code class="mono">In-Progress</code>) using the latest item in the case's process timeline.</p>
        <table class="transition-table">
          <thead><tr><th>Last processType</th><th>Board status</th><th>Why</th></tr></thead>
          <tbody>
            ${processTypeMap.map(r => `<tr><td>${mono(r.pt)}</td><td>${pill(r.to)}</td><td class="muted tiny">${escapeHtml(r.note)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="detail-section">
        <h3>3. <code class="mono">caseStatus</code> alone (fallback)</h3>
        <p class="muted tiny" style="margin:0 0 8px;">Coarse default when neither of the above matches; any unmapped value falls through to <strong>New</strong>.</p>
        <table class="transition-table">
          <thead><tr><th>caseStatus</th><th>Board status</th><th>Why</th></tr></thead>
          <tbody>
            ${statusOnlyMap.map(r => `<tr><td>${mono(r.cs)}</td><td>${pill(r.to)}</td><td class="muted tiny">${escapeHtml(r.note)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="detail-section" style="margin-bottom:0">
        <h3>Notes</h3>
        <ul class="muted tiny" style="margin:0; padding-left:18px; line-height:1.6;">
          <li><code class="mono">subStatus</code> is the new shape — the prior format's <code class="mono">caseSubstatus</code> field is gone. <code class="mono">sub_transition(r)</code> tolerates the object being missing, null, or the wrong type and returns <code class="mono">null</code> in that case.</li>
          <li><code class="mono">"1st&nbsp;&nbsp;Line"</code> in the processType key has <strong>two</strong> spaces — that's the literal Case Center value.</li>
          <li>On every live refresh, <code class="mono">status</code> is one of the CC-owned fields — the board column follows Case Center automatically. Operator-local layer (routing, notes, clocks, queue, handover, reminders) is preserved.</li>
          <li>Operator transitions (above) and Case Center mappings (here) are independent: an operator can move a card to a different column locally, and a later refresh will only override it if Case Center itself has moved.</li>
        </ul>
      </div>
    </div></div>
  `;
}

// Explainer page (like Status Flow) for how each case-detail clock is calculated. The handling
// clocks are history-derived via the same holderTotals()/ownershipSegments() used on the detail
// page, so the worked example below renders the real timeline component and can't drift.
function renderClockModel() {
  const ago = h => new Date(NOW.getTime() - h * HOUR).toISOString();
  const example = {
    id: 'C-EXAMPLE', status: 'closed', subject: 'Example case', createdAt: ago(10),
    history: [
      { at: ago(10), who: 'op', kind: 'created', detail: 'Case opened (triage)' },
      { at: ago(8), who: 'op', kind: 'assigned', detail: 'Core Team — APAC desk' },
      { at: ago(5), who: 'op', kind: 'escalated', detail: 'Core Team → HQ Product Team' },
      { at: ago(3), who: 'op', kind: 'status', detail: '→ Sanity Check' },
      { at: ago(1), who: 'op', kind: 'closed', detail: 'Resolution: fixed_by_owner' },
    ],
  };
  const t = holderTotals(example);
  const firstLine = t.triage;        // Sanity Check is requester time, not first-line
  const requesterMs = t.requester;   // includes the Sanity Check span (see ownershipSegments)
  const lifeMs = t.triage + t.core + t.hq + t.requester;
  // SLA runs the whole time the case is on us and pauses only on an explicit "Return to
  // requester". This example never returns, so SLA spans the full lifetime — Sanity Check is
  // requester-attributed in the breakdown but does not pause SLA.
  const slaMsEx = lifeMs;
  const swatch = cls => `<span class="clock-swatch ${cls}"></span>`;
  const accentSwatch = '<span class="clock-swatch" style="background:var(--accent)"></span>';

  return `
    <div class="page-header">
      <div>
        <h1>Clock model</h1>
        <div class="subtitle">How each clock on the case detail is calculated. The handling clocks are reconstructed from case history — the same source as the ownership timeline — so the numbers always reconcile.</div>
      </div>
    </div>

    <div class="flow-container">
      <h2 style="margin-top:0;">How each clock is counted</h2>
      <p class="muted tiny" style="margin:0 0 10px;">The case detail shows four clocks — SLA, First line, Core Team, HQ. The “With requester” row below isn't a separate clock; it's the requester-attributed time you see on the ownership timeline.</p>
      <table class="transition-table">
        <thead>
          <tr><th>Clock</th><th>What it measures</th><th>Starts</th><th>Pauses / stops</th><th>Banked</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>${accentSwatch}<strong>SLA · time on us</strong></td>
            <td>Total time the case is our responsibility.</td>
            <td>When the case is created (<code>slaStartedAt</code>).</td>
            <td>Pauses only on an explicit <em>Return to requester</em>; resumes on <em>resume</em>. Sanity Check does <strong>not</strong> pause it.</td>
            <td>Frozen into <code>slaAccumulatedMs</code> on close / cancel.</td>
          </tr>
          <tr>
            <td>${swatch('tl-triage')}<strong>First line</strong></td>
            <td>Time the first-line agent handled it directly — <strong>triage</strong> while the case is New.</td>
            <td>On creation (status New).</td>
            <td>When assigned to Core Team, or returned / cancelled from New.</td>
            <td>Summed from history segments.</td>
          </tr>
          <tr>
            <td>${swatch('tl-core')}<strong>Core Team</strong></td>
            <td>Time the case sat with the Core Team desk.</td>
            <td>On <em>Assign to Core Team</em>.</td>
            <td>On escalate / return / close.</td>
            <td>Summed from history segments.</td>
          </tr>
          <tr>
            <td>${swatch('tl-hq')}<strong>HQ Product Team</strong></td>
            <td>Time the case sat with the HQ product team.</td>
            <td>On <em>Escalate to HQ</em>.</td>
            <td>On move-to-sanity / return / close.</td>
            <td>Summed from history segments.</td>
          </tr>
          <tr>
            <td>${swatch('tl-requester')}<strong>With requester</strong></td>
            <td>Time waiting on the requester — both <em>Returned to requester</em> and <strong>Sanity Check</strong> (awaiting their confirmation).</td>
            <td>On return to requester, or on Move to Sanity Check.</td>
            <td>On resume / verify &amp; close.</td>
            <td>Timeline only. (Returned spans also pause SLA; Sanity Check does not.)</td>
          </tr>
        </tbody>
      </table>

      <h2>Worked example</h2>
      <p class="muted tiny" style="margin:0 0 8px;">A case that went New → Core Team → HQ → Sanity Check → Closed. The bar below is the exact component shown on the case detail.</p>
      ${renderOwnershipTimeline(example)}
      <div class="clock-grid" style="margin-top:16px;">
        <div class="clock"><div class="label">${accentSwatch}SLA · time on us</div><div class="value">${fmtDuration(slaMsEx)}</div><div class="state">runs through Sanity Check (no explicit return)</div></div>
        <div class="clock"><div class="label">${swatch('tl-triage')}First line</div><div class="value">${fmtDuration(firstLine)}</div><div class="state">triage only</div></div>
        <div class="clock"><div class="label">${swatch('tl-core')}Core Team</div><div class="value">${fmtDuration(t.core)}</div><div class="state">Idle</div></div>
        <div class="clock"><div class="label">${swatch('tl-hq')}HQ Product Team</div><div class="value">${fmtDuration(t.hq)}</div><div class="state">Idle</div></div>
        <div class="clock"><div class="label">${swatch('tl-requester')}With requester</div><div class="value">${fmtDuration(requesterMs)}</div><div class="state">incl. Sanity Check</div></div>
      </div>

      <p class="muted tiny" style="margin-top:14px;">First line + Core Team + HQ + With requester add up to the case's lifetime (${fmtDuration(lifeMs)}). <strong>Sanity Check</strong> counts as <em>With requester</em> time. <strong>SLA · time on us</strong> runs the whole lifetime and pauses only on an explicit <em>Return to requester</em> — so here it equals the full ${fmtDuration(slaMsEx)}.</p>
    </div>
  `;
}

/* ---------- Modal ---------- */

function showToast(message, type = 'info') {
  let container = document.getElementById('toast-root');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-root';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="toast-msg">${escapeHtml(message)}</span><button class="toast-close" aria-label="dismiss">×</button>`;
  const dismiss = () => {
    toast.classList.add('toast-leaving');
    setTimeout(() => toast.remove(), 200);
  };
  toast.querySelector('.toast-close').addEventListener('click', dismiss);
  container.appendChild(toast);
  setTimeout(dismiss, 5000);
}

function showModal(html, onSubmit) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal">${html}</div></div>`;
  const close = () => { root.innerHTML = ''; };
  root.querySelector('[data-modal-cancel]')?.addEventListener('click', close);
  root.querySelector('[data-modal-submit]')?.addEventListener('click', () => {
    if (onSubmit(root.querySelector('.modal'))) close();
  });
  root.querySelector('.modal-backdrop')?.addEventListener('click', e => {
    if (e.target.classList.contains('modal-backdrop')) close();
  });
}

/* ---------- Action handlers ---------- */

// Null-safe read of a modal form field's value. Guards against a field being renamed or
// removed from a modal's markup without its onSubmit being updated (returns '' rather than
// throwing on a missing node).
function fieldVal(modal, name) {
  const el = modal && modal.querySelector(`[data-field="${name}"]`);
  return el ? el.value : '';
}

// Append a case history entry stamped at the current case clock (NOW), authored by op.
function logHistory(c, op, kind, detail) {
  c.history.push({ at: new Date(NOW).toISOString(), who: op.id, kind, detail });
}

function handlePrompt(caseId, kind) {
  const op = getOperator(STATE.operatorId);

  if (kind === 'new_case') {
    handleNewCase(op);
    return;
  }

  const c = caseById(caseId);
  if (!c) return;

  if (kind === 'assign_core') {
    const opts = window.OWNERS.core.map(f => `<option value="${f.id}"${f.id === c.coreId ? ' selected' : ''}>${escapeHtml(f.name)} (${escapeHtml(f.region)})</option>`).join('');
    showModal(`
      <h3>Assign to Core Team</h3>
      <div class="modal-sub">Pick the Core Team desk that should triage this case.</div>
      <label>Core Team desk</label>
      <select data-field="coreId">${opts}</select>
      <div class="modal-actions">
        <button class="btn" data-modal-cancel>Cancel</button>
        <button class="btn btn-primary" data-modal-submit>Assign</button>
      </div>
    `, (modal) => {
      const coreId = fieldVal(modal, 'coreId');
      c.coreId = coreId;
      c.currentOwner = 'core';
      c.status = 'with_core';
      c.holdStartedAt = new Date(NOW).toISOString();
      c.lastOwnerContact = { at: new Date(NOW).toISOString(), channel: 'Slack' };
      const coreName = getOwner('core', coreId).name;
      logHistory(c, op, 'assigned', `Core Team — ${coreName}`);
      showToast(`${c.id} assigned to ${coreName}. Status is now With Core Team.`, 'success');
      render();
      return true;
    });
    return;
  }

  if (kind === 'escalate_to_hq') {
    const opts = window.OWNERS.hq.map(h => `<option value="${h.id}"${h.id === c.hqId ? ' selected' : ''}>${escapeHtml(h.name)} (${escapeHtml(h.area)})</option>`).join('');
    showModal(`
      <h3>Escalate to HQ Product Team</h3>
      <div class="modal-sub">Core Team can't resolve. Pick the HQ team that owns this area.</div>
      <label>HQ team</label>
      <select data-field="hqId">${opts}</select>
      <label>Reason (optional)</label>
      <textarea data-field="reason" placeholder="What did the Core Team find?"></textarea>
      <div class="modal-actions">
        <button class="btn" data-modal-cancel>Cancel</button>
        <button class="btn btn-primary" data-modal-submit>Escalate</button>
      </div>
    `, (modal) => {
      const hqId = fieldVal(modal, 'hqId');
      const reason = fieldVal(modal, 'reason').trim();
      // stop FIT clock, start HQ clock
      if (c.currentOwner === 'core' && c.holdStartedAt) {
        c.holdMs.core += new Date(NOW) - new Date(c.holdStartedAt);
      }
      c.hqId = hqId;
      c.currentOwner = 'hq';
      c.status = 'with_hq';
      c.holdStartedAt = new Date(NOW).toISOString();
      c.coreCannotResolve = false;
      c.lastOwnerContact = { at: new Date(NOW).toISOString(), channel: 'JIRA' };
      const hqName = getOwner('hq', hqId).name;
      logHistory(c, op, 'escalated', `Core Team → ${hqName}${reason ? ' · ' + reason : ''}`);
      showToast(`${c.id} escalated to ${hqName}. Core Team clock stopped, HQ clock running.`, 'success');
      render();
      return true;
    });
    return;
  }

  if (kind === 'chase_core' || kind === 'chase_hq') {
    const owner = c.currentOwner === 'core' ? getOwner('core', c.coreId) : getOwner('hq', c.hqId);
    const channel = c.currentOwner === 'core' ? 'Slack' : 'JIRA';
    showModal(`
      <h3>Send reminder to ${escapeHtml(owner?.name || 'owner')}</h3>
      <div class="modal-sub">Channel: ${escapeHtml(channel)} · ${renderTzHint(owner)}</div>
      <label>Reminder message</label>
      <textarea data-field="msg" placeholder="Quick nudge — any update on this?"></textarea>
      <div class="modal-actions">
        <button class="btn" data-modal-cancel>Cancel</button>
        <button class="btn btn-primary" data-modal-submit>Send reminder</button>
      </div>
    `, (modal) => {
      const msg = fieldVal(modal, 'msg').trim();
      c.lastOwnerContact = { at: new Date(NOW).toISOString(), channel };
      logHistory(c, op, 'reminder', `Reminder via ${channel}${msg ? ': ' + msg : ''}`);
      const threshold = c.currentOwner === 'core' ? window.THRESHOLDS.coreIdleHours : window.THRESHOLDS.hqIdleHours;
      showToast(`Reminder sent to ${owner?.name || 'owner'} via ${channel}. ${c.id} stays with ${c.currentOwner === 'core' ? 'Core Team' : 'HQ'}; it will re-prompt for a chase in ${threshold}h if there's no reply.`, 'success');
      render();
      return true;
    });
    return;
  }

  if (kind === 'verify_fix') {
    showModal(`
      <h3>Verify reported fix and close</h3>
      <div class="modal-sub">Confirm the fix with the requester before closing.</div>
      <label>Resolution code</label>
      <select data-field="code">
        <option value="fixed_by_owner">fixed_by_owner</option>
        <option value="fixed_with_workaround">fixed_with_workaround</option>
        <option value="not_a_bug">not_a_bug</option>
      </select>
      <label>Resolution note</label>
      <textarea data-field="note" placeholder="What was the fix? Was it confirmed?"></textarea>
      <div class="modal-actions">
        <button class="btn" data-modal-cancel>Cancel</button>
        <button class="btn btn-primary" data-modal-submit>Close case</button>
      </div>
    `, (modal) => {
      const code = fieldVal(modal, 'code');
      const note = fieldVal(modal, 'note').trim();
      if (!note) { alert('Resolution note is required.'); return false; }
      // stop active clocks
      if (c.currentOwner && c.holdStartedAt) {
        c.holdMs[c.currentOwner] += new Date(NOW) - new Date(c.holdStartedAt);
      }
      if (!c.slaPaused) {
        c.slaAccumulatedMs = caseSlaMs(c);
      }
      c.status = 'closed';
      c.closedAt = new Date(NOW).toISOString();
      c.resolutionCode = code;
      c.currentOwner = null;
      c.holdStartedAt = null;
      logHistory(c, op, 'closed', `Resolution: ${code} · ${note}`);
      showToast(`${c.id} closed (${code}). Moved out of the Action Queue.`, 'success');
      render();
      return true;
    });
    return;
  }

  if (kind === 'approaching_sla') {
    showModal(`
      <h3>Return to requester</h3>
      <div class="modal-sub">This pauses the SLA clock until the requester responds.</div>
      <label>Reason / what we need from them</label>
      <textarea data-field="reason" placeholder="Need repro steps / awaiting confirmation / …"></textarea>
      <div class="modal-actions">
        <button class="btn" data-modal-cancel>Cancel</button>
        <button class="btn btn-primary" data-modal-submit>Return to requester</button>
      </div>
    `, (modal) => {
      const reason = fieldVal(modal, 'reason').trim();
      if (!reason) { alert('A reason is required.'); return false; }
      // stop owner clock, freeze SLA
      if (c.currentOwner && c.holdStartedAt) {
        c.holdMs[c.currentOwner] += new Date(NOW) - new Date(c.holdStartedAt);
      }
      c.slaAccumulatedMs = caseSlaMs(c);
      c.slaPaused = true;
      c.currentOwner = null;
      c.holdStartedAt = null;
      c.status = 'returned_to_requester';
      logHistory(c, op, 'returned', `Returned to requester · ${reason}`);
      showToast(`${c.id} returned to ${c.user}. SLA clock paused. Resume from the case detail when they reply.`, 'success');
      render();
      return true;
    });
    return;
  }

  if (kind === 'watch_escalated') {
    navigate(`#/cases/${c.id}`);
    return;
  }

  if (kind === 'end_of_shift_handover') {
    showModal(`
      <h3>Handover note</h3>
      <div class="modal-sub">${escapeHtml(op.shift)} → ${escapeHtml(op.shift === 'Day' ? 'Night' : 'Day')} · case ${escapeHtml(c.id)}</div>
      <label>Note for the next shift</label>
      <textarea data-field="note" placeholder="What's the state, what to do next, what to watch for…"></textarea>
      <div class="modal-actions">
        <button class="btn" data-modal-cancel>Cancel</button>
        <button class="btn btn-primary" data-modal-submit>Save note</button>
      </div>
    `, (modal) => {
      const note = fieldVal(modal, 'note').trim();
      if (!note) { alert('Handover note is required.'); return false; }
      const target = op.shift === 'Day' ? 'Night' : 'Day';
      c.handover = { note, author: op.id, from: op.shift, to: target, at: new Date(NOW).toISOString(), staleForCurrentShift: false };
      logHistory(c, op, 'handover', `Handover note (${op.shift} → ${target})`);
      showToast(`Handover note saved for ${c.id} (${op.shift} → ${target}).`, 'success');
      render();
      return true;
    });
    return;
  }

  if (kind === 'resume') {
    const core = getOwner('core', c.coreId);
    const hq = getOwner('hq', c.hqId);
    const opts = [];
    if (c.coreId) opts.push(`<option value="core">Resume with ${escapeHtml(core.name)} (Core Team)</option>`);
    if (c.hqId) opts.push(`<option value="hq">Resume with ${escapeHtml(hq.name)} (HQ Product Team)</option>`);
    opts.push(`<option value="sanity_check">Move to Sanity Check (requester says it's fixed)</option>`);
    opts.push(`<option value="new">Resume unassigned (status: New)</option>`);
    showModal(`
      <h3>Requester replied — resume case</h3>
      <div class="modal-sub">SLA clock will resume. Pick where to route the case next.</div>
      <label>Destination</label>
      <select data-field="dest">${opts.join('')}</select>
      <label>What did the requester say? (optional)</label>
      <textarea data-field="note" placeholder="Summary of the reply / what changes…"></textarea>
      <div class="modal-actions">
        <button class="btn" data-modal-cancel>Cancel</button>
        <button class="btn btn-primary" data-modal-submit>Resume</button>
      </div>
    `, (modal) => {
      const dest = fieldVal(modal, 'dest');
      const note = fieldVal(modal, 'note').trim();

      // Resume SLA clock: open a new running segment from NOW.
      c.slaPaused = false;
      c.slaStartedAt = new Date(NOW).toISOString();

      let detail;
      if (dest === 'core') {
        c.currentOwner = 'core';
        c.status = 'with_core';
        c.holdStartedAt = new Date(NOW).toISOString();
        c.lastOwnerContact = { at: new Date(NOW).toISOString(), channel: 'Slack' };
        detail = `Requester replied · resumed to Core Team (${getOwner('core', c.coreId).name})`;
      } else if (dest === 'hq') {
        c.currentOwner = 'hq';
        c.status = 'with_hq';
        c.holdStartedAt = new Date(NOW).toISOString();
        c.lastOwnerContact = { at: new Date(NOW).toISOString(), channel: 'JIRA' };
        detail = `Requester replied · resumed to HQ Product Team (${getOwner('hq', c.hqId).name})`;
      } else if (dest === 'sanity_check') {
        c.status = 'sanity_check';
        c.currentOwner = null;
        c.holdStartedAt = null;
        detail = `Requester replied · moved to Sanity Check`;
      } else {
        c.currentOwner = null;
        c.status = 'new';
        c.holdStartedAt = null;
        c.lastOwnerContact = null;
        c.coreId = null;
        c.hqId = null;
        c.coreCannotResolve = false;
        detail = `Requester replied · resumed unassigned (Core Team/HQ cleared)`;
      }
      if (note) detail += ` · ${note}`;
      logHistory(c, op, 'resumed', detail);
      showToast(`${c.id} resumed. SLA clock running again; status is ${statusLabel(c.status)}.`, 'success');
      render();
      return true;
    });
    return;
  }

  if (kind === 'close_resolved') {
    showModal(`
      <h3>Close case</h3>
      <div class="modal-sub">Close directly without further owner work (e.g., requester resolved it themselves, no longer needed).</div>
      <label>Resolution code</label>
      <select data-field="code">
        <option value="fixed_by_requester">fixed_by_requester</option>
        <option value="fixed_by_owner">fixed_by_owner</option>
        <option value="fixed_with_workaround">fixed_with_workaround</option>
        <option value="not_a_bug">not_a_bug</option>
        <option value="no_response">no_response</option>
      </select>
      <label>Resolution note</label>
      <textarea data-field="note" placeholder="What was the outcome?"></textarea>
      <div class="modal-actions">
        <button class="btn" data-modal-cancel>Cancel</button>
        <button class="btn btn-primary" data-modal-submit>Close case</button>
      </div>
    `, (modal) => {
      const code = fieldVal(modal, 'code');
      const note = fieldVal(modal, 'note').trim();
      if (!note) { alert('Resolution note is required.'); return false; }

      if (c.currentOwner && c.holdStartedAt) {
        c.holdMs[c.currentOwner] += new Date(NOW) - new Date(c.holdStartedAt);
        c.holdStartedAt = null;
      }
      if (!c.slaPaused) {
        c.slaAccumulatedMs = caseSlaMs(c);
      }
      c.status = 'closed';
      c.closedAt = new Date(NOW).toISOString();
      c.resolutionCode = code;
      c.currentOwner = null;
      logHistory(c, op, 'closed', `Resolution: ${code} · ${note}`);
      showToast(`${c.id} closed (${code}).`, 'success');
      render();
      return true;
    });
    return;
  }

  if (kind === 'move_to_sanity_check') {
    c.status = 'sanity_check';
    logHistory(c, op, 'status', '→ Sanity Check');
    showToast(`${c.id} moved to Sanity Check. Verify with the requester before closing.`, 'success');
    render();
    return;
  }

  if (kind === 'cancel') {
    showModal(`
      <h3>Cancel case</h3>
      <div class="modal-sub">Mark this case as cancelled (duplicate, withdrawn, out of scope, etc.). Different from closing — no resolution code.</div>
      <label>Reason</label>
      <textarea data-field="reason" placeholder="Why is this being cancelled?"></textarea>
      <div class="modal-actions">
        <button class="btn" data-modal-cancel>Keep open</button>
        <button class="btn btn-danger" data-modal-submit>Confirm cancel</button>
      </div>
    `, (modal) => {
      const reason = fieldVal(modal, 'reason').trim();
      if (!reason) { alert('A reason is required.'); return false; }

      if (c.currentOwner && c.holdStartedAt) {
        c.holdMs[c.currentOwner] += new Date(NOW) - new Date(c.holdStartedAt);
        c.holdStartedAt = null;
      }
      if (!c.slaPaused) {
        c.slaAccumulatedMs = caseSlaMs(c);
      }
      c.status = 'cancelled';
      c.currentOwner = null;
      logHistory(c, op, 'cancelled', reason);
      showToast(`${c.id} cancelled.`, 'warn');
      render();
      return true;
    });
    return;
  }

  if (kind === 'toggle_queue') {
    const nowQueued = !isQueued(c);
    c.agentStatus = nowQueued ? 'queued' : 'unqueued';
    // Picking a fresh case auto-selects it in the workspace so the detail panel populates.
    if (nowQueued) STATE.kanbanSelected = c.id;
    logHistory(c, op, nowQueued ? 'picked' : 'unpicked',
      nowQueued ? 'Picked for follow-up' : 'Removed from Picked workspace');
    showToast(nowQueued ? `${c.id} picked for follow-up.` : `${c.id} unpicked.`, 'info');
    render();
    return;
  }

  if (kind === 'clear_track_status') {
    // Manual-clear preconditions per plan §3. We soft-warn the operator but never block.
    const ts = caseTrackStatus(c);
    if (!ts) return;
    const def = TRACK_STATUS_BY_ID[ts];
    const reasons = [];
    if (def?.scheduled) {
      if (caseStation(c) !== def.scheduled.to) reasons.push(`CC assignee hasn't reached ${def.scheduled.to} yet.`);
    } else if (ts === 'case_closed') {
      if (!['closed', 'cancelled'].includes(c.status)) reasons.push(`CC status is "${displayStatus(c)}", not Closed/Cancelled.`);
    }
    const needsHandover = !c.handover || c.handover.staleForCurrentShift;
    if (needsHandover) reasons.push('No fresh handover note for the incoming shift.');
    if (reasons.length > 0) {
      const proceed = confirm(`Clear Track Status anyway?\n\n${reasons.map(r => '• ' + r).join('\n')}`);
      if (!proceed) return;
    }
    c.trackStatus = null;
    logHistory(c, op, 'track-status-cleared', `${ts} → cleared`);
    showToast(`${c.id} Track Status cleared.`, 'info');
    render();
    return;
  }

  if (kind === 'set_reminder') {
    const existing = c.reminder;
    const presets = [
      { value: '1',    label: 'In 1 minute' },
      { value: '5',    label: 'In 5 minutes' },
      { value: '30',   label: 'In 30 minutes' },
      { value: '60',   label: 'In 1 hour' },
      { value: '240',  label: 'In 4 hours' },
      { value: '1440', label: 'In 24 hours' },
    ];
    showModal(`
      <h3>${existing ? 'Update' : 'Set'} reminder on ${escapeHtml(c.id)}</h3>
      <div class="modal-sub">${existing
        ? 'Reminder is currently set for ' + fmtUntil(existing.fireAt) + '.'
        : 'The app will surface this case at the chosen time. Useful for deferred work (e.g. wait until APAC Core Team come online before assigning).'}</div>
      <label>Remind me in…</label>
      <select data-field="when">${presets.map(p => `<option value="${p.value}">${escapeHtml(p.label)}</option>`).join('')}</select>
      <label>…or at a specific time <span class="muted tiny">(today, or tomorrow if it's already past)</span></label>
      <input type="time" data-field="atTime">
      <label>Note (optional)</label>
      <textarea data-field="note" placeholder="Why are you deferring this?">${escapeHtml(existing?.note || '')}</textarea>
      <div class="modal-actions">
        ${existing ? '<button class="btn btn-danger" data-action="reminder-clear" data-case-id="' + escapeHtml(c.id) + '">Clear reminder</button>' : '<span></span>'}
        <div style="display:flex; gap:8px;">
          <button class="btn" data-modal-cancel>Cancel</button>
          <button class="btn btn-primary" data-modal-submit>Save</button>
        </div>
      </div>
    `, (modal) => {
      const note = fieldVal(modal, 'note').trim();
      // A specific time (e.g. 05:30) wins over the relative preset when set.
      const atTime = fieldVal(modal, 'atTime');
      const fireAt = atTime
        ? nextTimeIso(atTime)
        : new Date(realNow().getTime() + parseInt(fieldVal(modal, 'when'), 10) * 60000).toISOString();
      if (!fireAt) { alert('Enter a valid time (HH:MM).'); return false; }
      c.reminder = {
        fireAt,
        note,
        setBy: op.id,
        setAt: realNow().toISOString(),
        fired: false,
      };
      logHistory(c, op, 'reminder_set', `Reminder ${fmtUntil(fireAt)}${note ? ' · ' + note : ''}`);
      showToast(`Reminder set for ${c.id} ${fmtUntil(fireAt)}.`, 'success');
      render();
      return true;
    });
    // Wire up the in-modal Clear button (not a normal submit).
    const clearBtn = document.querySelector('.modal [data-action="reminder-clear"]');
    if (clearBtn) {
      clearBtn.addEventListener('click', e => {
        e.preventDefault();
        if (c.reminder) {
          logHistory(c, op, 'reminder_dismissed', 'Cleared via modal');
          c.reminder = null;
          showToast(`Reminder cleared for ${c.id}.`, 'info');
          document.getElementById('modal-root').innerHTML = '';
          render();
        }
      });
    }
    return;
  }

  if (kind === 'dismiss_reminder') {
    if (c.reminder) {
      logHistory(c, op, 'reminder_dismissed', c.reminder.note || 'Dismissed');
      c.reminder = null;
      showToast(`Reminder dismissed for ${c.id}.`, 'info');
      render();
    }
    return;
  }

  if (kind === 'snooze_reminder') {
    if (c.reminder) {
      const fireAt = new Date(realNow().getTime() + 5 * 60000).toISOString();
      c.reminder = { ...c.reminder, fireAt, fired: false };
      logHistory(c, op, 'reminder_snoozed', 'Snoozed 5m');
      showToast(`${c.id} reminder snoozed 5 minutes.`, 'info');
      render();
    }
    return;
  }
}

function handleHandoverTo(caseId, recipientOpId) {
  const c = caseById(caseId);
  const op = getOperator(STATE.operatorId);
  const recipient = getOperator(recipientOpId);
  if (!c || !op || !recipient) return;
  showModal(`
    <h3>Hand over to ${escapeHtml(recipient.name)}</h3>
    <div class="modal-sub">${escapeHtml(op.shift)} → ${escapeHtml(recipient.shift)} · case ${escapeHtml(c.id)}</div>
    <label>Note for ${escapeHtml(recipient.name)}</label>
    <textarea data-field="note" placeholder="What's the state, what to do next, what to watch for…"></textarea>
    <div class="modal-actions">
      <button class="btn" data-modal-cancel>Cancel</button>
      <button class="btn btn-primary" data-modal-submit>Send handover</button>
    </div>
  `, (modal) => {
    const note = fieldVal(modal, 'note').trim();
    if (!note) { alert('Handover note is required.'); return false; }
    c.handover = {
      note,
      author: op.id,
      from: op.shift,
      to: recipient.shift,
      toOperator: recipient.id,
      at: new Date(NOW).toISOString(),
      staleForCurrentShift: false,
    };
    logHistory(c, op, 'handover', `Handover to ${recipient.name} (${op.shift} → ${recipient.shift})`);
    showToast(`Handover note for ${c.id} addressed to ${recipient.name}.`, 'success');
    render();
    return true;
  });
}

function handleNewCase(op) {
  if (!/^https?:$/.test(location.protocol)) {
    showToast('Adding a case by ID requires running the board via serve.py.', 'warn');
    return;
  }
  showModal(`
    <h3>Add a case by ID</h3>
    <div class="modal-sub">Pulls this case from Case Center by its ID and adds it to the board.</div>
    <label>Case ID *</label>
    <input type="text" data-field="caseId" placeholder="e.g. 581234">
    <div class="modal-actions">
      <button class="btn" data-modal-cancel>Cancel</button>
      <button class="btn btn-primary" data-modal-submit>Fetch &amp; add</button>
    </div>
  `, (modal) => {
    const id = fieldVal(modal, 'caseId').trim();
    if (!id) { alert('Enter a case ID.'); return false; }
    addCaseById(id);   // async; modal closes now
    return true;
  });
}

// Validate, normalize, and merge one raw Case Center record into STATE.cases, preserving the
// local agent layer (queue placement, handover, reminder) when updating an existing case.
// Returns { id, added } or null if the record was malformed. Shared by add/refresh flows.
function mergeLiveCase(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || typeof raw.id !== 'string' || !raw.id.trim()) return null;
  const i = STATE.cases.findIndex(c => c.id === raw.id);
  if (i >= 0) {
    // Existing case: refresh only the Case Center–owned fields, preserve all operator work.
    overlayLiveCase(STATE.cases[i], raw);
    return { id: raw.id, added: false };
  }
  STATE.cases.unshift(normalizeLiveCase(raw));   // brand-new case: full normalize
  return { id: raw.id, added: true };
}

// Fetch one case from Case Center by id (GET /api/cases?id=…). Returns the parsed cases array,
// or throws on transport error / rejects with a status. Shared by add + refresh.
async function fetchCaseById(id) {
  const res = await fetch(apiUrl('api/cases?id=' + encodeURIComponent(id)), { headers: { Accept: 'application/json' } });
  if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
  const data = await res.json();
  return (Array.isArray(data) ? data : (data && data.cases)) || [];
}

// Fetch one case by id and add/merge it into the board (the "+ New case" by-id flow).
async function addCaseById(id) {
  showLiveLoading();
  try {
    const cases = await fetchCaseById(id);
    hideLiveLoading();
    if (!cases.length) { showToast(`Case ${id} not found in Case Center.`, 'warn'); return; }
    let added = 0, firstId = null;
    for (const raw of cases) {
      const m = mergeLiveCase(raw);
      if (!m) continue;
      if (m.added) added++;
      // Auto-pick imported cases — the operator typed the ID specifically to
      // follow up on this case, so it belongs in the Picked workspace from
      // the moment it lands rather than sitting unpicked in the Overview.
      const c = caseById(m.id);
      if (c && !['closed', 'cancelled'].includes(c.status)) c.agentStatus = 'queued';
      STATE.kanbanSelected = m.id;
      if (!firstId) firstId = m.id;
    }
    if (!firstId) { showToast(`Case ${id} returned a malformed record.`, 'warn'); return; }
    if (!location.hash.startsWith('#/cases')) location.hash = '#/cases';
    render();
    showToast(`${added ? 'Added' : 'Updated'} ${firstId} from Case Center · picked.`, 'success');
  } catch (e) {
    hideLiveLoading();
    showToast(e.status ? `Couldn't fetch ${id} (HTTP ${e.status}).` : 'Could not reach Case Center (is serve.py running?).', 'warn');
  }
}

// Re-fetch a single stored case from Case Center (the per-card / reading-panel ⟳ button).
async function refreshCase(id) {
  showLiveLoading();
  try {
    const cases = await fetchCaseById(id);
    hideLiveLoading();
    if (!cases.length) { showToast(`Case ${id} not found in Case Center.`, 'warn'); return; }
    let merged = 0;
    for (const raw of cases) if (mergeLiveCase(raw)) merged++;
    render();
    showToast(merged ? `Refreshed ${id} from Case Center.` : `Case ${id} returned a malformed record.`, merged ? 'success' : 'warn');
  } catch (e) {
    hideLiveLoading();
    showToast(e.status ? `Couldn't refresh ${id} (HTTP ${e.status}).` : 'Could not reach Case Center (is serve.py running?).', 'warn');
  }
}

// Re-pull every case already on the board ("Refresh Existing"). Distinct from "Load New",
// which queries the look-back window for newly-created cases. Re-fetches by id so it picks up
// status/owner changes on cases you already have, without changing which cases are shown.
async function refreshAllStored() {
  const ids = STATE.cases.map(c => c.id).filter(Boolean);
  if (!ids.length) { showToast('No stored cases to refresh.', 'info'); return; }
  showLiveLoading();
  let ok = 0, fail = 0;
  for (const id of ids) {
    try {
      const cases = await fetchCaseById(id);
      for (const raw of cases) if (mergeLiveCase(raw)) ok++;
    } catch (e) { fail++; }
  }
  hideLiveLoading();
  render();
  showToast(`Refreshed ${ok} stored case${ok === 1 ? '' : 's'}${fail ? ` · ${fail} failed` : ''}.`, fail ? 'warn' : 'success');
}

function handleReassign(caseId, type) {
  const c = caseById(caseId);
  if (!c) return;
  const op = getOperator(STATE.operatorId);
  const dir = type === 'core' ? window.OWNERS.core : window.OWNERS.hq;
  const currentId = type === 'core' ? c.coreId : c.hqId;
  const typeLabel = type === 'core' ? 'Core Team' : 'HQ Product Team';
  const detailLabel = type === 'core' ? o => `${escapeHtml(o.name)} (${escapeHtml(o.region)})` : o => `${escapeHtml(o.name)} (${escapeHtml(o.area)})`;

  const opts = [
    `<option value="">— Unassign —</option>`,
    ...dir.map(o => `<option value="${o.id}" ${o.id === currentId ? 'selected' : ''}>${detailLabel(o)}</option>`),
  ].join('');

  showModal(`
    <h3>${currentId ? 'Change' : 'Assign'} ${escapeHtml(typeLabel)} contact</h3>
    <div class="modal-sub">${currentId ? 'Pick a different desk or unassign. If this is the active owner, the hold clock segment will reset to the new owner.' : 'Pick a desk for this case.'}</div>
    <label>${escapeHtml(typeLabel)}</label>
    <select data-field="ownerId">${opts}</select>
    <label>Reason (optional)</label>
    <textarea data-field="reason" placeholder="Why is the assignment changing?"></textarea>
    <div class="modal-actions">
      <button class="btn" data-modal-cancel>Cancel</button>
      <button class="btn btn-primary" data-modal-submit>Save</button>
    </div>
  `, (modal) => {
    const newId = fieldVal(modal, 'ownerId') || null;
    const reason = fieldVal(modal, 'reason').trim();
    if (newId === currentId) return true;

    const oldOwner = currentId ? getOwner(type, currentId) : null;
    const newOwner = newId ? getOwner(type, newId) : null;

    // Stop the active hold-clock segment if currentOwner === type.
    if (c.currentOwner === type && c.holdStartedAt) {
      c.holdMs[type] = (c.holdMs[type] || 0) + (NOW.getTime() - new Date(c.holdStartedAt).getTime());
      c.holdStartedAt = null;
    }

    // Update the contact pointer.
    if (type === 'core') c.coreId = newId;
    else c.hqId = newId;

    // Decide currentOwner / status / new clock segment.
    if (newId) {
      const wasActive = c.currentOwner === type;
      const wasNew = c.status === 'new';
      const wasReturned = c.status === 'returned_to_requester';
      if (wasActive || wasNew) {
        c.currentOwner = type;
        c.status = type === 'core' ? 'with_core' : 'with_hq';
        c.holdStartedAt = new Date(NOW).toISOString();
        c.lastOwnerContact = { at: new Date(NOW).toISOString(), channel: type === 'core' ? 'Slack' : 'JIRA' };
      } else if (wasReturned) {
        // Just updating the contact for when SLA resumes; don't restart the clock.
      }
      // else: case is with the other owner — just updated the inactive contact, no other changes.
    } else {
      // Unassigning.
      if (c.currentOwner === type) {
        c.currentOwner = null;
        c.lastOwnerContact = null;
        const otherType = type === 'core' ? 'hq' : 'core';
        const otherId = otherType === 'core' ? c.coreId : c.hqId;
        if (otherId) {
          c.currentOwner = otherType;
          c.status = otherType === 'core' ? 'with_core' : 'with_hq';
          c.holdStartedAt = new Date(NOW).toISOString();
        } else {
          c.status = 'new';
        }
      }
    }

    if (type === 'core') c.coreCannotResolve = false;

    const detail = `${typeLabel}: ${oldOwner ? oldOwner.name : '(unassigned)'} → ${newOwner ? newOwner.name : '(unassigned)'}${reason ? ' · ' + reason : ''}`;
    logHistory(c, op, currentId ? 'reassigned' : 'assigned', detail);
    render();
    return true;
  });
}

/* ---------- Bind handlers after render ---------- */

function bindHandlers() {
  document.querySelectorAll('[data-action="prompt"]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      handlePrompt(el.dataset.caseId, el.dataset.kind);
    });
  });
  document.querySelectorAll('[data-action="status-select"]').forEach(el => {
    el.addEventListener('change', () => {
      const kind = el.value;
      const caseId = el.dataset.caseId;
      el.value = '';
      if (kind) handlePrompt(caseId, kind);
    });
  });
  document.querySelectorAll('[data-action="track-status-select"]').forEach(el => {
    el.addEventListener('change', () => {
      const value = el.value;
      const caseId = el.dataset.caseId;
      const c = caseById(caseId);
      if (!c) return;
      const op = getOperator(STATE.operatorId);
      const prev = caseTrackStatus(c);
      if (value === prev) return;
      if (!value) {
        c.trackStatus = null;
      } else {
        c.trackStatus = value;
      }
      logHistory(c, op, 'track-status-set', `${prev || 'untracked'} → ${value || 'untracked'}`);
      render();
    });
  });
  document.querySelectorAll('[data-action="handover-to-select"]').forEach(el => {
    el.addEventListener('change', () => {
      const recipientOpId = el.value;
      const caseId = el.dataset.caseId;
      el.value = '';
      if (!recipientOpId) return;
      handleHandoverTo(caseId, recipientOpId);
    });
  });
  document.querySelectorAll('[data-action="reassign"]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      handleReassign(el.dataset.caseId, el.dataset.type);
    });
  });
  document.querySelectorAll('[data-action="select-case"]').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('button, a, select, input, textarea')) return;
      STATE.kanbanSelected = el.dataset.caseId;
      render();
    });
  });
  document.querySelectorAll('[data-action="toggle-sanity"]').forEach(el => {
    el.addEventListener('click', () => {
      STATE.sanityExpanded = !STATE.sanityExpanded;
      render();
    });
  });
  document.querySelectorAll('[data-action="toggle-picked-list"]').forEach(el => {
    el.addEventListener('click', () => {
      STATE.pickedListCollapsed = !STATE.pickedListCollapsed;
      render();
    });
  });
  document.querySelectorAll('table.case-table tbody tr').forEach(tr => {
    tr.addEventListener('click', () => { location.hash = tr.dataset.href; });
  });
  document.querySelectorAll('[data-action="kanban-select"]').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('button, a')) return;
      // Preserve scroll across the re-render: the window AND each kanban column's
      // own internal scroll (the columns have overflow-y: auto / max-height: 70vh,
      // so a plain innerHTML reset would snap every column back to the top).
      const sx = window.scrollX, sy = window.scrollY;
      const colScrolls = {};
      document.querySelectorAll('.kanban-column').forEach(col => {
        const body = col.querySelector('.kanban-col-body');
        if (col.dataset.colId && body) colScrolls[col.dataset.colId] = body.scrollTop;
      });
      STATE.kanbanSelected = card.dataset.caseId;
      render();
      window.scrollTo(sx, sy);
      document.querySelectorAll('.kanban-column').forEach(col => {
        const body = col.querySelector('.kanban-col-body');
        if (body && colScrolls[col.dataset.colId] != null) body.scrollTop = colScrolls[col.dataset.colId];
      });
    });
  });
  const resetLink = document.getElementById('reset-state');
  if (resetLink && resetLink.dataset.bound !== '1') {
    resetLink.addEventListener('click', e => {
      e.preventDefault();
      if (confirm('Reset all cases and operator selection to the original seed? This clears every change you have made.')) {
        resetState();
      }
    });
    resetLink.dataset.bound = '1';
  }
  document.querySelectorAll('[data-action="switch-op"]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      STATE.operatorId = el.dataset.opId;
      render();
    });
  });
  bindRotaEditor();
  bindRosterEditor();
  bindOwnersEditor();
  const lookbackLoad = document.getElementById('lookback-load');
  if (lookbackLoad) {
    const doLoad = () => {
      const from = parseFloat(document.getElementById('lookback-input').value);
      const toRaw = document.getElementById('lookback-to-input')?.value;
      const to = (toRaw === '' || toRaw == null) ? 0 : parseFloat(toRaw);
      const err = windowError(from, to);
      if (err) { showToast(err, 'warn'); return; }
      STATE.lookbackHours = from;
      STATE.lookbackToHours = to;
      try {
        localStorage.setItem('case-tracker-lookback', String(from));
        localStorage.setItem('case-tracker-lookback-to', String(to));
      } catch (e) { /* ignore */ }
      reloadLiveCases();
    };
    lookbackLoad.addEventListener('click', doLoad);
    document.getElementById('lookback-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLoad(); });
    document.getElementById('lookback-to-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLoad(); });
  }
  document.getElementById('refresh-existing')?.addEventListener('click', refreshAllStored);
  document.querySelectorAll('[data-action="bin-case"]').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); handleBinCase(el.dataset.caseId); });
  });
  document.querySelectorAll('[data-action="restore-case"]').forEach(el => {
    el.addEventListener('click', () => handleRestoreCase(el.dataset.caseId));
  });
  document.querySelectorAll('[data-action="purge-case"]').forEach(el => {
    el.addEventListener('click', () => handlePurgeCase(el.dataset.caseId));
  });
  document.querySelectorAll('[data-action="refresh-case"]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      refreshCase(el.dataset.caseId);
    });
  });
  const filter = document.getElementById('case-filter');
  if (filter) {
    filter.addEventListener('input', () => {
      const q = filter.value.toLowerCase();
      document.querySelectorAll('table.case-table tbody tr').forEach(tr => {
        tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
      document.querySelectorAll('.kanban-card').forEach(card => {
        card.style.display = card.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    });
  }
}

/* ---------- Reminders polling ---------- */

function checkReminders() {
  const now = realNow().getTime();
  let firedAny = purgeExpiredBin();   // also sweep the recycle bin for entries past 7 days
  for (const c of STATE.cases) {
    if (c.deletedAt) continue;
    if (!c.reminder || c.reminder.fired) continue;
    if (['closed', 'cancelled'].includes(c.status)) continue;
    if (new Date(c.reminder.fireAt).getTime() <= now) {
      c.reminder.fired = true;
      firedAny = true;
      showToast(`Reminder due: ${c.id} — ${c.subject}${c.reminder.note ? ' · ' + c.reminder.note : ''}`, 'warn');
    }
  }
  if (firedAny) render();
}

setInterval(checkReminders, REMINDER_POLL_MS);
setTimeout(checkReminders, REMINDER_FIRST_RUN_MS);
setInterval(updateClock, CLOCK_TICK_MS);

/* ---------- Live data (Case Center via local/serve.py) ---------- */

// Fill any board fields the API omits with safe defaults, so a partial Case Center record
// can't crash the renderer. The Python adapter (local/casecenter.py) maps Case Center
// statuses into the board's status enum; everything else falls back here.
function normalizeLiveCase(c) {
  const nowIso = new Date(NOW).toISOString();
  const createdAt = c.createdAt || c.slaStartedAt || nowIso;
  return Object.assign({
    flags: [],
    priority: 'medium',
    caseType: 'access',
    coreId: null, hqId: null, currentOwner: null,
    slaPaused: false, slaAccumulatedMs: 0,
    holdMs: { core: 0, hq: 0 }, holdStartedAt: null,
    lastOwnerContact: null,
    handover: null,
    reminder: undefined,
    agentStatus: 'unqueued',
    history: [],
    // Bucket into the week that contains createdAt; auto-create one if none fits, so a
    // brand-new case from a future/past week always lands somewhere.
    weekId: weekIdFor(createdAt),
    caseLink: '',
    requester: '',
    notes: '',
    subject: '(no subject)',
    slaStartedAt: c.createdAt || nowIso,
    createdAt: c.slaStartedAt || nowIso,
  }, c);
}

// Fields Case Center authoritatively owns — these are refreshed onto an existing case. Everything
// else (FIT/HQ routing, history, notes, clocks, queue, handover, reminder, flags) is
// operator-local and is PRESERVED across a refresh, so re-fetching a case never wipes the work
// you've done on it. `status` IS refreshed: when Case Center moves a case (e.g. resolved /
// returned to user), the board moves it to the matching column on the next refresh.
const CC_OWNED_FIELDS = [
  'subject', 'ccStatusLabel', 'priority', 'caseLink', 'status',
  'user', 'userDept', 'reporter', 'reporterDept', 'assignee', 'assigneeDept',
  'processTimeline',   // Case Center's per-stage processing log (drives the Process timeline)
  'waitUser',          // "Wait User" substatus detail (reason / due / last processor)
];
function overlayLiveCase(existing, raw) {
  for (const k of CC_OWNED_FIELDS) {
    if (raw[k] !== undefined) existing[k] = raw[k];
  }
  return existing;
}

// Push operator edits back to the local server so they get written into data.js.
// Fire-and-forget; only in live mode (served by serve.py).
// Tiny corner indicator: setSaveStatus('saving' | 'saved' | 'error', label?).
let _saveStatusTimer = null;
function setSaveStatus(state, label) {
  let el = document.getElementById('save-status');
  if (!el) { el = document.createElement('div'); el.id = 'save-status'; document.body.appendChild(el); }
  clearTimeout(_saveStatusTimer);
  if (state === 'saving') {
    el.className = 'show saving';
    el.innerHTML = '<span class="live-spinner"></span> ' + escapeHtml(label || 'Saving…');
  } else if (state === 'saved') {
    el.className = 'show saved';
    el.textContent = '✓ ' + (label || 'Saved');
    _saveStatusTimer = setTimeout(() => el.classList.remove('show'), 1800);
  } else if (state === 'error') {
    el.className = 'show error';
    el.textContent = '⚠ ' + (label || 'Save failed');
    _saveStatusTimer = setTimeout(() => el.classList.remove('show'), 4000);
  } else {
    el.classList.remove('show');
  }
}

function saveCasesToServer(cases) {
  if (!window.__LIVE__ || !/^https?:$/.test(location.protocol) || !cases.length) return;
  setSaveStatus('saving');
  try {
    fetch(apiUrl('api/save'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cases }),
    }).then(r => setSaveStatus(r.ok ? 'saved' : 'error'))
      .catch(() => setSaveStatus('error'));
  } catch (e) { setSaveStatus('error'); }
}

// Save a generated snippet to shifts.js / owners.js via the local server (Save buttons).
function saveJsFile(file, snippet, label) {
  if (!/^https?:$/.test(location.protocol)) { showToast('Run the board via serve.py to save files.', 'warn'); return; }
  setSaveStatus('saving', 'Saving ' + label + '…');
  fetch(apiUrl('api/save-file'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file, js: snippet }),
  }).then(r => {
    if (r.ok) { setSaveStatus('saved', 'Saved ' + label); showToast(label + ' saved.', 'success'); }
    else { setSaveStatus('error'); showToast('Save failed (' + r.status + ').', 'warn'); }
  }).catch(() => { setSaveStatus('error'); showToast('Save failed — is serve.py running?', 'warn'); });
}

// Persist ANY case that changed since the last save (queue, status, assignment, reminder,
// handover note, …). Called from saveState() in live mode; diffs against a snapshot so only
// changed cases are sent.
function persistChangedCases() {
  if (!window.__LIVE__) return;
  if (!STATE._savedSnapshot) STATE._savedSnapshot = {};
  const changed = [];
  for (const c of STATE.cases) {
    if (!c.id) continue;
    const j = JSON.stringify(c);
    if (STATE._savedSnapshot[c.id] !== j) {
      STATE._savedSnapshot[c.id] = j;
      changed.push(c);
    }
  }
  saveCasesToServer(changed);
}

// Try the local backend. Returns true if live Case Center data was loaded; false otherwise
// (public Pages demo, file://, or backend down) — in which case the seed data stays.
async function tryLoadLiveCases() {
  // Only meaningful when served over http(s) (i.e. by local/serve.py). Skip for file://
  // and avoid a noisy console error when someone just opens standalone.html directly.
  if (!/^https?:$/.test(location.protocol)) return false;
  let res;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), LIVE_FETCH_TIMEOUT_MS); // see CONFIG at top
    res = await fetch(liveCasesUrl(STATE.lookbackHours, STATE.lookbackToHours), { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    clearTimeout(t);
  } catch (e) {
    return false; // no local backend reachable → seed/demo mode
  }
  if (!res.ok) return false;
  let data;
  try { data = await res.json(); } catch (e) { return false; }
  const cases = Array.isArray(data) ? data : (data && data.cases);
  if (!Array.isArray(cases)) return false;

  // Validate the payload before trusting it: a usable case is a plain object with a
  // non-empty string id. Malformed rows would otherwise render as ghost cards, or collapse
  // together under the id-keyed merge below (every id-less row sharing the `undefined` key).
  const valid = [];
  let dropped = 0;
  for (const raw of cases) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)
        && typeof raw.id === 'string' && raw.id.trim()) valid.push(raw);
    else dropped++;
  }
  if (dropped) {
    console.warn(`Case Center: ignored ${dropped} malformed case record(s) (missing id or not an object).`);
    showToast(`Ignored ${dropped} malformed case record${dropped === 1 ? '' : 's'} from Case Center.`, 'warn');
  }
  // Rows came back but none were usable → keep what we already have rather than blanking the board.
  if (cases.length && !valid.length) return false;

  window.__LIVE__ = true;
  NOW = new Date(); // real time for SLA math against live timestamps
  if (window.CASES_LIVE_CAPTURE) {
    // data.js already holds the accumulated case store — MERGE the live query into it: refresh
    // Case Center fields on cases we already have (preserving operator work), add brand-new
    // cases, and keep the rest, so the board shows everything data.js has — not just the query.
    const byId = new Map(STATE.cases.map(c => [c.id, c]));
    for (const raw of valid) {
      const existing = byId.get(raw.id);
      if (existing) overlayLiveCase(existing, raw);
      else byId.set(raw.id, normalizeLiveCase(raw));
    }
    STATE.cases = [...byId.values()];
  } else {
    // Fresh demo seed (not a live store) → show just the live query result.
    STATE.cases = valid.map(normalizeLiveCase);
  }

  // Re-apply the operator's local layer (queue placement, handover notes, reminders) and snapshot
  // the result so only later edits POST back to the server.
  applyStoredAgentLayer();
  snapshotSavedCases();
  return true;
}

/* ---------- Boot ---------- */

// Small overlay shown while the live Case Center fetch is in flight.
function showLiveLoading() {
  if (document.getElementById('live-loading')) return;
  const el = document.createElement('div');
  el.id = 'live-loading';
  el.innerHTML = '<span class="live-spinner"></span> Loading cases from Case Center…';
  document.body.appendChild(el);
}
function hideLiveLoading() {
  document.getElementById('live-loading')?.remove();
}

// Re-fetch live cases (the "Load New" button) — queries Case Center for cases CREATED within
// the look-back window and merges them in. Use "Refresh Existing" to re-pull cases you already
// have without changing the query window.
async function reloadLiveCases() {
  showLiveLoading();
  const ok = await tryLoadLiveCases();
  hideLiveLoading();
  render();
  const window = STATE.lookbackToHours > 0
    ? `created between ${STATE.lookbackHours}h and ${STATE.lookbackToHours}h ago`
    : `created within ${STATE.lookbackHours}h`;
  showToast(
    ok ? `Loaded cases ${window} — ${STATE.cases.length} on the board.`
       : 'Could not load from Case Center (is serve.py running?).',
    ok ? 'success' : 'warn'
  );
}

// Enter live mode WITHOUT pulling from Case Center. Live mode = served by serve.py over http(s)
// with a persisted Case Center store (data.js carries CASES_LIVE_CAPTURE = true, written by
// serve.py on every fetch/save). seedBoot() has already adopted that store as STATE.cases, so we
// just flag live, re-apply the operator's local layer and snapshot for change-detection. A page
// refresh therefore shows exactly what's saved — Case Center is queried only when the operator
// presses "Load New" / "Refresh Existing".
function enterLiveMode() {
  window.__LIVE__ = true;
  NOW = new Date(); // real time for SLA math against live timestamps
  applyStoredAgentLayer();
  snapshotSavedCases();
}

function boot() {
  if (!location.hash) location.hash = '#/cases';
  if (window.CASES_LIVE_CAPTURE && /^https?:$/.test(location.protocol)) {
    enterLiveMode();
  }
  render();
}

boot();
