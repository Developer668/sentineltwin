import pytest
from sentineltwin.local_server import (
    bind_host_from_env,
    decode_request_body,
    parse_content_length,
)


def test_local_server_defaults_to_loopback(monkeypatch):
    monkeypatch.delenv("SENTINEL_HOST", raising=False)
    assert bind_host_from_env() == "127.0.0.1"


def test_local_server_requires_explicit_remote_bind_opt_in(monkeypatch):
    monkeypatch.setenv("SENTINEL_HOST", "0.0.0.0")
    monkeypatch.delenv("SENTINEL_ALLOW_REMOTE_BIND", raising=False)
    with pytest.raises(ValueError, match="SENTINEL_ALLOW_REMOTE_BIND"):
        bind_host_from_env()
    monkeypatch.setenv("SENTINEL_ALLOW_REMOTE_BIND", "true")
    assert bind_host_from_env() == "0.0.0.0"


def test_local_server_rejects_arbitrary_bind_value(monkeypatch):
    monkeypatch.setenv("SENTINEL_HOST", "public.example.com")
    with pytest.raises(ValueError, match="SENTINEL_HOST"):
        bind_host_from_env()


@pytest.mark.parametrize("value", ["-1", "1.5", "nan", "1, 2", "１２"])
def test_local_server_rejects_malformed_content_length(value):
    with pytest.raises(ValueError, match="Content-Length"):
        parse_content_length(value)


def test_local_server_accepts_bounded_integer_content_length():
    assert parse_content_length(None) == 0
    assert parse_content_length(" 42 ") == 42


def test_local_server_rejects_non_utf8_body():
    with pytest.raises(ValueError, match="UTF-8"):
        decode_request_body(b"\xff\xfe")
