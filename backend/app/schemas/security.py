"""Security administration schemas."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.constants import PermissionKey

if TYPE_CHECKING:
    from app.models.security_event import SecurityEvent
    from app.models.security_group import SecurityGroup
    from app.models.security_permission import SecurityPermission
    from app.models.security_role import SecurityRole
    from app.models.user import User


class SecurityPermissionRead(BaseModel):
    id: int
    key: str
    display_name: str
    description: str | None
    system: bool
    created_at: datetime
    updated_at: datetime


class SecurityPermissionListResponse(BaseModel):
    items: list[SecurityPermissionRead]
    total: int


class SecurityRoleSummary(BaseModel):
    id: int
    key: str | None
    display_name: str
    system: bool
    mutable: bool


class SecurityRoleRead(SecurityRoleSummary):
    description: str | None
    permissions: list[PermissionKey]
    created_at: datetime
    updated_at: datetime


class SecurityRoleListResponse(BaseModel):
    items: list[SecurityRoleRead]
    total: int


class SecurityRoleCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    key: str | None = None
    display_name: str = Field(min_length=1)
    description: str | None = None
    permission_keys: list[PermissionKey] = Field(default_factory=list)

    @field_validator("key", "description", mode="before")
    @classmethod
    def empty_string_to_none(cls, value: Any) -> Any:
        if isinstance(value, str) and not value.strip():
            return None
        return value


class SecurityRoleUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    key: str | None = None
    display_name: str | None = Field(default=None, min_length=1)
    description: str | None = None
    permission_keys: list[PermissionKey] | None = None

    @field_validator("key", "description", mode="before")
    @classmethod
    def empty_string_to_none(cls, value: Any) -> Any:
        if isinstance(value, str) and not value.strip():
            return None
        return value


class SecurityUserSummary(BaseModel):
    id: int
    username: str
    display_name: str


class SecurityGroupSummary(BaseModel):
    id: int
    key: str | None
    display_name: str
    system: bool


class SecurityGroupRead(SecurityGroupSummary):
    description: str | None
    members: list[SecurityUserSummary]
    member_count: int
    permissions: list[PermissionKey]
    role_ids: list[int]
    created_at: datetime
    updated_at: datetime


class SecurityGroupListResponse(BaseModel):
    items: list[SecurityGroupRead]
    total: int


class SecurityGroupCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    key: str | None = None
    display_name: str = Field(min_length=1)
    description: str | None = None

    @field_validator("key", "description", mode="before")
    @classmethod
    def empty_string_to_none(cls, value: Any) -> Any:
        if isinstance(value, str) and not value.strip():
            return None
        return value


class SecurityGroupUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    key: str | None = None
    display_name: str | None = Field(default=None, min_length=1)
    description: str | None = None

    @field_validator("key", "description", mode="before")
    @classmethod
    def empty_string_to_none(cls, value: Any) -> Any:
        if isinstance(value, str) and not value.strip():
            return None
        return value


class SecurityGroupMembersUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_ids: list[int]


class SecurityGroupPermissionsUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    permission_keys: list[PermissionKey]


class SecurityGroupRolesUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role_ids: list[int]


class SecurityEventRead(BaseModel):
    id: int
    event_type: str
    target_type: str
    target_id: str | None
    payload: dict[str, Any]
    created_at: datetime
    actor_user: SecurityUserSummary | None


class SecurityAuditListResponse(BaseModel):
    items: list[SecurityEventRead]
    total: int


def to_security_permission_read(permission: SecurityPermission) -> SecurityPermissionRead:
    return SecurityPermissionRead(
        id=permission.id,
        key=permission.key,
        display_name=permission.display_name,
        description=permission.description,
        system=permission.system,
        created_at=permission.created_at,
        updated_at=permission.updated_at,
    )


def to_security_role_summary(role: SecurityRole) -> SecurityRoleSummary:
    return SecurityRoleSummary(
        id=role.id,
        key=role.key,
        display_name=role.display_name,
        system=role.system,
        mutable=role.mutable,
    )


def to_security_role_read(role: SecurityRole) -> SecurityRoleRead:
    return SecurityRoleRead(
        **to_security_role_summary(role).model_dump(),
        description=role.description,
        permissions=sorted(
            (PermissionKey(permission.key) for permission in role.permissions),
            key=str,
        ),
        created_at=role.created_at,
        updated_at=role.updated_at,
    )


def to_security_user_summary(user: User) -> SecurityUserSummary:
    return SecurityUserSummary(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
    )


def to_security_group_summary(group: SecurityGroup) -> SecurityGroupSummary:
    return SecurityGroupSummary(
        id=group.id,
        key=group.key,
        display_name=group.display_name,
        system=group.system,
    )


def to_security_group_read(group: SecurityGroup) -> SecurityGroupRead:
    users = sorted(
        (membership.user for membership in group.memberships),
        key=lambda user: (user.display_name.lower(), user.username.lower(), user.id),
    )
    members = [to_security_user_summary(user) for user in users]
    valid_keys = PermissionKey._value2member_map_
    permissions = sorted(
        (PermissionKey(p.key) for p in group.permissions if p.key in valid_keys),
        key=str,
    )
    return SecurityGroupRead(
        **to_security_group_summary(group).model_dump(),
        description=group.description,
        members=members,
        member_count=len(members),
        permissions=permissions,
        role_ids=sorted(gr.role_id for gr in group.group_roles),
        created_at=group.created_at,
        updated_at=group.updated_at,
    )


def to_security_event_read(event: SecurityEvent) -> SecurityEventRead:
    return SecurityEventRead(
        id=event.id,
        event_type=event.event_type,
        target_type=event.target_type,
        target_id=event.target_id,
        payload=event.payload,
        created_at=event.created_at,
        actor_user=(
            to_security_user_summary(event.actor_user)
            if event.actor_user is not None
            else None
        ),
    )
