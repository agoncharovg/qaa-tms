"""User routes."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AdminUser, CurrentUser, get_db
from app.core.constants import (
    OPTIONAL_PLUGIN_ID_VALUES,
    ApiTag,
    ErrorMessage,
    RoutePath,
)
from app.core.security import hash_password
from app.models.operation import Operation
from app.models.user import User
from app.schemas.user import (
    MePluginsResponse,
    MePluginsUpdateRequest,
    MeUpdateRequest,
    UserCreateRequest,
    UserListResponse,
    UserRead,
    UserUpdateRequest,
    to_me_plugins_response,
    to_user_read,
)

router = APIRouter(tags=[ApiTag.USERS.value])


async def get_user_or_404(db: AsyncSession, user_id: int) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessage.USER_NOT_FOUND.value,
        )
    return user


async def count_admins(db: AsyncSession) -> int:
    admin_count = await db.scalar(
        select(func.count()).select_from(User).where(User.is_admin.is_(True))
    )
    return admin_count or 0


async def ensure_not_last_admin(db: AsyncSession, user: User) -> None:
    if not user.is_admin:
        return
    if await count_admins(db) <= 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=ErrorMessage.LAST_REMAINING_ADMIN_CANNOT_BE_REMOVED.value,
        )


def normalize_enabled_plugins(enabled_plugins: list[str]) -> list[str]:
    provided = set(enabled_plugins)
    invalid = provided.difference(OPTIONAL_PLUGIN_ID_VALUES)
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=ErrorMessage.INVALID_ENABLED_PLUGINS.value,
        )
    return [plugin_id for plugin_id in OPTIONAL_PLUGIN_ID_VALUES if plugin_id in provided]


@router.get(RoutePath.ME.value, response_model=UserRead)
async def get_me(current_user: CurrentUser) -> UserRead:
    return to_user_read(current_user)


@router.patch(RoutePath.ME.value, response_model=UserRead)
async def update_me(
    payload: MeUpdateRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> UserRead:
    provided_fields = payload.model_fields_set

    if "display_name" in provided_fields and payload.display_name is not None:
        current_user.display_name = payload.display_name
    if "auto_login" in provided_fields and payload.auto_login is not None:
        current_user.auto_login = payload.auto_login
    if "password" in provided_fields and payload.password is not None:
        current_user.password_hash = hash_password(payload.password)

    await db.commit()
    await db.refresh(current_user)
    return to_user_read(current_user)


@router.get(RoutePath.ME_PLUGINS.value, response_model=MePluginsResponse)
async def get_my_plugins(current_user: CurrentUser) -> MePluginsResponse:
    return to_me_plugins_response(current_user)


@router.put(RoutePath.ME_PLUGINS.value, response_model=MePluginsResponse)
async def update_my_plugins(
    payload: MePluginsUpdateRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MePluginsResponse:
    current_user.enabled_plugins = normalize_enabled_plugins(payload.enabled_plugins)
    await db.commit()
    await db.refresh(current_user)
    return to_me_plugins_response(current_user)


@router.get(RoutePath.USERS.value, response_model=UserListResponse)
async def list_users(
    _: AdminUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> UserListResponse:
    total = await db.scalar(select(func.count()).select_from(User))
    users = await db.scalars(select(User).order_by(User.id))
    return UserListResponse(
        items=[to_user_read(user) for user in users],
        total=total or 0,
    )


@router.post(
    RoutePath.USERS.value,
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_user(
    payload: UserCreateRequest,
    _: AdminUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> UserRead:
    existing_user = await db.scalar(select(User).where(User.username == payload.username))
    if existing_user is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=ErrorMessage.USERNAME_ALREADY_EXISTS.value,
        )

    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        display_name=payload.display_name,
        is_admin=payload.is_admin,
        auto_login=payload.auto_login,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return to_user_read(user)


@router.get(RoutePath.USER_BY_ID.value, response_model=UserRead)
async def get_user(
    user_id: int,
    _: AdminUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> UserRead:
    user = await get_user_or_404(db, user_id)
    return to_user_read(user)


@router.patch(RoutePath.USER_BY_ID.value, response_model=UserRead)
async def update_user(
    user_id: int,
    payload: UserUpdateRequest,
    current_user: AdminUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> UserRead:
    user = await get_user_or_404(db, user_id)
    provided_fields = payload.model_fields_set

    if user.is_admin and "is_admin" in provided_fields and payload.is_admin is False:
        await ensure_not_last_admin(db, user)

    if user.id == current_user.id and "is_admin" in provided_fields and payload.is_admin is False:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=ErrorMessage.CANNOT_REMOVE_OWN_ADMIN_ACCESS.value,
        )

    if "display_name" in provided_fields and payload.display_name is not None:
        user.display_name = payload.display_name
    if "is_admin" in provided_fields and payload.is_admin is not None:
        user.is_admin = payload.is_admin
    if "auto_login" in provided_fields and payload.auto_login is not None:
        user.auto_login = payload.auto_login
    if "password" in provided_fields and payload.password is not None:
        user.password_hash = hash_password(payload.password)

    await db.commit()
    await db.refresh(user)
    return to_user_read(user)


@router.delete(RoutePath.USER_BY_ID.value, status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    current_user: AdminUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    user = await get_user_or_404(db, user_id)

    await ensure_not_last_admin(db, user)

    if user.id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=ErrorMessage.CANNOT_DELETE_OWN_ACCOUNT.value,
        )

    operation_count = await db.scalar(
        select(func.count()).select_from(Operation).where(Operation.user_id == user.id)
    )
    if (operation_count or 0) > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=ErrorMessage.USER_HAS_RECORDED_OPERATIONS.value,
        )

    await db.delete(user)
    await db.commit()
