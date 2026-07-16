"""Read/write API for the Case Tracker board.

Holds NO Case Center credentials — it only reads/writes the database the
ingestion job populates. End users hit this (directly, or same-origin behind an
Ingress) and never configure an API key or cookie.

    uvicorn backend.api:app --host 0.0.0.0 --port 8000

Endpoints (same contract the SPA already expects):
    GET  /healthz              -> {"ok": true}   (unauthenticated liveness probe)
    GET  /api/auth/check       -> 200 if the token is accepted (or API open), else 401
    GET  /api/cases            -> {"cases": [...], "operatorLayer": "server", "asOf": <ISO>}
    GET  /api/cases?scope=picked|rest -> working set / remainder (staged board loading)
    GET  /api/cases?since=<ISO>       -> delta: only cases updated after the cursor
    GET  /api/cases?id=C-1041  -> {"cases": [ that one case ], "operatorLayer": "server"}
    POST /api/ingest?id=C-1041 -> re-ingest ONE case from Case Center (spawns the ingest CLI)
    POST /api/save             -> body {"cases":[...]} and/or {"purgeIds":[...]}
    GET  /api/config/{key}     -> {"key": "shifts"|"owners", "payload": {...}|null}
    POST /api/config/{key}     -> body {"payload": {...}}  (shifts roster/rota or owner directory)
    POST /api/events           -> body {"events":[{at, operatorId, kind, caseId, detail}...]}
                                  usage-analytics batch from the SPA's track() helper
    GET  /api/events/summary?days=30 -> aggregated indices for the hidden #/analytics dashboard

Config (env):
    DATABASE_URL      see backend/db.py (default SQLite)
    API_AUTH_TOKEN    shared-secret bearer token guarding /api/*. Unset/empty =
                      API is OPEN (localhost/demo default); set it to require
                      `Authorization: Bearer <token>` on /api/cases and /api/save.
    ALLOWED_ORIGINS   comma-separated origins for a separate-host front end (CORS).
                      Leave unset for the same-origin deployment.
    SERVE_STATIC      "1" (default) to also serve frontend/ at / for convenience;
                      "0" to run API-only.
    AUTO_CREATE       "1" (default) to create tables on startup; "0" to rely on
                      Alembic migrations in production.
"""
import hmac
import logging
import os
import re
import subprocess
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .analytics import events_summary, insert_events
from .db import REPO_ROOT, SessionLocal, init_db
from .merge import all_cases, case_by_id, get_config, set_config, upsert_operator

logger = logging.getLogger("case_tracker.api")

# Shared-secret bearer token. When unset/empty the API stays OPEN to preserve the
# localhost/demo behavior; a one-time warning is logged at startup so it isn't a silent
# hole in production. When set, /api/cases and /api/save require a matching bearer token.
_API_AUTH_TOKEN = os.environ.get("API_AUTH_TOKEN", "") or ""


def require_auth(request: Request) -> None:
    """Gate an API route on the shared-secret bearer token (constant-time compare).

    No-op when API_AUTH_TOKEN is unset/empty (demo mode). Raises 401 on a missing or
    mismatched `Authorization: Bearer <token>` header when a token is configured."""
    if not _API_AUTH_TOKEN:
        return
    header = request.headers.get("Authorization", "")
    scheme, _, presented = header.partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(presented.strip(), _API_AUTH_TOKEN):
        raise HTTPException(status_code=401, detail="Unauthorized")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not _API_AUTH_TOKEN:
        logger.warning(
            "API_AUTH_TOKEN is unset — /api/cases and /api/save are UNAUTHENTICATED "
            "(anyone reachable can read case PII and purge cases). Set API_AUTH_TOKEN "
            "to require a bearer token in any non-localhost deployment."
        )
    if os.environ.get("AUTO_CREATE", "1") not in ("0", "false", "False", ""):
        # AUTO_CREATE creates tables from the live model on every start, which masks schema
        # drift in production. Kept on by default only so the SQLite demo "just works".
        logger.warning(
            "AUTO_CREATE is on — tables are created from the live model on startup. "
            "For production prefer Alembic migrations and set AUTO_CREATE=0."
        )
        init_db()
    yield


app = FastAPI(title="Case Tracker API", lifespan=lifespan)

# Compress large JSON responses (GET /api/cases is the whole store and dominated by repetitive
# text — history/timelines — which gzips ~10×). First lever of docs/db-loading-plan.md.
app.add_middleware(GZipMiddleware, minimum_size=1024)

# ALLOWED_ORIGINS must be an explicit allowlist (no "*"): it is load-bearing now that the
# API can be auth-gated — a permissive origin would let any site drive an authenticated
# operator's browser into the API. allow_credentials is intentionally NOT enabled (the
# bearer token travels in the Authorization header, not a cookie).
_origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
if _origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_origins,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )


@app.get("/healthz")
def healthz():
    """Unauthenticated liveness probe (for Render/K8s health checks)."""
    return {"ok": True}


@app.get("/api/auth/check")
def auth_check(request: Request):
    """Cheap login probe for the SPA's shared-token gate: 200 if the token is accepted
    (or the API is open), 401 otherwise. Lets the SPA validate a token without fetching
    the whole board."""
    require_auth(request)
    return {"ok": True}


@app.get("/api/cases")
def get_cases(request: Request, id: str | None = None, scope: str | None = None, since: str | None = None):
    require_auth(request)
    # NOTE: time-windowing (hours/fromHours/toHours) is now an ingestion concern — the
    # DB is the accumulated store. The legacy query params are accepted and ignored so old
    # SPA URLs keep working. New loading params (see docs/db-loading-plan.md):
    #   scope=picked|rest  — working set first, archive later (indexed on the lifted column)
    #   since=<ISO>        — delta refresh: only rows updated after the cursor
    # The response's asOf is the max updated_at seen — the client's next `since` cursor.
    with SessionLocal() as session:
        if id:
            cases, as_of = case_by_id(session, id), None
        else:
            cases, as_of = all_cases(session, scope=scope, since=since)
    # operatorLayer="server" tells the SPA that these payloads carry the AUTHORITATIVE
    # operator layer (picks / Track Status / handover / reminder) straight from the DB, so
    # it must NOT overlay its browser-local (localStorage) copy on top. That's what makes the
    # board shared across operators/devices. serve.py's proxy omits this flag, so the SPA keeps
    # its single-user localStorage behavior there.
    return {"cases": cases, "operatorLayer": "server", "asOf": as_of}


@app.post("/api/save")
async def save(request: Request):
    require_auth(request)
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


@app.post("/api/ingest")
def ingest_case_route(request: Request, id: str = ""):
    """Re-ingest ONE case from Case Center — the SPA's per-case ⟳ button in DB-backend mode.

    Runs the ingestion CLI (`python -m backend.ingest --id <id> --no-create`) as a
    subprocess, so api.py itself still holds no Case Center credentials (see module
    docstring): the spawned ingest module loads them exactly like a scheduled run
    (CASE_CENTER_* env vars / local/secrets.local.json). The API host's environment must
    therefore carry those credentials for this endpoint to work — deployments that keep
    credentials off the API host get a 502 here and simply rely on scheduled ingestion.

    Sync `def` on purpose: FastAPI runs it in a worker thread, so the subprocess wait
    doesn't block the event loop."""
    require_auth(request)
    case_id = (id or "").strip()
    if not case_id or len(case_id) > 64 or not re.fullmatch(r"[A-Za-z0-9._:-]+", case_id):
        return JSONResponse({"ok": False, "error": "invalid case id"}, status_code=400)
    cmd = [sys.executable, "-m", "backend.ingest", "--id", case_id, "--no-create"]
    try:
        proc = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        logger.warning("per-case ingest timed out for %s", case_id)
        return JSONResponse({"ok": False, "error": "ingest timed out"}, status_code=504)
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "").strip()[-400:]
        logger.warning("per-case ingest failed for %s: %s", case_id, tail)
        return JSONResponse({"ok": False, "error": "ingest failed", "detail": tail}, status_code=502)
    return {"ok": True, "id": case_id}


# Shared board config (shifts roster/rota and the owner directory). Saved from the Shifts / Owners
# pages and read at boot so every operator/device sees the same config; the SPA falls back to its
# bundled shifts.js / owners.js when a key has never been saved.
_CONFIG_KEYS = {"shifts", "owners"}


@app.get("/api/config/{key}")
def get_config_route(key: str, request: Request):
    require_auth(request)
    if key not in _CONFIG_KEYS:
        raise HTTPException(status_code=404, detail="Unknown config key")
    with SessionLocal() as session:
        payload = get_config(session, key)
    return {"key": key, "payload": payload}


@app.post("/api/config/{key}")
async def set_config_route(key: str, request: Request):
    require_auth(request)
    if key not in _CONFIG_KEYS:
        raise HTTPException(status_code=404, detail="Unknown config key")
    data = await request.json()
    payload = data.get("payload") if isinstance(data, dict) else None
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail='Body must be {"payload": {...}}')
    with SessionLocal() as session:
        result = set_config(session, key, payload)
        session.commit()
    return JSONResponse({"ok": True, "result": result})


# ---- Usage analytics (events table; see backend/analytics.py) --------------------------------

@app.post("/api/events")
async def post_events(request: Request):
    """Batch-insert usage events from the SPA's track() helper. Best-effort: malformed rows
    are skipped, the batch is capped (MAX_BATCH), and the SPA fires-and-forgets."""
    require_auth(request)
    data = await request.json()
    events = data.get("events") if isinstance(data, dict) else None
    if not isinstance(events, list):
        raise HTTPException(status_code=400, detail='Body must be {"events": [...]}')
    with SessionLocal() as session:
        added = insert_events(session, events)
        session.commit()
    return JSONResponse({"ok": True, "added": added})


@app.get("/api/events/summary")
def get_events_summary(request: Request, days: int = 30):
    """Aggregated usage indices for the hidden #/analytics dashboard."""
    require_auth(request)
    with SessionLocal() as session:
        return events_summary(session, days=days)


# Optionally serve the static SPA from the same origin (no CORS, no mixed content).
# Registered AFTER the API routes so /api/* always wins over the catch-all mount.
if os.environ.get("SERVE_STATIC", "1") not in ("0", "false", "False", ""):
    webroot = os.environ.get("CASE_TRACKER_WEBROOT") or os.path.join(REPO_ROOT, "frontend")
    if os.path.isfile(os.path.join(webroot, "index.html")):
        app.mount("/", StaticFiles(directory=webroot, html=True), name="spa")
