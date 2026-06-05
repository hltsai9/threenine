# Case Tracker — Code Review & Improvement Plan

This document is a roadmap. It captures (1) a code-review of the current prototype with
prioritized fixes, (2) a redesign spec for the guided site tour, (3) an improvement +
regeneration spec for the promo slide deck, and (4) a backlog of requested features (refresh
buttons, Load New vs Refresh, weekly-archive splitting, and a recycle bin). File references use
`path:line` anchors against the tree at the time of writing so a later implementation session
can execute directly.

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
  higher-risk than billed. **Done so far** (test-guarded): the null-safe `fieldVal` helper removed
  the 18 duplicated field reads. **Next, incrementally:** a `logHistory(c, op, kind, detail)` helper
  for the ~13 identical `history.push({ at: new Date(NOW).toISOString(), who: op.id, … })` lines,
  and a small modal-actions builder for the repeated Cancel/Submit footer — each landed under the
  handler-outcome tests. A wholesale `PROMPT_HANDLERS` map remains optional and lower priority.
- **`renderCaseList()` is ~285 lines** — `app.js:611–895` (watchlist + header + kanban bands +
  status dropdown). Split into `renderBoardHeader()`, `renderBand()`, `renderCard()`,
  `renderStatusDropdown()`.
- **Magic numbers / config scattered** — **[PARTLY DONE]** the reminder/clock timers
  (`setInterval(checkReminders, …)`, `setInterval(updateClock, …)`, `setTimeout(checkReminders, …)`)
  are now named constants (`REMINDER_POLL_MS`, `REMINDER_FIRST_RUN_MS`, `CLOCK_TICK_MS`) in the
  existing `// === CONFIG ===` block at the top of `app.js`. Still to do: layout magics such as
  `grid-template-columns: 240px 1fr` (`styles.css:34`).
- **`styles.css` has no section structure** — add banner comments (`/* ---- Kanban ---- */`) or
  split into logical partials; group sidebar / nav / buttons / kanban / modals / tour.

#### P2 — Tooling / safety net

- **[DONE] No automated tests.** A zero-dependency characterization harness now exists under
  `prototype/tests/` (`node prototype/tests/run.cjs`, 37 tests). `load-prototype.cjs` evaluates
  the browser globals in a Node `vm` with a DOM shim and a **frozen clock** (pinned to the seed
  `NOW`, so the time-shift offset is 0 and `NOW`-relative math is deterministic); `run.cjs` holds
  the tests. Verified to catch regressions (a deliberate `fmtDuration` break fails the run).
  Covered: `fmtDuration`, `statusLabel`/`displayStatus`/`isQueued`, `caseSlaMs`, `caseHoldMs`
  (`app.js:195–210`), `derivePromptsForCase` (`app.js:365–388`), `needsHandoverNote`
  (`app.js:561–567`), plus seed structural sanity. This is the safety net the P1 refactors depend
  on. Next: extend coverage to office-hours/owner checks (`app.js:314–331`) and `fmtRelative`.
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

## 4. Feature backlog (requested)

Tracked todo list — each item has a concrete plan below.

- [ ] **4.1** Refresh button per case + a "refresh all stored cases" button.
- [ ] **4.2** Rename the live-load action to **"Load New"** to distinguish loading new cases from
  refreshing existing ones.
- [ ] **4.3** Split the weekly archive out of `data.js` so the file doesn't grow unbounded.
- [ ] **4.4** Garbage-bin icon in the archive view, foolproof double-confirm before deleting, and a
  1-week recycle bin for deleted cases.

**Dependency note:** 4.2 is trivial and pairs with 4.1. 4.1 needs a small backend addition.
4.3 (archive splitting) and 4.4 (recycle-bin persistence) both change the case-storage shape and
`local/persist.py`, so they should be designed together.

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
  Move sealed past weeks into per-week files under `prototype/archive/<weekId>.js`, each setting
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

## Notes

- The earlier `docs/promo-slides-plan.md` references branch
  `claude/dual-status-case-kanban-WApps`; current work tracks the active development branch
  instead.
- Implementation of §2, §3, and §4 is intended for follow-up sessions; this document is the agreed
  scope and reference for that work.
