#!/usr/bin/env python3
"""Small development server for DualPanto Studio.

Like `python3 -m http.server`, but without caching: the browser fetches every file again.
Otherwise Chrome likes to serve the old version from its cache after a change.

    python3 serve.py          # http://localhost:8000
    python3 serve.py 8080     # different port
"""

import http.server
import socketserver
import sys
import webbrowser

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):  # somewhat quieter output
        if "404" in (fmt % args):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), NoCacheHandler) as httpd:
        url = f"http://localhost:{PORT}/"
        print(f"DualPanto Studio is running at {url}  (Ctrl+C to stop)")
        try:
            webbrowser.open(url)
        except Exception:
            pass
        httpd.serve_forever()
