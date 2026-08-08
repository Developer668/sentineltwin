#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to an admin CockroachDB Cloud TLS URL}"

database_name=${COCKROACH_DATABASE:-sentineltwin}
regions_csv=${COCKROACH_REGIONS:-}
primary_region=${COCKROACH_PRIMARY_REGION:-}
apply_changes=${MULTI_REGION_APPLY:-false}
confirmation=${MULTI_REGION_CONFIRM:-}
global_reference_tables=${COCKROACH_GLOBAL_REFERENCE_TABLES:-true}

if [[ ! "$database_name" =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo "COCKROACH_DATABASE contains unsupported characters." >&2
  exit 2
fi
if [[ -z "$regions_csv" ]]; then
  echo "Set COCKROACH_REGIONS to at least three existing cluster regions, comma-separated." >&2
  exit 2
fi
if [[ "$DATABASE_URL" != *"sslmode=verify-full"* ]]; then
  echo "Refusing a CockroachDB Cloud URL without sslmode=verify-full." >&2
  exit 2
fi

if command -v cockroach >/dev/null 2>&1; then
  sql_exec() {
    cockroach sql --url "$DATABASE_URL" --database "$database_name" --set=errexit=true --execute "$1"
  }
  sql_values() {
    cockroach sql --url "$DATABASE_URL" --database "$database_name" --format=csv --execute "$1" | tail -n +2
  }
elif command -v psql >/dev/null 2>&1; then
  sql_exec() {
    psql --dbname="$DATABASE_URL" -v ON_ERROR_STOP=1 -c "$1"
  }
  sql_values() {
    psql --dbname="$DATABASE_URL" -v ON_ERROR_STOP=1 -At -c "$1"
  }
else
  echo "Install the CockroachDB SQL CLI or psql." >&2
  exit 1
fi

IFS=',' read -r -a raw_regions <<<"$regions_csv"
regions=()
seen=":"
for raw_region in "${raw_regions[@]}"; do
  region=${raw_region//[[:space:]]/}
  if [[ ! "$region" =~ ^[A-Za-z0-9_-]+$ ]]; then
    echo "Invalid region '$raw_region'. Use names returned by SHOW REGIONS FROM CLUSTER." >&2
    exit 2
  fi
  if [[ "$seen" != *":$region:"* ]]; then
    regions+=("$region")
    seen+="$region:"
  fi
done
if (( ${#regions[@]} < 3 )); then
  echo "Region survival requires at least three distinct database regions." >&2
  exit 2
fi
if [[ -z "$primary_region" ]]; then
  primary_region=${regions[0]}
fi
if [[ "$seen" != *":$primary_region:"* ]]; then
  echo "COCKROACH_PRIMARY_REGION must be included in COCKROACH_REGIONS." >&2
  exit 2
fi

cluster_regions=$(sql_values "SELECT region FROM [SHOW REGIONS FROM CLUSTER] ORDER BY region;")
for region in "${regions[@]}"; do
  if ! printf '%s\n' "$cluster_regions" | grep -Fxq "$region"; then
    echo "Region '$region' is not present in the cluster topology. No changes were made." >&2
    echo "Available cluster regions:" >&2
    printf '%s\n' "$cluster_regions" | sed 's/^/  /' >&2
    exit 2
  fi
done

echo "Multi-region plan for database '$database_name':"
printf '  primary region: %s\n' "$primary_region"
printf '  database region: %s\n' "${regions[@]}"
echo "  survival goal: REGION FAILURE (adds cross-region write latency)"
if [[ "$global_reference_tables" == "true" ]]; then
  echo "  GLOBAL reference tables: scenarios, system_state"
else
  echo "  table locality: default REGIONAL BY TABLE in the primary region"
fi

if [[ "$apply_changes" != "true" ]]; then
  echo
  echo "Dry run only. This script never creates or resizes a cluster."
  echo "To apply after cost/topology review, set:"
  echo "  MULTI_REGION_APPLY=true"
  echo "  MULTI_REGION_CONFIRM=${database_name}:region-survival"
  exit 0
fi
if [[ "$confirmation" != "${database_name}:region-survival" ]]; then
  echo "Refusing to apply. Set MULTI_REGION_CONFIRM=${database_name}:region-survival exactly." >&2
  exit 2
fi
if [[ "$global_reference_tables" != "true" && "$global_reference_tables" != "false" ]]; then
  echo "COCKROACH_GLOBAL_REFERENCE_TABLES must be true or false." >&2
  exit 2
fi

quoted_database="\"$database_name\""
existing_primary=$(sql_values "SELECT primary_region FROM [SHOW DATABASES] WHERE database_name = '$database_name';")
case "$existing_primary" in
  ""|NULL|null)
    sql_exec "ALTER DATABASE $quoted_database PRIMARY REGION \"$primary_region\";"
    ;;
  "$primary_region")
    echo "Primary region '$primary_region' is already configured."
    ;;
  *)
    echo "Database primary region is '$existing_primary', not '$primary_region'." >&2
    echo "Refusing an automatic primary-region move; review traffic, locality, and failover impact manually." >&2
    exit 2
    ;;
esac

database_regions=$(sql_values "SELECT region FROM [SHOW REGIONS FROM DATABASE $quoted_database] ORDER BY region;")
for region in "${regions[@]}"; do
  if ! printf '%s\n' "$database_regions" | grep -Fxq "$region"; then
    sql_exec "ALTER DATABASE $quoted_database ADD REGION \"$region\";"
    database_regions=$(printf '%s\n%s\n' "$database_regions" "$region")
  fi
done
sql_exec "ALTER DATABASE $quoted_database SURVIVE REGION FAILURE;"

if [[ "$global_reference_tables" == "true" ]]; then
  sql_exec "ALTER TABLE IF EXISTS $quoted_database.public.scenarios SET LOCALITY GLOBAL;"
  sql_exec "ALTER TABLE IF EXISTS $quoted_database.public.system_state SET LOCALITY GLOBAL;"
fi

echo "Applied and verifying database topology:"
sql_exec "SHOW REGIONS FROM DATABASE $quoted_database;"
sql_exec "SHOW CREATE DATABASE $quoted_database;"
echo "Review CockroachDB jobs and measure write latency before calling this production-ready."
