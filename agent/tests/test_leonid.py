from __future__ import annotations

from typing import Any

import httpx
import pytest

from app.api import routes as api_routes
from app.core.config import Settings
from app.core.constants import ErrorMessage
from app.services.leonid import (
    LeonidUnreachableError,
    create_object_definition,
    create_object_value,
    create_pipeline_param,
    create_shared_resource,
    create_shared_resource_limit,
    delete_object_definition,
    delete_object_value,
    delete_pipeline_param,
    delete_shared_resource,
    delete_shared_resource_limit,
    get_object_definition,
    get_object_value,
    get_pipeline_param,
    get_shared_resource,
    get_shared_resource_limit,
    list_object_definitions,
    list_object_values,
    list_pipeline_params,
    list_shared_resource_limit_types,
    list_shared_resource_limits,
    list_shared_resources,
    patch_object_definition,
    patch_object_value,
    patch_pipeline_param,
    patch_shared_resource,
    patch_shared_resource_limit,
    toggle_object_definition,
    toggle_object_value,
    toggle_shared_resource,
    update_object_definition,
    update_object_value,
    update_pipeline_param,
    update_shared_resource,
    update_shared_resource_limit,
)

LEONID_BASE_URL = "https://leonid-prod.i.gc.onl"


def build_settings(
    *,
    leonid_url: str = LEONID_BASE_URL,
    leonid_token: str = "shared-secret",
) -> Settings:
    return Settings(
        AGENT_HOST="127.0.0.1",
        AGENT_PORT=47600,
        AGENT_BACKEND_URL="http://backend.test",
        AGENT_CORS_ORIGINS="http://localhost:3000,http://127.0.0.1:3000",
        AGENT_LEONID_URL=leonid_url,
        AGENT_LEONID_TOKEN=leonid_token,
        AGENT_LEONID_REQUEST_TIMEOUT=15.0,
    )


def shared_limit_payload(limit_id: int = 7, limit_value: int = 4) -> dict[str, Any]:
    return {
        "id": limit_id,
        "resource_name": "gpu",
        "limit_type": 1,
        "limit_value": limit_value,
        "reset_date": None,
    }


@pytest.mark.asyncio
async def test_list_shared_resource_limit_types_reads_expected_endpoint() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert str(request.url) == f"{LEONID_BASE_URL}/api/shared_resource_limit_types/"
        assert request.headers.get("X-Leonid-Token") is None
        return httpx.Response(status_code=200, json=[{"id": 1, "name": "day"}])

    payload = await list_shared_resource_limit_types(
        build_settings(),
        transport=httpx.MockTransport(handler),
    )

    assert payload == [{"id": 1, "name": "day"}]


@pytest.mark.asyncio
async def test_shared_resource_limits_crud_uses_expected_endpoints() -> None:
    requests: list[tuple[str, str, str | None]] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append((request.method, request.url.path, request.headers.get("X-Leonid-Token")))
        if request.method == "GET" and request.url.path.endswith("/shared_resource_limits/"):
            return httpx.Response(status_code=200, json=[shared_limit_payload()])
        if request.method == "GET":
            return httpx.Response(status_code=200, json=shared_limit_payload())
        if request.method == "POST":
            assert request.headers["X-Leonid-Token"] == "shared-secret"
            return httpx.Response(
                status_code=201, json=shared_limit_payload(limit_id=8, limit_value=5)
            )
        if request.method in {"PUT", "PATCH"}:
            assert request.headers["X-Leonid-Token"] == "shared-secret"
            return httpx.Response(
                status_code=200, json=shared_limit_payload(limit_id=8, limit_value=6)
            )
        return httpx.Response(status_code=204)

    transport = httpx.MockTransport(handler)
    settings = build_settings()

    assert await list_shared_resource_limits(settings, transport=transport) == [
        shared_limit_payload()
    ]
    assert (
        await get_shared_resource_limit(settings, 7, transport=transport) == shared_limit_payload()
    )
    assert await create_shared_resource_limit(
        settings,
        {"resource_name": "gpu", "limit_type": 1, "limit_value": 5, "reset_date": None},
        transport=transport,
    ) == shared_limit_payload(limit_id=8, limit_value=5)
    assert await update_shared_resource_limit(
        settings,
        8,
        {"resource_name": "gpu", "limit_type": 1, "limit_value": 6, "reset_date": None},
        transport=transport,
    ) == shared_limit_payload(limit_id=8, limit_value=6)
    assert await patch_shared_resource_limit(
        settings,
        8,
        {"limit_value": 6},
        transport=transport,
    ) == shared_limit_payload(limit_id=8, limit_value=6)
    await delete_shared_resource_limit(settings, 8, transport=transport)

    assert [item[0] for item in requests] == ["GET", "GET", "POST", "PUT", "PATCH", "DELETE"]


@pytest.mark.asyncio
async def test_shared_resources_crud_and_toggle_use_expected_endpoints() -> None:
    seen_paths: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        seen_paths.append(request.url.path)
        payload = {"id": 3, "resource_limit": 8, "value": "spot-1", "count": 2, "enabled": True}
        toggled = {"id": 3, "resource_limit": 8, "value": "spot-1", "count": 1, "enabled": False}
        if request.method == "GET" and request.url.path.endswith("/shared_resources/"):
            return httpx.Response(status_code=200, json=[payload])
        if request.method == "GET":
            return httpx.Response(status_code=200, json=payload)
        if request.method == "DELETE":
            return httpx.Response(status_code=204)
        return httpx.Response(status_code=200, json=toggled)

    transport = httpx.MockTransport(handler)
    settings = build_settings()

    await list_shared_resources(settings, transport=transport)
    await get_shared_resource(settings, 3, transport=transport)
    await create_shared_resource(
        settings,
        {"resource_limit": 8, "value": "spot-1", "count": 2, "enabled": True},
        transport=transport,
    )
    await update_shared_resource(
        settings,
        3,
        {"resource_limit": 8, "value": "spot-1", "count": 1, "enabled": True},
        transport=transport,
    )
    await patch_shared_resource(settings, 3, {"enabled": False}, transport=transport)
    await toggle_shared_resource(settings, 3, transport=transport)
    await delete_shared_resource(settings, 3, transport=transport)

    assert "/api/shared_resources/3/toggle_enabled/" in seen_paths


@pytest.mark.asyncio
async def test_object_definition_crud_and_toggle_use_expected_endpoints() -> None:
    seen_paths: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        seen_paths.append(request.url.path)
        payload = {"id": 2, "object_name": "bucket", "comment": None, "enabled": True}
        toggled = {"id": 2, "object_name": "bucket", "comment": "keep", "enabled": False}
        if request.method == "GET" and request.url.path.endswith("/object_definitions/"):
            return httpx.Response(status_code=200, json=[payload])
        if request.method == "GET":
            return httpx.Response(status_code=200, json=payload)
        if request.method == "DELETE":
            return httpx.Response(status_code=204)
        return httpx.Response(status_code=200, json=toggled)

    transport = httpx.MockTransport(handler)
    settings = build_settings()

    await list_object_definitions(settings, transport=transport)
    await get_object_definition(settings, 2, transport=transport)
    await create_object_definition(
        settings, {"object_name": "bucket", "comment": None, "enabled": True}, transport=transport
    )
    await update_object_definition(
        settings,
        2,
        {"object_name": "bucket", "comment": "keep", "enabled": True},
        transport=transport,
    )
    await patch_object_definition(settings, 2, {"enabled": False}, transport=transport)
    await toggle_object_definition(settings, 2, transport=transport)
    await delete_object_definition(settings, 2, transport=transport)

    assert "/api/object_definitions/2/toggle_enabled/" in seen_paths


@pytest.mark.asyncio
async def test_object_value_crud_and_toggle_use_expected_endpoints() -> None:
    seen_paths: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        seen_paths.append(request.url.path)
        payload = {
            "id": 4,
            "object": 2,
            "environment": 12,
            "value": "arn:123",
            "comment": None,
            "enabled": True,
        }
        toggled = {
            "id": 4,
            "object": 2,
            "environment": 12,
            "value": "arn:123",
            "comment": "prod",
            "enabled": False,
        }
        if request.method == "GET" and request.url.path.endswith("/object_values/"):
            return httpx.Response(status_code=200, json=[payload])
        if request.method == "GET":
            return httpx.Response(status_code=200, json=payload)
        if request.method == "DELETE":
            return httpx.Response(status_code=204)
        return httpx.Response(status_code=200, json=toggled)

    transport = httpx.MockTransport(handler)
    settings = build_settings()

    await list_object_values(settings, transport=transport)
    await get_object_value(settings, 4, transport=transport)
    await create_object_value(
        settings,
        {"object": 2, "environment": 12, "value": "arn:123", "comment": None, "enabled": True},
        transport=transport,
    )
    await update_object_value(
        settings,
        4,
        {"object": 2, "environment": 12, "value": "arn:123", "comment": "prod", "enabled": True},
        transport=transport,
    )
    await patch_object_value(settings, 4, {"enabled": False}, transport=transport)
    await toggle_object_value(settings, 4, transport=transport)
    await delete_object_value(settings, 4, transport=transport)

    assert "/api/object_values/4/toggle_enabled/" in seen_paths


@pytest.mark.asyncio
async def test_pipeline_params_crud_uses_expected_endpoints() -> None:
    seen_paths: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        seen_paths.append(request.url.path)
        payload = {"id": 9, "name": "nightly", "job_path": "job/nightly", "params": ["--smoke"]}
        updated = {
            "id": 9,
            "name": "nightly",
            "job_path": "job/nightly",
            "params": ["--smoke", "--retries=2"],
        }
        if request.method == "GET" and request.url.path.endswith("/pipeline_params/"):
            return httpx.Response(status_code=200, json=[payload])
        if request.method == "GET":
            return httpx.Response(status_code=200, json=payload)
        if request.method == "DELETE":
            return httpx.Response(status_code=204)
        return httpx.Response(status_code=200, json=updated)

    transport = httpx.MockTransport(handler)
    settings = build_settings()

    await list_pipeline_params(settings, transport=transport)
    await get_pipeline_param(settings, 9, transport=transport)
    await create_pipeline_param(
        settings,
        {"name": "nightly", "job_path": "job/nightly", "params": ["--smoke"]},
        transport=transport,
    )
    await update_pipeline_param(
        settings,
        9,
        {"name": "nightly", "job_path": "job/nightly", "params": ["--smoke", "--retries=2"]},
        transport=transport,
    )
    await patch_pipeline_param(
        settings, 9, {"params": ["--smoke", "--retries=2"]}, transport=transport
    )
    await delete_pipeline_param(settings, 9, transport=transport)

    assert seen_paths[-1] == "/api/pipeline_params/9/"


@pytest.mark.asyncio
async def test_create_shared_resource_limit_maps_upstream_forbidden_to_unreachable() -> None:
    async def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code=403, json={"detail": "bad token"})

    with pytest.raises(LeonidUnreachableError, match=ErrorMessage.LEONID_UPSTREAM_REJECTED.value):
        await create_shared_resource_limit(
            build_settings(),
            {"resource_name": "gpu", "limit_type": 1, "limit_value": 5, "reset_date": None},
            transport=httpx.MockTransport(handler),
        )


@pytest.mark.asyncio
async def test_leonid_shared_resource_limits_route_returns_503_when_url_missing(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    client._transport.app.state.settings = build_settings(leonid_url="")

    response = await client.get("/leonid/shared_resource_limits", headers=auth_headers)

    assert response.status_code == 503
    assert response.json() == {"detail": ErrorMessage.LEONID_NOT_CONFIGURED.value}


@pytest.mark.asyncio
async def test_leonid_shared_resource_limit_create_returns_503_when_token_missing(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    client._transport.app.state.settings = build_settings(leonid_token="")

    response = await client.post(
        "/leonid/shared_resource_limits",
        headers=auth_headers,
        json={"resource_name": "gpu", "limit_type": 1, "limit_value": 5, "reset_date": None},
    )

    assert response.status_code == 503
    assert response.json() == {"detail": ErrorMessage.LEONID_WRITE_NOT_CONFIGURED.value}


@pytest.mark.asyncio
async def test_leonid_shared_resource_limit_create_returns_502_on_upstream_forbidden(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client._transport.app.state.settings = build_settings()

    async def fake_create(settings: Settings, body: dict[str, Any]) -> dict[str, Any]:
        del settings, body
        raise LeonidUnreachableError(ErrorMessage.LEONID_UPSTREAM_REJECTED.value)

    monkeypatch.setattr(api_routes, "create_shared_resource_limit", fake_create)

    response = await client.post(
        "/leonid/shared_resource_limits",
        headers=auth_headers,
        json={"resource_name": "gpu", "limit_type": 1, "limit_value": 5, "reset_date": None},
    )

    assert response.status_code == 502
    assert response.json() == {"detail": ErrorMessage.LEONID_UPSTREAM_REJECTED.value}


@pytest.mark.asyncio
async def test_leonid_shared_resource_limit_create_validates_request_body_as_400(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    client._transport.app.state.settings = build_settings()

    response = await client.post(
        "/leonid/shared_resource_limits",
        headers=auth_headers,
        json={"resource_name": "gpu"},
    )

    assert response.status_code == 400
    assert response.json()["detail"].startswith("Invalid request body:")
