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


async def test_list_namespaces_returns_structured_cluster_and_overlay_sections(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    backend_recorder: BackendRecorder,
    fake_staging_repo: dict[str, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    (fake_staging_repo["repo_root"] / "overlays" / "qaa-demo").mkdir(parents=True, exist_ok=True)

    raw_output = (
        "\x1b[32m[OK]\x1b[0m    Prerequisites OK\n"
        "\x1b[36m[INFO]\x1b[0m  Provisioned namespaces on frn-stg cluster:\n"
        "calico-system     Active   2026-02-11T11:49:58Z\n"
        "qaa-demo          Active   2026-08-07T15:17:19Z\n"
        "qaa-no-time       Pending\n"
        "\x1b[36m[INFO]\x1b[0m  Local overlay directories:\n"
        "  qaa-iam      (local only -- not on cluster)\n"
        "  qaa-billing  (local only -- not on cluster)\n"
    )

    async def fake_run(argv: list[str], repo_root: Path | None) -> PlainTextCommandResult:
        assert argv[-1] == "list"
        assert repo_root is not None
        return PlainTextCommandResult(raw=raw_output, exit_code=0)

    monkeypatch.setattr(namespaces_service, "run_plain_text_command", fake_run)

    missing = await client.get("/namespaces")
    assert missing.status_code == 401

    response = await client.get("/namespaces", headers=auth_headers)

    assert response.status_code == 200
    assert response.json() == {
        "raw": raw_output,
        "clusterNamespaces": [
            {"name": "calico-system", "status": "Active", "createdAt": "2026-02-11T11:49:58Z", "hasLocalOverlay": False},
            {"name": "qaa-demo", "status": "Active", "createdAt": "2026-08-07T15:17:19Z", "hasLocalOverlay": True},
            {"name": "qaa-no-time", "status": "Pending", "createdAt": None, "hasLocalOverlay": False},
        ],
        "localOverlays": [
            {"name": "qaa-iam"},
            {"name": "qaa-billing"},
        ],
        "exitCode": 0,
    }
    assert all(row["name"] != "qaa-iam" for row in response.json()["clusterNamespaces"])
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


async def test_namespace_deploy_recipe_reads_latest_supported_overlay_log(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    backend_recorder: BackendRecorder,
    fake_staging_repo: dict[str, Path],
) -> None:
    overlay_dir = fake_staging_repo["repo_root"] / "overlays" / "qaa-iam"
    overlay_dir.mkdir(parents=True, exist_ok=True)
    (overlay_dir / "deploy-20260810-120000.log").write_text(
        "Command: /tmp/qaa-stagings/scripts/deploy.py qaa-iam --services iam-api --step add_sellers\n",
        encoding="utf-8",
    )
    (overlay_dir / "deploy-20260809-110000.log").write_text(
        "Command: /tmp/qaa-stagings/scripts/deploy.py qaa-iam --services iam-api,billing --image iam-api=sha-local --image billing=sha-billing --clean --full --no-sync --stage 3\n",
        encoding="utf-8",
    )

    response = await client.get("/namespaces/qaa-iam/deploy-recipe", headers=auth_headers)

    assert response.status_code == 200
    assert response.json() == {
        "ns": "qaa-iam",
        "recipe": {
            "product": None,
            "services": ["iam-api", "billing"],
            "images": {
                "iam-api": "sha-local",
                "billing": "sha-billing",
            },
            "suites": [],
            "flags": {
                "clean": True,
                "full": True,
                "dryRun": False,
                "noSync": True,
                "stage": 3,
            },
        },
    }
    assert backend_recorder.operations == []


@pytest.mark.parametrize(
    "path",
    [
        "/namespaces",
        "/namespaces/qa-demo/status",
        "/namespaces/qa-demo/creds",
        "/namespaces/qa-demo/deploy-recipe",
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
