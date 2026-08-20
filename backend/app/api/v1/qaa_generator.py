"""QAA generator proxy routes."""

from __future__ import annotations

import re
from collections.abc import AsyncIterator
from datetime import datetime
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
    HttpMethod,
    MediaType,
    OperationStatus,
    OperationType,
    QaaRunStatus,
    RoutePath,
)
from app.core.time import utcnow
from app.models.operation import Operation
from app.models.user import User
from app.schemas.operation import OperationRecipe
from app.schemas.qaa_generator import QaaRunCreateRequest
from app.services.qaa_generator import (
    PASSTHROUGH_STATUS_CODES,
    QaaGeneratorJsonResponse,
    QaaGeneratorServicePath,
    QaaGeneratorTokenMode,
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
    FINAL_REPORT_TEXT = "final_report_text"
    FLAGS = "flags"
    ID = "id"
    ITEMS = "items"
    JIRA_KEY = "jira_key"
    PR_URL = "pr_url"
    PROFILE = "profile"
    REPORT_TEXT = "report_text"
    RUN_ID = "run_id"
    SKIP_EXEC = "skip_exec"
    SKIP_PR = "skip_pr"
    STATUS = "status"


TERMINAL_QAA_TO_OPERATION_STATUS = {
    QaaRunStatus.COMPLETED: OperationStatus.SUCCESS,
    QaaRunStatus.FAILED: OperationStatus.FAILED,
    QaaRunStatus.STOPPED: OperationStatus.ABORTED,
}
QaaPersonalTokenHeader = Annotated[
    str | None,
    Header(alias=HttpHeader.X_QAA_GENERATOR_TOKEN.value),
]


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


PR_URL_PATTERN = re.compile(r"^PR URL:\s*(?P<url>\S+)\s*$", re.MULTILINE)


def build_proxy_response(
    result: QaaGeneratorJsonResponse,
    payload: Any | None = None,
) -> JSONResponse:
    return JSONResponse(
        content=result.payload if payload is None else payload,
        status_code=result.status_code,
    )


def normalize_qaa_run_payload(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload

    normalized = dict(payload)
    run_id = normalized.get(QaaPayloadField.RUN_ID.value)
    if not isinstance(run_id, str):
        upstream_id = normalized.get(QaaPayloadField.ID.value)
        if isinstance(upstream_id, str):
            normalized[QaaPayloadField.RUN_ID.value] = upstream_id
    normalized.pop(QaaPayloadField.ID.value, None)
    return normalized


def normalize_qaa_runs_list_payload(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload

    items = payload.get(QaaPayloadField.ITEMS.value)
    if not isinstance(items, list):
        return payload

    normalized = dict(payload)
    normalized[QaaPayloadField.ITEMS.value] = [normalize_qaa_run_payload(item) for item in items]
    return normalized


def extract_pr_url_from_report(report_text: str | None) -> str | None:
    if not report_text:
        return None

    match = PR_URL_PATTERN.search(report_text)
    if not match:
        return None
    return match.group("url")


def normalize_qaa_run_artifacts_payload(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload

    normalized = dict(payload)
    report_text = normalized.get(QaaPayloadField.REPORT_TEXT.value)
    if not isinstance(report_text, str):
        final_report_text = normalized.get(QaaPayloadField.FINAL_REPORT_TEXT.value)
        if isinstance(final_report_text, str):
            report_text = final_report_text
            normalized[QaaPayloadField.REPORT_TEXT.value] = final_report_text

    pr_url = normalized.get(QaaPayloadField.PR_URL.value)
    if not isinstance(pr_url, str):
        extracted_pr_url = extract_pr_url_from_report(
            report_text if isinstance(report_text, str) else None
        )
        if extracted_pr_url is not None:
            normalized[QaaPayloadField.PR_URL.value] = extracted_pr_url

    return normalized


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


def build_personal_headers(
    request: Request,
    *,
    personal_token: str | None,
    accept: MediaType,
    content_type: MediaType | None = None,
    idempotency_key: str | None = None,
    last_event_id: str | None = None,
) -> dict[str, str]:
    return build_outbound_headers(
        get_settings(request),
        accept=accept,
        token_mode=QaaGeneratorTokenMode.PERSONAL,
        personal_token=personal_token,
        content_type=content_type,
        idempotency_key=idempotency_key,
        last_event_id=last_event_id,
    )


@router.post(ROOT_ROUTE_PATH)
async def create_qaa_run(
    payload: QaaRunCreateRequest,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    qaa_generator_token: QaaPersonalTokenHeader = None,
    idempotency_key: Annotated[str | None, Header(alias=HttpHeader.IDEMPOTENCY_KEY.value)] = None,
) -> Response:
    client = get_qaa_client(request)
    headers = build_personal_headers(
        request,
        personal_token=qaa_generator_token,
        accept=MediaType.JSON,
        content_type=MediaType.JSON,
        idempotency_key=idempotency_key,
    )
    operation = await create_audit_operation(db, current_user, payload)

    try:
        result = await request_json(
            client,
            method=HttpMethod.POST.value,
            path=QaaGeneratorServicePath.RUNS.value,
            headers=headers,
            token_mode=QaaGeneratorTokenMode.PERSONAL,
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

    normalized_payload = normalize_qaa_run_payload(result.payload)
    run_id = extract_run_id(normalized_payload)
    if result.status_code == status.HTTP_409_CONFLICT:
        await finalize_audit_operation(
            db,
            operation,
            payload=payload,
            run_id=run_id,
            status_value=OperationStatus.FAILED,
        )
        return build_proxy_response(result, normalized_payload)

    await finalize_audit_operation(db, operation, payload=payload, run_id=run_id)
    return build_proxy_response(result, normalized_payload)


@router.get(ROOT_ROUTE_PATH)
async def list_qaa_runs(
    request: Request,
    current_user: CurrentUser,
    qaa_generator_token: QaaPersonalTokenHeader = None,
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
    del current_user
    client = get_qaa_client(request)
    result = await request_json(
        client,
        method=HttpMethod.GET.value,
        path=QaaGeneratorServicePath.RUNS.value,
        headers=build_personal_headers(
            request,
            personal_token=qaa_generator_token,
            accept=MediaType.JSON,
        ),
        token_mode=QaaGeneratorTokenMode.PERSONAL,
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
    return build_proxy_response(result, normalize_qaa_runs_list_payload(result.payload))


@router.get(RoutePath.QAA_RUN_BY_ID.value)
async def get_qaa_run(
    run_id: str,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    qaa_generator_token: QaaPersonalTokenHeader = None,
) -> Response:
    client = get_qaa_client(request)
    result = await request_json(
        client,
        method=HttpMethod.GET.value,
        path=build_qaa_run_path(run_id),
        headers=build_personal_headers(
            request,
            personal_token=qaa_generator_token,
            accept=MediaType.JSON,
        ),
        token_mode=QaaGeneratorTokenMode.PERSONAL,
    )
    normalized_payload = normalize_qaa_run_payload(result.payload)
    await reconcile_qaa_operation(
        db,
        current_user=current_user,
        run_id=run_id,
        payload=normalized_payload,
    )
    return build_proxy_response(result, normalized_payload)


@router.get(f"{RoutePath.QAA_RUN_BY_ID.value}{RoutePath.ARTIFACTS.value}")
async def get_qaa_run_artifacts(
    run_id: str,
    request: Request,
    current_user: CurrentUser,
    qaa_generator_token: QaaPersonalTokenHeader = None,
) -> Response:
    del current_user
    client = get_qaa_client(request)
    result = await request_json(
        client,
        method=HttpMethod.GET.value,
        path=build_qaa_run_artifacts_path(run_id, RoutePath.ARTIFACTS.value),
        headers=build_personal_headers(
            request,
            personal_token=qaa_generator_token,
            accept=MediaType.JSON,
        ),
        token_mode=QaaGeneratorTokenMode.PERSONAL,
    )
    return build_proxy_response(result, normalize_qaa_run_artifacts_payload(result.payload))


async def handle_qaa_run_action(
    *,
    run_id: str,
    request: Request,
    personal_token: str | None,
    suffix: RoutePath,
) -> Response:
    client = get_qaa_client(request)
    result = await request_json(
        client,
        method=HttpMethod.POST.value,
        path=build_qaa_run_artifacts_path(run_id, suffix.value),
        headers=build_personal_headers(
            request,
            personal_token=personal_token,
            accept=MediaType.JSON,
            content_type=MediaType.JSON,
        ),
        token_mode=QaaGeneratorTokenMode.PERSONAL,
        passthrough_status_codes=PASSTHROUGH_STATUS_CODES,
    )
    return build_proxy_response(result, normalize_qaa_run_payload(result.payload))


@router.post(f"{RoutePath.QAA_RUN_BY_ID.value}{RoutePath.PAUSE.value}")
async def pause_qaa_run(
    run_id: str,
    request: Request,
    current_user: CurrentUser,
    qaa_generator_token: QaaPersonalTokenHeader = None,
) -> Response:
    del current_user
    return await handle_qaa_run_action(
        run_id=run_id,
        request=request,
        personal_token=qaa_generator_token,
        suffix=RoutePath.PAUSE,
    )


@router.post(f"{RoutePath.QAA_RUN_BY_ID.value}{RoutePath.RESUME.value}")
async def resume_qaa_run(
    run_id: str,
    request: Request,
    current_user: CurrentUser,
    qaa_generator_token: QaaPersonalTokenHeader = None,
) -> Response:
    del current_user
    return await handle_qaa_run_action(
        run_id=run_id,
        request=request,
        personal_token=qaa_generator_token,
        suffix=RoutePath.RESUME,
    )


@router.post(f"{RoutePath.QAA_RUN_BY_ID.value}{RoutePath.STOP.value}")
async def stop_qaa_run(
    run_id: str,
    request: Request,
    current_user: CurrentUser,
    qaa_generator_token: QaaPersonalTokenHeader = None,
) -> Response:
    del current_user
    return await handle_qaa_run_action(
        run_id=run_id,
        request=request,
        personal_token=qaa_generator_token,
        suffix=RoutePath.STOP,
    )


@router.get(f"{RoutePath.QAA_RUN_BY_ID.value}{RoutePath.EVENTS_STREAM.value}")
async def stream_qaa_run_events(
    run_id: str,
    request: Request,
    current_user: CurrentUser,
    qaa_generator_token: QaaPersonalTokenHeader = None,
    last_event_id: Annotated[str | None, Header(alias=HttpHeader.LAST_EVENT_ID.value)] = None,
) -> StreamingResponse:
    del current_user
    client = get_qaa_client(request)
    upstream_response = await open_event_stream(
        client,
        path=build_qaa_run_artifacts_path(run_id, RoutePath.EVENTS_STREAM.value),
        headers=build_personal_headers(
            request,
            personal_token=qaa_generator_token,
            accept=MediaType.TEXT_EVENT_STREAM,
            last_event_id=last_event_id,
        ),
        token_mode=QaaGeneratorTokenMode.PERSONAL,
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
