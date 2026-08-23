"""User schemas."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict

from app.core.constants import PermissionKey, resolve_enabled_plugins

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.models.user import User


class RoleSummary(BaseModel):
    id: int
    key: str | None
    display_name: str


class GroupSummary(BaseModel):
    id: int
    key: str | None
    display_name: str


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    display_name: str
    is_admin: bool
    auto_login: bool
    enabled_plugins: list[str]
    role_id: int | None = None
    group_id: int | None = None
    created_at: datetime
    updated_at: datetime


class MeRead(UserRead):
    role: RoleSummary | None = None
    group: GroupSummary | None = None
    effective_permissions: list[str] = []


class MePluginsUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled_plugins: list[str]


class MePluginsResponse(BaseModel):
    enabled_plugins: list[str]


class MeUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: str | None = None
    password: str | None = None
    auto_login: bool | None = None


class UserCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str
    password: str
    display_name: str
    is_admin: bool = False
    auto_login: bool = False


class UserUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: str | None = None
    is_admin: bool | None = None
    auto_login: bool | None = None
    password: str | None = None
    role_id: int | None = None
    group_id: int | None = None


class UserListResponse(BaseModel):
    items: list[UserRead]
    total: int


class UserPermissionsResponse(BaseModel):
    inherited: list[str]
    extra: list[str]
    effective: list[str]


class UserPermissionAddRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    permission_key: PermissionKey


def to_user_read(user: User) -> UserRead:
    return UserRead(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        is_admin=user.is_admin,
        auto_login=user.auto_login,
        enabled_plugins=resolve_enabled_plugins(user.enabled_plugins),
        role_id=user.role_id,
        group_id=user.group_id,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


async def to_me_read(user: User, db: AsyncSession) -> MeRead:
    from app.services.authorization import resolve_permissions

    effective = await resolve_permissions(user, db)
    role_summary = None
    if user.role is not None:
        role_summary = RoleSummary(
            id=user.role.id,
            key=user.role.key,
            display_name=user.role.display_name,
        )
    group_summary = None
    if user.group is not None:
        group_summary = GroupSummary(
            id=user.group.id,
            key=user.group.key,
            display_name=user.group.display_name,
        )
    return MeRead(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        is_admin=user.is_admin,
        auto_login=user.auto_login,
        enabled_plugins=resolve_enabled_plugins(user.enabled_plugins),
        role_id=user.role_id,
        group_id=user.group_id,
        role=role_summary,
        group=group_summary,
        effective_permissions=sorted(str(p) for p in effective),
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


def to_me_plugins_response(user: User) -> MePluginsResponse:
    return MePluginsResponse(enabled_plugins=resolve_enabled_plugins(user.enabled_plugins))
