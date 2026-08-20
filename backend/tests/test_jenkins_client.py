from __future__ import annotations

import asyncio
import hashlib

import httpx
import pytest

from app.core.config import Settings
from app.services.jenkins_client import (
    JenkinsPathOutOfScopeError,
    fetch_builds,
    fetch_folder,
    fetch_tree,
    jenkins_scope_signature,
    validate_job_path,
)


def build_settings() -> Settings:
    return Settings(
        database_url="sqlite+aiosqlite:///jenkins-client.db",
        jwt_secret="test-secret",
        jenkins_common_username="common-user",
        jenkins_common_token="common-token",
    )


def test_jenkins_scope_signature_matches_agent_shape() -> None:
    settings = build_settings()
    expected_payload = (
        "['BE:job/.QAA/job/E2E', 'FE:job/.QAA/job/UI_E2E']|"
        "['PREPROD', 'PROD']|5|8"
    )
    expected_signature = hashlib.sha256(expected_payload.encode("utf-8")).hexdigest()[:16]

    assert jenkins_scope_signature(settings) == expected_signature


def test_validate_job_path_rejects_out_of_scope_path() -> None:
    settings = build_settings()

    with pytest.raises(JenkinsPathOutOfScopeError):
        validate_job_path(settings, "job/.QAA/job/Other/job/PREPROD")


def test_fetch_tree_composes_synthetic_env_roots_and_statuses() -> None:
    settings = build_settings()

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/job/.QAA/job/E2E/api/json"):
            return httpx.Response(
                200,
                json={
                    "jobs": [
                        {
                            "_class": "com.cloudbees.hudson.plugins.folder.Folder",
                            "jobs": [
                                {
                                    "_class": "org.jenkinsci.plugins.workflow.job.WorkflowJob",
                                    "buildable": True,
                                    "builds": [
                                        {
                                            "building": False,
                                            "duration": 120000,
                                            "number": 42,
                                            "result": "SUCCESS",
                                            "timestamp": 1720000000000,
                                            "url": "https://jenkins.example/job/.QAA/job/E2E/job/PREPROD/job/Smoke/42/",
                                        }
                                    ],
                                    "color": "blue",
                                    "disabled": False,
                                    "inQueue": False,
                                    "lastBuild": {
                                        "building": False,
                                        "result": "SUCCESS",
                                        "timestamp": 1720000000000,
                                    },
                                    "name": "Smoke",
                                    "property": [],
                                    "triggers": [
                                        {
                                            "_class": "hudson.triggers.TimerTrigger",
                                            "spec": "H/15 * * * *",
                                        }
                                    ],
                                    "url": "https://jenkins.example/job/.QAA/job/E2E/job/PREPROD/job/Smoke/",
                                }
                            ],
                            "name": "PREPROD",
                            "url": "https://jenkins.example/job/.QAA/job/E2E/job/PREPROD/",
                        }
                    ]
                },
            )
        if request.url.path.endswith("/job/.QAA/job/UI_E2E/api/json"):
            return httpx.Response(
                200,
                json={
                    "jobs": [
                        {
                            "_class": "com.cloudbees.hudson.plugins.folder.Folder",
                            "jobs": [],
                            "name": "PREPROD",
                            "url": "https://jenkins.example/job/.QAA/job/UI_E2E/job/PREPROD/",
                        }
                    ]
                },
            )
        return httpx.Response(404)

    roots = asyncio.run(fetch_tree(settings, transport=httpx.MockTransport(handler)))

    assert [root.name for root in roots] == ["PREPROD"]
    assert roots[0].synthetic is True
    assert [child.name for child in roots[0].children] == ["BE", "FE"]
    smoke = roots[0].children[0].children[0]
    assert smoke.path == "job/.QAA/job/E2E/job/PREPROD/job/Smoke"
    assert smoke.status == "passed"
    assert smoke.scheduled is True
    assert smoke.builds[0].allure_url.endswith("/allure/")


def test_fetch_builds_and_folder_parse_read_only_payloads() -> None:
    settings = build_settings()

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/job/.QAA/job/E2E/job/PREPROD/job/Smoke/api/json"):
            return httpx.Response(
                200,
                json={
                    "builds": [
                        {
                            "building": False,
                            "duration": 45000,
                            "number": 7,
                            "result": "FAILURE",
                            "timestamp": 1720000000007,
                            "url": "https://jenkins.example/job/.QAA/job/E2E/job/PREPROD/job/Smoke/7/",
                        }
                    ]
                },
            )
        if request.url.path.endswith("/job/.QAA/job/E2E/job/PREPROD/job/SMOKE/api/json"):
            return httpx.Response(
                200,
                json={
                    "jobs": [
                        {
                            "_class": "org.jenkinsci.plugins.workflow.job.WorkflowJob",
                            "buildable": True,
                            "builds": [
                                {
                                    "building": True,
                                    "duration": 15000,
                                    "number": 9,
                                    "result": None,
                                    "timestamp": 1720000000009,
                                    "url": "https://jenkins.example/job/.QAA/job/E2E/job/PREPROD/job/SMOKE/job/Billing/9/",
                                }
                            ],
                            "color": "blue_anime",
                            "disabled": False,
                            "inQueue": False,
                            "lastBuild": {
                                "building": True,
                                "result": None,
                                "timestamp": 1720000000009,
                            },
                            "name": "Billing",
                            "property": [],
                            "triggers": [],
                            "url": "https://jenkins.example/job/.QAA/job/E2E/job/PREPROD/job/SMOKE/job/Billing/",
                        }
                    ]
                },
            )
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    builds = asyncio.run(
        fetch_builds(
            settings,
            "job/.QAA/job/E2E/job/PREPROD/job/Smoke",
            transport=transport,
        )
    )
    roots = asyncio.run(
        fetch_folder(
            settings,
            "job/.QAA/job/E2E/job/PREPROD/job/SMOKE",
            transport=transport,
        )
    )

    assert [build.number for build in builds] == [7]
    assert builds[0].allure_url.endswith("/allure/")
    assert [root.name for root in roots] == ["Billing"]
    assert roots[0].status == "running"
    assert roots[0].builds[0].number == 9
