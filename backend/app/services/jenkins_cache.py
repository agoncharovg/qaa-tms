"""In-memory Jenkins cache for a single backend instance.

This cache assumes one backend process for the current deployment size. A
shared multi-instance store such as Redis is intentionally out of scope here.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Hashable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, cast
from uuid import uuid4

from app.core.constants import (
    JENKINS_BUILDS_CACHE_TTL_SECONDS,
    JENKINS_FOLDER_HISTORY_RETENTION_MS,
    JENKINS_REFRESH_LEASE_TTL_SECONDS,
    JENKINS_TREE_CACHE_TTL_SECONDS,
    JenkinsNodeKind,
)
from app.core.time import utcnow
from app.schemas.jenkins import JenkinsBuild, JenkinsNode

JENKINS_FOLDER_MAX_BUILDS_PER_PIPELINE = 500


@dataclass
class CacheEntry[DataT]:
    data: DataT
    fetched_at: datetime | None = None
    refreshing_until: datetime | None = None
    refresh_lease: str | None = None


class SharedCache:
    """Generic read-through cache with single-flight refresh leases."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._entries: dict[Hashable, CacheEntry[Any]] = {}

    async def read[DataT](
        self,
        key: Hashable,
        ttl_seconds: int,
        *,
        default: DataT,
    ) -> tuple[DataT, datetime | None, bool, str | None]:
        async with self._lock:
            now = utcnow()
            entry = cast("CacheEntry[DataT] | None", self._entries.get(key))
            if entry is not None and _is_fresh(entry.fetched_at, now, ttl_seconds):
                return entry.data, entry.fetched_at, False, None

            if entry is not None and _lease_is_active(entry.refreshing_until, now):
                return entry.data, entry.fetched_at, True, None

            lease = uuid4().hex
            if entry is None:
                entry = CacheEntry(data=default)
                self._entries[key] = entry
            entry.refresh_lease = lease
            entry.refreshing_until = now + timedelta(seconds=JENKINS_REFRESH_LEASE_TTL_SECONDS)
            return entry.data, entry.fetched_at, True, lease

    async def write[DataT](
        self,
        key: Hashable,
        data: DataT,
        _lease: str | None,
        *,
        merge: Callable[[DataT | None, DataT], DataT] | None = None,
    ) -> tuple[DataT, datetime | None]:
        async with self._lock:
            now = utcnow()
            entry = cast("CacheEntry[DataT] | None", self._entries.get(key))
            if _lease is not None:
                current_lease = entry.refresh_lease if entry is not None else None
                if current_lease != _lease:
                    current_data = entry.data if entry is not None else data
                    return current_data, entry.fetched_at if entry is not None else None
            stored = merge(entry.data if entry is not None else None, data) if merge else data
            entry = entry or CacheEntry(data=stored)
            entry.data = stored
            entry.fetched_at = now
            entry.refresh_lease = None
            entry.refreshing_until = None
            self._entries[key] = entry
            return entry.data, now


class JenkinsCache:
    """Shared in-memory Jenkins snapshots with single-flight refresh leases."""

    def __init__(self) -> None:
        self._store = SharedCache()

    async def read_tree(
        self,
        signature: str,
    ) -> tuple[list[JenkinsNode], datetime | None, bool, str | None]:
        return await self._store.read(
            ("tree", signature),
            JENKINS_TREE_CACHE_TTL_SECONDS,
            default=[],
        )

    async def write_tree(
        self,
        signature: str,
        roots: list[JenkinsNode],
        _lease: str | None,
    ) -> tuple[list[JenkinsNode], datetime | None]:
        return await self._store.write(("tree", signature), roots, _lease)

    async def read_builds(
        self,
        signature: str,
        path: str,
    ) -> tuple[list[JenkinsBuild], datetime | None, bool, str | None]:
        return await self._store.read(
            ("builds", signature, path),
            JENKINS_BUILDS_CACHE_TTL_SECONDS,
            default=[],
        )

    async def write_builds(
        self,
        signature: str,
        path: str,
        builds: list[JenkinsBuild],
        _lease: str | None,
    ) -> tuple[list[JenkinsBuild], datetime | None]:
        return await self._store.write(("builds", signature, path), builds, _lease)

    async def read_folder(
        self,
        signature: str,
        path: str,
        ttl_seconds: int,
    ) -> tuple[list[JenkinsNode], datetime | None, bool, str | None]:
        return await self._store.read(
            ("folder", signature, path),
            ttl_seconds,
            default=[],
        )

    async def write_folder(
        self,
        signature: str,
        path: str,
        roots: list[JenkinsNode],
        _lease: str | None,
    ) -> tuple[list[JenkinsNode], datetime | None]:
        return await self._store.write(
            ("folder", signature, path),
            roots,
            _lease,
            merge=_merge_folder_roots,
        )


def _merge_folder_roots(
    old_roots: list[JenkinsNode] | None,
    new_roots: list[JenkinsNode],
) -> list[JenkinsNode]:
    now_ms = int(utcnow().timestamp() * 1000)
    old_builds_by_path = _pipeline_builds_by_path(old_roots or [])
    return [_merge_folder_node(root, old_builds_by_path, now_ms) for root in new_roots]


def _pipeline_builds_by_path(roots: list[JenkinsNode]) -> dict[str, list[JenkinsBuild]]:
    builds_by_path: dict[str, list[JenkinsBuild]] = {}

    def visit(node: JenkinsNode) -> None:
        if node.kind == JenkinsNodeKind.PIPELINE:
            builds_by_path[node.path] = node.builds
        for child in node.children:
            visit(child)

    for root in roots:
        visit(root)
    return builds_by_path


def _merge_folder_node(
    node: JenkinsNode,
    old_builds_by_path: dict[str, list[JenkinsBuild]],
    now_ms: int,
) -> JenkinsNode:
    if node.kind == JenkinsNodeKind.PIPELINE:
        return node.model_copy(
            update={
                "builds": _merge_pipeline_builds(
                    old_builds_by_path.get(node.path),
                    node.builds,
                    now_ms,
                )
            }
        )

    return node.model_copy(
        update={
            "children": [
                _merge_folder_node(child, old_builds_by_path, now_ms) for child in node.children
            ]
        }
    )


def _merge_pipeline_builds(
    old_builds: list[JenkinsBuild] | None,
    new_builds: list[JenkinsBuild],
    now_ms: int,
) -> list[JenkinsBuild]:
    merged_by_number = {build.number: build for build in old_builds or []}
    merged_by_number.update({build.number: build for build in new_builds})
    merged_builds = sorted(merged_by_number.values(), key=lambda build: build.timestamp)
    if not merged_builds:
        return []

    cutoff_ms = now_ms - JENKINS_FOLDER_HISTORY_RETENTION_MS
    retained = [build for build in merged_builds if build.timestamp >= cutoff_ms]
    anchor = merged_builds[-1]
    if not retained or retained[-1].number != anchor.number:
        retained.append(anchor)
    if len(retained) > JENKINS_FOLDER_MAX_BUILDS_PER_PIPELINE:
        return retained[-JENKINS_FOLDER_MAX_BUILDS_PER_PIPELINE:]
    return retained


def _is_fresh(fetched_at: datetime | None, now: datetime, ttl_seconds: int) -> bool:
    if fetched_at is None:
        return False
    return now - fetched_at < timedelta(seconds=ttl_seconds)


def _lease_is_active(refreshing_until: datetime | None, now: datetime) -> bool:
    return refreshing_until is not None and now < refreshing_until
