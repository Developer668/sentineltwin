"""Runtime configuration for Lambda and local development."""

from __future__ import annotations

import ipaddress
import json
import os
from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def validate_database_url(database_url: str) -> None:
    """Reject database transports that can expose credentials or data in transit."""
    parsed = urlparse(database_url)
    if parsed.scheme not in {"postgres", "postgresql"} or not parsed.hostname:
        raise ValueError("DATABASE_URL must be a PostgreSQL connection URL with a hostname")
    hostname = parsed.hostname.lower()
    try:
        is_loopback = ipaddress.ip_address(hostname).is_loopback
    except ValueError:
        is_loopback = hostname == "localhost"
    ssl_modes = parse_qs(parsed.query, keep_blank_values=True).get("sslmode", [])
    if is_loopback:
        if len(ssl_modes) > 1:
            raise ValueError("DATABASE_URL must specify sslmode at most once")
        return
    if ssl_modes != ["verify-full"]:
        raise ValueError("Non-local DATABASE_URL must set sslmode=verify-full")


@dataclass(frozen=True)
class Settings:
    database_url: str | None
    database_secret_arn: str | None
    database_config_error: str | None
    cors_origin: str
    log_level: str
    demo_mode: bool
    aws_region: str
    db_pool_min_size: int
    db_pool_max_size: int
    bedrock_model_id: str | None
    artifact_bucket: str | None
    artifact_prefix: str
    satellite_prefix: str
    satellite_upload_max_bytes: int
    satellite_import_max_bytes: int
    satellite_upload_expires_seconds: int
    allowed_failover_regions: tuple[str, ...]

    @classmethod
    def from_env(cls) -> Settings:
        database_url = os.getenv("DATABASE_URL") or None
        database_secret_arn = os.getenv("DATABASE_SECRET_ARN") or None
        database_config_error = None
        if not database_url and database_secret_arn:
            try:
                import boto3

                secret = boto3.client("secretsmanager").get_secret_value(SecretId=database_secret_arn)
                payload = json.loads(secret.get("SecretString") or "{}")
                database_url = payload.get("DATABASE_URL") or payload.get("database_url")
                if not database_url:
                    database_config_error = "secret_missing_database_url"
            except Exception:  # noqa: BLE001 - SDK/config failures must degrade without leaking details.
                database_config_error = "secret_lookup_failed"
        demo_mode_value = os.getenv("SENTINEL_DEMO_MODE")
        explicit_demo = _truthy(demo_mode_value)
        zero_setup_demo = demo_mode_value is None and not database_url and not database_secret_arn
        return cls(
            database_url=database_url,
            database_secret_arn=database_secret_arn,
            database_config_error=database_config_error,
            cors_origin=os.getenv("CORS_ORIGIN", "*"),
            log_level=os.getenv("LOG_LEVEL", "INFO").upper(),
            demo_mode=explicit_demo or zero_setup_demo,
            aws_region=os.getenv("AWS_REGION", "us-west-2"),
            db_pool_min_size=max(1, int(os.getenv("DB_POOL_MIN_SIZE", "1"))),
            db_pool_max_size=max(1, int(os.getenv("DB_POOL_MAX_SIZE", "4"))),
            bedrock_model_id=os.getenv("BEDROCK_MODEL_ID") or None,
            artifact_bucket=os.getenv("ARTIFACT_BUCKET") or None,
            artifact_prefix=os.getenv("ARTIFACT_PREFIX", "sentineltwin/simulations").strip("/"),
            satellite_prefix=os.getenv("SATELLITE_PREFIX", "sentineltwin/quarantine").strip("/"),
            satellite_upload_max_bytes=max(1, min(20_000_000, int(os.getenv("SATELLITE_UPLOAD_MAX_BYTES", "5000000")))),
            satellite_import_max_bytes=max(65_536, min(25_000_000, int(os.getenv("SATELLITE_IMPORT_MAX_BYTES", "12000000")))),
            satellite_upload_expires_seconds=max(60, min(3600, int(os.getenv("SATELLITE_UPLOAD_EXPIRES_SECONDS", "900")))),
            allowed_failover_regions=tuple(
                region.strip()
                for region in os.getenv("ALLOWED_FAILOVER_REGIONS", "us-west-2,us-east-1").split(",")
                if region.strip()
            ),
        )
