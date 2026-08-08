#!/usr/bin/env bash
set -euo pipefail

base_url=${API_BASE_URL:-http://127.0.0.1:8787/api}
base_url=${base_url%/}
bearer_token=${API_BEARER_TOKEN:-}
require_persistent=${REQUIRE_PERSISTENT:-false}
command -v curl >/dev/null 2>&1 || { echo "curl is required." >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq is required for the smoke test." >&2; exit 1; }

if [[ "$require_persistent" != "true" && "$require_persistent" != "false" ]]; then
  echo "REQUIRE_PERSISTENT must be 'true' or 'false'." >&2
  exit 2
fi

request() {
  local method=$1
  local path=$2
  local body=${3:-}
  local args=(-fsS --connect-timeout 5 --max-time 30 -X "$method" -H 'content-type: application/json')
  if [[ -n "$body" ]]; then
    args+=(-d "$body")
  fi
  if [[ -n "$bearer_token" ]]; then
    printf 'header = "authorization: Bearer %s"\n' "$bearer_token" | curl --config - "${args[@]}" "$base_url$path"
  else
    curl "${args[@]}" "$base_url$path"
  fi
}

echo "[1/4] health"
health_response=$(request GET /health)
printf '%s\n' "$health_response" | jq .
if [[ "$require_persistent" == "true" ]]; then
  mode=$(printf '%s\n' "$health_response" | jq -er '.data.mode // .meta.mode')
  provider=$(printf '%s\n' "$health_response" | jq -er '.data.provider // .meta.memory_provider')
  provider_normalized=$(printf '%s' "$provider" | tr '[:upper:]' '[:lower:]')
  database_state=$(printf '%s\n' "$health_response" | jq -er '.data.database')
  if [[ "$mode" != "production" || "$database_state" != "connected" || "$provider_normalized" != *"cockroachdb"* ]]; then
    echo "Persistent smoke precondition failed: mode=$mode provider=$provider database=$database_state" >&2
    exit 1
  fi
fi
echo
echo "[2/4] dashboard"
dashboard_response=$(request GET /dashboard)
printf '%s\n' "$dashboard_response" | jq .
location_id=$(printf '%s\n' "$dashboard_response" | jq -er '.data.locations[0].id')
echo
echo "[3/4] first simulation and atomic learned-memory write"
simulation_payload=$(jq -cn --arg location_id "$location_id" '{location_id:$location_id,hazard:"fire",parameters:{intensity:0.82,duration_minutes:720,cascading_impacts:["power"]},memory_limit:4}')
simulation_response=$(request POST /simulations "$simulation_payload")
printf '%s\n' "$simulation_response" | jq .
learned_memory_id=$(printf '%s\n' "$simulation_response" | jq -er '.data.learned_memory.id')
[[ -n "$learned_memory_id" ]] || { echo "Simulation did not return its atomically learned memory ID." >&2; exit 1; }
echo
echo "[4/4] second related simulation recalls the first learned memory"
second_payload=$(jq -cn --arg location_id "$location_id" '{location_id:$location_id,hazard:"fire",parameters:{intensity:0.79,duration_minutes:720,cascading_impacts:["power"]},memory_limit:8}')
second_response=$(request POST /simulations "$second_payload")
printf '%s\n' "$second_response" | jq .
if [[ "$require_persistent" == "true" ]]; then
  recalled=$(printf '%s\n' "$second_response" | jq -er --arg memory_id "$learned_memory_id" \
    '(.data.memory_context.memory_ids // []) | index($memory_id) != null')
  [[ "$recalled" == "true" ]] || {
    echo "Second simulation did not recall first learned memory $learned_memory_id." >&2
    exit 1
  }
fi
echo
echo "Smoke requests completed. REQUIRE_PERSISTENT=true proves a CockroachDB write followed by exact memory recall."
