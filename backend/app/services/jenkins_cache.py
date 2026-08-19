"""In-memory Jenkins cache for a single backend instance.

This cache assumes one backend process for the current deployment size. A
shared multi-instance store such as Redis is intentionally out of scope here.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from uuid import uuid4

from app.core.constants import (
    JENKINS_BUILDS_CACHE_TTL_SECONDS,
    JENKINS_REFRESH_LEASE_TTL_SECONDS,
    JENKINS_TREE_CACHE_TTL_SECONDS,
)
from app.core.time import utcnow
from app.schemas.jenkins import JenkinsBuild, JenkinsNode


@dataclass
class TreeEntry:
    roots: list[JenkinsNode] = field(default_factory=list)
    fetched_at: datetime | None = None
    refreshing_until: datetime | None = None
    refresh_lease: str | None = None


@dataclass
class BuildsEntry:
    builds: list[JenkinsBuild] = field(default_factory=list)
    fetched_at: datetime | None = None
    refreshing_until: datetime | None = None
    refresh_lease: str | None = None


class JenkinsCache:
    """Shared in-memory Jenkins snapshots with single-flight refresh leases."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._trees: dict[str, TreeEntry] = {}
        self._builds: dict[tuple[str, str], BuildsEntry] = {}

    async def read_tree(
        self,
        signature: str,
    ) -> tuple[list[JenkinsNode], datetime | None, bool, str | None]:
        async with self._lock:
            now = utcnow()
            entry = self._trees.get(signature)
            if entry is not None and _is_fresh(
                entry.fetched_at, now, JENKINS_TREE_CACHE_TTL_SECONDS
            ):
                return entry.roots, entry.fetched_at, False, None

            if entry is not None and _lease_is_active(entry.refreshing_until, now):
                return entry.roots, entry.fetched_at, True, None

            lease = uuid4().hex
            if entry is None:
                entry = TreeEntry()
                self._trees[signature] = entry
            entry.refresh_lease = lease
            entry.refreshing_until = now + timedelta(seconds=JENKINS_REFRESH_LEASE_TTL_SECONDS)
            return entry.roots, entry.fetched_at, True, lease

    async def write_tree(
        self,
        signature: str,
        roots: list[JenkinsNode],
        _lease: str | None,
    ) -> tuple[list[JenkinsNode], datetime]:
        async with self._lock:
            now = utcnow()
            entry = self._trees.get(signature) or TreeEntry()
            entry.roots = roots
            entry.fetched_at = now
            entry.refresh_lease = None
            entry.refreshing_until = None
            self._trees[signature] = entry
            return entry.roots, now

    async def read_builds(
        self,
        signature: str,
        path: str,
    ) -> tuple[list[JenkinsBuild], datetime | None, bool, str | None]:
        key = (signature, path)
        async with self._lock:
            now = utcnow()
            entry = self._builds.get(key)
            if entry is not None and _is_fresh(
                entry.fetched_at, now, JENKINS_BUILDS_CACHE_TTL_SECONDS
            ):
                return entry.builds, entry.fetched_at, False, None

            if entry is not None and _lease_is_active(entry.refreshing_until, now):
                return entry.builds, entry.fetched_at, True, None

            lease = uuid4().hex
            if entry is None:
                entry = BuildsEntry()
                self._builds[key] = entry
            entry.refresh_lease = lease
            entry.refreshing_until = now + timedelta(seconds=JENKINS_REFRESH_LEASE_TTL_SECONDS)
            return entry.builds, entry.fetched_at, True, lease

    async def write_builds(
        self,
        signature: str,
        path: str,
        builds: list[JenkinsBuild],
        _lease: str | None,
    ) -> tuple[list[JenkinsBuild], datetime]:
        key = (signature, path)
        async with self._lock:
            now = utcnow()
            entry = self._builds.get(key) or BuildsEntry()
            entry.builds = builds
            entry.fetched_at = now
            entry.refresh_lease = None
            entry.refreshing_until = None
            self._builds[key] = entry
            return entry.builds, now


def _is_fresh(fetched_at: datetime | None, now: datetime, ttl_seconds: int) -> bool:
    if fetched_at is None:
        return False
    return now - fetched_at < timedelta(seconds=ttl_seconds)


def _lease_is_active(refreshing_until: datetime | None, now: datetime) -> bool:
    return refreshing_until is not None and now < refreshing_until
