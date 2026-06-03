// Case Tracker prototype — single-file SPA.
// Renders the kanban board (Cases), Case Detail, Shifts and Archive views
// against the seed data in data.js. State is in-memory; reload resets.
//
// Two statuses per case:
//   c.status      = Case Center status (real external status; drives kanban columns).
//   c.agentStatus = first-line agent status ('queued' | 'unqueued'; drives the
//                   top/bottom band split inside each column).

const STATE = {
  cases: window.CASES.map(c => structuredClone(c)),
  operatorId: window.CURRENT_OPERATOR_ID,
  lastListRoute: '#/cases',
  lastListLabel: 'Cases',
};

const STORAGE_KEY = 'case-tracker-state-v3';

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      v: 3,
      cases: STATE.cases,
      operatorId: STATE.operatorId,
    }));
  } catch (e) { /* SecurityError on some file:// origins, ignore */ }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (parsed.v !== 3 || !Array.isArray(parsed.cases)) return false;
    STATE.cases = parsed.cases;
    if (parsed.operatorId && window.OPERATORS.some(o => o.id === parsed.operatorId)) {
      STATE.operatorId = parsed.operatorId;
    }
    return true;
  } catch (e) {
    return false;
  }
}

function resetState() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  STATE.cases = window.CASES.map(c => structuredClone(c));
  STATE.operatorId = window.CURRENT_OPERATOR_ID;
  STATE.lastListRoute = '#/cases';
  STATE.lastListLabel = 'Cases';
  render();
}

loadState();

const HOUR = 3600 * 1000;
const NOW = window.NOW;

/* ---------- Helpers ---------- */

function getOperator(id) { return window.OPERATORS.find(o => o.id === id); }
function getOwner(type, id) {
  if (!id) return null;
  return (type === 'fit' ? window.OWNERS.fit : window.OWNERS.hq).find(o => o.id === id) || null;
}
function caseById(id) { return STATE.cases.find(c => c.id === id); }

function caseSlaMs(c) {
  // Total accumulated SLA time, including the running segment if currently running.
  let total = c.slaAccumulatedMs || 0;
  if (!c.slaPaused && !['resolved', 'closed', 'cancelled'].includes(c.status)) {
    const start = new Date(c.slaStartedAt).getTime();
    total += Math.max(0, NOW.getTime() - start);
  }
  return total;
}
function caseHoldMs(c, kind /* 'fit' | 'hq' */) {
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
function fmtAbsolute(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const date = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 16);
  return `${date} ${time}Z`;
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
    with_fit: 'With Local FIT',
    with_hq: 'With HQ Product Team',
    sanity_check: 'Sanity Check',
    returned_to_requester: 'Returned to Requester',
    resolved: 'Resolved',
    closed: 'Closed',
    cancelled: 'Cancelled',
  })[s] || s;
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
  if (c.status === 'new' && !c.fitId) {
    prompts.push({ caseId: c.id, kind: 'assign_fit' });
  }
  if (c.status === 'with_fit' && c.fitCannotResolve) {
    prompts.push({ caseId: c.id, kind: 'escalate_to_hq' });
  } else if (c.status === 'with_fit' && ownerIdleHrs > window.THRESHOLDS.fitIdleHours) {
    prompts.push({ caseId: c.id, kind: 'chase_fit' });
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
  assign_fit:           { label: 'Assign to Local FIT',                  icon: 'A', cls: 'icon-assign',   action: 'Pick FIT' },
  chase_fit:            { label: 'Chase Local FIT — no response',        icon: 'C', cls: 'icon-chase',    action: 'Send reminder' },
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
  if (h.startsWith('#/archive/')) return { name: 'archiveWeek', id: h.slice('#/archive/'.length) };
  if (h.startsWith('#/archive')) return { name: 'archive' };
  if (h.startsWith('#/shifts/')) return { name: 'shiftDetail', shift: decodeURIComponent(h.slice('#/shifts/'.length)) };
  if (h.startsWith('#/shifts')) return { name: 'shifts' };
  if (h.startsWith('#/flow')) return { name: 'flow' };
  return { name: 'cases' };
}

window.addEventListener('hashchange', render);

/* ---------- Render dispatch ---------- */

function labelForRoute(route) {
  switch (route.name) {
    case 'cases': return 'Cases';
    case 'shifts': return 'Shifts';
    case 'shiftDetail': return `${route.shift} shift`;
    case 'archive': return 'Weekly Archive';
    case 'archiveWeek': {
      const w = window.WEEKS.find(w => w.id === route.id);
      return w ? w.label : 'Archive';
    }
    case 'flow': return 'Status Flow';
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
    archive: 'archive', archiveWeek: 'archive',
    shifts: 'shifts', shiftDetail: 'shifts',
    flow: 'flow',
  })[route.name];
  document.querySelector(`.nav a[data-route="${active}"]`)?.classList.add('active');

  if (route.name === 'cases') main.innerHTML = renderCaseList();
  else if (route.name === 'detail') main.innerHTML = renderCaseDetail(route.id);
  else if (route.name === 'archive') main.innerHTML = renderArchiveIndex();
  else if (route.name === 'archiveWeek') main.innerHTML = renderArchiveWeek(route.id);
  else if (route.name === 'shifts') main.innerHTML = renderShiftsIndex();
  else if (route.name === 'shiftDetail') main.innerHTML = renderShiftDetail(route.shift);
  else if (route.name === 'flow') main.innerHTML = renderStatusFlow();
  bindHandlers();
  saveState();
}

function renderSidebar() {
  if (!getOperator(STATE.operatorId)) {
    STATE.operatorId = window.CURRENT_OPERATOR_ID;
  }
  const op = getOperator(STATE.operatorId);
  // Operator switcher
  const sw = document.getElementById('op-switcher');
  if (sw && sw.dataset.populated !== '1') {
    sw.innerHTML = window.OPERATORS
      .map(o => `<option value="${o.id}">${escapeHtml(o.name)} (${escapeHtml(o.shift)})</option>`)
      .join('');
    sw.addEventListener('change', () => {
      STATE.operatorId = sw.value;
      render();
    });
    sw.dataset.populated = '1';
  }
  if (sw) sw.value = STATE.operatorId;

  document.getElementById('op-shift').textContent = op.shift;
  document.getElementById('op-ends').textContent = window.CURRENT_SHIFT.endsAtUtc.slice(11, 16) + 'Z';
  document.getElementById('op-week').textContent = window.CURRENT_WEEK.label;

  document.getElementById('nav-cases-count').textContent =
    STATE.cases.filter(c => !['closed', 'cancelled'].includes(c.status) && c.weekId === window.CURRENT_WEEK.id).length;
  const navShifts = document.getElementById('nav-shifts-count');
  if (navShifts) navShifts.textContent = window.SHIFTS.length;
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
    ? (inQ ? '✓ Queued' : '+ Queue')
    : (inQ ? '✓ Remove from queue' : '+ Add to queue');
  const title = inQ ? 'Remove from your queue (move to bottom band)' : 'Add to your queue (move to top band)';
  return `<button class="${cls} queue-toggle${inQ ? ' in-queue' : ''}" data-action="prompt" data-case-id="${c.id}" data-kind="toggle_queue" title="${escapeHtml(title)}" onclick="event.stopPropagation()">${escapeHtml(label)}</button>`;
}

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
    if (['closed', 'cancelled', 'resolved'].includes(c.status)) return false;
    if (c.slaPaused) return false;
    return caseSlaMs(c) / HOUR > window.THRESHOLDS.approachingSlaHours;
  }).sort((a, b) => caseSlaMs(b) - caseSlaMs(a));
}

function escalatedCases() {
  return STATE.cases.filter(c => {
    if (['closed', 'cancelled', 'resolved'].includes(c.status)) return false;
    return c.flags?.includes('escalated');
  });
}

// True when an open case lacks a fresh handover note authored during the current shift.
// Mirrors the rule from the old Shift Handover page: every open case must carry a note
// written by someone on the current shift. Writing one (from a card or the reading panel)
// clears the indicator.
function needsHandoverNote(c) {
  if (['closed', 'cancelled', 'new'].includes(c.status)) return false;
  if (!c.handover || c.handover.staleForCurrentShift) return true;
  const op = getOperator(STATE.operatorId);
  const author = getOperator(c.handover.author);
  return !author || author.shift !== op.shift;
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
    const owner = c.currentOwner ? getOwner(c.currentOwner, c.currentOwner === 'fit' ? c.fitId : c.hqId) : null;
    return `
      <a class="watch-row" href="#/cases/${c.id}">
        <span class="mono muted">${c.id}</span>
        <span class="watch-subject">${escapeHtml(c.subject)}</span>
        <span class="pill pill-${c.status}">${escapeHtml(statusLabel(c.status))}</span>
        <span class="muted tiny">${owner ? escapeHtml(owner.name.replace(/^(FIT|HQ) — /, '')) + ' · ' : ''}on us ${fmtDuration(caseSlaMs(c))}</span>
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

/* ---------- Case List view ---------- */

function renderCaseList() {
  const allCases = STATE.cases
    .filter(c => c.weekId === window.CURRENT_WEEK.id && !['closed', 'cancelled'].includes(c.status));
  const closedCount = STATE.cases
    .filter(c => c.weekId === window.CURRENT_WEEK.id && ['closed', 'cancelled'].includes(c.status)).length;

  // Columns = Case Center status (the real external status). Each column splits into a
  // top band (cases the first-line agent has queued / is actively working) and a bottom
  // band (everything else in that status) — the row dimension is the agent status.
  const columns = [
    { id: 'new',    label: 'New',                              statuses: ['new'] },
    { id: 'fit',    label: 'With Local FIT',                   statuses: ['with_fit'] },
    { id: 'hq',     label: 'With HQ Product Team',             statuses: ['with_hq'] },
    { id: 'review', label: 'Sanity Check / With Requester',    statuses: ['sanity_check', 'returned_to_requester'] },
  ];

  const sortCases = (a, b) => {
    const pri = { high: 0, medium: 1, low: 2 };
    const p = pri[a.priority] - pri[b.priority];
    if (p !== 0) return p;
    return new Date(b.createdAt) - new Date(a.createdAt);
  };

  const band = (cases, cls, header, emptyText) => `
    <div class="kanban-band ${cls}">
      <div class="kanban-band-header">
        <span>${escapeHtml(header)}</span>
        <span class="kanban-band-count">${cases.length}</span>
      </div>
      ${cases.length === 0
        ? `<div class="kanban-empty">${escapeHtml(emptyText)}</div>`
        : cases.map(renderKanbanCard).join('')}
    </div>
  `;

  const kanban = columns.map(col => {
    const colCases = allCases.filter(c => col.statuses.includes(c.status)).sort(sortCases);
    const top = colCases.filter(isQueued);
    const bottom = colCases.filter(c => !isQueued(c));
    return `
      <div class="kanban-column" data-col-id="${col.id}">
        <div class="kanban-col-header">
          <span>${escapeHtml(col.label)}</span>
          <span class="kanban-count">${colCases.length}</span>
        </div>
        <div class="kanban-col-body">
          ${band(top, 'kanban-band-top', 'My queue', 'Nothing queued.')}
          ${band(bottom, 'kanban-band-bottom', 'Backlog', 'No cases.')}
        </div>
      </div>
    `;
  }).join('');

  const selected = STATE.kanbanSelected ? caseById(STATE.kanbanSelected) : null;
  // Auto-clear if selected case no longer exists or moved out of this week.
  const validSelection = selected && selected.weekId === window.CURRENT_WEEK.id;
  const readingPanel = renderReadingPanel(validSelection ? selected : null);

  const queuedCount = allCases.filter(isQueued).length;

  // Handover awareness — replaces the old standalone Shift Handover page. When the shift
  // is ending, surface how many open cases still need a fresh note; the agent writes them
  // straight from the cards / reading panel below.
  const handoverPending = handoverPendingCases();
  const handoverBanner = handoverPending.length > 0 ? `
    <div class="kanban-handover-banner">
      <div>
        <strong>Shift ending:</strong> ${handoverPending.length} open case${handoverPending.length === 1 ? '' : 's'} still need a fresh ${escapeHtml(getOperator(STATE.operatorId).shift)}-shift handover note. Write each from its card or the reading panel.
      </div>
    </div>
  ` : '';

  const dueReminders = STATE.cases.filter(c =>
    c.reminder && c.reminder.fired && !['closed', 'cancelled'].includes(c.status)
  );
  const remindersBanner = dueReminders.length > 0 ? `
    <div class="reminders-due">
      <div class="reminders-due-header">${BELL_SVG} Reminders due <span class="muted">(${dueReminders.length})</span></div>
      ${dueReminders.map(c => `
        <div class="reminder-row">
          <div>
            <div class="row-flex">
              <a class="mono" href="#/cases/${c.id}">${c.id}</a>
              <span class="pill pill-${c.status}">${escapeHtml(statusLabel(c.status))}</span>
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

  const watchlist = renderWatchlists(approachingSlaCases(), escalatedCases());

  return `
    <div class="page-header">
      <div>
        <h1>Board · ${escapeHtml(window.CURRENT_WEEK.label)}</h1>
        <div class="subtitle">${allCases.length} open · ${queuedCount} in your queue · ${closedCount} closed/cancelled this week. Columns are the Case Center status; <span class="mono">+ Queue</span> lifts a card into your top band.</div>
      </div>
      <div class="toolbar">
        <input type="search" placeholder="Filter by subject, ID…" id="case-filter">
        <button class="btn btn-primary" data-action="prompt" data-kind="new_case">+ New case</button>
      </div>
    </div>
    ${remindersBanner}
    ${handoverBanner}
    <div class="kanban">${kanban}</div>
    <div class="reading-panel">${readingPanel}</div>
    ${watchlist}
  `;
}

function renderKanbanCard(c) {
  const flags = (c.flags || []).map(f => `<span class="flag flag-${f}">${escapeHtml(f.replace(/_/g, ' '))}</span>`).join(' ');
  const owner = c.currentOwner ? getOwner(c.currentOwner, c.currentOwner === 'fit' ? c.fitId : c.hqId) : null;
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

  return `
    <div class="kanban-card ${isSel ? 'is-selected' : ''}" data-action="kanban-select" data-case-id="${c.id}">
      <div class="kanban-card-head">
        <span class="mono muted">${c.id}</span>
        <div class="kanban-card-head-right">
          <span class="priority-${c.priority}">${escapeHtml(c.priority)}</span>
          ${bellState}
          ${isQueued(c) ? '<span class="kanban-queued" title="In your queue">★</span>' : ''}
        </div>
      </div>
      ${flags ? `<div class="kanban-card-flags">${flags}</div>` : ''}
      <div class="kanban-card-subject">${escapeHtml(c.subject)}</div>
      <div class="kanban-card-meta">
        <span>${owner ? escapeHtml(owner.name.replace(/^(FIT|HQ) — /, '')) : '<span class="muted">unassigned</span>'}</span>
        <span class="muted">${fmtDuration(caseSlaMs(c))}${c.slaPaused ? ' ⏸' : ''}</span>
      </div>
      <div class="kanban-card-actions">
        ${primaryBtn}
        ${handoverBtn}
        ${renderQueueToggleButton(c, 'tiny')}
      </div>
    </div>
  `;
}

function renderReadingPanel(c) {
  if (!c) {
    return `<div class="reading-empty">Click a case above to read its full detail here.</div>`;
  }
  const flags = (c.flags || []).map(f => `<span class="flag flag-${f}">${escapeHtml(f.replace(/_/g, ' '))}</span>`).join(' ');
  const actions = renderDetailActions(c);

  return `
    <div class="reading-header">
      <div>
        <div class="row-flex">
          <a class="mono muted" href="#/cases/${c.id}">${c.id}</a>
          <span class="pill pill-${c.status}">${escapeHtml(statusLabel(c.status))}</span>
          <span class="priority-${c.priority}">${escapeHtml(c.priority)} priority</span>
          ${flags}
        </div>
        <h2 style="margin-top:6px;">${escapeHtml(c.subject)}</h2>
        <div class="muted tiny"><a href="${escapeHtml(c.caseLink)}" target="_blank" rel="noreferrer">${escapeHtml(c.caseLink)}</a></div>
      </div>
      <div class="reading-actions">${actions}</div>
    </div>
    ${renderCaseDetailBody(c)}
  `;
}

/* ---------- Case Detail view ---------- */

function renderCaseDetailBody(c) {
  const fit = getOwner('fit', c.fitId);
  const hq = getOwner('hq', c.hqId);

  const slaMs = caseSlaMs(c);
  const fitMs = caseHoldMs(c, 'fit');
  const hqMs = caseHoldMs(c, 'hq');

  const handoverHtml = c.handover ? `
    <div class="handover-note ${c.handover.staleForCurrentShift ? 'handover-stale' : ''}">
      ${escapeHtml(c.handover.note)}
      <div class="meta">
        ${escapeHtml(c.handover.from)} → ${escapeHtml(c.handover.to)} ·
        ${escapeHtml(c.handover.author)} · ${fmtAbsolute(c.handover.at)}
        ${c.handover.staleForCurrentShift ? ' · <strong>stale for current shift</strong>' : ''}
      </div>
    </div>
  ` : `<div class="muted tiny">No handover note.</div>`;

  const history = (c.history || []).slice().reverse().map(h => `
    <li>
      <span class="when">${fmtAbsolute(h.at)}</span>
      <span><strong>${escapeHtml(h.kind)}</strong> by ${escapeHtml(h.who)}${h.detail ? ' — ' + escapeHtml(h.detail) : ''}</span>
    </li>
  `).join('');

  return `
    <div class="detail-grid">
      <div>
        <div class="card"><div class="card-body">
          <div class="detail-section">
            <h3>Two clocks</h3>
            <div class="clock-grid">
              <div class="clock">
                <div class="label">SLA clock (time on us)</div>
                <div class="value">${fmtDuration(slaMs)}</div>
                <div class="state ${c.slaPaused ? 'paused' : 'running'}">${c.slaPaused ? 'Paused (with requester)' : 'Running'}</div>
              </div>
              <div class="clock">
                <div class="label">Owner-hold totals</div>
                <div class="value mono" style="font-size:13px;">FIT ${fmtDuration(fitMs)} · HQ ${fmtDuration(hqMs)}</div>
                <div class="state ${c.currentOwner ? 'running' : ''}">${c.currentOwner ? `Active: ${c.currentOwner.toUpperCase()}` : 'No active owner'}</div>
              </div>
            </div>
          </div>
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
            <div class="detail-row"><span class="k">Requester</span><span class="v">${escapeHtml(c.requester)}</span></div>
            <div class="detail-row"><span class="k">Local FIT</span><span class="v">${fit ? `${escapeHtml(fit.name)} ${renderTzHint(fit)}` : '<span class="muted">— unassigned</span>'} <button class="btn-tiny" data-action="reassign" data-case-id="${c.id}" data-type="fit">${fit ? 'Change' : 'Assign'}</button></span></div>
            <div class="detail-row"><span class="k">HQ Product Team</span><span class="v">${hq ? `${escapeHtml(hq.name)} ${renderTzHint(hq)}` : '<span class="muted">— unassigned</span>'} <button class="btn-tiny" data-action="reassign" data-case-id="${c.id}" data-type="hq">${hq ? 'Change' : 'Assign'}</button></span></div>
            <div class="detail-row"><span class="k">Current owner</span><span class="v">${c.currentOwner ? c.currentOwner.toUpperCase() : '<span class="muted">unassigned</span>'}</span></div>
            <div class="detail-row"><span class="k">Last contact</span><span class="v">${c.lastOwnerContact ? `${escapeHtml(c.lastOwnerContact.channel)} · ${fmtRelative(c.lastOwnerContact.at)}` : '<span class="muted">—</span>'}</span></div>
          </div>
          <div class="detail-section">
            <h3>Filing</h3>
            <div class="detail-row"><span class="k">Status</span><span class="v">${escapeHtml(statusLabel(c.status))}</span></div>
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
  const flags = (c.flags || []).map(f => `<span class="flag flag-${f}">${escapeHtml(f.replace(/_/g, ' '))}</span>`).join(' ');
  const actions = renderDetailActions(c);

  return `
    <div class="page-header">
      <div>
        <div class="row-flex">
          <a class="btn-link" href="${escapeHtml(STATE.lastListRoute)}">← ${escapeHtml(STATE.lastListLabel)}</a>
          <span class="mono muted">${c.id}</span>
          <span class="pill pill-${c.status}">${escapeHtml(statusLabel(c.status))}</span>
          <span class="priority-${c.priority}">${escapeHtml(c.priority)} priority</span>
          ${flags}
        </div>
        <h1 style="margin-top:8px">${escapeHtml(c.subject)}</h1>
        <div class="subtitle"><a href="${escapeHtml(c.caseLink)}" target="_blank" rel="noreferrer">${escapeHtml(c.caseLink)}</a></div>
      </div>
      <div class="toolbar">${actions}</div>
    </div>

    ${renderCaseDetailBody(c)}
  `;
}

function renderDetailActions(c) {
  const items = [];

  // Status transitions consolidated into a dropdown — primary CTA, listed first.
  const transitions = statusTransitions(c);
  if (transitions.length > 0) {
    const opts = transitions.map(t =>
      `<option value="${t.kind}"${t.danger ? ' class="danger"' : ''}>${escapeHtml(t.label)}</option>`
    ).join('');
    items.push(`
      <select class="status-dropdown" data-action="status-select" data-case-id="${c.id}">
        <option value="" disabled selected>Change status…</option>
        ${opts}
      </select>
    `);
  }

  // Non-status actions stay as buttons.
  if (c.status === 'with_fit') {
    items.push(`<button class="btn" data-action="prompt" data-case-id="${c.id}" data-kind="chase_fit">Send reminder to FIT</button>`);
  }
  if (c.status === 'with_hq') {
    items.push(`<button class="btn" data-action="prompt" data-case-id="${c.id}" data-kind="chase_hq">Send reminder to HQ</button>`);
  }
  if (!['closed', 'cancelled'].includes(c.status)) {
    items.push(`<button class="btn" data-action="prompt" data-case-id="${c.id}" data-kind="end_of_shift_handover">Write handover note</button>`);
  }

  items.push(renderBellButton(c, 'detail'));
  items.push(renderQueueToggleButton(c, 'normal'));

  return items.join(' ');
}

function statusTransitions(c) {
  const t = [];
  switch (c.status) {
    case 'new':
      t.push({ kind: 'assign_fit', label: 'Assign to Local FIT' });
      break;
    case 'with_fit':
      t.push({ kind: 'escalate_to_hq', label: 'Escalate to HQ Product Team' });
      t.push({ kind: 'approaching_sla', label: 'Return to requester' });
      break;
    case 'with_hq':
      t.push({ kind: 'move_to_sanity_check', label: 'Move to Sanity Check' });
      t.push({ kind: 'approaching_sla', label: 'Return to requester' });
      break;
    case 'sanity_check':
      t.push({ kind: 'verify_fix', label: 'Verify & close' });
      break;
    case 'returned_to_requester':
      t.push({ kind: 'resume', label: 'Requester replied — resume' });
      t.push({ kind: 'close_resolved', label: 'Close as resolved' });
      break;
  }
  if (!['closed', 'cancelled'].includes(c.status)) {
    t.push({ kind: 'cancel', label: 'Cancel case', danger: true });
  }
  return t;
}

/* ---------- Weekly Archive ---------- */

function weekStats(weekId) {
  const cases = STATE.cases.filter(c => c.weekId === weekId);
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
  return `
    <div class="page-header">
      <div>
        <h1>Weekly Archive</h1>
        <div class="subtitle">Browse past weekly workbooks. Each week is a snapshot — cases that carried over move to the next week's filing.</div>
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
    .filter(c => c.weekId === weekId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const rows = cases.length === 0 ? '' : cases.map(c => {
    const fit = getOwner('fit', c.fitId);
    const hq = getOwner('hq', c.hqId);
    const flags = (c.flags || []).map(f => `<span class="flag flag-${f}">${escapeHtml(f.replace(/_/g, ' '))}</span>`).join(' ');
    const carry = c.carriedFrom ? ` <span class="flag" title="Carried from ${escapeHtml(c.carriedFrom)}">↩ ${escapeHtml(c.carriedFrom)}</span>` : '';
    return `
      <tr data-href="#/cases/${c.id}">
        <td class="col-id">${c.id}</td>
        <td>
          <div class="subject">${escapeHtml(c.subject)}</div>
          <div><a class="link-inline" href="${escapeHtml(c.caseLink)}" target="_blank" rel="noreferrer" onclick="event.stopPropagation()">case-center ↗</a></div>
        </td>
        <td>${escapeHtml(c.requester)}</td>
        <td>${fit ? escapeHtml(fit.name) : '<span class="muted">—</span>'}</td>
        <td>${hq ? escapeHtml(hq.name) : '<span class="muted">—</span>'}</td>
        <td><span class="pill pill-${c.status}">${escapeHtml(statusLabel(c.status))}</span> ${flags}${carry}</td>
        <td>${fmtDuration(caseSlaMs(c))}${c.slaPaused ? ' <span class="muted tiny">(paused)</span>' : ''}</td>
        <td class="muted tiny">${c.closedAt ? fmtRelative(c.closedAt) : fmtRelative(c.createdAt)}</td>
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
            <th>Requester</th>
            <th>Local FIT</th>
            <th>HQ Product Team</th>
            <th>Status</th>
            <th>Process Time</th>
            <th>${week.isCurrent ? 'Created' : 'Closed'}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `}
  `;
}

/* ---------- Shifts ---------- */

function shiftStats(shiftName) {
  const opIds = window.SHIFTS.find(s => s.name === shiftName)?.operatorIds || [];
  const open = STATE.cases.filter(c => !['closed', 'cancelled'].includes(c.status));
  const handedTo = open.filter(c => c.handover?.to === shiftName);
  const handedFrom = open.filter(c => c.handover?.from === shiftName);
  const writtenByShift = open.filter(c => c.handover && opIds.includes(c.handover.author));
  const missingForShift = open.filter(c => c.status !== 'new' && (!c.handover || c.handover.to !== shiftName));
  return { handedTo, handedFrom, writtenByShift, missingForShift, opIds };
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
        <div class="shift-hours">${escapeHtml(sh.hoursUtc)}</div>
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
            <span class="pill pill-${c.status}">${escapeHtml(statusLabel(c.status))}</span>
          </div>
          <div style="font-weight:500; margin-top:4px;">${escapeHtml(c.subject)}</div>
        </div>
        <div>${status}</div>
        <div class="muted tiny">${c.handover ? fmtRelative(c.handover.at) : '—'}</div>
      </div>
    `;
  };

  // Recent handover activity from history across all open cases.
  const allOpen = STATE.cases.filter(c => !['closed', 'cancelled'].includes(c.status));
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
        <div class="row-flex">
          <a class="btn-link mono" href="#/shifts">← shifts</a>
          ${isCurrent ? '<span class="badge-current">On now</span>' : '<span class="flag">Off shift</span>'}
        </div>
        <h1 style="margin-top:8px">${escapeHtml(sh.name)} shift</h1>
        <div class="subtitle">${escapeHtml(sh.hoursUtc)} · handover boundary with ${escapeHtml(otherShift)} shift</div>
      </div>
    </div>

    <div class="tabs">${tabs}</div>

    <div class="summary-bar">
      <div class="stat"><div class="v">${s.handedTo.length}</div><div class="k">Cases handed to ${escapeHtml(sh.name)}</div></div>
      <div class="stat"><div class="v">${s.handedFrom.length}</div><div class="k">Cases handed from ${escapeHtml(sh.name)}</div></div>
      <div class="stat"><div class="v">${s.writtenByShift.length}</div><div class="k">Notes authored by shift</div></div>
      <div class="stat"><div class="v">${s.missingForShift.length}</div><div class="k">Open cases missing a note for ${escapeHtml(sh.name)}</div></div>
    </div>

    <div class="section-block">
      <div class="section-block-header"><span>Roster</span></div>
      <div style="padding: 8px 16px;">${ops}</div>
    </div>

    <div class="section-block">
      <div class="section-block-header">
        <span>Cases handed to ${escapeHtml(sh.name)} shift</span>
        <span class="muted tiny">${s.handedTo.length} case${s.handedTo.length === 1 ? '' : 's'}</span>
      </div>
      <div class="section-block-body">
        ${s.handedTo.length === 0 ? '<div class="section-block-empty">No fresh handover notes addressed to this shift.</div>' : s.handedTo.map(renderCaseRow).join('')}
      </div>
    </div>

    <div class="section-block">
      <div class="section-block-header">
        <span>Open cases missing a note for ${escapeHtml(sh.name)} shift</span>
        <span class="muted tiny">${s.missingForShift.length} case${s.missingForShift.length === 1 ? '' : 's'}</span>
      </div>
      <div class="section-block-body">
        ${s.missingForShift.length === 0 ? '<div class="section-block-empty">All open cases have a current note for this shift.</div>' : s.missingForShift.map(renderCaseRow).join('')}
      </div>
    </div>

    <div class="section-block">
      <div class="section-block-header"><span>Recent handover activity by this shift</span></div>
      <ul class="activity-list">${activityHtml}</ul>
    </div>
  `;
}

/* ---------- Status Flow ---------- */

function renderStatusFlow() {
  return `
    <div class="page-header">
      <div>
        <h1>Status Flow</h1>
        <div class="subtitle">How a case moves through the lifecycle. Each arrow corresponds to a single option in the Change status… dropdown.</div>
      </div>
    </div>

    <div class="flow-container">
      <svg class="status-flow-svg" viewBox="0 0 980 580" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="arr-forward" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 Z" fill="#2563eb"/>
          </marker>
          <marker id="arr-pause" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 Z" fill="#0891b2"/>
          </marker>
          <marker id="arr-danger" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 Z" fill="#dc2626"/>
          </marker>
        </defs>

        <g class="flow-node">
          <rect x="40" y="40" width="120" height="60" rx="8" fill="#e0e7ff" stroke="#3730a3" stroke-width="2"/>
          <text x="100" y="76" text-anchor="middle" font-weight="600" font-size="13">New</text>
        </g>
        <g class="flow-node">
          <rect x="220" y="40" width="160" height="60" rx="8" fill="#fef3c7" stroke="#92400e" stroke-width="2"/>
          <text x="300" y="76" text-anchor="middle" font-weight="600" font-size="13">With Local FIT</text>
        </g>
        <g class="flow-node">
          <rect x="440" y="40" width="180" height="60" rx="8" fill="#fee2e2" stroke="#991b1b" stroke-width="2"/>
          <text x="530" y="68" text-anchor="middle" font-weight="600" font-size="13">With HQ</text>
          <text x="530" y="86" text-anchor="middle" font-size="11">Product Team</text>
        </g>
        <g class="flow-node">
          <rect x="680" y="40" width="160" height="60" rx="8" fill="#d1fae5" stroke="#065f46" stroke-width="2"/>
          <text x="760" y="76" text-anchor="middle" font-weight="600" font-size="13">Sanity Check</text>
        </g>

        <g class="flow-node">
          <rect x="300" y="250" width="240" height="60" rx="8" fill="#cffafe" stroke="#155e75" stroke-width="2"/>
          <text x="420" y="278" text-anchor="middle" font-weight="600" font-size="13">Returned to Requester</text>
          <text x="420" y="296" text-anchor="middle" font-size="11" fill="#155e75">SLA clock paused</text>
        </g>

        <g class="flow-node">
          <rect x="680" y="450" width="160" height="60" rx="8" fill="#e5e7eb" stroke="#4b5563" stroke-width="2"/>
          <text x="760" y="486" text-anchor="middle" font-weight="600" font-size="13">Closed</text>
        </g>

        <g class="flow-node">
          <rect x="40" y="450" width="160" height="60" rx="8" fill="#f3f4f6" stroke="#6b7280" stroke-width="2" stroke-dasharray="4,3"/>
          <text x="120" y="486" text-anchor="middle" font-weight="600" font-size="13" fill="#6b7280">Cancelled</text>
        </g>

        <g stroke="#2563eb" stroke-width="2" fill="none">
          <path d="M160,70 L218,70" marker-end="url(#arr-forward)"/>
          <path d="M380,70 L438,70" marker-end="url(#arr-forward)"/>
          <path d="M620,70 L678,70" marker-end="url(#arr-forward)"/>
          <path d="M760,100 L760,448" marker-end="url(#arr-forward)"/>
        </g>
        <g font-size="11" fill="#2563eb" font-weight="500">
          <text x="189" y="34" text-anchor="middle">Assign FIT</text>
          <text x="409" y="34" text-anchor="middle">Escalate to HQ</text>
          <text x="649" y="34" text-anchor="middle">Move to Sanity</text>
          <text x="772" y="280" text-anchor="start">Verify &amp; close</text>
        </g>

        <g stroke="#0891b2" stroke-width="2" fill="none">
          <path d="M260,100 L340,248" marker-end="url(#arr-pause)"/>
          <path d="M520,100 L470,248" marker-end="url(#arr-pause)"/>
        </g>
        <g font-size="11" fill="#0891b2" font-weight="500">
          <text x="248" y="180" text-anchor="end">Return to requester</text>
          <text x="540" y="180" text-anchor="start">Return to requester</text>
        </g>

        <g stroke="#0891b2" stroke-width="1.5" fill="none" stroke-dasharray="5,4">
          <path d="M360,250 Q310,180 290,100" marker-end="url(#arr-pause)"/>
          <path d="M490,250 Q500,180 520,100" marker-end="url(#arr-pause)"/>
          <path d="M540,275 Q650,210 740,102" marker-end="url(#arr-pause)"/>
          <path d="M300,275 Q200,210 110,102" marker-end="url(#arr-pause)"/>
        </g>
        <g font-size="11" fill="#0891b2" font-style="italic">
          <text x="610" y="220" text-anchor="middle">Resume (requester replied)</text>
          <text x="200" y="220" text-anchor="middle">Resume (requester replied)</text>
        </g>

        <path d="M540,300 L678,460" stroke="#2563eb" stroke-width="2" fill="none" marker-end="url(#arr-forward)"/>
        <text x="640" y="395" font-size="11" fill="#2563eb" text-anchor="middle" font-weight="500">Close as resolved</text>

        <path d="M100,100 Q40,280 120,448" stroke="#dc2626" stroke-width="1.5" fill="none" stroke-dasharray="5,4" marker-end="url(#arr-danger)"/>
        <g font-size="11" fill="#dc2626" font-style="italic">
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

    <h2 style="margin-top:24px;">Transitions reference</h2>
    <table class="transition-table">
      <thead>
        <tr><th>From</th><th>Action (Change status… dropdown)</th><th>To</th><th>Effect on clocks</th></tr>
      </thead>
      <tbody>
        <tr><td><span class="pill pill-new">New</span></td><td>Assign to Local FIT</td><td><span class="pill pill-with_fit">With Local FIT</span></td><td>FIT hold-clock starts</td></tr>
        <tr><td><span class="pill pill-with_fit">With Local FIT</span></td><td>Escalate to HQ Product Team</td><td><span class="pill pill-with_hq">With HQ Product Team</span></td><td>FIT clock stops · HQ clock starts</td></tr>
        <tr><td><span class="pill pill-with_fit">With Local FIT</span></td><td>Return to requester</td><td><span class="pill pill-returned_to_requester">Returned to Requester</span></td><td>SLA pauses · FIT clock stops</td></tr>
        <tr><td><span class="pill pill-with_hq">With HQ Product Team</span></td><td>Move to Sanity Check</td><td><span class="pill pill-sanity_check">Sanity Check</span></td><td>HQ clock stops</td></tr>
        <tr><td><span class="pill pill-with_hq">With HQ Product Team</span></td><td>Return to requester</td><td><span class="pill pill-returned_to_requester">Returned to Requester</span></td><td>SLA pauses · HQ clock stops</td></tr>
        <tr><td><span class="pill pill-sanity_check">Sanity Check</span></td><td>Verify &amp; close</td><td><span class="pill pill-closed">Closed</span></td><td>All clocks stop · resolution recorded</td></tr>
        <tr><td><span class="pill pill-returned_to_requester">Returned to Requester</span></td><td>Requester replied — resume</td><td>FIT / HQ / Sanity Check / New <span class="muted tiny">(operator picks)</span></td><td>SLA resumes · owner clock restarts</td></tr>
        <tr><td><span class="pill pill-returned_to_requester">Returned to Requester</span></td><td>Close as resolved</td><td><span class="pill pill-closed">Closed</span></td><td>All clocks stop · resolution recorded</td></tr>
        <tr><td>Any non-terminal</td><td>Cancel case</td><td><span class="pill pill-cancelled">Cancelled</span></td><td>All clocks stop · no resolution code</td></tr>
      </tbody>
    </table>
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

function handlePrompt(caseId, kind) {
  const op = getOperator(STATE.operatorId);

  if (kind === 'new_case') {
    handleNewCase(op);
    return;
  }

  const c = caseById(caseId);
  if (!c) return;

  if (kind === 'assign_fit') {
    const opts = window.OWNERS.fit.map(f => `<option value="${f.id}"${f.id === c.fitId ? ' selected' : ''}>${escapeHtml(f.name)} (${escapeHtml(f.region)})</option>`).join('');
    showModal(`
      <h3>Assign to Local FIT</h3>
      <div class="modal-sub">Pick the FIT desk that should triage this case.</div>
      <label>FIT desk</label>
      <select data-field="fitId">${opts}</select>
      <div class="modal-actions">
        <button class="btn" data-modal-cancel>Cancel</button>
        <button class="btn btn-primary" data-modal-submit>Assign</button>
      </div>
    `, (modal) => {
      const fitId = modal.querySelector('[data-field="fitId"]').value;
      c.fitId = fitId;
      c.currentOwner = 'fit';
      c.status = 'with_fit';
      c.holdStartedAt = new Date(NOW).toISOString();
      c.lastOwnerContact = { at: new Date(NOW).toISOString(), channel: 'Slack' };
      const fitName = getOwner('fit', fitId).name;
      c.history.push({ at: new Date(NOW).toISOString(), who: op.id, kind: 'assigned', detail: `Local FIT — ${fitName}` });
      showToast(`${c.id} assigned to ${fitName}. Status is now With Local FIT.`, 'success');
      render();
      return true;
    });
    return;
  }

  if (kind === 'escalate_to_hq') {
    const opts = window.OWNERS.hq.map(h => `<option value="${h.id}"${h.id === c.hqId ? ' selected' : ''}>${escapeHtml(h.name)} (${escapeHtml(h.area)})</option>`).join('');
    showModal(`
      <h3>Escalate to HQ Product Team</h3>
      <div class="modal-sub">FIT can't resolve. Pick the HQ team that owns this area.</div>
      <label>HQ team</label>
      <select data-field="hqId">${opts}</select>
      <label>Reason (optional)</label>
      <textarea data-field="reason" placeholder="What did FIT find?"></textarea>
      <div class="modal-actions">
        <button class="btn" data-modal-cancel>Cancel</button>
        <button class="btn btn-primary" data-modal-submit>Escalate</button>
      </div>
    `, (modal) => {
      const hqId = modal.querySelector('[data-field="hqId"]').value;
      const reason = modal.querySelector('[data-field="reason"]').value.trim();
      // stop FIT clock, start HQ clock
      if (c.currentOwner === 'fit' && c.holdStartedAt) {
        c.holdMs.fit += new Date(NOW) - new Date(c.holdStartedAt);
      }
      c.hqId = hqId;
      c.currentOwner = 'hq';
      c.status = 'with_hq';
      c.holdStartedAt = new Date(NOW).toISOString();
      c.fitCannotResolve = false;
      c.lastOwnerContact = { at: new Date(NOW).toISOString(), channel: 'JIRA' };
      const hqName = getOwner('hq', hqId).name;
      c.history.push({ at: new Date(NOW).toISOString(), who: op.id, kind: 'escalated', detail: `FIT → ${hqName}${reason ? ' · ' + reason : ''}` });
      showToast(`${c.id} escalated to ${hqName}. FIT clock stopped, HQ clock running.`, 'success');
      render();
      return true;
    });
    return;
  }

  if (kind === 'chase_fit' || kind === 'chase_hq') {
    const owner = c.currentOwner === 'fit' ? getOwner('fit', c.fitId) : getOwner('hq', c.hqId);
    const channel = c.currentOwner === 'fit' ? 'Slack' : 'JIRA';
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
      const msg = modal.querySelector('[data-field="msg"]').value.trim();
      c.lastOwnerContact = { at: new Date(NOW).toISOString(), channel };
      c.history.push({ at: new Date(NOW).toISOString(), who: op.id, kind: 'reminder', detail: `Reminder via ${channel}${msg ? ': ' + msg : ''}` });
      const threshold = c.currentOwner === 'fit' ? window.THRESHOLDS.fitIdleHours : window.THRESHOLDS.hqIdleHours;
      showToast(`Reminder sent to ${owner?.name || 'owner'} via ${channel}. ${c.id} stays with ${c.currentOwner === 'fit' ? 'FIT' : 'HQ'}; it will re-prompt for a chase in ${threshold}h if there's no reply.`, 'success');
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
      const code = modal.querySelector('[data-field="code"]').value;
      const note = modal.querySelector('[data-field="note"]').value.trim();
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
      c.history.push({ at: new Date(NOW).toISOString(), who: op.id, kind: 'closed', detail: `Resolution: ${code} · ${note}` });
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
      const reason = modal.querySelector('[data-field="reason"]').value.trim();
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
      c.history.push({ at: new Date(NOW).toISOString(), who: op.id, kind: 'returned', detail: `Returned to requester · ${reason}` });
      showToast(`${c.id} returned to ${c.requester}. SLA clock paused. Resume from the case detail when they reply.`, 'success');
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
      const note = modal.querySelector('[data-field="note"]').value.trim();
      if (!note) { alert('Handover note is required.'); return false; }
      const target = op.shift === 'Day' ? 'Night' : 'Day';
      c.handover = { note, author: op.id, from: op.shift, to: target, at: new Date(NOW).toISOString(), staleForCurrentShift: false };
      c.history.push({ at: new Date(NOW).toISOString(), who: op.id, kind: 'handover', detail: `Handover note (${op.shift} → ${target})` });
      showToast(`Handover note saved for ${c.id} (${op.shift} → ${target}).`, 'success');
      render();
      return true;
    });
    return;
  }

  if (kind === 'resume') {
    const fit = getOwner('fit', c.fitId);
    const hq = getOwner('hq', c.hqId);
    const opts = [];
    if (c.fitId) opts.push(`<option value="fit">Resume with ${escapeHtml(fit.name)} (Local FIT)</option>`);
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
      const dest = modal.querySelector('[data-field="dest"]').value;
      const note = modal.querySelector('[data-field="note"]').value.trim();

      // Resume SLA clock: open a new running segment from NOW.
      c.slaPaused = false;
      c.slaStartedAt = new Date(NOW).toISOString();

      let detail;
      if (dest === 'fit') {
        c.currentOwner = 'fit';
        c.status = 'with_fit';
        c.holdStartedAt = new Date(NOW).toISOString();
        c.lastOwnerContact = { at: new Date(NOW).toISOString(), channel: 'Slack' };
        detail = `Requester replied · resumed to Local FIT (${getOwner('fit', c.fitId).name})`;
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
        c.fitId = null;
        c.hqId = null;
        c.fitCannotResolve = false;
        detail = `Requester replied · resumed unassigned (FIT/HQ cleared)`;
      }
      if (note) detail += ` · ${note}`;
      c.history.push({ at: new Date(NOW).toISOString(), who: op.id, kind: 'resumed', detail });
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
      const code = modal.querySelector('[data-field="code"]').value;
      const note = modal.querySelector('[data-field="note"]').value.trim();
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
      c.history.push({ at: new Date(NOW).toISOString(), who: op.id, kind: 'closed', detail: `Resolution: ${code} · ${note}` });
      showToast(`${c.id} closed (${code}).`, 'success');
      render();
      return true;
    });
    return;
  }

  if (kind === 'move_to_sanity_check') {
    c.status = 'sanity_check';
    c.history.push({ at: new Date(NOW).toISOString(), who: op.id, kind: 'status', detail: '→ Sanity Check' });
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
      const reason = modal.querySelector('[data-field="reason"]').value.trim();
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
      c.history.push({ at: new Date(NOW).toISOString(), who: op.id, kind: 'cancelled', detail: reason });
      showToast(`${c.id} cancelled.`, 'warn');
      render();
      return true;
    });
    return;
  }

  if (kind === 'toggle_queue') {
    const nowQueued = !isQueued(c);
    c.agentStatus = nowQueued ? 'queued' : 'unqueued';
    c.history.push({
      at: new Date(NOW).toISOString(),
      who: op.id,
      kind: nowQueued ? 'queue_added' : 'queue_removed',
      detail: nowQueued ? 'Added to agent queue (top band)' : 'Removed from agent queue (back to backlog)',
    });
    showToast(nowQueued ? `${c.id} added to your queue.` : `${c.id} removed from your queue.`, 'info');
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
        : 'The app will surface this case at the chosen time. Useful for deferred work (e.g. wait until APAC FIT come online before assigning).'}</div>
      <label>Remind me</label>
      <select data-field="when">${presets.map(p => `<option value="${p.value}">${escapeHtml(p.label)}</option>`).join('')}</select>
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
      const minutes = parseInt(modal.querySelector('[data-field="when"]').value, 10);
      const note = modal.querySelector('[data-field="note"]').value.trim();
      const fireAt = new Date(realNow().getTime() + minutes * 60000).toISOString();
      c.reminder = {
        fireAt,
        note,
        setBy: op.id,
        setAt: realNow().toISOString(),
        fired: false,
      };
      c.history.push({ at: new Date(NOW).toISOString(), who: op.id, kind: 'reminder_set', detail: `Reminder ${fmtUntil(fireAt)}${note ? ' · ' + note : ''}` });
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
          c.history.push({ at: new Date(NOW).toISOString(), who: op.id, kind: 'reminder_dismissed', detail: 'Cleared via modal' });
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
      c.history.push({ at: new Date(NOW).toISOString(), who: op.id, kind: 'reminder_dismissed', detail: c.reminder.note || 'Dismissed' });
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
      c.history.push({ at: new Date(NOW).toISOString(), who: op.id, kind: 'reminder_snoozed', detail: 'Snoozed 5m' });
      showToast(`${c.id} reminder snoozed 5 minutes.`, 'info');
      render();
    }
    return;
  }
}

function handleNewCase(op) {
  showModal(`
    <h3>Create a new case</h3>
    <div class="modal-sub">Starts in <span class="pill pill-new">New</span>. Use the Change status… dropdown to assign it to Local FIT once created.</div>
    <label>Subject *</label>
    <input type="text" data-field="subject" placeholder="What's the issue?">
    <label>Requester *</label>
    <input type="text" data-field="requester" placeholder="Name of the person / team who reported it">
    <label>Case-center link</label>
    <input type="text" data-field="caseLink" placeholder="https://case-center.example/CC-…">
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
      <div>
        <label>Priority</label>
        <select data-field="priority">
          <option value="low">low</option>
          <option value="medium" selected>medium</option>
          <option value="high">high</option>
        </select>
      </div>
      <div>
        <label>Case type</label>
        <select data-field="caseType">
          <option value="access">access</option>
          <option value="data">data</option>
          <option value="network">network</option>
          <option value="mobile">mobile</option>
          <option value="productivity">productivity</option>
          <option value="service">service</option>
          <option value="other">other</option>
        </select>
      </div>
    </div>
    <label>Flags</label>
    <div style="display:flex; gap:14px; padding:4px 0;">
      <label class="inline-check"><input type="checkbox" data-field="weekend"> Weekend case</label>
      <label class="inline-check"><input type="checkbox" data-field="escalated"> Escalated (watch)</label>
    </div>
    <label>Notes</label>
    <textarea data-field="notes" placeholder="Anything important to capture upfront…"></textarea>
    <div class="modal-actions">
      <button class="btn" data-modal-cancel>Cancel</button>
      <button class="btn btn-primary" data-modal-submit>Create case</button>
    </div>
  `, (modal) => {
    const subject = modal.querySelector('[data-field="subject"]').value.trim();
    const requester = modal.querySelector('[data-field="requester"]').value.trim();
    if (!subject || !requester) { alert('Subject and Requester are required.'); return false; }

    const nums = STATE.cases
      .map(c => parseInt((c.id || '').replace(/^C-/, ''), 10))
      .filter(n => !isNaN(n));
    const newId = `C-${Math.max(1040, ...nums) + 1}`;
    const nowIso = new Date(NOW).toISOString().replace('.000Z', 'Z');

    const flags = [];
    if (modal.querySelector('[data-field="weekend"]').checked) flags.push('weekend');
    if (modal.querySelector('[data-field="escalated"]').checked) flags.push('escalated');

    const newCase = {
      id: newId,
      caseLink: modal.querySelector('[data-field="caseLink"]').value.trim() || `https://case-center.example/CC-${newId.replace('C-', '')}`,
      subject,
      requester,
      fitId: null,
      hqId: null,
      currentOwner: null,
      status: 'new',
      flags,
      priority: modal.querySelector('[data-field="priority"]').value,
      caseType: modal.querySelector('[data-field="caseType"]').value,
      weekId: window.CURRENT_WEEK.id,
      slaStartedAt: nowIso,
      slaPaused: false,
      slaAccumulatedMs: 0,
      holdMs: { fit: 0, hq: 0 },
      holdStartedAt: null,
      lastOwnerContact: null,
      handover: null,
      notes: modal.querySelector('[data-field="notes"]').value.trim(),
      createdAt: nowIso,
      createdBy: op.id,
      history: [
        { at: nowIso, who: op.id, kind: 'created', detail: 'Case created manually' },
      ],
    };

    STATE.cases.unshift(newCase);
    STATE.kanbanSelected = newId;
    showToast(`Created ${newId}. It's in the New column on the Cases page.`, 'success');
    if (!location.hash.startsWith('#/cases')) location.hash = '#/cases';
    render();
    return true;
  });
}

function handleReassign(caseId, type) {
  const c = caseById(caseId);
  if (!c) return;
  const op = getOperator(STATE.operatorId);
  const dir = type === 'fit' ? window.OWNERS.fit : window.OWNERS.hq;
  const currentId = type === 'fit' ? c.fitId : c.hqId;
  const typeLabel = type === 'fit' ? 'Local FIT' : 'HQ Product Team';
  const detailLabel = type === 'fit' ? o => `${escapeHtml(o.name)} (${escapeHtml(o.region)})` : o => `${escapeHtml(o.name)} (${escapeHtml(o.area)})`;

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
    const newId = modal.querySelector('[data-field="ownerId"]').value || null;
    const reason = modal.querySelector('[data-field="reason"]').value.trim();
    if (newId === currentId) return true;

    const oldOwner = currentId ? getOwner(type, currentId) : null;
    const newOwner = newId ? getOwner(type, newId) : null;

    // Stop the active hold-clock segment if currentOwner === type.
    if (c.currentOwner === type && c.holdStartedAt) {
      c.holdMs[type] = (c.holdMs[type] || 0) + (NOW.getTime() - new Date(c.holdStartedAt).getTime());
      c.holdStartedAt = null;
    }

    // Update the contact pointer.
    if (type === 'fit') c.fitId = newId;
    else c.hqId = newId;

    // Decide currentOwner / status / new clock segment.
    if (newId) {
      const wasActive = c.currentOwner === type;
      const wasNew = c.status === 'new';
      const wasReturned = c.status === 'returned_to_requester';
      if (wasActive || wasNew) {
        c.currentOwner = type;
        c.status = type === 'fit' ? 'with_fit' : 'with_hq';
        c.holdStartedAt = new Date(NOW).toISOString();
        c.lastOwnerContact = { at: new Date(NOW).toISOString(), channel: type === 'fit' ? 'Slack' : 'JIRA' };
      } else if (wasReturned) {
        // Just updating the contact for when SLA resumes; don't restart the clock.
      }
      // else: case is with the other owner — just updated the inactive contact, no other changes.
    } else {
      // Unassigning.
      if (c.currentOwner === type) {
        c.currentOwner = null;
        c.lastOwnerContact = null;
        const otherType = type === 'fit' ? 'hq' : 'fit';
        const otherId = otherType === 'fit' ? c.fitId : c.hqId;
        if (otherId) {
          c.currentOwner = otherType;
          c.status = otherType === 'fit' ? 'with_fit' : 'with_hq';
          c.holdStartedAt = new Date(NOW).toISOString();
        } else {
          c.status = 'new';
        }
      }
    }

    if (type === 'fit') c.fitCannotResolve = false;

    const detail = `${typeLabel}: ${oldOwner ? oldOwner.name : '(unassigned)'} → ${newOwner ? newOwner.name : '(unassigned)'}${reason ? ' · ' + reason : ''}`;
    c.history.push({ at: new Date(NOW).toISOString(), who: op.id, kind: currentId ? 'reassigned' : 'assigned', detail });
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
  document.querySelectorAll('[data-action="reassign"]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      handleReassign(el.dataset.caseId, el.dataset.type);
    });
  });
  document.querySelectorAll('table.case-table tbody tr').forEach(tr => {
    tr.addEventListener('click', () => { location.hash = tr.dataset.href; });
  });
  document.querySelectorAll('[data-action="kanban-select"]').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('button, a')) return;
      STATE.kanbanSelected = card.dataset.caseId;
      render();
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
  let firedAny = false;
  for (const c of STATE.cases) {
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

setInterval(checkReminders, 10000);
setTimeout(checkReminders, 200);

/* ---------- Boot ---------- */

if (!location.hash) location.hash = '#/cases';
render();
