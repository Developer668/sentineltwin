from __future__ import annotations

import os
import subprocess
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def test_cloud_bootstrap_omits_demo_fixtures_by_default():
    environment = {
        **os.environ,
        "DATABASE_URL": "postgresql://root@127.0.0.1:26257/sentineltwin?sslmode=disable",
        "PYTHON_BINARY": "/bin/echo",
        "MIGRATION_RUNNER": "database/migrate.py",
        "SENTINEL_APPLY_DEMO_FIXTURES": "false",
    }

    result = subprocess.run(
        ["bash", "scripts/bootstrap-db.sh"],
        cwd=REPOSITORY_ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "database/migrate.py --include-demo-fixtures" not in result.stdout


def test_demo_fixtures_require_explicit_bootstrap_opt_in():
    environment = {
        **os.environ,
        "DATABASE_URL": "postgresql://root@127.0.0.1:26257/sentineltwin?sslmode=disable",
        "PYTHON_BINARY": "/bin/echo",
        "MIGRATION_RUNNER": "database/migrate.py",
        "SENTINEL_APPLY_DEMO_FIXTURES": "true",
    }

    result = subprocess.run(
        ["bash", "scripts/bootstrap-db.sh"],
        cwd=REPOSITORY_ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "database/migrate.py --include-demo-fixtures" in result.stdout
