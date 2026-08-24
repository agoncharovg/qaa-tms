"""Security permission catalog model."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.constants import DEFAULT_STRING_LENGTH
from app.core.time import utcnow
from app.db.base import Base

if TYPE_CHECKING:
    from app.models.security_group import SecurityGroup, SecurityGroupPermission
    from app.models.security_role import SecurityRole, SecurityRolePermission


class SecurityPermission(Base):
    __tablename__ = "security_permissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(DEFAULT_STRING_LENGTH), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(DEFAULT_STRING_LENGTH))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    system: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )

    role_permissions: Mapped[list[SecurityRolePermission]] = relationship(
        back_populates="permission",
        cascade="all, delete-orphan",
        overlaps="permissions,roles",
    )
    roles: Mapped[list[SecurityRole]] = relationship(
        secondary="security_role_permissions",
        back_populates="permissions",
        overlaps="permission,role_permissions",
        viewonly=True,
    )
    group_permissions: Mapped[list[SecurityGroupPermission]] = relationship(
        back_populates="permission",
        cascade="all, delete-orphan",
        overlaps="groups,permissions",
    )
    groups: Mapped[list[SecurityGroup]] = relationship(
        secondary="security_group_permissions",
        back_populates="permissions",
        overlaps="group,group_permissions,permission",
        viewonly=True,
    )
