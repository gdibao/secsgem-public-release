#!/usr/bin/env python3
"""stdio-to-HTTP bridge (C-1): wraps dxf_worker.py stdin protocol as HTTP POST /run.
R2 contract: worker stdin JSON {operation, options, input_b64} -> stdout JSON; here 1:1.
"""
import json, subprocess, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

WORKER = "/runner/dxf_worker.py"

class H(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/run":
            self.send_response(404); self.end_headers(); return
        n = int(self.headers.get("content-length", 0))
        req = self.rfile.read(n)
        p = subprocess.run([sys.executable, WORKER], input=req,
                           capture_output=True, timeout=180)
        body = p.stdout if p.stdout else p.stderr
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a): pass

HTTPServer(("0.0.0.0", 8100), H).serve_forever()
