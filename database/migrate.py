"""Small ordered migration runner for CockroachDB."""

from __future__ import annotations

import argparse
import os
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=os.getenv("DATABASE_URL"), help="CockroachDB connection URL")
    parser.add_argument("--through", type=int, default=999, help="highest migration number to apply")
    args = parser.parse_args()
    if not args.url:
        parser.error("--url or DATABASE_URL is required")
    try:
        import psycopg
    except ImportError as exc:
        raise SystemExit("Install backend/requirements.txt first") from exc

    directory = Path(__file__).parent / "migrations"
    migrations = [path for path in sorted(directory.glob("*.sql")) if int(path.name.split("_", 1)[0]) <= args.through]
    with psycopg.connect(args.url, autocommit=True) as connection:
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
