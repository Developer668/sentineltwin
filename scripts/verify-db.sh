#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to a CockroachDB Cloud TLS connection URL}"
verification_file=${VERIFY_FILE:-database/verify.sql}
python_binary=${PYTHON_BINARY:-python3}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ -f "$verification_file" ]] || { echo "Verification SQL not found: $verification_file" >&2; exit 1; }
command -v "$python_binary" >/dev/null 2>&1 || { echo "Python is required." >&2; exit 1; }
printf '%s' "$DATABASE_URL" | "$python_binary" "$script_dir/validate-database-url.py"

echo "Inspecting CockroachDB schema and vector-index metadata (URL redacted)."
if command -v cockroach >/dev/null 2>&1; then
  COCKROACH_URL="$DATABASE_URL" cockroach sql --set=errexit=true --file "$verification_file"
else
  echo "Install the CockroachDB SQL CLI." >&2
  exit 1
fi

cat <<'EOF'

Verification printed metadata, but human review is still required:
  - confirm the target database/user are correct;
  - confirm crdb_internal.table_indexes contains the expected VECTOR indexes;
  - confirm EXPLAIN says "vector search" for the exact <-> production recall query;
  - save only sanitized output as evidence.
EOF
