"""Opt-in end-to-end test against a real CockroachDB deployment."""

from __future__ import annotations

import os
import uuid

import pytest
from sentineltwin.app import SentinelAPI
from sentineltwin.aws import AWSIntegrations
from sentineltwin.config import Settings, validate_database_url
from sentineltwin.repository import make_repository

pytestmark = pytest.mark.skipif(
    os.getenv("SENTINEL_RUN_LIVE_COCKROACH_INTEGRATION") != "true",
    reason="set SENTINEL_RUN_LIVE_COCKROACH_INTEGRATION=true to write two test simulations to DATABASE_URL",
)


def _live_api() -> SentinelAPI:
    database_url = os.getenv("DATABASE_URL")
    assert database_url, "DATABASE_URL is required for the live CockroachDB integration test"
    validate_database_url(database_url)
    settings = Settings.from_env()
    assert settings.demo_mode is False, "set SENTINEL_DEMO_MODE=false for the live integration test"
    repository = make_repository(settings)
    assert repository.mode == "production"
    return SentinelAPI(settings, repository, AWSIntegrations(settings))


def _agent_commander_counters() -> tuple[int, int]:
    import psycopg

    with psycopg.connect(os.environ["DATABASE_URL"]) as connection:
        row = connection.execute(
            "SELECT memory_reads, memory_writes FROM agents WHERE id='agent-commander'"
        ).fetchone()
    assert row is not None
    return int(row[0]), int(row[1])


def _cleanup_test_records(location_id: str | None, resource_ids: set[str], counters: tuple[int, int]) -> None:
    if not location_id:
        return
    import psycopg

    with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as connection:
        connection.execute("DELETE FROM agent_memories WHERE location_id=%s", (location_id,))
        connection.execute("DELETE FROM simulations WHERE location_id=%s", (location_id,))
        connection.execute("DELETE FROM satellite_assessments WHERE location_id=%s", (location_id,))
        for resource_id in resource_ids:
            connection.execute("DELETE FROM audit_events WHERE resource_id=%s", (resource_id,))
        connection.execute("DELETE FROM locations WHERE id=%s", (location_id,))
        connection.execute(
            "UPDATE agents SET memory_reads=%s, memory_writes=%s WHERE id='agent-commander'",
            counters,
        )


def test_live_api_persists_and_recalls_memory_across_api_instances() -> None:
    first_api = _live_api()
    counters = _agent_commander_counters()
    location_id = None
    resource_ids: set[str] = set()

    try:
        health_status, health, _headers = first_api.dispatch("GET", "/api/health", {}, None)
        assert health_status == 200
        assert health["status"] == "healthy"
        assert health["database"] == "connected"
        assert health["data_persistence"] == {"provider": "cockroachdb", "durable": True}

        run_id = uuid.uuid4().hex
        location_status, location, _headers = first_api.dispatch(
            "POST",
            "/api/locations",
            {},
            {
                "name": f"SentinelTwin integration test {run_id}",
                "region": "test-only",
                "latitude": 0,
                "longitude": 0,
                "terrain": "ephemeral integration fixture; deleted after test",
                "population": 0,
                "critical_facilities": 0,
                "fire_risk": 0.5,
                "earthquake_risk": 0.5,
                "combined_risk": 0.5,
                "satellite_source": "integration-test:no-observational-data",
            },
        )
        assert location_status == 201
        location_id = location["id"]
        resource_ids.add(location_id)

        dashboard_status, dashboard, _headers = first_api.dispatch("GET", "/api/dashboard", {}, None)
        assert dashboard_status == 200
        assert any(item["id"] == location_id for item in dashboard["locations"])

        payload = {
            "location_id": location_id,
            "hazard": "fire",
            "parameters": {
                "intensity": 0.82,
                "duration_minutes": 720,
                "cascading_impacts": ["power"],
                "integration_test": True,
            },
            "memory_limit": 8,
        }
        first_status, first_simulation, _headers = first_api.dispatch("POST", "/api/simulations", {}, payload)
        assert first_status == 201
        learned_memory_id = first_simulation["learned_memory"]["id"]
        resource_ids.update({first_simulation["id"], learned_memory_id})
        assert first_simulation["status"] == "completed"
        assert learned_memory_id

        second_api = _live_api()
        second_status, second_simulation, _headers = second_api.dispatch("POST", "/api/simulations", {}, payload)
        assert second_status == 201
        resource_ids.update({second_simulation["id"], second_simulation["learned_memory"]["id"]})
        assert second_simulation["status"] == "completed"
        assert learned_memory_id in second_simulation["memory_context"]["memory_ids"]
    finally:
        _cleanup_test_records(location_id, resource_ids, counters)
