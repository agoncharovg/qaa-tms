"""Operation audit routes."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.api.deps import CurrentUser, get_db
from app.core.constants import (
    DEFAULT_OFFSET,
    OPERATIONS_DEFAULT_LIMIT,
    OPERATIONS_MAX_LIMIT,
    OPERATIONS_MIN_LIMIT,
    ApiTag,
    ErrorMessage,
    OperationStatus,
    OperationType,
    RoutePath,
)
from app.models.operation import Operation
from app.models.user import User
from app.schemas.operation import (
    OperationListResponse,
    OperationRead,
    OperationReplayResponse,
    OperationSummary,
    OperationUpsertRequest,
)

router = APIRouter(prefix=RoutePath.OPERATIONS.value, tags=[ApiTag.OPERATIONS.value])


def utcnow() -> datetime:
    return datetime.now(UTC)


def to_operation_summary(operation: Operation) -> OperationSummary:
    return OperationSummary.model_validate(operation)


def to_operation_read(operation: Operation) -> OperationRead:
    return OperationRead.model_validate(operation)


async def get_visible_operation(
    db: AsyncSession,
    current_user: User,
    operation_id: UUID,
) -> Operation:
    operation = await db.get(Operation, operation_id)
    if operation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessage.OPERATION_NOT_FOUND.value,
        )
    if not current_user.is_admin and operation.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessage.OPERATION_NOT_FOUND.value,
        )
    return operation


@router.post("", response_model=OperationRead)
async def upsert_operation(
    payload: OperationUpsertRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> OperationRead:
    operation: Operation | None = None
    if payload.id is not None:
        operation = await db.get(Operation, payload.id)
        if operation is not None and operation.user_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=ErrorMessage.OPERATION_NOT_FOUND.value,
            )

    if operation is None:
        operation = Operation(
            id=payload.id or uuid4(),
            user_id=current_user.id,
            type=payload.type,
            ns=payload.ns,
            recipe=payload.recipe.model_dump(mode="json"),
            status=payload.status,
            started_at=payload.started_at or utcnow(),
            finished_at=payload.finished_at,
            log=payload.log,
            exit_code=payload.exit_code,
            agent_host=payload.agent_host,
            agent_version=payload.agent_version,
            stagings_sha=payload.stagings_sha,
        )
        db.add(operation)
    else:
        provided_fields = payload.model_fields_set
        operation.type = payload.type
        operation.recipe = payload.recipe.model_dump(mode="json")
        if "ns" in provided_fields:
            operation.ns = payload.ns
        if "status" in provided_fields:
            operation.status = payload.status
        if "started_at" in provided_fields:
            operation.started_at = payload.started_at or operation.started_at
        if "finished_at" in provided_fields:
            operation.finished_at = payload.finished_at
        if "log" in provided_fields:
            operation.log = payload.log
        if "exit_code" in provided_fields:
            operation.exit_code = payload.exit_code
        if "agent_host" in provided_fields:
            operation.agent_host = payload.agent_host
        if "agent_version" in provided_fields:
            operation.agent_version = payload.agent_version
        if "stagings_sha" in provided_fields:
            operation.stagings_sha = payload.stagings_sha

    await db.commit()
    await db.refresh(operation)
    return to_operation_read(operation)


@router.get("", response_model=OperationListResponse)
async def list_operations(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    user_id: int | None = None,
    ns: str | None = None,
    type_: Annotated[OperationType | None, Query(alias="type")] = None,
    status_: Annotated[OperationStatus | None, Query(alias="status")] = None,
    limit: Annotated[int, Query(ge=OPERATIONS_MIN_LIMIT, le=OPERATIONS_MAX_LIMIT)] = (
        OPERATIONS_DEFAULT_LIMIT
    ),
    offset: Annotated[int, Query(ge=DEFAULT_OFFSET)] = DEFAULT_OFFSET,
) -> OperationListResponse:
    filters: list[ColumnElement[bool]] = []
    if current_user.is_admin:
        if user_id is not None:
            filters.append(Operation.user_id == user_id)
    else:
        filters.append(Operation.user_id == current_user.id)

    if ns is not None:
        filters.append(Operation.ns == ns)
    if type_ is not None:
        filters.append(Operation.type == type_)
    if status_ is not None:
        filters.append(Operation.status == status_)

    base_query = select(Operation).where(*filters)
    total = await db.scalar(select(func.count()).select_from(base_query.subquery()))
    operations = await db.scalars(
        base_query.order_by(Operation.created_at.desc()).limit(limit).offset(offset)
    )
    items = [to_operation_summary(operation) for operation in operations]

    return OperationListResponse(items=items, total=total or 0, limit=limit, offset=offset)


@router.get("/{operation_id}", response_model=OperationRead)
async def get_operation(
    operation_id: UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> OperationRead:
    operation = await get_visible_operation(db, current_user, operation_id)
    return to_operation_read(operation)


@router.get(f"/{{operation_id}}{RoutePath.REPLAY.value}", response_model=OperationReplayResponse)
async def get_operation_replay(
    operation_id: UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> OperationReplayResponse:
    operation = await get_visible_operation(db, current_user, operation_id)
    return OperationReplayResponse(
        id=operation.id,
        type=operation.type,
        ns=operation.ns,
        recipe=operation.recipe,
    )
