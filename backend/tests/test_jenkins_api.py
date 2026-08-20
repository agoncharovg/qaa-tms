from __future__ import annotations

from fastapi.testclient import TestClient
from test_users import auth_header, login

from app.api.v1.jenkins import _clamp_folder_ttl
from app.core.constants import (
    JENKINS_FOLDER_CACHE_MAX_TTL_SECONDS,
    JENKINS_FOLDER_CACHE_MIN_TTL_SECONDS,
)


def test_jenkins_cache_routes_require_authentication(client: TestClient) -> None:
    response = client.get("/api/v1/jenkins/tree", params={"signature": "scope-1"})

    assert response.status_code == 401


def test_jenkins_folder_cache_route_requires_authentication(client: TestClient) -> None:
    response = client.get(
        "/api/v1/jenkins/folder",
        params={
            "path": "job/.QAA/job/E2E/job/PREPROD/job/SMOKE",
            "signature": "scope-1",
            "ttl_seconds": 60,
        },
    )

    assert response.status_code == 401


def test_clamp_folder_ttl_bounds_out_of_range_values() -> None:
    assert _clamp_folder_ttl(0) == JENKINS_FOLDER_CACHE_MIN_TTL_SECONDS
    assert _clamp_folder_ttl(1) == JENKINS_FOLDER_CACHE_MIN_TTL_SECONDS
    assert _clamp_folder_ttl(60) == 60
    assert _clamp_folder_ttl(10_000) == JENKINS_FOLDER_CACHE_MAX_TTL_SECONDS


def test_jenkins_folder_cache_round_trip_returns_fresh_snapshot(client: TestClient) -> None:
    token, _ = login(client, "test", "")
    path = "job/.QAA/job/E2E/job/PREPROD/job/SMOKE"

    initial_response = client.get(
        "/api/v1/jenkins/folder",
        headers=auth_header(token),
        params={"path": path, "signature": "scope-1", "ttl_seconds": 60},
    )
    put_response = client.put(
        "/api/v1/jenkins/folder",
        headers=auth_header(token),
        json={
            "path": path,
            "signature": "scope-1",
            "roots": [
                {
                    "builds": [
                        {
                            "allureUrl": "https://jenkins.example/build/7/allure/",
                            "building": False,
                            "durationMs": 60000,
                            "number": 7,
                            "result": "SUCCESS",
                            "timestamp": 1720000000000,
                            "url": "https://jenkins.example/build/7/",
                        }
                    ],
                    "children": [],
                    "color": "blue",
                    "kind": "pipeline",
                    "name": "Billing",
                    "path": f"{path}/job/Billing",
                    "status": "passed",
                    "synthetic": False,
                    "url": f"https://jenkins.example/{path}/job/Billing/",
                }
            ],
            "refreshLease": initial_response.json()["refreshLease"],
        },
    )
    final_response = client.get(
        "/api/v1/jenkins/folder",
        headers=auth_header(token),
        params={"path": path, "signature": "scope-1", "ttl_seconds": 60},
    )

    assert initial_response.status_code == 200
    assert initial_response.json()["stale"] is True
    assert initial_response.json()["refreshLease"] is not None

    assert put_response.status_code == 200
    put_body = put_response.json()
    assert put_body["stale"] is False
    assert put_body["refreshLease"] is None
    assert put_body["fetchedAt"] is not None
    assert put_body["roots"][0]["name"] == "Billing"
    assert put_body["roots"][0]["builds"][0]["number"] == 7

    assert final_response.status_code == 200
    final_body = final_response.json()
    assert final_body["stale"] is False
    assert final_body["refreshLease"] is None
    assert final_body["roots"][0]["path"] == f"{path}/job/Billing"


def test_jenkins_tree_cache_round_trip_returns_fresh_snapshot(client: TestClient) -> None:
    token, _ = login(client, "test", "")

    initial_response = client.get(
        "/api/v1/jenkins/tree",
        headers=auth_header(token),
        params={"signature": "scope-1"},
    )
    put_response = client.put(
        "/api/v1/jenkins/tree",
        headers=auth_header(token),
        json={
            "signature": "scope-1",
            "roots": [
                {
                    "builds": [],
                    "children": [
                        {
                            "builds": [],
                            "children": [
                                {
                                    "builds": [
                                        {
                                            "allureUrl": "https://jenkins.example/build/42/allure/",
                                            "building": False,
                                            "durationMs": 120000,
                                            "number": 42,
                                            "result": "SUCCESS",
                                            "timestamp": 1720000000000,
                                            "url": "https://jenkins.example/build/42/",
                                        }
                                    ],
                                    "children": [],
                                    "color": "blue",
                                    "kind": "pipeline",
                                    "name": "Smoke",
                                    "path": "job/.QAA/job/E2E/job/PREPROD/job/Smoke",
                                    "status": "passed",
                                    "synthetic": False,
                                    "url": "https://jenkins.example/job/.QAA/job/E2E/job/PREPROD/job/Smoke/",
                                }
                            ],
                            "color": None,
                            "kind": "folder",
                            "name": "BE",
                            "path": "job/.QAA/job/E2E/job/PREPROD",
                            "status": None,
                            "synthetic": False,
                            "url": "https://jenkins.example/job/.QAA/job/E2E/job/PREPROD/",
                        }
                    ],
                    "color": None,
                    "kind": "folder",
                    "name": "PREPROD",
                    "path": "",
                    "status": None,
                    "synthetic": True,
                    "url": "",
                }
            ],
            "refreshLease": initial_response.json()["refreshLease"],
        },
    )
    final_response = client.get(
        "/api/v1/jenkins/tree",
        headers=auth_header(token),
        params={"signature": "scope-1"},
    )

    assert initial_response.status_code == 200
    assert initial_response.json()["stale"] is True
    assert initial_response.json()["refreshLease"] is not None

    assert put_response.status_code == 200
    put_body = put_response.json()
    assert put_body["stale"] is False
    assert put_body["refreshLease"] is None
    assert put_body["fetchedAt"] is not None
    assert put_body["roots"][0]["synthetic"] is True
    assert put_body["roots"][0]["children"][0]["path"] == "job/.QAA/job/E2E/job/PREPROD"
    assert put_body["roots"][0]["children"][0]["children"][0]["builds"][0]["number"] == 42

    assert final_response.status_code == 200
    final_body = final_response.json()
    assert final_body["stale"] is False
    assert final_body["refreshLease"] is None
    assert final_body["roots"][0]["synthetic"] is True
    assert final_body["roots"][0]["children"][0]["path"] == "job/.QAA/job/E2E/job/PREPROD"
    assert final_body["roots"][0]["children"][0]["children"][0]["builds"][0]["allureUrl"].endswith(
        "/allure/"
    )
