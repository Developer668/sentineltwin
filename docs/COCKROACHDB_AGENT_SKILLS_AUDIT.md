# CockroachDB Agent Skills execution audit

Date: 2026-08-16  
Official repository: `cockroachdb/agent-skills`  
Reviewed revision: `e14e86da9f392fb36e58ca328999e23a1290033b`

The following official skills were loaded in full and applied to SentinelTwin:

- `cockroachdb-application-development/designing-application-transactions`
- `cockroachdb-security-and-governance/hardening-user-privileges`

## Transaction design result

- The simulation row, learned vector memory, and both audit events commit in one CockroachDB serializable transaction in `save_simulation_with_memory`.
- SQLSTATE `40001` restarts the entire callback with a bounded four-attempt policy.
- The audit found deterministic retry timing, which can synchronize concurrent Lambda callers. The implementation now uses bounded full jitter and has a regression test proving two contention failures re-execute the complete transaction before a single commit.
- Vector retrieval is parameterized, equality-prefixed by hazard, ordered with `embedding <-> %s::VECTOR`, and bounded by `LIMIT` so the distributed vector index can serve recall.
- A failed or uncertain database write raises an error; the API never reports a memory as persisted before CockroachDB acknowledges the transaction.
- Satellite ingestion is idempotent by unique object key. Simulation IDs are allocated before the transaction and reused by CockroachDB serialization retries; cross-request idempotency remains a documented hardening item for a post-hackathon API revision.

## Privilege hardening result

- The SPA receives Cognito tokens only; it never receives a CockroachDB URL, SQL password, or AWS secret.
- Secrets Manager supplies the database URL only to the two narrowly scoped Lambda roles.
- Deployment guidance separates the bootstrap `sentinel_admin` identity from the intended `sentinel_app` runtime identity and explicitly limits application access to the SentinelTwin database/schema and required DML/sequences.
- Managed MCP is configuration-only and is not selected as a used submission tool. Any future inspection identity must be read-only and separate from both admin and runtime roles.

## Live verification boundary

Code, unit tests, CloudFormation boundaries, and documentation were reviewed. The public API health check proves a real CockroachDB connection, while the CockroachDB Cloud usage dashboard proves live SQL/storage activity. The exact SQL username and live grants are intentionally not exposed by the public health response. Before calling the prototype a long-lived production service, an operator should verify `SHOW GRANTS` in an authenticated SQL session and rotate the Secrets Manager URL to `sentinel_app` if the bootstrap administrator is still in use.

## Evidence commands

```bash
make test
make lint
make db-verify
```

The first two commands are safe local checks. `make db-verify` requires an authenticated CockroachDB URL and must be captured only after sanitizing organization, host, user, and cluster identifiers.
