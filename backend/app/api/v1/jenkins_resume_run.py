"""Durable Jenkins resume campaign routes."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, get_db
from app.core.constants import (
    JENKINS_RESUME_RUN_STALE_SECONDS,
    ApiTag,
    JenkinsFreezeStatus,
    JenkinsResumeItemState,
    JenkinsResumeRunStatus,
    RoutePath,
)
from app.models.jenkins_freeze import JenkinsFreeze
from app.models.jenkins_resume_run import JenkinsResumeRun
from app.schemas.jenkins_freeze import JenkinsFreezeSnapshotItem
from app.schemas.jenkins_resume_run import (
    JenkinsResumeItem,
    JenkinsResumeProgressPut,
    JenkinsResumeRunCreate,
    JenkinsResumeRunRead,
)

router = APIRouter(
    prefix=RoutePath.JENKINS.value,
    tags=[ApiTag.JENKINS.value],
)


class ResumeRunErrorMessage(StrEnum):
    CANCEL_CONFLICT = "Only running resume campaigns can be cancelled."
    FREEZE_INACTIVE = "Only active freezes can be resumed."
    FREEZE_NOT_FOUND = "Jenkins freeze not found."
    LOCK_CONFLICT = "Another Jenkins resume campaign is already running for this scope."
    PLAN_ITEM_NOT_FOUND = "Resume progress path is not part of this campaign."
    RUN_NOT_FOUND = "Jenkins resume campaign not found."


def utcnow() -> datetime:
    return datetime.now(UTC)


def ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def is_stale(run: JenkinsResumeRun, now: datetime | None = None) -> bool:
    reference = ensure_utc(now or utcnow())
    heartbeat_at = ensure_utc(run.heartbeat_at)
    return run.status is JenkinsResumeRunStatus.RUNNING and (
        reference - heartbeat_at > timedelta(seconds=JENKINS_RESUME_RUN_STALE_SECONDS)
    )


def to_resume_run_read(
    run: JenkinsResumeRun,
    *,
    now: datetime | None = None,
) -> JenkinsResumeRunRead:
    items = [JenkinsResumeItem.model_validate(item) for item in run.items]
    return JenkinsResumeRunRead(
        id=run.id,
        freeze_id=run.freeze_id,
        signature=run.signature,
        status=run.status,
        total=run.total,
        started_count=run.started_count,
        skipped_count=run.skipped_count,
        error_count=run.error_count,
        current_path=run.current_path,
        current_name=run.current_name,
        items=items,
        created_by=run.created_by.username,
        created_at=run.created_at,
        cancelled_by=run.cancelled_by.username if run.cancelled_by is not None else None,
        finished_at=run.finished_at,
        stale=is_stale(run, now),
    )


async def get_run_or_404(db: AsyncSession, run_id: UUID) -> JenkinsResumeRun:
    run = await db.scalar(
        select(JenkinsResumeRun)
        .options(
            selectinload(JenkinsResumeRun.created_by),
            selectinload(JenkinsResumeRun.cancelled_by),
        )
        .where(JenkinsResumeRun.id == run_id)
    )
    if run is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ResumeRunErrorMessage.RUN_NOT_FOUND.value,
        )
    return run


async def get_freeze_or_404(db: AsyncSession, freeze_id: UUID) -> JenkinsFreeze:
    freeze = await db.scalar(select(JenkinsFreeze).where(JenkinsFreeze.id == freeze_id))
    if freeze is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ResumeRunErrorMessage.FREEZE_NOT_FOUND.value,
        )
    return freeze


def build_resume_item(snapshot_item: JenkinsFreezeSnapshotItem) -> JenkinsResumeItem:
    if snapshot_item.was_disabled:
        return JenkinsResumeItem(
            path=snapshot_item.path,
            name=snapshot_item.name,
            full_name=snapshot_item.full_name,
            scheduled=snapshot_item.scheduled,
            state=JenkinsResumeItemState.SKIPPED,
            reason="Disabled before the freeze",
        )
    return JenkinsResumeItem(
        path=snapshot_item.path,
        name=snapshot_item.name,
        full_name=snapshot_item.full_name,
        scheduled=snapshot_item.scheduled,
        state=JenkinsResumeItemState.PENDING,
        reason=None,
    )


def recalculate_counts(items: list[JenkinsResumeItem]) -> tuple[int, int, int]:
    started_count = sum(item.state is JenkinsResumeItemState.STARTED for item in items)
    skipped_count = sum(item.state is JenkinsResumeItemState.SKIPPED for item in items)
    error_count = sum(item.state is JenkinsResumeItemState.ERROR for item in items)
    return started_count, skipped_count, error_count


def first_pending_item(items: list[JenkinsResumeItem]) -> JenkinsResumeItem | None:
    return next((item for item in items if item.state is JenkinsResumeItemState.PENDING), None)


@router.post(RoutePath.RESUME_RUNS.value, response_model=JenkinsResumeRunRead)
async def create_jenkins_resume_run(
    payload: JenkinsResumeRunCreate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> JenkinsResumeRunRead:
    freeze = await get_freeze_or_404(db, payload.freeze_id)
    if freeze.status is not JenkinsFreezeStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=ResumeRunErrorMessage.FREEZE_INACTIVE.value,
        )

    now = utcnow()
    running_runs = list(
        await db.scalars(
            select(JenkinsResumeRun).where(
                JenkinsResumeRun.signature == freeze.signature,
                JenkinsResumeRun.status == JenkinsResumeRunStatus.RUNNING,
            )
        )
    )
    fresh_runs = [run for run in running_runs if not is_stale(run, now)]
    if fresh_runs:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=ResumeRunErrorMessage.LOCK_CONFLICT.value,
        )
    for run in running_runs:
        if is_stale(run, now):
            run.status = JenkinsResumeRunStatus.FAILED
            run.finished_at = now
            run.current_path = None
            run.current_name = None

    snapshot_items = [JenkinsFreezeSnapshotItem.model_validate(item) for item in freeze.snapshot]
    plan_items = [build_resume_item(item) for item in snapshot_items]
    total = sum(item.state is JenkinsResumeItemState.PENDING for item in plan_items)
    started_count, skipped_count, error_count = recalculate_counts(plan_items)
    current_item = first_pending_item(plan_items)
    run_status = JenkinsResumeRunStatus.DONE if total == 0 else JenkinsResumeRunStatus.RUNNING
    run = JenkinsResumeRun(
        freeze_id=freeze.id,
        signature=freeze.signature,
        status=run_status,
        total=total,
        started_count=started_count,
        skipped_count=skipped_count,
        error_count=error_count,
        current_path=current_item.path if current_item is not None else None,
        current_name=current_item.name if current_item is not None else None,
        items=[item.model_dump(mode="json", by_alias=True) for item in plan_items],
        created_by_id=current_user.id,
        heartbeat_at=now,
        finished_at=now if run_status is JenkinsResumeRunStatus.DONE else None,
    )
    if run_status is JenkinsResumeRunStatus.DONE:
        freeze.status = JenkinsFreezeStatus.RESOLVED
        freeze.resolved_by_id = current_user.id
        freeze.resolved_by = current_user
        freeze.resolved_at = now

    db.add(run)
    await db.commit()
    created_run = await get_run_or_404(db, run.id)
    return to_resume_run_read(created_run, now=now)


@router.get(RoutePath.RESUME_RUNS.value, response_model=list[JenkinsResumeRunRead])
async def list_jenkins_resume_runs(
    _: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    signature: Annotated[str, Query(...)],
    status_: Annotated[JenkinsResumeRunStatus | None, Query(alias="status")] = (
        JenkinsResumeRunStatus.RUNNING
    ),
) -> list[JenkinsResumeRunRead]:
    query = (
        select(JenkinsResumeRun)
        .options(
            selectinload(JenkinsResumeRun.created_by),
            selectinload(JenkinsResumeRun.cancelled_by),
        )
        .where(JenkinsResumeRun.signature == signature)
        .order_by(JenkinsResumeRun.created_at.desc())
    )
    if status_ is not None:
        query = query.where(JenkinsResumeRun.status == status_)
    runs = list(await db.scalars(query))
    now = utcnow()
    return [to_resume_run_read(run, now=now) for run in runs]


@router.get(RoutePath.RESUME_RUN_BY_ID.value, response_model=JenkinsResumeRunRead)
async def get_jenkins_resume_run(
    run_id: UUID,
    _: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> JenkinsResumeRunRead:
    run = await get_run_or_404(db, run_id)
    return to_resume_run_read(run)


@router.put(RoutePath.RESUME_RUN_PROGRESS.value, response_model=JenkinsResumeRunRead)
async def put_jenkins_resume_progress(
    run_id: UUID,
    payload: JenkinsResumeProgressPut,
    _: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> JenkinsResumeRunRead:
    run = await get_run_or_404(db, run_id)
    if run.status is not JenkinsResumeRunStatus.RUNNING:
        return to_resume_run_read(run)

    items = [JenkinsResumeItem.model_validate(item) for item in run.items]
    target_item = next((item for item in items if item.path == payload.path), None)
    if target_item is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ResumeRunErrorMessage.PLAN_ITEM_NOT_FOUND.value,
        )

    target_item.state = payload.state
    target_item.reason = payload.reason
    run.items = [item.model_dump(mode="json", by_alias=True) for item in items]
    run.started_count, run.skipped_count, run.error_count = recalculate_counts(items)
    run.current_path = payload.next_path
    run.current_name = payload.next_name
    run.heartbeat_at = utcnow()
    if run.current_path is None or run.current_name is None:
        run.current_path = None
        run.current_name = None

    if run.started_count + run.error_count >= run.total:
        now = utcnow()
        run.status = JenkinsResumeRunStatus.DONE
        run.finished_at = now
        run.current_path = None
        run.current_name = None
        # Only resolve the freeze on a clean run. If any pipeline errored, keep the
        # freeze active so its snapshot survives for a retry campaign (mirrors the
        # partial-resume promise in JenkinsFreezeCopy.RESUME_PARTIAL_MESSAGE).
        if run.error_count == 0:
            freeze = await get_freeze_or_404(db, run.freeze_id)
            if freeze.status is JenkinsFreezeStatus.ACTIVE:
                freeze.status = JenkinsFreezeStatus.RESOLVED
                freeze.resolved_by_id = run.created_by_id
                freeze.resolved_at = now

    await db.commit()
    updated_run = await get_run_or_404(db, run.id)
    return to_resume_run_read(updated_run)


@router.post(RoutePath.RESUME_RUN_CANCEL.value, response_model=JenkinsResumeRunRead)
async def cancel_jenkins_resume_run(
    run_id: UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> JenkinsResumeRunRead:
    run = await get_run_or_404(db, run_id)
    if run.status is not JenkinsResumeRunStatus.RUNNING:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=ResumeRunErrorMessage.CANCEL_CONFLICT.value,
        )
    now = utcnow()
    run.status = JenkinsResumeRunStatus.CANCELLED
    run.cancelled_by_id = current_user.id
    run.cancelled_by = current_user
    run.finished_at = now
    run.current_path = None
    run.current_name = None
    run.heartbeat_at = now
    await db.commit()
    cancelled_run = await get_run_or_404(db, run.id)
    return to_resume_run_read(cancelled_run, now=now)
