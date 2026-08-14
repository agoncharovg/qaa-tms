"""QAA routes proxied through the local companion."""

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from typing import Annotated, Any, cast
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.api.deps import AuthContext, get_settings, require_auth
from app.core.config import Settings
from app.core.constants import AgentPath, BackendPath, HeaderName, HeaderValue
from app.schemas import QaaRunCreateRequest

router = APIRouter()
AuthDep = Annotated[AuthContext, Depends(require_auth)]
SettingsDep = Annotated[Settings, Depends(get_settings)]


def get_backend_client(request: Request) -> httpx.AsyncClient:
    return cast(httpx.AsyncClient, request.app.state.backend_client)


def build_backend_qaa_run_path(run_id: str) -> str:
    return f"{BackendPath.QAA_RUNS.value}/{quote(run_id, safe='')}"


def build_backend_qaa_run_artifacts_path(run_id: str, suffix: str) -> str:
    return f"{build_backend_qaa_run_path(run_id)}{suffix}"


def build_proxy_headers(
    auth: AuthContext,
    settings: Settings,
    *,
    accept: str,
    content_type: str | None = None,
    idempotency_key: str | None = None,
    last_event_id: str | None = None,
) -> dict[str, str]:
    headers = {
        HeaderName.ACCEPT.value: accept,
        HeaderName.AUTHORIZATION.value: f"{HeaderValue.BEARER.value} {auth.token}",
        HeaderName.X_QAA_TMS.value: HeaderValue.X_QAA_TMS_ENABLED.value,
    }
    if settings.qaa_generator_token:
        headers[HeaderName.X_QAA_GENERATOR_TOKEN.value] = settings.qaa_generator_token
    if content_type is not None:
        headers[HeaderName.CONTENT_TYPE.value] = content_type
    if idempotency_key:
        headers[HeaderName.IDEMPOTENCY_KEY.value] = idempotency_key
    if last_event_id:
        headers[HeaderName.LAST_EVENT_ID.value] = last_event_id
    return headers


async def read_response_payload(response: httpx.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        text = response.text.strip()
        return {"detail": text} if text else {}


def extract_error_detail(payload: Any, default: str) -> str:
    if isinstance(payload, dict):
        detail = payload.get("detail")
        if isinstance(detail, str) and detail.strip():
            return detail
    return default


async def proxy_backend_json(
    request: Request,
    auth: AuthContext,
    settings: Settings,
    *,
    method: str,
    path: str,
    params: Sequence[tuple[str, str]] | None = None,
    json_body: dict[str, Any] | None = None,
    idempotency_key: str | None = None,
) -> JSONResponse:
    response = await get_backend_client(request).request(
        method=method,
        url=path,
        headers=build_proxy_headers(
            auth,
            settings,
            accept=HeaderValue.APPLICATION_JSON.value,
            content_type=HeaderValue.APPLICATION_JSON.value if json_body is not None else None,
            idempotency_key=idempotency_key,
        ),
        params=tuple(params) if params is not None else None,
        json=json_body,
    )
    return JSONResponse(content=await read_response_payload(response), status_code=response.status_code)


@router.post(AgentPath.QAA_RUNS.value)
async def create_qaa_run(
    payload: QaaRunCreateRequest,
    request: Request,
    auth: AuthDep,
    settings: SettingsDep,
    idempotency_key: Annotated[str | None, Header(alias=HeaderName.IDEMPOTENCY_KEY.value)] = None,
) -> JSONResponse:
    return await proxy_backend_json(
        request,
        auth,
        settings,
        method="POST",
        path=BackendPath.QAA_RUNS.value,
        json_body=payload.model_dump(mode="json"),
        idempotency_key=idempotency_key,
    )


@router.get(AgentPath.QAA_RUNS.value)
async def list_qaa_runs(
    request: Request,
    auth: AuthDep,
    settings: SettingsDep,
) -> JSONResponse:
    return await proxy_backend_json(
        request,
        auth,
        settings,
        method="GET",
        path=BackendPath.QAA_RUNS.value,
        params=list(request.query_params.multi_items()),
    )


@router.get(f"{AgentPath.QAA_RUNS.value}/{{run_id}}")
async def get_qaa_run(
    run_id: str,
    request: Request,
    auth: AuthDep,
    settings: SettingsDep,
) -> JSONResponse:
    return await proxy_backend_json(
        request,
        auth,
        settings,
        method="GET",
        path=build_backend_qaa_run_path(run_id),
    )


@router.get(f"{AgentPath.QAA_RUNS.value}/{{run_id}}{AgentPath.QAA_ARTIFACTS.value}")
async def get_qaa_run_artifacts(
    run_id: str,
    request: Request,
    auth: AuthDep,
    settings: SettingsDep,
) -> JSONResponse:
    return await proxy_backend_json(
        request,
        auth,
        settings,
        method="GET",
        path=build_backend_qaa_run_artifacts_path(run_id, AgentPath.QAA_ARTIFACTS.value),
    )


async def handle_qaa_run_action(
    run_id: str,
    request: Request,
    auth: AuthContext,
    settings: Settings,
    suffix: AgentPath,
) -> JSONResponse:
    return await proxy_backend_json(
        request,
        auth,
        settings,
        method="POST",
        path=build_backend_qaa_run_artifacts_path(run_id, suffix.value),
    )


@router.post(f"{AgentPath.QAA_RUNS.value}/{{run_id}}{AgentPath.QAA_PAUSE.value}")
async def pause_qaa_run(run_id: str, request: Request, auth: AuthDep, settings: SettingsDep) -> JSONResponse:
    return await handle_qaa_run_action(run_id, request, auth, settings, AgentPath.QAA_PAUSE)


@router.post(f"{AgentPath.QAA_RUNS.value}/{{run_id}}{AgentPath.QAA_RESUME.value}")
async def resume_qaa_run(run_id: str, request: Request, auth: AuthDep, settings: SettingsDep) -> JSONResponse:
    return await handle_qaa_run_action(run_id, request, auth, settings, AgentPath.QAA_RESUME)


@router.post(f"{AgentPath.QAA_RUNS.value}/{{run_id}}{AgentPath.QAA_STOP.value}")
async def stop_qaa_run(run_id: str, request: Request, auth: AuthDep, settings: SettingsDep) -> JSONResponse:
    return await handle_qaa_run_action(run_id, request, auth, settings, AgentPath.QAA_STOP)


@router.get(f"{AgentPath.QAA_RUNS.value}/{{run_id}}{AgentPath.QAA_EVENTS_STREAM.value}")
async def stream_qaa_run_events(
    run_id: str,
    request: Request,
    auth: AuthDep,
    settings: SettingsDep,
    last_event_id: Annotated[str | None, Header(alias=HeaderName.LAST_EVENT_ID.value)] = None,
) -> StreamingResponse:
    backend_client = get_backend_client(request)
    backend_request = backend_client.build_request(
        "GET",
        build_backend_qaa_run_artifacts_path(run_id, AgentPath.QAA_EVENTS_STREAM.value),
        headers=build_proxy_headers(
            auth,
            settings,
            accept=HeaderValue.EVENT_STREAM.value,
            last_event_id=last_event_id,
        ),
    )
    response = await backend_client.send(backend_request, stream=True)
    if not response.is_success:
        payload = await read_response_payload(response)
        await response.aclose()
        raise HTTPException(status_code=response.status_code, detail=extract_error_detail(payload, "QAA stream failed."))

    async def iterate_stream() -> AsyncIterator[bytes]:
        try:
            async for chunk in response.aiter_bytes():
                if await request.is_disconnected():
                    break
                if chunk:
                    yield chunk
        finally:
            await response.aclose()

    return StreamingResponse(iterate_stream(), media_type=HeaderValue.EVENT_STREAM.value)
