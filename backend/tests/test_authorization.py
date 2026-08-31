from __future__ import annotations

import asyncio
from typing import cast

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.constants import PermissionKey, SecurityRoleKey
from app.models.security_permission import SecurityPermission
from app.models.security_role import SecurityRole, SecurityRolePermission
from app.services.authorization import PERMISSION_SEEDS, ROLE_SEEDS, seed_security_catalog


def test_role_and_permission_seeds_include_kuber_exec_for_engineer() -> None:
    permissions_by_role = {seed.key: set(seed.permissions) for seed in ROLE_SEEDS}
    seeded_permissions = {seed.key for seed in PERMISSION_SEEDS}

    assert PermissionKey.NOTEBOOK_READ in permissions_by_role[SecurityRoleKey.ADMINISTRATOR]
    assert PermissionKey.NOTEBOOK_WRITE in permissions_by_role[SecurityRoleKey.ADMINISTRATOR]
    assert PermissionKey.REQUESTS_READ in permissions_by_role[SecurityRoleKey.ADMINISTRATOR]
    assert PermissionKey.REQUESTS_WRITE in permissions_by_role[SecurityRoleKey.ADMINISTRATOR]
    assert PermissionKey.NOTEBOOK_READ in permissions_by_role[SecurityRoleKey.ENGINEER]
    assert PermissionKey.NOTEBOOK_WRITE in permissions_by_role[SecurityRoleKey.ENGINEER]
    assert PermissionKey.REQUESTS_READ in permissions_by_role[SecurityRoleKey.ENGINEER]
    assert PermissionKey.REQUESTS_WRITE in permissions_by_role[SecurityRoleKey.ENGINEER]
    assert PermissionKey.KUBER_EXEC in permissions_by_role[SecurityRoleKey.ENGINEER]
    assert PermissionKey.KUBER_EXEC in seeded_permissions
    assert PermissionKey.REQUESTS_READ in seeded_permissions
    assert PermissionKey.REQUESTS_WRITE in seeded_permissions


def test_seed_security_catalog_removes_stale_permissions_and_associations(
    client: TestClient,
) -> None:
    session_maker = cast(async_sessionmaker[AsyncSession], client.app.state.session_maker)

    async def run_test() -> None:
        stale_permission_id: int
        async with session_maker() as session:
            engineer_role = await session.scalar(
                select(SecurityRole).where(SecurityRole.key == SecurityRoleKey.ENGINEER.value)
            )
            assert engineer_role is not None

            stale_permission = SecurityPermission(
                key="assistant.use",
                display_name="Assistant Use",
                description="Stale assistant permission.",
                system=True,
            )
            session.add(stale_permission)
            await session.flush()
            stale_permission_id = stale_permission.id
            session.add(
                SecurityRolePermission(
                    role_id=engineer_role.id,
                    permission_id=stale_permission_id,
                )
            )
            await session.commit()

        async with session_maker() as session:
            await seed_security_catalog(session)

        async with session_maker() as session:
            stale_permission = await session.scalar(
                select(SecurityPermission).where(SecurityPermission.key == "assistant.use")
            )
            stale_association_count = await session.scalar(
                select(func.count())
                .select_from(SecurityRolePermission)
                .where(SecurityRolePermission.permission_id == stale_permission_id)
            )
            kuber_exec_permission = await session.scalar(
                select(SecurityPermission).where(
                    SecurityPermission.key == PermissionKey.KUBER_EXEC.value
                )
            )

            assert stale_permission is None
            assert stale_association_count == 0
            assert kuber_exec_permission is not None

    asyncio.run(run_test())
