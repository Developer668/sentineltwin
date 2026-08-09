import json
import re
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def test_managed_mcp_example_is_oauth_first_and_uses_the_official_cluster_header():
    config = json.loads(
        (PROJECT_ROOT / "infra" / "mcp" / "managed-mcp.example.json").read_text(encoding="utf-8")
    )
    server = config["mcpServers"]["cockroachdb-cloud"]

    assert server == {
        "type": "http",
        "url": "https://cockroachlabs.cloud/mcp",
        "headers": {"mcp-cluster-id": "${COCKROACH_CLUSTER_ID}"},
    }
    assert "Authorization" not in json.dumps(server)


def test_managed_mcp_evidence_queries_are_select_only_and_sanitized():
    query_file = (PROJECT_ROOT / "infra" / "mcp" / "read-only-evidence.sql").read_text(
        encoding="utf-8"
    )
    assert re.search(r"(?im)^\s*SELECT\b", query_file)
    assert re.search(r"(?im)^\s*SHOW\b", query_file)
    for forbidden in ("INSERT", "UPDATE", "DELETE", "UPSERT", "DROP", "ALTER", "CREATE"):
        assert not re.search(rf"(?im)^\s*{forbidden}\b", query_file)
    assert not re.search(r"(?i)\bcontent\b", query_file)
    assert not re.search(r"(?i)\bmetadata\b", query_file)
