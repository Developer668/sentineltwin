#!/usr/bin/env bash
set -euo pipefail

base_url=${API_BASE_URL:-}
base_url=${base_url%/}
bearer_token=${API_BEARER_TOKEN:-}
location_id=${SATELLITE_LOCATION_ID:-}
source_key=${SENTINEL_SOURCE_KEY:-tiles/10/S/EH/2024/7/15/0/R60m/TCI.jp2}

[[ -n "$base_url" ]] || { echo "Set API_BASE_URL to the deployed URL ending in /api." >&2; exit 2; }
command -v curl >/dev/null 2>&1 || { echo "curl is required." >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq is required." >&2; exit 1; }

api_request() {
  local method=$1 path=$2 body=${3:-}
  local args=(-fsS --connect-timeout 5 --max-time 40 -X "$method" -H 'content-type: application/json')
  [[ -z "$body" ]] || args+=(-d "$body")
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

payload=$(jq -cn --arg location_id "$location_id" --arg source_key "$source_key" \
  '{location_id:$location_id,source_key:$source_key}')
import_response=$(api_request POST /satellite/imports "$payload")
object_key=$(printf '%s\n' "$import_response" | jq -er '.data.object_key')
import_status=$(printf '%s\n' "$import_response" | jq -er '.data.status')
case "$import_status" in
  quarantine_pending_scan|trusted_source_assessed) ;;
  *) echo "Unexpected Sentinel-2 import status: $import_status" >&2; exit 1 ;;
esac
[[ $(printf '%s\n' "$import_response" | jq -er '.data.provider') == "aws-open-data-sentinel-2-l2a" ]]

echo "Imported s3://sentinel-s2-l2a/$source_key into private evidence storage: $object_key"
encoded_object_key=$(jq -rn --arg value "$object_key" '$value | @uri')
assessment=""
for ((_attempt=1; _attempt<=240; _attempt++)); do
  response=$(api_request GET "/assessments?object_key=$encoded_object_key")
  status=$(printf '%s\n' "$response" | jq -er '.data.status')
  if [[ "$status" == "rejected" ]]; then
    verdict=$(printf '%s\n' "$response" | jq -er '.data.malware_scan_status')
    echo "GuardDuty rejected the imported object with status $verdict." >&2
    exit 1
  fi
  assessment=$(printf '%s\n' "$response" | jq -c '.data.assessment // empty')
  [[ -z "$assessment" ]] || break
  sleep 2
done

[[ -n "$assessment" ]] || { echo "Sentinel-2 assessment did not finish within 8 minutes." >&2; exit 1; }
printf '%s\n' "$assessment" | jq .
verification_status=$(printf '%s\n' "$assessment" | jq -er '.source.malware_scan_status')
if [[ "$verification_status" == "NO_THREATS_FOUND" ]]; then
  [[ $(printf '%s\n' "$assessment" | jq -er '.source.malware_scan_provider') == "amazon-guardduty" ]]
elif [[ "$verification_status" == "NOT_APPLICABLE_TRUSTED_SOURCE" ]]; then
  [[ $(printf '%s\n' "$assessment" | jq -er '.source.content_validation_provider') == "sentineltwin-allowlisted-aws-open-data" ]]
  [[ $(printf '%s\n' "$assessment" | jq -er '.source.content_validation_status') == "SOURCE_HASH_VERIFIED" ]]
  [[ $(printf '%s\n' "$assessment" | jq -er '.source.ingestion_authority') == "allowlisted-source-hash" ]]
else
  echo "Assessment has no accepted source-verification evidence: $verification_status" >&2
  exit 1
fi
[[ $(printf '%s\n' "$assessment" | jq -er '.source.upstream.provider') == "aws-open-data-sentinel-2-l2a" ]]
[[ $(printf '%s\n' "$assessment" | jq -er '.source.upstream.bucket') == "sentinel-s2-l2a" ]]
[[ $(printf '%s\n' "$assessment" | jq -er '.source.upstream.object_key') == "$source_key" ]]
[[ $(printf '%s\n' "$assessment" | jq -er '.persisted') == "true" ]]
[[ $(printf '%s\n' "$assessment" | jq -er '.provider') == "amazon-bedrock" ]]
echo "Real Sentinel-2 → verified AWS evidence → Bedrock → CockroachDB smoke passed."
