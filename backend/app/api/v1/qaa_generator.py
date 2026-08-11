"""QAA generator proxy routes."""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime
from enum import StrEnum
from typing import Annotated, Any, cast

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_db
from app.core.config import Settings
from app.core.constants import (
    ApiTag,
    HttpHeader,
    MediaType,
    OperationStatus,
    OperationType,
    QaaRunStatus,
    RoutePath,
)
from app.models.operation import Operation
from app.models.user import User
from app.schemas.operation import OperationRecipe
from app.schemas.qaa_generator import QaaRunCreateRequest
from app.services.qaa_generator import (
    PASSTHROUGH_STATUS_CODES,
    QaaGeneratorJsonResponse,
    QaaGeneratorServicePath,
    build_outbound_headers,
    build_qaa_run_artifacts_path,
    build_qaa_run_path,
    open_event_stream,
    request_json,
)

router = APIRouter(prefix=RoutePath.QAA_RUNS.value, tags=[ApiTag.QAA_GENERATOR.value])
ROOT_ROUTE_PATH = ""


class QaaListQueryParam(StrEnum):
    CREATED_FROM = "created_from"
    CREATED_TO = "created_to"
    CURSOR = "cursor"
    EFFECTIVE_ACTOR = "effective_actor"
    JIRA_KEY = "jira_key"
    LIMIT = "limit"
    STATUS = "status"


class QaaPayloadField(StrEnum):
    BRANCH = "branch"
    DRY_RUN = "dry_run"
    FLAGS = "flags"
    JIRA_KEY = "jira_key"
    PROFILE = "profile"
    RUN_ID = "run_id"
    SKIP_EXEC = "skip_exec"
    SKIP_PR = "skip_pr"
    STATUS = "status"


class HttpMethod(StrEnum):
    GET = "GET"
    POST = "POST"


TERMINAL_QAA_TO_OPERATION_STATUS = {
    QaaRunStatus.COMPLETED: OperationStatus.SUCCESS,
    QaaRunStatus.FAILED: OperationStatus.FAILED,
    QaaRunStatus.STOPPED: OperationStatus.ABORTED,
}


def utcnow() -> datetime:
    return datetime.now(UTC)


def get_qaa_client(request: Request) -> httpx.AsyncClient:
    return cast(httpx.AsyncClient, request.app.state.qaa_generator_client)


def get_settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


def build_operation_recipe(
    payload: QaaRunCreateRequest,
    run_id: str | None = None,
) -> OperationRecipe:
    flags: dict[str, Any] = {
        QaaPayloadField.JIRA_KEY.value: payload.jira_key,
        QaaPayloadField.DRY_RUN.value: payload.dry_run,
        QaaPayloadField.SKIP_PR.value: payload.skip_pr,
        QaaPayloadField.SKIP_EXEC.value: payload.skip_exec,
        QaaPayloadField.PROFILE.value: payload.profile.value,
    }
    if payload.branch is not None:
        flags[QaaPayloadField.BRANCH.value] = payload.branch
    if run_id is not None:
        flags[QaaPayloadField.RUN_ID.value] = run_id
    return OperationRecipe(flags=flags)


def build_proxy_response(result: QaaGeneratorJsonResponse) -> JSONResponse:
    return JSONResponse(content=result.payload, status_code=result.status_code)


def extract_run_id(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None
    run_id = payload.get(QaaPayloadField.RUN_ID.value)
    return run_id if isinstance(run_id, str) else None


def extract_qaa_run_status(payload: Any) -> QaaRunStatus | None:
    if not isinstance(payload, dict):
        return None
    status_value = payload.get(QaaPayloadField.STATUS.value)
    if not isinstance(status_value, str):
        return None
    try:
        return QaaRunStatus(status_value)
    except ValueError:
        return None


async def create_audit_operation(
    db: AsyncSession,
    current_user: User,
    payload: QaaRunCreateRequest,
) -> Operation:
    operation = Operation(
        user_id=current_user.id,
        type=OperationType.QAA_GENERATE,
        recipe=build_operation_recipe(payload).model_dump(mode="json"),
        status=OperationStatus.RUNNING,
        started_at=utcnow(),
    )
    db.add(operation)
    await db.commit()
    await db.refresh(operation)
    return operation


async def finalize_audit_operation(
    db: AsyncSession,
    operation: Operation,
    *,
    payload: QaaRunCreateRequest,
    run_id: str | None = None,
    status_value: OperationStatus | None = None,
    log: str | None = None,
) -> None:
    operation.recipe = build_operation_recipe(payload, run_id).model_dump(mode="json")
    if status_value is not None:
        operation.status = status_value
        operation.finished_at = utcnow()
    if log is not None:
        operation.log = log
    await db.commit()


async def reconcile_qaa_operation(
    db: AsyncSession,
    *,
    current_user: User,
    run_id: str,
    payload: Any,
) -> None:
    qaa_status = extract_qaa_run_status(payload)
    if qaa_status is None:
        return
    next_status = TERMINAL_QAA_TO_OPERATION_STATUS.get(qaa_status)
    if next_status is None:
        return

    operations = await db.scalars(
        select(Operation)
        .where(Operation.user_id == current_user.id, Operation.type == OperationType.QAA_GENERATE)
        .order_by(Operation.created_at.desc())
    )
    for operation in operations:
        flags = operation.recipe.get(QaaPayloadField.FLAGS.value, {})
        if isinstance(flags, dict) and flags.get(QaaPayloadField.RUN_ID.value) == run_id:
            operation.status = next_status
            operation.finished_at = utcnow()
            await db.commit()
            return


def build_list_params(
    *,
    jira_key: str | None,
    status_values: list[QaaRunStatus] | None,
    effective_actor: str | None,
    created_from: datetime | None,
    created_to: datetime | None,
    limit: int | None,
    cursor: str | None,
) -> list[tuple[str, str]]:
    params: list[tuple[str, str]] = []
    if jira_key:
        params.append((QaaListQueryParam.JIRA_KEY.value, jira_key))
    if status_values:
        params.extend((QaaListQueryParam.STATUS.value, item.value) for item in status_values)
    if effective_actor:
        params.append((QaaListQueryParam.EFFECTIVE_ACTOR.value, effective_actor))
    if created_from is not None:
        params.append((QaaListQueryParam.CREATED_FROM.value, created_from.isoformat()))
    if created_to is not None:
        params.append((QaaListQueryParam.CREATED_TO.value, created_to.isoformat()))
    if limit is not None:
        params.append((QaaListQueryParam.LIMIT.value, str(limit)))
    if cursor:
        params.append((QaaListQueryParam.CURSOR.value, cursor))
    return params


@router.post(ROOT_ROUTE_PATH)
async def create_qaa_run(
    payload: QaaRunCreateRequest,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    idempotency_key: Annotated[str | None, Header(alias=HttpHeader.IDEMPOTENCY_KEY.value)] = None,
) -> Response:
    client = get_qaa_client(request)
    settings = get_settings(request)
    operation = await create_audit_operation(db, current_user, payload)
    headers = build_outbound_headers(
        settings,
        current_user,
        accept=MediaType.JSON,
        content_type=MediaType.JSON,
        idempotency_key=idempotency_key,
    )

    try:
        result = await request_json(
            client,
            method=HttpMethod.POST.value,
            path=QaaGeneratorServicePath.RUNS.value,
            headers=headers,
            json_body=payload.model_dump(mode="json"),
            passthrough_status_codes=PASSTHROUGH_STATUS_CODES,
        )
    except HTTPException as exc:
        await finalize_audit_operation(
            db,
            operation,
            payload=payload,
            status_value=OperationStatus.FAILED,
            log=str(exc.detail),
        )
        raise

    run_id = extract_run_id(result.payload)
    if result.status_code == status.HTTP_409_CONFLICT:
        await finalize_audit_operation(
            db,
            operation,
            payload=payload,
            run_id=run_id,
            status_value=OperationStatus.FAILED,
        )
        return build_proxy_response(result)

    await finalize_audit_operation(db, operation, payload=payload, run_id=run_id)
    return build_proxy_response(result)


@router.get(ROOT_ROUTE_PATH)
async def list_qaa_runs(
    request: Request,
    current_user: CurrentUser,
    jira_key: str | None = None,
    status_: Annotated[
        list[QaaRunStatus] | None,
        Query(alias=QaaListQueryParam.STATUS.value),
    ] = None,
    effective_actor: str | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    limit: int | None = None,
    cursor: str | None = None,
) -> Response:
    client = get_qaa_client(request)
    settings = get_settings(request)
    headers = build_outbound_headers(settings, current_user, accept=MediaType.JSON)
    result = await request_json(
        client,
        method=HttpMethod.GET.value,
        path=QaaGeneratorServicePath.RUNS.value,
        headers=headers,
        params=build_list_params(
            jira_key=jira_key,
            status_values=status_,
            effective_actor=effective_actor,
            created_from=created_from,
            created_to=created_to,
            limit=limit,
            cursor=cursor,
        ),
    )
    return build_proxy_response(result)


@router.get(RoutePath.QAA_RUN_BY_ID.value)
async def get_qaa_run(
    run_id: str,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    client = get_qaa_client(request)
    settings = get_settings(request)
    headers = build_outbound_headers(settings, current_user, accept=MediaType.JSON)
    result = await request_json(
        client,
        method=HttpMethod.GET.value,
        path=build_qaa_run_path(run_id),
        headers=headers,
    )
    await reconcile_qaa_operation(
        db,
        current_user=current_user,
        run_id=run_id,
        payload=result.payload,
    )
    return build_proxy_response(result)


@router.get(f"{RoutePath.QAA_RUN_BY_ID.value}{RoutePath.ARTIFACTS.value}")
async def get_qaa_run_artifacts(
    run_id: str,
    request: Request,
    current_user: CurrentUser,
) -> Response:
    client = get_qaa_client(request)
    settings = get_settings(request)
    headers = build_outbound_headers(settings, current_user, accept=MediaType.JSON)
    result = await request_json(
        client,
        method=HttpMethod.GET.value,
        path=build_qaa_run_artifacts_path(run_id, RoutePath.ARTIFACTS.value),
        headers=headers,
    )
    return build_proxy_response(result)


async def handle_qaa_run_action(
    *,
    run_id: str,
    request: Request,
    current_user: User,
    suffix: RoutePath,
) -> Response:
    client = get_qaa_client(request)
    settings = get_settings(request)
    headers = build_outbound_headers(
        settings,
        current_user,
        accept=MediaType.JSON,
        content_type=MediaType.JSON,
    )
    result = await request_json(
        client,
        method=HttpMethod.POST.value,
        path=build_qaa_run_artifacts_path(run_id, suffix.value),
        headers=headers,
        passthrough_status_codes=PASSTHROUGH_STATUS_CODES,
    )
    return build_proxy_response(result)


@router.post(f"{RoutePath.QAA_RUN_BY_ID.value}{RoutePath.PAUSE.value}")
async def pause_qaa_run(
    run_id: str,
    request: Request,
    current_user: CurrentUser,
) -> Response:
    return await handle_qaa_run_action(
        run_id=run_id,
        request=request,
        current_user=current_user,
        suffix=RoutePath.PAUSE,
    )


@router.post(f"{RoutePath.QAA_RUN_BY_ID.value}{RoutePath.RESUME.value}")
async def resume_qaa_run(
    run_id: str,
    request: Request,
    current_user: CurrentUser,
) -> Response:
    return await handle_qaa_run_action(
        run_id=run_id,
        request=request,
        current_user=current_user,
        suffix=RoutePath.RESUME,
    )


@router.post(f"{RoutePath.QAA_RUN_BY_ID.value}{RoutePath.STOP.value}")
async def stop_qaa_run(
    run_id: str,
    request: Request,
    current_user: CurrentUser,
) -> Response:
    return await handle_qaa_run_action(
        run_id=run_id,
        request=request,
        current_user=current_user,
        suffix=RoutePath.STOP,
    )


@router.get(f"{RoutePath.QAA_RUN_BY_ID.value}{RoutePath.EVENTS_STREAM.value}")
async def stream_qaa_run_events(
    run_id: str,
    request: Request,
    current_user: CurrentUser,
    last_event_id: Annotated[str | None, Header(alias=HttpHeader.LAST_EVENT_ID.value)] = None,
) -> StreamingResponse:
    client = get_qaa_client(request)
    settings = get_settings(request)
    headers = build_outbound_headers(
        settings,
        current_user,
        accept=MediaType.TEXT_EVENT_STREAM,
        last_event_id=last_event_id,
    )
    upstream_response = await open_event_stream(
        client,
        path=build_qaa_run_artifacts_path(run_id, RoutePath.EVENTS_STREAM.value),
        headers=headers,
    )

    async def iterate_stream() -> AsyncIterator[bytes]:
        try:
            async for chunk in upstream_response.aiter_bytes():
                if await request.is_disconnected():
                    break
                if chunk:
                    yield chunk
        finally:
            await upstream_response.aclose()

    return StreamingResponse(iterate_stream(), media_type=MediaType.TEXT_EVENT_STREAM.value)
