from __future__ import annotations

import asyncio
from typing import Any, cast

import httpx
import pytest
from conftest import BackendRecorder, parse_sse_events

DEPLOY_BODY = {
    "ns": "qaa-demo",
    "services": ["iam-api", "billing"],
    "images": {"billing": "0.881.1"},
    "flags": {"full": True, "dryRun": False, "noSync": True, "stage": 4},
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
    assert [event for event, _ in events[:-1]] == ["log", "log", "log", "log"]
    assert events[-1] == ("terminal", {"type": "terminal", "status": "success", "exitCode": 0})

    assert len(backend_recorder.operations) == 2
    assert (
        backend_recorder.operations[0]["id"]
        == backend_recorder.operations[1]["id"]
        == created["opId"]
    )
    assert backend_recorder.operations[0]["status"] == "running"
    assert backend_recorder.operations[1]["status"] == "success"
    assert backend_recorder.operations[1]["recipe"]["flags"] == {
        "full": True,
        "dryRun": False,
        "noSync": True,
        "stage": 4,
    }


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
