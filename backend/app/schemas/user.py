"""User schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    display_name: str
    is_admin: bool
    auto_login: bool
    created_at: datetime
    updated_at: datetime


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
