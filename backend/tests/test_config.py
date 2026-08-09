import subprocess
from pathlib import Path

import boto3
import pytest
from sentineltwin.app import SentinelAPI
from sentineltwin.aws import AWSIntegrations
from sentineltwin.config import Settings, validate_cors_origin, validate_database_url
from sentineltwin.errors import ServiceUnavailable
from sentineltwin.repository import (
    CockroachRepository,
    UnavailableRepository,
    make_repository,
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def test_env_example_can_be_sourced_by_setup_commands():
    result = subprocess.run(
        [
            "bash",
            "-c",
            "set -a; source .env.example; test \"$VITE_COGNITO_SCOPES\" = 'openid email profile'",
        ],
        cwd=REPOSITORY_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://root@127.0.0.1:26257/sentineltwin?sslmode=disable",
        "postgresql://root@localhost:26257/sentineltwin",
        "postgresql://root@[::1]:26257/sentineltwin?sslmode=disable",
    ],
)
def test_local_database_urls_may_disable_tls(url):
    validate_database_url(url)


@pytest.mark.parametrize("sslmode", ["disable", "allow", "prefer", "require", "verify-ca", ""])
def test_remote_database_urls_require_hostname_verification(sslmode):
    suffix = f"?sslmode={sslmode}" if sslmode else ""
    with pytest.raises(ValueError, match="sslmode=verify-full"):
        validate_database_url(f"postgresql://app:secret@cluster.example.com:26257/sentineltwin{suffix}")


def test_repository_accepts_remote_verify_full(monkeypatch):
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql://app:secret@cluster.example.com:26257/sentineltwin?sslmode=verify-full",
    )
    settings = Settings.from_env()
    repository = CockroachRepository(settings)
    assert repository.mode == "production"


def test_repository_fails_closed_for_remote_insecure_url(monkeypatch):
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql://app:secret@cluster.example.com:26257/sentineltwin?sslmode=disable",
    )
    settings = Settings.from_env()
    with pytest.raises(ValueError, match="sslmode=verify-full"):
        CockroachRepository(settings)


@pytest.mark.parametrize(
    "origin",
    [
        "*",
        "http://dashboard.example.com",
        "https://user:secret@dashboard.example.com",
        "https://dashboard.example.com/path",
        "https://dashboard.example.com?token=secret",
    ],
)
def test_cors_origin_rejects_wildcards_insecure_remote_http_and_non_origins(origin):
    with pytest.raises(ValueError, match="CORS_ORIGIN"):
        validate_cors_origin(origin)


def test_cors_origin_accepts_exact_https_and_loopback_http():
    assert validate_cors_origin("https://dashboard.example.com/") == "https://dashboard.example.com"
    assert validate_cors_origin("http://127.0.0.1:5173") == "http://127.0.0.1:5173"


def test_absent_demo_setting_preserves_zero_setup_local_demo(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("DATABASE_SECRET_ARN", raising=False)
    monkeypatch.delenv("SENTINEL_DEMO_MODE", raising=False)
    settings = Settings.from_env()
    assert settings.demo_mode is True
    assert make_repository(settings).mode == "demo"


def test_explicit_non_demo_without_database_is_fail_closed(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("DATABASE_SECRET_ARN", raising=False)
    monkeypatch.setenv("SENTINEL_DEMO_MODE", "false")
    settings = Settings.from_env()
    repository = make_repository(settings)
    assert isinstance(repository, UnavailableRepository)
    assert repository.health()["status"] == "degraded"
    with pytest.raises(ServiceUnavailable):
        repository.create_memory({"content": "must not be accepted"})


def test_failed_secret_lookup_exposes_generic_degraded_health(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("DATABASE_SECRET_ARN", "arn:aws:secretsmanager:region:account:secret:redacted")
    monkeypatch.setenv("SENTINEL_DEMO_MODE", "false")

    def fail_client(*_args, **_kwargs):
        raise RuntimeError("sensitive provider detail")

    monkeypatch.setattr(boto3, "client", fail_client)
    settings = Settings.from_env()
    repository = make_repository(settings)
    api = SentinelAPI(settings, repository, AWSIntegrations(settings))

    status, health, _headers = api.dispatch("GET", "/api/health", {}, None)
    assert status == 503
    assert health["configuration_status"] == "secret_lookup_failed"
    assert "sensitive" not in str(health).lower()
    with pytest.raises(ServiceUnavailable):
        api.dispatch("POST", "/api/memories", {}, {"content": "must not be stored"})
