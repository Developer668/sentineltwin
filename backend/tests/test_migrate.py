from pathlib import Path

from database.migrate import migration_paths

MIGRATIONS = Path(__file__).resolve().parents[2] / "database" / "migrations"
DATABASE_DIRECTORY = MIGRATIONS.parent


def test_production_migration_selection_excludes_demo_fixtures():
    selected = migration_paths(MIGRATIONS, through=999, include_demo_fixtures=False)

    assert [path.name for path in selected] == [
        "001_initial.sql",
        "003_satellite_assessments.sql",
        "004_core_agents.sql",
    ]


def test_demo_migration_selection_requires_explicit_opt_in():
    selected = migration_paths(MIGRATIONS, through=999, include_demo_fixtures=True)

    assert [path.name for path in selected] == [
        "001_initial.sql",
        "002_seed.sql",
        "003_satellite_assessments.sql",
        "004_core_agents.sql",
    ]


def test_default_sql_shell_schema_excludes_demo_seed():
    production_schema = (DATABASE_DIRECTORY / "schema.sql").read_text(encoding="utf-8")

    assert "002_seed.sql" not in production_schema
    assert "004_core_agents.sql" in production_schema


def test_demo_sql_shell_schema_is_explicitly_named_and_complete():
    demo_schema = (DATABASE_DIRECTORY / "schema.demo.sql").read_text(encoding="utf-8")

    assert "002_seed.sql" in demo_schema
    assert "004_core_agents.sql" in demo_schema
