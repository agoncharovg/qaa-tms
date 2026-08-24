from __future__ import annotations

import asyncio
import json
from collections.abc import Callable, Generator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.constants import DevPassword, DevUsername, HttpHeader, RoutePath

QAA_GENERATOR_TEST_BASE_URL = "http://qaa-generator.test/api/v1"
QAA_GENERATOR_SUPERUSER_TOKEN = "superuser-token"
QAA_ADMIN_EMAIL = "alice@example.com"
QAA_ADMIN_SLACK_USER_ID = "U123456"
QAA_ADMIN_USER_ID = "user-123"
QAA_ADMIN_TOKEN_ID = "svc-123"
QAA_ADMIN_LOOKUP_LIMIT = "25"
QAA_ADMIN_LOOKUP_OFFSET = "0"
QAA_ADMIN_KIND_BOGUS = "bogus"
QAA_ADMIN_KIND_SERVICE = "service"
QAA_ADMIN_CREATED_TOKEN = "plain-user-token"
QAA_ADMIN_REGENERATED_TOKEN = "rotated-user-token"
QAA_ADMIN_SERVICE_TOKEN = "plain-service-token"
QAA_ADMIN_ERROR_DETAIL = "User not found."
QAA_ADMIN_VALIDATION_ERROR_DETAIL = "validation_error"
QAA_ADMIN_USERS_PATH = f"/api/v1{RoutePath.QAA_ADMIN_USERS.value}"
QAA_ADMIN_USER_DETAIL_PATH = f"{QAA_ADMIN_USERS_PATH}/{QAA_ADMIN_USER_ID}"
QAA_ADMIN_USER_REGENERATE_PATH = f"{QAA_ADMIN_USER_DETAIL_PATH}{RoutePath.REGENERATE.value}"
QAA_ADMIN_SERVICE_TOKENS_PATH = f"/api/v1{RoutePath.QAA_ADMIN_SERVICE_TOKENS.value}"
QAA_ADMIN_SERVICE_TOKEN_REGENERATE_PATH = (
    f"{QAA_ADMIN_SERVICE_TOKENS_PATH}/{QAA_ADMIN_TOKEN_ID}"
    f"{RoutePath.SERVICE_TOKEN_REGENERATE.value}"
)
QAA_ADMIN_SERVICE_TOKEN_REVOKE_PATH = (
    f"{QAA_ADMIN_SERVICE_TOKENS_PATH}/{QAA_ADMIN_TOKEN_ID}{RoutePath.REVOKE.value}"
)
UPSTREAM_QAA_USERS_PATH = "/api/v1/users"
UPSTREAM_QAA_USER_DETAIL_PATH = f"{UPSTREAM_QAA_USERS_PATH}/{QAA_ADMIN_USER_ID}"
UPSTREAM_QAA_USER_REGENERATE_PATH = f"{UPSTREAM_QAA_USER_DETAIL_PATH}{RoutePath.REGENERATE.value}"
UPSTREAM_QAA_SERVICE_TOKENS_PATH = "/api/v1/service-tokens"
UPSTREAM_QAA_SERVICE_TOKEN_REGENERATE_PATH = (
    f"{UPSTREAM_QAA_SERVICE_TOKENS_PATH}/{QAA_ADMIN_TOKEN_ID}"
    f"{RoutePath.SERVICE_TOKEN_REGENERATE.value}"
)
UPSTREAM_QAA_SERVICE_TOKEN_REVOKE_PATH = (
    f"{UPSTREAM_QAA_SERVICE_TOKENS_PATH}/{QAA_ADMIN_TOKEN_ID}{RoutePath.REVOKE.value}"
)
QAA_ADMIN_USER = {
    "description": "Owns generator runs",
    "email": QAA_ADMIN_EMAIL,
    "id": QAA_ADMIN_USER_ID,
    "name": "Alice Example",
    "slack_user_id": QAA_ADMIN_SLACK_USER_ID,
}
QAA_ADMIN_USER_CREATE_PAYLOAD = {
    "description": "Owns generator runs",
    "email": QAA_ADMIN_EMAIL,
    "name": "Alice Example",
}
QAA_ADMIN_USER_CREATE_UPSTREAM_PAYLOAD = {
    **QAA_ADMIN_USER_CREATE_PAYLOAD,
    "slack_user_id": None,
}
QAA_ADMIN_USER_UPDATE_PAYLOAD = {
    "description": "Updated owner",
    "name": "Alice Updated",
}
QAA_ADMIN_USER_UPDATE_RESPONSE = {
    **QAA_ADMIN_USER,
    "description": "Updated owner",
    "name": "Alice Updated",
}
QAA_ADMIN_SERVICE_TOKEN_CREATE_PAYLOAD = {
    "name": "CI token",
}
QAA_ADMIN_USERS_RESPONSE = {
    "items": [QAA_ADMIN_USER],
    "next_cursor": None,
}
QAA_ADMIN_CREATE_USER_RESPONSE = {
    "token": QAA_ADMIN_CREATED_TOKEN,
    "user": QAA_ADMIN_USER,
}
QAA_ADMIN_REGENERATE_RESPONSE = {
    "token": QAA_ADMIN_REGENERATED_TOKEN,
}
QAA_ADMIN_CREATE_SERVICE_TOKEN_RESPONSE = {
    "token": QAA_ADMIN_SERVICE_TOKEN,
    "user": QAA_ADMIN_USER,
}
QAA_ADMIN_REVOKE_RESPONSE = {
    "revoked": True,
}
OPERATIONS_PATH = "/api/v1/operations"
AUTH_LOGIN_PATH = "/api/v1/auth/login"
OPERATIONS_RESPONSE_ITEMS = "items"
OPERATIONS_RESPONSE_TOTAL = "total"
AUTHORIZATION_HEADER = "Authorization"
AUTH_SCHEME_BEARER = "Bearer"
ADMIN_REQUIRED_DETAIL = "You do not have permission to perform this action."
SUPERUSER_NOT_CONFIGURED_DETAIL = "qaa-generator superuser token not configured"
SUPERUSER_REJECTED_DETAIL = "superuser token rejected by qaa-generator"
METHOD_DELETE = "DELETE"
METHOD_GET = "GET"
METHOD_PATCH = "PATCH"
METHOD_POST = "POST"
ADMIN_ROUTE_CASES = (
    (METHOD_GET, QAA_ADMIN_USERS_PATH, None),
    (METHOD_POST, QAA_ADMIN_USERS_PATH, QAA_ADMIN_USER_CREATE_PAYLOAD),
    (METHOD_GET, QAA_ADMIN_USER_DETAIL_PATH, None),
    (METHOD_PATCH, QAA_ADMIN_USER_DETAIL_PATH, QAA_ADMIN_USER_UPDATE_PAYLOAD),
    (METHOD_DELETE, QAA_ADMIN_USER_DETAIL_PATH, None),
    (METHOD_POST, QAA_ADMIN_USER_REGENERATE_PATH, None),
    (METHOD_POST, QAA_ADMIN_SERVICE_TOKENS_PATH, QAA_ADMIN_SERVICE_TOKEN_CREATE_PAYLOAD),
    (METHOD_POST, QAA_ADMIN_SERVICE_TOKEN_REGENERATE_PATH, None),
    (METHOD_POST, QAA_ADMIN_SERVICE_TOKEN_REVOKE_PATH, None),
)


def login(client: TestClient, username: str, password: str) -> tuple[str, dict[str, Any]]:
    response = client.post(
        AUTH_LOGIN_PATH,
        json={"username": username, "password": password},
    )
    assert response.status_code == 200
    body = response.json()
    return str(body["access_token"]), body["user"]


def auth_header(token: str) -> dict[str, str]:
    return {AUTHORIZATION_HEADER: f"{AUTH_SCHEME_BEARER} {token}"}


@pytest.fixture
def install_qaa_client(
    client: TestClient,
) -> Generator[Callable[[Callable[[httpx.Request], httpx.Response]], None], None, None]:
    installed_clients: list[tuple[httpx.AsyncClient, httpx.AsyncClient]] = []

    def install(handler: Callable[[httpx.Request], httpx.Response]) -> None:
        original_client = client.app.state.qaa_generator_client
        qaa_client = httpx.AsyncClient(
            base_url=QAA_GENERATOR_TEST_BASE_URL,
            transport=httpx.MockTransport(handler),
        )
        client.app.state.qaa_generator_client = qaa_client
        client.app.state.settings.qaa_generator_base_url = QAA_GENERATOR_TEST_BASE_URL
        client.app.state.settings.qaa_generator_superuser_token = QAA_GENERATOR_SUPERUSER_TOKEN
        installed_clients.append((original_client, qaa_client))

    yield install

    for original_client, qaa_client in reversed(installed_clients):
        client.app.state.qaa_generator_client = original_client
        asyncio.run(qaa_client.aclose())


def assert_operations_do_not_contain_secret(
    client: TestClient,
    token: str,
    secret_value: str,
) -> None:
    response = client.get(OPERATIONS_PATH, headers=auth_header(token))
    assert response.status_code == 200
    payload = response.json()
    assert secret_value not in json.dumps(payload)
    assert payload[OPERATIONS_RESPONSE_TOTAL] == 0
    assert payload[OPERATIONS_RESPONSE_ITEMS] == []


@pytest.mark.parametrize(("method", "path", "payload"), ADMIN_ROUTE_CASES)
def test_non_admin_users_cannot_access_qaa_admin_routes(
    client: TestClient,
    method: str,
    path: str,
    payload: dict[str, Any] | None,
) -> None:
    token, _ = login(client, DevUsername.TEST.value, DevPassword.EMPTY.value)

    response = client.request(method, path, headers=auth_header(token), json=payload)

    assert response.status_code == 403
    assert response.json()["detail"] == ADMIN_REQUIRED_DETAIL


def test_admin_list_qaa_users_uses_superuser_token(
    client: TestClient,
    install_qaa_client: Callable[[Callable[[httpx.Request], httpx.Response]], None],
) -> None:
    token, _ = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == METHOD_GET
        assert request.url.path == UPSTREAM_QAA_USERS_PATH
        assert request.headers[HttpHeader.AUTHORIZATION.value] == (
            f"{AUTH_SCHEME_BEARER} {QAA_GENERATOR_SUPERUSER_TOKEN}"
        )
        assert request.url.params.get("email") == QAA_ADMIN_EMAIL
        assert request.url.params.get("kind") == QAA_ADMIN_KIND_SERVICE
        assert request.url.params.get("slack_user_id") == QAA_ADMIN_SLACK_USER_ID
        assert request.url.params.get("limit") == QAA_ADMIN_LOOKUP_LIMIT
        assert request.url.params.get("offset") == QAA_ADMIN_LOOKUP_OFFSET
        return httpx.Response(status_code=200, json=QAA_ADMIN_USERS_RESPONSE)

    install_qaa_client(handler)

    response = client.get(
        QAA_ADMIN_USERS_PATH,
        headers=auth_header(token),
        params={
            "email": QAA_ADMIN_EMAIL,
            "kind": QAA_ADMIN_KIND_SERVICE,
            "slack_user_id": QAA_ADMIN_SLACK_USER_ID,
            "limit": QAA_ADMIN_LOOKUP_LIMIT,
            "offset": QAA_ADMIN_LOOKUP_OFFSET,
        },
    )

    assert response.status_code == 200
    assert response.json() == QAA_ADMIN_USERS_RESPONSE


def test_missing_superuser_token_returns_501_without_calling_upstream(client: TestClient) -> None:
    token, _ = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)
    client.app.state.settings.qaa_generator_superuser_token = ""

    response = client.get(QAA_ADMIN_USERS_PATH, headers=auth_header(token))

    assert response.status_code == 501
    assert response.json()["detail"] == SUPERUSER_NOT_CONFIGURED_DETAIL


def test_bad_kind_passthrough_keeps_upstream_400(
    client: TestClient,
    install_qaa_client: Callable[[Callable[[httpx.Request], httpx.Response]], None],
) -> None:
    token, _ = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == METHOD_GET
        assert request.url.path == UPSTREAM_QAA_USERS_PATH
        assert request.url.params.get("kind") == QAA_ADMIN_KIND_BOGUS
        return httpx.Response(status_code=400, json={"detail": QAA_ADMIN_VALIDATION_ERROR_DETAIL})

    install_qaa_client(handler)

    response = client.get(
        QAA_ADMIN_USERS_PATH,
        headers=auth_header(token),
        params={"kind": QAA_ADMIN_KIND_BOGUS},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == QAA_ADMIN_VALIDATION_ERROR_DETAIL


def test_create_qaa_user_relays_plaintext_token_and_keeps_operations_secret_free(
    client: TestClient,
    install_qaa_client: Callable[[Callable[[httpx.Request], httpx.Response]], None],
) -> None:
    token, _ = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == METHOD_POST
        assert request.url.path == UPSTREAM_QAA_USERS_PATH
        assert request.headers[HttpHeader.AUTHORIZATION.value] == (
            f"{AUTH_SCHEME_BEARER} {QAA_GENERATOR_SUPERUSER_TOKEN}"
        )
        assert json.loads(request.content.decode("utf-8")) == QAA_ADMIN_USER_CREATE_UPSTREAM_PAYLOAD
        return httpx.Response(status_code=200, json=QAA_ADMIN_CREATE_USER_RESPONSE)

    install_qaa_client(handler)

    response = client.post(
        QAA_ADMIN_USERS_PATH,
        headers=auth_header(token),
        json=QAA_ADMIN_USER_CREATE_PAYLOAD,
    )

    assert response.status_code == 200
    assert response.json() == QAA_ADMIN_CREATE_USER_RESPONSE
    assert_operations_do_not_contain_secret(client, token, QAA_ADMIN_CREATED_TOKEN)


def test_get_qaa_user_passes_through_not_found(
    client: TestClient,
    install_qaa_client: Callable[[Callable[[httpx.Request], httpx.Response]], None],
) -> None:
    token, _ = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == METHOD_GET
        assert request.url.path == UPSTREAM_QAA_USER_DETAIL_PATH
        return httpx.Response(status_code=404, json={"detail": QAA_ADMIN_ERROR_DETAIL})

    install_qaa_client(handler)

    response = client.get(QAA_ADMIN_USER_DETAIL_PATH, headers=auth_header(token))

    assert response.status_code == 404
    assert response.json()["detail"] == QAA_ADMIN_ERROR_DETAIL


def test_update_qaa_user_relays_partial_payload(
    client: TestClient,
    install_qaa_client: Callable[[Callable[[httpx.Request], httpx.Response]], None],
) -> None:
    token, _ = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == METHOD_PATCH
        assert request.url.path == UPSTREAM_QAA_USER_DETAIL_PATH
        assert json.loads(request.content.decode("utf-8")) == QAA_ADMIN_USER_UPDATE_PAYLOAD
        return httpx.Response(status_code=200, json=QAA_ADMIN_USER_UPDATE_RESPONSE)

    install_qaa_client(handler)

    response = client.patch(
        QAA_ADMIN_USER_DETAIL_PATH,
        headers=auth_header(token),
        json=QAA_ADMIN_USER_UPDATE_PAYLOAD,
    )

    assert response.status_code == 200
    assert response.json() == QAA_ADMIN_USER_UPDATE_RESPONSE


def test_delete_qaa_user_passes_through_no_content(
    client: TestClient,
    install_qaa_client: Callable[[Callable[[httpx.Request], httpx.Response]], None],
) -> None:
    token, _ = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == METHOD_DELETE
        assert request.url.path == UPSTREAM_QAA_USER_DETAIL_PATH
        return httpx.Response(status_code=204)

    install_qaa_client(handler)

    response = client.delete(QAA_ADMIN_USER_DETAIL_PATH, headers=auth_header(token))

    assert response.status_code == 204
    assert response.content == b""


def test_regenerate_qaa_user_token_relays_plaintext_token_and_no_secret_audit(
    client: TestClient,
    install_qaa_client: Callable[[Callable[[httpx.Request], httpx.Response]], None],
) -> None:
    token, _ = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == METHOD_POST
        assert request.url.path == UPSTREAM_QAA_USER_REGENERATE_PATH
        return httpx.Response(status_code=200, json=QAA_ADMIN_REGENERATE_RESPONSE)

    install_qaa_client(handler)

    response = client.post(QAA_ADMIN_USER_REGENERATE_PATH, headers=auth_header(token))

    assert response.status_code == 200
    assert response.json() == QAA_ADMIN_REGENERATE_RESPONSE
    assert_operations_do_not_contain_secret(client, token, QAA_ADMIN_REGENERATED_TOKEN)


def test_create_and_revoke_qaa_service_tokens_use_superuser_routes(
    client: TestClient,
    install_qaa_client: Callable[[Callable[[httpx.Request], httpx.Response]], None],
) -> None:
    token, _ = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)
    request_paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        request_paths.append(request.url.path)
        if request.url.path == UPSTREAM_QAA_SERVICE_TOKENS_PATH:
            assert request.method == METHOD_POST
            assert (
                json.loads(request.content.decode("utf-8"))
                == QAA_ADMIN_SERVICE_TOKEN_CREATE_PAYLOAD
            )
            return httpx.Response(status_code=200, json=QAA_ADMIN_CREATE_SERVICE_TOKEN_RESPONSE)
        if request.url.path == UPSTREAM_QAA_SERVICE_TOKEN_REVOKE_PATH:
            assert request.method == METHOD_POST
            return httpx.Response(status_code=200, json=QAA_ADMIN_REVOKE_RESPONSE)
        raise AssertionError(f"Unexpected upstream path {request.url.path}")

    install_qaa_client(handler)

    create_response = client.post(
        QAA_ADMIN_SERVICE_TOKENS_PATH,
        headers=auth_header(token),
        json=QAA_ADMIN_SERVICE_TOKEN_CREATE_PAYLOAD,
    )
    revoke_response = client.post(QAA_ADMIN_SERVICE_TOKEN_REVOKE_PATH, headers=auth_header(token))

    assert create_response.status_code == 200
    assert create_response.json() == QAA_ADMIN_CREATE_SERVICE_TOKEN_RESPONSE
    assert revoke_response.status_code == 200
    assert revoke_response.json() == QAA_ADMIN_REVOKE_RESPONSE
    assert request_paths == [
        UPSTREAM_QAA_SERVICE_TOKENS_PATH,
        UPSTREAM_QAA_SERVICE_TOKEN_REVOKE_PATH,
    ]
    assert_operations_do_not_contain_secret(client, token, QAA_ADMIN_SERVICE_TOKEN)


def test_regenerate_qaa_service_token_relays_plaintext_token_and_no_secret_audit(
    client: TestClient,
    install_qaa_client: Callable[[Callable[[httpx.Request], httpx.Response]], None],
) -> None:
    token, _ = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == METHOD_POST
        assert request.url.path == UPSTREAM_QAA_SERVICE_TOKEN_REGENERATE_PATH
        return httpx.Response(status_code=200, json=QAA_ADMIN_REGENERATE_RESPONSE)

    install_qaa_client(handler)

    response = client.post(QAA_ADMIN_SERVICE_TOKEN_REGENERATE_PATH, headers=auth_header(token))

    assert response.status_code == 200
    assert response.json() == QAA_ADMIN_REGENERATE_RESPONSE
    assert_operations_do_not_contain_secret(client, token, QAA_ADMIN_REGENERATED_TOKEN)


def test_upstream_superuser_403_surfaces_clear_error(
    client: TestClient,
    install_qaa_client: Callable[[Callable[[httpx.Request], httpx.Response]], None],
) -> None:
    token, _ = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code=403, json={"detail": "forbidden"})

    install_qaa_client(handler)

    response = client.get(QAA_ADMIN_USERS_PATH, headers=auth_header(token))

    assert response.status_code == 502
    assert response.json()["detail"] == SUPERUSER_REJECTED_DETAIL
