"""Operation audit model."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.constants import (
    DEFAULT_STRING_LENGTH,
    OperationStatus,
    OperationType,
)
from app.core.db_types import enum_values, json_variant
from app.core.time import utcnow
from app.db.base import Base

if TYPE_CHECKING:
    from app.models.user import User


recipe_column = json_variant()


class Operation(Base):
    __tablename__ = "operations"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    type: Mapped[OperationType] = mapped_column(
        Enum(OperationType, native_enum=False, values_callable=enum_values),
        index=True,
    )
    ns: Mapped[str | None] = mapped_column(String(DEFAULT_STRING_LENGTH), index=True, nullable=True)
    recipe: Mapped[dict[str, Any]] = mapped_column(recipe_column)
    status: Mapped[OperationStatus] = mapped_column(
        Enum(OperationStatus, native_enum=False, values_callable=enum_values),
        index=True,
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    log: Mapped[str | None] = mapped_column(Text, nullable=True)
    exit_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    agent_host: Mapped[str | None] = mapped_column(String(DEFAULT_STRING_LENGTH), nullable=True)
    agent_version: Mapped[str | None] = mapped_column(String(DEFAULT_STRING_LENGTH), nullable=True)
    stagings_sha: Mapped[str | None] = mapped_column(String(DEFAULT_STRING_LENGTH), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped[User] = relationship(back_populates="operations")
