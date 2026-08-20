from __future__ import annotations

import asyncio
import hashlib
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.constants import AGENT_MIN_SUPPORTED_VERSION
from app.db.base import Base
from app.db.session import create_engine_and_session_maker
from app.main import create_app

DOWNLOAD_PATH = "/api/v1/agent/download"
MANIFEST_PATH = "/api/v1/agent/manifest"


def prepare_database(settings: Settings) -> None:
    engine, _ = create_engine_and_session_maker(settings.database_url)

    async def create_tables() -> None:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    asyncio.run(create_tables())
    asyncio.run(engine.dispose())


def build_client(tmp_path: Path, agent_dist_dir: Path) -> TestClient:
    database_path = tmp_path / "test.db"
    settings = Settings(
        database_url=f"sqlite+aiosqlite:///{database_path}",
        jwt_secret="test-secret",
        jwt_expire_minutes=720,
        cors_origins=[],
        agent_dist_dir=str(agent_dist_dir),
    )
    prepare_database(settings)
    return TestClient(create_app(settings=settings))


def write_agent_dist(agent_dist_dir: Path, *, tarball_bytes: bytes, version: str) -> None:
    agent_dist_dir.mkdir(parents=True, exist_ok=True)
    tarball_path = agent_dist_dir / "qaa-tms-agent-src.tar.gz"
    tarball_path.write_bytes(tarball_bytes)
    (agent_dist_dir / "qaa-tms-agent-src.tar.gz.sha256").write_text(
        f"{hashlib.sha256(tarball_bytes).hexdigest()}  qaa-tms-agent-src.tar.gz\n",
        encoding="utf-8",
    )
    (agent_dist_dir / "agent-pyproject.toml").write_text(
        "\n".join(
            [
                "[project]",
                'name = "qaa-tms-agent"',
                f'version = "{version}"',
            ]
        )
        + "\n",
        encoding="utf-8",
    )


def test_agent_manifest_returns_bundle_metadata(tmp_path: Path) -> None:
    agent_dist_dir = tmp_path / "agent-dist"
    tarball_bytes = b"fake-agent-archive"
    write_agent_dist(agent_dist_dir, tarball_bytes=tarball_bytes, version="0.2.0")

    with build_client(tmp_path, agent_dist_dir) as client:
        manifest_response = client.get(MANIFEST_PATH)
        download_response = client.get(DOWNLOAD_PATH)

    assert manifest_response.status_code == 200
    assert manifest_response.json() == {
        "version": "0.2.0",
        "minSupported": AGENT_MIN_SUPPORTED_VERSION,
        "downloadUrl": DOWNLOAD_PATH,
        "sha256": hashlib.sha256(tarball_bytes).hexdigest(),
        "os": None,
    }
    assert download_response.status_code == 200
    assert download_response.headers["content-type"] == "application/gzip"
    assert download_response.content == tarball_bytes


def test_agent_manifest_returns_503_when_bundle_is_missing(tmp_path: Path) -> None:
    agent_dist_dir = tmp_path / "missing-dist"

    with build_client(tmp_path, agent_dist_dir) as client:
        response = client.get(MANIFEST_PATH)

    assert response.status_code == 503
    assert response.json() == {"detail": "The bundled companion source artifact is not available."}


def test_agent_download_returns_404_when_bundle_is_missing(tmp_path: Path) -> None:
    agent_dist_dir = tmp_path / "missing-dist"

    with build_client(tmp_path, agent_dist_dir) as client:
        response = client.get(DOWNLOAD_PATH)

    assert response.status_code == 404
    assert response.json() == {"detail": "The bundled companion source artifact is not available."}
