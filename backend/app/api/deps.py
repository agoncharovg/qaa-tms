"""Shared FastAPI dependencies."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated, cast

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.constants import AuthScheme, ErrorMessage, HttpHeader, JwtClaim, TokenType
from app.core.security import decode_access_token
from app.models.user import User
from app.services.jenkins_cache import JenkinsCache

bearer_scheme = HTTPBearer(auto_error=False)


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    session_maker = cast(async_sessionmaker[AsyncSession], request.app.state.session_maker)
    async with session_maker() as session:
        yield session


def get_jenkins_cache(request: Request) -> JenkinsCache:
    return cast(JenkinsCache, request.app.state.jenkins_cache)


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
    if not isinstance(username, str):
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
