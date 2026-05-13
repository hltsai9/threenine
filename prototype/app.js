// Case Tracker prototype — single-file SPA.
// Renders four views (Action Queue, Cases, Case Detail, Shift Handover)
// against the seed data in data.js. State is in-memory; reload resets.

const STATE = {
  cases: window.CASES.map(c => structuredClone(c)),
  operatorId: window.CURRENT_OPERATOR_ID,
  lastListRoute: '#/queue',
  lastListLabel: 'Action Queue',
};

const STORAGE_KEY = 'case-tracker-state-v1';

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      v: 1,
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
    if (parsed.v !== 1 || !Array.isArray(parsed.cases)) return false;
    STATE.cases = parsed.cases;
    if (parsed.operatorId) STATE.operatorId = parsed.operatorId;
    return true;
  } catch (e) {
    return false;
  }
}

function resetState() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  STATE.cases = window.CASES.map(c => structuredClone(c));
  STATE.operatorId = window.CURRENT_OPERATOR_ID;
  STATE.lastListRoute = '#/queue';
  STATE.lastListLabel = 'Action Queue';
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

/* ---------- Action queue derivation ---------- */

function deriveQueue() {
  // Per-case actionable prompts. Cross-cutting concerns (approaching SLA,
  // escalated-watch, end-of-shift handover) are surfaced via separate
  // banners/watchlists in renderQueue(), not as per-card prompts.
  const items = [];
  for (const c of STATE.cases) {
    if (['closed', 'cancelled', 'resolved'].includes(c.status)) continue;

    const ownerIdleHrs = c.lastOwnerContact
      ? (NOW.getTime() - new Date(c.lastOwnerContact.at).getTime()) / HOUR
      : Infinity;

    if (c.status === 'new' && !c.fitId) {
      items.push({ caseId: c.id, kind: 'assign_fit' });
    }
    if (c.status === 'with_fit' && c.fitCannotResolve) {
      items.push({ caseId: c.id, kind: 'escalate_to_hq' });
    } else if (c.status === 'with_fit' && ownerIdleHrs > window.THRESHOLDS.fitIdleHours) {
      items.push({ caseId: c.id, kind: 'chase_fit' });
    }
    if (c.status === 'with_hq' && ownerIdleHrs > window.THRESHOLDS.hqIdleHours) {
      items.push({ caseId: c.id, kind: 'chase_hq' });
    }
    if (c.status === 'sanity_check') {
      items.push({ caseId: c.id, kind: 'verify_fix' });
    }
  }

  // Group by case for display.
  const byCase = new Map();
  for (const it of items) {
    if (!byCase.has(it.caseId)) byCase.set(it.caseId, []);
    byCase.get(it.caseId).push(it);
  }

  // Order: high priority first, then oldest case.
  const groups = [...byCase.entries()].map(([caseId, prompts]) => {
    const c = caseById(caseId);
    return { case: c, prompts };
  });
  const pri = { high: 0, medium: 1, low: 2 };
  groups.sort((a, b) => {
    const p = pri[a.case.priority] - pri[b.case.priority];
    if (p !== 0) return p;
    return new Date(a.case.slaStartedAt) - new Date(b.case.slaStartedAt);
  });
  return groups;
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
  const h = location.hash || '#/queue';
  if (h.startsWith('#/cases/')) return { name: 'detail', id: h.slice('#/cases/'.length) };
  if (h.startsWith('#/cases')) return { name: 'cases' };
  if (h.startsWith('#/handover')) return { name: 'handover' };
  if (h.startsWith('#/archive/')) return { name: 'archiveWeek', id: h.slice('#/archive/'.length) };
  if (h.startsWith('#/archive')) return { name: 'archive' };
  if (h.startsWith('#/shifts/')) return { name: 'shiftDetail', shift: decodeURIComponent(h.slice('#/shifts/'.length)) };
  if (h.startsWith('#/shifts')) return { name: 'shifts' };
  return { name: 'queue' };
}

window.addEventListener('hashchange', render);

/* ---------- Render dispatch ---------- */

function labelForRoute(route) {
  switch (route.name) {
    case 'queue': return 'Action Queue';
    case 'cases': return 'Cases';
    case 'handover': return 'Shift Handover';
    case 'shifts': return 'Shifts';
    case 'shiftDetail': return `${route.shift} shift`;
    case 'archive': return 'Weekly Archive';
    case 'archiveWeek': {
      const w = window.WEEKS.find(w => w.id === route.id);
      return w ? w.label : 'Archive';
    }
    default: return 'Back';
  }
}

function render() {
  renderSidebar();
  const route = currentRoute();
  // Remember the last list-style view so the case detail can offer a contextual back link.
  if (route.name !== 'detail') {
    STATE.lastListRoute = location.hash || '#/queue';
    STATE.lastListLabel = labelForRoute(route);
  }
  const main = document.getElementById('main');
  document.querySelectorAll('.nav a').forEach(a => a.classList.remove('active'));
  const active = ({
    queue: 'queue', cases: 'cases', detail: 'cases', handover: 'handover',
    archive: 'archive', archiveWeek: 'archive',
    shifts: 'shifts', shiftDetail: 'shifts',
  })[route.name];
  document.querySelector(`.nav a[data-route="${active}"]`)?.classList.add('active');

  if (route.name === 'queue') main.innerHTML = renderQueue();
  else if (route.name === 'cases') main.innerHTML = renderCaseList();
  else if (route.name === 'detail') main.innerHTML = renderCaseDetail(route.id);
  else if (route.name === 'handover') main.innerHTML = renderHandover();
  else if (route.name === 'archive') main.innerHTML = renderArchiveIndex();
  else if (route.name === 'archiveWeek') main.innerHTML = renderArchiveWeek(route.id);
  else if (route.name === 'shifts') main.innerHTML = renderShiftsIndex();
  else if (route.name === 'shiftDetail') main.innerHTML = renderShiftDetail(route.shift);
  bindHandlers();
  saveState();
}

function renderSidebar() {
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

  const queueGroups = deriveQueue();
  const promptCount = queueGroups.reduce((n, g) => n + g.prompts.length, 0);
  document.getElementById('nav-queue-count').textContent = promptCount;
  document.getElementById('nav-cases-count').textContent =
    STATE.cases.filter(c => !['closed', 'cancelled'].includes(c.status) && c.weekId === window.CURRENT_WEEK.id).length;
  document.getElementById('nav-handover-count').textContent =
    STATE.cases.filter(c => !['closed', 'cancelled', 'new'].includes(c.status)
      && (!c.handover || c.handover.staleForCurrentShift || c.handover.to !== op.shift)
    ).length;
  const navShifts = document.getElementById('nav-shifts-count');
  if (navShifts) navShifts.textContent = window.SHIFTS.length;
  const navArchive = document.getElementById('nav-archive-count');
  if (navArchive) navArchive.textContent = window.WEEKS.length;
}

/* ---------- Action Queue view ---------- */

function renderQueue() {
  const groups = deriveQueue();
  const sla = approachingSlaCases();
  const escalated = escalatedCases();
  const handoverPending = handoverPendingCases();

  const banner = handoverPending.length > 0 ? `
    <div class="queue-banner">
      <div>
        <strong>Shift ending:</strong> ${handoverPending.length} open case${handoverPending.length === 1 ? '' : 's'} need a handover note for ${escapeHtml(getOperator(STATE.operatorId).shift)} shift before cutover.
      </div>
      <a href="#/handover" class="btn btn-primary">Open Shift Handover →</a>
    </div>
  ` : '';

  const cards = groups.length === 0
    ? '<div class="queue-empty">No immediate per-case actions. Watchlists below show cases to monitor.</div>'
    : groups.map(g => renderQueueCard(g.case, g.prompts)).join('');

  const watchlist = renderWatchlists(sla, escalated);

  const subtitleParts = [];
  if (groups.length > 0) subtitleParts.push(`${groups.length} action${groups.length === 1 ? '' : 's'} to take`);
  if (sla.length > 0) subtitleParts.push(`${sla.length} approaching SLA`);
  if (escalated.length > 0) subtitleParts.push(`${escalated.length} escalated`);

  return `
    <div class="page-header">
      <div>
        <h1>Action Queue</h1>
        <div class="subtitle">${subtitleParts.join(' · ') || 'All clear.'}</div>
      </div>
      <div class="toolbar">
        <span class="muted tiny">Thresholds: FIT idle &gt; ${window.THRESHOLDS.fitIdleHours}h, HQ idle &gt; ${window.THRESHOLDS.hqIdleHours}h, approaching SLA &gt; ${window.THRESHOLDS.approachingSlaHours}h</span>
      </div>
    </div>
    ${banner}
    ${cards}
    ${watchlist}
  `;
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

function handoverPendingCases() {
  const op = getOperator(STATE.operatorId);
  const shiftEndsSoon =
    (new Date(window.CURRENT_SHIFT.endsAtUtc).getTime() - NOW.getTime()) <
    window.THRESHOLDS.shiftEndingSoonMinutes * 60 * 1000;
  if (!shiftEndsSoon) return [];
  return STATE.cases.filter(c => {
    if (['closed', 'cancelled', 'new'].includes(c.status)) return false;
    return !c.handover || c.handover.staleForCurrentShift || c.handover.to !== op.shift;
  });
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

function renderQueueCard(c, prompts) {
  const flags = (c.flags || []).map(f => `<span class="flag flag-${f}">${escapeHtml(f.replace(/_/g, ' '))}</span>`).join(' ');
  const onUs = fmtDuration(caseSlaMs(c));
  const owner = c.currentOwner ? getOwner(c.currentOwner, c.currentOwner === 'fit' ? c.fitId : c.hqId) : null;
  const ownerLine = owner ? `
    Owner: <strong>${escapeHtml(owner.name)}</strong>
    ${renderTzHint(owner)}
    · last contact ${fmtRelative(c.lastOwnerContact?.at)}
  ` : `<span class="muted">Unassigned</span>`;

  // After filtering, each case has exactly one primary prompt.
  const primary = prompts[0];
  const def = PROMPT_DEFS[primary.kind];

  return `
    <div class="card queue-card">
      <div class="queue-row">
        <div>
          <div class="row-flex">
            <a href="#/cases/${c.id}" class="mono muted">${c.id}</a>
            <span class="pill pill-${c.status}">${escapeHtml(statusLabel(c.status))}</span>
            <span class="priority-${c.priority}">${escapeHtml(c.priority)}</span>
            ${flags}
          </div>
          <div class="queue-subject">${escapeHtml(c.subject)}</div>
          <div class="queue-meta">
            ${ownerLine}
            <span>·</span>
            <span>On us: <strong>${onUs}</strong></span>
            <span>·</span>
            <a href="${escapeHtml(c.caseLink)}" target="_blank" rel="noreferrer">case-center ↗</a>
          </div>
        </div>
        <div class="queue-action">
          <button class="btn btn-primary queue-primary-btn" data-action="prompt" data-case-id="${c.id}" data-kind="${primary.kind}">
            <span class="prompt-icon ${def.cls}">${def.icon}</span>
            ${escapeHtml(def.label)}
          </button>
          <a class="btn btn-ghost" href="#/cases/${c.id}">Open case →</a>
        </div>
      </div>
    </div>
  `;
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
  const cases = [...STATE.cases]
    .filter(c => c.weekId === window.CURRENT_WEEK.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const rows = cases.map(c => {
    const fit = getOwner('fit', c.fitId);
    const hq = getOwner('hq', c.hqId);
    const flags = (c.flags || []).map(f => `<span class="flag flag-${f}">${escapeHtml(f.replace(/_/g, ' '))}</span>`).join(' ');
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
        <td><span class="pill pill-${c.status}">${escapeHtml(statusLabel(c.status))}</span> ${flags}</td>
        <td><span class="priority-${c.priority}">${escapeHtml(c.priority)}</span></td>
        <td>${fmtDuration(caseSlaMs(c))}${c.slaPaused ? ' <span class="muted tiny">(paused)</span>' : ''}</td>
        <td class="muted tiny">${fmtRelative(c.createdAt)}</td>
      </tr>
    `;
  }).join('');
  return `
    <div class="page-header">
      <div>
        <h1>Cases · ${escapeHtml(window.CURRENT_WEEK.label)}</h1>
        <div class="subtitle">${cases.length} cases this week. Click a row for full detail.</div>
      </div>
      <div class="toolbar">
        <input type="search" placeholder="Filter by subject, ID…" id="case-filter">
      </div>
    </div>
    <table class="case-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Subject / Case Link</th>
          <th>Requester</th>
          <th>Local FIT</th>
          <th>HQ Product Team</th>
          <th>Status</th>
          <th>Priority</th>
          <th>Process Time</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

/* ---------- Case Detail view ---------- */

function renderCaseDetail(id) {
  const c = caseById(id);
  if (!c) {
    return `<div class="page-header"><div><h1>Not found</h1><div class="subtitle">No case with ID ${escapeHtml(id)}.</div></div></div>
      <a class="btn" href="${escapeHtml(STATE.lastListRoute)}">← Back to ${escapeHtml(STATE.lastListLabel)}</a>`;
  }
  const fit = getOwner('fit', c.fitId);
  const hq = getOwner('hq', c.hqId);
  const flags = (c.flags || []).map(f => `<span class="flag flag-${f}">${escapeHtml(f.replace(/_/g, ' '))}</span>`).join(' ');

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

  return items.join(' ');
}

function statusTransitions(c) {
  const t = [];
  switch (c.status) {
    case 'new':
      if (!c.fitId) t.push({ kind: 'assign_fit', label: 'Assign to Local FIT' });
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

/* ---------- Shift Handover view ---------- */

function renderHandover() {
  const op = getOperator(STATE.operatorId);
  const open = STATE.cases.filter(c => !['closed', 'cancelled', 'new'].includes(c.status));
  const fresh = open.filter(c => c.handover && !c.handover.staleForCurrentShift && c.handover.author === op.id);
  const stale = open.filter(c => c.handover && (c.handover.staleForCurrentShift || c.handover.author !== op.id));
  const missing = open.filter(c => !c.handover);

  const rows = [...missing, ...stale, ...fresh].map(c => {
    let status = '<span class="note-status fresh">Note current</span>';
    if (!c.handover) status = '<span class="note-status missing">No note</span>';
    else if (c.handover.staleForCurrentShift || c.handover.author !== op.id) {
      status = `<span class="note-status stale">Stale (${escapeHtml(c.handover.from)} → ${escapeHtml(c.handover.to)})</span>`;
    }
    return `
      <div class="case-row">
        <div>
          <div class="row-flex">
            <a class="mono" href="#/cases/${c.id}">${c.id}</a>
            <span class="pill pill-${c.status}">${escapeHtml(statusLabel(c.status))}</span>
          </div>
          <div style="font-weight:500; margin-top:4px;">${escapeHtml(c.subject)}</div>
          <div class="meta">On us: ${fmtDuration(caseSlaMs(c))} · last contact ${fmtRelative(c.lastOwnerContact?.at)}</div>
        </div>
        <div>${status}</div>
        <div>
          <button class="btn btn-primary" data-action="prompt" data-case-id="${c.id}" data-kind="end_of_shift_handover">Write note</button>
        </div>
      </div>
    `;
  }).join('');

  const blockers = missing.length + stale.length;

  return `
    <div class="page-header">
      <div>
        <h1>Shift Handover</h1>
        <div class="subtitle">Manual cutover. Every open case must have a note authored during this shift.</div>
      </div>
    </div>
    <div class="handover-bar">
      <div class="progress-text">
        <strong>${fresh.length}</strong> of <strong>${open.length}</strong> open cases have a current ${op.shift}-shift note.
        ${blockers > 0 ? `<span class="muted"> · ${blockers} pending.</span>` : ''}
      </div>
      <div>
        <button class="btn btn-primary" id="complete-handover" ${blockers > 0 ? 'disabled' : ''}>Complete handover</button>
      </div>
    </div>
    <div class="handover-list">${rows || '<div class="queue-empty">No open cases requiring handover.</div>'}</div>
  `;
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
  const c = caseById(caseId);
  if (!c) return;
  const op = getOperator(STATE.operatorId);

  if (kind === 'assign_fit') {
    const opts = window.OWNERS.fit.map(f => `<option value="${f.id}">${escapeHtml(f.name)} (${escapeHtml(f.region)})</option>`).join('');
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
    const opts = window.OWNERS.hq.map(h => `<option value="${h.id}">${escapeHtml(h.name)} (${escapeHtml(h.area)})</option>`).join('');
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
        detail = `Requester replied · resumed unassigned`;
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

function handleCompleteHandover() {
  alert('Handover marked complete. (Prototype: in a real build this would notify the incoming shift.)');
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
  document.getElementById('complete-handover')?.addEventListener('click', handleCompleteHandover);
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
    });
  }
}

/* ---------- Boot ---------- */

if (!location.hash) location.hash = '#/queue';
render();
