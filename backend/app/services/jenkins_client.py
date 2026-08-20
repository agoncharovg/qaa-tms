"""Read-only Jenkins fetch and parse helpers for the shared backend cache."""

from __future__ import annotations

import asyncio
import hashlib
import logging
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any
from urllib.parse import urlsplit

import httpx

from app.core.config import Settings
from app.core.constants import (
    DEFAULT_JENKINS_BUILDS_LIMIT,
    DEFAULT_JENKINS_STUCK_MIN_IDLE_HOURS,
    DEFAULT_SMOKE_FOLDER_HISTORY_LIMIT,
    JENKINS_ANIME_SUFFIX,
    JENKINS_FOLDER_CLASS,
    JENKINS_JOB_PATH_SEGMENT,
    JENKINS_SCM_TRIGGER_CLASS,
    JENKINS_SCOPE_SIGNATURE_LENGTH,
    JENKINS_TIMER_TRIGGER_CLASS,
    ErrorMessage,
    HttpHeader,
    JenkinsNodeKind,
    JenkinsStatus,
    MediaType,
)
from app.schemas.jenkins import JenkinsBuild, JenkinsNode

logger = logging.getLogger(__name__)


class JenkinsField(StrEnum):
    BUILDABLE = "buildable"
    BUILDING = "building"
    BUILDS = "builds"
    CHILDREN = "jobs"
    CLASS = "_class"
    COLOR = "color"
    DISABLED = "disabled"
    DURATION = "duration"
    IN_QUEUE = "inQueue"
    LAST_BUILD = "lastBuild"
    NAME = "name"
    NUMBER = "number"
    PROPERTY = "property"
    RESULT = "result"
    SPEC = "spec"
    TIMESTAMP = "timestamp"
    TRIGGERS = "triggers"
    URL = "url"


class JenkinsApiPath(StrEnum):
    ALLURE_SUFFIX = "allure/"
    API_JSON = "api/json"


class JenkinsColor(StrEnum):
    BLUE = "blue"
    DISABLED = "disabled"
    RED = "red"
    YELLOW = "yellow"


class JenkinsError(RuntimeError):
    """Raised when the backend cannot read Jenkins."""


class JenkinsPathOutOfScopeError(ValueError):
    """Raised when a requested Jenkins job path escapes the allowed subtree."""


class JenkinsPathToken(StrEnum):
    FULLNAME_SEPARATOR = "/"
    JOB_PREFIX = "job/"
    PATH_SEPARATOR = "/"
    SCHEDULED_NAME_HINT = "scheduled"
    URL_SCHEME_SEPARATOR = "://"


MILLISECONDS_PER_SECOND = 1000

TREE_FIELD_EXPRESSION = (
    "name,url,_class,color,buildable,disabled,inQueue,"
    "lastBuild[timestamp,building,result],"
    "property[_class,triggers[_class,spec]],triggers[_class,spec]"
)

BUILDS_TREE_EXPRESSION = (
    f"builds[number,result,building,timestamp,duration,url]{{0,{DEFAULT_JENKINS_BUILDS_LIMIT}}}"
)


def allowed_root_paths(settings: Settings) -> list[str]:
    """Return the allowed Jenkins root folder paths under the configured subtree."""

    return [
        (
            f"{group.path.strip(JenkinsPathToken.PATH_SEPARATOR)}"
            f"{JenkinsPathToken.PATH_SEPARATOR}{JENKINS_JOB_PATH_SEGMENT}"
            f"{JenkinsPathToken.PATH_SEPARATOR}{folder}"
        )
        for group in settings.jenkins_root_groups
        for folder in settings.jenkins_root_folders
    ]


def jenkins_scope_signature(settings: Settings) -> str:
    """Return a stable signature for the configured Jenkins tree scope."""

    group_signature = sorted(
        f"{group.label}:{group.path}" for group in settings.jenkins_root_groups
    )
    payload = (
        f"{group_signature}|"
        f"{sorted(settings.jenkins_root_folders)}|"
        f"{settings.jenkins_tree_depth}|"
        f"{settings.jenkins_history_limit}"
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:JENKINS_SCOPE_SIGNATURE_LENGTH]


def validate_job_path(settings: Settings, path: str) -> str:
    """Validate and normalize a client-supplied Jenkins job path."""

    raw_path = path.strip()
    parsed = urlsplit(raw_path)
    normalized_path = parsed.path.strip(JenkinsPathToken.PATH_SEPARATOR)

    if (
        not normalized_path
        or parsed.scheme
        or parsed.netloc
        or parsed.query
        or parsed.fragment
        or JenkinsPathToken.URL_SCHEME_SEPARATOR in raw_path
        or any(
            part == ".."
            for part in normalized_path.split(JenkinsPathToken.PATH_SEPARATOR)
        )
    ):
        raise JenkinsPathOutOfScopeError(ErrorMessage.JENKINS_PATH_OUT_OF_SCOPE.value)

    if not any(
        normalized_path == allowed_path
        or normalized_path.startswith(
            f"{allowed_path}{JenkinsPathToken.PATH_SEPARATOR}"
        )
        for allowed_path in allowed_root_paths(settings)
    ):
        raise JenkinsPathOutOfScopeError(ErrorMessage.JENKINS_PATH_OUT_OF_SCOPE.value)

    return normalized_path


async def fetch_tree(
    settings: Settings,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[JenkinsNode]:
    """Fetch the configured Jenkins subtrees and compose the synthetic env grouping."""

    tree_expression = (
        "jobs["
        + _build_tree_field_expression(
            max(settings.jenkins_tree_depth, 1),
            settings.jenkins_history_limit,
        )
        + "]"
    )
    payloads = await asyncio.gather(
        *(
            _get_json(
                settings,
                group.path,
                tree=tree_expression,
                transport=transport,
            )
            for group in settings.jenkins_root_groups
        )
    )
    children_by_group_and_name: dict[str, dict[str, dict[str, Any]]] = {}
    for group, payload in zip(settings.jenkins_root_groups, payloads, strict=True):
        children_by_name: dict[str, dict[str, Any]] = {}
        for raw_job in _read_object_list(payload, JenkinsField.CHILDREN):
            name = _read_optional_string(raw_job, JenkinsField.NAME)
            if name:
                children_by_name[name] = raw_job
        children_by_group_and_name[group.label] = children_by_name

    roots: list[JenkinsNode] = []
    for folder in settings.jenkins_root_folders:
        group_children: list[JenkinsNode] = []
        for group in settings.jenkins_root_groups:
            raw_env = children_by_group_and_name.get(group.label, {}).get(folder)
            if raw_env is None:
                continue
            group_node = _map_node(settings, raw_env).model_copy(update={"name": group.label})
            group_children.append(group_node)
        if not group_children:
            continue
        roots.append(
            JenkinsNode(
                name=folder,
                path="",
                url="",
                kind=JenkinsNodeKind.FOLDER,
                synthetic=True,
                children=group_children,
            )
        )
    return roots


async def fetch_builds(
    settings: Settings,
    job_path: str,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[JenkinsBuild]:
    """Fetch recent builds lazily for one pipeline."""

    validated_path = validate_job_path(settings, job_path)
    payload = await _get_json(
        settings,
        validated_path,
        tree=BUILDS_TREE_EXPRESSION,
        transport=transport,
    )
    return [_map_build(raw_build) for raw_build in _read_object_list(payload, JenkinsField.BUILDS)]


async def fetch_folder(
    settings: Settings,
    folder_path: str,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[JenkinsNode]:
    """Fetch one in-scope folder subtree with recent builds for the shared dashboard."""

    validated_path = validate_job_path(settings, folder_path)
    tree_expression = (
        "jobs["
        + _build_tree_field_expression(
            max(settings.jenkins_tree_depth, 1),
            DEFAULT_SMOKE_FOLDER_HISTORY_LIMIT,
        )
        + "]"
    )
    payload = await _get_json(
        settings,
        validated_path,
        tree=tree_expression,
        transport=transport,
    )
    return [
        _map_node(settings, raw_child)
        for raw_child in _read_object_list(payload, JenkinsField.CHILDREN)
    ]


def derive_status(
    raw: Mapping[str, Any],
    settings: Settings,
    *,
    scheduled: bool = False,
) -> JenkinsStatus:
    """Map Jenkins color and job state into the shared frontend status enum."""

    color = _read_optional_string(raw, JenkinsField.COLOR) or ""

    if color.endswith(JENKINS_ANIME_SUFFIX):
        return JenkinsStatus.RUNNING
    if bool(raw.get(JenkinsField.DISABLED)) or color == JenkinsColor.DISABLED.value:
        return JenkinsStatus.DISABLED
    if is_stuck(raw, settings, scheduled=scheduled):
        return JenkinsStatus.STUCK
    if color.startswith(JenkinsColor.BLUE.value):
        return JenkinsStatus.PASSED
    if color.startswith(JenkinsColor.RED.value) or color.startswith(JenkinsColor.YELLOW.value):
        return JenkinsStatus.FAILED
    return JenkinsStatus.NOTBUILT


def has_schedule(raw: Mapping[str, Any]) -> bool:
    """Detect explicit Jenkins timer or SCM schedules from the JSON response."""

    trigger_lists = [_read_object_list(raw, JenkinsField.TRIGGERS)]
    for property_item in _read_object_list(raw, JenkinsField.PROPERTY):
        trigger_lists.append(_read_object_list(property_item, JenkinsField.TRIGGERS))

    for trigger_list in trigger_lists:
        for trigger in trigger_list:
            class_name = _read_optional_string(trigger, JenkinsField.CLASS) or ""
            spec = (_read_optional_string(trigger, JenkinsField.SPEC) or "").strip()
            if (
                JENKINS_TIMER_TRIGGER_CLASS in class_name
                or JENKINS_SCM_TRIGGER_CLASS in class_name
                or bool(spec)
            ):
                return True
    return False


def is_stuck(
    raw: Mapping[str, Any],
    settings: Settings,
    *,
    scheduled: bool = False,
) -> bool:
    """Best-effort heuristic for the idle-but-broken Jenkins state."""

    color = _read_optional_string(raw, JenkinsField.COLOR) or ""
    if not bool(raw.get(JenkinsField.BUILDABLE)):
        return False
    if bool(raw.get(JenkinsField.DISABLED)):
        return False
    if color.endswith(JENKINS_ANIME_SUFFIX):
        return False
    if bool(raw.get(JenkinsField.IN_QUEUE)):
        return False
    if scheduled or has_schedule(raw):
        return False

    last_build = _read_object(raw, JenkinsField.LAST_BUILD)
    if not last_build or bool(last_build.get(JenkinsField.BUILDING)):
        return False

    timestamp = _read_int(last_build.get(JenkinsField.TIMESTAMP))
    if timestamp is None:
        return False

    idle_cutoff = datetime.now(UTC) - timedelta(hours=DEFAULT_JENKINS_STUCK_MIN_IDLE_HOURS)
    last_finished_at = datetime.fromtimestamp(timestamp / MILLISECONDS_PER_SECOND, tz=UTC)
    return last_finished_at <= idle_cutoff


async def _get_json(
    settings: Settings,
    job_path: str,
    *,
    tree: str,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    url = f"{settings.jenkins_common_url}/{job_path}/{JenkinsApiPath.API_JSON.value}"
    headers = {HttpHeader.ACCEPT.value: MediaType.JSON.value}
    try:
        async with httpx.AsyncClient(
            auth=httpx.BasicAuth(
                settings.jenkins_common_username,
                settings.jenkins_common_token,
            ),
            follow_redirects=True,
            headers=headers,
            timeout=settings.jenkins_request_timeout,
            transport=transport,
        ) as client:
            response = await client.get(url, params={"tree": tree})
            response.raise_for_status()
            payload = response.json() if response.content else {}
    except httpx.TimeoutException as exc:
        logger.warning("Jenkins request timed out: url=%s", url)
        raise JenkinsError(ErrorMessage.JENKINS_UNREACHABLE.value) from exc
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Jenkins request failed: status=%s url=%s",
            exc.response.status_code,
            exc.request.url,
        )
        raise JenkinsError(ErrorMessage.JENKINS_UNREACHABLE.value) from exc
    except httpx.HTTPError as exc:
        logger.warning("Jenkins request failed: url=%s error=%s", url, exc)
        raise JenkinsError(ErrorMessage.JENKINS_UNREACHABLE.value) from exc
    except ValueError as exc:
        logger.warning("Jenkins returned invalid JSON: url=%s", url)
        raise JenkinsError(ErrorMessage.JENKINS_UNREACHABLE.value) from exc

    return payload if isinstance(payload, dict) else {}


def _build_tree_field_expression(levels: int, history_limit: int) -> str:
    builds_expression = (
        f"builds[number,result,building,timestamp,duration,url]{{0,{history_limit}}}"
    )
    tree_expression = f"{TREE_FIELD_EXPRESSION},{builds_expression}"
    if levels <= 1:
        return tree_expression
    return f"{tree_expression},jobs[{_build_tree_field_expression(levels - 1, history_limit)}]"


def _map_build(raw: Mapping[str, Any]) -> JenkinsBuild:
    url = _read_optional_string(raw, JenkinsField.URL) or ""
    return JenkinsBuild(
        number=_read_int(raw.get(JenkinsField.NUMBER)) or 0,
        result=_read_optional_string(raw, JenkinsField.RESULT),
        building=bool(raw.get(JenkinsField.BUILDING)),
        timestamp=_read_int(raw.get(JenkinsField.TIMESTAMP)) or 0,
        duration_ms=_read_int(raw.get(JenkinsField.DURATION)) or 0,
        url=url,
        allure_url=f"{url}{JenkinsApiPath.ALLURE_SUFFIX.value}",
    )


def _map_node(settings: Settings, raw: Mapping[str, Any]) -> JenkinsNode:
    class_name = _read_optional_string(raw, JenkinsField.CLASS) or ""
    url = _read_optional_string(raw, JenkinsField.URL) or ""
    path = _path_from_url(url)
    name = _read_optional_string(raw, JenkinsField.NAME) or ""
    node_kind = (
        JenkinsNodeKind.FOLDER if JENKINS_FOLDER_CLASS in class_name else JenkinsNodeKind.PIPELINE
    )
    children = [
        _map_node(settings, child)
        for child in _read_object_list(raw, JenkinsField.CHILDREN)
    ]
    builds = (
        [_map_build(build) for build in _read_object_list(raw, JenkinsField.BUILDS)]
        if node_kind == JenkinsNodeKind.PIPELINE
        else []
    )
    scheduled = node_kind == JenkinsNodeKind.PIPELINE and (
        has_schedule(raw) or JenkinsPathToken.SCHEDULED_NAME_HINT in name.casefold()
    )

    return JenkinsNode(
        name=name,
        path=path,
        url=url,
        kind=node_kind,
        status=(
            None
            if node_kind == JenkinsNodeKind.FOLDER
            else derive_status(raw, settings, scheduled=scheduled)
        ),
        color=_read_optional_string(raw, JenkinsField.COLOR),
        synthetic=False,
        scheduled=scheduled,
        builds=builds,
        children=children if node_kind == JenkinsNodeKind.FOLDER else [],
    )


def _path_from_url(url: str) -> str:
    return urlsplit(url).path.strip(JenkinsPathToken.PATH_SEPARATOR)


def _read_int(value: Any) -> int | None:
    return value if isinstance(value, int) else None


def _read_object(payload: Mapping[str, Any], key: JenkinsField) -> dict[str, Any]:
    value = payload.get(key)
    return value if isinstance(value, dict) else {}


def _read_object_list(payload: Mapping[str, Any], key: JenkinsField) -> list[dict[str, Any]]:
    value = payload.get(key)
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _read_optional_string(payload: Mapping[str, Any], key: JenkinsField) -> str | None:
    value = payload.get(key)
    return value if isinstance(value, str) else None
