"""Bundled companion source artifact routes."""

from __future__ import annotations

from typing import cast

from fastapi import APIRouter, HTTPException, Request, Response, status
from fastapi.responses import FileResponse

from app.core.config import Settings
from app.core.constants import (
    AGENT_MIN_SUPPORTED_VERSION,
    ApiPrefix,
    ApiTag,
    CacheControl,
    HttpHeader,
    MediaType,
    RoutePath,
)
from app.schemas.agent import AgentManifestResponse
from app.services.agent_bundle import (
    AGENT_TARBALL_NAME,
    AgentBundleUnavailableError,
    get_agent_bundle,
)

router = APIRouter(prefix=RoutePath.AGENT.value, tags=[ApiTag.SYSTEM.value])


def get_runtime_settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


@router.get(RoutePath.MANIFEST.value, response_model=AgentManifestResponse)
async def get_agent_manifest(request: Request, response: Response) -> AgentManifestResponse:
    try:
        bundle = get_agent_bundle(get_runtime_settings(request))
    except AgentBundleUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    # The bundle changes on every redeploy; never let a client cache a stale version/sha.
    response.headers[HttpHeader.CACHE_CONTROL.value] = CacheControl.NO_STORE.value
    return AgentManifestResponse(
        version=bundle.version,
        min_supported=AGENT_MIN_SUPPORTED_VERSION,
        download_url=f"{ApiPrefix.V1.value}{RoutePath.AGENT.value}{RoutePath.DOWNLOAD.value}",
        sha256=bundle.sha256,
        os=None,
    )


@router.get(RoutePath.DOWNLOAD.value)
async def download_agent_bundle(request: Request) -> FileResponse:
    try:
        bundle = get_agent_bundle(get_runtime_settings(request))
    except AgentBundleUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc

    return FileResponse(
        bundle.tarball_path,
        filename=AGENT_TARBALL_NAME,
        media_type=MediaType.GZIP.value,
        headers={HttpHeader.CACHE_CONTROL.value: CacheControl.NO_STORE.value},
    )
