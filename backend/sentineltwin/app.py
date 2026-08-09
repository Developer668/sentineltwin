"""AWS Lambda JSON API for SentinelTwin."""

from __future__ import annotations

import base64
import json
import logging
import math
import re
import time
import uuid
from typing import Any
from urllib.parse import parse_qs, unquote

from .aws import CLEAN_SCAN_STATUS, REJECTED_SCAN_STATUSES, AWSIntegrations
from .config import Settings
from .errors import ApiError, NotFound, PayloadTooLarge, ValidationError
from .repository import make_repository, now_iso
from .simulation import run_simulation

SETTINGS = Settings.from_env()
logging.basicConfig(level=getattr(logging, SETTINGS.log_level, logging.INFO))
LOGGER = logging.getLogger(__name__)
REPOSITORY = make_repository(SETTINGS)
AWS = AWSIntegrations(SETTINGS)
MAX_API_BODY_BYTES = 1_000_000


def _limit(value: str | None, default: int, maximum: int = 100) -> int:
    try:
        return max(1, min(maximum, int(value or default)))
    except ValueError as exc:
        raise ValidationError("limit must be an integer") from exc


def _bool(value: str | None) -> bool:
    return (value or "").lower() in {"1", "true", "yes", "on"}


def _bounded_number(payload: dict, key: str, low: float, high: float, *, integer: bool = False) -> None:
    if key not in payload:
        return
    value = payload[key]
    if isinstance(value, bool):
        raise ValidationError(f"{key} must be numeric")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"{key} must be numeric") from exc
    if not math.isfinite(number) or number < low or number > high or (integer and not number.is_integer()):
        raise ValidationError(f"{key} must be between {low:g} and {high:g}")


class SentinelAPI:
    def __init__(self, settings: Settings, repository, aws: AWSIntegrations):
        self.settings = settings
        self.repository = repository
        self.aws = aws

    @property
    def meta(self) -> dict:
        return {
            "mode": self.repository.mode,
            "memory_provider": self.repository.provider,
            "persistence": {"provider": self.repository.provider, "durable": self.repository.mode == "production"},
            "aws_region": self.settings.aws_region,
            "providers": self.aws.status(),
        }

    @property
    def public_meta(self) -> dict:
        """Minimal metadata safe to return before API authorization."""
        return {
            "mode": self.repository.mode,
            "memory_provider": self.repository.provider,
            "persistence": {
                "provider": self.repository.provider,
                "durable": self.repository.mode == "production",
            },
        }

    def dispatch(self, method: str, path: str, query: dict[str, str], body: dict | None) -> tuple[int, Any, dict | None]:
        path = path.rstrip("/") or "/"
        if path == "/":
            return 200, {"name": "SentinelTwin API", "version": "1.0", "docs": "/api/health"}, None
        if path in {"/health", "/api/health"} and method == "GET":
            try:
                health = self.repository.health()
                health_status = 200 if health.get("status") == "healthy" else 503
                public_health = {
                    "status": health.get("status", "degraded"),
                    "service": "sentineltwin-api",
                    "mode": self.repository.mode,
                    "database": health.get("database", "unavailable"),
                    "data_persistence": {
                        "provider": self.repository.provider,
                        "durable": self.repository.mode == "production",
                    },
                    "timestamp": now_iso(),
                    "aws": self.aws.public_status(),
                }
                if health.get("configuration_status"):
                    public_health["configuration_status"] = health["configuration_status"]
                return health_status, public_health, None
            except Exception:
                LOGGER.exception("Health check failed")
                return 503, {
                    "status": "degraded",
                    "service": "sentineltwin-api",
                    "mode": self.repository.mode,
                    "database": "unavailable",
                    "data_persistence": {"provider": self.repository.provider, "durable": False},
                    "timestamp": now_iso(),
                    "aws": self.aws.public_status(),
                }, None

        if path == "/api/dashboard" and method == "GET":
            return 200, self._dashboard(), None
        if path == "/api/locations" and method == "GET":
            items = self.repository.list_locations(query.get("status"), _limit(query.get("limit"), 100))
            return 200, {"locations": items, "count": len(items)}, None
        if path == "/api/locations" and method == "POST":
            return 201, self._create_location(body or {}), None
        if path == "/api/locations/nearby" and method == "GET":
            try:
                latitude = float(query.get("latitude", query.get("lat", "")))
                longitude = float(query.get("longitude", query.get("lng", query.get("lon", ""))))
                radius_km = float(query.get("radius_km", "100"))
            except ValueError as exc:
                raise ValidationError("latitude, longitude, and radius_km must be numeric") from exc
            if not all(math.isfinite(value) for value in (latitude, longitude, radius_km)):
                raise ValidationError("latitude, longitude, and radius_km must be finite")
            if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
                raise ValidationError("latitude or longitude is outside its valid range")
            radius_km = max(0.1, min(1000, radius_km))
            items = self.repository.nearby_locations(latitude, longitude, radius_km, _limit(query.get("limit"), 25, 100))
            return 200, {"locations": items, "count": len(items), "radius_km": radius_km}, None
        match = re.fullmatch(r"/api/locations/([^/]+)", path)
        if match and method == "GET":
            return 200, self.repository.get_location(match.group(1)), None

        if path == "/api/memories" and method == "GET":
            items = self.repository.list_memories(
                query=query.get("q") or query.get("query"),
                location_id=query.get("location_id"),
                hazard=query.get("hazard"),
                limit=_limit(query.get("limit"), 10, 50),
            )
            return 200, {"memories": items, "count": len(items), "retrieval": "vector" if query.get("q") or query.get("query") else "recency"}, None
        if path == "/api/memories" and method == "POST":
            return 201, self._create_memory(body or {}), None
        if path == "/api/memories/stats" and method == "GET":
            return 200, self.repository.memory_stats(), None

        if path in {"/api/uploads", "/api/satellite/uploads"} and method == "POST":
            payload = body or {}
            location_id = str(payload.get("location_id") or payload.get("locationId") or "").strip()
            filename = str(payload.get("filename") or "").strip()
            content_type = str(payload.get("content_type") or payload.get("contentType") or "").strip()
            if not location_id or not filename or not content_type:
                raise ValidationError("location_id, filename, and content_type are required")
            if len(filename) > 200:
                raise ValidationError("filename must be 200 characters or fewer")
            location = self._resolve_location(location_id)
            return 201, self.aws.create_satellite_upload(str(location["id"]), filename, content_type), None
        if path == "/api/satellite/imports" and method == "POST":
            payload = body or {}
            location_id = str(payload.get("location_id") or payload.get("locationId") or "").strip()
            source_key = str(payload.get("source_key") or payload.get("sourceKey") or "").strip()
            if not location_id or not source_key:
                raise ValidationError("location_id and source_key are required")
            location = self._resolve_location(location_id)
            imported = self.aws.import_sentinel2(str(location["id"]), source_key)
            if imported.get("status") == "trusted_source_ready":
                assessment = self._create_assessment(
                    {
                        "location_id": str(location["id"]),
                        "object_key": imported["object_key"],
                    },
                    version_id=imported.get("version_id"),
                    event_scan_status="SOURCE_HASH_VERIFIED",
                    event_etag=imported.get("etag"),
                    trusted_source_sha256=(imported.get("source") or {}).get("sha256"),
                )
                imported = {
                    **imported,
                    "status": "trusted_source_assessed",
                    "assessment_id": assessment["id"],
                }
            return 202, imported, None
        if path == "/api/assessments" and method == "GET":
            object_key = str(query.get("object_key") or "").strip()
            if object_key:
                pattern = rf"{re.escape(self.settings.satellite_prefix)}/[A-Za-z0-9-]{{1,80}}/[A-Za-z0-9._-]{{1,180}}"
                if len(object_key) > 500 or ".." in object_key or not re.fullmatch(pattern, object_key):
                    raise ValidationError("object_key is outside the server-issued quarantine prefix")
                assessment = self.repository.find_assessment_by_object_key(object_key)
                scan_status = (
                    str((assessment.get("source") or {}).get("malware_scan_status") or CLEAN_SCAN_STATUS)
                    if assessment
                    else self.aws.malware_scan_status(object_key)
                )
                pipeline_status = (
                    "completed"
                    if assessment
                    else "rejected"
                    if scan_status in REJECTED_SCAN_STATUSES
                    else "processing"
                    if scan_status == CLEAN_SCAN_STATUS
                    else "pending"
                )
                authority = "guardduty-eventbridge"
                if assessment:
                    authority = str((assessment.get("source") or {}).get("ingestion_authority") or authority)
                return 200, {
                    "assessment": assessment,
                    "assessments": [assessment] if assessment else [],
                    "count": 1 if assessment else 0,
                    "status": pipeline_status,
                    "malware_scan_status": scan_status,
                    "object_key": object_key,
                    "ingestion_authority": authority,
                }, None
            items = self.repository.list_assessments(
                location_id=query.get("location_id"),
                limit=_limit(query.get("limit"), 20, 100),
            )
            return 200, {
                "assessments": items,
                "count": len(items),
                "persistence": {"provider": self.repository.provider, "durable": self.repository.mode == "production"},
            }, None
        if path == "/api/assessments" and method == "POST":
            return 201, self._create_assessment(body or {}), None

        if path == "/api/simulations" and method == "GET":
            items = self.repository.list_simulations(query.get("location_id"), _limit(query.get("limit"), 20, 100))
            return 200, {"simulations": items, "count": len(items)}, None
        if path == "/api/simulations" and method == "POST":
            return 201, self._create_simulation(body or {}), None
        match = re.fullmatch(r"/api/simulations/([^/]+)", path)
        if match and method == "GET":
            simulation = self.repository.get_simulation(match.group(1))
            if _bool(query.get("artifact")):
                artifact = self.aws.read_artifact(match.group(1))
                if artifact:
                    simulation = artifact
            return 200, simulation, None
        match = re.fullmatch(r"/api/simulations/([^/]+)/learn", path)
        if match and method == "POST":
            return 201, self._learn_from_simulation(match.group(1), body or {}), None
        match = re.fullmatch(r"/api/artifacts/([^/]+)", path)
        if match and method == "GET":
            artifact = self.aws.read_artifact(match.group(1))
            if artifact is None:
                raise NotFound("S3 artifact", match.group(1))
            return 200, artifact, None

        if path == "/api/agents" and method == "GET":
            items = self.repository.list_agents()
            return 200, {"agents": items, "count": len(items)}, None
        match = re.fullmatch(r"/api/agents/([^/]+)/tick", path)
        if match and method == "POST":
            return 200, self.repository.tick_agent(match.group(1)), None

        if path == "/api/resilience" and method == "GET":
            return 200, self.repository.resilience(), None
        if path == "/api/resilience/failover" and method == "POST":
            payload = body or {}
            return 202, self.repository.failover(payload.get("target_region"), payload.get("reason")), None
        if path == "/api/providers" and method == "GET":
            return 200, self.meta, None

        raise NotFound("route", f"{method} {path}")

    def _dashboard(self) -> dict:
        locations = self.repository.list_locations(limit=100)
        memories = self.repository.list_memories(limit=6)
        agents = self.repository.list_agents()
        simulations = self.repository.list_simulations(limit=5)
        resilience = self.repository.resilience()
        counts = {
            "critical": sum(1 for item in locations if item["status"] == "critical"),
            "high": sum(1 for item in locations if item["status"] == "high"),
            "guarded": sum(1 for item in locations if item["status"] == "guarded"),
        }
        average = sum(float(item["combined_risk"]) for item in locations) / max(len(locations), 1)
        return {
            "locations": locations,
            "watchlist": locations[:3],
            "agents": agents,
            "recent_memories": memories,
            "recent_simulations": simulations,
            "recent_assessments": self.repository.list_assessments(limit=5),
            "risk_summary": {**counts, "average_combined_risk": round(average, 3), "locations_monitored": len(locations)},
            "memory_stats": self.repository.memory_stats(),
            "resilience": resilience,
            "system": self.meta,
            # Camel-case aliases keep the contract easy to consume from TypeScript.
            "recentMemories": memories,
            "recentSimulations": simulations,
            "recentAssessments": self.repository.list_assessments(limit=5),
            "riskSummary": {**counts, "averageCombinedRisk": round(average, 3), "locationsMonitored": len(locations)},
            "memoryStats": self.repository.memory_stats(),
        }

    def _create_location(self, payload: dict) -> dict:
        name = payload.get("name")
        if not isinstance(name, str) or not name.strip() or len(name) > 160:
            raise ValidationError("name must be a non-empty string of 160 characters or fewer")
        for key, maximum in (("region", 120), ("terrain", 500), ("satellite_source", 120)):
            value = payload.get(key)
            if value is not None and (not isinstance(value, str) or len(value) > maximum):
                raise ValidationError(f"{key} must be a string of {maximum} characters or fewer")
        for key, low, high, integer in (
            ("latitude", -90, 90, False),
            ("longitude", -180, 180, False),
            ("fire_risk", 0, 1, False),
            ("earthquake_risk", 0, 1, False),
            ("combined_risk", 0, 1, False),
            ("vegetation_density", 0, 1, False),
            ("soil_amplification", 0.5, 2.5, False),
            ("moisture_percent", 0, 100, False),
            ("wind_speed_mph", 0, 250, False),
            ("slope_degrees", 0, 90, False),
            ("population", 0, 100_000_000, True),
            ("critical_facilities", 0, 100_000, True),
        ):
            _bounded_number(payload, key, low, high, integer=integer)
        if "latitude" not in payload or "longitude" not in payload:
            raise ValidationError("latitude and longitude are required")
        return self.repository.create_location(payload)

    def _create_memory(self, payload: dict) -> dict:
        content = payload.get("content")
        if not isinstance(content, str) or not content.strip() or len(content) > 12_000:
            raise ValidationError("content must be a non-empty string of 12000 characters or fewer")
        title = payload.get("title")
        if title is not None and (not isinstance(title, str) or len(title) > 200):
            raise ValidationError("title must be a string of 200 characters or fewer")
        hazard = str(payload.get("hazard", "multi_hazard")).strip().lower().replace("-", "_")
        hazard = {"wildfire": "fire", "seismic": "earthquake", "composite": "multi_hazard"}.get(hazard, hazard)
        if hazard not in {"fire", "earthquake", "multi_hazard", "agricultural_resilience"}:
            raise ValidationError(
                "hazard must be fire, earthquake, multi_hazard, or agricultural_resilience"
            )
        payload = {**payload, "hazard": hazard}
        for key, maximum in (("agent_id", 128), ("memory_type", 64), ("location_id", 128), ("simulation_id", 128)):
            value = payload.get(key)
            if value is not None and (not isinstance(value, str) or len(value) > maximum):
                raise ValidationError(f"{key} must be a string of {maximum} characters or fewer")
        for key in ("importance", "confidence", "effectiveness"):
            _bounded_number(payload, key, 0, 1)
        for key in ("metadata", "outcome"):
            value = payload.get(key)
            if value is not None and not isinstance(value, dict):
                raise ValidationError(f"{key} must be a JSON object")
            if value is not None and len(json.dumps(value, separators=(",", ":"), allow_nan=False)) > 32_000:
                raise ValidationError(f"{key} must be 32000 characters or fewer")
        return self.repository.create_memory(payload)

    def _resolve_location(self, location_id: str) -> dict:
        """Resolve a database id or a stable UI slug to one location."""
        try:
            return self.repository.get_location(location_id)
        except NotFound:
            needle = location_id.lower().removeprefix("loc-")
            candidates = self.repository.list_locations(limit=100)
            location = next(
                (
                    item for item in candidates
                    if re.sub(r"[^a-z0-9]+", "-", item["name"].lower()).strip("-") in {needle, f"{needle}-wildland-edge", f"{needle}-fault-zone"}
                    or re.sub(r"[^a-z0-9]+", "-", item["name"].lower()).strip("-").startswith(needle)
                ),
                None,
            )
            if location is None:
                raise
            return location

    def _create_assessment(
        self,
        payload: dict,
        *,
        version_id: str | None = None,
        event_scan_status: str | None = None,
        event_etag: str | None = None,
        trusted_source_sha256: str | None = None,
    ) -> dict:
        location_id = str(payload.get("location_id") or payload.get("locationId") or "").strip()
        object_key = str(payload.get("object_key") or payload.get("s3_key") or "").strip() or None
        demo_tile = str(payload.get("demo_tile") or payload.get("demoTile") or "").strip() or None
        if not location_id:
            raise ValidationError("location_id is required")
        if bool(object_key) == bool(demo_tile):
            raise ValidationError("provide exactly one of object_key or demo_tile")
        if demo_tile and not re.fullmatch(r"[A-Za-z0-9._-]{1,80}", demo_tile):
            raise ValidationError("demo_tile contains unsupported characters")
        location = self._resolve_location(location_id)
        if object_key:
            existing = self.repository.find_assessment_by_object_key(object_key)
            if existing:
                existing_version = str((existing.get("source") or {}).get("version_id") or "") or None
                if version_id and existing_version != version_id:
                    raise ValidationError("object_key was already assessed for a different S3 object version")
                return existing
        result = self.aws.assess_satellite(
            location,
            object_key=object_key,
            demo_tile=demo_tile,
            version_id=version_id,
            event_scan_status=event_scan_status,
            event_etag=event_etag,
            trusted_source_sha256=trusted_source_sha256,
        )
        return self.repository.save_assessment(location, result)

    def _create_simulation(self, payload: dict) -> dict:
        location_id = str(payload.get("location_id") or payload.get("locationId") or "").strip()
        if not location_id:
            raise ValidationError("location_id is required")
        hazard = str(payload.get("hazard", "multi_hazard")).lower().replace("-", "_")
        hazard = {"seismic": "earthquake", "composite": "multi_hazard", "wildfire": "fire"}.get(hazard, hazard)
        if hazard == "agricultural_resilience" and not str(
            payload.get("assessment_id") or payload.get("assessmentId") or ""
        ).strip():
            raise ValidationError("assessment_id is required for agricultural_resilience simulations")
        location = self._resolve_location(location_id)
        location_id = str(location["id"])
        if hazard == "agricultural_resilience":
            assessment_id = str(payload.get("assessment_id") or payload.get("assessmentId") or "").strip()
            assessment = self.repository.get_assessment(assessment_id)
            if not assessment.get("persisted") or assessment.get("persistence_provider") != "cockroachdb":
                raise ValidationError(
                    "agricultural_resilience requires a CockroachDB-persisted satellite assessment"
                )
            if str(assessment.get("location_id")) != location_id:
                raise ValidationError("assessment_id does not belong to location_id")
            source = dict(assessment.get("source") or {})
            upstream = dict(source.get("upstream") or {})
            guardduty_verified = source.get("malware_scan_status") == "NO_THREATS_FOUND"
            trusted_source_verified = (
                source.get("content_validation_provider")
                == "sentineltwin-allowlisted-aws-open-data"
                and source.get("content_validation_status") == "SOURCE_HASH_VERIFIED"
                and source.get("malware_scan_status") == "NOT_APPLICABLE_TRUSTED_SOURCE"
            )
            if (
                assessment.get("provider") != "amazon-bedrock"
                or not (guardduty_verified or trusted_source_verified)
                or upstream.get("provider") != "aws-open-data-sentinel-2-l2a"
            ):
                raise ValidationError(
                    "agricultural_resilience requires clean AWS Open Data Sentinel-2 evidence assessed by Amazon Bedrock"
                )
        raw_parameters = payload.get("parameters") or {}
        if not isinstance(raw_parameters, dict):
            raise ValidationError("parameters must be a JSON object")
        parameters = dict(raw_parameters)
        for camel, snake in (
            ("horizonHours", "duration_hours"),
            ("cascadingImpacts", "cascading_impacts"),
            ("useMemory", "use_memory"),
        ):
            if camel in payload and snake not in parameters:
                parameters[snake] = payload[camel]
        if "duration_hours" in parameters and "duration_minutes" not in parameters:
            duration_hours = parameters["duration_hours"]
            if isinstance(duration_hours, bool):
                raise ValidationError("duration_hours must be numeric")
            try:
                duration_hours = float(duration_hours)
            except (TypeError, ValueError) as exc:
                raise ValidationError("duration_hours must be numeric") from exc
            if not math.isfinite(duration_hours):
                raise ValidationError("duration_hours must be numeric")
            parameters["duration_hours"] = duration_hours
            parameters["duration_minutes"] = duration_hours * 60
        evidence = None
        if hazard == "agricultural_resilience":
            features = dict(assessment.get("features") or {})
            duration_hours = parameters.get("duration_hours", 72)
            parameters = {
                "terrain": features.get("terrain"),
                "vegetation_density": features.get("vegetation_density"),
                "moisture_percent": features.get("moisture_percent"),
                "slope_degrees": features.get("slope_degrees"),
                "fire_risk": assessment.get("fire_risk"),
                "assessment_confidence": assessment.get("confidence"),
                "rainfall_deficit_percent": raw_parameters.get("rainfall_deficit_percent", 25),
                "heat_anomaly_c": raw_parameters.get("heat_anomaly_c", 2),
                "irrigation_coverage": raw_parameters.get("irrigation_coverage", 0.4),
                "duration_hours": duration_hours,
                "duration_minutes": float(duration_hours) * 60,
            }
            evidence = {
                "assessment_id": assessment["id"],
                "evidence_class": "persisted_satellite_assessment",
                "persistence_provider": "cockroachdb",
                "assessment_provider": assessment["provider"],
                "confidence": assessment["confidence"],
                "created_at": assessment["created_at"],
                "features": {
                    key: features.get(key)
                    for key in ("terrain", "vegetation_density", "moisture_percent", "slope_degrees")
                },
                "source": source,
            }
        memory_query = str(payload.get("memory_query") or f"{hazard} {location['terrain']} emergency response successful tactics")
        if len(memory_query) > 2000:
            raise ValidationError("memory_query must be 2000 characters or fewer")
        use_memory = bool(parameters.get("use_memory", payload.get("useMemory", True)))
        try:
            memory_limit = max(1, min(8, int(payload.get("memory_limit", payload.get("memoryLimit", 4)))))
        except (TypeError, ValueError) as exc:
            raise ValidationError("memory_limit must be an integer") from exc
        memories = (
            self.repository.list_memories(
                query=memory_query,
                hazard=hazard if hazard != "multi_hazard" else None,
                limit=memory_limit,
            )
            if use_memory
            else []
        )
        simulation = run_simulation(
            location,
            hazard,
            parameters=parameters,
            memories=memories,
            requested_seed=payload.get("seed"),
        )
        if evidence is not None:
            simulation["evidence"] = evidence
        simulation.update(
            {
                "id": str(uuid.uuid4()),
                "location_id": location_id,
                "location_name": location["name"],
                "plan_version": "v1.0",
                "agent_trace": [
                    {"agent": "Risk Assessor", "action": "Loaded the location's current terrain and risk evidence", "status": "completed"},
                    {"agent": "Similarity Retriever", "action": f"Recalled {len(memories)} vector-similar memories from {self.repository.provider}", "status": "completed"},
                    {"agent": "Scenario Simulator", "action": f"Ran deterministic {hazard.replace('_', ' ')} model with seed {simulation['seed']}", "status": "completed"},
                    {"agent": "Resource Planner", "action": "Generated a memory-grounded action plan", "status": "completed"},
                ],
            }
        )
        simulation["agent_plan"] = self.aws.enhance_plan(simulation, location, memories)
        simulation["artifact"] = {"provider": "pending", "stored": False}
        memory_payload = {
                "location_id": location_id,
                "agent_id": "agent-commander",
                "memory_type": "simulation_outcome",
                "hazard": simulation["hazard"],
                "title": f"{location['name']} {simulation['hazard'].replace('_', ' ')} simulation outcome",
                "content": (
                    f"Scenario severity was {simulation['outcome']['severity']} with resilience score "
                    f"{simulation['outcome']['resilience_score']}. Recommended tactic: {simulation['recommendations'][0]}."
                ),
                "importance": min(1, 0.55 + float(simulation["outcome"]["impact_score"]) * 0.4),
                "confidence": 0.82,
                "outcome": {
                    "label": "simulated",
                    "effectiveness": max(0.25, min(0.95, float(simulation["outcome"]["resilience_score"]) / 100)),
                    "impact_score": simulation["outcome"]["impact_score"],
                },
                "metadata": {
                    "recommended_tactic": simulation["recommendations"][0],
                    "seed": simulation["seed"],
                    "source": "sentineltwin simulation",
                    **(
                        {
                            "assessment_id": evidence["assessment_id"],
                            "evidence": evidence,
                            "scenario_assumptions": simulation.get("scenario_assumptions", {}),
                        }
                        if evidence is not None
                        else {}
                    ),
                },
            }
        saved, learned_memory = self.repository.save_simulation_with_memory(simulation, memory_payload)
        # The CockroachDB transaction is authoritative. Write the portable copy
        # only after it commits, then attach its status to the durable record.
        artifact = self.aws.store_simulation_artifact(saved)
        try:
            saved = self.repository.update_simulation(saved["id"], {"artifact": artifact})
        except Exception:
            LOGGER.exception("Simulation committed but artifact reference could not be updated")
            saved["artifact"] = {**artifact, "database_reference_updated": False}
        saved["learned_memory"] = learned_memory
        return saved

    def _learn_from_simulation(self, simulation_id: str, payload: dict) -> dict:
        simulation = self.repository.get_simulation(simulation_id)
        content = payload.get("content") or (
            f"Human after-action assessment for {simulation['hazard']} at {simulation['location_name']}: "
            f"{payload.get('assessment', 'the recommended resource plan was reviewed')}"
        )
        recommendation = payload.get("recommended_tactic") or simulation["recommendations"][0]
        return self._create_memory(
            {
                "location_id": simulation["location_id"],
                "simulation_id": simulation_id,
                "agent_id": payload.get("agent_id", "agent-commander"),
                "memory_type": "after_action",
                "hazard": simulation["hazard"],
                "title": payload.get("title", f"After-action review: {simulation['location_name']}"),
                "content": content,
                "importance": payload.get("importance", 0.85),
                "confidence": payload.get("confidence", 0.9),
                "outcome": {"label": payload.get("outcome", "reviewed"), "effectiveness": payload.get("effectiveness", 0.75)},
                "metadata": {"recommended_tactic": recommendation, "source": "human after-action review"},
            }
        )


API = SentinelAPI(SETTINGS, REPOSITORY, AWS)


def _reject_json_constant(value: str) -> None:
    raise ValueError(f"non-standard JSON constant: {value}")


def _event_parts(event: dict) -> tuple[str, str, dict[str, str], dict | None]:
    request_context = event.get("requestContext") or {}
    method = (
        (request_context.get("http") or {}).get("method")
        or event.get("httpMethod")
        or event.get("requestContext", {}).get("httpMethod")
        or "GET"
    ).upper()
    path = event.get("rawPath") or event.get("path") or "/"
    stage = request_context.get("stage")
    if stage and stage != "$default" and path.startswith(f"/{stage}/"):
        path = path[len(stage) + 1 :]
    query = dict(event.get("queryStringParameters") or {})
    raw_query = event.get("rawQueryString")
    if raw_query and not query:
        query = {key: values[-1] for key, values in parse_qs(raw_query).items()}
    body_value = event.get("body")
    if event.get("isBase64Encoded") and body_value:
        if len(body_value) > MAX_API_BODY_BYTES * 2:
            raise PayloadTooLarge()
        try:
            body_value = base64.b64decode(body_value, validate=True).decode("utf-8")
        except (ValueError, UnicodeDecodeError) as exc:
            raise ApiError(400, "invalid_body_encoding", "Base64 request body is invalid") from exc
    if isinstance(body_value, str) and len(body_value.encode("utf-8")) > MAX_API_BODY_BYTES:
        raise PayloadTooLarge()
    if not body_value:
        body = None
    elif isinstance(body_value, dict):
        try:
            encoded = json.dumps(body_value, allow_nan=False, separators=(",", ":"))
        except (TypeError, ValueError) as exc:
            raise ApiError(400, "invalid_json", "Request body must contain finite JSON values") from exc
        if len(encoded.encode("utf-8")) > MAX_API_BODY_BYTES:
            raise PayloadTooLarge()
        body = body_value
    else:
        try:
            body = json.loads(body_value, parse_constant=_reject_json_constant)
        except (json.JSONDecodeError, ValueError) as exc:
            raise ApiError(400, "invalid_json", "Request body must be valid JSON") from exc
    if body is not None and not isinstance(body, dict):
        raise ApiError(400, "invalid_json", "Request body must be a JSON object")
    return method, path, query, body


def _response(
    status: int,
    payload: Any,
    request_id: str,
    elapsed_ms: float,
    extra_headers: dict | None = None,
    *,
    meta: dict | None = None,
) -> dict:
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": SETTINGS.cors_origin,
        "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Request-Id",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Expose-Headers": "X-Request-Id,X-Sentinel-Mode",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Request-Id": request_id,
        "X-Sentinel-Mode": REPOSITORY.mode,
        **(extra_headers or {}),
    }
    envelope = {
        "data": payload,
        "meta": {**(meta or API.public_meta), "request_id": request_id, "elapsed_ms": round(elapsed_ms, 2)},
    }
    body = "" if status == 204 else json.dumps(envelope, separators=(",", ":"), default=str, allow_nan=False)
    return {"statusCode": status, "headers": headers, "body": body, "isBase64Encoded": False}


def _operator_groups(event: dict) -> set[str]:
    claims = (((event.get("requestContext") or {}).get("authorizer") or {}).get("jwt") or {}).get("claims") or {}
    raw_groups = claims.get("cognito:groups")
    if isinstance(raw_groups, list):
        return {str(group).strip() for group in raw_groups if str(group).strip()}
    if not isinstance(raw_groups, str):
        return set()
    value = raw_groups.strip()
    if value.startswith("[") and value.endswith("]"):
        try:
            decoded = json.loads(value)
            if isinstance(decoded, list):
                return {str(group).strip() for group in decoded if str(group).strip()}
        except json.JSONDecodeError:
            value = value[1:-1]
    return {group for group in re.split(r"[\s,]+", value) if group}


def _require_operator(event: dict, method: str, path: str) -> None:
    required_group = SETTINGS.required_operator_group
    if not required_group or method == "OPTIONS" or path.rstrip("/") in {"/health", "/api/health"}:
        return
    if required_group not in _operator_groups(event):
        raise ApiError(403, "forbidden", "Operator group membership is required")


def lambda_handler(event: dict, context: Any) -> dict:
    started = time.perf_counter()
    request_id = (
        (event.get("requestContext") or {}).get("requestId")
        or getattr(context, "aws_request_id", None)
        or str(uuid.uuid4())
    )
    response_meta = API.public_meta
    try:
        method, path, query, body = _event_parts(event)
        if method == "OPTIONS":
            return _response(204, None, request_id, (time.perf_counter() - started) * 1000, meta=response_meta)
        _require_operator(event, method, path)
        if path.rstrip("/") not in {"/health", "/api/health"}:
            response_meta = API.meta
        status, payload, headers = API.dispatch(method, path, query, body)
        return _response(status, payload, request_id, (time.perf_counter() - started) * 1000, headers, meta=response_meta)
    except ApiError as exc:
        return _response(
            exc.status,
            {"error": {"code": exc.code, "message": exc.message, "details": exc.details}},
            request_id,
            (time.perf_counter() - started) * 1000,
            meta=response_meta,
        )
    except Exception:
        LOGGER.exception("Unhandled API error request_id=%s", request_id)
        error = {"code": "internal_error", "message": "The request could not be completed", "request_id": request_id}
        return _response(
            500,
            {"error": error},
            request_id,
            (time.perf_counter() - started) * 1000,
            meta=response_meta,
        )


def _malware_scan_events(event: dict) -> list[dict]:
    """Accept only the documented GuardDuty S3 object scan-result shape."""
    if (
        event.get("source") != "aws.guardduty"
        or event.get("detail-type") != "GuardDuty Malware Protection Object Scan Result"
        or not isinstance(event.get("detail"), dict)
    ):
        return []
    detail = event["detail"]
    object_details = detail.get("s3ObjectDetails") or {}
    result_details = detail.get("scanResultDetails") or {}
    return [
        {
            "bucket": object_details.get("bucketName"),
            "object_key": unquote(str(object_details.get("objectKey") or "")),
            "version_id": str(object_details.get("versionId") or "") or None,
            "etag": str(object_details.get("eTag") or ""),
            "scan_status": str(detail.get("scanStatus") or "").upper(),
            "scan_result_status": str(result_details.get("scanResultStatus") or "").upper(),
        }
    ]


def satellite_event_handler(event: dict, context: Any) -> dict:
    """Assess only exact S3 versions that GuardDuty independently marked clean."""
    processed: list[dict] = []
    rejected: list[dict] = []
    failures: list[dict] = []
    expected_bucket = SETTINGS.artifact_bucket
    prefix = f"{SETTINGS.satellite_prefix}/"
    scan_events = _malware_scan_events(event)
    if not scan_events:
        raise RuntimeError("Event did not contain a GuardDuty malware scan result")
    for scan_event in scan_events:
        bucket = scan_event["bucket"]
        object_key = scan_event["object_key"]
        scan_status = scan_event["scan_result_status"]
        try:
            if not expected_bucket or bucket != expected_bucket:
                raise ValidationError("GuardDuty event bucket does not match ARTIFACT_BUCKET")
            if not object_key.startswith(prefix) or ".." in object_key:
                raise ValidationError("GuardDuty event key is outside the satellite quarantine prefix")
            remainder = object_key[len(prefix):]
            location_id, separator, _filename = remainder.partition("/")
            if not separator or not re.fullmatch(r"[A-Za-z0-9-]{1,80}", location_id):
                raise ValidationError("GuardDuty event key does not contain a valid location id")
            if scan_status in REJECTED_SCAN_STATUSES:
                rejected.append({"object_key": object_key, "scan_status": scan_status})
                LOGGER.warning("Quarantined satellite object rejected scan_status=%s", scan_status)
                continue
            if scan_event["scan_status"] != "COMPLETED" or scan_status != CLEAN_SCAN_STATUS:
                raise ValidationError("GuardDuty scan result is not a completed clean verdict")
            if not scan_event["version_id"]:
                raise ValidationError("GuardDuty clean result does not identify an exact S3 object version")
            assessment = API._create_assessment(
                {"location_id": location_id, "object_key": object_key},
                version_id=scan_event["version_id"],
                event_scan_status=scan_status,
                event_etag=scan_event["etag"],
            )
            processed.append({"object_key": object_key, "assessment_id": assessment["id"], "provider": assessment["provider"]})
        except Exception as exc:
            LOGGER.exception("GuardDuty scan event could not be processed key=%s", object_key)
            failures.append({"object_key": object_key, "error": type(exc).__name__})
    if failures:
        # Raising makes S3/Lambda retry the event. Successful records remain
        # idempotent because object_key is unique in CockroachDB.
        raise RuntimeError(f"{len(failures)} GuardDuty scan event(s) could not be processed")
    return {
        "processed": processed,
        "rejected": rejected,
        "count": len(processed),
        "rejected_count": len(rejected),
    }
