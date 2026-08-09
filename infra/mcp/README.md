# CockroachDB Cloud Managed MCP — read-only inspection

CockroachDB Cloud's managed server is a judge/operator inspection path. SentinelTwin's validated API remains the only application write path. The checked-in example follows CockroachDB's OAuth-first configuration and contains no credential or cluster identifier.

1. In CockroachDB Cloud, open the cluster's **Connect → Model Context Protocol (MCP)** tab and copy its generated configuration. The console is authoritative.
2. Configure `https://cockroachlabs.cloud/mcp` with the `mcp-cluster-id` header. Keep the real cluster ID in the local client only, never in git.
3. Authenticate with OAuth. At **Authorize MCP Access**, grant **read only** and do not grant write permission.
4. Run only schema inspection and the projections in `read-only-evidence.sql`. They intentionally omit memory text and arbitrary JSON fields.
5. Capture sanitized evidence of the tables, vector indexes, assessment row, simulation row, and learned-memory ID. Redact cluster, organization, user, and host identifiers.
6. Revoke the OAuth connection after judging.

For Codex, the local configuration shape is:

```toml
[mcp_servers.cockroachdb-cloud]
url = "https://cockroachlabs.cloud/mcp"
http_headers = { "mcp-cluster-id" = "<local-cluster-id>" }
```

Then run `codex mcp login cockroachdb-cloud` and choose read-only consent in the browser. Merely adding configuration does not justify claiming MCP usage—capture a real read through Managed MCP and its audit evidence first.
