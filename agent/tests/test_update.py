from __future__ import annotations

import httpx
import pytest

from app.api import routes


async def test_update_requires_auth(client: httpx.AsyncClient) -> None:
    response = await client.post("/update")

    assert response.status_code == 401


async def test_update_spawns_helper(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    called = False

    def fake_spawn_update_helper() -> None:
        nonlocal called
        called = True

    monkeypatch.setenv("QAA_TMS_AGENT_SERVICE_MANAGED", "1")
    monkeypatch.setattr(routes, "spawn_update_helper", fake_spawn_update_helper)

    response = await client.post("/update", headers=auth_headers)

    assert response.status_code == 202
    assert response.json() == {"status": "accepted"}
    assert called is True


async def test_update_returns_409_in_source_run_mode(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    response = await client.post("/update", headers=auth_headers)

    assert response.status_code == 409
    assert response.json() == {
        "detail": (
            "Self-update is only available for install.sh-managed agent services. "
            "The current agent was started directly from a source checkout."
        )
    }


async def test_update_returns_503_when_helper_is_missing(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_spawn_update_helper() -> None:
        raise FileNotFoundError("The update helper is not available in this installation.")

    monkeypatch.setenv("QAA_TMS_AGENT_SERVICE_MANAGED", "1")
    monkeypatch.setattr(routes, "spawn_update_helper", fake_spawn_update_helper)

    response = await client.post("/update", headers=auth_headers)

    assert response.status_code == 503
    assert response.json() == {"detail": "The update helper is not available in this installation."}
