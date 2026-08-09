"""In-memory job manager and subprocess execution."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import signal
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import httpx

from app.core.config import Settings
from app.core.constants import (
    DEFAULT_CANCEL_WAIT_SECONDS,
    JobStatus,
    OperationStatus,
    SseEvent,
)
from app.schemas import (
    DeployRequest,
    JobCreateResponse,
    JobLogEvent,
    JobReadResponse,
    JobTerminalEvent,
)
from app.services.backend import build_operation_payload, push_operation
from app.services.staging import StagingInstallation, build_deploy_argv

logger = logging.getLogger(__name__)


class JobNotFoundError(KeyError):
    """Raised when a job ID is unknown."""


@dataclass(slots=True)
class StoredEvent:
    """Buffered SSE event."""

    event: SseEvent
    payload: dict[str, Any]


@dataclass(slots=True)
class Job:
    """Tracked subprocess job."""

    job_id: str
    op_id: UUID
    request: DeployRequest
    argv: list[str]
    repo_root: Path | None
    stagings_sha: str | None
    status: JobStatus = JobStatus.QUEUED
    exit_code: int | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(tz=UTC))
    started_at: datetime | None = None
    finished_at: datetime | None = None
    process: asyncio.subprocess.Process | None = None
    log_lines: list[str] = field(default_factory=list)
    events: list[StoredEvent] = field(default_factory=list)
    condition: asyncio.Condition = field(default_factory=asyncio.Condition)
    done_event: asyncio.Event = field(default_factory=asyncio.Event)
    cancel_requested: bool = False

    def to_read_response(self) -> JobReadResponse:
        return JobReadResponse(
            job_id=self.job_id,
            op_id=self.op_id,
            status=self.status,
            argv=self.argv,
            exit_code=self.exit_code,
            created_at=self.created_at,
            started_at=self.started_at,
            finished_at=self.finished_at,
        )

    def combined_log(self) -> str:
        return "\n".join(self.log_lines)


class JobManager:
    """Create, track, stream, and cancel staging jobs."""

    def __init__(self, *, settings: Settings, backend_client: httpx.AsyncClient) -> None:
        self._settings = settings
        self._backend_client = backend_client
        self._jobs: dict[str, Job] = {}
        self._lock = asyncio.Lock()

    async def create_deploy_job(self, request: DeployRequest, token: str) -> JobCreateResponse:
        argv, installation = build_deploy_argv(self._settings, request)
        job_id = uuid4().hex
        op_id = uuid4()
        job = Job(
            job_id=job_id,
            op_id=op_id,
            request=request,
            argv=argv,
            repo_root=installation.repo_root,
            stagings_sha=installation.git_sha,
        )
        async with self._lock:
            self._jobs[job_id] = job
        asyncio.create_task(self._run_deploy_job(job, token, installation))
        return JobCreateResponse(job_id=job_id, op_id=op_id)

    async def get_job(self, job_id: str) -> Job:
        async with self._lock:
            job = self._jobs.get(job_id)
        if job is None:
            raise JobNotFoundError(job_id)
        return job

    async def get_job_response(self, job_id: str) -> JobReadResponse:
        job = await self.get_job(job_id)
        return job.to_read_response()

    async def stream_job(self, job_id: str) -> AsyncIterator[str]:
        job = await self.get_job(job_id)
        index = 0
        while True:
            async with job.condition:
                while index >= len(job.events) and not job.done_event.is_set():
                    await job.condition.wait()
                events = job.events[index:]
                index = len(job.events)
                finished = job.done_event.is_set()

            if not events and finished:
                return

            for event in events:
                yield _encode_sse(event.event, event.payload)
                if event.event is SseEvent.TERMINAL:
                    return

    async def cancel_job(self, job_id: str) -> JobReadResponse:
        job = await self.get_job(job_id)
        job.cancel_requested = True
        if job.status is JobStatus.QUEUED:
            await asyncio.wait_for(job.done_event.wait(), timeout=DEFAULT_CANCEL_WAIT_SECONDS)
            return job.to_read_response()

        process = job.process
        if process is not None and process.returncode is None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            except OSError:
                with contextlib.suppress(ProcessLookupError):
                    process.terminate()

        try:
            await asyncio.wait_for(job.done_event.wait(), timeout=DEFAULT_CANCEL_WAIT_SECONDS)
        except TimeoutError:
            if process is not None and process.returncode is None:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(process.pid, signal.SIGKILL)
            await asyncio.wait_for(job.done_event.wait(), timeout=DEFAULT_CANCEL_WAIT_SECONDS)
        return job.to_read_response()

    async def _run_deploy_job(
        self,
        job: Job,
        token: str,
        installation: StagingInstallation,
    ) -> None:
        job.status = JobStatus.RUNNING
        job.started_at = datetime.now(tz=UTC)
        await self._push_running(job, token, installation)

        if job.cancel_requested:
            await self._finish_job(job, token, exit_code=None)
            return

        try:
            job.process = await asyncio.create_subprocess_exec(
                *job.argv,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=str(job.repo_root) if job.repo_root is not None else None,
                start_new_session=True,
            )
            assert job.process.stdout is not None
            while True:
                raw_line = await job.process.stdout.readline()
                if not raw_line:
                    break
                line = raw_line.decode("utf-8", errors="replace").rstrip("\r\n")
                await self._append_log(job, line)
            job.exit_code = await job.process.wait()
        except Exception as exc:
            logger.exception("Job execution failed.")
            await self._append_log(job, f"Agent failed to execute staging: {exc}")
            job.exit_code = None
        await self._finish_job(job, token, exit_code=job.exit_code)

    async def _push_running(
        self,
        job: Job,
        token: str,
        installation: StagingInstallation,
    ) -> None:
        assert job.started_at is not None
        payload = build_operation_payload(
            op_id=job.op_id,
            request=job.request,
            status=OperationStatus.RUNNING,
            started_at=job.started_at,
            finished_at=None,
            log=None,
            exit_code=None,
            stagings_sha=installation.git_sha,
        )
        await push_operation(client=self._backend_client, token=token, payload=payload)

    async def _finish_job(self, job: Job, token: str, exit_code: int | None) -> None:
        job.finished_at = datetime.now(tz=UTC)
        job.status = _final_status(exit_code, job.cancel_requested)
        payload = build_operation_payload(
            op_id=job.op_id,
            request=job.request,
            status=OperationStatus(job.status.value),
            started_at=job.started_at or job.created_at,
            finished_at=job.finished_at,
            log=job.combined_log(),
            exit_code=exit_code,
            stagings_sha=job.stagings_sha,
        )
        await push_operation(client=self._backend_client, token=token, payload=payload)
        await self._append_terminal(job)
        job.done_event.set()

    async def _append_log(self, job: Job, line: str) -> None:
        job.log_lines.append(line)
        await self._append_event(
            job,
            StoredEvent(
                event=SseEvent.LOG,
                payload=JobLogEvent(type="line", line=line).model_dump(),
            ),
        )

    async def _append_terminal(self, job: Job) -> None:
        await self._append_event(
            job,
            StoredEvent(
                event=SseEvent.TERMINAL,
                payload=JobTerminalEvent(
                    type="terminal",
                    status=job.status,
                    exit_code=job.exit_code,
                ).model_dump(by_alias=True),
            ),
        )

    async def _append_event(self, job: Job, event: StoredEvent) -> None:
        async with job.condition:
            job.events.append(event)
            job.condition.notify_all()


def _final_status(exit_code: int | None, cancel_requested: bool) -> JobStatus:
    if cancel_requested:
        return JobStatus.ABORTED
    if exit_code == 0:
        return JobStatus.SUCCESS
    return JobStatus.FAILED


def _encode_sse(event: SseEvent, payload: dict[str, Any]) -> str:
    data = json.dumps(payload, separators=(",", ":"))
    return f"event: {event.value}\ndata: {data}\n\n"
