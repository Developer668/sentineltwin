"""Tiny stdlib server for running the Lambda API locally without SAM."""

from __future__ import annotations

import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from .app import lambda_handler

MAX_LOCAL_BODY_BYTES = 1_000_000
LOOPBACK_BIND_HOSTS = {"127.0.0.1", "localhost"}


def parse_content_length(value: str | None) -> int:
    raw = (value or "0").strip()
    if not raw.isascii() or not raw.isdigit():
        raise ValueError("Content-Length must be a non-negative integer")
    return int(raw)


def decode_request_body(value: bytes) -> str:
    try:
        return value.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("Request body must be valid UTF-8") from exc


def bind_host_from_env() -> str:
    host = os.getenv("SENTINEL_HOST", "127.0.0.1").strip()
    if host in LOOPBACK_BIND_HOSTS:
        return host
    # Explicit opt-in is required, and Compose publishes the container port only to host loopback.
    if host == "0.0.0.0":  # nosec B104
        if os.getenv("SENTINEL_ALLOW_REMOTE_BIND", "").strip().lower() in {"1", "true", "yes", "on"}:
            return host
        raise ValueError("SENTINEL_HOST=0.0.0.0 requires SENTINEL_ALLOW_REMOTE_BIND=true")
    allowed = ", ".join(sorted(LOOPBACK_BIND_HOSTS))
    raise ValueError(f"SENTINEL_HOST must be one of: {allowed}")


class Handler(BaseHTTPRequestHandler):
    def _handle(self):
        if len(self.path) > 8192:
            self.send_error(414, "Request target is too long")
            return
        parsed = urlsplit(self.path)
        transfer_encoding = self.headers.get("Transfer-Encoding", "").strip().lower()
        if transfer_encoding and transfer_encoding != "identity":
            self.send_error(400, "Transfer-Encoding is not supported")
            return
        length_headers = self.headers.get_all("Content-Length") or []
        if len(length_headers) > 1:
            self.send_error(400, "Multiple Content-Length headers are not allowed")
            return
        try:
            length = parse_content_length(length_headers[0] if length_headers else None)
        except ValueError as exc:
            self.send_error(400, str(exc))
            return
        if length > MAX_LOCAL_BODY_BYTES:
            self.send_error(413, "Request body is too large")
            return
        try:
            body = decode_request_body(self.rfile.read(length)) if length else None
        except ValueError as exc:
            self.send_error(400, str(exc))
            return
        event = {
            "version": "2.0",
            "rawPath": parsed.path,
            "rawQueryString": parsed.query,
            "requestContext": {"http": {"method": self.command}},
            "headers": dict(self.headers),
            "body": body,
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
