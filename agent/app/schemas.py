"""Request and response schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.core.constants import JobStatus, PreflightKey


class AgentPingResponse(BaseModel):
    """Exact `/ping` response shape expected by the frontend."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    app: str
    version: str
    stagings_installed: bool = Field(alias="stagingsInstalled")
    stagings_sha: str | None = Field(alias="stagingsSha")
    os: str


class PreflightItem(BaseModel):
    """Exact `/preflight` item shape expected by the frontend."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    key: PreflightKey
    ok: bool
    detail: str
    how_to: str = Field(alias="howTo")


class DeployFlags(BaseModel):
    """Deploy flags from the frontend wire contract."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    full: bool = False
    dry_run: bool = Field(default=False, alias="dryRun")
    no_sync: bool = Field(default=False, alias="noSync")
    stage: int | None = Field(default=None, ge=0, le=7)

    def to_recipe(self) -> dict[str, bool | int | None]:
        """Return replay-safe camelCase flags for backend audit storage."""

        return {
            "full": self.full,
            "dryRun": self.dry_run,
            "noSync": self.no_sync,
            "stage": self.stage,
        }


class DeployRequest(BaseModel):
    """Deploy request body."""

    model_config = ConfigDict(extra="forbid")

    ns: str = Field(min_length=1)
    services: list[str] = Field(default_factory=list)
    images: dict[str, str] = Field(default_factory=dict)
    flags: DeployFlags = Field(default_factory=DeployFlags)


class JobCreateResponse(BaseModel):
    """Response for job-creating endpoints."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    job_id: str = Field(alias="jobId")
    op_id: UUID = Field(alias="opId")


class JobReadResponse(BaseModel):
    """Job metadata."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    job_id: str = Field(alias="jobId")
    op_id: UUID = Field(alias="opId")
    status: JobStatus
    argv: list[str]
    exit_code: int | None = Field(alias="exitCode")
    created_at: datetime = Field(alias="createdAt")
    started_at: datetime | None = Field(alias="startedAt")
    finished_at: datetime | None = Field(alias="finishedAt")


class JobLogEvent(BaseModel):
    """SSE payload for a log line."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["line"]
    line: str


class JobTerminalEvent(BaseModel):
    """SSE payload for job completion."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    type: Literal["terminal"]
    status: JobStatus
    exit_code: int | None = Field(alias="exitCode")
