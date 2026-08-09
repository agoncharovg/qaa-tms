"""Application settings."""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Annotated, Any

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

from app.core.constants import (
    DEFAULT_AGENT_HOST,
    DEFAULT_AGENT_PORT,
    DEFAULT_BACKEND_URL,
    DEFAULT_CORS_ORIGINS,
    EnvFile,
    EnvKey,
)


class Settings(BaseSettings):
    """Runtime configuration."""

    model_config = SettingsConfigDict(
        env_file=EnvFile.DOT_ENV.value,
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    host: str = Field(default=DEFAULT_AGENT_HOST, alias=EnvKey.HOST.value)
    port: int = Field(default=DEFAULT_AGENT_PORT, alias=EnvKey.PORT.value)
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: list(DEFAULT_CORS_ORIGINS),
        alias=EnvKey.CORS_ORIGINS.value,
    )
    backend_url: str = Field(default=DEFAULT_BACKEND_URL, alias=EnvKey.BACKEND_URL.value)
    staging_bin: str | None = Field(default=None, alias=EnvKey.STAGING_BIN.value)
    stagings_repo: str | None = Field(default=None, alias=EnvKey.STAGINGS_REPO.value)

    @field_validator("host")
    @classmethod
    def validate_host(cls, value: str) -> str:
        if value != DEFAULT_AGENT_HOST:
            raise ValueError("AGENT_HOST must stay 127.0.0.1.")
        return value

    @field_validator("backend_url")
    @classmethod
    def normalize_backend_url(cls, value: str) -> str:
        return value.rstrip("/")

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: Any) -> list[str]:
        if value is None:
            return list(DEFAULT_CORS_ORIGINS)
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return list(DEFAULT_CORS_ORIGINS)
            if stripped.startswith("["):
                parsed = json.loads(stripped)
                if not isinstance(parsed, list):
                    raise ValueError("AGENT_CORS_ORIGINS must be a JSON array or CSV string.")
                return [str(item).strip() for item in parsed if str(item).strip()]
            return [item.strip() for item in stripped.split(",") if item.strip()]
        raise ValueError("AGENT_CORS_ORIGINS must be a list or string.")


@lru_cache
def get_settings() -> Settings:
    """Return cached settings."""

    return Settings()
