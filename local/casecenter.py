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
    caseLink, requester, priority (low|medium|high), caseType,
    createdAt / slaStartedAt (ISO-8601, e.g. "2026-06-05T05:12:00Z"), notes
The agent layer (queue placement, handover notes, reminders) is LOCAL to the
browser and must NOT come from Case Center — it is merged back automatically.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))


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


# ---- 2a. Map Case Center status strings to the board's status enum --------------------
# Fill in the left-hand keys with YOUR Case Center status values.
STATUS_MAP = {
    # "Open":               "new",
    # "Assigned":           "with_fit",
    # "Escalated":          "with_hq",
    # "Pending Validation": "sanity_check",
    # "Awaiting Customer":  "returned_to_requester",
    # "Resolved":           "resolved",
    # "Closed":             "closed",
    # "Cancelled":          "cancelled",
}


def map_status(cc_status):
    return STATUS_MAP.get(cc_status, "new")


# ---- 2b. Map one Case Center record to a board case ----------------------------------
def map_record(r):
    """Translate a single Case Center record (dict) into a board case dict.
    Adjust the r.get(...) keys to match YOUR Case Center field names."""
    return {
        "id": str(r.get("id") or r.get("caseId") or r.get("number") or ""),
        "caseLink": r.get("url") or r.get("link") or "",
        "subject": r.get("subject") or r.get("title") or "(no subject)",
        "requester": r.get("requester") or r.get("reporter") or "",
        "status": map_status(r.get("status")),
        "priority": (r.get("priority") or "medium").lower(),
        "caseType": r.get("type") or "access",
        "slaStartedAt": r.get("createdAt") or r.get("opened_at"),
        "createdAt": r.get("createdAt") or r.get("opened_at"),
        "notes": r.get("description") or r.get("summary") or "",
    }


# ---- 1. Your existing request to Case Center -----------------------------------------
def fetch_raw():
    """PASTE YOUR EXISTING SCRIPT'S REQUEST LOGIC HERE.

    Use api_key + cookie from _load_secrets() and return a LIST of raw record dicts.
    A stdlib (urllib) example is shown commented-out; if your script already uses
    `requests`, just use that instead — whatever you already have working.
    """
    api_key, cookie = _load_secrets()  # noqa: F841 (used by your request below)

    raise NotImplementedError(
        "Add your Case Center request in fetch_raw() (local/casecenter.py)."
    )

    # --- Example with stdlib only (no pip install) -----------------------------------
    # import urllib.request
    # req = urllib.request.Request(
    #     "https://case-center.internal/api/cases?status=open",
    #     headers={
    #         "Authorization": f"Bearer {api_key}",
    #         "Cookie": cookie,
    #         "Accept": "application/json",
    #     },
    # )
    # with urllib.request.urlopen(req, timeout=30) as resp:
    #     body = json.load(resp)
    # return body["items"]            # <- return the list of records

    # --- Example if you use requests --------------------------------------------------
    # import requests
    # resp = requests.get(
    #     "https://case-center.internal/api/cases",
    #     headers={"Authorization": f"Bearer {api_key}"},
    #     cookies={"session": cookie},   # or pass the raw Cookie header
    #     timeout=30,
    # )
    # resp.raise_for_status()
    # return resp.json()["items"]


def fetch_cases():
    """Called by serve.py for GET /api/cases. Returns board-shaped case dicts."""
    return [map_record(r) for r in fetch_raw()]
