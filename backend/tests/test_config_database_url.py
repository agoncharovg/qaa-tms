from __future__ import annotations

import pytest

from app.core.config import Settings


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("postgresql://u:p@h:5432/db", "postgresql+asyncpg://u:p@h:5432/db"),
        ("postgres://u:p@h/db", "postgresql+asyncpg://u:p@h/db"),
        ("postgresql+psycopg2://u:p@h/db", "postgresql+asyncpg://u:p@h/db"),
        ("postgresql://u:p@h/db?sslmode=require", "postgresql+asyncpg://u:p@h/db?ssl=true"),
        ("postgresql://u:p@h/db?sslmode=disable", "postgresql+asyncpg://u:p@h/db?ssl=false"),
        ("postgresql://u:p@localhost:5432/db", "postgresql+asyncpg://u:p@127.0.0.1:5432/db?ssl=false"),
        ("postgresql://u:p@127.0.0.1:5432/db", "postgresql+asyncpg://u:p@127.0.0.1:5432/db?ssl=false"),
        ("postgresql+asyncpg://u:p@h/db", "postgresql+asyncpg://u:p@h/db"),
        ("sqlite+aiosqlite:///./x.db", "sqlite+aiosqlite:///./x.db"),
    ],
)
def test_database_url_is_normalized(value: str, expected: str) -> None:
    settings = Settings(database_url=value, jwt_secret="x")

    assert settings.database_url == expected
