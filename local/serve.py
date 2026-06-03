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
WEBROOT = os.path.normpath(os.path.join(HERE, "..", "prototype"))

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
        super().do_GET()

    def _serve_cases(self):
        try:
            cases = casecenter.fetch_cases()
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
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(os.environ.get("PORT", "8787"))
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Case Tracker (LIVE)  →  http://127.0.0.1:{port}/")
    print(f"Serving static site from: {WEBROOT}")
    print("Data endpoint:            /api/cases   (Ctrl+C to stop)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
