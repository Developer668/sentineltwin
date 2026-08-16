from sentineltwin.repository import CockroachRepository


class _RetryCursor:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class _RetryConnection:
    def __init__(self):
        self.commits = 0

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def cursor(self):
        return _RetryCursor()

    def commit(self):
        self.commits += 1


class _SerializationFailure(Exception):
    sqlstate = "40001"


def test_serialization_retry_reexecutes_whole_transaction_with_bounded_jitter(monkeypatch):
    repository = object.__new__(CockroachRepository)
    connections = []

    def connect():
        connection = _RetryConnection()
        connections.append(connection)
        return connection

    calls = 0

    def operation(_cursor):
        nonlocal calls
        calls += 1
        if calls < 3:
            raise _SerializationFailure()
        return "committed"

    jitter_bounds = []
    monkeypatch.setattr(repository, "_connect", connect)
    monkeypatch.setattr(
        "sentineltwin.repository.random.uniform",
        lambda lower, upper: jitter_bounds.append((lower, upper)) or upper,
    )
    monkeypatch.setattr("sentineltwin.repository.time.sleep", lambda _seconds: None)

    assert repository._write(operation) == "committed"
    assert calls == 3
    assert jitter_bounds == [(0.0, 0.025), (0.0, 0.05)]
    assert [connection.commits for connection in connections] == [0, 0, 1]


def test_cross_prefix_vector_merge_ranks_l2_distance_before_importance():
    repository = object.__new__(CockroachRepository)

    def fake_read(_sql, params=(), one=False):
        assert one is False
        hazard = params[1]
        base = {
            "location_id": None,
            "location_name": None,
            "simulation_id": None,
            "agent_id": None,
            "memory_type": "observation",
            "title": "memory",
            "content": "content",
            "confidence": 0.9,
            "outcome": {},
            "metadata": {},
            "created_at": "2026-01-01T00:00:00Z",
            "last_accessed_at": "2026-01-01T00:00:00Z",
            "access_count": 0,
        }
        if hazard == "fire":
            return [{**base, "id": "far-important", "hazard": "fire", "importance": 0.99, "vector_distance": 0.8}]
        assert hazard == "multi_hazard"
        return [{**base, "id": "nearer", "hazard": "multi_hazard", "importance": 0.2, "vector_distance": 0.1}]

    repository._read = fake_read
    repository._write = lambda _callback: None

    memories = repository.list_memories(query="fire response", hazard="fire", limit=1)

    assert memories[0]["id"] == "nearer"
    assert memories[0]["vector_distance"] == 0.1
    assert memories[0]["similarity"] == 0.995


def test_single_node_cockroach_metadata_does_not_verify_topology():
    repository = object.__new__(CockroachRepository)
    repository._read = lambda *_args, **_kwargs: {
        "database_name": "sentineltwin",
        "primary_region": None,
        "secondary_region": None,
        "regions": [],
        "survival_goal": None,
    }

    topology = repository._database_topology()

    assert topology == {
        "topology_verified": False,
        "regions": [],
        "survival_goal": None,
        "topology_source": "cockroachdb:SHOW DATABASES",
        "configured_rpo_seconds": None,
        "observed_rpo_seconds": None,
    }


def test_three_regions_and_region_survival_are_required_for_verified_topology():
    repository = object.__new__(CockroachRepository)
    repository._read = lambda *_args, **_kwargs: {
        "database_name": "sentineltwin",
        "primary_region": "us-west-2",
        "secondary_region": "us-east-1",
        "regions": ["us-west-2", "us-east-1", "eu-west-1"],
        "survival_goal": "region",
    }

    topology = repository._database_topology()

    assert topology["topology_verified"] is True
    assert topology["survival_goal"] == "region"
    assert topology["configured_rpo_seconds"] == 0
    assert topology["observed_rpo_seconds"] is None
    assert [region["role"] for region in topology["regions"]] == ["primary", "secondary", "database-region"]
