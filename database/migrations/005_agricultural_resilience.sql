-- Add the evidence-bound agricultural resilience scenario to every durable
-- hazard-bearing table. Existing fire/earthquake/multi-hazard rows remain valid.
-- CockroachDB Cloud can create/changefeed-optimize tables with schema_locked;
-- unlock only for this migration and restore the optimization afterward.

ALTER TABLE scenarios SET (schema_locked = false);
ALTER TABLE simulations SET (schema_locked = false);
ALTER TABLE agent_memories SET (schema_locked = false);

ALTER TABLE scenarios DROP CONSTRAINT IF EXISTS scenarios_hazard_check;
ALTER TABLE scenarios ADD CONSTRAINT scenarios_hazard_check
    CHECK (hazard IN ('fire', 'earthquake', 'multi_hazard', 'agricultural_resilience'));

ALTER TABLE simulations DROP CONSTRAINT IF EXISTS simulations_hazard_check;
ALTER TABLE simulations ADD CONSTRAINT simulations_hazard_check
    CHECK (hazard IN ('fire', 'earthquake', 'multi_hazard', 'agricultural_resilience'));

ALTER TABLE agent_memories DROP CONSTRAINT IF EXISTS agent_memories_hazard_check;
ALTER TABLE agent_memories ADD CONSTRAINT agent_memories_hazard_check
    CHECK (hazard IN ('fire', 'earthquake', 'multi_hazard', 'agricultural_resilience'));

ALTER TABLE scenarios SET (schema_locked = true);
ALTER TABLE simulations SET (schema_locked = true);
ALTER TABLE agent_memories SET (schema_locked = true);

UPSERT INTO system_state (key, value, updated_at) VALUES
    (
        'schema',
        '{"version":5,"vector_dimensions":32,"spatial_srid":4326,"satellite_assessments":true,"agricultural_resilience":true}'::JSONB,
        now()
    );
