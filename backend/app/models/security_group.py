"""Security group models."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.constants import DEFAULT_STRING_LENGTH
from app.core.time import utcnow
from app.db.base import Base

if TYPE_CHECKING:
    from app.models.security_permission import SecurityPermission
    from app.models.security_role import SecurityRole
    from app.models.user import User


class SecurityGroupPermission(Base):
    __tablename__ = "security_group_permissions"
    __mapper_args__ = {"confirm_deleted_rows": False}

    group_id: Mapped[int] = mapped_column(ForeignKey("security_groups.id"), primary_key=True)
    permission_id: Mapped[int] = mapped_column(
        ForeignKey("security_permissions.id"),
        primary_key=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    group: Mapped[SecurityGroup] = relationship(
        back_populates="group_permissions",
        overlaps="groups,permissions",
    )
    permission: Mapped[SecurityPermission] = relationship(
        back_populates="group_permissions",
        overlaps="groups,permissions",
    )


class SecurityGroupMembership(Base):
    __tablename__ = "security_group_memberships"

    group_id: Mapped[int] = mapped_column(ForeignKey("security_groups.id"), primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    group: Mapped[SecurityGroup] = relationship(back_populates="memberships")
    user: Mapped[User] = relationship(back_populates="security_group_memberships")


class SecurityGroupRole(Base):
    __tablename__ = "security_group_roles"
    __mapper_args__ = {"confirm_deleted_rows": False}

    group_id: Mapped[int] = mapped_column(ForeignKey("security_groups.id"), primary_key=True)
    role_id: Mapped[int] = mapped_column(ForeignKey("security_roles.id"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    group: Mapped[SecurityGroup] = relationship(back_populates="group_roles")


class SecurityGroup(Base):
    __tablename__ = "security_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str | None] = mapped_column(
        String(DEFAULT_STRING_LENGTH),
        unique=True,
        index=True,
        nullable=True,
    )
    display_name: Mapped[str] = mapped_column(String(DEFAULT_STRING_LENGTH))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    system: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )

    memberships: Mapped[list[SecurityGroupMembership]] = relationship(
        back_populates="group",
        cascade="all, delete-orphan",
    )
    users: Mapped[list[User]] = relationship(
        secondary="security_group_memberships",
        back_populates="security_groups",
        viewonly=True,
    )
    group_permissions: Mapped[list[SecurityGroupPermission]] = relationship(
        back_populates="group",
        cascade="all, delete-orphan",
        overlaps="groups,permissions",
    )
    permissions: Mapped[list[SecurityPermission]] = relationship(
        secondary="security_group_permissions",
        back_populates="groups",
        overlaps="group,group_permissions,permission",
        viewonly=True,
    )
    group_roles: Mapped[list[SecurityGroupRole]] = relationship(
        back_populates="group",
        cascade="all, delete-orphan",
    )
    roles: Mapped[list[SecurityRole]] = relationship(
        secondary="security_group_roles",
        viewonly=True,
    )
