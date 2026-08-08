# 2:40 demo script

Target: **2 minutes 40 seconds**, leaving 20 seconds under the hard three-minute limit. Record at 1080p, enlarge browser/terminal text, hide bookmarks/account identifiers, and preload all tabs. Never show a database URL, token, secret value, or AWS account ID.

## 0:00–0:18 — problem and promise

**Screen:** SentinelTwin dashboard overview/map.

**Say:** “Disaster response agents cannot afford amnesia. SentinelTwin turns satellite-derived terrain signals into multi-hazard risk, retrieves similar response history, simulates options, and learns from every outcome. CockroachDB is the durable shared memory that makes the second decision better than the first.”

## 0:18–0:38 — architecture proof

**Screen:** README architecture diagram.

**Say:** “Cognito signs the planner in with authorization code and PKCE, then API Gateway validates the access token. Browser uploads and real Sentinel-2 scenes enter private S3 quarantine. GuardDuty scans the exact version; only a verified clean tag reaches the assessment Lambda and Bedrock. Structured risk, simulation history, audit events, and vectors remain transactionally consistent in CockroachDB Cloud on AWS.”

## 0:38–1:00 — satellite assessment writes memory

**Screen:** The AWS Open Data mode with the prepared Santa Rosa Sentinel-2 L2A object key. Keep a clean uploaded-image path prepared as backup.

**Action:** Import the real scene, then show its upstream `sentinel-s2-l2a` key/hash, GuardDuty `NO_THREATS_FOUND`, `amazon-bedrock` provider, confidence, and persistent status. If scanning is too slow for the recording, import immediately beforehand and show the resulting tag, CockroachDB row, and CloudWatch trace—do not pretend it completed live.

**Say:** “This is a real Sentinel-2 Level-2A true-colour scene from AWS Open Data, not our deterministic tile. The API only allows the fixed public bucket and key shape, copies it into private quarantine, validates size and JPEG-2000 bytes, then GuardDuty gates analysis. Bedrock receives bounded image bytes only after the clean tag, and CockroachDB atomically commits the assessment, updated location, learned memory, and audit event.”

## 1:00–1:28 — first decision writes memory

**Screen:** Select the highest-risk location; open scenario modal; memory count visible.

**Action:** Choose wildfire, 82% intensity, 12-hour horizon, cascading power impact, ‘use memory’ on; run.

**Say:** “The retriever scopes prior memories by hazard and location, uses CockroachDB’s distributed vector index for similarity, then the simulator and Bedrock planner produce a human-reviewable recommendation. This result, provenance, model ID, and outcome are committed back as one durable run.”

**Point out:** run ID, retrieved-memory count, confidence, source/freshness, memory count increment. Do not call deterministic fixtures “live satellite data.”

## 1:28–1:52 — second decision proves recall

**Action:** Rerun or open a related nearby scenario. Show the first run/memory being retrieved.

**Say:** “On the next decision, SentinelTwin does not start over. It recalls the just-committed situation, cites the memory ID, and reuses the learned plan. This is load-bearing memory: remove CockroachDB and the agent cannot truthfully preserve or coordinate this state.”

**Critical evidence:** visibly show the same durable memory/run identifier from run one in run two. If this is not working live, do not fake it—record again after fixing.

## 1:52–2:13 — CockroachDB tool proof

**Screen:** sanitized terminal split view.

**Action:** Show `ccloud cluster info sentineltwin`; then `crdb_internal.table_indexes` and an `EXPLAIN` with `<->` showing `vector search`. Optionally show a read-only Managed MCP query and audit log.

**Say:** “We provision and inspect the AWS-hosted cluster with the agent-ready ccloud CLI. Vector recall runs in CockroachDB beside transactional state. We also provide a read-only Managed MCP configuration and a reusable Agent Skill encoding safe memory and failure rules.”

Only claim MCP as used if it is actually connected and audited; otherwise say “integration-ready example.” Two qualifying tools are already ccloud + distributed vector indexing.

## 2:13–2:28 — resilience and honesty

**Screen:** resilience panel/health response and CloudWatch.

**Action:** Trigger the simulated region-failure control; show memory availability/degraded-state label and a request trace.

**Say:** “Failures are explicit. Bedrock fallback is labeled; Cockroach write loss can never masquerade as saved memory. Cognito JWTs, least-privilege IAM, Secrets Manager, bounded retries, an encrypted dead-letter queue, logs, X-Ray, and alarms support production operation.”

Say “simulated region failure,” not “live zero-RPO failover,” unless a real multi-region drill was recorded.

## 2:28–2:40 — close

**Screen:** improved plan metrics and memory rail.

**Say:** “SentinelTwin gives emergency planners a digital twin that accumulates evidence instead of forgetting it—serverless on AWS, durable and vector-searchable in CockroachDB, and always subject to human approval.”

## Recording acceptance check

- [ ] Duration is below 3:00 on YouTube/Vimeo, not just in the editor.
- [ ] Public/unlisted access meets the hackathon rule; test logged out.
- [ ] Text and memory IDs are readable at normal playback.
- [ ] No passwords, database hosts/URLs, tokens, account IDs, personal data, or browser autofill appear.
- [ ] The first write and second recall are visibly connected.
- [ ] Satellite evidence is either demonstrably live on Bedrock/S3 or explicitly labeled demo/fallback.
- [ ] Real imagery provenance and GuardDuty clean evidence are readable; no claim suggests scanning guarantees geospatial truth.
- [ ] AWS and CockroachDB tool evidence is real and accurately described.
- [ ] Safety, demo-data, and simulated-failure language is honest.
