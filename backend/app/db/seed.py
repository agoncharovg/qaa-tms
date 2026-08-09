"""Development seed data."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import DevDisplayName, DevPassword, DevUsername
from app.core.security import hash_password
from app.models.user import User


async def seed_dev_users(session: AsyncSession) -> None:
    usernames = [DevUsername.TEST.value, DevUsername.ADMIN.value]
    existing_users = await session.scalars(select(User).where(User.username.in_(usernames)))
    existing_by_username = {user.username: user for user in existing_users}

    if DevUsername.TEST.value not in existing_by_username:
        session.add(
            User(
                username=DevUsername.TEST.value,
                password_hash=None,
                display_name=DevDisplayName.TEST.value,
                is_admin=False,
                auto_login=False,
            )
        )

    if DevUsername.ADMIN.value not in existing_by_username:
        session.add(
            User(
                username=DevUsername.ADMIN.value,
                password_hash=hash_password(DevPassword.ADMIN.value),
                display_name=DevDisplayName.ADMIN.value,
                is_admin=True,
                auto_login=False,
            )
        )

    await session.commit()
