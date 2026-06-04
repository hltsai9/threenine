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

# Import the adapter that talks to your on-prem Case Center.
sys.path.insert(0, HERE)
import casecenter  # noqa: E402


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEBROOT, **kwargs)

    def do_GET(self):  # noqa: N802 (http.server naming)
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

    def _serve_cases(self):
        try:
            cases = casecenter.fetch_cases()
            with_id = sum(1 for c in cases if c.get("id"))
            print(f"/api/cases -> {len(cases)} case(s) mapped ({with_id} with an id)")
            payload = json.dumps({"cases": cases}).encode("utf-8")
            status = 200
        except Exception as exc:  # surface the error to the browser console, keep server up
            traceback.print_exc()
            payload = json.dumps({"error": str(exc)}).encode("utf-8")
            status = 500
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

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
