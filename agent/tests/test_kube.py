from __future__ import annotations

import json
import os
import textwrap
from pathlib import Path
from typing import Any

import httpx
import pytest
import pytest_asyncio
from conftest import BackendRecorder, parse_sse_events

from app.core.config import Settings
from app.core.constants import (
    KUBE_EXEC_SHELL,
    KUBE_EXEC_SHELL_FLAG,
    KUBECTL_ARG_SEPARATOR,
    MAX_KUBE_EXEC_COMMAND_LENGTH,
)
from app.main import create_app
from app.services.kube import build_exec_argv, build_kube_env

KUBE_CONTEXT = "team/dev"
KUBE_NAMESPACE = "qa-demo"
KUBE_POD = "iam-api-123"
KUBE_CONTAINER = "api"


def read_invocations(record_path: Path) -> list[dict[str, Any]]:
    if not record_path.exists():
        return []
    return [
        json.loads(line) for line in record_path.read_text(encoding="utf-8").splitlines() if line
    ]


async def send_request(
    client: httpx.AsyncClient,
    method: str,
    path: str,
    headers: dict[str, str] | None = None,
    body: dict[str, Any] | None = None,
) -> httpx.Response:
    return await client.request(method.upper(), path, headers=headers, json=body)


@pytest.fixture
def fake_kubectl(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Path]:
    monkeypatch.setenv("HOME", str(tmp_path))
    record_path = tmp_path / "kubectl-record.jsonl"
    kubeconfig = tmp_path / "kubeconfig-test.yaml"
    kubeconfig.write_text("apiVersion: v1\n", encoding="utf-8")
    kubectl_bin = tmp_path / "kubectl"
    kubectl_bin.write_text(
        textwrap.dedent(
            f"""\
            #!/usr/bin/env python3
            import json
            import os
            import sys
            CONTEXT = {KUBE_CONTEXT!r}
            NAMESPACE = {KUBE_NAMESPACE!r}
            POD = {KUBE_POD!r}
            def record(args):
                record_path = os.environ.get("FAKE_KUBECTL_RECORD")
                if not record_path:
                    return
                payload = {{
                    "args": args,
                    "kubeconfig": os.environ.get("KUBECONFIG"),
                }}
                with open(record_path, "a", encoding="utf-8") as handle:
                    handle.write(json.dumps(payload) + "\\n")
            def main() -> int:
                args = sys.argv[1:]
                record(args)
                if args[:2] == ["config", "view"]:
                    print(json.dumps({{
                        "current-context": CONTEXT,
                        "contexts": [
                            {{
                                "name": CONTEXT,
                                "context": {{
                                    "cluster": "dev-cluster",
                                    "user": "dev-user",
                                    "namespace": "dev-ns",
                                }},
                            }},
                            {{
                                "name": "team/prod",
                                "context": {{
                                    "cluster": "prod-cluster",
                                    "user": "prod-user",
                                }},
                            }},
                        ],
                    }}))
                    return 0
                if args[:2] == ["config", "use-context"]:
                    print(f'Switched to context "{{args[2]}}"')
                    return 0
                if args[:2] == ["get", "namespaces"]:
                    print(json.dumps({{
                        "items": [
                            {{"metadata": {{"name": "default"}}, "status": {{"phase": "Active"}}}},
                            {{"metadata": {{"name": NAMESPACE}}, "status": {{"phase": "Active"}}}},
                        ]
                    }}))
                    return 0
                if args[:2] == ["get", "pods"]:
                    print(json.dumps({{
                        "items": [
                            {{
                                "metadata": {{
                                    "name": POD,
                                    "creationTimestamp": "2026-08-11T08:00:00Z",
                                }},
                                "spec": {{
                                    "containers": [{{"name": "api"}}, {{"name": "worker"}}],
                                    "nodeName": "node-a",
                                }},
                                "status": {{
                                    "phase": "Running",
                                    "containerStatuses": [
                                        {{"name": "api", "ready": True, "restartCount": 1}},
                                        {{"name": "worker", "ready": False, "restartCount": 2}},
                                    ],
                                }},
                            }},
                            {{
                                "metadata": {{
                                    "name": "pending-pod",
                                    "creationTimestamp": "2026-08-11T08:05:00Z",
                                }},
                                "spec": {{
                                    "containers": [{{"name": "pending"}}],
                                    "nodeName": None,
                                }},
                                "status": {{
                                    "phase": "Pending",
                                }},
                            }},
                        ]
                    }}))
                    return 0
                if args[:2] == ["describe", "pod"]:
                    print("Name: iam-api-123")
                    print("Events:")
                    print("  Warning  FailedScheduling")
                    return 3
                if args[:1] == ["logs"]:
                    print("line one", flush=True)
                    print("line two", flush=True)
                    return 0
                if args[:1] == ["exec"]:
                    command = args[-1]
                    print(f"exec: {{command}}", flush=True)
                    print("exec done", flush=True)
                    return 7 if "exit 7" in command else 0
                if args[:2] == ["delete", "pod"]:
                    print(f'pod "{{args[2]}}" deleted')
                    return 0
                if args[:2] == ["top", "pods"]:
                    print("error: Metrics API not available", file=sys.stderr)
                    return 42
                print("unsupported invocation", file=sys.stderr)
                return 2
            raise SystemExit(main())
            """
        ),
        encoding="utf-8",
    )
    kubectl_bin.chmod(0o755)
    monkeypatch.setenv("FAKE_KUBECTL_RECORD", str(record_path))
    return {
        "kubeconfig": kubeconfig,
        "kubectl_bin": kubectl_bin,
        "record_path": record_path,
    }


@pytest_asyncio.fixture
async def kube_app(
    fake_kubectl: dict[str, Path],
    backend_recorder: BackendRecorder,
) -> Any:
    settings = Settings(
        AGENT_HOST="127.0.0.1",
        AGENT_PORT=47600,
        AGENT_BACKEND_URL="http://backend.test",
        AGENT_CORS_ORIGINS="http://localhost:3000,http://127.0.0.1:3000",
        AGENT_KUBECTL_BIN=str(fake_kubectl["kubectl_bin"]),
        AGENT_KUBECONFIG="~/kubeconfig-test.yaml",
        AGENT_KUBECTL_REQUEST_TIMEOUT="10s",
    )
    application = create_app(settings, backend_transport=backend_recorder.build_transport())
    async with application.router.lifespan_context(application):
        yield application


@pytest_asyncio.fixture
async def kube_client(kube_app: Any) -> httpx.AsyncClient:
    transport = httpx.ASGITransport(app=kube_app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as async_client:
        yield async_client


def test_build_kube_env_expands_directory_kubeconfig_parts(
    tmp_path: Path,
) -> None:
    kubeconfig_dir = tmp_path / "kubeconfigs"
    kubeconfig_dir.mkdir()
    first_kubeconfig = kubeconfig_dir / "a.yaml"
    second_kubeconfig = kubeconfig_dir / "b.yaml"
    ignored_file = kubeconfig_dir / "notes.txt"
    first_kubeconfig.write_text("apiVersion: v1\n", encoding="utf-8")
    second_kubeconfig.write_text("apiVersion: v1\n", encoding="utf-8")
    ignored_file.write_text("ignore me\n", encoding="utf-8")

    settings = Settings(_env_file=None, AGENT_KUBECONFIG=str(kubeconfig_dir))

    assert build_kube_env(settings) == {
        "KUBECONFIG": os.pathsep.join([str(first_kubeconfig), str(second_kubeconfig)])
    }


def test_build_kube_env_service_runtime_falls_back_to_home_kube_directory(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.delenv("KUBECONFIG", raising=False)
    monkeypatch.setenv("QAA_TMS_AGENT_SERVICE_MANAGED", "1")
    kube_dir = tmp_path / ".kube"
    kube_dir.mkdir()
    active_target = kube_dir / "ai-staging.yaml"
    additional_kubeconfig = kube_dir / "kubecfg.default.yaml"
    ignored_file = kube_dir / "notes.txt"
    active_target.write_text("apiVersion: v1\n", encoding="utf-8")
    additional_kubeconfig.write_text("apiVersion: v1\n", encoding="utf-8")
    ignored_file.write_text("ignore me\n", encoding="utf-8")
    active_kubeconfig = kube_dir / "config"
    active_kubeconfig.symlink_to(active_target)

    settings = Settings(_env_file=None, AGENT_KUBECONFIG_ACTIVE_PATH=str(active_kubeconfig))

    assert build_kube_env(settings) == {
        "KUBECONFIG": os.pathsep.join([str(active_kubeconfig), str(additional_kubeconfig)])
    }


def test_build_exec_argv_includes_shell_wrapper(
    fake_kubectl: dict[str, Path],
) -> None:
    settings = Settings(_env_file=None, AGENT_KUBECTL_BIN=str(fake_kubectl["kubectl_bin"]))

    assert build_exec_argv(
        settings,
        KUBE_NAMESPACE,
        KUBE_POD,
        KUBE_CONTAINER,
        "echo hello && exit 7",
        "team/prod",
    ) == [
        str(fake_kubectl["kubectl_bin"]),
        "exec",
        KUBE_POD,
        "--context=team/prod",
        f"--namespace={KUBE_NAMESPACE}",
        f"--container={KUBE_CONTAINER}",
        KUBECTL_ARG_SEPARATOR,
        KUBE_EXEC_SHELL,
        KUBE_EXEC_SHELL_FLAG,
        "echo hello && exit 7",
    ]


@pytest.mark.parametrize(
    ("pod", "container"),
    [("Invalid_Pod", None), (KUBE_POD, "Invalid_Container")],
)
def test_build_exec_argv_rejects_invalid_resource_names(
    fake_kubectl: dict[str, Path],
    pod: str,
    container: str | None,
) -> None:
    settings = Settings(_env_file=None, AGENT_KUBECTL_BIN=str(fake_kubectl["kubectl_bin"]))

    with pytest.raises(ValueError, match="Invalid Kubernetes resource name"):
        build_exec_argv(settings, KUBE_NAMESPACE, pod, container, "echo hello", "team/prod")


@pytest.mark.parametrize("command", ["   ", "x" * (MAX_KUBE_EXEC_COMMAND_LENGTH + 1)])
def test_build_exec_argv_rejects_invalid_commands(
    fake_kubectl: dict[str, Path],
    command: str,
) -> None:
    settings = Settings(_env_file=None, AGENT_KUBECTL_BIN=str(fake_kubectl["kubectl_bin"]))

    with pytest.raises(ValueError, match="Invalid Kubernetes exec command"):
        build_exec_argv(settings, KUBE_NAMESPACE, KUBE_POD, KUBE_CONTAINER, command, "team/prod")


async def test_get_kube_contexts_default_to_active_kubeconfig_path(
    fake_kubectl: dict[str, Path],
    backend_recorder: BackendRecorder,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("KUBECONFIG", raising=False)
    active_kubeconfig = fake_kubectl["record_path"].parent / "managed-active.yaml"
    active_kubeconfig.write_text("apiVersion: v1\n", encoding="utf-8")
    settings = Settings(
        AGENT_HOST="127.0.0.1",
        AGENT_PORT=47600,
        AGENT_BACKEND_URL="http://backend.test",
        AGENT_CORS_ORIGINS="http://localhost:3000,http://127.0.0.1:3000",
        AGENT_KUBECTL_BIN=str(fake_kubectl["kubectl_bin"]),
        AGENT_KUBECONFIG_ACTIVE_PATH=str(active_kubeconfig),
        AGENT_KUBECTL_REQUEST_TIMEOUT="10s",
    )
    application = create_app(settings, backend_transport=backend_recorder.build_transport())
    async with application.router.lifespan_context(application):
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.get("/kube/contexts", headers=auth_headers)
    assert response.status_code == 200
    invocations = read_invocations(fake_kubectl["record_path"])
    assert invocations[-1]["kubeconfig"] == str(active_kubeconfig)


async def test_get_kube_contexts_merge_active_and_inherited_kubeconfigs(
    fake_kubectl: dict[str, Path],
    backend_recorder: BackendRecorder,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    inherited_kubeconfig = fake_kubectl["record_path"].parent / "default-source.yaml"
    inherited_kubeconfig.write_text("apiVersion: v1\n", encoding="utf-8")
    active_kubeconfig = fake_kubectl["record_path"].parent / "managed-active.yaml"
    active_kubeconfig.write_text("apiVersion: v1\n", encoding="utf-8")
    monkeypatch.setenv("KUBECONFIG", str(inherited_kubeconfig))

    settings = Settings(
        AGENT_HOST="127.0.0.1",
        AGENT_PORT=47600,
        AGENT_BACKEND_URL="http://backend.test",
        AGENT_CORS_ORIGINS="http://localhost:3000,http://127.0.0.1:3000",
        AGENT_KUBECTL_BIN=str(fake_kubectl["kubectl_bin"]),
        AGENT_KUBECONFIG_ACTIVE_PATH=str(active_kubeconfig),
        AGENT_KUBECTL_REQUEST_TIMEOUT="10s",
    )
    application = create_app(settings, backend_transport=backend_recorder.build_transport())
    async with application.router.lifespan_context(application):
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.get("/kube/contexts", headers=auth_headers)
    assert response.status_code == 200
    invocations = read_invocations(fake_kubectl["record_path"])
    assert invocations[-1]["kubeconfig"] == os.pathsep.join(
        [str(active_kubeconfig), str(inherited_kubeconfig)]
    )


async def test_get_kube_contexts_returns_rows_and_marks_current(
    kube_client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    fake_kubectl: dict[str, Path],
) -> None:
    response = await kube_client.get("/kube/contexts", headers=auth_headers)
    assert response.status_code == 200
    assert response.json() == {
        "contexts": [
            {
                "name": KUBE_CONTEXT,
                "cluster": "dev-cluster",
                "user": "dev-user",
                "namespace": "dev-ns",
                "current": True,
            },
            {
                "name": "team/prod",
                "cluster": "prod-cluster",
                "user": "prod-user",
                "namespace": None,
                "current": False,
            },
        ],
        "currentContext": KUBE_CONTEXT,
        "exitCode": 0,
    }
    invocation = read_invocations(fake_kubectl["record_path"])[0]
    assert invocation["args"] == ["config", "view", "-o", "json", "--request-timeout=10s"]
    assert invocation["kubeconfig"] == str(fake_kubectl["kubeconfig"])


async def test_get_kube_namespaces_and_pods_parse_structured_rows(
    kube_client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    fake_kubectl: dict[str, Path],
) -> None:
    namespaces_response = await kube_client.get(
        "/kube/namespaces",
        headers=auth_headers,
        params={"context": "team/prod"},
    )
    pods_response = await kube_client.get(
        "/kube/pods",
        headers=auth_headers,
        params={"context": "team/prod", "namespace": KUBE_NAMESPACE},
    )
    assert namespaces_response.status_code == 200
    assert namespaces_response.json() == {
        "namespaces": [
            {"name": "default", "phase": "Active"},
            {"name": KUBE_NAMESPACE, "phase": "Active"},
        ],
        "exitCode": 0,
    }
    assert pods_response.status_code == 200
    assert pods_response.json() == {
        "pods": [
            {
                "name": KUBE_POD,
                "phase": "Running",
                "ready": "1/2",
                "restarts": 3,
                "containers": ["api", "worker"],
                "node": "node-a",
                "createdAt": "2026-08-11T08:00:00Z",
            },
            {
                "name": "pending-pod",
                "phase": "Pending",
                "ready": "0/1",
                "restarts": 0,
                "containers": ["pending"],
                "node": None,
                "createdAt": "2026-08-11T08:05:00Z",
            },
        ],
        "exitCode": 0,
    }
    invocations = read_invocations(fake_kubectl["record_path"])
    namespace_invocation = invocations[0]
    pods_invocation = invocations[1]
    assert "--context=team/prod" in namespace_invocation["args"]
    assert "--request-timeout=10s" in namespace_invocation["args"]
    assert "--context=team/prod" in pods_invocation["args"]
    assert "--namespace=qa-demo" in pods_invocation["args"]
    assert "--request-timeout=10s" in pods_invocation["args"]


async def test_describe_and_top_surface_raw_output_and_exit_codes(
    kube_client: httpx.AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    describe_response = await kube_client.get(
        f"/kube/pods/{KUBE_POD}/describe",
        headers=auth_headers,
        params={"namespace": KUBE_NAMESPACE},
    )
    top_response = await kube_client.get(
        "/kube/top",
        headers=auth_headers,
        params={"namespace": KUBE_NAMESPACE},
    )
    assert describe_response.status_code == 200
    assert describe_response.json() == {
        "name": KUBE_POD,
        "raw": "Name: iam-api-123\nEvents:\n  Warning  FailedScheduling\n",
        "exitCode": 3,
    }
    assert top_response.status_code == 200
    assert top_response.json() == {
        "raw": "error: Metrics API not available\n",
        "exitCode": 42,
    }


async def test_use_context_and_delete_pod_record_best_effort_operations(
    kube_client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    backend_recorder: BackendRecorder,
) -> None:
    use_context_response = await kube_client.post(
        "/kube/contexts/use",
        headers=auth_headers,
        json={"context": "team/prod"},
    )
    delete_response = await kube_client.post(
        f"/kube/pods/{KUBE_POD}/delete",
        headers=auth_headers,
        json={"context": "team/prod", "namespace": KUBE_NAMESPACE},
    )
    assert use_context_response.status_code == 200
    assert use_context_response.json() == {
        "raw": 'Switched to context "team/prod"\n',
        "exitCode": 0,
    }
    assert delete_response.status_code == 200
    assert delete_response.json() == {
        "raw": 'pod "iam-api-123" deleted\n',
        "exitCode": 0,
    }
    assert len(backend_recorder.operations) == 2
    assert backend_recorder.operations[0]["type"] == "kube_use_context"
    assert backend_recorder.operations[0]["ns"] is None
    assert backend_recorder.operations[0]["recipe"] == {"context": "team/prod"}
    assert backend_recorder.operations[0]["status"] == "success"
    assert backend_recorder.operations[1]["type"] == "kube_delete_pod"
    assert backend_recorder.operations[1]["ns"] == KUBE_NAMESPACE
    assert backend_recorder.operations[1]["recipe"] == {"pod": KUBE_POD, "context": "team/prod"}
    assert backend_recorder.operations[1]["status"] == "success"


async def test_kube_logs_stream_emit_log_and_terminal_events(
    kube_client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    fake_kubectl: dict[str, Path],
) -> None:
    response = await kube_client.get(
        f"/kube/pods/{KUBE_POD}/logs",
        headers=auth_headers,
        params={
            "container": KUBE_CONTAINER,
            "context": "team/prod",
            "follow": "false",
            "namespace": KUBE_NAMESPACE,
            "previous": "true",
            "tail": "20",
        },
    )
    assert response.status_code == 200
    assert parse_sse_events(response.text) == [
        ("log", {"type": "line", "line": "line one"}),
        ("log", {"type": "line", "line": "line two"}),
        ("terminal", {"type": "terminal", "status": "success", "exitCode": 0}),
    ]
    invocation = read_invocations(fake_kubectl["record_path"])[0]
    assert "--context=team/prod" in invocation["args"]
    assert "--namespace=qa-demo" in invocation["args"]
    assert "--container=api" in invocation["args"]
    assert "--tail=20" in invocation["args"]
    assert "--previous" in invocation["args"]
    assert "--follow" not in invocation["args"]
    assert "--request-timeout=10s" not in invocation["args"]


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("get", "/kube/contexts", None),
        ("get", "/kube/namespaces?namespace=qa-demo", None),
        ("get", "/kube/pods?namespace=qa-demo", None),
        ("get", f"/kube/pods/{KUBE_POD}/describe?namespace=qa-demo", None),
        ("get", f"/kube/pods/{KUBE_POD}/logs?namespace=qa-demo", None),
        (
            "post",
            f"/kube/pods/{KUBE_POD}/exec",
            {"command": "echo hello", "namespace": KUBE_NAMESPACE},
        ),
        ("get", "/kube/top?namespace=qa-demo", None),
    ],
)
async def test_kube_routes_require_bearer_auth(
    kube_client: httpx.AsyncClient,
    method: str,
    path: str,
    body: dict[str, Any] | None,
) -> None:
    response = await send_request(kube_client, method, path, None, body)
    assert response.status_code == 401


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("get", "/kube/pods?namespace=Invalid_Name", None),
        ("get", "/kube/pods/Invalid_Pod/describe?namespace=qa-demo", None),
        ("post", f"/kube/pods/{KUBE_POD}/delete", {"context": None, "namespace": "Invalid_Name"}),
    ],
)
async def test_invalid_kube_names_return_400(
    kube_client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    method: str,
    path: str,
    body: dict[str, Any] | None,
) -> None:
    response = await send_request(kube_client, method, path, auth_headers, body)
    assert response.status_code == 400
    assert response.json() == {"detail": "Invalid Kubernetes resource name."}


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("get", "/kube/contexts", None),
        ("post", "/kube/contexts/use", {"context": "team/prod"}),
        ("get", "/kube/namespaces", None),
        ("get", "/kube/pods?namespace=qa-demo", None),
        ("get", f"/kube/pods/{KUBE_POD}/describe?namespace=qa-demo", None),
        ("get", f"/kube/pods/{KUBE_POD}/logs?namespace=qa-demo", None),
        ("post", f"/kube/pods/{KUBE_POD}/delete", {"context": None, "namespace": "qa-demo"}),
        ("get", "/kube/top?namespace=qa-demo", None),
    ],
)
async def test_kube_routes_return_503_when_kubectl_is_absent(
    backend_recorder: BackendRecorder,
    auth_headers: dict[str, str],
    method: str,
    path: str,
    body: dict[str, Any] | None,
    tmp_path: Path,
) -> None:
    settings = Settings(
        AGENT_HOST="127.0.0.1",
        AGENT_PORT=47600,
        AGENT_BACKEND_URL="http://backend.test",
        AGENT_CORS_ORIGINS="http://localhost:3000,http://127.0.0.1:3000",
        AGENT_KUBECTL_BIN=str(tmp_path / "missing-kubectl"),
    )
    application = create_app(settings, backend_transport=backend_recorder.build_transport())
    async with application.router.lifespan_context(application):
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await send_request(client, method, path, auth_headers, body)
    assert response.status_code == 503
    assert response.json() == {"detail": "kubectl is not installed."}


async def test_kube_exec_stream_emits_events_and_pushes_operation(
    kube_client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    backend_recorder: BackendRecorder,
    fake_kubectl: dict[str, Path],
) -> None:
    command = "echo hello && exit 7"
    response = await kube_client.post(
        f"/kube/pods/{KUBE_POD}/exec",
        headers=auth_headers,
        json={
            "command": command,
            "container": KUBE_CONTAINER,
            "context": "team/prod",
            "namespace": KUBE_NAMESPACE,
        },
    )
    assert response.status_code == 200
    assert parse_sse_events(response.text) == [
        ("log", {"type": "line", "line": f"exec: {command}"}),
        ("log", {"type": "line", "line": "exec done"}),
        ("terminal", {"type": "terminal", "status": "failed", "exitCode": 7}),
    ]

    invocation = read_invocations(fake_kubectl["record_path"])[0]
    assert invocation["args"] == [
        "exec",
        KUBE_POD,
        "--context=team/prod",
        f"--namespace={KUBE_NAMESPACE}",
        f"--container={KUBE_CONTAINER}",
        KUBECTL_ARG_SEPARATOR,
        KUBE_EXEC_SHELL,
        KUBE_EXEC_SHELL_FLAG,
        command,
    ]
    assert backend_recorder.operations[0]["type"] == "kube_exec"
    assert backend_recorder.operations[0]["ns"] == KUBE_NAMESPACE
    assert backend_recorder.operations[0]["recipe"] == {
        "pod": KUBE_POD,
        "container": KUBE_CONTAINER,
        "context": "team/prod",
        "command": command,
    }
    assert backend_recorder.operations[0]["log"] == f"exec: {command}\nexec done\n"
    assert backend_recorder.operations[0]["exit_code"] == 7


async def test_kube_exec_invalid_inputs_return_400(
    kube_client: httpx.AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    invalid_name_response = await kube_client.post(
        "/kube/pods/Invalid_Pod/exec",
        headers=auth_headers,
        json={
            "command": "echo hello",
            "container": KUBE_CONTAINER,
            "context": "team/prod",
            "namespace": KUBE_NAMESPACE,
        },
    )
    whitespace_command_response = await kube_client.post(
        f"/kube/pods/{KUBE_POD}/exec",
        headers=auth_headers,
        json={
            "command": "   ",
            "container": KUBE_CONTAINER,
            "context": "team/prod",
            "namespace": KUBE_NAMESPACE,
        },
    )
    overlength_command_response = await kube_client.post(
        f"/kube/pods/{KUBE_POD}/exec",
        headers=auth_headers,
        json={
            "command": "x" * (MAX_KUBE_EXEC_COMMAND_LENGTH + 1),
            "container": KUBE_CONTAINER,
            "context": "team/prod",
            "namespace": KUBE_NAMESPACE,
        },
    )

    assert invalid_name_response.status_code == 400
    assert invalid_name_response.json() == {"detail": "Invalid Kubernetes resource name."}
    assert whitespace_command_response.status_code == 400
    assert whitespace_command_response.json() == {"detail": "Invalid Kubernetes exec command."}
    assert overlength_command_response.status_code == 400
    assert overlength_command_response.json() == {"detail": "Invalid Kubernetes exec command."}


async def test_kube_exec_returns_503_when_kubectl_is_absent(
    backend_recorder: BackendRecorder,
    auth_headers: dict[str, str],
    tmp_path: Path,
) -> None:
    settings = Settings(
        AGENT_HOST="127.0.0.1",
        AGENT_PORT=47600,
        AGENT_BACKEND_URL="http://backend.test",
        AGENT_CORS_ORIGINS="http://localhost:3000,http://127.0.0.1:3000",
        AGENT_KUBECTL_BIN=str(tmp_path / "missing-kubectl"),
    )
    application = create_app(settings, backend_transport=backend_recorder.build_transport())
    async with application.router.lifespan_context(application):
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.post(
                f"/kube/pods/{KUBE_POD}/exec",
                headers=auth_headers,
                json={
                    "command": "echo hello",
                    "container": KUBE_CONTAINER,
                    "context": "team/prod",
                    "namespace": KUBE_NAMESPACE,
                },
            )
    assert response.status_code == 503
    assert response.json() == {"detail": "kubectl is not installed."}

