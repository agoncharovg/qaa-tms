"""Shared test fixtures."""

from __future__ import annotations

import json
import subprocess
import textwrap
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
import pytest
import pytest_asyncio

from app.core.config import Settings
from app.core.constants import BackendPath
from app.main import create_app

FAKE_STAGING_KUBECONFIG = textwrap.dedent(
    """\
    apiVersion: v1
    kind: Config
    current-context: staging
    clusters:
    - name: staging
      cluster:
        server: https://staging.example
    contexts:
    - name: staging
      context:
        cluster: staging
        user: staging-user
    users:
    - name: staging-user
      user:
        token: fake.token.value
    """
)


@dataclass(slots=True)
class BackendRecorder:
    """Stubbed backend transport state."""

    operations: list[dict[str, Any]] = field(default_factory=list)

    def build_transport(self) -> httpx.MockTransport:
        def handler(request: httpx.Request) -> httpx.Response:
            auth = request.headers.get("Authorization")
            if request.url.path == BackendPath.ME.value:
                if auth == "Bearer valid-token":
                    return httpx.Response(
                        status_code=200,
                        json={"id": 1, "username": "test", "display_name": "Test User"},
                    )
                return httpx.Response(status_code=401, json={"detail": "Unauthorized"})

            if request.url.path == BackendPath.OPERATIONS.value:
                payload = json.loads(request.content.decode("utf-8"))
                self.operations.append(payload)
                if auth == "Bearer valid-token":
                    return httpx.Response(status_code=200, json=payload)
                return httpx.Response(status_code=401, json={"detail": "Unauthorized"})

            return httpx.Response(status_code=404, json={"detail": "Not found"})

        return httpx.MockTransport(handler)


@pytest.fixture
def fake_staging_repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Path]:
    repo_root = tmp_path / "qaa-stagings"
    staging_bin = repo_root / "bin" / "staging"
    scripts_venv = repo_root / "scripts" / ".venv" / "bin"
    kubeconfig = tmp_path / ".kube" / "ai-staging.yaml"
    docker_config = tmp_path / ".docker" / "config.json"

    staging_bin.parent.mkdir(parents=True, exist_ok=True)
    scripts_venv.mkdir(parents=True, exist_ok=True)
    kubeconfig.parent.mkdir(parents=True, exist_ok=True)
    docker_config.parent.mkdir(parents=True, exist_ok=True)

    (repo_root / "README.md").write_text("fake repo\n", encoding="utf-8")
    (scripts_venv.parent.parent / "pyvenv.cfg").write_text("home = /tmp\n", encoding="utf-8")
    kubeconfig.write_text(FAKE_STAGING_KUBECONFIG, encoding="utf-8")
    docker_config.write_text(
        json.dumps(
            {
                "auths": {
                    "harbor.p.gc.onl": {"auth": "Zm9vOmJhcg=="},
                    "registry.frn-stg.p.gc.onl:8443": {"auth": "YmF6OnF1eA=="},
                }
            }
        ),
        encoding="utf-8",
    )
    staging_bin.write_text(
        textwrap.dedent(
            """\
            #!/usr/bin/env python3
            import os
            import sys
            import time

            def main() -> int:
                args = sys.argv[1:]
                if not args:
                    print("unsupported invocation", file=sys.stderr, flush=True)
                    return 2

                command = args[0]
                if command == "e2e-run" and "--list-suites" in args:
                    product = args[args.index("--product") + 1]
                    print(f"Suites for {product}:", flush=True)
                    print("  smoke             product_iam and smoke and not long_term", flush=True)
                    print(
                        "  full              backend_test and product_iam and not long_term",
                        flush=True,
                    )
                    return 0

                if command not in {"deploy", "destroy", "adopt", "sync", "e2e-run"}:
                    print("unsupported invocation", file=sys.stderr, flush=True)
                    return 2

                mode = os.environ.get("FAKE_STAGING_MODE", "success")
                print(f"starting {command}", flush=True)
                print("argv: " + " ".join(args), flush=True)
                print("stderr: merged output", file=sys.stderr, flush=True)
                if mode == "sleep":
                    time.sleep(30)
                    return 0
                if mode == "fail":
                    print(f"{command} failed", flush=True)
                    return 7
                print(f"{command} complete", flush=True)
                return 0

            raise SystemExit(main())
            """
        ),
        encoding="utf-8",
    )
    staging_bin.chmod(0o755)

    subprocess.run(["git", "init"], cwd=repo_root, check=True, capture_output=True)
    subprocess.run(
        ["git", "config", "user.email", "test@example.com"],
        cwd=repo_root,
        check=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "Test User"],
        cwd=repo_root,
        check=True,
    )
    subprocess.run(["git", "add", "."], cwd=repo_root, check=True)
    subprocess.run(["git", "commit", "-m", "init"], cwd=repo_root, check=True, capture_output=True)

    monkeypatch.setenv("STAGING_KUBECONFIG", str(kubeconfig))
    monkeypatch.setenv("HOME", str(tmp_path))
    return {
        "repo_root": repo_root,
        "staging_bin": staging_bin,
        "kubeconfig": kubeconfig,
        "docker_config": docker_config,
    }


@pytest.fixture
def backend_recorder() -> BackendRecorder:
    return BackendRecorder()


@pytest_asyncio.fixture
async def app(
    fake_staging_repo: dict[str, Path],
    backend_recorder: BackendRecorder,
) -> AsyncIterator[Any]:
    settings = Settings(
        AGENT_HOST="127.0.0.1",
        AGENT_PORT=47600,
        AGENT_BACKEND_URL="http://backend.test",
        AGENT_CORS_ORIGINS="http://localhost:3000,http://127.0.0.1:3000",
        AGENT_STAGING_BIN=str(fake_staging_repo["staging_bin"]),
        AGENT_STAGINGS_REPO=str(fake_staging_repo["repo_root"]),
    )
    application = create_app(settings, backend_transport=backend_recorder.build_transport())
    async with application.router.lifespan_context(application):
        yield application


@pytest_asyncio.fixture
async def client(app: Any) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://testserver",
    ) as async_client:
        yield async_client


@pytest.fixture
def auth_headers() -> dict[str, str]:
    return {"Authorization": "Bearer valid-token", "X-QAA-TMS": "1"}


@pytest.fixture
def invalid_auth_headers() -> dict[str, str]:
    return {"Authorization": "Bearer invalid-token", "X-QAA-TMS": "1"}


def parse_sse_events(payload: str) -> list[tuple[str, dict[str, Any]]]:
    events: list[tuple[str, dict[str, Any]]] = []
    current_event = ""
    current_data = ""
    for line in payload.splitlines():
        if line.startswith("event: "):
            current_event = line.removeprefix("event: ")
        elif line.startswith("data: "):
            current_data = line.removeprefix("data: ")
        elif not line and current_event:
            events.append((current_event, json.loads(current_data)))
            current_event = ""
            current_data = ""
    if current_event:
        events.append((current_event, json.loads(current_data)))
    return events
