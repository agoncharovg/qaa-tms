from __future__ import annotations

import pytest

from app.core.config import Settings
from app.core.constants import DEFAULT_JWT_EXPIRE_MINUTES, EnvKey


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (
            "http://localhost:3000,http://127.0.0.1:3000",
            ["http://localhost:3000", "http://127.0.0.1:3000"],
        ),
        (
            '["http://localhost:3000", "http://127.0.0.1:3000"]',
            ["http://localhost:3000", "http://127.0.0.1:3000"],
        ),
    ],
)
def test_cors_origins_loads_from_env(
    monkeypatch: pytest.MonkeyPatch,
    value: str,
    expected: list[str],
) -> None:
    monkeypatch.setenv(EnvKey.CORS_ORIGINS.value, value)

    settings = Settings()

    assert settings.cors_origins == expected


def test_jwt_expiry_defaults_to_disabled() -> None:
    settings = Settings(_env_file=None, jwt_secret="test-secret")

    assert settings.jwt_expire_minutes == DEFAULT_JWT_EXPIRE_MINUTES
    assert settings.jwt_expire_minutes == 0


def test_qaa_generator_base_url_loads_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(
        EnvKey.QAA_GENERATOR_BASE_URL.value,
        "https://qaa-generator-prod.i.gc.onl/api/v1",
    )

    settings = Settings()

    assert settings.qaa_generator_base_url == "https://qaa-generator-prod.i.gc.onl/api/v1"


def test_jenkins_common_settings_load_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(EnvKey.JENKINS_COMMON_URL.value, "https://jenkins.example/")
    monkeypatch.setenv(EnvKey.JENKINS_COMMON_USERNAME.value, "common-user")
    monkeypatch.setenv(EnvKey.JENKINS_COMMON_TOKEN.value, "common-token")
    monkeypatch.setenv(
        EnvKey.JENKINS_ROOT_GROUPS.value,
        "BE=job/.QAA/job/E2E,FE=job/.QAA/job/UI_E2E",
    )
    monkeypatch.setenv(EnvKey.JENKINS_ROOT_FOLDERS.value, "PREPROD,PROD")

    settings = Settings()

    assert settings.jenkins_common_url == "https://jenkins.example"
    assert settings.jenkins_common_username == "common-user"
    assert settings.jenkins_common_token == "common-token"
    assert settings.jenkins_common_configured is True
    assert [group.model_dump() for group in settings.jenkins_root_groups] == [
        {"label": "BE", "path": "job/.QAA/job/E2E"},
        {"label": "FE", "path": "job/.QAA/job/UI_E2E"},
    ]
    assert settings.jenkins_root_folders == ["PREPROD", "PROD"]
