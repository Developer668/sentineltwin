#!/usr/bin/env bash
set -euo pipefail

stack_name=${STACK_NAME:-sentineltwin}
region=${AWS_REGION:-us-west-2}
allowed_origin=${CORS_ORIGIN:-http://localhost:5173}
model_id=${BEDROCK_MODEL_ID:-amazon.nova-lite-v1:0}
demo_mode=${SENTINEL_DEMO_MODE:-false}
auth_mode=${AUTH_MODE:-cognito}
satellite_prefix=${SATELLITE_INPUT_PREFIX:-sentineltwin/quarantine/}
api_reserved_concurrency=${API_RESERVED_CONCURRENCY:-10}
ingestion_reserved_concurrency=${INGESTION_RESERVED_CONCURRENCY:-4}
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
validate_integer_range API_RESERVED_CONCURRENCY "$api_reserved_concurrency" 2 500
validate_integer_range INGESTION_RESERVED_CONCURRENCY "$ingestion_reserved_concurrency" 1 100
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
command -v docker >/dev/null 2>&1 || { echo "Docker is required for Lambda-compatible dependency packaging." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Start the Docker daemon before deploying." >&2; exit 1; }

account_id=$(aws sts get-caller-identity --region "$region" --query Account --output text)
[[ "$account_id" =~ ^[0-9]{12}$ ]] || { echo "Could not resolve a valid AWS account ID." >&2; exit 1; }

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
sam build --use-container --template-file infra/template.yaml
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
    "AuthMode=$auth_mode" \
    "CognitoDomainPrefix=$domain_prefix" \
    "ArtifactBucketName=$artifact_bucket_name" \
    "SatelliteInputPrefix=$satellite_prefix" \
    "ApiReservedConcurrency=$api_reserved_concurrency" \
    "IngestionReservedConcurrency=$ingestion_reserved_concurrency" \
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
