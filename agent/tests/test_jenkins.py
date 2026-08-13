from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from conftest import BackendRecorder

from app.api import routes as api_routes
from app.core.config import Settings
from app.core.constants import DEFAULT_JENKINS_ROOT_FOLDERS, ErrorMessage, JenkinsStatus
from app.main import create_app
from app.services.jenkins import (
    JenkinsPathOutOfScopeError,
    JenkinsUnreachableError,
    derive_status,
    fetch_builds,
    fetch_tree,
    validate_job_path,
)

JENKINS_BASE_URL = "https://jenkins.p.gc.onl"
JENKINS_ROOT_PATH = "job/.QAA/job/E2E"
CUSTOM_PATH = f"{JENKINS_ROOT_PATH}/job/CUSTOM"
PREPROD_PATH = f"{JENKINS_ROOT_PATH}/job/PREPROD"
PROD_PATH = f"{JENKINS_ROOT_PATH}/job/PROD"
STAGING_PATH = f"{JENKINS_ROOT_PATH}/job/STAGING"
PIPELINE_PATH = f"{PREPROD_PATH}/job/Smoke"
CUSTOM_PIPELINE_PATH = f"{CUSTOM_PATH}/job/Smoke"
OUT_OF_SCOPE_PATH = "job/.QAA/job/UI_E2E/job/Smoke"
OLD_BUILD_TIMESTAMP = int((datetime.now(UTC) - timedelta(hours=12)).timestamp() * 1000)
FRESH_BUILD_TIMESTAMP = int((datetime.now(UTC) - timedelta(hours=1)).timestamp() * 1000)


def build_settings(
    *,
    token: str = "jenkins-token",
    root_folders: str | list[str] | None = None,
) -> Settings:
    settings_kwargs: dict[str, Any] = {
        "AGENT_HOST": "127.0.0.1",
        "AGENT_PORT": 47600,
        "AGENT_BACKEND_URL": "http://backend.test",
        "AGENT_CORS_ORIGINS": "http://localhost:3000,http://127.0.0.1:3000",
        "AGENT_JENKINS_URL": JENKINS_BASE_URL,
        "AGENT_JENKINS_USERNAME": "engineer",
        "AGENT_JENKINS_TOKEN": token,
        "AGENT_JENKINS_ROOT_PATH": JENKINS_ROOT_PATH,
        "AGENT_JENKINS_TREE_DEPTH": 5,
        "AGENT_JENKINS_REQUEST_TIMEOUT": 15.0,
        "AGENT_JENKINS_STUCK_MIN_IDLE_HOURS": 6,
    }
    if root_folders is not None:
        settings_kwargs["AGENT_JENKINS_ROOT_FOLDERS"] = root_folders
    return Settings(**settings_kwargs)


def build_tree_payload() -> dict[str, Any]:
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
                        "triggers": [
                            {"_class": "hudson.triggers.TimerTrigger", "spec": "H 1 * * *"}
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
                                "url": (
                                    f"{JENKINS_BASE_URL}/{PREPROD_PATH}/job/NestedFolder/job/Nested/"
                                ),
                            }
                        ],
                        "lastBuild": None,
                        "name": "NestedFolder",
                        "property": [],
                        "triggers": [],
                        "url": f"{JENKINS_BASE_URL}/{PREPROD_PATH}/job/NestedFolder/",
                    },
                ],
                "lastBuild": None,
                "name": "PREPROD",
                "property": [],
                "triggers": [],
                "url": f"{JENKINS_BASE_URL}/{PREPROD_PATH}/",
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
                        "name": "Release",
                        "property": [],
                        "triggers": [],
                        "url": f"{JENKINS_BASE_URL}/{PROD_PATH}/job/Release/",
                    }
                ],
                "lastBuild": None,
                "name": "PROD",
                "property": [],
                "triggers": [],
                "url": f"{JENKINS_BASE_URL}/{PROD_PATH}/",
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


def build_transport(
    payload: dict[str, Any],
    requests: list[tuple[str, str | None]],
    *,
    status_code: int = 200,
    raises: Exception | None = None,
) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        requests.append((str(request.url), request.url.params.get("tree")))
        if raises is not None:
            raise raises
        return httpx.Response(status_code=status_code, json=payload, request=request)

    return httpx.MockTransport(handler)


async def test_fetch_tree_filters_to_default_roots_in_configured_order() -> None:
    settings = build_settings()
    requests: list[tuple[str, str | None]] = []
    roots = await fetch_tree(
        settings,
        transport=build_transport(build_tree_payload(), requests),
    )

    assert [root.name for root in roots] == ["PREPROD", "PROD"]
    assert roots[0].kind.value == "folder"
    assert roots[0].path == PREPROD_PATH
    assert roots[0].children[0].name == "Smoke"
    assert roots[0].children[0].kind.value == "pipeline"
    assert roots[0].children[0].status == JenkinsStatus.PASSED
    assert roots[0].children[1].children[0].status == JenkinsStatus.FAILED
    assert roots[1].children[0].status == JenkinsStatus.RUNNING
    assert requests[0][0].startswith(f"{JENKINS_BASE_URL}/{JENKINS_ROOT_PATH}/api/json")
    assert requests[0][1] is not None
    assert requests[0][1].startswith("jobs[name,url,_class,color,buildable")


def test_build_settings_defaults_root_folders() -> None:
    settings = build_settings()

    assert settings.jenkins_root_folders == list(DEFAULT_JENKINS_ROOT_FOLDERS)


def test_build_settings_parses_root_folders_from_csv() -> None:
    settings = build_settings(root_folders="PROD, PREPROD")

    assert settings.jenkins_root_folders == ["PROD", "PREPROD"]


async def test_fetch_tree_uses_custom_root_allow_list_order() -> None:
    settings = build_settings(root_folders="PROD,PREPROD")
    roots = await fetch_tree(
        settings,
        transport=build_transport(build_tree_payload(), []),
    )

    assert [root.name for root in roots] == ["PROD", "PREPROD"]


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


def test_validate_job_path_accepts_only_allowed_root_scope() -> None:
    settings = build_settings()

    assert validate_job_path(settings, f"/{PIPELINE_PATH}/") == PIPELINE_PATH

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
            transport=build_transport(build_tree_payload(), [], status_code=500),
        )


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
    assert not_configured_response.json()["detail"] == ErrorMessage.JENKINS_NOT_CONFIGURED.value
    assert unauthorized_response.status_code == 401
    assert unreachable_response.status_code == 502
    assert unreachable_response.json()["detail"] == ErrorMessage.JENKINS_UNREACHABLE.value
    assert bad_path_response.status_code == 400
    assert bad_path_response.json()["detail"] == ErrorMessage.JENKINS_PATH_OUT_OF_SCOPE.value
