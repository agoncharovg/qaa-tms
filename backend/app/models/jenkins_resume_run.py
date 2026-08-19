"""Durable Jenkins resume campaign record."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

from sqlalchemy import Boolean, JSON, DateTime, Enum, ForeignKey, Index, Integer, String, Uuid, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.constants import (
    DEFAULT_STRING_LENGTH,
    DatabaseDialect,
    JenkinsResumeRunStatus,
)
from app.db.base import Base

if TYPE_CHECKING:
    from app.models.jenkins_freeze import JenkinsFreeze
    from app.models.user import User


def utcnow() -> datetime:
    return datetime.now(UTC)


def enum_values(enum_type: type[JenkinsResumeRunStatus]) -> list[str]:
    return [member.value for member in enum_type]


items_column = JSON().with_variant(JSONB(), DatabaseDialect.POSTGRESQL.value)


class JenkinsResumeRun(Base):
    __tablename__ = "jenkins_resume_runs"
    # DB-level global lock: at most one RUNNING campaign per scope signature, so two
    # concurrent creates cannot both launch a campaign and double-trigger every build.
    __table_args__ = (
        Index(
            "uq_jenkins_resume_runs_active",
            "signature",
            unique=True,
            postgresql_where=text("status = 'running'"),
            sqlite_where=text("status = 'running'"),
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    freeze_id: Mapped[UUID] = mapped_column(ForeignKey("jenkins_freezes.id"), index=True)
    restart_pipelines: Mapped[bool] = mapped_column(Boolean, default=True)
    target_path: Mapped[str | None] = mapped_column(String(DEFAULT_STRING_LENGTH), nullable=True)
    signature: Mapped[str] = mapped_column(String(DEFAULT_STRING_LENGTH), index=True)
    status: Mapped[JenkinsResumeRunStatus] = mapped_column(
        Enum(JenkinsResumeRunStatus, native_enum=False, values_callable=enum_values),
        index=True,
    )
    total: Mapped[int] = mapped_column(Integer)
    started_count: Mapped[int] = mapped_column(Integer, default=0)
    skipped_count: Mapped[int] = mapped_column(Integer, default=0)
    error_count: Mapped[int] = mapped_column(Integer, default=0)
    current_path: Mapped[str | None] = mapped_column(String(DEFAULT_STRING_LENGTH), nullable=True)
    current_name: Mapped[str | None] = mapped_column(String(DEFAULT_STRING_LENGTH), nullable=True)
    items: Mapped[list[dict[str, Any]]] = mapped_column(items_column, default=list)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    heartbeat_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    cancelled_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    freeze: Mapped[JenkinsFreeze] = relationship(back_populates="resume_runs")
    created_by: Mapped[User] = relationship(
        foreign_keys=[created_by_id],
        back_populates="jenkins_resume_runs_created",
    )
    cancelled_by: Mapped[User | None] = relationship(
        foreign_keys=[cancelled_by_id],
        back_populates="jenkins_resume_runs_cancelled",
    )
