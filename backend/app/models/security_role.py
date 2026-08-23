"""Security role models."""

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


class SecurityRolePermission(Base):
    __tablename__ = "security_role_permissions"
    __mapper_args__ = {"confirm_deleted_rows": False}

    role_id: Mapped[int] = mapped_column(ForeignKey("security_roles.id"), primary_key=True)
    permission_id: Mapped[int] = mapped_column(
        ForeignKey("security_permissions.id"),
        primary_key=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    role: Mapped[SecurityRole] = relationship(
        back_populates="role_permissions",
        overlaps="permissions,roles",
    )
    permission: Mapped[SecurityPermission] = relationship(
        back_populates="role_permissions",
        overlaps="permissions,roles",
    )


class SecurityRole(Base):
    __tablename__ = "security_roles"

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
    mutable: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )

    role_permissions: Mapped[list[SecurityRolePermission]] = relationship(
        back_populates="role",
        cascade="all, delete-orphan",
        overlaps="permissions,roles",
    )
    permissions: Mapped[list[SecurityPermission]] = relationship(
        secondary="security_role_permissions",
        back_populates="roles",
        overlaps="permission,role,role_permissions",
    )
