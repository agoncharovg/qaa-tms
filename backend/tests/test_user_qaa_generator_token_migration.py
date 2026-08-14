from __future__ import annotations

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from types import ModuleType

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

MIGRATION_FILE_NAME = "20260814_0006_user_qaa_generator_token.py"
USERS_TABLE_NAME = "users"
USER_ID_COLUMN_NAME = "id"
USERNAME_COLUMN_NAME = "username"
QAA_GENERATOR_TOKEN_COLUMN_NAME = "qaa_generator_token"
SQLITE_MEMORY_URL = "sqlite:///:memory:"
DEFAULT_STRING_LENGTH = 255


def load_migration_module() -> ModuleType:
    migration_path = (
        Path(__file__).resolve().parents[1] / "alembic" / "versions" / MIGRATION_FILE_NAME
    )
    spec = spec_from_file_location(MIGRATION_FILE_NAME, migration_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Failed to load the qaa-generator token migration module.")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def create_users_table(metadata: sa.MetaData) -> None:
    sa.Table(
        USERS_TABLE_NAME,
        metadata,
        sa.Column(USER_ID_COLUMN_NAME, sa.Integer, primary_key=True),
        sa.Column(
            USERNAME_COLUMN_NAME,
            sa.String(length=DEFAULT_STRING_LENGTH),
            nullable=False,
        ),
    )


def get_user_columns(connection: sa.Connection) -> dict[str, dict[str, object]]:
    return {
        column["name"]: column for column in sa.inspect(connection).get_columns(USERS_TABLE_NAME)
    }


def test_user_qaa_generator_token_migration_upgrades_and_downgrades(
    monkeypatch,
) -> None:
    migration_module = load_migration_module()
    engine = sa.create_engine(SQLITE_MEMORY_URL)
    metadata = sa.MetaData()
    create_users_table(metadata)

    with engine.begin() as connection:
        metadata.create_all(connection)
        operations = Operations(MigrationContext.configure(connection))
        monkeypatch.setattr(migration_module, "op", operations)

        assert QAA_GENERATOR_TOKEN_COLUMN_NAME not in get_user_columns(connection)

        migration_module.upgrade()

        upgraded_columns = get_user_columns(connection)
        assert QAA_GENERATOR_TOKEN_COLUMN_NAME in upgraded_columns
        assert upgraded_columns[QAA_GENERATOR_TOKEN_COLUMN_NAME]["nullable"] is True

        migration_module.downgrade()

        assert QAA_GENERATOR_TOKEN_COLUMN_NAME not in get_user_columns(connection)
