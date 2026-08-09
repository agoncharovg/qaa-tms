"""HTTP routes."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

from app.api.deps import AuthContext, get_job_manager, get_settings, require_auth
from app.core.config import Settings
from app.core.constants import AgentPath, HeaderName
from app.schemas import (
    AgentPingResponse,
    DeployRequest,
    JobCreateResponse,
    JobReadResponse,
    PreflightItem,
)
from app.services.jobs import JobManager, JobNotFoundError
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


@router.get(f"{AgentPath.JOBS.value}/{{job_id}}", response_model=JobReadResponse)
async def read_job(
    job_id: str,
    _: AuthDep,
    job_manager: JobManagerDep,
) -> JobReadResponse:
    try:
        return await job_manager.get_job_response(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.") from exc


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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.") from exc
    return StreamingResponse(
        stream,
        media_type="text/event-stream",
        headers={
            HeaderName.CONTENT_TYPE.value: "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.") from exc
