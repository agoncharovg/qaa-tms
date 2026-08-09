"""Authentication routes."""

from __future__ import annotations

from typing import Annotated, cast

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.core.config import Settings
from app.core.constants import ApiTag, RoutePath, TokenType
from app.core.security import create_access_token, verify_password
from app.models.user import User
from app.schemas.auth import LoginRequest, LoginResponse
from app.schemas.user import UserRead

router = APIRouter(prefix=RoutePath.AUTH.value, tags=[ApiTag.AUTH.value])


@router.post(RoutePath.LOGIN.value, response_model=LoginResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LoginResponse:
    user = await db.scalar(select(User).where(User.username == payload.username))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
        )

    settings = cast(Settings, request.app.state.settings)
    token = create_access_token(user.username, settings)
    return LoginResponse(
        access_token=token,
        token_type=TokenType.BEARER,
        user=UserRead.model_validate(user),
    )
