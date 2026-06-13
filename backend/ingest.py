"""Ingestion: pull cases into the database.

This is the ONLY component that holds Case Center credentials. In production it
runs as a scheduled Kubernetes CronJob; for local work run it by hand.

    # Real ingest (needs Case Center creds — see local/casecenter.py / secrets)
    python -m backend.ingest --hours 6

    # Demo seed: load prototype/data.js into the DB, no Case Center access needed
    python -m backend.ingest --seed-from-data-js

The real path reuses the existing adapter in local/casecenter.py unchanged: it
fetches + maps Case Center records, and we upsert only Case-Center-owned fields so
operator work is preserved (backend/merge.upsert_cc).
"""
import argparse
import json
import logging
import os
import subprocess
import sys

from .db import SessionLocal, init_db
from .merge import upsert_cc, upsert_operator

logger = logging.getLogger("case_tracker.ingest")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load_casecenter():
    """Import the adapter from local/ (it lives outside this package on purpose: it
    holds the creds + Case Center field mapping you already wrote)."""
    local_dir = os.path.join(REPO_ROOT, "local")
    if local_dir not in sys.path:
        sys.path.insert(0, local_dir)
    import casecenter  # noqa: E402
    return casecenter


def ingest_live(hours=None, to_hours=None, case_id=None):
    cc = _load_casecenter()
    # fetch_cases maps each raw record defensively: one malformed case is logged and skipped
    # (via casecenter.map_records) rather than aborting the whole run. It returns only the
    # cases that mapped cleanly, so a single bad record can't sink the ingest.
    cases = cc.fetch_cases(lookback_hours=hours, to_hours=to_hours, case_id=case_id)
    with SessionLocal() as session:
        added, updated = upsert_cc(session, cases)
        session.commit()
    logger.info("ingest: mapped %d case(s) → +%d new, %d updated", len(cases), added, updated)
    return added, updated


def seed_from_data_js(path=None):
    """Load prototype/data.js CASES into the DB (full payloads). For demos only."""
    data_js = path or os.path.join(REPO_ROOT, "prototype", "data.js")
    extractor = os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed_extract.cjs")
    out = subprocess.run(
        ["node", extractor, data_js], capture_output=True, text=True, check=True
    ).stdout
    cases = json.loads(out)
    with SessionLocal() as session:
        added, updated, _ = upsert_operator(session, cases)
        session.commit()
    logger.info("seed: loaded %d case(s) from %s → +%d new, %d updated",
                len(cases), os.path.relpath(data_js, REPO_ROOT), added, updated)
    return added, updated


def main(argv=None):
    # Run as a CLI/CronJob: configure root logging so ingest progress and the per-record
    # skip warnings (from casecenter.map_records) actually reach the console / pod logs.
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    p = argparse.ArgumentParser(description="Ingest cases into the Case Tracker DB.")
    p.add_argument("--seed-from-data-js", nargs="?", const=True, default=False,
                   metavar="PATH", help="Demo: load prototype/data.js (or PATH) instead of Case Center.")
    p.add_argument("--hours", type=float, default=None, help="Older bound of the Case Center query window (hours ago).")
    p.add_argument("--to-hours", type=float, default=None, help="Newer bound (hours ago); forms a created-between band with --hours.")
    p.add_argument("--id", default=None, help="Fetch a single case id instead of a window.")
    p.add_argument("--no-create", action="store_true", help="Skip create-tables (assume migrations ran).")
    args = p.parse_args(argv)

    if not args.no_create:
        init_db()

    if args.seed_from_data_js:
        path = None if args.seed_from_data_js is True else args.seed_from_data_js
        seed_from_data_js(path)
    else:
        ingest_live(hours=args.hours, to_hours=args.to_hours, case_id=args.id)


if __name__ == "__main__":
    main()
