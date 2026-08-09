"""Read-only helpers around `staging` namespace commands."""

from __future__ import annotations

import asyncio
import contextlib
import os
import re
import signal
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from re import Pattern

from app.core.config import Settings
from app.core.constants import DEFAULT_CANCEL_WAIT_SECONDS, JobStatus, SseEvent
from app.schemas import JobLogEvent, JobTerminalEvent
from app.services.sse import encode_sse
from app.services.staging import (
    StagingInstallation,
    StagingNotInstalledError,
    resolve_staging_installation,
)


class NamespaceCommand(StrEnum):
    LIST = "list"
    STATUS = "status"
    CREDS = "creds"
    LOGS = "logs"


@dataclass(slots=True)
class PlainTextCommandResult:
    """Captured plain-text command output."""

    raw: str
    exit_code: int


NAMESPACE_NAME_PATTERN: Pattern[str] = re.compile(r"^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$")
NAMESPACE_SKIP_TOKENS = frozenset(
    {
        "dir",
        "dirs",
        "name",
        "names",
        "namespace",
        "namespaces",
        "ns",
        "overlay",
        "overlays",
        "path",
        "root",
        "staging",
    }
)
LOG_READ_POLL_SECONDS = 0.25


def build_namespace_list_argv(settings: Settings) -> tuple[list[str], StagingInstallation]:
    """Build argv for `staging list`."""

    return _build_namespace_argv(settings, NamespaceCommand.LIST)


def build_namespace_status_argv(
    settings: Settings,
    namespace: str,
) -> tuple[list[str], StagingInstallation]:
    """Build argv for `staging status <ns>`."""

    return _build_namespace_argv(settings, NamespaceCommand.STATUS, namespace)


def build_namespace_creds_argv(
    settings: Settings,
    namespace: str,
) -> tuple[list[str], StagingInstallation]:
    """Build argv for `staging creds <ns>`."""

    return _build_namespace_argv(settings, NamespaceCommand.CREDS, namespace)


def build_namespace_logs_argv(
    settings: Settings,
    namespace: str,
    deploy: str,
) -> tuple[list[str], StagingInstallation]:
    """Build argv for `staging logs <ns> <deploy>`."""

    return _build_namespace_argv(settings, NamespaceCommand.LOGS, namespace, deploy)


async def list_namespaces(settings: Settings) -> tuple[PlainTextCommandResult, list[str]]:
    """Run `staging list` and best-effort parse namespace names from the raw output."""

    argv, installation = build_namespace_list_argv(settings)
    result = await run_plain_text_command(argv, installation.repo_root)
    return result, parse_namespace_names(result.raw)


async def read_namespace_status(settings: Settings, namespace: str) -> PlainTextCommandResult:
    """Run `staging status <ns>`."""

    argv, installation = build_namespace_status_argv(settings, namespace)
    return await run_plain_text_command(argv, installation.repo_root)


async def read_namespace_creds(settings: Settings, namespace: str) -> PlainTextCommandResult:
    """Run `staging creds <ns>`."""

    argv, installation = build_namespace_creds_argv(settings, namespace)
    return await run_plain_text_command(argv, installation.repo_root)


async def run_plain_text_command(
    argv: list[str],
    repo_root: Path | None,
) -> PlainTextCommandResult:
    """Run a command and capture merged plain-text output verbatim."""

    process = await asyncio.create_subprocess_exec(
        *argv,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        cwd=str(repo_root) if repo_root is not None else None,
        start_new_session=True,
    )
    stdout, _ = await process.communicate()
    raw = stdout.decode("utf-8", errors="replace")
    exit_code = process.returncode if process.returncode is not None else 1
    return PlainTextCommandResult(raw=raw, exit_code=exit_code)


def stream_namespace_logs(
    settings: Settings,
    namespace: str,
    deploy: str,
    *,
    is_disconnected: Callable[[], Awaitable[bool]],
) -> AsyncIterator[str]:
    """Stream `staging logs` in the shared SSE frame format."""

    argv, installation = build_namespace_logs_argv(settings, namespace, deploy)
    repo_root = installation.repo_root

    async def iterator() -> AsyncIterator[str]:
        process = await spawn_namespaces_process(argv, repo_root)
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
                        JobLogEvent(type="line", line=line).model_dump(),
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
                    type="terminal",
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


async def spawn_namespaces_process(
    argv: list[str],
    repo_root: Path | None,
) -> asyncio.subprocess.Process:
    """Spawn a long-running namespaces process."""

    return await asyncio.create_subprocess_exec(
        *argv,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        cwd=str(repo_root) if repo_root is not None else None,
        start_new_session=True,
    )


def parse_namespace_names(raw_output: str) -> list[str]:
    """Extract plausible namespace names without relying on a rigid table format."""

    parsed: list[str] = []
    seen: set[str] = set()

    for raw_line in raw_output.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if any(
            box_char in line
            for box_char in ("═", "║", "╚", "╔", "╟", "╢", "╤", "╧", "┌", "└", "│")
        ):
            continue

        candidate = line.split(maxsplit=1)[0].strip(":").lower()
        if candidate in NAMESPACE_SKIP_TOKENS:
            continue
        if not NAMESPACE_NAME_PATTERN.fullmatch(candidate):
            continue
        if candidate in seen:
            continue

        seen.add(candidate)
        parsed.append(candidate)

    return parsed


async def terminate_process(process: asyncio.subprocess.Process) -> None:
    """Terminate a process group cleanly, then force-kill if needed."""

    if process.returncode is not None:
        return

    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    except OSError:
        with contextlib.suppress(ProcessLookupError):
            process.terminate()

    try:
        await asyncio.wait_for(process.wait(), timeout=DEFAULT_CANCEL_WAIT_SECONDS)
        return
    except TimeoutError:
        pass

    with contextlib.suppress(ProcessLookupError):
        os.killpg(process.pid, signal.SIGKILL)
    with contextlib.suppress(asyncio.TimeoutError):
        await asyncio.wait_for(process.wait(), timeout=DEFAULT_CANCEL_WAIT_SECONDS)


def _build_namespace_argv(
    settings: Settings,
    command: NamespaceCommand,
    *args: str,
) -> tuple[list[str], StagingInstallation]:
    installation = resolve_staging_installation(settings)
    if installation.bin_path is None:
        raise StagingNotInstalledError("The staging binary is not installed.")

    return [str(installation.bin_path), command.value, *args], installation
