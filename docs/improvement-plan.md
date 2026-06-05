# Case Tracker — Code Review & Improvement Plan

This document is a roadmap. It captures (1) a code-review of the current prototype with
prioritized fixes, (2) a redesign spec for the guided site tour, and (3) an improvement +
regeneration spec for the promo slide deck. File references use `path:line` anchors against the
tree at the time of writing so a later implementation session can execute directly.

The codebase is intentionally **zero-dependency vanilla JS + CSS** (a click-through prototype
for an Excel-replacement case tracker), with an optional Python live-data backend in `local/`.
The roadmap preserves that zero-dependency design unless explicitly noted.

---

## 1. Codebase review & roadmap

### Overview

| File | Lines | Role |
| --- | --- | --- |
| `prototype/app.js` | ~2,893 | Monolithic SPA: router, renderers, handlers, modals, state, live-data fetch |
| `prototype/styles.css` | ~1,432 | All styles, single file |
| `prototype/data.js` | ~657 | Seed cases, thresholds, frozen demo `NOW` |
| `prototype/tour.js` | ~306 | Custom guided tour |
| `slides/build-deck.cjs` | ~258 | pptxgenjs deck generator |
| `slides/capture-screenshots.cjs` | ~62 | Playwright screenshot capture |

Strengths to preserve: no external dependencies, consistent `escapeHtml()` usage, clear
`STATE` + `loadState()`/`saveState()` lifecycle, functional rendering style, well-commented file
headers.

### Prioritized findings

#### P0 — Robustness / correctness (do first; low risk)

- **Live Case Center payload not validated before render** — `app.js:2794–2832`
  (`tryLoadLiveCases()`). It checks `Array.isArray(cases)` but then assumes each case's shape; a
  malformed field yields a blank board. Fix: validate required fields per case, drop/flag bad
  rows, and show a specific error toast instead of failing silently.
- **Event listeners re-bound on every render** — `bindHandlers()` (~`app.js:2594–2670`) is called
  from `render()` (~`app.js:463`); only some handlers guard with `dataset.bound`. Rapid route
  changes can stack duplicate listeners. Fix: move to event delegation on a single stable root
  (e.g. `#main`/`body`), or bind once at boot.
- **Roster editor double-binding** — `bindRosterEditor()` (~`app.js:1488–1535`) attaches input
  listeners with no dedupe guard. Same fix as above.
- **Modal inputs read without null-guards** — e.g. `app.js:2045`
  (`modal.querySelector('[data-field="fitId"]').value`). Guard against missing nodes before
  mutating the case.

#### P1 — Duplication / refactor (do after a test net exists)

- **`handlePrompt()` action blocks are ~70% duplicated** — `app.js:2020–2541`, nine
  `if (kind === '...')` branches (assign_fit, escalate_to_hq, chase_fit, chase_hq, verify_fix,
  approaching_sla, end_of_shift_handover, …). Each builds a similar modal, reads fields, mutates
  the case, pushes history, toasts, and re-renders. Fix: extract a data-driven `PROMPT_HANDLERS`
  map (config per kind: title, fields, mutation, history-verb) + one generic runner. ~500 lines
  recoverable.
- **`renderCaseList()` is ~285 lines** — `app.js:611–895` (watchlist + header + kanban bands +
  status dropdown). Split into `renderBoardHeader()`, `renderBand()`, `renderCard()`,
  `renderStatusDropdown()`.
- **Magic numbers / config scattered** — `setInterval(checkReminders, 10000)` (`app.js:2689`),
  `setInterval(updateClock, 1000)` (`app.js:2691`), `grid-template-columns: 240px 1fr`
  (`styles.css:34`). Collect timing/layout constants into a single `CONFIG` object near the top of
  `app.js` (thresholds already live in `window.THRESHOLDS` — extend that pattern).
- **`styles.css` has no section structure** — add banner comments (`/* ---- Kanban ---- */`) or
  split into logical partials; group sidebar / nav / buttons / kanban / modals / tour.

#### P2 — Tooling / safety net

- **No automated tests.** This is the single biggest blocker to the P1 refactors — there is no
  regression net. Add a tiny zero-dep test runner (or Vitest, accepting one dev-only dependency)
  and write **characterization tests first** for the pure functions, before any refactor:
  - SLA / hold-time math — `app.js:190–207`
  - status & action-prompt derivation — `app.js:353–383`
  - office-hours / owner checks — `app.js:314–331`
  - date/time formatting helpers
- **XSS audit of hand-built modal HTML** — `app.js:1414–1420` concatenates conditional HTML.
  `escapeHtml()` (`app.js:308`) is used widely and correctly; confirm every interpolation in these
  modal strings is escaped.
- **Python backend writes `data.js` without schema validation** — `local/persist.py`,
  `local/serve.py`. Backups exist (`.orig`, timestamped `.bak`) but recovery is manual. Add a
  shape check before writing; keep a rolling backup.

### Sequencing

1. P0 fixes (independent, safe).
2. Add characterization tests (P2 tests) to lock current behavior.
3. P1 refactors (handlers map, render split, CONFIG) — now safe to do under test.
4. Remaining P2 (CSS sectioning, backend validation, XSS audit).

---

## 2. Site tour redesign spec

Target files: `prototype/tour.js`, tour CSS in `prototype/styles.css:1293–1432`, plus stable
markup hooks in `app.js` renderers. **Remains zero-dependency vanilla JS.** Direction: redesign
both the UX *and* the robustness/accessibility.

### UX + content

- **Spotlight cutout.** Replace the pulse-only highlight with a real dimmed spotlight: a
  full-page dim layer with a transparent cutout around the target rect (4-quadrant overlay, or a
  single element using a large `box-shadow` spread, or an SVG mask). The rest of the page is
  muted; the target reads as lit. Keep the highlighted element interactive only where it helps.
- **Progress dots.** Add clickable step dots alongside the existing `N / N` counter
  (`tour.js:160`); clarify the Back / Skip / Next hierarchy in `tour.js:162–172`.
- **Content pass.** Review and reorder the 12 steps (`tour.js:9–100`) for narrative flow,
  tighten copy, and ensure each pointer step leads with a one-line "why this matters."

### Robustness + accessibility

- **Missing-selector fallback.** In `renderStep()` (`tour.js:186–211`), when
  `document.querySelector(step.selector)` is null, today the tooltip renders centered but
  un-anchored with no signal. Fix: fall back to a clean centered modal card and `console.warn` the
  broken selector.
- **Remove the hard `C-1044` dependency.** Steps 6–7 navigate to `#/cases/C-1044`
  (`tour.js:57,65`); if seed data changes, those steps break. Resolve a target case dynamically
  (e.g. first open/escalated case) and build the route from it.
- **Fix HTML escaping.** `escape()` (`tour.js:107`) omits `'`. Align it with the app's
  `escapeHtml()` (`app.js:308`) — or reuse that function in the bundle.
- **Fix the keydown listener leak.** `keyHandler` is added in `renderStep()` (`tour.js:229`) but
  only removed on Escape (`tour.js:234`). Register and tear it down symmetrically inside
  `cleanup()` (`tour.js:125–135`), next to the existing resize/scroll teardown.
- **Accessibility.** Add `role="dialog"` + `aria-modal="true"`, an `aria-labelledby` pointing at
  the step title, a focus trap with focus restore on exit, and a `prefers-reduced-motion` branch
  that disables the pulse/spotlight animation.
- **Selector resilience.** Add stable `data-tour="..."` hooks in the app markup (board, op
  switcher, top band, queue toggle, reading panel, clocks, handover note, shift grid, archive
  grid) so a future CSS refactor can't silently break the tour. Switch tour steps to target these
  hooks instead of presentational class names.
- **Bundle sync.** After editing `tour.js`/CSS, re-run `prototype/bundle.mjs` so
  `standalone.html` stays current (the slide screenshots load `standalone.html`).

### Tour verification

- First-load auto-start still fires once (localStorage `case-tracker-tour-seen-v1`); "Take the
  tour" relaunches.
- Walk all steps forward/back; confirm spotlight tracks each target, fallback triggers when a
  selector is removed, no duplicate key handlers after multiple runs, focus returns to the
  launcher on exit, and reduced-motion disables animation.

---

## 3. Slides improvement + regeneration spec

Keep the existing pipeline: `slides/capture-screenshots.cjs` (Playwright) →
`slides/assets/*.png` → `slides/build-deck.cjs` (pptxgenjs) → `Case-Tracker-Overview.pptx`.
Direction: improve the fragile parts and regenerate; **stay on `.pptx`.**

### Fixes

- **Remove hardcoded global module paths.** `build-deck.cjs:5`
  (`require('/opt/node22/lib/node_modules/pptxgenjs')`) and the Playwright path in
  `capture-screenshots.cjs` break if Node/global installs move. Resolve via `require.resolve`,
  `NODE_PATH`, or a small `slides/package.json`, and **throw a clear error** if a dependency is
  absent.
- **Fail loudly on missing screenshots.** `picture()` (`build-deck.cjs:45–48`) emits a red
  `[name missing]` placeholder and continues. Fix: validate every expected asset exists up front
  and exit non-zero if any are missing.
- **Harden capture selectors + clipping.** `capture-screenshots.cjs:36–58` uses brittle selectors
  and a fixed clip `{ x:0, y:0, width:1500, height:780 }`, plus `:has()` which may not be
  supported everywhere. Fix: reset `localStorage` for a clean deterministic state, assert each
  target element is found (fail otherwise), prefer the new `data-tour`/stable hooks from §2, and
  derive crops from element bounding boxes rather than fixed pixels.
- **Recapture after the tour redesign** so the deck's visuals match the new UI; refresh stale
  hand-built copy — action thresholds on slide 6 (`build-deck.cjs:128–141`) and the architecture
  diagram on slide 5 (`build-deck.cjs:109–121`).
- **Expand `slides/README.md`** with regeneration + troubleshooting notes (deps, run order,
  common failures).

### Slides verification

1. `node slides/capture-screenshots.cjs` → expected PNGs in `slides/assets/`; spot-check
   `board.png` shows the four columns + MY QUEUE/BACKLOG bands + sidebar clock.
2. `node slides/build-deck.cjs` → writes `Case-Tracker-Overview.pptx`; the script exits non-zero
   if any asset is missing.
3. `unzip -l slides/Case-Tracker-Overview.pptx` lists `ppt/slides/slide1.xml … slide14.xml`.
4. `soffice --headless --convert-to pdf --outdir /tmp slides/Case-Tracker-Overview.pptx`, then
   review the PDF: images render, no clipped text, layout intact.

---

## Notes

- The earlier `docs/promo-slides-plan.md` references branch
  `claude/dual-status-case-kanban-WApps`; current work tracks the active development branch
  instead.
- Implementation of §2 and §3 is intended for a follow-up session; this document is the agreed
  scope and reference for that work.
