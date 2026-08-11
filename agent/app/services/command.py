"""Shared subprocess helpers for plain-text command execution and SSE streams."""

from __future__ import annotations

import asyncio
import contextlib
import os
import re
import signal
from dataclasses import dataclass
from pathlib import Path
from re import Pattern

from app.core.constants import DEFAULT_CANCEL_WAIT_SECONDS


@dataclass(slots=True)
class PlainTextCommandResult:
    """Captured plain-text command output."""

    raw: str
    exit_code: int


ANSI_ESCAPE_PATTERN: Pattern[str] = re.compile(r"\x1B\[[0-?]*[ -/]*[@-~]")
LOG_READ_POLL_SECONDS = 0.25


def _build_subprocess_env(env: dict[str, str] | None) -> dict[str, str] | None:
    if env is None:
        return None
    return {**os.environ, **env}


async def run_plain_text_command(
    argv: list[str],
    repo_root: Path | None,
    env: dict[str, str] | None = None,
) -> PlainTextCommandResult:
    """Run a command and capture merged plain-text output verbatim."""

    process = await asyncio.create_subprocess_exec(
        *argv,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        cwd=str(repo_root) if repo_root is not None else None,
        env=_build_subprocess_env(env),
        start_new_session=True,
    )
    stdout, _ = await process.communicate()
    raw = stdout.decode("utf-8", errors="replace")
    exit_code = process.returncode if process.returncode is not None else 1
    return PlainTextCommandResult(raw=raw, exit_code=exit_code)


async def spawn_namespaces_process(
    argv: list[str],
    repo_root: Path | None,
    env: dict[str, str] | None = None,
) -> asyncio.subprocess.Process:
    """Spawn a long-running namespaces process."""

    return await asyncio.create_subprocess_exec(
        *argv,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        cwd=str(repo_root) if repo_root is not None else None,
        env=_build_subprocess_env(env),
        start_new_session=True,
    )


def strip_ansi(raw_output: str) -> str:
    """Remove ANSI escapes for parser stability while preserving raw output separately."""

    return ANSI_ESCAPE_PATTERN.sub("", raw_output)


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
