#!/usr/bin/env bash
set -euo pipefail

cluster_name=${COCKROACH_CLUSTER:-sentineltwin}
region=${COCKROACH_REGION:-us-west-2}
plan=${COCKROACH_PLAN:-basic}
spend_limit=${COCKROACH_SPEND_LIMIT:-15}
database_name=${COCKROACH_DATABASE:-sentineltwin}

command -v ccloud >/dev/null 2>&1 || {
  echo "ccloud is required: https://www.cockroachlabs.com/docs/cockroachcloud/ccloud-get-started" >&2
  exit 1
}

case "$plan" in
  basic|standard) ;;
  *)
    echo "COCKROACH_PLAN must be basic or standard for this guarded demo provisioner." >&2
    echo "Create Advanced/multi-region clusters manually after reviewing cost and topology." >&2
    exit 2
    ;;
esac

echo "Checking ccloud authentication..."
ccloud cluster list >/dev/null

if ccloud cluster info "$cluster_name" >/dev/null 2>&1; then
  echo "Cluster '$cluster_name' already exists; leaving it unchanged."
else
  echo "Creating CockroachDB Cloud $plan cluster '$cluster_name' on AWS in $region."
  echo "Configured monthly spend limit: $spend_limit USD. Confirm account pricing in Cloud Console."
  ccloud cluster create "$plan" "$cluster_name" "$region" --cloud AWS --spend-limit "$spend_limit"
fi

if ccloud cluster database list "$cluster_name" 2>/dev/null | awk '{print $1}' | grep -Fxq "$database_name"; then
  echo "Database '$database_name' already exists."
else
  ccloud cluster database create "$cluster_name" "$database_name"
fi

if allowlist_output=$(ccloud cluster networking allowlist list "$cluster_name" 2>&1); then
  echo
  echo "Current CockroachDB Cloud network allowlist:"
  printf '%s\n' "$allowlist_output"
  if printf '%s\n' "$allowlist_output" | grep -Fq '0.0.0.0/0'; then
    echo "WARNING: 0.0.0.0/0 permits public SQL ingress and is demo-only." >&2
  fi
else
  echo "WARNING: ccloud could not inspect the cluster network allowlist:" >&2
  printf '%s\n' "$allowlist_output" >&2
fi

cat <<EOF

Cluster provisioning is complete. Credentials were intentionally not automated.

Next:
  1. Replace any 0.0.0.0/0 entry with approved administrator and application
     egress CIDRs, or use supported private connectivity. Do not guess a Lambda
     CIDR; this template does not provision static egress.
  2. Create an admin/bootstrap SQL user interactively:
       ccloud cluster user create $cluster_name sentinel_admin
  3. Inspect the TLS URL (it does not include a password):
       ccloud cluster sql --connection-url $cluster_name
  4. Form a URL for database '$database_name' with sslmode=verify-full, export DATABASE_URL,
     and run: make db-bootstrap

Do not commit or paste the resulting URL into frontend configuration.
EOF
