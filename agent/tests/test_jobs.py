from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, cast

import httpx
import pytest
from conftest import BackendRecorder, parse_sse_events

from app.core.config import Settings
from app.main import create_app

DEPLOY_BODY = {
    "ns": "qaa-demo",
    "services": ["iam-api", "billing"],
    "images": {"billing": "0.881.1"},
    "flags": {"clean": True, "full": True, "dryRun": False, "noSync": True, "stage": 4},
}
DESTROY_BODY = {"ns": "qaa-demo"}
ADOPT_BODY = {"ns": "qaa-demo"}
SYNC_BODY = {
    "flags": {
        "service": "iam-api",
        "verbose": True,
        "pull": True,
        "apply": False,
    }
}


async def _wait_for_status(
    client: httpx.AsyncClient,
    job_id: str,
    headers: dict[str, str],
    expected: str,
) -> dict[str, Any]:
    for _ in range(50):
        response = await client.get(f"/jobs/{job_id}", headers=headers)
        assert response.status_code == 200
        payload = cast(dict[str, Any], response.json())
        if payload["status"] == expected:
            return payload
        await asyncio.sleep(0.05)
    pytest.fail(f"Job {job_id} did not reach status {expected}.")


def _assert_recorded_operation(
    backend_recorder: BackendRecorder,
    *,
    created: dict[str, Any],
    expected_type: str,
    expected_ns: str | None,
    expected_recipe: dict[str, Any],
) -> None:
    assert len(backend_recorder.operations) == 2
    assert (
        backend_recorder.operations[0]["id"]
        == backend_recorder.operations[1]["id"]
        == created["opId"]
    )
    assert backend_recorder.operations[0]["status"] == "running"
    assert backend_recorder.operations[1]["status"] == "success"
    assert backend_recorder.operations[1]["type"] == expected_type
    assert backend_recorder.operations[1]["ns"] == expected_ns
    assert backend_recorder.operations[1]["recipe"] == expected_recipe


async def test_deploy_streams_buffered_output_and_success(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    backend_recorder: BackendRecorder,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FAKE_STAGING_MODE", "success")

    create_response = await client.post("/deploy", headers=auth_headers, json=DEPLOY_BODY)
    assert create_response.status_code == 202
    created = create_response.json()
    assert set(created) == {"jobId", "opId"}

    job = await _wait_for_status(client, created["jobId"], auth_headers, "success")
    stream_response = await client.get(f"/jobs/{created['jobId']}/stream", headers=auth_headers)
    events = parse_sse_events(stream_response.text)

    assert job["status"] == "success"
    assert "--clean" in job["argv"]
    assert [event for event, _ in events[:-1]] == ["log", "log", "log", "log"]
    assert events[-1] == ("terminal", {"type": "terminal", "status": "success", "exitCode": 0})

    _assert_recorded_operation(
        backend_recorder,
        created=created,
        expected_type="deploy",
        expected_ns="qaa-demo",
        expected_recipe={
            "services": ["iam-api", "billing"],
            "images": {"billing": "0.881.1"},
            "suites": [],
            "flags": {"clean": True, "full": True, "dryRun": False, "noSync": True, "stage": 4},
        },
    )


@pytest.mark.parametrize(
    ("path", "body", "expected_argv", "expected_type", "expected_ns", "expected_recipe"),
    [
        (
            "/destroy",
            DESTROY_BODY,
            ["destroy", "qaa-demo"],
            "destroy",
            "qaa-demo",
            {},
        ),
        (
            "/adopt",
            ADOPT_BODY,
            ["adopt", "qaa-demo"],
            "adopt",
            "qaa-demo",
            {},
        ),
        (
            "/sync",
            SYNC_BODY,
            ["sync", "--service", "iam-api", "--verbose", "--pull"],
            "sync",
            None,
            {"flags": {"service": "iam-api", "verbose": True, "pull": True, "apply": False}},
        ),
    ],
)
async def test_non_deploy_jobs_create_stream_and_record_operations(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    backend_recorder: BackendRecorder,
    monkeypatch: pytest.MonkeyPatch,
    path: str,
    body: dict[str, Any],
    expected_argv: list[str],
    expected_type: str,
    expected_ns: str | None,
    expected_recipe: dict[str, Any],
) -> None:
    monkeypatch.setenv("FAKE_STAGING_MODE", "success")

    create_response = await client.post(path, headers=auth_headers, json=body)
    assert create_response.status_code == 202
    created = create_response.json()
    assert set(created) == {"jobId", "opId"}

    job = await _wait_for_status(client, created["jobId"], auth_headers, "success")
    stream_response = await client.get(f"/jobs/{created['jobId']}/stream", headers=auth_headers)
    events = parse_sse_events(stream_response.text)

    assert job["status"] == "success"
    assert job["argv"][-len(expected_argv) :] == expected_argv
    assert events[-1] == ("terminal", {"type": "terminal", "status": "success", "exitCode": 0})

    _assert_recorded_operation(
        backend_recorder,
        created=created,
        expected_type=expected_type,
        expected_ns=expected_ns,
        expected_recipe=expected_recipe,
    )


async def test_deploy_failure_reports_failed_terminal_status(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FAKE_STAGING_MODE", "fail")

    create_response = await client.post("/deploy", headers=auth_headers, json=DEPLOY_BODY)
    created = create_response.json()

    await _wait_for_status(client, created["jobId"], auth_headers, "failed")
    stream_response = await client.get(f"/jobs/{created['jobId']}/stream", headers=auth_headers)
    events = parse_sse_events(stream_response.text)

    assert events[-1] == ("terminal", {"type": "terminal", "status": "failed", "exitCode": 7})


async def test_cancel_moves_running_job_to_aborted(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FAKE_STAGING_MODE", "sleep")

    create_response = await client.post("/deploy", headers=auth_headers, json=DEPLOY_BODY)
    created = create_response.json()

    await _wait_for_status(client, created["jobId"], auth_headers, "running")
    cancel_response = await client.post(f"/jobs/{created['jobId']}/cancel", headers=auth_headers)
    assert cancel_response.status_code == 200
    assert cancel_response.json()["status"] == "aborted"

    stream_response = await client.get(f"/jobs/{created['jobId']}/stream", headers=auth_headers)
    events = parse_sse_events(stream_response.text)
    assert events[-1][0] == "terminal"
    assert events[-1][1]["status"] == "aborted"


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/deploy", DEPLOY_BODY),
        ("/destroy", DESTROY_BODY),
        ("/adopt", ADOPT_BODY),
        ("/sync", SYNC_BODY),
    ],
)
async def test_job_creation_routes_require_bearer_auth(
    client: httpx.AsyncClient,
    path: str,
    body: dict[str, Any],
) -> None:
    response = await client.post(path, json=body)
    assert response.status_code == 401


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/deploy", DEPLOY_BODY),
        ("/destroy", DESTROY_BODY),
        ("/adopt", ADOPT_BODY),
        ("/sync", SYNC_BODY),
    ],
)
async def test_job_creation_routes_return_503_when_staging_is_absent(
    backend_recorder: BackendRecorder,
    auth_headers: dict[str, str],
    path: str,
    body: dict[str, Any],
    tmp_path: Path,
) -> None:
    settings = Settings(
        AGENT_HOST="127.0.0.1",
        AGENT_PORT=47600,
        AGENT_BACKEND_URL="http://backend.test",
        AGENT_CORS_ORIGINS="http://localhost:3000,http://127.0.0.1:3000",
        AGENT_STAGING_BIN=str(tmp_path / "missing-staging"),
    )
    application = create_app(settings, backend_transport=backend_recorder.build_transport())

    async with application.router.lifespan_context(application):
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.post(path, headers=auth_headers, json=body)

    assert response.status_code == 503
    assert response.json() == {"detail": "The staging binary is not installed."}
