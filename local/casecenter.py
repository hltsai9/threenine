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
    user + userDept (the end user), reporter + reporterDept,
    assignee + assigneeDept, priority (low|medium|high), caseType,
    createdAt / slaStartedAt (ISO-8601 GMT, e.g. "2026-06-04T20:57:18.742+00:00"), notes
The agent layer (queue placement, handover notes, reminders) is LOCAL to the
browser and must NOT come from Case Center — it is merged back automatically.
"""
import inspect
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))

# Case Center stores datetimes in GMT. Some fields come back with an explicit offset
# (createDateTime → "...+00:00"), but others (process timeline / Wait User times) can arrive
# WITHOUT a timezone designator. The browser parses a zone-less ISO string in the VIEWER's local
# timezone, which makes those timelines disagree with createDateTime (parsed as UTC). Normalize
# every datetime we emit to carry an explicit UTC marker so all timelines line up.
_HAS_TZ = re.compile(r"(?:Z|[+-]\d{2}:?\d{2})$")
_ISO_NAIVE = re.compile(r"^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$")


def iso_utc(value):
    """Return `value` with an explicit UTC offset. Zone-less ISO datetimes (Case Center is GMT)
    get a trailing 'Z'; values that already carry a zone — or that we don't recognize — pass
    through unchanged. Non-strings (e.g. None) pass through too."""
    if not isinstance(value, str):
        return value
    text = value.strip()
    if not text or _HAS_TZ.search(text):
        return value
    m = _ISO_NAIVE.match(text)
    return f"{m.group(1)}T{m.group(2)}Z" if m else value

# Case Center query window (hours back) — how far back to look for cases. The board's
# "Created within … h / Load" control sets this per request; this is just the default.
# Use it in your fetch_raw() JQL, e.g.  f"created >= -{int(LOOKBACK_HOURS)}h"
LOOKBACK_HOURS = float(os.environ.get("CASE_CENTER_LOOKBACK_HOURS", "6") or "6")

# Newer bound of the query window (hours ago); 0 = up to now. With LOOKBACK_HOURS (the older
# bound) this forms a created-between band — e.g. cases created between 72h and 60h ago. The
# board's "Created between … h ago" control sets this per request. Use BOTH in fetch_raw(), e.g.
#   jql = f"created >= -{int(LOOKBACK_HOURS)}h" + (f" AND created <= -{int(TO_HOURS)}h" if TO_HOURS else "")
TO_HOURS = 0.0

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
# (caseStatus, sub-transition) pair first, then fall back to caseStatus alone.
# The sub-transition comes from r["subStatus"]["transition"] in the new format.
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
    # (caseStatus, sub-transition): board_status
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
# Refinement layer for ambiguous caseStatus values (e.g. "In-Progress" can mean either
# triage or with the local FIT). The board status here is taken from the LAST item in the
# case's processTimeline: its `processType` tells us which stage the case is currently in.
# Consulted after the (status, substatus) pair and before the caseStatus-alone fallback.
STATUS_MAP_BY_PROCESS_TYPE = {
    "1st  Line":    "new",
    "Service Team": "with_fit",
}


def last_process_type(r):
    """Return the `processType` of the most recent item in r["processTimeline"], or None.

    Recency is decided by the latest `processEndTime` (falling back to `processStartTime`);
    if none of the items carry a timestamp we use the last item in the list. The structure
    is tolerated being missing, null, or the wrong type."""
    items = r.get("processTimeline") if isinstance(r, dict) else None
    if not isinstance(items, list):
        return None
    best = None  # (when_key, process_type)
    for idx, it in enumerate(items):
        if not isinstance(it, dict):
            continue
        pt = it.get("processType")
        when = it.get("processEndTime") or it.get("processStartTime") or ""
        # Pair the timestamp with the index so that items without timestamps are still
        # ordered by their position in the list (a later position wins).
        key = (when or "", idx)
        if best is None or key > best[0]:
            best = (key, pt)
    return best[1] if best else None


def map_status(case_status, case_substatus, last_pt=None):
    """Map a Case Center status into a board status column.

    Lookup order: (caseStatus, sub-transition) pair → last-processType refinement →
    caseStatus alone → fall back to "new" so an unmapped case still shows up."""
    if (case_status, case_substatus) in STATUS_MAP:
        return STATUS_MAP[(case_status, case_substatus)]
    if last_pt and last_pt in STATUS_MAP_BY_PROCESS_TYPE:
        return STATUS_MAP_BY_PROCESS_TYPE[last_pt]
    if case_status in STATUS_MAP_BY_STATUS:
        return STATUS_MAP_BY_STATUS[case_status]
    return "new"


def status_label(case_status, case_substatus):
    """Human label shown on the board = caseStatus + sub-transition (the real CC status)."""
    return (str(case_status or "") + (" " + str(case_substatus) if case_substatus else "")).strip() or "—"


def sub_transition(r):
    """Read the sub-status transition (the new format's replacement for caseSubstatus).

    Case Center now carries the substatus inside an object: r["subStatus"]["transition"].
    Tolerate the object being missing, null, or not a dict — return None in any of those
    cases so callers stay safe."""
    sub = r.get("subStatus") if isinstance(r, dict) else None
    if not isinstance(sub, dict):
        return None
    return sub.get("transition")


# ---- 2b. Map caseLevel -> board priority (low | medium | high) ------------------------
LEVEL_MAP = {
    "Normal": "medium",
    "Urgent": "high",
}


def map_priority(case_level):
    return LEVEL_MAP.get(str(case_level), "medium")


# ---- 2c. Map Case Center's per-stage processing log -> board process timeline --------
# r["processTimeline"] is Case Center's own breakdown of how long the case spent in each
# processing stage. Each raw item carries: processorDeptName, processStartTime, caseStatus,
# processMinutes, subStatus.transition (the new format's substatus), processEndTime,
# processType, processor. We normalize each into the board shape the case detail's "Process
# timeline" component renders, carrying both the raw Case Center status label (ccStatus) and
# the board status it maps to (so each stage can be colored like the board columns).
def map_process_timeline(r):
    out = []
    for it in (r.get("processTimeline") or []):
        if not isinstance(it, dict):
            continue
        it_transition = sub_transition(it)
        out.append({
            "processType": it.get("processType"),
            "processor": it.get("processor"),
            "processorDept": it.get("processorDeptName"),
            "ccStatus": status_label(it.get("caseStatus"), it_transition),
            "status": map_status(it.get("caseStatus"), it_transition),
            "startedAt": iso_utc(it.get("processStartTime")),
            "endedAt": iso_utc(it.get("processEndTime")),
            "minutes": it.get("processMinutes"),
        })
    return out


# ---- 2d. "Wait User" substatus detail -> board waitUser block ------------------------
# When the sub-transition is "Wait User" the case is parked on the end user. Case Center carries
# the detail in r["subStatus"]:
#   reason, dueAction, dueDateTime, transition, transitionDateTime, and a lastProcessor object
#   (assignee, handlerType — who last handled it before it was parked).
# We surface it as `waitUser` on the board case, attached only when the case is in Wait User.
def map_wait_user(r):
    sub = r.get("subStatus")
    if not isinstance(sub, dict):
        return None
    lp = sub.get("lastProcessor") if isinstance(sub.get("lastProcessor"), dict) else {}
    return {
        "reason": sub.get("reason"),
        "dueAction": sub.get("dueAction"),
        "dueDateTime": iso_utc(sub.get("dueDateTime")),
        "transition": sub.get("transition"),
        "transitionDateTime": iso_utc(sub.get("transitionDateTime")),
        "lastProcessor": {
            "assignee": lp.get("assignee"),
            "handlerType": lp.get("handlerType"),
        },
    }


# ---- 2e. Resolve a processor id (reporter / assignee) -> dept name --------------------
# The new Case Center payload no longer carries a department on the reporter / assignee
# objects directly. The processTimeline is the authoritative source: each item has
# `processor` (the account id) and `processorDeptName`. We pick the most recent timeline
# entry whose processor matches the id we're resolving.
def dept_from_timeline(r, account_id):
    if not account_id:
        return None
    items = r.get("processTimeline") if isinstance(r, dict) else None
    if not isinstance(items, list):
        return None
    match = None
    for it in items:
        if not isinstance(it, dict):
            continue
        if it.get("processor") != account_id:
            continue
        dept = it.get("processorDeptName")
        if not dept:
            continue
        # Prefer the latest matching entry by processEndTime / processStartTime if available.
        when = it.get("processEndTime") or it.get("processStartTime") or ""
        if match is None or when > (match[0] or ""):
            match = (when, dept)
    return match[1] if match else None


# ---- 2f. Map one Case Center record to a board case ----------------------------------
def map_record(r):
    """Translate a single Case Center record (one element of x_json['data']) into a
    board case dict. Field names below match the current Case Center JSON shape."""
    case_id = str(r.get("caseId") or "")
    transition = sub_transition(r)
    # The last processTimeline item's processType refines an ambiguous caseStatus —
    # e.g. "In-Progress" alone can mean either triage or with the local FIT, but the
    # last stage's processType ("1st  Line" vs "Service Team") disambiguates.
    last_pt = last_process_type(r)
    # The end user the case is about. Case Center now carries this at the top level as
    # userAccount + userName (e.g. "alice.park" + "Alice Park"); we show both when present.
    user_account = r.get("userAccount") or ""
    user_name = r.get("userName") or ""
    user_display = " ".join(p for p in (str(user_account), str(user_name)) if p).strip()
    # Reporter / assignee are now plain account ids at the top level (no nested object,
    # no department); the dept is derived from processTimeline below.
    reporter_id = r.get("reporter") or ""
    assignee_id = r.get("assignee") or ""
    case = {
        "id": case_id,
        "caseLink": build_case_link(case_id),
        "subject": r.get("subject") or "(no subject)",
        "status": map_status(r.get("caseStatus"), transition, last_pt),
        # Real Case Center status shown on the board (caseStatus + sub-transition), e.g.
        # "In-Progress Wait User". The board uses this for the visible label; `status`
        # above only drives which column the card sits in.
        "ccStatusLabel": status_label(r.get("caseStatus"), transition),
        "priority": map_priority(r.get("caseLevel")),
        # createDateTime is GMT ISO-8601 with millis/offset (e.g. 2026-06-04T20:57:18.742+00:00);
        # the browser parses it directly and renders it in the viewer's local time.
        "createdAt": iso_utc(r.get("createDateTime")),
        "slaStartedAt": iso_utc(r.get("createDateTime")),
        # People. The board "user" is the end user the case is about.
        "user": user_display,
        "userDept": r.get("userDept"),
        "reporter": reporter_id,
        "reporterDept": dept_from_timeline(r, reporter_id),
        "assignee": assignee_id,
        "assigneeDept": dept_from_timeline(r, assignee_id),
        # Case Center's per-stage processing log -> the board "Process timeline" component.
        "processTimeline": map_process_timeline(r),
        # Not provided by Case Center in your field list — left at board defaults:
        # caseType, notes.
    }
    # When the case is parked on the end user ("Wait User" sub-transition), attach the
    # subStatus detail (reason / due action + date / last processor / transition).
    if transition == "Wait User":
        wu = map_wait_user(r)
        if wu is not None:
            case["waitUser"] = wu
    return case


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


def fetch_cases(lookback_hours=None, case_id=None, to_hours=None):
    """Called by serve.py for GET /api/cases (?hours=N, ?fromHours=&toHours=, or ?id=XXX).
    Returns board-shaped dicts.

    `lookback_hours` (older bound) sets the global LOOKBACK_HOURS; `to_hours` (newer bound) sets
    the global TO_HOURS — together they form a created-between window. `case_id` ("+ New case")
    sets the global CASE_ID. Your fetch_raw() reads those to build its JQL. fetch_raw is also
    called with LOOKBACK_HOURS if it accepts a parameter.
    """
    global LOOKBACK_HOURS, TO_HOURS, CASE_ID
    if lookback_hours not in (None, ""):
        try:
            LOOKBACK_HOURS = float(lookback_hours)
        except (TypeError, ValueError):
            pass
    # Reset the newer bound each call (absent → 0 = up to now), so a band query doesn't linger.
    TO_HOURS = 0.0
    if to_hours not in (None, ""):
        try:
            TO_HOURS = float(to_hours)
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
