"""
Persist live Case Center cases into frontend/data.js.

Called by serve.py after each successful /api/cases fetch (unless disabled with the env var
CASE_TRACKER_WRITE_DATA_JS=0). It:
  - merges the fetched cases into a JSON store (local/cases.store.json) by case id —
    updating cases that already exist and adding new ones;
  - backs up data.js (the pristine original once as data.js.orig, and the previous version
    as data.js.bak on every write);
  - rewrites ONLY the window.CASES block in data.js from the merged set, leaving NOW /
    THRESHOLDS / OWNERS / WEEKS untouched, and marks it window.CASES_LIVE_CAPTURE = true so
    the board shows the real timestamps without shifting them.

PRIVACY: the rewritten data.js contains real Case Center data. data.js is a tracked file
that also deploys to public GitHub Pages — do NOT commit or push it. The backups and the
store are gitignored. Consider:  git update-index --skip-worktree frontend/data.js

SAFE BY DEFAULT: writing the live capture into the committed frontend/data.js is gated on
CASE_TRACKER_ALLOW_DATA_JS_OVERWRITE=1. Without it, _write_data_js() refuses to touch data.js
(it logs how to enable the overwrite and keeps the gitignored sidecar store up to date), so a
live fetch can't silently publish real Case Center PII to GitHub Pages.
"""
import json
import logging
import os
import re
import shutil
from datetime import datetime

logger = logging.getLogger("case_tracker.persist")

HERE = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(HERE, "cases.store.json")


def _data_js_overwrite_allowed():
    """Whether persist.py may overwrite the committed, Pages-deployed frontend/data.js with
    a LIVE capture. Default is False (SAFE): data.js is the public demo seed, so overwriting
    it risks pushing real Case Center PII to GitHub Pages. Opt in per-process with
    CASE_TRACKER_ALLOW_DATA_JS_OVERWRITE=1 (and remember: do NOT commit a live capture)."""
    return os.environ.get("CASE_TRACKER_ALLOW_DATA_JS_OVERWRITE", "") not in ("", "0", "false", "False")

# Fields Case Center authoritatively owns. When persisting a LIVE fetch, only these are
# refreshed onto a case that already exists; everything else (board status, FIT/HQ routing,
# history, notes, clocks, queue/handover/reminder) is operator-local and is preserved — so a
# /api/cases refresh never resets a case you've assigned/moved back to its raw CC status.
# Must stay in sync with CC_OWNED_FIELDS in frontend/app.js.
CC_OWNED_FIELDS = (
    "subject", "ccStatusLabel", "priority", "caseLink", "status",
    "user", "userDept", "reporter", "reporterDept", "assignee", "assigneeDept",
)

SENTINEL = "// === LIVE CASES (auto-written by local/serve.py — do NOT commit) ==="

# Files the Owners / Shift editors may save to, with a short header for each.
EDITOR_FILES = {
    "shifts": ("shifts.js", "// Shift & operator roster — saved from the in-app Shift editor.\n"),
    "owners": ("owners.js", "// Owner directory (Local FIT desks & HQ Product Teams) — saved from the in-app Owners editor.\n"),
}


def _timestamp():
    now = datetime.now()
    return now.strftime("%Y%m%d-%H%M%S-") + f"{now.microsecond // 1000:03d}"


def write_js_file(webroot, name, snippet):
    """Write a generated snippet to shifts.js / owners.js (with backups). Returns the path."""
    if name not in EDITOR_FILES:
        raise ValueError(f"unknown editor file: {name!r}")
    fname, header = EDITOR_FILES[name]
    path = os.path.join(webroot, fname)
    if os.path.exists(path):
        if not os.path.exists(path + ".orig"):
            shutil.copyfile(path, path + ".orig")
        shutil.copyfile(path, f"{path}.{_timestamp()}.bak")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(header + (snippet or "").rstrip() + "\n")
    return path


def _load_store():
    if os.path.exists(STORE):
        try:
            with open(STORE, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            if isinstance(data, list):
                return data
        except Exception:
            pass
    return []


def _read_data_js_cases(path):
    """Parse the existing window.CASES array out of data.js (JSON, as we write it).
    Returns a list, or None if data.js doesn't exist / isn't parseable (e.g. the original
    hand-authored seed with JS-literal object syntax)."""
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            text = fh.read()
        m = re.search(r"window\.CASES\s*=\s*(\[.*\])\s*;", text, re.DOTALL)
        if not m:
            return None
        data = json.loads(m.group(1))
        return data if isinstance(data, list) else None
    except Exception:
        return None


def persist_cases(cases, data_js_path, source="live", purge_ids=()):
    """Merge `cases` (list of board-shaped dicts) into data.js, KEEPING cases already there.
    Append new, update existing (by id), and never drop old cases that weren't in this query.
    Returns (added, updated, total). Writes nothing if nothing changed.

    source="live"     — cases came from a Case Center fetch (/api/cases): for a case that
                        already exists, only CC-owned fields are refreshed; operator work
                        (status, routing, history, notes, clocks, agent layer) is preserved.
    source="operator" — cases are operator edits (/api/save): they are authoritative and
                        fully overwrite the stored case.
    purge_ids         — case ids to permanently remove from data.js (recycle bin "delete
                        forever" / 7-day auto-purge).
    Brand-new cases (not seen before) are taken in full either way."""
    # Baseline = whatever is already in data.js (the file we maintain) unioned with the
    # sidecar store, so old cases are preserved even if the store was cleared.
    by_id = {}
    for c in _load_store():
        if c.get("id"):
            by_id[c["id"]] = c
    existing = _read_data_js_cases(data_js_path)
    if existing is not None:
        for c in existing:                 # data.js wins over the store for shared ids
            if c.get("id"):
                by_id[c["id"]] = c

    added = updated = 0
    for c in cases:
        cid = c.get("id")
        if not cid:
            continue
        if cid in by_id:
            if source == "operator":
                merged = {**by_id[cid], **c}   # operator edits are authoritative
            else:
                # live Case Center record — refresh only CC-owned fields, preserve operator work
                overlay = {k: c[k] for k in CC_OWNED_FIELDS if k in c}
                merged = {**by_id[cid], **overlay}
            if merged != by_id[cid]:
                updated += 1
            by_id[cid] = merged
        else:
            by_id[cid] = c                     # brand-new case → take the full record
            added += 1

    # Recycle bin: permanently drop any cases the operator purged.
    for cid in (purge_ids or ()):
        if by_id.pop(cid, None) is not None:
            updated += 1

    merged_list = list(by_id.values())

    # Keep the sidecar store in sync (gitignored mirror used as a fallback baseline).
    try:
        with open(STORE, "w", encoding="utf-8") as fh:
            json.dump(merged_list, fh, indent=2, ensure_ascii=False)
    except Exception:
        pass

    # Write data.js only when its actual content would change (compare by id, order-agnostic),
    # so it's not skipped just because the in-memory counts were 0 while data.js is out of date.
    current = _read_data_js_cases(data_js_path)
    same = current is not None and \
        {c.get("id"): c for c in current} == {c.get("id"): c for c in merged_list}
    if same:
        return (added, updated, len(merged_list))

    _write_data_js(data_js_path, merged_list)
    return (added, updated, len(merged_list))


def _case_center_base_url():
    """The resolved Case Center base URL, to expose to the browser. Prefer casecenter.BASE_URL
    (which already folds in the CASE_CENTER_BASE_URL env var and any in-file override); fall back
    to the env var directly if casecenter can't be imported in this context."""
    try:
        import casecenter
        return getattr(casecenter, "BASE_URL", "") or ""
    except Exception:
        return os.environ.get("CASE_CENTER_BASE_URL", "") or ""


def _write_data_js(path, cases):
    # SAFETY GUARD: frontend/data.js is the committed demo seed that also deploys to PUBLIC
    # GitHub Pages. Refuse to overwrite it with a live capture unless explicitly opted in, so
    # real Case Center PII can't reach Pages by default. The gitignored sidecar store
    # (cases.store.json) is still kept up to date by persist_cases() regardless.
    if not _data_js_overwrite_allowed():
        logger.warning(
            "Skipping data.js write: %s is the committed/public demo seed. To capture live "
            "cases into it, set CASE_TRACKER_ALLOW_DATA_JS_OVERWRITE=1 — but then do NOT "
            "commit or push data.js (it would publish real Case Center data to GitHub Pages).",
            os.path.basename(path),
        )
        return

    text = ""
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as fh:
            text = fh.read()
        # pristine original kept once; a timestamped backup of the current file each write
        # (timestamped so refreshes don't overwrite previous backups)
        if not os.path.exists(path + ".orig"):
            shutil.copyfile(path, path + ".orig")
        shutil.copyfile(path, f"{path}.{_timestamp()}.bak")

    # Keep everything before our injected block (or before the original window.CASES = ).
    if SENTINEL in text:
        head = text[: text.index(SENTINEL)]
    elif "window.CASES =" in text:
        head = text[: text.index("window.CASES =")]
    else:
        head = (text.rstrip() + "\n\n") if text else ""

    # Expose the Case Center base URL (not a secret) so the board can rebuild a case's link from
    # its id when caseLink is empty — the page no longer re-fetches on refresh to do it server-side.
    base_url = _case_center_base_url()
    block = (
        SENTINEL + "\n"
        "// Real Case Center data — do NOT commit/push. Original: data.js.orig · previous: data.js.bak\n"
        "window.CASES_LIVE_CAPTURE = true;\n"
        f"window.CASE_CENTER_BASE_URL = {json.dumps(base_url)};\n"
        "window.CASES = " + json.dumps(cases, indent=2, ensure_ascii=False) + ";\n"
    )
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(head + block)
