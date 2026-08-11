from __future__ import annotations

import pytest

from app.core.config import Settings
from app.core.constants import EnvKey


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


def test_qaa_generator_port_forward_settings_load_from_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(EnvKey.QAA_GENERATOR_PORT_FORWARD_ENABLED.value, "true")
    monkeypatch.setenv(EnvKey.QAA_GENERATOR_PORT_FORWARD_NAMESPACE.value, "aut")
    monkeypatch.setenv(EnvKey.QAA_GENERATOR_PORT_FORWARD_RESOURCE.value, "svc/custom-generator")
    monkeypatch.setenv(EnvKey.QAA_GENERATOR_PORT_FORWARD_LOCAL_PORT.value, "19090")
    monkeypatch.setenv(EnvKey.QAA_GENERATOR_PORT_FORWARD_REMOTE_PORT.value, "8088")

    settings = Settings()

    assert settings.qaa_generator_port_forward_enabled is True
    assert settings.qaa_generator_port_forward_namespace == "aut"
    assert settings.qaa_generator_port_forward_resource == "svc/custom-generator"
    assert settings.qaa_generator_port_forward_local_port == 19090
    assert settings.qaa_generator_port_forward_remote_port == 8088
