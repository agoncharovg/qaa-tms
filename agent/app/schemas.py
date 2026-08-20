"""Request and response schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.core.config import JenkinsRootGroup, Settings
from app.core.constants import (
    MAX_STAGE,
    MIN_STAGE,
    AgentUpdateStatus,
    JenkinsNodeKind,
    JenkinsResumeItemState,
    JenkinsResumeResult,
    JenkinsResumeRunStatus,
    JenkinsStatus,
    JobStatus,
    KubeconfigAction,
    KubeconfigReason,
    PreflightKey,
    Product,
)


class AgentPingResponse(BaseModel):
    """Exact `/ping` response shape expected by the frontend."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    app: str
    version: str
    stagings_installed: bool = Field(alias="stagingsInstalled")
    stagings_sha: str | None = Field(alias="stagingsSha")
    os: str


class AgentUpdateAccepted(BaseModel):
    """Accepted response for the detached update workflow."""

    model_config = ConfigDict(extra="forbid")

    status: AgentUpdateStatus


class PreflightItem(BaseModel):
    """Exact `/preflight` item shape expected by the frontend."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    key: PreflightKey
    ok: bool
    detail: str
    how_to: str = Field(alias="howTo")


class AgentSettingsRead(BaseModel):
    """Editable companion settings returned to the authenticated frontend."""

    model_config = ConfigDict(extra="forbid")

    jenkins_url: str
    jenkins_username: str
    jenkins_token_set: bool
    jenkins_root_groups: list[JenkinsRootGroup]
    qaa_generator_token_set: bool
    jenkins_root_folders: list[str]
    jenkins_history_limit: int
    jenkins_request_timeout: float
    jenkins_tree_depth: int
    jenkins_stuck_min_idle_hours: int
    staging_bin: str | None
    stagings_repo: str | None
    staging_kubeconfig: str
    staging_kubeconfig_url: str
    kubeconfig_active_path: str
    staging_kubeconfig_max_age_hours: int
    kubectl_bin: str
    kubeconfig: str
    kubectl_request_timeout: str


class AgentSettingsUpdate(BaseModel):
    """Editable companion settings update payload."""

    model_config = ConfigDict(extra="forbid")

    jenkins_url: str | None = None
    jenkins_username: str | None = None
    jenkins_token: str | None = None
    jenkins_root_groups: list[JenkinsRootGroup] | None = None
    qaa_generator_token: str | None = None
    jenkins_root_folders: list[str] | None = None
    jenkins_history_limit: int | None = None
    jenkins_request_timeout: float | None = None
    jenkins_tree_depth: int | None = None
    jenkins_stuck_min_idle_hours: int | None = None
    staging_bin: str | None = None
    stagings_repo: str | None = None
    staging_kubeconfig: str | None = None
    staging_kubeconfig_url: str | None = None
    kubeconfig_active_path: str | None = None
    staging_kubeconfig_max_age_hours: int | None = None
    kubectl_bin: str | None = None
    kubeconfig: str | None = None
    kubectl_request_timeout: str | None = None


def to_agent_settings_read(settings: Settings) -> AgentSettingsRead:
    return AgentSettingsRead(
        jenkins_url=settings.jenkins_url,
        jenkins_username=settings.jenkins_username,
        jenkins_token_set=bool(settings.jenkins_token),
        jenkins_root_groups=list(settings.jenkins_root_groups),
        qaa_generator_token_set=bool(settings.qaa_generator_token),
        jenkins_root_folders=list(settings.jenkins_root_folders),
        jenkins_history_limit=settings.jenkins_history_limit,
        jenkins_request_timeout=settings.jenkins_request_timeout,
        jenkins_tree_depth=settings.jenkins_tree_depth,
        jenkins_stuck_min_idle_hours=settings.jenkins_stuck_min_idle_hours,
        staging_bin=settings.staging_bin,
        stagings_repo=settings.stagings_repo,
        staging_kubeconfig=settings.staging_kubeconfig,
        staging_kubeconfig_url=settings.staging_kubeconfig_url,
        kubeconfig_active_path=settings.kubeconfig_active_path,
        staging_kubeconfig_max_age_hours=settings.staging_kubeconfig_max_age_hours,
        kubectl_bin=settings.kubectl_bin,
        kubeconfig=settings.kubeconfig,
        kubectl_request_timeout=settings.kubectl_request_timeout,
    )


class QaaRunCreateRequest(BaseModel):
    """QAA run create body forwarded through the local companion."""

    model_config = ConfigDict(extra="forbid")

    jira_key: str
    dry_run: bool = False
    skip_pr: bool = False
    skip_exec: bool = False
    branch: str | None = None
    profile: Literal["balanced", "codex-only", "claude-only"] = "balanced"


class KubeconfigStatus(BaseModel):
    """`/staging/kubeconfig/*` response shape."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    path: str
    active_path: str = Field(alias="activePath")
    exists: bool
    content_valid: bool = Field(alias="contentValid")
    token_expires_at: datetime | None = Field(default=None, alias="tokenExpiresAt")
    token_expired: bool = Field(alias="tokenExpired")
    modified_at: datetime | None = Field(default=None, alias="modifiedAt")
    age_seconds: int | None = Field(default=None, alias="ageSeconds")
    max_age_seconds: int = Field(alias="maxAgeSeconds")
    stale: bool
    active: bool
    healthy: bool
    recommended_action: KubeconfigAction = Field(alias="recommendedAction")
    reasons: list[KubeconfigReason] = Field(default_factory=list)
    url: str


class KubeconfigRefreshRequest(BaseModel):
    """Refresh request body for the staging kubeconfig."""

    model_config = ConfigDict(extra="forbid")

    activate: bool = True


class DeployFlags(BaseModel):
    """Deploy flags from the frontend wire contract."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    clean: bool = False
    full: bool = False
    dry_run: bool = Field(default=False, alias="dryRun")
    no_sync: bool = Field(default=False, alias="noSync")
    stage: int | None = Field(default=None, ge=MIN_STAGE, le=MAX_STAGE)

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


class KubeUseContextRequest(BaseModel):
    """Kube context activation request."""

    model_config = ConfigDict(extra="forbid")

    context: str = Field(min_length=1)


class KubeDeletePodRequest(BaseModel):
    """Kube pod deletion request."""

    model_config = ConfigDict(extra="forbid")

    context: str | None = None
    namespace: str = Field(min_length=1)


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
    image: str | None = None
    mark: str | None = None
    marks: str | None = None
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
    has_local_overlay: bool = Field(default=False, alias="hasLocalOverlay")


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


class KubeContext(BaseModel):
    """Kube context row."""

    model_config = ConfigDict(extra="forbid")

    name: str
    cluster: str
    user: str
    namespace: str | None = None
    current: bool


class KubeContextsResponse(BaseModel):
    """`/kube/contexts` response shape."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    contexts: list[KubeContext] = Field(default_factory=list)
    current_context: str | None = Field(default=None, alias="currentContext")
    exit_code: int = Field(alias="exitCode")


class KubeNamespace(BaseModel):
    """Kube namespace row."""

    model_config = ConfigDict(extra="forbid")

    name: str
    phase: str | None = None


class KubeNamespacesResponse(BaseModel):
    """`/kube/namespaces` response shape."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    namespaces: list[KubeNamespace] = Field(default_factory=list)
    exit_code: int = Field(alias="exitCode")


class KubePod(BaseModel):
    """Kube pod row."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str
    phase: str | None = None
    ready: str
    restarts: int
    containers: list[str] = Field(default_factory=list)
    node: str | None = None
    created_at: str | None = Field(default=None, alias="createdAt")


class KubePodsResponse(BaseModel):
    """`/kube/pods` response shape."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    pods: list[KubePod] = Field(default_factory=list)
    exit_code: int = Field(alias="exitCode")


class KubePodDescribeResponse(BaseModel):
    """`/kube/pods/{pod}/describe` response shape."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str
    raw: str
    exit_code: int = Field(alias="exitCode")


class KubeTopResponse(BaseModel):
    """`/kube/top` response shape."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    raw: str
    exit_code: int = Field(alias="exitCode")


class KubeCommandResult(BaseModel):
    """Shared kube command response shape."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    raw: str
    exit_code: int = Field(alias="exitCode")


class JenkinsNode(BaseModel):
    """Jenkins folder or pipeline node."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str
    path: str
    url: str
    kind: JenkinsNodeKind
    status: JenkinsStatus | None = None
    color: str | None = None
    synthetic: bool = False
    scheduled: bool = False
    builds: list[JenkinsBuild] = Field(default_factory=list)
    children: list[JenkinsNode] = Field(default_factory=list)


class JenkinsTreeResponse(BaseModel):
    """`/jenkins/tree` response shape."""

    model_config = ConfigDict(extra="forbid")

    signature: str
    roots: list[JenkinsNode] = Field(default_factory=list)


class JenkinsFolderResponse(BaseModel):
    """`/jenkins/folder` response shape (a single folder's child pipelines)."""

    model_config = ConfigDict(extra="forbid")

    roots: list[JenkinsNode] = Field(default_factory=list)


class JenkinsScopeResponse(BaseModel):
    """`/jenkins/scope` response shape."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    signature: str
    root_groups: list[JenkinsRootGroup] = Field(default_factory=list, alias="rootGroups")
    root_folders: list[str] = Field(default_factory=list, alias="rootFolders")
    tree_depth: int = Field(alias="treeDepth")
    history_limit: int = Field(alias="historyLimit")


class JenkinsBuild(BaseModel):
    """Jenkins build row."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    number: int
    result: str | None = None
    building: bool
    timestamp: int
    duration_ms: int = Field(alias="durationMs")
    url: str
    allure_url: str = Field(alias="allureUrl")


class JenkinsBuildsResponse(BaseModel):
    """`/jenkins/builds` response shape."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    builds: list[JenkinsBuild] = Field(default_factory=list)


class JenkinsFreezeSnapshotItem(BaseModel):
    """Per-pipeline state captured at freeze time."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    path: str
    full_name: str = Field(alias="fullName")
    name: str
    was_disabled: bool = Field(alias="wasDisabled")
    scheduled: bool
    was_building: bool = Field(alias="wasBuilding")


class JenkinsFreezeRequest(BaseModel):
    """`/jenkins/freeze` request body."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    folder_path: str = Field(alias="folderPath", min_length=1)
    kill_builds: bool = Field(alias="killBuilds")


class JenkinsFreezeResponse(BaseModel):
    """`/jenkins/freeze` response body."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    snapshot: list[JenkinsFreezeSnapshotItem] = Field(default_factory=list)


class JenkinsResumeOutcome(BaseModel):
    """Per-pipeline resume result."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    full_name: str = Field(alias="fullName")
    outcome: JenkinsResumeResult
    detail: str | None = None


class JenkinsResumeRequest(BaseModel):
    """`/jenkins/resume` request body."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    snapshot: list[JenkinsFreezeSnapshotItem] = Field(default_factory=list)


class JenkinsResumeResponse(BaseModel):
    """`/jenkins/resume` response body."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    outcomes: list[JenkinsResumeOutcome] = Field(default_factory=list)


class JenkinsResumeRunRequest(BaseModel):
    """`/jenkins/resume-run` request body."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    run_id: UUID = Field(alias="runId")
    snapshot: list[JenkinsFreezeSnapshotItem] = Field(default_factory=list)
    restart_pipelines: bool = Field(default=True, alias="restartPipelines")


class JenkinsResumeRunAccepted(BaseModel):
    """`/jenkins/resume-run` accepted response body."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    run_id: UUID = Field(alias="runId")


class JenkinsResumeItem(BaseModel):
    """Shared backend resume item shape consumed by the agent."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    path: str
    name: str
    full_name: str = Field(alias="fullName")
    scheduled: bool
    state: JenkinsResumeItemState
    reason: str | None = None


class JenkinsResumeProgressRequest(BaseModel):
    """Backend progress update payload for a throttled resume run."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    path: str
    state: JenkinsResumeItemState
    reason: str | None = None
    next_path: str | None = Field(default=None, alias="nextPath")
    next_name: str | None = Field(default=None, alias="nextName")


class JenkinsResumeRunRead(BaseModel):
    """Shared backend resume run shape consumed by the agent."""

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


JenkinsNode.model_rebuild()


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
