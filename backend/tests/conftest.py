from __future__ import annotations

import asyncio
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.constants import AppEnvironment
from app.db.base import Base
from app.db.session import create_engine_and_session_maker
from app.main import create_app
from app.models.security_event import SecurityEvent  # noqa: F401
from app.models.security_group import (  # noqa: F401
    SecurityGroup,
    SecurityGroupMembership,
    SecurityGroupPermission,
)
from app.models.security_permission import SecurityPermission  # noqa: F401
from app.models.security_role import SecurityRole, SecurityRolePermission  # noqa: F401
from app.models.user_extra_permission import UserExtraPermission  # noqa: F401


@pytest.fixture
def client(tmp_path: Path) -> Generator[TestClient, None, None]:
    database_path = tmp_path / "test.db"
    settings = Settings(
        app_env=AppEnvironment.DEVELOPMENT,
        database_url=f"sqlite+aiosqlite:///{database_path}",
        jwt_secret="test-secret",
        jwt_expire_minutes=720,
        cors_origins=[],
    )
    engine, _ = create_engine_and_session_maker(settings.database_url)

    async def prepare_database() -> None:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    asyncio.run(prepare_database())
    asyncio.run(engine.dispose())

    app = create_app(settings=settings)
    with TestClient(app) as test_client:
        yield test_client
