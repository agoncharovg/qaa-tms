from __future__ import annotations

import asyncio
from collections.abc import Callable, Generator

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from test_users import auth_header, login

from app.core.config import Settings
from app.core.constants import AppEnvironment, DevPassword, DevUsername, ErrorMessage
from app.services.notificator_client import NotificatorClient

NOTIFICATOR_BASE_URL = "https://notificator.example"


def build_settings(
    *,
    notificator_url: str = NOTIFICATOR_BASE_URL,
    notificator_token: str = "shared-secret",
) -> Settings:
    return Settings(
        app_env=AppEnvironment.DEVELOPMENT,
        database_url="sqlite+aiosqlite:///tmp/notificator-test.db",
        jwt_secret="test-secret",
        notificator_url=notificator_url,
        notificator_token=notificator_token,
        notificator_request_timeout=15.0,
    )


@pytest.fixture
def install_notificator_client(
    client: TestClient,
) -> Generator[Callable[[Callable[[httpx.Request], httpx.Response]], None], None, None]:
    installed_clients: list[tuple[httpx.AsyncClient, httpx.AsyncClient]] = []

    def install(handler: Callable[[httpx.Request], httpx.Response]) -> None:
        original_client = client.app.state.notificator_http_client
        notificator_client = httpx.AsyncClient(
            transport=httpx.MockTransport(handler),
            follow_redirects=True,
            timeout=client.app.state.settings.notificator_request_timeout,
        )
        client.app.state.notificator_http_client = notificator_client
        installed_clients.append((original_client, notificator_client))

    yield install

    for original_client, notificator_client in reversed(installed_clients):
        client.app.state.notificator_http_client = original_client
        asyncio.run(notificator_client.aclose())


def test_notificator_client_attaches_shared_token_and_forwards_query() -> None:
    async def exercise() -> list[dict[str, object]]:
        async def handler(request: httpx.Request) -> httpx.Response:
            assert request.method == "GET"
            assert str(request.url) == (
                f"{NOTIFICATOR_BASE_URL}/notificator/notification_configs/?product_team=platform"
            )
            assert request.headers.get("X-Notificator-Token") == "shared-secret"
            return httpx.Response(
                status_code=200,
                json=[
                    {
                        "id": 1,
                        "product_team_id": 5,
                        "product_team": "platform",
                        "notification_type": "FAILED_TEST",
                        "notification_type_label": "Failed test",
                        "enabled": True,
                        "channels": [],
                        "users": [],
                    }
                ],
            )

        http_client = httpx.AsyncClient(
            transport=httpx.MockTransport(handler), follow_redirects=True
        )
        proxy = NotificatorClient(build_settings(), http_client)
        try:
            return await proxy.list_notification_configs(product_team="platform")
        finally:
            await http_client.aclose()

    payload = asyncio.run(exercise())
    assert payload[0]["product_team"] == "platform"


def test_notificator_client_returns_503_when_not_configured() -> None:
    async def exercise() -> HTTPException:
        http_client = httpx.AsyncClient()
        proxy = NotificatorClient(build_settings(notificator_token=""), http_client)
        try:
            await proxy.get_choices()
        except HTTPException as exc:
            return exc
        finally:
            await http_client.aclose()
        raise AssertionError("HTTPException was not raised")

    exc = asyncio.run(exercise())
    assert exc.status_code == 503
    assert exc.detail == ErrorMessage.NOTIFICATOR_NOT_CONFIGURED.value


def test_notificator_client_maps_forbidden_to_shared_token_rejected() -> None:
    async def exercise() -> HTTPException:
        async def handler(_: httpx.Request) -> httpx.Response:
            return httpx.Response(status_code=403, json={"detail": "bad token"})

        http_client = httpx.AsyncClient(
            transport=httpx.MockTransport(handler), follow_redirects=True
        )
        proxy = NotificatorClient(build_settings(), http_client)
        try:
            await proxy.get_choices()
        except HTTPException as exc:
            return exc
        finally:
            await http_client.aclose()
        raise AssertionError("HTTPException was not raised")

    exc = asyncio.run(exercise())
    assert exc.status_code == 502
    assert exc.detail == ErrorMessage.NOTIFICATOR_UPSTREAM_REJECTED.value


def test_notificator_route_returns_backend_payload(
    client: TestClient,
    install_notificator_client: Callable[[Callable[[httpx.Request], httpx.Response]], None],
) -> None:
    token, _ = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)
    client.app.state.settings.notificator_url = NOTIFICATOR_BASE_URL
    client.app.state.settings.notificator_token = "shared-secret"

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/notificator/notification_configs/"
        assert request.url.params.get("product_team") == "platform"
        return httpx.Response(
            status_code=200,
            json=[
                {
                    "id": 1,
                    "product_team_id": 5,
                    "product_team": "platform",
                    "notification_type": "FAILED_TEST",
                    "notification_type_label": "Failed test",
                    "enabled": True,
                    "channels": [],
                    "users": [],
                }
            ],
        )

    install_notificator_client(handler)

    response = client.get(
        "/api/v1/notificator/notification_configs",
        headers=auth_header(token),
        params={"product_team": "platform"},
    )

    assert response.status_code == 200
    assert response.json()[0]["product_team"] == "platform"


def test_notificator_route_requires_permission(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    token, _ = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)

    async def deny(*args, **kwargs) -> bool:
        del args, kwargs
        return False

    monkeypatch.setattr("app.api.deps.has_permission", deny)

    response = client.get("/api/v1/notificator/choices", headers=auth_header(token))

    assert response.status_code == 403
    assert response.json() == {"detail": ErrorMessage.PERMISSION_DENIED.value}
