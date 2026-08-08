#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to a CockroachDB Cloud TLS connection URL}"
python_binary=${PYTHON_BINARY:-.venv/bin/python}
migration_runner=${MIGRATION_RUNNER:-database/migrate.py}

if [[ "$DATABASE_URL" != *"sslmode=verify-full"* ]]; then
  echo "Refusing a CockroachDB Cloud URL without sslmode=verify-full." >&2
  exit 2
fi

if [[ ! -x "$python_binary" ]]; then
  echo "Python environment '$python_binary' is missing. Run make install first." >&2
  exit 1
fi
if [[ ! -f "$migration_runner" ]]; then
  echo "Migration runner not found at '$migration_runner'." >&2
  exit 1
fi

echo "Applying ordered, tracked migrations to CockroachDB Cloud (URL redacted)."
DATABASE_URL="$DATABASE_URL" "$python_binary" "$migration_runner"
echo "Schema migrations completed. Demo fixtures are explicitly labeled by migration 002. Run make db-verify next."
