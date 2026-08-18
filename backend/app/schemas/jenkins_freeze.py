"""Jenkins freeze store schemas."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.constants import JenkinsFreezeStatus


class JenkinsFreezeSnapshotItem(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    path: str
    full_name: str = Field(alias="fullName")
    name: str
    was_disabled: bool = Field(alias="wasDisabled")
    scheduled: bool
    was_building: bool = Field(alias="wasBuilding")


class JenkinsFreezeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    folder_path: str = Field(alias="folderPath", min_length=1)
    folder_name: str = Field(alias="folderName", min_length=1)
    signature: str = Field(min_length=1)
    reason: str
    kill_builds: bool = Field(alias="killBuilds")

    @field_validator("reason")
    @classmethod
    def validate_reason(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Reason must not be empty.")
        return stripped


class JenkinsFreezeSnapshotPut(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    snapshot: list[JenkinsFreezeSnapshotItem] = Field(default_factory=list)
    merge_freeze_ids: list[UUID] = Field(default_factory=list, alias="mergeFreezeIds")


class JenkinsFreezeRead(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: UUID
    folder_path: str = Field(alias="folderPath")
    folder_name: str = Field(alias="folderName")
    signature: str
    reason: str
    kill_builds: bool = Field(alias="killBuilds")
    status: JenkinsFreezeStatus
    applied: bool
    snapshot: list[JenkinsFreezeSnapshotItem] = Field(default_factory=list)
    created_by: str = Field(alias="createdBy")
    created_at: datetime = Field(alias="createdAt")
    resolved_by: str | None = Field(default=None, alias="resolvedBy")
    resolved_at: datetime | None = Field(default=None, alias="resolvedAt")
    merged_into_id: UUID | None = Field(default=None, alias="mergedIntoId")
