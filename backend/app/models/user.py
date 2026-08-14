"""User model.

The per-user qaa-generator token lives on the backend user record because
qaa-generator requests are proxied by the backend on behalf of the signed-in
user. Agent-scoped Jenkins and kube credentials stay out of this model because
they are consumed by the local companion on the user's machine instead.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.constants import DEFAULT_STRING_LENGTH
from app.db.base import Base

if TYPE_CHECKING:
    from app.models.operation import Operation


def utcnow() -> datetime:
    return datetime.now(UTC)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(DEFAULT_STRING_LENGTH), unique=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(DEFAULT_STRING_LENGTH), nullable=True)
    display_name: Mapped[str] = mapped_column(String(DEFAULT_STRING_LENGTH))
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    auto_login: Mapped[bool] = mapped_column(Boolean, default=False)
    enabled_plugins: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    # Used by backend-proxied qaa-generator run creation on behalf of this user.
    qaa_generator_token: Mapped[str | None] = mapped_column(
        String(DEFAULT_STRING_LENGTH),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )

    operations: Mapped[list[Operation]] = relationship(back_populates="user")
