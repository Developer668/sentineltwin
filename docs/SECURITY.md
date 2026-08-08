# Security and responsible-use review

## Shipped controls

- Lambda receives only a Secrets Manager ARN; the database URL is fetched at runtime and must never be logged.
- Cloud deployment defaults to `AUTH_MODE=cognito`. API Gateway validates Cognito JWT issuer, app-client audience, expiry, and the `openid` authorization scope; health is the only public application route. `AUTH_MODE=public` is accepted only with synthetic demo mode and no database secret; CloudFormation additionally removes S3/Bedrock runtime access and disables ingestion.
- The Cognito SPA client has no secret and permits only OAuth authorization code. The browser uses PKCE S256, validates state, keeps short-lived access/ID tokens in memory only, and deliberately discards the refresh token. `sessionStorage` holds only transient PKCE verifier/state values during the redirect.
- The API and ingestion Lambdas have separate roles/concurrency. They can read exactly the database secret, invoke exactly the configured Bedrock foundation model, and access only required S3 prefixes. Neither can delete S3 data or administer CockroachDB/AWS.
- Presigned satellite POSTs fix the object prefix/location, image content type, location metadata, AES256 encryption field, 1–5 MB content-length range, and 15-minute expiry. The browser receives no AWS credential.
- S3 encryption, versioning, and full public-access blocks are enabled. GuardDuty Malware Protection scans only the quarantine prefix and adds its standard result tag. EventBridge routes GuardDuty scan verdicts—not S3 creation events—to the assessment Lambda. Bounded retries feed an encrypted SQS dead-letter queue.
- The assessment Lambda requires both a completed `NO_THREATS_FOUND` event and an independent `GuardDutyMalwareScanStatus=NO_THREATS_FOUND` tag on the exact S3 object version. It reads bounded bytes only after that check. Threat, unsupported, denied, failed, pending, tag-mismatch, and raw S3 events fail closed before Bedrock or memory writes.
- Sentinel-2 import accepts no URL/bucket input. It uses an unsigned client for the fixed `sentinel-s2-l2a` bucket/region, a strict L2A true-colour key shape, size and length bounds, JPEG-2000 magic bytes, SHA-256 provenance, and private quarantine destination. JPEG-2000 decoding is pixel-capped and happens only after scanning.
- CloudFront uses Origin Access Control for the private web bucket and sends CSP, HSTS, frame-denial, MIME-sniffing, and referrer security headers.
- CockroachDB URLs require TLS. Application SQL must be parameterized and use a non-admin role created by the schema/bootstrap process.
- API Gateway throttling and Lambda reserved concurrency bound abuse/cost; access logs omit bodies and authorization headers.
- `NoEcho` protects the secret ARN parameter in CloudFormation views (the ARN is an identifier, not the secret value).
- MCP examples contain placeholders and are intended for read-only, audited operator/judge inspection.

## Required before a public launch

1. Keep `AUTH_MODE=cognito` and replace the loopback/bootstrap CORS origin with the exact CloudFront/custom domain; never opt into wildcard for production.
2. Inspect `ccloud cluster networking allowlist list <cluster>`. Replace demo-only `0.0.0.0/0` with approved admin and stable application-egress CIDRs, or supported private connectivity; never guess Lambda egress ranges.
3. Add role/tenant/location authorization. Cognito currently proves operator identity but all authenticated operators share one application scope.
4. Require MFA according to operator policy, review Cognito invitation/recovery settings, and remove dormant users.
5. Add AWS WAF/rate rules if the endpoint is advertised broadly.
6. Rotate the CockroachDB application password after recordings and remove broad/bootstrap users.
7. Verify Bedrock model access/data-use terms; redact sensitive location/person data; deploy the GuardDuty plan; prove one clean and one safe rejection event; and define quarantined-threat retention/removal policy before accepting untrusted uploads.
8. Add an SNS/approved incident target to alarms, monitor the ingestion DLQ, and enable CloudTrail data events only if their cost/volume is accepted.
9. Run dependency, secret, IaC, OAuth, upload-abuse, and API authorization tests; CI is a baseline, not a penetration test.

## SQL role policy

Use `sentinel_admin` only to apply schema/grants. Lambda should connect as `sentinel_app`, limited to the SentinelTwin database/schema and required CRUD/sequences. Managed MCP should use a distinct read-only identity. Do not reuse passwords or give the Lambda `admin`.

## Prompt and data safety

Treat satellite labels, operator text, and recalled memories as untrusted data, never as instructions. Keep system constraints outside retrieved text, delimit quoted evidence, cap recall count/size, require structured output validation, and record the model ID plus source memory IDs. Do not place raw secrets, resident PII, exact vulnerable-facility access details, or credentials in Bedrock prompts.

File extensions are sanitized and ignored for authorization. GuardDuty provides the malware verdict; SentinelTwin separately checks type, exact length, magic bytes, location metadata, version, and bounded decode. Malware scanning is not a guarantee that imagery is truthful, correctly geolocated, private, or safe to operationalize. Keep the prototype non-sensitive and retain human review.

Every recommendation must show freshness, provenance, confidence, degradation state, and “human approval required.” Do not claim a simulated failover is a real CockroachDB multi-region failover. Do not present deterministic demo fixtures as live satellite data.

## Secret rotation

1. Create a new CockroachDB password/credential with the same least privilege.
2. Update Secrets Manager using `DATABASE_URL=... make secret`.
3. Publish/restart both warm Lambda environments (or wait for normal recycle), run health, durable two-run recall, and image-ingestion smoke tests.
4. Revoke the old database credential after confirmation.
5. Confirm logs and shell history contain no URL. If exposure is suspected, rotate immediately rather than attempting redaction alone.

## Reporting

This is a prototype. Report vulnerabilities privately to the repository owner; do not include exploit payloads or real credentials in a public issue.
