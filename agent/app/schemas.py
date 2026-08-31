"""Request and response schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
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
    self_update_supported: bool = Field(alias="selfUpdateSupported")
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


type NotebookFlags = dict[str, object]


class NotebookBookmarkWriteNode(BaseModel):
    """Bookmark node written into `__contents__`."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    children: list[NotebookBookmarkWriteNode] = Field(default_factory=list)
    flags: NotebookFlags = Field(default_factory=dict)
    notes: dict[str, NotebookFlags] = Field(default_factory=dict)


class NotebookBookmarkNode(BaseModel):
    """Resolved bookmark tree entry returned to the frontend."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str
    note_count: int = Field(alias="noteCount")
    flags: NotebookFlags = Field(default_factory=dict)
    children: list[NotebookBookmarkNode] = Field(default_factory=list)


class NotebookContentsWriteRequest(BaseModel):
    """Whole-tree notebook contents update payload."""

    model_config = ConfigDict(extra="forbid")

    bookmarks: list[NotebookBookmarkWriteNode] = Field(default_factory=list)


class NotebookReorderRequest(BaseModel):
    """Bookmark reorder payload — an ordered list of bookmark names."""

    model_config = ConfigDict(extra="forbid")

    bookmarks: list[str] = Field(min_length=1)


class NotebookContentsResponse(BaseModel):
    """Notebook bookmark tree response."""

    model_config = ConfigDict(extra="forbid")

    bookmarks: list[NotebookBookmarkNode] = Field(default_factory=list)


class NotebookBookmarkCreateRequest(BaseModel):
    """Bookmark create payload."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    flags: NotebookFlags = Field(default_factory=dict)


class NotebookBookmarkUpdateRequest(BaseModel):
    """Bookmark rename and flags update payload."""

    model_config = ConfigDict(extra="forbid")

    bookmark: str = Field(min_length=1)
    name: str | None = Field(default=None, min_length=1)
    flags: NotebookFlags | None = None


class NotebookNoteSummary(BaseModel):
    """Notebook note row returned for a bookmark."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str
    preview_lines: list[str] = Field(default_factory=list, alias="previewLines")
    flags: NotebookFlags = Field(default_factory=dict)


class NotebookNotesResponse(BaseModel):
    """Notebook notes listed for a bookmark."""

    model_config = ConfigDict(extra="forbid")

    bookmark: str
    notes: list[NotebookNoteSummary] = Field(default_factory=list)


class NotebookReminder(BaseModel):
    """Active notebook reminder row."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    bookmark: str
    name: str
    remind_at: str = Field(alias="remindAt")
    preview_lines: list[str] = Field(default_factory=list, alias="previewLines")


class NotebookRemindersResponse(BaseModel):
    """Notebook reminder list response."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    reminders: list[NotebookReminder] = Field(default_factory=list)


class NotebookNoteReadResponse(BaseModel):
    """Full notebook note payload."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    bookmark: str
    name: str
    text: str
    preview_lines: list[str] = Field(default_factory=list, alias="previewLines")
    flags: NotebookFlags = Field(default_factory=dict)


class NotebookNoteCreateRequest(BaseModel):
    """Notebook note create payload."""

    model_config = ConfigDict(extra="forbid")

    bookmark: str = Field(min_length=1)
    name: str | None = Field(default=None, min_length=1)
    text: str
    flags: NotebookFlags | None = None


class NotebookNoteUpdateRequest(BaseModel):
    """Notebook note update payload."""

    model_config = ConfigDict(extra="forbid")

    bookmark: str = Field(min_length=1)
    text: str | None = None
    flags: NotebookFlags | None = None


class NotebookSearchMatch(BaseModel):
    """Notebook search hit."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    bookmark: str
    name: str
    preview_lines: list[str] = Field(default_factory=list, alias="previewLines")


class NotebookSearchResponse(BaseModel):
    """Notebook search response."""

    model_config = ConfigDict(extra="forbid")

    query: str
    matches: list[NotebookSearchMatch] = Field(default_factory=list)


type RequestsFlags = dict[str, object]
type RequestMethod = Literal["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
type RequestBodyMode = Literal["none", "json", "raw", "form"]
type CredentialType = Literal["bearer", "api_key_permanent", "login_password", "client_admin"]


class RequestsFolderWriteNode(BaseModel):
    """Folder node written into the requests `__contents__` tree."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str = Field(min_length=1)
    children: list[RequestsFolderWriteNode] = Field(default_factory=list)
    flags: RequestsFlags = Field(default_factory=dict)
    items: dict[str, RequestsFlags] = Field(default_factory=dict)


class RequestsFolderNode(BaseModel):
    """Resolved requests folder entry returned to the frontend."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str
    item_count: int = Field(alias="itemCount")
    flags: RequestsFlags = Field(default_factory=dict)
    children: list[RequestsFolderNode] = Field(default_factory=list)


class RequestsTreeWriteRequest(BaseModel):
    """Whole-tree requests contents update payload."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    folders: list[RequestsFolderWriteNode] = Field(default_factory=list)


class RequestsReorderRequest(BaseModel):
    """Folder reorder payload."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    folders: list[str] = Field(min_length=1)


class RequestsTreeResponse(BaseModel):
    """Requests folder tree response."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    folders: list[RequestsFolderNode] = Field(default_factory=list)


class RequestsFolderCreateRequest(BaseModel):
    """Folder create payload."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str = Field(min_length=1)
    flags: RequestsFlags = Field(default_factory=dict)


class RequestsFolderUpdateRequest(BaseModel):
    """Folder rename and flags update payload."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    folder: str = Field(min_length=1)
    name: str | None = Field(default=None, min_length=1)
    flags: RequestsFlags | None = None


class RequestHeaderField(BaseModel):
    """Editable request header row."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str = ""
    value: str = ""
    enabled: bool = True


class RequestQueryParam(BaseModel):
    """Editable request query parameter row."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str = ""
    value: str = ""
    enabled: bool = True


class RequestHeaderValue(BaseModel):
    """Resolved request or response header row."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str
    value: str


class RequestBody(BaseModel):
    """Saved request body payload."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    mode: RequestBodyMode = "none"
    content: str = ""


class RequestDocumentInput(BaseModel):
    """Saved request document fields before timestamps are assigned."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    method: RequestMethod
    url: str = Field(min_length=1)
    headers: list[RequestHeaderField] = Field(default_factory=list)
    query_params: list[RequestQueryParam] = Field(default_factory=list, alias="queryParams")
    body: RequestBody = Field(default_factory=RequestBody)
    credential_id: str | None = Field(default=None, alias="credentialId")


class RequestDocument(RequestDocumentInput):
    """Saved request document persisted on disk."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class RequestItemCreateRequest(RequestDocumentInput):
    """Request item create payload."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    folder: str = Field(min_length=1)
    name: str | None = Field(default=None, min_length=1)


class RequestItemUpdateRequest(BaseModel):
    """Request item update payload."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    folder: str = Field(min_length=1)
    method: RequestMethod | None = None
    url: str | None = Field(default=None, min_length=1)
    headers: list[RequestHeaderField] | None = None
    query_params: list[RequestQueryParam] | None = Field(default=None, alias="queryParams")
    body: RequestBody | None = None
    credential_id: str | None = Field(default=None, alias="credentialId")


class RequestItemSummary(BaseModel):
    """Saved request item summary row."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str
    method: RequestMethod
    url: str
    credential_id: str | None = Field(default=None, alias="credentialId")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class RequestsItemsResponse(BaseModel):
    """Saved request items listed for a folder."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    folder: str
    items: list[RequestItemSummary] = Field(default_factory=list)


class RequestItemReadResponse(RequestDocument):
    """Full saved request item payload."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    folder: str
    name: str


class EnvironmentColumn(BaseModel):
    """Saved environment column returned to the frontend."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str
    name: str
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class EnvironmentVariableRow(BaseModel):
    """Matrix row keyed by variable name."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str
    key: str = Field(min_length=1)
    secret: bool = False
    enabled: bool = True
    values: dict[str, str] = Field(default_factory=dict)
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class EnvironmentsStateResponse(BaseModel):
    """Environments columns, variable matrix, and active selection."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    active_id: str | None = Field(default=None, alias="activeId")
    environments: list[EnvironmentColumn] = Field(default_factory=list)
    variables: list[EnvironmentVariableRow] = Field(default_factory=list)
    renamed_references: int | None = Field(default=None, alias="renamedReferences")


class EnvironmentCreateRequest(BaseModel):
    """Environment create payload."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str = Field(min_length=1)


class EnvironmentUpdateRequest(BaseModel):
    """Environment update payload."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str | None = Field(default=None, min_length=1)


class VariableCreateRequest(BaseModel):
    """Variable row create payload."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    key: str = Field(min_length=1)
    secret: bool = False
    enabled: bool = True
    values: dict[str, str] = Field(default_factory=dict)


class VariableUpdateRequest(BaseModel):
    """Variable row update payload."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    key: str | None = Field(default=None, min_length=1)
    secret: bool | None = None
    enabled: bool | None = None
    values: dict[str, str] | None = None


class EnvironmentActiveRequest(BaseModel):
    """Active environment update payload."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    environment_id: str | None = Field(alias="environmentId")


class BearerCredentialPublicConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    token: str = ""


class ApiKeyPermanentCredentialPublicConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    verify_url: str = Field(alias="verifyUrl")
    scheme: str
    permanent_token: str = Field(default="", alias="permanentToken")


class LoginPasswordCredentialPublicConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    login_url: str = Field(alias="loginUrl")
    username: str
    referer: str
    password: str = ""


class ClientAdminCredentialPublicConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    admin_credential_id: str = Field(alias="adminCredentialId")
    admin_token_url: str = Field(alias="adminTokenUrl")
    client_id: int = Field(alias="clientId")
    issue_by_current_user: bool = Field(alias="issueByCurrentUser")


class BearerCredentialCreateConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    token: str = Field(min_length=1)


class ApiKeyPermanentCredentialCreateConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    permanent_token: str = Field(min_length=1, alias="permanentToken")
    verify_url: str = Field(min_length=1, alias="verifyUrl")
    scheme: str = Field(default="APIKey", min_length=1)


class LoginPasswordCredentialCreateConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    login_url: str = Field(min_length=1, alias="loginUrl")
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)
    referer: str = Field(min_length=1)


class ClientAdminCredentialCreateConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    admin_credential_id: str = Field(min_length=1, alias="adminCredentialId")
    admin_token_url: str = Field(min_length=1, alias="adminTokenUrl")
    client_id: int = Field(alias="clientId")
    issue_by_current_user: bool = Field(default=True, alias="issueByCurrentUser")


class BearerCredentialUpdateConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    token: str | None = None


class ApiKeyPermanentCredentialUpdateConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    permanent_token: str | None = Field(default=None, alias="permanentToken")
    verify_url: str | None = Field(default=None, alias="verifyUrl")
    scheme: str | None = None


class LoginPasswordCredentialUpdateConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    login_url: str | None = Field(default=None, alias="loginUrl")
    username: str | None = None
    password: str | None = None
    referer: str | None = None


class ClientAdminCredentialUpdateConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    admin_credential_id: str | None = Field(default=None, alias="adminCredentialId")
    admin_token_url: str | None = Field(default=None, alias="adminTokenUrl")
    client_id: int | None = Field(default=None, alias="clientId")
    issue_by_current_user: bool | None = Field(default=None, alias="issueByCurrentUser")


class BearerCredentialPublic(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str
    name: str
    type: Literal["bearer"]
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")
    config: BearerCredentialPublicConfig


class ApiKeyPermanentCredentialPublic(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str
    name: str
    type: Literal["api_key_permanent"]
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")
    config: ApiKeyPermanentCredentialPublicConfig


class LoginPasswordCredentialPublic(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str
    name: str
    type: Literal["login_password"]
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")
    config: LoginPasswordCredentialPublicConfig


class ClientAdminCredentialPublic(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str
    name: str
    type: Literal["client_admin"]
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")
    config: ClientAdminCredentialPublicConfig


class BearerCredentialCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str = Field(min_length=1)
    type: Literal["bearer"]
    config: BearerCredentialCreateConfig


class ApiKeyPermanentCredentialCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str = Field(min_length=1)
    type: Literal["api_key_permanent"]
    config: ApiKeyPermanentCredentialCreateConfig


class LoginPasswordCredentialCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str = Field(min_length=1)
    type: Literal["login_password"]
    config: LoginPasswordCredentialCreateConfig


class ClientAdminCredentialCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str = Field(min_length=1)
    type: Literal["client_admin"]
    config: ClientAdminCredentialCreateConfig


class BearerCredentialUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str | None = Field(default=None, min_length=1)
    type: Literal["bearer"]
    config: BearerCredentialUpdateConfig = Field(default_factory=BearerCredentialUpdateConfig)


class ApiKeyPermanentCredentialUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str | None = Field(default=None, min_length=1)
    type: Literal["api_key_permanent"]
    config: ApiKeyPermanentCredentialUpdateConfig = Field(
        default_factory=ApiKeyPermanentCredentialUpdateConfig
    )


class LoginPasswordCredentialUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str | None = Field(default=None, min_length=1)
    type: Literal["login_password"]
    config: LoginPasswordCredentialUpdateConfig = Field(
        default_factory=LoginPasswordCredentialUpdateConfig
    )


class ClientAdminCredentialUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str | None = Field(default=None, min_length=1)
    type: Literal["client_admin"]
    config: ClientAdminCredentialUpdateConfig = Field(
        default_factory=ClientAdminCredentialUpdateConfig
    )


type CredentialPublic = Annotated[
    BearerCredentialPublic
    | ApiKeyPermanentCredentialPublic
    | LoginPasswordCredentialPublic
    | ClientAdminCredentialPublic,
    Field(discriminator="type"),
]

type CredentialCreateRequest = Annotated[
    BearerCredentialCreate
    | ApiKeyPermanentCredentialCreate
    | LoginPasswordCredentialCreate
    | ClientAdminCredentialCreate,
    Field(discriminator="type"),
]

type CredentialUpdateRequest = Annotated[
    BearerCredentialUpdate
    | ApiKeyPermanentCredentialUpdate
    | LoginPasswordCredentialUpdate
    | ClientAdminCredentialUpdate,
    Field(discriminator="type"),
]


class CredentialsListResponse(BaseModel):
    """Credential metadata list response."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    credentials: list[CredentialPublic] = Field(default_factory=list)


class CredentialResolveRequest(BaseModel):
    """Credential resolve payload."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    credential_id: str = Field(min_length=1, alias="credentialId")
    environment_id: str | None = Field(default=None, alias="environmentId")
    force: bool = False


class CredentialResolveResponse(BaseModel):
    """Credential resolve response without exposing the token."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    ok: bool
    expires_at: str | None = Field(default=None, alias="expiresAt")
    error: str | None = None


class RequestSummary(BaseModel):
    """Redacted executed request summary."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    method: RequestMethod
    url: str
    headers: list[RequestHeaderValue] = Field(default_factory=list)
    query_params: list[RequestHeaderValue] = Field(default_factory=list, alias="queryParams")


class RequestExecuteRequest(RequestDocumentInput):
    """Execute request payload."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    environment_id: str | None = Field(default=None, alias="environmentId")


class RequestExecuteResponse(BaseModel):
    """Execute request response."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    status_code: int | None = Field(alias="statusCode")
    reason_phrase: str | None = Field(default=None, alias="reasonPhrase")
    elapsed_ms: int | None = Field(default=None, alias="elapsedMs")
    size_bytes: int = Field(alias="sizeBytes")
    headers: list[RequestHeaderValue] = Field(default_factory=list)
    body_text: str = Field(alias="bodyText")
    truncated: bool = False
    error: str | None = None
    request_summary: RequestSummary = Field(alias="requestSummary")


class HistoryResponseSummary(BaseModel):
    """Stored response summary for the execution history."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    status_code: int | None = Field(alias="statusCode")
    elapsed_ms: int | None = Field(default=None, alias="elapsedMs")
    size_bytes: int = Field(alias="sizeBytes")
    error: str | None = None


class HistoryEntry(BaseModel):
    """Saved requests history row."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str
    at: str
    request_summary: RequestSummary = Field(alias="requestSummary")
    response_summary: HistoryResponseSummary = Field(alias="responseSummary")


class HistoryListResponse(BaseModel):
    """Saved requests history response."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    entries: list[HistoryEntry] = Field(default_factory=list)


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


class KubeExecRequest(BaseModel):
    """Kube pod exec request."""

    model_config = ConfigDict(extra="forbid")

    namespace: str = Field(min_length=1)
    context: str | None = None
    container: str | None = None
    command: str = Field(min_length=1)


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


class JenkinsAllureSkipCandidate(BaseModel):
    """Candidate test imported from one or more Allure reports."""

    model_config = ConfigDict(extra="forbid")

    full_name: str
    name: str
    product: str | None = None


class JenkinsAllureSkipCandidatesError(BaseModel):
    """Per-report import error returned alongside partial Allure results."""

    model_config = ConfigDict(extra="forbid")

    report_url: str
    message: str


class JenkinsAllureSkipCandidatesRequest(BaseModel):
    """`/jenkins/allure/skip-candidates` request body."""

    model_config = ConfigDict(extra="forbid")

    report_urls: list[str] = Field(min_length=1)
    product: str | None = None


class JenkinsAllureSkipCandidatesResponse(BaseModel):
    """`/jenkins/allure/skip-candidates` response body."""

    model_config = ConfigDict(extra="forbid")

    candidates: list[JenkinsAllureSkipCandidate] = Field(default_factory=list)
    errors: list[JenkinsAllureSkipCandidatesError] = Field(default_factory=list)


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
