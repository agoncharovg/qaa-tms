"""Best-effort audit push to the central backend."""

from __future__ import annotations

import logging
from collections.abc import Mapping
from datetime import datetime
from typing import Any
from uuid import UUID

import httpx

from app.core.constants import (
    BackendPath,
    HeaderName,
    HeaderValue,
    OperationStatus,
    OperationType,
)
from app.services.staging import get_agent_host_name, get_agent_version

logger = logging.getLogger(__name__)


def build_operation_payload(
    *,
    op_id: UUID,
    type: OperationType,
    ns: str | None,
    recipe: Mapping[str, Any],
    status: OperationStatus,
    started_at: datetime,
    finished_at: datetime | None,
    log: str | None,
    exit_code: int | None,
    stagings_sha: str | None,
) -> dict[str, Any]:
    """Build a payload that matches backend `OperationUpsertRequest`."""

    payload: dict[str, Any] = {
        "id": str(op_id),
        "type": type.value,
        "ns": ns,
        "recipe": dict(recipe),
        "status": status.value,
        "started_at": started_at.isoformat(),
        "agent_host": get_agent_host_name(),
        "agent_version": get_agent_version(),
        "stagings_sha": stagings_sha,
    }
    if finished_at is not None:
        payload["finished_at"] = finished_at.isoformat()
    if log is not None:
        payload["log"] = log
    if exit_code is not None:
        payload["exit_code"] = exit_code
    return payload


async def push_operation(
    *,
    client: httpx.AsyncClient,
    token: str,
    payload: Mapping[str, Any],
) -> None:
    """Push an operation audit record without failing the local job."""

    headers = {
        HeaderName.ACCEPT.value: HeaderValue.APPLICATION_JSON.value,
        HeaderName.CONTENT_TYPE.value: HeaderValue.APPLICATION_JSON.value,
        HeaderName.AUTHORIZATION.value: f"{HeaderValue.BEARER.value} {token}",
        HeaderName.X_QAA_TMS.value: HeaderValue.X_QAA_TMS_ENABLED.value,
    }
    try:
        response = await client.post(
            BackendPath.OPERATIONS.value,
            headers=headers,
            json=dict(payload),
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("Audit push failed: %s", exc)
