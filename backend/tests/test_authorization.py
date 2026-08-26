from __future__ import annotations

from app.core.constants import PermissionKey, SecurityRoleKey
from app.services.authorization import ROLE_SEEDS


def test_role_seeds_include_notebook_permissions_for_administrator_and_engineer() -> None:
    permissions_by_role = {seed.key: set(seed.permissions) for seed in ROLE_SEEDS}

    assert PermissionKey.NOTEBOOK_READ in permissions_by_role[SecurityRoleKey.ADMINISTRATOR]
    assert PermissionKey.NOTEBOOK_WRITE in permissions_by_role[SecurityRoleKey.ADMINISTRATOR]
    assert PermissionKey.NOTEBOOK_READ in permissions_by_role[SecurityRoleKey.ENGINEER]
    assert PermissionKey.NOTEBOOK_WRITE in permissions_by_role[SecurityRoleKey.ENGINEER]
