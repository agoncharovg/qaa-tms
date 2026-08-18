"""Jenkins REST helpers for the local companion app."""

from __future__ import annotations

import hashlib
import logging
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlsplit

import httpx

from app.core.config import Settings
from app.core.constants import (
    DEFAULT_JENKINS_BUILDS_LIMIT,
    JENKINS_ANIME_SUFFIX,
    JENKINS_FOLDER_CLASS,
    JENKINS_JOB_PATH_SEGMENT,
    JENKINS_SCM_TRIGGER_CLASS,
    JENKINS_TIMER_TRIGGER_CLASS,
    ErrorMessage,
    HeaderName,
    HeaderValue,
    JenkinsApiPath,
    JenkinsColor,
    JenkinsNodeKind,
    JenkinsStatus,
)
from app.schemas import JenkinsBuild, JenkinsNode

logger = logging.getLogger(__name__)

CLASS_KEY = "_class"
COLOR_KEY = "color"
BUILDABLE_KEY = "buildable"
BUILDING_KEY = "building"
CHILDREN_KEY = "jobs"
DISABLED_KEY = "disabled"
DURATION_KEY = "duration"
IN_QUEUE_KEY = "inQueue"
LAST_BUILD_KEY = "lastBuild"
NAME_KEY = "name"
NUMBER_KEY = "number"
PATH_SEPARATOR = "/"
PROPERTY_KEY = "property"
RESULT_KEY = "result"
SPEC_KEY = "spec"
TIMESTAMP_KEY = "timestamp"
TRIGGERS_KEY = "triggers"
URL_KEY = "url"
URL_SCHEME_SEPARATOR = "://"

TREE_FIELD_EXPRESSION = (
    "name,url,_class,color,buildable,disabled,inQueue,"
    "lastBuild[timestamp,building,result],"
    "property[_class,triggers[_class,spec]],triggers[_class,spec]"
)

# Pipeline (WorkflowJob) timer/SCM triggers live inside PipelineTriggersJobProperty,
# whose getTriggers() is NOT @Exported — so api/json never returns them (discuss: the
# JSON `triggers`/`property[...][triggers]` fields above only work for freestyle jobs).
# The only single-request way to learn which pipelines run on a schedule is the Script
# Console: one POST returns every scheduled job's url for the whole configured subtree.
SCRIPT_TEXT_PATH = "scriptText"
CRUMB_PATH = "crumbIssuer/api/json"
CRUMB_FIELD_KEY = "crumbRequestField"
CRUMB_VALUE_KEY = "crumb"
DEFAULT_CRUMB_HEADER = "Jenkins-Crumb"
JOB_PATH_PREFIX = "job/"
FULLNAME_SEPARATOR = "/"
SCHEDULED_NAME_HINT = "scheduled"
SCHEDULED_SCRIPT_TEMPLATE = (
    "import org.jenkinsci.plugins.workflow.job.WorkflowJob\n"
    "import hudson.triggers.TimerTrigger\n"
    "import hudson.triggers.SCMTrigger\n"
    "def prefix = '__PREFIX__'\n"
    "Jenkins.instance.getAllItems(WorkflowJob).each { j ->\n"
    "  if (!j.fullName.startsWith(prefix)) return\n"
    "  def scheduled = j.triggers.values().any {\n"
    "    (it instanceof TimerTrigger || it instanceof SCMTrigger) && it.spec?.trim()\n"
    "  }\n"
    "  if (scheduled) println j.url\n"
    "}\n"
    "return null\n"
)
BUILDS_TREE_EXPRESSION = (
    f"builds[number,result,building,timestamp,duration,url]{{0,{DEFAULT_JENKINS_BUILDS_LIMIT}}}"
)
MILLISECONDS_PER_SECOND = 1000
SIGNATURE_LENGTH = 16


class JenkinsNotConfiguredError(RuntimeError):
    """Raised when the local Jenkins credentials are missing."""


class JenkinsUnreachableError(RuntimeError):
    """Raised when Jenkins cannot be queried successfully."""


class JenkinsPathOutOfScopeError(ValueError):
    """Raised when a requested job path escapes the allowed Jenkins subtree."""


def require_configured(settings: Settings) -> None:
    """Reject requests when Jenkins credentials are not configured locally."""

    if not settings.jenkins_configured:
        raise JenkinsNotConfiguredError(ErrorMessage.JENKINS_NOT_CONFIGURED.value)


def allowed_root_paths(settings: Settings) -> list[str]:
    """Return the allowed Jenkins root folder paths under the configured subtree."""

    root_path = settings.jenkins_root_path.strip(PATH_SEPARATOR)
    return [
        f"{root_path}{PATH_SEPARATOR}{JENKINS_JOB_PATH_SEGMENT}{PATH_SEPARATOR}{folder}"
        for folder in settings.jenkins_root_folders
    ]


def jenkins_scope_signature(settings: Settings) -> str:
    """Return a stable signature for the configured Jenkins tree scope."""

    payload = (
        f"{settings.jenkins_root_path}|"
        f"{sorted(settings.jenkins_root_folders)}|"
        f"{settings.jenkins_tree_depth}|"
        f"{settings.jenkins_history_limit}"
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:SIGNATURE_LENGTH]


async def _get_json(
    settings: Settings,
    job_path: str,
    *,
    tree: str,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    """Fetch a Jenkins API JSON payload."""

    url = f"{settings.jenkins_url}/{job_path}/{JenkinsApiPath.API_JSON.value}"
    headers = {HeaderName.ACCEPT.value: HeaderValue.APPLICATION_JSON.value}
    try:
        async with httpx.AsyncClient(
            auth=httpx.BasicAuth(settings.jenkins_username, settings.jenkins_token),
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
        raise JenkinsUnreachableError(ErrorMessage.JENKINS_UNREACHABLE.value) from exc
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Jenkins request failed: status=%s url=%s",
            exc.response.status_code,
            exc.request.url,
        )
        raise JenkinsUnreachableError(ErrorMessage.JENKINS_UNREACHABLE.value) from exc
    except httpx.HTTPError as exc:
        logger.warning("Jenkins request failed: url=%s error=%s", url, exc)
        raise JenkinsUnreachableError(ErrorMessage.JENKINS_UNREACHABLE.value) from exc
    except ValueError as exc:
        logger.warning("Jenkins returned invalid JSON: url=%s", url)
        raise JenkinsUnreachableError(ErrorMessage.JENKINS_UNREACHABLE.value) from exc

    return payload if isinstance(payload, dict) else {}


def _scheduled_fullname_prefix(settings: Settings) -> str:
    """Convert the ``job/.QAA/job/E2E`` root path into a ``.QAA/E2E/`` fullName prefix."""

    segments = [
        segment
        for segment in settings.jenkins_root_path.strip(PATH_SEPARATOR).split(PATH_SEPARATOR)
        if segment and segment != JOB_PATH_PREFIX.strip(PATH_SEPARATOR)
    ]
    return FULLNAME_SEPARATOR.join(segments) + FULLNAME_SEPARATOR


async def _fetch_crumb(client: httpx.AsyncClient, settings: Settings) -> dict[str, str]:
    """Return a CSRF crumb header, or an empty mapping when crumbs are disabled."""

    try:
        response = await client.get(f"{settings.jenkins_url}/{CRUMB_PATH}")
        response.raise_for_status()
        payload = response.json() if response.content else {}
    except (httpx.HTTPError, ValueError):
        return {}
    if not isinstance(payload, dict):
        return {}
    value = payload.get(CRUMB_VALUE_KEY)
    if not isinstance(value, str) or not value:
        return {}
    header = payload.get(CRUMB_FIELD_KEY)
    header_name = header if isinstance(header, str) and header else DEFAULT_CRUMB_HEADER
    return {header_name: value}


async def fetch_scheduled_paths(
    settings: Settings,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> set[str]:
    """Return the node paths of pipelines that run on a timer/SCM schedule.

    Best-effort: pipeline triggers are only reachable via the Script Console, so any
    failure (no RunScripts permission, unreachable, malformed output) degrades to an
    empty set and the tree still renders — just without schedule markers.
    """

    script = SCHEDULED_SCRIPT_TEMPLATE.replace("__PREFIX__", _scheduled_fullname_prefix(settings))
    try:
        async with httpx.AsyncClient(
            auth=httpx.BasicAuth(settings.jenkins_username, settings.jenkins_token),
            follow_redirects=True,
            timeout=settings.jenkins_request_timeout,
            transport=transport,
        ) as client:
            headers = await _fetch_crumb(client, settings)
            response = await client.post(
                f"{settings.jenkins_url}/{SCRIPT_TEXT_PATH}",
                data={"script": script},
                headers=headers,
            )
            response.raise_for_status()
            body = response.text
    except httpx.HTTPError as exc:
        logger.warning("Jenkins schedule scan failed: error=%s", exc)
        return set()

    paths: set[str] = set()
    for line in body.splitlines():
        candidate = line.strip().strip(PATH_SEPARATOR)
        if candidate.startswith(JOB_PATH_PREFIX):
            paths.add(candidate)
    return paths


def validate_job_path(settings: Settings, path: str) -> str:
    """Validate and normalize a client-supplied Jenkins job path."""

    raw_path = path.strip()
    parsed = urlsplit(raw_path)
    normalized_path = parsed.path.strip(PATH_SEPARATOR)

    if (
        not normalized_path
        or parsed.scheme
        or parsed.netloc
        or parsed.query
        or parsed.fragment
        or URL_SCHEME_SEPARATOR in raw_path
        or any(part == ".." for part in normalized_path.split(PATH_SEPARATOR))
    ):
        raise JenkinsPathOutOfScopeError(ErrorMessage.JENKINS_PATH_OUT_OF_SCOPE.value)

    if not any(
        normalized_path == allowed_path
        or normalized_path.startswith(f"{allowed_path}{PATH_SEPARATOR}")
        for allowed_path in allowed_root_paths(settings)
    ):
        raise JenkinsPathOutOfScopeError(ErrorMessage.JENKINS_PATH_OUT_OF_SCOPE.value)

    return normalized_path


async def fetch_tree(
    settings: Settings,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[JenkinsNode]:
    """Fetch the configured Jenkins subtree in one recursive API call."""

    require_configured(settings)
    tree_expression = (
        "jobs["
        + _build_tree_field_expression(
            max(settings.jenkins_tree_depth, 1),
            settings.jenkins_history_limit,
        )
        + "]"
    )
    scheduled_paths = await fetch_scheduled_paths(settings, transport=transport)
    payload = await _get_json(
        settings,
        settings.jenkins_root_path,
        tree=tree_expression,
        transport=transport,
    )
    children_by_name: dict[str, dict[str, Any]] = {}
    for raw_job in _read_object_list(payload, CHILDREN_KEY):
        name = _read_optional_string(raw_job, NAME_KEY)
        if name:
            children_by_name[name] = raw_job

    return [
        _map_node(settings, children_by_name[folder], scheduled_paths)
        for folder in settings.jenkins_root_folders
        if folder in children_by_name
    ]


def derive_status(
    raw: Mapping[str, Any],
    settings: Settings,
    *,
    scheduled: bool = False,
) -> JenkinsStatus:
    """Map Jenkins color and job state into the shared frontend status enum."""

    color = _read_optional_string(raw, COLOR_KEY) or ""

    # discuss/09: any *_anime color means a build is actively running now.
    if color.endswith(JENKINS_ANIME_SUFFIX):
        return JenkinsStatus.RUNNING

    # discuss/09: disabled pipelines are the explicit gray bucket.
    if bool(raw.get(DISABLED_KEY)) or color == JenkinsColor.DISABLED.value:
        return JenkinsStatus.DISABLED

    # discuss/09: the stale yellow-red glitch overrides the last completed color.
    if is_stuck(raw, settings, scheduled=scheduled):
        return JenkinsStatus.STUCK

    # discuss/09: successful last build maps to green.
    if color.startswith(JenkinsColor.BLUE.value):
        return JenkinsStatus.PASSED

    # discuss/09: unstable yellow is folded into failed red for the MVP.
    if color.startswith(JenkinsColor.RED.value) or color.startswith(JenkinsColor.YELLOW.value):
        return JenkinsStatus.FAILED

    # discuss/09: notbuilt, aborted, or missing color are the neutral gray bucket.
    return JenkinsStatus.NOTBUILT


def is_stuck(
    raw: Mapping[str, Any],
    settings: Settings,
    *,
    scheduled: bool = False,
) -> bool:
    """Best-effort heuristic for the idle-but-broken Jenkins state from discuss/09."""

    color = _read_optional_string(raw, COLOR_KEY) or ""
    if not bool(raw.get(BUILDABLE_KEY)):
        return False
    if bool(raw.get(DISABLED_KEY)):
        return False
    if color.endswith(JENKINS_ANIME_SUFFIX):
        return False
    if bool(raw.get(IN_QUEUE_KEY)):
        return False
    if scheduled or has_schedule(raw):
        return False

    last_build = _read_object(raw, LAST_BUILD_KEY)
    if not last_build or bool(last_build.get(BUILDING_KEY)):
        return False

    timestamp = _read_int(last_build.get(TIMESTAMP_KEY))
    if timestamp is None:
        return False

    idle_cutoff = datetime.now(UTC) - timedelta(hours=settings.jenkins_stuck_min_idle_hours)
    last_finished_at = datetime.fromtimestamp(timestamp / MILLISECONDS_PER_SECOND, tz=UTC)
    return last_finished_at <= idle_cutoff


def has_schedule(raw: Mapping[str, Any]) -> bool:
    """Detect explicit Jenkins timer or SCM schedules in either trigger location."""

    trigger_lists = [_read_object_list(raw, TRIGGERS_KEY)]
    for property_item in _read_object_list(raw, PROPERTY_KEY):
        trigger_lists.append(_read_object_list(property_item, TRIGGERS_KEY))

    for trigger_list in trigger_lists:
        for trigger in trigger_list:
            class_name = _read_optional_string(trigger, CLASS_KEY) or ""
            spec = (_read_optional_string(trigger, SPEC_KEY) or "").strip()
            if (
                JENKINS_TIMER_TRIGGER_CLASS in class_name
                or JENKINS_SCM_TRIGGER_CLASS in class_name
                or bool(spec)
            ):
                return True
    return False


async def fetch_builds(
    settings: Settings,
    job_path: str,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[JenkinsBuild]:
    """Fetch recent builds lazily for one pipeline."""

    require_configured(settings)
    validated_path = validate_job_path(settings, job_path)
    payload = await _get_json(
        settings,
        validated_path,
        tree=BUILDS_TREE_EXPRESSION,
        transport=transport,
    )
    builds: list[JenkinsBuild] = []
    for raw_build in _read_object_list(payload, "builds"):
        builds.append(_map_build(raw_build))
    return builds


def _build_tree_field_expression(levels: int, history_limit: int) -> str:
    builds_expression = (
        f"builds[number,result,building,timestamp,duration,url]{{0,{history_limit}}}"
    )
    tree_expression = f"{TREE_FIELD_EXPRESSION},{builds_expression}"
    if levels <= 1:
        return tree_expression
    return f"{tree_expression},jobs[{_build_tree_field_expression(levels - 1, history_limit)}]"


def _map_build(raw: Mapping[str, Any]) -> JenkinsBuild:
    url = _read_optional_string(raw, URL_KEY) or ""
    return JenkinsBuild(
        number=_read_int(raw.get(NUMBER_KEY)) or 0,
        result=_read_optional_string(raw, RESULT_KEY),
        building=bool(raw.get(BUILDING_KEY)),
        timestamp=_read_int(raw.get(TIMESTAMP_KEY)) or 0,
        duration_ms=_read_int(raw.get(DURATION_KEY)) or 0,
        url=url,
        allure_url=f"{url}{JenkinsApiPath.ALLURE_SUFFIX.value}",
    )


def _map_node(
    settings: Settings,
    raw: Mapping[str, Any],
    scheduled_paths: set[str],
) -> JenkinsNode:
    class_name = _read_optional_string(raw, CLASS_KEY) or ""
    url = _read_optional_string(raw, URL_KEY) or ""
    path = _path_from_url(url)
    name = _read_optional_string(raw, NAME_KEY) or ""
    node_kind = (
        JenkinsNodeKind.FOLDER if JENKINS_FOLDER_CLASS in class_name else JenkinsNodeKind.PIPELINE
    )
    children = [
        _map_node(settings, child, scheduled_paths)
        for child in _read_object_list(raw, CHILDREN_KEY)
    ]
    builds = (
        [_map_build(build) for build in _read_object_list(raw, "builds")]
        if node_kind is JenkinsNodeKind.PIPELINE
        else []
    )
    # Precedence: authoritative Script Console scan, then the freestyle-JSON fallback, then a
    # name heuristic (their pipelines are named "... scheduled") so the marker still shows when
    # the token lacks RunScripts permission and the scan comes back empty.
    scheduled = node_kind is JenkinsNodeKind.PIPELINE and (
        path in scheduled_paths
        or has_schedule(raw)
        or SCHEDULED_NAME_HINT in name.casefold()
    )

    return JenkinsNode(
        name=_read_optional_string(raw, NAME_KEY) or "",
        path=path,
        url=url,
        kind=node_kind,
        status=(
            None
            if node_kind is JenkinsNodeKind.FOLDER
            else derive_status(raw, settings, scheduled=scheduled)
        ),
        color=_read_optional_string(raw, COLOR_KEY),
        scheduled=scheduled,
        builds=builds,
        children=children if node_kind is JenkinsNodeKind.FOLDER else [],
    )


def _path_from_url(url: str) -> str:
    return urlsplit(url).path.strip(PATH_SEPARATOR)


def _read_object(payload: Mapping[str, Any], key: str) -> dict[str, Any]:
    value = payload.get(key)
    return value if isinstance(value, dict) else {}


def _read_object_list(payload: Mapping[str, Any], key: str) -> list[dict[str, Any]]:
    value = payload.get(key)
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _read_optional_string(payload: Mapping[str, Any], key: str) -> str | None:
    value = payload.get(key)
    return value if isinstance(value, str) else None


def _read_int(value: Any) -> int | None:
    return value if isinstance(value, int) else None
