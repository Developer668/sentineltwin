-- Canonical SentinelTwin schema entrypoint for CockroachDB's SQL shell.
-- Run from the repository root:
--   cockroach sql --url "$DATABASE_URL" --file database/schema.sql
\i database/migrations/001_initial.sql
\i database/migrations/002_seed.sql
\i database/migrations/003_satellite_assessments.sql
