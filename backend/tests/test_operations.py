from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi.testclient import TestClient

from app.core.constants import DevPassword, DevUsername, OperationStatus, OperationType, Product


def login(client: TestClient, username: str, password: str) -> tuple[str, dict[str, Any]]:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200
    body = response.json()
    return str(body["access_token"]), body["user"]


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_operation_create_uses_authenticated_user(client: TestClient) -> None:
    token, user = login(client, DevUsername.TEST.value, DevPassword.EMPTY.value)
    response = client.post(
        "/api/v1/operations",
        headers=auth_header(token),
        json={
            "type": OperationType.DEPLOY.value,
            "ns": "qa-iam-01",
            "recipe": {
                "product": Product.IAM.value,
                "services": ["api"],
                "images": {"api": "latest"},
                "suites": [],
                "flags": {"stage": "dev"},
            },
            "status": OperationStatus.RUNNING.value,
            "agent_host": "workstation-1",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["user_id"] == int(user["id"])
    assert body["type"] == OperationType.DEPLOY.value
    assert body["recipe"]["product"] == Product.IAM.value
    UUID(str(body["id"]))


def test_operation_replay_returns_recipe(client: TestClient) -> None:
    token, _ = login(client, DevUsername.TEST.value, DevPassword.EMPTY.value)
    create_response = client.post(
        "/api/v1/operations",
        headers=auth_header(token),
        json={
            "type": OperationType.E2E_RUN.value,
            "ns": "qa-billing-02",
            "recipe": {
                "product": Product.BILLING.value,
                "services": [],
                "images": {},
                "suites": ["smoke"],
                "flags": {"threads": 4},
            },
            "status": OperationStatus.SUCCESS.value,
            "log": "suite finished",
        },
    )
    operation_id = str(create_response.json()["id"])

    replay_response = client.get(
        f"/api/v1/operations/{operation_id}/replay",
        headers=auth_header(token),
    )

    assert replay_response.status_code == 200
    body = replay_response.json()
    assert body["id"] == operation_id
    assert body["type"] == OperationType.E2E_RUN.value
    assert body["recipe"]["product"] == Product.BILLING.value
    assert body["recipe"]["suites"] == ["smoke"]


def test_non_admin_operation_list_isolated_to_own_records(client: TestClient) -> None:
    test_token, test_user = login(client, DevUsername.TEST.value, DevPassword.EMPTY.value)
    admin_token, admin_user = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)
    admin_user_id = int(admin_user["id"])

    test_create = client.post(
        "/api/v1/operations",
        headers=auth_header(test_token),
        json={
            "type": OperationType.DEPLOY.value,
            "ns": "qa-test-own",
            "recipe": {"services": [], "images": {}, "suites": [], "flags": {}},
            "status": OperationStatus.QUEUED.value,
        },
    )
    assert test_create.status_code == 200

    admin_create = client.post(
        "/api/v1/operations",
        headers=auth_header(admin_token),
        json={
            "type": OperationType.DESTROY.value,
            "ns": "qa-admin-own",
            "recipe": {"services": [], "images": {}, "suites": [], "flags": {}},
            "status": OperationStatus.SUCCESS.value,
        },
    )
    assert admin_create.status_code == 200

    test_list = client.get("/api/v1/operations", headers=auth_header(test_token))
    assert test_list.status_code == 200
    test_items = test_list.json()["items"]
    assert len(test_items) == 1
    assert test_items[0]["user_id"] == int(test_user["id"])
    assert test_items[0]["ns"] == "qa-test-own"

    admin_list = client.get(
        f"/api/v1/operations?user_id={admin_user_id}",
        headers=auth_header(admin_token),
    )
    assert admin_list.status_code == 200
    admin_items = admin_list.json()["items"]
    assert len(admin_items) == 1
    assert admin_items[0]["user_id"] == admin_user_id


def test_operation_create_accepts_kube_exec_with_extra_recipe_fields(client: TestClient) -> None:
    token, _ = login(client, DevUsername.TEST.value, DevPassword.EMPTY.value)
    response = client.post(
        "/api/v1/operations",
        headers=auth_header(token),
        json={
            "type": OperationType.KUBE_EXEC.value,
            "ns": "qa-demo",
            "recipe": {
                "command": "echo hello",
                "container": "api",
                "context": "team/dev",
                "flags": {},
                "images": {},
                "pod": "iam-api-123",
                "services": [],
                "suites": [],
            },
            "status": OperationStatus.FAILED.value,
            "exit_code": 7,
            "log": "exec: echo hello\n",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["type"] == OperationType.KUBE_EXEC.value
    assert body["recipe"]["pod"] == "iam-api-123"
    assert body["recipe"]["command"] == "echo hello"
    assert body["exit_code"] == 7
