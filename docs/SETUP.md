# Setup — running, credentials, environment

Single source of truth for **how to run the app, configure Case Center credentials,
and every environment variable.** Other docs link here instead of repeating this — see
[`CLAUDE.md`](../CLAUDE.md) for the "don't duplicate docs" rule.

- Prototype overview & feature tour → [`README.md`](../README.md)
- Single-user live proxy (`serve.py`) → [`local/README.md`](../local/README.md)
- Decoupled DB backend (ingest → DB → API) → [`backend/README.md`](../backend/README.md)
- **Self-host the full stack on an Ubuntu server (step by step)** → [`SELF-HOST-UBUNTU.md`](SELF-HOST-UBUNTU.md)

---

## Run the prototype

**Online (deployed):** GitHub Pages publishes `frontend/` via `.github/workflows/pages.yml`.
After enabling **Settings → Pages → Source = GitHub Actions**, it's served at the Pages URL in
the deploy job (typically `https://<user>.github.io/threenine/`).

**Locally — easiest (just open a file):** open `frontend/standalone.html` via `file://`.
It's a self-contained build with CSS/JS inlined — no server needed. Best for sharing as one file.

**Locally — modular sources (for editing):** serve `frontend/` over HTTP and open `index.html`:

```bash
cd prototype && python3 -m http.server 8000   # then open http://localhost:8000
```

**Re-bundling after edits:** the modular files are the source of truth. After editing any of
them, regenerate `standalone.html`:

```bash
node frontend/bundle.mjs
```

The Pages workflow runs this automatically on deploy, and the `rebundle-standalone.sh`
PostToolUse hook regenerates it whenever Claude edits a bundled source.

## Local setup checklist — after you pull

Some files are gitignored, stubs, or get clobbered by a local virus scanner. Check these or
live mode won't work:

| File | What to do |
| ---- | ---------- |
| `local/casecenter.py` → `fetch_raw()` | Paste your real Case Center request (the committed version is a **stub**); return the list of raw records (`x_json["data"]`). Do **not** hardcode credentials. |
| `local/secrets.local.json` | **Gitignored — absent after a clone.** Create it (below) or use env vars. |
| `frontend/index.html` | A local virus scan may delete parts. Re-check after pulling: `git restore frontend/index.html`. |
| `frontend/standalone.html` | Same issue — regenerate: `node frontend/bundle.mjs` (or `git restore frontend/standalone.html`). |

## Case Center credentials

Credentials are read by the **ingestion** path only (`local/casecenter.py` `_load_secrets()`),
never by the browser or the read API. Provide them either way:

```bash
cp local/secrets.local.json.example local/secrets.local.json   # then edit: apiKey + cookie
# or:  export CASE_CENTER_API_KEY=...   CASE_CENTER_COOKIE=...   (Windows: set / $env:)
```

Then wire your request in **`local/casecenter.py`**:

- `fetch_raw()` — your request to Case Center; `return x_json["data"]` (a list works; a whole
  response object is auto-unwrapped). In your JQL use:
  - `CASE_ID` → when set, fetch just that one case (used by **+ New case**), e.g. `f'caseId = "{CASE_ID}"'`
  - else `LOOKBACK_HOURS` → the look-back window, e.g. `f"created >= -{int(LOOKBACK_HOURS)}h"`
- `STATUS_MAP` / `STATUS_MAP_BY_STATUS` — Case Center status → board column.
- `LEVEL_MAP` — `caseLevel` → priority. `map_record()` — field names → board case.
- `BASE_URL` (top of file, or `CASE_CENTER_BASE_URL` env) — builds each case's link.

> ⚠️ **Privacy:** once real cases are written into `frontend/data.js` (which also deploys to
> **public** Pages), do **not** commit/push it. See [`local/README.md`](../local/README.md) for
> the full safeguard (`skip-worktree`) and restore steps.

## Environment variables

| Var | Used by | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | backend (api/ingest) | SQLite file in repo root | DB connection — the demo↔prod switch (`sqlite://…`, `postgresql+psycopg://…`, `mysql+pymysql://…`) |
| `API_AUTH_TOKEN` | `backend/api.py` | _(empty)_ | Shared-secret bearer token for `/api/cases` + `/api/save`. **Empty = API is OPEN** (localhost/demo); set it in any reachable deployment to require `Authorization: Bearer <token>` (else 401). |
| `CASE_CENTER_API_KEY` / `CASE_CENTER_COOKIE` | ingest / `serve.py` | — | Case Center credentials (ingestion side only). The board's per-case ⟳ / import-by-ID buttons call `POST /api/ingest?id=…`, which spawns the ingest CLI **on the API host** — so in the decoupled deployment these must also be present in the API process environment, or that endpoint answers 502 and cases update only via scheduled ingestion. |
| `CASE_CENTER_BASE_URL` | `casecenter.py` | _(empty)_ | Builds each case's clickable link |
| `CASE_CENTER_LOOKBACK_HOURS` | `casecenter.py` | `6` | Default look-back window for the fetch |
| `ALLOWED_ORIGINS` | `backend/api.py` | _(empty)_ | CORS origins — explicit allowlist (no `*`); load-bearing now that the API can be auth-gated. Only for a separate-host SPA. |
| `SERVE_STATIC` | `backend/api.py` | `1` | Also serve `frontend/` at `/` (same origin) |
| `AUTO_CREATE` | backend | `1` | Create tables on start (set `0` + use Alembic for production) |
| `PORT` | `local/serve.py` | `8787` | Port for the single-user live proxy |
| `CASE_TRACKER_WEBROOT` | `local/serve.py` | `../prototype` | Where the board files live |
| `CASE_TRACKER_WRITE_DATA_JS` | `local/serve.py` | `1` | Run the persist step after a fetch (`0` disables it entirely) |
| `CASE_TRACKER_ALLOW_DATA_JS_OVERWRITE` | `local/persist.py` | _(unset = safe)_ | Gate on actually rewriting the **committed/public** `frontend/data.js` with a live capture. Unset = the demo seed is left untouched (only the gitignored store updates); set `=1` to capture real cases into `data.js` — then **do NOT commit/push it**. |
