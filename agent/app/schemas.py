"""Request and response schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.core.constants import JobStatus, PreflightKey, Product


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

    clean: bool = False
    full: bool = False
    dry_run: bool = Field(default=False, alias="dryRun")
    no_sync: bool = Field(default=False, alias="noSync")
    stage: int | None = Field(default=None, ge=0, le=7)

    def to_recipe(self) -> dict[str, bool | int | None]:
        """Return replay-safe camelCase flags for backend audit storage."""

        return {
            "clean": self.clean,
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


class DestroyRequest(BaseModel):
    """Destroy request body."""

    model_config = ConfigDict(extra="forbid")

    ns: str = Field(min_length=1)


class AdoptRequest(BaseModel):
    """Adopt request body."""

    model_config = ConfigDict(extra="forbid")

    ns: str = Field(min_length=1)


class SyncFlags(BaseModel):
    """Sync flags from the frontend wire contract."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    service: str | None = None
    verbose: bool = False
    pull: bool = False
    apply: bool = False

    def to_recipe(self) -> dict[str, str | bool | None]:
        """Return sync flags in the backend audit shape."""

        return {
            "service": self.service,
            "verbose": self.verbose,
            "pull": self.pull,
            "apply": self.apply,
        }


class SyncRequest(BaseModel):
    """Sync request body."""

    model_config = ConfigDict(extra="forbid")

    flags: SyncFlags = Field(default_factory=SyncFlags)


class E2eSuite(BaseModel):
    """Named suite from the static product registry."""

    model_config = ConfigDict(extra="forbid")

    name: str
    marks: str


class E2eSuitesResponse(BaseModel):
    """`/e2e/suites` response shape."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    product: Product
    suites: list[E2eSuite] = Field(default_factory=list)
    exit_code: int = Field(alias="exitCode")


class E2eRunRequest(BaseModel):
    """E2E run request body."""

    model_config = ConfigDict(extra="forbid")

    ns: str = Field(min_length=1)
    product: Product
    suites: list[str] = Field(default_factory=list)
    threads: int | None = Field(default=None, ge=1)


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


class ClusterNamespaceEntry(BaseModel):
    """Best-effort parsed cluster namespace row."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str
    status: str
    created_at: str | None = Field(default=None, alias="createdAt")


class LocalOverlayEntry(BaseModel):
    """Best-effort parsed local overlay row."""

    model_config = ConfigDict(extra="forbid")

    name: str


class NamespaceListResponse(BaseModel):
    """`/namespaces` response shape."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    raw: str
    cluster_namespaces: list[ClusterNamespaceEntry] = Field(alias="clusterNamespaces")
    local_overlays: list[LocalOverlayEntry] = Field(alias="localOverlays")
    exit_code: int = Field(alias="exitCode")


class NamespaceStatusResponse(BaseModel):
    """`/namespaces/{ns}/status` response shape."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    ns: str
    raw: str
    exit_code: int = Field(alias="exitCode")


class NamespaceCredsResponse(BaseModel):
    """`/namespaces/{ns}/creds` response shape."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    ns: str
    raw: str
    exit_code: int = Field(alias="exitCode")


class DeployRecipePayload(BaseModel):
    """Deploy recipe reused to prefill redeploys."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    product: Product | None = None
    services: list[str] = Field(default_factory=list)
    images: dict[str, str] = Field(default_factory=dict)
    suites: list[str] = Field(default_factory=list)
    flags: DeployFlags = Field(default_factory=DeployFlags)


class NamespaceDeployRecipeResponse(BaseModel):
    """`/namespaces/{ns}/deploy-recipe` response shape."""

    model_config = ConfigDict(extra="forbid")

    ns: str
    recipe: DeployRecipePayload
