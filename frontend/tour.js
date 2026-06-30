// Interactive product tour for the Case Tracker prototype.
// Renders an overlay tooltip anchored to live UI elements, navigating
// between SPA routes as needed. State is read-only; the tour points at
// things rather than clicking buttons for the user.

(function () {
  // Bumped to v2 when the tour was rewritten for the Picked-workspace + Hand-off
  // Route Board UI (the old kanban tour pointed at removed elements).
  const STORAGE_KEY = 'case-tracker-tour-seen-v2';

  const STEPS = [
    {
      kind: 'modal',
      title: 'Welcome to CommuGround',
      body: 'A click-through Case Tracker for first-line IT operators — track each case and coordinate the hand-off between the requester, the Core Team, and HQ. This tour walks the main views in a few steps. Skip anytime, and re-launch later from the "Take the tour" link in the sidebar.',
    },
    {
      kind: 'pointer',
      route: '#/cases',
      selector: '#op-switcher',
      placement: 'right',
      title: "You're viewing as the current operator",
      body: 'This dropdown switches the active operator. Pick a different person and the whole view — your Picked workspace, suggested Track Statuses, and shift-handover prompts — re-derives from that operator\'s shift.',
    },
    {
      kind: 'pointer',
      route: '#/cases',
      selector: '.picked-workspace-top',
      placement: 'bottom',
      title: 'Hand-off Route Board',
      body: 'The heart of the tool: one strip showing where every case sits across User → Core Team → HQ. A travelling dot = a case moving between parties; a dashed ring = one you\'re watching; a square = parked at a station. The legend pairs each colour with a shape, so it reads at a glance under time pressure.',
    },
    {
      kind: 'pointer',
      route: '#/cases',
      selector: '.picked-workspace-list',
      placement: 'top',
      title: 'Your Picked workspace',
      body: 'The cases you\'ve pulled in to actively work this shift. Pick cases from Overview (next step) and they show up here. Click any row to open its full detail in the panel beside it.',
    },
    {
      kind: 'pointer',
      route: '#/cases',
      selector: '.picked-workspace-detail',
      placement: 'top',
      title: 'Case detail — act without leaving the page',
      body: 'Select a case and this panel shows its two clocks (SLA "time on us", plus Core vs HQ hold totals — answering "how long is each party holding this?"), its routing, latest handover note, and full history. From here you set the Track Status, write a handover note addressed to a teammate, set a reminder, and jump out to Case Center.',
    },
    {
      kind: 'pointer',
      route: '#/archive',
      selector: '.archive-grid',
      placement: 'bottom',
      title: 'Overview — triage inbox',
      body: 'Every case by week. This is where you triage: scan a week\'s table and hit + Pick to lift a case into your Picked workspace. Cards show totals, carry-overs, bounces (returned to requester), and median time-on-us.',
    },
    {
      kind: 'pointer',
      route: '#/shifts',
      selector: '.shift-grid',
      placement: 'bottom',
      title: 'Shifts — Day vs Night coverage',
      body: 'Side-by-side view of both shifts with rosters and handover counts. Click into a shift for its detail, where "View as <operator>" lets you see what the other shift sees without switching operator.',
    },
    {
      kind: 'pointer',
      route: '#/owners',
      selector: '#owners-editor',
      placement: 'top',
      title: 'Owners — who cases route to',
      body: 'The Core Team desks and HQ Product Teams a case can be handed to. Edit them here for the session; paste the snippet into owners.js to keep them. "Reset to seed" undoes session edits.',
    },
    {
      kind: 'modal',
      title: 'That\'s the tour',
      body: 'Re-launch any time from "Take the tour" in the sidebar. Your changes persist in the browser (localStorage) — "Reset to seed" in the sidebar footer starts fresh. The README at the repo root has a full feature reference.',
    },
  ];

  let currentStep = 0;
  let dir = 1;   // travel direction, so a skipped (missing-target) step skips the right way
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
    dir = 1;
    if (currentStep < STEPS.length - 1) { currentStep++; showStep(); }
    else stop(true);
  }
  function prev() {
    dir = -1;
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
      if (!target) {
        // The anchor isn't in the current DOM — skip rather than point a tooltip at
        // nothing. Travel in the same direction the user was going; stop if we run off
        // either end (avoids an infinite loop if every remaining step is missing).
        if (dir < 0) { if (currentStep > 0) { currentStep--; showStep(); } else stop(false); }
        else { if (currentStep < STEPS.length - 1) { currentStep++; showStep(); } else stop(true); }
        return;
      }
      target.classList.add('tour-highlight');
      lastHighlight = target;
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
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
    if (window.TOUR_AUTOSTART === false) return;   // disabled via config.js (the launcher link still works)
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
