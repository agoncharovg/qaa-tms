"""Shared Jenkins cache routes."""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Query

from app.api.deps import CurrentUser, get_jenkins_cache, get_settings
from app.core.config import Settings
from app.core.constants import (
    JENKINS_FOLDER_CACHE_MAX_TTL_SECONDS,
    JENKINS_FOLDER_CACHE_MIN_TTL_SECONDS,
    ApiTag,
    QueryParam,
    RoutePath,
)
from app.schemas.jenkins import (
    JenkinsBuildsCachePut,
    JenkinsBuildsCacheRead,
    JenkinsFolderCachePut,
    JenkinsFolderCacheRead,
    JenkinsScopeRead,
    JenkinsTreeCachePut,
    JenkinsTreeCacheRead,
)
from app.services.jenkins_cache import JenkinsCache
from app.services.jenkins_client import (
    JenkinsError,
    JenkinsPathOutOfScopeError,
    fetch_builds,
    fetch_folder,
    fetch_tree,
    jenkins_scope_signature,
)

router = APIRouter(prefix=RoutePath.JENKINS.value, tags=[ApiTag.JENKINS.value])
JenkinsCacheDep = Annotated[JenkinsCache, Depends(get_jenkins_cache)]
SettingsDep = Annotated[Settings, Depends(get_settings)]

logger = logging.getLogger(__name__)


@router.get(RoutePath.SCOPE.value, response_model=JenkinsScopeRead)
async def get_jenkins_scope(
    _: CurrentUser,
    settings: SettingsDep,
) -> JenkinsScopeRead:
    return JenkinsScopeRead(
        signature=jenkins_scope_signature(settings),
        root_groups=list(settings.jenkins_root_groups),
        root_folders=list(settings.jenkins_root_folders),
        tree_depth=settings.jenkins_tree_depth,
        history_limit=settings.jenkins_history_limit,
    )


@router.get(RoutePath.TREE.value, response_model=JenkinsTreeCacheRead)
async def get_jenkins_tree_cache(
    _: CurrentUser,
    background_tasks: BackgroundTasks,
    cache: JenkinsCacheDep,
    settings: SettingsDep,
    signature: Annotated[str, Query(alias=QueryParam.SIGNATURE.value)],
) -> JenkinsTreeCacheRead:
    roots, fetched_at, stale, refresh_lease = await cache.read_tree(signature)
    _schedule_tree_fill(background_tasks, cache, settings, signature, refresh_lease)
    return JenkinsTreeCacheRead(
        roots=roots,
        signature=signature,
        fetched_at=fetched_at,
        stale=stale,
        refresh_lease=refresh_lease,
    )


@router.put(RoutePath.TREE.value, response_model=JenkinsTreeCacheRead)
async def put_jenkins_tree_cache(
    payload: JenkinsTreeCachePut,
    _: CurrentUser,
    cache: JenkinsCacheDep,
) -> JenkinsTreeCacheRead:
    roots, fetched_at = await cache.write_tree(
        payload.signature, payload.roots, payload.refresh_lease
    )
    return JenkinsTreeCacheRead(
        roots=roots,
        signature=payload.signature,
        fetched_at=fetched_at,
        stale=False,
        refresh_lease=None,
    )


@router.get(RoutePath.BUILDS.value, response_model=JenkinsBuildsCacheRead)
async def get_jenkins_builds_cache(
    _: CurrentUser,
    background_tasks: BackgroundTasks,
    cache: JenkinsCacheDep,
    settings: SettingsDep,
    signature: Annotated[str, Query(alias=QueryParam.SIGNATURE.value)],
    path: Annotated[str, Query(alias=QueryParam.PATH.value)],
) -> JenkinsBuildsCacheRead:
    builds, fetched_at, stale, refresh_lease = await cache.read_builds(signature, path)
    _schedule_builds_fill(background_tasks, cache, settings, signature, path, refresh_lease)
    return JenkinsBuildsCacheRead(
        builds=builds,
        signature=signature,
        path=path,
        fetched_at=fetched_at,
        stale=stale,
        refresh_lease=refresh_lease,
    )


@router.put(RoutePath.BUILDS.value, response_model=JenkinsBuildsCacheRead)
async def put_jenkins_builds_cache(
    payload: JenkinsBuildsCachePut,
    _: CurrentUser,
    cache: JenkinsCacheDep,
) -> JenkinsBuildsCacheRead:
    builds, fetched_at = await cache.write_builds(
        payload.signature,
        payload.path,
        payload.builds,
        payload.refresh_lease,
    )
    return JenkinsBuildsCacheRead(
        builds=builds,
        signature=payload.signature,
        path=payload.path,
        fetched_at=fetched_at,
        stale=False,
        refresh_lease=None,
    )


def _clamp_folder_ttl(ttl_seconds: int) -> int:
    return max(
        JENKINS_FOLDER_CACHE_MIN_TTL_SECONDS,
        min(JENKINS_FOLDER_CACHE_MAX_TTL_SECONDS, ttl_seconds),
    )


@router.get(RoutePath.FOLDER.value, response_model=JenkinsFolderCacheRead)
async def get_jenkins_folder_cache(
    _: CurrentUser,
    background_tasks: BackgroundTasks,
    cache: JenkinsCacheDep,
    settings: SettingsDep,
    signature: Annotated[str, Query(alias=QueryParam.SIGNATURE.value)],
    path: Annotated[str, Query(alias=QueryParam.PATH.value)],
    ttl_seconds: Annotated[int, Query(alias=QueryParam.TTL_SECONDS.value)],
) -> JenkinsFolderCacheRead:
    roots, fetched_at, stale, refresh_lease = await cache.read_folder(
        signature, path, _clamp_folder_ttl(ttl_seconds)
    )
    _schedule_folder_fill(background_tasks, cache, settings, signature, path, refresh_lease)
    return JenkinsFolderCacheRead(
        roots=roots,
        signature=signature,
        path=path,
        fetched_at=fetched_at,
        stale=stale,
        refresh_lease=refresh_lease,
    )


@router.put(RoutePath.FOLDER.value, response_model=JenkinsFolderCacheRead)
async def put_jenkins_folder_cache(
    payload: JenkinsFolderCachePut,
    _: CurrentUser,
    cache: JenkinsCacheDep,
) -> JenkinsFolderCacheRead:
    roots, fetched_at = await cache.write_folder(
        payload.signature,
        payload.path,
        payload.roots,
        payload.refresh_lease,
    )
    return JenkinsFolderCacheRead(
        roots=roots,
        signature=payload.signature,
        path=payload.path,
        fetched_at=fetched_at,
        stale=False,
        refresh_lease=None,
    )


def _scope_matches_backend(settings: Settings, signature: str) -> bool:
    return settings.jenkins_common_configured and signature == jenkins_scope_signature(settings)


def _schedule_tree_fill(
    background_tasks: BackgroundTasks,
    cache: JenkinsCache,
    settings: Settings,
    signature: str,
    refresh_lease: str | None,
) -> None:
    if refresh_lease is None or not _scope_matches_backend(settings, signature):
        return
    background_tasks.add_task(_fill_tree_cache, cache, settings, signature, refresh_lease)


def _schedule_builds_fill(
    background_tasks: BackgroundTasks,
    cache: JenkinsCache,
    settings: Settings,
    signature: str,
    path: str,
    refresh_lease: str | None,
) -> None:
    if refresh_lease is None or not _scope_matches_backend(settings, signature):
        return
    background_tasks.add_task(
        _fill_builds_cache,
        cache,
        settings,
        signature,
        path,
        refresh_lease,
    )


def _schedule_folder_fill(
    background_tasks: BackgroundTasks,
    cache: JenkinsCache,
    settings: Settings,
    signature: str,
    path: str,
    refresh_lease: str | None,
) -> None:
    if refresh_lease is None or not _scope_matches_backend(settings, signature):
        return
    background_tasks.add_task(
        _fill_folder_cache,
        cache,
        settings,
        signature,
        path,
        refresh_lease,
    )


async def _fill_tree_cache(
    cache: JenkinsCache,
    settings: Settings,
    signature: str,
    refresh_lease: str,
) -> None:
    try:
        roots = await fetch_tree(settings)
        await cache.write_tree(signature, roots, refresh_lease)
    except JenkinsError as exc:
        logger.warning("Jenkins common tree fill failed: %s", exc)


async def _fill_builds_cache(
    cache: JenkinsCache,
    settings: Settings,
    signature: str,
    path: str,
    refresh_lease: str,
) -> None:
    try:
        builds = await fetch_builds(settings, path)
        await cache.write_builds(signature, path, builds, refresh_lease)
    except (JenkinsError, JenkinsPathOutOfScopeError) as exc:
        logger.warning("Jenkins common builds fill failed: path=%s error=%s", path, exc)


async def _fill_folder_cache(
    cache: JenkinsCache,
    settings: Settings,
    signature: str,
    path: str,
    refresh_lease: str,
) -> None:
    try:
        roots = await fetch_folder(settings, path)
        await cache.write_folder(signature, path, roots, refresh_lease)
    except (JenkinsError, JenkinsPathOutOfScopeError) as exc:
        logger.warning("Jenkins common folder fill failed: path=%s error=%s", path, exc)
