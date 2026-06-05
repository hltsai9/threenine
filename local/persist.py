"""
Persist live Case Center cases into prototype/data.js.

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
store are gitignored. Consider:  git update-index --skip-worktree prototype/data.js
"""
import json
import os
import re
import shutil
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(HERE, "cases.store.json")

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


def persist_cases(cases, data_js_path):
    """Merge `cases` (list of board-shaped dicts) into data.js, KEEPING cases already there.
    Append new, update existing (by id), and never drop old cases that weren't in this query.
    Returns (added, updated, total). Writes nothing if nothing changed."""
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
            merged = {**by_id[cid], **c}   # update existing fields, keep any extras
            if merged != by_id[cid]:
                updated += 1
            by_id[cid] = merged
        else:
            by_id[cid] = c
            added += 1

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


def _write_data_js(path, cases):
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

    block = (
        SENTINEL + "\n"
        "// Real Case Center data — do NOT commit/push. Original: data.js.orig · previous: data.js.bak\n"
        "window.CASES_LIVE_CAPTURE = true;\n"
        "window.CASES = " + json.dumps(cases, indent=2, ensure_ascii=False) + ";\n"
    )
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(head + block)
