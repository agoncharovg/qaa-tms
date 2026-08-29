"""RBAC authorization service."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.constants import PermissionKey, SecurityRoleKey
from app.models.security_group import SecurityGroupPermission, SecurityGroupRole
from app.models.security_permission import SecurityPermission
from app.models.security_role import SecurityRole, SecurityRolePermission
from app.models.user_extra_permission import UserExtraPermission


@dataclass(frozen=True)
class PermissionSeed:
    key: PermissionKey
    display_name: str
    description: str


@dataclass(frozen=True)
class RoleSeed:
    key: SecurityRoleKey
    display_name: str
    description: str
    mutable: bool
    permissions: tuple[PermissionKey, ...]


PERMISSION_SEEDS: tuple[PermissionSeed, ...] = tuple(
    PermissionSeed(
        key=permission,
        display_name=permission.value.replace(".", " ").replace("_", " ").title(),
        description=f"Grants {permission.value}.",
    )
    for permission in PermissionKey
)

ROLE_SEEDS: tuple[RoleSeed, ...] = (
    RoleSeed(
        key=SecurityRoleKey.SUPERADMIN,
        display_name="Superadmin",
        description="Full access to every backend security capability.",
        mutable=False,
        permissions=tuple(PermissionKey),
    ),
    RoleSeed(
        key=SecurityRoleKey.ADMINISTRATOR,
        display_name="Administrator",
        description="Administrative access.",
        mutable=False,
        permissions=(
            PermissionKey.SECURITY_READ,
            PermissionKey.SECURITY_ROLES_READ,
            PermissionKey.SECURITY_ROLES_MANAGE,
            PermissionKey.SECURITY_GROUPS_READ,
            PermissionKey.SECURITY_GROUPS_MANAGE,
            PermissionKey.SECURITY_AUDIT_READ,
            PermissionKey.USERS_READ,
            PermissionKey.USERS_MANAGE,
            PermissionKey.PROFILE_SELF_READ,
            PermissionKey.PROFILE_SELF_MANAGE,
            PermissionKey.SERVER_SETTINGS_READ,
            PermissionKey.SERVER_SETTINGS_MANAGE,
            PermissionKey.OPERATIONS_READ_OWN,
            PermissionKey.OPERATIONS_READ_ALL,
            PermissionKey.JENKINS_READ,
            PermissionKey.JENKINS_FREEZE,
            PermissionKey.JENKINS_RESUME,
            PermissionKey.STATISTICS_READ,
            PermissionKey.QAA_READ,
            PermissionKey.QAA_RUN,
            PermissionKey.QAA_ADMIN,
            PermissionKey.NOTIFICATOR_READ,
            PermissionKey.NOTIFICATOR_WRITE,
            PermissionKey.LEONID_READ,
            PermissionKey.LEONID_WRITE,
            PermissionKey.NOTEBOOK_READ,
            PermissionKey.NOTEBOOK_WRITE,
        ),
    ),
    RoleSeed(
        key=SecurityRoleKey.ENGINEER,
        display_name="Engineer",
        description="Default engineering access for day-to-day execution workflows.",
        mutable=False,
        permissions=(
            PermissionKey.PROFILE_SELF_READ,
            PermissionKey.PROFILE_SELF_MANAGE,
            PermissionKey.OPERATIONS_READ_OWN,
            PermissionKey.JENKINS_READ,
            PermissionKey.JENKINS_FREEZE,
            PermissionKey.JENKINS_RESUME,
            PermissionKey.STATISTICS_READ,
            PermissionKey.STAGINGS_READ,
            PermissionKey.STAGINGS_DEPLOY,
            PermissionKey.STAGINGS_DESTROY,
            PermissionKey.STAGINGS_SYNC,
            PermissionKey.STAGINGS_E2E_RUN,
            PermissionKey.KUBER_READ,
            PermissionKey.KUBER_USE_CONTEXT,
            PermissionKey.KUBER_DELETE_POD,
            PermissionKey.KUBER_EXEC,
            PermissionKey.QAA_READ,
            PermissionKey.QAA_RUN,
            PermissionKey.NOTEBOOK_READ,
            PermissionKey.NOTEBOOK_WRITE,
        ),
    ),
    RoleSeed(
        key=SecurityRoleKey.VIEWER,
        display_name="Viewer",
        description="Read-only Jenkins/statistics access.",
        mutable=False,
        permissions=(
            PermissionKey.PROFILE_SELF_READ,
            PermissionKey.PROFILE_SELF_MANAGE,
            PermissionKey.JENKINS_READ,
            PermissionKey.STATISTICS_READ,
        ),
    ),
)


async def resolve_permissions(user: object, db: AsyncSession) -> frozenset[PermissionKey]:
    from app.models.user import User

    assert isinstance(user, User)
    perms: set[PermissionKey] = set()

    if user.role_id is not None:
        role_perm_rows = await db.scalars(
            select(SecurityPermission.key)
            .join(
                SecurityRolePermission,
                SecurityRolePermission.permission_id == SecurityPermission.id,
            )
            .where(SecurityRolePermission.role_id == user.role_id)
        )
        for key in role_perm_rows:
            try:
                perms.add(PermissionKey(key))
            except ValueError:
                pass

    if user.group_id is not None:
        group_perm_rows = await db.scalars(
            select(SecurityPermission.key)
            .join(
                SecurityGroupPermission,
                SecurityGroupPermission.permission_id == SecurityPermission.id,
            )
            .where(SecurityGroupPermission.group_id == user.group_id)
        )
        for key in group_perm_rows:
            try:
                perms.add(PermissionKey(key))
            except ValueError:
                pass

        group_role_perm_rows = await db.scalars(
            select(SecurityPermission.key)
            .join(
                SecurityRolePermission,
                SecurityRolePermission.permission_id == SecurityPermission.id,
            )
            .join(SecurityGroupRole, SecurityGroupRole.role_id == SecurityRolePermission.role_id)
            .where(SecurityGroupRole.group_id == user.group_id)
        )
        for key in group_role_perm_rows:
            try:
                perms.add(PermissionKey(key))
            except ValueError:
                pass

    extra_rows = await db.scalars(
        select(SecurityPermission.key)
        .join(UserExtraPermission, UserExtraPermission.permission_id == SecurityPermission.id)
        .where(UserExtraPermission.user_id == user.id)
    )
    for key in extra_rows:
        try:
            perms.add(PermissionKey(key))
        except ValueError:
            pass

    return frozenset(perms)


async def has_permission(user: object, permission: PermissionKey, db: AsyncSession) -> bool:
    from app.models.user import User

    assert isinstance(user, User)
    if user.is_admin:
        return True
    perms = await resolve_permissions(user, db)
    return permission in perms


async def seed_security_catalog(session: AsyncSession) -> None:
    permission_rows = list(await session.scalars(select(SecurityPermission)))
    permissions_by_key = {row.key: row for row in permission_rows}
    for seed in PERMISSION_SEEDS:
        permission = permissions_by_key.get(seed.key.value)
        if permission is None:
            permission = SecurityPermission(
                key=seed.key.value,
                display_name=seed.display_name,
                description=seed.description,
                system=True,
            )
            session.add(permission)
            permissions_by_key[seed.key.value] = permission
        else:
            permission.display_name = seed.display_name
            permission.description = seed.description
            permission.system = True
    await session.flush()

    valid_keys = {seed.key.value for seed in PERMISSION_SEEDS}
    stale_permissions = [row for row in permissions_by_key.values() if row.key not in valid_keys]
    for permission in stale_permissions:
        await session.delete(permission)
    if stale_permissions:
        await session.flush()

    role_rows = list(
        await session.scalars(
            select(SecurityRole)
            .options(selectinload(SecurityRole.permissions))
            .where(SecurityRole.key.in_([seed.key.value for seed in ROLE_SEEDS]))
        )
    )
    roles_by_key = {row.key: row for row in role_rows}
    for role_seed in ROLE_SEEDS:
        role = roles_by_key.get(role_seed.key.value)
        if role is None:
            role = SecurityRole(
                key=role_seed.key.value,
                display_name=role_seed.display_name,
                description=role_seed.description,
                system=True,
                mutable=role_seed.mutable,
            )
            session.add(role)
            roles_by_key[role_seed.key.value] = role
        else:
            role.display_name = role_seed.display_name
            role.description = role_seed.description
            role.system = True
            role.mutable = role_seed.mutable
    await session.flush()

    refreshed_roles = list(
        await session.scalars(
            select(SecurityRole)
            .options(selectinload(SecurityRole.permissions))
            .where(SecurityRole.key.in_([seed.key.value for seed in ROLE_SEEDS]))
        )
    )
    roles_by_key = {row.key: row for row in refreshed_roles}
    for role_seed in ROLE_SEEDS:
        role = roles_by_key[role_seed.key.value]
        role.permissions = [
            permissions_by_key[permission.value] for permission in role_seed.permissions
        ]
    await session.commit()


async def assign_engineer_to_dev_test_user(session: AsyncSession) -> None:
    from app.core.constants import DevUsername
    from app.models.user import User

    test_user = await session.scalar(select(User).where(User.username == DevUsername.TEST.value))
    if test_user is None or test_user.role_id is not None:
        return

    engineer = await session.scalar(
        select(SecurityRole).where(SecurityRole.key == SecurityRoleKey.ENGINEER.value)
    )
    if engineer is None:
        return

    test_user.role_id = engineer.id
    await session.commit()


async def assign_superadmin_to_admins(session: AsyncSession) -> None:
    from app.models.user import User

    superadmin = await session.scalar(
        select(SecurityRole).where(SecurityRole.key == SecurityRoleKey.SUPERADMIN.value)
    )
    if superadmin is None:
        return
    users = list(
        await session.scalars(select(User).where(User.is_admin.is_(True), User.role_id.is_(None)))
    )
    for user in users:
        user.role_id = superadmin.id
    if users:
        await session.commit()
