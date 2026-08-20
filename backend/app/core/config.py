"""Application settings."""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Annotated, Any

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict
from sqlalchemy.engine import make_url

from app.core import env_file
from app.core.constants import (
    DEFAULT_AGENT_DIST_DIR,
    DEFAULT_DATABASE_URL,
    DEFAULT_JWT_EXPIRE_MINUTES,
    DEFAULT_JWT_SECRET,
    DEFAULT_QAA_GENERATOR_BASE_URL,
    DEFAULT_QAA_GENERATOR_SUPERUSER_TOKEN,
    DEFAULT_STATIC_DIR,
    EnvKey,
)


def coerce_async_database_url(value: str) -> str:
    url = make_url(value)
    if url.drivername.split("+")[0] not in ("postgresql", "postgres"):
        return value

    url = url.set(drivername="postgresql+asyncpg")
    query = dict(url.query)
    sslmode = query.pop("sslmode", None)
    if sslmode is not None and "ssl" not in query:
        query["ssl"] = "false" if sslmode == "disable" else "true"
    url = url.set(query=query)
    return url.render_as_string(hide_password=False)


class Settings(BaseSettings):
    """Runtime configuration."""

    model_config = SettingsConfigDict(
        env_file=str(env_file.BACKEND_ENV_FILE),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    database_url: str = Field(
        default=DEFAULT_DATABASE_URL,
        alias=EnvKey.DATABASE_URL.value,
    )
    jwt_secret: str = Field(default=DEFAULT_JWT_SECRET, alias=EnvKey.JWT_SECRET.value)
    jwt_expire_minutes: int = Field(
        default=DEFAULT_JWT_EXPIRE_MINUTES,
        alias=EnvKey.JWT_EXPIRE_MINUTES.value,
    )
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=list,
        alias=EnvKey.CORS_ORIGINS.value,
    )
    static_dir: str = Field(default=DEFAULT_STATIC_DIR, alias=EnvKey.STATIC_DIR.value)
    agent_dist_dir: str = Field(
        default=DEFAULT_AGENT_DIST_DIR,
        alias=EnvKey.AGENT_DIST_DIR.value,
    )
    qaa_generator_base_url: str = Field(
        default=DEFAULT_QAA_GENERATOR_BASE_URL,
        alias=EnvKey.QAA_GENERATOR_BASE_URL.value,
    )
    qaa_generator_superuser_token: str = Field(
        default=DEFAULT_QAA_GENERATOR_SUPERUSER_TOKEN,
        alias=EnvKey.QAA_GENERATOR_SUPERUSER_TOKEN.value,
    )

    @field_validator("database_url", mode="after")
    @classmethod
    def normalize_database_url(cls, value: str) -> str:
        return coerce_async_database_url(value)

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return []
            if stripped.startswith("["):
                parsed = json.loads(stripped)
                if not isinstance(parsed, list):
                    raise ValueError("CORS_ORIGINS must be a JSON array or comma-separated list.")
                return [str(item).strip() for item in parsed if str(item).strip()]
            return [item.strip() for item in stripped.split(",") if item.strip()]
        raise ValueError("CORS_ORIGINS must be a list or string.")


@lru_cache
def get_settings() -> Settings:
    return Settings(_env_file=env_file.BACKEND_ENV_FILE)
