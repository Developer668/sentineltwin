from pathlib import Path

from database.migrate import migration_paths, split_migration_statements

MIGRATIONS = Path(__file__).resolve().parents[2] / "database" / "migrations"
DATABASE_DIRECTORY = MIGRATIONS.parent


def test_production_migration_selection_excludes_demo_fixtures():
    selected = migration_paths(MIGRATIONS, through=999, include_demo_fixtures=False)

    assert [path.name for path in selected] == [
        "001_initial.sql",
        "003_satellite_assessments.sql",
        "004_core_agents.sql",
        "005_agricultural_resilience.sql",
    ]


def test_demo_migration_selection_requires_explicit_opt_in():
    selected = migration_paths(MIGRATIONS, through=999, include_demo_fixtures=True)

    assert [path.name for path in selected] == [
        "001_initial.sql",
        "002_seed.sql",
        "003_satellite_assessments.sql",
        "004_core_agents.sql",
        "005_agricultural_resilience.sql",
    ]


def test_default_sql_shell_schema_excludes_demo_seed():
    production_schema = (DATABASE_DIRECTORY / "schema.sql").read_text(encoding="utf-8")

    assert "002_seed.sql" not in production_schema
    assert "004_core_agents.sql" in production_schema
    assert "005_agricultural_resilience.sql" in production_schema


def test_demo_sql_shell_schema_is_explicitly_named_and_complete():
    demo_schema = (DATABASE_DIRECTORY / "schema.demo.sql").read_text(encoding="utf-8")

    assert "002_seed.sql" in demo_schema
    assert "004_core_agents.sql" in demo_schema
    assert "005_agricultural_resilience.sql" in demo_schema


def test_agricultural_migration_temporarily_unlocks_schema_locked_tables():
    migration = (MIGRATIONS / "005_agricultural_resilience.sql").read_text(encoding="utf-8")

    for table in ("scenarios", "simulations", "agent_memories"):
        unlock = f"ALTER TABLE {table} SET (schema_locked = false);"
        relock = f"ALTER TABLE {table} SET (schema_locked = true);"
        assert unlock in migration
        assert relock in migration
        assert migration.index(unlock) < migration.index(relock)


def test_migration_runner_executes_schema_lock_changes_as_standalone_statements():
    migration = (MIGRATIONS / "005_agricultural_resilience.sql").read_text(encoding="utf-8")
    statements = split_migration_statements(migration)

    assert len(statements) == 13
    assert statements[0].endswith("ALTER TABLE scenarios SET (schema_locked = false)")
    assert statements[9].endswith("ALTER TABLE scenarios SET (schema_locked = true)")
    lock_statements = [statement for statement in statements if "SET (schema_locked" in statement]
    assert len(lock_statements) == 6
    assert all(statement.count("ALTER TABLE") == 1 for statement in lock_statements)
