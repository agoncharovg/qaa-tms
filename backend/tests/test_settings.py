from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient
from test_users import auth_header, login

from app.core import env_file
from app.core.config import get_settings


def write_backend_env(path: Path) -> None:
    path.write_text(
        "\n".join(
            [
                "QAA_GENERATOR_BASE_URL=https://initial.example/api/v1",
                "QAA_GENERATOR_SUPERUSER_TOKEN=super-token",
                "",
            ]
        ),
        encoding="utf-8",
    )


def test_server_settings_are_admin_only(client: TestClient, tmp_path: Path, monkeypatch) -> None:
    env_path = tmp_path / ".env"
    write_backend_env(env_path)
    monkeypatch.setattr(env_file, "BACKEND_ENV_FILE", env_path)
    get_settings.cache_clear()

    admin_token, _ = login(client, "admin", "admin")
    user_token, _ = login(client, "test", "")

    non_admin_get = client.get("/api/v1/settings", headers=auth_header(user_token))
    non_admin_put = client.put(
        "/api/v1/settings",
        headers=auth_header(user_token),
        json={"qaa_generator_base_url": "https://blocked.example/api/v1"},
    )
    admin_get = client.get("/api/v1/settings", headers=auth_header(admin_token))

    assert non_admin_get.status_code == 403
    assert non_admin_put.status_code == 403
    assert admin_get.status_code == 200
    assert admin_get.json()["qaa_generator_superuser_token_set"] is True
    assert "qaa_generator_superuser_token" not in admin_get.json()


def test_put_server_settings_masks_superuser_token_and_refreshes_runtime(
    client: TestClient,
    tmp_path: Path,
    monkeypatch,
) -> None:
    env_path = tmp_path / ".env"
    write_backend_env(env_path)
    monkeypatch.setattr(env_file, "BACKEND_ENV_FILE", env_path)
    get_settings.cache_clear()

    admin_token, _ = login(client, "admin", "admin")

    response = client.put(
        "/api/v1/settings",
        headers=auth_header(admin_token),
        json={
            "qaa_generator_base_url": "https://updated.example/api/v1",
            "qaa_generator_superuser_token": "updated-super",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["qaa_generator_base_url"] == "https://updated.example/api/v1"
    assert body["qaa_generator_superuser_token_set"] is True

    runtime_settings = client.app.state.settings
    assert runtime_settings.qaa_generator_base_url == "https://updated.example/api/v1"
    assert runtime_settings.qaa_generator_superuser_token == "updated-super"

    serialized_env = env_path.read_text(encoding="utf-8")
    assert "QAA_GENERATOR_BASE_URL=https://updated.example/api/v1\n" in serialized_env
    assert "QAA_GENERATOR_SUPERUSER_TOKEN=updated-super\n" in serialized_env

    read_back = client.get("/api/v1/settings", headers=auth_header(admin_token))
    assert read_back.status_code == 200
    assert read_back.json()["qaa_generator_superuser_token_set"] is True
