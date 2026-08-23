"""User routes."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, get_db, require_permission
from app.core.constants import (
    OPTIONAL_PLUGIN_ID_VALUES,
    ApiTag,
    ErrorMessage,
    PermissionKey,
    RoutePath,
)
from app.core.security import hash_password
from app.models.operation import Operation
from app.models.security_group import SecurityGroupPermission
from app.models.security_permission import SecurityPermission
from app.models.security_role import SecurityRole, SecurityRolePermission
from app.models.user import User
from app.models.user_extra_permission import UserExtraPermission
from app.schemas.user import (
    MePluginsResponse,
    MePluginsUpdateRequest,
    MeRead,
    MeUpdateRequest,
    UserCreateRequest,
    UserListResponse,
    UserPermissionAddRequest,
    UserPermissionsResponse,
    UserRead,
    UserUpdateRequest,
    to_me_plugins_response,
    to_me_read,
    to_user_read,
)
from app.services.security_audit import (
    SecurityEventType,
    SecurityTargetType,
    write_security_event,
)

router = APIRouter(tags=[ApiTag.USERS.value])

UsersReadUser = Annotated[User, Depends(require_permission(PermissionKey.USERS_READ))]
UsersManageUser = Annotated[User, Depends(require_permission(PermissionKey.USERS_MANAGE))]

PERMISSION_NOT_FOUND = "Permission not found."
PERMISSION_ALREADY_INHERITED = (
    "This permission is already inherited via role or group"
    " and cannot be added as an individual permission."
)
PERMISSION_IS_INHERITED = (
    "This permission is inherited via role or group and cannot be removed individually."
)
PERMISSION_NOT_EXTRA = "This individual permission was not found for this user."
USER_ROLE_NOT_FOUND = "Security role not found."
USER_GROUP_NOT_FOUND = "Security group not found."


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


async def get_inherited_permission_keys(db: AsyncSession, user: User) -> frozenset[str]:
    inherited: set[str] = set()
    if user.role_id is not None:
        rows = await db.scalars(
            select(SecurityPermission.key)
            .join(
                SecurityRolePermission,
                SecurityRolePermission.permission_id == SecurityPermission.id,
            )
            .where(SecurityRolePermission.role_id == user.role_id)
        )
        inherited.update(rows)
    if user.group_id is not None:
        rows = await db.scalars(
            select(SecurityPermission.key)
            .join(
                SecurityGroupPermission,
                SecurityGroupPermission.permission_id == SecurityPermission.id,
            )
            .where(SecurityGroupPermission.group_id == user.group_id)
        )
        inherited.update(rows)
    return frozenset(inherited)


async def get_extra_permission_keys(db: AsyncSession, user: User) -> frozenset[str]:
    rows = await db.scalars(
        select(SecurityPermission.key)
        .join(UserExtraPermission, UserExtraPermission.permission_id == SecurityPermission.id)
        .where(UserExtraPermission.user_id == user.id)
    )
    return frozenset(rows)


@router.get(RoutePath.ME.value, response_model=MeRead)
async def get_me(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MeRead:
    user = await db.scalar(
        select(User)
        .options(selectinload(User.role), selectinload(User.group))
        .where(User.id == current_user.id)
    )
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessage.USER_NOT_FOUND.value,
        )
    return await to_me_read(user, db)


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
    _: UsersReadUser,
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
    _: UsersManageUser,
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
    _: UsersReadUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> UserRead:
    user = await get_user_or_404(db, user_id)
    return to_user_read(user)


@router.patch(RoutePath.USER_BY_ID.value, response_model=UserRead)
async def update_user(
    user_id: int,
    payload: UserUpdateRequest,
    current_user: UsersManageUser,
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

    if "role_id" in provided_fields:
        if payload.role_id is not None:
            role = await db.get(SecurityRole, payload.role_id)
            if role is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=USER_ROLE_NOT_FOUND,
                )
        user.role_id = payload.role_id
        write_security_event(
            db,
            actor_user_id=current_user.id,
            event_type=SecurityEventType.USER_ROLE_CHANGED,
            target_type=SecurityTargetType.USER,
            target_id=str(user.id),
            payload={"role_id": payload.role_id},
        )

    if "group_id" in provided_fields:
        user.group_id = payload.group_id
        write_security_event(
            db,
            actor_user_id=current_user.id,
            event_type=SecurityEventType.USER_GROUP_CHANGED,
            target_type=SecurityTargetType.USER,
            target_id=str(user.id),
            payload={"group_id": payload.group_id},
        )

    await db.commit()
    await db.refresh(user)
    return to_user_read(user)


@router.delete(RoutePath.USER_BY_ID.value, status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    current_user: UsersManageUser,
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


@router.get(RoutePath.USER_PERMISSIONS.value, response_model=UserPermissionsResponse)
async def get_user_permissions(
    user_id: int,
    _: UsersReadUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> UserPermissionsResponse:
    user = await get_user_or_404(db, user_id)
    inherited = await get_inherited_permission_keys(db, user)
    extra = await get_extra_permission_keys(db, user)
    effective = inherited | extra
    return UserPermissionsResponse(
        inherited=sorted(inherited),
        extra=sorted(extra),
        effective=sorted(effective),
    )


@router.post(
    RoutePath.USER_PERMISSIONS.value,
    status_code=status.HTTP_201_CREATED,
)
async def add_user_permission(
    user_id: int,
    payload: UserPermissionAddRequest,
    current_user: UsersManageUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, str]:
    user = await get_user_or_404(db, user_id)
    inherited = await get_inherited_permission_keys(db, user)
    if payload.permission_key.value in inherited:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=PERMISSION_ALREADY_INHERITED,
        )

    permission = await db.scalar(
        select(SecurityPermission).where(SecurityPermission.key == payload.permission_key.value)
    )
    if permission is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=PERMISSION_NOT_FOUND,
        )

    existing = await db.scalar(
        select(UserExtraPermission).where(
            UserExtraPermission.user_id == user_id,
            UserExtraPermission.permission_id == permission.id,
        )
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=PERMISSION_ALREADY_INHERITED,
        )

    db.add(
        UserExtraPermission(
            user_id=user_id,
            permission_id=permission.id,
            granted_by_id=current_user.id,
        )
    )
    write_security_event(
        db,
        actor_user_id=current_user.id,
        event_type=SecurityEventType.USER_EXTRA_PERMISSION_ADDED,
        target_type=SecurityTargetType.USER,
        target_id=str(user_id),
        payload={"permission_key": payload.permission_key.value},
    )
    await db.commit()
    return {"permission_key": payload.permission_key.value}


@router.delete(
    RoutePath.USER_PERMISSION_BY_KEY.value,
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_user_permission(
    user_id: int,
    permission_key: str,
    current_user: UsersManageUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    user = await get_user_or_404(db, user_id)
    inherited = await get_inherited_permission_keys(db, user)
    if permission_key in inherited:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=PERMISSION_IS_INHERITED,
        )

    permission = await db.scalar(
        select(SecurityPermission).where(SecurityPermission.key == permission_key)
    )
    if permission is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=PERMISSION_NOT_FOUND,
        )

    extra_perm = await db.scalar(
        select(UserExtraPermission).where(
            UserExtraPermission.user_id == user_id,
            UserExtraPermission.permission_id == permission.id,
        )
    )
    if extra_perm is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=PERMISSION_NOT_EXTRA,
        )

    await db.delete(extra_perm)
    write_security_event(
        db,
        actor_user_id=current_user.id,
        event_type=SecurityEventType.USER_EXTRA_PERMISSION_REMOVED,
        target_type=SecurityTargetType.USER,
        target_id=str(user_id),
        payload={"permission_key": permission_key},
    )
    await db.commit()
