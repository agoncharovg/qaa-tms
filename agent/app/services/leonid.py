"""Leonid CRUD REST helpers for the local companion app."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import Settings
from app.core.constants import ErrorMessage, HeaderName, HeaderValue

logger = logging.getLogger(__name__)

LEONID_LIMIT_TYPE_PATH = "/api/shared_resource_limit_types/"
LEONID_LIMIT_PATH = "/api/shared_resource_limits/"
LEONID_RESOURCE_PATH = "/api/shared_resources/"
LEONID_OBJECT_DEFINITION_PATH = "/api/object_definitions/"
LEONID_OBJECT_VALUE_PATH = "/api/object_values/"
LEONID_PIPELINE_PARAM_PATH = "/api/pipeline_params/"


class LeonidNotConfiguredError(RuntimeError):
    """Raised when the local Leonid base URL is missing."""


class LeonidUnreachableError(RuntimeError):
    """Raised when Leonid cannot be queried successfully."""


def require_configured(settings: Settings) -> None:
    """Reject requests when Leonid is not configured locally."""

    if not settings.leonid_configured:
        raise LeonidNotConfiguredError(ErrorMessage.LEONID_NOT_CONFIGURED.value)


def _detail_path(collection_path: str, item_id: int) -> str:
    return f"{collection_path}{item_id}/"


def _toggle_path(collection_path: str, item_id: int) -> str:
    return f"{collection_path}{item_id}/toggle_enabled/"


async def _send_json(
    settings: Settings,
    method: str,
    path: str,
    *,
    json: dict[str, Any] | None = None,
    token: str | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[dict[str, Any]] | dict[str, Any] | None:
    """Send a JSON request to Leonid and return the decoded JSON body."""

    require_configured(settings)
    url = f"{settings.leonid_url}{path}"
    headers = {HeaderName.ACCEPT.value: HeaderValue.APPLICATION_JSON.value}
    # Every management endpoint is token-gated (HasLeonidToken), reads included,
    # so attach the token whenever we have one — not only for mutations.
    if token:
        headers[HeaderName.X_LEONID_TOKEN.value] = token

    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            headers=headers,
            timeout=settings.leonid_request_timeout,
            transport=transport,
        ) as client:
            response = await client.request(method, url, json=json)
    except httpx.TimeoutException as exc:
        logger.warning("Leonid request timed out for %s %s.", method, path)
        raise LeonidUnreachableError(ErrorMessage.LEONID_UNREACHABLE.value) from exc
    except httpx.HTTPError as exc:
        logger.warning(
            "Leonid request failed for %s %s: %s.",
            method,
            path,
            exc.__class__.__name__,
        )
        raise LeonidUnreachableError(ErrorMessage.LEONID_UNREACHABLE.value) from exc

    if response.status_code in (httpx.codes.UNAUTHORIZED, httpx.codes.FORBIDDEN):
        logger.warning("Leonid rejected the shared token for %s %s.", method, path)
        raise LeonidUnreachableError(ErrorMessage.LEONID_UPSTREAM_REJECTED.value)

    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        logger.warning("Leonid returned HTTP %s for %s %s.", response.status_code, method, path)
        raise LeonidUnreachableError(ErrorMessage.LEONID_UNREACHABLE.value) from exc

    if response.status_code == httpx.codes.NO_CONTENT or not response.content:
        return None

    try:
        payload = response.json()
    except ValueError as exc:
        logger.warning("Leonid returned invalid JSON for %s %s.", method, path)
        raise LeonidUnreachableError(ErrorMessage.LEONID_UNREACHABLE.value) from exc

    if not isinstance(payload, (dict, list)):
        logger.warning("Leonid returned an unsupported JSON payload for %s %s.", method, path)
        raise LeonidUnreachableError(ErrorMessage.LEONID_UNREACHABLE.value)

    return payload


async def _list_collection(
    settings: Settings,
    collection_path: str,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[dict[str, Any]]:
    payload = await _send_json(
        settings,
        "GET",
        collection_path,
        token=settings.leonid_token,
        transport=transport,
    )
    return payload if isinstance(payload, list) else []


async def _retrieve_item(
    settings: Settings,
    collection_path: str,
    item_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    payload = await _send_json(
        settings,
        "GET",
        _detail_path(collection_path, item_id),
        token=settings.leonid_token,
        transport=transport,
    )
    return payload if isinstance(payload, dict) else {}


async def _create_item(
    settings: Settings,
    collection_path: str,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    payload = await _send_json(
        settings,
        "POST",
        collection_path,
        json=body,
        token=settings.leonid_token,
        transport=transport,
    )
    return payload if isinstance(payload, dict) else {}


async def _update_item(
    settings: Settings,
    method: str,
    collection_path: str,
    item_id: int,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    payload = await _send_json(
        settings,
        method,
        _detail_path(collection_path, item_id),
        json=body,
        token=settings.leonid_token,
        transport=transport,
    )
    return payload if isinstance(payload, dict) else {}


async def _delete_item(
    settings: Settings,
    collection_path: str,
    item_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> None:
    await _send_json(
        settings,
        "DELETE",
        _detail_path(collection_path, item_id),
        token=settings.leonid_token,
        transport=transport,
    )


async def _toggle_item(
    settings: Settings,
    collection_path: str,
    item_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    payload = await _send_json(
        settings,
        "POST",
        _toggle_path(collection_path, item_id),
        token=settings.leonid_token,
        transport=transport,
    )
    return payload if isinstance(payload, dict) else {}


async def list_shared_resource_limit_types(
    settings: Settings,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[dict[str, Any]]:
    return await _list_collection(settings, LEONID_LIMIT_TYPE_PATH, transport=transport)


async def get_shared_resource_limit_type(
    settings: Settings,
    limit_type_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _retrieve_item(
        settings, LEONID_LIMIT_TYPE_PATH, limit_type_id, transport=transport
    )


async def list_shared_resource_limits(
    settings: Settings,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[dict[str, Any]]:
    return await _list_collection(settings, LEONID_LIMIT_PATH, transport=transport)


async def get_shared_resource_limit(
    settings: Settings,
    limit_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _retrieve_item(settings, LEONID_LIMIT_PATH, limit_id, transport=transport)


async def create_shared_resource_limit(
    settings: Settings,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _create_item(settings, LEONID_LIMIT_PATH, body, transport=transport)


async def update_shared_resource_limit(
    settings: Settings,
    limit_id: int,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _update_item(
        settings, "PUT", LEONID_LIMIT_PATH, limit_id, body, transport=transport
    )


async def patch_shared_resource_limit(
    settings: Settings,
    limit_id: int,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _update_item(
        settings, "PATCH", LEONID_LIMIT_PATH, limit_id, body, transport=transport
    )


async def delete_shared_resource_limit(
    settings: Settings,
    limit_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> None:
    await _delete_item(settings, LEONID_LIMIT_PATH, limit_id, transport=transport)


async def list_shared_resources(
    settings: Settings,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[dict[str, Any]]:
    return await _list_collection(settings, LEONID_RESOURCE_PATH, transport=transport)


async def get_shared_resource(
    settings: Settings,
    resource_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _retrieve_item(settings, LEONID_RESOURCE_PATH, resource_id, transport=transport)


async def create_shared_resource(
    settings: Settings,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _create_item(settings, LEONID_RESOURCE_PATH, body, transport=transport)


async def update_shared_resource(
    settings: Settings,
    resource_id: int,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _update_item(
        settings, "PUT", LEONID_RESOURCE_PATH, resource_id, body, transport=transport
    )


async def patch_shared_resource(
    settings: Settings,
    resource_id: int,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _update_item(
        settings, "PATCH", LEONID_RESOURCE_PATH, resource_id, body, transport=transport
    )


async def delete_shared_resource(
    settings: Settings,
    resource_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> None:
    await _delete_item(settings, LEONID_RESOURCE_PATH, resource_id, transport=transport)


async def toggle_shared_resource(
    settings: Settings,
    resource_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _toggle_item(settings, LEONID_RESOURCE_PATH, resource_id, transport=transport)


async def list_object_definitions(
    settings: Settings,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[dict[str, Any]]:
    return await _list_collection(settings, LEONID_OBJECT_DEFINITION_PATH, transport=transport)


async def get_object_definition(
    settings: Settings,
    definition_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _retrieve_item(
        settings, LEONID_OBJECT_DEFINITION_PATH, definition_id, transport=transport
    )


async def create_object_definition(
    settings: Settings,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _create_item(settings, LEONID_OBJECT_DEFINITION_PATH, body, transport=transport)


async def update_object_definition(
    settings: Settings,
    definition_id: int,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _update_item(
        settings, "PUT", LEONID_OBJECT_DEFINITION_PATH, definition_id, body, transport=transport
    )


async def patch_object_definition(
    settings: Settings,
    definition_id: int,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _update_item(
        settings, "PATCH", LEONID_OBJECT_DEFINITION_PATH, definition_id, body, transport=transport
    )


async def delete_object_definition(
    settings: Settings,
    definition_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> None:
    await _delete_item(settings, LEONID_OBJECT_DEFINITION_PATH, definition_id, transport=transport)


async def toggle_object_definition(
    settings: Settings,
    definition_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _toggle_item(
        settings, LEONID_OBJECT_DEFINITION_PATH, definition_id, transport=transport
    )


async def list_object_values(
    settings: Settings,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[dict[str, Any]]:
    return await _list_collection(settings, LEONID_OBJECT_VALUE_PATH, transport=transport)


async def get_object_value(
    settings: Settings,
    value_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _retrieve_item(settings, LEONID_OBJECT_VALUE_PATH, value_id, transport=transport)


async def create_object_value(
    settings: Settings,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _create_item(settings, LEONID_OBJECT_VALUE_PATH, body, transport=transport)


async def update_object_value(
    settings: Settings,
    value_id: int,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _update_item(
        settings, "PUT", LEONID_OBJECT_VALUE_PATH, value_id, body, transport=transport
    )


async def patch_object_value(
    settings: Settings,
    value_id: int,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _update_item(
        settings, "PATCH", LEONID_OBJECT_VALUE_PATH, value_id, body, transport=transport
    )


async def delete_object_value(
    settings: Settings,
    value_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> None:
    await _delete_item(settings, LEONID_OBJECT_VALUE_PATH, value_id, transport=transport)


async def toggle_object_value(
    settings: Settings,
    value_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _toggle_item(settings, LEONID_OBJECT_VALUE_PATH, value_id, transport=transport)


async def list_pipeline_params(
    settings: Settings,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[dict[str, Any]]:
    return await _list_collection(settings, LEONID_PIPELINE_PARAM_PATH, transport=transport)


async def get_pipeline_param(
    settings: Settings,
    pipeline_param_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _retrieve_item(
        settings, LEONID_PIPELINE_PARAM_PATH, pipeline_param_id, transport=transport
    )


async def create_pipeline_param(
    settings: Settings,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _create_item(settings, LEONID_PIPELINE_PARAM_PATH, body, transport=transport)


async def update_pipeline_param(
    settings: Settings,
    pipeline_param_id: int,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _update_item(
        settings, "PUT", LEONID_PIPELINE_PARAM_PATH, pipeline_param_id, body, transport=transport
    )


async def patch_pipeline_param(
    settings: Settings,
    pipeline_param_id: int,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _update_item(
        settings, "PATCH", LEONID_PIPELINE_PARAM_PATH, pipeline_param_id, body, transport=transport
    )


async def delete_pipeline_param(
    settings: Settings,
    pipeline_param_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> None:
    await _delete_item(settings, LEONID_PIPELINE_PARAM_PATH, pipeline_param_id, transport=transport)
