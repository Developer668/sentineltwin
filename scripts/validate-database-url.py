"""Validate a database URL received on stdin without exposing it in argv or logs."""

from __future__ import annotations

import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT / "backend"))

from sentineltwin.config import validate_database_url


def main() -> int:
    database_url = sys.stdin.read().strip()
    if not database_url:
        print("DATABASE_URL is required.", file=sys.stderr)
        return 2
    try:
        validate_database_url(database_url)
    except ValueError:
        print(
            "DATABASE_URL is invalid; remote connections must use one sslmode=verify-full parameter.",
            file=sys.stderr,
        )
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
