"""Jenkins REST helpers for the local companion app."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import unquote, urlsplit
from uuid import UUID

import httpx

from app.core.config import Settings
from app.core.constants import (
    DEFAULT_JENKINS_BUILDS_LIMIT,
    JENKINS_ANIME_SUFFIX,
    JENKINS_FOLDER_CLASS,
    JENKINS_JOB_PATH_SEGMENT,
    JENKINS_SCM_TRIGGER_CLASS,
    JENKINS_TIMER_TRIGGER_CLASS,
    SMOKE_FOLDER_HISTORY_LIMIT,
    ErrorMessage,
    HeaderName,
    HeaderValue,
    JenkinsApiPath,
    JenkinsColor,
    JenkinsNodeKind,
    JenkinsResumeItemState,
    JenkinsResumeResult,
    JenkinsResumeRunStatus,
    JenkinsStatus,
    Product,
)
from app.schemas import (
    JenkinsAllureSkipCandidate,
    JenkinsAllureSkipCandidatesError,
    JenkinsAllureSkipCandidatesResponse,
    JenkinsBuild,
    JenkinsFreezeSnapshotItem,
    JenkinsNode,
    JenkinsResumeOutcome,
)
from app.services.backend import get_jenkins_resume_run, put_jenkins_resume_progress

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
DISABLE_PATH = "disable"
ENABLE_PATH = "enable"
BUILD_PATH = "build"
BUILD_WITH_PARAMETERS_PATH = "buildWithParameters"
LAST_BUILD_PATH = "lastBuild"
LAST_BUILD_STOP_PATH = "lastBuild/stop"
LAST_BUILD_PARAMS_TREE = "actions[parameters[name,value]]"
ACTIONS_KEY = "actions"
PARAMETERS_KEY = "parameters"
VALUE_KEY = "value"
ALLURE_PATH_SEGMENT = JenkinsApiPath.ALLURE_SUFFIX.value.strip(PATH_SEPARATOR)
ALLURE_INDEX_NAME = "index.html"
ALLURE_SUITES_PATH = "data/suites.json"
ALLURE_TEST_CASES_DIR = "data/test-cases"
ALLURE_FULL_NAME_KEY = "fullName"
ALLURE_LABELS_KEY = "labels"
ALLURE_UID_KEY = "uid"
ALLURE_CHILDREN_KEY = "children"
ALLURE_PRODUCT_LABEL_NAME = "product"
ALLURE_TAG_LABEL_NAME = "tag"
ALLURE_PRODUCT_TAG_PREFIX = "product_"
JOB_PATH_PREFIX = "job/"
FULLNAME_SEPARATOR = "/"
SCHEDULED_NAME_HINT = "scheduled"
SCHEDULED_SCRIPT_TEMPLATE = (
    "import groovy.json.JsonSlurper\n"
    "import org.jenkinsci.plugins.workflow.job.WorkflowJob\n"
    "import java.util.Base64\n"
    "import hudson.triggers.TimerTrigger\n"
    "import hudson.triggers.SCMTrigger\n"
    "def prefixes = new JsonSlurper().parseText(\n"
    "  new String(Base64.decoder.decode('__PREFIXES__'), 'UTF-8')\n"
    ")\n"
    "Jenkins.instance.getAllItems(WorkflowJob).each { j ->\n"
    "  if (!prefixes.any { prefix -> j.fullName.startsWith(prefix) }) return\n"
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
FREEZE_SCRIPT_TEMPLATE = (
    "import groovy.json.JsonOutput\n"
    "import java.net.URI\n"
    "import java.util.Base64\n"
    "import org.jenkinsci.plugins.workflow.job.WorkflowJob\n"
    "import hudson.triggers.TimerTrigger\n"
    "import hudson.triggers.SCMTrigger\n"
    "def prefix = new String(Base64.decoder.decode('__PREFIX__'), 'UTF-8')\n"
    "def killBuilds = __KILL_BUILDS__\n"
    "def items = []\n"
    "Jenkins.instance.getAllItems(WorkflowJob).each { j ->\n"
    "  if (!j.fullName.startsWith(prefix)) return\n"
    "  def scheduled = j.triggers.values().any {\n"
    "    (it instanceof TimerTrigger || it instanceof SCMTrigger) && it.spec?.trim()\n"
    "  }\n"
    "  def wasDisabled = j.isDisabled()\n"
    "  def wasBuilding = j.isBuilding()\n"
    "  items << [\n"
    "    path: new URI(j.url).path.replaceAll('^/+|/+$', ''),\n"
    "    fullName: j.fullName,\n"
    "    name: j.name,\n"
    "    wasDisabled: wasDisabled,\n"
    "    scheduled: scheduled,\n"
    "    wasBuilding: wasBuilding,\n"
    "  ]\n"
    "  if (killBuilds && wasBuilding) {\n"
    "    j.builds.findAll { it.isBuilding() }.each { it.doStop() }\n"
    "  }\n"
    "  if (!wasDisabled) j.disable()\n"
    "}\n"
    "println JsonOutput.toJson(items)\n"
    "return null\n"
)
RESUME_SCRIPT_TEMPLATE = (
    "import groovy.json.JsonOutput\n"
    "import groovy.json.JsonSlurper\n"
    "import java.util.Base64\n"
    "import org.jenkinsci.plugins.workflow.job.WorkflowJob\n"
    "def encodedItems = '__ITEMS__'\n"
    "def items = new JsonSlurper().parseText(\n"
    "  new String(Base64.decoder.decode(encodedItems), 'UTF-8')\n"
    ")\n"
    "def outcomes = []\n"
    "items.each { item ->\n"
    "  def fullName = item.fullName\n"
    "  try {\n"
    "    def job = Jenkins.instance.getItemByFullName(fullName, WorkflowJob)\n"
    "    if (job == null) {\n"
    "      outcomes << [fullName: fullName, outcome: 'missing', detail: null]\n"
    "      return\n"
    "    }\n"
    "    if (job.isDisabled()) job.enable()\n"
    "    if (item.scheduled || item.wasBuilding || job.isBuilding() || job.isInQueue()) {\n"
    "      outcomes << [fullName: fullName, outcome: 'enabled', detail: null]\n"
    "      return\n"
    "    }\n"
    "    def lastBuild = job.getLastBuild()\n"
    "    def paramsAction = lastBuild?.getAction(hudson.model.ParametersAction)\n"
    "    if (paramsAction != null && !paramsAction.parameters.isEmpty()) {\n"
    "      job.scheduleBuild2(0, new hudson.model.ParametersAction(paramsAction.parameters))\n"
    "    } else {\n"
    "      job.scheduleBuild2(0)\n"
    "    }\n"
    "    outcomes << [fullName: fullName, outcome: 'restored', detail: null]\n"
    "  } catch (Exception exc) {\n"
    "    outcomes << [fullName: fullName, outcome: 'error', detail: exc.message]\n"
    "  }\n"
    "}\n"
    "println JsonOutput.toJson(outcomes)\n"
    "return null\n"
)
MILLISECONDS_PER_SECOND = 1000
SIGNATURE_LENGTH = 16
REST_MUTATION_CONCURRENCY = 8
JSON_ARRAY_PREFIX = "["
JSON_OBJECT_PREFIX = "{"
JENKINS_RESUME_MISSING_REASON = "Pipeline is missing in Jenkins."
JENKINS_RESUME_ERROR_REASON = "Jenkins resume failed."


class JenkinsScriptConsoleError(RuntimeError):
    """Raised when the Groovy Script Console cannot complete a batch mutation."""


class JenkinsNotConfiguredError(RuntimeError):
    """Raised when the local Jenkins credentials are missing."""


class JenkinsUnreachableError(RuntimeError):
    """Raised when Jenkins cannot be queried successfully."""


class JenkinsPathOutOfScopeError(ValueError):
    """Raised when a requested job path escapes the allowed Jenkins subtree."""


class JenkinsAllureReportError(ValueError):
    """Raised when an Allure report cannot be normalized, fetched, or parsed."""



def require_configured(settings: Settings) -> None:
    """Reject requests when Jenkins credentials are not configured locally."""

    if not settings.jenkins_configured:
        raise JenkinsNotConfiguredError(ErrorMessage.JENKINS_NOT_CONFIGURED.value)


def allowed_root_paths(settings: Settings) -> list[str]:
    """Return the allowed Jenkins root folder paths under the configured subtree."""

    return [
        f"{group.path.strip(PATH_SEPARATOR)}{PATH_SEPARATOR}{JENKINS_JOB_PATH_SEGMENT}{PATH_SEPARATOR}{folder}"
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


def _fullname_prefix_from_job_path(job_path: str) -> str:
    """Convert ``job/...`` URL path segments into a Jenkins ``fullName`` prefix."""

    segments = [
        unquote(segment)
        for segment in job_path.strip(PATH_SEPARATOR).split(PATH_SEPARATOR)
        if segment and segment != JOB_PATH_PREFIX.strip(PATH_SEPARATOR)
    ]
    return FULLNAME_SEPARATOR.join(segments) + FULLNAME_SEPARATOR


def _fullname_from_job_path(job_path: str) -> str:
    return _fullname_prefix_from_job_path(job_path).removesuffix(FULLNAME_SEPARATOR)


def _scheduled_fullname_prefixes(settings: Settings) -> list[str]:
    """Convert the configured root paths into Jenkins ``fullName`` prefixes."""

    return [_fullname_prefix_from_job_path(group.path) for group in settings.jenkins_root_groups]


def _encode_base64(value: str) -> str:
    return base64.b64encode(value.encode("utf-8")).decode("ascii")


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

    prefixes = _scheduled_fullname_prefixes(settings)
    if not prefixes:
        return set()
    script = SCHEDULED_SCRIPT_TEMPLATE.replace(
        "__PREFIXES__",
        _encode_base64(json.dumps(prefixes, separators=(",", ":"))),
    )
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

async def fetch_allure_skip_candidates(
    settings: Settings,
    report_urls: list[str],
    *,
    product: str | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> JenkinsAllureSkipCandidatesResponse:
    """Fetch and deduplicate candidate tests from one or more published Allure reports."""

    require_configured(settings)
    _ = product
    candidates_by_full_name: dict[str, JenkinsAllureSkipCandidate] = {}
    errors: list[JenkinsAllureSkipCandidatesError] = []

    for report_url in report_urls:
        normalized_report_url = report_url.strip()
        try:
            normalized_report_url = _normalize_allure_report_url(settings, report_url)
            report_candidates = await _fetch_allure_skip_candidates_for_report(
                settings,
                normalized_report_url,
                transport=transport,
            )
        except (JenkinsAllureReportError, JenkinsPathOutOfScopeError) as exc:
            errors.append(
                JenkinsAllureSkipCandidatesError(
                    report_url=normalized_report_url,
                    message=str(exc),
                )
            )
            continue

        for candidate in report_candidates:
            existing = candidates_by_full_name.get(candidate.full_name)
            if existing is None:
                candidates_by_full_name[candidate.full_name] = candidate
                continue
            if existing.product is None and candidate.product is not None:
                candidates_by_full_name[candidate.full_name] = existing.model_copy(
                    update={"product": candidate.product}
                )

    if not candidates_by_full_name:
        if errors:
            details = "; ".join(
                f"{error.report_url}: {error.message}" for error in errors
            )
            raise JenkinsAllureReportError(
                f"Failed to load Allure skip candidates. {details}"
            )
        raise JenkinsAllureReportError("Allure reports did not return any test candidates.")

    return JenkinsAllureSkipCandidatesResponse(
        candidates=list(candidates_by_full_name.values()),
        errors=errors,
    )



async def fetch_tree(
    settings: Settings,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[JenkinsNode]:
    """Fetch the configured Jenkins subtrees and compose the synthetic env grouping."""

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
        for raw_job in _read_object_list(payload, CHILDREN_KEY):
            name = _read_optional_string(raw_job, NAME_KEY)
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
            group_node = _map_node(settings, raw_env, scheduled_paths).model_copy(
                update={"name": group.label}
            )
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


async def fetch_folder(
    settings: Settings,
    folder_path: str,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[JenkinsNode]:
    """Fetch one in-scope folder's child pipelines with recent builds for a live view.

    Unlike fetch_tree this targets a single folder subtree so a dashboard can poll it
    cheaply at short intervals, and it skips the Script Console scheduled-paths scan for
    latency (the Statistics/Smoke board does not render the scheduled marker).
    """

    require_configured(settings)
    validated_path = validate_job_path(settings, folder_path)
    tree_expression = (
        "jobs["
        + _build_tree_field_expression(
            max(settings.jenkins_tree_depth, 1),
            SMOKE_FOLDER_HISTORY_LIMIT,
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
        _map_node(settings, raw_child, set())
        for raw_child in _read_object_list(payload, CHILDREN_KEY)
    ]


async def freeze_folder(
    settings: Settings,
    folder_path: str,
    *,
    kill_builds: bool,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[JenkinsFreezeSnapshotItem]:
    """Disable every pipeline in a folder subtree and return the pre-freeze snapshot."""

    require_configured(settings)
    validated_path = validate_job_path(settings, folder_path)
    try:
        snapshot = await _freeze_folder_via_groovy(
            settings,
            validated_path,
            kill_builds=kill_builds,
            transport=transport,
        )
        if snapshot:
            logger.info("jenkins freeze: mechanism=groovy path=%s", validated_path)
            return snapshot
        logger.warning(
            "jenkins freeze groovy returned empty snapshot, falling back to REST: path=%s",
            validated_path,
        )
    except JenkinsScriptConsoleError as exc:
        logger.warning(
            "jenkins freeze groovy failed, falling back to REST: path=%s error=%s",
            validated_path,
            exc,
        )
    snapshot = await _freeze_folder_via_rest(
        settings,
        validated_path,
        kill_builds=kill_builds,
        transport=transport,
    )
    logger.info("jenkins freeze: mechanism=rest path=%s", validated_path)
    return snapshot


async def resume_folder(
    settings: Settings,
    snapshot: list[JenkinsFreezeSnapshotItem],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[JenkinsResumeOutcome]:
    """Re-enable and optionally rebuild the pipelines that were active before a freeze."""

    require_configured(settings)
    restorable = [item for item in snapshot if not item.was_disabled]
    if not restorable:
        return []
    try:
        outcomes = await _resume_folder_via_groovy(settings, restorable, transport=transport)
        logger.info("jenkins resume: mechanism=groovy items=%s", len(restorable))
        return outcomes
    except JenkinsScriptConsoleError as exc:
        logger.warning("jenkins resume groovy failed, falling back to REST: error=%s", exc)
    outcomes = await _resume_folder_via_rest(settings, restorable, transport=transport)
    logger.info("jenkins resume: mechanism=rest items=%s", len(restorable))
    return outcomes


async def _freeze_folder_via_groovy(
    settings: Settings,
    folder_path: str,
    *,
    kill_builds: bool,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[JenkinsFreezeSnapshotItem]:
    script = FREEZE_SCRIPT_TEMPLATE.replace(
        "__PREFIX__",
        _encode_base64(_fullname_prefix_from_job_path(folder_path)),
    ).replace("__KILL_BUILDS__", json.dumps(kill_builds))
    body = await _post_script_text(settings, script, transport=transport)
    return _parse_snapshot_items(_extract_script_json_list(body))


async def _freeze_folder_via_rest(
    settings: Settings,
    folder_path: str,
    *,
    kill_builds: bool,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[JenkinsFreezeSnapshotItem]:
    snapshot = await _collect_snapshot_items(settings, folder_path, transport=transport)
    if not snapshot:
        return []

    async with _jenkins_client(settings, transport=transport) as client:
        crumb_headers = await _fetch_crumb(client, settings)
        semaphore = asyncio.Semaphore(REST_MUTATION_CONCURRENCY)

        async def mutate(item: JenkinsFreezeSnapshotItem) -> None:
            async with semaphore:
                if kill_builds and item.was_building:
                    stop_response = await _post_jenkins_action(
                        client,
                        settings,
                        item.path,
                        LAST_BUILD_STOP_PATH,
                        headers=crumb_headers,
                    )
                    _ensure_success_response(stop_response)
                if item.was_disabled:
                    return
                disable_response = await _post_jenkins_action(
                    client,
                    settings,
                    item.path,
                    DISABLE_PATH,
                    headers=crumb_headers,
                )
                _ensure_success_response(disable_response)

        # Tolerate per-job failures: a single failed disable/stop must not abort the
        # whole batch and discard the snapshot, which would orphan already-disabled
        # pipelines with no freeze record to restore them. Log and return the plan.
        results = await asyncio.gather(*(mutate(item) for item in snapshot), return_exceptions=True)
        for item, result in zip(snapshot, results, strict=True):
            if isinstance(result, Exception):
                logger.warning(
                    "jenkins freeze rest: mutation failed path=%s error=%s",
                    item.path,
                    result,
                )

    return snapshot


async def _resume_folder_via_groovy(
    settings: Settings,
    snapshot: list[JenkinsFreezeSnapshotItem],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[JenkinsResumeOutcome]:
    payload = json.dumps(
        [item.model_dump(by_alias=True) for item in snapshot],
        separators=(",", ":"),
    )
    script = RESUME_SCRIPT_TEMPLATE.replace("__ITEMS__", _encode_base64(payload))
    body = await _post_script_text(settings, script, transport=transport)
    return _parse_resume_outcomes(_extract_script_json_list(body))


async def _has_pending_execution(
    settings: Settings,
    job_path: str,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> bool:
    """Return whether a job is already running or queued for execution."""

    try:
        payload = await _get_json(
            settings,
            job_path,
            tree=f"{IN_QUEUE_KEY},{BUILDING_KEY},{LAST_BUILD_KEY}[{BUILDING_KEY}]",
            transport=transport,
        )
    except JenkinsUnreachableError:
        return False

    if bool(payload.get(IN_QUEUE_KEY)) or bool(payload.get(BUILDING_KEY)):
        return True
    last_build = _read_object(payload, LAST_BUILD_KEY)
    return bool(last_build.get(BUILDING_KEY))


async def _fetch_last_build_parameters(
    settings: Settings,
    job_path: str,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, str]:
    """Return the parameter name/value map of a pipeline's most recent build.

    Best-effort: a job with no builds (404) or an unparameterized last build yields
    an empty map, so resume falls back to a default ``build`` trigger.
    """

    try:
        payload = await _get_json(
            settings,
            f"{job_path}/{LAST_BUILD_PATH}",
            tree=LAST_BUILD_PARAMS_TREE,
            transport=transport,
        )
    except JenkinsUnreachableError:
        return {}

    parameters: dict[str, str] = {}
    for action in _read_object_list(payload, ACTIONS_KEY):
        for parameter in _read_object_list(action, PARAMETERS_KEY):
            name = _read_optional_string(parameter, NAME_KEY)
            if not name:
                continue
            value = parameter.get(VALUE_KEY)
            if isinstance(value, bool):
                parameters[name] = "true" if value else "false"
            elif value is not None:
                parameters[name] = str(value)
    return parameters


async def _resume_folder_via_rest(
    settings: Settings,
    snapshot: list[JenkinsFreezeSnapshotItem],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[JenkinsResumeOutcome]:
    async with _jenkins_client(settings, transport=transport) as client:
        crumb_headers = await _fetch_crumb(client, settings)
        semaphore = asyncio.Semaphore(REST_MUTATION_CONCURRENCY)

        async def resume_item(item: JenkinsFreezeSnapshotItem) -> JenkinsResumeOutcome:
            async with semaphore:
                return await _resume_one(
                    settings,
                    item,
                    client=client,
                    crumb_headers=crumb_headers,
                    transport=transport,
                )

        return list(await asyncio.gather(*(resume_item(item) for item in snapshot)))


async def _resume_one(
    settings: Settings,
    item: JenkinsFreezeSnapshotItem,
    *,
    restart_pipeline: bool = True,
    client: httpx.AsyncClient | None = None,
    crumb_headers: Mapping[str, str] | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> JenkinsResumeOutcome:
    if client is None:
        async with _jenkins_client(settings, transport=transport) as local_client:
            local_crumb_headers = await _fetch_crumb(local_client, settings)
            return await _resume_one(
                settings,
                item,
                restart_pipeline=restart_pipeline,
                client=local_client,
                crumb_headers=local_crumb_headers,
                transport=transport,
            )

    headers = crumb_headers or {}
    try:
        enable_response = await _post_jenkins_action(
            client,
            settings,
            item.path,
            ENABLE_PATH,
            headers=headers,
        )
    except JenkinsUnreachableError as exc:
        return JenkinsResumeOutcome(
            full_name=item.full_name,
            outcome=JenkinsResumeResult.ERROR,
            detail=str(exc),
        )

    if enable_response.status_code == httpx.codes.NOT_FOUND:
        return JenkinsResumeOutcome(
            full_name=item.full_name,
            outcome=JenkinsResumeResult.MISSING,
        )
    if not enable_response.is_success:
        return JenkinsResumeOutcome(
            full_name=item.full_name,
            outcome=JenkinsResumeResult.ERROR,
            detail=_response_detail(ENABLE_PATH, enable_response.status_code),
        )
    if item.scheduled or not restart_pipeline:
        return JenkinsResumeOutcome(
            full_name=item.full_name,
            outcome=JenkinsResumeResult.ENABLED,
        )
    if item.was_building or await _has_pending_execution(
        settings,
        item.path,
        transport=transport,
    ):
        return JenkinsResumeOutcome(
            full_name=item.full_name,
            outcome=JenkinsResumeResult.ENABLED,
        )

    parameters = await _fetch_last_build_parameters(settings, item.path, transport=transport)
    build_action = BUILD_WITH_PARAMETERS_PATH if parameters else BUILD_PATH
    try:
        build_response = await _post_jenkins_action(
            client,
            settings,
            item.path,
            build_action,
            headers=headers,
            data=parameters or None,
        )
    except JenkinsUnreachableError as exc:
        return JenkinsResumeOutcome(
            full_name=item.full_name,
            outcome=JenkinsResumeResult.ERROR,
            detail=str(exc),
        )

    if build_response.status_code == httpx.codes.NOT_FOUND:
        return JenkinsResumeOutcome(
            full_name=item.full_name,
            outcome=JenkinsResumeResult.MISSING,
        )
    if not build_response.is_success:
        return JenkinsResumeOutcome(
            full_name=item.full_name,
            outcome=JenkinsResumeResult.ERROR,
            detail=_response_detail(build_action, build_response.status_code),
        )
    return JenkinsResumeOutcome(
        full_name=item.full_name,
        outcome=JenkinsResumeResult.RESTORED,
    )


def _progress_state_from_resume_outcome(
    outcome: JenkinsResumeOutcome,
) -> tuple[JenkinsResumeItemState, str | None]:
    if outcome.outcome in {JenkinsResumeResult.RESTORED, JenkinsResumeResult.ENABLED}:
        return JenkinsResumeItemState.STARTED, None
    if outcome.outcome is JenkinsResumeResult.MISSING:
        return JenkinsResumeItemState.ERROR, JENKINS_RESUME_MISSING_REASON
    return JenkinsResumeItemState.ERROR, outcome.detail or JENKINS_RESUME_ERROR_REASON


async def run_resume_campaign(
    settings: Settings,
    run_id: UUID,
    token: str,
    snapshot: list[JenkinsFreezeSnapshotItem],
    *,
    restart_pipelines: bool = True,
    backend_client: httpx.AsyncClient,
    transport: httpx.AsyncBaseTransport | None = None,
) -> None:
    require_configured(settings)
    restorable = [item for item in snapshot if not item.was_disabled]
    if not restorable:
        return

    async with _jenkins_client(settings, transport=transport) as client:
        crumb_headers = await _fetch_crumb(client, settings)
        for index, item in enumerate(restorable):
            run = await get_jenkins_resume_run(
                client=backend_client,
                token=token,
                run_id=run_id,
            )
            if run.status is not JenkinsResumeRunStatus.RUNNING:
                return

            outcome = await _resume_one(
                settings,
                item,
                restart_pipeline=restart_pipelines,
                client=client,
                crumb_headers=crumb_headers,
                transport=transport,
            )
            state, reason = _progress_state_from_resume_outcome(outcome)
            next_item = restorable[index + 1] if index + 1 < len(restorable) else None
            updated_run = await put_jenkins_resume_progress(
                client=backend_client,
                token=token,
                run_id=run_id,
                path=item.path,
                state=state,
                reason=reason,
                next_path=next_item.path if next_item is not None else None,
                next_name=next_item.name if next_item is not None else None,
            )
            if updated_run.status is not JenkinsResumeRunStatus.RUNNING:
                return
            # Pause only between pipelines, not after the last one.
            if next_item is not None:
                await asyncio.sleep(settings.jenkins_resume_pause_seconds)



def _normalize_allure_report_url(settings: Settings, report_url: str) -> str:
    raw_report_url = report_url.strip()
    if not raw_report_url:
        raise JenkinsAllureReportError("Report URL cannot be empty.")

    parsed = urlsplit(raw_report_url)
    configured_base = urlsplit(settings.jenkins_url)
    if parsed.scheme or parsed.netloc:
        if parsed.scheme != configured_base.scheme or parsed.netloc != configured_base.netloc:
            raise JenkinsPathOutOfScopeError(ErrorMessage.JENKINS_PATH_OUT_OF_SCOPE.value)
        normalized_path = parsed.path.strip(PATH_SEPARATOR)
    else:
        normalized_path = raw_report_url.strip(PATH_SEPARATOR)

    if (
        not normalized_path
        or parsed.query
        or parsed.fragment
        or URL_SCHEME_SEPARATOR in normalized_path
        or any(part == ".." for part in normalized_path.split(PATH_SEPARATOR))
    ):
        raise JenkinsAllureReportError("Report URL is invalid.")

    segments = [segment for segment in normalized_path.split(PATH_SEPARATOR) if segment]
    if segments and segments[-1] == ALLURE_INDEX_NAME:
        segments = segments[:-1]
    if ALLURE_PATH_SEGMENT in segments:
        allure_index = segments.index(ALLURE_PATH_SEGMENT)
        segments = segments[: allure_index + 1]
    else:
        segments.append(ALLURE_PATH_SEGMENT)

    report_path = validate_job_path(settings, PATH_SEPARATOR.join(segments))
    return f"{settings.jenkins_url.rstrip(PATH_SEPARATOR)}/{report_path.rstrip(PATH_SEPARATOR)}/"


async def _fetch_allure_skip_candidates_for_report(
    settings: Settings,
    report_url: str,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[JenkinsAllureSkipCandidate]:
    suites_payload = await _fetch_allure_json(
        settings,
        f"{report_url}{ALLURE_SUITES_PATH}",
        not_found_message="Report does not expose Allure suites.json.",
        parse_message="Allure suites.json returned invalid JSON.",
        transport=transport,
    )
    suite_tests = _collect_allure_leaf_tests(suites_payload)
    candidates = await asyncio.gather(
        *(
            _parse_allure_test_case(
                settings,
                report_url,
                uid,
                name,
                transport=transport,
            )
            for uid, name in suite_tests
        )
    )
    return list(candidates)


async def _fetch_allure_json(
    settings: Settings,
    url: str,
    *,
    not_found_message: str,
    parse_message: str,
    transport: httpx.AsyncBaseTransport | None = None,
) -> Any:
    try:
        async with _jenkins_client(settings, transport=transport) as client:
            response = await client.get(
                url,
                headers={HeaderName.ACCEPT.value: HeaderValue.APPLICATION_JSON.value},
            )
            response.raise_for_status()
            return response.json() if response.content else {}
    except httpx.TimeoutException as exc:
        logger.warning("Jenkins request timed out: url=%s", url)
        raise JenkinsUnreachableError(ErrorMessage.JENKINS_UNREACHABLE.value) from exc
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Allure report request failed: status=%s url=%s",
            exc.response.status_code,
            exc.request.url,
        )
        if exc.response.status_code == httpx.codes.NOT_FOUND:
            raise JenkinsAllureReportError(not_found_message) from exc
        raise JenkinsAllureReportError(
            f"Allure report request failed with status {exc.response.status_code}."
        ) from exc
    except httpx.HTTPError as exc:
        logger.warning("Jenkins request failed: url=%s error=%s", url, exc)
        raise JenkinsUnreachableError(ErrorMessage.JENKINS_UNREACHABLE.value) from exc
    except ValueError as exc:
        logger.warning("Allure report returned invalid JSON: url=%s", url)
        raise JenkinsAllureReportError(parse_message) from exc


def _collect_allure_leaf_tests(payload: Any) -> list[tuple[str, str | None]]:
    tests: list[tuple[str, str | None]] = []
    seen_uids: set[str] = set()
    _walk_allure_nodes(payload, tests, seen_uids)
    if not tests:
        raise JenkinsAllureReportError("Allure suites.json does not contain any test cases.")
    return tests


def _walk_allure_nodes(
    payload: Any,
    tests: list[tuple[str, str | None]],
    seen_uids: set[str],
) -> None:
    if isinstance(payload, list):
        for item in payload:
            _walk_allure_nodes(item, tests, seen_uids)
        return
    if not isinstance(payload, Mapping):
        return

    children = _read_object_list(payload, ALLURE_CHILDREN_KEY)
    uid = _read_optional_string(payload, ALLURE_UID_KEY)
    name = _read_optional_string(payload, NAME_KEY)
    if children:
        for child in children:
            _walk_allure_nodes(child, tests, seen_uids)
        return
    if uid and uid not in seen_uids:
        seen_uids.add(uid)
        tests.append((uid, name))
        return

    for value in payload.values():
        if isinstance(value, (list, dict)):
            _walk_allure_nodes(value, tests, seen_uids)


async def _parse_allure_test_case(
    settings: Settings,
    report_url: str,
    uid: str,
    name: str | None,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> JenkinsAllureSkipCandidate:
    payload = await _fetch_allure_json(
        settings,
        f"{report_url}{ALLURE_TEST_CASES_DIR}/{uid}.json",
        not_found_message=f"Allure report is missing test case details for uid {uid}.",
        parse_message=f"Allure test case {uid} returned invalid JSON.",
        transport=transport,
    )
    if not isinstance(payload, Mapping):
        raise JenkinsAllureReportError(f"Allure test case {uid} is invalid.")

    full_name = _read_optional_string(payload, ALLURE_FULL_NAME_KEY)
    if not full_name:
        raise JenkinsAllureReportError(f"Allure test case {uid} is missing fullName.")

    return JenkinsAllureSkipCandidate(
        full_name=full_name,
        name=name or _read_optional_string(payload, NAME_KEY) or full_name,
        product=_extract_allure_product(payload),
    )


def _extract_allure_product(payload: Mapping[str, Any]) -> str | None:
    for label in _read_object_list(payload, ALLURE_LABELS_KEY):
        label_name = (_read_optional_string(label, NAME_KEY) or "").casefold()
        label_value = _read_optional_string(label, VALUE_KEY)
        if not label_value:
            continue
        if label_name == ALLURE_PRODUCT_LABEL_NAME:
            return _normalize_allure_product_name(label_value)
        if (
            label_name == ALLURE_TAG_LABEL_NAME
            and label_value.startswith(ALLURE_PRODUCT_TAG_PREFIX)
        ):
            return _normalize_allure_product_name(
                label_value.removeprefix(ALLURE_PRODUCT_TAG_PREFIX)
            )
    return None


def _normalize_allure_product_name(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        return value

    known_products = {product.value.casefold(): product.value for product in Product}
    return known_products.get(normalized.casefold(), normalized)


def _extract_script_json_list(body: str) -> list[dict[str, Any]]:
    for line in body.splitlines():
        candidate = line.strip()
        if not candidate or candidate[:1] not in {JSON_ARRAY_PREFIX, JSON_OBJECT_PREFIX}:
            continue
        try:
            payload = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, list):
            return [item for item in payload if isinstance(item, dict)]
    raise JenkinsScriptConsoleError("Script Console did not return a JSON list.")


def _parse_snapshot_items(items: list[dict[str, Any]]) -> list[JenkinsFreezeSnapshotItem]:
    try:
        return [JenkinsFreezeSnapshotItem.model_validate(item) for item in items]
    except ValueError as exc:
        raise JenkinsScriptConsoleError(
            "Script Console returned an invalid freeze snapshot."
        ) from exc


def _parse_resume_outcomes(items: list[dict[str, Any]]) -> list[JenkinsResumeOutcome]:
    try:
        return [JenkinsResumeOutcome.model_validate(item) for item in items]
    except ValueError as exc:
        raise JenkinsScriptConsoleError("Script Console returned invalid resume outcomes.") from exc


def _response_detail(action: str, status_code: int) -> str:
    return f"Jenkins {action} failed with status {status_code}."


def _ensure_success_response(response: httpx.Response) -> None:
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Jenkins mutation failed: status=%s url=%s",
            exc.response.status_code,
            exc.request.url,
        )
        raise JenkinsUnreachableError(ErrorMessage.JENKINS_UNREACHABLE.value) from exc


def _pipeline_snapshot_from_raw(raw: Mapping[str, Any]) -> JenkinsFreezeSnapshotItem:
    url = _read_optional_string(raw, URL_KEY) or ""
    path = _path_from_url(url)
    name = _read_optional_string(raw, NAME_KEY) or ""
    last_build = _read_object(raw, LAST_BUILD_KEY)
    was_building = bool(last_build.get(BUILDING_KEY)) or bool(raw.get(BUILDING_KEY))
    scheduled = has_schedule(raw) or SCHEDULED_NAME_HINT in name.casefold()
    return JenkinsFreezeSnapshotItem(
        path=path,
        full_name=_fullname_from_job_path(path),
        name=name,
        was_disabled=bool(raw.get(DISABLED_KEY)),
        scheduled=scheduled,
        was_building=was_building,
    )


async def _collect_snapshot_items(
    settings: Settings,
    job_path: str,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[JenkinsFreezeSnapshotItem]:
    payload = await _get_json(
        settings,
        job_path,
        tree=f"{TREE_FIELD_EXPRESSION},{CHILDREN_KEY}[{TREE_FIELD_EXPRESSION}]",
        transport=transport,
    )
    return await _collect_snapshot_items_from_payload(settings, payload, transport=transport)


async def _collect_snapshot_items_from_payload(
    settings: Settings,
    payload: Mapping[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[JenkinsFreezeSnapshotItem]:
    class_name = _read_optional_string(payload, CLASS_KEY) or ""
    if JENKINS_FOLDER_CLASS not in class_name:
        return [_pipeline_snapshot_from_raw(payload)]

    items: list[JenkinsFreezeSnapshotItem] = []
    for child in _read_object_list(payload, CHILDREN_KEY):
        child_class_name = _read_optional_string(child, CLASS_KEY) or ""
        if JENKINS_FOLDER_CLASS in child_class_name:
            child_path = _path_from_url(_read_optional_string(child, URL_KEY) or "")
            items.extend(
                await _collect_snapshot_items(
                    settings,
                    child_path,
                    transport=transport,
                )
            )
            continue
        items.append(_pipeline_snapshot_from_raw(child))
    return items


async def _post_script_text(
    settings: Settings,
    script: str,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> str:
    try:
        async with _jenkins_client(settings, transport=transport) as client:
            headers = await _fetch_crumb(client, settings)
            response = await client.post(
                f"{settings.jenkins_url}/{SCRIPT_TEXT_PATH}",
                data={"script": script},
                headers=headers,
            )
            response.raise_for_status()
            return response.text
    except httpx.HTTPError as exc:
        raise JenkinsScriptConsoleError("Script Console request failed.") from exc


def _jenkins_client(
    settings: Settings,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        auth=httpx.BasicAuth(settings.jenkins_username, settings.jenkins_token),
        follow_redirects=True,
        timeout=settings.jenkins_request_timeout,
        transport=transport,
    )


async def _post_jenkins_action(
    client: httpx.AsyncClient,
    settings: Settings,
    job_path: str,
    action: str,
    *,
    headers: Mapping[str, str],
    data: Mapping[str, str] | None = None,
) -> httpx.Response:
    url = f"{settings.jenkins_url}/{job_path}/{action}"
    try:
        return await client.post(url, headers=dict(headers), data=dict(data) if data else None)
    except httpx.TimeoutException as exc:
        logger.warning("Jenkins mutation timed out: url=%s", url)
        raise JenkinsUnreachableError(ErrorMessage.JENKINS_UNREACHABLE.value) from exc
    except httpx.HTTPError as exc:
        logger.warning("Jenkins mutation failed: url=%s error=%s", url, exc)
        raise JenkinsUnreachableError(ErrorMessage.JENKINS_UNREACHABLE.value) from exc


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
        path in scheduled_paths or has_schedule(raw) or SCHEDULED_NAME_HINT in name.casefold()
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
        synthetic=False,
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
