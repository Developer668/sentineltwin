-- Production-safe SentinelTwin schema entrypoint for CockroachDB's SQL shell.
-- Run from the repository root:
--   COCKROACH_URL="$DATABASE_URL" cockroach sql --file database/schema.sql
\i database/migrations/001_initial.sql
\i database/migrations/003_satellite_assessments.sql
\i database/migrations/004_core_agents.sql
\i database/migrations/005_agricultural_resilience.sql
