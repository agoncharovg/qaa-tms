"""Leonid read-only REST helpers for the local companion app."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import Settings
from app.core.constants import ErrorMessage, HeaderName, HeaderValue

logger = logging.getLogger(__name__)


class LeonidNotConfiguredError(RuntimeError):
    """Raised when the local Leonid base URL is missing."""


class LeonidUnreachableError(RuntimeError):
    """Raised when Leonid cannot be queried successfully."""


def require_configured(settings: Settings) -> None:
    """Reject requests when Leonid is not configured locally."""

    if not settings.leonid_configured:
        raise LeonidNotConfiguredError(ErrorMessage.LEONID_NOT_CONFIGURED.value)


async def _get_json(
    settings: Settings,
    path: str,
    *,
    params: dict[str, str] | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
    allow_no_content: bool = False,
) -> dict[str, Any] | None:
    """Fetch a Leonid JSON payload."""

    require_configured(settings)
    url = f"{settings.leonid_url}{path}"
    headers = {HeaderName.ACCEPT.value: HeaderValue.APPLICATION_JSON.value}

    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            headers=headers,
            timeout=settings.leonid_request_timeout,
            transport=transport,
        ) as client:
            response = await client.get(url, params=params)
    except httpx.TimeoutException as exc:
        logger.warning("Leonid request timed out for %s.", path)
        raise LeonidUnreachableError(ErrorMessage.LEONID_UNREACHABLE.value) from exc
    except httpx.HTTPError as exc:
        logger.warning("Leonid request failed for %s: %s.", path, exc.__class__.__name__)
        raise LeonidUnreachableError(ErrorMessage.LEONID_UNREACHABLE.value) from exc

    if response.status_code == httpx.codes.NO_CONTENT and allow_no_content:
        return None

    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        logger.warning("Leonid returned HTTP %s for %s.", response.status_code, path)
        raise LeonidUnreachableError(ErrorMessage.LEONID_UNREACHABLE.value) from exc

    payload = response.json()
    if not isinstance(payload, dict):
        logger.warning("Leonid returned a non-object payload for %s.", path)
        raise LeonidUnreachableError(ErrorMessage.LEONID_UNREACHABLE.value)

    return payload


async def fetch_status(
    settings: Settings,
    product: str,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any] | None:
    """Fetch deploy gate status for a Leonid product."""

    normalized_product = product.strip().lower()
    return await _get_json(
        settings,
        f"/api/{normalized_product}/status/",
        allow_no_content=True,
        transport=transport,
    )


async def fetch_report(
    settings: Settings,
    product: str,
    start_date: str,
    end_date: str,
    environment: str | None,
    test_type: str | None,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    """Fetch the Leonid report summary for a product and date range."""

    normalized_product = product.strip().lower()
    params = {
        "start_date": start_date,
        "end_date": end_date,
    }
    if environment:
        params["environment"] = environment
    if test_type:
        params["test_type"] = test_type

    payload = await _get_json(
        settings,
        f"/api/report/{normalized_product}/summary/",
        params=params,
        transport=transport,
    )
    if payload is None:
        raise LeonidUnreachableError(ErrorMessage.LEONID_UNREACHABLE.value)
    return payload
