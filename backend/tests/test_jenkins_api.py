from __future__ import annotations

from fastapi.testclient import TestClient
from test_users import auth_header, login


def test_jenkins_cache_routes_require_authentication(client: TestClient) -> None:
    response = client.get("/api/v1/jenkins/tree", params={"signature": "scope-1"})

    assert response.status_code == 401


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
