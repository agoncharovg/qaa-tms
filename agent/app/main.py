"""FastAPI app factory and local entrypoint."""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import cast

import httpx
import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import Response

from app.api.qaa import router as qaa_router
from app.api.routes import router
from app.core.config import Settings, get_settings
from app.core.constants import DEFAULT_BACKEND_TIMEOUT_SECONDS, HeaderName, HeaderValue
from app.services.jobs import JobManager
from app.services.notebook_backup import run_backup_loop


async def allow_private_network_preflight(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """Add the PNA allow header for configured portal origins."""

    settings = cast(Settings, request.app.state.settings)
    origin = request.headers.get(HeaderName.ORIGIN.value)
    if (
        request.method == "OPTIONS"
        and request.headers.get(HeaderName.ACCESS_CONTROL_REQUEST_PRIVATE_NETWORK.value)
        == HeaderValue.TRUE.value
        and origin in settings.cors_origins
    ):
        response = Response(status_code=200)
        response.headers[HeaderName.ACCESS_CONTROL_ALLOW_ORIGIN.value] = origin
        response.headers[HeaderName.ACCESS_CONTROL_ALLOW_PRIVATE_NETWORK.value] = (
            HeaderValue.TRUE.value
        )
        response.headers[HeaderName.ACCESS_CONTROL_ALLOW_METHODS.value] = ",".join(
            ("GET", "POST", "PUT", "OPTIONS")
        )
        response.headers[HeaderName.VARY.value] = HeaderName.ORIGIN.value
        requested_headers = request.headers.get(HeaderName.ACCESS_CONTROL_REQUEST_HEADERS.value)
        if requested_headers:
            response.headers[HeaderName.ACCESS_CONTROL_ALLOW_HEADERS.value] = requested_headers
        return response

    response = await call_next(request)
    if (
        request.headers.get(HeaderName.ACCESS_CONTROL_REQUEST_PRIVATE_NETWORK.value)
        == HeaderValue.TRUE.value
        and origin in settings.cors_origins
    ):
        response.headers[HeaderName.ACCESS_CONTROL_ALLOW_PRIVATE_NETWORK.value] = (
            HeaderValue.TRUE.value
        )
    return response


def create_app(
    settings: Settings | None = None,
    *,
    backend_transport: httpx.AsyncBaseTransport | None = None,
) -> FastAPI:
    """Create the FastAPI application."""

    resolved_settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        async with httpx.AsyncClient(
            base_url=resolved_settings.backend_url,
            transport=backend_transport,
            timeout=DEFAULT_BACKEND_TIMEOUT_SECONDS,
        ) as backend_client:
            app.state.settings = resolved_settings
            app.state.backend_client = backend_client
            app.state.auth_cache = {}
            app.state.jenkins_resume_tasks = {}
            app.state.job_manager = JobManager(
                settings=resolved_settings,
                backend_client=backend_client,
            )
            app.state.notebook_backup_task = asyncio.create_task(run_backup_loop(app))
            try:
                yield
            finally:
                task = app.state.notebook_backup_task
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task

    app = FastAPI(title="QAA-TMS Agent", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=resolved_settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=[
            HeaderName.ACCEPT.value,
            HeaderName.AUTHORIZATION.value,
            HeaderName.CONTENT_TYPE.value,
            HeaderName.X_QAA_TMS.value,
        ],
    )
    app.middleware("http")(allow_private_network_preflight)
    app.include_router(router)
    app.include_router(qaa_router)
    return app


app = create_app()


def main() -> None:
    """Run the local dev server."""

    settings = get_settings()
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=False)


if __name__ == "__main__":
    main()
