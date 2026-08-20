"""Shared Jenkins cache routes."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.deps import CurrentUser, get_jenkins_cache
from app.core.constants import (
    JENKINS_FOLDER_CACHE_MAX_TTL_SECONDS,
    JENKINS_FOLDER_CACHE_MIN_TTL_SECONDS,
    ApiTag,
    RoutePath,
)
from app.schemas.jenkins import (
    JenkinsBuildsCachePut,
    JenkinsBuildsCacheRead,
    JenkinsFolderCachePut,
    JenkinsFolderCacheRead,
    JenkinsTreeCachePut,
    JenkinsTreeCacheRead,
)
from app.services.jenkins_cache import JenkinsCache

router = APIRouter(prefix=RoutePath.JENKINS.value, tags=[ApiTag.JENKINS.value])
JenkinsCacheDep = Annotated[JenkinsCache, Depends(get_jenkins_cache)]


@router.get(RoutePath.TREE.value, response_model=JenkinsTreeCacheRead)
async def get_jenkins_tree_cache(
    _: CurrentUser,
    cache: JenkinsCacheDep,
    signature: Annotated[str, Query(...)],
) -> JenkinsTreeCacheRead:
    roots, fetched_at, stale, refresh_lease = await cache.read_tree(signature)
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
    cache: JenkinsCacheDep,
    signature: Annotated[str, Query(...)],
    path: Annotated[str, Query(...)],
) -> JenkinsBuildsCacheRead:
    builds, fetched_at, stale, refresh_lease = await cache.read_builds(signature, path)
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
    cache: JenkinsCacheDep,
    signature: Annotated[str, Query(...)],
    path: Annotated[str, Query(...)],
    ttl_seconds: Annotated[int, Query(...)],
) -> JenkinsFolderCacheRead:
    roots, fetched_at, stale, refresh_lease = await cache.read_folder(
        signature, path, _clamp_folder_ttl(ttl_seconds)
    )
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
