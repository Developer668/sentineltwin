# AWS cost guardrails and teardown register

Reviewed: 2026-08-08 in the entrant AWS account, target region `us-west-2`.

## Account-level safety boundary

The account is currently on AWS's protected Free plan with **$100.00 of credits and 185 days remaining**. The AWS console states that this plan cannot charge the payment method; service access ends when the plan expires or the credits are depleted. Do not select **Upgrade plan** for this project. See the [AWS Free Tier FAQ](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-FAQ.html).

The stack has no EC2 instances, RDS database, NAT gateway, Elastic IP, load balancer, Route 53 hosted zone, AWS WAF subscription, customer-managed KMS key, provisioned Lambda concurrency, or CloudFront flat-rate plan. Those omissions are deliberate cost controls.

Before deployment, the script now enforces these account-specific controls:

- Lambda reserved concurrency defaults to `0` for both functions. The current regional concurrency quota is only 10, and the deploy preflight rejects reservations the account cannot support.
- API Gateway route-level detailed metrics default to `false`; default metrics and bounded 14-day access logs remain.
- HTTP API throttles remain 20 requests/second with burst 40, and each warm API process has a four-connection CockroachDB pool cap.
- The deployment stays on on-demand serverless pricing and does not request quota increases or provisioned capacity.
- Real write/load tests are opt-in; the required end-to-end proof uses one small clean image and a bounded number of model calls.

## Which services use allowances versus credits

| Service | Project use | Cost posture for the hackathon run | Termination target |
|---|---|---|---|
| AWS CloudFormation/SAM and IAM | Creates and manages the stack/runtime roles | No direct service charge. SAM uploads build artifacts to S3. | Delete the application stack; review the SAM-managed artifact bucket separately. |
| AWS Lambda | Two x86_64 on-demand functions | Expected to remain inside the [1M request / 400,000 GB-second monthly Lambda allowance](https://aws.amazon.com/lambda/pricing/) at demo traffic. There is no reserved or provisioned concurrency charge. Usage beyond the allowance consumes credits. | Deleted with the stack. |
| API Gateway HTTP API | Authenticated API plus public health route | The [new-customer allowance includes 1M HTTP API calls/month](https://aws.amazon.com/api-gateway/pricing/). Demo traffic should remain inside it; overage consumes credits. | Deleted with the stack. |
| Amazon S3 | Private web origin, versioned evidence/quarantine, SAM artifacts | Keep total objects below 5 GB and test requests far below the published [5 GB / 20,000 GET / 2,000 PUT allowance](https://docs.aws.amazon.com/hands-on/latest/backup-files-to-amazon-s3/backup-files-to-amazon-s3.html). Storage, versions, malware tags, and requests beyond applicable allowances consume credits. | Web bucket deletes with the stack only when empty. Evidence bucket is retained. SAM artifacts are separate. |
| Amazon CloudFront | Private static-site delivery | Pay-as-you-go distribution only; do not subscribe to a flat-rate plan because [Free Tier accounts are ineligible](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html). Hackathon traffic is expected inside the pay-as-you-go Free Tier; excess transfer/requests consume credits. | Deleted with the stack after propagation. |
| Amazon Cognito | Admin-invite OAuth code + PKCE, optional software TOTP MFA | The small operator/judge set is far below the [10,000 direct/social MAU allowance](https://aws.amazon.com/cognito/pricing/). The template uses software TOTP, not metered SMS MFA. | Delete the judge user after judging. The pool is intentionally retained and must be deleted manually. |
| AWS Secrets Manager | Stores one CockroachDB TLS URL | **Uses credits from deployment onward:** [about $0.40 per secret/month, prorated, plus API calls](https://aws.amazon.com/secrets-manager/pricing/). This is preferred over exposing a production database credential in Lambda configuration. | Delete or schedule deletion of the independent secret after the stack no longer uses it. |
| Amazon Bedrock (Nova Lite) | Live image assessment and plan reasoning | **Uses credits per input/output token from the first live invocation.** There is no provisioned throughput in this stack. Run only the bounded smoke/demo calls and check the [current Bedrock model pricing](https://aws.amazon.com/bedrock/pricing/) before a larger test. | No persistent model resource; stop invoking it and remove Lambda access with the stack. |
| GuardDuty Malware Protection for S3 (optional) | Scans only the quarantine prefix when enabled | The [first 1,000 requests and 1 GB scanned per month are free](https://aws.amazon.com/guardduty/pricing/), but this protected Free plan currently returns an account subscription/activation restriction. Deploy with it disabled unless AWS service access changes. In that mode browser uploads are disabled; exact-version/hash-verified AWS Open Data remains available. | If created, the malware protection plan and role delete with the stack. |
| EventBridge and SQS | Clean-verdict routing and encrypted failure queue | A few smoke-test events/queue operations are far inside the [SQS 1M request allowance](https://aws.amazon.com/sqs/pricing/) and normal AWS-service event volume. Excess usage consumes credits according to [EventBridge pricing](https://aws.amazon.com/eventbridge/pricing/). | Deleted with the stack. |
| CloudWatch Logs/alarms and X-Ray | Access logs, two Lambda log groups, three alarms, traces | Expected inside the [CloudWatch free allowances](https://aws.amazon.com/cloudwatch/pricing/) at demo volume. Detailed API metrics are off. Log ingestion/storage, alarms, or traces beyond allowances consume credits. | Alarms delete with the stack; the two Lambda log groups are retained, while the API access log group deletes. |
| CockroachDB Cloud Basic | Only durable application and agent-memory database | Separate from the AWS bill. Basic starts at $0/month but is usage-based; monitor the Cockroach Cloud usage/credit page independently. | Keep for judging only if needed; otherwise export authorized evidence and delete the cluster manually. |

The only unavoidable metered items in the intended secure path are the one Secrets Manager secret and the small number of Bedrock invocations. S3, Lambda, API Gateway, CloudFront, logs, traces, EventBridge, SQS, Cognito, and optional GuardDuty should remain inside their applicable allowances for the bounded test, but AWS credits are the backstop rather than a per-service hard cap.

## Free-tier versus production network boundary

The current CockroachDB cluster is Basic. CockroachDB documents that [AWS PrivateLink is unavailable on Basic](https://www.cockroachlabs.com/docs/cockroachcloud/aws-privatelink), and its SQL endpoints do not support IPv6. A Lambda function therefore cannot use the free IPv6 egress-only gateway approach to obtain an allowlistable path. Stable IPv4 egress would require a paid NAT/EIP design, while private connectivity requires moving to a supported CockroachDB plan and provisioning an AWS endpoint.

Consequently, the existing `0.0.0.0/0` SQL allowlist is acceptable only for the time-bounded, authenticated hackathon deployment with a least-privilege SQL user and TLS `verify-full`. CockroachDB itself [recommends removing that entry before production](https://www.cockroachlabs.com/docs/cockroachcloud/network-authorization). Do not describe this free-tier topology as network-hardened production. The two honest production options are:

1. approve the credits/cost for stable Lambda IPv4 egress and allowlist only that address; or
2. move to CockroachDB Standard/Advanced and use AWS PrivateLink, after reviewing both CockroachDB and VPC endpoint pricing.

Neither paid topology will be created implicitly.

## Teardown order after judging

Capture only sanitized evidence you are authorized to retain, then resolve every resource by CloudFormation output or ARN. Do not delete guessed bucket names or database clusters.

1. Disable external use: stop publishing the CloudFront URL and do not run further Bedrock/write tests.
2. Record the stack outputs, exact artifact/web bucket names, Cognito user-pool ID, log-group names, Secrets Manager ARN, and SAM managed bucket name before deleting the stack.
3. Empty **all versions and delete markers** from the versioned web bucket; current objects alone are not sufficient. This is irreversible and requires a separately reviewed destructive action.
4. Delete the `sentineltwin` CloudFormation stack and wait for completion. This removes CloudFront, the web bucket, API Gateway, Lambdas/runtime roles, EventBridge, GuardDuty malware plan, SQS, alarms, and non-retained resources.
5. Manually review and delete the retained artifact/evidence S3 bucket and every object version only after deciding what submission evidence to keep.
6. Manually delete the retained Cognito user pool after the judging login is no longer needed.
7. Manually delete the retained Lambda log groups after exporting sanitized operational evidence.
8. Delete or schedule deletion of `sentineltwin/cockroachdb` in Secrets Manager. It is independent of the stack and otherwise continues consuming credits.
9. Review the SAM CLI managed deployment bucket. Remove only artifacts belonging to this stack; delete the shared bucket/managed stack only if no other SAM applications use it.
10. Delete the CloudShell source archive/build directory to reclaim CloudShell home storage; these files are not application resources.
11. In CockroachDB Cloud, remove temporary broad/admin network rules. After evidence retention is decided, delete the Basic cluster if it is no longer needed.
12. Re-open AWS Billing/Free Tier and Resource Explorer in every used region. Confirm no stack, Lambda, API, CloudFront distribution, S3 bucket, Cognito pool, GuardDuty plan, SQS queue, retained log group, or secret remains unexpectedly.

CloudFormation stack deletion is not sufficient by itself because the evidence bucket, Cognito pool, Lambda log groups, Secrets Manager secret, SAM artifact bucket, and CockroachDB cluster have independent or retained lifecycles.
