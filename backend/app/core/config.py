"""Application settings."""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Annotated, Any

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

from app.core.constants import EnvFile, EnvKey


class Settings(BaseSettings):
    """Runtime configuration."""

    model_config = SettingsConfigDict(
        env_file=EnvFile.DOT_ENV.value,
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    database_url: str = Field(
        default="postgresql+asyncpg://qaa_tms:qaa_tms@localhost:5432/qaa_tms",
        alias=EnvKey.DATABASE_URL.value,
    )
    jwt_secret: str = Field(default="dev-secret-change-me", alias=EnvKey.JWT_SECRET.value)
    jwt_expire_minutes: int = Field(default=720, alias=EnvKey.JWT_EXPIRE_MINUTES.value)
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=list,
        alias=EnvKey.CORS_ORIGINS.value,
    )

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
    return Settings()
