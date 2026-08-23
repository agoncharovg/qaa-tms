"""Security audit event helpers."""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.security_event import SecurityEvent


class SecurityEventType(StrEnum):
    ROLE_CREATED = "role.created"
    ROLE_UPDATED = "role.updated"
    ROLE_DELETED = "role.deleted"
    GROUP_CREATED = "group.created"
    GROUP_UPDATED = "group.updated"
    GROUP_DELETED = "group.deleted"
    GROUP_MEMBERS_UPDATED = "group.members_updated"
    GROUP_PERMISSIONS_UPDATED = "group.permissions_updated"
    USER_ROLE_CHANGED = "user.role_changed"
    USER_GROUP_CHANGED = "user.group_changed"
    USER_EXTRA_PERMISSION_ADDED = "user.extra_permission.added"
    USER_EXTRA_PERMISSION_REMOVED = "user.extra_permission.removed"
    USER_PASSWORD_RESET = "user.password_reset"
    USER_SESSION_INVALIDATED = "user.session_invalidated"


class SecurityTargetType(StrEnum):
    ROLE = "role"
    GROUP = "group"
    USER = "user"
    SYSTEM = "system"


def write_security_event(
    db: AsyncSession,
    *,
    actor_user_id: int | None,
    event_type: SecurityEventType,
    target_type: SecurityTargetType,
    target_id: str | None,
    payload: dict[str, Any] | None = None,
) -> None:
    db.add(
        SecurityEvent(
            actor_user_id=actor_user_id,
            event_type=event_type.value,
            target_type=target_type.value,
            target_id=target_id,
            payload=payload or {},
        )
    )
