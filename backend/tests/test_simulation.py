from sentineltwin.seed import build_locations, build_memories
from sentineltwin.simulation import run_simulation


def test_fire_simulation_is_deterministic_and_has_timeline():
    location = build_locations()[0]
    inputs = {"wind_speed_mph": 36, "response_delay_minutes": 42}
    first = run_simulation(location, "fire", inputs, [], requested_seed=77)
    second = run_simulation(location, "fire", inputs, [], requested_seed=77)
    assert first["outcome"] == second["outcome"]
    assert len(first["timeline"]) >= 6
    assert first["outcome"]["acres_burned"] > 0
    assert first["outcome"]["people_exposed"] >= 0


def test_recalled_memory_reduces_fire_impact():
    location = build_locations()[0]
    memory = build_memories()[0]
    memory["similarity"] = 0.95
    without_memory = run_simulation(location, "fire", {}, [], requested_seed=8)
    with_memory = run_simulation(location, "fire", {}, [memory], requested_seed=8)
    assert with_memory["memory_context"]["learned_modifier"] > 0
    assert with_memory["outcome"]["impact_score"] <= without_memory["outcome"]["impact_score"]


def test_multi_hazard_exposes_cascading_effects():
    location = build_locations()[2]
    simulation = run_simulation(location, "multi_hazard", {}, [], requested_seed=99)
    assert simulation["outcome"]["cascading_failure_score"] >= 0
    assert "fire" in simulation["outcome"]
    assert "earthquake" in simulation["outcome"]
