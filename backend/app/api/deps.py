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
from app.core.constants import JwtClaim, TokenType
from app.core.security import decode_access_token
from app.models.user import User

bearer_scheme = HTTPBearer(auto_error=False)


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    session_maker = cast(async_sessionmaker[AsyncSession], request.app.state.session_maker)
    async with session_maker() as session:
        yield session


async def get_current_user(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> User:
    if credentials is None or credentials.scheme.lower() != TokenType.BEARER.value:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated.",
            headers={"WWW-Authenticate": TokenType.BEARER.value.capitalize()},
        )

    settings = cast(Settings, request.app.state.settings)

    try:
        payload = decode_access_token(credentials.credentials, settings)
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials.",
            headers={"WWW-Authenticate": TokenType.BEARER.value.capitalize()},
        ) from exc

    username = payload.get(JwtClaim.SUBJECT.value)
    if not isinstance(username, str):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials.",
            headers={"WWW-Authenticate": TokenType.BEARER.value.capitalize()},
        )

    user = await db.scalar(select(User).where(User.username == username))
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found.",
            headers={"WWW-Authenticate": TokenType.BEARER.value.capitalize()},
        )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
