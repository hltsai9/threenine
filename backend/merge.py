"""Upsert rules for the cases table.

Two write paths, exactly mirroring the file-based store in local/persist.py:

  upsert_cc        — ingestion path. For a case that already exists, refresh ONLY
                     the Case-Center-owned fields; never clobber operator work
                     (board status, routing, history, notes, clocks, agent layer).
                     A brand-new case is taken in full.
  upsert_operator  — operator path (the API's POST /api/save). Operator edits are
                     authoritative and merge over the stored payload. Also handles
                     purge ids (recycle-bin "delete forever").
"""
from datetime import datetime, timezone

from sqlalchemy import select

from .db import Case, Config

# Fields Case Center authoritatively owns. Must stay in sync with CC_OWNED_FIELDS in
# local/persist.py and frontend/app.js. On a live refresh only these are overlaid onto
# an existing case, so an ingestion run never resets operator routing/status.
CC_OWNED_FIELDS = (
    "subject", "ccStatusLabel", "priority", "caseLink", "status",
    "user", "userDept", "reporter", "reporterDept", "assignee", "assigneeDept",
    "processTimeline",   # Case Center's per-stage processing log (drives the Process timeline)
    "waitUser",          # "Wait User" substatus detail (reason / due / last processor)
)


# SQLite serializes writes (a single writer at a time) and does not support row-level
# SELECT ... FOR UPDATE, so we only request locking on dialects that implement it. This
# keeps the demo on SQLite working while making concurrent ingest+save safe on
# Postgres/MySQL (no lost updates from the read-modify-write below).
_FOR_UPDATE_DIALECTS = {"postgresql", "mysql", "mariadb", "oracle", "mssql"}


def _supports_for_update(session):
    try:
        return session.get_bind().dialect.name in _FOR_UPDATE_DIALECTS
    except Exception:
        return False


def _get_locked(session, cid, lock):
    """session.get(Case, cid), taking a row lock (SELECT ... FOR UPDATE) when `lock` is
    set and the dialect supports it. Falls back to a plain get on SQLite."""
    if lock and _supports_for_update(session):
        return session.get(Case, cid, with_for_update=True)
    return session.get(Case, cid)


def _parse_created_at(payload):
    """Best-effort parse of payload.createdAt (ISO-8601, may end in 'Z') to an aware
    datetime, or None. Python 3.11+ accepts both 'Z' and explicit offsets."""
    raw = payload.get("createdAt") or payload.get("slaStartedAt")
    if not isinstance(raw, str) or not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _scalars_from(payload):
    return {
        "status": payload.get("status"),
        "created_at": _parse_created_at(payload),
        "updated_at": datetime.now(timezone.utc),
        # RETAINED pick flag — true once picked, survives the case closing (analysis needs
        # previously picked cases); mirrors the SPA's isQueued/isPicked distinction.
        "picked": payload.get("agentStatus") == "queued",
    }


def _store(session, cid, payload, row=None):
    """Insert or replace a case row from a full payload. Pass `row` (the already-fetched,
    possibly row-locked Case) to avoid a second SELECT that would drop the FOR UPDATE lock."""
    scalars = _scalars_from(payload)
    if row is None:
        session.add(Case(id=cid, payload=payload, **scalars))
    else:
        row.payload = payload
        row.status = scalars["status"]
        row.created_at = scalars["created_at"]
        row.updated_at = scalars["updated_at"]
        row.picked = scalars["picked"]


def upsert_cc(session, cases):
    """Ingestion path. Returns (added, updated)."""
    added = updated = 0
    for c in cases:
        cid = c.get("id")
        if not cid:
            continue
        # Lock the existing row so a concurrent operator save/ingest can't slip a write in
        # between this read and our write (lost update). No-op on SQLite (serialized writes).
        row = _get_locked(session, cid, lock=True)
        if row is None:
            _store(session, cid, dict(c))           # brand-new → take the full record
            added += 1
        else:
            overlay = {k: c[k] for k in CC_OWNED_FIELDS if k in c}
            merged = {**row.payload, **overlay}
            if merged != row.payload:
                _store(session, cid, merged, row=row)
                updated += 1
    return added, updated


def upsert_operator(session, cases, purge_ids=()):
    """Operator path (and full-payload seeding). Returns (added, updated, purged)."""
    added = updated = purged = 0
    for c in cases:
        cid = c.get("id")
        if not cid:
            continue
        row = _get_locked(session, cid, lock=True)   # lock to avoid a lost update
        if row is None:
            _store(session, cid, dict(c))           # new case → full insert
            added += 1
        else:
            merged = {**row.payload, **c}            # operator edits are authoritative
            if merged != row.payload:
                _store(session, cid, merged, row=row)
                updated += 1
    for cid in (purge_ids or ()):
        row = _get_locked(session, cid, lock=True)
        if row is not None:
            session.delete(row)
            purged += 1
    return added, updated, purged


def all_cases(session, scope=None, since=None):
    """Return stored case payloads, newest first (NULL created_at last), plus the max
    updated_at cursor as (payloads, as_of_iso).

    scope='picked' → only the working set (indexed WHERE on the lifted flag);
    scope='rest'   → the complement (archive weeks etc.);
    since=<ISO>    → only rows whose updated_at is strictly newer (delta refresh)."""
    q = select(Case)
    if scope == "picked":
        q = q.where(Case.picked.is_(True))
    elif scope == "rest":
        q = q.where((Case.picked.is_(None)) | (Case.picked.is_(False)))
    if since is not None:
        try:
            dt = datetime.fromisoformat(str(since).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            q = q.where(Case.updated_at > dt)
        except ValueError:
            pass   # bad cursor → behave like no cursor (full fetch, still correct)
    rows = session.execute(q).scalars().all()
    dated = sorted((r for r in rows if r.created_at is not None), key=lambda r: r.created_at, reverse=True)
    undated = [r for r in rows if r.created_at is None]
    stamps = [r.updated_at for r in rows if r.updated_at is not None]
    as_of = max(stamps).isoformat() if stamps else None
    return [r.payload for r in dated + undated], as_of


def case_by_id(session, cid):
    row = session.get(Case, cid)
    return [row.payload] if row is not None else []


# ---- Board config (shifts / owners) -----------------------------------------------------------
# A whole config block per key, replaced wholesale on save (it's small and edited as a unit on the
# Shifts / Owners pages). Returns None when a key has never been saved, so the SPA keeps its
# bundled shifts.js / owners.js seed.

def get_config(session, key):
    row = session.get(Config, key)
    return row.payload if row is not None else None


def set_config(session, key, payload):
    """Insert or replace the config block for `key`. Returns 'created' or 'updated'."""
    row = session.get(Config, key)
    if row is None:
        session.add(Config(key=key, payload=payload, updated_at=datetime.now(timezone.utc)))
        return "created"
    row.payload = payload
    row.updated_at = datetime.now(timezone.utc)
    return "updated"
