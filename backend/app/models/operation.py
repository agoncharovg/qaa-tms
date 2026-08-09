"""Operation audit model."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, Integer, String, Text, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.constants import DatabaseDialect, OperationStatus, OperationType
from app.db.base import Base

if TYPE_CHECKING:
    from app.models.user import User


def utcnow() -> datetime:
    return datetime.now(UTC)


def enum_values(enum_type: type[OperationType] | type[OperationStatus]) -> list[str]:
    return [member.value for member in enum_type]


recipe_column = JSON().with_variant(JSONB(), DatabaseDialect.POSTGRESQL.value)


class Operation(Base):
    __tablename__ = "operations"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    type: Mapped[OperationType] = mapped_column(
        Enum(OperationType, native_enum=False, values_callable=enum_values),
        index=True,
    )
    ns: Mapped[str | None] = mapped_column(String(255), index=True, nullable=True)
    recipe: Mapped[dict[str, Any]] = mapped_column(recipe_column)
    status: Mapped[OperationStatus] = mapped_column(
        Enum(OperationStatus, native_enum=False, values_callable=enum_values),
        index=True,
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    log: Mapped[str | None] = mapped_column(Text, nullable=True)
    exit_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    agent_host: Mapped[str | None] = mapped_column(String(255), nullable=True)
    agent_version: Mapped[str | None] = mapped_column(String(255), nullable=True)
    stagings_sha: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped[User] = relationship(back_populates="operations")
