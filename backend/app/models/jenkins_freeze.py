"""Durable Jenkins folder freeze record."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.constants import DEFAULT_STRING_LENGTH, JenkinsFreezeStatus
from app.core.db_types import enum_values, json_variant
from app.core.time import utcnow
from app.db.base import Base

if TYPE_CHECKING:
    from app.models.jenkins_resume_run import JenkinsResumeRun
    from app.models.user import User


snapshot_column = json_variant()


class JenkinsFreeze(Base):
    __tablename__ = "jenkins_freezes"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    folder_path: Mapped[str] = mapped_column(String(DEFAULT_STRING_LENGTH), index=True)
    folder_name: Mapped[str] = mapped_column(String(DEFAULT_STRING_LENGTH))
    signature: Mapped[str] = mapped_column(String(DEFAULT_STRING_LENGTH), index=True)
    reason: Mapped[str] = mapped_column(Text)
    kill_builds: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[JenkinsFreezeStatus] = mapped_column(
        Enum(JenkinsFreezeStatus, native_enum=False, values_callable=enum_values),
        index=True,
    )
    applied: Mapped[bool] = mapped_column(Boolean, default=False)
    snapshot: Mapped[list[dict[str, Any]]] = mapped_column(snapshot_column, default=list)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    resolved_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    merged_into_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("jenkins_freezes.id"),
        nullable=True,
    )

    created_by: Mapped[User] = relationship(
        foreign_keys=[created_by_id],
        back_populates="jenkins_freezes_created",
    )
    resolved_by: Mapped[User | None] = relationship(
        foreign_keys=[resolved_by_id],
        back_populates="jenkins_freezes_resolved",
    )
    merged_into: Mapped[JenkinsFreeze | None] = relationship(remote_side=[id])
    resume_runs: Mapped[list[JenkinsResumeRun]] = relationship(back_populates="freeze")
