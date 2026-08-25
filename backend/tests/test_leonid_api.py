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
from app.services.leonid_client import LeonidClient

LEONID_BASE_URL = "https://leonid.example"


def build_settings(
    *, leonid_url: str = LEONID_BASE_URL, leonid_token: str = "shared-secret"
) -> Settings:
    return Settings(
        app_env=AppEnvironment.DEVELOPMENT,
        database_url="sqlite+aiosqlite:///tmp/leonid-test.db",
        jwt_secret="test-secret",
        leonid_url=leonid_url,
        leonid_token=leonid_token,
        leonid_request_timeout=15.0,
    )


@pytest.fixture
def install_leonid_client(
    client: TestClient,
) -> Generator[Callable[[Callable[[httpx.Request], httpx.Response]], None], None, None]:
    installed_clients: list[tuple[httpx.AsyncClient, httpx.AsyncClient]] = []

    def install(handler: Callable[[httpx.Request], httpx.Response]) -> None:
        original_client = client.app.state.leonid_http_client
        leonid_client = httpx.AsyncClient(
            transport=httpx.MockTransport(handler),
            follow_redirects=True,
            timeout=client.app.state.settings.leonid_request_timeout,
        )
        client.app.state.leonid_http_client = leonid_client
        installed_clients.append((original_client, leonid_client))

    yield install

    for original_client, leonid_client in reversed(installed_clients):
        client.app.state.leonid_http_client = original_client
        asyncio.run(leonid_client.aclose())


def test_leonid_client_attaches_shared_token_to_reads() -> None:
    async def exercise() -> list[dict[str, object]]:
        async def handler(request: httpx.Request) -> httpx.Response:
            assert request.method == "GET"
            assert str(request.url) == f"{LEONID_BASE_URL}/api/shared_resource_limit_types/"
            assert request.headers.get("X-Leonid-Token") == "shared-secret"
            return httpx.Response(status_code=200, json=[{"id": 1, "name": "day"}])

        http_client = httpx.AsyncClient(
            transport=httpx.MockTransport(handler), follow_redirects=True
        )
        proxy = LeonidClient(build_settings(), http_client)
        try:
            return await proxy.list_shared_resource_limit_types()
        finally:
            await http_client.aclose()

    assert asyncio.run(exercise()) == [{"id": 1, "name": "day"}]


def test_leonid_client_returns_503_when_not_configured() -> None:
    async def exercise() -> HTTPException:
        http_client = httpx.AsyncClient()
        proxy = LeonidClient(build_settings(leonid_token=""), http_client)
        try:
            await proxy.list_shared_resource_limit_types()
        except HTTPException as exc:
            return exc
        finally:
            await http_client.aclose()
        raise AssertionError("HTTPException was not raised")

    exc = asyncio.run(exercise())
    assert exc.status_code == 503
    assert exc.detail == ErrorMessage.LEONID_NOT_CONFIGURED.value


def test_leonid_client_returns_502_on_network_error() -> None:
    async def exercise() -> HTTPException:
        async def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("boom", request=request)

        http_client = httpx.AsyncClient(
            transport=httpx.MockTransport(handler), follow_redirects=True
        )
        proxy = LeonidClient(build_settings(), http_client)
        try:
            await proxy.list_shared_resource_limit_types()
        except HTTPException as exc:
            return exc
        finally:
            await http_client.aclose()
        raise AssertionError("HTTPException was not raised")

    exc = asyncio.run(exercise())
    assert exc.status_code == 502
    assert exc.detail == ErrorMessage.LEONID_UNREACHABLE.value


def test_leonid_route_returns_backend_payload(
    client: TestClient,
    install_leonid_client: Callable[[Callable[[httpx.Request], httpx.Response]], None],
) -> None:
    token, _ = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)
    client.app.state.settings.leonid_url = LEONID_BASE_URL
    client.app.state.settings.leonid_token = "shared-secret"

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/shared_resource_limit_types/"
        return httpx.Response(status_code=200, json=[{"id": 1, "name": "day"}])

    install_leonid_client(handler)

    response = client.get("/api/v1/leonid/shared_resource_limit_types", headers=auth_header(token))

    assert response.status_code == 200
    assert response.json() == [{"id": 1, "name": "day"}]


def test_leonid_route_requires_permission(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    token, _ = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)

    async def deny(*args, **kwargs) -> bool:
        del args, kwargs
        return False

    monkeypatch.setattr("app.api.deps.has_permission", deny)

    response = client.get("/api/v1/leonid/shared_resource_limit_types", headers=auth_header(token))

    assert response.status_code == 403
    assert response.json() == {"detail": ErrorMessage.PERMISSION_DENIED.value}
