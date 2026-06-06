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

## Environment variables

| Var | Used by | Default | Purpose |
|-----|---------|---------|---------|
| `DATABASE_URL` | all | SQLite file in repo root | DB connection (the demo↔prod swap) |
| `CASE_CENTER_API_KEY` / `CASE_CENTER_COOKIE` | ingest | — | Case Center creds (ingest only) |
| `ALLOWED_ORIGINS` | api | _(empty)_ | CORS origins, only for a separate-host SPA |
| `SERVE_STATIC` | api | `1` | also serve `prototype/` at `/` |
| `AUTO_CREATE` | api/ingest | `1` | create tables on start (set `0` to use Alembic) |

## Files

| Path | Role |
|------|------|
| `db.py` | SQLAlchemy engine/session + `Case` model |
| `merge.py` | upsert rules (CC vs operator field ownership) — mirrors `local/persist.py` |
| `ingest.py` | Case Center → DB (+ `--seed-from-data-js` demo mode) |
| `api.py` | FastAPI read/write API (+ optional static SPA) |
| `alembic/` | migrations (`alembic upgrade head`) |
| `seed_extract.cjs` | Node helper that reads `prototype/data.js` for the demo seed |
