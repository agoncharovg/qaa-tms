from __future__ import annotations

import asyncio
import json
from collections.abc import Callable, Generator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.constants import (
    DevPassword,
    DevUsername,
    HttpHeader,
    MediaType,
    OperationStatus,
    OperationType,
    RoutePath,
)

QAA_GENERATOR_TEST_BASE_URL = "http://qaa-generator.test/api/v1"
QAA_GENERATOR_PERSONAL_TOKEN = "personal-token"
QAA_GENERATOR_IDEMPOTENCY_KEY = "qaa-idempotency-key"
QAA_GENERATOR_EMAIL_USERNAME = "alice@example.com"
QAA_GENERATOR_EMAIL_PASSWORD = "email-password"
QAA_GENERATOR_EMAIL_DISPLAY_NAME = "Alice Example"
QAA_RUN_ID = "run-123"
QAA_DUPLICATE_RUN_ID = "run-existing"
QAA_JIRA_KEY = "QAA-123"
QAA_CREATED_FROM = "2026-08-11T10:00:00+00:00"
QAA_CREATED_TO = "2026-08-11T11:00:00+00:00"
QAA_CURSOR = "cursor-2"
QAA_LIST_LIMIT = "25"
QAA_LAST_EVENT_ID = "event-7"
QAA_EVENTS_STREAM_BODY = (
    'data: {"sequence":1,"event_type":"stage","message":"started","payload":{}}\n\n'
    'data: {"sequence":2,"event_type":"stage","message":"done","payload":{}}\n\n'
)
QAA_RUNS_PATH = f"/api/v1{RoutePath.QAA_RUNS.value}"
QAA_RUN_DETAIL_PATH = f"{QAA_RUNS_PATH}/{QAA_RUN_ID}"
QAA_RUN_ARTIFACTS_PATH = f"{QAA_RUN_DETAIL_PATH}{RoutePath.ARTIFACTS.value}"
QAA_RUN_PAUSE_PATH = f"{QAA_RUN_DETAIL_PATH}{RoutePath.PAUSE.value}"
QAA_RUN_RESUME_PATH = f"{QAA_RUN_DETAIL_PATH}{RoutePath.RESUME.value}"
QAA_RUN_STOP_PATH = f"{QAA_RUN_DETAIL_PATH}{RoutePath.STOP.value}"
QAA_RUN_EVENTS_PATH = f"{QAA_RUN_DETAIL_PATH}{RoutePath.EVENTS_STREAM.value}"
UPSTREAM_RUNS_PATH = "/api/v1/runs"
UPSTREAM_RUN_DETAIL_PATH = f"{UPSTREAM_RUNS_PATH}/{QAA_RUN_ID}"
UPSTREAM_RUN_ARTIFACTS_PATH = f"{UPSTREAM_RUN_DETAIL_PATH}{RoutePath.ARTIFACTS.value}"
UPSTREAM_RUN_PAUSE_PATH = f"{UPSTREAM_RUN_DETAIL_PATH}{RoutePath.PAUSE.value}"
UPSTREAM_RUN_RESUME_PATH = f"{UPSTREAM_RUN_DETAIL_PATH}{RoutePath.RESUME.value}"
UPSTREAM_RUN_STOP_PATH = f"{UPSTREAM_RUN_DETAIL_PATH}{RoutePath.STOP.value}"
UPSTREAM_RUN_EVENTS_PATH = f"{UPSTREAM_RUN_DETAIL_PATH}{RoutePath.EVENTS_STREAM.value}"
QAA_CREATE_PAYLOAD = {
    "branch": "feature/qaa-generator",
    "dry_run": False,
    "jira_key": QAA_JIRA_KEY,
    "profile": "balanced",
    "skip_exec": False,
    "skip_pr": True,
}
QAA_CREATE_UPSTREAM_RESPONSE = {
    "effective_actor": None,
    "id": QAA_RUN_ID,
    "jira_key": QAA_JIRA_KEY,
    "status": "queued",
}
QAA_CREATE_RESPONSE = {
    "effective_actor": None,
    "jira_key": QAA_JIRA_KEY,
    "run_id": QAA_RUN_ID,
    "status": "queued",
}
QAA_CONFLICT_RESPONSE = {
    "error": "A run for this Jira key is already active.",
    "run_id": QAA_DUPLICATE_RUN_ID,
}
QAA_LIST_UPSTREAM_RESPONSE = {
    "items": [
        {
            "created_at": QAA_CREATED_FROM,
            "effective_actor": "email:alice@example.com",
            "id": QAA_RUN_ID,
            "jira_key": QAA_JIRA_KEY,
            "status": "running",
            "updated_at": QAA_CREATED_TO,
        }
    ],
    "next_cursor": QAA_CURSOR,
}
QAA_LIST_RESPONSE = {
    "items": [
        {
            "created_at": QAA_CREATED_FROM,
            "effective_actor": "email:alice@example.com",
            "jira_key": QAA_JIRA_KEY,
            "run_id": QAA_RUN_ID,
            "status": "running",
            "updated_at": QAA_CREATED_TO,
        }
    ],
    "next_cursor": QAA_CURSOR,
}
QAA_RUN_DETAIL_UPSTREAM_RESPONSE = {
    "created_at": QAA_CREATED_FROM,
    "effective_actor": "email:alice@example.com",
    "id": QAA_RUN_ID,
    "jira_key": QAA_JIRA_KEY,
    "status": "completed",
    "updated_at": QAA_CREATED_TO,
}
QAA_RUN_DETAIL_RESPONSE = {
    "created_at": QAA_CREATED_FROM,
    "effective_actor": "email:alice@example.com",
    "jira_key": QAA_JIRA_KEY,
    "run_id": QAA_RUN_ID,
    "status": "completed",
    "updated_at": QAA_CREATED_TO,
}
QAA_RUN_ARTIFACTS_UPSTREAM_RESPONSE = {
    "archive": {"filename": "run-123.zip", "size_bytes": 128},
    "final_report_text": "Summary\nPR URL: https://example.invalid/pr/123\nGenerated report",
}
QAA_RUN_ARTIFACTS_RESPONSE = {
    "archive": {"filename": "run-123.zip", "size_bytes": 128},
    "final_report_text": "Summary\nPR URL: https://example.invalid/pr/123\nGenerated report",
    "pr_url": "https://example.invalid/pr/123",
    "report_text": "Summary\nPR URL: https://example.invalid/pr/123\nGenerated report",
}
QAA_RUN_CONTROL_RESPONSE = {"run_id": QAA_RUN_ID}
QAA_LIST_QUERY_PARAMS = [
    ("jira_key", QAA_JIRA_KEY),
    ("status", "running"),
    ("status", "paused"),
    ("effective_actor", f"email:{QAA_GENERATOR_EMAIL_USERNAME}"),
    ("created_from", QAA_CREATED_FROM),
    ("created_to", QAA_CREATED_TO),
    ("limit", QAA_LIST_LIMIT),
    ("cursor", QAA_CURSOR),
]


def login(client: TestClient, username: str, password: str) -> tuple[str, dict[str, Any]]:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200
    body = response.json()
    return str(body["access_token"]), body["user"]


def auth_headers(token: str, qaa_token: str | None = None, **extra_headers: str) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token}"}
    if qaa_token is not None:
        headers[HttpHeader.X_QAA_GENERATOR_TOKEN.value] = qaa_token
    headers.update(extra_headers)
    return headers


def create_email_user(client: TestClient) -> tuple[str, dict[str, Any]]:
    admin_token, _ = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)
    create_response = client.post(
        "/api/v1/users",
        headers=auth_headers(admin_token),
        json={
            "display_name": QAA_GENERATOR_EMAIL_DISPLAY_NAME,
            "password": QAA_GENERATOR_EMAIL_PASSWORD,
            "username": QAA_GENERATOR_EMAIL_USERNAME,
        },
    )
    assert create_response.status_code == 201
    return login(client, QAA_GENERATOR_EMAIL_USERNAME, QAA_GENERATOR_EMAIL_PASSWORD)


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
        installed_clients.append((original_client, qaa_client))

    yield install

    for original_client, qaa_client in reversed(installed_clients):
        client.app.state.qaa_generator_client = original_client
        asyncio.run(qaa_client.aclose())


def test_create_qaa_run_returns_202_and_records_operation(
    client: TestClient,
    install_qaa_client: Callable[[Callable[[httpx.Request], httpx.Response]], None],
) -> None:
    token, _ = login(client, DevUsername.TEST.value, DevPassword.EMPTY.value)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == UPSTREAM_RUNS_PATH
        assert (
            request.headers[HttpHeader.AUTHORIZATION.value]
            == f"Bearer {QAA_GENERATOR_PERSONAL_TOKEN}"
        )
        assert request.headers[HttpHeader.IDEMPOTENCY_KEY.value] == QAA_GENERATOR_IDEMPOTENCY_KEY
        assert json.loads(request.content.decode("utf-8")) == QAA_CREATE_PAYLOAD
        return httpx.Response(status_code=202, json=QAA_CREATE_UPSTREAM_RESPONSE)

    install_qaa_client(handler)

    response = client.post(
        QAA_RUNS_PATH,
        headers=auth_headers(
            token,
            QAA_GENERATOR_PERSONAL_TOKEN,
            **{HttpHeader.IDEMPOTENCY_KEY.value: QAA_GENERATOR_IDEMPOTENCY_KEY},
        ),
        json=QAA_CREATE_PAYLOAD,
    )

    assert response.status_code == 202
    assert response.json() == QAA_CREATE_RESPONSE

    operations_response = client.get("/api/v1/operations", headers=auth_headers(token))
    assert operations_response.status_code == 200
    operation = operations_response.json()["items"][0]
    assert operation["type"] == OperationType.QAA_GENERATE.value
    assert operation["status"] == OperationStatus.RUNNING.value
    assert operation["recipe"]["flags"]["jira_key"] == QAA_JIRA_KEY
    assert operation["recipe"]["flags"]["run_id"] == QAA_RUN_ID


def test_create_qaa_run_passes_through_conflict_with_existing_run_id(
    client: TestClient,
    install_qaa_client: Callable[[Callable[[httpx.Request], httpx.Response]], None],
) -> None:
    token, _ = login(client, DevUsername.TEST.value, DevPassword.EMPTY.value)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == UPSTREAM_RUNS_PATH
        assert (
            request.headers[HttpHeader.AUTHORIZATION.value]
            == f"Bearer {QAA_GENERATOR_PERSONAL_TOKEN}"
        )
        return httpx.Response(status_code=409, json=QAA_CONFLICT_RESPONSE)

    install_qaa_client(handler)

    response = client.post(
        QAA_RUNS_PATH,
        headers=auth_headers(token, QAA_GENERATOR_PERSONAL_TOKEN),
        json=QAA_CREATE_PAYLOAD,
    )

    assert response.status_code == 409
    assert response.json() == QAA_CONFLICT_RESPONSE


def test_list_qaa_runs_forwards_filters_and_uses_personal_token(
    client: TestClient,
    install_qaa_client: Callable[[Callable[[httpx.Request], httpx.Response]], None],
) -> None:
    token, _ = login(client, DevUsername.TEST.value, DevPassword.EMPTY.value)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path == UPSTREAM_RUNS_PATH
        assert (
            request.headers[HttpHeader.AUTHORIZATION.value]
            == f"Bearer {QAA_GENERATOR_PERSONAL_TOKEN}"
        )
        assert request.url.params.get("jira_key") == QAA_JIRA_KEY
        assert request.url.params.get("effective_actor") == f"email:{QAA_GENERATOR_EMAIL_USERNAME}"
        assert request.url.params.get("created_from") == QAA_CREATED_FROM
        assert request.url.params.get("created_to") == QAA_CREATED_TO
        assert request.url.params.get("limit") == QAA_LIST_LIMIT
        assert request.url.params.get("cursor") == QAA_CURSOR
        assert request.url.params.get_list("status") == ["running", "paused"]
        return httpx.Response(status_code=200, json=QAA_LIST_UPSTREAM_RESPONSE)

    install_qaa_client(handler)

    response = client.get(
        QAA_RUNS_PATH,
        headers=auth_headers(token, QAA_GENERATOR_PERSONAL_TOKEN),
        params=QAA_LIST_QUERY_PARAMS,
    )

    assert response.status_code == 200
    assert response.json() == QAA_LIST_RESPONSE


def test_create_qaa_run_requires_personal_token(
    client: TestClient,
    install_qaa_client: Callable[[Callable[[httpx.Request], httpx.Response]], None],
) -> None:
    token, _ = login(client, DevUsername.TEST.value, DevPassword.EMPTY.value)

    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"Unexpected upstream request: {request.method} {request.url.path}")

    install_qaa_client(handler)

    response = client.post(QAA_RUNS_PATH, headers=auth_headers(token), json=QAA_CREATE_PAYLOAD)

    assert response.status_code == 412
    assert response.json() == {
        "detail": "Set your personal qaa-generator token in Profile / Settings."
    }

    operations_response = client.get("/api/v1/operations", headers=auth_headers(token))
    assert operations_response.status_code == 200
    assert operations_response.json()["items"] == []


def test_qaa_run_detail_reconciles_operation_with_personal_token(
    client: TestClient,
    install_qaa_client: Callable[[Callable[[httpx.Request], httpx.Response]], None],
) -> None:
    token, _ = create_email_user(client)
    request_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        assert (
            request.headers[HttpHeader.AUTHORIZATION.value]
            == f"Bearer {QAA_GENERATOR_PERSONAL_TOKEN}"
        )
        if request_count == 1:
            assert request.method == "POST"
            assert request.url.path == UPSTREAM_RUNS_PATH
            return httpx.Response(status_code=202, json=QAA_CREATE_UPSTREAM_RESPONSE)
        assert request.method == "GET"
        assert request.url.path == UPSTREAM_RUN_DETAIL_PATH
        return httpx.Response(status_code=200, json=QAA_RUN_DETAIL_UPSTREAM_RESPONSE)

    install_qaa_client(handler)

    create_response = client.post(
        QAA_RUNS_PATH,
        headers=auth_headers(token, QAA_GENERATOR_PERSONAL_TOKEN),
        json=QAA_CREATE_PAYLOAD,
    )
    assert create_response.status_code == 202

    detail_response = client.get(
        QAA_RUN_DETAIL_PATH,
        headers=auth_headers(token, QAA_GENERATOR_PERSONAL_TOKEN),
    )
    assert detail_response.status_code == 200
    assert detail_response.json() == QAA_RUN_DETAIL_RESPONSE

    operations_response = client.get("/api/v1/operations", headers=auth_headers(token))
    assert operations_response.status_code == 200
    operation = operations_response.json()["items"][0]
    assert operation["status"] == OperationStatus.SUCCESS.value


def test_qaa_run_artifacts_and_controls_forward_methods_paths_with_personal_token(
    client: TestClient,
    install_qaa_client: Callable[[Callable[[httpx.Request], httpx.Response]], None],
) -> None:
    token, _ = create_email_user(client)
    seen_requests: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_requests.append((request.method, request.url.path))
        assert (
            request.headers[HttpHeader.AUTHORIZATION.value]
            == f"Bearer {QAA_GENERATOR_PERSONAL_TOKEN}"
        )
        if request.url.path == UPSTREAM_RUN_ARTIFACTS_PATH:
            return httpx.Response(status_code=200, json=QAA_RUN_ARTIFACTS_UPSTREAM_RESPONSE)
        return httpx.Response(status_code=202, json=QAA_RUN_CONTROL_RESPONSE)

    install_qaa_client(handler)

    artifacts_response = client.get(
        QAA_RUN_ARTIFACTS_PATH,
        headers=auth_headers(token, QAA_GENERATOR_PERSONAL_TOKEN),
    )
    pause_response = client.post(
        QAA_RUN_PAUSE_PATH, headers=auth_headers(token, QAA_GENERATOR_PERSONAL_TOKEN)
    )
    resume_response = client.post(
        QAA_RUN_RESUME_PATH, headers=auth_headers(token, QAA_GENERATOR_PERSONAL_TOKEN)
    )
    stop_response = client.post(
        QAA_RUN_STOP_PATH, headers=auth_headers(token, QAA_GENERATOR_PERSONAL_TOKEN)
    )

    assert artifacts_response.status_code == 200
    assert artifacts_response.json() == QAA_RUN_ARTIFACTS_RESPONSE
    assert pause_response.status_code == 202
    assert pause_response.json() == QAA_RUN_CONTROL_RESPONSE
    assert resume_response.status_code == 202
    assert resume_response.json() == QAA_RUN_CONTROL_RESPONSE
    assert stop_response.status_code == 202
    assert stop_response.json() == QAA_RUN_CONTROL_RESPONSE
    assert seen_requests == [
        ("GET", UPSTREAM_RUN_ARTIFACTS_PATH),
        ("POST", UPSTREAM_RUN_PAUSE_PATH),
        ("POST", UPSTREAM_RUN_RESUME_PATH),
        ("POST", UPSTREAM_RUN_STOP_PATH),
    ]


def test_qaa_run_events_stream_passthrough_relays_frames_and_headers(
    client: TestClient,
    install_qaa_client: Callable[[Callable[[httpx.Request], httpx.Response]], None],
) -> None:
    token, _ = login(client, DevUsername.TEST.value, DevPassword.EMPTY.value)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path == UPSTREAM_RUN_EVENTS_PATH
        assert (
            request.headers[HttpHeader.AUTHORIZATION.value]
            == f"Bearer {QAA_GENERATOR_PERSONAL_TOKEN}"
        )
        assert request.headers[HttpHeader.ACCEPT.value] == MediaType.TEXT_EVENT_STREAM.value
        assert request.headers[HttpHeader.LAST_EVENT_ID.value] == QAA_LAST_EVENT_ID
        return httpx.Response(
            status_code=200,
            content=QAA_EVENTS_STREAM_BODY.encode("utf-8"),
            headers={HttpHeader.CONTENT_TYPE.value: MediaType.TEXT_EVENT_STREAM.value},
        )

    install_qaa_client(handler)

    with client.stream(
        "GET",
        QAA_RUN_EVENTS_PATH,
        headers=auth_headers(
            token,
            QAA_GENERATOR_PERSONAL_TOKEN,
            **{HttpHeader.LAST_EVENT_ID.value: QAA_LAST_EVENT_ID},
        ),
    ) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert response.headers[HttpHeader.CONTENT_TYPE.value].startswith(
        MediaType.TEXT_EVENT_STREAM.value
    )
    assert body == QAA_EVENTS_STREAM_BODY


def test_qaa_generator_endpoints_require_authentication(client: TestClient) -> None:
    response = client.get(QAA_RUNS_PATH)
    assert response.status_code == 401
