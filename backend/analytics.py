"""Usage-analytics helpers: batch-insert events and aggregate them for the dashboard.

The SPA's `track()` helper POSTs meaningful operator actions (pick, handover note,
copy/export clicks, page views, …) to /api/events; the hidden #/analytics page reads one
aggregated JSON from /api/events/summary. Aggregation is done in Python over the in-window
rows (event volume is small — one team's clicks), which keeps it portable across
SQLite/PostgreSQL/MySQL instead of leaning on dialect-specific SQL.
"""
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from .db import Event

# Hard caps so a buggy client can't flood the table or the response.
MAX_BATCH = 200
MAX_KIND_LEN = 40
MAX_ID_LEN = 64

# Operators whose activity is HIDDEN from the dashboard (their events are still stored).
# Default: the admin. Override with ANALYTICS_EXCLUDE_OPERATORS (comma-separated ids).
EXCLUDED_OPERATORS = {
    s.strip() for s in os.environ.get("ANALYTICS_EXCLUDE_OPERATORS", "op-admin").split(",") if s.strip()
}


def _parse_at(raw):
    """ISO-8601 (Z or offset) → aware datetime, or None when unparseable."""
    if not isinstance(raw, str) or not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def insert_events(session, rows):
    """Validate + bulk-insert a batch of client events. Returns the number inserted.

    A malformed row is skipped (never aborts the batch) — analytics must be best-effort."""
    added = 0
    for r in rows[:MAX_BATCH]:
        if not isinstance(r, dict):
            continue
        kind = r.get("kind")
        at = _parse_at(r.get("at"))
        if not isinstance(kind, str) or not kind or len(kind) > MAX_KIND_LEN or at is None:
            continue
        op_id = r.get("operatorId")
        case_id = r.get("caseId")
        detail = r.get("detail")
        session.add(Event(
            at=at,
            operator_id=str(op_id)[:MAX_ID_LEN] if op_id else None,
            kind=kind,
            case_id=str(case_id)[:MAX_ID_LEN] if case_id else None,
            detail=detail if isinstance(detail, dict) else {},
        ))
        added += 1
    return added


def _median(values):
    if not values:
        return None
    s = sorted(values)
    n = len(s)
    mid = n // 2
    return s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2


def events_summary(session, days=30):
    """Aggregate the last `days` of events into the one JSON the dashboard renders."""
    days = max(1, min(int(days or 30), 365))
    since = datetime.now(timezone.utc) - timedelta(days=days)
    rows = session.execute(
        select(Event).where(Event.at >= since).order_by(Event.at)
    ).scalars().all()

    total = 0
    by_operator = {}
    by_kind = {}
    matrix = {}          # operator -> kind -> count
    by_day = {}          # YYYY-MM-DD -> count
    picks = {}           # case_id -> {operator, at} — most recent pick, for hand-off pairing
    handoffs = []        # {caseId, operator, pickedAt, handoverAt, hours}

    for e in rows:
        if e.operator_id in EXCLUDED_OPERATORS:
            continue   # admin activity stays out of every index
        total += 1
        op = e.operator_id or "?"
        by_operator[op] = by_operator.get(op, 0) + 1
        by_kind[e.kind] = by_kind.get(e.kind, 0) + 1
        matrix.setdefault(op, {})[e.kind] = matrix.setdefault(op, {}).get(e.kind, 0) + 1
        day = e.at.date().isoformat()
        by_day[day] = by_day.get(day, 0) + 1

        # Hand-off time per case: pair each handover note with the latest pick before it.
        if e.kind == "pick" and e.case_id:
            picks[e.case_id] = {"operator": op, "at": e.at}
        elif e.kind == "handover_note" and e.case_id and e.case_id in picks:
            p = picks.pop(e.case_id)
            hours = (e.at - p["at"]).total_seconds() / 3600.0
            handoffs.append({
                "caseId": e.case_id,
                "operator": p["operator"],
                "pickedAt": p["at"].isoformat(),
                "handoverAt": e.at.isoformat(),
                "hours": round(hours, 2),
            })

    # Per-operator hand-off stats (avg + median hours from pick to handover note).
    handoff_by_op = {}
    for h in handoffs:
        handoff_by_op.setdefault(h["operator"], []).append(h["hours"])
    handoff_stats = [
        {
            "operator": op,
            "count": len(hs),
            "avgHours": round(sum(hs) / len(hs), 2),
            "medianHours": round(_median(hs), 2),
        }
        for op, hs in sorted(handoff_by_op.items())
    ]

    # Fill missing days with zero so the line chart has a continuous axis.
    series = []
    day = since.date()
    end = datetime.now(timezone.utc).date()
    while day <= end:
        key = day.isoformat()
        series.append({"day": key, "count": by_day.get(key, 0)})
        day += timedelta(days=1)

    copy_kinds = ("copy_table", "copy_table_nosanity", "export_csv", "archive_copy_table")
    return {
        "days": days,
        "total": total,
        "operators": sorted(by_operator.keys()),
        "byOperator": by_operator,
        "byKind": by_kind,
        "matrix": matrix,
        "byDay": series,
        "copyCounts": {k: by_kind.get(k, 0) for k in copy_kinds},
        "handoffs": handoffs[-100:],   # newest last; cap the table
        "handoffStats": handoff_stats,
    }
