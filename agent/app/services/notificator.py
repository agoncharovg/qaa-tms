"""Notificator REST helpers for the local companion app."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import Settings
from app.core.constants import ErrorMessage, HeaderName, HeaderValue

logger = logging.getLogger(__name__)

NOTIFICATOR_CONFIGS_PATH = "/notification_configs/"


class NotificatorNotConfiguredError(RuntimeError):
    """Raised when the local Notificator settings are incomplete."""


class NotificatorUnreachableError(RuntimeError):
    """Raised when Notificator cannot be queried successfully."""


def require_configured(settings: Settings) -> None:
    """Reject requests when Notificator is not configured locally."""

    if not settings.notificator_configured:
        raise NotificatorNotConfiguredError(ErrorMessage.NOTIFICATOR_NOT_CONFIGURED.value)


async def _send_json(
    settings: Settings,
    method: str,
    path: str,
    *,
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
            response = await client.request(method, url)
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


async def list_notification_configs(
    settings: Settings,
    *,
    product_team: str | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[dict[str, Any]]:
    path = NOTIFICATOR_CONFIGS_PATH
    if product_team:
        query = httpx.QueryParams({"product_team": product_team})
        path = f"{path}?{query}"
    payload = await _send_json(settings, "GET", path, transport=transport)
    return payload if isinstance(payload, list) else []
