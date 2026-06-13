# Case Tracker back end

Decouples the front end from Case Center with a small pipeline:

```
Case Center ──(ingest, holds creds)──▶ Database ◀──(read/write, no creds)── API + SPA
                                       SQLite (demo) / Postgres·MySQL (prod)
```

- **`ingest.py`** is the only component with Case Center credentials. It fetches +
  maps records (reusing `local/casecenter.py`) and upserts **only** Case-Center-owned
  fields, so operator work is never clobbered.
- **`api.py`** (FastAPI) reads cases from the DB and accepts operator edits
  (`POST /api/save`). It holds **no** Case Center credentials, so end users open the
  app and load cases with **no API key / cookie setup**.
- The database is chosen entirely by **`DATABASE_URL`** — SQLite for demos,
  PostgreSQL/MySQL for production.

## Demo (SQLite, no Case Center access)

```bash
pip install -r backend/requirements.txt

# 1. Load the seed cases from prototype/data.js into a local SQLite DB
python -m backend.ingest --seed-from-data-js

# 2. Serve the API + the static SPA from the same origin
uvicorn backend.api:app --host 127.0.0.1 --port 8000

# 3. Open http://127.0.0.1:8000/  → the board loads cases from the DB.
```

Operator edits (moving cases, handover notes, queue, reminders) are saved to the DB
via `POST /api/save`, so every browser shares the same board state.

## Real ingestion

Fill in your request in `local/casecenter.py` (`fetch_raw`) and provide creds via
`CASE_CENTER_API_KEY` / `CASE_CENTER_COOKIE` (env or `local/secrets.local.json`):

```bash
python -m backend.ingest --hours 6          # window; or --id C-1041 for one case
```

## Production (Kubernetes)

Point `DATABASE_URL` at managed Postgres/MySQL and apply `deploy/k8s/`:

```bash
cd backend && alembic upgrade head          # migrations (also run by an initContainer)
# build & push images from deploy/Dockerfile.api and deploy/Dockerfile.ingest
kubectl apply -f deploy/k8s/                 # API Deployment+Service, ingest CronJob, Ingress
```

The Ingress serves `/` (SPA) and `/api/*` (API) from one host — same origin, no CORS,
no mixed content — so `prototype/config.js` keeps `API_BASE = ''`.

For a multi-operator deployment, also set **`window.API_MODE = 'server'`** in
`prototype/config.js`. That makes the SPA treat the DB API as the source of truth: it loads
all cases — *including* the shared operator layer (picks / Track Status / handover / reminder)
— from `/api/cases` on boot, stops overlaying each browser's `localStorage`, and round-trips
every edit to `POST /api/save`. With the default `API_MODE = ''` the operator layer stays
single-user (browser-local), which is correct for `file://` demos and the `serve.py` proxy.

## Auth

`/api/cases` and `/api/save` are gated by a shared-secret bearer token. Set `API_AUTH_TOKEN`
and clients must send `Authorization: Bearer <token>` (else `401`). **If `API_AUTH_TOKEN` is
unset the API is OPEN** — fine for a localhost demo, but it logs a startup warning and must be
set in any reachable deployment (otherwise anyone can read case PII and purge cases). Static
file serving (`/`) stays open. See **[`../docs/SETUP.md`](../docs/SETUP.md)** for details.

## Environment variables

`DATABASE_URL`, `API_AUTH_TOKEN`, `CASE_CENTER_*`, `ALLOWED_ORIGINS`, `SERVE_STATIC`,
`AUTO_CREATE`, and the rest are documented once in
**[`../docs/SETUP.md`](../docs/SETUP.md)** (Environment variables).

## Files

| Path | Role |
|------|------|
| `db.py` | SQLAlchemy engine/session + `Case` model |
| `merge.py` | upsert rules (CC vs operator field ownership) — mirrors `local/persist.py` |
| `ingest.py` | Case Center → DB (+ `--seed-from-data-js` demo mode) |
| `api.py` | FastAPI read/write API (+ optional static SPA) |
| `alembic/` | migrations (`alembic upgrade head`) |
| `seed_extract.cjs` | Node helper that reads `prototype/data.js` for the demo seed |
