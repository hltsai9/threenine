# Release notes

Case Tracker prototype — changes by date. Newest first. Branch:
`claude/busy-heisenberg-26Sh8`.

Categories: **Added** (new features), **Fixed** (bug fixes), **Changed** (behavior/UX
changes), **Internal** (tests, refactors, CI), **Docs**.

---

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
