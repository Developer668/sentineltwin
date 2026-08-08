"""Deterministic, explainable multi-hazard simulation engine."""

from __future__ import annotations

import hashlib
import math
import random
from datetime import datetime, timezone
from typing import Any

from .errors import ValidationError
from .memory import memory_learning_modifier

HAZARDS = {"fire", "earthquake", "multi_hazard"}
UTC = timezone.utc


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _round_map(values: dict[str, Any]) -> dict[str, Any]:
    return {key: round(value, 3) if isinstance(value, float) else value for key, value in values.items()}


def _seed_for(location_id: str, hazard: str, requested_seed: int | None) -> int:
    if requested_seed is not None:
        return int(requested_seed)
    digest = hashlib.sha256(f"sentineltwin:{location_id}:{hazard}".encode()).digest()
    return int.from_bytes(digest[:4], "big")


def _severity(score: float) -> str:
    if score >= 0.85:
        return "catastrophic"
    if score >= 0.68:
        return "severe"
    if score >= 0.48:
        return "major"
    if score >= 0.28:
        return "moderate"
    return "limited"


def simulate_fire(
    location: dict,
    parameters: dict,
    learned_modifier: float,
    rng: random.Random,
) -> tuple[dict, list[dict], list[str]]:
    """Approximate wind-driven fire growth in 15-minute discrete steps.

    This is intentionally transparent rather than operational forecasting. It
    models elliptical spread from fuel, dryness, wind and slope, then applies
    response and memory-derived mitigation to structure exposure.
    """
    vegetation = _clamp(float(parameters.get("vegetation_density", location["vegetation_density"])))
    moisture = _clamp(float(parameters.get("moisture_percent", location["moisture_percent"])) / 100)
    wind = max(0.0, min(90.0, float(parameters.get("wind_speed_mph", location["wind_speed_mph"]))))
    slope = max(0.0, min(60.0, float(parameters.get("slope_degrees", location["slope_degrees"]))))
    response_delay = max(0.0, min(180.0, float(parameters.get("response_delay_minutes", 28))))
    suppression = _clamp(float(parameters.get("suppression_strength", 0.58)))
    duration_minutes = int(max(60, min(720, parameters.get("duration_minutes", 180))))
    steps = max(4, duration_minutes // 15)

    dryness = 1 - moisture
    wind_factor = _clamp(wind / 45)
    slope_factor = _clamp(slope / 40)
    ignition_intensity = _clamp(0.34 * vegetation + 0.28 * dryness + 0.24 * wind_factor + 0.14 * slope_factor)
    response_effect = suppression * _clamp(1 - response_delay / 210) + learned_modifier
    radius = 0.06
    timeline: list[dict] = []
    containment = 0.0
    max_acres = 0.0

    for step in range(steps + 1):
        minute = step * 15
        gust = 0.92 + rng.random() * 0.18
        active_response = response_effect if minute >= response_delay else 0.0
        spread_rate = max(0.002, (0.018 + ignition_intensity * 0.115) * gust * (1 - active_response * 0.72))
        if step:
            radius += spread_rate * 0.25
        # Wind produces an ellipse; 1 square mile = 640 acres.
        ellipse_ratio = 1 + wind_factor * 1.8
        acres = math.pi * radius * (radius / ellipse_ratio) * 640
        max_acres = max(max_acres, acres)
        containment = _clamp(containment + max(0, active_response - ignition_intensity * 0.52) * 0.13)
        if minute == 0 or minute % 30 == 0 or step == steps:
            timeline.append(
                _round_map(
                    {
                        "minute": minute,
                        "acres_burned": acres,
                        "spread_radius_miles": radius,
                        "containment_percent": containment * 100,
                        "flame_intensity": ignition_intensity * (1 - containment * 0.45),
                    }
                )
            )

    exposure_rate = _clamp(max_acres / 2600) * (0.62 + vegetation * 0.38)
    damage_rate = _clamp(exposure_rate * (1 - response_effect * 0.46))
    population = int(location["population"])
    facilities = int(location["critical_facilities"])
    people_exposed = round(population * _clamp(exposure_rate * 0.72))
    structures = round(population / 2.55 * damage_rate * 0.28)
    facilities_hit = min(facilities, round(facilities * damage_rate * 0.45))
    containment_minutes = duration_minutes if containment < 0.8 else next(
        (point["minute"] for point in timeline if point["containment_percent"] >= 80), duration_minutes
    )
    impact = _clamp(ignition_intensity * 0.48 + damage_rate * 0.52)
    resilience = _clamp(1 - impact + response_effect * 0.22)
    outcome = _round_map(
        {
            "severity": _severity(impact),
            "impact_score": impact,
            "acres_burned": max_acres,
            "people_exposed": people_exposed,
            "evacuations": round(people_exposed * 0.78),
            "structures_impacted": structures,
            "critical_facilities_impacted": facilities_hit,
            "containment_minutes": containment_minutes,
            "estimated_loss_usd": round(structures * 535000 + facilities_hit * 8_500_000, -3),
            "resilience_score": resilience * 100,
            "learned_impact_reduction_percent": learned_modifier * 100,
        }
    )
    recommendations = [
        "Pre-position engines along the downwind urban interface",
        "Issue zone-based evacuation warnings before the first wind shift",
    ]
    if wind >= 25:
        recommendations.insert(0, "Launch air attack early; sustained winds favor long-range ember spotting")
    if response_delay > 35:
        recommendations.append("Reduce dispatch-to-arrival time below 30 minutes")
    return outcome, timeline, recommendations


def simulate_earthquake(
    location: dict,
    parameters: dict,
    learned_modifier: float,
    rng: random.Random,
) -> tuple[dict, list[dict], list[str]]:
    """Estimate shaking and cascading impact with a simple fragility curve."""
    magnitude = max(4.0, min(8.5, float(parameters.get("magnitude", 6.7))))
    distance_km = max(1.0, min(250.0, float(parameters.get("fault_distance_km", 14))))
    soil = max(0.7, min(2.2, float(parameters.get("soil_amplification", location["soil_amplification"]))))
    retrofit = _clamp(float(parameters.get("retrofit_ratio", 0.43)))
    response_readiness = _clamp(float(parameters.get("response_readiness", 0.68)) + learned_modifier)
    duration_minutes = int(max(60, min(1440, parameters.get("duration_minutes", 360))))

    attenuation = math.exp(-distance_km / 62)
    pga = min(1.8, 0.055 * 10 ** (0.42 * (magnitude - 5)) * attenuation * soil)
    shaking = _clamp(pga / 0.72)
    fragility = _clamp((shaking - retrofit * 0.31) * soil * 0.83)
    aftershock_probability = _clamp(0.24 + (magnitude - 6) * 0.21)
    lifeline_disruption = _clamp(fragility * 0.78 + soil * 0.08 - response_readiness * 0.18)
    population = int(location["population"])
    facilities = int(location["critical_facilities"])
    structures = round(population / 2.55 * fragility * 0.19)
    facilities_hit = min(facilities, round(facilities * lifeline_disruption * 0.52))
    people_exposed = round(population * _clamp(shaking * 0.91))
    displaced = round(population * fragility * 0.24)
    impact = _clamp(fragility * 0.63 + lifeline_disruption * 0.37)
    resilience = _clamp(1 - impact + response_readiness * 0.2)

    checkpoints = [0, 1, 5, 15, 30, 60, 120, duration_minutes]
    timeline = []
    for minute in sorted(set(checkpoints)):
        restored = _clamp((minute / max(duration_minutes, 1)) * response_readiness * 0.55)
        timeline.append(
            _round_map(
                {
                    "minute": minute,
                    "peak_ground_acceleration_g": pga if minute <= 1 else 0.0,
                    "aftershock_probability": aftershock_probability * math.exp(-minute / 720),
                    "lifeline_disruption_percent": lifeline_disruption * (1 - restored) * 100,
                    "response_capacity_percent": (response_readiness + restored * 0.45) * 100,
                }
            )
        )

    outcome = _round_map(
        {
            "severity": _severity(impact),
            "impact_score": impact,
            "magnitude": magnitude,
            "peak_ground_acceleration_g": pga,
            "aftershock_probability": aftershock_probability,
            "people_exposed": people_exposed,
            "evacuations": displaced,
            "structures_impacted": structures,
            "critical_facilities_impacted": facilities_hit,
            "estimated_loss_usd": round(structures * 410000 + facilities_hit * 13_000_000, -3),
            "resilience_score": resilience * 100,
            "learned_impact_reduction_percent": learned_modifier * 100,
        }
    )
    recommendations = [
        "Inspect hospitals, bridges, and communications nodes in the first response wave",
        "Keep shelter capacity distributed across fault crossings",
        "Reserve response capacity for likely aftershocks during the first six hours",
    ]
    if soil >= 1.35:
        recommendations.insert(0, "Prioritize liquefaction-prone zones identified by soil amplification")
    return outcome, timeline, recommendations


def run_simulation(
    location: dict,
    hazard: str,
    parameters: dict | None = None,
    memories: list[dict] | None = None,
    requested_seed: int | None = None,
) -> dict:
    hazard = hazard.strip().lower().replace("-", "_")
    if hazard not in HAZARDS:
        raise ValidationError("hazard must be fire, earthquake, or multi_hazard")
    parameters = parameters or {}
    memories = memories or []
    seed = _seed_for(str(location["id"]), hazard, requested_seed)
    rng = random.Random(seed)
    modifier, learned_tactics = memory_learning_modifier(memories)
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")

    if hazard == "fire":
        outcome, timeline, recommendations = simulate_fire(location, parameters, modifier, rng)
    elif hazard == "earthquake":
        outcome, timeline, recommendations = simulate_earthquake(location, parameters, modifier, rng)
    else:
        fire, fire_timeline, fire_recs = simulate_fire(location, parameters.get("fire", parameters), modifier, rng)
        quake, quake_timeline, quake_recs = simulate_earthquake(location, parameters.get("earthquake", parameters), modifier, rng)
        cascade = _clamp((fire["impact_score"] * quake["impact_score"]) * 0.38)
        impact = _clamp(fire["impact_score"] * 0.44 + quake["impact_score"] * 0.46 + cascade)
        outcome = {
            "severity": _severity(impact),
            "impact_score": round(impact, 3),
            "fire": fire,
            "earthquake": quake,
            "cascading_failure_score": round(cascade, 3),
            "people_exposed": max(fire["people_exposed"], quake["people_exposed"]),
            "evacuations": fire["evacuations"] + quake["evacuations"],
            "structures_impacted": fire["structures_impacted"] + quake["structures_impacted"],
            "critical_facilities_impacted": min(
                location["critical_facilities"],
                fire["critical_facilities_impacted"] + quake["critical_facilities_impacted"],
            ),
            "estimated_loss_usd": fire["estimated_loss_usd"] + quake["estimated_loss_usd"],
            "resilience_score": round((fire["resilience_score"] + quake["resilience_score"]) / 2 - cascade * 15, 3),
            "learned_impact_reduction_percent": round(modifier * 100, 2),
        }
        timeline = [{"hazard": "fire", **point} for point in fire_timeline] + [
            {"hazard": "earthquake", **point} for point in quake_timeline
        ]
        timeline.sort(key=lambda point: (point["minute"], point["hazard"]))
        recommendations = list(dict.fromkeys(fire_recs[:2] + quake_recs[:2] + [
            "Keep redundant evacuation routes open after shaking ignites secondary fires"
        ]))

    recommendations = list(dict.fromkeys(learned_tactics + recommendations))[:6]
    return {
        "hazard": hazard,
        "status": "completed",
        "seed": seed,
        "started_at": now,
        "completed_at": now,
        "parameters": parameters,
        "outcome": outcome,
        "timeline": timeline,
        "recommendations": recommendations,
        "memory_context": {
            "retrieved_count": len(memories),
            "memory_ids": [item["id"] for item in memories],
            "learned_modifier": modifier,
            "learned_tactics": learned_tactics,
        },
        "disclaimer": "Decision-support simulation only; not an operational hazard forecast.",
    }
