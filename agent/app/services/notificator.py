"""Notificator CRUD REST helpers for the local companion app."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import Settings
from app.core.constants import ErrorMessage, HeaderName, HeaderValue

logger = logging.getLogger(__name__)

NOTIFICATOR_NOTIFICATION_CONFIGS_PATH = "/notificator/notification_configs/"
NOTIFICATOR_TEAMS_PATH = "/notificator/teams/"
NOTIFICATOR_PRODUCTS_PATH = "/notificator/products/"
NOTIFICATOR_SUB_PRODUCTS_PATH = "/notificator/sub_products/"
NOTIFICATOR_SLACK_CHANNELS_PATH = "/notificator/slack_channels/"
NOTIFICATOR_USERS_PATH = "/notificator/users/"
NOTIFICATOR_QAA_MEMBERS_PATH = "/notificator/qaa_members/"
NOTIFICATOR_FAILURE_MENTION_RULES_PATH = "/notificator/failure_mention_rules/"
NOTIFICATOR_EVENTS_PATH = "/notificator/events/"
NOTIFICATOR_RECURRENT_FAILS_PATH = "/notificator/recurrent_fails/"
NOTIFICATOR_FAIL_REASONS_PATH = "/notificator/fail_reasons/"
NOTIFICATOR_MUTE_STATUSES_PATH = "/notificator/mute_statuses/"
NOTIFICATOR_HISTORY_PATH = "/notificator/history/"
NOTIFICATOR_CHOICES_PATH = "/notificator/choices/"


class NotificatorNotConfiguredError(RuntimeError):
    """Raised when the local Notificator settings are incomplete."""


class NotificatorUnreachableError(RuntimeError):
    """Raised when Notificator cannot be queried successfully."""


def require_configured(settings: Settings) -> None:
    """Reject requests when Notificator is not configured locally."""

    if not settings.notificator_configured:
        raise NotificatorNotConfiguredError(ErrorMessage.NOTIFICATOR_NOT_CONFIGURED.value)


def _detail_path(collection_path: str, item_id: int) -> str:
    return f"{collection_path}{item_id}/"


async def _send_json(
    settings: Settings,
    method: str,
    path: str,
    *,
    json: dict[str, Any] | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[dict[str, Any]] | dict[str, Any] | None:
    """Send a JSON request to Notificator and return the decoded JSON body."""

    require_configured(settings)
    url = f"{settings.notificator_url}{path}"
    headers = {
        HeaderName.ACCEPT.value: HeaderValue.APPLICATION_JSON.value,
        HeaderName.X_NOTIFICATOR_TOKEN.value: settings.notificator_token,
    }

    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            headers=headers,
            timeout=settings.notificator_request_timeout,
            transport=transport,
        ) as client:
            response = await client.request(method, url, json=json)
    except httpx.TimeoutException as exc:
        logger.warning("Notificator request timed out for %s %s.", method, path)
        raise NotificatorUnreachableError(ErrorMessage.NOTIFICATOR_UNREACHABLE.value) from exc
    except httpx.HTTPError as exc:
        logger.warning(
            "Notificator request failed for %s %s: %s.",
            method,
            path,
            exc.__class__.__name__,
        )
        raise NotificatorUnreachableError(ErrorMessage.NOTIFICATOR_UNREACHABLE.value) from exc

    if response.status_code in (httpx.codes.UNAUTHORIZED, httpx.codes.FORBIDDEN):
        logger.warning("Notificator rejected the shared token for %s %s.", method, path)
        raise NotificatorUnreachableError(ErrorMessage.NOTIFICATOR_UPSTREAM_REJECTED.value)

    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Notificator returned HTTP %s for %s %s.", response.status_code, method, path
        )
        raise NotificatorUnreachableError(ErrorMessage.NOTIFICATOR_UNREACHABLE.value) from exc

    if response.status_code == httpx.codes.NO_CONTENT or not response.content:
        return None

    try:
        payload = response.json()
    except ValueError as exc:
        logger.warning("Notificator returned invalid JSON for %s %s.", method, path)
        raise NotificatorUnreachableError(ErrorMessage.NOTIFICATOR_UNREACHABLE.value) from exc

    if not isinstance(payload, (dict, list)):
        logger.warning("Notificator returned an unsupported JSON payload for %s %s.", method, path)
        raise NotificatorUnreachableError(ErrorMessage.NOTIFICATOR_UNREACHABLE.value)

    return payload


async def _list_collection(
    settings: Settings,
    collection_path: str,
    *,
    query: dict[str, str] | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[dict[str, Any]]:
    path = collection_path
    if query:
        path = f"{collection_path}?{httpx.QueryParams(query)}"
    payload = await _send_json(settings, "GET", path, transport=transport)
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
    payload = await _send_json(settings, "POST", collection_path, json=body, transport=transport)
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
        transport=transport,
    )


async def get_choices(
    settings: Settings,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    payload = await _send_json(settings, "GET", NOTIFICATOR_CHOICES_PATH, transport=transport)
    return payload if isinstance(payload, dict) else {}


async def list_notification_configs(
    settings: Settings,
    *,
    product_team: str | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[dict[str, Any]]:
    query = {"product_team": product_team} if product_team else None
    return await _list_collection(
        settings,
        NOTIFICATOR_NOTIFICATION_CONFIGS_PATH,
        query=query,
        transport=transport,
    )


async def get_notification_config(
    settings: Settings,
    config_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _retrieve_item(
        settings,
        NOTIFICATOR_NOTIFICATION_CONFIGS_PATH,
        config_id,
        transport=transport,
    )


async def create_notification_config(
    settings: Settings,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _create_item(
        settings,
        NOTIFICATOR_NOTIFICATION_CONFIGS_PATH,
        body,
        transport=transport,
    )


async def update_notification_config(
    settings: Settings,
    config_id: int,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _update_item(
        settings,
        "PUT",
        NOTIFICATOR_NOTIFICATION_CONFIGS_PATH,
        config_id,
        body,
        transport=transport,
    )


async def patch_notification_config(
    settings: Settings,
    config_id: int,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _update_item(
        settings,
        "PATCH",
        NOTIFICATOR_NOTIFICATION_CONFIGS_PATH,
        config_id,
        body,
        transport=transport,
    )


async def delete_notification_config(
    settings: Settings,
    config_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> None:
    await _delete_item(
        settings,
        NOTIFICATOR_NOTIFICATION_CONFIGS_PATH,
        config_id,
        transport=transport,
    )


async def list_teams(
    settings: Settings,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[dict[str, Any]]:
    return await _list_collection(settings, NOTIFICATOR_TEAMS_PATH, transport=transport)


async def get_team(
    settings: Settings,
    team_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _retrieve_item(settings, NOTIFICATOR_TEAMS_PATH, team_id, transport=transport)


async def list_products(
    settings: Settings,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[dict[str, Any]]:
    return await _list_collection(settings, NOTIFICATOR_PRODUCTS_PATH, transport=transport)


async def get_product(
    settings: Settings,
    product_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _retrieve_item(
        settings, NOTIFICATOR_PRODUCTS_PATH, product_id, transport=transport
    )


async def create_product(
    settings: Settings,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _create_item(settings, NOTIFICATOR_PRODUCTS_PATH, body, transport=transport)


async def update_product(
    settings: Settings,
    product_id: int,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _update_item(
        settings,
        "PUT",
        NOTIFICATOR_PRODUCTS_PATH,
        product_id,
        body,
        transport=transport,
    )


async def patch_product(
    settings: Settings,
    product_id: int,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _update_item(
        settings,
        "PATCH",
        NOTIFICATOR_PRODUCTS_PATH,
        product_id,
        body,
        transport=transport,
    )


async def delete_product(
    settings: Settings,
    product_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> None:
    await _delete_item(settings, NOTIFICATOR_PRODUCTS_PATH, product_id, transport=transport)


async def list_sub_products(
    settings: Settings,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[dict[str, Any]]:
    return await _list_collection(settings, NOTIFICATOR_SUB_PRODUCTS_PATH, transport=transport)


async def get_sub_product(
    settings: Settings,
    sub_product_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _retrieve_item(
        settings,
        NOTIFICATOR_SUB_PRODUCTS_PATH,
        sub_product_id,
        transport=transport,
    )


async def create_sub_product(
    settings: Settings,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _create_item(settings, NOTIFICATOR_SUB_PRODUCTS_PATH, body, transport=transport)


async def update_sub_product(
    settings: Settings,
    sub_product_id: int,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _update_item(
        settings,
        "PUT",
        NOTIFICATOR_SUB_PRODUCTS_PATH,
        sub_product_id,
        body,
        transport=transport,
    )


async def patch_sub_product(
    settings: Settings,
    sub_product_id: int,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _update_item(
        settings,
        "PATCH",
        NOTIFICATOR_SUB_PRODUCTS_PATH,
        sub_product_id,
        body,
        transport=transport,
    )


async def delete_sub_product(
    settings: Settings,
    sub_product_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> None:
    await _delete_item(
        settings,
        NOTIFICATOR_SUB_PRODUCTS_PATH,
        sub_product_id,
        transport=transport,
    )


async def list_slack_channels(
    settings: Settings,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[dict[str, Any]]:
    return await _list_collection(settings, NOTIFICATOR_SLACK_CHANNELS_PATH, transport=transport)


async def get_slack_channel(
    settings: Settings,
    channel_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _retrieve_item(
        settings,
        NOTIFICATOR_SLACK_CHANNELS_PATH,
        channel_id,
        transport=transport,
    )


async def create_slack_channel(
    settings: Settings,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _create_item(settings, NOTIFICATOR_SLACK_CHANNELS_PATH, body, transport=transport)


async def update_slack_channel(
    settings: Settings,
    channel_id: int,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _update_item(
        settings,
        "PUT",
        NOTIFICATOR_SLACK_CHANNELS_PATH,
        channel_id,
        body,
        transport=transport,
    )


async def patch_slack_channel(
    settings: Settings,
    channel_id: int,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _update_item(
        settings,
        "PATCH",
        NOTIFICATOR_SLACK_CHANNELS_PATH,
        channel_id,
        body,
        transport=transport,
    )


async def delete_slack_channel(
    settings: Settings,
    channel_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> None:
    await _delete_item(
        settings,
        NOTIFICATOR_SLACK_CHANNELS_PATH,
        channel_id,
        transport=transport,
    )


async def list_users(
    settings: Settings,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[dict[str, Any]]:
    return await _list_collection(settings, NOTIFICATOR_USERS_PATH, transport=transport)


async def get_user(
    settings: Settings,
    user_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _retrieve_item(settings, NOTIFICATOR_USERS_PATH, user_id, transport=transport)


async def list_qaa_members(
    settings: Settings,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[dict[str, Any]]:
    return await _list_collection(settings, NOTIFICATOR_QAA_MEMBERS_PATH, transport=transport)


async def get_qaa_member(
    settings: Settings,
    qaa_member_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _retrieve_item(
        settings,
        NOTIFICATOR_QAA_MEMBERS_PATH,
        qaa_member_id,
        transport=transport,
    )


async def list_failure_mention_rules(
    settings: Settings,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[dict[str, Any]]:
    return await _list_collection(
        settings,
        NOTIFICATOR_FAILURE_MENTION_RULES_PATH,
        transport=transport,
    )


async def get_failure_mention_rule(
    settings: Settings,
    rule_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _retrieve_item(
        settings,
        NOTIFICATOR_FAILURE_MENTION_RULES_PATH,
        rule_id,
        transport=transport,
    )


async def list_events(
    settings: Settings,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[dict[str, Any]]:
    return await _list_collection(settings, NOTIFICATOR_EVENTS_PATH, transport=transport)


async def get_event(
    settings: Settings,
    event_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _retrieve_item(settings, NOTIFICATOR_EVENTS_PATH, event_id, transport=transport)


async def list_recurrent_fails(
    settings: Settings,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[dict[str, Any]]:
    return await _list_collection(settings, NOTIFICATOR_RECURRENT_FAILS_PATH, transport=transport)


async def get_recurrent_fail(
    settings: Settings,
    recurrent_fail_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _retrieve_item(
        settings,
        NOTIFICATOR_RECURRENT_FAILS_PATH,
        recurrent_fail_id,
        transport=transport,
    )


async def list_fail_reasons(
    settings: Settings,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[dict[str, Any]]:
    return await _list_collection(settings, NOTIFICATOR_FAIL_REASONS_PATH, transport=transport)


async def get_fail_reason(
    settings: Settings,
    fail_reason_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _retrieve_item(
        settings,
        NOTIFICATOR_FAIL_REASONS_PATH,
        fail_reason_id,
        transport=transport,
    )


async def list_mute_statuses(
    settings: Settings,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[dict[str, Any]]:
    return await _list_collection(settings, NOTIFICATOR_MUTE_STATUSES_PATH, transport=transport)


async def get_mute_status(
    settings: Settings,
    mute_status_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _retrieve_item(
        settings,
        NOTIFICATOR_MUTE_STATUSES_PATH,
        mute_status_id,
        transport=transport,
    )


async def list_history(
    settings: Settings,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[dict[str, Any]]:
    return await _list_collection(settings, NOTIFICATOR_HISTORY_PATH, transport=transport)


async def get_history_item(
    settings: Settings,
    history_item_id: int,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    return await _retrieve_item(
        settings,
        NOTIFICATOR_HISTORY_PATH,
        history_item_id,
        transport=transport,
    )
