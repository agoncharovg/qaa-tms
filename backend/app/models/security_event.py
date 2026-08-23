"""Durable security administration audit model."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.constants import DEFAULT_STRING_LENGTH
from app.core.db_types import json_variant
from app.core.time import utcnow
from app.db.base import Base

if TYPE_CHECKING:
    from app.models.user import User

payload_column = json_variant()


class SecurityEvent(Base):
    __tablename__ = "security_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    event_type: Mapped[str] = mapped_column(String(DEFAULT_STRING_LENGTH), index=True)
    target_type: Mapped[str] = mapped_column(String(DEFAULT_STRING_LENGTH), index=True)
    target_id: Mapped[str | None] = mapped_column(String(DEFAULT_STRING_LENGTH), nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(payload_column, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    actor_user: Mapped[User | None] = relationship(back_populates="security_events")
