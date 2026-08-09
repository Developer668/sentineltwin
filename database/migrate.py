"""Small ordered migration runner for CockroachDB."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT / "backend"))

from sentineltwin.config import validate_database_url


def migration_paths(directory: Path, *, through: int, include_demo_fixtures: bool) -> list[Path]:
    """Return ordered migrations, excluding synthetic fixtures for production by default."""
    return [
        path
        for path in sorted(directory.glob("*.sql"))
        if int(path.name.split("_", 1)[0]) <= through
        and (include_demo_fixtures or path.name != "002_seed.sql")
    ]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--through", type=int, default=999, help="highest migration number to apply")
    parser.add_argument(
        "--include-demo-fixtures",
        action="store_true",
        help="apply the explicitly synthetic 002_seed.sql demo dataset",
    )
    args = parser.parse_args()
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        parser.error("DATABASE_URL is required")
    try:
        validate_database_url(database_url)
    except ValueError as exc:
        parser.error(str(exc))
    try:
        import psycopg
    except ImportError as exc:
        raise SystemExit("Install backend/requirements.txt first") from exc

    directory = Path(__file__).parent / "migrations"
    migrations = migration_paths(
        directory,
        through=args.through,
        include_demo_fixtures=args.include_demo_fixtures,
    )
    with psycopg.connect(database_url, autocommit=True) as connection:
        connection.execute(
            """CREATE TABLE IF NOT EXISTS sentineltwin_schema_migrations (
                   version INT8 PRIMARY KEY,
                   filename STRING NOT NULL,
                   applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
               )"""
        )
        applied = {row[0] for row in connection.execute("SELECT version FROM sentineltwin_schema_migrations")}
        count = 0
        for path in migrations:
            version = int(path.name.split("_", 1)[0])
            if version in applied:
                print(f"Skipping {path.name} (already applied)")
                continue
            print(f"Applying {path.name}")
            connection.execute(path.read_text(encoding="utf-8"))
            connection.execute(
                "INSERT INTO sentineltwin_schema_migrations (version, filename) VALUES (%s, %s)",
                (version, path.name),
            )
            count += 1
    print(f"Applied {count} migration(s)")


if __name__ == "__main__":
    main()
