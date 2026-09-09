"""Load the changelog into the DB.

Parses docs/RELEASE_NOTES.md into one row per note (a "### heading" under a "## YYYY-MM-DD"
date) and REPLACES the release_notes table with it — the file is the single source of truth.
The Release notes page's picker then reads these via GET /api/release-notes, so adding release
notes no longer needs a frontend rebundle: edit RELEASE_NOTES.md and re-run this.

    python -m backend.load_release_notes                 # loads docs/RELEASE_NOTES.md
    python -m backend.load_release_notes path/to/NOTES.md # a different file
    python -m backend.load_release_notes --no-create      # assume migrations already ran

Uses DATABASE_URL like the rest of the backend (SQLite demo / Postgres / MySQL). Holds no Case
Center credentials — it only reads a repo markdown file and writes one table.
"""
import argparse
import logging
import os
import re
from datetime import datetime, timezone

from .db import REPO_ROOT, ReleaseNote, SessionLocal, init_db

logger = logging.getLogger("case_tracker.release_notes")

_DATE_RE = re.compile(r"^##\s+(\d{4}-\d{2}-\d{2})\s*$")
_HEAD_RE = re.compile(r"^###\s+(.+?)\s*$")
_RULE_RE = re.compile(r"^-{3,}\s*$")


def parse_release_notes(md: str):
    """Markdown → [{id, date, seq, heading, body}], newest date first (file order). Mirrors
    parseReleaseNotes() in frontend/bundle.mjs so the DB source matches the bundled one."""
    entries = []
    date = None
    cur = None
    n = 0

    def flush():
        nonlocal cur
        if cur is not None:
            cur["body"] = "\n".join(cur.pop("_lines")).strip()
            entries.append(cur)
            cur = None

    for line in md.split("\n"):
        m_date = _DATE_RE.match(line)
        if m_date:
            flush()
            date = m_date.group(1)
            n = 0
            continue
        if _RULE_RE.match(line):
            continue
        m_head = _HEAD_RE.match(line)
        if m_head and date:
            flush()
            cur = {"id": f"{date}::{n}", "date": date, "seq": n, "heading": m_head.group(1), "_lines": []}
            n += 1
            continue
        if cur is not None:
            cur["_lines"].append(line)
    flush()
    return entries


def load_entries(session, entries):
    """Replace the release_notes table with `entries`. Returns the number written."""
    session.query(ReleaseNote).delete()
    now = datetime.now(timezone.utc)
    for e in entries:
        session.add(ReleaseNote(id=e["id"], date=e["date"], seq=e["seq"],
                                heading=e["heading"], body=e["body"], updated_at=now))
    return len(entries)


def load_from_file(path=None, create=True):
    md_path = path or os.path.join(REPO_ROOT, "docs", "RELEASE_NOTES.md")
    with open(md_path, encoding="utf-8") as fh:
        entries = parse_release_notes(fh.read())
    if create:
        init_db()
    with SessionLocal() as session:
        count = load_entries(session, entries)
        session.commit()
    logger.info("release notes: loaded %d entr%s from %s",
                count, "y" if count == 1 else "ies", os.path.relpath(md_path, REPO_ROOT))
    return count


def main(argv=None):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    p = argparse.ArgumentParser(description="Load docs/RELEASE_NOTES.md into the release_notes DB table.")
    p.add_argument("path", nargs="?", default=None, help="Markdown file to load (default docs/RELEASE_NOTES.md).")
    p.add_argument("--no-create", action="store_true", help="Skip create-tables (assume migrations ran).")
    args = p.parse_args(argv)
    load_from_file(args.path, create=not args.no_create)


if __name__ == "__main__":
    main()
