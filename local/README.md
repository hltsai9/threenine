# Running the board locally with LIVE Case Center data

The public site at `https://hltsai9.github.io/threenine/` is a **static demo** that
runs on seed data — it can't reach your on-prem Case Center (and must never hold your
credentials). To see **live** cases, run the board locally on your work laptop with a
tiny Python server that fetches from Case Center on every page refresh.

## How it works

```
browser  ──GET /──────────▶  serve.py  ──serves──▶  ../prototype (the SPA)
browser  ──GET /api/cases─▶  serve.py  ──calls──▶  casecenter.fetch_cases()
                                                    └─▶ your on-prem Case Center
```

- The page and the data come from the **same origin** (`http://127.0.0.1:8787`), so there
  are no CORS issues and no config in the browser.
- Your **API key + cookie stay inside the Python process.** They're read from env vars or
  `secrets.local.json` (gitignored) — never sent to the browser, never committed.
- On each refresh the SPA calls `/api/cases`. Your local **agent layer** (which cases are in
  your queue, handover notes, reminders) is kept in the browser's `localStorage` and
  **merged back** onto the fresh data, so pulling new data never wipes your work.
- The **Case Center status** drives the kanban columns; your **agent status** drives the
  top/bottom (My queue / Backlog) split.

## One-time setup

1. Put your credentials where the server can read them (pick ONE):
   ```bash
   cp local/secrets.local.json.example local/secrets.local.json
   # then edit local/secrets.local.json and paste your real apiKey + cookie
   ```
   or use environment variables:
   ```bash
   export CASE_CENTER_API_KEY='...'
   export CASE_CENTER_COOKIE='...'
   ```

2. Wire up your fetch in **`local/casecenter.py`**:
   - Paste your existing request into `fetch_raw()` (return the list of records).
   - Fill in `STATUS_MAP` to map Case Center statuses → board statuses
     (`new | with_fit | with_hq | sanity_check | returned_to_requester | resolved | closed | cancelled`).
   - Adjust the field names in `map_record()` to match Case Center's JSON.

## Run

```bash
python3 local/serve.py        # stdlib only, nothing to install
```

**Open the BOARD at the root:** `http://127.0.0.1:8787/`

`http://127.0.0.1:8787/api/cases` is just the raw JSON the board fetches — visiting it
directly shows JSON by design; it is **not** the app. Open `/` to see the board (a toast
confirms "Live: loaded N cases from Case Center").

### Troubleshooting
- **`/` shows 404 "File not found" but `/api/cases` works** → serve.py can't find the board
  files (`prototype/index.html`). Check the startup line `Serving board files from: …`.
  Run serve.py from inside the cloned repo, or point it at the prototype folder:
  ```bash
  CASE_TRACKER_WEBROOT=/path/to/prototype python3 local/serve.py
  #   or:  python3 local/serve.py /path/to/prototype
  ```
- **Board opens but shows demo data** → `/api/cases` returned an `{"error":…}` (e.g.
  `fetch_raw()` not implemented yet, or auth failed), so the board fell back to seed data.
- **Board opens but looks empty** → the board hides `Close`/`Drop` (closed/cancelled) cases;
  pull some `Open` / `In-Progress` cases.


You should see a toast: **"Live: loaded N cases from Case Center."** Refresh the page to
re-pull. If the server isn't running (or you open the public site), the board falls back to
the seed demo data automatically.

## Notes & gotchas

- **The cookie expires.** When Case Center logs you out, `/api/cases` will start failing
  (you'll see a 500 in the browser console / server log). Re-grab a fresh cookie and update
  `secrets.local.json` or the env var. (If Case Center has a non-expiring API token, prefer
  that over the cookie.)
- **Owners/operators/weeks/shifts** still come from `prototype/data.js` (your local org
  config). Only the **cases** come from Case Center. If you want live cases routed to real
  FIT/HQ owners, set `fitId`/`hqId` in `map_record()` to ids that exist in `data.js`.
- **Reset:** the sidebar "Reset to seed" link clears your local agent layer and re-pulls
  from Case Center (in live mode it just reloads the page).
- `python3 local/serve.py` binds to `127.0.0.1` only, so it's not exposed on your network.
