"""FastAPI application factory."""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from starlette.responses import Response
from starlette.types import Scope

from app.api.v1 import router as api_v1_router
from app.core.config import Settings, get_settings
from app.core.constants import (
    DEFAULT_QAA_GENERATOR_TIMEOUT_SECONDS,
    ApiTag,
    CacheControl,
    ErrorMessage,
    HealthFieldName,
    HealthStatus,
    HttpHeader,
    RoutePath,
)
from app.db.seed import seed_system_data
from app.db.session import create_engine_and_session_maker
from app.services.jenkins_cache import JenkinsCache
from app.services.qaa_generator_transport import resolve_qaa_generator_runtime


class ImmutableStaticFiles(StaticFiles):
    def file_response(
        self,
        full_path: str | os.PathLike[str],
        stat_result: os.stat_result,
        scope: Scope,
        status_code: int = 200,
    ) -> Response:
        response = super().file_response(full_path, stat_result, scope, status_code)
        response.headers[HttpHeader.CACHE_CONTROL.value] = CacheControl.IMMUTABLE.value
        return response


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or get_settings()
    engine, session_maker = create_engine_and_session_maker(resolved_settings.database_url)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        runtime = resolve_qaa_generator_runtime(resolved_settings)
        qaa_generator_client = httpx.AsyncClient(
            base_url=runtime.base_url,
            timeout=DEFAULT_QAA_GENERATOR_TIMEOUT_SECONDS,
        )
        leonid_http_client = httpx.AsyncClient(
            follow_redirects=True,
            timeout=resolved_settings.leonid_request_timeout,
        )
        notificator_http_client = httpx.AsyncClient(
            follow_redirects=True,
            timeout=resolved_settings.notificator_request_timeout,
        )
        app.state.settings = resolved_settings
        app.state.engine = engine
        app.state.qaa_generator_client = qaa_generator_client
        app.state.leonid_http_client = leonid_http_client
        app.state.notificator_http_client = notificator_http_client
        app.state.qaa_generator_runtime = runtime
        app.state.jenkins_cache = JenkinsCache()
        app.state.session_maker = session_maker
        app.state.login_attempts = {}
        async with session_maker() as session:
            await seed_system_data(session, resolved_settings)
        yield
        await qaa_generator_client.aclose()
        await leonid_http_client.aclose()
        await notificator_http_client.aclose()
        await engine.dispose()

    app = FastAPI(title="QAA-TMS Backend", lifespan=lifespan)
    app.add_middleware(GZipMiddleware, minimum_size=1000)

    if resolved_settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=resolved_settings.cors_origins,
            allow_credentials=False,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    app.include_router(api_v1_router)

    @app.get(RoutePath.HEALTH.value, tags=[ApiTag.SYSTEM.value])
    async def health() -> dict[str, str]:
        return {HealthFieldName.STATUS.value: HealthStatus.OK.value}

    @app.get(RoutePath.READY.value, tags=[ApiTag.SYSTEM.value])
    async def ready() -> dict[str, str]:
        try:
            async with session_maker() as session:
                await session.execute(text("SELECT 1"))
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=ErrorMessage.DATABASE_NOT_READY.value,
            ) from exc
        return {HealthFieldName.STATUS.value: HealthStatus.READY.value}

    static_dir = Path(resolved_settings.static_dir).resolve()
    if static_dir.is_dir():
        assets_dir = static_dir / "assets"
        if assets_dir.is_dir():
            app.mount("/assets", ImmutableStaticFiles(directory=assets_dir), name="assets")

        index_file = static_dir / "index.html"

        @app.get("/{full_path:path}", include_in_schema=False)
        async def serve_spa(full_path: str) -> FileResponse:
            if full_path.startswith("api"):
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

            candidate = (static_dir / full_path).resolve(strict=False)
            if not candidate.is_relative_to(static_dir):
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            if candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(
                index_file,
                headers={HttpHeader.CACHE_CONTROL.value: CacheControl.NO_CACHE.value},
            )

    return app


app = create_app()
