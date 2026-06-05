"""
Adapter between your on-prem Case Center and the Case Tracker board.

You fill in TWO things:
  1. fetch_raw()  — your existing Python request to Case Center (the script that
                    already has the API key + cookie). Return a list of raw record
                    dicts (whatever Case Center gives you).
  2. STATUS_MAP / map_record() — translate one Case Center record into the board's
                    case shape (see the contract below).

SECURITY
--------
Do NOT hardcode the API key or cookie here. They are read from environment
variables or local/secrets.local.json (which is gitignored). This file is safe
to commit; secrets.local.json is not.

Board case contract (what /api/cases returns per case)
------------------------------------------------------
Required:  id (str), subject (str), status (one of the board statuses below)
Status enum (this is the *Case Center status*, it drives the kanban columns):
    new | with_fit | with_hq | sanity_check | returned_to_requester
    | resolved | closed | cancelled
Optional (sensible defaults applied in the browser if omitted):
    caseLink (built from BASE_URL + caseId), ccStatusLabel (the displayed CC status),
    requester + requesterDept (the end user), reporterId + reporterDept,
    assigneeId + assigneeDept, priority (low|medium|high), caseType,
    createdAt / slaStartedAt (ISO-8601 GMT, e.g. "2026-06-04T20:57:18.742+00:00"), notes
The agent layer (queue placement, handover notes, reminders) is LOCAL to the
browser and must NOT come from Case Center — it is merged back automatically.
"""
import inspect
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))

# Case Center query window (hours back) — how far back to look for cases. The board's
# "Created within … h / Load" control sets this per request; this is just the default.
# Use it in your fetch_raw() JQL, e.g.  f"created >= -{int(LOOKBACK_HOURS)}h"
LOOKBACK_HOURS = float(os.environ.get("CASE_CENTER_LOOKBACK_HOURS", "6") or "6")

# When the board's "+ New case" is used, this holds the single caseId to fetch. Your
# fetch_raw() should query just that case when it's set, e.g.:
#     if CASE_ID:  jql = f'caseId = "{CASE_ID}"'
#     else:        jql = f"created >= -{int(LOOKBACK_HOURS)}h"
CASE_ID = None

# >>> FILL IN: your Case Center base URL, used to build a clickable link per case.
#     The caseId is appended to it (adjust build_case_link() below if your URL pattern
#     differs, e.g. needs "?id="). Can also be set via the CASE_CENTER_BASE_URL env var.
#     Example: "https://case-center.internal/case/"
BASE_URL = os.environ.get("CASE_CENTER_BASE_URL", "") or ""


def build_case_link(case_id):
    if not BASE_URL or not case_id:
        return ""
    return BASE_URL.rstrip("/") + "/" + str(case_id)


def _load_secrets():
    """API key + cookie from env vars, falling back to local/secrets.local.json."""
    api_key = os.environ.get("CASE_CENTER_API_KEY")
    cookie = os.environ.get("CASE_CENTER_COOKIE")
    path = os.path.join(HERE, "secrets.local.json")
    if (not api_key or not cookie) and os.path.exists(path):
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        api_key = api_key or data.get("apiKey")
        cookie = cookie or data.get("cookie")
    if not api_key or not cookie:
        raise RuntimeError(
            "Missing Case Center credentials. Set CASE_CENTER_API_KEY and "
            "CASE_CENTER_COOKIE env vars, or copy secrets.local.json.example to "
            "secrets.local.json and fill it in."
        )
    return api_key, cookie


# ---- 2a. Map Case Center status -> the board's status enum ---------------------------
# The board column for a case is its Case Center status. We map on the
# (caseStatus, caseSubstatus) pair first, then fall back to caseStatus alone.
# Board enum values:
#   new | with_fit | with_hq | sanity_check | returned_to_requester | resolved | closed | cancelled
#
# Notes on choices (Case Center is coarser than the board in two places):
#   - "In-Progress Wait User" -> returned_to_requester (waiting on the user; SLA-paused).
#     sanity_check would land in the SAME board column ("Sanity Check / With Requester"),
#     so the column is identical either way — change here if you prefer the green pill.
#   - "Close" -> closed (the board's terminal/closed state; 'resolved' is the same column-less
#     terminal outcome). Change to "resolved" if you want to distinguish them.
#   - "In-Progress" / "Open" -> new (the operator then moves it to with_fit / with_hq).
STATUS_MAP = {
    # (caseStatus, caseSubstatus): board_status
    ("In-Progress", "Return"):    "new",                    # requester returned the case to IT
    ("In-Progress", "Wait User"): "returned_to_requester",  # waiting on the user
}
STATUS_MAP_BY_STATUS = {
    # caseStatus alone (used when the (status, substatus) pair isn't listed above)
    "Open":            "new",
    "In-Progress":     "new",
    "Wait Resolution": "with_hq",
    "Close":           "closed",
    "Drop":            "cancelled",
}


def map_status(case_status, case_substatus):
    if (case_status, case_substatus) in STATUS_MAP:
        return STATUS_MAP[(case_status, case_substatus)]
    if case_status in STATUS_MAP_BY_STATUS:
        return STATUS_MAP_BY_STATUS[case_status]
    return "new"  # safe default so an unmapped case still shows up (in the New column)


def status_label(case_status, case_substatus):
    """Human label shown on the board = caseStatus + caseSubstatus (the real CC status)."""
    return (str(case_status or "") + (" " + str(case_substatus) if case_substatus else "")).strip() or "—"


# ---- 2b. Map caseLevel -> board priority (low | medium | high) ------------------------
LEVEL_MAP = {
    "Normal": "medium",
    "Urgent": "high",
}


def map_priority(case_level):
    return LEVEL_MAP.get(str(case_level), "medium")


# ---- 2c. Map one Case Center record to a board case ----------------------------------
def map_record(r):
    """Translate a single Case Center record (one element of x_json['data']) into a
    board case dict. Field names below match what you provided."""
    reporter = r.get("reporter") or {}
    assignee = r.get("assignee") or {}
    custom = r.get("customField") or {}
    case_id = str(r.get("caseId") or "")
    return {
        "id": case_id,
        "caseLink": build_case_link(case_id),
        "subject": r.get("subject") or "(no subject)",
        "status": map_status(r.get("caseStatus"), r.get("caseSubstatus")),
        # Real Case Center status shown on the board (caseStatus + caseSubstatus), e.g.
        # "In-Progress Wait User". The board uses this for the visible label; `status`
        # above only drives which column the card sits in.
        "ccStatusLabel": status_label(r.get("caseStatus"), r.get("caseSubstatus")),
        "priority": map_priority(r.get("caseLevel")),
        # createDateTime is GMT ISO-8601 with millis/offset (e.g. 2026-06-04T20:57:18.742+00:00);
        # the browser parses it directly and renders it in the viewer's local time.
        "createdAt": r.get("createDateTime"),
        "slaStartedAt": r.get("createDateTime"),
        # People. The board "requester" is the end user the case is about.
        "requester": custom.get("userAccount") or "",
        "requesterDept": custom.get("userDept"),
        "reporterId": reporter.get("accountId"),
        "reporterDept": reporter.get("deptName"),
        "assigneeId": assignee.get("accountId"),
        "assigneeDept": assignee.get("deptName"),
        # Not provided by Case Center in your field list — left at board defaults:
        # caseType, notes.
    }


# ---- 1. Your existing request to Case Center -----------------------------------------
def fetch_raw():
    """PASTE YOUR EXISTING SCRIPT'S REQUEST LOGIC HERE.

    Use api_key + cookie from _load_secrets(), perform the request, parse the JSON into
    `x_json`, and return `x_json["data"]` (the case records). fetch_cases() handles both a
    list of records and a single record.

    LOOK-BACK WINDOW: use the module global LOOKBACK_HOURS in your JQL so the board's
    "Created within … h / Load" control works, e.g.:
        jql = f"created >= -{int(LOOKBACK_HOURS)}h ORDER BY created DESC"
    (You can also accept it as a parameter: def fetch_raw(lookback_hours=6): ... )
    """
    api_key, cookie = _load_secrets()  # noqa: F841 (used by your request below)

    raise NotImplementedError(
        "Add your Case Center request in fetch_raw() (local/casecenter.py), "
        "then `return x_json['data']`."
    )

    # --- Example with stdlib only (no pip install) -----------------------------------
    # import urllib.request
    # req = urllib.request.Request(
    #     "https://case-center.internal/api/cases",
    #     headers={
    #         "Authorization": f"Bearer {api_key}",
    #         "Cookie": cookie,
    #         "Accept": "application/json",
    #     },
    # )
    # with urllib.request.urlopen(req, timeout=30) as resp:
    #     x_json = json.load(resp)
    # return x_json["data"]

    # --- Example if you use requests --------------------------------------------------
    # import requests
    # resp = requests.get(
    #     "https://case-center.internal/api/cases",
    #     headers={"Authorization": f"Bearer {api_key}"},
    #     cookies={"session": cookie},   # or pass the raw Cookie header
    #     timeout=30,
    # )
    # resp.raise_for_status()
    # x_json = resp.json()
    # return x_json["data"]


def fetch_cases(lookback_hours=None, case_id=None):
    """Called by serve.py for GET /api/cases (?hours=N or ?id=XXX). Returns board-shaped dicts.

    `lookback_hours` (Load control) sets the global LOOKBACK_HOURS; `case_id` ("+ New case")
    sets the global CASE_ID. Your fetch_raw() reads those to build its JQL. fetch_raw is also
    called with LOOKBACK_HOURS if it accepts a parameter.
    """
    global LOOKBACK_HOURS, CASE_ID
    if lookback_hours not in (None, ""):
        try:
            LOOKBACK_HOURS = float(lookback_hours)
        except (TypeError, ValueError):
            pass
    CASE_ID = str(case_id).strip() if case_id not in (None, "") else None
    try:
        takes_arg = len(inspect.signature(fetch_raw).parameters) >= 1
    except (TypeError, ValueError):
        takes_arg = False
    data = fetch_raw(LOOKBACK_HOURS) if takes_arg else fetch_raw()
    # Tolerate returning the whole response object: unwrap the list of cases from a
    # common envelope key, so `return x_json` works as well as `return x_json["data"]`.
    if isinstance(data, dict):
        for key in ("data", "items", "records", "cases", "results", "content", "list", "rows"):
            if isinstance(data.get(key), list):
                data = data[key]
                break
    records = data if isinstance(data, list) else [data]
    return [map_record(r) for r in records]
