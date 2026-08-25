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

    settings = Settings(_env_file=None)

    assert settings.cors_origins == expected


def test_kubeconfig_is_empty_when_env_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(EnvKey.KUBECONFIG.value, raising=False)

    settings = Settings(_env_file=None)

    assert settings.kubeconfig == ""


def test_kubeconfig_is_empty_when_env_is_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(EnvKey.KUBECONFIG.value, "")

    settings = Settings(_env_file=None)

    assert settings.kubeconfig == ""


def test_jenkins_root_groups_load_from_csv(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        EnvKey.JENKINS_ROOT_GROUPS.value,
        "BE=job/.QAA/job/E2E,FE=job/.QAA/job/UI_E2E",
    )

    settings = Settings(_env_file=None)

    assert [(group.label, group.path) for group in settings.jenkins_root_groups] == [
        ("BE", "job/.QAA/job/E2E"),
        ("FE", "job/.QAA/job/UI_E2E"),
    ]


def test_jenkins_root_groups_reject_missing_label_or_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(EnvKey.JENKINS_ROOT_GROUPS.value, "BE=job/.QAA/job/E2E,=job/.QAA/job/UI_E2E")

    with pytest.raises(ValueError, match="AGENT_JENKINS_ROOT_GROUPS entries must include"):
        Settings(_env_file=None)
