#!/usr/bin/env bash
set -euo pipefail

: "${SATELLITE_FILE:?Set SATELLITE_FILE to a JPEG, PNG, GIF, or WebP image}"

base_url=${API_BASE_URL:-}
base_url=${base_url%/}
bearer_token=${API_BEARER_TOKEN:-}
location_id=${SATELLITE_LOCATION_ID:-}
require_bedrock=${REQUIRE_BEDROCK_ASSESSMENT:-false}

[[ -n "$base_url" ]] || { echo "Set API_BASE_URL to the deployed URL ending in /api." >&2; exit 2; }
[[ -f "$SATELLITE_FILE" ]] || { echo "SATELLITE_FILE does not exist: $SATELLITE_FILE" >&2; exit 2; }
command -v curl >/dev/null 2>&1 || { echo "curl is required." >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq is required." >&2; exit 1; }
command -v file >/dev/null 2>&1 || { echo "file is required to detect the image content type." >&2; exit 1; }

content_type=$(file --brief --mime-type "$SATELLITE_FILE")
case "$content_type" in
  image/jpeg|image/png|image/gif|image/webp) ;;
  *) echo "Unsupported SATELLITE_FILE content type: $content_type" >&2; exit 2 ;;
esac
if [[ "$require_bedrock" != "true" && "$require_bedrock" != "false" ]]; then
  echo "REQUIRE_BEDROCK_ASSESSMENT must be 'true' or 'false'." >&2
  exit 2
fi

api_request() {
  local method=$1
  local path=$2
  local body=${3:-}
  local args=(-fsS --connect-timeout 5 --max-time 35 -X "$method" -H 'content-type: application/json')
  if [[ -n "$body" ]]; then
    args+=(-d "$body")
  fi
  if [[ -n "$bearer_token" ]]; then
    printf 'header = "authorization: Bearer %s"\n' "$bearer_token" | curl --config - "${args[@]}" "$base_url$path"
  else
    curl "${args[@]}" "$base_url$path"
  fi
}

if [[ -z "$location_id" ]]; then
  dashboard=$(api_request GET /dashboard)
  location_id=$(printf '%s\n' "$dashboard" | jq -er '.data.locations[0].id')
fi

filename=$(basename "$SATELLITE_FILE")
upload_payload=$(jq -cn \
  --arg location_id "$location_id" \
  --arg filename "$filename" \
  --arg content_type "$content_type" \
  '{location_id:$location_id,filename:$filename,content_type:$content_type}')
upload_response=$(api_request POST /uploads "$upload_payload")
upload_url=$(printf '%s\n' "$upload_response" | jq -er '.data.upload_url')
object_key=$(printf '%s\n' "$upload_response" | jq -er '.data.object_key')

form_args=()
while IFS=$'\t' read -r field_name field_value; do
  form_args+=(-F "$field_name=$field_value")
done < <(printf '%s\n' "$upload_response" | jq -r '.data.fields | to_entries[] | [.key, .value] | @tsv')
form_args+=(-F "file=@${SATELLITE_FILE};type=${content_type}")

echo "Uploading a constrained image directly to private S3 key: $object_key"
curl -fsS --connect-timeout 5 --max-time 60 -X POST "${form_args[@]}" "$upload_url" >/dev/null

echo "Waiting for GuardDuty scan → EventBridge → Lambda → CockroachDB assessment..."
assessment=""
encoded_object_key=$(jq -rn --arg value "$object_key" '$value | @uri')
for ((_attempt=1; _attempt<=180; _attempt++)); do
  assessment_response=$(api_request GET "/assessments?object_key=$encoded_object_key")
  pipeline_status=$(printf '%s\n' "$assessment_response" | jq -er '.data.status')
  if [[ "$pipeline_status" == "rejected" ]]; then
    scan_status=$(printf '%s\n' "$assessment_response" | jq -er '.data.malware_scan_status')
    echo "GuardDuty rejected the quarantined object with status $scan_status." >&2
    exit 1
  fi
  assessment=$(printf '%s\n' "$assessment_response" | jq -c '.data.assessment // empty')
  if [[ -n "$assessment" ]]; then
    break
  fi
  sleep 2
done

[[ -n "$assessment" ]] || {
  echo "No assessment appeared within 6 minutes. Inspect GuardDuty, the ingestion Lambda, and SatelliteFailureQueue." >&2
  exit 1
}
printf '%s\n' "$assessment" | jq .
assessed_object_key=$(printf '%s\n' "$assessment" | jq -er '.source.object_key')
[[ "$assessed_object_key" == "$object_key" ]] || { echo "Assessment provenance does not match the uploaded object." >&2; exit 1; }
persisted=$(printf '%s\n' "$assessment" | jq -er '.persisted')
[[ "$persisted" == "true" ]] || { echo "Assessment was not acknowledged as durable." >&2; exit 1; }
scan_status=$(printf '%s\n' "$assessment" | jq -er '.source.malware_scan_status')
[[ "$scan_status" == "NO_THREATS_FOUND" ]] || { echo "Assessment lacks a verified clean GuardDuty verdict." >&2; exit 1; }
persistence_provider=$(printf '%s\n' "$assessment" | jq -er '.persistence_provider' | tr '[:upper:]' '[:lower:]')
[[ "$persistence_provider" == "cockroachdb" ]] || {
  echo "Assessment persistence provider was '$persistence_provider', not CockroachDB." >&2
  exit 1
}
if [[ "$require_bedrock" == "true" ]]; then
  provider=$(printf '%s\n' "$assessment" | jq -er '.provider')
  [[ "$provider" == "amazon-bedrock" ]] || {
    echo "Assessment provider was '$provider', not live Amazon Bedrock." >&2
    exit 1
  }
fi

echo "Satellite ingestion smoke passed for object $object_key."
