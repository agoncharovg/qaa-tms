"""HTTP routes."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from typing import Annotated, cast

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import TypeAdapter, ValidationError

from app.api.deps import (
    AuthContext,
    get_job_manager,
    get_settings,
    require_auth,
    require_permission,
)
from app.core import env_file
from app.core.config import JenkinsRootGroup, Settings
from app.core.config import get_settings as load_settings
from app.core.constants import (
    DEFAULT_KUBE_LOG_TAIL,
    GROUP_LABEL_SEPARATOR,
    GROUP_LIST_SEPARATOR,
    AgentPath,
    AgentUpdateStatus,
    EnvKey,
    ErrorMessage,
    HeaderName,
    HeaderValue,
    KubeconfigAction,
    OperationType,
    PermissionKey,
    Product,
    StagingEnvKey,
)
from app.schemas import (
    AdoptRequest,
    AgentPingResponse,
    AgentSettingsRead,
    AgentSettingsUpdate,
    AgentUpdateAccepted,
    CredentialCreateRequest,
    CredentialPublic,
    CredentialResolveRequest,
    CredentialResolveResponse,
    CredentialsListResponse,
    CredentialUpdateRequest,
    DeployFlags,
    DeployRecipePayload,
    DeployRequest,
    DestroyRequest,
    E2eRunRequest,
    E2eSuite,
    E2eSuitesResponse,
    EnvironmentActiveRequest,
    EnvironmentCreateRequest,
    EnvironmentsStateResponse,
    EnvironmentUpdateRequest,
    HistoryListResponse,
    JenkinsAllureSkipCandidatesRequest,
    JenkinsAllureSkipCandidatesResponse,
    JenkinsBuildsResponse,
    JenkinsFolderResponse,
    JenkinsFreezeRequest,
    JenkinsFreezeResponse,
    JenkinsResumeRequest,
    JenkinsResumeResponse,
    JenkinsResumeRunAccepted,
    JenkinsResumeRunRequest,
    JenkinsScopeResponse,
    JenkinsTreeResponse,
    JobCreateResponse,
    JobReadResponse,
    KubeCommandResult,
    KubeconfigRefreshRequest,
    KubeconfigStatus,
    KubeContextsResponse,
    KubeDeletePodRequest,
    KubeExecRequest,
    KubeNamespace,
    KubeNamespacesResponse,
    KubePod,
    KubePodDescribeResponse,
    KubePodsResponse,
    KubeTopResponse,
    KubeUseContextRequest,
    NamespaceCredsResponse,
    NamespaceDeployRecipeResponse,
    NamespaceListResponse,
    NamespaceStatusResponse,
    NotebookBookmarkCreateRequest,
    NotebookBookmarkUpdateRequest,
    NotebookContentsResponse,
    NotebookContentsWriteRequest,
    NotebookNoteCreateRequest,
    NotebookNoteReadResponse,
    NotebookNotesResponse,
    NotebookNoteUpdateRequest,
    NotebookReminder,
    NotebookRemindersResponse,
    NotebookReorderRequest,
    NotebookSearchResponse,
    PreflightItem,
    RequestDocumentInput,
    RequestExecuteRequest,
    RequestExecuteResponse,
    RequestItemCreateRequest,
    RequestItemReadResponse,
    RequestItemUpdateRequest,
    RequestsFolderCreateRequest,
    RequestsFolderUpdateRequest,
    RequestsItemsResponse,
    RequestsReorderRequest,
    RequestsTreeResponse,
    RequestsTreeWriteRequest,
    SyncRequest,
    VariableCreateRequest,
    VariableUpdateRequest,
    to_agent_settings_read,
)
from app.services.command import PlainTextCommandResult
from app.services.e2e import list_e2e_suites
from app.services.jenkins import (
    JenkinsAllureReportError,
    JenkinsNotConfiguredError,
    JenkinsPathOutOfScopeError,
    JenkinsUnreachableError,
    fetch_allure_skip_candidates,
    fetch_builds,
    fetch_folder,
    fetch_tree,
    freeze_folder,
    jenkins_scope_signature,
    require_configured,
    resume_folder,
    run_resume_campaign,
)
from app.services.jobs import JobManager, JobNotFoundError
from app.services.kube import (
    KubectlNotInstalledError,
    build_exec_argv,
    delete_pod,
    describe_pod,
    list_contexts,
    list_namespaces_kube,
    list_pods,
    push_kube_operation,
    stream_pod_exec,
    stream_pod_logs,
    top_pods,
    use_context,
)
from app.services.kubeconfig import (
    KubeconfigActivePathConflictError,
    KubeconfigDownloadFailedError,
    KubeconfigDownloadInvalidError,
    activate,
    push_kubeconfig_operation,
    read_status,
    refresh,
)
from app.services.namespaces import (
    list_namespaces,
    read_namespace_creds,
    read_namespace_deploy_recipe,
    read_namespace_status,
    stream_namespace_logs,
)
from app.services.notebook import (
    NotebookBookmarkNotFoundError,
    NotebookConflictError,
    NotebookNoteNotFoundError,
    NotebookPathValidationError,
    NotebookRootMissingError,
    create_bookmark,
    delete_bookmark,
    delete_note,
    list_active_reminders,
    list_bookmarks,
    list_notes,
    move_note,
    read_note,
    rename_bookmark,
    reorder_bookmarks,
    search,
    set_flags,
    write_contents,
    write_note,
)
from app.services.preflight import collect_preflight
from app.services.requests_exec import (
    RequestsCredentialResolutionError,
    authorization_expires_at,
    clear_history,
    delete_history_entry,
    list_history,
    resolve_authorization,
)
from app.services.requests_exec import (
    execute as execute_request,
)
from app.services.requests_store import (
    RequestsConflictError,
    RequestsCredentialNotFoundError,
    RequestsCredentialValidationError,
    RequestsEnvironmentNotFoundError,
    RequestsEnvironmentValidationError,
    RequestsFolderNotFoundError,
    RequestsItemNotFoundError,
    RequestsPathValidationError,
    RequestsRootMissingError,
    RequestsVariableNotFoundError,
    RequestsVariableValidationError,
    create_credential,
    create_environment,
    create_folder,
    create_variable,
    delete_credential,
    delete_environment,
    delete_folder,
    delete_item,
    delete_variable,
    list_credentials,
    list_items,
    list_state,
    list_tree,
    move_item,
    read_credential,
    read_item,
    rename_folder,
    reorder,
    set_active_environment,
    set_folder_flags,
    update_credential,
    update_environment,
    update_item,
    update_variable,
    write_item,
    write_tree,
)
from app.services.staging import StagingNotInstalledError, build_ping_response
from app.services.update import UpdateUnsupportedError, spawn_update_helper

router = APIRouter()
AuthDep = Annotated[AuthContext, Depends(require_auth)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
JobManagerDep = Annotated[JobManager, Depends(get_job_manager)]
JenkinsReadAuth = Annotated[AuthContext, Depends(require_permission(PermissionKey.JENKINS_READ))]
JenkinsFreezeAuth = Annotated[
    AuthContext, Depends(require_permission(PermissionKey.JENKINS_FREEZE))
]
JenkinsResumeAuth = Annotated[
    AuthContext, Depends(require_permission(PermissionKey.JENKINS_RESUME))
]
KuberReadAuth = Annotated[AuthContext, Depends(require_permission(PermissionKey.KUBER_READ))]
KuberUseContextAuth = Annotated[
    AuthContext, Depends(require_permission(PermissionKey.KUBER_USE_CONTEXT))
]
KuberDeletePodAuth = Annotated[
    AuthContext, Depends(require_permission(PermissionKey.KUBER_DELETE_POD))
]
KuberExecAuth = Annotated[AuthContext, Depends(require_permission(PermissionKey.KUBER_EXEC))]
StagingsReadAuth = Annotated[AuthContext, Depends(require_permission(PermissionKey.STAGINGS_READ))]
StagingsDeployAuth = Annotated[
    AuthContext, Depends(require_permission(PermissionKey.STAGINGS_DEPLOY))
]
StagingsDestroyAuth = Annotated[
    AuthContext, Depends(require_permission(PermissionKey.STAGINGS_DESTROY))
]
StagingsSyncAuth = Annotated[AuthContext, Depends(require_permission(PermissionKey.STAGINGS_SYNC))]
StagingsE2eRunAuth = Annotated[
    AuthContext, Depends(require_permission(PermissionKey.STAGINGS_E2E_RUN))
]
NotebookReadAuth = Annotated[AuthContext, Depends(require_permission(PermissionKey.NOTEBOOK_READ))]
NotebookWriteAuth = Annotated[
    AuthContext, Depends(require_permission(PermissionKey.NOTEBOOK_WRITE))
]
RequestsReadAuth = Annotated[AuthContext, Depends(require_permission(PermissionKey.REQUESTS_READ))]
RequestsWriteAuth = Annotated[
    AuthContext, Depends(require_permission(PermissionKey.REQUESTS_WRITE))
]
logger = logging.getLogger(__name__)
CREDENTIAL_CREATE_ADAPTER: TypeAdapter[CredentialCreateRequest] = TypeAdapter(
    CredentialCreateRequest
)
CREDENTIAL_UPDATE_ADAPTER: TypeAdapter[CredentialUpdateRequest] = TypeAdapter(
    CredentialUpdateRequest
)

AGENT_SETTINGS_ENV_KEY_BY_FIELD = {
    "jenkins_history_limit": EnvKey.JENKINS_HISTORY_LIMIT,
    "jenkins_root_folders": EnvKey.JENKINS_ROOT_FOLDERS,
    "jenkins_root_groups": EnvKey.JENKINS_ROOT_GROUPS,
    "qaa_generator_token": EnvKey.QAA_GENERATOR_TOKEN,
    "jenkins_request_timeout": EnvKey.JENKINS_REQUEST_TIMEOUT,
    "jenkins_stuck_min_idle_hours": EnvKey.JENKINS_STUCK_MIN_IDLE_HOURS,
    "jenkins_token": EnvKey.JENKINS_TOKEN,
    "jenkins_tree_depth": EnvKey.JENKINS_TREE_DEPTH,
    "jenkins_url": EnvKey.JENKINS_URL,
    "jenkins_username": EnvKey.JENKINS_USERNAME,
    "kubeconfig": EnvKey.KUBECONFIG,
    "kubeconfig_active_path": EnvKey.KUBECONFIG_ACTIVE_PATH,
    "kubectl_bin": EnvKey.KUBECTL_BIN,
    "kubectl_request_timeout": EnvKey.KUBECTL_REQUEST_TIMEOUT,
    "staging_bin": EnvKey.STAGING_BIN,
    "staging_kubeconfig": StagingEnvKey.KUBECONFIG,
    "staging_kubeconfig_max_age_hours": EnvKey.STAGING_KUBECONFIG_MAX_AGE_HOURS,
    "staging_kubeconfig_url": EnvKey.STAGING_KUBECONFIG_URL,
    "stagings_repo": EnvKey.STAGINGS_REPO,
}

AGENT_SETTINGS_RUNTIME_FIELDS = tuple(AGENT_SETTINGS_ENV_KEY_BY_FIELD)


def serialize_env_value(value: object) -> str:
    if isinstance(value, list):
        if all(isinstance(item, JenkinsRootGroup) for item in value):
            return GROUP_LIST_SEPARATOR.join(
                f"{item.label}{GROUP_LABEL_SEPARATOR}{item.path}" for item in value
            )
        return GROUP_LIST_SEPARATOR.join(str(item) for item in value)
    return str(value)


def build_env_updates(payload: AgentSettingsUpdate) -> dict[str, str]:
    updates: dict[str, str] = {}
    for field_name in payload.model_fields_set:
        value = getattr(payload, field_name)
        if value is None:
            continue
        updates[AGENT_SETTINGS_ENV_KEY_BY_FIELD[field_name].value] = serialize_env_value(value)
    return updates


def merge_runtime_settings(current_settings: Settings, refreshed_settings: Settings) -> Settings:
    return current_settings.model_copy(
        update={
            field_name: getattr(refreshed_settings, field_name)
            for field_name in AGENT_SETTINGS_RUNTIME_FIELDS
        }
    )


@router.get(AgentPath.PING.value, response_model=AgentPingResponse)
async def ping(settings: SettingsDep) -> AgentPingResponse:
    return build_ping_response(settings)


@router.get(AgentPath.SETTINGS.value, response_model=AgentSettingsRead)
async def get_companion_settings(_: AuthDep, settings: SettingsDep) -> AgentSettingsRead:
    return to_agent_settings_read(settings)


@router.put(AgentPath.SETTINGS.value, response_model=AgentSettingsRead)
async def update_companion_settings(
    payload: AgentSettingsUpdate,
    request: Request,
    _: AuthDep,
    settings: SettingsDep,
) -> AgentSettingsRead:
    updates = build_env_updates(payload)
    if not updates:
        return to_agent_settings_read(settings)

    env_file.upsert_env_values(env_file.AGENT_ENV_FILE, updates)
    load_settings.cache_clear()
    refreshed_settings = load_settings()
    updated_settings = merge_runtime_settings(settings, refreshed_settings)
    request.app.state.settings = updated_settings
    request.app.state.job_manager = JobManager(
        settings=updated_settings,
        backend_client=request.app.state.backend_client,
    )
    return to_agent_settings_read(updated_settings)


@router.get(AgentPath.NOTEBOOK_CONTENTS.value, response_model=NotebookContentsResponse)
async def get_notebook_contents(
    _: NotebookReadAuth,
    settings: SettingsDep,
) -> NotebookContentsResponse:
    try:
        return list_bookmarks(settings)
    except NotebookRootMissingError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc


@router.put(AgentPath.NOTEBOOK_CONTENTS.value, response_model=NotebookContentsResponse)
async def put_notebook_contents(
    request_body: NotebookContentsWriteRequest,
    _: NotebookWriteAuth,
    settings: SettingsDep,
) -> NotebookContentsResponse:
    try:
        write_contents(
            settings,
            [bookmark.model_dump(mode="python") for bookmark in request_body.bookmarks],
        )
        return list_bookmarks(settings)
    except NotebookPathValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.patch(AgentPath.NOTEBOOK_CONTENTS.value, response_model=NotebookContentsResponse)
async def patch_notebook_contents(
    request_body: NotebookReorderRequest,
    _: NotebookWriteAuth,
    settings: SettingsDep,
) -> NotebookContentsResponse:
    try:
        reorder_bookmarks(settings, request_body.bookmarks)
        return list_bookmarks(settings)
    except NotebookRootMissingError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc


@router.post(AgentPath.NOTEBOOK_BOOKMARK.value, response_model=NotebookContentsResponse)
async def post_notebook_bookmark(
    request_body: NotebookBookmarkCreateRequest,
    _: NotebookWriteAuth,
    settings: SettingsDep,
) -> NotebookContentsResponse:
    try:
        create_bookmark(settings, request_body.name)
        if request_body.flags:
            set_flags(settings, request_body.name, None, request_body.flags)
        return list_bookmarks(settings)
    except (NotebookConflictError, NotebookPathValidationError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.put(AgentPath.NOTEBOOK_BOOKMARK.value, response_model=NotebookContentsResponse)
async def put_notebook_bookmark(
    request_body: NotebookBookmarkUpdateRequest,
    _: NotebookWriteAuth,
    settings: SettingsDep,
) -> NotebookContentsResponse:
    if request_body.name is None and request_body.flags is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No bookmark changes requested.",
        )
    try:
        bookmark_name = request_body.bookmark
        if request_body.name is not None:
            rename_bookmark(settings, request_body.bookmark, request_body.name)
            bookmark_name = request_body.name
        if request_body.flags is not None:
            set_flags(settings, bookmark_name, None, request_body.flags)
        return list_bookmarks(settings)
    except NotebookRootMissingError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except NotebookBookmarkNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except (NotebookConflictError, NotebookPathValidationError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.delete(AgentPath.NOTEBOOK_BOOKMARK.value, response_model=NotebookContentsResponse)
async def delete_notebook_bookmark(
    _: NotebookWriteAuth,
    settings: SettingsDep,
    bookmark: str = Query(...),
) -> NotebookContentsResponse:
    try:
        delete_bookmark(settings, bookmark)
        return list_bookmarks(settings)
    except NotebookRootMissingError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except NotebookBookmarkNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except NotebookPathValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.get(AgentPath.NOTEBOOK_NOTE.value, response_model=NotebookNotesResponse)
async def get_notebook_notes(
    _: NotebookReadAuth,
    settings: SettingsDep,
    bookmark: str = Query(...),
) -> NotebookNotesResponse:
    try:
        return list_notes(settings, bookmark)
    except NotebookRootMissingError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except NotebookBookmarkNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except NotebookPathValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.get(
    f"{AgentPath.NOTEBOOK_NOTE.value}/{{name}}",
    response_model=NotebookNoteReadResponse,
)
async def get_notebook_note(
    name: str,
    _: NotebookReadAuth,
    settings: SettingsDep,
    bookmark: str = Query(...),
) -> NotebookNoteReadResponse:
    try:
        return read_note(settings, bookmark, name)
    except NotebookRootMissingError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except (NotebookBookmarkNotFoundError, NotebookNoteNotFoundError) as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except NotebookPathValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.post(AgentPath.NOTEBOOK_NOTE.value, response_model=NotebookNoteReadResponse)
async def post_notebook_note(
    request_body: NotebookNoteCreateRequest,
    _: NotebookWriteAuth,
    settings: SettingsDep,
) -> NotebookNoteReadResponse:
    try:
        note_name = write_note(
            settings,
            request_body.bookmark,
            request_body.name,
            request_body.text,
        )
        if request_body.flags is not None:
            set_flags(settings, request_body.bookmark, note_name, request_body.flags)
        return read_note(settings, request_body.bookmark, note_name)
    except NotebookRootMissingError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except (NotebookBookmarkNotFoundError, NotebookNoteNotFoundError) as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except NotebookPathValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.put(
    f"{AgentPath.NOTEBOOK_NOTE.value}/{{name}}",
    response_model=NotebookNoteReadResponse,
)
async def put_notebook_note(
    name: str,
    request_body: NotebookNoteUpdateRequest,
    _: NotebookWriteAuth,
    settings: SettingsDep,
    bookmark: str = Query(...),
) -> NotebookNoteReadResponse:
    is_move_request = bookmark != request_body.bookmark
    if not is_move_request and request_body.text is None and request_body.flags is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No note changes requested.",
        )
    try:
        bookmark_name = bookmark
        if is_move_request:
            move_note(settings, bookmark, request_body.bookmark, name)
            bookmark_name = request_body.bookmark
        if request_body.text is not None:
            write_note(settings, bookmark_name, name, request_body.text)
        if request_body.flags is not None:
            set_flags(settings, bookmark_name, name, request_body.flags)
        return read_note(settings, bookmark_name, name)
    except NotebookRootMissingError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except (NotebookBookmarkNotFoundError, NotebookNoteNotFoundError) as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except (NotebookConflictError, NotebookPathValidationError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.delete(
    f"{AgentPath.NOTEBOOK_NOTE.value}/{{name}}",
    response_model=NotebookNotesResponse,
)
async def delete_notebook_note(
    name: str,
    _: NotebookWriteAuth,
    settings: SettingsDep,
    bookmark: str = Query(...),
) -> NotebookNotesResponse:
    try:
        delete_note(settings, bookmark, name)
        return list_notes(settings, bookmark)
    except NotebookRootMissingError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except (NotebookBookmarkNotFoundError, NotebookNoteNotFoundError) as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except NotebookPathValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.get(AgentPath.NOTEBOOK_SEARCH.value, response_model=NotebookSearchResponse)
async def get_notebook_search(
    _: NotebookReadAuth,
    settings: SettingsDep,
    query: str = Query(..., min_length=1),
) -> NotebookSearchResponse:
    try:
        return search(settings, query)
    except NotebookRootMissingError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc


@router.get(AgentPath.NOTEBOOK_REMINDERS.value, response_model=NotebookRemindersResponse)
async def get_notebook_reminders(
    _: NotebookReadAuth,
    settings: SettingsDep,
) -> NotebookRemindersResponse:
    try:
        reminders: list[NotebookReminder] = list_active_reminders(settings)
        return NotebookRemindersResponse(reminders=reminders)
    except NotebookRootMissingError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc


def _build_request_document_input(
    method: str,
    url: str,
    headers: object,
    query_params: object,
    body: object,
    credential_id: str | None,
) -> RequestDocumentInput:
    return RequestDocumentInput.model_validate(
        {
            "method": method,
            "url": url,
            "headers": headers,
            "query_params": query_params,
            "body": body,
            "credential_id": credential_id,
        }
    )


@router.get(AgentPath.REQUESTS_COLLECTIONS.value, response_model=RequestsTreeResponse)
async def get_requests_collections(
    _: RequestsReadAuth,
    settings: SettingsDep,
) -> RequestsTreeResponse:
    try:
        return list_tree(settings)
    except RequestsRootMissingError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc


@router.put(AgentPath.REQUESTS_COLLECTIONS.value, response_model=RequestsTreeResponse)
async def put_requests_collections(
    request_body: RequestsTreeWriteRequest,
    _: RequestsWriteAuth,
    settings: SettingsDep,
) -> RequestsTreeResponse:
    try:
        write_tree(
            settings,
            [folder.model_dump(mode="python") for folder in request_body.folders],
        )
        return list_tree(settings)
    except RequestsPathValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.patch(AgentPath.REQUESTS_COLLECTIONS.value, response_model=RequestsTreeResponse)
async def patch_requests_collections(
    request_body: RequestsReorderRequest,
    _: RequestsWriteAuth,
    settings: SettingsDep,
) -> RequestsTreeResponse:
    try:
        reorder(settings, request_body.folders)
        return list_tree(settings)
    except RequestsRootMissingError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc


@router.post(AgentPath.REQUESTS_FOLDER.value, response_model=RequestsTreeResponse)
async def post_requests_folder(
    request_body: RequestsFolderCreateRequest,
    _: RequestsWriteAuth,
    settings: SettingsDep,
) -> RequestsTreeResponse:
    try:
        create_folder(settings, request_body.name)
        if request_body.flags:
            set_folder_flags(settings, request_body.name, request_body.flags)
        return list_tree(settings)
    except (RequestsConflictError, RequestsPathValidationError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.put(AgentPath.REQUESTS_FOLDER.value, response_model=RequestsTreeResponse)
async def put_requests_folder(
    request_body: RequestsFolderUpdateRequest,
    _: RequestsWriteAuth,
    settings: SettingsDep,
) -> RequestsTreeResponse:
    if request_body.name is None and request_body.flags is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="No folder changes requested."
        )
    try:
        folder_name = request_body.folder
        if request_body.name is not None:
            rename_folder(settings, request_body.folder, request_body.name)
            folder_name = request_body.name
        if request_body.flags is not None:
            set_folder_flags(settings, folder_name, request_body.flags)
        return list_tree(settings)
    except RequestsRootMissingError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    except RequestsFolderNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (RequestsConflictError, RequestsPathValidationError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.delete(AgentPath.REQUESTS_FOLDER.value, response_model=RequestsTreeResponse)
async def delete_requests_folder(
    _: RequestsWriteAuth,
    settings: SettingsDep,
    folder: str = Query(...),
) -> RequestsTreeResponse:
    try:
        delete_folder(settings, folder)
        return list_tree(settings)
    except RequestsRootMissingError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    except RequestsFolderNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RequestsPathValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get(AgentPath.REQUESTS_ITEM.value, response_model=RequestsItemsResponse)
async def get_requests_items(
    _: RequestsReadAuth,
    settings: SettingsDep,
    folder: str = Query(...),
) -> RequestsItemsResponse:
    try:
        return list_items(settings, folder)
    except RequestsRootMissingError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    except RequestsFolderNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RequestsPathValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get(f"{AgentPath.REQUESTS_ITEM.value}/{{name}}", response_model=RequestItemReadResponse)
async def get_requests_item(
    name: str,
    _: RequestsReadAuth,
    settings: SettingsDep,
    folder: str = Query(...),
) -> RequestItemReadResponse:
    try:
        return read_item(settings, folder, name)
    except RequestsRootMissingError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    except (RequestsFolderNotFoundError, RequestsItemNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RequestsPathValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(AgentPath.REQUESTS_ITEM.value, response_model=RequestItemReadResponse)
async def post_requests_item(
    request_body: RequestItemCreateRequest,
    _: RequestsWriteAuth,
    settings: SettingsDep,
) -> RequestItemReadResponse:
    try:
        return write_item(
            settings,
            request_body.folder,
            request_body.name,
            _build_request_document_input(
                request_body.method,
                request_body.url,
                request_body.headers,
                request_body.query_params,
                request_body.body,
                request_body.credential_id,
            ),
        )
    except RequestsRootMissingError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    except RequestsFolderNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (RequestsConflictError, RequestsPathValidationError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.put(f"{AgentPath.REQUESTS_ITEM.value}/{{name}}", response_model=RequestItemReadResponse)
async def put_requests_item(
    name: str,
    request_body: RequestItemUpdateRequest,
    _: RequestsWriteAuth,
    settings: SettingsDep,
    folder: str = Query(...),
) -> RequestItemReadResponse:
    update_fields = request_body.model_fields_set - {"folder"}
    is_move_request = folder != request_body.folder
    if not is_move_request and not update_fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="No item changes requested."
        )
    try:
        current = read_item(settings, folder, name)
        target_folder = request_body.folder
        if is_move_request:
            move_item(settings, folder, request_body.folder, name)
        if update_fields:
            method = request_body.method if request_body.method is not None else current.method
            url = request_body.url if request_body.url is not None else current.url
            headers = request_body.headers if "headers" in update_fields else current.headers
            query_params = (
                request_body.query_params
                if "query_params" in update_fields
                else current.query_params
            )
            body = request_body.body if "body" in update_fields else current.body
            credential_id = (
                request_body.credential_id
                if "credential_id" in update_fields
                else current.credential_id
            )
            update_item(
                settings,
                target_folder,
                name,
                _build_request_document_input(
                    method, url, headers, query_params, body, credential_id
                ),
            )
        return read_item(settings, target_folder, name)
    except RequestsRootMissingError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    except (RequestsFolderNotFoundError, RequestsItemNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (RequestsConflictError, RequestsPathValidationError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.delete(f"{AgentPath.REQUESTS_ITEM.value}/{{name}}", response_model=RequestsItemsResponse)
async def delete_requests_item(
    name: str,
    _: RequestsWriteAuth,
    settings: SettingsDep,
    folder: str = Query(...),
) -> RequestsItemsResponse:
    try:
        delete_item(settings, folder, name)
        return list_items(settings, folder)
    except RequestsRootMissingError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    except (RequestsFolderNotFoundError, RequestsItemNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RequestsPathValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get(AgentPath.REQUESTS_ENVIRONMENTS.value, response_model=EnvironmentsStateResponse)
async def get_requests_environments(
    _: RequestsReadAuth,
    settings: SettingsDep,
) -> EnvironmentsStateResponse:
    return list_state(settings)


@router.post(AgentPath.REQUESTS_ENVIRONMENTS.value, response_model=EnvironmentsStateResponse)
async def post_requests_environment(
    request_body: dict[str, object],
    _: RequestsWriteAuth,
    settings: SettingsDep,
) -> EnvironmentsStateResponse:
    try:
        payload = EnvironmentCreateRequest.model_validate(request_body)
        return create_environment(settings, payload.name)
    except ValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RequestsConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except RequestsEnvironmentValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RequestsRootMissingError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc


@router.put(
    AgentPath.REQUESTS_ENVIRONMENT_ACTIVE.value,
    response_model=EnvironmentsStateResponse,
)
async def put_requests_environment_active(
    request_body: dict[str, object],
    _: RequestsWriteAuth,
    settings: SettingsDep,
) -> EnvironmentsStateResponse:
    try:
        payload = EnvironmentActiveRequest.model_validate(request_body)
        return set_active_environment(settings, payload.environment_id)
    except ValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RequestsEnvironmentNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RequestsConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except RequestsEnvironmentValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RequestsRootMissingError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc


@router.put(
    f"{AgentPath.REQUESTS_ENVIRONMENTS.value}/{{environment_id}}",
    response_model=EnvironmentsStateResponse,
)
async def put_requests_environment(
    environment_id: str,
    request_body: dict[str, object],
    _: RequestsWriteAuth,
    settings: SettingsDep,
) -> EnvironmentsStateResponse:
    try:
        payload = EnvironmentUpdateRequest.model_validate(request_body)
    except ValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if payload.name is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No environment changes requested.",
        )
    try:
        return update_environment(settings, environment_id, payload.name)
    except RequestsEnvironmentNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RequestsConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except RequestsEnvironmentValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RequestsRootMissingError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc


@router.delete(
    f"{AgentPath.REQUESTS_ENVIRONMENTS.value}/{{environment_id}}",
    response_model=EnvironmentsStateResponse,
)
async def delete_requests_environment(
    environment_id: str,
    _: RequestsWriteAuth,
    settings: SettingsDep,
) -> EnvironmentsStateResponse:
    try:
        return delete_environment(settings, environment_id)
    except RequestsEnvironmentNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RequestsConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except RequestsEnvironmentValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RequestsRootMissingError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc


@router.post(AgentPath.REQUESTS_VARIABLES.value, response_model=EnvironmentsStateResponse)
async def post_requests_variable(
    request_body: dict[str, object],
    _: RequestsWriteAuth,
    settings: SettingsDep,
) -> EnvironmentsStateResponse:
    try:
        payload = VariableCreateRequest.model_validate(request_body)
        return create_variable(settings, payload)
    except ValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RequestsConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except RequestsVariableValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RequestsRootMissingError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc


@router.put(
    f"{AgentPath.REQUESTS_VARIABLES.value}/{{variable_id}}",
    response_model=EnvironmentsStateResponse,
)
async def put_requests_variable(
    variable_id: str,
    request_body: dict[str, object],
    _: RequestsWriteAuth,
    settings: SettingsDep,
) -> EnvironmentsStateResponse:
    try:
        payload = VariableUpdateRequest.model_validate(request_body)
    except ValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if not payload.model_fields_set:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No variable changes requested.",
        )
    try:
        return update_variable(settings, variable_id, payload)
    except RequestsVariableNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RequestsConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except RequestsVariableValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RequestsRootMissingError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc


@router.delete(
    f"{AgentPath.REQUESTS_VARIABLES.value}/{{variable_id}}",
    response_model=EnvironmentsStateResponse,
)
async def delete_requests_variable(
    variable_id: str,
    _: RequestsWriteAuth,
    settings: SettingsDep,
) -> EnvironmentsStateResponse:
    try:
        return delete_variable(settings, variable_id)
    except RequestsVariableNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RequestsConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except RequestsVariableValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RequestsRootMissingError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc


@router.get(AgentPath.REQUESTS_CREDENTIALS.value, response_model=CredentialsListResponse)
async def get_requests_credentials(
    _: RequestsReadAuth,
    settings: SettingsDep,
) -> CredentialsListResponse:
    return CredentialsListResponse(credentials=list_credentials(settings))


@router.get(
    f"{AgentPath.REQUESTS_CREDENTIALS.value}/{{credential_id}}",
    response_model=CredentialPublic,
)
async def get_requests_credential(
    credential_id: str,
    _: RequestsReadAuth,
    settings: SettingsDep,
) -> CredentialPublic:
    try:
        return read_credential(settings, credential_id)
    except RequestsCredentialNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RequestsCredentialValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(AgentPath.REQUESTS_CREDENTIALS.value, response_model=CredentialPublic)
async def post_requests_credential(
    request_body: dict[str, object],
    _: RequestsWriteAuth,
    settings: SettingsDep,
) -> CredentialPublic:
    try:
        payload = CREDENTIAL_CREATE_ADAPTER.validate_python(request_body)
        return create_credential(settings, payload)
    except ValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RequestsCredentialValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.put(
    f"{AgentPath.REQUESTS_CREDENTIALS.value}/{{credential_id}}",
    response_model=CredentialPublic,
)
async def put_requests_credential(
    credential_id: str,
    request_body: dict[str, object],
    _: RequestsWriteAuth,
    settings: SettingsDep,
) -> CredentialPublic:
    try:
        payload = CREDENTIAL_UPDATE_ADAPTER.validate_python(request_body)
    except ValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if payload.name is None and not payload.config.model_fields_set:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="No credential changes requested."
        )
    try:
        return update_credential(settings, credential_id, payload)
    except RequestsCredentialNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RequestsCredentialValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.delete(
    f"{AgentPath.REQUESTS_CREDENTIALS.value}/{{credential_id}}",
    response_model=CredentialsListResponse,
)
async def delete_requests_credential(
    credential_id: str,
    _: RequestsWriteAuth,
    settings: SettingsDep,
) -> CredentialsListResponse:
    try:
        delete_credential(settings, credential_id)
        return CredentialsListResponse(credentials=list_credentials(settings))
    except RequestsCredentialNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post(
    AgentPath.REQUESTS_CREDENTIAL_RESOLVE.value,
    response_model=CredentialResolveResponse,
)
async def post_requests_credential_resolve(
    request: Request,
    request_body: CredentialResolveRequest,
    _: RequestsWriteAuth,
    settings: SettingsDep,
) -> CredentialResolveResponse:
    try:
        authorization = await resolve_authorization(
            request.app,
            settings,
            request_body.credential_id,
            force=request_body.force,
        )
    except RequestsCredentialNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RequestsCredentialResolutionError as exc:
        return CredentialResolveResponse(ok=False, expires_at=None, error=str(exc))
    return CredentialResolveResponse(
        ok=True,
        expires_at=authorization_expires_at(authorization),
        error=None,
    )


@router.post(AgentPath.REQUESTS_EXECUTE.value, response_model=RequestExecuteResponse)
async def post_requests_execute(
    request: Request,
    request_body: RequestExecuteRequest,
    _: RequestsWriteAuth,
    settings: SettingsDep,
) -> RequestExecuteResponse:
    return await execute_request(request.app, settings, request_body)


@router.get(AgentPath.REQUESTS_HISTORY.value, response_model=HistoryListResponse)
async def get_requests_history(
    _: RequestsReadAuth,
    settings: SettingsDep,
) -> HistoryListResponse:
    return list_history(settings)


@router.delete(AgentPath.REQUESTS_HISTORY.value, response_model=HistoryListResponse)
async def delete_requests_history(
    _: RequestsWriteAuth,
    settings: SettingsDep,
) -> HistoryListResponse:
    clear_history(settings)
    return list_history(settings)


@router.delete(
    f"{AgentPath.REQUESTS_HISTORY.value}/{{entry_id}}",
    response_model=HistoryListResponse,
)
async def delete_requests_history_entry_route(
    entry_id: str,
    _: RequestsWriteAuth,
    settings: SettingsDep,
) -> HistoryListResponse:
    delete_history_entry(settings, entry_id)
    return list_history(settings)


@router.get(AgentPath.PREFLIGHT.value, response_model=list[PreflightItem])
async def preflight(_: AuthDep, settings: SettingsDep) -> list[PreflightItem]:
    return await collect_preflight(settings)


@router.post(
    AgentPath.UPDATE.value,
    response_model=AgentUpdateAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
async def update_agent(_: AuthDep) -> AgentUpdateAccepted:
    try:
        spawn_update_helper()
    except UpdateUnsupportedError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    return AgentUpdateAccepted(status=AgentUpdateStatus.ACCEPTED)


@router.get(AgentPath.JENKINS_TREE.value, response_model=JenkinsTreeResponse)
async def get_jenkins_tree(
    _: JenkinsReadAuth,
    settings: SettingsDep,
) -> JenkinsTreeResponse:
    try:
        roots = await fetch_tree(settings)
    except JenkinsNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except JenkinsUnreachableError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
    return JenkinsTreeResponse(signature=jenkins_scope_signature(settings), roots=roots)


@router.get(AgentPath.JENKINS_SCOPE.value, response_model=JenkinsScopeResponse)
async def get_jenkins_scope(
    _: JenkinsReadAuth,
    settings: SettingsDep,
) -> JenkinsScopeResponse:
    return JenkinsScopeResponse(
        signature=jenkins_scope_signature(settings),
        root_groups=list(settings.jenkins_root_groups),
        root_folders=list(settings.jenkins_root_folders),
        tree_depth=settings.jenkins_tree_depth,
        history_limit=settings.jenkins_history_limit,
    )


@router.get(AgentPath.JENKINS_BUILDS.value, response_model=JenkinsBuildsResponse)
async def get_jenkins_builds(
    _: JenkinsReadAuth,
    settings: SettingsDep,
    path: str = Query(...),
) -> JenkinsBuildsResponse:
    try:
        builds = await fetch_builds(settings, path)
    except JenkinsNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except (JenkinsPathOutOfScopeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except JenkinsUnreachableError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
    return JenkinsBuildsResponse(builds=builds)


@router.get(AgentPath.JENKINS_FOLDER.value, response_model=JenkinsFolderResponse)
async def get_jenkins_folder(
    _: JenkinsReadAuth,
    settings: SettingsDep,
    path: str = Query(...),
) -> JenkinsFolderResponse:
    try:
        roots = await fetch_folder(settings, path)
    except JenkinsNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except (JenkinsPathOutOfScopeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except JenkinsUnreachableError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
    return JenkinsFolderResponse(roots=roots)


@router.post(
    AgentPath.JENKINS_ALLURE_SKIP_CANDIDATES.value,
    response_model=JenkinsAllureSkipCandidatesResponse,
)
async def post_jenkins_allure_skip_candidates(
    request_body: JenkinsAllureSkipCandidatesRequest,
    _: JenkinsReadAuth,
    settings: SettingsDep,
) -> JenkinsAllureSkipCandidatesResponse:
    try:
        return await fetch_allure_skip_candidates(
            settings,
            request_body.report_urls,
            product=request_body.product,
        )
    except JenkinsNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except (JenkinsAllureReportError, JenkinsPathOutOfScopeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except JenkinsUnreachableError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc


@router.post(AgentPath.JENKINS_FREEZE.value, response_model=JenkinsFreezeResponse)
async def post_jenkins_freeze(
    request_body: JenkinsFreezeRequest,
    _: JenkinsFreezeAuth,
    settings: SettingsDep,
) -> JenkinsFreezeResponse:
    try:
        snapshot = await freeze_folder(
            settings,
            request_body.folder_path,
            kill_builds=request_body.kill_builds,
        )
    except JenkinsNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except (JenkinsPathOutOfScopeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except JenkinsUnreachableError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
    return JenkinsFreezeResponse(snapshot=snapshot)


@router.post(AgentPath.JENKINS_RESUME.value, response_model=JenkinsResumeResponse)
async def post_jenkins_resume(
    request_body: JenkinsResumeRequest,
    _: JenkinsResumeAuth,
    settings: SettingsDep,
) -> JenkinsResumeResponse:
    try:
        outcomes = await resume_folder(settings, request_body.snapshot)
    except JenkinsNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except (JenkinsPathOutOfScopeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except JenkinsUnreachableError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
    return JenkinsResumeResponse(outcomes=outcomes)


@router.post(
    AgentPath.JENKINS_RESUME_RUN.value,
    response_model=JenkinsResumeRunAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
async def post_jenkins_resume_run(
    request_body: JenkinsResumeRunRequest,
    request: Request,
    auth: JenkinsResumeAuth,
    settings: SettingsDep,
) -> JenkinsResumeRunAccepted:
    try:
        require_configured(settings)
    except JenkinsNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    task_key = str(request_body.run_id)
    tasks = cast(dict[str, asyncio.Task[None]], request.app.state.jenkins_resume_tasks)
    if task_key not in tasks:
        backend_client = cast(httpx.AsyncClient, request.app.state.backend_client)

        async def runner() -> None:
            try:
                await run_resume_campaign(
                    settings,
                    request_body.run_id,
                    auth.token,
                    request_body.snapshot,
                    restart_pipelines=request_body.restart_pipelines,
                    backend_client=backend_client,
                )
            except Exception:
                logger.exception("jenkins resume campaign failed: run_id=%s", task_key)

        def discard_task(_finished: asyncio.Task[None]) -> None:
            # Drop the handle when the campaign ends so the map does not grow unbounded
            # and a fresh run_id can always be launched.
            tasks.pop(task_key, None)

        task = asyncio.create_task(runner(), name=f"jenkins-resume-{task_key}")
        task.add_done_callback(discard_task)
        tasks[task_key] = task

    return JenkinsResumeRunAccepted(run_id=request_body.run_id)


@router.get(AgentPath.KUBECONFIG_STATUS.value, response_model=KubeconfigStatus)
async def get_kubeconfig_status(_: StagingsReadAuth, settings: SettingsDep) -> KubeconfigStatus:
    return read_status(settings)


@router.post(AgentPath.KUBECONFIG_REFRESH.value, response_model=KubeconfigStatus)
async def post_kubeconfig_refresh(
    request_body: KubeconfigRefreshRequest,
    request: Request,
    auth: StagingsSyncAuth,
    settings: SettingsDep,
) -> KubeconfigStatus:
    try:
        status_after_refresh = await refresh(settings)
    except KubeconfigDownloadFailedError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
    except KubeconfigDownloadInvalidError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc

    if request_body.activate and status_after_refresh.healthy:
        try:
            final_status = activate(settings)
        except KubeconfigActivePathConflictError as exc:
            await push_kubeconfig_operation(
                client=request.app.state.backend_client,
                token=auth.token,
                action=KubeconfigAction.REFRESH,
                settings=settings,
            )
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(exc),
            ) from exc
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            ) from exc
        await push_kubeconfig_operation(
            client=request.app.state.backend_client,
            token=auth.token,
            action=KubeconfigAction.REFRESH_AND_ACTIVATE,
            settings=settings,
        )
        return final_status

    await push_kubeconfig_operation(
        client=request.app.state.backend_client,
        token=auth.token,
        action=KubeconfigAction.REFRESH,
        settings=settings,
    )
    return status_after_refresh


@router.post(AgentPath.KUBECONFIG_ACTIVATE.value, response_model=KubeconfigStatus)
async def post_kubeconfig_activate(
    request: Request,
    auth: StagingsSyncAuth,
    settings: SettingsDep,
) -> KubeconfigStatus:
    try:
        result = activate(settings)
    except KubeconfigActivePathConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    await push_kubeconfig_operation(
        client=request.app.state.backend_client,
        token=auth.token,
        action=KubeconfigAction.ACTIVATE,
        settings=settings,
    )
    return result


@router.post(
    AgentPath.DEPLOY.value,
    response_model=JobCreateResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def deploy(
    request_body: DeployRequest,
    auth: StagingsDeployAuth,
    job_manager: JobManagerDep,
) -> JobCreateResponse:
    try:
        return await job_manager.create_deploy_job(request_body, auth.token)
    except StagingNotInstalledError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc


@router.post(
    AgentPath.DESTROY.value,
    response_model=JobCreateResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def destroy(
    request_body: DestroyRequest,
    auth: StagingsDestroyAuth,
    job_manager: JobManagerDep,
) -> JobCreateResponse:
    try:
        return await job_manager.create_destroy_job(request_body.ns, auth.token)
    except StagingNotInstalledError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc


@router.post(
    AgentPath.ADOPT.value,
    response_model=JobCreateResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def adopt(
    request_body: AdoptRequest,
    auth: StagingsDeployAuth,
    job_manager: JobManagerDep,
) -> JobCreateResponse:
    try:
        return await job_manager.create_adopt_job(request_body.ns, auth.token)
    except StagingNotInstalledError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc


@router.post(
    AgentPath.SYNC.value,
    response_model=JobCreateResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def sync(
    request_body: SyncRequest,
    auth: StagingsSyncAuth,
    job_manager: JobManagerDep,
) -> JobCreateResponse:
    try:
        return await job_manager.create_sync_job(request_body, auth.token)
    except StagingNotInstalledError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc


@router.get(AgentPath.E2E_SUITES.value, response_model=E2eSuitesResponse)
async def get_e2e_suites(
    _: StagingsReadAuth,
    settings: SettingsDep,
    product: Annotated[Product, Query()],
) -> E2eSuitesResponse:
    try:
        result, parsed = await list_e2e_suites(settings, product)
    except StagingNotInstalledError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    return E2eSuitesResponse(
        product=parsed.product,
        suites=[
            E2eSuite(
                name=suite.name,
                marks=suite.marks,
            )
            for suite in parsed.suites
        ],
        exit_code=result.exit_code,
    )


@router.post(
    AgentPath.E2E_RUN.value,
    response_model=JobCreateResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def e2e_run(
    request_body: E2eRunRequest,
    auth: StagingsE2eRunAuth,
    job_manager: JobManagerDep,
) -> JobCreateResponse:
    try:
        return await job_manager.create_e2e_run_job(request_body, auth.token)
    except StagingNotInstalledError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc


@router.get(f"{AgentPath.JOBS.value}/{{job_id}}", response_model=JobReadResponse)
async def read_job(
    job_id: str,
    _: AuthDep,
    job_manager: JobManagerDep,
) -> JobReadResponse:
    try:
        return await job_manager.get_job_response(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessage.JOB_NOT_FOUND.value,
        ) from exc


@router.get(AgentPath.NAMESPACES.value, response_model=NamespaceListResponse)
async def get_namespaces(
    _: StagingsReadAuth,
    settings: SettingsDep,
) -> NamespaceListResponse:
    try:
        result, parsed = await list_namespaces(settings)
    except StagingNotInstalledError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    return NamespaceListResponse(
        raw=result.raw,
        cluster_namespaces=[
            {
                "name": entry.name,
                "status": entry.status,
                "created_at": entry.created_at,
                "has_local_overlay": entry.has_local_overlay,
            }
            for entry in parsed.cluster_namespaces
        ],
        local_overlays=[{"name": entry.name} for entry in parsed.local_overlays],
        exit_code=result.exit_code,
    )


@router.get(
    f"{AgentPath.NAMESPACES.value}/{{namespace}}{AgentPath.STATUS.value}",
    response_model=NamespaceStatusResponse,
)
async def get_namespace_status(
    namespace: str,
    _: StagingsReadAuth,
    settings: SettingsDep,
) -> NamespaceStatusResponse:
    try:
        result = await read_namespace_status(settings, namespace)
    except StagingNotInstalledError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    return NamespaceStatusResponse(
        ns=namespace,
        raw=result.raw,
        exit_code=result.exit_code,
    )


@router.get(
    f"{AgentPath.NAMESPACES.value}/{{namespace}}{AgentPath.CREDS.value}",
    response_model=NamespaceCredsResponse,
)
async def get_namespace_creds(
    namespace: str,
    _: StagingsReadAuth,
    settings: SettingsDep,
) -> NamespaceCredsResponse:
    try:
        result = await read_namespace_creds(settings, namespace)
    except StagingNotInstalledError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    return NamespaceCredsResponse(
        ns=namespace,
        raw=result.raw,
        exit_code=result.exit_code,
    )


@router.get(
    f"{AgentPath.NAMESPACES.value}/{{namespace}}{AgentPath.DEPLOY_RECIPE.value}",
    response_model=NamespaceDeployRecipeResponse,
)
async def get_namespace_deploy_recipe(
    namespace: str,
    _: StagingsReadAuth,
    settings: SettingsDep,
) -> NamespaceDeployRecipeResponse:
    try:
        recipe = await read_namespace_deploy_recipe(settings, namespace)
    except StagingNotInstalledError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    return NamespaceDeployRecipeResponse(
        ns=recipe.ns,
        recipe=DeployRecipePayload(
            product=None,
            services=recipe.services,
            images=recipe.images,
            suites=[],
            flags=DeployFlags(
                clean=recipe.clean,
                full=recipe.full,
                dry_run=recipe.dry_run,
                no_sync=recipe.no_sync,
                stage=recipe.stage,
            ),
        ),
    )


@router.get(AgentPath.KUBE_CONTEXTS.value, response_model=KubeContextsResponse)
async def get_kube_contexts(
    _: KuberReadAuth,
    settings: SettingsDep,
) -> KubeContextsResponse:
    try:
        result, rows, current_context = await list_contexts(settings)
    except KubectlNotInstalledError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    return KubeContextsResponse(
        contexts=[
            {
                "name": row.name,
                "cluster": row.cluster,
                "user": row.user,
                "namespace": row.namespace,
                "current": row.current,
            }
            for row in rows
        ],
        current_context=current_context,
        exit_code=result.exit_code,
    )


@router.post(AgentPath.KUBE_USE_CONTEXT.value, response_model=KubeCommandResult)
async def post_kube_use_context(
    request_body: KubeUseContextRequest,
    request: Request,
    auth: KuberUseContextAuth,
    settings: SettingsDep,
) -> KubeCommandResult:
    try:
        result = await use_context(settings, request_body.context)
    except KubectlNotInstalledError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    await push_kube_operation(
        request.app.state.backend_client,
        auth.token,
        op_type=OperationType.KUBE_USE_CONTEXT,
        ns=None,
        recipe={"context": request_body.context},
        result=result,
    )
    return KubeCommandResult(raw=result.raw, exit_code=result.exit_code)


@router.get(AgentPath.KUBE_NAMESPACES.value, response_model=KubeNamespacesResponse)
async def get_kube_namespaces(
    _: KuberReadAuth,
    settings: SettingsDep,
    context: str | None = Query(default=None),
) -> KubeNamespacesResponse:
    try:
        result, rows = await list_namespaces_kube(settings, context)
    except KubectlNotInstalledError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    return KubeNamespacesResponse(
        namespaces=[KubeNamespace(name=row.name, phase=row.phase) for row in rows],
        exit_code=result.exit_code,
    )


@router.get(AgentPath.KUBE_PODS.value, response_model=KubePodsResponse)
async def get_kube_pods(
    _: KuberReadAuth,
    settings: SettingsDep,
    namespace: str = Query(...),
    context: str | None = Query(default=None),
) -> KubePodsResponse:
    try:
        result, rows = await list_pods(settings, context, namespace)
    except KubectlNotInstalledError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    return KubePodsResponse(
        pods=[
            KubePod(
                name=row.name,
                phase=row.phase,
                ready=row.ready,
                restarts=row.restarts,
                containers=row.containers,
                node=row.node,
                created_at=row.created_at,
            )
            for row in rows
        ],
        exit_code=result.exit_code,
    )


@router.get(
    f"{AgentPath.KUBE_PODS.value}/{{pod}}{AgentPath.DESCRIBE.value}",
    response_model=KubePodDescribeResponse,
)
async def get_kube_pod_describe(
    pod: str,
    _: KuberReadAuth,
    settings: SettingsDep,
    namespace: str = Query(...),
    context: str | None = Query(default=None),
) -> KubePodDescribeResponse:
    try:
        result = await describe_pod(settings, context, namespace, pod)
    except KubectlNotInstalledError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    return KubePodDescribeResponse(
        name=pod,
        raw=result.raw,
        exit_code=result.exit_code,
    )


@router.get(f"{AgentPath.KUBE_PODS.value}/{{pod}}{AgentPath.LOGS.value}")
async def get_kube_pod_logs(
    pod: str,
    request: Request,
    _: KuberReadAuth,
    settings: SettingsDep,
    namespace: str = Query(...),
    context: str | None = Query(default=None),
    container: str | None = Query(default=None),
    follow: bool = Query(default=True),
    tail: int = Query(default=DEFAULT_KUBE_LOG_TAIL, ge=0),
    previous: bool = Query(default=False),
) -> StreamingResponse:
    try:
        stream = stream_pod_logs(
            settings,
            context,
            namespace,
            pod,
            container,
            follow,
            tail,
            previous,
            is_disconnected=request.is_disconnected,
        )
    except KubectlNotInstalledError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    return _build_sse_response(stream)


@router.post(f"{AgentPath.KUBE_PODS.value}/{{pod}}{AgentPath.EXEC.value}")
async def post_kube_pod_exec(
    pod: str,
    request_body: KubeExecRequest,
    request: Request,
    auth: KuberExecAuth,
    settings: SettingsDep,
) -> StreamingResponse:
    try:
        build_exec_argv(
            settings,
            request_body.namespace,
            pod,
            request_body.container,
            request_body.command,
            request_body.context,
        )
    except KubectlNotInstalledError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    async def on_complete(captured: str, exit_code: int) -> None:
        await push_kube_operation(
            request.app.state.backend_client,
            auth.token,
            op_type=OperationType.KUBE_EXEC,
            ns=request_body.namespace,
            recipe={
                "pod": pod,
                "container": request_body.container,
                "context": request_body.context,
                "command": request_body.command,
            },
            result=PlainTextCommandResult(raw=captured, exit_code=exit_code),
        )

    stream = stream_pod_exec(
        settings,
        request_body.context,
        request_body.namespace,
        pod,
        request_body.container,
        request_body.command,
        is_disconnected=request.is_disconnected,
        on_complete=on_complete,
    )
    return _build_sse_response(stream)


@router.post(
    f"{AgentPath.KUBE_PODS.value}/{{pod}}{AgentPath.DELETE.value}",
    response_model=KubeCommandResult,
)
async def post_kube_pod_delete(
    pod: str,
    request_body: KubeDeletePodRequest,
    request: Request,
    auth: KuberDeletePodAuth,
    settings: SettingsDep,
) -> KubeCommandResult:
    try:
        result = await delete_pod(settings, request_body.context, request_body.namespace, pod)
    except KubectlNotInstalledError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    await push_kube_operation(
        request.app.state.backend_client,
        auth.token,
        op_type=OperationType.KUBE_DELETE_POD,
        ns=request_body.namespace,
        recipe={"pod": pod, "context": request_body.context},
        result=result,
    )
    return KubeCommandResult(raw=result.raw, exit_code=result.exit_code)


@router.get(AgentPath.KUBE_TOP.value, response_model=KubeTopResponse)
async def get_kube_top(
    _: KuberReadAuth,
    settings: SettingsDep,
    namespace: str = Query(...),
    context: str | None = Query(default=None),
) -> KubeTopResponse:
    try:
        result = await top_pods(settings, context, namespace)
    except KubectlNotInstalledError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    return KubeTopResponse(raw=result.raw, exit_code=result.exit_code)


@router.get(f"{AgentPath.JOBS.value}/{{job_id}}{AgentPath.STREAM.value}")
async def stream_job(
    job_id: str,
    _: AuthDep,
    job_manager: JobManagerDep,
) -> StreamingResponse:
    try:
        await job_manager.get_job(job_id)
        stream = job_manager.stream_job(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessage.JOB_NOT_FOUND.value,
        ) from exc
    return _build_sse_response(stream)


@router.get(f"{AgentPath.NAMESPACES.value}/{{namespace}}{AgentPath.LOGS.value}")
async def get_namespace_logs(
    namespace: str,
    request: Request,
    _: StagingsReadAuth,
    settings: SettingsDep,
    deploy: str = Query(...),
) -> StreamingResponse:
    if not deploy.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The deploy query parameter is required.",
        )

    try:
        stream = stream_namespace_logs(
            settings,
            namespace,
            deploy.strip(),
            is_disconnected=request.is_disconnected,
        )
    except StagingNotInstalledError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    return _build_sse_response(stream)


@router.post(
    f"{AgentPath.JOBS.value}/{{job_id}}{AgentPath.CANCEL.value}",
    response_model=JobReadResponse,
)
async def cancel_job(
    job_id: str,
    _: AuthDep,
    job_manager: JobManagerDep,
) -> JobReadResponse:
    try:
        return await job_manager.cancel_job(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessage.JOB_NOT_FOUND.value,
        ) from exc


def _build_sse_response(stream: AsyncIterator[str]) -> StreamingResponse:
    return StreamingResponse(
        stream,
        media_type=HeaderValue.EVENT_STREAM.value,
        headers={
            HeaderName.CONTENT_TYPE.value: HeaderValue.EVENT_STREAM_UTF8.value,
            HeaderName.CACHE_CONTROL.value: HeaderValue.NO_CACHE.value,
            HeaderName.CONNECTION.value: HeaderValue.KEEP_ALIVE.value,
        },
    )
