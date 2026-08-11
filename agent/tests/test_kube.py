from __future__ import annotations

import json
import textwrap
from pathlib import Path
from typing import Any

import httpx
import pytest
import pytest_asyncio
from conftest import BackendRecorder, parse_sse_events

from app.core.config import Settings
from app.main import create_app

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


async def test_get_kube_contexts_defaults_to_active_kubeconfig_path(
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


async def test_get_kube_contexts_merges_active_and_inherited_kubeconfig(
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
    assert invocations[-1]["kubeconfig"] == f"{active_kubeconfig}:{inherited_kubeconfig}"


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
    "path",
    [
        "/kube/contexts",
        "/kube/namespaces?namespace=qa-demo",
        "/kube/pods?namespace=qa-demo",
        f"/kube/pods/{KUBE_POD}/describe?namespace=qa-demo",
        f"/kube/pods/{KUBE_POD}/logs?namespace=qa-demo",
        "/kube/top?namespace=qa-demo",
    ],
)
async def test_kube_routes_require_bearer_auth(
    kube_client: httpx.AsyncClient,
    path: str,
) -> None:
    response = await kube_client.get(path)
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
