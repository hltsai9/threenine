#!/usr/bin/env python3
"""
Local launcher for the Case Tracker board with LIVE Case Center data.

What it does
------------
- Serves the existing static site (../prototype) at http://127.0.0.1:<PORT>/
- Exposes GET /api/cases, which runs your Case Center fetch (see casecenter.py)
  and returns the cases as JSON. The page calls this on every refresh, so the
  board always shows the latest data.

Because the page and the API are served from the SAME origin, there are no CORS
problems, and your API key + cookie never leave this Python process (they are
read from env vars or local/secrets.local.json, which is gitignored).

Run
---
    # one-time: put your credentials somewhere this process can read them
    cp local/secrets.local.json.example local/secrets.local.json   # then edit it
    # or:  export CASE_CENTER_API_KEY=...   CASE_CENTER_COOKIE=...

    python3 local/serve.py            # then open http://127.0.0.1:8787/

Stdlib only — nothing to pip install.
"""
import json
import os
import sys
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))


def resolve_webroot():
    """Find the folder that holds the board's index.html. Tries (in order): the
    CASE_TRACKER_WEBROOT env var, a path given as the first CLI arg, ../prototype next to
    this script, ./prototype under the current dir, and the current dir itself."""
    candidates = []
    if os.environ.get("CASE_TRACKER_WEBROOT"):
        candidates.append(os.environ["CASE_TRACKER_WEBROOT"])
    if len(sys.argv) > 1:
        candidates.append(sys.argv[1])
    candidates += [
        os.path.normpath(os.path.join(HERE, "..", "prototype")),
        os.path.join(os.getcwd(), "prototype"),
        os.getcwd(),
    ]
    for c in candidates:
        if c and os.path.isfile(os.path.join(c, "index.html")):
            return os.path.abspath(c), True
    # Nothing found — fall back to the conventional path so the error is concrete.
    return os.path.normpath(os.path.join(HERE, "..", "prototype")), False


WEBROOT, WEBROOT_OK = resolve_webroot()

# Write fetched live cases into prototype/data.js (backup + merge). On by default; set
# CASE_TRACKER_WRITE_DATA_JS=0 to disable.
WRITE_DATA_JS = os.environ.get("CASE_TRACKER_WRITE_DATA_JS", "1") not in ("0", "false", "False", "")

# Import the adapter that talks to your on-prem Case Center.
sys.path.insert(0, HERE)
import casecenter  # noqa: E402
import persist     # noqa: E402


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEBROOT, **kwargs)

    def do_GET(self):  # noqa: N802 (http.server naming)
        try:
            path = self.path.split("?", 1)[0].rstrip("/")
            if path == "/api/cases":
                self._serve_cases()
                return
            # Friendly message instead of a bare 404 when the board files aren't found.
            if not WEBROOT_OK and path in ("", "/index.html"):
                msg = (
                    "Case Tracker board files not found.\n\n"
                    "serve.py looked for index.html in:\n  " + WEBROOT + "\n\n"
                    "Fix it one of these ways:\n"
                    "  - run serve.py from inside the cloned repo (so ../prototype exists), or\n"
                    "  - point it at the prototype folder:\n"
                    "      CASE_TRACKER_WEBROOT=/path/to/prototype python3 serve.py\n"
                    "      (or:  python3 serve.py /path/to/prototype)\n\n"
                    "The data feed still works: /api/cases\n"
                ).encode("utf-8")
                self.send_response(404)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(msg)))
                self.end_headers()
                self.wfile.write(msg)
                return
            # Never let the browser reuse a cached/304 copy of the board files while developing.
            for h in ("If-Modified-Since", "If-None-Match"):
                if h in self.headers:
                    del self.headers[h]
            super().do_GET()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            # The browser closed the connection before we finished writing (reload, navigate
            # away, or the page's fetch timed out). Harmless — don't dump a traceback.
            print("  (client closed the connection before the response finished — ignored)")

    def _serve_cases(self):
        cases = None
        try:
            q = parse_qs(urlparse(self.path).query)
            hours = q.get("hours", [None])[0]
            case_id = q.get("id", [None])[0]
            cases = casecenter.fetch_cases(lookback_hours=hours, case_id=case_id)
            with_id = sum(1 for c in cases if c.get("id"))
            scope = f"id={case_id}" if case_id else f"within {hours or 'default'}h"
            print(f"/api/cases ({scope}) -> {len(cases)} case(s) mapped ({with_id} with an id)")
            payload = json.dumps({"cases": cases}).encode("utf-8")
            status = 200
        except Exception as exc:  # surface the error to the browser console, keep server up
            traceback.print_exc()
            payload = json.dumps({"error": str(exc)}).encode("utf-8")
            status = 500

        # Send the response BEFORE writing data.js, so the (slow, backup-writing) persist step
        # can't delay delivery or interrupt the response if the client is impatient.
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            print("  (client closed before the response finished — cases still persisted below)")

        # Persist after responding (best-effort), even if the client already disconnected.
        # source="live": refresh only CC-owned fields on existing cases, preserve operator work.
        if status == 200 and WRITE_DATA_JS and cases is not None:
            try:
                added, updated, total = persist.persist_cases(cases, os.path.join(WEBROOT, "data.js"), source="live")
                if added or updated:
                    print(f"  data.js updated: +{added} new, {updated} updated, {total} total (backup: data.js.bak)")
            except Exception:
                print("  (could not write data.js)")
                traceback.print_exc()

    def do_POST(self):  # noqa: N802
        # POST /api/save       body {"cases":[...]}      — persist operator edits into data.js
        # POST /api/save-file  body {"file":"shifts"|"owners","js":"..."} — write shifts/owners.js
        try:
            path = self.path.split("?", 1)[0].rstrip("/")
            length = int(self.headers.get("Content-Length", "0") or "0")
            body = self.rfile.read(length) if length else b""
            data = json.loads(body.decode("utf-8")) if body else {}
            result = {"ok": True}

            if path == "/api/save":
                cases = data.get("cases") if isinstance(data, dict) and "cases" in data else data
                if isinstance(cases, dict):
                    cases = [cases]
                if not isinstance(cases, list):
                    cases = []
                purge_ids = data.get("purgeIds") if isinstance(data, dict) else None
                purge_ids = [i for i in purge_ids if i] if isinstance(purge_ids, list) else []
                added = updated = 0
                if WRITE_DATA_JS and (cases or purge_ids):
                    # source="operator": these edits are authoritative and fully overwrite.
                    added, updated, total = persist.persist_cases(
                        cases, os.path.join(WEBROOT, "data.js"), source="operator", purge_ids=purge_ids)
                    if added or updated:
                        print(f"  data.js saved from operator edit: +{added} new, {updated} updated, {total} total"
                              + (f" ({len(purge_ids)} purged)" if purge_ids else ""))
                result = {"ok": True, "added": added, "updated": updated}
            elif path == "/api/save-file":
                fpath = persist.write_js_file(WEBROOT, data.get("file"), data.get("js", ""))
                print(f"  wrote {os.path.basename(fpath)} from the in-app editor")
                result = {"ok": True, "file": os.path.basename(fpath)}
            else:
                self.send_error(404, "Not found")
                return

            payload = json.dumps(result).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass
        except Exception as exc:
            traceback.print_exc()
            try:
                msg = json.dumps({"ok": False, "error": str(exc)}).encode("utf-8")
                self.send_response(500)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(msg)))
                self.end_headers()
                self.wfile.write(msg)
            except Exception:
                pass

    def end_headers(self):
        # Never let the browser cache the app or the data while developing locally.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def main():
    port = int(os.environ.get("PORT", "8787"))
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("=" * 60)
    print(f"  Open the BOARD here:  http://127.0.0.1:{port}/")
    print(f"  (raw data feed only:  http://127.0.0.1:{port}/api/cases )")
    print("=" * 60)
    if WEBROOT_OK:
        print(f"Serving board files from: {WEBROOT}")
    else:
        print("!! WARNING: could not find the board's index.html.")
        print(f"!! Looked in: {WEBROOT}")
        print("!! The board (/) will 404. Point serve.py at the prototype folder:")
        print("!!   CASE_TRACKER_WEBROOT=/path/to/prototype python3 serve.py")
        print("!!   (or:  python3 serve.py /path/to/prototype)")
        print("!! The /api/cases data feed still works.")
    print("Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
