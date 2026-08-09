from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx
import pytest
from conftest import BackendRecorder, parse_sse_events

from app.core.config import Settings
from app.main import create_app
from app.services import namespaces as namespaces_service
from app.services.namespaces import PlainTextCommandResult, stream_namespace_logs


class FakeStdout:
    def __init__(self, process: FakeProcess, lines: list[bytes]) -> None:
        self._process = process
        self._lines = list(lines)

    async def readline(self) -> bytes:
        if self._lines:
            return self._lines.pop(0)
        self._process.returncode = self._process.exit_code
        return b""


class FakeProcess:
    def __init__(self, lines: list[bytes], *, exit_code: int) -> None:
        self.exit_code = exit_code
        self.pid = 12345
        self.returncode: int | None = None
        self.stdout = FakeStdout(self, lines)

    async def wait(self) -> int:
        if self.returncode is None:
            self.returncode = self.exit_code
        return self.returncode


async def test_list_namespaces_returns_raw_and_best_effort_parse(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    backend_recorder: BackendRecorder,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_run(argv: list[str], repo_root: Path | None) -> PlainTextCommandResult:
        assert argv[-1] == "list"
        assert repo_root is not None
        return PlainTextCommandResult(
            raw=(
                "Namespace\tOverlay\n"
                "qa-demo\t~/Projects/qaa-stagings/overlays/qa-demo\n"
                "qa-other\t~/Projects/qaa-stagings/overlays/qa-other\n"
            ),
            exit_code=0,
        )

    monkeypatch.setattr(namespaces_service, "run_plain_text_command", fake_run)

    missing = await client.get("/namespaces")
    assert missing.status_code == 401

    response = await client.get("/namespaces", headers=auth_headers)

    assert response.status_code == 200
    assert response.json() == {
        "raw": (
            "Namespace\tOverlay\n"
            "qa-demo\t~/Projects/qaa-stagings/overlays/qa-demo\n"
            "qa-other\t~/Projects/qaa-stagings/overlays/qa-other\n"
        ),
        "namespaces": ["qa-demo", "qa-other"],
        "exitCode": 0,
    }
    assert backend_recorder.operations == []


@pytest.mark.parametrize(
    ("path", "expected_raw"),
    [
        ("/namespaces/qa-demo/status", "pod/iam-api-123 Running\n"),
        ("/namespaces/qa-demo/creds", "sysadmin: ********\nreseller: ********\n"),
    ],
)
async def test_namespace_read_endpoints_return_captured_text(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    backend_recorder: BackendRecorder,
    monkeypatch: pytest.MonkeyPatch,
    path: str,
    expected_raw: str,
) -> None:
    async def fake_run(argv: list[str], repo_root: Path | None) -> PlainTextCommandResult:
        assert repo_root is not None
        return PlainTextCommandResult(raw=expected_raw, exit_code=4)

    monkeypatch.setattr(namespaces_service, "run_plain_text_command", fake_run)

    response = await client.get(path, headers=auth_headers)

    assert response.status_code == 200
    assert response.json() == {
        "ns": "qa-demo",
        "raw": expected_raw,
        "exitCode": 4,
    }
    assert backend_recorder.operations == []


async def test_namespace_logs_stream_uses_job_sse_frame_format(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    backend_recorder: BackendRecorder,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_spawn(argv: list[str], repo_root: Path | None) -> FakeProcess:
        assert argv[-3:] == ["logs", "qa-demo", "iam-api"]
        assert repo_root is not None
        return FakeProcess([b"line one\n", b"line two\n"], exit_code=0)

    monkeypatch.setattr(namespaces_service, "spawn_namespaces_process", fake_spawn)

    response = await client.get("/namespaces/qa-demo/logs?deploy=iam-api", headers=auth_headers)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert parse_sse_events(response.text) == [
        ("log", {"type": "line", "line": "line one"}),
        ("log", {"type": "line", "line": "line two"}),
        ("terminal", {"type": "terminal", "status": "success", "exitCode": 0}),
    ]
    assert backend_recorder.operations == []


async def test_namespace_logs_terminates_process_on_disconnect(
    app: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    terminated: list[FakeProcess] = []

    async def fake_spawn(argv: list[str], repo_root: Path | None) -> FakeProcess:
        assert argv[-3:] == ["logs", "qa-demo", "iam-api"]
        assert repo_root is not None
        return FakeProcess([], exit_code=0)

    async def fake_terminate(process: FakeProcess) -> None:
        terminated.append(process)
        process.returncode = 143

    async def disconnected() -> bool:
        return True

    monkeypatch.setattr(namespaces_service, "spawn_namespaces_process", fake_spawn)
    monkeypatch.setattr(namespaces_service, "terminate_process", fake_terminate)

    stream = stream_namespace_logs(
        app.state.settings,
        "qa-demo",
        "iam-api",
        is_disconnected=disconnected,
    )
    events = [event async for event in stream]

    assert events == []
    assert len(terminated) == 1


@pytest.mark.parametrize(
    "path",
    [
        "/namespaces",
        "/namespaces/qa-demo/status",
        "/namespaces/qa-demo/creds",
        "/namespaces/qa-demo/logs?deploy=iam-api",
    ],
)
async def test_namespaces_routes_return_503_when_staging_is_absent(
    backend_recorder: BackendRecorder,
    auth_headers: dict[str, str],
    path: str,
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
            response = await client.get(path, headers=auth_headers)

    assert response.status_code == 503
    assert response.json() == {"detail": "The staging binary is not installed."}
