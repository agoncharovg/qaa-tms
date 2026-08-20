"""Jenkins cache schemas shared by the backend API."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.core.config import JenkinsRootGroup
from app.core.constants import JenkinsNodeKind, JenkinsStatus


class JenkinsBuild(BaseModel):
    """Cached Jenkins build row."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    number: int
    result: str | None = None
    building: bool
    timestamp: int
    duration_ms: int = Field(alias="durationMs")
    url: str
    allure_url: str = Field(alias="allureUrl")


class JenkinsNode(BaseModel):
    """Cached Jenkins folder or pipeline node."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str
    path: str
    url: str
    kind: JenkinsNodeKind
    status: JenkinsStatus | None = None
    color: str | None = None
    synthetic: bool = False
    scheduled: bool = False
    builds: list[JenkinsBuild] = Field(default_factory=list)
    children: list[JenkinsNode] = Field(default_factory=list)


class JenkinsTreeCacheRead(BaseModel):
    """Shared tree cache read response."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    roots: list[JenkinsNode] = Field(default_factory=list)
    signature: str
    fetched_at: datetime | None = Field(default=None, alias="fetchedAt")
    stale: bool
    refresh_lease: str | None = Field(default=None, alias="refreshLease")


class JenkinsScopeRead(BaseModel):
    """Read-only Jenkins scope returned by the backend."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    signature: str
    root_groups: list[JenkinsRootGroup] = Field(default_factory=list, alias="rootGroups")
    root_folders: list[str] = Field(default_factory=list, alias="rootFolders")
    tree_depth: int = Field(alias="treeDepth")
    history_limit: int = Field(alias="historyLimit")


class JenkinsTreeCachePut(BaseModel):
    """Shared tree cache write request."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    signature: str
    roots: list[JenkinsNode] = Field(default_factory=list)
    refresh_lease: str | None = Field(default=None, alias="refreshLease")


class JenkinsBuildsCacheRead(BaseModel):
    """Shared builds cache read response."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    builds: list[JenkinsBuild] = Field(default_factory=list)
    signature: str
    path: str
    fetched_at: datetime | None = Field(default=None, alias="fetchedAt")
    stale: bool
    refresh_lease: str | None = Field(default=None, alias="refreshLease")


class JenkinsBuildsCachePut(BaseModel):
    """Shared builds cache write request."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    signature: str
    path: str
    builds: list[JenkinsBuild] = Field(default_factory=list)
    refresh_lease: str | None = Field(default=None, alias="refreshLease")


class JenkinsFolderCacheRead(BaseModel):
    """Shared folder cache read response."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    roots: list[JenkinsNode] = Field(default_factory=list)
    signature: str
    path: str
    fetched_at: datetime | None = Field(default=None, alias="fetchedAt")
    stale: bool
    refresh_lease: str | None = Field(default=None, alias="refreshLease")


class JenkinsFolderCachePut(BaseModel):
    """Shared folder cache write request."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    signature: str
    path: str
    roots: list[JenkinsNode] = Field(default_factory=list)
    refresh_lease: str | None = Field(default=None, alias="refreshLease")


JenkinsNode.model_rebuild()
