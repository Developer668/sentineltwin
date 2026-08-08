"""Tiny stdlib server for running the Lambda API locally without SAM."""

from __future__ import annotations

import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from .app import lambda_handler

MAX_LOCAL_BODY_BYTES = 1_000_000
ALLOWED_BIND_HOSTS = {"127.0.0.1", "localhost", "0.0.0.0"}


def bind_host_from_env() -> str:
    host = os.getenv("SENTINEL_HOST", "127.0.0.1").strip()
    if host not in ALLOWED_BIND_HOSTS:
        allowed = ", ".join(sorted(ALLOWED_BIND_HOSTS))
        raise ValueError(f"SENTINEL_HOST must be one of: {allowed}")
    return host


class Handler(BaseHTTPRequestHandler):
    def _handle(self):
        parsed = urlsplit(self.path)
        length = int(self.headers.get("Content-Length", "0"))
        if length > MAX_LOCAL_BODY_BYTES:
            self.send_error(413, "Request body is too large")
            return
        event = {
            "version": "2.0",
            "rawPath": parsed.path,
            "rawQueryString": parsed.query,
            "requestContext": {"http": {"method": self.command}},
            "headers": dict(self.headers),
            "body": self.rfile.read(length).decode() if length else None,
        }
        response = lambda_handler(event, None)
        self.send_response(response["statusCode"])
        for name, value in response["headers"].items():
            self.send_header(name, value)
        self.end_headers()
        if response.get("body"):
            self.wfile.write(response["body"].encode())

    do_GET = do_POST = do_OPTIONS = _handle

    def log_message(self, fmt, *args):
        sys.stderr.write("SentinelTwin API: " + fmt % args + "\n")


def main():
    port = 8787
    host = bind_host_from_env()
    print(f"SentinelTwin API listening on {host}:{port} (health: /api/health)")
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
