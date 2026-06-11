# Release notes

Case Tracker prototype — changes by date. Newest first. Branch:
`claude/busy-heisenberg-26Sh8`.

Categories: **Added** (new features), **Fixed** (bug fixes), **Changed** (behavior/UX
changes), **Internal** (tests, refactors, CI), **Docs**.

---

## 2026-06-11

### Changed

- **Adapted `local/casecenter.py` `map_record()` to Case Center's new JSON shape.** The
  substatus moved into a `subStatus` object — `caseSubstatus` is gone; we now read
  `subStatus.transition` via a new `sub_transition(r)` helper that tolerates the object
  being missing, null, or the wrong type. The end-user fields moved to the top level: the
  board case's `requester` field is renamed **`user`** (now combines `userAccount` +
  `userName`), and `requesterDept` becomes **`userDept`** (from top-level `userDept` —
  the old `customField` block is gone). `reporterId` → **`reporter`** and `assigneeId` →
  **`assignee`** (both plain account ids at the top level now); their departments are
  derived from `processTimeline` by matching `processor` to the id and picking the
  latest item's `processorDeptName` (no direct `deptName` on the new payload). `Wait User`
  attaches `waitUser` only when its block is present and well-formed. The same field
  renames flowed through `local/persist.py` and `backend/merge.py` `CC_OWNED_FIELDS`,
  `prototype/app.js` (detail rows, table column header → "User", queue/board reads,
  `CC_OWNED_FIELDS` mirror), `prototype/data.js` seed cases (`requester:` → `user:`),
  and the test fixture in `prototype/tests/run.cjs`. 77/77 tests pass.

- **Switched the prototype skin from the Pastel CommuGround theme to the Forest variant.**
  Updated `prototype/styles.css` tokens to the Forest palette (page bg `#e8ece8`, deep-forest
  accent `#2e5942`/`#4e8063`/`#e3efe7`, light→dark green lifecycle column ramp, desaturated
  brick/amber/tan semantic pills) and swapped Plus Jakarta Sans + JetBrains Mono for
  Source Serif 4 + Libre Franklin + IBM Plex Mono via Google Fonts. Titles, page header,
  stat figures, column names, and modal/shift names are now set in Source Serif 4 700 per
  the formal-mode spec. Radii tightened ~3px across cards/pills/chips; brand and primary
  buttons use the green gradient `#2f6b46→#4e8063` with a green-tinted shadow. Prompt icon
  swatches re-mapped to Forest greens/brick. No markup, class hooks, behavior, or sidebar
  items were changed — only the theme.
- **CommuGround visual theme applied to the prototype (earlier today).** Reskinned
  `prototype/styles.css` and loaded Plus Jakarta Sans + JetBrains Mono via Google Fonts in
  `prototype/index.html` to match the Pastel `design_handoff_commuground` reference. Now
  superseded by the Forest skin above.

---

## 2026-06-08

### Added

- **"Waiting on user" panel on the case detail (from Case Center).** When a case is parked on the
  end user (Case Center substatus `Wait User`), the detail now shows the `subStatus` block — the
  wait **reason**, the **due action** and **due date** (with a *due in …* / *overdue by …* chip),
  the **last processor** (assignee · handler group · handler type), and the **transition** that
  parked it. `local/casecenter.py` gains `map_wait_user()` (reads `r.subStatus` →
  `reason / dueAction / dueDateTime / transition / transitionDateTime / lastProcessor.{assignee,
  handlerGrp, handlerType}`); `map_record` attaches it as `waitUser` only when
  `caseSubstatus == "Wait User"`. Treated as a Case Center–owned field (kept current on refresh)
  and seeded (overdue) on C-1046. The section is hidden for cases that aren't waiting on the user.
- **Process timeline on the case detail (from Case Center).** A new timeline shows Case Center's
  own per-stage processing log — each stage sized by its `processMinutes`, colored by the board
  status its Case Center status maps to, with a per-status legend, a total, and per-stage tooltips
  (processor, dept, status, start time). `local/casecenter.py` gains `map_process_timeline()` (it
  normalizes `r.processTimeline` items — `processorDeptName/processStartTime/caseStatus/
  processMinutes/caseSubstatus/processEndTime/processType/processor` — into the board shape and is
  exposed through `map_record`); `processTimeline` is treated as a Case Center–owned field, so a
  live refresh keeps it current. Seeded on two demo cases (C-1044, C-1045). The detail section is
  hidden for cases that have no process timeline.

### Fixed

- **Case Center link no longer disappears in live mode.** Since a page refresh no longer
  re-fetches, a case stored before `CASE_CENTER_BASE_URL` was configured kept its empty
  `caseLink` and rendered a blank link. The board now falls back to building the link from the
  case id + the base URL (`caseHref()`), and `serve.py`/`persist.py` expose that base as
  `window.CASE_CENTER_BASE_URL` in `data.js`. (One-time repair for already-stored cases: press
  **Refresh Existing**, which re-pulls with the base set and rewrites the links.)
- **Operator work now survives a page refresh in live mode.** Reloading the board no longer
  re-pulls Case Center and rebuilds the board (which could drop or reset a case you'd just
  assigned/moved). Live mode now adopts the persisted `data.js` store on load, so a refresh shows
  exactly what's saved. (See the matching *Changed* entry — Case Center is queried only via "Load
  New" / "Refresh Existing".)
- **Timeline timezones now line up.** Case Center timestamps that arrive without a timezone
  (process-timeline and Wait User times) were parsed in the viewer's local zone, so the Process
  timeline disagreed with the Ownership timeline (anchored on `createDateTime`, which carries
  `+00:00`). `local/casecenter.py` now normalizes every datetime it emits to explicit UTC
  (`iso_utc()` — Case Center stores GMT), so all timelines share one frame.

### Changed

- **A page refresh no longer pulls from Case Center — load on demand only.** In live mode the
  board now queries Case Center only when you press **Load New** or **Refresh Existing**; opening
  or reloading the page shows the cases already saved in `data.js`. (`boot()` enters live mode
  from the persisted store instead of auto-fetching.)
- **Rolled the demo calendar forward one week.** Seed data now centers on **W24 · June 8 – 14,
  2026** (`window.NOW` = `2026-06-12T13:00:00Z`): every case timestamp shifted +7 days, every
  `weekId` bumped +1, and the rolling 4-week window advanced (W24 current; W23/W22/W21 prior;
  the oldest week drops off). Coverage (statuses, flags, idle/SLA thresholds, stale handover,
  carry-over) is preserved.

### Internal

- **Fixed stale week labels in `data.js`.** The historical section comments (`W16/W17/W18`) and
  the carry-over note/history detail (`W18 → W19`) were several shifts out of date; they now
  match the actual `weekId`s (`W21/W22/W23`, carry-over `W23 → W24`).
- **Storage key bumped `v4 → v5 → v6`** for the new top-level `processTimeline` and `waitUser`
  fields on cases, so returning users don't load a stale localStorage shape. Added 4
  `processSegments` and 3 `waitUserDueMs` characterization tests — suite now at 74.
- **Pages deploy now triggers on `claude/charming-cray-ti71j0`** (added to the push branch list in
  `.github/workflows/pages.yml`).

## 2026-06-06

### Internal

- **Project rules for every Claude Code session.** Added a root `CLAUDE.md` (auto-loaded rulebook)
  and a scoped `backend/CLAUDE.md` (credentials live only on the ingestion side; `merge.py` field
  ownership; `DATABASE_URL` is the only DB switch). Extended the **Stop** release-note hook to cover
  `backend/` and `deploy/`, added a **Stop** `tests-before-finish` hook and a **PostToolUse**
  `rebundle-standalone` hook, and a `/ship` skill for the end-of-change ritual.

### Docs

- **Single source of truth for setup.** New `docs/SETUP.md` consolidates run instructions, Case
  Center credentials, and the full environment-variable table; the root/`local`/`backend` READMEs
  now link to it instead of duplicating. Consolidated all TODOs into `docs/improvement-plan.md`
  (new §5, absorbing the former `local/TODO-casecenter-mapping.md`).

## 2026-06-05

### Added

- **Reminder "at a specific time."** The *Remind me* modal now offers a time picker in addition to
  the relative presets — set a reminder to fire at a clock time (e.g. **05:30**), today or tomorrow
  if it's already past. A specific time wins over the preset when set.
- **Recycle bin for cases (4.4).** A 🗑 button on each Weekly-Archive row soft-deletes a case;
  a new **Recycle bin** page (`#/archive/bin`) lists deleted cases with time-remaining and offers
  **Restore** or a second-confirm **Delete forever**. Foolproof two-step delete (bin → permanent),
  binned cases hidden from the board/archive/stats/reminders, and auto-purge after 7 days.
  Persists in both demo (localStorage) and live mode.
- **Created-between load window (4.10).** "Load New" now takes two bounds — *Created between
  `[older]` and `[newer]` h ago* — so you can pull a band (e.g. created between 72h and 60h ago),
  not just "within N hours." Falls back to the single-bound form when the newer bound is 0.
- **Per-case and refresh-all live refresh (4.1).** A `⟳` button on each card and in the
  reading-panel/detail re-fetches one case from Case Center; a **Refresh Existing** toolbar button
  re-pulls every case on the board. Shown everywhere; degrades gracefully without a backend.
- **First-line handling clock + "Clock model" page (4.5, 4.6).** The case detail gains a fourth
  clock (time the first-line agent held the case directly); a new **Clock model** page
  (`#/clocks`) explains how each clock is calculated, with a live worked example.
- **First line can return a New case to the requester (4.9).** "Return to requester" is now
  available from the New status; Status Flow diagram and table updated to match.
- **Zero-dependency test harness.** `node prototype/tests/run.cjs` — 66 characterization tests
  covering the pure functions, action-handler outcomes, the live-merge/refresh logic, the recycle
  bin, and the load-window URL/validation. No npm, no framework.

### Fixed

- **Refresh no longer wipes your work on a case (client + server).** Re-fetching a case used to
  reset its status, FIT/HQ assignment, history, notes and clocks. Now a live refresh updates only
  Case Center–owned display fields and preserves everything operator-local — in the browser
  (`overlayLiveCase`) and on disk (`persist.py` overlay; operator saves stay authoritative).
- **Hard refresh no longer resets an assigned case to New.** `persist.py` had been overwriting the
  board status in `data.js` with the raw Case Center status on every fetch; it now preserves
  operator work across reloads.
- **First-line / triage time now correct for live cases.** Live cases arrive with no `created`
  event; the ownership timeline now anchors first-line at the create time, so assigning to FIT
  yields first-line time = *assign time − create time*.
- **Hardened the live-data load.** Malformed Case Center records (missing id / not an object) are
  dropped with a warning instead of becoming ghost cards or corrupting the merge.
- **serve.py sends the `/api/cases` response before writing `data.js`,** so a slow disk write can't
  delay or interrupt delivery (shrinks the harmless "client closed the connection" notice).

### Changed

- **Sanity Check counts as requester time (4.8).** It's no longer part of first-line handling; the
  First-line clock is triage-only and the timeline/Clock-model treat Sanity Check as "with
  requester." (SLA keeps running through Sanity Check.)
- **Refresh buttons are always visible** (board, Pages demo, and `file://`), degrading gracefully
  with a "no backend" toast when there's nothing to reach.
- **"Load" renamed to "Load New"** to distinguish loading newly-created cases from refreshing
  existing ones (4.2).
- **Live-fetch timeout default raised to 5 minutes** (`LIVE_FETCH_TIMEOUT_MS`); still overridable
  via `?liveTimeout=SECONDS`.

### Internal

- **P0/P1 code-review fixes:** validated live payloads, consolidated timer constants into `CONFIG`,
  null-safe modal reads via `fieldVal`, and a `logHistory` helper replacing repeated history-push
  boilerplate — all under the new test net.
- **CI:** this branch now deploys to GitHub Pages.

### Docs

- **Improvement plan & backlog** (`docs/improvement-plan.md`): code-review roadmap plus a tracked
  feature backlog (4.1–4.10) with per-item plans and progress.
- **README local-setup checklist:** what to edit after pulling locally — `fetch_raw()`,
  `secrets.local.json`, and the virus-scanned `index.html` / `standalone.html`.

---

## 2026-06-04

### Added

- **Configurable live-fetch timeout** — URL parameter plus an editable default.

### Fixed

- **serve.py ignores client-aborted connections** (no traceback spam) and sends strong no-cache
  headers so the board files are never served stale / 304'd.
- **`fetch_cases` tolerates a full-response shape** (unwraps common envelope keys) and logs the
  mapped case count.

### Changed

- **Live-mode board banner** so the board is never silently empty when running on Case Center data.

---

## How to regenerate `standalone.html`

The modular sources under `prototype/` are the source of truth. After any edit:

```bash
node prototype/bundle.mjs
```

The Pages workflow runs this automatically on deploy.
