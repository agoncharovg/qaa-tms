"""Helpers around the local `kubectl` installation."""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import re
import shutil
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from re import Pattern
from typing import Any
from uuid import uuid4

import httpx

from app.core.config import Settings
from app.core.constants import (
    DEFAULT_KUBE_LOG_TAIL,
    ErrorMessage,
    JobEventType,
    JobStatus,
    KubectlCommand,
    KubectlFlag,
    KubectlOutput,
    OperationStatus,
    OperationType,
    SseEvent,
)
from app.schemas import JobLogEvent, JobTerminalEvent
from app.services.backend import build_operation_payload, push_operation
from app.services.command import (
    LOG_READ_POLL_SECONDS,
    PlainTextCommandResult,
    run_plain_text_command,
    spawn_namespaces_process,
    terminate_process,
)
from app.services.sse import encode_sse


class KubectlNotInstalledError(RuntimeError):
    """Raised when `kubectl` cannot be resolved."""


@dataclass(slots=True)
class KubeContextRow:
    """Structured kube context row."""

    name: str
    cluster: str
    user: str
    namespace: str | None
    current: bool


@dataclass(slots=True)
class KubeNamespaceRow:
    """Structured namespace row."""

    name: str
    phase: str | None


@dataclass(slots=True)
class KubePodRow:
    """Structured pod row."""

    name: str
    phase: str | None
    ready: str
    restarts: int
    containers: list[str]
    node: str | None
    created_at: str | None


class KubeResource(StrEnum):
    POD = "pod"


MAX_KUBE_NAME_LENGTH = 253
CONTROL_CHARACTER_LIMIT = 32
DELETE_CHARACTER_CODE = 127
FLAG_ASSIGNMENT = "="
JSON_CONTEXTS_KEY = "contexts"
JSON_CONTEXT_KEY = "context"
JSON_CURRENT_CONTEXT_KEY = "current-context"
JSON_CLUSTER_KEY = "cluster"
JSON_USER_KEY = "user"
JSON_NAMESPACE_KEY = "namespace"
JSON_ITEMS_KEY = "items"
JSON_METADATA_KEY = "metadata"
JSON_STATUS_KEY = "status"
JSON_SPEC_KEY = "spec"
JSON_NAME_KEY = "name"
JSON_PHASE_KEY = "phase"
JSON_CONTAINERS_KEY = "containers"
JSON_CONTAINER_STATUSES_KEY = "containerStatuses"
JSON_READY_KEY = "ready"
JSON_RESTART_COUNT_KEY = "restartCount"
JSON_NODE_NAME_KEY = "nodeName"
JSON_CREATION_TIMESTAMP_KEY = "creationTimestamp"
KUBE_NAME_PATTERN: Pattern[str] = re.compile(r"^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$")


def resolve_kubectl_bin(settings: Settings) -> str:
    """Resolve the kubectl binary path."""

    configured_path = Path(settings.kubectl_bin).expanduser()
    if configured_path.is_absolute() and os.access(configured_path, os.X_OK):
        return str(configured_path)

    resolved = shutil.which(settings.kubectl_bin)
    if resolved:
        return resolved

    raise KubectlNotInstalledError(ErrorMessage.KUBECTL_NOT_INSTALLED.value)


def build_kube_env(settings: Settings) -> dict[str, str]:
    """Build the subprocess env override for kubeconfig selection."""

    explicit_kubeconfig = settings.kubeconfig.strip()
    if explicit_kubeconfig:
        expanded_parts = [
            str(Path(part).expanduser())
            for part in explicit_kubeconfig.split(os.pathsep)
            if part.strip()
        ]
        return {"KUBECONFIG": os.pathsep.join(expanded_parts)}

    active_kubeconfig = str(Path(settings.kubeconfig_active_path).expanduser())
    inherited_kubeconfig = os.environ.get("KUBECONFIG", "").strip()
    if not inherited_kubeconfig:
        return {"KUBECONFIG": active_kubeconfig}

    kubeconfig_parts = [active_kubeconfig]
    active_identity = (
        os.path.realpath(active_kubeconfig)
        if Path(active_kubeconfig).exists()
        else active_kubeconfig
    )
    seen_paths = {active_identity}
    for raw_part in inherited_kubeconfig.split(os.pathsep):
        part = raw_part.strip()
        if not part:
            continue
        expanded_part = str(Path(part).expanduser())
        part_identity = (
            os.path.realpath(expanded_part) if Path(expanded_part).exists() else expanded_part
        )
        if part_identity in seen_paths:
            continue
        kubeconfig_parts.append(expanded_part)
        seen_paths.add(part_identity)

    return {"KUBECONFIG": os.pathsep.join(kubeconfig_parts)}


def validate_kube_name(value: str) -> str:
    """Validate an RFC 1123 Kubernetes resource name."""

    if len(value) > MAX_KUBE_NAME_LENGTH or not KUBE_NAME_PATTERN.fullmatch(value):
        raise ValueError(ErrorMessage.INVALID_KUBE_NAME.value)
    return value


def validate_context_name(value: str) -> str:
    """Validate a kube context name for safe argv usage."""

    if not value.strip():
        raise ValueError(ErrorMessage.INVALID_KUBE_NAME.value)
    if any(
        ord(character) < CONTROL_CHARACTER_LIMIT or ord(character) == DELETE_CHARACTER_CODE
        for character in value
    ):
        raise ValueError(ErrorMessage.INVALID_KUBE_NAME.value)
    return value


def build_contexts_argv(settings: Settings) -> list[str]:
    """Build argv for `kubectl config view -o json`."""

    argv = [
        resolve_kubectl_bin(settings),
        KubectlCommand.CONFIG.value,
        KubectlCommand.VIEW.value,
        KubectlFlag.OUTPUT.value,
        KubectlOutput.JSON.value,
    ]
    _append_request_timeout(argv, settings)
    return argv


def build_use_context_argv(settings: Settings, context: str) -> list[str]:
    """Build argv for `kubectl config use-context <context>`."""

    return [
        resolve_kubectl_bin(settings),
        KubectlCommand.CONFIG.value,
        KubectlCommand.USE_CONTEXT.value,
        validate_context_name(context),
    ]


def build_namespaces_argv(settings: Settings, context: str | None = None) -> list[str]:
    """Build argv for `kubectl get namespaces -o json`."""

    argv = [
        resolve_kubectl_bin(settings),
        KubectlCommand.GET.value,
        KubectlCommand.NAMESPACES.value,
        KubectlFlag.OUTPUT.value,
        KubectlOutput.JSON.value,
    ]
    _append_context(argv, context)
    _append_request_timeout(argv, settings)
    return argv


def build_pods_argv(settings: Settings, namespace: str, context: str | None = None) -> list[str]:
    """Build argv for `kubectl get pods -o json`."""

    argv = [
        resolve_kubectl_bin(settings),
        KubectlCommand.GET.value,
        KubectlCommand.PODS.value,
        KubectlFlag.OUTPUT.value,
        KubectlOutput.JSON.value,
    ]
    _append_context(argv, context)
    _append_namespace(argv, namespace)
    _append_request_timeout(argv, settings)
    return argv


def build_describe_pod_argv(
    settings: Settings,
    namespace: str,
    pod: str,
    context: str | None = None,
) -> list[str]:
    """Build argv for `kubectl describe pod <pod>`."""

    argv = [
        resolve_kubectl_bin(settings),
        KubectlCommand.DESCRIBE.value,
        KubeResource.POD.value,
        validate_kube_name(pod),
    ]
    _append_context(argv, context)
    _append_namespace(argv, namespace)
    _append_request_timeout(argv, settings)
    return argv


def build_pod_logs_argv(
    settings: Settings,
    namespace: str,
    pod: str,
    container: str | None,
    follow: bool,
    tail: int,
    previous: bool,
    context: str | None = None,
) -> list[str]:
    """Build argv for `kubectl logs <pod> ...`."""

    argv = [
        resolve_kubectl_bin(settings),
        KubectlCommand.LOGS.value,
        validate_kube_name(pod),
    ]
    _append_context(argv, context)
    _append_namespace(argv, namespace)
    if container:
        _append_value_flag(argv, KubectlFlag.CONTAINER, validate_kube_name(container))
    if follow:
        argv.append(KubectlFlag.FOLLOW.value)
    _append_value_flag(argv, KubectlFlag.TAIL, str(tail))
    if previous:
        argv.append(KubectlFlag.PREVIOUS.value)
    return argv


def build_delete_pod_argv(
    settings: Settings,
    namespace: str,
    pod: str,
    context: str | None = None,
) -> list[str]:
    """Build argv for `kubectl delete pod <pod> --ignore-not-found`."""

    argv = [
        resolve_kubectl_bin(settings),
        KubectlCommand.DELETE.value,
        KubeResource.POD.value,
        validate_kube_name(pod),
    ]
    _append_context(argv, context)
    _append_namespace(argv, namespace)
    argv.append(KubectlFlag.IGNORE_NOT_FOUND.value)
    return argv


def build_top_argv(settings: Settings, namespace: str, context: str | None = None) -> list[str]:
    """Build argv for `kubectl top pods --no-headers`."""

    argv = [
        resolve_kubectl_bin(settings),
        KubectlCommand.TOP.value,
        KubectlCommand.PODS.value,
        KubectlFlag.NO_HEADERS.value,
    ]
    _append_context(argv, context)
    _append_namespace(argv, namespace)
    _append_request_timeout(argv, settings)
    return argv


async def list_contexts(
    settings: Settings,
) -> tuple[PlainTextCommandResult, list[KubeContextRow], str | None]:
    """List merged kubeconfig contexts."""

    result = await run_plain_text_command(
        build_contexts_argv(settings),
        None,
        env=build_kube_env(settings),
    )
    payload = _parse_json_payload(result)
    current_context = _read_optional_string(payload, JSON_CURRENT_CONTEXT_KEY)
    contexts: list[KubeContextRow] = []

    for item in _read_object_list(payload, JSON_CONTEXTS_KEY):
        name = _read_optional_string(item, JSON_NAME_KEY)
        if not name:
            continue
        context_payload = _read_object(item, JSON_CONTEXT_KEY)
        contexts.append(
            KubeContextRow(
                name=name,
                cluster=_read_optional_string(context_payload, JSON_CLUSTER_KEY) or "",
                user=_read_optional_string(context_payload, JSON_USER_KEY) or "",
                namespace=_read_optional_string(context_payload, JSON_NAMESPACE_KEY),
                current=name == current_context,
            )
        )

    return result, contexts, current_context


async def use_context(settings: Settings, context: str) -> PlainTextCommandResult:
    """Run `kubectl config use-context <context>`."""

    return await run_plain_text_command(
        build_use_context_argv(settings, context),
        None,
        env=build_kube_env(settings),
    )


async def list_namespaces_kube(
    settings: Settings,
    context: str | None,
) -> tuple[PlainTextCommandResult, list[KubeNamespaceRow]]:
    """List namespaces for the selected context."""

    result = await run_plain_text_command(
        build_namespaces_argv(settings, context),
        None,
        env=build_kube_env(settings),
    )
    payload = _parse_json_payload(result)
    rows = [
        KubeNamespaceRow(
            name=_read_optional_string(_read_object(item, JSON_METADATA_KEY), JSON_NAME_KEY) or "",
            phase=_read_optional_string(_read_object(item, JSON_STATUS_KEY), JSON_PHASE_KEY),
        )
        for item in _read_object_list(payload, JSON_ITEMS_KEY)
        if _read_optional_string(_read_object(item, JSON_METADATA_KEY), JSON_NAME_KEY)
    ]
    return result, rows


async def list_pods(
    settings: Settings,
    context: str | None,
    namespace: str,
) -> tuple[PlainTextCommandResult, list[KubePodRow]]:
    """List pods in a namespace."""

    result = await run_plain_text_command(
        build_pods_argv(settings, namespace, context),
        None,
        env=build_kube_env(settings),
    )
    payload = _parse_json_payload(result)
    rows: list[KubePodRow] = []

    for item in _read_object_list(payload, JSON_ITEMS_KEY):
        metadata = _read_object(item, JSON_METADATA_KEY)
        spec = _read_object(item, JSON_SPEC_KEY)
        status = _read_object(item, JSON_STATUS_KEY)
        container_specs = _read_object_list(spec, JSON_CONTAINERS_KEY)
        container_statuses = _read_object_list(status, JSON_CONTAINER_STATUSES_KEY)
        container_names = [
            name
            for container in container_specs
            if (name := _read_optional_string(container, JSON_NAME_KEY))
        ]
        total_count = len(container_names) if container_names else len(container_statuses)
        ready_count = sum(
            1
            for container_status in container_statuses
            if bool(container_status.get(JSON_READY_KEY))
        )
        restarts = sum(
            _read_int(container_status.get(JSON_RESTART_COUNT_KEY))
            for container_status in container_statuses
        )
        pod_name = _read_optional_string(metadata, JSON_NAME_KEY)
        if not pod_name:
            continue
        rows.append(
            KubePodRow(
                name=pod_name,
                phase=_read_optional_string(status, JSON_PHASE_KEY),
                ready=f"{ready_count}/{total_count}",
                restarts=restarts,
                containers=container_names,
                node=_read_optional_string(spec, JSON_NODE_NAME_KEY),
                created_at=_read_optional_string(metadata, JSON_CREATION_TIMESTAMP_KEY),
            )
        )

    return result, rows


async def describe_pod(
    settings: Settings,
    context: str | None,
    namespace: str,
    pod: str,
) -> PlainTextCommandResult:
    """Describe a pod and return raw output."""

    return await run_plain_text_command(
        build_describe_pod_argv(settings, namespace, pod, context),
        None,
        env=build_kube_env(settings),
    )


async def delete_pod(
    settings: Settings,
    context: str | None,
    namespace: str,
    pod: str,
) -> PlainTextCommandResult:
    """Delete a pod and return raw output."""

    return await run_plain_text_command(
        build_delete_pod_argv(settings, namespace, pod, context),
        None,
        env=build_kube_env(settings),
    )


async def top_pods(
    settings: Settings,
    context: str | None,
    namespace: str,
) -> PlainTextCommandResult:
    """Return `kubectl top pods` raw output."""

    return await run_plain_text_command(
        build_top_argv(settings, namespace, context),
        None,
        env=build_kube_env(settings),
    )


def stream_pod_logs(
    settings: Settings,
    context: str | None,
    namespace: str,
    pod: str,
    container: str | None,
    follow: bool,
    tail: int = DEFAULT_KUBE_LOG_TAIL,
    previous: bool = False,
    *,
    is_disconnected: Callable[[], Awaitable[bool]],
) -> AsyncIterator[str]:
    """Stream `kubectl logs` in the shared SSE frame format."""

    argv = build_pod_logs_argv(settings, namespace, pod, container, follow, tail, previous, context)
    env = build_kube_env(settings)

    async def iterator() -> AsyncIterator[str]:
        process = await spawn_namespaces_process(argv, None, env=env)
        aborted = False

        try:
            assert process.stdout is not None
            while True:
                if await is_disconnected():
                    aborted = True
                    break

                try:
                    raw_line = await asyncio.wait_for(
                        process.stdout.readline(),
                        timeout=LOG_READ_POLL_SECONDS,
                    )
                except TimeoutError:
                    if process.returncode is not None:
                        break
                    continue

                if raw_line:
                    line = raw_line.decode("utf-8", errors="replace").rstrip("\r\n")
                    yield encode_sse(
                        SseEvent.LOG,
                        JobLogEvent(type=JobEventType.LINE.value, line=line).model_dump(),
                    )
                    continue

                if process.returncode is not None:
                    break

                exit_code = await process.wait()
                if exit_code is not None:
                    break

            if aborted:
                return

            exit_code = await process.wait()
            status = JobStatus.SUCCESS if exit_code == 0 else JobStatus.FAILED
            yield encode_sse(
                SseEvent.TERMINAL,
                JobTerminalEvent(
                    type=JobEventType.TERMINAL.value,
                    status=status,
                    exit_code=exit_code,
                ).model_dump(by_alias=True),
            )
        except asyncio.CancelledError:
            aborted = True
            raise
        finally:
            if aborted:
                await terminate_process(process)

    return iterator()


async def push_kube_operation(
    client: httpx.AsyncClient,
    token: str,
    *,
    op_type: OperationType,
    ns: str | None,
    recipe: Mapping[str, Any],
    result: PlainTextCommandResult,
) -> None:
    """Push a best-effort kube mutation audit record."""

    now = datetime.now(UTC)
    payload = build_operation_payload(
        op_id=uuid4(),
        type=op_type,
        ns=ns,
        recipe=recipe,
        status=OperationStatus.SUCCESS if result.exit_code == 0 else OperationStatus.FAILED,
        started_at=now,
        finished_at=now,
        log=result.raw,
        exit_code=result.exit_code,
        stagings_sha=None,
    )
    with contextlib.suppress(Exception):
        await push_operation(client=client, token=token, payload=payload)


def _append_context(argv: list[str], context: str | None) -> None:
    if context is None:
        return
    _append_value_flag(argv, KubectlFlag.CONTEXT, validate_context_name(context))


def _append_namespace(argv: list[str], namespace: str) -> None:
    _append_value_flag(argv, KubectlFlag.NAMESPACE, validate_kube_name(namespace))


def _append_request_timeout(argv: list[str], settings: Settings) -> None:
    _append_value_flag(argv, KubectlFlag.REQUEST_TIMEOUT, settings.kubectl_request_timeout)


def _append_value_flag(argv: list[str], flag: KubectlFlag, value: str) -> None:
    argv.append(f"{flag.value}{FLAG_ASSIGNMENT}{value}")


def _parse_json_payload(result: PlainTextCommandResult) -> dict[str, Any]:
    try:
        payload = json.loads(result.raw)
    except json.JSONDecodeError:
        if result.exit_code != 0:
            return {}
        raise
    return payload if isinstance(payload, dict) else {}


def _read_object(payload: Mapping[str, Any], key: str) -> dict[str, Any]:
    value = payload.get(key)
    return value if isinstance(value, dict) else {}


def _read_object_list(payload: Mapping[str, Any], key: str) -> list[dict[str, Any]]:
    value = payload.get(key)
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _read_optional_string(payload: Mapping[str, Any], key: str) -> str | None:
    value = payload.get(key)
    return value if isinstance(value, str) else None


def _read_int(value: Any) -> int:
    return value if isinstance(value, int) else 0
