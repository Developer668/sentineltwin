import boto3
import pytest
from sentineltwin.app import SentinelAPI
from sentineltwin.aws import AWSIntegrations
from sentineltwin.config import Settings, validate_database_url
from sentineltwin.errors import ServiceUnavailable
from sentineltwin.repository import (
    CockroachRepository,
    UnavailableRepository,
    make_repository,
)


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
