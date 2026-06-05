# Running the board locally with LIVE Case Center data

The public site at `https://hltsai9.github.io/threenine/` is a **static demo** on seed data —
it can't reach your on-prem Case Center (and must never hold credentials). To see **live**
cases, run the board locally with a tiny stdlib Python server that talks to Case Center.

## How it works

```
browser ──GET /────────────▶ serve.py ──serves──▶ ../prototype (the SPA)
browser ──GET /api/cases ──▶ serve.py ──calls──▶ casecenter.fetch_cases() ─▶ Case Center
browser ──POST /api/save ──▶ serve.py ──writes──▶ prototype/data.js   (operator edits)
browser ──POST /api/save-file▶ serve.py ─writes─▶ shifts.js / owners.js (editor Save)
```

- Page + data are the **same origin** (`http://127.0.0.1:8787`) → no CORS, no browser config.
- Your **API key + cookie stay in the Python process** (env vars or `secrets.local.json`,
  gitignored) — never sent to the browser, never committed.
- The **Case Center status** drives the kanban columns; your local **agent status** (queue
  placement, handover notes, reminders) is kept in `localStorage` and merged back on every
  pull so refreshing never wipes your work.

## One-time setup

1. Credentials (pick ONE):
   ```bash
   cp local/secrets.local.json.example local/secrets.local.json   # edit: apiKey + cookie
   # or:  export CASE_CENTER_API_KEY=...   CASE_CENTER_COOKIE=...   (Windows: set / $env:)
   ```
2. Wire up your fetch in **`local/casecenter.py`**:
   - `fetch_raw()` — your request to Case Center; `return x_json["data"]` (a list works; the
     whole response object is auto-unwrapped too). In your JQL use:
     - `CASE_ID`        → when set, fetch just that one case (used by **+ New case**), e.g. `f'caseId = "{CASE_ID}"'`
     - else `LOOKBACK_HOURS` → the look-back window, e.g. `f"created >= -{int(LOOKBACK_HOURS)}h"`
   - `STATUS_MAP` / `STATUS_MAP_BY_STATUS` — Case Center status → board column.
   - `LEVEL_MAP` — caseLevel → priority. `map_record()` — field names → board case.
   - `BASE_URL` (top of file, or `CASE_CENTER_BASE_URL` env) — builds each case's link.

## Run

```bash
python3 local/serve.py            # stdlib only; binds 127.0.0.1 (not exposed on the network)
```
**Open the BOARD at the root:** `http://127.0.0.1:8787/` — a toast confirms
"Live: loaded N cases from Case Center." (`/api/cases` shows raw JSON by design; it's the
feed, not the app.) On Windows use `python` instead of `python3`.

## Using the board against live data

- **Look-back window** — the "Created within [N] h / Load" control (top of the board)
  re-queries Case Center; sets `?hours=N` → `LOOKBACK_HOURS`. Remembered in localStorage.
- **+ New case** — asks only for a **Case ID**, then fetches that one case
  (`GET /api/cases?id=…` → `CASE_ID`) and adds it to the board (handy for cases outside the
  window).
- **Edits auto-save** — in live mode, any change to a case (queue, status, assignment,
  reminder, handover note, …) is POSTed to `/api/save` and written into `data.js`. A small
  bottom-right indicator shows **Saving… / ✓ Saved / ⚠ Save failed**.
- **Shifts & Owners editors** — the Shifts page and Owners page have a **Save to shifts.js /
  Save to owners.js** button (when served by serve.py) that writes those files via
  `/api/save-file`. (The Copy button still gives you the snippet to paste manually.)

## What gets written, and backups

| File | Written by | Backups |
| --- | --- | --- |
| `prototype/data.js` (the `window.CASES` block) | `/api/cases` pulls + `/api/save` edits | `data.js.orig` (pristine, once) + `data.js.<ts>.bak` (timestamped, each write) |
| `prototype/shifts.js` | Shift editor "Save" | `shifts.js.orig` + `shifts.js.<ts>.bak` |
| `prototype/owners.js` | Owners editor "Save" | `owners.js.orig` + `owners.js.<ts>.bak` |

- Only the `window.CASES` block of `data.js` is rewritten; `NOW`/`THRESHOLDS`/`CURRENT_SHIFT`/
  `WEEKS` are preserved. It's marked `window.CASES_LIVE_CAPTURE = true` so captured cases show
  with their real timestamps (no demo time-shift) and render even offline.
- Disable the `data.js` auto-write with `CASE_TRACKER_WRITE_DATA_JS=0`.
- All backups and the merge store (`local/cases.store.json`) are **gitignored**.

## ⚠️ Privacy — do NOT commit live data

Once the server writes real Case Center cases into `data.js`, that tracked file (which also
deploys to **public** GitHub Pages) holds real data. **Don't commit or push it.** Strongest
safeguard on your machine:
```bash
git update-index --skip-worktree prototype/data.js
```
Restore the original anytime from `prototype/data.js.orig`, or
`git checkout origin/<branch> -- prototype/data.js`.

## Troubleshooting

- **`/` shows 404 but `/api/cases` works** → serve.py can't find the board files. Check the
  `Serving board files from: …` startup line; run from inside the repo or point it at the
  folder: `CASE_TRACKER_WEBROOT=/path/to/prototype python3 local/serve.py`.
- **`typeof tryLoadLiveCases` is `undefined` / board empty but `/api/cases` returns JSON** →
  the browser is running a stale/old `app.js`. Hard-refresh (Ctrl+F5) or use an incognito
  window; serve.py sends no-cache headers to prevent this.
- **Board shows demo data** → `/api/cases` returned `{"error":…}` (e.g. `fetch_raw()` not
  implemented, or auth failed) → fell back to seed.
- **Board looks empty** → the board hides `Close`/`Drop` (closed/cancelled). The blue banner
  says how many were loaded vs hidden.
- **Cookie expired** → `/api/cases` 500s; re-grab the cookie. Prefer a long-lived API token.
- **Slow Case Center** → bump the fetch timeout: `?liveTimeout=60` (seconds) in the URL, or
  edit `LIVE_FETCH_TIMEOUT_MS` at the top of `app.js`.
- **`WinError 10053` in the terminal** → harmless; the browser closed the connection (reload
  / navigate / timeout). serve.py ignores it.

## Notes

- **Operators/shifts** live in `shifts.js`, **owners** in `owners.js`, the rest (weeks,
  thresholds, clock) in `data.js`. Edit via the in-app editors or those files.
- **Reset to seed** (sidebar) clears local edits and re-pulls; in live mode it reloads.
