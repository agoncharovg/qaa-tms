"""Operation schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.core.constants import OperationStatus, OperationType, Product


class OperationRecipe(BaseModel):
    product: Product | None = None
    services: list[str] = Field(default_factory=list)
    images: dict[str, str] = Field(default_factory=dict)
    suites: list[str] = Field(default_factory=list)
    flags: dict[str, Any] = Field(default_factory=dict)


class OperationUpsertRequest(BaseModel):
    id: UUID | None = None
    type: OperationType
    ns: str | None = None
    recipe: OperationRecipe
    status: OperationStatus = OperationStatus.QUEUED
    started_at: datetime | None = None
    finished_at: datetime | None = None
    log: str | None = None
    exit_code: int | None = None
    agent_host: str | None = None
    agent_version: str | None = None
    stagings_sha: str | None = None


class OperationSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: int
    type: OperationType
    ns: str | None
    recipe: OperationRecipe
    status: OperationStatus
    started_at: datetime
    finished_at: datetime | None
    exit_code: int | None
    agent_host: str | None
    agent_version: str | None
    stagings_sha: str | None
    created_at: datetime


class OperationRead(OperationSummary):
    log: str | None


class OperationReplayResponse(BaseModel):
    id: UUID
    type: OperationType
    ns: str | None
    recipe: OperationRecipe


class OperationListResponse(BaseModel):
    items: list[OperationSummary]
    total: int
    limit: int
    offset: int
