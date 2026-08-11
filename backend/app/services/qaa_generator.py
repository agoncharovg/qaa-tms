"""Outbound qaa-generator proxy helpers."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

import httpx
from fastapi import HTTPException, status

from app.core.config import Settings
from app.core.constants import AuthScheme, HttpHeader, MediaType
from app.models.user import User


class QaaGeneratorTokenMode(StrEnum):
    SERVICE = "service"
    SUPERUSER = "superuser"


class QaaGeneratorServicePath(StrEnum):
    RUNS = "/runs"
    RUN_BY_ID = "/runs/{run_id}"
    USERS = "/users"
    USER_BY_ID = "/users/{user_id}"
    SERVICE_TOKENS = "/service-tokens"
    SERVICE_TOKEN_BY_ID = "/service-tokens/{token_id}"


class QaaGeneratorProxyMessage(StrEnum):
    INVALID_RESPONSE = "The qaa-generator service returned an invalid response."
    NETWORK_ERROR = "Cannot reach the qaa-generator service."
    SERVICE_TOKEN_REJECTED = "QAA Generator rejected the configured service token."
    SUPERUSER_TOKEN_NOT_CONFIGURED = "qaa-generator superuser token not configured"
    SUPERUSER_TOKEN_REJECTED = "superuser token rejected by qaa-generator"
    UPSTREAM_ERROR = "The qaa-generator service request failed."


class QaaGeneratorPayloadField(StrEnum):
    DETAIL = "detail"
    ERROR = "error"
    MESSAGE = "message"


QAA_GENERATOR_EMAIL_ACTOR_PREFIX = "email:"
QAA_GENERATOR_EMAIL_GUARD = "@"
PASSTHROUGH_STATUS_CODES = frozenset({status.HTTP_409_CONFLICT})


@dataclass(frozen=True)
class QaaGeneratorJsonResponse:
    payload: Any
    status_code: int


def build_qaa_run_path(run_id: str) -> str:
    return QaaGeneratorServicePath.RUN_BY_ID.value.format(run_id=run_id)


def build_qaa_run_artifacts_path(run_id: str, suffix: str) -> str:
    return f"{build_qaa_run_path(run_id)}{suffix}"


def build_qaa_user_path(user_id: str) -> str:
    return QaaGeneratorServicePath.USER_BY_ID.value.format(user_id=user_id)


def build_qaa_user_token_regenerate_path(user_id: str, suffix: str) -> str:
    return f"{build_qaa_user_path(user_id)}{suffix}"


def build_qaa_service_token_revoke_path(token_id: str, suffix: str) -> str:
    return f"{QaaGeneratorServicePath.SERVICE_TOKEN_BY_ID.value.format(token_id=token_id)}{suffix}"


def resolve_actor_value(settings: Settings, user: User) -> str | None:
    if QAA_GENERATOR_EMAIL_GUARD in user.username:
        return f"{QAA_GENERATOR_EMAIL_ACTOR_PREFIX}{user.username}"

    actor = settings.qaa_generator_actor.strip()
    return actor or None


def resolve_token_value(settings: Settings, token_mode: QaaGeneratorTokenMode) -> str:
    if token_mode is QaaGeneratorTokenMode.SUPERUSER:
        token = settings.qaa_generator_superuser_token.strip()
        if not token:
            raise HTTPException(
                status_code=status.HTTP_501_NOT_IMPLEMENTED,
                detail=QaaGeneratorProxyMessage.SUPERUSER_TOKEN_NOT_CONFIGURED.value,
            )
        return token

    return settings.qaa_generator_service_token


def build_outbound_headers(
    settings: Settings,
    *,
    accept: MediaType,
    token_mode: QaaGeneratorTokenMode,
    user: User | None = None,
    content_type: MediaType | None = None,
    idempotency_key: str | None = None,
    last_event_id: str | None = None,
) -> dict[str, str]:
    headers = {
        HttpHeader.ACCEPT.value: accept.value,
        HttpHeader.AUTHORIZATION.value: (
            f"{AuthScheme.BEARER.value} {resolve_token_value(settings, token_mode)}"
        ),
    }
    actor = resolve_actor_value(settings, user) if user is not None else None
    if actor is not None and token_mode is QaaGeneratorTokenMode.SERVICE:
        headers[HttpHeader.ACTOR.value] = actor
    if content_type is not None:
        headers[HttpHeader.CONTENT_TYPE.value] = content_type.value
    if idempotency_key:
        headers[HttpHeader.IDEMPOTENCY_KEY.value] = idempotency_key
    if last_event_id:
        headers[HttpHeader.LAST_EVENT_ID.value] = last_event_id
    return headers


def extract_error_message(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None

    detail = payload.get(QaaGeneratorPayloadField.DETAIL.value)
    if isinstance(detail, str):
        return detail

    error = payload.get(QaaGeneratorPayloadField.ERROR.value)
    if isinstance(error, str):
        return error
    if isinstance(error, dict):
        message = error.get(QaaGeneratorPayloadField.MESSAGE.value)
        if isinstance(message, str):
            return message
    return None


async def read_json_payload(response: httpx.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        text = response.text.strip()
        if text:
            return {
                QaaGeneratorPayloadField.DETAIL.value: text,
            }
        return {}


def map_upstream_status(
    response: httpx.Response,
    payload: Any,
    *,
    token_mode: QaaGeneratorTokenMode,
) -> HTTPException:
    message = extract_error_message(payload)
    if token_mode is QaaGeneratorTokenMode.SUPERUSER and response.status_code in {
        status.HTTP_401_UNAUTHORIZED,
        status.HTTP_403_FORBIDDEN,
    }:
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=QaaGeneratorProxyMessage.SUPERUSER_TOKEN_REJECTED.value,
        )
    if response.status_code == status.HTTP_401_UNAUTHORIZED:
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=message or QaaGeneratorProxyMessage.SERVICE_TOKEN_REJECTED.value,
        )
    if response.status_code >= status.HTTP_500_INTERNAL_SERVER_ERROR:
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=message or QaaGeneratorProxyMessage.UPSTREAM_ERROR.value,
        )
    return HTTPException(
        status_code=response.status_code,
        detail=message or QaaGeneratorProxyMessage.UPSTREAM_ERROR.value,
    )


async def request_json(
    client: httpx.AsyncClient,
    *,
    method: str,
    path: str,
    headers: dict[str, str],
    token_mode: QaaGeneratorTokenMode,
    params: Sequence[tuple[str, str | int | float | bool | None]] | None = None,
    json_body: dict[str, Any] | None = None,
    passthrough_status_codes: frozenset[int] = PASSTHROUGH_STATUS_CODES,
) -> QaaGeneratorJsonResponse:
    serialized_params = tuple(params) if params is not None else None
    try:
        response = await client.request(
            method=method,
            url=path,
            headers=headers,
            params=serialized_params,
            json=json_body,
        )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=QaaGeneratorProxyMessage.NETWORK_ERROR.value,
        ) from exc

    payload = await read_json_payload(response)
    if response.status_code in passthrough_status_codes or response.is_success:
        return QaaGeneratorJsonResponse(payload=payload, status_code=response.status_code)

    raise map_upstream_status(response, payload, token_mode=token_mode)


async def open_event_stream(
    client: httpx.AsyncClient,
    *,
    path: str,
    headers: dict[str, str],
    token_mode: QaaGeneratorTokenMode,
) -> httpx.Response:
    request = client.build_request("GET", path, headers=headers)
    try:
        response = await client.send(request, stream=True)
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=QaaGeneratorProxyMessage.NETWORK_ERROR.value,
        ) from exc

    if response.is_success:
        return response

    payload = await read_json_payload(response)
    await response.aclose()
    raise map_upstream_status(response, payload, token_mode=token_mode)
