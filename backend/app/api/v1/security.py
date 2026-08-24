"""Security administration routes."""

from __future__ import annotations

from collections.abc import Iterable
from enum import StrEnum
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, require_permission
from app.core.constants import (
    ApiTag,
    PermissionKey,
    RoutePath,
)
from app.models.security_event import SecurityEvent
from app.models.security_group import (
    SecurityGroup,
    SecurityGroupMembership,
    SecurityGroupPermission,
    SecurityGroupRole,
)
from app.models.security_permission import SecurityPermission
from app.models.security_role import SecurityRole, SecurityRolePermission
from app.models.user import User
from app.schemas.security import (
    SecurityAuditListResponse,
    SecurityGroupCreateRequest,
    SecurityGroupListResponse,
    SecurityGroupMembersUpdateRequest,
    SecurityGroupPermissionsUpdateRequest,
    SecurityGroupRead,
    SecurityGroupRolesUpdateRequest,
    SecurityGroupUpdateRequest,
    SecurityPermissionListResponse,
    SecurityRoleCreateRequest,
    SecurityRoleListResponse,
    SecurityRoleRead,
    SecurityRoleUpdateRequest,
    to_security_event_read,
    to_security_group_read,
    to_security_permission_read,
    to_security_role_read,
)
from app.services.security_audit import (
    SecurityEventType,
    SecurityTargetType,
    write_security_event,
)

router = APIRouter(prefix=RoutePath.SECURITY.value, tags=[ApiTag.SECURITY.value])

SecurityReadUser = Annotated[User, Depends(require_permission(PermissionKey.SECURITY_READ))]
SecurityRolesReadUser = Annotated[
    User, Depends(require_permission(PermissionKey.SECURITY_ROLES_READ))
]
SecurityRolesManageUser = Annotated[
    User, Depends(require_permission(PermissionKey.SECURITY_ROLES_MANAGE))
]
SecurityGroupsReadUser = Annotated[
    User, Depends(require_permission(PermissionKey.SECURITY_GROUPS_READ))
]
SecurityGroupsManageUser = Annotated[
    User, Depends(require_permission(PermissionKey.SECURITY_GROUPS_MANAGE))
]
SecurityAuditReadUser = Annotated[
    User, Depends(require_permission(PermissionKey.SECURITY_AUDIT_READ))
]


class SecurityAdminErrorMessage(StrEnum):
    GROUP_KEY_ALREADY_EXISTS = "Group key already exists."
    GROUP_NOT_FOUND = "Security group not found."
    ROLE_IS_IMMUTABLE = "System roles cannot be modified or deleted."
    ROLE_HAS_USERS = "Unassign this role from all users before deleting it."
    ROLE_KEY_ALREADY_EXISTS = "Role key already exists."
    ROLE_NOT_FOUND = "Security role not found."
    UNKNOWN_PERMISSION_KEYS = "One or more permission keys are unknown."
    UNKNOWN_USER_IDS = "One or more users are unknown."


async def list_permissions_by_keys(
    db: AsyncSession,
    permission_keys: Iterable[PermissionKey],
) -> list[SecurityPermission]:
    resolved_keys = list(dict.fromkeys(permission_keys))
    if not resolved_keys:
        return []

    rows = list(
        await db.scalars(
            select(SecurityPermission).where(
                SecurityPermission.key.in_(
                    [permission_key.value for permission_key in resolved_keys]
                )
            )
        )
    )
    rows_by_key = {row.key: row for row in rows}
    missing = [
        permission_key
        for permission_key in resolved_keys
        if permission_key.value not in rows_by_key
    ]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=SecurityAdminErrorMessage.UNKNOWN_PERMISSION_KEYS.value,
        )
    return [rows_by_key[permission_key.value] for permission_key in resolved_keys]


async def ensure_role_key_available(
    db: AsyncSession,
    key: str | None,
    *,
    exclude_role_id: int | None = None,
) -> None:
    if key is None:
        return
    existing = await db.scalar(select(SecurityRole).where(SecurityRole.key == key))
    if existing is not None and existing.id != exclude_role_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=SecurityAdminErrorMessage.ROLE_KEY_ALREADY_EXISTS.value,
        )


async def ensure_group_key_available(
    db: AsyncSession,
    key: str | None,
    *,
    exclude_group_id: int | None = None,
) -> None:
    if key is None:
        return
    existing = await db.scalar(select(SecurityGroup).where(SecurityGroup.key == key))
    if existing is not None and existing.id != exclude_group_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=SecurityAdminErrorMessage.GROUP_KEY_ALREADY_EXISTS.value,
        )


async def get_role_or_404(db: AsyncSession, role_id: int) -> SecurityRole:
    role = await db.scalar(
        select(SecurityRole)
        .options(selectinload(SecurityRole.permissions))
        .where(SecurityRole.id == role_id)
    )
    if role is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=SecurityAdminErrorMessage.ROLE_NOT_FOUND.value,
        )
    return role


async def get_group_or_404(db: AsyncSession, group_id: int) -> SecurityGroup:
    group = await db.scalar(
        select(SecurityGroup)
        .options(
            selectinload(SecurityGroup.memberships).selectinload(SecurityGroupMembership.user),
            selectinload(SecurityGroup.permissions),
            selectinload(SecurityGroup.group_roles),
        )
        .where(SecurityGroup.id == group_id)
    )
    if group is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=SecurityAdminErrorMessage.GROUP_NOT_FOUND.value,
        )
    return group


async def ensure_role_can_mutate(role: SecurityRole, has_changes: bool) -> None:
    if has_changes and (role.system or not role.mutable):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=SecurityAdminErrorMessage.ROLE_IS_IMMUTABLE.value,
        )


async def ensure_user_ids_exist(db: AsyncSession, user_ids: list[int]) -> None:
    if not user_ids:
        return
    rows = list(await db.scalars(select(User.id).where(User.id.in_(user_ids))))
    if len(rows) != len(user_ids):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=SecurityAdminErrorMessage.UNKNOWN_USER_IDS.value,
        )


def deduplicate_ids(values: list[int]) -> list[int]:
    return list(dict.fromkeys(values))


def build_role_audit_payload(role: SecurityRole) -> dict[str, Any]:
    return {
        "key": role.key,
        "display_name": role.display_name,
        "description": role.description,
        "system": role.system,
        "mutable": role.mutable,
        "permission_keys": sorted(permission.key for permission in role.permissions),
    }


def build_group_audit_payload(group: SecurityGroup) -> dict[str, Any]:
    memberships = list(group.__dict__.get("memberships") or [])
    user_ids = sorted(membership.user_id for membership in memberships)
    permissions = sorted(p.key for p in (group.__dict__.get("permissions") or []))
    return {
        "key": group.key,
        "display_name": group.display_name,
        "description": group.description,
        "system": group.system,
        "member_user_ids": user_ids,
        "member_count": len(user_ids),
        "permission_keys": permissions,
    }


@router.get(RoutePath.PERMISSIONS.value, response_model=SecurityPermissionListResponse)
async def list_security_permissions(
    _: SecurityReadUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SecurityPermissionListResponse:
    items = list(await db.scalars(select(SecurityPermission).order_by(SecurityPermission.key)))
    return SecurityPermissionListResponse(
        items=[to_security_permission_read(item) for item in items],
        total=len(items),
    )


@router.get(RoutePath.ROLES.value, response_model=SecurityRoleListResponse)
async def list_security_roles(
    _: SecurityRolesReadUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SecurityRoleListResponse:
    items = list(
        await db.scalars(
            select(SecurityRole)
            .options(selectinload(SecurityRole.permissions))
            .order_by(SecurityRole.system.desc(), SecurityRole.display_name, SecurityRole.id)
        )
    )
    return SecurityRoleListResponse(
        items=[to_security_role_read(item) for item in items],
        total=len(items),
    )


@router.post(
    RoutePath.ROLES.value,
    response_model=SecurityRoleRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_security_role(
    payload: SecurityRoleCreateRequest,
    current_user: SecurityRolesManageUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SecurityRoleRead:
    await ensure_role_key_available(db, payload.key)
    permission_rows = await list_permissions_by_keys(db, payload.permission_keys)

    role = SecurityRole(
        key=payload.key,
        display_name=payload.display_name,
        description=payload.description,
        system=False,
        mutable=True,
    )
    db.add(role)
    await db.flush()
    role_id = role.id
    for perm in permission_rows:
        db.add(SecurityRolePermission(role_id=role_id, permission_id=perm.id))
    write_security_event(
        db,
        actor_user_id=current_user.id,
        event_type=SecurityEventType.ROLE_CREATED,
        target_type=SecurityTargetType.ROLE,
        target_id=str(role_id),
        payload=build_role_audit_payload(role),
    )
    await db.commit()

    created_role = await get_role_or_404(db, role_id)
    return to_security_role_read(created_role)


@router.get(RoutePath.ROLE_BY_ID.value, response_model=SecurityRoleRead)
async def get_security_role(
    role_id: int,
    _: SecurityRolesReadUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SecurityRoleRead:
    role = await get_role_or_404(db, role_id)
    return to_security_role_read(role)


@router.patch(RoutePath.ROLE_BY_ID.value, response_model=SecurityRoleRead)
async def update_security_role(
    role_id: int,
    payload: SecurityRoleUpdateRequest,
    current_user: SecurityRolesManageUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SecurityRoleRead:
    role = await get_role_or_404(db, role_id)
    await ensure_role_can_mutate(role, bool(payload.model_fields_set))
    before = build_role_audit_payload(role)

    if "key" in payload.model_fields_set:
        await ensure_role_key_available(db, payload.key, exclude_role_id=role.id)
        role.key = payload.key
    if "display_name" in payload.model_fields_set and payload.display_name is not None:
        role.display_name = payload.display_name
    if "description" in payload.model_fields_set:
        role.description = payload.description
    if "permission_keys" in payload.model_fields_set and payload.permission_keys is not None:
        perm_rows = await list_permissions_by_keys(db, payload.permission_keys)
        await db.execute(delete(SecurityRolePermission).where(SecurityRolePermission.role_id == role.id))
        for perm in perm_rows:
            db.add(SecurityRolePermission(role_id=role.id, permission_id=perm.id))

    write_security_event(
        db,
        actor_user_id=current_user.id,
        event_type=SecurityEventType.ROLE_UPDATED,
        target_type=SecurityTargetType.ROLE,
        target_id=str(role.id),
        payload={
            "before": before,
            "after": build_role_audit_payload(role),
        },
    )
    await db.commit()
    updated_role = await get_role_or_404(db, role.id)
    return to_security_role_read(updated_role)


@router.delete(RoutePath.ROLE_BY_ID.value, status_code=status.HTTP_204_NO_CONTENT)
async def delete_security_role(
    role_id: int,
    current_user: SecurityRolesManageUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    role = await get_role_or_404(db, role_id)
    await ensure_role_can_mutate(role, True)

    user_count = await db.scalar(
        select(func.count()).select_from(User).where(User.role_id == role_id)
    )
    if user_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=SecurityAdminErrorMessage.ROLE_HAS_USERS.value,
        )

    write_security_event(
        db,
        actor_user_id=current_user.id,
        event_type=SecurityEventType.ROLE_DELETED,
        target_type=SecurityTargetType.ROLE,
        target_id=str(role.id),
        payload=build_role_audit_payload(role),
    )
    await db.delete(role)
    await db.commit()


@router.get(RoutePath.GROUPS.value, response_model=SecurityGroupListResponse)
async def list_security_groups(
    _: SecurityGroupsReadUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SecurityGroupListResponse:
    items = list(
        await db.scalars(
            select(SecurityGroup)
            .options(
                selectinload(SecurityGroup.memberships).selectinload(SecurityGroupMembership.user),
                selectinload(SecurityGroup.permissions),
                selectinload(SecurityGroup.group_roles),
            )
            .order_by(SecurityGroup.display_name, SecurityGroup.id)
        )
    )
    return SecurityGroupListResponse(
        items=[to_security_group_read(item) for item in items],
        total=len(items),
    )


@router.post(
    RoutePath.GROUPS.value,
    response_model=SecurityGroupRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_security_group(
    payload: SecurityGroupCreateRequest,
    current_user: SecurityGroupsManageUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SecurityGroupRead:
    await ensure_group_key_available(db, payload.key)

    group = SecurityGroup(
        key=payload.key,
        display_name=payload.display_name,
        description=payload.description,
        system=False,
    )
    db.add(group)
    await db.flush()
    group_id = group.id
    write_security_event(
        db,
        actor_user_id=current_user.id,
        event_type=SecurityEventType.GROUP_CREATED,
        target_type=SecurityTargetType.GROUP,
        target_id=str(group_id),
        payload=build_group_audit_payload(group),
    )
    await db.commit()

    created_group = await get_group_or_404(db, group_id)
    return to_security_group_read(created_group)


@router.get(RoutePath.GROUP_BY_ID.value, response_model=SecurityGroupRead)
async def get_security_group(
    group_id: int,
    _: SecurityGroupsReadUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SecurityGroupRead:
    group = await get_group_or_404(db, group_id)
    return to_security_group_read(group)


@router.patch(RoutePath.GROUP_BY_ID.value, response_model=SecurityGroupRead)
async def update_security_group(
    group_id: int,
    payload: SecurityGroupUpdateRequest,
    current_user: SecurityGroupsManageUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SecurityGroupRead:
    group = await get_group_or_404(db, group_id)
    before = build_group_audit_payload(group)

    if "key" in payload.model_fields_set:
        await ensure_group_key_available(db, payload.key, exclude_group_id=group.id)
        group.key = payload.key
    if "display_name" in payload.model_fields_set and payload.display_name is not None:
        group.display_name = payload.display_name
    if "description" in payload.model_fields_set:
        group.description = payload.description

    write_security_event(
        db,
        actor_user_id=current_user.id,
        event_type=SecurityEventType.GROUP_UPDATED,
        target_type=SecurityTargetType.GROUP,
        target_id=str(group.id),
        payload={
            "before": before,
            "after": build_group_audit_payload(group),
        },
    )
    await db.commit()
    updated_group = await get_group_or_404(db, group.id)
    return to_security_group_read(updated_group)


@router.delete(RoutePath.GROUP_BY_ID.value, status_code=status.HTTP_204_NO_CONTENT)
async def delete_security_group(
    group_id: int,
    current_user: SecurityGroupsManageUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    group = await get_group_or_404(db, group_id)

    user_count = await db.scalar(
        select(func.count()).select_from(User).where(User.group_id == group_id)
    )
    if user_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Unassign this group from all users before deleting it.",
        )

    write_security_event(
        db,
        actor_user_id=current_user.id,
        event_type=SecurityEventType.GROUP_DELETED,
        target_type=SecurityTargetType.GROUP,
        target_id=str(group.id),
        payload=build_group_audit_payload(group),
    )
    await db.delete(group)
    await db.commit()


@router.put(RoutePath.GROUP_MEMBERS.value, response_model=SecurityGroupRead)
async def replace_security_group_members(
    group_id: int,
    payload: SecurityGroupMembersUpdateRequest,
    current_user: SecurityGroupsManageUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SecurityGroupRead:
    group = await get_group_or_404(db, group_id)
    before_user_ids = sorted(membership.user_id for membership in group.memberships)
    user_ids = deduplicate_ids(payload.user_ids)
    await ensure_user_ids_exist(db, user_ids)

    group.memberships = [SecurityGroupMembership(user_id=user_id) for user_id in user_ids]
    write_security_event(
        db,
        actor_user_id=current_user.id,
        event_type=SecurityEventType.GROUP_MEMBERS_UPDATED,
        target_type=SecurityTargetType.GROUP,
        target_id=str(group.id),
        payload={
            "before_user_ids": before_user_ids,
            "after_user_ids": sorted(user_ids),
        },
    )
    await db.commit()

    updated_group = await get_group_or_404(db, group.id)
    return to_security_group_read(updated_group)


@router.put(RoutePath.GROUP_PERMISSIONS.value, response_model=SecurityGroupRead)
async def replace_security_group_permissions(
    group_id: int,
    payload: SecurityGroupPermissionsUpdateRequest,
    current_user: SecurityGroupsManageUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SecurityGroupRead:
    group = await get_group_or_404(db, group_id)
    permission_rows = await list_permissions_by_keys(db, payload.permission_keys)

    before_keys = sorted(p.key for p in group.permissions)
    await db.execute(delete(SecurityGroupPermission).where(SecurityGroupPermission.group_id == group.id))
    for perm in permission_rows:
        db.add(SecurityGroupPermission(group_id=group.id, permission_id=perm.id))
    write_security_event(
        db,
        actor_user_id=current_user.id,
        event_type=SecurityEventType.GROUP_PERMISSIONS_UPDATED,
        target_type=SecurityTargetType.GROUP,
        target_id=str(group.id),
        payload={
            "before_permission_keys": before_keys,
            "after_permission_keys": sorted(p.key for p in permission_rows),
        },
    )
    await db.commit()

    updated_group = await get_group_or_404(db, group.id)
    return to_security_group_read(updated_group)


@router.put(RoutePath.GROUP_ROLES.value, response_model=SecurityGroupRead)
async def replace_security_group_roles(
    group_id: int,
    payload: SecurityGroupRolesUpdateRequest,
    current_user: SecurityGroupsManageUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SecurityGroupRead:
    group = await get_group_or_404(db, group_id)
    before_role_ids = sorted(gr.role_id for gr in group.group_roles)
    role_ids = list(dict.fromkeys(payload.role_ids))

    if role_ids:
        existing = list(await db.scalars(select(SecurityRole).where(SecurityRole.id.in_(role_ids))))
        if len(existing) != len(role_ids):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="One or more role IDs not found.")

    await db.execute(delete(SecurityGroupRole).where(SecurityGroupRole.group_id == group.id))
    for role_id in role_ids:
        db.add(SecurityGroupRole(group_id=group.id, role_id=role_id))
    write_security_event(
        db,
        actor_user_id=current_user.id,
        event_type=SecurityEventType.GROUP_UPDATED,
        target_type=SecurityTargetType.GROUP,
        target_id=str(group.id),
        payload={"before_role_ids": before_role_ids, "after_role_ids": sorted(role_ids)},
    )
    await db.commit()

    updated_group = await get_group_or_404(db, group.id)
    return to_security_group_read(updated_group)


@router.get(RoutePath.AUDIT.value, response_model=SecurityAuditListResponse)
async def list_security_audit(
    _: SecurityAuditReadUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SecurityAuditListResponse:
    items = list(
        await db.scalars(
            select(SecurityEvent)
            .options(selectinload(SecurityEvent.actor_user))
            .order_by(SecurityEvent.created_at.desc(), SecurityEvent.id.desc())
        )
    )
    return SecurityAuditListResponse(
        items=[to_security_event_read(item) for item in items],
        total=len(items),
    )
