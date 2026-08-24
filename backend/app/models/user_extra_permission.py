"""User extra (individual) permission model."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.time import utcnow
from app.db.base import Base

if TYPE_CHECKING:
    from app.models.security_permission import SecurityPermission
    from app.models.user import User


class UserExtraPermission(Base):
    __tablename__ = "user_extra_permissions"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    permission_id: Mapped[int] = mapped_column(
        ForeignKey("security_permissions.id", ondelete="CASCADE"),
        primary_key=True,
    )
    granted_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped[User] = relationship(
        foreign_keys=[user_id],
        back_populates="extra_permissions",
    )
    permission: Mapped[SecurityPermission] = relationship()
    granted_by: Mapped[User | None] = relationship(foreign_keys=[granted_by_id])
