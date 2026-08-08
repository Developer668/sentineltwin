# SentinelTwin handoff

Last updated: 2026-08-08 (America/Los_Angeles)

## Honest current state

This repository is a hackathon-ready vertical slice with source, infrastructure-as-code, setup scripts, submission screenshots, and judge-facing documentation. **No AWS or CockroachDB Cloud resources have been created from this workspace.** The source is published at [Developer668/sentineltwin](https://github.com/Developer668/sentineltwin), but the live app/video and cloud evidence remain external items—not implied successes.

Local verification completed on 2026-08-08:

- Backend and frontend suites cover the API, Cockroach repository, vector recall, Cognito PKCE, upload quarantine, GuardDuty verdict handling, real Sentinel-2 import, JPEG-2000 conversion, input bounds, and load-test safety controls: **102 backend tests and 35 frontend tests passed**.
- `make lint` and `make security` passed: shell syntax, Python compilation/Ruff/Bandit, TypeScript, pip dependency audit, and pnpm dependency audit are clean.
- Frontend production build passed (Vite output generated successfully).
- Local API smoke passed in explicitly labeled deterministic demo mode. The isolated real-CockroachDB integration also passed health, dashboard read, two durable simulation writes, and exact first-memory recall during the second run.
- SAM/CI YAML parsed to an AST, all shell scripts passed `bash -n`, and the MCP example passed strict JSON parsing.
- `cfn-lint infra/template.yaml` passed locally. AWS SAM CLI validation/container packaging was **not** run because SAM CLI is not installed in this environment; the arm64 CI job runs `sam validate --lint` and `sam build --use-container`, which remain required before deploy.
- A final controlled run with the checksum-verified official CockroachDB v25.4.14 binary passed cleanly on loopback: migrations `001`–`003`, health/dashboard, two durable simulations with exact first-memory recall on the second run, all three C-SPANN indexes, and an `<->` `EXPLAIN` showing `vector search` with the hazard equality prefix. The isolated process/store was cleaned up and the temporary binary was moved to Trash. This validates real CockroachDB behavior, **not** CockroachDB Cloud topology, `ccloud`, backups, or failover. No AWS deployment/service invocation was performed because credentials/model access are absent.
- Real-browser QA passed at desktop and 390×844: the dashboard hydrated, keyboard scenario controls worked, a 24-hour simulation completed with explicit human-review/non-persistence evidence, a demo imagery assessment remained truthfully synthetic, the mobile sheet had no horizontal overflow, and the console had no warnings or errors. The run also caught and fixed a 12-hour backend/72-hour UI contract mismatch before this handoff.
- The real public Sentinel-2 source path was exercised without AWS credentials against `sentinel-s2-l2a`: the Santa Rosa sample fetched 3,032,506 bytes with its real ETag, passed JPEG-2000 signature validation, and converted to a 721,449-byte JPEG for Bedrock. Destination S3, GuardDuty, EventBridge, Bedrock, and CockroachDB Cloud still require the cloud checks.
- The safe local read workload completed 1,152 requests at concurrency 8 with 0 errors, 226.58 req/s, p50 27.36 ms, p95 73.29 ms, and p99 122.85 ms. This is a loopback/deterministic benchmark, not a claim about AWS or CockroachDB Cloud capacity.
- A second higher-concurrency safety run completed 440 requests at concurrency 16 with 0 errors (35.85 req/s, p95 1.11 s). It validates bounded concurrency/error handling on this workstation; cloud tuning still requires authenticated Lambda/Cockroach metrics.
- Submission screenshots in `docs/images/` were captured from the running app and visibly preserve demo/ephemeral truth labels.

The AWS template targets `sentineltwin.app.lambda_handler` for the interactive API and `sentineltwin.app.satellite_event_handler` for asynchronous assessment on Python 3.12. It provisions Cognito JWT protection (health public), separate API/ingestion Lambdas, private S3 quarantine, GuardDuty Malware Protection with post-scan tagging, scan-result EventBridge delivery, encrypted SQS DLQ, private S3/CloudFront web delivery, logs/alarms, X-Ray, and least-privilege Bedrock/S3/Secrets Manager access. Raw S3 object-created events are not accepted by the handler. Explicit public mode remains synthetic-only: no database secret, S3/Bedrock runtime access, GuardDuty plan, or enabled ingestion.

CockroachDB Cloud is deliberately the **only persistent database/memory store**. Docker Compose does not create PostgreSQL or any substitute database. Local/demo behavior may contain deterministic in-process fixtures, but that is not durable memory and must not be represented to judges as CockroachDB-backed unless `DATABASE_URL` is configured.

## Fastest path to a live demo

1. Install Python 3.12+, Node 22.13.0+, AWS CLI, AWS SAM CLI, CockroachDB CLI, `ccloud`, and `jq`. Docker is optional for local work but a running daemon is required by `make deploy` to build Linux arm64 native dependencies. Run `make check`.
2. Run `ccloud auth login`, then `make provision-db`. The provisioner creates an AWS-hosted CockroachDB Cloud Basic cluster and database but intentionally prompts for the SQL-user password; it never fabricates or logs a password.
3. Build a TLS connection URL for the least-privilege application user, export it as `DATABASE_URL`, and run `make db-bootstrap` followed by `make db-verify`.
4. Confirm Bedrock model access for `amazon.nova-lite-v1:0` in the target AWS Region. Run `make secret` to create/update the Secrets Manager secret without echoing the URL.
5. Run `AUTH_MODE=cognito make deploy`, create/invite a Cognito operator, add it to `sentineltwin-operators`, complete MFA enrollment, then run `make deploy-web`; it builds from safe stack outputs automatically.
6. Redeploy with `CORS_ORIGIN` set to the emitted CloudFront `WebUrl`, then rerun `make deploy-web`; the safe loopback bootstrap intentionally blocks the cloud UI until this step.
7. Supply a short-lived `API_BEARER_TOKEN`, run `REQUIRE_PERSISTENT=true make smoke`, then run both `SATELLITE_FILE=... REQUIRE_BEDROCK_ASSESSMENT=true make smoke-satellite` and `make smoke-sentinel`. Run the authenticated read load test before changing concurrency. Rehearse [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md), record under three minutes, and fill [docs/SUBMISSION.md](docs/SUBMISSION.md).

Exact commands and rollback steps are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Credential and external-service gaps

- `AWS_PROFILE` must identify an account allowed to deploy CloudFormation/SAM, IAM, Lambda, API Gateway, Cognito, S3, EventBridge, SQS, CloudFront, CloudWatch, X-Ray, and Secrets Manager.
- The selected Amazon Bedrock model must be enabled and available in the deployment region. Model output has not been live-tested here.
- `ccloud auth login` must be completed against the entrant's CockroachDB Cloud organization. Cluster provisioning is not complete.
- A CockroachDB application password and TLS URL must be created. Do not paste either into issues, chat, screenshots, frontend variables, SAM parameter files, or git.
- The Managed MCP example needs a real cluster ID and user OAuth/token setup from the CockroachDB Cloud Console. The example contains placeholders only.
- The deployed demo URL, YouTube/Vimeo URL, custom domain, and Devpost entry do not exist yet. The public source repository is `https://github.com/Developer668/sentineltwin`.

## Verification still required with real credentials

- Cloud end-to-end requests use live Bedrock `Converse` and write/retrieve memory in CockroachDB Cloud; only the deterministic/local Cockroach path is verified here.
- The deployed CockroachDB Cloud query plan shows `vector search` for the same `<->` L2 query already verified on local v25.4.14.
- Secrets Manager JSON uses exactly `{"DATABASE_URL":"..."}` and the Lambda loads it without exposing it in logs.
- Frontend production build reads the deployed API base URL and CloudFront SPA fallback works.
- CORS is locked to the CloudFront origin; Lambda and API Gateway agree on the origin.
- CloudWatch structured logs, request IDs, Lambda alarms, and X-Ray traces populate under traffic.
- Cognito authorization code + PKCE login, `openid` access-token scope, callback/logout, token expiry, and missing-token rejection work from the CloudFront origin.
- A constrained S3 upload receives a GuardDuty `NO_THREATS_FOUND` object-version tag, then triggers EventBridge/assessment Lambda, produces live Bedrock output, commits the assessment/location/memory/audit transaction, and leaves the DLQ empty. Also prove a safe test rejection never invokes Bedrock.
- `make smoke-sentinel` imports the real allowlisted AWS Open Data scene and preserves upstream bucket/key/hash provenance through GuardDuty and CockroachDB.
- Authenticated cloud load runs establish p95/error behavior before changing `ApiReservedConcurrency`, `IngestionReservedConcurrency`, API throttles, or the per-process DB pool cap.
- A cold-start and a forced Bedrock/DB failure produce an honest degraded response without fabricated “memory saved” claims.

## Known trade-offs / follow-ups

- The template defaults API/ingestion reserved concurrency to 10/4, HTTP API throttle to 20 req/s with burst 40, and each warm process to a four-connection DB pool. All are parameters; total possible DB connections grow with warm concurrency, so tune from measured cloud results—not the loopback benchmark.
- CloudFront makes deployment slower but keeps the web bucket private. The default certificate is suitable for the generated domain; custom DNS/certificate are not configured.
- The S3 artifact bucket and Lambda log group are retained during stack deletion to prevent accidental evidence loss; manual cleanup is documented.
- The CockroachDB Basic plan is the cheapest demo default. `make db-multi-region` is guarded and only configures an existing three-region topology; it neither creates that paid topology nor proves failover.
- The template does not provision Lambda VPC/NAT or CockroachDB private networking. Inspect the Cloud allowlist and replace demo-only `0.0.0.0/0` with approved stable egress/admin CIDRs (or supported PrivateLink) before production; no Lambda CIDR should be guessed.
- Disaster recommendations are decision support only. The UI/demo must preserve human-approval and data-freshness language; it must not claim to replace emergency authorities.
- Cognito authentication, required MFA, and a server-enforced operator group are included. GuardDuty scans every quarantined upload/import, but tenant/location row-level authorization is not included; do not expose ingestion to multiple untrusted tenants until that policy layer exists.

## Definition of done for submission owner

- [ ] Public repo URL works in a logged-out browser and displays the MIT license.
- [ ] Live app URL works in a private browser window.
- [ ] Demo performs two runs and visibly proves persistent memory improves/reuses the second run.
- [ ] CockroachDB tool claims match actual evidence: ccloud transcript, vector DDL/query, MCP audit screenshot if used, and Agent Skill file/path.
- [ ] AWS claims match CloudFormation resources and CloudWatch/Bedrock evidence.
- [ ] Video is public, under 3:00, captions readable, secrets/redacted.
- [ ] Devpost fields and screenshots contain no credentials, personal endpoints, or misleading resilience claims.
