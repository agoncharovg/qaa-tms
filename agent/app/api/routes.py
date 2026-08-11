"""HTTP routes."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse

from app.api.deps import AuthContext, get_job_manager, get_settings, require_auth
from app.core.config import Settings
from app.core.constants import (
    DEFAULT_KUBE_LOG_TAIL,
    AgentPath,
    ErrorMessage,
    HeaderName,
    HeaderValue,
    OperationType,
    Product,
)
from app.schemas import (
    AdoptRequest,
    AgentPingResponse,
    DeployFlags,
    DeployRecipePayload,
    DeployRequest,
    DestroyRequest,
    E2eRunRequest,
    E2eSuite,
    E2eSuitesResponse,
    JobCreateResponse,
    JobReadResponse,
    KubeCommandResult,
    KubeContextsResponse,
    KubeDeletePodRequest,
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
    PreflightItem,
    SyncRequest,
)
from app.services.e2e import list_e2e_suites
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
from app.services.namespaces import (
    list_namespaces,
    read_namespace_creds,
    read_namespace_deploy_recipe,
    read_namespace_status,
    stream_namespace_logs,
)
from app.services.preflight import collect_preflight
from app.services.staging import StagingNotInstalledError, build_ping_response

router = APIRouter()
AuthDep = Annotated[AuthContext, Depends(require_auth)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
JobManagerDep = Annotated[JobManager, Depends(get_job_manager)]


@router.get(AgentPath.PING.value, response_model=AgentPingResponse)
async def ping(settings: SettingsDep) -> AgentPingResponse:
    return build_ping_response(settings)


@router.get(AgentPath.PREFLIGHT.value, response_model=list[PreflightItem])
async def preflight(_: AuthDep, settings: SettingsDep) -> list[PreflightItem]:
    return await collect_preflight(settings)


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
