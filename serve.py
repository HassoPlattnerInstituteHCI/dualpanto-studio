#!/usr/bin/env python3
"""Kleiner Entwicklungs-Server für das DualPanto Studio.

Wie `python3 -m http.server`, aber ohne Caching: der Browser holt jede Datei neu.
Sonst liefert Chrome nach einer Änderung gern noch die alte Version aus dem Cache.

    python3 serve.py          # http://localhost:8000
    python3 serve.py 8080     # anderer Port
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

    def log_message(self, fmt, *args):  # etwas ruhigere Ausgabe
        if "404" in (fmt % args):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), NoCacheHandler) as httpd:
        url = f"http://localhost:{PORT}/"
        print(f"DualPanto Studio läuft auf {url}  (Strg+C beendet)")
        try:
            webbrowser.open(url)
        except Exception:
            pass
        httpd.serve_forever()
