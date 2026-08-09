#!/usr/bin/env bash
set -euo pipefail

stack_name=${STACK_NAME:-sentineltwin}
region=${AWS_REGION:-us-west-2}
allowed_origin=${CORS_ORIGIN:-http://localhost:5173}
model_id=${BEDROCK_MODEL_ID:-amazon.nova-lite-v1:0}
lambda_architecture=${LAMBDA_ARCHITECTURE:-x86_64}
legacy_sam_build_mode=${SAM_BUILD_MODE:-}
sam_build_mode=${SENTINEL_SAM_BUILD_MODE:-${legacy_sam_build_mode:-container}}
unset SAM_BUILD_MODE
if [[ -n "$legacy_sam_build_mode" ]]; then
  echo "WARNING: SAM_BUILD_MODE is reserved by AWS SAM; use SENTINEL_SAM_BUILD_MODE. Translating the legacy value safely." >&2
fi
demo_mode=${SENTINEL_DEMO_MODE:-false}
auth_mode=${AUTH_MODE:-cognito}
satellite_prefix=${SATELLITE_INPUT_PREFIX:-sentineltwin/quarantine/}
api_reserved_concurrency=${API_RESERVED_CONCURRENCY:-0}
ingestion_reserved_concurrency=${INGESTION_RESERVED_CONCURRENCY:-0}
api_detailed_metrics_enabled=${API_DETAILED_METRICS_ENABLED:-false}
api_throttle_burst=${API_THROTTLE_BURST_LIMIT:-40}
api_throttle_rate=${API_THROTTLE_RATE_LIMIT:-20}
database_pool_max_size=${DATABASE_POOL_MAX_SIZE:-4}
secret_arn=${DATABASE_SECRET_ARN:-}
secret_name=${DATABASE_SECRET_NAME:-sentineltwin/cockroachdb}

case "$auth_mode" in
  cognito|public) ;;
  *) echo "AUTH_MODE must be 'cognito' or 'public'." >&2; exit 2 ;;
esac
case "$demo_mode" in
  true|false) ;;
  *) echo "SENTINEL_DEMO_MODE must be 'true' or 'false'." >&2; exit 2 ;;
esac
case "$api_detailed_metrics_enabled" in
  true|false) ;;
  *) echo "API_DETAILED_METRICS_ENABLED must be 'true' or 'false'." >&2; exit 2 ;;
esac
case "$lambda_architecture" in
  x86_64|arm64) ;;
  *) echo "LAMBDA_ARCHITECTURE must be 'x86_64' or 'arm64'." >&2; exit 2 ;;
esac
case "$sam_build_mode" in
  container|native-linux) ;;
  *) echo "SENTINEL_SAM_BUILD_MODE must be 'container' or 'native-linux'." >&2; exit 2 ;;
esac

if [[ "$satellite_prefix" != */ || "$satellite_prefix" == /* || "$satellite_prefix" == *".."* ]]; then
  echo "SATELLITE_INPUT_PREFIX must be relative, end in '/', and not contain '..'." >&2
  exit 2
fi

validate_integer_range() {
  local name=$1 value=$2 minimum=$3 maximum=$4
  if [[ ! "$value" =~ ^[0-9]+$ ]] || (( value < minimum || value > maximum )); then
    echo "$name must be an integer between $minimum and $maximum." >&2
    exit 2
  fi
}
validate_optional_integer_range() {
  local name=$1 value=$2 minimum=$3 maximum=$4
  if [[ "$value" == "0" ]]; then
    return
  fi
  validate_integer_range "$name" "$value" "$minimum" "$maximum"
}
validate_optional_integer_range API_RESERVED_CONCURRENCY "$api_reserved_concurrency" 2 500
validate_optional_integer_range INGESTION_RESERVED_CONCURRENCY "$ingestion_reserved_concurrency" 1 100
validate_integer_range API_THROTTLE_BURST_LIMIT "$api_throttle_burst" 1 5000
validate_integer_range API_THROTTLE_RATE_LIMIT "$api_throttle_rate" 1 5000
validate_integer_range DATABASE_POOL_MAX_SIZE "$database_pool_max_size" 1 20

if [[ "$auth_mode" == "public" ]]; then
  if [[ "$demo_mode" != "true" ]]; then
    echo "AUTH_MODE=public requires SENTINEL_DEMO_MODE=true." >&2
    exit 2
  fi
  if [[ -n "$secret_arn" ]]; then
    echo "AUTH_MODE=public requires DATABASE_SECRET_ARN to be empty; public routes cannot reach persistent data." >&2
    exit 2
  fi
  echo "WARNING: deploying an unauthenticated, synthetic-data-only demo; no CockroachDB secret will be resolved." >&2
fi
if [[ ! "$allowed_origin" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]] && \
   [[ ! "$allowed_origin" =~ ^http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$ ]]; then
  echo "CORS_ORIGIN must be one exact HTTPS origin; only localhost or 127.0.0.1 may use HTTP." >&2
  exit 2
fi

command -v aws >/dev/null 2>&1 || { echo "AWS CLI is required." >&2; exit 1; }
command -v sam >/dev/null 2>&1 || { echo "AWS SAM CLI is required." >&2; exit 1; }
if [[ "$sam_build_mode" == "container" ]]; then
  command -v docker >/dev/null 2>&1 || { echo "Docker is required for containerized Lambda dependency packaging." >&2; exit 1; }
  docker info >/dev/null 2>&1 || { echo "Start the Docker daemon before deploying." >&2; exit 1; }
else
  if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" || "$lambda_architecture" != "x86_64" ]]; then
    echo "SENTINEL_SAM_BUILD_MODE=native-linux requires a Linux x86_64 host and LAMBDA_ARCHITECTURE=x86_64." >&2
    exit 2
  fi
  command -v python3.12 >/dev/null 2>&1 || { echo "Python 3.12 is required for a native Linux Lambda build." >&2; exit 1; }
  python3.12 -c 'import sys; raise SystemExit(sys.version_info[:2] != (3, 12))' || {
    echo "The native Linux Lambda build requires exactly Python 3.12." >&2
    exit 1
  }
fi

account_id=$(aws sts get-caller-identity --region "$region" --query Account --output text)
[[ "$account_id" =~ ^[0-9]{12}$ ]] || { echo "Could not resolve a valid AWS account ID." >&2; exit 1; }
caller_arn=$(aws sts get-caller-identity --region "$region" --query Arn --output text)
if [[ "$caller_arn" == "arn:"*":iam::${account_id}:root" ]]; then
  root_mfa_enabled=$(aws iam get-account-summary --query 'SummaryMap.AccountMFAEnabled' --output text)
  if [[ "$root_mfa_enabled" != "1" ]]; then
    echo "Refusing to deploy because the AWS root user has no MFA. Enable root MFA, then use a least-privilege deployment identity where possible." >&2
    exit 2
  fi
  echo "WARNING: deploying as the AWS root user. Prefer a temporary least-privilege deployment identity." >&2
fi

lambda_concurrency_quota=$(aws lambda get-account-settings \
  --region "$region" \
  --query 'AccountLimit.ConcurrentExecutions' \
  --output text)
if [[ ! "$lambda_concurrency_quota" =~ ^[0-9]+$ ]]; then
  echo "Could not resolve the regional Lambda concurrency quota." >&2
  exit 1
fi
requested_reserved_concurrency=$((api_reserved_concurrency + ingestion_reserved_concurrency))
max_reservable_concurrency=0
if (( lambda_concurrency_quota > 100 )); then
  max_reservable_concurrency=$((lambda_concurrency_quota - 100))
fi
if (( requested_reserved_concurrency > max_reservable_concurrency )); then
  echo "Lambda concurrency quota is ${lambda_concurrency_quota}; ${max_reservable_concurrency} additional executions can be reserved while the required unreserved pool is protected." >&2
  echo "Set both reserved-concurrency values to 0 or obtain an approved quota increase before deploying." >&2
  exit 2
fi

domain_prefix=${COGNITO_DOMAIN_PREFIX:-sentineltwin-${account_id}-${region}}
artifact_bucket_name=${ARTIFACT_BUCKET_NAME:-sentineltwin-${account_id}-${region}-artifacts}
if [[ ! "$domain_prefix" =~ ^[a-z0-9-]{3,63}$ ]]; then
  echo "COGNITO_DOMAIN_PREFIX must be 3-63 lowercase letters, numbers, or hyphens." >&2
  exit 2
fi
if [[ ! "$artifact_bucket_name" =~ ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ ]]; then
  echo "ARTIFACT_BUCKET_NAME must be a valid 3-63 character lowercase S3 bucket name without dots." >&2
  exit 2
fi

if [[ -z "$secret_arn" && "$demo_mode" != "true" ]]; then
  secret_arn=$(aws secretsmanager describe-secret \
    --secret-id "$secret_name" \
    --region "$region" \
    --query ARN \
    --output text 2>/dev/null || true)
fi
if [[ -z "$secret_arn" && "$demo_mode" != "true" ]]; then
  echo "No CockroachDB secret found. Run make secret or explicitly set SENTINEL_DEMO_MODE=true." >&2
  exit 2
fi

sam validate --lint --template-file infra/template.yaml
if [[ "$sam_build_mode" == "container" ]]; then
  sam build --use-container --template-file infra/template.yaml
else
  sam build --template-file infra/template.yaml
fi
sam deploy \
  --template-file .aws-sam/build/template.yaml \
  --stack-name "$stack_name" \
  --region "$region" \
  --resolve-s3 \
  --capabilities CAPABILITY_IAM \
  --no-confirm-changeset \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    "StageName=prod" \
    "AllowedOrigin=$allowed_origin" \
    "CockroachSecretArn=$secret_arn" \
    "BedrockModelId=$model_id" \
    "LambdaArchitecture=$lambda_architecture" \
    "AuthMode=$auth_mode" \
    "CognitoDomainPrefix=$domain_prefix" \
    "ArtifactBucketName=$artifact_bucket_name" \
    "SatelliteInputPrefix=$satellite_prefix" \
    "ApiReservedConcurrency=$api_reserved_concurrency" \
    "IngestionReservedConcurrency=$ingestion_reserved_concurrency" \
    "ApiDetailedMetricsEnabled=$api_detailed_metrics_enabled" \
    "ApiThrottleBurstLimit=$api_throttle_burst" \
    "ApiThrottleRateLimit=$api_throttle_rate" \
    "DatabasePoolMaxSize=$database_pool_max_size" \
    "DemoMode=$demo_mode"

echo "Stack outputs:"
aws cloudformation describe-stacks \
  --stack-name "$stack_name" \
  --region "$region" \
  --query 'Stacks[0].Outputs[].{Name:OutputKey,Value:OutputValue}' \
  --output table
