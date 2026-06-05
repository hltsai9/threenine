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
import shutil
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(HERE, "cases.store.json")

SENTINEL = "// === LIVE CASES (auto-written by local/serve.py — do NOT commit) ==="


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


def persist_cases(cases, data_js_path):
    """Merge `cases` (list of board-shaped dicts) into the store + data.js.
    Returns (added, updated, total). Writes nothing if nothing changed."""
    store = _load_store()
    by_id = {c.get("id"): c for c in store if c.get("id")}
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
    if added == 0 and updated == 0 and os.path.exists(data_js_path) and os.path.exists(STORE):
        return (0, 0, len(merged_list))

    with open(STORE, "w", encoding="utf-8") as fh:
        json.dump(merged_list, fh, indent=2, ensure_ascii=False)

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
        ts = datetime.now().strftime("%Y%m%d-%H%M%S-") + f"{datetime.now().microsecond // 1000:03d}"
        shutil.copyfile(path, f"{path}.{ts}.bak")

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
