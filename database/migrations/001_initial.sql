-- SentinelTwin persistent agent memory for CockroachDB 25.4+
-- Run with: cockroach sql --url "$DATABASE_URL" --file database/migrations/001_initial.sql

CREATE TABLE IF NOT EXISTS locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name STRING NOT NULL,
    region STRING NOT NULL,
    coordinates GEOGRAPHY(POINT, 4326) NOT NULL,
    terrain STRING NOT NULL DEFAULT 'unknown terrain',
    vegetation_density FLOAT8 NOT NULL DEFAULT 0.5 CHECK (vegetation_density BETWEEN 0 AND 1),
    soil_amplification FLOAT8 NOT NULL DEFAULT 1.0 CHECK (soil_amplification BETWEEN 0.5 AND 2.5),
    moisture_percent FLOAT8 NOT NULL DEFAULT 30 CHECK (moisture_percent BETWEEN 0 AND 100),
    wind_speed_mph FLOAT8 NOT NULL DEFAULT 10 CHECK (wind_speed_mph >= 0),
    slope_degrees FLOAT8 NOT NULL DEFAULT 5 CHECK (slope_degrees BETWEEN 0 AND 90),
    population INT8 NOT NULL DEFAULT 0 CHECK (population >= 0),
    critical_facilities INT4 NOT NULL DEFAULT 0 CHECK (critical_facilities >= 0),
    fire_risk FLOAT8 NOT NULL DEFAULT 0.5 CHECK (fire_risk BETWEEN 0 AND 1),
    earthquake_risk FLOAT8 NOT NULL DEFAULT 0.5 CHECK (earthquake_risk BETWEEN 0 AND 1),
    combined_risk FLOAT8 NOT NULL DEFAULT 0.5 CHECK (combined_risk BETWEEN 0 AND 1),
    risk_trend STRING NOT NULL DEFAULT 'stable' CHECK (risk_trend IN ('rising', 'stable', 'falling')),
    status STRING NOT NULL DEFAULT 'guarded' CHECK (status IN ('critical', 'high', 'guarded', 'low')),
    satellite_source STRING NOT NULL DEFAULT 'manual input',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INVERTED INDEX IF NOT EXISTS locations_coordinates_idx ON locations (coordinates);
CREATE INDEX IF NOT EXISTS locations_risk_idx ON locations (status, combined_risk DESC) STORING (name, region, fire_risk, earthquake_risk);

CREATE TABLE IF NOT EXISTS agents (
    id STRING PRIMARY KEY,
    name STRING NOT NULL,
    role STRING NOT NULL,
    capability STRING NOT NULL,
    status STRING NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'analyzing', 'monitoring', 'offline', 'degraded')),
    region STRING NOT NULL DEFAULT 'us-west-2',
    configuration JSONB NOT NULL DEFAULT '{}'::JSONB,
    last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    memory_reads INT8 NOT NULL DEFAULT 0,
    memory_writes INT8 NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scenarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name STRING NOT NULL,
    hazard STRING NOT NULL CHECK (hazard IN ('fire', 'earthquake', 'multi_hazard')),
    description STRING NOT NULL,
    parameters JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_by STRING NULL REFERENCES agents(id) ON DELETE SET NULL,
    is_template BOOL NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS simulations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scenario_id UUID NULL REFERENCES scenarios(id) ON DELETE SET NULL,
    location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    hazard STRING NOT NULL CHECK (hazard IN ('fire', 'earthquake', 'multi_hazard')),
    status STRING NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    random_seed INT8 NOT NULL,
    parameters JSONB NOT NULL DEFAULT '{}'::JSONB,
    outcome JSONB NOT NULL DEFAULT '{}'::JSONB,
    timeline JSONB NOT NULL DEFAULT '[]'::JSONB,
    recommendations JSONB NOT NULL DEFAULT '[]'::JSONB,
    memory_context JSONB NOT NULL DEFAULT '{}'::JSONB,
    agent_trace JSONB NOT NULL DEFAULT '[]'::JSONB,
    agent_plan JSONB NOT NULL DEFAULT '{}'::JSONB,
    artifact JSONB NOT NULL DEFAULT '{}'::JSONB,
    started_at TIMESTAMPTZ NULL,
    completed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS simulations_location_created_idx ON simulations (location_id, created_at DESC);
CREATE INDEX IF NOT EXISTS simulations_hazard_created_idx ON simulations (hazard, created_at DESC) STORING (status, outcome);

CREATE TABLE IF NOT EXISTS agent_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id UUID NULL REFERENCES locations(id) ON DELETE SET NULL,
    simulation_id UUID NULL REFERENCES simulations(id) ON DELETE SET NULL,
    agent_id STRING NULL REFERENCES agents(id) ON DELETE SET NULL,
    memory_type STRING NOT NULL CHECK (memory_type IN ('episode', 'observation', 'simulation_outcome', 'after_action', 'tactic')),
    hazard STRING NOT NULL CHECK (hazard IN ('fire', 'earthquake', 'multi_hazard')),
    region STRING NOT NULL DEFAULT 'global',
    title STRING NOT NULL,
    content STRING NOT NULL,
    importance FLOAT8 NOT NULL DEFAULT 0.5 CHECK (importance BETWEEN 0 AND 1),
    confidence FLOAT8 NOT NULL DEFAULT 0.7 CHECK (confidence BETWEEN 0 AND 1),
    outcome JSONB NOT NULL DEFAULT '{}'::JSONB,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    embedding VECTOR(32) NOT NULL,
    access_count INT8 NOT NULL DEFAULT 0,
    last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_memories_location_idx ON agent_memories (location_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_memories_agent_idx ON agent_memories (agent_id, created_at DESC);
-- Real CockroachDB distributed vector indexes. Prefix columns allow the retriever
-- to prune by hazard or deployment region before approximate nearest-neighbor search.
CREATE VECTOR INDEX IF NOT EXISTS agent_memories_hazard_embedding_idx ON agent_memories (hazard, embedding);
CREATE VECTOR INDEX IF NOT EXISTS agent_memories_region_embedding_idx ON agent_memories (region, embedding);

CREATE TABLE IF NOT EXISTS audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type STRING NOT NULL,
    resource_type STRING NOT NULL,
    resource_id STRING NOT NULL,
    actor_id STRING NOT NULL,
    region STRING NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_resource_idx ON audit_events (resource_type, resource_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_type_idx ON audit_events (event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS system_state (
    key STRING PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

UPSERT INTO system_state (key, value) VALUES
    ('routing', '{"active_region":"us-west-2","failover_count":0,"regions":[{"name":"us-west-2","role":"gateway","status":"healthy"},{"name":"us-east-1","role":"standby","status":"healthy"}]}'::JSONB),
    ('schema', '{"version":1,"vector_dimensions":32,"spatial_srid":4326}'::JSONB);
