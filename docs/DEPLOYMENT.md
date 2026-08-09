# Deployment guide

Nothing in this guide creates external resources until you run a `ccloud`, `aws`, or `sam deploy` command. Those actions can incur charges. Review the account-specific [AWS cost guardrails and teardown register](AWS_COSTS_AND_TEARDOWN.md), current AWS/CockroachDB pricing, and use an approved account first.

## 1. Tooling and authentication

Required locally: Python 3.12+, Node.js 22.13.0+, `pnpm`, `jq`, AWS CLI, AWS SAM CLI, CockroachDB SQL CLI, and `ccloud`. A running Docker daemon is additionally required for AWS deployment packaging.

```bash
brew install python@3.12 node pnpm aws-sam-cli awscli jq
brew install cockroachdb/tap/cockroach cockroachdb/tap/ccloud
make check
make install
```

Authenticate without committing credentials:

```bash
aws configure sso                       # or your organization's approved method
export AWS_PROFILE=your-profile
export AWS_REGION=us-west-2
aws sts get-caller-identity
ccloud auth login
```

## 2. CockroachDB Cloud on AWS

The guarded provisioner supports only Basic/Standard, refuses to guess at an Advanced topology or cost, and leaves password creation interactive:

```bash
export COCKROACH_CLUSTER=sentineltwin
export COCKROACH_REGION=us-west-2
export COCKROACH_PLAN=basic
export COCKROACH_SPEND_LIMIT=15
make provision-db
ccloud cluster user create sentineltwin sentinel_admin
ccloud cluster sql --connection-url sentineltwin
```

Immediately inspect [CockroachDB Cloud network authorization](https://www.cockroachlabs.com/docs/cockroachcloud/network-authorization):

```bash
ccloud cluster networking allowlist list sentineltwin
export APPROVED_ADMIN_CIDR='REPLACE_WITH_PUBLIC_IPV4/32'
ccloud cluster networking allowlist create sentineltwin "$APPROVED_ADMIN_CIDR" --sql --ui
```

Basic/Standard clusters can initially include `0.0.0.0/0`. That entry is acceptable only for a time-bounded authenticated hackathon demo. CockroachDB Basic does not support AWS PrivateLink, and CockroachDB SQL endpoints do not support IPv6, so the free IPv6 egress-only-gateway path cannot provide Lambda connectivity. Before production, establish an approved stable IPv4 application egress path—such as Lambda private subnets through a NAT gateway with an Elastic IP—or move to a CockroachDB plan that supports PrivateLink; add only those exact SQL paths, verify both Lambda and administrator connectivity, then remove the public entry with `ccloud cluster networking allowlist delete sentineltwin 0.0.0.0/0`. Both alternatives consume credits/cost. This repository deliberately does not guess a Lambda egress CIDR or silently provision paid VPC/NAT/private-connectivity resources.

Construct the TLS URL using the displayed host, the password you entered, and database `sentineltwin`. Prefer a shell/session secret manager to shell history.

```bash
export DATABASE_URL='postgresql://sentinel_admin:REDACTED@HOST:26257/sentineltwin?sslmode=verify-full'
make db-bootstrap
make db-verify
```

`db-bootstrap` uses `database/migrate.py`, records every ordered migration, and is safe to rerun. Production bootstrap excludes synthetic migration `002` by default. A labeled demo database may opt in with `SENTINEL_APPLY_DEMO_FIXTURES=true`; those fixtures are not live satellite data. CockroachDB v25.4+ is required for the C-SPANN vector indexes. Rotate from the bootstrap admin to the least-privilege application identity before exposing real data.

### Optional multi-region configuration

The default Basic demo cluster is not multi-region. Do not claim region survival from it. For an existing paid cluster that already has at least three physical CockroachDB regions, inspect the exact locality names first:

```bash
COCKROACH_URL="$DATABASE_URL" cockroach sql --execute 'SHOW REGIONS FROM CLUSTER;'
export COCKROACH_DATABASE=sentineltwin
export COCKROACH_REGIONS='aws-us-west-2,aws-us-east-1,aws-us-east-2' # example only
export COCKROACH_PRIMARY_REGION='aws-us-west-2'                       # example only
make db-multi-region                                                  # dry run
```

The script never creates/resizes a cluster. After reviewing topology, pricing, and latency impact, apply with the exact guard:

```bash
export MULTI_REGION_APPLY=true
export MULTI_REGION_CONFIRM='sentineltwin:region-survival'
make db-multi-region
```

Region-failure survival requires at least three database regions and adds cross-region write latency. The script verifies requested regions exist, sets `SURVIVE REGION FAILURE`, and optionally makes small reference tables `GLOBAL`; other tables remain `REGIONAL BY TABLE` in the primary region. Run a real failover/restore drill before making RTO/RPO claims.

## 3. Local verification

The fastest high-confidence check starts an isolated real CockroachDB process on loopback, applies all tracked migrations, runs two simulations, and proves the second recalls the first learned memory. It uses no Docker and deletes only its own temporary directory:

```bash
make db-test-local COCKROACH_BINARY=/absolute/path/to/cockroach
```

To test against CockroachDB Cloud and live Bedrock instead, run the API and UI in separate terminals:

```bash
export DATABASE_URL='postgresql://.../sentineltwin?sslmode=verify-full'
export SENTINEL_DEMO_MODE=false
export AWS_REGION=us-west-2
export BEDROCK_MODEL_ID=amazon.nova-lite-v1:0
make api
```

```bash
make web
REQUIRE_PERSISTENT=true API_BASE_URL=http://127.0.0.1:8787/api make smoke
```

The loopback server intentionally has no Cognito gate; cloud authentication is enforced by API Gateway. Verify health reports `production`, `cockroachdb`, and `connected` before recording durable-memory behavior.

## 4. Store the database credential

`make secret` writes `{"DATABASE_URL":"..."}` to Secrets Manager through a mode-0600 temporary file, removes the file, and never prints the URL.

```bash
export DATABASE_SECRET_NAME=sentineltwin/cockroachdb
make secret
export DATABASE_SECRET_ARN="$(aws secretsmanager describe-secret \
  --secret-id "$DATABASE_SECRET_NAME" --region "$AWS_REGION" \
  --query ARN --output text)"
```

Warm Lambda environments cache configuration. Smoke-test the new credential before revoking the old SQL password.

## 5. Deploy protected AWS resources

Confirm the selected Bedrock model is available in the region. `psycopg[binary]` and Pillow contain native code, so the deploy script follows [AWS SAM's container-build guidance for native dependencies](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-using-build.html) and defaults to `SENTINEL_SAM_BUILD_MODE=container`. This prevents a macOS wheel from ever entering Lambda. The default Lambda architecture is x86_64; an exact Linux x86_64 host with Python 3.12 may set `SENTINEL_SAM_BUILD_MODE=native-linux` when a constrained build environment cannot unpack the SAM container. ARM64 is supported only with the container mode. The deployment script derives globally unique Cognito/S3 names from the current AWS account and region.

```bash
export STACK_NAME=sentineltwin
export BEDROCK_MODEL_ID=amazon.nova-lite-v1:0
export CORS_ORIGIN='http://localhost:5173' # safe bootstrap; CloudFront is locked out until step 6
export SENTINEL_DEMO_MODE=false
export AUTH_MODE=cognito               # default; API JWT protection enabled
export LAMBDA_ARCHITECTURE=x86_64 SENTINEL_SAM_BUILD_MODE=container
# New-account-safe defaults. Zero omits reservations; the deploy preflight rejects
# values that exceed the regional quota while preserving Lambda's unreserved pool.
export API_RESERVED_CONCURRENCY=0 INGESTION_RESERVED_CONCURRENCY=0
export API_DETAILED_METRICS_ENABLED=false # route-level metrics are an explicit metered opt-in
export API_THROTTLE_RATE_LIMIT=20 API_THROTTLE_BURST_LIMIT=40 DATABASE_POOL_MAX_SIZE=4
make deploy
```

`AUTH_MODE=public` is an explicit short-lived opt-out for a synthetic-data demo. Both the deploy script and CloudFormation reject it unless `SENTINEL_DEMO_MODE=true` and `DATABASE_SECRET_ARN`/`CockroachSecretArn` is empty. CloudFormation also blanks S3/Bedrock runtime configuration, omits their Lambda IAM statements, does not create the GuardDuty protection plan/service role, and disables ingestion. Only deterministic demo paths remain; protected Cognito mode is required for real uploads, Sentinel-2 imports, Bedrock, or CockroachDB persistence.

CloudFormation creates:

- API Gateway HTTP API, JWT authorizer, API Lambda, logs, X-Ray, throttles, and alarms;
- Cognito User Pool with required software-token MFA, `sentineltwin-operators` authorization group, no-secret SPA client, Hosted UI, authorization-code flow, and PKCE-compatible callbacks;
- private/versioned artifact S3 with a quarantine prefix, GuardDuty Malware Protection and scan-result tags, verdict-filtered EventBridge rule, assessment Lambda, bounded retries, encrypted SQS dead-letter queue, logs, and alarm;
- private/versioned web S3, CloudFront Origin Access Control, SPA fallback, cache/security headers;
- narrowly scoped Bedrock, S3, Secrets Manager, EventBridge, SQS, and Lambda permissions.

The stack does not create Lambda VPC/NAT or CockroachDB private networking. A persistent deployment must complete the allowlist/private-connectivity step above; do not treat AWS region membership as a source CIDR.

## 6. Create an operator and deploy the SPA

Protected mode is admin-invite only. Resolve the pool and create the first operator; Cognito sends a temporary-password email using its account/region email configuration.

```bash
export USER_POOL_ID="$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='CognitoUserPoolId'].OutputValue | [0]" --output text)"
export OPERATOR_EMAIL='operator@example.com'
aws cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" \
  --username "$OPERATOR_EMAIL" \
  --user-attributes Name=email,Value="$OPERATOR_EMAIL" Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL \
  --region "$AWS_REGION"
aws cognito-idp admin-add-user-to-group \
  --user-pool-id "$USER_POOL_ID" \
  --username "$OPERATOR_EMAIL" \
  --group-name sentineltwin-operators \
  --region "$AWS_REGION"
```

The API Lambda independently requires the verified `cognito:groups` claim to contain `sentineltwin-operators`; a valid pool token without that group receives `403`. MFA is required by the pool, so the first Hosted UI session also enrolls a software authenticator after the temporary-password challenge.

`make deploy-web` reads `ApiUrl`, Cognito domain/client/callback/scopes, and the web bucket from stack outputs. It builds the SPA without any client secret, uploads it, sets `index.html` to no-cache, and invalidates CloudFront:

```bash
make deploy-web
```

After CloudFront is ready, lock both API and upload-bucket CORS to the exact web origin and redeploy:

```bash
export WEB_URL="$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='WebUrl'].OutputValue | [0]" --output text)"
export CORS_ORIGIN="$WEB_URL"
make deploy
make deploy-web
```

Open `WEB_URL` in a private browser, complete the temporary-password and MFA enrollment challenges, and sign in. The SPA uses OAuth authorization code + PKCE S256, keeps short-lived access/ID tokens only in memory, deliberately discards the refresh token, and sends the access token as `Bearer`. Only the one-time PKCE verifier/state is kept transiently in `sessionStorage` while the redirect completes, so reloading or closing the page requires another sign-in.

## 7. Deployed smoke tests

Health is intentionally public; every application route requires a token in protected mode. For a one-session CLI smoke test, sign in, open the browser Network panel, trigger an API request, and inspect that request's headers. Copy only the short-lived value after `Authorization: Bearer ` and read it into the shell without echo. Alternatively, obtain a token through an organization-approved external OAuth flow; do not add password auth or a client secret merely for smoke testing.

```bash
read -r -s API_BEARER_TOKEN
export API_BEARER_TOKEN
export API_BASE_URL="$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue | [0]" --output text)/api"
REQUIRE_PERSISTENT=true make smoke
```

Treat that token like a password: do not pass it on a command line, paste it into issues, or persist it in `.env` or browser storage. It expires within one hour; unset `API_BEARER_TOKEN` when the smoke test finishes.

To prove the real image pipeline, choose a non-sensitive 5 MB-or-smaller JPEG/PNG/GIF/WebP:

```bash
SATELLITE_FILE=/absolute/path/to/tile.png \
REQUIRE_BEDROCK_ASSESSMENT=true \
make smoke-satellite
```

This verifies constrained presigned POST → private S3 quarantine → GuardDuty clean tag → EventBridge → assessment Lambda → Bedrock → atomic CockroachDB assessment/memory write. A deterministic fallback fails the strict Bedrock check instead of being misrepresented as live inference. GuardDuty and EventBridge pricing applies.

Then prove the separate real-data path with the included Santa Rosa Sentinel-2 L2A key (or set another allowlisted `SENTINEL_SOURCE_KEY`):

```bash
make smoke-sentinel
```

That smoke requires the upstream provider/bucket/key, clean verdict, Bedrock provider, and durable CockroachDB write to survive end to end. It never accepts an arbitrary URL or source bucket.

Finally establish a cloud baseline before changing concurrency. The default harness is read-only:

```bash
export SENTINEL_LOAD_TOKEN="$API_BEARER_TOKEN"
LOAD_DURATION=60 LOAD_CONCURRENCY=8 make load-test
unset SENTINEL_LOAD_TOKEN
```

Record RPS, p50/p95/p99, error/status distribution, Lambda duration/concurrency/throttles, and CockroachDB connection/SQL latency together. Write load is intentionally unavailable through the Make target; invoke `scripts/load_test.py --include-writes --location-id ...` only with `SENTINEL_LOAD_ALLOW_WRITES=true`, because it creates real Bedrock/database work.

## 8. Evidence capture

- Save the CloudFormation Resources/Outputs view and sanitized CloudWatch traces for both Lambdas.
- Show GuardDuty's active plan, the exact object's `NO_THREATS_FOUND` tag, EventBridge matched the scan result, and the DLQ remains empty; never expose image contents or tokens.
- Show one controlled rejected-verdict test remained quarantined and produced no Bedrock/learned-memory invocation. Do not upload real malware; use an organization-approved safe test process.
- Run `make db-verify` and save sanitized `crdb_internal.table_indexes` plus `EXPLAIN` evidence showing `vector search` for the backend's `<->` L2 query.
- Save the first learned-memory ID and the second simulation's exact `memory_context.memory_ids` recall.
- Show a live satellite assessment with `provider=amazon-bedrock`, `persisted=true`, S3 provenance, and CockroachDB assessment/memory IDs.
- Show `ccloud cluster info sentineltwin` without credentials. Only claim multi-region if the actual cluster/database topology and a drill prove it.
- If Managed MCP is activated, run a read-only memory/count query and capture its CockroachDB Cloud audit event without tokens.

## Rollback and teardown

Rollback application code by deploying the last known-good commit. Schema changes should use forward-compatible migrations. Before teardown, export only evidence you are authorized to retain.

The web bucket is versioned, so deleting current objects alone may not empty it; CloudFormation cannot remove a non-empty bucket. Resolve the exact stack output and remove versions/delete markers through the S3 console or a separately reviewed command. Do not use a guessed bucket name.

```bash
aws cloudformation delete-stack --stack-name "$STACK_NAME" --region "$AWS_REGION"
aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME" --region "$AWS_REGION"
```

The artifact bucket, Cognito user pool, and Lambda log groups use retention policies; CockroachDB Cloud is independent. Delete them manually only after verifying exact identities, backup/evidence needs, and cost. Cluster deletion and retained evidence removal are irreversible.

Use the complete service-by-service order in [AWS cost guardrails and teardown register](AWS_COSTS_AND_TEARDOWN.md). In particular, the Secrets Manager secret and SAM-managed artifact bucket are independent of the application stack and must be reviewed separately.
