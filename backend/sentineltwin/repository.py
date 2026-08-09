"""CockroachDB-backed system of record with a deterministic demo repository."""

from __future__ import annotations

import copy
import json
import logging
import math
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from .config import Settings, validate_database_url
from .errors import NotFound, ServiceUnavailable, ValidationError
from .memory import cosine_similarity, embed_text, vector_literal
from .seed import build_agents, build_locations, build_memories

LOGGER = logging.getLogger(__name__)
UTC = timezone.utc


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _json(value: Any, fallback: Any = None) -> Any:
    if value is None:
        return fallback
    if isinstance(value, (dict, list)):
        return value
    return json.loads(value)


def _serialize_row(row: dict) -> dict:
    result = {}
    for key, value in row.items():
        if isinstance(value, (datetime,)):
            result[key] = value.astimezone(UTC).isoformat().replace("+00:00", "Z")
        elif isinstance(value, uuid.UUID):
            result[key] = str(value)
        else:
            result[key] = value
    return result


class DemoRepository:
    """In-process repository for zero-setup judging and unit tests."""

    mode = "demo"
    provider = "deterministic-in-memory"

    def __init__(self):
        self._lock = threading.RLock()
        self.locations = build_locations()
        self.memories = build_memories()
        self.agents = build_agents()
        self.simulations: list[dict] = []
        self.assessments: list[dict] = []
        self.events: list[dict] = []
        self.active_region = "us-west-2"
        self.failover_count = 0
        self.started_at = now_iso()

    def health(self) -> dict:
        return {
            "status": "healthy",
            "mode": self.mode,
            "provider": self.provider,
            "database": "not configured",
            "data_persistence": "Lambda-container lifetime only",
            "warning": "Demo mode is active. Set DATABASE_URL or DATABASE_SECRET_ARN for persistent CockroachDB memory.",
        }


    def list_locations(self, status: str | None = None, limit: int = 100) -> list[dict]:
        items = self.locations
        if status:
            items = [item for item in items if item["status"] == status]
        return copy.deepcopy(sorted(items, key=lambda item: item["combined_risk"], reverse=True)[:limit])

    def get_location(self, location_id: str) -> dict:
        match = next((item for item in self.locations if item["id"] == location_id), None)
        if not match:
            raise NotFound("location", location_id)
        return copy.deepcopy(match)

    def nearby_locations(self, latitude: float, longitude: float, radius_km: float, limit: int = 25) -> list[dict]:
        def distance(item: dict) -> float:
            lat1, lat2 = math.radians(latitude), math.radians(float(item["latitude"]))
            dlat = lat2 - lat1
            dlon = math.radians(float(item["longitude"]) - longitude)
            value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
            return 6371.0088 * 2 * math.asin(math.sqrt(value))
        items = []
        for location in self.locations:
            distance_km = distance(location)
            if distance_km <= radius_km:
                items.append({**copy.deepcopy(location), "distance_km": round(distance_km, 3)})
        return sorted(items, key=lambda item: item["distance_km"])[:limit]

    def create_location(self, payload: dict) -> dict:
        required = ("name", "latitude", "longitude")
        missing = [key for key in required if payload.get(key) is None]
        if missing:
            raise ValidationError("Missing required location fields", {"missing": missing})
        latitude, longitude = float(payload["latitude"]), float(payload["longitude"])
        if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
            raise ValidationError("latitude or longitude is outside its valid range")
        fire = float(payload.get("fire_risk", 0.5))
        quake = float(payload.get("earthquake_risk", 0.5))
        combined = float(payload.get("combined_risk", max(fire, quake) * 0.72 + min(fire, quake) * 0.28))
        location = {
            "id": f"loc-{uuid.uuid4().hex[:12]}",
            "name": str(payload["name"])[:160],
            "region": str(payload.get("region", "Unassigned"))[:120],
            "latitude": latitude,
            "longitude": longitude,
            "geometry": {"type": "Point", "coordinates": [longitude, latitude]},
            "terrain": str(payload.get("terrain", "unknown terrain"))[:500],
            "vegetation_density": max(0, min(1, float(payload.get("vegetation_density", 0.5)))),
            "soil_amplification": max(0.5, min(2.5, float(payload.get("soil_amplification", 1)))),
            "moisture_percent": max(0, min(100, float(payload.get("moisture_percent", 30)))),
            "wind_speed_mph": max(0, float(payload.get("wind_speed_mph", 10))),
            "slope_degrees": max(0, min(90, float(payload.get("slope_degrees", 5)))),
            "population": max(0, int(payload.get("population", 0))),
            "critical_facilities": max(0, int(payload.get("critical_facilities", 0))),
            "fire_risk": max(0, min(1, fire)),
            "earthquake_risk": max(0, min(1, quake)),
            "combined_risk": max(0, min(1, combined)),
            "risk_trend": "stable",
            "status": "critical" if combined >= 0.85 else "high" if combined >= 0.7 else "guarded",
            "satellite_source": str(payload.get("satellite_source", "manual input"))[:120],
            "updated_at": now_iso(),
        }
        with self._lock:
            self.locations.append(location)
            self.record_event("location.created", "location", location["id"], {"name": location["name"]})
        return copy.deepcopy(location)

    def list_memories(
        self,
        query: str | None = None,
        location_id: str | None = None,
        hazard: str | None = None,
        limit: int = 10,
    ) -> list[dict]:
        items = list(self.memories)
        if location_id:
            items = [item for item in items if item.get("location_id") == location_id]
        if hazard:
            items = [item for item in items if item.get("hazard") in {hazard, "multi_hazard"}]
        if query:
            target = embed_text(query)
            for item in items:
                item["similarity"] = round(cosine_similarity(target, item["embedding"]), 4)
            items.sort(key=lambda item: (item["similarity"], item["importance"]), reverse=True)
        else:
            items.sort(key=lambda item: (item["importance"], item["created_at"]), reverse=True)
        selected = items[:limit]
        if query:
            with self._lock:
                for item in selected:
                    item["access_count"] += 1
                    item["last_accessed_at"] = now_iso()
        result = copy.deepcopy(selected)
        for item in result:
            item.pop("embedding", None)
        return result

    def create_memory(self, payload: dict) -> dict:
        content = str(payload.get("content", "")).strip()
        if not content:
            raise ValidationError("memory content is required")
        location_id = payload.get("location_id")
        location_name = None
        if location_id:
            location_name = self.get_location(str(location_id))["name"]
        hazard = str(payload.get("hazard", "multi_hazard")).replace("-", "_")
        item = {
            "id": f"mem-{uuid.uuid4().hex[:12]}",
            "location_id": location_id,
            "location_name": location_name,
            "simulation_id": payload.get("simulation_id"),
            "agent_id": payload.get("agent_id", "agent-commander"),
            "memory_type": payload.get("memory_type", "observation"),
            "hazard": hazard,
            "title": str(payload.get("title", "Agent observation"))[:200],
            "content": content[:12000],
            "importance": max(0, min(1, float(payload.get("importance", 0.65)))),
            "confidence": max(0, min(1, float(payload.get("confidence", 0.75)))),
            "outcome": payload.get("outcome") or {},
            "metadata": payload.get("metadata") or {},
            "embedding": embed_text(f"{hazard} {payload.get('title', '')} {content}"),
            "created_at": now_iso(),
            "last_accessed_at": now_iso(),
            "access_count": 0,
        }
        with self._lock:
            self.memories.append(item)
            self.record_event("memory.created", "memory", item["id"], {"hazard": hazard})
        result = copy.deepcopy(item)
        result.pop("embedding", None)
        return result

    def get_memory(self, memory_id: str) -> dict:
        item = next((value for value in self.memories if value["id"] == memory_id), None)
        if not item:
            raise NotFound("memory", memory_id)
        result = copy.deepcopy(item)
        result.pop("embedding", None)
        return result

    def memory_stats(self) -> dict:
        by_hazard: dict[str, int] = {}
        by_type: dict[str, int] = {}
        for item in self.memories:
            by_hazard[item["hazard"]] = by_hazard.get(item["hazard"], 0) + 1
            by_type[item["memory_type"]] = by_type.get(item["memory_type"], 0) + 1
        return {
            "total": len(self.memories),
            "by_hazard": by_hazard,
            "by_type": by_type,
            "vector_dimensions": 32,
            "index": "deterministic cosine scan (demo); CockroachDB distributed vector index in production",
        }

    def save_simulation(self, simulation: dict) -> dict:
        item = copy.deepcopy(simulation)
        item.setdefault("id", f"sim-{uuid.uuid4().hex[:12]}")
        with self._lock:
            self.simulations.insert(0, item)
            self.record_event("simulation.completed", "simulation", item["id"], {"hazard": item["hazard"]})
        return copy.deepcopy(item)

    def save_simulation_with_memory(self, simulation: dict, memory_payload: dict) -> tuple[dict, dict]:
        """Commit the simulation and learned memory together in the demo repository."""
        content = str(memory_payload.get("content", "")).strip()
        if not content:
            raise ValidationError("memory content is required")
        with self._lock:
            simulation_id = simulation.setdefault("id", f"sim-{uuid.uuid4().hex[:12]}")
            memory_id = f"mem-{uuid.uuid4().hex[:12]}"
            context = dict(simulation.get("memory_context") or {})
            context.update({"learned_memory_id": memory_id, "loop": "retrieve → simulate → plan → persist outcome"})
            simulation["memory_context"] = context
            item = copy.deepcopy(simulation)
            self.simulations.insert(0, item)

            memory_payload = {**memory_payload, "simulation_id": simulation_id}
            hazard = str(memory_payload.get("hazard", "multi_hazard")).replace("-", "_")
            location_id = memory_payload.get("location_id")
            location_name = self.get_location(str(location_id))["name"] if location_id else None
            memory = {
                "id": memory_id,
                "location_id": location_id,
                "location_name": location_name,
                "simulation_id": simulation_id,
                "agent_id": memory_payload.get("agent_id", "agent-commander"),
                "memory_type": memory_payload.get("memory_type", "simulation_outcome"),
                "hazard": hazard,
                "title": str(memory_payload.get("title", "Simulation outcome"))[:200],
                "content": content[:12000],
                "importance": max(0, min(1, float(memory_payload.get("importance", 0.65)))),
                "confidence": max(0, min(1, float(memory_payload.get("confidence", 0.75)))),
                "outcome": memory_payload.get("outcome") or {},
                "metadata": memory_payload.get("metadata") or {},
                "embedding": embed_text(f"{hazard} {memory_payload.get('title', '')} {content}"),
                "created_at": now_iso(),
                "last_accessed_at": now_iso(),
                "access_count": 0,
            }
            self.memories.append(memory)
            self.record_event("simulation.completed", "simulation", simulation_id, {"hazard": simulation["hazard"]})
            self.record_event("memory.created", "memory", memory_id, {"hazard": hazard, "simulation_id": simulation_id})
            public_memory = copy.deepcopy(memory)
            public_memory.pop("embedding", None)
            return copy.deepcopy(item), public_memory

    def list_assessments(self, location_id: str | None = None, limit: int = 20) -> list[dict]:
        items = self.assessments
        if location_id:
            items = [item for item in items if item["location_id"] == location_id]
        return copy.deepcopy(items[:limit])

    def find_assessment_by_object_key(self, object_key: str) -> dict | None:
        item = next((value for value in self.assessments if value.get("source", {}).get("object_key") == object_key), None)
        return copy.deepcopy(item) if item else None

    def save_assessment(self, location: dict, result: dict) -> dict:
        """Apply assessed features and add a transient learned memory as one locked unit."""
        object_key = (result.get("source") or {}).get("object_key")
        with self._lock:
            if object_key:
                existing = self.find_assessment_by_object_key(object_key)
                if existing:
                    return existing
            memory = self.create_memory(
                {
                    "location_id": location["id"],
                    "agent_id": "agent-risk",
                    "memory_type": "observation",
                    "hazard": "multi_hazard",
                    "title": f"Satellite risk assessment: {location['name']}",
                    "content": f"{result['summary']} Fire risk {result['fire_risk']:.2f}; earthquake risk {result['earthquake_risk']:.2f}.",
                    "importance": max(result["fire_risk"], result["earthquake_risk"]),
                    "confidence": result["confidence"],
                    "metadata": {"provider": result["provider"], "observations": result["observations"], "source": result["source"]},
                }
            )
            stored_location = next(item for item in self.locations if item["id"] == location["id"])
            stored_location.update(
                {
                    "terrain": result["features"]["terrain"],
                    "vegetation_density": result["features"]["vegetation_density"],
                    "moisture_percent": result["features"]["moisture_percent"],
                    "slope_degrees": result["features"]["slope_degrees"],
                    "fire_risk": result["fire_risk"],
                    "earthquake_risk": result["earthquake_risk"],
                    "combined_risk": result["combined_risk"],
                    "status": "critical" if result["combined_risk"] >= 0.85 else "high" if result["combined_risk"] >= 0.7 else "guarded",
                    "satellite_source": result["provider"],
                    "updated_at": now_iso(),
                }
            )
            assessment = {
                "id": f"asm-{uuid.uuid4().hex[:12]}",
                "location_id": location["id"],
                "location_name": location["name"],
                "provider": result["provider"],
                "model_id": result.get("model_id"),
                "persisted": False,
                "persistence_provider": self.provider,
                "status": "completed",
                "fire_risk": result["fire_risk"],
                "earthquake_risk": result["earthquake_risk"],
                "combined_risk": result["combined_risk"],
                "confidence": result["confidence"],
                "summary": result["summary"],
                "observations": result["observations"],
                "features": result["features"],
                "source": result["source"],
                "fallback_reason": result.get("fallback_reason"),
                "request_id": result.get("request_id"),
                "usage": result.get("usage"),
                "learned_memory_id": memory["id"],
                "created_at": now_iso(),
            }
            self.assessments.insert(0, assessment)
            self.record_event("satellite.assessed", "satellite_assessment", assessment["id"], {"provider": result["provider"], "location_id": location["id"]})
            return copy.deepcopy(assessment)

    def update_simulation(self, simulation_id: str, updates: dict) -> dict:
        with self._lock:
            item = next((value for value in self.simulations if value["id"] == simulation_id), None)
            if not item:
                raise NotFound("simulation", simulation_id)
            item.update(copy.deepcopy(updates))
        return copy.deepcopy(item)

    def list_simulations(self, location_id: str | None = None, limit: int = 20) -> list[dict]:
        items = self.simulations
        if location_id:
            items = [item for item in items if item["location_id"] == location_id]
        return copy.deepcopy(items[:limit])

    def get_simulation(self, simulation_id: str) -> dict:
        item = next((value for value in self.simulations if value["id"] == simulation_id), None)
        if not item:
            raise NotFound("simulation", simulation_id)
        return copy.deepcopy(item)

    def list_agents(self) -> list[dict]:
        return copy.deepcopy(self.agents)

    def tick_agent(self, agent_id: str) -> dict:
        with self._lock:
            agent = next((item for item in self.agents if item["id"] == agent_id), None)
            if not agent:
                raise NotFound("agent", agent_id)
            agent["last_heartbeat_at"] = now_iso()
            agent["status"] = "ready"
            agent["memory_reads"] += 1
            self.record_event("agent.tick", "agent", agent_id, {"region": self.active_region})
        return copy.deepcopy(agent)

    def record_event(self, event_type: str, resource_type: str, resource_id: str, details: dict) -> None:
        self.events.insert(
            0,
            {
                "id": f"evt-{uuid.uuid4().hex[:12]}",
                "event_type": event_type,
                "resource_type": resource_type,
                "resource_id": resource_id,
                "actor_id": "sentineltwin-api",
                "region": self.active_region,
                "details": copy.deepcopy(details),
                "created_at": now_iso(),
            },
        )
        del self.events[100:]

    def resilience(self) -> dict:
        return {
            "status": "demo",
            "active_region": self.active_region,
            "logical_active_region": self.active_region,
            "active_region_scope": "application-routing-label",
            "regions": [],
            "topology_verified": False,
            "survival_goal": None,
            "topology_source": "deterministic-demo:no-cockroachdb-topology",
            "configured_rpo_seconds": None,
            "observed_rpo_seconds": None,
            "rpo_seconds": None,
            "cockroachdb": {
                "mode": "not-configured",
                "topology_verified": False,
                "regions": [],
                "survival_goal": None,
                "topology_source": "deterministic-demo:no-cockroachdb-topology",
                "configured_rpo_seconds": None,
                "observed_rpo_seconds": None,
                "failover_count": self.failover_count,
            },
            "memory_available": True,
            "memory_scope": "transient in-process demo state",
            "recent_events": copy.deepcopy(self.events[:10]),
            "notice": "Illustrative routing labels only; no CockroachDB topology or regional failover was observed.",
        }

    def failover(self, target_region: str | None, reason: str | None) -> dict:
        target = target_region or ("us-east-1" if self.active_region == "us-west-2" else "us-west-2")
        if target not in {"us-west-2", "us-east-1"}:
            raise ValidationError("target_region must be us-west-2 or us-east-1")
        previous = self.active_region
        with self._lock:
            self.active_region = target
            self.failover_count += 1
            self.record_event(
                "resilience.routing_rehearsal",
                "routing_label",
                target,
                {"from": previous, "reason": str(reason or "demo rehearsal")[:500], "rehearsal_only": True},
            )
        return {
            "status": "rehearsal_completed",
            "rehearsal_id": f"demo-{uuid.uuid4().hex[:12]}",
            "rehearsal_only": True,
            "actual_region_failover_performed": False,
            "from_region": previous,
            "active_region": target,
            "logical_active_region": target,
            "active_region_scope": "application-routing-label",
            "topology_verified": False,
            "regions": [],
            "survival_goal": None,
            "topology_source": "deterministic-demo:no-cockroachdb-topology",
            "configured_rpo_seconds": None,
            "observed_rpo_seconds": None,
            "rpo_seconds": None,
            "memory_verified": False,
            "memory_transaction_verified": False,
            "memory_check": {
                "verified": True,
                "scope": "transient in-process state remained readable",
                "durable": False,
            },
            "completed_at": now_iso(),
            "notice": "Demo routing label changed; no CockroachDB regional failover, quorum transition, or RPO was observed.",
        }


class UnavailableRepository:
    """Fail-closed repository used when a non-demo deployment has no database."""

    mode = "unavailable"
    provider = "not-configured"

    def __init__(self, settings: Settings):
        self.settings = settings

    def health(self) -> dict:
        reason = self.settings.database_config_error or "database_configuration_missing"
        return {
            "status": "degraded",
            "mode": self.mode,
            "provider": self.provider,
            "database": "unavailable",
            "data_persistence": "unavailable",
            "configuration_status": reason,
            "warning": "Persistent CockroachDB storage is unavailable; stateful API routes are disabled.",
        }

    def __getattr__(self, name: str):
        if name.startswith("_"):
            raise AttributeError(name)

        def unavailable(*_args, **_kwargs):
            raise ServiceUnavailable()

        return unavailable


class CockroachRepository:
    mode = "production"
    provider = "cockroachdb"

    def __init__(self, settings: Settings):
        self.settings = settings
        if not settings.database_url:
            raise ValueError("database_url is required")
        validate_database_url(settings.database_url)

    def _connect(self):
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError as exc:
            raise RuntimeError("psycopg is required when DATABASE_URL is configured") from exc
        return psycopg.connect(self.settings.database_url, row_factory=dict_row, connect_timeout=8)

    def _read(self, sql: str, params: tuple = (), one: bool = False):
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(sql, params)
            if one:
                row = cursor.fetchone()
                return _serialize_row(row) if row else None
            return [_serialize_row(row) for row in cursor.fetchall()]

    def _write(self, callback):
        # CockroachDB can return SQLSTATE 40001 under contention; retry the whole txn.
        for attempt in range(4):
            try:
                with self._connect() as connection:
                    with connection.cursor() as cursor:
                        result = callback(cursor)
                    connection.commit()
                    return result
            except Exception as exc:
                if getattr(exc, "sqlstate", None) != "40001" or attempt == 3:
                    raise
                time.sleep(0.025 * 2**attempt)

    @staticmethod
    def _location(row: dict) -> dict:
        row = _serialize_row(row)
        row["geometry"] = {"type": "Point", "coordinates": [row["longitude"], row["latitude"]]}
        return row

    def health(self) -> dict:
        started = time.perf_counter()
        # CockroachDB v26.2 restricts crdb_internal to unsafe/internal sessions.
        # Health must use supported SQL so the runtime can remain least-privilege.
        row = self._read(
            "SELECT now() AS server_time, current_database() AS database_name, version() AS database_version",
            one=True,
        )
        return {
            "status": "healthy",
            "mode": self.mode,
            "provider": self.provider,
            "database": "connected",
            "cluster_id": None,
            "database_name": row["database_name"],
            "database_version": row["database_version"],
            "server_time": row["server_time"],
            "latency_ms": round((time.perf_counter() - started) * 1000, 2),
            "data_persistence": "CockroachDB distributed SQL",
        }

    LOCATION_SELECT = """
        SELECT id::STRING AS id, name, region,
               ST_Y(coordinates::GEOMETRY) AS latitude,
               ST_X(coordinates::GEOMETRY) AS longitude,
               terrain, vegetation_density, soil_amplification, moisture_percent,
               wind_speed_mph, slope_degrees, population, critical_facilities,
               fire_risk, earthquake_risk, combined_risk, risk_trend, status,
               satellite_source, updated_at
        FROM locations
    """

    def list_locations(self, status: str | None = None, limit: int = 100) -> list[dict]:
        if status:
            rows = self._read(self.LOCATION_SELECT + " WHERE status = %s ORDER BY combined_risk DESC LIMIT %s", (status, limit))
        else:
            rows = self._read(self.LOCATION_SELECT + " ORDER BY combined_risk DESC LIMIT %s", (limit,))
        return [self._location(row) for row in rows]

    def get_location(self, location_id: str) -> dict:
        row = self._read(self.LOCATION_SELECT + " WHERE id = %s", (location_id,), one=True)
        if not row:
            raise NotFound("location", location_id)
        return self._location(row)

    def nearby_locations(self, latitude: float, longitude: float, radius_km: float, limit: int = 25) -> list[dict]:
        point = "ST_SetSRID(ST_MakePoint(%s, %s), 4326)::GEOGRAPHY"
        sql = self.LOCATION_SELECT.replace(
            "FROM locations",
            f", ST_Distance(coordinates, {point}) / 1000.0 AS distance_km FROM locations",
        ) + f" WHERE ST_DWithin(coordinates, {point}, %s) ORDER BY distance_km LIMIT %s"
        params = (longitude, latitude, longitude, latitude, radius_km * 1000, limit)
        return [self._location(row) for row in self._read(sql, params)]

    def create_location(self, payload: dict) -> dict:
        required = ("name", "latitude", "longitude")
        missing = [key for key in required if payload.get(key) is None]
        if missing:
            raise ValidationError("Missing required location fields", {"missing": missing})
        try:
            latitude = float(payload["latitude"])
            longitude = float(payload["longitude"])
        except (TypeError, ValueError) as exc:
            raise ValidationError("latitude and longitude must be numeric") from exc
        if not math.isfinite(latitude) or not math.isfinite(longitude) or not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
            raise ValidationError("latitude or longitude is outside its valid range")
        location_id = str(uuid.uuid4())
        fire = max(0, min(1, float(payload.get("fire_risk", 0.5))))
        quake = max(0, min(1, float(payload.get("earthquake_risk", 0.5))))
        combined = max(0, min(1, float(payload.get("combined_risk", max(fire, quake) * 0.72 + min(fire, quake) * 0.28))))
        values = (
            location_id, str(payload["name"])[:160], str(payload.get("region", "Unassigned"))[:120],
            longitude, latitude, str(payload.get("terrain", "unknown terrain"))[:500],
            max(0, min(1, float(payload.get("vegetation_density", 0.5)))), max(0.5, min(2.5, float(payload.get("soil_amplification", 1)))),
            max(0, min(100, float(payload.get("moisture_percent", 30)))), max(0, float(payload.get("wind_speed_mph", 10))),
            max(0, min(90, float(payload.get("slope_degrees", 5)))), max(0, int(payload.get("population", 0))),
            max(0, int(payload.get("critical_facilities", 0))), fire, quake, combined,
            "critical" if combined >= 0.85 else "high" if combined >= 0.7 else "guarded",
            str(payload.get("satellite_source", "manual input"))[:120],
        )
        def operation(cursor):
            cursor.execute(
                """INSERT INTO locations
                   (id, name, region, coordinates, terrain, vegetation_density, soil_amplification,
                    moisture_percent, wind_speed_mph, slope_degrees, population, critical_facilities,
                    fire_risk, earthquake_risk, combined_risk, status, satellite_source)
                   VALUES (%s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::GEOGRAPHY,
                           %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                values,
            )
            self._audit_cursor(cursor, "location.created", "location", location_id, {"name": payload["name"]})
        self._write(operation)
        return self.get_location(location_id)

    MEMORY_SELECT = """
        SELECT m.id::STRING AS id, m.location_id::STRING AS location_id, l.name AS location_name,
               m.simulation_id::STRING AS simulation_id, m.agent_id::STRING AS agent_id,
               m.memory_type, m.hazard, m.title, m.content, m.importance, m.confidence,
               m.outcome, m.metadata, m.created_at, m.last_accessed_at, m.access_count
        FROM agent_memories m LEFT JOIN locations l ON l.id = m.location_id
    """

    @staticmethod
    def _memory(row: dict) -> dict:
        row["outcome"] = _json(row.get("outcome"), {})
        row["metadata"] = _json(row.get("metadata"), {})
        if row.get("vector_distance") is not None:
            # CockroachDB's vector_l2_ops indexes accelerate <->. Our feature-
            # hash embeddings are unit normalized, so cosine = 1 - L2²/2.
            distance = float(row["vector_distance"])
            row["vector_distance"] = round(distance, 4)
            row["similarity"] = round(max(-1.0, min(1.0, 1.0 - distance * distance / 2.0)), 4)
        return row

    def list_memories(self, query: str | None = None, location_id: str | None = None, hazard: str | None = None, limit: int = 10) -> list[dict]:
        if query:
            embedding = vector_literal(embed_text(query))
            def ann(hazard_filter: str | None, query_limit: int) -> list[dict]:
                clauses: list[str] = []
                params: list[Any] = [embedding]
                if location_id:
                    clauses.append("m.location_id = %s")
                    params.append(location_id)
                if hazard_filter:
                    # Equality on the first index column lets CockroachDB use the
                    # (hazard, embedding) distributed vector index.
                    clauses.append("m.hazard = %s")
                    params.append(hazard_filter)
                where = " WHERE " + " AND ".join(clauses) if clauses else ""
                sql = self.MEMORY_SELECT.replace(
                    "m.access_count", "m.access_count, m.embedding <-> %s::VECTOR AS vector_distance"
                ) + where + " ORDER BY m.embedding <-> %s::VECTOR LIMIT %s"
                params.extend([embedding, query_limit])
                return self._read(sql, tuple(params))

            if hazard and hazard != "multi_hazard":
                # Separate equality scans keep the index prefix usable while still
                # including cross-hazard lessons.
                candidates = ann(hazard, limit) + ann("multi_hazard", limit)
                by_id = {row["id"]: row for row in candidates}
                rows = sorted(
                    by_id.values(),
                    key=lambda row: (
                        float(row["vector_distance"]) if row.get("vector_distance") is not None else float("inf"),
                        -float(row.get("importance") or 0),
                    ),
                )[:limit]
            else:
                rows = ann(hazard, limit)
            if rows:
                ids = [row["id"] for row in rows]
                try:
                    self._write(
                        lambda cursor: cursor.executemany(
                            "UPDATE agent_memories SET access_count=access_count+1, last_accessed_at=now() WHERE id=%s",
                            [(memory_id,) for memory_id in ids],
                        )
                    )
                    for row in rows:
                        row["access_count"] = int(row["access_count"]) + 1
                        row["last_accessed_at"] = now_iso()
                except Exception:
                    LOGGER.warning("Unable to update memory access counters", exc_info=True)
        else:
            clauses, params = [], []
            if location_id:
                clauses.append("m.location_id = %s")
                params.append(location_id)
            if hazard:
                clauses.append("m.hazard IN (%s, 'multi_hazard')")
                params.append(hazard)
            where = " WHERE " + " AND ".join(clauses) if clauses else ""
            rows = self._read(self.MEMORY_SELECT + where + " ORDER BY m.importance DESC, m.created_at DESC LIMIT %s", tuple(params + [limit]))
        return [self._memory(row) for row in rows]

    def get_memory(self, memory_id: str) -> dict:
        row = self._read(self.MEMORY_SELECT + " WHERE m.id=%s", (memory_id,), one=True)
        if not row:
            raise NotFound("memory", memory_id)
        return self._memory(row)

    def create_memory(self, payload: dict) -> dict:
        content = str(payload.get("content", "")).strip()
        if not content:
            raise ValidationError("memory content is required")
        memory_id = str(uuid.uuid4())
        hazard = str(payload.get("hazard", "multi_hazard")).replace("-", "_")
        embedding = vector_literal(embed_text(f"{hazard} {payload.get('title', '')} {content}"))
        values = (
            memory_id, payload.get("location_id"), payload.get("simulation_id"), payload.get("agent_id"),
            payload.get("memory_type", "observation"), hazard, str(payload.get("title", "Agent observation"))[:200], content[:12000],
            max(0, min(1, float(payload.get("importance", 0.65)))), max(0, min(1, float(payload.get("confidence", 0.75)))),
            json.dumps(payload.get("outcome") or {}), json.dumps(payload.get("metadata") or {}), embedding,
        )
        def operation(cursor):
            cursor.execute(
                """INSERT INTO agent_memories
                   (id, location_id, simulation_id, agent_id, memory_type, hazard, title, content,
                    importance, confidence, outcome, metadata, embedding)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::JSONB, %s::JSONB, %s::VECTOR)""",
                values,
            )
            self._audit_cursor(cursor, "memory.created", "memory", memory_id, {"hazard": hazard})
        self._write(operation)
        return self.get_memory(memory_id)

    ASSESSMENT_SELECT = """SELECT a.id::STRING AS id, a.location_id::STRING AS location_id,
        l.name AS location_name, a.provider, a.model_id, a.status, a.fire_risk,
        a.earthquake_risk, a.combined_risk, a.confidence, a.summary, a.observations,
        a.features, a.source, a.fallback_reason, a.request_id, a.usage,
        a.learned_memory_id::STRING AS learned_memory_id, a.created_at
        FROM satellite_assessments a JOIN locations l ON l.id=a.location_id"""

    @staticmethod
    def _assessment(row: dict) -> dict:
        for field, fallback in (("observations", []), ("features", {}), ("source", {}), ("usage", None)):
            row[field] = _json(row.get(field), fallback)
        row["persisted"] = True
        row["persistence_provider"] = "cockroachdb"
        return row

    def get_assessment(self, assessment_id: str) -> dict:
        row = self._read(self.ASSESSMENT_SELECT + " WHERE a.id=%s", (assessment_id,), one=True)
        if not row:
            raise NotFound("satellite assessment", assessment_id)
        return self._assessment(row)

    def list_assessments(self, location_id: str | None = None, limit: int = 20) -> list[dict]:
        if location_id:
            rows = self._read(
                self.ASSESSMENT_SELECT + " WHERE a.location_id=%s ORDER BY a.created_at DESC LIMIT %s",
                (location_id, limit),
            )
        else:
            rows = self._read(self.ASSESSMENT_SELECT + " ORDER BY a.created_at DESC LIMIT %s", (limit,))
        return [self._assessment(row) for row in rows]

    def find_assessment_by_object_key(self, object_key: str) -> dict | None:
        row = self._read(self.ASSESSMENT_SELECT + " WHERE a.object_key=%s", (object_key,), one=True)
        return self._assessment(row) if row else None

    def save_assessment(self, location: dict, result: dict) -> dict:
        source = dict(result.get("source") or {})
        object_key = source.get("object_key")
        if object_key:
            existing = self.find_assessment_by_object_key(str(object_key))
            if existing:
                return existing
        assessment_id = str(uuid.uuid4())
        memory_id = str(uuid.uuid4())
        content = f"{result['summary']} Fire risk {result['fire_risk']:.2f}; earthquake risk {result['earthquake_risk']:.2f}."
        embedding = vector_literal(embed_text(f"multi_hazard satellite assessment {location['name']} {content}"))
        memory_values = (
            memory_id, location["id"], "agent-risk", "observation", "multi_hazard",
            f"Satellite risk assessment: {location['name']}"[:200], content[:12000],
            max(float(result["fire_risk"]), float(result["earthquake_risk"])), float(result["confidence"]),
            json.dumps({}),
            json.dumps({"provider": result["provider"], "observations": result["observations"], "source": source}),
            embedding,
        )
        assessment_values = (
            assessment_id, location["id"], object_key, result["provider"], result.get("model_id"),
            float(result["fire_risk"]), float(result["earthquake_risk"]), float(result["combined_risk"]),
            float(result["confidence"]), str(result["summary"])[:1000], json.dumps(result["observations"]),
            json.dumps(result["features"]), json.dumps(source), result.get("fallback_reason"),
            result.get("request_id"), json.dumps(result.get("usage")) if result.get("usage") is not None else None,
            memory_id,
        )

        def operation(cursor):
            cursor.execute(
                """INSERT INTO agent_memories
                   (id, location_id, agent_id, memory_type, hazard, title, content, importance,
                    confidence, outcome, metadata, embedding)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::JSONB, %s::JSONB, %s::VECTOR)""",
                memory_values,
            )
            cursor.execute(
                """INSERT INTO satellite_assessments
                   (id, location_id, object_key, provider, model_id, status, fire_risk,
                    earthquake_risk, combined_risk, confidence, summary, observations,
                    features, source, fallback_reason, request_id, usage, learned_memory_id)
                   VALUES (%s, %s, %s, %s, %s, 'completed', %s, %s, %s, %s, %s,
                           %s::JSONB, %s::JSONB, %s::JSONB, %s, %s, %s::JSONB, %s)""",
                assessment_values,
            )
            features = result["features"]
            cursor.execute(
                """UPDATE locations SET
                   risk_trend=CASE WHEN %s > combined_risk + 0.02 THEN 'rising'
                                   WHEN %s < combined_risk - 0.02 THEN 'falling' ELSE 'stable' END,
                   terrain=%s, vegetation_density=%s, moisture_percent=%s, slope_degrees=%s,
                   fire_risk=%s, earthquake_risk=%s, combined_risk=%s,
                   status=CASE WHEN %s >= .85 THEN 'critical' WHEN %s >= .70 THEN 'high'
                               WHEN %s >= .40 THEN 'guarded' ELSE 'low' END,
                   satellite_source=%s, updated_at=now() WHERE id=%s""",
                (
                    result["combined_risk"], result["combined_risk"], features["terrain"],
                    features["vegetation_density"], features["moisture_percent"], features["slope_degrees"],
                    result["fire_risk"], result["earthquake_risk"], result["combined_risk"],
                    result["combined_risk"], result["combined_risk"], result["combined_risk"],
                    result["provider"], location["id"],
                ),
            )
            cursor.execute("UPDATE agents SET memory_writes=memory_writes+1 WHERE id='agent-risk'")
            self._audit_cursor(cursor, "satellite.assessed", "satellite_assessment", assessment_id, {"provider": result["provider"], "location_id": location["id"], "learned_memory_id": memory_id})
            self._audit_cursor(cursor, "memory.created", "memory", memory_id, {"hazard": "multi_hazard", "assessment_id": assessment_id})

        try:
            self._write(operation)
        except Exception as exc:
            # S3 may notify while an API-requested assessment is in flight. The
            # unique object-key constraint turns the second delivery into a read.
            if object_key and getattr(exc, "sqlstate", None) == "23505":
                existing = self.find_assessment_by_object_key(str(object_key))
                if existing:
                    return existing
            raise
        return self.get_assessment(assessment_id)

    def memory_stats(self) -> dict:
        totals = self._read("SELECT hazard, memory_type, count(*)::INT AS count FROM agent_memories GROUP BY hazard, memory_type")
        by_hazard, by_type, total = {}, {}, 0
        for row in totals:
            count = int(row["count"])
            total += count
            by_hazard[row["hazard"]] = by_hazard.get(row["hazard"], 0) + count
            by_type[row["memory_type"]] = by_type.get(row["memory_type"], 0) + count
        return {"total": total, "by_hazard": by_hazard, "by_type": by_type, "vector_dimensions": 32, "index": "CockroachDB distributed vector index"}

    def save_simulation(self, simulation: dict) -> dict:
        simulation_id = simulation.setdefault("id", str(uuid.uuid4()))
        values = (
            simulation_id, simulation["location_id"], simulation["hazard"], simulation["status"], simulation["seed"],
            json.dumps(simulation.get("parameters") or {}), json.dumps(simulation.get("outcome") or {}),
            json.dumps(simulation.get("timeline") or []), json.dumps(simulation.get("recommendations") or []),
            json.dumps(simulation.get("memory_context") or {}), json.dumps(simulation.get("agent_trace") or []),
            simulation.get("started_at"), simulation.get("completed_at"), json.dumps(simulation.get("agent_plan") or {}),
            json.dumps(simulation.get("artifact") or {}),
        )
        def operation(cursor):
            cursor.execute(
                """INSERT INTO simulations
                   (id, location_id, hazard, status, random_seed, parameters, outcome, timeline,
                    recommendations, memory_context, agent_trace, started_at, completed_at, agent_plan, artifact)
                   VALUES (%s, %s, %s, %s, %s, %s::JSONB, %s::JSONB, %s::JSONB, %s::JSONB,
                           %s::JSONB, %s::JSONB, %s::TIMESTAMPTZ, %s::TIMESTAMPTZ, %s::JSONB, %s::JSONB)""",
                values,
            )
            self._audit_cursor(cursor, "simulation.completed", "simulation", simulation_id, {"hazard": simulation["hazard"]})
        self._write(operation)
        return self.get_simulation(simulation_id)

    def save_simulation_with_memory(self, simulation: dict, memory_payload: dict) -> tuple[dict, dict]:
        """Persist the completed simulation, learned memory, and audits atomically."""
        content = str(memory_payload.get("content", "")).strip()
        if not content:
            raise ValidationError("memory content is required")
        simulation_id = simulation.setdefault("id", str(uuid.uuid4()))
        memory_id = str(uuid.uuid4())
        context = dict(simulation.get("memory_context") or {})
        context.update({"learned_memory_id": memory_id, "loop": "retrieve → simulate → plan → persist outcome"})
        simulation["memory_context"] = context
        hazard = str(memory_payload.get("hazard", "multi_hazard")).replace("-", "_")
        embedding = vector_literal(embed_text(f"{hazard} {memory_payload.get('title', '')} {content}"))
        simulation_values = (
            simulation_id, simulation["location_id"], simulation["hazard"], simulation["status"], simulation["seed"],
            json.dumps(simulation.get("parameters") or {}), json.dumps(simulation.get("outcome") or {}),
            json.dumps(simulation.get("timeline") or []), json.dumps(simulation.get("recommendations") or []),
            json.dumps(simulation.get("memory_context") or {}), json.dumps(simulation.get("agent_trace") or []),
            simulation.get("started_at"), simulation.get("completed_at"), json.dumps(simulation.get("agent_plan") or {}),
            json.dumps(simulation.get("artifact") or {}),
        )
        memory_values = (
            memory_id, memory_payload.get("location_id"), simulation_id, memory_payload.get("agent_id", "agent-commander"),
            memory_payload.get("memory_type", "simulation_outcome"), hazard,
            str(memory_payload.get("title", "Simulation outcome"))[:200], content[:12000],
            max(0, min(1, float(memory_payload.get("importance", 0.65)))),
            max(0, min(1, float(memory_payload.get("confidence", 0.75)))),
            json.dumps(memory_payload.get("outcome") or {}), json.dumps(memory_payload.get("metadata") or {}), embedding,
        )

        def operation(cursor):
            cursor.execute(
                """INSERT INTO simulations
                   (id, location_id, hazard, status, random_seed, parameters, outcome, timeline,
                    recommendations, memory_context, agent_trace, started_at, completed_at, agent_plan, artifact)
                   VALUES (%s, %s, %s, %s, %s, %s::JSONB, %s::JSONB, %s::JSONB, %s::JSONB,
                           %s::JSONB, %s::JSONB, %s::TIMESTAMPTZ, %s::TIMESTAMPTZ, %s::JSONB, %s::JSONB)""",
                simulation_values,
            )
            cursor.execute(
                """INSERT INTO agent_memories
                   (id, location_id, simulation_id, agent_id, memory_type, hazard, title, content,
                    importance, confidence, outcome, metadata, embedding)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::JSONB, %s::JSONB, %s::VECTOR)""",
                memory_values,
            )
            cursor.execute("UPDATE agents SET memory_writes=memory_writes+1 WHERE id=%s", (memory_values[3],))
            self._audit_cursor(cursor, "simulation.completed", "simulation", simulation_id, {"hazard": simulation["hazard"], "learned_memory_id": memory_id})
            self._audit_cursor(cursor, "memory.created", "memory", memory_id, {"hazard": hazard, "simulation_id": simulation_id})

        self._write(operation)
        return self.get_simulation(simulation_id), self.get_memory(memory_id)

    SIM_SELECT = """SELECT s.id::STRING AS id, s.location_id::STRING AS location_id, l.name AS location_name,
        s.hazard, s.status, s.random_seed AS seed, s.parameters, s.outcome, s.timeline, s.recommendations,
        s.memory_context, s.agent_trace, s.agent_plan, s.artifact, s.started_at, s.completed_at, s.created_at
        FROM simulations s JOIN locations l ON l.id=s.location_id"""

    @staticmethod
    def _simulation(row: dict) -> dict:
        for field, fallback in (("parameters", {}), ("outcome", {}), ("timeline", []), ("recommendations", []), ("memory_context", {}), ("agent_trace", []), ("agent_plan", {}), ("artifact", {})):
            row[field] = _json(row.get(field), fallback)
        return row

    def list_simulations(self, location_id: str | None = None, limit: int = 20) -> list[dict]:
        if location_id:
            rows = self._read(self.SIM_SELECT + " WHERE s.location_id=%s ORDER BY s.created_at DESC LIMIT %s", (location_id, limit))
        else:
            rows = self._read(self.SIM_SELECT + " ORDER BY s.created_at DESC LIMIT %s", (limit,))
        return [self._simulation(row) for row in rows]

    def get_simulation(self, simulation_id: str) -> dict:
        row = self._read(self.SIM_SELECT + " WHERE s.id=%s", (simulation_id,), one=True)
        if not row:
            raise NotFound("simulation", simulation_id)
        return self._simulation(row)

    def update_simulation(self, simulation_id: str, updates: dict) -> dict:
        statements = {
            "agent_plan": "UPDATE simulations SET agent_plan=%s::JSONB WHERE id=%s",
            "artifact": "UPDATE simulations SET artifact=%s::JSONB WHERE id=%s",
            "memory_context": "UPDATE simulations SET memory_context=%s::JSONB WHERE id=%s",
        }
        fields = [key for key in updates if key in statements]
        if not fields:
            return self.get_simulation(simulation_id)

        def operation(cursor):
            for field in fields:
                cursor.execute(statements[field], (json.dumps(updates[field]), simulation_id))

        self._write(operation)
        return self.get_simulation(simulation_id)

    def list_agents(self) -> list[dict]:
        return self._read("SELECT id::STRING AS id, name, role, capability, status, region, last_heartbeat_at, memory_reads, memory_writes FROM agents ORDER BY name")

    def tick_agent(self, agent_id: str) -> dict:
        def operation(cursor):
            cursor.execute("UPDATE agents SET last_heartbeat_at=now(), status='ready', memory_reads=memory_reads+1 WHERE id=%s RETURNING id::STRING AS id, name, role, capability, status, region, last_heartbeat_at, memory_reads, memory_writes", (agent_id,))
            row = cursor.fetchone()
            if not row:
                raise NotFound("agent", agent_id)
            self._audit_cursor(cursor, "agent.tick", "agent", agent_id, {})
            return _serialize_row(row)
        return self._write(operation)

    @staticmethod
    def _audit_cursor(cursor, event_type: str, resource_type: str, resource_id: str, details: dict):
        cursor.execute(
            "INSERT INTO audit_events (event_type, resource_type, resource_id, actor_id, region, details) VALUES (%s, %s, %s, 'sentineltwin-api', 'application', %s::JSONB)",
            (event_type, resource_type, resource_id, json.dumps(details)),
        )

    def _database_topology(self) -> dict:
        """Read CockroachDB's current database topology; never infer it from a URL."""
        try:
            row = self._read(
                """SELECT database_name, primary_region, secondary_region, regions, survival_goal
                   FROM [SHOW DATABASES] WHERE database_name=current_database()""",
                one=True,
            )
        except Exception as exc:  # noqa: BLE001 - topology evidence must degrade to unknown.
            LOGGER.warning("CockroachDB topology metadata query failed: %s", type(exc).__name__)
            return {
                "topology_verified": False,
                "regions": [],
                "survival_goal": None,
                "topology_source": "cockroachdb:SHOW DATABASES unavailable",
                "configured_rpo_seconds": None,
                "observed_rpo_seconds": None,
            }
        if not row:
            return {
                "topology_verified": False,
                "regions": [],
                "survival_goal": None,
                "topology_source": "cockroachdb:SHOW DATABASES returned no current database",
                "configured_rpo_seconds": None,
                "observed_rpo_seconds": None,
            }
        raw_regions = _json(row.get("regions"), []) or []
        region_names = list(dict.fromkeys(str(region) for region in raw_regions if str(region).strip()))
        raw_goal = str(row.get("survival_goal") or "").strip().lower().replace("_", " ")
        if raw_goal in {"region", "region failure", "survive region failure"}:
            survival_goal = "region"
        elif raw_goal in {"zone", "zone failure", "survive zone failure"}:
            survival_goal = "zone"
        else:
            survival_goal = raw_goal or None
        primary = str(row.get("primary_region") or "")
        secondary = str(row.get("secondary_region") or "")
        regions = [
            {
                "name": name,
                "role": "primary" if name == primary else "secondary" if name == secondary else "database-region",
                "status": "configured",
            }
            for name in region_names
        ]
        topology_verified = len(region_names) >= 3 and survival_goal == "region"
        return {
            "topology_verified": topology_verified,
            "regions": regions,
            "survival_goal": survival_goal,
            "topology_source": "cockroachdb:SHOW DATABASES",
            "configured_rpo_seconds": 0 if topology_verified else None,
            "observed_rpo_seconds": None,
        }

    def resilience(self) -> dict:
        state = self._read("SELECT value, updated_at FROM system_state WHERE key='routing'", one=True) or {"value": {"active_region": self.settings.aws_region, "failover_count": 0}}
        value = _json(state["value"], {})
        topology = self._database_topology()
        events = self._read("SELECT id::STRING AS id, event_type, resource_type, resource_id, actor_id, region, details, created_at FROM audit_events ORDER BY created_at DESC LIMIT 10")
        for event in events:
            event["details"] = _json(event.get("details"), {})
        return {
            "status": "operational",
            "active_region": value.get("active_region", self.settings.aws_region),
            "logical_active_region": value.get("active_region", self.settings.aws_region),
            "active_region_scope": "application-routing-label",
            **topology,
            "rpo_seconds": None,
            "cockroachdb": {
                "mode": "verified-multi-region" if topology["topology_verified"] else "topology-not-verified",
                **topology,
                "failover_count": value.get("failover_count", 0),
            },
            "memory_available": True,
            "memory_scope": "CockroachDB read succeeded; no regional outage was exercised",
            "recent_events": events,
            "notice": "Topology comes from CockroachDB metadata. Routing rehearsals do not perform or measure a regional failover.",
        }

    def failover(self, target_region: str | None, reason: str | None) -> dict:
        target = target_region or self.settings.aws_region
        if target not in self.settings.allowed_failover_regions:
            raise ValidationError(
                "target_region is not allowlisted",
                {"allowed_regions": list(self.settings.allowed_failover_regions)},
            )
        topology = self._database_topology()
        rehearsal_id = str(uuid.uuid4())
        def operation(cursor):
            cursor.execute("SELECT value FROM system_state WHERE key='routing' FOR UPDATE")
            row = cursor.fetchone()
            current = _json(row["value"], {}) if row else {}
            previous = current.get("active_region", self.settings.aws_region)
            current["active_region"] = target
            current["failover_count"] = int(current.get("failover_count", 0)) + 1
            current["last_rehearsal_id"] = rehearsal_id
            cursor.execute("UPSERT INTO system_state (key, value, updated_at) VALUES ('routing', %s::JSONB, now())", (json.dumps(current),))
            self._audit_cursor(
                cursor,
                "resilience.routing_rehearsal",
                "routing_label",
                target,
                {"from": previous, "reason": str(reason or "continuity rehearsal")[:500], "rehearsal_only": True},
            )
            # This verifies only same-transaction read-after-write continuity. It
            # does not exercise a node, zone, quorum, or region failure.
            cursor.execute("SELECT value FROM system_state WHERE key='routing'")
            verification_row = cursor.fetchone()
            observed = _json(verification_row["value"], {}) if verification_row else {}
            verified = observed.get("active_region") == target and observed.get("last_rehearsal_id") == rehearsal_id
            return previous, verified
        previous, verified = self._write(operation)
        return {
            "status": "rehearsal_completed",
            "rehearsal_id": rehearsal_id,
            "rehearsal_only": True,
            "actual_region_failover_performed": False,
            "from_region": previous,
            "active_region": target,
            "logical_active_region": target,
            "active_region_scope": "application-routing-label",
            **topology,
            "rpo_seconds": None,
            "memory_verified": verified,
            "memory_transaction_verified": verified,
            "memory_check": {
                "verified": verified,
                "scope": "same CockroachDB serializable transaction read-after-write",
                "durable": True,
            },
            "completed_at": now_iso(),
            "notice": "Application routing label rehearsal only; no node, zone, quorum, or regional failover was performed and observed RPO is unknown.",
        }


def make_repository(settings: Settings):
    if settings.demo_mode:
        return DemoRepository()
    if settings.database_url:
        return CockroachRepository(settings)
    return UnavailableRepository(settings)
