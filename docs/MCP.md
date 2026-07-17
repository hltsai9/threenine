# MCP server — query the Case Tracker DB from an AI agent

A **read-only [MCP](https://modelcontextprotocol.io) server** that lets an AI coding agent
(opencode, Claude Code, Claude Desktop, …) query the Case Tracker database directly: cases,
the shift/operator roster, usage-analytics events, and the same per-operator timeline stats
the `#/analytics` Gantt shows.

```
opencode / Claude ── stdio (JSON-RPC) ── python -m backend.mcp_server ── DATABASE_URL ── Postgres/SQLite
```

Design guarantees:

- **Read-only** — every tool opens one session and never commits; the server never creates
  tables (`init_db` is not called), so a schema problem errors loudly instead of mutating a
  production DB.
- **No Case Center credentials** — it imports only `backend/db.py`, `merge.py`,
  `analytics.py` (the same invariant as the read API; see [`SETUP.md`](SETUP.md)).
- **Bounded responses** — list tools return trimmed summaries (never `processTimeline` /
  `history`), and every tool has hard caps, so results stay small enough for a model context.

---

## 1 · The server code

Save as **`backend/mcp_server.py`** (verified working — all tools exercised over stdio against
a seeded database):

```python
"""Read-only MCP server for the Case Tracker database (stdio transport).

Run from the repo root:

    python -m backend.mcp_server

The database is selected by DATABASE_URL exactly like the API (see backend/db.py —
defaults to the repo-root SQLite; postgres:// URLs are normalized automatically).

Strictly READ-ONLY: every tool opens one session, never commits, never creates tables,
and this module holds no Case Center credentials (imports only db / merge / analytics).
stdio rule: never print to stdout — the MCP transport owns it; diagnostics go to stderr.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from mcp.server.fastmcp import FastMCP

from .analytics import EXCLUDED_OPERATORS, events_summary as _events_summary
from .db import Event, SessionLocal
from .merge import all_cases, case_by_id, get_config as _get_config

mcp = FastMCP("case-tracker")

# Case payloads are big (processTimeline / history / handover). List tools return these
# summary fields only; ask for more via `fields` or fetch one case with get_case.
SUMMARY_FIELDS = ("id", "subject", "status", "ccStatusLabel", "agentStatus", "trackStatus",
                  "priority", "createdAt", "assignee", "assigneeDept", "caseLink")

HOUR_MS = 3600 * 1000


def _parse_ts(raw):
    """ISO timestamp -> aware datetime (Z-tolerant), or None."""
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _short_name(name):
    """'Mia Chen (MC)' -> 'Mia Chen' — mirrors shortOpName() in frontend/app.js."""
    return re.sub(r"\s*\(.*$", "", str(name or "")).strip() or str(name or "")


def _roster_operator(session, operator_id):
    """Look the operator up in the stored 'shifts' config; None if not stored."""
    cfg = _get_config(session, "shifts") or {}
    for op in cfg.get("operators") or []:
        if str(op.get("id", "")).lower() == str(operator_id).lower():
            return op
    return None


def _processor_matches(processor, operator_id, op):
    """Does a processTimeline segment's `processor` (a Case Center account id) refer to
    this roster operator? Roster ids are 'op-' + the Case Center id, so the prefix-stripped
    id is the primary match; name / short name are permissive fallbacks (mirrors
    processorMatchesOperator() in frontend/app.js)."""
    if not processor:
        return False
    p = str(processor).lower()
    rid = str(operator_id).lower()
    candidates = {rid, rid[3:] if rid.startswith("op-") else "op-" + rid}
    if op:
        name = str(op.get("name") or "")
        candidates |= {str(op.get("id") or "").lower(), name.lower(), _short_name(name).lower()}
    candidates.discard("")
    return p in candidates


def _trim(payload, fields):
    keys = list(SUMMARY_FIELDS) + [f for f in (fields or []) if f not in SUMMARY_FIELDS]
    return {k: payload.get(k) for k in keys if k in payload}


@mcp.tool()
def list_cases(scope: str | None = None, status: str | None = None, since: str | None = None,
               limit: int = 50, fields: list[str] | None = None) -> dict:
    """List cases (summaries — no processTimeline/history; use get_case for one full case).

    scope: 'picked' (retained picks) | 'rest' | omit for all.
    status: board column filter, e.g. 'in_it', 'with_core', 'closed'.
    since: ISO cursor — only cases updated after it (use the returned asOf as the next cursor).
    fields: extra payload keys to include per case, e.g. ["handover", "waitUser"].
    """
    limit = max(1, min(int(limit), 200))
    if scope not in (None, "picked", "rest"):
        return {"error": "scope must be 'picked', 'rest', or omitted"}
    with SessionLocal() as session:
        payloads, as_of = all_cases(session, scope=scope, since=since)
    if status:
        payloads = [p for p in payloads if str(p.get("status", "")).lower() == status.lower()]
    return {"total": len(payloads), "count": min(limit, len(payloads)), "asOf": as_of,
            "cases": [_trim(p, fields) for p in payloads[:limit]]}


@mcp.tool()
def get_case(case_id: str, fields: list[str] | None = None) -> dict:
    """One case. Full payload by default (large — includes processTimeline, history,
    handover); pass fields=["processTimeline"] etc. to fetch only specific keys."""
    with SessionLocal() as session:
        found = case_by_id(session, case_id)
    if not found:
        return {"error": "case not found", "caseId": case_id}
    payload = found[0]
    if fields:
        return {k: payload.get(k) for k in ["id", *fields] if k in payload}
    return payload


@mcp.tool()
def get_board_config(key: str) -> dict:
    """Stored board config: key = 'shifts' (operators + shift windows + rota) or 'owners'
    (Core Team / HQ owner groups). Empty if the deployment still uses the bundled seed."""
    if key not in ("shifts", "owners"):
        return {"error": "key must be 'shifts' or 'owners'", "key": key}
    with SessionLocal() as session:
        payload = _get_config(session, key)
    if payload is None:
        return {"error": "no config stored for this key (deployment still on the bundled seed)",
                "key": key}
    return {"key": key, "payload": payload}


@mcp.tool()
def list_operators() -> dict:
    """The operator roster and shift windows from the stored 'shifts' config."""
    with SessionLocal() as session:
        payload = _get_config(session, "shifts")
    if payload is None:
        return {"error": "no 'shifts' config stored (deployment still on the bundled seed)"}
    return {"operators": payload.get("operators") or [], "shifts": payload.get("shifts") or []}


@mcp.tool()
def usage_summary(days: int = 30) -> dict:
    """Aggregated usage-analytics summary (same data as the #/analytics dashboard):
    totals, per-operator / per-kind counts, per-day series, hand-off times and stats.
    Excludes ANALYTICS_EXCLUDE_OPERATORS (default op-admin). days clamped to 1–365."""
    with SessionLocal() as session:
        return _events_summary(session, days=days)


@mcp.tool()
def list_events(operator_id: str | None = None, kind: str | None = None,
                case_id: str | None = None, from_date: str | None = None,
                to_date: str | None = None, limit: int = 100,
                include_excluded: bool = False) -> dict:
    """Raw usage events, newest first. from_date/to_date are YYYY-MM-DD UTC days
    (to_date inclusive). Excludes ANALYTICS_EXCLUDE_OPERATORS unless include_excluded."""
    limit = max(1, min(int(limit), 500))
    stmt = select(Event).order_by(Event.at.desc())
    if operator_id:
        stmt = stmt.where(Event.operator_id == operator_id)
    if kind:
        stmt = stmt.where(Event.kind == kind)
    if case_id:
        stmt = stmt.where(Event.case_id == case_id)
    if from_date:
        ts = _parse_ts(from_date + "T00:00:00+00:00")
        if not ts:
            return {"error": "from_date must be YYYY-MM-DD"}
        stmt = stmt.where(Event.at >= ts)
    if to_date:
        ts = _parse_ts(to_date + "T00:00:00+00:00")
        if not ts:
            return {"error": "to_date must be YYYY-MM-DD"}
        stmt = stmt.where(Event.at < ts + timedelta(days=1))
    out = []
    with SessionLocal() as session:
        for e in session.execute(stmt.limit(limit * 2)).scalars():
            if not include_excluded and e.operator_id in EXCLUDED_OPERATORS:
                continue
            at = e.at if e.at and e.at.tzinfo else (e.at.replace(tzinfo=timezone.utc) if e.at else None)
            out.append({"id": e.id, "at": at.isoformat() if at else None,
                        "operatorId": e.operator_id, "kind": e.kind,
                        "caseId": e.case_id, "detail": e.detail})
            if len(out) >= limit:
                break
    return {"count": len(out), "events": out}


@mcp.tool()
def operator_timeline(operator_id: str, from_date: str, to_date: str,
                      utc_offset_minutes: int = 0) -> dict:
    """How an operator worked across a date range, from Case Center processTimeline —
    the server-side twin of the board's Operator-timeline Gantt: cases handled, hours per
    case, per-day distinct cases, activeDays and avgCasesPerDay.

    Day boundaries use utc_offset_minutes (0 = UTC days; pass 480 to match a UTC+8 board,
    -420 for MST). Dates are YYYY-MM-DD, to_date inclusive. Open segments end at now.
    """
    tz = timezone(timedelta(minutes=int(utc_offset_minutes)))
    try:
        start = datetime.strptime(from_date, "%Y-%m-%d").replace(tzinfo=tz)
        end = datetime.strptime(to_date, "%Y-%m-%d").replace(tzinfo=tz) + timedelta(days=1)
    except ValueError:
        return {"error": "from_date/to_date must be YYYY-MM-DD"}
    if end <= start:
        end = start + timedelta(days=1)
    if (end - start) > timedelta(days=92):
        return {"error": "range too wide — 92 days max"}

    with SessionLocal() as session:
        op = _roster_operator(session, operator_id)
        payloads, _ = all_cases(session)

    now = datetime.now(timezone.utc)
    by_case: dict[str, dict] = {}
    for p in payloads:
        if p.get("deletedAt"):
            continue
        for seg in p.get("processTimeline") or []:
            if not _processor_matches(seg.get("processor"), operator_id, op):
                continue
            a = _parse_ts(seg.get("startedAt"))
            if not a:
                continue
            b = _parse_ts(seg.get("endedAt")) or now
            if b < a:
                b = a
            f, t = max(a, start), min(b, end)
            if t <= f:
                continue
            row = by_case.setdefault(p.get("id"), {"subject": p.get("subject"), "segs": []})
            row["segs"].append({"start": f, "end": t,
                                "type": seg.get("processType") or seg.get("ccStatus") or ""})

    day_cases: dict[str, set] = {}
    cases_out, total_ms = [], 0.0
    for cid, row in by_case.items():
        row["segs"].sort(key=lambda s: s["start"])
        ms = sum((s["end"] - s["start"]).total_seconds() * 1000 for s in row["segs"])
        total_ms += ms
        for s in row["segs"]:
            d = s["start"].astimezone(tz).date()
            last = (s["end"] - timedelta(milliseconds=1)).astimezone(tz).date()
            while d <= last:
                day_cases.setdefault(d.isoformat(), set()).add(cid)
                d += timedelta(days=1)
        cases_out.append({
            "id": cid, "subject": row["subject"], "hours": round(ms / HOUR_MS, 2),
            "truncated": len(row["segs"]) > 50,
            "segments": [{"start": s["start"].isoformat(), "end": s["end"].isoformat(),
                          "type": s["type"]} for s in row["segs"][:50]],
        })
    cases_out.sort(key=lambda c: c["segments"][0]["start"])
    active_days = len(day_cases)
    case_days = sum(len(v) for v in day_cases.values())
    return {
        "operator": op or {"id": operator_id, "name": None,
                           "note": "not in stored roster — matched by id only"},
        "fromDate": from_date, "toDate": to_date, "utcOffsetMinutes": utc_offset_minutes,
        "casesHandled": len(cases_out),
        "totalHours": round(total_ms / HOUR_MS, 2),
        "activeDays": active_days,
        "avgCasesPerDay": round(case_days / active_days, 1) if active_days else 0,
        "byDay": [{"day": d, "cases": len(day_cases[d])} for d in sorted(day_cases)],
        "truncated": len(cases_out) > 100,
        "cases": cases_out[:100],
    }


if __name__ == "__main__":
    mcp.run()   # stdio transport
```

## 2 · Install

```bash
pip install -r backend/requirements.txt   # SQLAlchemy + DB drivers (skip if already installed)
pip install "mcp>=1.2,<2"                 # official MCP Python SDK
```

## 3 · Point it at your database

The server reads **`DATABASE_URL`** exactly like the API (unset → the repo-root demo SQLite).
For the Kubernetes Postgres, port-forward first and make sure migrations have run:

```bash
kubectl port-forward svc/<your-postgres-service> 5433:5432
export DATABASE_URL="postgresql+psycopg://USER:PASS@localhost:5433/DBNAME"
# schema must be current (the server never creates/alters tables):
alembic -c backend/alembic.ini upgrade head
```

Quick manual smoke test (it should sit silently waiting on stdin — Ctrl-C to exit):

```bash
cd /path/to/threenine && python -m backend.mcp_server
```

## 4 · Connect from opencode

Add to **`opencode.json` in the repo root** (start `opencode` inside the repo so
`python -m backend.mcp_server` resolves):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "case-tracker": {
      "type": "local",
      "command": ["python", "-m", "backend.mcp_server"],
      "enabled": true,
      "environment": {
        "DATABASE_URL": "{env:DATABASE_URL}"
      }
    }
  }
}
```

Notes:

- `{env:NAME}` substitutes from your shell environment at load time — or hardcode the
  port-forward URL (`"DATABASE_URL": "postgresql+psycopg://user:pass@localhost:5433/cases"`).
- To use it from **outside** the repo (e.g. global `~/.config/opencode/opencode.json`), add
  `"PYTHONPATH": "/path/to/threenine"` to `environment` so `-m backend.mcp_server` still resolves.
- `"enabled": false` parks the server without deleting the config.
- Optional: pass `ANALYTICS_EXCLUDE_OPERATORS` through `environment` to hide other operators
  from the events tools (default hides `op-admin`).

## 5 · Connect from Claude Code / Claude Desktop

```bash
claude mcp add case-tracker \
  --env DATABASE_URL="postgresql+psycopg://user:pass@localhost:5433/cases" \
  -- python -m backend.mcp_server
```

or the equivalent `.mcp.json` / Desktop-config entry:

```json
{
  "mcpServers": {
    "case-tracker": {
      "command": "python",
      "args": ["-m", "backend.mcp_server"],
      "cwd": "/path/to/threenine",
      "env": { "DATABASE_URL": "postgresql+psycopg://user:pass@localhost:5433/cases" }
    }
  }
}
```

## 6 · Tool reference

| Tool | Parameters (defaults) | Returns |
| ---- | --------------------- | ------- |
| `list_cases` | `scope` (picked/rest/all) · `status` · `since` ISO cursor · `limit` 50 (≤200) · `fields` | `{total, count, asOf, cases:[summaries]}` — summaries never include `processTimeline`/`history` |
| `get_case` | `case_id` · `fields` | full payload, or just the requested keys |
| `get_board_config` | `key` = `shifts` \| `owners` | `{key, payload}` |
| `list_operators` | — | `{operators:[{id,name,shift}], shifts:[{name,hoursUtc}]}` |
| `usage_summary` | `days` 30 (1–365) | the `#/analytics` aggregate: totals, byOperator, byKind, byDay, hand-off stats |
| `list_events` | `operator_id` · `kind` · `case_id` · `from_date`/`to_date` (UTC days) · `limit` 100 (≤500) · `include_excluded` | `{count, events:[{at, operatorId, kind, caseId, detail}]}` |
| `operator_timeline` | `operator_id` · `from_date`/`to_date` (≤92 days) · `utc_offset_minutes` 0 | cases handled, totalHours, activeDays, avgCasesPerDay, byDay, per-case segments |

`operator_timeline` matches Case Center's `processor` against the roster id **without the
`op-` prefix** first (`cc123` ↔ `op-cc123`), then full id / name / short name — the same rule
as the board's Gantt.

## 7 · Worked examples

Real captured output (seeded demo DB, trimmed). In opencode just ask in plain language —
the model picks the tool; the calls below are what it runs.

**"Which cases are picked right now?"** → `list_cases(scope="picked", limit=5)`

```json
{"total": 1, "count": 1, "asOf": "2026-07-17T05:45:56+00:00",
 "cases": [{"id": "CS20260716X0000091011", "subject": "Login loop on SSO",
            "status": "in_it", "agentStatus": "queued", "priority": "high",
            "caseLink": "https://cc.example/case/CS20260716X0000091011"}]}
```

**"Show me just the timeline of that case"** → `get_case("CS20260716X0000091011", fields=["processTimeline"])`

```json
{"id": "CS20260716X0000091011",
 "processTimeline": [
   {"processor": "da", "processType": "Service Team",
    "startedAt": "2026-07-16T01:45:56Z", "endedAt": "2026-07-16T03:45:56Z"},
   {"processor": "da", "processType": "IT Office", "startedAt": "2026-07-17T03:45:56Z"}]}
```

**"How did Mia work these two days?"** → `operator_timeline("op-da", "2026-07-16", "2026-07-17")`

```json
{"operator": {"id": "op-da", "name": "Mia (DA)", "shift": "Day"},
 "casesHandled": 2, "totalHours": 5.0, "activeDays": 2, "avgCasesPerDay": 1.5,
 "byDay": [{"day": "2026-07-16", "cases": 1}, {"day": "2026-07-17", "cases": 2}],
 "cases": [
   {"id": "CS20260716X0000091011", "subject": "Login loop on SSO", "hours": 4.0,
    "segments": [
      {"start": "2026-07-16T01:45:56+00:00", "end": "2026-07-16T03:45:56+00:00", "type": "Service Team"},
      {"start": "2026-07-17T03:45:56+00:00", "end": "2026-07-17T05:45:57+00:00", "type": "IT Office"}]},
   {"id": "CS20260716X0000091022", "subject": "Report export empty", "hours": 1.0,
    "segments": [
      {"start": "2026-07-17T00:45:56+00:00", "end": "2026-07-17T01:45:56+00:00", "type": "Service Team"}]}]}
```

The open `IT Office` segment ran to "now"; pass `utc_offset_minutes=480` to slice days the way
a GMT+8 board displays them.

**"Hand-off stats for the last week"** → `usage_summary(7)` · **"Who's on the roster?"** →
`list_operators()` · **"What did op-da click today?"** → `list_events(operator_id="op-da",
from_date="2026-07-17")`

## Troubleshooting

| Symptom | Cause / fix |
| ------- | ----------- |
| `no such column: cases.picked` (or similar) on every tool | Schema behind the code — run `alembic -c backend/alembic.ini upgrade head`. |
| `no 'shifts' config stored` | The deployment still uses the bundled `frontend/shifts.js` seed — seed the config (see the seed-config job in `deploy/`) or edit via the Shifts page. |
| Client says the server disconnected immediately | Run `python -m backend.mcp_server` manually and read stderr — usually a bad `DATABASE_URL` or a dead port-forward. |
| Tools work but return nothing | Empty DB / wrong database — check `DATABASE_URL`; unset means the repo-root demo SQLite. |
| `operator_timeline` finds 0 cases for a real operator | The roster id must be `op-` + the Case Center account id (check `list_operators()` against a real segment's `processor`). |

Deferred ideas (tracked in [`improvement-plan.md`](improvement-plan.md)): streamable-HTTP
transport for in-cluster use, MCP resources for case payloads, a read-only DB role recipe.
