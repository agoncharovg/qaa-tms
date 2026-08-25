"""Shared FastAPI dependencies."""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Annotated, cast

import httpx
import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.constants import (
    AuthScheme,
    ErrorMessage,
    HttpHeader,
    JwtClaim,
    PermissionKey,
    TokenType,
)
from app.core.security import decode_access_token
from app.models.user import User
from app.services.authorization import has_permission
from app.services.jenkins_cache import JenkinsCache
from app.services.leonid_client import LeonidClient
from app.services.notificator_client import NotificatorClient

bearer_scheme = HTTPBearer(auto_error=False)


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    session_maker = cast(async_sessionmaker[AsyncSession], request.app.state.session_maker)
    async with session_maker() as session:
        yield session


def get_jenkins_cache(request: Request) -> JenkinsCache:
    return cast(JenkinsCache, request.app.state.jenkins_cache)


def get_leonid_http_client(request: Request) -> httpx.AsyncClient:
    return cast(httpx.AsyncClient, request.app.state.leonid_http_client)


def get_leonid_client(request: Request) -> LeonidClient:
    return LeonidClient(get_settings(request), get_leonid_http_client(request))


def get_notificator_http_client(request: Request) -> httpx.AsyncClient:
    return cast(httpx.AsyncClient, request.app.state.notificator_http_client)


def get_notificator_client(request: Request) -> NotificatorClient:
    return NotificatorClient(get_settings(request), get_notificator_http_client(request))


def get_settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


async def get_current_user(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> User:
    if credentials is None or credentials.scheme.lower() != TokenType.BEARER.value:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ErrorMessage.NOT_AUTHENTICATED.value,
            headers={HttpHeader.WWW_AUTHENTICATE.value: AuthScheme.BEARER.value},
        )

    settings = cast(Settings, request.app.state.settings)

    try:
        payload = decode_access_token(credentials.credentials, settings)
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ErrorMessage.INVALID_AUTHENTICATION_CREDENTIALS.value,
            headers={HttpHeader.WWW_AUTHENTICATE.value: AuthScheme.BEARER.value},
        ) from exc

    username = payload.get(JwtClaim.SUBJECT.value)
    session_version = payload.get(JwtClaim.SESSION_VERSION.value)
    if not isinstance(username, str) or not isinstance(session_version, int):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ErrorMessage.INVALID_AUTHENTICATION_CREDENTIALS.value,
            headers={HttpHeader.WWW_AUTHENTICATE.value: AuthScheme.BEARER.value},
        )

    user = await db.scalar(select(User).where(User.username == username))
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ErrorMessage.USER_NOT_FOUND.value,
            headers={HttpHeader.WWW_AUTHENTICATE.value: AuthScheme.BEARER.value},
        )
    if user.session_version != session_version:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ErrorMessage.SESSION_NO_LONGER_VALID.value,
            headers={HttpHeader.WWW_AUTHENTICATE.value: AuthScheme.BEARER.value},
        )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def get_current_admin(current_user: CurrentUser) -> User:
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ErrorMessage.ADMIN_ACCESS_REQUIRED.value,
        )
    return current_user


AdminUser = Annotated[User, Depends(get_current_admin)]


def require_permission(permission: PermissionKey) -> Callable[..., Awaitable[User]]:
    async def dependency(
        current_user: CurrentUser,
        db: Annotated[AsyncSession, Depends(get_db)],
    ) -> User:
        if not await has_permission(current_user, permission, db):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=ErrorMessage.PERMISSION_DENIED.value,
            )
        return current_user

    return dependency
