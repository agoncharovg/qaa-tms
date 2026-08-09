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
