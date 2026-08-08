#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to a CockroachDB Cloud TLS connection URL}"
verification_file=${VERIFY_FILE:-database/verify.sql}
[[ -f "$verification_file" ]] || { echo "Verification SQL not found: $verification_file" >&2; exit 1; }
if [[ "$DATABASE_URL" != *"sslmode=verify-full"* ]]; then
  echo "Refusing a CockroachDB Cloud URL without sslmode=verify-full." >&2
  exit 2
fi

echo "Inspecting CockroachDB schema and vector-index metadata (URL redacted)."
if command -v cockroach >/dev/null 2>&1; then
  cockroach sql --url "$DATABASE_URL" --set=errexit=true --file "$verification_file"
elif command -v psql >/dev/null 2>&1; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$verification_file"
else
  echo "Install the CockroachDB SQL CLI or psql." >&2
  exit 1
fi

cat <<'EOF'

Verification printed metadata, but human review is still required:
  - confirm the target database/user are correct;
  - confirm crdb_internal.table_indexes contains the expected VECTOR indexes;
  - confirm EXPLAIN says "vector search" for the exact <-> production recall query;
  - save only sanitized output as evidence.
EOF
