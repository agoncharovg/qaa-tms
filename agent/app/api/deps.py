"""Route dependencies."""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated, Any, cast

import httpx
from fastapi import Depends, HTTPException, Request, status

from app.core.config import Settings
from app.core.constants import (
    DEFAULT_AUTH_CACHE_TTL_SECONDS,
    BackendPath,
    ErrorMessage,
    HeaderName,
    HeaderValue,
    PermissionKey,
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


def _build_auth_headers(token: str) -> dict[str, str]:
    return {
        HeaderName.ACCEPT.value: HeaderValue.APPLICATION_JSON.value,
        HeaderName.AUTHORIZATION.value: f"{HeaderValue.BEARER.value} {token}",
        HeaderName.X_QAA_TMS.value: HeaderValue.X_QAA_TMS_ENABLED.value,
    }


async def require_auth(request: Request) -> AuthContext:
    token = _extract_bearer_token(request)
    cached = _read_cached_identity(request, token)
    if cached is not None:
        return AuthContext(token=token, identity=cached)

    backend_client: httpx.AsyncClient = request.app.state.backend_client
    try:
        response = await backend_client.get(
            BackendPath.ME.value, headers=_build_auth_headers(token)
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ErrorMessage.UNAUTHORIZED.value,
        ) from exc

    if response.status_code != status.HTTP_200_OK:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ErrorMessage.UNAUTHORIZED.value,
        )

    identity = response.json()
    if not isinstance(identity, dict):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ErrorMessage.UNAUTHORIZED.value,
        )

    _write_cached_identity(request, token, identity)
    return AuthContext(token=token, identity=identity)


async def authorize_permission(
    request: Request,
    auth: AuthContext,
    permission: PermissionKey,
) -> AuthContext:
    backend_client: httpx.AsyncClient = request.app.state.backend_client
    payload = {"checks": [{"permission": permission.value}]}
    try:
        response = await backend_client.post(
            BackendPath.AUTHZ_CHECK.value,
            headers=_build_auth_headers(auth.token),
            json=payload,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=ErrorMessage.AUTHORIZATION_UNAVAILABLE.value,
        ) from exc

    if response.status_code == status.HTTP_401_UNAUTHORIZED:
        _clear_cached_identity(request, auth.token)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ErrorMessage.UNAUTHORIZED.value,
        )
    if response.status_code != status.HTTP_200_OK:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=ErrorMessage.AUTHORIZATION_UNAVAILABLE.value,
        )

    try:
        data = response.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=ErrorMessage.AUTHORIZATION_UNAVAILABLE.value,
        ) from exc

    results = data.get("results") if isinstance(data, dict) else None
    if not isinstance(results, list) or len(results) != 1:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=ErrorMessage.AUTHORIZATION_UNAVAILABLE.value,
        )
    if results[0].get("allowed") is not True:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ErrorMessage.PERMISSION_DENIED.value,
        )
    return auth


def require_permission(
    permission: PermissionKey,
) -> Callable[..., Awaitable[AuthContext]]:
    async def dependency(
        request: Request,
        auth: Annotated[AuthContext, Depends(require_auth)],
    ) -> AuthContext:
        return await authorize_permission(request, auth, permission)

    return dependency


def _extract_bearer_token(request: Request) -> str:
    header = request.headers.get(HeaderName.AUTHORIZATION.value, "")
    scheme, _, token = header.partition(" ")
    if scheme != HeaderValue.BEARER.value or not token.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ErrorMessage.UNAUTHORIZED.value,
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


def _clear_cached_identity(request: Request, token: str) -> None:
    cache: dict[str, CachedIdentity] = request.app.state.auth_cache
    cache.pop(token, None)
