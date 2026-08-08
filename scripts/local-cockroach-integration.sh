#!/usr/bin/env bash
set -euo pipefail

cockroach_binary=${COCKROACH_BINARY:-}
python_binary=${PYTHON_BINARY:-.venv/bin/python}

if [[ -z "$cockroach_binary" ]]; then
  cockroach_binary=$(command -v cockroach || true)
fi
[[ -n "$cockroach_binary" && -x "$cockroach_binary" ]] || {
  echo "Set COCKROACH_BINARY or install the CockroachDB SQL binary (v25.4+)." >&2
  exit 1
}
[[ -x "$python_binary" ]] || {
  echo "Python environment '$python_binary' is missing. Run make install first." >&2
  exit 1
}
command -v curl >/dev/null 2>&1 || { echo "curl is required." >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq is required." >&2; exit 1; }

if ! python3 - <<'PY'
import socket
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 8787))
PY
then
  echo "Port 8787 is already in use; stop the existing local API before this isolated integration run." >&2
  exit 2
fi

reserve_port() {
  python3 - <<'PY'
import socket
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    print(sock.getsockname()[1])
PY
}

sql_port=$(reserve_port)
http_port=$(reserve_port)
while [[ "$http_port" == "$sql_port" ]]; do
  http_port=$(reserve_port)
done

task_dir=$(mktemp -d "${TMPDIR:-/tmp}/sentineltwin-crdb.XXXXXX")
database_pid=""
api_pid=""
cleanup() {
  result=$?
  trap - EXIT INT TERM
  if [[ -n "$api_pid" ]] && kill -0 "$api_pid" 2>/dev/null; then
    kill "$api_pid" 2>/dev/null || true
    wait "$api_pid" 2>/dev/null || true
  fi
  if [[ -n "$database_pid" ]] && kill -0 "$database_pid" 2>/dev/null; then
    kill "$database_pid" 2>/dev/null || true
    wait "$database_pid" 2>/dev/null || true
  fi
  if (( result != 0 )); then
    echo "Local integration failed. Recent CockroachDB log:" >&2
    tail -n 40 "$task_dir/cockroach.log" 2>/dev/null >&2 || true
    echo "Recent API log:" >&2
    tail -n 40 "$task_dir/api.log" 2>/dev/null >&2 || true
  fi
  if [[ "$task_dir" == "${TMPDIR:-/tmp}"/sentineltwin-crdb.* ]]; then
    rm -rf -- "$task_dir"
  fi
  exit "$result"
}
trap cleanup EXIT INT TERM

listen_address="127.0.0.1:$sql_port"
database_url="postgresql://root@${listen_address}/sentineltwin?sslmode=disable"
default_url="postgresql://root@${listen_address}/defaultdb?sslmode=disable"

"$cockroach_binary" start-single-node \
  --insecure \
  --store "$task_dir/store" \
  --listen-addr "$listen_address" \
  --http-addr "127.0.0.1:$http_port" \
  >"$task_dir/cockroach.log" 2>&1 &
database_pid=$!

ready=false
for ((_attempt=1; _attempt<=80; _attempt++)); do
  if "$cockroach_binary" sql --url "$default_url" --execute 'SELECT 1' >/dev/null 2>&1; then
    ready=true
    break
  fi
  if ! kill -0 "$database_pid" 2>/dev/null; then
    break
  fi
  sleep 0.25
done
[[ "$ready" == "true" ]] || { echo "CockroachDB did not become ready." >&2; exit 1; }

echo "Applying SentinelTwin schema to isolated CockroachDB on loopback."
"$cockroach_binary" sql --url "$default_url" --set=errexit=true \
  --execute 'CREATE DATABASE IF NOT EXISTS sentineltwin;'
DATABASE_URL="$database_url" "$python_binary" database/migrate.py

env \
  PYTHONPATH=backend \
  DATABASE_URL="$database_url" \
  DATABASE_SECRET_ARN= \
  SENTINEL_DEMO_MODE=false \
  BEDROCK_MODEL_ID= \
  ARTIFACT_BUCKET= \
  CORS_ORIGIN=http://127.0.0.1:5173 \
  "$python_binary" -m sentineltwin.local_server >"$task_dir/api.log" 2>&1 &
api_pid=$!

api_ready=false
for ((_attempt=1; _attempt<=80; _attempt++)); do
  if curl -fsS --max-time 2 http://127.0.0.1:8787/api/health >/dev/null 2>&1; then
    api_ready=true
    break
  fi
  if ! kill -0 "$api_pid" 2>/dev/null; then
    break
  fi
  sleep 0.25
done
[[ "$api_ready" == "true" ]] || { echo "Local API did not become ready." >&2; exit 1; }

REQUIRE_PERSISTENT=true API_BASE_URL=http://127.0.0.1:8787/api ./scripts/smoke-test.sh
"$cockroach_binary" sql --url "$database_url" --set=errexit=true --file database/verify.sql

echo "Isolated CockroachDB schema, vector query, API read, and durable simulation write all passed."
