"""Read/write API for the Case Tracker board.

Holds NO Case Center credentials — it only reads/writes the database the
ingestion job populates. End users hit this (directly, or same-origin behind an
Ingress) and never configure an API key or cookie.

    uvicorn backend.api:app --host 0.0.0.0 --port 8000

Endpoints (same contract the SPA already expects):
    GET  /api/cases            -> {"cases": [ ...board-shaped case objects... ]}
    GET  /api/cases?id=C-1041  -> {"cases": [ that one case ]}
    POST /api/save             -> body {"cases":[...]} and/or {"purgeIds":[...]}

Config (env):
    DATABASE_URL      see backend/db.py (default SQLite)
    ALLOWED_ORIGINS   comma-separated origins for a separate-host front end (CORS).
                      Leave unset for the same-origin deployment.
    SERVE_STATIC      "1" (default) to also serve prototype/ at / for convenience;
                      "0" to run API-only.
    AUTO_CREATE       "1" (default) to create tables on startup; "0" to rely on
                      Alembic migrations in production.
"""
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .db import REPO_ROOT, SessionLocal, init_db
from .merge import all_cases, case_by_id, upsert_operator


@asynccontextmanager
async def lifespan(app: FastAPI):
    if os.environ.get("AUTO_CREATE", "1") not in ("0", "false", "False", ""):
        init_db()
    yield


app = FastAPI(title="Case Tracker API", lifespan=lifespan)

_origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
if _origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_origins,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )


@app.get("/api/cases")
def get_cases(id: str | None = None):
    # NOTE: time-windowing (hours/fromHours/toHours) is now an ingestion concern — the
    # DB is the accumulated store, so a read returns everything (or one case by id).
    # The legacy query params are accepted and ignored so old SPA URLs keep working.
    with SessionLocal() as session:
        cases = case_by_id(session, id) if id else all_cases(session)
    return {"cases": cases}


@app.post("/api/save")
async def save(request: Request):
    data = await request.json()
    if isinstance(data, dict):
        cases = data.get("cases", [])
        purge_ids = data.get("purgeIds") or []
    elif isinstance(data, list):
        cases, purge_ids = data, []
    else:
        cases, purge_ids = [], []
    if isinstance(cases, dict):
        cases = [cases]
    cases = [c for c in cases if isinstance(c, dict) and c.get("id")]
    purge_ids = [i for i in purge_ids if i]
    with SessionLocal() as session:
        added, updated, purged = upsert_operator(session, cases, purge_ids)
        session.commit()
    return JSONResponse({"ok": True, "added": added, "updated": updated, "purged": purged})


# Optionally serve the static SPA from the same origin (no CORS, no mixed content).
# Registered AFTER the API routes so /api/* always wins over the catch-all mount.
if os.environ.get("SERVE_STATIC", "1") not in ("0", "false", "False", ""):
    webroot = os.environ.get("CASE_TRACKER_WEBROOT") or os.path.join(REPO_ROOT, "prototype")
    if os.path.isfile(os.path.join(webroot, "index.html")):
        app.mount("/", StaticFiles(directory=webroot, html=True), name="spa")
