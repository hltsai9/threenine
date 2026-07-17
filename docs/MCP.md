# MCP server — query the Case Tracker DB from an AI agent

A **read-only [MCP](https://modelcontextprotocol.io) server** that lets an AI coding agent
(opencode, Claude Code, Claude Desktop, …) query the Case Tracker database directly: cases,
the shift/operator roster, usage-analytics events, and the same per-operator timeline stats
the `#/analytics` Gantt shows.

```
opencode / Claude ── port-forward → HTTP :8081/mcp (or stdio) ── backend.mcp_server (K8s pod) ── DATABASE_URL ── MariaDB/Postgres/SQLite
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

Save as **`backend/mcp_server.py`** (verified working — all tools exercised against a seeded
database over both transports, stdio and streamable-HTTP):

```python
"""Read-only MCP server for the Case Tracker database.

Run from the repo root:

    python -m backend.mcp_server                          # stdio (client-spawned)
    MCP_TRANSPORT=streamable-http python -m backend.mcp_server   # HTTP :8081/mcp (container)

The database is selected by DATABASE_URL exactly like the API (see backend/db.py —
defaults to the repo-root SQLite; postgres:// URLs are normalized automatically).

Strictly READ-ONLY: every tool opens one session, never commits, never creates tables,
and this module holds no Case Center credentials (imports only db / merge / analytics).
stdio rule: never print to stdout — the MCP transport owns it; diagnostics go to stderr.
"""
from __future__ import annotations

import functools
import logging
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from mcp.server.fastmcp import FastMCP

from .analytics import EXCLUDED_OPERATORS, events_summary as _events_summary
from .db import DATABASE_URL, Event, SessionLocal
from .merge import all_cases, case_by_id, get_config as _get_config

# Logs go to STDERR only (stdout belongs to the stdio transport). Tune with MCP_LOG_LEVEL
# (DEBUG | INFO | WARNING, default INFO). In the container: `docker logs case-tracker-mcp`.
logging.basicConfig(
    stream=sys.stderr,
    level=os.environ.get("MCP_LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
log = logging.getLogger("case-tracker-mcp")


def _safe_url(url):
    """Mask the password so the DB URL is loggable."""
    return re.sub(r"//([^:/@]+):[^@]+@", r"//\1:***@", str(url))


def _logged(fn):
    """One INFO line per tool call: name, arguments, duration, and a result summary
    (count/total/casesHandled, or the error for error-dict returns)."""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        shown = ", ".join(f"{k}={v!r}" for k, v in kwargs.items() if v is not None)
        t0 = time.perf_counter()
        try:
            result = fn(*args, **kwargs)
        except Exception:
            log.exception("%s(%s) raised", fn.__name__, shown)
            raise
        ms = (time.perf_counter() - t0) * 1000
        summary = ""
        if isinstance(result, dict):
            if "error" in result:
                summary = f" -> error: {result['error']}"
            else:
                for k in ("count", "total", "casesHandled"):
                    if k in result:
                        summary = f" -> {k}={result[k]}"
                        break
        log.info("%s(%s) %.0fms%s", fn.__name__, shown, ms, summary)
        return result
    return wrapper


mcp = FastMCP("case-tracker")
log.info("case-tracker MCP server · db=%s", _safe_url(DATABASE_URL))

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
@_logged
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
@_logged
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
@_logged
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
@_logged
def list_operators() -> dict:
    """The operator roster and shift windows from the stored 'shifts' config."""
    with SessionLocal() as session:
        payload = _get_config(session, "shifts")
    if payload is None:
        return {"error": "no 'shifts' config stored (deployment still on the bundled seed)"}
    return {"operators": payload.get("operators") or [], "shifts": payload.get("shifts") or []}


@mcp.tool()
@_logged
def usage_summary(days: int = 30) -> dict:
    """Aggregated usage-analytics summary (same data as the #/analytics dashboard):
    totals, per-operator / per-kind counts, per-day series, hand-off times and stats.
    Excludes ANALYTICS_EXCLUDE_OPERATORS (default op-admin). days clamped to 1–365."""
    with SessionLocal() as session:
        return _events_summary(session, days=days)


@mcp.tool()
@_logged
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
@_logged
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
    # MCP_TRANSPORT=streamable-http runs a long-lived HTTP server (for a background
    # container; endpoint path /mcp) instead of the default stdio (client-spawned process).
    if os.environ.get("MCP_TRANSPORT", "stdio") in ("streamable-http", "http"):
        mcp.settings.host = os.environ.get("MCP_HOST", "127.0.0.1")
        mcp.settings.port = int(os.environ.get("MCP_PORT", "8081"))
        log.info("transport=streamable-http endpoint=http://%s:%s/mcp",
                 mcp.settings.host, mcp.settings.port)
        mcp.run(transport="streamable-http")
    else:
        log.info("transport=stdio")
        mcp.run()
```

## 2 · Deploy on Kubernetes

The server supports two transports: **stdio** (the client spawns the process — see §4) and
**streamable HTTP** (`MCP_TRANSPORT=streamable-http` — a long-running server clients connect to
over the network). An in-cluster Deployment uses HTTP, and reaches the database through the same
`case-tracker-db` Secret the API already uses — so `DATABASE_URL` is the in-cluster Service DNS
(e.g. `mysql+pymysql://user:pass@mariadb:3306/cases`), no port-forward needed for the server↔DB
hop.

**Image** — save as `deploy/Dockerfile.mcp` (mirrors `Dockerfile.api`; adds the `mcp` package):

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt "mcp>=1.2,<2"
COPY backend/ backend/
RUN useradd -u 1000 -m app
USER 1000
ENV MCP_TRANSPORT=streamable-http MCP_HOST=0.0.0.0 MCP_PORT=8081 PYTHONUNBUFFERED=1
EXPOSE 8081
CMD ["python", "-m", "backend.mcp_server"]
```

Build and push to the registry your cluster pulls from:

```bash
docker build -f deploy/Dockerfile.mcp -t <your-registry>/case-tracker-mcp:latest .
docker push <your-registry>/case-tracker-mcp:latest
```

**Manifest** — save as `deploy/k8s/mcp-deployment.yaml` (same conventions as
`api-deployment.yaml`: non-root, read-only rootfs, the `case-tracker-db` Secret for
`DATABASE_URL`; a `tcpSocket` probe since the server has no `/healthz`):

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: case-tracker-mcp
  labels: { app: case-tracker-mcp }
spec:
  replicas: 1
  selector:
    matchLabels: { app: case-tracker-mcp }
  template:
    metadata:
      labels: { app: case-tracker-mcp }
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: mcp
          image: <your-registry>/case-tracker-mcp:latest   # pin to a digest/tag in prod
          imagePullPolicy: IfNotPresent
          ports:
            - { name: http, containerPort: 8081 }
          envFrom:
            - secretRef: { name: case-tracker-db }   # DATABASE_URL (same Secret as the API)
          # env:
          #   - { name: MCP_LOG_LEVEL, value: "INFO" }
          #   - { name: ANALYTICS_EXCLUDE_OPERATORS, value: "op-admin" }
          startupProbe:
            tcpSocket: { port: http }
            periodSeconds: 5
            failureThreshold: 20
          readinessProbe:
            tcpSocket: { port: http }
            periodSeconds: 10
          livenessProbe:
            tcpSocket: { port: http }
            periodSeconds: 20
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
          resources:
            requests: { cpu: 50m, memory: 128Mi }
            limits: { cpu: 500m, memory: 256Mi }
---
apiVersion: v1
kind: Service
metadata:
  name: case-tracker-mcp
spec:
  selector: { app: case-tracker-mcp }
  ports:
    - { name: http, port: 80, targetPort: http }
```

```bash
kubectl apply -f deploy/k8s/mcp-deployment.yaml
kubectl rollout status deploy/case-tracker-mcp
```

Notes:

- **Schema** must already be at head — the server never creates/alters tables. The API's
  `migrate` initContainer (or your migration Job) handles `alembic upgrade head`; the MCP
  Deployment just reads.
- **Security:** the endpoint has **no authentication**. Keep the Service `ClusterIP` (the
  default above) — do **not** add it to the Ingress. Clients reach it via `kubectl port-forward`
  (§3), which is authenticated by your kubeconfig.

### Verify it connects to the database

The server connects **lazily** — a healthy pod does not prove the DB works; the first query
does. Three checks, weakest to strongest:

1. **Which DB did it resolve?** The startup log prints the URL (password masked):
   ```bash
   kubectl logs deploy/case-tracker-mcp | head -2
   # ... case-tracker MCP server · db=mysql+pymysql://user:***@mariadb:3306/cases
   ```
   If this says `db=sqlite:////app/casetracker.db`, the Secret didn't reach the pod — it's
   running against an empty demo SQLite, not your database.
2. **Force a real query, watch the log.** After a client calls any tool (or run the exec below):
   ```
   INFO [case-tracker-mcp] list_cases(limit=1) 3ms -> count=1        ← connected, data flowing
   INFO [case-tracker-mcp] list_cases(limit=1) raised                ← DB unreachable; traceback follows
   ```
3. **Decisive — query from inside the pod** (isolates pod↔DB from any client):
   ```bash
   kubectl exec deploy/case-tracker-mcp -- python -c "
   import sqlalchemy
   from backend.db import engine, SessionLocal, Case
   print('url:', engine.url)
   print('tables:', sqlalchemy.inspect(engine).get_table_names())
   with SessionLocal() as s: print('cases in db:', s.query(Case).count())"
   ```
   - Connected → `['alembic_version', 'cases', 'config', 'events']` and a real case count.
   - `Can't connect to MySQL server` → DNS / NetworkPolicy / credentials — check the Service
     name, namespace, and the `case-tracker-db` Secret.
   - Empty table list → connected, but to the wrong database/schema.

   Finally confirm it's **your** data: `list_operators()` should return your real roster (demo
   SQLite would return seed names).

### Logs

The server logs every tool call to **stderr** — one line with the tool name, arguments,
duration, and a result summary (or the error) — plus a startup line with the transport and the
DB URL (password masked):

```
2026-07-17 17:23:44 INFO [case-tracker-mcp] case-tracker MCP server · db=mysql+pymysql://user:***@mariadb:3306/cases
2026-07-17 17:23:44 INFO [case-tracker-mcp] transport=streamable-http endpoint=http://0.0.0.0:8081/mcp
2026-07-17 17:23:52 INFO [case-tracker-mcp] list_cases(scope='picked') 2ms -> count=12
2026-07-17 17:23:59 INFO [case-tracker-mcp] operator_timeline(operator_id='op-da', from_date='2026-07-16', to_date='2026-07-17', utc_offset_minutes=0) 6ms -> casesHandled=2
2026-07-17 17:24:03 INFO [case-tracker-mcp] get_case(case_id='NOPE') 1ms -> error: case not found
```

- **Kubernetes:** `kubectl logs -f deploy/case-tracker-mcp` (`--previous` for a crashed pod).
- **stdio:** stderr is captured by the client — opencode shows it in the session's MCP/server
  output; Claude Code in the output of `claude mcp list` / its log files.
- **Verbosity:** set `MCP_LOG_LEVEL` (`DEBUG` | `INFO` | `WARNING`, default `INFO`) via the
  Deployment `env` (commented above) to log errors only. Unhandled exceptions always log a full
  traceback.

## 3 · Connect to the in-cluster server

Forward the Service to your machine (authenticated by your kubeconfig), then point the client at
the local port. The endpoint path is **`/mcp`**.

```bash
kubectl port-forward svc/case-tracker-mcp 8081:80
```

**opencode** — `opencode.json` (repo root, or global `~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "case-tracker": {
      "type": "remote",
      "url": "http://127.0.0.1:8081/mcp",
      "enabled": true
    }
  }
}
```

**Claude Code**:

```bash
claude mcp add --transport http case-tracker http://127.0.0.1:8081/mcp
```

## 4 · Alternative: run locally over stdio (no cluster)

The client spawns the server itself — nothing runs in the background. Install into a venv
(from the repo root):

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt   # SQLAlchemy + DB drivers (skip if already installed)
pip install "mcp>=1.2,<2"                 # official MCP Python SDK

kubectl port-forward svc/<your-mariadb-service> 3307:3306
export DATABASE_URL="mysql+pymysql://USER:PASS@localhost:3307/DBNAME"
```

> The client configs must point at the venv's interpreter (`.venv/bin/python`, Windows:
> `.venv\Scripts\python.exe`) — the client spawns the process outside your activated shell.

opencode (`opencode.json` in the repo root; from elsewhere use the absolute interpreter path
and add `"PYTHONPATH": "/path/to/threenine"` to `environment`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "case-tracker": {
      "type": "local",
      "command": [".venv/bin/python", "-m", "backend.mcp_server"],
      "enabled": true,
      "environment": { "DATABASE_URL": "{env:DATABASE_URL}" }
    }
  }
}
```

Claude Code / Desktop:

```bash
claude mcp add case-tracker \
  --env DATABASE_URL="mysql+pymysql://user:pass@localhost:3307/cases" \
  -- .venv/bin/python -m backend.mcp_server
```

```json
{
  "mcpServers": {
    "case-tracker": {
      "command": "/path/to/threenine/.venv/bin/python",
      "args": ["-m", "backend.mcp_server"],
      "cwd": "/path/to/threenine",
      "env": { "DATABASE_URL": "mysql+pymysql://user:pass@localhost:3307/cases" }
    }
  }
}
```

Optional for either transport: pass `ANALYTICS_EXCLUDE_OPERATORS` through the environment to
hide operators from the events tools (default hides `op-admin`).

## 5 · Tool reference

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

## 6 · Worked examples

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
| Pod `CrashLoopBackOff` / client can't connect to `:8081` | `kubectl logs deploy/case-tracker-mcp --previous` — usually a bad `DATABASE_URL`. Confirm the log shows `Uvicorn running`, that `kubectl port-forward` is running, and that the client URL ends in **`/mcp`**. |
| Pod runs but every tool errors with a connection failure | The pod can't reach the DB — check `DATABASE_URL` uses the in-cluster **Service DNS** (`mariadb:3306`, not `localhost`), the `case-tracker-db` Secret, and any NetworkPolicy. Confirm with the `kubectl exec` check in §2. |
| stdio client says the server disconnected immediately | Run `.venv/bin/python -m backend.mcp_server` manually and read stderr — usually a bad `DATABASE_URL` or a dead port-forward. |
| Tools work but return nothing | Empty DB / wrong database — check `DATABASE_URL`; unset means the repo-root demo SQLite. |
| `operator_timeline` finds 0 cases for a real operator | The roster id must be `op-` + the Case Center account id (check `list_operators()` against a real segment's `processor`). |

Deferred ideas (tracked in [`improvement-plan.md`](improvement-plan.md)): bearer-token auth so
the Service can go on the Ingress (drop the port-forward), MCP resources for case payloads, a
read-only DB role recipe.
