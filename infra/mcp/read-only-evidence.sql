SHOW TABLES;

SHOW INDEXES FROM agent_memories;

SELECT hazard, memory_type, count(*) AS row_count
FROM agent_memories
GROUP BY hazard, memory_type
ORDER BY hazard, memory_type;

SELECT id::STRING AS memory_id, hazard, memory_type, importance, confidence,
       access_count, created_at
FROM agent_memories
ORDER BY created_at DESC
LIMIT 10;

SELECT id::STRING AS simulation_id, hazard, status,
       memory_context->>'learned_memory_id' AS learned_memory_id, created_at
FROM simulations
ORDER BY created_at DESC
LIMIT 10;

SELECT id::STRING AS assessment_id, provider, status, confidence, created_at
FROM satellite_assessments
ORDER BY created_at DESC
LIMIT 10;
