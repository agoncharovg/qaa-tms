from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, cast

import httpx
import pytest
from conftest import BackendRecorder, parse_sse_events

from app.core.config import Settings
from app.main import create_app
from app.services import e2e as e2e_service
from app.services.namespaces import PlainTextCommandResult

E2E_RUN_BODY = {
    "ns": "qaa-demo",
    "product": "IAM",
    "suites": ["smoke", "full"],
    "image": "latest",
    "mark": "auth and not slow",
    "marks": "product_iam and smoke",
    "threads": 9,
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


async def test_get_e2e_suites_parses_registry_output(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    backend_recorder: BackendRecorder,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    raw_output = (
        "Suites for IAM:\n"
        "  smoke             product_iam and smoke and not long_term\n"
        "  full              backend_test and product_iam and not long_term\n"
    )

    async def fake_run(argv: list[str], repo_root: Path | None) -> PlainTextCommandResult:
        assert argv[-4:] == ["qaa-placeholder", "--product", "IAM", "--list-suites"]
        assert repo_root is not None
        return PlainTextCommandResult(raw=raw_output, exit_code=0)

    monkeypatch.setattr(e2e_service, "run_plain_text_command", fake_run)

    response = await client.get("/e2e/suites?product=IAM", headers=auth_headers)

    assert response.status_code == 200
    assert response.json() == {
        "product": "IAM",
        "suites": [
            {"name": "smoke", "marks": "product_iam and smoke and not long_term"},
            {"name": "full", "marks": "backend_test and product_iam and not long_term"},
        ],
        "exitCode": 0,
    }
    assert backend_recorder.operations == []


async def test_get_e2e_suites_rejects_invalid_product(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    response = await client.get("/e2e/suites?product=Unknown", headers=auth_headers)

    assert response.status_code == 422


async def test_e2e_run_creates_job_and_records_operation(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    backend_recorder: BackendRecorder,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FAKE_STAGING_MODE", "success")

    create_response = await client.post("/e2e-run", headers=auth_headers, json=E2E_RUN_BODY)
    assert create_response.status_code == 202
    created = create_response.json()
    assert set(created) == {"jobId", "opId"}

    job = await _wait_for_status(client, created["jobId"], auth_headers, "success")
    stream_response = await client.get(f"/jobs/{created['jobId']}/stream", headers=auth_headers)
    events = parse_sse_events(stream_response.text)

    assert job["argv"][-14:] == [
        "e2e-run",
        "qaa-demo",
        "--product",
        "IAM",
        "--suite",
        "smoke,full",
        "--image",
        "latest",
        "--mark",
        "auth and not slow",
        "--marks",
        "product_iam and smoke",
        "--threads",
        "9",
    ]
    assert events[-1] == ("terminal", {"type": "terminal", "status": "success", "exitCode": 0})
    assert len(backend_recorder.operations) == 2
    assert backend_recorder.operations[1]["type"] == "e2e_run"
    assert backend_recorder.operations[1]["ns"] == "qaa-demo"
    assert backend_recorder.operations[1]["recipe"] == {
        "product": "IAM",
        "suites": ["smoke", "full"],
        "flags": {
            "image": "latest",
            "mark": "auth and not slow",
            "marks": "product_iam and smoke",
            "threads": 9,
        },
    }


@pytest.mark.parametrize("path", ["/e2e/suites?product=IAM", "/e2e-run"])
async def test_e2e_routes_require_bearer_auth(
    client: httpx.AsyncClient,
    path: str,
) -> None:
    if path == "/e2e-run":
        response = await client.post(path, json=E2E_RUN_BODY)
    else:
        response = await client.get(path)
    assert response.status_code == 401


@pytest.mark.parametrize("path", ["/e2e/suites?product=IAM", "/e2e-run"])
async def test_e2e_routes_return_503_when_staging_is_absent(
    backend_recorder: BackendRecorder,
    auth_headers: dict[str, str],
    path: str,
    tmp_path: Path,
) -> None:
    settings = Settings.model_validate(
        {
            "AGENT_HOST": "127.0.0.1",
            "AGENT_PORT": 47600,
            "AGENT_BACKEND_URL": "http://backend.test",
            "AGENT_CORS_ORIGINS": "http://localhost:3000,http://127.0.0.1:3000",
            "AGENT_STAGING_BIN": str(tmp_path / "missing-staging"),
        }
    )
    application = create_app(settings, backend_transport=backend_recorder.build_transport())

    async with application.router.lifespan_context(application):
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            if path == "/e2e-run":
                response = await client.post(path, headers=auth_headers, json=E2E_RUN_BODY)
            else:
                response = await client.get(path, headers=auth_headers)

    assert response.status_code == 503
    assert response.json() == {"detail": "The staging binary is not installed."}
