"""Authentication routes."""

from __future__ import annotations

import time
from typing import Annotated, cast

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db
from app.core.config import Settings
from app.core.constants import (
    ApiTag,
    AuthLoginEventReason,
    ErrorMessage,
    RoutePath,
    TokenType,
)
from app.core.security import (
    create_access_token,
    is_empty_password_hash,
    maybe_upgrade_password_hash,
    verify_password,
)
from app.models.auth_login_event import AuthLoginEvent
from app.models.user import User
from app.schemas.auth import LoginRequest, LoginResponse
from app.schemas.user import to_user_read

router = APIRouter(prefix=RoutePath.AUTH.value, tags=[ApiTag.AUTH.value])


def login_attempt_key(username: str, remote_addr: str | None) -> str:
    return f"{username.strip().lower()}|{remote_addr or ''}"


def prune_login_attempts(
    attempts_by_key: dict[str, list[float]],
    key: str,
    now: float,
    window_seconds: int,
) -> list[float]:
    attempts = [
        attempt for attempt in attempts_by_key.get(key, []) if now - attempt < window_seconds
    ]
    if attempts:
        attempts_by_key[key] = attempts
    else:
        attempts_by_key.pop(key, None)
    return attempts


def is_login_rate_limited(
    request: Request,
    settings: Settings,
    username: str,
    remote_addr: str | None,
) -> bool:
    attempts_by_key = cast(dict[str, list[float]], request.app.state.login_attempts)
    attempts = prune_login_attempts(
        attempts_by_key,
        login_attempt_key(username, remote_addr),
        time.monotonic(),
        settings.auth_login_window_seconds,
    )
    return len(attempts) >= settings.auth_login_max_attempts


def record_failed_login_attempt(
    request: Request,
    settings: Settings,
    username: str,
    remote_addr: str | None,
) -> None:
    attempts_by_key = cast(dict[str, list[float]], request.app.state.login_attempts)
    key = login_attempt_key(username, remote_addr)
    attempts = prune_login_attempts(
        attempts_by_key,
        key,
        time.monotonic(),
        settings.auth_login_window_seconds,
    )
    attempts.append(time.monotonic())
    attempts_by_key[key] = attempts


def clear_failed_login_attempts(request: Request, username: str, remote_addr: str | None) -> None:
    attempts_by_key = cast(dict[str, list[float]], request.app.state.login_attempts)
    attempts_by_key.pop(login_attempt_key(username, remote_addr), None)


def build_login_event(
    username: str,
    user: User | None,
    success: bool,
    reason: AuthLoginEventReason,
    remote_addr: str | None,
    user_agent: str | None,
) -> AuthLoginEvent:
    return AuthLoginEvent(
        username=username,
        user_id=user.id if user is not None else None,
        success=success,
        reason=reason.value,
        remote_addr=remote_addr,
        user_agent=user_agent,
    )


@router.post(RoutePath.LOGIN.value, response_model=LoginResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LoginResponse:
    settings = cast(Settings, request.app.state.settings)
    remote_addr = request.client.host if request.client is not None else None
    user_agent = request.headers.get("user-agent")
    user = await db.scalar(
        select(User)
        .options(selectinload(User.role), selectinload(User.group))
        .where(User.username == payload.username)
    )

    if is_login_rate_limited(request, settings, payload.username, remote_addr):
        db.add(
            build_login_event(
                payload.username,
                user,
                success=False,
                reason=AuthLoginEventReason.RATE_LIMITED,
                remote_addr=remote_addr,
                user_agent=user_agent,
            )
        )
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=ErrorMessage.LOGIN_RATE_LIMIT_EXCEEDED.value,
        )

    if user is None or not verify_password(payload.password, user.password_hash):
        record_failed_login_attempt(request, settings, payload.username, remote_addr)
        db.add(
            build_login_event(
                payload.username,
                user,
                success=False,
                reason=AuthLoginEventReason.INVALID_CREDENTIALS,
                remote_addr=remote_addr,
                user_agent=user_agent,
            )
        )
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ErrorMessage.INVALID_USERNAME_OR_PASSWORD.value,
        )

    if not settings.is_development and is_empty_password_hash(user.password_hash):
        record_failed_login_attempt(request, settings, payload.username, remote_addr)
        db.add(
            build_login_event(
                payload.username,
                user,
                success=False,
                reason=AuthLoginEventReason.EMPTY_PASSWORD_DISABLED,
                remote_addr=remote_addr,
                user_agent=user_agent,
            )
        )
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ErrorMessage.INVALID_USERNAME_OR_PASSWORD.value,
        )

    upgraded_hash = maybe_upgrade_password_hash(payload.password, user.password_hash)
    if upgraded_hash is not None:
        user.password_hash = upgraded_hash

    clear_failed_login_attempts(request, payload.username, remote_addr)
    db.add(
        build_login_event(
            payload.username,
            user,
            success=True,
            reason=AuthLoginEventReason.SUCCESS,
            remote_addr=remote_addr,
            user_agent=user_agent,
        )
    )
    await db.commit()

    token = create_access_token(user.username, settings, user.session_version)
    return LoginResponse(
        access_token=token,
        token_type=TokenType.BEARER,
        user=to_user_read(user),
    )
