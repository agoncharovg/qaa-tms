"""HTTP routes."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from typing import Annotated, Any, cast

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ValidationError

from app.api.deps import AuthContext, get_job_manager, get_settings, require_auth
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
    Product,
    StagingEnvKey,
)
from app.schemas import (
    AdoptRequest,
    AgentPingResponse,
    AgentSettingsRead,
    AgentSettingsUpdate,
    AgentUpdateAccepted,
    DeployFlags,
    DeployRecipePayload,
    DeployRequest,
    DestroyRequest,
    E2eRunRequest,
    E2eSuite,
    E2eSuitesResponse,
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
    KubeNamespace,
    KubeNamespacesResponse,
    KubePod,
    KubePodDescribeResponse,
    KubePodsResponse,
    KubeTopResponse,
    KubeUseContextRequest,
    LeonidObjectDefinitionCreate,
    LeonidObjectDefinitionPatch,
    LeonidObjectDefinitionResponse,
    LeonidObjectDefinitionUpdate,
    LeonidObjectValueCreate,
    LeonidObjectValuePatch,
    LeonidObjectValueResponse,
    LeonidObjectValueUpdate,
    LeonidPipelineParamCreate,
    LeonidPipelineParamPatch,
    LeonidPipelineParamResponse,
    LeonidPipelineParamUpdate,
    LeonidSharedResourceCreate,
    LeonidSharedResourceLimitCreate,
    LeonidSharedResourceLimitPatch,
    LeonidSharedResourceLimitResponse,
    LeonidSharedResourceLimitTypeResponse,
    LeonidSharedResourceLimitUpdate,
    LeonidSharedResourcePatch,
    LeonidSharedResourceResponse,
    LeonidSharedResourceUpdate,
    NamespaceCredsResponse,
    NamespaceDeployRecipeResponse,
    NamespaceListResponse,
    NamespaceStatusResponse,
    PreflightItem,
    SyncRequest,
    to_agent_settings_read,
)
from app.services.e2e import list_e2e_suites
from app.services.jenkins import (
    JenkinsNotConfiguredError,
    JenkinsPathOutOfScopeError,
    JenkinsUnreachableError,
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
    delete_pod,
    describe_pod,
    list_contexts,
    list_namespaces_kube,
    list_pods,
    push_kube_operation,
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
from app.services.leonid import (
    LeonidNotConfiguredError,
    LeonidUnreachableError,
    create_object_definition,
    create_object_value,
    create_pipeline_param,
    create_shared_resource,
    create_shared_resource_limit,
    delete_object_definition,
    delete_object_value,
    delete_pipeline_param,
    delete_shared_resource,
    delete_shared_resource_limit,
    get_object_definition,
    get_object_value,
    get_pipeline_param,
    get_shared_resource,
    get_shared_resource_limit,
    get_shared_resource_limit_type,
    list_object_definitions,
    list_object_values,
    list_pipeline_params,
    list_shared_resource_limit_types,
    list_shared_resource_limits,
    list_shared_resources,
    patch_object_definition,
    patch_object_value,
    patch_pipeline_param,
    patch_shared_resource,
    patch_shared_resource_limit,
    toggle_object_definition,
    toggle_object_value,
    toggle_shared_resource,
    update_object_definition,
    update_object_value,
    update_pipeline_param,
    update_shared_resource,
    update_shared_resource_limit,
)
from app.services.namespaces import (
    list_namespaces,
    read_namespace_creds,
    read_namespace_deploy_recipe,
    read_namespace_status,
    stream_namespace_logs,
)
from app.services.preflight import collect_preflight
from app.services.staging import StagingNotInstalledError, build_ping_response
from app.services.update import spawn_update_helper

router = APIRouter()
AuthDep = Annotated[AuthContext, Depends(require_auth)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
JobManagerDep = Annotated[JobManager, Depends(get_job_manager)]
logger = logging.getLogger(__name__)

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


@router.get(AgentPath.PREFLIGHT.value, response_model=list[PreflightItem])
async def preflight(_: AuthDep, settings: SettingsDep) -> list[PreflightItem]:
    return await collect_preflight(settings)


def require_leonid_read_configured(settings: Settings) -> None:
    if not settings.leonid_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=ErrorMessage.LEONID_NOT_CONFIGURED.value,
        )


def require_leonid_write_configured(settings: Settings) -> None:
    if not settings.leonid_write_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=ErrorMessage.LEONID_WRITE_NOT_CONFIGURED.value,
        )


def raise_leonid_http_error(exc: LeonidNotConfiguredError | LeonidUnreachableError) -> None:
    if isinstance(exc, LeonidNotConfiguredError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=str(exc),
    ) from exc


def format_validation_error(exc: ValidationError) -> str:
    first_error = exc.errors(include_url=False)[0]
    location = ".".join(str(part) for part in first_error.get("loc", ()))
    message = str(first_error.get("msg", "Invalid request body."))
    if location:
        return f"Invalid request body: {location}: {message}"
    return f"Invalid request body: {message}"


def parse_request_model(
    payload: Any,
    model_type: type[BaseModel],
    *,
    partial: bool = False,
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid request body: expected a JSON object.",
        )

    try:
        model = model_type.model_validate(payload)
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=format_validation_error(exc),
        ) from exc

    return model.model_dump(exclude_unset=partial)


@router.get(
    AgentPath.LEONID_SHARED_RESOURCE_LIMIT_TYPES.value,
    response_model=list[LeonidSharedResourceLimitTypeResponse],
)
async def get_leonid_shared_resource_limit_types(
    _: AuthDep,
    settings: SettingsDep,
) -> list[LeonidSharedResourceLimitTypeResponse]:
    require_leonid_read_configured(settings)
    try:
        payload = await list_shared_resource_limit_types(settings)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)
    return [LeonidSharedResourceLimitTypeResponse(**item) for item in payload]


@router.get(
    f"{AgentPath.LEONID_SHARED_RESOURCE_LIMIT_TYPES.value}/{{limit_type_id}}",
    response_model=LeonidSharedResourceLimitTypeResponse,
)
async def get_leonid_shared_resource_limit_type(
    limit_type_id: int,
    _: AuthDep,
    settings: SettingsDep,
) -> LeonidSharedResourceLimitTypeResponse:
    require_leonid_read_configured(settings)
    try:
        payload = await get_shared_resource_limit_type(settings, limit_type_id)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)
    return LeonidSharedResourceLimitTypeResponse(**payload)


@router.get(
    AgentPath.LEONID_SHARED_RESOURCE_LIMITS.value,
    response_model=list[LeonidSharedResourceLimitResponse],
)
async def get_leonid_shared_resource_limits(
    _: AuthDep,
    settings: SettingsDep,
) -> list[LeonidSharedResourceLimitResponse]:
    require_leonid_read_configured(settings)
    try:
        payload = await list_shared_resource_limits(settings)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)
    return [LeonidSharedResourceLimitResponse(**item) for item in payload]


@router.post(
    AgentPath.LEONID_SHARED_RESOURCE_LIMITS.value,
    response_model=LeonidSharedResourceLimitResponse,
    status_code=status.HTTP_201_CREATED,
)
async def post_leonid_shared_resource_limit(
    _: AuthDep,
    settings: SettingsDep,
    payload: Annotated[Any, Body()],
) -> LeonidSharedResourceLimitResponse:
    require_leonid_write_configured(settings)
    body = parse_request_model(payload, LeonidSharedResourceLimitCreate)
    try:
        response_payload = await create_shared_resource_limit(settings, body)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)
    return LeonidSharedResourceLimitResponse(**response_payload)


@router.get(
    f"{AgentPath.LEONID_SHARED_RESOURCE_LIMITS.value}/{{limit_id}}",
    response_model=LeonidSharedResourceLimitResponse,
)
async def get_leonid_shared_resource_limit(
    limit_id: int,
    _: AuthDep,
    settings: SettingsDep,
) -> LeonidSharedResourceLimitResponse:
    require_leonid_read_configured(settings)
    try:
        payload = await get_shared_resource_limit(settings, limit_id)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)
    return LeonidSharedResourceLimitResponse(**payload)


@router.put(
    f"{AgentPath.LEONID_SHARED_RESOURCE_LIMITS.value}/{{limit_id}}",
    response_model=LeonidSharedResourceLimitResponse,
)
async def put_leonid_shared_resource_limit(
    limit_id: int,
    _: AuthDep,
    settings: SettingsDep,
    payload: Annotated[Any, Body()],
) -> LeonidSharedResourceLimitResponse:
    require_leonid_write_configured(settings)
    body = parse_request_model(payload, LeonidSharedResourceLimitUpdate)
    try:
        response_payload = await update_shared_resource_limit(settings, limit_id, body)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)
    return LeonidSharedResourceLimitResponse(**response_payload)


@router.patch(
    f"{AgentPath.LEONID_SHARED_RESOURCE_LIMITS.value}/{{limit_id}}",
    response_model=LeonidSharedResourceLimitResponse,
)
async def patch_leonid_shared_resource_limit_route(
    limit_id: int,
    _: AuthDep,
    settings: SettingsDep,
    payload: Annotated[Any, Body()],
) -> LeonidSharedResourceLimitResponse:
    require_leonid_write_configured(settings)
    body = parse_request_model(payload, LeonidSharedResourceLimitPatch, partial=True)
    try:
        response_payload = await patch_shared_resource_limit(settings, limit_id, body)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)
    return LeonidSharedResourceLimitResponse(**response_payload)


@router.delete(
    f"{AgentPath.LEONID_SHARED_RESOURCE_LIMITS.value}/{{limit_id}}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_leonid_shared_resource_limit_route(
    limit_id: int,
    _: AuthDep,
    settings: SettingsDep,
) -> None:
    require_leonid_write_configured(settings)
    try:
        await delete_shared_resource_limit(settings, limit_id)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)


@router.get(
    AgentPath.LEONID_SHARED_RESOURCES.value,
    response_model=list[LeonidSharedResourceResponse],
)
async def get_leonid_shared_resources(
    _: AuthDep,
    settings: SettingsDep,
) -> list[LeonidSharedResourceResponse]:
    require_leonid_read_configured(settings)
    try:
        payload = await list_shared_resources(settings)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)
    return [LeonidSharedResourceResponse(**item) for item in payload]


@router.post(
    AgentPath.LEONID_SHARED_RESOURCES.value,
    response_model=LeonidSharedResourceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def post_leonid_shared_resource(
    _: AuthDep,
    settings: SettingsDep,
    payload: Annotated[Any, Body()],
) -> LeonidSharedResourceResponse:
    require_leonid_write_configured(settings)
    body = parse_request_model(payload, LeonidSharedResourceCreate)
    try:
        response_payload = await create_shared_resource(settings, body)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)
    return LeonidSharedResourceResponse(**response_payload)


@router.get(
    f"{AgentPath.LEONID_SHARED_RESOURCES.value}/{{resource_id}}",
    response_model=LeonidSharedResourceResponse,
)
async def get_leonid_shared_resource(
    resource_id: int,
    _: AuthDep,
    settings: SettingsDep,
) -> LeonidSharedResourceResponse:
    require_leonid_read_configured(settings)
    try:
        payload = await get_shared_resource(settings, resource_id)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)
    return LeonidSharedResourceResponse(**payload)


@router.put(
    f"{AgentPath.LEONID_SHARED_RESOURCES.value}/{{resource_id}}",
    response_model=LeonidSharedResourceResponse,
)
async def put_leonid_shared_resource(
    resource_id: int,
    _: AuthDep,
    settings: SettingsDep,
    payload: Annotated[Any, Body()],
) -> LeonidSharedResourceResponse:
    require_leonid_write_configured(settings)
    body = parse_request_model(payload, LeonidSharedResourceUpdate)
    try:
        response_payload = await update_shared_resource(settings, resource_id, body)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)
    return LeonidSharedResourceResponse(**response_payload)


@router.patch(
    f"{AgentPath.LEONID_SHARED_RESOURCES.value}/{{resource_id}}",
    response_model=LeonidSharedResourceResponse,
)
async def patch_leonid_shared_resource_route(
    resource_id: int,
    _: AuthDep,
    settings: SettingsDep,
    payload: Annotated[Any, Body()],
) -> LeonidSharedResourceResponse:
    require_leonid_write_configured(settings)
    body = parse_request_model(payload, LeonidSharedResourcePatch, partial=True)
    try:
        response_payload = await patch_shared_resource(settings, resource_id, body)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)
    return LeonidSharedResourceResponse(**response_payload)


@router.delete(
    f"{AgentPath.LEONID_SHARED_RESOURCES.value}/{{resource_id}}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_leonid_shared_resource_route(
    resource_id: int,
    _: AuthDep,
    settings: SettingsDep,
) -> None:
    require_leonid_write_configured(settings)
    try:
        await delete_shared_resource(settings, resource_id)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)


@router.post(
    f"{AgentPath.LEONID_SHARED_RESOURCES.value}/{{resource_id}}/toggle_enabled",
    response_model=LeonidSharedResourceResponse,
)
async def toggle_leonid_shared_resource_route(
    resource_id: int,
    _: AuthDep,
    settings: SettingsDep,
) -> LeonidSharedResourceResponse:
    require_leonid_write_configured(settings)
    try:
        payload = await toggle_shared_resource(settings, resource_id)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)
    return LeonidSharedResourceResponse(**payload)


@router.get(
    AgentPath.LEONID_OBJECT_DEFINITIONS.value,
    response_model=list[LeonidObjectDefinitionResponse],
)
async def get_leonid_object_definitions(
    _: AuthDep,
    settings: SettingsDep,
) -> list[LeonidObjectDefinitionResponse]:
    require_leonid_read_configured(settings)
    try:
        payload = await list_object_definitions(settings)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)
    return [LeonidObjectDefinitionResponse(**item) for item in payload]


@router.post(
    AgentPath.LEONID_OBJECT_DEFINITIONS.value,
    response_model=LeonidObjectDefinitionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def post_leonid_object_definition(
    _: AuthDep,
    settings: SettingsDep,
    payload: Annotated[Any, Body()],
) -> LeonidObjectDefinitionResponse:
    require_leonid_write_configured(settings)
    body = parse_request_model(payload, LeonidObjectDefinitionCreate)
    try:
        response_payload = await create_object_definition(settings, body)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)
    return LeonidObjectDefinitionResponse(**response_payload)


@router.get(
    f"{AgentPath.LEONID_OBJECT_DEFINITIONS.value}/{{definition_id}}",
    response_model=LeonidObjectDefinitionResponse,
)
async def get_leonid_object_definition(
    definition_id: int,
    _: AuthDep,
    settings: SettingsDep,
) -> LeonidObjectDefinitionResponse:
    require_leonid_read_configured(settings)
    try:
        payload = await get_object_definition(settings, definition_id)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)
    return LeonidObjectDefinitionResponse(**payload)


@router.put(
    f"{AgentPath.LEONID_OBJECT_DEFINITIONS.value}/{{definition_id}}",
    response_model=LeonidObjectDefinitionResponse,
)
async def put_leonid_object_definition(
    definition_id: int,
    _: AuthDep,
    settings: SettingsDep,
    payload: Annotated[Any, Body()],
) -> LeonidObjectDefinitionResponse:
    require_leonid_write_configured(settings)
    body = parse_request_model(payload, LeonidObjectDefinitionUpdate)
    try:
        response_payload = await update_object_definition(settings, definition_id, body)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)
    return LeonidObjectDefinitionResponse(**response_payload)


@router.patch(
    f"{AgentPath.LEONID_OBJECT_DEFINITIONS.value}/{{definition_id}}",
    response_model=LeonidObjectDefinitionResponse,
)
async def patch_leonid_object_definition_route(
    definition_id: int,
    _: AuthDep,
    settings: SettingsDep,
    payload: Annotated[Any, Body()],
) -> LeonidObjectDefinitionResponse:
    require_leonid_write_configured(settings)
    body = parse_request_model(payload, LeonidObjectDefinitionPatch, partial=True)
    try:
        response_payload = await patch_object_definition(settings, definition_id, body)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)
    return LeonidObjectDefinitionResponse(**response_payload)


@router.delete(
    f"{AgentPath.LEONID_OBJECT_DEFINITIONS.value}/{{definition_id}}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_leonid_object_definition_route(
    definition_id: int,
    _: AuthDep,
    settings: SettingsDep,
) -> None:
    require_leonid_write_configured(settings)
    try:
        await delete_object_definition(settings, definition_id)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)


@router.post(
    f"{AgentPath.LEONID_OBJECT_DEFINITIONS.value}/{{definition_id}}/toggle_enabled",
    response_model=LeonidObjectDefinitionResponse,
)
async def toggle_leonid_object_definition_route(
    definition_id: int,
    _: AuthDep,
    settings: SettingsDep,
) -> LeonidObjectDefinitionResponse:
    require_leonid_write_configured(settings)
    try:
        payload = await toggle_object_definition(settings, definition_id)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)
    return LeonidObjectDefinitionResponse(**payload)


@router.get(
    AgentPath.LEONID_OBJECT_VALUES.value,
    response_model=list[LeonidObjectValueResponse],
)
async def get_leonid_object_values(
    _: AuthDep,
    settings: SettingsDep,
) -> list[LeonidObjectValueResponse]:
    require_leonid_read_configured(settings)
    try:
        payload = await list_object_values(settings)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)
    return [LeonidObjectValueResponse(**item) for item in payload]


@router.post(
    AgentPath.LEONID_OBJECT_VALUES.value,
    response_model=LeonidObjectValueResponse,
    status_code=status.HTTP_201_CREATED,
)
async def post_leonid_object_value(
    _: AuthDep,
    settings: SettingsDep,
    payload: Annotated[Any, Body()],
) -> LeonidObjectValueResponse:
    require_leonid_write_configured(settings)
    body = parse_request_model(payload, LeonidObjectValueCreate)
    try:
        response_payload = await create_object_value(settings, body)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)
    return LeonidObjectValueResponse(**response_payload)


@router.get(
    f"{AgentPath.LEONID_OBJECT_VALUES.value}/{{value_id}}",
    response_model=LeonidObjectValueResponse,
)
async def get_leonid_object_value(
    value_id: int,
    _: AuthDep,
    settings: SettingsDep,
) -> LeonidObjectValueResponse:
    require_leonid_read_configured(settings)
    try:
        payload = await get_object_value(settings, value_id)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)
    return LeonidObjectValueResponse(**payload)


@router.put(
    f"{AgentPath.LEONID_OBJECT_VALUES.value}/{{value_id}}",
    response_model=LeonidObjectValueResponse,
)
async def put_leonid_object_value(
    value_id: int,
    _: AuthDep,
    settings: SettingsDep,
    payload: Annotated[Any, Body()],
) -> LeonidObjectValueResponse:
    require_leonid_write_configured(settings)
    body = parse_request_model(payload, LeonidObjectValueUpdate)
    try:
        response_payload = await update_object_value(settings, value_id, body)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)
    return LeonidObjectValueResponse(**response_payload)


@router.patch(
    f"{AgentPath.LEONID_OBJECT_VALUES.value}/{{value_id}}",
    response_model=LeonidObjectValueResponse,
)
async def patch_leonid_object_value_route(
    value_id: int,
    _: AuthDep,
    settings: SettingsDep,
    payload: Annotated[Any, Body()],
) -> LeonidObjectValueResponse:
    require_leonid_write_configured(settings)
    body = parse_request_model(payload, LeonidObjectValuePatch, partial=True)
    try:
        response_payload = await patch_object_value(settings, value_id, body)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)
    return LeonidObjectValueResponse(**response_payload)


@router.delete(
    f"{AgentPath.LEONID_OBJECT_VALUES.value}/{{value_id}}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_leonid_object_value_route(
    value_id: int,
    _: AuthDep,
    settings: SettingsDep,
) -> None:
    require_leonid_write_configured(settings)
    try:
        await delete_object_value(settings, value_id)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)


@router.post(
    f"{AgentPath.LEONID_OBJECT_VALUES.value}/{{value_id}}/toggle_enabled",
    response_model=LeonidObjectValueResponse,
)
async def toggle_leonid_object_value_route(
    value_id: int,
    _: AuthDep,
    settings: SettingsDep,
) -> LeonidObjectValueResponse:
    require_leonid_write_configured(settings)
    try:
        payload = await toggle_object_value(settings, value_id)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)
    return LeonidObjectValueResponse(**payload)


@router.get(
    AgentPath.LEONID_PIPELINE_PARAMS.value,
    response_model=list[LeonidPipelineParamResponse],
)
async def get_leonid_pipeline_params(
    _: AuthDep,
    settings: SettingsDep,
) -> list[LeonidPipelineParamResponse]:
    require_leonid_read_configured(settings)
    try:
        payload = await list_pipeline_params(settings)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)
    return [LeonidPipelineParamResponse(**item) for item in payload]


@router.post(
    AgentPath.LEONID_PIPELINE_PARAMS.value,
    response_model=LeonidPipelineParamResponse,
    status_code=status.HTTP_201_CREATED,
)
async def post_leonid_pipeline_param(
    _: AuthDep,
    settings: SettingsDep,
    payload: Annotated[Any, Body()],
) -> LeonidPipelineParamResponse:
    require_leonid_write_configured(settings)
    body = parse_request_model(payload, LeonidPipelineParamCreate)
    try:
        response_payload = await create_pipeline_param(settings, body)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)
    return LeonidPipelineParamResponse(**response_payload)


@router.get(
    f"{AgentPath.LEONID_PIPELINE_PARAMS.value}/{{pipeline_param_id}}",
    response_model=LeonidPipelineParamResponse,
)
async def get_leonid_pipeline_param(
    pipeline_param_id: int,
    _: AuthDep,
    settings: SettingsDep,
) -> LeonidPipelineParamResponse:
    require_leonid_read_configured(settings)
    try:
        payload = await get_pipeline_param(settings, pipeline_param_id)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)
    return LeonidPipelineParamResponse(**payload)


@router.put(
    f"{AgentPath.LEONID_PIPELINE_PARAMS.value}/{{pipeline_param_id}}",
    response_model=LeonidPipelineParamResponse,
)
async def put_leonid_pipeline_param(
    pipeline_param_id: int,
    _: AuthDep,
    settings: SettingsDep,
    payload: Annotated[Any, Body()],
) -> LeonidPipelineParamResponse:
    require_leonid_write_configured(settings)
    body = parse_request_model(payload, LeonidPipelineParamUpdate)
    try:
        response_payload = await update_pipeline_param(settings, pipeline_param_id, body)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)
    return LeonidPipelineParamResponse(**response_payload)


@router.patch(
    f"{AgentPath.LEONID_PIPELINE_PARAMS.value}/{{pipeline_param_id}}",
    response_model=LeonidPipelineParamResponse,
)
async def patch_leonid_pipeline_param_route(
    pipeline_param_id: int,
    _: AuthDep,
    settings: SettingsDep,
    payload: Annotated[Any, Body()],
) -> LeonidPipelineParamResponse:
    require_leonid_write_configured(settings)
    body = parse_request_model(payload, LeonidPipelineParamPatch, partial=True)
    try:
        response_payload = await patch_pipeline_param(settings, pipeline_param_id, body)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)
    return LeonidPipelineParamResponse(**response_payload)


@router.delete(
    f"{AgentPath.LEONID_PIPELINE_PARAMS.value}/{{pipeline_param_id}}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_leonid_pipeline_param_route(
    pipeline_param_id: int,
    _: AuthDep,
    settings: SettingsDep,
) -> None:
    require_leonid_write_configured(settings)
    try:
        await delete_pipeline_param(settings, pipeline_param_id)
    except (LeonidNotConfiguredError, LeonidUnreachableError) as exc:
        raise_leonid_http_error(exc)


@router.post(
    AgentPath.UPDATE.value,
    response_model=AgentUpdateAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
async def update_agent(_: AuthDep) -> AgentUpdateAccepted:
    try:
        spawn_update_helper()
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    return AgentUpdateAccepted(status=AgentUpdateStatus.ACCEPTED)


@router.get(AgentPath.JENKINS_TREE.value, response_model=JenkinsTreeResponse)
async def get_jenkins_tree(
    _: AuthDep,
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
    _: AuthDep,
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
    _: AuthDep,
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
    _: AuthDep,
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


@router.post(AgentPath.JENKINS_FREEZE.value, response_model=JenkinsFreezeResponse)
async def post_jenkins_freeze(
    request_body: JenkinsFreezeRequest,
    _: AuthDep,
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
    _: AuthDep,
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
    auth: AuthDep,
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
async def get_kubeconfig_status(_: AuthDep, settings: SettingsDep) -> KubeconfigStatus:
    return read_status(settings)


@router.post(AgentPath.KUBECONFIG_REFRESH.value, response_model=KubeconfigStatus)
async def post_kubeconfig_refresh(
    request_body: KubeconfigRefreshRequest,
    request: Request,
    auth: AuthDep,
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
    auth: AuthDep,
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
    auth: AuthDep,
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
    auth: AuthDep,
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
    auth: AuthDep,
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
    auth: AuthDep,
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
    _: AuthDep,
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
    auth: AuthDep,
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
    _: AuthDep,
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
    _: AuthDep,
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
    _: AuthDep,
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
    _: AuthDep,
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
    _: AuthDep,
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
    auth: AuthDep,
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
    _: AuthDep,
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
    _: AuthDep,
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
    _: AuthDep,
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
    _: AuthDep,
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


@router.post(
    f"{AgentPath.KUBE_PODS.value}/{{pod}}{AgentPath.DELETE.value}",
    response_model=KubeCommandResult,
)
async def post_kube_pod_delete(
    pod: str,
    request_body: KubeDeletePodRequest,
    request: Request,
    auth: AuthDep,
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
    _: AuthDep,
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
    _: AuthDep,
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
