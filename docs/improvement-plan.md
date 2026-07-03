# Case Tracker — Code Review & Improvement Plan

> **Status (2026-06-15):** 20 items marked done (8 pre-existing `[x]` in §4 + 12 annotated this pass), 2 marked unapplicable, ~16 still open. Most-shipped: the auth/sanitization/CSS-sectioning hardening (§1), the slides recapture + dependency fixes (§3), and the live Case-Center mapping via `processTimeline` + the Route Board / `CC_CORE_DEPARTMENTS` model (§5). Still open: the §0/§1 refactors (module split, event delegation, `renderCaseList` split) and most of the §2 tour redesign (spotlight, a11y, selector resilience).

This document is a roadmap. It captures (1) a code-review of the current prototype with
prioritized fixes, (2) a redesign spec for the guided site tour, (3) an improvement +
regeneration spec for the promo slide deck, and (4) a backlog of requested features (refresh
buttons, Load New vs Refresh, weekly-archive splitting, a recycle bin, a first-line handling clock,
a clock-model explainer page, auto-status from the Case Center assignee, and clock/workflow
refinements). File references use
`path:line` anchors against the tree at the time of writing so a later implementation session
can execute directly.

The codebase is intentionally **zero-dependency vanilla JS + CSS** (a click-through prototype
for an Excel-replacement case tracker), with an optional Python live-data backend in `local/`.
The roadmap preserves that zero-dependency design unless explicitly noted.

---

## 0. Follow-ups deferred from the 2026-06-13 multi-angle review

The 2026-06-13 review (UX / front-end / back-end) was mostly implemented in that day's
commit. Two recommendations were **intentionally deferred** because they are large,
maintainability/perf-oriented refactors with real regression risk and no test coverage of
the rendering layer to catch breakage:

- [ ] **Split `frontend/app.js` (now ~6.1k lines, ~263 top-level functions) into modules.**
  Keep the zero-dependency design: extract to additional plain `<script>` files loaded before
  app.js (same shared global scope — no ESM churn), updating both `index.html` script order and
  `bundle.mjs`'s file list. Seam map from the 2026-07-03 structural review, in extraction order
  (lowest coupling first):
  1. `util.js` — `escapeHtml`/`safeId`/`safeUrl` + time/tz formatting (~app.js:684–912; pure, used everywhere)
  2. `casecenter-map.js` — raw CC record → board case mapping + `CC_*` maps (~app.js:1–234)
  3. `api.js` — auth/login gate + server persistence (~app.js:252–390, 5719–5896)
  4. per-view files: diagrams (~4290–4632), archive (~2854–3138), recycle bin (~3138–3273),
     shifts/rota editor (~3273–3675, 3970–4156), owners editor (~3675–3970)
  5. leave a `core` last: `STATE`, routing/`render()`, `bindHandlers`, boot — the high-coupling hub.
  Also decompose `handlePrompt` (~app.js:4732–5198, ~466 lines) into per-prompt handlers while
  in there. Blocked on first adding render-layer test coverage so the split can be verified.
- [ ] **Event delegation for the render loop.** Replace the ~30 `querySelectorAll +
  addEventListener` rebinds in `bindHandlers()` with a single delegated listener on a stable
  root (`#main`) keyed off `data-action`, and move high-frequency interactions (card select,
  filter) to targeted DOM updates instead of full `render()`. Eliminates per-render rebind
  cost and the manual scroll-restore hack.

Smaller back-end items noted but not done (prototype-acceptable for now): default
`AUTO_CREATE=0` for prod with a migration assertion — ✅ **done** (Alembic now ships with `0001_init.py`; `AUTO_CREATE` is documented as `0` for prod with `alembic upgrade head`, and `api.py:70` warns when AUTO_CREATE would mask a schema drift); DB connection-pool tuning + fuller
structured logging — _still open_; making `POST /api/save` non-blocking — ✅ **done** (the API is now FastAPI with an async `save()` handler under an `asynccontextmanager` lifespan, `api.py:62,129`).

---

## 1. Codebase review & roadmap

### Overview

| File | Lines | Role |
| --- | --- | --- |
| `frontend/app.js` | ~2,893 | Monolithic SPA: router, renderers, handlers, modals, state, live-data fetch |
| `frontend/styles.css` | ~1,432 | All styles, single file |
| `frontend/data.js` | ~657 | Seed cases, thresholds, frozen demo `NOW` |
| `frontend/tour.js` | ~306 | Custom guided tour |
| `slides/build-deck.cjs` | ~258 | pptxgenjs deck generator |
| `slides/capture-screenshots.cjs` | ~62 | Playwright screenshot capture |

Strengths to preserve: no external dependencies, consistent `escapeHtml()` usage, clear
`STATE` + `loadState()`/`saveState()` lifecycle, functional rendering style, well-commented file
headers.

### Prioritized findings

#### P0 — Robustness / correctness (do first; low risk)

- **[DONE] Live Case Center payload not validated before render** — `tryLoadLiveCases()`. It
  checked `Array.isArray(cases)` but then trusted each row's shape; a `null`/non-object/id-less
  record became a ghost card and collapsed the id-keyed merge (all id-less rows sharing the
  `undefined` key). Now validates each row (plain object + non-empty string `id`), drops bad ones,
  `console.warn`s + toasts a count, and keeps existing cases if nothing usable came back.
- **[RE-ASSESSED] Event listeners re-bound on every render** — original concern overstated. `render()`
  replaces `#main.innerHTML` wholesale (`app.js:455–463`), so listeners on those nodes are
  discarded with the old DOM — re-binding is correct, not a leak. The only persistent-element
  handlers (`op-switcher` `app.js:479`, `reset-state` `app.js:2628`) already guard with
  `dataset.bound`, and `bindRosterEditor()` operates inside the replaced `#main` subtree. **No fix
  required**; revisit only if event delegation is wanted as a perf/clarity refactor under P1.
- **[DONE] Modal inputs read without null-guards** — all 18 `modal.querySelector('[data-field=…]').value`
  reads now go through a null-safe `fieldVal(modal, name)` helper (`app.js`, just above
  `handlePrompt`), applied once the handler-outcome tests were in place. Returns `''` for a missing
  node instead of throwing if a field is renamed/removed without updating its `onSubmit`.

#### P1 — Duplication / refactor (do after a test net exists)

- **[RE-ASSESSED / IN PROGRESS] `handlePrompt()` action blocks** — `app.js`, ~17 `kind` branches
  (assign_fit, escalate_to_hq, chase_*, verify_fix, approaching_sla, resume, close_resolved,
  cancel, handover, set_reminder, toggle_queue, …). On reading, the *scaffolding* repeats but the
  per-kind logic is genuinely varied (distinct fields, validation, clock math, toasts), so the
  earlier "~500 lines, single data-driven map" estimate was optimistic and a full rewrite is
  higher-risk than billed. **Done so far** (test-guarded): (a) the null-safe `fieldVal` helper
  removed the 18 duplicated field reads; (b) a `logHistory(c, op, kind, detail)` helper replaced all
  16 `history.push({ at: new Date(NOW).toISOString(), who: op.id, … })` boilerplate pushes.
  **Optional next:** a small modal-actions builder for the repeated Cancel/Submit footer. A
  wholesale `PROMPT_HANDLERS` map remains optional and lower priority given the genuine per-kind
  variance.
- **`renderCaseList()` is ~285 lines** — `app.js:611–895` (watchlist + header + kanban bands +
  status dropdown). Split into `renderBoardHeader()`, `renderBand()`, `renderCard()`,
  `renderStatusDropdown()`.
- **Magic numbers / config scattered** — **[PARTLY DONE]** the reminder/clock timers
  (`setInterval(checkReminders, …)`, `setInterval(updateClock, …)`, `setTimeout(checkReminders, …)`)
  are now named constants (`REMINDER_POLL_MS`, `REMINDER_FIRST_RUN_MS`, `CLOCK_TICK_MS`) in the
  existing `// === CONFIG ===` block at the top of `app.js`. Still to do: layout magics such as
  `grid-template-columns: 240px 1fr` (`styles.css:34`).
- **`styles.css` has no section structure** — add banner comments (`/* ---- Kanban ---- */`) or
  split into logical partials; group sidebar / nav / buttons / kanban / modals / tour. — ✅ **done** (`styles.css` now carries ~37 section banners: `/* ---------- Sidebar ---------- */`, `Main`, `Cards`, `Queue`, `Buttons`, an `Accessibility base` block, etc.)

#### P2 — Tooling / safety net

- **[DONE] No automated tests.** A zero-dependency characterization harness now exists under
  `frontend/tests/` (`node frontend/tests/run.cjs`, 37 tests). `load-prototype.cjs` evaluates
  the browser globals in a Node `vm` with a DOM shim and a **frozen clock** (pinned to the seed
  `NOW`, so the time-shift offset is 0 and `NOW`-relative math is deterministic); `run.cjs` holds
  the tests. Verified to catch regressions (a deliberate `fmtDuration` break fails the run).
  Covered: `fmtDuration`, `statusLabel`/`displayStatus`/`isQueued`, `caseSlaMs`, `caseHoldMs`
  (`app.js:195–210`), `derivePromptsForCase` (`app.js:365–388`), `needsHandoverNote`
  (`app.js:561–567`), plus seed structural sanity. This is the safety net the P1 refactors depend
  on. Next: extend coverage to office-hours/owner checks (`app.js:314–331`) and `fmtRelative`.
- **XSS audit of hand-built modal HTML** — `app.js:1414–1420` concatenates conditional HTML.
  `escapeHtml()` (`app.js:308`) is used widely and correctly; confirm every interpolation in these
  modal strings is escaped. — ✅ **done** (hardened beyond a one-off audit: `safeId()` strips markup/attribute-breakout chars and `safeUrl()` rejects `javascript:`/`data:` schemes (`app.js:760–772`), and `sanitizeCaseIdentity()` is applied at every boundary where a case enters STATE (`app.js:227`, `app.js:4798`) so id/`caseLink` sinks are closed regardless of per-call escaping; `escapeHtml` is used ~190×.)
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

Target files: `frontend/tour.js`, tour CSS in `frontend/styles.css:1293–1432`, plus stable
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
  (e.g. first open/escalated case) and build the route from it. — ✅ **done** (the tour was rewritten around the Picked workspace / Route Board; steps now target route-level hashes (`#/cases`, `#/archive`, `#/shifts`, `#/owners`) plus class selectors — no `#/cases/C-1044` deep-link or hardcoded case id remains.)
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
- **Bundle sync.** After editing `tour.js`/CSS, re-run `frontend/bundle.mjs` so
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
  absent. — ✅ **done** (both scripts now use a plain `require('pptxgenjs')` / `require('playwright')` resolved from a local `npm install --prefix slides`; the `/opt/node22/...` absolute paths are gone.)
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
  diagram on slide 5 (`build-deck.cjs:109–121`). — ✅ **done** (commits "slides: refresh screenshots against current UI + rebuild deck" and "refresh promo deck for the deployable tool"; assets recaptured against the Picked workspace + Route Board UI (`board.png`, `routeboard.png`, …), the architecture diagram and the thresholds copy ("Core 4h / HQ 8h", `build-deck.cjs:161`) were refreshed to the Core Team model, and a "What it runs on" tech-stack slide was added.)
- **Expand `slides/README.md`** with regeneration + troubleshooting notes (deps, run order,
  common failures). — ✅ **done** (`slides/README.md` now documents the local-install deps, the capture→build run order, and the `npm install --prefix slides` workflow.)

### Slides verification

1. `node slides/capture-screenshots.cjs` → expected PNGs in `slides/assets/`; spot-check
   `board.png` shows the four columns + MY QUEUE/BACKLOG bands + sidebar clock. — _unapplicable: the status-kanban with MY QUEUE/BACKLOG bands was replaced by the Picked workspace + Hand-off Route Board (`app.js:1241` "replaces the old kanban-by-CC-status board"; capture now grabs `.route-band`/`routeboard.png`). `board.png` should show the Picked workspace + Route Board instead._
2. `node slides/build-deck.cjs` → writes `Case-Tracker-Overview.pptx`; the script exits non-zero
   if any asset is missing.
3. `unzip -l slides/Case-Tracker-Overview.pptx` lists `ppt/slides/slide1.xml … slide14.xml`.
4. `soffice --headless --convert-to pdf --outdir /tmp slides/Case-Tracker-Overview.pptx`, then
   review the PDF: images render, no clipped text, layout intact.

---

## 4. Feature backlog (requested)

Tracked todo list — each item has a concrete plan below.

- [x] **4.1** Refresh button per case + a "refresh all stored cases" button. *(Done: `⟳` on each
  kanban card + reading-panel/detail actions calls `refreshCase(id)`; a "Refresh Existing" toolbar
  button calls `refreshAllStored()`. Both reuse a shared `mergeLiveCase` (validates + normalizes +
  merges one record, preserving the agent layer) and the existing `GET /api/cases?id=` endpoint —
  no backend change needed. Shown everywhere (incl. the Pages demo / `file://`); without a backend
  a click degrades gracefully with a "no backend" toast.)*
- [x] **4.2** Rename the live-load action to **"Load New"** to distinguish loading new cases from
  refreshing existing ones. *(Done: button relabelled "Load New", tooltip + `reloadLiveCases` toast
  reworded, paired with the new "Refresh Existing" button.)*
- [ ] **4.3** Split the weekly archive out of `data.js` so the file doesn't grow unbounded.
- [x] **4.4** Garbage-bin icon in the archive view, foolproof double-confirm before deleting, and a
  1-week recycle bin for deleted cases. *(Done: 🗑 per archive-week row soft-deletes via `deletedAt`
  (one confirm); a `#/archive/bin` Recycle bin lists binned cases with time-remaining, Restore, and
  a second-confirm "Delete forever"; binned cases are hidden from board/archive/stats/reminders;
  auto-purge after 7 days on the reminder tick. Persists in demo (localStorage) and live mode
  (`persist.py` honors `deletedAt` + `purge_ids`).)*
- [x] **4.5** Add a **First-line handling** clock to the case-detail clock grid (alongside SLA,
  Local FIT, and HQ Product Team). *(Done: `renderCaseDetailBody` shows a 4th tile valued
  `holderTotals.triage` — triage only; Sanity Check is requester time per 4.8 — with a `tl-triage`
  swatch and a "Holding now" state; guarded by `holderTotals` characterization tests.)*
- [x] **4.6** Add a **"Clock model"** explainer page (like Status Flow) showing how each clock is
  calculated. *(Done: `renderClockModel()` on route `#/clocks`, wired into nav/router; explains
  each clock's start/pause/bank and renders a worked example via the real `renderOwnershipTimeline`
  so it can't drift from the calculation.)*
- [ ] ~~**4.7** On live refresh, if a case's Case Center **assignee maps to a Local FIT desk or HQ
  Product Team**, auto-move the case to the matching status (`with_fit` / `with_hq`) and log a
  history note of the change.~~ — _unapplicable: superseded by the Route Board model. Station is now derived live from `assigneeDept` via `caseStation(c)` (`app.js:1058`) + the configurable `window.CC_CORE_DEPARTMENTS` / `window.CC_HQ_DEPARTMENTS` (`owners.js`) and `route_role`, so there is no separate "auto-move status + log history" step to build (and "Local FIT" is now "Core Team")._
- [x] **4.8** Clock model: count **Sanity Check time as requester time**, not first-line time.
  *(Done: `ownershipSegments` classifies Sanity Check as `requester`; First-line clock is now
  triage-only; clock-model table/example updated; option (a) — SLA keeps running through Sanity
  Check — was chosen.)*
- [x] **4.9** Let the **first-line agent return a New case to the requester**. *(Done: "Return to
  requester" added to the `new` status transitions; Status Flow diagram + table updated; handler
  already handled the null-owner path. Test added.)*
- [x] **4.10** Load cases by a **created-between time window** (e.g. created between 72h and 60h
  ago), not just "created within N hours". *(Done: second "newer bound" input in the toolbar;
  `liveCasesUrl(from,to)` → `?fromHours=&toHours=` (legacy `?hours=` when newer bound is 0);
  `windowError` validation; `serve.py` parses both, `casecenter.fetch_cases` sets `LOOKBACK_HOURS`
  + new `TO_HOURS` globals for `fetch_raw()`. Tests + Python check + UI smoke confirm the band
  request.)*

**Dependency note:** 4.2 is trivial and pairs with 4.1. 4.1 needs a small backend addition.
4.3 (archive splitting) and 4.4 (recycle-bin persistence) both change the case-storage shape and
`local/persist.py`, so they should be designed together. 4.5 and 4.6 are display-only (no backend
change); 4.6 documents 4.5, so build 4.5 first or together.

### 4.1 — Per-case refresh + refresh-all-stored

**What exists to reuse**
- Backend already supports single-case fetch: `GET /api/cases?id=CASE_ID`
  (`local/serve.py:76–134` → `casecenter.fetch_cases(case_id=...)`, `local/casecenter.py:213–240`).
- Bulk fetch by lookback: `GET /api/cases?hours=N`.
- Frontend normalize + merge that already preserves the local agent layer (`agentStatus`,
  `handover`, `reminder`): `normalizeLiveCase` (~`app.js:2712`) and the id-keyed merge in
  `tryLoadLiveCases` (`app.js:2815–2831`). `showToast` (`app.js:1988–2005`), `caseById`
  (`app.js:188`), and the http(s)-only guard (`app.js:2794`) are reusable as-is.

**Plan**
- **Per-case refresh:** add a small `⟳` icon button on each kanban card and in the reading
  panel / case-detail header. Handler `refreshCase(id)`: `fetch('api/cases?id='+id)` →
  `normalizeLiveCase` → merge that one case into `STATE.cases` (reuse the same overlay rule that
  keeps the agent layer) → `render()` → toast (`Refreshed C-1041.` / failure warn).
- **Refresh all stored:** add a toolbar button **"Refresh Existing"** next to "Load New"
  (see 4.2). It re-pulls every currently stored case id rather than the lookback window. Backend
  addition: accept `GET /api/cases?ids=C-1,C-2,...` in `serve.py` and pass the list through
  `casecenter.fetch_cases`; frontend gathers `STATE.cases.map(c => c.id)`, fetches (chunk if the
  list is long), and reuses the existing merge. Falls back to disabled on `file://`.
- Show a spinner via the existing `showLiveLoading()/hideLiveLoading()` helpers used by
  `reloadLiveCases` (`app.js:2865–2875`).

### 4.2 — Rename "Load" → "Load New"

**What exists**
- The live-load button is `#lookback-load` with text `Load` (`app.js:737`), bound at
  `app.js:2646–2657`, calling `reloadLiveCases()` (`app.js:2865–2875`). It loads Case Center cases
  *created within* the lookback window.

**Plan**
- Change the button label to **"Load New"** and update the tooltip/label copy
  (`app.js:737`) to "Pull Case Center cases **created within** this many hours (new cases)".
- Update the success toast in `reloadLiveCases` to read `Loaded N new case(s) created within Nh.`
- Pair it with the **"Refresh Existing"** button from 4.1 so the two flows are visually distinct:
  *Load New* = discover new cases in a time window; *Refresh Existing* = re-pull cases already on
  the board. Keep the element id or rename to `#lookback-load-new` consistently in the handler.

### 4.3 — Split the weekly archive out of `data.js`

**Problem:** `local/persist.py` rewrites the whole `window.CASES` block and never drops cases
(`persist.py:86–164`), so `data.js` grows without bound as weeks accumulate. The frontend also
loads every case into `STATE.cases` up front (`app.js:25`).

**What exists to reuse**
- Week catalog `window.WEEKS` (`data.js:22–27`) and `case.weekId` membership (set at creation,
  `app.js:2712`).
- `weekStats(weekId)` (`app.js:1131–1146`), `renderArchiveIndex` (`app.js:1148–1176`), and
  `renderArchiveWeek` (`app.js:1178–1257`).

**Plan**
- **Storage split:** keep only the **current week + still-open carried-over cases** in `data.js`.
  Move sealed past weeks into per-week files under `frontend/archive/<weekId>.js`, each setting
  e.g. `(window.CASES_ARCHIVE ||= {})['W22-2026'] = [ ... ]`. Add a precomputed
  `window.WEEK_STATS` snapshot (totals per week) so the **archive index renders without loading
  any week's full case list**.
- **Lazy load on demand:** `renderArchiveWeek` injects/`fetch`es the matching
  `archive/<weekId>.js` only when that week is opened; `weekStats` reads the loaded bucket or the
  precomputed snapshot. Index page uses `WEEK_STATS` only.
- **Backend roll/seal step:** teach `persist.py` to partition by `weekId` on write — current/open
  cases → `data.js`, completed weeks → `archive/<weekId>.js` — and add a "seal week" routine that
  freezes a finished week and records its stats into the snapshot.
- **`file://` fallback:** when there's no backend, keep loading whatever archive files are present
  via `<script>` tags in `index.html` (alongside `data.js`), so the static demo still works.
- This is the largest item and sets the storage shape that 4.4 builds on — design first.

### 4.4 — Archive delete (bin) + foolproof double-confirm + 1-week recycle bin

**What exists to reuse**
- `showModal(html, onSubmit)` (`app.js:2007–2018`) and the **two-step danger pattern** already
  used by `deleteOperator` (`app.js:1408–1450`, with `btn-danger`, reassign/confirm). `showToast`
  for feedback. There is **no case-delete today** — operators/shifts/owners have delete, cases do
  not.
- The archive week table rows (`renderArchiveWeek`, `app.js:1178–1257`).

**Plan**
- **Bin icon:** add a `🗑` button per case row in the archive week table (and optionally a
  per-week action). Clicking it starts the delete flow.
- **Foolproof double-confirm:** reuse `showModal`. First modal = "Move case C-1041 to the recycle
  bin?" (`btn-danger`, explains 7-day restore window). A *second* explicit confirmation is required
  for **permanent** deletion (either a second modal or a typed-`DELETE` confirmation), mirroring
  the `deleteOperator` safeguard so nothing is destroyed on a single click.
- **Soft delete → recycle bin:** set `case.deletedAt` (ISO). Exclude cases with `deletedAt` from
  the board (`app.js:495` filter), archive tables, and week stats. Add a **Recycle bin** route
  (e.g. `#/archive/bin`) listing binned cases with time-remaining, a **Restore** action (clears
  `deletedAt`) and a **Permanently delete** action (the second-confirm hard delete via
  `STATE.cases.splice`).
- **Auto-purge after 7 days:** on boot and on the existing periodic tick (reuse the
  `setInterval(checkReminders, …)` cadence, `app.js:2689`), hard-remove cases whose `deletedAt` is
  older than 7 days.
- **Persistence:** `deletedAt` rides along in full-state `saveState` automatically. For **live
  mode**, teach `persist.py` to honor `deletedAt` — exclude binned cases from `window.CASES`
  (optionally into an `archive/bin.js`) and purge after 7 days — since today it merges and never
  drops cases. This is why 4.4 must be designed alongside 4.3.

**Verification (4.1–4.4)**
- Run `python3 local/serve.py`, open localhost: per-case `⟳` updates one card and keeps its queue
  placement/handover; "Refresh Existing" re-pulls all stored ids; "Load New" only adds cases from
  the time window.
- Open an archived week, bin a case → it disappears from the board/archive and appears in the
  recycle bin with a countdown; Restore brings it back; permanent delete needs the second confirm.
- Confirm `data.js` stays bounded after sealing a week (archive file created, index still renders
  from the stats snapshot), and a case binned >7 days ago is purged on next boot.

### 4.5 — First-line handling clock

**Today** the case-detail clock grid shows three clocks: **SLA · time on us**, **Local FIT**, and
**HQ Product Team** (`renderCaseDetailBody`, `app.js:982–998`). There is no clock for the time a
case sits directly with the **first-line agent** (triage on a New case, and the Sanity-Check
verify step) — even though that time is real "on us" handling time.

**What exists to reuse — the data is already computed.** The ownership timeline derives per-holder
totals from case history in `holderTotals(c)` (`app.js:884–890`), which already returns
`{ triage, fit, hq, sanity, requester }`. The detail clocks for FIT/HQ already source from this
(not from `c.holdMs`), so the timeline and clocks stay in agreement. `HOLDER_META`
(`app.js:892–899`) holds the labels/colors (`triage` = "First line" `tl-triage`, `sanity` =
"Sanity check" `tl-sanity`).

**Plan**
- Add a fourth `.clock` tile to the clock grid (`app.js:982–998`) labelled **First line** with the
  value `holderTotals(c).triage + holderTotals(c).sanity` (the time the case was held by the agent
  directly — triage while New, plus the Sanity-Check verify window). Add a tooltip breaking it into
  "triage / sanity" so the number reconciles with the timeline legend.
- **"Holding now"** state is active when `c.currentOwner === null`, the case is open, not paused/
  returned, and status ∈ {`new`, `sanity_check`} — mirror the `running` styling the FIT/HQ tiles
  use (`c.currentOwner === 'fit'`).
- Use the `tl-triage` color dot so the clock visually matches its timeline segment.
- **CSS:** the grid currently lays out three tiles; let four wrap cleanly (`.clock-grid` in
  `styles.css` — make it `repeat(auto-fit, minmax(…))` or a 2×2 grid).
- Surface the same figure in any compact clock view if one exists (reading panel); otherwise scope
  to the detail grid.

**Tests (reuse the harness):** `holderTotals` / `ownershipSegments` (`app.js:835–890`) are
pure, history-derived functions — ideal for `frontend/tests/run.cjs`. Add characterization tests
that feed a synthetic `history` (created → assigned → escalated → returned → resumed → closed) and
assert the `triage`/`sanity`/`fit`/`hq`/`requester` splits, locking the first-line math before and
after the UI change.

### 4.6 — "Clock model" explainer page (like Status Flow)

**What exists to reuse.** Status Flow is a self-contained SVG page: `renderStatusFlow()`
(`app.js:1864+`) on route `#/flow`, wired in five small places — nav link in `index.html:34`
(`<a href="#/flow" data-route="flow">`), router (`app.js:417`), `labelForRoute` (`app.js:436`),
the active-nav map (`app.js:456`), and the render dispatch (`app.js:467`). The new page mirrors
this exactly.

**Plan**
- Add `renderClockModel()` and a new route `#/clocks` (label e.g. "Clock model"), wired in the same
  five spots as `flow`. Add a sidebar nav entry next to "Status Flow".
- Content — explain, per clock, what **starts**, **pauses/stops**, and **banks** it, matching the
  real logic so the page is the single source of truth:
  - **SLA · time on us** — runs from `slaStartedAt`; **pauses** on `returned_to_requester`
    (`approaching_sla` handler), **resumes** with a fresh segment on `resume`, and is **banked**
    into `slaAccumulatedMs` on close/cancel. (`caseSlaMs`, `app.js:195–203`.)
  - **First line** — accrues while the case is in triage (New) or Sanity Check (`holderTotals`
    `triage`+`sanity`).
  - **Local FIT** / **HQ Product Team** — accrue between `assigned`→hand-off and
    `escalated`→hand-off respectively (history-derived via `ownershipSegments`).
- Reuse the **timeline colors** (`HOLDER_META` / `tl-*` classes) so the legend matches the case
  detail, and render a small **worked example**: build one synthetic case and call the existing
  `renderOwnershipTimeline()` so the explainer shows a real bar with the same component used on the
  detail page (guarantees the doc can't drift from the calculation).
- Keep it static/diagram-style like `renderStatusFlow` (an SVG or a styled table mapping each
  lifecycle state → which clock is running), plus the worked-example timeline.

**Verification (4.5–4.6)**
- Open a case detail (e.g. one that went New → FIT → HQ → Sanity → Closed): the new **First line**
  clock shows non-zero and its value + the FIT/HQ/SLA clocks reconcile with the ownership-timeline
  legend. `node frontend/tests/run.cjs` stays green with the new `holderTotals` tests.
- Navigate to `#/clocks`: the explainer renders, the worked-example timeline matches the detail
  page's component, and each clock's start/pause/bank description matches the handler behavior.

### 4.7 — Auto-status from Case Center assignee on refresh

**Goal.** When a live refresh shows a case's Case Center **assignee** is one of our Local FIT desks
or HQ Product Teams, move the board status to the matching one (`with_fit` / `with_hq`), set the
owner (`fitId` / `hqId`), and append a history note recording the auto change — so the board tracks
who Case Center says is holding the case without the operator re-assigning by hand.

**What exists to reuse**
- Live records already carry the assignee: `assigneeId` (accountId) and `assigneeDept` (deptName),
  mapped in `local/casecenter.py:159–160` (`map_record`). Pulled into the board via
  `normalizeLiveCase` (`app.js:2698`) and the id-keyed merges in `tryLoadLiveCases` (`app.js`,
  validated payload branch) and `addCaseById` (`app.js:2485–2514`).
- Owner directory `window.OWNERS.{fit,hq}` (`frontend/owners.js`) — each entry has `id`, `name`,
  and `region`/`area`. Status enums and the existing assign/escalate transitions live in
  `handlePrompt` (`assign_fit`/`escalate_to_hq`). History logging helper `logHistory(c, op, kind,
  detail)`; `getOwner('fit'|'hq', id)`.

**Plan**
- **Decide the assignee → owner mapping (design first).** Case Center gives an `assigneeId`/
  `assigneeDept`, not our owner ids. Add an explicit mapping rather than guessing — recommended: an
  alias table (e.g. `window.OWNER_ALIASES = { 'FIT APAC': 'fit-apac', '<assigneeDept>': 'hq-data',
  … }`) keyed by the Case Center dept/account, resolving to a `window.OWNERS` id. Keep it editable
  alongside `owners.js`. Fallback: case-insensitive match of `assigneeDept`/assignee name against
  owner `name`/`region`/`area`.
- **Apply on refresh, not on manual edits.** In `normalizeLiveCase` (or a small
  `applyAssigneeRouting(c)` called right after normalize, before the merge re-applies the agent
  layer), resolve the assignee to a `{pool:'fit'|'hq', ownerId}`. If resolved and the case is open
  (not closed/cancelled/returned):
  - FIT match → if `c.status !== 'with_fit'` or `c.fitId !== ownerId`: set `status='with_fit'`,
    `fitId=ownerId`, `currentOwner='fit'`, start the FIT hold segment (`holdStartedAt`), and
    `logHistory(c, system, 'assigned', 'Auto from Case Center assignee — <owner name>')`.
  - HQ match → analogous to `with_hq` / `hqId` / `escalated` note.
- **Idempotent & non-destructive:** only act when the derived owner/status differs from what's
  already on the case (so repeated refreshes don't spam history), and never override a manual
  `returned_to_requester`/closed state. Use a synthetic author id (e.g. `'system'`) or the current
  operator for the history `who`.
- **Live-only:** this runs only in live mode (served by `serve.py`); seed/demo cases are unaffected.

**Tests (reuse the harness):** `applyAssigneeRouting` should be a pure function over `(case,
OWNERS, aliases)` → mutated case + optional history entry, so it's unit-testable in
`frontend/tests/run.cjs`: assert FIT-assignee → `with_fit`+`fitId`+history note; HQ-assignee →
`with_hq`+`hqId`; unknown assignee → unchanged; already-correct status → no duplicate history;
closed/returned case → untouched.

**Verification:** with `serve.py` running and a mapped assignee in the Case Center data, a refresh
moves the case into the right column, sets the owner, starts the owner clock, and adds one "Auto
from Case Center assignee" history entry; a second refresh adds none.

### 4.8 — Count Sanity Check as requester time (revises 4.5 / 4.6)

**Why.** 4.5/4.6 currently treat Sanity Check as first-line handling (the First-line clock =
`triage + sanity`). But during Sanity Check the case is really *waiting on the requester* to confirm
the fix — so that span should be attributed to the requester, and the First-line clock should be
**triage only**.

**What exists**
- `holderTotals(c)` (`app.js:884–890`) returns `{ triage, fit, hq, sanity, requester }`; the
  Sanity-Check segment is classified `sanity` in `ownershipSegments`'s `classify` (`app.js:848–849`).
- First-line clock: `firstLineMs = hold.triage + hold.sanity` (`renderCaseDetailBody`, the 4.5
  change) and the `renderClockModel` worked example (4.6).
- `HOLDER_META.sanity` (`app.js:896`, label "Sanity check", `tl-sanity`).

**Plan**
- **Keep the timeline segment distinct** (so the bar still shows a "Sanity check" band) but **count
  its time under `requester`** in `holderTotals`: fold `sanity` into `requester` in the returned
  totals (or have `classify` map sanity → requester while preserving a sub-label for the bar).
  Simplest low-risk option: in `holderTotals`, `tot.requester += sanitySpan` and stop exposing
  `sanity` as a first-line contributor.
- **First-line clock → triage only:** change `firstLineMs` to `hold.triage` and update its tooltip
  (drop the "+ Sanity Check" breakdown). Update the `renderClockModel` table (move Sanity Check
  under the requester/"with requester" explanation) and the worked-example numbers.
- **SLA interaction — decide explicitly.** Today SLA only pauses on `returned_to_requester`, not
  during `sanity_check`, so after this change `SLA = lifetime − requester` no longer holds while a
  case is in Sanity Check. Two options: **(a)** display-only reclassification — keep SLA running
  through Sanity Check and soften the clock-model note; or **(b)** also **pause SLA during
  `sanity_check`** (changes `caseSlaMs` `app.js:195–203` and the move-to-sanity/verify handlers).
  Recommend (a) first; treat (b) as a separate follow-up.
- **Tests:** update the 4.5 `holderTotals` characterization tests so the lifecycle case attributes
  the Sanity span to `requester` and First-line = `triage` only; the worked-example reconciliation
  in 4.6 changes accordingly.

### 4.9 — First line can return a New case to the requester

**Why.** A first-line agent often needs to bounce a brand-new case back to the requester (needs
repro steps / out of scope) *before* assigning it to FIT. Today that's impossible: `statusTransitions`
only offers "Return to requester" from `with_fit` / `with_hq` (`app.js:1127, 1131`); a `new` case can
only be **Assign to Local FIT** or **Cancel** (`app.js:1122–1124`).

**What exists to reuse**
- The return action is the `approaching_sla` handler (`app.js:2273`), which pauses the SLA clock,
  sets `returned_to_requester`, and logs a `returned` history entry. It already guards
  `if (c.currentOwner && c.holdStartedAt)`, so a New case with **no owner** returns cleanly (nothing
  to stop). `resume` already supports coming back to `new` (unassigned), so the round-trip works.

**Plan**
- Add `t.push({ kind: 'approaching_sla', label: 'Return to requester' });` to the `case 'new':`
  branch of `statusTransitions` (`app.js:1122–1124`).
- **Optional rename:** `approaching_sla` is a misnomer when triggered from New. Either keep it (least
  churn) or rename the kind to `return_to_requester` across `PROMPT_DEFS` (`app.js:396`),
  `statusTransitions` (both existing sites), and the handler — a small, test-guarded sweep.
- **Update Status Flow** (`renderStatusFlow`, `app.js:1864+`): add a New → Returned-to-Requester
  arrow and a transition-table row (`app.js:1990+`) so the diagram matches.
- **Tests:** add a `handlePrompt` outcome test — from `status:'new', currentOwner:null`, submit
  `approaching_sla` with a reason → `status:'returned_to_requester'`, `slaPaused:true`, last history
  kind `returned`, and no error from the null-owner path.

### 4.10 — Load cases by a created-between time window

**Why.** Today "Load New" pulls cases **created within the last N hours** (a single look-back box →
`?hours=N`). The operator wants to query a **band** — e.g. cases created **between 72h and 60h
ago** — to backfill a specific window without re-pulling everything since then.

**What exists**
- Front end: the look-back control (`#lookback-input` + `#lookback-load`, `renderCaseList`) →
  `reloadLiveCases()` → `tryLoadLiveCases()` builds `api/cases?hours=${STATE.lookbackHours}`
  (`app.js`). `STATE.lookbackHours` persists in `localStorage` (`case-tracker-lookback`).
- Back end: `serve.py` `_serve_cases` reads `?hours=`; `casecenter.fetch_cases(lookback_hours=...)`
  sets `LOOKBACK_HOURS` for the operator's `fetch_raw()` query (`local/casecenter.py:213–240`).

**Plan**
- **UI:** add a second number input so the control reads "Created between `[to]` and `[from]` hours
  ago" (two fields: `fromHours` = older bound, `toHours` = newer bound; e.g. 72 and 60). Keep the
  single-box "within N hours" behavior when the newer bound is blank/0 (back-compat). Persist both
  in `localStorage`.
- **Query:** extend the request to `api/cases?fromHours=72&toHours=60` (keep `?hours=` working).
- **Back end:** `serve.py` parse `fromHours`/`toHours`; pass a `(from_hours, to_hours)` window to
  `casecenter.fetch_cases`, which exposes it to `fetch_raw()` (the user fills in the actual
  Case Center date-range filter — document the two module globals like `LOOKBACK_HOURS`).
- **Validate:** require `fromHours > toHours >= 0`; warn otherwise (mirror the existing positive-N
  guard in the `doLoad` handler).
- **Merge:** unchanged — results flow through the validated `mergeLiveCase`/overlay path, so a band
  query never wipes operator work.
- **Tests:** assert the request URL is built correctly for both the single-bound and two-bound
  cases, and that the validation rejects an inverted/negative window.

## 5 — Live Case Center mapping (open items)

Moved here from the former `local/TODO-casecenter-mapping.md` so all backlog lives in one file.
Resumable checklist for wiring live Case Center data. **Edit point for everything below:**
`local/casecenter.py`. Verify with the snippet at the bottom. Full context: `local/README.md`.

**Resolved (in `local/casecenter.py`):** items 1–6 — `caseStatus`/`caseSubstatus` → column +
label (`STATUS_MAP` / `STATUS_MAP_BY_STATUS`), `caseLevel` → priority (`LEVEL_MAP`), people &
departments in `map_record()`, case link (`BASE_URL` / `build_case_link()`), and the GMT ISO-8601
`createDateTime` pass-through. See the casecenter.py docstrings for the agreed mapping tables.

**Still open:**

- **7. Ownership history → timeline + FIT/HQ time.** Live cases return `history: []`, so the
  ownership timeline and FIT/HQ clocks read 0m. If Case Center exposes a status/assignment audit
  log, map it in `map_record()` into a `history` array of `{ at, who, kind, detail }` that
  `ownershipSegments()` (`app.js`) understands (`created` → first line · `assigned` → Local FIT ·
  `escalated` (detail `FIT → HQ …`) → HQ · `status` (detail contains `Sanity Check`) → sanity ·
  `returned` → with requester · `resumed` · `closed`/`cancelled`). Also populates the History list. — ✅ **done** (Case Center's `processTimeline` is the audit log; `map_process_timeline()` (`casecenter.py:220`) normalizes each stage — processType / processor / dept / cc+board status / start-end / minutes — into the board's Process timeline component, which now drives the per-station clocks. Superseded the literal `history[]` shape with the richer processTimeline model.)
- **8. Owner / routing (FIT vs HQ attribution).** Live cases set no `fitId`/`hqId`/`currentOwner`.
  Decide how `assignee.accountId`/team maps to the board owner model (see §4.7's alias-table plan)
  and set `currentOwner` to `'fit'`/`'hq'` so the active-owner clock/column are correct. — ✅ **done** (resolved by the Route Board model rather than the alias table: `dept_from_timeline()` (`casecenter.py:267`) resolves an account id → dept; `caseStation(c)` (`app.js:1058`) maps `assigneeDept` through the configurable `CC_CORE_DEPARTMENTS`/`CC_HQ_DEPARTMENTS` (`owners.js`) to a Core Team / HQ / User station.)
- **9. SLA accuracy for live cases.** `caseSlaMs()` runs from `createDateTime` with no pauses
  (no transitions). If Case Center reports real on-us/pause windows, map them
  (`slaAccumulatedMs`/`slaPaused`, or derive from the #7 audit log). — ✅ **done (partial)** (the `("In-Progress", "Wait User")` substatus now maps to `returned_to_requester` (the SLA-paused state) and `map_wait_user()` (`casecenter.py:248`) surfaces the parked-on-user block; pause windows derive from processTimeline. Note: fine-grained `slaAccumulatedMs` reconstruction across multiple pauses is not separately computed.)
- **10. Weekly Archive bucketing.** `normalizeLiveCase()` defaults every live case's `weekId` to
  the current week. Derive `weekId` from `createDateTime` against `window.WEEKS` for past-week
  bucketing. — ✅ **done** (`normalizeLiveCase` now sets `c.weekId = weekIdFor(c.createdAt)` when unset (`app.js:178`), bucketing each live case by its created date instead of always the current week.)
- **11. Refresh cadence & cookie expiry (nice-to-have).** Data pulls on load/refresh only. Optional:
  auto-refresh interval or manual button; surface a clear banner when `/api/cases` fails (cookie
  expired → 500) instead of silently falling back to seed.
- **`fetch_raw()`** in `local/casecenter.py` — paste the real Case Center request and
  `return x_json["data"]` (credentials come from env vars or `secrets.local.json`).

**Verify after filling the tables:**

```bash
python3 -c "
import sys; sys.path.insert(0,'local'); import casecenter as cc, json
rec = {'caseId':1,'subject':'t','createDateTime':'2026-06-05T05:12:00Z',
       'caseLevel':'<a real level>','caseStatus':'<a real status>',
       'caseSubstatus':'<a real substatus>','assignee':{'accountId':'a1'}}
print(json.dumps(cc.map_record(rec), indent=2))   # expect correct status + priority
"
```
Then run `python3 local/serve.py` and open http://127.0.0.1:8787/ — cases should land in the
right columns. (Public Pages site stays on seed data; live mode is local only.)

## Notes

- The earlier `docs/promo-slides-plan.md` references branch
  `claude/dual-status-case-kanban-WApps`; current work tracks the active development branch
  instead.
- Implementation of §2, §3, and §4 is intended for follow-up sessions; this document is the agreed
  scope and reference for that work.
