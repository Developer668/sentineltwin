#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL before creating the AWS secret}"
region=${AWS_REGION:-us-west-2}
secret_name=${DATABASE_SECRET_NAME:-sentineltwin/cockroachdb}

if [[ "$DATABASE_URL" != *"sslmode=verify-full"* ]]; then
  echo "Refusing to store a CockroachDB Cloud URL without sslmode=verify-full." >&2
  exit 2
fi

command -v aws >/dev/null 2>&1 || { echo "AWS CLI is required." >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq is required." >&2; exit 1; }

secret_file=$(mktemp "${TMPDIR:-/tmp}/sentineltwin-secret.XXXXXX")
chmod 600 "$secret_file"
cleanup() {
  rm -f "$secret_file"
}
trap cleanup EXIT INT TERM
jq -n --arg database_url "$DATABASE_URL" '{DATABASE_URL: $database_url}' >"$secret_file"

if aws secretsmanager describe-secret --secret-id "$secret_name" --region "$region" >/dev/null 2>&1; then
  echo "Updating existing Secrets Manager value '$secret_name'."
  aws secretsmanager put-secret-value \
    --secret-id "$secret_name" \
    --secret-string "file://$secret_file" \
    --region "$region" >/dev/null
else
  echo "Creating Secrets Manager secret '$secret_name'."
  aws secretsmanager create-secret \
    --name "$secret_name" \
    --description "SentinelTwin CockroachDB Cloud TLS connection URL" \
    --secret-string "file://$secret_file" \
    --region "$region" >/dev/null
fi

secret_arn=$(aws secretsmanager describe-secret \
  --secret-id "$secret_name" \
  --region "$region" \
  --query ARN \
  --output text)
printf 'Secret stored without echoing its value.\nexport DATABASE_SECRET_ARN=%q\n' "$secret_arn"
