import importlib.util
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[2] / "scripts" / "load_test.py"
SPEC = importlib.util.spec_from_file_location("sentineltwin_load_test", SCRIPT)
assert SPEC and SPEC.loader
load_test = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = load_test
SPEC.loader.exec_module(load_test)


def test_percentile_uses_nearest_rank():
    assert load_test.percentile([], 0.95) == 0
    assert load_test.percentile([10, 20, 30, 40], 0.50) == 20
    assert load_test.percentile([10, 20, 30, 40], 0.95) == 40


@pytest.mark.parametrize(
    "url",
    [
        "http://api.example.com/api",
        "https://user:password@api.example.com/api",
        "https://api.example.com/api?token=secret",
        "https://api.example.com/prod/../admin",
    ],
)
def test_base_url_rejects_insecure_or_credentialed_targets(url):
    with pytest.raises(ValueError):
        load_test.validate_base_url(url)


def test_base_url_accepts_https_and_loopback_only():
    assert load_test.validate_base_url("https://api.example.com/prod") == "https://api.example.com/prod/api"
    assert load_test.validate_base_url("http://127.0.0.1:8787/api") == "http://127.0.0.1:8787/api"


def test_writes_require_double_opt_in_and_location():
    with pytest.raises(ValueError, match="ALLOW_WRITES"):
        load_test.build_workload(True, False, "loc-1")
    with pytest.raises(ValueError, match="location-id"):
        load_test.build_workload(True, True, None)
    workload = load_test.build_workload(True, True, "loc-1")
    assert sum(method == "POST" for method, _path, _payload in workload) == 1


def test_summary_reports_latency_error_and_status_distributions():
    samples = [
        load_test.Sample("GET", "/health", 200, 10.0, True),
        load_test.Sample("GET", "/dashboard", 200, 20.0, True),
        load_test.Sample("GET", "/dashboard", 503, 30.0, False, "http"),
    ]
    summary = load_test.summarize(samples, elapsed=1.0, concurrency=2)
    assert summary["requests"] == 3
    assert summary["error_rate"] == pytest.approx(1 / 3, abs=1e-6)
    assert summary["latency_ms"] == {"p50": 20.0, "p95": 30.0, "p99": 30.0, "max": 30.0}
    assert summary["statuses"] == {"200": 2, "503": 1}
