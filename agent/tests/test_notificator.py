from __future__ import annotations

from typing import Any

import httpx
import pytest

import app.api.notificator as notificator_api
from app.core.config import Settings
from app.core.constants import ErrorMessage
from app.services.notificator import (
    NotificatorUnreachableError,
    create_notification_config,
    list_notification_configs,
)

NOTIFICATOR_BASE_URL = "https://notificator-prod.i.gc.onl"


def build_settings(
    *,
    notificator_url: str = NOTIFICATOR_BASE_URL,
    notificator_token: str = "shared-secret",
) -> Settings:
    return Settings(
        AGENT_HOST="127.0.0.1",
        AGENT_PORT=47600,
        AGENT_BACKEND_URL="http://backend.test",
        AGENT_CORS_ORIGINS="http://localhost:3000,http://127.0.0.1:3000",
        AGENT_NOTIFICATOR_URL=notificator_url,
        AGENT_NOTIFICATOR_TOKEN=notificator_token,
        AGENT_NOTIFICATOR_REQUEST_TIMEOUT=15.0,
    )


def notification_config_payload(team_id: int = 3, team_name: str = "qaa-team") -> dict[str, Any]:
    return {
        "id": 12,
        "product_team_id": team_id,
        "product_team": team_name,
        "notification_type": "NEW_JIRA_TICKET",
        "notification_type_label": "Notify about new JIRA ticket creation",
        "enabled": True,
        "channels": [{"id": 1, "channel_id": "C12345678", "description": "alerts"}],
        "users": [
            {
                "id": 4,
                "sam_account_name": "jdoe",
                "user_principal_name": "jdoe@gcore.com",
                "username": None,
                "display_name": None,
            }
        ],
    }


def notification_config_create_payload() -> dict[str, Any]:
    return {
        "product_team": 3,
        "notification_type": "NEW_JIRA_TICKET",
        "enabled": True,
        "channels": [1],
        "users": [4],
    }


@pytest.mark.asyncio
async def test_list_notification_configs_reads_expected_endpoint() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert str(request.url) == f"{NOTIFICATOR_BASE_URL}/notificator/notification_configs/"
        assert request.headers.get("X-Notificator-Token") == "shared-secret"
        return httpx.Response(status_code=200, json=[notification_config_payload()])

    payload = await list_notification_configs(
        build_settings(),
        transport=httpx.MockTransport(handler),
    )

    assert payload == [notification_config_payload()]


@pytest.mark.asyncio
async def test_list_notification_configs_forwards_product_team_query() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params.get("product_team") == "qaa team"
        return httpx.Response(status_code=200, json=[notification_config_payload()])

    await list_notification_configs(
        build_settings(),
        product_team="qaa team",
        transport=httpx.MockTransport(handler),
    )


@pytest.mark.asyncio
async def test_create_notification_config_posts_expected_payload() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert str(request.url) == f"{NOTIFICATOR_BASE_URL}/notificator/notification_configs/"
        assert request.headers.get("X-Notificator-Token") == "shared-secret"
        assert request.content == b'{"product_team":3,"notification_type":"NEW_JIRA_TICKET","enabled":true,"channels":[1],"users":[4]}'
        return httpx.Response(status_code=201, json=notification_config_payload())

    payload = await create_notification_config(
        build_settings(),
        notification_config_create_payload(),
        transport=httpx.MockTransport(handler),
    )

    assert payload == notification_config_payload()


@pytest.mark.asyncio
async def test_list_notification_configs_maps_upstream_forbidden_to_unreachable() -> None:
    async def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code=403, json={"detail": "bad token"})

    with pytest.raises(
        NotificatorUnreachableError, match=ErrorMessage.NOTIFICATOR_UPSTREAM_REJECTED.value
    ):
        await list_notification_configs(
            build_settings(),
            transport=httpx.MockTransport(handler),
        )


@pytest.mark.asyncio
async def test_notificator_configs_route_returns_503_when_config_missing(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    client._transport.app.state.settings = build_settings(notificator_token="")

    response = await client.get("/notificator/notification_configs", headers=auth_headers)

    assert response.status_code == 503
    assert response.json() == {"detail": ErrorMessage.NOTIFICATOR_NOT_CONFIGURED.value}


@pytest.mark.asyncio
async def test_notificator_configs_route_returns_502_on_upstream_forbidden(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client._transport.app.state.settings = build_settings()

    async def fake_list(
        settings: Settings,
        *,
        product_team: str | None = None,
    ) -> list[dict[str, Any]]:
        del settings, product_team
        raise NotificatorUnreachableError(ErrorMessage.NOTIFICATOR_UPSTREAM_REJECTED.value)

    monkeypatch.setattr(notificator_api, "list_notification_configs", fake_list)

    response = await client.get("/notificator/notification_configs", headers=auth_headers)

    assert response.status_code == 502
    assert response.json() == {"detail": ErrorMessage.NOTIFICATOR_UPSTREAM_REJECTED.value}


@pytest.mark.asyncio
async def test_notificator_configs_route_returns_payload_and_forwards_query(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client._transport.app.state.settings = build_settings()
    seen_product_team: list[str | None] = []

    async def fake_list(
        settings: Settings,
        *,
        product_team: str | None = None,
    ) -> list[dict[str, Any]]:
        del settings
        seen_product_team.append(product_team)
        return [notification_config_payload(team_name="platform")]

    monkeypatch.setattr(notificator_api, "list_notification_configs", fake_list)

    response = await client.get(
        "/notificator/notification_configs",
        headers=auth_headers,
        params={"product_team": "platform"},
    )

    assert response.status_code == 200
    assert seen_product_team == ["platform"]
    assert response.json() == [notification_config_payload(team_name="platform")]


@pytest.mark.asyncio
async def test_notificator_configs_post_route_forwards_body(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client._transport.app.state.settings = build_settings()
    seen_payloads: list[dict[str, Any]] = []

    async def fake_create(
        settings: Settings,
        body: dict[str, Any],
    ) -> dict[str, Any]:
        del settings
        seen_payloads.append(body)
        return notification_config_payload()

    monkeypatch.setattr(notificator_api, "create_notification_config", fake_create)

    response = await client.post(
        "/notificator/notification_configs",
        headers=auth_headers,
        json=notification_config_create_payload(),
    )

    assert response.status_code == 201
    assert seen_payloads == [notification_config_create_payload()]
    assert response.json() == notification_config_payload()
