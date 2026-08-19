"""Jenkins resume campaign store schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.core.constants import JenkinsResumeItemState, JenkinsResumeRunStatus


class JenkinsResumeItem(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    path: str
    name: str
    full_name: str = Field(alias="fullName")
    scheduled: bool
    state: JenkinsResumeItemState
    reason: str | None = None


class JenkinsResumeRunCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    freeze_id: UUID = Field(alias="freezeId")
    restart_pipelines: bool = Field(default=True, alias="restartPipelines")
    folder_path: str | None = Field(default=None, alias="folderPath")


class JenkinsResumeProgressPut(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    path: str
    state: Literal[JenkinsResumeItemState.STARTED, JenkinsResumeItemState.ERROR]
    reason: str | None = None
    next_path: str | None = Field(default=None, alias="nextPath")
    next_name: str | None = Field(default=None, alias="nextName")


class JenkinsResumeRunRead(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: UUID
    freeze_id: UUID = Field(alias="freezeId")
    restart_pipelines: bool = Field(alias="restartPipelines")
    signature: str
    status: JenkinsResumeRunStatus
    total: int
    started_count: int = Field(alias="startedCount")
    skipped_count: int = Field(alias="skippedCount")
    error_count: int = Field(alias="errorCount")
    current_path: str | None = Field(default=None, alias="currentPath")
    current_name: str | None = Field(default=None, alias="currentName")
    items: list[JenkinsResumeItem] = Field(default_factory=list)
    created_by: str = Field(alias="createdBy")
    created_at: datetime = Field(alias="createdAt")
    cancelled_by: str | None = Field(default=None, alias="cancelledBy")
    finished_at: datetime | None = Field(default=None, alias="finishedAt")
    stale: bool
