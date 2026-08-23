"""Durable Jenkins freeze routes."""

from __future__ import annotations

from datetime import timedelta
from enum import StrEnum
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, require_permission
from app.core.constants import (
    JENKINS_RESUME_RUN_STALE_SECONDS,
    ApiTag,
    JenkinsFreezeStatus,
    JenkinsResumeRunStatus,
    PermissionKey,
    QueryParam,
    RoutePath,
)
from app.core.jenkins_paths import normalize_jenkins_path
from app.core.time import utcnow
from app.models.jenkins_freeze import JenkinsFreeze
from app.models.jenkins_resume_run import JenkinsResumeRun
from app.models.user import User
from app.schemas.jenkins_freeze import (
    JenkinsFreezeCreate,
    JenkinsFreezeRead,
    JenkinsFreezeSnapshotItem,
    JenkinsFreezeSnapshotPut,
)

router = APIRouter(
    prefix=RoutePath.JENKINS.value,
    tags=[ApiTag.JENKINS.value],
)

JenkinsReadUser = Annotated[User, Depends(require_permission(PermissionKey.JENKINS_READ))]
JenkinsFreezeUser = Annotated[User, Depends(require_permission(PermissionKey.JENKINS_FREEZE))]


class FreezeErrorMessage(StrEnum):
    APPLIED_DELETE_CONFLICT = "Applied freezes must be resolved, not deleted."
    INACTIVE_SNAPSHOT_CONFLICT = "Only active freezes can accept a snapshot."
    NOT_FOUND = "Jenkins freeze not found."
    NOT_PENDING_DELETE_CONFLICT = "Only not-yet-applied freezes can be deleted."
    RESOLVE_CONFLICT = "Only active freezes can be resolved."
    RESUME_LOCK_CONFLICT = "Another Jenkins resume campaign is already running for this scope."


async def has_running_resume_lock(db: AsyncSession, signature: str) -> bool:
    cutoff = utcnow() - timedelta(seconds=JENKINS_RESUME_RUN_STALE_SECONDS)
    running_run = await db.scalar(
        select(JenkinsResumeRun.id).where(
            JenkinsResumeRun.signature == signature,
            JenkinsResumeRun.status == JenkinsResumeRunStatus.RUNNING,
            JenkinsResumeRun.heartbeat_at >= cutoff,
        )
    )
    return running_run is not None


def intersects_path(left: str, right: str) -> bool:
    normalized_left = normalize_jenkins_path(left)
    normalized_right = normalize_jenkins_path(right)
    return (
        normalized_left == normalized_right
        or normalized_left.startswith(f"{normalized_right}/")
        or normalized_right.startswith(f"{normalized_left}/")
    )


def can_absorb_freeze(owner_path: str, candidate_path: str) -> bool:
    normalized_owner = normalize_jenkins_path(owner_path)
    normalized_candidate = normalize_jenkins_path(candidate_path)
    return normalized_candidate == normalized_owner or normalized_candidate.startswith(
        f"{normalized_owner}/"
    )


def to_freeze_read(freeze: JenkinsFreeze) -> JenkinsFreezeRead:
    snapshot = [JenkinsFreezeSnapshotItem.model_validate(item) for item in freeze.snapshot]
    return JenkinsFreezeRead(
        id=freeze.id,
        folder_path=freeze.folder_path,
        folder_name=freeze.folder_name,
        signature=freeze.signature,
        reason=freeze.reason,
        kill_builds=freeze.kill_builds,
        status=freeze.status,
        applied=freeze.applied,
        snapshot=snapshot,
        created_by=freeze.created_by.username,
        created_at=freeze.created_at,
        resolved_by=freeze.resolved_by.username if freeze.resolved_by is not None else None,
        resolved_at=freeze.resolved_at,
        merged_into_id=freeze.merged_into_id,
    )


async def get_freeze_or_404(db: AsyncSession, freeze_id: UUID) -> JenkinsFreeze:
    freeze = await db.scalar(
        select(JenkinsFreeze)
        .options(
            selectinload(JenkinsFreeze.created_by),
            selectinload(JenkinsFreeze.resolved_by),
        )
        .where(JenkinsFreeze.id == freeze_id)
    )
    if freeze is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=FreezeErrorMessage.NOT_FOUND.value,
        )
    return freeze


@router.get(RoutePath.FREEZES.value, response_model=list[JenkinsFreezeRead])
async def list_jenkins_freezes(
    _: JenkinsReadUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    signature: Annotated[str, Query(...)],
    status_: Annotated[
        JenkinsFreezeStatus, Query(alias=QueryParam.STATUS.value)
    ] = JenkinsFreezeStatus.ACTIVE,
) -> list[JenkinsFreezeRead]:
    freezes = await db.scalars(
        select(JenkinsFreeze)
        .options(
            selectinload(JenkinsFreeze.created_by),
            selectinload(JenkinsFreeze.resolved_by),
        )
        .where(
            JenkinsFreeze.signature == signature,
            JenkinsFreeze.status == status_,
        )
        .order_by(JenkinsFreeze.created_at.desc())
    )
    return [to_freeze_read(freeze) for freeze in freezes]


@router.post(RoutePath.FREEZES.value, response_model=JenkinsFreezeRead)
async def create_jenkins_freeze(
    payload: JenkinsFreezeCreate,
    current_user: JenkinsFreezeUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> JenkinsFreezeRead:
    if await has_running_resume_lock(db, payload.signature):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=FreezeErrorMessage.RESUME_LOCK_CONFLICT.value,
        )
    freeze = JenkinsFreeze(
        folder_path=payload.folder_path,
        folder_name=payload.folder_name,
        signature=payload.signature,
        reason=payload.reason,
        kill_builds=payload.kill_builds,
        status=JenkinsFreezeStatus.ACTIVE,
        applied=False,
        snapshot=[],
        created_by_id=current_user.id,
    )
    db.add(freeze)
    await db.commit()
    created_freeze = await get_freeze_or_404(db, freeze.id)
    return to_freeze_read(created_freeze)


@router.put(RoutePath.FREEZE_SNAPSHOT.value, response_model=JenkinsFreezeRead)
async def put_jenkins_freeze_snapshot(
    freeze_id: UUID,
    payload: JenkinsFreezeSnapshotPut,
    current_user: JenkinsFreezeUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> JenkinsFreezeRead:
    freeze = await get_freeze_or_404(db, freeze_id)
    if await has_running_resume_lock(db, freeze.signature):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=FreezeErrorMessage.RESUME_LOCK_CONFLICT.value,
        )
    if freeze.status is not JenkinsFreezeStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=FreezeErrorMessage.INACTIVE_SNAPSHOT_CONFLICT.value,
        )

    snapshot_items = [item.model_copy(deep=True) for item in payload.snapshot]
    items_by_path = {normalize_jenkins_path(item.path): item for item in snapshot_items}
    merge_candidates: list[JenkinsFreeze] = []
    if payload.merge_freeze_ids:
        merge_candidates = list(
            await db.scalars(
                select(JenkinsFreeze).where(
                    JenkinsFreeze.id.in_(payload.merge_freeze_ids),
                    JenkinsFreeze.signature == freeze.signature,
                    JenkinsFreeze.status == JenkinsFreezeStatus.ACTIVE,
                    # Only merge freezes that already carry a snapshot; a reserved but
                    # not-yet-applied freeze has none and would be orphaned empty.
                    JenkinsFreeze.applied.is_(True),
                )
            )
        )

    now = utcnow()
    for candidate in merge_candidates:
        if candidate.id == freeze.id:
            continue
        if not intersects_path(freeze.folder_path, candidate.folder_path):
            continue
        if not can_absorb_freeze(freeze.folder_path, candidate.folder_path):
            continue
        for merged_item in candidate.snapshot:
            snapshot_item = JenkinsFreezeSnapshotItem.model_validate(merged_item)
            if snapshot_item.was_disabled:
                continue
            target_item = items_by_path.get(normalize_jenkins_path(snapshot_item.path))
            if target_item is None:
                continue
            target_item.was_disabled = False
        candidate.status = JenkinsFreezeStatus.MERGED
        candidate.merged_into_id = freeze.id
        candidate.resolved_by_id = current_user.id
        candidate.resolved_by = current_user
        candidate.resolved_at = now

    freeze.snapshot = [item.model_dump(mode="json", by_alias=True) for item in snapshot_items]
    freeze.applied = True
    await db.commit()
    updated_freeze = await get_freeze_or_404(db, freeze.id)
    return to_freeze_read(updated_freeze)


@router.delete(RoutePath.FREEZE_BY_ID.value, status_code=status.HTTP_204_NO_CONTENT)
async def delete_jenkins_freeze(
    freeze_id: UUID,
    _: JenkinsFreezeUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    freeze = await get_freeze_or_404(db, freeze_id)
    if freeze.applied:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=FreezeErrorMessage.NOT_PENDING_DELETE_CONFLICT.value,
        )
    await db.delete(freeze)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(RoutePath.FREEZE_RESOLVE.value, response_model=JenkinsFreezeRead)
async def resolve_jenkins_freeze(
    freeze_id: UUID,
    current_user: JenkinsFreezeUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> JenkinsFreezeRead:
    freeze = await get_freeze_or_404(db, freeze_id)
    if await has_running_resume_lock(db, freeze.signature):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=FreezeErrorMessage.RESUME_LOCK_CONFLICT.value,
        )
    if freeze.status is not JenkinsFreezeStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=FreezeErrorMessage.RESOLVE_CONFLICT.value,
        )
    freeze.status = JenkinsFreezeStatus.RESOLVED
    freeze.resolved_by_id = current_user.id
    freeze.resolved_by = current_user
    freeze.resolved_at = utcnow()
    await db.commit()
    resolved_freeze = await get_freeze_or_404(db, freeze.id)
    return to_freeze_read(resolved_freeze)
