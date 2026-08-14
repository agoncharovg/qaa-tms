from __future__ import annotations

import pytest

from app.core.config import Settings
from app.core.constants import DEFAULT_KUBECONFIG, EnvKey


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

    settings = Settings(_env_file=None)

    assert settings.cors_origins == expected


def test_kubeconfig_uses_default_path_when_env_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(EnvKey.KUBECONFIG.value, raising=False)

    settings = Settings(_env_file=None)

    assert settings.kubeconfig == DEFAULT_KUBECONFIG


def test_kubeconfig_uses_default_path_when_env_is_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(EnvKey.KUBECONFIG.value, "")

    settings = Settings(_env_file=None)

    assert settings.kubeconfig == DEFAULT_KUBECONFIG
