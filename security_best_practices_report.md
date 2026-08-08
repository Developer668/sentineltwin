# SentinelTwin security review

Reviewed: 2026-08-08
Scope: backend, React SPA, CockroachDB access, AWS SAM/CloudFormation, local tooling, dependencies, and deployment documentation.

## Executive summary

The repository is in a strong prototype state for a single trusted emergency-operations team. The review fixed the high-impact authorization and data-integrity paths found in source, removed a vulnerable test dependency, eliminated database credentials from process arguments, tightened OAuth and API inputs, and added continuous CodeQL/dependency scanning. Local source, dependency, browser, load, and real CockroachDB checks pass.

No review can establish that a system has “all vulnerabilities” removed. The material remaining risks are deployment-dependent: the AWS/CockroachDB Cloud stack has not yet been exercised with entrant credentials, row-level multi-tenant authorization is intentionally absent, and no external penetration/DAST engagement has been run. Do not expose this prototype to mutually untrusted tenants until those items are resolved.

## Findings addressed

| ID | Severity | Status | Finding and resolution |
|---|---|---|---|
| SEC-001 | High | Fixed | A valid Cognito token was not sufficient authorization evidence for an operator-only system. Cognito now requires MFA/admin-created users, creates a dedicated `sentineltwin-operators` group, and Lambda independently verifies the signed `cognito:groups` claim for every protected route. See `infra/template.yaml:161-220` and `backend/sentineltwin/app.py:594-632`. |
| SEC-002 | High | Fixed | A failed live Bedrock imagery assessment could previously degrade to deterministic output, creating a risk of synthetic evidence being mistaken for production analysis. Production imagery now fails closed; deterministic tiles are accepted only in demo mode and the UI disables them for a Cockroach-backed runtime. See `backend/sentineltwin/aws.py:425-520` and `frontend/src/components/SatelliteAssessmentModal.tsx`. |
| SEC-003 | High | Fixed and tested | Public uploads/imports now enter a private, size-bounded quarantine. Only an exact S3 object version with an independently re-read GuardDuty `NO_THREATS_FOUND` tag, matching ETag/location metadata, allowed media type, and valid magic bytes can reach Bedrock. Raw object-created events are rejected. See `backend/sentineltwin/aws.py:173-370`, `backend/sentineltwin/app.py:658-735`, and `infra/template.yaml:318-474`. |
| SEC-004 | Medium | Fixed | Database URLs containing credentials were passed in command arguments and TLS checks relied on substring matching. Operational scripts now receive URLs through stdin/environment, use one shared parsed validator, require exactly `sslmode=verify-full` for remote hosts, use mode-0600 temporary secret JSON, and never print the URL. The migration CLI no longer accepts `--url`. See `backend/sentineltwin/config.py:16-32`, `scripts/validate-database-url.py:1-31`, `scripts/create-secret.sh:1-45`, and `database/migrate.py`. |
| SEC-005 | Medium | Fixed | OAuth configuration accepted overly broad/ambiguous values and token responses were not fully constrained. The SPA now requires same-origin redirects, HTTPS Cognito origins outside loopback, an allowlisted scope set, PKCE S256/state verification, Bearer access-token claims for the configured client, bounded expiry, and memory-only tokens. See `frontend/src/lib/auth.ts:15-231` and `frontend/src/lib/auth.test.ts`. |
| SEC-006 | Medium | Fixed | Permissive origins, broad local binding, verbose unauthenticated metadata, malformed transport framing, non-finite JSON/numbers, and unbounded request fields expanded the attack surface. Exact HTTPS CORS (loopback HTTP only), sanitized health/error data, security headers, explicit remote-bind opt-in, framing/body caps, finite-number checks, and bounded write/query parameters are now enforced. See `backend/sentineltwin/config.py:35-65`, `backend/sentineltwin/app.py:40-51,71-115,124-137,530-647`, and `backend/sentineltwin/local_server.py:12-96`. |
| SEC-007 | Medium | Fixed | `pytest` 8.4.2 was affected by CVE-2025-71176 / GHSA-6w46-j5rx-g56g. Development dependencies now require `pytest>=9.1.1,<10`; `pip-audit` reports no known installed vulnerabilities. See `backend/requirements-dev.txt:1-5`. |
| SEC-008 | Medium | Fixed | Two CockroachDB update paths used dynamically assembled SQL built from counted placeholders or an allowlist. Values were parameterized, but the pattern complicated review and triggered static analysis. Both paths now use fixed SQL statements/executemany; Bandit is clean without suppressions for them. See `backend/sentineltwin/repository.py:690-710,976-994`. |
| SEC-009 | Medium | Fixed | Source security analysis was not running on the public repository. CI now runs `pip-audit`, Bandit, pnpm audit, secret-pattern guards, synthetic-public deployment guards, and a CodeQL security-extended matrix for Python and JavaScript/TypeScript. See `Makefile:29-38`, `.github/workflows/ci.yml`, `.github/workflows/codeql.yml`, and `.github/dependabot.yml`. |
| SEC-010 | Low | Fixed | Safety-critical result surfaces did not consistently expose evidence provenance and human-review state. The dashboard, simulation result, and imagery result now display source/persistence/decision guardrails; keyboard radio behavior, focus visibility, status/alert semantics, and responsive sheets were strengthened. See `frontend/src/components/RiskMap.tsx`, `SimulationModal.tsx`, `SatelliteAssessmentModal.tsx`, and `frontend/src/styles.css`. |

## Open and deployment-dependent risks

| ID | Severity | Risk | Required action before broader production use |
|---|---|---|---|
| SEC-R1 | Medium | Authorization is operator-group-wide, not tenant/location scoped. Any authorized operator can access every SentinelTwin location and memory. | Keep the deployment single-team. Before onboarding mutually untrusted organizations, add tenant claims, Cockroach row ownership/policies, route-level authorization tests, and tenant-scoped S3 prefixes. |
| SEC-R2 | Medium | IAM, Cognito Hosted UI/MFA, CloudFront headers, GuardDuty verdicts, Bedrock invocation, Secrets Manager retrieval, and CockroachDB Cloud TLS/network rules are source-validated but not live-validated in the entrant account. | Complete every cloud check in `HANDOFF.md` and `docs/DEPLOYMENT.md`; retain sanitized CloudWatch/Cockroach evidence for one clean and one rejected upload. |
| SEC-R3 | Medium | The template intentionally does not provision paid private networking/NAT or AWS WAF. Cockroach SQL exposure therefore depends on the Cloud allowlist, and API abuse protection is limited to JWT, throttles, concurrency caps, and bounded payloads. | Establish approved stable Lambda/admin egress or supported PrivateLink, remove `0.0.0.0/0`, and add WAF/rate-based rules if the app will face untrusted internet traffic. |
| SEC-R4 | Low | No third-party penetration test, browser DAST crawl, or sustained cloud soak test has been performed. | Run an authenticated staging assessment after deployment, including authorization bypass, upload abuse, OAuth callback, request smuggling, SSRF, prompt injection, and concurrency/failure testing. |
| SEC-R5 | Low | Database credential rotation is documented but not automated by this stack. | Define an owner/rotation interval, test dual-credential rollover, and alert on failed secret retrieval/authentication before production. |

## Verification evidence

- Backend: 102 tests passed, including authorization, CORS/TLS parsing, non-finite and oversized input rejection, prompt-injection boundaries, malware verdict/version checks, and production fail-closed behavior.
- Frontend: 35 tests, TypeScript checking, and the Vite production build passed.
- Dependencies/source: `pip-audit`, `pnpm audit --audit-level high`, Bandit, Ruff, Python compilation, shell parsing, and secret-pattern checks passed locally.
- Infrastructure: `cfn-lint infra/template.yaml` and generic YAML/JSON parsing passed. AWS SAM container packaging remains a GitHub/cloud check.
- Database: checksum-verified CockroachDB v25.4.14 applied migrations 001–003, completed durable writes and exact learned-memory recall, found all three vector indexes, and used `vector search` for the production `<->` query.
- Load: concurrency 16 completed 440 read requests with zero errors; this is a workstation safety run, not a cloud capacity claim.
- Browser: desktop and 390×844 workflows passed with no horizontal overflow or console warnings/errors; simulation and imagery outputs visibly require human review.

## Review limitations

Static analysis and local tests cannot prove AWS account policy, third-party service configuration, runtime network isolation, or the absence of unknown vulnerabilities. Re-run this review whenever authentication, upload handling, IAM, model prompts, database access, or dependencies change.
