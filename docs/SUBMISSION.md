# Hackathon submission packet

Do not check or paste a URL until it works in a logged-out/private browser.

## Required URLs

- [x] Public open-source repository: [github.com/Developer668/sentineltwin](https://github.com/Developer668/sentineltwin)
- [ ] Functional demo app: `TBD`
- [ ] Public YouTube/Vimeo video under 3:00: `TBD`
- [x] License visible/detectable at repository top level: [MIT](../LICENSE)

## Suggested title and tagline

**SentinelTwin — disaster-response agents that remember**

An AWS-native multi-hazard digital twin that evaluates terrain risk, retrieves semantically similar response history, simulates response plans, and learns through CockroachDB Cloud's durable transactional and vector memory.

## 200-word submission description

Disaster-response agents cannot afford amnesia. SentinelTwin is a multi-hazard digital twin that turns satellite-derived terrain features into wildfire and earthquake risk, retrieves similar historical situations, simulates response options, and persists each decision and outcome for the next agent run.

CockroachDB Cloud is the sole durable system of record for locations, risk assessments, agent state, simulations, provenance, audit events, and fixed-dimension memory embeddings. Its distributed vector index keeps semantic recall beside operational and spatial data, avoiding a second vector store and consistency gaps. We use the agent-ready `ccloud` CLI to provision and inspect the AWS-hosted cluster. A repository-local Agent Skill encodes safe query, provenance, transaction, and degraded-mode rules; an optional read-only Managed MCP configuration supports audited inspection.

AWS Lambda runs the agent loop behind a Cognito-JWT-protected API Gateway HTTP API. Real Sentinel-2 L2A imagery is read from AWS Open Data through a fixed bucket/key allowlist, while browser uploads use a constrained presigned POST. Both enter private S3 quarantine. GuardDuty Malware Protection scans the exact object version; only its independently verified clean tag can trigger bounded JPEG-2000 conversion and Amazon Bedrock `Converse`. Assessment/location/memory/audit data then commit atomically in CockroachDB. Least-privilege IAM, tunable throttles/concurrency, a safe load harness, logs, alarms, X-Ray, bounded retries, and an encrypted SQS dead-letter queue support production readiness.

The demo proves load-bearing memory: run one commits an outcome; run two recalls that exact durable memory and adapts its plan. Any fallback, simulated outage, or stale source is labeled honestly and remains subject to human approval.

## CockroachDB tools used

- [ ] **Distributed Vector Indexing:** production DDL and scoped nearest-neighbor query are applied; attach sanitized `crdb_internal.table_indexes` plus `EXPLAIN` proof showing `vector search`.
- [ ] **ccloud CLI:** attach sanitized cluster creation/info transcript showing AWS region/plan.
- [ ] **Managed MCP Server (optional third tool):** only check after a real read-only query and audit event; endpoint/config alone is not “used.”
- [ ] **Agent Skills:** repository-local skill at `docs/agent-skills/sentinel-memory/SKILL.md`; attach the run/review evidence if claiming official-tool use.

## AWS services used

- [ ] **Lambda:** Python 3.12 agent API; show function and successful invocation.
- [ ] **API Gateway HTTP API:** HTTPS `/api` routes, CORS, access logs, throttling.
- [ ] **Amazon Bedrock:** `Converse` planning; show sanitized model/CloudWatch evidence.
- [ ] **Amazon S3 + GuardDuty + EventBridge:** private quarantine, exact-version malware verdict/tag gate, asynchronous assessment, versioned artifacts, and private web origin.
- [ ] **Sentinel-2 AWS Open Data:** real L2A R60m true-colour import with fixed source allowlist, signature/size checks, conversion, and upstream hash provenance.
- [ ] **Amazon Cognito:** no-secret OAuth code + PKCE SPA login and API Gateway JWT authorization.
- [ ] **Secrets Manager / SQS / CloudWatch / X-Ray / CloudFront:** secret loading, failed-ingestion queue, operations, tracing, and private-origin delivery.

## Judge-criteria evidence

| Criterion | Evidence to link/show |
|---|---|
| Agentic memory design | First-run memory ID recalled in second run; schema transaction and vector query. |
| Technical implementation | ccloud transcript, `vector search` `EXPLAIN`, API + image-ingestion Lambda traces, tests/CI. |
| Real-world impact | Location risk → simulation → resource plan flow with provenance/human approval. |
| Production readiness | IAM policy, Secrets Manager, private S3 quarantine, GuardDuty rejection proof, load results, failure semantics, alarms/runbook. |
| Creativity | Multi-hazard twin combining spatial state, semantic memory, simulation, and learning. |

## Final preflight

- [ ] `make test`, `make lint`, SAM validation, DB verification, and deployed smoke test pass.
- [ ] Repository contains source, locked dependencies, example env, setup/deploy docs, schema/seed, license.
- [ ] Demo mode is not accidentally enabled in the qualifying production recording.
- [ ] Health identifies CockroachDB as persistent provider.
- [ ] Bedrock output is live in at least one shown flow; deterministic fallback is labeled.
- [ ] A real S3 upload and a real Sentinel-2 import each produce a clean-tagged `amazon-bedrock`, `persisted=true` assessment with S3/upstream provenance and CockroachDB memory ID.
- [ ] A controlled GuardDuty rejection stays quarantined and creates no Bedrock assessment or learned memory.
- [ ] Authenticated cloud load-test JSON and matching Lambda/Cockroach metrics support every concurrency claim; loopback figures are labeled local only.
- [ ] Cognito login succeeds through authorization code + PKCE; protected API rejects missing/expired tokens.
- [ ] CORS is the exact demo origin; no secrets/hosts in frontend bundle or repository history.
- [ ] README screenshots/claims match the build actually submitted.
- [ ] Public video is under 3:00 and tested logged out.
- [ ] Optional tool claims are checked only with real evidence.

## Optional product feedback prompts

- How easy was it to discover the correct vector-index syntax and verify index use?
- Did Managed MCP make read-only inspection safer/faster than building a proxy?
- Could `ccloud` JSON output and service-account RBAC support unattended agent provisioning cleanly?
- Which Agent Skills materially prevented schema/security mistakes?
