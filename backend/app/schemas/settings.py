"""Server operational settings schemas."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from app.core.config import Settings


class ServerSettingsRead(BaseModel):
    qaa_generator_base_url: str
    qaa_generator_superuser_token_set: bool


class ServerSettingsUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    qaa_generator_base_url: str | None = None
    qaa_generator_superuser_token: str | None = None


def to_server_settings_read(settings: Settings) -> ServerSettingsRead:
    return ServerSettingsRead(
        qaa_generator_base_url=settings.qaa_generator_base_url,
        qaa_generator_superuser_token_set=bool(settings.qaa_generator_superuser_token),
    )
