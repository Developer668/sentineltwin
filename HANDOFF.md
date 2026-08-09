# SentinelTwin handoff

Last updated: 2026-08-08 (America/Los_Angeles)

## Honest current state

This repository is a hackathon-ready vertical slice with source, infrastructure-as-code, setup scripts, submission screenshots, and judge-facing documentation. **CockroachDB Cloud is now configured and live; AWS is not yet deployed.** The source is published at [Developer668/sentineltwin](https://github.com/Developer668/sentineltwin), but the public app/video and AWS evidence remain external items—not implied successes.

Verification completed on 2026-08-08:

- Backend and frontend suites cover the API, Cockroach repository, vector recall, Cognito PKCE, upload quarantine, GuardDuty verdict handling, real Sentinel-2 import, JPEG-2000 conversion, input bounds, migration safety, AWS account/deploy preflights, and load-test controls: **116 backend tests and 39 frontend tests passed**; the destructive live-cloud test remains opt-in.
- `make lint` and `make security` passed: shell syntax, Python compilation/Ruff/Bandit, TypeScript, pip dependency audit, and pnpm dependency audit are clean.
- Frontend production build passed (Vite output generated successfully).
- Local API smoke passed in explicitly labeled deterministic demo mode. The isolated real-CockroachDB integration also passed health, dashboard read, two durable simulation writes, and exact first-memory recall during the second run.
- SAM/CI YAML parsed to an AST, all shell scripts passed `bash -n`, and the MCP example passed strict JSON parsing.
- A sanitized source archive was uploaded to AWS CloudShell. `sam validate --lint` passed against the real account, then a native Python 3.12 Amazon Linux x86_64 build succeeded. The 70 MB artifact imported the packaged application, `psycopg` 3.3.4, and Pillow 12.3.0 successfully. CloudShell's Docker `vfs` storage could not unpack the ARM64 SAM image, so Lambda now defaults to x86_64 and supports a guarded `SENTINEL_SAM_BUILD_MODE=native-linux`; container packaging remains the cross-platform default and CI check.
- A real AWS `us-west-2` CockroachDB Cloud Basic cluster now hosts the `sentineltwin` database on CockroachDB v26.2.5. Production migrations `001`, `003`, and `004` are tracked; synthetic migration `002` was not applied. All three C-SPANN vector indexes exist, and the production `<->` query plan reports `vector search`.
- The opt-in live-cloud test passed after least-privilege downgrade: production health, dashboard hydration, an atomic simulation/memory write, and exact recall from a fresh API instance. Its clearly labeled location, simulations, memories, audits, and counter changes were removed afterward. The residual database has five canonical product-config agents and zero locations, scenarios, simulations, memories, assessments, or audit events.
- `sentinel_app` uses TLS `verify-full`, has no `admin` membership or DDL permission, and has only database connect, schema usage, and runtime CRUD privileges. The CA and connection URL exist only in local ignored configuration. No AWS application resource or model invocation has been created yet.
- The AWS account is on the protected Free plan ($100 credits and 185 days remaining at review time) and had zero service usage before this work. The regional Lambda concurrency quota is only 10; deployment now omits reserved concurrency by default and disables paid API route metrics unless explicitly enabled. Bedrock Nova Lite access is authorized in `us-west-2`.
- The live deployment preflight refused to proceed because the console session is the AWS root user and root MFA is disabled. No stack, secret, bucket, Lambda, API, Cognito pool, GuardDuty plan, or other application resource was created. Root MFA and preferably a least-privilege deployment identity are required before deployment.
- Real-browser QA passed at desktop and 390×844: the dashboard hydrated, keyboard scenario controls worked, a 24-hour simulation completed with explicit human-review/non-persistence evidence, a demo imagery assessment remained truthfully synthetic, the mobile sheet had no horizontal overflow, and the console had no warnings or errors. The run also caught and fixed a 12-hour backend/72-hour UI contract mismatch before this handoff.
- The real public Sentinel-2 source path was exercised without AWS credentials against `sentinel-s2-l2a`: the Santa Rosa sample fetched 3,032,506 bytes with its real ETag, passed JPEG-2000 signature validation, and converted to a 721,449-byte JPEG for Bedrock. Destination S3, GuardDuty, EventBridge, and Bedrock still require the AWS checks.
- The safe local read workload completed 1,152 requests at concurrency 8 with 0 errors, 226.58 req/s, p50 27.36 ms, p95 73.29 ms, and p99 122.85 ms. This is a loopback/deterministic benchmark, not a claim about AWS or CockroachDB Cloud capacity.
- A second higher-concurrency safety run completed 440 requests at concurrency 16 with 0 errors (35.85 req/s, p95 1.11 s). It validates bounded concurrency/error handling on this workstation; cloud tuning still requires authenticated Lambda/Cockroach metrics.
- Submission screenshots in `docs/images/` were captured from the running app and visibly preserve demo/ephemeral truth labels.

The AWS template targets `sentineltwin.app.lambda_handler` for the interactive API and `sentineltwin.app.satellite_event_handler` for asynchronous assessment on Python 3.12. It provisions Cognito JWT protection (health public), separate API/ingestion Lambdas, private S3 quarantine, GuardDuty Malware Protection with post-scan tagging, scan-result EventBridge delivery, encrypted SQS DLQ, private S3/CloudFront web delivery, logs/alarms, X-Ray, and least-privilege Bedrock/S3/Secrets Manager access. Raw S3 object-created events are not accepted by the handler. Explicit public mode remains synthetic-only: no database secret, S3/Bedrock runtime access, GuardDuty plan, or enabled ingestion.

CockroachDB Cloud is deliberately the **only persistent database/memory store**. Docker Compose does not create PostgreSQL or any substitute database. Local/demo behavior may contain deterministic in-process fixtures, but that is not durable memory and must not be represented to judges as CockroachDB-backed unless `DATABASE_URL` is configured.

## Fastest path to a live demo

1. Install Python 3.12+, Node 22.13.0+, AWS CLI, AWS SAM CLI, CockroachDB CLI, `ccloud`, and `jq`. Docker is optional for local work but required by the default cross-platform deployment build; an exact Linux x86_64/Python 3.12 host may use `SENTINEL_SAM_BUILD_MODE=native-linux`. Run `make check`.
2. CockroachDB Cloud provisioning, TLS configuration, schema/index creation, and live memory verification are complete. Keep synthetic migration `002` disabled.
3. Enable MFA on the AWS root user, then use a least-privilege deployment identity where possible. Bedrock model access for `amazon.nova-lite-v1:0` in `us-west-2` is already confirmed.
4. Run `make secret` to create/update the Secrets Manager secret without echoing the URL.
5. Run `AUTH_MODE=cognito make deploy`, create/invite a Cognito operator, add it to `sentineltwin-operators`, complete MFA enrollment, then run `make deploy-web`; it builds from safe stack outputs automatically.
6. Redeploy with `CORS_ORIGIN` set to the emitted CloudFront `WebUrl`, then rerun `make deploy-web`; the safe loopback bootstrap intentionally blocks the cloud UI until this step.
7. Supply a short-lived `API_BEARER_TOKEN`, run `REQUIRE_PERSISTENT=true make smoke`, then run both `SATELLITE_FILE=... REQUIRE_BEDROCK_ASSESSMENT=true make smoke-satellite` and `make smoke-sentinel`. Run the authenticated read load test before changing concurrency. Rehearse [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md), record under three minutes, and fill [docs/SUBMISSION.md](docs/SUBMISSION.md).

Exact commands and rollback steps are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Credential and external-service gaps

- Root MFA is currently disabled. The deployment script will not proceed under an unprotected root session. Prefer an SSO/temporary least-privilege deployment identity after securing root.
- `AWS_PROFILE` or CloudShell must identify an account allowed to deploy CloudFormation/SAM, IAM, Lambda, API Gateway, Cognito, S3, EventBridge, SQS, CloudFront, CloudWatch, X-Ray, and Secrets Manager.
- Amazon Nova Lite access is authorized in `us-west-2`; model output has not yet been live-tested.
- A sanitized `ccloud` transcript is still needed if the submission claims CLI usage; the cluster itself and SQL runtime path are configured.
- The Managed MCP example needs a real cluster ID and user OAuth/token setup from the CockroachDB Cloud Console. The example contains placeholders only.
- The deployed demo URL, YouTube/Vimeo URL, custom domain, and Devpost entry do not exist yet. The public source repository is `https://github.com/Developer668/sentineltwin`.

## Verification still required with real credentials

- Cloud end-to-end requests must still prove live Bedrock `Converse`; CockroachDB Cloud write/retrieve memory and vector search are already verified.
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

- The template defaults API/ingestion reserved concurrency to 0/0 because this new account has only 10 total Lambda concurrency. HTTP API throttle remains 20 req/s with burst 40, and each warm process has a four-connection DB pool. Request a reviewed quota increase before adding reservations, and tune from measured cloud results—not the loopback benchmark.
- CloudFront makes deployment slower but keeps the web bucket private. The default certificate is suitable for the generated domain; custom DNS/certificate are not configured.
- The S3 artifact bucket and Lambda log group are retained during stack deletion to prevent accidental evidence loss; manual cleanup is documented.
- The CockroachDB Basic plan is the cheapest demo default. `make db-multi-region` is guarded and only configures an existing three-region topology; it neither creates that paid topology nor proves failover.
- The template does not provision Lambda VPC/NAT or CockroachDB private networking. The current Basic cluster has no PrivateLink and CockroachDB SQL has no IPv6 endpoint, so a stable allowlistable Lambda path requires paid IPv4 egress or a supported CockroachDB plan. The current `0.0.0.0/0` entry is time-bounded hackathon topology, not network-hardened production. See [docs/AWS_COSTS_AND_TEARDOWN.md](docs/AWS_COSTS_AND_TEARDOWN.md).
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
