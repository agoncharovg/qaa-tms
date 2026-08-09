"""Route dependencies."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, cast

import httpx
from fastapi import HTTPException, Request, status

from app.core.config import Settings
from app.core.constants import (
    DEFAULT_AUTH_CACHE_TTL_SECONDS,
    BackendPath,
    HeaderName,
    HeaderValue,
)
from app.services.jobs import JobManager


@dataclass(slots=True)
class AuthContext:
    """Validated auth context."""

    token: str
    identity: dict[str, Any]


@dataclass(slots=True)
class CachedIdentity:
    """Cached `/me` result for a bearer token."""

    expires_at: float
    identity: dict[str, Any]


def get_settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


def get_job_manager(request: Request) -> JobManager:
    return cast(JobManager, request.app.state.job_manager)


async def require_auth(request: Request) -> AuthContext:
    token = _extract_bearer_token(request)
    cached = _read_cached_identity(request, token)
    if cached is not None:
        return AuthContext(token=token, identity=cached)

    backend_client: httpx.AsyncClient = request.app.state.backend_client
    headers = {
        HeaderName.ACCEPT.value: HeaderValue.APPLICATION_JSON.value,
        HeaderName.AUTHORIZATION.value: f"{HeaderValue.BEARER.value} {token}",
        HeaderName.X_QAA_TMS.value: HeaderValue.X_QAA_TMS_ENABLED.value,
    }
    try:
        response = await backend_client.get(BackendPath.ME.value, headers=headers)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized.",
        ) from exc

    if response.status_code != status.HTTP_200_OK:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized.")

    identity = response.json()
    if not isinstance(identity, dict):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized.")

    _write_cached_identity(request, token, identity)
    return AuthContext(token=token, identity=identity)


def _extract_bearer_token(request: Request) -> str:
    header = request.headers.get(HeaderName.AUTHORIZATION.value, "")
    scheme, _, token = header.partition(" ")
    if scheme != HeaderValue.BEARER.value or not token.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized.",
        )
    return token.strip()


def _read_cached_identity(request: Request, token: str) -> dict[str, Any] | None:
    cache: dict[str, CachedIdentity] = request.app.state.auth_cache
    cached = cache.get(token)
    if cached is None or cached.expires_at < time.monotonic():
        if cached is not None:
            cache.pop(token, None)
        return None
    return cached.identity


def _write_cached_identity(
    request: Request,
    token: str,
    identity: dict[str, Any],
) -> None:
    cache: dict[str, CachedIdentity] = request.app.state.auth_cache
    cache[token] = CachedIdentity(
        expires_at=time.monotonic() + DEFAULT_AUTH_CACHE_TTL_SECONDS,
        identity=identity,
    )
