from __future__ import annotations

import asyncio
from typing import cast

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.constants import PermissionKey, SecurityRoleKey
from app.models.security_permission import SecurityPermission
from app.models.security_role import SecurityRole, SecurityRolePermission
from app.services.authorization import ROLE_SEEDS, seed_security_catalog


def test_role_seeds_include_notebook_permissions_for_administrator_and_engineer() -> None:
    permissions_by_role = {seed.key: set(seed.permissions) for seed in ROLE_SEEDS}

    assert PermissionKey.NOTEBOOK_READ in permissions_by_role[SecurityRoleKey.ADMINISTRATOR]
    assert PermissionKey.NOTEBOOK_WRITE in permissions_by_role[SecurityRoleKey.ADMINISTRATOR]
    assert PermissionKey.NOTEBOOK_READ in permissions_by_role[SecurityRoleKey.ENGINEER]
    assert PermissionKey.NOTEBOOK_WRITE in permissions_by_role[SecurityRoleKey.ENGINEER]


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
            jenkins_permission = await session.scalar(
                select(SecurityPermission).where(
                    SecurityPermission.key == PermissionKey.JENKINS_READ.value
                )
            )

            assert stale_permission is None
            assert stale_association_count == 0
            assert jenkins_permission is not None

    asyncio.run(run_test())
