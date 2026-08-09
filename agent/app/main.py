"""FastAPI app factory and local entrypoint."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.core.config import Settings, get_settings
from app.core.constants import HeaderName
from app.services.jobs import JobManager


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
            timeout=10.0,
        ) as backend_client:
            app.state.settings = resolved_settings
            app.state.backend_client = backend_client
            app.state.auth_cache = {}
            app.state.job_manager = JobManager(
                settings=resolved_settings,
                backend_client=backend_client,
            )
            yield

    app = FastAPI(title="QAA-TMS Agent", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=resolved_settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=[
            HeaderName.ACCEPT.value,
            HeaderName.AUTHORIZATION.value,
            HeaderName.CONTENT_TYPE.value,
            HeaderName.X_QAA_TMS.value,
        ],
    )
    app.include_router(router)
    return app


app = create_app()


def main() -> None:
    """Run the local dev server."""

    settings = get_settings()
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=False)


if __name__ == "__main__":
    main()
