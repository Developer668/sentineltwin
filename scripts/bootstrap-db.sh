#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to a CockroachDB Cloud TLS connection URL}"
python_binary=${PYTHON_BINARY:-.venv/bin/python}
migration_runner=${MIGRATION_RUNNER:-database/migrate.py}
apply_demo_fixtures=${SENTINEL_APPLY_DEMO_FIXTURES:-false}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

if [[ ! -x "$python_binary" ]]; then
  echo "Python environment '$python_binary' is missing. Run make install first." >&2
  exit 1
fi
if [[ ! -f "$migration_runner" ]]; then
  echo "Migration runner not found at '$migration_runner'." >&2
  exit 1
fi
printf '%s' "$DATABASE_URL" | "$python_binary" "$script_dir/validate-database-url.py"

case "$apply_demo_fixtures" in
  true) ;;
  false) ;;
  *)
    echo "SENTINEL_APPLY_DEMO_FIXTURES must be 'true' or 'false'." >&2
    exit 2
    ;;
esac

echo "Applying ordered, tracked migrations to CockroachDB Cloud (URL redacted)."
if [[ "$apply_demo_fixtures" == "true" ]]; then
  echo "WARNING: applying explicitly synthetic demo fixtures from migration 002." >&2
else
  echo "Synthetic demo fixtures are excluded; set SENTINEL_APPLY_DEMO_FIXTURES=true only for a labeled demo database."
fi
if [[ "$apply_demo_fixtures" == "true" ]]; then
  DATABASE_URL="$DATABASE_URL" "$python_binary" "$migration_runner" --include-demo-fixtures
else
  DATABASE_URL="$DATABASE_URL" "$python_binary" "$migration_runner"
fi
echo "Schema migrations completed. Run make db-verify next."
