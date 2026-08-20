from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.constants import HealthFieldName, HealthStatus
from app.db.base import Base
from app.db.session import create_engine_and_session_maker
from app.main import create_app


def prepare_database(settings: Settings) -> None:
    engine, _ = create_engine_and_session_maker(settings.database_url)

    async def create_tables() -> None:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    asyncio.run(create_tables())
    asyncio.run(engine.dispose())


def build_client(tmp_path: Path, static_dir: Path) -> TestClient:
    database_path = tmp_path / "test.db"
    settings = Settings(
        database_url=f"sqlite+aiosqlite:///{database_path}",
        jwt_secret="test-secret",
        jwt_expire_minutes=720,
        cors_origins=[],
        static_dir=str(static_dir),
    )
    prepare_database(settings)
    return TestClient(create_app(settings=settings))


def test_create_app_serves_static_assets_and_spa_routes(tmp_path: Path) -> None:
    static_dir = tmp_path / "static"
    assets_dir = static_dir / "assets"
    assets_dir.mkdir(parents=True)
    index_content = "<!doctype html><html><body>QAA TMS</body></html>"
    asset_content = "console.log('qaa');"
    file_content = "<svg />"
    (static_dir / "index.html").write_text(index_content, encoding="utf-8")
    (static_dir / "favicon.svg").write_text(file_content, encoding="utf-8")
    (assets_dir / "app.js").write_text(asset_content, encoding="utf-8")

    with build_client(tmp_path, static_dir) as client:
        home_response = client.get("/")
        asset_response = client.get("/assets/app.js")
        file_response = client.get("/favicon.svg")
        route_response = client.get("/plugins/jenkins")
        api_response = client.get("/api/does-not-exist")
        health_response = client.get("/health")
        ready_response = client.get("/ready")

    assert home_response.status_code == 200
    assert home_response.text == index_content
    assert asset_response.status_code == 200
    assert asset_response.text == asset_content
    assert file_response.status_code == 200
    assert file_response.text == file_content
    assert route_response.status_code == 200
    assert route_response.text == index_content
    assert api_response.status_code == 404
    assert api_response.json() == {"detail": "Not Found"}
    assert health_response.status_code == 200
    assert health_response.json() == {HealthFieldName.STATUS.value: HealthStatus.OK.value}
    assert ready_response.status_code == 200
    assert ready_response.json() == {HealthFieldName.STATUS.value: HealthStatus.READY.value}
