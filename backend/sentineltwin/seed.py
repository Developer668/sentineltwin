"""Deterministic demo data used when CockroachDB is not configured."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

UTC = timezone.utc

from .memory import embed_text


def utc_iso(minutes_ago: int = 0) -> str:
    return (datetime.now(UTC) - timedelta(minutes=minutes_ago)).isoformat().replace("+00:00", "Z")


LOCATIONS = [
    {
        "id": "loc-malibu",
        "name": "Malibu Canyon",
        "region": "Los Angeles County",
        "latitude": 34.0709,
        "longitude": -118.7798,
        "terrain": "steep coastal chaparral canyon",
        "vegetation_density": 0.84,
        "soil_amplification": 1.12,
        "moisture_percent": 18.0,
        "wind_speed_mph": 31.0,
        "slope_degrees": 29.0,
        "population": 12620,
        "critical_facilities": 4,
        "fire_risk": 0.91,
        "earthquake_risk": 0.68,
        "combined_risk": 0.86,
        "status": "critical",
        "satellite_source": "Sentinel-2 demo composite",
    },
    {
        "id": "loc-pasadena",
        "name": "Pasadena Foothills",
        "region": "Los Angeles County",
        "latitude": 34.1924,
        "longitude": -118.1270,
        "terrain": "urban-wildland foothill interface",
        "vegetation_density": 0.72,
        "soil_amplification": 1.2,
        "moisture_percent": 23.0,
        "wind_speed_mph": 19.0,
        "slope_degrees": 21.0,
        "population": 41300,
        "critical_facilities": 11,
        "fire_risk": 0.76,
        "earthquake_risk": 0.82,
        "combined_risk": 0.81,
        "status": "high",
        "satellite_source": "Sentinel-2 demo composite",
    },
    {
        "id": "loc-san-bernardino",
        "name": "San Bernardino Basin",
        "region": "San Bernardino County",
        "latitude": 34.1083,
        "longitude": -117.2898,
        "terrain": "dry alluvial basin near active fault",
        "vegetation_density": 0.63,
        "soil_amplification": 1.46,
        "moisture_percent": 16.0,
        "wind_speed_mph": 24.0,
        "slope_degrees": 13.0,
        "population": 89200,
        "critical_facilities": 16,
        "fire_risk": 0.79,
        "earthquake_risk": 0.94,
        "combined_risk": 0.91,
        "status": "critical",
        "satellite_source": "Sentinel-1/2 demo fusion",
    },
    {
        "id": "loc-oakland",
        "name": "Oakland Hills",
        "region": "Alameda County",
        "latitude": 37.8197,
        "longitude": -122.1813,
        "terrain": "dense eucalyptus ridge and urban interface",
        "vegetation_density": 0.88,
        "soil_amplification": 1.08,
        "moisture_percent": 27.0,
        "wind_speed_mph": 22.0,
        "slope_degrees": 24.0,
        "population": 33700,
        "critical_facilities": 9,
        "fire_risk": 0.83,
        "earthquake_risk": 0.78,
        "combined_risk": 0.82,
        "status": "high",
        "satellite_source": "Sentinel-2 demo composite",
    },
    {
        "id": "loc-san-diego",
        "name": "East San Diego County",
        "region": "San Diego County",
        "latitude": 32.8531,
        "longitude": -116.8504,
        "terrain": "arid brushland and scattered communities",
        "vegetation_density": 0.69,
        "soil_amplification": 1.05,
        "moisture_percent": 14.0,
        "wind_speed_mph": 29.0,
        "slope_degrees": 18.0,
        "population": 18400,
        "critical_facilities": 6,
        "fire_risk": 0.88,
        "earthquake_risk": 0.55,
        "combined_risk": 0.79,
        "status": "high",
        "satellite_source": "MODIS + Sentinel-2 demo",
    },
    {
        "id": "loc-santa-rosa",
        "name": "Santa Rosa Wildland Edge",
        "region": "Sonoma County",
        "latitude": 38.4405,
        "longitude": -122.7144,
        "terrain": "oak woodland ridges meeting dense neighborhoods",
        "vegetation_density": 0.81,
        "soil_amplification": 1.14,
        "moisture_percent": 20.0,
        "wind_speed_mph": 27.0,
        "slope_degrees": 19.0,
        "population": 52600,
        "critical_facilities": 12,
        "fire_risk": 0.93,
        "earthquake_risk": 0.64,
        "combined_risk": 0.88,
        "status": "critical",
        "satellite_source": "Sentinel-2 + MODIS demo fusion",
    },
    {
        "id": "loc-ridgecrest",
        "name": "Ridgecrest Fault Zone",
        "region": "Kern County",
        "latitude": 35.6225,
        "longitude": -117.6709,
        "terrain": "arid basin crossed by active strike-slip faults",
        "vegetation_density": 0.23,
        "soil_amplification": 1.31,
        "moisture_percent": 10.0,
        "wind_speed_mph": 18.0,
        "slope_degrees": 7.0,
        "population": 28400,
        "critical_facilities": 8,
        "fire_risk": 0.39,
        "earthquake_risk": 0.97,
        "combined_risk": 0.86,
        "status": "critical",
        "satellite_source": "Sentinel-1 InSAR demo composite",
    },
    {
        "id": "loc-sacramento",
        "name": "Sacramento Delta",
        "region": "Sacramento County",
        "latitude": 38.4200,
        "longitude": -121.5554,
        "terrain": "flat delta levee and agricultural land",
        "vegetation_density": 0.38,
        "soil_amplification": 1.51,
        "moisture_percent": 44.0,
        "wind_speed_mph": 12.0,
        "slope_degrees": 2.0,
        "population": 28600,
        "critical_facilities": 7,
        "fire_risk": 0.34,
        "earthquake_risk": 0.62,
        "combined_risk": 0.52,
        "status": "guarded",
        "satellite_source": "Sentinel-1 demo composite",
    },
]


MEMORY_BLUEPRINTS = [
    ("mem-001", "loc-malibu", "wildfire", "success", "Pre-positioning two strike teams above the canyon cut initial response by 18 minutes during Santa Ana winds.", 0.92, 0.94, "Pre-position Type 3 engines on the ridge before wind onset", 0.86, 1440),
    ("mem-002", "loc-oakland", "wildfire", "success", "Targeted vegetation breaks around the urban interface reduced structure exposure despite ember spotting.", 0.88, 0.91, "Prioritize defensible-space patrols at the urban edge", 0.79, 1210),
    ("mem-003", "loc-pasadena", "earthquake", "mixed", "A magnitude 6.6 exercise found communications congestion and delayed hospital status reports.", 0.82, 0.86, "Activate satellite communications for hospitals immediately", 0.61, 980),
    ("mem-004", "loc-san-bernardino", "multi_hazard", "success", "Distributed shelter staging avoided the primary fault crossing and preserved evacuation capacity after aftershocks.", 0.95, 0.93, "Stage shelters on both sides of the fault corridor", 0.88, 720),
    ("mem-005", "loc-san-diego", "wildfire", "failure", "Late aircraft dispatch allowed wind-driven fire to cross the eastern control line before ground crews arrived.", 0.91, 0.89, "Dispatch air support when spread probability exceeds 70 percent", 0.42, 430),
    ("mem-006", "loc-sacramento", "earthquake", "success", "Levee inspection drones identified two deformation hotspots before field teams could access the delta.", 0.73, 0.9, "Launch inspection drones after peak ground acceleration alert", 0.81, 280),
]


def build_locations() -> list[dict]:
    now = utc_iso(3)
    result = []
    for location in LOCATIONS:
        item = dict(location)
        item["updated_at"] = now
        item["risk_trend"] = "rising" if item["combined_risk"] >= 0.79 else "stable"
        item["geometry"] = {"type": "Point", "coordinates": [item["longitude"], item["latitude"]]}
        result.append(item)
    return result


def build_memories() -> list[dict]:
    items = []
    for memory_id, location_id, hazard, outcome_label, content, importance, confidence, tactic, effectiveness, age in MEMORY_BLUEPRINTS:
        location = next(loc for loc in LOCATIONS if loc["id"] == location_id)
        items.append(
            {
                "id": memory_id,
                "location_id": location_id,
                "location_name": location["name"],
                "simulation_id": None,
                "agent_id": "agent-commander",
                "memory_type": "episode",
                "hazard": hazard,
                "title": f"{location['name']} {hazard.replace('_', ' ')} after-action",
                "content": content,
                "importance": importance,
                "confidence": confidence,
                "outcome": {"label": outcome_label, "effectiveness": effectiveness},
                "metadata": {"recommended_tactic": tactic, "source": "historical exercise"},
                "embedding": embed_text(f"{hazard} {location['terrain']} {content} {tactic}"),
                "created_at": utc_iso(age),
                "last_accessed_at": utc_iso(min(age, 60)),
                "access_count": 2 + age % 7,
            }
        )
    return items


def build_agents() -> list[dict]:
    specs = [
        ("agent-risk", "Risk Assessor", "risk_assessor", "satellite feature extraction", "analyzing"),
        ("agent-retriever", "Similarity Retriever", "memory_retriever", "vector + spatial recall", "ready"),
        ("agent-simulator", "Scenario Simulator", "simulator", "fire and earthquake modeling", "ready"),
        ("agent-planner", "Resource Planner", "resource_planner", "crew and shelter positioning", "ready"),
        ("agent-commander", "Incident Commander", "commander", "coordination and after-action learning", "monitoring"),
    ]
    return [
        {
            "id": item[0],
            "name": item[1],
            "role": item[2],
            "capability": item[3],
            "status": item[4],
            "region": "us-west-2",
            "last_heartbeat_at": utc_iso(index * 2),
            "memory_reads": 18 - index,
            "memory_writes": 7 + index,
        }
        for index, item in enumerate(specs)
    ]
