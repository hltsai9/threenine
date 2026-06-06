# Backend rules (`backend/`)

Scoped rules for the ingest → DB → API pipeline. See [`README.md`](README.md) for the full
guide and [`../docs/SETUP.md`](../docs/SETUP.md) for env vars. The repo-wide rules in
[`../CLAUDE.md`](../CLAUDE.md) still apply.

## Invariants — do not break

- **Credentials live only on the ingestion side.** `ingest.py` (via `local/casecenter.py`) is
  the *only* component that holds the Case Center API key + cookie. **Never** add Case Center
  credentials, fetches, or `_load_secrets()` calls to `api.py` or anything on the read path —
  that path must stay credential-free so end users need no key/cookie.
- **Respect field ownership in `merge.py`.** `upsert_cc` (ingestion) may refresh **only**
  `CC_OWNED_FIELDS`; `upsert_operator` (the API's `POST /api/save`) owns the operator/agent
  layer. Keep `CC_OWNED_FIELDS` in sync with `local/persist.py` and `prototype/app.js`.
- **`DATABASE_URL` is the only DB switch.** Don't hardcode a database; SQLite (demo) and
  Postgres/MySQL (prod) must both work via the URL alone (see `db.py`).
- **Schema changes need a migration.** Add an Alembic revision under `alembic/versions/`;
  don't rely on `AUTO_CREATE` for production.

## Run / migrate

```bash
python -m backend.ingest --seed-from-data-js   # demo seed, no Case Center access
uvicorn backend.api:app --port 8000            # API + same-origin SPA
cd backend && alembic upgrade head             # migrations (prod)
```
