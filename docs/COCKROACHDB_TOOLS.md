# CockroachDB tool usage and evidence

SentinelTwin qualifies through **Distributed Vector Indexing** and the **ccloud CLI**. Managed MCP and a repository-local Agent Skill add useful inspection/guardrails, but the submission must only mark them “used” after executing and capturing real evidence.

## 1. Distributed Vector Indexing — application-critical

DDL in `database/migrations/001_initial.sql` stores 32-dimensional deterministic feature-hash embeddings beside memory state and creates prefix-aware distributed vector indexes:

```sql
CREATE VECTOR INDEX IF NOT EXISTS agent_memories_hazard_embedding_idx
  ON agent_memories (hazard, embedding);
CREATE VECTOR INDEX IF NOT EXISTS agent_memories_region_embedding_idx
  ON agent_memories (region, embedding);
```

The production repository scopes by hazard and orders on CockroachDB L2 distance (`embedding <-> query::VECTOR`) so the `vector_l2_ops` index serves top-k recall. SentinelTwin's deterministic embeddings are unit normalized, so the API derives cosine similarity as `1 - (l2_distance² / 2)`. This is not ornamental: simulation planning retrieves memories through this path, and the completed run writes a new embedded `simulation_outcome` memory for later agents.

Evidence after deployment:

```bash
make db-verify
cockroach sql --url "$DATABASE_URL" --execute \
  "EXPLAIN SELECT id,title FROM agent_memories WHERE hazard='fire' ORDER BY embedding <-> '[REDACTED_32D_VECTOR]'::VECTOR LIMIT 4;"
```

Replace the redacted vector with the deterministic test vector in `database/verify.sql`; save sanitized `crdb_internal.table_indexes` and `EXPLAIN` output showing `vector search`. Vector index support/syntax assumes CockroachDB v25.4+.

## 2. ccloud CLI — repeatable cloud control plane

`scripts/provision-cockroach.sh` authenticates with `ccloud`, detects an existing named cluster, and creates a cost-capped Basic/Standard cluster explicitly on AWS plus the SentinelTwin database. It refuses to guess at an expensive Advanced topology and never handles a SQL password non-interactively.

For an already-provisioned cluster with at least three physical regions, `make db-multi-region` validates the named topology and prints a dry run. It requires both `MULTI_REGION_APPLY=true` and an exact database-specific confirmation before changing database regions/survival/locality; it never creates or resizes the paid cluster.

Evidence commands:

```bash
ccloud cluster list
ccloud cluster info sentineltwin
ccloud cluster database list sentineltwin
ccloud cluster sql --connection-params sentineltwin
```

Redact organization IDs, usernames, network details, and hosts when appropriate. `ccloud cluster create ...` is an external billable action; the transcript should come from the entrant's real run, not sample text.

## 3. Managed MCP Server — optional, safe inspection

The placeholder config at `infra/mcp/managed-mcp.example.json` targets `https://cockroachlabs.cloud/mcp`. Obtain the exact client snippet and cluster selection from CockroachDB Cloud Console, keep tokens outside git, enable read-only mode, and use a distinct least-privilege/audited identity.

Judge-friendly read-only prompts:

- “List SentinelTwin tables and describe `agent_memories`; do not mutate anything.”
- “Count memories by hazard and memory type.”
- “Show the latest five simulation outcome memories with IDs, timestamps, and source metadata.”
- “Show vector indexes on `agent_memories`.”

Config presence is not product usage. To claim MCP in Devpost, show a real read-only result and its CockroachDB Cloud audit event; do not expose OAuth/token material.

## 4. Agent Skill — reusable operational guardrails

`docs/agent-skills/sentinel-memory/SKILL.md` is a portable machine-readable project skill. It directs compatible agents to verify production mode, use scoped vector recall, preserve provenance, make idempotent transactional writes, and fail closed on uncertain persistence.

To claim Agent Skills as a hackathon tool, load the skill in a compatible coding/agent client, execute its verification workflow against the deployed cluster, and retain the sanitized transcript. A file alone demonstrates readiness, not execution.

## Honest evidence matrix

| Tool | Code/config present | Requires live proof before checked “used” |
|---|---:|---:|
| Distributed vector indexing | Yes | Schema applied, query and index verified |
| ccloud CLI | Yes | Real cluster provision/info transcript |
| Managed MCP Server | Example only | OAuth/token connection, read query, audit event |
| Agent Skills | Project skill present | Compatible-agent invocation transcript |
