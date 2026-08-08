"""Deterministic local embeddings and long-term-memory helpers.

Production deployments may replace this with Bedrock embeddings. Keeping this
implementation deterministic makes the Lambda demo reproducible and allows the
same VECTOR queries to work without a model call.
"""

from __future__ import annotations

import hashlib
import math
import re
from collections.abc import Iterable

EMBEDDING_DIMENSIONS = 32
TOKEN_RE = re.compile(r"[a-z0-9]+")


def embed_text(text: str, dimensions: int = EMBEDDING_DIMENSIONS) -> list[float]:
    """Return a normalized signed feature-hash embedding."""
    vector = [0.0] * dimensions
    tokens = TOKEN_RE.findall(text.lower())
    if not tokens:
        return vector
    for token in tokens:
        digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
        bucket = int.from_bytes(digest[:4], "big") % dimensions
        sign = 1.0 if digest[4] & 1 else -1.0
        weight = 1.0 + min(len(token), 12) / 24.0
        vector[bucket] += sign * weight
    norm = math.sqrt(sum(value * value for value in vector)) or 1.0
    return [round(value / norm, 8) for value in vector]


def cosine_similarity(left: Iterable[float], right: Iterable[float]) -> float:
    a, b = list(left), list(right)
    dot = sum(x * y for x, y in zip(a, b))
    a_norm = math.sqrt(sum(x * x for x in a))
    b_norm = math.sqrt(sum(y * y for y in b))
    if not a_norm or not b_norm:
        return 0.0
    return dot / (a_norm * b_norm)


def vector_literal(values: Iterable[float]) -> str:
    """Encode a vector using CockroachDB/PostgreSQL vector input syntax."""
    return "[" + ",".join(f"{float(value):.8f}" for value in values) + "]"


def memory_learning_modifier(memories: list[dict]) -> tuple[float, list[str]]:
    """Convert retrieved outcomes into a bounded mitigation improvement.

    Useful past tactics reduce impact by at most 22%; poor outcomes never make a
    new plan worse, but remain visible to the planner for auditability.
    """
    if not memories:
        return 0.0, []
    weighted_gain = 0.0
    tactics: list[str] = []
    weight_total = 0.0
    for memory in memories:
        similarity = max(0.0, float(memory.get("similarity", 0.5)))
        confidence = max(0.0, min(1.0, float(memory.get("confidence", 0.7))))
        outcome = memory.get("outcome") or {}
        effectiveness = float(outcome.get("effectiveness", memory.get("importance", 0.5)))
        weight = max(0.05, similarity * confidence)
        weighted_gain += max(0.0, effectiveness) * weight
        weight_total += weight
        recommendation = (memory.get("metadata") or {}).get("recommended_tactic")
        if recommendation and recommendation not in tactics:
            tactics.append(str(recommendation))
    raw = weighted_gain / weight_total if weight_total else 0.0
    return min(0.22, round(raw * 0.18, 4)), tactics[:3]
