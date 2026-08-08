#!/usr/bin/env python3
"""Bounded, dependency-free HTTP load test for SentinelTwin.

The default workload is read-only. Writes require both --include-writes and
SENTINEL_LOAD_ALLOW_WRITES=true so an operator cannot accidentally fan out
Bedrock/CockroachDB work against a cloud stack.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import ssl
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

READ_WORKLOAD = (
    ("GET", "/health", None),
    ("GET", "/dashboard", None),
    ("GET", "/locations?limit=25", None),
    ("GET", "/memories?limit=5", None),
    ("GET", "/resilience", None),
)


@dataclass(frozen=True)
class Sample:
    method: str
    path: str
    status: int
    latency_ms: float
    ok: bool
    error: str | None = None


def percentile(values: list[float], quantile: float) -> float:
    """Return a nearest-rank percentile without a statistics dependency."""
    if not values:
        return 0.0
    ordered = sorted(values)
    rank = max(1, math.ceil(max(0.0, min(1.0, quantile)) * len(ordered)))
    return ordered[rank - 1]


def validate_base_url(raw: str) -> str:
    candidate = raw.strip().rstrip("/")
    parsed = urlparse(candidate)
    if parsed.username or parsed.password:
        raise ValueError("base URL must not contain credentials")
    loopback = (parsed.hostname or "").lower() in {"localhost", "127.0.0.1", "::1"}
    if parsed.scheme != "https" and not (parsed.scheme == "http" and loopback):
        raise ValueError("base URL must use HTTPS; loopback HTTP is allowed for local tests")
    if not parsed.hostname or parsed.query or parsed.fragment:
        raise ValueError("base URL must be an origin with an optional API stage path")
    if ".." in parsed.path or "\\" in parsed.path:
        raise ValueError("base URL contains an unsafe path")
    return candidate if candidate.endswith("/api") else f"{candidate}/api"


def build_workload(include_writes: bool, writes_allowed: bool, location_id: str | None) -> tuple[tuple[str, str, dict[str, Any] | None], ...]:
    if not include_writes:
        return READ_WORKLOAD
    if not writes_allowed:
        raise ValueError("write load requires SENTINEL_LOAD_ALLOW_WRITES=true")
    if not location_id:
        raise ValueError("write load requires --location-id")
    write = (
        "POST",
        "/simulations",
        {
            "location_id": location_id,
            "hazard": "fire",
            "parameters": {"intensity": 0.62, "duration_hours": 6, "use_memory": True},
        },
    )
    # One write slot among five reads keeps the model/database pressure bounded.
    return (*READ_WORKLOAD, write)


def request_once(
    base_url: str,
    workload: tuple[tuple[str, str, dict[str, Any] | None], ...],
    token: str | None,
    timeout: float,
    rng: random.Random,
) -> Sample:
    method, path, payload = rng.choice(workload)
    body = json.dumps(payload, separators=(",", ":")).encode() if payload is not None else None
    headers = {"Accept": "application/json", "User-Agent": "SentinelTwinLoadTest/1.0"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    started = time.perf_counter()
    status = 0
    try:
        # validate_base_url permits only HTTPS or loopback HTTP before this request is created.
        with urlopen(  # nosec B310
            Request(f"{base_url}{path}", data=body, headers=headers, method=method),
            timeout=timeout,
            context=ssl.create_default_context(),
        ) as response:
            status = int(response.status)
            response.read(1_000_001)
        ok = 200 <= status < 300
        return Sample(method, path, status, (time.perf_counter() - started) * 1000, ok, None if ok else "http")
    except HTTPError as exc:
        status = int(exc.code)
        exc.read(64_000)
        return Sample(method, path, status, (time.perf_counter() - started) * 1000, False, "http")
    except (TimeoutError, URLError, OSError) as exc:
        return Sample(method, path, status, (time.perf_counter() - started) * 1000, False, type(exc).__name__)


def run_load(
    base_url: str,
    workload: tuple[tuple[str, str, dict[str, Any] | None], ...],
    *,
    concurrency: int,
    duration: float,
    timeout: float,
    token: str | None,
) -> tuple[list[Sample], float]:
    started = time.perf_counter()
    deadline = started + duration

    def worker(index: int) -> list[Sample]:
        samples: list[Sample] = []
        # Deterministic route selection keeps load comparisons reproducible; it is not security randomness.
        rng = random.Random(7_919 + index)  # nosec B311
        while time.perf_counter() < deadline:
            samples.append(request_once(base_url, workload, token, timeout, rng))
        return samples

    with ThreadPoolExecutor(max_workers=concurrency, thread_name_prefix="sentineltwin-load") as pool:
        batches = list(pool.map(worker, range(concurrency)))
    elapsed = max(0.001, time.perf_counter() - started)
    return [sample for batch in batches for sample in batch], elapsed


def summarize(samples: list[Sample], elapsed: float, concurrency: int) -> dict[str, Any]:
    latencies = [sample.latency_ms for sample in samples]
    failures = sum(not sample.ok for sample in samples)
    status_counts = Counter(str(sample.status or sample.error or "unknown") for sample in samples)
    route_counts = Counter(f"{sample.method} {sample.path.split('?', 1)[0]}" for sample in samples)
    return {
        "requests": len(samples),
        "successful": len(samples) - failures,
        "failed": failures,
        "error_rate": round(failures / max(1, len(samples)), 6),
        "elapsed_seconds": round(elapsed, 3),
        "requests_per_second": round(len(samples) / elapsed, 2),
        "concurrency": concurrency,
        "latency_ms": {
            "p50": round(percentile(latencies, 0.50), 2),
            "p95": round(percentile(latencies, 0.95), 2),
            "p99": round(percentile(latencies, 0.99), 2),
            "max": round(max(latencies, default=0.0), 2),
        },
        "statuses": dict(sorted(status_counts.items())),
        "routes": dict(sorted(route_counts.items())),
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a bounded SentinelTwin HTTP load test")
    parser.add_argument("--base-url", default=os.getenv("API_BASE_URL", "http://127.0.0.1:8787/api"))
    parser.add_argument("--duration", type=float, default=15.0)
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument("--max-error-rate", type=float, default=0.01)
    parser.add_argument("--max-p95-ms", type=float, default=2_500.0)
    parser.add_argument("--include-writes", action="store_true")
    parser.add_argument("--location-id")
    parser.add_argument("--token-stdin", action="store_true", help="Read a bearer token from stdin without exposing it in process arguments")
    parser.add_argument("--json-out", type=Path)
    args = parser.parse_args(argv)
    if not 0.5 <= args.duration <= 900:
        parser.error("--duration must be between 0.5 and 900 seconds")
    if not 1 <= args.concurrency <= 500:
        parser.error("--concurrency must be between 1 and 500")
    if not 0.1 <= args.timeout <= 120:
        parser.error("--timeout must be between 0.1 and 120 seconds")
    if not 0 <= args.max_error_rate <= 1:
        parser.error("--max-error-rate must be between 0 and 1")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        base_url = validate_base_url(args.base_url)
        workload = build_workload(
            args.include_writes,
            os.getenv("SENTINEL_LOAD_ALLOW_WRITES", "").lower() == "true",
            args.location_id,
        )
    except ValueError as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2
    token = sys.stdin.readline().strip() if args.token_stdin else os.getenv("SENTINEL_LOAD_TOKEN")
    token = token or None
    samples, elapsed = run_load(
        base_url,
        workload,
        concurrency=args.concurrency,
        duration=args.duration,
        timeout=args.timeout,
        token=token,
    )
    result = summarize(samples, elapsed, args.concurrency)
    print(json.dumps(result, indent=2, sort_keys=True))
    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    failed = result["error_rate"] > args.max_error_rate or result["latency_ms"]["p95"] > args.max_p95_ms
    if not samples:
        return 1
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
