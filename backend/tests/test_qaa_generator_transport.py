from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app.main as main_module
from app.core.config import Settings
from app.db.base import Base
from app.db.session import create_engine_and_session_maker
from app.services.qaa_generator_transport import (
    QaaGeneratorPortForwardSettings,
    QaaGeneratorTransportError,
    build_port_forward_base_url,
    resolve_qaa_generator_runtime,
)

QAA_DIRECT_BASE_URL = "http://generator.example/api/v1"
QAA_PORT_FORWARD_LOCAL_PORT = 19090
QAA_PORT_FORWARD_REMOTE_PORT = 8088
QAA_PORT_FORWARD_NAMESPACE = "aut"
QAA_PORT_FORWARD_RESOURCE = "svc/custom-generator"


class FakePortForwardProcess:
    enter_count = 0
    exit_count = 0

    def __init__(
        self,
        settings: QaaGeneratorPortForwardSettings,
        *,
        timeout_seconds: float,
    ) -> None:
        self.settings = settings
        self.timeout_seconds = timeout_seconds

    def __enter__(self) -> FakePortForwardProcess:
        type(self).enter_count += 1
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        type(self).exit_count += 1


class BrokenPortForwardProcess:
    def __init__(
        self,
        settings: QaaGeneratorPortForwardSettings,
        *,
        timeout_seconds: float,
    ) -> None:
        self.settings = settings
        self.timeout_seconds = timeout_seconds

    def __enter__(self) -> BrokenPortForwardProcess:
        raise QaaGeneratorTransportError("port-forward failed")

    def __exit__(self, exc_type, exc, tb) -> None:
        return None


def build_settings(database_path: Path, *, port_forward_enabled: bool) -> Settings:
    return Settings(
        database_url=f"sqlite+aiosqlite:///{database_path}",
        jwt_secret="test-secret",
        jwt_expire_minutes=720,
        cors_origins=[],
        qaa_generator_base_url=QAA_DIRECT_BASE_URL,
        qaa_generator_port_forward_enabled=port_forward_enabled,
        qaa_generator_port_forward_namespace=QAA_PORT_FORWARD_NAMESPACE,
        qaa_generator_port_forward_resource=QAA_PORT_FORWARD_RESOURCE,
        qaa_generator_port_forward_local_port=QAA_PORT_FORWARD_LOCAL_PORT,
        qaa_generator_port_forward_remote_port=QAA_PORT_FORWARD_REMOTE_PORT,
    )


def prepare_database(settings: Settings) -> None:
    engine, _ = create_engine_and_session_maker(settings.database_url)

    async def create_tables() -> None:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    asyncio.run(create_tables())
    asyncio.run(engine.dispose())


def test_resolve_qaa_generator_runtime_uses_direct_base_url_when_port_forward_disabled(
    tmp_path: Path,
) -> None:
    settings = build_settings(tmp_path / "disabled.db", port_forward_enabled=False)

    runtime = resolve_qaa_generator_runtime(settings)

    assert runtime.base_url == QAA_DIRECT_BASE_URL
    assert runtime.port_forward is None


def test_resolve_qaa_generator_runtime_uses_loopback_url_when_port_forward_enabled(
    tmp_path: Path,
) -> None:
    settings = build_settings(tmp_path / "enabled.db", port_forward_enabled=True)

    runtime = resolve_qaa_generator_runtime(settings)

    assert runtime.base_url == build_port_forward_base_url(QAA_PORT_FORWARD_LOCAL_PORT)
    assert runtime.port_forward == QaaGeneratorPortForwardSettings(
        namespace=QAA_PORT_FORWARD_NAMESPACE,
        resource=QAA_PORT_FORWARD_RESOURCE,
        local_port=QAA_PORT_FORWARD_LOCAL_PORT,
        remote_port=QAA_PORT_FORWARD_REMOTE_PORT,
    )


def test_create_app_uses_port_forward_runtime_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    FakePortForwardProcess.enter_count = 0
    FakePortForwardProcess.exit_count = 0
    monkeypatch.setattr(main_module, "QaaGeneratorPortForwardProcess", FakePortForwardProcess)
    settings = build_settings(tmp_path / "runtime.db", port_forward_enabled=True)
    prepare_database(settings)

    with TestClient(main_module.create_app(settings=settings)) as client:
        base_url = str(client.app.state.qaa_generator_client.base_url).rstrip("/")
        assert base_url == build_port_forward_base_url(QAA_PORT_FORWARD_LOCAL_PORT)

    assert FakePortForwardProcess.enter_count == 1
    assert FakePortForwardProcess.exit_count == 1


def test_create_app_falls_back_to_direct_base_url_when_port_forward_setup_fails(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(main_module, "QaaGeneratorPortForwardProcess", BrokenPortForwardProcess)
    settings = build_settings(tmp_path / "fallback.db", port_forward_enabled=True)
    prepare_database(settings)

    with TestClient(main_module.create_app(settings=settings)) as client:
        base_url = str(client.app.state.qaa_generator_client.base_url).rstrip("/")
        assert base_url == QAA_DIRECT_BASE_URL
