"""Authorization check schemas."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from app.core.constants import PermissionKey


class AuthzCheckRequestItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    permission: PermissionKey


class AuthzCheckRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    checks: list[AuthzCheckRequestItem]


class AuthzCheckResult(BaseModel):
    permission: PermissionKey
    allowed: bool


class AuthzCheckResponse(BaseModel):
    results: list[AuthzCheckResult]
