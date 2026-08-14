from __future__ import annotations

import asyncio
import json
from collections.abc import Callable, Generator
from typing import Any

import httpx
import pytest

from app.core.constants import AgentPath, BackendPath, HeaderName, HeaderValue

QAA_TOKEN = "local-qaa-token"
RUN_ID = "run-123"
IDEMPOTENCY_KEY = "idem-123"
LAST_EVENT_ID = "event-7"
RUN_CREATE_PAYLOAD = {
    "jira_key": "QAA-123",
    "dry_run": False,
    "skip_pr": True,
    "skip_exec": False,
    "branch": "feature/qaa-generator",
    "profile": "balanced",
}
RUN_RESPONSE = {
    "run_id": RUN_ID,
    "jira_key": "QAA-123",
    "status": "queued",
}
SSE_BODY = 'data: {"sequence":1,"event_type":"stage","message":"started","payload":{}}\n\n'


def build_me_response() -> httpx.Response:
    return httpx.Response(
        status_code=200,
        json={"id": 1, "username": "test", "display_name": "Test User"},
    )


@pytest.fixture
def install_backend_client(
    app: Any,
) -> Generator[Callable[[Callable[[httpx.Request], httpx.Response]], None], None, None]:
    installed_clients: list[tuple[httpx.AsyncClient, httpx.AsyncClient]] = []

    def install(handler: Callable[[httpx.Request], httpx.Response]) -> None:
        original_client = app.state.backend_client
        backend_client = httpx.AsyncClient(
            base_url="http://backend.test",
            transport=httpx.MockTransport(handler),
        )
        app.state.backend_client = backend_client
        installed_clients.append((original_client, backend_client))

    yield install

    for original_client, backend_client in reversed(installed_clients):
        app.state.backend_client = original_client
        asyncio.run(backend_client.aclose())


@pytest.mark.asyncio
async def test_create_qaa_run_forwards_local_qaa_token_and_headers(
    client: httpx.AsyncClient,
    app: Any,
    auth_headers: dict[str, str],
    install_backend_client: Callable[[Callable[[httpx.Request], httpx.Response]], None],
) -> None:
    app.state.settings.qaa_generator_token = QAA_TOKEN

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == BackendPath.ME.value:
            return build_me_response()
        assert request.method == "POST"
        assert request.url.path == BackendPath.QAA_RUNS.value
        assert request.headers[HeaderName.AUTHORIZATION.value] == "Bearer valid-token"
        assert request.headers[HeaderName.X_QAA_TMS.value] == HeaderValue.X_QAA_TMS_ENABLED.value
        assert request.headers[HeaderName.X_QAA_GENERATOR_TOKEN.value] == QAA_TOKEN
        assert request.headers[HeaderName.IDEMPOTENCY_KEY.value] == IDEMPOTENCY_KEY
        assert json.loads(request.content.decode("utf-8")) == RUN_CREATE_PAYLOAD
        return httpx.Response(status_code=202, json=RUN_RESPONSE)

    install_backend_client(handler)

    response = await client.post(
        AgentPath.QAA_RUNS.value,
        headers={**auth_headers, HeaderName.IDEMPOTENCY_KEY.value: IDEMPOTENCY_KEY},
        json=RUN_CREATE_PAYLOAD,
    )

    assert response.status_code == 202
    assert response.json() == RUN_RESPONSE


@pytest.mark.asyncio
async def test_qaa_run_proxy_relays_backend_error_when_local_token_missing(
    client: httpx.AsyncClient,
    app: Any,
    auth_headers: dict[str, str],
    install_backend_client: Callable[[Callable[[httpx.Request], httpx.Response]], None],
) -> None:
    app.state.settings.qaa_generator_token = ""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == BackendPath.ME.value:
            return build_me_response()
        assert request.method == "GET"
        assert request.url.path == f"{BackendPath.QAA_RUNS.value}/{RUN_ID}"
        assert HeaderName.X_QAA_GENERATOR_TOKEN.value not in request.headers
        return httpx.Response(
            status_code=412,
            json={"detail": "Set your personal qaa-generator token in Profile / Settings."},
        )

    install_backend_client(handler)

    response = await client.get(f"{AgentPath.QAA_RUNS.value}/{RUN_ID}", headers=auth_headers)

    assert response.status_code == 412
    assert response.json() == {
        "detail": "Set your personal qaa-generator token in Profile / Settings."
    }


@pytest.mark.asyncio
async def test_qaa_event_stream_proxies_last_event_id_and_body(
    client: httpx.AsyncClient,
    app: Any,
    auth_headers: dict[str, str],
    install_backend_client: Callable[[Callable[[httpx.Request], httpx.Response]], None],
) -> None:
    app.state.settings.qaa_generator_token = QAA_TOKEN

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == BackendPath.ME.value:
            return build_me_response()
        assert request.method == "GET"
        assert request.url.path == (
            f"{BackendPath.QAA_RUNS.value}/{RUN_ID}{AgentPath.QAA_EVENTS_STREAM.value}"
        )
        assert request.headers[HeaderName.LAST_EVENT_ID.value] == LAST_EVENT_ID
        assert request.headers[HeaderName.X_QAA_GENERATOR_TOKEN.value] == QAA_TOKEN
        return httpx.Response(
            status_code=200,
            content=SSE_BODY.encode("utf-8"),
            headers={HeaderName.CONTENT_TYPE.value: HeaderValue.EVENT_STREAM.value},
        )

    install_backend_client(handler)

    async with client.stream(
        "GET",
        f"{AgentPath.QAA_RUNS.value}/{RUN_ID}{AgentPath.QAA_EVENTS_STREAM.value}",
        headers={**auth_headers, HeaderName.LAST_EVENT_ID.value: LAST_EVENT_ID},
    ) as response:
        body = "".join([chunk async for chunk in response.aiter_text()])

    assert response.status_code == 200
    assert response.headers[HeaderName.CONTENT_TYPE.value].startswith(
        HeaderValue.EVENT_STREAM.value
    )
    assert body == SSE_BODY
