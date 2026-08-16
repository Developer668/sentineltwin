# Architecture and data flow

## System boundary

SentinelTwin is a serverless decision-support prototype. Browser assets and source/evidence artifacts are on AWS S3; Amazon Cognito authenticates the SPA; API Gateway validates JWTs; two AWS Lambda functions separate interactive API work from asynchronous image assessment; Amazon Bedrock performs bounded planning/vision reasoning; **CockroachDB Cloud on AWS is the only durable operational database and vector store**. The frontend's bundled demo fixtures and the backend's deterministic demo repository are explicitly ephemeral fallbacks, not alternate persistence.

```mermaid
sequenceDiagram
    actor Human as Human planner
    participant UI as CloudFront + private S3 UI
    participant Auth as Amazon Cognito
    participant API as API Gateway HTTP API
    participant Agent as API Lambda
    participant Open as Sentinel-2 AWS Open Data
    participant Art as Private S3 quarantine/artifacts
    participant GD as GuardDuty Malware Protection
    participant EB as Amazon EventBridge
    participant Ingest as Assessment Lambda
    participant DB as CockroachDB Cloud
    participant BR as Amazon Bedrock

    Human->>UI: Open application
    UI->>Auth: Authorization code + PKCE (S256)
    Auth-->>UI: Short-lived tokens (no client secret)
    UI->>API: POST /api/uploads or /api/satellite/imports
    API->>Agent: Authorize issuer, audience, scope
    alt browser image
        Agent-->>UI: Constrained presigned S3 POST
        UI->>Art: Upload into quarantine
    else real Sentinel-2 scene
        Agent->>Open: Unsigned GET from fixed L2A bucket/key shape
        Open-->>Agent: R60m true-colour JPEG 2000 + metadata
        Agent->>Art: Copy bytes + source hash/provenance into quarantine
    end
    alt GuardDuty enabled
        Art->>GD: Object created under quarantine prefix
        GD->>Art: Scan exact version + result tag
        GD->>EB: Object scan result
        EB->>Ingest: Verdict event + bounded retries
        Ingest->>Art: Re-read exact-version clean tag; validate bytes
        Ingest->>BR: Converse with bounded JPEG/PNG bytes + schema
        Ingest->>DB: Transaction: assessment, location, memory, audit
        DB-->>Ingest: Commit acknowledged
    else trusted AWS Open Data only
        Agent->>Art: Re-read exact version; verify ETag, metadata, signature, SHA-256
        Agent->>BR: Converse with bounded converted bytes + schema
        Agent->>DB: Transaction: assessment, location, memory, audit
        DB-->>Agent: Commit acknowledged
    end
    Human->>UI: Run scenario from updated risk
    UI->>API: POST /api/simulations + bearer token
    API->>Agent: Request + request ID
    Agent->>DB: Read location/current state
    Agent->>DB: Spatial + vector recall of prior memories
    Agent->>Art: Read source/evidence metadata
    Agent->>BR: Converse with bounded context
    BR-->>Agent: Proposed plan/reasoning
    Agent->>Agent: Deterministic simulation + validation
    Agent->>DB: Transaction: run, decisions, outcome memory, audit event
    DB-->>Agent: Commit acknowledged
    Agent-->>API: Result + provenance + memory mode
    API-->>UI: JSON response
    UI-->>Human: Risk, retrieved memory, plan, caveats
```

## Agent responsibilities

- **Risk assessor** normalizes terrain, satellite-source metadata, and fire/seismic features into bounded scores.
- **Similarity retriever** combines location/hazard filters with CockroachDB vector distance over deterministic feature-hash embeddings. Embeddings are stored transactionally beside operational memory.
- **Simulator** runs reproducible hazard spread/impact calculations; it does not outsource numeric truth to a language model.
- **Agricultural resilience simulator** combines persisted Sentinel-2 vegetation/moisture/slope/fire evidence with explicitly named operator assumptions for rainfall deficit, heat anomaly, irrigation coverage, and horizon. It does not claim observed weather or predicted yield.
- **Resource planner** asks Amazon Bedrock `Converse` for a bounded plan using retrieved evidence, then validates/merges it with deterministic results.
- **Commander / learner** commits the simulation, plan, outcome, and audit event as durable shared memory.

## Trust boundaries

| Boundary | Control |
|---|---|
| Browser → Cognito/API | OAuth authorization code + PKCE, no SPA client secret, API Gateway JWT issuer/audience/`openid` scope validation, exact CORS origin, JSON validation, throttles. Health alone is public. |
| Browser → S3 quarantine | Short-lived presigned POST fixes bucket/key/content type, metadata, server-side encryption, and a 5 MB content-length range; bucket CORS is scoped to the UI origin. Browser credentials cannot select a different prefix or bucket. |
| API → Sentinel-2 AWS Open Data | Unsigned reads are hard-coded to `sentinel-s2-l2a` in `eu-central-1`; a strict L2A `tiles/.../R60m/TCI.jp2` regex, 12 MB bound, exact length, and JPEG-2000 magic check reject arbitrary URLs/buckets/keys. |
| Lambda → CockroachDB Cloud | Secrets Manager URL must use `sslmode=verify-full`; least-privilege SQL user and parameterized queries. Loopback-only integration may use insecure mode. |
| Lambda → Bedrock | AWS SigV4 identity, one configured foundation-model ARN, bounded inputs/timeouts. |
| S3 → GuardDuty → EventBridge → ingestion | GuardDuty scans only the quarantine prefix and tags the scanned version. EventBridge carries GuardDuty verdicts, not raw S3 creation. Ingestion re-reads the exact-version `GuardDutyMalwareScanStatus=NO_THREATS_FOUND` tag before fetching bytes; threats, unsupported, denied, missing, or failed scans never reach Bedrock. |
| Trusted Open Data copy → API Lambda | Available only when GuardDuty is disabled. Browser uploads fail closed. The server alone chooses the fixed public bucket, computes the upstream hash, writes immutable provenance, then re-reads the exact S3 version and verifies ETag, key shape, metadata, byte length, JPEG-2000 signature, and SHA-256 before Bedrock. |
| CloudFront → web S3 | Origin Access Control signed requests; public access blocked. |
| Operator → CockroachDB | CockroachDB Cloud Console authentication and sanitized usage evidence; never expose a SQL credential in the browser or submission. |

## Durable memory model

The logical memory unit links a location, hazard, optional simulation/assessment, source/provenance, human/model agent, text content, structured outcome, importance/confidence, timestamps, and a fixed-dimension vector. Satellite assessment, learned observation, location update, and audit rows commit together; simulation, learned outcome, and audit rows do the same. Operational rows and vectors share one CockroachDB transaction and backup domain, avoiding consistency gaps with an external vector database.

The production recall path should:

1. filter by tenant/scope, hazard, freshness, and authorization;
2. order unit-normalized candidates by L2 distance (`<->`) so CockroachDB's C-SPANN `VECTOR INDEX` executes a vector search; cosine similarity is derived as `1 - distance² / 2`;
3. preserve source/timestamp/confidence in the context sent to Bedrock;
4. update access counters separately so a failed metric write cannot lose the decision;
5. write the new run and memory in one retryable serializable transaction.

## Failure behavior

| Failure | Expected behavior |
|---|---|
| Bedrock timeout/throttle | Return deterministic simulation plus `planning_mode=degraded`; do not fabricate model output; retry with jitter only within request budget. |
| CockroachDB unavailable | Reject durable writes or mark response explicitly ephemeral; never report `memory_saved=true`; recovery relies on retry/idempotency key. |
| S3 unavailable | Continue only when the request does not require the artifact; keep its checksum/key and report missing evidence. |
| GuardDuty threat/unsupported/failed scan | Keep the object quarantined, return `rejected`, never call Bedrock or write learned memory, and alert/review retention according to operator policy. |
| GuardDuty clean event/tag mismatch | Fail closed and retry the asynchronous event; never trust the event payload without the independent object-version tag check. |
| GuardDuty unavailable/disabled | Browser upload tickets fail closed. Only the strict AWS Open Data importer may assess imagery after exact-version and source-hash verification. |
| Agricultural evidence missing/unverified | Reject the scenario; do not substitute demo features, a browser upload, arbitrary weather, or a different location's assessment. |
| Ingestion delivery/execution failure | EventBridge and Lambda retry within a bounded age; exhausted events enter an encrypted SQS dead-letter queue and raise an alarm. |
| Lambda retry/duplicate | The assessment object key is unique; event redelivery reads the existing assessment. Simulation/memory IDs and transactions prevent partial writes. |
| Browser/API loss | Previously committed memory remains in CockroachDB; client may retry with the same idempotency key. |
| Region loss | CockroachDB multi-region capability is the production path; the Basic-plan hackathon default demonstrates software behavior but is **not** proof of a live multi-region failover. |

## Scaling path

API Gateway and Lambda scale stateless execution; separate parameterized API/ingestion reserved-concurrency caps default to 0/0 so low-quota accounts retain the required unreserved pool. The HTTP API defaults to 20 req/s with burst 40, while each warm process caps its CockroachDB pool at four connections. Maximum possible database connections therefore rise with warm Lambda concurrency—these parameters must be tuned together from authenticated cloud load results. EventBridge decouples GuardDuty-cleared imagery from browser latency; trusted-source assessment is synchronous and must remain bounded by the API timeout. S3 stores imagery/evidence while CockroachDB stores durable keys, hashes, metadata, extracted features, decisions, and embeddings. Raise vector dimensions or migrate embedding models only through a versioned backfill and parallel index—not in place.
