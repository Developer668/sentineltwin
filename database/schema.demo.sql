-- Explicitly synthetic, labeled demo schema. Never use for a production database.
-- Run from the repository root only when demo fixtures are intentionally required:
--   COCKROACH_URL="$DATABASE_URL" cockroach sql --file database/schema.demo.sql
\i database/migrations/001_initial.sql
\i database/migrations/002_seed.sql
\i database/migrations/003_satellite_assessments.sql
\i database/migrations/004_core_agents.sql
