from sentineltwin.memory import (
    EMBEDDING_DIMENSIONS,
    cosine_similarity,
    embed_text,
    memory_learning_modifier,
)


def test_embedding_is_deterministic_and_normalized():
    first = embed_text("wildfire steep canyon Santa Ana wind")
    second = embed_text("wildfire steep canyon Santa Ana wind")
    assert first == second
    assert len(first) == EMBEDDING_DIMENSIONS
    assert 0.999 < sum(value * value for value in first) ** 0.5 < 1.001
    assert cosine_similarity(first, second) > 0.999


def test_learning_modifier_is_bounded_and_extracts_tactics():
    memories = [
        {
            "similarity": 0.94,
            "confidence": 0.9,
            "importance": 0.8,
            "outcome": {"effectiveness": 0.91},
            "metadata": {"recommended_tactic": "Stage engines early"},
        }
    ]
    modifier, tactics = memory_learning_modifier(memories)
    assert 0 < modifier <= 0.22
    assert tactics == ["Stage engines early"]
