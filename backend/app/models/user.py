"""User model.

Agent-scoped Jenkins, kube, and qaa-generator credentials stay out of this
model because they are consumed by the local companion on the user's machine.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.constants import DEFAULT_STRING_LENGTH
from app.core.time import utcnow
from app.db.base import Base

if TYPE_CHECKING:
    from app.models.jenkins_freeze import JenkinsFreeze
    from app.models.jenkins_resume_run import JenkinsResumeRun
    from app.models.operation import Operation



class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(DEFAULT_STRING_LENGTH), unique=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(DEFAULT_STRING_LENGTH), nullable=True)
    display_name: Mapped[str] = mapped_column(String(DEFAULT_STRING_LENGTH))
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    auto_login: Mapped[bool] = mapped_column(Boolean, default=False)
    enabled_plugins: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )

    operations: Mapped[list[Operation]] = relationship(back_populates="user")
    jenkins_freezes_created: Mapped[list[JenkinsFreeze]] = relationship(
        foreign_keys="JenkinsFreeze.created_by_id",
        back_populates="created_by",
    )
    jenkins_freezes_resolved: Mapped[list[JenkinsFreeze]] = relationship(
        foreign_keys="JenkinsFreeze.resolved_by_id",
        back_populates="resolved_by",
    )
    jenkins_resume_runs_created: Mapped[list[JenkinsResumeRun]] = relationship(
        foreign_keys="JenkinsResumeRun.created_by_id",
        back_populates="created_by",
    )
    jenkins_resume_runs_cancelled: Mapped[list[JenkinsResumeRun]] = relationship(
        foreign_keys="JenkinsResumeRun.cancelled_by_id",
        back_populates="cancelled_by",
    )
