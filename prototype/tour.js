// Interactive product tour for the Case Tracker prototype.
// Renders an overlay tooltip anchored to live UI elements, navigating
// between SPA routes as needed. State is read-only; the tour points at
// things rather than clicking buttons for the user.

(function () {
  const STORAGE_KEY = 'case-tracker-tour-seen-v1';

  const STEPS = [
    {
      kind: 'modal',
      title: 'Welcome to the Case Tracker prototype',
      body: 'A click-through demo of the Excel replacement. This tour walks through the main features in about 10 steps. You can skip anytime, and re-launch later from the "Take the tour" link in the sidebar.',
    },
    {
      kind: 'pointer',
      route: '#/queue',
      selector: '#op-switcher',
      placement: 'right',
      title: "You're viewing as Alex (Day shift)",
      body: 'This dropdown switches the active operator. Choose Sam (Night) or Jordan (Day) and the Action Queue, Shift Handover, and shift status will all re-derive from that operator\'s perspective.',
    },
    {
      kind: 'pointer',
      route: '#/queue',
      selector: '.queue-card',
      placement: 'bottom',
      title: 'Action Queue — your home',
      body: 'A per-operator to-do list derived from open cases. Each card is a case that needs your attention, sorted by priority and age.',
    },
    {
      kind: 'pointer',
      route: '#/queue',
      selector: '.queue-card .prompt',
      placement: 'right',
      title: 'Action prompts',
      body: 'Eight prompt types fire automatically based on case state — assign FIT, chase FIT, escalate to HQ, chase HQ, verify a reported fix, return to requester, watch escalated, end-of-shift handover. Thresholds (FIT idle > 4h, HQ > 8h, approaching SLA > 20h) are configurable.',
    },
    {
      kind: 'pointer',
      route: '#/queue',
      selector: '.queue-card .tz-hint',
      placement: 'bottom',
      title: 'Owner office hours',
      body: 'When a prompt involves contacting an owner, you see their current local time and posted office hours. Green = in-hours, amber = out-of-hours. The system never blocks a prompt — you decide whether to act now or defer.',
    },
    {
      kind: 'pointer',
      route: '#/cases',
      selector: '.case-table',
      placement: 'top',
      title: 'Cases — current week',
      body: 'The Excel-replacement table view, scoped to this week. Columns mirror the legacy 8-column layout (Subject, Case Link, Process Time, Status, Handover, FIT, HQ, Note) plus the v1 status / flag split. Click any row for the full detail.',
    },
    {
      kind: 'pointer',
      route: '#/cases/C-1044',
      selector: '.clock-grid',
      placement: 'bottom',
      title: 'Two clocks per case',
      body: 'SLA clock = time on us (pauses when you return the case to the requester). Owner-hold totals split by FIT vs HQ — so we can answer "how much time is each owner consuming?" This case escalated FIT → HQ, so both accumulators have value.',
    },
    {
      kind: 'pointer',
      route: '#/cases/C-1044',
      selector: '.handover-note',
      placement: 'top',
      title: 'Latest handover note',
      body: 'Each open case carries one current handover note labelled Day → Night (or vice versa). It\'s a structured field, not a comment. Yellow background means it\'s stale for the current shift and needs a fresh write.',
    },
    {
      kind: 'pointer',
      route: '#/handover',
      selector: '.handover-bar',
      placement: 'bottom',
      title: 'Manual shift cutover',
      body: 'Before passing the watch, every open case must have a fresh note authored during the current shift. The Complete-handover button stays disabled until that\'s true — enforcing the URD\'s "no handover without a note" rule.',
    },
    {
      kind: 'pointer',
      route: '#/shifts',
      selector: '.shift-grid',
      placement: 'bottom',
      title: 'Shifts — Day vs Night coverage',
      body: 'Side-by-side view of both shifts with rosters and handover counts. Click into a shift for its detail page, where a "View as <operator>" button lets you see what the other shift sees without leaving the screen.',
    },
    {
      kind: 'pointer',
      route: '#/archive',
      selector: '.archive-grid',
      placement: 'bottom',
      title: 'Weekly Archive',
      body: 'Browse past weekly workbooks (W16 through current W19). Each card shows totals, carry-overs, bounces (returned to requester), and median time-on-us. Click a week for its filtered case table.',
    },
    {
      kind: 'modal',
      title: 'That\'s the tour',
      body: 'Re-launch any time from "Take the tour" in the sidebar. Your changes persist in the browser (localStorage) — click "Reset to seed" in the sidebar footer to start fresh. The README at the repo root has a full feature reference, and docs/URD.md is the spec the prototype is built from.',
    },
  ];

  let currentStep = 0;
  let active = false;
  let lastHighlight = null;
  let resizeHandler = null;

  function escape(s) {
    return String(s ?? '').replace(/[&<>"]/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]));
  }

  function start() {
    active = true;
    currentStep = 0;
    showStep();
  }

  function stop(complete) {
    active = false;
    cleanup();
    if (complete) {
      try { localStorage.setItem(STORAGE_KEY, '1'); } catch (e) { /* ignore */ }
    }
  }

  function cleanup() {
    document.querySelector('.tour-overlay')?.remove();
    if (lastHighlight) {
      lastHighlight.classList.remove('tour-highlight');
      lastHighlight = null;
    }
    if (resizeHandler) {
      window.removeEventListener('resize', resizeHandler);
      resizeHandler = null;
    }
  }

  function next() {
    if (currentStep < STEPS.length - 1) { currentStep++; showStep(); }
    else stop(true);
  }
  function prev() {
    if (currentStep > 0) { currentStep--; showStep(); }
  }

  function showStep() {
    cleanup();
    const step = STEPS[currentStep];
    const needsNav = step.route && location.hash !== step.route;
    if (needsNav) location.hash = step.route;
    // Defer to let the SPA re-render before we query selectors.
    setTimeout(() => renderStep(step), needsNav ? 90 : 20);
  }

  function renderStep(step) {
    if (!active) return;

    const overlay = document.createElement('div');
    overlay.className = 'tour-overlay';

    const counter = `<div class="tour-step-counter">${currentStep + 1} / ${STEPS.length}</div>`;
    const isLast = currentStep === STEPS.length - 1;
    const actions = `
      <div class="tour-actions">
        ${currentStep > 0
          ? '<button class="tour-btn" data-tour-action="prev">Back</button>'
          : '<span></span>'}
        <div class="tour-actions-right">
          ${!isLast ? '<button class="tour-btn tour-btn-link" data-tour-action="skip">Skip tour</button>' : ''}
          <button class="tour-btn tour-btn-primary" data-tour-action="next">${isLast ? 'Finish' : 'Next →'}</button>
        </div>
      </div>
    `;

    if (step.kind === 'modal') {
      overlay.innerHTML = `
        <div class="tour-backdrop"></div>
        <div class="tour-tooltip tour-modal">
          ${counter}
          <h3 class="tour-title">${escape(step.title)}</h3>
          <p class="tour-body">${escape(step.body)}</p>
          ${actions}
        </div>
      `;
      document.body.appendChild(overlay);
    } else {
      const target = document.querySelector(step.selector);
      if (target) {
        target.classList.add('tour-highlight');
        lastHighlight = target;
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      overlay.innerHTML = `
        <div class="tour-tooltip" data-placement="${step.placement || 'bottom'}">
          ${counter}
          <h3 class="tour-title">${escape(step.title)}</h3>
          <p class="tour-body">${escape(step.body)}</p>
          ${actions}
        </div>
      `;
      document.body.appendChild(overlay);

      const tooltip = overlay.querySelector('.tour-tooltip');
      const place = () => {
        if (target) {
          positionTooltip(tooltip, target.getBoundingClientRect(), step.placement || 'bottom');
        } else {
          tooltip.style.position = 'fixed';
          tooltip.style.left = '50%';
          tooltip.style.top = '50%';
          tooltip.style.transform = 'translate(-50%, -50%)';
        }
      };
      // Two ticks so smooth-scroll has settled.
      requestAnimationFrame(() => requestAnimationFrame(place));
      resizeHandler = place;
      window.addEventListener('resize', resizeHandler);
      window.addEventListener('scroll', resizeHandler, { passive: true });
    }

    overlay.querySelectorAll('[data-tour-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.tourAction;
        if (action === 'next') next();
        else if (action === 'prev') prev();
        else if (action === 'skip') stop(false);
      });
    });
    overlay.querySelector('.tour-backdrop')?.addEventListener('click', () => stop(false));
    document.addEventListener('keydown', keyHandler);
  }

  function keyHandler(e) {
    if (!active) return;
    if (e.key === 'Escape') { stop(false); document.removeEventListener('keydown', keyHandler); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { next(); }
    else if (e.key === 'ArrowLeft') { prev(); }
  }

  function positionTooltip(tt, rect, placement) {
    const margin = 14;
    const ttRect = tt.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top, left;

    // Auto-flip if not enough space.
    const space = {
      top: rect.top,
      bottom: vh - rect.bottom,
      left: rect.left,
      right: vw - rect.right,
    };
    let p = placement;
    if (p === 'bottom' && space.bottom < ttRect.height + margin && space.top > space.bottom) p = 'top';
    if (p === 'top' && space.top < ttRect.height + margin && space.bottom > space.top) p = 'bottom';
    if (p === 'right' && space.right < ttRect.width + margin && space.left > space.right) p = 'left';
    if (p === 'left' && space.left < ttRect.width + margin && space.right > space.left) p = 'right';

    if (p === 'right') {
      top = rect.top + rect.height / 2 - ttRect.height / 2;
      left = rect.right + margin;
    } else if (p === 'left') {
      top = rect.top + rect.height / 2 - ttRect.height / 2;
      left = rect.left - ttRect.width - margin;
    } else if (p === 'top') {
      top = rect.top - ttRect.height - margin;
      left = rect.left + rect.width / 2 - ttRect.width / 2;
    } else {
      top = rect.bottom + margin;
      left = rect.left + rect.width / 2 - ttRect.width / 2;
    }

    top = Math.max(8, Math.min(vh - ttRect.height - 8, top));
    left = Math.max(8, Math.min(vw - ttRect.width - 8, left));

    tt.style.position = 'fixed';
    tt.style.top = top + 'px';
    tt.style.left = left + 'px';
    tt.style.transform = 'none';
    tt.dataset.placement = p;
  }

  // Public API.
  window.Tour = { start, stop };

  // Auto-start on first visit.
  function maybeAutoStart() {
    let seen = false;
    try { seen = localStorage.getItem(STORAGE_KEY) === '1'; } catch (e) { /* ignore */ }
    if (!seen) setTimeout(start, 600);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeAutoStart);
  } else {
    maybeAutoStart();
  }

  // Wire up the "Take the tour" launcher in the sidebar.
  document.addEventListener('click', e => {
    const launcher = e.target.closest('#launch-tour');
    if (launcher) {
      e.preventDefault();
      start();
    }
  });
})();
