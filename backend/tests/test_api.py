import json
from dataclasses import replace
from types import SimpleNamespace

import pytest
import sentineltwin.app as app_module
from sentineltwin.app import (
    API,
    _malware_scan_events,
    lambda_handler,
    satellite_event_handler,
)
from sentineltwin.errors import ValidationError
from sentineltwin.repository import DemoRepository


def request(method, path, payload=None, query=""):
    response = lambda_handler(
        {
            "version": "2.0",
            "rawPath": path,
            "rawQueryString": query,
            "requestContext": {"http": {"method": method}, "requestId": "test-request"},
            "body": json.dumps(payload) if payload is not None else None,
        },
        None,
    )
    return response, json.loads(response["body"])


def test_health_clearly_surfaces_demo_mode():
    response, body = request("GET", "/api/health")
    assert response["statusCode"] == 200
    assert body["data"]["status"] == "healthy"
    assert body["data"]["mode"] == "demo"
    assert body["meta"]["memory_provider"] == "deterministic-in-memory"
    assert response["headers"]["X-Sentinel-Mode"] == "demo"
    assert "providers" not in body["meta"]
    assert "aws_region" not in body["meta"]
    assert "bucket" not in body["data"]["aws"]
    assert "last_error" not in body["data"]["aws"]
    assert response["headers"]["X-Content-Type-Options"] == "nosniff"


def test_locations_include_hackathon_watchlist():
    response, body = request("GET", "/api/locations")
    assert response["statusCode"] == 200
    names = {item["name"] for item in body["data"]["locations"]}
    assert {"Santa Rosa Wildland Edge", "San Bernardino Basin", "Ridgecrest Fault Zone"} <= names


def test_dashboard_returns_the_complete_command_center_contract():
    response, body = request("GET", "/api/dashboard")
    assert response["statusCode"] == 200
    dashboard = body["data"]
    assert dashboard["locations"]
    assert dashboard["agents"]
    assert dashboard["recent_memories"]
    assert dashboard["risk_summary"]["locations_monitored"] == len(dashboard["locations"])
    assert dashboard["system"]["persistence"]["durable"] is False


def test_spatial_location_search_returns_distance_order():
    response, body = request("GET", "/api/locations/nearby", query="lat=38.44&lng=-122.71&radius_km=100")
    assert response["statusCode"] == 200
    locations = body["data"]["locations"]
    assert locations[0]["name"] == "Santa Rosa Wildland Edge"
    assert locations[0]["distance_km"] < 2


@pytest.mark.parametrize("parameter", ["lat=nan&lng=-122.71", "lat=38.44&lng=inf", "lat=38.44&lng=-122.71&radius_km=nan"])
def test_spatial_location_search_rejects_non_finite_coordinates(parameter):
    response, body = request("GET", "/api/locations/nearby", query=parameter)
    assert response["statusCode"] == 422
    assert body["data"]["error"]["code"] == "validation_error"


def test_simulation_closes_memory_learning_loop():
    _, locations = request("GET", "/api/locations")
    location_id = locations["data"]["locations"][0]["id"]
    response, body = request("POST", "/api/simulations", {"location_id": location_id, "hazard": "fire", "seed": 101})
    assert response["statusCode"] == 201
    simulation = body["data"]
    assert simulation["status"] == "completed"
    assert simulation["memory_context"]["retrieved_count"] > 0
    assert simulation["memory_context"]["learned_memory_id"]
    assert simulation["agent_plan"]["provider"] == "deterministic-planner"
    assert simulation["agent_plan"]["human_review_required"] is True


def test_agricultural_simulation_requires_a_persisted_satellite_assessment():
    response, body = request(
        "POST",
        "/api/simulations",
        {"location_id": "santa-rosa", "hazard": "agricultural_resilience"},
    )

    assert response["statusCode"] == 422
    assert body["data"]["error"]["message"] == (
        "assessment_id is required for agricultural_resilience simulations"
    )


def test_agricultural_simulation_rejects_demo_assessment_as_real_evidence():
    _, locations = request("GET", "/api/locations")
    location_id = locations["data"]["locations"][0]["id"]
    _, created = request(
        "POST",
        "/api/assessments",
        {"location_id": location_id, "demo_tile": "california-terrain"},
    )

    response, body = request(
        "POST",
        "/api/simulations",
        {
            "location_id": location_id,
            "hazard": "agricultural_resilience",
            "assessment_id": created["data"]["id"],
        },
    )

    assert response["statusCode"] == 422
    assert body["data"]["error"]["message"] == (
        "agricultural_resilience requires a CockroachDB-persisted satellite assessment"
    )


def test_agricultural_simulation_uses_server_owned_satellite_evidence():
    repository = DemoRepository()
    api = app_module.SentinelAPI(app_module.SETTINGS, repository, app_module.AWS)
    location = repository.list_locations(limit=1)[0]
    assessment = repository.save_assessment(
        location,
        {
            "provider": "amazon-bedrock",
            "model_id": "amazon.nova-lite-v1:0",
            "fire_risk": 0.81,
            "earthquake_risk": 0.22,
            "combined_risk": 0.645,
            "confidence": 0.91,
            "summary": "Test-only normalized Sentinel-2 assessment.",
            "observations": ["Dry vegetation signature present."],
            "features": {
                "terrain": "cultivated valley test fixture",
                "vegetation_density": 0.72,
                "moisture_percent": 18.0,
                "slope_degrees": 4.0,
            },
            "source": {
                "provider": "amazon-s3",
                "bucket": "sentineltwin-test-artifacts",
                "object_key": f"sentineltwin/quarantine/{location['id']}/test-only.jp2",
                "version_id": "test-version",
                "malware_scan_provider": "amazon-guardduty",
                "malware_scan_status": "NO_THREATS_FOUND",
                "upstream": {
                    "provider": "aws-open-data-sentinel-2-l2a",
                    "bucket": "sentinel-s2-l2a",
                    "region": "eu-central-1",
                    "object_key": "tiles/test-only/TCI.jp2",
                    "sha256": "test-only-sha256",
                },
            },
            "fallback_reason": None,
            "request_id": "test-request",
            "usage": None,
        },
    )
    stored = repository.assessments[0]
    stored["persisted"] = True
    stored["persistence_provider"] = "cockroachdb"

    with pytest.raises(ValidationError, match="duration_hours must be numeric"):
        api.dispatch(
            "POST",
            "/api/simulations",
            {},
            {
                "location_id": location["id"],
                "hazard": "agricultural_resilience",
                "assessment_id": assessment["id"],
                "parameters": {"duration_hours": "not-a-number"},
            },
        )

    status, simulation, _headers = api.dispatch(
        "POST",
        "/api/simulations",
        {},
        {
            "location_id": location["id"],
            "hazard": "agricultural_resilience",
            "assessment_id": assessment["id"],
            "parameters": {
                "vegetation_density": 0.01,
                "moisture_percent": 99,
                "rainfall_deficit_percent": 35,
                "heat_anomaly_c": 2.5,
                "irrigation_coverage": 0.3,
                "duration_hours": 72,
            },
            "seed": 303,
        },
    )

    assert status == 201
    assert simulation["hazard"] == "agricultural_resilience"
    assert simulation["evidence"] == {
        "assessment_id": assessment["id"],
        "evidence_class": "persisted_satellite_assessment",
        "persistence_provider": "cockroachdb",
        "assessment_provider": "amazon-bedrock",
        "confidence": 0.91,
        "created_at": assessment["created_at"],
        "features": {
            "terrain": "cultivated valley test fixture",
            "vegetation_density": 0.72,
            "moisture_percent": 18.0,
            "slope_degrees": 4.0,
        },
        "source": stored["source"],
    }
    assert simulation["parameters"]["vegetation_density"] == 0.72
    assert simulation["parameters"]["moisture_percent"] == 18.0
    assert simulation["scenario_assumptions"] == {
        "rainfall_deficit_percent": 35.0,
        "heat_anomaly_c": 2.5,
        "irrigation_coverage": 0.3,
        "duration_hours": 72.0,
    }
    assert simulation["outcome"]["crop_stress_score"] > 0
    assert simulation["learned_memory"]["metadata"]["assessment_id"] == assessment["id"]

    stored["source"] = {
        **stored["source"],
        "malware_scan_provider": "not-used-trusted-aws-open-data",
        "malware_scan_status": "NOT_APPLICABLE_TRUSTED_SOURCE",
        "content_validation_provider": "sentineltwin-allowlisted-aws-open-data",
        "content_validation_status": "SOURCE_HASH_VERIFIED",
    }
    trusted_status, trusted_simulation, _headers = api.dispatch(
        "POST",
        "/api/simulations",
        {},
        {
            "location_id": location["id"],
            "hazard": "agricultural_resilience",
            "assessment_id": assessment["id"],
        },
    )
    assert trusted_status == 201
    assert trusted_simulation["evidence"]["source"]["content_validation_status"] == (
        "SOURCE_HASH_VERIFIED"
    )


def test_ui_camel_case_request_and_location_slug_are_supported():
    response, body = request(
        "POST",
        "/api/simulations",
        {
            "locationId": "santa-rosa",
            "hazard": "composite",
            "horizonHours": 12,
            "useMemory": True,
            "cascadingImpacts": ["Power grid"],
            "seed": 202,
        },
    )
    assert response["statusCode"] == 201
    assert body["data"]["hazard"] == "multi_hazard"
    assert body["data"]["location_name"] == "Santa Rosa Wildland Edge"
    assert body["data"]["parameters"]["duration_minutes"] == 720


@pytest.mark.parametrize("hazard", ["fire", "earthquake", "multi_hazard"])
def test_ui_maximum_72_hour_horizon_is_supported(hazard):
    response, body = request(
        "POST",
        "/api/simulations",
        {"location_id": "san-bernardino", "hazard": hazard, "parameters": {"duration_hours": 72}},
    )
    assert response["statusCode"] == 201
    assert body["data"]["parameters"]["duration_minutes"] == 4320


def test_invalid_json_and_unknown_routes_return_structured_errors():
    response = lambda_handler(
        {"rawPath": "/api/memories", "requestContext": {"http": {"method": "POST"}}, "body": "{"},
        None,
    )
    assert response["statusCode"] == 400
    body = json.loads(response["body"])
    assert body["data"]["error"]["code"] == "invalid_json"
    response, body = request("GET", "/api/does-not-exist")
    assert response["statusCode"] == 404
    assert body["data"]["error"]["code"] == "not_found"


@pytest.mark.parametrize("payload", ['{"risk":NaN}', '{"risk":Infinity}', '{"risk":-Infinity}'])
def test_non_finite_json_is_rejected(payload):
    response = lambda_handler(
        {"rawPath": "/api/memories", "requestContext": {"http": {"method": "POST"}}, "body": payload},
        None,
    )
    assert response["statusCode"] == 400
    assert json.loads(response["body"])["data"]["error"]["code"] == "invalid_json"


def test_non_finite_internal_value_never_leaks_invalid_json(monkeypatch):
    monkeypatch.setattr(API, "dispatch", lambda *_args, **_kwargs: (200, {"risk": float("nan")}, None))
    response = lambda_handler(
        {"rawPath": "/api/dashboard", "requestContext": {"http": {"method": "GET"}}},
        None,
    )
    assert response["statusCode"] == 500
    assert "NaN" not in response["body"]
    assert json.loads(response["body"])["data"]["error"]["code"] == "internal_error"


@pytest.mark.parametrize(
    ("path", "payload"),
    [
        ("/api/locations", {"name": "Bad coordinate", "latitude": "nan", "longitude": -122}),
        ("/api/memories", {"content": "Bad metadata", "metadata": ["not", "an", "object"]}),
        ("/api/simulations", {"location_id": "santa-rosa", "parameters": {"fire": []}}),
        ("/api/simulations", {"location_id": "santa-rosa", "seed": 9_999_999_999}),
    ],
)
def test_write_routes_reject_ambiguous_or_unbounded_inputs(path, payload):
    response, body = request("POST", path, payload)
    assert response["statusCode"] == 422
    assert body["data"]["error"]["code"] == "validation_error"


def test_required_cognito_operator_group_is_enforced_server_side(monkeypatch):
    monkeypatch.setattr(
        app_module,
        "SETTINGS",
        replace(app_module.SETTINGS, required_operator_group="sentineltwin-operators"),
    )
    base_event = {
        "version": "2.0",
        "rawPath": "/api/locations",
        "requestContext": {"http": {"method": "GET"}, "authorizer": {"jwt": {"claims": {}}}},
    }
    denied = app_module.lambda_handler(base_event, None)
    assert denied["statusCode"] == 403
    denied_body = json.loads(denied["body"])
    assert denied_body["data"]["error"]["code"] == "forbidden"
    assert "providers" not in denied_body["meta"]

    allowed_event = json.loads(json.dumps(base_event))
    allowed_event["requestContext"]["authorizer"]["jwt"]["claims"]["cognito:groups"] = (
        "incident-viewers,sentineltwin-operators"
    )
    allowed = app_module.lambda_handler(allowed_event, None)
    assert allowed["statusCode"] == 200

    health_event = {"rawPath": "/api/health", "requestContext": {"http": {"method": "GET"}}}
    assert app_module.lambda_handler(health_event, None)["statusCode"] == 200


def test_failover_rehearsal_preserves_memory():
    response, body = request("POST", "/api/resilience/failover", {"target_region": "us-east-1", "reason": "unit test"})
    assert response["statusCode"] == 202
    result = body["data"]
    assert result["status"] == "rehearsal_completed"
    assert result["rehearsal_only"] is True
    assert result["actual_region_failover_performed"] is False
    assert result["topology_verified"] is False
    assert result["regions"] == []
    assert result["configured_rpo_seconds"] is None
    assert result["observed_rpo_seconds"] is None
    assert result["rpo_seconds"] is None
    assert result["memory_verified"] is False
    assert result["memory_transaction_verified"] is False
    assert result["memory_check"] == {
        "verified": True,
        "scope": "transient in-process state remained readable",
        "durable": False,
    }


def test_demo_resilience_never_invents_multi_region_topology():
    response, body = request("GET", "/api/resilience")
    assert response["statusCode"] == 200
    resilience = body["data"]
    assert resilience["status"] == "demo"
    assert resilience["topology_verified"] is False
    assert resilience["regions"] == []
    assert resilience["survival_goal"] is None
    assert resilience["configured_rpo_seconds"] is None
    assert resilience["observed_rpo_seconds"] is None
    assert resilience["cockroachdb"]["mode"] == "not-configured"


def test_demo_satellite_assessment_is_truthfully_non_durable_and_learns():
    _, locations = request("GET", "/api/locations")
    location_id = locations["data"]["locations"][0]["id"]
    response, body = request(
        "POST",
        "/api/assessments",
        {"location_id": location_id, "demo_tile": "california-terrain"},
    )
    assert response["statusCode"] == 201
    assessment = body["data"]
    assert assessment["provider"] == "deterministic-demo"
    assert assessment["persisted"] is False
    assert assessment["persistence_provider"] == "deterministic-in-memory"
    assert assessment["learned_memory_id"]
    assert "no satellite pixels" in assessment["summary"].lower()

    response, body = request("GET", "/api/assessments")
    assert response["statusCode"] == 200
    assert body["data"]["count"] >= 1
    assert body["data"]["persistence"]["durable"] is False


def test_demo_upload_endpoint_never_returns_a_fake_s3_url():
    _, locations = request("GET", "/api/locations")
    location_id = locations["data"]["locations"][0]["id"]
    response, body = request(
        "POST",
        "/api/uploads",
        {"location_id": location_id, "filename": "tile.png", "content_type": "image/png"},
    )
    assert response["statusCode"] == 503
    assert body["data"]["error"]["code"] == "integration_not_configured"
    assert "upload_url" not in body["data"]


def test_assessment_requires_exactly_one_source():
    _, locations = request("GET", "/api/locations")
    location_id = locations["data"]["locations"][0]["id"]
    response, body = request("POST", "/api/assessments", {"location_id": location_id})
    assert response["statusCode"] == 422
    assert body["data"]["error"]["code"] == "validation_error"


def test_assessment_polling_uses_object_key_for_guardduty_authority(monkeypatch):
    _, locations = request("GET", "/api/locations")
    location_id = locations["data"]["locations"][0]["id"]
    object_key = f"sentineltwin/quarantine/{location_id}/poll-test.png"

    response, body = request("GET", "/api/assessments", query=f"object_key={object_key}")
    assert response["statusCode"] == 200
    assert body["data"] == {
        "assessment": None,
        "assessments": [],
        "count": 0,
        "status": "pending",
        "malware_scan_status": "PENDING",
        "object_key": object_key,
        "ingestion_authority": "guardduty-eventbridge",
    }

    original = API.aws.assess_satellite

    def clean_test_assessment(location, object_key=None, **_kwargs):
        return API.aws._deterministic_assessment(location, object_key=object_key)

    monkeypatch.setattr(API.aws, "assess_satellite", clean_test_assessment)
    response, created = request("POST", "/api/assessments", {"location_id": location_id, "object_key": object_key})
    assert response["statusCode"] == 201
    monkeypatch.setattr(API.aws, "assess_satellite", original)
    response, body = request("GET", "/api/assessments", query=f"object_key={object_key}")
    assert response["statusCode"] == 200
    assert body["data"]["status"] == "completed"
    assert body["data"]["assessment"]["id"] == created["data"]["id"]
    with pytest.raises(ValidationError, match="different S3 object version"):
        API._create_assessment(
            {"location_id": location_id, "object_key": object_key},
            version_id="replacement-version",
        )


def test_assessment_polling_rejects_non_issued_object_key():
    response, body = request("GET", "/api/assessments", query="object_key=private/other-user.png")
    assert response["statusCode"] == 422
    assert body["data"]["error"]["code"] == "validation_error"


def test_guardduty_object_scan_shape_is_normalized():
    events = _malware_scan_events(
        {
            "source": "aws.guardduty",
            "detail-type": "GuardDuty Malware Protection Object Scan Result",
            "detail": {
                "scanStatus": "COMPLETED",
                "s3ObjectDetails": {
                    "bucketName": "sentineltwin-artifacts",
                    "objectKey": "sentineltwin/quarantine/location-1/tile%20one.png",
                    "versionId": "v1",
                    "eTag": "etag-1",
                },
                "scanResultDetails": {"scanResultStatus": "NO_THREATS_FOUND"},
            },
        }
    )
    assert events == [
        {
            "bucket": "sentineltwin-artifacts",
            "object_key": "sentineltwin/quarantine/location-1/tile one.png",
            "version_id": "v1",
            "etag": "etag-1",
            "scan_status": "COMPLETED",
            "scan_result_status": "NO_THREATS_FOUND",
        }
    ]


def test_raw_s3_event_cannot_bypass_malware_scan():
    assert _malware_scan_events(
        {
            "source": "aws.s3",
            "detail-type": "Object Created",
            "detail": {"bucket": {"name": "sentineltwin-artifacts"}, "object": {"key": "tile.png"}},
        }
    ) == []


def test_guardduty_threat_is_rejected_without_assessment(monkeypatch):
    monkeypatch.setattr(
        "sentineltwin.app.SETTINGS",
        SimpleNamespace(artifact_bucket="sentineltwin-artifacts", satellite_prefix="sentineltwin/quarantine"),
    )
    event = {
        "source": "aws.guardduty",
        "detail-type": "GuardDuty Malware Protection Object Scan Result",
        "detail": {
            "scanStatus": "COMPLETED",
            "s3ObjectDetails": {
                "bucketName": "sentineltwin-artifacts",
                "objectKey": "sentineltwin/quarantine/location-1/threat.png",
                "versionId": "v1",
            },
            "scanResultDetails": {"scanResultStatus": "THREATS_FOUND"},
        },
    }
    result = satellite_event_handler(event, None)
    assert result["processed"] == []
    assert result["rejected"] == [
        {
            "object_key": "sentineltwin/quarantine/location-1/threat.png",
            "scan_status": "THREATS_FOUND",
        }
    ]


def test_sentinel_import_endpoint_fails_closed_without_s3():
    _, locations = request("GET", "/api/locations")
    location_id = locations["data"]["locations"][0]["id"]
    response, body = request(
        "POST",
        "/api/satellite/imports",
        {
            "location_id": location_id,
            "source_key": "tiles/16/Q/DD/2020/8/29/0/R60m/TCI.jp2",
        },
    )
    assert response["statusCode"] == 503
    assert body["data"]["error"]["code"] == "integration_not_configured"


def test_trusted_sentinel_import_assesses_the_exact_server_verified_evidence():
    repository = DemoRepository()
    location = repository.list_locations(limit=1)[0]
    source_sha256 = "a" * 64
    object_key = f"sentineltwin/quarantine/{location['id']}/trusted.jp2"

    class TrustedAWS:
        def import_sentinel2(self, location_id, source_key):
            assert location_id == location["id"]
            assert source_key == "tiles/10/S/EH/2024/7/15/0/R60m/TCI.jp2"
            return {
                "status": "trusted_source_ready",
                "object_key": object_key,
                "version_id": "version-1",
                "etag": "etag-1",
                "source": {"sha256": source_sha256},
            }

        def assess_satellite(self, assessed_location, **kwargs):
            assert assessed_location["id"] == location["id"]
            assert kwargs == {
                "object_key": object_key,
                "demo_tile": None,
                "version_id": "version-1",
                "event_scan_status": "SOURCE_HASH_VERIFIED",
                "event_etag": "etag-1",
                "trusted_source_sha256": source_sha256,
            }
            return {
                "provider": "amazon-bedrock",
                "model_id": "amazon.nova-lite-v1:0",
                "fire_risk": 0.71,
                "earthquake_risk": 0.2,
                "combined_risk": 0.51,
                "confidence": 0.88,
                "summary": "Test-only trusted Sentinel-2 assessment.",
                "observations": ["Verified source bytes assessed."],
                "features": {
                    "terrain": "cultivated valley test fixture",
                    "vegetation_density": 0.66,
                    "moisture_percent": 24.0,
                    "slope_degrees": 3.0,
                },
                "source": {
                    "provider": "amazon-s3",
                    "object_key": object_key,
                    "version_id": "version-1",
                    "malware_scan_status": "NOT_APPLICABLE_TRUSTED_SOURCE",
                    "content_validation_provider": "sentineltwin-allowlisted-aws-open-data",
                    "content_validation_status": "SOURCE_HASH_VERIFIED",
                    "upstream": {"provider": "aws-open-data-sentinel-2-l2a"},
                },
                "fallback_reason": None,
                "request_id": "test-request",
                "usage": None,
            }

    api = app_module.SentinelAPI(app_module.SETTINGS, repository, TrustedAWS())
    status, result, _headers = api.dispatch(
        "POST",
        "/api/satellite/imports",
        {},
        {
            "location_id": location["id"],
            "source_key": "tiles/10/S/EH/2024/7/15/0/R60m/TCI.jp2",
        },
    )

    assert status == 202
    assert result["status"] == "trusted_source_assessed"
    assert result["assessment_id"] == repository.assessments[0]["id"]
    assert repository.assessments[0]["source"]["content_validation_status"] == (
        "SOURCE_HASH_VERIFIED"
    )


def test_api_rejects_oversized_json_before_parsing():
    response = lambda_handler(
        {
            "version": "2.0",
            "rawPath": "/api/assessments",
            "requestContext": {"http": {"method": "POST"}},
            "body": json.dumps({"padding": "x" * 1_000_001}),
        },
        None,
    )
    assert response["statusCode"] == 413
    assert json.loads(response["body"])["data"]["error"]["code"] == "payload_too_large"
