import pytest
from sentineltwin.local_server import bind_host_from_env


def test_local_server_defaults_to_loopback(monkeypatch):
    monkeypatch.delenv("SENTINEL_HOST", raising=False)
    assert bind_host_from_env() == "127.0.0.1"


def test_local_server_allows_explicit_compose_bind(monkeypatch):
    monkeypatch.setenv("SENTINEL_HOST", "0.0.0.0")
    assert bind_host_from_env() == "0.0.0.0"


def test_local_server_rejects_arbitrary_bind_value(monkeypatch):
    monkeypatch.setenv("SENTINEL_HOST", "public.example.com")
    with pytest.raises(ValueError, match="SENTINEL_HOST"):
        bind_host_from_env()
