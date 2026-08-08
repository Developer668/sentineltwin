-- Durable and idempotent satellite-image assessment records.

CREATE TABLE IF NOT EXISTS satellite_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    object_key STRING NULL UNIQUE,
    provider STRING NOT NULL,
    model_id STRING NULL,
    status STRING NOT NULL CHECK (status IN ('completed', 'failed')),
    fire_risk FLOAT8 NOT NULL CHECK (fire_risk BETWEEN 0 AND 1),
    earthquake_risk FLOAT8 NOT NULL CHECK (earthquake_risk BETWEEN 0 AND 1),
    combined_risk FLOAT8 NOT NULL CHECK (combined_risk BETWEEN 0 AND 1),
    confidence FLOAT8 NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    summary STRING NOT NULL,
    observations JSONB NOT NULL DEFAULT '[]'::JSONB,
    features JSONB NOT NULL DEFAULT '{}'::JSONB,
    source JSONB NOT NULL DEFAULT '{}'::JSONB,
    fallback_reason STRING NULL,
    request_id STRING NULL,
    usage JSONB NULL,
    learned_memory_id UUID NULL REFERENCES agent_memories(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS satellite_assessments_location_created_idx
    ON satellite_assessments (location_id, created_at DESC)
    STORING (provider, status, combined_risk, confidence);

-- General recall has no prefix predicate, while hazard-scoped recall uses the
-- prefixed index created by 001_initial.sql.
CREATE VECTOR INDEX IF NOT EXISTS agent_memories_embedding_idx ON agent_memories (embedding);

UPSERT INTO system_state (key, value, updated_at) VALUES
    ('schema', '{"version":3,"vector_dimensions":32,"spatial_srid":4326,"satellite_assessments":true}'::JSONB, now());
