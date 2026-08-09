-- Canonical application identities required by foreign keys and runtime writes.
-- These rows are product configuration, not observations, incidents, or demo data.

INSERT INTO agents (id, name, role, capability, status, region, configuration)
VALUES
    ('agent-risk', 'Risk Assessor', 'risk_assessor', 'satellite feature extraction', 'ready', 'us-west-2',
     '{"source":"product_configuration","synthetic_data":false}'::JSONB),
    ('agent-retriever', 'Similarity Retriever', 'memory_retriever', 'vector + spatial recall', 'ready', 'us-west-2',
     '{"source":"product_configuration","synthetic_data":false}'::JSONB),
    ('agent-simulator', 'Scenario Simulator', 'simulator', 'fire and earthquake modeling', 'ready', 'us-west-2',
     '{"source":"product_configuration","synthetic_data":false}'::JSONB),
    ('agent-planner', 'Resource Planner', 'resource_planner', 'crew and shelter positioning', 'ready', 'us-west-2',
     '{"source":"product_configuration","synthetic_data":false}'::JSONB),
    ('agent-commander', 'Incident Commander', 'commander', 'coordination and after-action learning', 'ready', 'us-west-2',
     '{"source":"product_configuration","synthetic_data":false}'::JSONB)
ON CONFLICT (id) DO NOTHING;

-- Keep application routing state honest for a single-region Basic cluster.
UPSERT INTO system_state (key, value, updated_at)
VALUES (
    'routing',
    '{"active_region":"us-west-2","failover_count":0,"scope":"application-routing-label"}'::JSONB,
    now()
);

UPSERT INTO system_state (key, value, updated_at)
VALUES (
    'schema',
    '{"version":4,"vector_dimensions":32,"spatial_srid":4326,"satellite_assessments":true,"demo_fixtures":false}'::JSONB,
    now()
);
