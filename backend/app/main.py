"""FastAPI application factory."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.v1 import router as api_v1_router
from app.core.config import Settings, get_settings
from app.core.constants import (
    DEFAULT_QAA_GENERATOR_TIMEOUT_SECONDS,
    ApiTag,
    HealthFieldName,
    HealthStatus,
    RoutePath,
)
from app.db.seed import seed_dev_users
from app.db.session import create_engine_and_session_maker


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or get_settings()
    engine, session_maker = create_engine_and_session_maker(resolved_settings.database_url)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        qaa_generator_client = httpx.AsyncClient(
            base_url=resolved_settings.qaa_generator_base_url,
            timeout=DEFAULT_QAA_GENERATOR_TIMEOUT_SECONDS,
        )
        app.state.settings = resolved_settings
        app.state.engine = engine
        app.state.qaa_generator_client = qaa_generator_client
        app.state.session_maker = session_maker
        async with session_maker() as session:
            await seed_dev_users(session)
        yield
        await qaa_generator_client.aclose()
        await engine.dispose()

    app = FastAPI(title="QAA-TMS Backend", lifespan=lifespan)

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
                detail="Database is not ready.",
            ) from exc
        return {HealthFieldName.STATUS.value: HealthStatus.READY.value}

    return app


app = create_app()
