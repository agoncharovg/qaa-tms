"""Shared SSE helpers."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Awaitable, Callable
from pathlib import Path
from typing import Any

from app.core.constants import JobEventType, JobStatus, SseEvent
from app.schemas import JobLogEvent, JobTerminalEvent
from app.services.command import (
    LOG_READ_POLL_SECONDS,
    spawn_namespaces_process,
    terminate_process,
)


def encode_sse(event: SseEvent, payload: dict[str, Any]) -> str:
    """Encode a single SSE frame in the format consumed by the frontend parser."""

    data = json.dumps(payload, separators=(",", ":"))
    return f"event: {event.value}\ndata: {data}\n\n"


async def stream_process_log_frames(
    argv: list[str],
    repo_root: Path | None = None,
    *,
    env: dict[str, str] | None = None,
    is_disconnected: Callable[[], Awaitable[bool]],
) -> AsyncIterator[str]:
    """Stream a subprocess stdout as shared SSE log and terminal frames."""

    process = await spawn_namespaces_process(argv, repo_root, env=env)
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
