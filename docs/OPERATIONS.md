# Operations, observability, and resilience

## Health signals

- `GET /api/health` must identify `production` versus `demo`, database provider/persistence, Bedrock availability, and configuration errors without exposing secrets.
- Health is public for load-balancer/operator readiness. Dashboard, upload, assessment, simulation, memory, agent, and resilience routes are JWT-protected when `AuthMode=cognito`.
- API Gateway emits structured JSON access logs with request ID, route, status, response size, and integration error.
- Both Lambda log groups are retained 30 days and X-Ray tracing is active. Application logs should carry `request_id`, `simulation_id`/`assessment_id`, `object_key` hash or safe key, agent, memory mode, latency, and error class—never prompts, tokens, image bytes, or database URLs.
- CloudWatch alarms cover API errors/throttles and ingestion errors. When GuardDuty is enabled, EventBridge delivery and Lambda execution retries are bounded and exhausted events enter `SatelliteFailureQueue`. In trusted-source mode, the synchronous importer is traced through the API Lambda and browser uploads remain disabled.
- CockroachDB Cloud Console supplies SQL/transaction latency, contention, storage, and audit views; capture a sanitized screenshot for submission evidence.

## Suggested SLOs (post-load-test targets)

| Signal | Target |
|---|---|
| API availability | 99.9% monthly for read-only dashboard |
| Simulation request | p95 < 8 s; hard API budget 28 s |
| Image assessment | Establish separately for trusted-source import and, if enabled, quarantine upload through GuardDuty verdict; do not set a target until cloud runs measure latency |
| Memory write correctness | 100% acknowledged writes committed once by idempotency key |
| Memory recall | p95 < 750 ms on scoped top-k query at expected corpus size |
| Recovery point | CockroachDB acknowledged transaction; never claim `RPO 0` from a simulated Basic-plan demo |

## Runbook

### Elevated Lambda errors

1. Separate the API and satellite-ingestion functions; check `Errors`, `Duration`, `ConcurrentExecutions`, then correlate request ID or object key.
2. Split failures into input/4xx, Bedrock, CockroachDB, S3, or code exceptions.
3. Check recent stack/Lambda changes, then Cockroach Cloud and AWS service health.
4. If Bedrock alone is unhealthy, use deterministic simulation degradation; display it to users.
5. If durable DB writes are unhealthy, disable/deny writes rather than accepting untracked recommendations.

### Satellite ingestion alarm or dead-letter message

1. Stop new imports/uploads if failure volume is growing; do not broaden the source allowlist, quarantine prefix, or evidence gate.
2. In trusted-source mode, check the API Lambda's source HEAD/GET, S3 exact-version/hash verification, decode, Bedrock, and database stages. If GuardDuty is enabled, check its plan/status tags, EventBridge rule, ingestion Lambda, and encrypted queue. Do not paste image bytes, presigned fields, or user tokens into tickets.
3. Classify threat/unsupported/denied/failed scan, tag mismatch, validation, JPEG-2000 decode, Bedrock, S3, CockroachDB, or deployment errors. An assessment row may already exist because redelivery is idempotent by `object_key`.
4. Fix the cause and query CockroachDB for the object key before replay. Replay only the exact reviewed event; repeated valid deliveries return the existing assessment.
5. Delete a queue message only after the durable assessment/memory/audit transaction is confirmed or the input is explicitly rejected and documented.

### Load and concurrency tuning

1. Start read-only at `LOAD_CONCURRENCY=8 LOAD_DURATION=60 make load-test` with a short-lived `SENTINEL_LOAD_TOKEN`. Never put the token in a command argument or committed file.
2. Correlate harness p95/p99/errors with API Gateway 4xx/5xx, Lambda `Duration`/`ConcurrentExecutions`/`Throttles`, Bedrock throttles, and CockroachDB connections/SQL latency. A loopback result is only a harness check.
3. Change one control at a time: API throttle, API reserved concurrency, per-process DB pool, then ingestion concurrency. The approximate upper connection pressure is warm API environments × pool max plus ingestion environments × pool max.
4. Keep ingestion concurrency lower than API concurrency unless GuardDuty/Bedrock/database evidence justifies more. Increasing it fans out image downloads, decoding, Bedrock calls, and Cockroach writes.
5. Enable writes only with both `--include-writes` and `SENTINEL_LOAD_ALLOW_WRITES=true`, a dedicated test location, accepted model cost, and a cleanup/retention plan. Stop on rising error rate or throttling.
6. Save sanitized JSON results and parameter values with the commit/deployment ID. Do not infer production capacity from one region, one minute, or deterministic demo data.

### Authentication failures

1. Confirm stack `AuthMode` is `cognito`, Cognito issuer/client/scopes match the frontend build, and CORS is the exact CloudFront origin.
2. Distinguish 401 (missing/invalid/expired JWT) from 403 (valid token missing `openid` scope or `sentineltwin-operators` membership). Never log the token.
3. Confirm the frontend callback URI exactly matches the User Pool Client, required operator MFA enrollment is complete, group membership is current, and the browser clock is sane.
4. Rebuild with `make deploy-web` after stack/client changes. Do not work around auth by switching a production endpoint to `public`.

### CockroachDB connectivity

1. Check `GET /api/health`; never print the URL.
2. Run `ccloud cluster networking allowlist list <cluster>` and confirm the source is an approved administrator/application CIDR or private endpoint. `0.0.0.0/0` is demo-only; do not guess Lambda egress ranges.
3. Validate secret JSON key `DATABASE_URL`, TLS mode, credential validity, cluster state, and networking.
4. Inspect transaction retries/contention and connection counts. Lambda pool max is intentionally small.
5. Replay only idempotent operations. Verify the memory/audit row before retrying an uncertain commit.

### Vector recall regression

1. Run `make db-verify` and inspect `crdb_internal.table_indexes` for the C-SPANN vector statements.
2. `EXPLAIN` the exact `<->` L2 nearest-neighbor query; confirm a `vector search` with the equality prefix. `<=>` cosine distance does not use the current L2 operator class.
3. Compare query vector dimension/model version to stored rows.
4. Rebuild/backfill into a new versioned column/index; do not silently mix embedding spaces.

## Backup and recovery

CockroachDB Cloud backup/restore is managed via its control plane. Define retention and complete an actual restore drill before making RTO/RPO claims. `scripts/configure-multi-region.sh` only configures an already multi-region database and cannot prove failover. S3 artifact versioning helps recover overwrites, but retained old versions incur cost. CloudFormation retains the artifact bucket, Cognito pool, and Lambda logs on stack deletion.

## Safe rollback

Redeploy the last known-good git commit through SAM. Schema migrations must be backward compatible while old and new Lambda versions overlap. For breaking changes use expand → backfill → switch reads → contract. Do not drop a memory/vector column in the same release that stops writing it.

## Cost controls

- Basic CockroachDB plan and explicit spend limit are provisioning defaults; verify current pricing in Console.
- API/ingestion Lambda reserved concurrency defaults to 0/0 for this low-quota account; API throttle 20 req/s with burst 40, per-process DB pool cap 4, CloudFront PriceClass 100, bounded logs/retries, 14-day DLQ retention, and a small Bedrock model constrain demo spend.
- Cognito, Bedrock image/text use, cross-region Sentinel-2 transfer, S3 versions, and optional GuardDuty/EventBridge/SQS can incur charges or consume credits; verify current pricing and set budgets externally.
- Set AWS Budgets separately (not in this stack because notification identity is user-specific).
- Destroy unused web resources after judging and explicitly decide whether to retain evidence/DB data.
