"""User model.

Agent-scoped Jenkins, kube, and qaa-generator credentials stay out of this
model because they are consumed by the local companion on the user's machine.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.constants import DEFAULT_STRING_LENGTH
from app.core.time import utcnow
from app.db.base import Base

if TYPE_CHECKING:
    from app.models.auth_login_event import AuthLoginEvent
    from app.models.jenkins_freeze import JenkinsFreeze
    from app.models.jenkins_resume_run import JenkinsResumeRun
    from app.models.operation import Operation
    from app.models.security_event import SecurityEvent
    from app.models.security_group import SecurityGroup, SecurityGroupMembership
    from app.models.security_role import SecurityRole
    from app.models.user_extra_permission import UserExtraPermission


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(DEFAULT_STRING_LENGTH), unique=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(DEFAULT_STRING_LENGTH), nullable=True)
    display_name: Mapped[str] = mapped_column(String(DEFAULT_STRING_LENGTH))
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    auto_login: Mapped[bool] = mapped_column(Boolean, default=False)
    session_version: Mapped[int] = mapped_column(Integer, default=1)
    role_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("security_roles.id", ondelete="SET NULL"),
        nullable=True,
    )
    group_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("security_groups.id", ondelete="SET NULL"),
        nullable=True,
    )
    enabled_plugins: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )

    auth_login_events: Mapped[list[AuthLoginEvent]] = relationship(
        back_populates="user",
        passive_deletes=True,
    )
    security_events: Mapped[list[SecurityEvent]] = relationship(
        back_populates="actor_user",
        passive_deletes=True,
    )
    role: Mapped[SecurityRole | None] = relationship(foreign_keys=[role_id])
    group: Mapped[SecurityGroup | None] = relationship(foreign_keys=[group_id])
    extra_permissions: Mapped[list[UserExtraPermission]] = relationship(
        back_populates="user",
        foreign_keys="UserExtraPermission.user_id",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    security_group_memberships: Mapped[list[SecurityGroupMembership]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    security_groups: Mapped[list[SecurityGroup]] = relationship(
        secondary="security_group_memberships",
        back_populates="users",
        viewonly=True,
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
