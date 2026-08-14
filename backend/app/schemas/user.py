"""User schemas."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict

from app.core.constants import resolve_enabled_plugins

if TYPE_CHECKING:
    from app.models.user import User


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    display_name: str
    is_admin: bool
    auto_login: bool
    enabled_plugins: list[str]
    qaa_generator_token_set: bool
    created_at: datetime
    updated_at: datetime


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
    qaa_generator_token: str | None = None


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


class UserListResponse(BaseModel):
    items: list[UserRead]
    total: int


def to_user_read(user: User) -> UserRead:
    return UserRead(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        is_admin=user.is_admin,
        auto_login=user.auto_login,
        enabled_plugins=resolve_enabled_plugins(user.enabled_plugins),
        qaa_generator_token_set=bool(user.qaa_generator_token),
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


def to_me_plugins_response(user: User) -> MePluginsResponse:
    return MePluginsResponse(enabled_plugins=resolve_enabled_plugins(user.enabled_plugins))
