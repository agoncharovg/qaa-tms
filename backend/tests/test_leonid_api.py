from __future__ import annotations

import asyncio
from collections.abc import Callable, Generator
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from test_users import auth_header, login

from app.api.deps import get_leonid_client
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


def build_skipped_suite_payload(
    *,
    suite_id: int = 11,
    author: str = "owner@example.com",
    status: str = "active",
    cancelled_by: str | None = None,
    cancelled_at: str | None = None,
) -> dict[str, object]:
    return {
        "id": suite_id,
        "author": author,
        "reason": "Flaky in smoke",
        "product": "Billing",
        "created_at": "2026-08-29T08:00:00Z",
        "expires_at": "2026-09-01T08:00:00Z",
        "cancelled_at": cancelled_at,
        "cancelled_by": cancelled_by,
        "status": status,
        "tests": [{"full_name": "tests.api.test_example#test_case"}],
    }


@pytest.fixture
def mocked_leonid_client(client: TestClient) -> Generator[LeonidClient, None, None]:
    mock_client = AsyncMock(spec=LeonidClient)
    client.app.dependency_overrides[get_leonid_client] = lambda: mock_client
    yield mock_client
    client.app.dependency_overrides.pop(get_leonid_client, None)


def test_list_skipped_suites_returns_proxy_payload(
    client: TestClient,
    mocked_leonid_client: LeonidClient,
) -> None:
    token, _ = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)
    payload = [build_skipped_suite_payload()]
    mocked_leonid_client.list_skipped_suites.return_value = payload  # type: ignore[attr-defined]

    response = client.get("/api/v1/leonid/skipped_suites", headers=auth_header(token))

    assert response.status_code == 200
    assert response.json() == payload
    mocked_leonid_client.list_skipped_suites.assert_awaited_once_with()  # type: ignore[attr-defined]


def test_get_skipped_suite_returns_proxy_payload(
    client: TestClient,
    mocked_leonid_client: LeonidClient,
) -> None:
    token, _ = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)
    payload = build_skipped_suite_payload(suite_id=17)
    mocked_leonid_client.get_skipped_suite.return_value = payload  # type: ignore[attr-defined]

    response = client.get("/api/v1/leonid/skipped_suites/17", headers=auth_header(token))

    assert response.status_code == 200
    assert response.json() == payload
    mocked_leonid_client.get_skipped_suite.assert_awaited_once_with(17)  # type: ignore[attr-defined]


def test_get_skipped_suite_ignores_extra_test_fields_in_proxy_response(
    client: TestClient,
    mocked_leonid_client: LeonidClient,
) -> None:
    token, _ = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)
    payload = build_skipped_suite_payload(suite_id=18)
    payload["tests"] = [
        {
            "full_name": "tests.api.test_example#test_case",
            "id": 5,
        }
    ]
    mocked_leonid_client.get_skipped_suite.return_value = payload  # type: ignore[attr-defined]

    response = client.get("/api/v1/leonid/skipped_suites/18", headers=auth_header(token))

    assert response.status_code == 200
    assert response.json()["tests"] == [{"full_name": "tests.api.test_example#test_case"}]
    mocked_leonid_client.get_skipped_suite.assert_awaited_once_with(18)  # type: ignore[attr-defined]


def test_create_skipped_suite_injects_author_from_current_user(
    client: TestClient,
    mocked_leonid_client: LeonidClient,
) -> None:
    token, user = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)
    payload = build_skipped_suite_payload(author=str(user["username"]))
    mocked_leonid_client.create_skipped_suite.return_value = payload  # type: ignore[attr-defined]

    response = client.post(
        "/api/v1/leonid/skipped_suites",
        headers=auth_header(token),
        json={
            "reason": "Flaky in smoke",
            "product": "Billing",
            "expires_at": "2026-09-01T08:00:00Z",
            "tests": [{"full_name": "tests.api.test_example#test_case"}],
        },
    )

    assert response.status_code == 201
    assert response.json() == payload
    mocked_leonid_client.create_skipped_suite.assert_awaited_once_with(  # type: ignore[attr-defined]
        {
            "author": user["username"],
            "reason": "Flaky in smoke",
            "product": "Billing",
            "expires_at": "2026-09-01T08:00:00Z",
            "tests": [{"full_name": "tests.api.test_example#test_case"}],
        }
    )


def test_create_skipped_suite_rejects_client_supplied_author(
    client: TestClient,
    mocked_leonid_client: LeonidClient,
) -> None:
    token, _ = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)

    response = client.post(
        "/api/v1/leonid/skipped_suites",
        headers=auth_header(token),
        json={
            "author": "spoof@example.com",
            "reason": "Flaky in smoke",
            "product": "Billing",
            "expires_at": "2026-09-01T08:00:00Z",
            "tests": [{"full_name": "tests.api.test_example#test_case"}],
        },
    )

    assert response.status_code == 400
    assert (
        response.json()["detail"] == "Invalid request body: author: Extra inputs are not permitted"
    )
    mocked_leonid_client.create_skipped_suite.assert_not_called()  # type: ignore[attr-defined]


def test_cancel_skipped_suite_injects_current_user(
    client: TestClient,
    mocked_leonid_client: LeonidClient,
) -> None:
    token, user = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)
    payload = build_skipped_suite_payload(
        suite_id=29,
        author="owner@example.com",
        status="cancelled",
        cancelled_by=str(user["username"]),
        cancelled_at="2026-08-29T10:00:00Z",
    )
    mocked_leonid_client.cancel_skipped_suite.return_value = payload  # type: ignore[attr-defined]

    response = client.post("/api/v1/leonid/skipped_suites/29/cancel", headers=auth_header(token))

    assert response.status_code == 200
    assert response.json() == payload
    mocked_leonid_client.cancel_skipped_suite.assert_awaited_once_with(  # type: ignore[attr-defined]
        29,
        {"cancelled_by": user["username"]},
    )


@pytest.mark.parametrize("method", ["put", "patch", "delete"])
def test_skipped_suite_update_and_delete_routes_are_not_registered(
    client: TestClient,
    method: str,
) -> None:
    token, _ = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)

    response = getattr(client, method)(
        "/api/v1/leonid/skipped_suites/11",
        headers=auth_header(token),
    )

    assert response.status_code == 405
