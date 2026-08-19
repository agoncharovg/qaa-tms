from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi.testclient import TestClient

import app.main as main_module
from app.core.config import Settings
from app.db.base import Base
from app.db.session import create_engine_and_session_maker
from app.services.qaa_generator_transport import resolve_qaa_generator_runtime

QAA_DIRECT_BASE_URL = "https://generator.example/api/v1"


def build_settings(database_path: Path) -> Settings:
    return Settings(
        database_url=f"sqlite+aiosqlite:///{database_path}",
        jwt_secret="test-secret",
        jwt_expire_minutes=720,
        cors_origins=[],
        qaa_generator_base_url=QAA_DIRECT_BASE_URL,
    )


def prepare_database(settings: Settings) -> None:
    engine, _ = create_engine_and_session_maker(settings.database_url)

    async def create_tables() -> None:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    asyncio.run(create_tables())
    asyncio.run(engine.dispose())


def test_resolve_qaa_generator_runtime_uses_configured_base_url(tmp_path: Path) -> None:
    settings = build_settings(tmp_path / "runtime.db")

    runtime = resolve_qaa_generator_runtime(settings)

    assert runtime.base_url == QAA_DIRECT_BASE_URL


def test_create_app_uses_configured_qaa_generator_base_url(tmp_path: Path) -> None:
    settings = build_settings(tmp_path / "app.db")
    prepare_database(settings)

    with TestClient(main_module.create_app(settings=settings)) as client:
        base_url = str(client.app.state.qaa_generator_client.base_url).rstrip("/")
        assert base_url == QAA_DIRECT_BASE_URL
