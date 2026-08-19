from __future__ import annotations

import base64
import json
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qs, parse_qsl
from uuid import uuid4

import httpx
import pytest
from conftest import BackendRecorder

from app.api import routes as api_routes
from app.core.config import Settings
from app.core.constants import (
    DEFAULT_JENKINS_ROOT_FOLDERS,
    DEFAULT_JENKINS_ROOT_GROUPS,
    ErrorMessage,
    JenkinsResumeRunStatus,
    JenkinsStatus,
)
from app.main import create_app
from app.schemas import JenkinsFreezeSnapshotItem
from app.services.jenkins import (
    RESUME_SCRIPT_TEMPLATE,
    JenkinsPathOutOfScopeError,
    JenkinsUnreachableError,
    _map_build,
    _map_node,
    derive_status,
    fetch_builds,
    fetch_scheduled_paths,
    fetch_tree,
    freeze_folder,
    jenkins_scope_signature,
    resume_folder,
    run_resume_campaign,
    validate_job_path,
)

JENKINS_BASE_URL = "https://jenkins.p.gc.onl"
JENKINS_BE_ROOT_PATH = "job/.QAA/job/E2E"
JENKINS_FE_ROOT_PATH = "job/.QAA/job/UI_E2E"
DEFAULT_ROOT_GROUPS = f"BE={JENKINS_BE_ROOT_PATH},FE={JENKINS_FE_ROOT_PATH}"
CUSTOM_PATH = f"{JENKINS_BE_ROOT_PATH}/job/CUSTOM"
PREPROD_BE_PATH = f"{JENKINS_BE_ROOT_PATH}/job/PREPROD"
PROD_BE_PATH = f"{JENKINS_BE_ROOT_PATH}/job/PROD"
STAGING_PATH = f"{JENKINS_BE_ROOT_PATH}/job/STAGING"
PREPROD_FE_PATH = f"{JENKINS_FE_ROOT_PATH}/job/PREPROD"
PROD_FE_PATH = f"{JENKINS_FE_ROOT_PATH}/job/PROD"
PIPELINE_PATH = f"{PREPROD_BE_PATH}/job/Smoke"
FE_PIPELINE_PATH = f"{PREPROD_FE_PATH}/job/Visual"
CUSTOM_PIPELINE_PATH = f"{CUSTOM_PATH}/job/Smoke"
OUT_OF_SCOPE_PATH = "job/.QAA/job/OTHER/job/PREPROD/job/Smoke"
OLD_BUILD_TIMESTAMP = int((datetime.now(UTC) - timedelta(hours=12)).timestamp() * 1000)
FRESH_BUILD_TIMESTAMP = int((datetime.now(UTC) - timedelta(hours=1)).timestamp() * 1000)


def build_settings(
    *,
    history_limit: int = 8,
    token: str = "jenkins-token",
    root_groups: str | list[Any] | None = None,
    root_folders: str | list[str] | None = None,
    tree_depth: int = 5,
) -> Settings:
    settings_kwargs: dict[str, Any] = {
        "AGENT_HOST": "127.0.0.1",
        "AGENT_PORT": 47600,
        "AGENT_BACKEND_URL": "http://backend.test",
        "AGENT_CORS_ORIGINS": "http://localhost:3000,http://127.0.0.1:3000",
        "AGENT_JENKINS_URL": JENKINS_BASE_URL,
        "AGENT_JENKINS_USERNAME": "engineer",
        "AGENT_JENKINS_TOKEN": token,
        "AGENT_JENKINS_ROOT_GROUPS": DEFAULT_ROOT_GROUPS,
        "AGENT_JENKINS_HISTORY_LIMIT": history_limit,
        "AGENT_JENKINS_TREE_DEPTH": tree_depth,
        "AGENT_JENKINS_REQUEST_TIMEOUT": 15.0,
        "AGENT_JENKINS_STUCK_MIN_IDLE_HOURS": 6,
    }
    if root_groups is not None:
        settings_kwargs["AGENT_JENKINS_ROOT_GROUPS"] = root_groups
    if root_folders is not None:
        settings_kwargs["AGENT_JENKINS_ROOT_FOLDERS"] = root_folders
    return Settings(**settings_kwargs)


def build_be_tree_payload() -> dict[str, Any]:
    return {
        "jobs": [
            {
                "_class": "com.cloudbees.hudson.plugins.folder.Folder",
                "buildable": False,
                "color": None,
                "disabled": False,
                "inQueue": False,
                "jobs": [],
                "lastBuild": None,
                "name": "CUSTOM",
                "property": [],
                "triggers": [],
                "url": f"{JENKINS_BASE_URL}/{CUSTOM_PATH}/",
            },
            {
                "_class": "com.cloudbees.hudson.plugins.folder.Folder",
                "buildable": False,
                "color": None,
                "disabled": False,
                "inQueue": False,
                "jobs": [
                    {
                        "_class": "org.jenkinsci.plugins.workflow.job.WorkflowJob",
                        "buildable": True,
                        "color": "blue",
                        "disabled": False,
                        "inQueue": False,
                        "lastBuild": {
                            "building": False,
                            "result": "SUCCESS",
                            "timestamp": FRESH_BUILD_TIMESTAMP,
                        },
                        "name": "Smoke",
                        "property": [],
                        "triggers": [],
                        "builds": [
                            {
                                "building": False,
                                "duration": 120000,
                                "number": 42,
                                "result": "SUCCESS",
                                "timestamp": FRESH_BUILD_TIMESTAMP,
                                "url": f"{JENKINS_BASE_URL}/{PIPELINE_PATH}/42/",
                            },
                            {
                                "building": True,
                                "duration": 45000,
                                "number": 43,
                                "result": None,
                                "timestamp": FRESH_BUILD_TIMESTAMP,
                                "url": f"{JENKINS_BASE_URL}/{PIPELINE_PATH}/43/",
                            },
                        ],
                        "url": f"{JENKINS_BASE_URL}/{PIPELINE_PATH}/",
                    },
                    {
                        "_class": "com.cloudbees.hudson.plugins.folder.Folder",
                        "buildable": False,
                        "color": None,
                        "disabled": False,
                        "inQueue": False,
                        "jobs": [
                            {
                                "_class": "org.jenkinsci.plugins.workflow.job.WorkflowJob",
                                "buildable": True,
                                "color": "red",
                                "disabled": False,
                                "inQueue": False,
                                "lastBuild": {
                                    "building": False,
                                    "result": "FAILURE",
                                    "timestamp": FRESH_BUILD_TIMESTAMP,
                                },
                                "name": "Nested",
                                "property": [],
                                "triggers": [
                                    {"_class": "hudson.triggers.TimerTrigger", "spec": "H 2 * * *"}
                                ],
                                "builds": [
                                    {
                                        "building": False,
                                        "duration": 118000,
                                        "number": 7,
                                        "result": "FAILURE",
                                        "timestamp": FRESH_BUILD_TIMESTAMP,
                                        "url": (
                                            f"{JENKINS_BASE_URL}/{PREPROD_BE_PATH}/job/NestedFolder/job/Nested/7/"
                                        ),
                                    }
                                ],
                                "url": (
                                    f"{JENKINS_BASE_URL}/{PREPROD_BE_PATH}/job/NestedFolder/job/Nested/"
                                ),
                            }
                        ],
                        "lastBuild": None,
                        "name": "NestedFolder",
                        "property": [],
                        "triggers": [],
                        "url": f"{JENKINS_BASE_URL}/{PREPROD_BE_PATH}/job/NestedFolder/",
                    },
                ],
                "lastBuild": None,
                "name": "PREPROD",
                "property": [],
                "triggers": [],
                "url": f"{JENKINS_BASE_URL}/{PREPROD_BE_PATH}/",
            },
            {
                "_class": "com.cloudbees.hudson.plugins.folder.Folder",
                "buildable": False,
                "color": None,
                "disabled": False,
                "inQueue": False,
                "jobs": [
                    {
                        "_class": "org.jenkinsci.plugins.workflow.job.WorkflowJob",
                        "buildable": True,
                        "color": "blue_anime",
                        "disabled": False,
                        "inQueue": True,
                        "lastBuild": {
                            "building": True,
                            "result": None,
                            "timestamp": FRESH_BUILD_TIMESTAMP,
                        },
                        "builds": [
                            {
                                "building": True,
                                "duration": 30000,
                                "number": 9,
                                "result": None,
                                "timestamp": FRESH_BUILD_TIMESTAMP,
                                "url": f"{JENKINS_BASE_URL}/{PROD_BE_PATH}/job/Release/9/",
                            }
                        ],
                        "name": "Release",
                        "property": [],
                        "triggers": [],
                        "url": f"{JENKINS_BASE_URL}/{PROD_BE_PATH}/job/Release/",
                    }
                ],
                "lastBuild": None,
                "name": "PROD",
                "property": [],
                "triggers": [],
                "url": f"{JENKINS_BASE_URL}/{PROD_BE_PATH}/",
            },
            {
                "_class": "com.cloudbees.hudson.plugins.folder.Folder",
                "buildable": False,
                "color": None,
                "disabled": False,
                "inQueue": False,
                "jobs": [],
                "lastBuild": None,
                "name": "STAGING",
                "property": [],
                "triggers": [],
                "url": f"{JENKINS_BASE_URL}/{STAGING_PATH}/",
            },
        ]
    }


def build_fe_tree_payload() -> dict[str, Any]:
    return {
        "jobs": [
            {
                "_class": "com.cloudbees.hudson.plugins.folder.Folder",
                "buildable": False,
                "color": None,
                "disabled": False,
                "inQueue": False,
                "jobs": [
                    {
                        "_class": "org.jenkinsci.plugins.workflow.job.WorkflowJob",
                        "buildable": True,
                        "color": "blue",
                        "disabled": False,
                        "inQueue": False,
                        "lastBuild": {
                            "building": False,
                            "result": "SUCCESS",
                            "timestamp": FRESH_BUILD_TIMESTAMP,
                        },
                        "name": "Visual",
                        "property": [],
                        "triggers": [],
                        "builds": [
                            {
                                "building": False,
                                "duration": 111000,
                                "number": 12,
                                "result": "SUCCESS",
                                "timestamp": FRESH_BUILD_TIMESTAMP,
                                "url": f"{JENKINS_BASE_URL}/{FE_PIPELINE_PATH}/12/",
                            }
                        ],
                        "url": f"{JENKINS_BASE_URL}/{FE_PIPELINE_PATH}/",
                    }
                ],
                "lastBuild": None,
                "name": "PREPROD",
                "property": [],
                "triggers": [],
                "url": f"{JENKINS_BASE_URL}/{PREPROD_FE_PATH}/",
            },
            {
                "_class": "com.cloudbees.hudson.plugins.folder.Folder",
                "buildable": False,
                "color": None,
                "disabled": False,
                "inQueue": False,
                "jobs": [
                    {
                        "_class": "org.jenkinsci.plugins.workflow.job.WorkflowJob",
                        "buildable": True,
                        "color": "red",
                        "disabled": False,
                        "inQueue": False,
                        "lastBuild": {
                            "building": False,
                            "result": "FAILURE",
                            "timestamp": FRESH_BUILD_TIMESTAMP,
                        },
                        "name": "Release UI",
                        "property": [],
                        "triggers": [],
                        "builds": [
                            {
                                "building": False,
                                "duration": 121000,
                                "number": 5,
                                "result": "FAILURE",
                                "timestamp": FRESH_BUILD_TIMESTAMP,
                                "url": f"{JENKINS_BASE_URL}/{PROD_FE_PATH}/job/Release%20UI/5/",
                            }
                        ],
                        "url": f"{JENKINS_BASE_URL}/{PROD_FE_PATH}/job/Release%20UI/",
                    }
                ],
                "lastBuild": None,
                "name": "PROD",
                "property": [],
                "triggers": [],
                "url": f"{JENKINS_BASE_URL}/{PROD_FE_PATH}/",
            },
        ]
    }


SCHEDULED_SCRIPT_BODY = f"Result: null\n{PIPELINE_PATH}\n{FE_PIPELINE_PATH}\n"


def build_transport(
    payloads_by_path: dict[str, dict[str, Any]],
    requests: list[tuple[str, str | None]],
    *,
    status_code: int = 200,
    raises: Exception | None = None,
    scheduled_body: str = SCHEDULED_SCRIPT_BODY,
    script_bodies: list[str] | None = None,
) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        requests.append((str(request.url), request.url.params.get("tree")))
        if raises is not None:
            raise raises
        if request.url.path.endswith("/crumbIssuer/api/json"):
            return httpx.Response(
                status_code=status_code,
                json={"crumb": "csrf-token", "crumbRequestField": "Jenkins-Crumb"},
                request=request,
            )
        if request.url.path.endswith("/scriptText"):
            if script_bodies is not None:
                script_bodies.append(parse_qs(request.content.decode("utf-8"))["script"][0])
            return httpx.Response(status_code=status_code, text=scheduled_body, request=request)
        payload = payloads_by_path.get(request.url.path.strip("/"))
        if payload is None:
            return httpx.Response(status_code=404, json={"detail": "Not found"}, request=request)
        return httpx.Response(status_code=status_code, json=payload, request=request)

    return httpx.MockTransport(handler)


def build_freeze_script_transport(
    script_bodies: list[str],
    *,
    script_status_code: int = 200,
    script_text: str,
) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/crumbIssuer/api/json"):
            return httpx.Response(
                status_code=200,
                json={"crumb": "csrf-token", "crumbRequestField": "Jenkins-Crumb"},
                request=request,
            )
        if request.url.path.endswith("/scriptText"):
            body = request.content.decode("utf-8")
            script_bodies.append(parse_qs(body)["script"][0])
            return httpx.Response(status_code=script_status_code, text=script_text, request=request)
        return httpx.Response(status_code=404, json={"detail": "Not found"}, request=request)

    return httpx.MockTransport(handler)


def build_resume_fallback_transport(
    requests: list[str],
    *,
    script_status_code: int = 403,
    enable_status_by_path: dict[str, int] | None = None,
    build_status_by_path: dict[str, int] | None = None,
    parameters_by_path: dict[str, list[dict[str, object]]] | None = None,
    pending_state_by_path: dict[str, dict[str, bool]] | None = None,
    captured_build_data: dict[str, dict[str, str]] | None = None,
) -> httpx.MockTransport:
    enable_statuses = enable_status_by_path or {}
    build_statuses = build_status_by_path or {}
    parameters = parameters_by_path or {}
    pending_states = pending_state_by_path or {}

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path.strip("/")
        requests.append(path)
        if path.endswith("crumbIssuer/api/json"):
            return httpx.Response(
                status_code=200,
                json={"crumb": "csrf-token", "crumbRequestField": "Jenkins-Crumb"},
                request=request,
            )
        if path.endswith("scriptText"):
            return httpx.Response(status_code=script_status_code, text="forbidden", request=request)
        if path.endswith("/lastBuild/api/json"):
            job_path = path.removesuffix("/lastBuild/api/json")
            if job_path not in parameters:
                return httpx.Response(status_code=404, request=request)
            return httpx.Response(
                status_code=200,
                json={"actions": [{"parameters": parameters[job_path]}]},
                request=request,
            )
        if path.endswith("/api/json"):
            job_path = path.removesuffix("/api/json")
            pending_state = pending_states.get(job_path, {})
            return httpx.Response(
                status_code=200,
                json={
                    "building": pending_state.get("building", False),
                    "inQueue": pending_state.get("inQueue", False),
                    "lastBuild": {"building": pending_state.get("lastBuildBuilding", False)},
                },
                request=request,
            )
        if path.endswith("/enable"):
            job_path = path.removesuffix("/enable")
            return httpx.Response(
                status_code=enable_statuses.get(job_path, 200),
                request=request,
            )
        if path.endswith("/buildWithParameters"):
            job_path = path.removesuffix("/buildWithParameters")
            if captured_build_data is not None:
                captured_build_data[job_path] = dict(parse_qsl(request.content.decode()))
            return httpx.Response(
                status_code=build_statuses.get(job_path, 201),
                request=request,
            )
        if path.endswith("/build"):
            job_path = path.removesuffix("/build")
            return httpx.Response(
                status_code=build_statuses.get(job_path, 201),
                request=request,
            )
        return httpx.Response(status_code=404, request=request)

    return httpx.MockTransport(handler)


def build_freeze_fallback_transport(
    requests: list[str],
    *,
    script_status_code: int = 403,
) -> httpx.MockTransport:
    tree_payload = {
        "_class": "com.cloudbees.hudson.plugins.folder.Folder",
        "jobs": [
            {
                "_class": "org.jenkinsci.plugins.workflow.job.WorkflowJob",
                "disabled": False,
                "lastBuild": {"building": True},
                "name": "Smoke",
                "property": [],
                "triggers": [],
                "url": f"{JENKINS_BASE_URL}/{PIPELINE_PATH}/",
            }
        ],
        "url": f"{JENKINS_BASE_URL}/{PREPROD_BE_PATH}/",
    }

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path.strip("/")
        requests.append(path)
        if path.endswith("crumbIssuer/api/json"):
            return httpx.Response(
                status_code=200,
                json={"crumb": "csrf-token", "crumbRequestField": "Jenkins-Crumb"},
                request=request,
            )
        if path.endswith("scriptText"):
            return httpx.Response(status_code=script_status_code, text="forbidden", request=request)
        if path.endswith("/api/json"):
            # Real Jenkins only returns the `jobs` sub-tree when the tree expression
            # explicitly asks for it; a folder query without `jobs[...]` yields no
            # children. Mirror that so the fallback must request children correctly.
            requested_tree = request.url.params.get("tree", "")
            if "jobs[" not in requested_tree:
                folder_only = {key: value for key, value in tree_payload.items() if key != "jobs"}
                return httpx.Response(status_code=200, json=folder_only, request=request)
            return httpx.Response(status_code=200, json=tree_payload, request=request)
        if path.endswith("/lastBuild/stop") or path.endswith("/disable"):
            return httpx.Response(status_code=200, request=request)
        return httpx.Response(status_code=404, request=request)

    return httpx.MockTransport(handler)


def build_resume_campaign_backend_transport(
    run_id: str,
    progress_updates: list[dict[str, Any]],
    *,
    cancel_after_path: str | None = None,
    restart_pipelines: bool = True,
) -> httpx.MockTransport:
    current_status = JenkinsResumeRunStatus.RUNNING
    started_count = 0
    finished_at: str | None = None

    def run_payload() -> dict[str, Any]:
        return {
            "id": run_id,
            "freezeId": str(uuid4()),
            "restartPipelines": restart_pipelines,
            "signature": "scope-jenkins",
            "status": current_status.value,
            "total": 2,
            "startedCount": started_count,
            "skippedCount": 1,
            "errorCount": 0,
            "currentPath": None,
            "currentName": None,
            "items": [],
            "createdBy": "test",
            "createdAt": datetime.now(tz=UTC).isoformat(),
            "cancelledBy": "admin" if current_status is JenkinsResumeRunStatus.CANCELLED else None,
            "finishedAt": finished_at,
            "stale": False,
        }

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal current_status, started_count, finished_at
        path = request.url.path
        if path.endswith(f"/api/v1/jenkins/resume-runs/{run_id}"):
            return httpx.Response(status_code=200, json=run_payload(), request=request)
        if path.endswith(f"/api/v1/jenkins/resume-runs/{run_id}/progress"):
            payload = json.loads(request.content.decode("utf-8"))
            progress_updates.append(payload)
            if payload["state"] == "started":
                started_count += 1
            if cancel_after_path and payload["path"] == cancel_after_path:
                current_status = JenkinsResumeRunStatus.CANCELLED
                finished_at = datetime.now(tz=UTC).isoformat()
            return httpx.Response(status_code=200, json=run_payload(), request=request)
        return httpx.Response(status_code=404, json={"detail": "Not found"}, request=request)

    return httpx.MockTransport(handler)


async def test_fetch_tree_groups_envs_into_synthetic_roots_with_real_be_fe_children() -> None:
    settings = build_settings()
    requests: list[tuple[str, str | None]] = []
    roots = await fetch_tree(
        settings,
        transport=build_transport(
            {
                f"{JENKINS_BE_ROOT_PATH}/api/json": build_be_tree_payload(),
                f"{JENKINS_FE_ROOT_PATH}/api/json": build_fe_tree_payload(),
            },
            requests,
        ),
    )

    assert [root.name for root in roots] == ["PREPROD", "PROD"]
    assert all(root.kind.value == "folder" for root in roots)
    assert all(root.synthetic is True for root in roots)
    assert all(root.path == "" and root.url == "" for root in roots)
    assert roots[0].builds == []
    assert [child.name for child in roots[0].children] == ["BE", "FE"]
    assert [child.path for child in roots[0].children] == [PREPROD_BE_PATH, PREPROD_FE_PATH]
    assert roots[0].children[0].children[0].name == "Smoke"
    assert roots[0].children[0].children[0].kind.value == "pipeline"
    assert roots[0].children[0].children[0].status == JenkinsStatus.PASSED
    assert roots[0].children[0].children[0].scheduled is True
    assert roots[0].children[0].children[1].children[0].scheduled is True
    assert roots[0].children[1].children[0].name == "Visual"
    assert roots[0].children[1].children[0].scheduled is True
    assert len(roots[0].children[0].children[0].builds) == 2
    assert roots[0].children[0].children[0].builds[0].number == 42
    assert roots[0].children[0].children[0].builds[0].allure_url.endswith("/42/allure/")
    assert roots[0].children[0].children[1].children[0].status == JenkinsStatus.FAILED
    assert roots[0].children[0].children[1].children[0].builds[0].number == 7
    assert [child.name for child in roots[1].children] == ["BE", "FE"]
    assert roots[1].children[0].children[0].status == JenkinsStatus.RUNNING
    assert roots[1].children[0].children[0].builds[0].number == 9
    assert roots[1].children[1].children[0].status == JenkinsStatus.FAILED
    assert roots[1].children[1].children[0].builds[0].number == 5
    tree_requests = [request for request in requests if request[1] is not None]
    assert len(tree_requests) == 2
    assert any(
        request[0].startswith(f"{JENKINS_BASE_URL}/{JENKINS_BE_ROOT_PATH}/api/json")
        for request in tree_requests
    )
    assert any(
        request[0].startswith(f"{JENKINS_BASE_URL}/{JENKINS_FE_ROOT_PATH}/api/json")
        for request in tree_requests
    )
    assert all(
        request[1] is not None and request[1].startswith("jobs[name,url,_class,color,buildable")
        for request in tree_requests
    )
    assert all(
        request[1] is not None
        and "builds[number,result,building,timestamp,duration,url]{0,8}" in request[1]
        for request in tree_requests
    )
    assert sum(1 for request in requests if request[0].endswith("/scriptText")) == 1


def test_build_settings_defaults_root_groups_and_folders() -> None:
    settings = build_settings()

    assert [(group.label, group.path) for group in settings.jenkins_root_groups] == [
        ("BE", JENKINS_BE_ROOT_PATH),
        ("FE", JENKINS_FE_ROOT_PATH),
    ]
    assert list(DEFAULT_JENKINS_ROOT_GROUPS) == [
        f"BE={JENKINS_BE_ROOT_PATH}",
        f"FE={JENKINS_FE_ROOT_PATH}",
    ]
    assert settings.jenkins_root_folders == list(DEFAULT_JENKINS_ROOT_FOLDERS)


def test_build_settings_parses_root_groups_from_csv() -> None:
    settings = build_settings(root_groups=f"FE={JENKINS_FE_ROOT_PATH},BE={JENKINS_BE_ROOT_PATH}")

    assert [(group.label, group.path) for group in settings.jenkins_root_groups] == [
        ("FE", JENKINS_FE_ROOT_PATH),
        ("BE", JENKINS_BE_ROOT_PATH),
    ]


def test_build_settings_parses_root_folders_from_csv() -> None:
    settings = build_settings(root_folders="PROD, PREPROD")

    assert settings.jenkins_root_folders == ["PROD", "PREPROD"]


async def test_fetch_tree_uses_custom_root_allow_list_order() -> None:
    settings = build_settings(root_folders="PROD,PREPROD")
    roots = await fetch_tree(
        settings,
        transport=build_transport(
            {
                f"{JENKINS_BE_ROOT_PATH}/api/json": build_be_tree_payload(),
                f"{JENKINS_FE_ROOT_PATH}/api/json": build_fe_tree_payload(),
            },
            [],
        ),
    )

    assert [root.name for root in roots] == ["PROD", "PREPROD"]


def test_map_build_maps_single_row() -> None:
    build = _map_build(
        {
            "building": True,
            "duration": 42000,
            "number": 101,
            "result": None,
            "timestamp": FRESH_BUILD_TIMESTAMP,
            "url": f"{JENKINS_BASE_URL}/{PIPELINE_PATH}/101/",
        }
    )

    assert build.model_dump(by_alias=True) == {
        "allureUrl": f"{JENKINS_BASE_URL}/{PIPELINE_PATH}/101/allure/",
        "building": True,
        "durationMs": 42000,
        "number": 101,
        "result": None,
        "timestamp": FRESH_BUILD_TIMESTAMP,
        "url": f"{JENKINS_BASE_URL}/{PIPELINE_PATH}/101/",
    }


def test_map_node_marks_scheduled_by_name_when_scan_and_json_are_empty() -> None:
    settings = build_settings()
    raw = {
        "_class": "org.jenkinsci.plugins.workflow.job.WorkflowJob",
        "color": "blue",
        "name": "Rare launched scheduled",
        "property": [],
        "triggers": [],
        "url": f"{JENKINS_BASE_URL}/{PREPROD_BE_PATH}/job/Rare%20launched%20scheduled/",
    }

    # No Script Console hit, no JSON trigger — only the "... scheduled" name marks it.
    assert _map_node(settings, raw, set()).scheduled is True

    plain = {**raw, "name": "Smoke", "url": f"{JENKINS_BASE_URL}/{PREPROD_BE_PATH}/job/Smoke/"}
    assert _map_node(settings, plain, set()).scheduled is False


def test_derive_status_covers_each_bucket() -> None:
    settings = build_settings()

    assert derive_status({"color": "blue"}, settings) == JenkinsStatus.PASSED
    assert derive_status({"color": "red"}, settings) == JenkinsStatus.FAILED
    assert derive_status({"color": "yellow"}, settings) == JenkinsStatus.FAILED
    assert (
        derive_status({"color": "disabled", "disabled": True}, settings) == JenkinsStatus.DISABLED
    )
    assert derive_status({"color": "blue_anime"}, settings) == JenkinsStatus.RUNNING
    assert derive_status({"color": "notbuilt"}, settings) == JenkinsStatus.NOTBUILT

    stuck_raw = {
        "buildable": True,
        "color": "blue",
        "disabled": False,
        "inQueue": False,
        "lastBuild": {"building": False, "timestamp": OLD_BUILD_TIMESTAMP},
        "property": [],
        "triggers": [],
    }
    assert derive_status(stuck_raw, settings) == JenkinsStatus.STUCK

    timer_raw = {
        **stuck_raw,
        "triggers": [{"_class": "hudson.triggers.TimerTrigger", "spec": "H 4 * * *"}],
    }
    assert derive_status(timer_raw, settings) == JenkinsStatus.PASSED

    fresh_raw = {
        **stuck_raw,
        "lastBuild": {"building": False, "timestamp": FRESH_BUILD_TIMESTAMP},
    }
    assert derive_status(fresh_raw, settings) == JenkinsStatus.PASSED


async def test_fetch_builds_parses_allure_urls_and_running_builds() -> None:
    settings = build_settings()
    requests: list[tuple[str, str | None]] = []
    builds = await fetch_builds(
        settings,
        PIPELINE_PATH,
        transport=build_transport(
            {
                f"{PIPELINE_PATH}/api/json": {
                    "builds": [
                        {
                            "building": True,
                            "duration": 42000,
                            "number": 101,
                            "result": None,
                            "timestamp": FRESH_BUILD_TIMESTAMP,
                            "url": f"{JENKINS_BASE_URL}/{PIPELINE_PATH}/101/",
                        }
                    ]
                }
            },
            requests,
        ),
    )

    assert [build.model_dump(by_alias=True) for build in builds] == [
        {
            "allureUrl": f"{JENKINS_BASE_URL}/{PIPELINE_PATH}/101/allure/",
            "building": True,
            "durationMs": 42000,
            "number": 101,
            "result": None,
            "timestamp": FRESH_BUILD_TIMESTAMP,
            "url": f"{JENKINS_BASE_URL}/{PIPELINE_PATH}/101/",
        }
    ]
    assert requests[0][1] == "builds[number,result,building,timestamp,duration,url]{0,15}"


def test_jenkins_scope_signature_is_stable_and_changes_with_scope() -> None:
    settings = build_settings()

    assert jenkins_scope_signature(settings) == jenkins_scope_signature(build_settings())
    assert jenkins_scope_signature(settings) != jenkins_scope_signature(
        build_settings(root_groups=f"BE={JENKINS_BE_ROOT_PATH}")
    )
    assert jenkins_scope_signature(settings) != jenkins_scope_signature(
        build_settings(history_limit=9)
    )
    assert jenkins_scope_signature(settings) != jenkins_scope_signature(
        build_settings(tree_depth=6)
    )
    assert jenkins_scope_signature(settings) != jenkins_scope_signature(
        build_settings(root_folders="PROD")
    )


def test_validate_job_path_accepts_only_allowed_root_scope() -> None:
    settings = build_settings()

    assert validate_job_path(settings, f"/{PIPELINE_PATH}/") == PIPELINE_PATH
    assert validate_job_path(settings, f"/{FE_PIPELINE_PATH}/") == FE_PIPELINE_PATH

    with pytest.raises(
        JenkinsPathOutOfScopeError,
        match=ErrorMessage.JENKINS_PATH_OUT_OF_SCOPE.value,
    ):
        validate_job_path(settings, CUSTOM_PIPELINE_PATH)

    with pytest.raises(
        JenkinsPathOutOfScopeError,
        match=ErrorMessage.JENKINS_PATH_OUT_OF_SCOPE.value,
    ):
        validate_job_path(settings, OUT_OF_SCOPE_PATH)

    with pytest.raises(
        JenkinsPathOutOfScopeError,
        match=ErrorMessage.JENKINS_PATH_OUT_OF_SCOPE.value,
    ):
        validate_job_path(settings, f"{JENKINS_BASE_URL}/{PIPELINE_PATH}")

    with pytest.raises(
        JenkinsPathOutOfScopeError,
        match=ErrorMessage.JENKINS_PATH_OUT_OF_SCOPE.value,
    ):
        validate_job_path(settings, f"{PIPELINE_PATH}/../escape")


async def test_fetch_tree_raises_unreachable_on_http_failure() -> None:
    settings = build_settings()
    with pytest.raises(JenkinsUnreachableError, match=ErrorMessage.JENKINS_UNREACHABLE.value):
        await fetch_tree(
            settings,
            transport=build_transport(
                {
                    f"{JENKINS_BE_ROOT_PATH}/api/json": build_be_tree_payload(),
                    f"{JENKINS_FE_ROOT_PATH}/api/json": build_fe_tree_payload(),
                },
                [],
                status_code=500,
            ),
        )


async def test_fetch_scheduled_paths_matches_jobs_under_both_group_prefixes() -> None:
    settings = build_settings()
    requests: list[tuple[str, str | None]] = []
    script_bodies: list[str] = []

    paths = await fetch_scheduled_paths(
        settings,
        transport=build_transport({}, requests, script_bodies=script_bodies),
    )

    assert paths == {PIPELINE_PATH, FE_PIPELINE_PATH}
    assert len(script_bodies) == 1
    expected_prefixes = json.dumps(
        [".QAA/E2E/", ".QAA/UI_E2E/"],
        separators=(",", ":"),
    )
    assert base64.b64encode(expected_prefixes.encode("utf-8")).decode("ascii") in script_bodies[0]


async def test_freeze_folder_builds_fullname_prefix_and_parses_snapshot() -> None:
    settings = build_settings()
    scripts: list[str] = []

    snapshot = await freeze_folder(
        settings,
        PREPROD_BE_PATH,
        kill_builds=False,
        transport=build_freeze_script_transport(
            scripts,
            script_text=(
                "Result: null\n"
                '[{"path":"job/.QAA/job/E2E/job/PREPROD/job/Smoke",'
                '"fullName":".QAA/E2E/PREPROD/Smoke",'
                '"name":"Smoke",'
                '"wasDisabled":false,'
                '"scheduled":true,'
                '"wasBuilding":true}]\n'
            ),
        ),
    )

    assert len(snapshot) == 1
    assert snapshot[0].full_name == ".QAA/E2E/PREPROD/Smoke"
    assert snapshot[0].scheduled is True
    assert "def killBuilds = false" in scripts[0]
    assert base64.b64encode(b".QAA/E2E/PREPROD/").decode("ascii") in scripts[0]


async def test_freeze_folder_decodes_urlencoded_folder_names_in_fullname_prefix() -> None:
    settings = build_settings()
    scripts: list[str] = []
    portal_path = f"{PREPROD_FE_PATH}/job/IAM/job/IAM%20Client%20portal"

    await freeze_folder(
        settings,
        portal_path,
        kill_builds=False,
        transport=build_freeze_script_transport(
            scripts,
            script_text=(
                "Result: null\n"
                "[{"
                "\"path\":\"job/.QAA/job/UI_E2E/job/PREPROD/job/IAM/job/"
                "IAM Client portal/job/Web\","
                "\"fullName\":\".QAA/UI_E2E/PREPROD/IAM/IAM Client portal/Web\","
                "\"name\":\"Web\","
                "\"wasDisabled\":false,"
                "\"scheduled\":false,"
                "\"wasBuilding\":false}]\n"
            ),
        ),
    )

    expected_prefix = ".QAA/UI_E2E/PREPROD/IAM/IAM Client portal/"
    assert base64.b64encode(expected_prefix.encode("utf-8")).decode("ascii") in scripts[0]


async def test_freeze_folder_falls_back_to_rest_when_groovy_returns_empty_snapshot() -> None:
    settings = build_settings()
    requests: list[str] = []
    portal_path = f"{PREPROD_FE_PATH}/job/IAM/job/IAM%20Client%20portal"
    pipeline_path = f"{portal_path}/job/Web"
    tree_payload = {
        "_class": "com.cloudbees.hudson.plugins.folder.Folder",
        "jobs": [
            {
                "_class": "org.jenkinsci.plugins.workflow.job.WorkflowJob",
                "disabled": False,
                "lastBuild": {"building": False},
                "name": "Web",
                "property": [],
                "triggers": [],
                "url": f"{JENKINS_BASE_URL}/{pipeline_path}/",
            }
        ],
        "url": f"{JENKINS_BASE_URL}/{portal_path}/",
    }

    def handler(request: httpx.Request) -> httpx.Response:
        request_path = request.url.path.strip("/")
        requests.append(request_path)
        if request_path.endswith("crumbIssuer/api/json"):
            return httpx.Response(
                status_code=200,
                json={"crumb": "csrf-token", "crumbRequestField": "Jenkins-Crumb"},
                request=request,
            )
        if request_path.endswith("scriptText"):
            return httpx.Response(status_code=200, text="Result: null\n[]\n", request=request)
        if request_path.endswith("/api/json"):
            requested_tree = request.url.params.get("tree", "")
            if "jobs[" not in requested_tree:
                folder_only = {key: value for key, value in tree_payload.items() if key != "jobs"}
                return httpx.Response(status_code=200, json=folder_only, request=request)
            return httpx.Response(status_code=200, json=tree_payload, request=request)
        if request_path.endswith("/disable"):
            return httpx.Response(status_code=200, request=request)
        return httpx.Response(status_code=404, request=request)

    snapshot = await freeze_folder(
        settings,
        portal_path,
        kill_builds=False,
        transport=httpx.MockTransport(handler),
    )

    assert len(snapshot) == 1
    assert snapshot[0].path == pipeline_path
    assert snapshot[0].full_name == ".QAA/UI_E2E/PREPROD/IAM/IAM Client portal/Web"
    assert any(path.endswith("/disable") for path in requests)


async def test_freeze_folder_rest_fallback_decodes_urlencoded_snapshot_full_names() -> None:
    settings = build_settings()
    requests: list[str] = []
    portal_path = f"{PREPROD_FE_PATH}/job/IAM/job/IAM%20Client%20portal"
    pipeline_path = f"{portal_path}/job/Web"
    tree_payload = {
        "_class": "com.cloudbees.hudson.plugins.folder.Folder",
        "jobs": [
            {
                "_class": "org.jenkinsci.plugins.workflow.job.WorkflowJob",
                "disabled": False,
                "lastBuild": {"building": False},
                "name": "Web",
                "property": [],
                "triggers": [],
                "url": f"{JENKINS_BASE_URL}/{pipeline_path}/",
            }
        ],
        "url": f"{JENKINS_BASE_URL}/{portal_path}/",
    }

    def handler(request: httpx.Request) -> httpx.Response:
        request_path = request.url.path.strip("/")
        requests.append(request_path)
        if request_path.endswith("crumbIssuer/api/json"):
            return httpx.Response(
                status_code=200,
                json={"crumb": "csrf-token", "crumbRequestField": "Jenkins-Crumb"},
                request=request,
            )
        if request_path.endswith("scriptText"):
            return httpx.Response(status_code=403, text="forbidden", request=request)
        if request_path.endswith("/api/json"):
            requested_tree = request.url.params.get("tree", "")
            if "jobs[" not in requested_tree:
                folder_only = {key: value for key, value in tree_payload.items() if key != "jobs"}
                return httpx.Response(status_code=200, json=folder_only, request=request)
            return httpx.Response(status_code=200, json=tree_payload, request=request)
        if request_path.endswith("/disable"):
            return httpx.Response(status_code=200, request=request)
        return httpx.Response(status_code=404, request=request)

    snapshot = await freeze_folder(
        settings,
        portal_path,
        kill_builds=False,
        transport=httpx.MockTransport(handler),
    )

    assert len(snapshot) == 1
    assert snapshot[0].path == pipeline_path
    assert snapshot[0].full_name == ".QAA/UI_E2E/PREPROD/IAM/IAM Client portal/Web"
    assert any(path.endswith("/disable") for path in requests)


async def test_freeze_folder_kill_builds_toggles_abort_branch() -> None:
    settings = build_settings()
    scripts: list[str] = []

    await freeze_folder(
        settings,
        PREPROD_BE_PATH,
        kill_builds=True,
        transport=build_freeze_script_transport(
            scripts,
            script_text=(
                "Result: null\n"
                "[{\"path\":\"job/.QAA/job/E2E/job/PREPROD/job/Smoke\","
                "\"fullName\":\".QAA/E2E/PREPROD/Smoke\","
                "\"name\":\"Smoke\","
                "\"wasDisabled\":false,"
                "\"scheduled\":false,"
                "\"wasBuilding\":false}]\n"
            ),
        ),
    )

    assert "def killBuilds = true" in scripts[0]
    assert "it.doStop()" in scripts[0]


async def test_resume_folder_filters_disabled_items_and_skips_build_for_scheduled_jobs() -> None:
    settings = build_settings()
    requests: list[str] = []

    outcomes = await resume_folder(
        settings,
        [
            JenkinsFreezeSnapshotItem(
                path=PIPELINE_PATH,
                full_name=".QAA/E2E/PREPROD/Smoke",
                name="Smoke",
                was_disabled=False,
                scheduled=True,
                was_building=False,
            ),
            JenkinsFreezeSnapshotItem(
                path=f"{PREPROD_BE_PATH}/job/Disabled",
                full_name=".QAA/E2E/PREPROD/Disabled",
                name="Disabled",
                was_disabled=True,
                scheduled=False,
                was_building=False,
            ),
        ],
        transport=build_resume_fallback_transport(requests),
    )

    assert [outcome.outcome.value for outcome in outcomes] == ["enabled"]
    assert any(path.endswith("/enable") for path in requests)
    assert not any(path.endswith("/build") for path in requests)
    assert not any("Disabled/enable" in path for path in requests)


async def test_resume_folder_reports_missing_jobs_without_raising() -> None:
    settings = build_settings()

    outcomes = await resume_folder(
        settings,
        [
            JenkinsFreezeSnapshotItem(
                path=PIPELINE_PATH,
                full_name=".QAA/E2E/PREPROD/Smoke",
                name="Smoke",
                was_disabled=False,
                scheduled=False,
                was_building=False,
            )
        ],
        transport=build_resume_fallback_transport(
            [],
            enable_status_by_path={PIPELINE_PATH: 404},
        ),
    )

    assert len(outcomes) == 1
    assert outcomes[0].outcome.value == "missing"


async def test_resume_folder_skips_manual_build_when_pipeline_was_running_at_freeze() -> None:
    settings = build_settings()
    requests: list[str] = []

    outcomes = await resume_folder(
        settings,
        [
            JenkinsFreezeSnapshotItem(
                path=PIPELINE_PATH,
                full_name=".QAA/E2E/PREPROD/Smoke",
                name="Smoke",
                was_disabled=False,
                scheduled=False,
                was_building=True,
            )
        ],
        transport=build_resume_fallback_transport(requests),
    )

    assert [outcome.outcome.value for outcome in outcomes] == ["enabled"]
    assert any(path.endswith("/enable") for path in requests)
    assert not any(path.endswith("/build") for path in requests)
    assert not any(path.endswith("/buildWithParameters") for path in requests)
    assert not any(path == f"{PIPELINE_PATH}/api/json" for path in requests)


async def test_resume_folder_skips_manual_build_when_pipeline_is_already_queued() -> None:
    settings = build_settings()
    requests: list[str] = []

    outcomes = await resume_folder(
        settings,
        [
            JenkinsFreezeSnapshotItem(
                path=PIPELINE_PATH,
                full_name=".QAA/E2E/PREPROD/Smoke",
                name="Smoke",
                was_disabled=False,
                scheduled=False,
                was_building=False,
            )
        ],
        transport=build_resume_fallback_transport(
            requests,
            pending_state_by_path={PIPELINE_PATH: {"inQueue": True}},
        ),
    )

    assert [outcome.outcome.value for outcome in outcomes] == ["enabled"]
    assert any(path.endswith(f"{PIPELINE_PATH}/api/json") for path in requests)
    assert not any(path.endswith("/lastBuild/api/json") for path in requests)
    assert not any(path.endswith("/build") for path in requests)
    assert not any(path.endswith("/buildWithParameters") for path in requests)


async def test_resume_folder_rest_rebuilds_with_last_build_parameters() -> None:
    settings = build_settings()
    requests: list[str] = []
    captured_build_data: dict[str, dict[str, str]] = {}

    outcomes = await resume_folder(
        settings,
        [
            JenkinsFreezeSnapshotItem(
                path=PIPELINE_PATH,
                full_name=".QAA/E2E/PREPROD/Smoke",
                name="Smoke",
                was_disabled=False,
                scheduled=False,
                was_building=False,
            )
        ],
        transport=build_resume_fallback_transport(
            requests,
            parameters_by_path={
                PIPELINE_PATH: [
                    {"name": "BRANCH", "value": "main"},
                    {"name": "DRY_RUN", "value": True},
                ]
            },
            captured_build_data=captured_build_data,
        ),
    )

    assert [outcome.outcome.value for outcome in outcomes] == ["restored"]
    # The most recent build's parameters are replayed via buildWithParameters.
    assert any(path.endswith("/buildWithParameters") for path in requests)
    assert not any(path.endswith("/build") for path in requests)
    assert captured_build_data[PIPELINE_PATH] == {"BRANCH": "main", "DRY_RUN": "true"}


def test_resume_groovy_script_replays_last_build_parameters() -> None:
    # Guard the Groovy resume branch: it must re-run with the last build's parameters.
    assert "getLastBuild()" in RESUME_SCRIPT_TEMPLATE
    assert "hudson.model.ParametersAction" in RESUME_SCRIPT_TEMPLATE


def test_resume_groovy_script_skips_manual_build_for_running_or_queued_jobs() -> None:
    assert "item.wasBuilding" in RESUME_SCRIPT_TEMPLATE
    assert "job.isBuilding()" in RESUME_SCRIPT_TEMPLATE
    assert "job.isInQueue()" in RESUME_SCRIPT_TEMPLATE


async def test_freeze_folder_uses_rest_fallback_when_script_console_fails() -> None:
    settings = build_settings()
    requests: list[str] = []

    snapshot = await freeze_folder(
        settings,
        PREPROD_BE_PATH,
        kill_builds=True,
        transport=build_freeze_fallback_transport(requests),
    )

    assert len(snapshot) == 1
    assert any(path.endswith("scriptText") for path in requests)
    assert any(path.endswith(f"{PREPROD_BE_PATH}/api/json") for path in requests)
    assert any(path.endswith("/lastBuild/stop") for path in requests)
    assert any(path.endswith("/disable") for path in requests)


async def test_jenkins_routes_report_503_502_400_and_401(
    backend_recorder: BackendRecorder,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    not_configured_app = create_app(
        build_settings(token=""),
        backend_transport=backend_recorder.build_transport(),
    )
    async with not_configured_app.router.lifespan_context(not_configured_app):
        transport = httpx.ASGITransport(app=not_configured_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            not_configured_response = await client.get("/jenkins/tree", headers=auth_headers)
            scope_response = await client.get("/jenkins/scope", headers=auth_headers)
            unauthorized_response = await client.get("/jenkins/tree")

    configured_app = create_app(
        build_settings(),
        backend_transport=backend_recorder.build_transport(),
    )

    async def raise_unreachable(settings: Settings) -> list[Any]:
        raise JenkinsUnreachableError(ErrorMessage.JENKINS_UNREACHABLE.value)

    monkeypatch.setattr(api_routes, "fetch_tree", raise_unreachable)
    async with configured_app.router.lifespan_context(configured_app):
        transport = httpx.ASGITransport(app=configured_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            unreachable_response = await client.get("/jenkins/tree", headers=auth_headers)
            bad_path_response = await client.get(
                "/jenkins/builds",
                headers=auth_headers,
                params={"path": CUSTOM_PIPELINE_PATH},
            )

    assert not_configured_response.status_code == 503
    assert scope_response.status_code == 200
    assert scope_response.json()["historyLimit"] == 8
    assert not_configured_response.json()["detail"] == ErrorMessage.JENKINS_NOT_CONFIGURED.value
    assert unauthorized_response.status_code == 401
    assert unreachable_response.status_code == 502
    assert unreachable_response.json()["detail"] == ErrorMessage.JENKINS_UNREACHABLE.value
    assert bad_path_response.status_code == 400
    assert bad_path_response.json()["detail"] == ErrorMessage.JENKINS_PATH_OUT_OF_SCOPE.value


async def test_run_resume_campaign_starts_items_in_order_reports_progress_and_replays_parameters(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = build_settings()
    run_id = uuid4()
    requests: list[str] = []
    progress_updates: list[dict[str, Any]] = []
    captured_build_data: dict[str, dict[str, str]] = {}
    sleep_calls: list[float] = []

    async def fake_sleep(delay: float) -> None:
        sleep_calls.append(delay)

    monkeypatch.setattr("app.services.jenkins.asyncio.sleep", fake_sleep)
    backend_transport = build_resume_campaign_backend_transport(str(run_id), progress_updates)
    jenkins_transport = build_resume_fallback_transport(
        requests,
        parameters_by_path={
            PIPELINE_PATH: [{"name": "BRANCH", "value": "main"}],
        },
        captured_build_data=captured_build_data,
    )

    async with httpx.AsyncClient(
        base_url="http://backend.test",
        transport=backend_transport,
    ) as backend_client:
        await run_resume_campaign(
            settings,
            run_id,
            "valid-token",
            [
                JenkinsFreezeSnapshotItem(
                    path=PIPELINE_PATH,
                    full_name=".QAA/E2E/PREPROD/Smoke",
                    name="Smoke",
                    was_disabled=False,
                    scheduled=False,
                    was_building=False,
                ),
                JenkinsFreezeSnapshotItem(
                    path=f"{PREPROD_BE_PATH}/job/Deploy",
                    full_name=".QAA/E2E/PREPROD/Deploy",
                    name="Deploy",
                    was_disabled=False,
                    scheduled=False,
                    was_building=False,
                ),
                JenkinsFreezeSnapshotItem(
                    path=f"{PREPROD_BE_PATH}/job/Disabled",
                    full_name=".QAA/E2E/PREPROD/Disabled",
                    name="Disabled",
                    was_disabled=True,
                    scheduled=False,
                    was_building=False,
                ),
            ],
            backend_client=backend_client,
            transport=jenkins_transport,
        )

    # Pause only *between* the two restorable pipelines, not after the last one.
    assert sleep_calls == [settings.jenkins_resume_pause_seconds]
    assert requests == [
        "crumbIssuer/api/json",
        f"{PIPELINE_PATH}/enable",
        f"{PIPELINE_PATH}/api/json",
        f"{PIPELINE_PATH}/lastBuild/api/json",
        f"{PIPELINE_PATH}/buildWithParameters",
        f"{PREPROD_BE_PATH}/job/Deploy/enable",
        f"{PREPROD_BE_PATH}/job/Deploy/api/json",
        f"{PREPROD_BE_PATH}/job/Deploy/lastBuild/api/json",
        f"{PREPROD_BE_PATH}/job/Deploy/build",
    ]
    assert captured_build_data[PIPELINE_PATH] == {"BRANCH": "main"}
    assert progress_updates == [
        {
            "nextName": "Deploy",
            "nextPath": f"{PREPROD_BE_PATH}/job/Deploy",
            "path": PIPELINE_PATH,
            "reason": None,
            "state": "started",
        },
        {
            "nextName": None,
            "nextPath": None,
            "path": f"{PREPROD_BE_PATH}/job/Deploy",
            "reason": None,
            "state": "started",
        },
    ]


async def test_run_resume_campaign_does_not_restart_pipelines_when_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = build_settings()
    run_id = uuid4()
    requests: list[str] = []
    progress_updates: list[dict[str, Any]] = []
    sleep_calls: list[float] = []

    async def fake_sleep(delay: float) -> None:
        sleep_calls.append(delay)

    monkeypatch.setattr("app.services.jenkins.asyncio.sleep", fake_sleep)
    backend_transport = build_resume_campaign_backend_transport(
        str(run_id),
        progress_updates,
        restart_pipelines=False,
    )
    jenkins_transport = build_resume_fallback_transport(requests)

    async with httpx.AsyncClient(
        base_url="http://backend.test",
        transport=backend_transport,
    ) as backend_client:
        await run_resume_campaign(
            settings,
            run_id,
            "valid-token",
            [
                JenkinsFreezeSnapshotItem(
                    path=PIPELINE_PATH,
                    full_name=".QAA/E2E/PREPROD/Smoke",
                    name="Smoke",
                    was_disabled=False,
                    scheduled=False,
                    was_building=False,
                ),
                JenkinsFreezeSnapshotItem(
                    path=f"{PREPROD_BE_PATH}/job/Deploy",
                    full_name=".QAA/E2E/PREPROD/Deploy",
                    name="Deploy",
                    was_disabled=False,
                    scheduled=False,
                    was_building=False,
                ),
            ],
            restart_pipelines=False,
            backend_client=backend_client,
            transport=jenkins_transport,
        )

    assert sleep_calls == [settings.jenkins_resume_pause_seconds]
    assert requests == [
        "crumbIssuer/api/json",
        f"{PIPELINE_PATH}/enable",
        f"{PREPROD_BE_PATH}/job/Deploy/enable",
    ]
    assert progress_updates == [
        {
            "nextName": "Deploy",
            "nextPath": f"{PREPROD_BE_PATH}/job/Deploy",
            "path": PIPELINE_PATH,
            "reason": None,
            "state": "started",
        },
        {
            "nextName": None,
            "nextPath": None,
            "path": f"{PREPROD_BE_PATH}/job/Deploy",
            "reason": None,
            "state": "started",
        },
    ]


async def test_run_resume_campaign_stops_early_when_backend_reports_cancelled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = build_settings()
    run_id = uuid4()
    requests: list[str] = []
    progress_updates: list[dict[str, Any]] = []
    sleep_calls: list[float] = []

    async def fake_sleep(delay: float) -> None:
        sleep_calls.append(delay)

    monkeypatch.setattr("app.services.jenkins.asyncio.sleep", fake_sleep)
    backend_transport = build_resume_campaign_backend_transport(
        str(run_id),
        progress_updates,
        cancel_after_path=PIPELINE_PATH,
    )
    jenkins_transport = build_resume_fallback_transport(requests)

    async with httpx.AsyncClient(
        base_url="http://backend.test",
        transport=backend_transport,
    ) as backend_client:
        await run_resume_campaign(
            settings,
            run_id,
            "valid-token",
            [
                JenkinsFreezeSnapshotItem(
                    path=PIPELINE_PATH,
                    full_name=".QAA/E2E/PREPROD/Smoke",
                    name="Smoke",
                    was_disabled=False,
                    scheduled=False,
                    was_building=False,
                ),
                JenkinsFreezeSnapshotItem(
                    path=f"{PREPROD_BE_PATH}/job/Deploy",
                    full_name=".QAA/E2E/PREPROD/Deploy",
                    name="Deploy",
                    was_disabled=False,
                    scheduled=False,
                    was_building=False,
                ),
            ],
            backend_client=backend_client,
            transport=jenkins_transport,
        )

    assert progress_updates[0]["path"] == PIPELINE_PATH
    assert f"{PREPROD_BE_PATH}/job/Deploy/enable" not in requests
    assert sleep_calls == []
