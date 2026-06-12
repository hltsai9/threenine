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

from .db import Case

# Fields Case Center authoritatively owns. Must stay in sync with CC_OWNED_FIELDS in
# local/persist.py and prototype/app.js. On a live refresh only these are overlaid onto
# an existing case, so an ingestion run never resets operator routing/status.
CC_OWNED_FIELDS = (
    "subject", "ccStatusLabel", "priority", "caseLink", "status",
    "user", "userDept", "reporter", "reporterDept", "assignee", "assigneeDept",
)


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
    }


def _store(session, cid, payload):
    """Insert or replace a case row from a full payload."""
    row = session.get(Case, cid)
    scalars = _scalars_from(payload)
    if row is None:
        session.add(Case(id=cid, payload=payload, **scalars))
    else:
        row.payload = payload
        row.status = scalars["status"]
        row.created_at = scalars["created_at"]
        row.updated_at = scalars["updated_at"]


def upsert_cc(session, cases):
    """Ingestion path. Returns (added, updated)."""
    added = updated = 0
    for c in cases:
        cid = c.get("id")
        if not cid:
            continue
        row = session.get(Case, cid)
        if row is None:
            _store(session, cid, dict(c))           # brand-new → take the full record
            added += 1
        else:
            overlay = {k: c[k] for k in CC_OWNED_FIELDS if k in c}
            merged = {**row.payload, **overlay}
            if merged != row.payload:
                _store(session, cid, merged)
                updated += 1
    return added, updated


def upsert_operator(session, cases, purge_ids=()):
    """Operator path (and full-payload seeding). Returns (added, updated, purged)."""
    added = updated = purged = 0
    for c in cases:
        cid = c.get("id")
        if not cid:
            continue
        row = session.get(Case, cid)
        if row is None:
            _store(session, cid, dict(c))           # new case → full insert
            added += 1
        else:
            merged = {**row.payload, **c}            # operator edits are authoritative
            if merged != row.payload:
                _store(session, cid, merged)
                updated += 1
    for cid in (purge_ids or ()):
        row = session.get(Case, cid)
        if row is not None:
            session.delete(row)
            purged += 1
    return added, updated, purged


def all_cases(session):
    """Return every stored case payload, newest first (NULL created_at last)."""
    rows = session.execute(select(Case)).scalars().all()
    dated = sorted((r for r in rows if r.created_at is not None), key=lambda r: r.created_at, reverse=True)
    undated = [r for r in rows if r.created_at is None]
    return [r.payload for r in dated + undated]


def case_by_id(session, cid):
    row = session.get(Case, cid)
    return [row.payload] if row is not None else []
